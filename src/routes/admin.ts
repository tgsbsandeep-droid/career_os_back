import express = require("express");
const { createAuthenticatedClient, getUserFromToken, hasAnyRole } = require("../lib/supabase");
const { parsePageParams, pageMeta } = require("../lib/pagination");

const router = express.Router();

async function requireAdmin(req: express.Request, res: express.Response) {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  const user = await getUserFromToken(token);
  if (!user || !hasAnyRole(user, ["admin"])) {
    res.status(403).json({ success: false, message: "Admin access required" });
    return null;
  }
  return { user, client: createAuthenticatedClient(token) };
}

router.get("/users", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { limit, offset, from, to } = parsePageParams(req);
  const { data, error, count } = await auth.client.from("profiles").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, users: data, page: pageMeta(count ?? 0, limit, offset) });
});

router.patch("/users/:id/status", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  // profiles table uses is_active (boolean) and is_verified; map "active"/"suspended" to is_active
  const status = req.body.status;
  if (!["active", "suspended"].includes(status)) return res.status(400).json({ success: false, message: "Invalid user status. Use 'active' or 'suspended'" });
  const is_active = status === "active";
  const { data, error } = await auth.client.from("profiles").update({ is_active, updated_at: new Date().toISOString() }).eq("id", req.params.id).select().single();
  if (error) return res.status(404).json({ success: false, message: "User not found" });
  return res.json({ success: true, user: data });
});

const ROLE_ALIASES: Record<string, string> = {
  tutor: "academy",
  instructor: "academy",
  training_institute: "candidate",
  college: "candidate",
  student: "candidate",
  employer: "recruiter",
};

function canonicalRole(raw: unknown) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return "";
  return ROLE_ALIASES[value] ?? value;
}

function profileHasRole(profile: { role?: unknown; roles?: unknown }, role: string) {
  const wanted = canonicalRole(role);
  const fromArray = Array.isArray(profile.roles) ? profile.roles : [];
  if (fromArray.some((entry) => canonicalRole(entry) === wanted)) return true;
  return canonicalRole(profile.role) === wanted;
}

router.get("/stats", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const tables = ["profiles", "courses", "jobs", "applications"] as const;
  const counts = await Promise.all(tables.map(async (table) => {
    const { count, error } = await auth.client.from(table).select("id", { count: "exact", head: true });
    return { table, count: error ? 0 : count ?? 0 };
  }));
  const byRole = new Map(counts.map((entry) => [entry.table, entry.count]));
  const withRoles = await auth.client.from("profiles").select("role, roles");
  const missingRolesColumn = Boolean(withRoles.error?.message && /roles|column|schema cache|could not find/i.test(withRoles.error.message));
  const { data: profiles } = missingRolesColumn
    ? await auth.client.from("profiles").select("role")
    : withRoles;
  const roleCount = (role: string) => (profiles ?? []).filter((profile: { role?: unknown; roles?: unknown }) => profileHasRole(profile, role)).length;
  return res.json({ success: true, stats: { totalUsers: byRole.get("profiles") ?? 0, candidates: roleCount("candidate"), academies: roleCount("academy"), recruiters: roleCount("recruiter"), courses: byRole.get("courses") ?? 0, jobs: byRole.get("jobs") ?? 0, applications: byRole.get("applications") ?? 0 } });
});

router.get("/courses", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { limit, offset, from, to } = parsePageParams(req);
  const withTutor = await auth.client.from("courses").select("id, title, status, tutor_id, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  const missingTutorId = Boolean(withTutor.error?.message && /tutor_id|column|schema cache|could not find/i.test(withTutor.error.message));
  const { data, error, count } = missingTutorId
    ? await auth.client.from("courses").select("id, title, status, owner_id, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to)
    : withTutor;
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, courses: data, page: pageMeta(count ?? 0, limit, offset) });
});

router.get("/jobs", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { limit, offset, from, to } = parsePageParams(req);
  const { data, error, count } = await auth.client.from("jobs").select("id, title, status, recruiter_id, created_at", { count: "exact" }).order("created_at", { ascending: false }).range(from, to);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, jobs: data, page: pageMeta(count ?? 0, limit, offset) });
});

router.patch("/courses/:id/status", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const status = ["draft", "published", "archived"].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ success: false, message: "Invalid course status" });
  const { data, error } = await auth.client.from("courses").update({ status }).eq("id", req.params.id).select().single();
  if (error) return res.status(404).json({ success: false, message: "Course not found" });
  return res.json({ success: true, course: data });
});

router.patch("/jobs/:id/status", async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const status = ["draft", "open", "closed"].includes(req.body.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ success: false, message: "Invalid job status" });
  const { data, error } = await auth.client.from("jobs").update({ status }).eq("id", req.params.id).select().single();
  if (error) return res.status(404).json({ success: false, message: "Job not found" });
  return res.json({ success: true, job: data });
});

export = router;
