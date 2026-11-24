import { useEffect, useRef, useState } from 'react';
import { listGames, type SavedGame } from '../../storage/db';

/** Title screen: the first screen of the flow (title → new game → battle → summary). */
export function TitleScreen({ onSettings }: { onSettings: () => void }) {
  const [latest, setLatest] = useState<SavedGame | null>(null);
  const menu = useRef<HTMLElement>(null);
  // Focus the first menu choice when the screen opens (game-ui-ux: focus on open).
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>('.menu-item')?.focus();
  }, [latest]);
  useEffect(() => {
    listGames()
      .then((gs) => setLatest([...gs].filter((g) => !g.ended).sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0] ?? null))
      .catch(() => setLatest(null));
  }, []);
  return (
    <section className="title-screen" data-testid="title-screen">
      <div className="title-crest" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="72" height="72">
          <path d="M32 4 L56 14 V32 C56 46 45 56 32 60 C19 56 8 46 8 32 V14 Z" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <path d="M20 22 L44 46 M44 22 L20 46" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <circle cx="32" cy="34" r="4" fill="currentColor" />
        </svg>
      </div>
      <h1 className="title-name">Conquest Sim</h1>
      <p className="title-sub">The Last Argument of Kings · battle rehearsal</p>
      <nav className="title-menu" aria-label="Main menu" ref={menu}>
        {latest && (
          <a className="menu-item primary" href={`#play/resume/${latest.id}`} data-testid="continue">
            <span>Continue</span>
            <small>
              {latest.name} · Round {Math.min(latest.round, latest.initial.scenario.rounds)} · {latest.vp.P1}–{latest.vp.P2}
            </small>
          </a>
        )}
        <a className={`menu-item ${latest ? '' : 'primary'}`} href="#play" data-testid="new-battle">
          <span>New battle</span>
          <small>Choose armies, scenario, terrain and opponent</small>
        </a>
        <a className="menu-item" href="#lists">
          <span>Army lists</span>
          <small>Import and review your lists</small>
        </a>
        <a className="menu-item" href="#scenarios">
          <span>Scenarios</span>
          <small>The tournament pack and the 2026 scenarios</small>
        </a>
        <button type="button" className="menu-item" onClick={onSettings} data-testid="open-settings">
          <span>Settings</span>
          <small>Text size, motion, confirmations</small>
        </button>
      </nav>
      <p className="title-foot">Unofficial fan tool. Unit data comes from your own army list files.</p>
    </section>
  );
}
