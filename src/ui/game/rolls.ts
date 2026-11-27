import type { GameEvent } from '../../engine/game';
import type { PlayerId } from '../../engine/model/types';

/**
 * Turns an Action's events into what the dice box and the callout show: one step per roll (with
 * each die coloured pass or fail), and one short summary per attack (Hits, saves, Wounds, Morale,
 * Stands lost). Reads only the engine's own log; nothing is re-rolled here.
 */

export type RollKind = 'hit' | 'save' | 'morale' | 'other';

export interface RollStep {
  /** Index of the event in the Action's events. */
  at: number;
  kind: RollKind;
  title: string;
  values: number[];
  /** Pass or fail for each die (first roll; re-rolls are described in `notes`). */
  pass: boolean[];
  /** The number to roll on or under, when known. */
  need: number | null;
  /** Whose dice these are. */
  owner: PlayerId | null;
  outcome: string;
  notes: string[];
}

export interface AttackSummary {
  title: string;
  target: string;
  hits: number;
  hitDice: number;
  hitNeed: number | null;
  saveDice: number;
  saveNeed: number | null;
  saved: number;
  wounds: number;
  moraleDice: number;
  moraleExtra: number;
  standsLost: number;
  destroyed: boolean;
}

const num = (re: RegExp, t: string) => {
  const m = t.match(re);
  return m ? Number(m[1]) : null;
};

function kindOf(purpose: string): RollKind {
  if (/to hit$/i.test(purpose) || /Duel to hit/i.test(purpose)) return 'hit';
  if (/Defense|Evasion|Untouchable/i.test(purpose)) return 'save';
  if (/Morale|Resolve/i.test(purpose)) return 'morale';
  return 'other';
}

/** Characteristic Tests pass on the target or less; 1 always passes and 6 always fails, except Defense where 1 is not automatic (core p.10, p.40). */
function passes(values: number[], need: number | null, kind: RollKind): boolean[] {
  if (need === null) return values.map(() => true);
  return values.map((d) => (kind === 'save' ? d !== 6 && need > 0 && d <= need : d === 1 || (d !== 6 && d <= need)));
}

export function rollSteps(events: GameEvent[]): RollStep[] {
  const out: RollStep[] = [];
  events.forEach((e, at) => {
    const d = e.dice;
    if (!d) return;
    const kind = kindOf(d.purpose);
    const need = num(/target (\d+)/, (d.notes ?? []).join(' ')) ?? num(/needing (\d+) or less/, e.text) ?? num(/on (\d+) or less/, e.text);
    const notes = (d.notes ?? []).filter((n) => !/^target /.test(n) && !/^\d+ pass/.test(n));
    let outcome: string;
    if (kind === 'hit') outcome = `${num(/→ (\d+) Hits?/, e.text) ?? num(/: (\d+) Hits?/, e.text) ?? passes(d.values, need, kind).filter(Boolean).length} Hits`;
    else if (kind === 'save') {
      // The note that follows the save roll gives the saves and Wounds.
      const next = events.slice(at + 1).find((x) => /saves on \d+ or less/.test(x.text));
      outcome = next ? `${num(/(\d+) saved/, next.text) ?? 0} saved · ${num(/(\d+) Wounds?/, next.text) ?? 0} Wounds` : `${passes(d.values, need, kind).filter(Boolean).length} saved`;
    } else if (kind === 'morale') {
      const extra = num(/→ (\d+) more Wounds?/, e.text) ?? num(/\+(\d+) Wounds?/, e.text) ?? 0;
      outcome = `${num(/(\d+) failed/, e.text) ?? passes(d.values, need, kind).filter((p) => !p).length} failed · +${extra} Wounds`;
    } else outcome = e.text;
    out.push({ at, kind, title: d.purpose, values: d.values, pass: passes(d.values, need, kind), need, owner: e.player ?? null, outcome, notes });
  });
  return out;
}

/** One line per attack: Hits, saves, Wounds, Morale and losses. */
export function attackSummaries(events: GameEvent[]): AttackSummary[] {
  const out: AttackSummary[] = [];
  const cur = (): AttackSummary | undefined => out[out.length - 1];
  const start = (title: string): AttackSummary => {
    const a: AttackSummary = { title, target: '', hits: 0, hitDice: 0, hitNeed: null, saveDice: 0, saveNeed: null, saved: 0, wounds: 0, moraleDice: 0, moraleExtra: 0, standsLost: 0, destroyed: false };
    out.push(a);
    return a;
  };
  for (const e of events) {
    const k = e.dice ? kindOf(e.dice.purpose) : null;
    if (k === 'hit') {
      const a = start(e.dice!.purpose.replace(/ to hit$/i, '').replace(/^[^:]*: /, ''));
      a.hitDice = e.dice!.values.length;
      a.hitNeed = num(/needing (\d+) or less/, e.text) ?? num(/target (\d+)/, (e.dice!.notes ?? []).join(' '));
      a.hits = num(/→ (\d+) Hits?/, e.text) ?? num(/: (\d+) Hits?/, e.text) ?? 0;
      continue;
    }
    const saveNote = e.text.match(/^(.*) saves on (\d+) or less.*: (\d+) saved, (\d+) Wounds?/);
    if (saveNote) {
      // Automatic Hits (Impact, Aura of Death, Spells…) have no hit roll: their total is saved + Wounds.
      const c = cur();
      const a = c && !c.target ? c : start('Automatic Hits');
      if (!a.hitDice) a.hits = Number(saveNote[3]) + Number(saveNote[4]);
      a.target = saveNote[1]!;
      a.saveNeed = Number(saveNote[2]);
      a.saved += Number(saveNote[3]);
      a.wounds += Number(saveNote[4]);
      continue;
    }
    const c = cur();
    if (!c) continue;
    if (k === 'save') c.saveDice += e.dice!.values.length;
    else if (k === 'morale') {
      c.moraleDice += e.dice!.values.length;
      c.moraleExtra += num(/→ (\d+) more Wounds?/, e.text) ?? num(/\+(\d+) Wounds?/, e.text) ?? 0;
    } else if (e.type === 'casualty' && /loses a Stand/.test(e.text)) c.standsLost += 1;
    else if (e.type === 'destroyed' && c.target && e.text.startsWith(c.target)) c.destroyed = true;
  }
  return out.filter((a) => a.hitDice > 0 || a.target);
}

/**
 * Does the player roll these dice themselves? Every roll that belongs to a human player: their own
 * attacks, Charges, Spells and Reinforcements, and their saves and Morale against the other side.
 * Rolls with no owner in the log (Duels) belong to whoever took the Action.
 */
export function playerRolls(step: RollStep, human: PlayerId[], actor: PlayerId | null): boolean {
  const owner = step.owner ?? actor;
  return !!owner && human.includes(owner);
}
