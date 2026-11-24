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
}

export function replay(initial: GameState, initialRng: RngState, initialEvents: GameEvent[], actions: Action[]): GameSession {
  let state = initial;
  let rng = initialRng;
  const events = [...initialEvents];
  for (const a of actions) {
    const r = apply(state, a, rng);
    state = r.state;
    rng = r.rng;
    events.push(...r.events);
  }
  return { initial, initialRng, initialEvents, state, rng, actions, events };
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
    const next: GameSession = { ...cur, state: r.state, rng: r.rng, actions: [...cur.actions, a], events: [...cur.events, ...r.events] };
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

  return { session, dispatch, undo, error, setError };
}
