import type { GameState, PlayerId } from '../../engine/model/types';
import { scoreGroups } from '../../engine/scoring/victory';

/**
 * The end-of-battle screen: result, final score and a Round-by-Round breakdown, with
 * "Save and return home". The game is saved on the device after every Action already, so
 * returning home keeps it in the saved games list.
 */
export function EndGameSummary({ s, you, mode, onHome, onExport, onClose }: { s: GameState; you: PlayerId; mode: 'hotseat' | 'ai'; onHome: () => void; onExport: () => void; onClose: () => void }) {
  const p1 = s.players.P1.vp;
  const p2 = s.players.P2.vp;
  const winner: PlayerId | null = p1 === p2 ? null : p1 > p2 ? 'P1' : 'P2';
  const title = !winner ? 'Draw' : mode === 'ai' ? (winner === you ? 'Victory' : 'Defeat') : `${winner} is victorious`;
  const tone = !winner ? 'draw' : mode === 'ai' && winner !== you ? 'defeat' : 'victory';
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="end-title" data-testid="end-summary">
      <div className={`modal end-summary ${tone}`}>
        <div className="end-banner">
          <span className="eyebrow">{s.scenario.name} · Battle over</span>
          <h2 id="end-title">{title}</h2>
          <div className="end-score">
            <span className="side p1">
              <span className="who">P1 {s.players.P1.listName}</span>
              <span className="vp">{p1}</span>
            </span>
            <span className="vs">VP</span>
            <span className="side p2">
              <span className="vp">{p2}</span>
              <span className="who">P2 {s.players.P2.listName}</span>
            </span>
          </div>
        </div>
        <div className="scroll-x">
          <table className="scoreboard end-table">
            <thead>
              <tr>
                <th>Round</th>
                <th>P1</th>
                <th>P2</th>
                <th>Zones seized</th>
                <th>Running total</th>
              </tr>
            </thead>
            <tbody>
              {s.scoreHistory.map((r, i) => {
                const run = s.scoreHistory.slice(0, i + 1).reduce((a, x) => ({ P1: a.P1 + x.vp.P1, P2: a.P2 + x.vp.P2 }), { P1: 0, P2: 0 });
                const g1 = scoreGroups(r, 'P1');
                const g2 = scoreGroups(r, 'P2');
                return (
                  <tr key={r.round}>
                    <th>{r.round}</th>
                    <td title={r.lines.P1.map((l) => `${l.detail}: ${l.vp}`).join('\n')}>
                      {r.vp.P1}
                      {r.vp.P1 > 0 && <span className="meta"> ({g1.zones}z/{g1.kills}k)</span>}
                    </td>
                    <td title={r.lines.P2.map((l) => `${l.detail}: ${l.vp}`).join('\n')}>
                      {r.vp.P2}
                      {r.vp.P2 > 0 && <span className="meta"> ({g2.zones}z/{g2.kills}k)</span>}
                    </td>
                    <td className="meta">
                      {r.seized.P1.length ? `P1 ${r.seized.P1.join(', ')}` : ''}
                      {r.seized.P1.length && r.seized.P2.length ? ' · ' : ''}
                      {r.seized.P2.length ? `P2 ${r.seized.P2.join(', ')}` : ''}
                      {!r.seized.P1.length && !r.seized.P2.length ? '—' : ''}
                    </td>
                    <td>
                      {run.P1} – {run.P2}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="meta">z = zones, k = kills and Markers. Hover or long-press a score for its breakdown.</p>
        <div className="actions wrap end-actions">
          <button type="button" onClick={onHome} data-testid="save-home">
            Save and return home
          </button>
          <button type="button" className="secondary" onClick={onExport}>
            Export battle report
          </button>
          <button type="button" className="secondary" onClick={onClose} data-testid="view-battlefield">
            View the battlefield
          </button>
        </div>
      </div>
    </div>
  );
}
