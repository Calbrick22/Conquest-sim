import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame, validate } from './game';
import type { CharacterState, GameState, RegimentState } from './model/types';
import { createRng, type RngState } from './rng';
import { refreshRules } from './rules/special/grants';
import { entry, hero, list } from './testing/fixtures';
import type { ArmyList, ListEntry, RuleRef } from '../import/types';
import { parseRuleRef } from '../import/ruleTokens';
import { hasRule, manualRules } from './rules/special/rules';
import { allocateWounds, charMoraleFlags, resolveAttack, stat } from './combat';
import { applyDuel, duelTargets, mustAcceptDuel } from './actions';
import { formationInput, marchValue } from './queries';
import { layout } from './formation';
import { spellProblems } from './spells';
import { nearEarth } from './factions/sorcererKings';
import type { Ctx } from './dice';

/**
 * Rules that used to be resolved by hand (Rider, Duels, Die Fighting!, Morale changes, relays).
 * Entry names are the factions' (mechanics are keyed on them); every number and text is invented.
 */
const R = (raw: string): RuleRef => parseRuleRef(raw);
const unit = (name: string, o: Partial<ListEntry> & { rules?: string[] } = {}) => entry({ name, stands: 3, ...o, specialRules: (o.rules ?? []).map(R) });
const char = (name: string, o: Partial<ListEntry> & { rules?: string[] } = {}) => ({ ...hero(name), ...o, specialRules: (o.rules ?? []).map(R) });
const monster = (name: string, o: Partial<ListEntry> & { rules?: string[] } = {}) =>
  unit(name, { stands: 1, type: 'Monster', cls: 'Heavy', commandModels: [], stats: { M: 7, V: 1, C: 3, A: 8, W: 12, R: 3, D: 4, E: 0 }, ...o });

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
const faction = (f: string, warbands: Parameters<typeof list>[1], sect: string | null = null): ArmyList => ({ ...list(f, warbands), faction: f, sect });
const byName = (s: GameState, n: string): RegimentState => Object.values(s.regiments).find((r) => r.name === n)!;
const charNamed = (s: GameState, n: string): CharacterState => Object.values(s.characters).find((c) => c.name === n)!;
const ctxOf = (s: GameState, dice: number[] = []): Ctx => {
  const c = structuredClone(s);
  c.forcedDice = [...dice];
  return { s: c, rng: createRng(1), events: [] };
};
/** Puts `b` face to face with `a`, front edges touching. */
const faceOff = (a: RegimentState, b: RegimentState) => {
  b.pose = { x: a.pose.x, y: a.pose.y, angle: a.pose.angle + Math.PI };
};
const texts = (ctx: Ctx) => ctx.events.map((e) => e.text).join('\n');

const raeghArmy = () =>
  faction('Dweghom', [
    {
      character: char('Hold Raegh', { options: { Masteries: ['Bergont Raegh'] }, stats: { M: 5, V: 1, C: 4, A: 5, W: 6, R: 4, D: 3, E: 0 } }),
      regiments: [unit('Hold Warriors', { battlefieldRoles: ['Clan'] }), monster('Ironclad Drake', { battlefieldRoles: ['Clan'] })],
    },
  ], 'The Clan Creed');

describe('Rider (core p.100)', () => {
  it('Rider: a Bergont Raegh rides its Ironclad Drake, shares its Stand and uses its March (core p.100, dw p.24)', () => {
    const { s } = game(raeghArmy());
    const c = charNamed(s, 'Hold Raegh');
    const drake = byName(s, 'Ironclad Drake');
    expect(c.rider).toBe(true);
    expect(c.attachedTo).toBe(drake.id);
    expect(hasRule(c.rules, 'Rider')).toBe(true);
    const slots = layout(formationInput(s, drake));
    const mount = slots.find((x) => !x.isCharacter)!;
    const rider = slots.find((x) => x.isCharacter)!;
    expect(rider.rect.c.x).toBeCloseTo(mount.rect.c.x, 2);
    expect(rider.rect.c.y).toBeCloseTo(mount.rect.c.y, 2);
    expect(marchValue(s, drake)).toBe(7);
  });

  it('Bergont Raegh: the Ironclad Drake gains Flawless Strikes and +2 Wounds (dw p.24)', () => {
    const { s } = game(raeghArmy());
    const drake = byName(s, 'Ironclad Drake');
    expect(hasRule(drake.rules, 'Flawless Strikes')).toBe(true);
    expect(stat(drake, 'W')).toBe(14);
    expect(hasRule(charNamed(s, 'Hold Raegh').rules, 'Flawless Strikes')).toBe(true);
  });

  it('Favored of Hormus: rides a Mahut that loses Barrage, gains Terrifying (1) and makes friends within 3″ count as near Earth (sk p.17)', () => {
    const A = faction('Sorcerer Kings', [
      {
        character: char('Maharajah', { options: { Upgrades: ['Favored of Hormus'] }, battlefieldRoles: ['Character', 'Court of Earth'] }),
        regiments: [monster('Mahut', { rules: ['Barrage (4) (18")'] }), unit('Mahabharati Initiates')],
      },
    ]);
    const { s } = game(A);
    const mahut = byName(s, 'Mahut');
    expect(charNamed(s, 'Maharajah').attachedTo).toBe(mahut.id);
    expect(hasRule(mahut.rules, 'Barrage')).toBe(false);
    expect(hasRule(mahut.rules, 'Terrifying')).toBe(true);
    const ini = byName(s, 'Mahabharati Initiates');
    expect(nearEarth(s, ini)).toBe(false);
    ini.pose = { x: mahut.pose.x + 4.5, y: mahut.pose.y, angle: mahut.pose.angle };
    expect(nearEarth(s, ini)).toBe(true);
  });
});

describe('Duels (core p.76)', () => {
  it('Slain Bigger: +3 Evasion (to 3) and Fearless in a Duel against a Rider (dw p.11)', () => {
    const B = faction('Dweghom', [{ character: char('Ardent Kerawegh', { rules: ['Slain Bigger'] }), regiments: [unit('Wardens', { battlefieldRoles: ['Ardent'] })] }], 'The Ardent Creed');
    const { s } = game(raeghArmy(), B);
    const drake = byName(s, 'Ironclad Drake');
    const wardens = byName(s, 'Wardens');
    faceOff(drake, wardens);
    const raegh = charNamed(s, 'Hold Raegh');
    const kerawegh = charNamed(s, 'Ardent Kerawegh');
    expect(duelTargets(s, raegh).map((x) => x.id)).toEqual([kerawegh.id]);
    const ctx = ctxOf(s, Array(60).fill(2));
    applyDuel(ctx, ctx.s.characters[raegh.id]!, ctx.s.characters[kerawegh.id]!, true);
    expect(texts(ctx)).toMatch(/Slain Bigger: Ardent Kerawegh has Evasion 3/);
  });

  it("Cuirass of Hazlia's Shadow: cannot be declined, and once per game it survives with 1 Wound (od p.18)", () => {
    const A = faction('Old Dominion', [{ character: char('Strategos', { options: { Sarcophagus: ["Cuirass of Hazlia's Shadow"] } }), regiments: [unit('Praetorian Guard')] }]);
    const B = list('Foes', [{ character: char('Foe Champion', { stats: { M: null, V: 1, C: 6, A: 12, W: 4, R: 6, D: 0, E: 0 } }), regiments: [unit('Plain Guards')] }]);
    const { s } = game(A, B);
    faceOff(byName(s, 'Praetorian Guard'), byName(s, 'Plain Guards'));
    const me = charNamed(s, 'Strategos');
    const foe = charNamed(s, 'Foe Champion');
    expect(mustAcceptDuel(s, foe, me)).toMatch(/Cuirass/);
    const ctx = ctxOf(s, [...Array(4).fill(6), ...Array(12).fill(1), ...Array(40).fill(6)]);
    applyDuel(ctx, ctx.s.characters[foe.id]!, ctx.s.characters[me.id]!, true);
    const after = ctx.s.characters[me.id]!;
    expect(after.destroyed).toBe(false);
    expect(after.cuirassUsed).toBe(true);
    expect(after.wounds).toBe(3);
  });

  it("Cuirass of Hazlia's Shadow: declining its Duel gives −1 Attacks for the rest of the game (od p.18)", () => {
    const A = faction('Old Dominion', [{ character: char('Strategos', { options: { Sarcophagus: ["Cuirass of Hazlia's Shadow"] } }), regiments: [unit('Praetorian Guard')] }]);
    const B = list('Foes', [{ character: char('Foe Champion'), regiments: [unit('Plain Guards')] }]);
    const { s } = game(A, B);
    faceOff(byName(s, 'Praetorian Guard'), byName(s, 'Plain Guards'));
    const ctx = ctxOf(s);
    applyDuel(ctx, charNamed(ctx.s, 'Strategos'), charNamed(ctx.s, 'Foe Champion'), false);
    refreshRules(ctx.s);
    expect(stat(byName(ctx.s, 'Plain Guards'), 'A')).toBe(3);
    expect(charNamed(ctx.s, 'Foe Champion').grantMods?.some((m) => m.stat === 'A' && m.delta === -1)).toBe(true);
  });

  it('the Fallen Divinity can be challenged, may Duel in its own Activation and cannot decline (od p.8)', () => {
    const A = faction('Old Dominion', [{ character: char('Fallen Divinity', { type: 'Monster', cls: 'Heavy', rules: ['Animate Vessel'] }), regiments: [] }]);
    const B = list('Foes', [{ character: char('Foe Champion'), regiments: [unit('Plain Guards')] }]);
    const { s, rng } = game(A, B);
    const fdReg = byName(s, 'Fallen Divinity');
    faceOff(fdReg, byName(s, 'Plain Guards'));
    const fd = charNamed(s, 'Fallen Divinity');
    const foe = charNamed(s, 'Foe Champion');
    expect(duelTargets(s, foe).map((x) => x.id)).toEqual([fd.id]);
    expect(mustAcceptDuel(s, foe, fd)).toMatch(/od p\.8/);
    const t = structuredClone(s);
    t.turn = 'P1';
    t.drawn = { player: 'P1', card: { id: 'card-fd', kind: 'regiment', name: fdReg.name, refId: fdReg.id } };
    const act = apply(t, { type: 'activate', regimentId: fdReg.id }, rng).state;
    expect(validate(act, { type: 'duel', characterId: fd.id, targetCharacterId: foe.id, accept: true }).ok).toBe(true);
  });
});

describe('Arrogance (sk p.34)', () => {
  const sk = () =>
    game(
      faction('Sorcerer Kings', [{ character: char('Sorcerer', { battlefieldRoles: ['Character', 'Court of Fire'], rules: ['Wizard (4)'] }), regiments: [unit('Ghols'), monster('Rakshasa Bakasura', { battlefieldRoles: ['Elemental', 'Court of Fire'] })] }]),
      list('Foes', [{ character: char('Foe Champion'), regiments: [unit('Plain Guards')] }]),
    );
  it('Arrogance: the Rakshasa makes a free Duel as if it were a Character Stand (sk p.34)', () => {
    const { s, rng } = sk();
    const rak = byName(s, 'Rakshasa Bakasura');
    faceOff(rak, byName(s, 'Plain Guards'));
    const foe = charNamed(s, 'Foe Champion');
    const t = structuredClone(s);
    t.turn = 'P1';
    t.drawn = { player: 'P1', card: { id: 'card-rak', kind: 'regiment', name: rak.name, refId: rak.id } };
    let st = apply(t, { type: 'activate', regimentId: rak.id }, rng).state;
    const duel = { type: 'duel', characterId: rak.id, targetCharacterId: foe.id, accept: false } as const;
    expect(validate(st, duel).ok).toBe(true);
    st = apply(st, duel, rng).state;
    // A refused Duel: Flurry until the end of the Round, and the Duel used no normal Action.
    expect(hasRule(st.regiments[rak.id]!.rules, 'Flurry')).toBe(true);
    expect(st.activation!.actions).toEqual([]);
    expect(validate(st, duel).ok).toBe(false);
  });
});

describe('Die Fighting! and Morale (core p.59, p.74)', () => {
  it('Ardent Creed: an [Ardent] Command Stand Dies Fighting! even after its Regiment activated (dw p.6)', () => {
    const A = faction('Dweghom', [{ character: char('Ardent Kerawegh'), regiments: [unit('Wardens', { stands: 1, battlefieldRoles: ['Ardent'] }), unit('Hold Warriors', { battlefieldRoles: ['Clan'] })] }], 'The Ardent Creed');
    const { s } = game(A);
    const w = byName(s, 'Wardens');
    // Keep the Kerawegh off the Wardens so only the Command Stand fights.
    charNamed(s, 'Ardent Kerawegh').attachedTo = byName(s, 'Hold Warriors').id;
    w.activatedThisRound = true;
    faceOff(w, byName(s, 'Plain Guards'));
    const ctx = ctxOf(s);
    allocateWounds(ctx, ctx.s.regiments[w.id]!, 10, 'P2');
    expect(texts(ctx)).toMatch(/Wardens's Command Stand makes a last Clash against Plain Guards \(Ardent Creed/);
    expect(ctx.s.regiments[w.id]!.location).toBe('destroyed');
  });

  it('Chthonic Flame: Morale Tests against its Wounds re-roll successes (dw p.22)', () => {
    const { s } = game(faction('Dweghom', [{ character: char('Ardent Kerawegh', { options: { Relics: ['Chthonic Flame'] } }), regiments: [unit('Wardens')] }], 'The Ardent Creed'));
    expect(charMoraleFlags(charNamed(s, 'Ardent Kerawegh'))).toEqual({ moraleRerollSuccesses: true });
    const ctx = ctxOf(s, [6, 6, 1, 1, 1, 1]);
    resolveAttack(ctx, { attackerOwner: 'P1', targetId: byName(s, 'Plain Guards').id, arc: 'front', pools: [{ label: 'Kerawegh', dice: 0, skill: 0, autoHits: 2, moraleRerollSuccesses: true }], morale: true, terrifying: 0, what: 'test', kind: 'clash' });
    expect(texts(ctx)).toMatch(/tests Morale 2× .*Chthonic Flame/);
  });

  it('Anastegma: two Morale dice per Wound from its bearer (od p.20)', () => {
    const { s } = game(faction('Old Dominion', [{ character: char('Strategos', { options: { Arsenal: ['Anastegma, Brand of the Faithless'] } }), regiments: [unit('Praetorian Guard')] }]));
    expect(charMoraleFlags(charNamed(s, 'Strategos'))).toEqual({ moraleDouble: true });
    const ctx = ctxOf(s, [6, 1, 1, 1]);
    resolveAttack(ctx, { attackerOwner: 'P1', targetId: byName(s, 'Plain Guards').id, arc: 'front', pools: [{ label: 'Strategos', dice: 0, skill: 0, autoHits: 1, moraleDouble: true }], morale: true, terrifying: 0, what: 'test', kind: 'clash' });
    expect(texts(ctx)).toMatch(/tests Morale 2× .*Anastegma/);
  });
});

describe('Old Dominion choices (od p.10–30)', () => {
  const odArmy = (charOpts: Partial<ListEntry> & { rules?: string[] }, regs: ListEntry[] = [unit('Praetorian Guard', { battlefieldRoles: ['The Legion'] })]) =>
    faction('Old Dominion', [{ character: char('Xhiliarch', { battlefieldRoles: ['Character', 'The Legion'], ...charOpts }), regiments: regs }]);
  const activeOn = (s: GameState, rng: RngState, id: string) => {
    const t = structuredClone(s);
    const r = t.regiments[id]!;
    t.turn = r.owner;
    t.drawn = { player: r.owner, card: { id: `card-${id}`, kind: 'regiment', name: r.name, refId: id } };
    return apply(t, { type: 'activate', regimentId: id }, rng).state;
  };

  it('Exhortation of Eternal Faith: friendly Command Stands within 12″ Clash with +3 Attacks and Cleave (1) (od p.30)', () => {
    const { s, rng } = game(odArmy({}));
    const pg = byName(s, 'Praetorian Guard');
    faceOff(pg, byName(s, 'Plain Guards'));
    pg.flags.exhortAura = true;
    const st = activeOn(s, rng, pg.id);
    const r = apply(st, { type: 'clash', regimentId: pg.id, targetId: byName(s, 'Plain Guards').id }, rng);
    expect(r.events.map((e) => e.text).join('\n')).toMatch(/Command Stand \(Exhortation of Eternal Faith: \+3 Attacks, Cleave \(1\)\): 8 dice/);
  });

  it('Obdurate Bone and Stone: once per Round, +Tier Attacks for the Warlord’s next Clash (od p.10, AMB-41)', () => {
    const { s, rng } = game(odArmy({ supremacyAbilities: ['Obdurate Bone and Stone'] }));
    const pg = byName(s, 'Praetorian Guard');
    faceOff(pg, byName(s, 'Plain Guards'));
    s.players.P1.od!.dark = 10;
    let st = activeOn(s, rng, pg.id);
    const a = { type: 'odClash', regimentId: pg.id, option: 'obdurate' } as const;
    expect(validate(st, a).ok).toBe(true);
    st = apply(st, a, rng).state;
    const w = charNamed(st, 'Xhiliarch');
    expect(w.nextA).toBeGreaterThan(0);
    expect(validate(st, a).ok).toBe(false);
    st = apply(st, { type: 'clash', regimentId: pg.id, targetId: byName(s, 'Plain Guards').id }, rng).state;
    expect(charNamed(st, 'Xhiliarch').nextA).toBeUndefined();
  });

  it('Soul Reaper: X Dark Power Tokens for +X Attacks until the end of the Round (od p.20)', () => {
    const { s, rng } = game(odArmy({ options: { Arsenal: ['Soul Reaper'] } }));
    const pg = byName(s, 'Praetorian Guard');
    faceOff(pg, byName(s, 'Plain Guards'));
    s.players.P1.od!.dark = 5;
    let st = activeOn(s, rng, pg.id);
    expect(validate(st, { type: 'odClash', regimentId: pg.id, option: 'soulReaper', amount: 6 }).ok).toBe(false);
    st = apply(st, { type: 'odClash', regimentId: pg.id, option: 'soulReaper', amount: 3 }, rng).state;
    expect(st.players.P1.od!.dark).toBe(2);
    expect(charNamed(st, 'Xhiliarch').grantMods?.find((m) => m.source === 'Soul Reaper')?.delta).toBe(3);
  });

  it('Trial of Will: Defense Rolls against a lower Resolve; with no Resolve, −1 Defense (od p.10)', () => {
    const tough = unit('Plain Guards', { stats: { M: 6, V: 1, C: 2, A: 4, W: 4, R: 1, D: 5, E: 0 } });
    const { s, rng } = game(odArmy({ supremacyAbilities: ['Reign of Terror'] }), list('Foes', [{ regiments: [tough] }]));
    const pg = byName(s, 'Praetorian Guard');
    faceOff(pg, byName(s, 'Plain Guards'));
    s.players.P1.od!.dark = 3;
    let st = activeOn(s, rng, pg.id);
    st = apply(st, { type: 'odClash', regimentId: pg.id, option: 'reignOfTerror' }, rng).state;
    const r = apply(st, { type: 'clash', regimentId: pg.id, targetId: byName(s, 'Plain Guards').id }, rng);
    expect(r.events.map((e) => e.text).join('\n')).toMatch(/Trial of Will: Plain Guards makes its Defense Rolls against its Resolve \(1\)/);
    expect(r.state.regiments[pg.id]!.flags.trialNext).toBe(false);
  });

  it('Implacable: Break Their Lines gives the Regiment Linebreaker (od p.21)', () => {
    const { s, rng } = game(odArmy({ options: { Blessings: ['Implacable'] } }));
    const x = charNamed(s, 'Xhiliarch');
    expect(x.actions.some((a) => a.name === 'Break Their Lines')).toBe(true);
    const t = structuredClone(s);
    t.turn = 'P1';
    t.drawn = { player: 'P1', card: { id: 'card-x', kind: 'character', name: x.name, refId: x.id } };
    let st = apply(t, { type: 'activateCharacter', characterId: x.id }, rng).state;
    expect(st.activation?.characterId).toBe(x.id);
    st = apply(st, { type: 'characterAbility', characterId: x.id, name: 'Break Their Lines' }, rng).state;
    expect(hasRule(st.regiments[x.attachedTo!]!.rules, 'Linebreaker')).toBe(true);
  });

  it('Hierotekton: the Character joins its Warband’s Bone Golems (od p.19)', () => {
    const A = faction('Old Dominion', [{ character: char('Hierodeacon', { type: 'Brute', options: { Treasures: ['Hierotekton'] } }), regiments: [unit('Plain Brutes', { type: 'Brute' }), unit('Bone Golems', { type: 'Brute' })] }]);
    const { s } = game(A);
    expect(charNamed(s, 'Hierodeacon').attachedTo).toBe(byName(s, 'Bone Golems').id);
  });

  it('What we did in Life: a declined Duel makes the Regiment re-roll successful Morale Tests (od p.21)', () => {
    const { s } = game(odArmy({ options: { Codex: ['What we did in Life will Echo in Eternity'] } }), list('Foes', [{ character: char('Foe Champion'), regiments: [unit('Plain Guards')] }]));
    faceOff(byName(s, 'Praetorian Guard'), byName(s, 'Plain Guards'));
    const ctx = ctxOf(s);
    applyDuel(ctx, charNamed(ctx.s, 'Xhiliarch'), charNamed(ctx.s, 'Foe Champion'), false);
    expect(byName(ctx.s, 'Plain Guards').flags.rerollMoraleSuccesses).toBe(true);
  });
});

describe('Spellcasting relays', () => {
  it('Forgemaster: a [Tempered] caster measures from an Awakened [Forged] Command Stand, up to half the Range (dw p.7)', () => {
    const A = faction('Dweghom', [
      {
        character: char('Tempered Sorcerer', { supremacyAbilities: ['Forgemaster'], battlefieldRoles: ['Character', 'Tempered'], rules: ['Wizard (6)'], options: { Schools: ['Fire'] } }),
        regiments: [unit('Hold Warriors', { battlefieldRoles: ['Tempered'] }), unit('Fireforged', { battlefieldRoles: ['Tempered', 'Forged'] })],
      },
    ], 'The Tempered Creed');
    const { s } = game(A);
    const caster = charNamed(s, 'Tempered Sorcerer');
    const forged = byName(s, 'Fireforged');
    const foe = byName(s, 'Plain Guards');
    // The foe stands 6″ in front of the Fireforged and far beyond the Sorcerer's 16″.
    forged.pose = { x: 60, y: 20, angle: Math.PI / 2 };
    foe.pose = { x: 60, y: 26, angle: -Math.PI / 2 };
    s.activation = { regimentId: caster.attachedTo!, characterId: caster.id, actions: [], entering: false, startPose: s.regiments[caster.attachedTo!]!.pose, drawEventDone: false, aimed: false, inspired: false, ended: false };
    expect(spellProblems(s, caster.id, 'Coruscation', foe.id)).not.toEqual([]);
    forged.flags.awakened = true;
    expect(spellProblems(s, caster.id, 'Coruscation', foe.id)).toEqual([]);
  });
});

describe('Registry', () => {
  it('Pike Formation, Flamer, Rider and Slain Bigger are known rules, not manual (core p.100, dw p.11, p.37, p.45)', () => {
    expect(manualRules(['Pike Formation', 'Flamer', 'Rider', 'Slain Bigger', 'Chthonic Flame'].map(R))).toEqual([]);
  });
});
