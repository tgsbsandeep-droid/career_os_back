import express = require("express");
const { supabase, createAuthenticatedClient, getUserFromToken } = require("../lib/supabase");

const router = express.Router();

async function getUser(req: express.Request) {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : undefined;

  if (!token) return null;
  return await getUserFromToken(token);
}

async function requireCandidate(req: express.Request, res: express.Response) {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : undefined;
  if (!token) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  const user = await getUser(req);
  if (!user || req.params.id !== user.id) {
    res.status(401).json({ success: false, message: "Authentication required" });
    return null;
  }
  return { user, client: createAuthenticatedClient(token) };
}

// ── Dashboard (MUST be before /:id routes — "dashboard" would otherwise match :id) ──
router.get("/dashboard", async (req, res) => {
  const authorization = req.header("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!token) return res.status(401).json({ success: false, message: "Authentication required" });

  const currentUser = await getUserFromToken(token);
  if (!currentUser) return res.status(401).json({ success: false, message: "Authentication required" });

  const client = createAuthenticatedClient(token);
  const userId = currentUser.id;

  try {
    const [enrollRes, appRes, jobRes, profileRes] = await Promise.all([
      client.from("enrollments").select("id, progress, courses(title, level)").eq("candidate_id", userId),
      client.from("applications").select("id, status").eq("candidate_id", userId),
      client.from("jobs").select("id").in("status", ["open", "published"]),
      client.from("candidate_profiles").select("full_name, skills, resume_url").eq("id", userId).maybeSingle(),
    ]);

    const enrollments = enrollRes.data ?? [];
    const applications = appRes.data ?? [];
    const jobs = jobRes.data ?? [];
    const profile = profileRes.data;

    let strength = 30;
    if (profile?.full_name) strength += 20;
    if (profile?.skills?.length > 0) strength += 20;
    if (profile?.resume_url) strength += 15;
    if (enrollments.length > 0) strength += 10;
    if (applications.length > 0) strength += 5;

    const learningProgress = enrollments
      .filter((e: any) => (e.progress ?? 0) < 100)
      .slice(0, 3)
      .map((e: any) => ({
        course: e.courses?.title ?? "Course",
        level: e.courses?.level ?? "",
        progress: e.progress ?? 0,
      }));

    return res.json({
      success: true,
      data: {
        profileStrength: Math.min(100, strength),
        courses: {
          total: enrollments.length,
          inProgress: enrollments.filter((e: any) => (e.progress ?? 0) > 0 && (e.progress ?? 0) < 100).length,
        },
        applications: {
          total: applications.length,
          interviews: applications.filter((a: any) => a.status === "interview" || a.status === "shortlisted").length,
        },
        jobMatches: jobs.length,
        learningProgress,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Unable to load candidate dashboard" });
  }
});

router.get("/:id/profile", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;

  // candidate_profiles.id IS the auth user id (PK = FK to auth.users.id)
  const { data, error } = await auth.client
    .from("candidate_profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, profile: data });
});

router.put("/:id/profile", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;

  const { data: existing } = await auth.client
    .from("candidate_profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();

  const body = req.body ?? {};
  const pick = (key: string, fallback: unknown) => (body[key] !== undefined ? body[key] : fallback);
  const avatarUrl = pick("avatar_url", existing?.avatar_url ?? null);

  // candidate_profiles.id IS the auth user id — upsert on id
  const profile: Record<string, unknown> = {
    id: auth.user.id,
    full_name: String(pick("full_name", existing?.full_name) ?? "").trim() || auth.user.user_metadata?.full_name || "",
    contact_email: pick("contact_email", existing?.contact_email ?? ""),
    phone: pick("phone", existing?.phone ?? ""),
    location: pick("location", existing?.location ?? ""),
    education: pick("education", existing?.education ?? ""),
    education_institution: pick("education_institution", existing?.education_institution ?? ""),
    education_field: pick("education_field", existing?.education_field ?? ""),
    graduation_year: pick("graduation_year", existing?.graduation_year ?? ""),
    skills: Array.isArray(body.skills) ? body.skills : (existing?.skills ?? []),
    experience: Array.isArray(body.experience) ? body.experience : (existing?.experience ?? []),
    resume_url: pick("resume_url", existing?.resume_url ?? null),
    linkedin_url: pick("linkedin_url", existing?.linkedin_url ?? null),
    github_url: pick("github_url", existing?.github_url ?? null),
    portfolio_url: pick("portfolio_url", existing?.portfolio_url ?? null),
    website_url: pick("website_url", existing?.website_url ?? null),
    certificates: Array.isArray(body.certificates) ? body.certificates : (existing?.certificates ?? []),
    avatar_url: avatarUrl || null,
    updated_at: new Date().toISOString(),
  };
  let { data, error } = await auth.client
    .from("candidate_profiles")
    .upsert(profile, { onConflict: "id" })
    .select()
    .single();
  if (error && /avatar_url|column|schema cache|could not find/i.test(error.message)) {
    const { avatar_url: _avatar, ...withoutAvatar } = profile;
    void _avatar;
    const fallback = await auth.client
      .from("candidate_profiles")
      .upsert(withoutAvatar, { onConflict: "id" })
      .select()
      .single();
    data = fallback.data;
    error = fallback.error;
  }

  if (error) return res.status(500).json({ success: false, message: error.message });
  if (avatarUrl) {
    await auth.client.from("profiles").update({ avatar_url: avatarUrl }).eq("id", auth.user.id);
  }
  return res.json({ success: true, profile: data });
});

function courseSummaryForEnrollment(course: {
  title?: string;
  level?: string;
  certificate?: boolean;
  provider?: string;
  price?: number | string | null;
  is_free?: boolean;
  delivery_type?: string;
} | null) {
  if (!course) return course;
  const parsed = Number(course.price ?? 0);
  const price = Number.isFinite(parsed) ? parsed : 0;
  const paid = course.is_free === false && price > 0;
  return {
    ...course,
    certificate: course.certificate !== false,
    price: paid ? price : 0,
    is_free: !paid,
    delivery_type: course.delivery_type === "live" ? "live" : "self_paced",
  };
}

function enrollmentFeePaid(status: string | null | undefined) {
  return String(status ?? "paid").toLowerCase() !== "unpaid";
}

function enrollmentAccessFromRow(row: {
  payment_status?: string | null | undefined;
  courses?: { is_free?: boolean; price?: number | string | null } | null | undefined;
}) {
  const course = courseSummaryForEnrollment(row.courses ?? null);
  const feeDue = Boolean(course && course.is_free === false && Number(course.price ?? 0) > 0);
  const paid = enrollmentFeePaid(row.payment_status);
  return {
    payment_status: paid ? "paid" as const : "unpaid" as const,
    access_granted: !feeDue || paid,
    payment_required: feeDue && !paid,
  };
}

router.get("/:id/enrollments", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;

  const withPay = await auth.client
    .from("enrollments")
    .select("id, course_id, progress, completed_lessons, payment_status, paid_at, courses(title, level, certificate, provider, price, is_free, delivery_type)")
    .eq("candidate_id", auth.user.id);
  const missingPay = Boolean(withPay.error?.message && /payment_status|paid_at|schema cache|could not find/i.test(withPay.error.message));
  const withPricing = missingPay
    ? await auth.client
        .from("enrollments")
        .select("id, course_id, progress, completed_lessons, courses(title, level, certificate, provider, price, is_free, delivery_type)")
        .eq("candidate_id", auth.user.id)
    : withPay;
  const missingPricing = Boolean(withPricing.error?.message && /price|is_free|delivery_type|certificate|schema cache|could not find/i.test(withPricing.error.message));
  const { data, error } = missingPricing
    ? await auth.client
        .from("enrollments")
        .select("id, course_id, progress, completed_lessons, courses(title, level, certificate, provider)")
        .eq("candidate_id", auth.user.id)
    : withPricing;

  if (error) return res.status(500).json({ success: false, message: error.message });

  const enrollments = (data ?? []).map((e: {
    progress?: number;
    payment_status?: string | null;
    courses?: Parameters<typeof courseSummaryForEnrollment>[0];
  }) => {
    const access = enrollmentAccessFromRow({
      payment_status: missingPay || missingPricing ? "paid" : e.payment_status,
      courses: e.courses ?? null,
    });
    return {
      ...e,
      progress_pct: e.progress ?? 0,
      courses: courseSummaryForEnrollment(e.courses ?? null),
      ...access,
    };
  });

  return res.json({ success: true, enrollments });
});

router.put("/:id/enrollments/:courseId/progress", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;
  const withPay = await auth.client
    .from("enrollments")
    .select("id, payment_status, courses(price, is_free)")
    .eq("candidate_id", auth.user.id)
    .eq("course_id", req.params.courseId)
    .maybeSingle();
  const missingPay = Boolean(withPay.error?.message && /payment_status|price|is_free|schema cache|could not find/i.test(withPay.error.message));
  const enrollment = missingPay
    ? await auth.client
        .from("enrollments")
        .select("id")
        .eq("candidate_id", auth.user.id)
        .eq("course_id", req.params.courseId)
        .maybeSingle()
    : withPay;
  if (enrollment.error || !enrollment.data) {
    return res.status(404).json({ success: false, message: "Enrollment not found" });
  }
  if (!missingPay) {
    const row = enrollment.data as { payment_status?: string | null; courses?: { price?: number | string | null; is_free?: boolean } | null };
    const access = enrollmentAccessFromRow(row);
    if (!access.access_granted) {
      return res.status(403).json({
        success: false,
        message: "Pay the course fee before tracking progress",
        ...access,
      });
    }
  }
  const completedLessons = Array.isArray(req.body.completed_lessons) ? req.body.completed_lessons : [];
  const progress = Math.max(0, Math.min(100, Number(req.body.progress) || 0));
  const { data, error } = await auth.client.from("enrollments").update({ progress, completed_lessons: completedLessons }).eq("candidate_id", auth.user.id).eq("course_id", req.params.courseId).select("id, course_id, progress, completed_lessons").single();
  if (error) return res.status(404).json({ success: false, message: error.message });
  return res.json({ success: true, enrollment: data });
});

router.get("/:id/applications", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;

  const { data, error } = await auth.client
    .from("applications")
    .select("*, job:jobs(*)")
    .eq("candidate_id", auth.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, applications: data });
});

// ── Saved jobs ──────────────────────────────────────────────────────────────
router.get("/:id/saved-jobs", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;
  const { data, error } = await auth.client
    .from("saved_jobs")
    .select("*, jobs(*)")
    .eq("candidate_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, saved_jobs: data });
});

router.post("/:id/saved-jobs/:jobId", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;
  const { data, error } = await auth.client
    .from("saved_jobs")
    .upsert({ candidate_id: auth.user.id, job_id: req.params.jobId }, { onConflict: "candidate_id,job_id" })
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.status(201).json({ success: true, saved: data });
});

router.delete("/:id/saved-jobs/:jobId", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;
  const { error } = await auth.client
    .from("saved_jobs")
    .delete()
    .eq("candidate_id", auth.user.id)
    .eq("job_id", req.params.jobId);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true });
});

// ── Saved courses ────────────────────────────────────────────────────────────
router.get("/:id/saved-courses", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;
  const { data, error } = await auth.client
    .from("saved_courses")
    .select("*, courses(*)")
    .eq("candidate_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true, saved_courses: data });
});

router.post("/:id/saved-courses/:courseId", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;
  const { data, error } = await auth.client
    .from("saved_courses")
    .upsert({ candidate_id: auth.user.id, course_id: req.params.courseId }, { onConflict: "candidate_id,course_id" })
    .select()
    .single();
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.status(201).json({ success: true, saved: data });
});

router.delete("/:id/saved-courses/:courseId", async (req, res) => {
  const auth = await requireCandidate(req, res);
  if (!auth) return;
  const { error } = await auth.client
    .from("saved_courses")
    .delete()
    .eq("candidate_id", auth.user.id)
    .eq("course_id", req.params.courseId);
  if (error) return res.status(500).json({ success: false, message: error.message });
  return res.json({ success: true });
});

export = router;
