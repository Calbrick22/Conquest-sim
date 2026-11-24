/**
 * The ONLY place where Stand base sizes in millimetres live (see CLAUDE.md).
 * Everything else in the engine works in inches.
 *
 * RULE-AMBIGUITY: AMB-02 — the core rules (p.11–12) give no base dimensions.
 * Values below were supplied by the owner. Chariot is derived from core p.11
 * ("two square stands back to back").
 */
export const MM_PER_INCH = 25.4;

export type StandType = 'Infantry' | 'Cavalry' | 'Brute' | 'Chariot' | 'Monster';

/** Width = frontage, depth = front-to-back, in millimetres. */
export interface BaseMm {
  readonly widthMm: number;
  readonly depthMm: number;
}

export const BASES_MM: Readonly<Record<StandType, BaseMm>> = {
  Infantry: { widthMm: 66, depthMm: 66 },
  Cavalry: { widthMm: 66, depthMm: 66 },
  Brute: { widthMm: 66, depthMm: 66 },
  Chariot: { widthMm: 66, depthMm: 132 },
  Monster: { widthMm: 110, depthMm: 110 },
};

/** Objective Markers sit on a Brute/Cavalry base (pack p.8). */
export const OBJECTIVE_MARKER_BASE_MM: BaseMm = BASES_MM.Brute;

/** Size for Line of Sight purposes (core p.12; Objective Markers pack p.8). */
export const STAND_SIZE: Readonly<Record<StandType, number>> = {
  Infantry: 1,
  Cavalry: 2,
  Brute: 2,
  Chariot: 2,
  Monster: 3,
};

export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

export interface BaseInches {
  readonly width: number;
  readonly depth: number;
}

export function baseInches(type: StandType): BaseInches {
  const b = BASES_MM[type];
  return { width: mmToInches(b.widthMm), depth: mmToInches(b.depthMm) };
}
