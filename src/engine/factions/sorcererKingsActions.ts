import { heal } from '../activation';
import { resolveAttack } from '../combat';
import { ev, type Ctx } from '../dice';
import { TOL } from '../geometry/vec';
import type { ActivationState, CharacterState, CommandCard, GameState, PlayerId, RegimentState } from '../model/types';
import { attachedCharacter, distancePolys, enemiesTouching, regimentPolys } from '../queries';
import { hasRule } from '../rules/special/rules';
import { piecesUnder } from '../terrain';
import { passTurn } from '../round';
import {
  RITUALS,
  addMarkers,
  checkRitualAccess,
  checkShattered,
  elementalKind,
  isElemental,
  isMahabharati,
  isMortal,
  ofCourt,
  regimentCourts,
  removeMarkers,
  sk,
  skUnit,
  warlordHas,
} from './sorcererKings';
import { inflame } from './sorcererKingsSpells';
import { resolveRitual, ritualProblems, type RitualChoice } from './sorcererKingsRituals';

/** Sorcerer Kings Actions, Draw Events and Activation hooks (sk p.5–46). */

// ---------------------------------------------------------------- Ritual cards (sk p.5)

export function ritualActionProblems(s: GameState, p: PlayerId, ch: RitualChoice): string[] {
  if (s.step !== 'action' || !s.drawn || s.drawn.player !== p || s.drawn.card.kind !== 'ritual') return ['No Ritual Command Card has been drawn.'];
  return ritualProblems(s, p, s.drawn.card.refId, ch);
}

/**
 * Resolves the drawn Ritual card (sk p.5). Then (sk p.22, p.24) the same player draws the next
 * card: a Regiment of the Ritual's Court may Activate at once, otherwise the card goes back on top.
 */
export function applyRitualCard(ctx: Ctx, p: PlayerId, ch: RitualChoice): void {
  const s = ctx.s;
  const name = s.drawn!.card.refId;
  s.drawn = null;
  resolveRitual(ctx, p, name, ch);
  const st = sk(s, p)!;
  st.follow = name === 'Far Sight' ? 'any' : RITUALS[name]!.court;
  st.lastRitual = name;
  if (s.players[p].stack.length) s.turn = p;
  else {
    st.follow = null;
    passTurn(s, p);
  }
}

function cardCourtOk(s: GameState, card: CommandCard, court: string): boolean {
  if (court === 'any') return true;
  if (card.kind === 'ritual') return false;
  if (card.kind === 'character') {
    const c = s.characters[card.refId];
    const host = c?.attachedTo ? s.regiments[c.attachedTo] : undefined;
    // RULE-AMBIGUITY: AMB-71 — a Character card counts by its Regiment's Court.
    return !!host && regimentCourts(s, host).includes(court as never);
  }
  const r = s.regiments[card.refId];
  return !!r && regimentCourts(s, r).includes(court as never);
}

/**
 * After drawing (applyM4 'drawCard'): the card drawn right after a Ritual. Returns false when it
 * went back on top of the stack and play passed.
 */
export function afterRitualDraw(ctx: Ctx, p: PlayerId, follow: string | null, lastRitual: string | null): void {
  const s = ctx.s;
  if (!follow || !s.drawn) return;
  const card = s.drawn.card;
  if (!cardCourtOk(s, card, follow)) {
    s.players[p].stack.unshift(card);
    s.drawn = null;
    ev(ctx, { type: 'draw', text: `${card.name} ${card.kind === 'ritual' ? 'is another Ritual card, not' : 'is not'} a [Court of ${follow}] Regiment: it goes back on top of the Command Stack and play passes (sk p.22).`, player: p });
    passTurn(s, p);
    return;
  }
  s.drawn.afterRitual = lastRitual ?? undefined;
  ev(ctx, { type: 'draw', text: `${card.name} may Activate straight after the Ritual ${lastRitual} (sk p.22).`, player: p });
}

// ---------------------------------------------------------------- Activation hooks

export function skActivationStart(ctx: Ctx, r: RegimentState, afterRitual: string | undefined): void {
  const s = ctx.s;
  const act = s.activation!;
  if (!s.players[r.owner].sk) return;
  if (afterRitual) act.afterRitual = afterRitual;
  const u = skUnit(r);
  const ch = act.characterId;
  const airRitual = !!afterRitual && RITUALS[afterRitual]?.court === 'Air';
  if (!ch) {
    // Marid Sahar (sk p.44): one free Spellcasting Action.
    if (u?.freeSpell) (act.extra ??= []).push({ kind: 'spell', reason: 'Marid Sahar', free: true });
    // Mahut (sk p.42): a free Volley, never more than one Volley.
    if (u?.freeVolley) (act.extra ??= []).push({ kind: 'volley', reason: 'Mahut', free: true, anytime: true });
    // Arrogance (sk p.34): a free Duel Action, as if it were a Character Stand.
    if (u?.chargeVs === 'character') (act.extra ??= []).push({ kind: 'duel', reason: 'Arrogance', free: true, anytime: true });
    // Raging Elements (sk p.41): an additional Clash Action.
    if (u?.shattered === 'raging' && r.flags.shattered) (act.extra ??= []).push({ kind: 'clash', reason: 'Raging Elements' });
    if (afterRitual === 'Far Sight' && ofCourt(s, r, 'Air')) {
      (act.extra ??= []).push({ kind: 'charge', reason: 'Far Sight', free: true, first: true, group: 'Far Sight' }, { kind: 'takeAim', reason: 'Far Sight', free: true, first: true, group: 'Far Sight' });
      ev(ctx, { type: 'ritual', text: `Far Sight: ${r.name} may make a free Charge or Take Aim as its first Action (sk p.24).`, regimentId: r.id });
    }
    if (airRitual && u?.afterAirRitual === 'fury') {
      r.roundRules.push({ name: 'Relentless Blows', x: 2, raw: 'Relentless Blows (2) — Fury of the Tempest' });
      ev(ctx, { type: 'note', text: `Fury of the Tempest: ${r.name}'s Relentless Blows work on Hit Rolls of 1 and 2 this Activation (sk p.38).`, regimentId: r.id });
    }
    if (airRitual && u?.afterAirRitual === 'eye') {
      (act.extra ??= []).push({ kind: 'volley', reason: 'Eye of the Storm', free: true, anytime: true, group: 'Eye of the Storm' }, { kind: 'spell', reason: 'Eye of the Storm', free: true, group: 'Eye of the Storm' });
      ev(ctx, { type: 'note', text: `Eye of the Storm: ${r.name} may make a free Volley or a free Spellcasting Action (sk p.39).`, regimentId: r.id });
    }
    if (afterRitual === 'Conflagration' && elementalKind(r, 'Fire') && ofCourt(s, r, 'Fire')) {
      r.roundRules.push({ name: 'Inspired', raw: 'Inspired' }, { name: 'Aimed Shot', raw: 'Aimed Shot' });
      ev(ctx, { type: 'ritual', text: `Conflagration: ${r.name} gains Inspired and Aimed Shot until the end of the Round (sk p.22).`, regimentId: r.id });
    }
  }
}

export function skActivationEnd(ctx: Ctx, act: ActivationState, r: RegimentState): void {
  const s = ctx.s;
  if (!s.players[r.owner].sk) return;
  // Conflagration (sk p.22): enemies engaged during this Activation become Inflamed.
  if (act.afterRitual === 'Conflagration' && elementalKind(r, 'Fire') && r.location === 'table') for (const e of enemiesTouching(s, r)) inflame(ctx, e, 'Conflagration');
  r.roundRules = r.roundRules.filter((x) => x.raw !== 'Relentless Blows (2) — Fury of the Tempest');
}

/** After every Action: Ritual access, first time below starting strength, Air Elemental, Kiss of the Earth, Last Word. */
export function skAfterApply(ctx: Ctx): void {
  const s = ctx.s;
  if (!s.players.P1.sk && !s.players.P2.sk) return;
  checkRitualAccess(ctx);
  checkShattered(ctx);
  const act = s.activation;
  const r = act ? s.regiments[act.regimentId] : undefined;
  if (act && r && !act.characterId) {
    const moved = act.actions.includes('march') || act.actions.includes('charge') || !!act.extra?.some((e) => e.used && e.kind === 'charge');
    // Kiss of the Earth (sk p.25): only its first March or Charge.
    if (r.flags.kissOfEarth && moved) {
      r.flags.kissOfEarth = false;
      ev(ctx, { type: 'note', text: `Kiss of the Earth no longer slows ${r.name}.`, regimentId: r.id });
    }
    // Air Elemental (sk p.36–39): the first March of an Activation gives +1 Evasion (to at most 3) until the end of the Round.
    if (s.players[r.owner].sk && elementalKind(r, 'Air') && act.actions.includes('march') && !r.roundMods.some((m) => m.source === 'Air Elemental')) {
      const E = (r.profile.E ?? 0) + r.roundMods.filter((m) => m.stat === 'E').reduce((a, m) => a + m.delta, 0);
      r.roundMods.push({ stat: 'E', delta: E < 3 ? 1 : 0, source: 'Air Elemental' });
      if (E < 3) ev(ctx, { type: 'note', text: `Air Elemental: ${r.name} has +1 Evasion until the end of the Round (sk p.36).`, regimentId: r.id });
    }
  }
  lastWord(ctx);
}

/**
 * Last Word (Rakshasa, sk p.34–35): when destroyed, an enemy within 8″ of a friendly Character or
 * Wizard suffers 8 automatic Hits on its flank, no Morale.
 * RULE-AMBIGUITY: AMB-72 — the engine picks the target: the enemy with the lowest Defense, then most Stands.
 */
function lastWord(ctx: Ctx): void {
  const s = ctx.s;
  for (const r of Object.values(s.regiments)) {
    if (r.location !== 'destroyed' || !skUnit(r)?.lastWord || r.flags.lastWordDone || !s.players[r.owner].sk) continue;
    r.flags.lastWordDone = true;
    const sources = Object.values(s.regiments).filter((f) => f.owner === r.owner && f.location === 'table' && (hasRule(f.rules, 'Wizard') || !!attachedCharacter(s, f.id)));
    const cands = Object.values(s.regiments).filter((e) => e.owner !== r.owner && e.location === 'table' && sources.some((f) => distancePolys(regimentPolys(s, f), regimentPolys(s, e)) <= 8 + TOL));
    const t = cands.sort((a, b) => (a.profile.D ?? 0) - (b.profile.D ?? 0) || b.stands.length - a.stands.length)[0];
    if (!t) {
      ev(ctx, { type: 'note', text: `Last Word: no enemy within 8″ of a friendly Character or Wizard (sk p.34).`, regimentId: r.id });
      continue;
    }
    ev(ctx, { type: 'note', text: `Last Word: ${r.name} is destroyed; ${t.name} suffers 8 automatic Hits on its flank, no Morale (sk p.34; target picked by the engine, AMB-72).`, regimentId: t.id });
    resolveAttack(ctx, { attackerOwner: r.owner, targetId: t.id, arc: 'left', pools: [{ label: 'Last Word', dice: 0, skill: 0, autoHits: 8 }], morale: false, terrifying: 0, what: 'Last Word', kind: 'special' });
  }
}

// ---------------------------------------------------------------- Forms (sk p.43–46)

export function formProblems(s: GameState, regimentId: string, group: string, option: string): string[] {
  const act = s.activation;
  const r = s.regiments[regimentId];
  if (!act || !r || act.regimentId !== r.id || act.characterId) return ['Choose a Form when Activating the Regiment.'];
  const f = skUnit(r)?.forms?.find((x) => x.group === group);
  if (!f || !f.options.some((o) => o.id === option)) return [`${r.name} has no such choice.`];
  if (act.actions.length) return [`${group} is chosen when Activating, before the first Action.`];
  if ((act.drawEvents ?? []).includes(group)) return [`${group} has already been chosen.`];
  return [];
}

export function applyForm(ctx: Ctx, regimentId: string, group: string, option: string): void {
  const s = ctx.s;
  const r = s.regiments[regimentId]!;
  const act = s.activation!;
  (act.drawEvents ??= []).push(group);
  const label = skUnit(r)!.forms!.find((x) => x.group === group)!.options.find((o) => o.id === option)!.label;
  const rr = (raw: string, name: string, x: number) => r.roundRules.push({ name, x, plus: true, raw });
  switch (`${group}:${option}`) {
    case 'Wavebreaker Form:impact':
      rr('Impact (+2)', 'Impact', 2);
      break;
    case 'Wavebreaker Form:brutal':
      rr('Brutal Impact (+1)', 'Brutal Impact', 1);
      break;
    case 'Waveborne Form:wizard':
      rr('Wizard (+2)', 'Wizard', 2);
      break;
    case 'Waveborne Form:barrage':
      rr('Barrage (+2)', 'Barrage', 2);
      break;
    case 'Stormqueen Form:impact':
      rr('Impact (+6)', 'Impact', 6);
      break;
    case 'Stormqueen Form:attacks':
      r.roundMods.push({ stat: 'A', delta: 4, source: 'Stormqueen Form' });
      break;
    case 'Arcane Tide Form:free':
      (act.extra ??= []).push({ kind: 'spell', reason: 'Arcane Tide Form', free: true });
      break;
    case 'Arcane Tide Form:range':
      r.flags.form = 'range';
      break;
    case 'Tidecaller:aura':
    case 'Tidecaller:engaged':
      r.flags.tidecaller = option;
      break;
  }
  ev(ctx, { type: 'draw-event', text: `${r.name} chooses ${group}: ${label} (sk p.${skUnit(r)!.page}).`, player: r.owner, regimentId: r.id });
}

// ---------------------------------------------------------------- Gilded Statue (Mahut, sk p.42)

export function gildedProblems(s: GameState, r: RegimentState): string[] {
  if (r.name !== 'Mahut') return ['Only a Mahut has Gilded Statue.'];
  if (!regimentPolys(s, r).some((q) => piecesUnder(s, q).length)) return ['The Mahut must be within a piece of terrain.'];
  return [];
}

export function applyGilded(ctx: Ctx, r: RegimentState): void {
  const s = ctx.s;
  const piece = regimentPolys(s, r).flatMap((q) => piecesUnder(s, q))[0]!;
  if (!piece.keywords.includes('Earth')) piece.keywords = [...piece.keywords, 'Earth'];
  // Keep it when Round-limited keyword changes are restored.
  const keep = s.terrainRestore?.[piece.id];
  if (keep && !keep.includes('Earth')) keep.push('Earth');
  ev(ctx, { type: 'action', text: `Gilded Statue: ${piece.kind} ${piece.id} gains the Earth keyword until the end of the game (sk p.42).`, player: r.owner, regimentId: r.id });
}

// ---------------------------------------------------------------- Draw Events

export { SK_DRAW_EVENTS } from './sorcererKings';

export interface SkDrawChoice {
  option?: string;
  targetId?: string;
}

export function skDrawEventProblems(s: GameState, r: RegimentState, c: CharacterState | undefined, name: string, ch: SkDrawChoice): string[] {
  const st = sk(s, r.owner);
  const from = regimentPolys(s, r);
  const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
  const within12 = (x: RegimentState) => x.location === 'table' && distancePolys(from, regimentPolys(s, x)) <= 12 + TOL;
  switch (name) {
    case 'Elemental Conduit':
      return [];
    case 'Elemental Prowess': {
      const n = ch.option === '5' ? 5 : 3;
      if (!st?.preparing || st.preparing.markers < n) return [`Needs ${n} Ritual Markers on the Ritual Being Prepared.`];
      if (!t || t.owner !== r.owner || !isElemental(t) || !within12(t)) return ['Choose a friendly [Elemental] Regiment within 12″.'];
      return [];
    }
    case 'Elemental Assault': {
      if (!c) return ['Elemental Assault is the Mahabharati Sardar’s Draw Event.'];
      if (!st?.preparing || st.preparing.markers < 3) return ['Needs 3 Ritual Markers on the Ritual Being Prepared.'];
      if (!t || t.owner !== r.owner || !(isMortal(t) || isMahabharati(t)) || !within12(t)) return ['Choose a friendly [Mortal] or [Mahabharati] Regiment within 12″.'];
      if (ch.option !== 'Untouchable' && ch.option !== 'Relentless Blows') return ['Choose Untouchable or Relentless Blows.'];
      return [];
    }
    case 'Dancing Scimitar':
      if (!t || t.owner === r.owner || !within12(t)) return ['Choose an enemy Regiment within 12″.'];
      return [];
  }
  return [];
}

export function applySkDrawEvent(ctx: Ctx, r: RegimentState, c: CharacterState | undefined, name: string, ch: SkDrawChoice): void {
  const s = ctx.s;
  const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
  switch (name) {
    case 'Elemental Conduit': {
      // Elemental Confluence (Maharajah Warlord, sk p.6): to any Ritual.
      const court = warlordHas(s, r.owner, 'Elemental Confluence') ? 'any' : regimentCourts(s, r)[0];
      if (!court) return void ev(ctx, { type: 'note', text: `Elemental Conduit: ${r.name} has no Court, so it adds no Ritual Marker.`, regimentId: r.id });
      if (!sk(s, r.owner)?.preparing) return void ev(ctx, { type: 'draw-event', text: 'Elemental Conduit: no Ritual is Being Prepared.', regimentId: r.id });
      addMarkers(ctx, r.owner, 1, court, `Elemental Conduit (${r.name})`);
      return;
    }
    case 'Elemental Prowess': {
      const n = ch.option === '5' ? 5 : 3;
      removeMarkers(ctx, r.owner, n, `Elemental Prowess (${r.name}, sk p.28)`);
      heal(ctx, t!, 4, 'Elemental Prowess');
      // RULE-AMBIGUITY: AMB-73 — "until the end of its next Activation" is read as until the end of the Round.
      if (n === 5) {
        r.roundRules.push({ name: 'Blessed', raw: 'Blessed' });
        ev(ctx, { type: 'draw-event', text: `${r.name} gains Blessed (Elemental Prowess).`, regimentId: r.id });
      }
      return;
    }
    case 'Elemental Assault': {
      removeMarkers(ctx, r.owner, 3, `Elemental Assault (${c!.name}, sk p.14)`);
      t!.roundRules.push({ name: ch.option!, raw: ch.option! });
      ev(ctx, { type: 'draw-event', text: `${t!.name} gains ${ch.option} until the end of the Round (Elemental Assault).`, regimentId: t!.id });
      // Sorcerous Blessing (sk p.14): the Sardar's Regiment gains Cleave (+1) and Fearless this Round.
      r.flags.blessing = true;
      ev(ctx, { type: 'draw-event', text: `Sorcerous Blessing: ${r.name} gains Cleave (+1) and Fearless until the end of the Round.`, regimentId: r.id });
      return;
    }
    case 'Dancing Scimitar':
      ev(ctx, { type: 'draw-event', text: `Dancing Scimitar: ${t!.name} suffers 3 automatic Hits with Armor Piercing (2), no Morale (sk p.16).`, regimentId: t!.id });
      resolveAttack(ctx, { attackerOwner: r.owner, attackerId: r.id, targetId: t!.id, arc: 'front', pools: [{ label: 'Dancing Scimitar', dice: 0, skill: 0, autoHits: 3, reduceD: 2 }], morale: false, terrifying: 0, what: 'Dancing Scimitar', kind: 'special' });
      return;
    case 'Fan the Flames':
      // RULE-AMBIGUITY: AMB-74 — the Raj's Elemental Dominion names this Draw Event but the list does not define it.
      // It has no effect until the list defines it; a group ruling can still be applied with the override tools.
      ev(ctx, { type: 'note', text: 'Fan the Flames: the army list names this Draw Event but does not define it, so it has no effect (AMB-74).', regimentId: r.id });
      return;
  }
}

// ---------------------------------------------------------------- Victory Phase (sk p.17)

/** Prince of the Setting Moon (Warlord): friendly [Mortals] within range of an Objective Zone Heal 3. */
export function skVictoryStart(ctx: Ctx, inZoneRange: (r: RegimentState) => boolean): void {
  const s = ctx.s;
  for (const p of ['P1', 'P2'] as const) {
    if (!s.players[p].sk) continue;
    const w = Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p));
    if (!w || w.destroyed || !w.attachedTo || s.regiments[w.attachedTo]?.location !== 'table' || !w.options.some((o) => o.toLowerCase() === 'prince of the setting moon')) continue;
    for (const r of Object.values(s.regiments)) if (r.owner === p && r.location === 'table' && isMortal(r) && inZoneRange(r)) heal(ctx, r, 3, 'Prince of the Setting Moon (sk p.17)');
  }
}

/** Cyclone (sk p.20): engaged with a [Court of Air] Regiment in the Victory Phase, it counts as 0 Stands. */
export function cycloned(s: GameState, r: RegimentState): boolean {
  return !!r.flags.cyclone && enemiesTouching(s, r).some((e) => ofCourt(s, e, 'Air'));
}

/** Volley while in contact (Eye of the Storm, Mahut; sk p.39, p.42): only at the enemy in contact. */
export function volleyInContact(s: GameState, r: RegimentState, t: RegimentState): 'ok' | 'no' | 'wrong' {
  if (!skUnit(r)?.volleyInContact || !s.players[r.owner].sk) return 'no';
  return enemiesTouching(s, r).some((e) => e.id === t.id) ? 'ok' : 'wrong';
}

