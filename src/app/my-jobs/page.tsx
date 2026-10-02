import Link from 'next/link';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { createClient } from '@/lib/supabase/server';
import {
  createAdminSupabase,
  isMissingRelationError,
} from '@/lib/supabase';
import {
  formatLocation,
  formatRelativeTime,
  formatSalaryHighlight,
  type Job,
} from '@/lib/jobs';

export const revalidate = 0;

type AppliedRow = {
  job_id: string;
  applied_at?: string | null;
  created_at?: string | null;
  jobs: Job | Job[] | null;
};

function rowTimestamp(row: AppliedRow): string {
  return row.applied_at || row.created_at || new Date().toISOString();
}

export default async function MyJobsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let rows: {
    job: Job;
    applied_at: string;
  }[] = [];
  let setupHint: string | null = null;

  if (user) {
    try {
      let data: AppliedRow[] | null = null;
      let error: { code?: string; message?: string } | null = null;

      const selectCols =
        'job_id, applied_at, created_at, jobs ( id, title, company, location, salary, apply_url, created_at, description )';

      try {
        const admin = createAdminSupabase();
        const res = await admin
          .from('user_applications')
          .select(selectCols)
          .eq('user_id', user.id)
          .order('applied_at', { ascending: false });
        data = (res.data as AppliedRow[] | null) ?? null;
        error = res.error;

        // If applied_at column missing, retry with created_at only
        if (error && /applied_at/i.test(error.message || '')) {
          const retry = await admin
            .from('user_applications')
            .select(
              'job_id, created_at, jobs ( id, title, company, location, salary, apply_url, created_at, description )'
            )
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
          data = (retry.data as AppliedRow[] | null) ?? null;
          error = retry.error;
        }
      } catch (adminErr) {
        const res = await supabase
          .from('user_applications')
          .select(selectCols)
          .eq('user_id', user.id)
          .order('applied_at', { ascending: false });
        data = (res.data as AppliedRow[] | null) ?? null;
        error =
          res.error ??
          (adminErr instanceof Error
            ? { message: adminErr.message }
            : { message: 'Failed to load applications' });
      }

      if (error) {
        if (isMissingRelationError(error)) {
          // Missing table: show empty state + soft setup hint (never a red crash)
          rows = [];
          setupHint =
            'Application tracking is not configured yet. Run scrapers/fix_schema.sql in Supabase, then apply to a job.';
        } else {
          // Soft-fail unknown errors to empty list so UI stays usable
          rows = [];
          setupHint = error.message || 'Could not load saved applications right now.';
        }
      } else {
        rows = (data ?? [])
          .map((row) => {
            const job = Array.isArray(row.jobs) ? row.jobs[0] : row.jobs;
            if (!job) return null;
            return { job, applied_at: rowTimestamp(row) };
          })
          .filter(Boolean) as { job: Job; applied_at: string }[];
      }
    } catch {
      rows = [];
      setupHint =
        'Application tracking is not available right now. You can still browse and unlock jobs.';
    }
  }

  return (
    <main className="flex-1 bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 pb-8 pt-8 sm:pt-10">
        <SiteHeader />

        <div className="mx-auto max-w-3xl pt-12 pb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            My Jobs
          </h1>
          <p className="mt-2 text-slate-400">
            Roles you&apos;ve unlocked or marked as applied — newest first.
          </p>
        </div>

        {!user ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-14 text-center">
            <p className="text-lg font-semibold text-white">
              Sign in to track applications
            </p>
            <p className="mt-2 text-sm text-slate-400">
              Use the Sign In button in the header with your email and password.
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Browse jobs
            </Link>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-14 text-center text-slate-400">
            <p>No applications yet. Unlock a role and click Apply to save it here.</p>
            {setupHint && (
              <p className="mx-auto mt-3 max-w-md text-xs text-slate-500">
                {setupHint}
              </p>
            )}
            <div className="mt-6">
              <Link
                href="/"
                className="inline-flex rounded-full border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 hover:border-slate-600"
              >
                Find jobs
              </Link>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-4">
            {rows.map(({ job, applied_at }) => {
              const salary = formatSalaryHighlight(job.salary);
              return (
                <li
                  key={`${job.id}-${applied_at}`}
                  className="rounded-xl border border-slate-800 bg-[#161F2E] px-5 py-5 transition hover:border-slate-700 sm:px-6"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                      ✓ APPLIED
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatRelativeTime(applied_at)}
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-semibold text-white">
                    {job.title}
                  </h2>
                  <p className="mt-1 text-sm text-slate-400">{job.company}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-300">
                    <span className="rounded-full border border-slate-700 bg-slate-800/70 px-2.5 py-0.5">
                      {formatLocation(job.location)}
                    </span>
                    {salary && (
                      <span className="rounded-md bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">
                        {salary}
                      </span>
                    )}
                  </div>
                  <a
                    href={job.apply_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                  >
                    Open application
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}
