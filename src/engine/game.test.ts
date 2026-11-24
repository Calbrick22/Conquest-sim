import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, computeReinforcementLine, createGame, entryProblems, regimentDistance, regimentPolys, validate, type Action } from './game';
import { baseInches } from './geometry/bases';
import { TOL } from './geometry/vec';
import type { GameState } from './model/types';
import type { RngState } from './rng';
import { testListA, testListB } from './testing/fixtures';

const W = baseInches('Infantry').width;

function setup(scenario = 'forlorn-hope') {
  const g = createGame({ seed: 1, scenario: getScenario(scenario)!, lists: { P1: testListA(), P2: testListB() } });
  return { s: g.state, rng: g.rng };
}

function run(s: GameState, rng: RngState, ...actions: Action[]): GameState {
  for (const a of actions) {
    const v = validate(s, a);
    if (!v.ok) throw new Error(`${a.type}: ${v.reasons.join(' ')}`);
    s = apply(s, a, rng).state;
  }
  return s;
}

const SPEARS = 'P1-w0-r0';
const RIDERS = 'P1-w0-r1';
const BRUTES = 'P2-w0-r0';

describe('setup (core p.20, p.72)', () => {
  it('builds regiments and attaches characters to a same-type regiment in their warband', () => {
    const { s } = setup();
    expect(s.regiments[SPEARS]!.stands).toHaveLength(6);
    expect(s.characters['P1-w0-c']!.attachedTo).toBe(SPEARS);
    expect(s.characters['P2-w0-c']!.attachedTo).toBe(BRUTES);
  });
  it('character cannot join a regiment of another type (core p.72)', () => {
    const { s } = setup();
    expect(validate(s, { type: 'attachCharacter', characterId: 'P1-w0-c', regimentId: RIDERS }).ok).toBe(false);
  });
  it('monsters have no command stand (core p.69)', () => {
    const { s } = setup();
    expect(s.regiments['P1-w0-r2']!.stands.some((x) => x.isCommand)).toBe(false);
  });
});

describe('reinforcements entering the table (core p.30–31)', () => {
  it('a regiment may enter from its own reinforcement zone (core p.31)', () => {
    const { s, rng } = setup();
    const s2 = run(s, rng, { type: 'startBattle' }, { type: 'setArriving', regimentId: SPEARS, arriving: true }, { type: 'activate', regimentId: SPEARS });
    const s3 = run(s2, rng, { type: 'enter', regimentId: SPEARS, edge: 'bottom', along: 20, moves: [{ kind: 'forward', d: 6 }] });
    const r = s3.regiments[SPEARS]!;
    expect(r.location).toBe('table');
    expect(Math.abs(r.pose.y - 6)).toBeLessThan(TOL);
  });
  it("cannot enter from the opponent's edge (core p.31)", () => {
    const { s } = setup();
    expect(entryProblems(s, s.regiments[SPEARS]!, 'top', 30, 3).length).toBeGreaterThan(0);
  });
  it('side entry only behind the reinforcement line (core p.31)', () => {
    const { s } = setup('melee');
    // No friendly regiments on the table: the line is at the player's own edge.
    expect(computeReinforcementLine(s, 'P1')).toBe(0);
    expect(entryProblems(s, s.regiments[SPEARS]!, 'left', 5, 3).length).toBeGreaterThan(0);
  });
  it('Forlorn Hope: no entry on side edges between 12″ and 36″ (pack p.15)', () => {
    const { s } = setup();
    const st = structuredClone(s);
    st.reinforcementLine.P1 = 40;
    // Place a friendly regiment far forward so the line would allow side entry.
    st.regiments[RIDERS]!.location = 'table';
    st.regiments[RIDERS]!.pose = { x: 30, y: 42, angle: Math.PI / 2 };
    expect(entryProblems(st, st.regiments[SPEARS]!, 'left', 20, 2).some((p) => p.includes('No Reinforcements'))).toBe(true);
    expect(entryProblems(st, st.regiments[SPEARS]!, 'left', 6, 2).some((p) => p.includes('No Reinforcements'))).toBe(false);
  });
  it('an arriving regiment must March first (core p.23)', () => {
    const { s, rng } = setup();
    const s2 = run(s, rng, { type: 'startBattle' }, { type: 'setArriving', regimentId: SPEARS, arriving: true }, { type: 'activate', regimentId: SPEARS });
    expect(validate(s2, { type: 'reform', regimentId: SPEARS, files: 3, rotation: 0 }).ok).toBe(false);
  });
});

function onTable(s: GameState, id: string, x: number, y: number, angle: number) {
  const t = structuredClone(s);
  t.regiments[id]!.location = 'table';
  t.regiments[id]!.pose = { x, y, angle };
  return t;
}

describe('March restrictions (core p.28–30)', () => {
  const base = () => {
    const { s, rng } = setup();
    let t = run(s, rng, { type: 'startBattle' });
    t = onTable(t, SPEARS, 36, 6, Math.PI / 2);
    t = onTable(t, BRUTES, 36, 30, -Math.PI / 2);
    return { t, rng };
  };
  it('march up to the March characteristic (core p.28)', () => {
    const { t, rng } = base();
    const a = run(t, rng, { type: 'activate', regimentId: SPEARS });
    expect(validate(a, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 6 }] }).ok).toBe(true);
    expect(validate(a, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 6.2 }] }).ok).toBe(false);
  });
  it('cannot end within 1″ of an enemy (core p.29)', () => {
    const { t, rng } = base();
    // Brutes front edge at y=30 facing down; Spears front at y=6 → gap 24. Put Spears 1.5″ away first.
    // Away from the Objective Markers at x = 36.
    let a = onTable(t, SPEARS, 60, 28.5, Math.PI / 2);
    a = onTable(a, BRUTES, 60, 30, -Math.PI / 2);
    a = run(a, rng, { type: 'activate', regimentId: SPEARS });
    expect(regimentDistance(a, a.regiments[SPEARS]!, a.regiments[BRUTES]!)).toBeCloseTo(1.5, 5);
    expect(validate(a, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 0.4 }] }).ok).toBe(true);
    expect(validate(a, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 0.6 }] }).ok).toBe(false);
  });
  it('cannot march through an enemy (core p.30)', () => {
    const { t, rng } = base();
    // Riders (M8) facing up at y=24 under the Brutes' far side? Put the enemy in the path, then try to jump over it.
    let a = onTable(t, RIDERS, 36, 20, Math.PI / 2);
    a = onTable(a, BRUTES, 36, 22.5 + 2 * W, Math.PI / 2); // brutes facing away, footprint 22.5..22.5+2W? (depth 1 rank)
    a = run(a, rng, { type: 'activate', regimentId: RIDERS });
    const v = validate(a, { type: 'march', regimentId: RIDERS, moves: [{ kind: 'forward', d: 8 }] });
    expect(v.ok).toBe(false);
  });
  it('two actions per activation; only march repeats (core p.23)', () => {
    const { t, rng } = base();
    let a = run(t, rng, { type: 'activate', regimentId: SPEARS }, { type: 'reform', regimentId: SPEARS, files: 4, rotation: 0 });
    expect(validate(a, { type: 'reform', regimentId: SPEARS, files: 3, rotation: 0 }).ok).toBe(false);
    a = run(a, rng, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 2 }] });
    expect(validate(a, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 1 }] }).ok).toBe(false);
  });
  it('standard bearer adds 1″ to the second March (core p.69)', () => {
    const { t, rng } = base();
    const a = run(t, rng, { type: 'activate', regimentId: SPEARS }, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 1 }] });
    expect(validate(a, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 7 }] }).ok).toBe(true);
  });
});

describe('Reform (core p.37)', () => {
  it('command stand stays put while re-forming; rotation is about the centre', () => {
    const { s, rng } = setup();
    let t = run(s, rng, { type: 'startBattle' });
    t = onTable(t, SPEARS, 36, 10, Math.PI / 2);
    t = run(t, rng, { type: 'activate', regimentId: SPEARS });
    const cmdBefore = regimentPolys(t, t.regiments[SPEARS]!);
    const t2 = run(t, rng, { type: 'reform', regimentId: SPEARS, files: 5, rotation: 0 });
    expect(t2.regiments[SPEARS]!.files).toBe(5);
    expect(cmdBefore.length).toBe(7);
    const t3 = run(t, rng, { type: 'reform', regimentId: SPEARS, files: t.regiments[SPEARS]!.files, rotation: Math.PI });
    expect(Math.abs(t3.regiments[SPEARS]!.pose.angle - (Math.PI / 2 + Math.PI))).toBeLessThan(1e-9);
  });
  it('no stand may move more than its March during the re-form (core p.37)', () => {
    const { s, rng } = setup();
    let t = run(s, rng, { type: 'startBattle' });
    t = onTable(t, SPEARS, 36, 10, Math.PI / 2);
    t = run(t, rng, { type: 'activate', regimentId: SPEARS });
    // 7 stands (6 + character) from 4 files to 2 files: a corner stand would travel ≈ 3 stand widths.
    t.regiments[SPEARS]!.profile.M = 2;
    expect(validate(t, { type: 'reform', regimentId: SPEARS, files: 2, rotation: 0 }).ok).toBe(false);
  });
});

describe('end of activation legality (core p.13)', () => {
  it('cannot end an activation overlapping a friend; override is logged', () => {
    const { s, rng } = setup();
    let t = run(s, rng, { type: 'startBattle' });
    t = onTable(t, SPEARS, 36, 10, Math.PI / 2);
    t = onTable(t, RIDERS, 36, 10 + 4, Math.PI / 2);
    t = run(t, rng, { type: 'activate', regimentId: SPEARS });
    // March into the friendly Riders: allowed mid-activation, not as the final position.
    t = run(t, rng, { type: 'march', regimentId: SPEARS, moves: [{ kind: 'forward', d: 2 }] });
    expect(validate(t, { type: 'endActivation' }).ok).toBe(false);
    const r = apply(t, { type: 'override.move', regimentId: SPEARS, pose: { x: 20, y: 12, angle: Math.PI / 2 }, reason: 'test' }, rng);
    expect(r.events[0]!.override).toBe(true);
    expect(validate(r.state, { type: 'endActivation' }).ok).toBe(true);
  });
});
