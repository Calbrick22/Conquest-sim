import type { GameState } from '../engine/model/types';

/**
 * Computer opponent difficulty levels. They change only how the computer chooses among legal
 * Actions; the rules are the same for every level. See docs/ai-difficulty.md.
 */
export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert';

export const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: 'beginner', label: 'Beginner', blurb: 'Plays aggressively: marches and charges straight in, picks targets without weighing them, keeps its Command Stack in list order.' },
  { id: 'intermediate', label: 'Intermediate', blurb: 'Starts to weigh targets, counters and threats, and orders its Command Stack sensibly, but not consistently.' },
  { id: 'advanced', label: 'Advanced', blurb: 'Orders its Command Stack around threats and opportunities, positions for its next Charge or Volley, and avoids losing fights.' },
  { id: 'expert', label: 'Expert', blurb: 'Plans for points every time: tests its moves against the objectives, punishes exposed flanks and Broken Regiments, and never has an off turn.' },
];

export interface Profile {
  id: Difficulty;
  /** Share of decisions made with the informed layer (the rest fall back to Beginner play). */
  consistency: number;
  /** Size of the random wobble in move and target scores. */
  noise: number;
  /** How much a position's danger (enemy Charges that would beat it) counts against moving there. */
  danger: number;
  /** Weight of informed target value (expected Wounds, target worth, counters). */
  targeting: number;
  /** Bonus for exposed flanks and rears, Broken and wounded enemies. */
  opportunism: number;
  /** Lowest Charge success chance it will try. */
  minCharge: number;
  /** Positions that set up its own next Charge or Volley. */
  setup: number;
  /** Weight of scenario scoring when choosing objectives. */
  scenario: number;
  /** Command Stack policy. */
  stack: 'list' | 'simple' | 'threats';
}

export const PROFILES: Record<Difficulty, Profile> = {
  beginner: { id: 'beginner', consistency: 0, noise: 1.2, danger: 0, targeting: 0, opportunism: 0, minCharge: 0.3, setup: 0, scenario: 0, stack: 'list' },
  intermediate: { id: 'intermediate', consistency: 0.6, noise: 0.7, danger: 0.5, targeting: 0.7, opportunism: 0.5, minCharge: 0.4, setup: 0.3, scenario: 0.4, stack: 'simple' },
  advanced: { id: 'advanced', consistency: 0.85, noise: 0.35, danger: 1, targeting: 1, opportunism: 1, minCharge: 0.45, setup: 0.8, scenario: 0.8, stack: 'threats' },
  expert: { id: 'expert', consistency: 1, noise: 0.08, danger: 0.6, targeting: 1, opportunism: 2, minCharge: 0.4, setup: 1, scenario: 1.2, stack: 'threats' },
};

export const BEGINNER = PROFILES.beginner;

/** Deterministic 0–1 value from the game state and a salt (same state → same choice, replayable). */
export function hash01(s: GameState, salt: number): number {
  const acted = Object.values(s.regiments).filter((r) => r.activatedThisRound).length;
  let h = (s.seed ^ (s.round * 7919) ^ (acted * 6007) ^ ((s.activation?.actions.length ?? 0) * 31) ^ (salt * 104729)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/**
 * The profile used for one decision: an Intermediate or Advanced opponent sometimes plays a
 * decision like a Beginner ("inconsistent"); an Expert never does.
 */
export function profileFor(s: GameState, d: Difficulty, salt: number): Profile {
  const p = PROFILES[d];
  if (p.consistency >= 1 || p.consistency <= 0) return p;
  if (hash01(s, salt) < p.consistency) return p;
  // An off decision: it weighs targets and threats less well, as a less experienced player would.
  return { ...p, targeting: p.targeting * 0.4, danger: p.danger * 0.3, opportunism: 0, setup: 0, noise: p.noise * 1.6 };
}
