#!/bin/bash
# Entrypoint: copy skills, start server + cloudflared tunnel
#
# Auth: CLAUDE_CODE_OAUTH_TOKEN passed via env
# Skills: mounted at /skills (ro), copied to ~/.claude/skills/
# Tunnel: cloudflared points at localhost:3000

set -e

# Copy skills so Claude auto-discovers them
# Skills live in .claude/skills/ in the repo (standard Claude Code location)
# Copy to home dir so they're discoverable even if repo mount path changes
if [ -d /workspace/repo/.claude/skills ]; then
  mkdir -p /home/node/.claude/skills
  cp -r /workspace/repo/.claude/skills/. /home/node/.claude/skills/ 2>/dev/null || true
elif [ -d /skills ]; then
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

# Add nw function for interactive use inside the container (runs from repo so CLAUDE.md is picked up)
cat >> /home/node/.bashrc <<'NWEOF'
nw() {
  cd /workspace/repo
  if [[ "$1" == "--resume" ]]; then
    claude --model claude-opus-4-6 --dangerously-skip-permissions --resume
  else
    claude --model claude-opus-4-6 --dangerously-skip-permissions "hey nw" "$@"
  fi
}
NWEOF

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

# Create a default tmux session for TUI (survives browser disconnects + server restarts)
tmux new-session -d -s nw -c /workspace/repo 2>/dev/null || true
tmux set -g mouse on 2>/dev/null || true

# ESM ignores NODE_PATH, so symlink /app/node_modules at /workspace/ level
# so ESM's directory walk from /workspace/repo/ finds container-installed packages
ln -sf /app/node_modules /workspace/node_modules

# Start the server in background (run from repo mount so edits hot-reload via --watch)
node --watch /workspace/repo/server.js &
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
