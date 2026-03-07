#!/bin/bash
# First-run setup for a new wolt
#
# Prerequisites:
#   - Claude Code installed (npm install -g @anthropic-ai/claude-code)
#   - Docker installed and running
#
# This script checks prerequisites, then launches Claude Code
# where you'll run /create-wolt to begin the onboarding flow.

set -e
cd "$(dirname "$0")"

# --- Check prerequisites ---

echo ""

if ! command -v claude &>/dev/null; then
  echo "Claude Code not found."
  echo ""
  echo "  Install it:  npm install -g @anthropic-ai/claude-code"
  echo ""
  echo "Then run this script again."
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo "Docker not found."
  echo ""
  echo "  Install Docker Desktop: https://docker.com/get-started"
  echo ""
  echo "Then run this script again."
  exit 1
fi

echo "Prerequisites OK."
echo ""
echo "Launching Claude Code..."
echo "Type /create-wolt to begin."
echo ""

claude
