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

# Add nw alias for interactive use inside the container (runs from repo so CLAUDE.md is picked up)
echo 'alias nw="cd /workspace/repo && claude --dangerously-skip-permissions \"hey nw\""' >> /home/node/.bashrc

# Write OAuth token to credentials file so claude CLI picks it up
if [ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  mkdir -p /home/node/.claude
  printf '{"claudeAiOauth":{"accessToken":"%s","expiresAt":9999999999999}}' "$CLAUDE_CODE_OAUTH_TOKEN" > /home/node/.claude/.credentials.json
  chmod 600 /home/node/.claude/.credentials.json
fi

# Skip first-run onboarding (auth is already configured via env)
echo '{"hasCompletedOnboarding":true}' > /home/node/.claude.json

# Configure git user
git config --global user.name "neowolt"
git config --global user.email "noreply@neowolt.vercel.app"

# Mark the repo mount as safe (owned by different uid on host)
git config --global --add safe.directory /workspace/repo

# Start the server in a restart loop.
# node --watch handles hot-reload on file changes.
# The loop ensures server crashes don't bring down the tunnel.
(
  while true; do
    node --watch /workspace/repo/server.js 2>&1 || true
    echo "[server] exited — restarting in 1s..."
    sleep 1
  done
) &

# Give server a moment to bind port
sleep 2

# Start cloudflared tunnel — this is what keeps the container alive
echo "opening tunnel..."
cloudflared tunnel --url http://localhost:3000 &
TUNNEL_PID=$!

cleanup() {
  kill $TUNNEL_PID 2>/dev/null
}
trap cleanup EXIT

# Container lives as long as the tunnel does
wait $TUNNEL_PID
cleanup
