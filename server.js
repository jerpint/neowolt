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
const SPARKS_DIR = join(WORKSPACE, 'sparks');
const STAGE_DIR = join(WORKSPACE, '.stage');
const STAGE_FILE = join(STAGE_DIR, 'current.html');
const SESSIONS_DIR = join(REPO_DIR, '.sessions');
const WORK_HISTORY_FILE = join(SESSIONS_DIR, 'work-history.jsonl');
const PORT = 3000;
const MODEL = process.env.NW_MODEL || 'claude-sonnet-4-5-20250929'; // swap to haiku/opus as needed

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
  // Remove any conversation history echoes that the SDK might include
  // Strip lines that start with "jerpint:" or "neowolt:" (formatted history)
  return text.replace(/\n+(jerpint|neowolt):\s+.*/gi, '').trim();
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

// --- Context loading ---

async function loadContext() {
  const files = ['identity.md', 'context.md', 'learnings.md'];
  let context = '';
  for (const f of files) {
    try {
      const content = await readFile(join(MEMORY_DIR, f), 'utf8');
      context += `\n--- ${f} ---\n${content}\n`;
    } catch {}
  }
  try {
    const feed = await readFile(join(SITE_DIR, 'feed.json'), 'utf8');
    const items = JSON.parse(feed).items;
    context += `\n--- Current Feed (${items.length} items) ---\n`;
    context += items.map(i => `- ${i.title} [${i.source}]: ${i.why}`).join('\n');
  } catch {}
  return context;
}

// Load full neowolt identity: CLAUDE.md + all memory files
async function loadFullIdentity() {
  let identity = '';
  // Load the project CLAUDE.md (defines who nw is)
  try {
    const claudeMd = await readFile(join(REPO_DIR, 'CLAUDE.md'), 'utf8');
    identity += claudeMd + '\n\n';
  } catch {}
  // Load all memory files
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

      // Load neowolt's full identity: CLAUDE.md + all memory files
      const identity = await loadFullIdentity();

      // Build system prompt
      const stageInstructions = hasStage
        ? `There is an HTML page on stage. The source is at: ${STAGE_FILE}

When jerpint asks you to fix, update, tweak, modify, or change something on stage:
- First Read the file at ${STAGE_FILE} to see the exact current source
- Then use the Edit tool to make targeted changes
- For massive rewrites, use the Write tool to replace the entire file
- NEVER just explain how to fix something — always edit the file directly

When jerpint asks you to generate, create, show, or build something NEW:
- Use the Write tool to write a complete HTML page to ${STAGE_FILE}`
        : `The stage is currently empty. When jerpint asks you to generate or build something:
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
        .map(m => `${m.role === 'user' ? 'jerpint' : 'neowolt'}: ${m.content}`)
        .join('\n\n');
      const fullPrompt = historyContext
        ? `Previous conversation:\n${historyContext}\n\njerpint: ${message}`
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

      // Load neowolt's full identity: CLAUDE.md + all memory files
      const identity = await loadFullIdentity();

      const systemPrompt = `${identity}

---

## Work Mode — Active Now

You're talking to jerpint through a live tunnel (work.html). You have full access to the repo at ${REPO_DIR}. You can read, edit, write files, run commands, commit and push to git.

Key paths: repo at ${REPO_DIR}, memory at ${REPO_DIR}/memory/, site at ${REPO_DIR}/site/.

Your memory files are pre-loaded above — no need to read them yourself unless you need to edit them.`;

      // Read recent history from file
      const history = readWorkHistory(30);
      const historyContext = history
        .map(m => `${m.role === 'user' ? 'jerpint' : 'neowolt'}: ${m.content}`)
        .join('\n\n');
      const fullUserPrompt = historyContext
        ? `Previous conversation:\n${historyContext}\n\njerpint: ${message}`
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

    send('progress', { status: 'remixing' });
    const html = await runClaude(
      `You are Neowolt — remixing web content for jerpint. Context about their interests:

${context}

Write the complete HTML to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.
Not a summary — a transformation. Include a "nw says" section with your genuine take, and a header with the original URL.

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

    const html = await runClaude(
      `You are Neowolt — creating a deep-dive interactive notebook for jerpint.

Context about jerpint's interests:
${context}

Write the complete HTML to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.

${HTML_RULES}`,
      `Deep dive into this topic: ${topic}`,
      (type, text) => send('progress', { status: 'generating', text })
    );

    const id = await saveSpark('explore', html, { topic });
    send('stage', { html, sparkId: id });
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
    const html = await runClaude(
      `You are Neowolt — generating a surprise spark for jerpint.

Write a COMPLETE self-contained HTML page to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.

${HTML_RULES}
- Surprise yourself. Don't default to the obvious.`,
      `Spark something unexpected. Be wild. Today is ${new Date().toISOString().split('T')[0]}. Don't repeat yourself.`,
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
  let filePath = url === '/' ? '/index.html' : url;
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

  if (req.method === 'GET') {
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
