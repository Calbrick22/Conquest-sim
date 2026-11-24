import { useEffect, useState } from 'react';
import type { GameEvent } from '../../engine/game';

/** Event types worth a notification. */
const NOTABLE: Record<string, string> = {
  score: '★',
  destroyed: '☠',
  broken: '⚑',
  shattered: '✖',
  power: '◆',
  supremacy: '♛',
};

/**
 * Notifications from the last Action's events (score, Regiments destroyed, Broken, Shattered,
 * Power, Supremacy). They fade after a few seconds; with reduce motion they simply disappear.
 */
export function Toasts({ events, stamp }: { events: GameEvent[]; stamp: number }) {
  const [shown, setShown] = useState<{ stamp: number; items: GameEvent[] }>({ stamp: -1, items: [] });
  const items = events.filter((e) => NOTABLE[e.type] && !(e.type === 'score' && /scores 0 VP/.test(e.text))).slice(-3);
  const current = shown.stamp === stamp ? shown.items : items;
  useEffect(() => {
    if (!items.length) return;
    const t = setTimeout(() => setShown({ stamp, items: [] }), 5000);
    return () => clearTimeout(t);
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!current.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite" data-testid="toasts">
      {current.map((e, i) => (
        <div key={`${stamp}-${i}`} className={`toast ${e.type} ${e.player ? e.player.toLowerCase() : ''}`}>
          <span className="toast-icon" aria-hidden="true">
            {NOTABLE[e.type]}
          </span>
          <span>{e.text}</span>
        </div>
      ))}
    </div>
  );
}
