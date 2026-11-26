/**
 * Computer opponent (basic). Pure and deterministic for a given state: it builds candidate
 * Actions with a legal action generator, keeps only those that pass the engine's `validate`
 * (the same path a human uses), scores them with simple, explainable heuristics, and returns the
 * best with a one-line reason.
 *
 * It plays its own Regiments as if "manual" special rules were not there (the engine logs those
 * rules on every Activation, so the log shows where the simulation is approximate).
 */
import { chargeFacing, chargePlacement, chargeProblems, clashTargets, enemiesInContact, footprintOf, planVolley, volleyAimed } from '../engine/actions';
import { charStat, stat } from '../engine/combat';
import { apply, validate, type Action, type ActionBody } from '../engine/game';
import { dist, normalizeAngle, type Vec } from '../engine/geometry/vec';
import { applyPath, type MoveSeg } from '../engine/movement';
import { markerAttackProblems, markerInContact } from '../engine/markers';
import { baseName, CHARACTER_ABILITIES_AUTOMATED, characterAbilityProblems, drawEventProblems } from '../engine/activation';
import { castableSpells, casterOf, scalingExtra, spellDef } from '../engine/spells';
import { fallenDivinity, hasMemories, pantheonTier } from '../engine/factions/oldDominion';
import { practitionerAbilities, strainFor } from '../engine/factions/spires';
import { isOdDrawEvent, odSpendProblems, tokensAvailable } from '../engine/factions/oldDominionActions';
import type { CharacterState, CommandCard, GameState, PlayerId, RegimentState } from '../engine/model/types';
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
import { buildCards, cardTargets, flankChoices, reinforcementChoices, reinforcementClass, reinforcementNeed, tidalChoices } from '../engine/round';
import { legalFiles } from '../engine/formation';
import { barrageOf, hasRule, manualRules, ruleX } from '../engine/rules/special/rules';
import { zoneResults } from '../engine/scoring/victory';
import { aiContactVolley, aiRitual, aiSkActivation, placeRituals, skSpellValue } from './sorcererKingsAi';
import { aiBoost, aiDwActivation } from './dweghomAi';
import { BEGINNER, PROFILES, profileFor, type Difficulty, type Profile } from './difficulty';
import { createRng } from '../engine/rng';

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

// ---------------------------------------------------------------- difficulty (see difficulty.ts)

/** The profile for the decision being made (set by aiDecide; the AI is single-threaded and pure per call). */
let P: Profile = BEGINNER;

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

/**
 * Danger at a position (informed levels): enemies that could Charge there and would win the fight.
 * Enemies that have not yet Activated this Round count double: they can still strike this Round.
 */
function danger(s: GameState, r: RegimentState, at: Vec): number {
  let t = 0;
  for (const e of onTableRegiments(s)) {
    if (e.owner === r.owner || e.broken) continue;
    const d = dist(at, centreOf(s, e)) - footprintOf(s, e).halfDepth - footprintOf(s, r).halfDepth;
    if (d > marchValue(s, e) + 6) continue;
    const theirs = meleeExpect(s, e, r) + impactExpect(e, r);
    const ours = meleeExpect(s, r, e) * 0.7;
    const net = theirs - ours;
    if (net > 0) t += net * (e.activatedThisRound ? 0.5 : 1) * (d <= marchValue(s, e) + 3.5 ? 1 : 0.4);
  }
  return t;
}

/** What a position sets up for this Regiment's next Activation: Volleys in range, winning Charges in reach. */
function opportunity(s: GameState, r: RegimentState, at: Vec, angle: number): number {
  let v = 0;
  const b = barrageOf(r.rules);
  const fwd = { x: Math.cos(angle), y: Math.sin(angle) };
  for (const e of onTableRegiments(s)) {
    if (e.owner === r.owner) continue;
    const c = centreOf(s, e);
    const d = dist(at, c) - footprintOf(s, e).halfDepth;
    const ahead = (c.x - at.x) * fwd.x + (c.y - at.y) * fwd.y > 0;
    if (!ahead) continue;
    if (b && d <= b.range) v += 0.6;
    const reach = marchValue(s, r) + 3.5 + footprintOf(s, r).halfDepth;
    if (d <= reach && meleeExpect(s, r, e) + impactExpect(r, e) > meleeExpect(s, e, r)) v += 0.8;
  }
  return Math.min(v, 2.5);
}

/** Bonus for attacking where it hurts: exposed flanks and rears, Broken and wounded Regiments. */
function opportunism(s: GameState, _attacker: RegimentState, t: RegimentState, facing?: string, expected = 0): number {
  if (!P.opportunism) return 0;
  const health = t.stands.reduce((a, x) => a + Math.max(0, stat(t, 'W') - x.wounds), 0);
  let b = 0;
  if (facing && facing !== 'front') b += 1.5;
  if (t.broken) b += 1.5;
  if (t.stands.length < t.startingStands || t.stands.some((x) => x.wounds > 0)) b += 0.5;
  if (expected >= health * 0.8) b += 2; // likely to finish it
  if (attachedCharacter(s, t.id)?.isWarlord) b += 0.5;
  return b * P.opportunism;
}

/**
 * Advanced and Expert: what a move does to the Objective Zones right now, by the real seizing
 * rules (stands in range, Classes, Broken…): zones we would take or deny, minus zones we would
 * give up. The move is played on a copy of the game; nothing is rolled.
 */
function zoneSwing(s: GameState, p: PlayerId, action: ActionBody): number {
  if (P.scenario < 0.8 || !s.scenario.zones.length) return 0;
  const count = (st: GameState) => {
    const zr = zoneResults(st);
    let v = 0;
    for (const z of Object.values(zr)) v += z.seizedBy === p ? 1 : z.seizedBy === other(p) ? -1 : 0;
    return v;
  };
  try {
    const after = apply(s, action as Action, createRng(0)).state;
    return count(after) - count(s);
  } catch {
    return 0;
  }
}

/** Scenario weight of a zone (informed levels): contested or enemy-held zones matter most. */
function zoneWorth(s: GameState, p: PlayerId, zoneId: string, zr: ReturnType<typeof zoneResults>): number {
  if (!P.scenario) return 0;
  const z = zr[zoneId];
  if (!z) return 0;
  const mine = z.seizing[p] ?? 0;
  const theirs = z.seizing[other(p)] ?? 0;
  const priority = s.scenario.scoring.some((x) => x.kind === 'priorityZoneSeized') ? 0.5 : 0;
  return P.scenario * ((theirs > 0 ? 1 : 0) + (mine > theirs + 3 ? -0.8 : 0) + (mine === 0 && theirs === 0 ? 0.5 : 0) + priority);
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
  const choices = reinforcementChoices(s, p).filter((r) => reinforcementNeed(s.round, reinforcementClass(s, r)) !== 'auto');
  const rank = (r: RegimentState) => (r.cls === 'Heavy' ? 3 : r.cls === 'Medium' ? 2 : 1) * 10 + regimentValue(r);
  // Beginner: the first one in its list; informed: the most valuable Medium or Heavy.
  const best = P.targeting ? choices.sort((a, b) => rank(b) - rank(a))[0] : choices[0];
  // Flank Regiments arrive as soon as they may (core p.98).
  const flank = Object.fromEntries(flankChoices(s, p).map((r) => [r.id, true]));
  const flankNote = Object.keys(flank).length ? `; Flank: ${flankChoices(s, p).map((r) => r.name).join(', ')} arrive` : '';
  // Tidal Summons (sk p.45): bring the most valuable Water Elemental with the Marid Apsara.
  const tidal = best ? tidalChoices(s, p, best.id).sort((a, b) => rank(b) - rank(a))[0] : undefined;
  if (best) return { action: { type: 'reinforcements', player: p, choice: { regimentId: best.id, arrive: true, ...(tidal ? { tidalId: tidal.id } : {}) }, flank }, reason: `brings ${best.name}${tidal ? ` and ${tidal.name} (Tidal Summons)` : ''} on automatically; rolls for the rest${flankNote}` };
  return { action: { type: 'reinforcements', player: p, choice: null, flank }, reason: `rolls for Reinforcements${flankNote}` };
}

/** Command Stack: ranged and fast first, units likely to charge later (they want targets to come closer). */
function decideStack(s: GameState, p: PlayerId): AiDecision {
  const cards = buildCards(s, p);
  // Beginner: the cards in army-list order.
  if (P.stack === 'list') return { action: { type: 'setStack', player: p, order: cards.map((c) => c.id) }, reason: 'stacks its Command Cards in army-list order' };
  if (P.stack === 'threats') return threatStack(s, p, cards);
  const score = (c: CommandCard) => {
    // Ritual cards first (sk p.5): their effect and the same-Court follow-up come early.
    if (c.kind === 'ritual') return -100;
    const r = c.kind === 'regiment' ? s.regiments[c.refId]! : s.regiments[s.characters[c.refId]!.attachedTo!]!;
    const ranged = r.rules.some((x) => x.name === 'Barrage') ? -20 : 0;
    const arriving = r.location === 'arriving' ? -5 : 0;
    const charger = ruleX(r.rules, 'Impact') > 0 ? 10 : 0;
    return ranged + arriving + charger - (r.profile.M ?? 0) + (c.kind === 'character' ? -0.5 : 0);
  };
  const order = [...cards].sort((a, b) => score(a) - score(b));
  // Keep each Character just above its own Regiment so Entourage works.
  const regs = order.filter((c) => c.kind === 'regiment');
  const out: CommandCard[] = order.filter((c) => c.kind === 'ritual');
  for (const rc of regs) {
    const ch = cards.find((c) => c.kind === 'character' && s.characters[c.refId]!.attachedTo === rc.refId);
    if (ch) out.push(ch);
    out.push(rc);
  }
  for (const c of cards) if (!out.includes(c)) out.push(c);
  const final = placeRituals(s, out);
  return { action: { type: 'setStack', player: p, order: final.map((c) => c.id) }, reason: 'orders the Command Stack: ranged and fast first, chargers later' };
}

/**
 * Advanced and Expert Command Stack (threats and opportunities):
 * 1. Regiments that can strike now (a favourable Charge in reach, a Volley in range) go first,
 *    before the enemy can move out of reach or strike them.
 * 2. Regiments threatened by a fight they would lose go early, to strike first or get clear.
 * 3. Regiments that would win if Charged go late: they counter-charge after the enemy commits.
 * 4. Objective runners in between; the rest last. Characters just above their Regiment.
 */
function threatStack(s: GameState, p: PlayerId, cards: CommandCard[]): AiDecision {
  const zones = targetZones(s, p);
  const why: string[] = [];
  const score = (r: RegimentState): number => {
    if (r.location !== 'table') return r.location === 'arriving' ? -4 : 50;
    const here = centreOf(s, r);
    const enemies = onTableRegiments(s).filter((e) => e.owner !== p);
    const strike = enemies.some((e) => {
      const d = regimentDistance(s, r, e);
      const charge = chargeChance(s, r, d) >= 0.5 && impactExpect(r, e) + meleeExpect(s, r, e) > meleeExpect(s, e, r);
      const b = barrageOf(r.rules);
      return charge || (!!b && d <= b.range && !isEngaged(s, r));
    });
    if (isEngaged(s, r)) return -25 - meleeExpect(s, r, enemiesInContact(s, r)[0]!);
    if (strike) return -30 - regimentValue(r) * 0.1;
    const dz = danger(s, r, here);
    if (dz > 2) return -18 - dz;
    const counter = enemies.some((e) => regimentDistance(s, r, e) < marchValue(s, e) + 6 && meleeExpect(s, r, e) + impactExpect(r, e) > meleeExpect(s, e, r) + impactExpect(e, r));
    if (counter) return 25;
    const near = zones.some((z) => dist(here, z.c) < 2 * marchValue(s, r) + z.d / 2);
    return near ? -6 : 10 - (r.profile.M ?? 0);
  };
  const regs = cards.filter((c) => c.kind === 'regiment').sort((a, b) => score(s.regiments[a.refId]!) - score(s.regiments[b.refId]!));
  const out: CommandCard[] = [];
  for (const rc of regs) {
    const ch = cards.find((c) => c.kind === 'character' && s.characters[c.refId]!.attachedTo === rc.refId);
    if (ch) out.push(ch);
    out.push(rc);
  }
  for (const c of cards) if (!out.includes(c)) out.push(c);
  const final = placeRituals(s, [...cards.filter((c) => c.kind === 'ritual'), ...out.filter((c) => c.kind !== 'ritual')]);
  const first = s.regiments[regs[0]?.refId ?? '']?.name;
  if (first) why.push(`${first} first`);
  return { action: { type: 'setStack', player: p, order: final.map((c) => c.id) }, reason: `orders the Command Stack by threats and opportunities${why.length ? ` (${why.join('; ')})` : ''}` };
}

function decideFirst(s: GameState, p: PlayerId): AiDecision {
  // Beginner: always takes the initiative.
  if (!P.targeting) return { action: { type: 'chooseFirst', first: p }, reason: 'takes the initiative' };
  // Informed: go first with strikes available; go second when threatened, to react to the enemy.
  const mine = onTableRegiments(s).filter((r) => r.owner === p);
  const strikes = mine.filter((r) => onTableRegiments(s).some((e) => e.owner !== p && chargeChance(s, r, regimentDistance(s, r, e)) >= 0.6 && meleeExpect(s, r, e) + impactExpect(r, e) > meleeExpect(s, e, r))).length;
  const threatened = mine.filter((r) => danger(s, r, centreOf(s, r)) > 2).length;
  if (strikes > threatened) return { action: { type: 'chooseFirst', first: p }, reason: `goes first: ${strikes} Regiment${strikes > 1 ? 's' : ''} can strike before the enemy reacts` };
  if (threatened) return { action: { type: 'chooseFirst', first: other(p) }, reason: 'lets the opponent act first to react to their Charges' };
  return { action: { type: 'chooseFirst', first: p }, reason: 'takes the initiative' };
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
        const risk = P.danger ? 0.3 * P.danger * danger(s, r, { x: end.x, y: end.y }) : 0;
        out.push({ action: a, score: 5 - 0.05 * Math.abs(x - 36) - risk + P.noise * noise(s, x), reason: `marches on toward the objectives at ${x}″` });
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
      // Beginner: any enemy in contact will do; informed: the one it hurts most, or can finish.
      const sc = P.targeting ? 3 + w * P.targeting + opportunism(s, r, t, undefined, w) : 3 + P.noise * noise(s, progress(s) + t.stands.length);
      add({ type: 'clash', regimentId: r.id, targetId: t.id }, sc, `Clashes with ${t.name}: about ${w.toFixed(1)} expected Wounds`);
    }
    // Withdraw a Light or Medium Regiment that is clearly losing (a Beginner never backs off).
    const incoming = enemiesInContact(s, r).reduce((a, e) => a + meleeExpect(s, e, r), 0);
    if (P.danger && r.cls !== 'Heavy' && incoming > regimentValue(r) * (0.7 - 0.15 * P.danger)) add({ type: 'withdraw', regimentId: r.id, moves: [{ kind: 'forward', d: Math.min(3, marchValue(s, r)) }] }, 2 + P.danger, 'Withdraws from a losing fight');
    return out;
  }

  if (r.broken) add({ type: 'rally', regimentId: r.id }, 5, 'is Broken and Rallies');

  // Charges.
  for (const t of enemies) {
    if (chargeProblems(s, r, t).length) continue;
    // Only declare Charges that can actually be placed in contact (no room = a wasted Activation).
    if (!chargePlacement(s, r, t, chargeFacing(s, r, t)).pose) continue;
    const d = regimentDistance(s, r, t);
    const p = chargeChance(s, r, d);
    const gain = impactExpect(r, t) + meleeExpect(s, r, t);
    const loss = meleeExpect(s, t, r);
    const facing = chargeFacing(s, r, t);
    // Beginner: charges whatever it can reach, keenly. Informed: weighs the trade, the target and its facing.
    // The enemy hits back in its own Activation, so a losing trade counts against the Charge.
    const score = P.targeting
      ? p * (gain * 1.2 * P.targeting - loss * (0.6 + 0.5 * P.danger)) - (1 - p) * 1.5 + 1 + p * opportunism(s, r, t, facing, gain)
      : 2.5 + p * 2 + P.noise * noise(s, progress(s) + d * 10);
    if (p >= P.minCharge) add({ type: 'charge', regimentId: r.id, targetId: t.id }, score, `Charges ${t.name}${facing !== 'front' ? ` in the ${facing}` : ''}: ${Math.round(p * 100)}% charge chance, ${gain > loss ? 'favourable' : 'risky'} trade (~${gain.toFixed(1)} v ${loss.toFixed(1)} Wounds)`);
  }
  // Volleys (Take Aim first if there is time).
  for (const t of enemies) {
    const plan = planVolley(s, r, t, volleyAimed(s, r));
    if (plan.problems.length) continue;
    const ap = plan.plans.reduce((a, x) => Math.max(a, x.ap), 0);
    const shots = plan.plans.reduce((a, x) => a + x.shots, 0);
    const skill = Math.max(0, ...plan.plans.map((x) => x.skill));
    const w = expectedWounds(shots, skill, t, { reduceD: ap });
    if (used === 0 && !volleyAimed(s, r)) add({ type: 'takeAim', regimentId: r.id }, 2 + w * 0.4, `Takes Aim to Volley ${t.name}`);
    // Beginner: the nearest target in range. Informed: the most damage, finishing off, Armor Piercing on armour.
    const vs = P.targeting ? 2 + w * (0.6 + 0.4 * P.targeting) + opportunism(s, r, t, undefined, w) : 3.6 - regimentDistance(s, r, t) * 0.05 + 0.3 * P.noise * noise(s, progress(s) + shots);
    add({ type: 'volley', regimentId: r.id, targetId: t.id }, vs, `Volleys ${t.name}: ${shots} shots, about ${w.toFixed(1)} expected Wounds`);
  }
  // Flames of Conquest (ns p.5): Burning a zone it is Seizing is worth 4 VP at once.
  for (const z of s.scenario.zones) add({ type: 'burnZone', regimentId: r.id, zoneId: z.id }, 6, `Burns zone ${z.label ?? z.id} for 4 VP`);
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
  const zr = P.scenario ? zoneResults(s) : {};
  const width = footprintOf(s, r).halfWidth * 2;
  /** Informed levels: what the end position risks and sets up. */
  const place = (end: { x: number; y: number; angle: number }) => (P.danger ? -0.3 * P.danger * danger(s, r, end) : 0) + (P.setup ? 0.6 * P.setup * opportunity(s, r, end, end.angle) : 0);
  for (const z of zones) {
    const a = marchToward(s, r, z.c, light ? 6 : 0, 'march');
    if (!a || a.type !== 'march') continue;
    const end = applyPath(r.pose, a.moves, width);
    const gained = dist(here, z.c) - dist({ x: end.x, y: end.y }, z.c);
    const onZone = dist({ x: end.x, y: end.y }, z.c) < z.d / 2 + 1.5 && !light ? 3 : 0;
    const score = 1 + gained * 0.35 + onZone * (1 + zoneWorth(s, r.owner, z.id, zr) * 0.3) + zoneWorth(s, r.owner, z.id, zr) + place(end) + 2.5 * P.scenario * zoneSwing(s, r.owner, a) + P.noise * noise(s, progress(s) + z.c.x);
    out.push({ action: a, score, reason: light ? `screens toward zone ${z.id}` : `marches toward zone ${z.id}${onZone ? ' to Seize it' : ''}` });
  }
  for (const e of enemies.slice(0, P.targeting ? 6 : 4)) {
    const a = marchToward(s, r, centreOf(s, e), footprintOf(s, e).halfDepth + 2, 'march');
    if (!a || a.type !== 'march') continue;
    const melee = meleeExpect(s, r, e) + impactExpect(r, e);
    const end = applyPath(r.pose, a.moves, width);
    // A Beginner closes on the enemy keenly; informed levels only when the fight favours them.
    const score = P.targeting ? 0.5 + (melee - meleeExpect(s, e, r) * 0.6) * 0.3 * P.targeting - (light ? 2 : 0) + place(end) + 2.5 * P.scenario * zoneSwing(s, r.owner, a) : 1.8 + melee * 0.2 - (light ? 1 : 0);
    out.push({ action: a, score: score + P.noise * noise(s, progress(s) + 99), reason: `closes on ${e.name}` });
  }
  // Holding back (informed levels): staying put can beat walking into a losing fight.
  if (P.danger && !light) {
    const onZoneNow = zones.some((z) => dist(here, z.c) < z.d / 2 + 1.5);
    const hold: ActionBody = { type: 'pass' };
    const hs = 0.8 + (onZoneNow ? 2.5 * Math.max(0.5, P.scenario) : 0) + place({ ...here, angle: r.pose.angle });
    if (validate(s, hold as Action).ok) out.push({ action: hold, score: hs, reason: onZoneNow ? 'holds its objective' : 'holds back out of a losing fight' });
  }
  return out;
}

/**
 * The best Spell for a caster (core p.80–81; Old Dominion Spells od p.22–23): Hit Spells on the
 * enemy taking most Wounds, Heals on wounded friends, buffs on friends about to fight.
 */
function bestSpell(s: GameState, casterId: string): Scored | null {
  const c = casterOf(s, casterId);
  if (!c || c.dice <= 0) return null;
  let best: Scored | null = null;
  const pSucc = (need: number, att: number) => {
    // Probability of at least `need` successes on c.dice dice at Attunement `att` (1 always passes).
    const p = Math.min(5, Math.max(1, att)) / 6;
    let prob = 0;
    const n = c.dice;
    const choose = (a: number, b: number) => { let r = 1; for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i; return r; };
    for (let k = need; k <= n; k++) prob += choose(n, k) * p ** k * (1 - p) ** (n - k);
    return prob;
  };
  for (const { spell, targets } of castableSpells(s, casterId)) {
    const def = spellDef(spell);
    if (!def) continue;
    for (const id of targets) {
      const t = s.regiments[id]!;
      const need = 2 + (def.scaling ? scalingExtra(s, t) : 0);
      const p = pSucc(need, def.attunement);
      if (p < 0.25) continue;
      const engaged = isEngaged(s, t);
      const wounded = t.stands.length < t.startingStands || t.stands.some((x) => x.wounds > 0);
      const skv = skSpellValue(s, c.owner, spell, t);
      const value = skv !== null ? skv : def.hits
        ? expectedWounds(Math.round(c.dice * (def.attunement / 6)) * (spell === 'Insanity' ? 2 : 1), 6, t, { reduceD: spell === 'Unholy Baptism' ? 1 : 0 })
        : spell === "Hazlia's Touch"
          ? wounded ? 2 : 0
          : spell === 'Dark Supplication'
            ? 0.8
            : spell === 'Translocation'
              ? 0
              : t.owner === c.owner
                ? engaged ? 1.5 : enemiesNear(s, t, 8) ? 1 : 0.2
                : engaged ? 1 : 0.5;
      // Beginner: casts whatever it can, without weighing the target.
      const score = P.targeting ? 1 + p * value * 1.5 : 1 + p + P.noise * noise(s, progress(s) + id.length);
      if (value > 0 && (!best || score > best.score)) best = { action: { type: 'spell', casterId, spell, targetId: id }, score, reason: `casts ${spell} on ${t.name} (${Math.round(p * 100)}% to cast)` };
    }
  }
  return best;
}

/**
 * Practitioner Actions (sp p.15): damage first (Grant Virulence on the nearest enemy, Catalytic
 * Rupture where friends are engaged), else Induce Vigor on an engaged friend.
 */
function bestPractitioner(s: GameState, c: CharacterState): Scored | null {
  const abilities = practitionerAbilities(c);
  if (!abilities.length) return null;
  const regs = onTableRegiments(s);
  const owner = c.id.slice(0, 2) as PlayerId;
  const ok = (name: string, targetId?: string) => {
    const a: Action = { type: 'characterAbility', characterId: c.id, name, ...(targetId ? { targetId } : {}) };
    return validate(s, a).ok ? a : null;
  };
  const tries: [string, RegimentState[], string][] = [
    ['Catalytic Rupture', regs.filter((r) => r.owner === owner && enemiesInContact(s, r).length > 0), 'bursts enemies engaged with'],
    ['Grant Virulence', regs.filter((r) => r.owner !== owner).sort((a, b) => b.stands.length - a.stands.length), 'infects'],
    ['Induce Vigor', regs.filter((r) => r.owner === owner && isEngaged(s, r)), 'hardens'],
    ['Siphon Strength', regs.filter((r) => r.owner !== owner && isEngaged(s, r)), 'weakens'],
  ];
  for (const [name, targets, verb] of tries) {
    if (!abilities.includes(name)) continue;
    for (const t of targets) {
      const a = ok(name, t.id);
      if (a) return { action: a, score: 2, reason: `uses ${name}: ${verb} ${t.name}` };
    }
  }
  if (abilities.includes('Pheromantic Drive')) {
    const a = ok('Pheromantic Drive');
    if (a) return { action: a, score: 1, reason: 'uses Pheromantic Drive' };
  }
  return null;
}

function enemiesNear(s: GameState, r: RegimentState, d: number): boolean {
  return onTableRegiments(s).some((e) => e.owner !== r.owner && regimentDistance(s, r, e) <= d);
}

/** Old Dominion: Power Tokens to the Fallen Pantheon Pool while the Fallen Divinity is climbing Tiers (od p.7). */
function decidePowerPref(s: GameState, p: PlayerId): AiDecision | null {
  const o = s.players[p].od;
  if (!o || !fallenDivinity(s, p)) return null;
  const want = pantheonTier(s, p) < 3 ? 'pantheon' : 'dark';
  if (o.pref === want) return null;
  return { action: { type: 'powerPref', player: p, pool: want }, reason: `puts new Power Tokens in the ${want === 'dark' ? 'Dark Power' : 'Fallen Pantheon'} Pool` };
}

function decideActivation(s: GameState): AiDecision {
  const act = s.activation!;
  const r = s.regiments[act.regimentId]!;
  if (act.characterId) {
    const c = s.characters[act.characterId]!;
    const ode = chooseOdDrawEvent(s, r, c.drawEvents);
    if (ode) return ode;
    const skc = aiSkActivation(s, r, c.id);
    if (skc) return { action: { ...skc.action, why: `${c.name} ${skc.reason}` }, reason: skc.reason };
    const dwc = aiDwActivation(s, r, c.id);
    if (dwc) return { action: { ...dwc.action, why: `${c.name} ${dwc.reason}` }, reason: dwc.reason };
    const sp = bestSpell(s, c.id);
    if (sp && validate(s, sp.action as Action).ok) return { action: { ...aiBoost(s, sp.action), why: `${c.name} ${sp.reason}` }, reason: sp.reason };
    const pr = bestPractitioner(s, c);
    if (pr) return { action: { ...pr.action, why: `${c.name} ${pr.reason}` }, reason: pr.reason };
    if (act.actions.length === 0) {
      // Automated Character abilities (Snapshot, Mighty Swing) on the weakest target they can reach.
      for (const ab of c.actions.filter((x) => CHARACTER_ABILITIES_AUTOMATED.includes(x.name))) {
        const targets = onTableRegiments(s).filter((e) => e.owner !== r.owner && characterAbilityProblems(s, c, ab.name, e.id).length === 0);
        const t = targets.sort((a, b) => a.stands.length - b.stands.length)[0];
        if (t) return { action: { type: 'characterAbility', characterId: c.id, name: ab.name, targetId: t.id }, reason: `${c.name} uses ${ab.name} on ${t.name}` };
      }
    }
    const endIt: ActionBody = { type: 'endActivation', entourage: true };
    // An illegal resting place (e.g. left on a Marker by an enemy Charge): the logged fallback.
    if (!validate(s, endIt as Action).ok) return finish(s, r);
    return { action: endIt, reason: `ends ${c.name}'s Activation and calls its Regiment (Entourage)` };
  }
  if (act.ended) return finish(s, r);
  // A free Spellcasting Action (Theokrator, Memories of Old) is used even after both Actions.
  if (act.actions.length >= 2) {
    const sp = bestSpell(s, r.id);
    if (sp && validate(s, sp.action as Action).ok) return { action: { ...sp.action, why: `${r.name} ${sp.reason}` }, reason: sp.reason };
    return finish(s, r);
  }
  const spend = chooseOdSpend(s, r);
  if (spend) return spend;
  const ode = chooseOdDrawEvent(s, r, r.drawEvents);
  if (ode) return ode;
  const skd = aiSkActivation(s, r);
  if (skd) return { action: { ...skd.action, why: `${r.name} ${skd.reason}` }, reason: skd.reason };
  const dwd = aiDwActivation(s, r);
  if (dwd) return { action: { ...dwd.action, why: `${r.name} ${dwd.reason}` }, reason: dwd.reason };
  const de = chooseDrawEvent(s, r);
  if (de) return de;
  const cands = regimentCandidates(s, r);
  const cv = aiContactVolley(s, r);
  if (cv) cands.push({ action: cv.action, score: 2.5, reason: cv.reason });
  const sp = bestSpell(s, r.id);
  if (sp) cands.push(sp);
  // Memories of Old (od p.5) before a fight.
  if (act.actions.length === 0 && hasMemories(r) && (isEngaged(s, r) || enemiesNear(s, r, marchValue(s, r) + 8))) {
    const a: ActionBody = { type: 'memories', regimentId: r.id };
    if (validate(s, a as Action).ok) cands.push({ action: a, score: 3.2, reason: 'uses Memories of Old before the fight' });
  }
  const best = cands.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < 0.4) return finish(s, r);
  const manual = manualRules(r.rules).map((x) => x.raw);
  const note = manual.length && act.actions.length === 0 ? ` (ignoring manual rules: ${manual.slice(0, 4).join(', ')}${manual.length > 4 ? '…' : ''})` : '';
  return { action: { ...best.action, why: `${r.name} ${best.reason}${note}` }, reason: best.reason };
}

/** Simple Draw Event choices before the first Action (core p.23, p.94–95). */
function chooseDrawEvent(s: GameState, r: RegimentState): AiDecision | null {
  const act = s.activation!;
  if (act.actions.length || r.location !== 'table') return null;
  const done = act.drawEvents ?? [];
  const engaged = isEngaged(s, r);
  const here = centreOf(s, r);
  const nearEnemy = onTableRegiments(s).some((e) => e.owner !== r.owner && dist(here, centreOf(s, e)) < marchValue(s, r) + 10);
  const threatened = exposure(s, r, here) > 2;
  const wounded = r.stands.length < r.startingStands || r.stands.some((x) => x.wounds > 0);
  const shoots = r.rules.some((x) => x.name === 'Barrage');
  const pick = (name: string, extra: { option?: 'C' | 'A'; targetId?: string } = {}, why = ''): AiDecision | null => {
    if (drawEventProblems(s, name, extra).length) return null;
    return { action: { type: 'drawEvent', name, ...extra, why: `${r.name} uses ${name}${why ? `: ${why}` : ''}` }, reason: `uses ${name}` };
  };
  for (const n of r.drawEvents) {
    const bn = baseName(n);
    if (done.includes(bn)) continue;
    if (bn === 'Strain Expression' && strainFor(s, r) && (engaged || nearEnemy) && (r.stands.length >= 2 || r.type === 'Monster')) {
      const d = pick(n, {}, 'its Strain for the coming fight');
      if (d) return d;
    }
  }
  if (done.some((d) => d !== 'Strain Expression')) return null;
  const options: [string, boolean, { option?: 'C' | 'A' }, string][] = [];
  for (const n of r.drawEvents) {
    const bn = baseName(n);
    if (bn === 'Regeneration' || bn === 'Biotic Renewal') options.push([n, wounded, {}, 'heals']);
    if (bn === 'Bastion' || bn === 'Ferro-Ossified Carapace') options.push([n, engaged || threatened, {}, 'braces for combat']);
    if (bn === 'Flux-Powered') options.push([n, engaged || nearEnemy, { option: stat(r, 'C') >= 4 ? 'A' : 'C' }, 'for the fight']);
    if (bn === 'Double Time') options.push([n, !nearEnemy && !engaged, {}, 'to cover ground']);
    if (bn === 'Fire and Advance' || bn === 'Murderous Volley') options.push([n, shoots && !engaged, {}, 'to shoot']);
  }
  for (const [n, want, extra, why] of options) {
    if (!want) continue;
    const d = pick(n, extra, why);
    if (d) return d;
  }
  return null;
}

/** Old Dominion Draw Events (od p.7–30), before the first Action. */
function chooseOdDrawEvent(s: GameState, r: RegimentState, names: string[]): AiDecision | null {
  const act = s.activation!;
  if (act.actions.length || r.location !== 'table') return null;
  const done = act.drawEvents ?? [];
  const engaged = isEngaged(s, r);
  const near = engaged || enemiesNear(s, r, marchValue(s, r) + 8);
  const tokens = tokensAvailable(s, r.owner);
  const dark = s.players[r.owner].od?.dark ?? 0;
  const tryDe = (name: string, extra: { option?: string; options?: string[]; targetId?: string }, why: string): AiDecision | null => {
    const a: Action = { type: 'drawEvent', name, ...extra };
    if (!validate(s, a).ok) return null;
    return { action: { ...a, why: `${r.name} uses ${name}: ${why}` }, reason: `uses ${name}` };
  };
  for (const n of names) {
    const b = baseName(n).replace(/[’]/g, "'");
    if (done.includes(b) || !isOdDrawEvent(b)) continue;
    let d: AiDecision | null = null;
    if (b === 'Memories of Old' && near) d = tryDe(n, {}, 'free Memories of Old (Dark Power Tier II)');
    else if (b === 'Dark Awakening' && near && tokens >= 4) d = tryDe(n, { options: ['C', 'Cleave'] }, 'spends 4 Power Tokens for +2 Clash and Cleave (2)');
    else if (b === "Heaven's Descent" && engaged && tokens >= 2) d = tryDe(n, { targetId: enemiesInContact(s, r)[0]!.id }, 'Impact Attacks in the fight');
    else if (b === 'Exploitation of Divine Vanity' && engaged && r.stands[0] && (r.profile.W ?? 0) - r.stands[0].wounds > 8) d = tryDe(n, { option: 'aod' }, 'Aura of Death (+10)');
    else if (b === 'Exhortation of Eternal Faith' && (r.profile.W ?? 0) - (r.stands[0]?.wounds ?? 0) > 8) d = tryDe(n, { option: 'seize' }, '+6 Stands for Seizing');
    else if ((b === 'Blasphemous Mesa' || b === 'Unholy Sacrament') && dark >= 3) d = tryDe(n, {}, 'more magic this Activation');
    if (d) return d;
  }
  return null;
}

/** Blasphemous Mesa (Archimandrite Warlord, od p.8): Aura of Death (+1) for a Regiment about to fight. */
function chooseOdSpend(s: GameState, r: RegimentState): AiDecision | null {
  const dark = s.players[r.owner].od?.dark ?? 0;
  // Before a Clash: Obdurate's Attacks, Reign of Terror's Trial of Will, Soul Reaper (od p.10, p.20).
  if (isEngaged(s, r) && !s.activation?.actions.includes('clash')) {
    const tries: [Action, string][] = [
      [{ type: 'odClash', regimentId: r.id, option: 'obdurate' }, 'adds the Dark Power Tier to its Warlord’s Attacks'],
      ...(dark >= 2 ? ([[{ type: 'odClash', regimentId: r.id, option: 'reignOfTerror' }, 'spends a Token for Trial of Will']] as [Action, string][]) : []),
      ...(dark >= 4 ? ([[{ type: 'odClash', regimentId: r.id, option: 'soulReaper', amount: Math.min(3, dark - 2) }, 'spends Tokens on Soul Reaper']] as [Action, string][]) : []),
    ];
    for (const [a, why] of tries) if (validate(s, a).ok) return { action: { ...a, why: `${r.name} ${why}` }, reason: why };
  }
  if (dark < 3 || !isEngaged(s, r) || odSpendProblems(s, r).length) return null;
  return { action: { type: 'odSpend', regimentId: r.id, option: 'aod', why: `${r.name} spends a Dark Power Token for Aura of Death (+1)` }, reason: 'spends a Dark Power Token' };
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
export function aiDecide(s: GameState, p: PlayerId, difficulty: Difficulty = 'beginner', tuning?: Partial<Profile>): AiDecision {
  P = { ...profileFor(s, difficulty, progress(s) + (p === 'P1' ? 0 : 500) + s.round * 37), ...(tuning ?? {}) };
  try {
    const d = decideInner(s, p);
    return { action: { ...d.action, why: d.action.why ?? d.reason }, reason: d.reason };
  } finally {
    P = BEGINNER;
  }
}


export { PROFILES };

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
      const pref = !s.activation && !s.drawn ? decidePowerPref(s, p) : null;
      if (pref) return pref;
      if (s.activation) return decideActivation(s);
      if (s.drawn) {
        if (s.drawn.card.kind === 'ritual') return aiRitual(s, p);
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

