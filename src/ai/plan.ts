import type { GameState, PlayerId, RegimentState } from '../engine/model/types';
import { barrageOf } from '../engine/rules/special/rules';

/**
 * The computer's game plan, worked out once per game from the armies and the scenario: the table
 * is split into three lanes (left, centre, right); each Regiment is given a lane, in proportion to
 * the objectives there, with screens and shooters spread across them; and a posture (aggressive or
 * objective-first) from the armies' relative strength. Decisions then enter and advance by lane and
 * hold back until the lane's force has arrived, instead of feeding Regiments in one at a time.
 * The plan depends only on things fixed at the start of the game, so it is the same at every
 * decision (and in a replay).
 */
export type Lane = 'left' | 'centre' | 'right';

export interface GamePlan {
  posture: 'aggressive' | 'objectives';
  /** The x position each lane advances along. */
  laneX: Record<Lane, number>;
  /** The lane of each friendly Regiment. */
  lanes: Record<string, Lane>;
  /** Total value given to each lane. */
  weight: Record<Lane, number>;
  summary: string;
}

const LANES: Lane[] = ['left', 'centre', 'right'];
const cache = new Map<string, GamePlan>();

/** Rough fighting worth of a Regiment from its full strength (for the plan only). */
export function planValue(r: RegimentState): number {
  const per = Math.max(1, r.profile.W ?? 1) * (1 + (r.profile.A ?? 0) / 4);
  return r.startingStands * per * (r.type === 'Monster' ? 1.4 : 1);
}

function laneOf(x: number, width: number): Lane {
  return x < width / 3 ? 'left' : x > (2 * width) / 3 ? 'right' : 'centre';
}

export function gamePlan(s: GameState, p: PlayerId): GamePlan {
  const key = `${s.seed}|${p}|${s.scenario.id}|${Object.keys(s.regiments).length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = s.scenario.table.width;
  const zones = s.scenario.zones.filter((z) => z.friendlyTo !== p);
  // Lane anchors: the mean x of the zones in each lane, else the lane's middle.
  const laneX = {} as Record<Lane, number>;
  const need = {} as Record<Lane, number>;
  LANES.forEach((l, i) => {
    const zs = zones.filter((z) => laneOf(z.x, W) === l);
    laneX[l] = zs.length ? zs.reduce((a, z) => a + z.x, 0) / zs.length : (W * (2 * i + 1)) / 6;
    // Every lane gets some force; lanes with more (and bigger) objectives get more.
    need[l] = 0.6 + zs.reduce((a, z) => a + (z.diameter >= 9 ? 1.5 : 1), 0);
  });
  const mine = Object.values(s.regiments).filter((r) => r.owner === p);
  const theirs = Object.values(s.regiments).filter((r) => r.owner !== p);
  const total = mine.reduce((a, r) => a + planValue(r), 0);
  const needSum = LANES.reduce((a, l) => a + need[l], 0);
  const weight: Record<Lane, number> = { left: 0, centre: 0, right: 0 };
  const lanes: Record<string, Lane> = {};
  // Biggest first, each to the lane furthest below its share; screens and shooters spread first.
  const order = [...mine].sort((a, b) => {
    const tag = (r: RegimentState) => (r.cls === 'Light' ? 2 : barrageOf(r.rules) ? 1 : 0);
    return tag(b) - tag(a) || planValue(b) - planValue(a) || a.id.localeCompare(b.id);
  });
  const spread = new Set<Lane>();
  for (const r of order) {
    const special = r.cls === 'Light' || !!barrageOf(r.rules);
    let pick: Lane;
    if (special && spread.size < 3) {
      pick = LANES.filter((l) => !spread.has(l)).sort((a, b) => need[b] - need[a])[0]!;
      spread.add(pick);
    } else pick = [...LANES].sort((a, b) => weight[a] / (need[a] / needSum) - weight[b] / (need[b] / needSum))[0]!;
    lanes[r.id] = pick;
    weight[pick] += planValue(r) / Math.max(1, total);
  }
  const ratio = total / Math.max(1, theirs.reduce((a, r) => a + planValue(r), 0));
  const posture: GamePlan['posture'] = ratio >= 1.1 ? 'aggressive' : 'objectives';
  const count = (l: Lane) => mine.filter((r) => lanes[r.id] === l).length;
  const plan: GamePlan = {
    posture,
    laneX,
    lanes,
    weight,
    summary: `game plan: ${posture === 'aggressive' ? 'press the attack' : 'take and hold the objectives'}; Regiments by lane left ${count('left')}, centre ${count('centre')}, right ${count('right')}`,
  };
  cache.set(key, plan);
  return plan;
}

/**
 * How far forward (toward the enemy) a point is, from this player's edge.
 */
export function forwardOf(s: GameState, p: PlayerId, y: number): number {
  return s.scenario.reinforcementZones[p] === 'top' ? s.scenario.table.height - y : y;
}

/**
 * Share of a lane's planned force already on the table (0–1). Until most of it has arrived, its
 * Regiments keep in line with each other rather than pushing on alone.
 */
export function laneArrived(s: GameState, p: PlayerId, lane: Lane): number {
  const plan = gamePlan(s, p);
  const inLane = Object.values(s.regiments).filter((r) => r.owner === p && plan.lanes[r.id] === lane && r.location !== 'destroyed');
  const all = inLane.reduce((a, r) => a + planValue(r), 0);
  const here = inLane.filter((r) => r.location === 'table').reduce((a, r) => a + planValue(r), 0);
  return all ? here / all : 1;
}
