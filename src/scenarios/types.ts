/**
 * Scenario data model. Coordinates are inches from Player 1's bottom-left corner:
 * x along Player 1's edge (0–72), y toward Player 2's edge (0–48).
 * Positions were read off the 12″ grid in the tournament pack diagrams (pack p.11–22).
 */
export type PlayerId = 'P1' | 'P2';
export type Edge = 'bottom' | 'top' | 'left' | 'right';

export interface ObjectiveZoneDef {
  id: string;
  /** Short label shown on the preview, e.g. "A", "1", "Left". */
  label?: string;
  x: number;
  y: number;
  diameter: number;
  /** A friendly zone cannot be Seized by the player it is friendly to (pack p.8). */
  friendlyTo?: PlayerId;
}

export interface ObjectiveMarkerDef {
  id: string;
  label?: string;
  x: number;
  y: number;
  /** Friendly Markers cannot be attacked by that player; undefined = neutral (attackable by both). */
  friendlyTo?: PlayerId;
  /** pack p.9: Objective Markers have 3 Wounds and Defense 3. */
  wounds: number;
  defense: number;
}

export interface EdgeSegment {
  edge: Edge;
  /** Start and end along the edge, in inches (x for bottom/top, y for left/right). */
  from: number;
  to: number;
}

/** Restricts a scoring rule to some Rounds. */
export interface RoundFilter {
  rounds?: number[];
}

export type ScoringRule =
  | ({ kind: 'perZoneSeized'; vp: number; zoneIds?: string[]; players?: PlayerId[] } & RoundFilter)
  | ({ kind: 'seizedCountBonus'; min: number; vp: number; zoneIds?: string[] } & RoundFilter)
  | ({ kind: 'seizingMoreZonesThanOpponent'; vp: number } & RoundFilter)
  | ({ kind: 'markerDestroyed'; vp: number; markerIds?: string[] } & RoundFilter)
  | ({ kind: 'markersDestroyedCountBonus'; min: number; vp: number } & RoundFilter)
  | ({ kind: 'characterKilled'; vp: number } & RoundFilter)
  | ({ kind: 'regimentDestroyed'; vp: number } & RoundFilter)
  | ({ kind: 'warlordSlain'; vp: number; oncePerGame: boolean } & RoundFilter)
  | ({ kind: 'pickedZoneSeized'; vp: number } & RoundFilter)
  /** Wheel of War (ns p.3): VP for Seizing this Round's Priority Zone (see ScenarioDef.priorityZones). */
  | ({ kind: 'priorityZoneSeized'; vp: number } & RoundFilter)
  /** Flames of Conquest (ns p.5): VP for each zone the player Burned this Round. */
  | ({ kind: 'zoneBurned'; vp: number } & RoundFilter);

/**
 * Scenario-specific zone selection each Round (pack p.12, p.19, p.22):
 * - vetoDistinct: after the Supremacy Phase, First then Second Player each pick a zone (different
 *   zones); no VP for Seizing picked zones this Round.
 * - vetoSecret: as above but secret, other than the central zone, and both may pick the same.
 * - bonusPick: First then Second Player pick a 6″ zone with no friendly Regiment in range; bonus
 *   VP for Seizing your own pick.
 */
export interface ZonePickRule {
  mode: 'vetoDistinct' | 'vetoSecret' | 'bonusPick';
  /** Zones that may be picked; defaults to all. */
  eligibleZoneIds?: string[];
}

/** Terrain keywords (core p.86–87). */
export type TerrainKeyword = 'Elevated' | 'Obstructing' | 'Cover' | 'Traversable' | 'Hindering' | 'Impassable' | 'Water' | 'Dangerous' | 'Earth';
export type TerrainKind = 'hill' | 'forest' | 'field' | 'structure' | 'pond' | 'boulder';

/** A piece of Zonal Terrain: a rectangle `w` × `h` inches centred on (x, y), turned by `angle` radians. */
export interface TerrainPiece {
  id: string;
  kind: TerrainKind;
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  size: number;
  keywords: TerrainKeyword[];
}

export interface ScenarioDef {
  id: string;
  name: string;
  /** Page in the tournament pack. */
  page: number;
  table: { width: number; height: number };
  reinforcementZones: Record<PlayerId, Edge>;
  noReinforcement: EdgeSegment[];
  zones: ObjectiveZoneDef[];
  markers: ObjectiveMarkerDef[];
  rounds: number;
  /** First Round in which zones can be Seized and Markers attacked (pack p.8–9). */
  objectivesFromRound: number;
  scoring: ScoringRule[];
  zonePick?: ZonePickRule;
  /** Our own short summary of the VP rules, for the preview screen. */
  summary: string[];
  /** RULE-AMBIGUITY ids that affect this scenario. */
  ambiguities?: string[];
  /** Where the scenario comes from: the tournament pack (default) or the 2026 new scenarios. */
  source?: 'pack' | 'ns2026';
  /** Wheel of War (ns p.3): the Priority Zone in Round 1, 2, … (repeating). */
  priorityZones?: string[];
  /** Cursed Sanctuaries (ns p.4): Hits suffered in each zone during the Victory Phase, by zone diameter. */
  cursedSanctuaries?: Record<string, number>;
  /** Flames of Conquest (ns p.5): Regiments may Burn a zone they are Seizing from this Round. */
  burnFromRound?: number;
  /** Player territories (Break the Line, ns p.6), as bands from each player's edge, for display. */
  territories?: Record<PlayerId, number>;
  /** Scenario rules that are not automated (shown on the preview and logged). */
  manualRules?: string[];
  /** The terrain layout drawn for this scenario (see terrainLayouts.ts). */
  defaultTerrain?: string;
  /** Terrain on the Battlefield (chosen at setup). */
  terrain?: TerrainPiece[];
  /** Name of the terrain layout in use, for display. */
  terrainLayout?: string;
}
