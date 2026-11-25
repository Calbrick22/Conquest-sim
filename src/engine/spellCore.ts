import { resolveAttack } from './combat';
import { ev, type Ctx } from './dice';
import type { CharacterState, Court, GameState, PlayerId, PowerPool, RegimentState } from './model/types';
import { hasRule } from './rules/special/rules';

/** Shared Spell types and the Hit helper (core p.80–81), used by every faction's Spells. */

export interface SpellDef {
  /** Sorcerer Kings: the Court the Spell belongs to (sk p.4). */
  court?: Court;
  /** Successes needed instead of 2 (Sunder (the Land), sk p.21). */
  minSuccesses?: number;
  range: number | 'self';
  attunement: number;
  scaling: boolean;
  /** Causes Hits (needs Line of Sight; core p.80). */
  hits: boolean;
  target: 'enemy' | 'friendly' | 'self';
  /** Extra target restrictions. */
  check?: (s: GameState, target: RegimentState) => string | null;
  apply: (ctx: Ctx, caster: Caster, target: RegimentState, successes: number, choice: { pool?: PowerPool }) => void;
}

export interface Caster {
  /** Character id or Regiment id. */
  id: string;
  name: string;
  owner: PlayerId;
  /** The Regiment the caster is in (or is). */
  regiment: RegimentState;
  character?: CharacterState;
  rules: CharacterState['rules'];
  spells: string[];
  /** Priest/Wizard dice. */
  dice: number;
  priest: boolean;
}


export function spellHits(ctx: Ctx, caster: Caster, target: RegimentState, hitsIn: number, what: string, pool: { reduceD?: number; defenseOverride?: number } = {}, morale = true): void {
  // Loose Formation (core p.99): Hits from Spells are halved, rounding up.
  const hits = hasRule(target.rules, 'Loose Formation') ? Math.ceil(hitsIn / 2) : hitsIn;
  if (hits !== hitsIn) ev(ctx, { type: 'note', text: `${target.name} has Loose Formation: ${hitsIn} Hits become ${hits} (core p.99).`, regimentId: target.id });
  resolveAttack(ctx, {
    attackerOwner: caster.owner,
    attackerId: caster.regiment.id,
    targetId: target.id,
    arc: 'front', // Spells ignore the flank and rear rules (core p.81)
    pools: [{ label: what, dice: 0, skill: 0, autoHits: hits, ...pool }],
    morale,
    terrifying: 0,
    what,
    kind: 'special',
  });
}

