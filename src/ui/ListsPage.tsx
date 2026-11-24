import { useEffect, useState } from 'react';
import { parseArmyList } from '../import/parseList';
import type { ArmyList } from '../import/types';
import { deleteList, listLists, newId, saveList, type SavedList } from '../storage/db';
import { ListReview } from './ListReview';
import { useConfirm } from './shell/overlay';

type Draft = { id: string; source: 'pdf' | 'text'; list: ArmyList };

export function ListsPage() {
  const [saved, setSaved] = useState<SavedList[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const refresh = () => listLists().then(setSaved).catch((e: unknown) => setError(String(e)));
  useEffect(() => {
    refresh();
  }, []);

  const importText = (text: string, source: 'pdf' | 'text') => {
    const list = parseArmyList(text);
    if (list.warbands.length === 0) {
      setError('No Warbands found. Is this an Army Builder export?');
      return;
    }
    setError(null);
    setDraft({ id: newId(), source, list });
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const { pdfToText } = await import('../import/pdfText');
        importText(await pdfToText(await file.arrayBuffer()), 'pdf');
      } else importText(await file.text(), 'text');
    } catch (e) {
      setError(`Could not read ${file.name}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (draft) {
    return (
      <section>
        <h2>Review imported list</h2>
        <div className="actions sticky">
          <button
            type="button"
            data-testid="save-list"
            onClick={async () => {
              await saveList({ id: draft.id, name: draft.list.title || 'Untitled list', savedAt: new Date().toISOString(), source: draft.source, list: draft.list });
              setDraft(null);
              refresh();
            }}
          >
            Save list
          </button>
          <button type="button" className="secondary" onClick={() => setDraft(null)}>Cancel</button>
        </div>
        <ListReview list={draft.list} onChange={(list) => setDraft({ ...draft, list })} />
      </section>
    );
  }

  return (
    <section>
      <h2>Army lists</h2>
      <div className="card">
        <h3>Import</h3>
        <p className="meta">Army Builder PDF export, a .txt file, or pasted text. Files stay on this device.</p>
        <label className="file">
          <input type="file" accept=".pdf,.txt,application/pdf,text/plain" data-testid="list-file" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </label>
        <textarea rows={4} placeholder="…or paste list text here" value={paste} onChange={(e) => setPaste(e.target.value)} data-testid="list-paste" />
        <button type="button" disabled={!paste.trim()} onClick={() => importText(paste, 'text')} data-testid="parse-paste">Read pasted text</button>
        {busy && <p>Reading…</p>}
        {error && <p className="warn">{error}</p>}
      </div>
      <div className="card">
        <h3>Saved lists</h3>
        {saved.length === 0 && <p className="meta">None yet.</p>}
        <ul className="plain saved">
          {saved.map((s) => (
            <li key={s.id}>
              <button type="button" className="link" onClick={() => setDraft({ id: s.id, source: s.source, list: s.list })}>
                {s.name}
              </button>{' '}
              <span className="meta">{s.list.faction} · {s.list.points ?? '?'} pts · {new Date(s.savedAt).toLocaleDateString()}</span>{' '}
              <button type="button" className="secondary small" onClick={() => confirm.ask({ title: 'Delete army list?', body: `${s.name} will be removed from this device.`, confirmLabel: 'Delete', danger: true }, () => { void deleteList(s.id).then(refresh); })}>Delete</button>
            </li>
          ))}
        </ul>
      </div>
      {confirm.dialog}
    </section>
  );
}
