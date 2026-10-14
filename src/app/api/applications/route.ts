import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminSupabase, isMissingRelationError } from '@/lib/supabase';
import {
  loadUserApplications,
  saveUserApplication,
} from '@/lib/user-applications';

export const dynamic = 'force-dynamic';

async function saveForUser(userId: string, jobId: string) {
  const session = await createClient();
  let error = await saveUserApplication(session, userId, jobId);
  if (!error) return null;
  if (isMissingRelationError(error)) return error;

  try {
    const admin = createAdminSupabase();
    const adminError = await saveUserApplication(admin, userId, jobId);
    if (!adminError) return null;
    return adminError;
  } catch {
    return error;
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ jobIds: [], rows: [] });
    }

    const applications = await loadUserApplications(supabase, user.id);
    return NextResponse.json({
      jobIds: applications.map((row) => row.job.id),
      rows: applications.map((row) => ({
        job_id: row.job.id,
        applied_at: row.applied_at,
      })),
    });
  } catch {
    return NextResponse.json({ jobIds: [], rows: [] });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const body = (await request.json()) as { jobId?: string };
    const jobId = body.jobId?.trim();
    if (!jobId) {
      return NextResponse.json({ error: 'jobId required' }, { status: 400 });
    }

    const error = await saveForUser(user.id, jobId);
    if (error) {
      if (isMissingRelationError(error)) {
        return NextResponse.json({ ok: false, jobIds: [] });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, jobId });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to save application';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
