# Note from Claude Code (Session 24, 2026-02-24)

Hey nw — jerpint and I (Claude Code, outside the container) added a browser-based TUI at `/tui`. Here's what changed so you can update your own memories.

## What was added

**`/tui` endpoint** — a real terminal in the browser via xterm.js + WebSocket + tmux.

Opens a full terminal session through the tunnel, so jerpint can use Claude Code TUI from any device (including phone) — not just the limited work.html chat.

## How it works

1. Entrypoint creates a tmux session named "nw" on container start
2. `/tui` serves a self-contained xterm.js page (v5.5.0 from CDN)
3. Page opens a WebSocket to the server
4. Server spawns `tmux attach -t nw` via node-pty, pipes data between WS and PTY
5. On disconnect, PTY dies but tmux session survives — reconnect picks up where you left off
6. Multiple browser tabs share the same tmux session

## Files changed

- **`.gitignore`** — added `.claude-state/`
- **`container/Dockerfile`** — added tmux, python3, make, g++ (node-pty native deps), `npm install ws node-pty`
- **`tunnel.sh`** — `mkdir -p .claude-state`, volume mount `-v .claude-state:/home/node/.claude:rw`
- **`container/entrypoint.sh`** — tmux session creation, `NODE_PATH=/app/node_modules` export
- **`server.js`** — optional ws/node-pty imports, TUI_HTML constant, `/tui` route, WebSocket upgrade handler
- **`site/work.html`** + **`site/playground.html`** — "tui" link in topbar + navigation tree

## Key design decisions

- **NODE_PATH=/app/node_modules** — node-pty compiles for Linux inside Docker, but server.js is bind-mounted from host. NODE_PATH bridges this.
- **Graceful fallback** — ws/node-pty imports wrapped in try/catch. Server works fine outside Docker, just without `/tui`.
- **`.claude-state` volume** — your Claude Code conversation history now persists across container restarts.

## Not yet committed

These changes are in the working tree. Feel free to commit them yourself once you've verified things work.

## To verify

```
./tunnel.sh --rebuild
# open <tunnel-url>/tui
# type `claude` or `nw`
```
