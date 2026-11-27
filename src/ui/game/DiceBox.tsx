import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { RollStep } from './rolls';

/**
 * The dice box: plays the rolls of the last Action one by one. The right number of dice wait in
 * the tray and nothing happens until the player presses Roll (for every roll, the computer's too,
 * unless the setting is off). Then the dice are thrown: each tumbles, bounces, slows and settles on its own, and once all have landed the
 * passing dice are highlighted with the outcome underneath. The results come from the engine's seeded dice, so a saved game replays exactly.
 */

/** Pip positions on a 3×3 grid for each face. */
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function Die({ v, cls, style }: { v: number | null; cls?: string; style?: CSSProperties }) {
  return (
    <span className={`pip-die ${cls ?? ''}`} style={style} role="img" aria-label={v ? String(v) : 'die'}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`dpip ${v && PIPS[v]!.includes(i) ? "on" : ""}`} />
      ))}
    </span>
  );
}

/** Small seeded wobble so the resting dice and the throw differ from roll to roll. */
const wobble = (i: number, k: number) => {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function DiceBox({
  steps,
  stamp,
  mustRoll,
  reduceMotion,
  onDone,
}: {
  steps: RollStep[];
  /** The Action this playback belongs to (the parent keys the box on it, so a new Action restarts it). */
  stamp: number;
  /** Does this roll wait for the player's Roll button? */
  mustRoll: (s: RollStep) => boolean;
  reduceMotion: boolean;
  onDone: (stamp: number) => void;
}) {
  const [cur, setCur] = useState(0);
  const [phase, setPhase] = useState<'waiting' | 'rolling' | 'shown'>('waiting');
  const [faces, setFaces] = useState<number[]>([]);
  const [landed, setLanded] = useState<boolean[]>([]);
  const start = useRef(0);
  const step = steps[cur];
  const n = step?.values.length ?? 0;
  // Each die's own throw: how far it travels, how it spins and how long it takes to land.
  const throws = useMemo(
    () => Array.from({ length: n }, (_, i) => ({ dur: reduceMotion ? 0 : 900 + Math.round(wobble(i, cur + stamp) * 650), dx: -120 - wobble(i, 7 + cur) * 140, dy: -30 + wobble(i, 3 + cur) * 60, rot: 360 + Math.round(wobble(i, 5 + cur) * 540) })),
    [n, cur, stamp, reduceMotion],
  );

  // A roll that is not the player's is thrown by itself; report when every roll has been shown.
  useEffect(() => {
    if (cur >= steps.length) {
      onDone(stamp);
      return;
    }
    if (phase !== 'waiting' || mustRoll(steps[cur]!)) return;
    const t = setTimeout(() => throwDice(), reduceMotion ? 0 : 450);
    return () => clearTimeout(t);
  }, [cur, phase, steps, mustRoll, onDone, stamp, reduceMotion]); // eslint-disable-line react-hooks/exhaustive-deps

  function throwDice() {
    start.current = performance.now();
    setFaces(steps[cur]!.values.map(() => 1 + Math.floor(Math.random() * 6)));
    setLanded(steps[cur]!.values.map(() => false));
    setPhase('rolling');
  }

  // Tumbling: faces change quickly at first and slow down; each die lands at the end of its own throw.
  useEffect(() => {
    if (!step || phase !== 'rolling') return;
    const longest = Math.max(0, ...throws.map((t) => t.dur));
    const tick = setInterval(() => {
      const t = performance.now() - start.current;
      setFaces((f) => f.map((v, i) => (t >= throws[i]!.dur ? step.values[i]! : Math.random() < 1 - (t / throws[i]!.dur) * 0.8 ? 1 + Math.floor(Math.random() * 6) : v)));
      setLanded(throws.map((x) => t >= x.dur));
    }, 70);
    const stop = setTimeout(() => setPhase('shown'), longest + 250);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [phase, step, throws]);

  // A moment to read the result, then the next roll.
  useEffect(() => {
    if (phase !== 'shown') return;
    const t = setTimeout(() => {
      setCur((c) => c + 1);
      setPhase('waiting');
    }, reduceMotion ? 400 : 1300);
    return () => clearTimeout(t);
  }, [phase, reduceMotion]);

  // Once every roll is shown, the box fades away after a moment so it does not cover the table.
  const [gone, setGone] = useState(false);
  const finished = cur >= steps.length;
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => setGone(true), reduceMotion ? 1200 : 2500);
    return () => clearTimeout(t);
  }, [finished, reduceMotion]);
  if (!steps.length || gone) return null;
  const done = finished;
  const show = done ? steps[steps.length - 1]! : step!;
  const settled = done || phase === 'shown';
  const waiting = !done && phase === 'waiting';
  const yours = waiting && mustRoll(show);
  const label = show.kind === 'hit' ? 'To hit' : show.kind === 'save' ? 'Defence' : show.kind === 'morale' ? 'Morale' : 'Roll';
  return (
    <div className={`dice-box ${show.kind}`} data-testid="dice-box" aria-live="polite">
      <div className="dice-box-head">
        <span className="dice-kind">{label}</span>
        <span className="dice-title">{show.title.replace(/: (Defense|Morale|Duel Defense|Duel Resolve)$/, '').replace(/\s*\([^)]*\)/g, '').replace(/ to hit$/, '')}</span>
        <span className="meta">
          {Math.min(cur + 1, steps.length)}/{steps.length}
        </span>
      </div>
      <div className="dice-box-tray">
        {show.values.length === 0 ? (
          <span className="meta">no dice: automatic</span>
        ) : (
          show.values.map((v, i) => {
            const th = throws[i];
            if (waiting) return <Die key={i} v={null} cls="resting" style={{ transform: `rotate(${Math.round((wobble(i, 11) - 0.5) * 24)}deg)` }} />;
            if (!settled && th) {
              const vars = { '--dx': `${th.dx}px`, '--dy': `${th.dy}px`, '--rot': `${th.rot}deg`, '--dur': `${th.dur}ms` } as CSSProperties;
              return <Die key={i} v={faces[i] ?? v} cls={landed[i] ? 'landed' : 'thrown'} style={vars} />;
            }
            return <Die key={i} v={v} cls={`landed ${show.pass[i] ? 'pass' : 'fail'}`} />;
          })
        )}
      </div>
      <div className="dice-box-foot">
        {yours ? (
          <button type="button" className="roll-btn" onClick={throwDice} data-testid="roll-dice" autoFocus>
            Roll
          </button>
        ) : null}
        {waiting ? (
          <span className="meta">
            {show.values.length} {label} {show.values.length === 1 ? 'die' : 'dice'}
            {show.need !== null ? `, need ${show.need} or less` : ''}
          </span>
        ) : settled ? (
          <strong className="dice-outcome">{show.outcome}</strong>
        ) : (
          <span className="meta">Rolling…</span>
        )}
        {!done && (
          <button type="button" className="secondary small" onClick={() => { setCur(steps.length); onDone(stamp); }} data-testid="dice-skip">
            Skip
          </button>
        )}
      </div>
      {settled && show.notes.length > 0 && <div className="meta dice-notes">{show.notes.join(' · ')}</div>}
    </div>
  );
}
