import type { WorldBounds } from '@canvas/shared-types';
import { projectWorldToGeo } from './projection';

export interface TileKey {
  lod: string;
  tx: number;
  ty: number;
}

export interface TileGridConfig {
  gridCols: number;
  gridRows: number;
}

export const LOD_GRID_CONFIGS: Record<string, TileGridConfig> = {
  lod2: { gridCols: 16, gridRows: 8 },  // 22.5° x 22.5° tiles
  lod3: { gridCols: 16, gridRows: 8 },  // 22.5° x 22.5° tiles
  lod4: { gridCols: 64, gridRows: 32 }, // 5.625° x 5.625° tiles
};

/**
 * Spatial tile coordinate calculations and viewport tile queries.
 */
export class TileManager {
  /**
   * Formats a unique tile identifier key.
   */
  static formatKey(lod: string, tx: number, ty: number): string {
    return `${lod}/${tx}_${ty}`;
  }

  /**
   * Parses a tile identifier key into component parts.
   */
  static parseKey(key: string): TileKey | null {
    const parts = key.split('/');
    if (parts.length !== 2) return null;
    const lod = parts[0]!;
    const coords = parts[1]!.split('_');
    if (coords.length !== 2) return null;
    const tx = parseInt(coords[0]!, 10);
    const ty = parseInt(coords[1]!, 10);
    if (isNaN(tx) || isNaN(ty)) return null;
    return { lod, tx, ty };
  }

  /**
   * Computes the bounding box in degrees (lon/lat) for a given tile.
   */
  static getTileGeoBounds(
    lod: string,
    tx: number,
    ty: number
  ): { minLon: number; maxLon: number; minLat: number; maxLat: number } {
    const config = LOD_GRID_CONFIGS[lod] || LOD_GRID_CONFIGS.lod2!;
    const dLon = 360 / config.gridCols;
    const dLat = 180 / config.gridRows;

    const minLon = -180 + tx * dLon;
    const maxLon = minLon + dLon;
    const minLat = -90 + ty * dLat;
    const maxLat = minLat + dLat;

    return { minLon, maxLon, minLat, maxLat };
  }

  /**
   * Determines which tiles intersect a given visible viewport world bounding box.
   */
  static getIntersectingTiles(lod: string, viewport: WorldBounds): TileKey[] {
    const config = LOD_GRID_CONFIGS[lod];
    if (!config) return [];

    const minGeo = projectWorldToGeo(viewport.minX, viewport.minY);
    const maxGeo = projectWorldToGeo(viewport.maxX, viewport.maxY);

    const dLon = 360 / config.gridCols;
    const dLat = 180 / config.gridRows;

    const minTx = Math.max(0, Math.min(config.gridCols - 1, Math.floor((minGeo.lon + 180) / dLon)));
    const maxTx = Math.max(0, Math.min(config.gridCols - 1, Math.floor((maxGeo.lon + 180) / dLon)));
    const minTy = Math.max(0, Math.min(config.gridRows - 1, Math.floor((minGeo.lat + 90) / dLat)));
    const maxTy = Math.max(0, Math.min(config.gridRows - 1, Math.floor((maxGeo.lat + 90) / dLat)));

    const result: TileKey[] = [];
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        result.push({ lod, tx, ty });
      }
    }

    return result;
  }
}
