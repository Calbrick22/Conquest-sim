import { resolveAttack, stat } from '../combat';
import { ev, type Ctx } from '../dice';
import { overlaps } from '../geometry/polygon';
import { TOL } from '../geometry/vec';
import type { RegimentState } from '../model/types';
import { distancePolys, regimentPolys } from '../queries';
import { spellHits, type SpellDef } from '../spellCore';
import { piecePoly, terrainOf } from '../terrain';
import { addPower, hasDwRole, isAwakened, regRoles } from './dweghom';

/** Dweghom Spells: the Elemental Schools (dw p.26–27), the Ardent Kerawegh and the Lost Ancestor (dw p.28). */

const gain = (ctx: Ctx, t: RegimentState, rules: string[], why: string) => {
  for (const raw of rules) {
    const m = raw.match(/^(.*?)\s*\((\+?)(\d+)\)$/);
    t.roundRules.push(m ? { name: m[1]!, x: Number(m[3]), ...(m[2] ? { plus: true } : {}), raw } : { name: raw, raw });
  }
  ev(ctx, { type: 'spell', text: `${t.name} gains ${rules.join(' and ')} until the end of the Round (${why}).`, regimentId: t.id });
};
const ardent = (t: RegimentState) => (hasDwRole(regRoles(t), 'Ardent') ? null : 'This Spell targets a friendly [Ardent] Regiment.');

/** Marks a piece of terrain as Erupting this Round (dw p.26). */
function erupt(ctx: Ctx, pieceId: string, why: string): void {
  if (!(ctx.s.eruptingPieces ??= []).includes(pieceId)) ctx.s.eruptingPieces.push(pieceId);
  ev(ctx, { type: 'spell', text: `${why}: terrain ${pieceId} is Erupting until the end of the Round (dw p.26).` });
}

export const DW_SPELLS: Record<string, SpellDef> = {
  // School of Fire (dw p.26)
  Coruscation: { school: 'Fire', range: 16, attunement: 4, scaling: false, hits: true, target: 'enemy', apply: (ctx, c, t, n) => spellHits(ctx, c, t, n, 'Coruscation') },
  Fireball: { school: 'Fire', range: 12, attunement: 3, scaling: false, hits: true, target: 'enemy', apply: (ctx, c, t, n) => spellHits(ctx, c, t, n, 'Fireball', { reduceD: 2 }) },
  'Flame Wall': {
    school: 'Fire', range: 12, attunement: 3, scaling: false, hits: true, target: 'enemy',
    apply: (ctx, c, t, n) => {
      spellHits(ctx, c, t, n, 'Flame Wall');
      if (n >= 4 && t.location === 'table') {
        t.flags.flameWall = true;
        ev(ctx, { type: 'spell', text: `Flame Wall: ${t.name} counts as within Hindering terrain until the end of the Round (4+ successes).`, regimentId: t.id });
      }
    },
  },
  // School of Magma (dw p.26)
  'Magmatic Seep': {
    school: 'Magma', range: 12, attunement: 3, scaling: false, hits: false, target: 'terrain',
    apply: () => undefined,
    applyArea: (ctx, _c, areaId) => {
      const id = areaId.slice(8);
      erupt(ctx, id, 'Magmatic Seep');
      const piece = terrainOf(ctx.s).find((x) => x.id === id);
      if (piece?.keywords.includes('Cover')) {
        piece.keywords = piece.keywords.filter((k) => k !== 'Cover');
        const keep = ctx.s.terrainRestore?.[id];
        if (keep) ctx.s.terrainRestore![id] = keep.filter((k) => k !== 'Cover');
        ev(ctx, { type: 'spell', text: `Magmatic Seep: terrain ${id} loses the Cover keyword for the rest of the game.` });
      }
    },
  },
  Pyroclast: {
    school: 'Magma', range: 10, attunement: 3, scaling: false, hits: true, target: 'enemy',
    apply: (ctx, c, t, n) => spellHits(ctx, c, t, n, 'Pyroclast (flank)', { reduceD: 1 }, true, 'left'),
  },
  Eruption: {
    school: 'Magma', range: 12, attunement: 3, scaling: false, hits: false, target: 'terrain',
    apply: () => undefined,
    applyArea: (ctx, c, areaId) => {
      const id = areaId.slice(8);
      erupt(ctx, id, 'Eruption');
      const piece = terrainOf(ctx.s).find((x) => x.id === id);
      if (!piece) return;
      const poly = piecePoly(piece);
      // RULE-AMBIGUITY: AMB-81 — every Stand within, friend and foe, as written.
      for (const r of Object.values(ctx.s.regiments)) {
        if (r.location !== 'table') continue;
        const n = regimentPolys(ctx.s, r).filter((q) => overlaps(q, poly)).length;
        if (!n) continue;
        ev(ctx, { type: 'spell', text: `Eruption: ${r.name} has ${n} Stand${n > 1 ? 's' : ''} within: ${n} Hit${n > 1 ? 's' : ''} with Armor Piercing (1), on its flank.`, regimentId: r.id });
        resolveAttack(ctx, { attackerOwner: c.owner, attackerId: c.regiment.id, targetId: r.id, arc: 'left', pools: [{ label: 'Eruption', dice: 0, skill: 0, autoHits: n, reduceD: 1 }], morale: true, terrifying: 0, what: 'Eruption', kind: 'special' });
      }
    },
  },
  // School of Earth (dw p.27)
  'Roots of Stone': {
    school: 'Earth', range: 12, attunement: 4, scaling: true, hits: false, target: 'any',
    apply: (ctx, c, t) => {
      if (t.owner === c.owner) return gain(ctx, t, ['Counter-Attack', 'Parry'], 'Roots of Stone');
      t.roundMods.push({ stat: 'M', delta: -2, source: 'Roots of Stone' });
      ev(ctx, { type: 'spell', text: `${t.name} has −2 March until the end of the Round (Roots of Stone).`, regimentId: t.id });
    },
  },
  'Broken Ground': {
    school: 'Earth', range: 12, attunement: 3, scaling: false, hits: false, target: 'enemy',
    apply: (ctx, _c, t) => {
      t.flags.brokenGround = true;
      ev(ctx, { type: 'spell', text: `Broken Ground: ${t.name} loses Juggernaut and cannot re-roll its Charge Distance; a failed Charge costs it Wounds equal to the die, without Morale.`, regimentId: t.id });
    },
  },
  'Rock Shaping': {
    school: 'Earth', range: 12, attunement: 4, scaling: false, hits: true, target: 'enemy',
    apply: (ctx, c, t, n) => {
      spellHits(ctx, c, t, n, 'Rock Shaping');
      addPower(ctx, c.owner, 1, 'Rock Shaping');
    },
  },
  // School of Steel (Tempered Steelshaper, dw p.27)
  'Hone Blades': {
    school: 'Steel', range: 12, attunement: 3, scaling: true, hits: false, target: 'friendly',
    apply: (ctx, _c, t) => (hasDwRole(regRoles(t), 'Tempered') ? gain(ctx, t, ['Deadly Blades'], 'Hone Blades') : gain(ctx, t, ['Hone Blades'], 'Hone Blades: Clash re-rolls failed Hit Rolls of 6')),
  },
  'Unmake Armor': {
    school: 'Steel', range: 12, attunement: 3, scaling: true, hits: false, target: 'enemy',
    attunementFor: (_s, t) => Math.max(1, Math.min(6, stat(t, 'D'))),
    apply: (ctx, _c, t) => {
      t.roundMods.push({ stat: 'D', delta: -1, source: 'Unmake Armor' });
      t.flags.unmade = true;
      ev(ctx, { type: 'spell', text: `${t.name} has −1 Defense and loses Hardened until the end of the Round (Unmake Armor).`, regimentId: t.id });
    },
  },
  'Temper Plate': { school: 'Steel', range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly', apply: (ctx, _c, t) => gain(ctx, t, ['Indomitable (1)', 'Tenacious (1)'], 'Temper Plate') },
  // Ardent Kerawegh (dw p.28)
  Fear: {
    range: 12, attunement: 3, scaling: true, hits: false, target: 'enemy',
    apply: (ctx, _c, t) => {
      t.flags.fear = true;
      ev(ctx, { type: 'spell', text: `Fear: ${t.name} rolls 2D6 and keeps the lowest for Charge Distance, and re-rolls successful Morale Tests of 1, until the end of the Round.`, regimentId: t.id });
    },
  },
  Rancor: { range: 8, attunement: 3, scaling: false, hits: false, target: 'friendly', check: (_s, t) => ardent(t), apply: (ctx, _c, t) => gain(ctx, t, ['Juggernaut'], 'Rancor') },
  Dismay: {
    range: 12, attunement: 3, scaling: true, hits: false, target: 'enemy',
    apply: (ctx, _c, t) => {
      t.flags.dismay = true;
      ev(ctx, { type: 'spell', text: `Dismay: ${t.name} re-rolls successful Morale Tests of 1, and its Characters cannot decline a Duel, until the end of the Round.`, regimentId: t.id });
    },
  },
  Resolve: {
    range: 12, attunement: 3, scaling: false, hits: false, target: 'friendly',
    check: (_s, t) => ardent(t),
    apply: (ctx, _c, t, n) => {
      const x = Math.min(3, Math.floor(n / 2));
      if (x) gain(ctx, t, [`Indomitable (${x})`], `Resolve, ${n} successes`);
    },
  },
  // Lost Ancestor (dw p.28): cast automatically.
  'Songs of the Descent': {
    range: 10, attunement: 6, scaling: false, hits: true, target: 'enemy', autoCast: true,
    apply: (ctx, c, t) => {
      const from = regimentPolys(ctx.s, c.regiment);
      // RULE-AMBIGUITY: AMB-82 — Awakened Regiments of either side within 12″ count.
      const x = Math.min(6, Object.values(ctx.s.regiments).filter((r) => r.location === 'table' && isAwakened(ctx.s, r) && distancePolys(from, regimentPolys(ctx.s, r)) <= 12 + TOL).length);
      spellHits(ctx, c, t, 1 + x, `Songs of the Descent (1 + ${x} Awakened)`);
    },
  },
  'Litanies of Battle': { range: 12, attunement: 6, scaling: false, hits: false, target: 'friendly', autoCast: true, apply: (ctx, _c, t) => gain(ctx, t, ['Dread'], 'Litanies of Battle') },
};

