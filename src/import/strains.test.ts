import { describe, expect, it } from 'vitest';
import { parseStrainText } from './strains';

describe('strain text (owner-entered, AMB-18)', () => {
  it('reads characteristic changes and rules', () => {
    expect(parseStrainText('+1 Clash, Attacks +2, Flurry, Cleave (1)')).toEqual({ stats: { C: 1, A: 2 }, rules: ['Flurry', 'Cleave (1)'], text: '+1 Clash, Attacks +2, Flurry, Cleave (1)' });
  });
  it('accepts short names and negatives', () => {
    expect(parseStrainText('+2 M, -1 D').stats).toEqual({ M: 2, D: -1 });
  });
});
