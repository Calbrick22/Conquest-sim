import { Modal } from './overlay';
import { useSettings } from './settings';

/** Settings (saved on this device). Presentation only: none of these change the rules. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, update } = useSettings();
  return (
    <Modal title="Settings" onClose={onClose} className="settings">
      <div className="settings-grid" data-testid="settings">
        <label className="setting">
          <span>
            Text size <strong>{Math.round(settings.textScale * 100)}%</strong>
          </span>
          <input type="range" min={0.9} max={2} step={0.1} value={settings.textScale} onChange={(e) => update({ textScale: Number(e.target.value) })} data-autofocus aria-label="Text size" />
        </label>
        <Toggle label="Reduce motion" hint="No sliding or fading notifications." on={settings.reduceMotion} set={(v) => update({ reduceMotion: v })} />
        <Toggle label="Confirm ending an Activation early" hint="Ask before ending an Activation with Actions left." on={settings.confirmEarlyEnd} set={(v) => update({ confirmEarlyEnd: v })} />
        <Toggle label="Stand role icons" hint="Bow, swords or star on each Stand." on={settings.standIcons} set={(v) => update({ standIcons: v })} />
        <Toggle label="Odds before rolling" hint="Expected Wounds and chances while choosing a target." on={settings.previews} set={(v) => update({ previews: v })} />
        <Toggle label="Portrait table on phones" hint="Turn the table so its long side runs down the screen." on={settings.portraitTable} set={(v) => update({ portraitTable: v })} />
      </div>
      <h3>Keyboard</h3>
      <dl className="keys">
        <dt>Esc</dt>
        <dd>Pause menu / close</dd>
        <dt>Enter</dt>
        <dd>Next (computer's turn)</dd>
        <dt>D</dt>
        <dd>Draw a Command Card</dd>
        <dt>E</dt>
        <dd>End the Activation</dd>
        <dt>R · G · T</dt>
        <dd>Ruler · Charge reach · Threats</dd>
        <dt>Ctrl+Z</dt>
        <dd>Undo</dd>
      </dl>
      <div className="actions end">
        <button type="button" onClick={onClose} data-testid="settings-done">
          Done
        </button>
      </div>
    </Modal>
  );
}

function Toggle({ label, hint, on, set }: { label: string; hint: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="setting toggle">
      <span>
        {label}
        <small className="meta">{hint}</small>
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => set(e.target.checked)} />
    </label>
  );
}
