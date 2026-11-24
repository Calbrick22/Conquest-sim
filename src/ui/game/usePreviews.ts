import { useEffect, useRef, useState } from 'react';
import type { GameState } from '../../engine/model/types';
import type { OutcomePreview, PreviewKind } from '../../engine/preview';

/** Outcome previews for every legal target of a Charge, Volley or Clash (roadmap 2.1), from a worker. */
export function usePreviews(state: GameState, kind: PreviewKind | null, attackerId: string | null): { previews: OutcomePreview[]; busy: boolean } {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [result, setResult] = useState<{ key: string; previews: OutcomePreview[] } | null>(null);
  const latest = useRef({ state, kind, attackerId });
  useEffect(() => {
    latest.current = { state, kind, attackerId };
  });
  const key = kind && attackerId ? `${kind}:${attackerId}:${state.round}:${JSON.stringify(state.activation?.actions ?? [])}` : '';

  useEffect(() => {
    if (!key || typeof Worker === 'undefined') return;
    worker.current ??= new Worker(new URL('./previewWorker.ts', import.meta.url), { type: 'module' });
    const w = worker.current;
    const id = ++seq.current;
    w.onmessage = (e: MessageEvent<{ id: number; previews?: OutcomePreview[] }>) => {
      if (e.data.id === seq.current) setResult({ key, previews: e.data.previews ?? [] });
    };
    const cur = latest.current;
    w.postMessage({ id, state: cur.state, kind: cur.kind, attackerId: cur.attackerId, samples: cur.kind === 'charge' ? 150 : 200 });
  }, [key]);

  useEffect(() => () => worker.current?.terminate(), []);
  if (!key) return { previews: [], busy: false };
  return result && result.key === key ? { previews: result.previews, busy: false } : { previews: [], busy: true };
}
