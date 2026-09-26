const { createClient } = require("@supabase/supabase-js");
const { collectRoles, hasAnyRole } = require("./roles");

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

// Service-role client — bypasses RLS, server-side only, never exposed to clients.
const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } })
  : null;

const PROFILE_ROLE_ALIASES: Record<string, string> = {
  tutor: "academy",
  instructor: "academy",
  training_institute: "candidate",
  college: "candidate",
  student: "candidate",
  employer: "recruiter",
};

/**
 * Verify a user's role against the server-side `profiles` table.
 * This is the authoritative check — it cannot be spoofed by writing to
 * user_metadata from the client. Falls back to JWT metadata only when the
 * service-role key is not configured (e.g. local dev without the key).
 */
async function verifyRoleFromDb(
  userId: string,
  allowed: string[],
): Promise<boolean> {
  // When the service-role key is absent (local dev or misconfigured deployment)
  // we cannot query the profiles table as admin, so we cannot do the authoritative
  // DB check. Return false here; callers are expected to fall back to hasAnyRole()
  // against the JWT when supabaseAdmin is unavailable.
  if (!supabaseAdmin) return false;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("role, roles")
    .eq("id", userId)
    .maybeSingle();
  // If the profiles row doesn't exist yet (e.g. race between signup and first API
  // call) treat as not-yet-verified rather than hard-denying.
  if (error) {
    console.error(`[verifyRoleFromDb] DB error for user ${userId}:`, error.message);
    return false;
  }
  if (!data) {
    console.warn(`[verifyRoleFromDb] No profiles row found for user ${userId} — profile may not have been created yet`);
    return false;
  }
  const normalizedAllowed = new Set(
    allowed.map((r) => {
      const v = r.trim().toLowerCase();
      return PROFILE_ROLE_ALIASES[v] ?? v;
    }),
  );
  const profileRoles: string[] = [
    ...(Array.isArray(data.roles) ? data.roles : []),
    data.role,
  ]
    .map((r) => {
      const v = String(r ?? "").trim().toLowerCase();
      return PROFILE_ROLE_ALIASES[v] ?? v;
    })
    .filter(Boolean);
  return profileRoles.some((r) => normalizedAllowed.has(r));
}

/**
 * Verify a Supabase JWT locally using SUPABASE_JWT_SECRET (HS256).
 * Returns the decoded payload on success, null on any failure.
 * Used only as a clock-skew fallback — the signature IS checked here.
 */
async function verifyJwtLocally(token: string): Promise<Record<string, any> | null> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null; // No secret configured — fail closed.
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    // Import the HMAC-SHA256 key.
    const keyData = new TextEncoder().encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      "raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );

    // Verify the signature over "header.payload".
    const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sigBytes = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const valid = await crypto.subtle.verify("HMAC", cryptoKey, sigBytes, signingInput);
    if (!valid) return null;

    // Signature is valid — decode the payload.
    const json = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, any>;
  } catch {
    return null;
  }
}

/**
 * Get the Supabase user from an access token.
 * Falls back to local JWT verification (signature-checked via SUPABASE_JWT_SECRET)
 * when the remote auth server rejects the token with a clock-skew error.
 * If SUPABASE_JWT_SECRET is not set the fallback is disabled (fail-closed).
 */
async function getUserFromToken(token: string) {
  const { data, error } = await supabase.auth.getUser(token);
  if (!error) return data.user;

  // Only attempt the fallback for clock-skew errors, not for expired/revoked tokens.
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("issued at future") || message.includes("iat is in the future")) {
    const payload = await verifyJwtLocally(token);
    if (payload?.sub) {
      return {
        id: payload.sub as string,
        email: payload.email as string | undefined,
        user_metadata: (payload.user_metadata ?? {}) as Record<string, any>,
        app_metadata: (payload.app_metadata ?? {}) as Record<string, any>,
      };
    }
  }

  return null;
}

function createAuthenticatedClient(accessToken: string) {
  return createClient(supabaseUrl, supabaseKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

module.exports = { supabase, createAuthenticatedClient, getUserFromToken, hasAnyRole, collectRoles, verifyRoleFromDb };
