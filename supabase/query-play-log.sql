-- Who played what, and when. Paste into the Supabase SQL editor (Dashboard > SQL Editor) for whichever
-- project you want to look at - staging ndelisxdxjmvcdezzecu, production aqbajvwwvvbrklolbcen.
--
-- THIS IS A RUNBOOK QUERY, NOT A FEATURE. It is here so it is not lost and so the reasoning below is
-- written down once. Running it needs a Supabase dashboard login, so it is visible to the owner and nobody
-- else - which is the point. Note though that the rows it reads are not secret: every one of these tables
-- carries `for select using (true)`, because the leaderboards are public and a signed-out visitor reads
-- them. Anyone with the anon key could assemble this themselves. What the SQL editor gives you is the
-- convenience of one view without adding a new surface to the app that could leak something later.
--
-- Four things it gets right that a naive union does not:
--
--   1. A daily is written to BOTH `runs` (ladder = 'daily') and `daily_runs`. Reading both double-counts
--      every daily ever played. `runs` is the complete log, so this reads that and leaves daily_runs out.
--   2. `runs.backfilled` marks rows recovered from profiles.recent when that table was created. They are
--      real runs but they are not events that happened at the time stamped on them, so they are excluded.
--      Drop the `where not backfilled` if you want the whole history rather than a log of activity.
--   3. A duel is two people. `matches` has no username, so it joins profiles twice - once for the host and
--      once for the guest - and counts only matches somebody actually JOINED (`guest_id is not null`),
--      which is the same rule site_totals() uses. An open lobby nobody took is not a play.
--   4. `runs.created_at` is the RUN's own timestamp, not the insert time - deliberate, so the backfill and
--      a live insert of the same run collide rather than duplicating. For a "when did people play" log
--      that is what you want anyway.
--
-- Guests appear under the name the database gave them (Guest_XXXXX) because that is their account. There
-- is no DNF for the mini games: a Guess or Century run only exists once it is finished.

select to_char(played_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as played_utc,
       username,
       game
from (
  select username,
         case when dnf              then 'Draft (abandoned)'
              when ladder = 'daily' then 'Daily draft'
              when ladder = 'gm'    then 'GM draft'
              when ladder = 'genius' then 'Genius draft'
              else 'Unlimited draft' end as game,
         created_at as played_at
    from public.runs
   where not backfilled
  union all select username, 'Century',          created_at from public.century_runs
  union all select username, 'Guess the Player', created_at from public.guess_runs
  union all select username, 'Over/Under',       created_at from public.sou_runs
  union all select username, 'Build-a-player',   created_at from public.builds
  union all select p.username, 'Duel', m.created_at
       from public.matches m join public.profiles p on p.id = m.host_id
      where m.guest_id is not null
  union all select p.username, 'Duel', m.created_at
       from public.matches m join public.profiles p on p.id = m.guest_id
) x
order by played_at desc
limit 200;


-- ---------------------------------------------------------------------------------------------------
-- Variations, for when the plain log is not the question.
--
-- Just today:
--     ... ) x where played_at >= current_date order by played_at desc;
--
-- Only finished games, no abandoned drafts:
--     ... ) x where game <> 'Draft (abandoned)' order by played_at desc;
--
-- Real accounts only, no guests:
--     ... ) x where username !~ '^Guest_' order by played_at desc;
--
-- How many distinct people played each day, and how many plays:
--     select played_at::date as day, count(*) as plays, count(distinct username) as people
--       from ( ... ) x group by 1 order by 1 desc;
--
-- Which games are actually being played, last 7 days:
--     select game, count(*) as plays, count(distinct username) as people
--       from ( ... ) x where played_at >= now() - interval '7 days' group by 1 order by 2 desc;
