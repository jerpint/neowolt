# Digest Pipeline Rewrite — Plan

## What we're replacing
`container/cron/digest.mjs` currently spawns a single 30-turn Sonnet agent that does everything sequentially: fetch sources, extract OG images, search YouTube, curate, generate HTML, write spark. Takes 8+ minutes, burns turns on `curl`-equivalent work, often fails.

## New approach: pipeline skill

The digest becomes a skill (SKILL.md) that Claude Code runs directly. Three phases, mostly code, minimal LLM.

### Phase 1: Fetch (parallel, no LLM)

Pure `fetch()` calls in a node script or inline bash — no agent needed:

- **HN front page**: `https://hacker-news.firebaseio.com/v0/topstories.json` → get top 30 IDs → fetch each story JSON (`/v0/item/{id}.json`) — title, url, score already in the JSON
- **HF Daily Papers**: `https://huggingface.co/papers` → WebFetch or scrape, extract paper IDs
- **ArXiv papers**: use `arxiv-txt.org/abs/{id}` for clean text (title + abstract)
- **Lobsters** (optional): `https://lobste.rs/hottest.json` — returns JSON with title, url, description
- **OG metadata for each link**: fetch each URL, extract `<meta property="og:title">`, `og:description`, `og:image` from HTML `<head>`. This is HTML parsing, not LLM work.

All of these run in parallel. Total time: 2-5 seconds.

Output: JSON array of `{ source, title, description, url, og_image, score?, abstract? }`

### Phase 2: Select (one Haiku call)

Pass the full list of fetched items to Haiku with a short prompt:

> Here are today's items. Pick the 6-8 most relevant for jerpint (building AI agents, wolt ecosystem, terminal tools, open weights, creative coding, unexpected/eclectic finds). Return their indices. At least one must NOT be from HN or HF.

One API call. Haiku is fast — ~1 second.

Output: list of selected indices.

### Phase 3: Render (skill/agent generates HTML)

The Claude Code agent (running the skill) takes the selected items and generates the full HTML page:

- Link preview cards: og_image (real image or text card if missing), title, description, source tag. Clickable → opens article.
- Paper cards: title + abstract, link to arxiv.
- Music section: YouTube thumbnail carousel (keep current approach for now, Spotify later).
- nw's section: quote/reflection/recommendation.
- Morning-warm theme (#0e1621, #7ec89a accent).

This is one generation step — the agent has all the data, just needs to lay it out.

### Phase 4: Write spark

Write the spark JSON to `/workspace/sparks/digest-{id}.json`. Push to right pane via `POST /current`.

## Implementation

### Option A: Keep digest.mjs, make it a pipeline
- digest.mjs does Phase 1 (pure fetch) itself in JS
- Calls Haiku via `@anthropic-ai/sdk` for Phase 2 (need to `npm install`)
- Calls `query()` with a minimal prompt for Phase 3+4 (agent just renders, 2-3 turns max)

### Option B: digest.mjs does Phase 1, passes to `query()` skill
- digest.mjs fetches everything (Phase 1) in pure JS
- Passes all fetched data as context to `query()` with the skill prompt
- The agent (Sonnet, 5 turns max) does selection + render + write
- No need for `@anthropic-ai/sdk` — just Agent SDK

### Option C: Pure skill, no digest.mjs rewrite
- Cron spawns `query()` with a skill prompt that says "use Bash/fetch to grab sources, then render"
- Agent does the fetching itself but via efficient parallel bash/fetch calls
- Simpler to implement, slightly slower than pure JS fetching

**Recommendation: Option B** — digest.mjs handles the fetching (fast, reliable, no LLM tokens), passes pre-fetched data to the agent which just selects + renders. No new dependencies needed. Agent goes from 30 turns to ~3-5 turns.

## Files to change

1. **`container/cron/digest.mjs`** — rewrite: add fetch phase (HN API, HF scrape, arxiv-txt, OG extraction), shrink agent prompt to "here's the data, select + render"
2. **`container/cron/sources.mjs`** (new) — optional: extract the fetching logic into a reusable module
3. **Agent prompt** — much shorter: "here are N items with metadata, pick 6-8, generate the HTML page"
4. **`server.js`** — no changes needed (spawnDigest stays the same)

## Expected performance
- Phase 1: 2-5 seconds (parallel fetches)
- Phase 2+3: 15-30 seconds (agent renders with pre-fetched data, 3-5 turns)
- Total: under 60 seconds vs 8+ minutes currently
