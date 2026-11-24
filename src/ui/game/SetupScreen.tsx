import { useEffect, useMemo, useState } from 'react';
import { createGame, rollOff, type GameEvent } from '../../engine/game';
import type { PlayerId } from '../../engine/model/types';
import { createRng } from '../../engine/rng';
import syntheticList from '../../import/__fixtures__/synthetic-list.txt?raw';
import { parseArmyList } from '../../import/parseList';
import type { ArmyList } from '../../import/types';
import { SCENARIOS } from '../../scenarios';
import { deleteGame, listGames, listLists, newId, type SavedGame, type SavedList } from '../../storage/db';
import { replay, type GameSession } from './useGame';
import { LAYOUTS, terrainFor, type TerrainChoice } from '../../engine/terrainLayouts';
import { ScenarioMap } from '../ScenarioPreview';
import type { ScenarioDef } from '../../scenarios/types';
import { useConfirm } from '../shell/overlay';

const DEMO_ID = 'demo';


export interface NewGame {
  id: string;
  createdAt: string;
  session: GameSession;
  /** Which side the human plays ("hotseat" controls both). */
  you: PlayerId;
  mode: 'hotseat' | 'ai';
}

export function resumeGame(g: SavedGame): NewGame {
  return { id: g.id, createdAt: g.createdAt, you: g.you, mode: g.mode ?? 'hotseat', session: replay(g.initial, g.initialRng, g.initialEvents, g.actions) };
}

export function SetupScreen({ onStart }: { onStart: (g: NewGame) => void }) {
  const [saved, setSaved] = useState<SavedList[]>([]);
  const [mine, setMine] = useState(DEMO_ID);
  const [theirs, setTheirs] = useState(DEMO_ID);
  const [scenarioId, setScenarioId] = useState('forlorn-hope');
  const [mode, setMode] = useState<'ai' | 'hotseat'>('ai');
  const [seed, setSeed] = useState(() => (Date.now() >>> 0) % 1_000_000);
  const [roll, setRoll] = useState<{ winner: 'you' | 'opponent'; rolls: [number, number][] } | null>(null);
  const [games, setGames] = useState<SavedGame[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Terrain: the scenario's own 2026 layout (or a random one for pack scenarios), any layout, random, or none.
  const [terrainSel, setTerrainSel] = useState<string>('scenario');
  const [terrainSeed, setTerrainSeed] = useState(() => ((Date.now() >>> 0) % 100_000) + 1);

  useEffect(() => {
    listLists().then(setSaved).catch(() => setSaved([]));
    listGames().then(setGames).catch(() => setGames([]));
  }, []);

  const getList = (id: string): ArmyList => (id === DEMO_ID ? parseArmyList(syntheticList) : saved.find((s) => s.id === id)!.list);

  const doRoll = () => {
    const r = rollOff(createRng(seed));
    // In the roll-off result P1 = you, P2 = opponent (the real sides are chosen next).
    setRoll({ winner: r.winner === 'P1' ? 'you' : 'opponent', rolls: r.rolls });
  };

  const baseScenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const terrainChoice: TerrainChoice = useMemo(
    () =>
      terrainSel === 'none'
        ? { mode: 'none' }
        : terrainSel === 'random' || (terrainSel === 'scenario' && !baseScenario.defaultTerrain)
          ? { mode: 'random', seed: terrainSeed }
          : { mode: 'layout', id: terrainSel === 'scenario' ? baseScenario.defaultTerrain! : terrainSel },
    [terrainSel, terrainSeed, baseScenario],
  );
  const terrain = useMemo(() => terrainFor(baseScenario, terrainChoice), [baseScenario, terrainChoice]);
  const scenarioWithTerrain: ScenarioDef = { ...baseScenario, terrain: terrain.pieces, terrainLayout: terrain.name };

  const start = (youAre: PlayerId) => {
    const scenario = scenarioWithTerrain;
    const lists = youAre === 'P1' ? { P1: getList(mine), P2: getList(theirs) } : { P1: getList(theirs), P2: getList(mine) };
    const g = createGame({ seed, scenario, lists });
    const rollText = roll!.rolls.map(([a, b]) => `you ${a}, opponent ${b}`).join('; then ');
    const initialEvents: GameEvent[] = [
      ...g.events,
      { type: 'rolloff', text: `Roll-off for sides (lowest wins): ${rollText}. ${roll!.winner === 'you' ? 'You win' : 'Opponent wins'}; you are ${youAre} (${youAre === 'P1' ? 'bottom' : 'top'} edge).`, round: 1 },
    ];
    onStart({
      id: newId(),
      createdAt: new Date().toISOString(),
      session: { initial: g.state, initialRng: g.rng, initialEvents, state: g.state, rng: g.rng, actions: [], events: initialEvents, last: null },
      you: youAre,
      mode,
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

  const confirm = useConfirm();
  const importFile = async (f: File) => {
    try {
      const g = JSON.parse(await f.text()) as SavedGame;
      if (!g.initial || !g.actions) throw new Error('not a Conquest Sim game file');
      onStart(resumeGame({ ...g, id: g.id ?? newId() }));
    } catch (e) {
      setLoadError(`Could not load ${f.name}: ${String(e)}`);
    }
  };

  return (
    <section>
      {(
        <div className="card">
          <h3>Saved games</h3>
          {games.length === 0 && <p className="meta">Games are saved on this device automatically after every action.</p>}
          <ul className="plain saved">
            {games.map((g) => (
              <li key={g.id}>
                <button type="button" className="link" onClick={() => onStart(resumeGame(g))} data-testid="resume-game">
                  {g.name}
                </button>{' '}
                <span className="meta">
                  Round {Math.min(g.round, g.initial.scenario.rounds)} · {g.vp.P1}–{g.vp.P2}
                  {g.ended ? ' · finished' : ''} · {new Date(g.savedAt).toLocaleString()}
                </span>{' '}
                <button type="button" className="secondary small" onClick={() => confirm.ask({ title: 'Delete saved battle?', body: `${g.name} will be removed from this device.`, confirmLabel: 'Delete', danger: true }, () => { void deleteGame(g.id).then(listGames).then(setGames); })}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
          <label className="file meta">
            Load a game file (.json){' '}
            <input type="file" accept=".json,application/json" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          </label>
          {loadError && <p className="warn">{loadError}</p>}
        </div>
      )}
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
          Terrain{' '}
          <select value={terrainSel} onChange={(e) => setTerrainSel(e.target.value)} data-testid="terrain">
            <option value="scenario">{baseScenario.defaultTerrain ? 'Scenario layout (2026)' : 'Random layout'}</option>
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>{l.name} layout</option>
            ))}
            <option value="random">Random layout</option>
            <option value="none">No terrain</option>
          </select>
          {terrainChoice.mode === 'random' && (
            <button type="button" className="secondary small" onClick={() => setTerrainSeed((terrainSeed % 99_991) + 7)} data-testid="reroll-terrain">
              Randomise again
            </button>
          )}
        </label>
        <div className="setup-preview" data-testid="terrain-preview">
          <ScenarioMap s={scenarioWithTerrain} />
          <p className="meta">
            {terrain.name}: {terrain.pieces.length} pieces, mirrored for both sides, at least 9″ apart, no Impassable piece on an objective (pack p.3; 2026 scenarios). Hover a piece for its rules.
          </p>
        </div>
        <label className="field">
          Opponent{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as 'ai' | 'hotseat')} data-testid="mode">
            <option value="ai">Computer</option>
            <option value="hotseat">Hotseat (you play both sides)</option>
          </select>
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
      {confirm.dialog}
    </section>
  );
}
