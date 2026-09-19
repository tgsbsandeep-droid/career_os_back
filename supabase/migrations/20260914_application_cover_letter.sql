-- Store candidate application details from the apply popup.
-- Safe to re-run.

alter table public.applications add column if not exists cover_letter text;
alter table public.applications add column if not exists notes text;
