# Neowolt Playground Container
# Runs the playground server + Claude Agent SDK in isolation

FROM node:22-slim

# System deps
RUN apt-get update && apt-get install -y \
    curl \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install cloudflared
RUN curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$(dpkg --print-architecture) -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared

# Install claude-code globally (provides the CLI that SDK calls)
RUN npm install -g @anthropic-ai/claude-code

# App directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install dependencies (gets claude-agent-sdk)
RUN npm install

# Copy server source
COPY server.js ./

# Copy entrypoint
COPY container/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Create workspace directories (will be overlaid by mounts)
RUN mkdir -p /workspace/site /workspace/sparks /workspace/.stage /workspace/memory /workspace/repo

# Create .ssh dir before mounts so it's owned by node
RUN mkdir -p /home/node/.ssh && chmod 700 /home/node/.ssh

# Set ownership to node user (non-root, required for --dangerously-skip-permissions)
RUN chown -R node:node /workspace /home/node /app

USER node

WORKDIR /workspace

EXPOSE 3000

ENTRYPOINT ["/app/entrypoint.sh"]
