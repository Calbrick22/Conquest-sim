import type { RuleRef } from '../../../import/types';
import type { AttackKind, AttackPool } from '../../combat';
import type { Arc } from '../../geometry/arcs';
import type { GameState, RegimentState } from '../../model/types';
import { hasRole, sectOf } from './grants';
import { hasRule, ruleX } from './rules';

/**
 * What the attacker's and the target's special rules do to one pool of attacks.
 * Page references: core rulebook special rules (p.96–101).
 */
export function poolMods(rules: readonly RuleRef[], target: RegimentState, kind: AttackKind, arc: Arc, skill: number, opts: { effectiveRange?: boolean; blessed?: boolean } = {}): Partial<AttackPool> {
  const clashLike = kind === 'clash' || kind === 'duel';
  const engagedMelee = kind === 'clash' || kind === 'impact' || kind === 'duel';
  let reroll =
    (clashLike && hasRule(rules, 'Flurry')) || // Flurry (p.98)
    ((kind === 'clash' || kind === 'volley') && arc !== 'front' && hasRule(rules, 'Opportunists')) || // Opportunists (p.99)
    (hasRule(rules, 'Fiend Hunter') && (target.type === 'Monster' || target.type === 'Brute')) || // Fiend Hunter (p.98)
    ((kind === 'clash' || kind === 'impact') && !!target.flags.marked) || // Designate Target (Spires; AMB-36)
    (!!opts.blessed && (kind === 'clash' || kind === 'impact')); // Blessed (p.97; AMB-37)
  // Parry: enemies engaged with it cannot re-roll failed Hit Rolls (p.100).
  if (engagedMelee && hasRule(target.rules, 'Parry')) reroll = false;
  const reduceD = clashLike ? ruleX(rules, 'Cleave') : kind === 'volley' ? ruleX(rules, 'Armor Piercing') : kind === 'impact' ? ruleX(rules, 'Brutal Impact') : 0;
  return {
    rerollFailed: reroll,
    reduceD,
    ignoreShield: engagedMelee && hasRule(rules, 'Linebreaker'),
    deadly6: (clashLike && hasRule(rules, 'Deadly Blades')) || (kind === 'volley' && hasRule(rules, 'Deadly Shot')),
    noDefenseOnOnes: (clashLike && hasRule(rules, 'Flawless Strikes')) || (kind === 'volley' && hasRule(rules, 'Precise Shot')),
    smite: clashLike && hasRule(rules, 'Smite'),
    torrential: kind === 'volley' && !!opts.effectiveRange && hasRule(rules, 'Torrential Fire'),
    // Relentless Blows / Rapid Volley at 6 or more (p.40, p.46, p.100); not for Impact Attacks.
    extraOnOne: kind !== 'impact' && kind !== 'special' && skill >= 6,
  };
}

/** Magnanimity (Sovereign Lineage): [Husk] Regiments attacking an enemy Below Starting Strength are Inspired and Aimed. */
export function magnanimity(s: GameState, r: RegimentState, target: RegimentState): boolean {
  if (sectOf(s, r.owner) !== 'sovereign' || !hasRole(r, 'Husk')) return false;
  return target.stands.length < target.startingStands || target.stands.some((x) => x.wounds > 0);
}
