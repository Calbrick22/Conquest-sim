import { clipPoly, ensureCCW, frame, intersectionArea, polyArea, type Poly, type Rect } from './polygon';
import { add, scale, sub, type Vec } from './vec';

/**
 * Facing arcs (core p.13–14, Fig. 1.3): 45° lines extend outward from each corner of the
 * Regiment's footprint. Between the front-corner lines and beyond the front edge is the Front
 * arc; likewise the Rear; the regions on each side are the Flanks.
 * RULE-AMBIGUITY: AMB-04 — lines start at the corners of the whole footprint (the rectangle of
 * its most complete rank, core p.45), not of individual Stands.
 */
export type Arc = 'front' | 'rear' | 'left' | 'right';
export const ARCS: readonly Arc[] = ['front', 'right', 'rear', 'left'];

const FAR = 500;

/** Each arc as a large convex polygon (clipped at 500″, far beyond any table). */
export function arcPolygon(fp: Rect, arc: Arc): Poly {
  const { forward: f, right: r } = frame(fp.angle);
  const P = (u: number, w: number): Vec => add(fp.c, add(scale(r, u), scale(f, w)));
  const W = fp.halfWidth;
  const D = fp.halfDepth;
  let pts: Vec[];
  switch (arc) {
    case 'front':
      pts = [P(-W, D), P(W, D), P(W + FAR, D + FAR), P(-W - FAR, D + FAR)];
      break;
    case 'rear':
      pts = [P(W, -D), P(-W, -D), P(-W - FAR, -D - FAR), P(W + FAR, -D - FAR)];
      break;
    case 'right':
      pts = [P(W, D), P(W, -D), P(W + FAR, -D - FAR), P(W + FAR, D + FAR)];
      break;
    case 'left':
      pts = [P(-W, -D), P(-W, D), P(-W - FAR, D + FAR), P(-W - FAR, -D - FAR)];
      break;
  }
  return ensureCCW(pts);
}

/** Arcs a polygon (e.g. a target Stand) lies in. A Stand on a boundary is in both (core p.35). */
export function arcsOf(fp: Rect, target: Poly): Arc[] {
  return ARCS.filter((a) => intersectionArea(arcPolygon(fp, a), target) > 1e-6);
}

/** The arc that holds most of the target's area (single-Stand charges, core p.35). */
export function majorityArc(fp: Rect, target: Poly): Arc | null {
  let best: Arc | null = null;
  let bestA = 0;
  const total = Math.abs(polyArea(target));
  for (const a of ARCS) {
    const area = intersectionArea(arcPolygon(fp, a), target);
    if (area > bestA + 1e-9) {
      best = a;
      bestA = area;
    }
  }
  return total > 0 ? best : null;
}

/** Is a point in an arc (inclusive of boundaries)? */
export function pointInArc(fp: Rect, p: Vec, arc: Arc): boolean {
  const { forward: f, right: r } = frame(fp.angle);
  const d = sub(p, fp.c);
  const u = d.x * r.x + d.y * r.y;
  const w = d.x * f.x + d.y * f.y;
  const W = fp.halfWidth;
  const D = fp.halfDepth;
  const e = 1e-9;
  switch (arc) {
    case 'front':
      return w >= D - e && Math.abs(u) - W <= w - D + e;
    case 'rear':
      return w <= -D + e && Math.abs(u) - W <= -D - w + e;
    case 'right':
      return u >= W - e && u - W >= w - D - e && u - W >= -D - w - e;
    case 'left':
      return u <= -W + e && -u - W >= w - D - e && -u - W >= -D - w - e;
  }
}

export { clipPoly };
