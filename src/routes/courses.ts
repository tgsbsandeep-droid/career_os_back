import express = require("express");
const { supabase, createAuthenticatedClient, getUserFromToken } = require("../lib/supabase");
const { parsePageParams, pageMeta } = require("../lib/pagination");
import { requireAcademy, requireUser as requireAuthUser, bearerToken } from "../lib/authz";

const router = express.Router();

type EnrollmentRecord = { id: string; candidate_id: string; progress: number };
type CandidateProfileRecord = { id: string; full_name: string; education: string; skills: string[]; experience: string[]; resume_url: string | null };
type CourseModule = { id: string; title: string; description: string; lessons: { id: string; title: string; type: "video" | "file"; url: string; duration?: string }[] };

function createSlug(title: string) {
  const normalized = title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${normalized || "course"}-${Date.now().toString(36)}`;
}

async function getUser(req: express.Request) {
  const token = bearerToken(req);
  if (!token) return null;
  return await getUserFromToken(token);
}

/** requireTutor delegates to the shared requireAcademy guard (verifyRoleFromDb + app_metadata fallback). */
const requireTutor = requireAcademy;

// Resolve tutor_profiles.id from auth user UUID. Live schema uses id = auth.users(id);
// later migrations also add a user_id column.
async function getTutorProfileId(client: ReturnType<typeof createAuthenticatedClient>, userId: string): Promise<string | null> {
  const byUser = await client.from("tutor_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (byUser.data?.id) return byUser.data.id;
  const byId = await client.from("tutor_profiles").select("id").eq("id", userId).maybeSingle();
  return byId.data?.id ?? userId;
}

async function ensureTutorProfile(client: ReturnType<typeof createAuthenticatedClient>, userId: string) {
  const payloads = [
    { id: userId, user_id: userId, updated_at: new Date().toISOString() },
    { id: userId, updated_at: new Date().toISOString() },
    { user_id: userId, updated_at: new Date().toISOString() },
  ];
  let lastError: { message: string } | null = null;
  for (const payload of payloads) {
    const onConflict = "id" in payload ? "id" : "user_id";
    const { data, error } = await client.from("tutor_profiles").upsert(payload, { onConflict }).select("id").single();
    if (!error && data?.id) return data.id as string;
    lastError = error;
    if (error && !/column|schema cache|could not find|on conflict/i.test(error.message)) break;
  }
  if (lastError) throw lastError;
  return userId;
}

function ownsCourseFilter(userId: string, tutorId: string | null, includeTutorId = true) {
  const clauses = [`owner_id.eq.${userId}`];
  if (includeTutorId) {
    if (tutorId) clauses.push(`tutor_id.eq.${tutorId}`);
    if (tutorId !== userId) clauses.push(`tutor_id.eq.${userId}`);
  }
  return clauses.join(",");
}

async function findOwnedCourse(client: ReturnType<typeof createAuthenticatedClient>, courseId: string, userId: string) {
  const tutorId = await getTutorProfileId(client, userId);
  const withTutor = await client
    .from("courses")
    .select("id, owner_id, tutor_id")
    .eq("id", courseId)
    .or(ownsCourseFilter(userId, tutorId, true))
    .maybeSingle();
  if (!withTutor.error) return withTutor.data ?? null;
  if (!/tutor_id|column|schema cache|could not find/i.test(withTutor.error.message)) return null;
  const { data } = await client
    .from("courses")
    .select("id, owner_id")
    .eq("id", courseId)
    .eq("owner_id", userId)
    .maybeSingle();
  return data ?? null;
}

function isMissingColumnError(message: string) {
  return /column|schema cache|could not find/i.test(message);
}

function liveBatchStatus(value: unknown) {
  const status = String(value ?? "published");
  return status === "draft" || status === "closed" ? status : "published";
}

function liveBatchWriteFromBody(
  body: { title?: unknown; start_at?: unknown; end_at?: unknown; schedule?: unknown; capacity?: unknown; meeting_url?: unknown; status?: unknown },
  courseId: string,
) {
  const start_at = String(body.start_at ?? "").trim();
  const meeting_url = String(body.meeting_url ?? "").trim();
  const parsedCapacity = Number(body.capacity);
  return {
    course_id: courseId,
    title: String(body.title ?? "").trim() || "Live training batch",
    start_at,
    end_at: body.end_at ? String(body.end_at) : start_at,
    schedule: String(body.schedule ?? "").trim(),
    capacity: Number.isFinite(parsedCapacity) && parsedCapacity > 0 ? Math.floor(parsedCapacity) : 30,
    meeting_url,
    status: liveBatchStatus(body.status),
  };
}

function liveBatchPatchFromBody(body: {
  title?: unknown; start_at?: unknown; end_at?: unknown; schedule?: unknown;
  capacity?: unknown; meeting_url?: unknown; status?: unknown;
}) {
  const updates: Record<string, unknown> = {};
  if (body.title !== undefined) updates.title = String(body.title ?? "").trim() || "Live training batch";
  if (body.start_at !== undefined) {
    const start_at = String(body.start_at ?? "").trim();
    updates.start_at = start_at;
    if (body.end_at === undefined) updates.end_at = start_at;
  }
  if (body.end_at !== undefined) updates.end_at = body.end_at ? String(body.end_at) : updates.start_at ?? null;
  if (body.schedule !== undefined) updates.schedule = String(body.schedule ?? "").trim();
  if (body.capacity !== undefined) {
    const parsedCapacity = Number(body.capacity);
    if (Number.isFinite(parsedCapacity) && parsedCapacity > 0) updates.capacity = Math.floor(parsedCapacity);
  }
  if (body.meeting_url !== undefined) updates.meeting_url = String(body.meeting_url ?? "").trim();
  if (body.status !== undefined) updates.status = liveBatchStatus(body.status);
  return updates;
}

async function loadCourseLiveBatches(
  client: ReturnType<typeof createAuthenticatedClient>,
  courseId: string,
) {
  const { data } = await client.from("live_batches").select("*").eq("course_id", courseId).order("start_at", { ascending: true });
  return data ?? [];
}

async function publishDraftLiveBatches(
  client: ReturnType<typeof createAuthenticatedClient>,
  courseId: string,
  course: { delivery_type?: string; status?: string },
) {
  if (course.delivery_type === "live" && course.status === "published") {
    await client.from("live_batches").update({ status: "published" }).eq("course_id", courseId).eq("status", "draft");
  }
  return loadCourseLiveBatches(client, courseId);
}

function normalizeCourseRecord<T extends { certificate?: boolean; is_free?: boolean; price?: number | string | null }>(course: T) {
  const parsed = Number(course.price ?? 0);
  const price = Number.isFinite(parsed) ? parsed : 0;
  const isFree = !(price > 0 && course.is_free !== true);
  return {
    ...course,
    certificate: course.certificate !== false,
    price: isFree ? 0 : price,
    is_free: isFree,
  };
}

function coursePricingFromBody(body: { is_free?: unknown; price?: unknown }) {
  const isFree = body.is_free !== false && body.is_free !== "false";
  const parsed = Number(body.price);
  const price = isFree ? 0 : Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  return { is_free: isFree || price <= 0, price };
}

function publicLiveBatches(raw: unknown, unlocked: boolean) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((batch) => {
      const row = (batch ?? {}) as {
        id?: string; title?: string; start_at?: string; end_at?: string | null;
        schedule?: string; capacity?: number; status?: string; meeting_url?: string;
      };
      const status = String(row.status ?? "draft");
      const meetingUrl = String(row.meeting_url ?? "").trim();
      return {
        id: String(row.id ?? ""),
        title: String(row.title ?? "Live training batch"),
        start_at: String(row.start_at ?? ""),
        end_at: row.end_at ?? null,
        schedule: String(row.schedule ?? ""),
        capacity: Number(row.capacity ?? 0) || 0,
        status,
        ...(unlocked && meetingUrl ? { meeting_url: meetingUrl } : {}),
      };
    })
    .filter((batch) => batch.id && (unlocked || batch.status === "published"));
}

function previewModules(raw: unknown): CourseModule[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((mod, index) => {
    const row = (mod ?? {}) as { id?: string; title?: string; description?: string; lessons?: unknown };
    const lessons = Array.isArray(row.lessons) ? row.lessons : [];
    return {
      id: String(row.id ?? `module-${index}`),
      title: String(row.title ?? `Module ${index + 1}`),
      description: String(row.description ?? ""),
      lessons: lessons.map((lesson, lessonIndex) => {
        const item = (lesson ?? {}) as { id?: string; title?: string; type?: string; duration?: string };
        return {
          id: String(item.id ?? `lesson-${index}-${lessonIndex}`),
          title: String(item.title ?? `Lesson ${lessonIndex + 1}`),
          type: item.type === "file" ? "file" as const : "video" as const,
          url: "",
          ...(item.duration ? { duration: String(item.duration) } : {}),
        };
      }),
    };
  });
}

function courseForViewer(course: { certificate?: boolean; modules?: unknown; live_batches?: unknown }, unlocked: boolean) {
  const normalized = normalizeCourseRecord(course);
  const live_batches = publicLiveBatches(course.live_batches, unlocked);
  if (unlocked) return { ...normalized, live_batches };
  return { ...normalized, modules: previewModules(course.modules), live_batches };
}

function courseIsPaid(course: { is_free?: boolean; price?: number | string | null } | null | undefined) {
  if (!course) return false;
  const parsed = Number(course.price ?? 0);
  const price = Number.isFinite(parsed) ? parsed : 0;
  return course.is_free === false && price > 0;
}

function enrollmentFeePaid(row: { payment_status?: string | null } | null | undefined) {
  if (!row) return false;
  return String(row.payment_status ?? "paid").toLowerCase() !== "unpaid";
}

function enrollmentUnlocksContent(
  course: { is_free?: boolean; price?: number | string | null } | null | undefined,
  enrollment: { payment_status?: string | null } | null | undefined,
) {
  if (!enrollment) return false;
  return !courseIsPaid(course) || enrollmentFeePaid(enrollment);
}

type EnrollmentAccessRow = {
  id?: string;
  course_id?: string;
  progress?: number;
  completed_lessons?: unknown;
  payment_status?: string | null;
  paid_at?: string | null;
};

async function loadCandidateEnrollment(
  client: ReturnType<typeof createAuthenticatedClient>,
  userId: string,
  courseId: string,
) {
  const withPay = await client
    .from("enrollments")
    .select("id, course_id, progress, completed_lessons, payment_status, paid_at")
    .eq("candidate_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (!withPay.error) return (withPay.data ?? null) as EnrollmentAccessRow | null;
  if (!/payment_status|paid_at|schema cache|could not find/i.test(withPay.error.message)) return null;
  const { data } = await client
    .from("enrollments")
    .select("id, course_id, progress, completed_lessons")
    .eq("candidate_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();
  return data ? { ...(data as EnrollmentAccessRow), payment_status: "paid", paid_at: null } : null;
}

async function candidateEnrollmentMap(req: express.Request, userId: string) {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const map = new Map<string, EnrollmentAccessRow>();
  if (!token) return map;
  const client = createAuthenticatedClient(token);
  const withPay = await client
    .from("enrollments")
    .select("id, course_id, payment_status, paid_at")
    .eq("candidate_id", userId);
  if (!withPay.error) {
    for (const row of (withPay.data ?? []) as EnrollmentAccessRow[]) {
      if (row.course_id) map.set(String(row.course_id), row);
    }
    return map;
  }
  const { data } = await client.from("enrollments").select("id, course_id").eq("candidate_id", userId);
  for (const row of (data ?? []) as EnrollmentAccessRow[]) {
    if (row.course_id) map.set(String(row.course_id), { ...row, payment_status: "paid" });
  }
  return map;
}

function enrollmentAccessPayload(
  course: { is_free?: boolean; price?: number | string | null } | null | undefined,
  enrollment: EnrollmentAccessRow | null | undefined,
) {
  const enrolled = Boolean(enrollment?.id || enrollment?.course_id);
  const accessGranted = enrollmentUnlocksContent(course, enrollment);
  const paymentRequired = courseIsPaid(course) && enrolled && !accessGranted;
  return {
    enrolled,
    access_granted: accessGranted,
    payment_required: paymentRequired,
    payment_status: enrolled ? (enrollmentFeePaid(enrollment) ? "paid" : "unpaid") : null,
  };
}

function omitCourseField(payload: Record<string, unknown>, key: string) {
  if (!(key in payload)) return null;
  const next = { ...payload };
  delete next[key];
  return next;
}

function payloadWithoutMissingColumn(payload: Record<string, unknown>, message: string) {
  const match = message.match(/column (?:[\w]+\.)?["']?(\w+)["']? does not exist/i)
    || message.match(/could not find the ['"]?(\w+)['"]? column/i);
  const key = match?.[1];
  if (key) {
    const stripped = omitCourseField(payload, key);
    if (stripped) return stripped;
  }
  return omitCourseField(payload, "certificate");
}

async function writeCourse(
  client: ReturnType<typeof createAuthenticatedClient>,
  action: "insert" | "update",
  payload: Record<string, unknown>,
  courseId?: string,
) {
  let current: Record<string, unknown> | null = { ...payload };
  let lastError: { message: string } | null = null;
  for (let attempt = 0; attempt < 8 && current; attempt += 1) {
    const query = action === "insert"
      ? client.from("courses").insert(current).select().single()
      : client.from("courses").update(current).eq("id", courseId).select().single();
    const { data, error } = await query;
    if (!error) return { data, error: null };
    lastError = error;
    if (!isMissingColumnError(error.message)) break;
    current = payloadWithoutMissingColumn(current, error.message);
  }
  return { data: null, error: lastError };
}

router.get("/", async (req, res) => {
  const { limit, offset, from, to } = parsePageParams(req);
  const { data, error, count } = await supabase.from("courses").select("*, live_batches(id, title, start_at, end_at, schedule, capacity, status, meeting_url)", { count: "exact" }).eq("status", "published").order("created_at", { ascending: false }).range(from, to);
  if (error) return res.status(500).json({ success: false, message: error.message });
  const user = await getUser(req);
  const enrollmentMap = user ? await candidateEnrollmentMap(req, user.id) : new Map<string, EnrollmentAccessRow>();
  return res.json({
    success: true,
    courses: (data ?? []).map((course: { id: string; certificate?: boolean; is_free?: boolean; price?: number | string | null; modules?: unknown; live_batches?: unknown }) =>
      courseForViewer(course, enrollmentUnlocksContent(course, enrollmentMap.get(String(course.id))))
    ),
    page: pageMeta(count ?? 0, limit, offset),
  });
});

router.get("/mine", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;

  const tutorId = await getTutorProfileId(auth.client, auth.user.id);
  const withTutor = await auth.client
    .from("courses")
    .select("*, live_batches(*)")
    .or(ownsCourseFilter(auth.user.id, tutorId, true))
    .order("created_at", { ascending: false });
  const missingTutorId = Boolean(withTutor.error?.message && /tutor_id|column|schema cache|could not find/i.test(withTutor.error.message));
  const { data, error } = missingTutorId
    ? await auth.client
        .from("courses")
        .select("*, live_batches(*)")
        .eq("owner_id", auth.user.id)
        .order("created_at", { ascending: false })
    : withTutor;
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, courses: (data ?? []).map((course: { certificate?: boolean }) => normalizeCourseRecord(course)) });
});

router.post("/", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;

  let tutorId: string;
  try {
    tutorId = await ensureTutorProfile(auth.client, auth.user.id);
  } catch (tpErr) {
    return res.status(500).json({ success: false, message: (tpErr as { message?: string }).message ?? "Unable to create tutor profile" });
  }

  const course = {
    owner_id: auth.user.id,
    tutor_id: tutorId,
    slug: req.body.slug?.trim() || createSlug(req.body.title ?? ""),
    title: req.body.title ?? "",
    description: req.body.description ?? "",
    syllabus: req.body.syllabus ?? "",
    skills: Array.isArray(req.body.skills) ? req.body.skills : [],
    thumbnail_url: req.body.thumbnail_url ?? null,
    modules: Array.isArray(req.body.modules) ? req.body.modules : [],
    delivery_type: req.body.delivery_type === "live" ? "live" : "self_paced",
    provider: req.body.provider ?? "",
    level: req.body.level ?? "Beginner",
    duration: req.body.duration ?? "",
    status: req.body.status === "published" ? "published" : "draft",
    certificate: req.body.certificate !== false,
    ...coursePricingFromBody(req.body),
  };
  if (!course.title.trim() || !course.description.trim()) {
    return res.status(400).json({ success: false, message: "Title and description are required" });
  }

  const { data, error } = await writeCourse(auth.client, "insert", course);
  if (error) return res.status(500).json({ success: false, message: error.message });
  const saved = data as { id: string; certificate?: boolean };
  const live_batches = await publishDraftLiveBatches(auth.client, saved.id, course);
  return res.status(201).json({ success: true, course: normalizeCourseRecord({ ...saved, live_batches }) });
});

router.get("/:id", async (req, res) => {
  let { data, error } = await supabase.from("courses").select("*, live_batches(*)").eq("id", req.params.id).maybeSingle();
  if (error && /live_batches|relationship|embed/i.test(error.message)) {
    const fallback = await supabase.from("courses").select("*").eq("id", req.params.id).maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }
  if (error || !data) return res.status(404).json({ success: false, message: "Course not found" });
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const user = token ? await getUserFromToken(token) : null;
  const client = token ? createAuthenticatedClient(token) : null;
  const status = String((data as { status?: string }).status ?? "").toLowerCase();
  const owned = user && client ? await findOwnedCourse(client, String(req.params.id), user.id) : null;
  if (status !== "published" && !owned) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }
  const enrollment = user && client ? await loadCandidateEnrollment(client, user.id, String(req.params.id)) : null;
  const access = enrollmentAccessPayload(data as { is_free?: boolean; price?: number | string | null }, enrollment);
  const unlocked = Boolean(owned) || access.access_granted;
  return res.json({
    success: true,
    ...access,
    enrolled: Boolean(owned) || access.enrolled,
    access_granted: unlocked,
    course: courseForViewer(data as { certificate?: boolean; modules?: unknown }, unlocked),
  });
});

router.put("/:id", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await findOwnedCourse(auth.client, req.params.id, auth.user.id))) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }

  const updates = {
    owner_id: auth.user.id,
    ...(req.body.slug?.trim() ? { slug: req.body.slug.trim() } : {}),
    title: req.body.title ?? "",
    description: req.body.description ?? "",
    syllabus: req.body.syllabus ?? "",
    skills: Array.isArray(req.body.skills) ? req.body.skills : [],
    thumbnail_url: req.body.thumbnail_url ?? null,
    modules: Array.isArray(req.body.modules) ? req.body.modules : [],
    delivery_type: req.body.delivery_type === "live" ? "live" : "self_paced",
    provider: req.body.provider ?? "",
    level: req.body.level ?? "Beginner",
    duration: req.body.duration ?? "",
    status: req.body.status === "published" ? "published" : "draft",
    certificate: req.body.certificate !== false,
    ...coursePricingFromBody(req.body),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await writeCourse(auth.client, "update", updates, req.params.id);
  if (error) return res.status(404).json({ success: false, message: error.message });
  const saved = data as { id?: string; certificate?: boolean };
  const live_batches = await publishDraftLiveBatches(auth.client, req.params.id, updates);
  return res.json({ success: true, course: normalizeCourseRecord({ ...saved, live_batches }) });
});

router.delete("/:id", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await findOwnedCourse(auth.client, req.params.id, auth.user.id))) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }
  const { error } = await auth.client.from("courses").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true });
});

router.get("/:id/students", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await findOwnedCourse(auth.client, req.params.id, auth.user.id))) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }

  const { data, error } = await auth.client
    .from("enrollments")
    .select("id, candidate_id, progress")
    .eq("course_id", req.params.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  const enrollmentRecords = (data ?? []) as EnrollmentRecord[];
  const candidateIds = enrollmentRecords.map((enrollment) => enrollment.candidate_id);
  const { data: profiles, error: profileError } = candidateIds.length
    ? await auth.client.from("candidate_profiles").select("id, full_name, education, skills, experience, resume_url").in("id", candidateIds)
    : { data: [], error: null };
  if (profileError) return res.status(500).json({ success: false, message: profileError.message });
  const profileRecords = (profiles ?? []) as CandidateProfileRecord[];
  const profileMap = new Map(profileRecords.map((profile) => [profile.id, profile]));
  return res.json({ success: true, students: enrollmentRecords.map((enrollment) => ({ ...enrollment, profile: profileMap.get(enrollment.candidate_id) ?? null })) });
});

router.post("/:id/live-batches", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await findOwnedCourse(auth.client, req.params.id, auth.user.id))) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }
  const batch = liveBatchWriteFromBody(req.body, req.params.id);
  if (!batch.start_at || !batch.meeting_url) return res.status(400).json({ success: false, message: "Start date, time, and meeting link are required" });
  const { data, error } = await auth.client.from("live_batches").insert(batch).select().single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.status(201).json({ success: true, batch: data });
});

router.put("/:id/live-batches/:batchId", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await findOwnedCourse(auth.client, req.params.id, auth.user.id))) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }
  const updates = liveBatchPatchFromBody(req.body);
  if (updates.start_at !== undefined && !String(updates.start_at).trim()) {
    return res.status(400).json({ success: false, message: "Start date and time are required" });
  }
  if (updates.meeting_url !== undefined && !String(updates.meeting_url).trim()) {
    return res.status(400).json({ success: false, message: "Meeting link is required" });
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ success: false, message: "No live batch fields to update" });
  }
  const { data, error } = await auth.client
    .from("live_batches")
    .update(updates)
    .eq("id", req.params.batchId)
    .eq("course_id", req.params.id)
    .select()
    .maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!data) return res.status(404).json({ success: false, message: "Live batch not found" });
  return res.json({ success: true, batch: data });
});

router.delete("/:id/live-batches/:batchId", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await findOwnedCourse(auth.client, req.params.id, auth.user.id))) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }
  const { data, error } = await auth.client
    .from("live_batches")
    .delete()
    .eq("id", req.params.batchId)
    .eq("course_id", req.params.id)
    .select("id")
    .maybeSingle();
  if (error) return res.status(500).json({ success: false, message: error.message });
  if (!data) return res.status(404).json({ success: false, message: "Live batch not found" });
  return res.json({ success: true });
});

router.post("/:id/live-batches/:batchId/enroll", async (req, res) => {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, message: "Authentication required" });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ success: false, message: "Authentication required" });
  const client = createAuthenticatedClient(token);
  const { data: course } = await supabase.from("courses").select("id, status, price, is_free").eq("id", req.params.id).maybeSingle();
  if (!course || String(course.status ?? "").toLowerCase() !== "published") {
    return res.status(404).json({ success: false, message: "Course not found" });
  }
  const enrollment = await loadCandidateEnrollment(client, user.id, req.params.id);
  if (!enrollmentUnlocksContent(course, enrollment)) {
    return res.status(403).json({
      success: false,
      message: enrollment ? "Pay the course fee before joining this live class" : "Enroll and pay the course fee before joining this live class",
      ...enrollmentAccessPayload(course, enrollment),
    });
  }
  const { data: batch } = await client.from("live_batches").select("id, course_id, capacity, meeting_url").eq("id", req.params.batchId).eq("course_id", req.params.id).eq("status", "published").maybeSingle();
  if (!batch) return res.status(404).json({ success: false, message: "Live batch not found" });
  const { count, error: countError } = await client.from("live_enrollments").select("id", { count: "exact", head: true }).eq("batch_id", batch.id);
  if (countError) return res.status(500).json({ success: false, message: countError.message });
  if ((count ?? 0) >= batch.capacity) return res.status(409).json({ success: false, message: "This live batch is full" });
  const { data, error } = await client.from("live_enrollments").upsert({ batch_id: batch.id, candidate_id: user.id }, { onConflict: "batch_id,candidate_id" }).select().single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.status(201).json({ success: true, enrollment: data, batch: { id: batch.id, meeting_url: batch.meeting_url } });
});

router.post("/:id/attendance", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await findOwnedCourse(auth.client, req.params.id, auth.user.id))) {
    return res.status(404).json({ success: false, message: "Course not found" });
  }

  const records = Array.isArray(req.body.attendance) ? req.body.attendance : [];
  if (!req.body.session_date || records.length === 0) {
    return res.status(400).json({ success: false, message: "Session date and attendance are required" });
  }
  const attendance = records.map((record: { candidate_id: string; present: boolean }) => ({
    course_id: req.params.id,
    candidate_id: record.candidate_id,
    session_date: req.body.session_date,
    present: Boolean(record.present),
  }));
  const { data, error } = await auth.client
    .from("attendance")
    .upsert(attendance, { onConflict: "course_id,candidate_id,session_date" })
    .select();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, attendance: data });
});

router.post("/:id/enroll", async (req, res) => {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, message: "Authentication required" });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ success: false, message: "Authentication required" });

  const client = createAuthenticatedClient(token);
  const { data: course } = await supabase.from("courses").select("id, status, price, is_free").eq("id", req.params.id).maybeSingle();
  if (!course || String(course.status ?? "").toLowerCase() !== "published") {
    return res.status(404).json({ success: false, message: "Course not found" });
  }
  const existing = await loadCandidateEnrollment(client, user.id, req.params.id);
  if (existing) {
    const access = enrollmentAccessPayload(course, existing);
    return res.json({ success: true, enrollment: existing, ...access });
  }
  const paidCourse = courseIsPaid(course);
  const payload: Record<string, unknown> = {
    candidate_id: user.id,
    course_id: req.params.id,
    payment_status: paidCourse ? "unpaid" : "paid",
    paid_at: paidCourse ? null : new Date().toISOString(),
  };
  let insert = await client.from("enrollments").insert(payload).select().single();
  if (insert.error && /payment_status|paid_at|schema cache|could not find/i.test(insert.error.message)) {
    insert = await client.from("enrollments").insert({ candidate_id: user.id, course_id: req.params.id }).select().single();
  }
  if (insert.error) return res.status(500).json({ success: false, message: insert.error.message });
  const enrollment = insert.data as EnrollmentAccessRow;
  const access = enrollmentAccessPayload(course, {
    ...enrollment,
    payment_status: paidCourse ? enrollment.payment_status ?? "unpaid" : enrollment.payment_status ?? "paid",
  });
  return res.status(201).json({ success: true, enrollment, ...access });
});

router.post("/:id/pay", async (req, res) => {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, message: "Authentication required" });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ success: false, message: "Authentication required" });
  const client = createAuthenticatedClient(token);
  const { data: course } = await supabase.from("courses").select("id, status, price, is_free").eq("id", req.params.id).maybeSingle();
  if (!course || String(course.status ?? "").toLowerCase() !== "published") {
    return res.status(404).json({ success: false, message: "Course not found" });
  }
  const existing = await loadCandidateEnrollment(client, user.id, req.params.id);
  if (!existing) {
    return res.status(400).json({ success: false, message: "Enroll in this course before paying the fee" });
  }
  if (!courseIsPaid(course) || enrollmentFeePaid(existing)) {
    return res.json({ success: true, enrollment: existing, ...enrollmentAccessPayload(course, { ...existing, payment_status: "paid" }) });
  }
  const paidAt = new Date().toISOString();
  const updated = await client
    .from("enrollments")
    .update({ payment_status: "paid", paid_at: paidAt })
    .eq("candidate_id", user.id)
    .eq("course_id", req.params.id)
    .select("id, course_id, progress, completed_lessons, payment_status, paid_at")
    .maybeSingle();
  if (updated.error) {
    if (/payment_status|paid_at|schema cache|could not find/i.test(updated.error.message)) {
      return res.status(503).json({ success: false, message: "Apply the enrollment payment migration before collecting course fees" });
    }
    return res.status(500).json({ success: false, message: updated.error.message });
  }
  if (!updated.data) return res.status(404).json({ success: false, message: "Enrollment not found" });
  const enrollment = updated.data as EnrollmentAccessRow;
  return res.json({ success: true, enrollment, ...enrollmentAccessPayload(course, enrollment) });
});

export = router;