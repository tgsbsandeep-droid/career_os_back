import express = require("express");
const { supabase, createAuthenticatedClient, getUserFromToken, hasAnyRole } = require("../lib/supabase");
const { parsePageParams, pageMeta } = require("../lib/pagination");
import type { Request, Response } from "express";

const router = express.Router();

type ApplicantApplication = { id: string; candidate_id: string; job_id: string; status: string; resume_url: string | null; created_at: string; updated_at: string };
type CandidateProfile = {
  id: string;
  full_name?: string;
  bio?: string;
  education?: string;
  skills?: string[];
  experience?: string[];
  location?: string;
  contact_email?: string;
  resume_url?: string | null;
  avatar_url?: string | null;
};

async function requireRecruiter(req: Request, res: Response) {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  const user = await getUserFromToken(token);
  if (!user || !hasAnyRole(user, ["recruiter", "employer"])) {
    res.status(403).json({ success: false, message: "Recruiter or employer access required" });
    return null;
  }
  return { user, client: createAuthenticatedClient(token) };
}

const EMPLOYMENT_FROM_JOB_TYPE: Record<string, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  freelance: "Freelance",
};
const JOB_TYPE_FROM_EMPLOYMENT: Record<string, string> = {
  "Full-time": "full_time",
  "Part-time": "part_time",
  Contract: "contract",
  Internship: "internship",
  Freelance: "freelance",
};

function asStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function publicStatus(status: unknown) {
  if (status === "closed") return "closed";
  if (status === "draft") return "draft";
  return "open";
}

type JobRow = Record<string, unknown> & { id?: string; skills?: unknown; status?: unknown };

function normalizeJobRecord(row: JobRow | null | undefined) {
  if (!row) return row;
  const jobType = String(row.job_type ?? "");
  return {
    ...row,
    company_name: String(row.company_name ?? ""),
    skills: asStringList(row.skills),
    salary_range: String(row.salary_range ?? ""),
    employment_type: String(row.employment_type || EMPLOYMENT_FROM_JOB_TYPE[jobType] || "Full-time"),
    experience_level: String(row.experience_level ?? "mid"),
    status: publicStatus(row.status),
  };
}

function isMissingColumnError(message: string) {
  return /column|schema cache|could not find/i.test(message);
}

function isRlsError(message: string) {
  return /row-level security|violates row-level security policy/i.test(message);
}

function buildJobFields(body: Record<string, unknown>, userId: string) {
  const employmentType = String(body.employment_type || EMPLOYMENT_FROM_JOB_TYPE[String(body.job_type ?? "")] || "Full-time");
  const status = body.status === "closed" ? "closed" : body.status === "draft" ? "draft" : "open";
  const core = {
    title: String(body.title ?? "").trim(),
    description: String(body.description ?? "").trim(),
    location: String(body.location ?? "Remote").trim() || "Remote",
    company_name: String(body.company_name ?? "").trim() || "Company",
    employment_type: employmentType,
    skills: asStringList(body.skills),
    salary_range: String(body.salary_range ?? "").trim(),
    status,
    owner_id: userId,
    employer_id: userId,
  };
  const extra = {
    job_type: JOB_TYPE_FROM_EMPLOYMENT[employmentType] ?? "full_time",
    experience_level: String(body.experience_level ?? "mid"),
    updated_at: new Date().toISOString(),
  };
  return { core, extra, all: { ...core, ...extra } };
}

async function writeJob(
  client: ReturnType<typeof createAuthenticatedClient>,
  action: "insert" | "update",
  fields: ReturnType<typeof buildJobFields>,
  recruiterId: string | null,
  jobId?: string,
) {
  const userId = String(fields.core.owner_id);
  const recruiterIds = [...new Set([userId, recruiterId].filter(Boolean))] as string[];
  const payloads: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const pushPayload = (payload: Record<string, unknown>) => {
    const key = JSON.stringify(payload);
    if (seen.has(key)) return;
    seen.add(key);
    payloads.push(payload);
  };
  for (const base of [fields.all, fields.core] as Record<string, unknown>[]) {
    for (const id of recruiterIds) pushPayload({ ...base, recruiter_id: id });
    pushPayload(base);
  }

  let lastError: { message: string } | null = null;
  for (const payload of payloads) {
    const query = action === "insert"
      ? client.from("jobs").insert(payload).select().single()
      : client.from("jobs").update(payload).eq("id", jobId).select().single();
    const { data, error } = await query;
    if (!error) return { data, error: null };
    lastError = error;
    if (isMissingColumnError(error.message) || isRlsError(error.message)) continue;
    break;
  }

  if (action === "insert" && lastError && isRlsError(lastError.message)) {
    for (const payload of payloads) {
      const inserted = await client.from("jobs").insert(payload);
      if (inserted.error) {
        lastError = inserted.error;
        if (isMissingColumnError(inserted.error.message) || isRlsError(inserted.error.message)) continue;
        break;
      }
      const fetched = await client
        .from("jobs")
        .select("*")
        .eq("owner_id", userId)
        .eq("title", payload.title)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!fetched.error && fetched.data) return { data: fetched.data, error: null };
      const byEmployer = await client
        .from("jobs")
        .select("*")
        .eq("employer_id", userId)
        .eq("title", payload.title)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!byEmployer.error && byEmployer.data) return { data: byEmployer.data, error: null };
    }
  }

  return { data: null, error: lastError };
}

async function getRecruiterProfileId(client: ReturnType<typeof createAuthenticatedClient>, userId: string): Promise<string | null> {
  const byUser = await client.from("recruiter_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (byUser.data?.id) return byUser.data.id;
  const byId = await client.from("recruiter_profiles").select("id").eq("id", userId).maybeSingle();
  return byId.data?.id ?? null;
}

async function jobsOwnedBy(client: ReturnType<typeof createAuthenticatedClient>, userId: string) {
  const recruiterId = await getRecruiterProfileId(client, userId);
  const [owned, employer, byRecruiter] = await Promise.all([
    client.from("jobs").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
    client.from("jobs").select("*").eq("employer_id", userId).order("created_at", { ascending: false }),
    recruiterId
      ? client.from("jobs").select("*").eq("recruiter_id", recruiterId).order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const merged = new Map<string, JobRow>();
  for (const row of [...(owned.data ?? []), ...(employer.data ?? []), ...(byRecruiter.data ?? [])] as JobRow[]) {
    if (row?.id) merged.set(row.id, row);
  }
  const jobsErr = owned.error && employer.error && byRecruiter.error ? owned.error : null;
  return { data: [...merged.values()], error: jobsErr };
}

function skillOverlap(candidateSkills: string[], jobSkills: string[]) {
  const required = [...new Set(jobSkills.map((skill) => skill.toLowerCase().trim()).filter(Boolean))];
  const profile = candidateSkills.map((skill) => skill.toLowerCase().trim()).filter(Boolean);
  const strengths = required.filter((skill) => profile.some((item) => item.includes(skill) || skill.includes(item)));
  const gaps = required.filter((skill) => !strengths.includes(skill));
  const score = required.length ? Math.round((strengths.length / required.length) * 100) : 0;
  return { score, strengths: strengths.slice(0, 6), gaps: gaps.slice(0, 6) };
}

async function ownsJob(client: ReturnType<typeof createAuthenticatedClient>, jobId: string, userId: string) {
  const full = await client.from("jobs").select("id, owner_id, employer_id, recruiter_id").eq("id", jobId).maybeSingle();
  const fallback = full.error && isMissingColumnError(full.error.message)
    ? await client.from("jobs").select("id, owner_id, employer_id").eq("id", jobId).maybeSingle()
    : full;
  const data = fallback.data as { owner_id?: string | null; employer_id?: string | null; recruiter_id?: string | null } | null;
  if (!data) return false;
  if (data.owner_id === userId || data.employer_id === userId) return true;
  if (!data.recruiter_id) return false;
  const recruiterId = await getRecruiterProfileId(client, userId);
  return Boolean(recruiterId && data.recruiter_id === recruiterId);
}

type SkillMatch = {
  id: string;
  full_name: string;
  location: string;
  education: string;
  skills: string[];
  match_score: number;
  strengths: string[];
  gaps: string[];
  already_applied: boolean;
};

function isMissingRpcError(message: string) {
  return /could not find the function|function ["']?[\w.]+["']? does not exist|schema cache/i.test(message);
}

function normalizeSkillMatch(row: Record<string, unknown>): SkillMatch {
  return {
    id: String(row.id ?? ""),
    full_name: String(row.full_name ?? "Candidate"),
    location: String(row.location ?? ""),
    education: String(row.education ?? ""),
    skills: asStringList(row.skills),
    match_score: Math.max(0, Math.min(100, Number(row.match_score) || 0)),
    strengths: asStringList(row.strengths),
    gaps: asStringList(row.gaps),
    already_applied: Boolean(row.already_applied),
  };
}

async function matchFromKnownApplicants(
  client: ReturnType<typeof createAuthenticatedClient>,
  userId: string,
  jobId: string,
  jobSkills: string[],
): Promise<SkillMatch[]> {
  if (!jobSkills.length) return [];
  const { data: owned } = await jobsOwnedBy(client, userId);
  const jobIds = ((owned ?? []) as JobRow[]).map((row) => String(row.id ?? "")).filter(Boolean);
  if (!jobIds.length) return [];
  const { data: applications } = await client.from("applications").select("candidate_id, job_id").in("job_id", jobIds);
  const rows = (applications ?? []) as { candidate_id?: string; job_id?: string }[];
  const appliedToJob = new Set(
    rows.filter((row) => row.job_id === jobId).map((row) => String(row.candidate_id ?? "")).filter(Boolean),
  );
  const candidateIds = [...new Set(rows.map((row) => String(row.candidate_id ?? "")).filter(Boolean))];
  const profiles = await loadApplicantProfiles(client, candidateIds);
  return [...profiles.values()]
    .map((profile) => {
      const overlap = skillOverlap(asStringList(profile.skills), jobSkills);
      return {
        id: profile.id,
        full_name: String(profile.full_name ?? "Candidate"),
        location: String(profile.location ?? ""),
        education: String(profile.education ?? ""),
        skills: asStringList(profile.skills),
        match_score: overlap.score,
        strengths: overlap.strengths,
        gaps: overlap.gaps,
        already_applied: appliedToJob.has(profile.id),
      };
    })
    .filter((row) => row.match_score > 0)
    .sort((a, b) => Number(a.already_applied) - Number(b.already_applied) || b.match_score - a.match_score)
    .slice(0, 12);
}

async function loadJobSkillMatches(
  client: ReturnType<typeof createAuthenticatedClient>,
  userId: string,
  jobId: string,
  jobSkills: string[],
) {
  const rpc = await client.rpc("match_candidates_for_job", { p_job_id: jobId });
  if (!rpc.error) {
    return {
      error: null as { message: string } | null,
      matches: ((rpc.data ?? []) as Record<string, unknown>[]).map(normalizeSkillMatch).filter((row) => row.id),
    };
  }
  if (!isMissingRpcError(rpc.error.message) && !isMissingColumnError(rpc.error.message)) {
    return { error: rpc.error, matches: [] as SkillMatch[] };
  }
  return { error: null, matches: await matchFromKnownApplicants(client, userId, jobId, jobSkills) };
}

async function loadApplicantProfiles(
  client: ReturnType<typeof createAuthenticatedClient>,
  candidateIds: string[],
) {
  const profileMap = new Map<string, CandidateProfile>();
  if (!candidateIds.length) return profileMap;
  const selects = [
    "id, full_name, bio, education, skills, experience, location, contact_email, resume_url, avatar_url",
    "id, full_name, bio, education, skills, experience, location, contact_email, resume_url",
    "id, full_name, education, skills, experience, location, contact_email, resume_url",
    "id, full_name, skills, location, resume_url",
    "id, full_name",
  ];
  for (const columns of selects) {
    const { data, error } = await client.from("candidate_profiles").select(columns).in("id", candidateIds);
    if (!error) {
      for (const profile of (data ?? []) as CandidateProfile[]) {
        if (profile?.id) profileMap.set(profile.id, profile);
      }
      break;
    }
    if (!isMissingColumnError(error.message)) break;
  }
  const missing = candidateIds.filter((id) => !profileMap.has(id));
  if (missing.length) {
    const { data: fallbacks } = await client.from("profiles").select("id, full_name").in("id", missing);
    for (const row of (fallbacks ?? []) as { id: string; full_name?: string }[]) {
      if (!row?.id) continue;
      profileMap.set(row.id, { id: row.id, full_name: row.full_name ?? "" });
    }
  }
  return profileMap;
}

router.get("/", async (req: Request, res: Response) => {
  const { limit, offset, from, to } = parsePageParams(req);
  const { data, error, count } = await supabase
    .from("jobs")
    .select("*", { count: "exact" })
    .in("status", ["open", "published"])
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }

  return res.json({
    success: true,
    jobs: ((data ?? []) as JobRow[]).map((row) => normalizeJobRecord(row)),
    page: pageMeta(count ?? 0, limit, offset),
  });
});

router.get("/mine", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const { data, error } = await jobsOwnedBy(auth.client, auth.user.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, jobs: ((data ?? []) as JobRow[]).map((row) => normalizeJobRecord(row)) });
});

router.get("/recommended", async (req: Request, res: Response) => {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, message: "Authentication required" });
  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ success: false, message: "Authentication required" });
  const client = createAuthenticatedClient(token);
  const [{ data: profile }, { data: jobs, error: jobsError }, { data: applications }] = await Promise.all([
    client.from("candidate_profiles").select("skills").eq("id", user.id).maybeSingle(),
    supabase.from("jobs").select("*").in("status", ["open", "published"]).order("created_at", { ascending: false }),
    client.from("applications").select("job_id").eq("candidate_id", user.id),
  ]);
  if (jobsError) return res.status(500).json({ success: false, message: jobsError.message });
  const candidateSkills = asStringList(profile?.skills);
  const applied = new Set(((applications ?? []) as { job_id: string }[]).map((row) => row.job_id));
  const recommendations = ((jobs ?? []) as JobRow[])
    .map((row) => normalizeJobRecord(row))
    .filter((job): job is NonNullable<ReturnType<typeof normalizeJobRecord>> => Boolean(job) && !applied.has(String(job?.id)))
    .map((job) => {
      const match = skillOverlap(candidateSkills, asStringList(job.skills));
      return { ...job, match_score: match.score, strengths: match.strengths, gaps: match.gaps };
    })
    .filter((job) => job.match_score > 0)
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 12);
  return res.json({ success: true, jobs: recommendations, skills: candidateSkills });
});

router.post("/", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const fields = buildJobFields(req.body ?? {}, auth.user.id);
  if (!fields.core.title) return res.status(400).json({ success: false, message: "Title is required" });
  if (fields.core.status !== "draft" && !fields.core.description) {
    return res.status(400).json({ success: false, message: "Description is required to publish" });
  }
  const recruiterId = await getRecruiterProfileId(auth.client, auth.user.id);
  const { data, error } = await writeJob(auth.client, "insert", fields, recruiterId);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.status(201).json({ success: true, job: normalizeJobRecord(data as JobRow) });
});

router.get("/:id", async (req: Request, res: Response) => {
  const { data, error } = await supabase.from("jobs").select("*").eq("id", req.params.id).maybeSingle();
  if (error || !data) return res.status(404).json({ success: false, message: "Job not found" });
  const status = String((data as JobRow).status ?? "").toLowerCase();
  if (status !== "open" && status !== "published") {
    const authorization = req.header("Authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    const user = token ? await getUserFromToken(token) : null;
    const client = token ? createAuthenticatedClient(token) : null;
    const owner = user && client ? await ownsJob(client, String(req.params.id), user.id) : false;
    if (!owner) return res.status(404).json({ success: false, message: "Job not found" });
  }
  return res.json({ success: true, job: normalizeJobRecord(data as JobRow) });
});

router.put("/:id", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const jobId = String(req.params.id ?? "");
  if (!(await ownsJob(auth.client, jobId, auth.user.id))) return res.status(404).json({ success: false, message: "Job not found" });
  const fields = buildJobFields(req.body ?? {}, auth.user.id);
  if (!fields.core.title) return res.status(400).json({ success: false, message: "Title is required" });
  if (fields.core.status !== "draft" && !fields.core.description) {
    return res.status(400).json({ success: false, message: "Description is required to publish" });
  }
  const recruiterId = await getRecruiterProfileId(auth.client, auth.user.id);
  const { data, error } = await writeJob(auth.client, "update", fields, recruiterId, jobId);
  if (error) return res.status(404).json({ success: false, message: "Job not found" });
  return res.json({ success: true, job: normalizeJobRecord(data as JobRow) });
});

router.get("/:id/applicants", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const jobId = String(req.params.id ?? "");
  if (!(await ownsJob(auth.client, jobId, auth.user.id))) return res.status(404).json({ success: false, message: "Job not found" });
  const { data: applications, error } = await auth.client.from("applications").select("*").eq("job_id", jobId).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, message: error.message });
  const applicantRecords = (applications ?? []) as ApplicantApplication[];
  const candidateIds = [...new Set(applicantRecords.map((application) => application.candidate_id).filter(Boolean))];
  const profileMap = await loadApplicantProfiles(auth.client, candidateIds);
  return res.json({
    success: true,
    applicants: applicantRecords.map((application) => ({
      ...application,
      candidate: profileMap.get(application.candidate_id) ?? null,
    })),
  });
});

router.get("/:id/matches", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const jobId = String(req.params.id ?? "");
  if (!(await ownsJob(auth.client, jobId, auth.user.id))) return res.status(404).json({ success: false, message: "Job not found" });
  const { data: job, error: jobError } = await auth.client.from("jobs").select("id, skills").eq("id", jobId).maybeSingle();
  if (jobError || !job) return res.status(404).json({ success: false, message: "Job not found" });
  const jobSkills = asStringList((job as JobRow).skills);
  const { matches, error } = await loadJobSkillMatches(auth.client, auth.user.id, jobId, jobSkills);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, matches, skills: jobSkills });
});

function inviteIntent(value: unknown): "shortlisted" | "interview" {
  return String(value ?? "").trim().toLowerCase() === "interview" ? "interview" : "shortlisted";
}

function isMissingInviteRpc(message: string) {
  return isMissingRpcError(message) || /invite_candidate_to_job/i.test(message);
}

async function decorateInvitedApplicant(
  client: ReturnType<typeof createAuthenticatedClient>,
  application: ApplicantApplication & Record<string, unknown>,
) {
  const profiles = await loadApplicantProfiles(client, [application.candidate_id]);
  return {
    ...application,
    candidate: profiles.get(application.candidate_id) ?? null,
  };
}

router.post("/:id/invite", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const jobId = String(req.params.id ?? "");
  const candidateId = String(req.body?.candidate_id ?? req.body?.candidateId ?? "").trim();
  const status = inviteIntent(req.body?.status ?? req.body?.intent);
  const notes = String(req.body?.notes ?? "").trim();
  if (!candidateId) return res.status(400).json({ success: false, message: "Select a candidate." });
  if (!(await ownsJob(auth.client, jobId, auth.user.id))) return res.status(404).json({ success: false, message: "Job not found" });

  const { data: job } = await auth.client.from("jobs").select("id, status").eq("id", jobId).maybeSingle();
  const jobStatus = String((job as { status?: string } | null)?.status ?? "").toLowerCase();
  if (!job || (jobStatus !== "open" && jobStatus !== "published")) {
    return res.status(400).json({ success: false, message: "Publish this job before inviting candidates." });
  }

  let applicationId = "";
  const rpc = await auth.client.rpc("invite_candidate_to_job", {
    p_job_id: jobId,
    p_candidate_id: candidateId,
    p_status: status,
    p_notes: notes,
  });
  if (!rpc.error && rpc.data) {
    applicationId = String(Array.isArray(rpc.data) ? rpc.data[0] : rpc.data);
  } else if (rpc.error && !isMissingInviteRpc(rpc.error.message) && !isMissingColumnError(rpc.error.message)) {
    const message = rpc.error.message || "Could not invite this candidate.";
    if (/publish this job/i.test(message)) return res.status(400).json({ success: false, message });
    if (/not found/i.test(message)) return res.status(404).json({ success: false, message });
    return res.status(500).json({ success: false, message });
  } else {
    const existing = await auth.client
      .from("applications")
      .select("*")
      .eq("job_id", jobId)
      .eq("candidate_id", candidateId)
      .maybeSingle();
    if (existing.data?.id) {
      applicationId = String(existing.data.id);
    } else {
      const payloads: Record<string, unknown>[] = [
        { candidate_id: candidateId, job_id: jobId, status: "applied", notes: notes || null },
        { candidate_id: candidateId, job_id: jobId, status: "applied" },
      ];
      let insertError = "";
      for (const payload of payloads) {
        const inserted = await auth.client.from("applications").insert(payload).select("*").single();
        if (!inserted.error && inserted.data?.id) {
          applicationId = String(inserted.data.id);
          insertError = "";
          break;
        }
        insertError = inserted.error?.message ?? "Could not invite this candidate.";
        if (!isMissingColumnError(insertError)) break;
      }
      if (!applicationId) {
        const rlsBlocked = /row-level security|violates|permission denied|policy/i.test(insertError);
        return res.status(rlsBlocked ? 503 : 500).json({
          success: false,
          message: rlsBlocked
            ? "Apply 20260915_recruiter_candidate_invite.sql in the Supabase SQL Editor, then retry."
            : insertError,
        });
      }
    }
    if (applicationId) {
      const updatePayloads: Record<string, unknown>[] = notes
        ? [{ status, notes, updated_at: new Date().toISOString() }, { status, updated_at: new Date().toISOString() }]
        : [{ status, updated_at: new Date().toISOString() }];
      for (const payload of updatePayloads) {
        const updated = await auth.client.from("applications").update(payload).eq("id", applicationId);
        if (!updated.error) break;
        if (!isMissingColumnError(updated.error.message)) break;
      }
    }
  }

  if (!applicationId) return res.status(500).json({ success: false, message: "Could not invite this candidate." });
  const { data: application, error } = await auth.client.from("applications").select("*").eq("id", applicationId).maybeSingle();
  if (error || !application) return res.status(500).json({ success: false, message: error?.message ?? "Invite saved, but the application could not be loaded." });
  return res.status(201).json({
    success: true,
    application: await decorateInvitedApplicant(auth.client, application as ApplicantApplication & Record<string, unknown>),
  });
});

router.delete("/:id", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const jobId = String(req.params.id ?? "");
  if (!(await ownsJob(auth.client, jobId, auth.user.id))) return res.status(404).json({ success: false, message: "Job not found or not yours" });
  const { error } = await auth.client.from("jobs").delete().eq("id", jobId);
  if (error) return res.status(404).json({ success: false, message: "Job not found or not yours" });
  return res.json({ success: true });
});

router.post("/:id/apply", async (req: Request, res: Response) => {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, message: "Authentication required" });
  const currentUser = await getUserFromToken(token);
  if (!currentUser) return res.status(401).json({ success: false, message: "Authentication required" });

  const client = createAuthenticatedClient(token);
  const { data: job } = await supabase.from("jobs").select("id, status").eq("id", req.params.id).maybeSingle();
  const jobStatus = String(job?.status ?? "").toLowerCase();
  if (!job || (jobStatus !== "open" && jobStatus !== "published")) {
    return res.status(404).json({ success: false, message: "Job not found" });
  }
  const resumeUrl = String(req.body?.resume_url ?? "").trim() || null;
  const coverLetter = String(req.body?.cover_letter ?? req.body?.notes ?? "").trim() || null;
  const payloads: Record<string, unknown>[] = [
    { candidate_id: currentUser.id, job_id: req.params.id, status: "applied", resume_url: resumeUrl, cover_letter: coverLetter, notes: coverLetter },
    { candidate_id: currentUser.id, job_id: req.params.id, status: "applied", resume_url: resumeUrl, cover_letter: coverLetter },
    { candidate_id: currentUser.id, job_id: req.params.id, status: "applied", resume_url: resumeUrl },
  ];
  let data: unknown = null;
  let errorMessage = "";
  for (const payload of payloads) {
    const result = await client.from("applications").upsert(payload, { onConflict: "candidate_id,job_id" }).select().single();
    if (!result.error) {
      data = result.data;
      errorMessage = "";
      break;
    }
    errorMessage = result.error.message;
    if (!isMissingColumnError(result.error.message)) break;
  }
  if (!data) return res.status(500).json({ success: false, message: errorMessage || "Could not submit application" });
  return res.status(201).json({ success: true, application: data });
});

export = router;
