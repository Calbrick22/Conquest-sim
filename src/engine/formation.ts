import { baseInches } from './geometry/bases';
import { rectPoly, type Poly, type Rect } from './geometry/polygon';
import { add, dir, scale, sub, type Vec } from './geometry/vec';
import type { Pose, RegimentState } from './model/types';

/**
 * Regiment formations (core p.13): Stands in ranks and files, edge to edge, all facing the same
 * way. The front rank has at least 2 Stands unless the Regiment has a single Stand. All ranks
 * are full except possibly the rearmost, which is centred. The Command Stand is in the centre
 * of the front rank (core p.13, p.68). An attached Character stands in the front rank next to
 * the Command Stand (core p.73). Wounded Stands go to the rear (core p.13).
 */
export interface Slot {
  /** Stand id, or the Character id when isCharacter. */
  id: string;
  isCharacter: boolean;
  isCommand: boolean;
  rank: number;
  file: number;
  rect: Rect;
}

export interface FormationInput {
  regiment: Pick<RegimentState, 'stands' | 'files' | 'pose' | 'type'>;
  characterId?: string | null;
}

export function standCount(input: FormationInput): number {
  return input.regiment.stands.length + (input.characterId ? 1 : 0);
}

/** Legal number of files for n Stands: 2..n (1 only for a single Stand). Core p.13. */
export function legalFiles(n: number): number[] {
  if (n <= 1) return [1];
  return Array.from({ length: n - 1 }, (_, i) => i + 2);
}

export function clampFiles(n: number, files: number): number {
  if (n <= 1) return 1;
  return Math.max(2, Math.min(n, Math.round(files)));
}

export function ranksFor(n: number, files: number): number {
  return Math.max(1, Math.ceil(n / Math.max(1, files)));
}

/** File index of the Command Stand: the centre, or just left of centre for even files (core p.13). */
export function commandFile(files: number): number {
  return Math.floor((files - 1) / 2);
}

/** Unit vectors for a pose. */
export function poseFrame(p: Pose): { forward: Vec; right: Vec } {
  const f = dir(p.angle);
  return { forward: f, right: { x: f.y, y: -f.x } };
}

/**
 * Centre of the Stand at (rank, file) for a Regiment whose front-centre is at the pose.
 * RULE-AMBIGUITY: AMB-27 — an incomplete rear rank is centred to the nearest whole Stand
 * (offset rounded down), keeping Stands edge to edge with the rank in front.
 */
export function slotCentre(pose: Pose, files: number, rank: number, fileInRank: number, standW: number, standD: number): Vec {
  const { forward, right } = poseFrame(pose);
  const p = { x: pose.x, y: pose.y };
  return add(sub(p, scale(forward, standD * (rank + 0.5))), scale(right, standW * (fileInRank - (files - 1) / 2)));
}

export function layout(input: FormationInput): Slot[] {
  const { regiment: r, characterId } = input;
  const base = baseInches(r.type);
  const n = standCount(input);
  if (n === 0) return [];
  const F = clampFiles(n, r.files);
  const R = ranksFor(n, F);
  const lastCount = n - F * (R - 1);

  // Slot positions in fill order: front rank first.
  const positions: { rank: number; file: number }[] = [];
  for (let rank = 0; rank < R; rank++) {
    const count = rank === R - 1 ? lastCount : F;
    const offset = rank === R - 1 ? Math.floor((F - count) / 2) : 0;
    for (let i = 0; i < count; i++) positions.push({ rank, file: offset + i });
  }

  const cmd = r.stands.find((s) => s.isCommand);
  const others = r.stands.filter((s) => s !== cmd).sort((a, b) => Number(a.wounds > 0) - Number(b.wounds > 0));
  const assigned = new Map<string, { rank: number; file: number; isCharacter: boolean; isCommand: boolean }>();
  const taken = new Set<string>();
  const key = (p: { rank: number; file: number }) => `${p.rank}:${p.file}`;
  const cf = commandFile(F);
  if (cmd) {
    assigned.set(cmd.id, { rank: 0, file: cf, isCharacter: false, isCommand: true });
    taken.add(`0:${cf}`);
  }
  if (characterId) {
    const want = cmd ? (cf + 1 < F ? cf + 1 : cf - 1) : cf;
    const f = Math.max(0, Math.min(F - 1, want));
    assigned.set(characterId, { rank: 0, file: f, isCharacter: true, isCommand: false });
    taken.add(`0:${f}`);
  }
  let pi = 0;
  for (const s of others) {
    while (pi < positions.length && taken.has(key(positions[pi]!))) pi++;
    const p = positions[pi];
    if (!p) break;
    taken.add(key(p));
    assigned.set(s.id, { ...p, isCharacter: false, isCommand: false });
  }

  const out: Slot[] = [];
  for (const [id, a] of assigned) {
    const c = slotCentre(r.pose, F, a.rank, a.file, base.width, base.depth);
    out.push({ id, ...a, rect: { c, halfWidth: base.width / 2, halfDepth: base.depth / 2, angle: r.pose.angle } });
  }
  return out.sort((a, b) => a.rank - b.rank || a.file - b.file);
}

/**
 * The Regiment's footprint: a rectangle as wide and deep as its full ranks, ignoring gaps in an
 * incomplete rear rank (core p.45). Used for arcs and as the outline of the Regiment.
 */
export function footprint(input: FormationInput): Rect {
  const r = input.regiment;
  const base = baseInches(r.type);
  const n = Math.max(1, standCount(input));
  const F = clampFiles(n, r.files);
  const R = ranksFor(n, F);
  const { forward } = poseFrame(r.pose);
  const c = sub({ x: r.pose.x, y: r.pose.y }, scale(forward, (R * base.depth) / 2));
  return { c, halfWidth: (F * base.width) / 2, halfDepth: (R * base.depth) / 2, angle: r.pose.angle };
}

export function standPolys(input: FormationInput): Poly[] {
  return layout(input).map((s) => rectPoly(s.rect));
}

/** Front-left and front-right corners of the Regiment. */
export function frontCorners(input: FormationInput): { left: Vec; right: Vec } {
  const fp = footprint(input);
  const { right } = poseFrame(input.regiment.pose);
  const p = { x: input.regiment.pose.x, y: input.regiment.pose.y };
  return { left: sub(p, scale(right, fp.halfWidth)), right: add(p, scale(right, fp.halfWidth)) };
}

/** Width of the front of the Regiment, in inches. */
export function frontWidth(input: FormationInput): number {
  return footprint(input).halfWidth * 2;
}
