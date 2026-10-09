import { describe, it, expect, vi } from 'vitest';
import {
  projectGeoToWorld,
  projectWorldToGeo,
  isAntimeridianJump,
  worldToGraphicsPoint,
} from './projection';
import { TileManager } from './TileManager';
import { TileCache } from './TileCache';
import { TileLoader } from './TileLoader';
import { MapLodManager } from './MapLodManager';
import { PopulatedPlacesManager } from './PopulatedPlacesManager';
import { DEFAULT_MAP_CONFIG } from './MapConfig';
import {
  WORLD_MIN_X,
  WORLD_MAX_X,
  WORLD_MIN_Y,
  WORLD_MAX_Y,
} from '../utils/coordinates';

describe('Geographic Projection & Antimeridian Math', () => {
  it('projects canonical geographic coordinates to expected world boundaries', () => {
    // 1. Longitude -180°, latitude 0°
    const west = projectGeoToWorld(-180, 0);
    expect(west.x).toBe(WORLD_MIN_X);
    expect(west.y).toBe(50); // midpoint of [-500,000, 500,100]

    // 2. Longitude +180°, latitude 0°
    const east = projectGeoToWorld(180, 0);
    expect(east.x).toBe(WORLD_MAX_X);
    expect(east.y).toBe(50);

    // 3. Longitude 0°, latitude 0° (Origin / Prime Meridian + Equator)
    const center = projectGeoToWorld(0, 0);
    expect(center.x).toBe(50); // midpoint of [-1,000,000, 1,000,100]
    expect(center.y).toBe(50);

    // 4. Longitude 0°, latitude +90° (North Pole)
    const north = projectGeoToWorld(0, 90);
    expect(north.x).toBe(50);
    expect(north.y).toBe(WORLD_MAX_Y);

    // 5. Longitude 0°, latitude -90° (South Pole)
    const south = projectGeoToWorld(0, -90);
    expect(south.x).toBe(50);
    expect(south.y).toBe(WORLD_MIN_Y);
  });

  it('performs accurate roundtrip projection between geo and world', () => {
    const testCases = [
      { lon: -122.4194, lat: 37.7749 }, // San Francisco
      { lon: 77.209, lat: 28.6139 },     // New Delhi
      { lon: 0.1276, lat: 51.5072 },     // London
      { lon: 139.6917, lat: 35.6895 },   // Tokyo
      { lon: -43.1729, lat: -22.9068 },  // Rio de Janeiro
    ];

    for (const tc of testCases) {
      const world = projectGeoToWorld(tc.lon, tc.lat);
      const roundtrip = projectWorldToGeo(world.x, world.y);
      expect(roundtrip.lon).toBeCloseTo(tc.lon, 2);
      expect(roundtrip.lat).toBeCloseTo(tc.lat, 2);
    }
  });

  it('inverts Y coordinate for PixiJS local graphics coordinate space', () => {
    const pt = worldToGraphicsPoint(1500, 2500);
    expect(pt.x).toBe(1500);
    expect(pt.y).toBe(-2500);
  });

  it('detects antimeridian wrap discontinuities across 180°', () => {
    expect(isAntimeridianJump(179, -179)).toBe(true);
    expect(isAntimeridianJump(-178, 178)).toBe(true);
    expect(isAntimeridianJump(10, 15)).toBe(false);
    expect(isAntimeridianJump(-120, -125)).toBe(false);
  });
});

describe('TileManager Spatial Indexing', () => {
  it('formats and parses tile keys correctly', () => {
    const key = TileManager.formatKey('lod2', 5, 3);
    expect(key).toBe('lod2/5_3');

    const parsed = TileManager.parseKey('lod2/5_3');
    expect(parsed).toEqual({ lod: 'lod2', tx: 5, ty: 3 });

    expect(TileManager.parseKey('invalid')).toBeNull();
    expect(TileManager.parseKey('lod2/abc_3')).toBeNull();
  });

  it('calculates correct geographic bounding boxes for tiles', () => {
    // LOD2 grid is 16x8 (each tile is 22.5° x 22.5°)
    const bounds = TileManager.getTileGeoBounds('lod2', 0, 0);
    expect(bounds.minLon).toBe(-180);
    expect(bounds.maxLon).toBe(-157.5);
    expect(bounds.minLat).toBe(-90);
    expect(bounds.maxLat).toBe(-67.5);
  });

  it('identifies tiles intersecting a visible viewport bounding box', () => {
    // Viewport around Europe / UK (approx -10 to +10 lon, 45 to 60 lat)
    const minWorld = projectGeoToWorld(-10, 45);
    const maxWorld = projectGeoToWorld(10, 60);

    const tiles = TileManager.getIntersectingTiles('lod2', {
      minX: minWorld.x,
      maxX: maxWorld.x,
      minY: minWorld.y,
      maxY: maxWorld.y,
    });

    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.lod === 'lod2')).toBe(true);
  });
});

describe('TileCache LRU Behavior & Disposal', () => {
  it('stores and retrieves cached items, tracking recency', () => {
    const cache = new TileCache<string>(3);
    cache.set('a', 'alpha');
    cache.set('b', 'beta');
    cache.set('c', 'gamma');

    expect(cache.size()).toBe(3);
    expect(cache.get('a')).toBe('alpha');

    // Accessing 'a' makes 'b' the oldest
    cache.set('d', 'delta'); // should evict 'b'

    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('invokes eviction callback for resource cleanup on disposal', () => {
    const onEvict = vi.fn();
    const cache = new TileCache<string>(2, onEvict);

    cache.set('tile1', 'data1');
    cache.set('tile2', 'data2');
    cache.set('tile3', 'data3'); // triggers eviction of tile1

    expect(onEvict).toHaveBeenCalledWith('tile1', 'data1');

    cache.delete('tile2');
    expect(onEvict).toHaveBeenCalledWith('tile2', 'data2');

    cache.clear();
    expect(onEvict).toHaveBeenCalledWith('tile3', 'data3');
    expect(cache.size()).toBe(0);
  });
});

describe('TileLoader Request Lifecycle & Cancellation', () => {
  it('deduplicates concurrent requests for the same tile', async () => {
    const mockTileData = [[10, 20, 30, 40]];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockTileData,
    });
    vi.stubGlobal('fetch', mockFetch);

    const loader = new TileLoader('/test/{lod}/{x}_{y}.json', 5000);

    const [p1, p2] = await Promise.all([
      loader.loadTile('lod2', 3, 4),
      loader.loadTile('lod2', 3, 4),
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(p1).toEqual(p2);
    expect(p1?.lines).toEqual(mockTileData);

    vi.unstubAllGlobals();
  });

  it('aborts obsolete in-flight requests', async () => {
    const mockFetch = vi.fn().mockImplementation((_url, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () => {
          const err = new DOMException('The user aborted a request.', 'AbortError');
          reject(err);
        });
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const loader = new TileLoader('/test/{lod}/{x}_{y}.json', 5000);
    const promise = loader.loadTile('lod2', 1, 2);

    loader.cancelObsolete(new Set()); // cancel all in flight
    const result = await promise;

    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('MapLodManager Orchestration & Pointer Transparency', () => {
  it('is completely non-interactive and pointer-transparent', () => {
    const manager = new MapLodManager();
    expect(manager.container.eventMode).toBe('none');
    manager.destroy();
  });

  it('updates container transform and maintains LOD visibility cleanly', () => {
    const manager = new MapLodManager(DEFAULT_MAP_CONFIG);
    const camera = { x: 0, y: 0, zoom: 0.0008 };
    const size = { width: 1440, height: 900 };

    // At overview zoom (0.0008), container should be visible
    manager.update(camera, size);
    expect(manager.container.visible).toBe(true);

    // At close note zoom (> 0.08), container should be hidden completely
    manager.update({ x: 0, y: 0, zoom: 0.15 }, size);
    expect(manager.container.visible).toBe(false);

    manager.destroy();
  });

  it('maintains continuous visibility across country-to-state zoom transition without any 0.7% gap', () => {
    const manager = new MapLodManager(DEFAULT_MAP_CONFIG);
    const size = { width: 1440, height: 900 };

    // Test a smooth sweep from overview zoom through state zoom
    // 0.08%, 0.15%, 0.3%, 0.42%, 0.55%, 0.7%, 0.85%, 1.0%, 1.5%, 2.0%, 3.5%, 5.0%
    const testZooms = [0.0008, 0.0015, 0.003, 0.0042, 0.0055, 0.007, 0.0085, 0.01, 0.015, 0.02, 0.035, 0.05];

    for (const zoom of testZooms) {
      manager.update({ x: 432177, y: 108527, zoom }, size);
      expect(manager.container.visible).toBe(true);

      // Verify that at least one of the child layers has strong opacity (>= 0.3)
      const childAlphas = manager.container.children.map((c) => c.alpha * (c.visible ? 1 : 0));
      const maxAlpha = Math.max(...childAlphas);
      expect(maxAlpha).toBeGreaterThanOrEqual(0.3);
    }

    manager.destroy();
  });
});

describe('PopulatedPlacesManager City Points & Labels', () => {
  it('is completely pointer-transparent', () => {
    const places = new PopulatedPlacesManager(DEFAULT_MAP_CONFIG);
    expect(places.container.eventMode).toBe('none');
    places.destroy();
  });

  it('hides places at overview zoom (< 0.8%) and close note zoom (> 8%)', () => {
    const places = new PopulatedPlacesManager(DEFAULT_MAP_CONFIG);
    const size = { width: 1440, height: 900 };

    // Overview zoom: hidden
    places.update({ x: 0, y: 0, zoom: 0.005 }, size);
    expect(places.container.visible).toBe(false);

    // Close note zoom: hidden
    places.update({ x: 0, y: 0, zoom: 0.09 }, size);
    expect(places.container.visible).toBe(false);

    places.destroy();
  });

  it('correctly projects geographic locations to world coordinates', () => {
    const delhiGeo = { lon: 77.2, lat: 28.6 };
    const worldPt = projectGeoToWorld(delhiGeo.lon, delhiGeo.lat);

    // World coordinates should be within expected valid world boundaries
    expect(worldPt.x).toBeGreaterThan(WORLD_MIN_X);
    expect(worldPt.x).toBeLessThan(WORLD_MAX_X);
    expect(worldPt.y).toBeGreaterThan(WORLD_MIN_Y);
    expect(worldPt.y).toBeLessThan(WORLD_MAX_Y);
  });
});
