import type { ArmyList, ListEntry } from '../import/types';
import type { Edge, ScenarioDef } from '../scenarios/types';
import type { StandType } from './geometry/bases';
import { overlaps, polyDistance, rectPoly, type Poly } from './geometry/polygon';
import { rotateAbout, sub, TOL } from './geometry/vec';
import { clampFiles, footprint, layout, standPolys, type FormationInput } from './formation';
import { applyPath, marchShapeProblems, samplePath, type MoveSeg } from './movement';
import type { ActionKind, CharacterState, GameState, PlayerId, Pose, Profile, RegimentState, UnitClass } from './model/types';
import { createRng, rollD6, type RngState } from './rng';
import { OBJECTIVE_MARKER_BASE_MM, mmToInches } from './geometry/bases';

// ---------------------------------------------------------------- actions and events

export type Action =
  | { type: 'attachCharacter'; characterId: string; regimentId: string }
  | { type: 'startBattle' }
  | { type: 'setArriving'; regimentId: string; arriving: boolean }
  | { type: 'activate'; regimentId: string }
  | { type: 'enter'; regimentId: string; edge: Edge; along: number; files?: number; moves: MoveSeg[] }
  | { type: 'march'; regimentId: string; moves: MoveSeg[] }
  | { type: 'reform'; regimentId: string; files: number; rotation: number }
  | { type: 'pass' }
  | { type: 'endActivation' }
  | { type: 'endRound' }
  | { type: 'override.move'; regimentId: string; pose: Pose; files?: number; reason?: string };

export interface DiceRecord {
  purpose: string;
  seed: number;
  /** RNG draw index before the first die. */
  index: number;
  values: number[];
  notes?: string[];
}

export interface GameEvent {
  type: string;
  text: string;
  round: number;
  player?: PlayerId;
  regimentId?: string;
  override?: boolean;
  dice?: DiceRecord;
}

export type Validation = { ok: true } | { ok: false; reasons: string[] };

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  rng: RngState;
}

// ---------------------------------------------------------------- setup

const STAND_TYPES: StandType[] = ['Infantry', 'Cavalry', 'Brute', 'Chariot', 'Monster'];

export function toStandType(t: string): StandType | null {
  return STAND_TYPES.find((x) => x.toLowerCase() === t.trim().toLowerCase()) ?? null;
}

function toProfile(e: ListEntry): Profile {
  return { ...e.stats };
}

export interface SetupInput {
  seed: number;
  scenario: ScenarioDef;
  lists: Record<PlayerId, ArmyList>;
}

export interface SetupResult extends ApplyResult {
  warnings: string[];
}

/** Rolls off (core p.10): lowest wins, ties re-rolled. Returns the winner and every pair rolled. */
export function rollOff(rng: RngState): { winner: PlayerId; rolls: [number, number][]; rng: RngState } {
  const rolls: [number, number][] = [];
  let r = rng;
  for (;;) {
    const [a, r1] = rollD6(r);
    const [b, r2] = rollD6(r1);
    r = r2;
    rolls.push([a, b]);
    if (a !== b) return { winner: a < b ? 'P1' : 'P2', rolls, rng: r };
  }
}

/** Default formation width when a Regiment first takes the field. */
export function defaultFiles(n: number): number {
  return clampFiles(n, n <= 4 ? n : Math.ceil(n / 2));
}

/**
 * Builds the initial state from two imported lists. P1 enters from the bottom edge, P2 from the
 * top (scenario reinforcementZones). Characters start attached to the first eligible Regiment of
 * the same Type in their Warband (core p.20); the setup screen can change this.
 */
export function createGame(input: SetupInput): SetupResult {
  const warnings: string[] = [];
  const regiments: Record<string, RegimentState> = {};
  const characters: Record<string, CharacterState> = {};
  for (const pid of ['P1', 'P2'] as const) {
    const list = input.lists[pid];
    list.warbands.forEach((wb, wi) => {
      wb.regiments.forEach((e, ri) => {
        const id = `${pid}-w${wi}-r${ri}`;
        const type = toStandType(e.type);
        if (!type) warnings.push(`${pid} ${e.name}: unknown Type "${e.type}", treated as Infantry`);
        const cls = (['Light', 'Medium', 'Heavy'] as const).find((c) => c === e.cls);
        if (!cls) warnings.push(`${pid} ${e.name}: unknown Class "${e.cls ?? '-'}", treated as Medium`);
        const t = type ?? 'Infantry';
        const hasCommand = t !== 'Monster' && t !== 'Chariot'; // core p.69
        const n = Math.max(1, e.stands);
        regiments[id] = {
          id,
          owner: pid,
          name: e.name,
          type: t,
          cls: cls ?? 'Medium',
          profile: toProfile(e),
          rules: e.specialRules,
          drawEvents: e.drawEvents,
          commandModels: e.commandModels,
          warband: wi,
          stands: Array.from({ length: n }, (_, k) => ({ id: `${id}-s${k}`, wounds: 0, isCommand: hasCommand && k === 0 })),
          startingStands: n,
          files: defaultFiles(n),
          pose: { x: 0, y: 0, angle: pid === 'P1' ? Math.PI / 2 : -Math.PI / 2 },
          location: 'reserve',
          broken: false,
          activatedThisRound: false,
          arrivedRound: null,
        };
      });
      const c = wb.character;
      if (c) {
        const id = `${pid}-w${wi}-c`;
        const type = toStandType(c.type) ?? 'Infantry';
        const target = wb.regiments.findIndex((e) => toStandType(e.type) === type);
        if (target < 0) warnings.push(`${pid} ${c.name}: no Regiment of the same Type in its Warband (core p.72)`);
        characters[id] = {
          id,
          name: c.name,
          type,
          profile: toProfile(c),
          rules: c.specialRules,
          actions: c.actions,
          drawEvents: c.drawEvents,
          supremacyAbilities: c.supremacyAbilities,
          wounds: 0,
          isWarlord: c.supremacyAbilities.length > 0,
          warband: wi,
          attachedTo: target >= 0 ? `${pid}-w${wi}-r${target}` : null,
          destroyed: false,
        };
      }
    });
  }
  // Re-default files to include attached Characters.
  for (const r of Object.values(regiments)) r.files = defaultFiles(regimentStandCount({ regiments, characters } as GameState, r));

  const state: GameState = {
    seed: input.seed,
    scenario: input.scenario,
    round: 1,
    phase: 'setup',
    players: {
      P1: { id: 'P1', listName: input.lists.P1.title, faction: input.lists.P1.faction, glossary: input.lists.P1.glossary, vp: 0 },
      P2: { id: 'P2', listName: input.lists.P2.title, faction: input.lists.P2.faction, glossary: input.lists.P2.glossary, vp: 0 },
    },
    regiments,
    characters,
    activation: null,
    reinforcementLine: { P1: 0, P2: 0 },
  };
  const events: GameEvent[] = [{ type: 'setup', text: `Game created on ${input.scenario.name} (seed ${input.seed}).`, round: 1 }];
  for (const w of warnings) events.push({ type: 'warning', text: w, round: 1 });
  return { state, events, rng: createRng(input.seed), warnings };
}

// ---------------------------------------------------------------- queries

export const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');

export function attachedCharacter(s: GameState, regimentId: string): CharacterState | undefined {
  return Object.values(s.characters).find((c) => c.attachedTo === regimentId && !c.destroyed);
}

export function regimentStandCount(s: Pick<GameState, 'characters'>, r: RegimentState): number {
  return r.stands.length + (Object.values(s.characters).some((c) => c.attachedTo === r.id && !c.destroyed) ? 1 : 0);
}

export function formationInput(s: GameState, r: RegimentState, override?: Partial<Pick<RegimentState, 'pose' | 'files'>>): FormationInput {
  return { regiment: { ...r, ...override }, characterId: attachedCharacter(s, r.id)?.id ?? null };
}

export function regimentPolys(s: GameState, r: RegimentState, override?: Partial<Pick<RegimentState, 'pose' | 'files'>>): Poly[] {
  return standPolys(formationInput(s, r, override));
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

function onTable(s: GameState, polys: Poly[]): boolean {
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
    .map((r) => ({ front: Math.max(...depths(r)), rear: Math.min(...depths(r)) }))
    .sort((a, b) => b.front - a.front);
  const enemyMin = onTableRegiments(s)
    .filter((r) => r.owner !== p && !r.rules.some((x) => x.name === 'Irregular'))
    .map((r) => Math.min(...depths(r)));
  for (const f of friends) if (!enemyMin.some((e) => e <= f.rear + 1e-9)) return Math.max(0, f.rear);
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

function ok(): Validation {
  return { ok: true };
}
function fail(...reasons: string[]): Validation {
  return { ok: false, reasons };
}

/** Checks a final or intermediate position. */
function positionProblems(s: GameState, r: RegimentState, polys: Poly[], opts: { allowFriendOverlap: boolean; allowOffTable: boolean }): string[] {
  const problems: string[] = [];
  if (!opts.allowOffTable && !onTable(s, polys)) problems.push('Every Stand must stay on the Battlefield (core p.13).');
  for (const o of onTableRegiments(s)) {
    if (o.id === r.id) continue;
    const op = regimentPolys(s, o);
    if (o.owner !== r.owner) {
      if (anyOverlap(polys, op)) problems.push(`Overlaps enemy ${o.name}.`);
      // RULE-AMBIGUITY: AMB-28 — judged at the end position.
      else if (distancePolys(polys, op) < 1 - TOL) problems.push(`Within 1″ of enemy ${o.name} (core p.29).`);
    } else if (!opts.allowFriendOverlap && anyOverlap(polys, op)) problems.push(`Overlaps ${o.name} (core p.13).`);
  }
  if (markerPolys(s).some((m) => polys.some((p) => overlaps(p, m)))) problems.push('Cannot end overlapping an Objective Marker (pack p.8).');
  return problems;
}

/** Swept checks along a March path: cannot pass through enemies or engaged friends (core p.29–30). */
function pathProblems(s: GameState, r: RegimentState, poses: Pose[], allowOffTable: boolean): string[] {
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

function canTakeAction(s: GameState, regimentId: string, kind: ActionKind): string[] {
  const a = s.activation;
  if (!a || a.regimentId !== regimentId) return ['That Regiment is not active.'];
  if (a.actions.length >= 2) return ['The Regiment has used both of its Actions (core p.23).'];
  if (kind !== 'march' && kind !== 'pass' && a.actions.includes(kind)) return [`A Regiment cannot repeat ${kind} in one Activation; only March may repeat (core p.23).`];
  if (a.entering && a.actions.length === 0 && kind !== 'march') return ['A Regiment arriving from Reinforcements must March first (core p.23).'];
  return [];
}

/** March distance available for the next March this Activation (Standard Bearer included). */
export function marchAllowance(s: GameState, r: RegimentState): number {
  let m = marchValue(s, r);
  // Standard Bearer: +1″ on the second March of the Activation (core p.69).
  const sb = r.commandModels.includes('Standard Bearer') && r.stands.some((x) => x.isCommand);
  if (sb && s.activation?.actions.filter((k) => k === 'march').length === 1) m += 1;
  return m;
}

export function validate(s: GameState, a: Action): Validation {
  switch (a.type) {
    case 'attachCharacter': {
      if (s.phase !== 'setup') return fail('Characters are attached before the first Reinforcement Phase (core p.20).');
      const c = s.characters[a.characterId];
      const r = s.regiments[a.regimentId];
      if (!c || !r) return fail('Unknown Character or Regiment.');
      if (r.owner !== a.characterId.slice(0, 2)) return fail('Characters join friendly Regiments only.');
      if (r.warband !== c.warband) return fail('A Character joins a Regiment from its own Warband (core p.72).');
      if (r.type !== c.type) return fail(`A ${c.type} Character can only join a ${c.type} Regiment (core p.72).`);
      const other = Object.values(s.characters).find((x) => x.attachedTo === r.id && x.id !== c.id);
      if (other) return fail(`${r.name} already has ${other.name} attached (core p.73).`);
      return ok();
    }
    case 'startBattle':
      return s.phase === 'setup' ? ok() : fail('The battle has already started.');
    case 'setArriving': {
      const r = s.regiments[a.regimentId];
      if (!r) return fail('Unknown Regiment.');
      if (a.arriving && r.location !== 'reserve') return fail('Only Regiments in Reinforcements can be set to arrive.');
      if (!a.arriving && r.location !== 'arriving') return fail('That Regiment is not arriving.');
      return ok();
    }
    case 'activate': {
      if (s.phase !== 'play') return fail('The battle has not started.');
      if (s.activation) return fail('Finish the current Activation first.');
      const r = s.regiments[a.regimentId];
      if (!r) return fail('Unknown Regiment.');
      if (r.activatedThisRound) return fail('That Regiment has already Activated this Round (core p.23).');
      if (r.location !== 'table' && r.location !== 'arriving') return fail('That Regiment is not on the Battlefield or arriving.');
      return ok();
    }
    case 'enter': {
      const r = s.regiments[a.regimentId];
      if (!r) return fail('Unknown Regiment.');
      if (r.location !== 'arriving') return fail('That Regiment is not arriving from Reinforcements.');
      const pre = canTakeAction(s, r.id, 'march');
      if (pre.length) return fail(...pre);
      const files = clampFiles(regimentStandCount(s, r), a.files ?? r.files);
      const ep = entryProblems(s, r, a.edge, a.along, files);
      if (ep.length) return fail(...ep);
      if (a.moves.some((m) => m.kind === 'sideways' || m.kind === 'backward')) return fail('Entering Regiments March forward, with Wheels if needed (core p.31).');
      const start = entryPose(s, a.edge, a.along);
      const width = footprint(formationInput(s, r, { files, pose: start })).halfWidth * 2;
      // Vanguard (X) adds X to the first March when entering (core p.101) — manual in the MVP.
      const shape = marchShapeProblems(a.moves, marchAllowance(s, r), width);
      if (shape.length) return fail(...shape);
      const tmp: RegimentState = { ...r, files, pose: start };
      const path = samplePath(start, a.moves, width);
      const pp = pathProblems(s, tmp, path, true);
      if (pp.length) return fail(...pp);
      const end = applyPath(start, a.moves, width);
      const polys = regimentPolys(s, tmp, { pose: end });
      const canMarchAgain = (s.activation?.actions.length ?? 0) === 0;
      const problems = positionProblems(s, tmp, polys, { allowFriendOverlap: canMarchAgain, allowOffTable: canMarchAgain });
      // Stands still off the table must be brought on by a second March (core p.31).
      return problems.length ? fail(...problems) : ok();
    }
    case 'march': {
      const r = s.regiments[a.regimentId];
      if (!r) return fail('Unknown Regiment.');
      const pre = canTakeAction(s, r.id, 'march');
      if (pre.length) return fail(...pre);
      if (r.location !== 'table') return fail('That Regiment is not on the Battlefield.');
      if (isEngaged(s, r)) return fail('A Regiment in contact with an enemy cannot March; use Withdraw instead (core p.28).');
      const width = footprint(formationInput(s, r)).halfWidth * 2;
      const shape = marchShapeProblems(a.moves, marchAllowance(s, r), width);
      if (shape.length) return fail(...shape);
      const act = s.activation!;
      const offTableOk = act.entering;
      const pp = pathProblems(s, r, samplePath(r.pose, a.moves, width), offTableOk);
      if (pp.length) return fail(...pp);
      const end = applyPath(r.pose, a.moves, width);
      const canMarchAgain = act.actions.length === 0;
      const problems = positionProblems(s, r, regimentPolys(s, r, { pose: end }), {
        allowFriendOverlap: canMarchAgain,
        allowOffTable: offTableOk && canMarchAgain,
      });
      return problems.length ? fail(...problems) : ok();
    }
    case 'reform': {
      const r = s.regiments[a.regimentId];
      if (!r) return fail('Unknown Regiment.');
      const pre = canTakeAction(s, r.id, 'reform');
      if (pre.length) return fail(...pre);
      if (r.location !== 'table') return fail('That Regiment is not on the Battlefield.');
      if (isEngaged(s, r)) return fail('A Regiment in contact with an enemy uses Combat Reform instead (core p.37, p.48).');
      if (Math.abs(a.rotation) > Math.PI + 1e-9) return fail('A Reform rotates at most 180° (core p.37).');
      const n = regimentStandCount(s, r);
      if (clampFiles(n, a.files) !== a.files) return fail(`${a.files} files is not a legal formation for ${n} Stands (core p.13).`);
      const res = reformResult(s, r, a.files, a.rotation);
      if (res.maxStandMove > marchValue(s, r) + TOL)
        return fail(`A Stand would move ${res.maxStandMove.toFixed(2)}″, more than its March ${marchValue(s, r)}″ (core p.37).`);
      const problems = positionProblems(s, r, regimentPolys(s, r, { pose: res.pose, files: a.files }), { allowFriendOverlap: false, allowOffTable: false });
      return problems.length ? fail(...problems) : ok();
    }
    case 'pass':
      return s.activation ? (canTakeAction(s, s.activation.regimentId, 'pass').length ? fail('No Actions left to pass.') : ok()) : fail('No Regiment is active.');
    case 'endActivation': {
      if (!s.activation) return fail('No Regiment is active.');
      const r = s.regiments[s.activation.regimentId]!;
      if (r.location !== 'table') return ok();
      const problems = positionProblems(s, r, regimentPolys(s, r), { allowFriendOverlap: false, allowOffTable: false });
      return problems.length ? fail(...problems, 'Move again, or use the manual override.') : ok();
    }
    case 'endRound':
      if (s.activation) return fail('Finish the current Activation first.');
      return s.phase === 'play' ? ok() : fail('The battle has not started.');
    case 'override.move':
      return s.regiments[a.regimentId] ? ok() : fail('Unknown Regiment.');
  }
}

/**
 * Reform (core p.37): step 1 re-forms with the Command Stand fixed in place; step 2 rotates
 * about the Regiment's centre by up to 180°. Returns the new pose and the furthest any Stand moved
 * in step 1.
 */
export function reformResult(s: GameState, r: RegimentState, files: number, rotation: number): { pose: Pose; maxStandMove: number } {
  const before = layout(formationInput(s, r));
  const cmdBefore = before.find((x) => x.isCommand) ?? before[0];
  let pose = r.pose;
  let after = layout(formationInput(s, r, { files }));
  const cmdAfter = after.find((x) => x.id === cmdBefore?.id);
  if (cmdBefore && cmdAfter) {
    const d = sub(cmdBefore.rect.c, cmdAfter.rect.c);
    pose = { ...pose, x: pose.x + d.x, y: pose.y + d.y };
    after = layout(formationInput(s, r, { files, pose }));
  }
  // RULE-AMBIGUITY: AMB-29.
  // Stands other than the Command Stand (and the Character, which must sit beside it) may take
  // any free slot, so measure the best assignment: the smallest possible largest move.
  let maxStandMove = 0;
  const fixed = new Set<string>();
  for (const b of before) {
    if (!b.isCommand && !b.isCharacter) continue;
    fixed.add(b.id);
    const q = after.find((x) => x.id === b.id);
    if (q) maxStandMove = Math.max(maxStandMove, Math.hypot(q.rect.c.x - b.rect.c.x, q.rect.c.y - b.rect.c.y));
  }
  const from = before.filter((b) => !fixed.has(b.id)).map((b) => b.rect.c);
  const to = after.filter((b) => !fixed.has(b.id)).map((b) => b.rect.c);
  maxStandMove = Math.max(maxStandMove, bottleneckAssignment(from, to));
  const centre = footprint(formationInput(s, r, { files, pose })).c;
  const p2 = rotateAbout({ x: pose.x, y: pose.y }, centre, rotation);
  return { pose: { x: p2.x, y: p2.y, angle: pose.angle + rotation }, maxStandMove };
}

/** Smallest d such that every point in `from` can be matched to a distinct point in `to` within d. */
export function bottleneckAssignment(from: readonly { x: number; y: number }[], to: readonly { x: number; y: number }[]): number {
  if (from.length === 0) return 0;
  const d = from.map((a) => to.map((b) => Math.hypot(a.x - b.x, a.y - b.y)));
  const candidates = [...new Set(d.flat())].sort((a, b) => a - b);
  const feasible = (t: number) => {
    const match = new Array<number>(to.length).fill(-1);
    const tryAug = (i: number, seen: boolean[]): boolean => {
      for (let j = 0; j < to.length; j++) {
        if (seen[j] || d[i]![j]! > t + 1e-9) continue;
        seen[j] = true;
        if (match[j] === -1 || tryAug(match[j]!, seen)) {
          match[j] = i;
          return true;
        }
      }
      return false;
    };
    return from.every((_, i) => tryAug(i, new Array<boolean>(to.length).fill(false)));
  };
  let lo = 0;
  let hi = candidates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (feasible(candidates[mid]!)) hi = mid;
    else lo = mid + 1;
  }
  return candidates[lo] ?? 0;
}

// ---------------------------------------------------------------- apply

const f2 = (n: number) => `${Math.round(n * 100) / 100}″`;

export function describeMoves(m: readonly MoveSeg[]): string {
  return m
    .map((x) =>
      x.kind === 'forward'
        ? `forward ${f2(x.d)}`
        : x.kind === 'wheel'
          ? `wheel ${Math.round((x.angle * 180) / Math.PI)}° about ${x.pivot} corner`
          : x.kind === 'sideways'
            ? `sideways ${f2(Math.abs(x.d))} ${x.d < 0 ? 'left' : 'right'}`
            : `back ${f2(x.d)}`,
    )
    .join(', then ');
}

export function apply(state: GameState, a: Action, rng: RngState): ApplyResult {
  const v = validate(state, a);
  if (!v.ok) throw new Error(`Illegal action ${a.type}: ${v.reasons.join(' ')}`);
  const s: GameState = structuredClone(state);
  const events: GameEvent[] = [];
  const ev = (e: Omit<GameEvent, 'round'>) => events.push({ round: s.round, ...e });

  switch (a.type) {
    case 'attachCharacter': {
      const c = s.characters[a.characterId]!;
      c.attachedTo = a.regimentId;
      for (const r of Object.values(s.regiments)) r.files = clampFiles(regimentStandCount(s, r), r.files);
      ev({ type: 'attach', text: `${c.name} joins ${s.regiments[a.regimentId]!.name}.`, regimentId: a.regimentId });
      break;
    }
    case 'startBattle':
      s.phase = 'play';
      s.reinforcementLine = { P1: computeReinforcementLine(s, 'P1'), P2: computeReinforcementLine(s, 'P2') };
      ev({ type: 'round', text: 'Round 1 begins.' });
      break;
    case 'setArriving': {
      const r = s.regiments[a.regimentId]!;
      r.location = a.arriving ? 'arriving' : 'reserve';
      ev({ type: 'reinforcement', text: `${r.name} ${a.arriving ? 'will arrive this Round' : 'stays in Reinforcements'}.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'activate': {
      const r = s.regiments[a.regimentId]!;
      s.activation = { regimentId: r.id, actions: [], entering: r.location === 'arriving', startPose: r.pose };
      ev({ type: 'activate', text: `${r.owner} activates ${r.name}.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'enter': {
      const r = s.regiments[a.regimentId]!;
      r.files = clampFiles(regimentStandCount(s, r), a.files ?? r.files);
      const start = entryPose(s, a.edge, a.along);
      const width = footprint(formationInput(s, r, { pose: start })).halfWidth * 2;
      r.pose = applyPath(start, a.moves, width);
      r.location = 'table';
      r.arrivedRound = s.round;
      s.activation!.actions.push('march');
      ev({ type: 'march', text: `${r.name} marches on from the ${a.edge} edge at ${f2(a.along)}: ${describeMoves(a.moves) || 'onto the edge'}.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'march': {
      const r = s.regiments[a.regimentId]!;
      const width = footprint(formationInput(s, r)).halfWidth * 2;
      r.pose = applyPath(r.pose, a.moves, width);
      s.activation!.actions.push('march');
      ev({ type: 'march', text: `${r.name} marches: ${describeMoves(a.moves)}.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'reform': {
      const r = s.regiments[a.regimentId]!;
      const res = reformResult(state, state.regiments[a.regimentId]!, a.files, a.rotation);
      r.files = a.files;
      r.pose = res.pose;
      s.activation!.actions.push('reform');
      ev({ type: 'reform', text: `${r.name} reforms to ${a.files} files${a.rotation ? `, turning ${Math.round((a.rotation * 180) / Math.PI)}°` : ''}.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'pass':
      s.activation!.actions.push('pass');
      ev({ type: 'pass', text: `${s.regiments[s.activation!.regimentId]!.name} passes an Action.` });
      break;
    case 'endActivation': {
      const r = s.regiments[s.activation!.regimentId]!;
      r.activatedThisRound = true;
      if (r.location === 'arriving') {
        // Could not enter: returns to Reinforcements (core p.31).
        r.location = 'reserve';
        ev({ type: 'reinforcement', text: `${r.name} did not enter and returns to Reinforcements.`, player: r.owner, regimentId: r.id });
      }
      s.activation = null;
      ev({ type: 'deactivate', text: `${r.name} ends its Activation.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'endRound': {
      for (const r of Object.values(s.regiments)) r.activatedThisRound = false;
      s.round += 1;
      if (s.round > s.scenario.rounds) {
        s.phase = 'ended';
        ev({ type: 'end', text: 'The battle is over.' });
      } else {
        s.reinforcementLine = { P1: computeReinforcementLine(s, 'P1'), P2: computeReinforcementLine(s, 'P2') };
        ev({ type: 'round', text: `Round ${s.round} begins.` });
      }
      break;
    }
    case 'override.move': {
      const r = s.regiments[a.regimentId]!;
      r.pose = a.pose;
      if (a.files) r.files = clampFiles(regimentStandCount(s, r), a.files);
      if (r.location === 'reserve' || r.location === 'arriving') {
        r.location = 'table';
        r.arrivedRound ??= s.round;
      }
      ev({ type: 'override', override: true, text: `OVERRIDE: ${r.name} moved by hand${a.reason ? ` (${a.reason})` : ''}.`, player: r.owner, regimentId: r.id });
      break;
    }
  }
  return { state: s, events, rng };
}

/** The Regiment's Class, including the Class adopted by an attached Character (core p.72). */
export function regimentClass(r: RegimentState): UnitClass {
  return r.cls;
}
