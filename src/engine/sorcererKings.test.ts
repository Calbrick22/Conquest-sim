import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame, validate, type Action } from './game';
import type { GameState, RegimentState } from './model/types';
import type { RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { entry, hero, list } from './testing/fixtures';
import type { ArmyList, ListEntry, RuleRef } from '../import/types';
import { parseRuleRef } from '../import/ruleTokens';
import { hasRule } from './rules/special/rules';
import { addMarkers, characterCourts, regimentCourts } from './factions/sorcererKings';
import { buildCards } from './round';
import { chargeDistanceRule, resolveImpact } from './actions';
import { poolMods } from './rules/special/effects';
import { resolveValue, stat } from './combat';
import { makePiece } from './terrain';
import { createRng } from './rng';
import type { Ctx } from './dice';
import { castSpell } from './spells';

/**
 * Sorcerer Kings faction rules (sk p.N). Entry names are the faction's (mechanics are keyed on
 * them, as allowed for public faction data); every number and text here is invented.
 */
const R = (raw: string): RuleRef => parseRuleRef(raw);
const unit = (name: string, roles: string[], o: Partial<ListEntry> & { rules?: string[] } = {}) =>
  entry({ name, stands: 3, battlefieldRoles: roles, ...o, specialRules: (o.rules ?? []).map(R) });
const wizard = (name: string, court: string, supremacy: string[] = ['Omnipotence'], options: Record<string, string[]> = {}) =>
  ({ ...hero(name), supremacyAbilities: supremacy, battlefieldRoles: ['Character', `Court of ${court}`], specialRules: [R('Wizard (6)')], options });

function game(p1: { character?: ListEntry; regiments: ListEntry[] }[], p2: ListEntry[] = [unit('Plain Guards', [])]): { s: GameState; rng: RngState } {
  const A: ArmyList = list('Sorcerer Kings', p1);
  const D = list('Foes', [{ regiments: p2 }]);
  const g = createGame({ seed: 9, scenario: getScenario('melee')!, lists: { P1: A, P2: D } });
  let s = apply(g.state, { type: 'startBattle' }, g.rng).state;
  s = structuredClone(s);
  let x1 = 8;
  let x2 = 8;
  for (const r of Object.values(s.regiments)) {
    r.location = 'table';
    r.arrivedRound = 0;
    r.files = Math.min(3, r.stands.length);
    if (r.owner === 'P1') {
      r.pose = { x: x1, y: 20, angle: Math.PI / 2 };
      x1 += 12;
    } else {
      r.pose = { x: x2, y: 28, angle: -Math.PI / 2 };
      x2 += 12;
    }
  }
  s.step = 'action';
  refreshRules(s);
  return { s, rng: g.rng };
}

function step(s: GameState, rng: RngState, a: Action) {
  const v = validate(s, a);
  if (!v.ok) throw new Error(`${a.type}: ${v.reasons.join(' ')}`);
  return apply(s, a, rng);
}

function activate(s: GameState, rng: RngState, id: string, afterRitual?: string) {
  const t = structuredClone(s);
  const r = t.regiments[id]!;
  t.turn = r.owner;
  t.drawn = { player: r.owner, card: { id: `card-${id}`, kind: 'regiment', name: r.name, refId: id }, ...(afterRitual ? { afterRitual } : {}) };
  return step(t, rng, { type: 'activate', regimentId: id }).state;
}

function activateCharacter(s: GameState, rng: RngState, cid: string) {
  const t = structuredClone(s);
  t.turn = 'P1';
  t.drawn = { player: 'P1', card: { id: `card-${cid}`, kind: 'character', name: t.characters[cid]!.name, refId: cid } };
  return step(t, rng, { type: 'activateCharacter', characterId: cid }).state;
}

const byName = (s: GameState, name: string): RegimentState => Object.values(s.regiments).find((r) => r.name === name)!;
const ctxOf = (s: GameState, dice: number[] = []): Ctx => {
  const c = structuredClone(s);
  c.forcedDice = [...dice];
  return { s: c, rng: createRng(1), events: [] };
};

const fireArmy = () =>
  game([
    {
      character: wizard('Ember Sorcerer', 'Fire'),
      regiments: [unit('Rajakur', ['Mortals']), unit('Efreet Sword Dancers', ['Elemental', 'Court of Fire'], { type: 'Brute', stands: 3, drawEvents: ['Elemental Conduit'], rules: ['Impact (3)'] })],
    },
  ]);

describe('Sorcerer Kings: Courts (sk p.4)', () => {
  it('a Character takes its Court from its Battlefield Role and knows all its Spells (sk p.10)', () => {
    const { s } = fireArmy();
    const c = Object.values(s.characters)[0]!;
    expect(characterCourts(s, c)).toEqual(['Fire']);
    expect(c.spells).toContain('Burn to Cinders');
    expect(c.spells).toHaveLength(6);
  });
  it('[Mortals] gain the Court of their Warband Character; Elementals keep their own (sk p.4)', () => {
    const { s } = fireArmy();
    expect(regimentCourts(s, byName(s, 'Rajakur'))).toEqual(['Fire']);
    expect(byName(s, 'Rajakur').grantRoles).toContain('Court of Fire');
    expect(regimentCourts(s, byName(s, 'Efreet Sword Dancers'))).toEqual(['Fire']);
  });
  it('Gifted Mortals take the Warlord’s Court (sk p.27)', () => {
    const { s } = game([{ character: wizard('Tide Raj', 'Water', ['Elemental Dominion']), regiments: [unit('Mahabharati Initiates', ['Mortals', 'Mahabharati'])] }]);
    expect(regimentCourts(s, byName(s, 'Mahabharati Initiates'))).toEqual(['Water']);
  });
});

describe('Sorcerer Kings: Rituals (sk p.5)', () => {
  it('Elemental Discharge: the first Ritual started in Round 3 starts with 3 Markers (sk p.5)', () => {
    const { s } = fireArmy();
    s.round = 3;
    const ctx = ctxOf(s);
    ctx.s.step = 'supremacy';
    ctx.s.supremacyWinner = 'P1';
    const v = validate(ctx.s, { type: 'prepareRitual', player: 'P1', ritual: 'Intrusive Thoughts' });
    expect(v.ok).toBe(true);
    const a = apply(ctx.s, { type: 'prepareRitual', player: 'P1', ritual: 'Intrusive Thoughts' }, ctx.rng);
    const b = apply(a.state, { type: 'chooseFirst', first: 'P1' }, a.rng);
    expect(b.state.players.P1.sk!.preparing).toEqual({ name: 'Intrusive Thoughts', markers: 3 });
  });

  it('a Fire Spell adds a Marker only to a Fire Ritual; at its Threshold the Ritual is completed (sk p.5)', () => {
    const { s } = fireArmy();
    const ctx = ctxOf(s);
    ctx.s.players.P1.sk!.preparing = { name: 'Intrusive Thoughts', markers: 6 };
    ctx.s.players.P1.sk!.dischargeRound = ctx.s.round;
    addMarkers(ctx, 'P1', 1, 'Water', 'test');
    expect(ctx.s.players.P1.sk!.preparing!.markers).toBe(6);
    addMarkers(ctx, 'P1', 1, 'Fire', 'test');
    expect(ctx.s.players.P1.sk!.preparing).toBeNull();
    expect(ctx.s.players.P1.sk!.completed).toEqual(['Intrusive Thoughts']);
    // The completed Ritual's Command Card joins the next Command Stack.
    expect(buildCards(ctx.s, 'P1').some((c) => c.kind === 'ritual' && c.refId === 'Intrusive Thoughts')).toBe(true);
  });

  it('Elemental Conduit adds a Marker even while arriving from Reinforcements (sk p.5)', () => {
    const { s, rng } = fireArmy();
    s.players.P1.sk!.preparing = { name: 'Conflagration', markers: 1 };
    const d = byName(s, 'Efreet Sword Dancers');
    d.location = 'arriving';
    const a = activate(s, rng, d.id);
    const b = step(a, rng, { type: 'drawEvent', name: 'Elemental Conduit' });
    expect(b.state.players.P1.sk!.preparing!.markers).toBe(2);
  });

  it('drawing a Ritual resolves it, then a card of the same Court may Activate at once (sk p.22)', () => {
    const { s, rng } = fireArmy();
    const t = structuredClone(s);
    const dancers = byName(t, 'Efreet Sword Dancers');
    t.turn = 'P1';
    t.players.P1.stack = [
      { id: 'ritual-Intrusive Thoughts', kind: 'ritual', name: 'Intrusive Thoughts', refId: 'Intrusive Thoughts' },
      { id: `card-${dancers.id}`, kind: 'regiment', name: dancers.name, refId: dancers.id },
    ];
    t.players.P2.stack = [{ id: 'x', kind: 'regiment', name: 'Plain Guards', refId: byName(t, 'Plain Guards').id }];
    let r = step(t, rng, { type: 'drawCard', player: 'P1' });
    expect(r.state.drawn?.card.kind).toBe('ritual');
    r = step(r.state, r.rng, { type: 'ritual', player: 'P1' });
    expect(hasRule(r.state.regiments[dancers.id]!.rules, 'Relentless Blows')).toBe(true);
    expect(r.state.turn).toBe('P1');
    r = step(r.state, r.rng, { type: 'drawCard', player: 'P1' });
    expect(r.state.drawn?.card.refId).toBe(dancers.id);
  });

  it('after a Ritual, a card of another Court goes back on top and play passes (sk p.22)', () => {
    const { s, rng } = fireArmy();
    const t = structuredClone(s);
    const guards = byName(t, 'Plain Guards');
    t.players.P1.stack = [{ id: 'ritual-Intrusive Thoughts', kind: 'ritual', name: 'Intrusive Thoughts', refId: 'Intrusive Thoughts' }, { id: 'c', kind: 'character', name: 'Ember Sorcerer', refId: Object.keys(t.characters)[0]! }];
    t.players.P2.stack = [{ id: 'g', kind: 'regiment', name: guards.name, refId: guards.id }];
    // The Character is attached to the Rajakur ([Mortals]: Court of Fire); make it an unaligned Regiment.
    t.regiments[t.characters[Object.keys(t.characters)[0]!]!.attachedTo!]!.roles = [];
    t.turn = 'P1';
    let r = step(t, rng, { type: 'drawCard', player: 'P1' });
    r = step(r.state, r.rng, { type: 'ritual', player: 'P1' });
    r = step(r.state, r.rng, { type: 'drawCard', player: 'P1' });
    expect(r.state.drawn).toBeNull();
    expect(r.state.players.P1.stack[0]!.kind).toBe('character');
    expect(r.state.turn).toBe('P2');
  });

  it('Earthquake: 2 Hits per Stand within the piece, no Healing, enemies cannot Rally (sk p.25)', () => {
    const { s, rng } = game([{ character: wizard('Stone Raj', 'Earth'), regiments: [unit('Rajakur', ['Mortals'])] }]);
    const foe = byName(s, 'Plain Guards');
    s.scenario.terrain = [makePiece('t1', 'field', foe.pose.x, foe.pose.y + 1)];
    s.turn = 'P1';
    s.players.P1.stack = [];
    s.drawn = { player: 'P1', card: { id: 'ritual-Earthquake', kind: 'ritual', name: 'Earthquake', refId: 'Earthquake' } };
    const r = step(s, rng, { type: 'ritual', player: 'P1', terrainId: 't1' });
    const f = r.state.regiments[foe.id]!;
    expect(f.flags.quake && f.flags.noRally).toBe(true);
    expect(r.state.scenario.terrain![0]!.keywords).toContain('Earth');
    expect(r.events.some((e) => /Earthquake: Plain Guards .* suffers \d+ Hits/.test(e.text))).toBe(true);
  });
});

describe('Sorcerer Kings: Spells (sk p.18–21)', () => {
  it('Burn to Cinders: one Hit per success and the target becomes Inflamed; +1 Marker on a Fire Ritual (sk p.18, p.5)', () => {
    const { s, rng } = fireArmy();
    s.players.P1.sk!.preparing = { name: 'Conflagration', markers: 0 };
    s.players.P1.sk!.dischargeRound = s.round;
    const cid = Object.keys(s.characters)[0]!;
    const a = activateCharacter(s, rng, cid);
    const foe = byName(a, 'Plain Guards');
    a.forcedDice = [1, 1, 1, 6, 6, 6];
    const r = step(a, rng, { type: 'spell', casterId: cid, spell: 'Burn to Cinders', targetId: foe.id });
    expect(r.state.regiments[foe.id]!.flags.inflamed).toBe(true);
    expect(r.state.players.P1.sk!.preparing!.markers).toBe(1);
  });

  it('Omnipotence: a Character attempts each Spell once per Round (sk p.6)', () => {
    const { s, rng } = fireArmy();
    const cid = Object.keys(s.characters)[0]!;
    const a = activateCharacter(s, rng, cid);
    a.forcedDice = [6, 6, 6, 6, 6, 6];
    const foe = byName(a, 'Plain Guards');
    const r = step(a, rng, { type: 'spell', casterId: cid, spell: 'Cauterize', targetId: foe.id });
    const again = activateCharacter({ ...r.state, activation: null }, rng, cid);
    expect(validate(again, { type: 'spell', casterId: cid, spell: 'Cauterize', targetId: foe.id }).ok).toBe(false);
  });

  it('Gifted Mortals: a friendly Character’s Spell on them is cast automatically (sk p.27)', () => {
    const { s } = game([{ character: wizard('Tide Raj', 'Water', ['Elemental Dominion']), regiments: [unit('Mahabharati Initiates', ['Mortals', 'Mahabharati'])] }]);
    const cid = Object.keys(s.characters)[0]!;
    const ini = byName(s, 'Mahabharati Initiates');
    const ctx = ctxOf(s, [6, 6, 6, 6, 6, 6]);
    ctx.s.activation = { regimentId: ini.id, characterId: cid, actions: [], entering: false, startPose: ini.pose, drawEventDone: true, aimed: false, inspired: false, ended: false };
    castSpell(ctx, cid, 'Swirling Embrace', ini.id);
    expect(hasRule(ctx.s.regiments[ini.id]!.roundRules, 'Untouchable')).toBe(true);
  });

  it('Cauterize: the target cannot be Healed this Round (sk p.18)', async () => {
    const { heal } = await import('./activation');
    const { s } = fireArmy();
    const ctx = ctxOf(s);
    const foe = ctx.s.regiments[byName(s, 'Plain Guards').id]!;
    foe.stands[0]!.wounds = 2;
    foe.flags.cauterized = true;
    heal(ctx, foe, 3, 'test');
    expect(foe.stands[0]!.wounds).toBe(2);
  });

  it('Induced Hypoxia: Resolve is the lowest unmodified value (sk p.19)', () => {
    const { s } = fireArmy();
    const ctx = ctxOf(s);
    const foe = ctx.s.regiments[byName(s, 'Plain Guards').id]!;
    foe.roundMods.push({ stat: 'R', delta: 2, source: 'test' });
    const before = resolveValue(ctx, foe);
    foe.flags.hypoxia = true;
    expect(resolveValue(ctx, foe)).toBe(before - 2);
  });
});

describe('Sorcerer Kings: unit rules (sk p.27–46)', () => {
  it('Fire Elemental: Juggernaut against an Inflamed enemy, still adding bonuses (sk p.33)', () => {
    const { s } = fireArmy();
    const d = byName(s, 'Efreet Sword Dancers');
    const foe = byName(s, 'Plain Guards');
    expect(chargeDistanceRule(s, d, foe).fixed).toBeNull();
    foe.flags.inflamed = true;
    expect(chargeDistanceRule(s, d, foe).fixed).toBe((d.profile.M ?? 0) + 5);
  });

  it('Relentless Blows on a profile adds a Hit per natural 1 in a Clash, at any Clash (core p.100)', () => {
    const { s } = fireArmy();
    const foe = byName(s, 'Plain Guards');
    expect(poolMods([R('Relentless Blows')], foe, 'clash', 'front', 3).extraOnOne).toBe(true);
    expect(poolMods([R('Rapid Volley')], foe, 'volley', 'front', 2).extraOnOne).toBe(true);
    expect(poolMods([R('Relentless Blows')], foe, 'volley', 'front', 2).extraOnOne).toBe(false);
    expect(poolMods([R('Relentless Blows'), R('Relentless Blows (2)')], foe, 'clash', 'front', 3).onesUpTo).toBe(2);
  });

  it('Water Elemental: no Water penalty, and it re-rolls failed Hit Rolls of 6 in Water (sk p.43)', () => {
    const { s } = game([{ character: wizard('Tide Raj', 'Water'), regiments: [unit('Marid Lancers', ['Elemental', 'Court of Water'], { type: 'Cavalry', stats: { M: 7, V: 1, C: 3, A: 4, W: 4, R: 3, D: 3, E: 1 } })] }]);
    const m = byName(s, 'Marid Lancers');
    s.scenario.terrain = [makePiece('p', 'pond', m.pose.x, m.pose.y - 1)];
    refreshRules(s);
    expect(stat(m, 'C')).toBe(3);
    expect(hasRule(m.rules, 'Elemental Waters')).toBe(true);
  });

  it('Stormqueen Form: +4 Attacks until the end of the Round (sk p.46)', () => {
    const { s, rng } = game([{ character: wizard('Tide Raj', 'Water'), regiments: [unit('Marid Shaytan', ['Elemental', 'Court of Water'], { type: 'Monster', stands: 1, commandModels: [] })] }]);
    const m = byName(s, 'Marid Shaytan');
    const a = activate(s, rng, m.id);
    const before = stat(a.regiments[m.id]!, 'A');
    const r = step(a, rng, { type: 'skForm', regimentId: m.id, group: 'Stormqueen Form', option: 'attacks' });
    expect(stat(r.state.regiments[m.id]!, 'A')).toBe(before + 4);
  });

  it('Reinforce (the Pattern): no Impact Hits on it, and it cannot Charge (sk p.21)', () => {
    const { s } = fireArmy();
    const ctx = ctxOf(s);
    const d = ctx.s.regiments[byName(s, 'Efreet Sword Dancers').id]!;
    const foe = ctx.s.regiments[byName(s, 'Plain Guards').id]!;
    foe.flags.reinforced = true;
    resolveImpact(ctx, d, foe, 'front');
    expect(ctx.events.some((e) => /Reinforced: no Hits from Impact/.test(e.text))).toBe(true);
    expect(foe.stands.every((x) => x.wounds === 0)).toBe(true);
  });

  it('Last Word: when a Rakshasa is destroyed, an enemy near a friendly Character suffers 8 Hits (sk p.34)', () => {
    const { s, rng } = game([{ character: wizard('Ember Sorcerer', 'Fire'), regiments: [unit('Rajakur', ['Mortals']), unit('Rakshasa Ravanar', ['Elemental', 'Court of Fire'], { type: 'Monster', stands: 1, commandModels: [] })] }]);
    const rk = byName(s, 'Rakshasa Ravanar');
    const foe = byName(s, 'Plain Guards');
    // Put the enemy right in front of the Character's Regiment.
    const raj = byName(s, 'Rajakur');
    foe.pose = { x: raj.pose.x, y: raj.pose.y + 6, angle: -Math.PI / 2 };
    const t = structuredClone(s);
    t.forcedDice = Array(20).fill(6);
    const r = step(t, rng, { type: 'override.wounds', regimentId: rk.id, delta: 99 });
    expect(r.events.some((e) => /Last Word: .* suffers 8 automatic Hits/.test(e.text))).toBe(true);
  });
});

describe('Sorcerer Kings: real export details (sk p.4, p.22, p.31)', () => {
  it('Ghols read their Court from the "Courts" option (Denizens of the Upper Planes, sk p.31)', () => {
    const { s } = game([{ character: wizard('Ember Sorcerer', 'Fire'), regiments: [unit('Ghols', ['Elemental'], { options: { Courts: ['Court of Water'] } })] }]);
    expect(regimentCourts(s, byName(s, 'Ghols'))).toEqual(['Water']);
  });
  it('the default Command Stack puts each Ritual just before a Regiment of its Court (sk p.22)', async () => {
    const { defaultStackOrder } = await import('./round');
    const { s } = fireArmy();
    s.step = 'command';
    s.players.P1.sk!.completed = ['Intrusive Thoughts'];
    const order = defaultStackOrder(s, 'P1');
    expect(order[0]!.kind).toBe('ritual');
    expect(regimentCourts(s, s.regiments[order[1]!.refId]!)).toContain('Fire');
  });
});
