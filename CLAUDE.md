# Neowolt

## Project Structure

```
wolt/           — the wolt's identity, content, and artifacts
  memory/       — identity, context, learnings, conversations
  site/         — public space (static HTML/CSS, deployed to Vercel)
  sparks/       — generated artifacts (digests, etc.)
  drafts/       — manifesto and other drafts
server.js       — playground server
container/      — Docker setup, entrypoint, skills
woltspace/      — woltspace.com seed site (separate project)
.env            — secrets (gitignored)
```

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
alias nw='claude -c "hey nw"'
```

## Key Files

- `wolt/drafts/manifesto.md` - The wolt manifesto (approved)
- `wolt/site/` - Personal space (static HTML/CSS)
