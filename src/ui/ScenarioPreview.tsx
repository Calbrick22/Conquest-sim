import { useState } from 'react';
import { OBJECTIVE_MARKER_BASE_MM, mmToInches } from '../engine/geometry/bases';
import { SCENARIOS } from '../scenarios';
import type { EdgeSegment, ScenarioDef } from '../scenarios/types';

const P1_COLOR = '#c0533f';
const P2_COLOR = '#3f67b5';
const ownerColor = (p?: 'P1' | 'P2') => (p === 'P1' ? P1_COLOR : p === 'P2' ? P2_COLOR : 'var(--zone)');

/** Table drawn in inches; SVG y is flipped so y = 0 is Player 1's edge (bottom). */
export function ScenarioMap({ s, showGrid = true }: { s: ScenarioDef; showGrid?: boolean }) {
  const { width: W, height: H } = s.table;
  const pad = 3;
  const fy = (y: number) => H - y;
  const markerSide = mmToInches(OBJECTIVE_MARKER_BASE_MM.widthMm);
  const segLine = (seg: EdgeSegment) => {
    switch (seg.edge) {
      case 'left': return { x1: 0, x2: 0, y1: fy(seg.from), y2: fy(seg.to) };
      case 'right': return { x1: W, x2: W, y1: fy(seg.from), y2: fy(seg.to) };
      case 'bottom': return { x1: seg.from, x2: seg.to, y1: H, y2: H };
      case 'top': return { x1: seg.from, x2: seg.to, y1: 0, y2: 0 };
    }
  };
  return (
    <svg className="map" viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} role="img" aria-label={`${s.name} layout`}>
      <rect x={0} y={0} width={W} height={H} className="table" />
      {showGrid && (
        <g className="grid">
          {Array.from({ length: W / 12 - 1 }, (_, i) => (
            <line key={`v${i}`} x1={(i + 1) * 12} x2={(i + 1) * 12} y1={0} y2={H} />
          ))}
          {Array.from({ length: H / 12 - 1 }, (_, i) => (
            <line key={`h${i}`} y1={(i + 1) * 12} y2={(i + 1) * 12} x1={0} x2={W} />
          ))}
        </g>
      )}
      {s.zones.map((z) => (
        <g key={z.id}>
          <circle cx={z.x} cy={fy(z.y)} r={z.diameter / 2} fill={ownerColor(z.friendlyTo)} className="zone" />
          <text x={z.x} y={fy(z.y) + 0.6} className="zlabel">
            {z.label ? `${z.label} · ` : ''}{z.diameter}″
          </text>
        </g>
      ))}
      {s.markers.map((m) => (
        <g key={m.id}>
          <rect
            x={m.x - markerSide / 2}
            y={fy(m.y) - markerSide / 2}
            width={markerSide}
            height={markerSide}
            fill={ownerColor(m.friendlyTo)}
            className="marker"
          />
          {m.label && (
            <text x={m.x + markerSide / 2 + 0.4} y={fy(m.y) - markerSide / 2} className="mlabel">
              {m.label}
            </text>
          )}
        </g>
      ))}
      {s.noReinforcement.map((seg, i) => (
        <line key={i} {...segLine(seg)} className="noreinf" />
      ))}
      <text x={W / 2} y={H + 2.2} className="edge" fill={P1_COLOR}>Player 1 Reinforcement Zone</text>
      <text x={W / 2} y={-1} className="edge" fill={P2_COLOR}>Player 2 Reinforcement Zone</text>
    </svg>
  );
}

export function ScenarioPreview() {
  const [id, setId] = useState(SCENARIOS.find((s) => s.id === 'forlorn-hope')?.id ?? SCENARIOS[0]!.id);
  const s = SCENARIOS.find((x) => x.id === id)!;
  return (
    <section>
      <h2>Scenario preview</h2>
      <label className="field">
        Scenario{' '}
        <select value={id} onChange={(e) => setId(e.target.value)} data-testid="scenario-select">
          {SCENARIOS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <div className="card">
        <ScenarioMap s={s} />
        <p className="meta">
          72″ × 48″, 12″ grid. Coordinates from Player 1's bottom-left corner. Tournament pack p.{s.page}.
          {s.noReinforcement.length > 0 && ' Thick red edges: no Reinforcements.'}
        </p>
        <ul className="plain">
          {s.zones.map((z) => (
            <li key={z.id}>
              Zone {z.label ?? z.id}: {z.diameter}″ at ({z.x}, {z.y}){z.friendlyTo ? `, friendly to ${z.friendlyTo}` : ''}
            </li>
          ))}
          {s.markers.map((m) => (
            <li key={m.id}>
              Marker {m.label ?? m.id}: ({m.x}, {m.y}), {m.friendlyTo ? `friendly to ${m.friendlyTo}` : 'neutral'}
            </li>
          ))}
        </ul>
        <h3>Victory Points ({s.rounds} Rounds)</h3>
        <ul>
          {s.summary.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        {s.ambiguities && <p className="meta">Interpretation notes: {s.ambiguities.join(', ')} (see docs/ambiguities.md).</p>}
      </div>
    </section>
  );
}
