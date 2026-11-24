import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame, validate, type Action } from './game';
import type { GameState } from './model/types';
import { hasFlank, marchAllowance } from './queries';
import type { RngState } from './rng';
import { entry, hero, list, rule } from './testing/fixtures';

function step(s: GameState, rng: RngState, a: Action) {
  const v = validate(s, a);
  if (!v.ok) throw new Error(`${a.type}: ${v.reasons.join(' ')}`);
  return apply(s, a, rng).state;
}

describe('Vanguard (core p.101)', () => {
  it('adds X to the first March when entering from Reinforcements only', () => {
    const A = list('A', [{ regiments: [entry({ name: 'Scouts', cls: 'Light', specialRules: [rule('Vanguard', 4)] })] }]);
    const g = createGame({ seed: 1, scenario: getScenario('melee')!, lists: { P1: A, P2: list('B', [{ regiments: [entry({ name: 'X' })] }]) } });
    let s = step(g.state, g.rng, { type: 'startBattle' });
    s = structuredClone(s);
    s.regiments['P1-w0-r0']!.location = 'arriving';
    s.step = 'action';
    s.turn = 'P1';
    s.drawn = { player: 'P1', card: { id: 'c', kind: 'regiment', name: 'Scouts', refId: 'P1-w0-r0' } };
    s = step(s, g.rng, { type: 'activate', regimentId: 'P1-w0-r0' });
    expect(marchAllowance(s, s.regiments['P1-w0-r0']!)).toBe(10);
    s = step(s, g.rng, { type: 'enter', regimentId: 'P1-w0-r0', edge: 'bottom', along: 20, files: 3, moves: [{ kind: 'forward', d: 10 }] });
    expect(marchAllowance(s, s.regiments['P1-w0-r0']!)).toBe(6);
  });
});

describe('Flank (core p.98)', () => {
  const pher = { ...hero('Pheromancer', 'Brute'), options: { Eccentricities: ['Forlorn Drive'] } };
  const drones = entry({ name: 'Brute Drones', type: 'Brute', cls: 'Medium', battlefieldRoles: ['Drone'] });
  const husks = entry({ name: 'Husks', type: 'Brute', cls: 'Medium', battlefieldRoles: ['Husk'] });
  const make = () => {
    const A = list('A', [{ character: pher, regiments: [drones, husks] }]);
    const g = createGame({ seed: 1, scenario: getScenario('melee')!, lists: { P1: A, P2: list('B', [{ regiments: [entry({ name: 'X' })] }]) } });
    return { s: step(g.state, g.rng, { type: 'startBattle' }), rng: g.rng };
  };
  it('Forlorn Drive gives a [Drone] Regiment Flank, but not a [Husk] one', () => {
    const { s } = make();
    expect(hasFlank(s, s.regiments['P1-w0-r0']!)).toBe(true);
    expect(hasFlank(s, s.regiments['P1-w0-r1']!)).toBe(false);
    // Attached to the [Husk] Regiment instead (before the battle), Forlorn Drive does nothing.
    const A = list('A', [{ character: pher, regiments: [drones, husks] }]);
    const g = createGame({ seed: 1, scenario: getScenario('melee')!, lists: { P1: A, P2: list('B', [{ regiments: [entry({ name: 'X' })] }]) } });
    const t = step(g.state, g.rng, { type: 'attachCharacter', characterId: 'P1-w0-c', regimentId: 'P1-w0-r1' });
    expect(hasFlank(t, t.regiments['P1-w0-r1']!)).toBe(false);
    expect(hasFlank(t, t.regiments['P1-w0-r0']!)).toBe(false);
  });
  it('a Flank Regiment does not roll; the player declares it arrives (from Round 2 for Medium)', () => {
    let { s } = make();
    const rng = make().rng;
    s = structuredClone(s);
    s.round = 2;
    s = step(s, rng, { type: 'reinforcements', player: 'P1', choice: null, flank: { 'P1-w0-r0': true } });
    expect(s.regiments['P1-w0-r0']!.location).toBe('arriving');
  });
  it('can stay in Reinforcements before its Class must arrive, but not after (core p.98)', () => {
    const { s, rng } = make();
    const r2 = structuredClone(s);
    r2.round = 2;
    expect(validate(r2, { type: 'reinforcements', player: 'P1', choice: null, flank: { 'P1-w0-r0': false } }).ok).toBe(true);
    const r4 = structuredClone(s);
    r4.round = 4;
    expect(validate(r4, { type: 'reinforcements', player: 'P1', choice: null, flank: { 'P1-w0-r0': false } }).ok).toBe(false);
    void rng;
  });
  it('a Medium Flank Regiment cannot be declared in Round 1 (core p.98)', () => {
    const { s } = make();
    expect(validate(s, { type: 'reinforcements', player: 'P1', choice: null, flank: { 'P1-w0-r0': true } }).ok).toBe(false);
  });
});
