-- Recruiter can see candidate applications on jobs they own.
-- Safe to re-run (DROP POLICY IF EXISTS / CREATE OR REPLACE).
--
-- APPLY IN SUPABASE SQL EDITOR (live DB is not auto-migrated from this repo):
-- 1. Dashboard → SQL Editor → New query
-- 2. Paste this entire file
-- 3. Run.
--
-- Why: applications RLS only allowed jobs.owner_id = auth.uid().
-- Jobs are also owned via employer_id / recruiter_id. Recruiter JWT
-- also could not read candidate_profiles, so GET /api/jobs/:id/applicants
-- returned 500 and the dashboard swallowed that as an empty list.

alter table public.jobs add column if not exists recruiter_id uuid;

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
        or nullif(to_jsonb(rp)->>'user_id', '')::uuid = uid
      )
  );
$$;

grant execute on function public.job_owned_by(uuid, uuid) to authenticated;

drop policy if exists "Anyone can view open jobs" on public.jobs;
create policy "Anyone can view open jobs" on public.jobs
  for select
  using (
    status in ('open', 'published')
    or public.job_owned_by(id, auth.uid())
  );

drop policy if exists "Recruiters can manage own jobs" on public.jobs;
create policy "Recruiters can manage own jobs" on public.jobs
  for all to authenticated
  using (public.job_owned_by(id, auth.uid()))
  with check (
    owner_id = auth.uid()
    or employer_id = auth.uid()
    or recruiter_id = auth.uid()
  );

drop policy if exists "Recruiters can view applicants to own jobs" on public.applications;
create policy "Recruiters can view applicants to own jobs" on public.applications
  for select to authenticated
  using (public.job_owned_by(job_id, auth.uid()));

drop policy if exists "Recruiters can update applicants to own jobs" on public.applications;
create policy "Recruiters can update applicants to own jobs" on public.applications
  for update to authenticated
  using (public.job_owned_by(job_id, auth.uid()))
  with check (public.job_owned_by(job_id, auth.uid()));

drop policy if exists "Recruiters can view applicants to own jobs" on public.candidate_profiles;
drop policy if exists "Recruiters can view applicant profiles" on public.candidate_profiles;
create policy "Recruiters can view applicant profiles" on public.candidate_profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.applications a
      where a.candidate_id = candidate_profiles.id
        and public.job_owned_by(a.job_id, auth.uid())
    )
  );

drop policy if exists "Recruiters can view applicant names" on public.profiles;
create policy "Recruiters can view applicant names" on public.profiles
  for select to authenticated
  using (
    exists (
      select 1
      from public.applications a
      where a.candidate_id = profiles.id
        and public.job_owned_by(a.job_id, auth.uid())
    )
  );
