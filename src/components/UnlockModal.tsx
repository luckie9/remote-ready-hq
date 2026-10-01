'use client';

import { useState } from 'react';
import { useUnlock } from '@/components/UnlockProvider';
import { track } from '@/lib/analytics';

const BENEFITS = [
  'Direct application links to hiring managers',
  'Avoid black-hole job board forms',
  '100% verified active remote openings',
] as const;

export function UnlockModal() {
  const { unlockOpen, closeUnlock } = useUnlock();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!unlockOpen) return null;

  async function startCheckout() {
    setLoading(true);
    setError(null);
    track('unlock_pass_clicked', { plan: 'trial' });
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'trial' }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Unable to start checkout');
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      aria-labelledby="unlock-modal-title"
      onClick={closeUnlock}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-emerald-500/30 bg-[#161F2E] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-400" />
        <div
          className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-emerald-500/15 blur-3xl"
          aria-hidden
        />

        <div className="relative p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                Direct Access Pass
              </p>
              <h2
                id="unlock-modal-title"
                className="mt-2 text-2xl font-semibold tracking-tight text-white"
              >
                Skip the Middleman &amp; Apply Directly
              </h2>
            </div>
            <button
              type="button"
              onClick={closeUnlock}
              className="shrink-0 rounded-lg border border-slate-600/80 bg-[#0D131F] px-2.5 py-1 text-sm text-slate-400 transition hover:border-emerald-500/40 hover:text-emerald-300"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <ul className="mt-5 space-y-2.5">
            {BENEFITS.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 text-sm leading-snug text-slate-300"
              >
                <span
                  className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-400"
                  aria-hidden
                >
                  ✓
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={startCheckout}
            disabled={loading}
            className="mt-6 inline-flex w-full items-center justify-center rounded-full bg-emerald-500 px-5 py-3.5 text-sm font-bold text-[#0B0F17] shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {loading ? 'Redirecting…' : 'Get 3-Day Direct Pass ($1.97)'}
          </button>

          <p className="mt-3 text-center text-[11px] leading-snug text-slate-500">
            ⚡ 3-Day Unlimited Pass ($1.97) • Direct Recruiter Link • Cancel
            Anytime in 1-Click
          </p>

          {error && (
            <p className="mt-2 text-center text-sm text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
