-- Migration: Allow users to delete any of their own submissions from history
-- and deduplicate multiple submissions for the same game.

-- 1. Allow owners to delete any of their own submissions (approved, pending, rejected)
drop policy if exists "Owners can delete rejected submissions" on public.game_submissions;
drop policy if exists "Owners can delete their own submissions" on public.game_submissions;

create policy "Owners can delete their own submissions"
  on public.game_submissions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- 2. Remove existing duplicate submissions per user + game, keeping only the latest row
delete from public.game_submissions as sub
where exists (
  select 1
  from public.game_submissions as newer
  where newer.user_id = sub.user_id
    and newer.id <> sub.id
    and (
      (sub.catalog_id is not null and newer.catalog_id = sub.catalog_id)
      or (sub.game_id is not null and newer.game_id = sub.game_id)
      or translate(lower(regexp_replace(btrim(newer.title), '\s+', ' ', 'g')), 'ё', 'е') =
         translate(lower(regexp_replace(btrim(sub.title), '\s+', ' ', 'g')), 'ё', 'е')
    )
    and (
      coalesce(newer.moderated_at, newer.created_at) > coalesce(sub.moderated_at, sub.created_at)
      or (
        coalesce(newer.moderated_at, newer.created_at) = coalesce(sub.moderated_at, sub.created_at)
        and newer.id::text > sub.id::text
      )
    )
);

-- 3. Update approve_game_submission so approving a submission cleans up older submissions for the same game
create or replace function public.approve_game_submission(p_submission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.game_submissions%rowtype;
  catalog public.game_catalog%rowtype;
  approved_game_id uuid;
begin
  if not public.is_moderator() then
    raise exception 'Недостаточно прав для модерации.' using errcode = '42501';
  end if;

  select * into submission
  from public.game_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Заявка не найдена.' using errcode = 'P0002';
  end if;
  if submission.status <> 'pending' then
    raise exception 'Эта заявка уже рассмотрена.' using errcode = '22023';
  end if;
  if submission.catalog_id is null then
    raise exception 'В заявке не выбрана игра из каталога.' using errcode = '22023';
  end if;

  select * into catalog from public.game_catalog where id = submission.catalog_id;
  if not found then
    raise exception 'Игра не найдена в каталоге.' using errcode = 'P0002';
  end if;

  if submission.game_id is not null then
    update public.games
    set catalog_id = catalog.id,
        title = catalog.title,
        developer = catalog.studio,
        release_year = catalog.release_year,
        genres = catalog.genres,
        image_path = submission.image_path,
        ratings = submission.ratings,
        review = submission.review,
        playtime_hours = submission.playtime_hours,
        background_position_list_x = submission.background_position_list_x,
        background_position_list_y = submission.background_position_list_y,
        background_scale_list = submission.background_scale_list,
        background_position_grid_x = submission.background_position_grid_x,
        background_position_grid_y = submission.background_position_grid_y,
        background_scale_grid = submission.background_scale_grid
    where id = submission.game_id;

    if not found then
      raise exception 'Игра для этой заявки больше не существует.' using errcode = 'P0002';
    end if;
    approved_game_id := submission.game_id;
  else
    if exists (
      select 1
      from public.games
      where owner_id = submission.user_id
        and (catalog_id = catalog.id or title_key = catalog.title_key)
    ) then
      raise exception 'Такая игра уже есть в каталоге пользователя.' using errcode = '23505';
    end if;

    insert into public.games (
      id, catalog_id, title, developer, release_year, genres, image_path, ratings, review, playtime_hours,
      owner_id, background_position_list_x, background_position_list_y, background_scale_list,
      background_position_grid_x, background_position_grid_y, background_scale_grid
    ) values (
      submission.id, catalog.id, catalog.title, catalog.studio, catalog.release_year, catalog.genres,
      submission.image_path, submission.ratings, submission.review, submission.playtime_hours,
      submission.user_id, submission.background_position_list_x, submission.background_position_list_y,
      submission.background_scale_list, submission.background_position_grid_x,
      submission.background_position_grid_y, submission.background_scale_grid
    ) returning id into approved_game_id;
  end if;

  insert into public.user_games (user_id, game_id, ratings, review, playtime_hours)
  values (submission.user_id, approved_game_id, submission.ratings, submission.review, submission.playtime_hours)
  on conflict (user_id, game_id) do update
  set ratings = excluded.ratings,
      review = excluded.review,
      playtime_hours = excluded.playtime_hours;

  update public.game_submissions
  set status = 'approved', game_id = approved_game_id,
      moderated_by = (select auth.uid()), moderated_at = now(), moderator_note = null
  where id = p_submission_id;

  delete from public.game_submissions
  where user_id = submission.user_id
    and id <> p_submission_id
    and (
      game_id = approved_game_id
      or catalog_id = catalog.id
      or translate(lower(regexp_replace(btrim(title), '\s+', ' ', 'g')), 'ё', 'е') = catalog.title_key
    );

  return approved_game_id;
end;
$$;

