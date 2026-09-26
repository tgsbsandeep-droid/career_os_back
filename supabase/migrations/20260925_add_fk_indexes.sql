-- Migration: add indexes on high-traffic FK and status columns
-- Run AFTER all previous migrations (last in the ordered list).
--
-- Foreign keys in Postgres are NOT auto-indexed. Every .eq() filter or JOIN
-- on these columns does a sequential scan without an index. The columns below
-- are used constantly by the API (ownsJob, applications-by-candidate,
-- interviews-by-recruiter, enrollments-by-candidate, etc.).

-- jobs
create index if not exists idx_jobs_recruiter_id   on public.jobs(recruiter_id);
create index if not exists idx_jobs_employer_id    on public.jobs(employer_id);
create index if not exists idx_jobs_owner_id       on public.jobs(owner_id);
create index if not exists idx_jobs_status         on public.jobs(status);

-- applications
create index if not exists idx_applications_job_id       on public.applications(job_id);
create index if not exists idx_applications_candidate_id on public.applications(candidate_id);
create index if not exists idx_applications_status       on public.applications(status);

-- interviews
create index if not exists idx_interviews_job_id        on public.interviews(job_id);
create index if not exists idx_interviews_recruiter_id  on public.interviews(recruiter_id);
create index if not exists idx_interviews_candidate_id  on public.interviews(candidate_id);

-- offers
create index if not exists idx_offers_job_id        on public.offers(job_id);
create index if not exists idx_offers_recruiter_id  on public.offers(recruiter_id);
create index if not exists idx_offers_candidate_id  on public.offers(candidate_id);
create index if not exists idx_offers_status        on public.offers(status);

-- enrollments
create index if not exists idx_enrollments_candidate_id on public.enrollments(candidate_id);
create index if not exists idx_enrollments_course_id    on public.enrollments(course_id);
create index if not exists idx_enrollments_status       on public.enrollments(status);

-- notifications
create index if not exists idx_notifications_user_id on public.notifications(user_id);
create index if not exists idx_notifications_read_at  on public.notifications(read_at) where read_at is null;