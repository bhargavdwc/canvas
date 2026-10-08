import { Graphics } from 'pixi.js';
import type { OrbitalRingData } from './decorationTypes';

/**
 * Generates rare, technical orbital radar rings in a chunk.
 */
export function generateChunkOrbitalRings(
  minX: number,
  minY: number,
  size: number,
  prng: { range: (a: number, b: number) => number; chance: (p: number) => boolean; intRange: (a: number, b: number) => number },
): OrbitalRingData[] {
  const rings: OrbitalRingData[] = [];
  // Only 22% of chunks contain an orbital structure
  if (!prng.chance(0.22)) return rings;

  const cx = prng.range(minX + size * 0.25, minX + size * 0.75);
  const cy = prng.range(minY + size * 0.25, minY + size * 0.75);
  const radius = prng.range(size * 0.12, size * 0.32);
  const secondaryRadius = prng.chance(0.7) ? radius * prng.range(0.35, 0.65) : undefined;

  const nodeCount = prng.intRange(3, 6);
  const nodeAngles: number[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodeAngles.push((Math.PI * 2 * i) / nodeCount + prng.range(-0.15, 0.15));
  }

  rings.push({
    cx,
    cy,
    radius,
    secondaryRadius,
    rotation: prng.range(0, Math.PI),
    nodeAngles,
  });

  return rings;
}

/**
 * Renders technical orbital radar rings (thin white/cyan vectors).
 */
export function renderOrbitalRingsToGraphics(g: Graphics, rings: OrbitalRingData[], zoom: number): void {
  for (const ring of rings) {
    const { cx, cy, radius, secondaryRadius, nodeAngles } = ring;
    const ny = -cy; // Invert for Pixi world coordinates

    // Outer primary circle (thin, elegant technical vector)
    g.circle(cx, ny, radius);
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.18 });

    // Inner concentric circle
    if (secondaryRadius) {
      g.circle(cx, ny, secondaryRadius);
      g.stroke({ width: 0.8, color: 0x38bdf8, alpha: 0.14 });
    }

    // Radial axis crosshairs
    const armLen = radius * 1.15;
    g.moveTo(cx - armLen, ny).lineTo(cx + armLen, ny);
    g.moveTo(cx, ny - armLen).lineTo(cx, ny + armLen);
    g.stroke({ width: 0.75, color: 0xffffff, alpha: 0.10 });

    // Orbital nodes along perimeter
    for (const angle of nodeAngles) {
      const nx = cx + Math.cos(angle) * radius;
      const nPos = ny + Math.sin(angle) * radius;

      // Small diamond node
      const d = Math.max(2, 4 / Math.sqrt(zoom));
      g.moveTo(nx, nPos - d)
        .lineTo(nx + d, nPos)
        .lineTo(nx, nPos + d)
        .lineTo(nx - d, nPos)
        .closePath();
      g.stroke({ width: 1, color: 0x38bdf8, alpha: 0.45 });
      g.fill({ color: 0x082f49, alpha: 0.6 });

      // Node beacon core
      g.circle(nx, nPos, Math.max(1, d * 0.35));
      g.fill({ color: 0xffffff, alpha: 0.85 });
    }
  }
}
