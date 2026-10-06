import { useEffect, useState } from 'react';
import { useWorldStore } from '../store/worldStore';
import { fetchWorldStats, getWorldStats } from '../services/worldApi';

export function InteractionHint() {
  const hasInteracted = useWorldStore((s) => s.hasInteracted);

  return (
    <div
      id="world-hint"
      className={`pointer-events-none flex items-center gap-2 rounded-full border border-white/15 bg-black px-4 py-2 text-[11px] text-slate-300 transition-all duration-700 shadow-xl shadow-black/60 ${
        hasInteracted ? 'pointer-events-none translate-y-3 opacity-0' : 'animate-float opacity-100'
      }`}
    >
      <span className="text-cyan-400">✦</span>
      <span>
        <strong className="font-semibold text-white">Click</strong> any box to write ·{' '}
        <strong className="font-semibold text-white">Drag</strong> to pan ·{' '}
        <strong className="font-semibold text-white">Scroll</strong> to zoom
      </span>
    </div>
  );
}

/** Live real-time world message and visible stats counter */
export function WorldStatus() {
  const visible = useWorldStore((s) => s.visibleCount);
  const [total, setTotal] = useState(() => getWorldStats().totalMessages);

  useEffect(() => {
    let cancelled = false;
    const update = () => {
      fetchWorldStats()
        .then((st) => {
          if (!cancelled) setTotal(st.totalMessages);
        })
        .catch(() => {});
    };
    update();
    const interval = setInterval(update, 6_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div
      id="world-stats"
      className="flex items-center gap-2.5 rounded-full border border-white/15 bg-black px-3.5 py-1.5 font-mono text-[11px] text-slate-400 select-none shadow-lg shadow-black/60"
    >
      <span className="relative flex size-2 shrink-0">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
      </span>
      <span>
        <strong className="font-semibold text-slate-100">{visible.toLocaleString()}</strong> in view
      </span>
      <span className="text-white/20">/</span>
      <span>
        <strong className="font-semibold text-cyan-300">{total.toLocaleString()}</strong> placed
      </span>
    </div>
  );
}


