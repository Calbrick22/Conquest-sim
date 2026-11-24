import { useState } from 'react';
import { attachedCharacter, type Action } from '../../engine/game';
import type { GameState, Profile, RegimentState } from '../../engine/model/types';

const STATS: (keyof Profile)[] = ['M', 'V', 'C', 'A', 'W', 'R', 'D', 'E'];

/** Manual override tools (always logged as overrides). */
export function ManualTools({ s, r, dispatch, onMoveByHand }: { s: GameState; r: RegimentState; dispatch: (a: Action) => boolean; onMoveByHand: () => void }) {
  const [stat, setStat] = useState<keyof Profile>('D');
  const [dice, setDice] = useState('');
  const c = attachedCharacter(s, r.id);
  return (
    <details className="manual-tools" data-testid="manual-tools">
      <summary>Manual tools (logged as overrides)</summary>
      <div className="actions wrap">
        <span>Wounds</span>
        <button type="button" className="secondary small" onClick={() => dispatch({ type: 'override.wounds', regimentId: r.id, delta: 1 })}>+1</button>
        <button type="button" className="secondary small" onClick={() => dispatch({ type: 'override.wounds', regimentId: r.id, delta: -1 })}>−1 (heal)</button>
        {c && (
          <>
            <span>{c.name} ({c.wounds} W)</span>
            <button type="button" className="secondary small" onClick={() => dispatch({ type: 'override.wounds', characterId: c.id, delta: 1 })}>+1</button>
            <button type="button" className="secondary small" onClick={() => dispatch({ type: 'override.wounds', characterId: c.id, delta: -1 })}>−1</button>
          </>
        )}
      </div>
      <div className="actions wrap">
        <span>Until end of Round</span>
        <select value={stat} onChange={(e) => setStat(e.target.value as keyof Profile)} aria-label="Characteristic">
          {STATS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <button type="button" className="secondary small" onClick={() => dispatch({ type: 'override.stat', regimentId: r.id, stat, delta: 1 })}>+1</button>
        <button type="button" className="secondary small" onClick={() => dispatch({ type: 'override.stat', regimentId: r.id, stat, delta: -1 })}>−1</button>
        {r.roundMods.length > 0 && <span className="meta">{r.roundMods.map((m) => `${m.stat}${m.delta > 0 ? '+' : ''}${m.delta}`).join(', ')}</span>}
      </div>
      <div className="actions wrap">
        <button type="button" className="secondary small" onClick={() => dispatch({ type: 'override.broken', regimentId: r.id, broken: !r.broken })}>
          Mark {r.broken ? 'not Broken' : 'Broken'}
        </button>
        {(r.location === 'reserve' || r.location === 'arriving') && (
          <button type="button" className="secondary small" onClick={() => dispatch({ type: 'setArriving', regimentId: r.id, arriving: r.location === 'reserve' })}>
            {r.location === 'reserve' ? 'Set arriving' : 'Back to Reinforcements'}
          </button>
        )}
        {r.location === 'table' && (
          <button type="button" className="secondary small" onClick={onMoveByHand}>Move by hand</button>
        )}
      </div>
      <form
        className="actions wrap"
        onSubmit={(e) => {
          e.preventDefault();
          const values = dice.split(/[\s,]+/).filter(Boolean).map(Number);
          if (values.length && dispatch({ type: 'override.forceDice', values })) setDice('');
        }}
      >
        <span>Set next dice</span>
        <input className="grow" inputMode="numeric" placeholder="e.g. 6 6 1" value={dice} onChange={(e) => setDice(e.target.value)} aria-label="Next dice" />
        <button type="submit" className="secondary small">Set</button>
        {s.forcedDice.length > 0 && <span className="meta">queued: {s.forcedDice.join(', ')}</span>}
      </form>
      <p className="meta">To re-roll: Undo the action, set the dice you want, and repeat it.</p>
    </details>
  );
}
