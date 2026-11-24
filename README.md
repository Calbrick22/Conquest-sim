# Conquest Sim

A personal tabletop simulator for **Conquest: The Last Argument of Kings** (2026 rules, post-Adepticon). It is an installable Progressive Web App that runs offline on desktop and phone. You import your own army lists at runtime, pick a scenario, and play against a computer opponent or in hotseat mode.

> This is an unofficial fan tool. The repository contains **no rules text and no army data**. Unit stats and rule text reach the app only from list files you load on your own device.

**Live app:** https://calbrick22.github.io/Conquest-sim/

To install it:
- **Android (Chrome):** open the link, then menu → *Install app*.
- **iPhone (Safari):** Share → *Add to Home Screen*.
- **Desktop:** use the install icon in the address bar.

## Playing

1. **Lists:** import your Army Builder PDF and your opponent's, then check the review screen.
2. **Play:** choose both lists and a scenario, and choose **Computer** or **Hotseat** as the opponent. Roll off, attach Characters, and start.
3. **Each Round:**
   - Reinforcements, then the Command Stack, then Supremacy.
   - Draw cards and activate.
   - Choose Actions from the Regiment panel, and tap enemies or Objective Markers as targets.
4. **Manual tools** (Wounds, characteristics, Broken, set dice, move by hand) resolve anything the engine marks "manual". Every use is logged as an override.
5. **The game log** exports as Markdown (score table by Round) or JSON (an exact replay). Games also save on the device after every action.

## Run locally

You need Node 22 or later.

```bash
npm install
```

```bash
npm run dev
```

## Test

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run e2e
```

`npm test` runs the unit tests with Vitest. `npm run e2e` runs the Playwright smoke test; it builds and previews the app itself.

## Deploy

GitHub Actions runs typecheck, lint, unit tests, the build and the end-to-end test on every push. Pushes to `main` also deploy to GitHub Pages.

The first time, set the repository's **Settings → Pages → Source** to **GitHub Actions**. The workflow tries to enable Pages itself, but that needs admin rights it may not have.

## Project docs

- [`PLAN.md`](PLAN.md): architecture, data model and milestones.
- [`docs/rules-digest.md`](docs/rules-digest.md): mechanics in our own words, with page references.
- [`docs/ambiguities.md`](docs/ambiguities.md): rule questions and the readings chosen.
- [`CLAUDE.md`](CLAUDE.md): conventions for contributors, including the copyright rules.
- [`CHANGELOG.md`](CHANGELOG.md)
