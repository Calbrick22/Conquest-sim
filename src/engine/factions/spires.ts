import { parseRuleRef } from '../../import/ruleTokens';
import { allocateWounds, resolveAttack, stat } from '../combat';
import { ev, rollN, type Ctx } from '../dice';
import { arcsOf } from '../geometry/arcs';
import { polyDistance } from '../geometry/polygon';
import { TOL } from '../geometry/vec';
import { footprint } from '../formation';
import type { CharacterState, GameState, PlayerId, RegimentState, StatMod, StrainDef } from '../model/types';
import { attachedCharacter, distancePolys, enemiesTouching, formationInput, regimentPolys } from '../queries';
import { hasRule } from '../rules/special/rules';

/**
 * Spires faction rules (Spires army list, 2026 post-Adepticon update; cited as `sp p.N`).
 *
 * - Strains (sp p.5 and each Regiment's entry): the built-in Strain of every Regiment, used when
 *   the owner has not typed one on the list review screen (a typed Strain always wins).
 * - Strain-related rules: Disruptive, Hypersynaptic Bonding, Microbial Shroud, Hypercatalytic
 *   Discharge, Optimized Fodder, Induced Aggression, Linked Neuroreceptors, Degenerative Aura.
 * - Practitioner Actions (sp p.15): the Biomancies and Pheromancies.
 */

const ref = parseRuleRef;
const lc = (x: string) => x.toLowerCase();
const has = (names: readonly string[], n: string) => names.some((x) => lc(x) === lc(n));

interface BuiltInStrain {
  name: string;
  stats?: StrainDef['stats'];
  rules: string[];
}

/** Each Regiment's Strain (sp p.21–33), by entry name. Mechanics only. */
export const SPIRES_STRAINS: Record<string, BuiltInStrain> = {
  'Bound Clones': { name: 'Hypercortical Stimulation', rules: ['Support (+2)'] },
  'Desolation Drones': { name: 'Parasitic Hyperstimulation', rules: ['Deadly Shot'] },
  'Force Grown Drones': { name: 'Apoptotic Spasms', rules: ['Lethal Demise (1)'] },
  'Marksman Clones': { name: 'Ocular Nerve Hyperstimulation', rules: ['Armor Piercing (1)'] },
  'Onslaught Drones': { name: 'Adrenal Hysteria', rules: ['Adrenal Hysteria', 'Linebreaker'] },
  Stryx: { name: 'Telencephalic Lateralization', rules: ['Disruptive'] },
  'Vanguard Clone Infiltrators': { name: 'Hypersynaptic Bonding', rules: ['Hypersynaptic Bonding'] },
  'Vanguard Clones': { name: 'Neuromuscular Overstimulation', stats: { A: 1 }, rules: [] },
  Avatara: { name: 'Induced Hyperkinesis', rules: ['Flawless Strikes'] },
  'Brute Drones': { name: 'Hyperkeratinism', rules: ['Cleave (+1)'] },
  'Incarnate Sentinels': { name: 'Muscular Teratosis', rules: ['Trample (3)'] },
  'Centaur Avatara': { name: 'Hypothalamic Suppression', rules: ['Shock'] },
  'Leonine Avatara': { name: 'Muscular Teratosis', rules: ['Precise Shot'] },
  Abomination: { name: 'Dysthymic Hysteria', rules: ['Relentless Blows'] },
  'Siegebreaker Behemoth': { name: 'Apex Hyperyparixa', rules: ['Juggernaut'] },
  'Pteraphon Surveyor': { name: 'Microbial Shroud', rules: ['Microbial Shroud'] },
  // RULE-AMBIGUITY: AMB-56 — the entry prints Hypercatalytic Discharge without the "Strain -" label;
  // Visceral Bombardment refers to "its Strain Ability", so it is taken as the Strain.
  'Desolation Beast': { name: 'Hypercatalytic Discharge', rules: ['Hypercatalytic Discharge'] },
  'Consumption Beast': { name: 'Halitotic Fetor', rules: ['Dread'] },
};

/** The Strain a Regiment gains: the owner's typed Strain, else the built-in one (sp p.5). */
export function strainFor(s: GameState, r: RegimentState): StrainDef | undefined {
  const typed = s.players[r.owner].strains[r.name];
  if (typed) return typed;
  const b = SPIRES_STRAINS[r.name];
  if (!b) return undefined;
  let rules = b.rules;
  // Optimized Fodder (sp p.24): with 6+ Stands at list building, Lethal Demise (2).
  if (r.name === 'Force Grown Drones' && r.startingStands >= 6) rules = ['Lethal Demise (2)'];
  return { stats: b.stats ?? {}, rules: rules.map((x) => ref(x)), text: `${b.name} (built in)` };
}

export function strainActive(r: RegimentState): boolean {
  return !!r.flags.decay;
}

// ---------------------------------------------------------------- Strain Expression and Decay

function warlordOf(s: GameState, p: PlayerId): CharacterState | undefined {
  return Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p) && !c.destroyed);
}

export function warlordAbility(s: GameState, p: PlayerId, name: string): boolean {
  return has(warlordOf(s, p)?.supremacyAbilities ?? [], name);
}

const isDroneClone = (r: RegimentState) => [...r.roles, ...(r.roundRoles ?? [])].some((x) => /^\[?(drone|clone|monstrosity)\]?$/i.test(x.trim()));

/** Induced Aggression (Pheromancer Warlord, sp p.6): may swap the Strain for +1 Clash (max 4) and +1 March. */
export function canInduceAggression(s: GameState, r: RegimentState): boolean {
  return warlordAbility(s, r.owner, 'Induced Aggression') && isDroneClone(r);
}

/** Wounds a Regiment suffers from Decay (core p.97), after Superior Creations, Optimized Fodder and Induced Aggression. */
export function decayWounds(s: GameState, r: RegimentState): { wounds: number; why: string[] } {
  const why: string[] = [];
  let w = r.type === 'Monster' ? 3 : r.stands.length;
  if (hasRule(r.rules, 'Superior Creations')) {
    w -= 1;
    why.push('Superior Creations −1');
  }
  if (r.name === 'Force Grown Drones' && w > 8) {
    w = 8;
    why.push('Optimized Fodder: at most 8');
  }
  const c = attachedCharacter(s, r.id);
  if (c && c.isWarlord && has(c.supremacyAbilities, 'Induced Aggression')) {
    w = 0;
    why.push('the Pheromancer Warlord is attached (Induced Aggression)');
  }
  return { wounds: Math.max(0, w), why };
}

/** Degenerative Aura (sp p.16): when its Regiment suffers Decay, each engaged enemy suffers Wounds equal to its Stands. */
export function degenerativeAura(ctx: Ctx, r: RegimentState): void {
  const c = attachedCharacter(ctx.s, r.id);
  if (!c || !has(c.options, 'Degenerative Aura')) return;
  for (const e of enemiesTouching(ctx.s, r)) {
    const n = e.stands.length;
    ev(ctx, { type: 'note', text: `Degenerative Aura: ${e.name} suffers ${n} Wounds, no Morale (sp p.16).`, regimentId: e.id });
    allocateWounds(ctx, e, n, r.owner);
  }
}

// ---------------------------------------------------------------- effective rules (from refreshRules)

/** Rules and modifiers from Spires rules, recomputed after every Action. */
export function spiresGrants(s: GameState): void {
  for (const src of Object.values(s.regiments)) {
    if (src.location !== 'table') continue;
    // Disruptive (Stryx Strain, sp p.27): enemies in contact with its front arc suffer −1 Clash (max −1).
    if (hasRule(src.rules, 'Disruptive')) {
      const fp = footprint(formationInput(s, src));
      const mine = regimentPolys(s, src);
      for (const e of enemiesTouching(s, src)) {
        const touchingFront = regimentPolys(s, e).some((p) => mine.some((q) => polyDistance(p, q) <= TOL) && arcsOf(fp, p).includes('front'));
        if (touchingFront && !(e.grantMods ?? []).some((m) => m.source === 'Disruptive')) (e.grantMods ??= []).push({ stat: 'C', delta: -1, source: 'Disruptive' });
      }
    }
  }
  for (const r of Object.values(s.regiments)) {
    const c = attachedCharacter(s, r.id);
    if (!c) continue;
    const o = c.options;
    // Hyperadrenal Stimulation (sp p.16): the attached Regiment gains Counter-Attack.
    if (has(o, 'Hyperadrenal Stimulation') && !hasRule(r.rules, 'Counter-Attack')) r.rules.push(ref('Counter-Attack'));
    // Linked Neuroreceptors (sp p.17): Untouchable while its Strain is active.
    if (has(o, 'Linked Neuroreceptors') && strainActive(r) && !hasRule(r.rules, 'Untouchable')) r.rules.push(ref('Untouchable'));
  }
}

export function spiresCharacterMods(c: CharacterState): StatMod[] {
  // Grafted (sp p.17): +1 Attacks.
  return has(c.options, 'Grafted') ? [{ stat: 'A', delta: 1, source: 'Grafted' }] : [];
}

/** Microbial Shroud (Pteraphon Surveyor Strain, sp p.32): enemies within 8″ cannot Heal, Rally or Combat Rally. */
export function shrouded(s: GameState, r: RegimentState): string | null {
  if (r.location !== 'table') return null;
  const mine = regimentPolys(s, r);
  const src = Object.values(s.regiments).find(
    (e) => e.owner !== r.owner && e.location === 'table' && hasRule(e.rules, 'Microbial Shroud') && distancePolys(regimentPolys(s, e), mine) <= 8 + TOL,
  );
  return src ? src.name : null;
}

// ---------------------------------------------------------------- Practitioner Actions (sp p.15)

export const BIOMANCIES = ['Essence Transfer', 'Unstable Enhancement', 'Catalytic Rupture', 'Grant Virulence'];
export const PHEROMANCIES = ['Induce Vigor', 'Pheromantic Drive', 'Pheromantic Compulsion', 'Siphon Strength'];

/** Practitioner abilities a Character can use: from Practitioner (Biomancy) / (Pheromancy). */
export function practitionerAbilities(c: CharacterState): string[] {
  const out: string[] = [];
  // Listed under Special Rules or, in the Army Builder export, under Actions.
  for (const r of [...c.rules, ...c.actions]) {
    if (lc(r.name) !== 'practitioner') continue;
    if (/biomanc/i.test(r.param ?? '')) out.push(...BIOMANCIES);
    if (/pheromanc/i.test(r.param ?? '')) out.push(...PHEROMANCIES);
  }
  return [...new Set(out)];
}

export function isPractitioner(name: string): boolean {
  return [...BIOMANCIES, ...PHEROMANCIES].some((n) => lc(n) === lc(name));
}

const within = (s: GameState, a: RegimentState, b: RegimentState, d: number) => distancePolys(regimentPolys(s, a), regimentPolys(s, b)) <= d + TOL;

export interface PractitionerChoice {
  targetId?: string;
  /** Essence Transfer: the Regiment that Heals. */
  target2Id?: string;
}

export function practitionerProblems(s: GameState, c: CharacterState, name: string, ch: PractitionerChoice): string[] {
  const r = c.attachedTo ? s.regiments[c.attachedTo] : undefined;
  if (!r || r.location !== 'table') return ['The Character must be on the Battlefield.'];
  if (!practitionerAbilities(c).some((n) => lc(n) === lc(name))) return [`${c.name} cannot use ${name}.`];
  if ((s.activation?.spellsCast ?? []).includes(lc(name))) return ['The same ability cannot be used twice in one Activation (sp p.6).'];
  const n = lc(name);
  if (n === 'pheromantic drive') return [];
  const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
  if (!t || t.location !== 'table') return ['Choose a target Regiment on the Battlefield.'];
  if (!within(s, r, t, 12)) return [`${t.name} is more than 12″ away.`];
  const enemyTarget = n === 'pheromantic compulsion' || n === 'siphon strength' || n === 'grant virulence';
  if (enemyTarget && t.owner === r.owner) return ['Target an enemy Regiment.'];
  if (!enemyTarget && t.owner !== r.owner) return ['Target a friendly Regiment.'];
  // Friendly Regiments can only be the Target of one Practitioner Action per Round (sp p.5).
  if (!enemyTarget && (t.flags.spellsOn ?? []).includes('practitioner')) return [`${t.name} has already been the Target of a Practitioner Action this Round (sp p.5).`];
  if (n === 'pheromantic compulsion' && t.type !== 'Monster') return ['Pheromantic Compulsion targets an enemy Monster Regiment.'];
  if (n === 'unstable enhancement' && t.type === 'Monster') return ['Unstable Enhancement targets a non-Monster Regiment.'];
  if (n === 'essence transfer') {
    const t2 = ch.target2Id ? s.regiments[ch.target2Id] : undefined;
    if (!t2 || t2.owner !== r.owner || t2.id === t.id || t2.type === 'Monster' || t2.location !== 'table' || !within(s, r, t2, 12)) return ['Choose a second, friendly non-Monster Regiment within 12″ to Heal.'];
  }
  return [];
}

export function applyPractitioner(ctx: Ctx, c: CharacterState, name: string, ch: PractitionerChoice, heal: (ctx: Ctx, r: RegimentState, n: number, why: string) => void): void {
  const s = ctx.s;
  const r = s.regiments[c.attachedTo!]!;
  const n = lc(name);
  (s.activation!.spellsCast ??= []).push(n);
  const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
  if (t && t.owner === r.owner) (t.flags.spellsOn ??= []).push('practitioner');
  const roll = (k: number, why: string) => {
    const idx = ctx.rng.index;
    const v = rollN(ctx, k);
    ev(ctx, { type: 'dice', text: `${c.name}, ${name}: rolled ${v.join(', ')}.`, dice: { purpose: why, seed: ctx.rng.seed, index: idx, values: v }, player: r.owner });
    return v;
  };
  const hits = (target: RegimentState, k: number, ap: number, what: string) =>
    resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: target.id, arc: 'front', pools: [{ label: what, dice: 0, skill: 0, autoHits: k, reduceD: ap }], morale: false, terrifying: 0, what, kind: 'special' });
  switch (n) {
    case 'induce vigor':
      t!.roundRules.push(ref('Untouchable'));
      ev(ctx, { type: 'action', text: `Induce Vigor: ${t!.name} gains Untouchable until the end of the Round (sp p.15).`, regimentId: t!.id });
      return;
    case 'pheromantic drive':
      r.roundRules.push(ref('Tenacious (1)'), ref('Pheromantic Drive'));
      ev(ctx, { type: 'action', text: `Pheromantic Drive: ${r.name} gains Tenacious (1); friendly [Drone] and [Clone] Regiments within 12″ re-roll failed Resolve rolls of 6 this Round (sp p.15).`, regimentId: r.id });
      return;
    case 'pheromantic compulsion':
      t!.flags.compelled = true;
      ev(ctx, { type: 'action', text: `Pheromantic Compulsion: ${t!.name} counts as 0 Stands for Seizing or Contesting this Round (sp p.15).`, regimentId: t!.id });
      return;
    case 'siphon strength':
      t!.flags.siphoned = true;
      ev(ctx, { type: 'action', text: `Siphon Strength: ${t!.name} cannot be Inspired or Aimed this Round (sp p.15).`, regimentId: t!.id });
      return;
    case 'essence transfer': {
      const v = roll(2, 'Essence Transfer');
      const w = Math.min(...v);
      ev(ctx, { type: 'action', text: `Essence Transfer: ${t!.name} suffers ${w} Wounds, no Morale (sp p.15).`, regimentId: t!.id });
      allocateWounds(ctx, t!, w, r.owner === 'P1' ? 'P2' : 'P1');
      const t2 = s.regiments[ch.target2Id!]!;
      heal(ctx, t2, 4, 'Essence Transfer');
      return;
    }
    case 'unstable enhancement': {
      const [d] = roll(1, 'Unstable Enhancement') as [number];
      const k = d <= 2 ? 'M' : d <= 4 ? 'C' : 'V';
      // +1 Clash or Volley to a maximum of 4.
      const delta = k === 'M' ? 1 : Math.max(0, Math.min(1, 4 - stat(t!, k)));
      if (delta) t!.roundMods.push({ stat: k, delta, source: 'Unstable Enhancement' });
      ev(ctx, { type: 'action', text: `Unstable Enhancement: ${t!.name} ${delta ? `+1 ${k === 'M' ? 'March' : k === 'C' ? 'Clash' : 'Volley'}` : `already has ${k} 4 (no change)`} until the end of the Round (sp p.15).`, regimentId: t!.id });
      return;
    }
    case 'catalytic rupture': {
      const v = roll(2, 'Catalytic Rupture');
      const k = Math.max(...v);
      for (const e of enemiesTouching(s, t!)) {
        ev(ctx, { type: 'action', text: `Catalytic Rupture: ${e.name} suffers ${k} Hits with Armor Piercing (1), no Morale (sp p.15).`, regimentId: e.id });
        hits(e, k, 1, 'Catalytic Rupture');
      }
      return;
    }
    case 'grant virulence': {
      const [d] = roll(1, 'Grant Virulence') as [number];
      ev(ctx, { type: 'action', text: `Grant Virulence: ${t!.name} suffers ${d} Hits with Armor Piercing (${6 - d}), no Morale (sp p.15).`, regimentId: t!.id });
      hits(t!, d, 6 - d, 'Grant Virulence');
      return;
    }
  }
}

/** Pheromancer / Biomancer Warlord: a free additional Practitioner Action each Activation (sp p.6). */
export function spiresActivationStart(ctx: Ctx): void {
  const act = ctx.s.activation;
  if (!act?.characterId) return;
  const c = ctx.s.characters[act.characterId]!;
  if (c.isWarlord && (has(c.supremacyAbilities, 'Induced Aggression') || has(c.supremacyAbilities, 'Field Studies')) && practitionerAbilities(c).length)
    (act.extra ??= []).push({ kind: 'ability', reason: 'Practitioner (Warlord)', free: true });
}

/** Pheromantic Drive aura: a friendly [Drone]/[Clone] within 12″ of a Regiment with it re-rolls failed Resolve rolls of 6. */
export function pheromanticDrive(s: GameState, r: RegimentState): boolean {
  if (!/drone|clone/i.test([...r.roles, ...(r.roundRoles ?? [])].join(' '))) return false;
  return Object.values(s.regiments).some((x) => x.owner === r.owner && x.location === 'table' && hasRule(x.roundRules, 'Pheromantic Drive') && within(s, x, r, 12));
}
