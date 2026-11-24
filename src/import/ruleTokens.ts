import type { RuleRef } from './types';

/** Splits a comma-separated list at bracket depth 0. Handles (), [] and {}. */
export function splitTopLevel(text: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const RANGE_RE = /^(\d+(?:\.\d+)?)\s*(?:"|”|″|''|in)$/;

/** Parses one rule reference such as `Barrage (4) [14", Armor Piercing (2), Deadly Shot]`. */
export function parseRuleRef(rawInput: string): RuleRef {
  const raw = rawInput.replace(/\s+/g, ' ').trim();
  let rest = raw;
  let bracket: string | undefined;
  const b = rest.match(/\[(.*)\]\s*$/);
  if (b && b.index !== undefined) {
    bracket = b[1];
    rest = rest.slice(0, b.index).trim();
  }
  const ref: RuleRef = { name: rest, raw };
  const p = rest.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (p) {
    const inner = (p[2] ?? '').trim();
    const num = inner.match(/^(\+)?\s*(\d+)$/);
    ref.name = (p[1] ?? '').trim();
    if (num) {
      ref.x = Number(num[2]);
      if (num[1]) ref.plus = true;
    } else {
      ref.param = inner;
    }
  }
  if (bracket !== undefined) {
    const parts = splitTopLevel(bracket);
    const sub: RuleRef[] = [];
    for (const part of parts) {
      const r = part.match(RANGE_RE);
      if (r && ref.range === undefined) ref.range = Number(r[1]);
      else sub.push(parseRuleRef(part));
    }
    if (sub.length) ref.sub = sub;
  }
  return ref;
}

export function parseRuleList(text: string): RuleRef[] {
  return splitTopLevel(text).map(parseRuleRef);
}

/** Every rule name referenced, including nested ones (e.g. Armor Piercing inside Barrage). */
export function collectRuleNames(refs: RuleRef[], into = new Set<string>()): Set<string> {
  for (const r of refs) {
    into.add(r.name);
    if (r.sub) collectRuleNames(r.sub, into);
  }
  return into;
}
