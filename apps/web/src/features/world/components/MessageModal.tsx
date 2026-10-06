import { useEffect, useRef, useState } from 'react';
import { countWords } from '@canvas/validation';
import { useWorldStore } from '../store/worldStore';

/** Full-message reader. Content is rendered as plain text (React escapes it). */
export function MessageModal() {
  const message = useWorldStore((s) => s.selectedMessage);
  const select = useWorldStore((s) => s.selectMessage);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!message) return;
    setCopied(false);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message, select]);

  if (!message) return null;

  const { x, y } = message.position;
  const words = countWords(message.content);
  const date = new Date(message.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const copyLink = async () => {
    const url = `${window.location.origin}/@${x},${y}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      window.prompt('Copy this link', url);
    }
  };

  const setActiveReport = useWorldStore((s) => s.setActiveReportMessage);

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-black/80 p-4 backdrop-blur-md"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) select(null);
      }}
    >
      <article
        id="message-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="message-modal-title"
        className="glass-card animate-pop flex max-h-[85dvh] w-full max-w-xl flex-col rounded-3xl shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-6 sm:px-7 pt-6 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
              <h2
                id="message-modal-title"
                className="font-mono text-sm font-semibold tracking-tight text-cyan-300"
              >
                {x}, {y}
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Etched {date} · {words} {words === 1 ? 'word' : 'words'}
            </p>
          </div>
          <button
            ref={closeRef}
            id="message-modal-close"
            type="button"
            aria-label="Close message"
            onClick={() => select(null)}
            className="grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        <div className="overflow-y-auto px-6 sm:px-7 py-6 text-[15px] sm:text-base leading-relaxed whitespace-pre-wrap text-slate-100 font-normal">
          {message.content}
        </div>

        <footer className="flex items-center justify-between border-t border-white/10 px-6 sm:px-7 py-4">
          <button
            id="message-report-btn"
            type="button"
            onClick={() => {
              select(null);
              setActiveReport(message);
            }}
            className="text-xs text-slate-500 transition hover:text-rose-400 hover:underline underline-offset-2"
          >
            Report note
          </button>
          <button
            id="message-copy-link"
            type="button"
            onClick={copyLink}
            className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-slate-100 transition hover:bg-white/20 active:scale-95"
          >
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
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>{copied ? 'Link copied ✓' : 'Share coordinate link'}</span>
          </button>
        </footer>
      </article>
    </div>
  );
}
