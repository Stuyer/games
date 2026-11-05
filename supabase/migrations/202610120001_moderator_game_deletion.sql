-- Allow moderators to permanently remove an approved catalog game.
-- Apply after migrations 001 and 002.

alter table public.user_games
  drop constraint if exists user_games_game_id_fkey;

alter table public.user_games
  add constraint user_games_game_id_fkey
  foreign key (game_id) references public.games (id) on delete cascade;

create or replace function public.delete_catalog_game(p_title text, p_confirmation text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_game public.games%rowtype;
begin
  if not public.is_moderator() then
    raise exception 'Удалять игры из каталога может только модератор.' using errcode = '42501';
  end if;

  select * into target_game
  from public.games
  where title = p_title
  for update;

  if not found then
    raise exception 'Игра с таким точным названием не найдена.' using errcode = 'P0002';
  end if;
  if p_confirmation is distinct from target_game.title then
    raise exception 'Подтверждение названия не совпадает.' using errcode = '22023';
  end if;

  delete from public.games where id = target_game.id;
  return target_game.image_path;
end;
$$;

revoke all on function public.delete_catalog_game(text, text) from public;
grant execute on function public.delete_catalog_game(text, text) to authenticated;

create policy "Moderators can remove unused catalog covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'game-covers'
    and (select public.is_moderator())
    and not exists (
      select 1 from public.games g where g.image_path = name
    )
    and not exists (
      select 1 from public.game_submissions s
      where s.image_path = name and s.status = 'pending'
    )
  );
