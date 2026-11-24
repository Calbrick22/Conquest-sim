import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ArmyList } from '../import/types';

/** On-device storage (IndexedDB). Nothing leaves the device. */
export interface SavedList {
  id: string;
  name: string;
  savedAt: string;
  source: 'pdf' | 'text';
  list: ArmyList;
}

interface Schema extends DBSchema {
  lists: { key: string; value: SavedList; indexes: { savedAt: string } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  dbp ??= openDB<Schema>('conquest-sim', 1, {
    upgrade(d) {
      const s = d.createObjectStore('lists', { keyPath: 'id' });
      s.createIndex('savedAt', 'savedAt');
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
