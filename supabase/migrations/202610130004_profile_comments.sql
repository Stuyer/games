-- Migration 015: comments on public profiles with author/moderator deletion rules.

create table if not exists public.profile_comments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint profile_comments_body_length
    check (char_length(btrim(body)) between 1 and 1000)
);

create index if not exists profile_comments_profile_created_at_idx
  on public.profile_comments (profile_id, created_at desc);

alter table public.profile_comments enable row level security;

revoke all on public.profile_comments from anon, authenticated;
grant select on public.profile_comments to anon, authenticated;
grant insert, delete on public.profile_comments to authenticated;

drop policy if exists "Users can view comments on accessible profiles" on public.profile_comments;
create policy "Users can view comments on accessible profiles"
  on public.profile_comments for select to anon, authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1
      from public.profiles p
      where p.id = profile_id
        and p.is_public
    )
    or (select public.is_moderator())
  );

drop policy if exists "Users can comment on accessible profiles" on public.profile_comments;
create policy "Users can comment on accessible profiles"
  on public.profile_comments for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      profile_id = (select auth.uid())
      or exists (
        select 1
        from public.profiles p
        where p.id = profile_id
          and p.is_public
      )
      or (select public.is_moderator())
    )
  );

drop policy if exists "Authors and moderators can delete profile comments" on public.profile_comments;
create policy "Authors and moderators can delete profile comments"
  on public.profile_comments for delete to authenticated
  using (
    author_id = (select auth.uid())
    or (select public.is_moderator())
  );
