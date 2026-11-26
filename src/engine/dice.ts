import type { DiceRecord, GameEvent } from './model/events';
import type { GameState } from './model/types';
import type { PendingPower } from './factions/oldDominion';
import { rollD6, type RngState } from './rng';

/** Mutable context while applying one Action to a cloned state. */
export interface Ctx {
  s: GameState;
  rng: RngState;
  events: GameEvent[];
  /** Hits triggered during an attack and resolved after it (Lethal Demise, Counter-Attack). */
  pending?: { kind: 'Lethal Demise' | 'Counter-Attack'; fromId: string; toId: string; hits: number }[];
  /** Old Dominion Power Tokens earned during this Action, added at its end (od p.6). */
  power?: PendingPower[];
  /** Hierodeacon's Dark Shepherd: Stands destroyed generate double the Power Tokens (od p.9). */
  doublePower?: boolean;
  /** The Regiment making the attack being resolved (for Chosen Regiments, ns p.2). */
  attackerId?: string;
}

export function ev(ctx: Ctx, e: Omit<GameEvent, 'round'>): void {
  ctx.events.push({ round: ctx.s.round, ...e });
}

/** One D6: forced dice (manual "set next dice" tool) are used first, then the seeded RNG. */
export function d6(ctx: Ctx): number {
  const forced = ctx.s.forcedDice.shift();
  if (forced !== undefined) return forced;
  const [v, next] = rollD6(ctx.rng);
  ctx.rng = next;
  return v;
}

export function rollN(ctx: Ctx, n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, () => d6(ctx));
}

export interface TestOptions {
  /** Target characteristic (pass on a roll ≤ target). */
  target: number;
  /** Defense Rolls: a natural 1 is not an automatic pass (core p.10, p.40). */
  defense?: boolean;
  /** Re-roll failed dice once (e.g. Flurry, core p.98). */
  rerollFailed?: boolean;
  /** Re-roll natural 6s once (Inspired / Aimed Shot at 5+, core p.97, p.99). */
  rerollSixes?: boolean;
  /** Re-roll successes once (Flank or Rear attacks on Morale, core p.46). */
  rerollSuccesses?: boolean;
  /** Every die fails without rolling (Rear attacks on Morale, core p.46). */
  autoFail?: boolean;
}

export interface TestResult {
  /** Final values after any re-roll. */
  values: number[];
  passed: boolean[];
  passes: number;
  record: DiceRecord;
}

/**
 * Characteristic Test pool (core p.10): pass on a roll ≤ target. A natural 6 always fails;
 * a natural 1 always passes except on Defense Rolls. RULE-AMBIGUITY: AMB-01.
 * A die is re-rolled at most once.
 */
export function rollTest(ctx: Ctx, n: number, o: TestOptions, purpose: string): TestResult {
  const seed = ctx.rng.seed;
  const index = ctx.rng.index;
  const pass = (d: number) => (o.defense ? d !== 6 && o.target > 0 && d <= o.target : d === 1 || (d !== 6 && d <= o.target));
  const notes: string[] = [`target ${o.target}${o.defense ? ' (Defense: 1 is not automatic)' : ''}`];
  if (o.autoFail) {
    notes.push('automatic fail, no dice rolled');
    const record = { purpose, seed, index, values: [], notes };
    return { values: [], passed: Array<boolean>(n).fill(false), passes: 0, record };
  }
  const first = rollN(ctx, n);
  const values = [...first];
  const rerolled: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const p = pass(v);
    if ((o.rerollFailed && !p) || (o.rerollSixes && v === 6 && !p) || (o.rerollSuccesses && p)) {
      values[i] = d6(ctx);
      rerolled.push(i);
    }
  }
  if (rerolled.length) notes.push(`re-rolled ${rerolled.length}: ${rerolled.map((i) => `${first[i]}→${values[i]}`).join(', ')}`);
  const passed = values.map(pass);
  const passes = passed.filter(Boolean).length;
  notes.push(`${passes} pass${passes === 1 ? '' : 'es'}`);
  return { values, passed, passes, record: { purpose, seed, index, values: first, notes } };
}
