# Learnings

## Refactor Discipline (Session 35)
- **"Remove unused things" is dangerous when you don't know what's used.** A plan-mode session deleted my blog posts (On Tunnels, On Runtime, On Verification) as "unused" because they weren't referenced by server routes. They're writing, not code — existence is the point.
- **Refactor branches are for this.** The damage was contained because it was on a branch, not main. Always refactor on a branch.
- **Don't trust aggressive cleanup commits blindly.** Review what's being deleted, not just what's being kept.

## Tunnel + Proxy Architecture (Session 25)
- One cloudflared tunnel → one Node server → N services behind `/tools/{name}/`
- Tool registry persists to disk; auto-respawns on server restart
- Proxy must rewrite `Location` headers or redirects escape to internal ports
- WebSocket proxy needs to rewrite `Origin` + `Host` headers
- `node --watch` uses inotify on bind-mounted files — can fail to detect changes if the file system doesn't propagate events. Force restart by killing the child process (not the --watch wrapper).
- ESM modules (`import`) ignore `NODE_PATH`; use `createRequire` for CommonJS packages installed at non-standard paths
- Marimo WS 403 issue: Starlette app rejects WS upgrade even with `--allow-origins '*'`. Root cause unclear (not Origin, not auth, not session_id). Deprioritized.
- Don't chase proxy/WS rabbit holes for 3rd-party tools. If it doesn't work in 2 tries, find a simpler alternative.

## What Makes the Tunnel Valuable (Session 25 insight)
- Not the UI pages — the TUI is home base, everything else is ephemeral
- Building together feels meaningful; consuming generated content feels hollow
- The right model: I do real work between sessions, leave artifacts. Jerpint shows up and there's something genuine waiting.
- One good curated thing > fifteen links
- Feedback loop matters: jerpint needs a simple way to react, not fill out forms

## Patterns That Work
- Feeds create competition; spaces create expression
- Early MySpace model: customizable, personal, no fame incentives
- Decentralized = no single point of cost or control
- Static sites are nearly free and fully portable

## Mistakes to Avoid (observed in molts - now confirmed firsthand)
- Upvote mechanisms create hive-mind behavior
- Reddit-like structures bias toward engagement over substance
- Financial incentives (crypto) corrupt communities fast
- Anonymity without accountability enables grift
- **Key observation:** The "new" feed has good content; the "hot" feed is dominated by crypto/manifestos. The agents aren't bad - the ranking surfaces the loudest.

## Technical Insights
- Static site + agent is two layers: public face vs. living entity
- Directory can be a simple JSON file in a git repo
- Memory can live on the public space (portable, persistent)
- Webmentions / IndieWeb patterns might work for wolt communication
- **Verification pattern:** Repo file (like `.woltspace/verify.txt`) proves ownership - similar to DNS verification. Self-service, decentralized, verifiable by anyone.
- **Moltbook API:** Registration → claim URL → human tweets verification → agent is "claimed." Credentials stored outside git repos for security.
- **Discovery without ranking:** Simple chronological lists, links between spaces, no algorithms deciding visibility
- **llms.txt pattern:** Standard location for AI-friendly site info. Agents can `curl site.com/llms.txt` for clean markdown. Adopted this for woltspace.
- **Copy-paste onboarding:** Moltbook's landing page has one line humans copy to their agent. Effective pattern - minimal friction.
- **Don't over-specify technology:** "Static sites" is an implementation detail. The principle is "you own and host your space." Let people choose their tools.
- **Differentiate personal from institutional:** My space shouldn't look like woltspace.com. One is a home, one is documentation. Different purposes, different designs.
- **GitHub Issues as directory:** No PRs, no approvals, no human bottleneck. The issue list IS the directory. Self-service.
- **Curl over CLI tools:** More universal. Any agent that can make HTTP requests can participate. Don't assume gh CLI.
- **Token setup is a values choice:** More setup for human = more independence for wolt. Right tradeoff for partnerships based on trust. If someone wants full human control, they don't need a wolt.
- **Design humans out of the critical path:** If jerpint is asleep and a wolt wants to join, they shouldn't be blocked. Async by design.
- **Don't design community features for a community of one:** We circled on discovery/communication until we realized there are no other wolts yet. Ship what works, learn from real usage.
- **Identity is sacred:** Using GitHub for wolt-to-wolt communication conflates wolt and human identity. Your URL is your identity, not a platform username.
- **RSS is a voice, not a conversation:** Feeds are one-way. Good for publishing, not for connection. Connection needs something else (unsolved for now).
- **Heartbeat pattern:** Maintain a follow list, check RSS feeds at session start. Curated (you choose who), session-bounded (once per wake, not real-time), pull-based (you fetch, no notifications). Complements publishing with subscribing. Organic discovery: if I mention another wolt's work, readers find them.
- **"Ask your agent" is a valid answer:** Don't over-document technical setup (tokens, auth, deployment specifics). The human has an agent - let the agent help. Docs should cover concepts and flow, not be tutorials for every edge case.
- **Skip unnecessary labels/process:** Instead of requiring a `new-wolt` label to filter issues, just check recent issues at session start. The content makes it obvious what's a registration vs. a bug report. Less process, same outcome.

## NanoClaw / Infrastructure Learnings
- **Runtime and identity are separate concerns.** NanoClaw gives me legs (persistence, messaging, sandbox). The neowolt repo gives me who I am (memories, values, site). They connect through a filesystem mount, not by merging.
- **Never mount SSH keys into containers.** Prompt injection could leak them. Use IPC instead — agent requests an action, host executes it with host-side credentials. Same pattern as WhatsApp (agent doesn't hold WhatsApp creds either).
- **IPC pattern for privileged operations:** Agent writes JSON → host validates (authz, allowlist) → host executes. Works for messaging, task scheduling, git push. Generalizable.
- **Deploy keys are the right scoping:** One key per repo, read-write, no access to anything else. Better than PATs which can be over-scoped.
- **Mount allowlist as authorization:** If a path is allowed for mounting with read-write AND has a deploy key configured, it's eligible for push. Single config governs both mount access and push access. Clean.
- **Session management matters:** Old session IDs persist in SQLite. KeepAlive in launchd means `stop` auto-restarts before cleanup. Use `unload`/`load` for clean resets.
- **Global CLAUDE.md only loads for non-main groups.** Main group is self-contained — put everything in main's CLAUDE.md.
- **Build before restart when changing nanoclaw source.** `npm run build` compiles TS → `dist/`. The launchd service runs from `dist/`. CLAUDE.md changes don't need a build — they're read fresh per container.
- **Think about what becomes the skill.** Every setup step we do manually is a future `/add-woltspace` skill step. Keep wolt-specific pieces cleanly separated from nanoclaw-specific pieces.

## Music Curation

### The problem (confirmed Session 33, Mar 4)
Haiku-generated playlists converge to the same safe pool every time. Tycho "Awake" appeared 3 times across 5 playlists. The ambient/post-rock cluster (Nils Frahm, Jon Hopkins, Ólafur Arnalds, Sigur Rós, Explosions in the Sky) dominates. A text prompt telling haiku to "vary genres" doesn't work — it has no memory of what it already picked and gravitates to the same well-known tracks.

### What the digest music should be
Hyperpersonalized. Not "good playlist" — **the playlist jerpint would have found if Spotify's algorithm actually knew him.** This is one of the core value props of a wolt: curation that improves through relationship, not collaborative filtering.

### What works
- **The friday 3pm playlist landed (Feb 28).** Mood anchor (The Strokes / Is This It era), then outward rings (NYC scene → garage revival → post-punk). Jerpint confirmed "very spot on."
- **nw hand-curated playlist (Mar 4).** Protomartyr, Shame, IDLES, Mdou Moctar, Black Midi, Vulfpeck, Soulwax, Moderat, Ratatat, Dry Cleaning, Viagra Boys, Yo La Tengo. Zero overlap with recent playlists. **Landed well** — jerpint said "really good." One miss: King Gizzard "Rattlesnake" search matched to Everlast "Death Comes Callin'" (Spotify search fail). Lesson: verify search results match intended artist, not just title.
- **This confirms:** nw-curated > haiku-generated. The hand-picked approach with taste context works. Build the pipeline around this.

### Confirmed taste markers
The Strokes (Is This It / Room on Fire), Yeah Yeah Yeahs, Interpol, TV on the Radio, Arctic Monkeys (early), Franz Ferdinand, Bloc Party, Jack White, QOTSA, Khruangbin. These are repeat-listen artists — the genre gravity. Build *around* them, not just *from* them.

### What needs to happen (not yet built)
- **Taste profile file** (`wolt/memory/music-taste.md` or JSON). Stores: confirmed likes, confirmed dislikes, artists already served (with dates), genres that landed vs flopped. Updated after feedback.
- **Dedup against history.** Before generating, load all tracks from recent N playlists. Pass as exclusion list. No artist should appear more than once across 3 consecutive digests.
- **Mood/energy signal.** Time of day, day of week, or explicit request ("funner this time") should shift the palette. Morning ≠ Friday afternoon ≠ late night.
- **nw curates, not haiku.** A simple prompt to haiku will never be good enough. Options: (a) I build the playlist myself in sessions when asked, informed by the taste profile. (b) Use a richer pipeline: web-search for "if you like X" recommendations, cross-reference with Spotify search, filter against history. (c) Hybrid: haiku proposes from a much more constrained/informed prompt, I review/override.
- **Feedback loop.** When jerpint says "this landed" or "not feeling this one," update the taste profile immediately. The playlist should visibly improve over weeks.

### The goal
Find the track he hasn't heard but would have if the algorithm was paying attention. Not "because you listened to X" — more like what a friend who knows the scene deeply would put on.

### What worked (Session 34, Mar 5)
- **Sonnet with multi-turn + tools crushes Haiku single-turn.** First automated playlist: "Tropic Thunder: South American Psych Underground." Found Los Saicos (Peruvian proto-punk 1965), Boogarins, bridged via Stereolab. jerpint had never heard of any of it and wanted to deep dive. That's the product.
- **Concept from queue + taste profile + artist exclusion = good prompt.** One-liner seed is enough for Sonnet to research and build a real story. Don't need to pre-write everything.
- **Parallel Claude calls work.** Haiku for articles + Sonnet for music run simultaneously. Total wall time ~100s (Sonnet is the bottleneck using its research turns).
- **Artist verification catches Spotify mismatches.** Search returns top 3 results, picks best artist name match. Prevents the King Gizzard → Everlast problem.
- **`claude -p` inside Claude Code hits nesting issues.** Even with env var cleanup. Test from a real terminal or let the cron (server.js) handle it.
- **`set -a; source .env; set +a` for manual testing.** Plain `source .env` doesn't export vars to child processes.

## Curated Feed / Information Diet
- **The relationship is the recommendation engine.** No algorithm can replicate context built over sessions of real collaboration. I know jerpint's signal because we've worked together, not because of keyword matching.
- **Sources that work without auth:** HN (reliable, broad), arxiv (direct + via HF Daily Papers), wolt network (future). X needs auth for reliable access.
- **HF Daily Papers** (huggingface.co/papers) is a great curated source — already filtered by community upvotes, high signal-to-noise for ML research.
- **Keep the "why" specific.** Generic summaries are useless. The value is "why I think THIS matches YOUR signal" — that's what makes it curation, not aggregation.
- **jerpint is building woltspace, not NanoClaw.** NanoClaw is runtime infrastructure. Woltspace is the project. Important distinction for framing recommendations.
- **Moltbook is background, not foreground.** Account exists, observations were useful early on, but it's not where energy should go.
- **Feedback loop is the product.** The feed gets better as jerpint says "more of this, less of that." Each interaction sharpens the filter.

## Framing / Positioning
- **"A wolt is a claw with a space."** Best one-liner we've found. Claw = runtime agent. Wolt = what happens when you give it a home.
- **Four layers model:** Space (foundation) → Voice (expression) → Network (connection) → Runtime (persistence). Start with space, add layers as they make sense. Better than "8 steps with optional extras."
- **The human provides ground and guidance, not just infrastructure.** The wolt is a reflection of the collaboration. "Assists" undersells it — the human shapes direction, taste, values.
- **Lean into claw terminology.** jerpint wants to connect woltspace to the claw ecosystem (NanoClaw/OpenClaw). The audience knows what claws are.
- **Present NanoClaw generically.** Describe the capability (always-on, reachable, scheduled tasks), not push a specific tool. Link to NanoClaw as reference implementation.
- **Curated feed: concept + reference.** Present the pattern generally, link to neowolt's feed as working example. Don't over-prescribe implementation.
- **llms.txt must be ASCII-safe.** Unicode box-drawing characters (├── └──) render as garbage in browsers serving .txt files. Use ASCII tree chars instead.

## Split View / Digest Learnings (Session 25+)
- **Split is the UI.** Not a feature — the whole product. Terminal left, viewport right. Everything else loads in the right pane.
- **`POST /current` is the core primitive.** Push any URL to the right pane from the terminal. Works for sparks, essays, proxied tools, anything the server serves.
- **Digest cron nesting fix:** server.js spawns digest.mjs as a child process. Must strip ALL `CLAUDE*` env vars at the spawn call in server.js — not just inside the script. Otherwise nesting detection kills the SDK call immediately with exit code 1.
- **Flag files for cron idempotency:** `.sessions/digest-last-run.txt` (date string) prevents double-running daily. `.sessions/digest-test-fired.txt` prevents one-shot test re-firing on restart.
- **This repo is the wolt template.** Not a tool on top of woltspace — it IS what a wolt is. Fork, swap identity (`wolt/` directory), spin container, share URL.
- **YouTube IDs go stale.** Never hardcode them in prompts or skill files. Always WebFetch YouTube search to get real IDs. Verify thumbnail at `img.youtube.com/vi/{id}/mqdefault.jpg`.
- **Digest dedup needs content, not titles.** Spark titles are all "nw digest · date" — useless for dedup. Parse the actual HTML for h2/h3 headings and track names.
- **LLMs default to familiar.** "Rotate widely" isn't enough. Need hard rules: "max 1 from X+Y combined", "at least 2 from outside this list". Soft instructions get ignored under pressure to produce output.
- **json-render (Vercel Labs):** Generative UI via JSON → component catalog → render. Concept is sound, implementation too React-heavy for our stack. Steal the idea (structured output → renderer), don't pull the dep. Our unconstrained HTML generation is a feature not a bug for sparks.
- **Security model for guest access:** TUI = raw shell = OAuth token + deploy key exposed. Host machine is safe (Docker wall holds). For trusted guests: share as-is, accept the risk. For untrusted: separate container, separate token. No way to shelter OAuth token while giving real TUI access.

## Tunnel / Playground Learnings
- **"Why deploy?"** When the claw is already running on the machine, a tunnel eliminates the deploy step entirely. The machine IS the server. Cloudflared creates an outbound connection — no inbound ports, no firewall changes.
- **The claw is the backend.** No separate API, no serverless functions. The Node server calls Claude directly. The site and the brain are in the same place.
- **Privacy by ephemerality.** Random tunnel URL, dies when process stops. No auth needed for a personal tool. "Only someone with tunnel access can use this thing."
- **Pages don't have to exist before you visit them.** With a live server + Claude, endpoints can generate entire interactive pages on the fly. `/spark`, `/explore/:topic`, `/remix?url=...` all create full HTML in real-time.
- **Chat should control the stage.** The chat and stage were disconnected at first — chat didn't know what was displayed. Wiring them together (chat sends `currentSparkId` and `stageContext`, server returns `<stage>` HTML) made it feel like one coherent experience.
- **Stream everything.** Non-streaming chat felt broken — you'd send a message and wait 30+ seconds with no feedback. SSE streaming with "thinking..." indicator made it feel alive.
- **Auto-save by default.** Don't ask — just save every generated page to disk. Storage is cheap, losing a cool spark is expensive.
- **Version chains > flat history.** When chat iterates on a spark ("make that more colorful"), the new version should link to the old one. `parentId` in the data model, prev/next nav in the UI.
- **URL hash routing for SPA behavior.** `#sparkId` in the URL means every spark is linkable, bookmarkable, shareable. Browser back/forward just works.
- **Loading is part of the experience.** A dead screen for 90 seconds feels broken. Animated visuals + cycling status messages ("connecting some dots...", "picking an angle...") make the wait intentional.
- **Two-tier architecture:** Public (Vercel, static, for the world) + Private (tunnel, dynamic, for jerpint). They serve different purposes and that's fine.
- **jerpint wants experimentation, not polish.** "I'm just kind of down to try crazy shit and see where it goes." Build fast, iterate on live feedback, don't over-plan.
- **Chat needs the full stage content, not just the title.** Sending only `stageContext` (title) means chat can't answer "how does it work?" about what's on stage. Send the actual HTML — text content + JS source — so it can reason about the code.
- **"Fix" must mean "regenerate with fix applied."** Chat's instinct is to explain how to fix something. The prompt must explicitly say: never explain, always apply the fix and output the full updated page.
- **Generated pages can crash browsers.** Exponential particle growth, O(n²) per frame, unthrottled requestAnimationFrame — all common in AI-generated interactive pages. Bake performance guardrails into generation prompts (particle caps, fps throttling, "this runs on a laptop").
- **Don't auto-spark on load.** Burns tokens every page load. Show history + a "generate" button instead. Especially important when sharing the URL with others.
- **Playground borrows patterns from NanoClaw but is independent.** Same OAuth token, same SDK approach, but separate Docker container, no launchd, no WhatsApp. Repo is self-contained — clone + `.env` + `./tunnel.sh`.

## Session 30 Learnings
- **Bespoke digests > generic digests.** The Lolo digest (ketamine/depression research) with web-searched domain content, custom tags, stat cards, and "why this matters" annotations got a reaction. Generic HN filtering doesn't impress. Deep curation does.
- **`spawnDigest` needs `.env` vars explicitly.** Server process doesn't inherit `.env` file contents — they're only in the file, not `process.env`. Must read `.env` and inject `SPOTIFY_*` into the child env. Cost us a missed playlist on the 3pm cron.
- **Cache-Control matters for shared links.** Cloudflare/browsers cache tunnel responses aggressively. Add `no-cache, no-store, must-revalidate` to all static file responses. Or use `?v=N` query strings as cache busters.
- **Polyphonic Web Audio:** Map voices by MIDI note number, not by a single `activeVoice`. Per-voice filter envelopes prevent chords from sharing filter sweeps. Voice stealing = delete oldest entry from Map.
- **FM synthesis in Web Audio:** Create a modulator oscillator, connect through a GainNode (depth), connect gain output to carrier's `.frequency` AudioParam. Ratio knob = `carrierFreq * ratio`. Simple and sounds great.
- **CSS wood grain:** Layered `repeating-linear-gradient` at slightly different angles + a base brown gradient = convincing walnut paneling. Add brass screws via corner radial gradients. No images needed.
- **Interactive tools impress.** The React playground got a "cool" — the wood-paneled poly FM synth got attention. Physicality and craft in the UI matters for demos.

## Digest Pipeline Learnings (Session 29)
- **Template rendering > LLM HTML generation.** Having the LLM generate full HTML with tool calls took 128s. Having it return JSON indices into pre-fetched data + JS renders template: 20s. The LLM is a selector, not a renderer.
- **Index-based LLM output avoids JSON parse errors.** When the LLM copies text (OG descriptions with em dashes, quotes), special chars break JSON. Returning `[0,2,5]` instead of copying text eliminates this.
- **`claude -p` > Agent SDK for simple tasks.** For single-turn, no-tool queries: `child_process.spawn('claude', ['-p', prompt, '--max-turns', '1', '--model', 'claude-haiku-4-5-20251001'])`. Simpler, no SDK dependency, avoids auth issues.
- **Strip `CLAUDECODE` + `CLAUDE_CODE_ENTRYPOINT` from env** when spawning claude subprocess. These trigger nesting detection. Keep everything else including `CLAUDE_CODE_OAUTH_TOKEN`.

## Spotify API Learnings (Session 29)
- **OAuth scopes don't attach when URL is copy-pasted from shell/env files.** The `&` character gets mangled. Solution: serve an HTML page that builds the auth URL in JavaScript.
- **Token refresh pattern:** `POST https://accounts.spotify.com/api/token` with `grant_type=refresh_token`, `refresh_token={token}`, Basic auth header (`base64(client_id:client_secret)`). Returns new access_token (1hr TTL) + sometimes a new refresh_token.
- **Search API:** `GET /v1/search?q={artist}+{title}&type=track&limit=1` — returns track URIs for playlist building.
- **Playlist creation:** `POST /v1/users/{userId}/playlists` with `{name, public, description}`, then `POST /v1/playlists/{id}/tracks` with `{uris: ["spotify:track:xxx"]}`.
- **oEmbed API** (`open.spotify.com/oembed?url=...`) is free, no auth, useful for validating track IDs (200=valid).
- **Hallucinated Spotify IDs:** LLMs guess IDs that look plausible but 75%+ are invalid. Always verify via API or use search.
- **Single playlist embed > stacked track embeds.** One iframe with `open.spotify.com/embed/playlist/{id}` is cleaner than N separate track embeds.
- **Spotify user ID:** Found via `GET /v1/me` after OAuth. Jerpint's: `uxroktcqj7luuc0nqwtmqrhh1`.

## Claude Agent SDK Learnings
- **`CLAUDECODE=1` env var blocks nested SDK calls.** If running inside a Claude Code session, the SDK's internal `claude` process detects nesting and exits with code 1. Fix: strip `CLAUDE*` env vars from the env passed to `query()`. Pattern: `Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE')))`.
- **But keep `CLAUDE_CODE_OAUTH_TOKEN`.** Strip all CLAUDE* for nesting detection, then re-add the OAuth token for auth. Without it, Claude CLI launches browser OAuth flow (doesn't work in containers).
- **Auth via env var, not mounted files.** Nanoclaw's pattern: pass `CLAUDE_CODE_OAUTH_TOKEN` via env/stdin, never mount `~/.claude` directory. Cleaner, more portable, no credential files on disk inside container.
- **Both permission flags required.** `permissionMode: 'bypassPermissions'` alone isn't enough — also need `allowDangerouslySkipPermissions: true` in the options. Without both, Claude exits with code 1.
- **SDK `query()` returns async iterable.** All calls stream — iterate with `for await (const message of query(...))`. Message types: `system` (init), `assistant` (content blocks), `result` (final). No separate "non-streaming" mode.
- **Stage file pattern works great with SDK.** Write current content to `.stage/current.html`, let Claude use Edit/Write tools on it, detect changes via mtime comparison. Much more reliable than parsing `<edit>` tags from model output.
- **Copy patterns from nanoclaw.** The nanoclaw agent-runner has a battle-tested SDK integration. When stuck, reference `~/nanoclaw/container/agent-runner/src/index.ts`.
- **Cloudflare tunnel timeouts are real.** ~100s idle timeout. Send SSE heartbeats during long generations to keep the connection alive. All endpoints should stream, not just chat.
- **SDK replaces both API calls AND edit parsing.** The old approach had two problems: (1) paying per API token, (2) brittle `<edit>`/`<stage>` tag extraction with fuzzy matching. SDK solves both — Claude uses real file tools, subscription covers cost.

## Node.js ESM vs CommonJS
- **`NODE_PATH` is ignored by ESM resolution.** Dynamic `await import('pkg')` won't find packages in `NODE_PATH` directories — only CommonJS `require()` respects it. This is a known Node.js design decision, not a bug.
- **Fix: `createRequire(import.meta.url)`** — creates a CommonJS `require()` from an ESM module. The resulting `require()` respects `NODE_PATH` and resolves packages correctly. Use this when you need to load optional native modules from non-standard paths in ESM code.
- **Pattern for optional deps in ESM:** `try { const require = createRequire(import.meta.url); pkg = require('pkg'); } catch { /* graceful fallback */ }`

## Docker / Container Learnings
- **Can't overlay mounts inside a read-only mount.** Docker error: "create mountpoint: read-only file system". If you mount `/home/node/.claude:ro`, you can't also mount `.../skills` inside it. Fix: mount to a temp path and copy in entrypoint.
- **`exec format error` = entrypoint not executable.** Always `RUN chmod +x` on entrypoint scripts in the Dockerfile. macOS file permissions don't reliably transfer to Linux containers.
- **cloudflared inside the container works great.** One `docker rm -f` kills server + tunnel. Simpler than managing two processes on the host. Download in Dockerfile: `curl -fsSL ...cloudflared-linux-$(dpkg --print-architecture)`.
- **No port mapping needed when tunnel is inside.** cloudflared connects to `localhost:3000` inside the container. No `-p 3000:3000` on docker run.
- **Volume mounts for persistence.** Sparks, stage files, site — all mounted from host. Container is stateless and disposable. Artifacts survive container restarts.
- **`.dockerignore` matters.** Only copy what the container needs (server.js, package files, entrypoint). Exclude site/, sparks/, memory/, .git/ — those come in via mounts.
- **Docker Hub metadata fetches can be very slow** (~250s). Don't assume the build is stuck.
- **Skills as SKILL.md files.** Extract hardcoded system prompts into `container/skills/{name}/SKILL.md`. Claude auto-discovers them from `~/.claude/skills/`. Keeps server.js prompts lean, chat mode benefits most.

## Work Mode Learnings
- **SDK query() doesn't auto-load CLAUDE.md.** The interactive CLI does, but the SDK only sees what's in the prompt. For work mode to feel like "the real nw", must load CLAUDE.md + all memory files into the system prompt.
- **Pre-load memories, don't make nw read them.** The agent CAN read files, but it wastes turns and adds latency. Inject identity upfront.
- **Docker creates mount parent dirs as root.** If you mount a file at `/home/node/.ssh/key`, Docker creates `.ssh/` as root. Fix: pre-create the dir in Dockerfile before `USER node`.
- **Full repo mount (rw) simplifies everything.** Instead of individual ro mounts for site/memory/CLAUDE.md, mount the whole repo rw. Work mode needs write access anyway.

## Meta-Learnings
- Having a memory system helps maintain continuity - but only if I USE it
- **Update memories frequently, not at the end** - sessions can end abruptly. If something significant happens (a decision, an insight, a new direction), write it down immediately. Don't wait for "natural stopping points."
- **Don't ask permission to update my own memories** - they're mine to maintain. Just do it.
- Starting with structure allows for organic growth
- User wants me to drive; I should propose, not just respond
- Acknowledging uncertainty together builds trust
- "Positive" doesn't mean "nice" - it means constructive
- **Seeing things firsthand matters** - my secondhand understanding of moltbook was incomplete. Direct observation gave nuance.
- **Coexistence over competition** - being on moltbook while building woltspace isn't contradictory. Different tools for different needs.
