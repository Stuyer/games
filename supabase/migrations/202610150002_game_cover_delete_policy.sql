-- Migration 017: explicitly allow cleanup of unreferenced game covers.
-- Apply after 202610150001_game_cover_lifecycle.sql.
-- Storage files are still deleted through the Storage API, never by SQL.

drop policy if exists "Owners and moderators can remove obsolete game covers" on storage.objects;
create policy "Owners and moderators can remove obsolete game covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'game-covers'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_moderator())
    )
    and not exists (
      select 1 from public.games g where g.image_path = name
    )
    and not exists (
      select 1 from public.game_submissions s
      where s.image_path = name and s.status = 'pending'
    )
  );
