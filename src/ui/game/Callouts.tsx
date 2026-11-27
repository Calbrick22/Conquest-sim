import { stat } from '../../engine/combat';
import type { Action, GameEvent } from '../../engine/game';
import type { GameState, Profile, RegimentState } from '../../engine/model/types';
import { attachedCharacter, hasFlank, marchValue } from '../../engine/queries';
import { isImplemented } from '../../engine/rules/special/registry';
import { isAnimateVessel, regimentDarkTier } from '../../engine/factions/oldDominion';
import { OWNER_COLOR } from './TableView';
import { Tooltip } from '../shell/Tooltip';
import { attackSummaries } from './rolls';

const KEYS: (keyof Profile)[] = ['M', 'V', 'C', 'A', 'W', 'R', 'D', 'E'];

/** Stats card shown next to a Regiment when it is tapped. */
const STAT_TIPS: Record<keyof Profile, string> = {
  M: 'March: inches per March; Charge Distance is a die + March (core p.15, p.31)',
  V: 'Volley: Hit on this or less when shooting (core p.15)',
  C: 'Clash: Hit on this or less in melee (core p.15)',
  A: 'Attacks: dice per Stand in a Clash (core p.15)',
  W: 'Wounds per Stand (core p.15)',
  R: 'Resolve: pass Morale Tests on this or less (core p.15, p.59)',
  D: 'Defense: save Hits on this or less (core p.15)',
  E: 'Evasion: save on this or less if better than Defense (core p.15)',
};

export function UnitCallout({ s, r, onClose, variant = 'callout' }: { s: GameState; r: RegimentState; onClose: () => void; variant?: 'callout' | 'panel' }) {
  const c = attachedCharacter(s, r.id);
  const wounded = r.stands.filter((x) => x.wounds > 0).map((x) => x.wounds);
  const status = [
    r.broken ? 'Broken' : '',
    r.activatedThisRound ? 'activated' : '',
    hasFlank(s, r) && r.location !== 'table' ? 'Flank' : '',
    r.flags.marked ? 'Marked' : '',
    r.flags.decay ? 'Strain active (Decay)' : '',
    r.flags.memories ? 'Memories of Old' : '',
    [...r.roundMods, ...(r.grantMods ?? [])].length ? [...r.roundMods, ...(r.grantMods ?? [])].map((m) => `${m.stat}${m.delta > 0 ? '+' : ''}${m.delta} (${m.source})`).join(' ') : '',
  ].filter(Boolean);
  return (
    <div data-testid={variant === 'panel' ? 'selection-panel' : 'unit-callout'} className={`unit-card ${variant === 'panel' ? 'panel' : 'floating'}`}>
      {variant === 'callout' && <button type="button" className="secondary small close" onClick={onClose} aria-label="Close">✕</button>}
      <h4>
        <span className="swatch" style={{ background: OWNER_COLOR[r.owner] }} /> {r.name}
      </h4>
      <div className="meta">
        {r.owner} · {r.type} · {r.cls} · {r.stands.length}/{r.startingStands} Stands · {r.files} files
        {wounded.length ? ` · wounded Stand: ${wounded.join(', ')}` : ''}
        {status.length ? ` · ${status.join(' · ')}` : ''}
      </div>
      <table className="stats">
        <thead>
          <tr>
            <th />
            {KEYS.map((k) => (
              <th key={k}>
                <Tooltip tip={STAT_TIPS[k]}>{k}</Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="meta">Unit</th>
            {KEYS.map((k) => (
              <td key={k}>{k === 'M' ? marchValue(s, r) : r.profile[k] === null ? '-' : stat(r, k)}</td>
            ))}
          </tr>
          {c && (
            <tr>
              <th className="meta">{c.name.split(' ')[0]}</th>
              {KEYS.map((k) => <td key={k}>{c.profile[k] ?? '-'}</td>)}
            </tr>
          )}
        </tbody>
      </table>
      <RuleLine label="Rules" names={r.rules.map((x) => x.raw)} glossary={s.players[r.owner].glossary} />
      {c && <RuleLine label={`${c.name}${c.isWarlord ? ' (Warlord)' : ''}`} names={[...c.rules.map((x) => x.raw), ...c.options]} glossary={s.players[r.owner].glossary} />}
      {r.drawEvents.length > 0 && <div className="rules-line">Draw Events: {r.drawEvents.join(', ')}</div>}
      {r.commandModels.length > 0 && <div className="rules-line">Command: {r.commandModels.join(', ')}</div>}
      {(r.memories?.length || r.memoriesText) && (
        <div className="rules-line">
          Memories of Old{r.flags.memories ? ' (active)' : ''}: {r.memories?.map((x) => x.raw).join(', ') || r.memoriesText}
        </div>
      )}
      {(r.spells?.length || c?.spells?.length) && <div className="rules-line">Spells: {[...(r.spells ?? []), ...(c?.spells ?? [])].join(', ')}</div>}
      {s.players[r.owner].od && isAnimateVessel(r) && <div className="rules-line">Dark Power Tier {regimentDarkTier(s, r) || '—'}</div>}
    </div>
  );
}

/** Rules as chips with a tooltip: automated or manual, and the list's own text for it. */
function RuleLine({ label, names, glossary = {} }: { label: string; names: string[]; glossary?: Record<string, string> }) {
  if (!names.length) return null;
  return (
    <div className="rules-line">
      <span className="rules-label">{label}:</span>{' '}
      {names.map((n, i) => {
        const base = n.replace(/\s*[([].*$/, '');
        const auto = isImplemented(base);
        const text = glossary[base] ?? glossary[n];
        return (
          <Tooltip key={i} className={`rule-chip ${auto ? 'auto' : 'manual-rule'}`} tip={<>
            <strong>{n}</strong> · {auto ? 'automated' : 'manual: apply it with the manual tools'}
            {text && <span className="tip-text">{text.length > 320 ? `${text.slice(0, 320)}…` : text}</span>}
          </>}>
            {n}
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Short title for an Action. */
export function actionTitle(s: GameState, a: Action): string {
  const name = (id?: string) => (id && s.regiments[id] ? s.regiments[id]!.name : id?.startsWith('marker:') ? `Objective Marker ${id.slice(7)}` : '');
  switch (a.type) {
    case 'march':
      return `${name(a.regimentId)} marches`;
    case 'enter':
      return `${name(a.regimentId)} marches on`;
    case 'reform':
      return `${name(a.regimentId)} reforms`;
    case 'charge':
      return `${name(a.regimentId)} charges ${name(a.targetId)}`;
    case 'volley':
      return `${name(a.regimentId)} volleys at ${name(a.targetId)}`;
    case 'clash':
      return `${name(a.regimentId)} clashes with ${name(a.targetId)}`;
    case 'withdraw':
      return `${name(a.regimentId)} withdraws`;
    case 'activate':
      return `Activates ${name(a.regimentId)}`;
    case 'reinforcements':
      return `${a.player} Reinforcements`;
    case 'supremacyRollOff':
      return 'Supremacy roll-off';
    case 'drawEvent':
      return `Draw Event: ${a.name}`;
    case 'spell':
      return `Spell: ${a.spell}`;
    case 'endActivation':
      return 'End of Activation';
    case 'memories':
      return `${name(a.regimentId)}: Memories of Old`;
    case 'ritual':
      return `Ritual: ${s.players[a.player].sk?.lastRitual ?? 'resolved'}`;
    case 'skForm':
      return `${name(a.regimentId)}: ${a.group}`;
    case 'gildedStatue':
      return `${name(a.regimentId)}: Gilded Statue`;
    default:
      return a.type.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  }
}

/** The interesting notes on a dice roll: re-rolls, conversions and extra Hits, not the target or the pass count. */
function diceNotes(e: GameEvent): string[] {
  return (e.dice?.notes ?? []).filter((n) => !/^target /.test(n) && !/^\d+ pass/.test(n));
}

/** Event types worth a line of their own beside the attack summaries. */
const KEY_TYPES = new Set(['charge', 'march', 'broken', 'shattered', 'destroyed', 'duel', 'draw-event', 'action', 'supremacy', 'reinforcement', 'heal', 'power', 'ritual', 'spell', 'override', 'pick', 'score']);

/**
 * Callout for the last Action: one line per attack (Hits, saves, Wounds, Morale, losses), the key
 * events, and the full log folded away. While the dice box is still rolling, the results wait.
 */
export function ActionCallout({ s, action, events, byComputer, ready = true, onNext, onClose }: { s: GameState; action: Action; events: GameEvent[]; byComputer: boolean; ready?: boolean; onNext?: () => void; onClose: () => void }) {
  const lines = events.filter((e) => e.type !== 'ai' && e.type !== 'manual');
  const attacks = attackSummaries(lines);
  const key = lines.filter((e) => !e.dice && (KEY_TYPES.has(e.type) || e.override) && !/saves on \d+ or less/.test(e.text));
  const rest = lines.filter((e) => !key.includes(e));
  return (
    <div data-testid="action-callout">
      {!onNext && (
        <button type="button" className="secondary small close" onClick={onClose} aria-label="Close">✕</button>
      )}
      <h4>
        {byComputer ? 'Computer: ' : ''}
        {actionTitle(s, action)}
      </h4>
      {action.why && <div className="meta">{action.why}</div>}
      {!ready ? (
        <p className="meta">Rolling… watch the dice box.</p>
      ) : (
        <>
          {attacks.map((a, i) => (
            <div key={i} className="attack-line" data-testid="attack-summary">
              <div className="attack-who">
                {a.title.replace(/\s*\(.*\)\s*$/, '')}
                {a.target && <span className="meta"> → {a.target}</span>}
              </div>
              <div className="chips">
                <span className="chip">
                  Hits <strong>{a.hits}</strong>
                  {a.hitDice ? <span className="meta">/{a.hitDice}{a.hitNeed !== null ? ` (≤${a.hitNeed})` : ''}</span> : <span className="meta"> auto</span>}
                </span>
                {(a.saveDice > 0 || a.saved > 0) && (
                  <span className="chip">
                    Saved <strong>{a.saved}</strong>
                    {a.saveDice ? <span className="meta">/{a.saveDice}</span> : null}
                  </span>
                )}
                <span className="chip wounds">
                  Wounds <strong>{a.wounds + a.moraleExtra}</strong>
                  {a.moraleExtra ? <span className="meta"> incl. {a.moraleExtra} Morale</span> : null}
                </span>
                {a.destroyed ? <span className="chip lost">destroyed</span> : a.standsLost ? <span className="chip lost">−{a.standsLost} Stand{a.standsLost > 1 ? 's' : ''}</span> : null}
              </div>
            </div>
          ))}
          {key.length > 0 && (
            <ul className="key-events">
              {key.slice(0, 8).map((e, i) => (
                <li key={i} className={e.override ? 'warn' : ''}>
                  {e.text}
                </li>
              ))}
            </ul>
          )}
          {rest.length > 0 && (
            <details className="full-log">
              <summary className="meta">Every roll and modifier ({rest.length})</summary>
              <ul>
                {rest.map((e, i) => (
                  <li key={i}>
                    {e.dice && e.dice.values.length > 0 && (
                      <span className="dice small-dice">
                        {e.dice.values.map((v, k) => (
                          <span key={k} className={`die ${v === 1 ? 'one' : v === 6 ? 'six' : ''}`}>{v}</span>
                        ))}
                      </span>
                    )}
                    {e.text}
                    {diceNotes(e).length > 0 && <span className="meta dice-notes"> · {diceNotes(e).join(' · ')}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {onNext && (
        <button type="button" onClick={onNext} disabled={!ready} data-testid="ai-next">Next</button>
      )}
    </div>
  );
}
