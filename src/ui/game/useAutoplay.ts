import { useEffect, useRef, useState } from 'react';
import type { Action } from '../../engine/game';
import type { Difficulty } from '../../ai/difficulty';
import type { GameState } from '../../engine/model/types';
import { decisionMaker, type AiDecision } from '../../ai/ai';

/**
 * Plays the rest of the game automatically for both sides (used once one side has nothing left):
 * the computer's own decisions, so the surviving army marches on the objectives to score what it
 * can. Runs in a worker; every Action still goes through the normal validate/apply path.
 */
export function useAutoplay(state: GameState, dispatch: (a: Action) => boolean, difficulty: Difficulty = 'beginner'): { running: boolean; start: () => void; stop: () => void; error: string | null } {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);

  // The simulation stops by itself when the battle ends (running is derived, not stored).
  const active = running && state.phase === 'play';
  useEffect(() => {
    if (!active) return;
    worker.current ??= new Worker(new URL('../../ai/worker.ts', import.meta.url), { type: 'module' });
    const w = worker.current;
    const who = decisionMaker(state);
    const player = who === 'any' || who === null ? (state.firstPlayer ?? 'P1') : who;
    const id = ++seq.current;
    w.onmessage = (e: MessageEvent<{ id: number; decision?: AiDecision; error?: string }>) => {
      if (e.data.id !== seq.current) return;
      if (e.data.error || !e.data.decision) {
        setError(e.data.error ?? 'no decision');
        setRunning(false);
        return;
      }
      if (!dispatch({ ...e.data.decision.action, why: e.data.decision.action.why ?? `Simulated: ${e.data.decision.reason}` })) {
        setError(`The simulation chose an illegal action (${e.data.decision.action.type}); it has stopped.`);
        setRunning(false);
      }
    };
    w.postMessage({ id, state, player, difficulty });
  }, [state, active, dispatch, difficulty]);

  useEffect(() => () => worker.current?.terminate(), []);
  return { running: active, start: () => { setError(null); setRunning(true); }, stop: () => setRunning(false), error };
}

/** True when a player has no Regiment left that is not destroyed (on the table or in Reinforcements). */
export function wipedOut(s: GameState, p: 'P1' | 'P2'): boolean {
  const mine = Object.values(s.regiments).filter((r) => r.owner === p);
  return mine.length > 0 && mine.every((r) => r.location === 'destroyed');
}
