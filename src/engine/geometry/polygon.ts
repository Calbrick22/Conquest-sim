import { add, cross, dir, dist, dot, perp, scale, sub, TOL, type Vec } from './vec';

/** A convex polygon, vertices in counter-clockwise order. */
export type Poly = readonly Vec[];

/**
 * An oriented rectangle. `angle` is the facing (direction of the front edge's outward normal).
 * `halfWidth` runs along the front edge; `halfDepth` front to back.
 */
export interface Rect {
  readonly c: Vec;
  readonly halfWidth: number;
  readonly halfDepth: number;
  readonly angle: number;
}

export interface RectFrame {
  forward: Vec;
  /** Unit vector to the rectangle's right when looking along `forward`. */
  right: Vec;
}

export function frame(angle: number): RectFrame {
  const f = dir(angle);
  return { forward: f, right: { x: f.y, y: -f.x } };
}

/** Corners: front-left, front-right, rear-right, rear-left. */
export function rectCorners(r: Rect): [Vec, Vec, Vec, Vec] {
  const { forward, right } = frame(r.angle);
  const F = scale(forward, r.halfDepth);
  const R = scale(right, r.halfWidth);
  const fl = sub(add(r.c, F), R);
  const fr = add(add(r.c, F), R);
  const rr = add(sub(r.c, F), R);
  const rl = sub(sub(r.c, F), R);
  return [fl, fr, rr, rl];
}

/** Rectangle corners as a CCW polygon. */
export function rectPoly(r: Rect): Poly {
  const [fl, fr, rr, rl] = rectCorners(r);
  // fl → rl → rr → fr is counter-clockwise (forward × right points into the page).
  return [fl, rl, rr, fr];
}

export function polyArea(p: Poly): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += cross(p[i]!, p[(i + 1) % p.length]!);
  return a / 2;
}

export function ensureCCW(p: Poly): Poly {
  return polyArea(p) < 0 ? [...p].reverse() : p;
}

function axes(p: Poly): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < p.length; i++) {
    const e = sub(p[(i + 1) % p.length]!, p[i]!);
    const l = Math.hypot(e.x, e.y);
    if (l > 1e-12) out.push(perp({ x: e.x / l, y: e.y / l }));
  }
  return out;
}

function project(p: Poly, axis: Vec): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const q of p) {
    const d = dot(q, axis);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/**
 * Minimum penetration depth over all separating axes (SAT). Positive = overlapping by that much;
 * zero or negative = touching or separated (negative is a lower bound on the gap).
 */
export function penetration(a: Poly, b: Poly): number {
  let min = Infinity;
  for (const ax of [...axes(a), ...axes(b)]) {
    const [a0, a1] = project(a, ax);
    const [b0, b1] = project(b, ax);
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o < min) min = o;
  }
  return min;
}

/** True if interiors overlap by more than the tolerance (touching is not overlapping). */
export function overlaps(a: Poly, b: Poly, tol = TOL): boolean {
  return penetration(a, b) > tol;
}

export function pointSegmentDistance(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

function segmentsIntersect(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function segmentSegmentDistance(a: Vec, b: Vec, c: Vec, d: Vec): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

export function pointInPoly(p: Vec, poly: Poly): boolean {
  const q = ensureCCW(poly);
  for (let i = 0; i < q.length; i++) if (cross(sub(q[(i + 1) % q.length]!, q[i]!), sub(p, q[i]!)) < 0) return false;
  return true;
}

/** Closest distance between two convex polygons, edge to edge (0 if they touch or overlap). Core p.10. */
export function polyDistance(a: Poly, b: Poly): number {
  if (penetration(a, b) >= 0) return 0;
  let min = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      min = Math.min(min, segmentSegmentDistance(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!));
  return min;
}

/** Stands are in contact if touching in any way, including corner to corner (core p.16; AMB-20). */
export function inContact(a: Poly, b: Poly, tol = TOL): boolean {
  return polyDistance(a, b) <= tol;
}

export function pointPolyDistance(p: Vec, poly: Poly): number {
  if (pointInPoly(p, poly)) return 0;
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) min = Math.min(min, pointSegmentDistance(p, poly[i]!, poly[(i + 1) % poly.length]!));
  return min;
}

export function segmentPolyDistance(a: Vec, b: Vec, poly: Poly): number {
  if (pointInPoly(a, poly) || pointInPoly(b, poly)) return 0;
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) min = Math.min(min, segmentSegmentDistance(a, b, poly[i]!, poly[(i + 1) % poly.length]!));
  return min;
}

/** Sutherland–Hodgman clip of `subject` by convex `clip` (both CCW). Returns the intersection polygon. */
export function clipPoly(subject: Poly, clip: Poly): Vec[] {
  let out: Vec[] = [...ensureCCW(subject)];
  const c = ensureCCW(clip);
  for (let i = 0; i < c.length && out.length; i++) {
    const A = c[i]!;
    const B = c[(i + 1) % c.length]!;
    const inside = (p: Vec) => cross(sub(B, A), sub(p, A)) >= -1e-12;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const P = input[j]!;
      const Q = input[(j + 1) % input.length]!;
      const pIn = inside(P);
      const qIn = inside(Q);
      if (pIn) out.push(P);
      if (pIn !== qIn) {
        const d = sub(Q, P);
        const t = cross(sub(B, A), sub(A, P)) / cross(sub(B, A), d);
        out.push(add(P, scale(d, t)));
      }
    }
  }
  return out;
}

export function intersectionArea(a: Poly, b: Poly): number {
  const c = clipPoly(a, b);
  return c.length < 3 ? 0 : Math.abs(polyArea(c));
}

export function centroid(p: Poly): Vec {
  let x = 0;
  let y = 0;
  for (const q of p) {
    x += q.x;
    y += q.y;
  }
  return { x: x / p.length, y: y / p.length };
}

function projectOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return add(a, scale(ab, t));
}

/** The closest pair of points between two sets of convex polygons (exact, edge to edge). */
export function closestPair(as: readonly Poly[], bs: readonly Poly[]): [Vec, Vec] {
  let best: [Vec, Vec] = [as[0]![0]!, bs[0]![0]!];
  let bd = Infinity;
  const consider = (p: Vec, q: Vec) => {
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = [p, q];
    }
  };
  for (const A of as)
    for (const B of bs)
      for (let i = 0; i < A.length; i++) {
        const a0 = A[i]!;
        const a1 = A[(i + 1) % A.length]!;
        for (let j = 0; j < B.length; j++) {
          const b0 = B[j]!;
          const b1 = B[(j + 1) % B.length]!;
          consider(a0, projectOnSegment(a0, b0, b1));
          consider(a1, projectOnSegment(a1, b0, b1));
          consider(projectOnSegment(b0, a0, a1), b0);
          consider(projectOnSegment(b1, a0, a1), b1);
        }
      }
  return best;
}
