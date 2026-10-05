-- The crash sink (docs/superpowers/specs/2026-10-05-client-error-sink-design.md). One row per uncaught render
-- error, written only by the report-error Edge Function's service role.
--
-- ORDER: anywhere. It references nothing and nothing references it - deliberately, so it can be run on either
-- environment without a window where something else is half-migrated.
--
-- WHY NO CLIENT WRITE POLICY, and no select policy either: this table is the one place a player's browser sends
-- something that nobody asked them about. The function scrubs the path to a screen name before anything lands
-- here, and a client that could write directly would be a client scrubbing its own report - which is the guard
-- living inside the thing it guards. Read it from the SQL editor (supabase/query-client-errors.sql).
--
-- THREE COLUMNS ARE ABSENT ON PURPOSE: no user_id, no username, no ip. The function sees the caller's address
-- (it cannot not) and must never write it. A column nobody adds is easier to keep absent than to remove once
-- it has rows in it.
create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  -- The release, from APP_VERSION. The stack is minified, so this is what makes it readable.
  version     text not null check (char_length(version) between 1 and 40),
  -- One value today. Widening this is a check change rather than a reshaping of rows - but see §9 of the
  -- spec first: every new kind widens what an arbitrary thrown string can carry into this table.
  kind        text not null check (kind in ('crash')),
  message     text not null check (char_length(message) <= 500),
  stack       text check (char_length(stack) <= 2000),
  component   text check (char_length(component) <= 1000),
  -- The ring that led up to the crash: up to 5 x {kind, message, extra}. A crash is usually the SECOND
  -- failure, and the first one is the one that explains it.
  before      jsonb,
  -- Reduced, e.g. 'Chrome 152 / Android'. Never the raw user-agent string.
  browser     text check (char_length(browser) <= 80),
  -- A screen name, e.g. 'profile'. NEVER a path: /u/<name> carries a username.
  screen      text check (char_length(screen) <= 40)
);

-- Reading one account's crashes is not a thing anyone does; reading the last day's is. Partial on nothing,
-- because the table is small by construction (90-day retention, 200 rows an hour).
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;
-- No policy is created, for either reading or writing. RLS with no policy denies everything to anon and
-- authenticated, which is the whole point; the service role bypasses RLS.
revoke all on table public.client_errors from anon, authenticated;
