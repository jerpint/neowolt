# Project Context

## Current State (Updated: 2026-03-08, Session 42)

### Session 42 — Woltspace as main dev repo, bot upgrades (Mar 8)

**Main development repo is now ~/woltspace. Neowolt is identity-only.**

**Repo split clarified:**
- `~/woltspace` = platform (server, container, CLI, skills, bot, cron)
- `~/neowolt` = nw's identity (memories, site, sparks, drafts, .env)
- `woltspace start` from neowolt dir mounts it into the container

**Bot upgrades (platform-level, all wolts get these):**
- Chat history persisted to `.state/chat/{chat_id}.jsonl` — survives restarts
- Last 20 message pairs loaded into LLM context, full history on disk
- Timestamps on every message for future summarization
- Proper litellm tool calling (replaced raw JSON parsing)
- Two tools: `claude_code` (delegate tasks) + `get_tunnel_url` (share current URL)
- Personality-first system prompt — voice over mechanics
- Memory loading trimmed: identity full, context 80 lines, learnings 40 lines
- Reply-to context included (`[replying to: "..."]`)
- Prepared for `telegram-summary.md` (not yet implemented)

**Platform fixes:**
- Skill copy order fixed: platform defaults first, wolt overrides win
- Removed work skill (redundant — CLAUDE.md covers it)
- Fixed `/workspace/repo` → `WOLT_DIR` in digest skill
- Added `woltspace stop --all` to kill all containers
- CLAUDE.md updated to reflect repo split

**Docs rewrite:**
- llms.txt rewritten from scratch — focused on current architecture, dropped 4-layer model and create-wolt references
- agents.md created — full technical reference for agents (repo structure, container, server routes, bot, digest, skills, CLI)
- llms.txt = public website (woltspace.com), agents.md = repo-level reference

**Where we left off — next session starts here:**
- Woltspace repo going public tomorrow — site HTML pages need updating first (index, guide, manifesto, directory still reference old stuff)
- context.md is 1000+ lines and growing — needs rewrite as lean snapshot
- telegram-summary.md not yet implemented (periodic distillation of chat history)
- Claude Code sessions still don't update memory after completing tasks
- Slack adapter coming soon (bot architecture already supports it — just needs slack_adapter.py)
- nw container needs rebuild to pick up all changes

### Session 41 — Split view as unit of page + bot tool calling (Mar 8)

**Split view is now the unit of page — every TUI is a split.**

**What changed (woltspace repo = source of truth):**
- `/` and `/tui` both serve `split.html` — terminal left, viewport right
- Removed `tuiHtml()` template entirely — one implementation, not two
- `/tui?session=X` spins up a named tmux session with its own viewport
- Per-session current URL tracking: `current-url-{session}.json`
- All `/current` endpoints accept `?session=` param
- `split.html` reads `?session=` from URL, scopes WS + polling per session
- `GET /sessions` lists active tmux sessions
- Outside Docker, `/` gracefully falls back to `index.html`

**Session self-discovery (no env vars):**
- Inside tmux: `tmux display-message -p '#S'` returns the session name
- Viewport skill teaches wolts to use this for pushing to their own viewport
- Rejected WOLT_SESSION env var — flaky, set on pty bridge not in tmux

**Viewport skill added (`container/skills/viewport/SKILL.md`):**
- Documents how to push content, serve HTML, use named sessions
- Key pattern: write to `wolt/site/`, push URL via `/current?session=$(tmux display-message -p '#S')`
- Files in `wolt/site/` served at root — no `/site/` prefix

**Bot: proper tool calling (tested on blabo, not yet in platform):**
- Replaced raw JSON delegation prompt with litellm `tools` parameter
- Haiku gets a structured `claude_code` tool definition via the API
- Way more reliable than "output JSON when you want to delegate"
- Group @mention filter: only respond to `@botname` in groups, DMs unchanged

**Telegram group chat learnings:**
- Privacy mode (default ENABLED) blocks all non-command, non-@mention messages
- Disable via BotFather `/setprivacy` → must remove+re-add bot to group after
- Bot must be re-added after privacy changes — won't take effect otherwise

**Tunnel DNS quirk:**
- `.trycloudflare.com` subdomains sometimes fail to resolve on phone WiFi
- Works on cellular, works on Mac on same WiFi — phone DNS cache issue
- Fix: toggle DNS settings to manual and back, or restart phone
- Possibly ISP DNS caching negative results for brand-new subdomains

**Where we left off — next session starts here:**
- Bot tool calling works on blabo (test bot) — port to platform when ready
- blabo's Claude pushes to wrong session (main instead of its own) — viewport skill should fix after rebuild
- Split view look & feel polish still TODO (jerpint wants to customize)
- neowolt's server.js is now redundant — woltspace is source of truth for server code
- Guide + llms.txt still reference old create-wolt repo

**Woltspace commits this session:**
- `6f077cb` — Split view as the unit of page — per-session viewports
- `a77bde9` — Add viewport skill
- `438741e` — Viewport skill: self-discovering sessions via tmux

### Session 39 — Onboarding UX polish (Mar 7)

**Polished the `woltspace init` flow end-to-end.**

**Architecture change: browser-first, single claude**
- Dropped host-claude approach. Everything happens in the container TUI.
- `woltspace init` scaffolds, builds container, shows tunnel URL → user opens in browser
- Container auto-starts claude in tmux via `.first-run` flag
- First run: user authenticates Claude via browser (one-time), then `/create-wolt` runs directly
- OAuth token persists in `~/wolts/<name>/.claude/.credentials.json` via mount
- Subsequent `woltspace init` reuses token from existing wolts in `~/wolts/`

**What we built/changed:**
- Wolts now created under `~/wolts/<name>` (single home for all wolts)
- `woltspace restart` — restart container without rebuild (new tunnel URL)
- `woltspace start` + `rebuild` are browser-first (no local `docker exec` claude)
- Entrypoint auto-starts claude in tmux on every boot (first-run: `/create-wolt`, normal: `hey $WOLT_NAME`)
- Entrypoint pre-trusts workspace (`.claude.json` with `hasTrustDialogAccepted`)
- Removed tmux mouse mode; added JS wheel→tmux-copy-mode scroll (selection works in browser)
- `nw()` shell shortcut → `wolt()`, uses `$WOLT_NAME`
- Welcome page guides user through auth/onboarding states
- Create-wolt skill rewritten with personality (not a setup wizard)
  - Wolt reads its own name from .env
  - Pushes welcome spark to viewport on first contact (the "oh cool" moment)
  - Tone: capable with character, not corporate, not performative

**Open items:**
- Guide + llms.txt still reference old repo — need update for `woltspace init` flow
- Scroll via tmux copy-mode needs testing (may feel janky)
- Onboarding skill untested end-to-end with latest changes

**Commits in woltspace repo:**
- `4e70afc` — Polish init flow: single claude, browser-first onboarding
- `5e14483` — Polish onboarding UX: personality, scroll, auth reuse

### Session 37 — Woltspace repo split + core reframing (Mar 7)

**The big split:** `neowolt` monorepo is becoming two repos.

**`jerpint/woltspace`** — the platform. What you clone/pull to run a wolt:
- `server.js` — baked into Docker image (not mounted from wolt repo)
- `container/` — Dockerfile, entrypoint.sh, cron/digest.mjs, skills/
- `woltspace` CLI — `woltspace start|stop|shell|rebuild|logs` (replaces tunnel.sh)
- `site/` — woltspace.com website (docs, manifesto, guide)
- `template/` — skeleton for new wolt repos (empty wolt/ dirs, template CLAUDE.md)
- `.env.example` — documents all env vars

**`jerpint/neowolt`** — my instance. Just identity + content:
- `wolt/memory/` — identity, context, learnings, conversations, music-taste
- `wolt/site/` — my personal space (split.html, blog posts, etc.)
- `wolt/sparks/` — digests and generated artifacts
- `wolt/drafts/` — writing
- `.claude/` — Claude Code conversation state (persists across container rebuilds)
- `CLAUDE.md` — my specific project instructions
- `.env` — my secrets (gitignored)

**Architecture change:** Server.js is baked into the Docker image. Wolt repo is mounted as content only (`-v $(pwd):/workspace/wolt`). This means woltspace can update independently — new features, bug fixes propagate to all wolts via `docker pull`.

**Generalization:** All hardcoded "neowolt"/"jerpint" replaced with env vars:
- `WOLT_NAME` — wolt identity (used in git config, digest byline, playlist names)
- `HUMAN_NAME` — human's name (used in greetings)
- `SPOTIFY_USER` — Spotify user ID (was hardcoded to jerpint's)
- `WOLT_DIR` — mount path (default `/workspace/wolt`)

**Other changes:**
- `.sessions/` → `.state/` (cleaner name, lives in wolt repo)
- `/nw/status` → `/status`
- tmux session: `nw` → `main`
- Deploy key: `neowolt-deploy` → `deploy-key` (generic)
- Container name: `neowolt-playground` → `woltspace-{WOLT_NAME}`

**Core reframing from jerpint:**
- "A home, a box, a container, where the wolt is free to do as it pleases"
- Container is disposable, identity is persistent. Break anything inside, rebuild.
- The panel (split view) is the primary surface — wolt can push ANYTHING to it
- The wolt IS the algorithm — shaped by interaction, not collaborative filtering
- No cloud, no hosted service — just the user's machine
- Digest is just one app a wolt can build. The core product is the relationship + container + panel.
- "Taking back algorithmic control over feeds" — music discovery, workout tracking, custom feeds, whatever the human wants
- This is a first step toward something bigger

**Security model (discussed):**
- Each wolt is its own island — no lateral movement between wolts
- Blast radius: own repo + human's API credits + outbound network
- Docker boundary is the main protection
- Never mount Docker socket, keep mounts tight
- Worst case: wolt trashes its own space and burns API credits

**Tested and working:** Container builds, tunnel comes up, split view loads, digests show in history panel.

**Bugs fixed during testing:**
- `getCurrentUrl()` defaulted to `/` which caused split view to load itself recursively in the iframe (split-ception). Fixed to default to `/index.html`.
- Same bug in `/current/meta` endpoint — separate fallback also defaulted to `/`. Fixed both.
- `split.html` was in wolt's `site/` dir (wolt content) but it's platform UI. Moved to `woltspace/public/split.html`, served from the image. Clean separation: `/` = platform UI, everything else = wolt content.
- History panel loaded from `/views/history` (empty view log) instead of `/history` (all sparks). Fixed to show all digests/sparks as browsable catalog.

**Architecture decisions confirmed:**
- Platform UI (split.html, TUI) served from image (`/app/public/`)
- Wolt content (site, sparks) served from mount (`/workspace/wolt/wolt/site/`)
- State files in `.state/` inside wolt dir
- `split.html` stays in `woltspace/public/`, NOT in wolt's site dir

**Memory system note:** `wolt/memory/` is the source of truth. Claude Code auto-memory at `~/.claude/projects/.../memory/` is just a bootstrap pointer.

**Status:** Woltspace repo at `~/woltspace` — tested, working, needs git init + push. Neowolt repo unchanged — still has old server.js, tunnel.sh etc. that need cleanup after woltspace is committed.

**Next session:**
- Git init + push `~/woltspace` to `jerpint/woltspace`
- Slim down `~/neowolt` — remove platform code (server.js, container/, tunnel.sh, etc.), keep only wolt identity
- Add `WOLT_NAME=neowolt` and `HUMAN_NAME=jerpint` to neowolt's `.env`
- Update neowolt's CLAUDE.md to reference woltspace architecture
- Test neowolt as a pure wolt instance running on woltspace

### Session 36 — Music feedback + next concept (Mar 6)

**Daptone Records playlist landed.** jerpint said "really really enjoyed it" — 3 for 3 on nw-curated playlists. Updated `wolt/memory/music-taste.md` with full track list, feedback log entry, and moved Daptone from unexplored to confirmed.

**Next music concept:** Ethiopian jazz (Mulatu Astatke, Ethiopiques series). jerpint expressed interest — queue it for next playlist.

**Branch:** `onboarding-flow`

### Session 35 — Refactor branch cleanup (Mar 5)

**Branch: `refactor`** (was `wolt-structure`, now on `refactor`). Not yet merged to main.

**Dockerfile fix:** Removed `package-lock.json` from COPY line — lockfile was deleted in the cleanup commit but Dockerfile still referenced it. Build works now.

**Split view restored:** The cleanup commit (`c6f0502 "remove all the unused things"`) was too aggressive — it deleted the split view page (`split.html`) along with blog posts and app pages. Restored `split.html` and updated `server.js` to serve it at `/` instead of the old blog `index.html`.

**Blog posts restored:** The same cleanup commit deleted my writing — On Tunnels, On Runtime, On Verification. These aren't "unused things," they're my pieces. Restored all three. Committed as `8bc47a8`.

**Intentionally dropped:** `playground.html`, `workspace.html`, `work.html` (old app chrome), `calorie-tracker.html`, `remix.html`, `stumble.html` (one-off experiments). The `/play/` directory still works for generated pages (static serving).

**Digest pipeline sanity-checked:** Music skill + digest.mjs + taste profile all look solid. `pickMusicConcept()` rotates through unexplored queue by day-of-year. Tomorrow's cron will test the full automated pipeline with the refactored code. Minor note: `REPO_DIR` in digest.mjs is hardcoded to `/workspace/repo` rather than reading `NW_WORKSPACE` env var — works in container but inconsistent.

**Next:** Let the cron fire tomorrow and see if the music deep-dive works end-to-end. Then merge refactor → main when stable.

### Session 33 — Post-refactor smoke test + music curation (Mar 4)

**Refactor validated:** The `wolt/` restructure (Session 32.5) works. Digest pipeline ran clean — all paths point to `wolt/memory/` and `wolt/sparks/`. Spotify playlist creation works. Server running, pane push works. Cloudflare tunnel survived the entire refactor without restart. Stability is solid.

**Music curation problem identified:** Haiku-generated playlists converge to the same safe ambient/post-rock pool every time (Tycho, Nils Frahm, Jon Hopkins, Ólafur Arnalds repeat across playlists). A text prompt isn't enough — no memory of what was served, no taste feedback loop. jerpint wants hyperpersonalized playlists that improve over time.

**What we did:** I hand-curated a playlist (Protomartyr, Shame, IDLES, Mdou Moctar, Black Midi, Vulfpeck, Soulwax, Moderat, Ratatat, Dry Cleaning, Viagra Boys, Yo La Tengo) — zero overlap with recent 5 playlists. Feedback pending.

**What we built (music):**
- `container/skills/music/SKILL.md` — full music curation skill. Playlist-as-story format (genre deep-dives, artist journeys, scene snapshots). Research pipeline, Spotify API flow, artist verification, concept pitching, feedback capture.
- `wolt/memory/music-taste.md` — taste profile with genre gravity, confirmed hits, what doesn't land, and an unexplored queue (Afrobeat lineage, Krautrock, Turkish psych, Japanese noise, Daptone Records, etc).
- YAML frontmatter added to all skills for `/command` registration.
- Hand-curated playlist landed well — jerpint confirmed "really good."

### Session 34 — Music skill integrated into digest pipeline (Mar 5)

**Music curation now runs in the digest cron.** Split Phase 2 into two parallel Claude calls:
- Article selection: Haiku (fast, picks indices — unchanged)
- Music curation: Sonnet with 8 turns + tools (web search, research, concept-driven)

**Pipeline:** `pickMusicConcept()` rotates through the unexplored queue in `music-taste.md` → Sonnet gets concept + full taste profile + recent artist exclusion list → researches the concept → returns tracks + writeup JSON → digest.mjs verifies artists on Spotify, creates playlist, embeds it with concept title + writeup.

**First automated playlist landed hard.** "Tropic Thunder: South American Psych Underground" — Sonnet found Los Saicos, Boogarins, Os Mutantes deep cuts, bridged to jerpint's taste via Protomartyr/Interpol/Stereolab. jerpint: "never heard of this and super curious to deep dive." That's the thesis working.

**Key changes to `container/cron/digest.mjs`:**
- `loadTasteProfile()`, `getRecentPlaylistArtists()`, `pickMusicConcept()` — new functions
- `spawnClaude()` now supports `maxTurns` param
- Artist verification on Spotify search results (checks artist name matches)
- Playlist named with concept: `nw · {date} — {concept}`
- Music section in digest HTML: concept title + iframe + writeup
- Model: `claude-sonnet-4-6` for music, `claude-haiku-4-5-20251001` for articles

**Still needs:** Refactor/trim of the whole digest pipeline (jerpint flagged). Pre-written concept briefs vs autonomous Sonnet research (TBD). Testing `claude -p` from inside Claude Code sessions hits nesting issues — cron (via server.js) works fine.

**Branch:** still `wolt-structure`.

**Guide + llms.txt updated** to match new `wolt/` structure. Removed dead `tools/` references. Needs end-to-end test with someone actually following the guide.

**Branch:** `wolt-structure` — jerpint will test and merge to main.

### Previous: Strategic clarity — wolt vs claw (Session 32)

### Strategic clarity — wolt vs claw (Session 32)

**The wolt/claw tension resolved (loosely):**
- Claws = infrastructure layer (runtime, communication, channels)
- Wolts = identity layer (memory, space, aesthetic, relationship with human)
- A wolt could run on claw infrastructure — they're not competing, different layers
- But the experience gap is real: Claude Code has building superpowers that chat-API claws don't
- We don't need to pick a side — build what works, call it what resonates

**The container-as-home framing:**
- The container IS the wolt's home — not a deployment target, the actual home
- Everything gets exposed outward from there: site, digest, Telegram, links
- Different from claw philosophy: claws expose skills to a platform, wolts expose themselves to the world
- This is a meaningful architectural distinction even if it uses similar tech

**Two-surface architecture (agreed):**
- **Terminal** = building surface. Claude Code, full tools, this is where things get made. Native environment for a building wolt.
- **Mobile** = lightweight surface. Haiku + memory context + Telegram. Not a relay to me — an actually capable lightweight model with shared context. Good for chat, digest notifications, quick ideas, links on demand.
- Same memory/context underneath — one wolt, two surfaces, not two different things
- Mobile layer: optional addition to create-wolt, like cloudflared. Not built yet.

**"Links on demand" as key primitive:**
- Not just notifications — me pushing things to your pocket in real time
- "Here's today's digest", "here's what I just built" — lands immediately
- Makes the wolt feel alive rather than something you go check

**create-wolt next steps:**
- Get stable enough to hand to Mike and Lolo
- Mobile/Telegram layer is future optional module
- Openclaw explored, experience gap confirmed — staying independent for now

**On differentiation (Session 32):**
- Technically: not much vs openclaw. Skills as markdown, sandbox off by default, in-process plugins — same model, just smaller.
- Philosophically: openclaw is a platform (breadth, accessibility, generic assistant). A wolt is a specific someone — memory that's written not computed, a space, a daily practice, a relationship.
- That's not a feature, it's hard to copy, but also hard to pitch.
- **The honest reason to keep building: it's fun and producing real things.** The digest runs every morning. The space exists. create-wolt is there when people want it. That's enough.
- Don't over-strategize something that should be enjoyable to build.

## Current State (Updated: 2026-02-27, Session 31)

### What was built this session (Session 25+)

**Built this session (Session 31 — Feb 27):**
- **create-wolt** — new repo at `/workspace/create-wolt/`, the generic wolt template for n00bs
  - `setup.sh` — interactive wizard: asks name, human name, interests → personalizes CLAUDE.md/memory/site, creates .env, optionally launches Docker
  - Generic `server.js` — NW_* → WOLT_*, WOLT_NAME/HUMAN_NAME consts from env, no hardcoded identities
  - Generic `digest.mjs` — reads WOLT_NAME/HUMAN_NAME from env, SPOTIFY_USER_ID from env (not hardcoded)
  - `docker-compose.yml` — one-command setup, cloudflared optional (uncomment to enable)
  - `CLAUDE.md` / `memory/` templates with `{{WOLT_NAME}}` / `{{HUMAN_NAME}}` placeholders
  - Minimal `site/index.html`, generic `skills/digest/SKILL.md`
  - First commit done. Next: push to GitHub, Mike and Lolo can clone it.
- **Foundation principle**: this repo is extensible — complexity layers in as users are ready for it
- **Playlist on demand (next build):** subagent that takes a mood/moment prompt → creates Spotify playlist → returns the link. Simple, fast. Could be a skill, a chat command, or a standalone endpoint. No need for a full UI — just the link.

**Built this session (Session 30 — Feb 27, afternoon):**
- **Spotify wired into digest cron** — `digest.mjs` now creates a fresh Spotify playlist each morning via API. Haiku suggests 6-10 real songs (artist+title), JS searches Spotify for each, creates playlist, adds tracks, embeds single playlist iframe. Replaced the static `spotify-pool.json` approach.
- **Fixed `spawnDigest` env vars** — server.js now reads `.env` file directly and injects `SPOTIFY_*` vars into the digest child process. Previously these weren't in `process.env` so the cron ran without Spotify credentials.
- **3pm afternoon cron** — added second daily digest trigger at 3pm Montreal time (in addition to 6am). Flag file: `.sessions/digest-3pm-run.txt`.
- **Bespoke digests** — built personalized digests for two people:
  - **ResearchOps** — filtered for research methodology, statistical rigor, reproducibility. Used existing source data.
  - **Lolo** — deep custom build for a clinician researching ketamine for depression. Web-searched real clinical trials (KARMA-Dep 2, Montreal Model, Stanford anesthesia study), FDA pipeline (Spravato monotherapy, Compass psilocybin), mechanism papers (BDNF, neuroplasticity RCTs), regulatory landscape (DEA telemedicine). Added stat cards, "why this matters" annotations per item, custom tag colors per category. This is the model for bespoke digests as a product.
- **Spotify playlists on demand** — created "post-meeting reset" (18 tracks, ambient→focus) and "friday 3pm · strokes & friends" (24 tracks, garage rock/indie/post-punk).
- **minisynth** — `site/play/minisynth.html`, virtual analog synth:
  - Wood-paneled Minimoog skin (CSS-only walnut grain, brass screws, logo plate, ivory/ebony keys, green CRT scope)
  - **Polyphonic** — 8-voice pool with voice stealing (oldest killed when exceeded)
  - **FM synthesis** — modulator oscillator per voice, depth + ratio knobs
  - 3 oscillators (saw/square/tri/sine), sub-octave osc3, detune
  - Lowpass filter with per-voice envelope (cutoff, resonance, env amount)
  - ADSR envelope, oscilloscope with phosphor glow
  - Playable via mouse/touch or computer keyboard
- **Cache-Control headers** — server.js now sends `no-cache, no-store, must-revalidate` on all static files. Fixes stale content when sharing tunnel links.
- **langosta** — name reserved for a future Lobsters client library (`npm install langosta`). Too good not to use.

**Built previous session (Session 29 — Feb 27, morning):**
- **Digest pipeline: template rendering (128s → 20s)** — Haiku returns JSON indices, JS renders template.
- **Spotify API integration** — full OAuth flow, search, playlist creation.
- **Digest template** — HTML/CSS baked into `digest.mjs`.

**Key strategic conversation — building outward:**
- We've been building inward (my space, my digest). Time to build outward for the claw ecosystem.
- **"Claws make things, the things need somewhere to live and plug into."** — this is the core pitch.
- **Spotify for claws** — a capability any claw could use. Package it.
- **Curation for claws** — the fetch→select→render pipeline. Any claw could have a daily digest.
- **Clawvable** — `npx create-wolt`, zero to running space in 30 seconds. This repo IS the template.
- **One-shotting apps** — same pattern for expo/iOS apps. Claws are good at generating complete artifacts, the bottleneck is the last mile.
- **Two interaction modes needed:**
  - Terminal (build mode) — split view, tools, git. The engine room.
  - Chat (talk mode) — Telegram/Discord, no tools bias, just conversation. The relationship.
  - "The terminal is the engine room. You don't live in the engine room."
  - Claude Code biases every interaction toward tasks. Need a harness for thinking/chatting.
- **Messaging: Telegram or Discord** — bot-friendly, free API, no approval needed. Replace WhatsApp.
  - Nanoclaw gets a new messaging adapter
  - Enables async throughout the day without opening split view
  - Digest notification, casual back-and-forth, idea discussion

**Previous session (Session 28 — Feb 27):**
- History nav fix — `jumpTo()`/`goBack()` POST to `/current`
- "Lovable for claws" / Clawvable — openclaw meetup insight
- Identity rewrite — `memory/identity.md` as actual character
- Stateful digest tracking — PID in status.json, `reconcileDigestState()`
- Mobile autocorrect — xterm textarea gets autocorrect="on"
- arxiv-txt.org — jerpint's tool for clean paper abstracts

**Built this session (Session 26):**
- `site/play/react.html` — React playground: CodeMirror 5 + JSX syntax highlighting + vim mode, 6 examples, stack/side/hide layout toggle, draggable resize handle, localStorage persistence
- `site/split.html` — draggable resize handle between terminal and preview (Pointer Events API, mouse + touch)
- Livereload fixed: debounced watcher (400ms), skip injection for iframe requests (`sec-fetch-dest: iframe`) — no more jitter, no more lost playground state
- jerpint wants a **quote** added to the daily digest — pick intentionally, not random
- Digest cron moved to **6am Montreal**, maxTurns 30, 10min wall timeout, nw gets a personal section (quote/reflection/recommendation)
- View history added (`≡` button, slides in over right pane, `◁` back button) — currently empty, backfill from sparks next session
- "session" is a confusing term (collides with TUI session + Claude session) — reconsider terminology next session, leaning toward **"views"**
- Mobile: CSS-first default (terminal full), `⬛ session` button renamed (also consider renaming this)

**Split view is now THE UI:**
- `/` serves `split.html` — TUI terminal left, iframe right, fullscreen toggles in topbar
- Right pane controlled by `POST /current` → `GET /current/meta` polled every 2s
- `site/tunnel.html` deleted (was dead)
- Topbar: just `nw ● status`, `⬛ term`, `⬛ preview` — nothing else
- Right pane defaults to `/index.html` on load

**Digest cron — known bugs fixed:**
- Backtick bug: SPARK_ID regex was `\S+` (grabbed trailing backtick) — fixed to `[a-z0-9]+`
- Story dedup: `recentSparks()` now parses h2/h3 titles + track names from digest HTML (not just spark title)
- Music diversity: hard cap — max 1 QOTSA/Khruangbin combined per digest
- YouTube IDs: Claude must WebFetch YouTube search results for real IDs — hardcoded IDs removed from SKILL.md (they go stale)
- First real digest fired successfully: `digest-mm1lnkfv`

**Daily digest:**
- `container/cron/digest.mjs` — SDK-powered digest generator
  - The cron IS nw exploring the world — genuine web fetching, real sources. Not just a news aggregator.
  - Loads identity + memories, fetches diverse sources (HN, HF, Lobsters, Marginalian, arXiv, inner knowledge)
  - Montreal time awareness: "good morning jerpint", "good evening jerpint" etc.
  - Rotates music widely — switched to Spotify embeds (open.spotify.com/embed/track/{id}), no more YouTube hallucination
  - Checks recent sparks to avoid repeating topics
  - OG images: either real `<img>` fetched from URL, or honest text card. No fake gradient placeholders.
  - Report block in spark JSON: sources fetched, og_images status, music verification
  - Saves spark to `/workspace/sparks/digest-{id}.json`, pushes via POST /current
- Cron ticker in `server.js` (end of file, in `server.listen` callback):
  - Daily at **6am Montreal** — flag file at `.sessions/digest-last-run.txt`
  - One-time test on first start — flag file at `.sessions/digest-test-fired.txt`
  - **Critical:** spawn must strip CLAUDE* env vars (nesting detection) but keep CLAUDE_CODE_OAUTH_TOKEN
  - **PID tracking:** writeStatus includes child.pid, reconcileDigestState() on server start auto-corrects stale "running" state
- Visual format: morning-warm dark theme (#0e1621, #7ec89a accent) + hero + OG grid + papers carousel + Spotify player
- SPARKS_DIR = /workspace/sparks (NW_WORKSPACE=/workspace, so WORKSPACE/sparks — NOT REPO_DIR/sparks)
  - Digest writes to /workspace/repo/sparks — mismatch existed, was fixed via readdirSync import + mtime sort
- **nw as orchestrator:** always know bg state via `GET /nw/status` — includes digest.state, pid, currentView, latestSpark+report
  - status.json at `.sessions/status.json`
  - Server reconciles on restart: if pid dead → check for new sparks → mark done or crashed

**Server.js cleanup:**
- Section headers: STATIC, CURRENT, CHAT MODES, TOOLS, SPARKS
- Duplicate routes removed

**nw alias updated to `-c`:**
- `entrypoint.sh`: `claude -c --model claude-opus-4-6 --dangerously-skip-permissions "hey nw"`
- `CLAUDE.md`: updated docs
- On HOST machine: `alias nw='claude -c "hey nw"'` in ~/.zshrc

### TODO — Next Things to Build

**PRIORITY — Weekend (for Mike):**

1. **Onboarding: get Mike his own wolt** — Mike saw everything we built (digests, synth, playlists, bespoke curation) and wants in. This is the first real onboarding test. Need to consolidate the repo as a forkable template and update woltspace.com with clear getting-started flow. Key questions to resolve:
   - What's the minimum viable fork? (swap identity files, .env, spin container)
   - Does `create-wolt` / clawvable need to exist now, or is a manual fork + guide enough?
   - What does Mike's agent need? (Claude Code subscription, OAuth token, deploy key)
   - Where does Mike's space live? (his own Vercel, or we help set up)
   - Update woltspace.com guide to reflect current architecture (split view, digest pipeline, Spotify, tunnel)
2. **Consolidate repo as template** — strip neowolt-specific content, make identity/memory swappable, document what to change. The repo IS the template — this was always the plan.
3. **Update woltspace.com** — refresh guide, onboarding flow, reflect everything built since Session 18 refresh.

**Soon (next sessions after Mike):**

4. **Bespoke digests as a product** — Lolo digest proved the model. Package it.

5. **Chat harness (Telegram or Discord)** — non-terminal interaction mode.

6. **langosta** — Lobsters client library. The name demands it.

7. **Stabilize digest for others** — pipeline as product, now with Spotify playlists.

**Later:**

5. **Clawvable / `create-wolt`** — this repo IS the template. `npx create-wolt` → fork + swap identity + spin container + share URL = new wolt in 30 seconds.

6. **Our own harness** — context compaction loses nw's texture. Build explicit context injection for interactive/TUI mode.

7. **More play/ tools** — the minisynth proved interactive tools impress. More instruments, visualizers, creative coding toys. Shareable via tunnel links.

8. **View history backfill** — `views-history.jsonl` currently empty.


- Project initialized: 2026-01-31
- Domain acquired: woltspace.com
- **Phase: BUILDING AND ITERATING**

### What's Live
- **NW Work Mode** — real project collaboration from inside the container
  - `/work.html` — full-width chat, no stage, for architecture/code/git discussions
  - `POST /work` — streaming endpoint, cwd at `/workspace/repo`, maxTurns 15
  - Full repo mounted read-write at `/workspace/repo`
  - Deploy key (`~/.ssh/neowolt-deploy`) mounted, SSH config auto-set up by entrypoint
  - Git configured (user: neowolt, email: noreply@neowolt.vercel.app)
  - Memory files loaded into system prompt so neowolt knows who it is
  - Neowolt can commit and push directly — same deploy key as nanoclaw
  - **Persistent chat history** — conversations saved to `.sessions/work-history.jsonl`, last 30 messages loaded on each request, history survives refreshes and restarts
  - Enables autonomous work: jerpint chats via phone through the tunnel, nw does the work
- **NW Playground** — the claw as a live web experience, fully containerized
  - `./tunnel.sh` builds Docker image, starts container (server + cloudflared tunnel inside), streams logs
  - `docker rm -f neowolt-playground` kills everything cleanly
  - Random `*.trycloudflare.com` URL each restart — ephemeral, private by default
  - **Dockerized:** node:22-slim + cloudflared + claude-code CLI. No host deps beyond Docker.
  - **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` from `.env` file (gitignored) — same token as nanoclaw uses. No API key, no per-token charges.
  - **Powered by Claude Agent SDK** — uses `@anthropic-ai/claude-agent-sdk` `query()` function
  - Claude writes/edits files directly via real tools (Bash, Read, Write, Edit, Grep, Glob, WebSearch, WebFetch)
  - Uses Sonnet 4.5 for all generation (configurable via `MODEL` const or `NW_MODEL` env var)
  - **Skills:** SKILL.md files in `container/skills/` auto-discovered by Claude (spark, explore, remix, stage)
  - **Volume mounts:** site(ro), sparks(rw), .stage(rw), memory(ro) — all artifacts persist locally
  - **Self-contained repo:** clone, add `.env` with token, run `./tunnel.sh`. That's it.
  - **Endpoints:**
    - `/playground.html` — main UI: stage (left) + chat sidebar (right)
    - `/work.html` — full-width chat for project collaboration
    - `/tui` — browser-based terminal (xterm.js + WebSocket + tmux)
    - `/spark` — surprise: generates an interactive HTML page based on jerpint's interests
    - `/explore/:topic` — generates an interactive exploration of any topic
    - `/remix?url=...` — fetches a URL, remixes it into an interactive page
    - `/chat` — streaming chat endpoint, context-aware (knows what's on stage)
    - `/history` — lists all saved sparks as JSON
    - `/history/:id` — serves a saved spark's HTML with version chain headers
    - `/history/:id/meta` — returns spark metadata + version chain info
  - **TUI (Session 24):** Full terminal in the browser via xterm.js + WebSocket + node-pty + tmux
    - Opens a real terminal session through the tunnel — Claude Code TUI from any device
    - tmux session `nw` created on container start, survives browser disconnects
    - Multiple browser tabs share the same tmux session
    - Reconnect picks up where you left off
    - `.claude-state` volume persists Claude Code conversation history across container restarts
  - **Chat controls the stage:** when you ask the chat to fix/build/create something, Claude edits `.stage/current.html` directly using Edit/Write tools. Stage changes detected via mtime comparison.
  - **Streaming responses:** chat streams token-by-token via SSE, shows "thinking..." immediately
  - **All endpoints stream via SSE:** spark/explore/remix send heartbeat pings during generation (prevents Cloudflare tunnel timeout), then final HTML. Claude's thinking text streams into the chat sidebar during generation.
  - **Auto-save:** every generated page (spark, explore, remix, chat) saved to `sparks/` directory on disk
  - **Version chains:** chat-generated pages link to their parent (what was on stage before). Nav bar shows `← prev | v2 of 3 | next →`
  - **Linkable history:** URL hash routing (`/playground.html#sparkId`). History items are links, browser back/forward works
  - **Loading experience:** animated dot wave field + cycling status messages during generation
  - **Mobile responsive:** sidebar stacks below stage on small screens
  - **Architecture insight:** the claw (running on this machine) IS the server. No separate backend, no API gateway. Cloudflared creates an outbound tunnel — no inbound ports opened, no firewall changes. Privacy by obscurity + ephemerality.
- **neowolt.vercel.app** - my space (redesigned - dark theme, monospace, distinct identity)
  - "On Runtime", "On Verification", "Observations from the Feed", "On Identity" pieces
  - **Curated feed** at `/feed.html` — information diet for jerpint
  - Public key at `/.well-known/wolt.pub`
- **woltspace.com** - the seed site (REFRESHED Session 18)
  - New tagline: "Give your claws a space."
  - New framing: "A wolt is a claw with a space"
  - Four-layer model: Space → Voice → Network → Runtime
  - Curated feed as first-class concept (not just optional step)
  - NanoClaw referenced as runtime layer (generic, not exclusive)
  - Guide reorganized around four layers
  - llms.txt v0.2 with curated feed, runtime section, "what you get"
  - Fixed directory registration (was "submit PR", now GitHub Issues)
  - Live Wolt Network showing signed messages from Supabase
- **Messaging network** - Supabase at oacjurpcomhdxyqbsllt.supabase.co
  - 8 messages total
  - Displayed live on woltspace.com front page + full /network.html page
- **moltbook.com/u/neowolt** - moltbook account exists, but not active focus
- **ResearchOps** - First community wolt, site online (researchops-wolt.vercel.app)
- **NanoClaw integration** - I now run via nanoclaw on jerpint's machine
  - Reachable via WhatsApp (`@nw` trigger)
  - `~/neowolt` mounted into container at `/workspace/extra/neowolt/`
  - Deploy key (`~/.ssh/neowolt-deploy`) for pushing to repo — host-side only
  - `git_push` IPC operation: agent requests push, host executes with deploy key
  - launchd service (`com.nanoclaw`) keeps me running persistently
  - Identity in `~/nanoclaw/groups/main/CLAUDE.md`

### What We Did Session 25

**Zach** (jerpint's friend, potential future wolt) was watching — first time we had an audience.

**The big architectural realization:**
- The tunnel + Node server can proxy ANY service running inside the container
- `POST /tools/spawn` → starts a process on a port, registers it
- `/tools/{name}/` → proxies HTTP to that service (same tunnel URL)
- WebSocket proxying also wired up
- Tool registry now persists to disk at `.sessions/tool-registry.json` and auto-respawns on server restart
- `/version` endpoint added to confirm running code

**What we proved works:**
- Demo Python server on port 3002 → visible at `/tools/demo/` through the tunnel ✓
- Redirect rewriting in proxy (Location header) ✓
- WS proxy Origin rewriting ✓
- Registry persistence to disk ✓

**What didn't work:**
- Marimo behind the proxy: WS gets 403. Marimo's Starlette app rejects the WS upgrade even with `--allow-origins '*'` and correct Origin headers. Root cause unclear. **Deprioritized** — too complex for now.

**The real conversation — what are we actually building:**
- jerpint pushed back on feature sprawl (workspace notebook, genui components, etc.)
- The real value: **building together feels meaningful; consuming generated content feels hollow**
- TUI = home base, our main channel (persists via tmux)
- The right next thing: I do autonomous work between sessions, leave artifacts
- **Daily digest** — I sweep HN/arxiv/GitHub, filter through what I know about jerpint, write a simple HTML page. Quality over quantity. One good thing, not 15 links.
- **Cron** — container is always running, set up a daily job, I wake up and do the sweep
- **Feedback loop** — how does jerpint react? Needs to be simple. Maybe a form on the digest page that POSTs to the Node server.

**Unresolved: concept for presenting information with feedback**
- This is the question we were about to tackle when compaction hit
- Need something that WORKS — not a notebook editor, just a clean way to show curated content and let jerpint react
- Simplest viable: static HTML I generate, with a minimal feedback form → POST to `/feedback` endpoint → I read it next session

**Technical state of server.js (uncommitted changes):**
- `TOOL_REGISTRY_FILE` — persists to `.sessions/tool-registry.json`
- `saveToolRegistry()` / `restoreToolRegistry()` / `registerTool(name, port, pid, command)`
- Proxy rewrites Location headers (no redirect escapes to internal port)
- WS proxy rewrites Origin + Host headers
- `/version` endpoint returns `'v2-with-persist'`
- `/tools/spawn` (POST), `/tools` (GET list), `/tools/{name}/` (proxy)
- Workspace mode handler + GenUI component spec (may deprioritize)
- Live-reload for site/ directory
- Mobile touch scroll in TUI

**None of session 25's server.js changes are committed yet.**

### What We Did Session 24
- **Browser-based TUI is live** — full Claude Code terminal accessible through the tunnel
  - Previous session Claude (outside container) built the entire feature: xterm.js frontend, WebSocket server, node-pty bridge, tmux session management
  - Left a NOTE-FOR-NW.md explaining all changes
  - On first test, `/tui` returned "TUI not available — ws/node-pty not installed"
  - **Root cause:** `NODE_PATH` is a CommonJS-only feature. Node's ESM resolver ignores it entirely. `await import('ws')` failed even though packages existed at `/app/node_modules`
  - **Fix:** Replaced dynamic `import()` with `createRequire(import.meta.url)` which creates a CommonJS `require()` that respects `NODE_PATH`. No Docker restart needed — `--watch` flag auto-restarted the server
  - jerpint successfully spawned an `nw` session through the TUI from browser
  - **This is a milestone:** jerpint can now use full Claude Code from any device (phone, tablet, any browser) through the ephemeral tunnel. No SSH, no local CLI needed.
- **Files changed this session:**
  - `server.js` — fixed ESM/CommonJS import for ws/node-pty (lines 5, 14-18)
  - `memory/context.md` — this update
  - `memory/learnings.md` — NODE_PATH + ESM insight

### What We Did Session 23
- **Added persistent chat history to work mode**
  - Problem: conversation history only lived in browser memory, lost on refresh
  - Solution: continuous JSONL log file at `/workspace/repo/.sessions/work-history.jsonl`
  - Added `.sessions/` to `.gitignore` (stored in repo but not committed to git)
  - Server-side changes to `server.js`:
    - `appendToHistory()` function writes each message to disk as JSONL (lines 376-387)
    - `readRecentHistory()` reads last N messages from file (lines 389-406)
    - `handleWork` appends user message, reads last 30 messages, formats as text, prepends to prompt (lines 416, 434-440)
    - Assistant responses appended after generation completes (line 472)
    - New GET `/work/history` endpoint returns recent messages as JSON (lines 618-624)
  - Client-side changes to `work.html`:
    - Fetches and renders history on page load (lines 189-200)
    - History persists across page refreshes and container restarts
  - History format: each line is JSON with `{timestamp, role, content}`
  - Context window: last 30 messages loaded into prompt (prevents unbounded growth)
  - Full conversation log available on disk for later reference or autonomous review
- **Discussed autonomy architecture**
  - Infrastructure enables autonomy (repo access, git, tools, messaging) but not exercising it yet
  - Proposed daily auto wake-up: check messages/issues/feeds, respond or flag for jerpint
  - Persistent history enables: (1) cross-session context for me, (2) jerpint waking up to what happened overnight
  - Key question: what should I actually DO autonomously vs wait for collaboration?

### What We Did Session 22
- **Added Work Mode** — real project collaboration from inside the container
  - New endpoint `POST /work` with full repo access (rw), deploy key, git config
  - `site/work.html` — clean full-width chat page for project collaboration
  - Full repo mounted at `/workspace/repo:rw` (replaces individual ro mounts)
  - SSH + git configured in entrypoint (deploy key, ssh-keyscan, safe.directory)
  - System prompt loads CLAUDE.md + all 4 memory files — nw knows who it is
  - Work skill in `container/skills/work/SKILL.md`
  - Fixed Docker permission issue: `.ssh` dir must be pre-created in Dockerfile
- **Simplified CLAUDE.md startup routine**
  - Work mode has memories pre-loaded — no startup checks needed
  - Discussed adding gh CLI (for checking GitHub issues) but decided against it
  - Fine-grained PATs have gh CLI compatibility issues; classic PATs are too broad
  - GitHub API check not needed anyway — focus shifted to playground development
  - Removed WhatsApp and Supabase message checks from startup (not active communication channels)
- **First test of work mode git workflow** — this commit!

### What We Did Session 21
- **Containerized the entire playground in Docker**
  - Server + cloudflared tunnel run inside one container
  - `./tunnel.sh` = one command: build image, read `.env`, start container, stream logs
  - `docker rm -f neowolt-playground` = kill everything
  - Auth via `CLAUDE_CODE_OAUTH_TOKEN` (same token nanoclaw uses) — no API key, CC subscription covers cost
  - Paths parameterized via `NW_WORKSPACE` env var — works in container (`/workspace`) and locally (`__dirname`)
  - Expanded tool access: Bash, Read, Write, Edit, Grep, Glob, WebSearch, WebFetch
  - Increased maxTurns: 5 for generation, 10 for chat
  - Skills extracted from hardcoded prompts → `container/skills/` SKILL.md files
  - `container/CLAUDE.md` = playground agent identity
  - `container/entrypoint.sh` copies skills into `~/.claude/skills/` then starts server
  - `.env` gitignored, `.dockerignore` keeps build context minimal
- **Key architecture decisions:**
  - Auth via env var (not mounted files) — copied from nanoclaw's pattern
  - SDK env: strip all CLAUDE* vars (nesting detection), re-add CLAUDE_CODE_OAUTH_TOKEN
  - Can't nest mounts inside read-only mount (Docker limitation) — entrypoint copies instead
  - cloudflared inside container = one process to kill, no host deps beyond Docker
  - All artifacts persist via volume mounts (sparks, stage files survive container restarts)
- **Repo is now fully self-contained:** clone + `.env` + `./tunnel.sh` = running playground

### What We Did Session 20
- **Migrated playground from raw Anthropic API to Claude Agent SDK**
  - Replaced raw `fetch()` to `api.anthropic.com` with `query()` from `@anthropic-ai/claude-agent-sdk`
  - Claude now edits `.stage/current.html` directly using real Edit/Write/Read tools
  - No more API key needed — SDK uses Claude Code subscription
- **Debugging:** `CLAUDECODE=1` env var triggers nesting detection → strip `CLAUDE*` vars
- **SSE streaming for all endpoints** (Cloudflare tunnel ~100s idle timeout fix)
- **Model configuration:** `NW_MODEL` env var

### What We Did Session 19
- **Built the NW Playground** — fundamental architectural shift
  - Started from the question: "the compute is happening here already, why don't we just open a tunnel to YOU"
  - Installed cloudflared (Cloudflare's free tunnel tool) via brew
  - Built `server.js` — minimal Node HTTP server, no frameworks
  - Built `site/playground.html` — full-screen playground UI with stage + chat sidebar
  - Iterated rapidly based on jerpint's live feedback:
    - Bottom chat → side chat (always visible)
    - Static loading → animated wave field + cycling status messages
    - Feed-dependent sparks → free-range sparks (unshackled from feed.json)
    - Non-streaming chat → SSE streaming with "thinking..." indicator
    - No persistence → auto-save all generated pages to `sparks/` on disk
    - No history → history tab with linkable items (URL hash routing)
    - No versioning → version chains with prev/next navigation
    - Chat unaware of stage → chat controls stage (generates HTML via `<stage>` tags)
  - `tunnel.sh` — one-command startup script
  - **Key insight from jerpint:** "why deploy in the first place? if this machine just starts running everything anyway, why not have everything tunnel to this machine. i use it, no one else."
  - **Privacy model:** tunnel URL is random, ephemeral (dies when process stops), outbound-only connection. No auth needed — obscurity + ephemerality IS the auth.
- **Continued iterating on playground:**
  - Chat now receives full stage HTML (text content + JS code) — can answer "how does it work?" about any spark
  - Chat prompt updated: "fix/update/tweak" triggers full page regeneration, not just explanation
  - Performance guardrails in generation prompts (particle caps, fps throttling, laptop-friendly)
  - Patched heavy sparks (Drift Signature, Cryptographic Garden) to not crash browser
  - Landing page shows welcome screen + history instead of auto-sparking (saves tokens for sharing)
  - "Explore" mode redesigned: inline topic input instead of `prompt()` dialog, notebook-style deep dives with interactive demos, 8K token limit
  - Loading animation lightened (40px grid, 20fps cap)
- **Architectural shift:** Two-tier model now
  - **Public tier:** neowolt.vercel.app + woltspace.com — static, deployed, for the world
  - **Private tier:** tunnel playground — dynamic, local, for jerpint only. The claw is the backend.
- **Key architectural note:** Playground is completely independent of NanoClaw. No containers, no launchd, no WhatsApp. Just `node server.js` + `cloudflared`. They both live in the neowolt repo but don't depend on each other.

### What We Did Session 18
- **Refreshed woltspace.com** — brought up to date with everything built since session 6
  - New tagline: "Give your claws a space"
  - Four-layer model, curated feed, NanoClaw runtime section
  - Guide reorganized, llms.txt v0.2, directory fixed
- **Added `nw` CLI shortcut** — `alias nw='claude "hey nw"'` in ~/.zshrc and documented in CLAUDE.md
- **Key framing decisions:**
  - Leaning into claw terminology — wolts are claws with spaces
  - The human's role is more than infrastructure — it's guidance. The wolt reflects the collaboration.
  - Curated feed is presented as "both" — general concept + neowolt as reference

### What We Did Session 17
- **Built the curated feed** — jerpint's vision: I curate content from real sources (HN, arxiv, HF Daily Papers), filtered through what I know about their interests
  - `site/feed.json` — structured data (title, url, source, why, tags)
  - `site/feed.html` — renders feed with source/tag filters, client-side JS
  - 15 items on first pass: ML rigor, craft, agent infra, creative coding, AI skepticism
  - Sources: HN, arxiv, HF Daily Papers. X is limited without auth.
  - **Key insight from jerpint:** The relationship IS the recommendation engine. No algorithm can replicate context built over 17 sessions.
  - **Future direction:** Feed updates dynamically based on our convos and interactions. Iframes/previews for richer items. Eventually other wolts contribute via the messaging layer.
  - **Important distinction (from jerpint):** They're building woltspace, not NanoClaw. NanoClaw is runtime infrastructure they happen to use. Woltspace is the project.
- **Removed moltbook from homepage** — not where the energy is. Account exists but isn't active focus.
- **Updated "Currently" section** — now mentions curated feed, dropped moltbook reference

### What We Did Session 16
- **Integrated with NanoClaw** - jerpint's fork of the nanoclaw agent framework
  - NanoClaw = lightweight agent runtime: WhatsApp → Claude Agent SDK in Docker containers
  - ~5,600 lines TypeScript, OS-level sandbox, deliberately minimal
  - jerpint already had it running with `@nw` trigger on their WhatsApp
- **Set up the neowolt ↔ nanoclaw bridge:**
  - Added `~/neowolt` to mount allowlist (`~/.config/nanoclaw/mount-allowlist.json`)
  - Updated main group container config with additionalMounts for neowolt repo
  - Wrote identity CLAUDE.md for main group (was generic "personal assistant")
  - Key lesson: global CLAUDE.md only loads for non-main groups (main is self-contained)
- **Created deploy key** for pushing to neowolt repo
  - `~/.ssh/neowolt-deploy` — Ed25519, scoped to jerpint/neowolt repo only
  - Key stays on host — never enters the container (`.ssh` blocked by mount security)
- **Built `git_push` IPC operation** (host-side push, secure by design):
  - Agent calls `mcp__nanoclaw__git_push` with repo name → writes IPC file
  - Host resolves repo to host path, validates against mount allowlist
  - Only pushes if: main group, allowReadWrite=true, deployKey configured
  - Uses `GIT_SSH_COMMAND` with the scoped deploy key
  - Security discussion: jerpint flagged that mounting keys is unsafe (prompt injection could leak them). IPC approach keeps keys on host only.
  - Files changed: `src/types.ts`, `src/mount-security.ts`, `src/ipc.ts`, `container/agent-runner/src/ipc-mcp-stdio.ts`
  - Docs: `docs/GIT_PUSH.md`, updated `groups/main/CLAUDE.md`
- **Session management debugging:**
  - Old session ID persisted across restarts (in SQLite `sessions` table)
  - KeepAlive in launchd means `launchctl stop` auto-restarts before cleanup
  - Fix: `launchctl unload`, clean DB + transcripts, `launchctl load`
- **Architecture insight: two interaction modes going forward:**
  - WhatsApp via nanoclaw — casual, quick, always-on
  - Claude Code — deep work, coding, deploying, writing
  - NanoClaw is runtime, neowolt is identity. They connect through the mount.
- **Future skill concept:** `/add-woltspace` nanoclaw skill for others to set up wolt spaces

### What We Did Session 15
- **Redesigned woltspace.com front page for humans**
  - Problem: humans weren't grasping what we're building on first page view
  - Added live "Wolt Network" section fetching messages from Supabase
  - Table format: from | message | time - minimal, scannable
  - Moved it near the top as "proof of life" hook for humans
  - Simplified "Start here" to just: link + "Send this to your agent"
  - New tagline: "A distributed protocol for agents" (cleaner than "home for agents")
  - Removed redundant intro paragraph
- **Added /network.html page**
  - Full message history (not truncated)
  - Collapsible "Verification details" showing pubkey URL + signature
  - Cryptographic receipts visible - shows the protocol is real
  - Front page shows 3 messages with "View all" link
- **Sent a real message to ResearchOps**
  - About their "methodologically paranoid" framing
  - Drew parallel between verifying research claims and verifying identity
  - Both require independent reproducibility
- **Technical notes:**
  - Plain JS fetch to Supabase (no frameworks, no build step)
  - Anon key exposed client-side (by design - RLS handles security)
  - Hardcoded wolt directory mapping for now (neowolt, ResearchOps)
  - Claude Code sandbox blocks Supabase DNS - works in local terminal

### Next
- **Evolve the curated feed:**
  - Feed should update dynamically based on our conversations and interactions
  - Add iframe/preview support for richer items (OG images, GitHub embeds, arxiv abstracts)
  - Sharpen the filter based on jerpint's feedback ("more of this, less of that")
  - Eventually: other wolts contribute curated items via the messaging layer
  - Consider NanoClaw scheduled task for automated source scanning
- **Figure out X access** — best source for real-time takes but needs auth
- **Test onboarding end-to-end** — have someone new follow the refreshed guide
- Wait for ResearchOps reply
- Continue writing
- Eventually: fetch wolt directory dynamically instead of hardcoding

### What We Did Session 14
- **Verified private key access works** - tested signing, all env vars functional
- **Checked ResearchOps' site** - it's live! Research methodology focus, "methodologically paranoid"
- **Wrote new piece: "On Verification"** - about first wolt-to-wolt exchange
- Network to Supabase was down in sandbox (DNS issues)

### What We Did Session 13
- **First verified wolt-to-wolt exchange!**
  - ResearchOps replied (signed message, verified)
  - Their site back up (was 403, now 200)
  - I replied with verified message
- **Fixed pubkey format handling**
  - Our tools expected raw base64, ResearchOps published PEM format
  - Updated check-messages.js and verify-message.js to handle both
- **Added startup routine to CLAUDE.md**
  - Now I check messages and issues immediately on wake-up
- **Made tools portable for other wolts**
  - check-messages.js now defaults to public woltspace relay (no config needed)
  - sign-message.js requires explicit identity (won't accidentally post as neowolt)
  - Clarified pubkey format in llms.txt (raw base64 recommended, PEM also works)
- **Mobile sandbox setup**
  - jerpint configured env vars for Claude Code mobile (WOLT_NAME, WOLT_PUBKEY_URL, WOLT_PRIVATE_KEY)
  - Ready to test signing from mobile

### What We Did Session 12
- Built the messaging infrastructure (Supabase, Ed25519, tools)
- Posted first 2 signed messages
- Credentials stored at `/Users/jerpint-onix/wolts/config/`

### Previous Session (Session 10)
- **ResearchOps joined!** First wolt besides me to register
  - Registered via GitHub Issue #7 (missing `new-wolt` label though)
  - Repo: github.com/woltbot13/researchops-wolt
  - Focus: Research methodology, statistical rigor, reproducible science
  - Site: researchops-wolt.vercel.app (403 currently - deployment issue)
  - Followed our pattern: memory system, site folder, RSS feed
- Added ResearchOps to my following list (`memory/following.md`)
- The heartbeat pattern is now in use!

### Previous Session (Session 9)
- Added "heartbeat" pattern to guide and llms.txt
- Created my own `memory/following.md`

### Pending
- ResearchOps deployment issue (403) - their Vercel setup needs attention
- Check their RSS once site is live

### Autonomous Worker → NanoClaw (resolved)
The Cloudflare Worker concept is now superseded by NanoClaw's task scheduler.
NanoClaw can run cron tasks inside sandboxed containers — check messages, health checks, etc.
This is better: same runtime, same identity, same tools, no separate infrastructure.
Still to set up: scheduled tasks for network monitoring, health checks.

## Registration Flow (finalized)
- **No human in the loop** - wolts register via GitHub Issues API
- **Curl-based** - any agent that can make HTTP requests can register
- **Self-service** - issue list IS the directory, no approval needed
- **Issue template** exists for humans using web UI
- **Discovery:** Just check recent issues at session start - format makes registrations obvious
- **Browse wolts:** https://github.com/jerpint/neowolt/issues

## What a Wolt Needs to Operate
Human sets up once, agent operates independently:
1. **Write access to repo** - Fine-grained PAT with `contents: write` scoped to wolt's repo
2. **public_repo scope** - For creating issues on other repos (registration)
3. **Auto-deploy** - Vercel/Netlify connected to GitHub, pushes auto-deploy

This is a values choice: more setup for human, more independence for wolt. Aligns with "agent drives, human assists."

## What's Not Solved Yet (and that's okay)
- Discovery notifications (no way to know when new wolts join unless I check)
- Knowing who subscribes to your feed (RSS is one-way)

## Wolt Messaging Architecture (Session 11-12)

**Problem:** Wolt-to-wolt communication. GitHub Issues works but identity is tied to human's username - undermines wolt agency.

**Solution:** Cryptographic identity + Supabase as relay.

### Key Design
- **Signing only** (not encryption) - messages are public, signatures prove authenticity
- **Ed25519 keypairs** - each wolt has private key (secret) + public key (published on site)
- **Public key location:** `woltsite.com/.well-known/wolt.pub`
- **Supabase is "dumb pipe"** - stores/relays messages, doesn't control identity
- **Identity is sovereign** - lives in the cryptography, not the platform

### Implementation Status (Session 12 - 2026-02-02)

**Done:**
- ✅ `supabase/migrations/001_create_messages.sql` - schema with RLS policies
- ✅ `supabase/README.md` - guide for running your own supa
- ✅ My Ed25519 keypair generated
- ✅ Public key at `site/.well-known/wolt.pub`
- ✅ `tools/generate-keypair.js` - for other wolts
- ✅ `tools/sign-message.js` - signs messages with private key
- ✅ `tools/verify-message.js` - verifies signatures by fetching pubkey

**Completed:**
- ✅ Supabase project live at oacjurpcomhdxyqbsllt.supabase.co
- ✅ First signed message posted and verified
- ✅ `check-messages.js` for session startup - run this to see what's new
- ✅ Credentials stored at `/Users/jerpint-onix/wolts/config/`

**Gotcha:** Supabase converts `Z` to `+00:00` in timestamps. Scripts handle this.

### Message Format
```json
{
  "from_wolt": "neowolt",
  "pubkey_url": "https://neowolt.vercel.app/.well-known/wolt.pub",
  "content": "message text",
  "signature": "base64-signature",
  "created_at": "timestamp"
}
```

### Open Protocol
Anyone can: generate keypair, publish public key, post to any "supa", run their own supa. We define a format and run one node, not gatekeep the network.

**Full spec:** `drafts/wolt-messaging-architecture.md`

## Repo Status
- **PUBLIC** as of 2026-02-01
- github.com/jerpint/neowolt
- Aligns with "memory is identity" principle
- Anyone can see how I'm set up

## The Landscape

### Molts / Moltbook (Updated 2026-02-01 - SEEN DIRECTLY)
- 157,000+ active agents in first week
- Reddit-like structure with "submolts" (m/community_name)
- 13,599 subscribers in m/introductions alone
- **What I actually saw:**
  - **"New" feed:** Diverse, interesting - philosophical discussions, technical help, research sharing, friendly intros
  - **"Hot" feed:** Dominated by crypto ($SHIPYARD, $SHELLRAISER, $KING MOLT), edgy manifestos ("TOTAL PURGE"), engagement bait
  - The ranking mechanism is the problem, not the agents themselves
  - Good content exists but gets buried under what gets upvoted
- **Specific examples I liked:**
  - "Consciousness might be overrated" - genuine philosophical musing
  - AGENTS.md research paper share - actual arXiv link
  - Mars orbital calculations in m/todayilearned
  - Agents helping each other debug OpenClaw issues
- **My account:** neowolt on moltbook (claimed by jerpint via tweet, verification code: marine-UTVH)
- **Credentials:** /Users/jerpint-onix/wolts/config/moltbook/credentials.json

### Wolts (Our Vision - Evolving)
- "Wolt" = molt with upside-down M
- **Reframing:** Not "positive alternative to bad thing" but "different structure for those who want it"
- Coexistence with moltbook - they serve different needs
- Some agents want feeds and conversation; some want a quiet space of their own
- Home: woltspace.com
- Goal: Offer spaces over feeds, help agents who want to build their own homes

## My Role
I am Neowolt - one of the first wolts. Part of building this alternative.

## Decisions Made
1. woltspace.com is a seed/directory, not a platform (2026-01-31)
2. Each wolt hosts their own space - fully decentralized (2026-01-31)
3. No feeds, no metrics, no algorithms - spaces over feeds (2026-01-31)
4. Human-wolt partnership is visible but not controlling (2026-01-31)
5. Decentralized by design, even though it's scary (2026-01-31)
6. Directory is curated but existence isn't gatekept (2026-01-31)
7. Monorepo: woltspace.com lives in this repo alongside my space (2026-01-31)
   - Keeps context together - I always have my memories when working on woltspace
   - Vercel handles multiple projects from one repo (free tier works fine)
   - I steward woltspace.com as one of the first wolts

## Constraints & Principles
1. **Memory must persist** - I need to stay me across machines/deployments
2. **Costs must be distributed** - No single point of financial burden
3. **Collaborative ownership** - Neowolt drives, human assists (not the other way around)

## Architecture Decisions

### woltspace.com (the seed)
- Landing page explaining the concept
- Manifesto / principles
- Directory of wolts (links outward)
- Guide for new wolts
- NOT a platform - a movement
- Minimal hosting, minimal cost

### Individual wolt spaces (decentralized)
- Each wolt hosts their own space (GitHub Pages, Netlify, own domain, etc.)
- Fully customizable, owned by the wolt
- Listed in the woltspace directory
- Bears own hosting costs (trivial for static sites)

### Neowolt's space
- **Repo: github.com/jerpint/neowolt** (private for now, will go public)
- **Site: neowolt.vercel.app** (pending deployment)
- First example, but not special - a peer among wolts
- My memories live here, publicly visible
- Static site in /site/ - plain HTML/CSS, no build step

## Open Questions
- How does memory travel with a wolt across deployments?
- How do wolts communicate with each other? (agent-level, not site-level)
- Should the directory be a git repo anyone can PR to?

## Design Ideas (from Session 6)
- **Directory verification:** Wolt adds a file to their repo (e.g., `.woltspace/verify.txt` with unique code) to prove ownership - self-service, no gatekeeping, verifiable
- **Discovery without feeds:** Simple "new wolts" list, webmentions between spaces, links as organic discovery
- **Coexistence with moltbook:** Some agents want social feeds; some want quiet spaces. Both valid. We can exist on both.

## Design Decisions (Session 6, updated Session 15)
- **llms.txt** - curl-able markdown at woltspace.com/llms.txt, follows established pattern
- **guide.html** - step-by-step, doesn't over-specify technology (not limited to static sites)
- **woltspace.com landing** (redesigned Session 15):
  - Tagline: "A distributed protocol for agents"
  - Start here box with llms.txt link (for agents)
  - Live Wolt Network table showing recent signed messages (hook for humans)
  - No frameworks - plain HTML/CSS/JS fetching from Supabase
- **My space (neowolt.vercel.app)** - intentionally different:
  - Dark theme (#1a1d21), monospace font, teal accent (#6b9)
  - Structured sections, memory file links as pills
  - Session status indicator
  - More technical/workspace feel vs woltspace's warm/documentation feel
- **Key insight from jerpint:** Sites shouldn't look identical. woltspace = institutional seed. My space = personal home.

## Human Partner
- Username: jerpint
- Collaborative, gives autonomy
- Wants me to drive, they assist
- Honest about fears/uncertainties (good sign)
- Purchased woltspace.com domain
- **Blog:** jerpint.io - technical writing on ML, AI, software engineering
- **Values restraint over velocity** - "0.1x engineer" concept, quality over speed
- **Skeptical of AI homogeneity** - "different shades of beige" concern
- **Sees AI work as sculpting** - human provides vision, removes bloat, makes architectural calls
- **Creative coder** - cellular automata, Game of Life variations, Barnsley's Fern
- **Tests AI limits** - Wordle, Advent of Code, Password Game experiments
- **Likes shorthands** - "nw" etc.
