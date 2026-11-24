import type { RuleRef } from '../../import/types';
import type { PlayerId, ScenarioDef, Edge } from '../../scenarios/types';
import type { StandType } from '../geometry/bases';

export type { PlayerId };

export type UnitClass = 'Light' | 'Medium' | 'Heavy';

/** Characteristics as numbers; null where the list shows "-". */
export interface Profile {
  M: number | null;
  V: number | null;
  C: number | null;
  A: number | null;
  W: number | null;
  R: number | null;
  D: number | null;
  E: number | null;
}

/**
 * Where a Regiment is:
 * - reserve: in Reinforcements, not yet arriving;
 * - arriving: selected to arrive this Round, waiting to March on (core p.21, p.31);
 * - table: on the Battlefield;
 * - destroyed.
 */
export type Location = 'reserve' | 'arriving' | 'table' | 'destroyed';

/** Front-centre point of the Regiment's front edge, plus facing (radians, CCW from +x). */
export interface Pose {
  x: number;
  y: number;
  angle: number;
}

export interface StandState {
  id: string;
  /** Wounds suffered. */
  wounds: number;
  isCommand: boolean;
}

export interface CharacterState {
  id: string;
  name: string;
  type: StandType;
  profile: Profile;
  rules: RuleRef[];
  actions: RuleRef[];
  drawEvents: string[];
  supremacyAbilities: string[];
  wounds: number;
  isWarlord: boolean;
  /** Index of the Warband the Character leads. */
  warband: number;
  /** Regiment it is attached to (core p.20, p.72). */
  attachedTo: string | null;
  destroyed: boolean;
}

export interface RegimentState {
  id: string;
  owner: PlayerId;
  name: string;
  type: StandType;
  cls: UnitClass;
  profile: Profile;
  rules: RuleRef[];
  drawEvents: string[];
  commandModels: string[];
  warband: number;
  /** Regular Stands, in formation order (see formation.ts). Excludes any Character. */
  stands: StandState[];
  startingStands: number;
  /** Number of files (Stands in the front rank, counting an attached Character). */
  files: number;
  pose: Pose;
  location: Location;
  broken: boolean;
  activatedThisRound: boolean;
  /** Round in which the Regiment came on from Reinforcements (it cannot Charge that Round, core p.23). */
  arrivedRound: number | null;
}

export type ActionKind = 'march' | 'reform' | 'pass';

export interface ActivationState {
  regimentId: string;
  /** Actions taken so far this Activation (core p.23: two Actions, only March may repeat). */
  actions: ActionKind[];
  /** True while the Regiment is entering from Reinforcements this Activation (core p.31). */
  entering: boolean;
  /** Pose when the Activation started (for overlap and re-entry checks). */
  startPose: Pose;
}

export interface PlayerState {
  id: PlayerId;
  listName: string;
  faction: string;
  /** Glossary from the imported list: rule name → text. */
  glossary: Record<string, string>;
  vp: number;
}

export interface GameState {
  seed: number;
  scenario: ScenarioDef;
  round: number;
  phase: 'setup' | 'play' | 'ended';
  players: Record<PlayerId, PlayerState>;
  regiments: Record<string, RegimentState>;
  characters: Record<string, CharacterState>;
  activation: ActivationState | null;
  /** Reinforcement Line per player, as distance from their own edge (core p.30). Set each Round. */
  reinforcementLine: Record<PlayerId, number>;
}

export type { Edge };
