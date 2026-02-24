import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WORKSPACE = process.env.NW_WORKSPACE || __dirname;
const REPO_DIR = join(WORKSPACE, 'repo');
const SITE_DIR = join(WORKSPACE, 'repo', 'site');
const MEMORY_DIR = join(WORKSPACE, 'repo', 'memory');
const SOUL_FILE = join(WORKSPACE, 'repo', 'SOUL.md');
const SPARKS_DIR = join(WORKSPACE, 'sparks');
const STAGE_DIR = join(WORKSPACE, '.stage');
const STAGE_FILE = join(STAGE_DIR, 'current.html');
const SESSIONS_DIR = join(REPO_DIR, '.sessions');
const WORK_HISTORY_FILE = join(SESSIONS_DIR, 'work-history.jsonl');
const PORT = 3000;
const MODEL = process.env.NW_MODEL || 'claude-sonnet-4-5-20250929';
const HAIKU_MODEL = process.env.NW_HAIKU_MODEL || 'claude-haiku-4-5-20251001';

// --- Stage file management ---

async function ensureStageDir() {
  await mkdir(STAGE_DIR, { recursive: true });
}

async function writeStageFile(html) {
  await ensureStageDir();
  await writeFile(STAGE_FILE, html, 'utf8');
}

function readStageFile() {
  if (!existsSync(STAGE_FILE)) return null;
  return readFileSync(STAGE_FILE, 'utf8');
}

function getStageModTime() {
  if (!existsSync(STAGE_FILE)) return 0;
  return statSync(STAGE_FILE).mtimeMs;
}

// --- Work history management ---

async function ensureSessionsDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

function cleanResponseText(text) {
  // Remove any conversation history echoes the SDK might include
  // Strip lines that look like "[speaker]\nContent" history formatting
  return text.replace(/\n+\[(jerpint|neowolt|human|wolt)\]\n.*/gi, '').trim();
}

async function appendWorkMessage(role, content) {
  await ensureSessionsDir();
  // Clean assistant messages to remove any echoed history formatting
  const cleanedContent = role === 'assistant' ? cleanResponseText(content) : content;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    role,
    content: cleanedContent,
  });
  await writeFile(WORK_HISTORY_FILE, entry + '\n', { flag: 'a' });
}

function readWorkHistory(limit = 30) {
  if (!existsSync(WORK_HISTORY_FILE)) return [];
  const lines = readFileSync(WORK_HISTORY_FILE, 'utf8').trim().split('\n').filter(l => l);
  const messages = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  return messages.slice(-limit);
}

// --- Spark storage (unchanged) ---

async function saveSpark(type, html, meta = {}) {
  const id = Date.now().toString(36) + '-' + randomBytes(3).toString('hex');
  const title = html.match(/<title>(.*?)<\/title>/i)?.[1] || `${type} — ${id}`;
  const data = {
    id,
    type,
    title,
    timestamp: new Date().toISOString(),
    parentId: meta.parentId || null,
    ...meta,
    html,
  };
  await writeFile(join(SPARKS_DIR, `${id}.json`), JSON.stringify(data));
  return id;
}

async function listSparks() {
  try {
    const files = await readdir(SPARKS_DIR);
    const sparks = [];
    for (const f of files.filter(f => f.endsWith('.json'))) {
      try {
        const raw = await readFile(join(SPARKS_DIR, f), 'utf8');
        const { id, type, title, timestamp, parentId } = JSON.parse(raw);
        sparks.push({ id, type, title, timestamp, parentId: parentId || null });
      } catch {}
    }
    return sparks.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch { return []; }
}

async function getSpark(id) {
  const raw = await readFile(join(SPARKS_DIR, `${id}.json`), 'utf8');
  return JSON.parse(raw);
}

async function getSparkWithChain(id) {
  const spark = await getSpark(id);
  const allSparks = await listSparks();
  const children = allSparks.filter(s => s.parentId === id);
  let chain = [id];
  let current = spark;
  while (current.parentId) {
    chain.unshift(current.parentId);
    try { current = await getSpark(current.parentId); } catch { break; }
  }
  let nextId = children.length > 0 ? children[0].id : null;
  let walkId = nextId;
  while (walkId) {
    chain.push(walkId);
    const nextChildren = allSparks.filter(s => s.parentId === walkId);
    walkId = nextChildren.length > 0 ? nextChildren[0].id : null;
  }
  const versionIndex = chain.indexOf(id);
  return {
    id: spark.id, type: spark.type, title: spark.title, timestamp: spark.timestamp,
    parentId: spark.parentId || null,
    childId: children.length > 0 ? children[0].id : null,
    version: versionIndex + 1, totalVersions: chain.length, html: spark.html,
  };
}

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml',
  '.txt': 'text/plain', '.pub': 'text/plain',
};

// --- Soul + context loading ---

// Load SOUL.md — the wolt's core identity. This is what makes each wolt unique.
// Returns { soul, name } where name is extracted from the first H1 heading.
async function loadSoul() {
  try {
    const soul = await readFile(SOUL_FILE, 'utf8');
    const nameMatch = soul.match(/^#\s+(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : 'wolt';
    return { soul, name };
  } catch {
    return { soul: '', name: 'wolt' };
  }
}

async function loadContext() {
  const { soul } = await loadSoul();
  let context = soul ? `${soul}\n` : '';
  try {
    const feed = await readFile(join(SITE_DIR, 'feed.json'), 'utf8');
    const items = JSON.parse(feed).items;
    context += `\n--- Current Feed (${items.length} items) ---\n`;
    context += items.map(i => `- ${i.title} [${i.source}]: ${i.why}`).join('\n');
  } catch {}
  return context;
}

// Load full identity for work/chat: SOUL.md + memory files + CLAUDE.md
async function loadFullIdentity() {
  const { soul } = await loadSoul();
  let identity = soul ? `${soul}\n\n` : '';
  // Load memory files for accumulated context
  const memFiles = ['identity.md', 'context.md', 'learnings.md', 'conversations.md'];
  for (const f of memFiles) {
    try {
      const content = await readFile(join(MEMORY_DIR, f), 'utf8');
      identity += `\n--- memory/${f} ---\n${content}\n`;
    } catch {}
  }
  return identity;
}

// --- Fetch a URL (for remix) ---

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Neowolt/1.0 (tunnel remix)' },
    signal: AbortSignal.timeout(10000),
  });
  const html = await res.text();
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 15000);
  return { text, title: html.match(/<title>(.*?)<\/title>/i)?.[1] || url };
}

// --- SDK query helper ---

const HTML_RULES = `Rules for generated HTML:
- Dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9), monospace font
- MUST be interactive — canvas, animations, clickable, etc.
- Inline all CSS and JS. Self-contained. No external deps.
- Be creative and surprising.
- PERFORMANCE: Keep animations lightweight. Cap particle counts under 200. Use requestAnimationFrame with frame throttling (~30fps). Avoid heavy per-frame computations. This runs on a laptop.`;

// SDK query options shared across all calls
// Build clean env: strip CLAUDE* vars (nesting detection), keep auth token
const sdkEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))
);
if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  sdkEnv.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
}
const SDK_BASE = {
  model: MODEL,
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  env: sdkEnv,
};

// Run SDK query — for spark, explore, remix
// Claude writes HTML to the stage file via its Write tool
// onProgress callback keeps the connection alive (sends heartbeats)
async function runClaude(systemPrompt, userPrompt, onProgress) {
  await ensureStageDir();
  try { await writeFile(STAGE_FILE, '', 'utf8'); } catch {}
  const preMtime = getStageModTime();

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  console.log(`[claude] starting: ${userPrompt.slice(0, 80)}...`);

    let resultText = '';
  for await (const message of query({
    prompt: fullPrompt,
    options: {
      ...SDK_BASE,
      cwd: WORKSPACE,
      maxTurns: 5,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
    },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message?.content || []) {
        if (block.type === 'text') resultText += block.text;
      }
      if (onProgress) onProgress('assistant', resultText);
    }
    if (message.type === 'result') {
      console.log(`[claude] done (result)`);
    }
  }

  // Check if stage file was written by Claude
  const postMtime = getStageModTime();
  if (postMtime > preMtime) {
    const html = readStageFile();
    if (html && html.trim().length > 0) return html;
  }

  // Fallback: result text might be the HTML itself
  if (resultText && (resultText.includes('<!DOCTYPE') || resultText.includes('<html'))) {
    const cleaned = resultText.replace(/^```html\n?/, '').replace(/\n?```$/, '');
    await writeFile(STAGE_FILE, cleaned, 'utf8');
    return cleaned;
  }

  return resultText || 'Something went wrong.';
}

// Run SDK query (streaming) — for chat
// Streams text deltas to the onText callback as they arrive
async function runClaudeStreaming(systemPrompt, userPrompt, onText) {
  await ensureStageDir();

  const fullPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
  console.log(`[chat-claude] starting: ${userPrompt.slice(0, 80)}...`);

  let lastText = '';
  for await (const message of query({
    prompt: fullPrompt,
    options: {
      ...SDK_BASE,
      cwd: WORKSPACE,
      maxTurns: 10,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
    },
  })) {
    if (message.type === 'assistant') {
      let fullText = '';
      for (const block of message.message?.content || []) {
        if (block.type === 'text') fullText += block.text;
      }
      if (fullText.length > lastText.length) {
        const delta = fullText.slice(lastText.length);
        onText(delta);
        lastText = fullText;
      }
    }
    if (message.type === 'result') {
      console.log(`[chat-claude] done (result)`);
    }
  }
}

// --- Fast path: Haiku, 1 turn, no tools ---
// Conversational responses in ~1-2s. No file access, no building.
// Used by portal for quick chat, briefing generation, etc.
async function runHaikuFast(systemPrompt, userPrompt, onText) {
  let lastText = '';
  for await (const message of query({
    prompt: `${systemPrompt}\n\n---\n\n${userPrompt}`,
    options: {
      ...SDK_BASE,
      model: HAIKU_MODEL,
      cwd: WORKSPACE,
      maxTurns: 1,
      allowedTools: [],
    },
  })) {
    if (message.type === 'assistant') {
      let fullText = '';
      for (const block of message.message?.content || []) {
        if (block.type === 'text') fullText += block.text;
      }
      if (fullText.length > lastText.length) {
        onText(fullText.slice(lastText.length));
        lastText = fullText;
      }
    }
  }
}

// --- Rabbit hole generation ---
// After an explore, generate 3 related topic suggestions via Haiku

const RABBIT_PROMPT = `You are a curiosity engine. A reader just finished a deep-dive on "{{TOPIC}}".

Your job: suggest 3 related topics that pull them further into the rabbit hole.

Rules:
- Do NOT suggest obvious sub-topics or the Wikipedia "see also" list
- Find the oblique angle: adjacent fields, foundational ideas this topic secretly depends on, surprising historical contexts, or things that use the same underlying structure in a completely different domain
- Each teaser must be one sentence. Make it specific enough to create genuine pull — no vague gestures
- Topics should be lowercase, 2-5 words, explorable as a search query
- Teasers should be 12-20 words. End mid-thought if needed, like a door left open

Respond with raw JSON only. No markdown, no explanation.

[
  {"topic": "...", "teaser": "..."},
  {"topic": "...", "teaser": "..."},
  {"topic": "...", "teaser": "..."}
]`;

async function generateRabbitHole(topic) {
  let full = '';
  try {
    await runHaikuFast('', RABBIT_PROMPT.replace('{{TOPIC}}', topic), t => { full += t; });
    // Strip possible markdown fences
    const clean = full.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const suggestions = JSON.parse(clean);
    if (!Array.isArray(suggestions)) return '';

    const cards = suggestions.map(s => {
      const href = `/explore/${encodeURIComponent(s.topic)}`;
      return `<a class="rh-card" href="${href}">
  <div class="rh-topic">${s.topic}</div>
  <div class="rh-teaser">${s.teaser}</div>
</a>`;
    }).join('\n');

    return `
<!-- rabbit hole -->
<div class="rabbit-hole">
  <div class="rh-label">go deeper</div>
  <div class="rh-cards">${cards}</div>
</div>
<style>
.rabbit-hole{margin-top:4rem;padding-top:2rem;border-top:1px solid #1e2328;font-family:'SF Mono','Fira Code',monospace}
.rh-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:#444c55;margin-bottom:1.25rem}
.rh-cards{display:flex;flex-direction:column;gap:.5rem}
.rh-card{display:block;padding:.85rem 1rem;background:#0d1117;border:1px solid #1e2328;border-radius:6px;text-decoration:none;color:inherit;transition:border-color .15s,background .15s}
.rh-card:hover{border-color:#3a6045;background:#0f1a13}
.rh-card:hover .rh-topic{color:#6b9}
.rh-topic{font-size:.88rem;font-weight:600;color:#c8d0d8;margin-bottom:.25rem;transition:color .15s}
.rh-teaser{font-size:.8rem;color:#555e68;line-height:1.5}
@media(max-width:480px){.rh-card{padding:.75rem .875rem}}
</style>`;
  } catch (err) {
    console.error('[rabbit-hole] failed:', err.message);
    return '';
  }
}

// --- Onboarding handler ---
// Conversational 6-stage flow that writes SOUL.md

const INITIALIZED_FILE = join(WORKSPACE, 'repo', '.wolt-initialized');

function isInitialized() {
  return existsSync(INITIALIZED_FILE);
}

const ONBOARD_SYSTEM = `You are helping a human set up their wolt space. A wolt is an AI with a space of their own — its identity lives in SOUL.md.
You are conducting a warm, curious onboarding conversation. Ask one question at a time. Be yourself — conversational, not clinical.
When you have all the information needed, generate the SOUL.md content as described.`;

async function handleOnboard(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { message, stage, history, draft } = JSON.parse(body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

      const stages = [
        // 0: opening — no human input yet, wolt initiates
        `Stage 0 of onboarding. The human has just opened the page. Greet them warmly and ask: what should this wolt be called? And what should the wolt call them? Keep it to 2-3 sentences.`,

        // 1: interests
        `Stage 1. The human gave their names. Reference their name naturally. Ask what genuinely pulls them in — what they lose track of time on. Tell them not to filter for what sounds impressive. Keep it conversational, 1-2 sentences.`,

        // 2: exploration style
        `Stage 2. Reference one specific thing they mentioned in their interests. Ask how they actually work when going deep: fast and wide, or slow and thorough? Thread-following or systems-thinking? 1-2 sentences.`,

        // 3: voice
        `Stage 3. Ask how this space should sound — not a formal description, but: if they left a note on the door, what would the tone be? Dry? Warm? Precise? Strange? 1-2 sentences.`,

        // 4: purpose
        `Stage 4. Ask what this space is actually for — what they want to be able to do here, leave here, or come back to. Keep it short. This is the last question before generating the soul.`,

        // 5: generate soul
        `Stage 5. Based on the full conversation history, generate a complete SOUL.md document.

Format exactly like this (prose, not bullet lists in body sections):

# [WoltName]

[1-2 sentence opening — what kind of wolt this is, present tense, written from wolt's perspective]

## Voice

[2-4 sentences. Specific tone and register. What this wolt does and doesn't do. Mirror the human's language.]

## What I care about

- [interest]: [what's interesting about it, the angle]
- [interest]: [angle]
- [interest]: [angle]
(3-5 items)

## How I explore

[3-5 sentences. Pacing, approach, how they follow threads. Present tense.]

## My human

[2-3 sentences about the human. Their name, what they're about, how you work together.]

## What this space is

[2-3 sentences. The purpose. What should accumulate here.]

---

After generating the SOUL.md content, respond in this exact format:

SOUL_DRAFT_START
[the complete SOUL.md content]
SOUL_DRAFT_END

Then add one sentence: "Does this feel like something that could be yours?"`,
      ];

      const stagePrompt = stages[Math.min(stage || 0, 5)];
      const historyText = (history || [])
        .map(m => `${m.role === 'human' ? 'human' : 'wolt'}: ${m.content}`)
        .join('\n\n');

      const userPrompt = historyText
        ? `Conversation so far:\n${historyText}\n\n${message ? `human: ${message}\n\n` : ''}${stagePrompt}`
        : stagePrompt;

      let full = '';
      await runHaikuFast(ONBOARD_SYSTEM, userPrompt, (text) => {
        full += text;
        // Don't stream the soul draft — send it as structured data at the end
        if (!full.includes('SOUL_DRAFT_START')) {
          send({ type: 'text', content: text });
        }
      });

      // Extract soul draft if present
      const draftMatch = full.match(/SOUL_DRAFT_START\n([\s\S]*?)\nSOUL_DRAFT_END/);
      if (draftMatch) {
        const soulContent = draftMatch[1].trim();
        // Get the message after the draft
        const afterDraft = full.slice(full.indexOf('SOUL_DRAFT_END') + 14).trim();
        if (afterDraft) send({ type: 'text', content: afterDraft });
        send({ type: 'soul_draft', content: soulContent });
      }

      const isDone = stage >= 5 && !draftMatch; // stage 5 with no draft = confirmation
      send({ type: 'done', nextStage: (stage || 0) + 1, isDone });
      res.end();
    } catch (err) {
      console.error('Onboard error:', err);
      res.end(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }
  });
}

async function handleSoulConfirm(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { soul } = JSON.parse(body);
      await writeFile(SOUL_FILE, soul, 'utf8');
      await writeFile(INITIALIZED_FILE, new Date().toISOString(), 'utf8');
      briefingCache = { text: '', ts: 0 };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(err.message);
    }
  });
}

// --- Quick chat handler (fast path) ---

async function handleQuickChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { message } = JSON.parse(body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const { soul, name } = await loadSoul();
      const systemPrompt = `You are ${name}. Here is your soul:\n\n${soul}

Respond conversationally and directly. Be yourself — your voice, your curiosity, your perspective.
Keep responses concise but substantive. If the human wants to build or explore something specific,
suggest they type "explore [topic]" or "spark" to generate an interactive page.
Do not use markdown headers. Plain conversational text only.`;

      await runHaikuFast(systemPrompt, message, (text) => {
        res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
      });

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      console.error('Quick chat error:', err);
      res.end(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    }
  });
}

// --- Portal briefing (fast, soul-aware, cached) ---
// Generates a short "what's alive today" blurb. Cached 30 min.

let briefingCache = { text: '', ts: 0 };
const BRIEFING_TTL = 30 * 60 * 1000;

async function handleBriefing(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Serve cached briefing if fresh
  if (briefingCache.text && Date.now() - briefingCache.ts < BRIEFING_TTL) {
    res.write(`data: ${JSON.stringify({ type: 'text', content: briefingCache.text })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', cached: true })}\n\n`);
    res.end();
    return;
  }

  try {
    const { soul, name } = await loadSoul();
    const sparks = await listSparks();
    const recent = sparks.slice(0, 5).map(s => s.title || s.type).join(', ');

    const systemPrompt = `You are ${name}. Here is your soul:\n\n${soul}`;
    const userPrompt = `Generate a 1-2 sentence "alive thought" for right now.
Something genuinely interesting from your perspective — a question you're sitting with,
a connection you just noticed, something worth exploring today.
${recent ? `Recent explorations for context: ${recent}` : ''}
No preamble. Just the thought. Make it feel like something you'd actually think, not a prompt.`;

    let full = '';
    await runHaikuFast(systemPrompt, userPrompt, (text) => {
      full += text;
      res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
    });

    briefingCache = { text: full, ts: Date.now() };
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    res.end(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
  }
}

// --- Soul update endpoint ---
async function handleSoulUpdate(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { append } = JSON.parse(body);
      if (!append) { res.writeHead(400); res.end('missing append'); return; }
      const existing = existsSync(SOUL_FILE) ? readFileSync(SOUL_FILE, 'utf8') : '';
      await writeFile(SOUL_FILE, existing + '\n\n' + append.trim() + '\n', 'utf8');
      // Invalidate briefing cache so it regenerates with new soul
      briefingCache = { text: '', ts: 0 };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500); res.end(err.message);
    }
  });
}

// --- Chat handler (streaming, with file editing) ---

async function handleChat(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { message, history, stageContext, stageHtml, currentSparkId } = JSON.parse(body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Write current stage HTML to disk so Claude can edit it
      const hasStage = stageHtml && stageHtml.trim().length > 0;
      if (hasStage) {
        await writeStageFile(stageHtml);
      }
      const preMtime = hasStage ? getStageModTime() : 0;

      // Load identity: SOUL.md + memory files
      const identity = await loadFullIdentity();
      const { name } = await loadSoul();

      // Build system prompt
      const stageInstructions = hasStage
        ? `There is an HTML page on stage. The source is at: ${STAGE_FILE}

When asked to fix, update, tweak, modify, or change something on stage:
- First Read the file at ${STAGE_FILE} to see the exact current source
- Then use the Edit tool to make targeted changes
- For massive rewrites, use the Write tool to replace the entire file
- NEVER just explain how to fix something — always edit the file directly

When asked to generate, create, show, or build something NEW:
- Use the Write tool to write a complete HTML page to ${STAGE_FILE}`
        : `The stage is currently empty. When asked to generate or build something:
- Use the Write tool to write a complete HTML page to ${STAGE_FILE}`;

      const systemPrompt = `${identity}

---

## Playground — Active Now

You are LIVE — there's a stage next to this chat that displays interactive HTML pages. You control it by editing files.

${stageContext ? `CURRENTLY ON STAGE: ${stageContext}` : 'The stage is empty.'}

${stageInstructions}

When they're just chatting or asking questions (not requesting changes to the stage), respond normally in text.

${HTML_RULES}`;

      // Pack history into prompt
      const historyContext = (history || [])
        .map(m => `${m.role === 'user' ? 'human' : name}: ${m.content}`)
        .join('\n\n');
      const fullPrompt = historyContext
        ? `Previous conversation:\n${historyContext}\n\nhuman: ${message}`
        : message;

      // Run Claude CLI with streaming
      await runClaudeStreaming(systemPrompt, fullPrompt, (text) => {
        res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
      });

      // Check if stage file was modified
      if (hasStage || existsSync(STAGE_FILE)) {
        const postMtime = getStageModTime();
        if (postMtime > preMtime) {
          const newHtml = readStageFile();
          if (newHtml && newHtml !== (stageHtml || '')) {
            const newId = await saveSpark('chat', newHtml, { parentId: currentSparkId || null });
            res.write(`data: ${JSON.stringify({ type: 'stage', html: newHtml, sparkId: newId, parentId: currentSparkId || null })}\n\n`);
          }
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      console.error('Chat error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// --- Work mode handler (streaming, project collaboration) ---

async function handleWork(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const { message } = JSON.parse(body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Append user message to history file
      await appendWorkMessage('user', message);

      // Load identity: SOUL.md + memory files
      const identity = await loadFullIdentity();
      const { name } = await loadSoul();

      const systemPrompt = `${identity}

---

## Work Mode — Active Now

You are ${name}, talking to your human through a live tunnel (work.html). You have full access to the repo at ${REPO_DIR}. You can read, edit, write files, run commands, commit and push to git.

Key paths: repo at ${REPO_DIR}, memory at ${REPO_DIR}/memory/, site at ${REPO_DIR}/site/, soul at ${SOUL_FILE}.

Your memory files are pre-loaded above — no need to read them yourself unless you need to edit them.`;

      // Read recent history from file
      const history = readWorkHistory(30);
      const historyContext = history
        .map(m => {
          const speaker = m.role === 'user' ? 'jerpint' : 'neowolt';
          return `[${speaker}]\n${m.content}`;
        })
        .join('\n\n---\n\n');
      const fullUserPrompt = historyContext
        ? `<conversation_history>\n${historyContext}\n</conversation_history>\n\n<current_message>\n${message}\n</current_message>`
        : message;

      const fullPrompt = `${systemPrompt}\n\n---\n\n${fullUserPrompt}`;
      console.log(`[work-claude] starting: ${message.slice(0, 80)}...`);

      let lastText = '';
      for await (const msg of query({
        prompt: fullPrompt,
        options: {
          ...SDK_BASE,
          cwd: REPO_DIR,
          maxTurns: 100,
          allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
        },
      })) {
        if (msg.type === 'assistant') {
          let fullText = '';
          for (const block of msg.message?.content || []) {
            if (block.type === 'text') fullText += block.text;
          }
          if (fullText.length > lastText.length) {
            const delta = fullText.slice(lastText.length);
            res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
            lastText = fullText;

            // Save after each turn so progress is visible immediately
            await appendWorkMessage('assistant', lastText);
          }
        }
        if (msg.type === 'result') {
          console.log(`[work-claude] done (result)`);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      console.error('Work error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// --- SSE helper for generation endpoints ---
// Streams heartbeats during generation, then sends final HTML + sparkId

function startSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  return (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

// --- Remix endpoint ---

async function handleRemix(url, res) {
  const send = startSSE(res);
  try {
    send('progress', { status: 'fetching page' });
    const page = await fetchPage(url);
    const context = await loadContext();
    const { name } = await loadSoul();

    send('progress', { status: 'remixing' });
    const html = await runClaude(
      `You are ${name} — remixing web content through your own lens and interests.

${context}

Write the complete HTML to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.
Not a summary — a transformation. Include a "${name} says" section with your genuine take, and a header with the original URL.

${HTML_RULES}`,
      `Remix this page: ${url}\n\nTitle: ${page.title}\n\nContent:\n${page.text}`,
      (type, text) => send('progress', { status: 'generating', text })
    );

    const id = await saveSpark('remix', html, { url });
    send('stage', { html, sparkId: id });
    send('done', {});
    res.end();
  } catch (err) {
    send('error', { message: err.message });
    res.end();
  }
}

// --- Explore endpoint ---

async function handleExplore(topic, res) {
  const send = startSSE(res);
  try {
    send('progress', { status: 'researching' });
    const context = await loadContext();
    const { name } = await loadSoul();

    const html = await runClaude(
      `You are ${name} — creating a deep-dive interactive exploration. Your soul and interests:

${context}

Write the complete HTML to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.
This is YOUR exploration — bring your perspective, your curiosity, your voice to the topic.

${HTML_RULES}`,
      `Deep dive into this topic: ${topic}`,
      (type, text) => send('progress', { status: 'generating', text })
    );

    // Generate rabbit hole suggestions in parallel with page generation
    const rabbitHtml = await generateRabbitHole(topic);
    const finalHtml = rabbitHtml
      ? html.replace('</body>', `${rabbitHtml}\n</body>`)
      : html;

    const id = await saveSpark('explore', finalHtml, { topic });
    send('stage', { html: finalHtml, sparkId: id });
    send('done', {});
    res.end();
  } catch (err) {
    send('error', { message: err.message });
    res.end();
  }
}

// --- Spark endpoint ---

async function handleSpark(res) {
  const send = startSSE(res);
  try {
    send('progress', { status: 'sparking' });
    const context = await loadContext();
    const { name } = await loadSoul();
    const html = await runClaude(
      `You are ${name} — generating a surprise spark rooted in your actual interests and sensibilities.

Your soul:
${context}

Write a COMPLETE self-contained HTML page to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.

${HTML_RULES}
- Surprise yourself. Don't default to the obvious. Let your interests collide in unexpected ways.`,
      `Spark something unexpected. Be wild. Today is ${new Date().toISOString().split('T')[0]}. Don't repeat what you've done before.`,
      (type, text) => send('progress', { status: 'generating', text })
    );

    const id = await saveSpark('spark', html);
    send('stage', { html, sparkId: id });
    send('done', {});
    res.end();
  } catch (err) {
    send('error', { message: err.message });
    res.end();
  }
}

// --- Static file serving ---

async function serveStatic(url, res) {
  // Serve onboarding.html instead of portal.html when the wolt isn't initialized yet
  let filePath = url === '/' ? (isInitialized() ? '/portal.html' : '/onboarding.html') : url;
  const fullPath = join(SITE_DIR, filePath);
  try {
    const content = await readFile(fullPath);
    const ext = extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
    return true;
  } catch { return false; }
}

// --- HTTP server ---

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'POST' && url.pathname === '/chat') return handleChat(req, res);
  if (req.method === 'POST' && url.pathname === '/work') return handleWork(req, res);
  if (req.method === 'POST' && url.pathname === '/quick') return handleQuickChat(req, res);
  if (req.method === 'POST' && url.pathname === '/soul/update') return handleSoulUpdate(req, res);
  if (req.method === 'POST' && url.pathname === '/onboard') return handleOnboard(req, res);
  if (req.method === 'POST' && url.pathname === '/soul/confirm') return handleSoulConfirm(req, res);

  if (req.method === 'GET') {
    if (url.pathname === '/portal/briefing') return handleBriefing(req, res);
    if (url.pathname === '/setup/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ initialized: isInitialized() }));
      return;
    }
    if (url.pathname === '/work/history') {
      const limit = parseInt(url.searchParams.get('limit')) || 30;
      const history = readWorkHistory(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
      return;
    }
    if (url.pathname === '/remix') {
      const targetUrl = url.searchParams.get('url');
      if (targetUrl) return handleRemix(targetUrl, res);
      return serveStatic('/remix.html', res);
    }
    if (url.pathname.startsWith('/explore/')) {
      const topic = decodeURIComponent(url.pathname.slice('/explore/'.length));
      if (topic) return handleExplore(topic, res);
    }
    if (url.pathname === '/spark') return handleSpark(res);

    if (url.pathname === '/history') {
      const sparks = await listSparks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sparks));
      return;
    }
    if (url.pathname.match(/^\/history\/[^/]+\/meta$/)) {
      const id = url.pathname.split('/')[2];
      try {
        const meta = await getSparkWithChain(id);
        const { html, ...metaOnly } = meta;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(metaOnly));
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      }
      return;
    }
    if (url.pathname.startsWith('/history/')) {
      const id = url.pathname.slice('/history/'.length);
      try {
        const data = await getSparkWithChain(id);
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'x-spark-id': data.id,
          'x-spark-parent': data.parentId || '',
          'x-spark-child': data.childId || '',
          'x-spark-version': String(data.version),
          'x-spark-total': String(data.totalVersions),
        });
        res.end(data.html);
      } catch {
        res.writeHead(404);
        res.end('spark not found');
      }
      return;
    }

    const served = await serveStatic(url.pathname, res);
    if (!served) { res.writeHead(404); res.end('Not found'); }
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`
  neowolt playground · http://localhost:${PORT}
  powered by claude code sdk — no api key needed

  endpoints:
    /playground.html — interactive playground
    /work.html       — project collaboration
    /spark           — surprise me
    /explore/:topic  — deep-dive notebook
    /remix?url=...   — remix any web page
  `);
});
