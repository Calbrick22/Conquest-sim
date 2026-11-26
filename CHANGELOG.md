# Changelog

## [2.4.0] - 2026-11-26 (no more special rules done by hand)

Every special rule, upgrade and Supremacy Ability of the four implemented factions (Old Dominion, Spires, Sorcerer Kings, Dweghom) is now resolved by the engine. Ten complete computer-vs-computer games with your real lists (every pairing, five scenarios) logged no manual rules and no overrides. Choices the documents leave open are recorded as AMB-86 to AMB-91.

### Added
- **Core:**
  - **Rider** (core p.100): the Character shares its Monster's Stand.
  - **Arcing Fire** (core p.97): a Volley option.
  - **Sureshot** ignores Cover.
  - **Die Fighting!** for Command Stands that "Die Fighting as Characters", and for upgrades that always Die Fighting.
  - **Duels:** Duels with the Fallen Divinity, and Relentless Blows in Duels.
- **Scenarios:** Seek and Destroy's Chosen Regiments and Break the Line's Linebreakers are designated at the start (changeable in Round 1) and scored automatically. Linebreakers lose Fly.
- **Dweghom:**
  - Ardent Command Stands Die Fighting!
  - Slain Bigger and Chthonic Flame.
  - The Forgemaster's Line of Sight from an Awakened [Forged] Command Stand.
  - Bergont Raegh, Hellbringer Sorcerer and Ferric Throne as Riders.
  - Pike Formation is the Initiates' Shieldwall.
- **Sorcerer Kings:**
  - Arrogance's free Duel; a refused Duel gives the Rakshasa Flurry.
  - Favored of Hormus: the Character rides a Mahut, which loses Barrage and gains Terrifying (1), and makes friends nearby count as near Earth.
  - Fan the Flames and Tidal Wave, which the list names but never defines, are shown as having no effect.
- **Old Dominion:**
  - Exhortation's Command Stand aura and Trial of Will.
  - Soul Reaper and Obdurate's Attacks option, chosen before a Clash.
  - Implacable's Break Their Lines and Hierotekton.
  - Cuirass of Hazlia's Shadow, Anastegma, Eleutherea and What We Did in Life.
  - Strength and Honor; Unhallowed Ground's Size (4).
- **Spires:**
  - Supremacy Abilities: Field Studies (Observation Tokens), Ruthless Competence, Lambs to the Slaughter and Tricks of the Trade (Influence Pool).
  - The Merchant Prince's Offer (Master Manipulator) and the Mimetic Assassin.
  - Character upgrades: Master of Flesh, Grotesque Elixir, Preservation Protocols, No Matter the Price, Induced Fawn Response, Lineage Commander, Convulsive Doom, the Optimization Strains and Chain Reaction.
  - Officers: Catabolic Node, Ward Preceptor and Assault Preceptor.
  - Unit rules: Lineage Guard, Inherited Excellence, Spined Descent and Privileged Observer.
  - Consumption Beast: Indiscriminate Omnivore, Gorged and Endless Hunger.
- **Controls:**
  - "With the next Clash or Volley" toggles.
  - A Spires bar for the pools and plans.
  - Offer buttons on the Reinforcements screen.
  - "Before the Clash" Old Dominion spends.
  - Duel buttons for the Fallen Divinity and the Rakshasa.
- **Computer:**
  - Uses [Activated] Supremacy Abilities that need no target, from Round 3.
  - Uses the Old Dominion Clash spends.
  - Declines Offers.

### Fixed
- A Regiment destroyed by Aura of Death as it Activates no longer leaves its player trying to draw from an empty Command Stack.
- Supremacy Abilities with no [Activated] part can no longer be "used" (for the four implemented factions).

## [2.3.1] - 2026-11-25 (Dweghom: tested with a real list)

### Fixed
- **List import (Dweghom export):**
  - The "Spells: Fire School" option is read as the School choice, not as more Spells; before, the Mastery that followed was swallowed too.
  - A named rule paragraph such as "Empowerment: …" no longer leaks into the Battlefield Role. That had broken the Found's [Forged] role.
- **The Lost Ancestor** knows its own Spells plus its School's Spells. Before, the School's were missing when the export listed Spells.
- **Characters are no longer attached to Flame Berserkers** at setup (Life for Glory, dw p.31).
- **Charges where the target pivots to meet the charger** (core p.32) now check that the charger's own end position is legal. A charger could be left overlapping a friend, a Marker or Impassable terrain.

## [2.3.0] - 2026-11-25 (computer difficulty)

### Added
- **Computer difficulty levels**, chosen on the New Game screen: Beginner, Intermediate, Advanced and Expert. The choice is remembered on the device, saved with the game, and shown in the HUD. Games saved earlier play as Beginner. See docs/ai-difficulty.md.
  - **Beginner** plays aggressively. It goes straight for objectives and enemies, charges and shoots whatever is nearest, never withdraws, always takes the first turn, and keeps its Command Stack in army-list order.
  - **Intermediate** weighs targets, counters and threats, and orders its Command Stack sensibly. It does this on about 60% of its decisions and slips on the rest.
  - **Advanced** orders its Command Stack by threats and opportunities. It avoids fights it would lose, holds its objectives, and positions for its next Charge or Volley. It tests its moves against the real zone-seizing rules and punishes exposed flanks and Broken units. About 85% of its decisions are informed.
  - **Expert** does all of that on every decision, and leans harder into opportunities.
  - **Measured strength:** 60 computer-vs-computer games per pairing, with each level playing both synthetic armies from both sides on five scenarios.

    | Pairing | Wins | VP |
    |---|---|---|
    | Beginner v Intermediate | 26–28 | 878–937 |
    | Intermediate v Advanced | 28–28 | 921–1062 |
    | Advanced v Expert | 25–27 | 999–1046 |
    | Beginner v Expert | 23–34 | 740–1093 |

### Fixed
- **A Charge can no longer turn its target onto an Objective Marker or Impassable terrain.** Before, this left the target in an illegal position.
- **The computer no longer gets stuck** ending a Character's Activation when its Regiment is in an illegal position.
- **Beginner archers** shoot when a target is in range, instead of marching.

## [2.2.1] - 2026-11-25 (play feedback)

### Added
- **Resizable side panels on desktop:** drag the edge of the right-hand panel, or of the left-hand Regiment panel. Arrow keys also work, and a double-click resets the width. Each panel's width is remembered on this device. The default side panel is wider (440px, previously at most 380px).
- **Threats cycle** Charge reach → Volley range → off. Volley shows each enemy's front arc out to its Barrage range, for enemies that have a Barrage.
- **Activate button highlight:** hovering or focusing an Activate button outlines that Regiment on the table.

### Fixed
- **Unstoppable re-rolls are shown in full:** the Charge log now shows the first roll and the re-roll, and the dice tray shows both dice. The engine already re-rolled; only the second die was visible.
- **Swift Retreat:** no Resolve roll is made any more, and the log says it is a Clean Withdrawal. A Clean Withdrawal still suffers D6 Wounds (core p.51).

## [2.2.0] - 2026-11-25 (Dweghom; Sorcerer Kings manual rules automated)

### Added
- **Dweghom** (November 10th 2026 list; rules digest §25):
  - **Core rules:**
    - The Gift, with Awakened shown as ✦ on the table.
    - The Elemental Power pool, shown in a new panel.
    - Forged By the Elements, with every Empowerment.
    - The Unbound: Dweghom Regiments are never Shattered.
  - **Creeds:** Ardent, Tempered and Clan. The Creed comes from the list, else from the Warlord.
  - **Supremacy Abilities:** all six, including choosing the Hold Raegh's two Regiments in the Supremacy Phase.
  - **Character rules:**
    - To the End: Duels continue until one Character falls.
    - But First, and Hymns of War.
    - Igneolithic Mastery and Refined Beyond Nature.
    - The Lost Ancestor's rules.
  - **All 20 Spells:** Fire, Magma, Earth and Steel Schools, Kerawegh, Lost Ancestor. Terrain can be targeted and becomes Erupting. A [Tempered] Character can spend Elemental Power to boost Wizard.
  - **Units and Heralds:** the units' Awakened effects, and the Heralds.
  - **Upgrades:** most Relics and Masteries.
  - **The computer plays Dweghom:** it chooses Empowerments, Draw Events and Spell boosts, and spends Markers to Awaken.
- **Sorcerer Kings, formerly manual:**
  - Tidal Summons: chosen on the Reinforcement screen, and the computer uses it.
  - Air Step, Translocation (Old Dominion) and On Soaring Winds: a move panel opens with the right limits.
  - Sunder (the Land): targets an Objective Zone, which counts as Hindering for Charges.
  - Niyantran, Bound to the Elements (it changes the Character's Type), the Initiates' cover near Water, and the Air Elemental's Reinforcement Line.
- **Spells can target an Objective Zone or a piece of terrain.**

### Fixed
- **March modifiers now apply:** Round and granted changes to March, for example Induced Aggression (Spires) and Kiss of the Earth.
- **Rule names match regardless of hyphens and plurals:**
  - "Counter Attack" now works as Counter-Attack;
  - "Quicksilver Strikes" now works as Quicksilver Strike.

## [2.1.1] - 2026-11-25 (Sorcerer Kings: tested with a real list)

### Fixed
- **List import:**
  - "Patron's Gifts" is read as one option group, so Shu'laat and Prijm Khanjar now apply;
  - a rule sentence that starts with the unit's name (the Marid Apsara's) no longer leaks into its Battlefield Role;
  - Ghols take their Court from the list's "Courts" option.
- **Prijm Khanjar and Bound to the Elements** are no longer added twice: the export already shows the changed Attacks and Wounds (AMB-76).
- **Marid Sahar** with 4 or fewer Stands Volleys with every Stand, whatever its rank (sk p.44).
- **No longer flagged as manual**, since the engine handles them: the Forms, Tidecaller, Dread Tide and Denizens of the Upper Planes, which the export lists by name. Tidal Summons is still manual.
- **Command Stack:** the default order and the computer place each Ritual card just before a Regiment of its Court, so that Regiment can Activate straight after it.
- **Computer Ritual targets:** it no longer casts Call forth the Deep on terrain that is already Water or is Impassable.

## [2.1.0] - 2026-11-25 (Sorcerer Kings)

### Added
- **Sorcerer Kings** (2026 Tainted Earth update; rules digest §24):
  - **Courts:** Characters know every Spell and Ritual of their Court. [Mortals] take their Warband's Court, Gifted Mortals and Ghols take the Warlord's, and Elementals keep their own. The list review screen has a Court picker for each Character.
  - **All 24 Court Spells** are automated, with the "Inflamed" status (🔥 on the table). Air Step's move and Sunder's zone are manual.
  - **Rituals:**
    - choose one to Prepare at the end of the Supremacy Phase, in the new Rituals panel, which shows its Markers;
    - Ritual Markers come from Spells, Elemental Conduit and Elemental Discharge;
    - a completed Ritual's Command Card joins the next Command Stack, and drawing it resolves the effect;
    - a card of the same Court can then Activate at once;
    - Water Rituals and Elemental Confluence chain into a new Ritual.

    All 12 Ritual effects are automated, including Far Sight's re-ordering of the Command Stack.
  - **Supremacy Abilities:** Elemental Confluence, Omnipotence (free Spell on 4+ successes; Spell limits each Round) and Elemental Dominion.
  - **Unit rules:**
    - Fire, Air, Water and Earth Elemental; Infernal Branding; Gifted Mortals and Eminence;
    - Earthen Aegis, Shattered Perfection and Raging Elements; Arrogance and Hubris; Last Word;
    - Trinavarta Tenacious, Elemental Tether, Fury of the Tempest and Eye of the Storm;
    - the Mahut's free Volley, Volleys in contact and Gilded Statue;
    - the Marid Forms, Dread Tide, Tidecaller and Aqueous Branding;
    - Elemental Prowess and Elemental Assault with Sorcerous Blessing.
  - **Character upgrades:** most Patron's Gifts and Masteries are automated. Niyantran and Favored of Hormus are manual.
  - **The computer plays Sorcerer Kings:** it resolves Rituals with sensible targets, chooses Forms, feeds Elemental Conduit only into a Ritual of the same Court, and values the new Spells.

### Fixed
- **The black bar on the battlefield after an Activation** (phones and narrow windows): the floating Regiment card collapsed into an empty bar, because it was styled twice. It now opens at full size.
- **Relentless Blows and Rapid Volley on a profile** now add a Hit for each natural 1 in a Clash or Volley (core p.100). Before, only the Clash or Volley 6+ case worked.

## [2.0.0] - 2026-11-24 (interface overhaul)

The interface was redesigned to look and work like a strategy game. The rules engine is unchanged, and the interface only displays the game state. The plan is in `docs/ui-design.md`.

### Added
- **Screen flow:** a title screen (Continue, New battle, Army lists, Scenarios, Settings), then New Game, the battle, a pause menu, and a Victory, Defeat or Draw summary.
- **Battle HUD:** a Round counter, a phase track, each army with its cards left and the First Player crown, the score, the activating Regiment with its Actions used, and tool buttons (Ruler, Reach, Threats, Undo, Menu).
- **Notifications:** short messages for scoring, Regiments destroyed, Broken or Shattered, Power Tokens and Supremacy.
- **Selection panel:** on wide screens, the selected Regiment's stats and rules sit in a panel left of the table. Stats and rules have tooltips, and each rule shows whether it is automated or manual.
- **Pause menu** (Esc or ☰): Resume, Settings, export the report, save the game file, or save and quit. The computer waits while the menu is open.
- **Settings:** text size, reduced motion, outcome previews, role icons, a portrait table, and a confirmation before ending an activation early. Settings are saved on this device.
- **Confirmation dialogs**, shown in the game's style, before ending an activation early, burning a zone, quitting, or deleting a list or a saved battle.
- **Keyboard:** Esc opens the menu or cancels, Ctrl+Z undoes, Enter advances the computer, and R, G, T, D and E work as shortcuts. Dialogs keep keyboard focus inside them and return it when they close.

### Changed
- A dark theme with gold accents, serif headings and red and blue player colours. Text scales with the screen and with the text size setting. On phones the HUD is compact and shows only the current phase.

## [1.9.0] - 2026-11-24 (terrain and the 2026 scenarios)

### Added
- **Terrain** (core p.84–90; pack p.3–4), using the 2026 set: Hill, Structure, Forest, Pond, Field and Boulder.
  - **Line of Sight:** Obstructing terrain blocks it by Size, and Elevated adds the piece's Size to Stands on it.
  - **Volleys:** Cover halves Barrage.
  - **Charges:** Hindering removes Impact Attacks, and Medium and Heavy Regiments lose Inspired for the Round.
  - **Clash:** Water gives −1 Clash.
  - **Movement:** Impassable blocks it, and Fly passes over.
  - Terrain is drawn on the table with its keywords and Size, and the computer opponent plays legally around it.
- **Terrain layouts:** each 2026 scenario's own layout, any of the five layouts on any scenario (moved the least distance needed to clear objectives), a **random** layout (mirrored, 9″ apart, Impassable off objectives, "Randomise again"), or no terrain. You choose on the New Game screen, with a live preview.
- **Five new scenarios (2026):** Seek and Destroy, Wheel of War (Priority Zone), Cursed Sanctuaries (Victory Phase Hits), Flames of Conquest (Burn a zone for 4 VP) and Break the Line. Chosen Regiments and Linebreakers are listed as manual.

### Changed
- **Faster geometry:** distance and overlap checks now skip far-apart pairs using bounding boxes. With the same results, a computer-vs-computer game runs about 3 times faster, which matters most on phones.

## [1.8.0] - 2026-11-24 (rule fixes; end of battle)

### Fixed
- **An attached Character shares its Regiment's Strain, Draw Events and Spells this Round** (core p.72; AMB-59). For example, a Pheromancer attached to Brute Drones now gets their Cleave (+1).
- **Lethal Demise** only answers a Stand destroyed by the enemy in contact during a Clash. Volleys, Impact Attacks and Spells no longer trigger it (owner's ruling; AMB-60).

### Added
- **Simulate the remaining Rounds:** when one side has no Regiments left, a button plays the rest of the battle automatically. The surviving army keeps moving to Seize objectives and score.
- **End-of-battle summary:** a Victory, Defeat or Draw screen with the final score and a Round-by-Round breakdown (VP, zones seized, running total). It has "Save and return home", "Export battle report" and "View the battlefield"; it can be reopened afterwards.

## [1.7.0] - 2026-11-24 (roadmap 2.1 and 2.2: odds and reach)

### Added
- **Odds before you roll** (2.1): choosing a Charge, Volley or Clash target shows, for every legal target, a badge on the table and a list. The list shows:
  - the Charge success chance;
  - the expected Wounds and Stands (Morale included);
  - the chance to Break or destroy the target;
  - the Wounds you would take back.

  The odds come from replaying the Action a few hundred times through the real engine, so every special rule counts. It runs in a background worker, and nothing is rolled until you choose. The Charge chance is worked out exactly (die or best of 2D6, Unstoppable or Standard Bearer re-roll, Marked, Juggernaut, Phalanx). Tap a row to make the Action.
- **Charge reach** (2.2): the Reach button (also on automatically while choosing a Charge target) shades the selected Regiment's front arc out to the distance it always reaches, the furthest it reaches at least half the time, and its maximum, each labelled with its chance (core p.13–14, p.31).
- **Threats** shades how far each enemy Regiment could Charge; those that have already Activated are drawn faintly.

### Changed
- The table's buttons (panels, icons, turn, zoom) now sit in a strip below the table instead of over its bottom corner, so they never cover a Regiment.
- A unit's info card keeps clear of the whole unit, not just its centre.

## [1.6.0] - 2026-11-24 (Stand icons)

### Added
- **Role icons on every Stand:** a bow for ranged (Barrage), crossed swords for melee, and a star for a spellcaster or Practitioner (Wizard, Priest, Practitioner, or known Spells). A Character Stand shows its own role. The ⚔ button by the zoom controls turns them off, and the choice is remembered on the device.
- Regiment names now sit along the front edge, so the icons stay visible.

## [1.5.0] - 2026-11-24 (Spires faction rules)

### Added
- **Every Spires Strain is built in** (from the Spires faction document). Strain Expression works with nothing typed, for example Centaur Avatara gain Shock and Stryx gain Disruptive. A typed Strain still replaces it.
- **Strain-related rules:**
  - Disruptive (−1 Clash to enemies at its front);
  - Hypersynaptic Bonding;
  - Microbial Shroud (no Heal or Rally within 8″);
  - Hypercatalytic Discharge (no Evasion);
  - Adrenal Hysteria (+2″ Charge);
  - Optimized Fodder;
  - Induced Aggression (swap the Strain for +1 Clash and +1 March; no Decay for the Pheromancer Warlord's Regiment).
- **Practitioner Actions:** all four Biomancies and all four Pheromancies, with target choices on the table, the one-per-Round limit, the Warlord's free extra Action, and computer-opponent use.
- **Epigenetic Trigger**, character upgrades (Hyperadrenal Stimulation, Linked Neuroreceptors, Degenerative Aura, Induce Lethargy, Endocrine Overstimulation, Grafted), and starting Wounds for entries that say so (Consumption Beast).
- Spells halve their Hits against Loose Formation (core p.99).

### Fixed
- **The Inspired Special Rule was never applied in a Clash** (only the Inspire Action was). This affected Old Dominion Tier III, the Caelestine Banner, Kentarch and similar.

## [1.4.0] - 2026-11-24 (rule details and quality of life)

### Fixed
- **Flank timing:** a Flank Regiment arrives only from the Round its own Class could (AMB-53). The Fallen Divinity's "Light for its Reinforcement Roll" no longer lets it arrive in Round 1.
- **The Directorate's +2 March was added twice:** the export already includes it (AMB-55). The Abomination is back to M10.
- **Aimed Shot as a listed rule** (Vanguard Clone Infiltrators): the first Volley each Activation is Aimed, +1 Volley (AMB-54).
- **Sideways and backward Marches:** up to half the March, in ½″ steps, with a "max" button, or by dragging (core p.28). Before, the buttons were stuck at 1″.

### Added
- **Effects you can see:** callouts now cover Draw Events (Strain Expression and others), the end of an Activation (Decay, Trample), the start of one (Aura of Death), Spells, Memories of Old and Supremacy. Re-rolls and conversions are shown with the dice (Designate Target, Flurry, Blessed, Devout…).
- **Status markers:** Marked Regiments say so in the log, on the table (◎) and on the unit card. A Strain in effect shows ☣. The unit card lists every modifier with its source.
- **Strains that affect enemies:** type "enemy -1 Clash" on the list review screen, and enemies in contact are affected while the Strain is active. The review screen flags Strains not entered yet, and starting a game warns about them.
- **See the battlefield while deciding:**
  - the Command Stack is built below the table instead of over it, and tapping a card highlights its Regiment;
  - 👁 hides all panels over the table;
  - ⟳ turns the table to portrait on phones (remembered on the device);
  - on wide screens the table stays on the left with the controls on the right.

## [1.3.1] - 2026-11-24 (Old Dominion list import)

### Fixed
- **Fallen Divinity profiles by Tier:** the export prints "<Name> (Tier I)", "(Tier II)" and "(Tier III)" blocks, which stopped the entry being read. Tier I is now the main profile; Tiers II and III fill the Tier profiles automatically (still editable on the list review screen).
- **"Memories of Old" on its own line** with the sentence below it (Legionnaires) was read as a note.
- **Two-word option groups** such as "Dark Blessings" were split wrongly, so Eternal Discipline, Devoted to Hazlia, Schemophore and similar options had no effect.
- **Restriction notes** starting "A …" were read as options.
- After the Fallen Divinity is destroyed, new Power Tokens go to the Dark Power Pool.

## [1.3.0] - 2026-11-24 (Old Dominion, 2026 Tainted Earth update)

### Added
- **Spellcasting** (core p.80–81): Priest/Wizard dice, Attunement, Scaling, enemy interference, Devout, Line of Sight and the once-per-Round rules.
  - Old Dominion Spells are automated.
  - Any other Spell can be cast by entering its Attunement; the effect is manual.
- **Old Dominion faction rules:**
  - Animate Vessel: no Resolve, Brittle, Terrifying, no Inspire.
  - Memories of Old, as an Action and as a Draw Event.
  - Power Tokens with the Dark Power and Fallen Pantheon Pools, Tiers I–IV scaled by points, and Blasphemous Soma.
  - Font of Dark Power, Divine Shard, Acolytes, Forced March, Unhallowed Ground, Wedge!/Sundering Charge, and the Officers.
- **Old Dominion Draw Events:** Dark Shepherd, Dark Awakening, Heaven's Descent, Exhortation of Eternal Faith, Exploitation of Divine Vanity, Unholy Sacrament and Blasphemous Mesa.
- **Old Dominion Supremacy Abilities:** all seven Warlords, including Master of the Legions every Supremacy Phase.
- **Treasures and Dark Blessings** that change rules or characteristics.
- **Fallen Divinity and Theokrator** are Monster Regiments by themselves. The Fallen Divinity's Tier II and III profiles are typed on the list review screen and applied automatically, with its Heals.
- **On the table:**
  - a Power bar showing each pool, its Tier and where new Tokens go;
  - Spell, Memories of Old and Draw Event buttons with their choices;
  - Supremacy choices for Old Dominion Warlords;
  - the unit card shows Memories of Old, Spells and the Dark Power Tier.
- **Computer opponent:** it casts Spells, uses Memories of Old and the Old Dominion Draw Events, spends Tokens, and feeds the Fallen Pantheon Pool while its Fallen Divinity climbs Tiers.
- **List import:** "Spells" and "Memories of Old" blocks, and rule values written without brackets (for example "Cleave +1").
- **Tests:** a synthetic Old Dominion-style fixture with an AI-vs-AI game, and 24 rule tests with page references.

### Still manual
- Duels involving the Fallen Divinity or Theokrator.
- Trial of Will, Translocation's move and the Exhortation Command Stand aura.
- Cuirass of Hazlia's Shadow, Hierotekton, Anastegma, Soul Reaper, Implacable and What We Did in Life.

## [1.2.0] - 2026-11-24 (roadmap 1.1–1.3)

### Added
- **Spires mechanics:**
  - Strain Expression, with Strains entered on the list review screen. Decay and Superior Creations.
  - Lobotomytic Override buttons on the drawn card.
  - Designate Target, Lethal Demise, Reprocessing, Biotic Renewal, Flux-Powered, Suppress Higher Functions and Ferro-Ossified Carapace.
  - Sect rules (Just Desserts), and Character options and grants (Avatar Projection, Imposing Excellence and others).
- **Core special rules:** every core rule on core p.96–101 is automated, except Sureshot, which needs terrain. Draw Events: Bastion, Double Time, Fire and Advance, Murderous Volley and Regeneration.
- **Core mechanics:**
  - Die Fighting!
  - Press the Attack.
  - A Clash split between every enemy in contact.
  - The Charge push and target pivot.
  - The Character Actions Snapshot and Mighty Swing.
  - The Swift Retreat facing choice.
- Rule tests, named with their page references.

### Fixed
- A Regiment in contact could not end its Activation ("within 1″ of enemy"). This also caused the computer's "nudge" overrides.
- The computer no longer declares Charges that can't be placed in contact.

### Still manual
- Seek New Escort (AMB-13), Pheromancy and Practitioner Actions, and other factions' rules until their PDFs are added.

## [1.1.0] - 2026-11-24 (feedback from the first games)

### Added
- **Vanguard (X)** (core p.101): +X″ on the first March when entering from Reinforcements.
- **Flank** (core p.98):
  - A Flank Regiment does not roll for Reinforcements; you declare whether it arrives or stays, within its Class's window.
  - Flank can come from the Regiment itself, from **Forward Force**, or from the Spires Eccentricity **Forlorn Drive** on a [Drone] or [Clone] Regiment.
  - Character options and Battlefield Roles are now carried into the game for this.
- **Unit callout:** tap a Regiment to see a stats card on the table (current values, the Character's profile, rules, Draw Events, status). Manual rules are underlined.
- **Action callouts on the table:** each Action shows what happened, with the dice (for example "Glass Pikes marches: forward 5″" or a Charge roll with its Impact dice).
- **Computer turns** appear in a callout and wait for **Next**.
- **Volley preview:** when choosing a Volley target, each front-rank Stand shows its range line from the centre of its front edge, a mark at Effective Range, and a line to each enemy in range. Lines are green when clear within Effective Range, amber when clear beyond it, and red when Obstructed.
- **Ruler modes:** point to point (the default), or Regiment to Regiment (closest edges).
- **Command Stack as cards on the table:** tap a card, then tap where it goes, then press Ready. During the Action Phase you draw from a deck on the table.

### Changed
- **Reinforcements:** each Regiment shows what it needs this Round. Tap one Regiment to bring it on automatically; the "stays" option is gone. Flank Regiments have an Arrive or Stay back toggle.
- **Entering the table:** the default formation is the narrowest one that comes fully on in a single March.

### Fixed
- **The computer left Regiments in Reinforcements.** A two-rank Regiment deeper than its March could never come fully on in one March, so it bounced back every Round. The AI now picks a formation that fits, or enters over two Marches. The AI-vs-AI test now checks that every Regiment reaches the table.

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
