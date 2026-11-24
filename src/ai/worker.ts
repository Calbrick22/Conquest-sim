/// <reference lib="webworker" />
import type { GameState, PlayerId } from '../engine/model/types';
import { aiDecide } from './ai';

/** Runs the computer opponent off the main thread so the UI stays responsive on a phone. */
self.onmessage = (e: MessageEvent<{ id: number; state: GameState; player: PlayerId }>) => {
  const { id, state, player } = e.data;
  try {
    const d = aiDecide(state, player);
    (self as unknown as Worker).postMessage({ id, decision: d });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
