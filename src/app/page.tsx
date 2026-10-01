import { BrandMark } from '@/components/BrandMark';
import { JobBoard } from '@/components/JobBoard';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { createAdminSupabase, supabase } from '@/lib/supabase';
import { getSubscriberSession } from '@/lib/subscription';
import {
  applicantsToday,
  deriveBadges,
  formatRelativeTime,
  lockedDomainPreview,
  minutesSince,
  socialProofLine,
  type Job,
} from '@/lib/jobs';

export const revalidate = 0;

const TRUST_ITEMS = [
  '✓ 100% Verified Employer Links',
  '✓ Direct Recruiter Applications',
  '✓ Updated Daily',
] as const;

export default async function Home() {
  const subscriber = await getSubscriberSession();
  const isSubscriber = Boolean(subscriber);

  let jobs: Job[] = [];
  let errorMessage: string | null = null;

  try {
    const client = (() => {
      try {
        return createAdminSupabase();
      } catch {
        return supabase;
      }
    })();

    const { data, error } = await client
      .from('jobs')
      .select(
        'id, title, company, location, salary, apply_url, created_at, description'
      )
      .order('created_at', { ascending: false });

    if (error) {
      errorMessage = error.message;
    } else {
      jobs = ((data ?? []) as Job[]).map((job) => {
        const badges = deriveBadges(job);
        return {
          ...job,
          posted_label: formatRelativeTime(job.created_at),
          badges,
          locked_domain: lockedDomainPreview(job.apply_url),
          applicants_today: applicantsToday(job.id),
          social_proof: socialProofLine(job.id, badges),
        };
      });
    }
  } catch (err) {
    errorMessage =
      err instanceof Error ? err.message : 'Unknown database connection error';
  }

  const freshest = jobs[0]?.created_at ?? null;
  const updatedMins = minutesSince(freshest);
  const roleCount = Math.max(jobs.length, 120);

  return (
    <main className="flex-1 bg-slate-950 text-slate-100">
      <div className="border-b border-emerald-500/20 bg-emerald-950 text-emerald-50">
        <p className="mx-auto flex max-w-5xl items-center justify-center gap-2 px-6 py-2 text-center text-xs font-medium tracking-wide sm:text-sm">
          <span aria-hidden>🟢</span>
          <span>
            LIVE UPDATES: {roleCount}+ Vetted Remote Roles • Updated{' '}
            {updatedMins} minute{updatedMins === 1 ? '' : 's'} ago
          </span>
        </p>
      </div>

      <div className="mx-auto max-w-5xl px-6 pb-8 pt-8 sm:pt-10">
        <SiteHeader />

        <header className="animate-rise-delay mx-auto max-w-3xl px-2 pt-14 pb-10 text-center sm:pt-16 sm:pb-12">
          <div className="flex justify-center">
            <BrandMark size="hero" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white sm:text-[1.85rem] sm:leading-snug">
            Curated Remote Jobs for Support, Sales &amp; Tech
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg">
            Hand-picked, active remote roles from top global companies. Unlock
            direct recruiter application links with a $1.97 3-day pass.
          </p>

          <ul className="mt-8 flex flex-wrap items-center justify-center gap-2">
            {TRUST_ITEMS.map((item) => (
              <li
                key={item}
                className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200"
              >
                {item}
              </li>
            ))}
          </ul>
        </header>

        <section className="animate-rise-delay-2">
          {errorMessage ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-950/40 px-5 py-4 text-red-200">
              Failed to load jobs. Please check database connection.
              {process.env.NODE_ENV === 'development' && (
                <p className="mt-2 break-all font-mono text-sm text-red-300/80">
                  {errorMessage}
                </p>
              )}
            </div>
          ) : jobs.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-16 text-center text-slate-400">
              No jobs posted yet. Check back shortly.
            </div>
          ) : (
            <JobBoard jobs={jobs} isSubscriber={isSubscriber} />
          )}
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
