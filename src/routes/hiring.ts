import express = require("express");
const { createAuthenticatedClient, getUserFromToken, hasAnyRole } = require("../lib/supabase");
const { sendInterviewInvitation } = require("../lib/mail");
import type { Request, Response } from "express";

const router = express.Router();

const INTERVIEW_MODES = ["video", "phone", "onsite"] as const;
const INTERVIEW_STATUSES = ["scheduled", "completed", "cancelled"] as const;
const OFFER_STATUSES = ["draft", "sent", "accepted", "declined"] as const;
const TABLE_UNAVAILABLE = "Interview scheduling and offers are not available yet. Apply the hiring migration (20260911_interviews_offers.sql) in the Supabase SQL Editor, then retry.";

type Auth = { user: { id: string }; client: ReturnType<typeof createAuthenticatedClient> };
type ApplicationRow = { id: string; job_id: string; candidate_id: string; status: string };
type InterviewRow = {
  id: string;
  application_id: string;
  job_id: string;
  candidate_id: string;
  recruiter_id: string;
  scheduled_at: string;
  mode: (typeof INTERVIEW_MODES)[number];
  notes: string;
  status: (typeof INTERVIEW_STATUSES)[number];
  created_at?: string;
  updated_at?: string;
};
type OfferRow = {
  id: string;
  application_id: string;
  job_id: string;
  candidate_id: string;
  recruiter_id: string;
  salary: string;
  joining_date: string | null;
  status: (typeof OFFER_STATUSES)[number];
  created_at?: string;
  updated_at?: string;
};

function isMissingRelation(message?: string) {
  if (!message) return false;
  return /could not find the (?:table|relation)\b|relation ["']?[\w.]+["']? does not exist|undefined_table|42P01/i.test(message);
}

function missingWrite(res: Response, error: { message?: string } | null) {
  if (error?.message && isMissingRelation(error.message)) {
    return res.status(503).json({ success: false, message: TABLE_UNAVAILABLE });
  }
  return res.status(500).json({ success: false, message: error?.message ?? "Request failed" });
}

async function requireUser(req: Request, res: Response) {
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
  return { user, client: createAuthenticatedClient(token) } as Auth;
}

async function requireRecruiter(req: Request, res: Response) {
  const auth = await requireUser(req, res);
  if (!auth) return null;
  if (!hasAnyRole(auth.user, ["recruiter", "employer"])) {
    res.status(403).json({ success: false, message: "Recruiter or employer access required" });
    return null;
  }
  return auth;
}

async function getRecruiterProfileId(client: Auth["client"], userId: string): Promise<string | null> {
  const byUser = await client.from("recruiter_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (byUser.data?.id) return byUser.data.id;
  const byId = await client.from("recruiter_profiles").select("id").eq("id", userId).maybeSingle();
  return byId.data?.id ?? null;
}

async function ownsJob(client: Auth["client"], jobId: string, userId: string) {
  const { data } = await client.from("jobs").select("id, owner_id, employer_id, recruiter_id").eq("id", jobId).maybeSingle();
  if (!data) return false;
  if (data.owner_id === userId || data.employer_id === userId) return true;
  const recruiterId = await getRecruiterProfileId(client, userId);
  return Boolean(recruiterId && data.recruiter_id === recruiterId);
}

async function loadOwnedApplication(auth: Auth, applicationId: string) {
  const { data: application } = await auth.client.from("applications").select("id, job_id, candidate_id, status").eq("id", applicationId).maybeSingle();
  if (!application) return null;
  if (!(await ownsJob(auth.client, application.job_id, auth.user.id))) return null;
  return application as ApplicationRow;
}

function splitScheduledAt(value: string) {
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return { date: "", time: "" };
  const iso = stamp.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function combineScheduledAt(date: unknown, time: unknown) {
  const day = String(date ?? "").trim();
  const clock = String(time ?? "10:00").trim() || "10:00";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (!/^\d{2}:\d{2}$/.test(clock)) return null;
  const stamp = new Date(`${day}T${clock}:00`);
  if (Number.isNaN(stamp.getTime())) return null;
  return stamp.toISOString();
}

async function nameMap(client: Auth["client"], candidateIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(candidateIds.filter(Boolean))];
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const { data } = await client.from("candidate_profiles").select("id, full_name").in("id", unique);
  for (const row of (data ?? []) as { id: string; full_name?: string }[]) {
    names.set(row.id, String(row.full_name ?? "").trim());
  }
  return names;
}

async function jobTitleMap(client: Auth["client"], jobIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(jobIds.filter(Boolean))];
  const titles = new Map<string, string>();
  if (!unique.length) return titles;
  const { data } = await client.from("jobs").select("id, title").in("id", unique);
  for (const row of (data ?? []) as { id: string; title?: string }[]) {
    titles.set(row.id, String(row.title ?? "").trim());
  }
  return titles;
}

function presentInterview(row: InterviewRow, names: Map<string, string>, titles: Map<string, string>) {
  const { date, time } = splitScheduledAt(row.scheduled_at);
  return {
    ...row,
    candidateName: names.get(row.candidate_id) || `Candidate ${row.candidate_id.slice(0, 8)}`,
    jobTitle: titles.get(row.job_id) || "Role",
    date,
    time,
  };
}

function presentOffer(row: OfferRow, names: Map<string, string>, titles: Map<string, string>) {
  return {
    ...row,
    joiningDate: row.joining_date,
    candidateName: names.get(row.candidate_id) || `Candidate ${row.candidate_id.slice(0, 8)}`,
    jobTitle: titles.get(row.job_id) || "Role",
  };
}

async function decorateInterviews(client: Auth["client"], rows: InterviewRow[]) {
  const [names, titles] = await Promise.all([
    nameMap(client, rows.map((row) => row.candidate_id)),
    jobTitleMap(client, rows.map((row) => row.job_id)),
  ]);
  return rows.map((row) => presentInterview(row, names, titles));
}

async function decorateOffers(client: Auth["client"], rows: OfferRow[]) {
  const [names, titles] = await Promise.all([
    nameMap(client, rows.map((row) => row.candidate_id)),
    jobTitleMap(client, rows.map((row) => row.job_id)),
  ]);
  return rows.map((row) => presentOffer(row, names, titles));
}

async function setApplicationStatus(client: Auth["client"], applicationId: string, status: string) {
  await client.from("applications").update({ status, updated_at: new Date().toISOString() }).eq("id", applicationId);
}

async function candidateEmailFor(client: Auth["client"], candidateId: string) {
  const profile = await client.from("candidate_profiles").select("contact_email, full_name").eq("id", candidateId).maybeSingle();
  const contact = String((profile.data as { contact_email?: string } | null)?.contact_email ?? "").trim();
  if (contact.includes("@")) return contact;
  const fallback = await client.from("profiles").select("full_name").eq("id", candidateId).maybeSingle();
  void fallback;
  return "";
}

async function notifyInterview(client: Auth["client"], interview: {
  candidate_id: string;
  candidateName?: string;
  jobTitle?: string;
  date?: string;
  time?: string;
  mode?: string;
  notes?: string;
  scheduled_at?: string;
}, reschedule = false) {
  const to = await candidateEmailFor(client, interview.candidate_id);
  await sendInterviewInvitation({
    to,
    candidateName: String(interview.candidateName ?? "").trim() || "there",
    jobTitle: String(interview.jobTitle ?? "").trim() || "the role",
    date: String(interview.date ?? ""),
    time: String(interview.time ?? ""),
    mode: String(interview.mode ?? "video"),
    notes: String(interview.notes ?? ""),
    scheduledAt: interview.scheduled_at,
    reschedule,
  });
}

router.get("/interviews", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const result = await auth.client.from("interviews").select("*").eq("recruiter_id", auth.user.id).order("scheduled_at", { ascending: true });
  if (result.error && isMissingRelation(result.error.message)) return res.json({ success: true, interviews: [] });
  if (result.error) return res.status(500).json({ success: false, message: result.error.message });
  const owned: InterviewRow[] = [];
  for (const row of (result.data ?? []) as InterviewRow[]) {
    if (await ownsJob(auth.client, row.job_id, auth.user.id)) owned.push(row);
  }
  return res.json({ success: true, interviews: await decorateInterviews(auth.client, owned) });
});

router.post("/interviews", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const applicationId = String(req.body?.application_id ?? req.body?.applicantId ?? "").trim();
  const mode = String(req.body?.mode ?? "video").trim().toLowerCase();
  const notes = String(req.body?.notes ?? "").trim();
  const scheduledAt = combineScheduledAt(req.body?.date, req.body?.time) ?? String(req.body?.scheduled_at ?? "").trim();
  if (!applicationId) return res.status(400).json({ success: false, message: "Select an applicant." });
  if (!INTERVIEW_MODES.includes(mode as (typeof INTERVIEW_MODES)[number])) return res.status(400).json({ success: false, message: "Interview mode must be video, phone, or onsite." });
  if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) return res.status(400).json({ success: false, message: "Choose a valid interview date and time." });
  if (new Date(scheduledAt).getTime() < Date.now() - 60_000) return res.status(400).json({ success: false, message: "Interview time must be in the future." });

  const application = await loadOwnedApplication(auth, applicationId);
  if (!application) return res.status(404).json({ success: false, message: "Application not found" });
  if (["rejected", "hired"].includes(application.status)) {
    return res.status(400).json({ success: false, message: "That application is already closed." });
  }

  const payload = {
    application_id: application.id,
    job_id: application.job_id,
    candidate_id: application.candidate_id,
    recruiter_id: auth.user.id,
    scheduled_at: new Date(scheduledAt).toISOString(),
    mode,
    notes,
    status: "scheduled",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await auth.client.from("interviews").insert(payload).select().single();
  if (error) return missingWrite(res, error);
  if (application.status !== "hired") await setApplicationStatus(auth.client, application.id, "interview");
  const [interview] = await decorateInterviews(auth.client, [data as InterviewRow]);
  if (interview) void notifyInterview(auth.client, interview);
  return res.status(201).json({ success: true, interview });
});

router.patch("/interviews/:id", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const { data: current, error: loadError } = await auth.client.from("interviews").select("*").eq("id", req.params.id).maybeSingle();
  if (loadError) return missingWrite(res, loadError);
  if (!current) return res.status(404).json({ success: false, message: "Interview not found" });
  if (!(await ownsJob(auth.client, current.job_id, auth.user.id))) return res.status(404).json({ success: false, message: "Interview not found" });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (req.body?.mode != null) {
    const mode = String(req.body.mode).trim().toLowerCase();
    if (!INTERVIEW_MODES.includes(mode as (typeof INTERVIEW_MODES)[number])) return res.status(400).json({ success: false, message: "Interview mode must be video, phone, or onsite." });
    patch.mode = mode;
  }
  if (req.body?.notes != null) patch.notes = String(req.body.notes);
  if (req.body?.status != null) {
    const status = String(req.body.status).trim().toLowerCase();
    if (!INTERVIEW_STATUSES.includes(status as (typeof INTERVIEW_STATUSES)[number])) return res.status(400).json({ success: false, message: "Invalid interview status." });
    patch.status = status;
  }
  const nextStamp = req.body?.date || req.body?.time ? combineScheduledAt(req.body?.date ?? splitScheduledAt(current.scheduled_at).date, req.body?.time ?? splitScheduledAt(current.scheduled_at).time) : req.body?.scheduled_at;
  if (nextStamp) {
    if (Number.isNaN(new Date(String(nextStamp)).getTime())) return res.status(400).json({ success: false, message: "Choose a valid interview date and time." });
    patch.scheduled_at = new Date(String(nextStamp)).toISOString();
  }

  const { data, error } = await auth.client.from("interviews").update(patch).eq("id", req.params.id).select().single();
  if (error) return missingWrite(res, error);
  const [interview] = await decorateInterviews(auth.client, [data as InterviewRow]);
  const detailsChanged = Boolean(patch.scheduled_at || patch.mode || patch.notes);
  if (interview && detailsChanged && interview.status !== "cancelled") {
    void notifyInterview(auth.client, interview, true);
  }
  return res.json({ success: true, interview });
});

router.delete("/interviews/:id", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const { data: current, error: loadError } = await auth.client.from("interviews").select("id, job_id").eq("id", req.params.id).maybeSingle();
  if (loadError) return missingWrite(res, loadError);
  if (!current || !(await ownsJob(auth.client, current.job_id, auth.user.id))) return res.status(404).json({ success: false, message: "Interview not found" });
  const { error } = await auth.client.from("interviews").delete().eq("id", req.params.id);
  if (error) return missingWrite(res, error);
  return res.json({ success: true });
});

router.get("/offers", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const result = await auth.client.from("offers").select("*").eq("recruiter_id", auth.user.id).order("created_at", { ascending: false });
  if (result.error && isMissingRelation(result.error.message)) return res.json({ success: true, offers: [] });
  if (result.error) return res.status(500).json({ success: false, message: result.error.message });
  const owned: OfferRow[] = [];
  for (const row of (result.data ?? []) as OfferRow[]) {
    if (await ownsJob(auth.client, row.job_id, auth.user.id)) owned.push(row);
  }
  return res.json({ success: true, offers: await decorateOffers(auth.client, owned) });
});

router.post("/offers", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const applicationId = String(req.body?.application_id ?? req.body?.applicantId ?? "").trim();
  const salary = String(req.body?.salary ?? "").trim();
  const joiningDate = String(req.body?.joining_date ?? req.body?.joiningDate ?? "").trim();
  if (!applicationId) return res.status(400).json({ success: false, message: "Select an applicant." });
  if (!salary) return res.status(400).json({ success: false, message: "Enter compensation (CTC / stipend)." });

  const application = await loadOwnedApplication(auth, applicationId);
  if (!application) return res.status(404).json({ success: false, message: "Application not found" });
  if (application.status === "rejected") return res.status(400).json({ success: false, message: "That application is already rejected." });

  const payload = {
    application_id: application.id,
    job_id: application.job_id,
    candidate_id: application.candidate_id,
    recruiter_id: auth.user.id,
    salary,
    joining_date: /^\d{4}-\d{2}-\d{2}$/.test(joiningDate) ? joiningDate : null,
    status: "draft",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await auth.client.from("offers").insert(payload).select().single();
  if (error) return missingWrite(res, error);
  const [offer] = await decorateOffers(auth.client, [data as OfferRow]);
  return res.status(201).json({ success: true, offer });
});

router.patch("/offers/:id", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const { data: current, error: loadError } = await auth.client.from("offers").select("*").eq("id", req.params.id).maybeSingle();
  if (loadError) return missingWrite(res, loadError);
  if (!current) return res.status(404).json({ success: false, message: "Offer not found" });
  if (!(await ownsJob(auth.client, current.job_id, auth.user.id))) return res.status(404).json({ success: false, message: "Offer not found" });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (req.body?.salary != null) {
    const salary = String(req.body.salary).trim();
    if (!salary) return res.status(400).json({ success: false, message: "Enter compensation (CTC / stipend)." });
    patch.salary = salary;
  }
  if (req.body?.joining_date != null || req.body?.joiningDate != null) {
    const joiningDate = String(req.body.joining_date ?? req.body.joiningDate ?? "").trim();
    patch.joining_date = /^\d{4}-\d{2}-\d{2}$/.test(joiningDate) ? joiningDate : null;
  }
  if (req.body?.status != null) {
    const status = String(req.body.status).trim().toLowerCase();
    if (!OFFER_STATUSES.includes(status as (typeof OFFER_STATUSES)[number])) return res.status(400).json({ success: false, message: "Invalid offer status." });
    if (current.status === "accepted" && status !== "accepted") {
      return res.status(400).json({ success: false, message: "An accepted offer cannot be changed." });
    }
    patch.status = status;
  }

  const { data, error } = await auth.client.from("offers").update(patch).eq("id", req.params.id).select().single();
  if (error) return missingWrite(res, error);
  if (data?.status === "accepted") await setApplicationStatus(auth.client, current.application_id, "hired");
  const [offer] = await decorateOffers(auth.client, [data as OfferRow]);
  return res.json({ success: true, offer });
});

router.delete("/offers/:id", async (req: Request, res: Response) => {
  const auth = await requireRecruiter(req, res);
  if (!auth) return;
  const { data: current, error: loadError } = await auth.client.from("offers").select("id, job_id, status").eq("id", req.params.id).maybeSingle();
  if (loadError) return missingWrite(res, loadError);
  if (!current || !(await ownsJob(auth.client, current.job_id, auth.user.id))) return res.status(404).json({ success: false, message: "Offer not found" });
  if (current.status === "accepted") return res.status(400).json({ success: false, message: "An accepted offer cannot be deleted." });
  const { error } = await auth.client.from("offers").delete().eq("id", req.params.id);
  if (error) return missingWrite(res, error);
  return res.json({ success: true });
});

router.get("/mine/interviews", async (req: Request, res: Response) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const result = await auth.client.from("interviews").select("*").eq("candidate_id", auth.user.id).order("scheduled_at", { ascending: true });
  if (result.error && isMissingRelation(result.error.message)) return res.json({ success: true, interviews: [] });
  if (result.error) return res.status(500).json({ success: false, message: result.error.message });
  return res.json({ success: true, interviews: await decorateInterviews(auth.client, (result.data ?? []) as InterviewRow[]) });
});

router.get("/mine/offers", async (req: Request, res: Response) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const result = await auth.client.from("offers").select("*").eq("candidate_id", auth.user.id).neq("status", "draft").order("created_at", { ascending: false });
  if (result.error && isMissingRelation(result.error.message)) return res.json({ success: true, offers: [] });
  if (result.error) return res.status(500).json({ success: false, message: result.error.message });
  return res.json({ success: true, offers: await decorateOffers(auth.client, (result.data ?? []) as OfferRow[]) });
});

router.patch("/mine/offers/:id", async (req: Request, res: Response) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const status = String(req.body?.status ?? "").trim().toLowerCase();
  if (status !== "accepted" && status !== "declined") {
    return res.status(400).json({ success: false, message: "Respond with accepted or declined." });
  }
  const { data: current, error: loadError } = await auth.client.from("offers").select("*").eq("id", req.params.id).eq("candidate_id", auth.user.id).maybeSingle();
  if (loadError) return missingWrite(res, loadError);
  if (!current) return res.status(404).json({ success: false, message: "Offer not found" });
  if (current.status !== "sent") return res.status(400).json({ success: false, message: "Only a sent offer can be accepted or declined." });
  const { data, error } = await auth.client.from("offers").update({ status, updated_at: new Date().toISOString() }).eq("id", req.params.id).eq("candidate_id", auth.user.id).select().single();
  if (error) return missingWrite(res, error);
  if (status === "accepted") await setApplicationStatus(auth.client, current.application_id, "hired");
  const [offer] = await decorateOffers(auth.client, [data as OfferRow]);
  return res.json({ success: true, offer });
});

export = router;
