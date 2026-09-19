import path = require("path");
import express = require("express");
import cors = require("cors");
import dotenv = require("dotenv");
const { rateLimit } = require("./middleware/rateLimit");
const { requestLog } = require("./middleware/requestLog");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "GEMINI_API_KEY",
] as const;

const missingEnv = requiredEnv.filter((key) => !String(process.env[key] ?? "").trim());
if (missingEnv.length) {
  throw new Error(`Missing required env: ${missingEnv.join(", ")}. Set them in backend/.env locally, or in the host dashboard (Render Environment) for production.`);
}

function corsOrigins() {
  const raw = [process.env.FRONTEND_URL, process.env.FRONTEND_URLS]
    .filter(Boolean)
    .join(",");
  const listed = raw
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (!listed.length) {
    // Default: allow local dev + the live Cloudflare Pages deployment
    return ["http://localhost:5173", "https://career-os.pages.dev"];
  }
  return listed;
}

// These modules read environment variables during initialization, so load them
// only after dotenv has populated process.env.
const candidateRouter: express.Router = require("./routes/candidate");
const aiRouter: express.Router = require("./routes/ai");
const jobsRouter: express.Router = require("./routes/jobs");
const coursesRouter: express.Router = require("./routes/courses");
const academiesRouter: express.Router = require("./routes/academies");
const tutorsRouter: express.Router = require("./routes/tutors");
const recruitersRouter: express.Router = require("./routes/recruiters");
const applicationsRouter: express.Router = require("./routes/applications");
const adminRouter: express.Router = require("./routes/admin");
const notificationsRouter: express.Router = require("./routes/notifications");
const lmsRouter: express.Router = require("./routes/lms");
const hiringRouter: express.Router = require("./routes/hiring");

const app = express();

const allowedOrigins = corsOrigins();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalized = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(normalized)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(requestLog);
app.use(rateLimit({ windowMs: 60_000, max: 120, prefix: "api" }));

app.use("/api/ai", rateLimit({ windowMs: 60_000, max: 20, prefix: "ai" }));
app.use("/api/admin", rateLimit({ windowMs: 60_000, max: 60, prefix: "admin" }));

app.use("/api/candidate", candidateRouter);
app.use("/api/candidates", candidateRouter);
app.use("/api/ai", aiRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/courses", coursesRouter);
app.use("/api/academies", academiesRouter);
app.use("/api/tutors", tutorsRouter);
app.use("/api/recruiters", recruitersRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/lms", lmsRouter);
app.use("/api/hiring", hiringRouter);

app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    message: "Career platform API is running",
  });
});



const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});







