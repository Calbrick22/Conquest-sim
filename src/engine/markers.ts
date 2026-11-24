import { recordAction } from './activation';
import { arcsOf } from './geometry/arcs';
import { mmToInches, OBJECTIVE_MARKER_BASE_MM } from './geometry/bases';
import { polyDistance, rectPoly, type Poly } from './geometry/polygon';
import { dist, TOL } from './geometry/vec';
import { layout } from './formation';
import { ev, rollTest, type Ctx } from './dice';
import { stat, charStat, type AttackPool } from './combat';
import type { GameState, PlayerId, RegimentState } from './model/types';
import { attachedCharacter, distancePolys, formationInput, isEngaged, marchValue, other, regimentPolys } from './queries';
import { barrageOf, flatRules, hasRule, ruleX } from './rules/special/rules';
import { chargePlacement, closestPointOnPoly, footprintOf, frontCentre, hasLineOfSight } from './actions';
import { rollN } from './dice';
import { applyPath } from './movement';
import { failedChargeDistance } from './actions';

/**
 * Objective Markers (pack p.8–9): Size 2 models on a Brute/Cavalry base, enemy entities that can
 * be Charged, Clashed and (within Effective Range) Volleyed from Round 2. 3 Wounds, Defense 3,
 * no Resolve. At most 1 Wound per Volley/Spell/other effect, 1 per Clash or Charge from Light and
 * Medium Regiments, 2 from Heavy. Damage is tracked per player; one player must deal all 3.
 * RULE-AMBIGUITY: AMB-34 — contact with a Marker does not count as being Engaged for the choice of
 * Actions, so a Regiment can March away from a Marker without Withdrawing.
 */
export const MARKER_PREFIX = 'marker:';

export function isMarkerTarget(id: string): boolean {
  return id.startsWith(MARKER_PREFIX);
}

export function markerId(targetId: string): string {
  return targetId.slice(MARKER_PREFIX.length);
}

export function markerPoly(s: GameState, id: string): Poly {
  const m = s.scenario.markers.find((x) => x.id === id)!;
  const side = mmToInches(OBJECTIVE_MARKER_BASE_MM.widthMm);
  return rectPoly({ c: { x: m.x, y: m.y }, halfWidth: side / 2, halfDepth: side / 2, angle: Math.PI / 2 });
}

export function markerAttackProblems(s: GameState, player: PlayerId, id: string): string[] {
  const m = s.scenario.markers.find((x) => x.id === id);
  const st = s.markers[id];
  if (!m || !st) return ['Unknown Objective Marker.'];
  if (st.destroyed) return ['That Objective Marker is destroyed.'];
  if (m.friendlyTo === player) return ['You cannot attack your own (friendly) Objective Marker (pack p.8).'];
  if (s.round < s.scenario.objectivesFromRound) return [`Objective Markers can be attacked from Round ${s.scenario.objectivesFromRound} (pack p.9).`];
  return [];
}

/**
 * A stand-in Regiment for a Marker, facing the attacker, so the Charge and Line of Sight code can
 * treat it like a one-Stand Brute Regiment (pack p.8: Brute/Cavalry base, Size 2).
 */
export function virtualMarker(s: GameState, id: string, attacker: RegimentState): RegimentState {
  const m = s.scenario.markers.find((x) => x.id === id)!;
  const side = mmToInches(OBJECTIVE_MARKER_BASE_MM.widthMm);
  const ac = footprintOf(s, attacker).c;
  const angle = Math.atan2(ac.y - m.y, ac.x - m.x);
  // Snap the facing to the nearest 90° so the virtual base matches the square Marker base.
  const snapped = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  return {
    id: `${MARKER_PREFIX}${id}`,
    owner: other(attacker.owner),
    name: `Objective Marker ${m.label ?? id}`,
    type: 'Brute',
    cls: 'Medium',
    profile: { M: 0, V: 0, C: 0, A: 0, W: 3, R: 0, D: 3, E: 0 },
    rules: [],
    baseRules: [],
    roundRules: [],
    drawEvents: [],
    baseDrawEvents: [],
    commandModels: [],
    roles: [],
    warband: -1,
    stands: [{ id: `${id}-s`, wounds: 0, isCommand: false }],
    startingStands: 1,
    files: 1,
    pose: { x: m.x + Math.cos(snapped) * (side / 2), y: m.y + Math.sin(snapped) * (side / 2), angle: snapped },
    location: 'table',
    broken: false,
    activatedThisRound: true,
    arrivedRound: 0,
    standsAtRoundStart: 1,
    standsWhenBroken: null,
    roundMods: [],
    flags: {},
  };
}

function woundCap(r: RegimentState, kind: 'volley' | 'melee'): number {
  if (kind === 'volley') return 1;
  return r.cls === 'Heavy' ? 2 : 1;
}

/** Rolls the attack pools against a Marker (D3, E0) and applies capped Wounds (pack p.9). */
export function attackMarker(ctx: Ctx, r: RegimentState, id: string, pools: AttackPool[], kind: 'volley' | 'melee', what: string): void {
  const s = ctx.s;
  let wounds = 0;
  for (const pool of pools) {
    if (pool.dice <= 0) continue;
    const hit = rollTest(ctx, pool.dice, { target: pool.skill, rerollFailed: !!pool.rerollFailed, rerollSixes: !!pool.rerollSixes }, `${what}: to hit`);
    let hits = hit.passes;
    if (pool.extraOnOne) hits += hit.values.filter((v) => v === 1).length;
    ev(ctx, { type: 'dice', text: `${pool.label}: ${pool.dice} dice needing ${pool.skill} or less → ${hits} Hit${hits === 1 ? '' : 's'}.`, dice: hit.record, player: r.owner });
    if (!hits) continue;
    const save = Math.max(0, 3 - (pool.reduceD ?? 0));
    const def = rollTest(ctx, hits, { target: save, defense: true }, `Objective Marker ${id}: Defense`);
    let w = 0;
    def.values.forEach((v, i) => {
      if (!def.passed[i]) w += pool.deadly6 && v === 6 ? 2 : 1;
    });
    ev(ctx, { type: 'dice', text: `Objective Marker ${id} saves on ${save} or less: ${w} Wound${w === 1 ? '' : 's'} (pack p.9).`, dice: def.record });
    wounds += w;
  }
  const cap = woundCap(r, kind);
  const applied = Math.min(wounds, cap);
  const st = s.markers[id]!;
  st.woundsBy[r.owner] += applied;
  ev(ctx, {
    type: 'marker',
    player: r.owner,
    text: `Objective Marker ${id} suffers ${applied} Wound${applied === 1 ? '' : 's'} from ${r.owner}${wounds > applied ? ` (capped at ${cap}, pack p.9)` : ''}: ${st.woundsBy[r.owner]}/3 by ${r.owner}.`,
  });
  if (st.woundsBy[r.owner] >= 3 && !st.destroyed) {
    st.destroyed = true;
    s.tally.markersDestroyed[r.owner].push(id);
    ev(ctx, { type: 'marker', player: r.owner, text: `${r.owner} destroys Objective Marker ${id}.` });
  }
}

// ---------------------------------------------------------------- Charge, Clash and Volley at Markers

export function markerChargeProblems(s: GameState, r: RegimentState, id: string): string[] {
  const p = markerAttackProblems(s, r.owner, id);
  if (p.length) return p;
  if (r.arrivedRound === s.round) return ['A Regiment cannot Charge in the Round it arrives from Reinforcements (core p.31).'];
  if (r.broken) return ['Broken Regiments cannot Charge (core p.60).'];
  if (isEngaged(s, r)) return ['A Regiment in contact with an enemy cannot Charge (core p.24).'];
  const t = virtualMarker(s, id, r);
  if (!hasLineOfSight(s, r, t)) return ['The Marker is not in the front arc and Line of Sight (core p.31).'];
  const d = distancePolys(regimentPolys(s, r), [markerPoly(s, id)]);
  if (d > marchValue(s, r) + 6 + TOL) return [`The Marker is ${d.toFixed(2)}″ away, beyond the maximum Charge (core p.31).`];
  if (d <= TOL) return ['Already in contact: Clash instead.'];
  return [];
}

function impactPools(s: GameState, r: RegimentState): AttackPool[] {
  const pools: AttackPool[] = [];
  const x = ruleX(r.rules, 'Impact');
  if (x) pools.push({ label: `${r.name} Impact (${x}) × ${r.stands.length}`, dice: x * r.stands.length, skill: stat(r, 'C'), reduceD: ruleX(r.rules, 'Brutal Impact') });
  const c = attachedCharacter(s, r.id);
  const ci = c ? ruleX(c.rules, 'Impact') : 0;
  if (c && ci) pools.push({ label: `${c.name} Impact (${ci})`, dice: ci, skill: charStat(c, 'C'), reduceD: ruleX(c.rules, 'Brutal Impact') });
  return pools;
}

export function applyMarkerCharge(ctx: Ctx, r: RegimentState, id: string): void {
  const s = ctx.s;
  const t = virtualMarker(s, id, r);
  const d = distancePolys(regimentPolys(s, r), [markerPoly(s, id)]);
  const M = marchValue(s, r);
  const idx = ctx.rng.index;
  let [die] = rollN(ctx, 1) as [number];
  const notes = [`need ${d.toFixed(2)}″`];
  if (die + M < d - TOL && (hasRule(r.rules, 'Unstoppable') || (r.commandModels.includes('Standard Bearer') && r.stands.some((x) => x.isCommand)))) {
    const first = die;
    [die] = rollN(ctx, 1) as [number];
    notes.push(`Unstoppable re-roll ${first}→${die}`);
  }
  const success = die + M >= d - TOL;
  ev(ctx, { type: 'dice', text: `${r.name} charges Objective Marker ${id}: ${die} + ${M} = ${die + M}″ against ${d.toFixed(2)}″ — ${success ? 'success' : 'failed'}.`, dice: { purpose: `${r.name}: Charge Roll`, seed: ctx.rng.seed, index: idx, values: [die], notes }, player: r.owner });
  const act = s.activation!;
  recordAction(act, 'charge');
  if (!success) {
    const move = failedChargeDistance(s, r, die);
    if (move > 0) r.pose = applyPath(r.pose, [{ kind: 'forward', d: move }], footprintOf(s, r).halfWidth * 2);
    act.ended = true;
    ev(ctx, { type: 'charge', text: `Failed Charge: ${r.name} moves ${move}″ forward and its Activation ends (core p.36).`, player: r.owner });
    return;
  }
  const place = chargePlacement(s, r, t, 'front');
  if (!place.pose) {
    act.ended = true;
    ev(ctx, { type: 'charge', text: `The Charge succeeds but there is no room to place ${r.name} against the Marker; move it by hand (logged) and Clash next Activation.`, player: r.owner });
    return;
  }
  r.pose = place.pose;
  act.inspired = true;
  ev(ctx, { type: 'charge', text: `${r.name} contacts Objective Marker ${id} and is Inspired (core p.35).`, player: r.owner });
  const pools = impactPools(s, r);
  // Stands inflict Impact Hits on Objective Markers as normal (pack p.9).
  if (pools.length) attackMarker(ctx, r, id, pools, 'melee', `${r.name} Impact on Marker ${id}`);
}

export function markerInContact(s: GameState, r: RegimentState, id: string): boolean {
  return distancePolys(regimentPolys(s, r), [markerPoly(s, id)]) <= TOL;
}

export function applyMarkerClash(ctx: Ctx, r: RegimentState, id: string): void {
  const s = ctx.s;
  const mp = markerPoly(s, id);
  const slots = layout(formationInput(s, r));
  const leader = r.commandModels.includes('Leader');
  let attacks = 0;
  let charAttacks = 0;
  const c = attachedCharacter(s, r.id);
  for (const sl of slots) {
    const engaged = polyDistance(rectPoly(sl.rect), mp) <= TOL;
    if (sl.isCharacter && c) charAttacks += engaged ? charStat(c, 'A') : 1;
    else attacks += engaged ? stat(r, 'A') + (sl.isCommand && leader ? 1 : 0) : ruleX(r.rules, 'Support') || 1;
  }
  const inspired = !!s.activation?.inspired && !r.broken;
  const C = stat(r, 'C');
  const pools: AttackPool[] = [
    { label: `${r.name} vs Marker`, dice: attacks, skill: inspired && C + 1 < 5 ? C + 1 : C, rerollSixes: inspired && C + 1 >= 5, rerollFailed: hasRule(r.rules, 'Flurry'), extraOnOne: C >= 6, reduceD: ruleX(r.rules, 'Cleave') },
  ];
  if (c && charAttacks) pools.push({ label: `${c.name} vs Marker`, dice: charAttacks, skill: charStat(c, 'C'), rerollFailed: hasRule(c.rules, 'Flurry'), reduceD: ruleX(c.rules, 'Cleave') });
  attackMarker(ctx, r, id, pools, 'melee', `${r.name} Clash on Marker ${id}`);
}

/** Volley at a Marker: only Stands within Effective Range shoot (pack p.9). */
export function markerVolleyPlan(s: GameState, r: RegimentState, id: string, aimed: boolean): { pools: AttackPool[]; problems: string[] } {
  const problems = markerAttackProblems(s, r.owner, id);
  if (isEngaged(s, r)) problems.push('An engaged Regiment cannot Volley (core p.38).');
  const mp = markerPoly(s, id);
  if (!arcsOf(footprintOf(s, r), mp).includes('front')) problems.push('The Marker is not in the front arc (core p.38).');
  const c = attachedCharacter(s, r.id);
  let shots = 0;
  let skill = 0;
  let ap = 0;
  let deadly = false;
  for (const sl of layout(formationInput(s, r)).filter((x) => x.rank === 0)) {
    const rules = sl.isCharacter && c ? c.rules : r.rules;
    const b = barrageOf(rules);
    if (!b) continue;
    const from = frontCentre(sl.rect);
    const d = dist(from, closestPointOnPoly(from, mp));
    if (d >= b.range / 2) continue;
    const V = sl.isCharacter && c ? charStat(c, 'V') : stat(r, 'V');
    skill = aimed && V + 1 < 5 ? V + 1 : V;
    const all = flatRules([...rules, ...b.sub]);
    ap = Math.max(ap, ruleX(all, 'Armor Piercing'));
    deadly = deadly || hasRule(all, 'Deadly Shot');
    shots += b.shots + 1 + (sl.isCommand && r.commandModels.includes('Leader') ? 1 : 0);
  }
  if (!shots) problems.push('No Stand is within Effective Range of the Marker (pack p.9).');
  return { pools: [{ label: `${r.name} Volley at Marker ${id}`, dice: shots, skill, rerollSixes: aimed && skill >= 5, extraOnOne: skill >= 6, reduceD: ap, deadly6: deadly }], problems };
}
