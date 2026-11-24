import { ev, type Ctx } from '../dice';
import { layout } from '../formation';
import { rectPoly } from '../geometry/polygon';
import { standOverlapsZone } from '../geometry/zones';
import type { GameState, PlayerId, RoundScore } from '../model/types';
import { formationInput, markerPolys, onTableRegiments } from '../queries';
import { scoreRound, type RoundFacts } from './scoreRound';
import { hasRule } from '../rules/special/rules';
import { resolveZone, type StandInRange, type ZoneSeizeResult } from './seizing';

export type ZoneResults = Record<string, ZoneSeizeResult & { contestedBy: PlayerId[] }>;

/**
 * Who Seizes each Objective Zone right now (core p.106; pack p.8). A Stand is in range when it
 * overlaps the zone. Characters count as Stands of their Regiment's Class. Broken Regiments and
 * Regiments whose Character declined a Duel cannot Seize (core p.60, p.76) but still count toward
 * the total. A friendly Objective Marker in a zone makes it Contested for the enemy (pack p.8).
 */
export function zoneResults(s: GameState): ZoneResults {
  const out: ZoneResults = {};
  const regs = onTableRegiments(s);
  const slotsByReg = regs.map((r) => ({ r, polys: layout(formationInput(s, r)).map((sl) => rectPoly(sl.rect)) }));
  const mPolys = markerPolys(s);
  for (const z of s.scenario.zones) {
    const centre = { x: z.x, y: z.y };
    const stands: StandInRange[] = [];
    for (const { r, polys } of slotsByReg)
      for (const p of polys)
        if (standOverlapsZone(p, centre, z.diameter))
          stands.push({ owner: r.owner, cls: r.cls, isMonster: r.type === 'Monster', canSeize: !r.broken && !r.flags.declinedDuel });
    const contestedBy: PlayerId[] = [];
    s.scenario.markers.forEach((m, i) => {
      if (m.friendlyTo && !s.markers[m.id]?.destroyed && standOverlapsZone(mPolys[i]!, centre, z.diameter)) contestedBy.push(m.friendlyTo);
    });
    // Unyielding (core p.101): enemies cannot Seize a zone this Regiment is in range of (unless it is Broken).
    for (const { r, polys } of slotsByReg)
      if (hasRule(r.rules, 'Unyielding') && !r.broken && polys.some((p) => standOverlapsZone(p, centre, z.diameter)) && !contestedBy.includes(r.owner)) contestedBy.push(r.owner);
    const res = resolveZone({ stands, ...(z.friendlyTo ? { friendlyTo: z.friendlyTo } : {}), contestedBy });
    out[z.id] = { ...res, contestedBy };
  }
  return out;
}

const RULE_GROUP: Record<string, 'zones' | 'kills'> = {
  perZoneSeized: 'zones',
  seizedCountBonus: 'zones',
  seizingMoreZonesThanOpponent: 'zones',
  pickedZoneSeized: 'zones',
  markerDestroyed: 'kills',
  markersDestroyedCountBonus: 'kills',
  characterKilled: 'kills',
  regimentDestroyed: 'kills',
  warlordSlain: 'kills',
};

/** Splits a player's Round score into "zones" and "kills and Markers" (for the game log). */
export function scoreGroups(rs: RoundScore, p: PlayerId): { zones: number; kills: number } {
  let zones = 0;
  let kills = 0;
  for (const l of rs.lines[p]) {
    if (RULE_GROUP[l.rule] === 'zones') zones += l.vp;
    else kills += l.vp;
  }
  return { zones, kills };
}

/** Victory Phase scoring (core p.106; scenario rules pack p.11–22). */
export function victoryPhase(ctx: Ctx): RoundScore {
  const s = ctx.s;
  const active = s.round >= s.scenario.objectivesFromRound;
  const zr = zoneResults(s);
  const seized: Record<PlayerId, string[]> = { P1: [], P2: [] };
  if (active) for (const [id, r] of Object.entries(zr)) if (r.seizedBy) seized[r.seizedBy].push(id);
  const facts: RoundFacts = {
    round: s.round,
    seized,
    markersDestroyed: s.tally.markersDestroyed,
    charactersKilled: s.tally.charactersKilled,
    regimentsDestroyed: s.tally.regimentsDestroyed,
    warlordSlain: s.tally.warlordSlain,
    warlordScoredBefore: { ...s.warlordScored },
    ...(s.scenario.zonePick ? { zonePicks: s.zonePicks } : {}),
  };
  const rs: RoundScore = { round: s.round, seized, vp: { P1: 0, P2: 0 }, lines: { P1: [], P2: [] } };
  for (const p of ['P1', 'P2'] as const) {
    const sc = scoreRound(s.scenario, facts, p);
    rs.vp[p] = sc.total;
    rs.lines[p] = sc.lines;
    s.players[p].vp += sc.total;
    if (sc.lines.some((l) => l.rule === 'warlordSlain')) s.warlordScored[p] = true;
    ev(ctx, {
      type: 'score',
      player: p,
      text: `${p} scores ${sc.total} VP in Round ${s.round}${sc.lines.length ? `: ${sc.lines.map((l) => `${l.detail} (${l.vp})`).join('; ')}` : ''}. Total ${s.players[p].vp}.`,
    });
  }
  if (!active) ev(ctx, { type: 'score', text: `Objective Zones cannot be Seized before Round ${s.scenario.objectivesFromRound} (pack p.8).` });
  s.scoreHistory.push(rs);
  return rs;
}

export { scoreRound };
