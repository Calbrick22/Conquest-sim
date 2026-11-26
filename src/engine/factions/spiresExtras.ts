import { parseRuleRef } from '../../import/ruleTokens';
import { allocateWounds, resolveAttack } from '../combat';
import { ev, rollN, type Ctx } from '../dice';
import { arcsOf } from '../geometry/arcs';
import { polyDistance } from '../geometry/polygon';
import { TOL } from '../geometry/vec';
import { footprint } from '../formation';
import type { CharacterState, GameState, PlayerId, RegimentState } from '../model/types';
import { attachedCharacter, distancePolys, enemiesTouching, formationInput, isEngaged, marchAllowance, regimentPolys } from '../queries';
import { hasRole } from '../rules/special/grants';
import { hasRule } from '../rules/special/rules';
import { strainFor } from './spires';

/**
 * Spires rules beyond Strains and Practitioner Actions (Spires army list, 2026 post-Adepticon;
 * cited as sp p.N, the PDF page). Mechanics only; names are the faction's.
 */

const lc = (x: string) => x.toLowerCase().replace(/[’]/g, "'");
const ref = parseRuleRef;
export const hasOptSp = (c: CharacterState | undefined, n: string) => !!c && c.options.some((o) => lc(o) === lc(n));
const regOpt = (r: RegimentState, n: string) => [...(r.options ?? []), ...r.commandModels].some((o) => lc(o) === lc(n));
const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');
const within = (s: GameState, a: RegimentState, b: RegimentState, d: number) => a.id === b.id || distancePolys(regimentPolys(s, a), regimentPolys(s, b)) <= d + TOL;

export function spWarlord(s: GameState, p: PlayerId): CharacterState | undefined {
  return Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p) && !c.destroyed);
}
export function spWarlordHas(s: GameState, p: PlayerId, ability: string): boolean {
  return !!spWarlord(s, p)?.supremacyAbilities.some((a) => lc(a) === lc(ability));
}
const used = (c: CharacterState, k: string) => (c.usedOnce ?? []).includes(k);
const markUsed = (c: CharacterState, k: string) => (c.usedOnce = [...(c.usedOnce ?? []), k]);

// ---------------------------------------------------------------- Field Studies (Biomancer, sp p.8)

/** Observation Tokens: one each time any Regiment on the Battlefield is destroyed, at most 4. */
export function observeDestruction(ctx: Ctx, r: RegimentState): void {
  for (const p of ['P1', 'P2'] as const) {
    if (!spWarlordHas(ctx.s, p, 'Field Studies')) continue;
    const st = ctx.s.players[p];
    const before = st.observation ?? 0;
    st.observation = Math.min(4, before + 1);
    if (st.observation > before) ev(ctx, { type: 'note', text: `Field Studies: ${p} gains an Observation Token for ${r.name} (${st.observation}/4, sp p.8).`, player: p });
  }
}

export function spendObservation(ctx: Ctx, p: PlayerId, n: number, why: string): boolean {
  const st = ctx.s.players[p];
  if ((st.observation ?? 0) < n) return false;
  st.observation = (st.observation ?? 0) - n;
  ev(ctx, { type: 'note', text: `Field Studies: ${p} spends ${n} Observation Token${n > 1 ? 's' : ''} (${why}); ${st.observation} left (sp p.8).`, player: p });
  return true;
}

/** The 3-Token spend (sp p.8): on drawing the last Command Card, a non-Monster Regiment loses Broken and Heals 5. */
export function lastCardProblems(s: GameState, p: PlayerId): string[] {
  if (!spWarlordHas(s, p, 'Field Studies')) return ['Needs a Biomancer Warlord (Field Studies, sp p.8).'];
  if ((s.players[p].observation ?? 0) < 3) return ['Needs 3 Observation Tokens.'];
  const d = s.drawn;
  if (!d || d.player !== p || s.activation || s.players[p].stack.length) return ['Use it straight after drawing the last Command Card in your Stack.'];
  const r = d.card.kind === 'regiment' ? s.regiments[d.card.refId] : undefined;
  if (!r || r.type === 'Monster') return ['The card must belong to a non-Monster Regiment.'];
  return [];
}

export function applyLastCard(ctx: Ctx, p: PlayerId, heal: (ctx: Ctx, r: RegimentState, n: number, why: string) => void): void {
  const r = ctx.s.regiments[ctx.s.drawn!.card.refId]!;
  spendObservation(ctx, p, 3, 'last Command Card');
  if (r.broken) {
    r.broken = false;
    r.standsWhenBroken = null;
    ev(ctx, { type: 'note', text: `Field Studies: ${r.name} is no longer Broken (sp p.8).`, regimentId: r.id });
  }
  heal(ctx, r, 5, 'Field Studies');
}

/**
 * A Practitioner roll with an Observation Token (sp p.8): one more die, and the engine keeps the
 * dice best for the ability (RULE-AMBIGUITY: AMB-89 — the player's choice is made by the engine).
 */
export function pickDice(values: number[], keep: number, prefer: 'low' | 'high' | ((v: number) => number)): number[] {
  const score = typeof prefer === 'function' ? prefer : prefer === 'low' ? (v: number) => -v : (v: number) => v;
  return [...values].sort((a, b) => score(b) - score(a)).slice(0, keep);
}

// ---------------------------------------------------------------- effective rules (from refreshRules)

/** Rules, roles and modifiers from the Spires rules below, recomputed after every Action. */
export function spiresExtraGrants(s: GameState): void {
  for (const r of Object.values(s.regiments)) {
    if (!/spires/i.test(s.players[r.owner].faction)) continue;
    const c = attachedCharacter(s, r.id);
    const add = (raw: string) => {
      const x = ref(raw);
      if (!hasRule(r.rules, x.name)) r.rules.push(x);
    };
    // Lineage Commander (sp p.30): its Regiment gains [Husk].
    if (hasOptSp(c, 'Lineage Commander') && !hasRole(r, 'Husk')) r.grantRoles = [...(r.grantRoles ?? []), 'Husk'];
    // Lambs to the Slaughter [Always Active] (Lineage Highborne Warlord, sp p.10): its Regiment gains Fearless and Fury.
    if (c?.isWarlord && c.supremacyAbilities.some((a) => lc(a) === 'lambs to the slaughter')) ['Fearless', 'Fury'].forEach(add);
    if (r.flags.lambs && hasRole(r, 'Husk')) add('Lambs to the Slaughter');
    // Lineage Guard (Bound Clones, sp p.33): Iron Discipline with a High Clone Executor or Lineage Highborne attached.
    if (r.name === 'Bound Clones' && c && /high clone executor|lineage highborne/i.test(c.name)) add('Iron Discipline');
    // Officers (sp p.33, p.36): Ward Preceptor gives Tenacious (1); Assault Preceptor re-rolls Hit Rolls of 6.
    if (r.stands.some((x) => x.isCommand)) {
      if (regOpt(r, 'Ward Preceptor') || regOpt(r, 'Ward Perceptor')) add('Tenacious (1)');
      if (regOpt(r, 'Assault Preceptor')) add('Assault Preceptor');
    }
    // Ruthless Competence (sp p.9): Opportunists for its next Clash or Volley.
    if (r.flags.opportunistNext) add('Opportunists');
    // Gorged (Consumption Beast, sp p.50): +6 Attacks and its Strain always active.
    if (r.flags.gorged) {
      (r.grantMods ??= []).push({ stat: 'A', delta: 6, source: 'Gorged' });
      const def = strainFor(s, r);
      for (const x of def?.rules ?? []) if (!hasRule(r.rules, x.name)) r.rules.push(x);
    }
    // Master of Flesh (Biomancer Warlord, sp p.28): [Aura] friendly Command Stands within 12″ +2 Attacks.
    const w = spWarlord(s, r.owner);
    const host = w?.attachedTo ? s.regiments[w.attachedTo] : undefined;
    r.flags.fleshAura = !!w && hasOptSp(w, 'Master of Flesh') && !!host && host.location === 'table' && r.location === 'table' && within(s, host, r, 12);
  }
  // Inherited Excellence (Vanguard Clones, sp p.40): enemies in contact with its front arc −1 Attacks in Clashes against it.
  // RULE-AMBIGUITY: AMB-89 — applied as −1 Attacks while the enemy touches its front arc.
  for (const src of Object.values(s.regiments)) {
    if (src.name !== 'Vanguard Clones' || src.location !== 'table' || !/spires/i.test(s.players[src.owner].faction)) continue;
    const fp = footprint(formationInput(s, src));
    const mine = regimentPolys(s, src);
    for (const e of enemiesTouching(s, src)) {
      const front = regimentPolys(s, e).some((p) => mine.some((q) => polyDistance(p, q) <= TOL) && arcsOf(fp, p).includes('front'));
      if (front && !(e.grantMods ?? []).some((m) => m.source === 'Inherited Excellence')) (e.grantMods ??= []).push({ stat: 'A', delta: -1, source: 'Inherited Excellence' });
    }
  }
}

// ---------------------------------------------------------------- Supremacy [Activated]

/** Lambs to the Slaughter [Activated] (sp p.10): [Husk] Regiments count Hit Rolls of 6 as 1 this Round. */
export function lambsActivated(ctx: Ctx, p: PlayerId): boolean {
  if (!spWarlordHas(ctx.s, p, 'Lambs to the Slaughter')) return false;
  for (const r of Object.values(ctx.s.regiments)) if (r.owner === p && hasRole(r, 'Husk')) r.flags.lambs = true;
  ev(ctx, { type: 'supremacy', text: `${p} activates Lambs to the Slaughter: [Husk] Regiments count Hit Rolls of 6 as 1 in Clash, Volley and Impact Hits until the end of the Round (sp p.10).`, player: p });
  return true;
}

// ---------------------------------------------------------------- Ruthless Competence (High Clone Executor, sp p.9)

export type RuthlessPlan = NonNullable<GameState['players']['P1']['ruthlessPlan']>;

function ruthlessReady(s: GameState, p: PlayerId, which: Exclude<RuthlessPlan, 'auto'>): boolean {
  if (!spWarlordHas(s, p, 'Ruthless Competence') || s.players[p].ruthlessRound === s.round) return false;
  const plan = s.players[p].ruthlessPlan ?? 'auto';
  return plan === 'auto' || plan === which;
}
const isClone = (r: RegimentState) => hasRole(r, 'Clone');

/** (1) A [Clone] Regiment declaring a Clash or Volley at an enemy within Effective Range gains Opportunists for it. */
export function ruthlessOpportunistProblems(s: GameState, r: RegimentState): string[] {
  if (!spWarlordHas(s, r.owner, 'Ruthless Competence')) return ['Needs a High Clone Executor Warlord (Ruthless Competence, sp p.9).'];
  if (s.players[r.owner].ruthlessRound === s.round) return ['Ruthless Competence has already been used this Round.'];
  if (!isClone(r)) return ['Only a [Clone] Regiment.'];
  if (s.activation?.regimentId !== r.id) return ['Use it as the Regiment declares its Clash or Volley.'];
  return [];
}

export function applyRuthlessOpportunist(ctx: Ctx, r: RegimentState): void {
  ctx.s.players[r.owner].ruthlessRound = ctx.s.round;
  r.flags.opportunistNext = true;
  if (!hasRule(r.rules, 'Opportunists')) r.rules.push(ref('Opportunists'));
  ev(ctx, { type: 'action', text: `Ruthless Competence: ${r.name} gains Opportunists for its next Clash or Volley (sp p.9).`, player: r.owner, regimentId: r.id });
}

/** (2) An enemy declaring a Clash on a [Clone] Regiment loses Inspired until the end of the Round. */
export function ruthlessOnClashTarget(ctx: Ctx, attacker: RegimentState, target: RegimentState): void {
  const p = target.owner;
  if (!isClone(target) || !ruthlessReady(ctx.s, p, 'denyInspired')) return;
  ctx.s.players[p].ruthlessRound = ctx.s.round;
  attacker.flags.noInspired = true;
  ev(ctx, { type: 'note', text: `Ruthless Competence: ${attacker.name} cannot be Inspired until the end of the Round (sp p.9).`, player: p, regimentId: attacker.id });
}

/**
 * (3) When a friendly Regiment is destroyed, a [Clone] Regiment within 12″ may make an Out of
 * Sequence March. RULE-AMBIGUITY: AMB-89 — measured from the destroyed Regiment; the engine offers
 * it to the nearest such Clone Regiment that is not engaged, as a move to make or skip.
 */
export function ruthlessOnDestroyed(ctx: Ctx, dead: RegimentState, deadPolys: ReturnType<typeof regimentPolys>): void {
  const s = ctx.s;
  const p = dead.owner;
  if (s.pendingMove || !ruthlessReady(s, p, 'march')) return;
  const cand = Object.values(s.regiments)
    .filter((r) => r.owner === p && r.id !== dead.id && r.location === 'table' && isClone(r) && !isEngaged(s, r))
    .map((r) => ({ r, d: distancePolys(regimentPolys(s, r), deadPolys) }))
    .filter((x) => x.d <= 12 + TOL)
    .sort((a, b) => a.d - b.d)[0];
  if (!cand) return;
  s.players[p].ruthlessRound = s.round;
  s.pendingMove = { regimentId: cand.r.id, kind: 'ruthless', max: marchAllowance(s, cand.r) };
  ev(ctx, { type: 'note', text: `Ruthless Competence: ${cand.r.name} may make an Out of Sequence March (sp p.9).`, player: p, regimentId: cand.r.id });
}

// ---------------------------------------------------------------- Catabolic Node (sp p.31) and Chain Reaction

export function hasNode(r: RegimentState): boolean {
  return regOpt(r, 'Catabolic Node') && !r.flags.detonated && r.stands.some((x) => x.isCommand);
}

/**
 * Detonation: every enemy engaged with the Regiment suffers D6+4 Hits (one roll for all), the
 * Regiment suffers D6 Hits, no Morale; the Node is removed. With Chain Reaction (Biomancer
 * Warlord) up to two more Nodes within 18″ detonate, adding 2 and then 4 Wounds; an Observation
 * Token rolls 2D6 and keeps one (the engine keeps the higher; AMB-89).
 */
export function detonate(ctx: Ctx, r: RegimentState, why: string, chain = 0): void {
  const s = ctx.s;
  if (!regOpt(r, 'Catabolic Node') || r.flags.detonated) return;
  r.flags.detonated = true;
  const p = r.owner;
  const chainy = spWarlord(s, p) && hasOptSp(spWarlord(s, p), 'Chain Reaction') && spWarlordHas(s, p, 'Field Studies');
  const extraDie = chainy && (s.players[p].observation ?? 0) > 0 && spendObservation(ctx, p, 1, 'Chain Reaction: roll 2D6');
  const rolled = rollN(ctx, extraDie ? 2 : 1);
  const d = Math.max(...rolled);
  const enemies = r.location === 'table' ? enemiesTouching(s, r) : [];
  ev(ctx, { type: 'dice', text: `Catabolic Node: ${r.name}'s Node Detonates (${why}): rolled ${rolled.join(', ')}; engaged enemies suffer ${d + 4} Hits${chain ? ` and ${chain} Wounds` : ''}, ${r.name} suffers ${d} Hits, no Morale (sp p.31).`, player: p, regimentId: r.id });
  for (const e of enemies) {
    resolveAttack(ctx, { attackerOwner: p, attackerId: r.id, targetId: e.id, arc: 'front', pools: [{ label: 'Catabolic Node', dice: 0, skill: 0, autoHits: d + 4 }], morale: false, terrifying: 0, what: 'Catabolic Node', kind: 'special', noLethalDemise: true });
    if (chain && s.regiments[e.id]!.location === 'table') allocateWounds(ctx, s.regiments[e.id]!, chain, p);
  }
  if (r.location === 'table') resolveAttack(ctx, { attackerOwner: other(p), targetId: r.id, arc: 'front', pools: [{ label: 'Catabolic Node (own)', dice: 0, skill: 0, autoHits: d }], morale: false, terrifying: 0, what: 'Catabolic Node', kind: 'special', noLethalDemise: true });
  if (chainy && chain < 4) {
    const from = r.location === 'table' ? regimentPolys(s, r) : null;
    const next = from && Object.values(s.regiments).find((x) => x.owner === p && x.location === 'table' && hasNode(x) && enemiesTouching(s, x).length && distancePolys(regimentPolys(s, x), from) <= 18 + TOL);
    if (next) detonate(ctx, next, 'Chain Reaction', chain === 0 ? 2 : 4);
  }
}

// ---------------------------------------------------------------- Ward Preceptor (sp p.36)

/**
 * Once per Round, at the end of an Action in which an enemy Regiment ended its movement within 8″,
 * the Regiment may make an Out of Sequence 2″ March in any direction, no Wheel. Offered as a move
 * to make or skip (the first such Regiment).
 */
export function wardAfterAction(ctx: Ctx, mover: RegimentState | undefined): void {
  const s = ctx.s;
  if (!mover || mover.location !== 'table' || s.pendingMove) return;
  const w = Object.values(s.regiments).find(
    (r) => r.owner !== mover.owner && r.location === 'table' && (regOpt(r, 'Ward Preceptor') || regOpt(r, 'Ward Perceptor')) && r.stands.some((x) => x.isCommand) && r.flags.wardRound !== s.round && within(s, r, mover, 8),
  );
  if (!w) return;
  w.flags.wardRound = s.round;
  s.pendingMove = { regimentId: w.id, kind: 'ward', max: 2 };
  ev(ctx, { type: 'note', text: `Ward Preceptor: ${mover.name} ended its move within 8″ of ${w.name}, which may make an Out of Sequence 2″ March (sp p.36).`, player: w.owner, regimentId: w.id });
}

// ---------------------------------------------------------------- Consumption Beast (sp p.50)

/** Indiscriminate Omnivore: another friendly Regiment within 12″ uses Strain Expression → one Beast Heals 2. */
export function omnivore(ctx: Ctx, r: RegimentState, heal: (ctx: Ctx, r: RegimentState, n: number, why: string) => void): void {
  const beast = Object.values(ctx.s.regiments).find((b) => b.owner === r.owner && b.id !== r.id && b.name === 'Consumption Beast' && b.location === 'table' && !b.flags.gorged && within(ctx.s, b, r, 12) && b.stands.some((x) => x.wounds > 0));
  if (beast) heal(ctx, beast, 2, 'Indiscriminate Omnivore');
}

/** Gorged: the first time it Heals up to its maximum Wounds (sp p.50). */
export function checkGorged(ctx: Ctx, r: RegimentState): void {
  if (r.name !== 'Consumption Beast' || r.flags.gorged || !/spires/i.test(ctx.s.players[r.owner].faction)) return;
  if (r.stands.length !== r.startingStands || r.stands.some((x) => x.wounds > 0)) return;
  r.flags.gorged = true;
  ev(ctx, { type: 'note', text: `Gorged: ${r.name} adds +6 Attacks, its Strain is always active and it loses Indiscriminate Omnivore for the rest of the game (sp p.50).`, regimentId: r.id });
}

/** Endless Hunger: against a smaller enemy, +1 Clash and Terrifying (2) for that Clash (sp p.50). */
export function endlessHunger(r: RegimentState, t: RegimentState): boolean {
  const size = (x: RegimentState) => (x.type === 'Monster' ? 3 : x.type === 'Infantry' ? 1 : 2);
  return r.name === 'Consumption Beast' && size(t) < size(r);
}

// ---------------------------------------------------------------- Character upgrades (sp p.28–31)

/** Character Actions some upgrades give (Grotesque Elixir, Preservation Protocols). */
export function spiresCharacterActions(c: CharacterState): string[] {
  const out: string[] = [];
  if (hasOptSp(c, 'Grotesque Elixir')) out.push('Grotesque Elixir');
  if (hasOptSp(c, 'Preservation Protocols')) out.push('Preservation Protocols');
  return out;
}

export function spiresAbilityProblems(s: GameState, c: CharacterState, name: string, targetId?: string): string[] | null {
  const r = c.attachedTo ? s.regiments[c.attachedTo] : undefined;
  if (name === 'Grotesque Elixir') {
    if (used(c, 'Grotesque Elixir')) return ['Grotesque Elixir is once per game.'];
    const t = targetId ? s.regiments[targetId] : undefined;
    if (!r || !t || t.owner !== r.owner || t.location !== 'table' || !hasRole(t, 'Monstrosity') || !within(s, r, t, 12)) return ['Choose a friendly [Monstrosity] Regiment within 12″.'];
    return [];
  }
  if (name === 'Preservation Protocols') return r ? [] : ['The Character must be attached to a Regiment.'];
  return null;
}

export function applySpiresAbility(ctx: Ctx, c: CharacterState, name: string, targetId: string | undefined, heal: (ctx: Ctx, r: RegimentState, n: number, why: string) => void): boolean {
  const s = ctx.s;
  const owner: PlayerId = c.id.startsWith('P1') ? 'P1' : 'P2';
  if (name === 'Grotesque Elixir') {
    markUsed(c, 'Grotesque Elixir');
    const t = s.regiments[targetId!]!;
    const two = spWarlordHas(s, owner, 'Field Studies') && c.isWarlord && (s.players[owner].observation ?? 0) > 0 && spendObservation(ctx, owner, 1, 'Grotesque Elixir: roll 2D6');
    const v = rollN(ctx, two ? 2 : 1);
    const n = Math.max(...v);
    ev(ctx, { type: 'dice', text: `Grotesque Elixir: rolled ${v.join(', ')}; ${t.name} Heals ${n} Wounds (sp p.28).`, player: owner, regimentId: t.id });
    heal(ctx, t, n, 'Grotesque Elixir');
    return true;
  }
  if (name === 'Preservation Protocols') {
    const r = s.regiments[c.attachedTo!]!;
    c.wounds = 0;
    if (hasRole(r, 'Husk')) for (const st of r.stands) st.wounds = 0;
    ev(ctx, { type: 'action', text: `Preservation Protocols: ${c.name}${hasRole(r, 'Husk') ? ` and ${r.name}` : ''} remove all Wound Markers (sp p.30).`, player: owner, regimentId: r.id });
    return true;
  }
  return false;
}

/** Induced Fawn Response (sp p.30): the first time its Infantry Regiment becomes Broken, the Broken status is removed. */
export function fawnResponse(ctx: Ctx, r: RegimentState): boolean {
  const c = attachedCharacter(ctx.s, r.id);
  if (!c || r.type !== 'Infantry' || !hasOptSp(c, 'Induced Fawn Response') || used(c, 'Induced Fawn Response')) return false;
  markUsed(c, 'Induced Fawn Response');
  ev(ctx, { type: 'note', text: `Induced Fawn Response: ${r.name} does not become Broken (sp p.30).`, regimentId: r.id });
  return true;
}

/** No Matter the Price (sp p.30): once per game, a [Clone] Regiment's failed Hit Rolls become Hits, each costing it 1 Wound. */
export function priceProblems(s: GameState, r: RegimentState): string[] {
  const c = attachedCharacter(s, r.id);
  if (!hasOptSp(c, 'No Matter the Price')) return ['Needs a Character with No Matter the Price (sp p.30).'];
  if (used(c!, 'No Matter the Price')) return ['No Matter the Price is once per game.'];
  if (!hasRole(r, 'Clone')) return ['Only for a [Clone] Regiment.'];
  return [];
}
export function markPrice(s: GameState, r: RegimentState): void {
  markUsed(attachedCharacter(s, r.id)!, 'No Matter the Price');
}

/**
 * Infiltration and Marksman Optimization Strain (High Clone Executor, sp p.31): Barrage profiles,
 * added when the export does not already show a Barrage on the Character.
 */
export function optimizationStrains(c: CharacterState): void {
  if (c.baseRules.some((x) => lc(x.name) === 'barrage')) return;
  if (hasOptSp(c, 'Infiltration Optimization Strain')) c.baseRules.push(ref('Barrage (6) [12"]'));
  if (hasOptSp(c, 'Marksman Optimization Strain')) c.baseRules.push(ref('Barrage (5) [18"]'), ref('Arcing Fire'));
}

// ---------------------------------------------------------------- Merchant Prince (sp p.10, p.22)

const merchantPrince = (s: GameState, p: PlayerId) => Object.values(s.characters).some((c) => c.id.startsWith(p) && !c.destroyed && /merchant prince/i.test(c.name));

/** Tricks of the Trade (sp p.10): before the first Reinforcement Phase, roll 5 dice into the Influence Pool. */
export function initInfluence(ctx: Ctx): void {
  for (const p of ['P1', 'P2'] as const) {
    if (!spWarlordHas(ctx.s, p, 'Tricks of the Trade') || ctx.s.players[p].influence) continue;
    const v = rollN(ctx, 5);
    ctx.s.players[p].influence = v;
    ev(ctx, { type: 'dice', text: `Tricks of the Trade: ${p}'s Influence Pool is ${v.join(', ')} (sp p.10).`, player: p });
  }
}

/** Every Supremacy Roll adds its final unmodified result to the Influence Pool (sp p.10). */
export function addInfluence(s: GameState, p: PlayerId, v: number): void {
  const st = s.players[p];
  if (st.influence) st.influence = [...st.influence, v];
}

export type SpiresAction =
  | { option: 'lastCard' }
  | { option: 'ruthlessPlan'; plan: RuthlessPlan }
  | { option: 'privileged'; regimentId: string }
  | { option: 'influence'; indices: number[] }
  | { option: 'offer' }
  | { option: 'answerOffer'; accept: boolean };

/** Whose decision the next action is while an Offer waits for an answer (sp p.22). */
export function offerPendingFor(s: GameState): PlayerId | null {
  for (const p of ['P1', 'P2'] as const) {
    const o = s.players[p].offer;
    if (o && o.round === s.round && o.accepted === null) return other(p);
  }
  return null;
}

export function spiresActionProblems(s: GameState, p: PlayerId, a: SpiresAction): string[] {
  switch (a.option) {
    case 'lastCard':
      return lastCardProblems(s, p);
    case 'ruthlessPlan':
      return spWarlordHas(s, p, 'Ruthless Competence') ? [] : ['Needs a High Clone Executor Warlord (sp p.9).'];
    case 'privileged': {
      // Privileged Observer (Force Grown Drones, sp p.35): before the first Reinforcement Round.
      const r = s.regiments[a.regimentId];
      const c = r ? attachedCharacter(s, r.id) : undefined;
      if (!r || r.owner !== p || r.name !== 'Force Grown Drones' || r.flags.privileged) return ['Choose your Force Grown Drones.'];
      if (!c || !/biomancer|pheromancer/i.test(c.name)) return ['A Biomancer or Pheromancer must be attached (sp p.35).'];
      if (!(s.phase === 'setup' || (s.round === 1 && s.step === 'reinforcement' && !s.players.P1.reinforcementDone && !s.players.P2.reinforcementDone))) return ['Only before the first Reinforcement rolls (sp p.35).'];
      return [];
    }
    case 'influence': {
      const pool = s.players[p].influence ?? [];
      if (!pool.length) return ['The Influence Pool is empty (Tricks of the Trade, sp p.10).'];
      if (!a.indices.length || a.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= pool.length) || new Set(a.indices).size !== a.indices.length) return ['Choose dice from the Influence Pool.'];
      if (s.phase !== 'play' || s.step !== 'action') return ['Influence dice replace dice rolled in the Action Phase (not Reinforcement or Supremacy Rolls, sp p.10).'];
      const mine = s.activation ? s.regiments[s.activation.regimentId]?.owner === p : (s.drawn?.player ?? s.turn) === p;
      return mine ? [] : ['Use them on your own rolls.'];
    }
    case 'offer':
      if (!merchantPrince(s, p)) return ['Needs a Merchant Prince (Master Manipulator, sp p.22).'];
      if (s.phase !== 'play' || s.step !== 'reinforcement' || s.players.P1.reinforcementDone || s.players.P2.reinforcementDone) return ['Propose it before any Reinforcement Rolls are made (sp p.22).'];
      if (s.players[p].offer?.round === s.round) return ['Only one Offer per Round.'];
      if (offerPendingFor(s)) return ['An Offer is waiting for an answer.'];
      return [];
    case 'answerOffer':
      return offerPendingFor(s) === p ? [] : ['There is no Offer to answer.'];
  }
}

export function applySpiresAction(ctx: Ctx, p: PlayerId, a: SpiresAction, heal: (ctx: Ctx, r: RegimentState, n: number, why: string) => void): void {
  const s = ctx.s;
  switch (a.option) {
    case 'lastCard':
      applyLastCard(ctx, p, heal);
      return;
    case 'ruthlessPlan':
      s.players[p].ruthlessPlan = a.plan;
      ev(ctx, { type: 'note', text: `Ruthless Competence: ${p} keeps ${a.plan === 'auto' ? 'the first chance' : a.plan === 'opportunist' ? 'Opportunists' : a.plan === 'denyInspired' ? 'denying Inspired' : 'the Out of Sequence March'} ready (sp p.9).`, player: p });
      return;
    case 'privileged': {
      const r = s.regiments[a.regimentId]!;
      r.cls = 'Medium';
      r.flags.privileged = true;
      ev(ctx, { type: 'note', text: `Privileged Observer: ${r.name} becomes a Medium Regiment (sp p.35).`, player: p, regimentId: r.id });
      return;
    }
    case 'influence': {
      const pool = s.players[p].influence!;
      const vals = a.indices.map((i) => pool[i]!);
      s.players[p].influence = pool.filter((_, i) => !a.indices.includes(i));
      s.forcedDice = [...vals, ...(s.forcedDice ?? [])];
      ev(ctx, { type: 'note', text: `Tricks of the Trade: ${p} uses Influence dice ${vals.join(', ')} for the next roll (sp p.10).`, player: p });
      return;
    }
    case 'offer':
      s.players[p].offer = { round: s.round, accepted: null };
      ev(ctx, { type: 'note', text: `Master Manipulator: ${p} proposes an Offer to ${other(p)} (sp p.22).`, player: p });
      return;
    case 'answerOffer': {
      const by = other(p);
      s.players[by].offer!.accepted = a.accept;
      ev(ctx, {
        type: 'note',
        text: a.accept
          ? `${p} accepts the Offer: each player may pick one more Regiment that arrives automatically this Round; ${by}'s also gains Vanguard (3) (sp p.22).`
          : `${p} declines the Offer: ${by} may re-roll one failed Reinforcement Roll, or give one Regiment not on the Battlefield Vanguard (3) this Round (sp p.22).`,
        player: p,
      });
      return;
    }
  }
}

/** Master Manipulator's effect on a player's Reinforcements this Round (sp p.22). */
export function offerState(s: GameState, p: PlayerId): 'extra' | 'declined' | null {
  const mine = s.players[p].offer;
  const theirs = s.players[other(p)].offer;
  if ((mine?.round === s.round && mine.accepted) || (theirs?.round === s.round && theirs.accepted)) return 'extra';
  if (mine?.round === s.round && mine.accepted === false) return 'declined';
  return null;
}

// ---------------------------------------------------------------- Mimetic Assassin (sp p.24)

/** The Assassination Directive as a Clash is declared: which Assassin, and its out-of-sequence Duel. */
export interface AssassinPlan {
  characterId: string;
  duelTargetId?: string;
  accept?: boolean;
}

export function assassinProblems(s: GameState, r: RegimentState, a: AssassinPlan, layoutOf: (r: RegimentState) => { id: string; rank: number; isCommand: boolean; isCharacter: boolean }[]): string[] {
  const c = s.characters[a.characterId];
  if (!c || c.destroyed || !c.id.startsWith(r.owner) || !/mimetic assassin/i.test(c.name)) return ['Choose your Mimetic Assassin.'];
  if (c.attachedTo || used(c, 'Assassination Directive')) return ['The Assassination Directive is used once per game (sp p.24).'];
  if (r.type !== 'Infantry' || attachedCharacter(s, r.id)) return ['Only an Infantry Regiment without a Character (sp p.24).'];
  if (!layoutOf(r).some((x) => x.rank === 0 && !x.isCommand && !x.isCharacter)) return ['It needs a non-Command Stand in its first Rank.'];
  return [];
}

/**
 * The Assassin replaces a non-Command Stand in the first Rank (a casualty that does not count
 * towards Broken or Shattered), inflicts Hits equal to that Stand's Wounds with Cleave (2) and no
 * Morale on an enemy in contact (the Clash target if possible), may Duel out of sequence, and counts
 * as having Activated. The Regiment's Clash then goes on.
 */
export function assassinate(ctx: Ctx, r: RegimentState, a: AssassinPlan, targetId: string, duel: (ctx: Ctx, c: CharacterState, t: CharacterState, accept: boolean) => void): void {
  const s = ctx.s;
  const c = s.characters[a.characterId]!;
  markUsed(c, 'Assassination Directive');
  const victim = [...r.stands].reverse().find((x) => !x.isCommand) ?? r.stands[0]!;
  r.stands = r.stands.filter((x) => x.id !== victim.id);
  r.standsAtRoundStart = Math.max(r.stands.length, r.standsAtRoundStart - 1);
  if (r.standsWhenBroken !== null) r.standsWhenBroken = Math.max(r.stands.length, r.standsWhenBroken - 1);
  c.attachedTo = r.id;
  c.activatedThisRound = true;
  const W = Math.max(1, r.profile.W ?? 1);
  ev(ctx, { type: 'action', text: `Assassination Directive: ${c.name} replaces a Stand of ${r.name} (sp p.24).`, player: r.owner, regimentId: r.id });
  const enemies = enemiesTouching(s, r);
  const t = enemies.find((e) => e.id === targetId) ?? enemies[0];
  if (t) resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: t.id, arc: 'front', pools: [{ label: `${c.name} (Assassination Directive)`, dice: 0, skill: 0, autoHits: W, reduceD: 2 }], morale: false, terrifying: 0, what: 'Assassination Directive', kind: 'special' });
  const foe = a.duelTargetId ? s.characters[a.duelTargetId] : undefined;
  if (foe && !foe.destroyed && foe.attachedTo && enemiesTouching(s, r).some((e) => e.id === foe.attachedTo)) duel(ctx, c, foe, !!a.accept);
}

/** A Mimetic Assassin still waiting at the end of the game counts as destroyed (sp p.24). */
export function assassinsLost(ctx: Ctx): void {
  for (const c of Object.values(ctx.s.characters)) {
    if (c.destroyed || c.attachedTo || !/mimetic assassin/i.test(c.name) || used(c, 'Assassination Directive')) continue;
    const owner: PlayerId = c.id.startsWith('P1') ? 'P1' : 'P2';
    c.destroyed = true;
    ctx.s.tally.charactersKilled[other(owner)] += 1;
    ev(ctx, { type: 'destroyed', text: `${c.name} never entered the Battlefield and counts as destroyed (sp p.24).`, player: owner });
  }
}
