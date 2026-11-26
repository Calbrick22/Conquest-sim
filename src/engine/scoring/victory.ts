import { ev, type Ctx } from '../dice';
import { resolveAttack } from '../combat';
import { layout } from '../formation';
import { rectPoly } from '../geometry/polygon';
import { standOverlapsZone } from '../geometry/zones';
import type { GameState, PlayerId, RoundScore } from '../model/types';
import { attachedCharacter, formationInput, isEngaged, markerPolys, onTableRegiments } from '../queries';
import { designatedForScoring } from './designations';
import { seizeBonusFor, unhallowed } from '../factions/oldDominion';
import { cycloned, skVictoryStart } from '../factions/sorcererKingsActions';
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
  const slotsByReg = regs.map((r) => {
    const slots = layout(formationInput(s, r));
    return { r, slots, polys: slots.map((sl) => rectPoly(sl.rect)) };
  });
  const mPolys = markerPolys(s);
  for (const z of s.scenario.zones) {
    // A Burned zone has left the game (Flames of Conquest, ns p.5).
    if ((s.burnedZones ?? []).includes(z.id)) continue;
    const centre = { x: z.x, y: z.y };
    const stands: StandInRange[] = [];
    for (const { r, slots, polys } of slotsByReg) {
      // Pheromantic Compulsion (sp p.15): counts as 0 Stands for Seizing or Contesting.
      if (r.flags.compelled) continue;
      // Cyclone (sk p.20): engaged with a [Court of Air] Regiment, it counts as 0 Stands.
      if (cycloned(s, r)) continue;
      let regBonus = r.flags.seizeBonus ?? 0; // Exhortation of Eternal Faith (od p.30): once per Regiment
      polys.forEach((p, i) => {
        if (!standOverlapsZone(p, centre, z.diameter)) return;
        const sl = slots[i]!;
        const c = sl.isCharacter ? attachedCharacter(s, r.id) : undefined;
        // Imperial Oplon (od p.18): the Character counts as two more Stands for Seizing.
        const charBonus = c && c.options.some((o) => o.toLowerCase() === 'imperial oplon') ? 2 : 0;
        const bonus = seizeBonusFor(r, sl.isCommand) + charBonus + regBonus;
        regBonus = 0;
        // Unhallowed Ground (od p.15, p.30): six Stands toward the total, none toward Seizing.
        const uh = unhallowed(r);
        stands.push({ owner: r.owner, cls: r.cls, isMonster: r.type === 'Monster', canSeize: !r.broken && !r.flags.declinedDuel, ...(bonus ? { bonus } : {}), ...(uh ? { totalCount: 6, noBaseSeize: true } : {}) });
      });
    }
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
  priorityZoneSeized: 'zones',
  zoneBurned: 'zones',
  chosenZoneSeized: 'zones',
  linebreakerInTerritory: 'zones',
  killedByChosen: 'kills',
  designatedDestroyed: 'kills',
  missingDesignated: 'kills',
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
  cursedSanctuaries(ctx);
  // Prince of the Setting Moon (sk p.17): friendly [Mortals] within range of an Objective Zone Heal 3.
  skVictoryStart(ctx, (r) => {
    const polys = layout(formationInput(s, r)).map((sl) => rectPoly(sl.rect));
    return s.scenario.zones.some((z) => !(s.burnedZones ?? []).includes(z.id) && polys.some((p) => standOverlapsZone(p, { x: z.x, y: z.y }, z.diameter)));
  });
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
    ...(s.tally.burned ? { burned: s.tally.burned } : {}),
    ...designationFacts(s, seized),
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

/**
 * Designation facts for the Victory Phase (ns p.2, p.6). RULE-AMBIGUITY: AMB-91 — a zone counts as
 * Seized "with Chosen Regiments" when one of the player's own Chosen Regiments (marked by the enemy)
 * can Seize and has a Stand in it; a Linebreaker is "in enemy territory" when every Stand is within
 * the enemy's band; missing Chosen Regiments are scored in the first Victory Phase.
 */
function designationFacts(s: GameState, seized: Record<PlayerId, string[]>): Partial<RoundFacts> {
  const d = s.scenario.designate;
  if (!d || !s.designated) return {};
  const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');
  const polysOf = (id: string) => {
    const r = s.regiments[id];
    return r && r.location === 'table' ? layout(formationInput(s, r)).map((sl) => rectPoly(sl.rect)) : [];
  };
  const out: Partial<RoundFacts> = {
    designatedDestroyed: {
      P1: (s.tally.destroyedIds?.P1 ?? []).filter((id) => designatedForScoring(s, 'P1', id)).length,
      P2: (s.tally.destroyedIds?.P2 ?? []).filter((id) => designatedForScoring(s, 'P2', id)).length,
    },
  };
  if (d.kind === 'chosen') {
    const chosenZones = { P1: 0, P2: 0 };
    for (const p of ['P1', 'P2'] as const)
      for (const zid of seized[p]) {
        const z = s.scenario.zones.find((x) => x.id === zid)!;
        const mine = s.designated[other(p)].filter((id) => s.regiments[id] && !s.regiments[id]!.broken && !s.regiments[id]!.flags.declinedDuel);
        if (mine.some((id) => polysOf(id).some((q) => standOverlapsZone(q, { x: z.x, y: z.y }, z.diameter)))) chosenZones[p] += 1;
      }
    out.chosenZones = chosenZones;
    out.killsByChosen = { P1: s.tally.killsByChosen?.P1 ?? 0, P2: s.tally.killsByChosen?.P2 ?? 0 };
    // Fewer than three non-Light Regiments in the enemy list: the missing ones score as if destroyed (ns p.2).
    const nonLight = (p: PlayerId) => Object.values(s.regiments).filter((r) => r.owner === p && r.cls !== 'Light').length;
    if (s.round === 1) out.missingDesignated = { P1: Math.max(0, d.count - nonLight('P2')), P2: Math.max(0, d.count - nonLight('P1')) };
  } else {
    const band = s.scenario.territories;
    const inEnemyLand = (p: PlayerId, id: string) => {
      const q = other(p);
      const depth = band?.[q] ?? 6;
      const edge = s.scenario.reinforcementZones[q];
      const H = s.scenario.table.height;
      const W = s.scenario.table.width;
      const ps = polysOf(id);
      const d0 = (v: { x: number; y: number }) => (edge === 'bottom' ? v.y : edge === 'top' ? H - v.y : edge === 'left' ? v.x : W - v.x);
      return ps.length > 0 && ps.every((poly) => poly.every((v) => d0(v) <= depth + 1e-6));
    };
    const count = (p: PlayerId) => s.designated![p].filter((id) => s.regiments[id]?.location === 'table' && !isEngaged(s, s.regiments[id]!) && inEnemyLand(p, id)).length;
    out.linebreakersInTerritory = { P1: count('P1'), P2: count('P2') };
  }
  return out;
}

/**
 * Cursed Sanctuaries (ns p.4): in each Victory Phase, every Regiment within a zone suffers that
 * zone's Hits, rolled against its Resolve (its Defense if it has none), from the front, with no
 * Morale Tests. RULE-AMBIGUITY: AMB-63 — resolved before scoring; the Regiment's own Resolve
 * Characteristic is used (no size bonus); Regiments destroyed this way count for the enemy.
 */
function cursedSanctuaries(ctx: Ctx): void {
  const s = ctx.s;
  const hitsBy = s.scenario.cursedSanctuaries;
  if (!hitsBy || s.round < s.scenario.objectivesFromRound) return;
  for (const z of s.scenario.zones) {
    if ((s.burnedZones ?? []).includes(z.id)) continue;
    const hits = hitsBy[String(z.diameter)];
    if (!hits) continue;
    for (const r of onTableRegiments(s)) {
      const polys = layout(formationInput(s, r)).map((sl) => rectPoly(sl.rect));
      if (!polys.some((p) => standOverlapsZone(p, { x: z.x, y: z.y }, z.diameter))) continue;
      const R = r.profile.R;
      ev(ctx, { type: 'note', text: `Cursed Sanctuary ${z.id}: ${r.name} suffers ${hits} Hits against its ${R === null ? 'Defense' : `Resolve ${R}`} (ns p.4).`, regimentId: r.id });
      resolveAttack(ctx, {
        attackerOwner: r.owner === 'P1' ? 'P2' : 'P1',
        targetId: r.id,
        arc: 'front',
        pools: [{ label: 'Cursed Sanctuary', dice: 0, skill: 0, autoHits: hits, ...(R !== null ? { defenseOverride: Math.max(0, R + r.roundMods.filter((m) => m.stat === 'R').reduce((a, m) => a + m.delta, 0)) } : {}) }],
        morale: false,
        terrifying: 0,
        what: 'Cursed Sanctuary',
        kind: 'special',
      });
    }
  }
}
