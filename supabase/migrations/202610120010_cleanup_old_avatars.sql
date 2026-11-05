-- Migration 010: Configure Storage RLS policies for profile-avatars.
-- NOTE: Supabase protects storage.objects with storage.protect_delete(),
-- so deletions must only be done via the Storage API, never through direct SQL.

-- 1. Remove custom SQL trigger on profiles if it exists
drop trigger if exists trigger_cleanup_old_avatar on public.profiles;
drop function if exists public.cleanup_old_profile_avatar();

-- 2. Allow owner to SELECT all files in their folder (enables list() & remove() to find old avatars)
-- and allow public access to active avatars of public profiles
drop policy if exists "Public and owner profile avatars are viewable" on storage.objects;
drop policy if exists "Users can view their own profile avatars" on storage.objects;
create policy "Public and owner profile avatars are viewable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'profile-avatars'
    and (
      (
        (select auth.uid()) is not null
        and (
          split_part(name, '/', 1) = (select auth.uid())::text
          or (storage.foldername(name))[1] = (select auth.uid())::text
        )
      )
      or exists (
        select 1 from public.profiles p
        where p.avatar_path = name and p.is_public
      )
    )
  );

-- 3. Allow owner to DELETE their own avatar files via the Storage API
drop policy if exists "Users can delete their own profile avatars" on storage.objects;
create policy "Users can delete their own profile avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );

-- 4. Allow owner to UPDATE / replace their own avatar files via the Storage API
drop policy if exists "Users can replace their own profile avatars" on storage.objects;
create policy "Users can replace their own profile avatars"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  )
  with check (
    bucket_id = 'profile-avatars'
    and (
      split_part(name, '/', 1) = (select auth.uid())::text
      or (storage.foldername(name))[1] = (select auth.uid())::text
    )
  );
