#!/usr/bin/env python3
"""
Reproducible Map Vector Processing Pipeline for Spatial Message World.

Converts Natural Earth shapefiles and geographic datasets into optimized,
spatially-tiled vector assets for multi-level LOD rendering in PixiJS 8.

Usage:
  python scripts/generate_map_tiles.py --all
  python scripts/generate_map_tiles.py --lod1
  python scripts/generate_map_tiles.py --lod2
  python scripts/generate_map_tiles.py --lod3
  python scripts/generate_map_tiles.py --lod4
"""

import os
import sys
import math
import json
import struct
import argparse

def douglas_peucker(pts, tol):
    """Simplifies polyline points using the Douglas-Peucker algorithm."""
    if len(pts) <= 2:
        return pts
    x1, y1 = pts[0]
    x2, y2 = pts[-1]
    dx = x2 - x1
    dy = y2 - y1
    denom = math.hypot(dx, dy)
    max_d = 0.0
    idx = 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = math.hypot(px - x1, py - y1) if denom == 0 else abs(dy * px - dx * py + x2 * y1 - y2 * x1) / denom
        if d > max_d:
            max_d = d
            idx = i
    if max_d > tol:
        left = douglas_peucker(pts[:idx + 1], tol)
        right = douglas_peucker(pts[idx:], tol)
        return left[:-1] + right
    return [pts[0], pts[-1]]

def parse_shp_polylines(shp_path, tol=0.04):
    """
    Parses ESRI shapefile (Polygon type 5) rings, splits across antimeridian,
    and simplifies polylines.
    """
    if not os.path.exists(shp_path):
        print(f"Warning: Shapefile not found at {shp_path}")
        return []

    lines = []
    with open(shp_path, 'rb') as f:
        f.seek(100)
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                break
            rec_num, content_len = struct.unpack('>ii', hdr)
            data = f.read(content_len * 2)
            if len(data) < 4:
                break
            stype, = struct.unpack('<i', data[0:4])
            if stype != 5:  # Polygon
                continue

            num_parts, num_pts = struct.unpack('<ii', data[36:44])
            parts = list(struct.unpack(f'<{num_parts}i', data[44:44 + num_parts * 4]))
            parts.append(num_pts)
            pts_offset = 44 + num_parts * 4
            raw_pts = [
                struct.unpack('<dd', data[pts_offset + i * 16: pts_offset + (i + 1) * 16])
                for i in range(num_pts)
            ]

            for p in range(num_parts):
                ring = raw_pts[parts[p]:parts[p + 1]]
                if len(ring) < 4:
                    continue

                # Split polylines when crossing the 180° antimeridian seam
                sub = []
                for pt in ring:
                    if sub and abs(pt[0] - sub[-1][0]) > 180:
                        if len(sub) >= 2:
                            simplified = douglas_peucker(sub, tol)
                            if len(simplified) >= 2:
                                lines.append(simplified)
                        sub = [pt]
                    else:
                        sub.append(pt)

                if len(sub) >= 2:
                    simplified = douglas_peucker(sub, tol)
                    if len(simplified) >= 2:
                        lines.append(simplified)

    return lines

def flatten_line(line, precision=2):
    """Flattens [(lon, lat), ...] into [lon, lat, lon, lat, ...] with fixed decimal precision."""
    return [round(coord, precision) for pt in line for coord in pt]

def generate_lod1(output_dir, shp_path='ne_50m_admin_0_countries/ne_50m_admin_0_countries.shp'):
    """Generates LOD 1 Country Detail vector asset."""
    print("Generating LOD 1 (Detailed Country Boundaries)...")
    lines = parse_shp_polylines(shp_path, tol=0.06)
    if not lines:
        print("LOD 1 skipped (no data)")
        return

    flat_lines = [flatten_line(l, precision=2) for l in lines]
    lod1_dir = os.path.join(output_dir, 'lod1')
    os.makedirs(lod1_dir, exist_ok=True)
    out_file = os.path.join(lod1_dir, 'countries.json')
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(flat_lines, f, separators=(',', ':'))

    print(f"LOD 1 generated: {len(flat_lines)} polylines -> {out_file} ({os.path.getsize(out_file) // 1024} KB)")

def generate_lod2(output_dir, shp_path='ne_10m_admin_1_states_provinces/ne_10m_admin_1_states_provinces.shp'):
    """Generates LOD 2 State & Province Boundaries tiled into a 16x8 spatial grid."""
    print("Generating LOD 2 (State & Province Boundaries 16x8 Spatial Grid)...")
    lines = parse_shp_polylines(shp_path, tol=0.05)
    if not lines:
        print("LOD 2 skipped (no data)")
        return

    GRID_COLS = 16
    GRID_ROWS = 8
    d_lon = 360.0 / GRID_COLS  # 22.5°
    d_lat = 180.0 / GRID_ROWS  # 22.5°

    tiles = {}
    for line in lines:
        # Determine intersecting tile(s)
        mid_x = (line[0][0] + line[-1][0]) / 2.0
        mid_y = (line[0][1] + line[-1][1]) / 2.0
        tx = max(0, min(GRID_COLS - 1, int((mid_x + 180.0) / d_lon)))
        ty = max(0, min(GRID_ROWS - 1, int((mid_y + 90.0) / d_lat)))
        tiles.setdefault((tx, ty), []).append(flatten_line(line, precision=2))

    lod2_dir = os.path.join(output_dir, 'lod2')
    os.makedirs(lod2_dir, exist_ok=True)

    count = 0
    total_bytes = 0
    for (tx, ty), flat_lines in tiles.items():
        out_file = os.path.join(lod2_dir, f"{tx}_{ty}.json")
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(flat_lines, f, separators=(',', ':'))
        count += 1
        total_bytes += os.path.getsize(out_file)

    print(f"LOD 2 generated: {count} spatial tiles -> {lod2_dir} (total {total_bytes // 1024} KB)")

def generate_lod3_sample(output_dir):
    """
    Generates representative LOD 3 District / Municipal boundaries for key urban regions.
    (e.g., Delhi NCR, New York Metro, London Greater Area, Tokyo Metro, Mumbai).
    """
    print("Generating LOD 3 (District & Municipal Boundary sample tiles)...")
    lod3_dir = os.path.join(output_dir, 'lod3')
    os.makedirs(lod3_dir, exist_ok=True)

    # Sample municipal boundary coordinates (degrees)
    # India/Delhi (lon ~77.1, lat ~28.6) -> Grid 32x16 tile (tx=22, ty=10)
    delhi_districts = [
        # Central / North / South Delhi municipal bounds
        [76.85, 28.50, 77.10, 28.45, 77.30, 28.52, 77.25, 28.75, 77.05, 28.85, 76.85, 28.70, 76.85, 28.50],
        [77.10, 28.55, 77.25, 28.55, 77.28, 28.68, 77.12, 28.68, 77.10, 28.55],
        [77.05, 28.68, 77.25, 28.68, 77.22, 28.82, 77.02, 28.80, 77.05, 28.68],
    ]
    with open(os.path.join(lod3_dir, "22_10.json"), 'w', encoding='utf-8') as f:
        json.dump(delhi_districts, f, separators=(',', ':'))

    # US / New York Metro (lon ~-74.0, lat ~40.7) -> Grid 32x16 tile (tx=9, ty=11)
    nyc_boroughs = [
        # Manhattan, Brooklyn, Queens sample district outlines
        [-74.02, 40.70, -73.97, 40.71, -73.93, 40.80, -73.91, 40.88, -73.94, 40.86, -74.01, 40.75, -74.02, 40.70],
        [-74.04, 40.57, -73.90, 40.58, -73.85, 40.66, -73.96, 40.72, -74.02, 40.65, -74.04, 40.57],
        [-73.96, 40.72, -73.70, 40.60, -73.72, 40.78, -73.85, 40.79, -73.96, 40.72],
    ]
    with open(os.path.join(lod3_dir, "9_11.json"), 'w', encoding='utf-8') as f:
        json.dump(nyc_boroughs, f, separators=(',', ':'))

    # London / UK (lon ~-0.1, lat ~51.5) -> Grid 32x16 tile (tx=16, ty=12)
    london_boroughs = [
        [-0.25, 51.45, 0.05, 51.45, 0.10, 51.55, -0.05, 51.60, -0.28, 51.58, -0.25, 51.45],
        [-0.15, 51.48, -0.05, 51.48, -0.04, 51.54, -0.16, 51.54, -0.15, 51.48],
    ]
    with open(os.path.join(lod3_dir, "16_12.json"), 'w', encoding='utf-8') as f:
        json.dump(london_boroughs, f, separators=(',', ':'))

    print(f"LOD 3 generated sample municipal tiles in {lod3_dir}")

def generate_lod4_sample(output_dir):
    """
    Generates representative LOD 4 Street Network alignments for key urban centers.
    """
    print("Generating LOD 4 (Street Network sample tiles)...")
    lod4_dir = os.path.join(output_dir, 'lod4')
    os.makedirs(lod4_dir, exist_ok=True)

    # Street grid sample for New York (tx=18, ty=23 in 64x32 grid)
    nyc_streets = [
        # Avenues (North-South)
        [-74.00, 40.71, -73.97, 40.77],
        [-73.99, 40.71, -73.96, 40.77],
        [-73.98, 40.71, -73.95, 40.78],
        # Cross Streets (East-West)
        [-74.01, 40.72, -73.97, 40.73],
        [-74.00, 40.73, -73.96, 40.74],
        [-73.99, 40.74, -73.95, 40.75],
        [-73.98, 40.75, -73.94, 40.76],
    ]
    with open(os.path.join(lod4_dir, "18_23.json"), 'w', encoding='utf-8') as f:
        json.dump(nyc_streets, f, separators=(',', ':'))

    print(f"LOD 4 generated sample street network tiles in {lod4_dir}")

def main():
    parser = argparse.ArgumentParser(description="Generate vector map tiles for Spatial Message World.")
    parser.add_argument('--all', action='store_true', help='Generate all LOD vector assets')
    parser.add_argument('--lod1', action='store_true', help='Generate LOD 1 (Country details)')
    parser.add_argument('--lod2', action='store_true', help='Generate LOD 2 (State/Province spatial tiles)')
    parser.add_argument('--lod3', action='store_true', help='Generate LOD 3 (District/Municipal boundaries)')
    parser.add_argument('--lod4', action='store_true', help='Generate LOD 4 (Street network)')
    parser.add_argument('--out', default='apps/web/public/map', help='Output directory for tiles')

    args = parser.parse_args()
    if not (args.all or args.lod1 or args.lod2 or args.lod3 or args.lod4):
        args.all = True

    output_dir = os.path.abspath(args.out)
    os.makedirs(output_dir, exist_ok=True)
    print(f"Target tile directory: {output_dir}")

    if args.all or args.lod1:
        generate_lod1(output_dir)
    if args.all or args.lod2:
        generate_lod2(output_dir)
    if args.all or args.lod3:
        generate_lod3_sample(output_dir)
    if args.all or args.lod4:
        generate_lod4_sample(output_dir)

    print("\nVector tile generation complete!")

if __name__ == '__main__':
    main()
