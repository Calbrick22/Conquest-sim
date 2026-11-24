import { describe, expect, it } from 'vitest';
import { createRng, rollD6, rollD6s } from './rng';

describe('seeded rng', () => {
  it('is deterministic for a given seed', () => {
    expect(rollD6s(createRng(42), 20)[0]).toEqual(rollD6s(createRng(42), 20)[0]);
  });
  it('differs between seeds', () => {
    expect(rollD6s(createRng(1), 20)[0]).not.toEqual(rollD6s(createRng(2), 20)[0]);
  });
  it('does not mutate the input state and counts draws', () => {
    const s0 = createRng(7);
    const [a, s1] = rollD6(s0);
    const [b] = rollD6(s0);
    expect(a).toBe(b);
    expect(s0.index).toBe(0);
    expect(s1.index).toBeGreaterThanOrEqual(1);
  });
  it('produces only 1–6 and roughly uniform counts', () => {
    const [vals] = rollD6s(createRng(123), 60000);
    const counts = [0, 0, 0, 0, 0, 0];
    for (const v of vals) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      counts[v - 1]!++;
    }
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400);
  });
});
