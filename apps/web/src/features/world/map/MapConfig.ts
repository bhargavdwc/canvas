export interface MapLayerStyle {
  color: number;
  width: number;
  pixelWidth?: number;
  alpha: number;
}

export interface LodLevelConfig {
  name: string;
  minZoom: number;
  fadeInEnd?: number;
  fadeOutStart?: number;
  fadeOutEnd?: number;
  maxZoom: number;
  fadeStart: number;
  fadeEnd: number;
  style: MapLayerStyle;
  secondaryStyle?: MapLayerStyle;
}

export interface MapConfig {
  /** Master toggle to show/hide all vector map layers. */
  enabled: boolean;
  /** Granular layer visibility toggles. */
  layers: {
    worldOverview: boolean;
    countryDetail: boolean;
    stateProvinces: boolean;
    districtMunicipal: boolean;
    streetNetwork: boolean;
    populatedPlaces: boolean;
  };
  /** Hysteresis factor to prevent flickering when zoom fluctuates around thresholds (e.g. 0.08 = 8%). */
  hysteresis: number;
  /** URL template for fetching spatial vector tiles. */
  tileUrlTemplate: string;
  /** URL for fetching populated places GeoJSON/JSON point features. */
  placesUrl: string;
  /** Maximum number of tiles to retain in GPU/memory LRU cache. */
  maxCachedTiles: number;
  /** Maximum concurrent HTTP requests for vector tiles. */
  maxConcurrentRequests: number;
  /** Timeout in ms before aborting a tile request. */
  requestTimeoutMs: number;
  /** Zoom levels configuration. */
  lods: {
    lod0: LodLevelConfig;
    lod1: LodLevelConfig;
    lod2: LodLevelConfig;
    lod3: LodLevelConfig;
    lod4: LodLevelConfig;
  };
  places: {
    name: string;
    minZoom: number;
    fadeInEnd: number;
    fadeOutStart: number;
    fadeOutEnd: number;
    maxZoom: number;
  };
}

export const DEFAULT_MAP_CONFIG: MapConfig = {
  enabled: true,
  layers: {
    worldOverview: true,
    countryDetail: true,
    stateProvinces: true,
    districtMunicipal: true,
    streetNetwork: true,
    populatedPlaces: true,
  },
  hysteresis: 0.08,
  tileUrlTemplate: (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MAP_TILE_URL)
    ? (import.meta.env.VITE_MAP_TILE_URL as string)
    : '/map/{lod}/{x}_{y}.json',
  placesUrl: '/map/places/places.json',
  maxCachedTiles: 80,
  maxConcurrentRequests: 6,
  requestTimeoutMs: 8000,
  lods: {
    // LOD 0: World Overview (Natural Earth 1:110m)
    // Visible at full overview zoom (0.07% to 0.35%)
    lod0: {
      name: 'world_overview',
      minZoom: 0.0006,
      fadeInEnd: 0.0006,
      fadeOutStart: 0.0016,
      fadeOutEnd: 0.0035,
      maxZoom: 0.0035,
      fadeStart: 0.0016,
      fadeEnd: 0.0035,
      style: {
        color: 0x7dd3fc, // pale sky-blue for coastlines
        width: 800,
        pixelWidth: 1.20,
        alpha: 0.38,
      },
      secondaryStyle: {
        color: 0x94a3b8, // pale blue-gray for national borders
        width: 600,
        pixelWidth: 0.85,
        alpha: 0.22,
      },
    },

    // LOD 1: Detailed Country Borders (Natural Earth 1:50m)
    // Visible at continent & country scale (0.10% to 3.0%), fades as state/district details take over
    lod1: {
      name: 'country_detail',
      minZoom: 0.0010,
      fadeInEnd: 0.0022,
      fadeOutStart: 0.0180,
      fadeOutEnd: 0.0300,
      maxZoom: 0.0300,
      fadeStart: 0.0180,
      fadeEnd: 0.0300,
      style: {
        color: 0x38bdf8, // cyan sky-blue for detailed national borders
        width: 250,
        pixelWidth: 1.35,
        alpha: 0.40,
      },
    },

    // LOD 2: States & Provinces - Admin 1 (Natural Earth 1:10m Admin 1)
    // Visible at country & regional scale (0.35% to 5.5%), clean thin lines
    lod2: {
      name: 'state_provinces',
      minZoom: 0.0035,
      fadeInEnd: 0.0070,
      fadeOutStart: 0.0350,
      fadeOutEnd: 0.0550,
      maxZoom: 0.0550,
      fadeStart: 0.0350,
      fadeEnd: 0.0550,
      style: {
        color: 0x818cf8, // soft indigo-violet for internal state/provincial boundaries
        width: 150,
        pixelWidth: 1.05,
        alpha: 0.35,
      },
    },

    // LOD 3: Districts & Municipal Boundaries - Admin 2 (geoBoundaries CGAZ ADM2)
    // Visible at regional & city scale (1.5% to 7.5%), fine hairline borders
    lod3: {
      name: 'district_municipal',
      minZoom: 0.0150,
      fadeInEnd: 0.0250,
      fadeOutStart: 0.0600,
      fadeOutEnd: 0.0750,
      maxZoom: 0.0750,
      fadeStart: 0.0600,
      fadeEnd: 0.0750,
      style: {
        color: 0x2dd4bf, // soft emerald-teal for municipal/district borders
        width: 80,
        pixelWidth: 0.80,
        alpha: 0.32,
      },
    },

    // LOD 4: Street / Road Network (OpenStreetMap)
    // Fades in at 3.5%, reaches 100% opacity by 5.0%, and fades out before 8.0%
    lod4: {
      name: 'street_network',
      minZoom: 0.0350,
      fadeInEnd: 0.0500,
      fadeOutStart: 0.0650,
      fadeOutEnd: 0.0800,
      maxZoom: 0.0800,
      fadeStart: 0.0650,
      fadeEnd: 0.0800,
      style: {
        color: 0x64748b, // subtle slate-gray for physical road alignments
        width: 40,
        pixelWidth: 0.65,
        alpha: 0.25,
      },
    },
  },
  places: {
    name: 'populated_places',
    minZoom: 0.008,
    fadeInEnd: 0.015,
    fadeOutStart: 0.060,
    fadeOutEnd: 0.080,
    maxZoom: 0.080,
  },
};
