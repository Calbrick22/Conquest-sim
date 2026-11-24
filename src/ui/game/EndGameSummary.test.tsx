import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { apply, createGame, validate } from '../../engine/game';
import { parseArmyList } from '../../import/parseList';
import { getScenario } from '../../scenarios';
import { aiDecide, decisionMaker } from '../../ai/ai';
import { EndGameSummary } from './EndGameSummary';
import { wipedOut } from './useAutoplay';

const fx = (n: string) => parseArmyList(fs.readFileSync(path.join(__dirname, '../../import/__fixtures__', n), 'utf8'));

describe('end of the battle', () => {
  it(
    'with one side wiped out, the computer plays the remaining Rounds to the end with legal Actions, and the summary shows each Round',
    () => {
      const g = createGame({ seed: 8, scenario: getScenario('melee')!, lists: { P1: fx('synthetic-list.txt'), P2: fx('synthetic-list-2.txt') } });
      let s = apply(g.state, { type: 'startBattle' }, g.rng).state;
      let rng = g.rng;
      // P2 is wiped out before the first Round's Reinforcements.
      s = structuredClone(s);
      for (const r of Object.values(s.regiments)) if (r.owner === 'P2') r.location = 'destroyed';
      for (const c of Object.values(s.characters)) if (c.id.startsWith('P2')) c.destroyed = true;
      expect(wipedOut(s, 'P2')).toBe(true);
      expect(wipedOut(s, 'P1')).toBe(false);
      let steps = 0;
      while (s.phase === 'play') {
        if (++steps > 4000) throw new Error('no end');
        const who = decisionMaker(s);
        const p = who === 'any' || who === null ? (s.firstPlayer ?? 'P1') : who;
        const { action } = aiDecide(s, p);
        expect(validate(s, action).ok).toBe(true);
        const r = apply(s, action, rng);
        s = r.state;
        rng = r.rng;
      }
      expect(s.scoreHistory).toHaveLength(s.scenario.rounds);
      expect(s.players.P1.vp).toBeGreaterThan(0);
      const html = renderToStaticMarkup(<EndGameSummary s={s} you="P1" mode="ai" onHome={() => {}} onExport={() => {}} onClose={() => {}} />);
      expect(html).toContain('Victory');
      expect(html).toContain('Save and return home');
      expect((html.match(/<tr>/g) ?? []).length).toBe(s.scenario.rounds + 1);
    },
    240_000,
  );
});
