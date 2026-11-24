import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { resolveAttack, stat } from './combat';
import type { Ctx } from './dice';
import { apply, createGame, validate, type Action } from './game';
import type { GameState } from './model/types';
import { regimentDistance } from './queries';
import { createRng, type RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { entry, hero, list, rule } from './testing/fixtures';
import type { ListEntry } from '../import/types';

type Side = { rules?: string[]; stats?: Partial<Record<string, number>>; stands?: number; type?: string; cls?: 'Light' | 'Medium' | 'Heavy'; roles?: string[]; character?: ListEntry; drawEvents?: string[] };

const R = (raw: string) => {
  const m = raw.match(/^(.*?) \((\+?)(\d+)\)(?: \[(\d+)\])?$/);
  return m ? { ...rule(m[1]!, Number(m[3])), ...(m[2] ? { plus: true } : {}), ...(m[4] ? { range: Number(m[4]) } : {}), raw } : rule(raw);
};

const mk = (name: string, o: Side) =>
  entry({
    name,
    stands: o.stands ?? 4,
    type: o.type ?? 'Infantry',
    cls: o.cls ?? 'Medium',
    stats: { M: 6, V: 3, C: 3, A: 4, W: 4, R: 3, D: 2, E: 0, ...o.stats } as never,
    specialRules: (o.rules ?? []).map(R),
    battlefieldRoles: o.roles ?? [],
    drawEvents: o.drawEvents ?? [],
  });

/** Attacker (P1) faces up toward the defender (P2) facing down; `gap` between their front edges. */
function arena(atk: Side = {}, def: Side = {}, gap = 0, extraDef?: Side) {
  const A = list('Atk', [{ ...(atk.character ? { character: atk.character } : {}), regiments: [mk('Attackers', atk)] }]);
  const D = list('Def', [{ ...(def.character ? { character: def.character } : {}), regiments: [mk('Defenders', def), ...(extraDef ? [mk('Others', extraDef)] : [])] }]);
  const g = createGame({ seed: 9, scenario: getScenario('melee')!, lists: { P1: A, P2: D } });
  let s = apply(g.state, { type: 'startBattle' }, g.rng).state;
  s = structuredClone(s);
  const a = s.regiments['P1-w0-r0']!;
  const d = s.regiments['P2-w0-r0']!;
  for (const r of [a, d]) {
    r.location = 'table';
    r.arrivedRound = 0;
    r.files = Math.min(4, r.stands.length + (Object.values(s.characters).some((c) => c.attachedTo === r.id) ? 1 : 0));
  }
  a.pose = { x: 36, y: 30 - gap, angle: Math.PI / 2 };
  d.pose = { x: 36, y: 30, angle: -Math.PI / 2 };
  s.step = 'action';
  refreshRules(s);
  return { s, rng: g.rng };
}

function step(s: GameState, rng: RngState, a: Action) {
  const v = validate(s, a);
  if (!v.ok) throw new Error(`${a.type}: ${v.reasons.join(' ')}`);
  return apply(s, a, rng);
}

function activate(s: GameState, rng: RngState, id: string, card?: { lobotomy?: 'top' | 'bottom' }) {
  const t = structuredClone(s);
  const r = t.regiments[id]!;
  t.turn = r.owner;
  t.drawn = { player: r.owner, card: { id: `card-${id}`, kind: 'regiment', name: r.name, refId: id, ...(card ?? {}) } };
  return step(t, rng, { type: 'activate', regimentId: id }).state;
}

const ctxOf = (s: GameState, dice: number[] = []): Ctx => {
  const c = structuredClone(s);
  c.forcedDice = [...dice];
  return { s: c, rng: createRng(1), events: [] };
};

const hitDef = (s: GameState, dice: number[], pool: Record<string, unknown>, arc: 'front' | 'left' | 'rear' = 'front', kind: 'clash' | 'volley' | 'impact' = 'clash') => {
  const ctx = ctxOf(s, dice);
  const res = resolveAttack(ctx, { attackerOwner: 'P1', attackerId: 'P1-w0-r0', targetId: 'P2-w0-r0', arc, pools: [{ label: 'x', dice: 1, skill: 3, ...pool }], morale: false, terrifying: 0, what: 't', kind });
  return { res, ctx };
};

describe('defense-stage special rules (core p.96–101)', () => {
  it('Smite: no Defense, only Evasion (core p.100)', () => {
    const { s } = arena({}, { stats: { D: 5, E: 1 } });
    expect(hitDef(s, [1, 3], { smite: true }).res.wounds).toBe(1); // 3 > E1
    expect(hitDef(s, [1, 3], {}).res.wounds).toBe(0); // 3 ≤ D5
  });
  it('Flawless Strikes / Precise Shot: Hit Rolls of 1 are saved with Evasion only (core p.98, p.100)', () => {
    const { s } = arena({}, { stats: { D: 4, E: 0 } });
    expect(hitDef(s, [1, 2], { noDefenseOnOnes: true }).res.wounds).toBe(1);
    expect(hitDef(s, [2, 2], { noDefenseOnOnes: true }).res.wounds).toBe(0);
  });
  it('Hardened (X) reduces Cleave (core p.99)', () => {
    const { s } = arena({}, { stats: { D: 3 }, rules: ['Hardened (1)'] });
    // Cleave 2 − Hardened 1 → D2: a save roll of 3 fails, 2 passes.
    expect(hitDef(s, [1, 3], { reduceD: 2 }).res.wounds).toBe(1);
    expect(hitDef(s, [1, 2], { reduceD: 2 }).res.wounds).toBe(0);
  });
  it('Tenacious (X): X failed Defense rolls become successes (core p.101)', () => {
    const { s } = arena({}, { stats: { D: 1 }, rules: ['Tenacious (1)'] });
    const { res } = hitDef(s, [1, 1, 5, 5], { dice: 2, skill: 3 });
    expect(res.wounds).toBe(1);
  });
  it('Untouchable re-rolls failed Defense rolls of 6 (core p.101)', () => {
    const { s } = arena({}, { stats: { D: 3 }, rules: ['Untouchable'] });
    expect(hitDef(s, [1, 6, 2], {}).res.wounds).toBe(0);
  });
  it('Brittle: two successes become fails against a flank Clash (core p.97)', () => {
    const { s } = arena({}, { stats: { D: 4 }, rules: ['Brittle'] });
    expect(hitDef(s, [1, 1, 1, 1, 1, 1], { dice: 3, skill: 3 }, 'left').res.wounds).toBe(2);
    expect(hitDef(s, [1, 1, 1, 1, 1, 1], { dice: 3, skill: 3 }, 'front').res.wounds).toBe(0);
  });
  it('Shield and Phalanx add Defense against the front; Linebreaker ignores Shield and Bastion (core p.99–100)', () => {
    const { s } = arena({}, { stats: { D: 2 }, rules: ['Shield'] });
    expect(hitDef(s, [1, 3], {}).res.wounds).toBe(0);
    expect(hitDef(s, [1, 3], { ignoreShield: true }).res.wounds).toBe(1);
    const t = structuredClone(s);
    t.regiments['P2-w0-r0']!.roundMods.push({ stat: 'D', delta: 1, source: 'Bastion' });
    expect(hitDef(t, [1, 4], {}).res.wounds).toBe(0); // D2 + Bastion 1 + Shield 1 = 4
    expect(hitDef(t, [1, 3], { ignoreShield: true }).res.wounds).toBe(1);
  });
  it('Counter-Attack: Attack rolls of 6 hit the attacker back (core p.97)', () => {
    const { s } = arena({ stats: { D: 0 } }, { rules: ['Counter-Attack'] });
    const { ctx } = hitDef(s, [6, 6, 6], { dice: 1 });
    expect(ctx.s.regiments['P1-w0-r0']!.stands.reduce((a, x) => a + x.wounds, 0) + (4 - ctx.s.regiments['P1-w0-r0']!.stands.length) * 4).toBe(1);
  });
  it('Torrential Fire: every two Hits add one (core p.101)', () => {
    const { s } = arena({}, { stats: { D: 0 } });
    expect(hitDef(s, [1, 1, 1, 6, 6, 6, 6, 6], { dice: 3, skill: 3, torrential: true }, 'front', 'volley').res.hits).toBe(5);
  });
});

describe('hit re-rolls (core p.97–100)', () => {
  it('Parry stops the attacker re-rolling failed Hits (core p.100)', async () => {
    const { poolMods } = await import('./rules/special/effects');
    const { s } = arena({ rules: ['Flurry'] }, { rules: ['Parry'] });
    expect(poolMods(s.regiments['P1-w0-r0']!.rules, s.regiments['P2-w0-r0']!, 'clash', 'front', 3).rerollFailed).toBe(false);
    const u = arena({ rules: ['Flurry'] }, {}).s;
    expect(poolMods(u.regiments['P1-w0-r0']!.rules, u.regiments['P2-w0-r0']!, 'clash', 'front', 3).rerollFailed).toBe(true);
  });
  it('Opportunists re-roll against the flank or rear only (core p.99)', async () => {
    const { poolMods } = await import('./rules/special/effects');
    const { s } = arena({ rules: ['Opportunists'] }, {});
    expect(poolMods(s.regiments['P1-w0-r0']!.rules, s.regiments['P2-w0-r0']!, 'clash', 'left', 3).rerollFailed).toBe(true);
    expect(poolMods(s.regiments['P1-w0-r0']!.rules, s.regiments['P2-w0-r0']!, 'clash', 'front', 3).rerollFailed).toBe(false);
  });
});

describe('morale special rules (core p.97–99)', () => {
  const morale = async (rules: string[], dice: number[], wounds: number, arc: 'front' | 'rear' | 'left' = 'front') => {
    const { moraleTest } = await import('./combat');
    const { s } = arena({}, { rules, stats: { W: 1, R: 2 }, stands: 3 });
    const ctx = ctxOf(s, dice);
    return moraleTest(ctx, ctx.s.regiments['P2-w0-r0']!, wounds, { arc, terrifying: 0, attackerOwner: 'P1' });
  };
  it('Indomitable (X): X failed Morale Tests count as passed (core p.99)', async () => {
    expect(await morale(['Indomitable (1)'], [6, 6], 2)).toBe(1);
  });
  it('Oblivious: one Wound per two failed tests, rounding up (core p.99)', async () => {
    expect(await morale(['Oblivious'], [6, 6, 6], 3)).toBe(2);
  });
  it('Iron Discipline: rear attacks do not fail automatically (core p.99)', async () => {
    expect(await morale(['Iron Discipline'], [1, 1], 2, 'rear')).toBe(0);
    expect(await morale([], [], 2, 'rear')).toBe(2);
  });
  it('Dauntless Regiments are never Broken (core p.97)', async () => {
    const { allocateWounds } = await import('./combat');
    const { s } = arena({}, { rules: ['Dauntless'], stats: { W: 1 }, stands: 4 });
    const ctx = ctxOf(s);
    allocateWounds(ctx, ctx.s.regiments['P2-w0-r0']!, 3, 'P1');
    expect(ctx.s.regiments['P2-w0-r0']!.broken).toBe(false);
  });
});

describe('triggered Hits (core p.97, p.99, p.101)', () => {
  it('Lethal Demise (X): destroying a Stand in contact costs X Hits (core p.99)', () => {
    const { s } = arena({ stats: { D: 0 } }, { rules: ['Lethal Demise (2)'], stats: { W: 1, D: 0 } });
    const ctx = ctxOf(s, [1, 6, 6]);
    resolveAttack(ctx, { attackerOwner: 'P1', attackerId: 'P1-w0-r0', targetId: 'P2-w0-r0', arc: 'front', pools: [{ label: 'x', dice: 1, skill: 3 }], morale: false, terrifying: 0, what: 't', kind: 'clash' });
    expect(ctx.events.some((e) => /Lethal Demise: Attackers suffers 2 Hits/.test(e.text))).toBe(true);
  });
  it('Lethal Demise: not triggered by a Volley, even from a Regiment in contact (core p.99; AMB-60)', () => {
    const { s } = arena({ stats: { D: 0 } }, { rules: ['Lethal Demise (2)'], stats: { W: 1, D: 0 } });
    const ctx = ctxOf(s, [1, 6, 6]);
    resolveAttack(ctx, { attackerOwner: 'P1', attackerId: 'P1-w0-r0', targetId: 'P2-w0-r0', arc: 'front', pools: [{ label: 'x', dice: 1, skill: 3 }], morale: false, terrifying: 0, what: 't', kind: 'volley' });
    expect(ctx.events.some((e) => /Lethal Demise/.test(e.text))).toBe(false);
  });
  it('Trample (X): automatic Hits at the end of the Activation (core p.101)', () => {
    const { s, rng } = arena({ rules: ['Trample (1)'], stands: 2 }, { stats: { D: 0, W: 10 } });
    const t = activate(s, rng, 'P1-w0-r0');
    t.forcedDice = [6, 6];
    const r = step(t, rng, { type: 'endActivation' });
    expect(r.events.some((e) => /Trample: Defenders suffers 2 automatic Hits/.test(e.text))).toBe(true);
  });
  it('Aura of Death (X): Hits on an enemy in contact when it activates (core p.97)', () => {
    const { s, rng } = arena({ stats: { D: 0 } }, { rules: ['Aura of Death (1)'], stands: 2 });
    const t = structuredClone(s);
    t.forcedDice = [6, 6, 6, 6];
    const r = activate(t, rng, 'P1-w0-r0');
    expect(r.regiments['P1-w0-r0']!.stands.reduce((a, x) => a + x.wounds, 0)).toBe(2);
  });
});

describe('Charge special rules (core p.98–100)', () => {
  it('Juggernaut: the Charge Distance is always March + 5″ (core p.99)', () => {
    const { s, rng } = arena({ rules: ['Juggernaut'] }, {}, 10.5);
    const t = activate(s, rng, 'P1-w0-r0');
    const r = step(t, rng, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    expect(regimentDistance(r.state, r.state.regiments['P1-w0-r0']!, r.state.regiments['P2-w0-r0']!)).toBeLessThan(0.02);
  });
  it('Phalanx: March + 3″ with no roll, and no Inspire Action (core p.100)', () => {
    const { s, rng } = arena({ rules: ['Phalanx'] }, {}, 8.5);
    const t = activate(s, rng, 'P1-w0-r0');
    expect(validate(t, { type: 'inspire', regimentId: 'P1-w0-r0' }).ok).toBe(false);
    const r = step(t, rng, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    expect(r.events.some((e) => /fixed 9″/.test(e.text))).toBe(true);
    expect(regimentDistance(r.state, r.state.regiments['P1-w0-r0']!, r.state.regiments['P2-w0-r0']!)).toBeLessThan(0.02);
  });
  it('Fury and Shock: +1 Attacks / +1 Clash until the end of the Round after a successful Charge (core p.98, p.100)', () => {
    const { s, rng } = arena({ rules: ['Fury', 'Shock'] }, {}, 4);
    const t = activate(s, rng, 'P1-w0-r0');
    t.forcedDice = [6];
    const r = step(t, rng, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' }).state;
    expect(r.regiments['P1-w0-r0']!.roundMods.map((m) => m.source).sort()).toEqual(['Fury', 'Shock']);
  });
  it('Designate Target: +2″ Charge Distance against a Marked enemy (Spires rule text)', () => {
    const { s, rng } = arena({}, {}, 9);
    const t = activate(s, rng, 'P1-w0-r0');
    t.regiments['P2-w0-r0']!.flags.marked = true;
    t.forcedDice = [1, 1];
    const r = step(t, rng, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    expect(r.events.some((e) => /rolled 1 \+ 6 \+ 2 = 9″/.test(e.text))).toBe(true);
  });
  it('a blocking unengaged enemy is pushed 1″ away so the Charge can contact (core p.32)', () => {
    const { s, rng } = arena({ stands: 2 }, { stands: 4 }, 4, { stands: 1 });
    const t = structuredClone(s);
    const o = t.regiments['P2-w0-r1']!;
    o.location = 'table';
    o.files = 1;
    // Right next to where the Attackers' front-right corner lands on the Defenders' front.
    o.pose = { x: 36 + 2.6 + 0.3, y: 30 - 2.6 - 0.3, angle: -Math.PI / 2 };
    const u = activate(t, rng, 'P1-w0-r0');
    u.forcedDice = [6];
    const r = step(u, rng, { type: 'charge', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    expect(r.state.pendingCharge).toBeNull();
    expect(regimentDistance(r.state, r.state.regiments['P1-w0-r0']!, r.state.regiments['P2-w0-r0']!)).toBeLessThan(0.05);
  });
});

describe('Volley special rules (core p.97–101)', () => {
  it('Loose Formation halves each Stand’s shots, rounding up; it also prevents Impact (core p.99)', () => {
    const { s, rng } = arena({ rules: ['Barrage (3) [24]'] }, { rules: ['Loose Formation'] }, 14);
    const t = activate(s, rng, 'P1-w0-r0');
    const r = step(t, rng, { type: 'volley', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    // 4 Stands × ceil(3/2)=2, Leader stand ceil(4/2)=2 → 8.
    expect(r.events.some((e) => /8 dice/.test(e.text))).toBe(true);
  });
  it('Longshot: Effective Range is the full range (core p.99)', () => {
    const { s, rng } = arena({ rules: ['Barrage (2) [24]', 'Longshot'] }, {}, 20);
    const t = activate(s, rng, 'P1-w0-r0');
    const r = step(t, rng, { type: 'volley', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    expect(r.events.some((e) => /13 dice/.test(e.text))).toBe(true);
  });
});

describe('extra Actions from Draw Events (core p.94)', () => {
  it('Double Time: two Marches give a free third March', () => {
    const { s, rng } = arena({ drawEvents: ['Double Time'] }, {}, 30);
    let t = activate(s, rng, 'P1-w0-r0');
    t = structuredClone(t);
    t.regiments['P1-w0-r0']!.pose = { x: 10, y: 4, angle: Math.PI / 2 };
    t = step(t, rng, { type: 'drawEvent', name: 'Double Time' }).state;
    t = step(t, rng, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 1 }] }).state;
    t = step(t, rng, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 1 }] }).state;
    expect(validate(t, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 1 }] }).ok).toBe(true);
    t = step(t, rng, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 1 }] }).state;
    expect(validate(t, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 1 }] }).ok).toBe(false);
  });
  it('only one Draw Event per Activation (core p.23)', () => {
    const { s, rng } = arena({ drawEvents: ['Double Time', 'Bastion (1)'] }, {}, 30);
    let t = activate(s, rng, 'P1-w0-r0');
    t = step(t, rng, { type: 'drawEvent', name: 'Bastion (1)' }).state;
    expect(t.regiments['P1-w0-r0']!.roundMods.some((m) => m.source === 'Bastion')).toBe(true);
    expect(validate(t, { type: 'drawEvent', name: 'Double Time' }).ok).toBe(false);
  });
});

describe('healing (core p.56)', () => {
  it('Regeneration heals Wounds and restores a lost Stand with at least half its Wounds (core p.56, p.95)', () => {
    const { s, rng } = arena({ drawEvents: ['Regeneration (3)'], stands: 3, stats: { W: 4 } }, {}, 30);
    const t = structuredClone(s);
    t.regiments['P1-w0-r0']!.stands = t.regiments['P1-w0-r0']!.stands.slice(0, 2);
    t.regiments['P1-w0-r0']!.stands[1]!.wounds = 1;
    let u = activate(t, rng, 'P1-w0-r0');
    u = step(u, rng, { type: 'drawEvent', name: 'Regeneration (3)' }).state;
    const reg = u.regiments['P1-w0-r0']!;
    expect(reg.stands).toHaveLength(3);
    expect(reg.stands.reduce((a, x) => a + x.wounds, 0)).toBe(2); // restored Stand with 2 of 4 Wounds left
  });
});

describe('Spires mechanics (from the imported list rule text)', () => {
  it('Strain Expression applies the entered Strain and Decay; Superior Creations reduces Decay by 1', () => {
    const { s, rng } = arena({ drawEvents: ['Strain Expression'], rules: ['Superior Creations'], stands: 3 }, {}, 20);
    const t = structuredClone(s);
    t.players.P1.strains['Attackers'] = { stats: { C: 1 }, rules: [rule('Flurry')], text: '+1 Clash, Flurry' };
    let u = activate(t, rng, 'P1-w0-r0');
    u = step(u, rng, { type: 'drawEvent', name: 'Strain Expression' }).state;
    expect(u.regiments['P1-w0-r0']!.rules.some((x) => x.name === 'Flurry')).toBe(true);
    expect(u.regiments['P1-w0-r0']!.roundMods.some((m) => m.stat === 'C')).toBe(true);
    const end = step(u, rng, { type: 'endActivation' });
    expect(end.events.some((e) => /Decay: Attackers suffers 2 Wounds/.test(e.text))).toBe(true);
  });
  it('a Strain can lower enemies in contact ("enemy -1 Clash") while it is active (core p.97, owner-entered AMB-18)', () => {
    const { s, rng } = arena({ drawEvents: ['Strain Expression'], stands: 3 }, {}, 0);
    s.players.P1.strains = { Attackers: { stats: {}, enemyStats: { C: -1 }, rules: [], text: 'enemy -1 Clash' } };
    let u = activate(s, rng, 'P1-w0-r0');
    u = step(u, rng, { type: 'drawEvent', name: 'Strain Expression' }).state;
    expect(stat(u.regiments['P2-w0-r0']!, 'C')).toBe(2);
  });
  it('Lobotomytic Override (top): Strain Expression without Decay', () => {
    const { s, rng } = arena({ drawEvents: ['Strain Expression'], stands: 3 }, {}, 20);
    let u = activate(s, rng, 'P1-w0-r0', { lobotomy: 'top' });
    u = step(u, rng, { type: 'drawEvent', name: 'Strain Expression' }).state;
    const end = step(u, rng, { type: 'endActivation' });
    expect(end.events.some((e) => /Decay:/.test(e.text))).toBe(false);
  });
  it('Lobotomytic Override (bottom): +2 Attacks until the end of the Round', () => {
    const { s, rng } = arena({}, {}, 30);
    const u = activate(s, rng, 'P1-w0-r0', { lobotomy: 'bottom' });
    expect(u.regiments['P1-w0-r0']!.roundMods.find((m) => m.source === 'Lobotomytic Override')?.delta).toBe(2);
  });
  it('Imposing Excellence gives Parry to the Character and its [Husk] Regiment; Avatar Projection makes the Character a Brute', () => {
    const lineage = { ...hero('Lineage', 'Cavalry'), specialRules: [rule('Imposing Excellence')], options: { Eccentricities: ['Avatar Projection'] } };
    const A = list('A', [{ character: lineage, regiments: [mk('Husks', { type: 'Brute', roles: ['Husk'] })] }]);
    const g = createGame({ seed: 1, scenario: getScenario('melee')!, lists: { P1: A, P2: list('B', [{ regiments: [mk('X', {})] }]) } });
    const c = g.state.characters['P1-w0-c']!;
    expect(c.type).toBe('Brute');
    expect(c.attachedTo).toBe('P1-w0-r0');
    expect(c.rules.some((x) => x.name === 'Parry')).toBe(true);
    expect(g.state.regiments['P1-w0-r0']!.rules.some((x) => x.name === 'Parry')).toBe(true);
    expect(c.profile.C).toBe(5);
  });
  it('Remorseless Hunter gives [Husk] Regiments Designate Target; Just Desserts (Directorate) is already in the exported March', () => {
    const warlord = { ...hero('Hunter', 'Cavalry'), supremacyAbilities: ['Remorseless Hunter'] };
    const A = { ...list('A', [{ character: warlord, regiments: [mk('Husk Riders', { type: 'Cavalry', roles: ['Husk'] }), mk('Abom', { rules: ['Just Desserts'], type: 'Monster', stands: 1 })] }]), sect: 'The Directorate' };
    const g = createGame({ seed: 1, scenario: getScenario('melee')!, lists: { P1: A, P2: list('B', [{ regiments: [mk('X', {})] }]) } });
    expect(g.state.regiments['P1-w0-r0']!.rules.some((x) => x.name === 'Designate Target')).toBe(true);
    expect(g.state.regiments['P1-w0-r1']!.profile.M).toBe(6);
  });
  it('Snapshot: an enemy in Line of Sight and Barrage range suffers 1 Wound', () => {
    const pher = { ...hero('Hunter', 'Infantry'), specialRules: [R('Barrage (4) [14]')], actions: [rule('Snapshot')] };
    const { s, rng } = arena({ character: pher }, {}, 8);
    const t = structuredClone(s);
    t.turn = 'P1';
    t.drawn = { player: 'P1', card: { id: 'c', kind: 'character', name: 'Hunter', refId: 'P1-w0-c' } };
    let u = step(t, rng, { type: 'activateCharacter', characterId: 'P1-w0-c' }).state;
    u = step(u, rng, { type: 'characterAbility', characterId: 'P1-w0-c', name: 'Snapshot', targetId: 'P2-w0-r0' }).state;
    expect(u.regiments['P2-w0-r0']!.stands.reduce((a, x) => a + x.wounds, 0)).toBe(1);
  });
});

describe('core mechanics from roadmap 1.3', () => {
  it('Clash is split: Stands in contact with another enemy attack it (core p.45)', () => {
    const { s, rng } = arena({ stands: 4 }, { stands: 2 }, 0, { stands: 2 });
    const t = structuredClone(s);
    t.regiments['P2-w0-r0']!.files = 2;
    t.regiments['P2-w0-r0']!.pose = { x: 36 - 2.6, y: 30, angle: -Math.PI / 2 };
    const o = t.regiments['P2-w0-r1']!;
    o.location = 'table';
    o.files = 2;
    o.pose = { x: 36 + 2.6, y: 30, angle: -Math.PI / 2 };
    const u = activate(t, rng, 'P1-w0-r0');
    const r = step(u, rng, { type: 'clash', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    expect(r.events.filter((e) => /directs \d+ Attacks at/.test(e.text))).toHaveLength(2);
  });
  it('Die Fighting!: a Character whose untouched Regiment is destroyed makes a last Clash (core p.74)', async () => {
    const { allocateWounds } = await import('./combat');
    const { s } = arena({}, { character: hero('Chief'), stands: 1, stats: { W: 1 } });
    const ctx = ctxOf(s, Array(20).fill(1));
    allocateWounds(ctx, ctx.s.regiments['P2-w0-r0']!, 1, 'P1', 'P1-w0-r0');
    expect(ctx.events.some((e) => /Die Fighting! Chief makes a last Clash/.test(e.text))).toBe(true);
  });
});
