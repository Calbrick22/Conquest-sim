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
  /** Purchased options (e.g. Eccentricities, Mutations) by name. */
  options: string[];
  wounds: number;
  isWarlord: boolean;
  /** Index of the Warband the Character leads. */
  warband: number;
  /** Regiment it is attached to (core p.20, p.72). */
  attachedTo: string | null;
  destroyed: boolean;
  activatedThisRound: boolean;
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
  /** Battlefield Roles, e.g. [Drone], [Husk] (Spires; used by some rules). */
  roles: string[];
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
  /** Stands (including an attached Character) at the start of the Round or at the last Rally (core p.60). */
  standsAtRoundStart: number;
  /** Stand count when the Regiment became Broken, for Shattering (core p.61). */
  standsWhenBroken: number | null;
  /** Characteristic changes until the end of the Round (manual tool, Draw Events). */
  roundMods: StatMod[];
  /** Status effects. */
  flags: RegimentFlags;
}

export interface StatMod {
  stat: keyof Profile;
  delta: number;
  source: string;
}

export interface RegimentFlags {
  /** Its Character declined a Duel this Round (core p.76). */
  declinedDuel?: boolean;
  /** Failed to enter from Reinforcements: arrives automatically next Round (core p.31). */
  autoArrive?: boolean;
}

export type ActionKind =
  | 'march'
  | 'reform'
  | 'pass'
  | 'charge'
  | 'volley'
  | 'takeAim'
  | 'rally'
  | 'clash'
  | 'combatRally'
  | 'combatReform'
  | 'inspire'
  | 'withdraw'
  | 'duel'
  | 'ability';

export interface ActivationState {
  /** The Regiment being activated, or the Character's Regiment for a Character Activation. */
  regimentId: string;
  /** Set for a Character's own Activation (core p.74–76). */
  characterId?: string;
  /** Set when this Regiment was activated straight after its Character (Entourage, core p.75). */
  entourage?: boolean;
  /** A Draw Event has been chosen (or declined) for this Activation (core p.23). */
  drawEventDone: boolean;
  /** Aimed Shot until the end of the Activation (Take Aim, core p.36). */
  aimed: boolean;
  /** Inspired until the end of the Activation (Inspire or a successful Charge, core p.35, p.50). */
  inspired: boolean;
  /** A failed Charge ends the Activation (core p.36). */
  ended: boolean;
  /** Actions taken so far this Activation (core p.23: two Actions, only March may repeat). */
  actions: ActionKind[];
  /** True while the Regiment is entering from Reinforcements this Activation (core p.31). */
  entering: boolean;
  /** Pose when the Activation started (for overlap and re-entry checks). */
  startPose: Pose;
}

/** A Command Card (core p.16, p.21). Regiment cards activate any same-named Regiment (core p.22). */
export interface CommandCard {
  id: string;
  kind: 'regiment' | 'character';
  name: string;
  /** The Regiment or Character the card was built for. */
  refId: string;
}

export type RoundStep = 'reinforcement' | 'command' | 'supremacy' | 'action' | 'victory';

export interface PlayerState {
  id: PlayerId;
  listName: string;
  faction: string;
  /** Army points (the list's limit, else its total). */
  points: number | null;
  /** Glossary from the imported list: rule name → text. */
  glossary: Record<string, string>;
  vp: number;
  /** Command Stack for this Round, top first. */
  stack: CommandCard[];
  stackSet: boolean;
  reinforcementDone: boolean;
  /** [Activated] Supremacy Ability used (once per battle, core p.22). */
  supremacyUsed: boolean;
}

/** Tallies for scoring, per player who caused them, for the current Round. */
export interface RoundTally {
  charactersKilled: Record<PlayerId, number>;
  regimentsDestroyed: Record<PlayerId, number>;
  warlordSlain: Record<PlayerId, boolean>;
  markersDestroyed: Record<PlayerId, string[]>;
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
  step: RoundStep;
  firstPlayer: PlayerId | null;
  /** Winner of the Supremacy roll-off, who chooses the First Player (core p.21). */
  supremacyWinner: PlayerId | null;
  /** Whose turn it is to draw a Command Card. */
  turn: PlayerId | null;
  /** The card just drawn, waiting to be used to Activate (core p.22). */
  drawn: { player: PlayerId; card: CommandCard } | null;
  /** A successful Charge waiting for the player to place the Regiment by hand. */
  pendingCharge: { regimentId: string; targetId: string; facing: string } | null;
  /** Dice forced by the manual "set next dice" tool; consumed before the RNG. */
  forcedDice: number[];
  tally: RoundTally;
  /** Objective Markers: Wounds caused by each player, tracked separately (pack p.9). */
  markers: Record<string, MarkerState>;
  /** Zone picks for scenarios with a zonePick rule (pack p.12, p.19, p.22), this Round. */
  zonePicks: Record<PlayerId, string | null>;
  /** Victory Points scored each Round. */
  scoreHistory: RoundScore[];
  /** A once-per-game Warlord bonus has been scored. */
  warlordScored: Record<PlayerId, boolean>;
}

export interface MarkerState {
  id: string;
  woundsBy: Record<PlayerId, number>;
  destroyed: boolean;
}

export interface ScoreLineRecord {
  rule: string;
  vp: number;
  detail: string;
}

export interface RoundScore {
  round: number;
  seized: Record<PlayerId, string[]>;
  vp: Record<PlayerId, number>;
  lines: Record<PlayerId, ScoreLineRecord[]>;
}

export type { Edge };
