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

  // Fallback: app_metadata is admin-controlled and safe to trust.
  if (hasAnyRole(auth.user, ACADEMY_ROLES)) return auth;

  res.status(403).json({ success: false, message: "Academy access required" });
  return null;
}

/**
 * Require the authenticated user to hold a recruiter/employer role.
 *
 * Same two-step check as requireAcademy.
 */
export async function requireRecruiter(req: Request, res: Response): Promise<AuthContext | null> {
  const auth = await requireUser(req, res);
  if (!auth) return null;

  const allowed = await verifyRoleFromDb(auth.user.id, RECRUITER_ROLES);
  if (allowed) return auth;

  if (hasAnyRole(auth.user, RECRUITER_ROLES)) return auth;

  res.status(403).json({ success: false, message: "Recruiter or employer access required" });
  return null;
}