import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import {
  createAdminSupabase,
  isMissingRelationError,
} from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FALLBACK_ALERTS = path.join(
  process.cwd(),
  'scrapers',
  '.job_alerts.json'
);

const PRODUCTION_APP_URL = 'https://remote-ready-hq.vercel.app';
const MAX_JOBS_IN_EMAIL = 12;
const BATCH_SIZE = 50;

type DigestJob = {
  id: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  apply_url: string;
  created_at: string | null;
};

type AlertSubscriber = {
  email: string;
  daily_enabled?: boolean | null;
};

function appUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '');
  if (fromEnv && !/localhost|127\.0\.0\.1/i.test(fromEnv)) return fromEnv;
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, '')}`;
  }
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    return PRODUCTION_APP_URL;
  }
  return fromEnv || 'http://localhost:3000';
}

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  const auth = request.headers.get('authorization');
  if (auth === `Bearer ${secret}`) return true;

  // Allow header variants some schedulers send
  const cronHeader = request.headers.get('x-cron-secret');
  if (cronHeader === secret) return true;

  const url = new URL(request.url);
  if (url.searchParams.get('secret') === secret) return true;

  return false;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildDigestHtml(jobs: DigestJob[], siteUrl: string): string {
  const rows = jobs
    .map((job) => {
      const salary = job.salary
        ? `<span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;background:#059669;color:#fff;font-size:12px;font-weight:700;">${escapeHtml(job.salary)}</span>`
        : '';
      const location = job.location
        ? escapeHtml(job.location)
        : 'Remote';
      return `
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #e2e8f0;">
            <a href="${escapeHtml(siteUrl)}/?job=${encodeURIComponent(job.id)}" style="color:#0f172a;text-decoration:none;font-size:16px;font-weight:700;">
              ${escapeHtml(job.title)}
            </a>
            <div style="margin-top:4px;color:#475569;font-size:14px;">
              ${escapeHtml(job.company)} · ${location}
            </div>
            ${salary}
            <div style="margin-top:10px;">
              <a href="${escapeHtml(siteUrl)}/?job=${encodeURIComponent(job.id)}" style="display:inline-block;padding:8px 14px;border-radius:999px;background:#10b981;color:#0b0f17;font-size:13px;font-weight:700;text-decoration:none;">
                View role
              </a>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:0;background:#0b1220;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 12px;background:#0f172a;">
              <div style="color:#34d399;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">RemoteReady HQ</div>
              <h1 style="margin:10px 0 0;color:#ffffff;font-size:24px;line-height:1.25;">Today's remote openings</h1>
              <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">${escapeHtml(dateLabel)} · ${jobs.length} new role${jobs.length === 1 ? '' : 's'}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 28px;">
              <a href="${escapeHtml(siteUrl)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0f172a;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">
                Browse all remote jobs
              </a>
              <p style="margin:16px 0 0;color:#64748b;font-size:12px;line-height:1.5;">
                You’re receiving this because you subscribed to daily job alerts on RemoteReady HQ.
                Manage preferences on your <a href="${escapeHtml(siteUrl)}/profile" style="color:#059669;">profile</a>.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function loadSubscribers(): Promise<string[]> {
  const emails = new Set<string>();

  try {
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from('job_alerts')
      .select('email, daily_enabled')
      .eq('daily_enabled', true);

    if (!error && data) {
      for (const row of data as AlertSubscriber[]) {
        const email = row.email?.trim().toLowerCase();
        if (email) emails.add(email);
      }
    } else if (error && !isMissingRelationError(error)) {
      console.warn('[email-digest] job_alerts query warning:', error.message);
    }
  } catch (err) {
    console.warn(
      '[email-digest] Supabase subscribers unavailable:',
      err instanceof Error ? err.message : err
    );
  }

  // Merge local fallback file (dev / missing table)
  try {
    const raw = await fs.readFile(FALLBACK_ALERTS, 'utf8');
    const rows = JSON.parse(raw) as AlertSubscriber[];
    for (const row of rows) {
      if (row.daily_enabled === false) continue;
      const email = row.email?.trim().toLowerCase();
      if (email && !email.endsWith('@example.com')) emails.add(email);
    }
  } catch {
    // no fallback file
  }

  return [...emails];
}

async function loadRecentJobs(): Promise<DigestJob[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('jobs')
    .select('id, title, company, location, salary, apply_url, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_JOBS_IN_EMAIL);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as DigestJob[];
}

async function runDigest() {
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (!resendKey) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY is not configured' },
      { status: 500 }
    );
  }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    'RemoteReady HQ <onboarding@resend.dev>';

  const siteUrl = appUrl();
  const jobs = await loadRecentJobs();
  const subscribers = await loadSubscribers();

  if (jobs.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'No new jobs in the last 24 hours',
      subscribers: subscribers.length,
    });
  }

  if (subscribers.length === 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'No daily digest subscribers',
      jobs: jobs.length,
    });
  }

  const resend = new Resend(resendKey);
  const html = buildDigestHtml(jobs, siteUrl);
  const subject = `${jobs.length} new remote role${jobs.length === 1 ? '' : 's'} today — RemoteReady HQ`;

  let sent = 0;
  const failures: { email: string; error: string }[] = [];

  for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
    const chunk = subscribers.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      chunk.map(async (email) => {
        const { error } = await resend.emails.send({
          from,
          to: email,
          subject,
          html,
        });
        if (error) {
          return { email, error: error.message };
        }
        return { email, error: null as string | null };
      })
    );

    for (const result of results) {
      if (result.error) failures.push({ email: result.email, error: result.error });
      else sent += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    jobs: jobs.length,
    subscribers: subscribers.length,
    sent,
    failed: failures.length,
    failures: failures.slice(0, 10),
  });
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return await runDigest();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Digest failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
