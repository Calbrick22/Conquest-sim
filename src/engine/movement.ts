import { add, rotateAbout, scale, sub, type Vec } from './geometry/vec';
import { frontWidth, poseFrame, type FormationInput } from './formation';
import type { Pose } from './model/types';

/**
 * March movement (core p.28–29):
 * - forward, with any number of Wheels, up to the lowest March Characteristic in total;
 * - OR directly sideways or backward, up to half the March Characteristic, with no other move.
 *
 * A Wheel pivots about one front corner; the distance used is the distance travelled by the
 * opposite front corner, which may only move forward. RULE-AMBIGUITY: AMB-05 — arc length.
 */
export type MoveSeg =
  | { kind: 'forward'; d: number }
  /** Turn by `angle` radians (> 0) pivoting on the given front corner. Pivot left = turn left. */
  | { kind: 'wheel'; pivot: 'left' | 'right'; angle: number }
  /** Sideways: positive = to the Regiment's right. */
  | { kind: 'sideways'; d: number }
  | { kind: 'backward'; d: number };

export function segCost(seg: MoveSeg, width: number): number {
  switch (seg.kind) {
    case 'forward':
      return Math.abs(seg.d);
    case 'wheel':
      return Math.abs(seg.angle) * width;
    case 'sideways':
      return Math.abs(seg.d);
    case 'backward':
      return Math.abs(seg.d);
  }
}

export function pathCost(segs: readonly MoveSeg[], width: number): number {
  return segs.reduce((a, s) => a + segCost(s, width), 0);
}

/** Applies one segment (or a fraction t of it) to a pose. */
export function applySeg(pose: Pose, seg: MoveSeg, width: number, t = 1): Pose {
  const { forward, right } = poseFrame(pose);
  const p: Vec = { x: pose.x, y: pose.y };
  switch (seg.kind) {
    case 'forward': {
      const q = add(p, scale(forward, seg.d * t));
      return { ...pose, x: q.x, y: q.y };
    }
    case 'sideways': {
      const q = add(p, scale(right, seg.d * t));
      return { ...pose, x: q.x, y: q.y };
    }
    case 'backward': {
      const q = sub(p, scale(forward, seg.d * t));
      return { ...pose, x: q.x, y: q.y };
    }
    case 'wheel': {
      const half = width / 2;
      const a = Math.abs(seg.angle) * t;
      if (seg.pivot === 'left') {
        const pivot = sub(p, scale(right, half));
        const q = rotateAbout(p, pivot, a);
        return { x: q.x, y: q.y, angle: pose.angle + a };
      }
      const pivot = add(p, scale(right, half));
      const q = rotateAbout(p, pivot, -a);
      return { x: q.x, y: q.y, angle: pose.angle - a };
    }
  }
}

export function applyPath(pose: Pose, segs: readonly MoveSeg[], width: number): Pose {
  return segs.reduce((p, s) => applySeg(p, s, width), pose);
}

/** Poses sampled along the path every `step` inches (and at the end), for swept checks. */
export function samplePath(pose: Pose, segs: readonly MoveSeg[], width: number, step = 0.25): Pose[] {
  const out: Pose[] = [pose];
  let cur = pose;
  for (const s of segs) {
    const c = segCost(s, width);
    const n = Math.max(1, Math.ceil(c / step));
    for (let i = 1; i <= n; i++) out.push(applySeg(cur, s, width, i / n));
    cur = applySeg(cur, s, width);
  }
  return out;
}

/** Shape rules for one March (core p.28): returns problems, empty if fine. */
export function marchShapeProblems(segs: readonly MoveSeg[], march: number, width: number): string[] {
  const problems: string[] = [];
  if (segs.length === 0) problems.push('A March needs at least one move.');
  const lateral = segs.filter((s) => s.kind === 'sideways' || s.kind === 'backward');
  if (lateral.length > 0) {
    if (segs.length > 1) problems.push('A sideways or backward March cannot be combined with other moves (core p.28).');
    const d = pathCost(segs, width);
    if (d > march / 2 + 1e-9) problems.push(`Sideways or backward moves are limited to half March (${(march / 2).toFixed(2)}″, core p.28).`);
  }
  for (const s of segs) {
    if (s.kind === 'forward' && s.d < 0) problems.push('Forward moves cannot be negative.');
    if (s.kind === 'backward' && s.d < 0) problems.push('Backward moves cannot be negative.');
    if (s.kind === 'wheel' && s.angle < 0) problems.push('Wheel angles must be positive; choose the pivot corner instead.');
  }
  const cost = pathCost(segs, width);
  if (cost > march + 1e-9) problems.push(`Move of ${cost.toFixed(2)}″ exceeds March ${march}″ (core p.28).`);
  return problems;
}

export function widthOf(input: FormationInput): number {
  return frontWidth(input);
}

/** Parses quick text entry, e.g. "forward 5.5", "f5", "wheel 30 left", "w 45 r", "side -2", "back 3". */
export function parseMoveText(text: string): MoveSeg[] | null {
  const parts = text
    .toLowerCase()
    .split(/[,;]|\bthen\b/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: MoveSeg[] = [];
  for (const p of parts) {
    let m = p.match(/^(?:f|fwd|forward)\s*(-?\d+(?:\.\d+)?)\s*(?:"|″|in)?$/);
    if (m) {
      out.push({ kind: 'forward', d: Number(m[1]) });
      continue;
    }
    m = p.match(/^(?:w|wheel)\s*(\d+(?:\.\d+)?)\s*°?\s*(?:about\s+)?(l|left|r|right)(?:\s+corner)?$/);
    if (m) {
      out.push({ kind: 'wheel', pivot: m[2]!.startsWith('l') ? 'left' : 'right', angle: (Number(m[1]) * Math.PI) / 180 });
      continue;
    }
    m = p.match(/^(?:s|side|sideways)\s*(-?\d+(?:\.\d+)?)\s*(?:"|″|in)?\s*(l|left|r|right)?$/);
    if (m) {
      const d = Number(m[1]) * (m[2]?.startsWith('l') ? -1 : 1);
      out.push({ kind: 'sideways', d });
      continue;
    }
    m = p.match(/^(?:b|back|backward)\s*(\d+(?:\.\d+)?)\s*(?:"|″|in)?$/);
    if (m) {
      out.push({ kind: 'backward', d: Number(m[1]) });
      continue;
    }
    return null;
  }
  return out;
}
