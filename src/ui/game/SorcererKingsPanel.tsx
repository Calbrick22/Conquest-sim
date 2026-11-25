import { useState } from 'react';
import { validate, type Action } from '../../engine/game';
import type { GameState, PlayerId } from '../../engine/model/types';
import { RITUALS, availableRituals, skUnit } from '../../engine/factions/sorcererKings';
import { RITUAL_TARGET, ritualTargets } from '../../engine/factions/sorcererKingsRituals';
import { enemiesInContact } from '../../engine/actions';
import { canTakeAction, distancePolys, isEngaged, regimentPolys } from '../../engine/queries';
import { terrainOf } from '../../engine/terrain';

/**
 * Sorcerer Kings controls (sk p.5, p.22–46). The UI only shows state and dispatches Actions; the
 * engine checks and resolves them.
 */

/** Rituals Being Prepared, their Markers, and the choice at the end of the Supremacy Phase. */
export function RitualBar({ s, dispatch, aiPlayer }: { s: GameState; dispatch: (a: Action) => boolean; aiPlayer: PlayerId | null }) {
  const players = (['P1', 'P2'] as const).filter((p) => s.players[p].sk);
  if (!players.length) return null;
  return (
    <div className="card ritual-bar" data-testid="ritual-bar">
      <h3>Rituals</h3>
      {players.map((p) => {
        const st = s.players[p].sk!;
        const prep = st.preparing;
        const def = prep ? RITUALS[prep.name] : undefined;
        const canChoose = p !== aiPlayer && s.phase === 'play' && (s.step === 'supremacy' || (!!st.chain && prep?.markers === 0));
        const options = availableRituals(s, p).filter((n) => validate(s, { type: 'prepareRitual', player: p, ritual: n }).ok);
        return (
          <div key={p} className="ritual-row">
            <span className={`side-tag ${p.toLowerCase()}`}>{p}</span>{' '}
            {prep && def ? (
              <>
                <strong>{prep.name}</strong> <span className="meta">({def.court})</span>
                <span className="ritual-pips" aria-label={`${prep.markers} of ${def.threshold} Ritual Markers`}>
                  {Array.from({ length: def.threshold }, (_, i) => (
                    <span key={i} className={`pip ${i < prep.markers ? 'on' : ''}`} />
                  ))}
                </span>
                <span className="meta">
                  {prep.markers}/{def.threshold}
                </span>
              </>
            ) : (
              <span className="meta">No Ritual Being Prepared</span>
            )}
            {st.completed.length > 0 && <div className="meta">Completed (joins the next Command Stack): {st.completed.join(', ')}</div>}
            {st.choice && <div className="meta">Will Prepare {st.choice} at the end of the Supremacy Phase.</div>}
            {canChoose && options.length > 0 && (
              <label className="meta ritual-choose">
                {s.step === 'supremacy' ? 'Prepare at the end of the Supremacy Phase:' : 'Prepare instead:'}{' '}
                <select value="" onChange={(e) => e.target.value && dispatch({ type: 'prepareRitual', player: p, ritual: e.target.value })} data-testid={`ritual-choose-${p}`}>
                  <option value="">{prep ? `keep ${prep.name}` : 'choose…'}</option>
                  {options.map((n) => (
                    <option key={n} value={n}>
                      {n} ({RITUALS[n]!.court}, {RITUALS[n]!.threshold})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A drawn Ritual Command Card: choose its target and resolve it (sk p.5, p.22–25). */
export function RitualCard({ s, dispatch }: { s: GameState; dispatch: (a: Action) => boolean }) {
  const { player, card } = s.drawn!;
  const name = card.refId;
  const need = RITUAL_TARGET[name] ?? 'none';
  const [order, setOrder] = useState<string[]>(() => s.players[player].stack.map((c) => c.id));
  const targets = need === 'enemy' || need === 'friendly' || need === 'sayf' ? ritualTargets(s, player, name) : [];
  const go = (extra: Partial<Extract<Action, { type: 'ritual' }>>) => dispatch({ type: 'ritual', player, ...extra });
  const stack = s.players[player].stack;
  const move = (i: number) => {
    if (i <= 0) return;
    const o = [...order];
    [o[i - 1], o[i]] = [o[i]!, o[i - 1]!];
    setOrder(o);
  };
  return (
    <div className="deck-panel draw ritual-card" data-testid="ritual-card">
      <div className={`ccard face ritual owner-${player}`}>
        <span className="pos">{player}</span>
        <span className="cname">{name}</span>
        <span className="ckind">Ritual · {RITUALS[name]?.court}</span>
      </div>
      <div className="actions wrap">
        {need === 'none' && (
          <button type="button" onClick={() => go({})} data-testid="ritual-resolve">
            Resolve {name}
          </button>
        )}
        {(need === 'enemy' || need === 'friendly') &&
          (targets.length ? (
            targets.map((id) => (
              <button key={id} type="button" onClick={() => go({ targetId: id })} data-testid={`ritual-target-${id}`}>
                {name} → {s.regiments[id]!.name}
              </button>
            ))
          ) : (
            <button type="button" className="secondary" onClick={() => go({})} data-testid="ritual-resolve">
              No legal target: resolve with no effect
            </button>
          ))}
        {need === 'sayf' && (
          <>
            {targets.map((id) => (
              <button key={id} type="button" onClick={() => go({ option: 1, targetId: id })}>
                Sayf (1): {s.regiments[id]!.name} gains Fly
              </button>
            ))}
            <button type="button" className="secondary" onClick={() => go({ option: 2 })} data-testid="ritual-resolve">
              Sayf (2): [Court of Air] Regiments gain Air Elemental
            </button>
          </>
        )}
        {need === 'terrain' &&
          (terrainOf(s).length ? (
            terrainOf(s).map((p) => (
              <button key={p.id} type="button" onClick={() => go({ terrainId: p.id })} data-testid={`ritual-terrain-${p.id}`}>
                {name} → {p.kind} {p.id}
              </button>
            ))
          ) : (
            <button type="button" className="secondary" onClick={() => go({})} data-testid="ritual-resolve">
              No terrain: resolve with no effect
            </button>
          ))}
        {need === 'order' && (
          <div className="far-sight">
            <span className="meta">Re-arrange your Command Stack (top first):</span>
            <ol>
              {order.map((id, i) => (
                <li key={id}>
                  {stack.find((c) => c.id === id)?.name}{' '}
                  {i > 0 && (
                    <button type="button" className="secondary small" onClick={() => move(i)} aria-label="Move up">
                      ▲
                    </button>
                  )}
                </li>
              ))}
            </ol>
            <button type="button" onClick={() => go({ order })} data-testid="ritual-resolve">
              Resolve Far Sight
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Forms, Sorcerer Kings Draw Events with choices, Gilded Statue and Volleys in contact. */
export function SkActivation({ s, run, onVolleyInContact, onSoaring }: { s: GameState; run: (a: Action) => boolean; onVolleyInContact: (targetId: string) => void; onSoaring?: () => void }) {
  const act = s.activation;
  if (!act || !s.players[s.regiments[act.regimentId]!.owner].sk) return null;
  const r = s.regiments[act.regimentId]!;
  const c = act.characterId ? s.characters[act.characterId] : undefined;
  const u = skUnit(r);
  const first = act.actions.length === 0;
  const near = (owner: 'friend' | 'enemy') =>
    Object.values(s.regiments).filter((x) => x.location === 'table' && (owner === 'friend' ? x.owner === r.owner : x.owner !== r.owner) && r.location === 'table' && distancePolys(regimentPolys(s, r), regimentPolys(s, x)) <= 12);
  const de = (name: string, extra: { option?: string; targetId?: string }, label: string, key?: string) =>
    validate(s, { type: 'drawEvent', name, ...extra }).ok ? (
      <button key={key ?? label} type="button" className="secondary small" onClick={() => run({ type: 'drawEvent', name, ...extra })}>
        {label}
      </button>
    ) : null;
  const names = c ? c.drawEvents : r.drawEvents;
  const draw = first
    ? names.flatMap((n) => {
        if (n === 'Elemental Prowess')
          return near('friend').flatMap((t) => [de(n, { option: '3', targetId: t.id }, `Prowess (3 Markers): ${t.name} Heals 4`), de(n, { option: '5', targetId: t.id }, `…5 Markers, also Blessed`, `${t.id}-5`)]);
        if (n === 'Elemental Assault')
          return near('friend').flatMap((t) => [de(n, { option: 'Untouchable', targetId: t.id }, `Assault: ${t.name} Untouchable`), de(n, { option: 'Relentless Blows', targetId: t.id }, `…Relentless Blows`, `${t.id}-rb`)]);
        if (n === 'Dancing Scimitar') return near('enemy').map((t) => de(n, { targetId: t.id }, `Dancing Scimitar: ${t.name} (3 Hits, AP 2)`));
        return [];
      }).filter(Boolean)
    : [];
  const forms = !c && first ? (u?.forms ?? []).filter((f) => !(act.drawEvents ?? []).includes(f.group)) : [];
  const gilded = !c && validate(s, { type: 'gildedStatue', regimentId: r.id }).ok;
  const contactVolley = !c && u?.volleyInContact && r.location === 'table' && isEngaged(s, r) ? enemiesInContact(s, r).filter((e) => validate(s, { type: 'volley', regimentId: r.id, targetId: e.id }).ok) : [];
  // On Soaring Winds (Steelheart Djinn, sk p.36): a March ignoring what is in the way, even while engaged.
  const soaring = !c && !!onSoaring && r.name === 'Steelheart Djinn' && r.location === 'table' && !canTakeAction(s, r.id, 'march').length;
  if (!draw.length && !forms.length && !gilded && !contactVolley.length && !soaring) return null;
  return (
    <div className="sk-activation" data-testid="sk-activation">
      {forms.map((f) => (
        <div key={f.group} className="actions wrap">
          <span className="meta">{f.group}:</span>
          {f.options.map((o) => (
            <button key={o.id} type="button" className="secondary small" onClick={() => run({ type: 'skForm', regimentId: r.id, group: f.group, option: o.id })} data-testid={`form-${o.id}`}>
              {o.label}
            </button>
          ))}
        </div>
      ))}
      {draw.length > 0 && (
        <div className="actions wrap">
          <span className="meta">Draw Event:</span>
          {draw}
        </div>
      )}
      {(gilded || contactVolley.length > 0 || soaring) && (
        <div className="actions wrap">
          {soaring && (
            <button type="button" className="secondary" onClick={onSoaring} data-testid="soaring">
              On Soaring Winds
            </button>
          )}
          {gilded && (
            <button type="button" className="secondary" onClick={() => run({ type: 'gildedStatue', regimentId: r.id })}>
              Gilded Statue (terrain gains Earth)
            </button>
          )}
          {contactVolley.map((e) => (
            <button key={e.id} type="button" onClick={() => onVolleyInContact(e.id)}>
              Volley {e.name} (in contact)
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
