import { RitualCard } from './SorcererKingsPanel';
import { useState } from 'react';
import type { Action } from '../../engine/game';
import type { CommandCard, GameState, PlayerId } from '../../engine/model/types';
import { cardTargets, defaultStackOrder } from '../../engine/round';
import { sectOf } from '../../engine/rules/special/grants';

/**
 * Command Stack as a row of cards on the table: tap a card to pick it up, tap another to put it
 * there (or use the arrows), then confirm. The top of the stack is on the left.
 */
export function StackBuilder({ s, p, dispatch, onPreview }: { s: GameState; p: PlayerId; dispatch: (a: Action) => boolean; onPreview?: (regimentId: string | null) => void }) {
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
    <div className="deck-panel stack card" data-testid={`deck-${p}`}>
      <div className="deck-head">
        <strong>{p} Command Stack</strong>
        <span className="meta">top card first · tap a card to see its Regiment on the table, then tap where it goes</span>
      </div>
      <div className="cards">
        {order.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`ccard ${c.kind} ${picked === i ? 'picked' : ''} owner-${p}`}
            onClick={() => {
              // Picking a card highlights its Regiment on the table, so the stack is ordered with the battlefield in view.
              const target = c.kind === 'character' ? s.characters[c.refId]?.attachedTo ?? null : c.kind === 'ritual' ? null : c.refId;
              if (picked === null) {
                setPicked(i);
                onPreview?.(target && s.regiments[target]?.location === 'table' ? target : null);
              } else if (picked === i) setPicked(null);
              else move(picked, i);
            }}
          >
            <span className="pos">{i + 1}</span>
            <span className="cname">{c.name}</span>
            {c.kind === 'character' && <span className="ckind">Character</span>}
            {c.kind === 'ritual' && <span className="ckind">Ritual</span>}
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
export function DrawDeck({ s, dispatch, onSelect, aiPlayer, onHover, dealt }: { s: GameState; dispatch: (a: Action) => boolean; onSelect: (id: string) => void; aiPlayer: PlayerId | null; onHover?: (regimentId: string | null) => void; dealt: number }) {
  // Hovering or focusing an Activate button highlights that Regiment on the table.
  const hover = (regimentId: string | null) => ({
    onMouseEnter: () => onHover?.(regimentId),
    onMouseLeave: () => onHover?.(null),
    onFocus: () => onHover?.(regimentId),
    onBlur: () => onHover?.(null),
  });
  if (s.step !== 'action') return null;
  // The card beside the deck: the one just drawn, or the one whose Activation is under way.
  const act = s.activation;
  const face: { player: PlayerId; name: string; kind: string } | null = s.drawn
    ? { player: s.drawn.player, name: s.drawn.card.name, kind: s.drawn.card.kind }
    : act
      ? act.characterId
        ? { player: s.regiments[act.regimentId]!.owner, name: s.characters[act.characterId]!.name, kind: 'character' }
        : { player: s.regiments[act.regimentId]!.owner, name: s.regiments[act.regimentId]!.name, kind: 'regiment' }
      : null;
  const deckOf: PlayerId | null = face?.player ?? s.turn;
  if (!deckOf) return null;
  const canDraw = !s.drawn && !act && s.turn === deckOf && deckOf !== aiPlayer;
  const human = s.drawn && s.drawn.player !== aiPlayer ? s.drawn : null;
  if (human?.card.kind === 'ritual') return <RitualCard s={s} dispatch={dispatch} />;
  const targets = human ? cardTargets(s, human.player, human.card) : [];
  const left = s.players[deckOf].stack.length;
  return (
    <div className="deck-panel draw">
      <div className="deck-row">
        {canDraw ? (
          <button type="button" className={`ccard back owner-${deckOf}`} onClick={() => dispatch({ type: 'drawCard', player: deckOf })} data-testid="draw-card">
            <span className="pos">{deckOf}</span>
            <span className="cname">Draw</span>
            <span className="ckind">{left} left</span>
          </button>
        ) : (
          <div className={`ccard back owner-${deckOf} ${left ? '' : 'empty'}`} aria-label={`${deckOf}'s Command Stack: ${left} left`}>
            <span className="pos">{deckOf}</span>
            <span className="ckind">{left} left</span>
          </div>
        )}
        {/* Dealt from the deck: lifted off, slid alongside and turned over (re-keyed on every draw). */}
        <div className="card-slot">
          {face && (
            <div key={dealt} className="deal">
              <div className={`ccard back owner-${face.player} deal-back`} aria-hidden="true" />
              <div className={`ccard face ${face.kind} owner-${face.player} deal-front`}>
                <span className="pos">{face.player}</span>
                <span className="cname">{face.name}</span>
                {face.kind === 'character' && <span className="ckind">Character</span>}
              </div>
            </div>
          )}
        </div>
      </div>
      {human && (
        <div className="actions wrap">
          {sectOf(s, human.player) === 'directorate' && !s.players[human.player].lobotomyUsed && s.players[human.player].stack.length > 0 && (
            <span className="actions">
              <button type="button" className="secondary small" onClick={() => dispatch({ type: 'lobotomy', player: human.player, place: 'top' })} title="Set this card aside, draw the next; this card goes on top (Strain without Decay)">
                Lobotomytic: to top
              </button>
              <button type="button" className="secondary small" onClick={() => dispatch({ type: 'lobotomy', player: human.player, place: 'bottom' })} title="Set this card aside, draw the next; this card goes to the bottom (+2 Attacks)">
                to bottom
              </button>
            </span>
          )}
          {targets.map((id) =>
            human.card.kind === 'character' ? (
              <button
                key={id}
                type="button"
                {...hover(s.characters[id]!.attachedTo)}
                onClick={() => {
                  const reg = s.characters[id]!.attachedTo;
                  onHover?.(null);
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
                {...hover(id)}
                onClick={() => {
                  onHover?.(null);
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
      )}
      {!face && (
        <span className="meta">
          {deckOf}'s turn · P1 {s.players.P1.stack.length} cards, P2 {s.players.P2.stack.length} cards
        </span>
      )}
    </div>
  );
}

/**
 * Your Command Stack during the Round, top card first (core p.21: you may look at it at any point,
 * but not reorder it). One per human player; hovering a card highlights its Regiment.
 */
export function StackPeek({ s, players, onHover }: { s: GameState; players: PlayerId[]; onHover?: (regimentId: string | null) => void }) {
  if (s.phase !== 'play' || s.step !== 'action') return null;
  return (
    <>
      {players.map((p) => {
        const stack = s.players[p].stack;
        return (
          <details key={p} className="card stack-peek" data-testid={`stack-peek-${p}`}>
            <summary>
              <span className={`side-tag ${p.toLowerCase()}`}>{p}</span> Command Stack: {stack.length} card{stack.length === 1 ? '' : 's'} left
            </summary>
            {stack.length ? (
              <ol className="stack-list">
                {stack.map((c, i) => {
                  const reg = c.kind === 'character' ? s.characters[c.refId]?.attachedTo ?? null : c.kind === 'regiment' ? c.refId : null;
                  return (
                    <li key={c.id} onMouseEnter={() => onHover?.(reg)} onMouseLeave={() => onHover?.(null)} className={i === 0 ? 'next' : ''}>
                      {c.name}
                      <span className="meta">
                        {c.kind === 'character' ? ' · Character' : c.kind === 'ritual' ? ' · Ritual' : ''}
                        {i === 0 ? ' · next' : ''}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="meta">Empty: every card has been drawn.</p>
            )}
          </details>
        );
      })}
    </>
  );
}
