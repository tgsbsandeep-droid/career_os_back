import express = require("express");
import type { Request, Response } from "express";
const { generateCareerAdvice, optimizeResume, generateInterviewQuestion, evaluateInterviewAnswer, generateTeachingContent, generateJobDescription, suggestJobSkills, suggestCandidateSkills, matchCandidateToJob, chatWithAssistant } = require("../services/ai.service");
const { createAuthenticatedClient, getUserFromToken } = require("../lib/supabase");

const router = express.Router();

router.post("/career-advice", async (req: Request, res: Response) => {
  try {
    const result = await generateCareerAdvice(req.body);
    res.json({ success: true, result });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/resume-optimize", async (req: Request, res: Response) => {
  try {
    const result = await optimizeResume(req.body);
    res.json({ success: true, result });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/interview-question", async (req: Request, res: Response) => {
  try {
    const result = await generateInterviewQuestion(req.body);
    res.json({ success: true, result });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/interview-evaluate", async (req: Request, res: Response) => {
  try {
    const result = await evaluateInterviewAnswer(req.body);
    res.json({ success: true, result });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/generate-content", async (req: Request, res: Response) => {
  try {
    const topic = String(req.body?.topic || "").trim();
    const contentType = req.body?.contentType;
    if (!topic) {
      res.status(400).json({ success: false, message: "Topic is required" });
      return;
    }
    const allowed = ["outline", "lesson", "quiz", "description"];
    if (contentType && !allowed.includes(contentType)) {
      res.status(400).json({ success: false, message: "Invalid content type" });
      return;
    }
    const result = await generateTeachingContent({ topic, contentType: contentType || "outline" });
    res.json({ success: true, result });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/job-description", async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) {
      res.status(400).json({ success: false, message: "Job title is required" });
      return;
    }
    const result = await generateJobDescription(req.body);
    res.json({ success: true, result });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/job-skills", async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.title || "").trim();
    if (!title) {
      res.status(400).json({ success: false, message: "Job title is required" });
      return;
    }
    const skills = await suggestJobSkills({
      title,
      description: req.body?.description,
      experience_level: req.body?.experience_level,
      employment_type: req.body?.employment_type,
    });
    res.json({ success: true, skills });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

const RESUME_MIME: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
};

function parseExperiencePayload(raw: unknown): Array<{ role?: string; organization?: string; description?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 8).map((item) => {
    if (item && typeof item === "object") {
      const entry = item as { role?: unknown; organization?: unknown; description?: unknown };
      return {
        role: String(entry.role ?? "").trim(),
        organization: String(entry.organization ?? "").trim(),
        description: String(entry.description ?? "").trim(),
      };
    }
    const text = String(item ?? "").trim();
    try {
      const parsed = JSON.parse(text) as { role?: string; organization?: string; description?: string };
      return {
        role: String(parsed.role ?? "").trim(),
        organization: String(parsed.organization ?? "").trim(),
        description: String(parsed.description ?? "").trim(),
      };
    } catch {
      return { role: text };
    }
  });
}

function parseCertificatePayload(raw: unknown): Array<{ name?: string; issuer?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((item) => {
    if (item && typeof item === "object") {
      const cert = item as { name?: unknown; issuer?: unknown };
      return { name: String(cert.name ?? "").trim(), issuer: String(cert.issuer ?? "").trim() };
    }
    const text = String(item ?? "").trim();
    try {
      const parsed = JSON.parse(text) as { name?: string; issuer?: string };
      return { name: String(parsed.name ?? "").trim(), issuer: String(parsed.issuer ?? "").trim() };
    } catch {
      return { name: text };
    }
  });
}

function resumePathFromUrl(resumeUrl: string, userId: string) {
  try {
    const parsed = new URL(resumeUrl);
    const marker = "/object/public/resumes/";
    const idx = parsed.pathname.indexOf(marker);
    if (idx >= 0) return decodeURIComponent(parsed.pathname.slice(idx + marker.length));
  } catch {
    /* fall through */
  }
  const match = resumeUrl.match(/\/resumes\/(.+)$/);
  const captured = match?.[1];
  if (captured) {
    const pathPart = captured.split("?")[0] ?? captured;
    try {
      return decodeURIComponent(pathPart);
    } catch {
      return pathPart;
    }
  }
  if (resumeUrl.startsWith(`${userId}/`)) return resumeUrl;
  return "";
}

async function loadResumeForSkills(resumeUrl: string, userId: string, token: string) {
  const path = resumePathFromUrl(resumeUrl, userId);
  if (!path || !path.startsWith(`${userId}/`)) return { excerpt: "", file: null as { mimeType: string; data: string } | null };
  const client = createAuthenticatedClient(token);
  const { data, error } = await client.storage.from("resumes").download(path);
  if (error || !data) return { excerpt: "", file: null as { mimeType: string; data: string } | null };
  const buffer = Buffer.from(await data.arrayBuffer());
  if (!buffer.length || buffer.length > 4_000_000) return { excerpt: "", file: null as { mimeType: string; data: string } | null };
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "txt") return { excerpt: buffer.toString("utf8").slice(0, 4000), file: null };
  const mimeType = RESUME_MIME[ext];
  if (!mimeType) return { excerpt: "", file: null };
  return { excerpt: "", file: { mimeType, data: buffer.toString("base64") } };
}

router.post("/candidate-skills", async (req: Request, res: Response) => {
  try {
    const authorization = req.header("Authorization");
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    if (!token) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }
    const user = await getUserFromToken(token);
    if (!user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const body = req.body ?? {};
    const education = String(body.education || "").trim();
    const education_field = String(body.education_field || "").trim();
    const education_institution = String(body.education_institution || "").trim();
    const experience = parseExperiencePayload(body.experience);
    const certificates = parseCertificatePayload(body.certificates);
    const existing_skills = Array.isArray(body.existing_skills)
      ? body.existing_skills.map((skill: unknown) => String(skill ?? "").trim()).filter(Boolean).slice(0, 40)
      : [];
    const resumeUrl = String(body.resume_url || "").trim();
    let resume_excerpt = String(body.resume_excerpt || "").trim().slice(0, 4000);
    let resumeFile: { mimeType: string; data: string } | null = null;
    if (resumeUrl) {
      const loaded = await loadResumeForSkills(resumeUrl, user.id, token);
      resume_excerpt = resume_excerpt || loaded.excerpt;
      resumeFile = loaded.file;
    }

    const hasContext =
      Boolean(education || education_field || resume_excerpt || resumeFile) ||
      experience.some((entry) => entry.role || entry.organization || entry.description) ||
      certificates.some((cert) => cert.name || cert.issuer);
    if (!hasContext) {
      res.json({ success: true, skills: [] });
      return;
    }

    const skills = await suggestCandidateSkills({
      education,
      education_field,
      education_institution,
      experience,
      certificates,
      existing_skills,
      resume_excerpt,
      resumeFile,
    });
    res.json({ success: true, skills });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/assistant", async (req: Request, res: Response) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ success: false, message: "Message is required" });
      return;
    }
    const result = await chatWithAssistant(req.body);
    res.json({ success: true, result });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

router.post("/match-candidates", async (req: Request, res: Response) => {
  try {
    const title = String(req.body?.job?.title || "").trim();
    const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
    if (!title) {
      res.status(400).json({ success: false, message: "Job title is required" });
      return;
    }
    if (!candidates.length) {
      res.status(400).json({ success: false, message: "At least one candidate is required" });
      return;
    }
    const result = await matchCandidateToJob({ job: req.body.job, candidates });
    res.json({ success: true, result });
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : String(error ?? "AI service failed");
    res.status(500).json({ success: false, message: msg });
  }
});

export = router;
