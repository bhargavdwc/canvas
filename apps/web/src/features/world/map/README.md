# Multi-Level Geographic Map Vector System

This directory implements the multi-level geographic vector map system for **Spatial Message World**, rendering progressive administrative and physical boundaries as users zoom through the infinite 2D canvas.

## Architecture

```text
apps/web/src/features/world/map/
├── MapConfig.ts              # Central configuration (thresholds, hysteresis, styles, cache limits)
├── projection.ts             # Pure equirectangular projection math & antimeridian handling
├── TileManager.ts            # Spatial grid math (16x8, 64x32) & viewport intersection
├── TileCache.ts              # Bounded LRU memory/GPU cache with resource disposal
├── TileLoader.ts             # Concurrent request deduplication & cancellation via AbortController
├── MapLodManager.ts          # Multi-level LOD orchestrator (PixiJS containers & cubic crossfading)
├── PopulatedPlacesManager.ts # City/town point locations with collision avoidance & label pooling
├── worldMapData.json         # Static LOD 0 world overview vector asset (Natural Earth 1:110m)
├── WorldMapLayer.ts          # Backward-compatible LOD 0 standalone layer
├── index.ts                  # Clean barrel exports
└── mapLod.test.ts            # Test suite verifying projection, tiling, caching, places, and lifecycle
```

## Level of Detail (LOD) Tiers

1. **LOD 0 — World Overview (`0.07% – 0.35%`)**:
   - Natural Earth 1:110m Admin 0 Countries.
   - Thin pale sky-blue coastlines (`#7dd3fc`, 0.38 alpha) and subtle slate borders (`#94a3b8`, 0.22 alpha).
   - Bundled statically in `worldMapData.json` (~100 KB raw, ~25 KB gzipped).

2. **LOD 1 — Country Detail (`0.10% – 8.00%`)**:
   - Natural Earth 1:50m Admin 0 Countries.
   - Higher-resolution national frontiers, coastal bays, and smaller islands (`#38bdf8`, 0.42 alpha).
   - Loaded on demand from `/map/lod1/countries.json` (~354 KB raw, ~70 KB gzipped).
   - Remains continuous across state and regional zoom to prevent any visual gaps.

3. **LOD 2 — States & Provinces - Admin 1 (`0.35% – 8.00%`)**:
   - Natural Earth 1:10m Admin 1 States & Provinces.
   - 4,596 regional administrative divisions worldwide (US states, Indian states, Canadian provinces, etc.) (`#818cf8`, 0.35 alpha).
   - Partitioned into a $16 \times 8$ spatial tile grid in `/map/lod2/{tx}_{ty}.json` (115 non-empty tiles, ~15 KB per tile).

4. **LOD 3 — Districts & Municipal Boundaries - Admin 2 (`1.50% – 8.00%`)**:
   - geoBoundaries CGAZ Global ADM2 Worldwide Second-Level Administrative Boundaries.
   - 49,349 districts, municipalities, and counties worldwide (`#2dd4bf`, 0.30 alpha).
   - Partitioned into a $16 \times 8$ spatial tile grid in `/map/lod3/{tx}_{ty}.json` (98 non-empty tiles, ~92 KB average).

5. **Populated Places — City & Town Locations (`0.80% – 8.00%`)**:
   - Natural Earth 1:10m Populated Places (7,342 cities and towns).
   - Filtered progressively by rank:
     - `0.8% - 2.5%`: Megacities & National Capitals (with gold/amber capital rings).
     - `2.5% - 5.0%`: Major cities (`rank <= 5`).
     - `5.0% - 8.0%`: Regional towns (`rank <= 10`).
   - Screen-space collision avoidance and pooled `Text` instances ensure zero overlap and 60 FPS performance.
   - Distinct point features—never treated as fake municipal polygons.

6. **LOD 4 — Street & Road Networks (`3.50% – 8.00%`)**:
   - Physical street alignments and road centerlines from OpenStreetMap (`#64748b`, 0.25 alpha).
   - Partitioned into a $64 \times 32$ spatial tile grid in `/map/lod4/{tx}_{ty}.json`.

7. **Message View (`> 8.00%` to `400%`)**:
   - **All map layers and city labels are completely hidden** (`visible = false`, zero draw calls).
   - Message cards, text wrapping, coordinate badges, and composing modals take priority.

> **Administrative vs. Physical Geography**: Administrative city and district boundaries (Admin 2 / municipal limits) represent jurisdictional legal borders, whereas street networks represent physical transportation lines. These are separate layers and can be independently enabled or styled.

## Dataset Licenses & Attribution

- **Natural Earth**: Public Domain ([naturalearthdata.com](https://www.naturalearthdata.com)). Free for all commercial and personal uses without restriction.
- **geoBoundaries**: Open Administrative Boundaries ([geoboundaries.org](https://www.geoboundaries.org)). Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0).
- **OpenStreetMap**: Open Database License (ODbL) © OpenStreetMap contributors ([openstreetmap.org](https://www.openstreetmap.org/copyright)).
