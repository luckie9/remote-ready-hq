import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { hasAdminApiSecret, requireAdminUser } from '@/lib/admin';
import { createAdminSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const FALLBACK_ALERTS = path.join(
  process.cwd(),
  'scrapers',
  '.job_alerts.json'
);

async function countFallbackAlerts(): Promise<number> {
  try {
    const raw = await fs.readFile(FALLBACK_ALERTS, 'utf8');
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

async function countAuthUsers(
  admin: ReturnType<typeof createAdminSupabase>
): Promise<number | null> {
  try {
    let page = 1;
    let total = 0;
    for (; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) return null;
      const batch = data?.users?.length ?? 0;
      total += batch;
      if (batch < 200) break;
    }
    return total;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const adminUser = await requireAdminUser();
  if (!adminUser && !hasAdminApiSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let emailLeads = 0;
  let paidUnlocks = 0;
  let activeUsers = 0;
  const sources: Record<string, string> = {};

  try {
    const admin = createAdminSupabase();

    const [alertsRes, appsRes, usersRes] = await Promise.all([
      admin.from('job_alerts').select('*', { count: 'exact', head: true }),
      admin
        .from('user_applications')
        .select('*', { count: 'exact', head: true }),
      admin.from('users').select('*', { count: 'exact', head: true }),
    ]);

    if (!alertsRes.error && typeof alertsRes.count === 'number') {
      emailLeads = alertsRes.count;
      sources.email_leads = 'job_alerts';
    } else {
      emailLeads = await countFallbackAlerts();
      sources.email_leads = 'fallback_file';
    }

    if (!appsRes.error && typeof appsRes.count === 'number') {
      paidUnlocks = appsRes.count;
      sources.paid_unlocks = 'user_applications';
    } else {
      sources.paid_unlocks = 'unavailable';
    }

    const authCount = await countAuthUsers(admin);
    if (authCount !== null) {
      activeUsers = authCount;
      sources.active_users = 'auth.users';
    } else if (!usersRes.error && typeof usersRes.count === 'number') {
      activeUsers = usersRes.count;
      sources.active_users = 'public.users';
    } else {
      sources.active_users = 'unavailable';
    }
  } catch {
    emailLeads = await countFallbackAlerts();
    sources.email_leads = 'fallback_file';
    sources.paid_unlocks = 'unavailable';
    sources.active_users = 'unavailable';
  }

  return NextResponse.json({
    email_leads_captured: emailLeads,
    total_paid_unlocks: paidUnlocks,
    active_registered_users: activeUsers,
    sources,
    generated_at: new Date().toISOString(),
    viewer: adminUser?.email ?? 'api-secret',
  });
}
