import { useEffect, useState } from 'react';
import { GamePage } from './game/GamePage';
import { ListsPage } from './ListsPage';
import { ScenarioPreview } from './ScenarioPreview';
import { SettingsProvider } from './shell/settings';
import { SettingsDialog } from './shell/SettingsDialog';
import { TitleScreen } from './shell/TitleScreen';

type Page = 'home' | 'play' | 'lists' | 'scenarios';
const PAGES: { id: Page; label: string }[] = [
  { id: 'play', label: 'Battle' },
  { id: 'lists', label: 'Army lists' },
  { id: 'scenarios', label: 'Scenarios' },
];

/** Base screens are routed by the URL hash (#home, #play, #play/resume/<id>, #lists, #scenarios). */
function route(): { page: Page; resume: string | null } {
  const h = location.hash.replace(/^#/, '');
  const [p, sub, id] = h.split('/');
  const page = (['home', 'play', 'lists', 'scenarios'] as const).find((x) => x === p) ?? 'home';
  return { page, resume: page === 'play' && sub === 'resume' && id ? id : null };
}

export function App() {
  const [r, setR] = useState(route);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const on = () => setR(route());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);

  return (
    <SettingsProvider>
      <main className={`app page-${r.page}`}>
        {r.page === 'home' ? (
          <TitleScreen onSettings={() => setSettingsOpen(true)} />
        ) : (
          <>
            <header className="shell-bar">
              <a href="#home" className="shell-home" aria-label="Back to the title screen">
                <span aria-hidden="true">◂</span> Conquest Sim
              </a>
              <nav className="tabs" aria-label="Sections">
                {PAGES.map((p) => (
                  <a key={p.id} href={`#${p.id}`} className={r.page === p.id ? 'active' : ''} aria-current={r.page === p.id ? 'page' : undefined}>
                    {p.label}
                  </a>
                ))}
              </nav>
              <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
                ⚙
              </button>
            </header>
            {r.page === 'play' && <GamePage resumeId={r.resume} onSettings={() => setSettingsOpen(true)} />}
            {r.page === 'lists' && <ListsPage />}
            {r.page === 'scenarios' && <ScenarioPreview />}
          </>
        )}
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      </main>
    </SettingsProvider>
  );
}
