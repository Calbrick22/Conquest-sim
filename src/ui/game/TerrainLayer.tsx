import type { TerrainPiece } from '../../scenarios/types';
import { piecePoly, TERRAIN_TYPES } from '../../engine/terrain';

/** Fill colours and patterns per terrain type (shared by the table and the scenario preview). */
export function TerrainDefs() {
  return (
    <defs>
      <pattern id="tp-forest" width="2" height="2" patternUnits="userSpaceOnUse">
        <rect width="2" height="2" fill="#2f5d2c" />
        <circle cx="0.6" cy="0.6" r="0.55" fill="#3f7a37" />
        <circle cx="1.6" cy="1.5" r="0.5" fill="#4a8a41" />
      </pattern>
      <pattern id="tp-field" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="1.2" height="1.2" fill="#c7ad5a" />
        <rect width="0.35" height="1.2" fill="#b39648" />
      </pattern>
      <pattern id="tp-hill" width="3" height="3" patternUnits="userSpaceOnUse">
        <rect width="3" height="3" fill="#a88a5c" />
        <path d="M0 2.4 Q1.5 1.6 3 2.4" stroke="#8d7148" strokeWidth="0.18" fill="none" />
      </pattern>
      <pattern id="tp-pond" width="2.4" height="1.2" patternUnits="userSpaceOnUse">
        <rect width="2.4" height="1.2" fill="#3f78a3" />
        <path d="M0 0.7 Q0.6 0.4 1.2 0.7 T2.4 0.7" stroke="#79aed3" strokeWidth="0.14" fill="none" />
      </pattern>
      <pattern id="tp-structure" width="2" height="2" patternUnits="userSpaceOnUse">
        <rect width="2" height="2" fill="#6e655c" />
        <rect x="0.15" y="0.15" width="1.7" height="0.75" fill="#7d746a" />
        <rect x="0.15" y="1.1" width="0.8" height="0.75" fill="#7d746a" />
        <rect x="1.05" y="1.1" width="0.8" height="0.75" fill="#7d746a" />
      </pattern>
      <pattern id="tp-boulder" width="3" height="3" patternUnits="userSpaceOnUse">
        <rect width="3" height="3" fill="#5f5a55" />
        <path d="M0.3 2.2 L1 0.9 L2 1.2 L2.6 2.3 Z" fill="#76706a" />
      </pattern>
    </defs>
  );
}

/**
 * Terrain pieces as SVG (table coordinates; `fy` flips y). `upright` counter-rotates labels when
 * the table view is turned. Keywords are in each piece's tooltip.
 */
export function TerrainLayer({ pieces, fy, upright }: { pieces: readonly TerrainPiece[]; fy: (y: number) => number; upright?: (x: number, y: number) => { transform?: string } }) {
  return (
    <g className="terrain" pointerEvents="none">
      {pieces.map((p) => {
        const t = TERRAIN_TYPES[p.kind];
        const pts = piecePoly(p)
          .map((v) => `${v.x},${fy(v.y)}`)
          .join(' ');
        const ux = upright ? upright(p.x, fy(p.y)) : {};
        return (
          <g key={p.id} className={`piece ${p.kind}`} data-testid={`terrain-${p.id}`}>
            <title>{`${t.label}: Size ${p.size}, ${p.keywords.join(', ')}`}</title>
            <polygon points={pts} fill={`url(#tp-${p.kind})`} />
            <text x={p.x} y={fy(p.y)} className="tlabel" {...ux}>
              {t.label}
            </text>
            <text x={p.x} y={fy(p.y) + 1.3} className="tkeys" {...ux}>
              {p.keywords.filter((k) => k !== 'Traversable').join(' · ')} · S{p.size}
            </text>
          </g>
        );
      })}
    </g>
  );
}
