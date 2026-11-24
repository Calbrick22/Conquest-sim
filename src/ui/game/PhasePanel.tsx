import { useState } from 'react';
import type { Action } from '../../engine/game';
import type { CommandCard, GameState, PlayerId } from '../../engine/model/types';
import { cardTargets, defaultStackOrder, reinforcementChoices, reinforcementNeed, reserveRegiments } from '../../engine/round';

const PLAYERS: PlayerId[] = ['P1', 'P2'];

/** Round sequence controls: Reinforcements, Command Stacks, Supremacy, card draws, Victory Phase. */
export function PhasePanel({ s, dispatch, onSelect }: { s: GameState; dispatch: (a: Action) => boolean; onSelect: (id: string) => void }) {
  if (s.phase !== 'play') return null;
  return (
    <div className="card phase-panel" data-testid="phase-panel">
      {s.step === 'reinforcement' && <Reinforcements s={s} dispatch={dispatch} />}
      {s.step === 'command' && <Stacks s={s} dispatch={dispatch} />}
      {s.step === 'supremacy' && <Supremacy s={s} dispatch={dispatch} />}
      {s.step === 'action' && <Draw s={s} dispatch={dispatch} onSelect={onSelect} />}
      {s.step === 'victory' && (
        <>
          <h3>Victory Phase</h3>
          <p className="meta">Every Command Card has been played. Round scoring arrives in M5.</p>
          <button type="button" onClick={() => dispatch({ type: 'endRound' })} data-testid="end-round">
            End Round {s.round}
          </button>
        </>
      )}
    </div>
  );
}

function Reinforcements({ s, dispatch }: { s: GameState; dispatch: (a: Action) => boolean }) {
  const [choice, setChoice] = useState<Record<PlayerId, string>>({ P1: '', P2: '' });
  return (
    <>
      <h3>Round {s.round}: Reinforcement Phase</h3>
      <p className="meta">Pick up to one Regiment to arrive automatically, or to stay back, then roll for the rest (core p.21).</p>
      {PLAYERS.map((p) => {
        const done = s.players[p].reinforcementDone;
        const choices = reinforcementChoices(s, p);
        const reserve = reserveRegiments(s, p);
        return (
          <div key={p} className="phase-row">
            <strong>{p}</strong>{' '}
            {done ? (
              <span className="meta">done</span>
            ) : reserve.length === 0 ? (
              <button type="button" className="small" onClick={() => dispatch({ type: 'reinforcements', player: p, choice: null })} data-testid={`reinforce-${p}`}>
                Nothing in Reinforcements: continue
              </button>
            ) : (
              <>
                <select value={choice[p]} onChange={(e) => setChoice({ ...choice, [p]: e.target.value })} data-testid={`reinforce-choice-${p}`}>
                  <option value="">No choice: roll for all</option>
                  {choices.map((r) => {
                    const need = reinforcementNeed(s.round, r.cls);
                    return [
                      <option key={`${r.id}:a`} value={`${r.id}:arrive`}>{r.name} ({r.cls}) arrives</option>,
                      need !== 'auto' ? <option key={`${r.id}:s`} value={`${r.id}:stay`}>{r.name} ({r.cls}) stays</option> : null,
                    ];
                  })}
                </select>{' '}
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    const [id, what] = choice[p].split(':');
                    dispatch({ type: 'reinforcements', player: p, choice: id ? { regimentId: id, arrive: what === 'arrive' } : null });
                  }}
                  data-testid={`reinforce-${p}`}
                >
                  Roll Reinforcements
                </button>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function Stacks({ s, dispatch }: { s: GameState; dispatch: (a: Action) => boolean }) {
  return (
    <>
      <h3>Command Phase</h3>
      <p className="meta">Order each Command Stack, top card first (core p.21). Characters sit just above their Regiment by default, so an Entourage Activation is possible.</p>
      {PLAYERS.map((p) => (s.players[p].stackSet ? <p key={p}><strong>{p}</strong> <span className="meta">stack set ({s.players[p].stack.length} cards, hidden)</span></p> : <StackEditor key={p} s={s} p={p} dispatch={dispatch} />))}
    </>
  );
}

function StackEditor({ s, p, dispatch }: { s: GameState; p: PlayerId; dispatch: (a: Action) => boolean }) {
  const [order, setOrder] = useState<CommandCard[]>(() => defaultStackOrder(s, p));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const o = [...order];
    [o[i], o[j]] = [o[j]!, o[i]!];
    setOrder(o);
  };
  return (
    <div className="stack-editor">
      <strong>{p}</strong>
      <ol>
        {order.map((c, i) => (
          <li key={c.id}>
            {c.name}
            {c.kind === 'character' ? ' (Character)' : ''}{' '}
            <button type="button" className="secondary small" onClick={() => move(i, -1)} aria-label="Up">↑</button>
            <button type="button" className="secondary small" onClick={() => move(i, 1)} aria-label="Down">↓</button>
          </li>
        ))}
      </ol>
      {order.length === 0 && <p className="meta">No cards this Round.</p>}
      <button type="button" className="small" onClick={() => dispatch({ type: 'setStack', player: p, order: order.map((c) => c.id) })} data-testid={`stack-${p}`}>
        Confirm {p} stack
      </button>
    </div>
  );
}

function Supremacy({ s, dispatch }: { s: GameState; dispatch: (a: Action) => boolean }) {
  return (
    <>
      <h3>Supremacy Phase</h3>
      {!s.supremacyWinner ? (
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

function Draw({ s, dispatch, onSelect }: { s: GameState; dispatch: (a: Action) => boolean; onSelect: (id: string) => void }) {
  if (s.activation) return <p className="meta">Activation in progress. Cards left: P1 {s.players.P1.stack.length}, P2 {s.players.P2.stack.length}.</p>;
  if (s.drawn) {
    const { player, card } = s.drawn;
    const targets = cardTargets(s, player, card);
    return (
      <>
        <h3>
          {player} drew {card.name}
          {card.kind === 'character' ? ' (Character)' : ''}
        </h3>
        <div className="actions wrap">
          {targets.map((id) =>
            card.kind === 'character' ? (
              <button key={id} type="button" onClick={() => dispatch({ type: 'activateCharacter', characterId: id })} data-testid="activate-drawn">
                Activate {s.characters[id]!.name}
              </button>
            ) : (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onSelect(id);
                  dispatch({ type: 'activate', regimentId: id });
                }}
                data-testid="activate-drawn"
              >
                Activate {s.regiments[id]!.name}
                {targets.length > 1 ? ` (${s.regiments[id]!.location})` : ''}
              </button>
            ),
          )}
        </div>
      </>
    );
  }
  return (
    <>
      <h3>Action Phase</h3>
      <p className="meta">
        First Player {s.firstPlayer}. Cards left: P1 {s.players.P1.stack.length}, P2 {s.players.P2.stack.length}.
      </p>
      {s.turn && (
        <button type="button" onClick={() => dispatch({ type: 'drawCard', player: s.turn! })} data-testid="draw-card">
          {s.turn}: draw a Command Card
        </button>
      )}
    </>
  );
}
