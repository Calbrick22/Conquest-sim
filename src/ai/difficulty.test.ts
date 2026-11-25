import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame } from '../engine/game';
import type { GameState } from '../engine/model/types';
import { refreshRules } from '../engine/rules/special/grants';
import { buildCards } from '../engine/round';
import { entry, list } from '../engine/testing/fixtures';
import { parseRuleRef } from '../import/ruleTokens';
import { aiDecide } from './ai';
import { PROFILES, profileFor } from './difficulty';

/** Synthetic units; the tests check how each difficulty chooses, not the rules. */
const shooter = entry({ name: 'Test Bows', stands: 3, cls: 'Light', specialRules: [parseRuleRef('Barrage (4) [24"]')] });
const near = entry({ name: 'Near Plates', stands: 3, stats: { M: 5, V: 1, C: 2, A: 4, W: 4, R: 3, D: 5, E: 0 } });
const far = entry({ name: 'Far Rags', stands: 3, stats: { M: 5, V: 1, C: 2, A: 4, W: 4, R: 3, D: 0, E: 0 } });

function table(): GameState {
  const g = createGame({ seed: 11, scenario: getScenario('melee')!, lists: { P1: list('Alpha', [{ regiments: [shooter, entry({ name: 'Second', stands: 3 }), entry({ name: 'Third', stands: 3 })] }]), P2: list('Bravo', [{ regiments: [near, far] }]) } });
  const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
  const [bows, second, third, plates, rags] = Object.values(s.regiments);
  for (const r of Object.values(s.regiments)) {
    r.location = 'table';
    r.arrivedRound = 0;
    r.files = 3;
  }
  bows!.pose = { x: 36, y: 10, angle: Math.PI / 2 };
  second!.pose = { x: 8, y: 6, angle: Math.PI / 2 };
  third!.pose = { x: 64, y: 6, angle: Math.PI / 2 };
  plates!.pose = { x: 34, y: 22, angle: -Math.PI / 2 };
  rags!.pose = { x: 40, y: 30, angle: -Math.PI / 2 };
  refreshRules(s);
  return s;
}

describe('computer difficulty (docs/ai-difficulty.md)', () => {
  it('profiles: the Expert is always consistent; an Intermediate sometimes plays an "off" decision, deterministically', () => {
    const s = table();
    expect(profileFor(s, 'expert', 1)).toBe(PROFILES.expert);
    const picks = Array.from({ length: 40 }, (_, i) => profileFor(s, 'intermediate', i).opportunism);
    expect(picks.some((x) => x === PROFILES.intermediate.opportunism)).toBe(true);
    expect(picks.some((x) => x === 0)).toBe(true);
    expect(Array.from({ length: 40 }, (_, i) => profileFor(s, 'intermediate', i).opportunism)).toEqual(picks);
  });

  it('Beginner stacks its Command Cards in army-list order; Advanced reorders by threats', () => {
    const s = table();
    s.step = 'command';
    const listOrder = buildCards(s, 'P1').map((c) => c.id);
    const b = aiDecide(s, 'P1', 'beginner').action;
    expect(b.type === 'setStack' && b.order).toEqual(listOrder);
    const a = aiDecide(s, 'P1', 'advanced').action;
    // The shooter with targets in range goes first.
    expect(a.type === 'setStack' && a.order[0]).toBe(`card-${Object.keys(s.regiments)[0]}`);
  });

  it('Volley target: a Beginner shoots the nearest enemy; informed levels pick the one it hurts most', () => {
    const s = table();
    // No objectives: the test is only about which target it shoots.
    s.scenario = { ...s.scenario, zones: [], markers: [] };
    const bows = Object.values(s.regiments)[0]!;
    s.step = 'action';
    s.turn = 'P1';
    s.activation = { regimentId: bows.id, actions: ['takeAim'], entering: false, startPose: bows.pose, drawEventDone: true, aimed: true, inspired: false, ended: false };
    const target = (d: 'beginner' | 'expert') => {
      const a = aiDecide(s, 'P1', d).action;
      return a.type === 'volley' ? s.regiments[a.targetId]!.name : a.type;
    };
    expect(target('beginner')).toBe('Near Plates');
    expect(target('expert')).toBe('Far Rags');
  });

  it('first player: a Beginner always takes the initiative', () => {
    const s = table();
    s.step = 'supremacy';
    s.supremacyWinner = 'P1';
    const a = aiDecide(s, 'P1', 'beginner').action;
    expect(a).toMatchObject({ type: 'chooseFirst', first: 'P1' });
  });
});
