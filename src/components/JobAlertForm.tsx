'use client';

import { useState, type FormEvent } from 'react';
import {
  ALERT_SUBSCRIBED_KEY,
  useAuth,
} from '@/components/AuthProvider';
import { track } from '@/lib/analytics';

export function JobAlertForm() {
  const { markAlertSubscribed, hasSubscribedAlerts } = useAuth();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    hasSubscribedAlerts ? 'done' : 'idle'
  );
  const [message, setMessage] = useState(
    hasSubscribedAlerts
      ? "You're on the list — we'll send the next daily digest."
      : ''
  );

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
        body: JSON.stringify({ email: value, source: 'footer' }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || 'Unable to save alert');
      track('job_alert_email_submitted', { source: 'footer' });
      window.localStorage.setItem(ALERT_SUBSCRIBED_KEY, '1');
      markAlertSubscribed();
      setStatus('done');
      setMessage("You're on the list — we'll send the next daily digest.");
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  if (status === 'done') {
    return (
      <p className="mt-6 text-sm font-medium text-emerald-400">{message}</p>
    );
  }

  return (
    <form
      className="mx-auto mt-6 flex max-w-md flex-col gap-2 sm:flex-row"
      onSubmit={onSubmit}
    >
      <label className="sr-only" htmlFor="job-alert-email">
        Email
      </label>
      <input
        id="job-alert-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-[#0B0F17] transition hover:bg-emerald-400 disabled:opacity-60"
      >
        {status === 'loading' ? 'Saving…' : 'Subscribe'}
      </button>
      {status === 'error' && (
        <p className="w-full text-sm text-red-400 sm:col-span-2">{message}</p>
      )}
    </form>
  );
}
