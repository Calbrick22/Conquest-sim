import type { PlayerId, ScenarioDef, ScoringRule } from '../../scenarios/types';

/** Everything the Victory Phase needs to score one player for one Round. */
export interface RoundFacts {
  round: number;
  /** Zone ids Seized by each player this Victory Phase. */
  seized: Record<PlayerId, string[]>;
  /** Marker ids destroyed by each player during this Round. */
  markersDestroyed: Record<PlayerId, string[]>;
  /** Enemy Character Stands destroyed by each player during this Round. */
  charactersKilled: Record<PlayerId, number>;
  /** Enemy Regiments destroyed by each player during this Round. */
  regimentsDestroyed: Record<PlayerId, number>;
  /** Did each player slay the enemy Warlord this Round? */
  warlordSlain: Record<PlayerId, boolean>;
  /** Has each player already scored a once-per-game Warlord bonus in an earlier Round? */
  warlordScoredBefore: Record<PlayerId, boolean>;
  /** Zone picks for scenarios with a zonePick rule. */
  zonePicks?: Record<PlayerId, string | null>;
  /** Zones each player Burned this Round (Flames of Conquest, ns p.5). */
  burned?: Record<PlayerId, string[]>;
}

/** The Priority Zone this Round (Wheel of War, ns p.3): the list repeats from Round 1. */
export function priorityZone(s: ScenarioDef, round: number): string | null {
  const z = s.priorityZones;
  return z && z.length ? z[(round - 1) % z.length]! : null;
}

export interface ScoreLine {
  rule: ScoringRule['kind'];
  vp: number;
  detail: string;
}

export interface PlayerRoundScore {
  total: number;
  lines: ScoreLine[];
}

const other = (p: PlayerId): PlayerId => (p === 'P1' ? 'P2' : 'P1');

function inRounds(rule: { rounds?: number[] }, round: number): boolean {
  return !rule.rounds || rule.rounds.includes(round);
}

/**
 * Zones that give no per-zone VP this Round, and zones that give double VP (pack p.12, p.19).
 * RULE-AMBIGUITY: AMB-24 — picked zones still count toward "Seizing N zones" bonuses.
 * RULE-AMBIGUITY: AMB-26 — Foresight: if both players secretly pick the same zone, that zone is
 * not blanked but awards double per-zone VP instead.
 */
function zoneModifiers(s: ScenarioDef, f: RoundFacts): { blank: Set<string>; double: Set<string> } {
  const blank = new Set<string>();
  const double = new Set<string>();
  const picks = f.zonePicks;
  if (!s.zonePick || !picks) return { blank, double };
  if (s.zonePick.mode === 'vetoDistinct') {
    for (const z of [picks.P1, picks.P2]) if (z) blank.add(z);
  } else if (s.zonePick.mode === 'vetoSecret') {
    if (picks.P1 && picks.P1 === picks.P2) double.add(picks.P1);
    else for (const z of [picks.P1, picks.P2]) if (z) blank.add(z);
  }
  return { blank, double };
}

/** Pure Victory Phase scoring for one player (rules per scenario, pack p.11–22). */
export function scoreRound(s: ScenarioDef, f: RoundFacts, player: PlayerId): PlayerRoundScore {
  const lines: ScoreLine[] = [];
  const add = (rule: ScoringRule['kind'], vp: number, detail: string) => {
    if (vp !== 0) lines.push({ rule, vp, detail });
  };
  const seized = f.round >= s.objectivesFromRound ? f.seized[player] : [];
  const seizedOpp = f.round >= s.objectivesFromRound ? f.seized[other(player)] : [];
  const { blank, double } = zoneModifiers(s, f);
  const markerOwner = new Map(s.markers.map((m) => [m.id, m.friendlyTo]));
  // A player only scores Markers that are not friendly to them (pack p.8; AMB-14, AMB-23).
  const destroyed = f.markersDestroyed[player].filter((id) => markerOwner.get(id) !== player);

  for (const rule of s.scoring) {
    if (!inRounds(rule, f.round)) continue;
    switch (rule.kind) {
      case 'perZoneSeized': {
        if (rule.players && !rule.players.includes(player)) break;
        for (const z of seized) {
          if (rule.zoneIds && !rule.zoneIds.includes(z)) continue;
          if (blank.has(z)) continue;
          add(rule.kind, rule.vp * (double.has(z) ? 2 : 1), `Seized ${z}${double.has(z) ? ' (double)' : ''}`);
        }
        break;
      }
      case 'seizedCountBonus': {
        const n = seized.filter((z) => !rule.zoneIds || rule.zoneIds.includes(z)).length;
        if (n >= rule.min) add(rule.kind, rule.vp, `Seizing ${n} zones (≥ ${rule.min})`);
        break;
      }
      case 'seizingMoreZonesThanOpponent':
        if (seized.length > seizedOpp.length) add(rule.kind, rule.vp, `Seizing more zones (${seized.length} v ${seizedOpp.length})`);
        break;
      case 'markerDestroyed':
        for (const id of destroyed) if (!rule.markerIds || rule.markerIds.includes(id)) add(rule.kind, rule.vp, `Destroyed Marker ${id}`);
        break;
      case 'markersDestroyedCountBonus':
        if (destroyed.length >= rule.min) add(rule.kind, rule.vp, `Destroyed ${destroyed.length} Markers this Round`);
        break;
      case 'characterKilled':
        add(rule.kind, rule.vp * f.charactersKilled[player], `${f.charactersKilled[player]} enemy Character Stand(s) destroyed`);
        break;
      case 'regimentDestroyed':
        add(rule.kind, rule.vp * f.regimentsDestroyed[player], `${f.regimentsDestroyed[player]} enemy Regiment(s) destroyed`);
        break;
      case 'warlordSlain':
        if (f.warlordSlain[player] && !(rule.oncePerGame && f.warlordScoredBefore[player])) add(rule.kind, rule.vp, 'Slew the enemy Warlord');
        break;
      case 'pickedZoneSeized': {
        const pick = f.zonePicks?.[player];
        if (pick && seized.includes(pick)) add(rule.kind, rule.vp, `Seized picked zone ${pick}`);
        break;
      }
      case 'priorityZoneSeized': {
        const pz = priorityZone(s, f.round);
        if (pz && seized.includes(pz)) add(rule.kind, rule.vp, `Seized the Priority Zone ${pz}`);
        break;
      }
      case 'zoneBurned':
        for (const z of f.burned?.[player] ?? []) add(rule.kind, rule.vp, `Burned zone ${z}`);
        break;
    }
  }
  return { total: lines.reduce((a, l) => a + l.vp, 0), lines };
}

export function emptyFacts(round: number): RoundFacts {
  return {
    round,
    seized: { P1: [], P2: [] },
    markersDestroyed: { P1: [], P2: [] },
    charactersKilled: { P1: 0, P2: 0 },
    regimentsDestroyed: { P1: 0, P2: 0 },
    warlordSlain: { P1: false, P2: false },
    warlordScoredBefore: { P1: false, P2: false },
  };
}
