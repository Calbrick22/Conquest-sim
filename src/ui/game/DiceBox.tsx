import { useEffect, useState } from 'react';
import type { RollStep } from './rolls';

/**
 * The dice box: plays the rolls of the last Action one by one. Each roll tumbles, then settles on
 * the engine's seeded result, with passing dice highlighted and the outcome underneath. When a roll
 * belongs to the player (their Defence or Morale against the other side), it waits for them to roll
 * it. The results themselves come from the engine's seeded dice, so a saved game replays exactly.
 */
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
  mustRoll: (s: RollStep) => boolean;
  reduceMotion: boolean;
  onDone: (stamp: number) => void;
}) {
  const [cur, setCur] = useState(0);
  const [phase, setPhase] = useState<'waiting' | 'rolling' | 'shown'>('waiting');
  const [faces, setFaces] = useState<number[]>([]);
  const tumble = reduceMotion ? 0 : 650;
  const hold = reduceMotion ? 250 : 750;

  const step = steps[cur];
  // Start each roll by itself unless the player rolls it; report when every roll is shown.
  useEffect(() => {
    if (cur >= steps.length) {
      onDone(stamp);
      return;
    }
    if (phase !== 'waiting' || mustRoll(steps[cur]!)) return;
    const t = setTimeout(() => setPhase('rolling'), 0);
    return () => clearTimeout(t);
  }, [cur, phase, steps, mustRoll, onDone, stamp]);

  // Tumbling faces, then the real result, then the next roll.
  useEffect(() => {
    if (!step) return;
    if (phase === 'rolling') {
      const spin = tumble ? setInterval(() => setFaces(step.values.map(() => 1 + Math.floor(Math.random() * 6))), 70) : undefined;
      const stop = setTimeout(() => setPhase('shown'), tumble);
      return () => {
        if (spin) clearInterval(spin);
        clearTimeout(stop);
      };
    }
    if (phase === 'shown') {
      const t = setTimeout(() => {
        setCur((c) => c + 1);
        setPhase('waiting');
      }, hold);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase, step, tumble, hold]);

  // Once every roll is shown, the box fades away after a moment so it does not cover the table.
  const [gone, setGone] = useState(false);
  const finished = cur >= steps.length;
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => setGone(true), reduceMotion ? 1200 : 2500);
    return () => clearTimeout(t);
  }, [finished, reduceMotion]);
  if (!steps.length || gone) return null;
  const done = cur >= steps.length;
  const show = done ? steps[steps.length - 1]! : step!;
  const values = phase === 'rolling' && !done ? faces : show.values;
  const settled = done || phase === 'shown';
  const waitingForPlayer = !done && phase === 'waiting' && mustRoll(show);
  const label = show.kind === 'hit' ? 'To hit' : show.kind === 'save' ? 'Defence' : show.kind === 'morale' ? 'Morale' : 'Roll';
  return (
    <div className={`dice-box ${show.kind}`} data-testid="dice-box" aria-live="polite">
      <div className="dice-box-head">
        <span className="dice-kind">{label}</span>
        <span className="dice-title">{show.title.replace(/: (Defense|Morale|Duel Defense|Duel Resolve)$/, '')}</span>
        <span className="meta">
          {Math.min(cur + 1, steps.length)}/{steps.length}
        </span>
      </div>
      <div className={`dice-box-tray ${phase === 'rolling' && !done ? 'tumbling' : ''}`}>
        {waitingForPlayer
          ? show.values.map((_, i) => <span key={i} className="die blank">?</span>)
          : values.length
            ? values.map((v, i) => (
                <span key={i} className={`die ${settled ? (show.pass[i] ? 'pass' : 'fail') : ''}`}>
                  {v}
                </span>
              ))
            : <span className="meta">no dice: automatic</span>}
      </div>
      <div className="dice-box-foot">
        {waitingForPlayer ? (
          <button type="button" className="roll-btn" onClick={() => setPhase('rolling')} data-testid="roll-dice">
            Roll {show.values.length} {label} dice{show.need !== null ? ` (need ${show.need} or less)` : ''}
          </button>
        ) : settled ? (
          <strong className="dice-outcome">{show.outcome}</strong>
        ) : (
          <span className="meta">Rolling{show.need !== null ? `, need ${show.need} or less` : ''}…</span>
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
