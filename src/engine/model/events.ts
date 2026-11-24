import type { PlayerId } from './types';

export interface DiceRecord {
  purpose: string;
  seed: number;
  /** RNG draw index before the first die. */
  index: number;
  values: number[];
  notes?: string[];
}

export interface GameEvent {
  type: string;
  text: string;
  round: number;
  player?: PlayerId;
  regimentId?: string;
  override?: boolean;
  dice?: DiceRecord;
}


