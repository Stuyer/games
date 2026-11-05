-- Give every published card an owner and let that owner remove only their own card.
-- Apply after migrations 001, 002 and 003.

alter table public.games
  add column if not exists owner_id uuid references public.profiles (id) on delete set null;

create index if not exists games_owner_id_idx on public.games (owner_id);

-- Approved submissions created before this migration keep their original authors.
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

drop policy if exists "Moderators can add games directly to the approved catalog" on public.games;
create policy "Moderators can add games directly to the approved catalog"
  on public.games for insert to authenticated
  with check (
    (select public.is_moderator())
    and owner_id = (select auth.uid())
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

  insert into public.games (
    title, developer, release_year, genres, image_path, ratings, review, playtime_hours, owner_id
  ) values (
    submission.title, submission.developer, submission.release_year, submission.genres,
    submission.image_path, submission.ratings, submission.review, submission.playtime_hours, submission.user_id
  )
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
  return target_game.image_path;
end;
$$;

revoke all on function public.delete_catalog_game(text, text) from public;
grant execute on function public.delete_catalog_game(text, text) to authenticated;

create policy "Owners can remove covers of deleted catalog games"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'game-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (select 1 from public.games g where g.image_path = name)
    and not exists (
      select 1 from public.game_submissions s
      where s.image_path = name and s.status = 'pending'
    )
  );
