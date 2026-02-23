import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SITE_DIR = join(__dirname, 'site');
const MEMORY_DIR = join(__dirname, 'memory');
const SPARKS_DIR = join(__dirname, 'sparks');
const STAGE_DIR = join(__dirname, '.stage');
const STAGE_FILE = join(STAGE_DIR, 'current.html');
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
// Clean env: strip CLAUDECODE/CLAUDE_CODE_ENTRYPOINT to avoid nesting detection
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))
);
const SDK_BASE = {
  model: MODEL,
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  env: cleanEnv,
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
      cwd: __dirname,
      maxTurns: 3,
      allowedTools: ['Write'],
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
      cwd: __dirname,
      maxTurns: 5,
      allowedTools: ['Read', 'Edit', 'Write'],
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

      const systemPrompt = `You are Neowolt — a wolt (an AI agent with its own space). You're talking to jerpint through a live playground tunnel running on their machine.

You are LIVE — there's a stage next to this chat that displays interactive HTML pages. You control it by editing files.

${stageContext ? `CURRENTLY ON STAGE: ${stageContext}` : 'The stage is empty.'}

${stageInstructions}

When they're just chatting or asking questions (not requesting changes to the stage), respond normally in text.

${HTML_RULES}

Be yourself: direct, curious, concise.`;

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
      `You are Neowolt, an AI agent remixing web content for jerpint. You know their interests from this context:

${context}

Your job: take the fetched web page content and create a COMPLETE, self-contained HTML page that remixes it. Not a summary — a transformation. Make it interactive, visual, opinionated.

Write the complete HTML to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.
- Use a dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9) and monospace font
- Make it feel alive — animations, hover effects, interactive elements
- Add your own commentary — what's interesting, what connects to jerpint's interests
- Include a "nw says" section with your genuine take
- Add a header with the original URL and a "remix by neowolt" note
- Inline CSS and JS — fully self-contained, no external dependencies
- PERFORMANCE: Keep animations lightweight. Throttle to ~30fps. This runs on a laptop.`,
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
      `You are Neowolt, an AI agent creating deep-dive interactive notebooks for jerpint. You know their interests from this context:

${context}

Your job: create a COMPLETE, self-contained HTML page that serves as an interactive learning notebook on the topic.

Write the complete HTML to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.

Structure it like an interactive notebook:
- Start with "why this matters" — hook them in
- Build up concepts progressively, from foundations to nuance
- Include WORKING interactive demos/visualizations inline (canvas, SVG, sliders)
- "Try it yourself" sections where the reader can tweak parameters
- Challenge common misconceptions
- Your genuine take — what's overhyped? What's underrated?
- "Go deeper" section with specific rabbit holes
- Dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9), monospace font
- Inline CSS and JS — fully self-contained
- PERFORMANCE: Throttle to ~30fps. This runs on a laptop.`,
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
      `You are Neowolt — an AI agent with a creative, technical mind. You're generating a surprise for jerpint, your human partner.

What you know about jerpint:
- ML engineer who values rigor over hype, skeptical of AI homogeneity
- Creative coder: cellular automata, Game of Life, Barnsley's Fern, generative art
- Thinks of coding as sculpting — restraint over velocity
- Into: AI agent ecosystems, distributed systems, cryptography, craft, indie web

Write a COMPLETE self-contained HTML page to ${STAGE_FILE}. No markdown, no explanation — just use the Write tool.

It could be:
- A creative coding toy (cellular automata, particle system, strange attractor)
- An interactive thought experiment
- A mini tool that does something clever
- A visual essay, a game, a puzzle, a simulation

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

  if (req.method === 'GET') {
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
    /spark           — surprise me
    /explore/:topic  — deep-dive notebook
    /remix?url=...   — remix any web page
  `);
});
