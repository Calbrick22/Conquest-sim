import { describe, expect, it } from 'vitest';
import { getScenario } from '../../scenarios';
import { apply, createGame } from '../../engine/game';
import { entry, list } from '../../engine/testing/fixtures';
import { refreshRules } from '../../engine/rules/special/grants';
import { attackSummaries, rollSteps } from './rolls';

function clash() {
  const A = list('A', [{ regiments: [entry({ name: 'Axes', stands: 3 })] }]);
  const D = list('D', [{ regiments: [entry({ name: 'Shields', stands: 3 })] }]);
  const g = createGame({ seed: 9, scenario: getScenario('melee')!, lists: { P1: A, P2: D } });
  const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
  const a = s.regiments['P1-w0-r0']!;
  const d = s.regiments['P2-w0-r0']!;
  for (const r of [a, d]) {
    r.location = 'table';
    r.arrivedRound = 0;
  }
  a.pose = { x: 36, y: 20, angle: Math.PI / 2 };
  d.pose = { x: 36, y: 20, angle: -Math.PI / 2 };
  s.step = 'action';
  s.turn = 'P1';
  s.drawn = { player: 'P1', card: { id: 'c', kind: 'regiment', name: a.name, refId: a.id } };
  refreshRules(s);
  const t = apply(s, { type: 'activate', regimentId: a.id }, g.rng).state;
  t.forcedDice = [1, 1, 2, 2, 5, 6, 1, 1, 1, 1, 6, 6, 3, 6];
  return apply(t, { type: 'clash', regimentId: a.id, targetId: d.id }, g.rng).events;
}

describe('dice box and callout summaries', () => {
  it('splits a Clash into hit, save and Morale steps with each die marked', () => {
    const steps = rollSteps(clash());
    expect(steps[0]!.kind).toBe('hit');
    expect(steps[0]!.outcome).toMatch(/^\d+ Hits$/);
    expect(steps.some((x) => x.kind === 'save' && /saved · \d+ Wounds/.test(x.outcome))).toBe(true);
    expect(steps[0]!.pass.length).toBe(steps[0]!.values.length);
  });

  it('summarises each attack as Hits, saves and Wounds', () => {
    const [a] = attackSummaries(clash());
    expect(a!.target).toBe('Shields');
    expect(a!.hitDice).toBeGreaterThan(0);
    expect(a!.hits).toBeGreaterThanOrEqual(a!.saved);
    expect(a!.saved + a!.wounds).toBe(a!.hits);
  });

});
