import { describe, expect, it } from 'vitest';
import { baseInches } from './geometry/bases';
import { TOL } from './geometry/vec';
import { clampFiles, commandFile, footprint, layout, legalFiles, ranksFor } from './formation';
import type { StandState } from './model/types';

const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(TOL);
const stands = (n: number, cmd = true, wounded: number[] = []): StandState[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, wounds: wounded.includes(i) ? 1 : 0, isCommand: cmd && i === 0 }));
const W = baseInches('Infantry').width;

describe('formations (core p.13)', () => {
  it('front rank has at least 2 stands unless a single stand (core p.13)', () => {
    expect(legalFiles(1)).toEqual([1]);
    expect(legalFiles(4)).toEqual([2, 3, 4]);
    expect(clampFiles(5, 1)).toBe(2);
  });
  it('ranks are full except possibly the rear (core p.13)', () => {
    expect(ranksFor(7, 3)).toBe(3);
    const l = layout({ regiment: { stands: stands(7), files: 3, pose: { x: 10, y: 10, angle: Math.PI / 2 }, type: 'Infantry' } });
    expect(l.filter((s) => s.rank === 0)).toHaveLength(3);
    expect(l.filter((s) => s.rank === 2)).toHaveLength(1);
  });
  it('incomplete rear rank is centred (core p.13, AMB-27)', () => {
    const l = layout({ regiment: { stands: stands(7), files: 3, pose: { x: 10, y: 10, angle: Math.PI / 2 }, type: 'Infantry' } });
    const rear = l.find((s) => s.rank === 2)!;
    close(rear.rect.c.x, 10);
  });
  it('command stand in the centre of the front rank (core p.13)', () => {
    const l = layout({ regiment: { stands: stands(5), files: 5, pose: { x: 0, y: 0, angle: Math.PI / 2 }, type: 'Infantry' } });
    const cmd = l.find((s) => s.isCommand)!;
    expect(cmd.rank).toBe(0);
    expect(cmd.file).toBe(commandFile(5));
    close(cmd.rect.c.x, 0);
  });
  it('character stands next to the command stand in the front rank (core p.73)', () => {
    const l = layout({ regiment: { stands: stands(3), files: 4, pose: { x: 0, y: 0, angle: Math.PI / 2 }, type: 'Infantry' }, characterId: 'c' });
    const c = l.find((s) => s.isCharacter)!;
    const cmd = l.find((s) => s.isCommand)!;
    expect(c.rank).toBe(0);
    expect(Math.abs(c.file - cmd.file)).toBe(1);
  });
  it('wounded stands go to the rear rank (core p.13)', () => {
    const l = layout({ regiment: { stands: stands(6, true, [1]), files: 3, pose: { x: 0, y: 0, angle: Math.PI / 2 }, type: 'Infantry' } });
    expect(l.find((s) => s.id === 's1')!.rank).toBe(1);
  });
  it('stands sit edge to edge behind the front edge, rotated with the pose', () => {
    const l = layout({ regiment: { stands: stands(2), files: 2, pose: { x: 0, y: 0, angle: 0 }, type: 'Infantry' } }); // facing +x
    for (const s of l) close(s.rect.c.x, -W / 2);
    const ys = l.map((s) => s.rect.c.y).sort((a, b) => a - b);
    close(ys[1]! - ys[0]!, W);
  });
  it('footprint covers full ranks (core p.45)', () => {
    const fp = footprint({ regiment: { stands: stands(5), files: 3, pose: { x: 0, y: 0, angle: Math.PI / 2 }, type: 'Infantry' } });
    close(fp.halfWidth * 2, 3 * W);
    close(fp.halfDepth * 2, 2 * W);
    close(fp.c.y, -W);
  });
});
