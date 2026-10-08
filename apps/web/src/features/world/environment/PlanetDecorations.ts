import { Graphics } from 'pixi.js';
import type { PlanetData } from './decorationTypes';

const PLANET_PALETTES = [
  { color: 0x0f172a, atmosphere: 0x38bdf8 }, // Deep Slate & Cyan Atmosphere
  { color: 0x1e1b4b, atmosphere: 0xa855f7 }, // Indigo & Violet Atmosphere
  { color: 0x0c4a6e, atmosphere: 0x22d3ee }, // Cobalt & Azure Atmosphere
  { color: 0x1c1917, atmosphere: 0xf59e0b }, // Dark Basalt & Amber Ring
];

/**
 * Generates rare, elegant vector planets in a chunk.
 */
export function generateChunkPlanets(
  minX: number,
  minY: number,
  size: number,
  prng: { range: (a: number, b: number) => number; chance: (p: number) => boolean; choice: <T>(arr: readonly T[]) => T },
): PlanetData[] {
  const planets: PlanetData[] = [];
  // Only 18% of chunks have a planet (they are rare celestial landmarks)
  if (!prng.chance(0.18)) return planets;

  const pal = prng.choice(PLANET_PALETTES);
  const radius = prng.range(2_200, 5_800);
  const cx = prng.range(minX + radius * 1.5, minX + size - radius * 1.5);
  const cy = prng.range(minY + radius * 1.5, minY + size - radius * 1.5);
  const hasRing = prng.chance(0.65);

  planets.push({
    cx,
    cy,
    radius,
    color: pal.color,
    atmosphereColor: pal.atmosphere,
    hasRing,
    ringRadius: hasRing ? radius * prng.range(1.6, 2.3) : undefined,
    ringTilt: hasRing ? prng.range(0.2, 0.6) : undefined,
  });

  return planets;
}

/**
 * Renders vector planets with atmospheric outline and orbital ring.
 */
export function renderPlanetsToGraphics(g: Graphics, planets: PlanetData[]): void {
  for (const planet of planets) {
    const { cx, radius, color, atmosphereColor, hasRing, ringRadius, ringTilt = 0.35 } = planet;
    const cy = -planet.cy;

    // Atmospheric outer corona
    const glowSteps = 4;
    for (let s = glowSteps; s >= 1; s--) {
      const r = radius + s * (radius * 0.08);
      const alpha = 0.05 * (glowSteps - s + 1);
      g.circle(cx, cy, r);
      g.fill({ color: atmosphereColor, alpha });
    }

    // Planet body
    g.circle(cx, cy, radius);
    g.fill({ color });
    g.stroke({ width: 1.2, color: atmosphereColor, alpha: 0.45 });

    // Subtle crescent terminator / shadow line
    g.circle(cx - radius * 0.15, cy - radius * 0.15, radius * 0.85);
    g.stroke({ width: 0.8, color: 0xffffff, alpha: 0.15 });

    // Planetary Rings (tilted ellipse vector)
    if (hasRing && ringRadius) {
      const rx = ringRadius;
      const ry = ringRadius * ringTilt;
      g.ellipse(cx, cy, rx, ry);
      g.stroke({ width: 1.2, color: 0xffffff, alpha: 0.22 });

      // Secondary thin outer ring
      g.ellipse(cx, cy, rx * 1.15, ry * 1.15);
      g.stroke({ width: 0.75, color: atmosphereColor, alpha: 0.18 });
    }
  }
}
