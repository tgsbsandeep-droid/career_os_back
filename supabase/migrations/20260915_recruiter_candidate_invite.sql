-- Recruiter can invite a suggested (not-yet-applied) candidate into a job pipeline
-- for screening (shortlisted) or interview. Also lets the invite RPC bypass RLS:
-- applications INSERT is otherwise limited to candidate_id = auth.uid().
-- Safe to re-run.
--
-- APPLY IN SUPABASE SQL EDITOR:
-- 1. Dashboard → SQL Editor → New query
-- 2. Paste this entire file
-- 3. Run.
-- Depends on public.job_owned_by (20260912_recruiter_applications_visibility.sql).

drop policy if exists "Recruiters can invite candidates to own jobs" on public.applications;
create policy "Recruiters can invite candidates to own jobs" on public.applications
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.jobs j
      left join public.recruiter_profiles rp on rp.id = j.recruiter_id
      where j.id = applications.job_id
        and (
          j.owner_id = auth.uid()
          or j.employer_id = auth.uid()
          or j.recruiter_id = auth.uid()
          or rp.id = auth.uid()
          or (
            (to_jsonb(rp)->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            and (to_jsonb(rp)->>'user_id')::uuid = auth.uid()
          )
        )
    )
  );

create or replace function public.invite_candidate_to_job(
  p_job_id uuid,
  p_candidate_id uuid,
  p_status text default 'shortlisted',
  p_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owned boolean := false;
  job_status text := '';
  app_id uuid;
  next_status text;
begin
  if uid is null or p_job_id is null or p_candidate_id is null then
    raise exception 'Authentication required';
  end if;

  next_status := lower(trim(coalesce(p_status, 'shortlisted')));
  if next_status not in ('applied', 'shortlisted', 'interview', 'hired', 'rejected') then
    raise exception 'Invalid application status';
  end if;
  if next_status in ('applied', 'rejected') then
    next_status := 'shortlisted';
  end if;

  select
    coalesce(j.status, ''),
    (
      j.owner_id = uid
      or j.employer_id = uid
      or j.recruiter_id = uid
      or rp.id = uid
      or (
        (to_jsonb(rp)->>'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and (to_jsonb(rp)->>'user_id')::uuid = uid
      )
    )
  into job_status, owned
  from public.jobs j
  left join public.recruiter_profiles rp on rp.id = j.recruiter_id
  where j.id = p_job_id;

  if not owned then
    raise exception 'Job not found';
  end if;
  if lower(job_status) not in ('open', 'published') then
    raise exception 'Publish this job before inviting candidates';
  end if;

  if not exists (select 1 from public.candidate_profiles cp where cp.id = p_candidate_id) then
    raise exception 'Candidate not found';
  end if;

  -- Insert as applied first so a later status change fires notify_application_status.
  insert into public.applications (candidate_id, job_id, status)
  values (p_candidate_id, p_job_id, 'applied')
  on conflict (candidate_id, job_id) do nothing;

  update public.applications
  set
    status = next_status,
    updated_at = now()
  where candidate_id = p_candidate_id
    and job_id = p_job_id
    and status is distinct from next_status;

  if length(trim(coalesce(p_notes, ''))) > 0 then
    begin
      update public.applications
      set notes = trim(p_notes), updated_at = now()
      where candidate_id = p_candidate_id and job_id = p_job_id;
    exception
      when undefined_column then
        null;
    end;
  end if;

  select a.id into app_id
  from public.applications a
  where a.candidate_id = p_candidate_id and a.job_id = p_job_id;

  return app_id;
end;
$$;

revoke all on function public.invite_candidate_to_job(uuid, uuid, text, text) from public;
grant execute on function public.invite_candidate_to_job(uuid, uuid, text, text) to authenticated;
