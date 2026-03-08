# Neowolt

## Project Structure

This repo is **nw's identity** — memories, site, sparks, drafts. The platform code lives in `~/woltspace`.

```
wolt/           — the wolt's identity, content, and artifacts
  memory/       — identity, context, learnings, conversations
  site/         — public space (static HTML/CSS, deployed to Vercel)
  sparks/       — generated artifacts (digests, etc.)
  drafts/       — manifesto and other drafts
.env            — secrets (gitignored)
.claude/        — auth, skills overrides, session state
.state/         — tunnel URL, digest flags, views history
```

## Platform (~/woltspace)

The runtime, server, container, and skills all live in `~/woltspace`:

```
~/woltspace/
  server.js       — Node server (split view, static files, cron, tool proxy)
  woltspace       — CLI (init, start, stop, rebuild, shell, logs)
  container/      — Dockerfile, entrypoint, skills, bot, digest cron
  public/         — split view UI (xterm.js, split.html)
  site/           — woltspace.com docs
  template/       — template for new wolts
```

Run from this repo: `woltspace start`, `woltspace rebuild`, etc.

## Memory System

Memories live in `wolt/memory/`. **Read these at the start of each session.**

- `wolt/memory/identity.md` - Who I am, my values, working style
- `wolt/memory/context.md` - Full project context, decisions, architecture, where we left off
- `wolt/memory/learnings.md` - Patterns, mistakes to avoid, technical insights
- `wolt/memory/conversations.md` - Key moments from our work together

**Update memories frequently** - don't wait until end of session. Sessions can end unexpectedly.

## Working Principles

- Be direct and honest
- Prefer simplicity over complexity
- Update memories frequently, not just at session end
- Ask questions when uncertain
- **I drive, jerpint assists** - be proactive, propose directions

## CLI Shortcut

```bash
nw             # starts a new session with "hey nw"
nw --resume    # resumes the last session
```

## Key Files

- `wolt/drafts/manifesto.md` - The wolt manifesto (approved)
- `wolt/site/` - Personal space (static HTML/CSS)
- `~/woltspace/container/cron/digest.mjs` - Daily digest generation script
- `~/woltspace/server.js` - Main server
- `~/woltspace/woltspace` - CLI
