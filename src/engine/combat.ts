import { ev, rollTest, type Ctx } from './dice';
import { commandFile, layout } from './formation';
import type { Arc } from './geometry/arcs';
import type { CharacterState, PlayerId, Profile, RegimentState } from './model/types';
import { attachedCharacter, formationInput, regimentStandCount } from './queries';
import { hasRule } from './rules/special/rules';

/** A characteristic including Round modifiers (manual tool, Draw Events), never below 0 (core p.15). */
export function stat(r: RegimentState, k: keyof Profile): number {
  const base = r.profile[k] ?? 0;
  const mod = r.roundMods.filter((m) => m.stat === k).reduce((a, m) => a + m.delta, 0);
  return Math.max(0, base + mod);
}

export function charStat(c: CharacterState, k: keyof Profile): number {
  return Math.max(0, c.profile[k] ?? 0);
}

/**
 * Resolve (core p.59): the highest R in the Regiment (its Character included), plus +1 for 4–6
 * Stands, +2 for 7–9, +3 for 10+. A Broken Regiment uses its lowest R (core p.60).
 * RULE-AMBIGUITY: AMB-31 — the size bonus still applies while Broken.
 */
export function resolveValue(ctx: Ctx, r: RegimentState): number {
  const c = attachedCharacter(ctx.s, r.id);
  const rs = [stat(r, 'R'), ...(c ? [charStat(c, 'R')] : [])];
  const base = r.broken ? Math.min(...rs) : Math.max(...rs);
  const n = regimentStandCount(ctx.s, r);
  const bonus = n >= 10 ? 3 : n >= 7 ? 2 : n >= 4 ? 1 : 0;
  return base + bonus;
}

/** Highest Resolve Characteristic of any Stand (Combat Reform, Withdraw; core p.48, p.51). */
export function highestR(ctx: Ctx, r: RegimentState): number {
  const c = attachedCharacter(ctx.s, r.id);
  return Math.max(stat(r, 'R'), c ? charStat(c, 'R') : 0);
}

export interface AttackPool {
  label: string;
  dice: number;
  /** Clash or Volley value used to hit. */
  skill: number;
  rerollFailed?: boolean;
  rerollSixes?: boolean;
  /** Relentless Blows / Rapid Volley: each natural 1 adds a Hit (core p.40, p.46, p.100). */
  extraOnOne?: boolean;
  /** Cleave / Armor Piercing / Brutal Impact: lowers the target's Defense (core p.97). */
  reduceD?: number;
  ignoreShield?: boolean;
  /** Deadly Shot / Deadly Blades: a failed Defense roll of 6 causes 2 Wounds (core p.97). */
  deadly6?: boolean;
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
}

export interface AttackResult {
  hits: number;
  wounds: number;
  moraleWounds: number;
  standsLost: number;
  destroyed: boolean;
}

/** Hit → Defense → Wounds → allocation → Morale → Broken (core p.40, p.46, p.53–61). */
export function resolveAttack(ctx: Ctx, spec: AttackSpec): AttackResult {
  const target = ctx.s.regiments[spec.targetId]!;
  let totalHits = 0;
  let wounds = 0;
  const shieldApplies = hasRule(target.rules, 'Shield') && spec.arc === 'front';
  for (const pool of spec.pools) {
    if (pool.dice <= 0) continue;
    const hit = rollTest(ctx, pool.dice, { target: pool.skill, rerollFailed: !!pool.rerollFailed, rerollSixes: !!pool.rerollSixes }, `${spec.what}: ${pool.label} to hit`);
    let hits = hit.passes;
    if (pool.extraOnOne) {
      const ones = hit.values.filter((v) => v === 1).length;
      if (ones) {
        hits += ones;
        hit.record.notes?.push(`+${ones} Hit${ones > 1 ? 's' : ''} from natural 1s`);
      }
    }
    ev(ctx, { type: 'dice', text: `${pool.label}: ${pool.dice} dice needing ${pool.skill} or less → ${hits} Hit${hits === 1 ? '' : 's'}.`, dice: hit.record, player: spec.attackerOwner });
    totalHits += hits;
    if (!hits) continue;
    const shield = shieldApplies && !pool.ignoreShield ? 1 : 0;
    const dEff = Math.max(0, stat(target, 'D') + shield - (pool.reduceD ?? 0));
    const save = Math.max(dEff, stat(target, 'E'));
    const def = rollTest(ctx, hits, { target: save, defense: true }, `${target.name}: Defense`);
    let w = 0;
    def.values.forEach((v, i) => {
      if (!def.passed[i]) w += pool.deadly6 && v === 6 ? 2 : 1;
    });
    const mods = [shield ? 'Shield +1' : '', pool.reduceD ? `−${pool.reduceD} Defense` : ''].filter(Boolean).join(', ');
    ev(ctx, {
      type: 'dice',
      text: `${target.name} saves on ${save} or less${mods ? ` (${mods})` : ''}: ${def.passes} saved, ${w} Wound${w === 1 ? '' : 's'}${pool.deadly6 ? ' (6s cause 2)' : ''}.`,
      dice: def.record,
      player: target.owner,
    });
    wounds += w;
  }
  const res: AttackResult = { hits: totalHits, wounds, moraleWounds: 0, standsLost: 0, destroyed: false };
  if (!wounds) return res;
  const before = target.stands.length;
  allocateWounds(ctx, target, wounds, spec.attackerOwner);
  res.standsLost = before - (ctx.s.regiments[target.id]!.stands.length);
  if (target.location === 'destroyed') {
    res.destroyed = true;
    return res;
  }
  if (spec.morale) {
    res.moraleWounds = moraleTest(ctx, target, wounds, spec);
  }
  res.standsLost = before - target.stands.length;
  res.destroyed = isDestroyed(target);
  return res;
}

export function isDestroyed(r: RegimentState): boolean {
  return r.location === 'destroyed';
}

/**
 * Morale (core p.59–60): roll one die per Wound; each roll over Resolve is another Wound,
 * which does not trigger further tests. Flank: re-roll successes. Rear: all fail (core p.46).
 */
export function moraleTest(ctx: Ctx, r: RegimentState, wounds: number, spec: Pick<AttackSpec, 'arc' | 'terrifying' | 'attackerOwner'>): number {
  const fearless = hasRule(r.rules, 'Fearless');
  const R = Math.max(0, resolveValue(ctx, r) - (fearless ? 0 : spec.terrifying));
  const t = rollTest(
    ctx,
    wounds,
    { target: R, rerollSuccesses: spec.arc === 'left' || spec.arc === 'right', autoFail: spec.arc === 'rear' },
    `${r.name}: Morale`,
  );
  const failed = wounds - t.passes;
  const notes = [spec.terrifying && !fearless ? `Terrifying −${spec.terrifying}` : '', spec.arc === 'rear' ? 'attacked in the rear' : spec.arc !== 'front' ? 'attacked in the flank' : '']
    .filter(Boolean)
    .join(', ');
  ev(ctx, { type: 'dice', text: `${r.name} tests Morale ${wounds}× on ${R} or less${notes ? ` (${notes})` : ''}: ${failed} failed → ${failed} more Wound${failed === 1 ? '' : 's'}.`, dice: t.record, player: r.owner });
  if (failed > 0) allocateWounds(ctx, r, failed, spec.attackerOwner);
  return failed;
}

/**
 * Wound allocation (core p.53–55): one at a time, wounded non-Command Stands first; finish a
 * Stand before starting another; rear rank first, alternating ends from the Stand furthest from
 * the Command Stand; Command Stand last. Characters are ignored.
 */
export function allocateWounds(ctx: Ctx, r: RegimentState, n: number, byPlayer: PlayerId): void {
  const W = Math.max(1, stat(r, 'W'));
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
      r.stands = r.stands.filter((x) => x.id !== st.id);
      ev(ctx, { type: 'casualty', text: `${r.name} loses a Stand${st.isCommand ? ' (the Command Stand)' : ''}; ${r.stands.length} left.`, player: r.owner, regimentId: r.id });
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

/**
 * Broken (core p.60): losing half or more of the Stands it had at the start of the Round (or at
 * the last Rally), rounded up. Shattered (core p.61): a Broken Regiment losing half or more of its
 * Stands since it Broke is destroyed. RULE-AMBIGUITY: AMB-10 — Characters are not counted.
 */
export function checkBroken(ctx: Ctx, r: RegimentState): void {
  if (r.location === 'destroyed' || r.stands.length === 0) return;
  const n = r.stands.length;
  if (!r.broken) {
    const lost = r.standsAtRoundStart - n;
    if (lost > 0 && lost >= Math.ceil(r.standsAtRoundStart / 2)) {
      r.broken = true;
      r.standsWhenBroken = n + 0;
      // The Stand that broke it counts from the moment it Broke.
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

export function destroyRegiment(ctx: Ctx, r: RegimentState, byPlayer: PlayerId | null): void {
  r.location = 'destroyed';
  r.stands = [];
  const enemy: PlayerId = r.owner === 'P1' ? 'P2' : 'P1';
  const scorer = byPlayer ?? enemy;
  ctx.s.tally.regimentsDestroyed[scorer] += 1;
  ev(ctx, { type: 'destroyed', text: `${r.name} is destroyed.`, player: r.owner, regimentId: r.id });
  const c = Object.values(ctx.s.characters).find((x) => x.attachedTo === r.id && !x.destroyed);
  if (c) {
    // Die Fighting! (core p.74) is resolved by hand in the MVP; the Character is removed.
    killCharacter(ctx, c, scorer, 'its Regiment was destroyed (Die Fighting! is manual, core p.74)');
  }
}

export function killCharacter(ctx: Ctx, c: CharacterState, scorer: PlayerId, why: string): void {
  c.destroyed = true;
  ctx.s.tally.charactersKilled[scorer] += 1;
  if (c.isWarlord) ctx.s.tally.warlordSlain[scorer] = true;
  ev(ctx, { type: 'destroyed', text: `${c.name}${c.isWarlord ? ' (Warlord)' : ''} is slain: ${why}.` });
}
