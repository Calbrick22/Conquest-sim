import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame, validate, type Action } from './game';
import type { GameState } from './model/types';
import type { RngState } from './rng';
import { zoneResults } from './scoring/victory';
import { entry, list } from './testing/fixtures';

function game(scenario: string, p1: Parameters<typeof entry>[0][], p2: Parameters<typeof entry>[0][]) {
  const g = createGame({ seed: 5, scenario: getScenario(scenario)!, lists: { P1: list('A', [{ regiments: p1.map(entry) }]), P2: list('B', [{ regiments: p2.map(entry) }]) } });
  const s = apply(g.state, { type: 'startBattle' }, g.rng).state;
  return { s: structuredClone(s), rng: g.rng };
}

function place(s: GameState, id: string, x: number, y: number, angle = Math.PI / 2) {
  const r = s.regiments[id]!;
  r.location = 'table';
  r.arrivedRound = 0;
  r.pose = { x, y, angle };
}

function step(s: GameState, rng: RngState, a: Action) {
  const v = validate(s, a);
  if (!v.ok) throw new Error(`${a.type}: ${v.reasons.join(' ')}`);
  return apply(s, a, rng);
}

/** Runs the end of the Round from any state (skipping the Action Phase). */
function endRound(s: GameState, rng: RngState) {
  const t = structuredClone(s);
  t.step = 'victory';
  t.activation = null;
  t.drawn = null;
  return step(t, rng, { type: 'endRound' });
}

describe('seizing zones from positions (core p.106; pack p.8)', () => {
  it('a medium regiment overlapping a Forlorn Hope zone seizes it and scores 2 VP in round 2 (pack p.15)', () => {
    const { s, rng } = game('forlorn-hope', [{ name: 'Mid', stands: 3, cls: 'Medium' }], [{ name: 'Far', stands: 3 }]);
    place(s, 'P1-w0-r0', 24, 20); // front edge at y=20, body 17.4–20: overlaps the 9″ zone at (24,18)
    s.round = 2;
    expect(zoneResults(s)['sw9']!.seizedBy).toBe('P1');
    const r = endRound(s, rng);
    expect(r.state.scoreHistory[0]!.vp).toEqual({ P1: 2, P2: 0 });
    expect(r.state.players.P1.vp).toBe(2);
  });
  it('zones are not scored in round 1 (pack p.8)', () => {
    const { s, rng } = game('forlorn-hope', [{ name: 'Mid', stands: 3 }], [{ name: 'Far', stands: 3 }]);
    place(s, 'P1-w0-r0', 24, 20);
    expect(endRound(s, rng).state.players.P1.vp).toBe(0);
  });
  it('light stands count for the total but not for seizing (pack p.8)', () => {
    const { s } = game('forlorn-hope', [{ name: 'Mid', stands: 3, cls: 'Medium' }], [{ name: 'Lights', stands: 4, cls: 'Light' }]);
    place(s, 'P1-w0-r0', 24, 20);
    place(s, 'P2-w0-r0', 24, 15.4, -Math.PI / 2);
    const z = zoneResults(s)['sw9']!;
    expect(z.totals.P2).toBeGreaterThan(z.totals.P1);
    expect(z.seizedBy).toBeNull();
  });
  it('broken regiments do not seize (core p.60)', () => {
    const { s } = game('forlorn-hope', [{ name: 'Mid', stands: 3 }], [{ name: 'Far', stands: 3 }]);
    place(s, 'P1-w0-r0', 24, 20);
    s.regiments['P1-w0-r0']!.broken = true;
    expect(zoneResults(s)['sw9']!.seizedBy).toBeNull();
  });
  it('a friendly objective marker in a zone contests it for the enemy (pack p.8)', () => {
    const { s } = game('bulwark', [{ name: 'Mid', stands: 3 }], [{ name: 'Far', stands: 3 }]);
    // Marker A (friendly to P1) sits in the left zone at (18,24): P2 cannot seize it.
    place(s, 'P2-w0-r0', 18, 27, -Math.PI / 2);
    expect(zoneResults(s)['left']!.contestedBy).toEqual(['P1']);
    expect(zoneResults(s)['left']!.seizedBy).toBeNull();
  });
});

describe('objective markers (pack p.8–9)', () => {
  function atMarker(cls: 'Medium' | 'Heavy') {
    const { s, rng } = game('forlorn-hope', [{ name: 'Smash', stands: 4, cls, stats: { M: 6, V: 1, C: 6, A: 6, W: 4, R: 3, D: 2, E: 0 } as never }], [{ name: 'Far', stands: 3 }]);
    s.round = 2;
    s.step = 'action';
    // P2's Marker at (36,30); front edge of the P1 Regiment touching its bottom edge.
    place(s, 'P1-w0-r0', 36, 30 - 2.598 / 2);
    s.turn = 'P1';
    s.drawn = { player: 'P1', card: { id: 'c', kind: 'regiment', name: 'Smash', refId: 'P1-w0-r0' } };
    const t = step(s, rng, { type: 'activate', regimentId: 'P1-w0-r0' }).state;
    return { t, rng };
  }
  it('cannot attack your own (friendly) marker (pack p.8)', () => {
    const { t } = atMarker('Medium');
    expect(validate(t, { type: 'clash', regimentId: 'P1-w0-r0', targetId: 'marker:P1marker' }).ok).toBe(false);
  });
  it('a medium regiment causes at most 1 wound per clash; a heavy one at most 2 (pack p.9)', () => {
    for (const [cls, cap] of [['Medium', 1], ['Heavy', 2]] as const) {
      const { t, rng } = atMarker(cls);
      t.forcedDice = Array(30).fill(1).concat(Array(30).fill(6));
      const r = step(t, rng, { type: 'clash', regimentId: 'P1-w0-r0', targetId: 'marker:P2marker' });
      expect(r.state.markers['P2marker']!.woundsBy.P1).toBe(cap);
    }
  });
  it('a marker is destroyed when one player has dealt 3 wounds; scoring 3 VP in Forlorn Hope (pack p.9, p.15)', () => {
    const { t, rng } = atMarker('Heavy');
    t.markers['P2marker']!.woundsBy.P1 = 2;
    t.markers['P2marker']!.woundsBy.P2 = 0;
    t.forcedDice = Array(30).fill(1).concat(Array(30).fill(6));
    const r = step(t, rng, { type: 'clash', regimentId: 'P1-w0-r0', targetId: 'marker:P2marker' });
    expect(r.state.markers['P2marker']!.destroyed).toBe(true);
    const end = endRound(r.state, rng).state;
    expect(end.scoreHistory[0]!.vp.P1).toBe(3);
  });
  it('markers cannot be attacked in round 1 (pack p.9)', () => {
    const { t } = atMarker('Medium');
    const u = structuredClone(t);
    u.round = 1;
    expect(validate(u, { type: 'clash', regimentId: 'P1-w0-r0', targetId: 'marker:P2marker' }).ok).toBe(false);
  });
});

describe('zone picks (pack p.12, p.22)', () => {
  it('Declined Flank: First then Second Player pick different zones; picked zones give no VP', () => {
    const { s, rng } = game('declined-flank', [{ name: 'Mid', stands: 3 }], [{ name: 'Far', stands: 3 }]);
    let t: GameState = structuredClone(s);
    t.round = 2;
    t.step = 'supremacy';
    t.supremacyWinner = 'P1';
    t = step(t, rng, { type: 'chooseFirst', first: 'P2' }).state;
    expect(t.step).toBe('supremacy');
    expect(validate(t, { type: 'pickZone', player: 'P1', zoneId: 'z1' }).ok).toBe(false);
    t = step(t, rng, { type: 'pickZone', player: 'P2', zoneId: 'z2' }).state;
    expect(validate(t, { type: 'pickZone', player: 'P1', zoneId: 'z2' }).ok).toBe(false);
    t = step(t, rng, { type: 'pickZone', player: 'P1', zoneId: 'z1' }).state;
    expect(t.step).not.toBe('supremacy');
    place(t, 'P1-w0-r0', 18, 20); // overlaps z2 (18,18)
    const end = endRound(t, rng).state;
    expect(end.scoreHistory[0]!.seized.P1).toEqual(['z2']);
    expect(end.scoreHistory[0]!.vp.P1).toBe(0);
  });
});
