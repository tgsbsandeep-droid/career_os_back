-- Migration: Block self-role escalation on profiles table
-- Problem: "Users can update own profile" policy had no column restriction,
--          allowing any authenticated user to set their own role = 'admin'.
-- Fix:     Replace the update policy with one whose WITH CHECK clause
--          ensures the role and roles columns cannot be changed by the user
--          themselves (only admins can change role/roles via the admin policy).

-- Drop the unrestricted update policy
drop policy if exists "Users can update own profile" on public.profiles;

-- Re-create with a WITH CHECK that locks role and roles to their current values.
-- The user can update any other column (full_name, avatar_url, etc.) freely,
-- but any attempt to change role or roles will be rejected by RLS.
create policy "Users can update own profile (no role escalation)" on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    -- role must stay the same as the stored value
    and role = (select p.role from public.profiles p where p.id = auth.uid())
    -- roles array must stay the same as the stored value
    and roles = (select p.roles from public.profiles p where p.id = auth.uid())
  );

-- Also ensure the registration INSERT cannot set role to 'admin'.
-- The existing insert policy only checks auth.uid() = id, so add a check constraint
-- that prevents 'admin' from being inserted via the client (admin must be set via
-- the service-role key / Supabase dashboard).
drop policy if exists "Users can manage own profile" on public.profiles;
create policy "Users can insert own profile (non-admin)" on public.profiles
  for insert
  to authenticated
  with check (
    auth.uid() = id
    and role != 'admin'
    and not ('admin' = any(roles))
  );