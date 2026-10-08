import { Graphics } from 'pixi.js';
import type { CoordinateMarkerData } from './decorationTypes';

/**
 * Generates technical coordinate markers for a chunk at quadrant nodes.
 */
export function generateChunkCoordinateMarkers(
  minX: number,
  minY: number,
  size: number,
  chunkX: number,
  chunkY: number,
): CoordinateMarkerData[] {
  const markers: CoordinateMarkerData[] = [];

  // Corner quadrant marker
  const cx = minX + size * 0.15;
  const cy = minY + size * 0.85;
  markers.push({
    x: cx,
    y: cy,
    label: `SEC ${chunkX >= 0 ? '+' : ''}${chunkX},${chunkY >= 0 ? '+' : ''}${chunkY}`,
  });

  return markers;
}

/**
 * Renders technical vector ticks and corner brackets for coordinate markers.
 */
export function renderCoordinateTicksToGraphics(g: Graphics, markers: CoordinateMarkerData[]): void {
  for (const m of markers) {
    const x = m.x;
    const y = -m.y;
    const size = 300; // world units

    // Corner targeting brackets
    const arm = size * 0.4;
    g.moveTo(x - size, y - size + arm).lineTo(x - size, y - size).lineTo(x - size + arm, y - size);
    g.moveTo(x + size, y - size + arm).lineTo(x + size, y - size).lineTo(x + size - arm, y - size);
    g.moveTo(x - size, y + size - arm).lineTo(x - size, y + size).lineTo(x - size + arm, y + size);
    g.moveTo(x + size, y + size - arm).lineTo(x + size, y + size).lineTo(x + size - arm, y + size);
    g.stroke({ width: 0.9, color: 0xffffff, alpha: 0.22 });

    // Center targeting crosshair
    g.moveTo(x - arm * 0.5, y).lineTo(x + arm * 0.5, y);
    g.moveTo(x, y - arm * 0.5).lineTo(x, y + arm * 0.5);
    g.stroke({ width: 0.75, color: 0x38bdf8, alpha: 0.35 });
  }
}
