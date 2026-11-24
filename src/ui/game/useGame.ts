import { useCallback, useRef, useState } from 'react';
import { apply, validate, type Action, type GameEvent } from '../../engine/game';
import type { GameState } from '../../engine/model/types';
import type { RngState } from '../../engine/rng';

/** A game in progress: current state, RNG, the full action history and the event log. */
export interface GameSession {
  initial: GameState;
  initialRng: RngState;
  initialEvents: GameEvent[];
  state: GameState;
  rng: RngState;
  actions: Action[];
  events: GameEvent[];
  /** The last Action applied and the events it produced (for the on-table callout). */
  last: { action: Action; events: GameEvent[]; prev: GameState } | null;
}

export function replay(initial: GameState, initialRng: RngState, initialEvents: GameEvent[], actions: Action[]): GameSession {
  let state = initial;
  let rng = initialRng;
  const events = [...initialEvents];
  let last: GameSession['last'] = null;
  for (const a of actions) {
    const prev = state;
    const r = apply(state, a, rng);
    state = r.state;
    rng = r.rng;
    events.push(...r.events);
    last = { action: a, events: r.events, prev };
  }
  return { initial, initialRng, initialEvents, state, rng, actions, events, last };
}

export function useGame(start: GameSession) {
  const [session, setSession] = useState<GameSession>(start);
  const ref = useRef(start);
  const [error, setError] = useState<string[] | null>(null);

  const dispatch = useCallback((a: Action): boolean => {
    const cur = ref.current;
    const v = validate(cur.state, a);
    if (!v.ok) {
      setError(v.reasons);
      return false;
    }
    const r = apply(cur.state, a, cur.rng);
    const next: GameSession = { ...cur, state: r.state, rng: r.rng, actions: [...cur.actions, a], events: [...cur.events, ...r.events], last: { action: a, events: r.events, prev: cur.state } };
    ref.current = next;
    setSession(next);
    setError(null);
    return true;
  }, []);

  /** Undo by replaying every action but the last from the initial state (deterministic). */
  const undo = useCallback(() => {
    const cur = ref.current;
    if (cur.actions.length === 0) return;
    const next = replay(cur.initial, cur.initialRng, cur.initialEvents, cur.actions.slice(0, -1));
    ref.current = next;
    setSession(next);
    setError(null);
  }, []);

  /** Undo back to before the last action taken by a human (skipping the computer's actions). */
  const undoHuman = useCallback(() => {
    const cur = ref.current;
    let n = cur.actions.length;
    while (n > 0 && cur.actions[n - 1]!.why) n--;
    if (n > 0) n--;
    if (n === cur.actions.length) return;
    const next = replay(cur.initial, cur.initialRng, cur.initialEvents, cur.actions.slice(0, n));
    ref.current = next;
    setSession(next);
    setError(null);
  }, []);

  return { session, dispatch, undo, undoHuman, error, setError };
}
