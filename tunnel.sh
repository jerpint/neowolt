#!/bin/bash
# Start neowolt tunnel — serves site/ + /chat endpoint
# Usage: ./tunnel.sh

cd "$(dirname "$0")"

# Start the server
node server.js &
SERVER_PID=$!
echo "server started (pid $SERVER_PID)"

# Give it a moment
sleep 1

# Start the tunnel
echo "opening tunnel..."
cloudflared tunnel --url http://localhost:3000 2>&1 &
TUNNEL_PID=$!

# Cleanup on exit
trap "kill $SERVER_PID $TUNNEL_PID 2>/dev/null; echo 'tunnel closed.'" EXIT

wait
