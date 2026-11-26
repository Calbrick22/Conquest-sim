import { heal } from '../activation';
import { ev, type Ctx } from '../dice';
import { TOL } from '../geometry/vec';
import type { ActivationState, CharacterState, GameState, PlayerId, RegimentState } from '../model/types';
import { distancePolys, regimentPolys } from '../queries';
import type { Caster, SpellDef } from '../spellCore';
import { piecePoly, terrainOf } from '../terrain';
import { addPower, awaken as awakenCore, creedActive, dw, empowerments, hasDwRole, hasOpt, isAwakened, isEngagedNow, isForged, regRoles, spendPower, warlord, warlordHas } from './dweghom';

/** Dweghom Actions, Draw Events, Supremacy and engine hooks (dw p.4–45). */

/** Out-of-sequence Rally on Awakening (dw p.4): the Regiment is no longer Broken. */
export function rallyOut(ctx: Ctx, r: RegimentState, why: string): void {
  r.broken = false;
  r.standsWhenBroken = null;
  r.standsAtRoundStart = r.stands.length;
  ev(ctx, { type: 'action', text: `${r.name} makes an out-of-sequence Rally and is no longer Broken (${why}, dw p.4).`, player: r.owner, regimentId: r.id });
}

export function awaken(ctx: Ctx, r: RegimentState, why: string): void {
  awakenCore(ctx, r, why, rallyOut, heal);
}

const near = (s: GameState, from: RegimentState, d: number, pick: (x: RegimentState) => boolean) =>
  Object.values(s.regiments).filter((x) => x.location === 'table' && pick(x) && distancePolys(regimentPolys(s, from), regimentPolys(s, x)) <= d + TOL);

// ---------------------------------------------------------------- Draw Events

export { DW_DRAW_EVENTS } from './dweghom';

export interface DwDrawChoice {
  option?: string;
  targetId?: string;
}

export function dwDrawEventProblems(s: GameState, r: RegimentState, _c: CharacterState | undefined, name: string, ch: DwDrawChoice): string[] {
  const st = dw(s, r.owner);
  if (!st) return ['Only a Dweghom army has this Draw Event.'];
  const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
  switch (name) {
    case 'Forged By the Elements': {
      const e = empowerments(s, r).find((x) => x.id === (ch.option ?? 'a'));
      if (!e) return ['Choose an Empowerment.'];
      if (r.flags.empowered) return ['The Empowerment has already been used this Round (dw p.4).'];
      if (st.pool < e.cost) return [`Needs ${e.cost} Elemental Power Marker${e.cost > 1 ? 's' : ''} (${st.pool} in the pool).`];
      return [];
    }
    case 'Preternatural Focus':
      if (!t || t.owner !== r.owner || !near(s, r, 10, (x) => x.id === t.id).length) return ['Choose a friendly Regiment within 10″.'];
      return isAwakened(s, t) ? [`${t.name} is already Awakened.`] : [];
    case 'Runeforged Plate': {
      const n = ch.option === '2' ? 2 : 1;
      return st.pool < n ? [`Needs ${n} Elemental Power Marker${n > 1 ? 's' : ''}.`] : [];
    }
    case 'Fires of the Descent':
      if (!isAwakened(s, r)) return ['The Lost must be Awakened (dw p.39).'];
      if (!t || t.owner !== r.owner || !near(s, r, 8, (x) => x.id === t.id).length) return ['Choose a friendly Regiment within 8″.'];
      return [];
  }
  return [];
}

export function applyDwDrawEvent(ctx: Ctx, r: RegimentState, c: CharacterState | undefined, name: string, ch: DwDrawChoice): void {
  const s = ctx.s;
  const t = ch.targetId ? s.regiments[ch.targetId] : undefined;
  const rr = (raw: string) => {
    const m = raw.match(/^(.*?)\s*\((\+?)(\d+)\)$/);
    r.roundRules.push(m ? { name: m[1]!, x: Number(m[3]), ...(m[2] ? { plus: true } : {}), raw } : { name: raw, raw });
  };
  switch (name) {
    case 'Forged By the Elements': {
      const e = empowerments(s, r).find((x) => x.id === (ch.option ?? 'a'))!;
      spendPower(ctx, r.owner, e.cost, `${r.name}: Forged By the Elements`);
      r.flags.empowered = true;
      const a = e.id === 'a' || e.id === 'both';
      const b = e.id === 'b' || e.id === 'both';
      switch (r.name) {
        case 'Fireforged':
          rr('Barrage (+2)');
          break;
        case 'Hellbringer Drake': {
          const k = e.id === 'x3' ? 3 : e.id === 'x2' ? 2 : 1;
          rr(`Barrage (+${2 * k})`);
          rr(`Armor Piercing (+${Math.min(2, k)})`);
          break;
        }
        case 'Inferno Automata':
          if (a) r.roundMods.push({ stat: 'M', delta: 1, source: 'Empowerment' });
          if (b) rr('Impact (+2)');
          break;
        case 'Found':
          rr('Barrage (+1)');
          rr('Barrage Range (+4)');
          break;
        case 'Magmaforged':
          if (a) r.flags.chargeBonus = (r.flags.chargeBonus ?? 0) + 2;
          if (b) r.roundMods.push({ stat: 'D', delta: 1, source: 'Empowerment' });
          break;
        case 'Steelforged':
          if (a) r.roundMods.push({ stat: 'A', delta: 2, source: 'Empowerment' });
          if (b) rr('Hardened (1)');
          break;
        case 'Stoneforged':
          if (a) heal(ctx, r, 3, 'Empowerment');
          if (b) r.roundMods.push({ stat: 'M', delta: 2, source: 'Empowerment' });
          break;
      }
      ev(ctx, { type: 'draw-event', text: `Forged By the Elements: ${r.name} gains ${e.label} until the end of the Round (dw p.4).`, regimentId: r.id });
      awaken(ctx, r, 'spent Elemental Power');
      return;
    }
    case 'Preternatural Focus':
      awaken(ctx, t!, `Preternatural Focus (${c?.name ?? r.name})`);
      return;
    case 'Unassailable Authority':
      awaken(ctx, r, 'Unassailable Authority');
      return;
    case 'Gifted in Fire':
      addPower(ctx, r.owner, 1, 'Gifted in Fire');
      return;
    case 'Runeforged Plate': {
      const n = ch.option === '2' ? 2 : 1;
      spendPower(ctx, r.owner, n, 'Runeforged Plate');
      const st = dw(s, r.owner)!;
      if (c) st.charAttacks = { ...(st.charAttacks ?? {}), [c.id]: 2 * n };
      ev(ctx, { type: 'draw-event', text: `Runeforged Plate: ${c?.name ?? r.name} adds +${2 * n} Attacks until the end of the Round (dw p.23).`, regimentId: r.id });
      return;
    }
    case 'Fires of the Descent':
      t!.roundRules.push({ name: 'Relentless Blows', raw: 'Relentless Blows' });
      ev(ctx, { type: 'draw-event', text: `Fires of the Descent: ${t!.name} gains Relentless Blows until the end of the Round (dw p.39).`, regimentId: t!.id });
      return;
  }
}

// ---------------------------------------------------------------- Actions: spending Markers to Awaken

export type DwSpend = 'wander' | 'herald';

export function dwSpendProblems(s: GameState, r: RegimentState, what: DwSpend): string[] {
  const st = dw(s, r.owner);
  const act = s.activation;
  if (!st || !act || act.regimentId !== r.id || act.characterId) return ['Only during the Regiment’s own Activation.'];
  if (isAwakened(s, r)) return [`${r.name} is already Awakened.`];
  if (what === 'wander') {
    // Not All who Wander are Lost (Lost Ancestor, dw p.20): Lost or Found, at the start of the Activation, 2 Markers.
    if (r.name !== 'Lost' && r.name !== 'Found') return ['Only Lost or Found Regiments.'];
    if (!Object.values(s.characters).some((c) => c.id.startsWith(r.owner) && !c.destroyed && c.name === 'Lost Ancestor')) return ['Needs a friendly Lost Ancestor.'];
    if (act.actions.length || act.drawEvents?.length) return ['At the start of the Activation, before Draw Events (dw p.20).'];
    return st.pool >= 2 ? [] : ['Needs 2 Elemental Power Markers.'];
  }
  // Heralds, Tempered Creed (dw p.45): 1 Marker to Awaken.
  if (!creedActive(s, r.owner, 'Tempered')) return ['Only when the army follows the Tempered Creed (dw p.45).'];
  if (!['Herald of Fire', 'Herald of Magma', 'Herald of Stone', 'Flamecaster'].some((h) => [...(r.options ?? []), ...r.commandModels].includes(h)) || !r.stands.some((x) => x.isCommand)) return ['The Regiment needs a Herald.'];
  return st.pool >= 1 ? [] : ['Needs 1 Elemental Power Marker.'];
}

export function applyDwSpend(ctx: Ctx, r: RegimentState, what: DwSpend): void {
  spendPower(ctx, r.owner, what === 'wander' ? 2 : 1, what === 'wander' ? 'Not All who Wander are Lost' : 'Herald');
  awaken(ctx, r, what === 'wander' ? 'Not All who Wander are Lost' : 'Herald');
}

// ---------------------------------------------------------------- Activation hooks

export function dwActivationStart(ctx: Ctx, r: RegimentState): void {
  const s = ctx.s;
  const st = dw(s, r.owner);
  const act = s.activation!;
  if (!st) return;
  if (act.characterId) {
    const c = s.characters[act.characterId]!;
    // Forgemaster (Tempered Sorcerer Warlord, dw p.7): a free additional Spellcasting Action each Round.
    if (c.supremacyAbilities.some((x) => /forgemaster/i.test(x))) (act.extra ??= []).push({ kind: 'spell', reason: 'Forgemaster', free: true });
    return;
  }
  // Thesis/Antithesis/Synthesis [Activated] (dw p.7): a [Forged] Regiment Activating adds a Marker.
  if (st.steelshaperRound === s.round && isForged(r)) addPower(ctx, r.owner, 1, `${r.name} Activates (Thesis/Antithesis/Synthesis)`);
}

/** End of a [Forged] Regiment's Activation without its Empowerment: +1 Marker (dw p.4). */
export function dwActivationEnd(ctx: Ctx, act: ActivationState, r: RegimentState): void {
  if (!dw(ctx.s, r.owner) || act.characterId || !isForged(r)) return;
  if (!(act.drawEvents ?? []).includes('Forged By the Elements')) addPower(ctx, r.owner, 1, `${r.name} did not use Forged By the Elements`);
}

/** After every Action: Paragon of War (Exemplar Warlord, dw p.6). */
export function dwAfterApply(ctx: Ctx): void {
  const s = ctx.s;
  for (const p of ['P1', 'P2'] as const) {
    if (!dw(s, p) || !warlordHas(s, p, 'Paragon of War')) continue;
    const w = warlord(s, p)!;
    const host = w.attachedTo && !w.destroyed ? s.regiments[w.attachedTo] : undefined;
    if (!host || !isEngagedNow(s, host)) continue;
    for (const r of Object.values(s.regiments)) if (r.owner === p && r.location === 'table' && !isAwakened(s, r)) awaken(ctx, r, 'Paragon of War');
  }
}

/** A successful Charge (Ardent Creed, dw p.6). */
export function dwOnCharge(ctx: Ctx, r: RegimentState): void {
  if (!dw(ctx.s, r.owner) || !creedActive(ctx.s, r.owner, 'Ardent')) return;
  if (hasDwRole(regRoles(r), 'Ardent') || hasDwRole(regRoles(r), 'Clan')) awaken(ctx, r, 'successful Charge (Ardent Creed)');
}

/** An enemy Regiment destroyed by this Regiment (Ardent Creed, dw p.6; Blades of the Ancestor, dw p.29). */
export function dwOnDestroyed(ctx: Ctx, attackerId: string | undefined, target: RegimentState): void {
  const s = ctx.s;
  const a = attackerId ? s.regiments[attackerId] : undefined;
  if (!a || a.owner === target.owner || !dw(s, a.owner)) return;
  if (creedActive(s, a.owner, 'Ardent') && (hasDwRole(regRoles(a), 'Ardent') || hasDwRole(regRoles(a), 'Clan'))) awaken(ctx, a, `destroyed ${target.name} (Ardent Creed)`);
  if (a.name === 'Dragonslayers') for (const x of near(s, a, 8, (x) => x.owner === a.owner && x.id !== a.id)) awaken(ctx, x, 'Blades of the Ancestor');
}

/** Broken (dw p.4, p.31): Awakened Regiments cannot be Broken; Flame Berserkers Awaken instead. Returns true to stop it. */
export function dwPreventBroken(ctx: Ctx, r: RegimentState): boolean {
  if (!dw(ctx.s, r.owner)) return false;
  if (r.name === 'Flame Berserkers') {
    if (!isAwakened(ctx.s, r)) awaken(ctx, r, 'Life for Glory: instead of Broken');
    return true;
  }
  if (isAwakened(ctx.s, r)) {
    ev(ctx, { type: 'note', text: `${r.name} is Awakened and cannot become Broken (dw p.4).`, regimentId: r.id });
    return true;
  }
  return false;
}

/** The Unbound (dw p.5): Dweghom Regiments cannot be Shattered. */
/** Ardent Creed (dw p.6): friendly [Ardent] and [Clan] Command Stands may always Die Fighting! */
export function dwCommandDiesFighting(s: GameState, r: RegimentState): boolean {
  if (!dw(s, r.owner) || !creedActive(s, r.owner, 'Ardent')) return false;
  const roles = [...regRoles(r), ...(r.grantRoles ?? [])];
  return hasDwRole(roles, 'Ardent') || hasDwRole(roles, 'Clan');
}

export function dwNoShatter(s: GameState, r: RegimentState): boolean {
  return !!dw(s, r.owner);
}

/** Life for Glory (Flame Berserkers, dw p.31): no Resolve, always passes Morale. */
export function dwAutoPassesMorale(s: GameState, r: RegimentState): boolean {
  return !!dw(s, r.owner) && r.name === 'Flame Berserkers';
}

// ---------------------------------------------------------------- Supremacy (dw p.6–8)

export function dwActivatedSupremacy(ctx: Ctx, p: PlayerId): boolean {
  const s = ctx.s;
  if (!dw(s, p)) return false;
  if (warlordHas(s, p, 'Herald of War')) {
    for (const r of Object.values(s.regiments))
      if (r.owner === p && r.location === 'table' && hasDwRole(regRoles(r), 'Ardent')) {
        heal(ctx, r, 4, 'Herald of War');
        r.roundRules.push({ name: 'Lethal Demise', x: 4, plus: true, raw: 'Lethal Demise (+4)' });
      }
    ev(ctx, { type: 'supremacy', text: `${p} activates Herald of War: [Ardent] Regiments Heal 4 and gain Lethal Demise (+4) until the end of the Round (dw p.6).`, player: p });
    return true;
  }
  if (warlordHas(s, p, 'Thesis/Antithesis/Synthesis')) {
    dw(s, p)!.steelshaperRound = s.round;
    ev(ctx, { type: 'supremacy', text: `${p} activates Thesis/Antithesis/Synthesis: each [Forged] Regiment that Activates this Round adds an Elemental Power Marker (dw p.7).`, player: p });
    return true;
  }
  return false;
}

/** First Born of War (Hold Raegh Warlord, dw p.8): two Regiments chosen in the Supremacy Phase. */
export function raeghProblems(s: GameState, p: PlayerId, ids: string[]): string[] {
  if (!dw(s, p) || !warlordHas(s, p, 'First Born of War')) return ['Only a Hold Raegh Warlord has First Born of War.'];
  if (s.step !== 'supremacy') return ['Chosen in the Supremacy Phase (dw p.8).'];
  if (ids.length > 2 || new Set(ids).size !== ids.length) return ['Choose up to two different Regiments.'];
  if (ids.some((id) => s.regiments[id]?.owner !== p || s.regiments[id]?.location !== 'table')) return ['Choose friendly Regiments on the Battlefield.'];
  return [];
}

/** Applied at the end of the Supremacy Phase; without a choice the two nearest the enemy are taken. */
export function dwEndOfSupremacy(ctx: Ctx): void {
  const s = ctx.s;
  for (const p of ['P1', 'P2'] as const) {
    const st = dw(s, p);
    if (!st || !warlordHas(s, p, 'First Born of War')) continue;
    const w = warlord(s, p)!;
    // [Battlefield]: the Hold Raegh must be on the Battlefield.
    if (w.destroyed || !w.attachedTo || s.regiments[w.attachedTo]?.location !== 'table') continue;
    let ids = st.raeghChoice.filter((id) => s.regiments[id]?.location === 'table');
    if (!ids.length) {
      // RULE-AMBIGUITY: AMB-83 — without a choice, the two friendly Regiments nearest an enemy.
      const enemies = Object.values(s.regiments).filter((e) => e.owner !== p && e.location === 'table');
      const dist = (r: RegimentState) => Math.min(99, ...enemies.map((e) => distancePolys(regimentPolys(s, r), regimentPolys(s, e))));
      ids = Object.values(s.regiments).filter((r) => r.owner === p && r.location === 'table').sort((a, b) => dist(a) - dist(b)).slice(0, 2).map((r) => r.id);
    }
    for (const id of ids) awaken(ctx, s.regiments[id]!, 'First Born of War');
    st.raeghChoice = [];
  }
}

// ---------------------------------------------------------------- Duels (dw p.10–24)

/** Can the target Character decline (Dismay, Tempered Goad; dw p.22, p.28)? */
export function dwMustAccept(s: GameState, challenger: CharacterState, target: CharacterState): boolean {
  const tr = target.attachedTo ? s.regiments[target.attachedTo] : undefined;
  return hasOpt(challenger, 'Tempered Goad') || !!tr?.flags.dismay;
}

/** A declined Duel: To the End Awakens the challenger's Regiment; Refined Beyond Nature has no penalty. */
export function dwOnDecline(ctx: Ctx, challenger: CharacterState, target: CharacterState): boolean {
  const s = ctx.s;
  const cr = challenger.attachedTo ? s.regiments[challenger.attachedTo] : undefined;
  if (cr && dw(s, cr.owner) && /kerawegh|raegh|exemplar/i.test(challenger.name)) awaken(ctx, cr, 'To the End: the Duel was declined');
  // Refined Beyond Nature (Steelshaper, dw p.18): its Regiment suffers no penalty for refusing.
  return /steelshaper/i.test(target.name) && !!target.attachedTo && !!dw(s, s.regiments[target.attachedTo]!.owner);
}

/** To the End (dw p.10–14): Duel Actions continue until a Character is destroyed. */
export function toTheEnd(c: CharacterState): boolean {
  return /kerawegh|raegh|exemplar/i.test(c.name);
}

/** After a Duel: Invocation of the Shattering and Superiority (dw p.22, p.24). */
export function dwAfterDuel(ctx: Ctx, c: CharacterState, target: CharacterState, targetRegimentId: string | null): void {
  const s = ctx.s;
  const cr = c.attachedTo ? s.regiments[c.attachedTo] : undefined;
  if (cr && hasOpt(c, 'Invocation of the Shattering')) {
    cr.roundRules.push({ name: 'Flawless Strikes', raw: 'Flawless Strikes' });
    ev(ctx, { type: 'note', text: `Invocation of the Shattering: ${cr.name} gains Flawless Strikes until the end of the Round (dw p.22).`, regimentId: cr.id });
  }
  if (target.destroyed && hasOpt(c, 'Superiority') && targetRegimentId) {
    const tr = s.regiments[targetRegimentId];
    if (tr && tr.location === 'table') {
      tr.roundMods.push({ stat: 'R', delta: -1, source: 'Superiority' });
      ev(ctx, { type: 'note', text: `Superiority: ${tr.name} has −1 Resolve until the end of the Round (dw p.24).`, regimentId: tr.id });
    }
  }
}

// ---------------------------------------------------------------- Spells

const steelshaper = (c: CharacterState | undefined) => !!c && /steelshaper/i.test(c.name);

export function dwNoInterference(c: Caster): boolean {
  return steelshaper(c.character);
}

/** Igneolithic Mastery (dw p.18): 1 more success against the Steelshaper's Regiment or [Forged] within 10″. */
export function dwExtraSuccessesNeeded(s: GameState, c: Caster, t: RegimentState): number {
  if (t.owner === c.owner) return 0;
  const guard = Object.values(s.characters).find((x) => steelshaper(x) && !x.destroyed && x.attachedTo && s.regiments[x.attachedTo]?.owner === t.owner && !!dw(s, t.owner));
  if (!guard) return 0;
  const host = s.regiments[guard.attachedTo!]!;
  if (host.id === t.id) return 1;
  return isForged(t) && host.location === 'table' && distancePolys(regimentPolys(s, host), regimentPolys(s, t)) <= 10 + TOL ? 1 : 0;
}

/** Forgemaster (dw p.7): that Character attempts each Spell once per Round. */
export function dwSpellProblems(s: GameState, c: Caster, name: string): string[] {
  const st = dw(s, c.owner);
  if (!st || !c.character || !c.character.supremacyAbilities.some((x) => /forgemaster/i.test(x))) return [];
  return (st.castThisRound[c.character.id] ?? []).includes(name.toLowerCase()) ? [`${c.name} has already attempted ${name} this Round (Forgemaster, dw p.7).`] : [];
}

/** Pyroclast (dw p.26): may target an enemy within 6″ of Erupting terrain regardless of range and Line of Sight. */
export function dwRangeExempt(s: GameState, name: string, t: RegimentState): boolean {
  if (name.toLowerCase() !== 'pyroclast' || !(s.eruptingPieces ?? []).length) return false;
  const pieces = terrainOf(s).filter((p) => s.eruptingPieces!.includes(p.id)).map(piecePoly);
  return distancePolys(regimentPolys(s, t), pieces) <= 6 + TOL;
}

/** Tempered Creed (dw p.7): a [Tempered] Character may spend up to 6 Markers for +1 Wizard per 2. */
export function boostProblems(s: GameState, c: Caster, boost: number): string[] {
  if (!boost) return [];
  const st = dw(s, c.owner);
  if (!st || !creedActive(s, c.owner, 'Tempered')) return ['Only under the Tempered Creed (dw p.7).'];
  if (!c.character || !hasDwRole(c.character.roles ?? [], 'Tempered')) return ['Only a [Tempered] Character (dw p.7).'];
  if (boost < 0 || boost > 6 || boost % 2) return ['Spend 2, 4 or 6 Markers.'];
  return st.pool >= boost ? [] : [`Only ${st.pool} Markers in the pool.`];
}

export function spendBoost(ctx: Ctx, c: Caster, boost: number): number {
  if (!spendPower(ctx, c.owner, boost, `${c.name}: Wizard (+${boost / 2}) (Tempered Creed)`)) return 0;
  return boost / 2;
}

/** After a successful Spell: Tempered Creed Marker, Hymns of War, But First, Thaumaturge (dw p.7–25). */
export function dwAfterCast(ctx: Ctx, c: Caster, def: SpellDef | undefined, t: RegimentState | null): void {
  const s = ctx.s;
  const st = dw(s, c.owner);
  if (!st) return;
  const ch = c.character;
  const act = s.activation!;
  if (ch && def?.school && creedActive(s, c.owner, 'Tempered') && hasDwRole(ch.roles ?? [], 'Tempered')) addPower(ctx, c.owner, 1, `${c.name} casts a ${def.school} Spell (Tempered Creed)`);
  if (ch && /kerawegh/i.test(ch.name)) {
    // Hymns of War (dw p.11): a friendly [Ardent] Regiment within 10″ Awakens.
    // RULE-AMBIGUITY: AMB-84 — the engine picks the nearest one that is not yet Awakened.
    const cand = near(s, c.regiment, 10, (x) => x.owner === c.owner && hasDwRole(regRoles(x), 'Ardent') && !isAwakened(s, x)).sort(
      (a, b) => distancePolys(regimentPolys(s, c.regiment), regimentPolys(s, a)) - distancePolys(regimentPolys(s, c.regiment), regimentPolys(s, b)),
    )[0];
    if (cand) awaken(ctx, cand, 'Hymns of War');
    // But First (dw p.10): a free Duel Action after a Spellcasting Action.
    if (!act.extra?.some((e) => e.reason === 'But First')) (act.extra ??= []).push({ kind: 'duel', reason: 'But First', free: true, anytime: true });
  }
  // Thaumaturge (dw p.25): an enemy Regiment destroyed by its Spell gives Wizard (+1), to at most +2.
  if (ch && t && t.location === 'destroyed' && hasOpt(ch, 'Thaumaturge')) {
    const have = ch.baseRules.filter((x) => x.name === 'Wizard' && x.plus).length;
    if (have < 2) {
      ch.baseRules.push({ name: 'Wizard', x: 1, plus: true, raw: 'Wizard (+1)' });
      ev(ctx, { type: 'note', text: `Thaumaturge: ${c.name} gains Wizard (+1) for the rest of the battle (dw p.25).` });
    }
  }
}

/** Records a Spell attempt for Forgemaster (dw p.7). */
export function dwOnAttempt(s: GameState, c: Caster, name: string): void {
  const st = dw(s, c.owner);
  if (st && c.character) (st.castThisRound[c.character.id] ??= []).push(name.toLowerCase());
}
