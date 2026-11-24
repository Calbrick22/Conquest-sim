import { charStat, highestR, moraleTest, allocateWounds, killCharacter, resolveAttack, stat, type AttackPool } from './combat';
import { ev, rollN, rollTest, type Ctx } from './dice';
import { arcsOf, majorityArc, type Arc } from './geometry/arcs';
import { STAND_SIZE } from './geometry/bases';
import { losLineObstructed, volleyLineObstructed, type Obstacle } from './geometry/los';
import { intersectionArea, overlaps, polyDistance, rectCorners, rectPoly, type Poly, type Rect } from './geometry/polygon';
import { add, dist, normalizeAngle, scale, sub, TOL, type Vec } from './geometry/vec';
import { footprint, layout, poseFrame } from './formation';
import { applyPath, samplePath, type MoveSeg } from './movement';
import type { CharacterState, GameState, PlayerId, Pose, RegimentState } from './model/types';
import {
  anyOverlap,
  attachedCharacter,
  distancePolys,
  formationInput,
  isEngaged,
  markerPolys,
  marchValue,
  onTable,
  onTableRegiments,
  other,
  positionProblems,
  regimentPolys,
} from './queries';
import { barrageOf, flatRules, hasRule, ruleX } from './rules/special/rules';

// ---------------------------------------------------------------- shared geometry helpers

export function footprintOf(s: GameState, r: RegimentState, o?: Partial<Pick<RegimentState, 'pose' | 'files'>>): Rect {
  return footprint(formationInput(s, r, o));
}

export function sizeOf(r: RegimentState): number {
  return STAND_SIZE[r.type];
}

/** The arc of `target` that `attacker` is in, by majority of the attacker's footprint (core p.35, p.46). */
export function arcOfAttack(s: GameState, attacker: RegimentState, target: RegimentState): Arc {
  return majorityArc(footprintOf(s, target), rectPoly(footprintOf(s, attacker))) ?? 'front';
}

export function enemiesInContact(s: GameState, r: RegimentState): RegimentState[] {
  const polys = regimentPolys(s, r);
  return onTableRegiments(s).filter((o) => o.owner !== r.owner && distancePolys(polys, regimentPolys(s, o)) <= TOL);
}

/** Engaged in the flank or rear by any enemy (Support (X) is lost, core p.100). */
export function engagedFlankOrRear(s: GameState, r: RegimentState): boolean {
  return enemiesInContact(s, r).some((e) => arcOfAttack(s, e, r) !== 'front');
}

function obstacles(s: GameState, exclude: string[]): Obstacle[] {
  return onTableRegiments(s)
    .filter((r) => !exclude.includes(r.id))
    .flatMap((r) => regimentPolys(s, r).map((poly) => ({ poly, size: sizeOf(r) })));
}

export function closestPointOnPoly(p: Vec, poly: Poly): Vec {
  let best = poly[0]!;
  let bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ab = sub(b, a);
    const l2 = ab.x * ab.x + ab.y * ab.y;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / l2)) : 0;
    const q = add(a, scale(ab, t));
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/** Centre of the front edge of a Stand rectangle. */
export function frontCentre(rect: Rect): Vec {
  const [fl, fr] = rectCorners(rect);
  return { x: (fl.x + fr.x) / 2, y: (fl.y + fr.y) / 2 };
}

/**
 * Line of Sight (core p.14): target in the front arc, and a front-rank Stand can draw a 1 mm line
 * to it not blocked by Regiments of equal or larger Size than the target. RULE-AMBIGUITY: AMB-07.
 */
export function hasLineOfSight(s: GameState, r: RegimentState, t: RegimentState): boolean {
  const fp = footprintOf(s, r);
  const tPolys = regimentPolys(s, t);
  if (!tPolys.some((p) => arcsOf(fp, p).includes('front'))) return false;
  const obs = obstacles(s, [r.id, t.id]);
  const front = layout(formationInput(s, r)).filter((x) => x.rank === 0);
  return front.some((slot) => {
    const from = frontCentre(slot.rect);
    return tPolys.some((tp) => !losLineObstructed(from, closestPointOnPoly(from, tp), sizeOf(t), obs));
  });
}

// ---------------------------------------------------------------- Charge (core p.31–36)

export function maxChargeReach(s: GameState, r: RegimentState): number {
  return marchValue(s, r) + 6;
}

export function chargeProblems(s: GameState, r: RegimentState, t: RegimentState | undefined): string[] {
  if (!t || t.location !== 'table' || t.owner === r.owner) return ['Choose an enemy Regiment on the Battlefield.'];
  if (r.location !== 'table') return ['The Regiment is not on the Battlefield.'];
  if (r.arrivedRound === s.round) return ['A Regiment cannot Charge in the Round it arrives from Reinforcements (core p.31).'];
  if (r.broken) return ['Broken Regiments cannot Charge (core p.60).'];
  if (isEngaged(s, r)) return ['A Regiment in contact with an enemy cannot Charge (core p.24).'];
  if (!hasLineOfSight(s, r, t)) return [`${t.name} is not in the front arc and Line of Sight (core p.31).`];
  const d = distancePolys(regimentPolys(s, r), regimentPolys(s, t));
  if (d > maxChargeReach(s, r) + TOL) return [`${t.name} is ${d.toFixed(2)}″ away, beyond the maximum Charge of ${maxChargeReach(s, r)}″ (core p.31).`];
  return [];
}

/** The facing charged: where most of the charger's front-rank Stands are (core p.35). */
export function chargeFacing(s: GameState, r: RegimentState, t: RegimentState): Arc {
  const tfp = footprintOf(s, t);
  const front = layout(formationInput(s, r)).filter((x) => x.rank === 0);
  const count: Record<Arc, number> = { front: 0, rear: 0, left: 0, right: 0 };
  const area: Record<Arc, number> = { front: 0, rear: 0, left: 0, right: 0 };
  if (front.length <= 1) {
    const one = front[0] ? rectPoly(front[0].rect) : rectPoly(footprintOf(s, r));
    return majorityArc(tfp, one) ?? 'front';
  }
  for (const sl of front) {
    const p = rectPoly(sl.rect);
    for (const a of arcsOf(tfp, p)) {
      count[a] += 1;
      area[a] += intersectionArea(p, rectPoly(tfp)) + 1;
    }
  }
  // Ties: the charger may choose (core p.35); the engine picks the larger overlap, then front > flanks > rear.
  const order: Arc[] = ['front', 'left', 'right', 'rear'];
  return order.reduce((best, a) => (count[a] > count[best] || (count[a] === count[best] && area[a] > area[best]) ? a : best), 'front' as Arc);
}

/** Target edge for a facing: endpoints and outward normal. */
function facingEdge(tfp: Rect, facing: Arc): { a: Vec; b: Vec; n: Vec } {
  const [fl, fr, rr, rl] = rectCorners(tfp);
  const { forward, right } = poseFrame({ x: 0, y: 0, angle: tfp.angle });
  switch (facing) {
    case 'front':
      return { a: fl, b: fr, n: forward };
    case 'rear':
      return { a: rr, b: rl, n: scale(forward, -1) };
    case 'left':
      return { a: rl, b: fl, n: scale(right, -1) };
    case 'right':
      return { a: fr, b: rr, n: right };
  }
}

/**
 * Final position of a successful Charge: front edge flush with the charged facing, as centred on
 * it as possible, slid along the edge to the nearest position that is legal (no overlaps, no
 * contact with other enemies, on the table). The swept path from the start must not pass through
 * other enemies. RULE-AMBIGUITY: AMB-11 — this replaces the free Wheel / move / "close the door"
 * sequence with its end result; anything it cannot place is left to the player.
 */
export function chargePlacement(s: GameState, r: RegimentState, t: RegimentState, facing: Arc): { pose: Pose | null; reason?: string } {
  const tfp = footprintOf(s, t);
  const e = facingEdge(tfp, facing);
  const edgeLen = dist(e.a, e.b);
  const dir = { x: (e.b.x - e.a.x) / edgeLen, y: (e.b.y - e.a.y) / edgeLen };
  const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
  const width = footprintOf(s, r).halfWidth * 2;
  const angle = Math.atan2(-e.n.y, -e.n.x);
  const limit = Math.abs(edgeLen - width) / 2;
  const t0 = Math.max(-limit, Math.min(limit, (r.pose.x - mid.x) * dir.x + (r.pose.y - mid.y) * dir.y));
  const candidates: number[] = [t0];
  for (let k = 1; k <= 40; k++) for (const sgn of [-1, 1]) candidates.push(t0 + sgn * k * 0.25);
  const others = onTableRegiments(s).filter((o) => o.id !== r.id && o.id !== t.id);
  let blockedReason = 'no room to place the Regiment in contact';
  for (const off of candidates) {
    const P = add(mid, scale(dir, off));
    const pose: Pose = { x: P.x, y: P.y, angle };
    const polys = regimentPolys(s, r, { pose });
    if (!onTable(s, polys)) continue;
    // Must actually engage the target.
    if (distancePolys(polys, regimentPolys(s, t)) > TOL) continue;
    if (anyOverlap(polys, regimentPolys(s, t))) continue;
    let bad = false;
    for (const o of others) {
      const op = regimentPolys(s, o);
      if (anyOverlap(polys, op) || (o.owner !== r.owner && distancePolys(polys, op) <= TOL)) {
        bad = true;
        break;
      }
    }
    if (bad || markerPolys(s).some((m) => polys.some((p) => overlaps(p, m)))) continue;
    // Swept path: interpolate position and facing; may not pass through other enemies or engaged friends.
    const da = normalizeAngle(angle - r.pose.angle);
    let pathBlocked = false;
    for (let i = 1; i < 40; i++) {
      const f = i / 40;
      const q: Pose = { x: r.pose.x + (P.x - r.pose.x) * f, y: r.pose.y + (P.y - r.pose.y) * f, angle: r.pose.angle + da * f };
      const qp = regimentPolys(s, r, { pose: q });
      if (others.some((o) => (o.owner !== r.owner || isEngaged(s, o)) && anyOverlap(qp, regimentPolys(s, o)))) {
        pathBlocked = true;
        break;
      }
    }
    if (pathBlocked) {
      blockedReason = 'the path to the target is blocked';
      continue;
    }
    return { pose };
  }
  return { pose: null, reason: blockedReason };
}

/** Impact Attacks after a successful Charge (core p.36, p.100). */
export function resolveImpact(ctx: Ctx, r: RegimentState, t: RegimentState, facing: Arc): void {
  const s = ctx.s;
  const pools: AttackPool[] = [];
  const impact = ruleX(r.rules, 'Impact');
  if (impact > 0) {
    pools.push({
      label: `${r.name} Impact (${impact}) × ${r.stands.length}`,
      dice: impact * r.stands.length,
      skill: stat(r, 'C'),
      reduceD: ruleX(r.rules, 'Brutal Impact'),
      ignoreShield: hasRule(r.rules, 'Linebreaker'),
    });
  }
  const c = attachedCharacter(s, r.id);
  const ci = c ? ruleX(c.rules, 'Impact') : 0;
  if (c && ci > 0) pools.push({ label: `${c.name} Impact (${ci})`, dice: ci, skill: charStat(c, 'C'), reduceD: ruleX(c.rules, 'Brutal Impact'), ignoreShield: hasRule(c.rules, 'Linebreaker') });
  if (!pools.length) return;
  resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: t.id, arc: facing, pools, morale: true, terrifying: ruleX(r.rules, 'Terrifying'), what: `${r.name} Impact Attacks` });
}

/** Furthest a failed Charge can move straight forward: up to the die, halting 1″ from enemies (core p.36). */
export function failedChargeDistance(s: GameState, r: RegimentState, die: number): number {
  const width = footprintOf(s, r).halfWidth * 2;
  let best = 0;
  for (let d = 0.05; d <= die + 1e-9; d += 0.05) {
    const pose = applyPath(r.pose, [{ kind: 'forward', d }], width);
    const problems = positionProblems(s, r, regimentPolys(s, r, { pose }), { allowFriendOverlap: false, allowOffTable: false });
    if (problems.length) break;
    best = d;
  }
  return Math.round(best * 100) / 100;
}

export function applyCharge(ctx: Ctx, r: RegimentState, t: RegimentState): void {
  const s = ctx.s;
  const d = distancePolys(regimentPolys(s, r), regimentPolys(s, t));
  const M = marchValue(s, r);
  const facing = chargeFacing(s, r, t);
  const idx = ctx.rng.index;
  let [die] = rollN(ctx, 1) as [number];
  const notes = [`Charge Distance = die + March ${M}; need ${d.toFixed(2)}″`];
  let total = die + M;
  const unstoppable = hasRule(r.rules, 'Unstoppable') || (r.commandModels.includes('Standard Bearer') && r.stands.some((x) => x.isCommand));
  if (total < d - TOL && unstoppable) {
    const first = die;
    [die] = rollN(ctx, 1) as [number];
    total = die + M;
    notes.push(`Unstoppable re-roll ${first}→${die} (core p.101)`);
  }
  const success = total >= d - TOL;
  ev(ctx, {
    type: 'dice',
    text: `${r.name} charges ${t.name} (${facing}): rolled ${die} + ${M} = ${total}″ against ${d.toFixed(2)}″ — ${success ? 'success' : 'failed'}.`,
    dice: { purpose: `${r.name}: Charge Roll`, seed: ctx.rng.seed, index: idx, values: [die], notes },
    player: r.owner,
    regimentId: r.id,
  });
  const act = s.activation!;
  act.actions.push('charge');
  if (!success) {
    const move = failedChargeDistance(s, r, die);
    if (move > 0) r.pose = applyPath(r.pose, [{ kind: 'forward', d: move }], footprintOf(s, r).halfWidth * 2);
    act.ended = true;
    ev(ctx, { type: 'charge', text: `Failed Charge: ${r.name} moves ${move}″ forward and its Activation ends (core p.36).`, player: r.owner, regimentId: r.id });
    return;
  }
  const place = chargePlacement(s, r, t, facing);
  if (!place.pose) {
    s.pendingCharge = { regimentId: r.id, targetId: t.id, facing };
    ev(ctx, { type: 'charge', text: `The Charge succeeds but the engine cannot place it (${place.reason}). Place ${r.name} in contact by hand, or declare the Charge failed (AMB-11).`, player: r.owner, regimentId: r.id });
    return;
  }
  r.pose = place.pose;
  completeCharge(ctx, r, t, facing as Arc);
}

/** After the charger is in contact: Impact Attacks and Inspired (core p.35–36). */
export function completeCharge(ctx: Ctx, r: RegimentState, t: RegimentState, facing: Arc): void {
  ev(ctx, { type: 'charge', text: `${r.name} contacts ${t.name}'s ${facing} and gains Inspired until the end of its Activation (core p.35).`, player: r.owner, regimentId: r.id });
  ctx.s.activation!.inspired = true;
  resolveImpact(ctx, r, t, facing);
}

// ---------------------------------------------------------------- Clash (core p.44–46)

export function clashTargets(s: GameState, r: RegimentState): RegimentState[] {
  return enemiesInContact(s, r);
}

/** Inspired (core p.99): +1 Clash, or re-roll natural 6s if that would make it 5+. Applied last. */
function inspiredSkill(c: number, inspired: boolean): { skill: number; rerollSixes: boolean } {
  if (!inspired) return { skill: c, rerollSixes: false };
  // RULE-AMBIGUITY: AMB-16.
  return c + 1 >= 5 ? { skill: c, rerollSixes: true } : { skill: c + 1, rerollSixes: false };
}

export function applyClash(ctx: Ctx, r: RegimentState, t: RegimentState): void {
  const s = ctx.s;
  const tfp = rectPoly(footprintOf(s, t));
  const slots = layout(formationInput(s, r));
  const polys = slots.map((sl) => rectPoly(sl.rect));
  const engaged = slots.map((_, i) => polyDistance(polys[i]!, tfp) <= TOL);
  // Inspired is not available to Broken Regiments, to a Regiment whose Character declined a Duel, or against Dread.
  const inspiredAllowed = !r.broken && !r.flags.declinedDuel && !enemiesInContact(s, r).some((e) => hasRule(e.rules, 'Dread'));
  const inspired = !!s.activation?.inspired && inspiredAllowed;
  const support = engagedFlankOrRear(s, r) ? 1 : ruleX(r.rules, 'Support') || 1;
  const leader = r.commandModels.includes('Leader');
  let engagedAttacks = 0;
  let supportAttacks = 0;
  slots.forEach((sl, i) => {
    if (sl.isCharacter) return;
    if (engaged[i]) engagedAttacks += stat(r, 'A') + (sl.isCommand && leader ? 1 : 0);
    else supportAttacks += support;
  });
  const C = stat(r, 'C');
  const ins = inspiredSkill(C, inspired);
  const pools: AttackPool[] = [
    {
      label: `${r.name} (${engagedAttacks} engaged + ${supportAttacks} support)`,
      dice: engagedAttacks + supportAttacks,
      skill: ins.skill,
      rerollSixes: ins.rerollSixes,
      rerollFailed: hasRule(r.rules, 'Flurry'),
      extraOnOne: ins.skill >= 6,
      reduceD: ruleX(r.rules, 'Cleave'),
      ignoreShield: hasRule(r.rules, 'Linebreaker'),
      deadly6: hasRule(r.rules, 'Deadly Blades'),
    },
  ];
  const c = attachedCharacter(s, r.id);
  if (c) {
    const ci = slots.findIndex((x) => x.isCharacter);
    const n = ci >= 0 && engaged[ci] ? charStat(c, 'A') : 1;
    const cins = inspiredSkill(charStat(c, 'C'), inspired);
    pools.push({
      label: `${c.name} (${ci >= 0 && engaged[ci] ? 'engaged' : 'support'})`,
      dice: n,
      skill: cins.skill,
      rerollSixes: cins.rerollSixes,
      rerollFailed: hasRule(c.rules, 'Flurry'),
      extraOnOne: cins.skill >= 6,
      reduceD: ruleX(c.rules, 'Cleave'),
      ignoreShield: hasRule(c.rules, 'Linebreaker'),
      deadly6: hasRule(c.rules, 'Deadly Blades'),
    });
  }
  const arc = arcOfAttack(s, r, t);
  if (inspired) ev(ctx, { type: 'note', text: `${r.name} is Inspired: ${ins.rerollSixes ? 're-rolls natural 6s' : `Clash ${C}→${ins.skill}`} (core p.99).` });
  resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: t.id, arc, pools, morale: true, terrifying: ruleX(r.rules, 'Terrifying'), what: `${r.name} Clash` });
}

// ---------------------------------------------------------------- Volley (core p.38–41)

export interface VolleyStandPlan {
  label: string;
  shots: number;
  arc: Arc | null;
  reason?: string;
  skill: number;
  ap: number;
  deadly: boolean;
}

/** Works out each front-rank Stand's shots (core p.38–40). */
export function planVolley(s: GameState, r: RegimentState, t: RegimentState, aimed: boolean): { plans: VolleyStandPlan[]; problems: string[] } {
  const problems: string[] = [];
  if (r.location !== 'table' || t.location !== 'table') problems.push('Both Regiments must be on the Battlefield.');
  if (t.owner === r.owner) problems.push('Choose an enemy Regiment.');
  if (isEngaged(s, r)) problems.push('An engaged Regiment cannot Volley (core p.38).');
  const fp = footprintOf(s, r);
  const tfp = footprintOf(s, t);
  const tPolys = regimentPolys(s, t);
  if (!tPolys.some((p) => arcsOf(fp, p).includes('front'))) problems.push(`${t.name} is not in the front arc (core p.38).`);
  const obs = obstacles(s, [r.id, t.id]);
  const c = attachedCharacter(s, r.id);
  const plans: VolleyStandPlan[] = [];
  const front = layout(formationInput(s, r)).filter((x) => x.rank === 0);
  for (const sl of front) {
    const rules = sl.isCharacter && c ? c.rules : r.rules;
    const b = barrageOf(rules);
    const label = sl.isCharacter && c ? c.name : `${r.name} stand${sl.isCommand ? ' (Command)' : ''}`;
    const V = sl.isCharacter && c ? charStat(c, 'V') : stat(r, 'V');
    const vAimed = aimed ? (V + 1 >= 5 ? V : V + 1) : V;
    const all = flatRules([...rules, ...(b?.sub ?? [])]);
    const ap = ruleX(all, 'Armor Piercing');
    const deadly = hasRule(all, 'Deadly Shot');
    if (!b) {
      plans.push({ label, shots: 0, arc: null, reason: 'no Barrage', skill: vAimed, ap, deadly });
      continue;
    }
    const from = frontCentre(sl.rect);
    let bestD = Infinity;
    let bestPoly: Poly | null = null;
    for (const tp of tPolys) {
      const q = closestPointOnPoly(from, tp);
      const d = dist(from, q);
      if (d < bestD) {
        bestD = d;
        bestPoly = tp;
      }
    }
    if (!bestPoly || bestD > b.range + TOL) {
      plans.push({ label, shots: 0, arc: null, reason: `out of range (${bestD.toFixed(1)}″ > ${b.range}″)`, skill: vAimed, ap, deadly });
      continue;
    }
    const clear = tPolys.some((tp) => !volleyLineObstructed(from, closestPointOnPoly(from, tp), sizeOf(r), sizeOf(t), obs));
    if (!clear) {
      plans.push({ label, shots: 0, arc: null, reason: 'Obstructed (core p.38)', skill: vAimed, ap, deadly });
      continue;
    }
    let shots = b.shots + (sl.isCommand && r.commandModels.includes('Leader') ? 1 : 0);
    // Effective Range: closer than half range gives +1 (core p.39). RULE-AMBIGUITY: AMB-09.
    const effective = bestD < b.range / 2;
    if (effective) shots += 1;
    const arc = majorityArc(tfp, rectPoly(sl.rect)) ?? 'front';
    plans.push({ label: `${label}${effective ? ' (Effective Range +1)' : ''}`, shots, arc, skill: vAimed, ap, deadly });
  }
  if (!plans.some((p) => p.shots > 0) && !problems.length) problems.push('No Stand can shoot at that Regiment (range or obstruction).');
  return { plans, problems };
}

export function applyVolley(ctx: Ctx, r: RegimentState, t: RegimentState): void {
  const s = ctx.s;
  const aimed = !!s.activation?.aimed;
  const { plans } = planVolley(s, r, t, aimed);
  const byArc = new Map<Arc, VolleyStandPlan[]>();
  for (const p of plans) if (p.shots > 0 && p.arc) byArc.set(p.arc, [...(byArc.get(p.arc) ?? []), p]);
  for (const p of plans) if (p.shots === 0) ev(ctx, { type: 'note', text: `${p.label}: no shots (${p.reason}).` });
  // Stands in different arcs are resolved separately but simultaneously (core p.40).
  for (const [arc, ps] of byArc) {
    // Stands with identical profiles share one pool of dice (same Hit and Defense rolls).
    const pools: AttackPool[] = [];
    for (const p of ps) {
      const same = pools.find((q) => q.skill === p.skill && q.reduceD === p.ap && q.deadly6 === p.deadly);
      if (same) {
        same.dice += p.shots;
        same.label += ` + ${p.shots}`;
      } else
        pools.push({ label: `${r.name} Volley → ${arc} (${p.shots}`, dice: p.shots, skill: p.skill, rerollSixes: aimed && p.skill >= 5, extraOnOne: p.skill >= 6, reduceD: p.ap, deadly6: p.deadly });
    }
    for (const q of pools) q.label += ' shots)';
    resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: t.id, arc, pools, morale: false, terrifying: 0, what: `${r.name} Volley` });
    if (s.regiments[t.id]!.location === 'destroyed') break;
  }
}

// ---------------------------------------------------------------- Withdraw, Combat Reform, Rally (core p.36, p.47–51)

/** Fearsome (core p.98): enemies in contact must pass a test before Combat Rally / Combat Reform. */
export function fearsomeCheck(ctx: Ctx, r: RegimentState, what: string): boolean {
  if (hasRule(r.rules, 'Fearless')) return true;
  const scary = enemiesInContact(ctx.s, r).filter((e) => hasRule(e.rules, 'Fearsome'));
  if (!scary.length) return true;
  const R = highestR(ctx, r);
  const t = rollTest(ctx, 1, { target: R }, `${r.name}: Fearsome test`);
  const okRoll = t.passes === 1;
  ev(ctx, { type: 'dice', text: `${r.name} faces Fearsome ${scary[0]!.name}: rolled ${t.values[0]} against ${R} — ${okRoll ? `may ${what}` : `${what} fails and is lost`} (core p.98).`, dice: t.record, player: r.owner });
  return okRoll;
}

export function withdrawPose(s: GameState, r: RegimentState, moves: MoveSeg[]): Pose {
  // Reform facing away from the enemy: turn about the centre so the old rear becomes the front
  // (core p.51; RULE-AMBIGUITY: AMB-32 — "away" is taken as directly away from the current facing).
  const fp = footprintOf(s, r);
  const { forward } = poseFrame(r.pose);
  const depth = fp.halfDepth * 2;
  const front: Pose = { x: r.pose.x - forward.x * depth, y: r.pose.y - forward.y * depth, angle: r.pose.angle + Math.PI };
  return applyPath(front, moves, fp.halfWidth * 2);
}

export function withdrawProblems(s: GameState, r: RegimentState, moves: MoveSeg[]): string[] {
  if (!isEngaged(s, r)) return ['Only a Regiment in contact with an enemy can Withdraw (core p.50).'];
  if (r.cls === 'Heavy') return ['Only Light or Medium Regiments can Withdraw (core p.50).'];
  if (moves.some((m) => m.kind === 'sideways' || m.kind === 'backward')) return ['After turning to face away, the Withdraw March is forward, with Wheels if needed.'];
  return [];
}

export function applyWithdraw(ctx: Ctx, r: RegimentState, moves: MoveSeg[]): void {
  const s = ctx.s;
  const R = highestR(ctx, r);
  const t = rollTest(ctx, 1, { target: R }, `${r.name}: Withdraw`);
  const clean = t.passes === 1;
  const contacts = layout(formationInput(s, r)).filter((sl) => !sl.isCharacter && enemiesInContact(s, r).some((e) => distancePolys([rectPoly(sl.rect)], regimentPolys(s, e)) <= TOL)).length;
  const idx = ctx.rng.index;
  const [d] = rollN(ctx, 1) as [number];
  const wounds = clean ? d : d * contacts;
  ev(ctx, {
    type: 'dice',
    text: `${r.name} Withdraws: rolled ${t.values[0]} against ${R} — ${clean ? `Clean Withdrawal, suffers D6 = ${d} Wounds` : `Fighting Withdrawal, suffers ${d} × ${contacts} Stands in contact = ${wounds} Wounds`} (core p.51).`,
    dice: { purpose: `${r.name}: Withdraw Wounds`, seed: ctx.rng.seed, index: idx, values: [d], notes: [] },
    player: r.owner,
    regimentId: r.id,
  });
  const enemy = enemiesInContact(s, r)[0];
  const by: PlayerId = enemy?.owner ?? other(r.owner);
  if (wounds > 0) {
    allocateWounds(ctx, r, wounds, by);
    // Morale only for a Fighting Withdrawal (RULE-AMBIGUITY: AMB-32).
    if (!clean && r.location !== 'destroyed') moraleTest(ctx, r, wounds, { arc: 'front', terrifying: 0, attackerOwner: by });
  }
  if (r.location === 'destroyed') return;
  const pose = withdrawPose(s, r, moves);
  const width = footprintOf(s, r).halfWidth * 2;
  const path = samplePath(withdrawPose(s, r, []), moves, width);
  const polys = regimentPolys(s, r, { pose });
  const problems = positionProblems(s, r, polys, { allowFriendOverlap: false, allowOffTable: false });
  const through = path.slice(1).some((p) => onTableRegiments(s).some((o) => o.owner !== r.owner && anyOverlap(regimentPolys(s, r, { pose: p }), regimentPolys(s, o))));
  if (problems.length || through) {
    ev(ctx, { type: 'withdraw', text: `${r.name} cannot complete its Withdraw March (${problems[0] ?? 'blocked by an enemy'}): it stays where it was and the Withdraw fails (core p.51).`, player: r.owner, regimentId: r.id });
    return;
  }
  r.pose = pose;
  ev(ctx, { type: 'withdraw', text: `${r.name} turns away and marches off.`, player: r.owner, regimentId: r.id });
}

export function applyCombatReform(ctx: Ctx, r: RegimentState, files: number): void {
  const s = ctx.s;
  if (!fearsomeCheck(ctx, r, 'Combat Reform')) return;
  const R = highestR(ctx, r);
  const t = rollTest(ctx, 1, { target: R }, `${r.name}: Combat Reform`);
  const clean = t.passes === 1;
  const before = countInContact(s, r);
  if (!clean) {
    const enemy = enemiesInContact(s, r)[0];
    const by: PlayerId = enemy?.owner ?? other(r.owner);
    ev(ctx, { type: 'dice', text: `${r.name} makes a Fighting Reform (rolled ${t.values[0]} against ${R}): 1 Wound per Stand in contact = ${before} (core p.48).`, dice: t.record, player: r.owner });
    allocateWounds(ctx, r, before, by);
    if (r.location !== 'destroyed') moraleTest(ctx, r, before, { arc: 'front', terrifying: 0, attackerOwner: by });
    if (r.location === 'destroyed') return;
  } else ev(ctx, { type: 'dice', text: `${r.name} makes a Clean Reform (rolled ${t.values[0]} against ${R}, core p.48).`, dice: t.record, player: r.owner });
  const oldFiles = r.files;
  const oldContact = countInContact(s, r);
  r.files = files;
  const okFront = files - oldFiles <= 2;
  const nowContact = countInContact(s, r);
  const polys = regimentPolys(s, r);
  const overlapsSomething = onTableRegiments(s).some((o) => o.id !== r.id && anyOverlap(polys, regimentPolys(s, o)));
  if (!okFront || nowContact < oldContact || overlapsSomething) {
    r.files = oldFiles;
    ev(ctx, {
      type: 'note',
      text: `The new formation is not legal (${!okFront ? 'front rank can grow by at most 2' : nowContact < oldContact ? 'fewer Stands would be in contact' : 'it would overlap another Regiment'}); ${r.name} keeps its formation. Use "Move by hand" if you need a different placement.`,
    });
    return;
  }
  ev(ctx, { type: 'reform', text: `${r.name} re-forms to ${files} files (${nowContact} Stands in contact).`, player: r.owner, regimentId: r.id });
}

function countInContact(s: GameState, r: RegimentState): number {
  const enemies = enemiesInContact(s, r).map((e) => regimentPolys(s, e));
  return layout(formationInput(s, r)).filter((sl) => !sl.isCharacter && enemies.some((ep) => distancePolys([rectPoly(sl.rect)], ep) <= TOL)).length;
}

// ---------------------------------------------------------------- Duel (core p.76) — basic automation

export function duelTargets(s: GameState, c: CharacterState): CharacterState[] {
  if (!c.attachedTo) return [];
  const r = s.regiments[c.attachedTo]!;
  return enemiesInContact(s, r)
    .map((e) => attachedCharacter(s, e.id))
    .filter((x): x is CharacterState => !!x);
}

function duelAttack(ctx: Ctx, a: CharacterState, d: CharacterState): number {
  const shield = hasRule(d.rules, 'Shield') && !hasRule(a.rules, 'Linebreaker') ? 1 : 0;
  const hit = rollTest(ctx, charStat(a, 'A'), { target: charStat(a, 'C'), rerollFailed: hasRule(a.rules, 'Flurry') }, `${a.name}: Duel to hit`);
  let hits = hit.passes;
  if (charStat(a, 'C') >= 6) hits += hit.values.filter((v) => v === 1).length;
  ev(ctx, { type: 'dice', text: `${a.name} attacks ${d.name}: ${hits} Hit${hits === 1 ? '' : 's'}.`, dice: hit.record });
  if (!hits) return 0;
  const save = Math.max(Math.max(0, charStat(d, 'D') + shield - ruleX(a.rules, 'Cleave')), charStat(d, 'E'));
  const def = rollTest(ctx, hits, { target: save, defense: true }, `${d.name}: Duel Defense`);
  let w = 0;
  def.values.forEach((v, i) => {
    if (!def.passed[i]) w += hasRule(a.rules, 'Deadly Blades') && v === 6 ? 2 : 1;
  });
  ev(ctx, { type: 'dice', text: `${d.name} saves on ${save} or less: ${w} Wound${w === 1 ? '' : 's'}.`, dice: def.record });
  // RULE-AMBIGUITY: AMB-12 — Resolve rolls for each Wound; failures add Wounds to the Character.
  if (w > 0) {
    const m = rollTest(ctx, w, { target: charStat(d, 'R') }, `${d.name}: Duel Resolve`);
    const extra = w - m.passes;
    if (extra) ev(ctx, { type: 'dice', text: `${d.name} fails ${extra} Resolve roll${extra > 1 ? 's' : ''}: +${extra} Wound${extra > 1 ? 's' : ''}.`, dice: m.record });
    w += extra;
  }
  return w;
}

export function applyDuel(ctx: Ctx, c: CharacterState, target: CharacterState, accept: boolean): void {
  const s = ctx.s;
  if (!accept) {
    const tr = s.regiments[target.attachedTo!]!;
    if (tr.broken) {
      ev(ctx, { type: 'duel', text: `${target.name} cannot decline: its Regiment is Broken (core p.60). The Duel is fought.` });
    } else {
      tr.flags.declinedDuel = true;
      ev(ctx, { type: 'duel', text: `${target.name} declines the Duel: until the end of the Round ${tr.name} cannot Seize, uses its lowest Resolve and cannot be Inspired (core p.76).` });
      return;
    }
  }
  ev(ctx, { type: 'duel', text: `${c.name} duels ${target.name} (core p.76).` });
  const toTarget = duelAttack(ctx, c, target);
  const toChallenger = duelAttack(ctx, target, c);
  for (const [ch, w, by] of [
    [target, toTarget, s.regiments[c.attachedTo!]!.owner],
    [c, toChallenger, s.regiments[target.attachedTo!]!.owner],
  ] as const) {
    ch.wounds += w;
    if (ch.wounds >= charStat(ch, 'W') && !ch.destroyed) {
      const reg = ch.attachedTo;
      killCharacter(ctx, ch, by, 'in a Duel');
      ch.attachedTo = null;
      if (reg) ev(ctx, { type: 'note', text: `${s.regiments[reg]!.name} closes the gap with a free Combat Reform (core p.76).` });
    }
  }
}
