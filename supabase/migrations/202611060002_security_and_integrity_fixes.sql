-- Migration 021: Security hardening, storage cleanup policy fixes, and missing indexes.
-- Apply after 202611060001_catalog_relink_and_title_search.sql.

-- 1. Restrict game-covers allowed MIME types (remove SVG to prevent stored XSS).
update storage.buckets
set allowed_mime_types = array[
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/bmp',
  'image/avif'
]::text[]
where id = 'game-covers';

-- 2. Harden mark_submission_as_viewed and cleanup_old_viewed_submissions.
create or replace function public.mark_submission_as_viewed(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.game_submissions
  set viewed_at = now()
  where id = p_submission_id
    and user_id = (select auth.uid())
    and viewed_at is null;
end;
$$;

revoke all on function public.mark_submission_as_viewed(uuid) from public, anon;
grant execute on function public.mark_submission_as_viewed(uuid) to authenticated;

revoke all on function public.cleanup_old_viewed_submissions() from public, anon, authenticated;

-- 3. Revoke anon execute on moderation and deletion RPCs.
revoke all on function public.approve_game_submission(uuid) from public, anon;
grant execute on function public.approve_game_submission(uuid) to authenticated;

revoke all on function public.reject_game_submission(uuid, text) from public, anon;
grant execute on function public.reject_game_submission(uuid, text) to authenticated;

revoke all on function public.delete_catalog_game(text, text) from public, anon;
grant execute on function public.delete_catalog_game(text, text) to authenticated;

-- 4. Allow moderators to view private profiles so moderation queue displays author names.
drop policy if exists "Public profiles are viewable; private profiles are owner-only" on public.profiles;
create policy "Public profiles are viewable; private profiles are owner-only"
  on public.profiles for select to anon, authenticated
  using (is_public or id = (select auth.uid()) or (select public.is_moderator()));

-- 5. Make search_game_catalog SECURITY INVOKER (game_catalog is publicly readable).
alter function public.search_game_catalog(text, integer) security invoker;

-- 6. Tighten table/column grants on game_submissions, games, and user_games.
revoke insert on public.game_submissions from authenticated;
grant insert (
  id,
  user_id,
  game_id,
  catalog_id,
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
  status
) on public.game_submissions to authenticated;

revoke update on public.user_games from authenticated;
revoke update on public.games from authenticated;
grant update (
  catalog_id,
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
  background_scale_grid
) on public.games to authenticated;

-- 7. Fix INSERT and resubmit UPDATE policies on game_submissions to verify game_id ownership and image_path ownership.
drop policy if exists "Users can submit pending games for themselves" on public.game_submissions;
create policy "Users can submit pending games for themselves"
  on public.game_submissions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and catalog_id is not null
    and moderator_note is null
    and moderated_by is null
    and moderated_at is null
    and viewed_at is null
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

drop policy if exists "Owners can resubmit rejected submissions" on public.game_submissions;
create policy "Owners can resubmit rejected submissions"
  on public.game_submissions for update to authenticated
  using ((select auth.uid()) = user_id and status = 'rejected')
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

-- 8. Consolidate storage DELETE policies on game-covers and protect covers of pending/rejected submissions.
drop policy if exists "Owners can remove their own unreferenced covers" on storage.objects;
drop policy if exists "Moderators can remove unused catalog covers" on storage.objects;
drop policy if exists "Owners can remove covers of deleted catalog games" on storage.objects;
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
      where s.image_path = name and s.status in ('pending', 'rejected')
    )
  );

-- 9. Cascade delete games when owner profile is deleted.
alter table public.games
  drop constraint if exists games_owner_id_fkey;
alter table public.games
  add constraint games_owner_id_fkey
  foreign key (owner_id) references public.profiles (id) on delete cascade;

-- 10. Normalize games.title_key with ё -> е so it matches game_catalog.title_key, and add unique (owner_id, catalog_id).
drop index if exists public.games_owner_title_key_unique_idx;
alter table public.games
  drop column if exists title_key;
alter table public.games
  add column title_key text generated always as (
    translate(lower(regexp_replace(btrim(title), '\s+', ' ', 'g')), 'ё', 'е')
  ) stored;

create unique index if not exists games_owner_title_key_unique_idx
  on public.games (owner_id, title_key)
  where owner_id is not null;

create unique index if not exists games_owner_catalog_id_unique_idx
  on public.games (owner_id, catalog_id)
  where owner_id is not null and catalog_id is not null;

-- 11. Add missing indexes for storage RLS checks and foreign keys.
create index if not exists games_image_path_idx on public.games (image_path);
create index if not exists game_submissions_image_path_idx on public.game_submissions (image_path);
create index if not exists profiles_avatar_path_idx on public.profiles (avatar_path) where avatar_path is not null;
create index if not exists user_games_game_id_idx on public.user_games (game_id);
create index if not exists game_submissions_game_id_idx on public.game_submissions (game_id) where game_id is not null;

-- 12. Update search_game_catalog to match strictly by word prefixes (including single-character tokens like "3").
create or replace function public.search_game_catalog(p_query text, p_limit integer default 10)
returns table (
  id uuid,
  title text,
  studio text,
  release_year integer,
  genres text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with search_query as (
    select
      translate(lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g')), 'ё', 'е') as term,
      array_remove(
        regexp_split_to_array(
          translate(lower(btrim(coalesce(p_query, ''))), 'ё', 'е'),
          '[^a-zа-я0-9]+'
        ),
        ''
      ) as tokens
  )
  select catalog.id, catalog.title, catalog.studio, catalog.release_year, catalog.genres
  from public.game_catalog as catalog, search_query
  where cardinality(search_query.tokens) >= 1
    and catalog.is_stub = false
    and not exists (
      select 1
      from unnest(search_query.tokens) as q_tok
      where not exists (
        select 1
        from unnest(regexp_split_to_array(catalog.title_key, '[^a-zа-я0-9]+')) as title_word
        where title_word <> ''
          and starts_with(title_word, q_tok)
      )
    )
  order by
    case
      when catalog.title_key = search_query.term then 0
      when starts_with(catalog.title_key, search_query.term) then 1
      when starts_with(catalog.title_key, search_query.tokens[1]) then 2
      else 3
    end,
    extensions.similarity(catalog.title_key, search_query.term) desc,
    catalog.release_year desc nulls last,
    catalog.title asc
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

revoke all on function public.search_game_catalog(text, integer) from public;
grant execute on function public.search_game_catalog(text, integer) to anon, authenticated;


