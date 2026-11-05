-- Migration 018: Allow authors to edit rejected submissions and remove them from their queue.
-- Resubmission keeps the same row, preserving the moderator's history until
-- the author sends the updated card back to the pending queue.

grant update (
  title,
  developer,
  release_year,
  genres,
  image_path,
  ratings,
  review,
  playtime_hours,
  background_position_list_x,
  background_position_list_y,
  background_scale_list,
  background_position_grid_x,
  background_position_grid_y,
  background_scale_grid,
  status,
  moderator_note,
  moderated_by,
  moderated_at
) on public.game_submissions to authenticated;
grant delete on public.game_submissions to authenticated;

drop policy if exists "Owners can resubmit rejected submissions" on public.game_submissions;
create policy "Owners can resubmit rejected submissions"
  on public.game_submissions for update to authenticated
  using ((select auth.uid()) = user_id and status = 'rejected')
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and moderator_note is null
    and moderated_by is null
    and moderated_at is null
  );

drop policy if exists "Owners can delete rejected submissions" on public.game_submissions;
create policy "Owners can delete rejected submissions"
  on public.game_submissions for delete to authenticated
  using ((select auth.uid()) = user_id and status = 'rejected');

-- The previous cleanup migration removed viewed decisions after one minute.
-- User submissions are now retained until the author explicitly deletes them.
create or replace function public.cleanup_old_viewed_submissions()
returns integer
language sql
security definer
set search_path = ''
as $$
  select 0;
$$;
