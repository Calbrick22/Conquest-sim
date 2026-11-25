import { validate, type Action, type ActionBody } from '../engine/game';
import type { GameState, RegimentState } from '../engine/model/types';
import { distancePolys, isEngaged, marchValue, onTableRegiments, regimentPolys } from '../engine/queries';
import { barrageOf } from '../engine/rules/special/rules';
import { spellDef } from '../engine/spells';
import { dw, empowerments, isAwakened } from '../engine/factions/dweghom';

/**
 * Computer choices for Dweghom (dw p.4–45): Empowerments, Draw Events and spending Elemental
 * Power. Simple heuristics; every choice is checked with the engine's `validate`.
 */
export interface DwAiDecision {
  action: ActionBody;
  reason: string;
}

const legal = (s: GameState, a: ActionBody) => validate(s, a as Action).ok;
const nearestEnemy = (s: GameState, r: RegimentState) =>
  r.location !== 'table' ? 99 : Math.min(99, ...onTableRegiments(s).filter((e) => e.owner !== r.owner).map((e) => distancePolys(regimentPolys(s, r), regimentPolys(s, e))));

export function aiDwActivation(s: GameState, r: RegimentState, characterId?: string): DwAiDecision | null {
  const act = s.activation!;
  const st = dw(s, r.owner);
  if (!st || act.actions.length) return null;
  const fighting = r.location === 'table' && (isEngaged(s, r) || nearestEnemy(s, r) < 10);
  // A shooter Empowers only with an enemy within its Barrage range plus a March.
  const b = barrageOf(r.rules);
  const shoots = !!b && r.location === 'table' && nearestEnemy(s, r) <= b.range + marchValue(s, r);
  // Not All who Wander / Heralds: spend Markers to Awaken before a fight.
  if (!characterId && fighting && !isAwakened(s, r)) {
    for (const what of ['wander', 'herald'] as const) {
      const a: ActionBody = { type: 'dwSpend', regimentId: r.id, what };
      if (st.pool >= (what === 'wander' ? 4 : 3) && legal(s, a)) return { action: a, reason: `spends Elemental Power to become Awakened (${what === 'wander' ? 'Not All who Wander are Lost' : 'Herald'})` };
    }
  }
  if (act.drawEvents?.length) return null;
  const names = characterId ? s.characters[characterId]!.drawEvents : r.drawEvents;
  const friends = onTableRegiments(s).filter((x) => x.owner === r.owner);
  for (const n of names) {
    if (n === 'Forged By the Elements' && (fighting || shoots)) {
      // The most Markers it can use well: "both" with a deep pool, else the first.
      const opts = empowerments(s, r).filter((e) => e.cost <= st.pool).sort((a, b) => b.cost - a.cost);
      const pick = opts.find((e) => e.cost === 1 || st.pool >= e.cost + 2) ?? opts[opts.length - 1];
      const a: ActionBody = { type: 'drawEvent', name: n, option: pick?.id ?? 'a' };
      if (pick && legal(s, a)) return { action: a, reason: `Forged By the Elements: ${pick.label}` };
    }
    if (n === 'Unassailable Authority') {
      const a: ActionBody = { type: 'drawEvent', name: n };
      if (legal(s, a) && !isAwakened(s, r)) return { action: a, reason: 'Unassailable Authority: its Regiment Awakens' };
    }
    if (n === 'Preternatural Focus') {
      const t = friends.filter((x) => !isAwakened(s, x) && legal(s, { type: 'drawEvent', name: n, targetId: x.id })).sort((a, b) => nearestEnemy(s, a) - nearestEnemy(s, b))[0];
      if (t) return { action: { type: 'drawEvent', name: n, targetId: t.id }, reason: `Preternatural Focus Awakens ${t.name}` };
    }
    if (n === 'Fires of the Descent') {
      const t = friends.filter((x) => isEngaged(s, x) && legal(s, { type: 'drawEvent', name: n, targetId: x.id }))[0];
      if (t) return { action: { type: 'drawEvent', name: n, targetId: t.id }, reason: `Fires of the Descent: ${t.name} gains Relentless Blows` };
    }
    if (n === 'Runeforged Plate' && fighting && st.pool >= 2) {
      const a: ActionBody = { type: 'drawEvent', name: n, option: '2' };
      if (legal(s, a)) return { action: a, reason: 'Runeforged Plate: +4 Attacks' };
    }
    if (n === 'Gifted in Fire' && st.pool < 10) {
      const a: ActionBody = { type: 'drawEvent', name: n };
      if (legal(s, a)) return { action: a, reason: 'Gifted in Fire: an Elemental Power Marker' };
    }
  }
  return null;
}

/** Tempered Creed boost (dw p.7): spend 2 Markers for +1 Wizard when the pool is deep. */
export function aiBoost(s: GameState, a: ActionBody): ActionBody {
  // Only for Spells that cause Hits, where more successes mean more damage.
  if (a.type !== 'spell' || !spellDef(a.spell)?.hits) return a;
  for (const b of [4, 2]) {
    const st = dw(s, s.activation ? s.regiments[s.activation.regimentId]!.owner : 'P1');
    if (!st || st.pool < b + 3) continue;
    const boosted: ActionBody = { ...a, boost: b };
    if (legal(s, boosted)) return boosted;
  }
  return a;
}
