import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { apply, createGame, validate, type GameEvent } from '../engine/game';
import type { GameState } from '../engine/model/types';
import { parseArmyList } from '../import/parseList';
import { getScenario } from '../scenarios';
import { aiDecide, chargeChance, decisionMaker, pTest } from './ai';

const fx = (n: string) => parseArmyList(fs.readFileSync(path.join(__dirname, '../import/__fixtures__', n), 'utf8'));

function playAiGame(seed: number, scenario = 'forlorn-hope', p1 = 'synthetic-list.txt') {
  const g = createGame({ seed, scenario: getScenario(scenario)!, lists: { P1: fx(p1), P2: fx('synthetic-list-2.txt') } });
  let s: GameState = apply(g.state, { type: 'startBattle' }, g.rng).state;
  let rng = g.rng;
  const events: GameEvent[] = [];
  let steps = 0;
  while (s.phase === 'play') {
    if (++steps > 6000) throw new Error(`no end after ${steps} steps (round ${s.round}, step ${s.step})`);
    const who = decisionMaker(s);
    const p = who === 'any' || who === null ? (s.firstPlayer ?? 'P1') : who;
    const { action } = aiDecide(s, p);
    const v = validate(s, action);
    if (!v.ok) throw new Error(`AI chose an illegal ${action.type} at round ${s.round}: ${v.reasons.join(' ')}`);
    const r = apply(s, action, rng);
    s = r.state;
    rng = r.rng;
    events.push(...r.events);
  }
  return { s, events, steps };
}

describe('computer opponent', () => {
  it('probability helpers', () => {
    expect(pTest(3)).toBeCloseTo(0.5);
    expect(pTest(7)).toBeCloseTo(5 / 6);
    expect(pTest(0)).toBeCloseTo(1 / 6);
  });
  it('charge chance from distance and March', () => {
    const g = createGame({ seed: 1, scenario: getScenario('melee')!, lists: { P1: fx('synthetic-list.txt'), P2: fx('synthetic-list-2.txt') } });
    const r = g.state.regiments['P1-w0-r0']!; // M5
    expect(chargeChance(g.state, r, 5)).toBe(1);
    expect(chargeChance(g.state, r, 8)).toBeCloseTo(1 - (2 / 6) * (2 / 6)); // needs 3 or more on the die, Standard Bearer re-roll
  });
  it(
    'plays a full 10-Round game AI vs AI with a fixed seed, using only legal actions',
    () => {
      const { s, events } = playAiGame(2026);
      expect(s.phase).toBe('ended');
      expect(s.scoreHistory).toHaveLength(10);
      expect(events.some((e) => e.type === 'ai')).toBe(true);
      expect(events.some((e) => e.type === 'march' || e.text.includes('marches on'))).toBe(true);
      // Every Regiment gets onto the table at some point (no Regiment stuck in Reinforcements).
      expect(Object.values(s.regiments).filter((r) => r.location === 'reserve' || r.location === 'arriving').map((r) => r.name)).toEqual([]);
      // Every AI action carries a one-line reason.
      expect(events.filter((e) => e.type === 'ai').every((e) => e.text.length > 4)).toBe(true);
    },
    120_000,
  );
  it(
    'plays a full game with a synthetic Old Dominion army: Power Tokens, Memories of Old and Spells (od p.5–7)',
    () => {
      const { s, events } = playAiGame(31, 'melee', 'synthetic-od-list.txt');
      expect(s.phase).toBe('ended');
      expect(s.players.P1.od).toBeDefined();
      expect(events.some((e) => e.type === 'power')).toBe(true);
      expect(events.some((e) => /Memories of Old/.test(e.text))).toBe(true);
      expect(events.some((e) => / casts /.test(e.text))).toBe(true);
      expect(events.filter((e) => e.override).map((e) => e.text)).toEqual([]);
    },
    240_000,
  );
  it(
    'plays a full game with a synthetic Sorcerer Kings army: Rituals, Court Spells, Elemental Conduit (sk p.5)',
    () => {
      const { s, events } = playAiGame(44, 'melee', 'synthetic-sk-list.txt');
      expect(s.phase).toBe('ended');
      expect(s.players.P1.sk).toBeDefined();
      expect(events.some((e) => /starts Preparing/.test(e.text))).toBe(true);
      expect(events.some((e) => /Elemental Conduit/.test(e.text))).toBe(true);
      expect(events.some((e) => / casts /.test(e.text))).toBe(true);
      expect(events.some((e) => /reveals the Ritual/.test(e.text))).toBe(true);
      expect(events.filter((e) => e.override).map((e) => e.text)).toEqual([]);
    },
    240_000,
  );
  it(
    'plays a full game with a synthetic Dweghom army: Elemental Power, Empowerments, Awakened (dw p.4)',
    () => {
      const { s, events } = playAiGame(52, 'melee', 'synthetic-dw-list.txt');
      expect(s.phase).toBe('ended');
      expect(s.players.P1.dw).toBeDefined();
      expect(events.some((e) => /Elemental Power Marker/.test(e.text))).toBe(true);
      expect(events.some((e) => /Forged By the Elements: /.test(e.text))).toBe(true);
      expect(events.some((e) => e.type === 'awakened')).toBe(true);
      expect(events.filter((e) => e.override).map((e) => e.text)).toEqual([]);
    },
    240_000,
  );
  it(
    'is deterministic for a seed',
    () => {
      const a = playAiGame(77, 'melee');
      const b = playAiGame(77, 'melee');
      expect(a.s.players.P1.vp).toBe(b.s.players.P1.vp);
      expect(a.s.players.P2.vp).toBe(b.s.players.P2.vp);
      expect(a.steps).toBe(b.steps);
    },
    240_000,
  );
});
