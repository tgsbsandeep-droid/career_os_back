-- Academy / trainer professional profile fields.
-- Safe to re-run. Apply in the Supabase SQL Editor if the CLI is not used.

alter table public.tutor_profiles add column if not exists display_name text;
alter table public.tutor_profiles add column if not exists headline text;
alter table public.tutor_profiles add column if not exists avatar_url text;
alter table public.tutor_profiles add column if not exists location text;
alter table public.tutor_profiles add column if not exists languages text[] not null default '{}';
alter table public.tutor_profiles add column if not exists website text;
alter table public.tutor_profiles add column if not exists linkedin_url text;
alter table public.tutor_profiles add column if not exists phone text;
alter table public.tutor_profiles add column if not exists contact_email text;
alter table public.tutor_profiles add column if not exists teaching_experience_years integer;
alter table public.tutor_profiles add column if not exists preferred_teaching_mode text;
alter table public.tutor_profiles add column if not exists hourly_rate numeric;
alter table public.tutor_profiles add column if not exists teaching_history text[] not null default '{}';
alter table public.tutor_profiles add column if not exists audiences text[] not null default '{}';
alter table public.tutor_profiles add column if not exists profile_details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tutor_profiles_teaching_mode_check'
  ) then
    alter table public.tutor_profiles
      add constraint tutor_profiles_teaching_mode_check
      check (
        preferred_teaching_mode is null
        or preferred_teaching_mode in ('online', 'offline', 'hybrid')
      );
  end if;
end $$;
