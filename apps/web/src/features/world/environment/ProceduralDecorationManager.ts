import { Container } from 'pixi.js';
import type { WorldBounds } from '@canvas/shared-types';
import type { Camera, Size } from '../utils/coordinates';
import { getViewportBounds } from '../utils/viewport';
import {
  DECORATION_CHUNK_SIZE,
  DEFAULT_ENVIRONMENT_TOGGLES,
  type EnvironmentLayerToggles,
  type EnvironmentLOD,
  type EnvironmentStats,
} from './decorationTypes';
import { DecorationChunk } from './DecorationChunk';

const MAX_CACHED_CHUNKS = 48;
const PREFETCH_MARGIN_CHUNKS = 1;

/**
 * Orchestrates procedural chunk generation, viewport culling, multi-scale LOD,
 * caching, and telemetry for the infinite code-generated environment.
 */
export class ProceduralDecorationManager {
  readonly container = new Container();

  private readonly activeChunks = new Map<string, DecorationChunk>();
  private readonly chunkCache = new Map<string, DecorationChunk>();
  private toggles: EnvironmentLayerToggles = { ...DEFAULT_ENVIRONMENT_TOGGLES };

  private currentLOD: EnvironmentLOD = 0;
  private dirty = true;
  private destroyed = false;

  getToggles(): EnvironmentLayerToggles {
    return { ...this.toggles };
  }

  setToggle<K extends keyof EnvironmentLayerToggles>(key: K, value: boolean): void {
    if (this.toggles[key] !== value) {
      this.toggles[key] = value;
      this.dirty = true;
    }
  }

  setAllToggles(toggles: Partial<EnvironmentLayerToggles>): void {
    this.toggles = { ...this.toggles, ...toggles };
    this.dirty = true;
  }

  /**
   * Calculates environment LOD based on camera zoom.
   */
  calculateLOD(zoom: number): EnvironmentLOD {
    if (zoom < 0.06) return 0; // 2% overview
    if (zoom < 0.35) return 1; // 10% - 25% regional
    if (zoom < 1.2) return 2;  // 50% - 100% detailed
    return 3;                  // 200% - 400% high-zoom
  }

  needsFrame(): boolean {
    return this.dirty;
  }

  update(camera: Camera, size: Size): void {
    if (this.destroyed || size.width === 0 || size.height === 0) return;

    this.dirty = false;
    this.currentLOD = this.calculateLOD(camera.zoom);

    // Viewport with 1-chunk prefetch margin in world space
    const viewport: WorldBounds = getViewportBounds(camera, size);
    const margin = PREFETCH_MARGIN_CHUNKS * DECORATION_CHUNK_SIZE;

    const minX = viewport.minX - margin;
    const maxX = viewport.maxX + margin;
    const minY = viewport.minY - margin;
    const maxY = viewport.maxY + margin;

    const minCx = Math.floor((minX + DECORATION_CHUNK_SIZE / 2) / DECORATION_CHUNK_SIZE);
    const maxCx = Math.floor((maxX + DECORATION_CHUNK_SIZE / 2) / DECORATION_CHUNK_SIZE);
    const minCy = Math.floor((minY + DECORATION_CHUNK_SIZE / 2) / DECORATION_CHUNK_SIZE);
    const maxCy = Math.floor((maxY + DECORATION_CHUNK_SIZE / 2) / DECORATION_CHUNK_SIZE);

    const neededKeys = new Set<string>();

    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const key = `${cx}_${cy}`;
        neededKeys.add(key);

        let chunk = this.activeChunks.get(key);
        if (!chunk) {
          // Check LRU cache first
          chunk = this.chunkCache.get(key);
          if (!chunk) {
            chunk = new DecorationChunk(cx, cy);
            this.chunkCache.set(key, chunk);
          }
          this.activeChunks.set(key, chunk);
          this.container.addChild(chunk.container);
        }

        chunk.update(this.currentLOD, camera.zoom, this.toggles);
      }
    }

    // Unload chunks that drifted out of viewport + prefetch margin
    for (const [key, chunk] of this.activeChunks.entries()) {
      if (!neededKeys.has(key)) {
        this.container.removeChild(chunk.container);
        this.activeChunks.delete(key);
      }
    }

    // Evict oldest cached chunks if exceeding cache limit
    if (this.chunkCache.size > MAX_CACHED_CHUNKS) {
      for (const [key, chunk] of this.chunkCache.entries()) {
        if (this.chunkCache.size <= MAX_CACHED_CHUNKS) break;
        if (!this.activeChunks.has(key)) {
          chunk.destroy();
          this.chunkCache.delete(key);
        }
      }
    }
  }

  getStats(): EnvironmentStats {
    let starsCount = 0;
    let nodesCount = 0;
    let ringsCount = 0;
    let planetsCount = 0;
    let pathsCount = 0;

    for (const chunk of this.activeChunks.values()) {
      if (this.toggles.stars) starsCount += chunk.data.stars.length;
      if (this.toggles.nodes) nodesCount += chunk.data.nodes.length;
      if (this.toggles.rings) ringsCount += chunk.data.rings.length;
      if (this.toggles.planets) planetsCount += chunk.data.planets.length;
      if (this.toggles.paths) pathsCount += chunk.data.paths.length;
    }

    return {
      visibleChunksCount: this.activeChunks.size,
      cachedChunksCount: this.chunkCache.size,
      starsCount,
      nodesCount,
      ringsCount,
      planetsCount,
      pathsCount,
      lod: this.currentLOD,
    };
  }

  destroy(): void {
    this.destroyed = true;
    for (const chunk of this.chunkCache.values()) {
      chunk.destroy();
    }
    this.activeChunks.clear();
    this.chunkCache.clear();
    this.container.destroy({ children: true });
  }
}
