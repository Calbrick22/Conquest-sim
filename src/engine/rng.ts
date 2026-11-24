/**
 * Seeded, deterministic random number generator (sfc32 with a splitmix32 seeder).
 * Every die rolled in a game comes from here so that a game can be replayed
 * exactly from its seed and action log.
 */
export interface RngState {
  readonly seed: number;
  /** Number of values drawn so far; recorded with every dice event. */
  readonly index: number;
  readonly s: readonly [number, number, number, number];
}

function splitmix32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function createRng(seed: number): RngState {
  const sm = splitmix32(seed);
  return { seed, index: 0, s: [sm(), sm(), sm(), sm()] };
}

/** Returns a uint32 and the next state. Pure: the input state is not modified. */
export function nextU32(state: RngState): [number, RngState] {
  let [a, b, c, d] = state.s;
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return [t >>> 0, { seed: state.seed, index: state.index + 1, s: [a, b, c, d] }];
}

/** Rolls one D6 (1–6) without modulo bias. */
export function rollD6(state: RngState): [number, RngState] {
  let s = state;
  for (;;) {
    const [u, next] = nextU32(s);
    s = next;
    // 4294967292 is the largest multiple of 6 below 2^32.
    if (u < 4294967292) return [(u % 6) + 1, s];
  }
}

export function rollD6s(state: RngState, count: number): [number[], RngState] {
  const out: number[] = [];
  let s = state;
  for (let i = 0; i < count; i++) {
    const [v, n] = rollD6(s);
    out.push(v);
    s = n;
  }
  return [out, s];
}
