-- Perfect Season: Supabase schema + RLS
-- Run this once in the Supabase dashboard's SQL editor (a new project's SQL Editor tab).
-- Safe to re-run individual statements if something fails partway (uses IF NOT EXISTS /
-- CREATE OR REPLACE where practical), but a clean project is the easiest path.

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique,
  runs          integer not null default 0,
  dnf           integer not null default 0,
  wins          integer not null default 0,
  losses        integer not null default 0,
  champs        integer not null default 0,
  perfect       integer not null default 0,
  playoffs      integer not null default 0,
  best_score    numeric,
  best_run      jsonb,
  best_record   jsonb,
  recent        jsonb not null default '[]'::jsonb,
  daily_streak       integer default 0,
  daily_last         text,
  daily_best_streak  integer default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists profiles_best_score_idx on public.profiles (best_score desc nulls last);

create table if not exists public.daily_runs (
  date        text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  username    text not null,
  w           integer not null,
  l           integer not null,
  score       numeric not null,
  outcome     text,
  created_at  timestamptz not null default now(),
  primary key (date, user_id)
);
create index if not exists daily_runs_date_score_idx on public.daily_runs (date, score desc);

-- Stats O/U's daily leaderboard: one seeded sequence of rounds per day, shared by everyone
-- (mode.seed = "sou-<date>", same pattern as the roster daily's "daily-<date>"), three lives,
-- score = correct guesses before your third miss.
create table if not exists public.sou_runs (
  date        text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  username    text not null,
  score       integer not null,
  created_at  timestamptz not null default now(),
  primary key (date, user_id)
);
create index if not exists sou_runs_date_score_idx on public.sou_runs (date, score desc);

-- Build-a-player never touches a real roster/leaderboard - it's a standalone "what if" (see
-- playBapSim's own comment in perfect-season.jsx). This table exists only for the Stats screen's
-- "created players" count and "highest-OVR created player" leaderboard, logged once a build
-- completes (pickBapAttr's stage -> "done" transition) - purely additive, doesn't change
-- Build-a-player's stat-free promise for the player's own account.
create table if not exists public.builds (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  username    text not null,
  pos         text not null,
  overall     numeric not null,
  filled      jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists builds_overall_idx on public.builds (overall desc);

alter table public.profiles enable row level security;
alter table public.daily_runs enable row level security;
alter table public.sou_runs enable row level security;
alter table public.builds enable row level security;

-- Public, sitewide-readable (matches the game's existing fully-open leaderboard semantics -
-- there was never a read restriction before this migration).
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable" on public.profiles for select using (true);

drop policy if exists "daily_runs are publicly readable" on public.daily_runs;
create policy "daily_runs are publicly readable" on public.daily_runs for select using (true);

drop policy if exists "sou_runs are publicly readable" on public.sou_runs;
create policy "sou_runs are publicly readable" on public.sou_runs for select using (true);

drop policy if exists "builds are publicly readable" on public.builds;
create policy "builds are publicly readable" on public.builds for select using (true);

-- profiles and daily_runs are NOT client-writable at all - no update/insert policy exists for
-- them below (RLS with zero matching policy = zero allowed writes for anon/authenticated roles).
-- The submit-run Edge Function's service-role client is the only writer, after independently
-- recomputing the score/outcome server-side (see supabase/functions/submit-run and game-logic.mjs).
-- Profile rows are still created only by the trigger below, as part of auth.users insert.
drop policy if exists "users update their own profile" on public.profiles;
drop policy if exists "users insert their own daily run" on public.daily_runs;
drop policy if exists "users update their own daily run" on public.daily_runs;

drop policy if exists "users insert their own sou run" on public.sou_runs;
create policy "users insert their own sou run" on public.sou_runs
  for insert with check (auth.uid() = user_id);

drop policy if exists "users update their own sou run" on public.sou_runs;
create policy "users update their own sou run" on public.sou_runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users insert their own build" on public.builds;
create policy "users insert their own build" on public.builds
  for insert with check (auth.uid() = user_id);

-- profiles/daily_runs tamper-resistance: closed for Daily (its seed is derived from the Edge
-- Function's own clock, never trusted from the client) and for outright score/roster fabrication
-- in every mode (submit-run replays the actual draft trace and recomputes the score itself - see
-- game-logic.mjs's replayDraft). Still open: Unlimited/challenge-code mode's seed (mode.code) is
-- client-chosen, so grinding many codes offline for a lucky legitimate outcome remains possible -
-- an accepted, documented gap. sou_runs and builds (above) are untouched by this and remain fully
-- client-trusted - lower-stakes minigames, not roster-scoring, a candidate for a later pass.

-- Profile creation happens atomically with auth.users insert via this trigger, reading the
-- username passed as signUp() metadata (options.data.username) - so a signup either fully
-- succeeds (auth user + profile both exist) or fully fails, with no orphaned auth-only accounts
-- if a separate client-side insert step had instead been used.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
