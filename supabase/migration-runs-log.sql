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
--   1.11.0 adds player_stats(user_id) for the profile screen, and indexes for reading one player's
--          daily_runs, sou_runs and builds. Only adds objects.

create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- A snapshot, so a leaderboard never needs a join. Players can't change their username; a moderator's
  -- rename (migration-moderation.sql's mod_act) rewrites it here too.
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
-- `guest` rides along with the name, because every name on a board is rendered by the same NameLink and
-- a guest's must not be a link: it carries a chip instead, and there is no profile screen behind it
-- (v1.17.0). The Leaderboard got this right by selecting the whole row; these boards built their own
-- objects and left the column out, so for eight of them a throwaway account rendered as an ordinary one -
-- clickable, reportable, and answering /u/<name> with a full profile.
create or replace function public.stats_card(p jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'id', p->'id', 'username', p->'username', 'runs', p->'runs', 'dnf', p->'dnf',
    'wins', p->'wins', 'losses', p->'losses', 'champs', p->'champs', 'perfect', p->'perfect',
    'playoffs', p->'playoffs', 'daily_best_streak', p->'daily_best_streak',
    'guest', coalesce(p->'guest', 'false'::jsonb)
  );
$$;

-- Every Stats-screen board in one round trip. Every order has a final tiebreak, so results are
-- deterministic - and every username tiebreak sorts `collate "C"`, by code point, for the same reason
-- player_stats below does: the database's default collation differs between installs, so without it the
-- SQL and tests/helpers.mjs's JS reimplementation disagree about which of two equal accounts comes first.
-- PGlite reports datcollate = C, so the parity test could never have seen the difference.
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
          select coalesce(jsonb_agg(stats_card(to_jsonb(p)) || jsonb_build_object('best_score', p.best_score, 'best_run', p.best_run, 'best_score_std', p.best_score_std, 'best_run_std', p.best_run_std) order by p.s desc, p.username collate "C"), '[]'::jsonb)
            from (select *, case when f.format = 'standard' then best_score_std else best_score end as s
                    from profiles
                   where case when f.format = 'standard' then best_score_std else best_score end is not null
                   order by s desc, username collate "C" limit 15) p
        ),
        'best_gm', (
          select coalesce(jsonb_agg(jsonb_build_object('username', g.username, 'score', g.score, 'w', g.w, 'l', g.l,
                                                       'guest', coalesce(pr.guest, false))
                                    order by g.score desc, g.created_at), '[]'::jsonb)
            from (select * from runs where gm and not dnf and format = f.format and score is not null
                   order by score desc, created_at limit p_limit) g
            left join profiles pr on pr.id = g.user_id
        ),
        -- Title-winning runs, lowest team score first: the lower the score, the bigger the upset.
        -- Every mode counts. The season sim only looks at team score, so a title at a given score is
        -- exactly as unlikely from GM, Genius or a daily as from Unlimited.
        'biggest_upsets', (
          select coalesce(jsonb_agg(jsonb_build_object('username', u.username, 'score', u.score, 'w', u.w, 'l', u.l,
                                                       'perfect', coalesce(u.perfect, false), 'ladder', u.ladder, 'roster', u.roster,
                                                       'guest', coalesce(pr.guest, false))
                                    order by u.score, u.created_at), '[]'::jsonb)
            from (select * from runs where champ and not dnf and format = f.format and score is not null
                   order by score, created_at limit p_limit) u
            left join profiles pr on pr.id = u.user_id
        )
      )) from fmt f
    ),
    'most_drafted', (
      select coalesce(jsonb_agg(jsonb_build_object('name', d.name, 'season', d.season, 'team', d.team, 'count', d.n)
                                order by d.n desc, d.name collate "C", d.season, d.team collate "C"), '[]'::jsonb)
        from (select entry->>'name' as name, (entry->>'season')::integer as season, entry->>'team' as team, count(*) as n
                from entries group by 1, 2, 3
               order by n desc, (entry->>'name') collate "C", season, (entry->>'team') collate "C" limit 15) d
    ),
    'most_wins', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.wins desc, p.username collate "C"), '[]'::jsonb)
        from (select * from played order by wins desc, username collate "C" limit p_limit) p
    ),
    'most_champs', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.champs desc, p.username collate "C"), '[]'::jsonb)
        from (select * from played where champs > 0 order by champs desc, username collate "C" limit p_limit) p
    ),
    'most_playoffs', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.playoffs desc, p.username collate "C"), '[]'::jsonb)
        from (select * from played where playoffs > 0 order by playoffs desc, username collate "C" limit p_limit) p
    ),
    'longest_streaks', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.daily_best_streak desc, p.username collate "C"), '[]'::jsonb)
        from (select * from profiles where daily_best_streak > 0 order by daily_best_streak desc, username collate "C" limit p_limit) p
    ),
    -- A minimum sample so a 1-0 account can't top a percentage board.
    'best_win_pct', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) || jsonb_build_object('pct', p.pct)
                                order by p.pct desc, p.username collate "C"), '[]'::jsonb)
        from (select *, wins::numeric / (wins + losses) as pct from played where wins + losses >= 3
               order by pct desc, username collate "C" limit p_limit) p
    ),
    'avg_win_pct', (
      select coalesce(round(100 * sum(wins)::numeric / nullif(sum(wins + losses), 0)), 0) from played
    )
  );
$$;

-- ---------- One player (1.11.0) ----------
-- Everything per-player the profile screen shows beyond the profiles row itself. Contract and exact
-- JSON shape: PROFILES.md ("player_stats"). tests/mock-profile-stats.mjs mirrors it and
-- tests/test-player-stats-sql.mjs checks the two agree.
--
-- Security invoker over the same publicly readable tables as site_stats, so a guest opening someone's
-- profile can call it, and it shows nothing a direct select couldn't.

-- One player's rows. runs needs no new index: its unique (user_id, created_at, dnf) index leads with
-- user_id.
create index if not exists daily_runs_user_idx on public.daily_runs (user_id);
create index if not exists sou_runs_user_idx on public.sou_runs (user_id);
create index if not exists builds_user_idx on public.builds (user_id);

-- Names and teams sort with collate "C" (plain code-point order) because the database's default
-- collation differs between installs, and names have apostrophes and mixed case, where collations
-- disagree. Ties in a player's own runs can't go further than created_at: runs' unique key makes it
-- unique among one player's finished runs.
create or replace function public.player_stats(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  mine as (select * from runs where user_id = p_user_id),
  done as (select * from mine where not dnf),
  -- Every roster entry of every finished run. A backfilled run can have no roster.
  entries as (
    select e->>'name' as name, (e->>'season')::integer as season, e->>'team' as team
      from done d
      cross join lateral jsonb_array_elements(case when jsonb_typeof(d.roster) = 'array' then d.roster else '[]'::jsonb end) e
  ),
  dailies as (select * from daily_runs where user_id = p_user_id),
  -- Two of a player's dailies share a created_at only if one transaction wrote both, so date and
  -- format, the rest of daily_runs' primary key, settle that last tie.
  best_daily as (select score, w, l from dailies order by score desc, created_at, date, format limit 1)
  select jsonb_build_object(
    'since', (select min(created_at) from mine),
    'by_ladder', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'ladder', g.ladder, 'seasons', g.seasons, 'dnf', g.dnf, 'wins', g.wins, 'losses', g.losses,
               'champs', g.champs, 'perfect', g.perfect, 'playoffs', g.playoffs,
               'best_score', g.best_score, 'best_score_std', g.best_score_std)
             order by array_position(array['daily', 'unlimited', 'genius', 'gm'], g.ladder)), '[]'::jsonb)
        from (select ladder,
                     count(*) filter (where not dnf) as seasons,
                     count(*) filter (where dnf) as dnf,
                     coalesce(sum(w) filter (where not dnf), 0) as wins,
                     coalesce(sum(l) filter (where not dnf), 0) as losses,
                     count(*) filter (where not dnf and champ) as champs,
                     count(*) filter (where not dnf and perfect) as perfect,
                     count(*) filter (where not dnf and playoffs) as playoffs,
                     max(score) filter (where not dnf and format = 'fantasy') as best_score,
                     max(score) filter (where not dnf and format = 'standard') as best_score_std
                from mine group by ladder) g
    ),
    'wins', (
      select coalesce(jsonb_agg(jsonb_build_object('w', g.w, 'n', g.n) order by g.w), '[]'::jsonb)
        from (select w, count(*) as n from done where w is not null group by w) g
    ),
    'best_points', (select max(points) from done),
    'go_to_players', (
      select coalesce(jsonb_agg(jsonb_build_object('name', t.name, 'season', t.season, 'team', t.team, 'count', t.n)
                                order by t.n desc, t.name collate "C", t.season, t.team collate "C"), '[]'::jsonb)
        from (select name, season, team, count(*) as n from entries group by name, season, team
               order by n desc, name collate "C", season, team collate "C" limit 5) t
    ),
    'team_counts', (
      select coalesce(jsonb_agg(jsonb_build_object('team', t.team, 'count', t.n) order by t.n desc, t.team collate "C"), '[]'::jsonb)
        from (select team, count(*) as n from entries group by team) t
    ),
    -- A run with no score (only ever a very old backfilled one) can't be an upset or a best, the same
    -- as on site_stats' boards.
    'by_format', (
      select jsonb_object_agg(f.format, jsonb_build_object(
        'champs', (select count(*) from done where format = f.format and champ),
        'biggest_upset', (
          select jsonb_build_object('score', u.score, 'w', u.w, 'l', u.l, 'ladder', u.ladder, 'created_at', u.created_at)
            from done u where u.format = f.format and u.champ and u.score is not null
           order by u.score, u.created_at limit 1),
        'best_gm', (
          select jsonb_build_object('score', g.score, 'w', g.w, 'l', g.l)
            from done g where g.format = f.format and g.gm and g.score is not null
           order by g.score desc, g.created_at limit 1)
      )) from (values ('fantasy'), ('standard')) f(format)
    ),
    -- A day's finishing places only count once no one anywhere can still post that day's daily:
    -- submit-run takes a daily dated from yesterday to tomorrow in UTC, so a date two days back is
    -- final. The UTC date is worked out explicitly, since current_date follows the session's time zone.
    'dailies', jsonb_build_object(
      'played', (select count(*) from dailies),
      'best_score', (select score from best_daily), 'best_w', (select w from best_daily), 'best_l', (select l from best_daily),
      'best_rank', (
        select min(1 + (select count(*) from daily_runs o where o.date = d.date and o.format = d.format and o.score > d.score))
          from dailies d
         where d.date::date <= (now() at time zone 'utc')::date - 2)
    ),
    'over_under', (select jsonb_build_object('played', count(*), 'best', max(score)) from sou_runs where user_id = p_user_id),
    'builds', jsonb_build_object(
      'count', (select count(*) from builds where user_id = p_user_id),
      -- Only a finite overall can be a best: builds was browser-written before 1.11.0's check, and numeric
      -- NaN (which sorts above every number) or Infinity would otherwise win.
      'best', (select jsonb_build_object('pos', b.pos, 'overall', b.overall) from builds b where b.user_id = p_user_id and abs(b.overall) < 1e12
                order by b.overall desc, b.created_at, b.id limit 1))
  );
$$;
