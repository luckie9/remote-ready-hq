'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { track } from '@/lib/analytics';

export function JobAlertModal() {
  const { alertOpen, closeAlert, markAlertSubscribed } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle'
  );
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!alertOpen) {
      setStatus('idle');
      setMessage('');
      setEmail('');
    }
  }, [alertOpen]);

  if (!alertOpen) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    setStatus('loading');
    setMessage('');
    try {
      const res = await fetch('/api/job-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value, source: 'popup' }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Unable to save alert');
      track('job_alert_email_submitted', { source: 'popup' });
      setStatus('done');
      setMessage("You're on the list — daily remote job digests coming soon.");
      window.setTimeout(() => markAlertSubscribed(), 1400);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="alert-modal-title"
      onClick={closeAlert}
    >
      <div
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-emerald-500/25 bg-[#161F2E] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-400" />
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Job Alerts
              </p>
              <h2
                id="alert-modal-title"
                className="mt-2 text-2xl font-semibold tracking-tight text-white"
              >
                Never miss a high-paying remote job
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Get a daily digest of curated Support, Sales & Tech roles —
                direct recruiter links, verified employers.
              </p>
            </div>
            <button
              type="button"
              onClick={closeAlert}
              className="shrink-0 rounded-lg border border-slate-600/80 bg-[#0D131F] px-2.5 py-1 text-sm text-slate-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {status === 'done' ? (
            <p className="mt-6 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
              {message}
            </p>
          ) : (
            <form className="mt-6 space-y-3" onSubmit={onSubmit}>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-slate-600/80 bg-[#0B0F17] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30"
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                className="inline-flex w-full items-center justify-center rounded-full bg-emerald-500 px-5 py-3 text-sm font-bold text-[#0B0F17] shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-400 disabled:opacity-60"
              >
                {status === 'loading' ? 'Saving…' : 'Get Instant Alerts'}
              </button>
              {status === 'error' && (
                <p className="text-sm text-red-400">{message}</p>
              )}
              <p className="text-center text-[11px] text-slate-500">
                Free · Unsubscribe anytime · No spam
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
