import { collectRuleNames, parseRuleList, parseRuleRef, splitTopLevel } from './ruleTokens';
import type { ArmyList, Characteristics, ListEntry, RuleRef, Slot, Warband } from './types';

/**
 * Parser for the official Army Builder export layout (any faction).
 * Input is plain text with one PDF line per line (see pdfText.ts), or pasted text.
 *
 * The layout is a sequence of labelled blocks; see PLAN.md §5.1.
 */

const LABELS = [
  'Supremacy Abilities',
  'Draw Events',
  'Special Rules',
  'Actions',
  'Battlefield Role',
  'Command Models',
  'Options',
  'Spells',
  'Memories of Old',
  'Memory of Old',
] as const;
type Label = (typeof LABELS)[number];

const STAT_HEADER_RE = /^M\s+V\s+C\s+A\s+W\s+R\s+D\s+E\b/;
const ENTRY_HEADER_RE = /^(.+?)\s+(?:(Mainstay|Restricted)\s+)?(\d+)\s+(\d+)$/;
const WARBAND_RE = /^Warband\s+(\d+)$/;
const TITLE_RE = /^(.*?)\s+(\d+)\s*\/\s*(\d+)$/;
/** A profile line for one Tier of a Character, e.g. "Fallen Divinity (Tier II)" (Old Dominion export). */
const TIER_RE = /^(.+?)\s*\(Tier\s+(I|II|III|IV)\)$/;
const ROMAN: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4' };
const SENTENCE_START_RE = /^(This|Should|If|Each|Only|When|While|Up to|May|Must|A|An|Your)\b/;
/** Option groups whose names have more than one word (the group is otherwise the first word). */
const MULTI_WORD_GROUPS = ['Dark Blessings'];

function startsWithLabel(line: string): Label | null {
  for (const l of LABELS) if (line === l || line.startsWith(l + ' ') || line.startsWith(l + ':')) return l;
  return null;
}

function normaliseLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\u00a0\t]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '' && l !== '\f' && !/^\d{1,3}$/.test(l) && !/^Page \d+( of \d+)?$/i.test(l));
}

function isEntryHeader(lines: string[], i: number): boolean {
  const l = lines[i];
  const next = lines[i + 1];
  if (l === undefined || next === undefined || !ENTRY_HEADER_RE.test(l)) return false;
  // Entries with profiles by Tier put "<Name> (Tier I)" between the header and the stat header.
  return STAT_HEADER_RE.test(next) || (TIER_RE.test(next) && STAT_HEADER_RE.test(lines[i + 2] ?? ''));
}

/** "<8 values> Class <Class>" → stats and Class, with warnings. */
function parseStatLine(vl: string, warnings: string[]): { stats: Characteristics; cls: string | null; found: boolean } {
  const classM = vl.match(/^(.*?)\s*Class\s+(.+)$/);
  const valuesPart = classM ? (classM[1] ?? '') : vl;
  const c = classM ? (classM[2] ?? '').trim() : null;
  const toks = valuesPart.split(' ').filter(Boolean);
  if (toks.length !== 8) warnings.push(`Expected 8 characteristics, found ${toks.length}: "${valuesPart}"`);
  const keys = ['M', 'V', 'C', 'A', 'W', 'R', 'D', 'E'] as const;
  const stats = {} as Characteristics;
  keys.forEach((k, n) => (stats[k] = parseStat(toks[n], warnings, k)));
  return { stats, cls: c === '-' ? null : c, found: !!classM };
}

function isSentence(line: string): boolean {
  return /[.!?]$/.test(line) || SENTENCE_START_RE.test(line);
}

function parseStat(tok: string | undefined, warnings: string[], key: string): number | null {
  if (tok === undefined) {
    warnings.push(`Missing value for ${key}`);
    return null;
  }
  if (tok === '-' || tok === '–' || tok === '—') return null;
  const n = Number(tok);
  if (!Number.isFinite(n)) {
    warnings.push(`Could not read ${key} value "${tok}"`);
    return null;
  }
  return n;
}

function emptyEntry(name: string, slot: Slot, stands: number, points: number): ListEntry {
  return {
    name,
    slot,
    stands,
    points,
    type: '',
    cls: null,
    stats: { M: null, V: null, C: null, A: null, W: null, R: null, D: null, E: null },
    specialRules: [],
    drawEvents: [],
    actions: [],
    supremacyAbilities: [],
    commandModels: [],
    battlefieldRoles: [],
    options: {},
    notes: [],
    warnings: [],
  };
}

function splitNames(text: string): string[] {
  return splitTopLevel(text).map((s) => s.trim()).filter(Boolean);
}

export function parseArmyList(text: string): ArmyList {
  const lines = normaliseLines(text);
  const list: ArmyList = {
    title: '',
    faction: '',
    sect: null,
    points: null,
    pointsLimit: null,
    warbands: [],
    glossary: {},
    armyRules: '',
    warnings: [],
  };

  let i = 0;
  // --- Header: "<Title> <pts> / <limit>", faction line, optional sect line.
  const first = lines[0];
  if (first !== undefined) {
    const t = first.match(TITLE_RE);
    if (t) {
      list.title = (t[1] ?? '').trim();
      list.points = Number(t[2]);
      list.pointsLimit = Number(t[3]);
      i = 1;
    } else {
      list.warnings.push('No "<name> <points> / <limit>" title line found');
    }
  }
  const headerLines: string[] = [];
  while (i < lines.length && !WARBAND_RE.test(lines[i]!) && !isEntryHeader(lines, i)) {
    headerLines.push(lines[i]!);
    i++;
  }
  list.faction = headerLines[0] ?? list.title;
  list.sect = headerLines[1] ?? null;
  if (headerLines.length > 2) list.warnings.push(`Unrecognised header lines: ${headerLines.slice(2).join(' | ')}`);

  // --- Body: warbands and entries, until "Rules".
  let warband: Warband | null = null;
  let entry: ListEntry | null = null;
  let label: Label | null = null;
  let labelText = '';
  let optionGroup: string | null = null;
  let note: { target: string[]; text: string } | null = null;
  /** The Tier II+ profile being read (Old Dominion Fallen Divinity), if any. */
  let tierBlock: { stats: Characteristics; rules: RuleRef[] } | null = null;

  const flushLabel = () => {
    if (!entry || !label) return;
    const t = labelText.trim();
    // Inside a later Tier's profile, only its Special Rules are kept; the other blocks repeat Tier I.
    if (tierBlock && label !== 'Options') {
      if (label === 'Special Rules') tierBlock.rules.push(...parseRuleList(t));
      label = null;
      labelText = '';
      return;
    }
    switch (label) {
      case 'Special Rules':
        entry.specialRules.push(...parseRuleList(t));
        break;
      case 'Actions':
        entry.actions.push(...parseRuleList(t));
        break;
      case 'Draw Events':
        entry.drawEvents.push(...splitNames(t));
        break;
      case 'Supremacy Abilities':
        entry.supremacyAbilities.push(...splitNames(t));
        break;
      case 'Command Models':
        entry.commandModels.push(...splitNames(t));
        break;
      case 'Battlefield Role':
        entry.battlefieldRoles.push(...splitNames(t));
        break;
      case 'Spells':
        (entry.spells ??= []).push(...splitNames(t));
        break;
      // RULE-AMBIGUITY: AMB-47 — the export layout for Memories of Old and Spells is not known yet.
      case 'Memories of Old':
      case 'Memory of Old':
        // Old Dominion: either a list of rules gained, or a sentence describing the effect.
        if (/[.]/.test(t) || /\b(counts|may|gains|perform)\b/i.test(t)) entry.memoriesText = t.replace(/^:\s*/, '');
        else (entry.memories ??= []).push(...parseRuleList(t.replace(/^:\s*/, '')));
        break;
      case 'Options':
        break;
    }
    label = null;
    labelText = '';
  };
  const flushNote = () => {
    if (note) note.target.push(note.text.trim());
    note = null;
  };
  const flushEntry = () => {
    flushLabel();
    flushNote();
    optionGroup = null;
    entry = null;
    tierBlock = null;
  };

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === 'Rules' || line === 'Army Rules') break;

    const wb = line.match(WARBAND_RE);
    if (wb) {
      flushEntry();
      warband = { declaredSize: Number(wb[1]), character: null, regiments: [], restrictions: [] };
      list.warbands.push(warband);
      continue;
    }

    if (isEntryHeader(lines, i)) {
      flushEntry();
      const h = line.match(ENTRY_HEADER_RE)!;
      const slot: Slot = (h[2] as Slot | undefined) ?? 'Character';
      const e = emptyEntry((h[1] ?? '').trim(), slot, Number(h[3]), Number(h[4]));
      // An optional "<Name> (Tier I)" line: the main profile is Tier I (Old Dominion export).
      const off = TIER_RE.test(lines[i + 1]!) ? 1 : 0;
      // Stat header: "M V C A W R D E Type <Type>"
      const sh = lines[i + 1 + off]!;
      const typeM = sh.match(/Type\s+(.+)$/);
      if (typeM) e.type = (typeM[1] ?? '').trim();
      else e.warnings.push('Type not found');
      // Values: "<8 values> Class <Class>"
      const st = parseStatLine(lines[i + 2 + off] ?? '', e.warnings);
      if (st.found) e.cls = st.cls;
      else e.warnings.push('Class not found');
      e.stats = st.stats;
      i += 2 + off;

      if (!warband) {
        warband = { declaredSize: 0, character: null, regiments: [], restrictions: [] };
        list.warbands.push(warband);
        list.warnings.push('Entry found before any "Warband" line');
      }
      if (slot === 'Character') {
        if (warband.character) e.warnings.push('Second Character in the same Warband');
        if (!warband.character) warband.character = e;
        else warband.regiments.push(e);
      } else warband.regiments.push(e);
      entry = e;
      continue;
    }

    // A later Tier's profile: "<Name> (Tier II)", the stat header, then its values.
    const tm = entry ? line.match(TIER_RE) : null;
    if (tm && entry && STAT_HEADER_RE.test(lines[i + 1] ?? '')) {
      flushLabel();
      flushNote();
      label = null;
      const tier = ROMAN[tm[2]!]!;
      const st = parseStatLine(lines[i + 2] ?? '', entry.warnings);
      tierBlock = tier === '1' ? null : { stats: st.stats, rules: [] };
      if (tierBlock) (entry.tierProfiles ??= {})[tier] = tierBlock;
      i += 2;
      continue;
    }

    const lab = startsWithLabel(line);
    if (lab && entry) {
      flushLabel();
      flushNote();
      optionGroup = null;
      if (lab === 'Options') tierBlock = null;
      label = lab;
      labelText = line.slice(lab.length).replace(/^:/, '').trim();
      continue;
    }

    // A Memories of Old sentence wraps over several lines until it ends with a full stop.
    // The label may also stand alone with the sentence on the next lines.
    if ((label === 'Memories of Old' || label === 'Memory of Old') && entry && (labelText === '' || /\b(counts|may|gains|perform)\b/i.test(labelText)) && !/[.]$/.test(labelText)) {
      labelText += ' ' + line;
      continue;
    }

    // Free-text notes (warband restrictions, per-entry notes), possibly wrapped.
    if (note) {
      const open: { target: string[]; text: string } = note;
      if (!/[.!?]$/.test(open.text)) {
        open.text += ' ' + line;
        continue;
      }
    }
    if (isSentence(line) && (label !== 'Options' || /[.!?]$/.test(line) || SENTENCE_START_RE.test(line))) {
      flushLabel();
      flushNote();
      tierBlock = null;
      const target = /^This Warband\b/.test(line) && warband ? warband.restrictions : entry ? entry.notes : list.warnings;
      note = { target, text: line };
      continue;
    }

    if (label === 'Options' && entry) {
      // "<Group> <item>, <item>" — group is the first word, unless it is a known multi-word group.
      const multi = MULTI_WORD_GROUPS.find((g) => line.startsWith(g + ' '));
      const sp = multi ? multi.length : line.indexOf(' ');
      if (sp > 0) {
        optionGroup = line.slice(0, sp);
        const items = splitNames(line.slice(sp + 1));
        entry.options[optionGroup] = [...(entry.options[optionGroup] ?? []), ...items];
      } else if (optionGroup) {
        entry.options[optionGroup] = [...(entry.options[optionGroup] ?? []), line];
      } else entry.warnings.push(`Unreadable option line "${line}"`);
      continue;
    }

    if (label) {
      // Wrapped continuation of a labelled list, e.g. "Impact" + "(2), Shield".
      labelText += ' ' + line;
      continue;
    }

    (entry ? entry.warnings : list.warnings).push(`Unrecognised line: "${line}"`);
  }
  flushEntry();

  // Tier profiles printed in the export become the list's Tier profiles (editable on review).
  for (const w of list.warbands)
    for (const e of [w.character, ...w.regiments]) {
      if (!e?.tierProfiles) continue;
      const out: NonNullable<ArmyList['tierProfiles']>[string] = {};
      for (const [t, d] of Object.entries(e.tierProfiles)) {
        const stats: Record<string, number> = {};
        for (const [k, v] of Object.entries(d.stats)) if (v !== null) stats[k] = v;
        out[t] = { stats, rules: d.rules.map((r) => r.raw) };
      }
      list.tierProfiles = { ...(list.tierProfiles ?? {}), [e.name]: out };
    }

  // --- Glossary ("Rules") and "Army Rules".
  const known = new Set<string>();
  for (const w of list.warbands) {
    for (const e of [w.character, ...w.regiments]) {
      if (!e) continue;
      collectRuleNames(e.specialRules, known);
      collectRuleNames(e.actions, known);
      for (const a of e.actions) known.add(a.raw);
      for (const n of [...e.drawEvents, ...e.supremacyAbilities, ...e.commandModels]) known.add(n);
      for (const items of Object.values(e.options)) for (const n of items) known.add(n);
    }
  }
  if (lines[i] === 'Rules') {
    i++;
    let heading: string | null = null;
    let body: string[] = [];
    const flush = () => {
      if (heading !== null) list.glossary[heading] = joinWrapped(body);
      heading = null;
      body = [];
    };
    for (; i < lines.length; i++) {
      const line = lines[i]!;
      if (line === 'Army Rules') break;
      const name = glossaryHeading(line, known, body.length === 0 ? null : body[body.length - 1]!);
      if (name !== null && heading !== null && body.length === 0) {
        // Two headings in a row: the previous one had no text, so this is wrapped text.
        body.push(line);
        continue;
      }
      if (name !== null) {
        flush();
        heading = name;
        continue;
      }
      if (heading === null) list.warnings.push(`Glossary text without heading: "${line}"`);
      else body.push(line);
    }
    flush();
  }
  if (lines[i] === 'Army Rules') list.armyRules = joinWrapped(lines.slice(i + 1));

  // Cross-checks.
  for (const w of list.warbands) {
    if (!w.character) list.warnings.push('A Warband has no Character');
  }
  return list;
}

/** Returns the glossary key if this line is a rule heading, else null. */
function glossaryHeading(line: string, known: Set<string>, prevBodyLine: string | null): string | null {
  const stripped = line.replace(/\s+X$/, '');
  if (known.has(line)) return line;
  if (known.has(stripped)) return stripped;
  // Unreferenced headings (e.g. sect rules): short Title Case line after a finished sentence.
  const titleCase = /^[A-Z][\w'’-]*(\s+(?:[A-Z(][\w'’()-]*|of|the|and|X))*$/.test(line);
  const finished = prevBodyLine === null || /[.)"”:]$/.test(prevBodyLine);
  if (titleCase && line.split(' ').length <= 5 && finished) return stripped;
  return null;
}

/** Re-joins PDF-wrapped lines: a line break is kept only after a sentence end or a colon. */
function joinWrapped(lines: string[]): string {
  let out = '';
  for (const l of lines) {
    if (!out) out = l;
    else out += /[.:!?]$/.test(out) || /^[A-Z][A-Z' ]+$/.test(l) || /^[A-Z][A-Z' ]+$/.test(out.split('\n').pop() ?? '') ? '\n' + l : ' ' + l;
  }
  return out.trim();
}

/** Convenience: every entry in list order (Characters first within each Warband). */
export function allEntries(list: ArmyList): ListEntry[] {
  return list.warbands.flatMap((w) => (w.character ? [w.character, ...w.regiments] : w.regiments));
}

export { parseRuleRef };
