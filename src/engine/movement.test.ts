import { describe, expect, it } from 'vitest';
import { TOL } from './geometry/vec';
import { applyPath, marchShapeProblems, parseMoveText, pathCost } from './movement';

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(TOL);
const deg = (d: number) => (d * Math.PI) / 180;

describe('March (core p.28)', () => {
  it('forward moves along the facing', () => {
    const p = applyPath({ x: 10, y: 0, angle: Math.PI / 2 }, [{ kind: 'forward', d: 5 }], 6);
    close(p.x, 10);
    close(p.y, 5);
  });
  it('wheel pivots on a front corner; cost is the arc travelled by the other corner (core p.28, AMB-05)', () => {
    const width = 6;
    const segs = [{ kind: 'wheel' as const, pivot: 'left' as const, angle: deg(90) }];
    close(pathCost(segs, width), (Math.PI / 2) * 6);
    // Facing +y with front centre (0,0): left corner (-3,0) stays put; after a 90° left wheel the
    // regiment faces -x and its front centre is at (-3, 3).
    const p = applyPath({ x: 0, y: 0, angle: Math.PI / 2 }, segs, width);
    close(p.x, -3);
    close(p.y, 3);
    close(p.angle, Math.PI);
  });
  it('right wheel turns clockwise', () => {
    const p = applyPath({ x: 0, y: 0, angle: Math.PI / 2 }, [{ kind: 'wheel', pivot: 'right', angle: deg(90) }], 6);
    close(p.x, 3);
    close(p.y, 3);
    close(p.angle, 0);
  });
  it('3″ wheel + 10″ forward + 3″ wheel costs 16″ (core p.29, Fig. 3.3)', () => {
    const w = 6;
    const a = 3 / w;
    const segs = [
      { kind: 'wheel' as const, pivot: 'left' as const, angle: a },
      { kind: 'forward' as const, d: 10 },
      { kind: 'wheel' as const, pivot: 'right' as const, angle: a },
    ];
    close(pathCost(segs, w), 16);
    expect(marchShapeProblems(segs, 16, w)).toEqual([]);
    expect(marchShapeProblems(segs, 15, w).length).toBeGreaterThan(0);
  });
  it('sideways or backward only up to half March and not combined (core p.28)', () => {
    expect(marchShapeProblems([{ kind: 'sideways', d: 3 }], 6, 6)).toEqual([]);
    expect(marchShapeProblems([{ kind: 'sideways', d: 3.5 }], 6, 6).length).toBe(1);
    expect(marchShapeProblems([{ kind: 'backward', d: 2 }, { kind: 'forward', d: 1 }], 6, 6).length).toBeGreaterThan(0);
  });
  it('parses quick text entry', () => {
    expect(parseMoveText('forward 5.5')).toEqual([{ kind: 'forward', d: 5.5 }]);
    expect(parseMoveText('wheel 30 about left corner, f 4')).toEqual([
      { kind: 'wheel', pivot: 'left', angle: deg(30) },
      { kind: 'forward', d: 4 },
    ]);
    expect(parseMoveText('side 2 left')).toEqual([{ kind: 'sideways', d: -2 }]);
    expect(parseMoveText('back 3')).toEqual([{ kind: 'backward', d: 3 }]);
    expect(parseMoveText('dance')).toBeNull();
  });
});
