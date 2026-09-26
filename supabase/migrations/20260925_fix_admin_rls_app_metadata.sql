-- Fix admin RLS policies to check app_metadata instead of user_metadata.
--
-- user_metadata is CLIENT-WRITABLE: any authenticated user can call
--   supabase.auth.updateUser({ data: { role: "admin" } })
-- and bypass these policies.
--
-- app_metadata is SERVER-CONTROLLED (Supabase service-role only) and cannot
-- be set by the client, making it the correct source of truth for role gating.

-- profiles
drop policy if exists "Admins can manage all profiles" on public.profiles;
create policy "Admins can manage all profiles" on public.profiles
  for all to authenticated
  using  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
       or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
           or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin');

-- courses
drop policy if exists "Admins can manage all courses" on public.courses;
create policy "Admins can manage all courses" on public.courses
  for all to authenticated
  using  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
       or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
           or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin');

-- jobs
drop policy if exists "Admins can manage all jobs" on public.jobs;
create policy "Admins can manage all jobs" on public.jobs
  for all to authenticated
  using  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
       or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
           or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin');

-- applications
drop policy if exists "Admins can manage all applications" on public.applications;
create policy "Admins can manage all applications" on public.applications
  for all to authenticated
  using  ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
       or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
           or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin');