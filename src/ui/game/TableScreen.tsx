import { useMemo, useState } from 'react';
import {
  attachedCharacter,
  describeMoves,
  distancePolys,
  entryPose,
  formationInput,
  marchAllowance,
  marchValue,
  reformResult,
  regimentPolys,
  regimentStandCount,
  reinforcementLineNow,
  validate,
  type Action,
} from '../../engine/game';
import { clampFiles, footprint, legalFiles } from '../../engine/formation';
import { dist, dot, type Vec } from '../../engine/geometry/vec';
import { applyPath, parseMoveText, pathCost, type MoveSeg } from '../../engine/movement';
import type { Edge, Pose, RegimentState } from '../../engine/model/types';
import { TableView, type Ghost, type Ruler } from './TableView';
import { useGame, type GameSession } from './useGame';

type Mode = 'select' | 'march' | 'enter' | 'reform' | 'ruler' | 'override';

const deg = (d: number) => (d * Math.PI) / 180;
const fmt = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)}″`;

export function TableScreen({ start, onQuit }: { start: GameSession; onQuit: () => void }) {
  const { session, dispatch, undo, error, setError } = useGame(start);
  const s = session.state;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('select');
  const [moves, setMoves] = useState<MoveSeg[]>([]);
  const [moveText, setMoveText] = useState('');
  const [entry, setEntry] = useState<{ edge: Edge; along: number; files: number }>({ edge: 'bottom', along: 36, files: 2 });
  const [reform, setReform] = useState<{ files: number; rot: number }>({ files: 2, rot: 0 });
  const [overridePose, setOverridePose] = useState<Pose | null>(null);
  const [ruler, setRuler] = useState<{ a?: Vec; aReg?: string; result?: Ruler } | null>(null);
  const [drag, setDrag] = useState<{ start: Vec; base: MoveSeg[] | Pose } | null>(null);

  const sel: RegimentState | null = selectedId ? (s.regiments[selectedId] ?? null) : null;
  const active = s.activation ? s.regiments[s.activation.regimentId]! : null;

  const resetModes = () => {
    setMode('select');
    setMoves([]);
    setMoveText('');
    setOverridePose(null);
    setDrag(null);
  };

  const run = (a: Action) => {
    if (dispatch(a)) {
      resetModes();
      return true;
    }
    return false;
  };

  // ------------------------------------------------ draft action and ghost
  const draft = useMemo((): { action: Action; ghost: Ghost; cost?: number; allowance?: number } | null => {
    if (!sel) return null;
    if (mode === 'march') {
      const fi = formationInput(s, sel);
      const width = footprint(fi).halfWidth * 2;
      const pose = applyPath(sel.pose, moves, width);
      const action: Action = { type: 'march', regimentId: sel.id, moves };
      return { action, ghost: { polys: regimentPolys(s, sel, { pose }), valid: moves.length > 0 && validate(s, action).ok }, cost: pathCost(moves, width), allowance: marchAllowance(s, sel) };
    }
    if (mode === 'enter') {
      const files = clampFiles(regimentStandCount(s, sel), entry.files);
      const startPose = entryPose(s, entry.edge, entry.along);
      const width = footprint(formationInput(s, sel, { files, pose: startPose })).halfWidth * 2;
      const pose = applyPath(startPose, moves, width);
      const action: Action = { type: 'enter', regimentId: sel.id, edge: entry.edge, along: entry.along, files, moves };
      return { action, ghost: { polys: regimentPolys(s, sel, { pose, files }), valid: validate(s, action).ok }, cost: pathCost(moves, width), allowance: marchAllowance(s, sel) };
    }
    if (mode === 'reform') {
      const files = clampFiles(regimentStandCount(s, sel), reform.files);
      const action: Action = { type: 'reform', regimentId: sel.id, files, rotation: deg(reform.rot) };
      const res = reformResult(s, sel, files, deg(reform.rot));
      return { action, ghost: { polys: regimentPolys(s, sel, { pose: res.pose, files }), valid: validate(s, action).ok } };
    }
    if (mode === 'override' && overridePose) {
      const action: Action = { type: 'override.move', regimentId: sel.id, pose: overridePose, reason: 'moved by hand' };
      return { action, ghost: { polys: regimentPolys(s, sel, { pose: overridePose }), valid: true } };
    }
    return null;
  }, [s, sel, mode, moves, entry, reform, overridePose]);

  const draftProblems = draft && mode !== 'override' ? validate(s, draft.action) : null;

  // ------------------------------------------------ table interaction
  const onRegimentDown = (id: string, p: Vec) => {
    if (mode === 'ruler') {
      rulerTap(p, id);
      return;
    }
    if ((mode === 'march' || mode === 'enter') && id === selectedId) {
      const base = moves.length && moves[moves.length - 1]!.kind === 'forward' ? moves.slice(0, -1) : moves;
      setDrag({ start: p, base });
      return;
    }
    if (mode === 'override' && id === selectedId) {
      setDrag({ start: p, base: overridePose ?? sel!.pose });
      return;
    }
    if (mode === 'select') setSelectedId(id);
  };

  const onDrag = (p: Vec) => {
    if (!drag || !sel) return;
    if (mode === 'override') {
      const b = drag.base as Pose;
      setOverridePose({ ...b, x: b.x + p.x - drag.start.x, y: b.y + p.y - drag.start.y });
      return;
    }
    const base = drag.base as MoveSeg[];
    const width = footprint(formationInput(s, sel, mode === 'enter' ? { files: entry.files } : {})).halfWidth * 2;
    const from = mode === 'enter' ? entryPose(s, entry.edge, entry.along) : sel.pose;
    const pose = applyPath(from, base, width);
    const fwd = { x: Math.cos(pose.angle), y: Math.sin(pose.angle) };
    const d = Math.max(0, dot({ x: p.x - drag.start.x, y: p.y - drag.start.y }, fwd));
    setMoves([...base, { kind: 'forward', d: Math.round(d * 10) / 10 }]);
  };

  const rulerTap = (p: Vec, regimentId?: string) => {
    if (!ruler?.a || ruler.result) {
      setRuler({ a: p, ...(regimentId ? { aReg: regimentId } : {}) });
      return;
    }
    const a = ruler.a;
    if (ruler.aReg && regimentId && regimentId !== ruler.aReg) {
      // Regiment to Regiment, edge to edge (core p.10).
      const pa = regimentPolys(s, s.regiments[ruler.aReg]!);
      const pb = regimentPolys(s, s.regiments[regimentId]!);
      const d = distancePolys(pa, pb);
      const [ca, cb] = closestPoints(pa, pb);
      setRuler({ a, result: { a: ca, b: cb, label: `${fmt(d)} edge to edge` } });
    } else setRuler({ a, result: { a, b: p, label: fmt(dist(a, p)) } });
  };

  const onTap = (p: Vec) => {
    if (mode === 'ruler') return rulerTap(p);
    if (mode === 'enter' && sel) {
      // Tap near an edge to choose the entry point.
      const { width: W, height: H } = s.scenario.table;
      const options: [Edge, number, number][] = [
        ['bottom', p.y, p.x],
        ['top', H - p.y, p.x],
        ['left', p.x, p.y],
        ['right', W - p.x, p.y],
      ];
      const [edge, , along] = options.sort((a, b) => a[1] - b[1])[0]!;
      setEntry({ ...entry, edge, along: Math.round(along * 4) / 4 });
      return;
    }
    if (mode === 'select') setSelectedId(null);
  };

  // ------------------------------------------------ move helpers
  const nudgeForward = (k: number) => {
    const last = moves[moves.length - 1];
    if (last?.kind === 'forward') setMoves([...moves.slice(0, -1), { kind: 'forward', d: Math.max(0, Math.round((last.d + k) * 10) / 10) }]);
    else if (k > 0) setMoves([...moves, { kind: 'forward', d: k }]);
  };
  const addWheel = (pivot: 'left' | 'right', degrees: number) => {
    const last = moves[moves.length - 1];
    if (last?.kind === 'wheel' && last.pivot === pivot) {
      const angle = last.angle + deg(degrees);
      setMoves(angle <= 1e-9 ? moves.slice(0, -1) : [...moves.slice(0, -1), { kind: 'wheel', pivot, angle }]);
    } else if (degrees > 0) setMoves([...moves, { kind: 'wheel', pivot, angle: deg(degrees) }]);
  };

  const beginEnter = (r: RegimentState) => {
    const own = s.scenario.reinforcementZones[r.owner];
    setEntry({ edge: own, along: s.scenario.table.width / 2, files: r.files });
    setMoves([{ kind: 'forward', d: Math.min(marchValue(s, r), 3) }]);
    setMode('enter');
  };

  // ------------------------------------------------ entry edge highlight
  const highlightEdges = useMemo(() => {
    if (mode !== 'enter' || !sel) return undefined;
    const { width: W, height: H } = s.scenario.table;
    const line = reinforcementLineNow(s, sel.owner);
    const own = s.scenario.reinforcementZones[sel.owner];
    const out: { a: Vec; b: Vec; ok: boolean }[] = [];
    if (own === 'bottom') out.push({ a: { x: 0, y: 0 }, b: { x: W, y: 0 }, ok: true });
    else out.push({ a: { x: 0, y: H }, b: { x: W, y: H }, ok: true });
    if (line > 0) {
      const [y0, y1] = own === 'bottom' ? [0, line] : [H - line, H];
      out.push({ a: { x: 0, y: y0 }, b: { x: 0, y: y1 }, ok: true }, { a: { x: W, y: y0 }, b: { x: W, y: y1 }, ok: true });
    }
    return out;
  }, [mode, sel, s]);

  // ------------------------------------------------ render
  const reserves = Object.values(s.regiments).filter((r) => r.location === 'reserve' || r.location === 'arriving');
  const characters = Object.values(s.characters);

  return (
    <section className="game-screen">
      <div className="topbar">
        <strong>
          {s.scenario.name} · Round {Math.min(s.round, s.scenario.rounds)}/{s.scenario.rounds}
        </strong>
        <span className="meta">
          {s.phase === 'setup' ? 'Setup' : s.phase === 'ended' ? 'Game over' : active ? `Active: ${active.name}` : 'Choose a Regiment to activate'}
        </span>
        <div className="actions">
          <button type="button" className={`secondary small ${mode === 'ruler' ? 'on' : ''}`} onClick={() => { resetModes(); setRuler(null); setMode(mode === 'ruler' ? 'select' : 'ruler'); }} data-testid="ruler">
            Ruler
          </button>
          <button type="button" className="secondary small" onClick={() => { resetModes(); undo(); }} disabled={session.actions.length === 0} data-testid="undo">
            Undo
          </button>
          {s.phase === 'play' && (
            <button type="button" className="small" onClick={() => run({ type: 'endRound' })} disabled={!!s.activation} data-testid="end-round">
              End Round
            </button>
          )}
          <button type="button" className="secondary small" onClick={() => confirm('Leave this game? It is not saved yet (saving arrives in M5).') && onQuit()}>
            Quit
          </button>
        </div>
      </div>

      <TableView
        state={s}
        selectedId={selectedId}
        ghost={draft?.ghost ?? null}
        ruler={ruler?.result ?? (ruler?.a ? { a: ruler.a, b: ruler.a, label: 'tap a second point or Regiment' } : null)}
        highlightEdges={highlightEdges}
        onRegimentDown={onRegimentDown}
        onTap={onTap}
        onDrag={onDrag}
        onDragEnd={() => setDrag(null)}
        dragging={!!drag}
      />

      {error && (
        <div className="warn card" role="alert" data-testid="error">
          {error.map((e, i) => <p key={i}>{e}</p>)}
          <button type="button" className="secondary small" onClick={() => setError(null)}>OK</button>
        </div>
      )}

      {mode === 'ruler' && <p className="meta">Ruler: tap two points, or tap two Regiments for the edge-to-edge distance.</p>}

      {s.phase === 'setup' && (
        <div className="card">
          <h3>Attach Characters (core p.20)</h3>
          {characters.map((c) => {
            const eligible = Object.values(s.regiments).filter((r) => r.owner === c.id.slice(0, 2) && r.warband === c.warband && r.type === c.type);
            return (
              <label key={c.id} className="field">
                {c.id.slice(0, 2)} {c.name}{c.isWarlord ? ' (Warlord)' : ''}:{' '}
                <select value={c.attachedTo ?? ''} onChange={(e) => dispatch({ type: 'attachCharacter', characterId: c.id, regimentId: e.target.value })}>
                  {!c.attachedTo && <option value="">— none eligible —</option>}
                  {eligible.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </label>
            );
          })}
          <button type="button" onClick={() => run({ type: 'startBattle' })} data-testid="start-battle">Start battle</button>
        </div>
      )}

      {sel && (
        <div className="card regiment-card" data-testid="regiment-card">
          <h3>
            <span className="swatch" style={{ background: sel.owner === 'P1' ? '#c0533f' : '#3f67b5' }} /> {sel.owner} {sel.name}
          </h3>
          <p className="meta">
            {sel.type} · {sel.cls} · {sel.stands.length}/{sel.startingStands} Stands{attachedCharacter(s, sel.id) ? ` + ${attachedCharacter(s, sel.id)!.name}` : ''} · M {marchValue(s, sel)} · {sel.files} files ·{' '}
            {sel.location}{sel.activatedThisRound ? ' · activated' : ''}
          </p>

          {mode === 'select' && s.phase === 'play' && (
            <div className="actions wrap">
              {!s.activation && !sel.activatedThisRound && (sel.location === 'table' || sel.location === 'arriving') && (
                <button type="button" onClick={() => run({ type: 'activate', regimentId: sel.id })} data-testid="activate">Activate</button>
              )}
              {s.activation?.regimentId === sel.id && (
                <>
                  {sel.location === 'arriving' ? (
                    <button type="button" onClick={() => beginEnter(sel)} data-testid="march-on">March on</button>
                  ) : (
                    <>
                      <button type="button" onClick={() => setMode('march')} data-testid="march">March</button>
                      <button type="button" onClick={() => { setReform({ files: sel.files, rot: 0 }); setMode('reform'); }} data-testid="reform">Reform</button>
                    </>
                  )}
                  <button type="button" className="secondary" onClick={() => run({ type: 'pass' })}>Pass</button>
                  <button type="button" className="secondary" onClick={() => run({ type: 'endActivation' })} data-testid="end-activation">End activation</button>
                  <span className="meta">Actions used: {s.activation.actions.length}/2</span>
                </>
              )}
              {sel.location === 'table' && (
                <button type="button" className="secondary" onClick={() => { setOverridePose(sel.pose); setMode('override'); }}>Move by hand</button>
              )}
            </div>
          )}

          {(mode === 'march' || mode === 'enter') && draft && (
            <div className="move-panel">
              {mode === 'enter' && (
                <>
                  <p className="meta">Tap near a table edge to choose where the front edge starts, then set the move.</p>
                  <div className="row">
                    <label className="field small">Edge <select value={entry.edge} onChange={(e) => setEntry({ ...entry, edge: e.target.value as Edge })}>
                      {(['bottom', 'top', 'left', 'right'] as const).map((e) => <option key={e} value={e}>{e}</option>)}
                    </select></label>
                    <label className="field small">Along <input type="number" step={0.5} value={entry.along} onChange={(e) => setEntry({ ...entry, along: Number(e.target.value) })} /></label>
                    <label className="field small">Files <select value={entry.files} onChange={(e) => setEntry({ ...entry, files: Number(e.target.value) })}>
                      {legalFiles(regimentStandCount(s, sel)).map((f) => <option key={f} value={f}>{f}</option>)}
                    </select></label>
                  </div>
                </>
              )}
              <p data-testid="move-budget">
                Move: <strong>{fmt(draft.cost ?? 0)}</strong> of {fmt(draft.allowance ?? 0)} · remaining{' '}
                <strong>{fmt(Math.max(0, (draft.allowance ?? 0) - (draft.cost ?? 0)))}</strong>
              </p>
              <p className="meta">{moves.length ? describeMoves(moves) : 'Drag the Regiment forward, or use the buttons or text below.'}</p>
              <div className="actions wrap">
                <button type="button" className="secondary small" onClick={() => nudgeForward(-1)}>−1″</button>
                <button type="button" className="secondary small" onClick={() => nudgeForward(-0.1)}>−0.1″</button>
                <button type="button" className="secondary small" onClick={() => nudgeForward(0.1)}>+0.1″</button>
                <button type="button" className="secondary small" onClick={() => nudgeForward(1)}>+1″</button>
                <button type="button" className="secondary small" onClick={() => addWheel('left', 15)}>↺ wheel L 15°</button>
                <button type="button" className="secondary small" onClick={() => addWheel('right', 15)}>↻ wheel R 15°</button>
                <button type="button" className="secondary small" onClick={() => addWheel('left', -5)}>L −5°</button>
                <button type="button" className="secondary small" onClick={() => addWheel('right', -5)}>R −5°</button>
                {mode === 'march' && (
                  <>
                    <button type="button" className="secondary small" onClick={() => setMoves([{ kind: 'sideways', d: -1 }])}>← side</button>
                    <button type="button" className="secondary small" onClick={() => setMoves([{ kind: 'sideways', d: 1 }])}>side →</button>
                    <button type="button" className="secondary small" onClick={() => setMoves([{ kind: 'backward', d: 1 }])}>back</button>
                  </>
                )}
                <button type="button" className="secondary small" onClick={() => setMoves([])}>Clear</button>
              </div>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const m = parseMoveText(moveText);
                  if (m) {
                    setMoves(m);
                    setError(null);
                  } else setError(['Could not read that move. Examples: "forward 5.5", "wheel 30 left, f 4", "side 2 left", "back 3".']);
                }}
              >
                <input className="grow" placeholder='e.g. "wheel 30 left, forward 4"' value={moveText} onChange={(e) => setMoveText(e.target.value)} data-testid="move-text" />
                <button type="submit" className="secondary small">Set</button>
              </form>
              <Problems v={draftProblems} />
              <div className="actions">
                <button type="button" disabled={!draft.ghost.valid} onClick={() => run(draft.action)} data-testid="commit-move">
                  {mode === 'enter' ? 'March on' : 'March'}
                </button>
                <button type="button" className="secondary" onClick={resetModes}>Cancel</button>
              </div>
            </div>
          )}

          {mode === 'reform' && draft && (
            <div className="move-panel">
              <div className="row">
                <label className="field small">Files <select value={reform.files} onChange={(e) => setReform({ ...reform, files: Number(e.target.value) })} data-testid="reform-files">
                  {legalFiles(regimentStandCount(s, sel)).map((f) => <option key={f} value={f}>{f}</option>)}
                </select></label>
                <label className="field">Turn {reform.rot}°
                  <input type="range" min={-180} max={180} step={5} value={reform.rot} onChange={(e) => setReform({ ...reform, rot: Number(e.target.value) })} />
                </label>
              </div>
              <div className="actions wrap">
                {[-90, 90, 180].map((d) => (
                  <button key={d} type="button" className="secondary small" onClick={() => setReform({ ...reform, rot: d })}>{d > 0 ? `+${d}` : d}°</button>
                ))}
              </div>
              <Problems v={draftProblems} />
              <div className="actions">
                <button type="button" disabled={!draft.ghost.valid} onClick={() => run(draft.action)} data-testid="commit-reform">Reform</button>
                <button type="button" className="secondary" onClick={resetModes}>Cancel</button>
              </div>
            </div>
          )}

          {mode === 'override' && overridePose && (
            <div className="move-panel">
              <p className="warn">Manual override: drag the Regiment anywhere and turn it. This is logged as an override.</p>
              <label className="field">Facing {Math.round((overridePose.angle * 180) / Math.PI)}°
                <input type="range" min={-180} max={180} step={1} value={Math.round((overridePose.angle * 180) / Math.PI)} onChange={(e) => setOverridePose({ ...overridePose, angle: deg(Number(e.target.value)) })} />
              </label>
              <div className="actions">
                <button type="button" onClick={() => run(draft!.action)}>Place here</button>
                <button type="button" className="secondary" onClick={resetModes}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {s.phase === 'play' && reserves.length > 0 && (
        <div className="card">
          <h3>Reinforcements</h3>
          <p className="meta">Reinforcement rolls arrive in M4; for now choose who arrives. Reinforcement Line: P1 {fmt(reinforcementLineNow(s, 'P1'))}, P2 {fmt(reinforcementLineNow(s, 'P2'))} from their edges.</p>
          <ul className="plain">
            {reserves.map((r) => (
              <li key={r.id} className="reserve-row">
                <button type="button" className="link" onClick={() => setSelectedId(r.id)}>{r.owner} {r.name}</button>{' '}
                <span className="meta">{r.cls}{r.activatedThisRound ? ' · activated' : ''}</span>{' '}
                <label>
                  <input
                    type="checkbox"
                    checked={r.location === 'arriving'}
                    disabled={r.activatedThisRound}
                    onChange={(e) => dispatch({ type: 'setArriving', regimentId: r.id, arriving: e.target.checked })}
                    data-testid={`arrive-${r.id}`}
                  />{' '}
                  arriving
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="card log" open>
        <summary>Log ({session.events.length})</summary>
        <ol reversed data-testid="log">
          {[...session.events].reverse().slice(0, 60).map((e, i) => (
            <li key={i} className={e.override ? 'override' : ''}>
              <span className="meta">R{e.round}</span> {e.text}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function Problems({ v }: { v: ReturnType<typeof validate> | null }) {
  if (!v || v.ok) return null;
  return (
    <ul className="warn problems">
      {v.reasons.map((r, i) => (
        <li key={i}>{r}</li>
      ))}
    </ul>
  );
}

function closestPoints(a: readonly (readonly Vec[])[], b: readonly (readonly Vec[])[]): [Vec, Vec] {
  // Approximate: closest pair of vertices/edge samples for display only (the distance shown is exact).
  let best: [Vec, Vec] = [a[0]![0]!, b[0]![0]!];
  let bd = Infinity;
  const samples = (polys: readonly (readonly Vec[])[]) =>
    polys.flatMap((p) => p.flatMap((q, i) => {
      const r = p[(i + 1) % p.length]!;
      return Array.from({ length: 11 }, (_, k) => ({ x: q.x + ((r.x - q.x) * k) / 10, y: q.y + ((r.y - q.y) * k) / 10 }));
    }));
  const sa = samples(a);
  const sb = samples(b);
  for (const p of sa) for (const q of sb) {
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = [p, q];
    }
  }
  return best;
}
