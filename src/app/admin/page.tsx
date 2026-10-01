'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';

type Stats = {
  email_leads_captured: number;
  total_paid_unlocks: number;
  active_registered_users: number;
  sources?: Record<string, string>;
  generated_at?: string;
  viewer?: string;
  error?: string;
};

const CARDS: {
  key: keyof Pick<
    Stats,
    | 'email_leads_captured'
    | 'total_paid_unlocks'
    | 'active_registered_users'
  >;
  label: string;
  hint: string;
}[] = [
  {
    key: 'email_leads_captured',
    label: 'Email Leads Captured',
    hint: 'job_alerts table',
  },
  {
    key: 'total_paid_unlocks',
    label: 'Paid Unlocks / Applications',
    hint: 'user_applications table',
  },
  {
    key: 'active_registered_users',
    label: 'Active Registered Users',
    hint: 'auth / users',
  },
];

export default function AdminPage() {
  const { user, loading, openAuth } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setStats(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setMessage('');
    fetch('/api/admin/stats')
      .then(async (res) => {
        const data = (await res.json()) as Stats;
        if (cancelled) return;
        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || 'Unauthorized — add your email to ADMIN_EMAILS');
          setStats(null);
          return;
        }
        setStats(data);
        setStatus('idle');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to load stats');
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  return (
    <main className="flex min-h-full flex-1 flex-col bg-slate-950 text-slate-100">
      <SiteHeader />
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-400">
          Internal
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          Admin Dashboard
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          Conversion funnel metrics from Supabase. Traffic &amp; time-on-site live
          in PostHog / Vercel Analytics.
        </p>

        {loading ? (
          <p className="mt-10 text-sm text-slate-500">Checking session…</p>
        ) : !user ? (
          <div className="mt-10 rounded-2xl border border-slate-800 bg-[#161F2E] p-6">
            <p className="text-sm text-slate-300">
              Sign in with an admin account to view metrics.
            </p>
            <button
              type="button"
              onClick={openAuth}
              className="mt-4 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-bold text-[#0B0F17] transition hover:bg-emerald-400"
            >
              Sign In
            </button>
          </div>
        ) : status === 'error' ? (
          <div className="mt-10 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-200">
            <p>{message}</p>
            <p className="mt-2 text-amber-200/70">
              Set{' '}
              <code className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
                ADMIN_EMAILS={user.email}
              </code>{' '}
              in <code className="text-xs">.env.local</code>, then restart the
              server.
            </p>
          </div>
        ) : status === 'loading' || !stats ? (
          <p className="mt-10 text-sm text-slate-500">Loading metrics…</p>
        ) : (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {CARDS.map((card) => (
                <div
                  key={card.key}
                  className="rounded-2xl border border-slate-800 bg-[#161F2E] p-5 shadow-sm shadow-black/20"
                >
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {card.label}
                  </p>
                  <p className="mt-3 text-3xl font-bold tabular-nums text-emerald-300">
                    {stats[card.key].toLocaleString()}
                  </p>
                  <p className="mt-2 text-[11px] text-slate-500">
                    {card.key === 'email_leads_captured'
                      ? stats.sources?.email_leads || card.hint
                      : card.key === 'total_paid_unlocks'
                        ? stats.sources?.paid_unlocks || card.hint
                        : stats.sources?.active_users || card.hint}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Viewer: {stats.viewer} · Generated{' '}
              {stats.generated_at
                ? new Date(stats.generated_at).toLocaleString()
                : '—'}
            </p>
            <div className="mt-8 rounded-2xl border border-slate-800 bg-[#0D131F] p-5 text-sm text-slate-400">
              <p className="font-semibold text-slate-200">Funnel events</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <code className="text-emerald-400/90">page_viewed</code>
                </li>
                <li>
                  <code className="text-emerald-400/90">job_card_expanded</code>
                </li>
                <li>
                  <code className="text-emerald-400/90">
                    job_alert_email_submitted
                  </code>
                </li>
                <li>
                  <code className="text-emerald-400/90">unlock_pass_clicked</code>
                </li>
                <li>
                  <code className="text-emerald-400/90">checkout_completed</code>
                </li>
              </ul>
              <p className="mt-3">
                API:{' '}
                <Link
                  href="/api/admin/stats"
                  className="text-emerald-400 underline-offset-2 hover:underline"
                >
                  /api/admin/stats
                </Link>
              </p>
            </div>
          </>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}
