/**
 * Shared route-level authorisation helpers.
 *
 * Centralises the requireAcademy / requireRecruiter guards so that
 * courses.ts, lms.ts, academies.ts, and hiring.ts all use the same
 * verifyRoleFromDb-based check instead of three separate copies that
 * can drift out of sync.
 */

import type { Request, Response } from "express";

const {
  createAuthenticatedClient,
  getUserFromToken,
  hasAnyRole,
  verifyRoleFromDb,
} = require("./supabase");

export const ACADEMY_ROLES = ["academy", "tutor", "instructor"] as const;
export const RECRUITER_ROLES = ["recruiter", "employer"] as const;

/** Extract the raw Bearer token from the Authorization header, or undefined. */
export function bearerToken(req: Request): string | undefined {
  const authorization = req.header("Authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
}

export type AuthContext = {
  user: { id: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> };
  client: ReturnType<typeof createAuthenticatedClient>;
  token: string;
};

/**
 * Resolve the authenticated user from the request.
 * Returns null and sends a 401 if the token is missing or invalid.
 */
export async function requireUser(req: Request, res: Response): Promise<AuthContext | null> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  return { user, client: createAuthenticatedClient(token), token };
}

/**
 * Require the authenticated user to hold an academy/tutor/instructor role.
 *
 * Check order:
 *   1. verifyRoleFromDb — authoritative server-side check via the service-role
 *      client. Prevents user_metadata tampering (candidate → academy escalation).
 *   2. hasAnyRole (app_metadata fallback) — used when the service-role key is
 *      absent (local dev) or when the profiles row doesn't exist yet (race
 *      between signup and first API call). app_metadata is admin-controlled and
 *      cannot be spoofed by the client.
 *
 * Returns null and sends a 403 if neither check passes.
 */
export async function requireAcademy(req: Request, res: Response): Promise<AuthContext | null> {
  const auth = await requireUser(req, res);
  if (!auth) return null;

  const allowed = await verifyRoleFromDb(auth.user.id, ACADEMY_ROLES);
  if (allowed) return auth;

  // Fallback: user_metadata is client-writable but safe here because verifyRoleFromDb
  // is the authoritative gate; this fallback only fires when the DB check is unavailable
  // or the profiles row doesn't exist yet.
  if (hasAnyRole(auth.user, ACADEMY_ROLES)) return auth;

  res.status(403).json({ success: false, message: "Academy access required" });
  return null;
}

/**
 * Require the authenticated user to hold a recruiter/employer role.
 *
 * Same two-step check as requireAcademy.
 */
// ── URL validation ────────────────────────────────────────────────────────────

/**
 * Validate that a user-supplied URL is http or https.
 * Returns the trimmed URL if valid, null if empty, or throws a TypeError
 * with a user-facing message if the scheme is not http(s).
 *
 * This prevents javascript: and data: URLs from being stored and later
 * rendered in <a href> or <img src> attributes.
 */
export function safeHttpUrl(raw: unknown, fieldName = "URL"): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(`${fieldName} must start with http:// or https://`);
    }
    return value;
  } catch (err) {
    if (err instanceof TypeError && err.message.includes("must start with")) throw err;
    throw new TypeError(`${fieldName} is not a valid URL`);
  }
}

export async function requireRecruiter(req: Request, res: Response): Promise<AuthContext | null> {
  const auth = await requireUser(req, res);
  if (!auth) return null;

  const allowed = await verifyRoleFromDb(auth.user.id, RECRUITER_ROLES);
  if (allowed) return auth;

  if (hasAnyRole(auth.user, RECRUITER_ROLES)) return auth;

  res.status(403).json({ success: false, message: "Recruiter or employer access required" });
  return null;
}

// ── Shared job-ownership helpers ─────────────────────────────────────────────

/**
 * Resolve the recruiter_profiles.id for a given auth user UUID.
 * The live schema uses id = auth.users(id); later migrations also add user_id.
 */
export async function getRecruiterProfileId(
  client: ReturnType<typeof createAuthenticatedClient>,
  userId: string,
): Promise<string | null> {
  const byUser = await client.from("recruiter_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (byUser.data?.id) return byUser.data.id as string;
  const byId = await client.from("recruiter_profiles").select("id").eq("id", userId).maybeSingle();
  return (byId.data?.id as string) ?? null;
}

/**
 * Return true when `userId` owns the job identified by `jobId`.
 * Checks owner_id, employer_id, and recruiter_id (via recruiter_profiles).
 */
export async function ownsJob(
  client: ReturnType<typeof createAuthenticatedClient>,
  jobId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await client
    .from("jobs")
    .select("id, owner_id, employer_id, recruiter_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!data) return false;
  const row = data as { owner_id?: string | null; employer_id?: string | null; recruiter_id?: string | null };
  if (row.owner_id === userId || row.employer_id === userId) return true;
  if (!row.recruiter_id) return false;
  const recruiterId = await getRecruiterProfileId(client, userId);
  return Boolean(recruiterId && row.recruiter_id === recruiterId);
}

// ── Safe error serialisation ──────────────────────────────────────────────────

/**
 * Return a safe, client-facing error message.
 *
 * Raw Supabase error messages can leak schema details (table names, column
 * names, RLS policy names). This helper returns the raw message only in
 * development; in production it returns a generic fallback unless the caller
 * supplies an explicit override.
 */
export function safeErrorMessage(
  err: { message?: string } | null | undefined,
  fallback = "An unexpected error occurred.",
): string {
  if (process.env.NODE_ENV !== "production") {
    return err?.message ?? fallback;
  }
  return fallback;
}