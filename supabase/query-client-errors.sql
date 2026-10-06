-- The crash log. Paste into the Supabase SQL editor (Dashboard > SQL Editor) for whichever project you want
-- to look at - staging ndelisxdxjmvcdezzecu, production aqbajvwwvvbrklolbcen.
--
-- THIS IS A RUNBOOK QUERY, NOT A FEATURE, for the reason query-play-log.sql is one: running it needs a
-- dashboard login, so it is visible to the owner and nobody else, and it adds no surface to the app that
-- could leak something later.
--
-- UNLIKE the play log, these rows are NOT public. public.client_errors has RLS on with no policy of any kind
-- - not for writing and not for reading - so anon and authenticated see nothing at all. Only the service
-- role (this editor, and supabase/functions/report-error) can touch it.
--
-- WHAT A ROW CANNOT TELL YOU, by construction: who it was. There is no user id, no username and no IP
-- address, `screen` is a name like 'profile' rather than the address, and `browser` is reduced to something
-- like 'Chrome 152 / Android'. That is the whole design - see
-- docs/superpowers/specs/2026-10-05-client-error-sink-design.md.
--
-- The stack is minified, so `version` is what makes it readable: check out that tag and the frames line up
-- with the bundle the player was actually running. Rows are deleted after 90 days by the function itself.

select to_char(created_at at time zone 'UTC', 'MM-DD HH24:MI') as at,
       version,
       screen,
       browser,
       message,
       jsonb_array_length(coalesce(before, '[]'::jsonb)) as led_up_to
  from public.client_errors
 order by created_at desc
 limit 100;


-- ---------------------------------------------------------------------------------------------------
-- Variations, for when the list is not the question.
--
-- The shape before any single row: which release, which screen. One crash is an anecdote; forty on one
-- screen in one version is a bug with an address.
--     select version, screen, count(*) as crashes
--       from public.client_errors group by 1, 2 order by 3 desc;
--
-- One crash in full, the ring included. The ring is usually where the answer is - a crash is normally the
-- SECOND failure, and the first one is what explains it.
--     select * from public.client_errors where id = 123;
--
-- The same message, however many times it has happened, newest first:
--     select message, count(*) as seen, max(created_at) as last_seen
--       from public.client_errors group by 1 order by 2 desc limit 20;
--
-- Is the hourly cap being hit? If this ever returns a row at 200, reports were dropped that hour and the
-- per-IP upgrade in the function's comment is worth building.
--     select date_trunc('hour', created_at) as hour, count(*)
--       from public.client_errors group by 1 having count(*) >= 200 order by 1 desc;
