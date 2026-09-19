-- Candidate profile photo.
-- Safe to re-run. Apply in the Supabase SQL Editor if the CLI is not used.

alter table public.candidate_profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists avatar_url text;
