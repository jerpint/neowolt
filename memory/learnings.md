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
