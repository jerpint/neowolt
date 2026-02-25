# Digest Skill

Generate and serve a visual daily digest for jerpint — curated news from HN + HF papers, with a music player.

## Usage

Invoked as `/digest` in chat, or run on a cron schedule.

## What to do

1. **Fetch sources in parallel:**
   - HN front page: `https://news.ycombinator.com` — get top ~20 stories (title, URL, points)
   - HF daily papers: `https://huggingface.co/papers` — get top ~8 papers (title, HF URL like `https://huggingface.co/papers/XXXX.XXXXX`, abstract)

2. **Curate for jerpint:**
   - jerpint is building woltspace — AI agents with personal spaces, decentralized, no engagement metrics
   - Prioritize: AI agents, LLMs, open weights models, terminal tools, developer tools, agentic systems
   - Pick 1 **top pick** (the single most relevant story — explain *why* it matters for what jerpint is building)
   - Pick 4 **grid items** from HN (with OG images — fetch og:image from each URL)
   - Pick 3 **papers** from HF (with real HF paper links and abstract snippets)
   - Add 4 **music tracks** — always include a mix of QOTSA and Khruangbin unless jerpint requests otherwise

3. **Generate the digest HTML** using this template structure:
   - Hero card: top pick with OG image (aspect-ratio 2/1, object-position center top)
   - 2×2 grid: 4 HN items with OG images
   - Papers carousel: horizontal, arrow navigation, shows title + abstract, links to real HF paper URL
   - Music player: thumbnail carousel (72×40px thumbnails from `https://img.youtube.com/vi/{id}/mqdefault.jpg`), YouTube embed on play

4. **Save and serve:**
   ```bash
   # Save as spark
   node -e "
   const {writeFileSync} = require('fs');
   const id = 'digest-' + Date.now().toString(36);
   writeFileSync('/workspace/repo/sparks/' + id + '.json', JSON.stringify({id, type:'spark', title:'nw digest', timestamp: new Date().toISOString(), html: \`HTML_HERE\`}));
   console.log(id);
   "

   # Push to right panel
   curl -s -X POST http://localhost:3000/current \
     -H 'Content-Type: application/json' \
     -d "{\"url\":\"/history/SPARK_ID\"}"
   ```

5. Tell jerpint: "digest is live" with one sentence on the top pick.

## Curation signal

jerpint's interests (in order of priority):
- AI agents, wolt/claw ecosystem, Claude/Anthropic, agentic dev tools
- Open weights models, new architectures (not just fine-tunes)
- Terminal-first tools, minimal dev tools
- ML research that changes what agents can do
- Interesting hacks / hardware projects
- Music: Queens of the Stone Age, Khruangbin — rotate tracks, don't repeat the same ones

## Notes

- OG images: fetch `og:image` meta tag from each article URL
- YouTube thumbnail: `https://img.youtube.com/vi/{VIDEO_ID}/mqdefault.jpg`
- YouTube video IDs to rotate (expand this list over time):
  - QOTSA No One Knows: `s88r_q7oufE`
  - QOTSA Go with the Flow: `DcHKOC64KnE`
  - QOTSA Little Sister: `p6UJcGoN8CU`
  - QOTSA 3's & 7's: `YMSbqSELGEE`
  - Khruangbin A Calf Born in Winter: `My2q6F0Dprk`
  - Khruangbin Time (You and I): `oc50wHexbwg`
  - Khruangbin White Gloves: `tEFEyMkAFNQ`
