import {
  WORLD_MIN_X,
  WORLD_MAX_X,
  WORLD_MIN_Y,
  WORLD_MAX_Y,
} from '../utils/coordinates';

export const SPAN_X = WORLD_MAX_X - WORLD_MIN_X; // 2,000,100
export const SPAN_Y = WORLD_MAX_Y - WORLD_MIN_Y; // 1,000,100

export interface GeoPoint {
  lon: number;
  lat: number;
}

export interface CanvasWorldPoint {
  x: number;
  y: number;
}

/**
 * Projects geographic longitude [-180..180] and latitude [-90..90]
 * to canvas world coordinates.
 */
export function projectGeoToWorld(lon: number, lat: number): CanvasWorldPoint {
  const clampedLon = Math.max(-180, Math.min(180, lon));
  const clampedLat = Math.max(-90, Math.min(90, lat));

  const x = WORLD_MIN_X + ((clampedLon + 180) / 360) * SPAN_X;
  const y = WORLD_MIN_Y + ((clampedLat + 90) / 180) * SPAN_Y;

  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

/**
 * Inverse projection: converts canvas world coordinates back to geographic (lon, lat).
 */
export function projectWorldToGeo(x: number, y: number): GeoPoint {
  const clampedX = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X, x));
  const clampedY = Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y, y));

  const lon = ((clampedX - WORLD_MIN_X) / SPAN_X) * 360 - 180;
  const lat = ((clampedY - WORLD_MIN_Y) / SPAN_Y) * 180 - 90;

  return {
    lon: Math.max(-180, Math.min(180, lon)),
    lat: Math.max(-90, Math.min(90, lat)),
  };
}

/**
 * Converts a world coordinate into local Pixi Graphics coordinates.
 * In world space, +Y is UP, but in Pixi Graphics space +Y is DOWN.
 */
export function worldToGraphicsPoint(wx: number, wy: number): CanvasWorldPoint {
  return {
    x: wx,
    y: -wy,
  };
}

/**
 * Checks whether two longitude points jump across the antimeridian seam (> 180 deg delta).
 */
export function isAntimeridianJump(lonA: number, lonB: number): boolean {
  return Math.abs(lonA - lonB) > 180;
}
