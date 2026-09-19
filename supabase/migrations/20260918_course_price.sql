-- Course fees for candidate catalog / details.
-- Safe to re-run in the SQL Editor.

alter table public.courses add column if not exists price numeric not null default 0;
alter table public.courses add column if not exists is_free boolean not null default true;

update public.courses
set is_free = true
where is_free is null;

update public.courses
set price = 0
where price is null;
