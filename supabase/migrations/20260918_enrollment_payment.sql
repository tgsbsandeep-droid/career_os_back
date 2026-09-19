-- Paid-course access: enrollment is not enough; fee must be marked paid.
-- Safe to re-run in the SQL Editor.

alter table public.enrollments
  add column if not exists payment_status text not null default 'paid';

alter table public.enrollments
  add column if not exists paid_at timestamptz;

update public.enrollments
set payment_status = 'paid'
where payment_status is null or payment_status = '';

alter table public.enrollments drop constraint if exists enrollments_payment_status_check;
alter table public.enrollments
  add constraint enrollments_payment_status_check
  check (payment_status in ('unpaid', 'paid'));

update public.enrollments
set paid_at = coalesce(paid_at, created_at, now())
where payment_status = 'paid' and paid_at is null;
