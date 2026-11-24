import { useEffect, useState } from 'react';
import { createGame, rollOff, type GameEvent } from '../../engine/game';
import type { PlayerId } from '../../engine/model/types';
import { createRng } from '../../engine/rng';
import syntheticList from '../../import/__fixtures__/synthetic-list.txt?raw';
import { parseArmyList } from '../../import/parseList';
import type { ArmyList } from '../../import/types';
import { SCENARIOS } from '../../scenarios';
import { listLists, type SavedList } from '../../storage/db';
import type { GameSession } from './useGame';

const DEMO_ID = 'demo';

export interface NewGame {
  session: GameSession;
  /** Which side the human plays ("hotseat" controls both). */
  you: PlayerId;
  mode: 'hotseat';
}

export function SetupScreen({ onStart }: { onStart: (g: NewGame) => void }) {
  const [saved, setSaved] = useState<SavedList[]>([]);
  const [mine, setMine] = useState(DEMO_ID);
  const [theirs, setTheirs] = useState(DEMO_ID);
  const [scenarioId, setScenarioId] = useState('forlorn-hope');
  const [seed, setSeed] = useState(() => (Date.now() >>> 0) % 1_000_000);
  const [roll, setRoll] = useState<{ winner: 'you' | 'opponent'; rolls: [number, number][] } | null>(null);

  useEffect(() => {
    listLists().then(setSaved).catch(() => setSaved([]));
  }, []);

  const getList = (id: string): ArmyList => (id === DEMO_ID ? parseArmyList(syntheticList) : saved.find((s) => s.id === id)!.list);

  const doRoll = () => {
    const r = rollOff(createRng(seed));
    // In the roll-off result P1 = you, P2 = opponent (the real sides are chosen next).
    setRoll({ winner: r.winner === 'P1' ? 'you' : 'opponent', rolls: r.rolls });
  };

  const start = (youAre: PlayerId) => {
    const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
    const lists = youAre === 'P1' ? { P1: getList(mine), P2: getList(theirs) } : { P1: getList(theirs), P2: getList(mine) };
    const g = createGame({ seed, scenario, lists });
    const rollText = roll!.rolls.map(([a, b]) => `you ${a}, opponent ${b}`).join('; then ');
    const initialEvents: GameEvent[] = [
      ...g.events,
      { type: 'rolloff', text: `Roll-off for sides (lowest wins): ${rollText}. ${roll!.winner === 'you' ? 'You win' : 'Opponent wins'}; you are ${youAre} (${youAre === 'P1' ? 'bottom' : 'top'} edge).`, round: 1 },
    ];
    onStart({
      session: { initial: g.state, initialRng: g.rng, initialEvents, state: g.state, rng: g.rng, actions: [], events: initialEvents },
      you: youAre,
      mode: 'hotseat',
    });
  };

  const listOptions = (
    <>
      <option value={DEMO_ID}>Demo list (invented units)</option>
      {saved.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name} ({s.list.faction})
        </option>
      ))}
    </>
  );

  return (
    <section>
      <h2>New game</h2>
      <div className="card">
        <label className="field">
          Your list <select value={mine} onChange={(e) => setMine(e.target.value)} data-testid="my-list">{listOptions}</select>
        </label>
        <label className="field">
          Opponent list <select value={theirs} onChange={(e) => setTheirs(e.target.value)} data-testid="their-list">{listOptions}</select>
        </label>
        <label className="field">
          Scenario{' '}
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} data-testid="game-scenario">
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          Opponent <select disabled value="hotseat"><option value="hotseat">Hotseat (you play both sides); computer opponent arrives in M6</option></select>
        </label>
        <label className="field small">
          Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) >>> 0)} />
        </label>
        <p className="meta">The seed makes every die in the game replayable.</p>
      </div>
      <div className="card">
        <h3>Sides</h3>
        {!roll ? (
          <button type="button" onClick={doRoll} data-testid="roll-sides">Roll off for sides</button>
        ) : (
          <>
            <p data-testid="rolloff-result">
              {roll.rolls.map(([a, b], i) => (
                <span key={i}>You rolled {a}, opponent rolled {b}{i < roll.rolls.length - 1 ? ' (tie, re-roll); ' : '. '}</span>
              ))}
              <strong>{roll.winner === 'you' ? 'You win' : 'Your opponent wins'}</strong> (lowest wins, core p.10) and chooses a side.
            </p>
            <div className="actions">
              <button type="button" onClick={() => start('P1')} data-testid="choose-p1">You are Player 1 (bottom edge)</button>
              <button type="button" onClick={() => start('P2')} className="secondary" data-testid="choose-p2">You are Player 2 (top edge)</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
