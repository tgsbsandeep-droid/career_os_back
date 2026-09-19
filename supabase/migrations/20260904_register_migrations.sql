-- Run this in the Supabase SQL Editor to register migrations in the dashboard.
-- This inserts records into supabase_migrations.schema_migrations so they appear
-- in the Supabase dashboard Migrations tab.
--
-- NOTE: Only run this AFTER you have already run the actual migration SQL files
-- (20260904_tutor_expertise_qualifications.sql, 20260904_recruiter_profiles_fix.sql,
-- and 20260907_lms_quizzes_assignments.sql).

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  (
    '20260904000001',
    'tutor_expertise_qualifications',
    ARRAY[
      'ALTER TABLE tutor_profiles ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE',
      'CREATE TABLE IF NOT EXISTS tutor_expertise (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tutor_id UUID NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE, skill_name VARCHAR(255) NOT NULL, added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)',
      'CREATE TABLE IF NOT EXISTS tutor_qualifications (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), tutor_id UUID NOT NULL REFERENCES tutor_profiles(id) ON DELETE CASCADE, qualification_name VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
    ]
  ),
  (
    '20260904000002',
    'recruiter_profiles_fix',
    ARRAY[
      'ALTER TABLE recruiter_profiles ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES profiles(id) ON DELETE CASCADE',
      'ALTER TABLE recruiter_profiles ADD COLUMN IF NOT EXISTS company_description TEXT'
    ]
  ),
  (
    '20260907000001',
    'lms_quizzes_assignments',
    ARRAY[
      'ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS tutor_id uuid',
      'ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS certificate boolean',
      'CREATE TABLE IF NOT EXISTS public.quizzes',
      'CREATE TABLE IF NOT EXISTS public.quiz_attempts',
      'CREATE TABLE IF NOT EXISTS public.assignments',
      'CREATE TABLE IF NOT EXISTS public.assignment_submissions',
      'CREATE TABLE IF NOT EXISTS public.issued_certificates'
    ]
  )
ON CONFLICT (version) DO NOTHING;