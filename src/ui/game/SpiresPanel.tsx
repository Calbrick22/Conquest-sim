import { useState, type ReactElement } from 'react';
import type { Action } from '../../engine/game';
import { validate } from '../../engine/game';
import type { CharacterState, GameState, PlayerId, RegimentState } from '../../engine/model/types';
import { practitionerAbilities } from '../../engine/factions/spires';
import { hasNode, priceProblems, ruthlessOpportunistProblems, spWarlordHas, type AssassinPlan, type RuthlessPlan } from '../../engine/factions/spiresExtras';
import { enemiesInContact } from '../../engine/actions';
import { attachedCharacter, isEngaged } from '../../engine/queries';
import { hasRule } from '../../engine/rules/special/rules';

/** Practitioner Actions (Biomancies, Pheromancies; sp p.15) for the active Character. */
export function PractitionerButtons({ s, c, run }: { s: GameState; c: CharacterState; run: (a: Action) => boolean }) {
  const [pick, setPick] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [observe, setObserve] = useState(false);
  const abilities = practitionerAbilities(c);
  if (!abilities.length || !s.activation) return null;
  const owner = c.id.startsWith('P1') ? 'P1' : 'P2';
  // Field Studies (sp p.8): an Observation Token rolls one more die for the Warlord's Practitioner Action.
  const canObserve = c.isWarlord && spWarlordHas(s, owner, 'Field Studies') && (s.players[owner].observation ?? 0) > 0;
  const act = (name: string, targetId?: string, target2Id?: string): Action => ({
    type: 'characterAbility',
    characterId: c.id,
    name,
    ...(targetId ? { targetId } : {}),
    ...(target2Id ? { target2Id } : {}),
    ...(observe && canObserve ? { observe: true } : {}),
  });
  const regs = Object.values(s.regiments).filter((r) => r.location === 'table');
  const targetsFor = (name: string, t1?: string) =>
    regs.filter((r) => (name === 'Essence Transfer' && t1 ? validate(s, act(name, t1, r.id)).ok : name === 'Essence Transfer' ? regs.some((o) => validate(s, act(name, r.id, o.id)).ok) : validate(s, act(name, r.id)).ok));
  const usable = abilities.filter((n) => (n === 'Pheromantic Drive' ? validate(s, act(n)).ok : targetsFor(n).length > 0));
  if (!usable.length) return null;
  return (
    <div className="actions wrap">
      <span className="meta">Practitioner:</span>
      {canObserve && (
        <label className="meta toggle">
          <input type="checkbox" checked={observe} onChange={(e) => setObserve(e.target.checked)} /> Field Studies: +1 die (1 Token)
        </label>
      )}
      {usable.map((n) => (
        <button
          key={n}
          type="button"
          className={`secondary small ${pick === n ? 'on' : ''}`}
          onClick={() => {
            if (n === 'Pheromantic Drive') {
              run(act(n));
              return;
            }
            setFirst(null);
            setPick(pick === n ? null : n);
          }}
        >
          {n}
        </button>
      ))}
      {pick && (
        <span className="actions wrap">
          <span className="meta">{pick === 'Essence Transfer' ? (first ? 'Heal which Regiment (4 Wounds)?' : 'Which Regiment suffers the Wounds?') : 'Target:'}</span>
          {targetsFor(pick, first ?? undefined).map((r) => (
            <button
              key={r.id}
              type="button"
              className="small"
              onClick={() => {
                if (pick === 'Essence Transfer' && !first) {
                  setFirst(r.id);
                  return;
                }
                if (run(pick === 'Essence Transfer' ? act(pick, first!, r.id) : act(pick, r.id))) {
                  setPick(null);
                  setFirst(null);
                }
              }}
            >
              {r.owner} {r.name}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- choices as a Clash or Volley is declared

export interface AttackOpts {
  ruthless?: boolean;
  price?: boolean;
  detonate?: boolean;
  arcing?: boolean;
  assassin?: AssassinPlan;
}

/**
 * Toggles applied to the next Clash or Volley of the active Regiment: Ruthless Competence (sp p.9),
 * No Matter the Price and Catabolic Node (sp p.30–31), the Mimetic Assassin (sp p.24) and Arcing
 * Fire (core p.97). Each toggle is shown only when the engine would accept it.
 */
export function AttackOptions({ s, r, opts, setOpts }: { s: GameState; r: RegimentState; opts: AttackOpts; setOpts: (o: AttackOpts) => void }) {
  const act = s.activation;
  if (!act || act.characterId || r.location !== 'table' || act.ended) return null;
  const engaged = isEngaged(s, r);
  const c = attachedCharacter(s, r.id);
  const shows = {
    ruthless: !ruthlessOpportunistProblems(s, r).length,
    price: engaged && !priceProblems(s, r).length,
    detonate: engaged && hasNode(r),
    arcing: !engaged && (hasRule(r.rules, 'Arcing Fire') || (!!c && hasRule(c.rules, 'Arcing Fire'))),
  };
  const assassins = engaged && r.type === 'Infantry' && !c ? Object.values(s.characters).filter((x) => x.id.startsWith(r.owner) && !x.destroyed && !x.attachedTo && /mimetic assassin/i.test(x.name) && !(x.usedOnce ?? []).includes('Assassination Directive')) : [];
  if (!Object.values(shows).some(Boolean) && !assassins.length) return null;
  const toggle = (k: keyof Omit<AttackOpts, 'assassin'>, label: string) =>
    shows[k] ? (
      <label key={k} className="meta toggle">
        <input type="checkbox" checked={!!opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} /> {label}
      </label>
    ) : null;
  const foes = enemiesInContact(s, r).flatMap((e) => (attachedCharacter(s, e.id) ? [attachedCharacter(s, e.id)!] : []));
  return (
    <div className="actions wrap attack-options" data-testid="attack-options">
      <span className="meta">With the next Clash or Volley:</span>
      {toggle('ruthless', 'Ruthless Competence: Opportunists')}
      {toggle('price', 'No Matter the Price (once per game)')}
      {toggle('detonate', 'Detonate the Catabolic Node')}
      {toggle('arcing', 'Arcing Fire (Volley)')}
      {assassins.map((x) => (
        <span key={x.id} className="actions">
          <label className="meta toggle">
            <input type="checkbox" checked={opts.assassin?.characterId === x.id} onChange={(e) => setOpts({ ...opts, assassin: e.target.checked ? { characterId: x.id } : undefined })} /> {x.name} joins (Assassination Directive)
          </label>
          {opts.assassin?.characterId === x.id && foes.length > 0 && (
            <select value={opts.assassin.duelTargetId ? `${opts.assassin.duelTargetId}|${opts.assassin.accept ? 1 : 0}` : ''} onChange={(e) => {
              const [id, acc] = e.target.value.split('|');
              setOpts({ ...opts, assassin: { characterId: x.id, ...(id ? { duelTargetId: id, accept: acc === '1' } : {}) } });
            }}>
              <option value="">no Duel</option>
              {foes.flatMap((f) => [
                <option key={`${f.id}1`} value={`${f.id}|1`}>Duel {f.name}: accepted</option>,
                <option key={`${f.id}0`} value={`${f.id}|0`}>Duel {f.name}: declined</option>,
              ])}
            </select>
          )}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- pools and army-wide choices

/** Field Studies, Tricks of the Trade, Ruthless Competence and Privileged Observer (sp p.8–35). */
export function SpiresBar({ s, dispatch, aiPlayer }: { s: GameState; dispatch: (a: Action) => boolean; aiPlayer: PlayerId | null }) {
  const [picked, setPicked] = useState<number[]>([]);
  const players = (['P1', 'P2'] as const).filter((p) => /spires/i.test(s.players[p].faction) && p !== aiPlayer);
  const rows = players
    .map((p) => {
      const st = s.players[p];
      const items: ReactElement[] = [];
      if (spWarlordHas(s, p, 'Field Studies')) items.push(<span key="obs" className="meta">Observation Tokens {st.observation ?? 0}/4</span>);
      const last: Action = { type: 'spires', player: p, act: { option: 'lastCard' } };
      if (validate(s, last).ok)
        items.push(
          <button key="last" type="button" className="secondary small" onClick={() => dispatch(last)}>
            Field Studies: 3 Tokens → remove Broken, Heal 5
          </button>,
        );
      if (st.influence) {
        const use: Action = { type: 'spires', player: p, act: { option: 'influence', indices: picked } };
        items.push(
          <span key="inf" className="actions">
            <span className="meta">Influence Pool:</span>
            {st.influence.map((v, i) => (
              <button key={i} type="button" className={`small ${picked.includes(i) ? '' : 'secondary'}`} onClick={() => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i])}>
                {v}
              </button>
            ))}
            {picked.length > 0 && validate(s, use).ok && (
              <button type="button" className="small" onClick={() => dispatch(use) && setPicked([])}>
                Use for the next roll
              </button>
            )}
          </span>,
        );
      }
      if (spWarlordHas(s, p, 'Ruthless Competence'))
        items.push(
          <label key="ruth" className="meta">
            Ruthless Competence ready for{' '}
            <select value={st.ruthlessPlan ?? 'auto'} onChange={(e) => dispatch({ type: 'spires', player: p, act: { option: 'ruthlessPlan', plan: e.target.value as RuthlessPlan } })}>
              <option value="auto">the first chance</option>
              <option value="opportunist">Opportunists only</option>
              <option value="denyInspired">denying Inspired</option>
              <option value="march">the March after a loss</option>
            </select>
          </label>,
        );
      for (const r of Object.values(s.regiments)) {
        const a: Action = { type: 'spires', player: p, act: { option: 'privileged', regimentId: r.id } };
        if (r.owner === p && r.name === 'Force Grown Drones' && validate(s, a).ok)
          items.push(
            <button key={`pr-${r.id}`} type="button" className="secondary small" onClick={() => dispatch(a)}>
              Privileged Observer: {r.name} becomes Medium
            </button>,
          );
      }
      return items.length ? (
        <div key={p} className="ritual-row">
          <span className={`side-tag ${p.toLowerCase()}`}>{p}</span> {items}
        </div>
      ) : null;
    })
    .filter(Boolean);
  if (!rows.length) return null;
  return (
    <div className="card ritual-bar" data-testid="spires-bar">
      <h3>Spires</h3>
      {rows}
    </div>
  );
}
