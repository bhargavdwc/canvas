import type { WorldPoint } from '@canvas/shared-types';

export function distanceSquared(a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

export function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.sqrt(distanceSquared(a, b));
}

/** True when the two points are at least `min` apart (no sqrt needed). */
export function isFarEnough(a: WorldPoint, b: WorldPoint, min: number): boolean {
  return distanceSquared(a, b) >= min * min;
}
