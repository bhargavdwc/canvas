import { WORLD_HALF_EXTENT, type WorldPoint } from '@canvas/shared-types';

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

export const WORLD_BOX_SIZE = 100;
export const WORLD_HALF_EXTENT_X = WORLD_HALF_EXTENT;
export const WORLD_HALF_EXTENT_Y = 500_000;

export const WORLD_MIN_X = -WORLD_HALF_EXTENT_X;
export const WORLD_MAX_X = WORLD_HALF_EXTENT_X + WORLD_BOX_SIZE;
export const WORLD_MIN_Y = -WORLD_HALF_EXTENT_Y;
export const WORLD_MAX_Y = WORLD_HALF_EXTENT_Y + WORLD_BOX_SIZE;

/**
 * Calculates the exact zoom required so the horizontal canvas
 * spans edge-to-edge across the viewport.
 */
export function getMinZoom(size?: Size): number {
  let w = size?.width ?? 0;
  if (w <= 0 && typeof window !== 'undefined') {
    w = window.innerWidth;
  }
  if (w <= 0) {
    return 0.00072; // default for 1440px desktop
  }
  const span = WORLD_MAX_X - WORLD_MIN_X;
  return w / span;
}

export const MIN_ZOOM = 0.00072;
export const MAX_ZOOM = 4;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampZoom(zoom: number, size?: Size): number {
  const min = getMinZoom(size);
  return clamp(zoom, min, MAX_ZOOM);
}

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
  const zoom = clampZoom(camera.zoom, size);

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

  const topInset = insets?.top ?? 0;
  const bottomInset = insets?.bottom ?? 0;
  const leftInset = insets?.left ?? 0;
  const rightInset = insets?.right ?? 0;

  const halfW = size.width / 2;
  const halfH = size.height / 2;

  const minX = minLimitX + (halfW - leftInset) / zoom;
  const maxX = maxLimitX - (halfW - rightInset) / zoom;
  const minY = minLimitY + (halfH - bottomInset) / zoom;
  const maxY = maxLimitY - (halfH - topInset) / zoom;

  // When at overview zoom level, lock vertical camera to center so there is ZERO vertical scroll
  const isOverview = zoom <= getMinZoom(size) * 1.05;
  const centerY = (minLimitY + maxLimitY) / 2;
  const clampedY = isOverview || minY > maxY ? centerY : clamp(camera.y, minY, maxY);

  return {
    x: minX <= maxX ? clamp(camera.x, minX, maxX) : (minLimitX + maxLimitX) / 2,
    y: clampedY,
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
  const next = clampZoom(zoom, size);
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

export type CoordinateValidationResult =
  | { status: 'valid'; point: WorldPoint }
  | { status: 'invalid_format'; message: string }
  | {
      status: 'out_of_bounds';
      message: string;
      xOutOfBounds: boolean;
      yOutOfBounds: boolean;
      clampedPoint: WorldPoint;
    };

/**
 * Validates coordinate user input against canvas boundaries.
 * Returns detailed status, boundary limit messages, and nearest clamped coordinate.
 */
export function validateCoordinateInput(input: string): CoordinateValidationResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      status: 'invalid_format',
      message: 'Enter format: x, y (e.g. 1245, -782)',
    };
  }

  const match = INPUT_PATTERN.exec(trimmed);
  if (!match) {
    return {
      status: 'invalid_format',
      message: 'Enter format: x, y (e.g. 1245, -782)',
    };
  }

  const rawX = Number(match[1]);
  const rawY = Number(match[2]);

  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return {
      status: 'invalid_format',
      message: 'Coordinates must be valid numbers.',
    };
  }

  const x = Math.round(rawX);
  const y = Math.round(rawY);

  const xMin = WORLD_MIN_X;
  const xMax = WORLD_HALF_EXTENT_X; // 1,000,000
  const yMin = WORLD_MIN_Y;
  const yMax = WORLD_HALF_EXTENT_Y; // 500,000

  const xOutOfBounds = x < xMin || x > xMax;
  const yOutOfBounds = y < yMin || y > yMax;

  if (xOutOfBounds || yOutOfBounds) {
    const clampedPoint = {
      x: clamp(x, xMin, xMax),
      y: clamp(y, yMin, yMax),
    };

    let message = '';
    if (xOutOfBounds && yOutOfBounds) {
      message = `Outside canvas! Max size is X ±${xMax.toLocaleString()}, Y ±${yMax.toLocaleString()}`;
    } else if (xOutOfBounds) {
      message = `Outside canvas! Max X size is ±${xMax.toLocaleString()}`;
    } else {
      message = `Outside canvas! Max Y size is ±${yMax.toLocaleString()}`;
    }

    return {
      status: 'out_of_bounds',
      message,
      xOutOfBounds,
      yOutOfBounds,
      clampedPoint,
    };
  }

  return {
    status: 'valid',
    point: { x, y },
  };
}

/**
 * Parse free-form user input such as "1245, -782", "1245 -782", "@1245,-782" or "(1,2)".
 * Returns null when the text is not a valid in-range coordinate.
 */
export function parseCoordinateInput(input: string): WorldPoint | null {
  const result = validateCoordinateInput(input);
  return result.status === 'valid' ? result.point : null;
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
