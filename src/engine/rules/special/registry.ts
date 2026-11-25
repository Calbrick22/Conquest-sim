/**
 * Special-rule registry (see PLAN.md §2). Each implemented rule is a module keyed by name that
 * hooks into defined points of the engine. Names not listed here are "manual": the UI shows the
 * rule text from the imported list and the log flags every time it may have applied.
 *
 * Modules are added in M4; until then every rule is manual.
 */
export interface SpecialRuleModule {
  name: string;
  /** Page reference for the mechanic. */
  ref: string;
}

const MODULES = new Map<string, SpecialRuleModule>();

/** Same normalisation as rules.ts ruleKey: case, hyphens and a plural "s" are ignored. */
const key = (name: string) => name.toLowerCase().replace(/[-‐–]/g, ' ').replace(/\s+/g, ' ').trim().replace(/s$/, '');

export function registerSpecialRule(m: SpecialRuleModule): void {
  MODULES.set(key(m.name), m);
}

export function isImplemented(name: string): boolean {
  return MODULES.has(key(name));
}

export function getSpecialRule(name: string): SpecialRuleModule | undefined {
  return MODULES.get(key(name));
}
