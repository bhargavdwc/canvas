import { useState, type FormEvent } from 'react';
import { useWorldStore } from '../store/worldStore';
import {
  validateCoordinateInput,
  type CoordinateValidationResult,
} from '../utils/coordinates';

export function CoordinateSearch() {
  const [value, setValue] = useState('');
  const [validation, setValidation] = useState<CoordinateValidationResult | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = validateCoordinateInput(value);
    if (result.status !== 'valid') {
      setValidation(result);
      return;
    }
    setValidation(null);
    const { camera, requestFlyTo } = useWorldStore.getState();
    requestFlyTo(result.point, Math.max(camera.zoom, 0.7));
    useWorldStore.getState().markInteracted();
  };

  const isOutOfBounds = validation?.status === 'out_of_bounds';
  const isInvalid = validation?.status === 'invalid_format';

  let borderStyle =
    'border-white/20 hover:border-white/40 focus-within:border-cyan-400 focus-within:shadow-[0_0_15px_rgba(34,211,238,0.25)]';
  if (isOutOfBounds) {
    borderStyle = 'border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.3)]';
  } else if (isInvalid) {
    borderStyle = 'border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.3)]';
  }

  return (
    <form onSubmit={onSubmit} role="search" className="relative w-full max-w-md" noValidate>
      <div
        className={`group flex items-center gap-2 rounded-full border bg-black py-1 pr-1 pl-3 transition-all duration-200 shadow-lg shadow-black/80 ${borderStyle}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={`size-4 shrink-0 transition-colors ${
            isOutOfBounds
              ? 'text-amber-400'
              : isInvalid
                ? 'text-rose-400'
                : 'text-cyan-400/80 group-focus-within:text-cyan-300'
          }`}
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
            const sanitized = e.target.value.replace(/[^0-9,\-\s]/g, '');
            setValue(sanitized);
            if (validation) setValidation(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setValue('');
              setValidation(null);
              (e.target as HTMLInputElement).blur();
              return;
            }
            // Block all letters and non-coordinate characters
            if (
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey &&
              e.key.length === 1 &&
              !/^[0-9,\-\s]$/.test(e.key)
            ) {
              e.preventDefault();
            }
          }}
          placeholder="Search coordinate  x, y"
          aria-label="Go to coordinate"
          aria-invalid={isOutOfBounds || isInvalid}
          aria-describedby={
            isOutOfBounds
              ? 'coordinate-search-warning'
              : isInvalid
                ? 'coordinate-search-error'
                : undefined
          }
          style={{ outline: 'none', boxShadow: 'none' }}
          className="min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-xs sm:text-sm text-white placeholder:text-zinc-500 outline-none ring-0 focus:border-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 shadow-none select-text"
        />

        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setValidation(null);
            }}
            className="grid size-5 shrink-0 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Clear coordinate search"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        <button
          id="coordinate-search-go"
          type="submit"
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition-all duration-150 active:scale-95 ${
            isOutOfBounds
              ? 'bg-amber-400 hover:bg-amber-300 hover:shadow-[0_0_12px_rgba(251,191,36,0.5)]'
              : 'bg-cyan-400 hover:bg-cyan-300 hover:shadow-[0_0_12px_rgba(34,211,238,0.4)]'
          }`}
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

      {isOutOfBounds && (
        <div
          id="coordinate-search-warning"
          role="alert"
          className="animate-pop absolute top-full right-0 left-0 mt-2 rounded-xl border border-amber-500/40 bg-black/95 px-3 py-2 text-xs text-amber-200 shadow-xl backdrop-blur-md z-50"
        >
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-bold shrink-0">⚠</span>
            <span className="font-medium text-amber-200">{validation.message}</span>
          </div>
        </div>
      )}

      {isInvalid && (
        <div
          id="coordinate-search-error"
          role="alert"
          className="animate-pop absolute top-full right-0 left-0 mt-2 rounded-xl border border-rose-500/40 bg-black/95 px-3 py-2 text-xs text-rose-200 shadow-xl backdrop-blur-md z-50"
        >
          <div className="flex items-center gap-2">
            <span className="text-rose-400 font-bold shrink-0">!</span>
            <span className="font-medium text-rose-200">
              Enter format: <span className="font-mono text-white">x, y</span> (e.g. 1245, -782)
            </span>
          </div>
        </div>
      )}
    </form>
  );
}
