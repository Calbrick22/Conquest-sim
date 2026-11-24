import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame, validate, type Action } from './game';
import type { GameState } from './model/types';
import type { RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { entry, list } from './testing/fixtures';
import { parseRuleRef } from '../import/ruleTokens';
import { chargeSuccessChance, previewAction } from './preview';

function arena(gap: number, atkRules: string[] = []) {
  const A = list('A', [{ regiments: [entry({ name: 'Spears', stands: 3, specialRules: atkRules.map((n) => parseRuleRef(n)), commandModels: ['Leader'] })] }]);
  const D = list('D', [{ regiments: [entry({ name: 'Shields', stands: 3 })] }]);
  const g = createGame({ seed: 1, scenario: getScenario('melee')!, lists: { P1: A, P2: D } });
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
  t.drawn = { player: 'P1', card: { id: 'c', kind: 'regiment', name: 'Spears', refId: 'P1-w0-r0' } };
  const a: Action = { type: 'activate', regimentId: 'P1-w0-r0' };
  expect(validate(t, a).ok).toBe(true);
  return apply(t, a, rng).state;
}

describe('outcome previews (roadmap 2.1)', () => {
  it('Charge chance: die + March 6 against 9″ needs 3+ on the die (core p.31)', () => {
    const { s, rng } = arena(9);
    const u = activate(s, rng);
    expect(chargeSuccessChance(u, u.regiments['P1-w0-r0']!, u.regiments['P2-w0-r0']!)).toBeCloseTo(4 / 6, 5);
  });

  it('Charge chance with Unstoppable re-rolls a failed Charge (core p.101)', () => {
    const { s, rng } = arena(9, ['Unstoppable']);
    const u = activate(s, rng);
    expect(chargeSuccessChance(u, u.regiments['P1-w0-r0']!, u.regiments['P2-w0-r0']!)).toBeCloseTo(4 / 6 + (2 / 6) * (4 / 6), 5);
  });

  it('a Clash preview averages Wounds over many rolls and does not change the game', () => {
    const { s, rng } = arena(0);
    const u = activate(s, rng);
    const before = JSON.stringify(u);
    const p = previewAction(u, 'clash', 'P1-w0-r0', 'P2-w0-r0', 100)!;
    expect(JSON.stringify(u)).toBe(before);
    expect(p.pSuccess).toBe(1);
    expect(p.wounds).toBeGreaterThan(0.5);
    expect(p.pBreak).toBeGreaterThanOrEqual(0);
    expect(p.pBreak).toBeLessThanOrEqual(1);
  });

  it('a Charge preview gives success chance and Impact damage', () => {
    const { s, rng } = arena(5, ['Impact (2)']);
    const u = activate(s, rng);
    const p = previewAction(u, 'charge', 'P1-w0-r0', 'P2-w0-r0', 60)!;
    expect(p.pSuccess).toBe(1);
    expect(p.wounds).toBeGreaterThan(0);
  });

  it('an illegal Action has no preview', () => {
    const { s, rng } = arena(20);
    const u = activate(s, rng);
    expect(previewAction(u, 'clash', 'P1-w0-r0', 'P2-w0-r0')).toBeNull();
  });
});

describe('charge reach (roadmap 2.2)', () => {
  it('bands: March 6 always reaches 7″, at least half the time 10″ (4+), at most 12″ (core p.31)', async () => {
    const { chargeBands, frontReachPolygon } = await import('./reach');
    const { s } = arena(10);
    const r = s.regiments['P1-w0-r0']!;
    const bands = chargeBands(s, r);
    expect(bands.map((b) => b.d)).toEqual([7, 10, 12]);
    expect(bands.map((b) => Math.round(b.p * 100))).toEqual([100, 50, 17]);
    // The reach area starts at the front corners and extends d ahead of the front edge.
    const poly = frontReachPolygon(s, r, 7);
    const maxY = Math.max(...poly.map((p) => p.y));
    expect(maxY - r.pose.y).toBeCloseTo(7, 2);
  });
});
