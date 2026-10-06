import { create } from 'zustand';
import type { SessionInfo, WorldMessage, WorldPoint } from '@canvas/shared-types';
import { clampCamera, clampZoom, type Camera } from '../utils/coordinates';

import { pickDiscoveryPoint } from '../services/worldApi';

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
}

const initialPoint = pickDiscoveryPoint();
export const DEFAULT_CAMERA: Camera = { x: initialPoint.x, y: initialPoint.y, zoom: 0.02 };

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

  selectMessage: (selectedMessage) => set({ selectedMessage }),
  markInteracted: () => {
    if (!get().hasInteracted) set({ hasInteracted: true });
  },
  setVisibleCount: (visibleCount) => {
    if (get().visibleCount !== visibleCount) set({ visibleCount });
  },
  setSession: (session) => set({ session }),
  setComposerOpen: (isComposerOpen) => set({ isComposerOpen }),
  openComposerAt: (point) => {
    const state = get();
    const targetPoint = point || {
      x: Math.floor(state.camera.x / 100) * 100,
      y: Math.floor(state.camera.y / 100) * 100,
    };
    if (state.session) {
      set({
        isComposerOpen: true,
        session: {
          ...state.session,
          position: targetPoint,
        },
      });
    } else {
      set({
        isComposerOpen: true,
        session: {
          sessionId: 'local-session',
          position: targetPoint,
          worldSide: 10_000,
          limits: { maxWords: 1000, maxChars: 10_000 },
        },
      });
    }
  },
  setActiveReportMessage: (activeReportMessage) => set({ activeReportMessage }),
  showToast: (toastMessage) => {
    if (toastTimeout) clearTimeout(toastTimeout);
    set({ toastMessage });
    toastTimeout = setTimeout(() => {
      set({ toastMessage: null });
    }, 3500);
  },
  inscribeMessage: (lastCreatedMessage) => set({ lastCreatedMessage }),
}));
