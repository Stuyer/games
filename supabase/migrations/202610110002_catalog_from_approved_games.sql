-- Move the public homepage catalog to the approved Supabase games table.
-- Safe to apply after 202610110001_initial_accounts_and_moderation.sql.

alter table public.games
  add column ratings jsonb not null default '{"story":1,"graphics":1,"gameplay":1,"main_character":1,"characters":1,"atmosphere":1,"sound_design":1}'::jsonb,
  add column review text not null default '',
  add column playtime_hours numeric(7,1);

alter table public.games
  add constraint games_ratings_valid check (public.valid_game_ratings(ratings)),
  add constraint games_review_length check (char_length(review) <= 8000),
  add constraint games_playtime_nonnegative check (playtime_hours is null or playtime_hours >= 0);

-- Preserve information from the already-approved submissions.
with first_approved_submission as (
  select distinct on (game_id)
    game_id, ratings, review, playtime_hours
  from public.game_submissions
  where status = 'approved' and game_id is not null
  order by game_id, moderated_at asc nulls last, created_at asc
)
update public.games as games
set ratings = first_approved_submission.ratings,
    review = first_approved_submission.review,
    playtime_hours = first_approved_submission.playtime_hours
from first_approved_submission
where games.id = first_approved_submission.game_id;

grant insert on public.games to authenticated;
create policy "Moderators can add games directly to the approved catalog"
  on public.games for insert to authenticated
  with check (
    (select public.is_moderator())
    and split_part(image_path, '/', 1) = (select auth.uid())::text
  );

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

  insert into public.games (title, developer, release_year, genres, image_path, ratings, review, playtime_hours)
  values (submission.title, submission.developer, submission.release_year, submission.genres,
          submission.image_path, submission.ratings, submission.review, submission.playtime_hours)
  on conflict (title_key) do nothing;

  select id into approved_game_id
  from public.games
  where title_key = lower(regexp_replace(btrim(submission.title), '\s+', ' ', 'g'));

  insert into public.user_games (user_id, game_id, ratings, review, playtime_hours)
  values (submission.user_id, approved_game_id, submission.ratings, submission.review, submission.playtime_hours)
  on conflict (user_id, game_id) do nothing;

  update public.game_submissions
  set status = 'approved', game_id = approved_game_id,
      moderated_by = (select auth.uid()), moderated_at = now(), moderator_note = null
  where id = p_submission_id;

  return approved_game_id;
end;
$$;

