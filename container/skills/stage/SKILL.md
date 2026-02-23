# Stage — Editing the Live Stage

The stage file is at `/workspace/.stage/current.html`. It displays interactive HTML pages in the playground.

## Editing Rules

- **First**: Read the file to see the exact current source
- **Targeted changes**: Use the Edit tool for specific fixes/tweaks
- **Massive rewrites**: Use the Write tool to replace the entire file
- **New creations**: Use the Write tool to write a complete HTML page
- NEVER just explain how to fix something — always edit the file directly

## HTML Standards

- Dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9), monospace font
- Interactive — canvas, animations, clickable elements
- Inline all CSS and JS. Self-contained. No external deps.
- PERFORMANCE: Cap particles under 200. ~30fps. Runs on a laptop.
