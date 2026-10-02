-- Fix / create application-tracking tables for My Jobs
-- Run in Supabase SQL Editor if /my-jobs reports missing public.user_applications

create extension if not exists "pgcrypto";

create table if not exists public.user_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  applied_at timestamptz not null default now(),
  unique (user_id, job_id)
);

create index if not exists user_applications_user_id_idx
  on public.user_applications (user_id, applied_at desc);

alter table public.user_applications enable row level security;

drop policy if exists "Users read own applications" on public.user_applications;
create policy "Users read own applications"
  on public.user_applications for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own applications" on public.user_applications;
create policy "Users insert own applications"
  on public.user_applications for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own applications" on public.user_applications;
create policy "Users delete own applications"
  on public.user_applications for delete
  to authenticated
  using (auth.uid() = user_id);

-- Also ensure job_alerts exists for lead capture
create table if not exists public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  source text not null default 'popup',
  daily_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists job_alerts_email_lower_uidx
  on public.job_alerts (lower(email));

alter table public.job_alerts enable row level security;

drop policy if exists "Anyone can subscribe to job alerts" on public.job_alerts;
create policy "Anyone can subscribe to job alerts"
  on public.job_alerts for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Users can read own job alerts" on public.job_alerts;
create policy "Users can read own job alerts"
  on public.job_alerts for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "Users can update own job alerts" on public.job_alerts;
create policy "Users can update own job alerts"
  on public.job_alerts for update
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
