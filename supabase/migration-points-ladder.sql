-- Migration: the points ladder - per-mode leaderboards plus a lifetime bank.
-- Run this in the SQL editor BEFORE deploying the submit-run Edge Function, and before shipping
-- the client. Staging first, then production. Safe to re-run.
--
-- Backward-compatible with the currently-deployed Edge Function: every column has a default, and
-- profileToRow issues partial-column updates, so the old function simply leaves these alone.

-- One ladder per mode. Kept as separate numeric columns rather than a single jsonb blob because
-- the leaderboard sorts on them in the database - a jsonb path would need an expression index and
-- lose the plain .not(col,'is',null).order(col) query shape the rest of storage.js uses.
alter table public.profiles
  add column if not exists points_daily     numeric not null default 0,
  add column if not exists points_unlimited numeric not null default 0,
  add column if not exists points_genius    numeric not null default 0,
  add column if not exists points_gm        numeric not null default 0;

-- Every point ever earned, across all modes. This is the shop currency, and it is deliberately
-- NOT the same number as the ladders: spending in the shop must never cost you ladder position.
alter table public.profiles
  add column if not exists points_bank numeric not null default 0;

-- Today's earnings per mode, so only the best few drafts a day count toward the uncapped ladders.
-- Shape: { "date": "2026-03-05", "byMode": { "unlimited": [120, 90], "gm": [40] } }.
-- Held here rather than in a runs table so a submission stays a single row update.
alter table public.profiles
  add column if not exists points_day jsonb;

create index if not exists profiles_points_daily_idx     on public.profiles (points_daily desc);
create index if not exists profiles_points_unlimited_idx on public.profiles (points_unlimited desc);
create index if not exists profiles_points_genius_idx    on public.profiles (points_genius desc);
create index if not exists profiles_points_gm_idx        on public.profiles (points_gm desc);

-- No RLS changes: profiles has public SELECT and zero write policies (the submit-run service-role
-- client is the only writer), and no policy is column-scoped, so these inherit that posture.
