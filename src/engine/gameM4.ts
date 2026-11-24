import { applyCharacterAbility, applyDrawEvent, characterAbilityProblems, drawEventProblems, onActivationEnd, onActivationStart, recordAction } from './activation';
import { sectOf } from './rules/special/grants';
import { activateMemories, blasphemousSoma, warlordHas } from './factions/oldDominion';
import { applyOdSpend, applyOdSupremacy, isOdSupremacy, memoriesProblems, odActivationStartSpells, odSpendProblems, odSupremacyProblems } from './factions/oldDominionActions';
import { castSpell, casterOf, spellProblems } from './spells';
import { hasRule } from './rules/special/rules';
import {
  applyCharge,
  applyClash,
  applyCombatReform,
  applyDuel,
  applyVolley,
  applyWithdraw,
  chargeProblems,
  clashTargets,
  completeCharge,
  duelTargets,
  enemiesInContact,
  fearsomeCheck,
  planVolley,
  volleyAimed,
  withdrawPose,
  withdrawProblems,
} from './actions';
import { allocateWounds, checkBroken } from './combat';
import { ev, type Ctx } from './dice';
import { clampFiles } from './formation';
import type { Arc } from './geometry/arcs';
import { marchShapeProblems } from './movement';
import type { Action } from './game';
import type { ActionKind, GameState, RegimentState } from './model/types';
import {
  anyOverlap,
  attachedCharacter,
  canTakeAction,
  distancePolys,
  fail,
  footprintWidth,
  isEngaged,
  marchValue,
  ok,
  onTableRegiments,
  regimentPolys,
  regimentStandCount,
  type Validation,
} from './queries';
import {
  buildCards,
  cardTargets,
  doReinforcements,
  drawCard,
  passTurn,
  reinforcementChoiceProblems,
  stackProblems,
  supremacyRollOff,
} from './round';
import { barrageOf, manualRules } from './rules/special/rules';
import {
  applyMarkerCharge,
  applyMarkerClash,
  attackMarker,
  isMarkerTarget,
  markerAttackProblems,
  markerChargeProblems,
  markerId,
  markerInContact,
  markerVolleyPlan,
} from './markers';
import { zoneResults } from './scoring/victory';
import { TOL } from './geometry/vec';

function reg(s: GameState, id: string): RegimentState | undefined {
  return s.regiments[id];
}

function act(s: GameState, regimentId: string, kind: ActionKind, extra: () => string[]): Validation {
  const r = reg(s, regimentId);
  if (!r) return fail('Unknown Regiment.');
  const p = [...canTakeAction(s, regimentId, kind), ...extra()];
  return p.length ? fail(...p) : ok();
}

export function validateM4(s: GameState, a: Action): Validation {
  switch (a.type) {
    case 'reinforcements': {
      if (s.phase !== 'play' || s.step !== 'reinforcement') return fail('Not in the Reinforcement Phase.');
      if (s.players[a.player].reinforcementDone) return fail(`${a.player} has already rolled for Reinforcements this Round.`);
      const p = reinforcementChoiceProblems(s, a.player, a.choice, a.flank ?? {});
      return p.length ? fail(...p) : ok();
    }
    case 'setStack': {
      if (s.step !== 'command') return fail('Not in the Command Phase.');
      if (s.players[a.player].stackSet) return fail(`${a.player} has already set their Command Stack.`);
      const p = stackProblems(s, a.player, a.order);
      return p.length ? fail(...p) : ok();
    }
    case 'supremacyRollOff':
      return s.step === 'supremacy' && !s.supremacyWinner ? ok() : fail('Not time for the Supremacy roll-off.');
    case 'chooseFirst':
      return s.step === 'supremacy' && s.supremacyWinner ? ok() : fail('Roll off for Supremacy first.');
    case 'useSupremacy': {
      if (s.step !== 'supremacy') return fail('[Activated] Supremacy Abilities are used in the Supremacy Phase (core p.22).');
      // Master of the Legions (Strategos, od p.9): may be used at the end of each Supremacy Phase.
      const everyRound = warlordHas(s, a.player, 'Master of the Legions');
      if (s.players[a.player].supremacyUsed && !everyRound) return fail('Already used this battle (core p.22).');
      const w = Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(a.player));
      if (!w || w.destroyed || !w.attachedTo || s.regiments[w.attachedTo]?.location !== 'table') return fail('The Warlord must be on the Battlefield (core p.22).');
      if (isOdSupremacy(s, a.player)) {
        const p = odSupremacyProblems(s, a.player, a.targets ?? []);
        if (p.length) return fail(...p);
      }
      return ok();
    }
    case 'pickZone': {
      const zp = s.scenario.zonePick;
      if (!zp || s.step !== 'supremacy' || !s.firstPlayer) return fail('No zone to pick now.');
      const second = s.firstPlayer === 'P1' ? 'P2' : 'P1';
      const next = s.zonePicks[s.firstPlayer] === null ? s.firstPlayer : s.zonePicks[second] === null ? second : null;
      if (next !== a.player) return fail(`It is ${next ?? 'nobody'}'s turn to pick a zone (First Player first).`);
      if (zp.eligibleZoneIds && !zp.eligibleZoneIds.includes(a.zoneId)) return fail('That zone cannot be picked in this scenario.');
      if (!s.scenario.zones.some((z) => z.id === a.zoneId)) return fail('Unknown zone.');
      if (zp.mode === 'vetoDistinct' && a.player === second && s.zonePicks[s.firstPlayer] === a.zoneId) return fail('The Second Player must pick a different zone (pack p.12).');
      if (zp.mode === 'bonusPick') {
        const zr = zoneResults(s)[a.zoneId];
        if (zr && zr.totals[a.player] > 0) return fail('Pick a zone with no friendly Regiment in range (pack p.22).');
      }
      return ok();
    }
    case 'drawCard': {
      if (s.step !== 'action') return fail('Not in the Action Phase.');
      if (s.turn !== a.player) return fail(`It is ${s.turn ?? 'nobody'}'s turn to draw.`);
      if (s.activation || s.drawn) return fail('Finish the current Activation first.');
      if (!s.players[a.player].stack.length) return fail('No Command Cards left.');
      return ok();
    }
    case 'activateCharacter': {
      const c = s.characters[a.characterId];
      if (!c) return fail('Unknown Character.');
      if (s.activation) return fail('Finish the current Activation first.');
      if (!s.drawn || s.drawn.card.kind !== 'character' || s.drawn.card.refId !== c.id) return fail("Draw the Character's Command Card first (core p.22).");
      return ok();
    }
    case 'drawEvent': {
      const p = drawEventProblems(s, a.name, { ...(a.option ? { option: a.option } : {}), ...(a.options ? { options: a.options } : {}), ...(a.targetId ? { targetId: a.targetId } : {}) });
      return p.length ? fail(...p) : ok();
    }
    case 'spell': {
      const r = casterOf(s, a.casterId)?.regiment;
      if (!r) return fail('Unknown spellcaster.');
      const p = [...canTakeAction(s, r.id, 'spell'), ...spellProblems(s, a.casterId, a.spell, a.targetId, a.attunement)];
      return p.length ? fail(...p) : ok();
    }
    case 'memories':
      return act(s, a.regimentId, 'memories', () => memoriesProblems(s.regiments[a.regimentId]!));
    case 'powerPref':
      return s.players[a.player].od ? ok() : fail('Only an Old Dominion army has Power Tokens.');
    case 'odSpend': {
      const r = s.regiments[a.regimentId];
      if (!r) return fail('Unknown Regiment.');
      const p = odSpendProblems(s, r);
      return p.length ? fail(...p) : ok();
    }
    case 'lobotomy': {
      // Lobotomytic Override (The Directorate, from the list's Army Rules).
      if (!s.drawn || s.drawn.player !== a.player || s.activation) return fail('Use it straight after drawing a Command Card, before Activating.');
      if (sectOf(s, a.player) !== 'directorate') return fail('Only a Directorate army has Lobotomytic Override.');
      if (s.players[a.player].lobotomyUsed) return fail('Once per Round.');
      if (s.players[a.player].stack.length < 1) return fail('It cannot be used with only one Command Card left.');
      return ok();
    }
    case 'charge':
      if (isMarkerTarget(a.targetId)) return act(s, a.regimentId, 'charge', () => markerChargeProblems(s, s.regiments[a.regimentId]!, markerId(a.targetId)));
      return act(s, a.regimentId, 'charge', () => chargeProblems(s, s.regiments[a.regimentId]!, s.regiments[a.targetId]));
    case 'placeCharge': {
      const pc = s.pendingCharge;
      if (!pc) return fail('No Charge is waiting to be placed.');
      const r = s.regiments[pc.regimentId]!;
      const polys = regimentPolys(s, r, { pose: a.pose });
      if (distancePolys(polys, regimentPolys(s, s.regiments[pc.targetId]!)) > 0.05) return fail('The Regiment must be in contact with the Charge target.');
      if (onTableRegiments(s).some((o) => o.id !== r.id && anyOverlap(polys, regimentPolys(s, o)))) return fail('The Regiment would overlap another Regiment.');
      return ok();
    }
    case 'failCharge':
      return s.pendingCharge ? ok() : fail('No Charge is waiting.');
    case 'volley':
      return act(s, a.regimentId, 'volley', () => {
        const r = s.regiments[a.regimentId]!;
        if (isMarkerTarget(a.targetId)) return markerVolleyPlan(s, r, markerId(a.targetId), !!s.activation?.aimed).problems;
        const t = s.regiments[a.targetId];
        if (!t) return ['Unknown target.'];
        return planVolley(s, r, t, volleyAimed(s, r)).problems;
      });
    case 'clash':
      return act(s, a.regimentId, 'clash', () => {
        const r = s.regiments[a.regimentId]!;
        if (isMarkerTarget(a.targetId)) {
          const id = markerId(a.targetId);
          const p = markerAttackProblems(s, r.owner, id);
          if (p.length) return p;
          return markerInContact(s, r, id) ? [] : ['The Regiment must be in contact with the Marker (pack p.9).'];
        }
        return clashTargets(s, r).some((t) => t.id === a.targetId) ? [] : ['Clash targets an enemy Regiment in contact (core p.44).'];
      });
    case 'takeAim':
      return act(s, a.regimentId, 'takeAim', () => {
        const r = s.regiments[a.regimentId]!;
        const c = attachedCharacter(s, r.id);
        if (isEngaged(s, r)) return ['Take Aim is an out-of-combat Action (core p.24).'];
        return barrageOf(r.rules) || (c && barrageOf(c.rules)) ? [] : ['The Regiment has no Barrage (core p.36).'];
      });
    case 'inspire':
      return act(s, a.regimentId, 'inspire', () => {
        const r = s.regiments[a.regimentId]!;
        if (hasRule(r.rules, 'Phalanx')) return ['A Phalanx Regiment cannot perform the Inspire Action (core p.100).'];
        if (hasRule(r.rules, 'Animate Vessel')) return ['A Regiment with Animate Vessel cannot perform the Inspire Action (od p.5).'];
        if (!isEngaged(s, r)) return ['Inspire is a combat Action (core p.50).'];
        return r.broken ? ['A Broken Regiment cannot benefit from Inspired (core p.60).'] : [];
      });
    case 'rally':
      return act(s, a.regimentId, 'rally', () => {
        const r = s.regiments[a.regimentId]!;
        if (isEngaged(s, r)) return ['In contact with an enemy, use Combat Rally (core p.47).'];
        return r.broken ? [] : ['Only a Broken Regiment can Rally (core p.36).'];
      });
    case 'combatRally':
      return act(s, a.regimentId, 'combatRally', () => {
        const r = s.regiments[a.regimentId]!;
        if (!isEngaged(s, r)) return ['Combat Rally needs an enemy in contact (core p.47).'];
        return r.broken ? [] : ['Only a Broken Regiment can Combat Rally (core p.47).'];
      });
    case 'combatReform':
      return act(s, a.regimentId, 'combatReform', () => {
        const r = s.regiments[a.regimentId]!;
        if (!isEngaged(s, r)) return ['Combat Reform needs an enemy in contact (core p.48).'];
        const n = regimentStandCount(s, r);
        return clampFiles(n, a.files) === a.files ? [] : [`${a.files} files is not a legal formation for ${n} Stands.`];
      });
    case 'withdraw':
      return act(s, a.regimentId, 'withdraw', () => {
        const r = s.regiments[a.regimentId]!;
        const p = withdrawProblems(s, r, a.moves);
        if (p.length) return p;
        return marchShapeProblems(a.moves.length ? a.moves : [{ kind: 'forward', d: 0 }], marchValue(s, r), footprintWidth(s, r));
      });
    case 'duel': {
      const c = s.characters[a.characterId];
      if (!c || s.activation?.characterId !== c.id) return fail('Duel is the active Character’s own Action (core p.76).');
      const p = canTakeAction(s, s.activation.regimentId, 'duel');
      if (p.length) return fail(...p);
      return duelTargets(s, c).some((t) => t.id === a.targetCharacterId) ? ok() : fail('Choose an enemy Character in a Regiment in contact (core p.76).');
    }
    case 'characterAbility': {
      const c = s.characters[a.characterId];
      if (!c || s.activation?.characterId !== c.id) return fail('Only the active Character can use its Actions.');
      const p = [...canTakeAction(s, s.activation.regimentId, 'ability'), ...characterAbilityProblems(s, c, a.name, a.targetId)];
      return p.length ? fail(...p) : ok();
    }
    case 'override.wounds':
      return (a.regimentId && s.regiments[a.regimentId]) || (a.characterId && s.characters[a.characterId]) ? ok() : fail('Choose a Regiment or Character.');
    case 'override.stat':
    case 'override.broken':
      return s.regiments[a.regimentId] ? ok() : fail('Unknown Regiment.');
    case 'override.forceDice':
      return a.values.every((v) => Number.isInteger(v) && v >= 1 && v <= 6) ? ok() : fail('Dice values must be 1 to 6.');
    default:
      return fail(`Unknown action ${(a as { type: string }).type}.`);
  }
}

/** Logs the special rules of a Regiment and its Character that the engine does not automate. */
export function logManualRules(ctx: Ctx, r: RegimentState): void {
  const c = attachedCharacter(ctx.s, r.id);
  const names = [...manualRules(r.rules), ...(c ? manualRules(c.rules) : [])].map((x) => x.raw);
  if (names.length) ev(ctx, { type: 'manual', text: `Manual rules that may apply to ${r.name}: ${[...new Set(names)].join(', ')}. Resolve them with the manual tools if they trigger.`, regimentId: r.id });
}

function startActivation(ctx: Ctx, r: RegimentState, extra: Partial<NonNullable<GameState['activation']>> = {}): void {
  ctx.s.activation = { regimentId: r.id, actions: [], entering: r.location === 'arriving', startPose: r.pose, drawEventDone: false, aimed: false, inspired: false, ended: false, ...extra };
}

function startActionPhase(ctx: Ctx): void {
  const s = ctx.s;
  const first = s.firstPlayer!;
  s.step = 'action';
  ev(ctx, { type: 'phase', text: `Action Phase: ${first} is the First Player (core p.22).` });
  if (s.players[first].stack.length) s.turn = first;
  else passTurn(s, first === 'P1' ? 'P2' : 'P1');
  if (!s.players.P1.stack.length && !s.players.P2.stack.length) {
    s.turn = null;
    s.step = 'victory';
  }
}

/** Deactivation, Entourage Activation (core p.23, p.75) and passing play. */
export function endActivation(ctx: Ctx, entourage: boolean): void {
  const s = ctx.s;
  const a = s.activation!;
  const r = s.regiments[a.regimentId]!;
  const owner = r.owner;
  onActivationEnd(ctx, a, r);
  if (a.characterId) {
    const c = s.characters[a.characterId]!;
    c.activatedThisRound = true;
    ev(ctx, { type: 'deactivate', text: `${c.name} ends its Activation.`, player: owner });
  } else {
    r.activatedThisRound = true;
    if (r.location === 'arriving') {
      r.location = 'reserve';
      r.flags.autoArrive = true;
      ev(ctx, { type: 'reinforcement', text: `${r.name} did not enter and returns to Reinforcements; it arrives automatically next Round (core p.31).`, player: owner, regimentId: r.id });
    }
    ev(ctx, { type: 'deactivate', text: `${r.name} ends its Activation.`, player: owner, regimentId: r.id });
  }
  s.activation = null;
  if (a.characterId && entourage) {
    const top = s.players[owner].stack[0];
    if (top && top.kind === 'regiment' && r.type !== 'Monster' && cardTargets(s, owner, top).includes(r.id)) {
      s.players[owner].stack.shift();
      startActivation(ctx, r, { entourage: true });
      ev(ctx, { type: 'activate', text: `${owner} draws ${top.name}: Entourage Activation of ${r.name} (core p.75).`, player: owner, regimentId: r.id });
      if (onActivationStart(ctx, r, top)) {
        logManualRules(ctx, r);
        return;
      }
    }
    ev(ctx, { type: 'draw', text: `The next card is not ${r.name}; it goes back on top of the Command Stack (core p.75).`, player: owner });
  }
  passTurn(s, owner);
}

function overrideEv(ctx: Ctx, text: string, regimentId?: string): void {
  ev(ctx, { type: 'override', override: true, text: `OVERRIDE: ${text}`, ...(regimentId ? { regimentId } : {}) });
}

export function applyM4(ctx: Ctx, a: Action): void {
  const s = ctx.s;
  switch (a.type) {
    case 'reinforcements': {
      doReinforcements(ctx, a.player, a.choice, a.flank ?? {});
      if (s.players.P1.reinforcementDone && s.players.P2.reinforcementDone) {
        s.step = 'command';
        ev(ctx, { type: 'phase', text: 'Command Phase: both players build their Command Stacks (core p.21).' });
      }
      break;
    }
    case 'setStack': {
      const cards = buildCards(s, a.player);
      s.players[a.player].stack = a.order.map((id) => cards.find((c) => c.id === id)!);
      s.players[a.player].stackSet = true;
      ev(ctx, { type: 'stack', text: `${a.player} sets a Command Stack of ${a.order.length} cards.`, player: a.player });
      if (s.players.P1.stackSet && s.players.P2.stackSet) {
        // Blasphemous Soma (od p.6): +1 Power Token before the Supremacy Phase.
        blasphemousSoma(ctx);
        s.step = 'supremacy';
        ev(ctx, { type: 'phase', text: 'Supremacy Phase (core p.21).' });
      }
      break;
    }
    case 'supremacyRollOff':
      s.supremacyWinner = supremacyRollOff(ctx);
      ev(ctx, { type: 'phase', text: `${s.supremacyWinner} wins Supremacy and chooses the First Player.` });
      break;
    case 'chooseFirst': {
      s.firstPlayer = a.first;
      if (s.scenario.zonePick) {
        ev(ctx, { type: 'phase', text: `${a.first} is the First Player. Zone picks: ${a.first} first, then the other player (scenario rules).` });
        break;
      }
      startActionPhase(ctx);
      break;
    }
    case 'pickZone': {
      s.zonePicks[a.player] = a.zoneId;
      const secret = s.scenario.zonePick!.mode === 'vetoSecret';
      ev(ctx, { type: 'pick', text: `${a.player} picks ${secret ? 'a zone (secret until the Victory Phase)' : `zone ${a.zoneId}`}.`, player: a.player });
      if (s.zonePicks.P1 !== null && s.zonePicks.P2 !== null) startActionPhase(ctx);
      break;
    }
    case 'useSupremacy': {
      s.players[a.player].supremacyUsed = true;
      const w = Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(a.player))!;
      if (isOdSupremacy(s, a.player)) applyOdSupremacy(ctx, a.player, a.targets ?? []);
      else if (w.supremacyAbilities.some((x) => x.toLowerCase() === 'remorseless hunter')) {
        // Remorseless Hunter [Activated]: all friendly Regiments gain Sureshot and Longshot until the end of the Round.
        for (const r of Object.values(s.regiments).filter((x) => x.owner === a.player)) r.roundRules.push({ name: 'Sureshot', raw: 'Sureshot' }, { name: 'Longshot', raw: 'Longshot' });
        ev(ctx, { type: 'supremacy', text: `${a.player} activates Remorseless Hunter: every friendly Regiment gains Sureshot and Longshot until the end of the Round.`, player: a.player });
      } else ev(ctx, { type: 'manual', text: `${a.player} activates the Supremacy Ability of ${w.name} (${w.supremacyAbilities.join(', ')}) until the end of the Round. Its effects are manual.`, player: a.player });
      break;
    }
    case 'drawCard':
      if (!drawCard(ctx, a.player)) {
        ev(ctx, { type: 'draw', text: `${a.player} has no usable cards left.`, player: a.player });
        passTurn(s, a.player);
      }
      break;
    case 'activateCharacter': {
      const c = s.characters[a.characterId]!;
      const r = s.regiments[c.attachedTo!]!;
      s.drawn = null;
      startActivation(ctx, r, { characterId: c.id });
      ev(ctx, { type: 'activate', text: `${r.owner} activates the Character ${c.name}${r.location !== 'table' ? ' (not on the Battlefield yet: no Draw Event, core p.23)' : ''}.`, player: r.owner });
      odActivationStartSpells(ctx);
      break;
    }
    case 'drawEvent':
      applyDrawEvent(ctx, a.name, { ...(a.option ? { option: a.option } : {}), ...(a.options ? { options: a.options } : {}), ...(a.targetId ? { targetId: a.targetId } : {}) });
      break;
    case 'spell': {
      const c = casterOf(s, a.casterId)!;
      recordAction(s.activation!, 'spell');
      castSpell(ctx, a.casterId, a.spell, a.targetId, { ...(a.attunement ? { attunement: a.attunement } : {}), ...(a.pool ? { pool: a.pool } : {}) });
      void c;
      break;
    }
    case 'memories': {
      const r = s.regiments[a.regimentId]!;
      recordAction(s.activation!, 'memories');
      activateMemories(ctx, r, 'as an Action');
      break;
    }
    case 'powerPref':
      s.players[a.player].od!.pref = a.pool;
      ev(ctx, { type: 'power', text: `${a.player} will put new Power Tokens in the ${a.pool === 'dark' ? 'Dark Power' : 'Fallen Pantheon'} Pool.`, player: a.player });
      break;
    case 'odSpend':
      applyOdSpend(ctx, s.regiments[a.regimentId]!, a.option);
      break;
    case 'lobotomy': {
      const first = s.drawn!.card;
      s.players[a.player].lobotomyUsed = true;
      s.drawn = null;
      ev(ctx, { type: 'draw', text: `${a.player} uses Lobotomytic Override: the drawn card is set aside face down and goes to the ${a.place} of the Command Stack; ${a.player} draws again.`, player: a.player });
      const ok2 = drawCard(ctx, a.player);
      if (a.place === 'top') s.players[a.player].stack.unshift({ ...first, lobotomy: 'top' });
      else s.players[a.player].stack.push({ ...first, lobotomy: 'bottom' });
      if (!ok2) passTurn(s, a.player);
      break;
    }
    case 'charge':
      if (isMarkerTarget(a.targetId)) applyMarkerCharge(ctx, s.regiments[a.regimentId]!, markerId(a.targetId));
      else applyCharge(ctx, s.regiments[a.regimentId]!, s.regiments[a.targetId]!);
      break;
    case 'placeCharge': {
      const pc = s.pendingCharge!;
      const r = s.regiments[pc.regimentId]!;
      r.pose = a.pose;
      s.pendingCharge = null;
      overrideEv(ctx, `${r.name} placed in contact by hand to finish its Charge (AMB-11).`, r.id);
      completeCharge(ctx, r, s.regiments[pc.targetId]!, pc.facing as Arc);
      break;
    }
    case 'failCharge': {
      const pc = s.pendingCharge!;
      s.pendingCharge = null;
      s.activation!.ended = true;
      overrideEv(ctx, `${s.regiments[pc.regimentId]!.name}'s Charge is declared failed: its path is blocked (core p.32).`, pc.regimentId);
      break;
    }
    case 'volley': {
      recordAction(s.activation!, 'volley');
      const r = s.regiments[a.regimentId]!;
      if (isMarkerTarget(a.targetId)) {
        const id = markerId(a.targetId);
        attackMarker(ctx, r, id, markerVolleyPlan(s, r, id, s.activation!.aimed).pools, 'volley', `${r.name} Volley at Marker ${id}`);
      } else applyVolley(ctx, r, s.regiments[a.targetId]!);
      break;
    }
    case 'clash': {
      recordAction(s.activation!, 'clash');
      const r = s.regiments[a.regimentId]!;
      if (isMarkerTarget(a.targetId)) applyMarkerClash(ctx, r, markerId(a.targetId));
      else applyClash(ctx, r, s.regiments[a.targetId]!);
      break;
    }
    case 'takeAim':
      recordAction(s.activation!, 'takeAim');
      s.activation!.aimed = true;
      ev(ctx, { type: 'action', text: `${s.regiments[a.regimentId]!.name} Takes Aim: Aimed Shot until the end of its Activation (core p.36).` });
      break;
    case 'inspire':
      recordAction(s.activation!, 'inspire');
      s.activation!.inspired = true;
      ev(ctx, { type: 'action', text: `${s.regiments[a.regimentId]!.name} is Inspired until the end of its Activation (core p.50).` });
      break;
    case 'rally':
    case 'combatRally': {
      const r = s.regiments[a.regimentId]!;
      recordAction(s.activation!, a.type);
      if (a.type === 'combatRally' && !fearsomeCheck(ctx, r, 'Combat Rally')) break;
      r.broken = false;
      r.standsWhenBroken = null;
      r.standsAtRoundStart = r.stands.length;
      ev(ctx, { type: 'action', text: `${r.name} Rallies and is no longer Broken (core p.36, p.47).`, player: r.owner, regimentId: r.id });
      break;
    }
    case 'combatReform': {
      const fd = s.activation!.extra?.find((e) => !e.used && e.reason === 'Flawless Drill');
      if (fd) s.regiments[a.regimentId]!.flags.flawlessDrillUsed = true;
      recordAction(s.activation!, 'combatReform');
      applyCombatReform(ctx, s.regiments[a.regimentId]!, a.files);
      break;
    }
    case 'withdraw':
      recordAction(s.activation!, 'withdraw');
      applyWithdraw(ctx, s.regiments[a.regimentId]!, a.moves, a.turn ?? true);
      break;
    case 'duel': {
      recordAction(s.activation!, 'duel');
      applyDuel(ctx, s.characters[a.characterId]!, s.characters[a.targetCharacterId]!, a.accept);
      break;
    }
    case 'characterAbility': {
      recordAction(s.activation!, 'ability');
      applyCharacterAbility(ctx, s.characters[a.characterId]!, a.name, a.targetId);
      break;
    }
    case 'override.wounds': {
      if (a.characterId) {
        const c = s.characters[a.characterId]!;
        c.wounds = Math.max(0, c.wounds + a.delta);
        overrideEv(ctx, `${c.name} ${a.delta > 0 ? 'suffers' : 'heals'} ${Math.abs(a.delta)} Wound(s) (now ${c.wounds}).`);
        break;
      }
      const r = s.regiments[a.regimentId!]!;
      if (a.delta > 0) {
        overrideEv(ctx, `${r.name} suffers ${a.delta} Wound(s) by hand.`, r.id);
        allocateWounds(ctx, r, a.delta, r.owner === 'P1' ? 'P2' : 'P1');
      } else {
        let heal = -a.delta;
        for (const st of r.stands) {
          const h = Math.min(heal, st.wounds);
          st.wounds -= h;
          heal -= h;
        }
        while (heal > 0 && r.stands.length < r.startingStands) {
          r.stands.push({ id: `${r.id}-r${r.stands.length}-${s.round}`, wounds: 0, isCommand: false });
          heal -= Math.max(1, r.profile.W ?? 1);
        }
        overrideEv(ctx, `${r.name} heals ${-a.delta} Wound(s) by hand (${r.stands.length} Stands).`, r.id);
      }
      break;
    }
    case 'override.stat': {
      const r = s.regiments[a.regimentId]!;
      r.roundMods.push({ stat: a.stat, delta: a.delta, source: 'manual' });
      overrideEv(ctx, `${r.name} ${a.stat} ${a.delta > 0 ? '+' : ''}${a.delta} until the end of the Round.`, r.id);
      break;
    }
    case 'override.broken': {
      const r = s.regiments[a.regimentId]!;
      r.broken = a.broken;
      r.standsWhenBroken = a.broken ? r.stands.length : null;
      if (!a.broken) r.standsAtRoundStart = r.stands.length;
      overrideEv(ctx, `${r.name} marked ${a.broken ? 'Broken' : 'not Broken'}.`, r.id);
      checkBroken(ctx, r);
      break;
    }
    case 'override.forceDice':
      s.forcedDice.push(...a.values);
      overrideEv(ctx, `the next ${a.values.length} dice will be ${a.values.join(', ')}.`);
      break;
    default:
      break;
  }
}

export { enemiesInContact, withdrawPose, TOL };
