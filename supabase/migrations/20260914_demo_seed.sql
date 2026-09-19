-- CareerOS demo seed: pre-screened candidates, open jobs, published courses.
-- Purpose: try candidate apply, recruiter ATS/matching, and academy catalog.
-- Safe to re-run (upserts by email / fixed ids / unique pairs).
--
-- APPLY IN SUPABASE SQL EDITOR:
-- 1. Dashboard → SQL Editor → New query
-- 2. Paste this entire file
-- 3. Run.
--
-- Demo logins (password for all): CareerOS-Demo-2026!
--   recruiter@careeros.demo   recruiter  (owns the demo jobs + applicants)
--   academy@careeros.demo     academy    (owns the demo courses)
--   candidate@careeros.demo   candidate  (empty pipeline — apply yourself)
--   priya.nair@careeros.demo  candidate  (pre-screened designer)
--   arjun.mehta@careeros.demo candidate  (pre-screened engineer)
--   meera.iyer@careeros.demo  candidate  (pre-screened analyst)

alter table public.jobs add column if not exists experience_level text not null default 'mid';
alter table public.jobs add column if not exists job_type text;
alter table public.jobs add column if not exists updated_at timestamptz not null default now();
alter table public.jobs add column if not exists owner_id uuid;
alter table public.jobs add column if not exists employer_id uuid;
alter table public.jobs add column if not exists recruiter_id uuid;
alter table public.jobs add column if not exists employment_type text not null default 'Full-time';
alter table public.jobs add column if not exists skills text[] not null default '{}';
alter table public.jobs add column if not exists salary_range text not null default '';
alter table public.applications add column if not exists cover_letter text;
alter table public.applications add column if not exists notes text;
alter table public.profiles add column if not exists full_name text not null default '';
alter table public.profiles add column if not exists role text not null default 'candidate';
alter table public.profiles add column if not exists status text not null default 'active';
alter table public.profiles add column if not exists roles text[] not null default '{}';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.candidate_profiles add column if not exists full_name text not null default '';
alter table public.candidate_profiles add column if not exists contact_email text not null default '';
alter table public.candidate_profiles add column if not exists phone text not null default '';
alter table public.candidate_profiles add column if not exists location text not null default '';
alter table public.candidate_profiles add column if not exists education text not null default '';
alter table public.candidate_profiles add column if not exists education_institution text not null default '';
alter table public.candidate_profiles add column if not exists education_field text not null default '';
alter table public.candidate_profiles add column if not exists graduation_year text not null default '';
alter table public.candidate_profiles add column if not exists skills text[] not null default '{}';
alter table public.candidate_profiles add column if not exists experience text[] not null default '{}';
alter table public.candidate_profiles add column if not exists resume_url text;
alter table public.candidate_profiles add column if not exists linkedin_url text;
alter table public.candidate_profiles add column if not exists github_url text;
alter table public.candidate_profiles add column if not exists portfolio_url text;
alter table public.candidate_profiles add column if not exists website_url text;
alter table public.candidate_profiles add column if not exists updated_at timestamptz not null default now();
alter table public.courses add column if not exists owner_id uuid;
alter table public.courses add column if not exists tutor_id uuid;
alter table public.courses add column if not exists slug text not null default '';
alter table public.courses add column if not exists syllabus text not null default '';
alter table public.courses add column if not exists skills text[] not null default '{}';
alter table public.courses add column if not exists modules jsonb not null default '[]'::jsonb;
alter table public.courses add column if not exists delivery_type text not null default 'self_paced';
alter table public.courses add column if not exists certificate boolean not null default true;
alter table public.courses add column if not exists provider text not null default 'Career Platform Academy';
alter table public.courses add column if not exists updated_at timestamptz not null default now();
alter table public.enrollments add column if not exists completed_lessons jsonb not null default '[]'::jsonb;
alter table public.tutor_profiles add column if not exists expertise text[] not null default '{}';
alter table public.tutor_profiles add column if not exists qualifications text[] not null default '{}';
alter table public.tutor_profiles add column if not exists updated_at timestamptz not null default now();

create or replace function public._careeros_upsert_demo_user(
  p_id uuid,
  p_email text,
  p_name text,
  p_role text,
  p_profile_role text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_id uuid;
  v_hash text;
  v_app jsonb;
  v_meta jsonb;
  v_roles text[];
  v_profile_role text;
  v_role_regtype text;
  v_status_regtype text;
  v_role_typid oid;
  v_status_typid oid;
  v_status_label text;
begin
  v_hash := crypt('CareerOS-Demo-2026!', gen_salt('bf', 10));
  v_app := jsonb_build_object(
    'provider', 'email',
    'providers', jsonb_build_array('email'),
    'role', p_role,
    'roles', jsonb_build_array(p_role)
  );
  v_meta := jsonb_build_object(
    'full_name', p_name,
    'role', p_role,
    'roles', jsonb_build_array(p_role),
    'active_role', p_role
  );
  v_roles := case
    when p_role = p_profile_role then array[p_role]
    else array[p_role, p_profile_role]
  end;
  v_profile_role := case lower(coalesce(p_profile_role, p_role, 'candidate'))
    when 'academy' then 'tutor'
    when 'instructor' then 'tutor'
    when 'employer' then 'recruiter'
    else coalesce(p_profile_role, p_role, 'candidate')
  end;
  v_status_label := 'active';
  select a.atttypid::regtype::text, a.atttypid
    into v_role_regtype, v_role_typid
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = 'profiles'
    and a.attname = 'role'
    and not a.attisdropped;
  select a.atttypid::regtype::text, a.atttypid
    into v_status_regtype, v_status_typid
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname = 'profiles'
    and a.attname = 'status'
    and not a.attisdropped;
  if v_role_typid is not null then
    select coalesce(
      (select e.enumlabel from pg_catalog.pg_enum e
        where e.enumtypid = v_role_typid and e.enumlabel = v_profile_role limit 1),
      (select e.enumlabel from pg_catalog.pg_enum e
        where e.enumtypid = v_role_typid and e.enumlabel = lower(coalesce(p_profile_role, '')) limit 1),
      (select e.enumlabel from pg_catalog.pg_enum e
        where e.enumtypid = v_role_typid and e.enumlabel = lower(coalesce(p_role, '')) limit 1),
      (select e.enumlabel from pg_catalog.pg_enum e
        where e.enumtypid = v_role_typid
          and e.enumlabel in ('candidate', 'tutor', 'recruiter', 'admin', 'student', 'academy', 'employer')
        order by array_position(
          array['candidate', 'tutor', 'recruiter', 'admin', 'student', 'academy', 'employer'],
          e.enumlabel
        )
        limit 1),
      (select e.enumlabel from pg_catalog.pg_enum e
        where e.enumtypid = v_role_typid
        order by e.enumsortorder
        limit 1),
      v_profile_role
    )
    into v_profile_role;
  end if;
  if v_status_typid is not null then
    select coalesce(
      (select e.enumlabel from pg_catalog.pg_enum e
        where e.enumtypid = v_status_typid and e.enumlabel = 'active' limit 1),
      (select e.enumlabel from pg_catalog.pg_enum e
        where e.enumtypid = v_status_typid
        order by e.enumsortorder
        limit 1),
      'active'
    )
    into v_status_label;
  end if;

  select u.id into v_id from auth.users u where lower(u.email) = lower(p_email) limit 1;
  if v_id is null then
    select u.id into v_id from auth.users u where u.id = p_id limit 1;
  end if;

  if v_id is null then
    v_id := p_id;
    begin
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, recovery_token,
        email_change_token_new, email_change, email_change_token_current,
        reauthentication_token, is_sso_user, is_anonymous
      ) values (
        '00000000-0000-0000-0000-000000000000',
        v_id, 'authenticated', 'authenticated', p_email, v_hash,
        now(), v_app, v_meta, now(), now(), '', '', '', '', '', '', false, false
      );
    exception
      when undefined_column then
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          created_at, updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000',
          v_id, 'authenticated', 'authenticated', p_email, v_hash,
          now(), v_app, v_meta, now(), now()
        );
    end;
  else
    update auth.users
    set encrypted_password = v_hash,
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        raw_app_meta_data = v_app,
        raw_user_meta_data = v_meta,
        updated_at = now(),
        banned_until = null,
        deleted_at = null
    where id = v_id;
  end if;

  begin
    insert into auth.identities (
      user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    )
    select
      v_id,
      jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true),
      'email',
      v_id::text,
      now(), now(), now()
    where not exists (
      select 1 from auth.identities i
      where i.user_id = v_id and i.provider = 'email'
    );
  exception
    when undefined_column then
      begin
        insert into auth.identities (
          id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
        )
        select v_id::text, v_id,
          jsonb_build_object('sub', v_id::text, 'email', p_email),
          'email', now(), now(), now()
        where not exists (
          select 1 from auth.identities i
          where i.user_id = v_id and i.provider = 'email'
        );
      exception when others then
        null;
      end;
    when others then
      null;
  end;

  begin
    execute format(
      'insert into public.profiles (id, full_name, role, status, roles)
       values ($1, $2, $3::%s, $4::%s, $5)
       on conflict (id) do update
         set full_name = excluded.full_name,
             role = excluded.role,
             status = excluded.status,
             roles = excluded.roles,
             updated_at = now()',
      coalesce(v_role_regtype, 'text'),
      coalesce(v_status_regtype, 'text')
    )
    using v_id, p_name, v_profile_role, v_status_label, v_roles;
  exception
    when undefined_column then
      begin
        execute format(
          'insert into public.profiles (id, full_name, role, status)
           values ($1, $2, $3::%s, $4::%s)
           on conflict (id) do update
             set full_name = excluded.full_name,
                 role = excluded.role,
                 status = excluded.status,
                 updated_at = now()',
          coalesce(v_role_regtype, 'text'),
          coalesce(v_status_regtype, 'text')
        )
        using v_id, p_name, v_profile_role, v_status_label;
      exception
        when undefined_column then
          execute format(
            'insert into public.profiles (id, full_name, role)
             values ($1, $2, $3::%s)
             on conflict (id) do update
               set full_name = excluded.full_name,
                   role = excluded.role',
            coalesce(v_role_regtype, 'text')
          )
          using v_id, p_name, v_profile_role;
      end;
  end;

  return v_id;
end;
$$;

create or replace function public._careeros_upsert_demo_course(
  p_owner uuid,
  p_id uuid,
  p_title text,
  p_slug text,
  p_description text,
  p_syllabus text,
  p_skills text[],
  p_provider text,
  p_level text,
  p_duration text,
  p_modules jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.courses c where c.title = p_title) then
    update public.courses
    set owner_id = p_owner,
        tutor_id = p_owner,
        slug = case when coalesce(slug, '') in ('', p_slug) then p_slug else slug end,
        description = p_description,
        syllabus = p_syllabus,
        skills = p_skills,
        modules = p_modules,
        provider = p_provider,
        level = p_level,
        duration = p_duration,
        status = 'published',
        delivery_type = 'self_paced',
        certificate = true,
        updated_at = now()
    where title = p_title;
  else
    insert into public.courses (
      id, owner_id, tutor_id, slug, title, description, syllabus, skills,
      modules, provider, level, duration, status, delivery_type, certificate
    ) values (
      p_id, p_owner, p_owner, p_slug, p_title, p_description, p_syllabus, p_skills,
      p_modules, p_provider, p_level, p_duration, 'published', 'self_paced', true
    );
  end if;
end;
$$;

do $$
declare
  recruiter_id uuid;
  academy_id uuid;
  priya_id uuid;
  arjun_id uuid;
  meera_id uuid;
  rohan_id uuid;
  job_design uuid := 'a0e1d000-0001-4000-8000-000000000001';
  job_eng uuid := 'a0e1d000-0001-4000-8000-000000000002';
  job_data uuid := 'a0e1d000-0001-4000-8000-000000000003';
  job_intern uuid := 'a0e1d000-0001-4000-8000-000000000004';
  resume_pdf text := 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
  react_modules jsonb := '[
    {"id":"m-react-1","title":"Modern React foundations","description":"Hooks, composition, and app structure.","lessons":[
      {"id":"l-react-1","title":"Thinking in components","type":"video","url":"https://www.youtube.com/watch?v=Rh3tobg7hEo","duration":"12 min"},
      {"id":"l-react-2","title":"Hooks workshop notes","type":"file","url":"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"}
    ]},
    {"id":"m-react-2","title":"Production patterns","description":"Testing, data fetching, and performance.","lessons":[
      {"id":"l-react-3","title":"Query and cache strategy","type":"video","url":"https://www.youtube.com/watch?v=0sdjeJTOqmM","duration":"18 min"}
    ]}
  ]'::jsonb;
  analytics_modules jsonb := '[
    {"id":"m-da-1","title":"Ask better questions","description":"Turn a business prompt into a metric.","lessons":[
      {"id":"l-da-1","title":"From question to dashboard","type":"video","url":"https://www.youtube.com/watch?v=r-uOLxNrNk8","duration":"14 min"}
    ]},
    {"id":"m-da-2","title":"SQL for analysts","description":"Joins, windows, and clean extracts.","lessons":[
      {"id":"l-da-2","title":"SQL drill sheet","type":"file","url":"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"}
    ]}
  ]'::jsonb;
  aws_modules jsonb := '[
    {"id":"m-aws-1","title":"Ship a web app","description":"Compute, storage, and a first deploy.","lessons":[
      {"id":"l-aws-1","title":"Architecture walkthrough","type":"video","url":"https://www.youtube.com/watch?v=JIbIYCM48to","duration":"20 min"}
    ]}
  ]'::jsonb;
  comms_modules jsonb := '[
    {"id":"m-com-1","title":"Write for decisions","description":"Memos, status, and alignment.","lessons":[
      {"id":"l-com-1","title":"Technical writing loop","type":"video","url":"https://www.youtube.com/watch?v=vP3b9e1Qd1Y","duration":"10 min"}
    ]}
  ]'::jsonb;
  ui_modules jsonb := '[
    {"id":"m-ui-1","title":"Visual hierarchy","description":"Type, color, and layout for product UI.","lessons":[
      {"id":"l-ui-1","title":"Figma foundations","type":"video","url":"https://www.youtube.com/watch?v=FTFaQWZBqQ8","duration":"16 min"}
    ]},
    {"id":"m-ui-2","title":"Brand systems","description":"Components that stay consistent in production.","lessons":[
      {"id":"l-ui-2","title":"Design system checklist","type":"file","url":"https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"}
    ]}
  ]'::jsonb;
  python_modules jsonb := '[
    {"id":"m-py-1","title":"Interview warm-up","description":"Core Python and problem framing.","lessons":[
      {"id":"l-py-1","title":"Arrays, maps, and time","type":"video","url":"https://www.youtube.com/watch?v=kQDxmjfkIKY","duration":"15 min"}
    ]}
  ]'::jsonb;
begin
  recruiter_id := public._careeros_upsert_demo_user(
    '11111111-1111-4111-8111-111111111111',
    'recruiter@careeros.demo',
    'Ananya Rao',
    'recruiter',
    'recruiter'
  );
  academy_id := public._careeros_upsert_demo_user(
    '22222222-2222-4222-8222-222222222222',
    'academy@careeros.demo',
    'Vikram Joshi',
    'academy',
    'tutor'
  );
  priya_id := public._careeros_upsert_demo_user(
    '33333333-3333-4333-8333-333333333333',
    'priya.nair@careeros.demo',
    'Priya Nair',
    'candidate',
    'candidate'
  );
  arjun_id := public._careeros_upsert_demo_user(
    '44444444-4444-4444-8444-444444444444',
    'arjun.mehta@careeros.demo',
    'Arjun Mehta',
    'candidate',
    'candidate'
  );
  meera_id := public._careeros_upsert_demo_user(
    '55555555-5555-4555-8555-555555555555',
    'meera.iyer@careeros.demo',
    'Meera Iyer',
    'candidate',
    'candidate'
  );
  rohan_id := public._careeros_upsert_demo_user(
    '66666666-6666-4666-8666-666666666666',
    'candidate@careeros.demo',
    'Rohan Shah',
    'candidate',
    'candidate'
  );

  insert into public.recruiter_profiles (id, company_name, bio, website, updated_at)
  values (
    recruiter_id,
    'CareerOS Labs',
    'Hiring team for CareerOS Labs. Use this account to review demo applicants, skill matches, interviews, and offers.',
    'https://careeros.demo',
    now()
  )
  on conflict (id) do update
    set company_name = excluded.company_name,
        bio = excluded.bio,
        website = excluded.website,
        updated_at = now();

  insert into public.tutor_profiles (id, bio, expertise, qualifications, updated_at)
  values (
    academy_id,
    'Academy lead for CareerOS demo courses. Open Students on any published course to see demo enrollments.',
    array['React', 'SQL', 'UI Design', 'Career coaching'],
    array['Lead instructor, Career Platform Academy'],
    now()
  )
  on conflict (id) do update
    set bio = excluded.bio,
        expertise = excluded.expertise,
        qualifications = excluded.qualifications,
        updated_at = now();

  begin
    update public.tutor_profiles set user_id = academy_id where id = academy_id;
  exception when undefined_column then
    null;
  end;

  insert into public.candidate_profiles (
    id, full_name, contact_email, phone, location, education, education_institution,
    education_field, graduation_year, skills, experience, resume_url, linkedin_url,
    github_url, portfolio_url, updated_at
  ) values
    (
      priya_id, 'Priya Nair', 'priya.nair@careeros.demo', '+91 98110 11111', 'Bengaluru',
      'B.Des Visual Communication', 'NID Ahmedabad', 'Visual Communication', '2019',
      array['Figma', 'Photoshop', 'Illustrator', 'Branding', 'UI Design'],
      array['3 years brand design at a SaaS startup', 'Freelance campaign work for D2C brands'],
      resume_pdf, 'https://linkedin.com/in/priya-nair-demo', null, 'https://priya-nair.demo', now()
    ),
    (
      arjun_id, 'Arjun Mehta', 'arjun.mehta@careeros.demo', '+91 98220 22222', 'Hyderabad',
      'B.Tech Computer Science', 'IIIT Hyderabad', 'Computer Science', '2020',
      array['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'AWS'],
      array['4 years full-stack at a B2B product company', 'Built hiring dashboards and REST APIs'],
      resume_pdf, 'https://linkedin.com/in/arjun-mehta-demo', 'https://github.com/arjun-mehta-demo', null, now()
    ),
    (
      meera_id, 'Meera Iyer', 'meera.iyer@careeros.demo', '+91 98330 33333', 'Pune',
      'M.Sc Statistics', 'University of Pune', 'Statistics', '2021',
      array['SQL', 'Python', 'Excel', 'Tableau', 'Power BI'],
      array['2 years business analyst at a fintech', 'Weekly exec dashboards and experiment readouts'],
      resume_pdf, 'https://linkedin.com/in/meera-iyer-demo', null, null, now()
    ),
    (
      rohan_id, 'Rohan Shah', 'candidate@careeros.demo', '+91 98440 44444', 'Mumbai',
      'B.Com', 'Mumbai University', 'Commerce', '2022',
      array['React', 'Figma', 'Communication', 'SQL'],
      array['Campus internships in product and operations'],
      resume_pdf, 'https://linkedin.com/in/rohan-shah-demo', null, null, now()
    )
  on conflict (id) do update
    set full_name = excluded.full_name,
        contact_email = excluded.contact_email,
        phone = excluded.phone,
        location = excluded.location,
        education = excluded.education,
        education_institution = excluded.education_institution,
        education_field = excluded.education_field,
        graduation_year = excluded.graduation_year,
        skills = excluded.skills,
        experience = excluded.experience,
        resume_url = excluded.resume_url,
        linkedin_url = excluded.linkedin_url,
        github_url = excluded.github_url,
        portfolio_url = excluded.portfolio_url,
        updated_at = now();

  insert into public.jobs (
    id, owner_id, employer_id, recruiter_id, title, company_name, description,
    location, employment_type, job_type, experience_level, skills, salary_range, status, updated_at
  ) values
    (
      job_design, recruiter_id, recruiter_id, recruiter_id,
      'Graphics Designer', 'CareerOS Labs',
      $jd$CareerOS Labs is seeking a creative and detail-oriented Mid-Level Graphics Designer to join our fully remote team and bring our brand vision to life across digital and print mediums.

Company: CareerOS Labs
Location: Remote
Employment Type: Full-time
Experience Level: Mid-level

About the role
You will collaborate with product and marketing to ship campaign assets, social templates, and product illustrations. This is a hands-on craft role with a clear portfolio bar.

Responsibilities
- Design marketing and product visuals in Figma, Photoshop, and Illustrator
- Maintain brand systems and reusable templates
- Prepare production-ready exports for web, social, and print
- Partner with engineers on illustration and icon handoff

Requirements
- 3+ years of graphics or brand design
- Strong Figma and Adobe suite skills
- A portfolio of digital and print work
$jd$,
      'Remote', 'Full-time', 'full_time', 'mid',
      array['Figma', 'Photoshop', 'Illustrator', 'Branding'],
      '8–12 LPA', 'open', now()
    ),
    (
      job_eng, recruiter_id, recruiter_id, recruiter_id,
      'Full Stack Engineer', 'CareerOS Labs',
      $jd$We are hiring a Full Stack Engineer to build candidate, academy, and recruiter workflows on CareerOS.

Company: CareerOS Labs
Location: Bengaluru / Hybrid
Employment Type: Full-time
Experience Level: Mid-level

About the role
You will own features across React and Node, including job apply, ATS pipelines, and course enrollment APIs.

Responsibilities
- Ship TypeScript features on web and API
- Model Postgres data and keep queries honest
- Add tests around apply, matching, and auth-gated routes

Requirements
- 3+ years with React and Node.js
- TypeScript and PostgreSQL in production
- Comfortable debugging REST + RLS issues
$jd$,
      'Bengaluru / Hybrid', 'Full-time', 'full_time', 'mid',
      array['React', 'Node.js', 'TypeScript', 'PostgreSQL'],
      '18–28 LPA', 'open', now()
    ),
    (
      job_data, recruiter_id, recruiter_id, recruiter_id,
      'Data Analyst', 'CareerOS Labs',
      $jd$Join CareerOS Labs as a Data Analyst and turn hiring and learning funnels into decisions.

Company: CareerOS Labs
Location: Hyderabad
Employment Type: Full-time
Experience Level: Entry level

About the role
You will define metrics for applications, course completion, and time-to-hire, then publish weekly readouts.

Responsibilities
- Build SQL models for funnel conversion
- Maintain Tableau dashboards for recruiters and academy leads
- Partner with product on experiment design

Requirements
- Strong SQL and spreadsheet skills
- Python for light analysis
- Clear written communication
$jd$,
      'Hyderabad', 'Full-time', 'full_time', 'entry',
      array['SQL', 'Python', 'Excel', 'Tableau'],
      '6–10 LPA', 'open', now()
    ),
    (
      job_intern, recruiter_id, recruiter_id, recruiter_id,
      'Product Design Intern', 'CareerOS Labs',
      $jd$A 6-month internship for designers who want real product surface area.

Company: CareerOS Labs
Location: Remote
Employment Type: Internship
Experience Level: Entry level

About the role
You will support the Graphics Designer and product team on candidate-facing flows: job cards, apply modal, and course catalog.

Requirements
- Figma fluency
- A student or early-career portfolio
- Interest in hiring products
$jd$,
      'Remote', 'Internship', 'internship', 'entry',
      array['Figma', 'UI Design', 'Prototyping'],
      'Stipend 25k/month', 'open', now()
    )
  on conflict (id) do update
    set owner_id = excluded.owner_id,
        employer_id = excluded.employer_id,
        recruiter_id = excluded.recruiter_id,
        title = excluded.title,
        company_name = excluded.company_name,
        description = excluded.description,
        location = excluded.location,
        employment_type = excluded.employment_type,
        job_type = excluded.job_type,
        experience_level = excluded.experience_level,
        skills = excluded.skills,
        salary_range = excluded.salary_range,
        status = 'open',
        updated_at = now();

  perform public._careeros_upsert_demo_course(
    academy_id,
    'c0e1d000-0001-4000-8000-000000000001',
    'Advanced React Development',
    'advanced-react-development',
    'Build production-ready React applications with advanced patterns and testing.',
    'Week 1–2 hooks and composition. Week 3–4 data fetching. Week 5–6 testing. Week 7–8 a capstone app.',
    array['React', 'TypeScript', 'Testing'],
    'Career Platform Academy',
    'Intermediate',
    '8 weeks',
    react_modules
  );
  perform public._careeros_upsert_demo_course(
    academy_id,
    'c0e1d000-0001-4000-8000-000000000002',
    'Data Analytics Foundations',
    'data-analytics-foundations',
    'Turn everyday business questions into useful insights.',
    'Metrics, SQL, Excel, and a first dashboard in Tableau.',
    array['SQL', 'Excel', 'Tableau'],
    'Career Platform Academy',
    'Beginner',
    '6 weeks',
    analytics_modules
  );
  perform public._careeros_upsert_demo_course(
    academy_id,
    'c0e1d000-0001-4000-8000-000000000003',
    'Cloud Development with AWS',
    'cloud-development-with-aws',
    'Deploy, monitor, and scale modern web applications on AWS.',
    'IAM, compute, storage, and a guided deploy of a Node API.',
    array['AWS', 'Node.js', 'DevOps'],
    'Cloud Skills Lab',
    'Intermediate',
    '10 weeks',
    aws_modules
  );
  perform public._careeros_upsert_demo_course(
    academy_id,
    'c0e1d000-0001-4000-8000-000000000004',
    'Communication for Technical Leaders',
    'communication-for-technical-leaders',
    'Communicate technical decisions clearly and build alignment.',
    'Memos, incident updates, and stakeholder reviews.',
    array['Communication', 'Writing', 'Leadership'],
    'Career Platform Academy',
    'All levels',
    '4 weeks',
    comms_modules
  );
  perform public._careeros_upsert_demo_course(
    academy_id,
    'c0e1d000-0001-4000-8000-000000000005',
    'UI Design Fundamentals',
    'ui-design-fundamentals',
    'Learn hierarchy, components, and handoff so your Figma files survive engineering.',
    'Visual foundations, then a small product flow in Figma.',
    array['Figma', 'UI Design', 'Branding'],
    'Career Platform Academy',
    'Beginner',
    '5 weeks',
    ui_modules
  );
  perform public._careeros_upsert_demo_course(
    academy_id,
    'c0e1d000-0001-4000-8000-000000000006',
    'Interview-ready Python',
    'interview-ready-python',
    'Warm up Python, SQL thinking, and take-home structure for analyst and engineering interviews.',
    'Language drills, then two timed practice rounds.',
    array['Python', 'SQL', 'Communication'],
    'Career Platform Academy',
    'Beginner',
    '3 weeks',
    python_modules
  );

  insert into public.applications (
    candidate_id, job_id, status, resume_url, cover_letter, notes, updated_at
  ) values
    (
      priya_id, job_design, 'shortlisted', resume_pdf,
      'I have shipped brand systems in Figma and print for SaaS marketing teams. Happy to share a walkthrough of the CareerOS-style campaign work in my portfolio.',
      'Pre-screened designer. Strong Figma and branding overlap.',
      now()
    ),
    (
      priya_id, job_intern, 'applied', resume_pdf,
      'If the mid-level seat is filled, I can also mentor an intern pod on the design system.',
      null,
      now()
    ),
    (
      arjun_id, job_eng, 'applied', resume_pdf,
      'I have built ATS-style dashboards in React/Node with Postgres. I can start on the apply + matching loop immediately.',
      'Pre-screened engineer. Skill match on React, Node, TypeScript, PostgreSQL.',
      now()
    ),
    (
      arjun_id, job_design, 'applied', resume_pdf,
      'I am stronger on product engineering than craft design, but I can implement design-system tokens and asset pipelines.',
      null,
      now()
    ),
    (
      meera_id, job_data, 'shortlisted', resume_pdf,
      'I currently own weekly funnel dashboards in SQL and Tableau. I want to measure time-to-hire and course completion for CareerOS.',
      'Pre-screened analyst. Ready for a case-study interview.',
      now()
    ),
    (
      meera_id, job_eng, 'applied', resume_pdf,
      'I am targeting analyst first, but I can contribute Python services and experiment instrumentation if you need a hybrid profile.',
      null,
      now()
    )
  on conflict (candidate_id, job_id) do update
    set status = excluded.status,
        resume_url = excluded.resume_url,
        cover_letter = excluded.cover_letter,
        notes = excluded.notes,
        updated_at = now();

  insert into public.enrollments (candidate_id, course_id, progress, completed_lessons)
  select priya_id, c.id, 55, '[]'::jsonb from public.courses c where c.title = 'UI Design Fundamentals'
  on conflict (candidate_id, course_id) do update set progress = excluded.progress;
  insert into public.enrollments (candidate_id, course_id, progress, completed_lessons)
  select arjun_id, c.id, 40, '[]'::jsonb from public.courses c where c.title = 'Advanced React Development'
  on conflict (candidate_id, course_id) do update set progress = excluded.progress;
  insert into public.enrollments (candidate_id, course_id, progress, completed_lessons)
  select arjun_id, c.id, 15, '[]'::jsonb from public.courses c where c.title = 'Cloud Development with AWS'
  on conflict (candidate_id, course_id) do update set progress = excluded.progress;
  insert into public.enrollments (candidate_id, course_id, progress, completed_lessons)
  select meera_id, c.id, 70, '[]'::jsonb from public.courses c where c.title = 'Data Analytics Foundations'
  on conflict (candidate_id, course_id) do update set progress = excluded.progress;
  insert into public.enrollments (candidate_id, course_id, progress, completed_lessons)
  select meera_id, c.id, 25, '[]'::jsonb from public.courses c where c.title = 'Interview-ready Python'
  on conflict (candidate_id, course_id) do update set progress = excluded.progress;
  insert into public.enrollments (candidate_id, course_id, progress, completed_lessons)
  select rohan_id, c.id, 10, '[]'::jsonb from public.courses c where c.title = 'Communication for Technical Leaders'
  on conflict (candidate_id, course_id) do update set progress = excluded.progress;

  insert into public.live_batches (course_id, title, start_at, end_at, schedule, capacity, meeting_url, status)
  select c.id, 'September live cohort', now() + interval '7 days', now() + interval '35 days',
         'Tue & Thu 7:00–8:30 PM IST', 30, 'https://meet.google.com/careeros-demo', 'published'
  from public.courses c
  where c.title = 'Communication for Technical Leaders'
    and not exists (
      select 1 from public.live_batches lb
      where lb.course_id = c.id and lb.title = 'September live cohort'
    );
end $$;

drop function if exists public._careeros_upsert_demo_user(uuid, text, text, text, text);
drop function if exists public._careeros_upsert_demo_course(uuid, uuid, text, text, text, text, text[], text, text, text, jsonb);

select
  (select count(*) from public.jobs where company_name = 'CareerOS Labs') as demo_jobs,
  (select count(*) from public.courses where status = 'published') as published_courses,
  (select count(*) from public.candidate_profiles cp
     join auth.users u on u.id = cp.id
    where u.email like '%@careeros.demo') as demo_candidates,
  (select count(*) from public.applications a
     join public.jobs j on j.id = a.job_id
    where j.company_name = 'CareerOS Labs') as demo_applications;
