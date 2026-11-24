import { pointPolyDistance, type Poly } from './polygon';
import type { Vec } from './vec';

/**
 * A Stand is in range of an Objective Zone when it overlaps the circle (pack p.8).
 * Touching the edge exactly does not count.
 */
export function standOverlapsZone(stand: Poly, centre: Vec, diameter: number): boolean {
  return pointPolyDistance(centre, stand) < diameter / 2 - 1e-9;
}
