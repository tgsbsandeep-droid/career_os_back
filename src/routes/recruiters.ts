import express = require("express");
const { createAuthenticatedClient } = require("../lib/supabase");
import { requireRecruiter } from "../lib/authz";

const router = express.Router();

const COMPANY_SIZES = ["startup", "small", "medium", "large", "enterprise"] as const;
type CompanySize = (typeof COMPANY_SIZES)[number];

async function findRecruiterProfile(client: ReturnType<typeof createAuthenticatedClient>, userId: string) {
  const byUser = await client.from("recruiter_profiles").select("*").eq("user_id", userId).maybeSingle();
  if (!byUser.error && byUser.data) return byUser;
  return client.from("recruiter_profiles").select("*").eq("id", userId).maybeSingle();
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

function asCompanySize(value: unknown): CompanySize | null {
  const size = asString(value).toLowerCase();
  return COMPANY_SIZES.includes(size as CompanySize) ? (size as CompanySize) : null;
}

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeProfile(data: Record<string, unknown> | null) {
  if (!data) return null;
  const details = asObject(data.profile_details);
  const bio = asString(data.bio) || asString(data.company_description) || asString(details.bio);
  return {
    company_name: asString(data.company_name) || asString(details.company_name),
    headline: asString(data.headline) || asString(details.headline),
    bio,
    company_description: asString(data.company_description) || bio,
    avatar_url: asString(data.avatar_url) || asString(details.avatar_url) || null,
    location: asString(data.location) || asString(details.location),
    industry: asString(data.industry) || asString(details.industry),
    company_size: asCompanySize(data.company_size) ?? asCompanySize(details.company_size),
    founded_year: asOptionalNumber(data.founded_year) ?? asOptionalNumber(details.founded_year),
    website: asString(data.website) || asString(details.website) || null,
    linkedin_url: asString(data.linkedin_url) || asString(details.linkedin_url) || null,
    phone: asString(data.phone) || asString(details.phone),
    contact_email: asString(data.contact_email) || asString(details.contact_email),
    hiring_roles: asStringArray(data.hiring_roles).length ? asStringArray(data.hiring_roles) : asStringArray(details.hiring_roles),
    work_modes: asStringArray(data.work_modes).length ? asStringArray(data.work_modes) : asStringArray(details.work_modes),
    benefits: asStringArray(data.benefits).length ? asStringArray(data.benefits) : asStringArray(details.benefits),
    culture_values: asStringArray(data.culture_values).length ? asStringArray(data.culture_values) : asStringArray(details.culture_values),
  };
}

function profilePayload(userId: string, body: Record<string, unknown>, includeUserId: boolean) {
  const company_name = asString(body.company_name);
  const headline = asString(body.headline);
  const bio = asString(body.bio);
  const avatar_url = asString(body.avatar_url) || null;
  const location = asString(body.location);
  const industry = asString(body.industry);
  const company_size = asCompanySize(body.company_size);
  const founded_year = asOptionalNumber(body.founded_year);
  const website = asString(body.website) || null;
  const linkedin_url = asString(body.linkedin_url) || null;
  const phone = asString(body.phone);
  const contact_email = asString(body.contact_email);
  const hiring_roles = asStringArray(body.hiring_roles);
  const work_modes = asStringArray(body.work_modes);
  const benefits = asStringArray(body.benefits);
  const culture_values = asStringArray(body.culture_values);
  const profile_details = {
    company_name,
    headline,
    bio,
    avatar_url,
    location,
    industry,
    company_size,
    founded_year,
    website,
    linkedin_url,
    phone,
    contact_email,
    hiring_roles,
    work_modes,
    benefits,
    culture_values,
  };
  const base: Record<string, unknown> = {
    id: userId,
    company_name,
    company_description: bio,
    bio,
    website,
    updated_at: new Date().toISOString(),
  };
  if (includeUserId) base.user_id = userId;
  return {
    ...base,
    headline,
    avatar_url,
    location,
    industry,
    company_size,
    founded_year,
    linkedin_url,
    phone,
    contact_email,
    hiring_roles,
    work_modes,
    benefits,
    culture_values,
    profile_details,
  };
}

router.get("/:id/profile", async (req, res) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  if (req.params.id !== auth.user.id) return res.status(403).json({ success: false, message: "You can only access your own profile" });
  const { data, error } = await findRecruiterProfile(auth.client, auth.user.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, profile: normalizeProfile((data as Record<string, unknown> | null) ?? null) });
});

router.put("/:id/profile", async (req, res) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  if (req.params.id !== auth.user.id) return res.status(403).json({ success: false, message: "You can only update your own profile" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const payloads = [
    { payload: profilePayload(auth.user.id, body, true), onConflict: "user_id" },
    { payload: profilePayload(auth.user.id, body, false), onConflict: "id" },
    {
      payload: {
        id: auth.user.id,
        user_id: auth.user.id,
        company_name: asString(body.company_name),
        company_description: asString(body.bio),
        bio: asString(body.bio),
        website: asString(body.website),
        updated_at: new Date().toISOString(),
      },
      onConflict: "user_id",
    },
    {
      payload: {
        id: auth.user.id,
        company_name: asString(body.company_name),
        bio: asString(body.bio),
        website: asString(body.website),
        updated_at: new Date().toISOString(),
      },
      onConflict: "id",
    },
  ];
  let lastError: { message: string } | null = null;
  for (const attempt of payloads) {
    const { data, error } = await auth.client.from("recruiter_profiles").upsert(attempt.payload, { onConflict: attempt.onConflict }).select().single();
    if (!error) {
      return res.json({ success: true, profile: normalizeProfile((data as Record<string, unknown> | null) ?? null) });
    }
    lastError = error;
    if (!/column|schema cache|could not find|on conflict/i.test(error.message)) break;
  }
  return res.status(500).json({ success: false, message: lastError?.message ?? "Unable to save recruiter profile" });
});

router.get("/:id/analytics", async (req, res) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  if (req.params.id !== auth.user.id) return res.status(403).json({ success: false, message: "You can only access your own analytics" });

  const [owned, employer] = await Promise.all([
    auth.client.from("jobs").select("id, status, title").eq("owner_id", auth.user.id),
    auth.client.from("jobs").select("id, status, title").eq("employer_id", auth.user.id),
  ]);
  const { data: rp } = await findRecruiterProfile(auth.client, auth.user.id);
  const recruiterId = rp?.id ?? auth.user.id;
  const byRecruiter = recruiterId
    ? await auth.client.from("jobs").select("id, status, title").eq("recruiter_id", recruiterId)
    : { data: [], error: null };
  const merged = new Map<string, { id: string; status: string; title: string }>();
  for (const row of [...(owned.data ?? []), ...(employer.data ?? []), ...(byRecruiter.data ?? [])] as { id: string; status: string; title: string }[]) {
    if (row?.id) merged.set(row.id, row);
  }
  const jobs = [...merged.values()];
  const jobsErr = owned.error && employer.error && byRecruiter.error ? owned.error : null;
  if (jobsErr) return res.status(500).json({ success: false, message: jobsErr.message });

  const jobIds = (jobs ?? []).map((j: { id: string }) => j.id);

  // Get all applications for those jobs
  const { data: applications, error: appsErr } = jobIds.length
    ? await auth.client.from("applications").select("id, status, job_id").in("job_id", jobIds)
    : { data: [], error: null };
  if (appsErr) return res.status(500).json({ success: false, message: appsErr.message });

  const apps = (applications ?? []) as { id: string; status: string; job_id: string }[];

  // Pipeline breakdown
  const pipeline: Record<string, number> = { applied: 0, shortlisted: 0, interview: 0, hired: 0, rejected: 0 };
  for (const app of apps) {
    const s = app.status in pipeline ? app.status : "applied";
    pipeline[s] = (pipeline[s] ?? 0) + 1;
  }

  // Per-job applicant count
  const perJob = (jobs ?? []).map((j: { id: string; title: string; status: string }) => ({
    id: j.id,
    title: j.title,
    status: j.status,
    applicants: apps.filter((a) => a.job_id === j.id).length,
  }));

  return res.json({
    success: true,
    analytics: {
      total_jobs: (jobs ?? []).length,
      open_jobs: (jobs ?? []).filter((j: { status: string }) => j.status === "open" || j.status === "published").length,
      total_applicants: apps.length,
      hired: pipeline.hired,
      pipeline,
      per_job: perJob,
    },
  });
});

export = router;
