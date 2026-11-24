import type { RuleRef } from '../../import/types';

export type StandRole = 'ranged' | 'melee' | 'caster';

/**
 * What a Stand mainly does, for the small icon drawn on it: ranged if it has Barrage; a caster
 * star for Wizard, Priest, a Practitioner or known Spells; melee (swords) when it is neither.
 */
export function standRoles(rules: readonly RuleRef[], actions: readonly RuleRef[] = [], spells: readonly string[] = []): StandRole[] {
  const has = (n: string) => [...rules, ...actions].some((r) => r.name.toLowerCase() === n);
  const out: StandRole[] = [];
  if (has('barrage')) out.push('ranged');
  if (has('wizard') || has('priest') || has('practitioner') || spells.length > 0) out.push('caster');
  return out.length ? out : ['melee'];
}

/** Simple line icons in a 10×10 box centred on (0, 0). */
function Glyph({ role }: { role: StandRole }) {
  switch (role) {
    case 'melee':
      // Crossed swords.
      return (
        <g>
          <path d="M-3.6 -3.6 L3.2 3.2 M3.6 -3.6 L-3.2 3.2" />
          <path d="M1.4 3.4 L3.4 1.4 M-1.4 3.4 L-3.4 1.4" />
        </g>
      );
    case 'ranged':
      // Bow with an arrow.
      return (
        <g>
          <path d="M-2.6 -4 Q3.6 0 -2.6 4" />
          <path d="M-2.6 -4 L-2.6 4" />
          <path d="M-4 0 L3.8 0 M3.8 0 L2.4 -1.2 M3.8 0 L2.4 1.2" />
        </g>
      );
    case 'caster':
      // Four-point star.
      return <path d="M0 -4 L1 -1 L4 0 L1 1 L0 4 L-1 1 L-4 0 L-1 -1 Z" className="fill" />;
  }
}

/**
 * Icons for one Stand at (x, y) in SVG coordinates, `size` inches across. Kept upright when the
 * table view is turned (`rotate` in degrees).
 */
export function StandIcon({ x, y, size, roles, rotate = 0 }: { x: number; y: number; size: number; roles: StandRole[]; rotate?: number }) {
  const k = size / 10;
  return (
    <g className="stand-icon" transform={`translate(${x} ${y}) rotate(${rotate}) scale(${k})`} pointerEvents="none">
      {roles.map((role, i) => (
        <g key={role} transform={roles.length > 1 ? `translate(${i === 0 ? -3.2 : 3.6} 0) scale(${i === 0 ? 0.8 : 0.6})` : undefined}>
          <Glyph role={role} />
        </g>
      ))}
    </g>
  );
}
