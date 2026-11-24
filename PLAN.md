# PLAN: Conquest TLAoK battle simulator (MVP)

The status is: **the MVP is complete (M1–M6).** Next steps are in [`ROADMAP.md`](ROADMAP.md). Mechanics are summarised in [`docs/rules-digest.md`](docs/rules-digest.md), and open questions are in [`docs/ambiguities.md`](docs/ambiguities.md).

## 1. What I read

- **Core rules**, 112 pages. I read all the text. I looked at the stand and formation figures (p.11–13).
  - The core book has **no base dimensions in mm** (AMB-02). That is the one blocker for to-scale geometry.
- **Scenario pack**, 22 pages. I read all the text and looked at all 12 scenario diagrams.
  - Every scenario uses the same 72″ × 48″ table and 12″ grid, so one scenario JSON schema covers all of them.
  - I read Forlorn Hope at high resolution (AMB-14, AMB-15).
- **Army lists:** `spires 21.pdf`, `spires 22.pdf` and `spires 23.pdf`. 22 and 23 have identical text.
  - The export is very regular, so it suits a line-based parser (section 5).
  - It does **not** contain each Regiment's Strain ability text (AMB-18).
- **Text-format lists:** none were provided. See section 5.3.

## 2. Architecture

```
src/
  engine/                 pure TS: no React, no DOM, deterministic
    model/                types: GameState, Regiment, Stand, Profile, Action, GameEvent
    rng.ts                seeded PRNG (sfc32); every draw is logged with seed and index
    geometry/             vectors, oriented rectangles, distance, arcs, LoS, contact, zone overlap
      bases.ts            the ONLY place base sizes in mm live; converted at 25.4 mm per inch
    formation.ts          Regiment footprint from ranks and files, plus Command Stand and Character slots
    rules/
      validate.ts         validate(state, action) -> ok | reasons[]
      apply.ts            apply(state, action, rng) -> { state, events[] }
      phases/             reinforcement, command, supremacy, action, victory
      actions/            march, wheel, reform, charge, volley, clash, withdraw, rally, inspire, take-aim, duel
      combat/             hit / defense / morale pipeline, wound allocation, broken / shattered
      special/            special-rule registry, one module per rule, with hook points
      overrides.ts        manual tools: wounds, move, set characteristic, re-roll / set dice, broken
    legal/                legal-action generator (sampled movement destinations)
    log.ts                event log, replay, undo, JSON export, Markdown game-log export
  scenarios/*.json        12 tournament scenarios as data, plus the schema
  import/                 pdf.js text extraction, then line normaliser, then list parser
  ai/                     AiController, heuristics, evaluation; runs in a Web Worker
  controllers/            PlayerController interface; HumanController and AiController
  ui/                     React: import / review, scenario preview, setup, table (SVG), dice tray, log
  storage/                IndexedDB (via idb): saved lists and saved games
```

- **The engine is the only authority.** The UI and the AI create `Action` objects. Both go through the same `validate` and then `apply` path.
- **State is immutable.** Every `apply` returns a new state plus `GameEvent[]`.
- **Undo** replays the log, from the initial state and seed, up to N−1 actions. It is cheap at this game size.
- **Determinism:** `apply` gets an RNG cursor. A dice event records the seed, the draw index, the raw values, any re-rolls and every modifier, and the dice tray shows that event. Manual "set dice" is an override event, and replay respects it.
- **Rendering** reads state and events only. SVG units are inches, with a `viewBox` of 0 0 72 48. All art stays in a separate layer, so it can be swapped later.

### Special-rule registry

- Each rule is a module `{ name, params schema, hooks }`. The hooks are:
  - `modifyCharacteristic`;
  - `hitRerolls`, `defenseRerolls` and `onHitRoll` (Rapid Volley and Relentless Blows extra hits);
  - `modifyDefenseForIncoming` (Cleave, Armor Piercing, Shield);
  - `onFailedDefenseRoll` (Deadly Shot, Deadly Blades);
  - `chargeReroll`;
  - `moraleModifiers` (Terrifying);
  - `blocksAction` (Fearsome);
  - `movement` (Fly);
  - `impactAttacks`.
- An imported rule name with no module still shows its **full text from the list** and is marked **manual**.
  - Nothing crashes, and nothing is silently ignored.
  - Every time a manual rule could have applied, the log records it, for example: "AI ignored manual rule X".

### Players

- `PlayerController.chooseAction(view): Promise<Action>`.
- **Hotseat** means two `HumanController`s. **Versus the computer** means a human controller plus an `AiController` running in a Worker.

## 3. Data model (summary)

```ts
type Inches = number;

interface Pose { x: Inches; y: Inches; facing: number /* radians, 0 = toward P2 */ }

interface Profile { M?: number; V: number; C: number; A: number; W: number; R: number; D: number; E: number }

interface SpecialRuleRef {
  name: string;
  x?: number;
  params?: Record<string, unknown>;
  text?: string;
  implemented: boolean;
}

interface RegimentState {
  id;
  owner: 'P1' | 'P2';
  entryName;
  type;
  cls;
  profile: Profile;
  rules: SpecialRuleRef[];
  stands: StandState[];              // wounds taken; isCommand; command models
  character?: CharacterState;
  pose: Pose;
  files: number;                     // ranks are derived from files and Stand count
  location: 'reserve' | 'arriving' | 'table' | 'destroyed';
  broken: boolean;
  activatedThisRound: boolean;
  actionsThisActivation: ActionKind[];
  standsAtRoundStart: number;
  roundMods: CharacteristicMod[];
}

interface GameState {
  seed;
  round;
  phase;
  firstPlayer;
  scenario: ScenarioDef;
  players: Record<'P1' | 'P2', PlayerState>;    // army list, command stack, VP, reinforcement line
  regiments: Record<RegimentId, RegimentState>;
  markers: ObjectiveMarkerState[];               // wounds by player
  activeActivation?: ...;
  log: GameEvent[];
}

interface ScenarioDef {
  id;
  name;
  table: { w: 72, h: 48 };
  zones: { id, x, y, diameter, friendlyTo? }[];
  markers: { id, x, y, friendlyTo?, wounds: 3, defense: 3 }[];
  noReinforcement: { edge: 'left' | 'right' | 'top' | 'bottom', from, to }[];
  rounds: 10;
  seizeFromRound: 2;
  scoring: ScoringRule[];
  specialSetup?: string;
}
```

`ScoringRule` is a small tagged union. Its kinds are:

- `perZoneSeized`
- `bonusIfSeizingAtLeast`
- `perEnemyMarkerDestroyed`
- `perEnemyCharacterKilled`
- `perEnemyRegimentDestroyed`
- `warlordSlainOnce`
- `zoneBonusInRounds`
- `secretZoneChoice`

Each kind has a pure scorer, so all 12 scenarios can be expressed. Scenario-specific interactions, such as the secret pick in Foresight, become manual prompts in the MVP.

## 4. Geometry approach

- A Stand is an oriented rectangle (centre, half extents, angle).
- **Distance:** exact separating-axis overlap tests, and closest distance between convex polygons (minimum over edge–vertex pairs), with a tolerance of 0.01″.
- **Arcs:** 45° rays from the four footprint corners. Arc membership is a polygon intersection test against the four unbounded wedges.
- **Line of Sight:** "thick" segments (1 mm) tested against footprints, filtered by Size.
- **Zone overlap:** a test between a circle and an oriented rectangle.
- **Movement validation:**
  - A March is described as a list of segments: `forward d`, `wheel θ about left/right corner`, or `side/back d`.
  - Its cost is summed (wheel cost = |θ| × footprint width).
  - The swept path is checked for passing through enemies, and the final pose for legality.
- **Tests:** rotated cases, corner contact, arc-boundary cases, and the Forlorn Hope seizing and VP cases.

## 5. Army list import

### 5.1 Format (from the three Spires exports)

```
<Faction> <pts> / <max>           header; then faction, sect
Warband <N>                       N = number of Regiments that follow the Character
<Name> [Mainstay|Restricted] <stands> <points>     Characters have no slot word
M V C A W R D E Type <Type>
<8 values, '-' allowed> Class <Class|->
[Supremacy Abilities <names>] [Draw Events <names>] [Actions <names>]
Special Rules <comma list, may wrap across lines; may be on the same line>
[Command Models <list>] [Battlefield Role <list>] [Options / <group> <items>]
[free-text warband restriction lines]
Rules                              glossary: <Name>[ X] newline <text…>, until "Army Rules"
Army Rules                         free text to the end of the file
```

### 5.2 Parser design

1. Extract text with pdf.js.
2. Rebuild lines from item y-positions.
3. Run a state machine over the lines, keyed on known labels.
4. Split the special-rules list with a tokenizer that understands nesting:
   - parentheses and brackets, for example `Barrage (4) [14", Armor Piercing (2), Deadly Shot]` becomes `{name:'Barrage', x:4, range:14, sub:[AP(2), Deadly Shot]}`;
   - wrapped lines, such as `Impact\n(2)`, are re-joined before tokenising.
5. Split glossary entries by matching their headings against the set of names referenced in the entries. This is robust, because headings are only names the list actually uses.

Anything the parser doesn't understand becomes a **parse warning** attached to the entry. The review screen highlights warnings and allows edits.

### 5.3 Text lists

You didn't provide any, so I can't tell yet whether that format carries stat lines and rule text.

- The parser takes **pasted text**, so text copied from an Army Builder PDF works the same way.
- If your opponents' text lists only contain names and points, they would need bundled faction data. That would break the public-repo rule, so in that case we stick to PDFs as you suggested.
- Send me one when you have it, and I'll confirm.

### 5.4 Tests

- A committed **synthetic fixture** with invented names and text, in the same layout, runs in CI.
- Local-only snapshot tests run over every PDF in `reference/`. They are skipped when that folder is missing, and their snapshots are written under `reference/`.

## 6. Milestones and estimates

These are estimates of working sessions, with one session being a few hours of focused work.

| # | Milestone | Main deliverables | Estimate |
|---|---|---|---|
| M1 | Skeleton and pipeline | Vite + React + TS (strict), ESLint, Vitest, Playwright; PWA manifest + service worker (vite-plugin-pwa); CI (typecheck, lint, test, build); Pages deploy on `main`; README, CLAUDE.md, CHANGELOG | 0.5 |
| M2 | Import and scenarios | pdf.js extraction, parser, rule tokenizer, synthetic fixture, local snapshot tests; review / edit screen; IndexedDB list store; 12 scenario JSONs + schema; scenario preview with 12″ grid | 1.5 |
| M3 | Table and movement | geometry module + heavy tests; formations; setup flow (lists, scenario, roll-off for sides, Character attachment); reinforcement entry (legal edges, No-Reinforcement segments, Reinforcement Line); March / Wheel / Reform with legality; range ruler; drag on touch + numeric entry | 2 |
| M4 | Round loop and combat | phases, Command Stack and alternation, Draw Event hook, Supremacy roll-off; Charge (roll, auto-placement per AMB-11, manual override), Impact, Volley (LoS, obstruction, effective range, arcs), Clash, Defense, Morale, wound allocation, Broken / Shattered, Rally, Inspire, Take Aim, Combat Reform, Withdraw; dice tray; 14 special rules; manual tools; Duels manual-assisted | 3 |
| M5 | Scoring, save and log | seizing + Markers + Character kills + scenario scorers; per-Round scoreboard; save / load / undo via log replay; JSON + Markdown log export in your format | 1 |
| M6 | Computer opponent | legal action generator; heuristic AiController in a Worker, with one-line reasons; fixed-seed 10-Round AI-vs-AI test | 2 |
| — | ROADMAP.md, polish, Playwright smoke test | | 0.5 |

**Total: about 10–11 sessions.** M3 and M4 are the largest and riskiest.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Base sizes unknown (AMB-02) | One config table and a question to you (below). Geometry code is size-agnostic, so a wrong value is a one-line fix. |
| Charge auto-placement is the hardest geometry (wheel, straight move, close the door, 1″ push, charging through friends) | A deterministic search (AMB-11), and a manual "place charger in contact" fallback that is always available and logged. |
| Combat Reform, Withdraw reform, Press the Attack and casualty-driven re-forming are fiddly | Automate the common cases. Otherwise the engine proposes a legal formation and you can adjust it. |
| Rules with text not in the list (Strains, Pheromancies) | Shown as manual, with manual characteristic tools. |
| pdf.js line reconstruction differs from poppler's | Normalise on y-clusters. The synthetic fixture tests the parser on text; a local test runs pdf.js on the real PDFs. |
| AI speed on a phone | Sampled candidates (about 20–60 per Regiment), a one-ply evaluation, and a Web Worker with a time budget. |
| Copyright in a public repo | `reference/` is git-ignored (done, first commit). No rule text in source, tests or docs. The synthetic fixture uses invented text. Check `git status` before every commit. |

## 8. Out of scope for the MVP (it goes in ROADMAP.md)

- Terrain
- Magic and Spellcasting automation
- Secondary Objectives
- Faction mechanics beyond the 14 listed special rules: Strains / Decay automation and Lobotomytic Override are manual for now
- Core-book scenarios
- Online play

## 9. Questions for you (answered 2026-11-24)

1. **Base sizes:**
   - Infantry, Cavalry and Brute: 66×66 mm.
   - Monster: 110×110 mm.
   - Chariot: derived as 66×132 mm.

   See AMB-02 and `src/engine/geometry/bases.ts`.
2. **Branches:** Claude may merge into `main` and push it itself at the end of each milestone.
3. **Forlorn Hope Markers:** each Marker is friendly to the nearer player. Players may only attack and score the enemy Marker (AMB-14).
