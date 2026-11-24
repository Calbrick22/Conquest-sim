import type { PlayerId } from '../../scenarios/types';

/**
 * Stand weights for Seizing (core p.106; pack p.8):
 * Light 0, Medium and Heavy 1, Monster 3. Light Stands still count toward the total.
 */
export type StandClass = 'Light' | 'Medium' | 'Heavy';

export interface StandInRange {
  owner: PlayerId;
  cls: StandClass;
  isMonster: boolean;
  /** False for Broken Regiments, Regiments whose Character declined a Duel, etc. (core p.60, p.76). */
  canSeize: boolean;
  /** Extra Stands counted for Seizing from special rules (e.g. a Light Stand counting as X). */
  bonus?: number;
  /** "Always Seizes" effects (core p.106). */
  alwaysSeizes?: boolean;
  /** Counts as this many Stands toward the total in range (Unhallowed Ground: 6, od p.15). */
  totalCount?: number;
  /** The Stand itself counts 0 for Seizing; only bonuses count (Unhallowed Ground, od p.15). */
  noBaseSeize?: boolean;
}

export function seizingWeight(s: StandInRange): number {
  if (!s.canSeize) return 0;
  const base = s.noBaseSeize ? 0 : s.isMonster ? 3 : s.cls === 'Light' ? 0 : 1;
  return base + (s.bonus ?? 0);
}

/** Total Stand count toward the "more Stands in total" condition. Monsters count 1 here. */
export function totalWeight(s: StandInRange): number {
  return s.totalCount ?? 1;
}

export interface ZoneSeizeInput {
  stands: readonly StandInRange[];
  friendlyTo?: PlayerId;
  /** Players whose friendly Objective Marker is in this zone: the zone is Contested for their enemy (pack p.8). */
  contestedBy?: readonly PlayerId[];
}

export interface ZoneSeizeResult {
  seizedBy: PlayerId | null;
  totals: Record<PlayerId, number>;
  seizing: Record<PlayerId, number>;
}

const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');

/**
 * Who Seizes an Objective Zone (core p.106; pack p.8): a player needs MORE Stands in total in
 * range AND MORE Stands for the purposes of Seizing than the opponent.
 * RULE-AMBIGUITY: AMB-19 — a tie on either count means nobody Seizes.
 */
export function resolveZone(input: ZoneSeizeInput): ZoneSeizeResult {
  const totals: Record<PlayerId, number> = { P1: 0, P2: 0 };
  const seizing: Record<PlayerId, number> = { P1: 0, P2: 0 };
  const always = new Set<PlayerId>();
  for (const s of input.stands) {
    totals[s.owner] += totalWeight(s);
    seizing[s.owner] += seizingWeight(s);
    if (s.alwaysSeizes && s.canSeize) always.add(s.owner);
  }
  const allowed = (p: PlayerId) =>
    input.friendlyTo !== p && !(input.contestedBy ?? []).includes(other(p));
  let seizedBy: PlayerId | null = null;
  if (always.size === 1) {
    const p = [...always][0]!;
    if (allowed(p)) seizedBy = p;
  } else if (always.size === 0) {
    for (const p of ['P1', 'P2'] as const) {
      const o = other(p);
      if (allowed(p) && totals[p] > totals[o] && seizing[p] > seizing[o]) seizedBy = p;
    }
  }
  return { seizedBy, totals, seizing };
}
