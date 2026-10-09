import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import type { Camera, Size } from '../utils/coordinates';
import { WORLD_MIN_X, WORLD_MIN_Y } from '../utils/coordinates';
import { getViewportBounds, padBounds } from '../utils/viewport';
import { projectGeoToWorld, SPAN_X, SPAN_Y } from './projection';
import type { MapConfig } from './MapConfig';

export interface PlaceRecord {
  name: string;
  lon: number;
  lat: number;
  rank: number;
  cap: number;
  mega: number;
  country: string;
}

export interface PlaceFeature extends PlaceRecord {
  worldX: number;
  worldY: number;
  category: 'cap' | 'mega' | 'town';
}

const MAX_VISIBLE_LABELS = 36;
const GRID_COLS = 32;
const GRID_ROWS = 16;

const CAPITAL_STYLE = {
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  fontSize: 11,
  fontWeight: '600' as const,
  fill: 0xfef08a,
  stroke: { color: 0x0f172a, width: 2.5 },
};

const MEGA_STYLE = {
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  fontSize: 10,
  fontWeight: '500' as const,
  fill: 0xf8fafc,
  stroke: { color: 0x0f172a, width: 2.5 },
};

const TOWN_STYLE = {
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  fontSize: 9,
  fontWeight: '400' as const,
  fill: 0x94a3b8,
  stroke: { color: 0x0f172a, width: 2.0 },
};

/**
 * High-performance batched manager for Populated Places.
 * Uses 2D spatial grid partitioning, batched marker geometry, and persistent
 * label pooling to guarantee 60+ FPS zero-lag rendering.
 */
export class PopulatedPlacesManager {
  readonly container = new Container();
  private readonly markerGraphics = new Graphics();
  private readonly labelContainer = new Container();

  private places: PlaceFeature[] | null = null;
  private spatialGrid: PlaceFeature[][] = [];
  private isLoading = false;
  private isLoaded = false;
  private destroyed = false;

  // Persistent label cache by place key: avoids re-rasterizing text textures on every frame
  private activeLabels = new Map<string, { label: Text; category: 'cap' | 'mega' | 'town' }>();
  private capitalPool: Text[] = [];
  private megaPool: Text[] = [];
  private townPool: Text[] = [];

  constructor(private readonly config: MapConfig) {
    this.container.eventMode = 'none';
    this.markerGraphics.eventMode = 'none';
    this.labelContainer.eventMode = 'none';

    this.container.addChild(this.markerGraphics);
    this.container.addChild(this.labelContainer);
  }

  /**
   * Lazily loads populated places dataset on demand and indexes into a 2D spatial grid.
   */
  private loadPlaces(): void {
    if (this.isLoaded || this.isLoading || this.destroyed) return;
    this.isLoading = true;

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const url = new URL(this.config.placesUrl, baseUrl).toString();

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching places`);
        return res.json() as Promise<PlaceRecord[]>;
      })
      .then((records) => {
        if (!records || this.destroyed) return;

        // Initialize spatial grid
        const grid: PlaceFeature[][] = Array.from({ length: GRID_COLS * GRID_ROWS }, () => []);

        // Precompute world coordinates and partition into spatial bins
        const features: PlaceFeature[] = records.map((r) => {
          const pt = projectGeoToWorld(r.lon, r.lat);
          const category: 'cap' | 'mega' | 'town' =
            r.cap === 1 ? 'cap' : (r.mega === 1 || r.rank <= 2) ? 'mega' : 'town';
          const feat: PlaceFeature = {
            ...r,
            worldX: pt.x,
            worldY: pt.y,
            category,
          };

          const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(((pt.x - WORLD_MIN_X) / SPAN_X) * GRID_COLS)));
          const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(((pt.y - WORLD_MIN_Y) / SPAN_Y) * GRID_ROWS)));
          grid[row * GRID_COLS + col]!.push(feat);

          return feat;
        });

        this.places = features;
        this.spatialGrid = grid;
        this.isLoaded = true;
      })
      .catch((err) => {
        console.warn('Populated places dataset could not be loaded', err);
      })
      .finally(() => {
        this.isLoading = false;
      });
  }

  /**
   * Calculates smooth alpha curve for populated places layer.
   */
  private calculateAlpha(zoom: number): number {
    const { minZoom, fadeInEnd, fadeOutStart, fadeOutEnd } = this.config.places;

    if (zoom < minZoom || zoom > fadeOutEnd) return 0;
    if (zoom < fadeInEnd) {
      const p = (zoom - minZoom) / (fadeInEnd - minZoom);
      return Math.max(0, Math.min(1, p * (2 - p)));
    }
    if (zoom <= fadeOutStart) {
      return 1;
    }
    const p = (zoom - fadeOutStart) / (fadeOutEnd - fadeOutStart);
    return Math.max(0, 1 - p * p);
  }

  /**
   * Acquires a pooled text label configured for the given style category.
   */
  private acquireLabel(category: 'cap' | 'mega' | 'town'): Text {
    let pool: Text[];
    let styleConfig: TextStyleOptions;

    if (category === 'cap') {
      pool = this.capitalPool;
      styleConfig = CAPITAL_STYLE;
    } else if (category === 'mega') {
      pool = this.megaPool;
      styleConfig = MEGA_STYLE;
    } else {
      pool = this.townPool;
      styleConfig = TOWN_STYLE;
    }

    if (pool.length > 0) {
      const txt = pool.pop()!;
      txt.visible = true;
      return txt;
    }

    const txt = new Text({
      text: '',
      style: styleConfig,
    });
    txt.eventMode = 'none';
    this.labelContainer.addChild(txt);
    return txt;
  }

  /**
   * Updates and draws visible populated places within camera viewport.
   */
  update(camera: Camera, size: Size): void {
    if (this.destroyed || !this.config.enabled || !this.config.layers.populatedPlaces) {
      this.container.visible = false;
      return;
    }

    const zoom = camera.zoom;
    const alpha = this.calculateAlpha(zoom);

    if (alpha <= 0) {
      this.container.visible = false;
      return;
    }

    // Trigger lazy loading when entering active zoom range
    if (!this.isLoaded) {
      this.loadPlaces();
      this.container.visible = false;
      return;
    }

    if (!this.places || this.places.length === 0) {
      this.container.visible = false;
      return;
    }

    this.container.visible = true;
    this.container.alpha = alpha;

    const g = this.markerGraphics;
    g.clear();

    const viewport = padBounds(getViewportBounds(camera, size), 2000);

    // Zoom-level rank threshold:
    // 0.8% - 2.5%: Capitals & Megacities only
    // 2.5% - 5.0%: Major cities (rank <= 5)
    // 5.0% - 8.0%: Regional towns (all ranks)
    const maxRank = zoom < 0.025 ? 2 : zoom < 0.050 ? 5 : 10;
    const capitalsOnly = zoom < 0.018;

    // Determine intersecting spatial grid cells
    const minCol = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(((viewport.minX - WORLD_MIN_X) / SPAN_X) * GRID_COLS)));
    const maxCol = Math.max(0, Math.min(GRID_COLS - 1, Math.floor(((viewport.maxX - WORLD_MIN_X) / SPAN_X) * GRID_COLS)));
    const minRow = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(((viewport.minY - WORLD_MIN_Y) / SPAN_Y) * GRID_ROWS)));
    const maxRow = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(((viewport.maxY - WORLD_MIN_Y) / SPAN_Y) * GRID_ROWS)));

    // Collision grid in screen space (~76px x 22px)
    const occupiedCells = new Set<string>();
    const seenLabelKeys = new Set<string>();

    // Marker batch buffers
    const capPoints: Array<{ x: number; y: number }> = [];
    const megaPoints: Array<{ x: number; y: number }> = [];
    const townPoints: Array<{ x: number; y: number }> = [];

    let activeLabelCount = 0;

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * GRID_COLS;
      for (let c = minCol; c <= maxCol; c++) {
        const cell = this.spatialGrid[rowOffset + c];
        if (!cell || cell.length === 0) continue;

        for (let i = 0; i < cell.length; i++) {
          const p = cell[i]!;

          // 1. Viewport boundary check
          if (
            p.worldX < viewport.minX ||
            p.worldX > viewport.maxX ||
            p.worldY < viewport.minY ||
            p.worldY > viewport.maxY
          ) {
            continue;
          }

          // 2. Importance ranking check
          if (capitalsOnly && p.cap !== 1 && p.mega !== 1) {
            continue;
          }
          if (p.rank > maxRank && p.cap !== 1 && p.mega !== 1) {
            continue;
          }

          // 3. Screen coordinates calculation
          const sx = Math.round((p.worldX - camera.x) * zoom + size.width / 2);
          const sy = Math.round((camera.y - p.worldY) * zoom + size.height / 2);

          if (sx < -20 || sx > size.width + 20 || sy < -20 || sy > size.height + 20) {
            continue;
          }

          // 4. Collision avoidance
          const cellX = Math.floor(sx / 76);
          const cellY = Math.floor(sy / 22);
          const cellKey = `${cellX}_${cellY}`;
          if (occupiedCells.has(cellKey)) {
            continue;
          }
          occupiedCells.add(cellKey);

          // 5. Accumulate marker geometry for batched drawing
          if (p.category === 'cap') {
            capPoints.push({ x: sx, y: sy });
          } else if (p.category === 'mega') {
            megaPoints.push({ x: sx, y: sy });
          } else {
            townPoints.push({ x: sx, y: sy });
          }

          // 6. Label display with persistent pooling (Zero per-frame texture uploads!)
          if (activeLabelCount < MAX_VISIBLE_LABELS) {
            const placeKey = `${p.name}__${p.country}`;
            seenLabelKeys.add(placeKey);

            let entry = this.activeLabels.get(placeKey);
            if (!entry) {
              const label = this.acquireLabel(p.category);
              if (label.text !== p.name) {
                label.text = p.name;
              }
              entry = { label, category: p.category };
              this.activeLabels.set(placeKey, entry);
            }

            entry.label.position.set(sx + 7, sy - 6);
            activeLabelCount++;
          }
        }
      }
    }

    // 7. Flush batched marker geometry (Only 5 GPU draw calls instead of hundreds)
    if (townPoints.length > 0) {
      for (let i = 0; i < townPoints.length; i++) {
        g.circle(townPoints[i]!.x, townPoints[i]!.y, 1.8);
      }
      g.fill({ color: 0x94a3b8, alpha: 0.75 });
    }

    if (megaPoints.length > 0) {
      for (let i = 0; i < megaPoints.length; i++) {
        g.circle(megaPoints[i]!.x, megaPoints[i]!.y, 3.5);
      }
      g.stroke({ width: 1, color: 0x38bdf8, alpha: 0.8 });
      for (let i = 0; i < megaPoints.length; i++) {
        g.circle(megaPoints[i]!.x, megaPoints[i]!.y, 2);
      }
      g.fill({ color: 0x38bdf8, alpha: 0.9 });
    }

    if (capPoints.length > 0) {
      for (let i = 0; i < capPoints.length; i++) {
        g.circle(capPoints[i]!.x, capPoints[i]!.y, 4.5);
      }
      g.stroke({ width: 1.5, color: 0xf59e0b, alpha: 0.95 });
      for (let i = 0; i < capPoints.length; i++) {
        g.circle(capPoints[i]!.x, capPoints[i]!.y, 2);
      }
      g.fill({ color: 0xffffff, alpha: 0.95 });
    }

    // 8. Recycle unused labels back to their pools
    for (const [key, entry] of this.activeLabels.entries()) {
      if (!seenLabelKeys.has(key)) {
        entry.label.visible = false;
        this.activeLabels.delete(key);
        if (entry.category === 'cap') {
          this.capitalPool.push(entry.label);
        } else if (entry.category === 'mega') {
          this.megaPool.push(entry.label);
        } else {
          this.townPool.push(entry.label);
        }
      }
    }
  }

  /**
   * Cleans up all PixiJS resources.
   */
  destroy(): void {
    this.destroyed = true;
    this.places = null;
    this.spatialGrid = [];

    for (const entry of this.activeLabels.values()) {
      entry.label.destroy();
    }
    this.activeLabels.clear();

    for (const label of this.capitalPool) label.destroy();
    for (const label of this.megaPool) label.destroy();
    for (const label of this.townPool) label.destroy();
    this.capitalPool.length = 0;
    this.megaPool.length = 0;
    this.townPool.length = 0;

    this.markerGraphics.destroy();
    this.labelContainer.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}
