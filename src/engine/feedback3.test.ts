import { describe, expect, it } from 'vitest';
import { getScenario } from '../scenarios';
import { apply, createGame, validate } from './game';
import type { GameState } from './model/types';
import { refreshRules } from './rules/special/grants';
import { entry, list } from './testing/fixtures';
import { parseRuleRef } from '../import/ruleTokens';
import type { ListEntry } from '../import/types';
import type { TerrainPiece } from '../scenarios/types';
import { makePiece } from './terrain';
import { chargeHindered, chargePlacement, planVolley, volleyLines } from './actions';
import { pickableZones } from './gameM4';
import { aiDecide } from '../ai/ai';

const R = parseRuleRef;

function arena(terrain: TerrainPiece[], atk: Partial<ListEntry> & { rules?: string[] } = {}, def: Partial<ListEntry> = {}, scenario = 'melee') {
  const sc = { ...getScenario(scenario)!, terrain };
  const A = list('A', [{ regiments: [entry({ name: 'Shooters', stands: 3, ...atk, specialRules: (atk.rules ?? []).map(R) })] }]);
  const D = list('D', [{ regiments: [entry({ name: 'Targets', stands: 3, ...def })] }]);
  const g = createGame({ seed: 3, scenario: sc, lists: { P1: A, P2: D } });
  const s = structuredClone(apply(g.state, { type: 'startBattle' }, g.rng).state);
  for (const r of Object.values(s.regiments)) {
    r.location = 'table';
    r.arrivedRound = 0;
  }
  s.step = 'action';
  refreshRules(s);
  return { s, a: s.regiments['P1-w0-r0']!, d: s.regiments['P2-w0-r0']! };
}

describe('feedback fixes', () => {
  it('Acute Senses: the Volley line may start from any edge, so an enemy behind can be targeted (core p.97)', () => {
    const { s, a, d } = arena([], { rules: ['Acute Senses', 'Barrage (2) [16"]'] });
    a.files = 3;
    a.pose = { x: 36, y: 24, angle: Math.PI / 2 };
    d.pose = { x: 36, y: 14, angle: Math.PI / 2 };
    expect(planVolley(s, a, d, false).problems).toEqual([]);
    expect(volleyLines(s, a).some((l) => l.kind === 'clear' || l.kind === 'long')).toBe(true);
    a.rules = a.rules.filter((x) => x.name !== 'Acute Senses');
    expect(planVolley(s, a, d, false).problems.length).toBeGreaterThan(0);
  });

  it('Grind Them Down: with a friendly Regiment near every 6″ zone, the player picks no zone (pack p.22, AMB-93)', () => {
    const { s, a } = arena([], {}, {}, 'grind-them-down');
    s.step = 'supremacy';
    s.firstPlayer = 'P1';
    s.zonePicks = { P1: null, P2: null };
    expect(validate(s, { type: 'pickZone', player: 'P1', zoneId: '' }).ok).toBe(false);
    // Copies of the Regiment on every 6″ zone.
    for (const z of s.scenario.zones.filter((x) => x.diameter === 6)) {
      const c = structuredClone(a);
      c.id = `P1-x-${z.id}`;
      c.pose = { x: z.x, y: z.y + 1, angle: Math.PI / 2 };
      s.regiments[c.id] = c;
    }
    expect(pickableZones(s, 'P1')).toEqual([]);
    expect(validate(s, { type: 'pickZone', player: 'P1', zoneId: '' }).ok).toBe(true);
  });

  it('Charges avoid Hindering terrain when an equally engaged position allows it (core p.86)', () => {
    const forest = { ...makePiece('f', 'forest', 31, 26), w: 2, h: 3 };
    const { s, a, d } = arena([forest], { stands: 2 }, { stands: 6 });
    a.files = 2;
    d.files = 6;
    a.pose = { x: 32, y: 21, angle: Math.PI / 2 };
    d.pose = { x: 36, y: 31, angle: -Math.PI / 2 };
    refreshRules(s);
    const straight = { x: 32.5, y: 31, angle: Math.PI / 2 };
    expect(chargeHindered(s, a, a.pose, straight)).toBe(true);
    const place = chargePlacement(s, a, d, 'front');
    expect('pose' in place && place.pose).toBeTruthy();
    expect(chargeHindered(s, a, a.pose, (place as { pose: typeof straight }).pose)).toBe(false);
  });
  it('Simulating the rest of the game: a Regiment in a zone holds it once the enemy is gone', () => {
    const { s, a, d } = arena([]);
    d.location = 'destroyed';
    d.stands = [];
    const z = s.scenario.zones[0]!;
    a.pose = { x: z.x, y: z.y + 1, angle: Math.PI / 2 };
    s.activation = { regimentId: a.id, actions: [], entering: false, startPose: a.pose, drawEventDone: true, aimed: false, inspired: false, ended: false };
    for (const lvl of ['beginner', 'advanced'] as const) expect(aiDecide(s, 'P1', lvl).action.type).toBe('endActivation');
  });
  it('Reinforcements: each successful roll of a Class brings on the next Regiment in the player\'s priority order (core p.21)', () => {
    const A = list('A', [{ regiments: [entry({ name: 'First Lights', cls: 'Light' }), entry({ name: 'Second Lights', cls: 'Light' }), entry({ name: 'Third Lights', cls: 'Light' })] }]);
    const D = list('D', [{ regiments: [entry({ name: 'Foes', cls: 'Light' })] }]);
    const g = createGame({ seed: 3, scenario: getScenario('melee')!, lists: { P1: A, P2: D } });
    const s = apply(g.state, { type: 'startBattle' }, g.rng).state;
    s.forcedDice = [1, 6, 6];
    const third = Object.values(s.regiments).find((r) => r.name === 'Third Lights')!;
    const r = apply(s, { type: 'reinforcements', player: 'P1', choice: null, priority: [third.id] }, g.rng);
    const arriving = Object.values(r.state.regiments).filter((x) => x.owner === 'P1' && x.location === 'arriving').map((x) => x.name);
    expect(arriving).toEqual(['Third Lights']);
    expect(r.events.some((e) => /Light Reinforcement Rolls 1, 6, 6, needing 4 or less: 1 success\. Arriving by priority: Third Lights/.test(e.text))).toBe(true);
  });
});

export type { GameState };
