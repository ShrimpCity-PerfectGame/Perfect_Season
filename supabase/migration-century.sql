-- Century (v2.9.0) - the table a finished Century run lands in, and the two boards that read it.
--
-- Run this in the SQL editor of each environment, staging first. Only adds objects, so the site keeps working
-- while it runs.
--
-- ORDER: **this file goes FIRST**, before migration-runs-log.sql. player_stats there reads century_runs, and a
-- `language sql` body is validated the moment it is created - so the table must already exist or that file
-- fails outright. Everything that reads this table later is plpgsql and so is not validated at creation
-- (claim_minigame's 'century' arm in wallet, the name rewrites in profiles and moderation), which means the
-- wrong order there fails nothing until somebody claims coins or a guest trades up: the worst shape a runbook
-- can be in, and why tests/test-migrations.mjs runs the whole list on a bare database.
--
-- This file depends on nothing itself: the trigger that stamps username and guest lives in
-- migration-profiles.sql with the identical ones on sou_runs and builds. Then deploy the Edge Functions
-- (submit-century is new), then the client.
--
-- What the mode is: seven slots, hidden stats, a goal of 100 combined touchdowns from one real season. The rules
-- all live in century-logic.mjs, which the browser and the submit-century Edge Function share.
--
-- WHY THIS TABLE IS NOT WRITABLE BY CLIENTS, unlike sou_runs and builds beside it. Over/Under is written by the
-- browser because there is nothing to check: its rounds are a seeded sequence but a guess leaves no trace a
-- server could replay. A Century run leaves exactly that trace - seven (slot, player) pairs and at most one
-- re-spin - and replayCentury recomputes the teams from the seed, so the score can be derived from scratch
-- server-side. Given the choice between a board anybody can POST a number onto and one that is verified, the
-- verified one wins, and it costs one Edge Function. RLS is on with a public select policy and NO insert or
-- update policy at all, exactly as profiles, daily_runs and matches are: the service role is the only writer.

-- ---------- The table ----------
-- `day` is the daily's date as text, 'YYYY-MM-DD', matching sou_runs and daily_runs rather than a date column,
-- so the app and the function never disagree by a session's DateStyle. It is NULL for an Unlimited run, and the
-- partial unique index below is what makes a daily once-per-account.
--
-- `username` and `guest` are stamped by use_account_username (migration-profiles.sql), the same trigger sou_runs
-- and builds carry, so a name on this board comes from the account and never from whoever wrote the row - and a
-- guest's name arrives with its chip rather than as a link to a profile that does not exist.
create table if not exists public.century_runs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  username    text not null,
  guest       boolean not null default false,
  day         text,
  seed        text not null check (char_length(seed) between 1 and 80),
  score       integer not null check (score >= 0 and score <= 400),
  hit         boolean not null,
  -- What the seven teams dealt were worth at best (centuryCeiling). Stored because it is the only fair way to
  -- read a score - a draw of seven weak teams cannot reach 100 however well it is played - and recomputing it
  -- later would need the season pool of the day the run was played.
  ceiling     integer not null check (ceiling >= 0 and ceiling <= 400),
  roster      jsonb not null,
  outcome     text not null check (char_length(outcome) between 1 and 80),
  created_at  timestamptz not null default now()
);

-- One daily per account per date. A partial index, so Unlimited runs (day is null) are unlimited - a plain
-- unique constraint would treat every null as distinct anyway, but saying it as a partial index states the rule
-- instead of relying on that.
create unique index if not exists century_runs_daily_once
  on public.century_runs (day, user_id) where day is not null;
-- The daily board, and the all-time board. Both orders are fully tiebroken below; these only make them cheap.
create index if not exists century_runs_day_score_idx on public.century_runs (day, score desc, created_at, id);
create index if not exists century_runs_score_idx on public.century_runs (score desc, created_at, id);
create index if not exists century_runs_user_idx on public.century_runs (user_id, created_at desc);

alter table public.century_runs enable row level security;

drop policy if exists "century_runs are publicly readable" on public.century_runs;
create policy "century_runs are publicly readable" on public.century_runs for select using (true);

-- Said out loud, and re-dropped on every run, so a policy added by hand in a dashboard does not quietly survive
-- a re-run of this file. The service role bypasses RLS and is unaffected.
drop policy if exists "users insert their own century run" on public.century_runs;
drop policy if exists "users update their own century run" on public.century_runs;

-- The id sequence, for the reason migration-wallet.sql revokes the ledger's: Supabase's default privileges give
-- anon and authenticated every sequence made in public, and whoever holds this one can set it to its last value,
-- after which no run can be written for anybody. PostgREST offers clients no setval, so this closes a door no
-- request reaches today - but a table no client may write should not hand out the counter that numbers its rows.
-- tests/test-economy-security.mjs 1b is what caught this one; it holds the rule for the whole public schema.
revoke all on sequence public.century_runs_id_seq from anon, authenticated;

-- The name and guest flag come from the account, never from the row that was written - but that TRIGGER is
-- attached in migration-profiles.sql, beside the identical ones on sou_runs and builds, because that is where
-- use_account_username is defined. This file therefore depends on nothing and RUNS FIRST (see the header):
-- player_stats in migration-runs-log.sql reads century_runs, and a `language sql` body is validated when it is
-- created, so the table has to exist before that file does.

-- A rename has to reach this board too, or a renamed account keeps its old name here while every other board
-- shows the new one. mod_act and claim_username both do this by hand for each table; this file cannot edit them,
-- so the runbook entry is in CLAUDE.md and the two functions gain the line in their own files.

-- ---------- The boards ----------
-- One day's daily, best first. The unique index means one row per account already, so no row_number is needed -
-- but the order is still fully tiebroken (created_at, then username under the C collation), because an order
-- that is not is an order that differs between the SQL and the mock, which is how the missing team tiebreak in
-- most-drafted was found.
create or replace function public.century_top(p_day text, p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.user_id, 'username', b.username, 'guest', b.guest,
           'score', b.score, 'hit', b.hit, 'ceiling', b.ceiling, 'outcome', b.outcome)
         order by b.score desc, b.created_at, b.username collate "C"), '[]'::jsonb)
    from (select c.user_id, c.username, c.guest, c.score, c.hit, c.ceiling, c.outcome, c.created_at
            from century_runs c
           where c.day = p_day
           order by c.score desc, c.created_at, c.username collate "C"
           limit greatest(1, least(coalesce(p_limit, 10), 50))) b
$$;

-- The all-time board: every account's best Century run, daily or Unlimited. One row per account, which here does
-- need a row_number - an Unlimited player has as many runs as they like.
create or replace function public.century_best(p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = public as $$
  with ranked as (
    select c.user_id, c.username, c.guest, c.score, c.hit, c.ceiling, c.outcome, c.created_at, c.day,
           row_number() over (partition by c.user_id order by c.score desc, c.created_at, c.id) as rn,
           count(*) over (partition by c.user_id) as runs,
           count(*) filter (where c.hit) over (partition by c.user_id) as centuries
      from century_runs c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.user_id, 'username', b.username, 'guest', b.guest,
           'score', b.score, 'hit', b.hit, 'ceiling', b.ceiling, 'outcome', b.outcome,
           'daily', b.day is not null, 'runs', b.runs, 'centuries', b.centuries)
         order by b.score desc, b.created_at, b.username collate "C"), '[]'::jsonb)
    from (select * from ranked where rn = 1
           order by score desc, created_at, username collate "C"
           limit greatest(1, least(coalesce(p_limit, 10), 50))) b
$$;

-- Read-only and called as GET by the app (CLAUDE.md, "Reads retry themselves; writes don't"), which is why both
-- are stable. Signed-out visitors read the boards, the same as every other board on the site.
grant execute on function public.century_top(text, integer), public.century_best(integer) to anon, authenticated;
