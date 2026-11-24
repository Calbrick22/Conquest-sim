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
  /** Effective special rules (recomputed after every Action from baseRules and grants). */
  rules: RuleRef[];
  /** The Character's own rules from the list (plus options bought at list building). */
  baseRules: RuleRef[];
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
  /**
   * Effective special rules: baseRules plus rules granted by the attached Character, the army
   * (Sect, Warlord) and until-end-of-Round effects. Recomputed after every Action (grants.ts).
   */
  rules: RuleRef[];
  /** The Regiment's own rules from the list. */
  baseRules: RuleRef[];
  /** Rules gained until the end of the Round (Draw Events, Strains, Supremacy…). */
  roundRules: RuleRef[];
  /** Effective Draw Events (own plus granted). */
  drawEvents: string[];
  baseDrawEvents: string[];
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
  /** Marked by Designate Target until the end of the Round (Spires rule text). */
  marked?: boolean;
  /** Blessed used this Round (core p.97). */
  blessedUsed?: boolean;
  /** Flawless Drill used (once per game, core p.98). */
  flawlessDrillUsed?: boolean;
  /** Strain Expression active this Round: Decay at the end of each Activation unless excused. */
  decay?: boolean;
  /** Lobotomytic Override (top): Strain Expression without Decay this Activation. */
  noDecay?: boolean;
  /** Reprocessing Agents already applied this Round (max −1 Defense). */
  reprocessed?: boolean;
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
  /** Free or additional Actions earned this Activation (Double Time, Fire and Advance, Fluid Formation…). */
  extra?: { kind: ActionKind; reason: string; forwardOnly?: boolean; free?: boolean; used?: boolean }[];
  /** Draw Events resolved this Activation. */
  drawEvents?: string[];
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
  /** Put back by Lobotomytic Override (Directorate): top or bottom of the stack. */
  lobotomy?: 'top' | 'bottom';
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
  /** Sect / sub-faction line from the list (e.g. "The Directorate"). */
  sect: string | null;
  /** Strain abilities entered by the owner, by Regiment name (not in the export, AMB-18). */
  strains: Record<string, StrainDef>;
  /** Lobotomytic Override used this Round. */
  lobotomyUsed: boolean;
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

/** A Strain ability as entered by the owner: characteristic changes and gained rules. */
export interface StrainDef {
  stats: Partial<Record<keyof Profile, number>>;
  rules: RuleRef[];
  /** The owner's own description. */
  text: string;
}
