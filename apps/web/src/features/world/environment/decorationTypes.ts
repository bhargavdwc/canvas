import type { WorldBounds } from '@canvas/shared-types';

/** Decoration Chunk size in world units (matches Region size: 65,536). */
export const DECORATION_CHUNK_SIZE = 65_536;

/** Environment LOD: 0 (2% zoom) to 3 (200%-400% zoom). */
export type EnvironmentLOD = 0 | 1 | 2 | 3;

export interface StarData {
  x: number;
  y: number;
  radius: number;
  color: number;
  alpha: number;
  isBright?: boolean;
}

export interface NebulaPatch {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation: number;
  color: number;
  alpha: number;
}

export interface OrbitalRingData {
  cx: number;
  cy: number;
  radius: number;
  secondaryRadius?: number;
  dashOffset?: number;
  rotation?: number;
  nodeAngles: number[];
}

export interface SpatialNodeData {
  x: number;
  y: number;
  size: number;
  shape: 'diamond' | 'crosshair' | 'circle' | 'hexagon';
  hasBeacon?: boolean;
}

export interface ConnectionPathData {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isMajor: boolean;
}

export interface PlanetData {
  cx: number;
  cy: number;
  radius: number;
  color: number;
  atmosphereColor: number;
  hasRing: boolean;
  ringRadius?: number;
  ringTilt?: number;
}

export interface FloatingStructureData {
  x: number;
  y: number;
  size: number;
  rotation: number;
  type: 'station' | 'platform' | 'satellite';
}

export interface CoordinateMarkerData {
  x: number;
  y: number;
  label: string;
}

export interface EnvironmentLayerToggles {
  stars: boolean;
  nebula: boolean;
  rings: boolean;
  nodes: boolean;
  paths: boolean;
  planets: boolean;
  structures: boolean;
  coordinates: boolean;
}

export const DEFAULT_ENVIRONMENT_TOGGLES: EnvironmentLayerToggles = {
  stars: true,
  nebula: true,
  rings: true,
  nodes: true,
  paths: true,
  planets: true,
  structures: true,
  coordinates: true,
};

export interface EnvironmentStats {
  visibleChunksCount: number;
  cachedChunksCount: number;
  starsCount: number;
  nodesCount: number;
  ringsCount: number;
  planetsCount: number;
  pathsCount: number;
  lod: EnvironmentLOD;
}

export interface DecorationChunkData {
  chunkX: number;
  chunkY: number;
  key: string;
  seed: number;
  bounds: WorldBounds;
  stars: StarData[];
  nebulae: NebulaPatch[];
  rings: OrbitalRingData[];
  nodes: SpatialNodeData[];
  paths: ConnectionPathData[];
  planets: PlanetData[];
  structures: FloatingStructureData[];
  coordinates: CoordinateMarkerData[];
}
