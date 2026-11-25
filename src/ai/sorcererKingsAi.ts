import { enemiesInContact } from '../engine/actions';
import { stat } from '../engine/combat';
import { validate, type Action, type ActionBody } from '../engine/game';
import type { GameState, PlayerId, RegimentState } from '../engine/model/types';
import { distancePolys, isEngaged, onTableRegiments, regimentPolys } from '../engine/queries';
import { RITUALS, isElemental, regimentCourts, sk, skUnit, warlordHas } from '../engine/factions/sorcererKings';
import { RITUAL_TARGET, ritualTargets } from '../engine/factions/sorcererKingsRituals';
import { terrainOf, piecePoly } from '../engine/terrain';

/**
 * Computer choices for Sorcerer Kings (sk p.5–46): Ritual targets, Forms and Draw Events. Simple
 * explainable heuristics, every choice checked with the engine's `validate`.
 */
export interface SkAiDecision {
  action: ActionBody;
  reason: string;
}

const legal = (s: GameState, a: ActionBody) => validate(s, a as Action).ok;

const wounded = (r: RegimentState) => r.stands.length < r.startingStands || r.stands.some((x) => x.wounds > 0);

/** The drawn Ritual card: the target that hurts most or heals most. */
export function aiRitual(s: GameState, p: PlayerId): SkAiDecision {
  const name = s.drawn!.card.refId;
  const need = RITUAL_TARGET[name];
  const done = (a: ActionBody, why: string): SkAiDecision => ({ action: a, reason: `resolves the Ritual ${name}${why ? `: ${why}` : ''}` });
  if (need === 'enemy' || need === 'friendly') {
    const ts = ritualTargets(s, p, name).map((id) => s.regiments[id]!);
    const best = ts.sort((a, b) => (need === 'enemy' ? stat(a, 'D') - stat(b, 'D') : Number(wounded(b)) - Number(wounded(a))))[0];
    if (best) return done({ type: 'ritual', player: p, targetId: best.id }, best.name);
    return done({ type: 'ritual', player: p }, 'no legal target');
  }
  if (need === 'sayf') {
    const a: ActionBody = { type: 'ritual', player: p, option: 2 };
    return done(a, 'its [Court of Air] Regiments gain Air Elemental');
  }
  if (need === 'terrain') {
    const pieces = terrainOf(s);
    if (!pieces.length) return done({ type: 'ritual', player: p }, 'no terrain');
    // Earthquake: the piece holding the most enemy Stands; others: the piece nearest friendly Regiments.
    const score = (id: string) => {
      const poly = [piecePoly(pieces.find((x) => x.id === id)!)];
      let v = 0;
      for (const r of onTableRegiments(s)) {
        const d = distancePolys(regimentPolys(s, r), poly);
        if (name === 'Earthquake') v += d <= 0.01 ? (r.owner === p ? -r.stands.length : r.stands.length) : 0;
        else if (r.owner === p) v += d <= 3 ? 2 : -d / 20;
      }
      return v;
    };
    const best = [...pieces].sort((a, b) => score(b.id) - score(a.id))[0]!;
    return done({ type: 'ritual', player: p, terrainId: best.id }, `${best.kind} ${best.id}`);
  }
  return done({ type: 'ritual', player: p }, '');
}

/** Forms and Sorcerer Kings Draw Events at the start of an Activation. */
export function aiSkActivation(s: GameState, r: RegimentState, characterId?: string): SkAiDecision | null {
  const act = s.activation!;
  if (act.actions.length || !s.players[r.owner].sk) return null;
  const engaged = r.location === 'table' && isEngaged(s, r);
  const enemies = onTableRegiments(s).filter((e) => e.owner !== r.owner);
  const near = (d: number) => r.location === 'table' && enemies.some((e) => distancePolys(regimentPolys(s, r), regimentPolys(s, e)) <= d);
  const u = skUnit(r);
  if (!characterId)
    for (const f of u?.forms ?? []) {
      if ((act.drawEvents ?? []).includes(f.group)) continue;
      const pick =
        f.group === 'Stormqueen Form' ? (engaged ? 'attacks' : 'impact') : f.group === 'Tidecaller' ? (engaged ? 'engaged' : 'aura') : f.group === 'Wavebreaker Form' ? 'impact' : f.options[0]!.id;
      const a: ActionBody = { type: 'skForm', regimentId: r.id, group: f.group, option: pick };
      if (legal(s, a)) return { action: a, reason: `chooses ${f.group}: ${f.options.find((o) => o.id === pick)!.label}` };
    }
  const done = act.drawEvents ?? [];
  if (done.some((d) => !['Strain Expression', 'Memories of Old'].includes(d) && !(u?.forms ?? []).some((f) => f.group === d))) return null;
  const names = characterId ? s.characters[characterId]!.drawEvents : r.drawEvents;
  const st = sk(s, r.owner);
  for (const n of names) {
    if (n === 'Dancing Scimitar') {
      const t = enemies.filter((e) => legal(s, { type: 'drawEvent', name: n, targetId: e.id })).sort((a, b) => stat(a, 'D') - stat(b, 'D'))[0];
      if (t) return { action: { type: 'drawEvent', name: n, targetId: t.id }, reason: `Dancing Scimitar on ${t.name}` };
    }
    if (n === 'Elemental Prowess' && st?.preparing && st.preparing.markers >= 3) {
      const t = Object.values(s.regiments).filter((x) => x.owner === r.owner && isElemental(x) && wounded(x) && legal(s, { type: 'drawEvent', name: n, option: '3', targetId: x.id }))[0];
      // Spend Markers only when the Ritual is far from done.
      if (t && st.preparing.markers + 3 < RITUALS[st.preparing.name]!.threshold) return { action: { type: 'drawEvent', name: n, option: '3', targetId: t.id }, reason: `Elemental Prowess heals ${t.name}` };
    }
    if (n === 'Elemental Assault' && st?.preparing && st.preparing.markers >= 3 && (engaged || near(10))) {
      const a: ActionBody = { type: 'drawEvent', name: n, option: 'Relentless Blows', targetId: r.id };
      if (legal(s, a)) return { action: a, reason: 'Elemental Assault: Relentless Blows and Sorcerous Blessing' };
    }
  }
  // Only when the Marker lands: same Court, or Elemental Confluence (sk p.5–6).
  const lands = !!st?.preparing && (warlordHas(s, r.owner, 'Elemental Confluence') || regimentCourts(s, r).includes(RITUALS[st.preparing.name]!.court));
  if (names.includes('Elemental Conduit') && st?.preparing && lands) {
    const a: ActionBody = { type: 'drawEvent', name: 'Elemental Conduit' };
    // Elemental Conduit is the default Draw Event; better ones (Regeneration when wounded) win below.
    const better = names.some((n) => /^Regeneration/.test(n)) && wounded(r) && r.location === 'table';
    if (!better && legal(s, a)) return { action: a, reason: `Elemental Conduit: a Ritual Marker for ${st.preparing.name}` };
  }
  return null;
}

/** Volley at the enemy in contact (Eye of the Storm, Mahut). */
export function aiContactVolley(s: GameState, r: RegimentState): SkAiDecision | null {
  if (!skUnit(r)?.volleyInContact || r.location !== 'table' || !isEngaged(s, r)) return null;
  for (const e of enemiesInContact(s, r)) {
    const a: ActionBody = { type: 'volley', regimentId: r.id, targetId: e.id };
    if (legal(s, a)) return { action: a, reason: `Volleys ${e.name} in contact` };
  }
  return null;
}

/** Value of a Sorcerer Kings Spell for the computer (null: use the generic estimate). */
export function skSpellValue(s: GameState, owner: PlayerId, spell: string, t: RegimentState): number | null {
  const engaged = isEngaged(s, t);
  switch (spell) {
    case 'Sunder (the Land)':
    case 'Air Step':
      return 0; // manual effects
    case 'Water to Blood':
    case 'Reincarnate (the Self)':
      return wounded(t) ? 2 : 0;
    case 'Ignite':
      return 2.5;
    case 'Searing Sandstorm':
    case 'Stabilize (the Pattern)':
      return 0.3;
    case 'Reinforce (the Pattern)':
      return engaged ? 0.8 : 0;
    case 'Cauterize':
    case 'Induced Hypoxia':
      return engaged ? 1 : 0.3;
    case 'Molten Blades':
    case 'Wreathed in Fire':
    case 'Swirling Embrace':
    case 'Wind Kissed Blades':
    case 'Overwhelm (the Form)':
    case 'Lifting Winds':
      return t.owner === owner ? (engaged ? 1.5 : 0.6) : 0;
    case 'Homing Winds':
    case 'Lammelar Flow':
      return t.owner === owner && t.rules.some((x) => x.name === 'Barrage') && !engaged ? 1.2 : 0;
    case 'Flowing Stride':
      return 0.2;
  }
  return null;
}
