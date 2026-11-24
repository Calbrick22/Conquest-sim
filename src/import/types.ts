/** Parsed army list, as produced by the importer and edited on the review screen. */

export type Slot = 'Character' | 'Mainstay' | 'Restricted';

export interface Characteristics {
  /** null where the list shows "-" (e.g. a Character's March). */
  M: number | null;
  V: number | null;
  C: number | null;
  A: number | null;
  W: number | null;
  R: number | null;
  D: number | null;
  E: number | null;
}

export const CHARACTERISTIC_KEYS = ['M', 'V', 'C', 'A', 'W', 'R', 'D', 'E'] as const;
export type CharacteristicKey = (typeof CHARACTERISTIC_KEYS)[number];

/** A special rule reference such as `Impact (2)` or `Barrage (4) [14", Armor Piercing (2)]`. */
export interface RuleRef {
  /** Name without parameters, e.g. "Barrage". */
  name: string;
  /** Numeric (X) value, if any. */
  x?: number;
  /** True for (+X) values. */
  plus?: boolean;
  /** Non-numeric parenthesised parameter, e.g. "Pheromancy" in "Practitioner (Pheromancy)". */
  param?: string;
  /** Range in inches from a bracket block, e.g. 14 in `[14", ...]`. */
  range?: number;
  /** Nested rules from a bracket block. */
  sub?: RuleRef[];
  /** The original text of the reference. */
  raw: string;
}

export interface ListEntry {
  name: string;
  slot: Slot;
  stands: number;
  points: number;
  type: string;
  /** Class, or null when "-" (Characters adopt their Regiment's Class). */
  cls: string | null;
  stats: Characteristics;
  specialRules: RuleRef[];
  drawEvents: string[];
  actions: RuleRef[];
  supremacyAbilities: string[];
  commandModels: string[];
  battlefieldRoles: string[];
  /** Option groups, e.g. { Eccentricities: ["Forlorn Drive", ...] }. */
  options: Record<string, string[]>;
  /** Free-text notes attached to the entry (e.g. per-entry restrictions). */
  notes: string[];
  /** Spells known (core p.80). */
  spells?: string[];
  /** Memories of Old (Old Dominion): rules gained, or a text-only effect. */
  memories?: RuleRef[];
  memoriesText?: string;
  warnings: string[];
}

export interface Warband {
  /**
   * The number printed after "Warband" in the export. Its meaning is unclear: it does
   * not always equal the number of Regiments (see the real Spires lists), so it is kept
   * for display only.
   */
  declaredSize: number;
  character: ListEntry | null;
  regiments: ListEntry[];
  /** Restriction notes such as "This Warband may not contain more than …". */
  restrictions: string[];
}

export interface ArmyList {
  title: string;
  faction: string;
  sect: string | null;
  points: number | null;
  pointsLimit: number | null;
  warbands: Warband[];
  /** Rules glossary: rule name (without " X") → full text from the list. */
  glossary: Record<string, string>;
  armyRules: string;
  warnings: string[];
  /** Strain abilities entered by the owner on the review screen, by Regiment name (AMB-18). */
  strains?: Record<string, { stats: Record<string, number>; rules: string[]; text: string }>;
  /**
   * Profiles by Tier entered by the owner for a Character whose profile changes with the Fallen
   * Pantheon Tier (Old Dominion Fallen Divinity), by entry name then Tier ("2", "3").
   */
  tierProfiles?: Record<string, Record<string, { stats: Record<string, number>; rules: string[] }>>;
}
