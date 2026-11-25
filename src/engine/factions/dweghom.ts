import { parseRuleRef } from '../../import/ruleTokens';
import type { RuleRef } from '../../import/types';
import { ev, type Ctx } from '../dice';
import { TOL } from '../geometry/vec';
import type { CharacterState, DwPlayerState, GameState, PlayerId, RegimentState, StatMod } from '../model/types';
import { attachedCharacter, distancePolys, isEngaged, regimentPolys } from '../queries';
import { hasRule } from '../rules/special/rules';

/**
 * Dweghom faction rules (Dweghom army list, November 10th 2026; cited as `dw p.N`, the PDF page).
 * Mechanics only, in our own words:
 *
 * - The Gift (dw p.4): Regiments become "Awakened" until the end of the Round. While Awakened a
 *   Regiment cannot become Broken; a Broken one Rallies at once when it Awakens.
 * - Forged (dw p.4): an Elemental Power pool of at most 10 Markers. A [Forged] Regiment's Draw
 *   Event spends Markers on its Empowerment and Awakens it; one that does not use it adds a Marker
 *   at the end of its Activation.
 * - The Unbound (dw p.5): Dweghom Regiments cannot be Shattered.
 * - Creeds (dw p.6–8): Ardent, Tempered or Clan, chosen at list building; the Lost Ancestor makes
 *   both Ardent and Tempered active.
 */

export type Creed = 'Ardent' | 'Tempered' | 'Clan';

export const DW_DRAW_EVENTS = ['Forged By the Elements', 'Preternatural Focus', 'Unassailable Authority', 'Gifted in Fire', 'Runeforged Plate', 'Fires of the Descent'];
const ref = (raw: string): RuleRef => parseRuleRef(raw);
const lc = (x: string) => x.toLowerCase().replace(/[’]/g, "'");

export function isDweghom(s: GameState, p: PlayerId): boolean {
  return /dweghom/i.test(s.players[p].faction);
}
export function dw(s: GameState, p: PlayerId): DwPlayerState | undefined {
  return s.players[p].dw;
}

const roleNames = (roles: readonly string[]) => roles.map((x) => x.replace(/[[\]]/g, '').trim().toLowerCase());
/** Roles, tolerating the list's "[Temepered]" spelling. */
export function hasDwRole(roles: readonly string[], role: 'Ardent' | 'Tempered' | 'Clan' | 'Forged'): boolean {
  const want = role.toLowerCase();
  return roleNames(roles).some((x) => x === want || (want === 'tempered' && x === 'temepered'));
}
export function regRoles(r: RegimentState): string[] {
  return [...r.roles, ...(r.roundRoles ?? []), ...(r.grantRoles ?? [])];
}
export const isForged = (r: RegimentState) => hasDwRole(regRoles(r), 'Forged');

export function warlord(s: GameState, p: PlayerId): CharacterState | undefined {
  return Object.values(s.characters).find((c) => c.isWarlord && c.id.startsWith(p));
}
export function warlordHas(s: GameState, p: PlayerId, ability: string): boolean {
  return (warlord(s, p)?.supremacyAbilities ?? []).some((a) => lc(a) === lc(ability));
}
export const hasOpt = (c: CharacterState | undefined, n: string) => !!c && c.options.some((o) => lc(o) === lc(n));
const regOpt = (r: RegimentState, n: string) => (r.options ?? []).some((o) => lc(o) === lc(n)) || r.commandModels.some((o) => lc(o) === lc(n));

/**
 * Active Creeds (dw p.5–8): from the list's sub-faction line, else from the Warlord. The Lost
 * Ancestor (Living Legend) makes Ardent and Tempered active. RULE-AMBIGUITY: AMB-78 — an Exemplar
 * Warlord with no Creed in the list is taken as Ardent.
 */
export function creeds(s: GameState, p: PlayerId): Creed[] {
  if (warlordHas(s, p, 'Living Legend')) return ['Ardent', 'Tempered'];
  const sect = (s.players[p].sect ?? '').toLowerCase();
  const named = (['Ardent', 'Tempered', 'Clan'] as const).filter((c) => sect.includes(c.toLowerCase()));
  if (named.length) return [...named];
  const w = warlord(s, p);
  if (!w) return [];
  if (/kerawegh|exemplar/i.test(w.name)) return ['Ardent'];
  if (/raegh/i.test(w.name)) return ['Clan'];
  if (/sorcerer|steelshaper/i.test(w.name)) return ['Tempered'];
  return [];
}
export const creedActive = (s: GameState, p: PlayerId, c: Creed) => creeds(s, p).includes(c);

// ---------------------------------------------------------------- Awakened (dw p.4)

/** Always counts as Awakened: Litanies of Victory on its Character (dw p.22). */
export function alwaysAwakened(s: GameState, r: RegimentState): boolean {
  return hasOpt(attachedCharacter(s, r.id), 'Litanies of Victory');
}
export function isAwakened(s: GameState, r: RegimentState): boolean {
  return !!r.flags.awakened || alwaysAwakened(s, r);
}

/**
 * Awakens a friendly Dweghom Regiment (dw p.4) and follows the chains: Herald of War (dw p.6),
 * Testaments to Honor (dw p.38) and Thesis/Antithesis/Synthesis (dw p.7).
 */
export function awaken(ctx: Ctx, r: RegimentState, why: string, rally: (ctx: Ctx, r: RegimentState, why: string) => void, heal: (ctx: Ctx, r: RegimentState, n: number, why: string) => void): void {
  const s = ctx.s;
  if (!s.players[r.owner].dw || r.location !== 'table' || isAwakened(s, r)) return;
  r.flags.awakened = true;
  ev(ctx, { type: 'awakened', text: `${r.name} is Awakened until the end of the Round (${why}, dw p.4).`, player: r.owner, regimentId: r.id });
  if (r.broken) rally(ctx, r, 'Awakened');
  const st = s.players[r.owner].dw!;
  // Thesis/Antithesis/Synthesis (Steelshaper Warlord, dw p.7): non-Monster [Forged] Regiments Heal 2 (or 5 for 3 Markers, once).
  if (warlordHas(s, r.owner, 'Thesis/Antithesis/Synthesis') && isForged(r) && r.type !== 'Monster') {
    const wounded = r.stands.length < r.startingStands || r.stands.some((x) => x.wounds > 0);
    // RULE-AMBIGUITY: AMB-79 — the engine spends the 3 Markers once, when the Regiment has lost a Stand and the pool has 3.
    if (!st.steelHealUsed && st.pool >= 3 && r.stands.length < r.startingStands) {
      st.steelHealUsed = true;
      spendPower(ctx, r.owner, 3, 'Thesis/Antithesis/Synthesis');
      heal(ctx, r, 5, 'Thesis/Antithesis/Synthesis (3 Markers)');
    } else if (wounded) heal(ctx, r, 2, 'Thesis/Antithesis/Synthesis');
  }
  const near = (d: number, pick: (x: RegimentState) => boolean) =>
    Object.values(s.regiments).filter((x) => x.id !== r.id && x.owner === r.owner && x.location === 'table' && pick(x) && distancePolys(regimentPolys(s, r), regimentPolys(s, x)) <= d + TOL);
  // Herald of War (Ardent Kerawegh Warlord, dw p.6): its Regiment Awakening Awakens [Ardent] within 8″.
  const w = warlord(s, r.owner);
  if (w && !w.destroyed && w.attachedTo === r.id && warlordHas(s, r.owner, 'Herald of War')) for (const x of near(8, (x) => hasDwRole(regRoles(x), 'Ardent'))) awaken(ctx, x, 'Herald of War', rally, heal);
  // Testaments to Honor (Ironclad Drake, dw p.38): non-Monster [Clan] Regiments within 6″.
  if (r.name === 'Ironclad Drake') for (const x of near(6, (x) => x.type !== 'Monster' && hasDwRole(regRoles(x), 'Clan'))) awaken(ctx, x, 'Testaments to Honor', rally, heal);
}

// ---------------------------------------------------------------- Elemental Power (dw p.4)

export function addPower(ctx: Ctx, p: PlayerId, n: number, why: string): void {
  const st = ctx.s.players[p].dw;
  if (!st || n <= 0) return;
  const before = st.pool;
  st.pool = Math.min(10, st.pool + n);
  ev(ctx, { type: 'power', text: `${why}: +${st.pool - before} Elemental Power Marker${st.pool - before === 1 ? '' : 's'} (${st.pool}/10${st.pool === 10 && before + n > 10 ? ', the pool is full' : ''}, dw p.4).`, player: p });
}

export function spendPower(ctx: Ctx, p: PlayerId, n: number, why: string): boolean {
  const st = ctx.s.players[p].dw;
  if (!st || st.pool < n) return false;
  st.pool -= n;
  ev(ctx, { type: 'power', text: `${why}: spends ${n} Elemental Power Marker${n === 1 ? '' : 's'} (${st.pool} left).`, player: p });
  return true;
}

/** A Forged Regiment's Empowerment choices (dw p.30–43): id, label, Markers. */
export interface Empowerment {
  id: string;
  label: string;
  cost: number;
}

export function empowerments(s: GameState, r: RegimentState): Empowerment[] {
  const both = (a: string, b: string): Empowerment[] => [
    { id: 'a', label: a, cost: 1 },
    { id: 'b', label: b, cost: 1 },
    { id: 'both', label: `${a} and ${b}`, cost: 3 },
  ];
  switch (r.name) {
    case 'Fireforged':
      return [{ id: 'a', label: 'Barrage (+2)', cost: 1 }];
    case 'Hellbringer Drake': {
      const out = [{ id: 'a', label: 'Barrage (+2) and Armor Piercing (+1)', cost: 1 }];
      // Hellbringer Sorcerer (dw p.24): 3 Markers for twice the benefit, 5 for three times (Armor Piercing at most 2).
      if (Object.values(s.characters).some((c) => c.id.startsWith(r.owner) && !c.destroyed && hasOpt(c, 'Hellbringer Sorcerer')))
        out.push({ id: 'x2', label: 'Barrage (+4) and Armor Piercing (+2)', cost: 3 }, { id: 'x3', label: 'Barrage (+6) and Armor Piercing (+2)', cost: 5 });
      return out;
    }
    case 'Inferno Automata':
      return [
        { id: 'a', label: '+1 March', cost: 1 },
        { id: 'b', label: 'Impact (+2)', cost: 1 },
      ];
    case 'Found':
      return [{ id: 'a', label: 'Barrage (+1) and +4″ Barrage range', cost: 1 }];
    case 'Magmaforged':
      return both('+2″ Charge Distance', '+1 Defense');
    case 'Steelforged':
      return both('+2 Attacks', 'Hardened (1)');
    case 'Stoneforged':
      return [
        { id: 'a', label: 'Heal 3 Wounds', cost: 1 },
        { id: 'b', label: '+2 March', cost: 1 },
      ];
  }
  return [];
}

export function initDweghom(s: GameState): void {
  for (const p of ['P1', 'P2'] as const) {
    if (!isDweghom(s, p)) continue;
    s.players[p].dw = { pool: 0, steelHealUsed: false, raeghChoice: [], forgemasterRound: {}, steelshaperRound: 0, castThisRound: {} };
    for (const r of Object.values(s.regiments)) {
      if (r.owner !== p) continue;
      // Every [Forged] Regiment has the Forged By the Elements Draw Event (dw p.4).
      if (isForged(r) && empowerments(s, r).length && !r.baseDrawEvents.includes('Forged By the Elements')) r.baseDrawEvents = [...r.baseDrawEvents, 'Forged By the Elements'];
      if (r.name === 'Lost' && !r.baseDrawEvents.includes('Fires of the Descent')) r.baseDrawEvents = [...r.baseDrawEvents, 'Fires of the Descent'];
    }
    for (const c of Object.values(s.characters)) {
      if (!c.id.startsWith(p)) continue;
      const des = c.baseDrawEvents ?? c.drawEvents;
      const add = (d: string) => {
        if (!(c.baseDrawEvents ?? c.drawEvents).includes(d)) c.baseDrawEvents = [...(c.baseDrawEvents ?? des), d];
      };
      if (/raegh/i.test(c.name)) add('Preternatural Focus');
      if (c.name === 'Lost Ancestor') add('Unassailable Authority');
      if (hasOpt(c, 'Gifted in Fire')) add('Gifted in Fire');
      if (hasOpt(c, 'Runeforged Plate')) add('Runeforged Plate');
      // The export lists a Character's own Spells; the chosen School's Spells are added (dw p.16, p.21).
      const known = defaultSpells(c);
      if (known) c.spells = [...new Set([...(c.spells ?? []), ...known])];
    }
  }
}

/** Spells a Character knows (dw p.11–28): its fixed Spells plus its Elemental School's. */
export const SCHOOLS: Record<string, string[]> = {
  Fire: ['Coruscation', 'Fireball', 'Flame Wall'],
  Magma: ['Magmatic Seep', 'Pyroclast', 'Eruption'],
  Earth: ['Broken Ground', 'Roots of Stone', 'Rock Shaping'],
  Steel: ['Hone Blades', 'Temper Plate', 'Unmake Armor'],
};

/**
 * The School a Tempered Sorcerer or Lost Ancestor chose: a "School of …" or school-name option or
 * role. RULE-AMBIGUITY: AMB-80 — the export format is not known; without one, Fire.
 */
export function characterSchool(c: CharacterState): string | null {
  const text = [...c.options, ...(c.roles ?? [])].join(' | ');
  return (['Fire', 'Magma', 'Earth'] as const).find((x) => new RegExp(`\\b${x}\\b`, 'i').test(text)) ?? null;
}

function defaultSpells(c: CharacterState): string[] | undefined {
  if (/kerawegh/i.test(c.name)) return ['Fear', 'Rancor', 'Dismay', 'Resolve'];
  if (/steelshaper/i.test(c.name)) return [...SCHOOLS.Steel!];
  if (/tempered sorcerer/i.test(c.name)) return [...SCHOOLS[characterSchool(c) ?? 'Fire']!];
  if (c.name === 'Lost Ancestor') return ['Litanies of Battle', 'Songs of the Descent', ...SCHOOLS[characterSchool(c) ?? 'Fire']!];
  return undefined;
}

export function beginRoundDw(s: GameState): void {
  for (const p of ['P1', 'P2'] as const) {
    const st = s.players[p].dw;
    if (!st) continue;
    st.raeghChoice = [];
    st.castThisRound = {};
    st.charAttacks = {};
  }
  s.eruptingPieces = [];
}

// ---------------------------------------------------------------- effective rules (from refreshRules)

export interface DwGrants {
  roles: string[];
  rules: RuleRef[];
  drawEvents: string[];
  mods: StatMod[];
}

const hasCommandStand = (r: RegimentState) => r.stands.some((x) => x.isCommand);

export function dwRegimentGrants(s: GameState, r: RegimentState): DwGrants {
  const out: DwGrants = { roles: [], rules: [], drawEvents: [], mods: [] };
  if (!s.players[r.owner].dw) return out;
  const add = (raw: string) => out.rules.push(ref(raw));
  const roles = regRoles(r);
  const awake = isAwakened(s, r);
  // Heralds (dw p.45): the Regiment joins the Creed's Sub-Faction; its benefit lasts while the Command Stand lives.
  const herald = ['Herald of Fire', 'Herald of Magma', 'Herald of Stone', 'Flamecaster'].some((h) => regOpt(r, h));
  if (herald) {
    if (creedActive(s, r.owner, 'Ardent') && !hasDwRole(roles, 'Ardent')) out.roles.push('Ardent');
    if (creedActive(s, r.owner, 'Tempered') && !hasDwRole(roles, 'Tempered')) out.roles.push('Tempered');
  }
  if (hasCommandStand(r)) {
    if (regOpt(r, 'Herald of Fire')) add('Herald of Fire');
    if (regOpt(r, 'Herald of Magma')) add('Linebreaker');
    if (regOpt(r, 'Herald of Stone')) add('Untouchable');
    if (regOpt(r, 'Flamecaster')) add('Flamer');
    if (regOpt(r, "Mnemancer's Apprentice")) add('Unyielding');
  }
  // Ardent Creed (dw p.6): every friendly Regiment gains Pathfinders.
  if (creedActive(s, r.owner, 'Ardent')) add('Pathfinders');
  // Clan Creed (dw p.8): Awakened [Clan] Regiments gain Oblivious and Iron Discipline.
  if (awake && creedActive(s, r.owner, 'Clan') && hasDwRole([...roles, ...out.roles], 'Clan')) ['Oblivious', 'Iron Discipline'].forEach(add);
  // Awakened effects of the entries (dw p.31–44).
  if (awake) {
    if (r.name === 'Hold Warriors') add('Impact (2)');
    if (r.name === 'Initiates') add('Support (+1)');
    if (r.name === 'Flame Berserkers') add('Lethal Demise (+2)');
    if (r.name === 'Wardens') add('Linebreaker');
  }
  if (r.name === 'Stoneforged') add('Unstable Alloys');
  if (r.name === 'Dragonslayers') add('Venerable');
  if (r.name === 'Flame Berserkers') add('Life for Glory');
  if (r.name === 'Initiates') add('Shieldwall');
  if (r.name === 'Found') add('Battery');
  const onTable = r.location === 'table';
  if (onTable) {
    const others = Object.values(s.regiments).filter((x) => x.owner === r.owner && x.id !== r.id && x.location === 'table');
    const within = (x: RegimentState, d: number) => distancePolys(regimentPolys(s, x), regimentPolys(s, r)) <= d + TOL;
    // Stride (Lost, dw p.39): while Awakened, friendly Infantry within 8″ +1 March.
    if (r.type === 'Infantry' && others.some((x) => x.name === 'Lost' && isAwakened(s, x) && within(x, 8))) out.mods.push({ stat: 'M', delta: 1, source: 'Stride' });
    // Ferric Throne (dw p.25): [Forged] Regiments within 8″ of the Steelshaper's Stoneforged gain Unstable Alloys.
    const throne = Object.values(s.characters).some((c) => c.id.startsWith(r.owner) && !c.destroyed && hasOpt(c, 'Ferric Throne'));
    if (throne && isForged(r) && [r, ...others].some((x) => x.name === 'Stoneforged' && (x.id === r.id || within(x, 8)))) add('Unstable Alloys');
  }
  const c = attachedCharacter(s, r.id);
  // The Crown of Ushkelodh (dw p.23): its Infantry Regiment +1 March and Impact (+2), to at most Impact (5).
  if (c && hasOpt(c, 'The Crown of Ushkelodh') && r.type === 'Infantry') {
    out.mods.push({ stat: 'M', delta: 1, source: 'The Crown of Ushkelodh' });
    const base = r.rules.filter((x) => x.name === 'Impact').reduce((a, x) => (x.plus ? a + (x.x ?? 0) : Math.max(a, x.x ?? 0)), 0);
    const plus = Math.max(0, Math.min(2, 5 - base));
    if (plus) add(`Impact (+${plus})`);
  }
  // World Breakers (dw p.24): its Awakened Infantry Regiment never has Defense, Evasion or Resolve below 3.
  if (c && hasOpt(c, 'World Breakers') && r.type === 'Infantry' && awake) out.rules.push({ name: 'World Breakers', raw: 'World Breakers' });
  // First in the Fray (dw p.24): the foremost friendly Infantry Regiment gains Terrifying (+1), to at most 2.
  if (onTable && r.type === 'Infantry' && creedActive(s, r.owner, 'Ardent') && Object.values(s.characters).some((x) => x.id.startsWith(r.owner) && !x.destroyed && hasOpt(x, 'First in the Fray'))) {
    const fwd = (x: RegimentState) => (x.owner === 'P1' ? x.pose.y : s.scenario.table.height - x.pose.y);
    const top = Object.values(s.regiments).filter((x) => x.owner === r.owner && x.location === 'table' && x.type === 'Infantry').sort((a, b) => fwd(b) - fwd(a))[0];
    const t = r.rules.filter((x) => x.name === 'Terrifying').reduce((a, x) => Math.max(a, x.x ?? 0), 0);
    if (top?.id === r.id && t < 2) add('Terrifying (+1)');
  }
  return out;
}

export function dwCharacterRules(s: GameState, c: CharacterState): RuleRef[] {
  if (!c.id || !s.players[c.id.startsWith('P1') ? 'P1' : 'P2'].dw) return [];
  const out: RuleRef[] = [];
  // Paragon of War, First Born of War (dw p.6, p.8): the Character gains Forward Force.
  if (c.supremacyAbilities.some((a) => /paragon of war|first born of war/i.test(a))) out.push(ref('Forward Force'));
  return out;
}

/** Minimum 3 Defense, Evasion and Resolve (World Breakers, dw p.24), as modifiers. */
export function worldBreakerMods(r: RegimentState, current: (k: 'D' | 'E' | 'R') => number): StatMod[] {
  if (!hasRule(r.rules, 'World Breakers')) return [];
  return (['D', 'E', 'R'] as const).filter((k) => r.profile[k] !== null && current(k) < 3).map((k) => ({ stat: k, delta: 3 - current(k), source: 'World Breakers' }));
}

export function isEngagedNow(s: GameState, r: RegimentState): boolean {
  return r.location === 'table' && isEngaged(s, r);
}
