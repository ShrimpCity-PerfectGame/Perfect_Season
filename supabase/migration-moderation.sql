-- Migration: reports and moderation (v1.11.0). Run AFTER migration-profiles.sql (it uses
-- profile_details, text_is_clean and the avatars bucket), before shipping the client that reads it.
-- Staging first, then production. Safe to re-run.
--
-- Contract: PROFILES.md (3.3). Only adds objects, so the site that's live when this runs keeps working.
--
-- Security model: reports and moderators have row-level security on and no policies at all, so no
-- client can read or write either table directly - not even a moderator. Everything goes through the
-- security definer functions below, which check who is asking. A modified browser can call them
-- directly, so every limit lives here; the app's own checks only make the messages friendlier.
-- tests/mock-moderation.mjs mirrors these functions and tests/test-moderation.mjs checks the two agree.
--
-- Runbook
--   Add a moderator:     insert into moderators (user_id) select id from profiles where username = 'NAME';
--   Remove a moderator:  delete from moderators where user_id = (select id from profiles where username = 'NAME');
--   A moderator rename is the one writer of profiles.username besides signup: it changes the username
--   column only, plus the username snapshots in runs, daily_runs, sou_runs and builds.

create table if not exists public.moderators (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  added_at  timestamptz not null default now()
);
alter table public.moderators enable row level security;

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references public.profiles(id) on delete cascade,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  reason       text not null check (reason in ('picture', 'bio', 'username', 'other')),
  note         text not null default '' check (char_length(note) <= 200),
  status       text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at   timestamptz not null default now(),
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolved_at  timestamptz,
  -- The mod_act action that resolved it.
  action       text check (action in ('remove_picture', 'clear_bio', 'rename', 'dismiss')),
  check (reporter_id <> target_id)
);
alter table public.reports enable row level security;
-- One open report per reporter, player and reason. Once a moderator resolves it, the same report can be
-- made again if the problem comes back.
create unique index if not exists reports_open_uidx on public.reports (reporter_id, target_id, reason) where status = 'open';
-- The rolling 24-hour limit counts one reporter's recent reports; the queue reads open reports by player.
create index if not exists reports_reporter_created_idx on public.reports (reporter_id, created_at);
create index if not exists reports_open_target_idx on public.reports (target_id, created_at) where status = 'open';

-- ---------- Functions ----------
-- A refusal raises its code as the whole message (raise exception 'limit'), which PostgREST returns as
-- { message: "limit", code: "P0001" } and storage-moderation.js maps to a reason.
-- Each sets search_path = public, pg_temp: with pg_temp left out, the caller's temporary schema is searched
-- first for table names, and a temporary table named moderators would make its creator a moderator here.

-- Whether the signed-in player is a moderator. Stable, so the app calls it as GET. Security definer
-- because nobody can read moderators directly - which is also why the storage policies at the bottom
-- call this instead of reading the table themselves.
create or replace function public.is_moderator()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from moderators where user_id = auth.uid());
$$;

-- Reports a player (exact username) for one of the four reasons, with an optional note.
create or replace function public.report_player(p_username text, p_reason text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  -- One line of plain text: runs of whitespace (line breaks included) become one space, the characters a bio
  -- may not carry go, and the ends are trimmed. profile-rules.mjs's cleanNote is written to match this
  -- exactly - a bio's rule, but with THIS function's idea of whitespace, which is Postgres's and takes no
  -- non-breaking space where JS's does. tests/mock-moderation.mjs calls that same function.
  --
  -- The note is the one free-text field that took anything at all, and it is read by a moderator deciding
  -- what to do about somebody. A right-to-left override (U+202E) makes it read as something other than what
  -- was typed, and the zero-width characters hide words from the eye entirely. Stripped rather than refused,
  -- because turning down a report over a character nobody can see means the thing being reported goes
  -- unreported - and the report sheet has already shown the reporter the cleaned text.
  -- The whitespace class is spelled out rather than written as \s. Postgres's \s is [[:space:]], which is
  -- resolved through LC_CTYPE: under C it is the six ASCII characters below, but under en_US.UTF-8 - which
  -- is what a Supabase database is created with - it ALSO matches U+0085, U+2000-U+200A, U+2028, U+2029,
  -- U+205F and U+3000. So the rule would have been one thing in the tests (PGlite reports datcollate = C)
  -- and another on the live site, and the note a moderator read would not be the note cleanNote showed the
  -- reporter. Written out, both sides agree wherever this runs.
  v_note text := btrim(regexp_replace(
                   regexp_replace(coalesce(p_note, ''), '[ \t\n\r\f\v]+', ' ', 'g'),
                   U&'[\0001-\001F\007F-\009F\061C\200B\200E\200F\2028\2029\202A-\202E\2060-\2064\2066-\206F\FEFF]', '', 'g'));
begin
  if v_uid is null or not exists (select 1 from profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  -- And not a guest. The ten-reports-a-day cap is per account, and since v1.17.0 an account costs nothing:
  -- an anonymous sign-in gets a profile row immediately, so six throwaway guests put 24 open reports on
  -- somebody. Every other guest-sensitive surface got this check when guests shipped (submit-run's
  -- guest_daily, can_play_versus) - the queue did not.
  if exists (select 1 from profiles where id = v_uid and guest) then
    raise exception 'guest_not_allowed' using errcode = 'P0001';
  end if;
  select id into v_target from profiles where username = p_username;
  if v_target is null then
    raise exception 'no_such_player' using errcode = 'P0001';
  end if;
  if v_target = v_uid then
    raise exception 'self' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('picture', 'bio', 'username', 'other') then
    raise exception 'bad_reason' using errcode = 'P0001';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;
  -- One report at a time per reporter, so a burst of simultaneous requests can't all pass the count
  -- below before any of them is inserted.
  perform pg_advisory_xact_lock(hashtextextended('report_player:' || v_uid::text, 0));
  -- Resolved reports still count: a moderator dismissing reports doesn't hand the reporter more.
  if (select count(*) from reports where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'limit' using errcode = 'P0001';
  end if;
  if exists (select 1 from reports where reporter_id = v_uid and target_id = v_target and reason = p_reason and status = 'open') then
    raise exception 'duplicate' using errcode = 'P0001';
  end if;
  begin
    insert into reports (reporter_id, target_id, reason, note) values (v_uid, v_target, p_reason, v_note);
  exception when unique_violation then
    raise exception 'duplicate' using errcode = 'P0001';
  end;
  return jsonb_build_object('ok', true);
end;
$$;

-- The Reports queue: one entry per player with open reports, oldest first. Stable, so it's a GET.
create or replace function public.mod_queue()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not is_moderator() then
    raise exception 'not_moderator' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(q.entry order by q.oldest, q.username)
      from (
        select p.username, min(r.created_at) as oldest,
               jsonb_build_object(
                 'user_id', p.id, 'username', p.username,
                 'avatar_path', d.avatar_path, 'avatar_preset', d.avatar_preset,
                 -- No details row means the player never saved anything: no bio, no picture, no team.
                 'bio', coalesce(d.bio, ''), 'favorite_team', d.favorite_team,
                 'reports', jsonb_agg(jsonb_build_object(
                   'id', r.id, 'reason', r.reason, 'note', r.note, 'reporter', rp.username, 'created_at', r.created_at
                 ) order by r.created_at, r.id)
               ) as entry
          from reports r
          join profiles p on p.id = r.target_id
          left join profiles rp on rp.id = r.reporter_id
          left join profile_details d on d.user_id = p.id
         where r.status = 'open'
         group by p.id, p.username, d.avatar_path, d.avatar_preset, d.bio, d.favorite_team
      ) q
  ), '[]'::jsonb);
end;
$$;

-- A moderator's action on one player. Each resolves the reports it answers: remove_picture the
-- picture reports, clear_bio the bio reports, rename the username reports, dismiss every open one.
-- It doesn't touch storage: remove_picture returns the old path and the app deletes the file, which
-- the moderator storage policies below allow.
create or replace function public.mod_act(p_user_id uuid, p_action text, p_new_name text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mod uuid := auth.uid();
  v_reason text;
  v_removed text;
begin
  if not is_moderator() then
    raise exception 'not_moderator' using errcode = 'P0001';
  end if;
  if p_user_id is null or not exists (select 1 from profiles where id = p_user_id) then
    raise exception 'no_such_player' using errcode = 'P0001';
  end if;

  if p_action = 'remove_picture' then
    select avatar_path into v_removed from profile_details where user_id = p_user_id for update;
    update profile_details set avatar_path = null, avatar_preset = null, updated_at = now() where user_id = p_user_id;
    v_reason := 'picture';
  elsif p_action = 'clear_bio' then
    update profile_details set bio = '', updated_at = now() where user_id = p_user_id;
    v_reason := 'bio';
  elsif p_action = 'rename' then
    -- The same rules as signing up (check_username): the username rule, an exact match for taken, and
    -- the word filter.
    if p_new_name is null or p_new_name !~ '^[A-Za-z0-9_]{3,16}$' then
      raise exception 'invalid' using errcode = 'P0001';
    end if;
    -- A reserved name another account holds in any capitalization counts as taken
    -- (migration-profiles.sql's username_is_reserved).
    if exists (select 1 from profiles where username = p_new_name) or username_is_reserved(p_new_name) then
      raise exception 'taken' using errcode = 'P0001';
    end if;
    if not text_is_clean(p_new_name) then
      raise exception 'blocked' using errcode = 'P0001';
    end if;
    begin
      -- The username column only: nothing else about the account changes.
      -- `guest` goes with the name: claim_username's one exception fires on it, so a guest a moderator
      -- had just renamed could turn round and rename itself again, over the moderator's decision.
      update profiles set username = p_new_name, guest = false where id = p_user_id;
    exception when unique_violation then
      raise exception 'taken' using errcode = 'P0001';
    end;
    -- Every board reads these snapshots rather than joining profiles, so they follow the new name.
    update runs set username = p_new_name where user_id = p_user_id;
    update daily_runs set username = p_new_name where user_id = p_user_id;
    -- `guest` goes with the name here too: mod_act above has just cleared it on the profile.
    update sou_runs set username = p_new_name, guest = false where user_id = p_user_id;
    update builds set username = p_new_name where user_id = p_user_id;
    v_reason := 'username';
  elsif p_action = 'dismiss' then
    v_reason := null;
  else
    raise exception 'bad_action' using errcode = 'P0001';
  end if;

  update reports
     set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
         resolved_by = v_mod, resolved_at = now(), action = p_action
   where target_id = p_user_id and status = 'open' and (p_action = 'dismiss' or reason = v_reason);

  return jsonb_build_object('ok', true, 'removed_path', v_removed);
end;
$$;

-- Callable by signed-out visitors too, so they get the functions' own answers (false, not_signed_in,
-- not_moderator) rather than a permission error.
grant execute on function public.is_moderator() to anon, authenticated;
grant execute on function public.report_player(text, text, text) to anon, authenticated;
grant execute on function public.mod_queue() to anon, authenticated;
grant execute on function public.mod_act(uuid, text, text) to anon, authenticated;

-- ---------- Storage ----------
-- Moderators can read and delete any picture in the avatars bucket (deleting through the Storage API
-- needs select as well as delete). These sit beside migration-profiles.sql's own-folder policies;
-- policies are permissive, so a player keeps access to their own folder and a moderator gets the rest.
-- is_moderator() is wrapped in a select so Postgres asks once per statement, not once per object.
drop policy if exists "moderators can read any avatar" on storage.objects;
create policy "moderators can read any avatar" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (select public.is_moderator()));

drop policy if exists "moderators can delete any avatar" on storage.objects;
create policy "moderators can delete any avatar" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (select public.is_moderator()));
