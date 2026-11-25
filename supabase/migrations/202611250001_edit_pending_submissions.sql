-- Allow authors to edit their own pending (unmoderated) submissions
-- in addition to resubmitting rejected submissions.
drop policy if exists "Owners can resubmit rejected submissions" on public.game_submissions;
drop policy if exists "Owners can edit pending or resubmit rejected submissions" on public.game_submissions;

create policy "Owners can edit pending or resubmit rejected submissions"
  on public.game_submissions for update to authenticated
  using ((select auth.uid()) = user_id and status in ('pending', 'rejected'))
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and catalog_id is not null
    and moderator_note is null
    and moderated_by is null
    and moderated_at is null
    and (
      game_id is null
      or exists (
        select 1
        from public.games as games
        where games.id = game_submissions.game_id
          and games.owner_id = (select auth.uid())
      )
    )
    and (
      split_part(image_path, '/', 1) = (select auth.uid())::text
      or (
        game_id is not null
        and exists (
          select 1
          from public.games as games
          where games.id = game_submissions.game_id
            and games.owner_id = (select auth.uid())
            and games.image_path = game_submissions.image_path
        )
      )
    )
  );
