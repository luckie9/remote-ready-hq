'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { useAuth } from '@/components/AuthProvider';

export default function ProfilePage() {
  const { user, loading, openAuth, openAlert, signOut, appliedJobIds } =
    useAuth();
  const [dailyEnabled, setDailyEnabled] = useState(true);
  const [saveMsg, setSaveMsg] = useState('');

  async function saveAlertPreference() {
    if (!user?.email) {
      openAuth();
      return;
    }
    setSaveMsg('');
    const res = await fetch('/api/job-alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        source: 'profile',
        dailyEnabled,
      }),
    });
    if (res.ok) setSaveMsg('Alert preferences saved.');
    else setSaveMsg('Could not save preferences.');
  }

  return (
    <main className="flex-1 bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 pb-8 pt-8 sm:pt-10">
        <SiteHeader />

        <div className="mx-auto max-w-2xl pt-12 pb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Profile
          </h1>
          <p className="mt-2 text-slate-400">
            Account preferences, alerts, and subscription status.
          </p>

          <div className="mt-8 space-y-4">
            <section className="rounded-xl border border-slate-800 bg-[#161F2E] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Account
              </h2>
              {loading ? (
                <p className="mt-3 text-slate-400">Loading…</p>
              ) : user ? (
                <div className="mt-3 space-y-3">
                  <p className="text-white">
                    Signed in as{' '}
                    <span className="font-semibold">
                      {(() => {
                        const fullName =
                          (typeof user.user_metadata?.full_name === 'string' &&
                            user.user_metadata.full_name.trim()) ||
                          (typeof user.user_metadata?.name === 'string' &&
                            user.user_metadata.name.trim()) ||
                          '';
                        if (fullName && user.email) {
                          return `${fullName} (${user.email})`;
                        }
                        return fullName || user.email || 'your account';
                      })()}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-600"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <p className="text-slate-400">You&apos;re browsing as a guest.</p>
                  <button
                    type="button"
                    onClick={openAuth}
                    className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-100"
                  >
                    Sign In
                  </button>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-[#161F2E] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Subscription
              </h2>
              <p className="mt-3 text-sm text-slate-300">
                Unlock direct recruiter links with a $1.97 3-day pass, then
                $13.97/mo.
              </p>
              <Link
                href="/pricing"
                className="mt-4 inline-flex rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
              >
                View pricing
              </Link>
            </section>

            <section className="rounded-xl border border-slate-800 bg-[#161F2E] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Daily job alerts
              </h2>
              <label className="mt-4 flex items-center gap-3 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={dailyEnabled}
                  onChange={(e) => setDailyEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500"
                />
                Email me a daily digest of new remote roles
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveAlertPreference()}
                  className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                >
                  Save preferences
                </button>
                <button
                  type="button"
                  onClick={openAlert}
                  className="rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-600"
                >
                  Open alerts popup
                </button>
              </div>
              {saveMsg && (
                <p className="mt-3 text-sm text-emerald-400">{saveMsg}</p>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-[#161F2E] p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Application activity
              </h2>
              <p className="mt-3 text-white">
                <span className="text-2xl font-bold">{appliedJobIds.size}</span>{' '}
                <span className="text-slate-400">roles tracked</span>
              </p>
              <Link
                href="/my-jobs"
                className="mt-4 inline-flex text-sm font-medium text-emerald-400 hover:text-emerald-300"
              >
                View My Jobs →
              </Link>
            </section>
          </div>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
