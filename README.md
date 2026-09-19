# CareerOS Backend

Express 5 + TypeScript API for CareerOS. Includes Supabase schema/migrations and Gemini AI.

This folder is a **standalone GitHub repo**. Put every third-party key in **one** gitignored file: [`backend/.env`](.env). Never commit or push it. Use [`.env.example`](.env.example) as the template.

## Stack

- Express 5 (CommonJS)
- TypeScript
- Supabase Auth JWT + RLS
- Google Gemini (`@google/genai`)

## Also in this repo

Moved here from the old workspace so this folder is self-contained:

- [`supabase/`](supabase/) — live schema + SQL migrations (from root `supabase/`)
- [`docs/schema/`](docs/schema/) — API/schema notes (from `document/files/`)
- [`docs/PROJECT_SCAN_REPORT.md`](docs/PROJECT_SCAN_REPORT.md)
- [`docs/_beta_plan_extract.txt`](docs/_beta_plan_extract.txt)

Large `.zip` / `.docx` archives stay out of git (not needed to run the API).

## Setup

```bash
npm install
copy .env.example .env
```

Fill [`.env`](.env) (gitignored — never push this file). Required keys:

```
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
```

Optional third-party keys live in the same file (Resend/SMTP email, Google/LinkedIn OAuth, Supabase service role). See [`.env.example`](.env.example) for the full list. The API loads **only** `backend/.env`.

## Database

Paste file **contents** (not the filename) into the Supabase SQL Editor:

1. [`supabase/schema.sql`](supabase/schema.sql)
2. [`supabase/migrations/20260907_lms_quizzes_assignments.sql`](supabase/migrations/20260907_lms_quizzes_assignments.sql)
3. [`supabase/migrations/20260911_interviews_offers.sql`](supabase/migrations/20260911_interviews_offers.sql)

Also apply the `20260904_*.sql` migrations if those tables/columns are missing.

## Auth redirect URLs

In Supabase: **Authentication → URL Configuration**.

Site URL (local): `http://localhost:5173`

Redirect URLs:

```
http://localhost:5173/auth/callback
http://localhost:5173/auth/reset-password
https://<your-app-domain>/auth/callback
https://<your-app-domain>/auth/reset-password
```

## Run

```bash
npm run dev
```

API: `http://localhost:5000`  
Health: `GET /api/health`

## Deploy on Render

Render clones this repo into `/opt/render/project/src`. Do **not** start `node src/index.ts`.

In the Render service settings:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start` |

If Start Command is left as `node index.js`, the root [`index.js`](index.js) shim still loads `dist/index.js`.

Add these **environment variables** in Render (not in git):

- `NODE_ENV=production`
- `FRONTEND_URL` — live frontend URL, e.g. `https://your-app.onrender.com`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-3.6-flash`
- Optional: `RESEND_API_KEY`, `MAIL_FROM`

Never upload `.env` to Render git. Paste keys in the dashboard.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | tsx watch on `src/index.ts` |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/index.js` |

## API prefixes

`/api/candidate`, `/api/ai`, `/api/jobs`, `/api/courses`, `/api/academies`, `/api/tutors`, `/api/recruiters`, `/api/applications`, `/api/admin`, `/api/notifications`, `/api/lms`, `/api/hiring`

## Push to GitHub

From this folder (not the parent monorepo):

```bash
git init
git add .
git commit -m "Initial CareerOS backend"
gh repo create careeros-backend --private --source=. --remote=origin --push
```

Or create an empty GitHub repo, then:

```bash
git remote add origin https://github.com/<you>/careeros-backend.git
git branch -M main
git push -u origin main
```

Never commit `.env`.
# career_os_back
