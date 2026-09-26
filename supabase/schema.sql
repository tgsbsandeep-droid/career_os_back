-- Candidate module schema
-- Run this in Supabase SQL Editor before using the candidate APIs.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'candidate' check (role in ('candidate', 'tutor', 'recruiter', 'employer', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended', 'pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists role text not null default 'candidate';
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists roles text[] not null default '{}';

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'general',
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  education text not null default '',
  education_institution text not null default '',
  education_field text not null default '',
  graduation_year text not null default '',
  full_name text not null default '',
  contact_email text not null default '',
  phone text not null default '',
  location text not null default '',
  skills text[] not null default '{}',
  experience text[] not null default '{}',
  resume_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.candidate_profiles add column if not exists education text not null default '';
alter table public.candidate_profiles add column if not exists education_institution text not null default '';
alter table public.candidate_profiles add column if not exists education_field text not null default '';
alter table public.candidate_profiles add column if not exists graduation_year text not null default '';
alter table public.candidate_profiles add column if not exists full_name text not null default '';
alter table public.candidate_profiles add column if not exists contact_email text not null default '';
alter table public.candidate_profiles add column if not exists phone text not null default '';
alter table public.candidate_profiles add column if not exists location text not null default '';
alter table public.candidate_profiles add column if not exists skills text[] not null default '{}';
alter table public.candidate_profiles add column if not exists experience text[] not null default '{}';
alter table public.candidate_profiles add column if not exists resume_url text;
alter table public.candidate_profiles add column if not exists created_at timestamptz not null default now();
alter table public.candidate_profiles add column if not exists updated_at timestamptz not null default now();

-- Portfolio & social links
alter table public.candidate_profiles add column if not exists linkedin_url text;
alter table public.candidate_profiles add column if not exists github_url text;
alter table public.candidate_profiles add column if not exists portfolio_url text;
alter table public.candidate_profiles add column if not exists website_url text;

-- Certificate wallet (array of JSON strings)
alter table public.candidate_profiles add column if not exists certificates text[] not null default '{}';
alter table public.candidate_profiles add column if not exists avatar_url text;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  slug text not null default '',
  title text not null default 'Live training batch',
  description text not null default '',
  syllabus text not null default '',
  skills text[] not null default '{}',
  thumbnail_url text,
  modules jsonb not null default '[]'::jsonb,
  delivery_type text not null default 'self_paced' check (delivery_type in ('self_paced', 'live')),
  provider text not null default 'Career Platform Academy',
  level text not null default 'Beginner',
  duration text not null default '',
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now()
);

alter table public.courses add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.courses add column if not exists slug text not null default '';
alter table public.courses add column if not exists syllabus text not null default '';
alter table public.courses add column if not exists skills text[] not null default '{}';
alter table public.courses add column if not exists thumbnail_url text;
alter table public.courses add column if not exists modules jsonb not null default '[]'::jsonb;
alter table public.courses add column if not exists delivery_type text not null default 'self_paced';
alter table public.courses add column if not exists certificate boolean not null default true;
alter table public.courses add column if not exists price numeric not null default 0;
alter table public.courses add column if not exists is_free boolean not null default true;
alter table public.courses add column if not exists provider text not null default 'Career Platform Academy';
alter table public.courses add column if not exists updated_at timestamptz not null default now();

create table if not exists public.live_batches (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  schedule text not null default '',
  capacity integer not null default 30 check (capacity > 0),
  meeting_url text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.live_batches alter column title set default 'Live training batch';
alter table public.live_batches alter column end_at drop not null;

create table if not exists public.live_enrollments (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.live_batches(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (batch_id, candidate_id)
);

create table if not exists public.tutor_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  bio text not null default '',
  expertise text[] not null default '{}',
  qualifications text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tutor_profiles add column if not exists avatar_url text;
alter table public.tutor_profiles add column if not exists display_name text;
alter table public.tutor_profiles add column if not exists headline text;
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
alter table public.courses add column if not exists tutor_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'courses_tutor_id_fkey'
  ) then
    alter table public.courses
      add constraint courses_tutor_id_fkey
      foreign key (tutor_id) references public.tutor_profiles(id) on delete set null;
  end if;
end $$;
create index if not exists idx_courses_tutor_id on public.courses(tutor_id);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null,
  present boolean not null default false,
  created_at timestamptz not null default now(),
  unique (course_id, candidate_id, session_date)
);

create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  progress integer not null default 0 check (progress between 0 and 100),
  completed_lessons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (candidate_id, course_id)
);

alter table public.enrollments add column if not exists created_at timestamptz not null default now();
alter table public.enrollments add column if not exists completed_lessons jsonb not null default '[]'::jsonb;
alter table public.enrollments add column if not exists payment_status text not null default 'paid';
alter table public.enrollments add column if not exists paid_at timestamptz;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  title text not null,
  company_name text not null,
  description text not null default '',
  location text not null default 'Remote',
  employment_type text not null default 'Full-time',
  skills text[] not null default '{}',
  salary_range text not null default '',
  employer_id uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('draft', 'open', 'closed')),
  created_at timestamptz not null default now()
);

alter table public.jobs add column if not exists owner_id uuid references auth.users(id) on delete set null;
alter table public.jobs add column if not exists salary_range text not null default '';
alter table public.jobs add column if not exists recruiter_id uuid;

create table if not exists public.recruiter_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null default '',
  bio text not null default '',
  website text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.recruiter_profiles add column if not exists company_description text;
alter table public.recruiter_profiles add column if not exists headline text;
alter table public.recruiter_profiles add column if not exists avatar_url text;
alter table public.recruiter_profiles add column if not exists location text;
alter table public.recruiter_profiles add column if not exists industry text;
alter table public.recruiter_profiles add column if not exists company_size text;
alter table public.recruiter_profiles add column if not exists founded_year integer;
alter table public.recruiter_profiles add column if not exists linkedin_url text;
alter table public.recruiter_profiles add column if not exists phone text;
alter table public.recruiter_profiles add column if not exists contact_email text;
alter table public.recruiter_profiles add column if not exists hiring_roles text[] not null default '{}';
alter table public.recruiter_profiles add column if not exists work_modes text[] not null default '{}';
alter table public.recruiter_profiles add column if not exists benefits text[] not null default '{}';
alter table public.recruiter_profiles add column if not exists culture_values text[] not null default '{}';
alter table public.recruiter_profiles add column if not exists profile_details jsonb not null default '{}'::jsonb;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null default 'applied' check (status in ('applied', 'shortlisted', 'rejected')),
  resume_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (candidate_id, job_id)
);

create or replace function public.notify_course_enrollment()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, message)
  values (new.candidate_id, 'enrollment', 'You enrolled in a course.');
  return new;
end;
$$;

drop trigger if exists enrollment_notification on public.enrollments;
create trigger enrollment_notification after insert on public.enrollments
for each row execute function public.notify_course_enrollment();

create or replace function public.notify_application_status()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.notifications (user_id, type, message)
    values (new.candidate_id, 'application_status', 'Your application status changed to ' || initcap(new.status) || '.');
  end if;
  return new;
end;
$$;

drop trigger if exists application_status_notification on public.applications;
create trigger application_status_notification after update of status on public.applications
for each row execute function public.notify_application_status();

alter table public.candidate_profiles enable row level security;
alter table public.profiles enable row level security;
alter table public.notifications enable row level security;
alter table public.tutor_profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.attendance enable row level security;
alter table public.live_batches enable row level security;
alter table public.live_enrollments enable row level security;
alter table public.jobs enable row level security;
alter table public.recruiter_profiles enable row level security;
alter table public.applications enable row level security;

drop policy if exists "Candidates can view own profile" on public.candidate_profiles;
create policy "Candidates can view own profile" on public.candidate_profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "Candidates can update own profile" on public.candidate_profiles;
create policy "Candidates can update own profile" on public.candidate_profiles for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Tutors can view enrolled candidate profiles" on public.candidate_profiles;
create policy "Tutors can view enrolled candidate profiles" on public.candidate_profiles for select to authenticated using (exists (select 1 from public.enrollments join public.courses on courses.id = enrollments.course_id where enrollments.candidate_id = candidate_profiles.id and courses.owner_id = auth.uid()));
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "Users can manage own profile" on public.profiles;
create policy "Users can manage own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Admins can manage all profiles" on public.profiles;
create policy "Admins can manage all profiles" on public.profiles for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin');
drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications" on public.notifications for select to authenticated using (auth.uid() = user_id);
drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications" on public.notifications for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Anyone can view published courses" on public.courses;
create policy "Anyone can view published courses" on public.courses for select using (status = 'published' or auth.uid() = owner_id);
drop policy if exists "Tutors can manage own courses" on public.courses;
create policy "Tutors can manage own courses" on public.courses for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Admins can manage all courses" on public.courses;
create policy "Admins can manage all courses" on public.courses for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin');
drop policy if exists "Tutors can manage own profile" on public.tutor_profiles;
create policy "Tutors can manage own profile" on public.tutor_profiles for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Candidates can manage own enrollments" on public.enrollments;
create policy "Candidates can manage own enrollments" on public.enrollments for all to authenticated using (auth.uid() = candidate_id) with check (auth.uid() = candidate_id);
drop policy if exists "Tutors can view course enrollments" on public.enrollments;
create policy "Tutors can view course enrollments" on public.enrollments for select to authenticated using (exists (select 1 from public.courses where courses.id = enrollments.course_id and courses.owner_id = auth.uid()));
drop policy if exists "Tutors can manage course attendance" on public.attendance;
create policy "Tutors can manage course attendance" on public.attendance for all to authenticated using (exists (select 1 from public.courses where courses.id = attendance.course_id and courses.owner_id = auth.uid())) with check (exists (select 1 from public.courses where courses.id = attendance.course_id and courses.owner_id = auth.uid()));
drop policy if exists "Anyone can view published live batches" on public.live_batches;
create policy "Anyone can view published live batches" on public.live_batches for select using (status = 'published' or exists (select 1 from public.courses where courses.id = live_batches.course_id and courses.owner_id = auth.uid()));
drop policy if exists "Tutors can manage own live batches" on public.live_batches;
create policy "Tutors can manage own live batches" on public.live_batches for all to authenticated using (exists (select 1 from public.courses where courses.id = live_batches.course_id and courses.owner_id = auth.uid())) with check (exists (select 1 from public.courses where courses.id = live_batches.course_id and courses.owner_id = auth.uid()));
drop policy if exists "Candidates can view own live enrollments" on public.live_enrollments;
create policy "Candidates can view own live enrollments" on public.live_enrollments for select to authenticated using (auth.uid() = candidate_id);
drop policy if exists "Candidates can enroll in live batches" on public.live_enrollments;
create policy "Candidates can enroll in live batches" on public.live_enrollments for insert to authenticated with check (auth.uid() = candidate_id);
drop policy if exists "Candidates can update live enrollments" on public.live_enrollments;
create policy "Candidates can update live enrollments" on public.live_enrollments for update to authenticated using (auth.uid() = candidate_id) with check (auth.uid() = candidate_id);
drop policy if exists "Tutors can view live batch enrollments" on public.live_enrollments;
create policy "Tutors can view live batch enrollments" on public.live_enrollments for select to authenticated using (exists (select 1 from public.live_batches join public.courses on courses.id = live_batches.course_id where live_batches.id = live_enrollments.batch_id and courses.owner_id = auth.uid()));

create or replace function public.job_owned_by(p_job_id uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.jobs j
    left join public.recruiter_profiles rp on rp.id = j.recruiter_id
    where j.id = p_job_id
      and (
        j.owner_id = uid
        or j.employer_id = uid
        or j.recruiter_id = uid
        or rp.id = uid
        or nullif(to_jsonb(rp)->>'user_id', '')::uuid = uid
      )
  );
$$;

grant execute on function public.job_owned_by(uuid, uuid) to authenticated;

drop policy if exists "Anyone can view open jobs" on public.jobs;
create policy "Anyone can view open jobs" on public.jobs
  for select
  using (status in ('open', 'published') or public.job_owned_by(id, auth.uid()));
drop policy if exists "Recruiters can manage own jobs" on public.jobs;
create policy "Recruiters can manage own jobs" on public.jobs
  for all to authenticated
  using (public.job_owned_by(id, auth.uid()))
  with check (owner_id = auth.uid() or employer_id = auth.uid() or recruiter_id = auth.uid());
drop policy if exists "Admins can manage all jobs" on public.jobs;
create policy "Admins can manage all jobs" on public.jobs for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin');
drop policy if exists "Recruiters can manage own profile" on public.recruiter_profiles;
create policy "Recruiters can manage own profile" on public.recruiter_profiles for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Candidates can view own applications" on public.applications;
create policy "Candidates can view own applications" on public.applications for select to authenticated using (auth.uid() = candidate_id);
drop policy if exists "Candidates can create own applications" on public.applications;
create policy "Candidates can create own applications" on public.applications for insert to authenticated with check (auth.uid() = candidate_id);
drop policy if exists "Recruiters can view applicants to own jobs" on public.applications;
create policy "Recruiters can view applicants to own jobs" on public.applications for select to authenticated using (public.job_owned_by(job_id, auth.uid()));
drop policy if exists "Recruiters can update applicants to own jobs" on public.applications;
create policy "Recruiters can update applicants to own jobs" on public.applications for update to authenticated using (public.job_owned_by(job_id, auth.uid())) with check (public.job_owned_by(job_id, auth.uid()));
drop policy if exists "Admins can manage all applications" on public.applications;
create policy "Admins can manage all applications" on public.applications for all to authenticated using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin') with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin');
drop policy if exists "Recruiters can view applicant profiles" on public.candidate_profiles;
create policy "Recruiters can view applicant profiles" on public.candidate_profiles
  for select to authenticated
  using (exists (select 1 from public.applications a where a.candidate_id = candidate_profiles.id and public.job_owned_by(a.job_id, auth.uid())));
drop policy if exists "Recruiters can view applicant names" on public.profiles;
create policy "Recruiters can view applicant names" on public.profiles
  for select to authenticated
  using (exists (select 1 from public.applications a where a.candidate_id = profiles.id and public.job_owned_by(a.job_id, auth.uid())));

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check check (status in ('applied', 'shortlisted', 'interview', 'hired', 'rejected'));

insert into public.courses (title, description, provider, level, duration)
select * from (values
  ('Advanced React Development', 'Build production-ready React applications with advanced patterns and testing.', 'Career Platform Academy', 'Intermediate', '8 weeks'),
  ('Data Analytics Foundations', 'Turn everyday business questions into useful insights.', 'Career Platform Academy', 'Beginner', '6 weeks'),
  ('Cloud Development with AWS', 'Deploy, monitor, and scale modern web applications on AWS.', 'Cloud Skills Lab', 'Intermediate', '10 weeks'),
  ('Communication for Technical Leaders', 'Communicate technical decisions clearly and build alignment.', 'Career Platform Academy', 'All levels', '4 weeks')
) as seed(title, description, provider, level, duration)
where not exists (select 1 from public.courses);

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true), ('course-thumbnails', 'course-thumbnails', true), ('learning-content', 'learning-content', true)
on conflict (id) do nothing;

drop policy if exists "Candidates can upload own resumes" on storage.objects;
create policy "Candidates can upload own resumes" on storage.objects for insert to authenticated with check (bucket_id = 'resumes' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Candidates can update own resumes" on storage.objects;
create policy "Candidates can update own resumes" on storage.objects for update to authenticated using (bucket_id = 'resumes' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'resumes' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Candidates can delete own resumes" on storage.objects;
create policy "Candidates can delete own resumes" on storage.objects for delete to authenticated using (bucket_id = 'resumes' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Anyone can view resumes" on storage.objects;
create policy "Anyone can view resumes" on storage.objects for select using (bucket_id = 'resumes');
drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar" on storage.objects for update to authenticated using (bucket_id = 'avatars' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'avatars' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Anyone can view avatars" on storage.objects;
create policy "Anyone can view avatars" on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists "Tutors can upload course thumbnails" on storage.objects;
create policy "Tutors can upload course thumbnails" on storage.objects for insert to authenticated with check (bucket_id = 'course-thumbnails' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Tutors can update course thumbnails" on storage.objects;
create policy "Tutors can update course thumbnails" on storage.objects for update to authenticated using (bucket_id = 'course-thumbnails' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'course-thumbnails' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Anyone can view course thumbnails" on storage.objects;
create policy "Anyone can view course thumbnails" on storage.objects for select using (bucket_id = 'course-thumbnails');
drop policy if exists "Tutors can upload learning content" on storage.objects;
create policy "Tutors can upload learning content" on storage.objects for insert to authenticated with check (bucket_id = 'learning-content' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Tutors can update learning content" on storage.objects;
create policy "Tutors can update learning content" on storage.objects for update to authenticated using (bucket_id = 'learning-content' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'learning-content' and auth.uid() is not null and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Anyone can view learning content" on storage.objects;
create policy "Anyone can view learning content" on storage.objects for select using (bucket_id = 'learning-content');

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

create table if not exists public.issued_certificates (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  candidate_id uuid not null references auth.users(id) on delete cascade,
  issued_at timestamptz not null default now(),
  unique (course_id, candidate_id)
);

alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_submissions enable row level security;
alter table public.issued_certificates enable row level security;

drop policy if exists "Tutors can manage course quizzes" on public.quizzes;
create policy "Tutors can manage course quizzes" on public.quizzes for all to authenticated using (public.course_owned_by(course_id, auth.uid())) with check (public.course_owned_by(course_id, auth.uid()));
drop policy if exists "Enrolled candidates can view quizzes" on public.quizzes;
create policy "Enrolled candidates can view quizzes" on public.quizzes for select to authenticated using (exists (select 1 from public.enrollments where enrollments.course_id = quizzes.course_id and enrollments.candidate_id = auth.uid()) or public.course_owned_by(course_id, auth.uid()));
drop policy if exists "Candidates can manage own quiz attempts" on public.quiz_attempts;
create policy "Candidates can manage own quiz attempts" on public.quiz_attempts for all to authenticated using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());
drop policy if exists "Tutors can view course quiz attempts" on public.quiz_attempts;
create policy "Tutors can view course quiz attempts" on public.quiz_attempts for select to authenticated using (exists (select 1 from public.quizzes where quizzes.id = quiz_attempts.quiz_id and public.course_owned_by(quizzes.course_id, auth.uid())));
drop policy if exists "Tutors can manage course assignments" on public.assignments;
create policy "Tutors can manage course assignments" on public.assignments for all to authenticated using (public.course_owned_by(course_id, auth.uid())) with check (public.course_owned_by(course_id, auth.uid()));
drop policy if exists "Enrolled candidates can view assignments" on public.assignments;
create policy "Enrolled candidates can view assignments" on public.assignments for select to authenticated using (exists (select 1 from public.enrollments where enrollments.course_id = assignments.course_id and enrollments.candidate_id = auth.uid()) or public.course_owned_by(course_id, auth.uid()));
drop policy if exists "Candidates can manage own assignment submissions" on public.assignment_submissions;
create policy "Candidates can manage own assignment submissions" on public.assignment_submissions for all to authenticated using (candidate_id = auth.uid()) with check (candidate_id = auth.uid());
drop policy if exists "Tutors can view course assignment submissions" on public.assignment_submissions;
create policy "Tutors can view course assignment submissions" on public.assignment_submissions for select to authenticated using (exists (select 1 from public.assignments where assignments.id = assignment_submissions.assignment_id and public.course_owned_by(assignments.course_id, auth.uid())));
drop policy if exists "Tutors can grade assignment submissions" on public.assignment_submissions;
create policy "Tutors can grade assignment submissions" on public.assignment_submissions for update to authenticated using (exists (select 1 from public.assignments where assignments.id = assignment_submissions.assignment_id and public.course_owned_by(assignments.course_id, auth.uid()))) with check (exists (select 1 from public.assignments where assignments.id = assignment_submissions.assignment_id and public.course_owned_by(assignments.course_id, auth.uid())));
drop policy if exists "Tutors can manage issued certificates" on public.issued_certificates;
create policy "Tutors can manage issued certificates" on public.issued_certificates for all to authenticated using (public.course_owned_by(course_id, auth.uid())) with check (public.course_owned_by(course_id, auth.uid()));
drop policy if exists "Candidates can view own issued certificates" on public.issued_certificates;
create policy "Candidates can view own issued certificates" on public.issued_certificates for select to authenticated using (candidate_id = auth.uid() or public.course_owned_by(course_id, auth.uid()));
drop policy if exists "Candidates can receive auto certificates" on public.issued_certificates;
create policy "Candidates can receive auto certificates" on public.issued_certificates for insert to authenticated with check (candidate_id = auth.uid() and exists (select 1 from public.enrollments where enrollments.course_id = issued_certificates.course_id and enrollments.candidate_id = auth.uid() and enrollments.progress >= 100));

notify pgrst, 'reload schema';
