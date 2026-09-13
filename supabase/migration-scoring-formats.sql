-- Migration: add the standard ("Championship mode") scoring format alongside fantasy (full PPR).
-- Run this once in the Supabase dashboard's SQL editor BEFORE deploying the submit-run Edge
-- Function, and before shipping the client. Safe to re-run.
--
-- This is deliberately backward-compatible with the currently-deployed Edge Function, so there is
-- no broken window between running it and deploying: daily_runs.format defaults to 'fantasy' for
-- inserts that don't mention it, the widened primary key is strictly weaker than the old one (so
-- the existing one-daily-per-day guarantee still holds for fantasy), and profileToRow issues
-- partial-column updates, so the new profiles columns are simply left alone by the old function.

-- Scores from the two formats aren't comparable, so each format ranks in its own column.
-- best_score/best_run keep their existing meaning (fantasy) - nothing to backfill, since every
-- row that already exists predates the standard format and is therefore fantasy by construction.
alter table public.profiles
  add column if not exists best_score_std numeric,
  add column if not exists best_run_std   jsonb;

create index if not exists profiles_best_score_std_idx
  on public.profiles (best_score_std desc nulls last);

-- There are two dailies each day now (different seeds, different boards), so the primary key that
-- enforces "one daily per day" has to widen or the second format's submission collides with the
-- first. `not null default` backfills existing rows without rewriting the table.
alter table public.daily_runs
  add column if not exists format text not null default 'fantasy';

do $$ begin
  alter table public.daily_runs
    add constraint daily_runs_format_check check (format in ('fantasy', 'standard'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.daily_runs drop constraint if exists daily_runs_pkey;
  alter table public.daily_runs add constraint daily_runs_pkey primary key (date, format, user_id);
exception when invalid_table_definition then null; end $$;

drop index if exists public.daily_runs_date_score_idx;
create index if not exists daily_runs_date_format_score_idx
  on public.daily_runs (date, format, score desc);

-- No RLS changes: profiles and daily_runs have public SELECT and zero write policies (the
-- submit-run service-role client is the only writer), and neither policy is column-scoped, so the
-- new columns inherit the existing posture with nothing to update.
