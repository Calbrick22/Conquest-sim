import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame, validate, type Action } from './game';
import type { GameState, RegimentState } from './model/types';
import { createRng, type RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { entry, hero, list } from './testing/fixtures';
import type { ArmyList, ListEntry, RuleRef } from '../import/types';
import { parseRuleRef } from '../import/ruleTokens';
import { hasRule } from './rules/special/rules';
import { creeds, dw, isAwakened } from './factions/dweghom';
import { awaken } from './factions/dweghomActions';
import { checkBroken, resolveAttack, stat } from './combat';
import { chargeDice, chargeDistanceRule } from './actions';
import { marchValue } from './queries';
import type { Ctx } from './dice';

/**
 * Dweghom faction rules (dw p.N). Entry names are the faction's (the mechanics are keyed on them,
 * as allowed for public faction data); every number and text here is invented.
 */
const R = (raw: string): RuleRef => parseRuleRef(raw);
const unit = (name: string, roles: string[], o: Partial<ListEntry> & { rules?: string[] } = {}) => entry({ name, stands: 3, battlefieldRoles: roles, ...o, specialRules: (o.rules ?? []).map(R) });
const char = (name: string, roles: string[], supremacy: string[], o: Partial<ListEntry> & { rules?: string[] } = {}) => ({ ...hero(name), supremacyAbilities: supremacy, battlefieldRoles: ['Character', ...roles], ...o, specialRules: (o.rules ?? []).map(R) });

function game(p1: { character?: ListEntry; regiments: ListEntry[] }[], sect: string | null = null, p2: ListEntry[] = [unit('Plain Guards', [])]): { s: GameState; rng: RngState } {
  const A: ArmyList = { ...list('Dweghom', p1), sect };
  const D = list('Foes', [{ regiments: p2 }]);
  const g = createGame({ seed: 7, scenario: getScenario('melee')!, lists: { P1: A, P2: D } });
  const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
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
const byName = (s: GameState, n: string): RegimentState => Object.values(s.regiments).find((r) => r.name === n)!;
const ctxOf = (s: GameState, dice: number[] = []): Ctx => {
  const c = structuredClone(s);
  c.forcedDice = [...dice];
  return { s: c, rng: createRng(1), events: [] };
};
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

const tempered = () =>
  game(
    [
      {
        character: char('Tempered Sorcerer', ['Tempered', 'Forged'], ['Forgemaster'], { rules: ['Wizard (6)'], options: { Schools: ['Earth'] } }),
        regiments: [unit('Fireforged', ['Tempered', 'Forged'], { rules: ['Barrage (3) [14"]'] }), unit('Steelforged', ['Tempered', 'Forged'], { type: 'Brute' }), unit('Hold Warriors', ['Clan'], { options: { Officers: ['Herald of Fire'] } })],
      },
    ],
    'Tempered Creed',
  );

describe('Dweghom: Creeds and the Gift (dw p.4–8)', () => {
  it('the Creed comes from the list; Living Legend activates Ardent and Tempered (dw p.5–8)', () => {
    expect(creeds(tempered().s, 'P1')).toEqual(['Tempered']);
    const { s } = game([{ character: char('Lost Ancestor', ['Tempered', 'Ardent'], ['Living Legend'], { type: 'Brute' }), regiments: [unit('Lost', ['Ardent', 'Tempered'], { type: 'Brute' })] }]);
    expect(creeds(s, 'P1')).toEqual(['Ardent', 'Tempered']);
  });

  it('an Awakened Regiment cannot become Broken; Awakening a Broken one Rallies it (dw p.4)', () => {
    const { s } = tempered();
    const ctx = ctxOf(s);
    const hw = ctx.s.regiments[byName(s, 'Hold Warriors').id]!;
    hw.broken = true;
    awaken(ctx, hw, 'test');
    expect(hw.broken).toBe(false);
    expect(isAwakened(ctx.s, hw)).toBe(true);
    hw.standsAtRoundStart = 3;
    hw.stands = hw.stands.slice(0, 1);
    checkBroken(ctx, hw);
    expect(hw.broken).toBe(false);
  });

  it('The Unbound: a Broken Dweghom Regiment is never Shattered (dw p.5)', () => {
    const { s } = tempered();
    const ctx = ctxOf(s);
    const hw = ctx.s.regiments[byName(s, 'Hold Warriors').id]!;
    hw.broken = true;
    hw.standsWhenBroken = 3;
    hw.stands = hw.stands.slice(0, 1);
    checkBroken(ctx, hw);
    expect(hw.location).toBe('table');
  });

  it('Clan Creed: Awakened [Clan] Regiments gain Oblivious and Iron Discipline (dw p.8)', () => {
    const { s } = game([{ character: char('Hold Raegh', ['Clan'], ['First Born of War']), regiments: [unit('Hold Warriors', ['Clan'])] }], 'Clan Creed');
    const hw = byName(s, 'Hold Warriors');
    hw.flags.awakened = true;
    refreshRules(s);
    expect(hasRule(hw.rules, 'Oblivious') && hasRule(hw.rules, 'Iron Discipline') && hasRule(hw.rules, 'Impact')).toBe(true);
  });

  it('Ardent Creed: friendly Regiments gain Pathfinders (dw p.6)', () => {
    const { s } = game([{ character: char('Ardent Kerawegh', ['Ardent'], ['Herald of War'], { rules: ['Priest (6)'] }), regiments: [unit('Wardens', ['Ardent'])] }], 'Ardent Creed');
    expect(hasRule(byName(s, 'Wardens').rules, 'Pathfinders')).toBe(true);
  });
});

describe('Dweghom: Elemental Power and Forged (dw p.4, p.30–43)', () => {
  it('a [Forged] Regiment that does not use its Empowerment adds a Marker at the end of its Activation (dw p.4)', () => {
    const { s, rng } = tempered();
    const ff = byName(s, 'Fireforged');
    const a = activate(s, rng, ff.id);
    const r = step(a, rng, { type: 'endActivation' });
    expect(dw(r.state, 'P1')!.pool).toBe(1);
  });

  it('Forged By the Elements spends a Marker, grants the Empowerment and Awakens (dw p.4, p.30)', () => {
    const { s, rng } = tempered();
    dw(s, 'P1')!.pool = 2;
    const ff = byName(s, 'Fireforged');
    const a = activate(s, rng, ff.id);
    const r = step(a, rng, { type: 'drawEvent', name: 'Forged By the Elements', option: 'a' });
    const f = r.state.regiments[ff.id]!;
    expect(dw(r.state, 'P1')!.pool).toBe(1);
    expect(f.rules.some((x) => x.raw === 'Barrage (+2)')).toBe(true);
    expect(isAwakened(r.state, f)).toBe(true);
    // No Marker at the end: it used Forged By the Elements.
    expect(dw(step(r.state, r.rng, { type: 'endActivation' }).state, 'P1')!.pool).toBe(1);
  });

  it('Steelforged: 3 Markers give both Empowerments (dw p.42)', () => {
    const { s, rng } = tempered();
    dw(s, 'P1')!.pool = 3;
    const sf = byName(s, 'Steelforged');
    const a = activate(s, rng, sf.id);
    const before = stat(a.regiments[sf.id]!, 'A');
    const r = step(a, rng, { type: 'drawEvent', name: 'Forged By the Elements', option: 'both' });
    expect(stat(r.state.regiments[sf.id]!, 'A')).toBe(before + 2);
    expect(hasRule(r.state.regiments[sf.id]!.rules, 'Hardened')).toBe(true);
    expect(dw(r.state, 'P1')!.pool).toBe(0);
  });

  it('the pool never holds more than 10 Markers (dw p.4)', async () => {
    const { addPower } = await import('./factions/dweghom');
    const { s } = tempered();
    const ctx = ctxOf(s);
    dw(ctx.s, 'P1')!.pool = 9;
    addPower(ctx, 'P1', 3, 'test');
    expect(dw(ctx.s, 'P1')!.pool).toBe(10);
  });

  it('Tempered Creed: a School Spell adds a Marker; spending 2 Markers gives Wizard (+1) (dw p.7)', () => {
    const { s, rng } = tempered();
    const cid = Object.keys(s.characters)[0]!;
    const c = s.characters[cid]!;
    expect(c.spells).toEqual(['Broken Ground', 'Roots of Stone', 'Rock Shaping']);
    dw(s, 'P1')!.pool = 2;
    const t = structuredClone(s);
    t.turn = 'P1';
    t.drawn = { player: 'P1', card: { id: `card-${cid}`, kind: 'character', name: c.name, refId: cid } };
    const a = step(t, rng, { type: 'activateCharacter', characterId: cid }).state;
    const foe = byName(a, 'Plain Guards');
    a.forcedDice = [1, 1, 1, 1, 1, 1, 1];
    const r = step(a, rng, { type: 'spell', casterId: cid, spell: 'Broken Ground', targetId: foe.id, boost: 2 });
    const dice = r.events.find((e) => / casts Broken Ground/.test(e.text))!;
    expect(dice.text).toMatch(/7 dice/);
    expect(r.state.regiments[foe.id]!.flags.brokenGround).toBe(true);
    // 2 spent, then 1 from the Tempered Creed.
    expect(dw(r.state, 'P1')!.pool).toBe(1);
  });
});

describe('Dweghom: Spells and unit rules (dw p.26–45)', () => {
  it('Broken Ground: no Juggernaut and no Charge re-roll (dw p.27)', () => {
    const { s } = game([{ regiments: [unit('Hold Warriors', ['Clan'])] }], null, [unit('Plain Guards', [], { rules: ['Juggernaut', 'Unstoppable'] })]);
    const foe = byName(s, 'Plain Guards');
    const hw = byName(s, 'Hold Warriors');
    expect(chargeDistanceRule(s, foe, hw).fixed).not.toBeNull();
    foe.flags.brokenGround = true;
    expect(chargeDistanceRule(s, foe, hw).fixed).toBeNull();
    expect(chargeDice(s, foe, hw).reroll).toBe(false);
  });

  it('Fear: Charge Distance on the lowest of 2D6 (dw p.28)', () => {
    const { s } = tempered();
    const foe = byName(s, 'Plain Guards');
    foe.flags.fear = true;
    expect(chargeDice(s, foe, byName(s, 'Hold Warriors'))).toMatchObject({ twoDice: true, lowest: true });
  });

  it('Herald of Fire re-rolls failed Hit Rolls of 6; in a Tempered army the Regiment joins [Tempered] (dw p.45)', () => {
    const { s } = tempered();
    const hw = byName(s, 'Hold Warriors');
    expect(hasRule(hw.rules, 'Herald of Fire')).toBe(true);
    expect(hw.grantRoles).toContain('Tempered');
  });

  it('Shieldwall: Initiates +2 Defense against the front arc (dw p.37)', () => {
    const { s } = game([{ regiments: [unit('Initiates', ['Ardent'], { stats: { M: 5, V: 1, C: 2, A: 4, W: 4, R: 3, D: 2, E: 0 } })] }], 'Ardent Creed');
    const ctx = ctxOf(s, [4, 4, 4]);
    const ini = byName(ctx.s, 'Initiates');
    resolveAttack(ctx, { attackerOwner: 'P2', targetId: ini.id, arc: 'front', pools: [{ label: 'test', dice: 0, skill: 0, autoHits: 3 }], morale: false, terrifying: 0, what: 'test', kind: 'special' });
    // Defense 2 + 2 = 4: three rolls of 4 all save.
    expect(ctx.events.some((e) => /saves on 4 or less/.test(e.text))).toBe(true);
  });

  it('Stride: an Awakened Lost gives friendly Infantry within 8″ +1 March (dw p.39)', () => {
    const { s } = game([{ regiments: [unit('Lost', ['Ardent', 'Tempered'], { type: 'Brute' }), unit('Hold Warriors', ['Clan'])] }], 'Ardent Creed');
    const hw = byName(s, 'Hold Warriors');
    const before = marchValue(s, hw);
    byName(s, 'Lost').flags.awakened = true;
    refreshRules(s);
    expect(marchValue(s, hw)).toBe(before + 1);
  });

  it('Flame Berserkers are never Broken: they Awaken instead (dw p.31)', () => {
    const { s } = game([{ regiments: [unit('Flame Berserkers', ['Ardent'], { stats: { M: 6, V: 1, C: 3, A: 5, W: 4, R: null, D: 2, E: 1 } })] }], 'Ardent Creed');
    const ctx = ctxOf(s);
    const fb = ctx.s.regiments[byName(s, 'Flame Berserkers').id]!;
    fb.stands = fb.stands.slice(0, 1);
    checkBroken(ctx, fb);
    expect(fb.broken).toBe(false);
    expect(fb.flags.awakened).toBe(true);
  });

  it('rule names match without hyphens or plurals: "Counter Attack", "Quicksilver Strikes" (core p.97, p.100)', () => {
    expect(hasRule([R('Counter Attack')], 'Counter-Attack')).toBe(true);
    expect(hasRule([R('Quicksilver Strikes')], 'Quicksilver Strike')).toBe(true);
  });
});

describe('Dweghom: real export details (dw p.16–31)', () => {
  it('a listed Lost Ancestor keeps its own Spells and gains its School’s (dw p.21)', () => {
    const { s } = game([{ character: char('Lost Ancestor', ['Tempered', 'Ardent'], [], { type: 'Brute', rules: ['Wizard (6)'], spells: ['Litanies of Battle', 'Songs of the Descent'], options: { Spells: ['Fire School'] } }), regiments: [unit('Lost', ['Ardent', 'Tempered'], { type: 'Brute' })] }], 'The Ardent Creed');
    expect(Object.values(s.characters)[0]!.spells).toEqual(['Litanies of Battle', 'Songs of the Descent', 'Coruscation', 'Fireball', 'Flame Wall']);
  });
  it('a Character is never attached to Flame Berserkers at setup (Life for Glory, dw p.31)', () => {
    const { s } = game([{ character: char('Ardent Kerawegh', ['Ardent'], ['Herald of War'], { rules: ['Priest (6)'] }), regiments: [unit('Flame Berserkers', ['Ardent']), unit('Wardens', ['Ardent'])] }], 'The Ardent Creed');
    const c = Object.values(s.characters)[0]!;
    expect(s.regiments[c.attachedTo!]!.name).toBe('Wardens');
  });
});
