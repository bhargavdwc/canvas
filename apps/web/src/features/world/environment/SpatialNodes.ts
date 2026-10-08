import { Graphics } from 'pixi.js';
import type { SpatialNodeData } from './decorationTypes';

const SHAPES: Array<SpatialNodeData['shape']> = ['diamond', 'crosshair', 'circle', 'hexagon'];

/**
 * Generates technical spatial nodes in a chunk.
 */
export function generateChunkSpatialNodes(
  minX: number,
  minY: number,
  size: number,
  prng: { range: (a: number, b: number) => number; chance: (p: number) => boolean; intRange: (a: number, b: number) => number; choice: <T>(arr: readonly T[]) => T },
): SpatialNodeData[] {
  const nodes: SpatialNodeData[] = [];
  const count = prng.intRange(4, 9);

  for (let i = 0; i < count; i++) {
    nodes.push({
      x: prng.range(minX + size * 0.08, minX + size * 0.92),
      y: prng.range(minY + size * 0.08, minY + size * 0.92),
      size: prng.range(120, 340), // world units
      shape: prng.choice(SHAPES),
      hasBeacon: prng.chance(0.35),
    });
  }

  return nodes;
}

/**
 * Renders spatial technical nodes (diamonds, crosshairs, hexagons) in clean white/cyan vectors.
 */
export function renderSpatialNodesToGraphics(g: Graphics, nodes: SpatialNodeData[], zoom: number): void {
  for (const node of nodes) {
    const { x, size, shape, hasBeacon } = node;
    const y = -node.y; // Invert for Pixi world space
    // Ensure nodes remain visible across deep zoom without overwhelming the screen
    const s = Math.max(size * 0.4, Math.min(size, 8 / zoom));

    switch (shape) {
      case 'diamond': {
        g.moveTo(x, y - s)
          .lineTo(x + s, y)
          .lineTo(x, y + s)
          .lineTo(x - s, y)
          .closePath();
        g.stroke({ width: 1, color: 0xffffff, alpha: 0.25 });
        g.circle(x, y, s * 0.25);
        g.fill({ color: 0x38bdf8, alpha: 0.4 });
        break;
      }
      case 'crosshair': {
        const arm = s * 1.2;
        g.moveTo(x - arm, y).lineTo(x + arm, y);
        g.moveTo(x, y - arm).lineTo(x, y + arm);
        g.circle(x, y, s * 0.6);
        g.stroke({ width: 0.9, color: 0xffffff, alpha: 0.22 });
        break;
      }
      case 'hexagon': {
        const r = s;
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i;
          const px = x + Math.cos(angle) * r;
          const py = y + Math.sin(angle) * r;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke({ width: 0.85, color: 0x38bdf8, alpha: 0.20 });
        break;
      }
      case 'circle': {
        g.circle(x, y, s * 0.8);
        g.stroke({ width: 0.9, color: 0xffffff, alpha: 0.18 });
        // Concentric dotted inner ring
        g.circle(x, y, s * 0.35);
        g.stroke({ width: 0.75, color: 0x38bdf8, alpha: 0.35 });
        break;
      }
    }

    if (hasBeacon) {
      g.circle(x, y, Math.max(1, s * 0.15));
      g.fill({ color: 0xffffff, alpha: 0.85 });
    }
  }
}
