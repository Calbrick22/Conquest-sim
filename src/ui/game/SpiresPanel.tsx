import { useState } from 'react';
import type { Action } from '../../engine/game';
import { validate } from '../../engine/game';
import type { CharacterState, GameState } from '../../engine/model/types';
import { practitionerAbilities } from '../../engine/factions/spires';

/** Practitioner Actions (Biomancies, Pheromancies; sp p.15) for the active Character. */
export function PractitionerButtons({ s, c, run }: { s: GameState; c: CharacterState; run: (a: Action) => boolean }) {
  const [pick, setPick] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const abilities = practitionerAbilities(c);
  if (!abilities.length || !s.activation) return null;
  const act = (name: string, targetId?: string, target2Id?: string): Action => ({
    type: 'characterAbility',
    characterId: c.id,
    name,
    ...(targetId ? { targetId } : {}),
    ...(target2Id ? { target2Id } : {}),
  });
  const regs = Object.values(s.regiments).filter((r) => r.location === 'table');
  const targetsFor = (name: string, t1?: string) =>
    regs.filter((r) => (name === 'Essence Transfer' && t1 ? validate(s, act(name, t1, r.id)).ok : name === 'Essence Transfer' ? regs.some((o) => validate(s, act(name, r.id, o.id)).ok) : validate(s, act(name, r.id)).ok));
  const usable = abilities.filter((n) => (n === 'Pheromantic Drive' ? validate(s, act(n)).ok : targetsFor(n).length > 0));
  if (!usable.length) return null;
  return (
    <div className="actions wrap">
      <span className="meta">Practitioner:</span>
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
