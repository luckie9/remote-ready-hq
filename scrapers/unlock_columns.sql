-- Unlock / subscription flag used after Stripe checkout
alter table public.users
  add column if not exists active_subscriber boolean not null default false;

alter table public.users
  add column if not exists unlock_expires_at timestamptz;

create index if not exists users_active_subscriber_idx
  on public.users (active_subscriber)
  where active_subscriber = true;
