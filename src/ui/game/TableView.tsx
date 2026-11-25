import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { regimentPolys } from '../../engine/game';
import { layout } from '../../engine/formation';
import { mmToInches, OBJECTIVE_MARKER_BASE_MM } from '../../engine/geometry/bases';
import type { Poly } from '../../engine/geometry/polygon';
import type { Vec } from '../../engine/geometry/vec';
import { formationInput } from '../../engine/game';
import type { GameState, PlayerId } from '../../engine/model/types';
import { StandIcon, standRoles } from './StandIcon';
import { TerrainDefs, TerrainLayer } from './TerrainLayer';
import { priorityZone } from '../../engine/scoring/scoreRound';

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
  /** A Regiment to highlight, e.g. while hovering its Activate button. */
  hoverId?: string | null;
  ghost: Ghost | null;
  ruler: Ruler | null;
  /** Edge segments to highlight as legal entry areas. */
  highlightEdges?: { a: Vec; b: Vec; ok: boolean }[];
  onRegimentDown?: (id: string, p: Vec) => void;
  onMarkerDown?: (id: string) => void;
  onTap?: (p: Vec) => void;
  /** Called while the pointer is dragged after onRegimentDown returned. */
  onDrag?: (p: Vec) => void;
  onDragEnd?: () => void;
  dragging: boolean;
  /** HTML callouts anchored at table coordinates (null = top of the table). */
  overlays?: { id: string; at: Vec | null; node: ReactNode; className?: string; clear?: number }[];
  /** Shaded areas drawn under the Regiments (e.g. Charge reach, enemy threat ranges). */
  areas?: { points: Vec[]; cls: string; label?: string; labelAt?: Vec }[];
  /** Extra measurement lines (e.g. Volley ranges). */
  lines?: { a: Vec; b: Vec; cls: string; label?: string }[];
  /** Fixed HTML (e.g. the Command deck) drawn over the bottom of the table. */
  children?: ReactNode;
  /** Role icons on Stands, and the button that toggles them (from Settings). */
  showIcons?: boolean;
  onToggleIcons?: () => void;
  /** Start turned to portrait (Settings). */
  defaultRotated?: boolean;
}

const PAD = 4;

export function TableView(props: Props) {
  const { state: s } = props;
  const W = s.scenario.table.width;
  const H = s.scenario.table.height;
  const fy = (y: number) => H - y;
  // Portrait: the table turned a quarter so its long side runs down the screen (phones).
  const [rotated, setRotated] = useState(() => {
    try {
      const v = localStorage.getItem('table-rotated');
      return v === null ? !!props.defaultRotated : v === '1';
    } catch {
      return !!props.defaultRotated;
    }
  });
  // Hide callouts and the deck to see the whole table.
  const [peek, setPeek] = useState(false);
  // Role icons on Stands (ranged, melee, caster): a Setting, toggled from the table too.
  const [localIcons, setLocalIcons] = useState(true);
  const showIcons = props.showIcons ?? localIcons;
  const toggleIcons = () => (props.onToggleIcons ? props.onToggleIcons() : setLocalIcons(!localIcons));
  const fit = (rot: boolean) => (rot ? { x: -PAD, y: -PAD, w: H + 2 * PAD, h: W + 2 * PAD } : { x: -PAD, y: -PAD, w: W + 2 * PAD, h: H + 2 * PAD });
  const [view, setView] = useState(() => fit(rotated));
  const toggleRotate = () => {
    const next = !rotated;
    setRotated(next);
    setView(fit(next));
    try {
      localStorage.setItem('table-rotated', next ? '1' : '0');
    } catch {
      /* per-device convenience only */
    }
  };
  /** Counter-rotates text so labels stay upright when the table is turned. */
  const upright = (x: number, y: number) => (rotated ? { transform: `rotate(-90 ${x} ${y})` } : {});
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  /** Table inches → pixel offset inside the wrapper (viewBox with xMidYMid meet). */
  const toPx = (p: Vec) => {
    const k = Math.min(size.w / view.w, size.h / view.h) || 0;
    const ox = (size.w - view.w * k) / 2;
    const oy = (size.h - view.h * k) / 2;
    const u = rotated ? p.y : p.x;
    const v = rotated ? p.x : H - p.y;
    return { x: ox + (u - view.x) * k, y: oy + (v - view.y) * k };
  };
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
    // Rotated: screen-space (u, v) = (table y, table x).
    return rotated ? { x: q.y, y: q.x } : { x: q.x, y: H - q.y };
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
      const F = fit(rotated);
      const k = Math.max(0.15, Math.min(2, (g.dist! / d) * (g.view.w / F.w)));
      const w = F.w * k;
      const h = F.h * k;
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
      const F = fit(rotated);
      const w = Math.max(10, Math.min(F.w * 2, v.w * k));
      const h = (w * F.h) / F.w;
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
        <TerrainDefs />
        <g transform={rotated ? `matrix(0 1 -1 0 ${H} 0)` : undefined}>
        <rect x={0} y={0} width={W} height={H} className="table" />
        <g className="grid">
          {Array.from({ length: W / 12 - 1 }, (_, i) => (
            <line key={`v${i}`} x1={(i + 1) * 12} x2={(i + 1) * 12} y1={0} y2={H} />
          ))}
          {Array.from({ length: H / 12 - 1 }, (_, i) => (
            <line key={`h${i}`} y1={(i + 1) * 12} y2={(i + 1) * 12} x1={0} x2={W} />
          ))}
        </g>
        {s.scenario.territories &&
          (['P1', 'P2'] as const).map((p) => {
            const d = s.scenario.territories![p];
            return <rect key={`ter${p}`} x={0} y={p === 'P1' ? fy(d) : 0} width={W} height={d} className="territory" fill={OWNER_COLOR[p]} pointerEvents="none" />;
          })}
        <TerrainLayer pieces={s.scenario.terrain ?? []} fy={fy} upright={upright} />
        {s.scenario.zones
          .filter((z) => !(s.burnedZones ?? []).includes(z.id))
          .map((z) => {
            const prio = priorityZone(s.scenario, s.round) === z.id;
            return (
              <g key={z.id}>
                <circle cx={z.x} cy={fy(z.y)} r={z.diameter / 2} className={`zone ${prio ? 'priority' : ''}`} fill={z.friendlyTo ? OWNER_COLOR[z.friendlyTo] : 'var(--zone)'} />
                {prio && (
                  <text x={z.x} y={fy(z.y) - z.diameter / 2 - 0.4} className="zone-tag" {...upright(z.x, fy(z.y) - z.diameter / 2 - 0.4)}>
                    ★ Priority
                  </text>
                )}
              </g>
            );
          })}
        {s.scenario.markers.map((m) => {
          const st = s.markers[m.id];
          if (st?.destroyed) return null;
          return (
            <g
              key={m.id}
              onPointerDown={(e) => {
                if (!props.onMarkerDown) return;
                e.stopPropagation();
                props.onMarkerDown(m.id);
              }}
              data-testid={`marker-${m.id}`}
            >
              <rect x={m.x - markerSide / 2} y={fy(m.y) - markerSide / 2} width={markerSide} height={markerSide} className="marker" fill={m.friendlyTo ? OWNER_COLOR[m.friendlyTo] : 'var(--zone)'} />
              {st && (st.woundsBy.P1 > 0 || st.woundsBy.P2 > 0) && (
                <text x={m.x} y={fy(m.y) + 0.5} className="rlabel" {...upright(m.x, fy(m.y))}>{st.woundsBy.P1}/{st.woundsBy.P2}</text>
              )}
            </g>
          );
        })}
        {s.scenario.noReinforcement.map((seg, i) => {
          const x = seg.edge === 'left' ? 0 : seg.edge === 'right' ? W : null;
          return x !== null ? (
            <line key={i} x1={x} x2={x} y1={fy(seg.from)} y2={fy(seg.to)} className="noreinf" />
          ) : (
            <line key={i} y1={seg.edge === 'bottom' ? H : 0} y2={seg.edge === 'bottom' ? H : 0} x1={seg.from} x2={seg.to} className="noreinf" />
          );
        })}
        {props.areas?.map((a, i) => (
          <g key={`ar${i}`} className={`area ${a.cls}`} pointerEvents="none">
            <polygon points={a.points.map((q) => `${q.x},${fy(q.y)}`).join(' ')} />
            {a.label && a.labelAt && (
              <text x={a.labelAt.x} y={fy(a.labelAt.y)} {...upright(a.labelAt.x, fy(a.labelAt.y))}>
                {a.label}
              </text>
            )}
          </g>
        ))}
        {props.highlightEdges?.map((h, i) => (
          <line key={`he${i}`} x1={h.a.x} y1={fy(h.a.y)} x2={h.b.x} y2={fy(h.b.y)} className={h.ok ? 'entry-ok' : 'entry-bad'} />
        ))}
        {Object.values(s.regiments)
          .filter((r) => r.location === 'table')
          .map((r) => {
            const slots = layout(formationInput(s, r));
            const polys = regimentPolys(s, r);
            const sel = r.id === props.selectedId;
            const hov = r.id === props.hoverId;
            return (
              <g
                key={r.id}
                className={`regiment ${sel ? 'selected' : ''} ${hov ? 'hovered' : ''} ${r.activatedThisRound ? 'done' : ''}`}
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
                {showIcons &&
                  slots.map((sl) => {
                    const ch = sl.isCharacter ? s.characters[sl.id] : undefined;
                    const roles = ch ? standRoles(ch.rules, ch.actions, ch.spells) : standRoles(r.rules, [], r.spells);
                    const c = sl.rect.c;
                    // Towards the back of the Stand, so the Regiment's name stays readable.
                    const back = { x: c.x - Math.cos(r.pose.angle) * sl.rect.halfDepth * 0.4, y: c.y - Math.sin(r.pose.angle) * sl.rect.halfDepth * 0.4 };
                    return <StandIcon key={`i${sl.id}`} x={back.x} y={fy(back.y)} size={Math.min(sl.rect.halfWidth, sl.rect.halfDepth) * 0.9} roles={roles} rotate={rotated ? -90 : 0} />;
                  })}
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
        {props.lines?.map((l, i) => (
          <g key={`ln${i}`} className={`mline ${l.cls}`} pointerEvents="none">
            <line x1={l.a.x} y1={fy(l.a.y)} x2={l.b.x} y2={fy(l.b.y)} />
            {l.label && (
              <text x={(l.a.x + l.b.x) / 2} y={fy((l.a.y + l.b.y) / 2) - 0.4} {...upright((l.a.x + l.b.x) / 2, fy((l.a.y + l.b.y) / 2))}>
                {l.label}
              </text>
            )}
          </g>
        ))}
        {props.ruler && (
          <g className="ruler" pointerEvents="none">
            <line x1={props.ruler.a.x} y1={fy(props.ruler.a.y)} x2={props.ruler.b.x} y2={fy(props.ruler.b.y)} />
            <circle cx={props.ruler.a.x} cy={fy(props.ruler.a.y)} r={0.35} />
            <circle cx={props.ruler.b.x} cy={fy(props.ruler.b.y)} r={0.35} />
            <text x={(props.ruler.a.x + props.ruler.b.x) / 2} y={fy((props.ruler.a.y + props.ruler.b.y) / 2) - 0.8} {...upright((props.ruler.a.x + props.ruler.b.x) / 2, fy((props.ruler.a.y + props.ruler.b.y) / 2))}>{props.ruler.label}</text>
          </g>
        )}
        {Object.values(s.regiments)
          .filter((r) => r.location === 'table')
          .map((r) => {
            // The name sits along the front edge, clear of the Stand icons.
            const front = layout(formationInput(s, r)).filter((sl) => sl.rank === 0);
            const fc = front.reduce((a, sl) => ({ x: a.x + sl.rect.c.x / front.length, y: a.y + sl.rect.c.y / front.length }), { x: 0, y: 0 });
            const d = (front[0]?.rect.halfDepth ?? 0) * 0.55;
            const lx = fc.x + Math.cos(r.pose.angle) * d;
            const ly = fc.y + Math.sin(r.pose.angle) * d;
            return (
              <text key={`l${r.id}`} x={lx} y={fy(ly)} className="rlabel" dominantBaseline="middle" pointerEvents="none" {...upright(lx, fy(ly))}>
                {r.name}
                {r.broken ? ' (Broken)' : ''}
                {r.flags.marked ? ' ◎Marked' : ''}
                {r.flags.decay ? ' ☣' : ''}
                {r.flags.inflamed ? ' 🔥' : ''}
                {r.flags.awakened ? ' ✦' : ''}
              </text>
            );
          })}
        </g>
      </svg>
      {!peek && props.overlays?.map((o) => {
        const pos = o.at ? toPx(o.at) : null;
        // Below the anchor when it is in the top half of the table, above it otherwise.
        const below = !pos || pos.y < size.h / 2;
        // Keep clear of the anchored Regiment (`clear` inches from its centre).
        const k = Math.min(size.w / view.w, size.h / view.h) || 0;
        const gap = Math.max(14, (o.clear ?? 0) * k + 6);
        const room = pos ? (below ? size.h - pos.y - gap - 6 : pos.y - gap - 6) : size.h - 16;
        const left = pos ? Math.max(4, Math.min(size.w - Math.min(260, size.w - 8) - 4, pos.x - 130)) : 8;
        const style = pos
          ? below
            ? { left, top: pos.y + gap, maxHeight: Math.max(110, room) }
            : { left, bottom: size.h - pos.y + gap, maxHeight: Math.max(110, room) }
          : { left: 8, top: 8, maxHeight: size.h - 16 };
        return (
          <div key={o.id} className={o.className ?? 'callout'} style={o.className ? { left: pos ? pos.x : 8, top: pos ? pos.y : 8 } : style} onPointerDown={(e) => e.stopPropagation()}>
            {o.node}
          </div>
        );
      })}
      {!peek && props.children}
      <div className="zoom">
        <button type="button" className={`small ${peek ? 'on' : ''}`} onClick={() => setPeek(!peek)} aria-label={peek ? 'Show panels' : 'Hide panels to see the table'} title={peek ? 'Show panels' : 'Hide panels to see the table'} data-testid="peek">
          {peek ? '👁 Panels' : '👁'}
        </button>
        <button type="button" className={`small ${showIcons ? 'on' : ''}`} onClick={toggleIcons} aria-label="Stand icons" title="Stand icons: bow = ranged, swords = melee, star = spellcaster or Practitioner" data-testid="icons">⚔</button>
        <button type="button" className={`small ${rotated ? 'on' : ''}`} onClick={toggleRotate} aria-label="Turn the table" title="Turn the table (portrait)" data-testid="rotate">⟳</button>
        <button type="button" className="small" onClick={() => zoom(1 / 1.3)} aria-label="Zoom in">＋</button>
        <button type="button" className="small" onClick={() => zoom(1.3)} aria-label="Zoom out">－</button>
        <button type="button" className="small" onClick={() => setView(fit(rotated))}>Fit</button>
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
