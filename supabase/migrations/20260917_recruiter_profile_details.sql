-- Recruiter / company professional profile fields.
-- Safe to re-run. Apply in the Supabase SQL Editor if the CLI is not used.

alter table public.recruiter_profiles add column if not exists company_description text;
alter table public.recruiter_profiles add column if not exists bio text;
alter table public.recruiter_profiles add column if not exists headline text;
alter table public.recruiter_profiles add column if not exists avatar_url text;
alter table public.recruiter_profiles add column if not exists location text;
alter table public.recruiter_profiles add column if not exists industry text;
alter table public.recruiter_profiles add column if not exists company_size text;
alter table public.recruiter_profiles add column if not exists founded_year integer;
alter table public.recruiter_profiles add column if not exists website text;
alter table public.recruiter_profiles add column if not exists linkedin_url text;
alter table public.recruiter_profiles add column if not exists phone text;
alter table public.recruiter_profiles add column if not exists contact_email text;
alter table public.recruiter_profiles add column if not exists hiring_roles text[] not null default '{}';
alter table public.recruiter_profiles add column if not exists work_modes text[] not null default '{}';
alter table public.recruiter_profiles add column if not exists benefits text[] not null default '{}';
alter table public.recruiter_profiles add column if not exists culture_values text[] not null default '{}';
alter table public.recruiter_profiles add column if not exists profile_details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recruiter_profiles_company_size_check'
  ) then
    alter table public.recruiter_profiles
      add constraint recruiter_profiles_company_size_check
      check (
        company_size is null
        or company_size in ('startup', 'small', 'medium', 'large', 'enterprise')
      );
  end if;
end $$;
