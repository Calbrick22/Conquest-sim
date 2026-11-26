import { allocateWounds, commandDieFighting } from '../combat';
import { resolveImpact, enemiesInContact, arcOfAttack } from '../actions';
import { ev, type Ctx } from '../dice';
import type { CharacterState, GameState, PlayerId, PowerPool, RegimentState } from '../model/types';
import { distancePolys, isEngaged, regimentPolys } from '../queries';
import { hasRule } from '../rules/special/rules';
import { TOL } from '../geometry/vec';
import {
  activateMemories,
  addPower,
  fallenDivinity,
  hasMemories,
  isAnimateVessel,
  od,
  poolTier,
  regimentDarkTier,
  roleOf,
  spendPower,
  warlord,
  warlordHas,
} from './oldDominion';

/**
 * Old Dominion Actions, Draw Events and Supremacy Abilities (od p.5–31). Mechanics from the
 * faction document; names come from the uploaded list.
 */

const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');
const lc = (x: string) => x.toLowerCase();

export const OD_DRAW_EVENTS = ['Memories of Old', 'Dark Shepherd', 'Dark Awakening', "Heaven's Descent", 'Exhortation of Eternal Faith', 'Exploitation of Divine Vanity', 'Unholy Sacrament', 'Blasphemous Mesa'];

export function isOdDrawEvent(name: string): boolean {
  return OD_DRAW_EVENTS.some((n) => lc(n) === lc(name.replace(/[’]/g, "'")));
}

/** Total Power Tokens a player can discard (Dark Power first, then Fallen Pantheon; AMB-43). */
export function tokensAvailable(s: GameState, p: PlayerId): number {
  const o = od(s, p);
  return o ? o.dark + o.pantheon : 0;
}

/**
 * Discard Power Tokens for Dark Awakening / Heaven's Descent, which do not name a pool.
 * RULE-AMBIGUITY: AMB-43 — taken from the Dark Power Pool first, then the Fallen Pantheon Pool.
 */
export function discardTokens(ctx: Ctx, p: PlayerId, n: number, why: string): boolean {
  const o = od(ctx.s, p);
  if (!o || o.dark + o.pantheon < n) return false;
  const fromDark = Math.min(o.dark, n);
  if (fromDark) spendPower(ctx, p, fromDark, why);
  const rest = n - fromDark;
  if (rest) {
    o.pantheon -= rest;
    ev(ctx, { type: 'power', text: `${p} discards ${rest} Fallen Pantheon Token${rest > 1 ? 's' : ''} (${why}): ${o.pantheon} left.`, player: p });
  }
  return true;
}

export interface OdDrawChoice {
  option?: string;
  options?: string[];
  targetId?: string;
}

/** Extra checks for Old Dominion Draw Events (the generic checks run first). */
export function odDrawEventProblems(s: GameState, r: RegimentState, name: string, ch: OdDrawChoice): string[] {
  const n = lc(name.replace(/[’]/g, "'"));
  const p = r.owner;
  const act = s.activation!;
  const c = act.characterId ? s.characters[act.characterId] : undefined;
  if (n === 'memories of old') {
    if (!hasMemories(r)) return [`${r.name} has no Memories of Old.`];
    if (r.flags.memories) return ['Memories of Old is already active this Round (od p.5: it does not stack).'];
    return [];
  }
  if (n === 'dark shepherd') {
    const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
    if (!t || t.owner !== p || t.location !== 'table') return ['Choose a friendly Regiment on the Battlefield.'];
    const unlimited = !!c && c.options.some((o) => lc(o) === 'the reaping crook');
    if (!unlimited && distancePolys(regimentPolys(s, r), regimentPolys(s, t)) > 12 + TOL) return [`${t.name} is more than 12″ away.`];
    return [];
  }
  if (n === 'dark awakening') {
    const opts = ch.options ?? (ch.option ? [ch.option] : []);
    if (!opts.length) return ['Choose at least one effect.'];
    if (new Set(opts).size !== opts.length) return ['Each effect can only be chosen once.'];
    if (tokensAvailable(s, p) < 2 * opts.length) return [`Each effect costs 2 Power Tokens; you have ${tokensAvailable(s, p)}.`];
    return [];
  }
  if (n === "heaven's descent") {
    if (!isEngaged(s, r)) return ["Heaven's Descent needs the Regiment to be Engaged."];
    if (tokensAvailable(s, p) < 2) return ["Heaven's Descent costs 2 Power Tokens."];
    const t = ch.targetId ? s.regiments[ch.targetId] : enemiesInContact(s, r)[0];
    if (!t || !enemiesInContact(s, r).some((e) => e.id === t.id)) return ['Choose an enemy Regiment it is Engaged with.'];
    return [];
  }
  if (n === 'exploitation of divine vanity') {
    if (ch.option === 'terror') {
      const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
      if (!t || t.owner === p || t.location !== 'table') return ['Choose an enemy Regiment.'];
      if (distancePolys(regimentPolys(s, r), regimentPolys(s, t)) > 12 + TOL) return [`${t.name} is more than 12″ away.`];
    }
    return [];
  }
  if (n === 'unholy sacrament' || n === 'blasphemous mesa') {
    if ((od(s, p)?.dark ?? 0) < 1) return ['This costs 1 Dark Power Token.'];
    return [];
  }
  return [];
}

export function applyOdDrawEvent(ctx: Ctx, r: RegimentState, name: string, ch: OdDrawChoice): void {
  const s = ctx.s;
  const n = lc(name.replace(/[’]/g, "'"));
  const p = r.owner;
  const act = s.activation!;
  const c = act.characterId ? s.characters[act.characterId] : undefined;
  switch (n) {
    case 'memories of old':
      activateMemories(ctx, r, 'as a Draw Event');
      return;
    case 'dark shepherd': {
      // Wounds equal to those remaining on its most wounded Stand; no Morale Tests (od p.11).
      const t = s.regiments[ch.targetId!]!;
      const W = Math.max(1, t.profile.W ?? 1);
      const most = [...t.stands].sort((a, b) => b.wounds - a.wounds)[0];
      const w = most ? W - most.wounds : 0;
      ev(ctx, { type: 'draw-event', text: `Dark Shepherd: ${t.name} suffers ${w} Wound${w === 1 ? '' : 's'}, no Morale Tests (od p.11).`, player: p, regimentId: t.id });
      // Divinity Grace (Hierodeacon Warlord, od p.9): double the Power Tokens.
      ctx.doublePower = !!c && c.isWarlord && warlordHas(s, p, 'Divinity Grace');
      allocateWounds(ctx, t, w, other(p));
      ctx.doublePower = false;
      return;
    }
    case 'dark awakening': {
      const opts = ch.options ?? (ch.option ? [ch.option] : []);
      discardTokens(ctx, p, 2 * opts.length, 'Dark Awakening');
      const got: string[] = [];
      for (const o of opts) {
        if (o === 'C') {
          r.roundMods.push({ stat: 'C', delta: 2, source: 'Dark Awakening' });
          got.push('+2 Clash');
        } else if (o === 'Cleave') {
          r.roundRules.push({ name: 'Cleave', x: 2, raw: 'Cleave (2)' });
          got.push('Cleave (2)');
        } else if (o === 'Brutal') {
          r.roundRules.push({ name: 'Brutal Impact', x: 2, raw: 'Brutal Impact (2)' });
          got.push('Brutal Impact (2)');
        } else if (o === 'Impact') {
          r.roundRules.push({ name: 'Impact', x: 2, plus: true, raw: 'Impact (+2)' });
          got.push('Impact (+2)');
        }
      }
      ev(ctx, { type: 'draw-event', text: `Dark Awakening: ${r.name} gains ${got.join(', ')} until the end of the Round (od p.28).`, player: p, regimentId: r.id });
      return;
    }
    case "heaven's descent": {
      discardTokens(ctx, p, 2, "Heaven's Descent");
      const t = ch.targetId ? s.regiments[ch.targetId]! : enemiesInContact(s, r)[0]!;
      r.roundRules.push({ name: 'Inspired', raw: 'Inspired' }, { name: 'Cleave', x: 1, plus: true, raw: 'Cleave (+1)' });
      ev(ctx, { type: 'draw-event', text: `Heaven's Descent: ${r.name} makes Impact Attacks against ${t.name} and gains Inspired and Cleave (+1) (od p.28).`, player: p, regimentId: r.id });
      resolveImpact(ctx, r, t, arcOfAttack(s, r, t));
      return;
    }
    case 'exhortation of eternal faith':
    case 'exploitation of divine vanity': {
      const exh = n === 'exhortation of eternal faith';
      ev(ctx, { type: 'draw-event', text: `${exh ? 'Exhortation of Eternal Faith' : 'Exploitation of Divine Vanity'}: ${r.name} suffers 3 Wounds and generates a Power Token (od p.${exh ? 30 : 16}).`, player: p, regimentId: r.id });
      allocateWounds(ctx, r, 3, other(p));
      addPower(ctx, p, 1, exh ? 'Exhortation of Eternal Faith' : 'Exploitation of Divine Vanity');
      if (r.location === 'destroyed') return;
      const o = ch.option ?? (exh ? 'seize' : 'aod');
      if (exh && o === 'seize') {
        r.flags.seizeBonus = (r.flags.seizeBonus ?? 0) + 6;
        ev(ctx, { type: 'draw-event', text: `${r.name} counts as +6 Stands towards Seizing until the end of the Round.`, regimentId: r.id });
      } else if (exh && o === 'aura-resolve') {
        // RULE-AMBIGUITY: AMB-44 — applied to the enemies within 12″ at the moment it is used.
        const hit = Object.values(s.regiments).filter((e) => e.owner !== p && e.location === 'table' && distancePolys(regimentPolys(s, e), regimentPolys(s, r)) <= 12 + TOL);
        for (const e of hit) e.roundMods.push({ stat: 'R', delta: -1, source: 'Exhortation of Eternal Faith' });
        ev(ctx, { type: 'draw-event', text: `Enemy Regiments within 12″ suffer −1 Resolve until the end of the Round: ${hit.map((e) => e.name).join(', ') || 'none'}.` });
      } else if (exh) {
        r.flags.exhortAura = true;
        ev(ctx, { type: 'draw-event', text: `${r.name} gains the Aura until the end of the Round: friendly Command Stands within 12″ add +3 Attacks and gain Cleave (1) (od p.30).`, regimentId: r.id });
      } else if (o === 'aod') {
        r.roundRules.push({ name: 'Aura of Death', x: 10, plus: true, raw: 'Aura of Death (+10)' });
        ev(ctx, { type: 'draw-event', text: `${r.name} gains Aura of Death (+10) until the end of the Round.`, regimentId: r.id });
      } else if (o === 'harvest') {
        r.roundRules.push({ name: 'Harvest of Vanity', raw: 'Harvest of Vanity' });
        ev(ctx, { type: 'draw-event', text: `${r.name} generates 1 Power Token for every two enemy Stands it destroys this Activation.`, regimentId: r.id });
      } else if (o === 'terror' && ch.targetId) {
        const t = s.regiments[ch.targetId]!;
        t.flags.rerollMoraleSuccesses = true;
        ev(ctx, { type: 'draw-event', text: `${t.name} re-rolls successful Morale Tests until the end of the Round.`, regimentId: t.id });
      }
      return;
    }
    case 'unholy sacrament':
      spendPower(ctx, p, 1, 'Unholy Sacrament');
      if (c) c.sacrament = true;
      ev(ctx, { type: 'draw-event', text: `Unholy Sacrament: ${c?.name ?? r.name} gains Priest (+3) for its first Spellcasting this Round (od p.19).`, player: p });
      return;
    case 'blasphemous mesa':
      spendPower(ctx, p, 1, 'Blasphemous Mesa');
      (act.extra ??= []).push({ kind: 'spell', reason: 'Blasphemous Mesa', free: true });
      ev(ctx, { type: 'draw-event', text: `Blasphemous Mesa: ${c?.name ?? r.name} may perform a free additional Spellcasting Action (od p.8).`, player: p });
      return;
  }
}

// ---------------------------------------------------------------- Actions

export function memoriesProblems(r: RegimentState): string[] {
  if (!hasMemories(r)) return [`${r.name} has no Memories of Old.`];
  if (r.flags.memories) return ['Memories of Old is already active this Round (od p.5).'];
  return [];
}

/** Blasphemous Mesa (Archimandrite, od p.8): spend 1 Dark Power Token as a [The Creed]/[The Legion] Regiment Activates. */
export function odSpendProblems(s: GameState, r: RegimentState): string[] {
  const act = s.activation;
  if (!act || act.regimentId !== r.id || act.characterId) return ['Use it as the Regiment Activates.'];
  if (!warlordHas(s, r.owner, 'Blasphemous Mesa')) return ['Only with an Archimandrite Warlord (Blasphemous Mesa).'];
  if (!(roleOf(r, 'Creed') || roleOf(r, 'Legion'))) return ['Only for [The Creed] or [The Legion] Regiments.'];
  if (act.drawEventDone || act.actions.length) return ['Before resolving any Draw Events (od p.8).'];
  if (act.powerSpent) return ['Already used this Activation.'];
  if ((od(s, r.owner)?.dark ?? 0) < 1) return ['No Dark Power Tokens to spend.'];
  return [];
}

export function applyOdSpend(ctx: Ctx, r: RegimentState, option: 'aod' | 'noBrittle' | 'terrifying'): void {
  spendPower(ctx, r.owner, 1, 'Blasphemous Mesa');
  ctx.s.activation!.powerSpent = true;
  if (option === 'aod') r.roundRules.push({ name: 'Aura of Death', x: 1, plus: true, raw: 'Aura of Death (+1)' });
  else if (option === 'terrifying') r.roundRules.push({ name: 'Terrifying', x: 1, plus: true, raw: 'Terrifying (+1)' });
  else r.flags.noBrittle = true;
  ev(ctx, { type: 'action', text: `${r.name} ${option === 'aod' ? 'gains Aura of Death (+1)' : option === 'terrifying' ? 'gains Terrifying (+1)' : 'loses Brittle'} until the end of the Round (Blasphemous Mesa, od p.8).`, player: r.owner, regimentId: r.id });
}

// ---------------------------------------------------------------- Spends as a Clash or Duel is declared

/**
 * Old Dominion Power Token choices made as a Clash (or Duel) is declared:
 * - soulReaper (od p.20): the Character spends X Dark Power Tokens for +X Attacks until the end of the Round;
 * - reignOfTerror (Theokrator, od p.10): once per Round, 1 Token gives a [The Creed] or [The Legion]
 *   Regiment Trial of Will for its next Clash;
 * - obdurate (Xhiliarch, od p.10): the once-per-Round choice of +X Attacks for the Warlord's next Clash
 *   or Duel, X being the Dark Power Tier (instead of the Charge bonus; AMB-41).
 */
export type OdClashOption = 'soulReaper' | 'reignOfTerror' | 'obdurate';

const hasOptOd = (c: CharacterState | undefined, n: string) => !!c && c.options.some((o) => lc(o).startsWith(n));

export function odClashProblems(s: GameState, r: RegimentState, option: OdClashOption, amount = 0): string[] {
  const act = s.activation;
  const o = od(s, r.owner);
  if (!o) return ['Old Dominion only.'];
  if (!act || act.regimentId !== r.id || act.ended) return ['Use it in the Regiment’s own Activation.'];
  if (r.location !== 'table' || !isEngaged(s, r)) return ['Use it as a Clash or Duel is declared: the Regiment must be engaged.'];
  const c = Object.values(s.characters).find((x) => x.attachedTo === r.id && !x.destroyed && !x.embodied);
  if (option === 'soulReaper') {
    if (!hasOptOd(c, 'soul reaper')) return ['Needs a Character with Soul Reaper (od p.20).'];
    if (c!.roundA) return ['Soul Reaper has already been used this Round.'];
    if (!Number.isInteger(amount) || amount < 1 || amount > o.dark) return [`Spend 1 to ${o.dark} Dark Power Tokens.`];
    return [];
  }
  if (option === 'reignOfTerror') {
    if (!warlordHas(s, r.owner, 'Reign of Terror')) return ['Needs a Theokrator Warlord (Reign of Terror).'];
    if (o.onceUsed.includes('reignOfTerror')) return ['Reign of Terror has already been used this Round (od p.10).'];
    if (!(roleOf(r, 'Creed') || roleOf(r, 'Legion'))) return ['Only for [The Creed] or [The Legion] Regiments.'];
    if (r.flags.trialNext) return ['It already has Trial of Will for its next Clash.'];
    if (o.dark < 1) return ['No Dark Power Tokens to spend.'];
    return [];
  }
  const w = warlord(s, r.owner);
  if (!warlordHas(s, r.owner, 'Obdurate Bone and Stone') || !w || w.attachedTo !== r.id) return ["Only for the Xhiliarch Warlord's Regiment (od p.10)."];
  if (o.onceUsed.includes('obdurate')) return ['Obdurate Bone and Stone has already been used this Round.'];
  if (poolTier(s, r.owner, 'dark') < 1) return ['The Dark Power Pool has no Tier yet.'];
  return [];
}

export function applyOdClash(ctx: Ctx, r: RegimentState, option: OdClashOption, amount = 0): void {
  const s = ctx.s;
  const o = od(s, r.owner)!;
  if (option === 'soulReaper') {
    const c = Object.values(s.characters).find((x) => x.attachedTo === r.id && !x.destroyed && !x.embodied)!;
    spendPower(ctx, r.owner, amount, 'Soul Reaper');
    c.roundA = amount;
    ev(ctx, { type: 'action', text: `Soul Reaper: ${c.name} adds +${amount} Attacks until the end of the Round (od p.20).`, player: r.owner, regimentId: r.id });
    return;
  }
  if (option === 'reignOfTerror') {
    spendPower(ctx, r.owner, 1, 'Reign of Terror');
    o.onceUsed.push('reignOfTerror');
    r.flags.trialNext = true;
    ev(ctx, { type: 'action', text: `Reign of Terror: ${r.name} gains Trial of Will for its next Clash (od p.10).`, player: r.owner, regimentId: r.id });
    return;
  }
  const w = warlord(s, r.owner)!;
  const x = poolTier(s, r.owner, 'dark');
  o.onceUsed.push('obdurate');
  w.nextA = x;
  ev(ctx, { type: 'action', text: `Obdurate Bone and Stone: ${w.name} adds +${x} Attacks for its next Clash or Duel (od p.10).`, player: r.owner, regimentId: r.id });
}

// ---------------------------------------------------------------- Supremacy Abilities [Activated]

export type SupremacyTarget = { id: string; option?: string };

export const OD_SUPREMACY = ['Surrounded by Fear and Dead Men', 'Divinity Grace', 'Master of the Legions', 'Glimmers of a Golden Age', 'Reign of Terror', 'Blasphemous Mesa', 'Obdurate Bone and Stone'];

export function isOdSupremacy(s: GameState, p: PlayerId): boolean {
  return OD_SUPREMACY.some((a) => warlordHas(s, p, a));
}

export function odSupremacyProblems(s: GameState, p: PlayerId, targets: SupremacyTarget[]): string[] {
  if (warlordHas(s, p, 'Blasphemous Mesa') || warlordHas(s, p, 'Obdurate Bone and Stone')) return ['This Supremacy Ability has no [Activated] part.'];
  if (warlordHas(s, p, 'Surrounded by Fear and Dead Men')) {
    const fd = fallenDivinity(s, p);
    const t = targets[0] ? s.regiments[targets[0].id] : undefined;
    if (!t || t.owner !== p || t.location !== 'table' || t.id === fd?.id || !roleOf(t, 'Fallen Pantheon')) return ['Target a friendly [The Fallen Pantheon] Regiment other than the Fallen Divinity (od p.8).'];
  }
  if (warlordHas(s, p, 'Master of the Legions')) {
    if (od(s, p)?.supremacyThisRound) return ['Already used this Supremacy Phase.'];
    if (targets.length < 1 || targets.length > 2) return ['Target one or two friendly [The Legion] Regiments (od p.9).'];
    for (const t of targets) {
      const r = s.regiments[t.id];
      if (!r || r.owner !== p || r.location !== 'table' || !roleOf(r, 'Legion')) return ['Targets must be friendly [The Legion] Regiments on the Battlefield.'];
      if (!['tier', 'memories', 'charge', 'brittle'].includes(t.option ?? '')) return ['Choose a benefit for each Regiment.'];
      if (t.option === 'memories' && !hasMemories(r)) return [`${r.name} has no Memories of Old.`];
    }
  }
  return [];
}

export function applyOdSupremacy(ctx: Ctx, p: PlayerId, targets: SupremacyTarget[]): void {
  const s = ctx.s;
  const w = warlord(s, p)!;
  if (warlordHas(s, p, 'Surrounded by Fear and Dead Men')) {
    const t = s.regiments[targets[0]!.id]!;
    const W = Math.max(1, t.profile.W ?? 1);
    const before = t.stands.length;
    ev(ctx, { type: 'supremacy', text: `${w.name}: up to 3 Stands of ${t.name} are destroyed to feed the Fallen Pantheon (od p.8).`, player: p });
    for (let i = 0; i < 3 && t.location === 'table' && t.stands.length; i++) {
      const st = [...t.stands].sort((a, b) => Number(a.isCommand) - Number(b.isCommand) || b.wounds - a.wounds)[0]!;
      // Its Command Stand Dies Fighting! if the sacrifice would destroy the Regiment (od p.8).
      if (t.stands.length === 1 && st.isCommand) commandDieFighting(ctx, t, 'Surrounded by Fear and Dead Men, od p.8');
      if (t.location !== 'table') break;
      allocateWounds(ctx, t, W - st.wounds, other(p));
    }
    const lost = before - t.stands.length;
    if (lost) addPower(ctx, p, lost, `${w.name}'s sacrifice`, 'pantheon');
    return;
  }
  if (warlordHas(s, p, 'Divinity Grace')) {
    const hit = Object.values(s.regiments).filter((r) => r.owner === p && roleOf(r, 'Fallen Pantheon'));
    for (const r of hit) r.roundRules.push({ name: 'Blessed', raw: 'Blessed' });
    ev(ctx, { type: 'supremacy', text: `Divinity Grace: [The Fallen Pantheon] Regiments gain Blessed until the end of the Round (${hit.map((r) => r.name).join(', ')}).`, player: p });
    return;
  }
  if (warlordHas(s, p, 'Master of the Legions')) {
    od(s, p)!.supremacyThisRound = true;
    for (const t of targets) {
      const r = s.regiments[t.id]!;
      if (t.option === 'tier') r.flags.tierBonus = (r.flags.tierBonus ?? 0) + 1;
      if (t.option === 'memories') activateMemories(ctx, r, '(Master of the Legions)');
      if (t.option === 'charge') r.flags.charge2d6 = true;
      if (t.option === 'brittle') r.flags.noBrittle = true;
      const what = { tier: 'counts as under the Dark Power Pool Tier +1', memories: 'activates its Memories of Old', charge: 'rolls 2D6 and keeps the highest for its Charge Distance', brittle: 'loses Brittle' }[t.option as 'tier'];
      ev(ctx, { type: 'supremacy', text: `Master of the Legions: ${r.name} ${what} until the end of the Round (od p.9).`, player: p, regimentId: r.id });
    }
    return;
  }
  if (warlordHas(s, p, 'Glimmers of a Golden Age')) {
    od(s, p)!.onceUsed.push('glimmers-iv');
    ev(ctx, { type: 'supremacy', text: 'Glimmers of a Golden Age: this Round its once-per-Round ability counts as Dark Power Tier IV (od p.10).', player: p });
    return;
  }
  if (warlordHas(s, p, 'Reign of Terror')) {
    const hit = Object.values(s.regiments).filter((r) => r.owner === p && (roleOf(r, 'Creed') || roleOf(r, 'Legion')));
    for (const r of hit) r.roundRules.push({ name: 'Trial of Will', raw: 'Trial of Will' });
    ev(ctx, { type: 'supremacy', text: 'Reign of Terror: [The Creed] and [The Legion] Regiments gain Trial of Will until the end of the Round (od p.10).', player: p });
  }
}

/** Free additional Spellcasting at the start of an Activation (Theokrator, Divinity Grace; od p.9, p.16). */
export function odActivationStartSpells(ctx: Ctx): void {
  const s = ctx.s;
  const act = s.activation;
  if (!act) return;
  const r = s.regiments[act.regimentId]!;
  if (!od(s, r.owner)) return;
  const add = (reason: string) => (act.extra ??= []).push({ kind: 'spell', reason, free: true });
  // RULE-AMBIGUITY: AMB-52 — the Theokrator's free Spellcasting is found from its entry text.
  if (!act.characterId && r.embodies && hasRule(r.rules, 'Priest') && (r.notes ?? []).some((n) => /free spellcasting/i.test(n))) add('Theokrator');
  if (act.characterId && s.characters[act.characterId]!.isWarlord && warlordHas(s, r.owner, 'Divinity Grace')) add('Divinity Grace');
}

export { isAnimateVessel, regimentDarkTier };

export type { PowerPool };
