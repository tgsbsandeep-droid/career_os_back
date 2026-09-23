declare const require: (moduleName: string) => any;

const { GoogleGenAI } = require("@google/genai");

const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY ?? "").trim();
const GEMINI_MODEL = String(process.env.GEMINI_MODEL ?? "").trim() || "gemini-3.6-flash";

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is missing. Add it to backend/.env");
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

async function generateCareerAdvice(
  profile: {
    name: string;
    skills: string[];
    experience: string[];
    targetRole?: string;
  }
) {
  const prompt = `
You are an AI career advisor.

Candidate:
Name: ${profile.name}

Skills:
${profile.skills.join(", ")}

Experience:
${profile.experience.join("\n")}

Target role:
${profile.targetRole || "Not specified"}

Provide:

1. Current career assessment
2. Top skill gaps
3. Recommended skills
4. Recommended learning path
5. Job-search strategy

Keep the answer practical and concise.
`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });

  return response.text;
}

async function optimizeResume(data: {
  resumeText: string;
  targetRole: string;
  skills: string[];
}) {
  const prompt = `You are an expert resume coach and ATS optimization specialist.

Candidate's current resume / profile summary:
${data.resumeText}

Target role: ${data.targetRole}
Current skills: ${data.skills.join(", ")}

Provide a structured resume optimization report with these sections:
1. **ATS Score** (0-100) with brief explanation
2. **Key Strengths** (3-4 bullet points)
3. **Critical Gaps** (what's missing for the target role)
4. **Rewritten Summary** (a polished 3-sentence professional summary)
5. **Recommended Keywords** (10-15 ATS keywords to add)
6. **Action Items** (5 specific improvements, prioritized)

Be specific, actionable, and concise.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return response.text;
}

async function generateInterviewQuestion(data: {
  role: string;
  skills: string[];
  difficulty: "easy" | "medium" | "hard";
  questionType: "behavioral" | "technical" | "situational";
  previousQuestions?: string[];
}) {
  const avoidList = data.previousQuestions?.length
    ? `\nDo NOT repeat these questions:\n${data.previousQuestions.join("\n")}`
    : "";

  const prompt = `You are an expert technical interviewer.

Role: ${data.role}
Skills: ${data.skills.join(", ")}
Difficulty: ${data.difficulty}
Question type: ${data.questionType}
${avoidList}

Generate ONE interview question. Then provide:
1. **Question**: The interview question
2. **What they're testing**: 1-2 sentences on what the interviewer wants to see
3. **Strong answer framework**: A brief STAR/structured framework hint (2-3 sentences)
4. **Red flags to avoid**: 2-3 common mistakes

Format clearly with bold headers.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return response.text;
}

async function evaluateInterviewAnswer(data: {
  question: string;
  answer: string;
  role: string;
}) {
  const prompt = `You are an expert interviewer evaluating a candidate's answer.

Role: ${data.role}
Question: ${data.question}
Candidate's answer: ${data.answer}

Provide structured feedback:
1. **Score** (1-10) with one-line justification
2. **What worked well** (2-3 specific points)
3. **What to improve** (2-3 specific points)
4. **Stronger version** (rewrite the answer in 3-4 sentences using STAR method)

Be honest, constructive, and specific.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return response.text;
}

async function generateTeachingContent(data: {
  topic: string;
  contentType: "outline" | "lesson" | "quiz" | "description";
}) {
  const topic = String(data.topic || "").trim();
  if (!topic) {
    throw new Error("Topic is required");
  }

  const type = data.contentType || "outline";
  const instructions: Record<typeof type, string> = {
    outline:
      "Create a structured course outline with 6–8 modules. For each module include: title, 3–5 lesson titles, estimated duration, and 2–3 learning outcomes.",
    lesson:
      "Write a complete lesson script: learning objectives, 800–1200 word explanation with examples, a short practice activity, and a recap of key takeaways.",
    quiz:
      "Write 8 multiple-choice questions. For each: the question, four options (A–D), the correct answer, and a one-sentence explanation.",
    description:
      "Write marketplace-ready course copy: a punchy title, 2-sentence summary, 5 'what you will learn' bullets, target audience, and prerequisites.",
  };

  const prompt = `You are an expert instructional designer for a career-learning platform.

Topic: ${topic}
Content type: ${type}

${instructions[type]}

Keep the tone professional, practical, and job-oriented. Format with clear markdown headings.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return response.text;
}

async function generateJobDescription(data: {
  title: string;
  company_name?: string;
  location?: string;
  employment_type?: string;
  experience_level?: string;
  skills?: string[];
  salary_range?: string;
}) {
  const title = String(data.title || "").trim();
  if (!title) {
    throw new Error("Job title is required");
  }

  const prompt = `You are an expert technical recruiter writing job descriptions for a hiring platform.

Title: ${title}
Company: ${data.company_name || "the company"}
Location: ${data.location || "Remote"}
Employment type: ${data.employment_type || "Full-time"}
Experience level: ${data.experience_level || "mid"}
Required skills: ${(data.skills || []).join(", ") || "Not specified"}
Salary range: ${data.salary_range || "Not specified"}

Write a complete job description with:
1. A 2–3 sentence overview
2. Key responsibilities (6–8 bullets)
3. Required qualifications
4. Preferred qualifications
5. A short benefits / working-style note (do not invent a salary number unless one is provided)

Tone: professional, inclusive, specific. Return markdown only — no preamble.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return response.text;
}

function parseSkillList(text: string, max = 16) {
  const cleaned = String(text ?? "").replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const payload = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  const raw = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { skills?: unknown }).skills)
      ? (parsed as { skills: unknown[] }).skills
      : [];
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const item of raw) {
    const skill = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!skill || skill.length > 48) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
  }
  return skills.slice(0, max);
}

type CandidateSkillResumeFile = {
  mimeType: string;
  data: string;
};

async function suggestCandidateSkills(data: {
  education?: string;
  education_field?: string;
  education_institution?: string;
  experience?: Array<{ role?: string; organization?: string; description?: string }>;
  certificates?: Array<{ name?: string; issuer?: string }>;
  existing_skills?: string[];
  resume_excerpt?: string;
  resumeFile?: CandidateSkillResumeFile | null;
}) {
  const experienceLines = (data.experience ?? [])
    .map((entry) => {
      const role = String(entry.role ?? "").trim();
      const organization = String(entry.organization ?? "").trim();
      const description = String(entry.description ?? "").trim();
      if (!role && !organization && !description) return "";
      return [role, organization].filter(Boolean).join(" at ") + (description ? `: ${description}` : "");
    })
    .filter(Boolean)
    .slice(0, 8);
  const certificates = (data.certificates ?? [])
    .map((cert) => [cert.name, cert.issuer].filter(Boolean).join(" — "))
    .filter(Boolean)
    .slice(0, 12);
  const existing = (data.existing_skills ?? []).map((skill) => String(skill ?? "").trim()).filter(Boolean).slice(0, 30);
  const hasContext =
    Boolean(String(data.education_field ?? "").trim()) ||
    Boolean(String(data.education ?? "").trim()) ||
    experienceLines.length > 0 ||
    certificates.length > 0 ||
    Boolean(String(data.resume_excerpt ?? "").trim()) ||
    Boolean(data.resumeFile);

  if (!hasContext) return [];

  const prompt = `You suggest skills a candidate should add to their CareerOS profile.

Education level: ${String(data.education || "").trim() || "Not provided"}
Field of study: ${String(data.education_field || "").trim() || "Not provided"}
Institution: ${String(data.education_institution || "").trim() || "Not provided"}
Work experience:
${experienceLines.join("\n") || "Not provided"}
Certificates:
${certificates.join("\n") || "Not provided"}
Skills already selected: ${existing.join(", ") || "None"}
Resume text excerpt: ${String(data.resume_excerpt || "").slice(0, 4000) || (data.resumeFile ? "Attached as a file. Extract skills from it." : "Not provided")}

Return ONLY valid JSON (no markdown fences):
{"skills":["Skill one","Skill two"]}

Rules:
- 10 to 16 concise skill names this specific person likely has, based on THEIR field, roles, certificates, and resume
- Mix domain tools and transferable skills that fit THIS background
- Do not default to a software-engineering list unless the profile is clearly in software/IT
- Do not invent unrelated industries
- No sentences, no seniority words, no duplicates
- Prefer skills not already selected`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (data.resumeFile?.data && data.resumeFile.mimeType) {
    parts.push({
      inlineData: {
        mimeType: data.resumeFile.mimeType,
        data: data.resumeFile.data,
      },
    });
  }

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts }],
  });
  return parseSkillList(response.text, 16);
}

async function suggestJobSkills(data: {
  title: string;
  description?: string;
  experience_level?: string;
  employment_type?: string;
}) {
  const title = String(data.title || "").trim();
  if (!title) {
    throw new Error("Job title is required");
  }

  const prompt = `You are a recruiting specialist suggesting required skills for a job posting.

Job title: ${title}
Experience level: ${data.experience_level || "unspecified"}
Employment type: ${data.employment_type || "unspecified"}
Description excerpt: ${String(data.description || "").slice(0, 600) || "Not provided"}

Return ONLY valid JSON (no markdown fences):
{"skills":["Skill one","Skill two"]}

Rules:
- 8 to 12 concise skill names for THIS role (tools, methods, and domain skills)
- Do not use a generic software-engineering list unless the title is actually an engineering role
- No sentences, no seniority words, no duplicates`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return parseSkillList(response.text);
}

async function matchCandidateToJob(data: {
  job: { title: string; description?: string; skills?: string[]; experience_level?: string };
  candidates: Array<{
    id: string;
    full_name?: string;
    skills?: string[];
    education?: string;
    bio?: string;
    experience?: string[];
  }>;
}) {
  if (!data.job?.title) {
    throw new Error("Job title is required");
  }
  const candidates = (data.candidates || []).slice(0, 20);
  if (!candidates.length) {
    throw new Error("At least one candidate is required");
  }

  const prompt = `You are an AI recruiting assistant. Score each candidate against the job.

Job:
Title: ${data.job.title}
Experience level: ${data.job.experience_level || "unspecified"}
Skills: ${(data.job.skills || []).join(", ") || "Not specified"}
Description: ${data.job.description || ""}

Candidates (JSON):
${JSON.stringify(candidates)}

Return ONLY valid JSON (no markdown fences) as:
{"matches":[{"id":"...","score":0,"summary":"one sentence","strengths":["..."],"gaps":["..."]}]}
score is 0-100. Sort matches by score descending.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return response.text;
}

async function chatWithAssistant(data: {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  profile?: {
    name?: string;
    skills?: string[];
    experience?: string[];
    targetRole?: string;
  };
}) {
  const message = String(data.message || "").trim();
  if (!message) throw new Error("Message is required");

  const history = (data.history || []).slice(-12);
  const transcript = history
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "Candidate"}: ${turn.content}`)
    .join("\n");
  const profile = data.profile || {};

  const prompt = `You are CareerOS, a practical AI career assistant for job seekers in India and globally.

Candidate context:
Name: ${profile.name || "Not provided"}
Skills: ${(profile.skills || []).join(", ") || "Not provided"}
Experience: ${(profile.experience || []).join(" | ") || "Not provided"}
Target role: ${profile.targetRole || "Not specified"}

Recent conversation:
${transcript || "(new conversation)"}

Candidate: ${message}

Reply as a concise career coach. Prefer concrete next steps, skill gaps, resume/interview tips, and when useful suggest browsing jobs or courses. Use markdown. Do not invent employers, salaries, or certificates the candidate did not mention.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
  });
  return response.text;
}

module.exports = {
  generateCareerAdvice,
  optimizeResume,
  generateInterviewQuestion,
  evaluateInterviewAnswer,
  generateTeachingContent,
  generateJobDescription,
  suggestJobSkills,
  suggestCandidateSkills,
  matchCandidateToJob,
  chatWithAssistant,
};
