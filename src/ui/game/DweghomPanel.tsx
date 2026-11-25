import { useState } from 'react';
import { validate, type Action } from '../../engine/game';
import type { GameState, PlayerId } from '../../engine/model/types';
import { creeds, dw, empowerments, isAwakened, warlordHas } from '../../engine/factions/dweghom';
import { distancePolys, regimentPolys } from '../../engine/queries';

/**
 * Dweghom controls (dw p.4–45). The UI only shows state and dispatches Actions; the engine checks
 * and resolves them.
 */

/** Elemental Power pools, Creeds, and the Hold Raegh's two Regiments in the Supremacy Phase. */
export function ElementalPowerBar({ s, dispatch, aiPlayer }: { s: GameState; dispatch: (a: Action) => boolean; aiPlayer: PlayerId | null }) {
  const players = (['P1', 'P2'] as const).filter((p) => s.players[p].dw);
  const [picked, setPicked] = useState<Record<PlayerId, string[]>>({ P1: [], P2: [] });
  if (!players.length) return null;
  return (
    <div className="card dw-bar" data-testid="dw-bar">
      <h3>Elemental Power</h3>
      {players.map((p) => {
        const st = dw(s, p)!;
        const raegh = p !== aiPlayer && s.step === 'supremacy' && warlordHas(s, p, 'First Born of War');
        const own = Object.values(s.regiments).filter((r) => r.owner === p && r.location === 'table');
        const toggle = (id: string) => {
          const cur = picked[p];
          setPicked({ ...picked, [p]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(-2) });
        };
        return (
          <div key={p} className="dw-row">
            <span className={`side-tag ${p.toLowerCase()}`}>{p}</span> <span className="meta">{creeds(s, p).join(' + ') || 'no Creed'} Creed</span>
            <span className="ritual-pips" aria-label={`${st.pool} of 10 Elemental Power Markers`}>
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className={`pip ember ${i < st.pool ? 'on' : ''}`} />
              ))}
            </span>
            <span className="meta">{st.pool}/10</span>
            {raegh && own.length > 0 && (
              <div className="raegh">
                <span className="meta">First Born of War: two Regiments become Awakened at the end of the Supremacy Phase (dw p.8):</span>
                <div className="actions wrap">
                  {own.map((r) => (
                    <label key={r.id} className="inline">
                      <input type="checkbox" checked={picked[p].includes(r.id)} onChange={() => toggle(r.id)} /> {r.name}
                    </label>
                  ))}
                  <button type="button" className="secondary small" disabled={!picked[p].length} onClick={() => dispatch({ type: 'dwRaegh', player: p, regimentIds: picked[p] })} data-testid={`raegh-${p}`}>
                    Choose
                  </button>
                </div>
                {st.raeghChoice.length > 0 && <div className="meta">Chosen: {st.raeghChoice.map((id) => s.regiments[id]?.name).join(', ')}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Empowerments, Dweghom Draw Events with choices, and spending Markers to Awaken. */
export function DwActivation({ s, run }: { s: GameState; run: (a: Action) => boolean }) {
  const act = s.activation;
  if (!act) return null;
  const r = s.regiments[act.regimentId]!;
  const st = dw(s, r.owner);
  if (!st) return null;
  const c = act.characterId ? s.characters[act.characterId] : undefined;
  const first = act.actions.length === 0;
  const names = c ? c.drawEvents : r.drawEvents;
  const near = (d: number) => Object.values(s.regiments).filter((x) => x.owner === r.owner && x.location === 'table' && r.location === 'table' && distancePolys(regimentPolys(s, r), regimentPolys(s, x)) <= d);
  const de = (name: string, extra: { option?: string; targetId?: string }, label: string, key?: string) =>
    validate(s, { type: 'drawEvent', name, ...extra }).ok ? (
      <button key={key ?? label} type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name, ...extra })} data-testid={`dw-de-${name}-${extra.option ?? extra.targetId ?? ''}`}>
        {label}
      </button>
    ) : null;
  const draw = first
    ? names
        .flatMap((n) => {
          if (n === 'Forged By the Elements') return empowerments(s, r).map((e) => de(n, { option: e.id }, `Empower (${e.cost}): ${e.label}`, e.id));
          if (n === 'Preternatural Focus') return near(10).filter((t) => !isAwakened(s, t)).map((t) => de(n, { targetId: t.id }, `Focus: Awaken ${t.name}`));
          if (n === 'Runeforged Plate') return [de(n, { option: '1' }, 'Runeforged Plate (1): +2 Attacks'), de(n, { option: '2' }, '(2): +4 Attacks')];
          if (n === 'Fires of the Descent') return near(8).map((t) => de(n, { targetId: t.id }, `Fires of the Descent: ${t.name} Relentless Blows`));
          return [];
        })
        .filter(Boolean)
    : [];
  const spends = c
    ? []
    : (['wander', 'herald'] as const).filter((w) => validate(s, { type: 'dwSpend', regimentId: r.id, what: w }).ok);
  if (!draw.length && !spends.length) return null;
  return (
    <div className="dw-activation" data-testid="dw-activation">
      {draw.length > 0 && (
        <div className="actions wrap">
          <span className="meta">Draw Event ({st.pool} Markers):</span>
          {draw}
        </div>
      )}
      {spends.length > 0 && (
        <div className="actions wrap">
          {spends.map((w) => (
            <button key={w} type="button" className="secondary small" onClick={() => run({ type: 'dwSpend', regimentId: r.id, what: w })} data-testid={`dw-spend-${w}`}>
              {w === 'wander' ? 'Not All who Wander (2 Markers): Awaken' : 'Herald (1 Marker): Awaken'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tempered Creed (dw p.7): how many Markers a Spell may spend, for the spell buttons. */
export function boostOptions(s: GameState, casterOwner: PlayerId): number[] {
  const st = dw(s, casterOwner);
  if (!st || !creeds(s, casterOwner).includes('Tempered')) return [0];
  return [0, 2, 4, 6].filter((b) => b <= st.pool);
}
