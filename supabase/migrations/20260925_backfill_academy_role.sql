-- Migration: backfill profiles rows where role was incorrectly stored as 'academy'
-- The profiles.role check constraint only allows:
--   ('candidate', 'tutor', 'recruiter', 'employer', 'admin')
-- The frontend persistProfile() maps 'academy' → 'tutor' before writing, but
-- any rows written before that mapping was in place may have role = 'academy'
-- (which violates the check constraint and would have been silently rejected,
-- leaving the row with role = 'candidate').
--
-- This migration also ensures the roles[] array is consistent: any row whose
-- roles array contains 'academy' gets it replaced with 'tutor' so that
-- verifyRoleFromDb() can match it via PROFILE_ROLE_ALIASES.

-- 1. Fix any rows where role = 'academy' slipped through (shouldn't exist due
--    to the check constraint, but guard against it).
update public.profiles
set role = 'tutor', updated_at = now()
where role = 'academy';

-- 2. Replace 'academy' entries in the roles[] array with 'tutor'.
update public.profiles
set
  roles = array_replace(roles, 'academy', 'tutor'),
  updated_at = now()
where 'academy' = any(roles);

-- 3. Ensure every user whose roles[] contains 'tutor' also has role = 'tutor'
--    (covers users who had roles = '{tutor}' but role = 'candidate').
update public.profiles
set role = 'tutor', updated_at = now()
where 'tutor' = any(roles)
  and role not in ('tutor', 'recruiter', 'employer', 'admin');