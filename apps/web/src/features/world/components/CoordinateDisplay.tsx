import { useWorldStore } from '../store/worldStore';

/** Live telemetry readout of the camera centre coordinates and zoom level. */
export function CoordinateDisplay() {
  const x = useWorldStore((s) => Math.round(s.camera.x));
  const y = useWorldStore((s) => Math.round(s.camera.y));
  const zoom = useWorldStore((s) => s.camera.zoom);

  return (
    <div
      id="coordinate-display"
      className="flex items-center gap-3 rounded-full border border-white/15 bg-black px-4 py-1.5 font-mono text-xs select-none shadow-lg shadow-black/60 transition-colors hover:border-white/25"
      aria-live="off"
    >
      <div className="flex items-center gap-1.5 text-slate-400">
        <svg
          viewBox="0 0 24 24"
          className="size-3.5 text-cyan-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
        <span className="text-[10px] tracking-wider text-slate-500 uppercase font-semibold">X</span>
        <span className="inline-block min-w-[5ch] text-right font-medium text-slate-100">{x}</span>
      </div>

      <div className="h-3 w-px bg-white/15" aria-hidden="true" />

      <div className="flex items-center gap-1.5 text-slate-400">
        <span className="text-[10px] tracking-wider text-slate-500 uppercase font-semibold">Y</span>
        <span className="inline-block min-w-[5ch] text-right font-medium text-slate-100">{y}</span>
      </div>

      <div className="h-3 w-px bg-white/15" aria-hidden="true" />

      <div className="flex items-center gap-1">
        <span className="text-[10px] tracking-wider text-slate-500 uppercase font-semibold">ZOOM</span>
        <span className="font-semibold text-cyan-300">{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
