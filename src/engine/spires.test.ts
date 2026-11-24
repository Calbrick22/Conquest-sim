import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { stat } from './combat';
import { apply, createGame, validate, type Action } from './game';
import type { GameState } from './model/types';
import type { RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { hasRule } from './rules/special/rules';
import { entry, hero, list } from './testing/fixtures';
import type { ListEntry } from '../import/types';
import { parseRuleRef } from '../import/ruleTokens';
import { decayWounds, strainFor } from './factions/spires';

const R = parseRuleRef;
const unit = (name: string, o: Partial<ListEntry> & { rules?: string[] } = {}) =>
  entry({ name, stands: 3, drawEvents: ['Strain Expression'], ...o, specialRules: (o.rules ?? []).map(R) });

/** P1 (Spires) faces P2 across `gap` inches. */
function arena(p1: ListEntry, p2: ListEntry = entry({ name: 'Plain Guards', stands: 3 }), gap = 0, character?: ListEntry) {
  const A = list('Spires', [{ ...(character ? { character } : {}), regiments: [p1] }]);
  const g = createGame({ seed: 4, scenario: getScenario('melee')!, lists: { P1: A, P2: list('Foes', [{ regiments: [p2] }]) } });
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

describe('Spires Strains (sp p.5, p.21–33)', () => {
  it('a built-in Strain applies with nothing typed: Centaur Avatara gain Shock (sp p.30)', () => {
    const { s, rng } = arena(unit('Centaur Avatara', { type: 'Cavalry' }), undefined, 6);
    let u = activate(s, rng, 'P1-w0-r0');
    u = step(u, rng, { type: 'drawEvent', name: 'Strain Expression' }).state;
    expect(hasRule(u.regiments['P1-w0-r0']!.rules, 'Shock')).toBe(true);
    expect(hasRule(u.regiments['P1-w0-r0']!.rules, 'Decay')).toBe(true);
  });

  it('a typed Strain replaces the built-in one', () => {
    const { s } = arena(unit('Centaur Avatara', { type: 'Cavalry' }));
    s.players.P1.strains = { 'Centaur Avatara': { stats: { C: 1 }, rules: [], text: '+1 Clash' } };
    expect(strainFor(s, s.regiments['P1-w0-r0']!)!.text).toBe('+1 Clash');
  });

  it('Stryx: Disruptive gives enemies in contact with its front −1 Clash (sp p.27)', () => {
    const { s, rng } = arena(unit('Stryx'), entry({ name: 'Plain Guards', stands: 3, stats: { M: 6, V: 1, C: 3, A: 4, W: 4, R: 3, D: 2, E: 0 } }), 0);
    let u = activate(s, rng, 'P1-w0-r0');
    u = step(u, rng, { type: 'drawEvent', name: 'Strain Expression' }).state;
    expect(stat(u.regiments['P2-w0-r0']!, 'C')).toBe(2);
  });

  it('Vanguard Clones: +1 Attacks (sp p.29)', () => {
    const { s, rng } = arena(unit('Vanguard Clones'), undefined, 10);
    let u = activate(s, rng, 'P1-w0-r0');
    u = step(u, rng, { type: 'drawEvent', name: 'Strain Expression' }).state;
    expect(stat(u.regiments['P1-w0-r0']!, 'A')).toBe(5);
  });

  it('Force Grown Drones with 6+ Stands: Lethal Demise (2); Decay is at most 8 (sp p.24)', () => {
    const { s } = arena(unit('Force Grown Drones', { stands: 12 }));
    const r = s.regiments['P1-w0-r0']!;
    expect(strainFor(s, r)!.rules[0]!.raw).toBe('Lethal Demise (2)');
    expect(decayWounds(s, r).wounds).toBe(8);
  });

  it('Induced Aggression: a Pheromancer Warlord attached means no Decay Wounds (sp p.6)', () => {
    const ph = { ...hero('Pheromancer'), supremacyAbilities: ['Induced Aggression'], specialRules: [R('Practitioner (Pheromancy)')] };
    const { s } = arena(unit('Stryx', { battlefieldRoles: ['Drone'] }), undefined, 10, ph);
    expect(decayWounds(s, s.regiments['P1-w0-r0']!).wounds).toBe(0);
  });

  it('Induced Aggression: swap the Strain for +1 Clash (max 4) and +1 March (sp p.6)', () => {
    const ph = { ...hero('Pheromancer'), supremacyAbilities: ['Induced Aggression'] };
    const { s, rng } = arena(unit('Stryx', { battlefieldRoles: ['Drone'] }), undefined, 10, ph);
    let u = activate(s, rng, 'P1-w0-r0');
    u = step(u, rng, { type: 'drawEvent', name: 'Strain Expression', option: 'aggression' }).state;
    const r = u.regiments['P1-w0-r0']!;
    expect(r.roundMods.map((m) => m.stat).sort()).toEqual(['C', 'M']);
    expect(hasRule(r.rules, 'Disruptive')).toBe(false);
  });
});

describe('Spires Practitioner Actions (sp p.15)', () => {
  const pheromancer = () => ({ ...hero('Pheromancer'), supremacyAbilities: ['Induced Aggression'], specialRules: [R('Practitioner (Pheromancy)')] });
  function charActive(s: GameState, rng: RngState) {
    const t = structuredClone(s);
    t.turn = 'P1';
    t.drawn = { player: 'P1', card: { id: 'c', kind: 'character', name: 'Pheromancer', refId: 'P1-w0-c' } };
    return step(t, rng, { type: 'activateCharacter', characterId: 'P1-w0-c' }).state;
  }

  it('Induce Vigor gives Untouchable; a friendly Regiment is the Target of one Practitioner Action per Round (sp p.5, p.15)', () => {
    const { s, rng } = arena(unit('Stryx'), undefined, 10, pheromancer());
    let u = charActive(s, rng);
    u = step(u, rng, { type: 'characterAbility', characterId: 'P1-w0-c', name: 'Induce Vigor', targetId: 'P1-w0-r0' }).state;
    expect(hasRule(u.regiments['P1-w0-r0']!.rules, 'Untouchable')).toBe(true);
    // The Warlord's free extra Practitioner Action exists, but not on the same Regiment again.
    expect(validate(u, { type: 'characterAbility', characterId: 'P1-w0-c', name: 'Pheromantic Drive' }).ok).toBe(true);
    expect(validate(u, { type: 'characterAbility', characterId: 'P1-w0-c', name: 'Induce Vigor', targetId: 'P1-w0-r0' }).ok).toBe(false);
  });

  it('Siphon Strength: the enemy cannot be Inspired (sp p.15)', () => {
    const { s, rng } = arena(unit('Stryx'), undefined, 10, pheromancer());
    let u = charActive(s, rng);
    u = step(u, rng, { type: 'characterAbility', characterId: 'P1-w0-c', name: 'Siphon Strength', targetId: 'P2-w0-r0' }).state;
    expect(u.regiments['P2-w0-r0']!.flags.siphoned).toBe(true);
  });
});

describe('fixes', () => {
  it('the Inspired Special Rule raises Clash in a Clash, like the Inspire Action (core p.99)', () => {
    const { s, rng } = arena(unit('Avatara', { rules: ['Inspired'], drawEvents: [] }), undefined, 0);
    const u = activate(s, rng, 'P1-w0-r0');
    const res = step(u, rng, { type: 'clash', regimentId: 'P1-w0-r0', targetId: 'P2-w0-r0' });
    expect(res.events.some((e) => /is Inspired: Clash 2→3/.test(e.text))).toBe(true);
  });

  it('an entry that starts with Wound Markers does so (Consumption Beast, sp p.33)', () => {
    const beast = unit('Consumption Beast', { type: 'Monster', stands: 1, commandModels: [], stats: { M: 8, V: 1, C: 2, A: 10, W: 20, R: 4, D: 2, E: 2 }, notes: ['This Regiment starts the Battle with 8 Wound Markers on it.'] });
    const { s } = arena(beast);
    expect(s.regiments['P1-w0-r0']!.stands[0]!.wounds).toBe(8);
  });
});
