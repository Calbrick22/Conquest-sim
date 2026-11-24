import { Modal } from '../shell/overlay';

/** Pause menu (Esc or ☰): the battle waits underneath; the computer is paused while it is open. */
export function PauseMenu({ onResume, onSettings, onExportReport, onExportGame, onQuit }: { onResume: () => void; onSettings: () => void; onExportReport: () => void; onExportGame: () => void; onQuit: () => void }) {
  return (
    <Modal title="Paused" onClose={onResume} className="pause-menu">
      <nav className="menu-list" data-testid="pause-menu">
        <button type="button" onClick={onResume} data-autofocus data-testid="resume">
          Resume
        </button>
        <button type="button" className="secondary" onClick={onSettings}>
          Settings
        </button>
        <button type="button" className="secondary" onClick={onExportReport}>
          Export battle report (Markdown)
        </button>
        <button type="button" className="secondary" onClick={onExportGame}>
          Save game file (.json)
        </button>
        <button type="button" className="danger" onClick={onQuit} data-testid="quit">
          Save and quit to title
        </button>
      </nav>
      <p className="meta">The battle is saved on this device after every Action.</p>
    </Modal>
  );
}
