import { describe, expect, it } from 'vitest';
import { arcsOf, majorityArc, pointInArc } from './arcs';
import { lineBlockedBy, volleyLineObstructed } from './los';
import { inContact, intersectionArea, overlaps, polyDistance, rectCorners, rectPoly, type Rect } from './polygon';
import { deg, dist, rotateAbout, TOL, v } from './vec';
import { standOverlapsZone } from './zones';

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(TOL);
/** Square stand of side s centred at (x, y), facing angle a (radians). */
const sq = (x: number, y: number, s = 2, a = Math.PI / 2): Rect => ({ c: v(x, y), halfWidth: s / 2, halfDepth: s / 2, angle: a });

describe('oriented rectangles', () => {
  it('corners of an unrotated rect facing +y', () => {
    const [fl, fr, rr, rl] = rectCorners({ c: v(10, 10), halfWidth: 3, halfDepth: 1, angle: Math.PI / 2 });
    close(fl.x, 7); close(fl.y, 11);
    close(fr.x, 13); close(fr.y, 11);
    close(rr.x, 13); close(rr.y, 9);
    close(rl.x, 7); close(rl.y, 9);
  });
  it('corners rotate with facing (45°)', () => {
    const r: Rect = { c: v(0, 0), halfWidth: 1, halfDepth: 1, angle: deg(45) };
    for (const p of rectCorners(r)) close(dist(p, v(0, 0)), Math.SQRT2);
    // Facing 45°: the front-left corner points straight up, toward +y (the front is the north-east edge).
    close(rectCorners(r)[0].x, 0);
    close(rectCorners(r)[0].y, Math.SQRT2);
  });
});

describe('distance and contact (core p.10, p.16)', () => {
  it('edge to edge distance between parallel stands', () => {
    close(polyDistance(rectPoly(sq(0, 0)), rectPoly(sq(5, 0))), 3);
  });
  it('distance is closest point to closest point, including corners (core p.10)', () => {
    // Corner (1,1) to corner (4,5): 3-4-5 triangle.
    close(polyDistance(rectPoly(sq(0, 0)), rectPoly(sq(5, 6))), 5);
  });
  it('rotated stands: corner to edge distance', () => {
    const a = rectPoly(sq(0, 0));
    const b = rectPoly({ ...sq(4, 0), angle: deg(45) }); // diamond; left corner at x = 4 - √2
    close(polyDistance(a, b), 4 - Math.SQRT2 - 1);
  });
  it('touching edge to edge is contact, not overlap', () => {
    const a = rectPoly(sq(0, 0));
    const b = rectPoly(sq(2, 0));
    expect(inContact(a, b)).toBe(true);
    expect(overlaps(a, b)).toBe(false);
  });
  it('contact at corners counts (core p.16)', () => {
    expect(inContact(rectPoly(sq(0, 0)), rectPoly(sq(2, 2)))).toBe(true);
    expect(inContact(rectPoly(sq(0, 0)), rectPoly(sq(2.05, 2.05)))).toBe(false);
  });
  it('rotated corner touching an edge is contact', () => {
    const b = { ...sq(1 + Math.SQRT2, 0), angle: deg(45) };
    expect(inContact(rectPoly(sq(0, 0)), rectPoly(b))).toBe(true);
    expect(overlaps(rectPoly(sq(0, 0)), rectPoly(b))).toBe(false);
  });
  it('overlap detected for rotated rects', () => {
    expect(overlaps(rectPoly(sq(0, 0)), rectPoly({ ...sq(1.5, 0.5), angle: deg(30) }))).toBe(true);
  });
  it('overlap within tolerance is not overlap', () => {
    expect(overlaps(rectPoly(sq(0, 0)), rectPoly(sq(1.995, 0)))).toBe(false);
  });
});

describe('facing arcs (core p.13–14, Fig. 1.3)', () => {
  const reg: Rect = { c: v(0, 0), halfWidth: 3, halfDepth: 1, angle: Math.PI / 2 }; // 6 wide, 2 deep, facing +y
  it('points straight ahead are in the front arc', () => {
    expect(pointInArc(reg, v(0, 5), 'front')).toBe(true);
    expect(pointInArc(reg, v(0, 5), 'left')).toBe(false);
  });
  it('the 45° line from a front corner is the front/flank boundary', () => {
    // From front-right corner (3,1), 45° outward: (3+t, 1+t).
    expect(pointInArc(reg, v(5, 3), 'front')).toBe(true);
    expect(pointInArc(reg, v(5, 3), 'right')).toBe(true);
    expect(pointInArc(reg, v(5.1, 3), 'front')).toBe(false);
    expect(pointInArc(reg, v(4.9, 3), 'right')).toBe(false);
  });
  it('rear and flanks', () => {
    expect(pointInArc(reg, v(0, -4), 'rear')).toBe(true);
    expect(pointInArc(reg, v(-6, 0), 'left')).toBe(true);
    expect(pointInArc(reg, v(6, 0), 'right')).toBe(true);
  });
  it('arcs rotate with the regiment', () => {
    const r = { ...reg, angle: 0 }; // facing +x: right flank is now -y
    expect(pointInArc(r, v(6, 0), 'front')).toBe(true);
    expect(pointInArc(r, v(0, -6), 'right')).toBe(true);
    expect(pointInArc(r, v(0, 6), 'left')).toBe(true);
    expect(pointInArc(r, v(-6, 0), 'rear')).toBe(true);
  });
  it('a stand straddling an arc edge is in both arcs (core p.35)', () => {
    const t = rectPoly(sq(5, 3, 1));
    expect(arcsOf(reg, t).sort()).toEqual(['front', 'right']);
  });
  it('majority arc picks the arc holding most of a stand (core p.35)', () => {
    expect(majorityArc(reg, rectPoly(sq(4.6, 3, 1)))).toBe('front');
    expect(majorityArc(reg, rectPoly(sq(5.6, 3, 1)))).toBe('right');
  });
  it('rotated target stand arcs', () => {
    const t = rectPoly({ ...sq(0, 8, 2), angle: deg(30) });
    expect(arcsOf(reg, t)).toEqual(['front']);
  });
});

describe('line of sight lines (core p.14, p.38)', () => {
  const blocker = { poly: rectPoly(sq(5, 0, 2)), size: 1 };
  it('a line through an obstacle is blocked', () => {
    expect(lineBlockedBy(v(0, 0), v(10, 0), blocker)).toBe(true);
  });
  it('a line passing just clear (more than 0.5 mm) is not blocked', () => {
    expect(lineBlockedBy(v(0, 1.03), v(10, 1.03), blocker)).toBe(false);
  });
  it('a line grazing within 0.5 mm is blocked (1 mm wide line, AMB-08)', () => {
    expect(lineBlockedBy(v(0, 1.01), v(10, 1.01), blocker)).toBe(true);
  });
  it('volley obstruction needs size ≥ both shooter and target (core p.38)', () => {
    const big = { ...blocker, size: 2 };
    expect(volleyLineObstructed(v(0, 0), v(10, 0), 1, 1, [blocker])).toBe(true);
    expect(volleyLineObstructed(v(0, 0), v(10, 0), 2, 1, [blocker])).toBe(false);
    expect(volleyLineObstructed(v(0, 0), v(10, 0), 1, 3, [big])).toBe(false);
    expect(volleyLineObstructed(v(0, 0), v(10, 0), 2, 2, [big])).toBe(true);
  });
});

describe('objective zone overlap (pack p.8)', () => {
  it('a stand overlapping the circle is in range', () => {
    expect(standOverlapsZone(rectPoly(sq(0, 3.5)), v(0, 0), 6)).toBe(true);
  });
  it('a stand just outside is not', () => {
    expect(standOverlapsZone(rectPoly(sq(0, 4.05)), v(0, 0), 6)).toBe(false);
  });
  it('a rotated stand corner reaching into the zone counts', () => {
    // Diamond centred at (0, 4.2): lowest corner at 4.2 - √2 ≈ 2.79 < 3.
    expect(standOverlapsZone(rectPoly({ ...sq(0, 4.2), angle: deg(45) }), v(0, 0), 6)).toBe(true);
  });
  it('corner near the circle diagonally: uses true distance, not bounding box', () => {
    // Corner at (2.2, 2.2): distance 3.11 > 3.
    expect(standOverlapsZone(rectPoly(sq(3.2, 3.2)), v(0, 0), 6)).toBe(false);
  });
});

describe('polygon helpers', () => {
  it('intersection area of overlapping squares', () => {
    close(intersectionArea(rectPoly(sq(0, 0)), rectPoly(sq(1, 1))), 1);
  });
  it('rotateAbout', () => {
    const p = rotateAbout(v(1, 0), v(0, 0), Math.PI / 2);
    close(p.x, 0);
    close(p.y, 1);
  });
});
