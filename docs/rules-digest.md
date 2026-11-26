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
- **Shared effects:** an attached Character is affected by the Regiment's rules and characteristic changes gained this Round (Strains, Draw Events, Spells; core p.72; AMB-59).
- **Die Fighting:** if the Regiment is destroyed and the Character hasn't acted, it makes a free Clash, or is removed if nothing is in contact. This doesn't apply to Monster Characters. The engine removes the Character after that Clash (AMB-35).
- **Character Actions:** Snapshot (a small Volley) and Mighty Swing (a Clash) are automated, as are the faction ones: Break Their Lines (od p.21), Grotesque Elixir and Preservation Protocols (sp p.28, p.30), and the Practitioner Actions. An Action from a faction the engine does not cover is shown and logged as manual.
- **Rider (core p.100):** the Character has no Stand of its own. It shares the Monster's Stand (distances, Line of Sight, contact), the Regiment counts as two Stands and Marches with the Monster's March, and the Character can Duel (AMB-86).
- **Duels with a Character that is a Regiment by itself (od p.8):** it fights with its Regiment's profile and takes the Wounds on its Stand (AMB-48). Relentless Blows adds Hits in a Duel (core p.100). A Character with no Resolve makes no Resolve rolls.
- **Die Fighting! (core p.74):** also for Command Stands that may "Die Fighting! as if they were Characters" (Ardent Creed, dw p.6; the Fallen Divinity's sacrifice, od p.8), and for upgrades that always Die Fighting (Bloody-Minded Focus, Strength and Honor, Convulsive Doom).
- **Aura of Death on Activation (core p.97):** if it destroys the Regiment, its player draws again; with no card left, play passes.
- **Duel** (Combat Action):
  - Challenge an enemy Character in a Regiment in contact.
  - **Decline:** the challenged Regiment can't seize, uses its lowest R, can't be Inspired and re-rolls successful Resolve tests of 1, all until the end of the Round.
  - **Accept:** both Characters attack each other at the same time. The loser's Regiment makes a free Combat Reform (AMB-12).
- **Warlord:** chosen at list building. It provides the Supremacy Ability, which is one of [Always Active], [Battlefield] or [Activated]. An [Activated] ability is used once per game, in the Supremacy Phase, and lasts until the end of the Round.
- Pack p.8 also mentions a **Seek New Escort** Action. Its text isn't in either PDF (AMB-13), so it stays a manual tool.

## 18. Magic (core p.80–81)

- A **Wizard (X)** or **Priest (X)** rolls X dice. Each die at or under the spell's Attunement is a success, and 2 successes are needed.
- **Scaling** spells need extra successes for larger targets: +1 for 4–6 Stands, +2 for 7–9, +3 for 10 or more, and +1 against a Monster.
- An enemy caster within 10″ gives −1 Attunement.
- Hits from spells use Defense and Morale, but not the flank and rear bonuses.
- Spells that cause Hits need Line of Sight. An engaged caster may only target the enemy it is in contact with.
- A unit can't be the target of the same Spell twice in a Round (Hit Spells excepted), and a caster can't cast the same Spell twice in one Activation (core p.76).
- **Devout** (core p.97): one failed die becomes a success when a friendly Priest targets the Regiment.
- **Automated** (`src/engine/spells.ts`): the Spellcasting Action for a Character in its own Activation, or for a Regiment that can cast. The Old Dominion Spells have their effects automated (section 22). Any other Spell can be cast by entering its Attunement; the engine rolls the dice and the effect is applied with the manual tools.

Spires use "Practitioner" Actions instead. They are faction-specific and listed on the army list.

## 19. Terrain (core p.84–90; pack p.3–4; 2026 scenarios ns p.1)

Code: `src/engine/terrain.ts` (rules) and `src/engine/terrainLayouts.ts` (layouts).

### The 2026 terrain set (ns p.1)

| Piece | Size | Keywords | Footprint |
|---|---|---|---|
| Hill | 2 | Elevated, Obstructing | 8″ × 6″ |
| Structure | 2 | Impassable, Obstructing | 8″ × 6″ |
| Forest | 3 | Traversable, Hindering, Cover | 10″ × 6″ |
| Pond | 0 | Traversable, Water, Hindering | 10″ × 6″ |
| Field | 1 | Traversable, Cover | 8″ × 6″ |
| Boulder | 4 | Impassable, Obstructing | 6″ × 6″ |

### Rules

- **Within:** a Stand with any part inside a piece is within it (core p.86).
- **Size and Elevated** (core p.12, p.84): Infantry 1, Cavalry/Brute/Chariot 2, Monster 3. A Stand on an Elevated piece adds the piece's Size. Stands see over Regiments and Obstructing terrain of lower Size, and a Volley at a larger target ignores anything smaller than the target.
- **Obstructing** (core p.86; pack p.4): blocks Line of Sight when its Size is at least the shooter's and the target's. Stands on the piece see and are seen freely.
- **Cover** (core p.86): Barrage is halved (rounding up) when the line passes through Cover, or when the target has every Stand within Cover of at least its Size. There is no penalty when the whole shooting Regiment is in the same piece as the target, and no penalty from the piece a shooting Stand is in (AMB-62). It does not stack with Loose Formation (core p.99).
- **Hindering** (core p.86): if at least half the Stands charge through it, there are no Impact Attacks, and a Medium or Heavy Regiment cannot be Inspired for the rest of the Round.
- **Water** (core p.87): −1 Clash (minimum 1) with at least half the Stands within it.
- **Impassable** (core p.87): no moving through or ending on it.
- **Fly** (core p.98): passes over Impassable terrain but cannot end on it. It ignores Zonal Terrain it does not start or end in.
- **Garrison Terrain:** not modelled (AMB-61).

### Placement (pack p.3–4; ns p.1)

- **Spacing:** pieces at least 9″ apart; about 6 pieces, never more than 9; at least 2 Obstructing.
- **Objectives:** no Impassable piece on an Objective Zone, and nothing on an Objective Marker.
- **Symmetry:** both halves of the table match. Every 2026 layout pairs each piece with a twin turned half a turn about the centre.
- **Layouts:** the five 2026 layouts are read off their diagrams (ns p.7–9). When a layout is used on a scenario whose objectives it clashes with, the offending pair moves the least distance that makes it legal (pack p.4), keeping the symmetry.
- **Random layouts:** three mirrored pairs (one Obstructing, one Cover) and sometimes a centre piece, checked against all the rules above. The same seed always gives the same table.

### 2026 scenarios (ns p.2–6)

- **Seek and Destroy:** 2 VP per zone and 1 VP per Regiment destroyed. Chosen Regiments (up to three non-Light enemy Regiments, designated by the engine at the start and changeable until the first Supremacy Phase): +2 VP per zone Seized with your own Chosen Regiments, +1 VP per enemy Regiment they destroy, +3 VP per enemy Chosen destroyed, and +3 VP per Chosen the enemy army lacks (AMB-91).
- **Wheel of War:** a Priority Zone (+2 VP), starting nearest P1 and moving clockwise each Round.
- **Cursed Sanctuaries:** Victory Phase Hits against Resolve, 4 in a 6″ zone and 8 in a 9″ zone (AMB-63).
- **Flames of Conquest:** from Round 4 a Regiment Seizing a zone may Burn it for 4 VP, and the zone leaves the game (AMB-64).
- **Break the Line:** 2 VP per zone and 1 VP per Regiment destroyed. Two Linebreakers per player (they lose Fly): +3 VP per enemy Linebreaker destroyed, +5 VP per unengaged Linebreaker wholly in the enemy's 6″ band (AMB-91).

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

### Also automated (v1.2)

The registry in `src/engine/rules/special/rules.ts` lists each rule with its page. In short:

- **Hit and defense modifiers:** Brutal Impact, Linebreaker, Deadly Blades, Smite, Torrential Fire, Relentless Blows, Rapid Volley, Precise Shot, Flawless Strikes, Opportunists, Fiend Hunter, Parry, Hardened, Untouchable, Brittle, Tenacious, Phalanx, Shield and Loose Formation (core p.96–101).
- **Morale:** Indomitable, Oblivious, Iron Discipline, Bravery, Dread, Dauntless and Unyielding (core p.96–101).
- **Charging and moving:** Juggernaut, Glorious Charge, Fury, Shock, Trample, Pathfinders, Fluid Formation, Flawless Drill, Swift Retreat and Acute Senses (core p.96–101). A successful Charge may push the Charger up to 1″, or pivot the target, to make contact (core p.44; AMB-38).
- **Triggers:** Aura of Death, Blessed, Bodyguards, Counter-Attack, Lethal Demise, Quicksilver Strike, Decay, Longshot and Weapon Platform (core p.96–101).
- **Volleys (v2.4.0):** Sureshot ignores Cover (core p.100). Arcing Fire (core p.97): with Aimed Shot (or a Take Aim, AMB-90), a Volley at an enemy in the front arc that a friendly Regiment can see, as a Clear Shot, at −1 Volley, only by Stands with Arcing Fire; Cover halves it only when every target Stand is within it. Unhallowed Ground counts as Size (4) for Line of Sight (od p.15).
- **Draw Events (core p.94–95):** Bastion, Double Time, Fire and Advance, Murderous Volley and Regeneration. Regeneration heals Wounds or restores Stands (core p.56).
- **Spires:** Biotic Renewal, Flux-Powered, Strain Expression with Decay, Superior Creations, Lobotomytic Override, Suppress Higher Functions, Ferro-Ossified Carapace, Designate Target, Reprocessing, Just Desserts by Sect, and Character options such as Avatar Projection. Mechanics follow the rule text in the uploaded list. Strains are entered by the owner on the list review screen, because the export doesn't contain them (AMB-18).
- **Combat flow:** a Clash is split between every enemy the Regiment's Stands touch, and Press the Attack follows Clashes and Charges (core p.46, p.61).

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

### What the engine does each Round

- At the end of each Round it works out who seizes each zone from where the Stands are.
- It scores Markers destroyed and Characters and Regiments killed that Round.
- It applies the scenario's scoring rules.

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

## 22. Old Dominion (Old Dominion army list, 2026 "Tainted Earth" update; cited as od p.N)

Mechanics only, in my own words. Names and values come from the uploaded list, and the code is in `src/engine/factions/`.

### Animate Vessel (od p.5)

- Gains Terrifying (1) and Brittle.
- Cannot perform the Inspire Action.
- Has no Resolve: Morale Tests, Fearsome, Withdraw and Combat Reform tests pass automatically.
- A Character with it lends no Resolve to its Regiment.

### Memories of Old (od p.5)

- A Combat and Out-of-Combat Action giving the listed rules until the end of the Round. It doesn't stack.
- Text effects that are automated: a Command Stand counting +1 for Seizing (od p.24), and the free Spellcasting with Priest (2 per Stand, at most 12) (od p.23).
- Bastion +1 becomes +1 Defense.

### Empowerment (od p.6)

- Each Stand lost by an Animate Vessel Regiment gives 1 Power Token, added at the end of the Action, after Morale.
- Tokens go to the Dark Power Pool or the Fallen Pantheon Pool. The player sets the default pool; the Fallen Pantheon Pool only exists with a Fallen Divinity Warlord (AMB-49).
- **Tiers** at 2,000 points:
  - Tier II from 9 Tokens;
  - Tier III from 18;
  - Tier IV from 23, with the Xhiliarch, Strategos or Mounted Strategos only (AMB-45).
  - Each threshold moves by 2 for every full 250 points above or below 2,000.
- **Blasphemous Soma** (od p.6): +1 Token each Round, before the Supremacy Phase.

### Dark Power Pool (od p.7)

It affects Animate Vessel Regiments only, not the Fallen Divinity.

- **Tier II:** Memories of Old can also be used as a Draw Event, in addition to another one, and both Actions remain.
- **Tier III:** Inspired (AMB-46).
- **Tier IV:** enemies engaged with them re-roll successful Morale Tests.
- Effects that "count as Tier +1" stack up to the highest Tier allowed.

### Fallen Pantheon (od p.7, p.13)

- **Font of Dark Power:** Tokens from friendly Stands lost within 12″ of the Fallen Divinity go to this pool.
- **Divine Shard** (od p.27): one extra Token when that happens.
- **Tiers II and III:**
  - the Fallen Divinity uses that Tier's profile (read from the export's Tier blocks, editable on the list review screen; AMB-47) and Heals 4 or 6 the first time;
  - other [The Fallen Pantheon] Animate Vessels within 12″ get +1 or +2 Attacks and Memories of Old as a Draw Event;
  - at Tier III, Animate Vessels within 12″ are also Inspired.
- When the Fallen Divinity is destroyed, its Tokens move to the Dark Power Pool.

### Unit rules

- **Acolytes** (od p.22): +2 Tokens when the Command Stand is lost.
- **Forced March** (od p.24): the Standard Bearer gives +2″.
- **Unhallowed Ground** (od p.15, p.30): counts as 6 Stands toward the total in a zone, 0 toward Seizing, and cannot be Healed.
- **Wedge! / Sundering Charge** (od p.28–29): Cleave (+1) after a successful Charge.
- **Tenacious (1) against Volleys:** for entries whose text says so (od p.13, p.25).
- **Officers** (od p.31):
  - Profane Reliquary: Aura of Death (1);
  - Optio: Vanguard (4);
  - Dark Cenotaph: +1 Token when Memories of Old is used as a Draw Event;
  - Hetairos: re-roll failed Impact Hit Rolls of 6 (AMB-50).
- **Characters that are Regiments** (Fallen Divinity, Theokrator; od p.8, p.15): own one-Stand Monster Regiment and card. The Fallen Divinity rolls for Reinforcements as Light (AMB-48).

### Draw Events

- **Dark Shepherd** (od p.11): Wounds equal to what is left on the most wounded Stand, with no Morale. A Hierodeacon Warlord doubles the Tokens.
- **Dark Awakening** (od p.28): 2 Tokens per effect (AMB-43). The effects are +2 Clash, Cleave (2), Brutal Impact (2) and Impact (+2).
- **Heaven's Descent** (od p.28): 2 Tokens while Engaged. Impact Attacks, plus Inspired and Cleave (+1).
- **Exhortation of Eternal Faith** (od p.30): 3 Wounds and +1 Token. Then either +6 for Seizing, −1 Resolve for enemies within 12″, or the [Aura]: friendly Command Stands within 12″ Clash with +3 Attacks and Cleave (1) (AMB-44).
- **Exploitation of Divine Vanity** (od p.16): 3 Wounds and +1 Token. Then either Aura of Death (+10), 1 Token per 2 enemy Stands destroyed, or a target that re-rolls successful Morale Tests.
- **Unholy Sacrament** (od p.19): 1 Token for Priest (+3) on the first Spell.
- **Blasphemous Mesa** (od p.8): 1 Token for a free extra Spell.

### Spells (od p.22–23)

- **Dark Supplication:** +1 Token.
- **Blackflame Coruscation:** Hits equal to the successes plus the highest Tier.
- **Benediction of the Black Sun:** Blessed for a Brute Regiment.
- **Undying Devotion:** [The Fallen Pantheon], and +1 Token per Stand lost.
- **Unholy Baptism:** Hits with AP (1).
- **Blasphemous Power:** [The Creed], and Tier +1. At the top Tier it gives Flurry and Decay instead.
- **Hazlia's Touch:** Heals 1+X for [The Creed] or [The Legion], otherwise X.
- **Dark Immolation:** [The Creed] and Aura of Death (+1).
- **Insanity:** 2 Hits per success against Resolve, with no Morale (AMB-42).
- **Drain Will:** −1 Defense, to a maximum of −2.
- **Immolation:** Aura of Death (+1).
- **Translocation:** an out-of-sequence 8″ move in any direction, ignoring what is in the way, offered straight after the Spell.

### Supremacy Abilities (od p.8–10)

- **Archimandrite:** Aura of Death (+1) for the army. A [The Creed] or [The Legion] Regiment can spend 1 Token as it Activates for Aura of Death (+1), to lose Brittle, or for Terrifying (+1).
- **Fallen Divinity:** [Activated] sacrifice up to 3 Stands of a [The Fallen Pantheon] Regiment for Tokens.
- **Hierodeacon:**
  - a free extra Spell;
  - no Brittle in the army;
  - Cultists and Hashashin gain [The Fallen Pantheon];
  - [Activated] [The Fallen Pantheon] Regiments gain Blessed.
- **Strategos:** Tier IV; [Activated] every Supremacy Phase, two [The Legion] Regiments each pick one of Tier +1, Memories of Old, a 2D6 Charge or losing Brittle.
- **Mounted Strategos:** Tier IV; Glimmers converts 1+X failed Hits (AMB-41); [Activated] it counts as Tier IV.
- **Theokrator:** Terrifying (+1) at Tier III; once per Round 1 Token gives a Regiment Trial of Will for its next Clash; [Activated] Trial of Will for [The Creed] and [The Legion] this Round. Trial of Will: Defense Rolls against the target's Resolve (less the attacker's Terrifying) when that is lower; a target with no Resolve suffers −1 Defense.
- **Xhiliarch:** Tier IV; Vanguard 2 for Medium [The Legion] Regiments and 4 for Heavy ones; +X Charge distance once per Round (AMB-41).

### Treasures and Dark Blessings (od p.17–21)

- **Automated:**
  - Vexilla of the Lost, Legio I 'Primigenia', Caelestine Banner;
  - Armor of the Living Saint, Imperial Oplon, Aventine Armor;
  - Unholy Sacrament, Consecrated Mitre, The Reaping Crook, Grave Step;
  - Calamitas, Harvest of the Fallen, Skofnung, Eleutherea (+1 Clash);
  - Aura of Malice, Eternal Discipline, Kentarch, Strength and Honor (Brittle only), Gladiator;
  - Unholy Mastery, Schemophore, Devoted to Hazlia, Viaticum.
- **Also automated (v2.4.0):** Cuirass of Hazlia's Shadow (survives one Duel with 1 Wound, cannot decline, a declined Duel gives −1 Attacks for the game), Hierotekton (joins the Bone Golems; the export shows the rest), Anastegma (two Morale dice per Wound), Soul Reaper (X Tokens for +X Attacks, before a Clash), Implacable (Break Their Lines: Linebreaker this Round, AMB-88), What We Did in Life (a declined Duel re-rolls successful Morale; Flurry against Broken Regiments), Eleutherea (Parry, Counter-Attack and Cleave (+1) in Duels), Strength and Honor (always Dies Fighting). Sanctified Labaron is list building only.

## 23. Spires (Spires army list, 2026 post-Adepticon update; cited as sp p.N)

Mechanics are in `src/engine/factions/spires.ts`.

### Strains (sp p.5, entries p.21–33)

- **Built in:** every Regiment's Strain is built in, so nothing needs typing. A Strain typed on the list review screen replaces the built-in one.
- **Strain Expression:** the Strain lasts until the end of the Round, together with Decay (1 Wound per Stand, or 3 for a Monster, at the end of the Activation, with no Morale).
- **Disruptive** (Stryx): enemies in contact with its front arc get −1 Clash, to a maximum of −1.
- **Hypersynaptic Bonding** (Vanguard Clone Infiltrators): its Volley ignores the target's Loose Formation. Cover is not modelled.
- **Microbial Shroud** (Pteraphon Surveyor): enemies within 8″ cannot Heal, Rally or Combat Rally.
- **Hypercatalytic Discharge** (Desolation Beast): no Evasion against its Volleys (AMB-56).
- **Adrenal Hysteria** (Onslaught Drones): +2″ Charge Distance, and Linebreaker.
- **Optimized Fodder** (Force Grown Drones): Decay is at most 8; with 6 or more Stands, Lethal Demise (2).
- **Induced Aggression** (Pheromancer Warlord): [Drone], [Clone] and [Monstrosity] Regiments may take +1 Clash (to 4) and +1 March instead of their Strain. Its own Regiment suffers no Decay (AMB-57).

### Practitioner Actions (sp p.15)

- **Biomancies:**
  - Essence Transfer: 2D6, the lower in Wounds to one friendly Regiment, then Heal 4 on another;
  - Unstable Enhancement: D6 for +1 March, Clash or Volley (to 4);
  - Catalytic Rupture: the highest of 2D6 in Hits with AP (1) to enemies in contact;
  - Grant Virulence: D6 Hits with AP (6 − roll).
- **Pheromancies:**
  - Induce Vigor: Untouchable;
  - Pheromantic Drive: Tenacious (1), and re-roll failed Resolve rolls of 6 within 12″;
  - Pheromantic Compulsion: an enemy Monster counts 0 for zones;
  - Siphon Strength: no Inspired or Aimed.
- A friendly Regiment can be the target of one Practitioner Action per Round. A Pheromancer or Biomancer Warlord gets a free extra one each Activation (AMB-58).

### Other

- **Epigenetic Trigger** (Biomancer): a Command Stand gets +2 Attacks.
- **Upgrades:** Hyperadrenal Stimulation, Linked Neuroreceptors, Degenerative Aura, Induce Lethargy, Endocrine Overstimulation and Grafted are automated.
- **Consumption Beast:** starts with 8 Wounds.
### v2.4.0 additions (cited by PDF page of the 2026 post-Adepticon document; the entries above use the earlier numbering)

- **Supremacy:** Field Studies (Observation Tokens, at most 4, one per Regiment destroyed: 1 for an extra Practitioner die, 2 for a Strain Expression without Decay, 3 on the last Command Card to remove Broken and Heal 5; sp p.8). Ruthless Competence (once per Round: Opportunists for a [Clone] Clash or Volley, no Inspired for an enemy Clashing a [Clone], or an out-of-sequence March after a friendly Regiment is destroyed; sp p.9). Lambs to the Slaughter (Fearless and Fury; [Activated] Hit Rolls of 6 count as 1 for [Husk]; sp p.10). Tricks of the Trade (a 5-dice Influence Pool that replaces dice in the Action Phase, topped up by Supremacy Rolls; sp p.10).
- **Merchant Prince:** Master Manipulator Offers before Reinforcement Rolls; accepted, both players bring one more Regiment (the proposer's with Vanguard (3)); declined, the proposer re-rolls one failed roll or gives Vanguard (3) (sp p.22).
- **Mimetic Assassin:** Assassination Directive replaces a front Stand as a Clash is declared, then Hits with Cleave (2) and an optional Duel (sp p.24).
- **Upgrades:** Master of Flesh, Grotesque Elixir, Preservation Protocols, No Matter the Price, Induced Fawn Response, Lineage Commander, Convulsive Doom, Infiltration and Marksman Optimization Strains, Chain Reaction (sp p.28–31).
- **Units and Officers:** Catabolic Node, Assault Preceptor, Lineage Guard, Privileged Observer, Ward Preceptor, Inherited Excellence, Spined Descent, Indiscriminate Omnivore, Gorged and Endless Hunger (sp p.31–50).
- Choices made by the engine are listed in AMB-89.


## 24. Sorcerer Kings (Sorcerer Kings army list, 2026 "Tainted Earth" update; cited as sk p.N)

Mechanics in our own words. The code is in `src/engine/factions/sorcererKings*.ts`.

- **Courts (sk p.4, p.8–15).** A Character picks a Court (Fire, Air, Water or Earth) and knows all of its Spells and Rituals. [Mortals] take the Court of their Warband's Character. Mahabharati Initiates, Sorcerer Saints and Ghols take the Warlord's Court. The Mahabharati Sardar has the Warlord's Court. Elementals keep their own. The Court shows as a [Court of …] role. Reading the Court from the export is AMB-65; the list review screen has a Court picker.
- **Rituals (sk p.5, p.22–25).**
  - At the end of each Supremacy Phase a player keeps or replaces the Ritual Being Prepared. Only one is Prepared at a time, and only from Courts of living spellcasting Characters. Losing every such Character removes it.
  - Markers come from three places: each successfully cast Spell of the same Court adds one (AMB-70); Elemental Conduit adds one, even while arriving; and Elemental Discharge gives the first new Ritual of each Round Markers equal to the Round number, at most 5.
  - At its Threshold the Ritual is completed and its Markers removed. Its Command Card joins the next Command Stack, and drawing that card resolves the Ritual.
  - The same player then draws again. A card of the Ritual's Court Activates at once; any other card goes back on top and play passes (AMB-71). Far Sight lets any card follow.
  - A completed Water Ritual, or any Ritual under Elemental Confluence, starts another of an allowed Court straight away. It can be changed while it has no Markers.
- **Inflamed (sk p.18).** A status until the end of the Round. Fire Elementals gain Juggernaut while Inflamed, or when charging an Inflamed enemy, and still add Charge Distance bonuses. Infernal Branding gives Rapid Volley in the same cases.
- **Court Spells (sk p.18–21).** All 24 are automated. Air Step offers its 2″ move straight after the Spell; Sunder targets a zone (AMB-69).
  - Hit Spells check Line of Sight. Lightning Bolt adds the target's Defense in Hits, and Blood to Water its Resolve, when the target is engaged with a friendly Regiment of that Court.
  - Ignite inflames every other Regiment within 6″ (AMB-68).
  - Cauterize and Earthquake stop Healing. Induced Hypoxia uses the lowest unmodified Resolve (AMB-75).
  - Cyclone makes the target count as 0 Stands in the Victory Phase if it is engaged with an Air Regiment.
  - Reinforce stops Charges and Reforms and blocks Impact and Trample Hits.
  - Stabilize protects Elementals within 8″ from Aura of Death and Decay.
- **Supremacy (sk p.6).**
  - Elemental Confluence: Conduit Markers go to any Ritual, and a completed Ritual chains to another Court.
  - Omnipotence: 4 or more successes give a free Spellcasting Action once per Activation. A Character attempts each Spell once per Round, and each Spell is cast at most three times per Round.
  - Elemental Dominion: Fire grants "Fan the Flames", which the list does not define and so has no effect (AMB-74). Air gives Opportunists. Water gives +2 Impact and Terrifying (1) on flank and rear Charges. Earth gives Regeneration (2).
- **Unit rules (sk p.27–46).**
  - Gifted Mortals: a friendly Character's Spell on them is cast automatically. Eminence: +2 Evasion and +5 Stands for Scaling against enemy Spells.
  - Air Elemental: +1 Evasion, to at most 3, after the first March of an Activation. Water Elemental: no Water penalty, and re-rolls failed Hit Rolls of 6 in Water. Earth Elemental: Untouchable within 3″ of Earth terrain (AMB-67).
  - Earthen Aegis: Regeneration (+4) near Earth terrain. Shattered Perfection and Raging Elements apply the first time the Regiment is below its starting strength.
  - Arrogance and Hubris: +3″ Charge Distance. Last Word: 8 flank Hits on an enemy, chosen by the engine (AMB-72).
  - Trinavarta: Tenacious (1) against Volleys. Elemental Tether lets Air spellcasters target near the Sabhagrih. Fury of the Tempest and Eye of the Storm apply after an Air Ritual.
  - Mahut: a free Volley, at most one Volley, Volleys in contact, and Gilded Statue.
  - The Marid Forms are chosen when Activating. Dread Tide and Tidecaller apply. Aqueous Branding adds one success to Water Spells. Marid Sahar has a free Spellcasting Action.
- **Character upgrades (sk p.16–17).** Automated:
  - Banner of Elemental Dominion, Dancing Scimitar, Prijm Khanjar, Jadoo Kavach and Shu'laat;
  - Recorder of all Deeds, Prince of the Setting Moon and Vizier of the Morning Star;
  - Best Money can Buy, Elemental Feedback, Bound to the Elements (the Character joins a Regiment of any Type) and Elemental Projection;
  - Niyantran, and Favored of Hormus (the Character rides a Mahut, which loses Barrage and gains Terrifying (1); friends within 3″ count as near Earth terrain).
- **Arrogance (sk p.34):** the Rakshasa makes a free Duel as if it were a Character Stand; a declined Duel gives it Flurry this Round.
- **Tidal Wave** (Marid Lancers) is not defined in the list and has no effect (AMB-87).

## 25. Dweghom (Dweghom army list, November 10th 2026; cited as dw p.N)

Mechanics in our own words. The code is in `src/engine/factions/dweghom*.ts`.

- **The Gift (dw p.4).** "Awakened" lasts until the end of the Round. An Awakened Regiment cannot become Broken, and a Broken one Rallies out of sequence as it Awakens. A Regiment that is already Awakened, or always counts as Awakened (Litanies of Victory), cannot Awaken again.
- **Forged (dw p.4).**
  - The Elemental Power pool holds at most 10 Markers. Every [Forged] Regiment has the Forged By the Elements Draw Event: it spends Markers on its Empowerment, once per Round, and becomes Awakened. A [Forged] Regiment that does not use it adds a Marker at the end of its Activation.
  - Empowerments (dw p.30–43):
    - Fireforged: Barrage (+2).
    - Hellbringer Drake: Barrage (+2) and Armor Piercing (+1). With Hellbringer Sorcerer, 3 Markers give double and 5 give triple, with Armor Piercing at most +2.
    - Inferno Automata: +1 March, or Impact (+2).
    - Found: Barrage (+1) and +4″ range.
    - Magmaforged: +2″ Charge or +1 Defense, or both for 3 Markers.
    - Steelforged: +2 Attacks or Hardened (1), or both for 3.
    - Stoneforged: Heal 3 or +2 March.
- **The Unbound (dw p.5).** Dweghom Regiments are never Shattered.
- **Creeds (dw p.5–8).** The Creed comes from the list's sub-faction line, else from the Warlord (AMB-78).
  - Ardent: a successful Charge, or destroying an enemy Regiment, Awakens [Ardent] and [Clan] Regiments. Every friendly Regiment gains Pathfinders.
  - Tempered: [Tempered] Characters add a Marker for each School Spell they cast, and may spend 2, 4 or 6 Markers for +1, +2 or +3 Wizard on a Spell.
  - Clan: Awakened [Clan] Regiments gain Oblivious and Iron Discipline.
- **Supremacy (dw p.6–8).**
  - Herald of War: its Regiment Awakening also Awakens [Ardent] Regiments within 8″. [Activated]: [Ardent] Regiments Heal 4 and gain Lethal Demise (+4).
  - Paragon of War: while its Regiment is engaged, every friendly Regiment is Awakened. The Character gains Forward Force.
  - Living Legend: Ardent and Tempered are both active.
  - Thesis/Antithesis/Synthesis: non-Monster [Forged] Regiments Heal 2 on Awakening; once per game, 3 Markers Heal 5 instead (AMB-79). [Activated]: each [Forged] Regiment adds a Marker when it Activates.
  - Forgemaster: one free extra Spellcasting each Round, and the Sorcerer attempts each Spell once per Round.
  - First Born of War: two Regiments Awaken at the end of the Supremacy Phase (AMB-83). The Character gains Forward Force.
- **Characters (dw p.10–21).**
  - To the End: Duels continue until a Character dies, and a declined Duel Awakens the challenger's Regiment.
  - But First: a free Duel after a Spell. Hymns of War: a Spell Awakens a nearby [Ardent] Regiment (AMB-84).
  - Preternatural Focus and Unassailable Authority: Draw Events that Awaken a Regiment.
  - Igneolithic Mastery: no Enemy Interference for the Steelshaper; enemy Spells on its Regiment, or on [Forged] Regiments within 10″, need 1 more success.
  - Refined Beyond Nature: no penalty for refusing a Duel.
  - The Lost Ancestor may join Infantry and never Dies Fighting. With Not All who Wander, Lost and Found may spend 2 Markers to Awaken.
- **Spells (dw p.26–28).**
  - Fire: Coruscation, Fireball, and Flame Wall (4 or more successes: the target counts as within Hindering terrain).
  - Magma: Magmatic Seep and Eruption target terrain, which becomes Erupting. Pyroclast hits the flank, and reaches any enemy within 6″ of Erupting terrain.
  - Earth: Roots of Stone, Broken Ground, and Rock Shaping (+1 Marker).
  - Steel: Hone Blades, Unmake Armor (Attunement equal to the target's Defense), and Temper Plate.
  - The Kerawegh's Fear, Rancor, Dismay and Resolve. The Lost Ancestor's Songs of the Descent and Litanies of Battle, which are cast automatically.
- **Units, Heralds and upgrades (dw p.22–45).**
  - Awakened effects: Hold Warriors gain Impact (2), Initiates Support (+1), Flame Berserkers Lethal Demise (+2), Wardens Linebreaker, and an Awakened Lost gives Stride (+1 March).
  - Blades of the Ancestor, Venerable and Echoes of Dheureghodh. Life for Glory: never Broken, Awaken instead, always pass Morale, no Character.
  - Shieldwall (+2 Defense to the front), Battery, Unstable Alloys and Testaments to Honor.
  - Heralds: Fire re-rolls failed Hit Rolls of 6, Magma gives Linebreaker, Stone gives Untouchable, and the Mnemancer's Apprentice gives Unyielding. A Herald puts its Regiment in the Creed's sub-faction, and in a Tempered army it may spend 1 Marker to Awaken.
  - Relics and Masteries: Litanies of Victory, Runeforged Plate, The Crown of Ushkelodh, Tempered Goad, Invocation of the Shattering, Gifted in Fire, World Breakers, First in the Fray, Superiority, Bloody-Minded Focus, Relentless March, Thaumaturge and Ferric Throne. Profile changes (Champion's Horns, Draegbhrud) come from the export.
  - Also automated (v2.4.0): Ardent Command Stands Die Fighting! even after Activating; Slain Bigger (+3 Evasion to at most 3 and Fearless against Monster Characters and Riders); Chthonic Flame (successful Morale Tests re-rolled); the Forgemaster's Line of Sight from an Awakened [Forged] Command Stand; Bergont Raegh, Hellbringer Sorcerer and Ferric Throne as Riders (AMB-86). Pike Formation is the Initiates' Shieldwall; Flamer is not defined (AMB-87).
