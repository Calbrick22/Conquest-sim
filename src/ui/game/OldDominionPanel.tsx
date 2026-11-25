import { useState } from 'react';
import type { Action } from '../../engine/game';
import type { GameState, PlayerId, RegimentState } from '../../engine/model/types';
import { baseName } from '../../engine/activation';
import { enemiesInContact } from '../../engine/actions';
import { distancePolys, regimentPolys } from '../../engine/queries';
import { fallenDivinity, hasMemories, od, pantheonTier, poolTier, roleOf, tierThresholds, warlord, warlordHas } from '../../engine/factions/oldDominion';
import { isOdDrawEvent, OD_SUPREMACY, odSpendProblems, tokensAvailable } from '../../engine/factions/oldDominionActions';
import { areaLabel, castableSpells, casterOf, spellDef } from '../../engine/spells';
import { validate } from '../../engine/game';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const PLAYERS: PlayerId[] = ['P1', 'P2'];

/** Power Token pools and Tiers (od p.6–7), with the default pool for new Tokens. */
export function PowerBar({ s, dispatch, aiPlayer }: { s: GameState; dispatch: (a: Action) => boolean; aiPlayer: PlayerId | null }) {
  const rows = PLAYERS.filter((p) => od(s, p));
  if (!rows.length) return null;
  return (
    <div className="card power" data-testid="power">
      {rows.map((p) => {
        const o = od(s, p)!;
        const [t2, t3, t4] = tierThresholds(s.players[p].points);
        const hasFp = pantheonTier(s, p) > 0;
        return (
          <div key={p} className="actions wrap">
            <strong>{p} Power</strong>
            <span>
              Dark Power {o.dark} (Tier {ROMAN[poolTier(s, p, 'dark')]})
            </span>
            {hasFp && (
              <span>
                Fallen Pantheon {o.pantheon} (Tier {ROMAN[pantheonTier(s, p)]})
              </span>
            )}
            <span className="meta">
              Tiers at {t2} / {t3}
              {warlordHas(s, p, 'Obdurate Bone and Stone') || warlordHas(s, p, 'Master of the Legions') || warlordHas(s, p, 'Glimmers of a Golden Age') ? ` / ${t4}` : ''} (od p.6)
            </span>
            {hasFp && p !== aiPlayer && (
              <span className="actions">
                <span className="meta">New Tokens go to:</span>
                <button type="button" className={`small ${o.pref === 'dark' ? '' : 'secondary'}`} onClick={() => dispatch({ type: 'powerPref', player: p, pool: 'dark' })}>
                  Dark Power
                </button>
                <button type="button" className={`small ${o.pref === 'pantheon' ? '' : 'secondary'}`} onClick={() => dispatch({ type: 'powerPref', player: p, pool: 'pantheon' })}>
                  Fallen Pantheon
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Old Dominion and spellcasting buttons for the active Regiment or Character. */
export function OdActivation({ s, run }: { s: GameState; run: (a: Action) => boolean }) {
  const act = s.activation;
  const [spell, setSpell] = useState<string | null>(null);
  const [att, setAtt] = useState(3);
  const [awaken, setAwaken] = useState<string[]>([]);
  if (!act) return null;
  const r = s.regiments[act.regimentId]!;
  const c = act.characterId ? s.characters[act.characterId] : undefined;
  const casterId = c ? c.id : r.id;
  const caster = casterOf(s, casterId);
  const names = (c ? c.drawEvents : r.drawEvents).filter((n) => isOdDrawEvent(baseName(n)));
  const done = act.drawEvents ?? [];
  const canDraw = act.actions.length === 0 && r.location === 'table';
  const friends = (range = 12) => Object.values(s.regiments).filter((x) => x.owner === r.owner && x.location === 'table' && distancePolys(regimentPolys(s, r), regimentPolys(s, x)) <= range);
  const enemies12 = Object.values(s.regiments).filter((x) => x.owner !== r.owner && x.location === 'table' && distancePolys(regimentPolys(s, r), regimentPolys(s, x)) <= 12);
  const de = (n: string, extra: Partial<Extract<Action, { type: 'drawEvent' }>>, label: string, key?: string) => {
    const a: Action = { type: 'drawEvent', name: n, ...extra };
    const ok = validate(s, a).ok;
    return (
      <button key={key ?? label} type="button" className="secondary small" disabled={!ok} onClick={() => run(a)}>
        {label}
      </button>
    );
  };
  const drawButtons = canDraw
    ? names
        .filter((n) => !done.includes(baseName(n)))
        .map((n) => {
          const b = baseName(n).replace(/[’]/g, "'");
          if (b === 'Dark Shepherd') return <span key={n} className="actions">{friends(c?.options.some((o) => o.toLowerCase() === 'the reaping crook') ? 999 : 12).map((f: RegimentState) => de(n, { targetId: f.id }, `Dark Shepherd: ${f.name}`, f.id))}</span>;
          if (b === 'Dark Awakening') {
            const opts: [string, string][] = [['C', '+2 Clash'], ['Cleave', 'Cleave (2)'], ['Brutal', 'Brutal Impact (2)'], ['Impact', 'Impact (+2)']];
            return (
              <span key={n} className="actions">
                <span className="meta">Dark Awakening (2 Tokens each, {tokensAvailable(s, r.owner)} held):</span>
                {opts.map(([k, l]) => (
                  <label key={k} className="meta">
                    <input type="checkbox" checked={awaken.includes(k)} onChange={(e) => setAwaken(e.target.checked ? [...awaken, k] : awaken.filter((x) => x !== k))} /> {l}
                  </label>
                ))}
                {de(n, { options: awaken }, 'Resolve')}
              </span>
            );
          }
          if (b === "Heaven's Descent") return <span key={n} className="actions">{enemiesInContact(s, r).map((e) => de(n, { targetId: e.id }, `Heaven's Descent on ${e.name} (2 Tokens)`, e.id))}</span>;
          if (b === 'Exhortation of Eternal Faith')
            return (
              <span key={n} className="actions">
                {de(n, { option: 'aura-attack' }, 'Exhortation: Command Stands +3 A (manual aura)')}
                {de(n, { option: 'seize' }, '+6 Stands for Seizing')}
                {de(n, { option: 'aura-resolve' }, 'Enemies within 12″ −1 Resolve')}
              </span>
            );
          if (b === 'Exploitation of Divine Vanity')
            return (
              <span key={n} className="actions">
                {de(n, { option: 'aod' }, 'Exploitation: Aura of Death (+10)')}
                {de(n, { option: 'harvest' }, 'Token per 2 enemy Stands')}
                {enemies12.map((e) => de(n, { option: 'terror', targetId: e.id }, `${e.name} re-rolls Morale successes`, e.id))}
              </span>
            );
          return de(n, {}, `${n}${b === 'Unholy Sacrament' || b === 'Blasphemous Mesa' ? ' (1 Dark Power Token)' : ''}`, n);
        })
    : [];
  const spells = caster && caster.dice > 0 && !act.ended ? castableSpells(s, casterId) : [];
  const spellOk = caster ? validate(s, { type: 'spell', casterId, spell: spells[0]?.spell ?? caster.spells[0] ?? '', targetId: r.id, attunement: 3 }) : null;
  const memOk = !c && hasMemories(r) && validate(s, { type: 'memories', regimentId: r.id }).ok;
  const spendOk = !c && !odSpendProblems(s, r).length;
  if (!drawButtons.length && !spells.length && !memOk && !spendOk) return null;
  return (
    <div className="od-activation">
      {spendOk && (
        <div className="actions wrap">
          <span className="meta">Blasphemous Mesa (1 Dark Power Token):</span>
          <button type="button" className="secondary small" onClick={() => run({ type: 'odSpend', regimentId: r.id, option: 'aod' })}>Aura of Death (+1)</button>
          <button type="button" className="secondary small" onClick={() => run({ type: 'odSpend', regimentId: r.id, option: 'noBrittle' })}>lose Brittle</button>
          <button type="button" className="secondary small" onClick={() => run({ type: 'odSpend', regimentId: r.id, option: 'terrifying' })}>Terrifying (+1)</button>
        </div>
      )}
      {drawButtons.length > 0 && (
        <div className="actions wrap">
          <span className="meta">Draw Event:</span>
          {drawButtons}
        </div>
      )}
      {memOk && (
        <div className="actions wrap">
          <button type="button" className="secondary" onClick={() => run({ type: 'memories', regimentId: r.id })} data-testid="memories">
            Memories of Old{r.memories?.length ? `: ${r.memories.map((x) => x.raw).join(', ')}` : ''}
          </button>
        </div>
      )}
      {spells.length > 0 && (
        <div className="actions wrap">
          <span className="meta">
            Spellcasting ({caster!.priest ? 'Priest' : 'Wizard'} {caster!.dice}):
          </span>
          {spells.map((x) => (
            <button key={x.spell} type="button" className={`secondary small ${spell === x.spell ? 'on' : ''}`} onClick={() => setSpell(spell === x.spell ? null : x.spell)}>
              {x.spell}
              {spellDef(x.spell) ? '' : ' (manual)'}
            </button>
          ))}
          {spellOk && !spellOk.ok && !spells.some((x) => x.targets.length) && <span className="meta">{spellOk.reasons[0]}</span>}
        </div>
      )}
      {spell && (
        <div className="actions wrap">
          {!spellDef(spell) && (
            <label className="meta">
              Attunement{' '}
              <select value={att} onChange={(e) => setAtt(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          )}
          {(spellDef(spell) ? spells.find((x) => x.spell === spell)?.targets ?? [] : Object.values(s.regiments).filter((t) => t.location === 'table').map((t) => t.id)).map((id) => (
            <button
              key={id}
              type="button"
              className="small"
              onClick={() => {
                if (run({ type: 'spell', casterId, spell, targetId: id, ...(spellDef(spell) ? {} : { attunement: att }) })) setSpell(null);
              }}
            >
              {spell} → {s.regiments[id]?.name ?? areaLabel(s, id)}
            </button>
          ))}
          {spellDef(spell) && !(spells.find((x) => x.spell === spell)?.targets.length) && <span className="meta">No legal target in range.</span>}
        </div>
      )}
    </div>
  );
}

/** [Activated] Supremacy choices for Old Dominion Warlords (od p.8–10). */
export function OdSupremacy({ s, p, dispatch }: { s: GameState; p: PlayerId; dispatch: (a: Action) => boolean }) {
  const [picks, setPicks] = useState<Record<string, string>>({});
  const w = warlord(s, p);
  if (!w || !OD_SUPREMACY.some((a) => warlordHas(s, p, a))) return null;
  const go = (targets: { id: string; option?: string }[]) => dispatch({ type: 'useSupremacy', player: p, targets });
  if (warlordHas(s, p, 'Blasphemous Mesa') || warlordHas(s, p, 'Obdurate Bone and Stone')) return null;
  if (warlordHas(s, p, 'Surrounded by Fear and Dead Men')) {
    const fd = fallenDivinity(s, p);
    const ts = Object.values(s.regiments).filter((r) => r.owner === p && r.location === 'table' && r.id !== fd?.id && roleOf(r, 'Fallen Pantheon'));
    return (
      <span className="actions wrap">
        <span className="meta">{p} {w.name}: sacrifice up to 3 Stands of</span>
        {ts.map((t) => (
          <button key={t.id} type="button" className="secondary small" onClick={() => go([{ id: t.id }])}>{t.name}</button>
        ))}
      </span>
    );
  }
  if (warlordHas(s, p, 'Master of the Legions')) {
    const ts = Object.values(s.regiments).filter((r) => r.owner === p && r.location === 'table' && roleOf(r, 'Legion'));
    const chosen = Object.entries(picks).filter(([, v]) => v).map(([id, option]) => ({ id, option }));
    return (
      <span className="actions wrap">
        <span className="meta">{p} Master of the Legions (up to two [The Legion] Regiments):</span>
        {ts.map((t) => (
          <label key={t.id} className="meta">
            {t.name}{' '}
            <select value={picks[t.id] ?? ''} onChange={(e) => setPicks({ ...picks, [t.id]: e.target.value })}>
              <option value="">—</option>
              <option value="tier">Dark Power Tier +1</option>
              {hasMemories(t) && <option value="memories">Memories of Old</option>}
              <option value="charge">Charge: 2D6 keep highest</option>
              <option value="brittle">lose Brittle</option>
            </select>
          </label>
        ))}
        <button type="button" className="small" disabled={!chosen.length || chosen.length > 2} onClick={() => go(chosen)}>Activate</button>
      </span>
    );
  }
  return (
    <button type="button" className="secondary small" onClick={() => go([])}>
      {p}: activate {w.supremacyAbilities.join(', ')}
    </button>
  );
}
