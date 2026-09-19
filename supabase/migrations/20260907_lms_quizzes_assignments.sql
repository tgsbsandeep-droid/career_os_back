-- LMS: quizzes, assignments, attempts, submissions, issued certificates.
-- Safe to re-run (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- APPLY IN SUPABASE SQL EDITOR (live DB is not auto-migrated from this repo):
-- 1. Dashboard → SQL Editor → New query
-- 2. Paste this entire file
-- 3. Run. Expected: courses.tutor_id, courses.certificate, public.issued_certificates
-- 4. If PostgREST still says "Could not find the table 'public.issued_certificates' in the schema cache",
--    wait ~30s or Settings → API → Reload schema.
-- Until this runs, LMS certificate APIs degrade (empty list / 503).
--

alter table public.courses add column if not exists tutor_id uuid references public.tutor_profiles(id) on delete set null;
alter table public.courses add column if not exists certificate boolean not null default true;
alter table public.courses add column if not exists provider text not null default 'Career Platform Academy';
alter table public.courses add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_courses_tutor_id on public.courses(tutor_id);

create or replace function public.course_owned_by(course_id uuid, uid uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.courses c
    left join public.tutor_profiles tp on tp.id = c.tutor_id
    where c.id = course_id
      and (
        c.owner_id = uid
        or tp.user_id = uid
        or tp.id = uid
        or c.tutor_id = uid
      )
  );
$$;

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null default '',
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_quizzes_course_id on public.quizzes(course_id);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  score integer not null default 0,
  max_score integer not null default 0,
  created_at timestamptz not null default now(),
  unique (quiz_id, candidate_id)
);

create index if not exists idx_quiz_attempts_quiz_id on public.quiz_attempts(quiz_id);
create index if not exists idx_quiz_attempts_candidate_id on public.quiz_attempts(candidate_id);

create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null default '',
  description text not null default '',
  due_date date,
  max_score integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_assignments_course_id on public.assignments(course_id);

create table if not exists public.assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  file_url text,
  score integer,
  submitted_at timestamptz not null default now(),
  unique (assignment_id, candidate_id)
);

create index if not exists idx_assignment_submissions_assignment_id on public.assignment_submissions(assignment_id);
create index if not exists idx_assignment_submissions_candidate_id on public.assignment_submissions(candidate_id);

create table if not exists public.issued_certificates (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  issued_at timestamptz not null default now(),
  unique (course_id, candidate_id)
);

create index if not exists idx_issued_certificates_course_id on public.issued_certificates(course_id);
create index if not exists idx_issued_certificates_candidate_id on public.issued_certificates(candidate_id);

alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.issued_certificates enable row level security;

drop policy if exists "Tutors can manage course quizzes" on public.quizzes;
create policy "Tutors can manage course quizzes" on public.quizzes
  for all to authenticated
  using (public.course_owned_by(course_id, auth.uid()))
  with check (public.course_owned_by(course_id, auth.uid()));

drop policy if exists "Enrolled candidates can view quizzes" on public.quizzes;
create policy "Enrolled candidates can view quizzes" on public.quizzes
  for select to authenticated
  using (
    exists (
      select 1 from public.enrollments
      where enrollments.course_id = quizzes.course_id
        and enrollments.candidate_id = auth.uid()
    )
    or public.course_owned_by(course_id, auth.uid())
  );

drop policy if exists "Candidates can manage own quiz attempts" on public.quiz_attempts;
create policy "Candidates can manage own quiz attempts" on public.quiz_attempts
  for all to authenticated
  using (candidate_id = auth.uid())
  with check (candidate_id = auth.uid());

drop policy if exists "Tutors can view course quiz attempts" on public.quiz_attempts;
create policy "Tutors can view course quiz attempts" on public.quiz_attempts
  for select to authenticated
  using (
    exists (
      select 1 from public.quizzes
      where quizzes.id = quiz_attempts.quiz_id
        and public.course_owned_by(quizzes.course_id, auth.uid())
    )
  );

drop policy if exists "Tutors can manage course assignments" on public.assignments;
create policy "Tutors can manage course assignments" on public.assignments
  for all to authenticated
  using (public.course_owned_by(course_id, auth.uid()))
  with check (public.course_owned_by(course_id, auth.uid()));

drop policy if exists "Enrolled candidates can view assignments" on public.assignments;
create policy "Enrolled candidates can view assignments" on public.assignments
  for select to authenticated
  using (
    exists (
      select 1 from public.enrollments
      where enrollments.course_id = assignments.course_id
        and enrollments.candidate_id = auth.uid()
    )
    or public.course_owned_by(course_id, auth.uid())
  );

drop policy if exists "Candidates can manage own assignment submissions" on public.assignment_submissions;
create policy "Candidates can manage own assignment submissions" on public.assignment_submissions
  for all to authenticated
  using (candidate_id = auth.uid())
  with check (candidate_id = auth.uid());

drop policy if exists "Tutors can view course assignment submissions" on public.assignment_submissions;
create policy "Tutors can view course assignment submissions" on public.assignment_submissions
  for select to authenticated
  using (
    exists (
      select 1 from public.assignments
      where assignments.id = assignment_submissions.assignment_id
        and public.course_owned_by(assignments.course_id, auth.uid())
    )
  );

drop policy if exists "Tutors can grade assignment submissions" on public.assignment_submissions;
create policy "Tutors can grade assignment submissions" on public.assignment_submissions
  for update to authenticated
  using (
    exists (
      select 1 from public.assignments
      where assignments.id = assignment_submissions.assignment_id
        and public.course_owned_by(assignments.course_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.assignments
      where assignments.id = assignment_submissions.assignment_id
        and public.course_owned_by(assignments.course_id, auth.uid())
    )
  );

drop policy if exists "Tutors can manage issued certificates" on public.issued_certificates;
create policy "Tutors can manage issued certificates" on public.issued_certificates
  for all to authenticated
  using (public.course_owned_by(course_id, auth.uid()))
  with check (public.course_owned_by(course_id, auth.uid()));

drop policy if exists "Candidates can view own issued certificates" on public.issued_certificates;
create policy "Candidates can view own issued certificates" on public.issued_certificates
  for select to authenticated
  using (candidate_id = auth.uid() or public.course_owned_by(course_id, auth.uid()));

drop policy if exists "Candidates can receive auto certificates" on public.issued_certificates;
create policy "Candidates can receive auto certificates" on public.issued_certificates
  for insert to authenticated
  with check (
    candidate_id = auth.uid()
    and exists (
      select 1 from public.enrollments
      where enrollments.course_id = issued_certificates.course_id
        and enrollments.candidate_id = auth.uid()
        and enrollments.progress >= 100
    )
  );

notify pgrst, 'reload schema';
