import { Graphics } from 'pixi.js';
import type { NebulaPatch } from './decorationTypes';

const NEBULA_PALETTE = [
  0x0369a1, // Deep Cyan / Ocean
  0x1e1b4b, // Deep Indigo
  0x312e81, // Cosmic Violet
  0x0284c7, // Luminous Azure
  0x581c87, // Deep Purple
];

/**
 * Generates organic, layered nebula patches for a chunk using the deterministic PRNG.
 */
export function generateChunkNebulae(
  minX: number,
  minY: number,
  size: number,
  prng: { range: (a: number, b: number) => number; next: () => number; chance: (p: number) => boolean; choice: <T>(arr: readonly T[]) => T },
): NebulaPatch[] {
  const patches: NebulaPatch[] = [];
  // 50% chance a chunk contains a distinct nebula formation
  if (!prng.chance(0.55)) return patches;

  const count = Math.floor(prng.range(2, 5));
  const baseCx = prng.range(minX + size * 0.2, minX + size * 0.8);
  const baseCy = prng.range(minY + size * 0.2, minY + size * 0.8);

  for (let i = 0; i < count; i++) {
    const cx = baseCx + prng.range(-size * 0.18, size * 0.18);
    const cy = baseCy + prng.range(-size * 0.18, size * 0.18);
    const rx = prng.range(size * 0.15, size * 0.35);
    const ry = prng.range(size * 0.10, size * 0.25);
    const rotation = prng.range(0, Math.PI);
    const color = prng.choice(NEBULA_PALETTE);
    const alpha = prng.range(0.04, 0.09); // very subtle, non-intrusive

    patches.push({ cx, cy, rx, ry, rotation, color, alpha });
  }

  return patches;
}

/**
 * Renders smooth organic nebula layers onto a Pixi Graphics object.
 */
export function renderNebulaToGraphics(g: Graphics, nebulae: NebulaPatch[]): void {
  for (const n of nebulae) {
    const steps = 4;
    for (let s = steps; s >= 1; s--) {
      const stepRx = (n.rx / steps) * s;
      const stepRy = (n.ry / steps) * s;
      const stepAlpha = (n.alpha / steps) * (steps - s + 1) * 0.7;

      g.ellipse(n.cx, -n.cy, stepRx, stepRy);
      g.fill({ color: n.color, alpha: stepAlpha });
    }
  }
}
