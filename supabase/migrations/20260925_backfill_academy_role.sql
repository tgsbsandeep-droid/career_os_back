-- Migration: backfill profiles rows where roles[] array contains 'academy' instead of 'tutor'
--
-- profiles.role is a user_role enum that only allows:
--   ('candidate', 'tutor', 'recruiter', 'employer', 'admin')
-- 'academy' was never a valid enum value, so it could never be stored in profiles.role.
-- However, the roles[] text array may contain 'academy' if persistProfile() wrote it
-- before the academy→tutor mapping was added (commit dea2193).
--
-- This migration fixes the roles[] array and ensures profiles.role is consistent.

-- 1. Replace 'academy' entries in the roles[] text array with 'tutor'.
update public.profiles
set
  roles = array_replace(roles, 'academy', 'tutor'),
  updated_at = now()
where 'academy' = any(roles);

-- 2. Ensure every user whose roles[] contains 'tutor' also has role = 'tutor'
--    (covers users who had roles = '{tutor}' but role = 'candidate' due to the
--    silent rejection of 'academy' by the enum constraint).
update public.profiles
set role = 'tutor', updated_at = now()
where 'tutor' = any(roles)
  and role not in ('tutor', 'recruiter', 'employer', 'admin');