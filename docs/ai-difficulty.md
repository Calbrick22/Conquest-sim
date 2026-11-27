# Computer opponent difficulty

The difficulty is chosen on the New Game screen. It is remembered on the device, saved with the game, and shown in the HUD. It changes only how the computer chooses among legal Actions. Every level uses the same rules and the same `validate`/`apply` path as a human player.

The code is in `src/ai/difficulty.ts` (profiles) and `src/ai/ai.ts` (decisions).

## The levels

| | Beginner | Intermediate | Advanced | Expert |
|---|---|---|---|---|
| **Targets** | Nearest target; charges whatever it can reach | Expected Wounds and target worth | Adds flanks and rears, Broken and wounded enemies, finishing blows | Same, weighted most |
| **Movement** | Straight at objectives and enemies; ignores threats; never withdraws | Some account of enemy reach | Avoids fights it would lose, holds objectives, sets up its next Charge or Volley | Same, more weight on threats |
| **Objectives** | Nearest zone | Contested zones count more | Tests each move against the real seizing rules (zones taken or lost) | Same, weighted more |
| **Command Stack** | Army-list order | Ranged and fast first, chargers later | Threats and opportunities (below) | Same, every time |
| **First Player** | Always goes first | Goes first with strikes available; second when threatened | Same | Same |
| **Consistency** | — | 60 % of decisions informed, the rest "off" | 85 % | 100 % |

An "off" decision is made with weaker judgement: less weight on targets and threats, no opportunism, and more randomness. Whether a decision is "off" depends only on the game state and seed, so a saved game replays exactly.

### Threats-and-opportunities Command Stack (Advanced, Expert)

1. Regiments that can strike now (a favourable Charge in reach, or a Volley in range) go first.
2. Regiments in a fight they would lose go early, to strike first or get clear.
3. Regiments that would win if Charged go late, so they can counter-charge once the enemy commits.
4. Objective runners go in the middle, and everything else last.

Characters sit just above their Regiment, and Rituals just above a Regiment of their Court.

### Tried and dropped: simulating attacks

An Expert that played its best three attacks 32 times each through the engine's outcome previews lost to Advanced. It scored 76 kills to Advanced's 172 over 80 games. A preview covers a single Action, so it undervalued a Charge followed by a Clash and talked the Expert out of good Charges. The Expert now uses the same estimates as Advanced, applied every time, with more weight on opportunities.

## The game plan (v2.5.0)

At the start of a game the computer works out a plan (`src/ai/plan.ts`) from the two armies and the scenario:

- **Lanes.** The table is split into left, centre and right lanes. Each lane's objectives set where it advances and how much of the army it gets. Light Regiments and shooters are spread across the lanes first, then the rest go to the lane furthest below its share.
- **Posture.** If its army is at least 10% stronger, it presses the attack (approaching enemies scores higher). Otherwise it plays for the objectives.
- **Coordinated advance.** In the first three Rounds, until 60% of a lane's force is on the table, a Regiment does not push more than 3″ ahead of its lane's foremost friend, unless the enemy is already close. A destination with no friend within 10″ counts its danger half again.

Intermediate follows the plan half-heartedly, Advanced and Expert fully, and Beginner ignores it. The plan appears in the log with the first Reinforcements. Advanced with the plan beat Advanced without it 33–26 over 60 games, and spread its Regiments about twice as widely across the table.

## Checking the levels

`src/ai/tournament.local.test.ts` (local only) plays full games between levels with fixed seeds. Each level plays both synthetic armies from both sides, on several scenarios. It reports wins, VP, zone and kill points, and survivors.

Run it with, for example, `PAIRS=beginner:expert SEEDS=3 npx vitest run src/ai/tournament.local.test.ts`. Tuning variants can be passed as `expert~danger=0.8`. Results are recorded in the CHANGELOG entry for the release.
