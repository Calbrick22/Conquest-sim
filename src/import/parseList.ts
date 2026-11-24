import { collectRuleNames, parseRuleList, parseRuleRef, splitTopLevel } from './ruleTokens';
import type { ArmyList, Characteristics, ListEntry, Slot, Warband } from './types';

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
] as const;
type Label = (typeof LABELS)[number];

const STAT_HEADER_RE = /^M\s+V\s+C\s+A\s+W\s+R\s+D\s+E\b/;
const ENTRY_HEADER_RE = /^(.+?)\s+(?:(Mainstay|Restricted)\s+)?(\d+)\s+(\d+)$/;
const WARBAND_RE = /^Warband\s+(\d+)$/;
const TITLE_RE = /^(.*?)\s+(\d+)\s*\/\s*(\d+)$/;
const SENTENCE_START_RE = /^(This|Should|If|Each|Only|When|While|Up to|May|Must)\b/;

function startsWithLabel(line: string): Label | null {
  for (const l of LABELS) if (line === l || line.startsWith(l + ' ')) return l;
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
  return l !== undefined && next !== undefined && ENTRY_HEADER_RE.test(l) && STAT_HEADER_RE.test(next);
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

  const flushLabel = () => {
    if (!entry || !label) return;
    const t = labelText.trim();
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
      // Stat header: "M V C A W R D E Type <Type>"
      const sh = lines[i + 1]!;
      const typeM = sh.match(/Type\s+(.+)$/);
      if (typeM) e.type = (typeM[1] ?? '').trim();
      else e.warnings.push('Type not found');
      // Values: "<8 values> Class <Class>"
      const vl = lines[i + 2] ?? '';
      const classM = vl.match(/^(.*?)\s*Class\s+(.+)$/);
      const valuesPart = classM ? (classM[1] ?? '') : vl;
      if (classM) {
        const c = (classM[2] ?? '').trim();
        e.cls = c === '-' ? null : c;
      } else e.warnings.push('Class not found');
      const toks = valuesPart.split(' ').filter(Boolean);
      if (toks.length !== 8) e.warnings.push(`Expected 8 characteristics, found ${toks.length}: "${valuesPart}"`);
      const keys = ['M', 'V', 'C', 'A', 'W', 'R', 'D', 'E'] as const;
      const stats = {} as Characteristics;
      keys.forEach((k, n) => (stats[k] = parseStat(toks[n], e.warnings, k)));
      e.stats = stats;
      i += 2;

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

    const lab = startsWithLabel(line);
    if (lab && entry) {
      flushLabel();
      flushNote();
      optionGroup = null;
      label = lab;
      labelText = line.slice(lab.length).trim();
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
      const target = /^This Warband\b/.test(line) && warband ? warband.restrictions : entry ? entry.notes : list.warnings;
      note = { target, text: line };
      continue;
    }

    if (label === 'Options' && entry) {
      // "<Group> <item>, <item>" — group is the first word.
      const sp = line.indexOf(' ');
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
