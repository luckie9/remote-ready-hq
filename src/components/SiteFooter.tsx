'use client';

import Link from 'next/link';
import { CancelSubscriptionLink } from '@/components/CancelSubscriptionLink';
import { JobAlertForm } from '@/components/JobAlertForm';
import { useAuth } from '@/components/AuthProvider';

export function SiteFooter() {
  const { hideJobAlerts, hasSubscribedAlerts, jobAlertsReady } = useAuth();
  const showEmailPrompt =
    jobAlertsReady && (hasSubscribedAlerts || !hideJobAlerts);

  return (
    <footer className="mt-20 border-t border-slate-800">
      <div className="mx-auto max-w-5xl px-6 py-14">
        {showEmailPrompt && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-8 text-center sm:px-10">
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              Get new remote jobs in your inbox every week.
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
              A short digest of verified openings — no spam, no recruiter blasts.
            </p>
            <JobAlertForm />
          </div>
        )}

        <div className="mt-10 flex flex-col items-center justify-between gap-4 text-sm text-slate-500 sm:flex-row">
          <p className="font-medium text-slate-300">RemoteReady HQ</p>
          <nav className="flex flex-wrap items-center justify-center gap-5">
            <Link href="/" className="transition hover:text-white">
              Jobs
            </Link>
            <Link href="/pricing" className="transition hover:text-white">
              Pricing
            </Link>
            <a
              href="mailto:hello@remoteready.hq"
              className="transition hover:text-white"
            >
              Contact
            </a>
          </nav>
          <p className="flex flex-col items-center gap-2 text-xs text-slate-600 sm:items-end">
            <span>Curated remote roles</span>
            <CancelSubscriptionLink
              whenActive
              label="Cancel subscription"
              className="text-xs font-normal text-slate-600 underline decoration-slate-700 underline-offset-2 transition hover:text-slate-400 disabled:opacity-60"
            />
          </p>
        </div>
      </div>
    </footer>
  );
}
