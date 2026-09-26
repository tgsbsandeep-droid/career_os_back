# CareerOS Backend

Express 5 + TypeScript API for CareerOS. Includes Supabase schema/migrations and Gemini AI.

This folder is a **standalone GitHub repo**. Put every third-party key in **one** gitignored file: [`backend/.env`](.env). Never commit or push it. Use [`.env.example`](.env.example) as the template.

## Stack

- Express 5 (CommonJS)
- TypeScript
- Supabase Auth JWT + RLS
- Google Gemini (`@google/genai`)

## Also in this repo

- [`supabase/`](supabase/) — live schema + all SQL migrations

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

## Email delivery

Registration confirmation emails (the "Check your email" screen after sign-up) are sent by **Supabase's auth service**, not by this backend. If users register successfully but never receive the email:

1. **Check Supabase's built-in rate limit.** The free tier allows only 3 auth emails per hour per project. Emails beyond that are silently dropped. You can see the count under Authentication → Logs in the Supabase dashboard.

2. **Configure a custom SMTP provider.** Go to Supabase dashboard → Project Settings → Authentication → SMTP Settings and enter credentials for a transactional email provider (Resend, SendGrid, Postmark, AWS SES, etc.). Supabase's shared SMTP has low deliverability and Gmail often marks it as spam.

3. **Check spam / promotions folders.** Supabase's default sender domain (`mail.supabase.io`) is frequently filtered.

4. **Disable email confirmation for development.** Under Authentication → Providers → Email, you can turn off "Confirm email". With confirmation off, `signUp` returns a session immediately and no email is sent — useful for local testing.

Interview invitation emails (sent when a recruiter schedules an interview) are handled by this backend via `RESEND_API_KEY` or `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` in `backend/.env`.

## Database

Paste each file's **contents** (not the filename) into the Supabase SQL Editor **in this exact order**:

1. [`supabase/schema.sql`](supabase/schema.sql)
2. [`supabase/migrations/20260904_recruiter_profiles_fix.sql`](supabase/migrations/20260904_recruiter_profiles_fix.sql)
3. [`supabase/migrations/20260904_register_migrations.sql`](supabase/migrations/20260904_register_migrations.sql)
4. [`supabase/migrations/20260904_saved_jobs_courses.sql`](supabase/migrations/20260904_saved_jobs_courses.sql)
5. [`supabase/migrations/20260904_tutor_expertise_qualifications.sql`](supabase/migrations/20260904_tutor_expertise_qualifications.sql)
6. [`supabase/migrations/20260907_lms_quizzes_assignments.sql`](supabase/migrations/20260907_lms_quizzes_assignments.sql)
7. [`supabase/migrations/20260911_interviews_offers.sql`](supabase/migrations/20260911_interviews_offers.sql)
8. [`supabase/migrations/20260912_job_skill_matches.sql`](supabase/migrations/20260912_job_skill_matches.sql)
9. [`supabase/migrations/20260912_jobs_draft_rls.sql`](supabase/migrations/20260912_jobs_draft_rls.sql)
10. [`supabase/migrations/20260912_recruiter_applications_visibility.sql`](supabase/migrations/20260912_recruiter_applications_visibility.sql)
11. [`supabase/migrations/20260914_application_cover_letter.sql`](supabase/migrations/20260914_application_cover_letter.sql)
12. [`supabase/migrations/20260914_demo_seed.sql`](supabase/migrations/20260914_demo_seed.sql)
13. [`supabase/migrations/20260915_recruiter_candidate_invite.sql`](supabase/migrations/20260915_recruiter_candidate_invite.sql)
14. [`supabase/migrations/20260916_academy_profile_details.sql`](supabase/migrations/20260916_academy_profile_details.sql)
15. [`supabase/migrations/20260916_storage_avatars_rls.sql`](supabase/migrations/20260916_storage_avatars_rls.sql)
16. [`supabase/migrations/20260917_candidate_avatar.sql`](supabase/migrations/20260917_candidate_avatar.sql)
17. [`supabase/migrations/20260918_enrollment_payment.sql`](supabase/migrations/20260918_enrollment_payment.sql)
18. [`supabase/migrations/20260923_fix_company_name_placeholder.sql`](supabase/migrations/20260923_fix_company_name_placeholder.sql)
19. [`supabase/migrations/20260925_add_fk_indexes.sql`](supabase/migrations/20260925_add_fk_indexes.sql)
20. [`supabase/migrations/20260925_backfill_academy_role.sql`](supabase/migrations/20260925_backfill_academy_role.sql)

> **Tip:** Run migrations in filename order. Skipping any file will leave the schema incomplete (missing RLS policies, columns, payment-status fields, performance indexes, or data backfills that the API assumes exist).

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

**Google Cloud** (required for "Continue with Google"). Google never sees the
app origin. Add this exact URI on the **same** OAuth 2.0 Web client that is
pasted into Supabase → Authentication → Providers → Google:

```
https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
```

`Error 400: redirect_uri_mismatch` means that URI is missing on **this** client
(or you edited a different Client ID). See the root README Google Cloud section.

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
| `npm test` | Run vitest unit tests |
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
