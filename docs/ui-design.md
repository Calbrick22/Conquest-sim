# UI design: Conquest Sim

The UI is a view of the game: it reads `GameState` (from `useGame`) and dispatches Actions, which
go through the engine's `validate` and `apply` like the computer's. Nothing in `src/ui/` changes
game rules or state directly.

This plan follows the game UI/UX skill (`.claude/skills/game-ui-ux`): anchored containers, one
scaling policy, safe areas, keyboard focus, a screen stack, a HUD driven by state, and
accessibility minimums.

## Visual style: "war table at night"

- **Theme:** a dark strategy-game shell around a lit parchment table.
  - Background: deep umber-black with a soft vignette.
  - Panels: dark leather `#1d1813` with a thin gold trim `#c9a45c` and an inner highlight.
  - Headings: an engraved serif in uppercase with wide letter spacing (system serif stack, so it
    works offline as a PWA).
  - Body: system sans for legibility.
- **Faction colours:** P1 crimson `#c0533f` and P2 azure `#3f67b5` (kept from the table). Every
  colour cue also has a label, icon or shape: P1/P2 tags, stand icons, ★ Priority, ◎ Marked.
- **Buttons:**
  - Primary: gold on dark, bevelled.
  - Secondary: outlined.
  - Danger: deep red for irreversible actions (Burn, quit).
  - Every button has a visible `:focus-visible` ring, distinct from hover.
- **Text:** at least 4.5:1 contrast. The base size scales with the viewport (about 18 px at 1080p,
  15 px on phones), with a Text size setting from 90 to 200 %.

## Screen flow (a stack)

```
Title ──► New game (setup) ──► Battle ──► Victory / Defeat summary ──► Title
  │            │                 │
  ├─ Army lists                  └─ Pause menu (Esc / ☰) ─► Settings
  ├─ Scenarios                         ├─ Export battle report
  └─ Settings                          └─ Save and quit to title (confirm)
```

- **Base screens** are routed by URL hash (`#home`, `#play`, `#lists`, `#scenarios`), so the
  browser's Back works and links stay stable.
- **Overlays** (pause, settings, confirmation, battle summary) form a stack:
  - only the top one takes input;
  - Esc closes it;
  - focus moves into it when it opens, is trapped inside it, and returns to where it was when it
    closes.

## Battle screen layout

**Desktop (≥ 1000 px), CSS grid:**

```
┌──────────────────────────── HUD bar ─────────────────────────────┐
│ Scenario · Round 3/10 · phase track │  P1 12 ◆ VP ◆ 9 P2  │ ☰ tools │
├────────────┬─────────────────────────────────────┬───────────────┤
│ Selection  │                                     │ Orders        │
│ panel      │            Battlefield              │ (phase panel, │
│ (unit card,│        (table, terrain, units)      │  activation   │
│  rules,    │                                     │  actions)     │
│  tooltips) │  [toasts]                           │               │
├────────────┴──────────── Command deck ───────────┴───────────────┤
│ stack / draw pile · turn indicator · cards left · game log ticker │
└──────────────────────────────────────────────────────────────────┘
```

**Phone (< 1000 px):**
- A compact HUD bar: Round, phase, score and ☰.
- The battlefield pinned under it (can be turned to portrait).
- A tab bar below it: Orders, Unit and Log. The command deck sits on the table, as now.

## HUD contents (all derived from state)

- **Round and phase track:** Reinforcements → Command → Supremacy → Actions → Victory, with the
  current step lit.
- **Score:** each side's VP, list name and P1/P2 tag; the First Player gets a crown and whoever is
  to draw gets a turn marker.
- **Activation:** the active Regiment or Character, Actions used as pips (●●○), and Inspired or
  Aimed status.
- **Cards left** for each player. Old Dominion Power pools when present.
- **Notifications:** short toasts for VP scored, Regiments destroyed, Broken or Shattered units,
  and Marked targets. They come from the last Action's events and fade unless reduce motion is on.

## Panels, tooltips and dialogs

- **Selection panel:** the stats table (each characteristic has a tooltip), rules as chips with
  tooltips (automated or manual, with the list's rule text), status, Memories, Spells and Power.
- **Tooltips:** shown on hover and keyboard focus; tap toggles on touch. Each one is linked with
  `aria-describedby`.
- **Confirmations:**
  - Ending an Activation with Actions left (can be turned off in Settings).
  - Ending a Round.
  - Burning a zone.
  - Quitting a battle.
  - Deleting a saved game.

## Settings (saved on the device)

- Text size.
- Reduce motion.
- Confirm before ending an Activation early.
- Stand icons on or off.
- Default table orientation.
- Outcome previews on or off.

## Keyboard

| Key | Action |
|---|---|
| Esc | Pause menu, or close the top overlay |
| Enter | Next (computer turn) |
| D | Draw a card |
| E | End Activation |
| R | Ruler |
| G | Charge reach |
| T | Threats |
| Ctrl+Z | Undo |
| ? | Shortcuts |

## Checks

- **Screenshots at three sizes**, for the title, setup, battle and summary screens: 1280 × 720,
  2560 × 1080 and a 1080 × 2340 phone. Check them for clipping and overlap.
- **Focus check:** every screen and overlay focuses a control when it opens (Playwright asserts
  that `document.activeElement` is not `body`).
- **Unchanged flows:** the existing end-to-end tests keep their test ids.
