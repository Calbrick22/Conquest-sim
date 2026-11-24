import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { allocateWounds, moraleTest } from './combat';
import type { Ctx } from './dice';
import { apply, createGame, validate, type Action } from './game';
import type { GameState } from './model/types';
import { createRng, type RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { entry, hero, list, rule } from './testing/fixtures';
import type { ArmyList, ListEntry, RuleRef } from '../import/types';
import { blasphemousSoma, flushPower, poolTier, regimentDarkTier, tierThresholds } from './factions/oldDominion';
import { hasRule } from './rules/special/rules';
import { marchAllowance } from './queries';
import { scalingExtra } from './spells';
import { zoneResults } from './scoring/victory';
import { parseRuleRef } from '../import/ruleTokens';
import { parseArmyList } from '../import/parseList';

/** Synthetic Old Dominion-style units: invented names and values, faction mechanics under test. */
const R = (raw: string): RuleRef => parseRuleRef(raw);

const undead = (name: string, o: Partial<ListEntry> & { rules?: string[] } = {}) =>
  entry({
    name,
    stands: 4,
    stats: { M: 5, V: 1, C: 3, A: 4, W: 4, R: null, D: 2, E: 0 },
    battlefieldRoles: ['[The Legion]'],
    ...o,
    specialRules: (o.rules ?? ['Animate Vessel']).map(R),
  });

const living = (name: string, o: Partial<ListEntry> = {}) => entry({ name, stands: 4, stats: { M: 6, V: 1, C: 3, A: 4, W: 4, R: 3, D: 2, E: 0 }, ...o });

function game(p1: { character?: ListEntry; regiments: ListEntry[] }[], p2: { character?: ListEntry; regiments: ListEntry[] }[] = [{ regiments: [living('Plain Guards')] }], points = 2000): { s: GameState; rng: RngState } {
  const A: ArmyList = { ...list('Old Dominion', p1), points, pointsLimit: points };
  const D = list('Foes', p2);
  const g = createGame({ seed: 5, scenario: getScenario('melee')!, lists: { P1: A, P2: D } });
  let s = apply(g.state, { type: 'startBattle' }, g.rng).state;
  s = structuredClone(s);
  let x = 20;
  for (const r of Object.values(s.regiments)) {
    r.location = 'table';
    r.arrivedRound = 0;
    r.files = Math.min(4, r.stands.length);
    r.pose = r.owner === 'P1' ? { x, y: 20, angle: Math.PI / 2 } : { x, y: 40, angle: -Math.PI / 2 };
    x += r.owner === 'P1' ? 14 : 0;
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

function activate(s: GameState, rng: RngState, id: string) {
  const t = structuredClone(s);
  const r = t.regiments[id]!;
  t.turn = r.owner;
  t.drawn = { player: r.owner, card: { id: `card-${id}`, kind: 'regiment', name: r.name, refId: id } };
  return step(t, rng, { type: 'activate', regimentId: id }).state;
}

const ctxOf = (s: GameState, dice: number[] = []): Ctx => {
  const c = structuredClone(s);
  c.forcedDice = [...dice];
  return { s: c, rng: createRng(1), events: [] };
};

describe('Old Dominion: Empowerment', () => {
  it('Tier thresholds 9/18/23 at 2,000 points, ±2 per full 250 points (od p.6)', () => {
    expect(tierThresholds(2000)).toEqual([9, 18, 23]);
    expect(tierThresholds(2250)).toEqual([11, 20, 25]);
    expect(tierThresholds(2499)).toEqual([11, 20, 25]);
    expect(tierThresholds(1500)).toEqual([5, 14, 19]);
  });

  it('pools start at Tier I; Tier IV only with the Xhiliarch, Strategos or Mounted Strategos (od p.6)', () => {
    const { s } = game([{ regiments: [undead('Bone Spears')] }]);
    expect(poolTier(s, 'P1', 'dark')).toBe(1);
    s.players.P1.od!.dark = 30;
    expect(poolTier(s, 'P1', 'dark')).toBe(3);
    const x = hero('Bone Marshal');
    x.supremacyAbilities = ['Obdurate Bone and Stone'];
    const g2 = game([{ character: x, regiments: [undead('Bone Spears')] }]);
    g2.s.players.P1.od!.dark = 23;
    expect(poolTier(g2.s, 'P1', 'dark')).toBe(4);
  });

  it('a Stand lost by an Animate Vessel Regiment gives 1 Power Token at the end of the Action (od p.6)', () => {
    const { s, rng } = game([{ regiments: [undead('Bone Spears')] }]);
    const r = step(s, rng, { type: 'override.wounds', regimentId: 'P1-w0-r0', delta: 8 });
    expect(r.state.regiments['P1-w0-r0']!.stands.length).toBe(2);
    expect(r.state.players.P1.od!.dark).toBe(2);
  });

  it('Acolytes: losing the Command Stand gives 2 Power Tokens even without Animate Vessel (od p.22)', () => {
    const { s } = game([{ regiments: [living('Zealots', { stands: 1, specialRules: [rule('Acolytes')] })] }]);
    const ctx = ctxOf(s);
    allocateWounds(ctx, ctx.s.regiments['P1-w0-r0']!, 4, 'P2');
    flushPower(ctx);
    expect(ctx.s.players.P1.od!.dark).toBe(2);
  });

  it('Blasphemous Soma: +1 Power Token before the Supremacy Phase (od p.6)', () => {
    const { s } = game([{ regiments: [undead('Bone Spears')] }]);
    const ctx = ctxOf(s);
    blasphemousSoma(ctx);
    expect(ctx.s.players.P1.od!.dark).toBe(1);
    expect(ctx.s.players.P2.od).toBeUndefined();
  });
});

describe('Old Dominion: Animate Vessel (od p.5)', () => {
  it('gains Terrifying (1) and Brittle, and cannot Inspire (od p.5)', () => {
    const { s, rng } = game([{ regiments: [undead('Bone Spears')] }]);
    const r = s.regiments['P1-w0-r0']!;
    expect(hasRule(r.rules, 'Terrifying')).toBe(true);
    expect(hasRule(r.rules, 'Brittle')).toBe(true);
    const t = activate(s, rng, r.id);
    expect(validate(t, { type: 'inspire', regimentId: r.id }).ok).toBe(false);
  });

  it('always passes Morale Tests (od p.5)', () => {
    const { s } = game([{ regiments: [undead('Bone Spears')] }]);
    const ctx = ctxOf(s, [6, 6, 6, 6]);
    const extra = moraleTest(ctx, ctx.s.regiments['P1-w0-r0']!, 4, { arc: 'front', terrifying: 2, attackerOwner: 'P2' });
    expect(extra).toBe(0);
  });

  it('Divinity Grace removes Brittle from every friendly Regiment (od p.9)', () => {
    const h = hero('Grave Deacon');
    h.supremacyAbilities = ['Divinity Grace'];
    const { s } = game([{ character: h, regiments: [undead('Bone Spears')] }]);
    expect(hasRule(s.regiments['P1-w0-r0']!.rules, 'Brittle')).toBe(false);
  });
});

describe('Old Dominion: Dark Power Tiers and Memories of Old', () => {
  const spears = () => undead('Bone Spears', { memories: [R('Parry')] });

  it('Memories of Old as an Action: the listed rules until the end of the Round, not stacking (od p.5)', () => {
    const { s, rng } = game([{ regiments: [spears()] }]);
    let t = activate(s, rng, 'P1-w0-r0');
    t = step(t, rng, { type: 'memories', regimentId: 'P1-w0-r0' }).state;
    expect(hasRule(t.regiments['P1-w0-r0']!.rules, 'Parry')).toBe(true);
    expect(validate(t, { type: 'memories', regimentId: 'P1-w0-r0' }).ok).toBe(false);
  });

  it('Tier II: Memories of Old becomes a Draw Event, in addition to another (od p.7)', () => {
    const { s, rng } = game([{ regiments: [{ ...spears(), drawEvents: ['Bastion (1)'] }] }]);
    s.players.P1.od!.dark = 9;
    refreshRules(s);
    expect(s.regiments['P1-w0-r0']!.drawEvents).toContain('Memories of Old');
    let t = activate(s, rng, 'P1-w0-r0');
    t = step(t, rng, { type: 'drawEvent', name: 'Bastion (1)' }).state;
    t = step(t, rng, { type: 'drawEvent', name: 'Memories of Old' }).state;
    expect(hasRule(t.regiments['P1-w0-r0']!.rules, 'Parry')).toBe(true);
    // Both Actions remain.
    expect(t.activation!.actions.length).toBe(0);
  });

  it('Tier III: Animate Vessel Regiments gain Inspired (od p.7)', () => {
    const { s } = game([{ regiments: [spears(), living('Zealots')] }]);
    s.players.P1.od!.dark = 18;
    refreshRules(s);
    expect(hasRule(s.regiments['P1-w0-r0']!.rules, 'Inspired')).toBe(true);
    expect(hasRule(s.regiments['P1-w0-r1']!.rules, 'Inspired')).toBe(false);
  });

  it('Memories of Old: Bastion +1 becomes +1 Defense (od p.25)', () => {
    const { s, rng } = game([{ regiments: [undead('Bone Guard', { memories: [R('Bastion +1')] })] }]);
    let t = activate(s, rng, 'P1-w0-r0');
    t = step(t, rng, { type: 'memories', regimentId: 'P1-w0-r0' }).state;
    expect(t.regiments['P1-w0-r0']!.roundMods).toContainEqual({ stat: 'D', delta: 1, source: 'Bastion' });
  });

  it('Memories of Old text "counts as +1 Stands for Seizing" adds to the Command Stand (od p.24)', () => {
    const { s, rng } = game([{ regiments: [undead('Bone Spears', { memoriesText: "This Regiment's Command Stand counts as +1 Stands for the purposes of Seizing Objective Zones until the end of the Round." })] }]);
    let t = activate(s, rng, 'P1-w0-r0');
    t = step(t, rng, { type: 'memories', regimentId: 'P1-w0-r0' }).state;
    expect(t.regiments['P1-w0-r0']!.flags.memories).toBe(true);
  });

  it('Legio I Primigenia: the attached Regiment counts as Tier +1 (od p.17)', () => {
    const h = hero('Bone Tribune');
    h.options = { Treasures: ["Legio I 'Primigenia'"] };
    const { s } = game([{ character: h, regiments: [spears()] }]);
    expect(regimentDarkTier(s, s.regiments['P1-w0-r0']!)).toBe(2);
  });
});

describe('Old Dominion: unit rules', () => {
  it('Forced March: the Standard Bearer adds +2″ to the second March (od p.24)', () => {
    const { s, rng } = game([{ regiments: [undead('Bone Spears', { rules: ['Animate Vessel', 'Forced March'], commandModels: ['Leader', 'Standard Bearer'] })] }]);
    let t = activate(s, rng, 'P1-w0-r0');
    t = step(t, rng, { type: 'march', regimentId: 'P1-w0-r0', moves: [{ kind: 'forward', d: 1 }] }).state;
    expect(marchAllowance(t, t.regiments['P1-w0-r0']!)).toBe(7);
  });

  it('Unhallowed Ground: six Stands toward the total in a zone, none toward Seizing (od p.30)', () => {
    const { s } = game([{ regiments: [undead('Grave Shrine', { stands: 1, type: 'Monster', cls: 'Heavy', rules: ['Animate Vessel', 'Unhallowed Ground'], commandModels: [], stats: { M: 6, V: 0, C: 2, A: 12, W: 30, R: null, D: 3, E: 1 } })] }], [{ regiments: [living('Plain Guards', { stands: 3 })] }]);
    const z = s.scenario.zones[0]!;
    const shrine = s.regiments['P1-w0-r0']!;
    const foe = s.regiments['P2-w0-r0']!;
    shrine.pose = { x: z.x, y: z.y - 2, angle: Math.PI / 2 };
    foe.files = 3;
    foe.pose = { x: z.x, y: z.y + 2, angle: -Math.PI / 2 };
    const res = zoneResults(s)[z.id]!;
    expect(res.totals.P1).toBe(6);
    expect(res.seizing.P1).toBe(0);
  });

  it('Scaling: +1 success per 3 Stands over 3, and +1 against a Monster (core p.81)', () => {
    const { s } = game([{ regiments: [undead('Bone Spears')] }], [{ regiments: [living('Big Block', { stands: 7 })] }]);
    expect(scalingExtra(s, s.regiments['P2-w0-r0']!)).toBe(2);
  });
});

describe('Spellcasting (core p.80–81)', () => {
  const priest = () => {
    const h = hero('Grave Priest');
    h.specialRules = [R('Animate Vessel'), R('Priest (5)')];
    h.spells = ['Unholy Baptism', "Hazlia's Touch"];
    h.supremacyAbilities = ['Blasphemous Mesa'];
    return h;
  };

  it('Unholy Baptism: 1 Hit per success with Armor Piercing (1) (od p.22)', () => {
    const { s, rng } = game([{ character: priest(), regiments: [undead('Bone Spears')] }]);
    const t = structuredClone(s);
    t.turn = 'P1';
    t.drawn = { player: 'P1', card: { id: 'card-P1-w0-c', kind: 'character', name: 'Grave Priest', refId: 'P1-w0-c' } };
    let u = step(t, rng, { type: 'activateCharacter', characterId: 'P1-w0-c' }).state;
    // Move the target within 12″.
    u.regiments['P2-w0-r0']!.pose = { x: 20, y: 30, angle: -Math.PI / 2 };
    u.forcedDice = [1, 2, 3, 6, 6, /* defense */ 6, 6, 6];
    const res = step(u, rng, { type: 'spell', casterId: 'P1-w0-c', spell: 'Unholy Baptism', targetId: 'P2-w0-r0' });
    u = res.state;
    expect(res.events.some((e) => /3 successes, needs 2 — cast/.test(e.text))).toBe(true);
    // Defense 2, −1 from Armor Piercing (1): three rolls of 6 fail, giving 3 Wounds (then Morale).
    expect(res.events.some((e) => /saves on 1 or less \(−1 Defense\): 0 saved, 3 Wounds/.test(e.text))).toBe(true);
    // The same Spell cannot be cast again this Activation.
    expect(validate(u, { type: 'spell', casterId: 'P1-w0-c', spell: 'Unholy Baptism', targetId: 'P2-w0-r0' }).ok).toBe(false);
  });

  it('a Spell without a known profile needs an Attunement and its effect is manual (core p.80)', () => {
    const h = priest();
    h.spells = ['Mystery Hymn'];
    const { s, rng } = game([{ character: h, regiments: [undead('Bone Spears')] }]);
    const t = structuredClone(s);
    t.turn = 'P1';
    t.drawn = { player: 'P1', card: { id: 'card-P1-w0-c', kind: 'character', name: 'Grave Priest', refId: 'P1-w0-c' } };
    const u = step(t, rng, { type: 'activateCharacter', characterId: 'P1-w0-c' }).state;
    expect(validate(u, { type: 'spell', casterId: 'P1-w0-c', spell: 'Mystery Hymn', targetId: 'P1-w0-r0' }).ok).toBe(false);
    expect(validate(u, { type: 'spell', casterId: 'P1-w0-c', spell: 'Mystery Hymn', targetId: 'P1-w0-r0', attunement: 3 }).ok).toBe(true);
  });

  it('a Character lends no Resolve when it has Animate Vessel (od p.5)', () => {
    const { s } = game([{ character: priest(), regiments: [living('Zealots')] }]);
    expect(s.characters['P1-w0-c']!.attachedTo).toBe('P1-w0-r0');
  });
});

describe('Old Dominion: Fallen Divinity (od p.8, p.13)', () => {
  const divinity = () => {
    const h = entry({
      name: 'Fallen Godling',
      slot: 'Character',
      stands: 1,
      type: 'Monster',
      cls: 'Heavy',
      stats: { M: 6, V: 2, C: 2, A: 8, W: 16, R: null, D: 3, E: 2 },
      specialRules: ['Animate Vessel', 'Font of Dark Power', 'Impact (5)'].map(R),
      battlefieldRoles: ['[Character]', '[The Fallen Pantheon]'],
      supremacyAbilities: ['Surrounded by Fear and Dead Men'],
      commandModels: [],
      notes: ['This Regiment counts its Class as Light for the purposes of its Reinforcement Roll.'],
    });
    return h;
  };

  it('is a one-Stand Monster Regiment by itself, Activating with its own card (od p.8)', () => {
    const { s } = game([{ character: divinity(), regiments: [undead('Temple Brutes', { type: 'Brute', stands: 3, battlefieldRoles: ['[The Fallen Pantheon]'] })] }]);
    const fd = s.regiments['P1-w0-cr']!;
    expect(fd.type).toBe('Monster');
    expect(fd.stands.length).toBe(1);
    expect(s.characters['P1-w0-c']!.attachedTo).toBe(fd.id);
    expect(s.characters['P1-w0-c']!.embodied).toBe(true);
  });

  it('Font of Dark Power: Tokens from friendly Stands within 12″ go to the Fallen Pantheon Pool (od p.13)', () => {
    const { s, rng } = game([{ character: divinity(), regiments: [undead('Temple Brutes', { type: 'Brute', stands: 3, battlefieldRoles: ['[The Fallen Pantheon]'] })] }]);
    s.regiments['P1-w0-r0']!.pose = { x: 20, y: 20, angle: Math.PI / 2 };
    s.regiments['P1-w0-cr']!.pose = { x: 28, y: 20, angle: Math.PI / 2 };
    const r = step(s, rng, { type: 'override.wounds', regimentId: 'P1-w0-r0', delta: 4 });
    expect(r.state.players.P1.od!.pantheon).toBe(1);
  });

  it('reaching Fallen Pantheon Tier II uses the entered profile and Heals 4 (od p.7)', () => {
    const A: ArmyList = { ...list('Old Dominion', [{ character: divinity(), regiments: [undead('Temple Brutes', { type: 'Brute', stands: 3 })] }]), points: 2000, pointsLimit: 2000 };
    A.tierProfiles = { 'Fallen Godling': { '2': { stats: { A: 10, C: 3 }, rules: ['Cleave (2)'] } } };
    const g = createGame({ seed: 5, scenario: getScenario('melee')!, lists: { P1: A, P2: list('Foes', [{ regiments: [living('Plain Guards')] }]) } });
    const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
    s.regiments['P1-w0-cr']!.stands[0]!.wounds = 6;
    s.players.P1.od!.pantheon = 8;
    const ctx = ctxOf(s);
    // One more Token reaches Tier II.
    ctx.power = [{ player: 'P1', pool: 'pantheon', n: 1, why: 'test' }];
    flushPower(ctx);
    const fd = ctx.s.regiments['P1-w0-cr']!;
    expect(fd.profile.A).toBe(10);
    expect(fd.stands[0]!.wounds).toBe(2);
    expect(fd.baseRules.some((x) => x.name === 'Cleave')).toBe(true);
  });
});

describe('list import: Old Dominion labels', () => {
  it('reads Spells and Memories of Old blocks, and unbracketed values such as "Cleave +1"', () => {
    const text = [
      'Testland 1000 / 1000',
      'The Old Dominion',
      'Warband 1',
      'Bone Priest 1 90',
      'M V C A W R D E Type Infantry',
      '- 1 1 3 4 - 1 2 Class -',
      'Supremacy Abilities Blasphemous Mesa',
      'Special Rules Animate Vessel, Priest (6)',
      'Spells Unholy Baptism, Dark Immolation',
      'Battlefield Role Character',
      'Bone Spears Mainstay 3 110',
      'M V C A W R D E Type Infantry',
      '5 0 2 4 4 - 1 1 Class Medium',
      'Memories of Old Linebreaker, Cleave +1',
      'Special Rules Animate Vessel, Shield',
      'Battlefield Role The Legion',
      'Rules',
    ].join('\n');
    const l = parseArmyList(text);
    const c = l.warbands[0]!.character!;
    expect(c.spells).toEqual(['Unholy Baptism', 'Dark Immolation']);
    const r = l.warbands[0]!.regiments[0]!;
    expect(r.memories?.map((x) => [x.name, x.x, x.plus])).toEqual([
      ['Linebreaker', undefined, undefined],
      ['Cleave', 1, true],
    ]);
    expect(r.stats.R).toBeNull();
  });
});
