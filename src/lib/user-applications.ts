import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabase, isMissingRelationError } from '@/lib/supabase';
import { isLiveScrapedApplyUrl, type Job } from '@/lib/jobs';

type DbError = { code?: string; message?: string } | null;

export type StoredApplication = {
  job: Job;
  applied_at: string;
};

type ApplicationRow = {
  job_id: string;
  created_at?: string | null;
  applied_at?: string | null;
};

const JOB_COLUMNS =
  'id, title, company, location, salary, apply_url, created_at, description';

function missingColumn(error: DbError, column: string): boolean {
  if (!error) return false;
  const message = (error.message ?? '').toLowerCase();
  if (!message.includes(column.toLowerCase())) return false;
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

function noConflictTarget(error: DbError): boolean {
  if (!error) return false;
  return (
    error.code === '42P10' ||
    /on conflict|unique or exclusion constraint/i.test(error.message ?? '')
  );
}

function rowTimestamp(row: ApplicationRow): string {
  return row.created_at || row.applied_at || new Date().toISOString();
}

async function insertPayload(
  client: SupabaseClient,
  userId: string,
  jobId: string,
  payload: Record<string, string>
): Promise<DbError> {
  const upserted = await client
    .from('user_applications')
    .upsert(payload, { onConflict: 'user_id,job_id' });
  if (!upserted.error) return null;
  if (!noConflictTarget(upserted.error)) return upserted.error;

  const existing = await client
    .from('user_applications')
    .select('job_id')
    .eq('user_id', userId)
    .eq('job_id', jobId)
    .limit(1);
  if (existing.error) return existing.error;
  if ((existing.data ?? []).length > 0) return null;

  const inserted = await client.from('user_applications').insert(payload);
  if (inserted.error?.code === '23505') return null;
  return inserted.error;
}

/** Persist one application against the signed-in auth user id. */
export async function saveUserApplication(
  client: SupabaseClient,
  userId: string,
  jobId: string
): Promise<DbError> {
  const now = new Date().toISOString();
  const attempts: Record<string, string>[] = [
    { user_id: userId, job_id: jobId, created_at: now },
    { user_id: userId, job_id: jobId, applied_at: now },
    { user_id: userId, job_id: jobId },
  ];

  let last: DbError = null;
  for (const payload of attempts) {
    last = await insertPayload(client, userId, jobId, payload);
    if (!last) return null;
    if (isMissingRelationError(last)) return last;
    const droppedCreated = 'created_at' in payload && missingColumn(last, 'created_at');
    const droppedApplied = 'applied_at' in payload && missingColumn(last, 'applied_at');
    if (droppedCreated || droppedApplied) continue;
    return last;
  }
  return last;
}

async function listRows(
  client: SupabaseClient,
  userId: string
): Promise<{ rows: ApplicationRow[]; error: DbError }> {
  const primary = await client
    .from('user_applications')
    .select('job_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (!primary.error) {
    return { rows: (primary.data ?? []) as ApplicationRow[], error: null };
  }
  if (!missingColumn(primary.error, 'created_at')) {
    return { rows: [], error: primary.error };
  }

  const retry = await client
    .from('user_applications')
    .select('job_id, applied_at')
    .eq('user_id', userId)
    .order('applied_at', { ascending: false });
  return {
    rows: (retry.data ?? []) as ApplicationRow[],
    error: retry.error,
  };
}

async function loadJobs(
  client: SupabaseClient,
  ids: string[]
): Promise<{ jobs: Job[]; error: DbError }> {
  const res = await client.from('jobs').select(JOB_COLUMNS).in('id', ids);
  return { jobs: (res.data ?? []) as Job[], error: res.error };
}

function combine(
  rows: ApplicationRow[],
  jobs: Job[]
): StoredApplication[] {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const seen = new Set<string>();
  const results: StoredApplication[] = [];
  for (const row of rows) {
    const jobId = row.job_id?.trim();
    if (!jobId || seen.has(jobId)) continue;
    const job = byId.get(jobId);
    if (!job?.title?.trim() || !job.company?.trim()) continue;
    if (!isLiveScrapedApplyUrl(job.apply_url)) continue;
    seen.add(jobId);
    results.push({ job, applied_at: rowTimestamp(row) });
  }
  return results;
}

/**
 * Applications for this auth user, then the matching job rows.
 * The live table has no foreign key to jobs and no applied_at column.
 */
export async function loadUserApplications(
  session: SupabaseClient,
  userId: string
): Promise<StoredApplication[]> {
  let listed = await listRows(session, userId);
  let reader = session;

  if (listed.error) {
    try {
      const admin = createAdminSupabase();
      const adminListed = await listRows(admin, userId);
      if (!adminListed.error) {
        listed = adminListed;
        reader = admin;
      }
    } catch {
      // Service-role key is unset. The session client result stands.
    }
  }

  if (listed.error || listed.rows.length === 0) return [];

  const ids = [
    ...new Set(listed.rows.map((row) => row.job_id?.trim()).filter(Boolean)),
  ] as string[];
  let jobsResult = await loadJobs(reader, ids);
  if (jobsResult.error && reader !== session) {
    jobsResult = await loadJobs(session, ids);
  }
  if (jobsResult.error) return [];
  return combine(listed.rows, jobsResult.jobs);
}
