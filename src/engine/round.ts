import { ev, rollN, type Ctx } from './dice';
import type { CommandCard, GameState, PlayerId, RegimentState, UnitClass } from './model/types';
import { computeReinforcementLine, other, regimentStandCount } from './queries';

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
  return reserveRegiments(s, p).filter((r) => reinforcementNeed(s.round, r.cls) !== null);
}

export interface ReinforcementChoice {
  regimentId: string;
  arrive: boolean;
}

export function reinforcementChoiceProblems(s: GameState, p: PlayerId, c: ReinforcementChoice | null): string[] {
  if (!c) return [];
  const r = s.regiments[c.regimentId];
  if (!r || r.owner !== p || r.location !== 'reserve') return ['Choose one of your Regiments in Reinforcements.'];
  const need = reinforcementNeed(s.round, r.cls);
  if (need === null) return [`${r.cls} Regiments cannot arrive in Round ${s.round} (core p.21).`];
  if (!c.arrive && need === 'auto') return [`${r.name} must arrive this Round (core p.21).`];
  return [];
}

/**
 * Reinforcement Phase for one player (core p.20–21): the chosen Regiment arrives or stays without
 * rolling; every other eligible Regiment rolls against the table. Regiments that failed to enter
 * last Round arrive automatically (core p.31). Flank (X) Regiments are manual (core p.98).
 */
export function doReinforcements(ctx: Ctx, p: PlayerId, choice: ReinforcementChoice | null): void {
  const s = ctx.s;
  for (const r of reserveRegiments(s, p)) {
    if (choice && r.id === choice.regimentId) {
      r.location = choice.arrive ? 'arriving' : 'reserve';
      ev(ctx, { type: 'reinforcement', text: `${p} chooses ${r.name} to ${choice.arrive ? 'arrive automatically' : 'stay in Reinforcements'}.`, player: p, regimentId: r.id });
      continue;
    }
    if (r.flags.autoArrive) {
      r.location = 'arriving';
      r.flags.autoArrive = false;
      ev(ctx, { type: 'reinforcement', text: `${r.name} arrives automatically after failing to enter last Round (core p.31).`, player: p, regimentId: r.id });
      continue;
    }
    const need = reinforcementNeed(s.round, r.cls);
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
    if (c.destroyed || !c.id.startsWith(p) || !c.attachedTo) continue;
    const r = s.regiments[c.attachedTo];
    if (r && (r.location === 'table' || r.location === 'arriving')) cards.push({ id: `card-${c.id}`, kind: 'character', name: c.name, refId: c.id });
  }
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
  return out;
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
  if (card.kind === 'character') {
    const c = s.characters[card.refId];
    if (!c || c.destroyed || c.activatedThisRound || !c.attachedTo) return [];
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
      ev(ctx, { type: 'draw', text: `${p} draws ${card.name}${card.kind === 'character' ? ' (Character)' : ''}.`, player: p });
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
    r.flags.declinedDuel = false;
    r.standsAtRoundStart = r.stands.length;
    // RULE-AMBIGUITY: AMB-33 — a Regiment still Broken counts Shattering from the start of each new Round.
    if (r.broken) r.standsWhenBroken = r.stands.length;
  }
  for (const c of Object.values(s.characters)) c.activatedThisRound = false;
  for (const p of ['P1', 'P2'] as const) {
    s.players[p].stack = [];
    s.players[p].stackSet = false;
    s.players[p].reinforcementDone = false;
  }
  s.step = 'reinforcement';
  s.firstPlayer = null;
  s.supremacyWinner = null;
  s.turn = null;
  s.drawn = null;
  s.tally = { charactersKilled: { P1: 0, P2: 0 }, regimentsDestroyed: { P1: 0, P2: 0 }, warlordSlain: { P1: false, P2: false }, markersDestroyed: { P1: [], P2: [] } };
  s.reinforcementLine = { P1: computeReinforcementLine(s, 'P1'), P2: computeReinforcementLine(s, 'P2') };
}

export { regimentStandCount };
