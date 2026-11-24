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
  const r = b[0]!;
  return { shots: r.x ?? 0, range: r.range ?? 0, sub: r.sub ?? [] };
}

/** Rules not automated by the engine. */
export function manualRules(rules: readonly RuleRef[]): RuleRef[] {
  return rules.filter((r) => !IMPLEMENTED.some(([n]) => n.toLowerCase() === r.name.toLowerCase()));
}
