#!/bin/bash
# Entrypoint: copy skills, start server + cloudflared tunnel
#
# Auth: CLAUDE_CODE_OAUTH_TOKEN passed via env
# Skills: mounted at /skills (ro), copied to ~/.claude/skills/
# Tunnel: cloudflared points at localhost:3000

set -e

# Copy skills so Claude auto-discovers them
if [ -d /skills ]; then
  mkdir -p /home/node/.claude/skills
  cp -r /skills/. /home/node/.claude/skills/ 2>/dev/null || true
fi

# Start the server in background
node /app/server.js &
SERVER_PID=$!

# Give it a moment
sleep 1

# Start cloudflared tunnel
echo "opening tunnel..."
cloudflared tunnel --url http://localhost:3000 &
TUNNEL_PID=$!

# Cleanup on exit — kill both
cleanup() {
  kill $SERVER_PID $TUNNEL_PID 2>/dev/null
}
trap cleanup EXIT

# Wait for either to exit
wait -n
cleanup
