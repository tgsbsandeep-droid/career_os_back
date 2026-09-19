-- saved_jobs: candidates can bookmark job listings
CREATE TABLE IF NOT EXISTS public.saved_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (candidate_id, job_id)
);

-- saved_courses: candidates can bookmark courses
CREATE TABLE IF NOT EXISTS public.saved_courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (candidate_id, course_id)
);

-- Enable RLS
ALTER TABLE public.saved_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_courses ENABLE ROW LEVEL SECURITY;

-- RLS policies: candidates can only see/manage their own saved items
DROP POLICY IF EXISTS "saved_jobs_own" ON public.saved_jobs;
CREATE POLICY "saved_jobs_own" ON public.saved_jobs
    FOR ALL USING (auth.uid() = candidate_id);

DROP POLICY IF EXISTS "saved_courses_own" ON public.saved_courses;
CREATE POLICY "saved_courses_own" ON public.saved_courses
    FOR ALL USING (auth.uid() = candidate_id);