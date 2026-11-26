import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame, validate, type Action } from './game';
import type { CharacterState, GameState, RegimentState } from './model/types';
import { createRng, type RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { entry, hero, list } from './testing/fixtures';
import type { ArmyList, ListEntry } from '../import/types';
import { parseRuleRef } from '../import/ruleTokens';
import { hasRule } from './rules/special/rules';
import { poolMods } from './rules/special/effects';
import { allocateWounds, resolveAttack, stat } from './combat';
import { heal } from './activation';
import { planVolley } from './actions';
import type { Ctx } from './dice';

/**
 * Spires rules that used to be resolved by hand (sp p.N = the PDF page). Entry names are the
 * faction's (mechanics are keyed on them); every number and text here is invented.
 */
const R = parseRuleRef;
const unit = (name: string, o: Partial<ListEntry> & { rules?: string[] } = {}) => entry({ name, stands: 3, ...o, specialRules: (o.rules ?? []).map(R) });
const char = (name: string, o: Partial<ListEntry> & { rules?: string[] } = {}) => ({ ...hero(name), supremacyAbilities: [], ...o, specialRules: (o.rules ?? []).map(R) });
const spires = (warbands: Parameters<typeof list>[1]): ArmyList => ({ ...list('Spires', warbands), faction: 'Spires' });

function game(A: ArmyList, B: ArmyList = list('Foes', [{ regiments: [unit('Plain Guards')] }])): { s: GameState; rng: RngState } {
  const g = createGame({ seed: 7, scenario: getScenario('melee')!, lists: { P1: A, P2: B } });
  const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
  let x1 = 8;
  let x2 = 8;
  for (const r of Object.values(s.regiments)) {
    r.location = 'table';
    r.arrivedRound = 0;
    if (r.owner === 'P1') {
      r.pose = { x: x1, y: 20, angle: Math.PI / 2 };
      x1 += 12;
    } else {
      r.pose = { x: x2, y: 34, angle: -Math.PI / 2 };
      x2 += 12;
    }
  }
  s.step = 'action';
  refreshRules(s);
  return { s, rng: g.rng };
}
const byName = (s: GameState, n: string): RegimentState => Object.values(s.regiments).find((r) => r.name === n)!;
const charNamed = (s: GameState, n: string): CharacterState => Object.values(s.characters).find((c) => c.name === n)!;
const ctxOf = (s: GameState, dice: number[] = []): Ctx => {
  const c = structuredClone(s);
  c.forcedDice = [...dice];
  return { s: c, rng: createRng(1), events: [] };
};
const faceOff = (a: RegimentState, b: RegimentState) => {
  b.pose = { x: a.pose.x, y: a.pose.y, angle: a.pose.angle + Math.PI };
};
const texts = (events: { text: string }[]) => events.map((e) => e.text).join('\n');
const activate = (s: GameState, rng: RngState, id: string) => {
  const t = structuredClone(s);
  const r = t.regiments[id]!;
  t.turn = r.owner;
  t.drawn = { player: r.owner, card: { id: `card-${id}`, kind: 'regiment', name: r.name, refId: id } };
  return apply(t, { type: 'activate', regimentId: id }, rng).state;
};
const step = (s: GameState, rng: RngState, a: Action) => {
  const v = validate(s, a);
  if (!v.ok) throw new Error(`${a.type}: ${v.reasons.join(' ')}`);
  return apply(s, a, rng);
};

describe('Spires Supremacy Abilities (sp p.8–10)', () => {
  it('Lambs to the Slaughter: Fearless and Fury always; [Activated] Hit Rolls of 6 count as 1 for [Husk] (sp p.10)', () => {
    const { s } = game(spires([{ character: char('Lineage Highborne', { type: 'Brute', supremacyAbilities: ['Lambs to the Slaughter'] }), regiments: [unit('Avatara', { type: 'Brute', battlefieldRoles: ['Husk'] })] }]));
    const av = byName(s, 'Avatara');
    expect(hasRule(av.rules, 'Fearless') && hasRule(av.rules, 'Fury')).toBe(true);
    av.flags.lambs = true;
    refreshRules(s);
    expect(poolMods(av.rules, byName(s, 'Plain Guards'), 'clash', 'front', 3).sixesAsOnes).toBe(true);
    const ctx = ctxOf(s, [6, 6, 6, 5, 5, 5]);
    resolveAttack(ctx, { attackerOwner: 'P1', targetId: byName(s, 'Plain Guards').id, arc: 'front', pools: [{ label: 'Avatara', dice: 3, skill: 3, sixesAsOnes: true }], morale: false, terrifying: 0, what: 't', kind: 'clash' });
    expect(texts(ctx.events)).toMatch(/3 dice needing 3 or less → 3 Hits/);
  });

  it('Field Studies: a token per destroyed Regiment (at most 4); 3 Tokens on the last card remove Broken and Heal 5 (sp p.8)', () => {
    const { s } = game(spires([{ character: char('Biomancer', { supremacyAbilities: ['Field Studies'] }), regiments: [unit('Bound Clones', { battlefieldRoles: ['Clone'] })] }]));
    const ctx = ctxOf(s);
    const foe = ctx.s.regiments[byName(s, 'Plain Guards').id]!;
    allocateWounds(ctx, foe, 99, 'P1');
    expect(ctx.s.players.P1.observation).toBe(1);
    ctx.s.players.P1.observation = 3;
    const bc = byName(ctx.s, 'Bound Clones');
    bc.broken = true;
    bc.stands[0]!.wounds = 3;
    ctx.s.players.P1.stack = [];
    ctx.s.drawn = { player: 'P1', card: { id: 'card-bc', kind: 'regiment', name: bc.name, refId: bc.id } };
    const r = step(ctx.s, ctx.rng, { type: 'spires', player: 'P1', act: { option: 'lastCard' } });
    expect(byName(r.state, 'Bound Clones').broken).toBe(false);
    expect(r.state.players.P1.observation).toBe(0);
  });

  it('Ruthless Competence: Opportunists for a [Clone] Volley or Clash, once per Round (sp p.9)', () => {
    const { s, rng } = game(spires([{ character: char('High Clone Executor', { supremacyAbilities: ['Ruthless Competence'] }), regiments: [unit('Bound Clones', { battlefieldRoles: ['Clone'] })] }]));
    const bc = byName(s, 'Bound Clones');
    faceOff(bc, byName(s, 'Plain Guards'));
    const st = activate(s, rng, bc.id);
    const r = step(st, rng, { type: 'clash', regimentId: bc.id, targetId: byName(s, 'Plain Guards').id, ruthless: true });
    expect(texts(r.events)).toMatch(/Ruthless Competence: Bound Clones gains Opportunists/);
    expect(r.state.players.P1.ruthlessRound).toBe(r.state.round);
  });

  it('Ruthless Competence: an enemy Clashing a [Clone] Regiment loses Inspired (sp p.9)', () => {
    const { s, rng } = game(list('Foes', [{ regiments: [unit('Plain Guards')] }]), spires([{ character: char('High Clone Executor', { supremacyAbilities: ['Ruthless Competence'] }), regiments: [unit('Bound Clones', { battlefieldRoles: ['Clone'] })] }]));
    const pg = byName(s, 'Plain Guards');
    faceOff(pg, byName(s, 'Bound Clones'));
    const st = activate(s, rng, pg.id);
    const r = step(st, rng, { type: 'clash', regimentId: pg.id, targetId: byName(s, 'Bound Clones').id });
    expect(r.state.regiments[pg.id]!.flags.noInspired).toBe(true);
  });

  it('Tricks of the Trade: 5 Influence dice before the first Reinforcements; spent dice replace the next roll (sp p.10)', () => {
    const { s, rng } = game(spires([{ character: char('Merchant Prince', { supremacyAbilities: ['Tricks of the Trade'] }), regiments: [unit('Bound Clones')] }]));
    expect(s.players.P1.influence).toHaveLength(5);
    const st = activate(s, rng, byName(s, 'Bound Clones').id);
    const v = st.players.P1.influence![0]!;
    const r = step(st, rng, { type: 'spires', player: 'P1', act: { option: 'influence', indices: [0] } });
    expect(r.state.players.P1.influence).toHaveLength(4);
    expect(r.state.forcedDice?.[0]).toBe(v);
  });
});

describe('Spires Merchant Prince Offer (sp p.22)', () => {
  it('Master Manipulator: the Offer waits for an answer; accepted, both bring one more Regiment (sp p.22)', () => {
    const A = spires([{ character: char('Merchant Prince'), regiments: [unit('Bound Clones', { cls: 'Light' }), unit('Marksman Clones', { cls: 'Light' })] }]);
    const B = list('Foes', [{ regiments: [unit('Plain Guards', { cls: 'Light' }), unit('Other Guards', { cls: 'Light' })] }]);
    const g = createGame({ seed: 3, scenario: getScenario('melee')!, lists: { P1: A, P2: B } });
    let s = apply(g.state, { type: 'startBattle' }, g.rng).state;
    const rng = g.rng;
    s = step(s, rng, { type: 'spires', player: 'P1', act: { option: 'offer' } }).state;
    expect(validate(s, { type: 'reinforcements', player: 'P1', choice: null }).ok).toBe(false);
    s = step(s, rng, { type: 'spires', player: 'P2', act: { option: 'answerOffer', accept: true } }).state;
    const bc = byName(s, 'Bound Clones');
    const mc = byName(s, 'Marksman Clones');
    s = step(s, rng, { type: 'reinforcements', player: 'P1', choice: { regimentId: bc.id, arrive: true, extraId: mc.id } }).state;
    expect(s.regiments[mc.id]!.location).toBe('arriving');
    expect(hasRule(s.regiments[mc.id]!.roundRules, 'Vanguard')).toBe(true);
  });
});

describe('Spires units and Officers (sp p.31–50)', () => {
  it('Lineage Guard: Bound Clones with a High Clone Executor gain Iron Discipline (sp p.33)', () => {
    const { s } = game(spires([{ character: char('High Clone Executor'), regiments: [unit('Bound Clones')] }]));
    expect(hasRule(byName(s, 'Bound Clones').rules, 'Iron Discipline')).toBe(true);
  });

  it('Ward Preceptor: Tenacious (1), and a 2″ move when an enemy ends its March within 8″ (sp p.36)', () => {
    const { s, rng } = game(list('Foes', [{ regiments: [unit('Plain Guards')] }]), spires([{ regiments: [unit('Bound Clones', { commandModels: ['Leader'], options: { Officers: ['Ward Preceptor'] } })] }]));
    const bc = byName(s, 'Bound Clones');
    expect(hasRule(bc.rules, 'Tenacious')).toBe(true);
    const pg = byName(s, 'Plain Guards');
    pg.pose = { x: bc.pose.x, y: bc.pose.y - 12, angle: Math.PI / 2 };
    const st = activate(s, rng, pg.id);
    const r = step(st, rng, { type: 'march', regimentId: pg.id, moves: [{ kind: 'forward', d: 4 }] });
    expect(r.state.pendingMove).toEqual({ regimentId: bc.id, kind: 'ward', max: 2 });
  });

  it('Catabolic Node: Detonates as a Clash is declared, D6+4 Hits to engaged enemies (sp p.31)', () => {
    const { s, rng } = game(spires([{ regiments: [unit('Bound Clones', { commandModels: ['Leader'], options: { Officers: ['Catabolic Node'] } })] }]));
    const bc = byName(s, 'Bound Clones');
    faceOff(bc, byName(s, 'Plain Guards'));
    const st = activate(s, rng, bc.id);
    const r = step(st, rng, { type: 'clash', regimentId: bc.id, targetId: byName(s, 'Plain Guards').id, detonate: true });
    expect(texts(r.events)).toMatch(/Catabolic Node: Bound Clones's Node Detonates/);
    expect(r.state.regiments[bc.id]!.flags.detonated).toBe(true);
  });

  it('Gorged: healed to full, the Consumption Beast gains +6 Attacks (sp p.50)', () => {
    const { s } = game(spires([{ regiments: [unit('Consumption Beast', { stands: 1, type: 'Monster', cls: 'Medium', commandModels: [], stats: { M: 8, V: 1, C: 2, A: 10, W: 20, R: 4, D: 2, E: 2 } })] }]));
    const ctx = ctxOf(s);
    const cb = ctx.s.regiments[byName(s, 'Consumption Beast').id]!;
    cb.stands[0]!.wounds = 3;
    heal(ctx, cb, 3, 'test');
    refreshRules(ctx.s);
    expect(cb.flags.gorged).toBe(true);
    expect(stat(cb, 'A')).toBe(16);
  });

  it('Spined Descent: a Volley at a Regiment it moved over, regardless of Range (sp p.48)', () => {
    const { s } = game(spires([{ regiments: [unit('Pteraphon Surveyor', { rules: ['Fly', 'Barrage (2) [6"]'] })] }]));
    const pt = byName(s, 'Pteraphon Surveyor');
    const foe = byName(s, 'Plain Guards');
    foe.pose = { x: pt.pose.x, y: pt.pose.y - 20, angle: Math.PI / 2 };
    s.activation = { regimentId: pt.id, actions: [], entering: false, startPose: pt.pose, drawEventDone: false, aimed: false, inspired: false, ended: false };
    expect(planVolley(s, pt, foe, false).problems.length).toBeGreaterThan(0);
    s.activation.movedOver = [foe.id];
    expect(planVolley(s, pt, foe, false).problems).toEqual([]);
  });
});

describe('Spires Character upgrades (sp p.28–31)', () => {
  it('Induced Fawn Response: the first time its Infantry Regiment would be Broken, it is not (sp p.30)', () => {
    const { s } = game(spires([{ character: char('High Clone Executor', { options: { Eccentricities: ['Induced Fawn Response'] } }), regiments: [unit('Bound Clones', { stands: 4 })] }]));
    const ctx = ctxOf(s);
    const bc = ctx.s.regiments[byName(s, 'Bound Clones').id]!;
    allocateWounds(ctx, bc, 8, 'P2');
    expect(bc.broken).toBe(false);
    expect(texts(ctx.events)).toMatch(/Induced Fawn Response/);
  });

  it('No Matter the Price: failed Hit Rolls become Hits, each costing the Regiment 1 Wound (sp p.30)', () => {
    const { s, rng } = game(spires([{ character: char('High Clone Executor', { options: { Eccentricities: ['No Matter the Price'] } }), regiments: [unit('Bound Clones', { battlefieldRoles: ['Clone'] })] }]));
    const bc = byName(s, 'Bound Clones');
    faceOff(bc, byName(s, 'Plain Guards'));
    const st = activate(s, rng, bc.id);
    const r = step(st, rng, { type: 'clash', regimentId: bc.id, targetId: byName(s, 'Plain Guards').id, price: true });
    expect(texts(r.events)).toMatch(/No Matter the Price: Bound Clones suffers \d+ Wounds? for its converted Hits/);
    expect(validate({ ...r.state, activation: st.activation }, { type: 'clash', regimentId: bc.id, targetId: byName(s, 'Plain Guards').id, price: true }).ok).toBe(false);
  });

  it('Marksman Optimization Strain gives Barrage and Arcing Fire; Grotesque Elixir is a Character Action (sp p.28, p.31)', () => {
    const { s } = game(spires([{ character: char('High Clone Executor', { options: { Apparatuses: ['Marksman Optimization Strain', 'Grotesque Elixir'] } }), regiments: [unit('Bound Clones')] }]));
    const c = charNamed(s, 'High Clone Executor');
    expect(hasRule(c.rules, 'Barrage') && hasRule(c.rules, 'Arcing Fire')).toBe(true);
    expect(c.actions.some((a) => a.name === 'Grotesque Elixir')).toBe(true);
  });

  it('Assassination Directive: the Mimetic Assassin replaces a Stand as a Clash is declared (sp p.24)', () => {
    const { s, rng } = game(spires([{ character: char('Mimetic Assassin'), regiments: [unit('Bound Clones', { stands: 4 })] }]));
    const ma = charNamed(s, 'Mimetic Assassin');
    expect(ma.attachedTo).toBeNull();
    const bc = byName(s, 'Bound Clones');
    faceOff(bc, byName(s, 'Plain Guards'));
    const st = activate(s, rng, bc.id);
    const r = step(st, rng, { type: 'clash', regimentId: bc.id, targetId: byName(s, 'Plain Guards').id, assassin: { characterId: ma.id } });
    expect(r.state.characters[ma.id]!.attachedTo).toBe(bc.id);
    expect(texts(r.events)).toMatch(/Assassination Directive: Mimetic Assassin replaces a Stand/);
  });
});

describe('Scenario designations (ns p.2, p.6)', () => {
  const lists = () => ({ A: list('Alpha', [{ regiments: [unit('Alpha Heavies', { cls: 'Heavy' }), unit('Alpha Lights', { cls: 'Light' })] }]), B: list('Bravo', [{ regiments: [unit('Bravo Heavies', { cls: 'Heavy' }), unit('Bravo Mediums', { cls: 'Medium' })] }]) });
  it('Seek and Destroy: Chosen Regiments are designated at the start; a destroyed enemy Chosen scores +3, missing ones +3 each (ns p.2)', () => {
    const { A, B } = lists();
    const g = createGame({ seed: 5, scenario: getScenario('seek-and-destroy')!, lists: { P1: A, P2: B } });
    const s = apply(g.state, { type: 'startBattle' }, g.rng).state;
    expect(s.designated!.P1.map((id) => s.regiments[id]!.name).sort()).toEqual(['Bravo Heavies', 'Bravo Mediums']);
    expect(s.designated!.P2.map((id) => s.regiments[id]!.name)).toEqual(['Alpha Heavies']);
    const ctx = ctxOf(s);
    const bh = byName(ctx.s, 'Bravo Heavies');
    bh.location = 'table';
    allocateWounds(ctx, bh, 99, 'P1');
    ctx.s.step = 'victory';
    const r = apply(ctx.s, { type: 'endRound' }, ctx.rng);
    const text = texts(r.events);
    expect(text).toMatch(/P1 scores .*1 enemy Chosen Regiment\(s\) destroyed \(3\); 1 Chosen Regiment\(s\) the enemy army lacks \(3\)/);
    expect(text).toMatch(/P2 scores .*2 Chosen Regiment\(s\) the enemy army lacks \(6\)/);
  });

  it('Break the Line: Linebreakers lose Fly and score +5 unengaged in enemy territory (ns p.6)', () => {
    const { A, B } = lists();
    A.warbands[0]!.regiments[0]!.specialRules = [R('Fly')];
    const g = createGame({ seed: 5, scenario: getScenario('break-the-line')!, lists: { P1: A, P2: B } });
    const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
    const ah = byName(s, 'Alpha Heavies');
    expect(s.designated!.P1).toContain(ah.id);
    refreshRules(s);
    expect(hasRule(ah.rules, 'Fly')).toBe(false);
    ah.location = 'table';
    ah.pose = { x: 36, y: s.scenario.table.height - 0.5, angle: Math.PI / 2 };
    s.step = 'victory';
    const r = apply(s, { type: 'endRound' }, g.rng);
    expect(texts(r.events)).toMatch(/P1 scores .*1 Linebreaker\(s\) unengaged in enemy territory \(5\)/);
  });
});
