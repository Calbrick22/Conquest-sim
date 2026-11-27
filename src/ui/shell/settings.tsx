import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** Player preferences, kept on this device (UI only: they never change the rules). */
export interface Settings {
  /** Text size, 0.9–2 (accessibility: scale to 200 %). */
  textScale: number;
  reduceMotion: boolean;
  /** Ask before ending an Activation with Actions left. */
  confirmEarlyEnd: boolean;
  standIcons: boolean;
  /** Turn the table to portrait by default. */
  portraitTable: boolean;
  /** Show the odds while choosing a Charge, Volley or Clash target. */
  previews: boolean;
  /** The dice box waits for the player to press Roll for every roll (the computer's included). */
  rollOwnDice: boolean;
  /** Desktop panel widths in CSS pixels (resizable). */
  sideWidth: number;
  leftWidth: number;
}

export const DEFAULT_SETTINGS: Settings = { textScale: 1, reduceMotion: false, confirmEarlyEnd: true, standIcons: true, portraitTable: false, previews: true, rollOwnDice: true, sideWidth: 440, leftWidth: 300 };

const KEY = 'conquest-settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const Ctx = createContext<{ settings: Settings; update: (p: Partial<Settings>) => void }>({ settings: DEFAULT_SETTINGS, update: () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(settings.textScale));
    root.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false';
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* per-device convenience only */
    }
  }, [settings]);
  return <Ctx.Provider value={{ settings, update: (p) => setSettings((s) => ({ ...s, ...p })) }}>{children}</Ctx.Provider>;
}

export function useSettings() {
  return useContext(Ctx);
}
