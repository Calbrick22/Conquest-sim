import { grantExtras, heal, onActivationStart, recordAction } from './activation';
import type { ArmyList, ListEntry } from '../import/types';
import type { Edge, ScenarioDef } from '../scenarios/types';
import type { StandType } from './geometry/bases';
import { rotateAbout, sub, TOL } from './geometry/vec';
import { clampFiles, footprint, layout } from './formation';
import { applyPath, marchShapeProblems, samplePath, type MoveSeg } from './movement';
import { overlaps } from './geometry/polygon';
import type { CharacterState, GameState, PlayerId, Pose, PowerPool, Profile, RegimentState, StrainDef, TierProfileDef, UnitClass } from './model/types';
import { createRng, rollD6, type RngState } from './rng';
import type { Ctx } from './dice';
import { applyM4, endActivation, logManualRules, validateM4 } from './gameM4';
import { initSorcererKings } from './factions/sorcererKings';
import { initDweghom } from './factions/dweghom';
import { dwActivationStart, dwAfterApply } from './factions/dweghomActions';
import { applySpecialMove, SPECIAL_MOVE_LABEL, specialMoveProblems, type SpecialMoveKind } from './specialMoves';
import { skActivationStart, skAfterApply } from './factions/sorcererKingsActions';
import { beginRound, cardTargets, passTurn, type ReinforcementChoice } from './round';
import { victoryPhase } from './scoring/victory';
import './rules/special/rules';
import { applyCharacterOptions, refreshRules } from './rules/special/grants';
import { flushPower, initOldDominion } from './factions/oldDominion';
import { odActivationStartSpells, type OdClashOption } from './factions/oldDominionActions';
import { applyDesignate, defaultDesignations, designateProblems } from './scoring/designations';
import { applySpiresAction, assassinsLost, initInfluence, optimizationStrains, spiresActionProblems, wardAfterAction, type AssassinPlan, type SpiresAction } from './factions/spiresExtras';
import { strainFor } from './factions/spires';
import { parseRuleRef } from '../import/ruleTokens';
import {
  canTakeAction,
  entryPose,
  entryProblems,
  fail,
  formationInput,
  isEngaged,
  marchAllowance,
  marchValue,
  ok,
  pathProblems,
  positionProblems,
  regimentPolys,
  regimentStandCount,
  type Validation,
} from './queries';

// ---------------------------------------------------------------- actions and events

export type Action = ActionBody & {
  /** Reason shown in the log when the computer opponent chose this Action. */
  why?: string;
};

export type ActionBody =
  | { type: 'attachCharacter'; characterId: string; regimentId: string }
  | { type: 'startBattle' }
  | { type: 'setArriving'; regimentId: string; arriving: boolean }
  | { type: 'activate'; regimentId: string }
  | { type: 'enter'; regimentId: string; edge: Edge; along: number; files?: number; moves: MoveSeg[] }
  | { type: 'march'; regimentId: string; moves: MoveSeg[] }
  | { type: 'reform'; regimentId: string; files: number; rotation: number }
  | { type: 'pass' }
  | { type: 'endActivation'; entourage?: boolean }
  | { type: 'endRound' }
  // Round sequence (core p.20–25)
  /** priority: the order in which Regiments come on with successful Reinforcement Rolls of their Class (core p.21). */
  | { type: 'reinforcements'; player: PlayerId; choice: ReinforcementChoice | null; flank?: Record<string, boolean>; priority?: string[] }
  | { type: 'setStack'; player: PlayerId; order: string[] }
  | { type: 'supremacyRollOff' }
  | { type: 'chooseFirst'; first: PlayerId }
  | { type: 'useSupremacy'; player: PlayerId; targets?: { id: string; option?: string }[] }
  | { type: 'pickZone'; player: PlayerId; zoneId: string }
  | { type: 'drawCard'; player: PlayerId }
  | { type: 'activateCharacter'; characterId: string }
  | { type: 'drawEvent'; name: string; option?: string; options?: string[]; targetId?: string; observe?: boolean }
  | { type: 'lobotomy'; player: PlayerId; place: 'top' | 'bottom' }
  // Combat and other Actions (core p.31–51, p.74–76)
  | { type: 'charge'; regimentId: string; targetId: string }
  | { type: 'placeCharge'; pose: Pose }
  | { type: 'failCharge' }
  /** ruthless: Ruthless Competence (sp p.9); arcing: Arcing Fire (core p.97). */
  | { type: 'volley'; regimentId: string; targetId: string; ruthless?: boolean; arcing?: boolean }
  /** Scenario designations: Chosen Regiments or Linebreakers (ns p.2, p.6). */
  | { type: 'designate'; player: PlayerId; regimentIds: string[] }
  /** Spires choices outside the normal Actions (sp p.8–35). */
  | { type: 'spires'; player: PlayerId; act: SpiresAction }
  /**
   * Clash (core p.44) with choices made as it is declared: Ruthless Competence (sp p.9), No Matter the
   * Price and Catabolic Node (sp p.30–31), the Mimetic Assassin's Assassination Directive (sp p.24).
   */
  | { type: 'clash'; regimentId: string; targetId: string; ruthless?: boolean; price?: boolean; detonate?: boolean; assassin?: AssassinPlan }
  | { type: 'takeAim'; regimentId: string }
  | { type: 'inspire'; regimentId: string }
  | { type: 'rally'; regimentId: string }
  | { type: 'combatRally'; regimentId: string }
  | { type: 'combatReform'; regimentId: string; files: number }
  | { type: 'withdraw'; regimentId: string; moves: MoveSeg[]; turn?: boolean }
  | { type: 'duel'; characterId: string; targetCharacterId: string; accept: boolean }
  | { type: 'characterAbility'; characterId: string; name: string; targetId?: string; target2Id?: string; observe?: boolean }
  // Spellcasting (core p.80–81) and Old Dominion faction Actions (od p.5–8)
  | { type: 'spell'; casterId: string; spell: string; targetId: string; attunement?: number; pool?: PowerPool; boost?: number }
  | { type: 'memories'; regimentId: string }
  // Sorcerer Kings (sk p.5, p.22–25, p.42–46)
  | { type: 'prepareRitual'; player: PlayerId; ritual: string }
  | { type: 'ritual'; player: PlayerId; targetId?: string; terrainId?: string; option?: number; order?: string[] }
  | { type: 'skForm'; regimentId: string; group: string; option: string }
  | { type: 'gildedStatue'; regimentId: string }
  // Moves outside the March rules: Air Step, Translocation, On Soaring Winds (specialMoves.ts)
  | { type: 'specialMove'; regimentId: string; kind: SpecialMoveKind; moves: MoveSeg[] }
  | { type: 'skipMove' }
  // Dweghom (dw p.4–45)
  | { type: 'dwSpend'; regimentId: string; what: 'wander' | 'herald' }
  | { type: 'dwRaegh'; player: PlayerId; regimentIds: string[] }
  // Flames of Conquest (ns p.5)
  | { type: 'burnZone'; regimentId: string; zoneId: string }
  | { type: 'powerPref'; player: PlayerId; pool: PowerPool }
  | { type: 'odSpend'; regimentId: string; option: 'aod' | 'noBrittle' | 'terrifying' }
  /** Old Dominion Power Token spends as a Clash or Duel is declared (od p.10, p.20). */
  | { type: 'odClash'; regimentId: string; option: OdClashOption; amount?: number }
  // Manual tools (always logged as overrides)
  | { type: 'override.move'; regimentId: string; pose: Pose; files?: number; reason?: string }
  | { type: 'override.wounds'; regimentId?: string; characterId?: string; delta: number }
  | { type: 'override.stat'; regimentId: string; stat: keyof Profile; delta: number }
  | { type: 'override.broken'; regimentId: string; broken: boolean }
  | { type: 'override.forceDice'; values: number[] };

export type { DiceRecord, GameEvent } from './model/events';
import type { GameEvent } from './model/events';

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  rng: RngState;
}

// ---------------------------------------------------------------- setup

/** Strain abilities the owner entered on the review screen (AMB-18). */
export function toStrains(list: ArmyList): Record<string, StrainDef> {
  const out: Record<string, StrainDef> = {};
  for (const [name, d] of Object.entries(list.strains ?? {})) {
    out[name] = { stats: d.stats as StrainDef['stats'], ...(d.enemyStats ? { enemyStats: d.enemyStats as StrainDef['stats'] } : {}), rules: d.rules.map((r) => parseRuleRef(r)), text: d.text };
  }
  return out;
}

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

const hasOption = (c: CharacterState, n: string) => c.options.some((o) => o.toLowerCase() === n.toLowerCase());

/**
 * May this Character join this Regiment (core p.72)? Same Type, except: Bound to the Elements
 * (sk p.17) takes the Regiment's Type; the Lost Ancestor (a Brute) may join Infantry (dw p.20).
 */
export function attachTypeOk(c: CharacterState, r: RegimentState): boolean {
  // A Rider must ride its mount: a Monster Regiment, the named one for a rider upgrade (core p.100).
  if (c.rider) {
    const m = riderMount(c);
    return r.type === 'Monster' && (!m || r.name === m);
  }
  if (r.type === c.type) return true;
  if (hasOption(c, 'Bound to the Elements')) return true;
  if (hasOption(c, 'Lineage Commander') && r.name === 'Bound Clones') return true;
  return c.name === 'Lost Ancestor' && c.type === 'Brute' && r.type === 'Infantry';
}

/**
 * Upgrades that make a Character a Rider, and the Monster it must ride: Bergont Raegh (Ironclad
 * Drake), Hellbringer Sorcerer (Hellbringer Drake), Ferric Throne (Stoneforged) (dw p.24–25) and
 * Favored of Hormus (Mahut, sk p.17).
 */
export const RIDER_MOUNTS: Record<string, string> = {
  'bergont raegh': 'Ironclad Drake',
  'hellbringer sorcerer': 'Hellbringer Drake',
  'ferric throne': 'Stoneforged',
  'favored of hormus': 'Mahut',
  'favoured of hormus': 'Mahut',
};

/** The Monster a Rider must ride, if an upgrade names one. */
export function riderMount(c: CharacterState): string | undefined {
  const o = c.options.map((x) => x.toLowerCase().replace(/[’]/g, "'")).find((x) => RIDER_MOUNTS[x]);
  return o ? RIDER_MOUNTS[o] : undefined;
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
          baseRules: e.specialRules,
          roundRules: [],
          drawEvents: e.drawEvents,
          baseDrawEvents: e.drawEvents,
          commandModels: e.commandModels,
          roles: e.battlefieldRoles,
          options: Object.values(e.options).flat(),
          notes: e.notes,
          ...(e.memories?.length ? { memories: e.memories } : {}),
          ...(e.memoriesText ? { memoriesText: e.memoriesText } : {}),
          ...(e.spells?.length ? { spells: e.spells } : {}),
          warband: wi,
          stands: Array.from({ length: n }, (_, k) => ({ id: `${id}-s${k}`, wounds: 0, isCommand: hasCommand && k === 0 })),
          startingStands: n,
          files: defaultFiles(n),
          pose: { x: 0, y: 0, angle: pid === 'P1' ? Math.PI / 2 : -Math.PI / 2 },
          location: 'reserve',
          broken: false,
          activatedThisRound: false,
          arrivedRound: null,
          standsAtRoundStart: n,
          standsWhenBroken: null,
          roundMods: [],
          flags: {},
        };
      });
      const c = wb.character;
      if (c) {
        const id = `${pid}-w${wi}-c`;
        const type = toStandType(c.type) ?? 'Infantry';
        // A Monster Character that is a Regiment by itself (Old Dominion Fallen Divinity and
        // Theokrator, od p.8, p.15): it gets its own one-Stand Monster Regiment.
        // RULE-AMBIGUITY: AMB-48 — Duels with these Characters are manual.
        const embodied = type === 'Monster' && list.faction && (/old dominion/i.test(list.faction) || c.specialRules.some((x) => x.name === 'Animate Vessel'));
        // Life for Glory (Flame Berserkers, dw p.31): no Character may be attached to them.
        const noCharacter = (e: { name: string }) => /dweghom/i.test(list.faction) && e.name === 'Flame Berserkers';
        let target = embodied ? -1 : wb.regiments.findIndex((e) => toStandType(e.type) === type && !noCharacter(e));
        let attachId: string | null = target >= 0 ? `${pid}-w${wi}-r${target}` : null;
        if (embodied) {
          const rid = `${pid}-w${wi}-cr`;
          const cls = (['Light', 'Medium', 'Heavy'] as const).find((k) => k === c.cls) ?? 'Heavy';
          regiments[rid] = {
            id: rid,
            owner: pid,
            name: c.name,
            type: 'Monster',
            cls,
            profile: toProfile(c),
            rules: c.specialRules,
            baseRules: [...c.specialRules],
            roundRules: [],
            drawEvents: c.drawEvents,
            baseDrawEvents: c.drawEvents,
            commandModels: [],
            roles: c.battlefieldRoles,
            options: Object.values(c.options).flat(),
            notes: c.notes,
            ...(c.spells?.length ? { spells: c.spells } : {}),
            embodies: id,
            tierBase: { profile: toProfile(c), rules: [...c.specialRules] },
            warband: wi,
            stands: [{ id: `${rid}-s0`, wounds: 0, isCommand: false }],
            startingStands: 1,
            files: 1,
            pose: { x: 0, y: 0, angle: pid === 'P1' ? Math.PI / 2 : -Math.PI / 2 },
            location: 'reserve',
            broken: false,
            activatedThisRound: false,
            arrivedRound: null,
            standsAtRoundStart: 1,
            standsWhenBroken: null,
            roundMods: [],
            flags: {},
          };
          attachId = rid;
          target = 0;
        }
        if (target < 0) warnings.push(`${pid} ${c.name}: no Regiment of the same Type in its Warband (core p.72)`);
        characters[id] = {
          id,
          name: c.name,
          type,
          profile: toProfile(c),
          rules: c.specialRules,
          baseRules: [...c.specialRules],
          actions: c.actions,
          drawEvents: embodied ? [] : c.drawEvents,
          baseDrawEvents: embodied ? [] : c.drawEvents,
          supremacyAbilities: c.supremacyAbilities,
          options: Object.values(c.options).flat(),
          ...(c.battlefieldRoles.length ? { roles: c.battlefieldRoles } : {}),
          ...(c.spells?.length && !embodied ? { spells: c.spells } : {}),
          ...(embodied ? { embodied: true } : {}),
          wounds: 0,
          isWarlord: c.supremacyAbilities.length > 0,
          warband: wi,
          attachedTo: attachId,
          destroyed: false,
          activatedThisRound: false,
        };
      }
    });
  }
  // Bound to the Elements (sk p.17): the Character takes the Type of the Regiment it joins.
  for (const c of Object.values(characters)) if (hasOption(c, 'Bound to the Elements') && c.attachedTo) c.type = regiments[c.attachedTo]!.type;
  // List-building options that change a Character (e.g. Avatar Projection makes it a Brute).
  for (const c of Object.values(characters)) {
    if (c.embodied) continue;
    const before = c.type;
    applyCharacterOptions(c);
    if (c.type !== before) {
      const wb = Object.values(regiments).filter((r) => r.owner === c.id.slice(0, 2) && r.warband === c.warband);
      c.attachedTo = wb.find((r) => r.type === c.type)?.id ?? null;
      if (!c.attachedTo) warnings.push(`${c.name}: no ${c.type} Regiment in its Warband to join (core p.72)`);
    }
  }
  // Hierotekton (od p.19): the Character must attach to its Warband's Bone Golems (the export
  // already shows the Brute Type, Impact and Aura of Death on both; AMB-76).
  for (const c of Object.values(characters)) {
    if (!hasOption(c, 'Hierotekton')) continue;
    const bg = Object.values(regiments).find((r) => r.owner === c.id.slice(0, 2) && r.warband === c.warband && r.name === 'Bone Golems');
    if (bg) c.attachedTo = bg.id;
  }
  for (const c of Object.values(characters)) {
    if (!/spires/i.test(c.id.startsWith('P1') ? input.lists.P1.faction : input.lists.P2.faction)) continue;
    // Infiltration / Marksman Optimization Strain (sp p.31): Barrage profiles.
    optimizationStrains(c);
    // Lineage Commander (sp p.30): attached to a Bound Clones Regiment even though it is a Brute.
    if (hasOption(c, 'Lineage Commander')) {
      const bc = Object.values(regiments).find((r) => r.owner === c.id.slice(0, 2) && r.warband === c.warband && r.name === 'Bound Clones');
      if (bc) c.attachedTo = bc.id;
    }
    // Assassination Directive (sp p.24): the Mimetic Assassin starts unattached and joins a Clash later.
    if (/mimetic assassin/i.test(c.name)) c.attachedTo = null;
    // Grotesque Elixir, Preservation Protocols (sp p.28, p.30): Character Actions.
    for (const n of ['Grotesque Elixir', 'Preservation Protocols']) if (hasOption(c, n) && !c.actions.some((x) => x.name === n)) c.actions = [...c.actions, parseRuleRef(n)];
  }
  // Rider (core p.100): the Character has no Stand and rides a Monster of its Warband.
  for (const c of Object.values(characters)) {
    if (c.embodied) continue;
    const mount = riderMount(c);
    if (!mount && !c.baseRules.some((x) => x.name === 'Rider')) continue;
    c.rider = true;
    if (!c.baseRules.some((x) => x.name === 'Rider')) c.baseRules.push(parseRuleRef('Rider'));
    const wb = Object.values(regiments).filter((r) => r.owner === c.id.slice(0, 2) && r.warband === c.warband && r.type === 'Monster' && (!mount || r.name === mount));
    const taken = (r: RegimentState) => Object.values(characters).some((x) => x !== c && x.attachedTo === r.id);
    c.attachedTo = wb.find((r) => !taken(r))?.id ?? null;
    if (!c.attachedTo) warnings.push(`${c.name}: no ${mount ?? 'Monster'} in its Warband to ride (core p.100)`);
  }
  // Re-default files to include attached Characters.
  for (const r of Object.values(regiments)) r.files = defaultFiles(regimentStandCount({ regiments, characters } as GameState, r));

  const state: GameState = {
    seed: input.seed,
    scenario: input.scenario,
    round: 1,
    phase: 'setup',
    players: {
      P1: { id: 'P1', listName: input.lists.P1.title, faction: input.lists.P1.faction, points: input.lists.P1.pointsLimit ?? input.lists.P1.points, glossary: input.lists.P1.glossary, vp: 0, stack: [], stackSet: false, reinforcementDone: false, supremacyUsed: false, sect: input.lists.P1.sect, strains: toStrains(input.lists.P1), lobotomyUsed: false },
      P2: { id: 'P2', listName: input.lists.P2.title, faction: input.lists.P2.faction, points: input.lists.P2.pointsLimit ?? input.lists.P2.points, glossary: input.lists.P2.glossary, vp: 0, stack: [], stackSet: false, reinforcementDone: false, supremacyUsed: false, sect: input.lists.P2.sect, strains: toStrains(input.lists.P2), lobotomyUsed: false },
    },
    regiments,
    characters,
    activation: null,
    reinforcementLine: { P1: 0, P2: 0 },
    step: 'reinforcement',
    firstPlayer: null,
    supremacyWinner: null,
    turn: null,
    drawn: null,
    pendingCharge: null,
    forcedDice: [],
    tally: { charactersKilled: { P1: 0, P2: 0 }, regimentsDestroyed: { P1: 0, P2: 0 }, warlordSlain: { P1: false, P2: false }, markersDestroyed: { P1: [], P2: [] } },
    markers: Object.fromEntries(input.scenario.markers.map((m) => [m.id, { id: m.id, woundsBy: { P1: 0, P2: 0 }, destroyed: false }])),
    zonePicks: { P1: null, P2: null },
    scoreHistory: [],
    warlordScored: { P1: false, P2: false },
  };
  // Just Desserts, The Directorate (+2 March) is already included in the exported March value,
  // so it is not added again.
  for (const pid of ['P1', 'P2'] as const) {
    const tp = input.lists[pid].tierProfiles;
    if (tp)
      state.players[pid].tierProfiles = Object.fromEntries(
        Object.entries(tp).map(([name, tiers]) => [name, Object.fromEntries(Object.entries(tiers).map(([t, d]) => [t, { stats: d.stats as TierProfileDef["stats"], rules: d.rules.map((x) => parseRuleRef(x)) }]))]),
      );
  }
  // Strain Expression without an entered Strain gives only Decay (AMB-18): say so up front.
  for (const r of Object.values(regiments))
    if (r.baseDrawEvents.some((d) => d.startsWith('Strain Expression')) && !strainFor(state, r))
      warnings.push(`${r.owner} ${r.name}: no Strain entered on the list review screen, so Strain Expression gives only Decay`);
  // Entries that start the battle with Wound Markers (e.g. Consumption Beast, sp p.33).
  for (const r of Object.values(regiments)) {
    const m = (r.notes ?? []).join(' ').match(/starts the Battle with (\d+) Wound Markers/i);
    if (m && r.stands[0]) r.stands[0].wounds = Math.min(Number(m[1]), Math.max(0, (r.profile.W ?? 1) - 1));
  }
  initOldDominion(state);
  initSorcererKings(state);
  initDweghom(state);
  refreshRules(state);
  const events: GameEvent[] = [{ type: 'setup', text: `Game created on ${input.scenario.name} (seed ${input.seed}).`, round: 1 }];
  for (const w of warnings) events.push({ type: 'warning', text: w, round: 1 });
  return { state, events, rng: createRng(input.seed), warnings };
}

export * from './queries';

export function validate(s: GameState, a: Action): Validation {
  switch (a.type) {
    case 'attachCharacter': {
      if (s.phase !== 'setup') return fail('Characters are attached before the first Reinforcement Phase (core p.20).');
      const c = s.characters[a.characterId];
      const r = s.regiments[a.regimentId];
      if (!c || !r) return fail('Unknown Character or Regiment.');
      if (r.owner !== a.characterId.slice(0, 2)) return fail('Characters join friendly Regiments only.');
      if (r.warband !== c.warband) return fail('A Character joins a Regiment from its own Warband (core p.72).');
      if (!attachTypeOk(c, r)) return fail(`A ${c.type} Character can only join a ${c.type} Regiment (core p.72).`);
      // Life for Glory (Flame Berserkers, dw p.31): no Character can be attached.
      if (r.name === 'Flame Berserkers' && /dweghom/i.test(s.players[r.owner].faction)) return fail('A Character cannot be attached to Flame Berserkers (dw p.31).');
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
      if (s.step !== 'action') return fail('Regiments Activate in the Action Phase (core p.22).');
      if (!s.drawn || s.drawn.card.kind !== 'regiment') return fail('Draw a Command Card first (core p.22).');
      if (!cardTargets(s, s.drawn.player, s.drawn.card).includes(r.id)) return fail(`The ${s.drawn.card.name} card cannot Activate ${r.name} (core p.22).`);
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
      // Fire and Advance: the free March cannot move sideways or backward (core p.94).
      const fwdOnly = act.actions.length >= 2 && act.extra?.find((e) => !e.used && e.kind === 'march')?.forwardOnly;
      if (fwdOnly && a.moves.some((m) => m.kind === 'sideways' || m.kind === 'backward')) return fail('This free March cannot move sideways or backward (Fire and Advance, core p.94).');
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
      if (r.flags.reinforced) return fail('Reinforce (the Pattern): it cannot Reform this Round (sk p.21).');
      if (Math.abs(a.rotation) > Math.PI + 1e-9) return fail('A Reform rotates at most 180° (core p.37).');
      const n = regimentStandCount(s, r);
      if (clampFiles(n, a.files) !== a.files) return fail(`${a.files} files is not a legal formation for ${n} Stands (core p.13).`);
      const res = reformResult(s, r, a.files, a.rotation);
      if (res.maxStandMove > marchValue(s, r) + TOL)
        return fail(`A Stand would move ${res.maxStandMove.toFixed(2)}″, more than its March ${marchValue(s, r)}″ (core p.37).`);
      const problems = positionProblems(s, r, regimentPolys(s, r, { pose: res.pose, files: a.files }), { allowFriendOverlap: false, allowOffTable: false });
      return problems.length ? fail(...problems) : ok();
    }
    case 'specialMove': {
      const p = specialMoveProblems(s, a.regimentId, a.moves, a.kind);
      return p.length ? fail(...p) : ok();
    }
    case 'skipMove':
      return s.pendingMove ? ok() : fail('No move is waiting.');
    case 'spires': {
      const p = spiresActionProblems(s, a.player, a.act);
      return p.length ? fail(...p) : ok();
    }
    case 'designate': {
      const p = designateProblems(s, a.player, a.regimentIds);
      return p.length ? fail(...p) : ok();
    }
    case 'pass':
      return s.activation ? (canTakeAction(s, s.activation.regimentId, 'pass').length ? fail('No Actions left to pass.') : ok()) : fail('No Regiment is active.');
    case 'endActivation': {
      if (!s.activation) return fail('No Regiment is active.');
      const r = s.regiments[s.activation.regimentId]!;
      if (r.location !== 'table') return ok();
      const problems = positionProblems(s, r, regimentPolys(s, r), { allowFriendOverlap: false, allowOffTable: false, enemyGap: false });
      return problems.length ? fail(...problems, 'Move again, or use the manual override.') : ok();
    }
    case 'endRound':
      if (s.phase !== 'play') return fail('The battle has not started.');
      if (s.activation || s.drawn) return fail('Finish the current Activation first.');
      if (s.step !== 'victory') return fail('Every Command Card must be played before the Victory Phase (core p.22).');
      return ok();
    default:
      return validateM4(s, a);
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
  const ctx: Ctx = { s, rng, events };
  // A move offered outside the sequence (Air Step, Translocation) lapses when anything else happens.
  if (s.pendingMove && a.type !== 'specialMove' && !a.type.startsWith('override')) {
    ev({ type: 'note', text: `${s.regiments[s.pendingMove.regimentId]?.name ?? 'The Regiment'} does not use its ${SPECIAL_MOVE_LABEL[s.pendingMove.kind]} move.` });
    delete s.pendingMove;
  }

  switch (a.type) {
    case 'attachCharacter': {
      const c = s.characters[a.characterId]!;
      c.attachedTo = a.regimentId;
      // Bound to the Elements (sk p.17): the Character changes its Type to match its Regiment.
      if (hasOption(c, 'Bound to the Elements')) c.type = s.regiments[a.regimentId]!.type;
      for (const r of Object.values(s.regiments)) r.files = clampFiles(regimentStandCount(s, r), r.files);
      ev({ type: 'attach', text: `${c.name} joins ${s.regiments[a.regimentId]!.name}.`, regimentId: a.regimentId });
      break;
    }
    case 'startBattle':
      s.phase = 'play';
      // Tricks of the Trade (sp p.10): the Influence Pool is rolled before the first Reinforcement Phase.
      initInfluence(ctx);
      // Chosen Regiments / Linebreakers (ns p.2, p.6): default designations, changeable until the first Supremacy Phase.
      defaultDesignations(ctx);
      beginRound(s);
      ev({ type: 'round', text: 'Round 1 begins: Reinforcement Phase.' });
      break;
    case 'setArriving': {
      const r = s.regiments[a.regimentId]!;
      r.location = a.arriving ? 'arriving' : 'reserve';
      ev({ type: 'override', override: true, text: `OVERRIDE: ${r.name} ${a.arriving ? 'set to arrive this Round' : 'kept in Reinforcements'} by hand.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'activate': {
      const r = s.regiments[a.regimentId]!;
      const card = s.drawn?.card ?? null;
      const afterRitual = s.drawn?.afterRitual;
      s.drawn = null;
      s.activation = { regimentId: r.id, actions: [], entering: r.location === 'arriving', startPose: r.pose, drawEventDone: false, aimed: false, inspired: false, ended: false };
      ev({ type: 'activate', text: `${r.owner} activates ${r.name}.`, player: r.owner, regimentId: r.id });
      if (onActivationStart(ctx, r, card)) {
        skActivationStart(ctx, r, afterRitual);
        dwActivationStart(ctx, r);
        odActivationStartSpells(ctx);
        logManualRules(ctx, r);
      } else if (!s.players[r.owner].stack.length) passTurn(s, r.owner); // nothing left to draw again (core p.97)
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
      recordAction(s.activation!, 'march');
      ev({ type: 'march', text: `${r.name} marches on from the ${a.edge} edge at ${f2(a.along)}: ${describeMoves(a.moves) || 'onto the edge'}.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'march': {
      const r = s.regiments[a.regimentId]!;
      const width = footprint(formationInput(s, r)).halfWidth * 2;
      // Spined Descent (Pteraphon Surveyor, sp p.48): remember the Regiments it moves over.
      if (r.name === 'Pteraphon Surveyor' && s.activation) {
        const over = new Set(s.activation.movedOver ?? []);
        for (const pose of samplePath(r.pose, a.moves, width)) {
          const polys = regimentPolys(s, r, { pose });
          for (const o of Object.values(s.regiments)) if (o.id !== r.id && o.location === 'table' && polys.some((p) => regimentPolys(s, o).some((q) => overlaps(p, q)))) over.add(o.id);
        }
        s.activation.movedOver = [...over];
      }
      r.pose = applyPath(r.pose, a.moves, width);
      recordAction(s.activation!, 'march');
      ev({ type: 'march', text: `${r.name} marches: ${describeMoves(a.moves)}.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'reform': {
      const r = s.regiments[a.regimentId]!;
      const res = reformResult(state, state.regiments[a.regimentId]!, a.files, a.rotation);
      r.files = a.files;
      r.pose = res.pose;
      recordAction(s.activation!, 'reform');
      ev({ type: 'reform', text: `${r.name} reforms to ${a.files} files${a.rotation ? `, turning ${Math.round((a.rotation * 180) / Math.PI)}°` : ''}.`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'pass':
      recordAction(s.activation!, 'pass');
      ev({ type: 'pass', text: `${s.regiments[s.activation!.regimentId]!.name} passes an Action.` });
      break;
    case 'endActivation': {
      endActivation(ctx, !!a.entourage);
      break;
    }
    case 'endRound': {
      // Assassination Directive (sp p.24): a Mimetic Assassin that never entered is destroyed before the last Victory Phase.
      if (s.round >= s.scenario.rounds) assassinsLost(ctx);
      ev({ type: 'victory', text: `Victory Phase, Round ${s.round}.` });
      victoryPhase(ctx);
      s.round += 1;
      if (s.round > s.scenario.rounds) {
        s.phase = 'ended';
        ev({ type: 'end', text: 'The battle is over.' });
      } else {
        beginRound(s);
        ev({ type: 'round', text: `Round ${s.round} begins: Reinforcement Phase.` });
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
    case 'specialMove':
      applySpecialMove(ctx, a.regimentId, a.moves, a.kind, describeMoves);
      break;
    case 'skipMove':
      break; // the pending move lapsed above
    case 'spires':
      applySpiresAction(ctx, a.player, a.act, heal);
      break;
    case 'designate':
      applyDesignate(ctx, a.player, a.regimentIds);
      break;
    default:
      applyM4(ctx, a);

  }
  if (ctx.s.activation) grantExtras(ctx, ctx.s.activation);
  refreshRules(ctx.s);
  // Ward Preceptor (sp p.36): an enemy that ended its movement within 8″.
  if (['march', 'enter', 'withdraw', 'charge', 'placeCharge', 'specialMove'].includes(a.type) && 'regimentId' in a) wardAfterAction(ctx, ctx.s.regiments[a.regimentId as string]);
  // Sorcerer Kings: Ritual access, Shattered Perfection, Air Elemental, Last Word (sk p.5–46).
  skAfterApply(ctx);
  // Dweghom: Paragon of War (dw p.6).
  dwAfterApply(ctx);
  refreshRules(ctx.s);
  // Power Tokens earned during the Action are added at its end (od p.6).
  if (ctx.power?.length) {
    flushPower(ctx);
    refreshRules(ctx.s);
  }
  if (a.why) ctx.events.push({ type: 'ai', round: state.round, text: `AI: ${a.why}` });
  return { state: ctx.s, events: ctx.events, rng: ctx.rng };
}

/** The Regiment's Class, including the Class adopted by an attached Character (core p.72). */
export function regimentClass(r: RegimentState): UnitClass {
  return r.cls;
}
