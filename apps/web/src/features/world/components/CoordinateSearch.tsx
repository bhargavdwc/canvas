import { useState, type FormEvent } from 'react';
import { WORLD_HALF_EXTENT } from '@canvas/shared-types';
import { useWorldStore } from '../store/worldStore';
import { parseCoordinateInput } from '../utils/coordinates';

export function CoordinateSearch() {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const point = parseCoordinateInput(value);
    if (!point) {
      setError(true);
      return;
    }
    setError(false);
    const { camera, requestFlyTo } = useWorldStore.getState();
    requestFlyTo(point, Math.max(camera.zoom, 0.7));
    useWorldStore.getState().markInteracted();
  };

  return (
    <form onSubmit={onSubmit} role="search" className="relative w-full max-w-md" noValidate>
      <div
        className={`group flex items-center gap-2 rounded-full border bg-black py-1 pr-1 pl-3 transition-all duration-200 shadow-lg shadow-black/80 ${
          error
            ? 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.35)]'
            : 'border-white/20 hover:border-white/40 focus-within:border-cyan-400 focus-within:shadow-[0_0_15px_rgba(34,211,238,0.25)]'
        }`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-4 shrink-0 text-cyan-400/80 transition-colors group-focus-within:text-cyan-300"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>

        <input
          id="coordinate-search"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue('');
              setError(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search coordinate  x, y"
          aria-label="Go to coordinate"
          aria-invalid={error}
          aria-describedby={error ? 'coordinate-search-error' : undefined}
          style={{ outline: 'none', boxShadow: 'none' }}
          className="min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-xs sm:text-sm text-white placeholder:text-zinc-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 shadow-none select-text"
        />

        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setError(false);
            }}
            className="grid size-5 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Clear coordinate search"
          >
            <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        <button
          id="coordinate-search-go"
          type="submit"
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-cyan-400 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition-all duration-150 hover:bg-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.4)] active:scale-95"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {error && (
        <div
          id="coordinate-search-error"
          role="alert"
          className="animate-pop absolute top-full right-0 left-0 mt-2.5 rounded-2xl border border-rose-500/40 bg-black p-3 text-xs text-rose-200 shadow-2xl"
        >
          <div className="flex items-center gap-2">
            <span className="text-rose-400 font-bold">!</span>
            <span>
              Enter two whole numbers between ±{WORLD_HALF_EXTENT.toLocaleString()}, like{' '}
              <span className="font-mono font-medium text-white">1245, -782</span>.
            </span>
          </div>
        </div>
      )}
    </form>
  );
}

