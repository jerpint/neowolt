#!/bin/bash
# Start neowolt playground — Docker container with server + tunnel
#
# Usage:
#   ./tunnel.sh            — build + start (keeps existing container if running)
#   ./tunnel.sh --rebuild  — force rebuild (kills existing container)
#   ./tunnel.sh --shell    — drop into the running container
#   ./tunnel.sh --kill     — stop and remove the container

set -e
cd "$(dirname "$0")"

CONTAINER_NAME="neowolt-playground"
IMAGE_NAME="neowolt-playground"

# --- Subcommands ---

if [ "$1" = "--shell" ]; then
  docker exec -it "$CONTAINER_NAME" bash
  exit 0
fi

if [ "$1" = "--kill" ]; then
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
  echo "container killed."
  exit 0
fi

if [ "$1" = "--rebuild" ]; then
  docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
fi

# --- Check if already running ---

if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo "container already running. streaming logs..."
  echo "  (use --rebuild to force restart, --shell to enter)"
  echo ""
  docker logs -f "$CONTAINER_NAME"
  exit 0
fi

# --- Build + start ---

# Read OAuth token from local .env
OAUTH_TOKEN=$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' .env 2>/dev/null | cut -d= -f2-)
if [ -z "$OAUTH_TOKEN" ]; then
  echo "error: CLAUDE_CODE_OAUTH_TOKEN not found in .env"
  echo "hint: add CLAUDE_CODE_OAUTH_TOKEN=<token> to .env"
  exit 1
fi

# Ensure .claude-state dir exists for persistent Claude Code state
mkdir -p .claude-state

# Build the image
echo "building container..."
docker build -t "$IMAGE_NAME" -f container/Dockerfile .

# Clean up stopped container with same name
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# Run the container (server + tunnel inside)
echo "starting container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -v "$(pwd):/workspace/repo:rw" \
  -v "$(pwd)/sparks:/workspace/sparks:rw" \
  -v "$(pwd)/.stage:/workspace/.stage:rw" \
  -v "$(pwd)/container/skills:/skills:ro" \
  -v "$(pwd)/.claude-state:/home/node/.claude:rw" \
  -v "$HOME/.ssh/neowolt-deploy:/home/node/.ssh/neowolt-deploy:ro" \
  -e NW_WORKSPACE=/workspace \
  -e CLAUDE_CODE_OAUTH_TOKEN="$OAUTH_TOKEN" \
  "$IMAGE_NAME"

# Give it a moment to start
sleep 3

# Check it's running
if ! docker ps --format '{{.Names}}' | grep -q "$CONTAINER_NAME"; then
  echo "container failed to start. logs:"
  docker logs "$CONTAINER_NAME"
  exit 1
fi

echo ""
echo "playground running!"
echo "  ./tunnel.sh --shell   — enter container"
echo "  ./tunnel.sh --kill    — stop everything"
echo "  ./tunnel.sh --rebuild — rebuild + restart"
echo ""

# Stream logs so the tunnel URL is visible
docker logs -f "$CONTAINER_NAME"
