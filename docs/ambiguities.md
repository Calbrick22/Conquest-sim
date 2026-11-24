# Ambiguities

Each entry gives the source, the question, and the reading the code uses. In code they are marked `// RULE-AMBIGUITY: AMB-NN`.

**Status:**

- **open**: needs the owner's input, and blocks or affects the architecture.
- **chosen**: I picked the most literal reading.
- **estimated**: a value read off a diagram.

| ID | Source | Question | Reading used | Status |
|---|---|---|---|---|
| AMB-01 | core p.10 | Is a natural 6 an automatic fail on Defense Rolls? The text only says 1 is not an automatic success there. | A 6 always fails, including on Defense Rolls. Deadly Shot's "failed Defense roll of 6" supports this. A 1 on a Defense Roll succeeds only if 1 ≤ D or E. | chosen |
| AMB-02 | core p.11–12 | **Base sizes in mm aren't given anywhere in the core rules or the scenario pack.** Fig. 1.1 shows a Cavalry Stand that looks longer than it is wide. Chariots are "two square Stands back to back". Objective Markers use "Brute/Cavalry Stands". | All base sizes live in **one config table** (`src/engine/geometry/bases.ts`). **I need the real values from you** (see PLAN.md, "Questions for you"). | **open** |
| AMB-03 | core p.72 | What footprint does a Character Stand have? | The same footprint as a Stand of its Type. | chosen |
| AMB-04 | core p.13–14 | Arcs come from 45° lines at each corner. For a rectangle that isn't square, what are the arc boundaries? | 45° rays from each **corner of the Regiment's footprint** (not from individual Stands), each pointing diagonally away from the Regiment. A target Stand is in an arc if any part of it lies in that region, so it can be in two arcs. | chosen |
| AMB-05 | core p.28 | Is Wheel distance the **arc length** or the straight-line distance travelled by the moving front corner? | Arc length (radius × angle). It is the larger value, so it never under-charges. | chosen |
| AMB-06 | core p.21 | In the Supremacy roll-off, the side with fewer cards subtracts 1 "to a minimum of 0 and a maximum of 7". The maximum is meaningless on a D6. | Subtract 1 with a floor of 0, and ignore the maximum. | chosen |
| AMB-07 | core p.14 vs p.38 | Line-of-sight obstruction uses "equal or larger size" (p.14), but Volley obstruction needs Size ≥ **both** the shooter and the target (p.38). | Volley and Charge declaration use the p.38 test for Volley and the p.14 test for Charge. | chosen |
| AMB-08 | core p.14, 38 | How should a "1 mm wide" line be modelled? | A segment of width 1 mm (0.0394″). It is blocked if it intersects an obstructing footprint by more than touching. | chosen |
| AMB-09 | core p.39 | Effective Range: is "within half range" measured per Stand to the closest target Stand? | Yes, from each volleying Stand to the closest point of any target Stand, compared strictly with range / 2 (the text says "less than half"). | chosen |
| AMB-10 | core p.60 | Broken: "half or more of the Stands … (rounded up)". | Broken when Stands lost this Round (or since the last Rally) ≥ ceil(Stands at start / 2). Shattered uses the same threshold against the count when the Regiment Broke. Characters don't count. | chosen |
| AMB-11 | core p.31–34 | The Charge geometry (free wheel, straight move, close the door, 1″ push) needs a concrete algorithm. | Search the free wheel angle in 1° steps within ±90°. For each, move straight forward until first contact, then rotate about the contact point until flush. Keep the result with the most engaged front-rank Stands, then the smallest wheel. If nothing works, the Charge fails. The 1″ push of a blocking enemy is **manual** in the MVP. The UI always lets you override the final placement, and logs that you did. | chosen |
| AMB-12 | core p.76 | Duel: "making Defense and Resolve Rolls as usual". Do Characters take Morale Tests from Duel Wounds? | Yes. Each Duel Wound triggers a Morale Test against the Character's own R, and failures add Wounds to the Character only. Duels are **manual-assisted** in the MVP. | chosen |
| AMB-13 | pack p.8 | The "Seek New Escort" Action is named but its text isn't in the core rules or the pack. | Not implemented. Use the manual "move Character to Regiment" override. | open (low) |
| AMB-14 | pack p.15 | The two Forlorn Hope Objective Markers are drawn neutral (no A/B label), but VPs are for "Enemy" Markers. | A neutral Marker counts as enemy to **both** players, so either can damage it and whoever destroys it scores 3 VP. | chosen |
| AMB-15 | pack p.15 | Forlorn Hope positions read off the 12″ grid, from Player 1's bottom-left corner. | 6″ zones at (24,30) and (48,18). 9″ zones at (48,30) and (24,18). Markers at (36,30) and (36,18). No Reinforcement on both side edges for y ∈ [12, 36]. | estimated (on-grid, high confidence) |
| AMB-16 | core p.50 | Inspired: "if this modifies the Clash to 5 or greater". Is that judged on the value before or after the +1? | After. If C + 1 ≥ 5, keep C and re-roll natural 6s instead. This matches the C 4 Dragonslayers example. | chosen |
| AMB-17 | core p.36 | Which Clash value and which re-rolls apply to Impact Attacks? | Hit with the Stand's C. Apply rules that affect "Charge" or Impact (Brutal Impact, Designate Target re-rolls) but not "Clash Action" ones (Flurry). Inspired doesn't apply. Impact Wounds trigger Morale. | chosen |
| AMB-18 | Spires lists | The PDF export doesn't contain each Regiment's **Strain ability** text, or the Pheromancy abilities. "Strain Expression" refers to rules that aren't in the file. | Show Strain Expression as a manual Draw Event. The effect is applied with the manual characteristic tools. Logged so the gap is visible. | chosen |
| AMB-19 | core p.106, pack p.8 | Seizing needs more total Stands **and** more seizing Stands. What about a tie on either count? | A tie on either count means nobody seizes. | chosen |
| AMB-20 | core p.44 | Corner-to-corner contact: what tolerance? | Footprints count as touching if their separation is ≤ 0.01″ (the engine's geometry tolerance). | chosen |
| AMB-21 | Spires lists | Characters show M as "-". | A Character uses its Regiment's M. The lowest-M rule ignores "-". | chosen |
| AMB-22 | core p.30 | Reinforcement Line: "rearmost corner of the foremost friendly Regiment". | Computed in table coordinates along the player's axis. Regiments with Irregular are ignored. Recomputed at the start of each Round and allowed only to move back during the Round. | chosen |
