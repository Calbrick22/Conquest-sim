import { useState } from 'react';
import { isImplemented } from '../engine/rules/special/registry';
import { allEntries } from '../import/parseList';
import { CHARACTERISTIC_KEYS, type ArmyList, type ListEntry, type RuleRef } from '../import/types';
import { parseStrainText } from '../import/strains';
import { parseRuleList } from '../import/ruleTokens';

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
              strain={list.strains?.[e.name]?.text ?? ''}
              onStrain={(text) =>
                update((l) => {
                  l.strains = { ...(l.strains ?? {}) };
                  if (text.trim()) l.strains[e.name] = parseStrainText(text);
                  else delete l.strains[e.name];
                })
              }
              glossary={list.glossary}
              tiers={list.tierProfiles?.[e.name] ?? {}}
              onTiers={(t) =>
                update((l) => {
                  l.tierProfiles = { ...(l.tierProfiles ?? {}), [e.name]: t };
                })
              }
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

type Tiers = NonNullable<ArmyList['tierProfiles']>[string];

/**
 * Profiles for Fallen Pantheon Tiers II and III (Old Dominion Fallen Divinity, od p.7, p.12),
 * read from the export's Tier blocks and editable here; they stay on this device with the list.
 */
function TierEditor({ entry, tiers, onTiers }: { entry: ListEntry; tiers: Tiers; onTiers: (t: Tiers) => void }) {
  const set = (tier: string, mut: (d: { stats: Record<string, number>; rules: string[] }) => void) => {
    const next = structuredClone(tiers);
    const d = next[tier] ?? { stats: {}, rules: [] };
    mut(d);
    next[tier] = d;
    onTiers(next);
  };
  return (
    <div className="tiers" data-testid={`tiers-${entry.name}`}>
      <p className="meta">Fallen Pantheon Tier profiles, read from the export&apos;s “(Tier II)” and “(Tier III)” blocks. Correct them here if needed; blank values keep the Tier I profile.</p>
      {['2', '3'].map((t) => (
        <div key={t}>
          <strong>Tier {t === '2' ? 'II' : 'III'}</strong>
          <table className="stats">
            <thead><tr>{CHARACTERISTIC_KEYS.map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>
              <tr>
                {CHARACTERISTIC_KEYS.map((k) => (
                  <td key={k}>
                    <input
                      inputMode="numeric"
                      aria-label={`Tier ${t} ${k}`}
                      value={tiers[t]?.stats[k] ?? ''}
                      placeholder={String(entry.stats[k] ?? '-')}
                      onChange={(e) =>
                        set(t, (d) => {
                          if (e.target.value === '' || Number.isNaN(Number(e.target.value))) delete d.stats[k];
                          else d.stats[k] = Number(e.target.value);
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <label className="field">
            Rules that change{' '}
            <input className="grow" defaultValue={(tiers[t]?.rules ?? []).join(', ')} placeholder="Cleave (2), Brutal Impact (2)" onBlur={(e) => set(t, (d) => (d.rules = parseRuleList(e.target.value).map((r) => r.raw)))} />
          </label>
        </div>
      ))}
    </div>
  );
}

function EntryEditor({
  entry,
  glossary,
  onChange,
  strain,
  onStrain,
  tiers,
  onTiers,
}: {
  entry: ListEntry;
  glossary: Record<string, string>;
  onChange: (e: ListEntry) => void;
  strain: string;
  onStrain: (t: string) => void;
  tiers: Tiers;
  onTiers: (t: Tiers) => void;
}) {
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
        {entry.drawEvents.some((d) => d.startsWith('Strain Expression')) && (
          <label className="field" data-testid={`strain-${entry.name}`}>
            Strain ability{' '}
            <span className="meta">(not in the export: type it from your faction book, e.g. “+1 Clash, Flurry” or “enemy -1 Clash”)</span>
            {!strain && <span className="badge manual">not entered: Strain Expression gives only Decay</span>}
            <input className="grow" value={strain} onChange={(e) => onStrain(e.target.value)} placeholder="+1 Clash, Flurry, enemy -1 Clash" />
            {strain && (
              <span className="meta">
                {' '}
                → {Object.entries(parseStrainText(strain).stats).map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`).join(', ')} {parseStrainText(strain).rules.join(', ')}
                {Object.entries(parseStrainText(strain).enemyStats ?? {}).map(([k, v]) => ` · enemies in contact ${k}${v > 0 ? '+' : ''}${v}`).join('')}
              </span>
            )}
          </label>
        )}
        {entry.specialRules.some((r) => r.name === 'Font of Dark Power') && <TierEditor entry={entry} tiers={tiers} onTiers={onTiers} />}
        {entry.memories && entry.memories.length > 0 && <div className="rules"><span className="meta">Memories of Old:</span>{entry.memories.map((r, i) => <RuleChip key={i} r={r} glossary={glossary} />)}</div>}
        {entry.memoriesText && <p><span className="meta">Memories of Old:</span> {entry.memoriesText}</p>}
        {named('Spells', entry.spells ?? [])}
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
