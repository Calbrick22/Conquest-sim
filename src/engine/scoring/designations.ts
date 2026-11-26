import { ev, type Ctx } from '../dice';
import type { GameState, PlayerId, RegimentState } from '../model/types';

/**
 * Scenario designations (2026 scenarios, ns p.2 and p.6):
 * - Seek and Destroy: before the first Supremacy Phase each player marks up to three non-Light
 *   enemy Regiments as Chosen Regiments.
 * - Break the Line: at the start each player nominates two friendly Regiments able to Seize
 *   (non-Light) as Linebreakers; they lose Fly.
 * The engine designates the most valuable eligible Regiments when the game starts; each player may
 * change theirs until the first Supremacy Phase. RULE-AMBIGUITY: AMB-91.
 */
const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');
const regimentValue = (r: RegimentState) => r.stands.length * Math.max(1, r.profile.W ?? 1) * (r.cls === 'Heavy' ? 3 : r.cls === 'Medium' ? 2 : 1);

export function designationPool(s: GameState, p: PlayerId): RegimentState[] {
  const d = s.scenario.designate;
  if (!d) return [];
  const owner = d.kind === 'chosen' ? other(p) : p;
  return Object.values(s.regiments).filter((r) => r.owner === owner && r.cls !== 'Light' && r.location !== 'destroyed');
}

export function defaultDesignations(ctx: Ctx): void {
  const s = ctx.s;
  const d = s.scenario.designate;
  if (!d || s.designated) return;
  s.designated = { P1: [], P2: [] };
  for (const p of ['P1', 'P2'] as const) {
    s.designated[p] = designationPool(s, p)
      .sort((a, b) => regimentValue(b) - regimentValue(a))
      .slice(0, d.count)
      .map((r) => r.id);
    const names = s.designated[p].map((id) => s.regiments[id]!.name).join(', ') || 'none';
    ev(ctx, { type: 'note', text: `${p}'s ${d.kind === 'chosen' ? 'Chosen Regiments (enemy)' : 'Linebreakers'}: ${names} (${d.kind === 'chosen' ? 'ns p.2' : 'ns p.6'}; change them before the first Supremacy Phase).`, player: p });
  }
}

export function designateProblems(s: GameState, p: PlayerId, ids: string[]): string[] {
  const d = s.scenario.designate;
  if (!d) return ['This scenario has no designations.'];
  const early = s.phase === 'setup' || (s.phase === 'play' && s.round === 1 && (s.step === 'reinforcement' || s.step === 'command'));
  if (!early) return ['Designations are made before the first Supremacy Phase (ns p.2, p.6).'];
  if (new Set(ids).size !== ids.length || ids.length > d.count) return [`Choose up to ${d.count} Regiments.`];
  const pool = new Set(designationPool(s, p).map((r) => r.id));
  return ids.every((id) => pool.has(id)) ? [] : [d.kind === 'chosen' ? 'Chosen Regiments are non-Light enemy Regiments (ns p.2).' : 'Linebreakers are friendly Regiments able to Seize (ns p.6).'];
}

export function applyDesignate(ctx: Ctx, p: PlayerId, ids: string[]): void {
  const s = ctx.s;
  s.designated ??= { P1: [], P2: [] };
  s.designated[p] = [...ids];
  ev(ctx, { type: 'note', text: `${p} designates ${ids.map((id) => s.regiments[id]!.name).join(', ') || 'no Regiments'} as ${s.scenario.designate!.kind === 'chosen' ? 'Chosen Regiments' : 'Linebreakers'}.`, player: p });
}

/** Is this Regiment a Linebreaker (loses Fly; ns p.6)? */
export function isLinebreaker(s: GameState, r: RegimentState): boolean {
  return s.scenario.designate?.kind === 'linebreakers' && !!s.designated?.[r.owner].includes(r.id);
}

/** Is this Regiment Chosen (marked by its enemy; ns p.2)? */
export function isChosen(s: GameState, r: RegimentState): boolean {
  return s.scenario.designate?.kind === 'chosen' && !!s.designated?.[other(r.owner)].includes(r.id);
}

/** Is this Regiment designated by the enemy of `p` against p's interest: an enemy Chosen or enemy Linebreaker destroyed by p? */
export function designatedForScoring(s: GameState, p: PlayerId, id: string): boolean {
  const d = s.scenario.designate;
  if (!d || !s.designated) return false;
  return d.kind === 'chosen' ? s.designated[p].includes(id) : s.designated[other(p)].includes(id);
}
