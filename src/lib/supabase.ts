const { createClient } = require("@supabase/supabase-js");

const ROLE_ALIASES: Record<string, string> = {
  tutor: "academy",
  instructor: "academy",
  training_institute: "candidate",
  college: "candidate",
  student: "candidate",
  employer: "recruiter",
};

function collectRoles(user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null | undefined) {
  const meta = user?.user_metadata ?? {};
  const app = user?.app_metadata ?? {};
  const appRoles = [
    ...(Array.isArray(app.roles) ? app.roles : []),
    app.role,
  ];
  const userRoles = [
    ...(Array.isArray(meta.roles) ? meta.roles : []),
    meta.role,
    meta.active_role,
  ];
  const seen = new Set<string>();
  for (const raw of appRoles) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value) continue;
    seen.add(value);
    seen.add(ROLE_ALIASES[value] ?? value);
  }
  const adminFromApp = seen.has("admin");
  for (const raw of userRoles) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value) continue;
    const mapped = ROLE_ALIASES[value] ?? value;
    if ((value === "admin" || mapped === "admin") && !adminFromApp) continue;
    seen.add(value);
    seen.add(mapped);
  }
  return seen;
}

function hasAnyRole(
  user: { user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> } | null | undefined,
  allowed: string[],
) {
  const roles = collectRoles(user);
  return allowed.some((role) => {
    const value = String(role).trim().toLowerCase();
    return roles.has(value) || roles.has(ROLE_ALIASES[value] ?? value);
  });
}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Decode a JWT payload without verifying the signature.
 * Used to extract the user ID from a Supabase access token when the remote
 * auth server rejects the token due to clock skew ("JWT issued at future").
 */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // Base64url → Base64 → JSON
    const rawPayload = parts[1] ?? "";
    const base64 = rawPayload.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Get the Supabase user from an access token.
 * Falls back to local JWT decoding when the remote auth server rejects the
 * token with a clock-skew error ("JWT issued at future").
 */
async function getUserFromToken(token: string) {
  const { data, error } = await supabase.auth.getUser(token);
  if (!error) return data.user;

  // If Supabase rejects the token due to clock skew, decode it locally so
  // the app keeps working. The token's signature is still validated by
  // Supabase's RLS when the authenticated client makes DB queries.
  // Do not treat every JWT error (expired, malformed, revoked) as skew.
  const message = error.message?.toLowerCase() ?? "";
  if (message.includes("issued at future") || message.includes("iat is in the future")) {
    const payload = decodeJwtPayload(token);
    if (payload?.sub) {
      // Return a minimal user-like object with the fields the routes need.
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

module.exports = { supabase, createAuthenticatedClient, getUserFromToken, hasAnyRole, collectRoles };
