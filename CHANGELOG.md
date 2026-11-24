# Changelog

## [0.4.0] - 2026-11-24 (M4: Round loop and combat)

### Added
- The full Round sequence:
  - **Reinforcement Phase:** an automatic arrival or stay-back choice, then rolls by Class and Round (core p.21). Regiments that failed to enter arrive automatically next Round.
  - **Command Phase:** an editable Command Stack, with Characters placed just above their Regiment by default.
  - **Supremacy Phase:** the roll-off, with −1 for the player with fewer cards. The winner chooses the First Player. [Activated] Supremacy Abilities can be declared (their effects are manual).
  - **Action Phase:** alternating card draws. Cards that cannot Activate anything are discarded. A card activates any same-named Regiment. Character Activations with Entourage are supported.
  - **Victory Phase:** this is where the next Round starts. Scoring comes in M5.
- Actions:
  - **Charge:** roll plus March, Unstoppable and Standard Bearer re-rolls, the facing chosen by the front-rank majority, automatic placement in contact (AMB-11), a failed Charge moves the die roll forward and ends the Activation, Inspired, and Impact Attacks.
  - **Volley:** per-Stand range, 1 mm Line of Sight and obstruction by Size, +1 at Effective Range, Leader +1, shots against the arc each Stand is in, and no Morale.
  - **Clash:** Engaged Stands attack with A (Leader +1), others give Support (lost when engaged in the flank or rear). Inspired applies, Relentless Blows at C 6+, and the Character fights alongside.
  - **Also:** Take Aim (Aimed Shot), Inspire, Rally, Combat Rally, Combat Reform (clean or fighting) and Withdraw (clean or fighting, then turn and March).
  - **Duels:** both sides attack, with Shield, Cleave and Flurry. Declining applies its penalties.
- Combat pipeline:
  - hit rolls (6 always misses, 1 always hits);
  - Defense against the better of D or E (1 is not automatic) and Deadly 6s;
  - wound allocation in rulebook order, with the Command Stand last;
  - Morale (Resolve with the size bonus, flank re-rolls, rear auto-fail, Terrifying and Fearless);
  - Broken, Shattered, and losing the Command Stand.
- Special rules automated:
  - the 14 MVP rules: Impact, Barrage, Armor Piercing, Deadly Shot, Cleave, Flurry, Shield, Leader, Standard Bearer, Unstoppable, Fearless, Fearsome, Terrifying, Fly;
  - plus Brutal Impact, Linebreaker, Support, Aimed Shot, Inspired, Deadly Blades, Relentless Blows and Rapid Volley.

  Every other rule is listed as "manual" in the log when its Regiment activates.
- Dice tray: every roll with its seed, draw index, values, re-rolls and target numbers.
- Manual tools, all logged as overrides:
  - add or heal Wounds;
  - change a characteristic until the end of the Round;
  - mark Broken or not;
  - set the next dice, which, with Undo, gives a re-roll;
  - move or turn by hand;
  - send a Regiment to or from Reinforcements;
  - place a Charge by hand.

### Decided
- AMB-30 to AMB-33. AMB-11 was refined.

### Manual for now
- All other faction special rules, Draw Events and Strain Expression.
- Supremacy effects and Character abilities (Snapshot, Mighty Swing, Practitioner).
- Die Fighting!, Press the Attack, splitting a Clash between several enemies, and the 1″ push when Charging.

## [0.3.0] - 2026-11-24 (M3: table and movement)

### Added
- Geometry engine:
  - oriented Stand rectangles;
  - edge-to-edge distance and contact, including corner to corner;
  - facing arcs from 45° corner lines;
  - 1 mm Line of Sight and Volley lines filtered by Size;
  - Objective Zone overlap;
  - polygon clipping.

  All covered by tests, including rotated cases.
- Regiment formations: ranks and files, a centred rear rank, the Command Stand centred in the front rank, an attached Character beside it, and wounded Stands at the rear.
- Game engine (`validate` and `apply`, pure and immutable):
  - setup from two imported lists, and attaching Characters to Regiments of the same Type in their Warband;
  - Activations with two Actions, where only March may repeat;
  - March: forward with Wheels (arc-length cost), or sideways or back at half March;
  - Standard Bearer +1″ on the second March;
  - no ending within 1″ of an enemy, no passing through enemies or engaged friends, no ending on Objective Markers, Stands must stay on the table;
  - Reform: Command Stand fixed, best-assignment Stand moves within M, rotation of up to 180° about the centre.
- Reinforcement entry:
  - from your own edge, or from a side edge behind the Reinforcement Line (computed per core p.30);
  - Heavy Regiments in Round 3 from your own edge only;
  - scenario "No Reinforcement" segments respected;
  - a second March allowed to finish coming on.
- Manual "move by hand" override, logged as an override.
- Play screen:
  - roll off for sides, attach Characters, choose who arrives;
  - a to-scale table with pan, pinch and zoom;
  - tap to select, drag to move, quick buttons, and text entry (for example "wheel 30 left, forward 4");
  - a ghost preview with a live legality check and page references;
  - the remaining move distance;
  - a ruler (two points, or two Regiments edge to edge);
  - undo by deterministic replay;
  - an event log.
- A built-in demo list (the invented CI fixture) so a game can be tried without importing.

### Decided
- AMB-27 to AMB-29: rear-rank centring, the 1″ rule judged at the end of the March, and Reform slot assignment.

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
