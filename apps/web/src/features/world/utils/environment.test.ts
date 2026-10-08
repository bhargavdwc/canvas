import { describe, expect, it } from 'vitest';
import { hash32, hash2DFloat, DeterministicPRNG } from '../environment/decorationSeed';
import { DECORATION_CHUNK_SIZE } from '../environment/decorationTypes';
import { generateChunkStars } from '../environment/StarField';
import { generateChunkNebulae } from '../environment/NebulaLayer';
import { generateChunkOrbitalRings } from '../environment/OrbitalRings';
import { generateChunkSpatialNodes } from '../environment/SpatialNodes';
import { generateChunkPlanets } from '../environment/PlanetDecorations';
import { ProceduralDecorationManager } from '../environment/ProceduralDecorationManager';

describe('Procedural Environment Seed & Hash', () => {
  it('generates 100% deterministic hash values for identical world coordinates', () => {
    const h1 = hash32(1428, 30421);
    const h2 = hash32(1428, 30421);
    expect(h1).toBe(h2);

    const f1 = hash2DFloat(-500_000, 250_000);
    const f2 = hash2DFloat(-500_000, 250_000);
    expect(f1).toBe(f2);
  });

  it('generates different hash values for different world coordinates', () => {
    const h1 = hash32(0, 0);
    const h2 = hash32(100, 0);
    const h3 = hash32(0, 100);
    expect(h1).not.toBe(h2);
    expect(h1).not.toBe(h3);
  });

  it('produces repeatable PRNG sequence from integer seed', () => {
    const prngA = new DeterministicPRNG(12345);
    const prngB = new DeterministicPRNG(12345);

    const seqA = [prngA.next(), prngA.next(), prngA.range(10, 50)];
    const seqB = [prngB.next(), prngB.next(), prngB.range(10, 50)];

    expect(seqA).toEqual(seqB);
  });
});

describe('Procedural StarField Generation', () => {
  it('generates bounded stars with realistic size distributions', () => {
    const prng = new DeterministicPRNG(999);
    const stars = generateChunkStars(0, 0, DECORATION_CHUNK_SIZE, prng);

    expect(stars.length).toBeGreaterThan(500);

    // Stars must stay inside the chunk bounds
    for (const star of stars) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThanOrEqual(DECORATION_CHUNK_SIZE);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThanOrEqual(DECORATION_CHUNK_SIZE);
      expect(star.alpha).toBeGreaterThanOrEqual(0.2);
      expect(star.alpha).toBeLessThanOrEqual(1.0);
    }

    // Rare bright stars must exist in realistic proportions
    const bright = stars.filter((s) => s.isBright);
    expect(bright.length).toBeGreaterThan(0);
    expect(bright.length).toBeLessThan(stars.length * 0.05);
  });
});

describe('Procedural Celestial Formations', () => {
  it('generates rare, deterministic planetary bodies and orbital structures', () => {
    const prng = new DeterministicPRNG(777);
    const planets = generateChunkPlanets(0, 0, DECORATION_CHUNK_SIZE, prng);
    const rings = generateChunkOrbitalRings(0, 0, DECORATION_CHUNK_SIZE, prng);
    const nodes = generateChunkSpatialNodes(0, 0, DECORATION_CHUNK_SIZE, prng);
    const nebulae = generateChunkNebulae(0, 0, DECORATION_CHUNK_SIZE, prng);

    expect(nodes.length).toBeGreaterThan(0);
    expect(nebulae.length).toBeGreaterThan(0);
    // Planets and rings are rare
    expect(planets.length).toBeLessThanOrEqual(1);
    expect(rings.length).toBeLessThanOrEqual(1);
  });
});

describe('ProceduralDecorationManager LOD & Toggles', () => {
  it('calculates monotonic environment LOD across zoom range', () => {
    const mgr = new ProceduralDecorationManager();

    expect(mgr.calculateLOD(0.02)).toBe(0); // 2% overview
    expect(mgr.calculateLOD(0.1)).toBe(1);  // 10%
    expect(mgr.calculateLOD(0.25)).toBe(1); // 25%
    expect(mgr.calculateLOD(0.5)).toBe(2);  // 50%
    expect(mgr.calculateLOD(1.0)).toBe(2);  // 100%
    expect(mgr.calculateLOD(2.0)).toBe(3);  // 200%
    expect(mgr.calculateLOD(4.0)).toBe(3);  // 400%
  });

  it('updates layer toggles cleanly without mutating unexpected fields', () => {
    const mgr = new ProceduralDecorationManager();
    expect(mgr.getToggles().stars).toBe(true);

    mgr.setToggle('stars', false);
    expect(mgr.getToggles().stars).toBe(false);
    expect(mgr.getToggles().nebula).toBe(true);
  });
});
