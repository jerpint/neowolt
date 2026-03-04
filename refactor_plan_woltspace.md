# Plan: Restructure repo with `wolt/` directory

## Context

We're restructuring the neowolt repo so that all wolt-identity files live under `wolt/`. The goal: the template repo IS the infrastructure, and `wolt/` is the only thing that changes per-wolt. Cloning the template + dropping in your `wolt/` folder = a running wolt identical to the current state.

Branch: `wolt-structure` (already created, branched from main)

## Step 1: Move identity files into `wolt/`

```bash
git mv memory/ wolt/memory/
git mv site/ wolt/site/
git mv sparks/ wolt/sparks/      # tracked sparks only
git mv drafts/ wolt/drafts/
```

`tools/` — dead crypto utils, delete them (not used anywhere).

## Step 2: Move `supabase/` under `woltspace/`

```bash
git mv supabase/ woltspace/supabase/
```

## Step 3: Update path references

### `server.js` (~6 changes)
- `SITE_DIR`: `join(WORKSPACE, 'repo', 'site')` → `join(WORKSPACE, 'repo', 'wolt', 'site')`
- `MEMORY_DIR`: `join(WORKSPACE, 'repo', 'memory')` → `join(WORKSPACE, 'repo', 'wolt', 'memory')`
- Everything downstream (watch, static serving, memory loading) follows from these two constants — no other changes needed since they all use `SITE_DIR`/`MEMORY_DIR`.
- Sparks: `SPARKS_DIR = join(WORKSPACE, 'sparks')` — this is already at `/workspace/sparks` (outside repo dir), so no change needed in server.js. But `tunnel.sh` mount source changes (see below).

### `container/cron/digest.mjs` (~3 changes)
- `MEMORY_DIR`: update to `join(REPO_DIR, 'wolt', 'memory')`
- `SPARKS_DIR`: update to `join(REPO_DIR, 'wolt', 'sparks')` (or keep writing to `/workspace/sparks` — but since we want sparks in wolt/, align it)
- Any other `REPO_DIR + 'memory'` or `REPO_DIR + 'sparks'` references

### `tunnel.sh` (~2 changes)
- Volume mount for sparks: `$(pwd)/sparks` → `$(pwd)/wolt/sparks`
- Volume mount for stage: stays at `$(pwd)/.stage` (runtime, not identity)
- The full repo is already mounted as `/workspace/repo:rw` so `wolt/` is accessible inside container

### `container/entrypoint.sh`
- Check if it references `memory/` or `site/` directly — update if so

### `vercel.json`
- `"outputDirectory": "site"` → `"outputDirectory": "wolt/site"`

### `CLAUDE.md`
- Update references: `memory/` → `wolt/memory/`, `site/` → `wolt/site/`, `drafts/manifesto.md` → `wolt/drafts/manifesto.md`

### `.gitignore`
- Update any paths that reference moved directories (`.digest/`, `site/pages/` → `wolt/site/pages/`)

### `container/skills/*/SKILL.md`
- Skills reference `memory/`, `sparks/`, `site/` in their instructions to the LLM
- Update all path references to `wolt/memory/`, `wolt/sparks/`, `wolt/site/`
- Dead skills (explore, remix, spark, stage, workspace) — delete them, only keep `digest` and `work`

### `CLAUDE.md` — split identity from infrastructure
- Currently mixes project instructions with wolt identity ("I go by Neowolt")
- Keep `CLAUDE.md` at root as generic project instructions (how to run, directory structure, working principles)
- Identity-specific content already lives in `wolt/memory/identity.md` — remove duplication from root CLAUDE.md
- This makes CLAUDE.md template-friendly: same file works for any wolt

## Step 4: Update memory files

- `memory/context.md`, `memory/identity.md`, `memory/learnings.md` — update any self-referential paths (e.g. "memories live in `memory/`" → "memories live in `wolt/memory/`")

## Step 5: Verify

1. `git status` — confirm all moves tracked, no orphaned references
2. `grep -r 'memory/' --include='*.js' --include='*.sh' --include='*.md' --include='*.json'` — verify no stale path references to old locations
3. `grep -r '"site/' --include='*.js' --include='*.sh' --include='*.json'` — same for site
4. `grep -r 'sparks/' --include='*.js' --include='*.sh' --include='*.json'` — same for sparks
5. `grep -r 'drafts/' --include='*.md'` — same for drafts
6. Confirm the structure looks right: `find wolt/ -type f | head -30`

## Step 6: Commit

Single commit: "Restructure: move identity files under wolt/"

## Files modified (summary)

| Action | File |
|--------|------|
| **git mv** | `memory/` → `wolt/memory/` |
| **git mv** | `site/` → `wolt/site/` |
| **git mv** | `sparks/` → `wolt/sparks/` |
| **git mv** | `drafts/` → `wolt/drafts/` |
| **git mv** | `supabase/` → `woltspace/supabase/` |
| **delete** | `tools/` (dead code) |
| **edit** | `server.js` — SITE_DIR, MEMORY_DIR paths |
| **edit** | `container/cron/digest.mjs` — MEMORY_DIR, SPARKS_DIR |
| **edit** | `tunnel.sh` — volume mount for sparks |
| **edit** | `vercel.json` — outputDirectory |
| **edit** | `CLAUDE.md` — directory references |
| **edit** | `.gitignore` — updated paths |
| **edit** | `wolt/memory/*.md` — self-referential paths |
| **edit** | `container/skills/*/SKILL.md` — path references |
| **delete** | `container/skills/{explore,remix,spark,stage,workspace}/` — dead skills |
