#!/usr/bin/env node
/**
 * Manually grant unlock / subscription for an email in Supabase.
 *
 * Usage:
 *   node scripts/grant-unlock.cjs luckief9@gmail.com
 *   node scripts/grant-unlock.cjs luckief9@gmail.com --days=365
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env.local');

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

async function main() {
  const emailArg = process.argv[2];
  const daysArg = process.argv.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) : 365;

  const email = (emailArg || 'luckief9@gmail.com').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('Usage: node scripts/grant-unlock.cjs <email> [--days=365]');
    process.exit(1);
  }

  const env = loadEnv(envPath);
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const key =
    env.SUPABASE_SECRET_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local');
    process.exit(1);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const periodEnd = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const nowIso = new Date().toISOString();
  const periodEndIso = periodEnd.toISOString();
  const manualSubId = `manual_${email.replace(/[^a-z0-9]/gi, '_')}`;

  console.log(`Granting unlock to ${email} until ${periodEndIso}…`);

  // Upsert users row
  const { data: existingUser, error: userLookupErr } = await admin
    .from('users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();

  if (userLookupErr) {
    console.warn('users lookup warning:', userLookupErr.message);
  }

  let userId = existingUser?.id;
  if (!userId) {
    const { data: created, error: createErr } = await admin
      .from('users')
      .insert({
        email,
        updated_at: nowIso,
      })
      .select('id')
      .single();
    if (createErr) {
      console.error('Failed to create users row:', createErr.message);
      process.exit(1);
    }
    userId = created.id;
    console.log('Created users row', userId);
  } else {
    await admin
      .from('users')
      .update({ updated_at: nowIso })
      .eq('id', userId);
    console.log('Updated users row', userId);
  }

  // Find existing subscription by email or manual id
  const { data: existingSubs } = await admin
    .from('subscriptions')
    .select('id, stripe_subscription_id')
    .eq('email', email)
    .limit(5);

  const row = {
    user_id: userId,
    email,
    stripe_subscription_id: manualSubId,
    stripe_price_id: 'manual_unlock',
    status: 'active',
    plan: 'monthly',
    current_period_end: periodEndIso,
    updated_at: nowIso,
  };

  const existing =
    (existingSubs || []).find((s) => s.stripe_subscription_id === manualSubId) ||
    (existingSubs || [])[0];

  if (existing?.id) {
    const { error } = await admin
      .from('subscriptions')
      .update(row)
      .eq('id', existing.id);
    if (error) {
      console.error('Failed to update subscription:', error.message);
      process.exit(1);
    }
    console.log('Updated subscription', existing.id);
  } else {
    const { data: inserted, error } = await admin
      .from('subscriptions')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.error('Failed to insert subscription:', error.message);
      process.exit(1);
    }
    console.log('Inserted subscription', inserted.id);
  }

  // Verify
  const { data: verify, error: verifyErr } = await admin
    .from('subscriptions')
    .select('id, email, status, plan, current_period_end, stripe_subscription_id')
    .eq('email', email)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (verifyErr) {
    console.error('Verify failed:', verifyErr.message);
    process.exit(1);
  }

  console.log('\nDone. Current subscription row:');
  console.log(JSON.stringify(verify, null, 2));
  console.log(`
SQL equivalent (run in Supabase SQL editor if preferred):

insert into public.users (email, updated_at)
values ('${email}', now())
on conflict (email) do update set updated_at = now();

insert into public.subscriptions (
  user_id, email, stripe_subscription_id, stripe_price_id,
  status, plan, current_period_end, updated_at
)
select u.id, '${email}', '${manualSubId}', 'manual_unlock',
       'active', 'monthly', '${periodEndIso}'::timestamptz, now()
from public.users u
where lower(u.email) = '${email}'
on conflict (stripe_subscription_id) do update
set status = 'active',
    plan = 'monthly',
    current_period_end = excluded.current_period_end,
    updated_at = now();
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
