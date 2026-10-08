import { Container, Graphics } from 'pixi.js';
import type { WorldBounds } from '@canvas/shared-types';
import {
  DECORATION_CHUNK_SIZE,
  type DecorationChunkData,
  type EnvironmentLayerToggles,
  type EnvironmentLOD,
} from './decorationTypes';
import { DeterministicPRNG, hash32 } from './decorationSeed';
import { generateChunkStars, renderStarsToGraphics } from './StarField';
import { generateChunkNebulae, renderNebulaToGraphics } from './NebulaLayer';
import { generateChunkOrbitalRings, renderOrbitalRingsToGraphics } from './OrbitalRings';
import { generateChunkSpatialNodes, renderSpatialNodesToGraphics } from './SpatialNodes';
import { generateChunkConnectionPaths, renderConnectionPathsToGraphics } from './ConnectionPaths';
import { generateChunkPlanets, renderPlanetsToGraphics } from './PlanetDecorations';
import { generateChunkStructures, renderStructuresToGraphics } from './FloatingStructures';
import { generateChunkCoordinateMarkers, renderCoordinateTicksToGraphics } from './CoordinateMarkers';

/**
 * An individual procedural chunk in world coordinates.
 * Generates and caches deterministic vector graphics for its territory.
 */
export class DecorationChunk {
  readonly container = new Container();
  readonly data: DecorationChunkData;
  readonly bounds: WorldBounds;

  private readonly gfxNebula = new Graphics();
  private readonly gfxStars = new Graphics();
  private readonly gfxPaths = new Graphics();
  private readonly gfxRings = new Graphics();
  private readonly gfxPlanets = new Graphics();
  private readonly gfxNodes = new Graphics();
  private readonly gfxStructures = new Graphics();
  private readonly gfxCoordinates = new Graphics();

  private renderedLOD: EnvironmentLOD | null = null;
  private renderedZoom = 0;
  private lastToggles: string = '';

  constructor(
    readonly chunkX: number,
    readonly chunkY: number,
  ) {
    const key = `${chunkX}_${chunkY}`;
    const minX = chunkX * DECORATION_CHUNK_SIZE - DECORATION_CHUNK_SIZE / 2;
    const minY = chunkY * DECORATION_CHUNK_SIZE - DECORATION_CHUNK_SIZE / 2;
    const maxX = minX + DECORATION_CHUNK_SIZE;
    const maxY = minY + DECORATION_CHUNK_SIZE;
    this.bounds = { minX, maxX, minY, maxY };

    const seed = hash32(chunkX, chunkY);
    const prng = new DeterministicPRNG(seed);

    // Deterministically generate all objects for this chunk
    const stars = generateChunkStars(minX, minY, DECORATION_CHUNK_SIZE, prng);
    const nebulae = generateChunkNebulae(minX, minY, DECORATION_CHUNK_SIZE, prng);
    const rings = generateChunkOrbitalRings(minX, minY, DECORATION_CHUNK_SIZE, prng);
    const nodes = generateChunkSpatialNodes(minX, minY, DECORATION_CHUNK_SIZE, prng);
    const paths = generateChunkConnectionPaths(nodes, prng);
    const planets = generateChunkPlanets(minX, minY, DECORATION_CHUNK_SIZE, prng);
    const structures = generateChunkStructures(minX, minY, DECORATION_CHUNK_SIZE, prng);
    const coordinates = generateChunkCoordinateMarkers(minX, minY, DECORATION_CHUNK_SIZE, chunkX, chunkY);

    this.data = {
      chunkX,
      chunkY,
      key,
      seed,
      bounds: this.bounds,
      stars,
      nebulae,
      rings,
      nodes,
      paths,
      planets,
      structures,
      coordinates,
    };

    // Layer ordering from background to foreground
    this.container.addChild(
      this.gfxNebula,
      this.gfxStars,
      this.gfxPaths,
      this.gfxRings,
      this.gfxPlanets,
      this.gfxNodes,
      this.gfxStructures,
      this.gfxCoordinates,
    );
  }

  /**
   * Updates graphics based on current LOD, camera zoom, and layer toggles.
   * Only re-draws when LOD or toggles have changed.
   */
  update(lod: EnvironmentLOD, zoom: number, toggles: EnvironmentLayerToggles): void {
    const togglesKey = JSON.stringify(toggles);
    const zoomChangedSignificantly = Math.abs(zoom - this.renderedZoom) / (this.renderedZoom || 1) > 0.35;

    if (this.renderedLOD === lod && this.lastToggles === togglesKey && !zoomChangedSignificantly) {
      return;
    }

    this.renderedLOD = lod;
    this.renderedZoom = zoom;
    this.lastToggles = togglesKey;

    // Nebula
    this.gfxNebula.clear();
    this.gfxNebula.visible = toggles.nebula;
    if (toggles.nebula && this.data.nebulae.length > 0) {
      renderNebulaToGraphics(this.gfxNebula, this.data.nebulae);
    }

    // Stars
    this.gfxStars.clear();
    this.gfxStars.visible = toggles.stars;
    if (toggles.stars && this.data.stars.length > 0) {
      renderStarsToGraphics(this.gfxStars, this.data.stars, lod, zoom);
    }

    // Paths
    this.gfxPaths.clear();
    this.gfxPaths.visible = toggles.paths;
    if (toggles.paths && this.data.paths.length > 0) {
      renderConnectionPathsToGraphics(this.gfxPaths, this.data.paths);
    }

    // Rings
    this.gfxRings.clear();
    this.gfxRings.visible = toggles.rings;
    if (toggles.rings && this.data.rings.length > 0) {
      renderOrbitalRingsToGraphics(this.gfxRings, this.data.rings, zoom);
    }

    // Planets
    this.gfxPlanets.clear();
    this.gfxPlanets.visible = toggles.planets;
    if (toggles.planets && this.data.planets.length > 0) {
      renderPlanetsToGraphics(this.gfxPlanets, this.data.planets);
    }

    // Nodes
    this.gfxNodes.clear();
    this.gfxNodes.visible = toggles.nodes;
    if (toggles.nodes && this.data.nodes.length > 0) {
      renderSpatialNodesToGraphics(this.gfxNodes, this.data.nodes, zoom);
    }

    // Structures
    this.gfxStructures.clear();
    this.gfxStructures.visible = toggles.structures;
    if (toggles.structures && this.data.structures.length > 0) {
      renderStructuresToGraphics(this.gfxStructures, this.data.structures, zoom);
    }

    // Coordinates
    this.gfxCoordinates.clear();
    this.gfxCoordinates.visible = toggles.coordinates;
    if (toggles.coordinates && this.data.coordinates.length > 0) {
      renderCoordinateTicksToGraphics(this.gfxCoordinates, this.data.coordinates);
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
