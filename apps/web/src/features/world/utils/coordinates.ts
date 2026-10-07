import { WORLD_HALF_EXTENT, type WorldPoint } from '@canvas/shared-types';
import { worldPointSchema } from '@canvas/validation';

/**
 * Camera: the world point shown at the centre of the screen plus a zoom factor
 * (screen pixels per world unit). World +y is UP, screen +y is DOWN.
 */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 4;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

export const WORLD_BOX_SIZE = 100;
export const WORLD_MIN_X = -WORLD_HALF_EXTENT;
export const WORLD_MAX_X = WORLD_HALF_EXTENT + WORLD_BOX_SIZE;
export const WORLD_MIN_Y = -WORLD_HALF_EXTENT;
export const WORLD_MAX_Y = WORLD_HALF_EXTENT + WORLD_BOX_SIZE;

export interface CameraInsets {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export function getTopNavbarHeight(): number {
  if (typeof document !== 'undefined') {
    const el = document.querySelector('header');
    if (el) {
      const h = el.getBoundingClientRect().height;
      if (h > 0) return h;
    }
  }
  return 56;
}

export function clampCamera(camera: Camera, size?: Size, insets?: CameraInsets): Camera {
  const zoom = clampZoom(camera.zoom);

  const minLimitX = WORLD_MIN_X;
  const maxLimitX = WORLD_MAX_X;
  const minLimitY = WORLD_MIN_Y;
  const maxLimitY = WORLD_MAX_Y;

  if (!size || size.width === 0 || size.height === 0) {
    return {
      x: clamp(camera.x, minLimitX, maxLimitX),
      y: clamp(camera.y, minLimitY, maxLimitY),
      zoom,
    };
  }

  // Measure top navbar dynamically so the last box never collides with or hides under the navbar on any screen size
  const navbarH = getTopNavbarHeight();
  const topInset = insets?.top ?? (navbarH + 8);
  const bottomInset = insets?.bottom ?? 0;
  const leftInset = insets?.left ?? 0;
  const rightInset = insets?.right ?? 0;

  const halfW = size.width / 2;
  const halfH = size.height / 2;

  const minX = minLimitX + (halfW - leftInset) / zoom;
  const maxX = maxLimitX - (halfW - rightInset) / zoom;
  const minY = minLimitY + (halfH - bottomInset) / zoom;
  const maxY = maxLimitY - (halfH - topInset) / zoom;

  return {
    x: minX <= maxX ? clamp(camera.x, minX, maxX) : (minLimitX + maxLimitX) / 2,
    y: minY <= maxY ? clamp(camera.y, minY, maxY) : (minLimitY + maxLimitY) / 2,
    zoom,
  };
}

/** World -> screen (pixels, origin top-left of the canvas). */
export function worldToScreen(point: WorldPoint, camera: Camera, size: Size): WorldPoint {
  return {
    x: (point.x - camera.x) * camera.zoom + size.width / 2,
    y: (camera.y - point.y) * camera.zoom + size.height / 2,
  };
}

/** Screen (pixels) -> world. Inverse of {@link worldToScreen}. */
export function screenToWorld(sx: number, sy: number, camera: Camera, size: Size): WorldPoint {
  return {
    x: (sx - size.width / 2) / camera.zoom + camera.x,
    y: camera.y - (sy - size.height / 2) / camera.zoom,
  };
}

/** Change zoom while keeping the world point under screen position (sx, sy) fixed. */
export function zoomAt(camera: Camera, size: Size, sx: number, sy: number, zoom: number): Camera {
  const next = clampZoom(zoom);
  const anchor = screenToWorld(sx, sy, camera, size);
  return clampCamera({
    zoom: next,
    x: anchor.x - (sx - size.width / 2) / next,
    y: anchor.y + (sy - size.height / 2) / next,
  }, size);
}

export function formatCoordinate(point: WorldPoint): string {
  return `${Math.round(point.x)}, ${Math.round(point.y)}`;
}

const INPUT_PATTERN = /^\s*@?\(?\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/;
const WORLD_PATH_PATTERN = /^\/world\/(-?\d+)\/(-?\d+)\/?$/;

/**
 * Parse free-form user input such as "1245, -782", "1245 -782", "@1245,-782" or "(1,2)".
 * Returns null when the text is not a valid in-range coordinate.
 */
export function parseCoordinateInput(input: string): WorldPoint | null {
  const match = INPUT_PATTERN.exec(input);
  if (!match) return null;
  const candidate = { x: Math.round(Number(match[1])), y: Math.round(Number(match[2])) };
  const result = worldPointSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/** Parse a location pathname: "/@x,y" or "/world/x/y". */
export function pathToPoint(pathname: string): WorldPoint | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const worldMatch = WORLD_PATH_PATTERN.exec(decoded);
  if (worldMatch) return parseCoordinateInput(`${worldMatch[1]},${worldMatch[2]}`);
  if (!decoded.startsWith('/@')) return null;
  return parseCoordinateInput(decoded.slice(1));
}

export function pointToPath(point: WorldPoint): string {
  return `/@${Math.round(point.x)},${Math.round(point.y)}`;
}

/** Reads initial target coordinate from pathname, hash or query params. */
export function getInitialPointFromUrl(): WorldPoint | null {
  if (typeof window === 'undefined') return null;
  const fromPath = pathToPoint(window.location.pathname);
  if (fromPath) return fromPath;

  if (window.location.hash) {
    const rawHash = window.location.hash.replace(/^#\/?/, '');
    const fromHash = pathToPoint('/' + rawHash) || parseCoordinateInput(rawHash);
    if (fromHash) return fromHash;
  }

  if (window.location.search) {
    const params = new URLSearchParams(window.location.search);
    const coord = params.get('coord') || params.get('c');
    if (coord) {
      const parsed = parseCoordinateInput(coord);
      if (parsed) return parsed;
    }
    const x = params.get('x');
    const y = params.get('y');
    if (x && y) {
      const parsed = parseCoordinateInput(`${x},${y}`);
      if (parsed) return parsed;
    }
  }

  return null;
}
