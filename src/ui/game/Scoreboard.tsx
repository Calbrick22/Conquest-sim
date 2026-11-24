import type { GameState } from '../../engine/model/types';
import { scoreGroups } from '../../engine/scoring/victory';

/** Per-Round Victory Points, split into zones and kills/Markers like the game log. */
export function Scoreboard({ s }: { s: GameState }) {
  if (!s.scoreHistory.length) return null;
  return (
    <details className="card" open data-testid="scoreboard">
      <summary>Score by Round</summary>
      <div className="scroll-x">
        <table className="scoreboard">
          <thead>
            <tr>
              <th>Round</th>
              {s.scoreHistory.map((r) => <th key={r.round}>{r.round}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {(['P1', 'P2'] as const).map((p) => (
              <tr key={p}>
                <th>{p}</th>
                {s.scoreHistory.map((r) => {
                  const g = scoreGroups(r, p);
                  return (
                    <td key={r.round} title={r.lines[p].map((l) => `${l.detail}: ${l.vp}`).join('\n')}>
                      {r.vp[p]}
                      {r.vp[p] > 0 && <span className="meta"> ({g.zones}z/{g.kills}k)</span>}
                    </td>
                  );
                })}
                <td><strong>{s.players[p].vp}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta">z = zones, k = kills and Markers. Tap a cell's title for the breakdown.</p>
    </details>
  );
}
