-- Migration: offline_training_registrations
-- Persists offline (in-person) training registrations so they survive
-- across devices and browser clears. Previously stored only in localStorage.

create table if not exists public.offline_training_registrations (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references auth.users(id) on delete cascade,
  training_id       text not null,                  -- static ID from the frontend TRAININGS array
  registration_id   text not null,                  -- e.g. "OT-1-AB3C"
  full_name         text not null,
  email             text not null,
  phone             text not null,
  status            text not null default 'confirmed', -- 'confirmed' | 'waitlisted'
  enrolled_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  -- One registration per candidate per training (idempotent upsert key).
  unique (candidate_id, training_id)
);

-- RLS: candidates can read and insert their own registrations only.
alter table public.offline_training_registrations enable row level security;

create policy "Candidates can view own offline registrations"
  on public.offline_training_registrations
  for select
  using (auth.uid() = candidate_id);

create policy "Candidates can insert own offline registrations"
  on public.offline_training_registrations
  for insert
  with check (auth.uid() = candidate_id);

-- Index for fast per-candidate lookups.
create index if not exists offline_training_registrations_candidate_idx
  on public.offline_training_registrations (candidate_id);