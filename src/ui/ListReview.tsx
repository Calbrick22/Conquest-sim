import { useState } from 'react';
import { isImplemented } from '../engine/rules/special/registry';
import { allEntries } from '../import/parseList';
import { CHARACTERISTIC_KEYS, type ArmyList, type ListEntry, type RuleRef } from '../import/types';

/** Review and correct a parsed list before saving or playing with it. */
export function ListReview({ list, onChange }: { list: ArmyList; onChange: (l: ArmyList) => void }) {
  const entries = allEntries(list);
  const totalWarnings = list.warnings.length + entries.reduce((n, e) => n + e.warnings.length, 0);
  const missingText = [...new Set(entries.flatMap((e) => e.specialRules.map((r) => r.name)))].filter((n) => !(n in list.glossary));

  const update = (mut: (l: ArmyList) => void) => {
    const copy: ArmyList = structuredClone(list);
    mut(copy);
    onChange(copy);
  };

  return (
    <div className="review" data-testid="list-review">
      <div className="card">
        <label className="field">
          List name <input value={list.title} onChange={(e) => update((l) => (l.title = e.target.value))} />
        </label>
        <p>
          <strong>{list.faction}</strong>
          {list.sect ? ` · ${list.sect}` : ''} · {list.points ?? '?'} / {list.pointsLimit ?? '?'} pts · {list.warbands.length} Warbands ·{' '}
          {entries.length} entries
        </p>
        {totalWarnings === 0 && missingText.length === 0 ? (
          <p className="ok">Everything was read cleanly.</p>
        ) : (
          <div className="warn" data-testid="parse-warnings">
            <strong>Check these ({totalWarnings + missingText.length}):</strong>
            <ul>
              {list.warnings.map((w, i) => (
                <li key={`l${i}`}>{w}</li>
              ))}
              {entries.flatMap((e) => e.warnings.map((w, i) => <li key={`${e.name}${i}`}>{e.name}: {w}</li>))}
              {missingText.map((n) => (
                <li key={n}>No rule text found for “{n}”</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {list.warbands.map((w, wi) => (
        <div key={wi} className="card">
          <h3>Warband {wi + 1}</h3>
          {w.restrictions.map((r, i) => (
            <p key={i} className="meta">{r}</p>
          ))}
          {(w.character ? [w.character, ...w.regiments] : w.regiments).map((e, ei) => (
            <EntryEditor
              key={ei}
              entry={e}
              glossary={list.glossary}
              onChange={(ne) =>
                update((l) => {
                  const wb = l.warbands[wi]!;
                  if (wb.character && ei === 0) wb.character = ne;
                  else wb.regiments[wb.character ? ei - 1 : ei] = ne;
                })
              }
            />
          ))}
        </div>
      ))}
      {list.armyRules && (
        <details className="card">
          <summary>Army Rules</summary>
          <p className="rule-text">{list.armyRules}</p>
        </details>
      )}
    </div>
  );
}

function RuleChip({ r, glossary }: { r: RuleRef; glossary: Record<string, string> }) {
  const impl = isImplemented(r.name);
  const text = glossary[r.name] ?? glossary[r.raw];
  return (
    <details className="rule">
      <summary>
        {r.raw} <span className={impl ? 'badge auto' : 'badge manual'}>{impl ? 'auto' : 'manual'}</span>
      </summary>
      <p className="rule-text">{text ?? 'No rule text in this list.'}</p>
      {r.sub?.map((s, i) => (
        <RuleChip key={i} r={s} glossary={glossary} />
      ))}
    </details>
  );
}

function EntryEditor({ entry, glossary, onChange }: { entry: ListEntry; glossary: Record<string, string>; onChange: (e: ListEntry) => void }) {
  const [open, setOpen] = useState(entry.warnings.length > 0);
  const set = (mut: (e: ListEntry) => void) => {
    const c = structuredClone(entry);
    mut(c);
    onChange(c);
  };
  const named = (label: string, items: string[]) =>
    items.length > 0 && (
      <p>
        <span className="meta">{label}:</span> {items.join(', ')}
      </p>
    );
  return (
    <details className={`entry ${entry.warnings.length ? 'has-warn' : ''}`} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <strong>{entry.name}</strong> <span className="meta">{entry.slot} · {entry.type} {entry.cls ?? ''} · {entry.stands} Stand{entry.stands === 1 ? '' : 's'} · {entry.points} pts</span>
        {entry.warnings.length > 0 && <span className="badge manual">check</span>}
      </summary>
      <div className="entry-body">
        <div className="row">
          <label className="field small">Stands <input type="number" min={1} value={entry.stands} onChange={(e) => set((x) => (x.stands = Number(e.target.value)))} /></label>
          <label className="field small">Type <input value={entry.type} onChange={(e) => set((x) => (x.type = e.target.value))} /></label>
          <label className="field small">Class <input value={entry.cls ?? ''} placeholder="-" onChange={(e) => set((x) => (x.cls = e.target.value || null))} /></label>
        </div>
        <table className="stats">
          <thead><tr>{CHARACTERISTIC_KEYS.map((k) => <th key={k}>{k}</th>)}</tr></thead>
          <tbody>
            <tr>
              {CHARACTERISTIC_KEYS.map((k) => (
                <td key={k}>
                  <input
                    inputMode="numeric"
                    aria-label={k}
                    value={entry.stats[k] ?? '-'}
                    onChange={(e) => set((x) => (x.stats[k] = e.target.value === '-' || e.target.value === '' ? null : Number(e.target.value)))}
                  />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        {entry.warnings.map((w, i) => <p key={i} className="warn">{w}</p>)}
        {entry.specialRules.length > 0 && <div className="rules">{entry.specialRules.map((r, i) => <RuleChip key={i} r={r} glossary={glossary} />)}</div>}
        {entry.actions.length > 0 && <div className="rules"><span className="meta">Actions:</span>{entry.actions.map((r, i) => <RuleChip key={i} r={r} glossary={glossary} />)}</div>}
        {named('Supremacy', entry.supremacyAbilities)}
        {named('Draw Events', entry.drawEvents)}
        {named('Command Models', entry.commandModels)}
        {named('Battlefield Role', entry.battlefieldRoles)}
        {Object.entries(entry.options).map(([g, items]) => named(g, items))}
        {entry.notes.map((n, i) => <p key={i} className="meta">{n}</p>)}
      </div>
    </details>
  );
}
