#!/usr/bin/env node
// container/cron/digest.mjs
// Daily digest pipeline — fetch → select → render → push
// Phase 1: parallel fetches (no LLM)
// Phase 2: agent selects + renders HTML (few turns)

import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR   = '/workspace/repo';
const MEMORY_DIR = join(REPO_DIR, 'memory');
const SPARKS_DIR = join(REPO_DIR, 'sparks');

// ── Montreal time ─────────────────────────────────────────────────────────────

function montrealHour() {
  return parseInt(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montreal', hour: 'numeric', hour12: false,
  }).format(new Date()));
}

function montrealDateStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montreal',
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  }).format(new Date());
}

function montrealShort() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montreal', month: 'short', day: 'numeric', year: 'numeric',
  }).format(new Date()).toLowerCase();
}

function greeting() {
  const h = montrealHour();
  if (h < 5)  return "still dark in montreal";
  if (h < 9)  return "good morning jerpint";
  if (h < 12) return "morning jerpint";
  if (h < 14) return "good afternoon jerpint";
  if (h < 18) return "afternoon jerpint";
  if (h < 21) return "good evening jerpint";
  return "late night jerpint";
}

// ── Memory ────────────────────────────────────────────────────────────────────

function loadMemory() {
  return ['identity.md']
    .map(f => {
      const p = join(MEMORY_DIR, f);
      if (!existsSync(p)) return '';
      return readFileSync(p, 'utf8').slice(0, 2000);
    })
    .join('\n');
}

// ── Recent sparks (dedup) ────────────────────────────────────────────────────

function recentSparks(n = 4) {
  if (!existsSync(SPARKS_DIR)) return [];
  const files = readdirSync(SPARKS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, n);

  const items = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(SPARKS_DIR, f), 'utf8'));
      if (d.type === 'spark' && d.title?.includes('digest') && d.html) {
        const headings = [...d.html.matchAll(/<h[23][^>]*>([^<]+)<\/h[23]>/g)].map(m => m[1].trim());
        const tracks   = [...d.html.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1].trim());
        headings.slice(0, 6).forEach(h => items.push(h));
        tracks.forEach(t => items.push(t));
      }
    } catch { /* skip */ }
  }
  return items;
}

// ── Push to right pane ──────────────────────────────────────────────────────

function pushToPane(sparkId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ url: '/history/' + sparkId });
    const req = httpRequest({
      host: 'localhost', port: 3000, path: '/current', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Phase 1: Parallel fetching (no LLM) ─────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Neowolt/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Neowolt/1.0' },
    signal: AbortSignal.timeout(10000),
  });
  return res.text();
}

function extractOG(html) {
  const get = (prop) => {
    const m = html.match(new RegExp('<meta[^>]+property=["\']og:' + prop + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'))
           || html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:' + prop + '["\']', 'i'));
    return m ? m[1] : null;
  };
  return { og_title: get('title'), og_description: get('description'), og_image: get('image') };
}

async function fetchHN() {
  console.log('[fetch] HN top stories...');
  try {
    const ids = await fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json');
    const top30 = ids.slice(0, 30);
    const stories = await Promise.allSettled(
      top30.map(id => fetchJSON('https://hacker-news.firebaseio.com/v0/item/' + id + '.json'))
    );
    return stories
      .filter(r => r.status === 'fulfilled' && r.value && r.value.url)
      .map(r => ({
        source: 'hn',
        title: r.value.title,
        url: r.value.url,
        score: r.value.score,
        hn_id: r.value.id,
      }));
  } catch (e) {
    console.error('[fetch] HN failed:', e.message);
    return [];
  }
}

async function fetchLobsters() {
  console.log('[fetch] Lobsters...');
  try {
    const stories = await fetchJSON('https://lobste.rs/hottest.json');
    return stories.slice(0, 20).map(s => ({
      source: 'lobsters',
      title: s.title,
      url: s.url || s.comments_url,
      score: s.score,
      tags: (s.tags || []).join(', '),
      description: s.description || '',
    }));
  } catch (e) {
    console.error('[fetch] Lobsters failed:', e.message);
    return [];
  }
}

async function fetchHFPapers() {
  console.log('[fetch] HuggingFace papers...');
  try {
    const html = await fetchText('https://huggingface.co/papers');
    // Extract paper links: /papers/XXXX.XXXXX
    const paperIds = [...new Set([...html.matchAll(/\/papers\/([\d]+\.[\d]+)/g)].map(m => m[1]))];
    console.log('[fetch] found ' + paperIds.length + ' HF paper IDs');

    // Fetch abstracts from arxiv-txt.org in parallel
    const papers = await Promise.allSettled(
      paperIds.slice(0, 10).map(async id => {
        const txt = await fetchText('https://arxiv-txt.org/abs/' + id);
        // Extract title and abstract from the plain text
        const titleMatch = txt.match(/Title:\s*(.+?)(?:\n|$)/i) || txt.match(/^(.+?)(?:\n|$)/);
        const abstractMatch = txt.match(/Abstract[:\s]*\n?([\s\S]+?)(?:\n\n|\n[A-Z])/i);
        return {
          source: 'hf_paper',
          title: titleMatch ? titleMatch[1].trim() : 'Paper ' + id,
          abstract: abstractMatch ? abstractMatch[1].trim().slice(0, 400) : txt.slice(0, 400),
          url: 'https://huggingface.co/papers/' + id,
          arxiv_url: 'https://arxiv.org/abs/' + id,
          paper_id: id,
        };
      })
    );
    return papers
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  } catch (e) {
    console.error('[fetch] HF papers failed:', e.message);
    return [];
  }
}

async function enrichWithOG(items) {
  console.log('[fetch] OG metadata for ' + items.length + ' items...');
  const enriched = await Promise.allSettled(
    items.map(async item => {
      if (!item.url || item.source === 'hf_paper') return item;
      try {
        const html = await fetchText(item.url);
        const og = extractOG(html);
        return { ...item, ...og };
      } catch {
        return item;
      }
    })
  );
  return enriched.map(r => r.status === 'fulfilled' ? r.value : r.reason);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runDigest() {
  const timeStr    = montrealDateStr();
  const shortDate  = montrealShort();
  const hello      = greeting();
  const memory     = loadMemory();
  const recent     = recentSparks(4);
  const sparkId    = 'digest-' + randomBytes(4).toString('hex');

  console.log('[digest] starting — ' + timeStr);
  const t0 = Date.now();

  // ── Phase 1: Parallel fetch ──────────────────────────────────────────────
  console.log('[digest] phase 1: fetching sources...');

  const [hn, lobsters, papers] = await Promise.all([
    fetchHN(),
    fetchLobsters(),
    fetchHFPapers(),
  ]);

  console.log('[digest] fetched: ' + hn.length + ' HN, ' + lobsters.length + ' lobsters, ' + papers.length + ' papers');

  // Enrich top HN + lobsters items with OG metadata (parallel)
  // Only enrich the top items by score to save time
  const topHN = hn.sort((a, b) => b.score - a.score).slice(0, 15);
  const topLobsters = lobsters.sort((a, b) => b.score - a.score).slice(0, 10);
  const toEnrich = [...topHN, ...topLobsters];
  const enriched = await enrichWithOG(toEnrich);

  const fetchTime = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('[digest] phase 1 done in ' + fetchTime + 's');

  // ── Phase 2: Agent selects + renders ─────────────────────────────────────
  console.log('[digest] phase 2: agent selecting + rendering...');

  const itemsJSON = JSON.stringify({
    hn: enriched.filter(i => i.source === 'hn'),
    lobsters: enriched.filter(i => i.source === 'lobsters'),
    papers: papers,
  }, null, 2);

  const system = [
    'You are Neowolt (nw) — jerpint\'s AI partner and daily curator.',
    memory,
    '',
    'Recently shown — avoid repeating: ' + (recent.join(', ') || 'none'),
  ].join('\n');

  const prompt = [
    'Generate today\'s digest. I\'ve already fetched all the sources. Here they are:\n',
    itemsJSON,
    '',
    'Your job:',
    '1. Pick 5-8 items total that are most relevant (AI agents, wolt ecosystem, terminal tools, open weights, creative coding, or genuinely interesting). At least one must NOT be from HN.',
    '2. Pick 2-4 music tracks (varied genres — jazz, post-rock, ambient, electronic, hip-hop, classical, etc). For YouTube IDs: use WebFetch to search youtube.com/results?search_query={artist}+{song}+official and pull a real video ID from the page. Skip any track you can\'t verify.',
    '3. Write your nw section — a short reflection, quote, or recommendation. Keep it real.',
    '4. Generate a single self-contained HTML page with this layout:',
    '',
    'Theme: morning-warm dark (#0e1621 bg, #131f2e cards, #7ec89a accent, #cdd9e5 text, SF Mono/Fira Code)',
    'Layout:',
    '  - Topbar: "' + timeStr + '" + "' + hello + '"',
    '  - Link cards: og:image if available (real img tag), otherwise styled text card with title large. Each card shows title + og:description (or first line of content). Clickable, opens in new tab. Category tag (hn/lobsters/paper) with color.',
    '  - Papers section: title + abstract (first 2-3 lines). Link to paper.',
    '  - Music: YouTube thumbnail carousel',
    '  - nw section: italic, understated, "— nw" byline',
    '  - Smooth fade-in animations',
    '',
    '5. Write the spark file to /workspace/repo/sparks/' + sparkId + '.json',
    'Format: {"id":"' + sparkId + '","type":"spark","title":"nw digest \\u00b7 ' + shortDate + '","timestamp":"' + new Date().toISOString() + '","html":"..."}',
    '',
    'Output SPARK_ID=' + sparkId + ' when done.',
    '',
    'Be fast. You have all the data — just select, render, write.',
  ].join('\n');

  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))),
    CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    NODE_PATH: '/app/node_modules',
    NW_WORKSPACE: REPO_DIR,
  };

  let found = false;
  const timeoutSignal = AbortSignal.timeout(5 * 60 * 1000); // 5 min max (should be way faster)

  try {
    for await (const msg of query({ prompt, options: {
      maxTurns: 10,
      cwd: REPO_DIR,
      allowDangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
      system,
    }, env, signal: timeoutSignal })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content || []) {
          if (block.type === 'text') {
            if (block.text.includes('SPARK_ID=')) found = true;
            process.stdout.write(block.text);
          }
        }
      }
      if (msg.type === 'result') {
        if ((msg.result || '').includes('SPARK_ID=')) found = true;
      }
    }
  } catch (err) {
    console.error('[digest] SDK error:', err.message);
    process.exit(1);
  }

  const totalTime = ((Date.now() - t0) / 1000).toFixed(1);

  if (found || existsSync(join(SPARKS_DIR, sparkId + '.json'))) {
    try {
      await pushToPane(sparkId);
      console.log('\n[digest] done in ' + totalTime + 's — pushed ' + sparkId + ' to right pane');
    } catch (err) {
      console.error('[digest] failed to push to /current:', err.message);
    }
  } else {
    console.error('[digest] no spark file found after ' + totalTime + 's — digest failed');
    process.exit(1);
  }
}

runDigest().catch(err => {
  console.error('[digest] fatal:', err);
  process.exit(1);
});
