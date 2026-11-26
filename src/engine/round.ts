import { ev, rollN, type Ctx } from './dice';
import type { CommandCard, GameState, PlayerId, RegimentState, UnitClass } from './model/types';
import { computeReinforcementLine, hasFlank, other, regimentStandCount } from './queries';
import { beginRoundOd } from './factions/oldDominion';
import { beginRoundSk, elementalKind, placeRituals } from './factions/sorcererKings';
import { beginRoundDw } from './factions/dweghom';

/**
 * Reinforcement table (core p.21): the roll needed this Round per Class, 'auto' when the Class
 * arrives automatically, or null when it cannot arrive yet.
 */
export function reinforcementNeed(round: number, cls: UnitClass): number | 'auto' | null {
  const table: Record<UnitClass, (number | 'auto' | null)[]> = {
    //        R1    R2    R3      R4      R5+
    Light: [4, 4, 'auto', 'auto', 'auto'],
    Medium: [null, 2, 4, 'auto', 'auto'],
    Heavy: [null, null, 2, 4, 'auto'],
  };
  return table[cls][Math.min(round, 5) - 1] ?? null;
}

export function reserveRegiments(s: GameState, p: PlayerId): RegimentState[] {
  return Object.values(s.regiments).filter((r) => r.owner === p && r.location === 'reserve');
}

/** Regiments that may be chosen to arrive automatically or stay back (core p.20–21). */
export function reinforcementChoices(s: GameState, p: PlayerId): RegimentState[] {
  return reserveRegiments(s, p).filter((r) => reinforcementNeed(s.round, reinforcementClass(s, r)) !== null);
}

/**
 * The Class used for Reinforcements. The Fallen Divinity counts as Light for its Reinforcement
 * Roll (od p.13), but a Flank Regiment makes no roll and cannot enter before its own Class
 * normally could (core p.97–98). RULE-AMBIGUITY: AMB-53 — so with Flank, its real Class applies.
 */
export function reinforcementClass(s: GameState, r: RegimentState): UnitClass {
  if (hasFlank(s, r)) return r.cls;
  return (r.notes ?? []).some((n) => /class as light for the purposes of its reinforcement/i.test(n)) ? 'Light' : r.cls;
}

export interface ReinforcementChoice {
  regimentId: string;
  arrive: boolean;
  /** Tidal Summons (Marid Apsara, sk p.45): one more Water Elemental Regiment arrives automatically too. */
  tidalId?: string;
}

/** Water Elementals in Reinforcements that Tidal Summons may bring with the Marid Apsara (sk p.45). */
export function tidalChoices(s: GameState, p: PlayerId, apsaraId: string): RegimentState[] {
  const a = s.regiments[apsaraId];
  if (!a || a.name !== 'Marid Apsara' || !s.players[p].sk) return [];
  return reserveRegiments(s, p).filter((r) => r.id !== a.id && elementalKind(r, 'Water'));
}

/** Flank Regiments that may decide to arrive or stay this Round (core p.98). */
export function flankChoices(s: GameState, p: PlayerId): RegimentState[] {
  return reserveRegiments(s, p).filter((r) => hasFlank(s, r) && !r.flags.autoArrive && reinforcementNeed(s.round, reinforcementClass(s, r)) !== null);
}

export function reinforcementChoiceProblems(s: GameState, p: PlayerId, c: ReinforcementChoice | null, flank: Record<string, boolean> = {}): string[] {
  for (const [id, arrive] of Object.entries(flank)) {
    const r = s.regiments[id];
    if (!r || r.owner !== p || !flankChoices(s, p).includes(r)) return ['Only your Flank Regiments that can arrive this Round may be declared (core p.98).'];
    if (!arrive && reinforcementNeed(s.round, reinforcementClass(s, r)) === 'auto') return [`${r.name} cannot stay past the Round its Class must arrive (core p.98).`];
  }
  if (!c) return [];
  const r = s.regiments[c.regimentId];
  if (!r || r.owner !== p || r.location !== 'reserve') return ['Choose one of your Regiments in Reinforcements.'];
  const need = reinforcementNeed(s.round, reinforcementClass(s, r));
  if (need === null) return [`${r.cls} Regiments cannot arrive in Round ${s.round} (core p.21).`];
  if (!c.arrive && need === 'auto') return [`${r.name} must arrive this Round (core p.21).`];
  if (c.tidalId) {
    if (!c.arrive || !tidalChoices(s, p, r.id).some((x) => x.id === c.tidalId)) return ['Tidal Summons brings one more friendly Water Elemental Regiment from Reinforcements with the Marid Apsara (sk p.45).'];
  }
  return [];
}

/**
 * Reinforcement Phase for one player (core p.20–21): the chosen Regiment arrives or stays without
 * rolling; every other eligible Regiment rolls against the table. Regiments that failed to enter
 * last Round arrive automatically (core p.31). Flank (X) Regiments are manual (core p.98).
 */
export function doReinforcements(ctx: Ctx, p: PlayerId, choice: ReinforcementChoice | null, flank: Record<string, boolean> = {}): void {
  const s = ctx.s;
  for (const r of reserveRegiments(s, p)) {
    // Flank (core p.98): no die; the player declares whether it arrives or stays, within its Class's window.
    if (hasFlank(s, r) && !(choice && r.id === choice.regimentId) && !r.flags.autoArrive) {
      const need = reinforcementNeed(s.round, reinforcementClass(s, r));
      if (need === null) continue;
      const arrive = need === 'auto' ? true : flank[r.id] ?? true;
      r.location = arrive ? 'arriving' : 'reserve';
      ev(ctx, { type: 'reinforcement', text: `${r.name} has Flank: ${arrive ? 'arrives' : 'stays in Reinforcements'} without rolling (core p.98).`, player: p, regimentId: r.id });
      continue;
    }
    if (choice && r.id === choice.regimentId) {
      r.location = choice.arrive ? 'arriving' : 'reserve';
      ev(ctx, { type: 'reinforcement', text: `${p} chooses ${r.name} to ${choice.arrive ? 'arrive automatically' : 'stay in Reinforcements'}.`, player: p, regimentId: r.id });
      continue;
    }
    // Tidal Summons (sk p.45): arrives automatically with the Marid Apsara.
    // RULE-AMBIGUITY: AMB-77 — any Class, even one that could not arrive yet this Round.
    if (choice?.tidalId === r.id && choice.arrive) {
      r.location = 'arriving';
      ev(ctx, { type: 'reinforcement', text: `Tidal Summons: ${r.name} arrives automatically with the Marid Apsara (sk p.45).`, player: p, regimentId: r.id });
      continue;
    }
    if (r.flags.autoArrive) {
      r.location = 'arriving';
      r.flags.autoArrive = false;
      ev(ctx, { type: 'reinforcement', text: `${r.name} arrives automatically after failing to enter last Round (core p.31).`, player: p, regimentId: r.id });
      continue;
    }
    const need = reinforcementNeed(s.round, reinforcementClass(s, r));
    if (need === null) continue;
    if (need === 'auto') {
      r.location = 'arriving';
      ev(ctx, { type: 'reinforcement', text: `${r.name} (${r.cls}) arrives automatically in Round ${s.round} (core p.21).`, player: p, regimentId: r.id });
      continue;
    }
    const idx = ctx.rng.index;
    const [v] = rollN(ctx, 1);
    const okRoll = v! <= need;
    if (okRoll) r.location = 'arriving';
    ev(ctx, {
      type: 'dice',
      text: `${r.name} (${r.cls}) Reinforcement Roll ${v} — needs ${need} or less: ${okRoll ? 'arrives' : 'stays'}.`,
      player: p,
      regimentId: r.id,
      dice: { purpose: `${r.name}: Reinforcement Roll`, seed: ctx.rng.seed, index: idx, values: [v!], notes: [`need ${need} or less (core p.21)`] },
    });
  }
  s.players[p].reinforcementDone = true;
}

/** Command Cards for everything on the table or arriving this Round (core p.21). */
export function buildCards(s: GameState, p: PlayerId): CommandCard[] {
  const cards: CommandCard[] = [];
  for (const r of Object.values(s.regiments)) {
    if (r.owner !== p || (r.location !== 'table' && r.location !== 'arriving')) continue;
    cards.push({ id: `card-${r.id}`, kind: 'regiment', name: r.name, refId: r.id });
  }
  for (const c of Object.values(s.characters)) {
    // An embodied Character Activates with its own Regiment's card (od p.8).
    if (c.destroyed || c.embodied || !c.id.startsWith(p) || !c.attachedTo) continue;
    const r = s.regiments[c.attachedTo];
    if (r && (r.location === 'table' || r.location === 'arriving')) cards.push({ id: `card-${c.id}`, kind: 'character', name: c.name, refId: c.id });
  }
  // Completed Rituals join the Command Stack in the next Command Phase (sk p.5).
  for (const name of s.players[p].sk?.completed ?? []) cards.push({ id: `ritual-${name}`, kind: 'ritual', name, refId: name });
  return cards;
}

/** A sensible default order: Characters just before their Regiment; ranged and fast first. */
export function defaultStackOrder(s: GameState, p: PlayerId): CommandCard[] {
  const cards = buildCards(s, p);
  const regs = cards.filter((c) => c.kind === 'regiment');
  const score = (c: CommandCard) => {
    const r = s.regiments[c.refId]!;
    return (r.rules.some((x) => x.name === 'Barrage') ? -10 : 0) - (r.profile.M ?? 0);
  };
  regs.sort((a, b) => score(a) - score(b));
  const out: CommandCard[] = [];
  for (const rc of regs) {
    const ch = cards.find((c) => c.kind === 'character' && s.characters[c.refId]!.attachedTo === rc.refId);
    if (ch) out.push(ch);
    out.push(rc);
  }
  // Rituals first, each followed by a Regiment of its Court (sk p.22).
  return placeRituals(s, [...cards.filter((c) => c.kind === 'ritual'), ...out]);
}

export function stackProblems(s: GameState, p: PlayerId, order: string[]): string[] {
  const cards = buildCards(s, p);
  const ids = new Set(cards.map((c) => c.id));
  if (order.length !== cards.length || !order.every((id) => ids.has(id)) || new Set(order).size !== order.length)
    return ['The Command Stack must contain each of your Command Cards exactly once (core p.21).'];
  return [];
}

/**
 * Supremacy roll-off (core p.21): both roll; the player with fewer Command Cards subtracts 1
 * (minimum 0; RULE-AMBIGUITY: AMB-06). Lowest chooses the First Player; ties re-roll.
 */
export function supremacyRollOff(ctx: Ctx): PlayerId {
  const s = ctx.s;
  const n1 = s.players.P1.stack.length;
  const n2 = s.players.P2.stack.length;
  for (;;) {
    const idx = ctx.rng.index;
    const [a, b] = rollN(ctx, 2) as [number, number];
    const ma = n1 < n2 ? Math.max(0, a - 1) : a;
    const mb = n2 < n1 ? Math.max(0, b - 1) : b;
    const note = n1 !== n2 ? ` (${n1 < n2 ? 'P1' : 'P2'} has fewer cards: −1)` : '';
    ev(ctx, {
      type: 'dice',
      text: `Supremacy roll-off: P1 ${a}${ma !== a ? `→${ma}` : ''}, P2 ${b}${mb !== b ? `→${mb}` : ''}${note}.${ma === mb ? ' Tie, re-roll.' : ''}`,
      dice: { purpose: 'Supremacy roll-off', seed: ctx.rng.seed, index: idx, values: [a, b], notes: ['lowest wins (core p.21)'] },
    });
    if (ma !== mb) return ma < mb ? 'P1' : 'P2';
  }
}

/** Can this card Activate something now? Returns the eligible Regiment or Character ids. */
export function cardTargets(s: GameState, p: PlayerId, card: CommandCard): string[] {
  // A Ritual card is resolved when drawn (sk p.5).
  if (card.kind === 'ritual') return [card.refId];
  if (card.kind === 'character') {
    const c = s.characters[card.refId];
    if (!c || c.destroyed || c.embodied || c.activatedThisRound || !c.attachedTo) return [];
    const r = s.regiments[c.attachedTo];
    return r && (r.location === 'table' || r.location === 'arriving') ? [c.id] : [];
  }
  // Any same-named Regiment that has not yet Activated (core p.22).
  return Object.values(s.regiments)
    .filter((r) => r.owner === p && r.name === card.name && !r.activatedThisRound && (r.location === 'table' || r.location === 'arriving'))
    .map((r) => r.id);
}

/**
 * Draws the top card; cards that cannot Activate anything are discarded and the next drawn
 * (core p.22). Returns false if the stack ran out.
 */
export function drawCard(ctx: Ctx, p: PlayerId): boolean {
  const pl = ctx.s.players[p];
  while (pl.stack.length) {
    const card = pl.stack.shift()!;
    if (cardTargets(ctx.s, p, card).length) {
      ctx.s.drawn = { player: p, card };
      ev(ctx, { type: 'draw', text: `${p} draws ${card.name}${card.kind === 'character' ? ' (Character)' : card.kind === 'ritual' ? ' (Ritual)' : ''}.`, player: p });
      return true;
    }
    ev(ctx, { type: 'draw', text: `${p} draws ${card.name}, which cannot Activate anything, and discards it (core p.22).`, player: p });
  }
  return false;
}

/** After an Activation, play passes to the opponent if they have cards left (core p.22). */
export function passTurn(s: GameState, current: PlayerId): void {
  const o = other(current);
  if (s.players[o].stack.length) s.turn = o;
  else if (s.players[current].stack.length) s.turn = current;
  else {
    s.turn = null;
    s.step = 'victory';
  }
}

/** Start-of-Round bookkeeping (core p.20, p.30, p.60). */
export function beginRound(s: GameState): void {
  for (const r of Object.values(s.regiments)) {
    r.activatedThisRound = false;
    r.roundMods = [];
    r.roundRules = [];
    r.flags.marked = false;
    r.flags.blessedUsed = false;
    r.flags.decay = false;
    r.flags.noDecay = false;
    r.flags.reprocessed = false;
    r.flags.declinedDuel = false;
    r.flags.exhortAura = false;
    r.flags.trialNext = false;
    r.flags.compelled = false;
    r.flags.hindered = false;
    r.flags.siphoned = false;
    r.flags.epigenetic = false;
    // Sorcerer Kings effects until the end of the Round (sk p.18–25).
    for (const k of ['inflamed', 'cauterized', 'hypoxia', 'flowingStride', 'cyclone', 'stabilized', 'reinforced', 'searing', 'quake', 'noRally', 'kissOfEarth', 'form', 'tidecaller', 'blessing', 'aqueousBy'] as const) delete r.flags[k];
    // Dweghom effects until the end of the Round (dw p.4–45).
    for (const k of ['awakened', 'empowered', 'fear', 'dismay', 'brokenGround', 'flameWall', 'chargeBonus', 'battered', 'unmade'] as const) delete r.flags[k];
    r.standsAtRoundStart = r.stands.length;
    // RULE-AMBIGUITY: AMB-33 — a Regiment still Broken counts Shattering from the start of each new Round.
    if (r.broken) r.standsWhenBroken = r.stands.length;
  }
  for (const c of Object.values(s.characters)) {
    c.activatedThisRound = false;
    delete c.roundA;
    delete c.nextA;
  }
  beginRoundOd(s);
  beginRoundSk(s);
  beginRoundDw(s);
  delete s.pendingMove;
  s.hinderingZones = [];
  for (const p of ['P1', 'P2'] as const) {
    s.players[p].stack = [];
    s.players[p].stackSet = false;
    s.players[p].reinforcementDone = false;
    s.players[p].lobotomyUsed = false;
  }
  s.step = 'reinforcement';
  s.firstPlayer = null;
  s.supremacyWinner = null;
  s.turn = null;
  s.drawn = null;
  s.zonePicks = { P1: null, P2: null };
  s.tally = { charactersKilled: { P1: 0, P2: 0 }, regimentsDestroyed: { P1: 0, P2: 0 }, warlordSlain: { P1: false, P2: false }, markersDestroyed: { P1: [], P2: [] }, burned: { P1: [], P2: [] } };
  s.reinforcementLine = { P1: computeReinforcementLine(s, 'P1'), P2: computeReinforcementLine(s, 'P2') };
}

export { regimentStandCount };
