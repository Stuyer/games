-- Migration 016: tie new game covers to the catalog game id and keep Storage clean.
-- Apply after 202610130004_profile_comments.sql.

-- New submissions already use the submission UUID as their client-side game UUID.
-- Keep that UUID when publishing a new game so its cover path stays tied to the game:
-- <user_id>/games/<game_id>/<upload_uuid>.<extension>
create or replace function public.approve_game_submission(p_submission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.game_submissions%rowtype;
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

  if submission.game_id is not null then
    update public.games
    set title = submission.title,
        developer = submission.developer,
        release_year = submission.release_year,
        genres = submission.genres,
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
      select 1 from public.games
      where owner_id = submission.user_id
        and title_key = lower(regexp_replace(btrim(submission.title), '\s+', ' ', 'g'))
    ) then
      raise exception 'Такая игра уже есть в каталоге пользователя.' using errcode = '23505';
    end if;

    insert into public.games (
      id, title, developer, release_year, genres, image_path, ratings, review, playtime_hours,
      owner_id, background_position_list_x, background_position_list_y, background_scale_list,
      background_position_grid_x, background_position_grid_y, background_scale_grid
    ) values (
      submission.id, submission.title, submission.developer, submission.release_year, submission.genres,
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

  return approved_game_id;
end;
$$;
