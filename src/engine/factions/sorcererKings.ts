import { parseRuleRef } from '../../import/ruleTokens';
import type { RuleRef } from '../../import/types';
import { ev, type Ctx } from '../dice';
import { overlaps, type Poly } from '../geometry/polygon';
import { TOL } from '../geometry/vec';
import type { CharacterState, CommandCard, Court, GameState, PlayerId, RegimentState, SkPlayerState, StatMod } from '../model/types';
import { attachedCharacter, distancePolys, enemiesTouching, regimentPolys } from '../queries';
import { hasRule } from '../rules/special/rules';
import { piecePoly, terrainOf } from '../terrain';

/**
 * Sorcerer Kings faction rules (Sorcerer Kings army list, 2026 Tainted Earth update; cited as
 * `sk p.N`, the PDF page). Mechanics only, described in our own words:
 *
 * - Courts (sk p.4): each Character picks a Court and knows its Spells and Rituals; [Mortals]
 *   take the Court of their Warband's Character; some entries take the Warlord's Court.
 * - Rituals (sk p.5, p.22–25): one is Being Prepared; Spells and Elemental Conduit add Ritual
 *   Markers; at its Threshold it is completed and its Command Card joins the next Command Stack;
 *   drawing it resolves the effect. Elemental Discharge (sk p.5) gives the first new Ritual of each
 *   Round as many Markers as the Round number (at most 5).
 * - Unit rules (sk p.27–46): Fire, Air, Water and Earth Elemental, Forms, Gifted Mortals and others.
 */

export const COURTS: Court[] = ['Fire', 'Air', 'Water', 'Earth'];

export const SK_DRAW_EVENTS = ['Elemental Conduit', 'Elemental Prowess', 'Elemental Assault', 'Dancing Scimitar', 'Fan the Flames'];

export const RITUALS: Record<string, { court: Court; threshold: number; page: number }> = {
  'Intrusive Thoughts': { court: 'Fire', threshold: 7, page: 22 },
  Conflagration: { court: 'Fire', threshold: 7, page: 22 },
  'Fiery Dominion': { court: 'Fire', threshold: 7, page: 22 },
  'Call forth the Deep': { court: 'Water', threshold: 5, page: 23 },
  'Violent Geyser': { court: 'Water', threshold: 7, page: 23 },
  'Soothing Tides': { court: 'Water', threshold: 6, page: 23 },
  'Far Sight': { court: 'Air', threshold: 7, page: 24 },
  Sayf: { court: 'Air', threshold: 7, page: 24 },
  'Spiteful Winds': { court: 'Air', threshold: 7, page: 24 },
  'Gifts of the Earth': { court: 'Earth', threshold: 7, page: 25 },
  Earthquake: { court: 'Earth', threshold: 7, page: 25 },
  'Kiss of the Earth': { court: 'Earth', threshold: 6, page: 25 },
};

export const COURT_SPELLS: Record<Court, string[]> = {
  Fire: ['Burn to Cinders', 'Cauterize', 'Ignite', 'Searing Sandstorm', 'Molten Blades', 'Wreathed in Fire'],
  Water: ['Blood to Water', 'Lammelar Flow', 'Swirling Embrace', 'Induced Hypoxia', 'Flowing Stride', 'Water to Blood'],
  Air: ['Lifting Winds', 'Lightning Bolt', 'Homing Winds', 'Air Step', 'Cyclone', 'Wind Kissed Blades'],
  Earth: ['Sunder (the Land)', 'Stabilize (the Pattern)', 'Overwhelm (the Form)', 'Reinforce (the Pattern)', 'Hurl (the Earth)', 'Reincarnate (the Self)'],
};

/** Spell names compare without "(the …)" suffixes, case and apostrophes. */
export function spellKey(name: string): string {
  return name.toLowerCase().replace(/[’']/g, "'").replace(/\s*\(the [^)]*\)\s*$/, '').trim();
}

export function courtOfSpell(name: string): Court | undefined {
  const k = spellKey(name);
  return COURTS.find((c) => COURT_SPELLS[c].some((x) => spellKey(x) === k));
}

type Form = { group: string; options: { id: string; label: string }[] };

/** Entry data (sk p.27–46), by entry name. */
export interface SkUnit {
  /** 'warlord': the Warlord's Court (Gifted Mortals, Denizens of the Upper Planes). */
  court?: Court | 'warlord';
  elemental?: Court;
  spells?: string[];
  /** Casts Spells as if it were a Character (Chandavat, Apsara). */
  casts?: boolean;
  /** One free Spellcasting Action each Activation (Marid Sahar). */
  freeSpell?: boolean;
  /** Tenacious (1) when targeted by an enemy Volley. */
  volleyTenacious?: boolean;
  giftedMortals?: boolean;
  eminence?: boolean;
  forms?: Form[];
  /** Enemies engaged with it count as in Water during their Clash (Dread Tide, Tidecaller). */
  dreadTide?: boolean;
  /** [Aura] Water Elementals within 8″ gain Terrifying (+1) (Dread Tide). */
  terrorAura?: boolean;
  lastWord?: boolean;
  /** +3″ Charge Distance against these (Arrogance, Hubris). */
  chargeVs?: 'character' | 'monster';
  shattered?: 'perfection' | 'raging';
  earthenAegis?: boolean;
  /** May Volley while in contact, at the enemy in contact (Eye of the Storm, Mahut). */
  volleyInContact?: boolean;
  /** One free Volley each Activation, never more than one Volley (Mahut). */
  freeVolley?: boolean;
  aqueousBranding?: boolean;
  infernalBranding?: boolean;
  /** Fury of the Tempest / Eye of the Storm after an Air Ritual. */
  afterAirRitual?: 'fury' | 'eye';
  tether?: boolean;
  /** Draw Events from the entry text. */
  drawEvents?: string[];
  page: number;
}

const two = (group: string, a: [string, string], b: [string, string]): Form => ({ group, options: [{ id: a[0], label: a[1] }, { id: b[0], label: b[1] }] });

export const SK_UNITS: Record<string, SkUnit> = {
  'Mahabharati Initiates': { court: 'warlord', giftedMortals: true, eminence: true, page: 27 },
  'Mahabharati Sorcerer Saints': { court: 'warlord', giftedMortals: true, drawEvents: ['Elemental Prowess'], page: 28 },
  'Dhanur Disciples': { page: 29 },
  Rajakur: { page: 30 },
  Ghols: { court: 'warlord', page: 31 },
  'Efreet Flamecasters': { elemental: 'Fire', infernalBranding: true, page: 32 },
  'Efreet Sword Dancers': { elemental: 'Fire', page: 33 },
  'Rakshasa Bakasura': { elemental: 'Fire', lastWord: true, chargeVs: 'character', page: 34 },
  'Rakshasa Ravanar': { elemental: 'Fire', lastWord: true, chargeVs: 'monster', page: 35 },
  'Steelheart Djinn': { elemental: 'Air', page: 36 },
  'Windborne Djinn': { elemental: 'Air', page: 37 },
  'Trinavarta Sabhagrih': { elemental: 'Air', volleyTenacious: true, tether: true, afterAirRitual: 'fury', page: 38 },
  'Trinavarta Chandavat': { elemental: 'Air', volleyTenacious: true, volleyInContact: true, afterAirRitual: 'eye', spells: ['Lifting Winds', 'Lightning Bolt'], casts: true, page: 39 },
  'Eternal Ikons': { elemental: 'Earth', earthenAegis: true, shattered: 'perfection', page: 40 },
  'Eternal Destroyers': { elemental: 'Earth', earthenAegis: true, shattered: 'raging', page: 41 },
  Mahut: { elemental: 'Earth', volleyInContact: true, freeVolley: true, page: 42 },
  'Marid Lancers': { elemental: 'Water', forms: [two('Wavebreaker Form', ['impact', 'Impact (+2)'], ['brutal', 'Brutal Impact (+1)'])], page: 43 },
  'Marid Sahar': { elemental: 'Water', spells: ['Blood to Water'], freeSpell: true, aqueousBranding: true, forms: [two('Waveborne Form', ['wizard', 'Wizard (+2)'], ['barrage', 'Barrage (+2)'])], page: 44 },
  'Marid Apsara': {
    elemental: 'Water',
    spells: ['Blood to Water', 'Flowing Stride', 'Swirling Embrace'],
    casts: true,
    aqueousBranding: true,
    forms: [two('Arcane Tide Form', ['free', 'a free Spellcasting Action'], ['range', '+4″ Spell range']), two('Tidecaller', ['aura', 'Water Elementals within 8″ count as in Water'], ['engaged', 'engaged enemies count as in Water'])],
    page: 45,
  },
  'Marid Shaytan': { elemental: 'Water', dreadTide: true, terrorAura: true, forms: [two('Stormqueen Form', ['impact', 'Impact (+6)'], ['attacks', '+4 Attacks'])], page: 46 },
};

export function skUnit(r: { name: string }): SkUnit | undefined {
  return SK_UNITS[r.name];
}

export function isSorcererKings(s: GameState, p: PlayerId): boolean {
  return /sorcerer\s*kings/i.test(s.players[p].faction);
}

export function sk(s: GameState, p: PlayerId): SkPlayerState | undefined {
  return s.players[p].sk;
}

const ref = (raw: string): RuleRef => parseRuleRef(raw);
const lc = (x: string) => x.toLowerCase();
const norm = (x: string) => lc(x).replace(/[’]/g, "'");
const hasOpt = (c: CharacterState, n: string) => c.options.some((o) => norm(o) === norm(n));
const roleList = (r: RegimentState) => [...r.roles, ...(r.roundRoles ?? []), ...(r.grantRoles ?? [])].map((x) => x.replace(/[[\]]/g, '').trim().toLowerCase());

export function isElemental(r: RegimentState): boolean {
  return roleList(r).some((x) => x === 'elemental' || x === 'elementals');
}
export function isMortal(r: RegimentState): boolean {
  return roleList(r).some((x) => x === 'mortal' || x === 'mortals');
}
export function isMahabharati(r: RegimentState): boolean {
  return roleList(r).includes('mahabharati');
}

// ---------------------------------------------------------------- Courts

function courtsIn(names: readonly string[]): Court[] {
  return COURTS.filter((c) => names.some((n) => new RegExp(`court of ${c}`, 'i').test(n)));
}

export function warlord(s: GameState, p: PlayerId): CharacterState | undefined {
  return Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p));
}

export function warlordHas(s: GameState, p: PlayerId, ability: string): boolean {
  return (warlord(s, p)?.supremacyAbilities ?? []).some((a) => lc(a) === lc(ability));
}

const isSardar = (c: CharacterState) => /sardar/i.test(c.name);

/**
 * A Character's Courts (sk p.8–13): from its Battlefield Roles or options, else from the Spells it
 * knows. RULE-AMBIGUITY: AMB-65 — the export format for the Court choice is not known yet. The
 * Mahabharati Sardar has the Warlord's Court (sk p.15).
 */
export function characterCourts(s: GameState, c: CharacterState): Court[] {
  if (isSardar(c) && !c.isWarlord) {
    const w = warlord(s, c.id.startsWith('P1') ? 'P1' : 'P2');
    return w && w !== c ? characterCourts(s, w) : [];
  }
  const named = courtsIn([...(c.roles ?? []), ...c.options, ...c.baseRules.map((x) => x.raw)]);
  if (named.length) return named;
  return [...new Set((c.spells ?? []).map(courtOfSpell).filter((x): x is Court => !!x))];
}

export function warlordCourts(s: GameState, p: PlayerId): Court[] {
  const w = warlord(s, p);
  return w ? characterCourts(s, w) : [];
}

/**
 * A Regiment's Courts (sk p.4): its own [Court of …] role; the Warlord's for Gifted Mortals and
 * Ghols (RULE-AMBIGUITY: AMB-66 — with two Warlord Courts, Ghols take the first); [Mortals] take
 * their Warband Character's Court.
 */
export function regimentCourts(s: GameState, r: RegimentState): Court[] {
  // The export shows a Regiment's chosen Court as a role or as a "Courts" option (Ghols).
  const own = courtsIn([...r.roles, ...(r.options ?? [])]);
  if (own.length) return own;
  const u = skUnit(r);
  if (u?.court === 'warlord') {
    const w = warlordCourts(s, r.owner);
    return r.name === 'Ghols' ? w.slice(0, 1) : w;
  }
  if (u?.court) return [u.court];
  if (isMortal(r)) {
    const c = Object.values(s.characters).find((x) => x.id.startsWith(r.owner) && x.warband === r.warband && !x.embodied);
    return c ? characterCourts(s, c) : [];
  }
  return [];
}

export function ofCourt(s: GameState, r: RegimentState, court: Court): boolean {
  return regimentCourts(s, r).includes(court);
}

/** The Elemental kind of a Regiment: its entry, or a Ritual that gave it (Fiery Dominion, Sayf). */
export function elementalKind(r: RegimentState, kind: Court): boolean {
  return skUnit(r)?.elemental === kind || hasRule(r.rules, `${kind} Elemental`);
}

// ---------------------------------------------------------------- Rituals (sk p.5)

function casterCharacters(s: GameState, p: PlayerId): CharacterState[] {
  return Object.values(s.characters).filter((c) => c.id.startsWith(p) && !c.destroyed && (hasRule(c.rules, 'Wizard') || hasRule(c.rules, 'Priest')));
}

/** Courts whose Rituals the player can Prepare: those of its non-destroyed spellcasting Characters. */
export function ritualCourts(s: GameState, p: PlayerId): Court[] {
  return [...new Set(casterCharacters(s, p).flatMap((c) => characterCourts(s, c)))];
}

export function availableRituals(s: GameState, p: PlayerId): string[] {
  const cs = ritualCourts(s, p);
  return Object.keys(RITUALS).filter((n) => cs.includes(RITUALS[n]!.court));
}

/** A sensible default Ritual for the computer, or when none was chosen. */
export function defaultRitual(s: GameState, p: PlayerId, courts?: Court[]): string | null {
  const pref: Record<Court, string[]> = {
    Fire: ['Fiery Dominion', 'Intrusive Thoughts', 'Conflagration'],
    Water: ['Call forth the Deep', 'Soothing Tides', 'Violent Geyser'],
    Air: ['Spiteful Winds', 'Sayf', 'Far Sight'],
    Earth: ['Kiss of the Earth', 'Earthquake', 'Gifts of the Earth'],
  };
  const avail = availableRituals(s, p);
  const order = [...(courts ?? []), ...warlordCourts(s, p), ...COURTS];
  for (const c of order) for (const n of pref[c]) if (avail.includes(n) && (!courts || courts.includes(c))) return n;
  return null;
}

export function initSorcererKings(s: GameState): void {
  for (const p of ['P1', 'P2'] as const) {
    if (!isSorcererKings(s, p)) continue;
    s.players[p].sk = { preparing: null, choice: null, completed: [], dischargeRound: 0, chain: null, follow: null, lastRitual: null, spellCount: {}, charSpells: {} };
    for (const c of Object.values(s.characters)) {
      if (!c.id.startsWith(p)) continue;
      // A Character knows every Spell of its Court (sk p.8–13).
      if (!c.spells?.length && (hasRule(c.baseRules, 'Wizard') || hasRule(c.baseRules, 'Priest'))) {
        const cs = characterCourts(s, c);
        if (cs.length) c.spells = cs.flatMap((x) => COURT_SPELLS[x]);
      }
      // Prijm Khanjar and Bound to the Elements change the profile; the export already shows the
      // changed Attacks, Wounds and rules (RULE-AMBIGUITY: AMB-76), so nothing is added here.
      const des = c.baseDrawEvents ?? c.drawEvents;
      if (hasOpt(c, 'Dancing Scimitar') && !des.includes('Dancing Scimitar')) c.baseDrawEvents = [...des, 'Dancing Scimitar'];
    }
    for (const r of Object.values(s.regiments)) {
      if (r.owner !== p) continue;
      const u = skUnit(r);
      if (u?.spells && !r.spells?.length) r.spells = [...u.spells];
      for (const d of u?.drawEvents ?? []) if (!r.baseDrawEvents.includes(d)) r.baseDrawEvents = [...r.baseDrawEvents, d];
    }
  }
}

export function beginRoundSk(s: GameState): void {
  for (const p of ['P1', 'P2'] as const) {
    const st = s.players[p].sk;
    if (!st) continue;
    st.choice = null;
    st.chain = null;
    st.follow = null;
    st.lastRitual = null;
    st.spellCount = {};
    st.charSpells = {};
  }
  // Terrain changed until the end of the Round goes back (Rituals, sk p.23, p.25).
  for (const [id, kws] of Object.entries(s.terrainRestore ?? {})) {
    const piece = terrainOf(s).find((x) => x.id === id);
    if (piece) piece.keywords = kws as typeof piece.keywords;
  }
  s.terrainRestore = {};
}

/** Starts Preparing a Ritual; the first new one each Round gets Elemental Discharge (sk p.5). */
export function startPreparing(ctx: Ctx, p: PlayerId, name: string, why: string): void {
  const st = ctx.s.players[p].sk!;
  st.preparing = { name, markers: 0 };
  ev(ctx, { type: 'ritual', text: `${p} starts Preparing ${name} (${why}; threshold ${RITUALS[name]!.threshold}, sk p.5).`, player: p });
  if (st.dischargeRound !== ctx.s.round) {
    st.dischargeRound = ctx.s.round;
    const n = Math.min(5, ctx.s.round);
    addMarkers(ctx, p, n, 'any', `Elemental Discharge (Round ${ctx.s.round}, sk p.5)`);
  }
}

/** Adds Ritual Markers to the Ritual Being Prepared, if it is of that Court; completes it at its Threshold. */
export function addMarkers(ctx: Ctx, p: PlayerId, n: number, court: Court | 'any', why: string): void {
  const st = ctx.s.players[p].sk;
  if (!st?.preparing || n <= 0) return;
  const def = RITUALS[st.preparing.name]!;
  if (court !== 'any' && def.court !== court) {
    ev(ctx, { type: 'note', text: `${why}: no Ritual of the Court of ${court} is Being Prepared, so no Ritual Marker is added (sk p.5).`, player: p });
    return;
  }
  st.preparing.markers += n;
  ev(ctx, { type: 'ritual', text: `${why}: +${n} Ritual Marker${n > 1 ? 's' : ''} on ${st.preparing.name} (${st.preparing.markers}/${def.threshold}).`, player: p });
  if (st.preparing.markers >= def.threshold) completeRitual(ctx, p);
}

function completeRitual(ctx: Ctx, p: PlayerId): void {
  const s = ctx.s;
  const st = s.players[p].sk!;
  const name = st.preparing!.name;
  const court = RITUALS[name]!.court;
  st.completed.push(name);
  st.preparing = null;
  ev(ctx, { type: 'ritual', text: `${p} completes the Ritual ${name}: its Command Card joins the next Command Stack (sk p.5).`, player: p });
  // Water Rituals (sk p.23) and Elemental Confluence (Maharajah Warlord, sk p.6) start another one.
  let chain: Court[] | null = null;
  if (court === 'Water') chain = ['Water'];
  if (warlordHas(s, p, 'Elemental Confluence')) chain = [...new Set([...(chain ?? []), ...ritualCourts(s, p).filter((c) => c !== court)])];
  if (!chain) return;
  const next = availableRituals(s, p).filter((n) => n !== name && chain!.includes(RITUALS[n]!.court) && !st.completed.includes(n));
  if (!next.length) return;
  st.chain = chain;
  const pick = defaultRitual(s, p, chain);
  const choice = pick && next.includes(pick) ? pick : next[0]!;
  startPreparing(ctx, p, choice, `${court === 'Water' ? 'after a Water Ritual' : 'Elemental Confluence'}; it may be changed while it has no Markers`);
}

/** Removes Ritual Markers (Elemental Assault, Elemental Prowess). */
export function removeMarkers(ctx: Ctx, p: PlayerId, n: number, why: string): boolean {
  const st = ctx.s.players[p].sk;
  if (!st?.preparing || st.preparing.markers < n) return false;
  st.preparing.markers -= n;
  ev(ctx, { type: 'ritual', text: `${why}: −${n} Ritual Markers from ${st.preparing.name} (${st.preparing.markers} left).`, player: p });
  return true;
}

export function prepareProblems(s: GameState, p: PlayerId, name: string): string[] {
  const st = sk(s, p);
  if (!st) return ['Only Sorcerer Kings armies have Rituals.'];
  if (!RITUALS[name]) return ['Unknown Ritual.'];
  if (!availableRituals(s, p).includes(name)) return [`No friendly spellcaster gives access to ${name} (sk p.5).`];
  if (s.step === 'supremacy') return [];
  if (st.chain && st.preparing?.markers === 0 && st.chain.includes(RITUALS[name]!.court)) return [];
  return ['A Ritual is chosen at the end of the Supremacy Phase (sk p.5).'];
}

/** End of the Supremacy Phase (sk p.5, p.17): Rituals start Being Prepared; Vizier of the Morning Star. */
export function endOfSupremacy(ctx: Ctx): void {
  const s = ctx.s;
  for (const p of ['P1', 'P2'] as const) {
    const st = s.players[p].sk;
    if (!st) continue;
    const pick = st.choice ?? (st.preparing ? null : defaultRitual(s, p));
    st.choice = null;
    if (pick && pick !== st.preparing?.name) startPreparing(ctx, p, pick, st.preparing ? `replacing ${st.preparing.name}` : 'end of the Supremacy Phase');
    else if (st.preparing) ev(ctx, { type: 'ritual', text: `${p} keeps Preparing ${st.preparing.name} (${st.preparing.markers}/${RITUALS[st.preparing.name]!.threshold}).`, player: p });
    // Vizier of the Morning Star (sk p.17): Regiments of the Warlord's Court lose Broken.
    const w = warlord(s, p);
    if (w && !w.destroyed && hasOpt(w, 'Vizier of the Morning Star')) {
      const cs = characterCourts(s, w);
      for (const r of Object.values(s.regiments))
        if (r.owner === p && r.broken && regimentCourts(s, r).some((c) => cs.includes(c))) {
          r.broken = false;
          r.standsWhenBroken = null;
          ev(ctx, { type: 'note', text: `Vizier of the Morning Star: ${r.name} is no longer Broken (sk p.17).`, regimentId: r.id });
        }
    }
  }
}

/** A Ritual whose spellcasters are all destroyed stops Being Prepared (sk p.5). */
export function checkRitualAccess(ctx: Ctx): void {
  for (const p of ['P1', 'P2'] as const) {
    const st = ctx.s.players[p].sk;
    if (!st?.preparing) continue;
    if (!ritualCourts(ctx.s, p).includes(RITUALS[st.preparing.name]!.court)) {
      ev(ctx, { type: 'ritual', text: `${st.preparing.name} stops Being Prepared: no friendly spellcaster of its Court is left (sk p.5).`, player: p });
      st.preparing = null;
    }
  }
}

// ---------------------------------------------------------------- terrain helpers

export function waterPieces(s: GameState): Poly[] {
  return terrainOf(s).filter((p) => p.keywords.includes('Water')).map(piecePoly);
}
export function earthPieces(s: GameState): Poly[] {
  return terrainOf(s).filter((p) => p.keywords.includes('Earth')).map(piecePoly);
}

/** At least half its Stands within Water terrain (core p.87). */
export function inWater(s: GameState, r: RegimentState): boolean {
  const w = waterPieces(s);
  const polys = regimentPolys(s, r);
  if (!w.length || !polys.length) return false;
  return polys.filter((q) => w.some((x) => overlaps(q, x))).length >= Math.ceil(polys.length / 2);
}

export function within(s: GameState, r: RegimentState, pieces: Poly[], d: number): boolean {
  return pieces.length > 0 && distancePolys(regimentPolys(s, r), pieces) <= d + TOL;
}

/** A Mahut ridden by a Character with Favored of Hormus (sk p.17). */
export function hormusMahut(s: GameState, r: RegimentState): boolean {
  return r.name === 'Mahut' && Object.values(s.characters).some((c) => c.attachedTo === r.id && !c.destroyed && c.options.some((o) => /^favou?red of hormus$/i.test(o.trim())));
}

/**
 * Within range of Earth terrain (sk p.40–42): within 3″ of an Earth piece, or within 3″ of a
 * friendly Favored of Hormus Mahut, whose neighbours count as within range of Earth terrain (sk p.17).
 */
export function nearEarth(s: GameState, r: RegimentState): boolean {
  if (r.location !== 'table') return false;
  if (within(s, r, earthPieces(s), 3)) return true;
  return Object.values(s.regiments).some((m) => m.owner === r.owner && m.location === 'table' && hormusMahut(s, m) && (m.id === r.id || distancePolys(regimentPolys(s, m), regimentPolys(s, r)) <= 3 + TOL));
}

/** Changes a piece's keywords until the end of the Round (or for good), remembering the originals. */
export function setTerrainKeywords(s: GameState, pieceId: string, kws: string[], permanent = false): void {
  const piece = terrainOf(s).find((x) => x.id === pieceId);
  if (!piece) return;
  s.terrainRestore ??= {};
  if (permanent) {
    if (s.terrainRestore[pieceId]) s.terrainRestore[pieceId] = [...new Set([...s.terrainRestore[pieceId]!, ...kws.filter((k) => !piece.keywords.includes(k as never))])];
  } else if (!s.terrainRestore[pieceId]) s.terrainRestore[pieceId] = [...piece.keywords];
  piece.keywords = [...new Set(kws)] as typeof piece.keywords;
}

// ---------------------------------------------------------------- effective rules (from refreshRules)

export interface SkGrants {
  roles: string[];
  rules: RuleRef[];
  drawEvents: string[];
  mods: StatMod[];
  /** Rules the Regiment loses (Favored of Hormus: the Mahut's Barrage, sk p.17). */
  remove?: string[];
}

const belowStart = (r: RegimentState) => r.stands.length < r.startingStands || r.stands.some((x) => x.wounds > 0);

/** Rules, Draw Events, roles and modifiers granted by Sorcerer Kings rules, recomputed after every Action. */
export function skRegimentGrants(s: GameState, r: RegimentState): SkGrants {
  const out: SkGrants = { roles: [], rules: [], drawEvents: [], mods: [] };
  if (!s.players[r.owner].sk) return out;
  const u = skUnit(r);
  const courts = regimentCourts(s, r);
  out.roles.push(...courts.filter((c) => !courtsIn(r.roles).includes(c)).map((c) => `Court of ${c}`));
  const onTable = r.location === 'table';
  const add = (raw: string) => out.rules.push(ref(raw));
  // Paragraph rules from the entry, shown as rules (implemented by the engine).
  if (u?.elemental) add(`${u.elemental} Elemental`);
  if (u?.infernalBranding) add('Infernal Branding');
  if (u?.giftedMortals) add('Gifted Mortals');
  if (u?.eminence) add('Eminence');
  if (u?.lastWord) add('Last Word');
  if (u?.chargeVs === 'character') add('Arrogance');
  if (u?.chargeVs === 'monster') add('Hubris');
  if (u?.earthenAegis) add('Earthen Aegis');
  if (u?.tether) add('Elemental Tether');
  if (u?.aqueousBranding) add('Aqueous Branding');
  const fire = elementalKind(r, 'Fire');
  // Fire Elemental (sk p.32–35): Juggernaut while Inflamed.
  if (fire && r.flags.inflamed) add('Juggernaut');
  // Infernal Branding (sk p.32): Rapid Volley while Inflamed (against an Inflamed target: effects.ts).
  if (u?.infernalBranding && r.flags.inflamed) add('Rapid Volley');
  // Water Elemental (sk p.43–46): no Water penalty; re-rolls failed Hit Rolls of 6 while in Water.
  const tidecallerAura = onTable && elementalKind(r, 'Water') && Object.values(s.regiments).some((a) => a.owner === r.owner && a.location === 'table' && a.flags.tidecaller === 'aura' && distancePolys(regimentPolys(s, a), regimentPolys(s, r)) <= 8 + TOL);
  if (onTable && elementalKind(r, 'Water') && (inWater(s, r) || tidecallerAura)) add('Elemental Waters');
  // Earth Elemental (sk p.40–42): Untouchable within 3″ of Earth terrain (Earth Markers: AMB-67).
  const earthy = nearEarth(s, r);
  if (onTable && elementalKind(r, 'Earth') && earthy) add('Untouchable');
  // Earthen Aegis (sk p.40–41): Regeneration (+4) within 3″ of Earth terrain.
  if (onTable && u?.earthenAegis && earthy) out.drawEvents.push('Regeneration (+4)');
  // Favored of Hormus (sk p.17): the ridden Mahut loses Barrage and gains Terrifying (1).
  if (hormusMahut(s, r)) {
    add('Terrifying (1)');
    out.remove = ['Barrage'];
  }
  // Shattered Perfection / Raging Elements (sk p.40–41): from the first time below its starting strength.
  if (r.flags.shattered && u?.shattered === 'perfection') ['Smite', 'Fury', 'Oblivious'].forEach(add);
  if (r.flags.shattered && u?.shattered === 'raging') add('Flurry');
  // Air Elemental's Evasion bonus is a roundMod (see skAfterApply).
  // Gifted Mortals Initiates (sk p.27): a rule by the Warlord's Court.
  if (r.name === 'Mahabharati Initiates')
    for (const c of courts) {
      if (c === 'Fire') add('Juggernaut');
      if (c === 'Air') add('Opportunists');
      if (c === 'Earth') out.drawEvents.push('Regeneration (2)');
    }
  // Elemental Conduit (sk p.5): every [Elemental] Regiment with it in its entry; kept as listed.
  // Raj Warlord, Elemental Dominion (sk p.6).
  if (warlordHas(s, r.owner, 'Elemental Dominion') && isElemental(r)) {
    const wc = warlordCourts(s, r.owner);
    for (const c of wc.filter((x) => courts.includes(x))) {
      if (c === 'Fire') out.drawEvents.push('Fan the Flames');
      if (c === 'Air') add('Opportunists');
      if (c === 'Earth') out.drawEvents.push('Regeneration (2)');
    }
  }
  // Recorder of all Deeds (Warlord, sk p.17): [Mortal] Regiments gain Vanguard (3) and Bravery.
  const w = warlord(s, r.owner);
  if (w && hasOpt(w, 'Recorder of all Deeds') && isMortal(r)) ['Vanguard (3)', 'Bravery'].forEach(add);
  // Character upgrades acting on Regiments.
  for (const c of Object.values(s.characters)) {
    if (!c.id.startsWith(r.owner) || c.destroyed || !c.attachedTo) continue;
    const host = s.regiments[c.attachedTo];
    if (!host || host.location !== 'table') continue;
    const near = (d: number) => onTable && distancePolys(regimentPolys(s, host), regimentPolys(s, r)) <= d + TOL;
    // Banner of Elemental Dominion (sk p.16): [Elemental] Regiments within 12″ gain Unstoppable.
    if (hasOpt(c, 'Banner of Elemental Dominion') && isElemental(r) && near(12)) add('Unstoppable');
    if (host.id === r.id) {
      // Best Money can Buy (sk p.17): an Infantry Regiment gains Hardened (+1).
      if (hasOpt(c, 'Best Money can Buy') && r.type === 'Infantry') add('Hardened (+1)');
      // Sorcerous Blessing (Sardar, sk p.14): after removing Ritual Markers this Round.
      if (isSardar(c) && r.flags.blessing) ['Cleave (+1)', 'Fearless'].forEach(add);
    }
  }
  // Dread Tide (Shaytan, sk p.46): Water Elementals within 8″ gain Terrifying (+1).
  if (onTable && elementalKind(r, 'Water') && Object.values(s.regiments).some((a) => a.owner === r.owner && a.id !== r.id && a.location === 'table' && skUnit(a)?.terrorAura && distancePolys(regimentPolys(s, a), regimentPolys(s, r)) <= 8 + TOL)) add('Terrifying (+1)');
  // Dread Tide / Tidecaller (sk p.45–46): enemies engaged with it count as in Water in their Clash.
  if (onTable) {
    const drowned = enemiesTouching(s, r).some((e) => skUnit(e)?.dreadTide || e.flags.tidecaller === 'engaged');
    if (drowned && !elementalKind(r, 'Water') && (r.profile.C ?? 0) > 1) out.mods.push({ stat: 'C', delta: -1, source: 'Water (Dread Tide)' });
  }
  return out;
}

/** Below its starting strength for the first time (Shattered Perfection, Raging Elements, sk p.40–41). */
export function checkShattered(ctx: Ctx): void {
  for (const r of Object.values(ctx.s.regiments)) {
    const u = skUnit(r);
    if (!u?.shattered || r.flags.shattered || r.location !== 'table' || !ctx.s.players[r.owner].sk || !belowStart(r)) continue;
    r.flags.shattered = true;
    ev(ctx, {
      type: 'note',
      text: u.shattered === 'perfection' ? `Shattered Perfection: ${r.name} gains Smite, Fury, Oblivious and +2″ Charge Distance (sk p.40).` : `Raging Elements: ${r.name} gains Flurry and may make an additional Clash Action in its Activations (sk p.41).`,
      regimentId: r.id,
    });
  }
}

export function attachedSardarOrNull(s: GameState, r: RegimentState): CharacterState | undefined {
  const c = attachedCharacter(s, r.id);
  return c && isSardar(c) ? c : undefined;
}

/**
 * Command Stack order for Ritual cards (sk p.22): each Ritual just before a Regiment card of its
 * Court, so that Regiment can Activate straight after it.
 */
export function placeRituals(s: GameState, order: CommandCard[]): CommandCard[] {
  const rituals = order.filter((c) => c.kind === 'ritual');
  if (!rituals.length) return order;
  const rest = order.filter((c) => c.kind !== 'ritual');
  const out: CommandCard[] = [];
  const used = new Set<string>();
  for (const rc of rituals) {
    const court = RITUALS[rc.refId]?.court;
    const follower = rest.find((c) => !used.has(c.id) && c.kind === 'regiment' && !!court && regimentCourts(s, s.regiments[c.refId]!).includes(court));
    out.push(rc);
    if (follower) {
      out.push(follower);
      used.add(follower.id);
    }
  }
  return [...out, ...rest.filter((c) => !used.has(c.id))];
}
