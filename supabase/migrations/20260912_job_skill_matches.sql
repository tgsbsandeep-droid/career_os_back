-- Suggest candidates whose skills overlap a recruiter's job.
-- Recruiters cannot SELECT all candidate_profiles under RLS, so this
-- security-definer RPC returns a small public snapshot (no email/phone/resume).
-- Safe to re-run (CREATE OR REPLACE).
--
-- APPLY IN SUPABASE SQL EDITOR:
-- 1. Dashboard → SQL Editor → New query
-- 2. Paste this entire file
-- 3. Run.

create or replace function public.match_candidates_for_job(p_job_id uuid)
returns table (
  id uuid,
  full_name text,
  location text,
  education text,
  skills text[],
  match_score integer,
  strengths text[],
  gaps text[],
  already_applied boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  job_skills text[];
  required text[];
  owned boolean := false;
begin
  if uid is null or p_job_id is null then
    return;
  end if;

  select
    coalesce(j.skills, '{}'::text[]),
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
  into job_skills, owned
  from public.jobs j
  left join public.recruiter_profiles rp on rp.id = j.recruiter_id
  where j.id = p_job_id;

  if not owned then
    return;
  end if;

  select coalesce(array_agg(distinct lower(trim(skill))), '{}'::text[])
  into required
  from unnest(coalesce(job_skills, '{}'::text[])) as skill
  where trim(skill) <> '';

  if required is null or cardinality(required) = 0 then
    return;
  end if;

  return query
  with scored as (
    select
      cp.id as candidate_id,
      coalesce(nullif(trim(cp.full_name), ''), 'Candidate') as candidate_name,
      coalesce(cp.location, '') as candidate_location,
      coalesce(cp.education, '') as candidate_education,
      coalesce(cp.skills, '{}'::text[]) as candidate_skills,
      coalesce((
        select array_agg(req)
        from unnest(required) as req
        where exists (
          select 1
          from unnest(coalesce(cp.skills, '{}'::text[])) as cand
          where trim(cand) <> ''
            and (
              lower(trim(cand)) like '%' || req || '%'
              or req like '%' || lower(trim(cand)) || '%'
            )
        )
      ), '{}'::text[]) as matched,
      exists (
        select 1
        from public.applications a
        where a.job_id = p_job_id
          and a.candidate_id = cp.id
      ) as applied
    from public.candidate_profiles cp
    where coalesce(cardinality(cp.skills), 0) > 0
  )
  select
    s.candidate_id,
    s.candidate_name,
    s.candidate_location,
    s.candidate_education,
    s.candidate_skills,
    round(100.0 * cardinality(s.matched) / cardinality(required))::integer,
    s.matched,
    coalesce((
      select array_agg(req)
      from unnest(required) as req
      where not (req = any (s.matched))
    ), '{}'::text[]),
    s.applied
  from scored s
  where cardinality(s.matched) > 0
  order by
    s.applied asc,
    cardinality(s.matched) desc,
    s.candidate_name
  limit 12;
end;
$$;

revoke all on function public.match_candidates_for_job(uuid) from public;
grant execute on function public.match_candidates_for_job(uuid) to authenticated;
