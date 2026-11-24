# Roadmap

This roadmap follows the MVP. It is ranked by **value to a player who uses the app to rehearse matchups and review games**.

- **Sizes** are rough, in working sessions of a few hours: S ≈ 1, M ≈ 2–3, L ≈ 4–6, XL ≈ 8+.
- **Priorities follow real games.** Every time the log says "Manual rules that may apply" or "ignoring manual rules", that is a data point. Export a few logs and the most frequent manual rules become the next work.

## Phase 1: make rehearsal games faithful (highest value)

| # | Item | Why it matters | Size |
|---|---|---|---|
| 1.1 | ✅ *(v1.2.0)* **Spires faction mechanics:** Strain abilities and Strain Expression, the Decay that comes with it, Superior Creations, Lobotomytic Override (The Directorate), Designate Target, Lethal Demise, Oblivious, Acute Senses, Loose Formation, Vanguard, Fly over terrain. | They are on every one of your lists. Strain text is not in the Army Builder export (AMB-18), so this needs a small, owner-maintained data entry screen kept on the device, not in the repo. | L |
| 1.2 | 🟡 *(v1.2.0: all core rules and Draw Events; v1.3.0: Old Dominion and Spellcasting; v1.5.0: Spires from the faction document. Other factions need their PDFs)* **Special-rule coverage driven by the logs:** turn the most frequent "manual" rules into registry modules, faction by faction (Nords, Old Dominion, Hundred Kingdoms, Weaver Courts…). | Each module removes manual work from every game. | M per faction |
| 1.3 | ✅ *(v1.2.0; Seek New Escort stays manual, AMB-13)* **Remaining core mechanics:** Die Fighting!, Press the Attack (pushing Stranded Regiments), splitting a Clash between several enemies, the 1″ push and target pivot when Charging, Character Actions (Snapshot and Mighty Swing style), and the "Seek New Escort" Action once its text is known (AMB-13). | They close the gaps where the MVP needs the manual tools. | M |
| 1.4 | 🟡 *(Old Dominion and the Spires abilities on your lists are done; Biomancer Field Studies, Merchant Prince and High Clone Executor remain)* **Supremacy Abilities and Draw Events as modules**, with the [Always Active], [Battlefield] and [Activated] timing. | Warlord choices shape the matchups you rehearse. | M |
| 1.5 | ✅ *(v1.9.0: the 2026 terrain set, scenario layouts and random layouts; Garrison Terrain not modelled)* **Terrain:** Zonal (Elevated, Cover, Obstructing, Hindering, Dangerous, Water…) and Garrison (Capacity, Defense, leaving and charging) as table data, with its effect on Line of Sight, Volleys and movement, plus a simple terrain editor and the pack's sample layouts. | Tournament tables always have terrain; without it, ranged matchups are optimistic. | L |

## Phase 2: better review and "what if" tools

| # | Item | Why it matters | Size |
|---|---|---|---|
| 2.1 | ✅ *(v1.7.0)* **Probability previews:** before rolling, show the expected Hits, Wounds and Morale outcome, and the chance to Break the target. | Shows whether a Charge or Volley is worth it. | S |
| 2.2 | ✅ *(v1.7.0)* **Charge reach overlay:** the March + 2 to 12 reach as coloured bands from the front arc, with the chance for each band, and the enemy's threat ranges. | Positioning is where games are won. | S–M |
| 2.3 | **Replay viewer:** step through a saved game action by action, branch from any point ("what if I had charged instead"), and compare scores. | Reviewing your real games is a stated goal. | M |
| 2.4 | **Import a real game:** enter a game you played (positions per Round, or a typed log) and replay it on the table. | Turns the app into a review notebook for tournament games. | M |
| 2.5 | 🟡 *(v1.9.0: the five 2026 scenarios)* **Core rulebook scenarios** (Head to Head, Breakthrough, Maelstrom, Pincer Attack) and Secondary Objectives. | More variety for casual practice. | S–M |

## Phase 3: stronger computer opponent

| # | Item | Why it matters | Size |
|---|---|---|---|
| 3.1 | **Look-ahead search:** a shallow search over the AI's own Activation (both Actions) and the opponent's best reply, with a time budget in the Web Worker. | Fewer obviously poor sequences, such as marching into charge range. | M |
| 3.2 | **Smarter Command Stack and activation timing**, using Entourage, holding back to react, and Supremacy timing. | Order of play is a core skill to practise against. | M |
| 3.3 | **Faction-specific tactics:** Spires Strain timing, screening with Light Drones, Monster use. | More realistic opponents for your actual matchups. | M per faction |
| 3.4 | **Difficulty levels and AI personalities** (aggressive, objective-focused, gunline). | Rehearse against different opponent styles. | S |
| 3.5 | **Faster geometry:** spatial indexing and incremental polygons, so deeper search runs on a phone. | It enables 3.1 on older devices. | S–M |

## Phase 4: presentation and convenience

| # | Item | Why it matters | Size |
|---|---|---|---|
| 4.1 | 🟡 *(v1.6.0: role icons on Stands; v2.0.0: game-style theme, HUD and screen flow)* **Graphics and art layer:** model art per Stand, faction colours, Wound markers, animated dice. Rendering is already separate from the engine. | Nicer to use, but not needed for rules practice. | M |
| 4.2 | **List building:** build and edit lists in the app from data you enter yourself. Faction data cannot be bundled in this public repository. | Convenience; the Army Builder already covers this. | L |
| 4.3 | ✅ *(v1.4.0 layout; v2.0.0: keyboard shortcuts, focus handling, text size and reduced-motion settings, larger touch targets)* **Accessibility and tablet layout:** side-by-side table and panels, keyboard shortcuts, larger touch targets. | Comfort on bigger screens. | S |
| 4.4 | **Text-list import** in whatever format your opponents send, once a sample is available. | Saves asking opponents for PDFs. | S |

## Phase 5: optional online play

| # | Item | Why it matters | Size |
|---|---|---|---|
| 5.1 | **Two-player online games:** a small relay that only passes Actions, because the engine is deterministic from seed and Actions. It needs a backend and accounts, which is a deliberate change from "everything on the device". | Remote practice with friends. | L |
| 5.2 | **Shared replays:** export a link or file that replays a game in someone else's app. | Discuss games with your club. | S |

## Ongoing

- Keep `docs/rules-digest.md` and `docs/ambiguities.md` in step with every new rule. Re-check them when Para Bellum publishes errata or a new scenario pack.
- After each real game, export the log and add any wrong or missing rule as an issue. That is the regression list for the engine.
