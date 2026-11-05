-- Prevent simultaneous or repeated pending submissions for the same game title.
-- Apply after migrations 001 through 004.

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
  perform pg_advisory_xact_lock(hashtextextended(normalized_title, 0));

  if exists (
    select 1
    from public.game_submissions submissions
    where submissions.status = 'pending'
      and submissions.id is distinct from new.id
      and lower(regexp_replace(btrim(submissions.title), '\s+', ' ', 'g')) = normalized_title
  ) then
    raise exception 'Заявка на игру с таким названием уже ожидает проверки.' using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_duplicate_pending_game_submission() from public;

drop trigger if exists prevent_duplicate_pending_game_submission on public.game_submissions;
create trigger prevent_duplicate_pending_game_submission
  before insert or update of title, status on public.game_submissions
  for each row execute function public.prevent_duplicate_pending_game_submission();
