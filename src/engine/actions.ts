import { recordAction } from './activation';
import { type AttackPool, allocateWounds, charStat, highestR, killCharacter, moraleTest, reprocess, resolveAttack, stat } from './combat';
import { ev, rollN, rollTest, type Ctx } from './dice';
import { arcsOf, majorityArc, type Arc } from './geometry/arcs';
import { STAND_SIZE } from './geometry/bases';
import { losLineObstructed, volleyLineObstructed, type Obstacle } from './geometry/los';
import { closestPair, intersectionArea, overlaps, polyDistance, rectCorners, rectPoly, type Poly, type Rect } from './geometry/polygon';
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
import { magnanimity, poolMods } from './rules/special/effects';
import { elementalKind, isElemental, ofCourt, skUnit, warlordCourts, warlordHas, waterPieces, within } from './factions/sorcererKings';
import { volleyInContact } from './factions/sorcererKingsActions';
import { dwAfterDuel, dwMustAccept, dwOnCharge, dwOnDecline, toTheEnd } from './factions/dweghomActions';
import { autoPassesResolve, markOnce, takeGlimmers, xhiliarchChargeBonus } from './factions/oldDominion';
import { chargeThroughHindering, coverHalves, standLosSize, terrainBlocks, terrainPathProblems, terrainPositionProblems } from './terrain';

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

/** Regiments as Line of Sight obstacles; a Stand on an Elevated piece counts its Size plus the piece's (core p.84). */
function obstacles(s: GameState, exclude: string[]): Obstacle[] {
  return onTableRegiments(s)
    .filter((r) => !exclude.includes(r.id))
    .flatMap((r) => regimentPolys(s, r).map((poly) => ({ poly, size: standLosSize(s, r, poly) })));
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
    const sp = rectPoly(slot.rect);
    const ss = standLosSize(s, r, sp);
    return tPolys.some((tp) => {
      const to = closestPointOnPoly(from, tp);
      const ts = standLosSize(s, t, tp);
      // Obstructing terrain (core p.86) blocks by Size, unless either end is on the piece.
      return !losLineObstructed(from, to, ts, obs) && !terrainBlocks(s, from, to, ss, ts, sp, tp);
    });
  });
}

// ---------------------------------------------------------------- Charge (core p.31–36)

export function maxChargeReach(s: GameState, r: RegimentState, t: RegimentState | null = null): number {
  const c = chargeDistanceRule(s, r, t);
  return c.fixed ?? marchValue(s, r) + 6 + c.bonus;
}

export function chargeProblems(s: GameState, r: RegimentState, t: RegimentState | undefined): string[] {
  if (!t || t.location !== 'table' || t.owner === r.owner) return ['Choose an enemy Regiment on the Battlefield.'];
  if (r.location !== 'table') return ['The Regiment is not on the Battlefield.'];
  if (r.arrivedRound === s.round) return ['A Regiment cannot Charge in the Round it arrives from Reinforcements (core p.31).'];
  if (r.broken) return ['Broken Regiments cannot Charge (core p.60).'];
  if (r.flags.reinforced) return ['Reinforce (the Pattern): it cannot Charge this Round (sk p.21).'];
  if (isEngaged(s, r)) return ['A Regiment in contact with an enemy cannot Charge (core p.24).'];
  if (!hasLineOfSight(s, r, t)) return [`${t.name} is not in the front arc and Line of Sight (core p.31).`];
  const d = distancePolys(regimentPolys(s, r), regimentPolys(s, t));
  if (d > maxChargeReach(s, r, t) + TOL) return [`${t.name} is ${d.toFixed(2)}″ away, beyond the maximum Charge of ${maxChargeReach(s, r, t)}″ (core p.31).`];
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
export interface ChargePlacement {
  pose: Pose | null;
  reason?: string;
  /** An unengaged enemy pushed up to 1″ directly away so contact can be made (core p.32). */
  push?: { id: string; pose: Pose };
  /** The target pivots instead of the charger (core p.32). */
  targetPose?: Pose;
}

export function chargePlacement(s: GameState, r: RegimentState, t: RegimentState, facing: Arc): ChargePlacement {
  const tfp = footprintOf(s, t);
  const e = facingEdge(tfp, facing);
  const edgeLen = dist(e.a, e.b);
  const dir = { x: (e.b.x - e.a.x) / edgeLen, y: (e.b.y - e.a.y) / edgeLen };
  const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
  const width = footprintOf(s, r).halfWidth * 2;
  const angle = Math.atan2(-e.n.y, -e.n.x);
  const limit = Math.abs(edgeLen - width) / 2;
  const t0 = Math.max(-limit, Math.min(limit, (r.pose.x - mid.x) * dir.x + (r.pose.y - mid.y) * dir.y));
  // Fully engaged positions first (nearest the charger's line), then partial overlaps of the
  // facing, keeping at least 1″ of front edge in contact.
  const reach = (edgeLen + width) / 2 - 1;
  const candidates: number[] = [];
  for (let off = -reach; off <= reach + 1e-9; off += 0.25) candidates.push(off);
  const overlapLen = (off: number) => Math.max(0, Math.min(off + width / 2, edgeLen / 2) - Math.max(off - width / 2, -edgeLen / 2));
  candidates.sort((a, b) => overlapLen(b) - overlapLen(a) || Math.abs(a - t0) - Math.abs(b - t0));
  const others = onTableRegiments(s).filter((o) => o.id !== r.id && o.id !== t.id);
  const flies = hasRule(r.rules, 'Fly') && !attachedCharacter(s, r.id);
  let blockedReason = 'no room to place the Regiment in contact';
  let pushOption: ChargePlacement | null = null;
  const pathClear = (to: Pose, ignore?: string) => {
    const da = normalizeAngle(to.angle - r.pose.angle);
    for (let i = 1; i < 40; i++) {
      const f = i / 40;
      const q: Pose = { x: r.pose.x + (to.x - r.pose.x) * f, y: r.pose.y + (to.y - r.pose.y) * f, angle: r.pose.angle + da * f };
      const qp = regimentPolys(s, r, { pose: q });
      if (others.some((o) => o.id !== ignore && (o.owner !== r.owner || isEngaged(s, o)) && anyOverlap(qp, regimentPolys(s, o)))) return false;
      if (terrainPathProblems(s, qp, flies).length) return false;
    }
    return true;
  };
  const why = new Map<string, number>();
  const note = (k: string) => why.set(k, (why.get(k) ?? 0) + 1);
  for (const off of candidates) {
    const P = add(mid, scale(dir, off));
    const pose: Pose = { x: P.x, y: P.y, angle };
    const polys = regimentPolys(s, r, { pose });
    if (!onTable(s, polys)) {
      note('the table edge');
      continue;
    }
    // Must actually engage the target.
    if (distancePolys(polys, regimentPolys(s, t)) > TOL) continue;
    if (anyOverlap(polys, regimentPolys(s, t))) continue;
    if (markerPolys(s).some((m) => polys.some((p) => overlaps(p, m)))) {
      note('an Objective Marker');
      continue;
    }
    if (terrainPositionProblems(s, polys).length) {
      note('Impassable terrain');
      continue;
    }
    const blockers = others.filter((o) => {
      const op = regimentPolys(s, o);
      return anyOverlap(polys, op) || (o.owner !== r.owner && distancePolys(polys, op) <= TOL);
    });
    for (const b of blockers) note(b.owner === r.owner ? b.name : `enemy ${b.name}`);
    if (blockers.length === 0) {
      if (!pathClear(pose)) {
        blockedReason = 'the path to the target is blocked';
        continue;
      }
      return { pose };
    }
    // Push a single unengaged enemy blocker up to 1″ directly away from the charger (core p.32).
    if (!pushOption && blockers.length === 1 && blockers[0]!.owner !== r.owner && !isEngaged(s, blockers[0]!)) {
      const bl = blockers[0]!;
      const bc = footprintOf(s, bl).c;
      const rc = footprintOf(s, r, { pose }).c;
      const away = { x: bc.x - rc.x, y: bc.y - rc.y };
      const len = Math.hypot(away.x, away.y) || 1;
      const bPose: Pose = { ...bl.pose, x: bl.pose.x + away.x / len, y: bl.pose.y + away.y / len };
      const bPolys = regimentPolys(s, bl, { pose: bPose });
      const okBlocker =
        onTable(s, bPolys) &&
        !anyOverlap(bPolys, polys) &&
        distancePolys(bPolys, polys) > TOL &&
        !onTableRegiments(s).some((o) => o.id !== bl.id && o.id !== r.id && anyOverlap(bPolys, regimentPolys(s, o)));
      if (okBlocker && pathClear(pose, bl.id)) pushOption = { pose, push: { id: bl.id, pose: bPose } };
    }
  }
  if (pushOption) return pushOption;
  // The charger cannot pivot flush: move it straight ahead to contact, then the (unengaged) target pivots (core p.32).
  // RULE-AMBIGUITY: AMB-11 — the target rotates about the contact point until its charged facing is flush.
  if (!isEngaged(s, t)) {
    const fwd = { x: Math.cos(r.pose.angle), y: Math.sin(r.pose.angle) };
    let lo = 0;
    let hi = distancePolys(regimentPolys(s, r), regimentPolys(s, t)) + 0.5;
    const atD = (d: number): Pose => ({ ...r.pose, x: r.pose.x + fwd.x * d, y: r.pose.y + fwd.y * d });
    if (distancePolys(regimentPolys(s, r, { pose: atD(hi) }), regimentPolys(s, t)) <= TOL) {
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (distancePolys(regimentPolys(s, r, { pose: atD(m) }), regimentPolys(s, t)) <= TOL) hi = m;
        else lo = m;
      }
      const pose = atD(hi);
      const rp = regimentPolys(s, r, { pose });
      // The charger's own end position must be legal too (core p.13): no overlap, Marker or Impassable terrain.
      const chargerOk = positionProblems(s, r, rp, { allowFriendOverlap: false, allowOffTable: false, enemyGap: false }).length === 0;
      if (chargerOk && !anyOverlap(rp, regimentPolys(s, t)) && pathClear(pose)) {
        const [, contact] = closestPair(rp, regimentPolys(s, t));
        // Target forward so its charged edge faces the charger.
        const want = facing === 'front' ? r.pose.angle + Math.PI : facing === 'rear' ? r.pose.angle : facing === 'left' ? r.pose.angle - Math.PI / 2 : r.pose.angle + Math.PI / 2;
        const turn = normalizeAngle(want - t.pose.angle);
        const c = Math.cos(turn);
        const si = Math.sin(turn);
        const dx = t.pose.x - contact.x;
        const dy = t.pose.y - contact.y;
        const tPose: Pose = { x: contact.x + dx * c - dy * si, y: contact.y + dx * si + dy * c, angle: t.pose.angle + turn };
        const tp = regimentPolys(s, t, { pose: tPose });
        const clash = onTableRegiments(s).some((o) => o.id !== t.id && o.id !== r.id && anyOverlap(tp, regimentPolys(s, o)));
        // The turned target must not end on an Objective Marker or Impassable terrain either (pack p.8, core p.87).
        const onMarker = markerPolys(s).some((m) => tp.some((q) => overlaps(q, m)));
        if (onTable(s, tp) && !clash && !onMarker && !terrainPositionProblems(s, tp).length && !anyOverlap(tp, rp) && distancePolys(tp, rp) <= 0.05) return { pose, targetPose: tPose };
      }
    }
  }
  const top = [...why.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  return { pose: null, reason: top.length ? `${blockedReason}: blocked by ${top.join(' and ')}` : blockedReason };
}

/** Impact Attacks after a successful Charge (core p.36, p.100). */
export function resolveImpact(ctx: Ctx, r: RegimentState, t: RegimentState, facing: Arc, opts: { resounding?: boolean } = {}): void {
  const s = ctx.s;
  // Loose Formation: the Regiment cannot inflict Impact Attacks (core p.99).
  if (hasRule(r.rules, 'Loose Formation')) return;
  // Reinforce (the Pattern) (sk p.21): the target suffers no Hits from Impact.
  if (t.flags.reinforced) return void ev(ctx, { type: 'note', text: `${t.name} is Reinforced: no Hits from Impact (sk p.21).`, regimentId: t.id });
  const pools: AttackPool[] = [];
  const blessed = takeBlessed(r);
  // Elemental Dominion, Court of Water (Raj Warlord, sk p.6): Water Elementals charging a flank or rear gain Impact (+2) and Terrifying (1).
  const rajWater = facing !== 'front' && elementalKind(r, 'Water') && isElemental(r) && warlordHas(s, r.owner, 'Elemental Dominion') && warlordCourts(s, r.owner).includes('Water') && ofCourt(s, r, 'Water');
  const impact = ruleX(r.rules, 'Impact') + (rajWater ? 2 : 0);
  // Glorious Charge: Impact Attacks at +1 Clash (core p.99).
  const glorious = hasRule(r.rules, 'Glorious Charge') ? 1 : 0;
  if (impact > 0) {
    const skill = stat(r, 'C') + glorious;
    // Hetairos (Officer, od p.31): re-roll failed Hit Rolls of 6 on Impact Attacks.
    // RULE-AMBIGUITY: AMB-50 — read literally: only natural 6s are re-rolled.
    const hetairos = [...r.commandModels, ...(r.options ?? [])].includes('Hetairos') && r.stands.some((x) => x.isCommand);
    const glim = takeGlimmers(s, r);
    pools.push({ label: `${r.name} Impact (${impact}) × ${r.stands.length}`, dice: impact * r.stands.length, skill, ...poolMods(r.rules, t, 'impact', facing, skill, { blessed }), extraWoundOnSix: !!opts.resounding, ...(hetairos ? { rerollSixes: true } : {}), ...(glim ? { convertFails: glim } : {}) });
  }
  const c = attachedCharacter(s, r.id);
  const ci = c ? ruleX(c.rules, 'Impact') : 0;
  if (c && ci > 0) {
    const skill = charStat(c, 'C') + glorious;
    pools.push({ label: `${c.name} Impact (${ci})`, dice: ci, skill, ...poolMods(c.rules, t, 'impact', facing, skill), extraWoundOnSix: !!opts.resounding });
  }
  if (!pools.length) return;
  resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: t.id, arc: facing, pools, morale: true, terrifying: rajWater ? Math.max(1, ruleX(r.rules, 'Terrifying')) : ruleX(r.rules, 'Terrifying'), what: `${r.name} Impact Attacks`, kind: 'impact' });
}

/** Blessed (core p.97): once per Round, re-roll failed Hit Rolls in a Clash or Charge (RULE-AMBIGUITY: AMB-37). */
export function takeBlessed(r: RegimentState): boolean {
  if (!hasRule(r.rules, 'Blessed') || r.flags.blessedUsed) return false;
  r.flags.blessedUsed = true;
  return true;
}

/**
 * Charge Distance (core p.31): die + lowest March. Juggernaut: always March + 5″, not modified
 * (core p.99). Phalanx: always March + 3″ (core p.100). Designate Target: +2″ against a Marked
 * enemy (Spires rule text).
 */
/**
 * How the Charge die is rolled: 2D6 keeping the highest (Master of the Legions, Endocrine
 * Overstimulation), and whether a failed Charge may be re-rolled (Unstoppable or a Standard Bearer,
 * core p.69, p.101; not against Induce Lethargy, sp p.16).
 */
export function chargeDice(s: GameState, r: RegimentState, t: RegimentState): { twoDice: boolean; lowest?: boolean; reroll: boolean } {
  const unstoppable = hasRule(r.rules, 'Unstoppable') || (r.commandModels.includes('Standard Bearer') && r.stands.some((x) => x.isCommand));
  const lethargy = !!attachedCharacter(s, t.id)?.options.some((o) => o.toLowerCase() === 'induce lethargy');
  // Broken Ground (dw p.27): no Charge Distance re-roll. Fear (dw p.28): 2D6, keep the lowest.
  return { twoDice: !!r.flags.charge2d6 || endocrine(s, r) || !!r.flags.fear, ...(r.flags.fear ? { lowest: true } : {}), reroll: unstoppable && !lethargy && !r.flags.brokenGround };
}

/** Endocrine Overstimulation (sp p.17): friendly Regiments within 8″ of that Character roll 2D6 for Charge Distance, keeping the highest. */
function endocrine(s: GameState, r: RegimentState): boolean {
  return Object.values(s.characters).some((c) => {
    if (c.destroyed || !c.attachedTo || !c.options.some((o) => o.toLowerCase() === 'endocrine overstimulation')) return false;
    const host = s.regiments[c.attachedTo];
    return !!host && host.owner === r.owner && host.location === 'table' && distancePolys(regimentPolys(s, host), regimentPolys(s, r)) <= 8 + TOL;
  });
}

export function chargeDistanceRule(s: GameState, r: RegimentState, t: RegimentState | null): { fixed: number | null; bonus: number } {
  const M = marchValue(s, r);
  // Induce Lethargy (sp p.16): no Unstoppable or Juggernaut when Charging that Character's Regiment.
  const lethargy = !!t && !!attachedCharacter(s, t.id)?.options.some((o) => o.toLowerCase() === 'induce lethargy');
  // Adrenal Hysteria (Onslaught Drones Strain, sp p.26): +2″ Charge Distance. Sorcerer Kings bonuses (sk p.34–40).
  const bonus = (t?.flags.marked ? 2 : 0) + xhiliarchChargeBonus(s, r) + (hasRule(r.rules, 'Adrenal Hysteria') ? 2 : 0) + skChargeBonus(s, r, t) + dwChargeBonus(r, t);
  // Fire Elemental (sk p.32–35): Juggernaut against an "Inflamed" enemy, and it may still add Charge Distance bonuses.
  const fire = !!t && isFireJuggernaut(r, t);
  if ((hasRule(r.rules, 'Juggernaut') || fire) && !lethargy && !r.flags.brokenGround) return { fixed: M + 5 + (fire || elementalKind(r, 'Fire') ? bonus : 0), bonus: 0 };
  if (hasRule(r.rules, 'Phalanx')) return { fixed: M + 3 + bonus, bonus };
  return { fixed: null, bonus };
}

/** Magmaforged Empowerment (dw p.41); Echoes of Dheureghodh: Dragonslayers +2″ against a Monster (dw p.29). */
function dwChargeBonus(r: RegimentState, t: RegimentState | null): number {
  return (r.flags.chargeBonus ?? 0) + (r.name === 'Dragonslayers' && t?.type === 'Monster' ? 2 : 0);
}

/** Fire Elemental (sk p.32–35): charging an "Inflamed" enemy gives Juggernaut. */
function isFireJuggernaut(r: RegimentState, t: RegimentState): boolean {
  return elementalKind(r, 'Fire') && !!t.flags.inflamed;
}

/** Arrogance, Hubris (sk p.34–35): +3″; Shattered Perfection (sk p.40): +2″. */
function skChargeBonus(s: GameState, r: RegimentState, t: RegimentState | null): number {
  const u = skUnit(r);
  if (!u || !s.players[r.owner].sk) return 0;
  let b = 0;
  if (t && u.chargeVs === 'character' && ((t.type === 'Monster' && !!t.embodies) || !!attachedCharacter(s, t.id))) b += 3;
  if (t && u.chargeVs === 'monster' && t.type === 'Monster') b += 3;
  if (u.shattered === 'perfection' && r.flags.shattered) b += 2;
  return b;
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
  const rule = chargeDistanceRule(s, r, t);
  const act = s.activation!;
  // Resounding Malevolence: a March immediately followed by this Charge.
  const resounding = hasRule(r.rules, 'Resounding Malevolence') && act.actions[act.actions.length - 1] === 'march';
  let die = 0;
  let total: number;
  const notes: string[] = [];
  /** The first roll, when a failed Charge Roll was re-rolled (Unstoppable, Standard Bearer). */
  let firstRoll: number | null = null;
  if (rule.fixed !== null) {
    total = rule.fixed;
    const fire = isFireJuggernaut(r, t);
    // Fire Elemental: Juggernaut until the end of the Round (sk p.32).
    if (fire && !hasRule(r.rules, 'Juggernaut')) r.roundRules.push({ name: 'Juggernaut', raw: 'Juggernaut' });
    notes.push(hasRule(r.rules, 'Juggernaut') || fire ? `Juggernaut: March + 5″${fire ? ' (Fire Elemental vs "Inflamed", sk p.32)' : ''} (core p.99)` : 'Phalanx: March + 3″ (core p.100)');
  } else {
    const dice = chargeDice(s, r, t);
    if (dice.twoDice) {
      // Master of the Legions (Strategos, od p.9): 2D6, keep the highest. Fear (dw p.28): keep the lowest.
      const [a, b] = rollN(ctx, 2) as [number, number];
      die = dice.lowest ? Math.min(a, b) : Math.max(a, b);
      notes.push(dice.lowest ? `2D6 keep lowest: ${a}, ${b} (Fear)` : `2D6 keep highest: ${a}, ${b} (${r.flags.charge2d6 ? 'Master of the Legions' : 'Endocrine Overstimulation'})`);
    } else [die] = rollN(ctx, 1) as [number];
    const xb = xhiliarchChargeBonus(s, r);
    if (xb) markOnce(s, r.owner, 'obdurate');
    notes.push(`Charge Distance = die + March ${M}${rule.bonus ? ` + ${rule.bonus} (${[t.flags.marked ? 'Marked' : '', xb ? 'Obdurate Bone and Stone' : ''].filter(Boolean).join(', ')})` : ''}; need ${d.toFixed(2)}″`);
    total = die + M + rule.bonus;
    if (total < d - TOL && dice.reroll) {
      const first = die;
      firstRoll = first;
      if (dice.twoDice) {
        // Fear (dw p.28): re-rolling a Charge re-rolls both dice.
        const [a, b] = rollN(ctx, 2) as [number, number];
        die = dice.lowest ? Math.min(a, b) : Math.max(a, b);
      } else [die] = rollN(ctx, 1) as [number];
      total = die + M + rule.bonus;
      notes.push(`${hasRule(r.rules, 'Unstoppable') ? 'Unstoppable' : 'Standard Bearer'} re-roll ${first}→${die} (core p.69, p.101)`);
    }
  }
  const success = total >= d - TOL;
  ev(ctx, {
    type: 'dice',
    text: `${r.name} charges ${t.name} (${facing}): ${rule.fixed !== null ? `fixed ${total}″` : `${firstRoll !== null ? `rolled ${firstRoll} (${firstRoll + M + rule.bonus}″, short), ${hasRule(r.rules, 'Unstoppable') ? 'Unstoppable' : 'Standard Bearer'} re-roll ${die}: ` : 'rolled '}${die} + ${M}${rule.bonus ? ` + ${rule.bonus}` : ''} = ${total}″`} against ${d.toFixed(2)}″ — ${success ? 'success' : 'failed'}.`,
    dice: { purpose: `${r.name}: Charge Roll`, seed: ctx.rng.seed, index: idx, values: rule.fixed !== null ? [] : firstRoll !== null ? [firstRoll, die] : [die], notes },
    player: r.owner,
    regimentId: r.id,
  });
  recordAction(act, 'charge');
  if (!success) {
    // Broken Ground (dw p.27): a failed Charge costs Wounds equal to the die, without Morale.
    if (r.flags.brokenGround && die > 0) {
      ev(ctx, { type: 'note', text: `Broken Ground: ${r.name} suffers ${die} Wounds from its failed Charge, no Morale (dw p.27).`, regimentId: r.id });
      allocateWounds(ctx, r, die, r.owner === 'P1' ? 'P2' : 'P1');
      if (r.location === 'destroyed') {
        recordAction(act, 'charge');
        act.ended = true;
        return;
      }
    }
    const move = failedChargeDistance(s, r, die || total - M);
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
  const hindered = chargeHindered(s, r, r.pose, place.pose);
  r.pose = place.pose;
  if (place.push) {
    const bl = s.regiments[place.push.id]!;
    bl.pose = place.push.pose;
    ev(ctx, { type: 'charge', text: `${bl.name} is pushed 1″ directly away so ${r.name} can complete its Charge (core p.32).`, regimentId: bl.id });
  }
  if (place.targetPose) {
    t.pose = place.targetPose;
    ev(ctx, { type: 'charge', text: `${r.name} cannot pivot flush, so ${t.name} pivots to meet the Charge (core p.32).`, regimentId: t.id });
  }
  completeCharge(ctx, r, t, facing as Arc, { resounding, hindered });
}

/** Did at least half the charger's Stands pass through Hindering terrain (core p.86)? */
export function chargeHindered(s: GameState, r: RegimentState, from: Pose, to: Pose): boolean {
  // Flowing Stride (sk p.19): ignores Hindering terrain.
  if (r.flags.flowingStride) return false;
  // Flame Wall (dw p.26): counts as within Hindering terrain.
  if (r.flags.flameWall) return true;
  const flies = hasRule(r.rules, 'Fly') && !attachedCharacter(s, r.id);
  return chargeThroughHindering(s, (pose) => regimentPolys(s, r, { pose }), from, to, flies);
}

/** After the charger is in contact: Impact Attacks and Inspired (core p.35–36). */
export function completeCharge(ctx: Ctx, r: RegimentState, t: RegimentState, facing: Arc, opts: { resounding?: boolean; hindered?: boolean } = {}): void {
  // Hindering (core p.86): no Impact Attacks, and Medium and Heavy Regiments lose Inspired this Round.
  const loseInspired = !!opts.hindered && r.cls !== 'Light';
  if (opts.hindered) r.flags.hindered = r.cls !== 'Light';
  ev(ctx, {
    type: 'charge',
    text: `${r.name} contacts ${t.name}'s ${facing}${loseInspired ? '' : ' and gains Inspired until the end of its Activation (core p.35)'}.${opts.hindered ? ` It charged through Hindering terrain: no Impact Attacks${loseInspired ? ' and no Inspired this Round' : ''} (core p.86).` : ''}`,
    player: r.owner,
    regimentId: r.id,
  });
  ctx.s.activation!.inspired = !loseInspired;
  // Ardent Creed (dw p.6): a successful Charge Awakens [Ardent] and [Clan] Regiments.
  dwOnCharge(ctx, r);
  // Fury: +1 Attacks until the end of the Round (core p.98). Shock: +1 Clash (core p.100).
  // Glorious Charge: Terrifying (1) until the end of the Round (core p.99).
  if (hasRule(r.rules, 'Fury')) r.roundMods.push({ stat: 'A', delta: 1, source: 'Fury' });
  if (hasRule(r.rules, 'Shock')) r.roundMods.push({ stat: 'C', delta: 1, source: 'Shock' });
  if (hasRule(r.rules, 'Glorious Charge') && !r.roundRules.some((x) => x.name === 'Terrifying')) r.roundRules.push({ name: 'Terrifying', x: 1, raw: 'Terrifying (1)' });
  // Wedge! / Sundering Charge (od p.28, p.31): Cleave (+1) until the end of the Round after a successful Charge.
  if ((hasRule(r.rules, 'Wedge!') || hasRule(r.rules, 'Wedge') || hasRule(r.rules, 'Sundering Charge')) && !r.roundRules.some((x) => x.raw === 'Cleave (+1) [Wedge]'))
    r.roundRules.push({ name: 'Cleave', x: 1, plus: true, raw: 'Cleave (+1) [Wedge]' });
  const engagedWith = [t.id];
  if (!opts.hindered) resolveImpact(ctx, r, t, facing, opts);
  pressTheAttack(ctx, r, engagedWith);
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

/**
 * Clash (core p.44–46). Each Engaged Stand attacks the enemy Regiment it is in contact with
 * (the chosen target if it touches several); Unengaged Stands support the chosen target
 * (core p.45). Each enemy is resolved as a separate pool, from Hits to Morale.
 */
export function applyClash(ctx: Ctx, r: RegimentState, t: RegimentState): void {
  const s = ctx.s;
  const enemies = enemiesInContact(s, r);
  const fps = new Map(enemies.map((e) => [e.id, rectPoly(footprintOf(s, e))]));
  const slots = layout(formationInput(s, r));
  // Inspired is not available to Broken Regiments, to a Regiment whose Character declined a Duel,
  // or against Dread (core p.60, p.76, p.97). Dauntless always counts as Inspired (core p.97).
  const dread = enemies.some((e) => hasRule(e.rules, 'Dread'));
  // Siphon Strength (sp p.15): never Inspired.
  const inspiredAllowed = !r.broken && !r.flags.declinedDuel && !dread && !r.flags.siphoned && !r.flags.hindered;
  const support = engagedFlankOrRear(s, r) && !hasRule(r.rules, 'Iron Discipline') ? 1 : ruleX(r.rules, 'Support') || 1;
  const leader = r.commandModels.includes('Leader');
  const c = attachedCharacter(s, r.id);
  const perTarget = new Map<string, { engaged: number; support: number; charAttacks: number; charEngaged: boolean }>();
  const bucket = (id: string) => perTarget.get(id) ?? (perTarget.set(id, { engaged: 0, support: 0, charAttacks: 0, charEngaged: false }), perTarget.get(id)!);
  for (const sl of slots) {
    const p = rectPoly(sl.rect);
    const touching = enemies.filter((e) => polyDistance(p, fps.get(e.id)!) <= TOL);
    const target = touching.find((e) => e.id === t.id) ?? touching[0] ?? t;
    const b = bucket(target.id);
    if (sl.isCharacter) {
      b.charAttacks += touching.length && c ? charStat(c, 'A') : 1;
      b.charEngaged = touching.length > 0;
    } else if (touching.length) b.engaged += stat(r, 'A') + (sl.isCommand && leader ? 1 : 0) + (sl.isCommand && r.flags.epigenetic ? 2 : 0); // Epigenetic Trigger (sp p.9)
    else b.support += support;
  }
  for (const [tid, b] of perTarget) {
    const target = s.regiments[tid]!;
    if (target.location !== 'table') continue;
    const arc = arcOfAttack(s, r, target);
    // The Inspired Special Rule (core p.99) counts too, e.g. from Dark Power Tier III or a banner.
    const inspired = ((!!s.activation?.inspired || hasRule(r.rules, 'Inspired') || hasRule(r.rules, 'Dauntless') || magnanimity(s, r, target)) && inspiredAllowed) || (hasRule(r.rules, 'Dauntless') && !dread);
    const C = stat(r, 'C');
    const ins = inspiredSkill(C, inspired);
    const blessed = takeBlessed(r);
    const pools: AttackPool[] = [
      {
        label: `${r.name} (${b.engaged} engaged + ${b.support} support)`,
        dice: b.engaged + b.support,
        skill: ins.skill,
        rerollSixes: ins.rerollSixes,
        ...poolMods(r.rules, target, 'clash', arc, ins.skill, { blessed }),
      },
    ];
    const glim = takeGlimmers(s, r);
    if (glim) pools[0]!.convertFails = glim;
    if (c && b.charAttacks) {
      const cins = inspiredSkill(charStat(c, 'C'), inspired);
      pools.push({ label: `${c.name} (${b.charEngaged ? 'engaged' : 'support'})`, dice: b.charAttacks, skill: cins.skill, rerollSixes: cins.rerollSixes, ...poolMods(c.rules, target, 'clash', arc, cins.skill) });
    }
    if (inspired) ev(ctx, { type: 'note', text: `${r.name} is Inspired: ${ins.rerollSixes ? 're-rolls natural 6s' : `Clash ${C}→${ins.skill}`} (core p.99).` });
    if (perTarget.size > 1) ev(ctx, { type: 'note', text: `${r.name} directs ${pools.reduce((a, p) => a + p.dice, 0)} Attacks at ${target.name} (core p.45).` });
    resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: target.id, arc, pools, morale: true, terrifying: ruleX(r.rules, 'Terrifying'), what: `${r.name} Clash`, kind: 'clash' });
    if (r.location === 'destroyed') break;
  }
  pressTheAttack(ctx, r, enemies.map((e) => e.id));
}

/**
 * Press the Attack (core p.61): after casualties, the active player pushes their Stranded
 * Regiment back into contact with the enemy it was fighting, by the shortest distance, keeping
 * its facing. If that cannot be done legally it stays put and is no longer engaged.
 */
export function pressTheAttack(ctx: Ctx, r: RegimentState, wereEngagedWith: string[]): void {
  const s = ctx.s;
  if (r.location !== 'table' || !wereEngagedWith.length) return;
  const still = wereEngagedWith.map((id) => s.regiments[id]).filter((e): e is RegimentState => !!e && e.location === 'table');
  if (!still.length) return;
  if (enemiesInContact(s, r).some((e) => wereEngagedWith.includes(e.id))) return;
  const target = still[0]!;
  const [a, b] = closestPair(regimentPolys(s, r), regimentPolys(s, target));
  const move = { x: b.x - a.x, y: b.y - a.y };
  const pose = { ...r.pose, x: r.pose.x + move.x, y: r.pose.y + move.y };
  const polys = regimentPolys(s, r, { pose });
  const others = onTableRegiments(s).filter((o) => o.id !== r.id);
  if (others.some((o) => anyOverlap(polys, regimentPolys(s, o))) || !onTable(s, polys)) {
    ev(ctx, { type: 'note', text: `${r.name} is Stranded and cannot be pushed back into contact (core p.61).` });
    return;
  }
  r.pose = pose;
  ev(ctx, { type: 'note', text: `Press the Attack: ${r.name} is pushed ${Math.hypot(move.x, move.y).toFixed(2)}″ back into contact with ${target.name} (core p.61).`, regimentId: r.id });
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
  effective?: boolean;
}

/** Arcs a Regiment may shoot into and see through (core p.14, p.38; Acute Senses p.97, Weapon Platform p.101, Fluid Formation p.98). */
export function shootingArcs(r: RegimentState): Arc[] {
  if (hasRule(r.rules, 'Acute Senses') || hasRule(r.rules, 'Fluid Formation')) return ['front', 'left', 'right', 'rear'];
  if (hasRule(r.rules, 'Weapon Platform')) return ['front', 'left', 'right'];
  return ['front'];
}

/** Works out each front-rank Stand's shots (core p.38–40). */
/**
 * Is this Regiment's Volley Aimed (core p.97)? Take Aim this Activation; Deadshots always; and the
 * Aimed Shot rule on a list entry, for its first Volley each Activation.
 */
export function volleyAimed(s: GameState, r: RegimentState, opts: { current?: boolean } = {}): boolean {
  const act = s.activation?.regimentId === r.id ? s.activation : null;
  if (r.flags.siphoned) return false; // Siphon Strength (sp p.15)
  if (act?.aimed || hasRule(r.rules, 'Deadshots')) return true;
  // `current`: the Volley being resolved has already been recorded as an Action.
  const earlier = (act?.actions.filter((k) => k === 'volley').length ?? 0) - (opts.current ? 1 : 0);
  return hasRule(r.rules, 'Aimed Shot') && earlier <= 0;
}

export function planVolley(s: GameState, r: RegimentState, t: RegimentState, aimed: boolean): { plans: VolleyStandPlan[]; problems: string[] } {
  const problems: string[] = [];
  if (r.location !== 'table' || t.location !== 'table') problems.push('Both Regiments must be on the Battlefield.');
  if (t.owner === r.owner) problems.push('Choose an enemy Regiment.');
  // Eye of the Storm, Mahut (sk p.39, p.42): may Volley in contact, at the enemy in contact.
  const inContact = isEngaged(s, r) ? volleyInContact(s, r, t) : 'no';
  if (isEngaged(s, r) && inContact !== 'ok') problems.push(inContact === 'wrong' ? 'In contact, it must Volley at the enemy it is in contact with (sk p.39, p.42).' : 'An engaged Regiment cannot Volley (core p.38).');
  const fp = footprintOf(s, r);
  const tfp = footprintOf(s, t);
  const tPolys = regimentPolys(s, t);
  const arcs = shootingArcs(r);
  if (!tPolys.some((p) => arcsOf(fp, p).some((a) => arcs.includes(a)))) problems.push(`${t.name} is not in the front arc (core p.38).`);
  const obs = obstacles(s, [r.id, t.id]);
  const c = attachedCharacter(s, r.id);
  const plans: VolleyStandPlan[] = [];
  // Marid Sahar (sk p.44): with 4 or fewer Stands, every Stand Volleys regardless of rank.
  const allRanks = r.name === 'Marid Sahar' && !!s.players[r.owner].sk && r.stands.length <= 4;
  const front = layout(formationInput(s, r)).filter((x) => x.rank === 0 || allRanks);
  // Longshot: Effective Range equals the full Barrage range (core p.99).
  const longshot = hasRule(r.rules, 'Longshot');
  // Loose Formation (target): each Stand's Barrage X is halved, rounding up (core p.99).
  // Hypersynaptic Bonding (Vanguard Clone Infiltrators Strain, sp p.28): the target loses Loose Formation.
  const loose = hasRule(t.rules, 'Loose Formation') && !hasRule(r.rules, 'Hypersynaptic Bonding');
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
    const sp = rectPoly(sl.rect);
    const ss = standLosSize(s, r, sp);
    const clearTo = tPolys.find((tp) => {
      const to = closestPointOnPoly(from, tp);
      const ts = standLosSize(s, t, tp);
      return !volleyLineObstructed(from, to, ss, ts, obs) && !terrainBlocks(s, from, to, ss, ts, sp, tp);
    });
    const clear = !!clearTo;
    if (!clear) {
      plans.push({ label, shots: 0, arc: null, reason: 'Obstructed (core p.38)', skill: vAimed, ap, deadly });
      continue;
    }
    let shots = b.shots + (sl.isCommand && r.commandModels.includes('Leader') ? 1 : 0);
    // Effective Range: closer than half range gives +1 (core p.39). RULE-AMBIGUITY: AMB-09.
    const effective = longshot || bestD < b.range / 2;
    if (effective) shots += 1;
    // Cover (core p.86) halves Barrage like Loose Formation; the two do not stack (core p.99).
    // Hypersynaptic Bonding ignores Cover too (sp p.28).
    // Gifted Mortals, Court of Water (Mahabharati Initiates, sk p.27): within 3″ of Water terrain, all its Stands count as in Cover.
    const tidal = t.name === 'Mahabharati Initiates' && !!s.players[t.owner].sk && ofCourt(s, t, 'Water') && within(s, t, waterPieces(s), 3) ? 'Water, Gifted Mortals' : null;
    const cover = hasRule(r.rules, 'Hypersynaptic Bonding') ? null : tidal ?? coverHalves(s, from, closestPointOnPoly(from, clearTo!), regimentPolys(s, r), tPolys, t.type);
    if (loose || cover) shots = Math.ceil(shots / 2);
    const arc = majorityArc(tfp, rectPoly(sl.rect)) ?? 'front';
    plans.push({ label: `${label}${effective ? ' (Effective Range +1)' : ''}${loose ? ' (Loose Formation: halved)' : cover ? ` (Cover, ${cover}: halved)` : ''}`, shots, arc, skill: vAimed, ap, deadly, effective });
  }
  if (!plans.some((p) => p.shots > 0) && !problems.length) problems.push('No Stand can shoot at that Regiment (range or obstruction).');
  return { plans, problems };
}

export function applyVolley(ctx: Ctx, r: RegimentState, t: RegimentState): void {
  const s = ctx.s;
  const act = s.activation;
  const aimed = volleyAimed(s, r, { current: true }) || magnanimity(s, r, t);
  // Reprocessing Agents: the target suffers −1 Defense as soon as it is targeted.
  if (hasRule(r.rules, 'Reprocessing Agents')) reprocess(ctx, t);
  const { plans } = planVolley(s, r, t, aimed);
  const byArc = new Map<Arc, VolleyStandPlan[]>();
  for (const p of plans) if (p.shots > 0 && p.arc) byArc.set(p.arc, [...(byArc.get(p.arc) ?? []), p]);
  for (const p of plans) if (p.shots === 0) ev(ctx, { type: 'note', text: `${p.label}: no shots (${p.reason}).` });
  // Murderous Volley: after Take Aim, Wounds to targets within 12″ cause Morale Tests (core p.95).
  const murderous = hasRule(r.rules, 'Murderous Volley') && !!act?.actions.includes('takeAim') && distancePolys(regimentPolys(s, r), regimentPolys(s, t)) <= 12 + TOL;
  let ones = 0;
  // Stands in different arcs are resolved separately but simultaneously (core p.40).
  for (const [arc, ps] of byArc) {
    // Stands with identical profiles share one pool of dice (same Hit and Defense rolls).
    const pools: AttackPool[] = [];
    for (const p of ps) {
      const mods = poolMods(r.rules, t, 'volley', arc, p.skill, { effectiveRange: !!p.effective });
      const same = pools.find((q) => q.skill === p.skill && q.reduceD === p.ap && q.deadly6 === p.deadly && q.torrential === mods.torrential);
      if (same) {
        same.dice += p.shots;
        same.label += ` + ${p.shots}`;
      } else
        pools.push({ label: `${r.name} Volley → ${arc} (${p.shots}`, dice: p.shots, skill: p.skill, rerollSixes: aimed && p.skill >= 5, ...mods, reduceD: p.ap, deadly6: p.deadly, ...(hasRule(r.rules, 'Hypercatalytic Discharge') ? { noEvasion: true } : {}) });
    }
    for (const q of pools) q.label += ' shots)';
    const res = resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: t.id, arc, pools, morale: murderous, terrifying: 0, what: `${r.name} Volley`, kind: 'volley' });
    ones += res.naturalOnes;
    // Battery (Found, dw p.40): Wounds from its Volley give the target −1 March this Round.
    if (res.wounds > 0 && hasRule(r.rules, 'Battery') && !t.flags.battered && s.regiments[t.id]!.location === 'table') {
      t.flags.battered = true;
      ev(ctx, { type: 'note', text: `Battery: ${t.name} has −1 March until the end of the Round (dw p.40).`, regimentId: t.id });
    }
    if (s.regiments[t.id]!.location === 'destroyed') break;
  }
  // Visceral Bombardment: each natural 1 is a Hit on every other enemy within 3″ of the target (no Morale).
  if (ones && hasRule(r.rules, 'Visceral Bombardment')) {
    const tp = regimentPolys(s, t);
    const ap = Math.max(0, ...plans.map((p) => p.ap));
    for (const e of onTableRegiments(s).filter((x) => x.owner === t.owner && x.id !== t.id && distancePolys(regimentPolys(s, x), tp) <= 3 + TOL)) {
      resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: e.id, arc: 'front', pools: [{ label: 'Visceral Bombardment', dice: 0, skill: 0, autoHits: ones, reduceD: ap }], morale: false, terrifying: 0, what: 'Visceral Bombardment', kind: 'special' });
    }
  }
}

// ---------------------------------------------------------------- Withdraw, Combat Reform, Rally (core p.36, p.47–51)

/** Fearsome (core p.98): enemies in contact must pass a test before Combat Rally / Combat Reform. */
export function fearsomeCheck(ctx: Ctx, r: RegimentState, what: string): boolean {
  if (hasRule(r.rules, 'Fearless')) return true;
  if (autoPassesResolve(r)) return true; // Animate Vessel (od p.5)
  const scary = enemiesInContact(ctx.s, r).filter((e) => hasRule(e.rules, 'Fearsome'));
  if (!scary.length) return true;
  const R = highestR(ctx, r);
  const t = rollTest(ctx, 1, { target: R }, `${r.name}: Fearsome test`);
  const okRoll = t.passes === 1;
  ev(ctx, { type: 'dice', text: `${r.name} faces Fearsome ${scary[0]!.name}: rolled ${t.values[0]} against ${R} — ${okRoll ? `may ${what}` : `${what} fails and is lost`} (core p.98).`, dice: t.record, player: r.owner });
  return okRoll;
}

export function withdrawPose(s: GameState, r: RegimentState, moves: MoveSeg[], turn = true): Pose {
  // Reform facing away from the enemy: turn about the centre so the old rear becomes the front
  // (core p.51; RULE-AMBIGUITY: AMB-32 — "away" is taken as directly away from the current facing).
  const fp = footprintOf(s, r);
  const { forward } = poseFrame(r.pose);
  const depth = fp.halfDepth * 2;
  // Swift Retreat (Spires): may choose not to turn away.
  const front: Pose = turn ? { x: r.pose.x - forward.x * depth, y: r.pose.y - forward.y * depth, angle: r.pose.angle + Math.PI } : r.pose;
  return applyPath(front, moves, fp.halfWidth * 2);
}

export function withdrawProblems(s: GameState, r: RegimentState, moves: MoveSeg[]): string[] {
  if (!isEngaged(s, r)) return ['Only a Regiment in contact with an enemy can Withdraw (core p.50).'];
  if (r.cls === 'Heavy') return ['Only Light or Medium Regiments can Withdraw (core p.50).'];
  if (moves.some((m) => m.kind === 'sideways' || m.kind === 'backward')) return ['After turning to face away, the Withdraw March is forward, with Wheels if needed.'];
  return [];
}

export function applyWithdraw(ctx: Ctx, r: RegimentState, moves: MoveSeg[], turnIn = true): void {
  const turn = turnIn || !hasRule(r.rules, 'Swift Retreat');
  const s = ctx.s;
  const R = highestR(ctx, r);
  // Animate Vessel (od p.5) always passes; no die is rolled.
  // Swift Retreat (Spires rule text): always a Clean Withdrawal, so no die is rolled either.
  const swift = hasRule(r.rules, 'Swift Retreat');
  const auto = autoPassesResolve(r) || swift;
  const t = auto ? { passes: 1, values: ['auto'] } : rollTest(ctx, 1, { target: R }, `${r.name}: Withdraw`);
  const clean = t.passes === 1;
  const contacts = layout(formationInput(s, r)).filter((sl) => !sl.isCharacter && enemiesInContact(s, r).some((e) => distancePolys([rectPoly(sl.rect)], regimentPolys(s, e)) <= TOL)).length;
  const idx = ctx.rng.index;
  const [d] = rollN(ctx, 1) as [number];
  const wounds = clean ? d : d * contacts;
  ev(ctx, {
    type: 'dice',
    text: `${r.name} Withdraws: ${swift ? 'Swift Retreat makes it a Clean Withdrawal (no roll)' : auto ? 'Animate Vessel passes automatically' : `rolled ${t.values[0]} against ${R}`} — ${clean ? `Clean Withdrawal, which still suffers D6 = ${d} Wounds, no Morale` : `Fighting Withdrawal, suffers ${d} × ${contacts} Stands in contact = ${wounds} Wounds`} (core p.51).`,
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
  const pose = withdrawPose(s, r, moves, turn);
  const width = footprintOf(s, r).halfWidth * 2;
  const path = samplePath(withdrawPose(s, r, [], turn), moves, width);
  const polys = regimentPolys(s, r, { pose });
  const problems = positionProblems(s, r, polys, { allowFriendOverlap: false, allowOffTable: false });
  const through = path.slice(1).some((p) => onTableRegiments(s).some((o) => o.owner !== r.owner && anyOverlap(regimentPolys(s, r, { pose: p }), regimentPolys(s, o))));
  if (problems.length || through) {
    ev(ctx, { type: 'withdraw', text: `${r.name} cannot complete its Withdraw March (${problems[0] ?? 'blocked by an enemy'}): it stays where it was and the Withdraw fails (core p.51).`, player: r.owner, regimentId: r.id });
    return;
  }
  r.pose = pose;
  ev(ctx, { type: 'withdraw', text: `${r.name} ${turn ? 'turns away and marches off' : 'marches off without turning (Swift Retreat)'}.`, player: r.owner, regimentId: r.id });
}

export function applyCombatReform(ctx: Ctx, r: RegimentState, files: number): void {
  const s = ctx.s;
  if (!fearsomeCheck(ctx, r, 'Combat Reform')) return;
  const R = highestR(ctx, r);
  const auto = autoPassesResolve(r); // Animate Vessel (od p.5)
  const t = auto ? null : rollTest(ctx, 1, { target: R }, `${r.name}: Combat Reform`);
  const clean = !t || t.passes === 1;
  const before = countInContact(s, r);
  if (!clean) {
    const enemy = enemiesInContact(s, r)[0];
    const by: PlayerId = enemy?.owner ?? other(r.owner);
    ev(ctx, { type: 'dice', text: `${r.name} makes a Fighting Reform (rolled ${t!.values[0]} against ${R}): 1 Wound per Stand in contact = ${before} (core p.48).`, dice: t!.record, player: r.owner });
    allocateWounds(ctx, r, before, by);
    if (r.location !== 'destroyed') moraleTest(ctx, r, before, { arc: 'front', terrifying: 0, attackerOwner: by });
    if (r.location === 'destroyed') return;
  } else if (!t) ev(ctx, { type: 'note', text: `${r.name} makes a Clean Reform (Animate Vessel always passes, od p.5).`, player: r.owner });
  else ev(ctx, { type: 'dice', text: `${r.name} makes a Clean Reform (rolled ${t.values[0]} against ${R}, core p.48).`, dice: t.record, player: r.owner });
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

/**
 * One side of a Duel (core p.76): Attacks at Clash against the other Character's Defense or
 * Evasion. Characters use their own rules: Flurry (unless the target has Parry), Cleave less
 * Hardened, Shield in any arc (core p.100), Linebreaker, Smite, Flawless Strikes, Deadly Blades,
 * Relentless Blows; the defender's Untouchable, Tenacious and Counter-Attack (core p.97, p.101).
 * RULE-AMBIGUITY: AMB-12 — each Wound then needs a Resolve roll; Oblivious halves those Wounds.
 * Returns [wounds to the defender, wounds to the attacker from Counter-Attack].
 */
function duelAttack(ctx: Ctx, a: CharacterState, d: CharacterState): [number, number] {
  const C = charStat(a, 'C');
  const reroll = hasRule(a.rules, 'Flurry') && !hasRule(d.rules, 'Parry');
  const hit = rollTest(ctx, charStat(a, 'A'), { target: C, rerollFailed: reroll }, `${a.name}: Duel to hit`);
  let hits = hit.passes;
  const ones = hit.values.filter((v) => v === 1).length;
  if (C >= 6) hits += ones;
  const counter = hasRule(d.rules, 'Counter-Attack') ? hit.values.filter((v) => v === 6).length : 0;
  ev(ctx, { type: 'dice', text: `${a.name} attacks ${d.name}: ${hits} Hit${hits === 1 ? '' : 's'}.`, dice: hit.record });
  let w = 0;
  if (hits) {
    const shield = hasRule(d.rules, 'Shield') && !hasRule(a.rules, 'Linebreaker') ? 1 : 0;
    const reduce = Math.max(0, ruleX(a.rules, 'Cleave') - ruleX(d.rules, 'Hardened'));
    const dEff = hasRule(a.rules, 'Smite') ? 0 : Math.max(0, charStat(d, 'D') + shield - reduce);
    const E = charStat(d, 'E');
    const onesHits = hasRule(a.rules, 'Flawless Strikes') ? Math.min(ones, hits) : 0;
    const roll = (n: number, t: number) => {
      if (n <= 0) return;
      const def = rollTest(ctx, n, { target: t, defense: true }, `${d.name}: Duel Defense`);
      const passed = [...def.passed];
      if (hasRule(d.rules, 'Untouchable')) {
        def.values.forEach((v, i) => {
          if (v === 6 && !passed[i]) passed[i] = rollTest(ctx, 1, { target: t, defense: true }, `${d.name}: Untouchable`).passes === 1;
        });
      }
      let ten = ruleX(d.rules, 'Tenacious');
      for (let i = 0; i < passed.length && ten > 0; i++)
        if (!passed[i]) {
          passed[i] = true;
          ten--;
        }
      passed.forEach((p, i) => {
        if (!p) w += hasRule(a.rules, 'Deadly Blades') && def.values[i] === 6 ? 2 : 1;
      });
      ev(ctx, { type: 'dice', text: `${d.name} saves on ${t} or less.`, dice: def.record });
    };
    roll(hits - onesHits, Math.max(dEff, E));
    roll(onesHits, E);
  }
  if (w > 0) {
    const m = rollTest(ctx, w, { target: charStat(d, 'R') }, `${d.name}: Duel Resolve`);
    let extra = w - m.passes;
    if (hasRule(d.rules, 'Oblivious')) extra = Math.ceil(extra / 2);
    if (extra) ev(ctx, { type: 'dice', text: `${d.name} fails Resolve: +${extra} Wound${extra > 1 ? 's' : ''}.`, dice: m.record });
    w += extra;
  }
  ev(ctx, { type: 'duel', text: `${d.name} suffers ${w} Wound${w === 1 ? '' : 's'} in the Duel.` });
  return [w, counter];
}

export function applyDuel(ctx: Ctx, c: CharacterState, target: CharacterState, acceptIn: boolean): void {
  const s = ctx.s;
  // Tempered Goad, Dismay (dw p.22, p.28): the Duel cannot be declined.
  const accept = acceptIn || dwMustAccept(s, c, target);
  if (!acceptIn && accept) ev(ctx, { type: 'duel', text: `${target.name} cannot decline the Duel (dw p.22, p.28).` });
  const targetReg = target.attachedTo;
  if (!accept) {
    const tr = s.regiments[target.attachedTo!]!;
    // To the End (dw p.10–14): the challenger's Regiment Awakens; Refined Beyond Nature: no penalty.
    if (dwOnDecline(ctx, c, target)) {
      ev(ctx, { type: 'duel', text: `${target.name} declines the Duel; Refined Beyond Nature: ${tr.name} suffers no penalty (dw p.18).` });
      return;
    }
    if (tr.broken) {
      ev(ctx, { type: 'duel', text: `${target.name} cannot decline: its Regiment is Broken (core p.60). The Duel is fought.` });
    } else {
      if (hasRule(tr.rules, 'Bodyguards')) {
        ev(ctx, { type: 'duel', text: `${target.name} declines the Duel; ${tr.name} has Bodyguards and suffers no penalty (core p.97).` });
        return;
      }
      tr.flags.declinedDuel = true;
      ev(ctx, { type: 'duel', text: `${target.name} declines the Duel: until the end of the Round ${tr.name} cannot Seize, uses its lowest Resolve and cannot be Inspired (core p.76).` });
      return;
    }
  }
  ev(ctx, { type: 'duel', text: `${c.name} duels ${target.name} (core p.76).` });
  const ownerOf = (x: CharacterState) => s.regiments[x.attachedTo!]!.owner;
  const apply = (ch: CharacterState, w: number, by: CharacterState) => {
    if (!w || ch.destroyed) return;
    ch.wounds += w;
    if (ch.wounds >= charStat(ch, 'W')) {
      const reg = ch.attachedTo;
      killCharacter(ctx, ch, ownerOf(by), 'in a Duel');
      ch.attachedTo = null;
      if (reg) ev(ctx, { type: 'note', text: `${s.regiments[reg]!.name} closes the gap with a free Combat Reform (core p.76).` });
    }
  };
  // Quicksilver Strike: a Character with it strikes first; if both have it, simultaneously (core p.100).
  const qsC = hasRule(c.rules, 'Quicksilver Strike');
  const qsT = hasRule(target.rules, 'Quicksilver Strike');
  if (qsC !== qsT) {
    const [first, second] = qsC ? [c, target] : [target, c];
    const [w1, back1] = duelAttack(ctx, first, second);
    apply(second, w1, first);
    apply(first, back1, second);
    if (!second.destroyed && !first.destroyed) {
      const [w2, back2] = duelAttack(ctx, second, first);
      apply(first, w2, second);
      apply(second, back2, first);
    }
    dwAfterDuel(ctx, c, target, targetReg);
    return;
  }
  const exchange = () => {
    const [toTarget, backToC] = duelAttack(ctx, c, target);
    const [toChallenger, backToT] = duelAttack(ctx, target, c);
    apply(target, toTarget + backToT, c);
    apply(c, toChallenger + backToC, target);
  };
  exchange();
  // To the End (dw p.10–14): keep Duelling until a Character is destroyed (at most 20 exchanges).
  for (let i = 0; i < 20 && toTheEnd(c) && s.players[s.regiments[c.attachedTo ?? targetReg!]?.owner ?? 'P1'].dw && !c.destroyed && !target.destroyed; i++) {
    ev(ctx, { type: 'duel', text: `To the End: ${c.name} and ${target.name} fight on (dw p.10).` });
    exchange();
  }
  dwAfterDuel(ctx, c, target, targetReg);
}

export interface VolleyLine {
  a: Vec;
  b: Vec;
  kind: 'range' | 'halfrange' | 'clear' | 'long' | 'blocked';
  label?: string;
}

/**
 * Lines for previewing a Volley (core p.38–39): from the centre of each front-rank Stand's front
 * edge, its Barrage range straight ahead (with Effective Range marked), and a line to the closest
 * point of each enemy in range: clear within Effective Range, clear beyond it, or Obstructed.
 */
export function volleyLines(s: GameState, r: RegimentState): VolleyLine[] {
  const out: VolleyLine[] = [];
  const c = attachedCharacter(s, r.id);
  const fp = footprintOf(s, r);
  const enemies = onTableRegiments(s).filter((e) => e.owner !== r.owner);
  const obs = obstacles(s, [r.id]);
  for (const sl of layout(formationInput(s, r)).filter((x) => x.rank === 0)) {
    const b = barrageOf(sl.isCharacter && c ? c.rules : r.rules);
    if (!b) continue;
    const from = frontCentre(sl.rect);
    const { forward } = poseFrame({ x: 0, y: 0, angle: r.pose.angle });
    out.push({ a: from, b: add(from, scale(forward, b.range)), kind: 'range', label: `${b.range}″` });
    out.push({ a: add(from, scale(forward, b.range / 2 - 0.15)), b: add(from, scale(forward, b.range / 2 + 0.15)), kind: 'halfrange' });
    for (const e of enemies) {
      const polys = regimentPolys(s, e);
      if (!polys.some((p) => arcsOf(fp, p).includes('front'))) continue;
      let best: Vec | null = null;
      let bd = Infinity;
      for (const p of polys) {
        const q = closestPointOnPoly(from, p);
        const d = dist(from, q);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      if (!best || bd > b.range + TOL) continue;
      const sp = rectPoly(sl.rect);
      const ss = standLosSize(s, r, sp);
      const tp = polys.find((p) => dist(closestPointOnPoly(from, p), best!) < 1e-6) ?? polys[0]!;
      const ts = standLosSize(s, e, tp);
      const blocked = volleyLineObstructed(from, best, ss, ts, obs.filter((o) => !polys.includes(o.poly))) || terrainBlocks(s, from, best, ss, ts, sp, tp);
      out.push({ a: from, b: best, kind: blocked ? 'blocked' : bd < b.range / 2 ? 'clear' : 'long', label: `${bd.toFixed(1)}″` });
    }
  }
  return out;
}
