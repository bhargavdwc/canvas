#!/usr/bin/env python3
"""
Repeatable Geographic Data Processing Pipeline for Spatial Message World.

Processes:
1. Natural Earth 1:50m Admin 0 Countries -> LOD 1 Detailed Countries
2. Natural Earth 1:10m Admin 1 States & Provinces -> LOD 2 States & Provinces (16x8 spatial grid)
3. geoBoundaries CGAZ ADM2 Districts & Municipalities -> LOD 3 Districts (16x8 spatial grid)
4. Natural Earth 1:10m Populated Places -> Populated Places Point Layer

Usage:
  python scripts/geo/process_boundaries.py --all
  python scripts/geo/process_boundaries.py --states
  python scripts/geo/process_boundaries.py --districts
  python scripts/geo/process_boundaries.py --places
"""

import os
import sys
import math
import json
import time
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

def flatten_line(line, precision=2):
    """Flattens [(lon, lat), ...] to [lon, lat, lon, lat, ...] with fixed decimal precision."""
    return [round(coord, precision) for pt in line for coord in pt]

def parse_shp_polygons_to_grid(shp_path, grid_x, grid_y, tol=0.03):
    """
    Parses ESRI Polygon (type 5) shapefile, splits across the 180° antimeridian,
    simplifies with Douglas-Peucker, and partitions into spatial grid tiles.
    """
    if not os.path.exists(shp_path):
        print(f"Warning: File not found at {shp_path}")
        return {}

    dx = 360.0 / grid_x
    dy = 180.0 / grid_y
    tiles = {}

    total_records = 0
    total_rings = 0
    total_raw_points = 0
    simplified_points = 0

    t0 = time.time()
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

            total_records += 1
            num_parts, num_pts = struct.unpack('<ii', data[36:44])
            total_rings += num_parts
            total_raw_points += num_pts

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

                # Split across antimeridian jumps
                sub = []
                for pt in ring:
                    if sub and abs(pt[0] - sub[-1][0]) > 180:
                        if len(sub) >= 2:
                            sim = douglas_peucker(sub, tol)
                            if len(sim) >= 2:
                                simplified_points += len(sim)
                                mid_x = (sim[0][0] + sim[-1][0]) / 2.0
                                mid_y = (sim[0][1] + sim[-1][1]) / 2.0
                                tx = max(0, min(grid_x - 1, int((mid_x + 180.0) / dx)))
                                ty = max(0, min(grid_y - 1, int((mid_y + 90.0) / dy)))
                                tiles.setdefault((tx, ty), []).append(flatten_line(sim, precision=2))
                        sub = [pt]
                    else:
                        sub.append(pt)

                if len(sub) >= 2:
                    sim = douglas_peucker(sub, tol)
                    if len(sim) >= 2:
                        simplified_points += len(sim)
                        mid_x = (sim[0][0] + sim[-1][0]) / 2.0
                        mid_y = (sim[0][1] + sim[-1][1]) / 2.0
                        tx = max(0, min(grid_x - 1, int((mid_x + 180.0) / dx)))
                        ty = max(0, min(grid_y - 1, int((mid_y + 90.0) / dy)))
                        tiles.setdefault((tx, ty), []).append(flatten_line(sim, precision=2))

    duration = time.time() - t0
    print(f"Processed {total_records} records ({total_rings} rings, {total_raw_points} pts) -> {simplified_points} pts in {duration:.2f}s")
    return tiles

def process_admin1_states(source_dir, output_dir):
    """Processes Natural Earth Admin 1 States & Provinces into LOD 2 spatial tiles."""
    shp_path = os.path.join(source_dir, 'ne_10m_admin_1_states_provinces', 'ne_10m_admin_1_states_provinces.shp')
    print(f"\n[1/3] Processing Natural Earth Admin 1 States & Provinces from {shp_path}...")

    tiles = parse_shp_polygons_to_grid(shp_path, grid_x=16, grid_y=8, tol=0.04)
    lod2_dir = os.path.join(output_dir, 'lod2')
    os.makedirs(lod2_dir, exist_ok=True)

    count = 0
    total_bytes = 0
    for (tx, ty), lines in tiles.items():
        out_file = os.path.join(lod2_dir, f"{tx}_{ty}.json")
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(lines, f, separators=(',', ':'))
        count += 1
        total_bytes += os.path.getsize(out_file)

    print(f"LOD 2 (States & Provinces) complete: {count} tiles in {lod2_dir} ({total_bytes // 1024} KB total)")
    return {"tiles": count, "size_kb": total_bytes // 1024}

def process_admin2_districts(source_dir, output_dir):
    """Processes geoBoundaries CGAZ ADM2 Districts into LOD 3 spatial tiles."""
    shp_path = os.path.join(source_dir, 'geoBoundariesCGAZ_ADM2', 'geoBoundariesCGAZ_ADM2.shp')
    print(f"\n[2/3] Processing geoBoundaries CGAZ ADM2 Districts from {shp_path}...")

    # Using tolerance 0.025° keeps lines visually sharp at district zoom while controlling payload
    tiles = parse_shp_polygons_to_grid(shp_path, grid_x=16, grid_y=8, tol=0.025)
    lod3_dir = os.path.join(output_dir, 'lod3')
    os.makedirs(lod3_dir, exist_ok=True)

    count = 0
    total_bytes = 0
    for (tx, ty), lines in tiles.items():
        out_file = os.path.join(lod3_dir, f"{tx}_{ty}.json")
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(lines, f, separators=(',', ':'))
        count += 1
        total_bytes += os.path.getsize(out_file)

    print(f"LOD 3 (Districts & Municipalities) complete: {count} tiles in {lod3_dir} ({total_bytes // 1024} KB total)")
    return {"tiles": count, "size_kb": total_bytes // 1024}

def process_populated_places(source_dir, output_dir):
    """Processes Natural Earth Populated Places into city location point dataset."""
    shp_path = os.path.join(source_dir, 'ne_10m_populated_places', 'ne_10m_populated_places.shp')
    dbf_path = os.path.join(source_dir, 'ne_10m_populated_places', 'ne_10m_populated_places.dbf')
    print(f"\n[3/3] Processing Natural Earth Populated Places from {shp_path}...")

    if not os.path.exists(shp_path) or not os.path.exists(dbf_path):
        print(f"Warning: Populated places files missing")
        return {}

    # Read DBF attributes
    with open(dbf_path, 'rb') as f:
        hdr = f.read(32)
        num_recs, hdr_len, rec_len = struct.unpack('<IHH', hdr[4:12])
        fields = []
        while True:
            fdesc = f.read(32)
            if not fdesc or fdesc[0] == 0x0D:
                break
            fname = fdesc[:11].split(b'\x00')[0].decode('ascii', errors='ignore')
            flen = fdesc[16]
            fields.append((fname, flen))

        dbf_records = []
        f.seek(hdr_len)
        for _ in range(num_recs):
            raw = f.read(rec_len)
            if not raw:
                break
            offset = 1
            attrs = {}
            for fname, flen in fields:
                val = raw[offset:offset + flen].decode('utf-8', errors='ignore').strip()
                attrs[fname] = val
                offset += flen
            dbf_records.append(attrs)

    # Read SHP points
    coords = []
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
            if stype == 1:  # Point
                x, y = struct.unpack('<dd', data[4:20])
                coords.append((round(x, 4), round(y, 4)))

    places = []
    for i in range(min(len(coords), len(dbf_records))):
        attrs = dbf_records[i]
        lon, lat = coords[i]
        name = attrs.get('NAME', '').strip()
        if not name:
            name = attrs.get('NAMEASCII', '').strip()
        if not name:
            continue

        try:
            rank = int(attrs.get('SCALERANK', '10'))
        except ValueError:
            rank = 10

        is_cap = 1 if attrs.get('ADM0CAP') == '1' else 0
        is_mega = 1 if attrs.get('MEGACITY') == '1' else 0
        country = attrs.get('ADM0NAME', '')

        places.append({
            "name": name,
            "lon": lon,
            "lat": lat,
            "rank": rank,
            "cap": is_cap,
            "mega": is_mega,
            "country": country,
        })

    # Sort places by importance rank (0 is most important)
    places.sort(key=lambda p: (0 if p['cap'] or p['mega'] else 1, p['rank']))

    places_dir = os.path.join(output_dir, 'places')
    os.makedirs(places_dir, exist_ok=True)
    out_file = os.path.join(places_dir, 'places.json')
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(places, f, separators=(',', ':'))

    file_size_kb = os.path.getsize(out_file) // 1024
    print(f"Populated Places complete: {len(places)} cities/towns in {out_file} ({file_size_kb} KB)")
    return {"places_count": len(places), "size_kb": file_size_kb}

def main():
    parser = argparse.ArgumentParser(description="Process boundary datasets for Spatial Message World.")
    parser.add_argument('--all', action='store_true', help="Process all datasets")
    parser.add_argument('--states', action='store_true', help="Process Natural Earth Admin 1 states")
    parser.add_argument('--districts', action='store_true', help="Process geoBoundaries ADM2 districts")
    parser.add_argument('--places', action='store_true', help="Process Natural Earth Populated Places")
    parser.add_argument('--source', default='data/source', help="Source datasets directory")
    parser.add_argument('--out', default='apps/web/public/map', help="Target runtime assets directory")
    parser.add_argument('--meta', default='data/processed', help="Metadata output directory")

    args = parser.parse_args()
    if not (args.all or args.states or args.districts or args.places):
        args.all = True

    source_dir = os.path.abspath(args.source)
    output_dir = os.path.abspath(args.out)
    meta_dir = os.path.abspath(args.meta)
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(meta_dir, exist_ok=True)

    print(f"Source Directory: {source_dir}")
    print(f"Output Directory: {output_dir}")

    meta = {"processed_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()), "datasets": {}}

    t_total = time.time()
    if args.all or args.states:
        meta["datasets"]["admin1_states"] = process_admin1_states(source_dir, output_dir)
    if args.all or args.districts:
        meta["datasets"]["admin2_districts"] = process_admin2_districts(source_dir, output_dir)
    if args.all or args.places:
        meta["datasets"]["populated_places"] = process_populated_places(source_dir, output_dir)

    meta_file = os.path.join(meta_dir, 'metadata.json')
    with open(meta_file, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)

    print(f"\nAll processing completed in {time.time() - t_total:.2f}s!")
    print(f"Summary written to {meta_file}")

if __name__ == '__main__':
    main()
