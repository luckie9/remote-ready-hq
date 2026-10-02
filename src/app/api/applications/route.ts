import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  createAdminSupabase,
  isMissingRelationError,
} from '@/lib/supabase';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ jobIds: [] });
    }

    let data: { job_id: string; applied_at: string }[] | null = null;
    let error: { code?: string; message?: string } | null = null;

    try {
      const admin = createAdminSupabase();
      const res = await admin
        .from('user_applications')
        .select('job_id, applied_at')
        .eq('user_id', user.id)
        .order('applied_at', { ascending: false });
      data = res.data;
      error = res.error;
    } catch {
      const res = await supabase
        .from('user_applications')
        .select('job_id, applied_at')
        .eq('user_id', user.id)
        .order('applied_at', { ascending: false });
      data = res.data;
      error = res.error;
    }

    if (error) {
      if (isMissingRelationError(error)) {
        return NextResponse.json({
          jobIds: [],
          rows: [],
          tableMissing: true,
        });
      }
      return NextResponse.json(
        { error: error.message, jobIds: [] },
        { status: 500 }
      );
    }

    return NextResponse.json({
      jobIds: (data ?? []).map((row) => row.job_id as string),
      rows: data ?? [],
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to load applications';
    if (isMissingRelationError({ message })) {
      return NextResponse.json({
        jobIds: [],
        rows: [],
        tableMissing: true,
      });
    }
    return NextResponse.json({ error: message, jobIds: [] }, { status: 500 });
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

    const payload = {
      user_id: user.id,
      job_id: jobId,
      applied_at: new Date().toISOString(),
    };

    let error: { code?: string; message?: string } | null = null;
    try {
      const admin = createAdminSupabase();
      const res = await admin
        .from('user_applications')
        .upsert(payload, { onConflict: 'user_id,job_id' });
      error = res.error;
    } catch {
      const res = await supabase
        .from('user_applications')
        .upsert(payload, { onConflict: 'user_id,job_id' });
      error = res.error;
    }

    if (error) {
      if (isMissingRelationError(error)) {
        return NextResponse.json(
          {
            error:
              'Application tracking table is missing. Run scrapers/fix_schema.sql in Supabase.',
            tableMissing: true,
            ok: false,
          },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to save application';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
