/**
 * Strain abilities are not in the Army Builder export (AMB-18), so the owner types them on the
 * review screen, e.g. "+1 Clash, +1 Attacks, Flurry, Cleave (1)". Characteristic changes become
 * until-end-of-Round modifiers; anything else is read as a special rule gained.
 */
import { parseRuleRef, splitTopLevel } from './ruleTokens';

const STAT: Record<string, string> = {
  m: 'M', march: 'M', v: 'V', volley: 'V', c: 'C', clash: 'C', a: 'A', attack: 'A', attacks: 'A',
  w: 'W', wound: 'W', wounds: 'W', r: 'R', resolve: 'R', d: 'D', defense: 'D', defence: 'D', e: 'E', evasion: 'E',
};

export interface ParsedStrain {
  stats: Record<string, number>;
  rules: string[];
  text: string;
}

export function parseStrainText(text: string): ParsedStrain {
  const stats: Record<string, number> = {};
  const rules: string[] = [];
  for (const part of splitTopLevel(text)) {
    const p = part.trim();
    const a = p.match(/^([+-]\s*\d+)\s*([a-z]+)$/i);
    const b = p.match(/^([a-z]+)\s*([+-]\s*\d+)$/i);
    const m = a ? { n: a[1]!, k: a[2]! } : b ? { n: b[2]!, k: b[1]! } : null;
    const key = m ? STAT[m.k.toLowerCase()] : undefined;
    if (m && key) stats[key] = (stats[key] ?? 0) + Number(m.n.replace(/\s/g, ''));
    else if (p) rules.push(parseRuleRef(p).raw);
  }
  return { stats, rules, text: text.trim() };
}
