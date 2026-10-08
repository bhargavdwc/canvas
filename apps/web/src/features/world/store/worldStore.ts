import { create } from 'zustand';
import type { SessionInfo, WorldMessage, WorldPoint } from '@canvas/shared-types';
import { clampCamera, clampZoom, type Camera } from '../utils/coordinates';
import { DEFAULT_ENVIRONMENT_TOGGLES, type EnvironmentLayerToggles } from '../environment/decorationTypes';
import type { BackgroundDebugStats } from '../background/BackgroundManager';

export interface FlyToRequest {
  x: number;
  y: number;
  zoom?: number;
  nonce: number;
}

interface WorldState {
  camera: Camera;
  flyTo: FlyToRequest | null;
  selectedMessage: WorldMessage | null;
  hasInteracted: boolean;
  visibleCount: number;
  session: SessionInfo | null;
  isComposerOpen: boolean;
  activeReportMessage: WorldMessage | null;
  toastMessage: string | null;
  lastCreatedMessage: WorldMessage | null;

  // Development Environment & Debug Telemetry
  debugStats: BackgroundDebugStats | null;
  showDebugOverlay: boolean;
  environmentToggles: EnvironmentLayerToggles;

  setCamera: (camera: Camera) => void;
  requestFlyTo: (point: WorldPoint, zoom?: number) => void;
  zoomBy: (factor: number) => void;
  selectMessage: (message: WorldMessage | null) => void;
  markInteracted: () => void;
  setVisibleCount: (count: number) => void;
  setSession: (session: SessionInfo | null) => void;
  setComposerOpen: (open: boolean) => void;
  openComposerAt: (point?: WorldPoint) => void;
  setActiveReportMessage: (message: WorldMessage | null) => void;
  showToast: (text: string) => void;
  inscribeMessage: (message: WorldMessage) => void;

  setDebugStats: (stats: BackgroundDebugStats) => void;
  setShowDebugOverlay: (show: boolean) => void;
  setEnvironmentToggle: <K extends keyof EnvironmentLayerToggles>(key: K, value: boolean) => void;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 0.02 };

let nonce = 0;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

export const useWorldStore = create<WorldState>((set, get) => ({
  camera: DEFAULT_CAMERA,
  flyTo: null,
  selectedMessage: null,
  hasInteracted: false,
  visibleCount: 0,
  session: null,
  isComposerOpen: false,
  activeReportMessage: null,
  toastMessage: null,
  lastCreatedMessage: null,

  debugStats: null,
  showDebugOverlay: false,
  environmentToggles: { ...DEFAULT_ENVIRONMENT_TOGGLES },

  setCamera: (camera) => set({ camera: clampCamera(camera) }),

  requestFlyTo: (point, zoom) =>
    set({ flyTo: { x: point.x, y: point.y, zoom, nonce: ++nonce } }),

  zoomBy: (factor) => {
    const { camera } = get();
    set({
      flyTo: {
        x: camera.x,
        y: camera.y,
        zoom: clampZoom(camera.zoom * factor),
        nonce: ++nonce,
      },
    });
  },

  selectMessage: (message) => set({ selectedMessage: message }),
  markInteracted: () => set({ hasInteracted: true }),
  setVisibleCount: (count) => set({ visibleCount: count }),
  setSession: (session) => set({ session }),
  setComposerOpen: (open) => set({ isComposerOpen: open }),

  openComposerAt: (point) => {
    const current = get().session;
    if (point && current) {
      set({
        session: { ...current, position: point },
        isComposerOpen: true,
      });
    } else {
      set({ isComposerOpen: true });
    }
  },

  setActiveReportMessage: (message) => set({ activeReportMessage: message }),

  showToast: (text) => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({ toastMessage: text });
    toastTimeout = setTimeout(() => {
      set({ toastMessage: null });
      toastTimeout = null;
    }, 4000);
  },

  inscribeMessage: (message) => set({ lastCreatedMessage: message }),

  setDebugStats: (stats) => set({ debugStats: stats }),
  setShowDebugOverlay: (show) => set({ showDebugOverlay: show }),
  setEnvironmentToggle: (key, value) =>
    set((state) => ({
      environmentToggles: { ...state.environmentToggles, [key]: value },
    })),
}));

if (typeof window !== 'undefined') {
  (window as unknown as { __WORLD_STORE__: typeof useWorldStore }).__WORLD_STORE__ = useWorldStore;
}
