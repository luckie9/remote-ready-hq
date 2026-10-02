import { NextResponse } from 'next/server';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';

const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: jobs } = await supabase
      .from('jobs')
      .select('*')
      .gte('created_at', yesterday)
      .limit(10);

    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ message: 'No new jobs to send today.' });
    }

    const { data: subscribers } = await supabase
      .from('users')
      .select('email')
      .eq('active_subscriber', true);

    if (!subscribers || subscribers.length === 0) {
      return NextResponse.json({ message: 'No active subscribers found.' });
    }

    const jobListingsHtml = jobs
      .map(
        (job) => `
        <div style="margin-bottom: 16px; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h3 style="margin: 0 0 4px 0; color: #0f172a;">${job.title}</h3>
          <p style="margin: 0 0 8px 0; color: #64748b; font-size: 14px;">${job.company || 'Remote Role'} • ${job.location || 'Worldwide'}</p>
          <a href="https://remote-ready-hq.vercel.app" style="color: #10b981; text-decoration: none; font-weight: bold;">View Details →</a>
        </div>
      `
      )
      .join('');

    const emailPromises = subscribers.map((sub) =>
      resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'RemoteReady HQ <onboarding@resend.dev>',
        to: sub.email,
        subject: `🔥 ${jobs.length} New Remote Roles Added Today | RemoteReady HQ`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Your Daily Remote Job Digest</h2>
            <p>Here are the latest verified remote roles added in the last 24 hours:</p>
            ${jobListingsHtml}
            <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">You are receiving this because you subscribed to daily alerts on RemoteReady HQ.</p>
          </div>
        `,
      })
    );

    await Promise.all(emailPromises);
    return NextResponse.json({ success: true, count: jobs.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
