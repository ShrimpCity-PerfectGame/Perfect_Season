-- Guess the Player (v2.13.0) - the table a finished game lands in, and the two boards that read it.
--
-- Run this in the SQL editor of each environment, staging first. Only adds objects, so the site keeps working
-- while it runs. ORDER: straight after migration-century.sql and before migration-profiles.sql, for the same
-- reason Century sits there - the trigger that stamps username and guest lives in profiles, beside the ones on
-- sou_runs, builds and century_runs, so this file depends on nothing. Then moderation and wallet (whose
-- claim_minigame gains a 'guess' arm), then the Edge Functions, then the client.
--
-- The rules are in guess-logic.mjs, shared by the browser and the submit-guess Edge Function.
--
-- WHY THIS TABLE IS NOT WRITABLE BY CLIENTS, like century_runs and unlike sou_runs: a game leaves a replayable
-- trace - the ids guessed, in order - and the answer follows from the date alone. So the server can decide
-- whether it was solved, and in how many, from scratch. A board anybody can POST a number onto is not a board.

create table if not exists public.guess_runs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  username    text not null,
  guest       boolean not null default false,
  -- The daily's date as text, 'YYYY-MM-DD', matching every other board here rather than a date column, so the
  -- app and the function can never disagree by a session's DateStyle. NULL for a practice game.
  day         text,
  seed        text check (seed is null or char_length(seed) between 1 and 80),
  solved      boolean not null,
  -- How many guesses were made. A solved game is 1-8; a lost one is always the full 8.
  tries       integer not null check (tries between 1 and 8),
  -- The ids guessed, in order, and the answer's id. Kept so the board can show a game back and so a run is
  -- auditable after the fact - the whole game is about forty bytes.
  guesses     jsonb not null,
  answer      text not null check (char_length(answer) between 1 and 120),
  outcome     text not null check (char_length(outcome) between 1 and 80),
  created_at  timestamptz not null default now()
);

-- One daily per account per date. Partial, so practice games (day is null) are unlimited - a plain unique
-- constraint would treat every null as distinct anyway, but saying it as a partial index states the rule.
create unique index if not exists guess_runs_daily_once
  on public.guess_runs (day, user_id) where day is not null;
-- The day's board sorts solved first, then fewest tries, then earliest. Fully tiebroken below; this makes it cheap.
create index if not exists guess_runs_day_idx on public.guess_runs (day, solved desc, tries, created_at, id);
create index if not exists guess_runs_user_idx on public.guess_runs (user_id, created_at desc);

alter table public.guess_runs enable row level security;

drop policy if exists "guess_runs are publicly readable" on public.guess_runs;
create policy "guess_runs are publicly readable" on public.guess_runs for select using (true);

-- Said out loud and re-dropped on every run, so a policy added by hand in a dashboard cannot quietly survive a
-- re-run of this file. The service role bypasses RLS and is unaffected.
drop policy if exists "users insert their own guess run" on public.guess_runs;
drop policy if exists "users update their own guess run" on public.guess_runs;

-- The id sequence, for the reason migration-wallet.sql revokes the ledger's: Supabase's default privileges give
-- anon and authenticated every sequence made in public, and a table no client may write should not hand out the
-- counter that numbers its rows. tests/test-economy-security.mjs holds that rule for the whole schema.
revoke all on sequence public.guess_runs_id_seq from anon, authenticated;

-- The trigger that stamps username and guest from the ACCOUNT lives in migration-profiles.sql, with the
-- identical ones on sou_runs, builds and century_runs.

-- ---------- The boards ----------
-- One day's game, best first: solved before unsolved, then fewest guesses, then whoever got there first. The
-- unique index means one row per account already. Fully tiebroken, including the `collate "C"` on username,
-- because an order that is not is an order the SQL and tests/mock-guess.mjs can disagree about.
create or replace function public.guess_top(p_day text, p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.user_id, 'username', b.username, 'guest', b.guest,
           'solved', b.solved, 'tries', b.tries, 'outcome', b.outcome)
         order by b.solved desc, b.tries, b.created_at, b.username collate "C"), '[]'::jsonb)
    from (select g.user_id, g.username, g.guest, g.solved, g.tries, g.outcome, g.created_at
            from guess_runs g
           where g.day = p_day
           order by g.solved desc, g.tries, g.created_at, g.username collate "C"
           limit greatest(1, least(coalesce(p_limit, 10), 50))) b
$$;

-- All time, one row per account: how many dailies they have solved, and how few guesses it takes them. Solved
-- count leads because a guessing game is about turning up - the average is the tiebreak, not the headline, or
-- somebody who played once and got it first time would top the board forever.
create or replace function public.guess_best(p_limit integer default 10)
returns jsonb language sql stable security invoker set search_path = public as $$
  with per as (
    select g.user_id,
           max(g.username) as username,
           bool_or(g.guest) as guest,
           count(*) filter (where g.day is not null) as dailies,
           count(*) filter (where g.day is not null and g.solved) as solved,
           round(avg(g.tries) filter (where g.day is not null and g.solved), 2) as avg_tries,
           min(g.tries) filter (where g.day is not null and g.solved) as best
      from guess_runs g
     group by g.user_id
    having count(*) filter (where g.day is not null) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.user_id, 'username', b.username, 'guest', b.guest,
           'dailies', b.dailies, 'solved', b.solved, 'avgTries', b.avg_tries, 'best', b.best)
         order by b.solved desc, b.avg_tries nulls last, b.username collate "C"), '[]'::jsonb)
    from (select * from per
           order by solved desc, avg_tries nulls last, username collate "C"
           limit greatest(1, least(coalesce(p_limit, 10), 50))) b
$$;

-- Read-only and called as GET by the app (CLAUDE.md, "Reads retry themselves; writes don't"), which is why both
-- are stable. Signed-out visitors read the boards, the same as every other board on the site.
grant execute on function public.guess_top(text, integer), public.guess_best(integer) to anon, authenticated;
