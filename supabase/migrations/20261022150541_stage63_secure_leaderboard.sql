create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create table if not exists private.leaderboard_entries (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  score bigint not null,
  lines integer not null,
  level integer not null,
  created_at timestamptz not null
);

revoke all on private.leaderboard_entries from public, anon, authenticated;
grant select on private.leaderboard_entries to anon, authenticated;
grant all on private.leaderboard_entries to service_role;

insert into private.leaderboard_entries (user_id, display_name, score, lines, level, created_at)
select distinct on (scores.user_id)
  scores.user_id,
  profiles.display_name,
  scores.score,
  scores.lines,
  scores.level,
  scores.created_at
from public.game_scores as scores
join public.profiles as profiles on profiles.id = scores.user_id
order by scores.user_id, scores.score desc, scores.created_at
on conflict (user_id) do update set
  display_name = excluded.display_name,
  score = excluded.score,
  lines = excluded.lines,
  level = excluded.level,
  created_at = excluded.created_at;

create or replace function private.sync_leaderboard_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.leaderboard_entries (user_id, display_name, score, lines, level, created_at)
  select new.user_id, profiles.display_name, new.score, new.lines, new.level, new.created_at
  from public.profiles as profiles
  where profiles.id = new.user_id
  on conflict (user_id) do update set
    display_name = excluded.display_name,
    score = excluded.score,
    lines = excluded.lines,
    level = excluded.level,
    created_at = excluded.created_at
  where excluded.score > private.leaderboard_entries.score
    or (
      excluded.score = private.leaderboard_entries.score
      and excluded.created_at < private.leaderboard_entries.created_at
    );
  return new;
end
$$;

create or replace function private.sync_leaderboard_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.leaderboard_entries
  set display_name = new.display_name
  where user_id = new.id;

  if not found then
    insert into private.leaderboard_entries (user_id, display_name, score, lines, level, created_at)
    select new.id, new.display_name, scores.score, scores.lines, scores.level, scores.created_at
    from public.game_scores as scores
    where scores.user_id = new.id
    order by scores.score desc, scores.created_at
    limit 1
    on conflict (user_id) do update set display_name = excluded.display_name;
  end if;
  return new;
end
$$;

revoke all on function private.sync_leaderboard_score() from public, anon, authenticated, service_role;
revoke all on function private.sync_leaderboard_profile() from public, anon, authenticated, service_role;

drop trigger if exists game_scores_sync_leaderboard on public.game_scores;
create trigger game_scores_sync_leaderboard
after insert on public.game_scores
for each row execute function private.sync_leaderboard_score();

drop trigger if exists profiles_sync_leaderboard on public.profiles;
create trigger profiles_sync_leaderboard
after insert or update of display_name on public.profiles
for each row execute function private.sync_leaderboard_profile();

create or replace view public.leaderboard
with (security_invoker = true, security_barrier = true)
as
select display_name, score, lines, level, created_at
from private.leaderboard_entries
order by score desc, created_at
limit 100;

revoke all on public.leaderboard from public, anon, authenticated;
grant select on public.leaderboard to anon, authenticated, service_role;
