import { segmentPolyDistance, type Poly } from './polygon';
import { LOS_LINE_WIDTH, type Vec } from './vec';

/** An obstacle for Line of Sight: a footprint with a Size (core p.12). */
export interface Obstacle {
  poly: Poly;
  size: number;
}

/**
 * Is a 1 mm wide line from a to b blocked by an obstacle? (core p.14, p.38; AMB-08)
 * Blocked if the strip of width 1 mm around the segment meets the obstacle's interior.
 */
export function lineBlockedBy(a: Vec, b: Vec, o: Obstacle): boolean {
  return segmentPolyDistance(a, b, o.poly) < LOS_LINE_WIDTH / 2 - 1e-9;
}

/**
 * Volley obstruction (core p.38): obstructed by Regiments or terrain whose Size is at least
 * BOTH the shooter's and the target's Size. Smaller things are ignored. (AMB-07)
 */
export function volleyLineObstructed(a: Vec, b: Vec, shooterSize: number, targetSize: number, obstacles: readonly Obstacle[]): boolean {
  return obstacles.some((o) => o.size >= shooterSize && o.size >= targetSize && lineBlockedBy(a, b, o));
}

/** General Line of Sight obstruction (core p.14): obstacles of equal or larger Size than the target. (AMB-07) */
export function losLineObstructed(a: Vec, b: Vec, targetSize: number, obstacles: readonly Obstacle[]): boolean {
  return obstacles.some((o) => o.size >= targetSize && lineBlockedBy(a, b, o));
}
