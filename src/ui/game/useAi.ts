import { useEffect, useRef, useState } from 'react';
import type { AiDecision } from '../../ai/ai';
import { decisionMaker } from '../../ai/ai';
import type { Action } from '../../engine/game';
import type { GameState, PlayerId } from '../../engine/model/types';

/**
 * Drives the computer opponent: whenever it is the AI player's decision, ask the worker for an
 * Action and dispatch it (through the same validate/apply path as a human).
 */
export function useAi(state: GameState, aiPlayer: PlayerId | null, paused: boolean, dispatch: (a: Action) => boolean, blocked: boolean) {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [thinking, setThinking] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (!aiPlayer) return;
    const w = new Worker(new URL('../../ai/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [aiPlayer]);

  useEffect(() => {
    const w = worker.current;
    if (!w || !aiPlayer || paused || blocked || state.phase !== 'play') return;
    if (decisionMaker(state) !== aiPlayer) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      setThinking(true);
      w.onmessage = (e: MessageEvent<{ id: number; decision?: AiDecision; error?: string }>) => {
        if (e.data.id !== seq.current) return;
        setThinking(false);
        if (e.data.error || !e.data.decision) {
          setAiError(e.data.error ?? 'no decision');
          return;
        }
        if (!dispatch(e.data.decision.action)) setAiError(`The computer chose an illegal action (${e.data.decision.action.type}); it is paused. Play on by hand or use the manual tools.`);
      };
      w.postMessage({ id, state, player: aiPlayer });
    }, 350);
    return () => clearTimeout(timer);
  }, [state, aiPlayer, paused, blocked, dispatch]);

  return { thinking, aiError, clearAiError: () => setAiError(null) };
}
