/// <reference lib="webworker" />
import type { GameState } from '../../engine/model/types';
import { previewTargets, type PreviewKind } from '../../engine/preview';

/** Outcome previews off the main thread (they replay the Action many times). */
self.onmessage = (e: MessageEvent<{ id: number; state: GameState; kind: PreviewKind; attackerId: string; samples: number }>) => {
  const { id, state, kind, attackerId, samples } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, previews: previewTargets(state, kind, attackerId, samples) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
