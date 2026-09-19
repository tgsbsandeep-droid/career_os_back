import express = require("express");
const { createAuthenticatedClient, getUserFromToken, hasAnyRole } = require("../lib/supabase");

const router = express.Router();

const TUTOR_ROLES = ["tutor", "academy", "instructor"];

async function requireTutor(req: express.Request, res: express.Response) {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  const user = await getUserFromToken(token);
  if (!user || !hasAnyRole(user, TUTOR_ROLES)) {
    res.status(403).json({ success: false, message: "Tutor access required" });
    return null;
  }
  return { user, client: createAuthenticatedClient(token) };
}

async function findTutorProfile(client: ReturnType<typeof createAuthenticatedClient>, userId: string) {
  const byUser = await client.from("tutor_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (!byUser.error && byUser.data) return byUser;
  return client.from("tutor_profiles").select("*").eq("id", userId).maybeSingle();
}

router.get("/:id/profile", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (req.params.id !== auth.user.id) {
    res.status(403).json({ success: false, message: "You can only access your own profile" });
    return;
  }
  const { data, error } = await findTutorProfile(auth.client, auth.user.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, profile: data });
});

router.put("/:id/profile", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (req.params.id !== auth.user.id) {
    res.status(403).json({ success: false, message: "You can only access your own profile" });
    return;
  }
  const payloads = [
    {
      id: auth.user.id,
      user_id: auth.user.id,
      bio: req.body.bio ?? "",
      headline: req.body.headline ?? "",
      teaching_experience_years: req.body.teaching_experience_years ?? null,
      preferred_teaching_mode: req.body.preferred_teaching_mode ?? null,
      hourly_rate: req.body.hourly_rate ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      id: auth.user.id,
      bio: req.body.bio ?? "",
      updated_at: new Date().toISOString(),
    },
  ];
  let lastError: { message: string } | null = null;
  for (const payload of payloads) {
    const onConflict = "user_id" in payload ? "user_id" : "id";
    const { data, error } = await auth.client.from("tutor_profiles").upsert(payload, { onConflict }).select().single();
    if (!error) return res.json({ success: true, profile: data });
    lastError = error;
    if (!/column|schema cache|could not find|on conflict/i.test(error.message)) break;
  }
  return res.status(500).json({ success: false, message: lastError?.message ?? "Unable to save tutor profile" });
});

export = router;
