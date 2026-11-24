import { describe, expect, it } from 'vitest';
import { getScenario } from '../../scenarios';
import { createGame } from '../game';
import { testListA, testListB } from '../testing/fixtures';
import { gameLogMarkdown } from './markdown';

describe('markdown game log (owner format)', () => {
  it('has the header, result line and score rows for 10 rounds', () => {
    const g = createGame({ seed: 1, scenario: getScenario('forlorn-hope')!, lists: { P1: testListA(), P2: testListB() } });
    const s = structuredClone(g.state);
    s.phase = 'ended';
    s.players.P1.vp = 9;
    s.players.P2.vp = 4;
    s.scoreHistory = [
      { round: 2, seized: { P1: ['a', 'b', 'c'], P2: [] }, vp: { P1: 9, P2: 4 }, lines: { P1: [{ rule: 'perZoneSeized', vp: 6, detail: '' }, { rule: 'seizedCountBonus', vp: 3, detail: '' }], P2: [{ rule: 'markerDestroyed', vp: 3, detail: '' }, { rule: 'perZoneSeized', vp: 1, detail: '' }] } },
    ];
    const md = gameLogMarkdown({ state: s, events: [], you: 'P1', date: '2026-11-24' });
    const lines = md.split('\n');
    expect(lines[0]).toBe('# Game log: Forlorn Hope — Alpha vs Bravo faction, 2026-11-24');
    expect(lines[1]).toBe('**Result:** Won 9-4 (Forlorn Hope, 1000 pts)');
    expect(lines[3]).toBe('| Round | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |');
    expect(lines[5]).toBe('| My zones |  | 9 |  |  |  |  |  |  |  |  |');
    expect(lines[6]).toBe('| My kills and Markers |  | 0 |  |  |  |  |  |  |  |  |');
    expect(lines[7]).toBe('| His zones |  | 1 |  |  |  |  |  |  |  |  |');
    expect(lines[8]).toBe('| His kills |  | 3 |  |  |  |  |  |  |  |  |');
  });
});
