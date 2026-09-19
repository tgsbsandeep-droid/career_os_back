-- Restore storage policies for profile photos and academy course media.
-- schema.sql previously dropped avatar policies and never recreated them.
-- Safe to re-run. Apply in the Supabase SQL Editor.

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('course-thumbnails', 'course-thumbnails', true),
  ('learning-content', 'learning-content', true)
on conflict (id) do nothing;

drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar"
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar"
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Anyone can view avatars" on storage.objects;
create policy "Anyone can view avatars"
  on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "Tutors can upload course thumbnails" on storage.objects;
create policy "Tutors can upload course thumbnails"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'course-thumbnails'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Tutors can update course thumbnails" on storage.objects;
create policy "Tutors can update course thumbnails"
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'course-thumbnails'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'course-thumbnails'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Tutors can upload learning content" on storage.objects;
create policy "Tutors can upload learning content"
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'learning-content'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Tutors can update learning content" on storage.objects;
create policy "Tutors can update learning content"
  on storage.objects
  for update to authenticated
  using (
    bucket_id = 'learning-content'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'learning-content'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );
