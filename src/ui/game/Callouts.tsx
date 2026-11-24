import { stat } from '../../engine/combat';
import type { Action, GameEvent } from '../../engine/game';
import type { GameState, Profile, RegimentState } from '../../engine/model/types';
import { attachedCharacter, hasFlank, marchValue } from '../../engine/queries';
import { isImplemented } from '../../engine/rules/special/registry';
import { isAnimateVessel, regimentDarkTier } from '../../engine/factions/oldDominion';
import { OWNER_COLOR } from './TableView';

const KEYS: (keyof Profile)[] = ['M', 'V', 'C', 'A', 'W', 'R', 'D', 'E'];

/** Stats card shown next to a Regiment when it is tapped. */
export function UnitCallout({ s, r, onClose }: { s: GameState; r: RegimentState; onClose: () => void }) {
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
    <div data-testid="unit-callout">
      <button type="button" className="secondary small close" onClick={onClose} aria-label="Close">✕</button>
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
            {KEYS.map((k) => <th key={k}>{k}</th>)}
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
      <RuleLine label="Rules" names={r.rules.map((x) => x.raw)} />
      {c && <RuleLine label={`${c.name}${c.isWarlord ? ' (Warlord)' : ''}`} names={[...c.rules.map((x) => x.raw), ...c.options]} />}
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

function RuleLine({ label, names }: { label: string; names: string[] }) {
  if (!names.length) return null;
  return (
    <div className="rules-line">
      {label}:{' '}
      {names.map((n, i) => (
        <span key={i} className={isImplemented(n.replace(/\s*[([].*$/, '')) ? '' : 'manual-rule'}>
          {n}
          {i < names.length - 1 ? ', ' : ''}
        </span>
      ))}
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
    default:
      return a.type.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
  }
}

/** The interesting notes on a dice roll: re-rolls, conversions and extra Hits, not the target or the pass count. */
function diceNotes(e: GameEvent): string[] {
  return (e.dice?.notes ?? []).filter((n) => !/^target /.test(n) && !/^\d+ pass/.test(n));
}

/** Callout for the last Action: what happened, with the dice. */
export function ActionCallout({ s, action, events, byComputer, onNext, onClose }: { s: GameState; action: Action; events: GameEvent[]; byComputer: boolean; onNext?: () => void; onClose: () => void }) {
  const lines = events.filter((e) => e.type !== 'ai' && e.type !== 'manual');
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
      <ul>
        {lines.slice(0, 12).map((e, i) => (
          <li key={i} className={e.override ? 'warn' : ''}>
            {e.dice && e.dice.values.length > 0 && (
              <span className="dice small-dice">
                {e.dice.values.map((v, k) => (
                  <span key={k} className={`die ${v === 1 ? 'one' : v === 6 ? 'six' : ''}`}>{v}</span>
                ))}
              </span>
            )}
            {e.text}
            {/* Re-rolls and conversions (Flurry, Designate Target, Blessed, Devout…). */}
            {diceNotes(e).length > 0 && <span className="meta dice-notes"> · {diceNotes(e).join(' · ')}</span>}
          </li>
        ))}
        {lines.length > 12 && <li className="meta">… {lines.length - 12} more in the log</li>}
      </ul>
      {onNext && (
        <button type="button" onClick={onNext} data-testid="ai-next">Next</button>
      )}
    </div>
  );
}
