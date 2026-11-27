import { useState } from 'react';
import { validate, type Action } from '../../engine/game';
import type { RegimentState } from '../../engine/model/types';
import { pickableZones } from '../../engine/gameM4';
import type { GameState, PlayerId } from '../../engine/model/types';
import { offerPendingFor, offerState } from '../../engine/factions/spiresExtras';
import { designationPool } from '../../engine/scoring/designations';
import { flankChoices, reinforcementChoices, reinforcementClass, reinforcementNeed, reserveRegiments, tidalChoices } from '../../engine/round';
import { zoneResults } from '../../engine/scoring/victory';
import { decisionMaker } from '../../ai/ai';
import { warlordHas } from '../../engine/factions/oldDominion';
import { isOdSupremacy } from '../../engine/factions/oldDominionActions';
import { OdSupremacy } from './OldDominionPanel';

const PLAYERS: PlayerId[] = ['P1', 'P2'];

/** Round sequence controls: Reinforcements, Command Stacks, Supremacy, card draws, Victory Phase. */
export function PhasePanel({ s, dispatch, aiPlayer }: { s: GameState; dispatch: (a: Action) => boolean; aiPlayer?: PlayerId | null }) {
  if (s.phase !== 'play') return null;
  const who = decisionMaker(s);
  if (aiPlayer && who === aiPlayer) return <div className="card phase-panel meta" data-testid="phase-panel">Waiting for the computer ({aiPlayer})…</div>;
  return (
    <div className="card phase-panel" data-testid="phase-panel">
      {s.step === 'reinforcement' && <Reinforcements s={s} dispatch={dispatch} ai={aiPlayer ?? null} />}
      {s.step === 'command' && <Stacks s={s} ai={aiPlayer ?? null} />}
      {s.step === 'supremacy' && <Supremacy s={s} dispatch={dispatch} aiPlayer={aiPlayer ?? null} />}
      {s.step === 'action' && <Draw s={s} />}
      {s.step === 'victory' && (
        <>
          <h3>Victory Phase</h3>
          <p className="meta">Every Command Card has been played. Ending the Round scores it (core p.106).</p>
          <ZoneStatus s={s} />
          <button type="button" onClick={() => dispatch({ type: 'endRound' })} data-testid="end-round">
            End Round {s.round}
          </button>
        </>
      )}
    </div>
  );
}

/** Chosen Regiments / Linebreakers (ns p.2, p.6): shown and changeable until the first Supremacy Phase. */
function Designations({ s, dispatch, ai }: { s: GameState; dispatch: (a: Action) => boolean; ai: PlayerId | null }) {
  const d = s.scenario.designate;
  if (!d || !s.designated || s.round !== 1) return null;
  return (
    <div className="reinf designations" data-testid="designations">
      <strong>{d.kind === 'chosen' ? 'Chosen Regiments' : 'Linebreakers'}</strong>{' '}
      <span className="meta">{d.kind === 'chosen' ? `up to ${d.count} non-Light enemy Regiments (ns p.2)` : `${d.count} of your Regiments able to Seize; they lose Fly (ns p.6)`}</span>
      {PLAYERS.map((p) => {
        const mine = s.designated![p];
        if (p === ai) return <p key={p} className="meta">{p}: {mine.map((id) => s.regiments[id]?.name).join(', ') || 'none'}</p>;
        return (
          <div key={p} className="actions wrap">
            <span className={`side-tag ${p.toLowerCase()}`}>{p}</span>
            {designationPool(s, p).map((r) => {
              const on = mine.includes(r.id);
              const next = on ? mine.filter((x) => x !== r.id) : [...mine, r.id];
              const a: Action = { type: 'designate', player: p, regimentIds: next };
              return (
                <button key={r.id} type="button" className={`small ${on ? '' : 'secondary'}`} disabled={!on && !validate(s, a).ok && next.length > d.count} onClick={() => dispatch(a)}>
                  {on ? '★ ' : ''}
                  {r.name}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Reinforcements({ s, dispatch, ai }: { s: GameState; dispatch: (a: Action) => boolean; ai: PlayerId | null }) {
  const [auto, setAuto] = useState<Record<PlayerId, string | null>>({ P1: null, P2: null });
  const [flankStay, setFlankStay] = useState<Record<string, boolean>>({});
  // Tidal Summons (sk p.45): a Water Elemental that arrives with the chosen Marid Apsara.
  const [tidal, setTidal] = useState<Record<PlayerId, string | null>>({ P1: null, P2: null });
  // Master Manipulator (sp p.22): an extra Regiment after an accepted Offer, or the declined-Offer benefit.
  const [extra, setExtra] = useState<Record<PlayerId, string | null>>({ P1: null, P2: null });
  const [manip, setManip] = useState<Record<PlayerId, string>>({ P1: 'reroll', P2: 'reroll' });
  // Priority for successful Reinforcement Rolls: they bring on the first Regiments of their Class in this order (core p.21).
  const [prio, setPrio] = useState<Record<PlayerId, string[]>>({ P1: [], P2: [] });
  const waiting = offerPendingFor(s);
  const needText = (cls: 'Light' | 'Medium' | 'Heavy') => {
    const n = reinforcementNeed(s.round, cls);
    return n === null ? 'not yet' : n === 'auto' ? 'arrives' : `rolls ${n} or less`;
  };
  return (
    <>
      <h3>Round {s.round}: Reinforcements</h3>
      <p className="meta">
        Light {needText('Light')} · Medium {needText('Medium')} · Heavy {needText('Heavy')} (core p.21). Tap one Regiment to bring it on automatically; the rest roll one die each per Class, and each success brings on the next Regiment of that Class in your priority order (▲ to raise one).
      </p>
      <Designations s={s} dispatch={dispatch} ai={ai} />
      {waiting && waiting !== ai && (
        <div className="reinf">
          <strong>{waiting}</strong> <span className="meta">{waiting === 'P1' ? 'P2' : 'P1'} proposes an Offer (Master Manipulator, sp p.22).</span>
          <button type="button" className="small" onClick={() => dispatch({ type: 'spires', player: waiting, act: { option: 'answerOffer', accept: true } })}>Accept</button>
          <button type="button" className="secondary small" onClick={() => dispatch({ type: 'spires', player: waiting, act: { option: 'answerOffer', accept: false } })}>Decline</button>
        </div>
      )}
      {PLAYERS.map((p) => {
        if (s.players[p].reinforcementDone) return <p key={p}><strong>{p}</strong> <span className="meta">done</span></p>;
        const offer: Action = { type: 'spires', player: p, act: { option: 'offer' } };
        const os = offerState(s, p);
        if (p === ai) return <p key={p}><strong>{p}</strong> <span className="meta">the computer will choose</span></p>;
        const order = (id: string) => {
          const i = prio[p].indexOf(id);
          return i < 0 ? 1000 + reserve0.findIndex((r) => r.id === id) : i;
        };
        const reserve0 = reserveRegiments(s, p);
        const reserve = [...reserve0].sort((a, b) => order(a.id) - order(b.id));
        const rolls = (r: RegimentState) => {
          const need = reinforcementNeed(s.round, reinforcementClass(s, r));
          return typeof need === 'number' && auto[p] !== r.id && !r.flags.autoArrive && !flankChoices(s, p).some((f) => f.id === r.id);
        };
        const rollers = reserve.filter(rolls);
        const raise = (id: string) => {
          const ids = reserve.map((r) => r.id);
          const i = ids.indexOf(id);
          if (i > 0) [ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!];
          setPrio({ ...prio, [p]: ids });
        };
        const eligible = new Set(reinforcementChoices(s, p).map((r) => r.id));
        const flank = new Set(flankChoices(s, p).map((r) => r.id));
        return (
          <div key={p} className="reinf">
            <strong>{p}</strong>
            <ul className="plain">
              {reserve.map((r) => {
                const need = reinforcementNeed(s.round, reinforcementClass(s, r));
                const isAuto = auto[p] === r.id;
                const isFlank = flank.has(r.id);
                const canPick = eligible.has(r.id) && need !== 'auto' && !r.flags.autoArrive && !isFlank;
                const status = r.flags.autoArrive
                  ? 'arrives (failed to enter last Round)'
                  : isFlank
                    ? need === 'auto' ? 'Flank: arrives' : flankStay[r.id] ? 'Flank: stays back' : 'Flank: arrives (no roll)'
                    : need === null
                      ? 'not this Round'
                      : need === 'auto'
                        ? 'arrives automatically'
                        : isAuto
                          ? 'brought on automatically ★'
                          : `rolls ${need} or less`;
                return (
                  <li key={r.id} className={`reinf-row ${isAuto ? 'chosen' : ''}`}>
                    <span>
                      {rolls(r) && rollers.filter((x) => x.cls === r.cls).length > 1 && (
                        <button type="button" className="secondary small prio" onClick={() => raise(r.id)} aria-label={`Raise ${r.name}'s priority`} title="Successful rolls of this Class bring on Regiments in this order (core p.21)">
                          {rollers.filter((x) => x.cls === r.cls).indexOf(r) + 1} ▲
                        </button>
                      )}{' '}
                      {r.name} <span className="meta">{r.cls}</span>
                    </span>
                    <span className="meta">{status}</span>
                    {canPick && (
                      <button type="button" className={`small ${isAuto ? '' : 'secondary'}`} onClick={() => setAuto({ ...auto, [p]: isAuto ? null : r.id })} data-testid={`auto-${r.id}`}>
                        {isAuto ? '★ Auto' : 'Bring on'}
                      </button>
                    )}
                    {isFlank && need !== 'auto' && (
                      <button type="button" className="secondary small" onClick={() => setFlankStay({ ...flankStay, [r.id]: !flankStay[r.id] })} data-testid={`flank-${r.id}`}>
                        {flankStay[r.id] ? 'Arrive' : 'Stay back'}
                      </button>
                    )}
                  </li>
                );
              })}
              {reserve.length === 0 && <li className="meta">Nothing in Reinforcements.</li>}
            </ul>
            {auto[p] && tidalChoices(s, p, auto[p]!).length > 0 && (
              <label className="meta tidal">
                Tidal Summons (sk p.45): also bring{' '}
                <select value={tidal[p] ?? ''} onChange={(e) => setTidal({ ...tidal, [p]: e.target.value || null })} data-testid={`tidal-${p}`}>
                  <option value="">none</option>
                  {tidalChoices(s, p, auto[p]!).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {validate(s, offer).ok && (
              <button type="button" className="secondary small" onClick={() => dispatch(offer)}>
                Propose an Offer (Master Manipulator)
              </button>
            )}
            {os === 'extra' && (
              <label className="meta tidal">
                Accepted Offer: also bring{' '}
                <select value={extra[p] ?? ''} onChange={(e) => setExtra({ ...extra, [p]: e.target.value || null })}>
                  <option value="">none</option>
                  {reserve.filter((r) => r.id !== auto[p] && reinforcementNeed(s.round, reinforcementClass(s, r)) !== null).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </label>
            )}
            {os === 'declined' && (
              <label className="meta tidal">
                Declined Offer:{' '}
                <select value={manip[p]} onChange={(e) => setManip({ ...manip, [p]: e.target.value })}>
                  <option value="reroll">re-roll one failed Reinforcement Roll</option>
                  {[...reserve, ...Object.values(s.regiments).filter((r) => r.owner === p && r.location === 'arriving')].map((r) => (
                    <option key={r.id} value={r.id}>{r.name} gains Vanguard (3)</option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="small"
              onClick={() =>
                dispatch({
                  type: 'reinforcements',
                  player: p,
                  choice:
                    auto[p] || (os === 'extra' && extra[p]) || os === 'declined'
                      ? {
                          regimentId: auto[p] ?? '',
                          arrive: true,
                          ...(auto[p] && tidal[p] && tidalChoices(s, p, auto[p]!).some((r) => r.id === tidal[p]) ? { tidalId: tidal[p]! } : {}),
                          ...(os === 'extra' && extra[p] ? { extraId: extra[p]! } : {}),
                          ...(os === 'declined' ? (manip[p] === 'reroll' ? { manipulate: 'reroll' as const } : { manipulate: 'vanguard' as const, vanguardId: manip[p] }) : {}),
                        }
                      : null,
                  flank: Object.fromEntries([...flank].map((id) => [id, !flankStay[id]])),
                  priority: reserve.map((r) => r.id),
                })
              }
              data-testid={`reinforce-${p}`}
            >
              {reserve.length ? 'Roll Reinforcements' : 'Continue'}
            </button>
          </div>
        );
      })}
    </>
  );
}

function Stacks({ s, ai }: { s: GameState; ai: PlayerId | null }) {
  return (
    <>
      <h3>Command Phase</h3>
      <p className="meta">Arrange your Command Cards on the table (top card first), then press Ready (core p.21).</p>
      {PLAYERS.map((p) => (
        <p key={p}>
          <strong>{p}</strong>{' '}
          <span className="meta">{s.players[p].stackSet ? `ready (${s.players[p].stack.length} cards, hidden)` : p === ai ? 'the computer is ordering its stack' : 'arranging…'}</span>
        </p>
      ))}
    </>
  );
}

function Supremacy({ s, dispatch, aiPlayer }: { s: GameState; dispatch: (a: Action) => boolean; aiPlayer: PlayerId | null }) {
  return (
    <>
      <h3>Supremacy Phase</h3>
      {s.firstPlayer && s.scenario.zonePick ? (
        <ZonePicks s={s} dispatch={dispatch} />
      ) : !s.supremacyWinner ? (
        <button type="button" onClick={() => dispatch({ type: 'supremacyRollOff' })} data-testid="supremacy-roll">
          Roll off for Supremacy
        </button>
      ) : (
        <>
          <p>
            <strong>{s.supremacyWinner}</strong> won the roll-off and chooses the First Player.
          </p>
          <div className="actions">
            {PLAYERS.map((p) => (
              <button key={p} type="button" className={p === s.supremacyWinner ? '' : 'secondary'} onClick={() => dispatch({ type: 'chooseFirst', first: p })} data-testid={`first-${p}`}>
                {p} goes first
              </button>
            ))}
          </div>
        </>
      )}
      <div className="actions wrap">
        {PLAYERS.map((p) => {
          const w = Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p));
          if (!w || p === aiPlayer) return null;
          if (isOdSupremacy(s, p)) {
            const used = warlordHas(s, p, 'Master of the Legions') ? !!s.players[p].od?.supremacyThisRound : s.players[p].supremacyUsed;
            return used ? null : <OdSupremacy key={p} s={s} p={p} dispatch={dispatch} />;
          }
          if (s.players[p].supremacyUsed) return null;
          return (
            <button key={p} type="button" className="secondary small" onClick={() => dispatch({ type: 'useSupremacy', player: p })}>
              {p}: activate {w.supremacyAbilities.join(', ') || 'Supremacy'} (manual)
            </button>
          );
        })}
      </div>
    </>
  );
}

function Draw({ s }: { s: GameState }) {
  if (s.activation) return <p className="meta">Activation in progress. Cards left: P1 {s.players.P1.stack.length}, P2 {s.players.P2.stack.length}.</p>;
  return (
    <>
      <h3>Action Phase</h3>
      <p className="meta">
        First Player {s.firstPlayer}. {s.drawn ? `${s.drawn.player} drew ${s.drawn.card.name}.` : s.turn ? `${s.turn} draws next: tap the deck on the table.` : ''} Cards left: P1 {s.players.P1.stack.length}, P2 {s.players.P2.stack.length}.
      </p>
    </>
  );
}

function ZonePicks({ s, dispatch }: { s: GameState; dispatch: (a: Action) => boolean }) {
  const zp = s.scenario.zonePick!;
  const first = s.firstPlayer!;
  const second: PlayerId = first === 'P1' ? 'P2' : 'P1';
  const next = s.zonePicks[first] === null ? first : second;
  const zones = s.scenario.zones.filter((z) => !zp.eligibleZoneIds || zp.eligibleZoneIds.includes(z.id));
  const ok = pickableZones(s, next);
  const what = zp.mode === 'bonusPick' ? 'a 6″ zone with none of your Regiments in range: +3 VP if you Seize it' : zp.mode === 'vetoSecret' ? 'a zone in secret: no VP for it this Round' : 'a zone: no VP for it this Round';
  return (
    <>
      <p>
        <strong>{next}</strong> picks {what} (pack p.{s.scenario.page}).
      </p>
      <div className="actions wrap">
        {zones.map((z) => (
          <button key={z.id} type="button" className="secondary small" disabled={!ok.includes(z.id)} onClick={() => dispatch({ type: 'pickZone', player: next, zoneId: z.id })} data-testid={`pick-${z.id}`}>
            {z.label ?? z.id} ({z.x}, {z.y})
          </button>
        ))}
        {!ok.length && (
          <button type="button" className="small" onClick={() => dispatch({ type: 'pickZone', player: next, zoneId: '' })} data-testid="pick-none">
            No zone can be picked: continue
          </button>
        )}
      </div>
    </>
  );
}

function ZoneStatus({ s }: { s: GameState }) {
  if (s.round < s.scenario.objectivesFromRound) return <p className="meta">Zones cannot be Seized this Round.</p>;
  const zr = zoneResults(s);
  return (
    <ul className="plain">
      {s.scenario.zones.map((z) => {
        const r = zr[z.id]!;
        return (
          <li key={z.id}>
            Zone {z.label ?? z.id} {z.diameter}″: <strong>{r.seizedBy ?? 'nobody'}</strong>{' '}
            <span className="meta">
              (Stands P1 {r.totals.P1}/{r.seizing.P1} seizing, P2 {r.totals.P2}/{r.seizing.P2}){r.contestedBy.length ? `, contested by ${r.contestedBy.join(', ')}'s Marker` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
