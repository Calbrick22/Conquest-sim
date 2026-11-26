import { hasLineOfSight, enemiesInContact, footprintOf } from './actions';
import { allocateWounds, charStat, isDestroyed, resolveAttack, stat } from './combat';
import { ev, rollN, type Ctx } from './dice';
import { arcsOf } from './geometry/arcs';
import { layout } from './formation';
import { polyDistance, rectPoly } from './geometry/polygon';
import { TOL } from './geometry/vec';
import type { ActionKind, ActivationState, CharacterState, CommandCard, GameState, RegimentState } from './model/types';
import { attachedCharacter, distancePolys, formationInput, isEngaged, regimentPolys } from './queries';
import { hasRole, sectOf } from './rules/special/grants';
import { barrageOf, hasRule, ruleX } from './rules/special/rules';
import { OD_DRAW_EVENTS, applyOdDrawEvent, isOdDrawEvent, odDrawEventProblems } from './factions/oldDominionActions';
import { applySkDrawEvent, skDrawEventProblems } from './factions/sorcererKingsActions';
import { applyDwDrawEvent, dwDrawEventProblems } from './factions/dweghomActions';
import { SK_DRAW_EVENTS } from './factions/sorcererKings';
import { DW_DRAW_EVENTS } from './factions/dweghom';
import { applyPractitioner, canInduceAggression, decayWounds, degenerativeAura, isPractitioner, practitionerProblems, shrouded, strainFor } from './factions/spires';

// ---------------------------------------------------------------- Action bookkeeping

/**
 * Records an Action. Free or additional Actions earned this Activation (Double Time, Fire and
 * Advance, Fluid Formation, Flawless Drill) are used first when the two normal Actions are spent
 * (core p.25: never more than 3 Actions in total).
 */
export function recordAction(act: ActivationState, kind: ActionKind): void {
  const extra = act.extra?.find((e) => !e.used && e.kind === kind && (!e.first || act.actions.length === 0));
  // Extras in a group are a choice of one (Far Sight, Eye of the Storm; sk p.24, p.39).
  const spend = (e: NonNullable<typeof extra>) => {
    e.used = true;
    if (e.group) for (const o of act.extra ?? []) if (o.group === e.group) o.used = true;
  };
  // A free Spellcasting Action (od p.9, p.16, p.23), and free "anytime" or first-Action extras, never use up a normal Action.
  if (extra && extra.free && (kind === 'spell' || kind === 'ability' || extra.anytime || extra.first)) {
    spend(extra);
    return;
  }
  if (extra && (act.actions.length >= 2 || (extra.free && kind === 'reform' && act.actions.length === 0) || (extra.free && kind === 'combatReform'))) {
    spend(extra);
    return;
  }
  act.actions.push(kind);
}

/** Free Actions earned by Draw Events after an Action (core p.94). */
export function grantExtras(ctx: Ctx, act: ActivationState): void {
  const marches = act.actions.filter((k) => k === 'march').length;
  const add = (kind: ActionKind, reason: string, forwardOnly = false) => {
    if (act.extra?.some((e) => e.reason === reason)) return;
    (act.extra ??= []).push({ kind, reason, free: true, ...(forwardOnly ? { forwardOnly } : {}) });
    ev(ctx, { type: 'note', text: `${reason}: a free additional ${kind === 'march' ? 'March' : kind} Action (core p.94).` });
  };
  // Double Time: two Marches this Activation give a free additional March.
  if (act.drawEvents?.includes('Double Time') && marches >= 2) add('march', 'Double Time');
  // Fire and Advance: a Volley as the second Action gives a free March, not sideways or backward.
  if (act.drawEvents?.includes('Fire and Advance') && act.actions[1] === 'volley') add('march', 'Fire and Advance', true);
}

// ---------------------------------------------------------------- start and end of an Activation

/**
 * Start of a Regiment's Activation:
 * - Aura of Death (core p.97): enemies in contact inflict X Hits per Stand in contact (max 4 per
 *   non-Monster Stand), no Morale. If that destroys the Regiment, the card is discarded and the
 *   player draws again.
 * - Bravery (core p.97): the Broken status is removed.
 * - Fluid Formation (core p.98) and Flawless Drill (core p.98): free Reform / Combat Reform.
 * - Lobotomytic Override (Directorate): effects of a card that was put back.
 */
export function onActivationStart(ctx: Ctx, r: RegimentState, card: CommandCard | null): boolean {
  const s = ctx.s;
  const act = s.activation!;
  if (r.location === 'table') {
    const myPolys = regimentPolys(s, r);
    let hits = 0;
    for (const e of enemiesInContact(s, r)) {
      // Stabilize (the Pattern) (sk p.21), Venerable (dw p.29): no Aura of Death on it.
      if (r.flags.stabilized || hasRule(r.rules, 'Venerable')) break;
      const x = ruleX(e.rules, 'Aura of Death');
      if (!x) continue;
      const per = e.type === 'Monster' ? x : Math.min(4, x);
      const standsInContact = regimentPolys(s, e).filter((p) => myPolys.some((q) => polyDistance(p, q) <= TOL)).length;
      hits += per * standsInContact;
    }
    if (hits) {
      ev(ctx, { type: 'note', text: `Aura of Death: ${r.name} suffers ${hits} Hits as it activates (core p.97).`, regimentId: r.id });
      resolveAttack(ctx, { attackerOwner: r.owner === 'P1' ? 'P2' : 'P1', targetId: r.id, arc: 'front', pools: [{ label: 'Aura of Death', dice: 0, skill: 0, autoHits: hits }], morale: false, terrifying: 0, what: 'Aura of Death', kind: 'special' });
      if (isDestroyed(r)) {
        s.activation = null;
        ev(ctx, { type: 'note', text: `${r.name} is destroyed before its Draw Event: the card is discarded and its player may draw again (core p.97).` });
        return false;
      }
    }
  }
  if (r.broken && hasRule(r.rules, 'Bravery')) {
    r.broken = false;
    r.standsWhenBroken = null;
    ev(ctx, { type: 'note', text: `${r.name} has Bravery: it is no longer Broken (core p.97).`, regimentId: r.id });
  }
  if (hasRule(r.rules, 'Fluid Formation') && r.files <= 3) (act.extra ??= []).push({ kind: 'reform', reason: 'Fluid Formation', free: true });
  if (hasRule(r.rules, 'Flawless Drill') && !r.flags.flawlessDrillUsed) (act.extra ??= []).push({ kind: 'combatReform', reason: 'Flawless Drill', free: true });
  if (card?.lobotomy === 'bottom') {
    r.roundMods.push({ stat: 'A', delta: 2, source: 'Lobotomytic Override' });
    ev(ctx, { type: 'note', text: `Lobotomytic Override: ${r.name} gains +2 Attacks until the end of the Round.`, regimentId: r.id });
  }
  if (card?.lobotomy === 'top' && !act.entourage) {
    r.flags.noDecay = true;
    ev(ctx, { type: 'note', text: `Lobotomytic Override: ${r.name} may use Strain Expression without Decay this Activation.`, regimentId: r.id });
  }
  return true;
}

/**
 * End of a Regiment's Activation:
 * - Trample (X) (core p.101): one enemy in contact with the front arc suffers X automatic Hits per
 *   Stand with the rule, no Morale. Not at the end of a Character's own Activation.
 * - Decay (core p.97): 1 Wound per Stand (3 for a Monster), no Morale; Superior Creations: one
 *   fewer (Spires rule text).
 */
export function onActivationEnd(ctx: Ctx, act: ActivationState, r: RegimentState): void {
  const s = ctx.s;
  if (act.characterId || r.location !== 'table') return;
  const tr = ruleX(r.rules, 'Trample');
  if (tr) {
    const fp = footprintOf(s, r);
    const target = enemiesInContact(s, r).find((e) => regimentPolys(s, e).some((p) => arcsOf(fp, p).includes('front')));
    // Reinforce (the Pattern) (sk p.21): no Hits from Trample.
    if (target?.flags.reinforced) ev(ctx, { type: 'note', text: `${target.name} is Reinforced: no Hits from Trample (sk p.21).`, regimentId: target.id });
    else if (target) {
      const hits = tr * r.stands.length;
      ev(ctx, { type: 'note', text: `Trample: ${target.name} suffers ${hits} automatic Hits from ${r.name} (core p.101).` });
      resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: target.id, arc: 'front', pools: [{ label: 'Trample', dice: 0, skill: 0, autoHits: hits }], morale: false, terrifying: 0, what: 'Trample', kind: 'special' });
    }
  }
  if (hasRule(r.rules, 'Decay') && !r.flags.noDecay && !r.flags.stabilized && !isDestroyed(r)) {
    const { wounds: w, why } = decayWounds(s, r);
    ev(ctx, { type: 'note', text: `Decay: ${r.name} suffers ${w} Wound${w === 1 ? '' : 's'}, no Morale (core p.97${why.length ? `; ${why.join('; ')}` : ''}).`, regimentId: r.id });
    if (w > 0) {
      allocateWounds(ctx, r, w, r.owner === 'P1' ? 'P2' : 'P1');
      if (!isDestroyed(r)) degenerativeAura(ctx, r);
    }
  }
  r.flags.noDecay = false;
}

// ---------------------------------------------------------------- healing (core p.56)

export function canHeal(s: GameState, r: RegimentState): boolean {
  // Unhallowed Ground (od p.15, p.30): cannot be Healed.
  if (hasRule(r.rules, 'Unhallowed Ground')) return false;
  // Microbial Shroud (sp p.32): enemies within 8″ cannot Heal.
  if (shrouded(s, r)) return false;
  // Cauterize, Earthquake (sk p.18, p.25): cannot be Healed this Round.
  if (r.flags.cauterized || r.flags.quake) return false;
  // Broken Regiments cannot be Healed (core p.60), except [Drone] Regiments with Violent Delirium (Underspires).
  return !r.broken || (sectOf(s, r.owner) === 'underspires' && hasRole(r, 'Drone'));
}

/**
 * Heal (core p.56): remove the Character's Wound markers, then Wound markers from the Regiment
 * (starting with the Command Stand), then restore lost Stands when at least half their Wounds
 * remain to spend; a restored Stand comes back with that many Wounds left.
 */
export function heal(ctx: Ctx, r: RegimentState, points: number, why: string): void {
  const s = ctx.s;
  if (!canHeal(s, r)) {
    const sh = shrouded(s, r);
    ev(ctx, { type: 'note', text: hasRule(r.rules, 'Unhallowed Ground') ? `${r.name} has Unhallowed Ground and cannot be Healed (od p.15).` : sh ? `${r.name} is within 8″ of ${sh}'s Microbial Shroud and cannot be Healed (sp p.32).` : r.flags.cauterized ? `${r.name} is Cauterized and cannot be Healed this Round (sk p.18).` : r.flags.quake ? `${r.name} is in an Earthquake and cannot be Healed this Round (sk p.25).` : `${r.name} is Broken and cannot be Healed (core p.60).`, regimentId: r.id });
    return;
  }
  let left = points;
  const c = attachedCharacter(s, r.id);
  if (c && c.wounds) {
    const h = Math.min(left, c.wounds);
    c.wounds -= h;
    left -= h;
  }
  const order = [...r.stands].sort((a, b) => Number(b.isCommand) - Number(a.isCommand));
  for (const st of order) {
    const h = Math.min(left, st.wounds);
    st.wounds -= h;
    left -= h;
  }
  const W = Math.max(1, stat(r, 'W'));
  let restored = 0;
  while (r.stands.length < r.startingStands && left >= Math.ceil(W / 2)) {
    const use = Math.min(left, W);
    r.stands.push({ id: `${r.id}-h${s.round}-${r.stands.length}-${restored}`, wounds: W - use, isCommand: false });
    left -= use;
    restored++;
  }
  ev(ctx, { type: 'heal', text: `${r.name} Heals ${points - left} of ${points} (${why})${restored ? `, restoring ${restored} Stand${restored > 1 ? 's' : ''}` : ''} (core p.56).`, regimentId: r.id });
}

// ---------------------------------------------------------------- Draw Events (core p.94–95 and list rule text)

export const DRAW_EVENTS_AUTOMATED = [
  ...OD_DRAW_EVENTS,
  ...DW_DRAW_EVENTS,
  ...SK_DRAW_EVENTS.filter((d) => d !== 'Fan the Flames'),
  'Bastion',
  'Biotic Renewal',
  'Double Time',
  'Fire and Advance',
  'Flux-Powered',
  'Murderous Volley',
  'Regeneration',
  'Strain Expression',
  'Ferro-Ossified Carapace',
  'Suppress Higher Functions',
  'Epigenetic Trigger',
];

export function baseName(n: string): string {
  return n.replace(/\s*\(.*\)\s*$/, '').trim();
}

function regenerationValue(names: string[]): number {
  let base = 0;
  let plus = 0;
  for (const n of names) {
    const m = n.match(/^Regeneration\s*\((\+?)(\d+)\)/i);
    if (!m) continue;
    if (m[1]) plus += Number(m[2]);
    else base = Math.max(base, Number(m[2]));
  }
  return base + plus;
}

export interface DrawEventChoice {
  /** Flux-Powered: which bonus ('C' or 'A'); Old Dominion Draw Events: which effect. */
  option?: string;
  /** Dark Awakening: several effects. */
  options?: string[];
  /** Suppress Higher Functions: the friendly Regiment targeted. */
  targetId?: string;
}

export function drawEventProblems(s: GameState, name: string, choice: DrawEventChoice): string[] {
  const act = s.activation;
  if (!act) return ['No Activation in progress.'];
  if (act.actions.length) return ['Draw Events are resolved before the first Action (core p.23).'];
  const r = s.regiments[act.regimentId]!;
  const c: CharacterState | undefined = act.characterId ? s.characters[act.characterId] : undefined;
  const available = c ? c.drawEvents : r.drawEvents;
  if (!available.some((d) => baseName(d) === baseName(name))) return [`${name} is not one of this unit's Draw Events.`];
  const done = act.drawEvents ?? [];
  // Strain Expression (Spires) and Memories of Old (od p.7) may be used in addition to another Draw Event.
  const additional = (d: string) => d === 'Strain Expression' || d === 'Memories of Old';
  const isExtra = additional(baseName(name));
  // One Draw Event per Activation (core p.23).
  if (done.includes(baseName(name))) return [`${name} has already been resolved.`];
  if (!isExtra && done.some((d) => !additional(d))) return ['Only one Draw Event per Activation (core p.23).'];
  // Elemental Conduit (sk p.5) may be used in a Round in which the Regiment arrives.
  if (r.location !== 'table' && !(baseName(name) === 'Elemental Conduit' && r.location === 'arriving')) return ['Draw Events are not resolved while arriving from Reinforcements (core p.23).'];
  if (isOdDrawEvent(baseName(name))) return odDrawEventProblems(s, r, baseName(name), choice);
  if (SK_DRAW_EVENTS.includes(baseName(name))) return skDrawEventProblems(s, r, c, baseName(name), choice);
  if (DW_DRAW_EVENTS.includes(baseName(name))) return dwDrawEventProblems(s, r, c, baseName(name), choice);
  if (baseName(name) === 'Suppress Higher Functions' || baseName(name) === 'Epigenetic Trigger') {
    const t = choice.targetId ? s.regiments[choice.targetId] : r;
    if (!t || t.owner !== r.owner || t.location !== 'table') return ['Choose a friendly Regiment on the Battlefield.'];
    if (distancePolys(regimentPolys(s, r), regimentPolys(s, t)) > 12 + TOL) return [`${t.name} is more than 12″ away.`];
  }
  return [];
}

export function applyDrawEvent(ctx: Ctx, name: string, choice: DrawEventChoice): void {
  const s = ctx.s;
  const act = s.activation!;
  const r = s.regiments[act.regimentId]!;
  const c = act.characterId ? s.characters[act.characterId] : undefined;
  const bn = baseName(name);
  (act.drawEvents ??= []).push(bn);
  act.drawEventDone = true;
  const x = (() => {
    const m = name.match(/\((\+?\d+)\)/);
    return m ? Number(m[1]!.replace('+', '')) : 0;
  })();
  switch (bn) {
    case 'Bastion':
      r.roundMods.push({ stat: 'D', delta: x, source: 'Bastion' });
      ev(ctx, { type: 'draw-event', text: `Bastion (${x}): ${r.name} +${x} Defense until the end of the Round (core p.94).`, regimentId: r.id });
      return;
    case 'Biotic Renewal': {
      const [d] = rollN(ctx, 1) as [number];
      const pts = r.type === 'Infantry' ? d : Math.ceil(d / 2);
      ev(ctx, { type: 'dice', text: `Biotic Renewal: rolled ${d}${r.type === 'Infantry' ? '' : ' → D3 ' + pts} (core p.94).`, dice: { purpose: 'Biotic Renewal', seed: ctx.rng.seed, index: ctx.rng.index - 1, values: [d] } });
      heal(ctx, r, pts, 'Biotic Renewal');
      return;
    }
    case 'Double Time':
    case 'Fire and Advance':
      ev(ctx, { type: 'draw-event', text: `${bn}: ${r.name} may earn a free March this Activation (core p.94).`, regimentId: r.id });
      return;
    case 'Flux-Powered': {
      const k = choice.option === 'A' ? 'A' : 'C';
      r.roundMods.push({ stat: k, delta: 2, source: 'Flux-Powered' });
      ev(ctx, { type: 'draw-event', text: `Flux-Powered: ${r.name} +2 ${k === 'C' ? 'Clash' : 'Attacks'} until the end of the Round (core p.94).`, regimentId: r.id });
      return;
    }
    case 'Murderous Volley':
      r.roundRules.push({ name: 'Murderous Volley', raw: 'Murderous Volley' });
      ev(ctx, { type: 'draw-event', text: `Murderous Volley: after Taking Aim, ${r.name}'s Volley Wounds within 12″ cause Morale Tests this Round (core p.95).`, regimentId: r.id });
      return;
    case 'Regeneration': {
      const v = regenerationValue((c ? c.drawEvents : r.drawEvents).filter((d) => baseName(d) === 'Regeneration'));
      if (c) {
        // A Character's own Regeneration heals only the Character (core p.95).
        const h = Math.min(v, c.wounds);
        c.wounds -= h;
        ev(ctx, { type: 'heal', text: `Regeneration (${v}): ${c.name} heals ${h} (core p.95).` });
      } else heal(ctx, r, v, `Regeneration (${v})`);
      return;
    }
    case 'Strain Expression': {
      // Induced Aggression (Pheromancer Warlord, sp p.6): instead of the Strain, +1 Clash (max 4) and +1 March.
      const aggression = choice.option === 'aggression' && canInduceAggression(s, r);
      const def = aggression ? undefined : strainFor(s, r);
      if (aggression) {
        const dc = Math.max(0, Math.min(1, 4 - stat(r, 'C')));
        if (dc) r.roundMods.push({ stat: 'C', delta: dc, source: 'Induced Aggression' });
        r.roundMods.push({ stat: 'M', delta: 1, source: 'Induced Aggression' });
      }
      if (def) {
        for (const [k, d] of Object.entries(def.stats)) if (d) r.roundMods.push({ stat: k as keyof typeof def.stats, delta: d, source: 'Strain' });
        r.roundRules.push(...def.rules);
      }
      if (!r.flags.noDecay) r.roundRules.push({ name: 'Decay', raw: 'Decay' });
      r.flags.decay = true;
      ev(ctx, {
        type: 'draw-event',
        text: `Strain Expression: ${r.name} ${aggression ? 'uses Induced Aggression: +1 Clash (max 4) and +1 March' : def ? `gains its Strain: ${def.text || 'as entered'}${def.rules.length ? ` (${def.rules.map((x) => x.raw).join(', ')})` : ''}${Object.keys(def.stats).length ? ` ${Object.entries(def.stats).map(([k, v]) => `${k}${(v ?? 0) > 0 ? '+' : ''}${v}`).join(' ')}` : ''}` : 'has no Strain (none typed, none built in): no benefit applied'}${r.flags.noDecay ? ', without Decay (Lobotomytic Override)' : ' and suffers Decay until the end of the Round'}.`,
        regimentId: r.id,
      });
      return;
    }
    case 'Ferro-Ossified Carapace':
      r.roundRules.push({ name: 'Hardened', x: 1, raw: 'Hardened (1)' });
      ev(ctx, { type: 'draw-event', text: `Ferro-Ossified Carapace: ${r.name} gains Hardened (1) until the end of the Round.`, regimentId: r.id });
      return;
    case 'Epigenetic Trigger': {
      // Biomancer (sp p.9): a friendly Regiment within 12″; its Command Stand +2 Attacks until the end of the Round.
      const t = choice.targetId ? s.regiments[choice.targetId]! : r;
      t.flags.epigenetic = true;
      ev(ctx, { type: 'draw-event', text: `Epigenetic Trigger: ${t.name}'s Command Stand adds +2 Attacks until the end of the Round (sp p.9).`, regimentId: t.id });
      return;
    }
    case 'Suppress Higher Functions': {
      const t = choice.targetId ? s.regiments[choice.targetId]! : r;
      t.roundRules.push({ name: 'Fearless', raw: 'Fearless' });
      ev(ctx, { type: 'draw-event', text: `Suppress Higher Functions: ${t.name} gains Fearless until the end of the Round.`, regimentId: t.id });
      return;
    }
    default:
      if (isOdDrawEvent(bn)) {
        applyOdDrawEvent(ctx, r, bn, choice);
        return;
      }
      if (SK_DRAW_EVENTS.includes(bn)) {
        applySkDrawEvent(ctx, r, c, bn, choice);
        return;
      }
      if (DW_DRAW_EVENTS.includes(bn)) {
        applyDwDrawEvent(ctx, r, c, bn, choice);
        return;
      }
      ev(ctx, { type: 'manual', text: `Draw Event: ${name} (manual — apply its effect with the manual tools).`, regimentId: r.id });
  }
}

// ---------------------------------------------------------------- Character abilities from the lists

export const CHARACTER_ABILITIES_AUTOMATED = ['Snapshot', 'Mighty Swing', 'Break Their Lines'];

export function characterAbilityProblems(s: GameState, c: CharacterState, name: string, targetId?: string, target2Id?: string): string[] {
  if (isPractitioner(name)) return practitionerProblems(s, c, name, { ...(targetId ? { targetId } : {}), ...(target2Id ? { target2Id } : {}) });
  const r = c.attachedTo ? s.regiments[c.attachedTo] : undefined;
  if (!r || r.location !== 'table') return ['The Character must be on the Battlefield.'];
  const bn = baseName(name);
  if (bn === 'Snapshot') {
    // Out-of-Combat: an enemy within Line of Sight and the Character's Barrage range.
    if (isEngaged(s, r)) return ['Snapshot is an Out-of-Combat Action.'];
    const t = targetId ? s.regiments[targetId] : undefined;
    const b = barrageOf(c.rules);
    if (!t || t.owner === r.owner || t.location !== 'table') return ['Choose an enemy Regiment.'];
    if (!b) return ['The Character has no Barrage.'];
    if (!hasLineOfSight(s, r, t)) return [`${t.name} is not in Line of Sight.`];
    const slot = layout(formationInput(s, r)).find((x) => x.isCharacter);
    const from = slot ? [rectPoly(slot.rect)] : regimentPolys(s, r);
    if (distancePolys(from, regimentPolys(s, t)) > b.range + TOL) return [`${t.name} is beyond the Character's Barrage range (${b.range}″).`];
    return [];
  }
  if (bn === 'Mighty Swing') {
    const t = targetId ? s.regiments[targetId] : undefined;
    if (!t || !enemiesInContact(s, r).some((e) => e.id === t.id)) return ['Choose an enemy Regiment engaged with the Character’s Regiment.'];
    return [];
  }
  if (bn === 'Break Their Lines') return hasRule(r.rules, 'Linebreaker') ? [`${r.name} already has Linebreaker.`] : [];
  return [];
}

export function applyCharacterAbility(ctx: Ctx, c: CharacterState, name: string, targetId?: string, target2Id?: string): void {
  if (isPractitioner(name)) {
    applyPractitioner(ctx, c, name, { ...(targetId ? { targetId } : {}), ...(target2Id ? { target2Id } : {}) }, heal);
    return;
  }
  const s = ctx.s;
  const bn = baseName(name);
  if ((bn === 'Snapshot' || bn === 'Mighty Swing') && targetId) {
    const t = s.regiments[targetId]!;
    const owner = s.regiments[c.attachedTo!]!.owner;
    ev(ctx, { type: 'action', text: `${c.name} uses ${bn}: ${t.name} suffers 1 Wound (no Resolve tests).`, player: owner });
    allocateWounds(ctx, t, 1, owner);
    return;
  }
  // Implacable (od p.21): every Stand in the Character's Regiment gains Linebreaker.
  // RULE-AMBIGUITY: AMB-88 — no duration is given; it lasts until the end of the Round.
  if (bn === 'Break Their Lines') {
    const r = s.regiments[c.attachedTo!]!;
    r.roundRules.push({ name: 'Linebreaker', raw: 'Linebreaker (Break Their Lines)' });
    ev(ctx, { type: 'action', text: `${c.name} uses Break Their Lines: ${r.name} gains Linebreaker until the end of the Round (od p.21).`, player: r.owner, regimentId: r.id });
    return;
  }
  ev(ctx, { type: 'manual', text: `${c.name} uses ${name} (manual: apply its effect with the manual tools).` });
}

export { charStat };
