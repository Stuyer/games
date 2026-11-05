-- Migration 012: Store game playtime as whole hours.
-- Apply after 202610120011_edit_games_and_submissions.sql.

alter table public.games
  alter column playtime_hours type integer
  using (round(playtime_hours)::integer);

alter table public.user_games
  alter column playtime_hours type integer
  using (round(playtime_hours)::integer);

alter table public.game_submissions
  alter column playtime_hours type integer
  using (round(playtime_hours)::integer);
