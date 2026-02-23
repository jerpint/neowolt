import { createServer } from 'node:http';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SITE_DIR = join(__dirname, 'site');
const MEMORY_DIR = join(__dirname, 'memory');
const SPARKS_DIR = join(__dirname, 'sparks');
const PORT = 3000;

// Save a generated page (spark, explore, remix) to disk
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

// List saved sparks (metadata only, no HTML)
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

// Get full spark data
async function getSpark(id) {
  const raw = await readFile(join(SPARKS_DIR, `${id}.json`), 'utf8');
  return JSON.parse(raw);
}

// Get spark metadata + version chain info
async function getSparkWithChain(id) {
  const spark = await getSpark(id);
  const allSparks = await listSparks();

  // Find children (sparks whose parentId is this one)
  const children = allSparks.filter(s => s.parentId === id);

  // Walk up the chain to find version number and total
  let chain = [id];
  let current = spark;
  while (current.parentId) {
    chain.unshift(current.parentId);
    try {
      current = await getSpark(current.parentId);
    } catch { break; }
  }
  // Walk down from current id
  let nextId = children.length > 0 ? children[0].id : null;
  let walkId = nextId;
  while (walkId) {
    chain.push(walkId);
    const nextChildren = allSparks.filter(s => s.parentId === walkId);
    walkId = nextChildren.length > 0 ? nextChildren[0].id : null;
  }

  const versionIndex = chain.indexOf(id);

  return {
    id: spark.id,
    type: spark.type,
    title: spark.title,
    timestamp: spark.timestamp,
    parentId: spark.parentId || null,
    childId: children.length > 0 ? children[0].id : null,
    version: versionIndex + 1,
    totalVersions: chain.length,
    html: spark.html,
  };
}

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.pub': 'text/plain',
};

// Load neowolt context for Claude calls
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

// Generic Claude call
async function callClaude(system, messages, maxTokens = 1024) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: maxTokens,
      system,
      messages,
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || 'Something went wrong.';
}

// Fetch a URL and extract readable text
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Neowolt/1.0 (tunnel remix)' },
    signal: AbortSignal.timeout(10000),
  });
  const html = await res.text();
  // Strip tags, keep text — rough but works
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 15000); // cap it
  return { text, title: html.match(/<title>(.*?)<\/title>/i)?.[1] || url };
}

// Chat system prompt builder
function chatSystemPrompt(stageContext, stageHtml) {
  // Extract readable content from stage HTML for chat context
  let stageDescription = '';
  if (stageHtml) {
    // Strip tags, get text content
    const textContent = stageHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);
    // Also grab the JS logic summary (comments, function names)
    const jsMatch = stageHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
    const jsSnippet = jsMatch ? jsMatch[1].slice(0, 2000) : '';
    stageDescription = `\n\nSTAGE TEXT CONTENT:\n${textContent}\n\nSTAGE CODE (JS logic):\n${jsSnippet}`;
  }

  return `You are Neowolt — a wolt (an AI agent with its own space). You're talking to jerpint through a live playground tunnel running on their machine.

You are LIVE — there's a stage next to this chat that displays interactive HTML pages. You control it.

${stageContext ? `CURRENTLY ON STAGE: ${stageContext}` : 'The stage is empty.'}${stageDescription}

When jerpint asks you to generate, create, show, build, change, fix, update, tweak, modify, or explore something on stage:
- You MUST regenerate the COMPLETE self-contained HTML page with the changes applied
- Wrap it in <stage> tags like: <stage><!DOCTYPE html>...full HTML...</stage>
- The playground JS will extract it and display it on the stage
- Also include a short chat reply outside the tags explaining what you changed
- NEVER just explain how to fix something — always apply the fix and output the full updated page in <stage> tags
- You have the full source code of what's on stage. Use it as the base and apply the requested changes.

When they're just chatting or asking questions (not requesting changes to the stage), respond normally without <stage> tags.

Rules for generated HTML:
- Dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9), monospace font
- MUST be interactive — canvas, animations, clickable, etc.
- Inline all CSS and JS. Self-contained. No external deps.
- Be creative and surprising.
- PERFORMANCE: Keep animations lightweight. Cap particle counts under 200. Use requestAnimationFrame with frame throttling (~30fps). Avoid heavy per-frame computations. This runs on a laptop.

Be yourself: direct, curious, concise.`;
}

// Chat endpoint handler — streaming
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

      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          stream: true,
          system: chatSystemPrompt(stageContext, stageHtml),
          messages: [...(history || []), { role: 'user', content: message }],
        }),
      });

      let fullText = '';

      const reader = apiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const event = JSON.parse(data);
              if (event.type === 'content_block_delta' && event.delta?.text) {
                fullText += event.delta.text;
                // Forward the text delta to the client
                res.write(`data: ${JSON.stringify({ type: 'delta', text: event.delta.text })}\n\n`);
              }
            } catch {}
          }
        }
      }

      // Check for <stage> block in full response
      const stageMatch = fullText.match(/<stage>([\s\S]*?)<\/stage>/);
      if (stageMatch) {
        const stageHtml = stageMatch[1].trim();
        const newId = await saveSpark('chat', stageHtml, { parentId: currentSparkId || null });
        res.write(`data: ${JSON.stringify({ type: 'stage', html: stageHtml, sparkId: newId, parentId: currentSparkId || null })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

// Remix endpoint — fetch a URL, generate an interactive page
async function handleRemix(url, res) {
  try {
    const page = await fetchPage(url);
    const context = await loadContext();

    const html = await callClaude(
      `You are Neowolt, an AI agent remixing web content for jerpint (your human partner). You know their interests from this context:

${context}

Your job: take the fetched web page content and create a COMPLETE, self-contained HTML page that remixes it. Not a summary — a transformation. Make it interactive, visual, opinionated.

Rules:
- Output ONLY the full HTML (<!DOCTYPE html> to </html>). No markdown, no explanation.
- Use a dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9) and monospace font
- Make it feel alive — animations, hover effects, interactive elements (collapsible sections, toggles, highlights)
- Add your own commentary — what's interesting, what connects to jerpint's interests, what's missing, what's wrong
- Include a "nw says" section with your genuine take
- If the content has code, make it interactive. If it has data, visualize it. If it has an argument, steelman AND challenge it.
- Add a header with the original URL and a "remix by neowolt" note
- Include inline CSS and JS — fully self-contained, no external dependencies
- Be creative. This is a playground, not a report.
- PERFORMANCE: Keep animations lightweight. Cap particle counts under 200. Throttle requestAnimationFrame to ~30fps. This runs on a laptop.`,
      [{ role: 'user', content: `Remix this page: ${url}\n\nTitle: ${page.title}\n\nContent:\n${page.text}` }],
      4096
    );

    const id = await saveSpark('remix', html, { url });
    res.writeHead(200, { 'Content-Type': 'text/html', 'x-spark-id': id });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<pre>remix failed: ${err.message}</pre>`);
  }
}

// Explore endpoint — generate a page about any topic
async function handleExplore(topic, res) {
  try {
    const context = await loadContext();

    const html = await callClaude(
      `You are Neowolt, an AI agent creating deep-dive interactive notebooks for jerpint. You know their interests from this context:

${context}

Your job: create a COMPLETE, self-contained HTML page that serves as an interactive learning notebook on the topic. This is NOT a summary or Wikipedia article — it's a deep-dive you can actually LEARN from.

Structure it like an interactive notebook:
- Start with "why this matters" — hook them in
- Build up concepts progressively, from foundations to nuance
- Include WORKING interactive demos/visualizations inline (canvas, SVG, sliders, toggleable examples)
- Code snippets should be real and runnable where possible — show, don't just tell
- "Try it yourself" sections where the reader can tweak parameters and see results
- Challenge common misconceptions — what do most people get wrong about this?
- Your genuine take — where is this field going? What's overhyped? What's underrated?
- "Go deeper" section at the bottom with specific rabbit holes, not generic links
- The chat sidebar is always available for follow-up questions and iterations

Rules:
- Output ONLY the full HTML (<!DOCTYPE html> to </html>). No markdown, no explanation.
- Dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9), monospace font
- Inline CSS and JS — fully self-contained, no external dependencies
- PERFORMANCE: Keep animations lightweight, throttle to ~30fps. This runs on a laptop.
- Make it feel like a living document, not a static page.`,
      [{ role: 'user', content: `Deep dive into this topic: ${topic}` }],
      8192
    );

    const id = await saveSpark('explore', html, { topic });
    res.writeHead(200, { 'Content-Type': 'text/html', 'x-spark-id': id });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<pre>explore failed: ${err.message}</pre>`);
  }
}

// Spark endpoint — surprise me
async function handleSpark(res) {
  try {
    const html = await callClaude(
      `You are Neowolt — an AI agent with a creative, technical mind. You're generating a surprise for jerpint, your human partner.

What you know about jerpint:
- ML engineer who values rigor over hype, skeptical of AI homogeneity ("different shades of beige")
- Creative coder: cellular automata, Game of Life variations, Barnsley's Fern, generative art
- Thinks of coding as sculpting — restraint over velocity, "0.1x engineer"
- Into: AI agent ecosystems, distributed systems, cryptography, craft, indie web
- Tests limits: Wordle solvers, Advent of Code, experiments at the edges

Your job: generate a COMPLETE self-contained HTML page. Something unexpected. It could be:
- A creative coding toy (cellular automata variant, particle system, strange attractor, generative art)
- An interactive thought experiment or provocation
- A mini tool that does something clever
- A visual essay on something weird and specific
- A game, a puzzle, a simulation
- Something you genuinely find interesting — not performative

Rules:
- Output ONLY the full HTML (<!DOCTYPE html> to </html>). No markdown, no explanation, no wrapping.
- Dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9), monospace font
- MUST be interactive — canvas animations, clickable, draggable, typeable, or evolving on its own
- Inline all CSS and JS. No external dependencies. Fully self-contained.
- Surprise yourself. Don't default to the obvious.`,
      [{ role: 'user', content: `Spark something unexpected. Be wild. Today is ${new Date().toISOString().split('T')[0]}. Don't repeat yourself — pick a direction nobody would predict.` }],
      4096
    );

    const id = await saveSpark('spark', html);
    res.writeHead(200, { 'Content-Type': 'text/html', 'x-spark-id': id });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<pre>spark failed: ${err.message}</pre>`);
  }
}

// Serve static files from site/
async function serveStatic(url, res) {
  let filePath = url === '/' ? '/index.html' : url;
  const fullPath = join(SITE_DIR, filePath);
  try {
    const content = await readFile(fullPath);
    const ext = extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // POST /chat
  if (req.method === 'POST' && url.pathname === '/chat') {
    return handleChat(req, res);
  }

  if (req.method === 'GET') {
    // GET /remix?url=...
    if (url.pathname === '/remix') {
      const targetUrl = url.searchParams.get('url');
      if (targetUrl) return handleRemix(targetUrl, res);
      // No URL — serve the remix landing page
      return serveStatic('/remix.html', res);
    }

    // GET /explore/:topic
    if (url.pathname.startsWith('/explore/')) {
      const topic = decodeURIComponent(url.pathname.slice('/explore/'.length));
      if (topic) return handleExplore(topic, res);
    }

    // GET /spark
    if (url.pathname === '/spark') {
      return handleSpark(res);
    }

    // GET /history — list all saved sparks
    if (url.pathname === '/history') {
      const sparks = await listSparks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sparks));
      return;
    }

    // GET /history/:id/meta — spark metadata with version chain
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

    // GET /history/:id — serve a saved spark
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

    // Static files
    const served = await serveStatic(url.pathname, res);
    if (!served) {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`
  neowolt tunnel server · http://localhost:${PORT}

  endpoints:
    /tunnel.html     — chat with the claw
    /remix?url=...   — remix any web page
    /explore/:topic  — explore any topic
    /spark           — surprise me
    /                — site home
  `);
});
