import type { GameEvent } from '../model/events';
import type { GameState, PlayerId } from '../model/types';
import { scoreGroups } from '../scoring/victory';

export interface LogInput {
  state: GameState;
  events: GameEvent[];
  /** The player's own side ("me" in the log). */
  you: PlayerId;
  /** ISO date of the game. */
  date: string;
}

/**
 * Game log in the owner's Markdown format (header, result, score table by Round), followed by
 * the full event log.
 */
export function gameLogMarkdown({ state: s, events, you, date }: LogInput): string {
  const them: PlayerId = you === 'P1' ? 'P2' : 'P1';
  const mine = s.players[you].vp;
  const theirs = s.players[them].vp;
  const finished = s.phase === 'ended';
  const result = !finished ? 'In progress' : mine > theirs ? 'Won' : mine < theirs ? 'Lost' : 'Drew';
  const pts = s.players[you].points ?? s.players[them].points;
  const rounds = Array.from({ length: s.scenario.rounds }, (_, i) => i + 1);
  const cell = (round: number, p: PlayerId, k: 'zones' | 'kills') => {
    const rs = s.scoreHistory.find((x) => x.round === round);
    return rs ? String(scoreGroups(rs, p)[k]) : '';
  };
  const row = (label: string, p: PlayerId, k: 'zones' | 'kills') => `| ${label} | ${rounds.map((r) => cell(r, p, k)).join(' | ')} |`;
  const lines = [
    `# Game log: ${s.scenario.name} — ${s.players[you].listName} vs ${s.players[them].faction}, ${date}`,
    `**Result:** ${result} ${mine}-${theirs} (${s.scenario.name}${pts ? `, ${pts} pts` : ''})`,
    `## Score by Round`,
    `| Round | ${rounds.join(' | ')} |`,
    `|---|${rounds.map(() => '---').join('|')}|`,
    row('My zones', you, 'zones'),
    row('My kills and Markers', you, 'kills'),
    row('His zones', them, 'zones'),
    row('His kills', them, 'kills'),
    '',
    `I played ${you} (${you === 'P1' ? 'bottom' : 'top'} edge). Seed ${s.seed}.`,
    '',
    '## Event log',
    '',
    ...events.map((e) => `- R${e.round}${e.override ? ' **[override]**' : ''} ${e.text}`),
    '',
  ];
  return lines.join('\n');
}
