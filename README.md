# Elsewhere

A living miniature island. Eight creatures (wicks) on Tallowmere learn by watching each other and by watching what you change in their world. You can influence them. You cannot command them.

## Run it

```
npm install
npm run dev        # play at the printed local URL
npm test           # 26 headless tests of the simulation
npm run build      # one self-contained dist/index.html
```

## What is genuinely simulated

- **Fixed-timestep, seeded simulation** in pure TypeScript (`src/sim`), independent of React and rendering. Same seed + same action schedule gives an identical event log.
- **Perception-limited agents**: sight needs range and line of sight (rock and grove block it), sound needs range, and an attention roll sits on top. Sleeping wicks perceive nothing.
- **Utility-scored decisions** from needs × temperament, visible per creature under "Why this choice?".
- **Social learning**: observation → memory → adoption → imperfect copy. Copies can mutate one parameter (place, timing, count, arrangement or sequence) within bounds.
- **Culture as data**: a practice becomes a custom only when 3 wicks have performed it 6 times across 2 days with 2 wick-to-wick learnings; a tradition needs more (see `src/sim/config.ts`). Time alone can only make a practice fade.
- **Chronicle**: every sentence is a template filled from one recorded event, and links to the events that caused it.
- **Persistence**: versioned IndexedDB snapshot plus append-only event history, written atomically. Offline catch-up is capped at three island days and says so.

## Not in this build

Web Worker (the sim runs on the main thread; eight agents cost well under a millisecond per tick), generations, settlements, multiplayer, LLM narration, and Playwright as a committed test suite (`scripts/smoke.mjs` is a browser smoke script, not part of `npm test`). Rendering uses Canvas 2D rather than PixiJS, and plain CSS rather than Tailwind, so the whole thing ships as one file.
