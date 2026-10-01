import { promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';

const FALLBACK_FILE = path.join(process.cwd(), 'scrapers', '.job_alerts.json');

async function saveFallback(entry: {
  email: string;
  source: string;
  daily_enabled: boolean;
}) {
  let rows: Array<typeof entry & { created_at: string }> = [];
  try {
    const raw = await fs.readFile(FALLBACK_FILE, 'utf8');
    rows = JSON.parse(raw) as typeof rows;
  } catch {
    rows = [];
  }
  const idx = rows.findIndex(
    (r) => r.email.toLowerCase() === entry.email.toLowerCase()
  );
  const next = { ...entry, created_at: new Date().toISOString() };
  if (idx >= 0) rows[idx] = next;
  else rows.push(next);
  await fs.writeFile(FALLBACK_FILE, JSON.stringify(rows, null, 2), 'utf8');
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      source?: string;
      dailyEnabled?: boolean;
    };
    const email = (body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    const payload = {
      email,
      source: body.source || 'popup',
      daily_enabled: body.dailyEnabled ?? true,
    };

    try {
      const admin = createAdminSupabase();
      const { error } = await admin.from('job_alerts').upsert(payload, {
        onConflict: 'email',
      });
      if (error) {
        // Table missing or schema cache — fall back to local file store
        if (
          /PGRST205|Could not find the table|relation .* does not exist/i.test(
            error.message
          )
        ) {
          await saveFallback(payload);
          return NextResponse.json({
            ok: true,
            storage: 'fallback',
            hint: 'Run scrapers/auth_tables.sql in Supabase SQL Editor for cloud persistence.',
          });
        }
        await saveFallback(payload);
        return NextResponse.json({
          ok: true,
          storage: 'fallback',
          warning: error.message,
        });
      }
      return NextResponse.json({ ok: true, storage: 'supabase' });
    } catch (err) {
      await saveFallback(payload);
      return NextResponse.json({
        ok: true,
        storage: 'fallback',
        warning: err instanceof Error ? err.message : 'fallback',
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save alert';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
