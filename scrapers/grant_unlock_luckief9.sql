-- Manual unlock for luckief9@gmail.com (active through ~1 year)
-- Run in Supabase Dashboard → SQL Editor

insert into public.users (email, updated_at)
values ('luckief9@gmail.com', now())
on conflict (email) do update
set updated_at = now();

-- Prefer update-or-insert without requiring a unique stripe_subscription_id constraint
do $$
declare
  v_user_id uuid;
  v_sub_id uuid;
  v_period_end timestamptz := now() + interval '365 days';
begin
  select id into v_user_id
  from public.users
  where lower(email) = 'luckief9@gmail.com'
  limit 1;

  if v_user_id is null then
    raise exception 'User row missing after upsert';
  end if;

  select id into v_sub_id
  from public.subscriptions
  where lower(email) = 'luckief9@gmail.com'
  order by updated_at desc nulls last
  limit 1;

  if v_sub_id is null then
    insert into public.subscriptions (
      user_id,
      email,
      stripe_subscription_id,
      stripe_price_id,
      status,
      plan,
      current_period_end,
      updated_at
    ) values (
      v_user_id,
      'luckief9@gmail.com',
      'manual_luckief9_gmail_com',
      'manual_unlock',
      'active',
      'monthly',
      v_period_end,
      now()
    );
  else
    update public.subscriptions
    set
      user_id = v_user_id,
      status = 'active',
      plan = 'monthly',
      stripe_subscription_id = coalesce(stripe_subscription_id, 'manual_luckief9_gmail_com'),
      stripe_price_id = 'manual_unlock',
      current_period_end = v_period_end,
      updated_at = now()
    where id = v_sub_id;
  end if;
end $$;

select id, email, status, plan, current_period_end, stripe_subscription_id
from public.subscriptions
where lower(email) = 'luckief9@gmail.com';
