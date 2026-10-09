import { useState, useId } from 'react';
import { MAX_MESSAGE_CHARS } from '@canvas/shared-types';
import { useWorldStore } from '../store/worldStore';
import { createMessage, reallocateSession } from '../services/worldApi';
import { getBoxDimensions } from '../canvas/WorldRenderer';
import { WORLD_MAX_X } from '../utils/coordinates';

export function MessageComposer() {
  const isOpen = useWorldStore((s) => s.isComposerOpen);
  const setOpen = useWorldStore((s) => s.setComposerOpen);
  const session = useWorldStore((s) => s.session);
  const requestFlyTo = useWorldStore((s) => s.requestFlyTo);
  const showToast = useWorldStore((s) => s.showToast);

  const inscribeMessage = useWorldStore((s) => s.inscribeMessage);

  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaId = useId();

  if (!isOpen) return null;

  const currentCamera = useWorldStore.getState().camera;
  const pos = session?.position || {
    x: Math.floor(currentCamera.x / 100) * 100,
    y: Math.floor(currentCamera.y / 100) * 100,
  };
  const maxCols = Math.max(1, Math.floor((WORLD_MAX_X - pos.x) / 100));
  const chars = content.length;
  const dims = getBoxDimensions(content, maxCols);
  const isOverChars = chars > MAX_MESSAGE_CHARS;
  const canSubmit = content.trim().length > 0 && !isOverChars && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      setSubmitting(true);
      setError(null);
      await reallocateSession(pos);
      const created = await createMessage(content);

      // Inscribe immediately so the card is added directly to canvas cache
      inscribeMessage(created);

      setOpen(false);
      setContent('');

      // Stay on the exact position! If zoom is too small to read (< 0.75), adjust zoom to 0.85 so message is clearly legible
      const zoom = Math.max(currentCamera.zoom, 0.85);
      requestFlyTo(created.position, zoom);

      showToast(`Note inscribed at ${created.position.x}, ${created.position.y}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to inscribe note.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/85 p-4 backdrop-blur-md"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !submitting) setOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
        className="relative flex w-full max-w-[540px] flex-col rounded-sm border border-zinc-800 bg-[#09090b] p-6 shadow-2xl select-text"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-sm border border-zinc-700 bg-zinc-900 text-zinc-100">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                <path d="M2 2l7.586 7.586" />
                <line x1="10" y1="10" x2="12" y2="12" />
              </svg>
            </div>
            <div>
              <h2 id="composer-title" className="text-base font-semibold tracking-tight text-zinc-100">
                Inscribe Spatial Note
              </h2>
              <p className="text-xs text-zinc-400">
                Write a permanent note onto the canvas grid
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={submitting}
            className="grid size-8 place-items-center rounded-sm border border-zinc-800 bg-zinc-900 text-zinc-400 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Spatial Telemetry Ribbon */}
        <div className="mt-4 flex items-center justify-between rounded-sm border border-zinc-800/90 bg-zinc-950/80 px-3.5 py-2.5 text-xs">
          {/* Origin Coordinate */}
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="size-3.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18M3 12h18" />
            </svg>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500">Origin</span>
            <span className="font-mono font-semibold text-zinc-200">{pos ? `${pos.x}, ${pos.y}` : '0, 0'}</span>
          </div>

          <div className="h-3 w-px bg-zinc-800" aria-hidden="true" />

          {/* Grid Allocation */}
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="size-3.5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500">Grid</span>
            <span className="font-mono font-semibold text-zinc-200">
              {dims.cols}×{dims.rows} {dims.cols * dims.rows === 1 ? 'box' : 'boxes'}
            </span>
            <span className="hidden font-mono text-[10px] text-zinc-500 sm:inline">({dims.width}×{dims.height}u)</span>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-4 flex flex-1 flex-col">
          <label htmlFor={textareaId} className="sr-only">
            Message content
          </label>
          <textarea
            id={textareaId}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={submitting}
            placeholder="Type your message to etch into this coordinate..."
            rows={7}
            className="w-full resize-none rounded-sm border border-zinc-800 bg-[#050507] p-4 font-sans text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-zinc-500 focus:outline-none"
            autoFocus
          />

          {/* Footer Controls */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Character telemetry */}
            <div className="flex items-center gap-2 font-mono text-zinc-400">
              <svg viewBox="0 0 24 24" className="size-3.5 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <line x1="10" y1="9" x2="8" y2="9" />
              </svg>
              <span className={isOverChars ? 'font-bold text-red-400' : chars > 0 ? 'text-zinc-200' : 'text-zinc-500'}>
                {chars.toLocaleString()}
              </span>
              <span className="text-zinc-600">/</span>
              <span className="text-zinc-500">10,000 chars</span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="flex items-center gap-1.5 rounded-sm border border-zinc-800 bg-zinc-900/60 px-4 py-2 font-medium text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-white"
              >
                <svg viewBox="0 0 24 24" className="size-3 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
                <span>Cancel</span>
              </button>

              <button
                type="submit"
                disabled={!canSubmit}
                className="flex items-center gap-2 rounded-sm bg-white px-5 py-2 font-semibold text-black transition-colors hover:bg-zinc-200 active:bg-zinc-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
              >
                <span>{submitting ? 'Inscribing...' : 'Inscribe Note'}</span>
                {!submitting && (
                  <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 flex items-center gap-2 rounded-sm border border-red-900/50 bg-red-950/30 p-2.5 text-xs text-red-300">
              <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12,2 22,20 2,20" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="16" x2="12" y2="17" />
              </svg>
              <span>{error}</span>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
