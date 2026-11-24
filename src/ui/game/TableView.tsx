import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { regimentPolys } from '../../engine/game';
import { layout } from '../../engine/formation';
import { mmToInches, OBJECTIVE_MARKER_BASE_MM } from '../../engine/geometry/bases';
import type { Poly } from '../../engine/geometry/polygon';
import type { Vec } from '../../engine/geometry/vec';
import { formationInput } from '../../engine/game';
import type { GameState, PlayerId } from '../../engine/model/types';

export const OWNER_COLOR: Record<PlayerId, string> = { P1: '#c0533f', P2: '#3f67b5' };

export interface Ghost {
  polys: Poly[];
  valid: boolean;
  /** Optional front edge to highlight. */
  front?: [Vec, Vec];
}

export interface Ruler {
  a: Vec;
  b: Vec;
  label: string;
}

interface Props {
  state: GameState;
  selectedId: string | null;
  ghost: Ghost | null;
  ruler: Ruler | null;
  /** Edge segments to highlight as legal entry areas. */
  highlightEdges?: { a: Vec; b: Vec; ok: boolean }[];
  onRegimentDown?: (id: string, p: Vec) => void;
  onTap?: (p: Vec) => void;
  /** Called while the pointer is dragged after onRegimentDown returned. */
  onDrag?: (p: Vec) => void;
  onDragEnd?: () => void;
  dragging: boolean;
}

const PAD = 4;

export function TableView(props: Props) {
  const { state: s } = props;
  const W = s.scenario.table.width;
  const H = s.scenario.table.height;
  const fy = (y: number) => H - y;
  const [view, setView] = useState({ x: -PAD, y: -PAD, w: W + 2 * PAD, h: H + 2 * PAD });
  const svgRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'pinch' | 'tap'; start: { x: number; y: number }; view: typeof view; dist?: number } | null>(null);

  /** Screen point → table inches (y measured from Player 1's edge). */
  const toTable = (clientX: number, clientY: number): Vec => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    const q = m ? pt.matrixTransform(m.inverse()) : pt;
    return { x: q.x, y: H - q.y };
  };

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (props.dragging) return;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', start: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }, view, dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) };
    } else gesture.current = { kind: 'tap', start: { x: e.clientX, y: e.clientY }, view };
  };

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (props.dragging) {
      props.onDrag?.(toTable(e.clientX, e.clientY));
      return;
    }
    const g = gesture.current;
    const svg = svgRef.current;
    if (!g || !svg) return;
    const scale = g.view.w / svg.clientWidth;
    if (g.kind === 'pinch' && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const k = Math.max(0.15, Math.min(2, (g.dist! / d) * (g.view.w / (W + 2 * PAD))));
      const w = (W + 2 * PAD) * k;
      const h = (H + 2 * PAD) * k;
      setView({ x: g.view.x + (g.view.w - w) / 2, y: g.view.y + (g.view.h - h) / 2, w, h });
      return;
    }
    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (g.kind === 'tap' && Math.hypot(dx, dy) > 8) g.kind = 'pan';
    if (g.kind === 'pan') setView({ ...g.view, x: g.view.x - dx * scale, y: g.view.y - dy * scale });
  };

  const onUp = (e: RPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (props.dragging) {
      props.onDragEnd?.();
      return;
    }
    const g = gesture.current;
    if (g?.kind === 'tap') props.onTap?.(toTable(e.clientX, e.clientY));
    if (pointers.current.size === 0) gesture.current = null;
  };

  const zoom = (k: number) =>
    setView((v) => {
      const w = Math.max(10, Math.min((W + 2 * PAD) * 2, v.w * k));
      const h = (w * (H + 2 * PAD)) / (W + 2 * PAD);
      return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
    });

  const pts = (p: Poly) => p.map((q) => `${q.x},${fy(q.y)}`).join(' ');
  const markerSide = mmToInches(OBJECTIVE_MARKER_BASE_MM.widthMm);

  return (
    <div className="table-wrap">
      <svg
        ref={svgRef}
        className="map game"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={(e) => zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15)}
        data-testid="table"
      >
        <rect x={0} y={0} width={W} height={H} className="table" />
        <g className="grid">
          {Array.from({ length: W / 12 - 1 }, (_, i) => (
            <line key={`v${i}`} x1={(i + 1) * 12} x2={(i + 1) * 12} y1={0} y2={H} />
          ))}
          {Array.from({ length: H / 12 - 1 }, (_, i) => (
            <line key={`h${i}`} y1={(i + 1) * 12} y2={(i + 1) * 12} x1={0} x2={W} />
          ))}
        </g>
        {s.scenario.zones.map((z) => (
          <circle key={z.id} cx={z.x} cy={fy(z.y)} r={z.diameter / 2} className="zone" fill={z.friendlyTo ? OWNER_COLOR[z.friendlyTo] : 'var(--zone)'} />
        ))}
        {s.scenario.markers.map((m) => (
          <rect key={m.id} x={m.x - markerSide / 2} y={fy(m.y) - markerSide / 2} width={markerSide} height={markerSide} className="marker" fill={m.friendlyTo ? OWNER_COLOR[m.friendlyTo] : 'var(--zone)'} />
        ))}
        {s.scenario.noReinforcement.map((seg, i) => {
          const x = seg.edge === 'left' ? 0 : seg.edge === 'right' ? W : null;
          return x !== null ? (
            <line key={i} x1={x} x2={x} y1={fy(seg.from)} y2={fy(seg.to)} className="noreinf" />
          ) : (
            <line key={i} y1={seg.edge === 'bottom' ? H : 0} y2={seg.edge === 'bottom' ? H : 0} x1={seg.from} x2={seg.to} className="noreinf" />
          );
        })}
        {props.highlightEdges?.map((h, i) => (
          <line key={`he${i}`} x1={h.a.x} y1={fy(h.a.y)} x2={h.b.x} y2={fy(h.b.y)} className={h.ok ? 'entry-ok' : 'entry-bad'} />
        ))}
        {Object.values(s.regiments)
          .filter((r) => r.location === 'table')
          .map((r) => {
            const slots = layout(formationInput(s, r));
            const polys = regimentPolys(s, r);
            const sel = r.id === props.selectedId;
            return (
              <g
                key={r.id}
                className={`regiment ${sel ? 'selected' : ''} ${r.activatedThisRound ? 'done' : ''}`}
                onPointerDown={(e) => {
                  if (!props.onRegimentDown) return;
                  e.stopPropagation();
                  (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture?.(e.pointerId);
                  pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                  props.onRegimentDown(r.id, toTable(e.clientX, e.clientY));
                }}
                data-testid={`regiment-${r.id}`}
              >
                {slots.map((sl, i) => (
                  <polygon
                    key={sl.id}
                    points={pts(polys[i]!)}
                    fill={OWNER_COLOR[r.owner]}
                    className={`stand ${sl.isCharacter ? 'character' : ''} ${sl.isCommand ? 'command' : ''}`}
                  />
                ))}
                <FrontEdge s={s} id={r.id} fy={fy} />
              </g>
            );
          })}
        {props.ghost && (
          <g className={`ghost ${props.ghost.valid ? 'ok' : 'bad'}`} pointerEvents="none">
            {props.ghost.polys.map((p, i) => (
              <polygon key={i} points={pts(p)} />
            ))}
            {props.ghost.front && <line x1={props.ghost.front[0].x} y1={fy(props.ghost.front[0].y)} x2={props.ghost.front[1].x} y2={fy(props.ghost.front[1].y)} className="front" />}
          </g>
        )}
        {props.ruler && (
          <g className="ruler" pointerEvents="none">
            <line x1={props.ruler.a.x} y1={fy(props.ruler.a.y)} x2={props.ruler.b.x} y2={fy(props.ruler.b.y)} />
            <circle cx={props.ruler.a.x} cy={fy(props.ruler.a.y)} r={0.35} />
            <circle cx={props.ruler.b.x} cy={fy(props.ruler.b.y)} r={0.35} />
            <text x={(props.ruler.a.x + props.ruler.b.x) / 2} y={fy((props.ruler.a.y + props.ruler.b.y) / 2) - 0.8}>{props.ruler.label}</text>
          </g>
        )}
        {Object.values(s.regiments)
          .filter((r) => r.location === 'table')
          .map((r) => {
            const polys = regimentPolys(s, r);
            const c = polys.flat().reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
            const n = polys.flat().length;
            return (
              <text key={`l${r.id}`} x={c.x / n} y={fy(c.y / n)} className="rlabel" pointerEvents="none">
                {r.name}
                {r.broken ? ' (Broken)' : ''}
              </text>
            );
          })}
      </svg>
      <div className="zoom">
        <button type="button" className="small" onClick={() => zoom(1 / 1.3)} aria-label="Zoom in">＋</button>
        <button type="button" className="small" onClick={() => zoom(1.3)} aria-label="Zoom out">－</button>
        <button type="button" className="small" onClick={() => setView({ x: -PAD, y: -PAD, w: W + 2 * PAD, h: H + 2 * PAD })}>Fit</button>
      </div>
    </div>
  );
}

function FrontEdge({ s, id, fy }: { s: GameState; id: string; fy: (y: number) => number }) {
  const r = s.regiments[id]!;
  const slots = layout(formationInput(s, r));
  const front = slots.filter((x) => x.rank === 0);
  if (!front.length) return null;
  const polys = regimentPolys(s, r);
  // Front edge: from the front-left corner of the leftmost front Stand to the front-right of the rightmost.
  const idx = (sl: (typeof slots)[number]) => slots.indexOf(sl);
  const left = polys[idx(front[0]!)]![0]!;
  const right = polys[idx(front[front.length - 1]!)]![3]!;
  return <line x1={left.x} y1={fy(left.y)} x2={right.x} y2={fy(right.y)} className="front" />;
}
