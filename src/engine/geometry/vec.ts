/** 2D vectors in inches. Table coordinates: x along Player 1's edge, y toward Player 2. */
export interface Vec {
  readonly x: number;
  readonly y: number;
}

/** Geometry tolerance in inches (CLAUDE.md: test geometry with 0.01″). */
export const TOL = 0.01;
/** 1 mm in inches: width of Line of Sight and Volley lines (core p.14, p.38). */
export const LOS_LINE_WIDTH = 1 / 25.4;

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => {
  const l = len(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Unit vector for a facing angle (radians, counter-clockwise from +x). */
export const dir = (angle: number): Vec => ({ x: Math.cos(angle), y: Math.sin(angle) });

/** Rotates p about centre c by angle (radians, counter-clockwise). */
export function rotateAbout(p: Vec, c: Vec, angle: number): Vec {
  const s = Math.sin(angle);
  const co = Math.cos(angle);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
}

export function normalizeAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

export const deg = (d: number): number => (d * Math.PI) / 180;
export const toDeg = (r: number): number => (r * 180) / Math.PI;
