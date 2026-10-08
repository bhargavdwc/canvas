import { Graphics } from 'pixi.js';
import type { ConnectionPathData, SpatialNodeData } from './decorationTypes';

/**
 * Creates subtle navigation connection paths between adjacent spatial nodes.
 */
export function generateChunkConnectionPaths(
  nodes: SpatialNodeData[],
  prng: { chance: (p: number) => boolean; intRange: (a: number, b: number) => number },
): ConnectionPathData[] {
  const paths: ConnectionPathData[] = [];
  if (nodes.length < 2) return paths;

  // Connect close neighbors
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);

      // Only connect if distance is between 8,000 and 24,000 units
      if (dist > 6_000 && dist < 24_000 && prng.chance(0.4)) {
        paths.push({
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          isMajor: prng.chance(0.25),
        });
      }
    }
  }

  return paths;
}

/**
 * Renders technical vector connection paths (thin white/cyan vectors).
 */
export function renderConnectionPathsToGraphics(g: Graphics, paths: ConnectionPathData[]): void {
  for (const p of paths) {
    const y1 = -p.y1;
    const y2 = -p.y2;

    g.moveTo(p.x1, y1).lineTo(p.x2, y2);
    if (p.isMajor) {
      g.stroke({ width: 0.9, color: 0x38bdf8, alpha: 0.16 });
      // Midpoint waypoint tick
      const mx = (p.x1 + p.x2) / 2;
      const my = (y1 + y2) / 2;
      g.circle(mx, my, 1.8);
      g.fill({ color: 0xffffff, alpha: 0.4 });
    } else {
      g.stroke({ width: 0.75, color: 0xffffff, alpha: 0.09 });
    }
  }
}
