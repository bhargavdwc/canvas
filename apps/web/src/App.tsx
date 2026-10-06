import { useEffect } from 'react';
import { WorldCanvas } from './features/world/canvas/WorldCanvas';
import { CoordinateDisplay } from './features/world/components/CoordinateDisplay';
import { CoordinateSearch } from './features/world/components/CoordinateSearch';
import { MessageModal } from './features/world/components/MessageModal';
import { MessageComposer } from './features/world/components/MessageComposer';
import { ReportModal } from './features/world/components/ReportModal';
import { Toast } from './features/world/components/Toast';
import { WorldControls } from './features/world/components/WorldControls';
import { WorldStatus, InteractionHint } from './features/world/components/WorldStatus';
import { useUrlSync } from './features/world/hooks/useUrlSync';
import { useRealtime } from './features/world/hooks/useRealtime';
import { useWorldStore } from './features/world/store/worldStore';
import { initSession, pickDiscoveryPoint } from './features/world/services/worldApi';

export default function App() {
  useUrlSync();
  useRealtime();

  const setSession = useWorldStore((s) => s.setSession);

  useEffect(() => {
    void initSession().then((sess) => {
      setSession(sess);
    });
  }, [setSession]);

  const handleRandom = () => {
    const pt = pickDiscoveryPoint();
    useWorldStore.getState().requestFlyTo(pt, 1);
    useWorldStore.getState().markInteracted();
  };

  return (
    <main className="relative h-dvh w-dvw overflow-hidden bg-black">
      <h1 className="sr-only">Canvas — an infinite world of messages</h1>
      <WorldCanvas />

      {/* Top Navbar: Solid Black BG, Left: Random with logo, Middle: Coordinate, Right: Search */}
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-3 border-b border-white/15 bg-black px-4 py-2 sm:px-6 shadow-[0_4px_30px_rgba(0,0,0,0.95)]">
        {/* Left: Random Logo & Button */}
        <div className="flex items-center shrink-0">
          <button
            id="surprise-me"
            type="button"
            onClick={handleRandom}
            title="Teleport to a random note"
            className="group flex items-center gap-2 rounded-full border border-white/20 bg-black px-3.5 py-1.5 transition-all duration-200 hover:border-white/50 hover:bg-white/5 active:scale-95 shadow-sm"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4 text-cyan-400 transition-transform duration-200 group-hover:scale-110"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            <span className="text-xs sm:text-sm font-semibold tracking-tight text-white transition-colors group-hover:text-cyan-300">
              Random
            </span>
          </button>
        </div>

        {/* Middle: Coordinates Display */}
        <div className="flex items-center justify-center">
          <CoordinateDisplay />
        </div>

        {/* Right: Search Bar */}
        <div className="flex items-center justify-end shrink-0 max-w-xs sm:max-w-sm">
          <CoordinateSearch />
        </div>
      </header>

      {/* Bottom Floating Control Dock */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-3.5 sm:p-5">
        {/* Bottom Left: Live Telemetry & Quick Tutorial Hint */}
        <div className="pointer-events-auto flex flex-col items-start gap-2.5">
          <InteractionHint />
          <WorldStatus />
        </div>



        {/* Bottom Right: Spatial Controls Dock */}
        <div className="pointer-events-auto">
          <WorldControls />
        </div>
      </footer>

      {/* Modals & Overlay Portals */}
      <MessageModal />
      <MessageComposer />
      <ReportModal />
      <Toast />
    </main>
  );
}

