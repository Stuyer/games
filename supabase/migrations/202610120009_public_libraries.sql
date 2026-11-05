-- Migration 009: public, read-only library discovery and profile browsing.

drop policy if exists "Profiles are publicly viewable" on public.profiles;
drop policy if exists "Public profiles are viewable; private profiles are owner-only" on public.profiles;
create policy "Public profiles are viewable; private profiles are owner-only"
  on public.profiles for select to anon, authenticated
  using (is_public or id = (select auth.uid()));

drop policy if exists "Users can view their own catalog" on public.games;
drop policy if exists "Public catalogs are viewable; own catalogs are always visible" on public.games;
create policy "Public catalogs are viewable; own catalogs are always visible"
  on public.games for select to anon, authenticated
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = owner_id and p.is_public
    )
  );

drop policy if exists "Users can view their own game details" on public.user_games;
drop policy if exists "Public library details are viewable; own details are always visible" on public.user_games;
create policy "Public library details are viewable; own details are always visible"
  on public.user_games for select to anon, authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.profiles p
      where p.id = user_id and p.is_public
    )
  );

drop policy if exists "Owners and moderators can inspect pending covers; approved covers are readable" on storage.objects;
create policy "Owners and moderators can inspect pending covers; approved covers are readable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'game-covers'
    and (
      exists (
        select 1 from public.games g
        join public.profiles p on p.id = g.owner_id
        where g.image_path = name
          and (p.is_public or p.id = (select auth.uid()))
      )
      or (
        (select auth.uid()) is not null
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
      or (select public.is_moderator())
    )
  );

drop policy if exists "Users can view their own profile avatars" on storage.objects;
drop policy if exists "Public and owner profile avatars are viewable" on storage.objects;
create policy "Public and owner profile avatars are viewable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'profile-avatars'
    and exists (
      select 1 from public.profiles p
      where p.avatar_path = name
        and (p.is_public or p.id = (select auth.uid()))
    )
  );

create or replace function public.list_public_libraries()
returns table (
  profile_id uuid,
  username text,
  display_name text,
  avatar_path text,
  game_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.username,
    p.display_name,
    p.avatar_path,
    count(g.id)::bigint
  from public.profiles p
  left join public.games g on g.owner_id = p.id
  where p.is_public or p.id = (select auth.uid())
  group by p.id, p.username, p.display_name, p.avatar_path
  order by lower(p.display_name), lower(p.username)
$$;

revoke all on function public.list_public_libraries() from public;
grant execute on function public.list_public_libraries() to anon, authenticated;
