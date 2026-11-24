import { heal } from './activation';
import { hasLineOfSight, enemiesInContact } from './actions';
import { resolveAttack, stat, charStat } from './combat';
import { ev, rollTest, type Ctx } from './dice';
import { layout } from './formation';
import { rectPoly, type Poly } from './geometry/polygon';
import { TOL } from './geometry/vec';
import type { CharacterState, GameState, PlayerId, PowerPool, RegimentState } from './model/types';
import { attachedCharacter, distancePolys, formationInput, isEngaged, regimentPolys, regimentStandCount } from './queries';
import { hasRule, ruleX } from './rules/special/rules';
import { addPower, darkTierMax, pantheonTier, poolTier, regimentDarkTier, roleOf } from './factions/oldDominion';

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

export interface SpellDef {
  range: number | 'self';
  attunement: number;
  scaling: boolean;
  /** Causes Hits (needs Line of Sight; core p.80). */
  hits: boolean;
  target: 'enemy' | 'friendly' | 'self';
  /** Extra target restrictions. */
  check?: (s: GameState, target: RegimentState) => string | null;
  apply: (ctx: Ctx, caster: Caster, target: RegimentState, successes: number, choice: { pool?: PowerPool }) => void;
}

export interface Caster {
  /** Character id or Regiment id. */
  id: string;
  name: string;
  owner: PlayerId;
  /** The Regiment the caster is in (or is). */
  regiment: RegimentState;
  character?: CharacterState;
  rules: CharacterState['rules'];
  spells: string[];
  /** Priest/Wizard dice. */
  dice: number;
  priest: boolean;
}

const highestTier = (s: GameState, p: PlayerId) => Math.max(poolTier(s, p, 'dark'), pantheonTier(s, p));

function spellHits(ctx: Ctx, caster: Caster, target: RegimentState, hitsIn: number, what: string, pool: { reduceD?: number; defenseOverride?: number } = {}, morale = true): void {
  // Loose Formation (core p.99): Hits from Spells are halved, rounding up.
  const hits = hasRule(target.rules, 'Loose Formation') ? Math.ceil(hitsIn / 2) : hitsIn;
  if (hits !== hitsIn) ev(ctx, { type: 'note', text: `${target.name} has Loose Formation: ${hitsIn} Hits become ${hits} (core p.99).`, regimentId: target.id });
  resolveAttack(ctx, {
    attackerOwner: caster.owner,
    attackerId: caster.regiment.id,
    targetId: target.id,
    arc: 'front', // Spells ignore the flank and rear rules (core p.81)
    pools: [{ label: what, dice: 0, skill: 0, autoHits: hits, ...pool }],
    morale,
    terrifying: 0,
    what,
    kind: 'special',
  });
}

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

export function spellDef(name: string): SpellDef | undefined {
  const k = Object.keys(SPELLS).find((n) => n.toLowerCase() === name.trim().toLowerCase().replace(/[’]/g, "'"));
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
  return { id: r.id, name: r.name, owner: r.owner, regiment: r, rules: r.rules, spells: r.spells ?? [], dice, priest: hasRule(r.rules, 'Priest') || memPriest > 0 };
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

export function scalingExtra(s: GameState, t: RegimentState): number {
  const n = regimentStandCount(s, t);
  return (n >= 10 ? 3 : n >= 7 ? 2 : n >= 4 ? 1 : 0) + (t.type === 'Monster' ? 1 : 0);
}

export function spellProblems(s: GameState, casterId: string, name: string, targetId: string, attunement?: number): string[] {
  const c = casterOf(s, casterId);
  if (!c) return ['Unknown spellcaster.'];
  if (c.dice <= 0) return [`${c.name} has no Wizard (X) or Priest (X) (core p.80).`];
  const act = s.activation;
  if (!act || act.regimentId !== c.regiment.id) return [`${c.name} is not Activating.`];
  if (c.character && act.characterId !== c.character.id) return ["Characters cast Spells during their own Activation (core p.74)."];
  if (c.spells.length && !c.spells.some((x) => x.toLowerCase() === name.toLowerCase())) return [`${c.name} does not know ${name}.`];
  if ((act.spellsCast ?? []).includes(name.toLowerCase())) return ['The same Spell cannot be cast twice in one Activation (core p.76).'];
  if (c.regiment.location !== 'table') return ['The caster must be on the Battlefield.'];
  const t = s.regiments[targetId];
  if (!t || t.location !== 'table') return ['Choose a target on the Battlefield.'];
  const def = spellDef(name);
  if (!def && !(attunement && attunement >= 1 && attunement <= 6)) return [`${name} has no known profile: enter its Attunement (1–6) to cast it; its effect is then manual.`];
  if (def) {
    if (def.target === 'self' && t.id !== c.regiment.id) return [`${name} has Range Self: it targets the caster's own Regiment (core p.80).`];
    if (def.target === 'friendly' && t.owner !== c.owner) return [`${name} targets a friendly Regiment.`];
    if (def.target === 'enemy' && t.owner === c.owner) return [`${name} targets an enemy Regiment.`];
    if (def.range !== 'self' && distancePolys(casterPolys(s, c), regimentPolys(s, t)) > def.range + TOL) return [`${t.name} is beyond ${def.range}″.`];
    if (def.hits) {
      const engaged = enemiesInContact(s, c.regiment);
      if (engaged.length && !engaged.some((e) => e.id === t.id)) return ['An engaged spellcaster may only target the enemy it is in contact with with Hit Spells (core p.80).'];
      if (!engaged.length && !hasLineOfSight(s, c.regiment, t)) return [`${t.name} is not in Line of Sight (core p.80).`];
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
  const need = 2 + (def?.scaling ? scalingExtra(s, t) : 0);
  // Devoted to Hazlia (od p.21): re-roll results of 6.
  const sixes = !!c.character && c.character.options.some((o) => o.toLowerCase() === 'devoted to hazlia');
  // RULE-AMBIGUITY: AMB-51 — Spellcasting dice follow Characteristic Tests: 1 always succeeds, 6 always fails.
  const roll = rollTest(ctx, c.dice, { target: att, rerollSixes: sixes }, `${c.name}: ${name}`);
  let successes = roll.passes;
  // Devout (core p.97): a friendly Priest's Spell on this Regiment converts one failed die.
  const devout = c.priest && t.owner === c.owner && (hasRule(t.rules, 'Devout') || !!attachedCharacter(s, t.id)?.rules.some((x) => x.name === 'Devout'));
  if (devout && successes < c.dice) {
    successes += 1;
    roll.record.notes?.push('Devout: one failed die becomes a success');
  }
  const ok = successes >= need;
  ev(ctx, {
    type: 'dice',
    text: `${c.name} casts ${name} on ${t.name}: ${c.dice} dice at Attunement ${att}${penal ? ' (−1, enemy spellcaster within 10″)' : ''} → ${successes} success${successes === 1 ? '' : 'es'}, needs ${need}${def?.scaling && need > 2 ? ' (Scaling)' : ''} — ${ok ? 'cast' : 'fails'} (core p.80–81).`,
    dice: roll.record,
    player: c.owner,
    regimentId: t.id,
  });
  if (!ok) return;
  if (!def?.hits) (t.flags.spellsOn ??= []).push(name.toLowerCase());
  if (def) def.apply(ctx, c, t, successes, opts.pool ? { pool: opts.pool } : {});
  else ev(ctx, { type: 'manual', text: `${name} is cast with ${successes} successes: apply its effect with the manual tools.`, player: c.owner, regimentId: t.id });
  // Unholy Mastery (od p.21): 4+ successes give a free additional Spellcasting, once per Activation.
  if (c.character && successes >= 4 && !act.unholyMastery && c.character.options.some((o) => o.toLowerCase() === 'unholy mastery')) {
    act.unholyMastery = true;
    (act.extra ??= []).push({ kind: 'spell', reason: 'Unholy Mastery', free: true });
    ev(ctx, { type: 'note', text: `Unholy Mastery: ${c.name} may cast another Spell (od p.21).` });
  }
}

/** Spells a caster could cast now, with legal targets (UI and AI). */
export function castableSpells(s: GameState, casterId: string): { spell: string; targets: string[] }[] {
  const c = casterOf(s, casterId);
  if (!c || c.dice <= 0) return [];
  return c.spells.map((spell) => ({ spell, targets: Object.values(s.regiments).filter((t) => t.location === 'table' && !spellProblems(s, casterId, spell, t.id).length).map((t) => t.id) }));
}
