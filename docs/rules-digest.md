# Rules digest

This is a short summary of each mechanic **in my own words**, written so the code can be checked against it. It is not a substitute for the rulebook. Page references:

- **core p.N**: *Conquest TLAoK Core Rules, 2026 post-Adepticon*. The printed page number equals the PDF page index.
- **pack p.N**: *TLAoK Tournament Scenario Pack (Chios 2025)*, by PDF page index.

Open questions and the reading I chose are in [`ambiguities.md`](ambiguities.md) as `AMB-NN`.

## 1. Dice and tests (core p.10)

- All dice are D6.
- A **Characteristic Test** passes when the roll is less than or equal to the characteristic.
- A natural 6 always fails a test, and a natural 1 always passes. The exception is the Defense Roll, where a 1 does not pass automatically (AMB-01).
- A die can be re-rolled at most once. If one effect forces a re-roll of a success and another allows a re-roll of a failure, they cancel out.
- **Roll Off:** each player rolls one die and the **lowest** wins. Ties are re-rolled, as often as needed.
- When several effects apply at the same moment, the Active Player chooses the order (core p.16).

## 2. Measuring (core p.10)

- Distances are in inches, always between the **closest points**: Regiment to Regiment for movement and charges, Stand to Stand for range.
- Players may measure at any time.

## 3. Stands, Types, Size and formations (core p.11–13)

- **Types:** Infantry (4 models per Stand), Cavalry (1), Brute (1), Chariot (1 model on a double-length Stand made of two square Stands back to back), and Monster (1).
- **Size**, used for Line of Sight: Infantry 1; Brute, Cavalry and Chariot 2; Monster 3 (core p.12). Objective Markers are Size 2 (pack p.8).
- **Base dimensions** aren't in the core rules. The owner supplied them (AMB-02):
  - Infantry, Cavalry and Brute: 66×66 mm.
  - Monster: 110×110 mm.
  - Chariot: 66×132 mm, derived as two squares back to back.
- **Regiment:** a rectangular block of Stands, arranged in ranks and files that touch with no gaps and all face the same way.
- The front rank needs at least 2 Stands, unless the Regiment is a single Stand.
- All ranks are equal, except possibly the rearmost, which is centred as far as possible.
- Wounded Stands go in the rear rank. The Command Stand goes in the centre of the front rank (core p.13).
- **Legal position** at the end of an Activation:
  - no Stand overlaps another Stand;
  - no Regiment overlaps another Regiment;
  - every Stand stays on the table throughout the Activation, except while entering from Reinforcements.
- **Class:** Light, Medium or Heavy. It decides when the Regiment arrives and how much it counts for seizing.

## 4. Facing arcs (core p.13–14, Fig. 1.3)

- Draw a 45° line outward from each corner of the Regiment's footprint. These four lines split the space around it into four arcs:
  - **front**: between the two front-corner lines, beyond the front edge;
  - **rear**: the same, behind the rear edge;
  - **two flanks**: the regions in between, on each side.
- A Stand that straddles a boundary counts as being in both arcs (core p.35).

## 5. Line of Sight (core p.14)

A Regiment has Line of Sight to a target when all three of these hold:

1. The target is in the acting Regiment's **front arc**, unless a rule says otherwise.
2. At least one front-rank Stand can trace an unobstructed 1 mm-wide line from the centre of its front edge to the centre of any edge of a target Stand.
3. No Regiment or terrain of **equal or larger Size** is in the way.

Volley obstruction has its own, slightly different test (section 11).

## 6. Characteristics (core p.14–15)

- The eight characteristics are **M**arch, **V**olley, **C**lash, **A**ttacks, **W**ounds, **R**esolve, **D**efense and **E**vasion.
- Values are never reduced below 0.
- "Unmodified" means the value on the list. Bonuses bought during list building count as unmodified.

## 7. Round sequence (core p.20–25)

1. **Reinforcement Phase** (section 8).
2. **Command Phase:** each player secretly orders the Command Cards for everything on the table, plus everything arriving this Round, into a Command Stack. The order is fixed once built.
3. **Supremacy Phase:**
   - Players Roll Off. The player with fewer cards in their Stack may take 1 off their die (to a minimum of 0). The lowest result chooses who is **First Player**.
   - The First Player then declares whether they will use their [Activated] Supremacy Ability, and then the second player declares.
4. **Action Phase:** players alternate, starting with the First Player. Each turn draws the top card of their Stack and activates one matching Regiment or Character that hasn't activated yet this Round. If none can be activated, the card is discarded and the next one drawn. If the Stack is empty, play passes.
5. **Victory Phase:** score according to the scenario.

## 8. Reinforcements (core p.20–21, 30–31; pack p.8)

- No Regiment is deployed before the game. Characters are attached to Regiments of the same Type in their own Warband before the first Reinforcement Phase.
- Each Reinforcement Phase, a player may pick **one** eligible Regiment to arrive automatically or to stay back. A Regiment cannot stay past the Round its Class must arrive. Every other eligible Regiment rolls:

| Round | Light | Medium | Heavy |
|---|---|---|---|
| 1 | arrives on 4 or less | — | — |
| 2 | 4 or less | 2 or less | — |
| 3 | automatic | 4 or less | 2 or less, and only via the player's own Reinforcement Zone edge this Round |
| 4 | — | automatic | 4 or less |
| 5 | — | — | automatic |

- A Character uses its Regiment's Class and doesn't roll separately.
- **Entering the table:** the first Action must be a March from the player's **Reinforcement Zone** (their table edge). The front edge starts on the table edge and the March is measured from that edge. A side edge may be used instead, but only between the player's Reinforcement Zone and their **Reinforcement Line**.
  - If one March doesn't get every Stand onto the table, a second March is required.
  - A Regiment that arrives cannot Charge that Round.
- **Reinforcement Line** (core p.30): a line parallel to the player's edge, through the rearmost corner of their foremost Regiment.
  - It moves back to the next Regiment if an enemy Regiment crosses it.
  - It is fixed at the start of each Round, and during the Round it can only move back.
- **Failed entry:** the Regiment goes back to Reinforcements and passes its roll automatically next Round.
- Scenario "No Reinforcement" edge segments forbid entry there (pack p.15).

## 9. Activation (core p.22–25)

1. Draw and reveal the card, and choose the Regiment.
2. Optionally resolve **one** Draw Event. Draw Events don't resolve while the Regiment is still off the table.
3. Take a first Action.
4. Take a second Action. It must differ from the first, except that March may be repeated.
5. Deactivate.

- **Free Actions** don't use an Action slot. **Additional Actions** allow the same Action again but use a slot. Either way, there is a hard limit of **3 Actions** per Activation.
- **Pass** gives up an Action without counting as having taken one.
- **Out-of-combat Actions:** March, Charge, Rally (only when Broken), Reform, Take Aim, Volley.
- **In-combat Actions:** Clash, Combat Rally, Combat Reform, Inspire, Withdraw.
- A Regiment is in combat when it is in contact with an enemy. Contact includes touching corner to corner (core p.16).

## 10. Movement (core p.28–31, 37)

### March

- The Regiment moves up to its **lowest** M.
- It may move straight forward, with any number of **Wheels**. It may instead move straight sideways or straight back, at up to **half** M, but it can't combine directions in one March.
- Distance is measured from the front of the Regiment.

### Wheel

- The Regiment pivots about one front corner. The distance used is how far the other front corner travels, and that corner may only go forward (AMB-05).
- The Regiment may continue forward after a Wheel. Several Wheels can be made in one March, within the same distance budget.

### March restrictions

- The Regiment can't end within 1″ of an enemy Regiment or of Garrison terrain.
- It may pass through friendly Regiments that aren't in combat, as long as it ends in a legal position. Two consecutive Marches may be used to clear them.
- It can't pass through enemies.

### Reform (core p.37)

1. Stands other than the Command Stand rearrange into a new legal formation. No Stand may move more than its M, and new ranks can only be added at the rear.
2. The whole Regiment may then rotate up to 180° about its centre, which must not move.

- Reform can be repeated within an Activation.
- Stands can't end overlapping or within 1″ of an enemy.

## 11. Charge (core p.31–36)

### Declaring

- The target must be **one** enemy in the **front arc** and in **Line of Sight**, within the maximum possible charge reach.
- A Regiment can't Charge in the Round it arrived, and Broken Regiments can't Charge (core p.60).

### Roll

- **Charge Distance** is a D6 plus the lowest M.
- The Charge succeeds if that is at least the closest distance to the target.
- Unstoppable allows a re-roll of a failed Charge roll.

### The Charge Move

1. One **free Wheel** of up to 90°, which doesn't count toward distance. It aims to bring as many front-rank Stands as possible into contact.
2. A move **straight forward** until contact. The Regiment may pass through unengaged friends, but may not touch any enemy or Garrison terrain other than the target. It may come within 1″ of them.
3. **Close the door:** rotate up to 90° about the contact point until the Charging front is flush with the charged facing.
   - If that's impossible, the target pivots instead, unless it is already engaged, in which case the Charge fails.
   - If a third Regiment blocks the pivot, that unengaged enemy is pushed up to 1″ directly away.

### Which facing

- The charged facing is the arc of the target that holds the majority of the charger's front-rank Stands when the Charge is declared.
- A tie lets the charger choose. A single Stand uses the arc holding most of its area (core p.35).

### On success

- Impact Attacks are resolved (section 13). The charger gains **Inspired** until the end of its Activation; Inspired doesn't apply to Impact.

### Failed Charge

- The Regiment moves straight forward by the number on the die, stopping 1″ from any enemy or Garrison terrain.
- Its Activation ends and it loses its remaining Actions.
- Separate rules cover a failed charge-through of friends (both Regiments become Broken) and a failure to pivot flush (move 1″ back) (core p.36).

## 12. Volley (core p.38–41)

### Who and what

- Only an unengaged Regiment with at least one Barrage (X) Stand can Volley.
- It shoots one target, which needs at least one Stand within LoS and range. The target may be engaged in melee.

### Per front-rank Stand

1. Trace a line from the centre of the Stand's front edge to any point of the target, no longer than the Barrage range.
   - The shot is **Obstructed**, and that Stand fires nothing, if the line crosses a Regiment or terrain whose Size is at least **both** the shooter's Size and the target's Size.
   - Smaller things are ignored.
2. Shots = X.
   - Add **+1** if the Stand is within **half** range of the target. This is Effective Range, checked per Stand.
   - The Leader adds +1 X to the Command Stand.
   - Halving effects, such as Loose Formation and Cover, are applied afterwards and round up.
3. Each Stand fires at the target arc it is in. Hits on different arcs are tracked separately.

Only front-rank Stands shoot, unless a rule says otherwise.

### Resolving

- **Hit:** a die at or under V is a hit. At **V 6 or more** the Stand gains Rapid Volley: each roll of 1 adds one extra hit.
- **Defense:** the defender rolls one die per hit. The roll is saved if it is at or under **D or E**, whichever is better after modifiers. A 1 is not an automatic save. With D and E both 0, nothing can be saved.
- Wounds are allocated (section 14). **Volley wounds cause no Morale Tests.**

## 13. Combat (core p.36, 44–51)

### Clash

- Stands in contact with an enemy Stand, including corner to corner, are **Engaged** and attack with **A**.
- Every other Stand makes **1 Support Attack**, or X with Support (X). Support is lost while engaged in the flank or rear.
- Hit on a roll at or under C. At **C 6 or more** the Stand gains Relentless Blows: each 1 adds an extra hit.
- **Incomplete ranks:** when counting Engaged Stands, the Regiment is treated as a solid rectangle the size of its fullest rank.
- **Several enemies in contact:** each Stand chooses one enemy and can't split its Attacks. Each pool is resolved separately, from hits through to Morale.
- **Attacks into a flank or rear:** the defender must **re-roll successful Morale Tests**.
- **Attacks into the rear:** Morale Tests fail automatically.

### Impact Attacks (core p.36)

- Resolved right after a successful Charge.
- Each Stand with Impact (X) makes X attacks, whether or not it is Engaged.
- They hit, are defended and test Morale like Clash attacks, but don't get rules that only apply to a Clash Action.

### Combat Actions

- **Inspire:** +1 C until the end of the Activation. If that would bring C to 5 or more, re-roll natural 6s on the Hit roll instead. The +1 is applied after every other modifier (core p.50).
- **Combat Rally:** removes Broken (core p.47).
- **Combat Reform** (core p.48):
  - Roll a D6 against the highest R.
  - If it passes, this is a **Clean Reform**: re-form keeping at least as many Stands in contact, adding no more than 2 to the front rank, and staying in the same facing of the enemy.
  - If it fails, this is a **Fighting Reform**: first take 1 Wound for each Stand in contact (with casualties removed and Morale tested), then re-form as for a Clean Reform.
- **Withdraw** (core p.50–51): Light and Medium Regiments only.
  - Roll a D6 against the highest R.
  - **Clean Withdrawal:** suffer D6 Wounds.
  - **Fighting Withdrawal:** suffer D6 Wounds **for each** Stand in contact. Remove casualties and test Morale first.
  - Either way, the Regiment then turns to face away and makes an out-of-sequence March. If that March can't legally be made, the Regiment returns to where it was and the Withdraw fails.

## 14. Wounds and casualties (core p.53–56)

- Wounds go into a pool and are then allocated one at a time. The order is:
  1. Wounded non-Command Stands.
  2. Finish a Stand before starting another.
  3. Rear rank first, alternating ends, starting with the Stand furthest from the Command Stand.
  4. Avoid reducing the number of Engaged Stands.
  5. The Command Stand last.
- Characters are ignored when allocating Wounds.
- A Stand is removed as soon as its Wounds are used up.
- **Below Starting Strength** means any unhealed Wound or lost Stand.
- **Healing** follows this order: Characters, then Wounded Stands starting with the Command Stand, then restoring lost Stands. A restored Stand needs at least half its W in Heal points. Broken Regiments can't be healed.
- Losing the Command Stand removes the Command Models' rules, and the Regiment makes a free Reform to close the gap (core p.68).

## 15. Morale, Broken, Shattered (core p.59–61)

### Resolve

- Use the highest R in the Regiment.
- Add +1 for 4–6 Stands, +2 for 7–9 and +3 for 10 or more. Only the highest bonus applies.

### Morale Test

- Roll one die per Wound suffered from the pool.
- Each roll above R is one more Wound. These extra Wounds don't trigger further tests.

### Broken

- A Regiment is Broken when it has lost at least half of the Stands it had at the start of the Round, or since its last Rally, rounding up.
- While Broken:
  - it uses its lowest R and ignores in-game R bonuses;
  - it can't Charge;
  - it can't be healed;
  - it doesn't count for seizing;
  - it can't be Inspired;
  - its Character can't decline a Duel.
- Rally or Combat Rally removes Broken.

### Shattered

- A Broken Regiment that loses half or more of its remaining Stands in the same Round, counted from when it Broke, is destroyed.

### Stranded and Press the Attack

- When casualties break contact, the Active Player pushes each Stranded enemy back into contact by the shortest route. The push tries to restore the previous number of Stands in contact.
- The push is not a move: it causes no Impact and triggers no March rules.

## 16. Command Models (core p.68–69)

- Every Infantry, Cavalry and Brute Regiment has a Command Stand, which is always the last Stand removed.
- Monsters and Chariots have no Command Stand.
- **Leader:** +1 A on the Command Stand, and +1 Barrage X if it has Barrage.
- **Standard Bearer:** the Regiment gains Unstoppable, and +1″ M on the second March of an Activation.
- Officers are faction-specific.

## 17. Characters (core p.72–76)

- A Character joins a same-Type Regiment in its Warband. It sits in the front rank next to the Command Stand and takes the Regiment's Class. It adds to the Regiment's size for Resolve and similar rules.
- A Character has its own Command Card but only **one** Action per Round, from its own Character Actions.
- When its Regiment acts, it fights and shoots alongside it: full Attacks if Engaged, otherwise 1 Support Attack.
- **Entourage Activation:** after the Character's activation, the player may draw the next card. If it belongs to that Character's unactivated, non-Monster Regiment, that Regiment activates at once. Otherwise the card goes back on top of the Stack.
- A Character can only be wounded by **Duels** and by rules that specifically wound Characters. Clash and Volley can't target it.
- **Die Fighting:** if the Regiment is destroyed and the Character hasn't acted, it makes a free Clash, or is removed if nothing is in contact. This doesn't apply to Monster Characters.
- **Duel** (Combat Action):
  - Challenge an enemy Character in a Regiment in contact.
  - **Decline:** the challenged Regiment can't seize, uses its lowest R, can't be Inspired and re-rolls successful Resolve tests of 1, all until the end of the Round.
  - **Accept:** both Characters attack each other at the same time. The loser's Regiment makes a free Combat Reform (AMB-12).
- **Warlord:** chosen at list building. It provides the Supremacy Ability, which is one of [Always Active], [Battlefield] or [Activated]. An [Activated] ability is used once per game, in the Supremacy Phase, and lasts until the end of the Round.
- Pack p.8 also mentions a **Seek New Escort** Action. Its text isn't in either PDF (AMB-13).

## 18. Magic (core p.80–81)

- A **Wizard (X)** or **Priest (X)** rolls X dice. Each die at or under the spell's Attunement is a success, and 2 successes are needed.
- **Scaling** spells need extra successes for larger targets: +1 for 4–6 Stands, +2 for 7–9, +3 for 10 or more, and +1 against a Monster.
- An enemy caster within 10″ gives −1 Attunement.
- Hits from spells use Defense and Morale, but not the flank and rear bonuses.

Spires use "Practitioner" Actions instead. They are faction-specific and listed on the army list.

## 19. Terrain (core p.84–90; pack p.3–4)

- Terrain is **out of scope for the MVP**. A summary is kept for the roadmap.
- **Zonal terrain** keywords: Elevated (adds its Size to Stands on it), Cover (halves Barrage X when shooting through it or into it), Obstructing, Traversable, Hindering (no Impact, no Inspired), Dangerous, Perilous, Impassable and Water.
- **Garrison terrain:** a Capacity, a Defense bonus, 360° sight, and its own rules for occupying and leaving.

## 20. Draw Events and special rules (core p.94–101)

- The same named rule (X) doesn't stack with itself; (+X) does. Auras are measured from any point of the Stand.
- The MVP special rules are summarised below. These are mechanics only; the rule text the player sees comes from their uploaded list.

| Rule | Effect, paraphrased |
|---|---|
| Impact (X) | X Impact Attacks per Stand after a successful Charge |
| Barrage (X) [range, …] | X Shots per Stand when Volleying; range and sub-rules in brackets |
| Armor Piercing (X) | Volley or spell hits reduce the target's D by X |
| Deadly Shot | Volley: each failed Defense roll of 6 causes 2 Wounds |
| Cleave (X) | Clash or Duel hits reduce the target's D by X |
| Flurry | Re-roll failed Clash or Duel hit rolls |
| Shield | +1 D against hits from the front arc (not while garrisoned) |
| Leader / Standard Bearer | See section 16 |
| Unstoppable | May re-roll a failed Charge roll |
| Fearless | Ignores Fearsome and Terrifying |
| Fearsome | Enemies in contact must pass an R test before Combat Rally or Combat Reform, or lose the Action |
| Terrifying (X) | Enemies in contact take −X R on Morale Tests against this Regiment's Wounds |
| Fly | Marches and Charges over other Regiments; can't end overlapping |

## 21. Objective Zones, Objective Markers and scoring (core p.106; pack p.8–9)

### Objective Zone

- A circle, usually 6″ or 9″ across. A Stand is "in range" of the zone if it **overlaps** the circle.
- Zones can be seized from **Round 2**. A zone friendly to a player can't be seized by that player.

### Seizing

- A player seizes a zone when they have both **more total Stands** in range **and more seizing Stands** in range than the opponent.
- Seizing weights: Light = 0, Medium and Heavy = 1, Monster = 3.
- Stands that count 0, or that have lost the ability to seize (for example because they're Broken), still count toward the total.
- Rules that let a Stand "always seize" override the count. Only one player can hold a zone at a time.

### Objective Marker

- A model on a Brute or Cavalry base, Size 2, which counts as an enemy entity. It doesn't activate or seize, and can't be moved or healed.
- Regiments may March within 1″ of a Marker, or through it.
- From **Round 2** a Marker can be Charged or Clashed. It can only be Volleyed if it is within Effective Range.
- It has **3 Wounds and Defense 3**, and no Resolve. The non-active player rolls its saves.
- It takes no more than 1 Wound from each Volley, spell or other effect. From a Clash or Charge it takes no more than 1 Wound from a Light or Medium Regiment and 2 from a Heavy one.
- Damage is tracked separately for each player. A Marker is destroyed when one player has dealt 3 Wounds.
- A friendly Marker inside a zone makes that zone **Contested**: the enemy can't seize it.

### Heroic End

- A player with nothing left on the table or in Reinforcements doesn't lose automatically. The opponent keeps playing and scoring (pack p.8).

### Forlorn Hope (pack p.15)

- **Table:** 72″ × 48″.
- **Zones:** two 9″ and two 6″.
- **Markers:** two. Each is friendly to the player whose edge it is nearer (owner ruling, AMB-14).
- **No Reinforcement:** on both side edges, from 12″ to 36″ measured from Player 1's edge.
- **Victory Points each Round:**
  - 3 for each enemy Marker destroyed that Round;
  - 2 for each zone seized;
  - +3 when seizing three or more zones;
  - 2 for each enemy Character Stand destroyed that Round.
- **Length:** 10 Rounds.
- **Hand check:** seizing 3 zones scores 2×3 + 3 = 9 VP, and seizing 4 zones scores 2×4 + 3 = 11 VP.
