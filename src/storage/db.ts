import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Action, GameEvent } from '../engine/game';
import type { GameState, PlayerId } from '../engine/model/types';
import type { RngState } from '../engine/rng';
import type { ArmyList } from '../import/types';

/** On-device storage (IndexedDB). Nothing leaves the device. */
export interface SavedList {
  id: string;
  name: string;
  savedAt: string;
  source: 'pdf' | 'text';
  list: ArmyList;
}

/** A saved game: the initial state, seed and every Action, so it can be replayed exactly. */
export interface SavedGame {
  id: string;
  name: string;
  savedAt: string;
  createdAt: string;
  you: PlayerId;
  initial: GameState;
  initialRng: RngState;
  initialEvents: GameEvent[];
  actions: Action[];
  /** Summary for the list screen. */
  round: number;
  vp: Record<PlayerId, number>;
  ended: boolean;
}

interface Schema extends DBSchema {
  lists: { key: string; value: SavedList; indexes: { savedAt: string } };
  games: { key: string; value: SavedGame; indexes: { savedAt: string } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  dbp ??= openDB<Schema>('conquest-sim', 2, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore('lists', { keyPath: 'id' }).createIndex('savedAt', 'savedAt');
      if (oldVersion < 2) d.createObjectStore('games', { keyPath: 'id' }).createIndex('savedAt', 'savedAt');
    },
  });
  return dbp;
}

export async function saveList(l: SavedList): Promise<void> {
  await (await db()).put('lists', l);
}

export async function listLists(): Promise<SavedList[]> {
  const all = await (await db()).getAll('lists');
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function deleteList(id: string): Promise<void> {
  await (await db()).delete('lists', id);
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function saveGame(g: SavedGame): Promise<void> {
  await (await db()).put('games', g);
}

export async function listGames(): Promise<SavedGame[]> {
  const all = await (await db()).getAll('games');
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function deleteGame(id: string): Promise<void> {
  await (await db()).delete('games', id);
}
