-- Migration 020: связывание существующих карточек со справочником, заглушки для
-- игр вне data/games.json и поиск только по названию игры.
-- Применить после 202611050001_game_catalog.sql.
--
-- Порядок для существующего проекта:
--   1) 202611050001 (таблица, catalog_id, бэкфилл);
--   2) 202611060001 (эта миграция);
--   3) загрузка data/games.json (npm run import:games).
-- Импортёр в конце сам вызывает relink_games_to_catalog().

alter table public.game_catalog
  add column if not exists source text not null default 'json',
  add column if not exists is_stub boolean not null default false;

-- Записи без slug создала миграция 018 из старых карточек: это заглушки, а не
-- данные из JSON. Импорт из JSON позже «повысит» их до обычных записей.
update public.game_catalog
set source = 'card', is_stub = true
where slug is null
  and source = 'json'
  and is_stub = false;

-- Поиск для автокомплита: совпадение только по началу слов названия игры (студия
-- не участвует), заглушки в подсказки не попадают — добавить можно только игру,
-- которая явно есть в справочнике.
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

-- Связывает все карточки (и ожидающие заявки) с играми справочника.
-- Совпадение — по названию без учёта регистра; при нескольких вариантах
-- предпочитается запись из JSON, затем точный год, затем ближайший год.
-- Если игры нет в справочнике, создаётся заглушка из данных карточки
-- (source = 'card', is_stub = true), чтобы карточка не осталась без привязки.
create or replace function public.relink_games_to_catalog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  card record;
  submission record;
  target_id uuid;
  v_title_key text;
  v_genres text[];
  v_cards integer := 0;
  v_cards_failed integer := 0;
  v_submissions integer := 0;
  v_submissions_failed integer := 0;
  v_stubs integer := 0;
  canonical_genres constant text[] := array[
    'РПГ', 'Экшен', 'Инди', 'Хоррор', 'Приключение', 'Шутер', 'Платформер',
    'Сюжетная', 'Кооператив', 'Головоломка', 'Фэнтези', 'Открытый мир', 'Стелс',
    'Соулс-лайк', 'Киберпанк', 'Выживание', 'Карточная', 'Метроидвания', 'QTE',
    'Научная фантастика', 'Постапокалипсис', 'Интерактивное кино'
  ];
begin
  for card in select * from public.games order by created_at
  loop
    v_title_key := translate(lower(regexp_replace(btrim(card.title), '\s+', ' ', 'g')), 'ё', 'е');

    select catalog.id into target_id
    from public.game_catalog as catalog
    where catalog.title_key = v_title_key
    order by
      (not catalog.is_stub) desc,
      (catalog.release_year_key = coalesce(card.release_year, 0)) desc,
      abs(coalesce(catalog.release_year, 0) - coalesce(card.release_year, 0)) asc,
      catalog.release_year desc nulls last,
      catalog.created_at asc
    limit 1;

    if target_id is null then
      v_genres := coalesce((
        select array_agg(distinct genre_label)
        from unnest(coalesce(card.genres, '{}'::text[])) as genre_label
        where genre_label = any (canonical_genres)
      ), '{}'::text[]);

      insert into public.game_catalog (title, studio, release_year, genres, source, is_stub)
      values (btrim(card.title), coalesce(card.developer, ''), card.release_year, v_genres, 'card', true)
      returning id into target_id;
      v_stubs := v_stubs + 1;
    end if;

    -- UPDATE с catalog_id в SET всегда запускает триггер, поэтому метаданные
    -- карточки синхронизируются с выбранной записью справочника.
    begin
      update public.games set catalog_id = target_id where id = card.id;
      v_cards := v_cards + 1;
    exception when unique_violation then
      v_cards_failed := v_cards_failed + 1;
    end;
  end loop;

  for submission in select * from public.game_submissions where status = 'pending'
  loop
    v_title_key := translate(lower(regexp_replace(btrim(submission.title), '\s+', ' ', 'g')), 'ё', 'е');

    select catalog.id into target_id
    from public.game_catalog as catalog
    where catalog.title_key = v_title_key
    order by
      (not catalog.is_stub) desc,
      (catalog.release_year_key = coalesce(submission.release_year, 0)) desc,
      abs(coalesce(catalog.release_year, 0) - coalesce(submission.release_year, 0)) asc,
      catalog.release_year desc nulls last,
      catalog.created_at asc
    limit 1;

    if target_id is null then
      v_genres := coalesce((
        select array_agg(distinct genre_label)
        from unnest(coalesce(submission.genres, '{}'::text[])) as genre_label
        where genre_label = any (canonical_genres)
      ), '{}'::text[]);

      insert into public.game_catalog (title, studio, release_year, genres, source, is_stub)
      values (btrim(submission.title), coalesce(submission.developer, ''), submission.release_year, v_genres, 'card', true)
      returning id into target_id;
      v_stubs := v_stubs + 1;
    end if;

    begin
      update public.game_submissions set catalog_id = target_id where id = submission.id;
      v_submissions := v_submissions + 1;
    exception when others then
      v_submissions_failed := v_submissions_failed + 1;
    end;
  end loop;

  return jsonb_build_object(
    'cards', v_cards,
    'cards_failed', v_cards_failed,
    'submissions', v_submissions,
    'submissions_failed', v_submissions_failed,
    'stubs', v_stubs
  );
end;
$$;

revoke all on function public.relink_games_to_catalog() from public;
revoke all on function public.relink_games_to_catalog() from anon, authenticated;
grant execute on function public.relink_games_to_catalog() to service_role;

-- Импорт из JSON теперь снимает признак заглушки с совпавшей записи.
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
          genres = v_genres,
          source = 'json',
          is_stub = false
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
