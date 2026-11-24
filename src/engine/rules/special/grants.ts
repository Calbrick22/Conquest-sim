import type { RuleRef } from '../../../import/types';
import { parseRuleRef } from '../../../import/ruleTokens';
import type { CharacterState, GameState, PlayerId, RegimentState, StatMod } from '../../model/types';
import { odCharacterGrants, odRegimentGrants } from '../../factions/oldDominion';

/**
 * Effective special rules and Draw Events (recomputed after every Action):
 * a Regiment's own rules + rules granted by its attached Character, by its army (Sect, Warlord
 * Supremacy) and until the end of the Round (roundRules).
 *
 * Faction effects here implement the mechanics described by the rule text in the owner's
 * imported list (Spires), named by the rule's name. Page references are to the core rulebook
 * where the granted rule is defined.
 */
const ref = (raw: string): RuleRef => parseRuleRef(raw);

const has = (names: readonly string[], n: string) => names.some((x) => x.toLowerCase() === n.toLowerCase());

export function sectOf(s: GameState, p: PlayerId): 'directorate' | 'underspires' | 'sovereign' | null {
  const sect = (s.players[p].sect ?? '').toLowerCase();
  if (sect.includes('directorate')) return 'directorate';
  if (sect.includes('underspires')) return 'underspires';
  if (sect.includes('sovereign')) return 'sovereign';
  return null;
}

export function hasRole(r: RegimentState, role: string): boolean {
  return [...r.roles, ...(r.roundRoles ?? []), ...(r.grantRoles ?? [])].some((x) => x.replace(/[[\]]/g, '').toLowerCase() === role.toLowerCase());
}

function warlordAbilities(s: GameState, p: PlayerId): string[] {
  const w = Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p));
  return w ? w.supremacyAbilities : [];
}

function characterGrants(c: CharacterState, r: RegimentState): { rules: RuleRef[]; drawEvents: string[]; charRules: RuleRef[] } {
  const names = [...c.baseRules.map((x) => x.name), ...c.options];
  const rules: RuleRef[] = [];
  const drawEvents: string[] = [];
  const charRules: RuleRef[] = [];
  // Imposing Excellence: the Character and its [Husk] Regiment gain Parry (core p.100).
  if (has(names, 'Imposing Excellence')) {
    charRules.push(ref('Parry'));
    if (hasRole(r, 'Husk')) rules.push(ref('Parry'));
  }
  // Ceaseless Hunt: the Regiment gains the Fire and Advance Draw Event (core p.94).
  if (has(names, 'Ceaseless Hunt')) drawEvents.push('Fire and Advance');
  // Ferro-Ossified Carapace: the Regiment gains a Draw Event giving Hardened (1) until the end of the Round.
  if (has(names, 'Ferro-Ossified Carapace')) drawEvents.push('Ferro-Ossified Carapace');
  // Forward Force (core p.98) / Forlorn Drive ([Drone] or [Clone]): Flank (core p.98).
  if (has(names, 'Forward Force') && r.type !== 'Monster') rules.push(ref('Flank'));
  if (has(names, 'Forlorn Drive') && (hasRole(r, 'Drone') || hasRole(r, 'Clone'))) rules.push(ref('Flank'));
  return { rules, drawEvents, charRules };
}

function dedupe(rules: RuleRef[]): RuleRef[] {
  const seen = new Set<string>();
  return rules.filter((r) => (seen.has(r.raw) ? false : (seen.add(r.raw), true)));
}

export function refreshRules(s: GameState): void {
  const charRuleAdds = new Map<string, RuleRef[]>();
  for (const r of Object.values(s.regiments)) {
    const rules: RuleRef[] = [...r.baseRules, ...r.roundRules];
    const drawEvents: string[] = [...r.baseDrawEvents];
    const c = Object.values(s.characters).find((x) => x.attachedTo === r.id && !x.destroyed);
    if (c) {
      const g = characterGrants(c, r);
      rules.push(...g.rules);
      drawEvents.push(...g.drawEvents);
      charRuleAdds.set(c.id, g.charRules);
    }
    // Remorseless Hunter [Always Active]: friendly [Husk] Regiments gain Designate Target.
    if (has(warlordAbilities(s, r.owner), 'Remorseless Hunter') && hasRole(r, 'Husk')) rules.push(ref('Designate Target'));
    const sect = sectOf(s, r.owner);
    if (has(r.baseRules.map((x) => x.name), 'Just Desserts')) {
      if (sect === 'sovereign') rules.push(ref('Hardened (1)'));
      if (sect === 'underspires') drawEvents.push('Regeneration (2)');
    }
    // Violent Delirium (Underspires): [Drone] and [Clone] Regiments gain Regeneration (+2).
    if (sect === 'underspires' && (hasRole(r, 'Drone') || hasRole(r, 'Clone'))) drawEvents.push('Regeneration (+2)');
    // Old Dominion faction rules (od p.5–21).
    r.rules = dedupe(rules);
    const og = odRegimentGrants(s, r);
    r.grantRoles = og.roles;
    rules.push(...og.rules);
    drawEvents.push(...og.drawEvents);
    let eff = dedupe(rules);
    if (og.removeBrittle) eff = eff.filter((x) => x.name !== 'Brittle');
    r.rules = eff;
    r.grantMods = og.mods;
    r.drawEvents = [...new Set(drawEvents)];
  }
  for (const c of Object.values(s.characters)) {
    const og = odCharacterGrants(s, c);
    c.rules = dedupe([...c.baseRules, ...(charRuleAdds.get(c.id) ?? []), ...og.rules]);
    c.drawEvents = [...new Set([...(c.baseDrawEvents ?? c.drawEvents), ...og.drawEvents])];
    c.grantMods = og.mods as StatMod[];
  }
}

/**
 * List-building options that change a Character's profile (they count as unmodified, core p.15):
 * Cultivated Muscle Memory (+1 Clash); Avatar Projection (Type becomes Brute, Impact (3), +1 Clash
 * and +1 Attacks; can be bought more than once).
 */
export function applyCharacterOptions(c: CharacterState): void {
  const count = (n: string) => c.options.filter((o) => o.toLowerCase() === n.toLowerCase()).length;
  const cm = count('Cultivated Muscle Memory');
  if (cm && c.profile.C !== null) c.profile.C += cm;
  const ap = count('Avatar Projection');
  if (ap) {
    c.type = 'Brute';
    if (c.profile.C !== null) c.profile.C += ap;
    if (c.profile.A !== null) c.profile.A += ap;
    if (!c.baseRules.some((x) => x.name === 'Impact')) c.baseRules.push(ref('Impact (3)'));
  }
}
