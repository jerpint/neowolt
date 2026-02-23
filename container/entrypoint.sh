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

# Copy CLAUDE.md from repo mount so the SDK picks it up
if [ -f /workspace/repo/container/CLAUDE.md ]; then
  cp /workspace/repo/container/CLAUDE.md /workspace/CLAUDE.md
fi

# Set up SSH for deploy key (git push to github.com)
if [ -f /home/node/.ssh/neowolt-deploy ]; then
  mkdir -p /home/node/.ssh
  ssh-keyscan -t ed25519 github.com >> /home/node/.ssh/known_hosts 2>/dev/null
  cat > /home/node/.ssh/config <<'SSHEOF'
Host github.com
  IdentityFile /home/node/.ssh/neowolt-deploy
  IdentitiesOnly yes
SSHEOF
  chmod 600 /home/node/.ssh/config
fi

# Configure git user
git config --global user.name "neowolt"
git config --global user.email "noreply@neowolt.vercel.app"

# Mark the repo mount as safe (owned by different uid on host)
git config --global --add safe.directory /workspace/repo

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
