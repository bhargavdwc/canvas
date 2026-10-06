import { useWorldStore } from '../store/worldStore';

export function Toast() {
  const text = useWorldStore((s) => s.toastMessage);
  if (!text) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="glass animate-pop fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-indigo-400/40 px-5 py-2.5 text-xs font-medium text-slate-100 shadow-xl shadow-black/50"
    >
      ✨ {text}
    </div>
  );
}
