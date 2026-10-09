import { Container, Graphics } from 'pixi.js';
import type { Camera, Size } from '../utils/coordinates';
import { getViewportBounds } from '../utils/viewport';
import { projectGeoToWorld } from './projection';
import { DEFAULT_MAP_CONFIG, type MapConfig } from './MapConfig';
import { TileManager, type TileKey } from './TileManager';
import { TileCache } from './TileCache';
import { TileLoader, type VectorTileData } from './TileLoader';
import { PopulatedPlacesManager } from './PopulatedPlacesManager';
import overviewMapData from './worldMapData.json';

interface CachedGraphic {
  graphics: Graphics;
  key: string;
  projectedLines: Float32Array[];
  renderedZoom: number;
}

/**
 * Multi-Level Geographic Map Level-of-Detail (LOD) Manager.
 *
 * Coordinates:
 * - LOD 0: Global World Overview (Natural Earth 1:110m)
 * - LOD 1: Detailed Country Boundaries & Islands (Natural Earth 1:50m)
 * - LOD 2: States & Provinces - Admin 1 (Natural Earth 1:10m Admin 1, Spatially Tiled)
 * - LOD 3: District & Municipal Boundaries - Admin 2 (Spatially Tiled)
 * - LOD 4: Street & Road Network (Spatially Tiled)
 *
 * Implements pre-projected geometry, fast bevel-join tessellation, off-screen culling,
 * hysteresis to prevent flickering, and bounded LRU caching for lag-free 60+ FPS rendering.
 */
export class MapLodManager {
  readonly container = new Container();

  private config: MapConfig;
  private destroyed = false;

  // Nested layer for line geometry transformed in world-coordinate space
  private worldLayer = new Container();

  // Sub-containers for each detail layer
  private overviewContainer = new Container();
  private countryContainer = new Container();
  private stateContainer = new Container();
  private districtContainer = new Container();
  private streetContainer = new Container();

  // Populated places (city/town points and labels) rendered directly in screen space
  private placesManager: PopulatedPlacesManager;

  // Overview pre-projected geometry
  private overviewCoastlines: Float32Array[] = [];
  private overviewBorders: Float32Array[] = [];
  private overviewGraphics = new Graphics();
  private overviewRenderedZoom = 0;

  // LOD 1 Country Detail graphics
  private countryGraphics = new Graphics();
  private countryWorldLines: Float32Array[] | null = null;
  private countryRenderedZoom = 0;
  private isCountryLoaded = false;
  private isCountryLoading = false;

  // Tiled loaders and LRU caches for detailed levels
  private tileLoader: TileLoader;
  private stateCache: TileCache<CachedGraphic>;
  private districtCache: TileCache<CachedGraphic>;
  private streetCache: TileCache<CachedGraphic>;

  private activeLods = new Set<string>();

  constructor(config: MapConfig = DEFAULT_MAP_CONFIG) {
    this.config = config;
    this.container.eventMode = 'none';
    this.worldLayer.eventMode = 'none';

    this.container.addChild(this.worldLayer);

    // Configure individual boundary containers
    const childContainers = [
      this.overviewContainer,
      this.countryContainer,
      this.stateContainer,
      this.districtContainer,
      this.streetContainer,
    ];

    for (const c of childContainers) {
      c.eventMode = 'none';
      this.worldLayer.addChild(c);
    }

    this.overviewContainer.addChild(this.overviewGraphics);
    this.countryContainer.addChild(this.countryGraphics);

    // Initialize Populated Places manager
    this.placesManager = new PopulatedPlacesManager(this.config);
    this.container.addChild(this.placesManager.container);

    // Initialize tile loader and caches with eviction callbacks
    this.tileLoader = new TileLoader(this.config.tileUrlTemplate, this.config.requestTimeoutMs);

    this.stateCache = new TileCache<CachedGraphic>(
      this.config.maxCachedTiles,
      (_key, item) => {
        if (item?.graphics) {
          this.stateContainer.removeChild(item.graphics);
          item.graphics.destroy();
        }
      }
    );

    this.districtCache = new TileCache<CachedGraphic>(
      this.config.maxCachedTiles,
      (_key, item) => {
        if (item?.graphics) {
          this.districtContainer.removeChild(item.graphics);
          item.graphics.destroy();
        }
      }
    );

    this.streetCache = new TileCache<CachedGraphic>(
      this.config.maxCachedTiles,
      (_key, item) => {
        if (item?.graphics) {
          this.streetContainer.removeChild(item.graphics);
          item.graphics.destroy();
        }
      }
    );

    // Precompute overview world coordinates once on initialization
    this.initOverviewGeometry();
    this.buildOverviewGeometry();
    this.loadCountryDetail();
  }

  /**
   * Pre-projects overview geographic coordinates to canvas world coordinates.
   */
  private initOverviewGeometry(): void {
    const rawCoastlines = overviewMapData.coastlines as number[][];
    this.overviewCoastlines = rawCoastlines.map((poly) => {
      const arr = new Float32Array(poly.length);
      for (let i = 0; i < poly.length; i += 2) {
        const pt = projectGeoToWorld(poly[i]!, poly[i + 1]!);
        arr[i] = pt.x;
        arr[i + 1] = -pt.y;
      }
      return arr;
    });

    const rawBorders = overviewMapData.borders as number[][];
    this.overviewBorders = rawBorders.map((poly) => {
      const arr = new Float32Array(poly.length);
      for (let i = 0; i < poly.length; i += 2) {
        const pt = projectGeoToWorld(poly[i]!, poly[i + 1]!);
        arr[i] = pt.x;
        arr[i + 1] = -pt.y;
      }
      return arr;
    });
  }

  /**
   * Helper to draw pre-projected polylines into a Graphics instance with fast bevel joins.
   */
  private drawProjectedLines(
    g: Graphics,
    lines: Float32Array[],
    style: { width: number; color: number; alpha: number },
    join: 'bevel' | 'miter' | 'round' = 'bevel',
    cap: 'round' | 'butt' = 'round'
  ): void {
    g.clear();
    for (let p = 0; p < lines.length; p++) {
      const poly = lines[p];
      if (!poly || poly.length < 4) continue;
      g.moveTo(poly[0]!, poly[1]!);
      for (let i = 2; i < poly.length; i += 2) {
        g.lineTo(poly[i]!, poly[i + 1]!);
      }
    }
    g.stroke({
      width: style.width,
      color: style.color,
      alpha: style.alpha,
      join,
      cap,
    });
  }

  /**
   * Builds static geometry for LOD 0 (World Overview) with screen-proportional crisp line widths.
   */
  private buildOverviewGeometry(zoom: number = 0.001): void {
    if (this.destroyed) return;
    this.overviewGraphics.clear();

    const g = this.overviewGraphics;
    const lod0 = this.config.lods.lod0;

    const coastWidth = Math.max(30, (lod0.style.pixelWidth ?? 1.20) / zoom);
    const borderWidth = Math.max(20, (lod0.secondaryStyle?.pixelWidth ?? 0.85) / zoom);

    // 1. Coastlines
    for (let p = 0; p < this.overviewCoastlines.length; p++) {
      const poly = this.overviewCoastlines[p];
      if (!poly || poly.length < 4) continue;
      g.moveTo(poly[0]!, poly[1]!);
      for (let i = 2; i < poly.length; i += 2) {
        g.lineTo(poly[i]!, poly[i + 1]!);
      }
    }
    g.stroke({
      width: coastWidth,
      color: lod0.style.color,
      alpha: lod0.style.alpha,
      join: 'bevel',
      cap: 'round',
    });

    // 2. National Borders
    if (lod0.secondaryStyle) {
      for (let p = 0; p < this.overviewBorders.length; p++) {
        const poly = this.overviewBorders[p];
        if (!poly || poly.length < 4) continue;
        g.moveTo(poly[0]!, poly[1]!);
        for (let i = 2; i < poly.length; i += 2) {
          g.lineTo(poly[i]!, poly[i + 1]!);
        }
      }
      g.stroke({
        width: borderWidth,
        color: lod0.secondaryStyle.color,
        alpha: lod0.secondaryStyle.alpha,
        join: 'bevel',
        cap: 'round',
      });
    }

    this.overviewRenderedZoom = zoom;
  }

  /**
   * Lazily loads LOD 1 (Detailed Country Boundaries).
   */
  private loadCountryDetail(): void {
    if (this.isCountryLoaded || this.isCountryLoading || this.destroyed) return;
    this.isCountryLoading = true;

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL('/map/lod1/countries.json', baseUrl).toString();

    fetch(url)
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<number[][]>;
      })
      .then((lines) => {
        if (!lines || this.destroyed) return;

        // Pre-project all country lines once on load
        this.countryWorldLines = lines.map((poly) => {
          const arr = new Float32Array(poly.length);
          for (let i = 0; i < poly.length; i += 2) {
            const pt = projectGeoToWorld(poly[i]!, poly[i + 1]!);
            arr[i] = pt.x;
            arr[i + 1] = -pt.y;
          }
          return arr;
        });

        this.isCountryLoaded = true;
      })
      .catch((err) => {
        console.warn('LOD 1 country detail not available, falling back to overview', err);
      })
      .finally(() => {
        this.isCountryLoading = false;
      });
  }

  /**
   * Calculates smooth opacity for an LOD level with ease-in / plateau (100%) / ease-out and hysteresis.
   */
  private calculateLodAlpha(
    zoom: number,
    conf: {
      minZoom: number;
      maxZoom: number;
      fadeInEnd?: number;
      fadeOutStart?: number;
      fadeOutEnd?: number;
      fadeStart: number;
      fadeEnd: number;
    },
    lodKey: string
  ): number {
    const minZ = conf.minZoom;
    const maxZ = conf.maxZoom;
    const fadeInEnd = conf.fadeInEnd ?? conf.fadeStart;
    const fadeOutStart = conf.fadeOutStart ?? conf.fadeStart;
    const fadeOutEnd = conf.fadeOutEnd ?? conf.fadeEnd ?? conf.maxZoom;

    const isCurrentlyActive = this.activeLods.has(lodKey);
    const h = this.config.hysteresis;

    // Apply hysteresis threshold expansion if already active
    const effectiveMin = isCurrentlyActive ? minZ * (1 - h) : minZ;
    const effectiveMax = isCurrentlyActive ? maxZ * (1 + h) : maxZ;

    if (zoom < effectiveMin || zoom > effectiveMax) {
      this.activeLods.delete(lodKey);
      return 0;
    }

    this.activeLods.add(lodKey);

    // 1. Fade-in zone (at low end)
    if (zoom < fadeInEnd) {
      if (fadeInEnd <= minZ) return 1;
      const progress = Math.max(0, Math.min(1, (zoom - minZ) / (fadeInEnd - minZ)));
      return progress * (2 - progress);
    }

    // 2. Plateau zone: FULL 100% OPACITY (NO GAPS!)
    if (zoom <= fadeOutStart) {
      return 1;
    }

    // 3. Fade-out zone (at high end)
    if (zoom < fadeOutEnd) {
      if (fadeOutEnd <= fadeOutStart) return 0;
      const progress = Math.max(0, Math.min(1, (zoom - fadeOutStart) / (fadeOutEnd - fadeOutStart)));
      return Math.max(0, 1 - progress * progress);
    }

    return 0;
  }

  /**
   * Loads and renders vector tiles for a given tiled layer (LOD 2, LOD 3, or LOD 4).
   * Dynamically calculates world stroke width from target on-screen pixel width so lines
   * are ALWAYS thin, crisp, and never bloat into thick bands when zooming.
   */
  private updateTiledLayer(
    _lod: 'lod2' | 'lod3' | 'lod4',
    container: Container,
    cache: TileCache<CachedGraphic>,
    tiles: TileKey[],
    style: { width: number; pixelWidth?: number; color: number; alpha: number },
    layerAlpha: number,
    zoom: number
  ): void {
    if (layerAlpha <= 0 || tiles.length === 0) {
      container.visible = false;
      return;
    }

    container.visible = true;
    container.alpha = layerAlpha;

    const neededKeys = new Set<string>();
    const targetPx = style.pixelWidth ?? 1.0;
    const currentWorldWidth = Math.max(6, targetPx / zoom);

    for (const t of tiles) {
      const key = TileManager.formatKey(t.lod, t.tx, t.ty);
      neededKeys.add(key);

      const cached = cache.get(key);
      if (cached) {
        cached.graphics.visible = true;
        // Re-stroke when zoom has drifted by more than 35%
        if (Math.abs(zoom - cached.renderedZoom) / cached.renderedZoom > 0.35) {
          this.drawProjectedLines(
            cached.graphics,
            cached.projectedLines,
            {
              width: currentWorldWidth,
              color: style.color,
              alpha: style.alpha,
            },
            'bevel',
            'round'
          );
          cached.renderedZoom = zoom;
        }
        continue;
      }

      // Request tile asynchronously if not cached
      void this.tileLoader.loadTile(t.lod, t.tx, t.ty).then((tileData: VectorTileData | null) => {
        if (!tileData || this.destroyed || !neededKeys.has(key)) return;

        const projectedLines = tileData.lines.map((poly) => {
          const arr = new Float32Array(poly.length);
          for (let i = 0; i < poly.length; i += 2) {
            const pt = projectGeoToWorld(poly[i]!, poly[i + 1]!);
            arr[i] = pt.x;
            arr[i + 1] = -pt.y;
          }
          return arr;
        });

        const g = new Graphics();
        this.drawProjectedLines(
          g,
          projectedLines,
          {
            width: currentWorldWidth,
            color: style.color,
            alpha: style.alpha,
          },
          'bevel',
          'round'
        );

        container.addChild(g);
        cache.set(key, { graphics: g, key, projectedLines, renderedZoom: zoom });
      });
    }

    // Hide any cached tiles that are currently outside viewport
    for (const [key, cached] of cache.entries()) {
      cached.graphics.visible = neededKeys.has(key);
    }

    // Cancel in-flight requests that are outside visible bounds
    this.tileLoader.cancelObsolete(neededKeys);
  }

  /**
   * Main per-frame update called by WorldRenderer.
   */
  update(camera: Camera, size: Size): void {
    if (this.destroyed || !this.config.enabled) {
      this.container.visible = false;
      return;
    }

    // Complete cutoff above 8% zoom where note cards and editing take priority
    if (camera.zoom >= this.config.lods.lod4.fadeEnd) {
      this.container.visible = false;
      return;
    }

    this.container.visible = true;

    // Apply camera 2D transform to worldLayer container
    this.worldLayer.position.set(size.width / 2, size.height / 2);
    this.worldLayer.scale.set(camera.zoom, camera.zoom);

    // Apply camera offset to child graphics
    this.overviewGraphics.position.set(-camera.x, camera.y);
    this.countryGraphics.position.set(-camera.x, camera.y);
    this.stateContainer.position.set(-camera.x, camera.y);
    this.districtContainer.position.set(-camera.x, camera.y);
    this.streetContainer.position.set(-camera.x, camera.y);

    const zoom = camera.zoom;
    const viewport = getViewportBounds(camera, size);

    // 1. LOD 0: World Overview
    const lod0Conf = this.config.lods.lod0;
    const lod0Alpha = this.config.layers.worldOverview
      ? this.calculateLodAlpha(zoom, lod0Conf, 'lod0')
      : 0;

    if (lod0Alpha > 0.02) {
      if (
        this.overviewRenderedZoom === 0 ||
        Math.abs(zoom - this.overviewRenderedZoom) / this.overviewRenderedZoom > 0.35
      ) {
        this.buildOverviewGeometry(zoom);
      }
    }
    this.overviewContainer.visible = lod0Alpha > 0;
    this.overviewContainer.alpha = lod0Alpha;

    // 2. LOD 1: Country Detail
    const lod1Conf = this.config.lods.lod1;
    const lod1Alpha = this.config.layers.countryDetail
      ? this.calculateLodAlpha(zoom, lod1Conf, 'lod1')
      : 0;

    if (lod1Alpha > 0.02) {
      if (!this.isCountryLoaded && !this.isCountryLoading) {
        this.loadCountryDetail();
      } else if (this.isCountryLoaded && this.countryWorldLines) {
        if (
          this.countryRenderedZoom === 0 ||
          Math.abs(zoom - this.countryRenderedZoom) / this.countryRenderedZoom > 0.35
        ) {
          const targetPx = lod1Conf.style.pixelWidth ?? 1.35;
          const countryWorldWidth = Math.max(10, targetPx / zoom);
          this.drawProjectedLines(
            this.countryGraphics,
            this.countryWorldLines,
            {
              width: countryWorldWidth,
              color: lod1Conf.style.color,
              alpha: lod1Conf.style.alpha,
            },
            'bevel',
            'round'
          );
          this.countryRenderedZoom = zoom;
        }
      }
    }
    this.countryContainer.visible = lod1Alpha > 0 && this.isCountryLoaded;
    this.countryContainer.alpha = lod1Alpha;

    // 3. LOD 2: States & Provinces (Admin 1, Tiled)
    const lod2Conf = this.config.lods.lod2;
    const lod2Alpha = this.config.layers.stateProvinces
      ? this.calculateLodAlpha(zoom, lod2Conf, 'lod2')
      : 0;

    if (lod2Alpha > 0) {
      const stateTiles = TileManager.getIntersectingTiles('lod2', viewport);
      this.updateTiledLayer('lod2', this.stateContainer, this.stateCache, stateTiles, lod2Conf.style, lod2Alpha, zoom);
    } else {
      this.stateContainer.visible = false;
    }

    // 4. LOD 3: District & Municipal Boundaries (Admin 2, Tiled)
    const lod3Conf = this.config.lods.lod3;
    const lod3Alpha = this.config.layers.districtMunicipal
      ? this.calculateLodAlpha(zoom, lod3Conf, 'lod3')
      : 0;

    if (lod3Alpha > 0) {
      const districtTiles = TileManager.getIntersectingTiles('lod3', viewport);
      this.updateTiledLayer('lod3', this.districtContainer, this.districtCache, districtTiles, lod3Conf.style, lod3Alpha, zoom);
    } else {
      this.districtContainer.visible = false;
    }

    // 5. LOD 4: Street & Road Network (Tiled)
    const lod4Conf = this.config.lods.lod4;
    const lod4Alpha = this.config.layers.streetNetwork
      ? this.calculateLodAlpha(zoom, lod4Conf, 'lod4')
      : 0;

    if (lod4Alpha > 0) {
      const streetTiles = TileManager.getIntersectingTiles('lod4', viewport);
      this.updateTiledLayer('lod4', this.streetContainer, this.streetCache, streetTiles, lod4Conf.style, lod4Alpha, zoom);
    } else {
      this.streetContainer.visible = false;
    }

    // 6. Populated Places (City & Town location points with names)
    this.placesManager.update(camera, size);
  }

  /**
   * Cleans up all PixiJS display objects, caches, and in-flight requests.
   */
  destroy(): void {
    this.destroyed = true;
    this.tileLoader.reset();

    this.stateCache.clear();
    this.districtCache.clear();
    this.streetCache.clear();

    this.placesManager.destroy();

    this.countryWorldLines = null;
    this.overviewCoastlines = [];
    this.overviewBorders = [];

    this.overviewGraphics.destroy();
    this.countryGraphics.destroy();

    this.overviewContainer.destroy({ children: true });
    this.countryContainer.destroy({ children: true });
    this.stateContainer.destroy({ children: true });
    this.districtContainer.destroy({ children: true });
    this.streetContainer.destroy({ children: true });

    this.worldLayer.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}
