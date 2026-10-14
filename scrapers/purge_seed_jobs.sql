-- Remove dummy seed listings and keep public.jobs limited to live scrapes.
-- Safe to re-run. Apply in the Supabase SQL editor (or psql) for the live project.

delete from public.jobs
where apply_url is null
   or btrim(apply_url) = ''
   or apply_url ~* '(example\.(com|org|net)|placeholder|localhost|127\.0\.0\.1)';

alter table public.jobs drop constraint if exists jobs_live_apply_url;
alter table public.jobs
  add constraint jobs_live_apply_url
  check (
    apply_url ~* '^https://'
    and length(btrim(apply_url)) > 0
    and length(btrim(title)) > 0
    and length(btrim(company)) > 0
    and apply_url !~* '(example\.(com|org|net)|placeholder|localhost|127\.0\.0\.1)'
  );

drop policy if exists "Public read jobs" on public.jobs;
create policy "Public read jobs"
  on public.jobs for select
  to anon, authenticated
  using (
    apply_url ~* '^https://'
    and apply_url !~* '(example\.(com|org|net)|placeholder|localhost|127\.0\.0\.1)'
    and length(btrim(title)) > 0
    and length(btrim(company)) > 0
  );
