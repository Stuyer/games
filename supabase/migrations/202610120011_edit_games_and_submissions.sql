-- Migration 011: Allow game edits, submissions for existing games, and direct moderator updates.

-- 1. Grant update permissions on public.games and user_games
grant update on public.games to authenticated;
grant update on public.user_games to authenticated;

-- 2. Only moderators may update the published catalog directly. Owners use
-- game_submissions for edits so they cannot bypass moderation through the API.
drop policy if exists "Users and moderators can update games in catalog" on public.games;
drop policy if exists "Moderators can update games directly" on public.games;
create policy "Moderators can update games directly"
  on public.games for update to authenticated
  using (
    (select public.is_moderator())
  )
  with check (
    (select public.is_moderator())
  );

-- 2.1 Allow an owner to submit an edit for an existing card. The previous
-- migration left the INSERT policy from migration 001 in place; that policy
-- explicitly required game_id to be null and therefore rejected every edit.
drop policy if exists "Users can submit pending games for themselves" on public.game_submissions;
create policy "Users can submit pending games for themselves"
  on public.game_submissions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
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
            and games.image_path = game_submissions.image_path
        )
      )
    )
  );

-- 3. Update duplicate pending submission check to support editing existing games (game_id is not null)
create or replace function public.prevent_duplicate_pending_game_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_title text;
begin
  if new.status <> 'pending' then
    return new;
  end if;

  normalized_title := lower(regexp_replace(btrim(new.title), '\s+', ' ', 'g'));

  -- Prevent duplicate pending submission for the same existing game or same title
  if exists (
    select 1
    from public.game_submissions as submissions
    where submissions.user_id = new.user_id
      and submissions.status = 'pending'
      and submissions.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and (
        (new.game_id is not null and submissions.game_id = new.game_id)
        or (lower(regexp_replace(btrim(submissions.title), '\s+', ' ', 'g')) = normalized_title)
      )
  ) then
    raise exception 'Заявка на эту игру уже ожидает проверки модератором.' using errcode = '23505';
  end if;

  -- For brand new games (game_id is null), prevent adding if title already in user's catalog
  if new.game_id is null and exists (
    select 1
    from public.games as games
    where games.owner_id = new.user_id
      and games.title_key = normalized_title
  ) then
    raise exception 'Такая игра уже есть в вашем каталоге.' using errcode = '23505';
  end if;

  -- For edited games (game_id is not null), prevent changing title to another game already in user's catalog
  if new.game_id is not null and exists (
    select 1
    from public.games as games
    where games.owner_id = new.user_id
      and games.id <> new.game_id
      and games.title_key = normalized_title
  ) then
    raise exception 'Игра с таким названием уже есть в вашем каталоге.' using errcode = '23505';
  end if;

  return new;
end;
$$;

-- Allow retaining existing game's image_path when submitting an edit
alter table public.game_submissions drop constraint if exists submissions_image_belongs_to_user;
alter table public.game_submissions add constraint submissions_image_belongs_to_user
  check (
    split_part(image_path, '/', 1) = user_id::text
    or game_id is not null
  );


-- 4. Update approval function to apply changes to existing game if game_id is present
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
    -- Обновление существующей игры
    update public.games
    set title = submission.title,
        developer = submission.developer,
        release_year = submission.release_year,
        genres = submission.genres,
        image_path = submission.image_path,
        ratings = submission.ratings,
        review = submission.review,
        playtime_hours = submission.playtime_hours
    where id = submission.game_id;

    if not found then
      raise exception 'Игра для этой заявки больше не существует.' using errcode = 'P0002';
    end if;

    approved_game_id := submission.game_id;
  else
    -- Добавление новой игры
    if exists (
      select 1 from public.games
      where owner_id = submission.user_id
        and title_key = lower(regexp_replace(btrim(submission.title), '\s+', ' ', 'g'))
    ) then
      raise exception 'Такая игра уже есть в каталоге пользователя.' using errcode = '23505';
    end if;

    insert into public.games (
      title, developer, release_year, genres, image_path, ratings, review, playtime_hours, owner_id
    ) values (
      submission.title, submission.developer, submission.release_year, submission.genres,
      submission.image_path, submission.ratings, submission.review, submission.playtime_hours, submission.user_id
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
