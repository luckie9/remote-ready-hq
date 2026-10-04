-- RemoteReady HQ schema (matches live project)
-- jobs columns confirmed via PostgREST OpenAPI

create extension if not exists "pgcrypto";

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company text not null,
  location text,
  salary text,
  description text,
  apply_url text not null,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness (legacy + safety net)
create unique index if not exists jobs_apply_url_uidx
  on public.jobs (lower(apply_url));

-- Exact uniqueness for normalized apply_url values written by the scraper
create unique index if not exists jobs_apply_url_exact_uidx
  on public.jobs (apply_url);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  stripe_customer_id text,
  active_subscriber boolean not null default false,
  unlock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.users
  add column if not exists active_subscriber boolean not null default false;
alter table public.users
  add column if not exists unlock_expires_at timestamptz;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  email text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  status text not null default 'inactive',
  plan text not null default 'none',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.jobs enable row level security;
alter table public.users enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Public read jobs" on public.jobs;
create policy "Public read jobs"
  on public.jobs for select
  to anon, authenticated
  using (true);

-- Job alert lead capture (daily digest emails)
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

-- Applied / unlocked job tracking (My Jobs)
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
