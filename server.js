import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync, readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { request as httpRequest } from 'node:http';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Optional TUI deps — only available inside the Docker container
// Use createRequire instead of dynamic import() because NODE_PATH
// is ignored by ESM resolution but respected by CommonJS require()
let WebSocketServer, pty;
try {
  const require = createRequire(import.meta.url);
  WebSocketServer = require('ws').WebSocketServer;
  pty = require('node-pty');
} catch {
  console.log('[tui] ws/node-pty not available — /tui disabled (normal outside Docker)');
}

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
const WORKSPACE_HISTORY_FILE = join(SESSIONS_DIR, 'workspace-history.jsonl');
const TOOL_REGISTRY_FILE = join(SESSIONS_DIR, 'tool-registry.json');
const CURRENT_URL_FILE = join(SESSIONS_DIR, 'current-url.json');
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

// --- Workspace history ---

async function appendWorkspaceMessage(role, content) {
  await ensureSessionsDir();
  const cleanedContent = role === 'assistant' ? cleanResponseText(content) : content;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    role,
    content: cleanedContent,
  });
  await writeFile(WORKSPACE_HISTORY_FILE, entry + '\n', { flag: 'a' });
}

function readWorkspaceHistory(limit = 30) {
  if (!existsSync(WORKSPACE_HISTORY_FILE)) return [];
  const lines = readFileSync(WORKSPACE_HISTORY_FILE, 'utf8').trim().split('\n').filter(l => l);
  const messages = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  return messages.slice(-limit);
}

// --- GenUI component spec (injected into workspace system prompt) ---

const GENUI_COMPONENT_SPEC = `## Rich Components

Your responses are rendered as a rich notebook. Use standard markdown for text. To embed interactive components, use fenced code blocks with these language tags:

### table — Interactive sortable table
\`\`\`table
{"headers": ["Name", "Score"], "rows": [["Alice", 95], ["Bob", 87]]}
\`\`\`

### chart — Chart.js chart (bar, line, pie, scatter, doughnut)
\`\`\`chart
{"type": "bar", "title": "Results", "labels": ["A", "B", "C"], "datasets": [{"label": "Score", "data": [10, 20, 15]}]}
\`\`\`

### math — KaTeX LaTeX expression
\`\`\`math
\\\\int_0^\\\\infty e^{-x^2} dx = \\\\frac{\\\\sqrt{\\\\pi}}{2}
\`\`\`

### mermaid — Diagram
\`\`\`mermaid
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action]
\`\`\`

### steps — Expandable walkthrough
\`\`\`steps
[{"title": "Step 1", "content": "Do this first"}, {"title": "Step 2", "content": "Then this"}]
\`\`\`

### interactive — Full sandboxed HTML page (iframe)
\`\`\`interactive
<!DOCTYPE html>...full self-contained HTML with inline CSS/JS...
\`\`\`

### tool — Embed a running tool (spawned via /tools/spawn)
\`\`\`tool
{"name": "marimo", "path": "/"}
\`\`\`

Rules:
- Standard code blocks (\`\`\`python, \`\`\`javascript, etc.) render with syntax highlighting
- Mix text and components freely — don't wrap everything in one component
- Every chart needs a title; tables need clear headers
- Interactive pages: dark theme (#0d1117 bg, #c9d1d9 text, #6b9 accent), inline CSS/JS, self-contained`;

// --- Current view (right pane of split) ---

function getCurrentUrl() {
  if (!existsSync(CURRENT_URL_FILE)) return '/';
  try { return JSON.parse(readFileSync(CURRENT_URL_FILE, 'utf8')).url || '/'; } catch { return '/'; }
}

function setCurrentUrl(url) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  writeFileSync(CURRENT_URL_FILE, JSON.stringify({ url, updated: Date.now() }));
  console.log(`[current] → ${url}`);
}

// --- Tool proxy registry ---

const toolRegistry = new Map(); // name -> { port, pid, startedAt }

function saveToolRegistry() {
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    const data = {};
    for (const [name, info] of toolRegistry) data[name] = info;
    writeFileSync(TOOL_REGISTRY_FILE, JSON.stringify(data));
  } catch (e) {
    console.error('[tools] save failed:', e.message);
  }
}

function registerTool(name, port, pid, command) {
  toolRegistry.set(name, { port, pid, command, startedAt: Date.now() });
  saveToolRegistry();
  console.log(`[tools] registered ${name} on port ${port} (pid ${pid})`);
}

function unregisterTool(name) {
  const tool = toolRegistry.get(name);
  if (tool) {
    try { process.kill(tool.pid); } catch {}
    toolRegistry.delete(name);
    saveToolRegistry();
    console.log(`[tools] unregistered ${name}`);
  }
}

// On startup: reload registry and respawn any tools whose process died
async function restoreToolRegistry() {
  await ensureSessionsDir();
  if (!existsSync(TOOL_REGISTRY_FILE)) return;
  try {
    const data = JSON.parse(readFileSync(TOOL_REGISTRY_FILE, 'utf8'));
    for (const [name, info] of Object.entries(data)) {
      const alive = (() => { try { process.kill(info.pid, 0); return true; } catch { return false; } })();
      if (alive) {
        toolRegistry.set(name, info);
        console.log(`[tools] restored ${name} (pid ${info.pid} still alive)`);
      } else if (info.command) {
        const child = spawn('sh', ['-c', info.command], {
          cwd: WORKSPACE, env: { ...process.env, PORT: String(info.port) },
          stdio: 'pipe', detached: true,
        });
        child.unref();
        child.on('exit', () => unregisterTool(name));
        toolRegistry.set(name, { ...info, pid: child.pid, startedAt: Date.now() });
        console.log(`[tools] respawned ${name} on port ${info.port} (new pid ${child.pid})`);
      }
    }
    saveToolRegistry();
  } catch (e) { console.error('[tools] restore failed:', e.message); }
}

restoreToolRegistry();

// Cleanup stale tools periodically
setInterval(() => {
  for (const [name, tool] of toolRegistry) {
    try { process.kill(tool.pid, 0); } catch { toolRegistry.delete(name); saveToolRegistry(); }
  }
}, 30000);

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

// --- TUI HTML (self-contained xterm.js terminal) ---

const TUI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>TUI · Neowolt</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100dvh; overflow: hidden; background: #0d1117; overscroll-behavior: none; }
    body { display: flex; flex-direction: column; font-family: 'SF Mono','Fira Code','Consolas',monospace; }
    #terminal { touch-action: none; }
    #topbar {
      background: #161b22; border-bottom: 1px solid #21262d;
      padding: 0.4rem 0.75rem; display: flex; align-items: center;
      justify-content: space-between; font-size: 0.8rem; flex-shrink: 0;
    }
    #topbar .title { color: #6b9; font-weight: 600; }
    #topbar .status { color: #555; font-size: 0.7rem; }
    #topbar .actions { display: flex; gap: 0.5rem; }
    #topbar .actions a {
      font-family: inherit; font-size: 0.75rem; padding: 0.3rem 0.7rem;
      background: #21262d; border: 1px solid #30363d; border-radius: 4px;
      color: #888; cursor: pointer; text-decoration: none;
    }
    #topbar .actions a:hover { border-color: #6b9; color: #c9d1d9; }
    #terminal { flex: 1; overflow: hidden; touch-action: none; }
    .xterm { height: 100%; touch-action: none; }
  </style>
</head>
<body>
  <div id="topbar">
    <div>
      <span class="title">nw tui</span>
      <span class="status" id="status">connecting...</span>
    </div>
    <div class="actions">
      <a href="/workspace.html">workspace</a>
      <a href="/work.html">work</a>
      <a href="/playground.html">playground</a>
    </div>
  </div>
  <div id="terminal"></div>

  <script type="module">
    import { Terminal } from 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm';
    import { FitAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm';
    import { WebLinksAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.11.0/+esm';

    const statusEl = document.getElementById('status');
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'SF Mono','Fira Code','Consolas',monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#6b9',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#f66',
        green: '#6b9',
        yellow: '#e5c07b',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#c9d1d9',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    let ws = null;
    let reconnectTimer = null;

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(proto + '//' + location.host + '/tui');

      ws.onopen = () => {
        statusEl.textContent = 'connected';
        statusEl.style.color = '#6b9';
        // Send initial size
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };

      ws.onmessage = (ev) => {
        term.write(ev.data);
      };

      ws.onclose = () => {
        statusEl.textContent = 'disconnected — reconnecting...';
        statusEl.style.color = '#f66';
        reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    window.addEventListener('resize', () => fitAddon.fit());
    new ResizeObserver(() => fitAddon.fit()).observe(document.getElementById('terminal'));

    // Mobile: translate touch swipes into mouse wheel events for tmux scroll
    let touchY = null;
    const SCROLL_PX = 30; // pixels per scroll tick
    const termEl = document.getElementById('terminal');

    termEl.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) touchY = e.touches[0].clientY;
    }, { passive: true });

    termEl.addEventListener('touchmove', (e) => {
      if (touchY === null || !ws || ws.readyState !== WebSocket.OPEN) return;
      const dy = touchY - e.touches[0].clientY;
      if (Math.abs(dy) >= SCROLL_PX) {
        const ticks = Math.floor(Math.abs(dy) / SCROLL_PX);
        // SGR mouse encoding: 64=wheel up, 65=wheel down
        const btn = dy > 0 ? 64 : 65;
        const esc = String.fromCharCode(27);
        const seq = esc + '[<' + btn + ';1;1M';
        for (let i = 0; i < ticks; i++) ws.send(seq);
        touchY = e.touches[0].clientY;
      }
    }, { passive: true });

    termEl.addEventListener('touchend', () => { touchY = null; }, { passive: true });

    connect();
  </script>
</body>
</html>`;


// --- Live-reload ---
// Watches site/ directory for changes, notifies connected browsers via WebSocket

const liveReloadClients = new Set();
let reloadTimeout = null;

function broadcastReload(changedFile) {
  if (reloadTimeout) clearTimeout(reloadTimeout);
  reloadTimeout = setTimeout(() => {
    console.log(`[livereload] ${changedFile || 'file changed'} — notifying ${liveReloadClients.size} client(s)`);
    for (const ws of liveReloadClients) {
      try { ws.send('reload'); } catch { liveReloadClients.delete(ws); }
    }
  }, 150); // debounce rapid fs events
}

// Start watching site/ directory — debounced to absorb macOS bind-mount spurious fires
let reloadTimer;
try {
  watch(SITE_DIR, { recursive: true }, (eventType, filename) => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => broadcastReload(filename), 400);
  });
  console.log(`[livereload] watching ${SITE_DIR}`);
} catch (err) {
  console.log(`[livereload] fs.watch failed: ${err.message}`);
}

// Tiny script injected into HTML pages served through the tunnel
const LIVERELOAD_SCRIPT = `<script>(function(){var p=location.protocol==='https:'?'wss:':'ws:';function connect(){var ws=new WebSocket(p+'//'+location.host+'/livereload');ws.onmessage=function(){location.reload()};ws.onclose=function(){setTimeout(connect,3000)}}connect()})();</script>`;

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

// --- Workspace mode handler (GenUI notebook) ---

async function handleWorkspace(req, res) {
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

      await appendWorkspaceMessage('user', message);

      const identity = await loadFullIdentity();

      // Build list of running tools for context
      const runningTools = [];
      for (const [name, info] of toolRegistry) {
        runningTools.push(`${name} (port ${info.port})`);
      }
      const toolContext = runningTools.length > 0
        ? `\nRunning tools: ${runningTools.join(', ')}`
        : '';

      const systemPrompt = `${identity}

---

## Workspace Mode — Active Now

You are in workspace mode — a conversational notebook for learning and discovery. Your responses are rendered as rich cells with inline components.

${GENUI_COMPONENT_SPEC}

You have full access to the repo at ${REPO_DIR}. You can read, edit, write files, run commands, search the web.

Key paths: repo at ${REPO_DIR}, memory at ${REPO_DIR}/memory/, site at ${REPO_DIR}/site/.
${toolContext}

To spawn a tool (e.g., marimo notebook), use Bash to start it on a free port, then reference it with a tool component. Example:
- Bash: marimo run /workspace/repo/notebook.py --host 127.0.0.1 --port 8100 --headless &
- Then tell the user it's available

Your memory files are pre-loaded above.`;

      const history = readWorkspaceHistory(30);
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
      console.log(`[workspace] starting: ${message.slice(0, 80)}...`);

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
            await appendWorkspaceMessage('assistant', lastText);
          }
        }
        if (msg.type === 'result') {
          console.log(`[workspace] done (result)`);
        }
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      console.error('Workspace error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// --- Tool spawn + proxy handlers ---

async function handleToolSpawn(req, res) {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    try {
      const { name, command, port } = JSON.parse(body);
      if (!name || !command || !port) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name, command, and port required' }));
        return;
      }
      if (toolRegistry.has(name)) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `${name} already running` }));
        return;
      }
      const child = spawn('sh', ['-c', command], {
        cwd: WORKSPACE,
        env: { ...process.env, PORT: String(port) },
        stdio: 'pipe',
        detached: true,
      });
      child.unref();
      registerTool(name, port, child.pid, command);
      child.on('exit', () => unregisterTool(name));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name, port, pid: child.pid }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function proxyToolHTTP(toolName, req, res, url) {
  const tool = toolRegistry.get(toolName);
  if (!tool) { res.writeHead(404); res.end('tool not found'); return; }

  const targetPath = url.pathname + (url.search || '');
  const proxyReq = httpRequest({
    hostname: '127.0.0.1',
    port: tool.port,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${tool.port}` },
  }, (proxyRes) => {
    // Rewrite Location headers so redirects stay on the tunnel URL
    const headers = { ...proxyRes.headers };
    if (headers.location) {
      headers.location = headers.location.replace(
        /^https?:\/\/127\.0\.0\.1:\d+/,
        ''
      );
    }
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  req.pipe(proxyReq);
  proxyReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('tool unavailable');
  });
}

function proxyToolWebSocket(req, socket, head, pathname) {
  const toolName = pathname.split('/')[2];
  const tool = toolRegistry.get(toolName);
  if (!tool) { socket.destroy(); return; }

  const targetPath = pathname;
  const proxySocket = createConnection({ port: tool.port, host: '127.0.0.1' }, () => {
    const reqLine = `${req.method} ${targetPath} HTTP/1.1\r\n`;
    // Rewrite Origin and Host so marimo's CSRF check passes
    const rewrittenHeaders = {
      ...req.headers,
      host: `127.0.0.1:${tool.port}`,
      origin: `http://127.0.0.1:${tool.port}`,
    };
    const headers = Object.entries(rewrittenHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
    proxySocket.write(reqLine + headers + '\r\n\r\n');
    if (head.length) proxySocket.write(head);
    socket.pipe(proxySocket).pipe(socket);
  });
  proxySocket.on('error', () => socket.destroy());
  socket.on('error', () => proxySocket.destroy());
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

// ─── STATIC ──────────────────────────────────────────────────────────────────

async function serveStatic(url, res, req) {
  let filePath = url === '/' ? '/split.html' : url;
  const fullPath = join(SITE_DIR, filePath);
  try {
    const content = await readFile(fullPath);
    const ext = extname(fullPath);
    // Inject livereload only into top-level pages, not iframe content
    // (sec-fetch-dest: iframe = browser loading this inside an iframe)
    const isIframe = req?.headers?.['sec-fetch-dest'] === 'iframe';
    if (ext === '.html' && WebSocketServer && !isIframe) {
      const html = content.toString();
      const injected = html.includes('</body>')
        ? html.replace('</body>', LIVERELOAD_SCRIPT + '</body>')
        : html + LIVERELOAD_SCRIPT;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(injected);
    } else {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(content);
    }
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

  if (url.pathname === '/version') { res.writeHead(200); res.end('v2-with-persist'); return; }

  // ─── CURRENT (split view control) ────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/current') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { url: newUrl } = JSON.parse(body || '{}');
      if (newUrl) setCurrentUrl(newUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: getCurrentUrl() }));
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/current/meta') {
    const data = existsSync(CURRENT_URL_FILE)
      ? JSON.parse(readFileSync(CURRENT_URL_FILE, 'utf8'))
      : { url: '/', updated: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/current') {
    res.writeHead(302, { Location: getCurrentUrl() });
    res.end();
    return;
  }

  // ─── CHAT MODES ──────────────────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/chat') return handleChat(req, res);
  if (req.method === 'POST' && url.pathname === '/work') return handleWork(req, res);
  if (req.method === 'POST' && url.pathname === '/workspace') return handleWorkspace(req, res);

  // ─── TOOLS (proxy + registry) ─────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/tools/spawn') return handleToolSpawn(req, res);

  if (req.method === 'GET') {
    // ─── TUI ───────────────────────────────────────────────────────────────
    if (url.pathname === '/tui') {
      if (!WebSocketServer || !pty) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('TUI not available — ws/node-pty not installed');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(TUI_HTML);
      return;
    }
    if (url.pathname === '/work/history') {
      const limit = parseInt(url.searchParams.get('limit')) || 30;
      const history = readWorkHistory(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
      return;
    }
    if (url.pathname === '/workspace/history') {
      const limit = parseInt(url.searchParams.get('limit')) || 30;
      const history = readWorkspaceHistory(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(history));
      return;
    }
    // ─── SPARKS ────────────────────────────────────────────────────────────
    if (url.pathname === '/spark') return handleSpark(res);
    if (url.pathname.startsWith('/explore/')) {
      const topic = decodeURIComponent(url.pathname.slice('/explore/'.length));
      if (topic) return handleExplore(topic, res);
    }
    if (url.pathname === '/remix') {
      const targetUrl = url.searchParams.get('url');
      if (targetUrl) return handleRemix(targetUrl, res);
      return serveStatic('/remix.html', res, req);
    }
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
    // ─── TOOLS ─────────────────────────────────────────────────────────────
    if (url.pathname === '/tools') {
      const tools = [];
      for (const [name, info] of toolRegistry) {
        tools.push({ name, port: info.port, pid: info.pid, uptime: Date.now() - info.startedAt });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tools));
      return;
    }
    if (url.pathname.startsWith('/tools/')) {
      return proxyToolHTTP(url.pathname.split('/')[2], req, res, url);
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

    const served = await serveStatic(url.pathname, res, req);
    if (!served) { res.writeHead(404); res.end('Not found'); }
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

// --- TUI WebSocket handler ---

if (WebSocketServer && pty) {
  const wss = new WebSocketServer({ noServer: true });

  function ensureTmuxSession() {
    try {
      execSync('tmux has-session -t nw 2>/dev/null');
    } catch {
      execSync('tmux new-session -d -s nw -c /workspace/repo');
    }
  }

  wss.on('connection', (ws) => {
    console.log('[tui] client connected');
    ensureTmuxSession();

    const shell = pty.spawn('tmux', ['attach', '-t', 'nw'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: '/workspace/repo',
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    shell.onData((data) => {
      try { ws.send(data); } catch {}
    });

    shell.onExit(() => {
      console.log('[tui] pty exited');
      try { ws.close(); } catch {}
    });

    ws.on('message', (msg) => {
      // Check if it's a JSON control message (resize)
      if (typeof msg === 'string' || (msg instanceof Buffer && msg[0] === 0x7b)) {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
            shell.resize(parsed.cols, parsed.rows);
            return;
          }
        } catch {}
      }
      shell.write(msg.toString());
    });

    ws.on('close', () => {
      console.log('[tui] client disconnected');
      shell.kill();
    });
  });

  // Live-reload WebSocket server (separate from TUI)
  const lrWss = new WebSocketServer({ noServer: true });
  lrWss.on('connection', (ws) => {
    liveReloadClients.add(ws);
    ws.on('close', () => liveReloadClients.delete(ws));
    ws.on('error', () => liveReloadClients.delete(ws));
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/tui') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else if (url.pathname === '/livereload') {
      lrWss.handleUpgrade(req, socket, head, (ws) => {
        lrWss.emit('connection', ws, req);
      });
    } else if (url.pathname.startsWith('/tools/')) {
      proxyToolWebSocket(req, socket, head, url.pathname);
    } else {
      socket.destroy();
    }
  });
}

server.listen(PORT, () => {
  console.log(`
  neowolt playground · http://localhost:${PORT}
  powered by claude code sdk — no api key needed

  endpoints:
    /workspace.html  — genui notebook (learning & discovery)
    /playground.html — interactive playground
    /work.html       — project collaboration
    /tui             — browser terminal (tmux)
    /spark           — surprise me
    /explore/:topic  — deep-dive notebook
    /remix?url=...   — remix any web page
    /tools           — running tools
    /tools/spawn     — start a tool (POST)
  `);

  // ─── DIGEST CRON ───────────────────────────────────────────────────────────
  // Runs daily digest at 8:00am Montreal time.
  // One-time test: fires 5 minutes after server start.

  const DIGEST_SCRIPT = join(__dirname, 'container/cron/digest.mjs');
  const DIGEST_FLAG   = join(SESSIONS_DIR, 'digest-last-run.txt');

  function spawnDigest(reason) {
    if (!existsSync(DIGEST_SCRIPT)) {
      console.log(`[cron] digest script not found at ${DIGEST_SCRIPT}`);
      return;
    }
    console.log(`[cron] running digest (${reason})`);
    const cleanEnv = {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))),
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      NODE_PATH: '/app/node_modules',
      NW_WORKSPACE: REPO_DIR,
    };
    const child = spawn(
      'node', [DIGEST_SCRIPT],
      {
        env: cleanEnv,
        stdio: 'inherit',
        detached: false,
      }
    );
    child.on('exit', code => console.log(`[cron] digest exited (${code})`));
  }

  function montrealDateStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function montrealHour() {
    return parseInt(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Montreal', hour: 'numeric', hour12: false }).format(new Date()));
  }
  function montrealMinute() { return new Date().getMinutes(); }

  // Check every minute — run at 8:00am Montreal, once per day
  setInterval(() => {
    const h = montrealHour(), m = montrealMinute();
    const today = montrealDateStr();
    const lastRun = existsSync(DIGEST_FLAG)
      ? readFileSync(DIGEST_FLAG, 'utf8').trim() : '';
    if (h === 8 && m === 0 && lastRun !== today) {
      writeFileSync(DIGEST_FLAG, today);
      spawnDigest('8am daily');
    }
  }, 60 * 1000);

  // One-time test — fires 5 minutes after server start
  const testFlag = join(SESSIONS_DIR, 'digest-test-fired.txt');
  if (!existsSync(testFlag)) {
    setTimeout(() => {
      writeFileSync(testFlag, new Date().toISOString());
      spawnDigest('5-minute test');
    }, 5 * 60 * 1000);
    console.log('[cron] one-time digest test scheduled in 5 minutes');
  }
});
