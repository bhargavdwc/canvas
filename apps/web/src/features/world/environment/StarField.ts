import { Graphics } from 'pixi.js';
import type { EnvironmentLOD, StarData } from './decorationTypes';

const STAR_COLORS = [
  0xffffff, // Pure White
  0xbae6fd, // Soft Cyan
  0xe0e7ff, // Ice Blue
  0xfde68a, // Warm Golden
  0xddd6fe, // Light Violet
];

/**
 * Generates deterministic stars for a chunk bounds using the provided PRNG.
 */
export function generateChunkStars(
  minX: number,
  minY: number,
  size: number,
  prng: { range: (a: number, b: number) => number; next: () => number; choice: <T>(arr: readonly T[]) => T },
): StarData[] {
  // Max budget of 700 stars per 65,536 x 65,536 chunk
  const totalStars = 650;
  const stars: StarData[] = [];

  for (let i = 0; i < totalStars; i++) {
    const x = prng.range(minX, minX + size);
    const y = prng.range(minY, minY + size);
    const roll = prng.next();

    let radius: number;
    let alpha: number;
    let isBright = false;

    if (roll > 0.992) {
      // Rare bright star with diffraction spikes
      radius = prng.range(4, 6.5);
      alpha = prng.range(0.85, 1.0);
      isBright = true;
    } else if (roll > 0.94) {
      // Small stellar body
      radius = prng.range(2.5, 4);
      alpha = prng.range(0.65, 0.9);
    } else {
      // Tiny micro star
      radius = prng.range(1.0, 2.2);
      alpha = prng.range(0.25, 0.6);
    }

    const color = prng.choice(STAR_COLORS);
    stars.push({ x, y, radius, color, alpha, isBright });
  }

  return stars;
}

/**
 * Renders stars onto a Pixi Graphics layer filtered by the active LOD level.
 */
export function renderStarsToGraphics(
  g: Graphics,
  stars: StarData[],
  lod: EnvironmentLOD,
  cameraZoom: number,
): void {
  // Budget visible stars based on LOD to guarantee ultra-high performance
  // LOD 0 (zoom 0.02): show 20% brightest stars
  // LOD 1 (zoom 0.1): show 45% stars
  // LOD 2 (zoom 0.5): show 75% stars
  // LOD 3 (zoom 2.0+): show 100% stars
  const fraction = lod === 0 ? 0.22 : lod === 1 ? 0.45 : lod === 2 ? 0.75 : 1.0;
  const limit = Math.floor(stars.length * fraction);

  for (let i = 0; i < limit; i++) {
    const s = stars[i]!;
    // Scale star pixel size slightly with zoom so they remain visible at low zoom without becoming huge
    const r = Math.max(0.8 / cameraZoom, Math.min(s.radius, s.radius * 0.75 + 1.2 / cameraZoom));

    g.circle(s.x, -s.y, r);
    g.fill({ color: s.color, alpha: s.alpha });

    if (s.isBright) {
      // Delicate 4-point crosshair diffraction spike (white vector style)
      const spikeLen = r * 3.5;
      g.moveTo(s.x - spikeLen, -s.y).lineTo(s.x + spikeLen, -s.y);
      g.moveTo(s.x, -s.y - spikeLen).lineTo(s.x, -s.y + spikeLen);
      g.stroke({ width: 0.8, color: 0xffffff, alpha: s.alpha * 0.6 });
    }
  }
}
