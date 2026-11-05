-- Supabase foundation for accounts, public libraries, and game moderation.
-- The existing games.json catalog remains local and is not imported here.

create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  is_public boolean not null default true,
  is_moderator boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  constraint profiles_display_name_length check (char_length(display_name) between 1 and 48)
);
create unique index profiles_username_case_insensitive_idx on public.profiles (lower(username));

create or replace function public.valid_game_ratings(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(value) <> 'object' then false
    else (select count(*) from jsonb_object_keys(value)) = 7
      and not exists (
        select 1
        from jsonb_each_text(value) as rating(key, score)
        where rating.key not in ('story', 'graphics', 'gameplay', 'main_character', 'characters', 'atmosphere', 'sound_design')
           or rating.score !~ '^(10|[1-9])$'
      )
  end;
$$;

create table public.games (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  title_key text generated always as (lower(regexp_replace(btrim(title), '\s+', ' ', 'g'))) stored unique,
  developer text not null default '',
  release_year integer,
  genres text[] not null default '{}',
  image_path text not null,
  created_at timestamptz not null default now(),
  constraint games_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint games_year_range check (release_year is null or release_year between 1950 and 2100)
);

create table public.user_games (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete restrict,
  ratings jsonb not null default '{}'::jsonb,
  review text not null default '',
  playtime_hours numeric(7,1),
  created_at timestamptz not null default now(),
  unique (user_id, game_id),
  constraint user_games_ratings_valid check (public.valid_game_ratings(ratings)),
  constraint user_games_review_length check (char_length(review) <= 8000),
  constraint user_games_playtime_nonnegative check (playtime_hours is null or playtime_hours >= 0)
);

create type public.submission_status as enum ('pending', 'approved', 'rejected');

create table public.game_submissions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  developer text not null default '',
  release_year integer,
  genres text[] not null default '{}',
  image_path text not null,
  ratings jsonb not null default '{}'::jsonb,
  review text not null default '',
  playtime_hours numeric(7,1),
  status public.submission_status not null default 'pending',
  moderator_note text,
  game_id uuid references public.games (id) on delete set null,
  moderated_by uuid references public.profiles (id) on delete set null,
  moderated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint submissions_title_length check (char_length(btrim(title)) between 1 and 120),
  constraint submissions_year_range check (release_year is null or release_year between 1950 and 2100),
  constraint submissions_ratings_valid check (public.valid_game_ratings(ratings)),
  constraint submissions_review_length check (char_length(review) <= 8000),
  constraint submissions_playtime_nonnegative check (playtime_hours is null or playtime_hours >= 0),
  constraint submissions_image_belongs_to_user check (split_part(image_path, '/', 1) = user_id::text)
);

create index user_games_user_id_created_at_idx on public.user_games (user_id, created_at desc);
create index game_submissions_user_id_created_at_idx on public.game_submissions (user_id, created_at desc);
create index game_submissions_pending_created_at_idx on public.game_submissions (created_at) where status = 'pending';

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_moderator
  );
$$;

revoke all on function public.is_moderator() from public;
grant execute on function public.is_moderator() to anon, authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := coalesce(new.raw_user_meta_data ->> 'username', '');
  requested_display_name := coalesce(new.raw_user_meta_data ->> 'display_name', requested_username);

  insert into public.profiles (id, username, display_name)
  values (new.id, lower(requested_username), requested_display_name);

  return new;
end;
$$;

create trigger on_auth_user_created_create_profile
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

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

  insert into public.games (title, developer, release_year, genres, image_path)
  values (submission.title, submission.developer, submission.release_year, submission.genres, submission.image_path)
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

create or replace function public.reject_game_submission(p_submission_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'Недостаточно прав для модерации.' using errcode = '42501';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'Укажите причину отклонения.' using errcode = '22023';
  end if;

  update public.game_submissions
  set status = 'rejected', moderator_note = left(btrim(p_note), 1000),
      moderated_by = (select auth.uid()), moderated_at = now()
  where id = p_submission_id and status = 'pending';

  if not found then
    raise exception 'Ожидающая заявка не найдена.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.approve_game_submission(uuid) from public;
revoke all on function public.reject_game_submission(uuid, text) from public;
grant execute on function public.approve_game_submission(uuid) to authenticated;
grant execute on function public.reject_game_submission(uuid, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.user_games enable row level security;
alter table public.game_submissions enable row level security;

revoke all on public.profiles, public.games, public.user_games, public.game_submissions from anon, authenticated;
grant select on public.profiles, public.games, public.user_games to anon, authenticated;
grant insert on public.game_submissions to authenticated;
grant select on public.game_submissions to authenticated;
grant update (username, display_name) on public.profiles to authenticated;

create policy "Profiles are publicly viewable"
  on public.profiles for select to anon, authenticated using (true);
create policy "Users can update their own public name"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Approved catalog is publicly viewable"
  on public.games for select to anon, authenticated using (true);
create policy "Public libraries are viewable"
  on public.user_games for select to anon, authenticated
  using (
    (select auth.uid()) = user_id
    or exists (select 1 from public.profiles p where p.id = user_id and p.is_public)
  );
create policy "Users can view their own submissions and moderators can view all"
  on public.game_submissions for select to authenticated
  using ((select auth.uid()) = user_id or (select public.is_moderator()));
create policy "Users can submit pending games for themselves"
  on public.game_submissions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and game_id is null
    and moderated_by is null
    and moderated_at is null
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-covers', 'game-covers', false, 409600, array['image/webp'])
on conflict (id) do update
set public = false, file_size_limit = 409600, allowed_mime_types = array['image/webp'];

create policy "Users upload covers into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'game-covers' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Owners and moderators can inspect pending covers; approved covers are readable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'game-covers'
    and (
      exists (
        select 1 from public.games g where g.image_path = name
      )
      or (
        (select auth.uid()) is not null
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
      or (select public.is_moderator())
    )
  );
create policy "Owners can remove their own unreferenced covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'game-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (select 1 from public.games g where g.image_path = name)
    and not exists (select 1 from public.game_submissions s where s.image_path = name)
  );

