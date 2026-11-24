import type { RuleRef } from '../../import/types';
import { parseRuleRef } from '../../import/ruleTokens';
import { ev, type Ctx } from '../dice';
import type { CharacterState, GameState, OdPlayerState, PlayerId, PowerPool, RegimentState, StandState, StatMod } from '../model/types';
import { attachedCharacter, distancePolys, isEngaged, regimentPolys } from '../queries';
import { hasRule } from '../rules/special/rules';
import { TOL } from '../geometry/vec';

/**
 * Old Dominion faction rules (Old Dominion army list, 2026 "Tainted Earth" update; page numbers
 * are the PDF pages, cited as `od p.N`). Mechanics only: names, values and text come from the
 * uploaded list at runtime, except the faction mechanics implemented here.
 *
 * - Animate Vessel (od p.5): Terrifying (1), Brittle, no Inspire Action, no Resolve (always passes
 *   Morale and Resolve tests), a Character with it lends no Resolve.
 * - Memories of Old (od p.5): an Action giving the listed rules until the end of the Round.
 * - Empowerment (od p.6): Power Tokens, the Dark Power and Fallen Pantheon pools, Tiers.
 * - Blasphemous Soma (od p.6): +1 Power Token each Round before the Supremacy Phase.
 * - Dark Power Pool (od p.7) and Fallen Pantheon (od p.7) Tier effects.
 */

const ref = (raw: string): RuleRef => parseRuleRef(raw);
const lc = (x: string) => x.toLowerCase();
const has = (names: readonly string[], n: string) => names.some((x) => lc(x) === lc(n));

export function isOldDominion(s: GameState, p: PlayerId): boolean {
  if (/old dominion/i.test(s.players[p].faction)) return true;
  return Object.values(s.regiments).some((r) => r.owner === p && hasRule(r.baseRules, 'Animate Vessel'));
}

export function od(s: GameState, p: PlayerId): OdPlayerState | undefined {
  return s.players[p].od;
}

export function initOldDominion(s: GameState): void {
  for (const p of ['P1', 'P2'] as const) if (isOldDominion(s, p)) s.players[p].od = { dark: 0, pantheon: 0, pref: 'dark', pantheonReached: 1, onceUsed: [] };
}

// ---------------------------------------------------------------- Warlord and Tiers

export function warlord(s: GameState, p: PlayerId): CharacterState | undefined {
  return Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p));
}

export function warlordHas(s: GameState, p: PlayerId, ability: string): boolean {
  return has(warlord(s, p)?.supremacyAbilities ?? [], ability);
}

/** Tier IV of the Dark Power Pool is reachable with these Supremacy Abilities (od p.6, p.9–10). */
export function allowsTierIV(s: GameState, p: PlayerId): boolean {
  return ['Obdurate Bone and Stone', 'Master of the Legions', 'Glimmers of a Golden Age'].some((a) => warlordHas(s, p, a));
}

/**
 * Tier thresholds (od p.6): Tier II from 9 Tokens, Tier III from 18, Tier IV from 23, at 2,000
 * points; each threshold moves by 2 for every full 250 points above or below 2,000.
 */
// RULE-AMBIGUITY: AMB-45 — "Tier III is between 18-22+": 23 or more stays Tier III unless Tier IV is allowed.
export function tierThresholds(points: number | null): [number, number, number] {
  const pts = points ?? 2000;
  const steps = Math.trunc((pts - 2000) / 250);
  return [9 + 2 * steps, 18 + 2 * steps, 23 + 2 * steps];
}

export function poolTier(s: GameState, p: PlayerId, pool: PowerPool): number {
  const o = od(s, p);
  if (!o) return 0;
  const n = pool === 'dark' ? o.dark : o.pantheon;
  const [t2, t3, t4] = tierThresholds(s.players[p].points);
  if (pool === 'dark' && n >= t4 && allowsTierIV(s, p)) return 4;
  return n >= t3 ? 3 : n >= t2 ? 2 : 1;
}

/** The Fallen Divinity Regiment of a player, if it is on the Battlefield and is the Warlord. */
export function fallenDivinity(s: GameState, p: PlayerId): RegimentState | undefined {
  const w = warlord(s, p);
  if (!w || w.destroyed || !w.embodied || !w.attachedTo) return undefined;
  const r = s.regiments[w.attachedTo];
  return r && hasRule(r.baseRules, 'Font of Dark Power') ? r : undefined;
}

export function isFallenDivinity(r: RegimentState): boolean {
  return hasRule(r.baseRules, 'Font of Dark Power');
}

/** Fallen Pantheon Tier (od p.7): only when the Fallen Divinity is the Warlord. */
export function pantheonTier(s: GameState, p: PlayerId): number {
  const w = warlord(s, p);
  if (!w || !w.embodied || !w.attachedTo || !s.regiments[w.attachedTo] || !isFallenDivinity(s.regiments[w.attachedTo]!)) return 0;
  return poolTier(s, p, 'pantheon');
}

export function isAnimateVessel(r: RegimentState): boolean {
  return hasRule(r.baseRules, 'Animate Vessel') || hasRule(r.rules, 'Animate Vessel');
}

export function charIsAnimateVessel(c: CharacterState): boolean {
  return hasRule(c.baseRules, 'Animate Vessel');
}

export function roleOf(r: RegimentState, role: string): boolean {
  return [...r.roles, ...(r.roundRoles ?? []), ...(r.grantRoles ?? [])].some((x) => lc(x.replace(/[[\]]/g, '').replace(/^the\s+/i, '')) === lc(role.replace(/^the\s+/i, '')));
}

/**
 * The Dark Power Tier a Regiment is under (od p.6–7): the pool's Tier plus "counts as Tier +1"
 * effects, for Regiments with Animate Vessel only. The Fallen Divinity is not affected (od p.8).
 */
export function regimentDarkTier(s: GameState, r: RegimentState): number {
  if (!od(s, r.owner) || !isAnimateVessel(r) || isFallenDivinity(r)) return 0;
  const max = allowsTierIV(s, r.owner) ? 4 : 3;
  let bonus = r.flags.tierBonus ?? 0;
  const c = attachedCharacter(s, r.id);
  // Legio I 'Primigenia' (Treasure): the attached Regiment counts as Tier +1.
  if (c && c.options.some((o) => /^legio i\b/i.test(o))) bonus += 1;
  return Math.min(max, poolTier(s, r.owner, 'dark') + bonus);
}

export function darkTierMax(s: GameState, p: PlayerId): number {
  return allowsTierIV(s, p) ? 4 : 3;
}

function within12OfFD(s: GameState, r: RegimentState): boolean {
  const fd = fallenDivinity(s, r.owner);
  if (!fd || fd.location !== 'table' || r.location !== 'table') return false;
  return fd.id === r.id || distancePolys(regimentPolys(s, fd), regimentPolys(s, r)) <= 12 + TOL;
}

// ---------------------------------------------------------------- Power Tokens

export type PendingPower = { player: PlayerId; pool: PowerPool | 'choice'; n: number; why: string; divineShard?: boolean };

/** Queue Power Tokens; they are added at the end of the Action (od p.6), after Morale Tests. */
export function queuePower(ctx: Ctx, p: PlayerId, n: number, why: string, pool: PowerPool | 'choice' = 'choice', divineShard = false): void {
  if (!od(ctx.s, p) || n <= 0) return;
  (ctx.power ??= []).push({ player: p, pool, n, why, divineShard });
}

/** Adds Power Tokens now (Blasphemous Soma, spells, Draw Events). */
export function addPower(ctx: Ctx, p: PlayerId, n: number, why: string, pool?: PowerPool): void {
  const o = od(ctx.s, p);
  if (!o || n <= 0) return;
  const to = pool ?? o.pref;
  // RULE-AMBIGUITY: AMB-49 — without a Fallen Divinity Warlord, Tokens go to the Dark Power Pool.
  if (to === 'pantheon' && pantheonTier(ctx.s, p) === 0) {
    o.dark += n;
    ev(ctx, { type: 'power', text: `${p} gains ${n} Power Token${n > 1 ? 's' : ''} (${why}) in the Dark Power Pool (no Fallen Divinity Warlord): ${o.dark} Dark Power, ${o.pantheon} Fallen Pantheon.`, player: p });
  } else {
    if (to === 'dark') o.dark += n;
    else o.pantheon += n;
    ev(ctx, { type: 'power', text: `${p} gains ${n} Power Token${n > 1 ? 's' : ''} (${why}) in the ${to === 'dark' ? 'Dark Power' : 'Fallen Pantheon'} Pool: ${o.dark} Dark Power, ${o.pantheon} Fallen Pantheon.`, player: p });
  }
  afterPowerChange(ctx, p);
}

/** Spend Power Tokens from the Dark Power Pool. Returns false if there are not enough. */
export function spendPower(ctx: Ctx, p: PlayerId, n: number, why: string): boolean {
  const o = od(ctx.s, p);
  if (!o || o.dark < n) return false;
  o.dark -= n;
  ev(ctx, { type: 'power', text: `${p} spends ${n} Dark Power Token${n > 1 ? 's' : ''} (${why}): ${o.dark} left.`, player: p });
  afterPowerChange(ctx, p);
  return true;
}

/** Called after an Action: allocate queued Power Tokens. */
export function flushPower(ctx: Ctx): void {
  const q = ctx.power ?? [];
  ctx.power = [];
  for (const e of q) {
    const o = od(ctx.s, e.player);
    if (!o) continue;
    const pool: PowerPool = e.pool === 'choice' ? o.pref : e.pool;
    const n = e.n + (e.divineShard && pool === 'pantheon' && pantheonTier(ctx.s, e.player) > 0 ? e.n : 0);
    addPower(ctx, e.player, n, e.why + (n > e.n ? ', Divine Shard' : ''), pool);
  }
}

/**
 * A Stand was removed (od p.6): a Regiment with Animate Vessel gives 1 Power Token; Acolytes
 * (od p.22): 2 more when the Command Stand is destroyed; Undying Devotion: 1 more. Font of Dark
 * Power (od p.13): Tokens from friendly Regiments within 12″ of the Fallen Divinity go to the
 * Fallen Pantheon Pool. Divine Shard (od p.27): one more Token when that happens.
 */
export function onStandLost(ctx: Ctx, r: RegimentState, st: StandState): void {
  const s = ctx.s;
  if (od(s, r.owner)) {
    const pool: PowerPool | 'choice' = within12OfFD(s, r) ? 'pantheon' : 'choice';
    const shard = hasRule(r.rules, 'Divine Shard');
    const mult = ctx.doublePower ? 2 : 1;
    if (isAnimateVessel(r)) queuePower(ctx, r.owner, mult, `${r.name} lost a Stand`, pool, shard);
    if (st.isCommand && hasRule(r.rules, 'Acolytes')) queuePower(ctx, r.owner, 2, `Acolytes: ${r.name}'s Command Stand`, pool);
    if (r.flags.undyingDevotion) queuePower(ctx, r.owner, 1, `Undying Devotion: ${r.name}`, pool);
  }
  // Exploitation of Divine Vanity: 1 Power Token for every two enemy Stands destroyed this Activation.
  const act = s.activation;
  if (act) {
    const actor = s.regiments[act.regimentId];
    if (actor && actor.owner !== r.owner) {
      act.enemyStandsDestroyed = (act.enemyStandsDestroyed ?? 0) + 1;
      if (actor.roundRules.some((x) => x.name === 'Harvest of Vanity') && act.enemyStandsDestroyed % 2 === 0) queuePower(ctx, actor.owner, 1, 'Exploitation of Divine Vanity');
    }
  }
}

/** The Fallen Divinity is destroyed: Fallen Pantheon Tokens move to the Dark Power Pool (od p.8). */
export function onRegimentDestroyed(ctx: Ctx, r: RegimentState): void {
  const o = od(ctx.s, r.owner);
  if (!o || !isFallenDivinity(r)) return;
  if (o.pantheon) {
    o.dark += o.pantheon;
    ev(ctx, { type: 'power', text: `The Fallen Divinity is destroyed: ${o.pantheon} Fallen Pantheon Tokens move to the Dark Power Pool (${o.dark}).`, player: r.owner });
    o.pantheon = 0;
  }
}

/**
 * The Fallen Divinity uses the profile of its Fallen Pantheon Tier, keeping its Wounds, and Heals
 * 4 (Tier II) or 6 (Tier III) the first time it reaches each (od p.7). The profiles for Tiers II
 * and III are entered by the owner on the list review screen.
 */
export function afterPowerChange(ctx: Ctx, p: PlayerId): void {
  const s = ctx.s;
  const o = od(s, p);
  const fd = fallenDivinity(s, p);
  if (!o || !fd || !fd.tierBase) return;
  const tier = pantheonTier(s, p);
  const def = tier >= 2 ? s.players[p].tierProfiles?.[fd.name]?.[String(tier)] : undefined;
  if (tier >= 2 && !def) {
    if (o.pantheonReached < tier) ev(ctx, { type: 'manual', text: `${fd.name} reaches Fallen Pantheon Tier ${tier}: no Tier ${tier} profile was entered on the list review screen, so update its profile with the manual tools.`, player: p });
  }
  fd.profile = { ...fd.tierBase.profile, ...(def?.stats ?? {}) };
  fd.baseRules = def && def.rules.length ? [...def.rules, ...fd.tierBase.rules.filter((x) => !def.rules.some((d) => lc(d.name) === lc(x.name)))] : [...fd.tierBase.rules];
  if (tier > o.pantheonReached) {
    const heal = tier >= 3 ? 6 : 4;
    for (let t = o.pantheonReached + 1; t <= tier; t++) {
      const h = t >= 3 ? 6 : 4;
      const st = fd.stands[0];
      if (st) st.wounds = Math.max(0, st.wounds - h);
    }
    ev(ctx, { type: 'heal', text: `${fd.name} reaches Fallen Pantheon Tier ${tier}${def ? ' and uses that profile' : ''}; it Heals ${heal} Wounds (od p.7).`, player: p, regimentId: fd.id });
    o.pantheonReached = tier;
  }
}

/** Blasphemous Soma (od p.6): before the Supremacy Phase, +1 Power Token to a pool of choice. */
export function blasphemousSoma(ctx: Ctx): void {
  for (const p of ['P1', 'P2'] as const) if (od(ctx.s, p)) addPower(ctx, p, 1, 'Blasphemous Soma');
}

export function beginRoundOd(s: GameState): void {
  for (const p of ['P1', 'P2'] as const) {
    const o = od(s, p);
    if (o) {
      o.onceUsed = [];
      o.supremacyThisRound = false;
    }
  }
  for (const r of Object.values(s.regiments)) {
    r.roundRoles = [];
    r.flags.memories = false;
    r.flags.tierBonus = 0;
    r.flags.noBrittle = false;
    r.flags.seizeBonus = 0;
    r.flags.rerollMoraleSuccesses = false;
    r.flags.undyingDevotion = false;
    r.flags.charge2d6 = false;
    r.flags.spellsOn = [];
  }
  for (const c of Object.values(s.characters)) c.sacrament = false;
}

// ---------------------------------------------------------------- effective rules (called from refreshRules)

export interface OdGrants {
  rules: RuleRef[];
  drawEvents: string[];
  mods: StatMod[];
  removeBrittle: boolean;
  roles: string[];
}

/** Faction rules granted to a Regiment (od p.5–21). */
export function odRegimentGrants(s: GameState, r: RegimentState): OdGrants {
  const g: OdGrants = { rules: [], drawEvents: [], mods: [], removeBrittle: false, roles: [] };
  if (!od(s, r.owner)) return g;
  const av = isAnimateVessel(r);
  const c = attachedCharacter(s, r.id);
  const copts = c ? c.options : [];
  const officers = [...r.commandModels, ...(r.options ?? [])];
  const hasCmd = r.stands.some((x) => x.isCommand);
  // Animate Vessel (od p.5): Terrifying (1) and Brittle.
  if (av) {
    if (!hasRule(r.baseRules, 'Terrifying')) g.rules.push(ref('Terrifying (1)'));
    if (!isFallenDivinity(r)) g.rules.push(ref('Brittle'));
  }
  // Officers (od p.31).
  if (hasCmd && has(officers, 'Profane Reliquary')) g.rules.push(ref('Aura of Death (1)'));
  if (hasCmd && has(officers, 'Optio')) g.rules.push(ref('Vanguard (4)'));
  // Dark Power Pool (od p.7): Tier III and above, Inspired.
  // RULE-AMBIGUITY: AMB-46 — only Animate Vessel Regiments (the pool "only affects" them).
  const tier = regimentDarkTier(s, r);
  if (tier >= 3) g.rules.push(ref('Inspired'));
  // Reign of Terror (Theokrator, od p.10): [The Creed] / [The Legion] Animate Vessels gain Terrifying (+1) at Tier III.
  if (tier >= 3 && warlordHas(s, r.owner, 'Reign of Terror') && (roleOf(r, 'Creed') || roleOf(r, 'Legion'))) g.rules.push(ref('Terrifying (+1)'));
  // Supremacy Abilities [Always Active].
  if (warlordHas(s, r.owner, 'Blasphemous Mesa')) g.rules.push(ref('Aura of Death (+1)'));
  if (warlordHas(s, r.owner, 'Divinity Grace')) {
    g.removeBrittle = true;
    if (/^(cultists|hashashin)$/i.test(r.name)) g.roles.push('The Fallen Pantheon');
  }
  if (warlordHas(s, r.owner, 'Obdurate Bone and Stone') && roleOf(r, 'Legion')) {
    if (r.cls === 'Medium') g.rules.push(ref('Vanguard (2)'));
    if (r.cls === 'Heavy') g.rules.push(ref('Vanguard (4)'));
  }
  if (r.flags.noBrittle) g.removeBrittle = true;
  // Fallen Pantheon Tier effects through Font of Dark Power (od p.7).
  const pt = pantheonTier(s, r.owner);
  if (pt >= 2 && !isFallenDivinity(r) && av && roleOf(r, 'Fallen Pantheon') && within12OfFD(s, r)) g.mods.push({ stat: 'A', delta: pt >= 3 ? 2 : 1, source: 'Font of Dark Power' });
  if (pt >= 3 && !isFallenDivinity(r) && av && within12OfFD(s, r)) g.rules.push(ref('Inspired'));
  // Treasures and Dark Blessings bought by the attached Character (od p.17–21).
  if (c) {
    if (has(copts, 'Caelestine Banner')) g.rules.push(ref('Inspired'));
    if (has(copts, 'Armor of the Living Saint')) g.roles.push('The Creed');
    if (has(copts, 'Aventine Armor')) g.roles.push('The Fallen Pantheon');
    if (has(copts, 'Skofnung')) g.rules.push(ref('Linebreaker'));
    if (has(copts, 'Aura of Malice')) g.rules.push(ref('Dread'));
    if (has(copts, 'Eternal Discipline')) g.rules.push(ref('Untouchable'));
    if (has(copts, 'Viaticum')) {
      g.roles.push('The Fallen Pantheon');
      g.rules.push(ref('Bodyguards'));
    }
    if (has(copts, 'Kentarch') && (poolTier(s, r.owner, 'dark') >= 3 || pt >= 3)) g.rules.push(ref('Inspired'));
    if (has(copts, 'Grave Step')) g.mods.push({ stat: 'M', delta: Math.max(poolTier(s, r.owner, 'dark'), pt) >= 3 ? 2 : 1, source: 'Grave Step' });
    if (has(copts, 'Vexilla of the Lost') && r.type !== 'Monster') g.rules.push(ref('Flank'));
    if (has(copts, 'Strength and Honor') && (tier >= 3 || has(copts, 'Caelestine Banner'))) g.removeBrittle = true;
  }
  // The Fallen Divinity's own Eternal Discipline / Aura of Malice (od p.21).
  if (r.embodies) {
    const ec = s.characters[r.embodies];
    if (ec && has(ec.options, 'Eternal Discipline')) g.rules.push(ref('Untouchable'));
    if (ec && has(ec.options, 'Aura of Malice')) g.rules.push(ref('Dread'));
  }
  const fd = fallenDivinity(s, r.owner);
  if (fd && fd.id !== r.id && has(s.characters[fd.embodies!]?.options ?? [], 'Aura of Malice') && roleOf(r, 'Fallen Pantheon') && r.stands.length >= 4 && within12OfFD(s, r)) g.rules.push(ref('Dread'));
  // Memories of Old as a Draw Event (od p.7): Dark Power Tier II, or a [The Fallen Pantheon]
  // Regiment within 12″ of the Fallen Divinity at Fallen Pantheon Tier II.
  if ((r.memories?.length || r.memoriesText) && (tier >= 2 || (pt >= 2 && roleOf(r, 'Fallen Pantheon') && within12OfFD(s, r) && !isFallenDivinity(r)))) g.drawEvents.push('Memories of Old');
  return g;
}

/** Faction rules granted to a Character (od p.8–21). */
export function odCharacterGrants(s: GameState, c: CharacterState): { rules: RuleRef[]; drawEvents: string[]; mods: StatMod[] } {
  const p = c.id.slice(0, 2) as PlayerId;
  const g = { rules: [] as RuleRef[], drawEvents: [] as string[], mods: [] as StatMod[] };
  if (!od(s, p)) return g;
  const o = c.options;
  if (charIsAnimateVessel(c) && !hasRule(c.baseRules, 'Terrifying')) g.rules.push(ref('Terrifying (1)'));
  if (has(o, 'Vexilla of the Lost')) g.rules.push(ref('Forward Force'));
  if (has(o, 'Caelestine Banner')) g.rules.push(ref('Inspired'));
  if (has(o, 'Armor of the Living Saint')) g.rules.push(ref('Priest (1)'));
  if (has(o, 'Unholy Sacrament')) g.drawEvents.push('Unholy Sacrament');
  if (has(o, 'Consecrated Mitre')) g.rules.push(ref(`Priest (+${poolTier(s, p, 'dark')})`));
  if (has(o, 'Calamitas')) {
    g.mods.push({ stat: 'A', delta: 1, source: 'Calamitas' });
    g.rules.push(ref('Cleave (+1)'));
  }
  if (has(o, 'Harvest of the Fallen')) g.mods.push({ stat: 'A', delta: poolTier(s, p, 'dark'), source: 'Harvest of the Fallen' });
  if (has(o, 'Skofnung')) g.rules.push(ref('Cleave (+1)'));
  if (has(o, 'Eleutherea')) g.mods.push({ stat: 'C', delta: 1, source: 'Eleutherea' });
  if (has(o, 'Gladiator')) g.rules.push(ref('Flurry'), ref('Deadly Blades'), ref('Parry'));
  if (has(o, 'Schemophore')) g.drawEvents.push('Dark Shepherd');
  if (has(o, 'Kentarch') && (poolTier(s, p, 'dark') >= 3 || pantheonTier(s, p) >= 3)) g.rules.push(ref('Inspired'));
  if (c.isWarlord && warlordHas(s, p, 'Blasphemous Mesa')) g.drawEvents.push('Blasphemous Mesa');
  return g;
}

// ---------------------------------------------------------------- Animate Vessel and Morale

/** Animate Vessel (od p.5): no Resolve; always passes Morale and Resolve tests. */
export function autoPassesResolve(r: RegimentState): boolean {
  return isAnimateVessel(r);
}

/**
 * Does this Regiment re-roll successful Morale Tests? Dark Power Tier IV (od p.7): enemies engaged
 * with a friendly Animate Vessel under Tier IV. Also Exploitation of Divine Vanity and similar.
 */
export function rerollsMoraleSuccesses(s: GameState, r: RegimentState): boolean {
  if (r.flags.rerollMoraleSuccesses) return true;
  if (!isEngaged(s, r)) return false;
  const polys = regimentPolys(s, r);
  return Object.values(s.regiments).some(
    (e) => e.owner !== r.owner && e.location === 'table' && regimentDarkTier(s, e) >= 4 && distancePolys(regimentPolys(s, e), polys) <= TOL,
  );
}

// ---------------------------------------------------------------- Memories of Old (od p.5)

export function hasMemories(r: RegimentState): boolean {
  return !!(r.memories?.length || r.memoriesText);
}

/** Memories of Old: the Regiment gains the listed rules until the end of the Round (od p.5). */
export function activateMemories(ctx: Ctx, r: RegimentState, how: string): void {
  if (r.flags.memories) return;
  r.flags.memories = true;
  for (const m of r.memories ?? []) {
    // Bastion is a Defense bonus (core p.94).
    if (m.name.toLowerCase() === 'bastion') r.roundMods.push({ stat: 'D', delta: m.x ?? 1, source: 'Bastion' });
    else r.roundRules.push(m);
  }
  const text = r.memoriesText ?? '';
  // Text-only effects implemented from the rule text in the list:
  // - a free Spellcasting Action by the Regiment with Priest (2 per Stand, max 12) (Kheres, Moroi);
  // - the Command Stand counts as +1 Stands for Seizing (Legionnaires).
  const casts = /spellcasting/i.test(text);
  if (casts && ctx.s.activation?.regimentId === r.id) (ctx.s.activation.extra ??= []).push({ kind: 'spell', reason: 'Memories of Old', free: true });
  const manual = text && !casts && !/seizing/i.test(text);
  ev(ctx, {
    type: 'action',
    text: `${r.name} uses Memories of Old${how ? ` ${how}` : ''}: ${r.memories?.length ? `gains ${r.memories.map((x) => x.raw).join(', ')}` : ''}${text ? `${r.memories?.length ? '; ' : ''}${text}${manual ? ' (manual)' : ''}` : ''} until the end of the Round (od p.5).`,
    player: r.owner,
    regimentId: r.id,
  });
  // Dark Cenotaph (od p.31): +1 Dark Power Token when Memories of Old is used as a Draw Event.
  if (how === 'as a Draw Event' && r.stands.some((x) => x.isCommand) && has([...r.commandModels, ...(r.options ?? [])], 'Dark Cenotaph')) addPower(ctx, r.owner, 1, 'Dark Cenotaph', 'dark');
}

/** Seizing bonus for a Stand of this Regiment (Legionnaires' Memories of Old, Exhortation). */
export function seizeBonusFor(r: RegimentState, isCommandStand: boolean): number {
  let b = 0;
  if (isCommandStand && r.flags.memories && /seizing/i.test(r.memoriesText ?? '')) b += 1;
  return b;
}

/**
 * Unhallowed Ground (od p.15, p.30): counts as six Stands toward the total in range of an
 * Objective Zone, but none toward Seizing; cannot be Healed.
 */
export function unhallowed(r: RegimentState): boolean {
  return hasRule(r.rules, 'Unhallowed Ground');
}

// ---------------------------------------------------------------- Legion Supremacy helpers

/**
 * Glimmers of a Golden Age (Mounted Strategos, od p.10): once per Round, a [The Legion] Clash or
 * Charge converts 1+X failed Hits into successes, X = the Dark Power Tier (IV after the [Activated]
 * part). RULE-AMBIGUITY: AMB-41 — used automatically on the first such Action each Round.
 */
export function takeGlimmers(s: GameState, r: RegimentState): number {
  const o = od(s, r.owner);
  if (!o || !warlordHas(s, r.owner, 'Glimmers of a Golden Age') || !roleOf(r, 'Legion') || o.onceUsed.includes('glimmers')) return 0;
  o.onceUsed.push('glimmers');
  const x = o.onceUsed.includes('glimmers-iv') ? 4 : poolTier(s, r.owner, 'dark');
  return 1 + x;
}

/**
 * Obdurate Bone and Stone (Xhiliarch, od p.10): once per Round, a [The Legion] Charge adds +X to
 * its Charge Distance, X = the Dark Power Tier. RULE-AMBIGUITY: AMB-41 — the engine always picks
 * this option, on the first [The Legion] Charge each Round.
 */
export function xhiliarchChargeBonus(s: GameState, r: RegimentState): number {
  const o = od(s, r.owner);
  if (!o || !warlordHas(s, r.owner, 'Obdurate Bone and Stone') || !roleOf(r, 'Legion') || o.onceUsed.includes('obdurate')) return 0;
  return poolTier(s, r.owner, 'dark');
}

export function markOnce(s: GameState, p: PlayerId, key: string): void {
  od(s, p)?.onceUsed.push(key);
}
