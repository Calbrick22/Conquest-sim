import { apply, validate, type Action } from './game';
import { chargeDice, chargeDistanceRule, chargeFacing, chargePlacement, completeCharge } from './actions';
import type { Ctx } from './dice';
import type { GameState, RegimentState } from './model/types';
import { distancePolys, marchValue, regimentPolys } from './queries';
import { createRng } from './rng';
import { TOL } from './geometry/vec';

/**
 * Outcome previews (roadmap 2.1): what a Charge, Volley or Clash is likely to do, before rolling.
 *
 * The Action is played many times through the real engine with different dice, so every special
 * rule is counted exactly as in play. A Charge's success chance is worked out exactly from the
 * Charge Distance rules (core p.31, p.36); its Impact Attacks are then simulated from the placed
 * position, which is found once. Nothing here changes the game.
 */

export type PreviewKind = 'charge' | 'volley' | 'clash';

export interface OutcomePreview {
  kind: PreviewKind;
  targetId: string;
  samples: number;
  /** Charge: chance the Charge succeeds (1 for Volley and Clash). */
  pSuccess: number;
  /** Wounds the target suffers (Morale included), averaged over the times the Action succeeds. */
  wounds: number;
  /** Stands the target loses, averaged likewise. */
  stands: number;
  /** Chance the target is Broken by this Action, or destroyed (over all attempts). */
  pBreak: number;
  pDestroy: number;
  /** Wounds the attacker suffers back (Counter-Attack, Lethal Demise…), averaged likewise. */
  woundsBack: number;
  /** Charge succeeds but cannot be placed automatically. */
  unplaceable?: boolean;
}

/** Wounds left in a Regiment (Stands × W minus Wound markers). */
function health(r: RegimentState): number {
  if (r.location === 'destroyed') return 0;
  const W = Math.max(1, r.profile.W ?? 1);
  return r.stands.reduce((a, st) => a + (W - st.wounds), 0);
}

/** Probability that a Charge reaches: die (or best of 2D6) + March + bonuses, with an optional re-roll. */
export function chargeSuccessChance(s: GameState, r: RegimentState, t: RegimentState): number {
  const d = distancePolys(regimentPolys(s, r), regimentPolys(s, t));
  const rule = chargeDistanceRule(s, r, t);
  if (rule.fixed !== null) return rule.fixed >= d - TOL ? 1 : 0;
  const need = Math.max(1, Math.ceil(d - marchValue(s, r) - rule.bonus - TOL));
  if (need > 6) return 0;
  const single = (7 - need) / 6;
  const dice = chargeDice(s, r, t);
  const first = dice.twoDice ? 1 - (1 - single) ** 2 : single;
  return dice.reroll ? first + (1 - first) * single : first;
}

function emptyPreview(kind: PreviewKind, targetId: string, samples: number): OutcomePreview {
  return { kind, targetId, samples, pSuccess: 1, wounds: 0, stands: 0, pBreak: 0, pDestroy: 0, woundsBack: 0 };
}

export function previewAction(state: GameState, kind: PreviewKind, attackerId: string, targetId: string, samples = 200): OutcomePreview | null {
  const action = { type: kind, regimentId: attackerId, targetId } as Action;
  if (!validate(state, action).ok) return null;
  const base: GameState = { ...state, forcedDice: [] };
  const r0 = base.regiments[attackerId]!;
  const t0 = base.regiments[targetId]!;
  const out = emptyPreview(kind, targetId, samples);
  const tally = (before: GameState, after: GameState) => {
    const ta = after.regiments[targetId]!;
    const ra = after.regiments[attackerId]!;
    out.wounds += health(before.regiments[targetId]!) - health(ta);
    out.stands += before.regiments[targetId]!.stands.length - ta.stands.length;
    out.woundsBack += health(before.regiments[attackerId]!) - health(ra);
    if (ta.broken && !before.regiments[targetId]!.broken) out.pBreak += 1;
    if (ta.location === 'destroyed') out.pDestroy += 1;
  };

  if (kind === 'charge') {
    out.pSuccess = chargeSuccessChance(base, r0, t0);
    const facing = chargeFacing(base, r0, t0);
    const place = chargePlacement(base, r0, t0, facing);
    if (!place.pose) {
      out.unplaceable = true;
      return out;
    }
    // The placed position, as the real Charge would leave it before its Impact Attacks.
    const placed: GameState = structuredClone(base);
    placed.regiments[attackerId]!.pose = place.pose;
    if (place.push) placed.regiments[place.push.id]!.pose = place.push.pose;
    if (place.targetPose) placed.regiments[targetId]!.pose = place.targetPose;
    for (let i = 0; i < samples; i++) {
      const s = structuredClone(placed);
      const ctx: Ctx = { s, rng: createRng(7919 * (i + 1)), events: [] };
      completeCharge(ctx, s.regiments[attackerId]!, s.regiments[targetId]!, facing);
      tally(placed, s);
    }
  } else {
    for (let i = 0; i < samples; i++) tally(base, apply(base, action, createRng(7919 * (i + 1))).state);
  }
  // Damage is averaged over successful attempts; Break and destroy chances over all attempts.
  out.wounds /= samples;
  out.stands /= samples;
  out.woundsBack /= samples;
  out.pBreak = (out.pBreak / samples) * out.pSuccess;
  out.pDestroy = (out.pDestroy / samples) * out.pSuccess;
  return out;
}

/** Previews for every legal target of this kind for the active Regiment. */
export function previewTargets(state: GameState, kind: PreviewKind, attackerId: string, samples = 200): OutcomePreview[] {
  const out: OutcomePreview[] = [];
  for (const t of Object.values(state.regiments)) {
    if (t.location !== 'table' || t.owner === state.regiments[attackerId]?.owner) continue;
    const p = previewAction(state, kind, attackerId, t.id, samples);
    if (p) out.push(p);
  }
  return out;
}
