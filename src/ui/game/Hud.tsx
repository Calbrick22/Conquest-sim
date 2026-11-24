import type { GameState, PlayerId } from '../../engine/model/types';
import { Tooltip } from '../shell/Tooltip';

const STEPS: { id: GameState['step']; label: string; tip: string }[] = [
  { id: 'reinforcement', label: 'Reinforce', tip: 'Reinforcement Phase: Regiments arrive (core p.20–21)' },
  { id: 'command', label: 'Command', tip: 'Command Phase: order your Command Stack (core p.21)' },
  { id: 'supremacy', label: 'Supremacy', tip: 'Supremacy Phase: roll off, choose the First Player (core p.21)' },
  { id: 'action', label: 'Actions', tip: 'Action Phase: draw cards and Activate (core p.22)' },
  { id: 'victory', label: 'Victory', tip: 'Victory Phase: score the Round (core p.106)' },
];

/**
 * The battle HUD: scenario and Round, the phase track, both sides' score, whose turn it is and
 * the Activation in progress. It only reads the state.
 */
export function Hud({ s, you, mode, children }: { s: GameState; you: PlayerId; mode: 'hotseat' | 'ai'; children?: React.ReactNode }) {
  const act = s.activation;
  const r = act ? s.regiments[act.regimentId] : undefined;
  const c = act?.characterId ? s.characters[act.characterId] : undefined;
  const turn = s.drawn?.player ?? (act ? r?.owner : s.turn) ?? null;
  const used = act ? act.actions.length + (act.extra?.filter((e) => e.used).length ?? 0) : 0;
  const side = (p: PlayerId) => (
    <div className={`hud-side ${p.toLowerCase()} ${turn === p ? 'to-move' : ''}`} aria-label={`${p} ${s.players[p].vp} Victory Points`}>
      <span className="hud-tag">{p}</span>
      <span className="hud-army">
        {s.players[p].listName}
        {mode === 'ai' && <small>{p === you ? 'You' : 'Computer'}</small>}
      </span>
      {s.firstPlayer === p && (
        <Tooltip tip="First Player this Round (core p.21)">
          <span className="hud-crown" aria-label="First Player">
            ♛
          </span>
        </Tooltip>
      )}
      {s.step === 'action' && (
        <Tooltip tip="Command Cards left in the stack">
          <span className="hud-cards" aria-label={`${s.players[p].stack.length} cards left`}>
            🂠 {s.players[p].stack.length}
          </span>
        </Tooltip>
      )}
    </div>
  );
  return (
    <header className="hud panel" data-testid="hud">
      <div className="hud-left">
        <div className="hud-title">
          <span className="hud-scenario">{s.scenario.name}</span>
          <span className="hud-round" data-testid="hud-round">
            Round <strong>{Math.min(s.round, s.scenario.rounds)}</strong>/{s.scenario.rounds}
          </span>
        </div>
        <ol className="phase-track" aria-label="Round sequence">
          {STEPS.map((st) => (
            <li key={st.id} className={s.phase === 'play' && s.step === st.id ? 'now' : ''} aria-current={s.phase === 'play' && s.step === st.id ? 'step' : undefined}>
              <Tooltip tip={st.tip}>{st.label}</Tooltip>
            </li>
          ))}
        </ol>
      </div>
      <div className="hud-score">
        {side('P1')}
        <div className="hud-vp" data-testid="score">
          P1 {s.players.P1.vp} – {s.players.P2.vp} P2
        </div>
        {side('P2')}
      </div>
      <div className="hud-right">
        <div className="hud-activation" aria-live="polite">
          {s.phase === 'ended' ? (
            <span>Battle over</span>
          ) : s.phase === 'setup' ? (
            <span>Deployment</span>
          ) : act && r ? (
            <>
              <span className={`hud-tag ${r.owner.toLowerCase()}`}>{r.owner}</span>
              <span className="hud-active-name">{c ? c.name : r.name}</span>
              <span className="pips" aria-label={`${used} of ${c ? 1 : 2} Actions used`}>
                {Array.from({ length: c ? 1 : 2 }, (_, i) => (
                  <span key={i} className={`pip ${i < used ? 'spent' : ''}`} />
                ))}
              </span>
              {act.inspired && <span className="chip">Inspired</span>}
              {act.aimed && <span className="chip">Aimed</span>}
            </>
          ) : s.drawn ? (
            <span>
              {s.drawn.player} drew <strong>{s.drawn.card.name}</strong>
            </span>
          ) : s.turn ? (
            <span>
              <strong>{s.turn}</strong> to draw
            </span>
          ) : (
            <span>{STEPS.find((x) => x.id === s.step)?.label}</span>
          )}
        </div>
        <div className="hud-tools">{children}</div>
      </div>
    </header>
  );
}
