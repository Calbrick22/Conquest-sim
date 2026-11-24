import { describe, expect, it } from 'vitest';
import { getScenario, SCENARIOS } from '../scenarios';
import { apply, createGame, validate, type Action } from './game';
import type { GameState } from './model/types';
import type { RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { entry, list } from './testing/fixtures';
import { parseRuleRef } from '../import/ruleTokens';
import type { ListEntry } from '../import/types';
import type { TerrainPiece } from '../scenarios/types';
import { makePiece, piecePoly } from './terrain';
import { expandLayout, fitLayout, LAYOUTS, layoutProblems, randomLayout, terrainFor } from './terrainLayouts';
import { hasLineOfSight, planVolley } from './actions';
import { stat } from './combat';
import { polyDistance } from './geometry/polygon';

const R = parseRuleRef;

function arena(terrain: TerrainPiece[], atk: Partial<ListEntry> & { rules?: string[] } = {}, gap = 10, def: Partial<ListEntry> = {}) {
  const sc = { ...getScenario('melee')!, terrain };
  const A = list('A', [{ regiments: [entry({ name: 'Archers', stands: 3, ...atk, specialRules: (atk.rules ?? []).map(R) })] }]);
  const D = list('D', [{ regiments: [entry({ name: 'Targets', stands: 3, ...def })] }]);
  const g = createGame({ seed: 3, scenario: sc, lists: { P1: A, P2: D } });
  const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
  const a = s.regiments['P1-w0-r0']!;
  const d = s.regiments['P2-w0-r0']!;
  for (const r of [a, d]) {
    r.location = 'table';
    r.arrivedRound = 0;
    r.files = 3;
  }
  a.pose = { x: 36, y: 30 - gap, angle: Math.PI / 2 };
  d.pose = { x: 36, y: 30, angle: -Math.PI / 2 };
  s.step = 'action';
  refreshRules(s);
  return { s, rng: g.rng };
}

function activate(s: GameState, rng: RngState): GameState {
  const t = structuredClone(s);
  t.turn = 'P1';
  t.drawn = { player: 'P1', card: { id: 'c', kind: 'regiment', name: 'Archers', refId: 'P1-w0-r0' } };
  return apply(t, { type: 'activate', regimentId: 'P1-w0-r0' }, rng).state;
}

describe('terrain layouts (ns p.7–9; pack p.3–4)', () => {
  it('each 2026 layout fits its own scenario: mirrored, 9″ apart where possible, Impassable off the zones', () => {
    for (const def of LAYOUTS) {
      const sc = getScenario(def.id)!;
      const pieces = fitLayout(sc, expandLayout(def));
      expect(pieces.length).toBeGreaterThanOrEqual(6);
      expect(pieces.length).toBeLessThanOrEqual(9);
      expect(layoutProblems(sc, pieces).filter((p) => !p.includes('within 9'))).toEqual([]);
      // Half-turn symmetry about the centre.
      for (const p of pieces.filter((x) => x.id.endsWith('a'))) {
        const t = pieces.find((x) => x.id === p.id.replace(/a$/, 'b'))!;
        expect(t.x).toBeCloseTo(72 - p.x, 6);
        expect(t.y).toBeCloseTo(48 - p.y, 6);
      }
    }
  });

  it('random layouts are legal and symmetrical on every scenario, and the same seed gives the same table', () => {
    for (const sc of SCENARIOS)
      for (const seed of [1, 2, 3]) {
        const pieces = randomLayout(sc, seed);
        expect(layoutProblems(sc, pieces), `${sc.id} seed ${seed}`).toEqual([]);
        expect(pieces.length).toBeGreaterThanOrEqual(6);
      }
    const sc = getScenario('melee')!;
    expect(randomLayout(sc, 42)).toEqual(randomLayout(sc, 42));
  });

  it('any layout can be fitted to any scenario without Impassable pieces on zones or markers', () => {
    for (const sc of SCENARIOS)
      for (const def of LAYOUTS) {
        const { pieces } = terrainFor(sc, { mode: 'layout', id: def.id });
        expect(layoutProblems(sc, pieces).filter((p) => !p.includes('within 9') && !p.includes('fewer than')), `${def.id} on ${sc.id}`).toEqual([]);
      }
  });
});

describe('terrain rules (core p.84–90)', () => {
  it('Impassable: a March cannot pass through or end on it (core p.87)', () => {
    const boulder = makePiece('b', 'boulder', 36, 25);
    const { s, rng } = arena([boulder], {}, 14);
    const u = activate(s, rng);
    const v = validate(u, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 6 + 2 }] });
    expect(v.ok).toBe(false);
  });

  it('Fly passes over Impassable terrain but cannot end on it (core p.98)', () => {
    const boulder = makePiece('b', 'boulder', 36, 17);
    const { s, rng } = arena([boulder], { rules: ['Fly'], stats: { M: 12, V: 1, C: 2, A: 4, W: 4, R: 3, D: 2, E: 0 } }, 18);
    const u = activate(s, rng);
    expect(validate(u, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 11 }] }).ok).toBe(true);
    expect(validate(u, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 5 }] }).ok).toBe(false);
  });

  it('Obstructing: a Size 4 Boulder between Regiments blocks Line of Sight (core p.86)', () => {
    const { s } = arena([makePiece('b', 'boulder', 36, 25)], {}, 10);
    expect(hasLineOfSight(s, s.regiments['P1-w0-r0']!, s.regiments['P2-w0-r0']!)).toBe(false);
    const open = arena([], {}, 10).s;
    expect(hasLineOfSight(open, open.regiments['P1-w0-r0']!, open.regiments['P2-w0-r0']!)).toBe(true);
  });

  it('Cover: a Volley at a Regiment wholly within a Forest is halved (core p.86)', () => {
    const forest = { ...makePiece('f', 'forest', 36, 31.5), w: 12, h: 6 };
    const shooters = { rules: ['Barrage (4) [24"]'] };
    const { s } = arena([forest], shooters, 12);
    const plan = planVolley(s, s.regiments['P1-w0-r0']!, s.regiments['P2-w0-r0']!, false);
    expect(plan.plans.some((p) => /Cover/.test(p.label))).toBe(true);
    expect(plan.plans.filter((p) => p.shots > 0).every((p) => p.shots <= 3)).toBe(true);
  });

  it('Hindering: Charging through a Forest makes no Impact Attacks (core p.86)', () => {
    const forest = { ...makePiece('f', 'forest', 36, 26.5), w: 14, h: 6 };
    const { s, rng } = arena([forest], { rules: ['Impact (3)'], cls: 'Medium' }, 8);
    const u = activate(s, rng);
    const a: Action = { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' };
    u.forcedDice = [6];
    expect(validate(u, a).ok).toBe(true);
    const res = apply(u, a, rng);
    expect(res.events.some((e) => /Hindering terrain: no Impact Attacks and no Inspired/.test(e.text))).toBe(true);
    expect(res.events.some((e) => /Impact \(3\)/.test(e.text))).toBe(false);
  });

  it('Water: −1 Clash with at least half the Stands in a Pond (core p.87)', () => {
    const pond = { ...makePiece('p', 'pond', 36, 18.5), w: 12, h: 6 };
    const { s } = arena([pond], {}, 12);
    expect(stat(s.regiments['P1-w0-r0']!, 'C')).toBe(1);
  });

  it('pieces are rectangles of the 2026 sizes (ns p.1)', () => {
    const p = makePiece('h', 'hill', 10, 10, 90);
    const poly = piecePoly(p);
    const xs = poly.map((v) => v.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(6, 6);
    expect(polyDistance(poly, piecePoly(makePiece('x', 'field', 30, 10)))).toBeGreaterThan(9);
  });
});

describe('2026 scenarios (ns p.2–6)', () => {
  it('Wheel of War: the Priority Zone starts nearest P1 and moves clockwise each Round (ns p.3)', async () => {
    const { priorityZone } = await import('./scoring/scoreRound');
    const sc = getScenario('wheel-of-war')!;
    expect([1, 2, 3, 4, 5].map((r) => priorityZone(sc, r))).toEqual(['s', 'w', 'n', 'e', 's']);
  });

  it('Flames of Conquest: from Round 4 a Regiment Seizing a zone may Burn it for 4 VP; the zone leaves the game (ns p.5)', () => {
    const sc = { ...getScenario('flames-of-conquest')!, terrain: [] };
    const A = list('A', [{ regiments: [entry({ name: 'Burners', stands: 3, cls: 'Medium' })] }]);
    const D = list('D', [{ regiments: [entry({ name: 'Far', stands: 3 })] }]);
    const g = createGame({ seed: 3, scenario: sc, lists: { P1: A, P2: D } });
    const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
    const a = s.regiments['P1-w0-r0']!;
    a.location = 'table';
    a.files = 3;
    a.pose = { x: 12, y: 19, angle: Math.PI / 2 };
    s.step = 'action';
    s.round = 3;
    s.turn = 'P1';
    s.drawn = { player: 'P1', card: { id: 'c', kind: 'regiment', name: 'Burners', refId: a.id } };
    refreshRules(s);
    let u = apply(s, { type: 'activate', regimentId: a.id }, g.rng).state;
    expect(validate(u, { type: 'burnZone', regimentId: a.id, zoneId: 'w1' }).ok).toBe(false);
    u.round = 4;
    expect(validate(u, { type: 'burnZone', regimentId: a.id, zoneId: 'w1' }).ok).toBe(true);
    u = apply(u, { type: 'burnZone', regimentId: a.id, zoneId: 'w1' }, g.rng).state;
    expect(u.burnedZones).toEqual(['w1']);
    expect(u.tally.burned!.P1).toEqual(['w1']);
  });

  it('Cursed Sanctuaries: Regiments in a zone suffer Hits against their Resolve in the Victory Phase (ns p.4)', () => {
    const sc = { ...getScenario('cursed-sanctuaries')!, terrain: [] };
    const A = list('A', [{ regiments: [entry({ name: 'Pilgrims', stands: 3, stats: { M: 6, V: 1, C: 2, A: 4, W: 4, R: 0, D: 5, E: 0 } })] }]);
    const D = list('D', [{ regiments: [entry({ name: 'Far', stands: 3 })] }]);
    const g = createGame({ seed: 3, scenario: sc, lists: { P1: A, P2: D } });
    const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
    const a = s.regiments['P1-w0-r0']!;
    a.location = 'table';
    a.files = 3;
    a.pose = { x: 36, y: 25, angle: Math.PI / 2 };
    s.round = 2;
    s.step = 'victory';
    refreshRules(s);
    const res = apply(s, { type: 'endRound' }, g.rng);
    expect(res.events.some((e) => /Cursed Sanctuary c6: Pilgrims suffers 4 Hits against its Resolve 0/.test(e.text))).toBe(true);
    // Resolve 0: every Hit wounds (a Defense roll of 1 is not an automatic save).
    expect(res.events.some((e) => /saves on 0 or less: 0 saved, 4 Wounds/.test(e.text))).toBe(true);
  });
});
