import { Graphics } from 'pixi.js';
import type { FloatingStructureData } from './decorationTypes';

const STRUCTURE_TYPES: Array<FloatingStructureData['type']> = ['station', 'platform', 'satellite'];

/**
 * Generates geometric floating structures (stations, platforms, satellites) in a chunk.
 */
export function generateChunkStructures(
  minX: number,
  minY: number,
  size: number,
  prng: { range: (a: number, b: number) => number; chance: (p: number) => boolean; intRange: (a: number, b: number) => number; choice: <T>(arr: readonly T[]) => T },
): FloatingStructureData[] {
  const structures: FloatingStructureData[] = [];
  // 35% chance of structures in a chunk
  if (!prng.chance(0.35)) return structures;

  const count = prng.intRange(1, 3);
  for (let i = 0; i < count; i++) {
    structures.push({
      x: prng.range(minX + size * 0.15, minX + size * 0.85),
      y: prng.range(minY + size * 0.15, minY + size * 0.85),
      size: prng.range(350, 950), // world units
      rotation: prng.range(0, Math.PI * 2),
      type: prng.choice(STRUCTURE_TYPES),
    });
  }

  return structures;
}

/**
 * Renders technical vector floating structures (orbital platforms, satellites).
 */
export function renderStructuresToGraphics(g: Graphics, structures: FloatingStructureData[], zoom: number): void {
  for (const s of structures) {
    const { x, size, rotation, type } = s;
    const y = -s.y;
    // Scale slightly for readability
    const sz = Math.max(size * 0.5, Math.min(size, 14 / zoom));

    switch (type) {
      case 'station': {
        // Hexagonal orbital station with docking bays and solar mast
        const r = sz * 0.7;
        for (let i = 0; i < 6; i++) {
          const a = rotation + (Math.PI / 3) * i;
          const px = x + Math.cos(a) * r;
          const py = y + Math.sin(a) * r;
          if (i === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke({ width: 1, color: 0xffffff, alpha: 0.28 });
        g.fill({ color: 0x030712, alpha: 0.65 });

        // Core beacon
        g.circle(x, y, r * 0.3);
        g.stroke({ width: 0.8, color: 0x38bdf8, alpha: 0.5 });
        g.circle(x, y, 1.5);
        g.fill({ color: 0xffffff, alpha: 0.9 });
        break;
      }
      case 'platform': {
        // Modular rectangular spatial platform with corner brackets
        const hw = sz * 0.8;
        const hh = sz * 0.4;
        g.rect(x - hw, y - hh, hw * 2, hh * 2);
        g.stroke({ width: 0.9, color: 0x38bdf8, alpha: 0.22 });
        g.fill({ color: 0x020617, alpha: 0.5 });

        // Corner registration marks
        const cl = sz * 0.2;
        g.moveTo(x - hw, y - hh + cl).lineTo(x - hw, y - hh).lineTo(x - hw + cl, y - hh);
        g.moveTo(x + hw, y - hh + cl).lineTo(x + hw, y - hh).lineTo(x + hw - cl, y - hh);
        g.stroke({ width: 1.2, color: 0xffffff, alpha: 0.45 });
        break;
      }
      case 'satellite': {
        // Crosshair sensor satellite with dual solar wing panels
        const wing = sz * 0.9;
        g.moveTo(x - wing, y).lineTo(x + wing, y);
        g.moveTo(x, y - sz * 0.4).lineTo(x, y + sz * 0.4);
        g.stroke({ width: 0.9, color: 0xffffff, alpha: 0.35 });

        // Wings
        g.rect(x - wing, y - sz * 0.2, wing * 0.45, sz * 0.4);
        g.rect(x + wing * 0.55, y - sz * 0.2, wing * 0.45, sz * 0.4);
        g.stroke({ width: 0.75, color: 0x38bdf8, alpha: 0.3 });
        break;
      }
    }
  }
}
