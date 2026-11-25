import { heal } from '../activation';
import { resolveAttack, stat } from '../combat';
import { ev, type Ctx } from '../dice';
import { overlaps, type Poly } from '../geometry/polygon';
import { TOL } from '../geometry/vec';
import type { GameState, PlayerId, RegimentState } from '../model/types';
import { distancePolys, enemiesTouching, regimentPolys } from '../queries';
import { hasRule } from '../rules/special/rules';
import { piecePoly, terrainOf } from '../terrain';
import { RITUALS, elementalKind, isElemental, ofCourt, setTerrainKeywords, waterPieces } from './sorcererKings';
import { inflame } from './sorcererKingsSpells';

/** Rituals' effects when their Command Card is drawn (sk p.22–25). */

export interface RitualChoice {
  targetId?: string;
  terrainId?: string;
  /** Sayf: 1 (Fly to one Elemental) or 2 (Air Elemental to all). */
  option?: number;
  /** Far Sight: the new order of the rest of the Command Stack (card ids). */
  order?: string[];
}

type Need = 'none' | 'enemy' | 'friendly' | 'terrain' | 'order' | 'sayf';

export const RITUAL_TARGET: Record<string, Need> = {
  'Intrusive Thoughts': 'none',
  Conflagration: 'none',
  'Fiery Dominion': 'none',
  'Call forth the Deep': 'terrain',
  'Violent Geyser': 'enemy',
  'Soothing Tides': 'friendly',
  'Far Sight': 'order',
  Sayf: 'sayf',
  'Spiteful Winds': 'enemy',
  'Gifts of the Earth': 'terrain',
  Earthquake: 'terrain',
  'Kiss of the Earth': 'enemy',
};

const anyIn = (polys: Poly[], pieces: Poly[]) => polys.some((q) => pieces.some((w) => overlaps(q, w)));
const table = (s: GameState) => Object.values(s.regiments).filter((r) => r.location === 'table');

/** Is this Regiment a legal target of the Ritual? Null when it is. */
export function ritualTargetProblem(s: GameState, p: PlayerId, name: string, t: RegimentState): string | null {
  if (t.location !== 'table') return 'Choose a Regiment on the Battlefield.';
  const water = waterPieces(s);
  const polys = regimentPolys(s, t);
  switch (name) {
    case 'Violent Geyser':
      if (t.owner === p) return 'Violent Geyser targets an enemy Regiment.';
      return anyIn(polys, water) || distancePolys(polys, water) <= 3 + TOL ? null : 'The target must be within, or within 3″ of, Water terrain.';
    case 'Soothing Tides':
      if (t.owner !== p || !ofCourt(s, t, 'Water')) return 'Soothing Tides targets a friendly [Court of Water] Regiment.';
      return anyIn(polys, water) || distancePolys(polys, water) <= 3 + TOL ? null : 'The target must be within, or within 3″ of, Water terrain.';
    case 'Spiteful Winds':
      if (t.owner === p) return 'Spiteful Winds targets an enemy Regiment.';
      return enemiesTouching(s, t).some((e) => e.owner === p && isElemental(e) && ofCourt(s, e, 'Air')) ? null : 'The target must be engaged with a friendly [Elemental] [Court of Air] Regiment.';
    case 'Kiss of the Earth':
      return t.owner === p ? 'Kiss of the Earth targets an enemy Regiment.' : null;
    case 'Sayf':
      return t.owner === p && isElemental(t) && ofCourt(s, t, 'Air') ? null : 'Sayf (1) targets a friendly [Elemental] [Court of Air] Regiment.';
  }
  return 'This Ritual does not target a Regiment.';
}

export function ritualTargets(s: GameState, p: PlayerId, name: string): string[] {
  return table(s).filter((t) => !ritualTargetProblem(s, p, name, t)).map((t) => t.id);
}

export function ritualProblems(s: GameState, p: PlayerId, name: string, ch: RitualChoice): string[] {
  const need = RITUAL_TARGET[name];
  if (!need) return ['Unknown Ritual.'];
  if (need === 'enemy' || need === 'friendly' || (need === 'sayf' && ch.option !== 2)) {
    const targets = ritualTargets(s, p, name);
    if (!ch.targetId) return targets.length && need !== 'sayf' ? ['Choose a target for the Ritual.'] : need === 'sayf' && targets.length ? ['Choose Sayf (1) with a target, or Sayf (2).'] : [];
    const t = s.regiments[ch.targetId];
    const why = t ? ritualTargetProblem(s, p, name, t) : 'Unknown Regiment.';
    return why ? [why] : [];
  }
  if (need === 'terrain') {
    if (!terrainOf(s).length) return [];
    if (!ch.terrainId || !terrainOf(s).some((x) => x.id === ch.terrainId)) return ['Choose a piece of terrain.'];
  }
  if (need === 'order' && ch.order) {
    const ids = s.players[p].stack.map((c) => c.id);
    if (ch.order.length !== ids.length || !ids.every((id) => ch.order!.includes(id))) return ['The new order must hold every card of the Command Stack once.'];
  }
  return [];
}

function hitsNoMorale(ctx: Ctx, p: PlayerId, t: RegimentState, hits: number, what: string, reduceD = 0): void {
  resolveAttack(ctx, { attackerOwner: p, targetId: t.id, arc: 'front', pools: [{ label: what, dice: 0, skill: 0, autoHits: hits, ...(reduceD ? { reduceD } : {}) }], morale: false, terrifying: 0, what, kind: 'special' });
}

function gain(ctx: Ctx, r: RegimentState, raw: string, why: string): void {
  const m = raw.match(/^(.*?)\s*\((\+?)(\d+)\)$/);
  r.roundRules.push(m ? { name: m[1]!, x: Number(m[3]), ...(m[2] ? { plus: true } : {}), raw } : { name: raw, raw });
  ev(ctx, { type: 'ritual', text: `${r.name} gains ${raw} until the end of the Round (${why}).`, regimentId: r.id });
}

export function resolveRitual(ctx: Ctx, p: PlayerId, name: string, ch: RitualChoice): void {
  const s = ctx.s;
  const def = RITUALS[name]!;
  ev(ctx, { type: 'ritual', text: `${p} reveals the Ritual ${name} (sk p.${def.page}).`, player: p });
  const mine = (court: 'Fire' | 'Air' | 'Water' | 'Earth') => table(s).filter((r) => r.owner === p && ofCourt(s, r, court));
  const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
  const piece = ch.terrainId ? terrainOf(s).find((x) => x.id === ch.terrainId) : undefined;
  const none = (what: string) => ev(ctx, { type: 'ritual', text: `${name}: ${what}, so it has no effect.`, player: p });
  switch (name) {
    case 'Intrusive Thoughts':
      for (const r of mine('Fire')) gain(ctx, r, hasRule(r.rules, 'Relentless Blows') ? 'Relentless Blows (2)' : 'Relentless Blows', 'Intrusive Thoughts; (2): on Hit Rolls of 1 and 2');
      return;
    case 'Conflagration': {
      const burning = table(s).filter((r) => r.owner !== p && r.flags.inflamed);
      if (!burning.length) ev(ctx, { type: 'ritual', text: 'Conflagration: no "Inflamed" enemy Regiment.', player: p });
      for (const r of burning) {
        ev(ctx, { type: 'ritual', text: `Conflagration: ${r.name} suffers 3 Hits, no Morale.`, regimentId: r.id });
        hitsNoMorale(ctx, p, r, 3, 'Conflagration');
      }
      ev(ctx, { type: 'ritual', text: 'Conflagration: a friendly [Court of Fire] [Elemental] Regiment Activated next gains Inspired and Aimed Shot, and inflames the enemies it engages.', player: p });
      return;
    }
    case 'Fiery Dominion':
      for (const r of mine('Fire')) {
        if (elementalKind(r, 'Fire')) {
          heal(ctx, r, 4, 'Fiery Dominion');
          inflame(ctx, r, 'Fiery Dominion');
        } else gain(ctx, r, 'Fire Elemental', 'Fiery Dominion');
      }
      return;
    case 'Call forth the Deep':
      if (!piece) return none('there is no terrain');
      setTerrainKeywords(s, piece.id, [...piece.keywords, 'Water']);
      ev(ctx, { type: 'ritual', text: `Call forth the Deep: ${piece.kind} ${piece.id} gains the Water keyword until the end of the Round.`, player: p });
      return;
    case 'Violent Geyser': {
      if (!t) return none('no enemy is within or near Water terrain');
      const inside = anyIn(regimentPolys(s, t), waterPieces(s));
      ev(ctx, { type: 'ritual', text: `Violent Geyser: ${t.name} ${inside ? 'is within Water terrain: 6 Hits with Armor Piercing (1)' : 'is within 3″ of Water terrain: 4 Hits'}, no Morale.`, regimentId: t.id });
      hitsNoMorale(ctx, p, t, inside ? 6 : 4, 'Violent Geyser', inside ? 1 : 0);
      return;
    }
    case 'Soothing Tides': {
      if (!t) return none('no friendly [Court of Water] Regiment is within or near Water terrain');
      const inside = anyIn(regimentPolys(s, t), waterPieces(s));
      heal(ctx, t, inside ? 4 : 2, 'Soothing Tides');
      return;
    }
    case 'Far Sight': {
      const pl = s.players[p];
      if (ch.order) {
        pl.stack = ch.order.map((id) => pl.stack.find((c) => c.id === id)!);
        ev(ctx, { type: 'ritual', text: `Far Sight: ${p} re-arranges the Command Stack.`, player: p });
      }
      ev(ctx, { type: 'ritual', text: 'Far Sight: draw and Activate the next card; a [Court of Air] Regiment may make a free Charge or Take Aim as its first Action.', player: p });
      return;
    }
    case 'Sayf':
      if (ch.option === 2 || !t) {
        for (const r of mine('Air')) gain(ctx, r, 'Air Elemental', 'Sayf');
        return;
      }
      gain(ctx, t, 'Fly', 'Sayf');
      return;
    case 'Spiteful Winds': {
      if (!t) return none('no enemy is engaged with a friendly [Elemental] [Court of Air] Regiment');
      const n = 5 + stat(t, 'D');
      ev(ctx, { type: 'ritual', text: `Spiteful Winds: ${t.name} suffers 5 + ${stat(t, 'D')} (its Defense) = ${n} Hits, no Morale.`, regimentId: t.id });
      hitsNoMorale(ctx, p, t, n, 'Spiteful Winds');
      return;
    }
    case 'Gifts of the Earth': {
      if (!piece) return none('there is no terrain');
      const keep = piece.keywords.filter((k) => k === 'Impassable' || k === 'Elevated' || k === 'Traversable');
      setTerrainKeywords(s, piece.id, [...keep, 'Earth']);
      ev(ctx, { type: 'ritual', text: `Gifts of the Earth: ${piece.kind} ${piece.id} now has only ${[...keep, 'Earth'].join(', ')} until the end of the Round (its Size is unchanged).`, player: p });
      const poly = [piecePoly(piece)];
      for (const r of mine('Earth')) if (distancePolys(regimentPolys(s, r), poly) <= 3 + TOL) gain(ctx, r, 'Inspired', 'Gifts of the Earth');
      return;
    }
    case 'Earthquake': {
      if (!piece) return none('there is no terrain');
      setTerrainKeywords(s, piece.id, [...piece.keywords, 'Earth']);
      ev(ctx, { type: 'ritual', text: `Earthquake: ${piece.kind} ${piece.id} gains the Earth keyword until the end of the Round.`, player: p });
      const poly = piecePoly(piece);
      for (const r of table(s)) {
        const n = regimentPolys(s, r).filter((q) => overlaps(q, poly)).length;
        if (!n) continue;
        r.flags.quake = true;
        if (r.owner !== p) r.flags.noRally = true;
        ev(ctx, { type: 'ritual', text: `Earthquake: ${r.name} cannot Heal${r.owner !== p ? ' or Rally' : ''} this Round and suffers ${2 * n} Hits (2 per Stand within), no Morale.`, regimentId: r.id });
        hitsNoMorale(ctx, p, r, 2 * n, 'Earthquake');
      }
      return;
    }
    case 'Kiss of the Earth':
      if (!t) return none('no target');
      t.flags.kissOfEarth = true;
      ev(ctx, { type: 'ritual', text: `Kiss of the Earth: ${t.name} has −2 March on its first March or Charge this Round.`, regimentId: t.id });
      return;
  }
}
