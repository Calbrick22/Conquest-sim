import { it, expect } from 'vitest';

// Regression tests from play feedback (2026-11-25). Synthetic units with the Spires entries' rules.
import { getScenario } from '../scenarios';
import { apply, createGame, validate } from './game';
import { entry, list } from './testing/fixtures';
import { parseRuleRef } from '../import/ruleTokens';
import { refreshRules } from './rules/special/grants';

const mk = (rules: string[], name: string, o = {}) => entry({ name, stands: 3, type: 'Brute', cls: 'Medium', stats: { M: 6, V: 1, C: 3, A: 4, W: 5, R: 3, D: 3, E: 0 }, specialRules: rules.map((r) => parseRuleRef(r)), ...o });
function setup(a: ReturnType<typeof mk>, gap: number) {
  const g = createGame({ seed: 3, scenario: getScenario('melee')!, lists: { P1: list('Spires', [{ regiments: [a] }]), P2: list('Foes', [{ regiments: [entry({ name: 'Guards', stands: 3 })] }]) } });
  const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
  const [r1, r2] = Object.values(s.regiments);
  for (const r of [r1!, r2!]) { r.location = 'table'; r.arrivedRound = 0; r.files = 3; }
  r1!.pose = { x: 30, y: 20, angle: Math.PI / 2 };
  r2!.pose = { x: 30, y: 20 + gap + 0, angle: -Math.PI / 2 };
  s.step = 'action'; s.turn = 'P1';
  refreshRules(s);
  s.drawn = { player: 'P1', card: { id: 'c', kind: 'regiment', name: r1!.name, refId: r1!.id } };
  const a1 = apply(s, { type: 'activate', regimentId: r1!.id }, g.rng);
  return { s: a1.state, rng: a1.rng, r1: r1!, r2: r2! };
}
it('Unstoppable re-rolls a failed Charge Roll and the log shows both rolls (core p.101)', () => {
  const { s, rng, r1, r2 } = setup(mk(['Impact (3)', 'Linebreaker', 'Oblivious', 'Unstoppable'], 'Brute Drones'), 10);
  const t = structuredClone(s); t.forcedDice = [1, 6, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
  expect(validate(t, { type: 'charge', regimentId: r1.id, targetId: r2.id }).ok).toBe(true);
  const r = apply(t, { type: 'charge', regimentId: r1.id, targetId: r2.id }, rng);
  const roll = r.events.find((e) => / charges /.test(e.text))!;
  expect(roll.text).toMatch(/rolled 1 .*Unstoppable re-roll 6.*success/);
  expect(roll.dice!.values).toEqual([1, 6]);
});
it('Swift Retreat: always a Clean Withdrawal, without a Resolve roll (Spires rule text; core p.51)', () => {
  const { s, rng, r1 } = setup(mk(['Swift Retreat', 'Loose Formation'], 'Vanguard Clone Infiltrators', { type: 'Infantry', cls: 'Light' }), 0);
  const t = structuredClone(s); t.forcedDice = [6, 2];
  const a = { type: 'withdraw' as const, regimentId: r1.id, moves: [{ kind: 'forward' as const, d: 4 }], turn: true };
  expect(validate(t, a).ok).toBe(true);
  const r = apply(t, a, rng);
  expect(r.events.some((e) => /Swift Retreat makes it a Clean Withdrawal \(no roll\)/.test(e.text))).toBe(true);
  expect(r.state.regiments[r1.id]!.pose.y).toBeLessThan(r1.pose.y);
});
