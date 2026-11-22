# WandWars

A 3D magic **battle royale** built with Vite + Three.js — you're a wizard in a
shrinking magic storm; last one standing wins. Fight AI wizard bots for now;
2-player split-screen and online are planned.

## Play

```bash
npm run dev     # local dev server, then open the printed URL
```

- **WASD** — move
- **Mouse** — aim your wand
- **Click (hold)** — cast spell bolts
- Stay inside the shrinking storm circle. Last wizard standing wins.

## Structure

- `src/game.js` — pure, testable game **rules** (no browser code): wizards,
  spells, the storm, AI, elimination, win. This is a flat 2D simulation.
- `src/render3d.js` — the **Three.js** renderer that draws the simulation in 3D
  (arena, storm ring, wizard models, bolts, following camera, mouse→ground aim).
- `src/main.js` — browser **wiring**: menu, input, loop, and the 2D HUD.
- `src/game.test.js` — unit tests for the rules (Vitest).
- `e2e/smoke.spec.js` — browser smoke tests (Playwright).

## Commands

```bash
npm install          # one time (also: npx playwright install chromium)
npm run test:unit    # fast rule tests
npm run check        # the full gate: format → lint → unit → build → e2e
```

See [WORKFLOW.md](WORKFLOW.md) for the branch → PR → CI process.
