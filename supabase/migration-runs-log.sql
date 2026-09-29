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
-- Once per account, ever. The unique key is (user_id, created_at, dnf), and `created_at` falls back to
-- `profiles.updated_at` for a stored run with no numeric `date` - which is not a property of the run at all:
-- it moves every time anything writes that profile. So a second pass gave those runs a different key and
-- inserted them again, and a third gave them another: measured at 1 -> 2 -> 3 duplicates across passes, on a
-- file whose header promises it is safe to re-run. Re-running it is also the documented way to pick up a
-- change to the Stats functions below, so this was not a hypothetical.
--
-- Guarding on the account rather than on the timestamp is what makes it idempotent no matter what the
-- timestamps do. It does not repair duplicates a previous re-run already made - 2.0-STATUS.md section 6 has
-- the query that finds them.
where not exists (select 1 from public.runs r where r.user_id = src.id and r.backfilled)
on conflict (user_id, created_at, dnf) do nothing;

-- ---------- Reads ----------
-- Both functions are security invoker over publicly readable tables, so they expose nothing a
-- direct select couldn't. They exist so the aggregation runs next to the data instead of shipping
-- whole tables to the browser. tests/helpers.mjs mirrors both, and tests/test-runs-sql.mjs checks
-- that the mirror and this SQL return identical results.

-- The sitewide numbers on the home screen, Leaderboard and Stats.
--   players / runs / perfect  - summed from profiles, whose counters have always been complete (the
--                               runs log starts partway through the site's history).
--   plays   (v2.16.0)         - what the home screen's pill counts: every draft, every mini-game round
--                               and every duel that was actually played. The pill said "drafts" and
--                               showed `runs`, which left all of that out of the one number a visitor
--                               sees first. It is a DIFFERENT number from `runs`, not a replacement -
--                               the Stats screen's Drafts tile still means drafts, and the two must
--                               not be swapped for each other.
--   drafted (v2.16.0)         - players drafted: six a season from the runs log, plus every duel pick.
--                               Season DNFs have no roster, which is why the sum is over non-null ones.
--
-- A duel counts once somebody JOINED it (`guest_id is not null`), not when it finished. That is the
-- same rule a draft follows - a season counts from the moment its first board is dealt, picks or not -
-- so an abandoned duel counts and an open lobby nobody ever joined does not.
--
-- This is plpgsql rather than `language sql`, and it has to be. A `language sql` body is validated the
-- moment it is created, so every table it names must exist by then; `matches` does not, because
-- migration-versus.sql runs AFTER migration-profiles.sql (its can_play_versus reads profiles.guest)
-- while this file runs BEFORE it. plpgsql plans each statement the first time it RUNS it, so the duel
-- counts are read through EXECUTE behind a to_regclass guard - the same shape, for the same reason, as
-- set_avatar's supporters lookup in migration-profiles.sql. On a database that has never had
-- migration-versus.sql the guard simply leaves the duel counts at zero instead of failing, which is
-- what tests/test-migrations.mjs running the whole list on a bare database checks.
--
-- Still `stable`, so PostgREST is happy to serve it over GET (storage.js calls it with READ).
-- Still `security invoker`: it exposes nothing a direct select could not, and both client roles hold
-- SELECT on every table named here - checked against production, because a signed-out visitor is
-- exactly who the home screen's pill is for.
create or replace function public.site_totals()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_players    bigint;
  v_drafts     bigint;
  v_perfect    bigint;
  v_mini       bigint;
  v_drafted    bigint;
  v_duels      bigint := 0;
  v_duel_picks bigint := 0;
begin
  select count(*), coalesce(sum(runs + dnf), 0), coalesce(sum(perfect), 0)
    into v_players, v_drafts, v_perfect
    from profiles;

  select (select count(*) from sou_runs) + (select count(*) from builds)
       + (select count(*) from century_runs) + (select count(*) from guess_runs)
    into v_mini;

  select coalesce(sum(jsonb_array_length(roster)), 0) into v_drafted
    from runs where roster is not null;

  -- Both reads sit behind one guard because one migration creates both tables. Each is its own EXECUTE
  -- for the planning reason above: a statement naming matches cannot be planned where there is no such
  -- table, however it is guarded, unless the planning is deferred to the moment it runs.
  if to_regclass('public.matches') is not null then
    execute 'select count(*) from public.matches where guest_id is not null' into v_duels;
    execute 'select count(*) from public.match_picks' into v_duel_picks;
  end if;

  return jsonb_build_object(
    'players', v_players,
    'runs', v_drafts,
    'perfect', v_perfect,
    'plays', v_drafts + v_mini + v_duels,
    'drafted', v_drafted + v_duel_picks
  );
end;
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
-- p_limit is clamped, because it is not: every sibling does it (ladder_best to 50, versus_top to 100,
-- board_looks to 2000) and this one used it raw in nine subqueries while being granted to anon over the public
-- REST API. One GET with p_limit=100000000 builds a single JSON document out of every logged run's card and
-- every profile, nine ways over; p_limit=null means NO limit in SQL, and a negative one raises rather than
-- refusing. The app only ever sends 10, so nothing about the site changes.
create or replace function public.site_stats(p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  lim as (select greatest(1, least(coalesce(p_limit, 10), 50)) as n),
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
                   order by score desc, created_at limit (select n from lim)) g
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
                   order by score, created_at limit (select n from lim)) u
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
        from (select * from played order by wins desc, username collate "C" limit (select n from lim)) p
    ),
    'most_champs', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.champs desc, p.username collate "C"), '[]'::jsonb)
        from (select * from played where champs > 0 order by champs desc, username collate "C" limit (select n from lim)) p
    ),
    'most_playoffs', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.playoffs desc, p.username collate "C"), '[]'::jsonb)
        from (select * from played where playoffs > 0 order by playoffs desc, username collate "C" limit (select n from lim)) p
    ),
    'longest_streaks', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) order by p.daily_best_streak desc, p.username collate "C"), '[]'::jsonb)
        from (select * from profiles where daily_best_streak > 0 order by daily_best_streak desc, username collate "C" limit (select n from lim)) p
    ),
    -- A minimum sample so a 1-0 account can't top a percentage board.
    'best_win_pct', (
      select coalesce(jsonb_agg(stats_card(to_jsonb(p)) || jsonb_build_object('pct', p.pct)
                                order by p.pct desc, p.username collate "C"), '[]'::jsonb)
        from (select *, wins::numeric / (wins + losses) as pct from played where wins + losses >= 3
               order by pct desc, username collate "C" limit (select n from lim)) p
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
    -- Century (v2.12.0). `daily_best` is what the badge reads, and it is separate from `best` on purpose:
    -- Unlimited is unlimited, so a hundred ground out over an evening of retries is not the same thing as one
    -- reached on the day's single go. The badge is for the daily, and only this number can tell them apart.
    'century', (select jsonb_build_object(
      'played', count(*),
      'best', max(score),
      'daily_best', max(score) filter (where day is not null),
      'centuries', count(*) filter (where hit)
    ) from century_runs where user_id = p_user_id),
    -- Guess the Player (v2.15.0). `daily_best` is the FEWEST guesses a solved daily took, and it is the badge's
    -- number: practice is unlimited, so only the daily's single go can mean anything. min() over no rows is
    -- NULL, which is what "has never solved one" has to look like - a 0 would read as solving it in none.
    --
    -- This is why migration-guess.sql runs BEFORE this file: player_stats is `language sql`, so its body is
    -- validated the moment it is created and a missing guess_runs fails the whole migration outright.
    'guess', (select jsonb_build_object(
      'played', count(*),
      'solved', count(*) filter (where solved),
      'dailies', count(*) filter (where day is not null),
      'daily_solved', count(*) filter (where solved and day is not null),
      'daily_best', min(tries) filter (where solved and day is not null)
    ) from guess_runs where user_id = p_user_id),
    'builds', jsonb_build_object(
      'count', (select count(*) from builds where user_id = p_user_id),
      -- Only a finite overall can be a best: builds was browser-written before 1.11.0's check, and numeric
      -- NaN (which sorts above every number) or Infinity would otherwise win.
      'best', (select jsonb_build_object('pos', b.pos, 'overall', b.overall) from builds b where b.user_id = p_user_id and abs(b.overall) < 1e12
                order by b.overall desc, b.created_at, b.id limit 1))
  );
$$;

-- ---------------------------------------------------------------------------
-- The best draft each account has in ONE MODE, top N: the score board the Leaderboard shows per mode, the way
-- the points ladder beside it already has a mode of its own.
--
-- `profiles` cannot answer this. It keeps one best score per FORMAT (best_score / best_score_std) and nothing
-- per ladder, so this reads the runs log - which is the complete history, and `recent` is not (see the
-- runs-log note in CLAUDE.md). Adding four more columns to `profiles` would have been the other way, and it
-- would mean submit-run writing them, a backfill, and a second place for a best score to disagree with itself.
--
-- ONE ROW PER ACCOUNT - their best run in that mode - not one row per run. This board answers "who is best at
-- GM"; a board where one player holds four of the ten places answers a different question, and `best_gm` and
-- `biggest_upsets` in site_stats already answer that one.
--
-- Every order by is fully tiebroken, the last of them `username collate "C"`. The Supabase databases are
-- en_US.UTF-8 and PGlite is C, so a tiebreak missing here reorders rows between page loads on the live site
-- and tests/test-runs-sql.mjs cannot see it - which is exactly how the missing team tiebreak in most-drafted
-- was found.
--
-- `guest` travels with the name, as it does on every other board: one that drops the flag turns a throwaway
-- account into a clickable, reportable one (CLAUDE.md, Guests - eight boards did).
create or replace function public.ladder_best(p_ladder text, p_format text, p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = public as $$
  with played as (
    select r.user_id, r.username, r.score, r.w, r.l, r.created_at, r.id,
           row_number() over (partition by r.user_id order by r.score desc, r.created_at, r.id) as rn,
           count(*) over (partition by r.user_id) as drafts,
           count(*) filter (where r.perfect) over (partition by r.user_id) as perfect_runs
      from runs r
     where not r.dnf and r.score is not null
       and r.ladder = p_ladder and r.format = p_format
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.user_id, 'username', b.username, 'guest', coalesce(pr.guest, false),
           'score', b.score, 'w', b.w, 'l', b.l,
           'drafts', b.drafts, 'perfect', b.perfect_runs)
         order by b.score desc, b.created_at, b.username collate "C"), '[]'::jsonb)
    from (select * from played where rn = 1
           order by score desc, created_at, username collate "C"
           limit greatest(1, least(coalesce(p_limit, 10), 50))) b
    left join profiles pr on pr.id = b.user_id
$$;
