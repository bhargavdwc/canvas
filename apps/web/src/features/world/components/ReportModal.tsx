import { useState } from 'react';
import { REPORT_REASONS, type ReportReason } from '@canvas/shared-types';
import { useWorldStore } from '../store/worldStore';
import { reportMessage } from '../services/worldApi';

export function ReportModal() {
  const message = useWorldStore((s) => s.activeReportMessage);
  const setActiveReport = useWorldStore((s) => s.setActiveReportMessage);
  const showToast = useWorldStore((s) => s.showToast);

  const [reason, setReason] = useState<ReportReason>('spam');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!message) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      await reportMessage(message.id, reason, details.trim() || undefined);
      setActiveReport(null);
      showToast('Report submitted. Thank you for keeping Canvas safe.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-md"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !submitting) setActiveReport(null);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        className="glass-card animate-pop w-full max-w-md rounded-3xl p-6 shadow-2xl border border-rose-500/30"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
            <h2 id="report-modal-title" className="text-base font-semibold text-rose-300">
              Report message
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setActiveReport(null)}
            className="grid size-8 place-items-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
          <div>
            <label htmlFor="report-reason" className="block text-xs font-medium text-slate-300 mb-1.5">
              Reason
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
              className="w-full rounded-xl border border-white/10 bg-slate-950/80 p-2.5 text-xs text-slate-100 focus:border-rose-400 focus:ring-1 focus:ring-rose-400 focus:outline-none"
            >
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r} className="bg-slate-950 text-slate-200">
                  {r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="report-details" className="block text-xs font-medium text-slate-300 mb-1.5">
              Additional context (optional)
            </label>
            <textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Provide any details that will help the moderator..."
              className="w-full resize-none rounded-xl border border-white/10 bg-slate-950/80 p-3 text-xs text-slate-100 placeholder:text-slate-500 focus:border-rose-400 focus:ring-1 focus:ring-rose-400 focus:outline-none"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-2.5 text-xs text-rose-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveReport(null)}
              className="rounded-full px-4 py-2 text-xs font-medium text-slate-400 transition hover:bg-white/10 hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-rose-500 px-5 py-2 text-xs font-semibold text-white transition hover:bg-rose-600 disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
