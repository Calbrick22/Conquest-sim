import { useState } from 'react';
import type { Action } from '../../engine/game';
import type { CommandCard, GameState, PlayerId } from '../../engine/model/types';
import { cardTargets, defaultStackOrder } from '../../engine/round';
import { sectOf } from '../../engine/rules/special/grants';

/**
 * Command Stack as a row of cards on the table: tap a card to pick it up, tap another to put it
 * there (or use the arrows), then confirm. The top of the stack is on the left.
 */
export function StackBuilder({ s, p, dispatch }: { s: GameState; p: PlayerId; dispatch: (a: Action) => boolean }) {
  const [order, setOrder] = useState<CommandCard[]>(() => defaultStackOrder(s, p));
  const [picked, setPicked] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const o = [...order];
    const [c] = o.splice(from, 1);
    o.splice(to, 0, c!);
    setOrder(o);
    setPicked(to);
  };
  return (
    <div className="deck-panel" data-testid={`deck-${p}`}>
      <div className="deck-head">
        <strong>{p} Command Stack</strong>
        <span className="meta">top card first · tap a card, then tap where it goes</span>
      </div>
      <div className="cards">
        {order.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`ccard ${c.kind} ${picked === i ? 'picked' : ''} owner-${p}`}
            onClick={() => (picked === null ? setPicked(i) : picked === i ? setPicked(null) : move(picked, i))}
          >
            <span className="pos">{i + 1}</span>
            <span className="cname">{c.name}</span>
            {c.kind === 'character' && <span className="ckind">Character</span>}
          </button>
        ))}
        {order.length === 0 && <span className="meta">No cards this Round.</span>}
      </div>
      <div className="actions">
        {picked !== null && (
          <>
            <button type="button" className="secondary small" onClick={() => move(picked, picked - 1)}>◀ earlier</button>
            <button type="button" className="secondary small" onClick={() => move(picked, picked + 1)}>later ▶</button>
          </>
        )}
        <button type="button" className="small" onClick={() => dispatch({ type: 'setStack', player: p, order: order.map((c) => c.id) })} data-testid={`stack-${p}`}>
          Ready
        </button>
      </div>
    </div>
  );
}

/** The deck during the Action Phase: draw, then activate with the drawn card. */
export function DrawDeck({ s, dispatch, onSelect, aiPlayer }: { s: GameState; dispatch: (a: Action) => boolean; onSelect: (id: string) => void; aiPlayer: PlayerId | null }) {
  if (s.step !== 'action' || s.activation) return null;
  if (s.drawn) {
    const { player, card } = s.drawn;
    if (player === aiPlayer) return null;
    const targets = cardTargets(s, player, card);
    return (
      <div className="deck-panel draw">
        <div className={`ccard face ${card.kind} owner-${player}`}>
          <span className="pos">{player}</span>
          <span className="cname">{card.name}</span>
          {card.kind === 'character' && <span className="ckind">Character</span>}
        </div>
        <div className="actions wrap">
          {sectOf(s, player) === 'directorate' && !s.players[player].lobotomyUsed && s.players[player].stack.length > 0 && (
            <span className="actions">
              <button type="button" className="secondary small" onClick={() => dispatch({ type: 'lobotomy', player, place: 'top' })} title="Set this card aside, draw the next; this card goes on top (Strain without Decay)">
                Lobotomytic: to top
              </button>
              <button type="button" className="secondary small" onClick={() => dispatch({ type: 'lobotomy', player, place: 'bottom' })} title="Set this card aside, draw the next; this card goes to the bottom (+2 Attacks)">
                to bottom
              </button>
            </span>
          )}
          {targets.map((id) =>
            card.kind === 'character' ? (
              <button
                key={id}
                type="button"
                onClick={() => {
                  const reg = s.characters[id]!.attachedTo;
                  if (reg) onSelect(reg);
                  dispatch({ type: 'activateCharacter', characterId: id });
                }}
                data-testid="activate-drawn"
              >
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
      </div>
    );
  }
  const p = s.turn;
  if (!p || p === aiPlayer) return null;
  return (
    <div className="deck-panel draw">
      <button type="button" className={`ccard back owner-${p}`} onClick={() => dispatch({ type: 'drawCard', player: p })} data-testid="draw-card">
        <span className="pos">{p}</span>
        <span className="cname">Draw</span>
        <span className="ckind">{s.players[p].stack.length} left</span>
      </button>
      <span className="meta">
        {p}'s turn · P1 {s.players.P1.stack.length} cards, P2 {s.players.P2.stack.length} cards
      </span>
    </div>
  );
}
