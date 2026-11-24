import type { ScenarioDef } from './types';

const modules = import.meta.glob<ScenarioDef>('./*.json', { eager: true, import: 'default' });

/** All tournament scenarios, in pack order. */
export const SCENARIOS: readonly ScenarioDef[] = Object.keys(modules)
  .sort()
  .map((k) => modules[k]!);

export function getScenario(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
