import { ev, rollTest, type Ctx } from './dice';
import { commandFile, layout } from './formation';
import type { Arc } from './geometry/arcs';
import { polyDistance, rectPoly } from './geometry/polygon';
import { TOL } from './geometry/vec';
import type { CharacterState, PlayerId, Profile, RegimentState } from './model/types';
import { attachedCharacter, formationInput, onTableRegiments, regimentPolys, regimentStandCount } from './queries';
import { hasRole, sectOf } from './rules/special/grants';
import { hasRule, ruleX } from './rules/special/rules';
import { autoPassesResolve, onRegimentDestroyed, onStandLost, rerollsMoraleSuccesses } from './factions/oldDominion';

/** A characteristic including Round modifiers (manual tool, Draw Events), never below 0 (core p.15). */
export function stat(r: RegimentState, k: keyof Profile): number {
  const base = r.profile[k] ?? 0;
  const mod = [...r.roundMods, ...(r.grantMods ?? [])].filter((m) => m.stat === k).reduce((a, m) => a + m.delta, 0);
  return Math.max(0, base + mod);
}

export function charStat(c: CharacterState, k: keyof Profile): number {
  const mod = (c.grantMods ?? []).filter((m) => m.stat === k).reduce((a, m) => a + m.delta, 0);
  return Math.max(0, (c.profile[k] ?? 0) + mod);
}

/** A Character lends its Resolve to its Regiment unless it has none (Animate Vessel, od p.5). */
function lendsResolve(c: CharacterState | undefined): c is CharacterState {
  return !!c && c.profile.R !== null && !hasRule(c.baseRules, 'Animate Vessel');
}

/** Resolve size bonus (core p.59): +1 for 4–6 Stands, +2 for 7–9, +3 for 10+. */
export function sizeBonus(ctx: Ctx, r: RegimentState): number {
  const n = regimentStandCount(ctx.s, r);
  return n >= 10 ? 3 : n >= 7 ? 2 : n >= 4 ? 1 : 0;
}

/**
 * Resolve (core p.59): the highest R in the Regiment (its Character included), plus the size
 * bonus. A Broken Regiment, or one whose Character declined a Duel, uses its lowest R
 * (core p.60, p.76). RULE-AMBIGUITY: AMB-31 — the size bonus still applies while Broken.
 */
export function resolveValue(ctx: Ctx, r: RegimentState): number {
  const c = attachedCharacter(ctx.s, r.id);
  const rs = [stat(r, 'R'), ...(lendsResolve(c) ? [charStat(c, 'R')] : [])];
  const base = r.broken || r.flags.declinedDuel ? Math.min(...rs) : Math.max(...rs);
  return base + sizeBonus(ctx, r);
}

/** Highest Resolve Characteristic of any Stand (Combat Reform, Withdraw; core p.48, p.51). */
export function highestR(ctx: Ctx, r: RegimentState): number {
  const c = attachedCharacter(ctx.s, r.id);
  return Math.max(stat(r, 'R'), lendsResolve(c) ? charStat(c, 'R') : 0);
}

export type AttackKind = 'clash' | 'impact' | 'volley' | 'duel' | 'special';

export interface AttackPool {
  label: string;
  dice: number;
  /** Clash or Volley value used to hit. */
  skill: number;
  /** Hits that need no roll (Trample, Lethal Demise, Aura of Death, Counter-Attack). */
  autoHits?: number;
  rerollFailed?: boolean;
  rerollSixes?: boolean;
  /** Relentless Blows / Rapid Volley: each natural 1 adds a Hit (core p.40, p.46, p.100). */
  extraOnOne?: boolean;
  /** Cleave / Armor Piercing / Brutal Impact: lowers the target's Defense (core p.97). */
  reduceD?: number;
  ignoreShield?: boolean;
  /** Deadly Shot / Deadly Blades: a failed Defense roll of 6 causes 2 Wounds (core p.97). */
  deadly6?: boolean;
  /** Resounding Malevolence: a failed Defense roll of 6 causes one more Wound. */
  extraWoundOnSix?: boolean;
  /** Flawless Strikes / Precise Shot: no Defense (only Evasion) against Hit Rolls of 1 (core p.98, p.100). */
  noDefenseOnOnes?: boolean;
  /** Smite: the target may not use its Defense at all (core p.100). */
  smite?: boolean;
  /** Torrential Fire: every two Hits (rounding up) add an automatic Hit (core p.101). */
  torrential?: boolean;
  /** Convert up to this many failed Hit Rolls into Hits (Glimmers of a Golden Age, od p.10). */
  convertFails?: number;
  /** Defense Rolls use this value instead of Defense (Insanity, od p.23). */
  defenseOverride?: number;
}

export interface AttackSpec {
  attackerOwner: PlayerId;
  attackerId?: string;
  targetId: string;
  /** Arc of the target the attack comes from. */
  arc: Arc;
  pools: AttackPool[];
  /** Whether the Wounds cause Morale Tests (Volleys do not, core p.41). */
  morale: boolean;
  /** Terrifying (X) of the attacker, if any (core p.101). */
  terrifying: number;
  what: string;
  kind?: AttackKind;
  /** Wounds from this attack do not trigger Lethal Demise (core p.99). */
  noLethalDemise?: boolean;
}

export interface AttackResult {
  hits: number;
  wounds: number;
  moraleWounds: number;
  standsLost: number;
  destroyed: boolean;
  /** Natural 1s rolled to hit (for Visceral Bombardment). */
  naturalOnes: number;
}

/** Hit → Defense → Wounds → allocation → Morale → Broken (core p.40, p.46, p.53–61). */
export function resolveAttack(ctx: Ctx, spec: AttackSpec): AttackResult {
  const s = ctx.s;
  const target = s.regiments[spec.targetId]!;
  const attacker = spec.attackerId ? s.regiments[spec.attackerId] : undefined;
  const kind = spec.kind ?? 'special';
  let totalHits = 0;
  let wounds = 0;
  let naturalOnes = 0;
  const melee = kind === 'clash' || kind === 'impact';
  // Shield: +1 Defense against the front arc (core p.100). Phalanx: +1 Defense and Resolve against the front (core p.100).
  const shieldBonus = spec.arc === 'front' && hasRule(target.rules, 'Shield') ? 1 : 0;
  const phalanxBonus = spec.arc === 'front' && hasRule(target.rules, 'Phalanx') ? 1 : 0;
  const bastion = target.roundMods.filter((m) => m.stat === 'D' && m.source === 'Bastion').reduce((a, m) => a + m.delta, 0);
  const hardened = ruleX(target.rules, 'Hardened');
  for (const pool of spec.pools) {
    let hits: number;
    let onesHits = 0;
    if (pool.autoHits) {
      hits = pool.autoHits;
    } else {
      if (pool.dice <= 0) continue;
      const hit = rollTest(ctx, pool.dice, { target: pool.skill, rerollFailed: !!pool.rerollFailed, rerollSixes: !!pool.rerollSixes }, `${spec.what}: ${pool.label} to hit`);
      hits = hit.passes;
      if (pool.convertFails) {
        const conv = Math.min(pool.convertFails, pool.dice - hit.passes);
        if (conv > 0) {
          hits += conv;
          hit.record.notes?.push(`${conv} failed Hit${conv > 1 ? 's' : ''} converted (Glimmers of a Golden Age)`);
        }
      }
      const ones = hit.values.filter((v) => v === 1).length;
      naturalOnes += ones;
      onesHits = pool.noDefenseOnOnes ? ones : 0;
      if (pool.extraOnOne && ones) {
        hits += ones;
        hit.record.notes?.push(`+${ones} Hit${ones > 1 ? 's' : ''} from natural 1s`);
      }
      if (pool.torrential && hit.passes) {
        const extra = Math.ceil(hit.passes / 2);
        hits += extra;
        hit.record.notes?.push(`Torrential Fire +${extra}`);
      }
      // Counter-Attack (core p.97): each Attack roll of 6 against it is a Hit back on the attacker.
      if (kind === 'clash' && attacker && hasRule(target.rules, 'Counter-Attack')) {
        const sixes = hit.values.filter((v) => v === 6).length;
        if (sixes) (ctx.pending ??= []).push({ kind: 'Counter-Attack', fromId: target.id, toId: attacker.id, hits: sixes });
      }
      ev(ctx, { type: 'dice', text: `${pool.label}: ${pool.dice} dice needing ${pool.skill} or less → ${hits} Hit${hits === 1 ? '' : 's'}.`, dice: hit.record, player: spec.attackerOwner });
    }
    totalHits += hits;
    if (!hits) continue;
    // Defense (core p.40, p.46): Hardened lowers Cleave / Armor Piercing / Brutal Impact (core p.99);
    // Linebreaker ignores Shield and Bastion (core p.99).
    const reduce = Math.max(0, (pool.reduceD ?? 0) - hardened);
    const frontBonus = (pool.ignoreShield ? 0 : shieldBonus) + phalanxBonus;
    const d = stat(target, 'D') - (pool.ignoreShield ? bastion : 0) + frontBonus;
    const dEff = pool.smite ? 0 : Math.max(0, d - reduce);
    const E = stat(target, 'E');
    const save = pool.defenseOverride !== undefined ? pool.defenseOverride : Math.max(dEff, E);
    let w = 0;
    let saved = 0;
    const rollDef = (n: number, t: number, label: string) => {
      if (n <= 0) return;
      const def = rollTest(ctx, n, { target: t, defense: true }, `${target.name}: ${label}`);
      const passed = [...def.passed];
      const vals = [...def.values];
      // Untouchable: re-roll failed Defense rolls of 6 (core p.101).
      if (hasRule(target.rules, 'Untouchable') && vals.some((v, i) => v === 6 && !passed[i])) {
        const idx = vals.map((v, i) => (v === 6 && !passed[i] ? i : -1)).filter((i) => i >= 0);
        const rr = rollTest(ctx, idx.length, { target: t, defense: true }, `${target.name}: Untouchable re-roll`);
        idx.forEach((i, k) => {
          vals[i] = rr.values[k]!;
          passed[i] = rr.passed[k]!;
        });
        def.record.notes?.push(`Untouchable re-rolled ${idx.length}`);
      }
      // Brittle (core p.97): against Clash or Charge from the flank, two successes become fails; from the rear, four.
      const brittle = melee && hasRule(target.rules, 'Brittle') ? (spec.arc === 'rear' ? 4 : spec.arc === 'front' ? 0 : 2) : 0;
      let flipped = 0;
      for (let i = 0; i < passed.length && flipped < brittle; i++)
        if (passed[i]) {
          passed[i] = false;
          flipped++;
        }
      // Tenacious (X): X failed Defense rolls count as successes (core p.101).
      // Some entries gain Tenacious (1) when targeted by a Volley (Athanatoi, Fallen Divinity; od p.13, p.25).
      const volleyTen = kind === 'volley' && (target.notes ?? []).some((n) => /target of a Volley Action.*Tenacious\s*\(?1/i.test(n)) ? 1 : 0;
      const ten = ruleX(target.rules, 'Tenacious') + volleyTen;
      let saves = 0;
      for (let i = 0; i < passed.length && saves < ten; i++)
        if (!passed[i]) {
          passed[i] = true;
          saves++;
        }
      passed.forEach((p, i) => {
        if (p) saved++;
        else w += (pool.deadly6 && vals[i] === 6 ? 2 : 1) + (pool.extraWoundOnSix && vals[i] === 6 ? 1 : 0);
      });
      ev(ctx, { type: 'dice', text: `${target.name} ${label}: ${n} roll${n === 1 ? '' : 's'} needing ${t} or less.`, dice: def.record, player: target.owner });
    };
    rollDef(hits - onesHits, save, 'Defense');
    rollDef(onesHits, E, 'Evasion only (Hit Rolls of 1)');
    const mods = [frontBonus ? `front +${frontBonus}` : '', reduce ? `−${reduce} Defense` : '', pool.smite ? 'no Defense (Smite)' : '', bastion && pool.ignoreShield ? 'Bastion ignored' : '']
      .filter(Boolean)
      .join(', ');
    ev(ctx, { type: 'note', text: `${target.name} saves on ${save} or less${mods ? ` (${mods})` : ''}: ${saved} saved, ${w} Wound${w === 1 ? '' : 's'}.`, player: target.owner });
    wounds += w;
  }
  const res: AttackResult = { hits: totalHits, wounds, moraleWounds: 0, standsLost: 0, destroyed: false, naturalOnes };
  if (wounds) {
    // Designate Target (Spires rule text): the Regiment that suffers the Wound is Marked until the end of the Round.
    if (attacker && hasRule(attacker.rules, 'Designate Target') && (kind === 'clash' || kind === 'impact' || kind === 'volley') && !target.flags.marked) {
      target.flags.marked = true;
      ev(ctx, { type: 'note', text: `${target.name} is Marked until the end of the Round (Designate Target): friendly Charges against it get +2″ and re-roll failed Hit Rolls.`, regimentId: target.id });
    }
    const before = target.stands.length;
    allocateWounds(ctx, target, wounds, spec.attackerOwner, spec.noLethalDemise ? undefined : spec.attackerId);
    if (!isDestroyed(target) && spec.morale) res.moraleWounds = moraleTest(ctx, target, wounds, spec);
    res.standsLost = before - target.stands.length;
    res.destroyed = isDestroyed(target);
  }
  resolvePending(ctx);
  return res;
}

/** Lethal Demise and Counter-Attack Hits queued during an attack (core p.97, p.99). */
function resolvePending(ctx: Ctx): void {
  while (ctx.pending?.length) {
    const p = ctx.pending.shift()!;
    const from = ctx.s.regiments[p.fromId];
    const to = ctx.s.regiments[p.toId];
    if (!from || !to || isDestroyed(to)) continue;
    ev(ctx, { type: 'note', text: `${p.kind}: ${to.name} suffers ${p.hits} Hit${p.hits === 1 ? '' : 's'} from ${from.name}.` });
    if (p.kind === 'Lethal Demise' && hasRule(from.rules, 'Reprocessing Agents')) reprocess(ctx, to);
    resolveAttack(ctx, {
      attackerOwner: from.owner,
      attackerId: from.id,
      targetId: to.id,
      arc: 'front',
      pools: [{ label: p.kind, dice: 0, skill: 0, autoHits: p.hits }],
      morale: false,
      terrifying: 0,
      what: p.kind,
      kind: 'special',
      noLethalDemise: true,
    });
  }
}

/** Reprocessing Agents (Spires rule text): −1 Defense until the end of the Round, at most −1. */
export function reprocess(ctx: Ctx, t: RegimentState): void {
  if (t.flags.reprocessed) return;
  t.flags.reprocessed = true;
  t.roundMods.push({ stat: 'D', delta: -1, source: 'Reprocessing Agents' });
  ev(ctx, { type: 'note', text: `${t.name} suffers −1 Defense until the end of the Round (Reprocessing Agents).` });
}

export function isDestroyed(r: RegimentState): boolean {
  return r.location === 'destroyed';
}

/**
 * Morale (core p.59–60): roll one die per Wound; each roll over Resolve is another Wound,
 * which does not trigger further tests. Flank: re-roll successes. Rear: all fail (core p.46).
 * Fearless / Bravery ignore Terrifying (core p.97–98); Phalanx +1 Resolve against the front
 * (core p.100); Iron Discipline: no re-rolls or automatic fails (core p.99); Indomitable (X):
 * X fails become passes (core p.99); Oblivious: 1 Wound per 2 fails, rounding up (core p.99);
 * a declined Duel re-rolls successful tests of 1 (core p.76).
 */
export function moraleTest(ctx: Ctx, r: RegimentState, wounds: number, spec: Pick<AttackSpec, 'arc' | 'terrifying' | 'attackerOwner'>): number {
  // Animate Vessel (od p.5): no Resolve, always passes Morale Tests.
  if (autoPassesResolve(r)) {
    ev(ctx, { type: 'note', text: `${r.name} has Animate Vessel: it passes its Morale Tests automatically (od p.5).`, player: r.owner });
    return 0;
  }
  const ignoresFear = hasRule(r.rules, 'Fearless') || hasRule(r.rules, 'Bravery');
  const phalanx = spec.arc === 'front' && hasRule(r.rules, 'Phalanx') ? 1 : 0;
  const R = Math.max(0, resolveValue(ctx, r) - (ignoresFear ? 0 : spec.terrifying) + phalanx);
  const iron = hasRule(r.rules, 'Iron Discipline');
  const t = rollTest(
    ctx,
    wounds,
    // Dark Power Tier IV and similar effects (od p.7): re-roll successful Morale Tests.
    { target: R, rerollSuccesses: (!iron && (spec.arc === 'left' || spec.arc === 'right')) || rerollsMoraleSuccesses(ctx.s, r), autoFail: !iron && spec.arc === 'rear' },
    `${r.name}: Morale`,
  );
  let failed = wounds - t.passes;
  if (r.flags.declinedDuel) {
    // Re-roll successful Resolve tests of 1 (core p.76).
    const ones = t.values.filter((v, i) => v === 1 && t.passed[i]).length;
    if (ones) {
      const rr = rollTest(ctx, ones, { target: R }, `${r.name}: declined Duel re-roll`);
      failed += ones - rr.passes;
    }
  }
  // Indomitable (X); Violent Delirium gives [Drone] Regiments Indomitable equal to their size bonus.
  let indom = ruleX(r.rules, 'Indomitable');
  if (sectOf(ctx.s, r.owner) === 'underspires' && hasRole(r, 'Drone')) indom = Math.max(indom, sizeBonus(ctx, r));
  const saved = Math.min(indom, failed);
  failed -= saved;
  let extra = failed;
  if (hasRule(r.rules, 'Oblivious')) extra = Math.ceil(failed / 2);
  const notes = [
    spec.terrifying && !ignoresFear ? `Terrifying −${spec.terrifying}` : '',
    spec.arc === 'rear' && !iron ? 'attacked in the rear' : spec.arc !== 'front' && !iron ? 'attacked in the flank' : '',
    saved ? `Indomitable saves ${saved}` : '',
    extra !== failed ? 'Oblivious' : '',
  ]
    .filter(Boolean)
    .join(', ');
  ev(ctx, { type: 'dice', text: `${r.name} tests Morale ${wounds}× on ${R} or less${notes ? ` (${notes})` : ''}: ${failed} failed → ${extra} more Wound${extra === 1 ? '' : 's'}.`, dice: t.record, player: r.owner });
  if (extra > 0) allocateWounds(ctx, r, extra, spec.attackerOwner);
  return extra;
}

/**
 * Wound allocation (core p.53–55): one at a time, wounded non-Command Stands first; finish a
 * Stand before starting another; rear rank first, alternating ends from the Stand furthest from
 * the Command Stand; Command Stand last. Characters are ignored.
 * `byRegimentId`: the enemy Regiment causing the Wounds (for Lethal Demise, core p.99).
 */
export function allocateWounds(ctx: Ctx, r: RegimentState, n: number, byPlayer: PlayerId, byRegimentId?: string): void {
  const W = Math.max(1, stat(r, 'W'));
  const ld = ruleX(r.rules, 'Lethal Demise');
  const by = byRegimentId ? ctx.s.regiments[byRegimentId] : undefined;
  const byInContact = !!by && !isDestroyed(by) && inContact(ctx, r, by);
  for (let k = 0; k < n && r.stands.length > 0; k++) {
    const slots = layout(formationInput(ctx.s, r));
    const pos = new Map(slots.map((s) => [s.id, s]));
    const cf = commandFile(Math.max(...slots.map((s) => s.file)) + 1);
    const candidates = [...r.stands].sort((a, b) => {
      if (a.isCommand !== b.isCommand) return a.isCommand ? 1 : -1;
      if ((a.wounds > 0) !== (b.wounds > 0)) return a.wounds > 0 ? -1 : 1;
      const pa = pos.get(a.id);
      const pb = pos.get(b.id);
      if (pa && pb && pa.rank !== pb.rank) return pb.rank - pa.rank;
      return Math.abs((pb?.file ?? 0) - cf) - Math.abs((pa?.file ?? 0) - cf);
    });
    const st = candidates[0]!;
    st.wounds += 1;
    if (st.wounds >= W) {
      if (r.stands.length === 1) dieFightingCheck(ctx, r, byPlayer);
      r.stands = r.stands.filter((x) => x.id !== st.id);
      ev(ctx, { type: 'casualty', text: `${r.name} loses a Stand${st.isCommand ? ' (the Command Stand)' : ''}; ${r.stands.length} left.`, player: r.owner, regimentId: r.id });
      onStandLost(ctx, r, st);
      // Lethal Demise (X): the enemy in contact that destroyed the Stand suffers X Hits (core p.99).
      if (ld && byInContact) (ctx.pending ??= []).push({ kind: 'Lethal Demise', fromId: r.id, toId: by!.id, hits: ld });
      if (st.isCommand && r.stands.length > 0) {
        // Command Models' rules are lost; free Reform to close the gap (core p.68) — the layout closes it automatically.
        r.commandModels = [];
        ev(ctx, { type: 'casualty', text: `${r.name}'s Command Models are lost (core p.68).`, regimentId: r.id });
      }
      checkBroken(ctx, r);
      if (isDestroyed(r)) return;
      if (r.stands.length === 0) {
        destroyRegiment(ctx, r, byPlayer);
        return;
      }
    }
  }
}

function inContact(ctx: Ctx, a: RegimentState, b: RegimentState): boolean {
  const pa = regimentPolys(ctx.s, a);
  const pb = regimentPolys(ctx.s, b);
  return pa.some((p) => pb.some((q) => polyDistance(p, q) <= TOL));
}

/**
 * Broken (core p.60): losing half or more of the Stands it had at the start of the Round (or at
 * the last Rally), rounded up. Shattered (core p.61): a Broken Regiment losing half or more of its
 * Stands since it Broke is destroyed. RULE-AMBIGUITY: AMB-10 — Characters are not counted.
 * Dauntless Regiments are never Broken (core p.97).
 */
export function checkBroken(ctx: Ctx, r: RegimentState): void {
  if (r.location === 'destroyed' || r.stands.length === 0) return;
  if (hasRule(r.rules, 'Dauntless')) return;
  const n = r.stands.length;
  if (!r.broken) {
    const lost = r.standsAtRoundStart - n;
    if (lost > 0 && lost >= Math.ceil(r.standsAtRoundStart / 2)) {
      r.broken = true;
      r.standsWhenBroken = n + 0;
      ev(ctx, { type: 'broken', text: `${r.name} is Broken (lost ${lost} of ${r.standsAtRoundStart} Stands this Round, core p.60).`, player: r.owner, regimentId: r.id });
    }
  } else if (r.standsWhenBroken !== null) {
    const lost = r.standsWhenBroken - n;
    if (lost > 0 && lost >= Math.ceil(r.standsWhenBroken / 2)) {
      ev(ctx, { type: 'shattered', text: `${r.name} is Shattered and flees (core p.61).`, player: r.owner, regimentId: r.id });
      destroyRegiment(ctx, r, null);
    }
  }
}

/**
 * Die Fighting! (core p.74): when its Regiment is destroyed and neither the Character nor the
 * Regiment has performed any Actions this Round, the Character makes a free Clash against one
 * enemy in contact; otherwise it is removed. Monster Characters do not Die Fighting.
 * RULE-AMBIGUITY: AMB-35 — the Character is removed after its last Clash.
 */
function dieFightingCheck(ctx: Ctx, r: RegimentState, byPlayer: PlayerId): void {
  const c = Object.values(ctx.s.characters).find((x) => x.attachedTo === r.id && !x.destroyed);
  if (!c || c.type === 'Monster' || r.type === 'Monster') return;
  const act = ctx.s.activation;
  const acted = r.activatedThisRound || c.activatedThisRound || (act && act.regimentId === r.id && act.actions.length > 0);
  if (acted) return;
  const slot = layout(formationInput(ctx.s, r)).find((x) => x.isCharacter);
  if (!slot) return;
  const cp = rectPoly(slot.rect);
  const enemy = onTableRegiments(ctx.s).find((e) => e.owner !== r.owner && regimentPolys(ctx.s, e).some((p) => polyDistance(p, cp) <= TOL));
  if (!enemy) return;
  ev(ctx, { type: 'note', text: `Die Fighting! ${c.name} makes a last Clash against ${enemy.name} (core p.74).`, player: r.owner });
  resolveAttack(ctx, {
    attackerOwner: r.owner,
    targetId: enemy.id,
    arc: 'front',
    pools: [{ label: `${c.name} (Die Fighting!)`, dice: charStat(c, 'A'), skill: charStat(c, 'C'), rerollFailed: hasRule(c.rules, 'Flurry'), reduceD: ruleX(c.rules, 'Cleave'), ignoreShield: hasRule(c.rules, 'Linebreaker') }],
    morale: true,
    terrifying: ruleX(c.rules, 'Terrifying'),
    what: 'Die Fighting!',
    kind: 'clash',
  });
  void byPlayer;
}

export function destroyRegiment(ctx: Ctx, r: RegimentState, byPlayer: PlayerId | null): void {
  r.location = 'destroyed';
  r.stands = [];
  const enemy: PlayerId = r.owner === 'P1' ? 'P2' : 'P1';
  const scorer = byPlayer ?? enemy;
  ctx.s.tally.regimentsDestroyed[scorer] += 1;
  ev(ctx, { type: 'destroyed', text: `${r.name} is destroyed.`, player: r.owner, regimentId: r.id });
  onRegimentDestroyed(ctx, r);
  const c = Object.values(ctx.s.characters).find((x) => x.attachedTo === r.id && !x.destroyed);
  if (c) killCharacter(ctx, c, scorer, 'its Regiment was destroyed');
}

export function killCharacter(ctx: Ctx, c: CharacterState, scorer: PlayerId, why: string): void {
  c.destroyed = true;
  ctx.s.tally.charactersKilled[scorer] += 1;
  if (c.isWarlord) ctx.s.tally.warlordSlain[scorer] = true;
  ev(ctx, { type: 'destroyed', text: `${c.name}${c.isWarlord ? ' (Warlord)' : ''} is slain: ${why}.` });
}
