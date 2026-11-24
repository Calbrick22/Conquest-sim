import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { allocateWounds, moraleTest, resolveAttack, resolveValue } from './combat';
import { rollTest, type Ctx } from './dice';
import { apply, createGame, regimentDistance, validate, type Action } from './game';
import { baseInches } from './geometry/bases';
import type { GameState } from './model/types';
import { createRng, type RngState } from './rng';
import { reinforcementNeed } from './round';
import { entry, list, rule } from './testing/fixtures';

const W = baseInches('Infantry').width;

/** Two invented Regiments facing each other across the table centre (away from Markers). */
function duelSetup(opts: { atkRules?: string[]; defRules?: string[]; atkStats?: Partial<Record<string, number>>; defStats?: Partial<Record<string, number>>; atkStands?: number; defStands?: number; atkCls?: 'Light' | 'Medium' | 'Heavy' } = {}) {
  const mk = (name: string, rules: string[] = [], stats: Partial<Record<string, number>> = {}, stands = 4, cls: 'Light' | 'Medium' | 'Heavy' = 'Medium') =>
    entry({
      name,
      stands,
      cls,
      stats: { M: 6, V: 3, C: 3, A: 4, W: 4, R: 3, D: 2, E: 0, ...stats } as never,
      specialRules: rules.map((r) => {
        const m = r.match(/^(.*?) \((\d+)\)(?: \[(\d+)\])?$/);
        return m ? { ...rule(m[1]!, Number(m[2])), ...(m[3] ? { range: Number(m[3]) } : {}) } : rule(r);
      }),
    });
  const A = list('Atk', [{ regiments: [mk('Attackers', opts.atkRules, opts.atkStats, opts.atkStands, opts.atkCls)] }]);
  const D = list('Def', [{ regiments: [mk('Defenders', opts.defRules, opts.defStats, opts.defStands)] }]);
  const g = createGame({ seed: 7, scenario: getScenario('melee')!, lists: { P1: A, P2: D } });
  let s = apply(g.state, { type: 'startBattle' }, g.rng).state;
  s = structuredClone(s);
  const a = s.regiments['P1-w0-r0']!;
  const d = s.regiments['P2-w0-r0']!;
  a.location = 'table';
  d.location = 'table';
  a.arrivedRound = 0;
  d.arrivedRound = 0;
  a.files = a.stands.length >= 4 ? 4 : a.stands.length;
  d.files = d.stands.length >= 4 ? 4 : d.stands.length;
  a.pose = { x: 36, y: 10, angle: Math.PI / 2 };
  d.pose = { x: 36, y: 30, angle: -Math.PI / 2 };
  s.step = 'action';
  return { s, rng: g.rng };
}

function activate(s: GameState, id: string): GameState {
  const t = structuredClone(s);
  const r = t.regiments[id]!;
  t.turn = r.owner;
  t.drawn = { player: r.owner, card: { id: `card-${id}`, kind: 'regiment', name: r.name, refId: id } };
  return t;
}

function step(s: GameState, rng: RngState, a: Action) {
  const v = validate(s, a);
  if (!v.ok) throw new Error(`${a.type}: ${v.reasons.join(' ')}`);
  return apply(s, a, rng);
}

function ctxOf(s: GameState, forced: number[] = []): Ctx {
  const c = structuredClone(s);
  c.forcedDice = [...forced];
  return { s: c, rng: createRng(1), events: [] };
}

describe('dice and tests (core p.10)', () => {
  it('a natural 6 always fails and a natural 1 always passes a characteristic test (core p.10)', () => {
    const { s } = duelSetup();
    const ctx = ctxOf(s, [6, 1]);
    const t = rollTest(ctx, 2, { target: 7 }, 't');
    expect(t.passed).toEqual([false, true]);
    const ctx0 = ctxOf(s, [1]);
    expect(rollTest(ctx0, 1, { target: 0 }, 't').passes).toBe(1);
  });
  it('defense rolls: 1 is not automatic; D and E of 0 cannot save (core p.40)', () => {
    const { s } = duelSetup();
    expect(rollTest(ctxOf(s, [1]), 1, { target: 0, defense: true }, 't').passes).toBe(0);
    expect(rollTest(ctxOf(s, [6]), 1, { target: 6, defense: true }, 't').passes).toBe(0);
  });
  it('a die is re-rolled only once (core p.10)', () => {
    const { s } = duelSetup();
    const t = rollTest(ctxOf(s, [5, 5]), 1, { target: 3, rerollFailed: true, rerollSixes: true }, 't');
    expect(t.values).toEqual([5]);
    expect(t.passes).toBe(0);
  });
});

describe('combat resolution (core p.40, p.46, p.53–61)', () => {
  it('cleave reduces defense; failed saves become wounds (core p.97)', () => {
    const { s } = duelSetup();
    // 4 attacks at C3: dice 1,2,3,4 → 3 hits. Target D2 −Cleave 1 = 1: saves 1,2,6 → only the 1 saves.
    const ctx = ctxOf(s, [1, 2, 3, 4, 1, 2, 6, 3, 3]);
    const r = resolveAttack(ctx, { attackerOwner: 'P1', targetId: 'P2-w0-r0', arc: 'front', pools: [{ label: 'x', dice: 4, skill: 3, reduceD: 1 }], morale: false, terrifying: 0, what: 't' });
    expect(r.hits).toBe(3);
    expect(r.wounds).toBe(2);
  });
  it('shield adds 1 defense against front-arc hits only (core p.100)', () => {
    const { s } = duelSetup({ defRules: ['Shield'] });
    const front = resolveAttack(ctxOf(s, [1, 3]), { attackerOwner: 'P1', targetId: 'P2-w0-r0', arc: 'front', pools: [{ label: 'x', dice: 1, skill: 3 }], morale: false, terrifying: 0, what: 't' });
    expect(front.wounds).toBe(0);
    const flank = resolveAttack(ctxOf(s, [1, 3]), { attackerOwner: 'P1', targetId: 'P2-w0-r0', arc: 'left', pools: [{ label: 'x', dice: 1, skill: 3 }], morale: false, terrifying: 0, what: 't' });
    expect(flank.wounds).toBe(1);
  });
  it('deadly shot: a failed defense roll of 6 causes 2 wounds (core p.97)', () => {
    const { s } = duelSetup();
    const r = resolveAttack(ctxOf(s, [1, 6]), { attackerOwner: 'P1', targetId: 'P2-w0-r0', arc: 'front', pools: [{ label: 'x', dice: 1, skill: 3, deadly6: true }], morale: false, terrifying: 0, what: 't' });
    expect(r.wounds).toBe(2);
  });
  it('relentless blows / rapid volley: natural 1s add a hit at 6+ (core p.40, p.46)', () => {
    const { s } = duelSetup();
    const r = resolveAttack(ctxOf(s, [1, 1, 6, 6, 6]), { attackerOwner: 'P1', targetId: 'P2-w0-r0', arc: 'front', pools: [{ label: 'x', dice: 2, skill: 6, extraOnOne: true }], morale: false, terrifying: 0, what: 't' });
    expect(r.hits).toBe(4);
  });
  it('wounds: wounded stands first, finish a stand, command stand last (core p.54)', () => {
    const { s } = duelSetup();
    const ctx = ctxOf(s);
    const d = ctx.s.regiments['P2-w0-r0']!;
    allocateWounds(ctx, d, 5, 'P1');
    expect(d.stands).toHaveLength(3);
    expect(d.stands.filter((x) => x.wounds > 0)).toHaveLength(1);
    expect(d.stands.find((x) => x.isCommand)!.wounds).toBe(0);
  });
  it('resolve includes the size bonus: +1 for 4–6 stands (core p.59)', () => {
    const { s } = duelSetup();
    const ctx = ctxOf(s);
    expect(resolveValue(ctx, ctx.s.regiments['P2-w0-r0']!)).toBe(4);
  });
  it('morale: one test per wound; failures add wounds (core p.60)', () => {
    const { s } = duelSetup({ defStats: { W: 1 } });
    const ctx = ctxOf(s, [2, 5, 6]);
    const d = ctx.s.regiments['P2-w0-r0']!;
    expect(moraleTest(ctx, d, 3, { arc: 'front', terrifying: 0, attackerOwner: 'P1' })).toBe(2);
  });
  it('morale: flank attacks re-roll successes (core p.46)', () => {
    const { s } = duelSetup({ defStats: { W: 4 } });
    const ctx = ctxOf(s, [1, 5]);
    expect(moraleTest(ctx, ctx.s.regiments['P2-w0-r0']!, 1, { arc: 'left', terrifying: 0, attackerOwner: 'P1' })).toBe(1);
  });
  it('morale: rear attacks fail automatically (core p.46)', () => {
    const { s } = duelSetup({ defStats: { W: 4 } });
    const ctx = ctxOf(s, []);
    expect(moraleTest(ctx, ctx.s.regiments['P2-w0-r0']!, 3, { arc: 'rear', terrifying: 0, attackerOwner: 'P1' })).toBe(3);
  });
  it('terrifying lowers resolve; fearless ignores it (core p.98, p.101)', () => {
    const scared = duelSetup();
    const ctx = ctxOf(scared.s, [4]);
    expect(moraleTest(ctx, ctx.s.regiments['P2-w0-r0']!, 1, { arc: 'front', terrifying: 1, attackerOwner: 'P1' })).toBe(1);
    const brave = duelSetup({ defRules: ['Fearless'] });
    const ctx2 = ctxOf(brave.s, [4]);
    expect(moraleTest(ctx2, ctx2.s.regiments['P2-w0-r0']!, 1, { arc: 'front', terrifying: 1, attackerOwner: 'P1' })).toBe(0);
  });
  it('broken after losing half the stands this round; shattered after losing half again (core p.60–61)', () => {
    const { s } = duelSetup({ defStats: { W: 1 }, defStands: 6 });
    const ctx = ctxOf(s);
    const d = ctx.s.regiments['P2-w0-r0']!;
    allocateWounds(ctx, d, 2, 'P1');
    expect(d.broken).toBe(false);
    allocateWounds(ctx, d, 1, 'P1');
    expect(d.broken).toBe(true);
    expect(d.standsWhenBroken).toBe(3);
    allocateWounds(ctx, d, 2, 'P1');
    expect(d.location).toBe('destroyed');
    expect(ctx.s.tally.regimentsDestroyed.P1).toBe(1);
  });
});

describe('Charge (core p.31–36)', () => {
  it('a successful charge contacts the target front, resolves Impact and Inspires (core p.31–36)', () => {
    const { s, rng } = duelSetup({ atkRules: ['Impact (1)'] });
    let t = structuredClone(s);
    t.regiments['P1-w0-r0']!.pose = { x: 36, y: 22, angle: Math.PI / 2 };
    t = step(activate(t, 'P1-w0-r0'), rng, { type: 'activate', regimentId: 'P1-w0-r0' }).state;
    expect(regimentDistance(t, t.regiments['P1-w0-r0']!, t.regiments['P2-w0-r0']!)).toBeCloseTo(8, 5);
    t.forcedDice = [3];
    const r = step(t, rng, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    const after = r.state;
    expect(regimentDistance(after, after.regiments['P1-w0-r0']!, after.regiments['P2-w0-r0']!)).toBeLessThan(0.02);
    expect(after.activation!.inspired).toBe(true);
    expect(r.events.some((e) => e.text.includes('Impact'))).toBe(true);
  });
  it('a failed charge moves the die roll forward and ends the activation (core p.36)', () => {
    const { s, rng } = duelSetup();
    let t = structuredClone(s);
    t.regiments['P1-w0-r0']!.pose = { x: 36, y: 18, angle: Math.PI / 2 };
    t = step(activate(t, 'P1-w0-r0'), rng, { type: 'activate', regimentId: 'P1-w0-r0' }).state;
    t.forcedDice = [2];
    const after = step(t, rng, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' }).state;
    expect(after.regiments['P1-w0-r0']!.pose.y).toBeCloseTo(20, 5);
    expect(after.activation!.ended).toBe(true);
    expect(validate(after, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 1 }] }).ok).toBe(false);
  });
  it('unstoppable re-rolls a failed charge roll (core p.101)', () => {
    const { s, rng } = duelSetup({ atkRules: ['Unstoppable'] });
    let t = structuredClone(s);
    t.regiments['P1-w0-r0']!.pose = { x: 36, y: 18, angle: Math.PI / 2 };
    t = step(activate(t, 'P1-w0-r0'), rng, { type: 'activate', regimentId: 'P1-w0-r0' }).state;
    t.forcedDice = [1, 6];
    const r = step(t, rng, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    expect(r.state.activation!.ended).toBe(false);
  });
  it('cannot charge beyond March + 6 or outside the front arc (core p.31)', () => {
    const { s, rng } = duelSetup();
    let t = structuredClone(s);
    t.regiments['P1-w0-r0']!.pose = { x: 36, y: 8, angle: Math.PI / 2 }; // gap 22 > 12
    t = step(activate(t, 'P1-w0-r0'), rng, { type: 'activate', regimentId: 'P1-w0-r0' }).state;
    expect(validate(t, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' }).ok).toBe(false);
    const u = structuredClone(t);
    u.regiments['P1-w0-r0']!.pose = { x: 36, y: 22, angle: -Math.PI / 2 }; // facing away
    expect(validate(u, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' }).ok).toBe(false);
  });
});

describe('Volley (core p.38–41)', () => {
  it('shots per front stand, effective range +1, leader +1, no morale tests (core p.39–41, p.69)', () => {
    const { s, rng } = duelSetup({ atkRules: ['Barrage (2) [24]'] });
    let t = structuredClone(s);
    t.regiments['P1-w0-r0']!.pose = { x: 36, y: 22, angle: Math.PI / 2 }; // 8″ < 12″: effective range
    t = step(activate(t, 'P1-w0-r0'), rng, { type: 'activate', regimentId: 'P1-w0-r0' }).state;
    const r = step(t, rng, { type: 'volley', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    // 4 front stands × (2 + 1 effective) + 1 Leader = 13 shots.
    expect(r.events.some((e) => /13 dice/.test(e.text))).toBe(true);
    expect(r.events.some((e) => e.text.includes('tests Morale'))).toBe(false);
  });
  it('out of range or outside the front arc cannot be targeted (core p.38)', () => {
    const { s, rng } = duelSetup({ atkRules: ['Barrage (2) [6]'] });
    const t = step(activate(s, 'P1-w0-r0'), rng, { type: 'activate', regimentId: 'P1-w0-r0' }).state;
    expect(validate(t, { type: 'volley', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' }).ok).toBe(false);
  });
});

describe('Clash (core p.44–46)', () => {
  it('engaged stands attack with A, others support with 1 (core p.44)', () => {
    const { s, rng } = duelSetup({ atkStands: 6 });
    let t = structuredClone(s);
    // Attackers 4 files × 2 ranks (4 + 2), front edge touching the defenders' front.
    t.regiments['P1-w0-r0']!.pose = { x: 36, y: 30, angle: Math.PI / 2 };
    t = step(activate(t, 'P1-w0-r0'), rng, { type: 'activate', regimentId: 'P1-w0-r0' }).state;
    const r = step(t, rng, { type: 'clash', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    // 4 engaged × A4 + Leader 1 + 2 support = 19.
    expect(r.events.some((e) => /\(16\+1|17 engaged|19 dice/.test(e.text))).toBe(true);
  });
});

describe('Reinforcements (core p.21)', () => {
  it('table of rolls by class and round (core p.21)', () => {
    expect(reinforcementNeed(1, 'Light')).toBe(4);
    expect(reinforcementNeed(1, 'Medium')).toBeNull();
    expect(reinforcementNeed(2, 'Medium')).toBe(2);
    expect(reinforcementNeed(3, 'Light')).toBe('auto');
    expect(reinforcementNeed(3, 'Heavy')).toBe(2);
    expect(reinforcementNeed(4, 'Medium')).toBe('auto');
    expect(reinforcementNeed(5, 'Heavy')).toBe('auto');
  });
});

describe('the Round sequence (core p.20–25)', () => {
  it('reinforcements → command stacks → supremacy → alternate activations → victory → next round', () => {
    const A = list('A', [{ regiments: [entry({ name: 'Scouts A', cls: 'Light' }), entry({ name: 'Scouts A2', cls: 'Light' })] }]);
    const B = list('B', [{ regiments: [entry({ name: 'Scouts B', cls: 'Light' })] }]);
    const g = createGame({ seed: 3, scenario: getScenario('melee')!, lists: { P1: A, P2: B } });
    let s = g.state;
    const rng = g.rng;
    const go = (a: Action) => (s = step(s, rng, a).state);
    go({ type: 'startBattle' });
    expect(s.step).toBe('reinforcement');
    go({ type: 'reinforcements', player: 'P1', choice: { regimentId: 'P1-w0-r0', arrive: true } });
    go({ type: 'reinforcements', player: 'P2', choice: { regimentId: 'P2-w0-r0', arrive: true } });
    expect(s.step).toBe('command');
    expect(s.regiments['P1-w0-r0']!.location).toBe('arriving');
    const order = (p: 'P1' | 'P2') => Object.values(s.regiments).filter((r) => r.owner === p && r.location === 'arriving').map((r) => `card-${r.id}`);
    go({ type: 'setStack', player: 'P1', order: order('P1') });
    go({ type: 'setStack', player: 'P2', order: order('P2') });
    expect(s.step).toBe('supremacy');
    go({ type: 'supremacyRollOff' });
    go({ type: 'chooseFirst', first: 'P1' });
    expect(s.step).toBe('action');
    expect(s.turn).toBe('P1');
    go({ type: 'drawCard', player: 'P1' });
    expect(validate(s, { type: 'activate', regimentId: 'P2-w0-r0' }).ok).toBe(false);
    go({ type: 'activate', regimentId: 'P1-w0-r0' });
    go({ type: 'enter', regimentId: 'P1-w0-r0', edge: 'bottom', along: 20, moves: [{ kind: 'forward', d: 4 }] });
    go({ type: 'endActivation' });
    expect(s.turn).toBe('P2');
    go({ type: 'drawCard', player: 'P2' });
    go({ type: 'activate', regimentId: 'P2-w0-r0' });
    go({ type: 'endActivation' }); // did not enter → back to Reinforcements, auto next Round
    expect(s.regiments['P2-w0-r0']!.flags.autoArrive).toBe(true);
    // P1 may still have a second card if its other Regiment arrived by roll.
    while (s.step === 'action') {
      const p = s.turn!;
      go({ type: 'drawCard', player: p });
      if (s.drawn) {
        go({ type: 'activate', regimentId: s.drawn.card.refId });
        go({ type: 'endActivation' });
      }
    }
    expect(s.step).toBe('victory');
    go({ type: 'endRound' });
    expect(s.round).toBe(2);
    expect(s.step).toBe('reinforcement');
    go({ type: 'reinforcements', player: 'P2', choice: null });
    expect(s.regiments['P2-w0-r0']!.location).toBe('arriving');
  });
  it('supremacy: fewer command cards subtracts 1 (core p.21)', () => {
    const { s, rng } = duelSetup();
    const t = structuredClone(s);
    t.step = 'supremacy';
    t.players.P1.stack = [{ id: 'a', kind: 'regiment', name: 'x', refId: 'P1-w0-r0' }];
    t.players.P2.stack = [];
    t.forcedDice = [3, 3];
    const r = step(t, rng, { type: 'supremacyRollOff' });
    expect(r.state.supremacyWinner).toBe('P2');
  });
});

describe('manual tools are logged as overrides', () => {
  it('wounds, characteristic changes, broken and forced dice', () => {
    const { s, rng } = duelSetup();
    let t = s;
    for (const a of [
      { type: 'override.wounds', regimentId: 'P2-w0-r0', delta: 4 },
      { type: 'override.stat', regimentId: 'P2-w0-r0', stat: 'D', delta: 1 },
      { type: 'override.broken', regimentId: 'P2-w0-r0', broken: true },
      { type: 'override.forceDice', values: [1, 2] },
    ] as Action[]) {
      const r = step(t, rng, a);
      expect(r.events.some((e) => e.override)).toBe(true);
      t = r.state;
    }
    expect(t.regiments['P2-w0-r0']!.stands).toHaveLength(3);
    expect(t.regiments['P2-w0-r0']!.broken).toBe(true);
    expect(t.forcedDice).toEqual([1, 2]);
    void W;
  });
});

describe('volley range preview (core p.38–39)', () => {
  it('draws each front stand’s range, effective range and a line to each enemy in range', async () => {
    const { volleyLines } = await import('./actions');
    const { s } = duelSetup({ atkRules: ['Barrage (2) [24]'] });
    const t = structuredClone(s);
    t.regiments['P1-w0-r0']!.pose = { x: 36, y: 22, angle: Math.PI / 2 }; // 8″ from the target
    const lines = volleyLines(t, t.regiments['P1-w0-r0']!);
    expect(lines.filter((l) => l.kind === 'range')).toHaveLength(4);
    expect(lines.filter((l) => l.kind === 'halfrange')).toHaveLength(4);
    const toTarget = lines.filter((l) => l.kind === 'clear');
    expect(toTarget).toHaveLength(4);
    expect(toTarget[0]!.label).toMatch(/8\.\d″/);
  });
});
