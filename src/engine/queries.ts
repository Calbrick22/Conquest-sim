import type { Edge } from '../scenarios/types';
import { OBJECTIVE_MARKER_BASE_MM, mmToInches } from './geometry/bases';
import { overlaps, polyDistance, rectPoly, type Poly } from './geometry/polygon';
import { TOL } from './geometry/vec';
import { footprint, standPolys, type FormationInput } from './formation';
import type { ActionKind, CharacterState, GameState, PlayerId, Pose, RegimentState } from './model/types';

export type Validation = { ok: true } | { ok: false; reasons: string[] };

// ---------------------------------------------------------------- queries

export const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');

export function attachedCharacter(s: GameState, regimentId: string): CharacterState | undefined {
  // An embodied Character (a Regiment by itself, od p.8) is not an attached Character Stand.
  return Object.values(s.characters).find((c) => c.attachedTo === regimentId && !c.destroyed && !c.embodied);
}

export function regimentStandCount(s: Pick<GameState, 'characters'>, r: RegimentState): number {
  return r.stands.length + (Object.values(s.characters).some((c) => c.attachedTo === r.id && !c.destroyed && !c.embodied) ? 1 : 0);
}

export function formationInput(s: GameState, r: RegimentState, override?: Partial<Pick<RegimentState, 'pose' | 'files'>>): FormationInput {
  return { regiment: { ...r, ...override }, characterId: attachedCharacter(s, r.id)?.id ?? null };
}

/**
 * Stand polygons for a Regiment. Results for the current position are cached per Regiment object,
 * keyed by everything the layout depends on, so repeated geometry queries (legality checks along
 * a path, the AI's candidate moves) stay fast. The cache is checked on every call, so mutating a
 * Regiment's pose or Stands invalidates it.
 */
const polyCache = new WeakMap<RegimentState, { key: string; polys: Poly[] }>();

export function regimentPolys(s: GameState, r: RegimentState, override?: Partial<Pick<RegimentState, 'pose' | 'files'>>): Poly[] {
  const input = formationInput(s, r, override);
  if (override) return standPolys(input);
  const p = r.pose;
  const key = `${p.x},${p.y},${p.angle},${r.files},${r.type},${input.characterId ?? ''},${r.stands.map((x) => `${x.id}:${x.wounds > 0 ? 1 : 0}:${x.isCommand ? 1 : 0}`).join('|')}`;
  const hit = polyCache.get(r);
  if (hit && hit.key === key) return hit.polys;
  const polys = standPolys(input);
  polyCache.set(r, { key, polys });
  return polys;
}

/** Lowest March Characteristic in the Regiment; Characters with "-" are ignored (core p.28; AMB-21). */
export function marchValue(s: GameState, r: RegimentState): number {
  const vals = [r.profile.M, attachedCharacter(s, r.id)?.profile.M].filter((m): m is number => typeof m === 'number');
  return vals.length ? Math.min(...vals) : 0;
}

export function onTableRegiments(s: GameState): RegimentState[] {
  return Object.values(s.regiments).filter((r) => r.location === 'table');
}

export function distancePolys(a: Poly[], b: Poly[]): number {
  let m = Infinity;
  for (const p of a) for (const q of b) m = Math.min(m, polyDistance(p, q));
  return m;
}

export function anyOverlap(a: Poly[], b: Poly[]): boolean {
  return a.some((p) => b.some((q) => overlaps(p, q)));
}

/** Closest edge-to-edge distance between two Regiments on the table (core p.10). */
export function regimentDistance(s: GameState, a: RegimentState, b: RegimentState): number {
  return distancePolys(regimentPolys(s, a), regimentPolys(s, b));
}

/** In contact with any enemy Regiment (core p.16, p.24). */
export function isEngaged(s: GameState, r: RegimentState, polys = regimentPolys(s, r)): boolean {
  return onTableRegiments(s).some((o) => o.owner !== r.owner && distancePolys(polys, regimentPolys(s, o)) <= TOL);
}

export function markerPolys(s: GameState): Poly[] {
  const side = mmToInches(OBJECTIVE_MARKER_BASE_MM.widthMm);
  return s.scenario.markers.map((m) => rectPoly({ c: { x: m.x, y: m.y }, halfWidth: side / 2, halfDepth: side / 2, angle: Math.PI / 2 }));
}

export function onTable(s: GameState, polys: Poly[]): boolean {
  const { width, height } = s.scenario.table;
  return polys.every((p) => p.every((v) => v.x >= -TOL && v.x <= width + TOL && v.y >= -TOL && v.y <= height + TOL));
}

/** Depth of a point from a player's own table edge. */
export function depthFrom(s: GameState, p: PlayerId, y: number): number {
  return p === 'P1' ? y : s.scenario.table.height - y;
}

/**
 * Reinforcement Line (core p.30): parallel to the player's edge through the rearmost corner of
 * their foremost Regiment; pushed back to the next Regiment while an enemy Regiment crosses it.
 * Irregular Regiments are ignored (core p.99). Returned as depth from the player's own edge.
 */
export function computeReinforcementLine(s: GameState, p: PlayerId): number {
  const depths = (r: RegimentState) => footprintCorners(s, r).map((c) => depthFrom(s, p, c.y));
  const friends = onTableRegiments(s)
    .filter((r) => r.owner === p && !r.rules.some((x) => x.name === 'Irregular'))
    .map((r) => ({ front: Math.max(...depths(r)), rear: Math.min(...depths(r)), pathfinders: r.rules.some((x) => x.name === 'Pathfinders') }))
    .sort((a, b) => b.front - a.front);
  const enemyMin = onTableRegiments(s)
    .filter((r) => r.owner !== p && !r.rules.some((x) => x.name === 'Irregular'))
    .map((r) => Math.min(...depths(r)));
  // Pathfinders: a Line set by this Regiment cannot be pushed back by enemies (core p.100).
  for (const f of friends) if (f.pathfinders || !enemyMin.some((e) => e <= f.rear + 1e-9)) return Math.max(0, f.rear);
  return 0;
}

function footprintCorners(s: GameState, r: RegimentState) {
  return regimentPolys(s, r).flat();
}

/** The line during a Round: never further forward than where it was set at the start (core p.30). */
export function reinforcementLineNow(s: GameState, p: PlayerId): number {
  return Math.min(s.reinforcementLine[p], computeReinforcementLine(s, p));
}

/** Pose for a Regiment whose front edge touches a table edge, facing inward (core p.31). */
export function entryPose(s: GameState, edge: Edge, along: number): Pose {
  const { width, height } = s.scenario.table;
  switch (edge) {
    case 'bottom':
      return { x: along, y: 0, angle: Math.PI / 2 };
    case 'top':
      return { x: along, y: height, angle: -Math.PI / 2 };
    case 'left':
      return { x: 0, y: along, angle: 0 };
    case 'right':
      return { x: width, y: along, angle: Math.PI };
  }
}

/** Where a Regiment may March on from Reinforcements (core p.31; pack p.15). */
export function entryProblems(s: GameState, r: RegimentState, edge: Edge, along: number, files: number): string[] {
  const problems: string[] = [];
  const own = s.scenario.reinforcementZones[r.owner];
  const width = footprint(formationInput(s, r, { files })).halfWidth * 2;
  const lo = along - width / 2;
  const hi = along + width / 2;
  const edgeLen = edge === 'bottom' || edge === 'top' ? s.scenario.table.width : s.scenario.table.height;
  if (lo < -TOL || hi > edgeLen + TOL) problems.push('The Regiment must enter entirely within the table edge.');
  if (edge !== own) {
    const opposite = (own === 'bottom' && edge === 'top') || (own === 'top' && edge === 'bottom');
    if (opposite) problems.push("Regiments cannot enter from the opponent's table edge (core p.31).");
    else {
      // Heavy Regiments in Round 3 only from the player's own Reinforcement Zone (core p.21).
      if (r.cls === 'Heavy' && s.round === 3) problems.push('In Round 3 Heavy Regiments may only enter from your own Reinforcement Zone (core p.21).');
      const line = reinforcementLineNow(s, r.owner);
      const dLo = depthFrom(s, r.owner, lo);
      const dHi = depthFrom(s, r.owner, hi);
      if (Math.max(dLo, dHi) > line + TOL)
        problems.push(`Side-edge entry must be between your Reinforcement Zone and your Reinforcement Line (${line.toFixed(1)}″ from your edge, core p.31).`);
    }
  }
  for (const seg of s.scenario.noReinforcement)
    if (seg.edge === edge && Math.min(hi, seg.to) - Math.max(lo, seg.from) > TOL)
      problems.push(`No Reinforcements may enter on this part of the ${edge} edge (${seg.from}″–${seg.to}″, pack p.${s.scenario.page}).`);
  return problems;
}

// ---------------------------------------------------------------- validation

export function ok(): Validation {
  return { ok: true };
}
export function fail(...reasons: string[]): Validation {
  return { ok: false, reasons };
}

/** Checks a final or intermediate position. */
/**
 * Legal position checks. `enemyGap` (default on) applies the March rule "not within 1″ of an enemy"
 * (core p.29); the legal-position test at the end of an Activation (core p.13) only forbids
 * overlaps and leaving the table, so Regiments in contact are fine there.
 */
export function positionProblems(s: GameState, r: RegimentState, polys: Poly[], opts: { allowFriendOverlap: boolean; allowOffTable: boolean; enemyGap?: boolean }): string[] {
  const problems: string[] = [];
  if (!opts.allowOffTable && !onTable(s, polys)) problems.push('Every Stand must stay on the Battlefield (core p.13).');
  for (const o of onTableRegiments(s)) {
    if (o.id === r.id) continue;
    const op = regimentPolys(s, o);
    if (o.owner !== r.owner) {
      if (anyOverlap(polys, op)) problems.push(`Overlaps enemy ${o.name}.`);
      // RULE-AMBIGUITY: AMB-28 — judged at the end position.
      else if (opts.enemyGap !== false && distancePolys(polys, op) < 1 - TOL) problems.push(`Within 1″ of enemy ${o.name} (core p.29).`);
    } else if (!opts.allowFriendOverlap && anyOverlap(polys, op)) problems.push(`Overlaps ${o.name} (core p.13).`);
  }
  if (markerPolys(s).some((m) => polys.some((p) => overlaps(p, m)))) problems.push('Cannot end overlapping an Objective Marker (pack p.8).');
  return problems;
}

/** Swept checks along a March path: cannot pass through enemies or engaged friends (core p.29–30). */
export function pathProblems(s: GameState, r: RegimentState, posesIn: Pose[], allowOffTable: boolean): string[] {
  // Check every other sampled pose (samples are 0.25″ apart) plus the end: enough for Stands ≥ 2.5″ wide.
  const poses = posesIn.filter((_, i) => i % 2 === 0 || i === posesIn.length - 1);
  const enemies = onTableRegiments(s).filter((o) => o.owner !== r.owner);
  const engagedFriends = onTableRegiments(s).filter((o) => o.owner === r.owner && o.id !== r.id && isEngaged(s, o));
  const flies = r.rules.some((x) => x.name === 'Fly') && !attachedCharacter(s, r.id); // core p.98: all Stands must have Fly
  for (const pose of poses.slice(1)) {
    const polys = regimentPolys(s, r, { pose });
    if (!allowOffTable && !onTable(s, polys)) return ['The move would take Stands off the Battlefield (core p.13).'];
    if (flies) continue;
    for (const e of enemies) if (anyOverlap(polys, regimentPolys(s, e))) return [`Cannot March through enemy ${e.name} (core p.30).`];
    for (const f of engagedFriends) if (anyOverlap(polys, regimentPolys(s, f))) return [`Cannot March through ${f.name}: it is in combat (core p.29).`];
  }
  return [];
}

export function canTakeAction(s: GameState, regimentId: string, kind: ActionKind): string[] {
  const a = s.activation;
  if (!a || a.regimentId !== regimentId) return ['That Regiment is not active.'];
  if (s.pendingCharge) return ['Finish placing the Charge first.'];
  if (a.ended) return ['The Activation has ended (core p.36).'];
  // Free Spellcasting or Character abilities (Theokrator, Divinity Grace, Practitioner Warlord…).
  const freeSpell = (kind === 'spell' || kind === 'ability') && a.extra?.some((e) => !e.used && e.kind === kind && e.free);
  if (a.characterId) {
    if (kind !== 'duel' && kind !== 'ability' && kind !== 'pass' && kind !== 'spell') return ["During a Character's own Activation it can only use its own Actions (core p.74)."];
    if (a.actions.length >= 1 && !freeSpell) return ['A Character performs a single Action each Round (core p.74).'];
    return [];
  }
  if (kind === 'duel' || kind === 'ability') return ["Characters use their own Actions when their own Command Card is drawn (core p.74)."];
  if (freeSpell) return [];
  const extraUsed = a.extra?.filter((e) => e.used).length ?? 0;
  if (a.actions.length + extraUsed >= 3) return ['A Regiment never performs more than 3 Actions in an Activation (core p.25).'];
  const extra = a.extra?.find((e) => !e.used && e.kind === kind);
  if (a.actions.length >= 2 && !extra) return ['The Regiment has used both of its Actions (core p.23).'];
  // Only March (and Reform, core p.37) may be repeated in one Activation (core p.23).
  if (!extra && kind !== 'march' && kind !== 'reform' && kind !== 'pass' && a.actions.includes(kind)) return [`A Regiment cannot repeat ${kind} in one Activation (core p.23).`];
  if (a.entering && a.actions.length === 0 && kind !== 'march') return ['A Regiment arriving from Reinforcements must March first (core p.23).'];
  return [];
}

/** March distance available for the next March this Activation (Standard Bearer included). */
export function marchAllowance(s: GameState, r: RegimentState): number {
  let m = marchValue(s, r);
  // Standard Bearer: +1″ on the second March of the Activation (core p.69).
  const sb = r.commandModels.includes('Standard Bearer') && r.stands.some((x) => x.isCommand);
  // Forced March (od p.24): the Standard Bearer adds +2″ instead.
  if (sb && s.activation?.actions.filter((k) => k === 'march').length === 1) m += r.rules.some((x) => x.name === 'Forced March') ? 2 : 1;
  // Vanguard (X): +X to the first March when entering from Reinforcements (core p.101).
  if (s.activation?.regimentId === r.id && s.activation.entering && !s.activation.actions.includes('march')) m += vanguardX(r);
  return m;
}


export function footprintWidth(s: GameState, r: RegimentState): number {
  return footprint(formationInput(s, r)).halfWidth * 2;
}

/** Vanguard (X) value of a Regiment (core p.101). */
export function vanguardX(r: RegimentState): number {
  let best = 0;
  for (const x of r.rules) if (x.name.toLowerCase() === 'vanguard') best = Math.max(best, x.x ?? 0);
  return best;
}

/**
 * Does the Regiment have Flank (core p.98)? Either itself, or granted by its attached Character:
 * Forward Force (core p.98: non-Monster Regiment) or the Spires Eccentricity Forlorn Drive
 * ([Drone] or [Clone] Regiment, from the imported list's rule text).
 */
export function hasFlank(s: GameState, r: RegimentState): boolean {
  if (r.rules.some((x) => x.name.toLowerCase() === 'flank')) return true;
  const c = attachedCharacter(s, r.id);
  if (!c) return false;
  const names = [...c.rules.map((x) => x.name.toLowerCase()), ...c.options.map((o) => o.toLowerCase())];
  if (names.includes('forward force') && r.type !== 'Monster') return true;
  if (names.includes('forlorn drive') && r.roles.some((x) => /^(drone|clone)$/i.test(x))) return true;
  return false;
}

/** Enemy Regiments in base contact with this one (no dependency on actions.ts). */
export function enemiesTouching(s: GameState, r: RegimentState): RegimentState[] {
  if (r.location !== 'table') return [];
  const mine = regimentPolys(s, r);
  return onTableRegiments(s).filter((e) => e.owner !== r.owner && distancePolys(mine, regimentPolys(s, e)) <= TOL);
}
