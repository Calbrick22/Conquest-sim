import type { ArmyList, ListEntry, RuleRef } from '../../import/types';

/** Synthetic list builder for engine tests (invented units; no real data). */
export function entry(p: Partial<ListEntry> & { name: string }): ListEntry {
  return {
    slot: 'Mainstay',
    stands: 3,
    points: 100,
    type: 'Infantry',
    cls: 'Medium',
    stats: { M: 6, V: 1, C: 2, A: 4, W: 4, R: 3, D: 2, E: 0 },
    specialRules: [],
    drawEvents: [],
    actions: [],
    supremacyAbilities: [],
    commandModels: ['Leader'],
    battlefieldRoles: [],
    options: {},
    notes: [],
    warnings: [],
    ...p,
  };
}

export const rule = (name: string, x?: number): RuleRef => ({ name, raw: x === undefined ? name : `${name} (${x})`, ...(x === undefined ? {} : { x }) });

export function list(title: string, warbands: { character?: ListEntry; regiments: ListEntry[] }[]): ArmyList {
  return {
    title,
    faction: `${title} faction`,
    sect: null,
    points: 1000,
    pointsLimit: 1000,
    warbands: warbands.map((w) => ({ declaredSize: w.regiments.length, character: w.character ?? null, regiments: w.regiments, restrictions: [] })),
    glossary: {},
    armyRules: '',
    warnings: [],
  };
}

export const hero = (name: string, type = 'Infantry'): ListEntry =>
  entry({ name, slot: 'Character', stands: 1, type, cls: null, stats: { M: null, V: 2, C: 4, A: 4, W: 4, R: 4, D: 3, E: 0 }, commandModels: [], supremacyAbilities: ['Test Supremacy'] });

export const testListA = (): ArmyList =>
  list('Alpha', [
    {
      character: hero('Alpha Captain'),
      regiments: [
        entry({ name: 'Alpha Spears', stands: 6, commandModels: ['Leader', 'Standard Bearer'] }),
        entry({ name: 'Alpha Riders', stands: 3, type: 'Cavalry', cls: 'Light', stats: { M: 8, V: 1, C: 2, A: 4, W: 4, R: 3, D: 2, E: 1 } }),
        entry({ name: 'Alpha Beast', stands: 1, type: 'Monster', cls: 'Heavy', commandModels: [], stats: { M: 6, V: 1, C: 3, A: 8, W: 12, R: 4, D: 3, E: 0 } }),
      ],
    },
  ]);

export const testListB = (): ArmyList =>
  list('Bravo', [
    {
      character: hero('Bravo Chief', 'Brute'),
      regiments: [
        entry({ name: 'Bravo Brutes', stands: 3, type: 'Brute', cls: 'Medium' }),
        entry({ name: 'Bravo Archers', stands: 4, cls: 'Light', specialRules: [rule('Barrage', 2)] }),
      ],
    },
  ]);
