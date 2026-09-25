import express = require("express");
const { createAuthenticatedClient, getUserFromToken, hasAnyRole, verifyRoleFromDb } = require("../lib/supabase");

const router = express.Router();

const ACADEMY_ROLES = ["academy", "tutor", "instructor"];
const TEACHING_MODES = ["online", "offline", "hybrid"] as const;

type TeachingMode = (typeof TEACHING_MODES)[number];

async function requireAcademy(req: express.Request, res: express.Response) {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  const user = await getUserFromToken(token);
  if (!user) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  // Authoritative role check: query the server-side profiles table so that
  // user_metadata tampering (candidate → academy escalation) is rejected.
  const allowed = await verifyRoleFromDb(user.id, ACADEMY_ROLES);
  if (!allowed) {
    // Fall back to JWT metadata only when the service-role key is absent (local dev).
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && hasAnyRole(user, ACADEMY_ROLES)) {
      return { user, client: createAuthenticatedClient(token) };
    }
    res.status(403).json({ success: false, message: "Academy access required" });
    return null;
  }
  return { user, client: createAuthenticatedClient(token) };
}

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function asStringArray(value: unknown, max = 40) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of value) {
    const item = asString(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= max) break;
  }
  return items;
}

function asOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asTeachingMode(value: unknown): TeachingMode | null {
  const mode = asString(value).toLowerCase();
  return TEACHING_MODES.includes(mode as TeachingMode) ? (mode as TeachingMode) : null;
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeProfile(data: Record<string, unknown> | null) {
  if (!data) return null;
  const details = asObject(data.profile_details);
  const expertiseRows = Array.isArray(data.tutor_expertise) ? data.tutor_expertise : [];
  const qualificationRows = Array.isArray(data.tutor_qualifications) ? data.tutor_qualifications : [];
  const expertiseFromJoin = expertiseRows
    .map((row) => asString((row as { skill_name?: unknown }).skill_name))
    .filter(Boolean);
  const qualificationsFromJoin = qualificationRows
    .map((row) => asString((row as { qualification_name?: unknown }).qualification_name))
    .filter(Boolean);

  return {
    display_name: asString(data.display_name) || asString(details.display_name),
    headline: asString(data.headline) || asString(details.headline),
    bio: asString(data.bio),
    avatar_url: asString(data.avatar_url) || asString(details.avatar_url) || null,
    location: asString(data.location) || asString(details.location),
    languages: asStringArray(data.languages).length ? asStringArray(data.languages) : asStringArray(details.languages),
    website: asString(data.website) || asString(details.website) || null,
    linkedin_url: asString(data.linkedin_url) || asString(details.linkedin_url) || null,
    phone: asString(data.phone) || asString(details.phone),
    contact_email: asString(data.contact_email) || asString(details.contact_email),
    teaching_experience_years: asOptionalNumber(data.teaching_experience_years) ?? asOptionalNumber(details.teaching_experience_years),
    preferred_teaching_mode: asTeachingMode(data.preferred_teaching_mode) ?? asTeachingMode(details.preferred_teaching_mode),
    hourly_rate: asOptionalNumber(data.hourly_rate) ?? asOptionalNumber(details.hourly_rate),
    teaching_history: asStringArray(data.teaching_history, 20).length
      ? asStringArray(data.teaching_history, 20)
      : asStringArray(details.teaching_history, 20),
    audiences: asStringArray(data.audiences).length ? asStringArray(data.audiences) : asStringArray(details.audiences),
    expertise: expertiseFromJoin.length
      ? expertiseFromJoin
      : asStringArray(data.expertise),
    qualifications: qualificationsFromJoin.length
      ? qualificationsFromJoin
      : asStringArray(data.qualifications),
  };
}

function profilePayload(userId: string, body: Record<string, unknown>, includeUserId: boolean) {
  const display_name = asString(body.display_name);
  const headline = asString(body.headline);
  const bio = asString(body.bio);
  const avatar_url = asString(body.avatar_url) || null;
  const location = asString(body.location);
  const languages = asStringArray(body.languages);
  const website = asString(body.website) || null;
  const linkedin_url = asString(body.linkedin_url) || null;
  const phone = asString(body.phone);
  const contact_email = asString(body.contact_email);
  const teaching_experience_years = asOptionalNumber(body.teaching_experience_years);
  const preferred_teaching_mode = asTeachingMode(body.preferred_teaching_mode);
  const hourly_rate = asOptionalNumber(body.hourly_rate);
  const teaching_history = asStringArray(body.teaching_history, 20);
  const audiences = asStringArray(body.audiences);
  const profile_details = {
    display_name,
    headline,
    avatar_url,
    location,
    languages,
    website,
    linkedin_url,
    phone,
    contact_email,
    teaching_experience_years,
    preferred_teaching_mode,
    hourly_rate,
    teaching_history,
    audiences,
  };
  const base: Record<string, unknown> = {
    id: userId,
    bio,
    updated_at: new Date().toISOString(),
  };
  if (includeUserId) base.user_id = userId;
  return {
    ...base,
    display_name,
    headline,
    avatar_url,
    location,
    languages,
    website,
    linkedin_url,
    phone,
    contact_email,
    teaching_experience_years,
    preferred_teaching_mode,
    hourly_rate,
    teaching_history,
    audiences,
    profile_details,
  };
}

async function upsertTutorProfile(
  client: ReturnType<typeof createAuthenticatedClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const attempts = [
    { payload: profilePayload(userId, body, true), onConflict: "user_id" },
    { payload: profilePayload(userId, body, false), onConflict: "id" },
    {
      payload: {
        id: userId,
        user_id: userId,
        bio: asString(body.bio),
        updated_at: new Date().toISOString(),
      },
      onConflict: "user_id",
    },
    {
      payload: {
        id: userId,
        bio: asString(body.bio),
        updated_at: new Date().toISOString(),
      },
      onConflict: "id",
    },
  ];

  let lastError: { message: string } | null = null;
  for (const attempt of attempts) {
    const result = await client.from("tutor_profiles").upsert(attempt.payload, { onConflict: attempt.onConflict }).select("id").single();
    if (!result.error && result.data) return { id: (result.data as { id: string }).id, error: null };
    lastError = result.error;
    if (result.error && !/column|schema cache|could not find|on conflict/i.test(result.error.message)) break;
  }
  return { id: null as string | null, error: lastError };
}

router.get("/:id/profile", async (req, res) => {
  const auth = await requireAcademy(req, res);
  if (!auth) return;
  if (req.params.id !== auth.user.id) {
    res.status(403).json({ success: false, message: "You can only access your own profile" });
    return;
  }

  const selectWithRelations = "*, tutor_expertise(skill_name), tutor_qualifications(qualification_name)";
  let { data, error } = await auth.client
    .from("tutor_profiles")
    .select(selectWithRelations)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if ((!data || error) && !error?.message?.toLowerCase().includes("column")) {
    const byId = await auth.client
      .from("tutor_profiles")
      .select(selectWithRelations)
      .eq("id", auth.user.id)
      .maybeSingle();
    data = byId.data;
    error = byId.error;
  }
  if (error && /column|schema cache|could not find/i.test(error.message)) {
    const fallback = await auth.client.from("tutor_profiles").select("*").eq("id", auth.user.id).maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, profile: normalizeProfile((data as Record<string, unknown> | null) ?? null) });
});

router.put("/:id/profile", async (req, res) => {
  const auth = await requireAcademy(req, res);
  if (!auth) return;
  if (req.params.id !== auth.user.id) {
    res.status(403).json({ success: false, message: "You can only access your own profile" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const { id: tutorId, error: tpErr } = await upsertTutorProfile(auth.client, auth.user.id, body);
  if (!tutorId) return res.status(500).json({ success: false, message: tpErr?.message ?? "Unable to save academy profile" });

  const expertise = asStringArray(body.expertise);
  const qualifications = asStringArray(body.qualifications, 30);

  await auth.client.from("tutor_expertise").delete().eq("tutor_id", tutorId);
  if (expertise.length > 0) {
    await auth.client.from("tutor_expertise").insert(
      expertise.map((skill) => ({ tutor_id: tutorId, skill_name: skill })),
    );
  }

  await auth.client.from("tutor_qualifications").delete().eq("tutor_id", tutorId);
  if (qualifications.length > 0) {
    await auth.client.from("tutor_qualifications").insert(
      qualifications.map((qualification) => ({ tutor_id: tutorId, qualification_name: qualification })),
    );
  }

  return res.json({
    success: true,
    profile: {
      ...normalizeProfile({
        ...profilePayload(auth.user.id, body, true),
        tutor_expertise: expertise.map((skill_name) => ({ skill_name })),
        tutor_qualifications: qualifications.map((qualification_name) => ({ qualification_name })),
      }),
    },
  });
});

export = router;
