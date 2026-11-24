# Changelog

## [0.2.0] - 2026-11-24 (M2: import and scenarios)

### Added
- Army list import, inside the app, for any faction's Army Builder export:
  - PDF, read on the device with pdf.js; a .txt file; or pasted text.
  - Extracts the faction, sect, points, Warbands and restriction notes.
  - For each entry: slot, Stands, points, Type, Class and the M V C A W R D E line (with "-" read as empty).
  - Also per entry: special rules parsed into name, (X), range and nested rules; Draw Events, Actions, Supremacy Abilities, Command Models, Battlefield Roles, Options and notes.
  - Keeps the full rules glossary and the Army Rules text.
  - Handles lines that wrap and page breaks in the middle of an entry.
- Review screen. Each entry is editable, problems are flagged, and every special rule shows its full text from the list, marked "manual" until it is automated.
- Saved lists in IndexedDB, kept on the device.
- All 12 tournament pack scenarios as JSON (`src/scenarios/`), with a typed schema and structured VP scoring rules.
- Scenario preview screen: a to-scale map on a 12″ grid, with zones, Objective Markers, "No Reinforcement" edges and a VP summary.
- Victory Phase scoring engine and Objective Zone Seizing resolver, with tests (including the hand-checked Forlorn Hope case: 9 and 11 VP).
- Special-rule registry skeleton. Every rule is "manual" until M4.
- Tests:
  - a synthetic list fixture for CI;
  - local-only tests against the real lists in `reference/`, with snapshots kept in `reference/`;
  - end-to-end tests for import and the scenario preview.

### Decided
- AMB-23 to AMB-26: neutral Markers, "N or more zones" bonuses, Breakout Marker positions, and the Foresight double-VP case.

## [0.1.0] - 2026-11-24 (M1: skeleton and pipeline)

### Added
- Phase 0 documents: `PLAN.md`, `docs/rules-digest.md`, `docs/ambiguities.md` and `CLAUDE.md`.
- Vite, React and TypeScript (strict) app shell, set up as an installable, offline-capable PWA (manifest and service worker).
- Seeded, deterministic D6 roller (`src/engine/rng.ts`), with tests.
- Stand base-size table (`src/engine/geometry/bases.ts`), using the owner-supplied sizes (AMB-02).
- ESLint, including a guard that keeps React and the DOM out of `src/engine/`.
- Vitest unit tests and a Playwright smoke test (desktop and phone).
- GitHub Actions CI: typecheck, lint, tests, build and end-to-end test, with a deploy to GitHub Pages on `main`. CI fails if any `reference/` file or PDF is tracked.

### Decided
- Base sizes (AMB-02) and Forlorn Hope Objective Marker ownership (AMB-14) were ruled on by the owner.
