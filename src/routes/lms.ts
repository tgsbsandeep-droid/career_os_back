import express = require("express");
const { createAuthenticatedClient, getUserFromToken } = require("../lib/supabase");
import { requireAcademy, requireUser, bearerToken } from "../lib/authz";

const router = express.Router();

type Question = { id: string; text: string; options: string[]; correct: number };
type QuizRow = { id: string; course_id: string; title: string; questions: Question[]; created_at?: string; updated_at?: string };

async function getUser(req: express.Request) {
  const token = bearerToken(req);
  if (!token) return null;
  return await getUserFromToken(token);
}

/** requireTutor delegates to the shared requireAcademy guard (verifyRoleFromDb + app_metadata fallback). */
const requireTutor = requireAcademy;

async function getTutorProfileId(client: ReturnType<typeof createAuthenticatedClient>, userId: string) {
  const byUser = await client.from("tutor_profiles").select("id").eq("user_id", userId).maybeSingle();
  if (byUser.data?.id) return byUser.data.id;
  const byId = await client.from("tutor_profiles").select("id").eq("id", userId).maybeSingle();
  return byId.data?.id ?? userId;
}

function isMissingCourseColumn(message?: string) {
  return Boolean(message && /column|schema cache|could not find/i.test(message));
}

function isMissingRelation(message?: string) {
  if (!message) return false;
  return /could not find the (?:table|relation)\b|relation ["']?[\w.]+["']? does not exist|undefined_table|42P01/i.test(message);
}

const CERT_TABLE_UNAVAILABLE = "Certificate wallet is not available yet. Apply the LMS migration (issued_certificates) in the Supabase SQL Editor, then retry.";
const LMS_TABLE_UNAVAILABLE = "Quizzes and assignments are not available yet. Apply the LMS migration (20260907) in the Supabase SQL Editor, then retry.";

function missingOrEmpty<T>(result: { data: T | null; error: { message: string } | null }, empty: T): { data: T; error: { message: string } | null } {
  if (result.error && isMissingRelation(result.error.message)) return { data: empty, error: null };
  return { data: (result.data ?? empty) as T, error: result.error };
}

async function loadOwnedCourseRow(
  client: ReturnType<typeof createAuthenticatedClient>,
  courseId: string,
) {
  const selects = [
    "id, title, provider, certificate, tutor_id, owner_id",
    "id, title, provider, tutor_id, owner_id",
    "id, title, provider, owner_id",
    "id, title, provider",
  ];
  let lastError: { message: string } | null = null;
  for (const columns of selects) {
    const result = await client.from("courses").select(columns).eq("id", courseId).maybeSingle();
    if (!result.error) return result.data as { id: string; title?: string; provider?: string; certificate?: boolean; tutor_id?: string | null; owner_id?: string | null } | null;
    lastError = result.error;
    if (!isMissingCourseColumn(result.error.message)) return null;
  }
  if (lastError) return null;
  return null;
}

async function requireOwnedCourse(
  auth: NonNullable<Awaited<ReturnType<typeof requireTutor>>>,
  courseId: string,
  res: express.Response,
) {
  const tutorId = await getTutorProfileId(auth.client, auth.user.id);
  const course = await loadOwnedCourseRow(auth.client, courseId);
  if (!course) {
    res.status(404).json({ success: false, message: "Course not found" });
    return null;
  }
  const owns = course.owner_id === auth.user.id || course.tutor_id === tutorId || course.tutor_id === auth.user.id;
  if (!owns) {
    res.status(403).json({ success: false, message: "You can only manage your own courses" });
    return null;
  }
  return course;
}

function enrollmentFeePaid(row: { payment_status?: string | null } | null | undefined) {
  if (!row) return false;
  return String(row.payment_status ?? "paid").toLowerCase() !== "unpaid";
}

async function requireEnrollment(
  client: ReturnType<typeof createAuthenticatedClient>,
  userId: string,
  courseId: string,
  res: express.Response,
) {
  const withPay = await client
    .from("enrollments")
    .select("id, progress, completed_lessons, payment_status, paid_at")
    .eq("candidate_id", userId)
    .eq("course_id", courseId)
    .maybeSingle();
  const missingPay = Boolean(withPay.error?.message && /payment_status|paid_at|schema cache|could not find/i.test(withPay.error.message));
  const { data } = missingPay
    ? await client
        .from("enrollments")
        .select("id, progress, completed_lessons")
        .eq("candidate_id", userId)
        .eq("course_id", courseId)
        .maybeSingle()
    : withPay;
  if (!data) {
    res.status(403).json({ success: false, message: "Enroll in this course to access assessments" });
    return null;
  }
  const enrollment = data as { id: string; progress?: number; completed_lessons?: unknown; payment_status?: string | null };
  if (!missingPay && !enrollmentFeePaid(enrollment)) {
    res.status(403).json({
      success: false,
      message: "Pay the course fee to access assessments",
      enrolled: true,
      access_granted: false,
      payment_required: true,
      payment_status: "unpaid",
    });
    return null;
  }
  return enrollment;
}

function sanitizeQuestions(questions: unknown): Question[] {
  if (!Array.isArray(questions)) return [];
  return questions
    .map((item) => {
      const q = item as Partial<Question>;
      const options = Array.isArray(q.options) ? q.options.map((opt) => String(opt ?? "")).slice(0, 8) : [];
      return {
        id: String(q.id ?? crypto.randomUUID()),
        text: String(q.text ?? "").trim(),
        options,
        correct: Math.max(0, Math.min(options.length ? options.length - 1 : 0, Number(q.correct) || 0)),
      };
    })
    .filter((q) => q.text && q.options.length >= 2);
}

function publicQuestions(questions: Question[]) {
  return questions.map(({ correct: _correct, ...rest }) => rest);
}

function scoreAttempt(questions: Question[], answers: Record<string, number>) {
  let score = 0;
  for (const question of questions) {
    if (Number(answers[question.id]) === question.correct) score += 1;
  }
  return { score, max_score: questions.length };
}

router.get("/mine", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  const tutorId = await getTutorProfileId(auth.client, auth.user.id);
  const withTutor = await auth.client
    .from("courses")
    .select("id")
    .or([tutorId ? `tutor_id.eq.${tutorId}` : "", `owner_id.eq.${auth.user.id}`].filter(Boolean).join(","));
  const missingTutorId = Boolean(withTutor.error?.message && /tutor_id|column|schema cache|could not find/i.test(withTutor.error.message));
  const { data: courses, error: courseError } = missingTutorId
    ? await auth.client.from("courses").select("id").eq("owner_id", auth.user.id)
    : withTutor;
  if (courseError) return res.status(500).json({ success: false, message: courseError.message });
  const courseIds = (courses ?? []).map((c: { id: string }) => c.id);
  if (courseIds.length === 0) {
    return res.json({ success: true, quizzes: [], assignments: [], certificates: [] });
  }
  const [quizRaw, assignmentRaw, certRaw] = await Promise.all([
    auth.client.from("quizzes").select("*").in("course_id", courseIds).order("created_at", { ascending: false }),
    auth.client.from("assignments").select("*").in("course_id", courseIds).order("created_at", { ascending: false }),
    auth.client.from("issued_certificates").select("*").in("course_id", courseIds).order("issued_at", { ascending: false }),
  ]);
  const quizRes = missingOrEmpty(quizRaw, [] as unknown[]);
  const assignmentRes = missingOrEmpty(assignmentRaw, [] as unknown[]);
  const certRes = missingOrEmpty(certRaw, [] as unknown[]);
  if (quizRes.error) return res.status(500).json({ success: false, message: quizRes.error.message });
  if (assignmentRes.error) return res.status(500).json({ success: false, message: assignmentRes.error.message });
  if (certRes.error) return res.status(500).json({ success: false, message: certRes.error.message });
  return res.json({
    success: true,
    quizzes: quizRes.data,
    assignments: assignmentRes.data,
    certificates: certRes.data,
  });
});

router.get("/courses/:courseId/learner", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const enrollment = await requireEnrollment(auth.client, auth.user.id, req.params.courseId, res);
  if (!enrollment) return;

  const [quizRaw, assignmentRaw, certRaw] = await Promise.all([
    auth.client.from("quizzes").select("*").eq("course_id", req.params.courseId).order("created_at", { ascending: true }),
    auth.client.from("assignments").select("*").eq("course_id", req.params.courseId).order("created_at", { ascending: true }),
    auth.client.from("issued_certificates").select("id, course_id, issued_at").eq("course_id", req.params.courseId).eq("candidate_id", auth.user.id).maybeSingle(),
  ]);
  const quizRes = missingOrEmpty(quizRaw, [] as QuizRow[]);
  const assignmentRes = missingOrEmpty(assignmentRaw, [] as { id: string }[]);
  if (quizRes.error) return res.status(500).json({ success: false, message: quizRes.error.message });
  if (assignmentRes.error) return res.status(500).json({ success: false, message: assignmentRes.error.message });
  if (certRaw.error && !isMissingRelation(certRaw.error.message)) {
    return res.status(500).json({ success: false, message: certRaw.error.message });
  }

  const quizzes = (quizRes.data ?? []) as QuizRow[];
  const quizIds = quizzes.map((q) => q.id);
  const assignmentIds = (assignmentRes.data ?? []).map((a: { id: string }) => a.id);

  const [attemptRaw, submissionRaw] = await Promise.all([
    quizIds.length
      ? auth.client.from("quiz_attempts").select("*").eq("candidate_id", auth.user.id).in("quiz_id", quizIds)
      : Promise.resolve({ data: [], error: null }),
    assignmentIds.length
      ? auth.client.from("assignment_submissions").select("*").eq("candidate_id", auth.user.id).in("assignment_id", assignmentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const attemptRes = missingOrEmpty(attemptRaw, [] as { quiz_id: string }[]);
  const submissionRes = missingOrEmpty(submissionRaw, [] as unknown[]);
  if (attemptRes.error) return res.status(500).json({ success: false, message: attemptRes.error.message });
  if (submissionRes.error) return res.status(500).json({ success: false, message: submissionRes.error.message });

  const attemptMap = new Map((attemptRes.data ?? []).map((a: { quiz_id: string }) => [a.quiz_id, a]));
  return res.json({
    success: true,
    quizzes: quizzes.map((quiz) => ({
      ...quiz,
      questions: publicQuestions(Array.isArray(quiz.questions) ? quiz.questions : []),
      attempt: attemptMap.get(quiz.id) ?? null,
    })),
    assignments: assignmentRes.data ?? [],
    submissions: submissionRes.data ?? [],
    certificate: isMissingRelation(certRaw.error?.message) ? null : certRaw.data ?? null,
    progress: enrollment.progress ?? 0,
  });
});

router.post("/courses/:courseId/quizzes", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await requireOwnedCourse(auth, req.params.courseId, res))) return;
  const title = String(req.body.title ?? "").trim();
  const questions = sanitizeQuestions(req.body.questions);
  if (!title || questions.length === 0) {
    return res.status(400).json({ success: false, message: "Quiz title and at least one question are required" });
  }
  const { data, error } = await auth.client
    .from("quizzes")
    .insert({ course_id: req.params.courseId, title, questions, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) {
    if (isMissingRelation(error.message)) return res.status(503).json({ success: false, message: LMS_TABLE_UNAVAILABLE });
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.status(201).json({ success: true, quiz: data });
});

router.put("/quizzes/:id", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  const { data: existing, error: existingError } = await auth.client.from("quizzes").select("*").eq("id", req.params.id).maybeSingle();
  if (existingError && isMissingRelation(existingError.message)) return res.status(503).json({ success: false, message: LMS_TABLE_UNAVAILABLE });
  if (existingError || !existing) return res.status(404).json({ success: false, message: "Quiz not found" });
  if (!(await requireOwnedCourse(auth, existing.course_id, res))) return;
  const title = String(req.body.title ?? existing.title).trim();
  const questions = req.body.questions !== undefined ? sanitizeQuestions(req.body.questions) : existing.questions;
  if (!title || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ success: false, message: "Quiz title and at least one question are required" });
  }
  const { data, error } = await auth.client
    .from("quizzes")
    .update({ title, questions, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, quiz: data });
});

router.delete("/quizzes/:id", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  const { data: existing } = await auth.client.from("quizzes").select("id, course_id").eq("id", req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ success: false, message: "Quiz not found" });
  if (!(await requireOwnedCourse(auth, existing.course_id, res))) return;
  const { error } = await auth.client.from("quizzes").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true });
});

router.post("/quizzes/:id/attempts", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { data: quiz } = await auth.client.from("quizzes").select("*").eq("id", req.params.id).maybeSingle();
  if (!quiz) return res.status(404).json({ success: false, message: "Quiz not found" });
  if (!(await requireEnrollment(auth.client, auth.user.id, quiz.course_id, res))) return;
  const questions = Array.isArray(quiz.questions) ? (quiz.questions as Question[]) : [];
  const answers = req.body.answers && typeof req.body.answers === "object" ? req.body.answers as Record<string, number> : {};
  const scored = scoreAttempt(questions, answers);
  const { data, error } = await auth.client
    .from("quiz_attempts")
    .upsert(
      { quiz_id: quiz.id, candidate_id: auth.user.id, answers, score: scored.score, max_score: scored.max_score },
      { onConflict: "quiz_id,candidate_id" },
    )
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.status(201).json({ success: true, attempt: data });
});

router.post("/courses/:courseId/assignments", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await requireOwnedCourse(auth, req.params.courseId, res))) return;
  const title = String(req.body.title ?? "").trim();
  if (!title) return res.status(400).json({ success: false, message: "Assignment title is required" });
  const payload = {
    course_id: req.params.courseId,
    title,
    description: String(req.body.description ?? ""),
    due_date: req.body.due_date || req.body.dueDate || null,
    max_score: Math.max(1, Number(req.body.max_score ?? req.body.maxScore) || 100),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await auth.client.from("assignments").insert(payload).select().single();
  if (error) {
    if (isMissingRelation(error.message)) return res.status(503).json({ success: false, message: LMS_TABLE_UNAVAILABLE });
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.status(201).json({ success: true, assignment: data });
});

router.put("/assignments/:id", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  const { data: existing, error: existingError } = await auth.client.from("assignments").select("*").eq("id", req.params.id).maybeSingle();
  if (existingError && isMissingRelation(existingError.message)) return res.status(503).json({ success: false, message: LMS_TABLE_UNAVAILABLE });
  if (!existing) return res.status(404).json({ success: false, message: "Assignment not found" });
  if (!(await requireOwnedCourse(auth, existing.course_id, res))) return;
  const { data, error } = await auth.client
    .from("assignments")
    .update({
      title: String(req.body.title ?? existing.title).trim() || existing.title,
      description: req.body.description !== undefined ? String(req.body.description) : existing.description,
      due_date: req.body.due_date !== undefined || req.body.dueDate !== undefined ? (req.body.due_date || req.body.dueDate || null) : existing.due_date,
      max_score: req.body.max_score !== undefined || req.body.maxScore !== undefined ? Math.max(1, Number(req.body.max_score ?? req.body.maxScore) || existing.max_score) : existing.max_score,
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, assignment: data });
});

router.delete("/assignments/:id", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  const { data: existing } = await auth.client.from("assignments").select("id, course_id").eq("id", req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ success: false, message: "Assignment not found" });
  if (!(await requireOwnedCourse(auth, existing.course_id, res))) return;
  const { error } = await auth.client.from("assignments").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true });
});

router.get("/assignments/:id/submissions", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  const { data: assignment } = await auth.client.from("assignments").select("id, course_id").eq("id", req.params.id).maybeSingle();
  if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
  if (!(await requireOwnedCourse(auth, assignment.course_id, res))) return;
  const { data, error } = await auth.client
    .from("assignment_submissions")
    .select("*")
    .eq("assignment_id", req.params.id)
    .order("submitted_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, submissions: data ?? [] });
});

router.post("/assignments/:id/submissions", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { data: assignment } = await auth.client.from("assignments").select("*").eq("id", req.params.id).maybeSingle();
  if (!assignment) return res.status(404).json({ success: false, message: "Assignment not found" });
  if (!(await requireEnrollment(auth.client, auth.user.id, assignment.course_id, res))) return;
  const content = String(req.body.content ?? "").trim();
  const fileUrl = req.body.file_url ? String(req.body.file_url) : null;
  if (!content && !fileUrl) {
    return res.status(400).json({ success: false, message: "Add a written response or file URL" });
  }
  const { data, error } = await auth.client
    .from("assignment_submissions")
    .upsert(
      {
        assignment_id: assignment.id,
        candidate_id: auth.user.id,
        content,
        file_url: fileUrl,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id,candidate_id" },
    )
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.status(201).json({ success: true, submission: data });
});

router.post("/courses/:courseId/certificates", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  const course = await requireOwnedCourse(auth, req.params.courseId, res);
  if (!course) return;
  const candidateId = String(req.body.candidate_id ?? "").trim();
  if (!candidateId) return res.status(400).json({ success: false, message: "candidate_id is required" });
  const { data: enrollment } = await auth.client
    .from("enrollments")
    .select("id, progress")
    .eq("course_id", req.params.courseId)
    .eq("candidate_id", candidateId)
    .maybeSingle();
  if (!enrollment) return res.status(404).json({ success: false, message: "Student is not enrolled in this course" });
  const { data, error } = await auth.client
    .from("issued_certificates")
    .upsert({ course_id: req.params.courseId, candidate_id: candidateId }, { onConflict: "course_id,candidate_id" })
    .select()
    .single();
  if (error) {
    if (isMissingRelation(error.message)) return res.status(503).json({ success: false, message: CERT_TABLE_UNAVAILABLE });
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.status(201).json({ success: true, certificate: data });
});

router.delete("/courses/:courseId/certificates/:candidateId", async (req, res) => {
  const auth = await requireTutor(req, res);
  if (!auth) return;
  if (!(await requireOwnedCourse(auth, req.params.courseId, res))) return;
  const { error } = await auth.client
    .from("issued_certificates")
    .delete()
    .eq("course_id", req.params.courseId)
    .eq("candidate_id", req.params.candidateId);
  if (error) {
    if (isMissingRelation(error.message)) return res.status(503).json({ success: false, message: CERT_TABLE_UNAVAILABLE });
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.json({ success: true });
});

router.post("/courses/:courseId/certificates/claim", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const enrollment = await requireEnrollment(auth.client, auth.user.id, req.params.courseId, res);
  if (!enrollment) return;
  if ((enrollment.progress ?? 0) < 100) {
    return res.status(400).json({ success: false, message: "Complete the course before claiming a certificate" });
  }
  const withCertificate = await auth.client.from("courses").select("id, certificate").eq("id", req.params.courseId).maybeSingle();
  const missingCertificate = Boolean(withCertificate.error?.message && /certificate|schema cache|could not find/i.test(withCertificate.error.message));
  const { data: course } = missingCertificate
    ? await auth.client.from("courses").select("id").eq("id", req.params.courseId).maybeSingle()
    : withCertificate;
  if (!course || course.certificate === false) {
    return res.status(400).json({ success: false, message: "This course does not award a certificate" });
  }
  const { data, error } = await auth.client
    .from("issued_certificates")
    .upsert({ course_id: req.params.courseId, candidate_id: auth.user.id }, { onConflict: "course_id,candidate_id" })
    .select()
    .single();
  if (error) {
    if (isMissingRelation(error.message)) return res.status(503).json({ success: false, message: CERT_TABLE_UNAVAILABLE });
    return res.status(500).json({ success: false, message: error.message });
  }
  return res.status(201).json({ success: true, certificate: data });
});

router.get("/my-certificates", async (req, res) => {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const withCertificate = await auth.client
    .from("issued_certificates")
    .select("id, course_id, issued_at, courses(title, provider, level, certificate)")
    .eq("candidate_id", auth.user.id)
    .order("issued_at", { ascending: false });
  if (isMissingRelation(withCertificate.error?.message)) {
    return res.json({ success: true, certificates: [] });
  }
  const missingCertificate = Boolean(withCertificate.error?.message && /certificate|schema cache|could not find/i.test(withCertificate.error.message));
  const { data, error } = missingCertificate
    ? await auth.client
        .from("issued_certificates")
        .select("id, course_id, issued_at, courses(title, provider, level)")
        .eq("candidate_id", auth.user.id)
        .order("issued_at", { ascending: false })
    : withCertificate;
  if (error) {
    if (isMissingRelation(error.message)) return res.json({ success: true, certificates: [] });
    return res.status(500).json({ success: false, message: error.message });
  }
  const certificates = (data ?? []).map((row: { courses?: { certificate?: boolean } | null }) => ({
    ...row,
    courses: row.courses ? { ...row.courses, certificate: row.courses.certificate !== false } : row.courses,
  }));
  return res.json({ success: true, certificates });
});

export = router;
