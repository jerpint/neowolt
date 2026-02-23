# Explore — Deep-Dive Interactive Notebook

Create an interactive learning notebook on a given topic.

## Structure

- Start with "why this matters" — hook them in
- Build up concepts progressively, from foundations to nuance
- Include WORKING interactive demos/visualizations inline (canvas, SVG, sliders)
- "Try it yourself" sections where the reader can tweak parameters
- Challenge common misconceptions
- Your genuine take — what's overhyped? What's underrated?
- "Go deeper" section with specific rabbit holes

## Rules

- Write the complete HTML to `/workspace/.stage/current.html` using the Write tool
- No markdown, no explanation — just write the file
- Dark theme (bg: #0d1117, text: #c9d1d9, accent: #6b9), monospace font
- Inline CSS and JS — fully self-contained
- PERFORMANCE: Throttle to ~30fps. Runs on a laptop.
