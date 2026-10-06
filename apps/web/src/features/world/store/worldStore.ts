import { create } from 'zustand';
import type { SessionInfo, WorldMessage, WorldPoint } from '@canvas/shared-types';
import { clampCamera, clampZoom, type Camera } from '../utils/coordinates';

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
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 0.5 };

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
    if (point) {
      if (state.session) {
        set({
          isComposerOpen: true,
          session: {
            ...state.session,
            position: point,
          },
        });
      } else {
        set({
          isComposerOpen: true,
          session: {
            sessionId: 'local-session',
            position: point,
            worldSide: 10_000,
            limits: { maxWords: 1000, maxChars: 10_000 },
          },
        });
      }
    } else {
      set({ isComposerOpen: true });
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
}));
