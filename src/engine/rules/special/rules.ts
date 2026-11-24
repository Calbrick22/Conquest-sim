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
  ['Sureshot', 'core p.100 (no terrain in the MVP, so no effect yet)'],
  ['Tenacious', 'core p.101'],
  ['Torrential Fire', 'core p.101'],
  ['Trample', 'core p.101'],
  ['Untouchable', 'core p.101'],
  ['Unyielding', 'core p.101'],
  ['Weapon Platform', 'core p.101'],
  ['Murderous Volley', 'core p.95'],
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

export function hasRule(rules: readonly RuleRef[], name: string): boolean {
  const n = name.toLowerCase();
  return rules.some((r) => r.name.toLowerCase() === n);
}

/**
 * The (X) value of a rule: several (X) instances do not stack (the highest applies); (+X)
 * instances add to it (core p.96). Returns 0 if absent.
 */
export function ruleX(rules: readonly RuleRef[], name: string): number {
  const n = name.toLowerCase();
  let base = 0;
  let plus = 0;
  for (const r of rules) {
    if (r.name.toLowerCase() !== n) continue;
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
  return { shots: (r.x ?? 0) + plus, range: r.range ?? 0, sub: r.sub ?? [] };
}

/** Rules not automated by the engine. */
export function manualRules(rules: readonly RuleRef[]): RuleRef[] {
  return rules.filter((r) => !IMPLEMENTED.some(([n]) => n.toLowerCase() === r.name.toLowerCase()));
}
