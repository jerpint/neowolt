#!/bin/bash
# Start neowolt playground in Docker + cloudflared tunnel
# Usage: ./tunnel.sh

set -e
cd "$(dirname "$0")"

CONTAINER_NAME="neowolt-playground"
IMAGE_NAME="neowolt-playground"

# Read OAuth token from local .env
OAUTH_TOKEN=$(grep '^CLAUDE_CODE_OAUTH_TOKEN=' .env 2>/dev/null | cut -d= -f2-)
if [ -z "$OAUTH_TOKEN" ]; then
  echo "error: CLAUDE_CODE_OAUTH_TOKEN not found in .env"
  echo "hint: add CLAUDE_CODE_OAUTH_TOKEN=<token> to .env"
  exit 1
fi

# Build the image
echo "building container..."
docker build -t "$IMAGE_NAME" -f container/Dockerfile .

# Stop any existing container
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true

# Run the container
echo "starting container..."
docker run -d \
  --name "$CONTAINER_NAME" \
  -p 3000:3000 \
  -v "$(pwd)/site:/workspace/site:ro" \
  -v "$(pwd)/sparks:/workspace/sparks:rw" \
  -v "$(pwd)/.stage:/workspace/.stage:rw" \
  -v "$(pwd)/memory:/workspace/memory:ro" \
  -v "$(pwd)/container/CLAUDE.md:/workspace/CLAUDE.md:ro" \
  -v "$(pwd)/container/skills:/skills:ro" \
  -e NW_WORKSPACE=/workspace \
  -e CLAUDE_CODE_OAUTH_TOKEN="$OAUTH_TOKEN" \
  "$IMAGE_NAME"

echo "container started: $CONTAINER_NAME"

# Give it a moment to start
sleep 2

# Check it's running
if ! docker ps --format '{{.Names}}' | grep -q "$CONTAINER_NAME"; then
  echo "container failed to start. logs:"
  docker logs "$CONTAINER_NAME"
  exit 1
fi

# Start the tunnel
echo "opening tunnel..."
cloudflared tunnel --url http://localhost:3000 2>&1 &
TUNNEL_PID=$!

# Cleanup on exit
cleanup() {
  echo "stopping..."
  docker rm -f "$CONTAINER_NAME" 2>/dev/null
  kill "$TUNNEL_PID" 2>/dev/null
  echo "tunnel closed."
}
trap cleanup EXIT

wait
