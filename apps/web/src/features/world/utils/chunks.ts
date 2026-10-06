import { CHUNK_SIZE, type WorldBounds, type WorldPoint } from '@canvas/shared-types';

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export function chunkIndex(value: number): number {
  return Math.floor(value / CHUNK_SIZE);
}

export function chunkOf(point: WorldPoint): ChunkCoord {
  return { cx: chunkIndex(point.x), cy: chunkIndex(point.y) };
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** Inclusive chunk index range covered by `bounds`. */
export function chunkRange(bounds: WorldBounds) {
  return {
    minCx: chunkIndex(bounds.minX),
    maxCx: chunkIndex(bounds.maxX),
    minCy: chunkIndex(bounds.minY),
    maxCy: chunkIndex(bounds.maxY),
  };
}

/** Number of chunks `bounds` touches (cheap guard before enumerating them). */
export function chunkCount(bounds: WorldBounds): number {
  const r = chunkRange(bounds);
  return (r.maxCx - r.minCx + 1) * (r.maxCy - r.minCy + 1);
}

export function chunksInBounds(bounds: WorldBounds): ChunkCoord[] {
  const r = chunkRange(bounds);
  const out: ChunkCoord[] = [];
  for (let cx = r.minCx; cx <= r.maxCx; cx++) {
    for (let cy = r.minCy; cy <= r.maxCy; cy++) {
      out.push({ cx, cy });
    }
  }
  return out;
}
