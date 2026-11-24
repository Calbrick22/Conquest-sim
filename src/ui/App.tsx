import { useState } from 'react';
import { createRng, rollD6s, type RngState } from '../engine/rng';

const MILESTONES: { id: string; label: string; done: boolean }[] = [
  { id: 'M1', label: 'Skeleton, PWA, CI and deploy', done: true },
  { id: 'M2', label: 'Army list import and scenarios', done: false },
  { id: 'M3', label: 'Table and movement', done: false },
  { id: 'M4', label: 'Round loop and combat', done: false },
  { id: 'M5', label: 'Scoring, save and log', done: false },
  { id: 'M6', label: 'Computer opponent', done: false },
];

export function App() {
  const [rng, setRng] = useState<RngState>(() => createRng(Date.now() >>> 0));
  const [dice, setDice] = useState<number[]>([]);

  const roll = () => {
    const [vals, next] = rollD6s(rng, 6);
    setDice(vals);
    setRng(next);
  };

  return (
    <main className="app">
      <header>
        <h1>Conquest Sim</h1>
        <p className="sub">A personal battle simulator for Conquest: The Last Argument of Kings.</p>
      </header>

      <section className="card">
        <h2>Status</h2>
        <ul className="milestones">
          {MILESTONES.map((m) => (
            <li key={m.id} className={m.done ? 'done' : ''}>
              <span className="tag">{m.id}</span> {m.label}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Dice check</h2>
        <p>Rolls six seeded dice using the engine's random number generator.</p>
        <button type="button" onClick={roll} data-testid="roll">
          Roll 6 dice
        </button>
        <div className="dice" data-testid="dice" aria-live="polite">
          {dice.map((d, i) => (
            <span key={i} className="die">
              {d}
            </span>
          ))}
        </div>
        <p className="meta">
          Seed {rng.seed} · draw #{rng.index}
        </p>
      </section>

      <footer>
        Unofficial fan tool. No rules text is included; unit data is loaded from your own army list files.
      </footer>
    </main>
  );
}
