-- Migration 019: общий справочник игр (game_catalog) и карточки, привязанные к нему.
-- Применить после 202610300001_user_submission_management.sql.
--
-- Идея:
--   * public.game_catalog — единый справочник названий, студий, годов и жанров.
--     Наполняется из data/games.json скриптом `npm run import:games`.
--   * public.games остаётся личной карточкой пользователя (оценки, обзор, время,
--     обложка, позиции фона), но получает catalog_id и больше не может содержать
--     произвольное название: метаданные всегда копируются из справочника.
--   * public.game_submissions тоже ссылается на игру справочника, поэтому
--     модератор не может одобрить карточку с выдуманными названием/годом/жанрами.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.game_catalog (
  id uuid primary key default extensions.gen_random_uuid(),
  slug text,
  title text not null,
  title_key text generated always as (
    translate(lower(regexp_replace(btrim(title), '\s+', ' ', 'g')), 'ё', 'е')
  ) stored,
  studio text not null default '',
  release_year integer,
  release_year_key integer generated always as (coalesce(release_year, 0)) stored,
  genres text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_catalog_title_length check (char_length(btrim(title)) between 1 and 160),
  constraint game_catalog_year_range check (release_year is null or release_year between 1950 and 2100),
  constraint game_catalog_slug_format check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{0,119}$'),
  constraint game_catalog_genres_canonical check (
    genres <@ array[
      'РПГ', 'Экшен', 'Инди', 'Хоррор', 'Приключение', 'Шутер', 'Платформер',
      'Сюжетная', 'Кооператив', 'Головоломка', 'Фэнтези', 'Открытый мир', 'Стелс',
      'Соулс-лайк', 'Киберпанк', 'Выживание', 'Карточная', 'Метроидвания', 'QTE',
      'Научная фантастика', 'Постапокалипсис', 'Интерактивное кино'
    ]::text[]
  )
);

create unique index if not exists game_catalog_title_identity_idx
  on public.game_catalog (title_key, release_year_key);
-- ON CONFLICT (slug) требует ограничения таблицы, а не частичного индекса:
-- по нему импортёр обновляет записи.
alter table public.game_catalog
  add constraint game_catalog_slug_key unique (slug);
create index if not exists game_catalog_title_trgm_idx
  on public.game_catalog using gin (title_key extensions.gin_trgm_ops);
create index if not exists game_catalog_studio_trgm_idx
  on public.game_catalog using gin (translate(lower(studio), 'ё', 'е') extensions.gin_trgm_ops);
create index if not exists game_catalog_genres_idx
  on public.game_catalog using gin (genres);

create or replace function public.touch_game_catalog_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists game_catalog_touch_updated_at on public.game_catalog;
create trigger game_catalog_touch_updated_at
  before update on public.game_catalog
  for each row execute function public.touch_game_catalog_updated_at();

alter table public.game_catalog enable row level security;

revoke all on public.game_catalog from anon, authenticated;
grant select on public.game_catalog to anon, authenticated;
grant select on public.game_catalog to service_role;

drop policy if exists "Game catalog is publicly readable" on public.game_catalog;
create policy "Game catalog is publicly readable"
  on public.game_catalog for select to anon, authenticated
  using (true);

-- Поиск для автокомплита. Намеренно не использует LIKE: position() не требует
-- экранирования % и _, а pg_trgm-индекс помогает сортировке по similarity.
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
    select translate(lower(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g')), 'ё', 'е') as term
  )
  select catalog.id, catalog.title, catalog.studio, catalog.release_year, catalog.genres
  from public.game_catalog as catalog, search_query
  where char_length(search_query.term) >= 2
    and (
      position(search_query.term in catalog.title_key) > 0
      or position(search_query.term in translate(lower(catalog.studio), 'ё', 'е')) > 0
    )
  order by
    case
      when catalog.title_key = search_query.term then 0
      when position(search_query.term in catalog.title_key) = 1 then 1
      when position(search_query.term in catalog.title_key) > 0 then 2
      else 3
    end,
    extensions.similarity(catalog.title_key, search_query.term) desc,
    catalog.release_year desc nulls last,
    catalog.title asc
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

revoke all on function public.search_game_catalog(text, integer) from public;
grant execute on function public.search_game_catalog(text, integer) to anon, authenticated;

-- Пакетный импорт справочника. Вызывается только service_role из
-- scripts/import-games.mjs: браузерный ключ этот RPC вызвать не может.
create or replace function public.import_game_catalog(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  v_slug text;
  v_title text;
  v_studio text;
  v_year integer;
  v_genres text[];
  v_title_key text;
  v_existing uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  for item in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_title := btrim(coalesce(item ->> 'title', ''));
    v_slug := nullif(lower(btrim(coalesce(item ->> 'slug', ''))), '');
    v_studio := btrim(coalesce(item ->> 'studio', ''));
    v_year := case
      when jsonb_typeof(item -> 'release_year') = 'number' then (item ->> 'release_year')::integer
      else null
    end;
    select coalesce(array_agg(genres_source.value), '{}'::text[])
      into v_genres
      from jsonb_array_elements_text(coalesce(item -> 'genres', '[]'::jsonb)) as genres_source(value);

    if v_title = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_title_key := translate(lower(regexp_replace(v_title, '\s+', ' ', 'g')), 'ё', 'е');

    v_existing := null;
    if v_slug is not null then
      select id into v_existing from public.game_catalog where slug = v_slug;
    end if;
    if v_existing is null then
      select id into v_existing
      from public.game_catalog
      where title_key = v_title_key and release_year_key = coalesce(v_year, 0);
    end if;

    if v_existing is null then
      insert into public.game_catalog (slug, title, studio, release_year, genres)
      values (v_slug, v_title, v_studio, v_year, v_genres);
      v_inserted := v_inserted + 1;
    else
      update public.game_catalog
      set slug = coalesce(v_slug, slug),
          title = v_title,
          studio = v_studio,
          release_year = v_year,
          genres = v_genres
      where id = v_existing;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

revoke all on function public.import_game_catalog(jsonb) from public;
revoke all on function public.import_game_catalog(jsonb) from anon, authenticated;
grant execute on function public.import_game_catalog(jsonb) to service_role;

-- Карточки и заявки ссылаются на справочник.
alter table public.games
  add column if not exists catalog_id uuid;
alter table public.games
  drop constraint if exists games_catalog_id_fkey;
alter table public.games
  add constraint games_catalog_id_fkey
  foreign key (catalog_id) references public.game_catalog (id) on delete restrict;

alter table public.game_submissions
  add column if not exists catalog_id uuid;
alter table public.game_submissions
  drop constraint if exists game_submissions_catalog_id_fkey;
alter table public.game_submissions
  add constraint game_submissions_catalog_id_fkey
  foreign key (catalog_id) references public.game_catalog (id) on delete restrict;

create index if not exists games_catalog_id_idx on public.games (catalog_id);
create index if not exists game_submissions_catalog_id_idx on public.game_submissions (catalog_id);

-- Переносим уже существующие карточки в справочник: по одной записи на
-- уникальную пару «название + год». Идентификаторы генерируются, потому что
-- у старых карточек не было стабильного slug; при следующем импорте JSON
-- такие записи обновятся по названию и году.
insert into public.game_catalog (title, studio, release_year, genres)
select distinct on (games.title_key, coalesce(games.release_year, 0))
  btrim(games.title),
  coalesce(btrim(games.developer), ''),
  games.release_year,
  coalesce((
    select array_agg(distinct genre_label)
    from unnest(coalesce(games.genres, '{}'::text[])) as genre_label
    where genre_label = any (array[
      'РПГ', 'Экшен', 'Инди', 'Хоррор', 'Приключение', 'Шутер', 'Платформер',
      'Сюжетная', 'Кооператив', 'Головоломка', 'Фэнтези', 'Открытый мир', 'Стелс',
      'Соулс-лайк', 'Киберпанк', 'Выживание', 'Карточная', 'Метроидвания', 'QTE',
      'Научная фантастика', 'Постапокалипсис', 'Интерактивное кино'
    ]::text[])
  ), '{}'::text[])
from public.games as games
order by games.title_key, coalesce(games.release_year, 0), games.created_at asc
on conflict do nothing;

update public.games as games
set catalog_id = catalog.id
from public.game_catalog as catalog
where games.catalog_id is null
  and catalog.title_key = translate(games.title_key, 'ё', 'е')
  and catalog.release_year_key = coalesce(games.release_year, 0);

-- Ожидающие заявки тоже привязываем к справочнику, чтобы модератор мог их
-- одобрить сразу после миграции. Если название не нашлось, заявку нужно
-- отклонить: автор выберет игру из каталога при повторной отправке.
update public.game_submissions as submissions
set catalog_id = catalog.id
from public.game_catalog as catalog
where submissions.catalog_id is null
  and catalog.title_key = translate(lower(regexp_replace(btrim(submissions.title), '\s+', ' ', 'g')), 'ё', 'е')
  and catalog.release_year_key = coalesce(submissions.release_year, 0);

-- После переноса у каждой карточки есть игра справочника. Новые карточки без
-- catalog_id больше не создаются: это и есть «добавление только через автокомплит».
alter table public.games
  alter column catalog_id set not null;

-- Метаданные карточки всегда берутся из справочника, что бы ни прислал клиент.
create or replace function public.apply_game_catalog_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  catalog public.game_catalog%rowtype;
begin
  if new.catalog_id is null then
    raise exception 'Выберите игру из каталога: свободное название добавить нельзя.' using errcode = '22023';
  end if;

  select * into catalog from public.game_catalog where id = new.catalog_id;
  if not found then
    raise exception 'Игра не найдена в каталоге.' using errcode = 'P0002';
  end if;

  new.title := catalog.title;
  new.developer := catalog.studio;
  new.release_year := catalog.release_year;
  new.genres := catalog.genres;
  return new;
end;
$$;

drop trigger if exists games_apply_catalog_metadata on public.games;
create trigger games_apply_catalog_metadata
  before insert or update of catalog_id, title, developer, release_year, genres on public.games
  for each row execute function public.apply_game_catalog_metadata();

-- Заявка тоже хранит канонические метаданные: модератор видит в очереди ровно
-- то, что лежит в справочнике. Для старых заявок без catalog_id пытаемся найти
-- игру по названию и году; если не вышло — просим выбрать игру заново.
create or replace function public.apply_submission_catalog_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  catalog public.game_catalog%rowtype;
  resolved_catalog_id uuid;
begin
  if new.catalog_id is null then
    select id into resolved_catalog_id
    from public.game_catalog
    where title_key = translate(lower(regexp_replace(btrim(new.title), '\s+', ' ', 'g')), 'ё', 'е')
      and release_year_key = coalesce(new.release_year, 0)
    limit 1;
    new.catalog_id := resolved_catalog_id;
  end if;

  if new.catalog_id is null then
    raise exception 'Выберите игру из каталога: свободное название добавить нельзя.' using errcode = '22023';
  end if;

  select * into catalog from public.game_catalog where id = new.catalog_id;
  if not found then
    raise exception 'Игра не найдена в каталоге.' using errcode = 'P0002';
  end if;

  new.title := catalog.title;
  new.developer := catalog.studio;
  new.release_year := catalog.release_year;
  new.genres := catalog.genres;
  return new;
end;
$$;

drop trigger if exists a_apply_submission_catalog_metadata on public.game_submissions;
create trigger a_apply_submission_catalog_metadata
  before insert or update of catalog_id, title, developer, release_year, genres on public.game_submissions
  for each row execute function public.apply_submission_catalog_metadata();

-- Одобрение заявки: метаданные копируются из справочника, каталог не меняется.
create or replace function public.approve_game_submission(p_submission_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission public.game_submissions%rowtype;
  catalog public.game_catalog%rowtype;
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
  if submission.catalog_id is null then
    raise exception 'В заявке не выбрана игра из каталога.' using errcode = '22023';
  end if;

  select * into catalog from public.game_catalog where id = submission.catalog_id;
  if not found then
    raise exception 'Игра не найдена в каталоге.' using errcode = 'P0002';
  end if;

  if submission.game_id is not null then
    update public.games
    set catalog_id = catalog.id,
        title = catalog.title,
        developer = catalog.studio,
        release_year = catalog.release_year,
        genres = catalog.genres,
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
      select 1
      from public.games
      where owner_id = submission.user_id
        and (catalog_id = catalog.id or title_key = catalog.title_key)
    ) then
      raise exception 'Такая игра уже есть в каталоге пользователя.' using errcode = '23505';
    end if;

    insert into public.games (
      id, catalog_id, title, developer, release_year, genres, image_path, ratings, review, playtime_hours,
      owner_id, background_position_list_x, background_position_list_y, background_scale_list,
      background_position_grid_x, background_position_grid_y, background_scale_grid
    ) values (
      submission.id, catalog.id, catalog.title, catalog.studio, catalog.release_year, catalog.genres,
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

-- Прямая запись модератора тоже возможна только с игрой из справочника.
drop policy if exists "Moderators can add games directly to the approved catalog" on public.games;
create policy "Moderators can add games directly to the approved catalog"
  on public.games for insert to authenticated
  with check (
    (select public.is_moderator())
    and owner_id = (select auth.uid())
    and catalog_id is not null
    and split_part(image_path, '/', 1) = (select auth.uid())::text
  );

-- Повторная отправка отклонённой заявки обновляет в том числе catalog_id.
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
  background_scale_grid,
  status,
  moderator_note,
  moderated_by,
  moderated_at
) on public.game_submissions to authenticated;

drop policy if exists "Users can submit pending games for themselves" on public.game_submissions;
create policy "Users can submit pending games for themselves"
  on public.game_submissions for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and catalog_id is not null
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
