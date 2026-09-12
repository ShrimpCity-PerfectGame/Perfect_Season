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

alter table public.profiles enable row level security;
alter table public.daily_runs enable row level security;

-- Public, sitewide-readable (matches the game's existing fully-open leaderboard semantics -
-- there was never a read restriction before this migration).
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable" on public.profiles for select using (true);

drop policy if exists "daily_runs are publicly readable" on public.daily_runs;
create policy "daily_runs are publicly readable" on public.daily_runs for select using (true);

-- Writes restricted to the row's own owner. No client-side INSERT policy on profiles - profile
-- rows are created only by the trigger below, as part of auth.users insert.
drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "users insert their own daily run" on public.daily_runs;
create policy "users insert their own daily run" on public.daily_runs
  for insert with check (auth.uid() = user_id);

drop policy if exists "users update their own daily run" on public.daily_runs;
create policy "users update their own daily run" on public.daily_runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Known, accepted limitation: public SELECT + auth.uid()-gated writes means an authenticated
-- client can still write any best_score/recent payload for their OWN row - RLS proves who is
-- writing, not that the number is truthful. No worse than the game's previous fully-open
-- window.storage, but not a fix either. Real tamper-resistance needs server-side score
-- recomputation from a signed roster+seed - a real follow-up, not attempted here.

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
