import { describe, expect, it } from 'vitest';
import { baseInches, mmToInches, STAND_SIZE } from './bases';

const TOL = 0.01;

describe('base sizes', () => {
  it('converts mm to inches at 25.4 mm per inch', () => {
    expect(mmToInches(25.4)).toBeCloseTo(1, 6);
  });
  it('infantry stand is 66 mm square ≈ 2.598″ (owner-supplied, AMB-02)', () => {
    const b = baseInches('Infantry');
    expect(Math.abs(b.width - 2.598)).toBeLessThan(TOL);
    expect(Math.abs(b.depth - 2.598)).toBeLessThan(TOL);
  });
  it('monster stand is 110 mm square ≈ 4.331″ (owner-supplied, AMB-02)', () => {
    expect(Math.abs(baseInches('Monster').width - 4.331)).toBeLessThan(TOL);
  });
  it('chariot is two squares back to back (core p.11)', () => {
    const c = baseInches('Chariot');
    expect(c.depth).toBeCloseTo(2 * c.width, 6);
  });
  it('stand sizes for line of sight (core p.12)', () => {
    expect(STAND_SIZE.Infantry).toBe(1);
    expect(STAND_SIZE.Cavalry).toBe(2);
    expect(STAND_SIZE.Brute).toBe(2);
    expect(STAND_SIZE.Monster).toBe(3);
  });
});
