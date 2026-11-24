import { STAND_SIZE } from './geometry/bases';
import { overlaps, pointInPoly, segmentPolyDistance, type Poly } from './geometry/polygon';
import type { Vec } from './geometry/vec';
import type { GameState, Pose, RegimentState, StatMod } from './model/types';
import type { TerrainKeyword, TerrainKind, TerrainPiece } from '../scenarios/types';

/**
 * Terrain (core p.84–90; pack p.3–4; 2026 scenario terrain set, cited as `ns p.1`).
 *
 * Zonal Terrain only: the 2026 set has no Garrison Terrain (RULE-AMBIGUITY: AMB-61).
 * - A Stand with any part inside a piece is within it (core p.86).
 * - Elevated: Stands on it add the piece's Size to theirs for Line of Sight (core p.84, p.86).
 * - Obstructing: blocks Line of Sight from Regiments of equal or smaller Size; Stands on the piece
 *   see and are seen freely (core p.86; pack p.4).
 * - Cover: a Volley through it, or at a Regiment with every Stand within it (if the Regiment's Size
 *   is no more than the piece's), halves Barrage, rounding up; no penalty when the shooter has
 *   every Stand within the same piece as the target (core p.86). It does not stack with Loose
 *   Formation (core p.99).
 * - Traversable: may be moved through; adds no Size (core p.86).
 * - Hindering: a Charge in which at least half the Stands pass through it makes no Impact
 *   Attacks, and Medium and Heavy Regiments lose Inspired for the Round (core p.86).
 * - Impassable: cannot be moved through or onto (core p.87). Fly passes over but cannot end on it.
 * - Water: −1 Clash (minimum 1) with at least half the Stands within it (core p.87).
 * - Fly is not affected by Zonal Terrain unless it starts or ends the move within it (core p.98).
 */

export interface TerrainType {
  label: string;
  /** Footprint in inches: w across, h deep (before rotation). */
  w: number;
  h: number;
  size: number;
  keywords: TerrainKeyword[];
}

/** The 2026 scenario terrain set (ns p.1). */
export const TERRAIN_TYPES: Record<TerrainKind, TerrainType> = {
  hill: { label: 'Hill', w: 8, h: 6, size: 2, keywords: ['Elevated', 'Obstructing'] },
  structure: { label: 'Structure', w: 8, h: 6, size: 2, keywords: ['Impassable', 'Obstructing'] },
  forest: { label: 'Forest', w: 10, h: 6, size: 3, keywords: ['Traversable', 'Hindering', 'Cover'] },
  pond: { label: 'Pond', w: 10, h: 6, size: 0, keywords: ['Traversable', 'Water', 'Hindering'] },
  field: { label: 'Field', w: 8, h: 6, size: 1, keywords: ['Traversable', 'Cover'] },
  boulder: { label: 'Boulder', w: 6, h: 6, size: 4, keywords: ['Impassable', 'Obstructing'] },
};

export function makePiece(id: string, kind: TerrainKind, x: number, y: number, angleDeg = 0): TerrainPiece {
  const t = TERRAIN_TYPES[kind];
  return { id, kind, x, y, w: t.w, h: t.h, angle: (angleDeg * Math.PI) / 180, size: t.size, keywords: [...t.keywords] };
}

const polyCache = new Map<string, Poly>();

/** A piece's footprint (cached: pieces never move during a game). */
export function piecePoly(p: TerrainPiece): Poly {
  const key = `${p.x},${p.y},${p.w},${p.h},${p.angle}`;
  const hit = polyCache.get(key);
  if (hit) return hit;
  if (polyCache.size > 500) polyCache.clear();
  const poly = buildPoly(p);
  polyCache.set(key, poly);
  return poly;
}

function buildPoly(p: TerrainPiece): Poly {
  const c = Math.cos(p.angle);
  const s = Math.sin(p.angle);
  const hw = p.w / 2;
  const hh = p.h / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([u, v]) => ({ x: p.x + u! * c - v! * s, y: p.y + u! * s + v! * c }));
}

export function terrainOf(s: Pick<GameState, 'scenario'>): TerrainPiece[] {
  return s.scenario.terrain ?? [];
}

export const has = (p: TerrainPiece, k: TerrainKeyword) => p.keywords.includes(k);

type Box = { x0: number; y0: number; x1: number; y1: number };
function box(poly: Poly): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const v of poly) {
    if (v.x < x0) x0 = v.x;
    if (v.y < y0) y0 = v.y;
    if (v.x > x1) x1 = v.x;
    if (v.y > y1) y1 = v.y;
  }
  return { x0, y0, x1, y1 };
}
/** Cheap bounding-box test before the exact overlap test (terrain checks run on every sampled pose). */
function hits(poly: Poly, piece: Poly): boolean {
  const a = box(poly);
  const b = box(piece);
  if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) return false;
  return overlaps(poly, piece);
}

/** Pieces a polygon is within (any part inside, core p.86). */
export function piecesUnder(s: Pick<GameState, 'scenario'>, poly: Poly): TerrainPiece[] {
  return terrainOf(s).filter((p) => hits(poly, piecePoly(p)));
}

/** A Stand's Size for Line of Sight: its Type's Size plus any Elevated piece it is on (core p.12, p.84). */
export function standLosSize(s: GameState, r: RegimentState, poly: Poly): number {
  const elev = piecesUnder(s, poly).filter((p) => has(p, 'Elevated')).reduce((a, p) => Math.max(a, p.size), 0);
  return STAND_SIZE[r.type] + elev;
}

/**
 * Is the line from a to b blocked by Obstructing terrain (core p.84–86)? Blocked by a piece whose
 * Size is at least both the shooter's and the target's Size, unless the shooter or the target is on
 * that piece.
 */
export function terrainBlocks(s: GameState, a: Vec, b: Vec, shooterSize: number, targetSize: number, shooterPoly: Poly | null, targetPoly: Poly | null): boolean {
  return terrainOf(s).some((p) => {
    if (!has(p, 'Obstructing')) return false;
    if (p.size < shooterSize || p.size < targetSize) return false;
    const pp = piecePoly(p);
    if ((shooterPoly && overlaps(shooterPoly, pp)) || (targetPoly && overlaps(targetPoly, pp))) return false;
    return segmentPolyDistance(a, b, pp) < 1e-6;
  });
}

/**
 * Does Cover halve this Stand's Barrage (core p.86)? `shooterAll`: every Stand of the shooting
 * Regiment; `targetAll`: every Stand of the target.
 */
export function coverHalves(s: GameState, from: Vec, to: Vec, shooterAll: Poly[], targetAll: Poly[], targetType: RegimentState['type']): string | null {
  const covers = terrainOf(s).filter((p) => has(p, 'Cover'));
  for (const p of covers) {
    const pp = piecePoly(p);
    const shooterInside = shooterAll.every((q) => overlaps(q, pp));
    const targetInside = targetAll.every((q) => overlaps(q, pp));
    // A shooter wholly within the same piece as the target suffers no penalty from it.
    if (shooterInside && targetInside) continue;
    if (targetInside && STAND_SIZE[targetType] <= p.size) return `${TERRAIN_TYPES[p.kind].label} Cover`;
    // Drawing Line of Sight through a piece of Cover (not one the shooter stands in with the target).
    // Drawing Line of Sight through a piece of Cover; a piece the shooting Stand is itself in does
    // not count (core p.86 speaks of penalties from "another piece"; RULE-AMBIGUITY: AMB-62).
    if (segmentPolyDistance(from, to, pp) < 1e-6 && !pointInPoly(from, pp)) return `through ${TERRAIN_TYPES[p.kind].label}`;
  }
  return null;
}


/** Problems with ending a move at these Stand positions (Impassable, core p.87; Fly too, core p.98). */
export function terrainPositionProblems(s: Pick<GameState, 'scenario'>, polys: Poly[]): string[] {
  const bad = terrainOf(s).find((p) => has(p, 'Impassable') && polys.some((q) => hits(q, piecePoly(p))));
  return bad ? [`Cannot stand on Impassable ${TERRAIN_TYPES[bad.kind].label} (core p.87).`] : [];
}

/** Problems with passing through these Stand positions (Impassable, core p.87; Fly passes over, core p.98). */
export function terrainPathProblems(s: Pick<GameState, 'scenario'>, polys: Poly[], flies: boolean): string[] {
  if (flies) return [];
  const bad = terrainOf(s).find((p) => has(p, 'Impassable') && polys.some((q) => hits(q, piecePoly(p))));
  return bad ? [`Cannot move through Impassable ${TERRAIN_TYPES[bad.kind].label} (core p.87).`] : [];
}

/**
 * Hindering on a Charge (core p.86): at least half the Stands (rounding up) pass through a
 * Hindering piece between the start and end positions. Fly is only affected when it starts or
 * ends within the piece (core p.98).
 */
export function chargeThroughHindering(s: GameState, standPolysAt: (pose: Pose) => Poly[], from: Pose, to: Pose, flies: boolean): boolean {
  const hind = terrainOf(s).filter((p) => has(p, 'Hindering')).map(piecePoly);
  if (!hind.length) return false;
  const start = standPolysAt(from);
  const end = standPolysAt(to);
  const n = start.length;
  const hit = new Array<boolean>(n).fill(false);
  const steps = flies ? [0, 1] : Array.from({ length: 21 }, (_, i) => i / 20);
  for (const f of steps) {
    const q: Pose = { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, angle: from.angle + (to.angle - from.angle) * f };
    const polys = f === 0 ? start : f === 1 ? end : standPolysAt(q);
    polys.forEach((sp, i) => {
      if (hind.some((h) => hits(sp, h))) hit[i] = true;
    });
  }
  return hit.filter(Boolean).length >= Math.ceil(n / 2);
}

/** Water (core p.87): −1 Clash, to a minimum of 1, with at least half the Stands within it. */
export function waterMods(s: GameState, polys: Poly[], clash: number): StatMod[] {
  const water = terrainOf(s).filter((p) => has(p, 'Water')).map(piecePoly);
  if (!water.length || !polys.length || clash <= 1) return [];
  const n = polys.filter((q) => water.some((w) => overlaps(q, w))).length;
  return n >= Math.ceil(polys.length / 2) ? [{ stat: 'C', delta: -1, source: 'Water' }] : [];
}
