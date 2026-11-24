import { useState } from 'react';
import type { Action } from '../../engine/game';
import type { GameState, PlayerId } from '../../engine/model/types';
import { flankChoices, reinforcementChoices, reinforcementNeed, reserveRegiments } from '../../engine/round';
import { zoneResults } from '../../engine/scoring/victory';
import { decisionMaker } from '../../ai/ai';

const PLAYERS: PlayerId[] = ['P1', 'P2'];

/** Round sequence controls: Reinforcements, Command Stacks, Supremacy, card draws, Victory Phase. */
export function PhasePanel({ s, dispatch, aiPlayer }: { s: GameState; dispatch: (a: Action) => boolean; aiPlayer?: PlayerId | null }) {
  if (s.phase !== 'play') return null;
  const who = decisionMaker(s);
  if (aiPlayer && who === aiPlayer) return <div className="card phase-panel meta" data-testid="phase-panel">Waiting for the computer ({aiPlayer})…</div>;
  return (
    <div className="card phase-panel" data-testid="phase-panel">
      {s.step === 'reinforcement' && <Reinforcements s={s} dispatch={dispatch} ai={aiPlayer ?? null} />}
      {s.step === 'command' && <Stacks s={s} ai={aiPlayer ?? null} />}
      {s.step === 'supremacy' && <Supremacy s={s} dispatch={dispatch} />}
      {s.step === 'action' && <Draw s={s} />}
      {s.step === 'victory' && (
        <>
          <h3>Victory Phase</h3>
          <p className="meta">Every Command Card has been played. Ending the Round scores it (core p.106).</p>
          <ZoneStatus s={s} />
          <button type="button" onClick={() => dispatch({ type: 'endRound' })} data-testid="end-round">
            End Round {s.round}
          </button>
        </>
      )}
    </div>
  );
}

function Reinforcements({ s, dispatch, ai }: { s: GameState; dispatch: (a: Action) => boolean; ai: PlayerId | null }) {
  const [auto, setAuto] = useState<Record<PlayerId, string | null>>({ P1: null, P2: null });
  const [flankStay, setFlankStay] = useState<Record<string, boolean>>({});
  const needText = (cls: 'Light' | 'Medium' | 'Heavy') => {
    const n = reinforcementNeed(s.round, cls);
    return n === null ? 'not yet' : n === 'auto' ? 'arrives' : `rolls ${n} or less`;
  };
  return (
    <>
      <h3>Round {s.round}: Reinforcements</h3>
      <p className="meta">
        Light {needText('Light')} · Medium {needText('Medium')} · Heavy {needText('Heavy')} (core p.21). Tap one Regiment to bring it on automatically; the rest roll.
      </p>
      {PLAYERS.map((p) => {
        if (s.players[p].reinforcementDone) return <p key={p}><strong>{p}</strong> <span className="meta">done</span></p>;
        if (p === ai) return <p key={p}><strong>{p}</strong> <span className="meta">the computer will choose</span></p>;
        const reserve = reserveRegiments(s, p);
        const eligible = new Set(reinforcementChoices(s, p).map((r) => r.id));
        const flank = new Set(flankChoices(s, p).map((r) => r.id));
        return (
          <div key={p} className="reinf">
            <strong>{p}</strong>
            <ul className="plain">
              {reserve.map((r) => {
                const need = reinforcementNeed(s.round, r.cls);
                const isAuto = auto[p] === r.id;
                const isFlank = flank.has(r.id);
                const canPick = eligible.has(r.id) && need !== 'auto' && !r.flags.autoArrive && !isFlank;
                const status = r.flags.autoArrive
                  ? 'arrives (failed to enter last Round)'
                  : isFlank
                    ? need === 'auto' ? 'Flank: arrives' : flankStay[r.id] ? 'Flank: stays back' : 'Flank: arrives (no roll)'
                    : need === null
                      ? 'not this Round'
                      : need === 'auto'
                        ? 'arrives automatically'
                        : isAuto
                          ? 'brought on automatically ★'
                          : `rolls ${need} or less`;
                return (
                  <li key={r.id} className={`reinf-row ${isAuto ? 'chosen' : ''}`}>
                    <span>
                      {r.name} <span className="meta">{r.cls}</span>
                    </span>
                    <span className="meta">{status}</span>
                    {canPick && (
                      <button type="button" className={`small ${isAuto ? '' : 'secondary'}`} onClick={() => setAuto({ ...auto, [p]: isAuto ? null : r.id })} data-testid={`auto-${r.id}`}>
                        {isAuto ? '★ Auto' : 'Bring on'}
                      </button>
                    )}
                    {isFlank && need !== 'auto' && (
                      <button type="button" className="secondary small" onClick={() => setFlankStay({ ...flankStay, [r.id]: !flankStay[r.id] })} data-testid={`flank-${r.id}`}>
                        {flankStay[r.id] ? 'Arrive' : 'Stay back'}
                      </button>
                    )}
                  </li>
                );
              })}
              {reserve.length === 0 && <li className="meta">Nothing in Reinforcements.</li>}
            </ul>
            <button
              type="button"
              className="small"
              onClick={() =>
                dispatch({
                  type: 'reinforcements',
                  player: p,
                  choice: auto[p] ? { regimentId: auto[p]!, arrive: true } : null,
                  flank: Object.fromEntries([...flank].map((id) => [id, !flankStay[id]])),
                })
              }
              data-testid={`reinforce-${p}`}
            >
              {reserve.length ? 'Roll Reinforcements' : 'Continue'}
            </button>
          </div>
        );
      })}
    </>
  );
}

function Stacks({ s, ai }: { s: GameState; ai: PlayerId | null }) {
  return (
    <>
      <h3>Command Phase</h3>
      <p className="meta">Arrange your Command Cards on the table (top card first), then press Ready (core p.21).</p>
      {PLAYERS.map((p) => (
        <p key={p}>
          <strong>{p}</strong>{' '}
          <span className="meta">{s.players[p].stackSet ? `ready (${s.players[p].stack.length} cards, hidden)` : p === ai ? 'the computer is ordering its stack' : 'arranging…'}</span>
        </p>
      ))}
    </>
  );
}

function Supremacy({ s, dispatch }: { s: GameState; dispatch: (a: Action) => boolean }) {
  return (
    <>
      <h3>Supremacy Phase</h3>
      {s.firstPlayer && s.scenario.zonePick ? (
        <ZonePicks s={s} dispatch={dispatch} />
      ) : !s.supremacyWinner ? (
        <button type="button" onClick={() => dispatch({ type: 'supremacyRollOff' })} data-testid="supremacy-roll">
          Roll off for Supremacy
        </button>
      ) : (
        <>
          <p>
            <strong>{s.supremacyWinner}</strong> won the roll-off and chooses the First Player.
          </p>
          <div className="actions">
            {PLAYERS.map((p) => (
              <button key={p} type="button" className={p === s.supremacyWinner ? '' : 'secondary'} onClick={() => dispatch({ type: 'chooseFirst', first: p })} data-testid={`first-${p}`}>
                {p} goes first
              </button>
            ))}
          </div>
        </>
      )}
      <div className="actions wrap">
        {PLAYERS.map((p) => {
          const w = Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p));
          if (!w || s.players[p].supremacyUsed) return null;
          return (
            <button key={p} type="button" className="secondary small" onClick={() => dispatch({ type: 'useSupremacy', player: p })}>
              {p}: activate {w.supremacyAbilities.join(', ') || 'Supremacy'} (manual)
            </button>
          );
        })}
      </div>
    </>
  );
}

function Draw({ s }: { s: GameState }) {
  if (s.activation) return <p className="meta">Activation in progress. Cards left: P1 {s.players.P1.stack.length}, P2 {s.players.P2.stack.length}.</p>;
  return (
    <>
      <h3>Action Phase</h3>
      <p className="meta">
        First Player {s.firstPlayer}. {s.drawn ? `${s.drawn.player} drew ${s.drawn.card.name}.` : s.turn ? `${s.turn} draws next: tap the deck on the table.` : ''} Cards left: P1 {s.players.P1.stack.length}, P2 {s.players.P2.stack.length}.
      </p>
    </>
  );
}

function ZonePicks({ s, dispatch }: { s: GameState; dispatch: (a: Action) => boolean }) {
  const zp = s.scenario.zonePick!;
  const first = s.firstPlayer!;
  const second: PlayerId = first === 'P1' ? 'P2' : 'P1';
  const next = s.zonePicks[first] === null ? first : second;
  const zones = s.scenario.zones.filter((z) => !zp.eligibleZoneIds || zp.eligibleZoneIds.includes(z.id));
  const what = zp.mode === 'bonusPick' ? 'a 6″ zone with none of your Regiments in range: +3 VP if you Seize it' : zp.mode === 'vetoSecret' ? 'a zone in secret: no VP for it this Round' : 'a zone: no VP for it this Round';
  return (
    <>
      <p>
        <strong>{next}</strong> picks {what} (pack p.{s.scenario.page}).
      </p>
      <div className="actions wrap">
        {zones.map((z) => (
          <button key={z.id} type="button" className="secondary small" onClick={() => dispatch({ type: 'pickZone', player: next, zoneId: z.id })} data-testid={`pick-${z.id}`}>
            {z.label ?? z.id} ({z.x}, {z.y})
          </button>
        ))}
      </div>
    </>
  );
}

function ZoneStatus({ s }: { s: GameState }) {
  if (s.round < s.scenario.objectivesFromRound) return <p className="meta">Zones cannot be Seized this Round.</p>;
  const zr = zoneResults(s);
  return (
    <ul className="plain">
      {s.scenario.zones.map((z) => {
        const r = zr[z.id]!;
        return (
          <li key={z.id}>
            Zone {z.label ?? z.id} {z.diameter}″: <strong>{r.seizedBy ?? 'nobody'}</strong>{' '}
            <span className="meta">
              (Stands P1 {r.totals.P1}/{r.seizing.P1} seizing, P2 {r.totals.P2}/{r.seizing.P2}){r.contestedBy.length ? `, contested by ${r.contestedBy.join(', ')}'s Marker` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
