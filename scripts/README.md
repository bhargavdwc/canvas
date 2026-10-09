# Geographic Map Data Pipeline

This directory contains reproducible vector processing tools for **Spatial Message World**.

## Scripts

### `generate_map_tiles.py`
Converts raw ESRI Shapefiles (e.g. from Natural Earth) and GeoJSON datasets into optimized, simplified vector assets and spatial tiles suitable for high-performance WebGL/WebGPU rendering in PixiJS 8.

```bash
# Generate all LOD tiers into apps/web/public/map/
python scripts/generate_map_tiles.py --all

# Generate specific LOD tiers
python scripts/generate_map_tiles.py --lod1   # Natural Earth 1:50m Country Boundaries
python scripts/generate_map_tiles.py --lod2   # Natural Earth 1:10m Admin-1 States & Provinces
python scripts/generate_map_tiles.py --lod3   # District / Municipal Boundary sample tiles
python scripts/generate_map_tiles.py --lod4   # Street Network sample tiles
```

## Supported Datasets & Attribution

### 1. Natural Earth (Public Domain)
- **1:110m Admin 0 – Countries**: Global overview coastlines and national boundaries (LOD 0).
- **1:50m Admin 0 – Countries**: High-resolution national boundaries with smaller islands (LOD 1).
- **1:10m Admin 1 – States & Provinces**: Regional administrative divisions worldwide (US states, Canadian provinces, Indian states, etc.) (LOD 2).
- **Source**: [https://www.naturalearthdata.com](https://www.naturalearthdata.com)
- **License**: Public Domain (Creative Commons CC0 / No Rights Reserved).

### 2. geoBoundaries (Open License)
- **Admin 1 & Admin 2 Boundaries**: Global administrative hierarchy for states, provinces, and districts.
- **Source**: [https://www.geoboundaries.org](https://www.geoboundaries.org)
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0).

### 3. OpenStreetMap (ODbL)
- **Physical Street & Road Networks**: High-precision roadway geometries for dense urban areas (LOD 4).
- **Source**: [https://www.openstreetmap.org](https://www.openstreetmap.org)
- **License**: Open Database License (ODbL) by OpenStreetMap contributors.

> **Note on Administrative vs. Physical Geography**: Administrative city and district boundaries (e.g., municipal corporate limits) are jurisdictional polygons, whereas street networks are topological lines representing physical roadways. These are handled as distinct LOD tiers (`districtMunicipal` vs `streetNetwork`).
