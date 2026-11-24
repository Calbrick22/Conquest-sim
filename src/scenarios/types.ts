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
  | ({ kind: 'pickedZoneSeized'; vp: number } & RoundFilter);

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
}
