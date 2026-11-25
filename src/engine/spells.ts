import { heal } from './activation';
import { spellHits, type Caster, type SpellDef } from './spellCore';
export type { Caster, SpellDef } from './spellCore';
import { hasLineOfSight, enemiesInContact } from './actions';
import { stat, charStat } from './combat';
import { ev, rollTest, type Ctx } from './dice';
import { layout } from './formation';
import { rectPoly, type Poly } from './geometry/polygon';
import { TOL } from './geometry/vec';
import type { CharacterState, GameState, PlayerId, PowerPool, RegimentState } from './model/types';
import { attachedCharacter, distancePolys, formationInput, isEngaged, regimentPolys, regimentStandCount } from './queries';
import { hasRule, ruleX } from './rules/special/rules';
import { addPower, darkTierMax, pantheonTier, poolTier, regimentDarkTier, roleOf } from './factions/oldDominion';
import { addMarkers, characterCourts, ofCourt, sk, skUnit, spellKey, warlordHas } from './factions/sorcererKings';
import { SK_SPELLS } from './factions/sorcererKingsSpells';

/**
 * Spellcasting (core p.80–81):
 * - a caster with Wizard (X) or Priest (X) rolls X dice; each result at or under the Spell's
 *   Attunement is a success, and at least two are needed;
 * - Scaling Spells need +1 success for 4–6 Stands in the target, +2 for 7–9, +3 for 10+, and +1
 *   against a Monster;
 * - −1 Attunement when the caster or its target is within 10″ of an enemy spellcaster;
 * - Spells that cause Hits need Line of Sight, and an engaged caster may only target the enemy it
 *   is in contact with; Hits use Defense and Morale but not the flank and rear rules;
 * - a unit cannot be the target of the same Spell twice in a Round (Hit Spells excepted), and a
 *   caster cannot cast the same Spell twice in one Activation (core p.76).
 * Devout (core p.97): one failed die becomes a success when a friendly Priest targets the Regiment.
 *
 * Spell profiles come from the faction list: the Old Dominion's are below (od p.22–23). Any other
 * Spell can be cast with an Attunement the player enters; the engine rolls, and its effect is manual.
 */

const highestTier = (s: GameState, p: PlayerId) => Math.max(poolTier(s, p, 'dark'), pantheonTier(s, p));

export const SPELLS: Record<string, SpellDef> = {
  // Hierodeacon (od p.22)
  'Dark Supplication': {
    range: 'self',
    attunement: 2,
    scaling: false,
    hits: false,
    target: 'self',
    apply: (ctx, c, _t, _n, ch) => addPower(ctx, c.owner, 1, 'Dark Supplication', ch.pool),
  },
  'Blackflame Coruscation': {
    range: 12,
    attunement: 3,
    scaling: true,
    hits: true,
    target: 'enemy',
    apply: (ctx, c, t, n) => spellHits(ctx, c, t, n + highestTier(ctx.s, c.owner), 'Blackflame Coruscation'),
  },
  'Benediction of the Black Sun': {
    range: 12,
    attunement: 3,
    scaling: true,
    hits: false,
    target: 'friendly',
    check: (_s, t) => (t.type === 'Brute' ? null : 'Benediction of the Black Sun targets a friendly Brute Regiment.'),
    apply: (ctx, _c, t) => {
      t.roundRules.push({ name: 'Blessed', raw: 'Blessed' });
      ev(ctx, { type: 'spell', text: `${t.name} gains Blessed until the end of the Round.`, regimentId: t.id });
    },
  },
  'Undying Devotion': {
    range: 12,
    attunement: 3,
    scaling: false,
    hits: false,
    target: 'friendly',
    check: (_s, t) => (/^(cultists|hashashin)$/i.test(t.name) ? null : 'Undying Devotion targets a friendly Cultists or Hashashin Regiment.'),
    apply: (ctx, _c, t) => {
      (t.roundRoles ??= []).push('The Fallen Pantheon');
      t.flags.undyingDevotion = true;
      ev(ctx, { type: 'spell', text: `${t.name} gains [The Fallen Pantheon]; each Stand it loses this Round adds a Power Token.`, regimentId: t.id });
    },
  },
  // Archimandrite and Theokrator (od p.22)
  'Unholy Baptism': {
    range: 12,
    attunement: 3,
    scaling: false,
    hits: true,
    target: 'enemy',
    apply: (ctx, c, t, n) => spellHits(ctx, c, t, n, 'Unholy Baptism', { reduceD: 1 }),
  },
  'Blasphemous Power': {
    range: 12,
    attunement: 3,
    scaling: true,
    hits: false,
    target: 'friendly',
    apply: (ctx, _c, t) => {
      (t.roundRoles ??= []).push('The Creed');
      const atMax = regimentDarkTier(ctx.s, t) >= darkTierMax(ctx.s, t.owner);
      if (atMax) {
        t.roundRules.push({ name: 'Flurry', raw: 'Flurry' }, { name: 'Decay', raw: 'Decay' });
        ev(ctx, { type: 'spell', text: `${t.name} gains [The Creed]; already at the highest Dark Power Tier, it gains Flurry and Decay.`, regimentId: t.id });
      } else {
        t.flags.tierBonus = (t.flags.tierBonus ?? 0) + 1;
        ev(ctx, { type: 'spell', text: `${t.name} gains [The Creed] and counts as under the Dark Power Pool Tier +1.`, regimentId: t.id });
      }
    },
  },
  "Hazlia's Touch": {
    range: 12,
    attunement: 3,
    scaling: false,
    hits: false,
    target: 'friendly',
    apply: (ctx, c, t) => {
      const x = poolTier(ctx.s, c.owner, 'dark');
      const n = roleOf(t, 'Creed') || roleOf(t, 'Legion') ? 1 + x : x;
      heal(ctx, t, n, "Hazlia's Touch");
    },
  },
  'Dark Immolation': {
    range: 12,
    attunement: 3,
    scaling: false,
    hits: false,
    target: 'friendly',
    apply: (ctx, _c, t) => {
      (t.roundRoles ??= []).push('The Creed');
      t.roundRules.push({ name: 'Aura of Death', x: 1, plus: true, raw: 'Aura of Death (+1)' });
      ev(ctx, { type: 'spell', text: `${t.name} gains [The Creed] and Aura of Death (+1) until the end of the Round.`, regimentId: t.id });
    },
  },
  // Kheres (od p.23)
  Insanity: {
    range: 14,
    attunement: 3,
    scaling: false,
    hits: true,
    target: 'enemy',
    apply: (ctx, c, t, n) => {
      // Defense Rolls use the lowest modified Resolve instead of Defense; no Morale Tests.
      // RULE-AMBIGUITY: AMB-42 — a target with no Resolve uses its Defense as normal.
      const ch = attachedCharacter(ctx.s, t.id);
      const rs = [t.profile.R === null ? null : stat(t, 'R'), ch && ch.profile.R !== null ? charStat(ch, 'R') : null].filter((x): x is number => x !== null);
      spellHits(ctx, c, t, 2 * n, 'Insanity', rs.length ? { defenseOverride: Math.min(...rs) } : {}, false);
    },
  },
  'Drain Will': {
    range: 12,
    attunement: 3,
    scaling: true,
    hits: false,
    target: 'enemy',
    apply: (ctx, _c, t) => {
      const already = -t.roundMods.filter((m) => m.source === 'Drain Will').reduce((a, m) => a + m.delta, 0);
      if (already >= 2) return void ev(ctx, { type: 'spell', text: `${t.name} already has −2 Defense from Drain Will (the maximum).` });
      t.roundMods.push({ stat: 'D', delta: -1, source: 'Drain Will' });
      ev(ctx, { type: 'spell', text: `${t.name} suffers −1 Defense until the end of the Round (Drain Will).`, regimentId: t.id });
    },
  },
  // Moroi (od p.23)
  Translocation: {
    range: 'self',
    attunement: 3,
    scaling: true,
    hits: false,
    target: 'self',
    check: (s, t) => (isEngaged(s, t) ? 'Translocation cannot be used while Engaged.' : null),
    apply: (ctx, _c, t) =>
      ev(ctx, { type: 'manual', text: `Translocation: move ${t.name} up to 8″ in any direction, ignoring other Regiments and terrain, to a legal position (use "Move by hand").`, regimentId: t.id }),
  },
  Immolation: {
    range: 'self',
    attunement: 3,
    scaling: true,
    hits: false,
    target: 'self',
    apply: (ctx, _c, t) => {
      t.roundRules.push({ name: 'Aura of Death', x: 1, plus: true, raw: 'Aura of Death (+1)' });
      ev(ctx, { type: 'spell', text: `${t.name} gains Aura of Death (+1) until the end of the Round.`, regimentId: t.id });
    },
  },
};

Object.assign(SPELLS, SK_SPELLS);

export function spellDef(name: string): SpellDef | undefined {
  const k = Object.keys(SPELLS).find((n) => spellKey(n) === spellKey(name));
  return k ? SPELLS[k] : undefined;
}

// ---------------------------------------------------------------- casters

function isCasterRules(rules: CharacterState['rules']): boolean {
  return hasRule(rules, 'Priest') || hasRule(rules, 'Wizard');
}

/** The caster for an Activation: the active Character, or the active Regiment (embodied Character, Memories of Old). */
export function casterOf(s: GameState, casterId: string): Caster | null {
  const c = s.characters[casterId];
  if (c && !c.embodied) {
    if (!c.attachedTo) return null;
    const r = s.regiments[c.attachedTo]!;
    const dice = ruleX(c.rules, 'Priest') || ruleX(c.rules, 'Wizard');
    return { id: c.id, name: c.name, owner: r.owner, regiment: r, character: c, rules: c.rules, spells: c.spells ?? [], dice: dice + (c.sacrament ? 3 : 0), priest: hasRule(c.rules, 'Priest') };
  }
  const r = s.regiments[casterId];
  if (!r) return null;
  // Memories of Old (Kheres, Moroi; od p.23): Priest (X), X = twice the Stands, at most 12.
  const memPriest = r.flags.memories && /spellcasting/i.test(r.memoriesText ?? '') ? Math.min(12, 2 * r.stands.length) : 0;
  const dice = Math.max(ruleX(r.rules, 'Priest') || ruleX(r.rules, 'Wizard'), memPriest);
  return { id: r.id, name: r.name, owner: r.owner, regiment: r, rules: r.rules, spells: r.spells ?? skUnit(r)?.spells ?? [], dice, priest: hasRule(r.rules, 'Priest') || memPriest > 0 };
}

function casterPolys(s: GameState, c: Caster): Poly[] {
  if (c.character) {
    const slot = layout(formationInput(s, c.regiment)).find((x) => x.isCharacter);
    if (slot) return [rectPoly(slot.rect)];
  }
  return regimentPolys(s, c.regiment);
}

/** Enemy spellcasters within 10″ of the caster or the target: −1 Attunement (core p.80). */
function interference(s: GameState, c: Caster, t: RegimentState): boolean {
  const near = (polys: Poly[]) =>
    Object.values(s.regiments).some((e) => {
      if (e.owner === c.owner || e.location !== 'table') return false;
      const ec = attachedCharacter(s, e.id);
      if (!isCasterRules(e.rules) && !(ec && isCasterRules(ec.rules))) return false;
      return distancePolys(regimentPolys(s, e), polys) <= 10 + TOL;
    });
  return near(casterPolys(s, c)) || near(regimentPolys(s, t));
}

export function scalingExtra(s: GameState, t: RegimentState, extraStands = 0): number {
  const n = regimentStandCount(s, t) + extraStands;
  return (n >= 10 ? 3 : n >= 7 ? 2 : n >= 4 ? 1 : 0) + (t.type === 'Monster' ? 1 : 0);
}

/** Spell range bonuses: Elemental Projection +3″ (sk p.17), Arcane Tide Form +4″ (sk p.45). */
function rangeBonus(s: GameState, c: Caster): number {
  let b = 0;
  if (c.character?.options.some((o) => o.toLowerCase() === 'elemental projection')) b += 3;
  if (!c.character && c.regiment.flags.form === 'range' && s.activation?.regimentId === c.regiment.id) b += 4;
  return b;
}

/**
 * Elemental Tether (Trinavarta Sabhagrih, sk p.38): friendly [Court of Air] spellcasters may target
 * it, or friendly Regiments within 8″ of it, regardless of range and Line of Sight.
 */
function tether(s: GameState, c: Caster, t: RegimentState): boolean {
  if (t.owner !== c.owner) return false;
  const airCaster = c.character ? characterCourts(s, c.character).includes('Air') : ofCourt(s, c.regiment, 'Air');
  if (!airCaster) return false;
  return Object.values(s.regiments).some(
    (a) => a.owner === c.owner && a.location === 'table' && skUnit(a)?.tether && (a.id === t.id || distancePolys(regimentPolys(s, a), regimentPolys(s, t)) <= 8 + TOL),
  );
}

export function spellProblems(s: GameState, casterId: string, name: string, targetId: string, attunement?: number): string[] {
  const c = casterOf(s, casterId);
  if (!c) return ['Unknown spellcaster.'];
  if (c.dice <= 0) return [`${c.name} has no Wizard (X) or Priest (X) (core p.80).`];
  const act = s.activation;
  if (!act || act.regimentId !== c.regiment.id) return [`${c.name} is not Activating.`];
  if (c.character && act.characterId !== c.character.id) return ["Characters cast Spells during their own Activation (core p.74)."];
  if (c.spells.length && !c.spells.some((x) => spellKey(x) === spellKey(name))) return [`${c.name} does not know ${name}.`];
  if ((act.spellsCast ?? []).includes(name.toLowerCase())) return ['The same Spell cannot be cast twice in one Activation (core p.76).'];
  // Omnipotence (Sorcerer Warlord, sk p.6): a Character attempts each Spell once per Round; each Spell at most three times per Round.
  const st = sk(s, c.owner);
  if (st && warlordHas(s, c.owner, 'Omnipotence')) {
    if (c.character && (st.charSpells[c.character.id] ?? []).includes(spellKey(name))) return [`${c.name} has already attempted ${name} this Round (Omnipotence, sk p.6).`];
    if ((st.spellCount[spellKey(name)] ?? 0) >= 3) return [`${name} has already been cast three times this Round (Omnipotence, sk p.6).`];
  }
  if (c.regiment.location !== 'table') return ['The caster must be on the Battlefield.'];
  const t = s.regiments[targetId];
  if (!t || t.location !== 'table') return ['Choose a target on the Battlefield.'];
  const def = spellDef(name);
  if (!def && !(attunement && attunement >= 1 && attunement <= 6)) return [`${name} has no known profile: enter its Attunement (1–6) to cast it; its effect is then manual.`];
  if (def) {
    if (def.target === 'self' && t.id !== c.regiment.id) return [`${name} has Range Self: it targets the caster's own Regiment (core p.80).`];
    if (def.target === 'friendly' && t.owner !== c.owner) return [`${name} targets a friendly Regiment.`];
    if (def.target === 'enemy' && t.owner === c.owner) return [`${name} targets an enemy Regiment.`];
    const tethered = tether(s, c, t);
    const range = def.range === 'self' ? 'self' : def.range + rangeBonus(s, c);
    if (range !== 'self' && !tethered && distancePolys(casterPolys(s, c), regimentPolys(s, t)) > range + TOL) return [`${t.name} is beyond ${range}″.`];
    if (def.hits) {
      const engaged = enemiesInContact(s, c.regiment);
      if (engaged.length && !engaged.some((e) => e.id === t.id)) return ['An engaged spellcaster may only target the enemy it is in contact with with Hit Spells (core p.80).'];
      if (!engaged.length && !tethered && !hasLineOfSight(s, c.regiment, t)) return [`${t.name} is not in Line of Sight (core p.80).`];
    } else if ((t.flags.spellsOn ?? []).includes(name.toLowerCase())) return [`${t.name} has already been the target of ${name} this Round (core p.80).`];
    const why = def.check?.(s, t);
    if (why) return [why];
  }
  return [];
}

/** Resolve a Spellcasting Action (core p.80–81). */
export function castSpell(ctx: Ctx, casterId: string, name: string, targetId: string, opts: { attunement?: number; pool?: PowerPool } = {}): void {
  const s = ctx.s;
  const c = casterOf(s, casterId)!;
  const t = s.regiments[targetId]!;
  const def = spellDef(name);
  const act = s.activation!;
  (act.spellsCast ??= []).push(name.toLowerCase());
  if (c.character?.sacrament) c.character.sacrament = false;
  const baseAtt = def?.attunement ?? opts.attunement!;
  const penal = interference(s, c, t);
  const att = Math.max(0, baseAtt - (penal ? 1 : 0));
  const st = sk(s, c.owner);
  if (st) {
    const k = spellKey(name);
    st.spellCount[k] = (st.spellCount[k] ?? 0) + 1;
    if (c.character) (st.charSpells[c.character.id] ??= []).push(k);
  }
  // Eminence (Mahabharati Initiates, sk p.27): against an enemy spellcaster, +2 Evasion and +5 Stands for Scaling.
  const eminence = t.owner !== c.owner && !!skUnit(t)?.eminence;
  const need = (def?.minSuccesses ?? 2) + (def?.scaling ? scalingExtra(s, t, eminence ? 5 : 0) : 0);
  if (eminence) {
    t.roundMods.push({ stat: 'E', delta: 2, source: 'Eminence' });
    ev(ctx, { type: 'note', text: `Eminence: ${t.name} has +2 Evasion and counts as +5 Stands for Scaling during this Spellcasting (sk p.27).`, regimentId: t.id });
  }
  // Devoted to Hazlia (od p.21): re-roll results of 6. Jadoo Kavach (sk p.16): spellcasters within 10″ re-roll 6s once per Activation.
  const kavach = !!st && !act.kavach && jadooKavach(s, c);
  if (kavach) act.kavach = true;
  const sixes = (!!c.character && c.character.options.some((o) => o.toLowerCase() === 'devoted to hazlia')) || kavach;
  // RULE-AMBIGUITY: AMB-51 — Spellcasting dice follow Characteristic Tests: 1 always succeeds, 6 always fails.
  const roll = rollTest(ctx, c.dice, { target: att, rerollSixes: sixes }, `${c.name}: ${name}`);
  let successes = roll.passes;
  // Devout (core p.97): a friendly Priest's Spell on this Regiment converts one failed die.
  const devout = c.priest && t.owner === c.owner && (hasRule(t.rules, 'Devout') || !!attachedCharacter(s, t.id)?.rules.some((x) => x.name === 'Devout'));
  if (devout && successes < c.dice) {
    successes += 1;
    roll.record.notes?.push('Devout: one failed die becomes a success');
  }
  if (kavach) roll.record.notes?.push('Jadoo Kavach: 6s re-rolled');
  // Aqueous Branding (Marid Sahar, Apsara; sk p.44–45): a Water Spell at a branded enemy counts one more success.
  if (def?.court === 'Water' && t.owner !== c.owner && t.flags.aqueousBy === c.owner) {
    successes += 1;
    roll.record.notes?.push('Aqueous Branding: +1 success');
  }
  if (t.owner !== c.owner && skUnit(c.regiment)?.aqueousBranding && !c.character) t.flags.aqueousBy = c.owner;
  // Gifted Mortals (sk p.27–28): a friendly Character's Spell on it succeeds as if it scored the successes needed.
  if (c.character && t.owner === c.owner && skUnit(t)?.giftedMortals && successes < need) {
    successes = need;
    roll.record.notes?.push('Gifted Mortals: cast automatically');
  }
  const ok = successes >= need;
  ev(ctx, {
    type: 'dice',
    text: `${c.name} casts ${name} on ${t.name}: ${c.dice} dice at Attunement ${att}${penal ? ' (−1, enemy spellcaster within 10″)' : ''} → ${successes} success${successes === 1 ? '' : 'es'}, needs ${need}${def?.scaling && need > 2 ? ' (Scaling)' : ''} — ${ok ? 'cast' : 'fails'} (core p.80–81).`,
    dice: roll.record,
    player: c.owner,
    regimentId: t.id,
  });
  if (!ok) {
    if (eminence) t.roundMods = t.roundMods.filter((m) => m.source !== 'Eminence');
    return;
  }
  if (!def?.hits) (t.flags.spellsOn ??= []).push(name.toLowerCase());
  if (def) def.apply(ctx, c, t, successes, opts.pool ? { pool: opts.pool } : {});
  else ev(ctx, { type: 'manual', text: `${name} is cast with ${successes} successes: apply its effect with the manual tools.`, player: c.owner, regimentId: t.id });
  if (eminence) t.roundMods = t.roundMods.filter((m) => m.source !== 'Eminence');
  if (st) skAfterCast(ctx, c, def, successes);
  // Unholy Mastery (od p.21): 4+ successes give a free additional Spellcasting, once per Activation.
  if (c.character && successes >= 4 && !act.unholyMastery && c.character.options.some((o) => o.toLowerCase() === 'unholy mastery')) {
    act.unholyMastery = true;
    (act.extra ??= []).push({ kind: 'spell', reason: 'Unholy Mastery', free: true });
    ev(ctx, { type: 'note', text: `Unholy Mastery: ${c.name} may cast another Spell (od p.21).` });
  }
}

/** Jadoo Kavach (sk p.16): a friendly Character with it within 10″ of the spellcaster. */
function jadooKavach(s: GameState, c: Caster): boolean {
  const from = casterPolys(s, c);
  return Object.values(s.characters).some((k) => {
    if (k.destroyed || !k.attachedTo || !k.options.some((o) => o.toLowerCase() === 'jadoo kavach')) return false;
    const host = s.regiments[k.attachedTo];
    return !!host && host.owner === c.owner && host.location === 'table' && distancePolys(regimentPolys(s, host), from) <= 10 + TOL;
  });
}

/**
 * After a successful Spell (Sorcerer Kings): a Ritual Marker for its Court (sk p.5); Shu'laat
 * (sk p.16); Elemental Feedback (sk p.17); Omnipotence's free Spellcasting (sk p.6).
 * RULE-AMBIGUITY: AMB-70 — "every time a Spell is cast" is read as successfully cast.
 */
function skAfterCast(ctx: Ctx, c: Caster, def: SpellDef | undefined, successes: number): void {
  const s = ctx.s;
  const act = s.activation!;
  if (def?.court) addMarkers(ctx, c.owner, 1, def.court, `${c.name} casts a ${def.court} Spell`);
  const opt = (n: string) => !!c.character?.options.some((o) => o.toLowerCase().replace(/[’]/g, "'") === n);
  if (opt("shu'laat") && !act.shulaat && sk(s, c.owner)?.preparing) {
    act.shulaat = true;
    addMarkers(ctx, c.owner, 1, 'any', "Shu'laat (sk p.16)");
  }
  if (opt('elemental feedback') && !act.feedback) {
    act.feedback = true;
    const h = 2 * Math.floor(successes / 2);
    if (h) heal(ctx, c.regiment, h, 'Elemental Feedback (sk p.17)');
  }
  if (c.character && successes >= 4 && !act.omnipotence && warlordHas(s, c.owner, 'Omnipotence')) {
    act.omnipotence = true;
    (act.extra ??= []).push({ kind: 'spell', reason: 'Omnipotence', free: true });
    ev(ctx, { type: 'note', text: `Omnipotence: ${c.name} may make a free additional Spellcasting Action (sk p.6).` });
  }
}

/** Spells a caster could cast now, with legal targets (UI and AI). */
export function castableSpells(s: GameState, casterId: string): { spell: string; targets: string[] }[] {
  const c = casterOf(s, casterId);
  if (!c || c.dice <= 0) return [];
  return c.spells.map((spell) => ({ spell, targets: Object.values(s.regiments).filter((t) => t.location === 'table' && !spellProblems(s, casterId, spell, t.id).length).map((t) => t.id) }));
}
