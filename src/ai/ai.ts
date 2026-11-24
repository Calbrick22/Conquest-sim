/**
 * Computer opponent (basic). Pure and deterministic for a given state: it builds candidate
 * Actions with a legal action generator, keeps only those that pass the engine's `validate`
 * (the same path a human uses), scores them with simple, explainable heuristics, and returns the
 * best with a one-line reason.
 *
 * It plays its own Regiments as if "manual" special rules were not there (the engine logs those
 * rules on every Activation, so the log shows where the simulation is approximate).
 */
import { chargeProblems, clashTargets, enemiesInContact, footprintOf, planVolley } from '../engine/actions';
import { charStat, stat } from '../engine/combat';
import { validate, type Action, type ActionBody } from '../engine/game';
import { dist, normalizeAngle, type Vec } from '../engine/geometry/vec';
import { applyPath, type MoveSeg } from '../engine/movement';
import { markerAttackProblems, markerInContact } from '../engine/markers';
import type { CommandCard, GameState, PlayerId, RegimentState } from '../engine/model/types';
import {
  attachedCharacter,
  entryPose,
  isEngaged,
  marchAllowance,
  marchValue,
  onTableRegiments,
  positionProblems,
  regimentPolys,
  regimentStandCount,
  other,
  regimentDistance,
} from '../engine/queries';
import { buildCards, cardTargets, flankChoices, reinforcementChoices, reinforcementNeed } from '../engine/round';
import { legalFiles } from '../engine/formation';
import { hasRule, manualRules, ruleX } from '../engine/rules/special/rules';
import { zoneResults } from '../engine/scoring/victory';

export interface AiDecision {
  action: Action;
  reason: string;
}

// ---------------------------------------------------------------- who must act

/** The player who must make the next decision, or null if anyone may (e.g. rolls) or nobody. */
export function decisionMaker(s: GameState): PlayerId | 'any' | null {
  if (s.phase !== 'play') return null;
  switch (s.step) {
    case 'reinforcement':
      return !s.players.P1.reinforcementDone ? 'P1' : !s.players.P2.reinforcementDone ? 'P2' : null;
    case 'command':
      return !s.players.P1.stackSet ? 'P1' : !s.players.P2.stackSet ? 'P2' : null;
    case 'supremacy':
      if (!s.supremacyWinner) return 'any';
      if (!s.firstPlayer) return s.supremacyWinner;
      if (s.scenario.zonePick) {
        const second = other(s.firstPlayer);
        return s.zonePicks[s.firstPlayer] === null ? s.firstPlayer : s.zonePicks[second] === null ? second : null;
      }
      return null;
    case 'action':
      if (s.pendingCharge) return s.regiments[s.pendingCharge.regimentId]!.owner;
      if (s.activation) return s.regiments[s.activation.regimentId]!.owner;
      if (s.drawn) return s.drawn.player;
      return s.turn;
    case 'victory':
      return 'any';
  }
}

// ---------------------------------------------------------------- small deterministic noise

function noise(s: GameState, salt: number): number {
  let h = (s.seed ^ (s.round * 7919) ^ (salt * 104729)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function progress(s: GameState): number {
  const acted = Object.values(s.regiments).filter((r) => r.activatedThisRound).length;
  return acted * 10 + (s.activation?.actions.length ?? 0);
}

// ---------------------------------------------------------------- expectation helpers

/** P(success) on one die for a test needing `t` or less (1 always passes, 6 always fails). */
export function pTest(t: number): number {
  return Math.min(5, Math.max(1, t)) / 6;
}

/** P(save) on a Defense Roll needing `t` or less (1 not automatic; 6 always fails). */
function pSave(t: number): number {
  return Math.min(5, Math.max(0, t)) / 6;
}

function expectedWounds(dice: number, skill: number, target: RegimentState, opts: { reroll?: boolean; reduceD?: number; front?: boolean; morale?: boolean } = {}): number {
  let p = pTest(skill);
  if (opts.reroll) p = p + (1 - p) * p;
  const shield = opts.front && hasRule(target.rules, 'Shield') ? 1 : 0;
  const save = Math.max(Math.max(0, stat(target, 'D') + shield - (opts.reduceD ?? 0)), stat(target, 'E'));
  let w = dice * p * (1 - pSave(save));
  if (opts.morale) w += w * (1 - pTest(stat(target, 'R') + (target.stands.length >= 4 ? 1 : 0)));
  return w;
}

/** Probability a Charge of `distance` succeeds (die + March ≥ distance), with Unstoppable re-roll. */
export function chargeChance(s: GameState, r: RegimentState, distance: number): number {
  const need = Math.ceil(distance - marchValue(s, r) - 1e-9);
  const p = need <= 1 ? 1 : need > 6 ? 0 : (7 - need) / 6;
  const reroll = hasRule(r.rules, 'Unstoppable') || r.commandModels.includes('Standard Bearer');
  return reroll ? 1 - (1 - p) * (1 - p) : p;
}

/** Rough melee damage of `r` against `t`: front rank engaged, the rest supporting. */
function meleeExpect(s: GameState, r: RegimentState, t: RegimentState): number {
  const files = Math.min(r.files, r.stands.length);
  const support = Math.max(0, r.stands.length - files);
  const dice = files * stat(r, 'A') + support * (ruleX(r.rules, 'Support') || 1);
  let w = expectedWounds(dice, stat(r, 'C'), t, { reroll: hasRule(r.rules, 'Flurry'), reduceD: ruleX(r.rules, 'Cleave'), front: true, morale: true });
  const c = attachedCharacter(s, r.id);
  if (c) w += expectedWounds(charStat(c, 'A'), charStat(c, 'C'), t, { reroll: hasRule(c.rules, 'Flurry'), reduceD: ruleX(c.rules, 'Cleave'), front: true });
  return w;
}

function impactExpect(r: RegimentState, t: RegimentState): number {
  const x = ruleX(r.rules, 'Impact');
  return x ? expectedWounds(x * r.stands.length, stat(r, 'C'), t, { reduceD: ruleX(r.rules, 'Brutal Impact'), front: true, morale: true }) : 0;
}

function regimentValue(r: RegimentState): number {
  return Math.max(1, r.stands.length * Math.max(1, r.profile.W ?? 1));
}

function centreOf(s: GameState, r: RegimentState): Vec {
  return footprintOf(s, r).c;
}

// ---------------------------------------------------------------- objectives

/** Zones the player can Seize (not friendly-only to itself), with the best one first for a Regiment. */
function targetZones(s: GameState, p: PlayerId): { id: string; c: Vec; d: number }[] {
  return s.scenario.zones.filter((z) => z.friendlyTo !== p).map((z) => ({ id: z.id, c: { x: z.x, y: z.y }, d: z.diameter }));
}

/** Threat to a Regiment at a position: enemies that could charge it next Round (core p.31). */
function exposure(s: GameState, r: RegimentState, at: Vec): number {
  let t = 0;
  for (const e of onTableRegiments(s)) {
    if (e.owner === r.owner) continue;
    const d = dist(at, centreOf(s, e)) - footprintOf(s, e).halfDepth - 1.5;
    if (d < marchValue(s, e) + 3.5) t += meleeExpect(s, e, r) + impactExpect(e, r);
  }
  return t;
}

// ---------------------------------------------------------------- movement planning

/** A March toward a point: wheel to face it (within budget), then forward as far as legal. */
function marchToward(s: GameState, r: RegimentState, target: Vec, stopShort: number, kind: 'march' | 'enter', entry?: { edge: 'bottom' | 'top' | 'left' | 'right'; along: number }, filesIn?: number, partialOk = false): Action | null {
  const files = filesIn ?? r.files;
  const start = kind === 'enter' ? entryPose(s, entry!.edge, entry!.along) : r.pose;
  const width = footprintOf(s, r, kind === 'enter' ? { pose: start, files } : {}).halfWidth * 2;
  const budget = marchAllowance(s, r);
  const want = Math.atan2(target.y - start.y, target.x - start.x);
  const delta = normalizeAngle(want - start.angle);
  const maxTurn = Math.min(Math.abs(delta), (budget * 0.6) / width);
  const segs: MoveSeg[] = [];
  if (maxTurn > 0.05) segs.push({ kind: 'wheel', pivot: delta > 0 ? 'left' : 'right', angle: maxTurn });
  const afterWheel = applyPath(start, segs, width);
  const remaining = budget - maxTurn * width;
  const distTo = Math.max(0, dist({ x: afterWheel.x, y: afterWheel.y }, target) - stopShort);
  let f = Math.min(remaining, distTo);
  const mk = (fwd: number): Action => {
    const moves: MoveSeg[] = [...segs, ...(fwd > 0.05 ? [{ kind: 'forward' as const, d: Math.round(fwd * 10) / 10 }] : [])];
    return kind === 'enter' ? { type: 'enter', regimentId: r.id, edge: entry!.edge, along: entry!.along, files, moves } : { type: 'march', regimentId: r.id, moves };
  };
  const clean = (a: Action) => {
    if (!validate(s, a).ok) return false;
    // Only moves that leave the Regiment in a final legal position (no overlap, fully on the table).
    const end = applyPath(start, a.type === 'march' || a.type === 'enter' ? a.moves : [], width);
    return positionProblems(s, r, regimentPolys(s, r, { pose: end, files }), { allowFriendOverlap: false, allowOffTable: partialOk }).length === 0;
  };
  for (let i = 0; i < 6 && f >= 0; i++) {
    const a = mk(f);
    if ((a.type === 'march' ? a.moves.length : 1) && clean(a)) return a;
    f -= Math.max(0.5, f / 3);
  }
  // Straight ahead as a fallback.
  if (segs.length) {
    segs.length = 0;
    for (let fwd = Math.min(budget, distTo); fwd > 0.4; fwd -= Math.max(0.5, fwd / 3)) {
      const a = mk(fwd);
      if (clean(a)) return a;
    }
  }
  if (kind === 'enter') {
    // Far enough in for every rank to be on the table.
    const depth = footprintOf(s, r, { pose: start, files }).halfDepth * 2;
    const a = mk(Math.min(budget, depth + 0.1));
    if (clean(a)) return a;
  }
  return null;
}

// ---------------------------------------------------------------- decisions per step

function decideReinforcements(s: GameState, p: PlayerId): AiDecision {
  // Bring the most valuable Regiment that is allowed to arrive this Round (Mediums and Heavies first).
  const choices = reinforcementChoices(s, p).filter((r) => reinforcementNeed(s.round, r.cls) !== 'auto');
  const rank = (r: RegimentState) => (r.cls === 'Heavy' ? 3 : r.cls === 'Medium' ? 2 : 1) * 10 + regimentValue(r);
  const best = choices.sort((a, b) => rank(b) - rank(a))[0];
  // Flank Regiments arrive as soon as they may (core p.98).
  const flank = Object.fromEntries(flankChoices(s, p).map((r) => [r.id, true]));
  const flankNote = Object.keys(flank).length ? `; Flank: ${flankChoices(s, p).map((r) => r.name).join(', ')} arrive` : '';
  if (best) return { action: { type: 'reinforcements', player: p, choice: { regimentId: best.id, arrive: true }, flank }, reason: `brings ${best.name} on automatically; rolls for the rest${flankNote}` };
  return { action: { type: 'reinforcements', player: p, choice: null, flank }, reason: `rolls for Reinforcements${flankNote}` };
}

/** Command Stack: ranged and fast first, units likely to charge later (they want targets to come closer). */
function decideStack(s: GameState, p: PlayerId): AiDecision {
  const cards = buildCards(s, p);
  const score = (c: CommandCard) => {
    const r = c.kind === 'regiment' ? s.regiments[c.refId]! : s.regiments[s.characters[c.refId]!.attachedTo!]!;
    const ranged = r.rules.some((x) => x.name === 'Barrage') ? -20 : 0;
    const arriving = r.location === 'arriving' ? -5 : 0;
    const charger = ruleX(r.rules, 'Impact') > 0 ? 10 : 0;
    return ranged + arriving + charger - (r.profile.M ?? 0) + (c.kind === 'character' ? -0.5 : 0);
  };
  const order = [...cards].sort((a, b) => score(a) - score(b));
  // Keep each Character just above its own Regiment so Entourage works.
  const regs = order.filter((c) => c.kind === 'regiment');
  const out: CommandCard[] = [];
  for (const rc of regs) {
    const ch = cards.find((c) => c.kind === 'character' && s.characters[c.refId]!.attachedTo === rc.refId);
    if (ch) out.push(ch);
    out.push(rc);
  }
  for (const c of cards) if (!out.includes(c)) out.push(c);
  return { action: { type: 'setStack', player: p, order: out.map((c) => c.id) }, reason: 'orders the Command Stack: ranged and fast first, chargers later' };
}

function decideFirst(s: GameState, p: PlayerId): AiDecision {
  // Go second if an enemy could charge us this Round (let them commit first); otherwise go first.
  const threatened = onTableRegiments(s).some((r) => r.owner === p && exposure(s, r, centreOf(s, r)) > 2);
  const first = threatened ? other(p) : p;
  return { action: { type: 'chooseFirst', first }, reason: threatened ? 'lets the opponent act first to react to their charges' : 'takes the initiative' };
}

function decideZonePick(s: GameState, p: PlayerId): AiDecision {
  const zp = s.scenario.zonePick!;
  const zr = zoneResults(s);
  const eligible = s.scenario.zones.filter((z) => !zp.eligibleZoneIds || zp.eligibleZoneIds.includes(z.id));
  for (const z of [...eligible].sort((a, b) => {
    // Bonus pick: the zone our Regiments are closest to; veto: the zone the enemy is closest to seizing.
    const key = (zid: string) => (zp.mode === 'bonusPick' ? -(zr[zid]?.seizing[p] ?? 0) : -(zr[zid]?.seizing[other(p)] ?? 0));
    return key(a.id) - key(b.id);
  })) {
    const a: Action = { type: 'pickZone', player: p, zoneId: z.id };
    if (validate(s, a).ok) return { action: a, reason: `picks zone ${z.label ?? z.id}` };
  }
  return { action: { type: 'pickZone', player: p, zoneId: eligible[0]!.id }, reason: 'picks a zone' };
}

interface Scored {
  action: ActionBody;
  score: number;
  reason: string;
}

function regimentCandidates(s: GameState, r: RegimentState): Scored[] {
  const out: Scored[] = [];
  const act = s.activation!;
  const used = act.actions.length;
  const add = (action: ActionBody, score: number, reason: string) => {
    if (validate(s, action as Action).ok) out.push({ action, score, reason });
  };
  const enemies = onTableRegiments(s).filter((e) => e.owner !== r.owner);

  if (r.location === 'arriving') {
    const own = s.scenario.reinforcementZones[r.owner];
    const zones = targetZones(s, r.owner);
    // Formation for entering: the narrowest one whose depth fits in a single March (core p.31);
    // otherwise the widest, entering over two Marches.
    const n = regimentStandCount(s, r);
    const budget = marchAllowance(s, r);
    const options = legalFiles(n);
    const fits = options.filter((f) => footprintOf(s, r, { files: f }).halfDepth * 2 <= budget - 0.2);
    const files = fits.length ? fits[0]! : options[options.length - 1]!;
    const partial = !fits.length && act.actions.length === 0;
    for (let x = 8; x <= s.scenario.table.width - 8; x += 8) {
      const a = marchToward(s, r, nearestZone(zones, { x, y: own === 'bottom' ? 0 : s.scenario.table.height }) ?? { x: 36, y: 24 }, 1, 'enter', { edge: own, along: x }, files, partial);
      if (a) {
        const end = a.type === 'enter' ? applyPath(entryPose(s, a.edge, a.along), a.moves, footprintOf(s, r).halfWidth * 2) : r.pose;
        out.push({ action: a, score: 5 - 0.05 * Math.abs(x - 36) - 0.3 * exposure(s, r, end) + noise(s, x), reason: `marches on toward the objectives at ${x}″` });
      }
    }
    return out;
  }

  const engaged = isEngaged(s, r);
  if (engaged) {
    if (r.broken) add({ type: 'combatRally', regimentId: r.id }, 6, 'is Broken and Combat Rallies');
    const targets = clashTargets(s, r);
    if (used === 0 && !r.broken && targets.length) add({ type: 'inspire', regimentId: r.id }, 2.5, 'is Inspired before Clashing');
    for (const t of targets) {
      const w = meleeExpect(s, r, t);
      add({ type: 'clash', regimentId: r.id, targetId: t.id }, 3 + w, `Clashes with ${t.name}: about ${w.toFixed(1)} expected Wounds`);
    }
    // Withdraw a Light or Medium Regiment that is clearly losing.
    const incoming = enemiesInContact(s, r).reduce((a, e) => a + meleeExpect(s, e, r), 0);
    if (r.cls !== 'Heavy' && incoming > regimentValue(r) * 0.6) add({ type: 'withdraw', regimentId: r.id, moves: [{ kind: 'forward', d: Math.min(3, marchValue(s, r)) }] }, 2, 'Withdraws from a losing fight');
    return out;
  }

  if (r.broken) add({ type: 'rally', regimentId: r.id }, 5, 'is Broken and Rallies');

  // Charges.
  for (const t of enemies) {
    if (chargeProblems(s, r, t).length) continue;
    const d = regimentDistance(s, r, t);
    const p = chargeChance(s, r, d);
    const gain = impactExpect(r, t) + meleeExpect(s, r, t);
    const loss = meleeExpect(s, t, r);
    const score = p * (gain * 1.2 - loss * 0.6) - (1 - p) * 1.5 + 1;
    if (p >= 0.4) add({ type: 'charge', regimentId: r.id, targetId: t.id }, score, `Charges ${t.name}: ${Math.round(p * 100)}% charge chance, ${gain > loss ? 'favourable' : 'risky'} trade (~${gain.toFixed(1)} v ${loss.toFixed(1)} Wounds)`);
  }
  // Volleys (Take Aim first if there is time).
  for (const t of enemies) {
    const plan = planVolley(s, r, t, act.aimed);
    if (plan.problems.length) continue;
    const ap = plan.plans.reduce((a, x) => Math.max(a, x.ap), 0);
    const shots = plan.plans.reduce((a, x) => a + x.shots, 0);
    const skill = Math.max(0, ...plan.plans.map((x) => x.skill));
    const w = expectedWounds(shots, skill, t, { reduceD: ap });
    if (used === 0 && !act.aimed) add({ type: 'takeAim', regimentId: r.id }, 2 + w * 0.4, `Takes Aim to Volley ${t.name}`);
    add({ type: 'volley', regimentId: r.id, targetId: t.id }, 2 + w, `Volleys ${t.name}: ${shots} shots, about ${w.toFixed(1)} expected Wounds`);
  }
  // Objective Markers in reach.
  for (const m of s.scenario.markers) {
    if (markerAttackProblems(s, r.owner, m.id).length) continue;
    if (markerInContact(s, r, m.id)) add({ type: 'clash', regimentId: r.id, targetId: `marker:${m.id}` }, 4, `attacks Objective Marker ${m.label ?? m.id}`);
    else add({ type: 'charge', regimentId: r.id, targetId: `marker:${m.id}` }, 3.5, `Charges Objective Marker ${m.label ?? m.id}`);
  }
  // Marching: toward objective zones (Light Regiments stop short as screens) and toward enemies.
  const light = r.cls === 'Light';
  const here = centreOf(s, r);
  const zones = targetZones(s, r.owner);
  for (const z of zones) {
    const a = marchToward(s, r, z.c, light ? 6 : 0, 'march');
    if (!a || a.type !== 'march') continue;
    const end = applyPath(r.pose, a.moves, footprintOf(s, r).halfWidth * 2);
    const gained = dist(here, z.c) - dist({ x: end.x, y: end.y }, z.c);
    const onZone = dist({ x: end.x, y: end.y }, z.c) < z.d / 2 + 1.5 && !light ? 3 : 0;
    const score = 1 + gained * 0.35 + onZone - 0.25 * exposure(s, r, { x: end.x, y: end.y }) + noise(s, progress(s) + z.c.x);
    out.push({ action: a, score, reason: light ? `screens toward zone ${z.id}` : `marches toward zone ${z.id}${onZone ? ' to Seize it' : ''}` });
  }
  for (const e of enemies.slice(0, 4)) {
    const a = marchToward(s, r, centreOf(s, e), footprintOf(s, e).halfDepth + 2, 'march');
    if (!a || a.type !== 'march') continue;
    const melee = meleeExpect(s, r, e) + impactExpect(r, e);
    out.push({ action: a, score: 0.5 + melee * 0.25 - (light ? 2 : 0) + noise(s, progress(s) + 99), reason: `closes on ${e.name}` });
  }
  return out;
}

function decideActivation(s: GameState): AiDecision {
  const act = s.activation!;
  const r = s.regiments[act.regimentId]!;
  if (act.characterId) {
    // Character Actions are manual for the AI; end and let its Regiment act as an Entourage.
    return { action: { type: 'endActivation', entourage: true }, reason: `ends ${s.characters[act.characterId]!.name}'s Activation and calls its Regiment (Entourage)` };
  }
  if (act.ended || act.actions.length >= 2) return finish(s, r);
  const cands = regimentCandidates(s, r);
  const best = cands.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 0.4) return finish(s, r);
  const manual = manualRules(r.rules).map((x) => x.raw);
  const note = manual.length && act.actions.length === 0 ? ` (ignoring manual rules: ${manual.slice(0, 4).join(', ')}${manual.length > 4 ? '…' : ''})` : '';
  return { action: { ...best.action, why: `${r.name} ${best.reason}${note}` }, reason: best.reason };
}

function finish(s: GameState, r: RegimentState): AiDecision {
  const end: Action = { type: 'endActivation' };
  if (validate(s, end).ok) return { action: end, reason: `${r.name} ends its Activation` };
  // Illegal final position (e.g. overlapping a friend): find the nearest legal spot and move there
  // with the manual override, which is logged, so the game can go on.
  const pose = nearestLegalPose(s, r);
  if (pose) return { action: { type: 'override.move', regimentId: r.id, pose, reason: 'AI fallback: nearest legal position' }, reason: `${r.name} is nudged to the nearest legal position (override)` };
  return { action: { type: 'setArriving', regimentId: r.id, arriving: false }, reason: `${r.name} cannot be placed legally and returns to Reinforcements (override)` };
}

function nearestLegalPose(s: GameState, r: RegimentState) {
  const { forward: f, right: rt } = { forward: { x: Math.cos(r.pose.angle), y: Math.sin(r.pose.angle) }, right: { x: Math.sin(r.pose.angle), y: -Math.cos(r.pose.angle) } };
  for (let radius = 0.5; radius <= 12; radius += 0.5)
    for (const [a, b] of [[-1, 0], [0, 1], [0, -1], [1, 0], [-1, 1], [-1, -1], [1, 1], [1, -1]] as const) {
      const pose = { x: r.pose.x + (f.x * a + rt.x * b) * radius, y: r.pose.y + (f.y * a + rt.y * b) * radius, angle: r.pose.angle };
      if (positionProblems(s, r, regimentPolys(s, r, { pose }), { allowFriendOverlap: false, allowOffTable: false }).length === 0) return pose;
    }
  return null;
}

function nearestZone(zones: { c: Vec }[], from: Vec): Vec | null {
  let best: Vec | null = null;
  let bd = Infinity;
  for (const z of zones) {
    const d = dist(z.c, from);
    if (d < bd) {
      bd = d;
      best = z.c;
    }
  }
  return best;
}

/** The AI's next Action for player `p`. */
export function aiDecide(s: GameState, p: PlayerId): AiDecision {
  const d = decideInner(s, p);
  return { action: { ...d.action, why: d.action.why ?? d.reason }, reason: d.reason };
}

function decideInner(s: GameState, p: PlayerId): AiDecision {
  switch (s.step) {
    case 'reinforcement':
      return decideReinforcements(s, p);
    case 'command':
      return decideStack(s, p);
    case 'supremacy':
      if (!s.supremacyWinner) return { action: { type: 'supremacyRollOff' }, reason: 'rolls off for Supremacy' };
      if (!s.firstPlayer) return decideFirst(s, p);
      return decideZonePick(s, p);
    case 'victory':
      return { action: { type: 'endRound' }, reason: 'ends the Round' };
    case 'action': {
      if (s.pendingCharge) return { action: { type: 'failCharge' }, reason: 'cannot place its Charge: treats it as failed' };
      if (s.activation) return decideActivation(s);
      if (s.drawn) {
        const ids = cardTargets(s, p, s.drawn.card);
        if (s.drawn.card.kind === 'character') return { action: { type: 'activateCharacter', characterId: ids[0]! }, reason: `activates ${s.drawn.card.name}` };
        // Several same-named Regiments: activate the one with the most to do (closest to the enemy).
        const pick = [...ids].sort((a, b) => nearestEnemy(s, s.regiments[a]!) - nearestEnemy(s, s.regiments[b]!))[0]!;
        return { action: { type: 'activate', regimentId: pick }, reason: `activates ${s.regiments[pick]!.name}` };
      }
      return { action: { type: 'drawCard', player: p }, reason: 'draws a Command Card' };
    }
  }
}

function nearestEnemy(s: GameState, r: RegimentState): number {
  if (r.location !== 'table') return 99;
  let best = 99;
  for (const e of onTableRegiments(s)) if (e.owner !== r.owner) best = Math.min(best, regimentDistance(s, r, e));
  return best;
}

