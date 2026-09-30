-- Migration: course_transactions
-- Creates an audit table for course payment events so that /api/courses/:id/pay
-- has a transaction record and is idempotent (upsert on candidate_id + course_id).

create table if not exists public.course_transactions (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references auth.users(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade,
  amount        numeric(10, 2) not null default 0,
  currency      text not null default 'INR',
  status        text not null default 'completed',
  paid_at       timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  -- One transaction record per candidate per course (idempotent upsert key).
  unique (candidate_id, course_id)
);

-- RLS: candidates can read their own transactions; service role can write.
alter table public.course_transactions enable row level security;

create policy "Candidates can view own transactions"
  on public.course_transactions
  for select
  using (auth.uid() = candidate_id);

-- Index for fast lookups by candidate.
create index if not exists course_transactions_candidate_idx
  on public.course_transactions (candidate_id);