import type { RuleRef } from '../../../import/types';
import { registerSpecialRule } from './registry';

/**
 * Special rules automated by the engine, with page references (core rulebook).
 * Everything else stays "manual": shown with its list text, flagged in the log.
 */
const IMPLEMENTED: [string, string][] = [
  ['Impact', 'core p.36, p.100'],
  ['Barrage', 'core p.38–40, p.97'],
  ['Armor Piercing', 'core p.97'],
  ['Deadly Shot', 'core p.97'],
  ['Cleave', 'core p.97'],
  ['Flurry', 'core p.98'],
  ['Shield', 'core p.100'],
  ['Leader', 'core p.69'],
  ['Standard Bearer', 'core p.69'],
  ['Unstoppable', 'core p.101'],
  ['Fearless', 'core p.98'],
  ['Fearsome', 'core p.98'],
  ['Terrifying', 'core p.101'],
  ['Fly', 'core p.98'],
  ['Brutal Impact', 'core p.97'],
  ['Linebreaker', 'core p.99'],
  ['Support', 'core p.100'],
  ['Aimed Shot', 'core p.97'],
  ['Inspired', 'core p.99'],
  ['Deadly Blades', 'core p.97'],
  ['Vanguard', 'core p.101'],
  ['Flank', 'core p.98'],
  ['Forward Force', 'core p.98'],
  ['Forlorn Drive', 'Spires Eccentricity (rule text from the list)'],
  // Core special rules (p.96–101)
  ['Acute Senses', 'core p.97'],
  ['Aura of Death', 'core p.97'],
  ['Blessed', 'core p.97'],
  ['Bodyguards', 'core p.97'],
  ['Bravery', 'core p.97'],
  ['Brittle', 'core p.97'],
  ['Counter-Attack', 'core p.97'],
  ['Dauntless', 'core p.97'],
  ['Deadshots', 'core p.97'],
  ['Decay', 'core p.97'],
  ['Dread', 'core p.98'],
  ['Fiend Hunter', 'core p.98'],
  ['Flawless Drill', 'core p.98'],
  ['Flawless Strikes', 'core p.98'],
  ['Fluid Formation', 'core p.98'],
  ['Fury', 'core p.98'],
  ['Glorious Charge', 'core p.99'],
  ['Hardened', 'core p.99'],
  ['Indomitable', 'core p.99'],
  ['Iron Discipline', 'core p.99'],
  ['Irregular', 'core p.99'],
  ['Juggernaut', 'core p.99'],
  ['Lethal Demise', 'core p.99'],
  ['Longshot', 'core p.99'],
  ['Loose Formation', 'core p.99'],
  ['Oblivious', 'core p.99'],
  ['Opportunists', 'core p.99'],
  ['Parry', 'core p.100'],
  ['Pathfinders', 'core p.100'],
  ['Phalanx', 'core p.100'],
  ['Precise Shot', 'core p.100'],
  ['Quicksilver Strike', 'core p.100'],
  ['Relentless Blows', 'core p.100'],
  ['Rapid Volley', 'core p.100'],
  ['Shock', 'core p.100'],
  ['Smite', 'core p.100'],
  ['Sureshot', 'core p.100'],
  ['Tenacious', 'core p.101'],
  ['Torrential Fire', 'core p.101'],
  ['Trample', 'core p.101'],
  ['Untouchable', 'core p.101'],
  ['Unyielding', 'core p.101'],
  ['Weapon Platform', 'core p.101'],
  ['Murderous Volley', 'core p.95'],
  // Spires faction document (sp = Spires army list, 2026 post-Adepticon)
  ['Disruptive', 'sp p.27'],
  ['Hypersynaptic Bonding', 'sp p.28'],
  ['Microbial Shroud', 'sp p.32'],
  ['Hypercatalytic Discharge', 'sp p.33'],
  ['Adrenal Hysteria', 'sp p.26'],
  ['Practitioner', 'sp p.5, p.15'],
  ['Epigenetic Trigger', 'sp p.9'],
  ['Pheromantic Drive', 'sp p.15'],
  ['Optimized Fodder', 'sp p.24'],
  ['Rider', 'core p.100'],
  // Spellcasting (core p.80–81, p.97)
  ['Priest', 'core p.80, p.100'],
  ['Wizard', 'core p.80, p.101'],
  ['Devout', 'core p.97'],
  // Old Dominion (od = Old Dominion army list, 2026 Tainted Earth update)
  ['Animate Vessel', 'od p.5'],
  ['Memories of Old', 'od p.5'],
  ['Acolytes', 'od p.22'],
  ['Divine Shard', 'od p.27'],
  ['Forced March', 'od p.24'],
  ['Unhallowed Ground', 'od p.15, p.30 (Size (4) is not used by the engine)'],
  ['Wedge!', 'od p.29'],
  ['Wedge', 'od p.29'],
  ['Sundering Charge', 'od p.28 (the same as Wedge!)'],
  ['Font of Dark Power', 'od p.7, p.13'],
  ['Dark Shepherd', 'od p.11'],
  ['Dark Awakening', 'od p.28'],
  ["Heaven's Descent", 'od p.28'],
  ['Exhortation of Eternal Faith', 'od p.30 (the Command Stand aura is manual)'],
  ['Exploitation of Divine Vanity', 'od p.16'],
  ['Unholy Sacrament', 'od p.19'],
  ['Blasphemous Mesa', 'od p.8'],
  ['Harvest of Vanity', 'od p.16'],
  // Spires rules (mechanics from the rule text in the imported list)
  ['Superior Creations', 'Spires'],
  ['Just Desserts', 'Spires'],
  ['Imposing Excellence', 'Spires'],
  ['Ceaseless Hunt', 'Spires'],
  ['Reprocessing Agents', 'Spires'],
  ['Visceral Bombardment', 'Spires'],
  ['Resounding Malevolence', 'Spires'],
  ['Designate Target', 'Spires'],
  ['Snapshot', 'Spires'],
  ['Mighty Swing', 'Spires'],
  ['Swift Retreat', 'Spires'],
  ['Avatar Projection', 'Spires'],
  ['Cultivated Muscle Memory', 'Spires'],
  ['Ferro-Ossified Carapace', 'Spires'],
  ['Suppress Higher Functions', 'Spires'],
  ['Remorseless Hunter', 'Spires'],
  ['Lobotomytic Override', 'Spires (The Directorate)'],
  ['Strain Expression', 'Spires (Strains entered on the review screen)'],
  // Sorcerer Kings (sk = Sorcerer Kings army list, 2026 Tainted Earth update)
  ['Fire Elemental', 'sk p.32–35'],
  ['Air Elemental', 'sk p.36–39'],
  ['Water Elemental', 'sk p.43–46'],
  ['Earth Elemental', 'sk p.40–42 (Earth terrain, AMB-67)'],
  ['Favored of Hormus', 'sk p.17'],
  // RULE-AMBIGUITY: AMB-87 — the Marid Lancers entry lists Tidal Wave, which the list does not define.
  ['Tidal Wave', 'sk p.43 (not defined in the 2026 list: no effect)'],
  // RULE-AMBIGUITY: AMB-74 — named by Elemental Dominion, not defined.
  ['Fan the Flames', 'sk p.6 (not defined in the 2026 list: no effect)'],
  ['Elemental Waters', 'sk p.43–46 (Water Elemental in Water: re-roll failed Hit Rolls of 6)'],
  ['Infernal Branding', 'sk p.32'],
  ['Gifted Mortals', 'sk p.27–28'],
  ['Eminence', 'sk p.27'],
  ['Last Word', 'sk p.34–35 (the engine picks the target, AMB-72)'],
  ['Arrogance', 'sk p.34'],
  ['Hubris', 'sk p.35'],
  ['Earthen Aegis', 'sk p.40–41 (Dangerous terrain is not in the 2026 set)'],
  ['Elemental Tether', 'sk p.38'],
  ['Aqueous Branding', 'sk p.44–45'],
  ['Homing Winds', 'sk p.20'],
  ['Elemental Conduit', 'sk p.5'],
  ['Elemental Prowess', 'sk p.28'],
  ['Elemental Assault', 'sk p.14'],
  ['Dancing Scimitar', 'sk p.16'],
  // Paragraph rules the Army Builder export lists by name (seen in a real export).
  ['Wavebreaker Form', 'sk p.43 (chosen when Activating)'],
  ['Waveborne Form', 'sk p.44 (chosen when Activating)'],
  ['Stormqueen Form', 'sk p.46 (chosen when Activating)'],
  ['Arcane Tide Form', 'sk p.45 (chosen when Activating)'],
  ['Tidecaller', 'sk p.45 (chosen when Activating)'],
  ['Dread Tide', 'sk p.46'],
  ['Denizens of the Upper Planes', 'sk p.31 (the Court comes from the list)'],
  ['Shattered Perfection', 'sk p.40'],
  ['Raging Elements', 'sk p.41'],
  ['Fury of the Tempest', 'sk p.38'],
  ['Eye of the Storm', 'sk p.39'],
  ['Gilded Statue', 'sk p.42'],
  ['Sorcerous Blessing', 'sk p.14'],
  ['Tidal Summons', 'sk p.45 (chosen on the Reinforcement screen)'],
  // Dweghom (dw = Dweghom army list, November 10th 2026)
  ['Forged By the Elements', 'dw p.4'],
  ['Herald of Fire', 'dw p.45'],
  ['Hone Blades', 'dw p.27'],
  ['Unstable Alloys', 'dw p.43'],
  ['Venerable', 'dw p.29'],
  ['Life for Glory', 'dw p.31'],
  ['Shieldwall', 'dw p.37'],
  ['Battery', 'dw p.40'],
  ['World Breakers', 'dw p.24'],
  ['Barrage Range', 'dw p.40'],
  ['Preternatural Focus', 'dw p.12'],
  ['Unassailable Authority', 'dw p.20'],
  ['Gifted in Fire', 'dw p.22'],
  ['Runeforged Plate', 'dw p.23'],
  ['Fires of the Descent', 'dw p.39'],
  ['To the End', 'dw p.10–14'],
  ['But First', 'dw p.10'],
  ['Hymns of War', 'dw p.11 (target picked by the engine, AMB-84)'],
  ['Igneolithic Mastery', 'dw p.18'],
  ['Refined Beyond Nature', 'dw p.18'],
  ['Not All who Wander are Lost', 'dw p.20'],
  ['Blades of the Ancestor', 'dw p.29'],
  ['Echoes of Dheureghodh', 'dw p.29'],
  ['Stride', 'dw p.39'],
  ['Testaments to Honor', 'dw p.38'],
  ['Empowerment', 'dw p.30–43'],
  ['Slain Bigger', 'dw p.11'],
  ['Chthonic Flame', 'dw p.22'],
  ['Bergont Raegh', 'dw p.24'],
  ['Hellbringer Sorcerer', 'dw p.24'],
  ['Ferric Throne', 'dw p.25'],
  // RULE-AMBIGUITY: AMB-87 — the Initiates entry lists Pike Formation and describes Shieldwall.
  ['Pike Formation', 'dw p.37 (the entry describes it as Shieldwall)'],
  // RULE-AMBIGUITY: AMB-87 — Flamecaster gives Flamer, which no 2026 document defines.
  ['Flamer', 'dw p.45 (not defined in the 2026 documents: no effect)'],
  ['On Soaring Winds', 'sk p.36'],
  // Core Draw Events (p.94–95)
  ['Bastion', 'core p.94'],
  ['Biotic Renewal', 'core p.94'],
  ['Double Time', 'core p.94'],
  ['Fire and Advance', 'core p.94'],
  ['Flux-Powered', 'core p.94'],
  ['Regeneration', 'core p.95'],
];
for (const [name, ref] of IMPLEMENTED) registerSpecialRule({ name, ref });

export const IMPLEMENTED_RULES = IMPLEMENTED.map(([n]) => n);

/** All rule references, flattening nested ones (e.g. Armor Piercing inside a Barrage bracket). */
export function flatRules(rules: readonly RuleRef[]): RuleRef[] {
  return rules.flatMap((r) => [r, ...(r.sub ? flatRules(r.sub) : [])]);
}

/**
 * Rule names compare without case, hyphens or a plural "s": lists print "Counter Attack" and
 * "Quicksilver Strikes" for the core's "Counter-Attack" and "Quicksilver Strike".
 */
export function ruleKey(name: string): string {
  return name.toLowerCase().replace(/[-‐–]/g, ' ').replace(/\s+/g, ' ').trim().replace(/s$/, '');
}

export function hasRule(rules: readonly RuleRef[], name: string): boolean {
  const n = ruleKey(name);
  return rules.some((r) => ruleKey(r.name) === n);
}

/**
 * The (X) value of a rule: several (X) instances do not stack (the highest applies); (+X)
 * instances add to it (core p.96). Returns 0 if absent.
 */
export function ruleX(rules: readonly RuleRef[], name: string): number {
  const n = ruleKey(name);
  let base = 0;
  let plus = 0;
  for (const r of rules) {
    if (ruleKey(r.name) !== n) continue;
    if (r.plus) plus += r.x ?? 0;
    else base = Math.max(base, r.x ?? 0);
  }
  return base + plus;
}

/** Barrage profile of a Stand: shots, range and the rules inside its bracket (core p.97). */
export function barrageOf(rules: readonly RuleRef[]): { shots: number; range: number; sub: RuleRef[] } | null {
  const b = rules.filter((r) => r.name.toLowerCase() === 'barrage' && (r.x ?? 0) > 0);
  if (!b.length) return null;
  // "If a Stand has multiple Barrage (X) profiles, you must choose one": the engine uses the first (manual to change).
  const r = b.find((x) => !x.plus) ?? b[0]!;
  // Barrage (+X) adds shots to the profile (e.g. from Memories of Old, od p.27).
  const plus = b.filter((x) => x !== r && x.plus).reduce((a, x) => a + (x.x ?? 0), 0);
  // Barrage range bonuses (Found Empowerment, dw p.40).
  const longer = ruleX(rules, 'Barrage Range');
  return { shots: (r.x ?? 0) + plus, range: (r.range ?? 0) + longer, sub: r.sub ?? [] };
}

/** Rules not automated by the engine. */
export function manualRules(rules: readonly RuleRef[]): RuleRef[] {
  return rules.filter((r) => !IMPLEMENTED.some(([n]) => ruleKey(n) === ruleKey(r.name)));
}
