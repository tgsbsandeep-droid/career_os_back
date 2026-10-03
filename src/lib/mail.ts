import fs = require("fs");
import path = require("path");

type SendMailResult = { sent: boolean; reason?: string };

type InterviewEmailInput = {
  to: string;
  candidateName: string;
  jobTitle: string;
  date: string;
  time: string;
  mode: string;
  notes: string;
  scheduledAt?: string;
  reschedule?: boolean;
};

const TEMPLATE_PATH = path.join(__dirname, "..", "..", "emails", "interview-invitation.html");

function env(name: string) {
  return String(process.env[name] ?? "").trim();
}

function escapeHtml(value: string) {
  return Array.from(value).map((ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&#34;";
    if (ch === "\x27") return "&#39;";
    return ch;
  }).join("");
}

function fillTemplate(source: string, vars: Record<string, string>) {
  return source.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => escapeHtml(vars[key] ?? ""));
}

function loadTemplate() {
  try {
    return fs.readFileSync(TEMPLATE_PATH, "utf8");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// EmailJS — sends via EmailJS REST API (no browser SDK needed on server)
// Docs: https://www.emailjs.com/docs/rest-api/send/
// ---------------------------------------------------------------------------
async function sendWithEmailJS(params: {
  toEmail: string;
  toName: string;
  subject: string;
  htmlMessage: string;
  textMessage: string;
}): Promise<SendMailResult> {
  const serviceId  = env("EMAILJS_SERVICE_ID");
  const templateId = env("EMAILJS_TEMPLATE_ID");
  const publicKey  = env("EMAILJS_PUBLIC_KEY");
  const privateKey = env("EMAILJS_PRIVATE_KEY"); // optional — needed for server-side calls

  if (!serviceId || !templateId || !publicKey) {
    return {
      sent: false,
      reason:
        "EmailJS is not configured. Set EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, and EMAILJS_PUBLIC_KEY in backend/.env.",
    };
  }

  const body: Record<string, unknown> = {
    service_id:  serviceId,
    template_id: templateId,
    user_id:     publicKey,
    template_params: {
      to_email:     params.toEmail,
      to_name:      params.toName,
      subject:      params.subject,
      html_message: params.htmlMessage,
      message:      params.textMessage,
    },
  };

  // If a private key is provided, use the server-side endpoint that requires it
  if (privateKey) {
    body["accessToken"] = privateKey;
  }

  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { sent: false, reason: `EmailJS ${response.status}: ${text.slice(0, 200)}` };
  }

  return { sent: true };
}

function formatMode(mode: string) {
  const value = String(mode ?? "").trim().toLowerCase();
  if (value === "phone") return "Phone";
  if (value === "onsite") return "Onsite";
  return "Video";
}

function formatInterviewDate(date: string, scheduledAt?: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const stamp = new Date(`${date}T00:00:00`);
    if (!Number.isNaN(stamp.getTime())) {
      return stamp.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }
  }
  if (scheduledAt) {
    const stamp = new Date(scheduledAt);
    if (!Number.isNaN(stamp.getTime())) {
      return stamp.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    }
  }
  return date || "To be confirmed";
}

function formatInterviewTime(time: string, scheduledAt?: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match) {
    const hh = Number(match[1]);
    const mm = Number(match[2]);
    const stamp = new Date();
    stamp.setHours(hh, mm, 0, 0);
    return stamp.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (scheduledAt) {
    const stamp = new Date(scheduledAt);
    if (!Number.isNaN(stamp.getTime())) {
      return stamp.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
  }
  return time || "To be confirmed";
}

function applicationsUrl() {
  const origin = env("FRONTEND_URL") || "http://localhost:5173";
  return `${origin.replace(/\/$/, "")}/candidate/applications`;
}

async function sendInterviewInvitation(input: InterviewEmailInput): Promise<SendMailResult> {
  const jobTitle      = String(input.jobTitle || "the role").trim() || "the role";
  const candidateName = String(input.candidateName || "there").trim() || "there";
  const date          = formatInterviewDate(input.date, input.scheduledAt);
  const time          = formatInterviewTime(input.time, input.scheduledAt);
  const mode          = formatMode(input.mode);
  const notes         = String(input.notes || "").trim() || "None";
  const headline      = input.reschedule ? "Your interview was updated" : "You're invited to interview";
  const intro         = input.reschedule
    ? `Your interview for ${jobTitle} was updated. The latest details are below.`
    : `A recruiter scheduled an interview for ${jobTitle}. Details are below.`;
  const subject = input.reschedule
    ? `Interview updated: ${jobTitle}`
    : `Interview invitation: ${jobTitle}`;

  const vars = {
    EMAIL_TITLE:      subject,
    PREVIEW:          `${jobTitle} · ${date} · ${time} · ${mode}`,
    HEADLINE:         headline,
    CANDIDATE_NAME:   candidateName,
    INTRO:            intro,
    JOB_TITLE:        jobTitle,
    DATE:             date,
    TIME:             time,
    MODE:             mode,
    NOTES:            notes,
    APPLICATIONS_URL: applicationsUrl(),
  };

  const template = loadTemplate();
  const htmlMessage = template
    ? fillTemplate(template, vars)
    : `<p>Hi ${escapeHtml(candidateName)},</p><p>${escapeHtml(intro)}</p><p>${escapeHtml(jobTitle)} · ${escapeHtml(date)} · ${escapeHtml(time)} · ${escapeHtml(mode)}</p><p>${escapeHtml(notes)}</p>`;

  const textMessage = [
    `Hi ${candidateName},`,
    intro,
    `Role: ${jobTitle}`,
    `Date: ${date}`,
    `Time: ${time}`,
    `Mode: ${mode}`,
    `Notes: ${notes}`,
    `View details: ${applicationsUrl()}`,
  ].join("\n");

  const result = await sendWithEmailJS({
    toEmail:     input.to,
    toName:      candidateName,
    subject,
    htmlMessage,
    textMessage,
  });

  if (!result.sent) {
    console.warn(`[mail] interview invitation not sent to ${input.to}: ${result.reason}`);
  }
  return result;
}

export = {
  sendInterviewInvitation,
  formatMode,
  applicationsUrl,
};
