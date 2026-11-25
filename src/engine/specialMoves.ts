import { recordAction } from './activation';
import { ev, type Ctx } from './dice';
import { footprint } from './formation';
import type { GameState } from './model/types';
import { applyPath, pathCost, samplePath, type MoveSeg } from './movement';
import { canTakeAction, formationInput, marchAllowance, pathProblems, positionProblems, regimentPolys } from './queries';

/**
 * Moves outside the normal March rules:
 * - Air Step (sk p.20): an Out of Sequence March of 2″ in any direction, no penalty for moving
 *   backward or sideways, no Wheel. Offered straight after the Spell; any other Action skips it.
 * - Translocation (od p.23): up to 8″ in any direction, ignoring other Regiments and terrain.
 * - On Soaring Winds (Steelheart Djinn, sk p.36): a March ignoring intervening Regiments,
 *   Characters and terrain, even while engaged; sideways or backward at full distance. It counts as
 *   a March (Air Elemental).
 */
export type SpecialMoveKind = 'airStep' | 'translocation' | 'soaring';

export const SPECIAL_MOVE_LABEL: Record<SpecialMoveKind, string> = { airStep: 'Air Step', translocation: 'Translocation', soaring: 'On Soaring Winds' };

export function specialMoveAllowance(s: GameState, regimentId: string, kind: SpecialMoveKind): number {
  if (kind === 'soaring') return marchAllowance(s, s.regiments[regimentId]!);
  return s.pendingMove?.max ?? 0;
}

export function specialMoveProblems(s: GameState, regimentId: string, moves: MoveSeg[], kind: SpecialMoveKind): string[] {
  const r = s.regiments[regimentId];
  if (!r || r.location !== 'table') return ['Choose a Regiment on the Battlefield.'];
  if (kind === 'soaring') {
    if (r.name !== 'Steelheart Djinn' || !s.players[r.owner].sk) return ['Only Steelheart Djinn have On Soaring Winds (sk p.36).'];
    const pre = canTakeAction(s, r.id, 'march');
    if (pre.length) return pre;
  } else if (!s.pendingMove || s.pendingMove.regimentId !== r.id || s.pendingMove.kind !== kind) return [`No ${SPECIAL_MOVE_LABEL[kind]} is waiting for ${r.name}.`];
  if (!moves.length) return ['Set a move first.'];
  if (kind !== 'soaring' && moves.some((m) => m.kind === 'wheel')) return [`${SPECIAL_MOVE_LABEL[kind]} cannot Wheel.`];
  if (moves.some((m) => (m.kind === 'forward' || m.kind === 'backward') && m.d < 0)) return ['Moves cannot be negative.'];
  const width = footprint(formationInput(s, r)).halfWidth * 2;
  const max = specialMoveAllowance(s, r.id, kind);
  const cost = pathCost(moves, width);
  if (cost > max + 1e-9) return [`The move is ${cost.toFixed(2)}″, more than ${max}″.`];
  // Air Step moves as a March (it cannot pass through enemies); the others ignore what is in the way.
  if (kind === 'airStep') {
    const pp = pathProblems(s, r, samplePath(r.pose, moves, width), false);
    if (pp.length) return pp;
  }
  const end = applyPath(r.pose, moves, width);
  return positionProblems(s, r, regimentPolys(s, r, { pose: end }), { allowFriendOverlap: false, allowOffTable: false });
}

export function applySpecialMove(ctx: Ctx, regimentId: string, moves: MoveSeg[], kind: SpecialMoveKind, describe: (m: MoveSeg[]) => string): void {
  const s = ctx.s;
  const r = s.regiments[regimentId]!;
  const width = footprint(formationInput(s, r)).halfWidth * 2;
  r.pose = applyPath(r.pose, moves, width);
  if (kind === 'soaring') recordAction(s.activation!, 'march');
  else delete s.pendingMove;
  ev(ctx, { type: 'march', text: `${SPECIAL_MOVE_LABEL[kind]}: ${r.name} moves ${describe(moves)}.`, player: r.owner, regimentId: r.id });
}
