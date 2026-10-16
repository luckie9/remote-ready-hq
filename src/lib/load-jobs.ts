import {
  applicantsToday,
  deriveBadges,
  formatRelativeTime,
  isLiveScrapedApplyUrl,
  lockedDomainPreview,
  socialProofLine,
  type Job,
} from '@/lib/jobs';
import { createAdminSupabase, supabase } from '@/lib/supabase';

/** Active scraped listings, newest first. */
export async function loadLiveJobs(): Promise<{
  jobs: Job[];
  errorMessage: string | null;
}> {
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
      return { jobs: [], errorMessage: error.message };
    }

    const jobs = ((data ?? []) as Job[])
      .filter(
        (job) =>
          isLiveScrapedApplyUrl(job.apply_url) &&
          Boolean(job.title?.trim()) &&
          Boolean(job.company?.trim())
      )
      .map((job) => {
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

    return { jobs, errorMessage: null };
  } catch (err) {
    return {
      jobs: [],
      errorMessage:
        err instanceof Error ? err.message : 'Unknown database connection error',
    };
  }
}
