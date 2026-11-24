import { describe, expect, it } from 'vitest';
import { getScenario, SCENARIOS } from '../../scenarios';
import { emptyFacts, scoreRound } from './scoreRound';
import { resolveZone, type StandInRange } from './seizing';

const st = (owner: 'P1' | 'P2', cls: StandInRange['cls'], extra: Partial<StandInRange> = {}): StandInRange => ({
  owner,
  cls,
  isMonster: false,
  canSeize: true,
  ...extra,
});

describe('seizing objective zones (core p.106, pack p.8)', () => {
  it('seizing: light stands count as 0 for seizing but count toward the total (core p.106)', () => {
    const r = resolveZone({ stands: [st('P1', 'Light'), st('P1', 'Light'), st('P2', 'Medium')] });
    expect(r.totals).toEqual({ P1: 2, P2: 1 });
    expect(r.seizing).toEqual({ P1: 0, P2: 1 });
    expect(r.seizedBy).toBeNull();
  });
  it('seizing: medium and heavy stands count as 1 (core p.106)', () => {
    expect(resolveZone({ stands: [st('P1', 'Medium'), st('P1', 'Heavy'), st('P2', 'Heavy')] }).seizedBy).toBe('P1');
  });
  it('seizing: monster stands count as 3 (core p.106)', () => {
    const r = resolveZone({
      stands: [st('P1', 'Heavy', { isMonster: true }), st('P2', 'Medium'), st('P2', 'Medium')],
    });
    expect(r.seizing).toEqual({ P1: 3, P2: 2 });
    // P1 has fewer Stands in total (1 v 2), so cannot Seize despite more weight (pack p.8).
    expect(r.seizedBy).toBeNull();
  });
  it('seizing: needs more total AND more seizing stands (pack p.8)', () => {
    expect(resolveZone({ stands: [st('P1', 'Heavy', { isMonster: true }), st('P1', 'Light'), st('P2', 'Medium')] }).seizedBy).toBe('P1');
  });
  it('seizing: ties mean nobody seizes (AMB-19)', () => {
    expect(resolveZone({ stands: [st('P1', 'Medium'), st('P2', 'Medium')] }).seizedBy).toBeNull();
  });
  it('seizing: broken stands do not seize but still count toward the total (core p.60, p.106)', () => {
    const r = resolveZone({ stands: [st('P1', 'Medium', { canSeize: false }), st('P1', 'Medium', { canSeize: false }), st('P2', 'Medium')] });
    expect(r.totals.P1).toBe(2);
    expect(r.seizedBy).toBeNull();
  });
  it('seizing: a friendly zone cannot be seized by its owner (pack p.8)', () => {
    expect(resolveZone({ friendlyTo: 'P1', stands: [st('P1', 'Medium')] }).seizedBy).toBeNull();
  });
  it('seizing: a zone holding a friendly marker is contested for the enemy (pack p.8)', () => {
    expect(resolveZone({ contestedBy: ['P1'], stands: [st('P2', 'Medium')] }).seizedBy).toBeNull();
    expect(resolveZone({ contestedBy: ['P1'], stands: [st('P1', 'Medium')] }).seizedBy).toBe('P1');
  });
});

describe('Forlorn Hope scoring (pack p.15)', () => {
  const fh = getScenario('forlorn-hope')!;
  it('seizing 3 zones = 2×3 + 3 bonus = 9 VP (pack p.15)', () => {
    const f = emptyFacts(3);
    f.seized.P1 = ['nw6', 'ne9', 'sw9'];
    expect(scoreRound(fh, f, 'P1').total).toBe(9);
  });
  it('seizing 4 zones = 11 VP (pack p.15)', () => {
    const f = emptyFacts(3);
    f.seized.P1 = ['nw6', 'ne9', 'sw9', 'se6'];
    expect(scoreRound(fh, f, 'P1').total).toBe(11);
  });
  it('2 zones, enemy marker destroyed and a character kill = 4 + 3 + 2 (pack p.15)', () => {
    const f = emptyFacts(4);
    f.seized.P2 = ['nw6', 'se6'];
    f.markersDestroyed.P2 = ['P1marker'];
    f.charactersKilled.P2 = 1;
    expect(scoreRound(fh, f, 'P2').total).toBe(9);
  });
  it('a player cannot score their own (friendly) marker (AMB-14)', () => {
    const f = emptyFacts(4);
    f.markersDestroyed.P1 = ['P1marker'];
    expect(scoreRound(fh, f, 'P1').total).toBe(0);
  });
  it('zones are not scored in round 1 (pack p.8)', () => {
    const f = emptyFacts(1);
    f.seized.P1 = ['nw6'];
    expect(scoreRound(fh, f, 'P1').total).toBe(0);
  });
});

describe('other scenario scorers', () => {
  it('Breakout: centre zone gives +2 extra in rounds 5–8 (pack p.13)', () => {
    const s = getScenario('breakout')!;
    const f = emptyFacts(6);
    f.seized.P1 = ['centre'];
    expect(scoreRound(s, f, 'P1').total).toBe(4);
    f.round = 9;
    expect(scoreRound(s, f, 'P1').total).toBe(2);
  });
  it('Maelstorm: zones score from round 1 (pack p.21)', () => {
    const s = getScenario('maelstorm')!;
    const f = emptyFacts(1);
    f.seized.P1 = ['centre', 'w9'];
    expect(scoreRound(s, f, 'P1').total).toBe(3);
  });
  it('Declined Flank: picked zones give no per-zone VP but count for bonuses (pack p.12, AMB-24)', () => {
    const s = getScenario('declined-flank')!;
    const f = emptyFacts(3);
    f.seized.P1 = ['z1', 'z2', 'z3'];
    f.zonePicks = { P1: 'z1', P2: 'z4' };
    expect(scoreRound(s, f, 'P1').total).toBe(2 * 2 + 2);
  });
  it('Head-to-Head: P1 scores 4 for zone B, P2 cannot seize B (pack p.20)', () => {
    const s = getScenario('head-to-head')!;
    const f = emptyFacts(3);
    f.seized.P1 = ['B', 'centre'];
    expect(scoreRound(s, f, 'P1').total).toBe(7);
  });
  it('warlord bonus once per game (pack p.11)', () => {
    const s = getScenario('divide-and-conquer')!;
    const f = emptyFacts(5);
    f.warlordSlain.P1 = true;
    expect(scoreRound(s, f, 'P1').total).toBe(2);
    f.warlordScoredBefore.P1 = true;
    expect(scoreRound(s, f, 'P1').total).toBe(0);
  });
});

describe('scenario data (pack p.11–22)', () => {
  it('has all 12 tournament scenarios and the 5 new 2026 scenarios', () => {
    expect(SCENARIOS.map((s) => s.name)).toEqual([
      'Divide and Conquer', 'Declined Flank', 'Breakout', 'Echelon', 'Forlorn Hope', 'Off-Balance',
      'Melee', 'Bulwark', 'Foresight', 'Head-to-Head', 'Maelstorm', 'Grind Them Down',
      'Seek and Destroy', 'Wheel of War', 'Cursed Sanctuaries', 'Flames of Conquest', 'Break the Line',
    ]);
  });
  for (const s of SCENARIOS) {
    it(`${s.name}: objects lie on the table, on the 6″ half-grid, with unique ids`, () => {
      const objs = [...s.zones, ...s.markers];
      expect(new Set(s.zones.map((z) => z.id)).size).toBe(s.zones.length);
      expect(new Set(s.markers.map((m) => m.id)).size).toBe(s.markers.length);
      for (const o of objs) {
        expect(o.x).toBeGreaterThan(0);
        expect(o.x).toBeLessThan(s.table.width);
        expect(o.y).toBeGreaterThan(0);
        expect(o.y).toBeLessThan(s.table.height);
        // Points of interest sit on square centres, side midpoints or corners (pack p.3),
        // except Breakout's Markers drawn on the edge of the centre zone (AMB-25).
        if (s.id !== 'breakout') {
          expect(o.x % 6, `${o.id} x`).toBe(0);
          expect(o.y % 6, `${o.id} y`).toBe(0);
        }
      }
      for (const z of s.zones) expect([3, 6, 9, 12]).toContain(z.diameter);
      for (const m of s.markers) expect(m).toMatchObject({ wounds: 3, defense: 3 });
      for (const r of s.scoring) for (const id of 'zoneIds' in r ? (r.zoneIds ?? []) : []) expect(s.zones.map((z) => z.id)).toContain(id);
    });
  }
});
