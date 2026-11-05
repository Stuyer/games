-- Make each published game card belong to one user's private catalog.
-- Apply after migrations 001 through 005.

-- Older approvals could point several users at the same globally shared game.
-- Give legacy cards a best-effort owner before separating those memberships.
with approved_owners as (
  select distinct on (game_id) game_id, user_id
  from public.game_submissions
  where status = 'approved' and game_id is not null
  order by game_id, moderated_at asc nulls last, created_at asc
)
update public.games as games
set owner_id = approved_owners.user_id
from approved_owners
where games.id = approved_owners.game_id
  and games.owner_id is null;

update public.games as games
set owner_id = profiles.id
from public.profiles as profiles
where games.owner_id is null
  and split_part(games.image_path, '/', 1) = profiles.id::text;

with first_library_owner as (
  select distinct on (game_id) game_id, user_id
  from public.user_games
  order by game_id, created_at asc
)
update public.games as games
set owner_id = first_library_owner.user_id
from first_library_owner
where games.id = first_library_owner.game_id
  and games.owner_id is null;

-- The old global title constraint is replaced by a per-owner title constraint.
alter table public.games drop constraint if exists games_title_key_key;

-- Preserve legacy user_games entries by creating an independent game row for
-- each additional owner, carrying that user's personal rating and review over.
do $$
declare
  legacy_membership record;
  copied_game_id uuid;
begin
  for legacy_membership in
    select
      games.id as original_game_id,
      games.title,
      games.developer,
      games.release_year,
      games.genres,
      coalesce((
        select submissions.image_path
        from public.game_submissions as submissions
        where submissions.game_id = games.id
          and submissions.user_id = memberships.user_id
          and submissions.status = 'approved'
        order by submissions.moderated_at asc nulls last, submissions.created_at asc
        limit 1
      ), games.image_path) as image_path,
      games.created_at as game_created_at,
      memberships.id as membership_id,
      memberships.user_id,
      memberships.ratings,
      memberships.review,
      memberships.playtime_hours
    from public.games as games
    join public.user_games as memberships on memberships.game_id = games.id
    where memberships.user_id is distinct from games.owner_id
    order by games.id, memberships.created_at
  loop
    insert into public.games (
      title, developer, release_year, genres, image_path,
      ratings, review, playtime_hours, owner_id, created_at
    ) values (
      legacy_membership.title, legacy_membership.developer, legacy_membership.release_year,
      legacy_membership.genres, legacy_membership.image_path,
      legacy_membership.ratings, legacy_membership.review, legacy_membership.playtime_hours,
      legacy_membership.user_id, legacy_membership.game_created_at
    ) returning id into copied_game_id;

    update public.user_games
    set game_id = copied_game_id
    where id = legacy_membership.membership_id;
  end loop;
end;
$$;

create unique index if not exists games_owner_title_key_unique_idx
  on public.games (owner_id, title_key)
  where owner_id is not null;

drop policy if exists "Approved catalog is publicly viewable" on public.games;
drop policy if exists "Users can view their own catalog" on public.games;
create policy "Users can view their own catalog"
  on public.games for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Public libraries are viewable" on public.user_games;
drop policy if exists "Users can view their own game details" on public.user_games;
create policy "Users can view their own game details"
  on public.user_games for select to authenticated
  using (user_id = (select auth.uid()));

-- A repeated title is allowed for different people, but only once per user's
-- pending queue or personal catalog.
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
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || normalized_title, 0));

  if exists (
    select 1
    from public.game_submissions as submissions
    where submissions.user_id = new.user_id
      and submissions.status = 'pending'
      and submissions.id is distinct from new.id
      and lower(regexp_replace(btrim(submissions.title), '\s+', ' ', 'g')) = normalized_title
  ) or exists (
    select 1
    from public.games as games
    where games.owner_id = new.user_id
      and games.title_key = normalized_title
  ) then
    raise exception 'Такая игра уже есть в вашем каталоге или ожидает проверки.' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_duplicate_pending_game_submission on public.game_submissions;
create trigger prevent_duplicate_pending_game_submission
  before insert or update of title, status on public.game_submissions
  for each row execute function public.prevent_duplicate_pending_game_submission();

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

create or replace function public.delete_catalog_game(p_title text, p_confirmation text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_game public.games%rowtype;
begin
  if nullif(btrim(p_title), '') is null then
    raise exception 'Введите название игры.' using errcode = '22023';
  end if;
  if p_confirmation is distinct from p_title then
    raise exception 'Подтверждение не совпадает с названием игры.' using errcode = '22023';
  end if;

  select * into target_game
  from public.games
  where title = btrim(p_title)
    and owner_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'В вашем каталоге игра с таким точным названием не найдена.' using errcode = 'P0002';
  end if;

  delete from public.games where id = target_game.id;

  -- Historical shared cards may point to another user's original cover. Return
  -- a path only when no remaining card uses it and it belongs to this user.
  if exists (select 1 from public.games where image_path = target_game.image_path)
     or split_part(target_game.image_path, '/', 1) <> (select auth.uid())::text then
    return null;
  end if;
  return target_game.image_path;
end;
$$;

revoke all on function public.delete_catalog_game(text, text) from public;
grant execute on function public.delete_catalog_game(text, text) to authenticated;

-- Personal library data must not be readable to signed-out visitors.
drop policy if exists "Approved catalog is publicly viewable" on public.games;
