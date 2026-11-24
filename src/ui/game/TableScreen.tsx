import React, { useEffect, useMemo, useState } from 'react';
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
import { duelTargets, enemiesInContact, withdrawPose } from '../../engine/actions';
import { baseName, DRAW_EVENTS_AUTOMATED } from '../../engine/activation';
import { isEngaged } from '../../engine/queries';
import { barrageOf } from '../../engine/rules/special/rules';
import { DiceTray } from './DiceTray';
import { gameLogMarkdown } from '../../engine/log/markdown';
import { markerAttackProblems, markerInContact, MARKER_PREFIX } from '../../engine/markers';
import { saveGame } from '../../storage/db';
import { Scoreboard } from './Scoreboard';
import type { NewGame } from './SetupScreen';
import { ManualTools } from './ManualTools';
import { PhasePanel } from './PhasePanel';
import { ActionCallout, UnitCallout } from './Callouts';
import { DrawDeck, StackBuilder } from './CommandDeck';
import { OdActivation, PowerBar } from './OldDominionPanel';
import { isOdDrawEvent } from '../../engine/factions/oldDominionActions';
import { canInduceAggression, strainFor } from '../../engine/factions/spires';
import { PractitionerButtons } from './SpiresPanel';
import { usePreviews } from './usePreviews';
import { useAutoplay, wipedOut } from './useAutoplay';
import { EndGameSummary } from './EndGameSummary';
import { Hud } from './Hud';
import { Toasts } from './Toasts';
import { PauseMenu } from './PauseMenu';
import { Tooltip } from '../shell/Tooltip';
import { useConfirm, anyModalOpen } from '../shell/overlay';
import { useSettings } from '../shell/settings';
import { chargeBands, frontReachPolygon, maxReach } from '../../engine/reach';
import type { OutcomePreview } from '../../engine/preview';
import { volleyAimed, volleyLines } from '../../engine/actions';
import { decisionMaker } from '../../ai/ai';

/** Actions that get an on-table callout (and wait for "Next" when the computer took them). */
const CALLOUT_ACTIONS = new Set([
  'enter', 'march', 'reform', 'charge', 'volley', 'clash', 'withdraw', 'rally', 'combatRally', 'combatReform', 'takeAim', 'inspire',
  'placeCharge', 'failCharge', 'duel', 'reinforcements', 'supremacyRollOff', 'chooseFirst', 'pickZone', 'endRound', 'override.move',
  'drawEvent', 'spell', 'memories', 'odSpend', 'characterAbility', 'useSupremacy',
]);
/** Routine events that do not by themselves need a callout. */
const ROUTINE = new Set(['activate', 'deactivate', 'draw', 'ai', 'phase', 'stack', 'manual', 'attach']);
/**
 * Does the last Action get a callout? Always for the Actions above; for activating or ending an
 * Activation only when something happened (Aura of Death, Decay, Trample, Entourage…).
 */
export function showsCallout(type: string, events: { type: string }[]): boolean {
  if (CALLOUT_ACTIONS.has(type)) return true;
  if (type === 'activate' || type === 'endActivation' || type === 'activateCharacter' || type === 'setStack') return events.some((e) => !ROUTINE.has(e.type));
  return false;
}
import { TableView, type Ghost, type Ruler } from './TableView';
import { useAi } from './useAi';
import { useGame, type GameSession } from './useGame';

export type { GameSession };

type Mode = 'select' | 'march' | 'enter' | 'reform' | 'ruler' | 'override' | 'withdraw' | 'target' | 'placeCharge';
type TargetKind = 'charge' | 'volley' | 'clash' | 'Snapshot' | 'Mighty Swing';

const deg = (d: number) => (d * Math.PI) / 180;
const fmt = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)}″`;

export function TableScreen({ game, onQuit, onSettings }: { game: NewGame; onQuit: () => void; onSettings?: () => void }) {
  const { session, dispatch, undo, undoHuman, error, setError } = useGame(game.session);
  const aiPlayer = game.mode === 'ai' ? (game.you === 'P1' ? 'P2' : 'P1') : null;
  const [paused, setPaused] = useState(false);
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
  const [targetKind, setTargetKind] = useState<TargetKind>('charge');
  const [crFiles, setCrFiles] = useState(2);
  const [withdrawTurn, setWithdrawTurn] = useState(true);
  // Roadmap 2.2: the selected Regiment's Charge reach, and enemy threat ranges.
  const [showReach, setShowReach] = useState(false);
  const [showThreats, setShowThreats] = useState(false);

  // With nothing selected, the active Regiment is shown (e.g. after an Entourage Activation).
  const sel: RegimentState | null = selectedId ? (s.regiments[selectedId] ?? null) : s.activation ? (s.regiments[s.activation.regimentId] ?? null) : null;
  const active = s.activation ? s.regiments[s.activation.regimentId]! : null;
  // The computer waits for "Next" after each Action that gets a callout.
  const [ackedAt, setAckedAt] = useState(0);
  const lastAct = session.last?.action;
  const needsAck = !!aiPlayer && !!lastAct?.why && showsCallout(lastAct.type, session.last?.events ?? []) && ackedAt !== session.actions.length;
  const [closedCallout, setClosedCallout] = useState(-1);
  const [showUnit, setShowUnit] = useState(true);
  const [rulerMode, setRulerMode] = useState<'point' | 'regiment'>('point');
  // Once one side has nothing left, the rest of the game can be played out automatically.
  const auto = useAutoplay(s, dispatch);
  const wiped = (['P1', 'P2'] as const).find((p) => wipedOut(s, p)) ?? null;
  const [summaryClosed, setSummaryClosed] = useState(false);
  const { settings, update: updateSettings } = useSettings();
  const [menuOpen, setMenuOpen] = useState(false);
  // The computer waits while the pause menu is open.
  const { thinking, aiError, clearAiError } = useAi(s, aiPlayer, paused || auto.running || menuOpen, dispatch, needsAck);
  // Wide screens show the selected Regiment in a side panel instead of a floating card.
  const [wide, setWide] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 1280px)').matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(min-width: 1280px)');
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const aiActing = !!aiPlayer && (active?.owner === aiPlayer || (s.step === 'action' && !active && (s.drawn?.player ?? s.turn) === aiPlayer));

  // Autosave on this device after every action (replayable from seed + actions).
  useEffect(() => {
    if (session.actions.length === 0) return;
    const st = session.state;
    saveGame({
      id: game.id,
      name: `${st.scenario.name}: ${st.players.P1.listName} v ${st.players.P2.listName}`,
      savedAt: new Date().toISOString(),
      createdAt: game.createdAt,
      you: game.you,
      mode: game.mode,
      initial: session.initial,
      initialRng: session.initialRng,
      initialEvents: session.initialEvents,
      actions: session.actions,
      round: st.round,
      vp: { P1: st.players.P1.vp, P2: st.players.P2.vp },
      ended: st.phase === 'ended',
    }).catch(() => undefined);
  }, [session, game]);

  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const date = game.createdAt.slice(0, 10);
  const markdown = () => gameLogMarkdown({ state: s, events: session.events, you: game.you, date });
  const fileBase = `conquest-${s.scenario.id}-${date}`;

  const resetModes = () => {
    setMode('select');
    setMoves([]);
    setMoveText('');
    setOverridePose(null);
    setDrag(null);
  };

  const runRaw = (a: Action) => {
    if (dispatch(a)) {
      resetModes();
      return true;
    }
    return false;
  };
  const confirm = useConfirm();
  /**
   * Every Action from the panels goes through here: irreversible or easy-to-misclick ones ask
   * first (ending an Activation with Actions left, Burning a zone). Returns whether it ran now.
   */
  const run = (a: Action): boolean => {
    const act = s.activation;
    if (a.type === 'endActivation' && act && !act.ended && settings.confirmEarlyEnd && !auto.running) {
      const r = s.regiments[act.regimentId];
      const limit = act.characterId ? 1 : 2;
      const left = limit - act.actions.length;
      if (left > 0 && r?.location === 'table' && s.phase === 'play') {
        confirm.ask(
          { title: 'End the Activation?', body: <p>{act.characterId ? s.characters[act.characterId]?.name : r.name} still has {left} Action{left > 1 ? 's' : ''} left. Unused Actions are lost.</p>, confirmLabel: 'End Activation' },
          () => runRaw(a),
        );
        return false;
      }
    }
    if (a.type === 'burnZone') {
      confirm.ask({ title: `Burn zone ${a.zoneId}?`, body: <p>The zone is removed from the game for both sides. You score 4 VP this Round (ns p.5).</p>, confirmLabel: 'Burn it', danger: true }, () => runRaw(a));
      return false;
    }
    return runRaw(a);
  };
  const toggleRuler = () => {
    resetModes();
    setRuler(null);
    setMode(mode === 'ruler' ? 'select' : 'ruler');
  };
  const doUndo = () => {
    resetModes();
    if (aiPlayer) {
      setPaused(true);
      undoHuman();
    } else undo();
  };
  const exportGameFile = () =>
    download(
      `${fileBase}.json`,
      JSON.stringify({ id: game.id, name: `${s.scenario.name}`, createdAt: game.createdAt, savedAt: new Date().toISOString(), you: game.you, initial: session.initial, initialRng: session.initialRng, initialEvents: session.initialEvents, actions: session.actions, round: s.round, vp: { P1: s.players.P1.vp, P2: s.players.P2.vp }, ended: s.phase === 'ended', events: session.events }, null, 1),
      'application/json',
    );
  // Keyboard (game-ui-ux: every action reachable without a mouse). Ignored while typing or in a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (anyModalOpen() || (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName))) return;
      const click = (id: string) => (document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null)?.click();
      if (e.key === 'Escape') {
        if (mode !== 'select') resetModes();
        else setMenuOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        click('undo');
      } else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (e.key === 'Enter' && t?.tagName !== 'BUTTON') click('ai-next');
      else if (e.key === 'd') click('draw-card');
      else if (e.key === 'e') click('end-activation');
      else if (e.key === 'r') click('ruler');
      else if (e.key === 'g') click('reach');
      else if (e.key === 't') click('threats');
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  const quit = () =>
    confirm.ask({ title: 'Quit to the title screen?', body: <p>The battle is saved on this device and can be continued from the title screen.</p>, confirmLabel: 'Save and quit', danger: true }, onQuit);

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
    if (mode === 'withdraw') {
      const width = footprint(formationInput(s, sel)).halfWidth * 2;
      const pose = withdrawPose(s, sel, moves, withdrawTurn);
      const action: Action = { type: 'withdraw', regimentId: sel.id, moves, turn: withdrawTurn };
      return { action, ghost: { polys: regimentPolys(s, sel, { pose }), valid: validate(s, action).ok }, cost: pathCost(moves, width), allowance: marchValue(s, sel) };
    }
    if (mode === 'override' && overridePose) {
      const action: Action = { type: 'override.move', regimentId: sel.id, pose: overridePose, reason: 'moved by hand' };
      return { action, ghost: { polys: regimentPolys(s, sel, { pose: overridePose }), valid: true } };
    }
    if (mode === 'placeCharge' && overridePose) {
      const action: Action = { type: 'placeCharge', pose: overridePose };
      return { action, ghost: { polys: regimentPolys(s, sel, { pose: overridePose }), valid: validate(s, action).ok } };
    }
    return null;
  }, [s, sel, mode, moves, entry, reform, overridePose, withdrawTurn]);

  // Outcome previews for each legal target while choosing a Charge, Volley or Clash (roadmap 2.1).
  const previewKind = settings.previews && mode === 'target' && sel && s.activation?.regimentId === sel.id && (targetKind === 'charge' || targetKind === 'volley' || targetKind === 'clash') ? targetKind : null;
  const { previews, busy: previewBusy } = usePreviews(s, previewKind, previewKind ? sel!.id : null);

  const areas = useMemo(() => {
    const out: { points: Vec[]; cls: string; label?: string; labelAt?: Vec }[] = [];
    const reachOf = sel && sel.location === 'table' && (showReach || (mode === 'target' && targetKind === 'charge')) ? sel : null;
    if (showThreats) {
      // "Enemy" is seen from the side that is acting (or selected); against the computer, always yours.
      const human = aiPlayer ? (aiPlayer === 'P1' ? 'P2' : 'P1') : null;
      const me = human ?? (s.activation ? s.regiments[s.activation.regimentId]?.owner : undefined) ?? sel?.owner ?? 'P1';
      for (const e of Object.values(s.regiments)) {
        if (e.location !== 'table' || e.owner === me) continue;
        const d = maxReach(s, e);
        out.push({ points: frontReachPolygon(s, e, d), cls: `threat ${e.activatedThisRound ? 'spent' : ''}` });
      }
    }
    if (reachOf) {
      const bands = chargeBands(s, reachOf);
      const fp = footprint(formationInput(s, reachOf));
      const fwd = { x: Math.cos(reachOf.pose.angle), y: Math.sin(reachOf.pose.angle) };
      const right = { x: Math.sin(reachOf.pose.angle), y: -Math.cos(reachOf.pose.angle) };
      [...bands].reverse().forEach((b, i) => {
        // Labels sit just inside each band's outer edge, spread sideways so close bands stay readable.
        const k = bands.length - 1 - i;
        const side = (k - (bands.length - 1) / 2) * Math.min(fp.halfWidth, 2.5);
        const at = { x: fp.c.x + fwd.x * (fp.halfDepth + b.d - 0.6) + right.x * side, y: fp.c.y + fwd.y * (fp.halfDepth + b.d - 0.6) + right.y * side };
        out.push({ points: frontReachPolygon(s, reachOf, b.d), cls: `reach band${bands.length - 1 - i}`, label: `${Math.round(b.d * 10) / 10}″ ${Math.round(b.p * 100)}%`, labelAt: at });
      });
    }
    return out;
  }, [s, sel, showReach, showThreats, mode, targetKind, aiPlayer]);

  const draftProblems = draft && mode !== 'override' && mode !== 'withdraw' ? validate(s, draft.action) : null;

  // ------------------------------------------------ table interaction
  const onMarkerDown = (id: string) => {
    if (mode === 'target' && sel) {
      if (targetKind === 'charge' || targetKind === 'volley' || targetKind === 'clash')
        if (run({ type: targetKind, regimentId: sel.id, targetId: `${MARKER_PREFIX}${id}` })) setMode('select');
    }
  };

  const onRegimentDown = (id: string, p: Vec) => {
    if (mode === 'ruler') {
      rulerTap(p, id);
      return;
    }
    if (mode === 'target' && sel) {
      const action: Action =
        targetKind === 'Snapshot' || targetKind === 'Mighty Swing'
          ? { type: 'characterAbility', characterId: s.activation!.characterId!, name: targetKind, targetId: id }
          : { type: targetKind, regimentId: sel.id, targetId: id };
      if (run(action)) setMode('select');
      return;
    }
    if ((mode === 'march' || mode === 'enter' || mode === 'withdraw') && id === selectedId) {
      // Dragging a sideways or backward move adjusts it; otherwise drag sets the forward distance.
      if (moves.length === 1 && (moves[0]!.kind === 'sideways' || moves[0]!.kind === 'backward')) {
        setDrag({ start: p, base: [] });
        return;
      }
      const base = moves.length && moves[moves.length - 1]!.kind === 'forward' ? moves.slice(0, -1) : moves;
      setDrag({ start: p, base });
      return;
    }
    if ((mode === 'override' || mode === 'placeCharge') && id === selectedId) {
      setDrag({ start: p, base: overridePose ?? sel!.pose });
      return;
    }
    if (mode === 'select') {
      setSelectedId(id);
      setShowUnit(true);
      if (!needsAck) setClosedCallout(session.actions.length);
    }
  };

  const onDrag = (p: Vec) => {
    if (!drag || !sel) return;
    if (mode === 'override' || mode === 'placeCharge') {
      const b = drag.base as Pose;
      setOverridePose({ ...b, x: b.x + p.x - drag.start.x, y: b.y + p.y - drag.start.y });
      return;
    }
    const base = drag.base as MoveSeg[];
    const lateral = moves.length === 1 && (moves[0]!.kind === 'sideways' || moves[0]!.kind === 'backward') && base.length === 0 && mode === 'march' ? moves[0]! : null;
    if (lateral) {
      const cap = marchAllowance(s, sel) / 2;
      const v = { x: p.x - drag.start.x, y: p.y - drag.start.y };
      const fwd = { x: Math.cos(sel.pose.angle), y: Math.sin(sel.pose.angle) };
      const right = { x: Math.sin(sel.pose.angle), y: -Math.cos(sel.pose.angle) };
      const d = lateral.kind === 'sideways' ? dot(v, right) : -dot(v, fwd);
      const amt = Math.max(-cap, Math.min(cap, Math.round(d * 10) / 10));
      setMoves([lateral.kind === 'sideways' ? { kind: 'sideways', d: amt } : { kind: 'backward', d: Math.max(0, amt) }]);
      return;
    }
    const width = footprint(formationInput(s, sel, mode === 'enter' ? { files: entry.files } : {})).halfWidth * 2;
    const from = mode === 'enter' ? entryPose(s, entry.edge, entry.along) : mode === 'withdraw' ? withdrawPose(s, sel, [], withdrawTurn) : sel.pose;
    const pose = applyPath(from, base, width);
    const fwd = { x: Math.cos(pose.angle), y: Math.sin(pose.angle) };
    const d = Math.max(0, dot({ x: p.x - drag.start.x, y: p.y - drag.start.y }, fwd));
    setMoves([...base, { kind: 'forward', d: Math.round(d * 10) / 10 }]);
  };

  const rulerTap = (p: Vec, regimentIdIn?: string) => {
    // Point to point by default; Regiment to Regiment measures closest edges (core p.10).
    const regimentId = rulerMode === 'regiment' ? regimentIdIn : undefined;
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
  /** Sideways (dir −1 left / +1 right) or backward, in steps, capped at half the March (core p.28). */
  const nudgeLateral = (kind: 'sideways' | 'backward', dir: number, k: number) => {
    if (!sel) return;
    const cap = Math.floor((marchAllowance(s, sel) / 2) * 10) / 10;
    const last = moves.length === 1 ? moves[0]! : null;
    const cur = last && last.kind === kind ? (kind === 'sideways' ? (last as { d: number }).d : (last as { d: number }).d) : 0;
    const signed = kind === 'sideways' ? cur * dir : cur;
    const next = Math.min(cap, Math.max(0, (signed > 0 ? signed : 0) + k));
    setMoves(next <= 0 ? [] : [{ kind, d: kind === 'sideways' ? dir * next : next } as MoveSeg]);
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
    // Default to the narrowest formation that comes fully on in one March (core p.31).
    const opts = legalFiles(regimentStandCount(s, r));
    const fits = opts.filter((f) => footprint(formationInput(s, r, { files: f })).halfDepth * 2 <= marchAllowance(s, r) - 0.2);
    setEntry({ edge: own, along: s.scenario.table.width / 2, files: fits[0] ?? opts[opts.length - 1] ?? r.files });
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

  // ------------------------------------------------ activation actions
  const renderActivationButtons = () => {
    const act = s.activation!;
    const r = s.regiments[act.regimentId]!;
    const used = act.actions.length;
    const status = [act.inspired ? 'Inspired' : '', volleyAimed(s, r) ? 'Aimed Shot' : '', r.broken ? 'Broken' : '', act.ended ? 'Activation over' : ''].filter(Boolean).join(' · ');
    const drawEventButtons = (names: string[]) => {
      if (used !== 0 || !names.length || s.regiments[act.regimentId]!.location !== 'table') return null;
      const done = act.drawEvents ?? [];
      // Strain Expression and Memories of Old may be used in addition to another Draw Event.
      const extraDe = (d: string) => d === 'Strain Expression' || d === 'Memories of Old';
      const avail = names.filter((n) => !isOdDrawEvent(baseName(n)) && !done.includes(baseName(n)) && (extraDe(baseName(n)) || !done.some((d) => !extraDe(d))));
      if (!avail.length) return null;
      const friendsNear = Object.values(s.regiments).filter((x) => x.owner === r.owner && x.location === 'table' && distancePolys(regimentPolys(s, r), regimentPolys(s, x)) <= 12);
      return (
        <div className="actions wrap">
          <span className="meta">Draw Event:</span>
          {avail.map((n) => {
            const auto = DRAW_EVENTS_AUTOMATED.includes(baseName(n));
            if (baseName(n) === 'Flux-Powered')
              return (
                <span key={n} className="actions">
                  <button type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name: n, option: 'C' })}>Flux-Powered +2 Clash</button>
                  <button type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name: n, option: 'A' })}>+2 Attacks</button>
                </span>
              );
            if (baseName(n) === 'Strain Expression' && canInduceAggression(s, r))
              return (
                <span key={n} className="actions">
                  <button type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name: n })} data-testid="draw-event-Strain Expression">
                    Strain Expression{strainFor(s, r) ? ` (${strainFor(s, r)!.text})` : ''}
                  </button>
                  <button type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name: n, option: 'aggression' })}>
                    …Induced Aggression instead (+1 C, +1 M)
                  </button>
                </span>
              );
            if (baseName(n) === 'Epigenetic Trigger')
              return (
                <span key={n} className="actions">
                  {friendsNear.map((f) => (
                    <button key={f.id} type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name: n, targetId: f.id })}>Epigenetic Trigger: {f.name}</button>
                  ))}
                </span>
              );
            if (baseName(n) === 'Suppress Higher Functions')
              return (
                <span key={n} className="actions">
                  {friendsNear.map((f) => (
                    <button key={f.id} type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name: n, targetId: f.id })}>Suppress: {f.name} Fearless</button>
                  ))}
                </span>
              );
            return (
              <button key={n} type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name: n })} data-testid={`draw-event-${baseName(n)}`}>
                {n}
                {baseName(n) === 'Strain Expression' && strainFor(s, r) ? ` (${strainFor(s, r)!.text})` : ''}
                {auto ? '' : ' (manual)'}
              </button>
            );
          })}
        </div>
      );
    };
    const tail = (
      <>
        <button type="button" className="secondary" onClick={() => run({ type: 'pass' })}>Pass</button>
        <button type="button" className="secondary" onClick={() => run({ type: 'endActivation' })} data-testid="end-activation">End activation</button>
      </>
    );
    if (act.characterId) {
      const c = s.characters[act.characterId]!;
      const targets = duelTargets(s, c);
      return (
        <div>
          <p><strong>{c.name}</strong> is active: one Character Action (core p.74). {status}</p>
          {drawEventButtons(c.drawEvents)}
          <OdActivation key={`od-${c.id}`} s={s} run={run} />
          <PractitionerButtons key={`pr-${c.id}`} s={s} c={c} run={run} />
          <div className="actions wrap">
            {used === 0 && targets.map((t) => (
              <span key={t.id} className="actions">
                <button type="button" onClick={() => run({ type: 'duel', characterId: c.id, targetCharacterId: t.id, accept: true })}>Duel {t.name}: accepted</button>
                <button type="button" className="secondary" onClick={() => run({ type: 'duel', characterId: c.id, targetCharacterId: t.id, accept: false })}>…declined</button>
              </span>
            ))}
            {used === 0 &&
              c.actions.filter((x) => x.name !== 'Practitioner').map((x) =>
                x.name === 'Snapshot' || x.name === 'Mighty Swing' ? (
                  <button key={x.raw} type="button" className="secondary" onClick={() => { setTargetKind(x.name as TargetKind); setMode('target'); }}>
                    {x.raw}
                  </button>
                ) : (
                  <button key={x.raw} type="button" className="secondary" onClick={() => run({ type: 'characterAbility', characterId: c.id, name: x.raw })}>{x.raw} (manual)</button>
                ),
              )}
            {tail}
            <button type="button" className="secondary" onClick={() => run({ type: 'endActivation', entourage: true })} data-testid="end-entourage">End, then Entourage</button>
          </div>
        </div>
      );
    }
    const engaged = r.location === 'table' && isEngaged(s, r);
    const contacts = engaged ? enemiesInContact(s, r) : [];
    const c = attachedCharacter(s, r.id);
    const shoots = !!barrageOf(r.rules) || (!!c && !!barrageOf(c.rules));
    const target = (k: TargetKind) => {
      if (k === 'clash' && contacts.length === 1) return run({ type: 'clash', regimentId: r.id, targetId: contacts[0]!.id });
      setTargetKind(k);
      setMode('target');
      return true;
    };
    return (
      <div>
        <p className="meta">Actions used {used}/2{status ? ` · ${status}` : ''}{act.entourage ? ' · Entourage Activation' : ''}</p>
        {drawEventButtons(r.drawEvents)}
        <OdActivation key={`od-${r.id}`} s={s} run={run} />
        <div className="actions wrap">
          {!act.ended && r.location === 'arriving' && <button type="button" onClick={() => beginEnter(r)} data-testid="march-on">March on</button>}
          {!act.ended && r.location === 'table' && !engaged && (
            <>
              <button type="button" onClick={() => setMode('march')} data-testid="march">March</button>
              <button type="button" onClick={() => { setReform({ files: r.files, rot: 0 }); setMode('reform'); }} data-testid="reform">Reform</button>
              <button type="button" onClick={() => target('charge')} data-testid="charge">Charge</button>
              {shoots && <button type="button" onClick={() => target('volley')} data-testid="volley">Volley</button>}
              {shoots && <button type="button" className="secondary" onClick={() => run({ type: 'takeAim', regimentId: r.id })}>Take Aim</button>}
              {r.broken && <button type="button" onClick={() => run({ type: 'rally', regimentId: r.id })}>Rally</button>}
              {s.scenario.zones
                .filter((z) => validate(s, { type: 'burnZone', regimentId: r.id, zoneId: z.id }).ok)
                .map((z) => (
                  <button key={z.id} type="button" className="danger" onClick={() => run({ type: 'burnZone', regimentId: r.id, zoneId: z.id })} data-testid={`burn-${z.id}`}>
                    Burn zone {z.label ?? z.id} (+4 VP)
                  </button>
                ))}
              {s.scenario.markers
                .filter((m) => markerInContact(s, r, m.id) && markerAttackProblems(s, r.owner, m.id).length === 0)
                .map((m) => (
                  <button key={m.id} type="button" onClick={() => run({ type: 'clash', regimentId: r.id, targetId: `${MARKER_PREFIX}${m.id}` })}>
                    Clash Marker {m.label ?? m.id}
                  </button>
                ))}
            </>
          )}
          {!act.ended && engaged && (
            <>
              <button type="button" onClick={() => target('clash')} data-testid="clash">Clash</button>
              <button type="button" className="secondary" onClick={() => run({ type: 'inspire', regimentId: r.id })}>Inspire</button>
              {r.broken && <button type="button" onClick={() => run({ type: 'combatRally', regimentId: r.id })}>Combat Rally</button>}
              {r.cls !== 'Heavy' && <button type="button" className="secondary" onClick={() => { setMoves([]); setMode('withdraw'); }}>Withdraw</button>}
              <span className="actions">
                <select value={crFiles} onChange={(e) => setCrFiles(Number(e.target.value))} aria-label="Combat Reform files">
                  {legalFiles(regimentStandCount(s, r)).map((f) => <option key={f} value={f}>{f} files</option>)}
                </select>
                <button type="button" className="secondary" onClick={() => run({ type: 'combatReform', regimentId: r.id, files: crFiles })}>Combat Reform</button>
              </span>
            </>
          )}
          {tail}
        </div>
      </div>
    );
  };

  // ------------------------------------------------ callouts and deck
  const anchorOf = (a: Action | undefined) => {
    const id = a && 'regimentId' in a && typeof a.regimentId === 'string' ? a.regimentId : s.activation?.regimentId;
    const r = id ? s.regiments[id] : undefined;
    return r && r.location === 'table' ? footprint(formationInput(s, r)).c : null;
  };
  const overlays: { id: string; at: Vec | null; node: React.ReactNode; className?: string; clear?: number }[] = [];
  const last = session.last;
  const showAction = !auto.running && !!last && showsCallout(last.action.type, last.events) && (needsAck || closedCallout !== session.actions.length);
  if (showAction && last) {
    overlays.push({
      id: 'action',
      at: anchorOf(last.action),
      node: (
        <ActionCallout
          s={s}
          action={last.action}
          events={last.events}
          byComputer={!!last.action.why && !!aiPlayer}
          {...(needsAck ? { onNext: () => { setAckedAt(session.actions.length); setClosedCallout(session.actions.length); } } : {})}
          onClose={() => setClosedCallout(session.actions.length)}
        />
      ),
    });
  } else if (previewKind) {
    for (const p of previews) {
      const t = s.regiments[p.targetId];
      if (t?.location !== 'table') continue;
      overlays.push({ id: `pv-${p.targetId}`, at: footprint(formationInput(s, t)).c, className: 'preview-badge', node: <PreviewBadge p={p} /> });
    }
  } else if (!wide && sel && showUnit && mode === 'select' && sel.location === 'table') {
    const fpSel = footprint(formationInput(s, sel));
    overlays.push({ id: 'unit', at: fpSel.c, clear: Math.hypot(fpSel.halfWidth, fpSel.halfDepth), node: <UnitCallout s={s} r={sel} onClose={() => setShowUnit(false)} /> });
  }
  const stackPlayer = (['P1', 'P2'] as const).find((p) => !s.players[p].stackSet && p !== (paused ? null : aiPlayer) && decisionMaker(s) === p);

  // ------------------------------------------------ render
  const reserves = Object.values(s.regiments).filter((r) => r.location === 'reserve' || r.location === 'arriving');
  const characters = Object.values(s.characters);

  return (
    <section className="game-screen">
      <Hud s={s} you={game.you} mode={game.mode}>
        <Tooltip tip="Measure (R)">
          <button type="button" className={`icon-btn ${mode === 'ruler' ? 'on' : ''}`} onClick={toggleRuler} data-testid="ruler" aria-label="Ruler">
            📏<span className="btn-label">Ruler</span>
          </button>
        </Tooltip>
        <Tooltip tip="Charge reach of the selected Regiment (G)">
          <button type="button" className={`icon-btn ${showReach ? 'on' : ''}`} onClick={() => setShowReach(!showReach)} data-testid="reach" aria-label="Charge reach">
            ⤳<span className="btn-label">Reach</span>
          </button>
        </Tooltip>
        <Tooltip tip="How far each enemy could Charge (T)">
          <button type="button" className={`icon-btn ${showThreats ? 'on' : ''}`} onClick={() => setShowThreats(!showThreats)} data-testid="threats" aria-label="Threats">
            ⚠<span className="btn-label">Threats</span>
          </button>
        </Tooltip>
        {aiPlayer && (
          <Tooltip tip={paused ? 'Let the computer play on' : 'Stop the computer after its current Action'}>
            <button type="button" className={`icon-btn ${paused ? 'on' : ''}`} onClick={() => setPaused(!paused)} data-testid="pause-ai" aria-label={paused ? 'Resume computer' : 'Pause computer'}>
              {paused ? '▶' : '⏸'}<span className="btn-label">{paused ? 'Resume computer' : 'Pause computer'}</span>
            </button>
          </Tooltip>
        )}
        <Tooltip tip="Undo the last Action (Ctrl+Z)">
          <button type="button" className="icon-btn" onClick={doUndo} disabled={session.actions.length === 0} data-testid="undo" aria-label="Undo">
            ↶<span className="btn-label">Undo</span>
          </button>
        </Tooltip>
        <Tooltip tip="Pause menu (Esc)">
          <button type="button" className="icon-btn" onClick={() => setMenuOpen(true)} data-testid="menu" aria-label="Menu">
            ☰<span className="btn-label">Menu</span>
          </button>
        </Tooltip>
      </Hud>

      <div className="game-table">
      <TableView
        state={s}
        selectedId={selectedId}
        ghost={draft?.ghost ?? null}
        ruler={ruler?.result ?? (ruler?.a ? { a: ruler.a, b: ruler.a, label: 'tap a second point or Regiment' } : null)}
        highlightEdges={highlightEdges}
        onRegimentDown={onRegimentDown}
        onMarkerDown={onMarkerDown}
        onTap={onTap}
        onDrag={onDrag}
        onDragEnd={() => setDrag(null)}
        dragging={!!drag}
        areas={areas}
        showIcons={settings.standIcons}
        onToggleIcons={() => updateSettings({ standIcons: !settings.standIcons })}
        defaultRotated={settings.portraitTable}
        lines={mode === 'target' && targetKind === 'volley' && sel ? volleyLines(s, sel).map((l) => ({ a: l.a, b: l.b, cls: l.kind, ...(l.label ? { label: l.label } : {}) })) : undefined}
        overlays={overlays}
      >
        {s.phase === 'play' && !needsAck && <DrawDeck s={s} dispatch={dispatch} onSelect={setSelectedId} aiPlayer={paused ? null : aiPlayer} />}
        {!auto.running && <Toasts events={session.last?.events ?? []} stamp={session.actions.length} />}
      </TableView>
      </div>
      {wide && (
        <aside className="game-left panel" aria-label="Selected Regiment">
          {sel ? <UnitCallout s={s} r={sel} variant="panel" onClose={() => setSelectedId(null)} /> : <p className="meta empty-hint">Tap a Regiment on the table to see its profile, rules and status here.</p>}
        </aside>
      )}
      <div className="game-side">
      {s.phase === 'play' && s.step === 'command' && stackPlayer && !needsAck && (
        <StackBuilder key={`${s.round}-${stackPlayer}`} s={s} p={stackPlayer} dispatch={dispatch} onPreview={(id) => { setSelectedId(id); setShowUnit(true); }} />
      )}

      {error && (
        <div className="warn card" role="alert" data-testid="error">
          {error.map((e, i) => <p key={i}>{e}</p>)}
          <button type="button" className="secondary small" onClick={() => setError(null)}>OK</button>
        </div>
      )}

      {mode === 'ruler' && (
        <div className="actions wrap meta">
          Ruler:{' '}
          <button type="button" className={`small ${rulerMode === 'point' ? '' : 'secondary'}`} onClick={() => { setRulerMode('point'); setRuler(null); }}>Point to point</button>
          <button type="button" className={`small ${rulerMode === 'regiment' ? '' : 'secondary'}`} onClick={() => { setRulerMode('regiment'); setRuler(null); }}>Regiment to Regiment (closest edges)</button>
        </div>
      )}
      {mode === 'target' && (
        <div className="card info" data-testid="target-card">
          Tap the enemy Regiment{s.round >= s.scenario.objectivesFromRound && s.scenario.markers.length ? ' or enemy Objective Marker' : ''} to {targetKind}, or pick it below.{' '}
          <button type="button" className="secondary small" onClick={resetModes}>Cancel</button>
          {previewKind && (
            <div className="preview-list" data-testid="previews">
              {previewBusy && <p className="meta">Working out the odds…</p>}
              {!previewBusy && previews.length === 0 && <p className="meta">No legal target.</p>}
              {[...previews]
                .sort((a, b) => b.pSuccess * b.wounds - a.pSuccess * a.wounds)
                .map((p) => (
                  <button key={p.targetId} type="button" className="secondary preview-row" onClick={() => { if (run({ type: previewKind, regimentId: sel!.id, targetId: p.targetId })) setMode('select'); }}>
                    <strong>{s.regiments[p.targetId]!.name}</strong> <PreviewText p={p} />
                  </button>
                ))}
              <p className="meta">Averages of {previews[0]?.samples ?? 200} simulated rolls with every rule applied; Wounds include Morale. Nothing is rolled until you choose.</p>
            </div>
          )}
        </div>
      )}
      {s.pendingCharge && mode !== 'placeCharge' && (
        <div className="card warn" data-testid="pending-charge">
          The Charge succeeded, but the engine could not place {s.regiments[s.pendingCharge.regimentId]!.name} in contact (AMB-11).
          <div className="actions">
            <button type="button" onClick={() => { setSelectedId(s.pendingCharge!.regimentId); setOverridePose(s.regiments[s.pendingCharge!.regimentId]!.pose); setMode('placeCharge'); }}>Place by hand</button>
            <button type="button" className="secondary" onClick={() => run({ type: 'failCharge' })}>Path blocked: Charge fails</button>
          </div>
        </div>
      )}
      {aiPlayer && (thinking || aiActing) && !paused && <p className="meta" data-testid="ai-thinking">The computer ({aiPlayer}) is playing…</p>}
      {aiError && (
        <div className="card warn" role="alert">
          {aiError} <button type="button" className="secondary small" onClick={() => { clearAiError(); setPaused(true); }}>OK</button>
        </div>
      )}
      <PowerBar s={s} dispatch={dispatch} aiPlayer={paused ? null : aiPlayer} />
      <PhasePanel s={s} dispatch={dispatch} aiPlayer={paused ? null : aiPlayer} />

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
            {sel.location}{sel.activatedThisRound ? ' · activated' : ''}{sel.broken ? ' · BROKEN' : ''}
            {sel.stands.some((x) => x.wounds > 0) ? ` · wounds on a Stand: ${sel.stands.filter((x) => x.wounds > 0).map((x) => x.wounds).join(', ')}` : ''}
          </p>

          {mode === 'select' && s.phase === 'play' && s.activation?.regimentId === sel.id && (!aiActing || paused) && (
            renderActivationButtons()
          )}
          {s.phase === 'play' && <ManualTools s={s} r={sel} dispatch={dispatch} onMoveByHand={() => { setOverridePose(sel.pose); setMode('override'); }} />}

          {(mode === 'march' || mode === 'enter' || mode === 'withdraw') && draft && (
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
                    {/* Sideways or backward: up to half the March, in one direction only (core p.28). */}
                    <button type="button" className="secondary small" onClick={() => nudgeLateral('sideways', -1, 0.5)}>← side ½″</button>
                    <button type="button" className="secondary small" onClick={() => nudgeLateral('sideways', 1, 0.5)}>side ½″ →</button>
                    <button type="button" className="secondary small" onClick={() => nudgeLateral('sideways', -1, Infinity)}>⇤ side max</button>
                    <button type="button" className="secondary small" onClick={() => nudgeLateral('sideways', 1, Infinity)}>side max ⇥</button>
                    <button type="button" className="secondary small" onClick={() => nudgeLateral('backward', 1, 0.5)}>back ½″</button>
                    <button type="button" className="secondary small" onClick={() => nudgeLateral('backward', 1, Infinity)}>back max</button>
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
                <button type="button" disabled={mode !== 'withdraw' && !draft.ghost.valid} onClick={() => run(draft.action)} data-testid="commit-move">
                  {mode === 'enter' ? 'March on' : mode === 'withdraw' ? 'Roll and Withdraw' : 'March'}
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

          {mode === 'withdraw' && (
            <p className="meta">
              Withdraw (core p.50–51): the Regiment turns to face away, then Marches. The ghost shows the March after turning; the roll and Wounds come first.
              {sel.rules.some((x) => x.name === 'Swift Retreat') && (
                <label>
                  {' '}
                  <input type="checkbox" checked={!withdrawTurn} onChange={(e) => setWithdrawTurn(!e.target.checked)} /> Swift Retreat: keep facing
                </label>
              )}
            </p>
          )}
          {(mode === 'override' || mode === 'placeCharge') && overridePose && (
            <div className="move-panel">
              <p className="warn">{mode === 'placeCharge' ? 'Drag the Regiment into contact with its Charge target and turn it flush; Impact Attacks follow.' : 'Manual override: drag the Regiment anywhere and turn it.'} This is logged as an override.</p>
              <label className="field">Facing {Math.round((overridePose.angle * 180) / Math.PI)}°
                <input type="range" min={-180} max={180} step={1} value={Math.round((overridePose.angle * 180) / Math.PI)} onChange={(e) => setOverridePose({ ...overridePose, angle: deg(Number(e.target.value)) })} />
              </label>
              <div className="actions">
                <button type="button" disabled={!draft?.ghost.valid} onClick={() => run(draft!.action)}>{mode === 'placeCharge' ? 'Confirm contact' : 'Place here'}</button>
                <button type="button" className="secondary" onClick={resetModes}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {s.phase === 'play' && reserves.length > 0 && (
        <div className="card">
          <h3>Reinforcements</h3>
          <p className="meta">Reinforcement Line: P1 {fmt(reinforcementLineNow(s, 'P1'))}, P2 {fmt(reinforcementLineNow(s, 'P2'))} from their edges.</p>
          <ul className="plain">
            {reserves.map((r) => (
              <li key={r.id} className="reserve-row">
                <button type="button" className="link" onClick={() => setSelectedId(r.id)}>{r.owner} {r.name}</button>{' '}
                <span className="meta">{r.cls} · {r.location === 'arriving' ? 'arriving this Round' : 'in Reinforcements'}{r.flags.autoArrive ? ' · arrives automatically next Round' : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.phase === 'play' && wiped && (
        <div className="card warn" data-testid="wiped-out">
          <strong>{wiped} has no Regiments left.</strong>{' '}
          {auto.running ? (
            <>
              Simulating Round {s.round} of {s.scenario.rounds}…{' '}
              <button type="button" className="secondary small" onClick={auto.stop}>Stop</button>
            </>
          ) : (
            <>
              The remaining Rounds can be played out automatically: {wiped === 'P1' ? 'P2' : 'P1'}&apos;s army keeps manoeuvring to Seize objectives and score what it can.{' '}
              <button type="button" className="small" onClick={auto.start} data-testid="simulate-rest">Simulate remaining Rounds</button>
            </>
          )}
          {auto.error && <p className="warn">{auto.error}</p>}
        </div>
      )}
      {s.phase === 'ended' && !summaryClosed && (
        <EndGameSummary s={s} you={game.you} mode={game.mode} onHome={onQuit} onExport={() => download(`${fileBase}.md`, markdown(), 'text/markdown')} onClose={() => setSummaryClosed(true)} />
      )}
      {s.phase === 'ended' && (
        <div className="card result" data-testid="result">
          <h3>Battle over</h3>
          <p>
            {s.players.P1.vp === s.players.P2.vp ? 'A draw' : `${s.players.P1.vp > s.players.P2.vp ? 'P1' : 'P2'} wins`}: P1 {s.players.P1.vp} – {s.players.P2.vp} P2.
            {` You were ${game.you}.`}
          </p>
          <div className="actions">
            <button type="button" className="small" onClick={() => setSummaryClosed(false)}>Battle summary</button>
            <button type="button" className="secondary small" onClick={onQuit}>Save and return home</button>
          </div>
        </div>
      )}
      <Scoreboard s={s} />
      <div className="card">
        <h3>Game log</h3>
        <div className="actions wrap">
          <button type="button" className="secondary small" onClick={() => download(`${fileBase}.md`, markdown(), 'text/markdown')} data-testid="export-md">Export Markdown log</button>
          <button type="button" className="secondary small" onClick={() => navigator.clipboard?.writeText(markdown())}>Copy Markdown</button>
          <button
            type="button"
            className="secondary small"
            onClick={exportGameFile}
          >
            Export game file (JSON)
          </button>
        </div>
        <p className="meta">The game is saved on this device after every action. The JSON file replays it exactly (seed + actions).</p>
      </div>

      <DiceTray events={session.events} />

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
      </div>
      {confirm.dialog}
      {menuOpen && (
        <PauseMenu
          onResume={() => setMenuOpen(false)}
          onSettings={() => {
            setMenuOpen(false);
            onSettings?.();
          }}
          onExportReport={() => download(`${fileBase}.md`, markdown(), 'text/markdown')}
          onExportGame={exportGameFile}
          onQuit={() => {
            setMenuOpen(false);
            quit();
          }}
        />
      )}
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

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One line of odds for a target (roadmap 2.1). */
function PreviewText({ p }: { p: OutcomePreview }) {
  return (
    <span className="meta">
      {p.kind === 'charge' && <>Charge {pct(p.pSuccess)} · </>}
      {p.unplaceable ? 'cannot be placed automatically' : <>~{p.wounds.toFixed(1)} Wounds ({p.stands.toFixed(1)} Stands)</>}
      {p.pBreak > 0.005 && <> · Break {pct(p.pBreak)}</>}
      {p.pDestroy > 0.005 && <> · destroy {pct(p.pDestroy)}</>}
      {p.woundsBack > 0.05 && <> · back ~{p.woundsBack.toFixed(1)}</>}
    </span>
  );
}

/** Small odds badge drawn on a target while choosing it. */
function PreviewBadge({ p }: { p: OutcomePreview }) {
  return (
    <div data-testid={`preview-${p.targetId}`}>
      {p.kind === 'charge' && <div><strong>{pct(p.pSuccess)}</strong> charge</div>}
      <div>~{p.wounds.toFixed(1)} W{p.pBreak > 0.005 ? ` · ${pct(p.pBreak)} Break` : ''}</div>
    </div>
  );
}
