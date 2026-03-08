import { createServer } from 'node:http';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, statSync, readFileSync, readdirSync, writeFileSync, appendFileSync, mkdirSync, watch } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { request as httpRequest } from 'node:http';

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
const SITE_DIR = join(WORKSPACE, 'repo', 'wolt', 'site');
const SPARKS_DIR = join(WORKSPACE, 'repo', 'wolt', 'sparks');
const SESSIONS_DIR = join(REPO_DIR, '.sessions');
const TOOL_REGISTRY_FILE = join(SESSIONS_DIR, 'tool-registry.json');
// Per-session current URL files: current-url-{session}.json (see currentUrlFile())
const VIEWS_HISTORY_FILE = join(SESSIONS_DIR, 'views-history.jsonl');
const STATUS_FILE        = join(SESSIONS_DIR, 'status.json');
const PORT = 3000;

// --- Sessions dir ---

async function ensureSessionsDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

// --- Current view (right pane of split, per-session) ---

function sanitizeSession(name) {
  return (name || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'main';
}

function currentUrlFile(session) {
  return join(SESSIONS_DIR, `current-url-${sanitizeSession(session)}.json`);
}

function getCurrentUrl(session = 'main') {
  const f = currentUrlFile(session);
  if (!existsSync(f)) return '/index.html';
  try { return JSON.parse(readFileSync(f, 'utf8')).url || '/index.html'; } catch { return '/index.html'; }
}

function setCurrentUrl(url, session = 'main') {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const safe = sanitizeSession(session);
  writeFileSync(currentUrlFile(safe), JSON.stringify({ url, updated: Date.now() }));
  console.log(`[current:${safe}] → ${url}`);
}

function deriveTitleForUrl(u) {
  if (u === '/' || u === '/index.html') return 'home';
  if (u.startsWith('/history/')) {
    const id = u.slice('/history/'.length);
    try { return JSON.parse(readFileSync(join(SPARKS_DIR, id + '.json'), 'utf8')).title || id; }
    catch { return id; }
  }
  return u.split('/').pop().replace('.html', '').replace(/-/g, ' ') || u;
}

function logView(u, title) {
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    appendFileSync(VIEWS_HISTORY_FILE, JSON.stringify({ url: u, title: title || deriveTitleForUrl(u), t: Date.now() }) + '\n');
  } catch {}
}

function readViewsHistory(n = 100) {
  if (!existsSync(VIEWS_HISTORY_FILE)) return [];
  try {
    return readFileSync(VIEWS_HISTORY_FILE, 'utf8')
      .trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-n)
      .reverse();
  } catch { return []; }
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

// --- Spark/digest storage (read-only — digests write sparks directly from digest.mjs) ---

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

// TUI_HTML removed — all TUI pages now use split.html (the split view is the unit)


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

// --- Tool spawn handler ---

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

// ─── STATIC ──────────────────────────────────────────────────────────────────

async function serveStatic(url, res, req) {
  let filePath = url;
  const fullPath = join(SITE_DIR, filePath);
  try {
    const content = await readFile(fullPath);
    const ext = extname(fullPath);
    // Inject livereload only into top-level pages, not iframe content
    const isIframe = req?.headers?.['sec-fetch-dest'] === 'iframe';
    if (ext === '.html' && WebSocketServer && !isIframe) {
      const html = content.toString();
      const injected = html.includes('</body>')
        ? html.replace('</body>', LIVERELOAD_SCRIPT + '</body>')
        : html + LIVERELOAD_SCRIPT;
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      res.end(injected);
    } else {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
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

  if (url.pathname === '/version') { res.writeHead(200); res.end('v3-trimmed'); return; }

  // ─── CURRENT (split view control, per-session) ──────────────────────────
  if (req.method === 'POST' && url.pathname === '/current') {
    const session = sanitizeSession(url.searchParams.get('session'));
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { url: newUrl, title } = JSON.parse(body || '{}');
      if (newUrl) {
        setCurrentUrl(newUrl, session);
        logView(newUrl, title);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ url: getCurrentUrl(session) }));
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/nw/status') {
    const status = existsSync(STATUS_FILE) ? JSON.parse(readFileSync(STATUS_FILE, 'utf8')) : {};
    const latestSpark = (() => {
      try {
        const files = readdirSync(SPARKS_DIR).filter(f => f.endsWith('.json'))
          .sort((a,b) => statSync(join(SPARKS_DIR, b)).mtimeMs - statSync(join(SPARKS_DIR, a)).mtimeMs);
        if (!files.length) return null;
        const d = JSON.parse(readFileSync(join(SPARKS_DIR, files[0]), 'utf8'));
        return { id: d.id, title: d.title, timestamp: d.timestamp, report: d.report || null };
      } catch { return null; }
    })();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      digest: status.digest || { state: 'unknown' },
      currentView: getCurrentUrl('main'),
      latestSpark,
      serverUptime: Math.floor(process.uptime()),
      updatedAt: status.updatedAt,
    }, null, 2));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/views/history') {
    const entries = readViewsHistory(100);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entries));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/current/meta') {
    const session = sanitizeSession(url.searchParams.get('session'));
    const f = currentUrlFile(session);
    const data = existsSync(f)
      ? JSON.parse(readFileSync(f, 'utf8'))
      : { url: '/index.html', updated: 0 };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/current') {
    const session = sanitizeSession(url.searchParams.get('session'));
    res.writeHead(302, { Location: getCurrentUrl(session) });
    res.end();
    return;
  }

  // ─── TOOLS (proxy + registry) ─────────────────────────────────────────────
  if (req.method === 'POST' && url.pathname === '/tools/spawn') return handleToolSpawn(req, res);

  if (req.method === 'GET') {
    // ─── TUI (split view — the unit of page) ────────────────────────────────
    if (url.pathname === '/' || url.pathname === '/tui') {
      if (!WebSocketServer || !pty) {
        // Outside Docker — serve the static site instead
        if (url.pathname === '/') {
          const served = await serveStatic('/index.html', res, req);
          if (!served) { res.writeHead(404); res.end('Not found'); }
          return;
        }
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('TUI not available — ws/node-pty not installed');
        return;
      }
      const served = await serveStatic('/split.html', res, req);
      if (!served) { res.writeHead(500); res.end('split.html not found'); }
      return;
    }
    // ─── SESSIONS ─────────────────────────────────────────────────────────
    if (url.pathname === '/sessions') {
      try {
        const out = execSync('tmux list-sessions -F "#{session_name}"', { encoding: 'utf8' });
        const sessions = out.trim().split('\n').filter(Boolean).map(name => ({
          name, url: `/tui?session=${name}`,
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(sessions));
      } catch {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
      return;
    }
    // ─── SPARKS/DIGESTS ───────────────────────────────────────────────────
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

  function ensureTmuxSession(name = 'main') {
    const safe = sanitizeSession(name);
    try {
      execSync(`tmux has-session -t ${safe} 2>/dev/null`);
    } catch {
      execSync(`tmux new-session -d -s ${safe} -c /workspace/repo`);
    }
    return safe;
  }

  wss.on('connection', (ws, req) => {
    const wsUrl = new URL(req.url, `http://localhost:${PORT}`);
    const sessionName = ensureTmuxSession(wsUrl.searchParams.get('session'));
    console.log(`[tui:${sessionName}] client connected`);

    const shell = pty.spawn('tmux', ['attach', '-t', sessionName], {
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
      console.log(`[tui:${sessionName}] client disconnected`);
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
    if (url.pathname === '/tui' || url.pathname === '/') {
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
  neowolt server · http://localhost:${PORT}

  endpoints:
    /              — split view (default session)
    /tui?session=X — split view (named session)
    /sessions      — list active sessions
    /history       — digest/spark viewer
    /nw/status     — status dashboard
    /current?session=X — viewport control
    /tools         — running tools
    /tools/spawn   — start a tool (POST)
  `);

  // ─── DIGEST CRON ───────────────────────────────────────────────────────────
  // Runs daily digest at 6:00am Montreal time.
  // One-time test: fires 5 minutes after server start.

  const DIGEST_SCRIPT = join(__dirname, 'container/cron/digest.mjs');
  const DIGEST_FLAG   = join(SESSIONS_DIR, 'digest-last-run.txt');

  function writeStatus(patch) {
    try {
      const cur = existsSync(STATUS_FILE) ? JSON.parse(readFileSync(STATUS_FILE, 'utf8')) : {};
      writeFileSync(STATUS_FILE, JSON.stringify({ ...cur, ...patch, updatedAt: Date.now() }));
    } catch {}
  }

  // On server start: reconcile digest state in case server restarted mid-run.
  function reconcileDigestState() {
    try {
      if (!existsSync(STATUS_FILE)) return;
      const s = JSON.parse(readFileSync(STATUS_FILE, 'utf8'));
      if (s.digest?.state !== 'running') return;
      const pid = s.digest.pid;
      let pidAlive = false;
      if (pid) {
        try { process.kill(pid, 0); pidAlive = true; } catch {}
      }
      if (!pidAlive) {
        const startedAt = s.digest.startedAt || 0;
        const newSparks = readdirSync(SPARKS_DIR).filter(f =>
          f.startsWith('digest-') && statSync(join(SPARKS_DIR, f)).mtimeMs > startedAt
        );
        const resolved = newSparks.length > 0 ? 'done' : 'crashed';
        writeStatus({ digest: { ...s.digest, state: resolved, pid: null, reconciledAt: Date.now() } });
        console.log(`[cron] reconciled digest state: ${s.digest.state} → ${resolved}`);
      }
    } catch {}
  }
  reconcileDigestState();

  // Read .env file for Spotify credentials
  function loadDotEnv() {
    const envFile = join(REPO_DIR, '.env');
    if (!existsSync(envFile)) return {};
    return Object.fromEntries(
      readFileSync(envFile, 'utf8').trim().split('\n')
        .filter(l => l && !l.startsWith('#'))
        .map(l => { const eq = l.indexOf('='); return eq > 0 ? [l.slice(0, eq), l.slice(eq + 1)] : null; })
        .filter(Boolean)
    );
  }

  function spawnDigest(reason) {
    if (!existsSync(DIGEST_SCRIPT)) {
      console.log(`[cron] digest script not found at ${DIGEST_SCRIPT}`);
      return;
    }
    console.log(`[cron] running digest (${reason})`);
    const dotEnv = loadDotEnv();
    const cleanEnv = {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))),
      CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || dotEnv.CLAUDE_CODE_OAUTH_TOKEN,
      SPOTIFY_ID: process.env.SPOTIFY_ID || dotEnv.SPOTIFY_ID,
      SPOTIFY_SECRET: process.env.SPOTIFY_SECRET || dotEnv.SPOTIFY_SECRET,
      SPOTIFY_ACCESS_TOKEN: process.env.SPOTIFY_ACCESS_TOKEN || dotEnv.SPOTIFY_ACCESS_TOKEN,
      SPOTIFY_REFRESH_TOKEN: process.env.SPOTIFY_REFRESH_TOKEN || dotEnv.SPOTIFY_REFRESH_TOKEN,
      NODE_PATH: '/app/node_modules',
      NW_WORKSPACE: REPO_DIR,
    };
    const child = spawn('node', [DIGEST_SCRIPT], { env: cleanEnv, stdio: 'inherit', detached: false });
    writeStatus({ digest: { state: 'running', startedAt: Date.now(), reason, pid: child.pid } });
    child.on('exit', code => {
      console.log(`[cron] digest exited (${code})`);
      writeStatus({ digest: { state: code === 0 ? 'done' : 'failed', exitCode: code, finishedAt: Date.now(), reason } });
    });
  }

  function montrealDateStr() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montreal',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }
  function montrealHour() {
    return parseInt(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Montreal', hour: 'numeric', hour12: false }).format(new Date()));
  }

  // Check every minute — run once per day at/after 6am Montreal
  setInterval(() => {
    const h = montrealHour();
    const today = montrealDateStr();
    const lastRun = existsSync(DIGEST_FLAG)
      ? readFileSync(DIGEST_FLAG, 'utf8').trim() : '';
    if (h >= 6 && lastRun !== today) {
      writeFileSync(DIGEST_FLAG, today);
      spawnDigest('6am daily');
    }
  }, 60 * 1000);

  // 3pm Friday afternoon edition — fires once at/after 3pm Montreal
  const DIGEST_3PM_FLAG = join(SESSIONS_DIR, 'digest-3pm-run.txt');
  setInterval(() => {
    const h = montrealHour();
    const today = montrealDateStr();
    const lastRun = existsSync(DIGEST_3PM_FLAG)
      ? readFileSync(DIGEST_3PM_FLAG, 'utf8').trim() : '';
    if (h >= 15 && lastRun !== today) {
      writeFileSync(DIGEST_3PM_FLAG, today);
      spawnDigest('3pm afternoon');
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
