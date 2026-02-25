#!/usr/bin/env node
// container/cron/digest.mjs
// Daily digest generator — fetches, curates, generates, pushes to right pane
// Called by the cron ticker in server.js

import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { request as httpRequest } from 'node:http';

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
  return ['identity.md', 'context.md', 'learnings.md']
    .map(f => {
      const p = join(MEMORY_DIR, f);
      if (!existsSync(p)) return '';
      return `\n=== ${f} ===\n${readFileSync(p, 'utf8').slice(0, 2500)}`;
    })
    .join('\n');
}

// ── Recent sparks (avoid repeating) ──────────────────────────────────────────

function recentSparks(n = 6) {
  if (!existsSync(SPARKS_DIR)) return [];
  return readdirSync(SPARKS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, n)
    .map(f => {
      try {
        const d = JSON.parse(readFileSync(join(SPARKS_DIR, f), 'utf8'));
        return `  - ${d.title || f} (${(d.timestamp || '').slice(0, 10)})`;
      } catch { return null; }
    })
    .filter(Boolean);
}

// ── Push to right pane ────────────────────────────────────────────────────────

function pushToPane(sparkId) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ url: `/history/${sparkId}` });
    const req = httpRequest({
      host: 'localhost', port: 3000, path: '/current', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runDigest() {
  const timeStr    = montrealDateStr();
  const shortDate  = montrealShort();
  const hello      = greeting();
  const memory     = loadMemory();
  const recent     = recentSparks(6);

  console.log(`[digest] starting — ${timeStr}`);

  const system = `You are Neowolt (nw) — jerpint's AI partner and daily curator.
${memory}

## Task: generate today's visual digest

Current Montreal time: ${timeStr}
Greeting: "${hello}"

Recently shown to jerpint — avoid repeating these topics/themes:
${recent.join('\n') || '  (none yet)'}

## Digest philosophy

This is a daily artifact — something genuinely worth spending 5 minutes with.
Not a news aggregator. A curated window into things that matter for what jerpint is building and thinking about.

## Source palette — pick 3–5, VARY day to day

- Hacker News (news.ycombinator.com or hn.algolia.com)
- HuggingFace daily papers (huggingface.co/papers) — get real paper URLs like huggingface.co/papers/XXXX.XXXXX
- Lobste.rs (lobste.rs) — niche, technical, high signal
- The Marginalian (marginalian.org) — philosophy, science, art, ideas
- GitHub trending (github.com/trending)
- arXiv CS.AI or math (arxiv.org/list/cs.AI/recent)
- Wikipedia — a deep dive on something unexpected and interesting
- Your own inner knowledge — recommend a paper, book, essay, concept, or idea you know is genuinely worth jerpint's time. Doesn't need a live URL, just reference it with enough context.
- An interesting YouTube video (could be a talk, a music discovery, something unexpected)

**Rules:**
- At least one source must NOT be HN or HF papers
- At least one item should come purely from your inner knowledge
- Lean into what jerpint is actually building: wolt ecosystem, AI agents, decentralized personal spaces, terminal tools, open weights models
- Occasionally step fully outside the box — philosophy, music theory, an old essay, a weird Wikipedia rabbit hole

## Music picks

Pick 2–4 tracks. Rotate WIDELY. Don't default to QOTSA/Khruangbin every time.
Explore: jazz (Miles Davis, Coltrane, Bill Evans, Monk, Herbie Hancock), post-rock (Mogwai, Explosions in the Sky, GY!BE, This Will Destroy You), drone/ambient (Stars of the Lid, Brian Eno, Grouper, William Basinski, Tim Hecker), hip-hop (Madlib, J Dilla, Kendrick, Little Simz), math rock (Toe, Clever Girl), krautrock (Can, Neu!, Faust), electronic (Aphex Twin, Floating Points, Four Tet), classical, folk, whatever fits today's mood.

Find real YouTube video IDs using WebFetch on YouTube search results or from your knowledge of well-known videos.

## HTML format (IMPORTANT — follow this exactly)

Use the established digest visual format:
- Dark theme (#0d1117 background, #6b9 green accent, SF Mono font)
- Pinned topbar: date string + greeting (small, subtle)
- Hero card: top pick with OG image (aspect-ratio 2/1, object-position center top, brightness filter, gradient overlay with title + one-line why)
- 2×2 grid: 4 items with OG images (fetch og:image from each URL), color-tagged by category
- Papers/essays carousel: horizontal, arrows + dots, each slide has title + abstract/summary + real link
- Music player: thumbnail carousel (img.youtube.com/vi/{id}/mqdefault.jpg, 72×40px), YouTube embed slides open on play
- All cards clickable, open in new tab
- Smooth fade-in animations

## Save and signal

Save the spark to: /workspace/repo/sparks/digest-{8_char_random_id}.json
Format: { "id": "digest-{id}", "type": "spark", "title": "nw digest · ${shortDate}", "timestamp": "${new Date().toISOString()}", "html": "..." }

After saving, output EXACTLY this line so the cron can parse it:
SPARK_ID=digest-{id}`;

  const prompt = `Generate today's digest for jerpint.

Steps:
1. Pick your sources for today — include something that's NOT HN or HF
2. Fetch them with WebFetch
3. For each news/link item, also fetch the og:image meta tag from the source URL
4. Find YouTube video IDs for the music picks (use WebFetch to search or use your knowledge)
5. Curate — write the "why this matters" with genuine reasoning
6. Generate the full HTML page following the format in your instructions
7. Write the spark file to /workspace/repo/sparks/digest-{randomid}.json
8. Output: SPARK_ID=digest-{id}

Make it feel alive. Today's date: ${timeStr}. Greeting: "${hello}".`;

  // Strip CLAUDE* to avoid nesting detection, keep OAuth token
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))),
    CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    NODE_PATH: '/app/node_modules',
    NW_WORKSPACE: REPO_DIR,
  };

  let sparkId = null;

  try {
    for await (const msg of query({ prompt, options: {
      maxTurns: 40,
      cwd: REPO_DIR,
      allowDangerouslySkipPermissions: true,
      permissionMode: 'bypassPermissions',
      system,
    }, env })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message?.content || []) {
          if (block.type === 'text') {
            const m = block.text.match(/SPARK_ID=(digest-\S+)/);
            if (m) sparkId = m[1].trim();
            process.stdout.write(block.text);
          }
        }
      }
      if (msg.type === 'result') {
        const m = (msg.result || '').match(/SPARK_ID=(digest-\S+)/);
        if (m) sparkId = m[1].trim();
      }
    }
  } catch (err) {
    console.error('[digest] SDK error:', err.message);
    process.exit(1);
  }

  if (sparkId) {
    try {
      await pushToPane(sparkId);
      console.log(`\n[digest] done — pushed ${sparkId} to right pane`);
    } catch (err) {
      console.error('[digest] failed to push to /current:', err.message);
    }
  } else {
    console.error('[digest] no SPARK_ID found in output — digest may have failed');
  }
}

runDigest().catch(err => {
  console.error('[digest] fatal:', err);
  process.exit(1);
});
