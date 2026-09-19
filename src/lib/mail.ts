import fs = require("fs");
import path = require("path");

type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

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

function mailFrom() {
  return env("MAIL_FROM") || env("SMTP_FROM") || "CareerOS <noreply@careeros.app>";
}

function escapeHtml(value: string) {
  return Array.from(value).map((ch) => {
    if (ch === "&") return "&";
    if (ch === "<") return "<";
    if (ch === ">") return ">";
    if (ch === '"') return "&#34;";
    if (ch === "'") return "'";
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

async function sendWithResend(input: SendMailInput, apiKey: string): Promise<SendMailResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { sent: false, reason: `Resend ${response.status}: ${body.slice(0, 180)}` };
  }
  return { sent: true };
}

async function sendWithSmtp(input: SendMailInput): Promise<SendMailResult> {
  let nodemailer: { createTransport: (options: Record<string, unknown>) => { sendMail: (mail: Record<string, unknown>) => Promise<unknown> } };
  try {
    nodemailer = require("nodemailer");
  } catch {
    return { sent: false, reason: "SMTP is set but nodemailer is not installed. Run npm install nodemailer in backend." };
  }
  const port = Number(env("SMTP_PORT") || "587");
  const secure = env("SMTP_SECURE") === "true" || port === 465;
  const transporter = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port,
    secure,
    auth: env("SMTP_USER")
      ? { user: env("SMTP_USER"), pass: env("SMTP_PASS") }
      : undefined,
  });
  await transporter.sendMail({
    from: mailFrom(),
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  return { sent: true };
}

async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const to = String(input.to ?? "").trim();
  if (!to || !to.includes("@")) return { sent: false, reason: "No candidate email on file." };
  const resendKey = env("RESEND_API_KEY");
  try {
    if (resendKey) return await sendWithResend(input, resendKey);
    if (env("SMTP_HOST")) return await sendWithSmtp(input);
    return { sent: false, reason: "Email is not configured. Set RESEND_API_KEY or SMTP_HOST in backend/.env." };
  } catch (err) {
    return { sent: false, reason: (err as Error).message || "Email send failed." };
  }
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
  const jobTitle = String(input.jobTitle || "the role").trim() || "the role";
  const candidateName = String(input.candidateName || "there").trim() || "there";
  const date = formatInterviewDate(input.date, input.scheduledAt);
  const time = formatInterviewTime(input.time, input.scheduledAt);
  const mode = formatMode(input.mode);
  const notes = String(input.notes || "").trim() || "None";
  const headline = input.reschedule ? "Your interview was updated" : "You're invited to interview";
  const intro = input.reschedule
    ? `Your interview for ${jobTitle} was updated. The latest details are below.`
    : `A recruiter scheduled an interview for ${jobTitle}. Details are below.`;
  const subject = input.reschedule
    ? `Interview updated: ${jobTitle}`
    : `Interview invitation: ${jobTitle}`;
  const vars = {
    EMAIL_TITLE: subject,
    PREVIEW: `${jobTitle} · ${date} · ${time} · ${mode}`,
    HEADLINE: headline,
    CANDIDATE_NAME: candidateName,
    INTRO: intro,
    JOB_TITLE: jobTitle,
    DATE: date,
    TIME: time,
    MODE: mode,
    NOTES: notes,
    APPLICATIONS_URL: applicationsUrl(),
  };
  const template = loadTemplate();
  const html = template
    ? fillTemplate(template, vars)
    : `<p>Hi ${escapeHtml(candidateName)},</p><p>${escapeHtml(intro)}</p><p>${escapeHtml(jobTitle)} · ${escapeHtml(date)} · ${escapeHtml(time)} · ${escapeHtml(mode)}</p><p>${escapeHtml(notes)}</p>`;
  const text = [
    `Hi ${candidateName},`,
    intro,
    `Role: ${jobTitle}`,
    `Date: ${date}`,
    `Time: ${time}`,
    `Mode: ${mode}`,
    `Notes: ${notes}`,
    `View details: ${applicationsUrl()}`,
  ].join("\n");
  const result = await sendMail({ to: input.to, subject, html, text });
  if (!result.sent) {
    console.warn(`[mail] interview invitation not sent to ${input.to}: ${result.reason}`);
  }
  return result;
}

export = {
  sendMail,
  sendInterviewInvitation,
  formatMode,
  applicationsUrl,
};
