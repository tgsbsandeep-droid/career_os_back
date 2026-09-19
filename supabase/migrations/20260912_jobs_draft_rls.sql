-- Allow recruiters to INSERT drafts and see them after save.
-- Safe to re-run (DROP POLICY IF EXISTS / CREATE OR REPLACE).
--
-- APPLY IN SUPABASE SQL EDITOR:
-- 1. Dashboard → SQL Editor → New query
-- 2. Paste this entire file
-- 3. Run.
--
-- Why draft save failed with:
--   new row violates row-level security policy for table "jobs"
-- 1. INSERT WITH CHECK only allowed recruiter_id = auth.uid(). The API
--    often sets recruiter_id to recruiter_profiles.id (a different UUID).
-- 2. INSERT ... RETURNING also needs SELECT. Drafts are not open/published,
--    so RETURNING failed even when the insert itself was acceptable.
-- 3. jobs.status check on some DBs omitted 'draft'.

alter table public.jobs add column if not exists owner_id uuid;
alter table public.jobs add column if not exists employer_id uuid;
alter table public.jobs add column if not exists recruiter_id uuid;

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('draft', 'open', 'closed', 'published'));

create or replace function public.job_owned_by(p_job_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    left join public.recruiter_profiles rp on rp.id = j.recruiter_id
    where j.id = p_job_id
      and (
        j.owner_id = uid
        or j.employer_id = uid
        or j.recruiter_id = uid
        or rp.id = uid
        or (
          (to_jsonb(rp)->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and (to_jsonb(rp)->>'user_id')::uuid = uid
        )
      )
  );
$$;

create or replace function public.job_row_owned_by(
  p_owner_id uuid,
  p_employer_id uuid,
  p_recruiter_id uuid,
  uid uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    uid is not null
    and (
      p_owner_id = uid
      or p_employer_id = uid
      or p_recruiter_id = uid
      or exists (
        select 1
        from public.recruiter_profiles rp
        where rp.id = p_recruiter_id
          and (
            rp.id = uid
            or (
              (to_jsonb(rp)->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              and (to_jsonb(rp)->>'user_id')::uuid = uid
            )
          )
      )
    );
$$;

grant execute on function public.job_owned_by(uuid, uuid) to authenticated;
grant execute on function public.job_row_owned_by(uuid, uuid, uuid, uuid) to authenticated;

drop policy if exists "Anyone can view open jobs" on public.jobs;
create policy "Anyone can view open jobs" on public.jobs
  for select
  using (
    status in ('open', 'published')
    or public.job_owned_by(id, auth.uid())
    or public.job_row_owned_by(owner_id, employer_id, recruiter_id, auth.uid())
  );

drop policy if exists "Recruiters can manage own jobs" on public.jobs;
create policy "Recruiters can manage own jobs" on public.jobs
  for all to authenticated
  using (
    public.job_owned_by(id, auth.uid())
    or public.job_row_owned_by(owner_id, employer_id, recruiter_id, auth.uid())
  )
  with check (
    public.job_row_owned_by(owner_id, employer_id, recruiter_id, auth.uid())
  );

drop policy if exists "Recruiters can insert own jobs" on public.jobs;
create policy "Recruiters can insert own jobs" on public.jobs
  for insert to authenticated
  with check (
    public.job_row_owned_by(owner_id, employer_id, recruiter_id, auth.uid())
  );
