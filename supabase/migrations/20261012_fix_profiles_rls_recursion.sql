-- Migration: Fix infinite recursion in profiles RLS update policy
-- Problem: "Users can update own profile (no role escalation)" had a WITH CHECK
--          that queried public.profiles inside a policy ON public.profiles,
--          causing "infinite recursion detected in policy for relation profiles".
-- Fix:     Use SECURITY DEFINER helper functions that bypass RLS to read the
--          stored role/roles values, breaking the recursive policy evaluation.
--          The helpers return the correct types (user_role enum and text[]) so
--          the policy comparisons work without any cast errors.

-- 1. Helper: returns the stored role (user_role enum) for a user, bypassing RLS.
create or replace function public.get_profile_role(uid uuid)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = uid;
$$;

-- 2. Helper: returns the stored roles array (text[]) for a user, bypassing RLS.
create or replace function public.get_profile_roles(uid uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select roles from public.profiles where id = uid;
$$;

grant execute on function public.get_profile_role(uuid) to authenticated;
grant execute on function public.get_profile_roles(uuid) to authenticated;

-- 3. Drop the recursive policy.
drop policy if exists "Users can update own profile (no role escalation)" on public.profiles;

-- 4. Re-create using the SECURITY DEFINER helpers instead of direct subqueries.
--    Because the helpers run as the function owner (security definer), they read
--    profiles without re-entering the RLS policy stack, eliminating the recursion.
create policy "Users can update own profile (no role escalation)" on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- role must stay the same as the currently stored value
    and role = public.get_profile_role(auth.uid())
    -- roles array must stay the same as the currently stored value
    and roles = public.get_profile_roles(auth.uid())
  );