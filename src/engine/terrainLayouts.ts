import type { ScenarioDef, TerrainKind, TerrainPiece } from '../scenarios/types';
import { overlaps, polyDistance, type Poly } from './geometry/polygon';
import { standOverlapsZone } from './geometry/zones';
import { mmToInches, OBJECTIVE_MARKER_BASE_MM } from './geometry/bases';
import { has, makePiece, piecePoly } from './terrain';

/**
 * Terrain layouts (2026 scenario terrain pages, ns p.7–9) and the rules for placing terrain
 * (pack p.3–4; ns p.1):
 * - pieces at least 9″ apart; no footprint bigger than 10″ × 6″ (the 2026 set's Forest and Pond);
 * - about 6 pieces, never more than 9; at least 2 Obstructing pieces;
 * - no Impassable (or Garrison) piece on an Objective Zone; nothing on an Objective Marker;
 * - both halves of the table kept symmetrical: every piece has a twin turned half a turn about the
 *   centre of the table (as in every 2026 layout), or sits on the centre itself.
 * When a layout clashes with a scenario's objectives, the offending pieces move the least distance
 * that makes them legal (pack p.4), keeping the symmetry.
 */

export interface LayoutDef {
  id: string;
  name: string;
  /** One of each mirrored pair (the twin is generated), and pieces on the centre. */
  pairs: [TerrainKind, number, number, number][];
  centre?: [TerrainKind, number][];
}

/** Read off the 12″ grid of the 2026 scenario terrain diagrams (ns p.7–9). */
export const LAYOUTS: LayoutDef[] = [
  { id: 'seek-and-destroy', name: 'Seek and Destroy', pairs: [['field', 16.5, 39, 0], ['forest', 64.5, 39, 0], ['boulder', 38.5, 44, 0], ['pond', 48, 27, 0]] },
  { id: 'wheel-of-war', name: 'Wheel of War', pairs: [['hill', 12, 35, -25], ['field', 31.5, 39, 0], ['forest', 54.5, 32.5, 25]], centre: [['boulder', 0]] },
  { id: 'cursed-sanctuaries', name: 'Cursed Sanctuaries', pairs: [['hill', 28.5, 39, 8], ['boulder', 51, 36, 0], ['forest', 11.5, 26.5, 0]], centre: [['pond', 40]] },
  { id: 'flames-of-conquest', name: 'Flames of Conquest', pairs: [['structure', 43, 44.5, 0], ['hill', 22, 35, -25], ['forest', 60, 33, 0]], centre: [['pond', 40]] },
  { id: 'break-the-line', name: 'Break the Line', pairs: [['structure', 52, 41.5, 0], ['forest', 29, 39.5, 0], ['pond', 11, 24.5, -30]], centre: [['hill', 0]] },
];

/** The half-turn twin of a piece about the table centre. */
export function twin(p: TerrainPiece, W: number, H: number, id: string): TerrainPiece {
  return { ...p, id, x: W - p.x, y: H - p.y };
}

export function expandLayout(def: LayoutDef, W = 72, H = 48): TerrainPiece[] {
  const out: TerrainPiece[] = [];
  def.pairs.forEach(([k, x, y, a], i) => {
    const p = makePiece(`t${i}a`, k, x, y, a);
    out.push(p, twin(p, W, H, `t${i}b`));
  });
  (def.centre ?? []).forEach(([k, a], i) => out.push(makePiece(`c${i}`, k, W / 2, H / 2, a)));
  return out;
}

// ---------------------------------------------------------------- legality

const MIN_GAP = 9;

function markerPolysOf(sc: ScenarioDef): Poly[] {
  const half = mmToInches(OBJECTIVE_MARKER_BASE_MM.widthMm) / 2;
  return sc.markers.map((m) => [
    { x: m.x - half, y: m.y - half },
    { x: m.x + half, y: m.y - half },
    { x: m.x + half, y: m.y + half },
    { x: m.x - half, y: m.y + half },
  ]);
}

/** Why a piece cannot stand where it is (empty if fine), against the scenario and other pieces. */
export function pieceProblems(sc: ScenarioDef, p: TerrainPiece, others: TerrainPiece[]): string[] {
  const out: string[] = [];
  const pp = piecePoly(p);
  const W = sc.table.width;
  const H = sc.table.height;
  if (pp.some((v) => v.x < -1e-6 || v.y < -1e-6 || v.x > W + 1e-6 || v.y > H + 1e-6)) out.push('off the table');
  if (has(p, 'Impassable') && sc.zones.some((z) => standOverlapsZone(pp, { x: z.x, y: z.y }, z.diameter))) out.push('Impassable on an Objective Zone (pack p.3)');
  if (markerPolysOf(sc).some((m) => overlaps(pp, m))) out.push('on an Objective Marker (pack p.3)');
  for (const o of others) if (o.id !== p.id && polyDistance(pp, piecePoly(o)) < MIN_GAP - 1e-6) out.push(`within ${MIN_GAP}″ of another piece (pack p.3)`);
  return out;
}

export function layoutProblems(sc: ScenarioDef, pieces: TerrainPiece[]): string[] {
  const out: string[] = [];
  for (const p of pieces) for (const m of pieceProblems(sc, p, pieces)) out.push(`${p.kind} ${p.id}: ${m}`);
  if (pieces.length > 9) out.push('more than 9 pieces (pack p.3)');
  if (pieces.filter((p) => has(p, 'Obstructing')).length < 2) out.push('fewer than 2 Obstructing pieces (pack p.3)');
  return out;
}

/**
 * Fit a layout to a scenario (pack p.4): move each offending pair the least distance that makes
 * both twins legal, keeping them mirrored; a centre piece that cannot stay legal is left out.
 * Spacing between pieces is kept where possible and relaxed only if nothing else works.
 */
export function fitLayout(sc: ScenarioDef, pieces: TerrainPiece[]): TerrainPiece[] {
  const W = sc.table.width;
  const H = sc.table.height;
  const placed: TerrainPiece[] = [];
  const centres = pieces.filter((p) => p.id.startsWith('c'));
  for (const c of centres) if (!pieceProblems(sc, c, [...placed, ...centres.filter((x) => x !== c)]).length) placed.push(c);
  const halves = pieces.filter((p) => p.id.endsWith('a'));
  for (const h of halves) {
    const tid = h.id.replace(/a$/, 'b');
    const tryAt = (dx: number, dy: number, strict: boolean): TerrainPiece[] | null => {
      const a = { ...h, x: h.x + dx, y: h.y + dy };
      const b = twin(a, W, H, tid);
      const ignoreGap = (list: string[]) => (strict ? list : list.filter((m) => !m.startsWith('within')));
      if (ignoreGap(pieceProblems(sc, a, [...placed, b])).length || ignoreGap(pieceProblems(sc, b, [...placed, a])).length) return null;
      return [a, b];
    };
    let found: TerrainPiece[] | null = null;
    for (const strict of [true, false]) {
      for (let r = 0; r <= 12 && !found; r += 0.5) {
        const steps = r === 0 ? 1 : Math.max(8, Math.round(r * 6));
        for (let k = 0; k < steps && !found; k++) {
          const ang = (2 * Math.PI * k) / steps;
          found = tryAt(r * Math.cos(ang), r * Math.sin(ang), strict);
        }
      }
      if (found) break;
    }
    if (found) placed.push(...found);
  }
  return placed;
}

// ---------------------------------------------------------------- random layouts

/** A small seeded generator (mulberry32), so a seed always gives the same table. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random, legal, symmetrical layout: three mirrored pairs (one of them Obstructing, one giving
 * Cover) and sometimes a centre piece, so 6 or 7 pieces in all (pack p.3).
 */
export function randomLayout(sc: ScenarioDef, seed: number): TerrainPiece[] {
  const W = sc.table.width;
  const H = sc.table.height;
  const rng = rand(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const obstructing: TerrainKind[] = ['hill', 'structure', 'boulder'];
  const cover: TerrainKind[] = ['forest', 'field'];
  const any: TerrainKind[] = ['hill', 'structure', 'boulder', 'forest', 'field', 'pond'];
  const angles = [0, 0, 0, 20, -20, 30, -30, 90];
  for (let attempt = 0; attempt < 400; attempt++) {
    const kinds: TerrainKind[] = [pick(obstructing), pick(cover), pick(any)];
    const pieces: TerrainPiece[] = [];
    if (rng() < 0.5) {
      const c = makePiece('c0', pick(['hill', 'pond', 'boulder', 'forest'] as TerrainKind[]), W / 2, H / 2, pick(angles));
      if (!pieceProblems(sc, c, []).length) pieces.push(c);
    }
    let ok = true;
    kinds.forEach((k, i) => {
      if (!ok) return;
      for (let tries = 0; tries < 60; tries++) {
        // One twin on Player 1's half; the other is its half-turn copy.
        const a = makePiece(`t${i}a`, k, 5 + rng() * (W - 10), 5 + rng() * (H / 2 - 7), pick(angles));
        const b = twin(a, W, H, `t${i}b`);
        if (!pieceProblems(sc, a, [...pieces, b]).length && !pieceProblems(sc, b, [...pieces, a]).length) {
          pieces.push(a, b);
          return;
        }
      }
      ok = false;
    });
    if (ok && !layoutProblems(sc, pieces).length) return pieces;
  }
  return fitLayout(sc, expandLayout(LAYOUTS[0]!, W, H));
}

export type TerrainChoice = { mode: 'none' } | { mode: 'layout'; id: string } | { mode: 'random'; seed: number };

/** Terrain for a scenario from a setup choice; the scenario's own 2026 layout is the default. */
export function terrainFor(sc: ScenarioDef, choice: TerrainChoice): { pieces: TerrainPiece[]; name: string } {
  if (choice.mode === 'none') return { pieces: [], name: 'No terrain' };
  if (choice.mode === 'random') return { pieces: randomLayout(sc, choice.seed), name: `Random (seed ${choice.seed})` };
  const def = LAYOUTS.find((l) => l.id === choice.id) ?? LAYOUTS[0]!;
  return { pieces: fitLayout(sc, expandLayout(def, sc.table.width, sc.table.height)), name: `${def.name} layout` };
}
