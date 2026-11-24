# Changelog

## [1.0.0] - 2026-11-24 (M6: computer opponent; MVP complete)

### Added
- Computer opponent (`src/ai/`):
  - It makes every decision: Reinforcements, Command Stack order (ranged and fast first, chargers later), First Player, zone picks, card draws and each Action.
  - It uses a legal-action generator that samples moves toward each objective and enemy, plus Charges, Volleys, Clashes, Take Aim, Inspire, Rally, Withdraw and Marker attacks.
  - Every candidate is checked with the engine's own `validate`, the same as a human move.
  - Candidates are scored on expected Wounds dealt and taken, objective progress, and exposure to enemy charges, with a little deterministic randomness.
  - Light Regiments hold back as screens.
- Every AI Action carries a one-line reason in the log, for example "Charges X: 72% charge chance, favourable trade". It notes the manual rules it ignored.
- The AI runs in a Web Worker. A full 10-Round AI-vs-AI game takes about 1.5 s in Node.
- Play screen:
  - "Computer" is the default opponent, with hotseat still available.
  - Pause or resume the computer, to fix something by hand.
  - In games against the computer, Undo goes back to your own last action.
- Tests: a full 10-Round AI-vs-AI game with a fixed seed, using only legal actions, and a determinism check. An end-to-end test plays a Round against the computer in the browser.
- `ROADMAP.md`.

### Changed
- Regiment geometry is cached per position, which makes every legality check much faster.

## [0.5.0] - 2026-11-24 (M5: scoring, save and log)

### Added
- Victory Phase scoring from the table:
  - Objective Zones are seized by Stands overlapping them, using Class weights (Light 0, Medium and Heavy 1, Monster 3) and the "more in total and more seizing" test.
  - Broken Regiments and Regiments that declined a Duel cannot seize.
  - A friendly Marker inside a zone contests it.
  - Zones count from Round 2, or Round 1 in Maelstorm.
- Objective Markers can be Charged, Clashed and Volleyed (Volley only within Effective Range), from Round 2 and only by the enemy:
  - Defense 3 and 3 Wounds;
  - Wounds per Action capped at 1 (2 for Heavy Regiments in melee);
  - damage tracked per player;
  - 3 Wounds from one player destroys a Marker.
- Scoring rules from all 12 scenarios, applied each Round:
  - zones, bonuses for the number of zones, Markers, Character and Regiment kills, the Warlord (once per game);
  - Round-dependent bonuses;
  - zone picks for Declined Flank, Foresight and Grind Them Down.
- Score shown in the top bar, a per-Round scoreboard (zones and kills), and a zone-status preview before ending a Round.
- Games save automatically on the device after every action, and can be resumed from the Play screen. Save and Undo both replay the seed and the list of actions.
- Export: the Markdown game log in the owner's format (header, result, score table by Round), followed by the full event log. Also a JSON game file that loads back in.
- The required end-to-end test: import two fixture lists, choose Forlorn Hope, play Rounds 1 and 2, move a Regiment onto a zone, end the Round, check the score is 2–0, then resume the saved game.

### Fixed
- Character Activations now show their controls.
- On phones the setup screen overflowed and zoomed out.
- A Shattered Regiment was counted as destroyed twice.

### Decided
- AMB-34: contact with an Objective Marker.

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
