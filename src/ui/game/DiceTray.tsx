import type { GameEvent } from '../../engine/game';

/** The most recent dice: each roll with its values, re-rolls and modifiers (seeded and replayable). */
export function DiceTray({ events }: { events: GameEvent[] }) {
  const dice = events.filter((e) => e.dice).slice(-10).reverse();
  if (!dice.length) return null;
  return (
    <details className="card dice-tray" open data-testid="dice-tray">
      <summary>Dice tray</summary>
      <ul className="plain">
        {dice.map((e, i) => (
          <li key={i} className="dice-row">
            <div className="meta">
              R{e.round} · {e.dice!.purpose} · seed {e.dice!.seed} #{e.dice!.index}
            </div>
            <div className="dice small-dice">
              {e.dice!.values.length === 0 ? <span className="meta">no dice (automatic)</span> : e.dice!.values.map((v, k) => <span key={k} className={`die ${v === 1 ? 'one' : v === 6 ? 'six' : ''}`}>{v}</span>)}
            </div>
            <div>{e.text}</div>
            {e.dice!.notes?.length ? <div className="meta">{e.dice!.notes.join(' · ')}</div> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
