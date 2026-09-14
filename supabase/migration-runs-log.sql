-- Migration: the runs log - one row per finished draft or DNF, forever - plus the functions the
-- Stats screen reads. Run this in the SQL editor BEFORE deploying the submit-run Edge Function
-- that writes to it, and before shipping the client that reads it. Staging first, then production.
-- Safe to re-run: every object is create-if-missing / create-or-replace, and the backfill skips
-- runs that are already logged.
--
-- Why this exists: profiles.recent keeps only each account's last 10 runs, and the Stats screen
-- used to aggregate over the 300 most recently active profiles in the browser. Both silently
-- dropped history. Career counters (wins, champs, ...) were always complete on profiles; what was
-- lost was anything per-run - most-drafted players, GM-mode scores, position records.
--
-- Backward-compatible with the currently-deployed Edge Function and client: this only adds objects.
--
-- Revisions - this file stays the single definition of the Stats functions, so a change to them is
-- an edit here plus re-running the whole file (the backfill is a no-op the second time):
--   1.6.0  site_stats returns biggest_upsets instead of pos_records. A client older than 1.6.0 shows
--          its position-records section empty until the 1.6.0 client ships a few minutes later.

create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- A snapshot, so a leaderboard never needs a join. Usernames can't be changed in the app.
  username    text not null,
  -- The run's own timestamp (run.date), not the insert time - that is what makes the backfill and
  -- a live insert of the same run collide on the unique key below instead of duplicating.
  created_at  timestamptz not null default now(),
  -- Which points ladder the run belongs to: daily | unlimited | genius | gm (game-logic's modeKey).
  ladder      text not null check (ladder in ('daily', 'unlimited', 'genius', 'gm')),
  daily_date  text,
  -- Null only for a DNF, which is abandoned before a format matters to anything we record.
  format      text check (format in ('fantasy', 'standard')),
  gm          boolean not null default false,
  genius      boolean not null default false,
  dnf         boolean not null default false,
  picks       integer,
  w           integer,
  l           integer,
  score       numeric,
  champ       boolean,
  perfect     boolean,
  playoffs    boolean,
  outcome     text,
  par         numeric,
  points      numeric,
  cap_used    numeric,
  code        text,
  -- [{slot, name, team, season, ppr, rating}] - exactly run.roster as submit-run builds it.
  roster      jsonb,
  -- True for rows recovered from profiles.recent / best runs when this table was created.
  backfilled  boolean not null default false
);
create unique index if not exists runs_user_time_uidx on public.runs (user_id, created_at, dnf);
create index if not exists runs_created_idx on public.runs (created_at desc);
create index if not exists runs_format_score_idx on public.runs (format, score desc) where not dnf;
-- Title-winning runs by lowest score first: the "biggest upset" board.
create index if not exists runs_champ_score_idx on public.runs (format, score) where champ;

alter table public.runs enable row level security;
drop policy if exists "runs are publicly readable" on public.runs;
create policy "runs are publicly readable" on public.runs for select using (true);
-- No insert/update/delete policy: like profiles, only submit-run's service-role client writes here.

-- ---------- Backfill ----------
-- Everything each account still has: its last 10 runs (profiles.recent) plus its best run in each
-- format, which may be older than those 10. A best run that is also in recent carries the same
-- date, so the unique key drops the duplicate. Runs saved before format/gm/genius tags existed read
-- as fantasy and not-GM, the same way the app has always treated them.
with src as (
  select p.id, p.username, p.updated_at, e as run, null::text as forced_format
    from public.profiles p
    cross join lateral jsonb_array_elements(case when jsonb_typeof(p.recent) = 'array' then p.recent else '[]'::jsonb end) e
  union all
  select p.id, p.username, p.updated_at, p.best_run, 'fantasy' from public.profiles p where jsonb_typeof(p.best_run) = 'object'
  union all
  select p.id, p.username, p.updated_at, p.best_run_std, 'standard' from public.profiles p where jsonb_typeof(p.best_run_std) = 'object'
)
insert into public.runs (user_id, username, created_at, ladder, daily_date, format, gm, genius, dnf, picks,
                         w, l, score, champ, perfect, playoffs, outcome, par, points, cap_used, code, roster, backfilled)
select
  id, username,
  case when jsonb_typeof(run->'date') = 'number' then to_timestamp((run->>'date')::double precision / 1000) else updated_at end,
  case
    when coalesce((run->>'dnf')::boolean, false) then
      case when run->>'mode' in ('daily', 'unlimited', 'genius', 'gm') then run->>'mode' else 'unlimited' end
    when run->>'mode' = 'daily' then 'daily'
    when coalesce((run->>'gm')::boolean, false) then 'gm'
    when coalesce((run->>'genius')::boolean, false) then 'genius'
    else 'unlimited'
  end,
  null,
  case when coalesce((run->>'dnf')::boolean, false) then null
       else coalesce(forced_format, case when run->>'format' = 'standard' then 'standard' else 'fantasy' end) end,
  coalesce((run->>'gm')::boolean, false),
  coalesce((run->>'genius')::boolean, false),
  coalesce((run->>'dnf')::boolean, false),
  (run->>'picks')::integer,
  (run->>'w')::integer, (run->>'l')::integer, (run->>'score')::numeric,
  (run->>'champ')::boolean, (run->>'perfect')::boolean, (run->>'playoffs')::boolean,
  run->>'outcome', (run->>'par')::numeric, (run->>'points')::numeric, (run->>'capUsed')::numeric, run->>'code',
  case when jsonb_typeof(run->'roster') = 'array' then run->'roster' end,
  true
from src
on conflict (user_id, created_at, dnf) do nothing;

-- ---------- Reads ----------
-- Both functions are security invoker over publicly readable tables, so they expose nothing a
-- direct select couldn't. They exist so the aggregation runs next to the data instead of shipping
-- whole tables to the browser. tests/helpers.mjs mirrors both, and tests/test-runs-sql.mjs checks
-- that the mirror and this SQL return identical results.

-- The three sitewide numbers on the home screen, Leaderboard and Stats. Summed from profiles, whose
-- counters have always been complete (the runs log starts partway through the site's history).
create or replace function public.site_totals()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'players', count(*),
    'runs', coalesce(sum(runs + dnf), 0),
    'perfect', coalesce(sum(perfect), 0)
  ) from profiles;
$$;

-- The fields a Stats board shows for an account - career counters only, so a board of ten rows
-- doesn't carry ten best-run rosters. Takes jsonb so it accepts any row shape built on profiles.
create or replace function public.stats_card(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'id', p->'id', 'username', p->'username', 'runs', p->'runs', 'dnf', p->'dnf',
    'wins', p->'wins', 'losses', p->'losses', 'champs', p->'champs', 'perfect', p->'perfect',
    'playoffs', p->'playoffs', 'daily_best_streak', p->'daily_best_streak'
  );
$$;

-- Every Stats-screen board in one round trip. Every order has a final tiebreak, so results are
-- deterministic.
create or replace function public.site_stats(p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  played as (select * from profiles where runs + dnf > 0),
  entries as (
    select r.username, r.format, e as entry
      from runs r
      cross join lateral jsonb_array_elements(case when jsonb_typeof(r.roster) = 'array' then r.roster else '[]'::jsonb end) e
     where not r.dnf
  ),
  fmt(format) as (values ('fantasy'), ('standard'))
  select jsonb_build_object(
    'totals', site_totals(),
    'by_format', (
      select jsonb_object_agg(f.format, jsonb_build_object(
        'best_lineups', (
          select coalesce(jsonb_agg(stats_card(to_jsonb(p)) || jsonb_build_object('best_score', p.best_score, 'best_run', p.best_run, 'best_score_std', p.best_score_std, 'best_run_std', p.best_run_std) order by p.s desc, p.username), '[]'::jsonb)
            from (select *, case when f.format = 'standard' then best_score_std else best_score end as s
                    from profiles
                   where case when f.format = 'standard' then best_score_std else best_score end is not null
                   order by s desc, username limit 15) p
        ),
        'best_gm', (
          select coalesce(jsonb_agg(jsonb_build_object('username', g.username, 'score', g.score, 'w', g.w, 'l', g.l)
                                    order by g.score desc, g.created_at), '[]'::jsonb)
            from (select * from runs where gm and not dnf and format = f.format and score is not null
                   order by score desc, created_at limit p_limit) g
        ),
        -- Title-winning runs, lowest team score first: the lower the score, the bigger the upset.
        -- Every mode counts. The season sim only looks at team score, so a title at a given score is
        -- exactly as unlikely from GM, Genius or a daily as from Unlimited.
        'biggest_upsets', (
          select coalesce(jsonb_agg(jsonb_build_object('username', u.username, 'score', u.score, 'w', u.w, 'l', u.l,
                                                       'perfect', coalesce(u.perfect, false), 'ladder', u.ladder, 'roster', u.roster)
                                    order by u.score, u.created_at), '[]'::jsonb)
            from (select * from runs where champ and not dnf and format = f.format and score is not null
                   order by score, created_at limit p_limit) u
        )
      )) from fmt f
    ),
    'most_drafted', (
      select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'season', d.season, 'team', d.team, 'count', d.n)
                                order by d.n desc, d.name, d.season, d.team), '[]'::jsonb)
        from (select entry->>'name' as name, (entry->>'season')::integer as season, entry->>'team' as team, count(*) as n
                from entries group by 1, 2, 3
               order by n desc, name, season, team limit 15) d
    ),
    'most_wins', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.wins desc, p.username), '[]'::jsonb)
        from (select * from played order by wins desc, username limit p_limit) p
    ),
    'most_champs', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.champs desc, p.username), '[]'::jsonb)
        from (select * from played where champs > 0 order by champs desc, username limit p_limit) p
    ),
    'most_playoffs', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.playoffs desc, p.username), '[]'::jsonb)
        from (select * from played where playoffs > 0 order by playoffs desc, username limit p_limit) p
    ),
    'longest_streaks', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.daily_best_streak desc, p.username), '[]'::jsonb)
        from (select * from profiles where daily_best_streak > 0 order by daily_best_streak desc, username limit p_limit) p
    ),
    -- A minimum sample so a 1-0 account can't top a percentage board.
    'best_win_pct', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) || jsonb_build_object('pct', p.pct)
                                order by p.pct desc, p.username), '[]'::jsonb)
        from (select *, wins::numeric / (wins + losses) as pct from played where wins + losses >= 3
               order by pct desc, username limit p_limit) p
    ),
    'avg_win_pct', (
      select coalesce(round(100 * sum(wins)::numeric / nullif(sum(wins + losses), 0)), 0) from played
    )
  );
$$;
