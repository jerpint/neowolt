# Learnings

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
