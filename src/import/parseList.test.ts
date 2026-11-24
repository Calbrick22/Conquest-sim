import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allEntries, parseArmyList } from './parseList';
import { parseRuleRef, splitTopLevel } from './ruleTokens';

const fixture = fs.readFileSync(path.join(__dirname, '__fixtures__/synthetic-list.txt'), 'utf8');

describe('rule reference tokenizer', () => {
  it('splits only at top-level commas', () => {
    expect(splitTopLevel('A, Barrage (4) [14", Armor Piercing (2), Deadly Shot], Impact (2)')).toEqual([
      'A',
      'Barrage (4) [14", Armor Piercing (2), Deadly Shot]',
      'Impact (2)',
    ]);
  });
  it('parses Barrage with range and nested rules', () => {
    const r = parseRuleRef('Barrage (4) [14", Armor Piercing (2), Deadly Shot]');
    expect(r.name).toBe('Barrage');
    expect(r.x).toBe(4);
    expect(r.range).toBe(14);
    expect(r.sub?.map((s) => [s.name, s.x])).toEqual([
      ['Armor Piercing', 2],
      ['Deadly Shot', undefined],
    ]);
  });
  it('parses (+X), non-numeric params and plain names', () => {
    expect(parseRuleRef('Cleave (+1)')).toMatchObject({ name: 'Cleave', x: 1, plus: true });
    expect(parseRuleRef('Practitioner (Pheromancy)')).toMatchObject({ name: 'Practitioner', param: 'Pheromancy' });
    expect(parseRuleRef('Flurry')).toMatchObject({ name: 'Flurry' });
    expect(parseRuleRef('Barrage (6) [12"]')).toMatchObject({ name: 'Barrage', x: 6, range: 12 });
  });
});

describe('army list parser (synthetic fixture)', () => {
  const list = parseArmyList(fixture);
  const entries = allEntries(list);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));

  it('reads the header', () => {
    expect(list).toMatchObject({ title: 'Testland', faction: 'The Testland Compact', sect: 'The Glass Order', points: 1000, pointsLimit: 1000 });
  });
  it('produces no warnings', () => {
    expect(list.warnings).toEqual([]);
    expect(entries.flatMap((e) => e.warnings)).toEqual([]);
  });
  it('groups entries into warbands with characters', () => {
    expect(list.warbands.map((w) => [w.character?.name, w.regiments.map((r) => r.name)])).toEqual([
      ['Captain Brindle', ['Glass Pikes', 'Copper Slingers']],
      ['Matron Oakhide', ['Tin Ogres', 'Lumbering Crate']],
    ]);
    expect(list.warbands[0]!.restrictions).toEqual(['This Warband may not contain more than 2 Regiments of Glass Pikes.']);
  });
  it('reads slot, stands, points, type, class and characteristics ("-" as null)', () => {
    expect(byName['Captain Brindle']).toMatchObject({ slot: 'Character', stands: 1, points: 90, type: 'Infantry', cls: null });
    expect(byName['Captain Brindle']!.stats).toEqual({ M: null, V: 2, C: 3, A: 4, W: 4, R: 3, D: 2, E: 1 });
    expect(byName['Glass Pikes']).toMatchObject({ slot: 'Mainstay', stands: 4, points: 120, cls: 'Medium' });
    expect(byName['Copper Slingers']).toMatchObject({ slot: 'Restricted', cls: 'Light' });
  });
  it('re-joins wrapped special rules ("Cleave\\n(1)", "Quick\\nFeet")', () => {
    expect(byName['Glass Pikes']!.specialRules.map((r) => r.raw)).toEqual(['Shield', 'Support (2)', 'Cleave (1)', 'Fearless']);
    expect(byName['Copper Slingers']!.specialRules.map((r) => r.name)).toEqual(['Barrage', 'Loose Formation', 'Quick Feet']);
  });
  it('survives a blank line (page break) inside an entry', () => {
    expect(byName['Tin Ogres']!.stats.W).toBe(5);
  });
  it('reads draw events, actions, supremacy, command models, roles, options and notes', () => {
    const cap = byName['Captain Brindle']!;
    expect(cap.supremacyAbilities).toEqual(['Polished Banner']);
    expect(cap.actions.map((a) => a.name)).toEqual(['Rousing Shout']);
    expect(cap.options).toEqual({ Trinkets: ['Lucky Button', 'Spare Boots'] });
    expect(byName['Glass Pikes']!.drawEvents).toEqual(['Bastion (1)']);
    expect(byName['Glass Pikes']!.commandModels).toEqual(['Leader', 'Standard Bearer']);
    expect(byName['Copper Slingers']!.notes).toEqual([
      'Should this Regiment have 2 or fewer stands, it adds one shot to its volley regardless of rank.',
    ]);
  });
  it('builds the rules glossary, including unreferenced headings and wrapped text', () => {
    expect(Object.keys(list.glossary)).toContain('Glass Discipline');
    expect(list.glossary['Barrage']).toBe(
      'Synthetic placeholder: each stand fires X shots; the range and extra rules follow in brackets.',
    );
    for (const e of entries) for (const r of e.specialRules) expect(list.glossary, r.name).toHaveProperty([r.name]);
  });
  it('keeps army rules text', () => {
    expect(list.armyRules).toContain('counts as tidy');
  });
  it('flags unreadable input instead of crashing', () => {
    const broken = parseArmyList('Nonsense\nWarband 1\nSome Unit 3 100\nM V C A W R D E Type Infantry\n5 x 2 Class Light\n');
    const e = allEntries(broken)[0]!;
    expect(e.warnings.length).toBeGreaterThan(0);
  });
});
