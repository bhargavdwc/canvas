import type { WorldBounds, WorldPoint } from '@canvas/shared-types';
import type { Camera, Size } from './coordinates';

/** World-space rectangle currently visible through the camera. */
export function getViewportBounds(camera: Camera, size: Size): WorldBounds {
  const halfW = size.width / 2 / camera.zoom;
  const halfH = size.height / 2 / camera.zoom;
  return {
    minX: camera.x - halfW,
    maxX: camera.x + halfW,
    minY: camera.y - halfH,
    maxY: camera.y + halfH,
  };
}

/** Grow bounds by `factor` x its own width/height on every side (buffer for prefetching). */
export function expandBounds(bounds: WorldBounds, factor: number): WorldBounds {
  const w = (bounds.maxX - bounds.minX) * factor;
  const h = (bounds.maxY - bounds.minY) * factor;
  return {
    minX: bounds.minX - w,
    maxX: bounds.maxX + w,
    minY: bounds.minY - h,
    maxY: bounds.maxY + h,
  };
}

/** Grow bounds by a fixed amount of world units on every side. */
export function padBounds(bounds: WorldBounds, amount: number): WorldBounds {
  return {
    minX: bounds.minX - amount,
    maxX: bounds.maxX + amount,
    minY: bounds.minY - amount,
    maxY: bounds.maxY + amount,
  };
}

/** True when `inner` lies entirely inside `outer`. */
export function boundsContain(outer: WorldBounds, inner: WorldBounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

export function boundsIntersect(a: WorldBounds, b: WorldBounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function pointInBounds(point: WorldPoint, bounds: WorldBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}
