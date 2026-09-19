-- Recruiter ATS: interview scheduling and job offers.
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- APPLY IN SUPABASE SQL EDITOR (live DB is not auto-migrated from this repo):
-- 1. Dashboard → SQL Editor → New query
-- 2. Paste this entire file
-- 3. Run.
-- 4. If PostgREST still says the table is missing from the schema cache,
--    wait ~30s or Settings → API → Reload schema.
-- Until this runs, hiring APIs treat missing tables as empty on GET and 503 on writes.

create or replace function public.job_owned_by(p_job_id uuid, uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.jobs j
    where j.id = p_job_id
      and (
        j.owner_id = uid
        or j.employer_id = uid
      )
  );
$$;

create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  scheduled_at timestamptz not null,
  mode text not null default 'video' check (mode in ('video', 'phone', 'onsite')),
  notes text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_interviews_application_id on public.interviews(application_id);
create index if not exists idx_interviews_job_id on public.interviews(job_id);
create index if not exists idx_interviews_candidate_id on public.interviews(candidate_id);
create index if not exists idx_interviews_recruiter_id on public.interviews(recruiter_id);
create index if not exists idx_interviews_scheduled_at on public.interviews(scheduled_at);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  recruiter_id uuid not null references auth.users(id) on delete cascade,
  salary text not null default '',
  joining_date date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_offers_application_id on public.offers(application_id);
create index if not exists idx_offers_job_id on public.offers(job_id);
create index if not exists idx_offers_candidate_id on public.offers(candidate_id);
create index if not exists idx_offers_recruiter_id on public.offers(recruiter_id);

alter table public.interviews enable row level security;
alter table public.offers enable row level security;

drop policy if exists "Recruiters can manage interviews on owned jobs" on public.interviews;
create policy "Recruiters can manage interviews on owned jobs" on public.interviews
  for all to authenticated
  using (public.job_owned_by(job_id, auth.uid()) or recruiter_id = auth.uid())
  with check (public.job_owned_by(job_id, auth.uid()) and recruiter_id = auth.uid());

drop policy if exists "Candidates can view own interviews" on public.interviews;
create policy "Candidates can view own interviews" on public.interviews
  for select to authenticated
  using (candidate_id = auth.uid());

drop policy if exists "Recruiters can manage offers on owned jobs" on public.offers;
create policy "Recruiters can manage offers on owned jobs" on public.offers
  for all to authenticated
  using (public.job_owned_by(job_id, auth.uid()) or recruiter_id = auth.uid())
  with check (public.job_owned_by(job_id, auth.uid()) and recruiter_id = auth.uid());

drop policy if exists "Candidates can view own offers" on public.offers;
create policy "Candidates can view own offers" on public.offers
  for select to authenticated
  using (candidate_id = auth.uid());

drop policy if exists "Candidates can respond to sent offers" on public.offers;
create policy "Candidates can respond to sent offers" on public.offers
  for update to authenticated
  using (candidate_id = auth.uid() and status = 'sent')
  with check (candidate_id = auth.uid() and status in ('accepted', 'declined'));
