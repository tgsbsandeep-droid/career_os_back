/**
 * Pure role-resolution helpers.
 *
 * Extracted into their own module so they can be unit-tested without
 * triggering the Supabase client initialisation (which requires env vars).
 *
 * collectRoles / hasAnyRole are the local-dev fallback for role gating.
 * The authoritative server-side check is verifyRoleFromDb() in supabase.ts.
 */

export const ROLE_ALIASES: Record<string, string> = {
  tutor: "academy",
  instructor: "academy",
  training_institute: "candidate",
  college: "candidate",
  student: "candidate",
  employer: "recruiter",
};

type UserLike =
  | { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }
  | null
  | undefined;

/**
 * Collect the normalised set of roles from a Supabase user object.
 *
 * Priority:
 *   1. app_metadata — admin-controlled, cannot be written by the client.
 *      Used as the primary source when set (e.g. admin-assigned roles).
 *   2. user_metadata — client-writable via supabase.auth.updateUser({ data }).
 *      Used as a fallback because the Supabase JS client writes role/roles
 *      here (not to app_metadata). This is safe because verifyRoleFromDb()
 *      is the authoritative security gate; hasAnyRole() is only called when
 *      the DB check is unavailable (no service-role key) or the profile row
 *      doesn't exist yet (race on first signup).
 */
export function collectRoles(user: UserLike): Set<string> {
  const app = user?.app_metadata ?? {};
  const meta = user?.user_metadata ?? {};
  const combined = [
    ...(Array.isArray(app["roles"]) ? (app["roles"] as unknown[]) : []),
    app["role"],
    ...(Array.isArray(meta["roles"]) ? (meta["roles"] as unknown[]) : []),
    meta["role"],
    meta["active_role"],
  ];
  const seen = new Set<string>();
  for (const raw of combined) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value) continue;
    seen.add(value);
    seen.add(ROLE_ALIASES[value] ?? value);
  }
  return seen;
}

/**
 * Return true if the user holds at least one of the allowed roles.
 */
export function hasAnyRole(user: UserLike, allowed: string[]): boolean {
  const roles = collectRoles(user);
  return allowed.some((role) => {
    const value = String(role).trim().toLowerCase();
    return roles.has(value) || roles.has(ROLE_ALIASES[value] ?? value);
  });
}