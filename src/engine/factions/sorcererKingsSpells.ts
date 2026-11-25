import { heal } from '../activation';
import { resolveValue, stat } from '../combat';
import { ev, type Ctx } from '../dice';
import type { RegimentState } from '../model/types';
import { distancePolys, enemiesTouching, isEngaged, regimentPolys } from '../queries';
import { spellHits, type Caster, type SpellDef } from '../spellCore';
import { TOL } from '../geometry/vec';
import { elementalKind, isElemental, isMortal, ofCourt } from './sorcererKings';

/**
 * The Courts' Spellbooks (sk p.18–21), as engine effects. Effects "until the end of the Round"
 * are Round rules or flags, cleared at the start of the next Round.
 */

export function inflame(ctx: Ctx, t: RegimentState, why: string): void {
  if (t.location !== 'table' || t.flags.inflamed) return;
  t.flags.inflamed = true;
  ev(ctx, { type: 'spell', text: `${t.name} becomes "Inflamed" until the end of the Round (${why}, sk p.18).`, regimentId: t.id });
}

const gain = (ctx: Ctx, t: RegimentState, rules: string[], why: string) => {
  for (const raw of rules) {
    const m = raw.match(/^(.*?)\s*\((\+?)(\d+)\)$/);
    t.roundRules.push(m ? { name: m[1]!, x: Number(m[3]), ...(m[2] ? { plus: true } : {}), raw } : { name: raw, raw });
  }
  ev(ctx, { type: 'spell', text: `${t.name} gains ${rules.join(' and ')} until the end of the Round (${why}).`, regimentId: t.id });
};

const courtCheck = (court: 'Fire' | 'Water' | 'Air' | 'Earth', what = 'Regiment') => (s: Parameters<NonNullable<SpellDef['check']>>[0], t: RegimentState) =>
  ofCourt(s, t, court) ? null : `This Spell targets a [Court of ${court}] ${what}.`;

/** Engaged with a friendly (to the caster) Regiment of that Court. */
const engagedWithCourt = (ctx: Ctx, c: Caster, t: RegimentState, court: 'Water' | 'Air') => enemiesTouching(ctx.s, t).some((e) => e.owner === c.owner && ofCourt(ctx.s, e, court));

export const SK_SPELLS: Record<string, SpellDef> = {
  // ---------------------------------------------------------------- Court of Fire (sk p.18)
  'Burn to Cinders': {
    court: 'Fire', range: 12, attunement: 4, scaling: false, hits: true, target: 'enemy',
    apply: (ctx, c, t, n) => {
      spellHits(ctx, c, t, n, 'Burn to Cinders');
      inflame(ctx, t, 'Burn to Cinders');
    },
  },
  Cauterize: {
    court: 'Fire', range: 12, attunement: 3, scaling: false, hits: false, target: 'enemy',
    apply: (ctx, _c, t) => {
      t.flags.cauterized = true;
      ev(ctx, { type: 'spell', text: `${t.name} cannot be Healed until the end of the Round (Cauterize).`, regimentId: t.id });
      inflame(ctx, t, 'Cauterize');
    },
  },
  Ignite: {
    court: 'Fire', range: 12, attunement: 3, scaling: false, hits: true, target: 'enemy',
    check: (_s, t) => (t.flags.inflamed ? null : 'Ignite targets an "Inflamed" enemy Regiment.'),
    apply: (ctx, c, t) => {
      const s = ctx.s;
      const near = Object.values(s.regiments).filter((o) => o.id !== t.id && o.location === 'table' && distancePolys(regimentPolys(s, o), regimentPolys(s, t)) <= 6 + TOL);
      spellHits(ctx, c, t, 5, 'Ignite', {}, false);
      t.flags.inflamed = false;
      ev(ctx, { type: 'spell', text: `${t.name} loses its "Inflamed" status (Ignite).`, regimentId: t.id });
      // RULE-AMBIGUITY: AMB-68 — "other Regiments within 6″" is read literally: friend and foe.
      for (const o of near) inflame(ctx, o, 'Ignite');
    },
  },
  'Searing Sandstorm': {
    court: 'Fire', range: 'self', attunement: 3, scaling: false, hits: false, target: 'self',
    check: courtCheck('Fire'),
    apply: (ctx, _c, t) => {
      t.flags.searing = true;
      ev(ctx, { type: 'spell', text: `Searing Sandstorm: when an enemy Volleys ${t.name} this Round, it gains Tenacious (1) for that Volley and becomes "Inflamed".`, regimentId: t.id });
    },
  },
  'Molten Blades': {
    court: 'Fire', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: courtCheck('Fire'),
    apply: (ctx, _c, t) => {
      gain(ctx, t, ['Cleave (1)', 'Deadly Blades'], 'Molten Blades');
      inflame(ctx, t, 'Molten Blades');
    },
  },
  'Wreathed in Fire': {
    court: 'Fire', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: courtCheck('Fire'),
    apply: (ctx, _c, t) => {
      gain(ctx, t, ['Untouchable'], 'Wreathed in Fire');
      inflame(ctx, t, 'Wreathed in Fire');
    },
  },
  // ---------------------------------------------------------------- Court of Water (sk p.19)
  'Blood to Water': {
    court: 'Water', range: 12, attunement: 3, scaling: false, hits: true, target: 'enemy',
    apply: (ctx, c, t, n) => {
      let extra = 0;
      if (engagedWithCourt(ctx, c, t, 'Water')) {
        extra = t.profile.R === null ? 2 : resolveValue(ctx, t);
        ev(ctx, { type: 'spell', text: `${t.name} is engaged with a [Court of Water] Regiment: +${extra} Hits (${t.profile.R === null ? 'no Resolve' : 'its Resolve'}).`, regimentId: t.id });
      }
      spellHits(ctx, c, t, n + extra, 'Blood to Water');
    },
  },
  'Lammelar Flow': {
    court: 'Water', range: 12, attunement: 3, scaling: true, hits: false, target: 'friendly',
    check: courtCheck('Water'),
    apply: (ctx, _c, t) => gain(ctx, t, ['Aimed Shot'], 'Lammelar Flow'),
  },
  'Swirling Embrace': {
    court: 'Water', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: courtCheck('Water'),
    apply: (ctx, _c, t) => gain(ctx, t, ['Untouchable'], 'Swirling Embrace'),
  },
  'Induced Hypoxia': {
    court: 'Water', range: 12, attunement: 3, scaling: false, hits: false, target: 'enemy',
    apply: (ctx, _c, t) => {
      t.flags.hypoxia = true;
      ev(ctx, { type: 'spell', text: `${t.name} must use the lowest unmodified Resolve in the Regiment until the end of the Round (Induced Hypoxia).`, regimentId: t.id });
    },
  },
  'Flowing Stride': {
    court: 'Water', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: courtCheck('Water'),
    apply: (ctx, _c, t) => {
      t.flags.flowingStride = true;
      ev(ctx, { type: 'spell', text: `${t.name} ignores Hindering terrain until the end of the Round (Flowing Stride).`, regimentId: t.id });
    },
  },
  'Water to Blood': {
    court: 'Water', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: (_s, t) => (isMortal(t) ? null : 'Water to Blood targets a friendly [Mortal] Regiment.'),
    apply: (ctx, _c, t) => heal(ctx, t, 5, 'Water to Blood'),
  },
  // ---------------------------------------------------------------- Court of Air (sk p.20)
  'Lifting Winds': {
    court: 'Air', range: 12, attunement: 4, scaling: false, hits: false, target: 'friendly',
    check: courtCheck('Air'),
    apply: (ctx, c, t) => {
      // Every friendly [Court of Air] Regiment within 12″ of the caster (sk p.20).
      const from = regimentPolys(ctx.s, c.regiment);
      for (const r of Object.values(ctx.s.regiments))
        if (r.owner === c.owner && r.location === 'table' && ofCourt(ctx.s, r, 'Air') && (r.id === t.id || distancePolys(from, regimentPolys(ctx.s, r)) <= 12 + TOL)) gain(ctx, r, ['Unstoppable'], 'Lifting Winds');
    },
  },
  'Lightning Bolt': {
    court: 'Air', range: 12, attunement: 3, scaling: false, hits: true, target: 'enemy',
    apply: (ctx, c, t, n) => {
      let extra = 0;
      if (engagedWithCourt(ctx, c, t, 'Air')) {
        extra = stat(t, 'D');
        ev(ctx, { type: 'spell', text: `${t.name} is engaged with a [Court of Air] Regiment: +${extra} Hits (its Defense).`, regimentId: t.id });
      }
      spellHits(ctx, c, t, n + extra, 'Lightning Bolt');
    },
  },
  'Homing Winds': {
    court: 'Air', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: courtCheck('Air'),
    apply: (ctx, _c, t) => gain(ctx, t, ['Homing Winds'], 'Homing Winds: Volleys re-roll failed Hit Rolls of 6'),
  },
  'Air Step': {
    court: 'Air', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: (s, t) => (!ofCourt(s, t, 'Air') ? 'Air Step targets a friendly [Court of Air] Regiment.' : isEngaged(s, t) ? 'Air Step targets an unengaged Regiment.' : null),
    apply: (ctx, _c, t) => {
      ctx.s.pendingMove = { regimentId: t.id, kind: 'airStep', max: 2 };
      ev(ctx, { type: 'spell', text: `Air Step: ${t.name} may now make an Out of Sequence March of 2″ in any direction, without Wheeling (sk p.20).`, regimentId: t.id });
    },
  },
  Cyclone: {
    court: 'Air', range: 12, attunement: 3, scaling: false, hits: true, target: 'enemy',
    apply: (ctx, c, t, n) => {
      spellHits(ctx, c, t, n, 'Cyclone');
      t.flags.cyclone = true;
      ev(ctx, { type: 'spell', text: `Cyclone: if ${t.name} is engaged with a [Court of Air] Regiment in this Victory Phase, it counts as 0 Stands for Seizing.`, regimentId: t.id });
    },
  },
  'Wind Kissed Blades': {
    court: 'Air', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: courtCheck('Air'),
    apply: (ctx, _c, t) => gain(ctx, t, ['Counter-Attack', 'Parry'], 'Wind Kissed Blades'),
  },
  // ---------------------------------------------------------------- Court of Earth (sk p.21)
  // Sunder targets an Objective Zone; it counts as Hindering terrain for Charges this Round.
  'Sunder (the Land)': {
    court: 'Earth', range: 12, attunement: 3, scaling: false, hits: false, target: 'zone', minSuccesses: 3,
    apply: () => undefined,
    applyArea: (ctx, _c, areaId) => {
      (ctx.s.hinderingZones ??= []).push(areaId.slice(5));
      ev(ctx, { type: 'spell', text: `Sunder (the Land): Objective Zone ${areaId.slice(5)} counts as Hindering terrain until the end of the Round (sk p.21).` });
    },
  },
  'Stabilize (the Pattern)': {
    court: 'Earth', range: 'self', attunement: 3, scaling: false, hits: false, target: 'self',
    apply: (ctx, c) => {
      const from = regimentPolys(ctx.s, c.regiment);
      for (const r of Object.values(ctx.s.regiments))
        if (r.owner === c.owner && r.location === 'table' && isElemental(r) && distancePolys(from, regimentPolys(ctx.s, r)) <= 8 + TOL) {
          r.flags.stabilized = true;
          ev(ctx, { type: 'spell', text: `${r.name} ignores Aura of Death and Decay until the end of the Round (Stabilize).`, regimentId: r.id });
        }
    },
  },
  'Overwhelm (the Form)': {
    court: 'Earth', range: 12, attunement: 3, scaling: true, hits: false, target: 'friendly',
    check: (s, t) => (ofCourt(s, t, 'Earth') && isElemental(t) ? null : 'Overwhelm targets a [Court of Earth] [Elemental] Regiment.'),
    apply: (ctx, _c, t) => gain(ctx, t, ['Trample (+2)'], 'Overwhelm'),
  },
  'Reinforce (the Pattern)': {
    court: 'Earth', range: 12, attunement: 3, scaling: true, hits: false, target: 'friendly',
    check: courtCheck('Earth'),
    apply: (ctx, _c, t) => {
      t.flags.reinforced = true;
      ev(ctx, { type: 'spell', text: `${t.name} cannot Charge or Reform, and suffers no Hits from Impact or Trample, until the end of the Round (Reinforce).`, regimentId: t.id });
    },
  },
  'Hurl (the Earth)': {
    court: 'Earth', range: 12, attunement: 3, scaling: false, hits: true, target: 'enemy',
    apply: (ctx, c, t) => spellHits(ctx, c, t, 4, 'Hurl', { reduceD: 1 }),
  },
  'Reincarnate (the Self)': {
    court: 'Earth', range: 12, attunement: 4, scaling: false, hits: false, target: 'friendly',
    apply: (ctx, _c, t) => heal(ctx, t, 3, 'Reincarnate'),
  },
};

export { elementalKind };
