import { chargeDistanceRule } from './actions';
import { footprint } from './formation';
import { frame } from './geometry/polygon';
import { add, scale, type Vec } from './geometry/vec';
import type { GameState, RegimentState } from './model/types';
import { formationInput, marchValue } from './queries';
import { hasRule } from './rules/special/rules';

/**
 * Charge reach (roadmap 2.2). A Charge reaches an enemy whose closest point is within the Charge
 * Distance, die + March (core p.31), and which is in the front arc (core p.13–14, p.31). The area
 * is therefore the front arc cut at that distance from the front edge: a band ahead of the edge,
 * rounded off around the front corners between the 45° arc lines.
 */

export interface ReachBand {
  /** Charge Distance in inches. */
  d: number;
  /** Chance the Charge Distance is at least d. */
  p: number;
}

/** Chance that a Charge Distance of at least `d` is rolled (no target-specific bonuses). */
function chanceAtLeast(r: RegimentState, s: GameState, d: number): number {
  const rule = chargeDistanceRule(s, r, null);
  if (rule.fixed !== null) return rule.fixed >= d - 1e-9 ? 1 : 0;
  const k = Math.max(1, Math.ceil(d - marchValue(s, r) - rule.bonus - 1e-9));
  if (k > 6) return 0;
  const single = (7 - k) / 6;
  const twoDice = !!r.flags.charge2d6;
  const unstoppable = hasRule(r.rules, 'Unstoppable') || (r.commandModels.includes('Standard Bearer') && r.stands.some((x) => x.isCommand));
  const first = twoDice ? 1 - (1 - single) ** 2 : single;
  return unstoppable ? first + (1 - first) * single : first;
}

/**
 * Three bands: the distance always reached, the furthest reached at least half the time, and the
 * maximum. Juggernaut and Phalanx give one fixed band (core p.99–100).
 */
export function chargeBands(s: GameState, r: RegimentState): ReachBand[] {
  const rule = chargeDistanceRule(s, r, null);
  if (rule.fixed !== null) return [{ d: rule.fixed, p: 1 }];
  const M = marchValue(s, r) + rule.bonus;
  const all = [1, 2, 3, 4, 5, 6].map((k) => ({ d: M + k, p: chanceAtLeast(r, s, M + k) }));
  const likely = [...all].reverse().find((b) => b.p >= 0.5) ?? all[0]!;
  const bands = [all[0]!, likely, all[5]!];
  return bands.filter((b, i) => i === 0 || b.d > bands[i - 1]!.d);
}

/** The front-arc area within `d` inches of the Regiment's front edge, as a polygon. */
export function frontReachPolygon(s: GameState, r: RegimentState, d: number, steps = 10): Vec[] {
  const fp = footprint(formationInput(s, r));
  const { forward: f, right: rt } = frame(fp.angle);
  const P = (u: number, w: number) => add(fp.c, add(scale(rt, u), scale(f, w)));
  const L = P(-fp.halfWidth, fp.halfDepth);
  const R = P(fp.halfWidth, fp.halfDepth);
  const dir = (deg: number) => {
    // 0° = forward, positive = towards the right.
    const a = (deg * Math.PI) / 180;
    return add(scale(f, Math.cos(a)), scale(rt, Math.sin(a)));
  };
  const pts: Vec[] = [L];
  for (let i = 0; i <= steps; i++) pts.push(add(L, scale(dir(-45 + (45 * i) / steps), d)));
  for (let i = 0; i <= steps; i++) pts.push(add(R, scale(dir((45 * i) / steps), d)));
  pts.push(R);
  return pts;
}

/** The furthest a Regiment could Charge (for enemy threat ranges). */
export function maxReach(s: GameState, r: RegimentState): number {
  const b = chargeBands(s, r);
  return b[b.length - 1]!.d;
}
