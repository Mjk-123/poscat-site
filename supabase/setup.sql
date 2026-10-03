-- Shared leaderboard for the POSCAT arcade.
-- Run once in Supabase: Dashboard → SQL Editor → paste → Run.
--
-- The page never touches the table directly. It can only call two functions:
--   top_scores(game, limit)  → name, score, won, at, tag (no ids exposed)
--   submit_score(id, game, name, score, won) → rank
-- A round's random id is the only way to update that round's row, and ids are
-- never returned, so players can't overwrite each other's scores.

create table if not exists public.scores (
  id          uuid primary key,
  game        text        not null check (char_length(game) between 1 and 32),
  name        text        not null check (char_length(name) between 1 and 16),
  score       integer     not null check (score between 0 and 1000000),
  won         boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists scores_rank on public.scores (game, score desc, updated_at);

alter table public.scores enable row level security;  -- no policies: no direct access
revoke all on public.scores from anon, authenticated;

create or replace function public.top_scores(p_game text, p_limit int default 5)
returns table (name text, score int, won boolean, at timestamptz, tag text)
language sql stable security definer set search_path = public as $$
  select s.name, s.score, s.won, s.updated_at,
         left(encode(sha256(convert_to(s.id::text, 'UTF8')), 'hex'), 16)
  from scores s
  where s.game = p_game
  order by s.score desc, s.updated_at asc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.submit_score(p_id uuid, p_game text, p_name text, p_score int, p_won boolean)
returns int
language plpgsql security definer set search_path = public as $$
declare
  me scores;
  r  int;
begin
  p_name := btrim(p_name);
  if char_length(p_name) not between 1 and 16 then raise exception 'name must be 1-16 characters'; end if;
  if p_score not between 0 and 1000000 then raise exception 'score out of range'; end if;

  insert into scores (id, game, name, score, won)
  values (p_id, p_game, p_name, p_score, coalesce(p_won, false))
  on conflict (id) do update
    set name       = excluded.name,
        won        = scores.won or excluded.won,
        score      = greatest(scores.score, excluded.score),
        updated_at = case when excluded.score > scores.score then now() else scores.updated_at end
    where scores.game = excluded.game;

  select * into me from scores where id = p_id;
  select count(*) + 1 into r from scores s
   where s.game = me.game
     and (s.score > me.score or (s.score = me.score and s.updated_at < me.updated_at));
  return r;
end $$;

-- needed when "Automatically expose new tables" is off
grant usage on schema public to anon, authenticated;

revoke execute on function public.top_scores(text, int) from public;
revoke execute on function public.submit_score(uuid, text, text, int, boolean) from public;
grant execute on function public.top_scores(text, int) to anon, authenticated;
grant execute on function public.submit_score(uuid, text, text, int, boolean) to anon, authenticated;
