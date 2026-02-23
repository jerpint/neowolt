#!/bin/bash
# Entrypoint: copy skills into Claude's discovery path, then start server
#
# Auth: CLAUDE_CODE_OAUTH_TOKEN passed via env (not mounted files)
# Skills: mounted at /skills (ro), copied to ~/.claude/skills/

set -e

# Copy skills so Claude auto-discovers them
if [ -d /skills ]; then
  mkdir -p /home/node/.claude/skills
  cp -r /skills/. /home/node/.claude/skills/ 2>/dev/null || true
fi

exec node /app/server.js
