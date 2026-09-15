-- Migration: profiles (v1.11.0) - bios, pictures, favorite teams, the word filter, and one-read
-- profile lookups. Run AFTER migration-runs-log.sql (player_profile calls its player_stats), before
-- shipping the client that reads it. Staging first, then production. Safe to re-run: every object is
-- create-if-missing / create-or-replace, policies and the bio character rule are dropped and re-created,
-- and the seeds never overwrite what's already there (re-running can't switch uploads back on or undo a
-- word-list edit). The one change a re-run can make to data: a bio saved under an older, shorter character
-- rule has each character the current rule refuses replaced by a space.
--
-- Contract: PROFILES.md. Only adds objects (plus a stricter handle_new_user), so the site that's live
-- when this runs keeps working.
--
-- Security model: the new tables have row-level security on and no client write policy at all. Players
-- change their own row only through the security definer functions below, which check who is asking
-- and enforce every limit and the word filter - a modified browser can call them directly, so every
-- check that matters is here. tests/mock-profile-data.mjs mirrors all of this for the jsdom tests, and
-- tests/test-profile-data.mjs and tests/test-word-filter.mjs check the two agree.
--
-- Runbook:
--   Pause all new picture uploads:  update public.site_flags set enabled = true where key = 'uploads_paused';
--   Resume them:                    update public.site_flags set enabled = false where key = 'uploads_paused';
--   Block another word:             insert into public.blocked_words (word, match) values ('...', 'word');
--                                   ('word' = whole word only; 'anywhere' = even inside other words - only
--                                   for strings that never occur inside ordinary words or names)
--
-- Every security definer function below sets search_path = public, pg_temp. Left out of the path, the
-- caller's temporary schema is searched first for table names, so a session that can create a temporary
-- table named moderators or blocked_words would have these functions read that instead of the real one.
-- Naming pg_temp last keeps the real tables first (tests/test-profile-security.mjs tries it).

-- ---------- Tables ----------

-- The default avatars a player can pick. The keys are profile-rules.mjs's FREE_AVATAR_PRESETS, which
-- avatars.jsx draws. v1.12.0 adds paid packs (free = false).
create table if not exists public.avatar_presets (
  key   text primary key,
  pack  text not null,
  free  boolean not null
);
insert into public.avatar_presets (key, pack, free) values
  ('football', 'starter', true), ('helmet', 'starter', true), ('trophy', 'starter', true),
  ('whistle', 'starter', true), ('foam-finger', 'starter', true), ('goalposts', 'starter', true),
  ('clipboard', 'starter', true), ('stopwatch', 'starter', true), ('megaphone', 'starter', true),
  ('jersey', 'starter', true), ('lightning', 'starter', true), ('crown', 'starter', true)
on conflict (key) do update set pack = excluded.pack, free = excluded.free;

-- What a player has chosen to show. A row exists only once they've saved something; no row reads as
-- "nothing set". v1.12.0 only adds columns.
create table if not exists public.profile_details (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  -- One line of plain text: profile-rules.mjs's BIO_MAX here, and none of its disallowed characters (the
  -- named constraint below).
  bio            text not null default ''
                 check (char_length(bio) <= 160),
  -- An uploaded picture in the player's own folder of the avatars bucket: "<user_id>/<ms>.<ext>"
  -- (profile-rules.mjs's avatarObjectPath). A new name every upload, so no cache shows the old one.
  avatar_path    text check (avatar_path is null or (
                   avatar_path ~ '^[^/]*/[0-9]{10,16}\.(webp|jpg|png)$' and split_part(avatar_path, '/', 1) = user_id::text)),
  avatar_preset  text references public.avatar_presets(key),
  favorite_team  text check (favorite_team is null or favorite_team in (
                   'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
                   'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS')),
  updated_at     timestamptz not null default now(),
  -- A picture is a photo or a default avatar, never both.
  check (avatar_path is null or avatar_preset is null)
);

-- The characters a bio may not contain: profile-rules.mjs's disallowed set - control characters, line and
-- paragraph separators, and the invisible or direction-changing ones. A named constraint, replaced on every
-- run, because `create table if not exists` leaves an existing table alone: a database set up by the first
-- version of this file has that version's shorter list as an unnamed check, profile_details_bio_check1.
alter table public.profile_details drop constraint if exists profile_details_bio_check1;
alter table public.profile_details drop constraint if exists profile_details_bio_characters;
-- A bio saved under the shorter list can hold a character this one refuses, and the constraint can't be
-- added over it. Each becomes a space rather than nothing: removing an invisible character could join the
-- letters around it into a blocked word the filter never saw.
update public.profile_details
   set bio = btrim(regexp_replace(bio, U&'[\0001-\001F\007F-\009F\061C\200B\200E\200F\2028\2029\202A-\202E\2060-\2064\2066-\206F\FEFF]', ' ', 'g'))
 where bio ~ U&'[\0001-\001F\007F-\009F\061C\200B\200E\200F\2028\2029\202A-\202E\2060-\2064\2066-\206F\FEFF]';
alter table public.profile_details add constraint profile_details_bio_characters
  check (bio !~ U&'[\0001-\001F\007F-\009F\061C\200B\200E\200F\2028\2029\202A-\202E\2060-\2064\2066-\206F\FEFF]');

-- The word filter's list. Nobody reads it but text_is_clean (no policies, no grants), so it can't be
-- downloaded and worked around.
create table if not exists public.blocked_words (
  word   text primary key check (word ~ '^[a-z]+$'),
  match  text not null default 'word' check (match in ('word', 'anywhere'))
);
-- Basic and clearly offensive only (PROFILES.md 3.4). Profanity matches as a whole word; slurs match
-- anywhere, except slurs that also turn up inside ordinary words or names, which stay whole-word.
-- Nothing here may be a common name or a football term, and no 'anywhere' entry may occur inside
-- ordinary words: tests/test-word-filter.mjs passes every player name, team and city through the filter.
insert into public.blocked_words (word, match) values
  ('asshole', 'word'), ('bitch', 'word'), ('blowjob', 'word'), ('bullshit', 'word'), ('cocksucker', 'word'),
  ('cunt', 'word'), ('dickhead', 'word'), ('dildo', 'word'), ('dipshit', 'word'), ('faggot', 'anywhere'),
  ('fuck', 'anywhere'), ('gook', 'word'), ('jizz', 'word'), ('nigga', 'anywhere'), ('nigger', 'anywhere'),
  ('raghead', 'word'), ('retard', 'word'), ('retarded', 'word'), ('shit', 'word'), ('shithead', 'word'),
  ('shitty', 'word'), ('slut', 'word'), ('towelhead', 'word'), ('twat', 'word'), ('wanker', 'word'),
  ('wetback', 'word'), ('whore', 'word')
on conflict (word) do nothing;

-- Sitewide switches. uploads_paused is the upload kill switch (see the runbook above); the avatar
-- picker may read it.
create table if not exists public.site_flags (
  key      text primary key,
  enabled  boolean not null default false
);
insert into public.site_flags (key, enabled) values ('uploads_paused', false)
on conflict (key) do nothing;

alter table public.avatar_presets enable row level security;
alter table public.profile_details enable row level security;
alter table public.blocked_words enable row level security;
alter table public.site_flags enable row level security;

drop policy if exists "avatar presets are publicly readable" on public.avatar_presets;
create policy "avatar presets are publicly readable" on public.avatar_presets for select using (true);
drop policy if exists "profile details are publicly readable" on public.profile_details;
create policy "profile details are publicly readable" on public.profile_details for select using (true);
drop policy if exists "site flags are publicly readable" on public.site_flags;
create policy "site flags are publicly readable" on public.site_flags for select using (true);
-- No insert/update/delete policy on any of the four, and none at all on blocked_words.
revoke all on public.blocked_words from anon, authenticated;

-- ---------- The word filter ----------
-- True when a text has none of the blocked words. Used for bios, new usernames and moderator renames.
-- It only reads a normalized copy; the text itself is never changed. PROFILES.md 3.4:
--   1. Normalize with NFKC, so compatibility forms read as the characters they stand for (full-width,
--      mathematical, circled and superscript letters, ligatures), then NFD, so every accented letter is
--      its letter plus accents. (Without NFD, NFKC would rejoin an accent typed after a letter into an
--      accented letter the fold table doesn't list, and that letter would split the word.)
--   2. Drop invisible characters (zero-width, soft hyphen, fillers, direction and format controls,
--      variation selectors, tags) and combining marks; spell out sharp s, ae and oe; fold every letter
--      that stands for a plain one to that lowercase letter - ASCII capitals, the Latin letters whose mark
--      NFD can't split off (o, d, h, l and t with stroke, eth, dotless i, kra, script a and g), and
--      Cyrillic and Greek look-alikes. Lowercasing only through this table (never lower()) keeps the result
--      independent of the database locale and identical to the browser mock.
--   3. Read the text four ways: with the look-alikes 0 1 3 4 5 7 @ $ ! | as o i e a s t a s i l, and as
--      typed (those characters also sit next to words as punctuation or numbers: "shit!", "fuck1"); and
--      in each, every run of three or more of one letter cut to one ("fuuuck") and cut to two (a doubled
--      letter tripled: "fagggot").
--   4. A 'word' entry matches a whole token (split on anything that isn't a letter), or a token that is
--      the word plus "s" or "es". An 'anywhere' entry matches inside the letters with everything else
--      removed, so spaces or dots between the letters don't hide it.
-- normalize() uses the database's Unicode tables and the mock uses the browser's, so a character added to
-- Unicode after the database's version isn't normalized here; tests/test-word-filter.mjs sticks to
-- characters both know.
create or replace function public.text_is_clean(t text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with
  fold(src, dst) as (values
      (U&'A\0251\0410\0430\0391\03B1', 'a'),
      (U&'B\0412\0392', 'b'),
      (U&'C\0421\0441', 'c'),
      (U&'D\00D0\00F0\0110\0111\0501', 'd'),
      (U&'E\0415\0435\0395', 'e'),
      (U&'F', 'f'),
      (U&'G\0261', 'g'),
      (U&'H\0126\0127\041D\04BB\0397', 'h'),
      (U&'I\0131\0406\0456\0399\03B9', 'i'),
      (U&'J\0408\0458', 'j'),
      (U&'K\0138\041A\043A\039A\03BA', 'k'),
      (U&'L\0141\0142\04CF', 'l'),
      (U&'M\041C\039C', 'm'),
      (U&'N\039D', 'n'),
      (U&'O\00D8\00F8\041E\043E\039F\03BF', 'o'),
      (U&'P\0420\0440\03A1\03C1', 'p'),
      (U&'Q', 'q'),
      (U&'R', 'r'),
      (U&'S\0405\0455', 's'),
      (U&'T\0166\0167\0422\03A4\03C4', 't'),
      (U&'U\03C5', 'u'),
      (U&'V\03BD', 'v'),
      (U&'W', 'w'),
      (U&'X\0425\0445\03A7\03C7', 'x'),
      (U&'Y\0423\0443\03A5', 'y'),
      (U&'Z\0396', 'z')
  ),
  prepared as (
    select translate(
             replace(replace(replace(replace(replace(replace(
               regexp_replace(normalize(normalize(coalesce(t, ''), NFKC), NFD),
                 U&'[\00AD\0300-\036F\061C\115F-\1160\17B4-\17B5\180B-\180F\1AB0-\1AFF\1DC0-\1DFF\200B-\200F\202A-\202E\2060-\206F\20D0-\20FF\3164\FE00-\FE0F\FE20-\FE2F\FEFF\FFA0\FFF9-\FFFB\+0E0000-\+0E0FFF]',
                 '', 'g'),
               U&'\00DF', 'ss'), U&'\1E9E', 'ss'), U&'\00E6', 'ae'), U&'\00C6', 'ae'), U&'\0153', 'oe'), U&'\0152', 'oe'),
             (select string_agg(src, '' order by dst) from fold),
             (select string_agg(repeat(dst, char_length(src)), '' order by dst) from fold)) as s
  ),
  readings as (
    select regexp_replace(m.s, '([a-z])\1\1+', cut.keep, 'g') as s
      from (select translate(s, '013457@$!|', 'oieastasil') as s from prepared
            union all
            select s from prepared) as m
     cross join (values ('\1'), ('\1\1')) as cut(keep)
  ),
  tokens as (
    select tok from readings, regexp_split_to_table(readings.s, '[^a-z]+') as tok where tok <> ''
  ),
  candidates as (
    select tok as w from tokens
    union select left(tok, -1) from tokens where tok like '%s'
    union select left(tok, -2) from tokens where tok like '%es'
  )
  select not exists (select 1 from blocked_words b join candidates c on c.w = b.word where b.match = 'word')
     and not exists (select 1 from blocked_words b join readings r
                       on strpos(regexp_replace(r.s, '[^a-z]+', '', 'g'), b.word) > 0
                      where b.match = 'anywhere');
$$;
-- Only the functions below call it: letting clients probe it would just be a slower way to read the list.
revoke execute on function public.text_is_clean(text) from public, anon, authenticated;

-- ---------- Saving your own profile ----------
-- A function refusing something raises its code as the whole message; storage-profile.js maps it to a
-- reason the screen puts into words.

-- Your bio and favorite team, saved together. Leaves the picture alone.
create or replace function public.save_profile(p_bio text, p_favorite_team text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  -- Trimmed of exactly what JavaScript's trim() removes, so the browser and the database agree on the
  -- length of the same bio.
  v_bio text := btrim(coalesce(p_bio, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  v_row public.profile_details;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if char_length(v_bio) > 160 then
    raise exception 'bio_too_long' using errcode = 'P0001';
  end if;
  -- profile-rules.mjs's disallowed characters, the same set as the profile_details_bio_characters constraint.
  if v_bio ~ U&'[\0001-\001F\007F-\009F\061C\200B\200E\200F\2028\2029\202A-\202E\2060-\2064\2066-\206F\FEFF]' then
    raise exception 'bio_invalid' using errcode = 'P0001';
  end if;
  if not public.text_is_clean(v_bio) then
    raise exception 'bio_blocked' using errcode = 'P0001';
  end if;
  if p_favorite_team is not null and p_favorite_team not in (
       'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC',
       'LA', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS') then
    raise exception 'bad_team' using errcode = 'P0001';
  end if;
  insert into public.profile_details as d (user_id, bio, favorite_team)
  values (v_uid, v_bio, p_favorite_team)
  on conflict (user_id) do update set bio = excluded.bio, favorite_team = excluded.favorite_team, updated_at = now()
  returning d.* into v_row;
  return to_jsonb(v_row);
end;
$$;

-- Your picture: an uploaded photo (p_path), a default avatar (p_preset), or neither (both null, back to
-- your initial). Setting one clears the other. It doesn't touch storage: the browser uploads the photo
-- first and deletes the old one after this succeeds.
create or replace function public.set_avatar(p_path text, p_preset text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.profile_details;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not_signed_in' using errcode = 'P0001';
  end if;
  if p_path is not null and p_preset is not null then
    raise exception 'bad_request' using errcode = 'P0001';
  end if;
  -- profile-rules.mjs's isOwnAvatarPath: "<your id>/<10-16 digits>.webp|jpg|png", in your folder only.
  if p_path is not null
     and not (p_path ~ '^[^/]*/[0-9]{10,16}\.(webp|jpg|png)$' and split_part(p_path, '/', 1) = v_uid::text) then
    raise exception 'bad_path' using errcode = 'P0001';
  end if;
  if p_preset is not null and not exists (select 1 from public.avatar_presets where key = p_preset and free) then
    raise exception 'bad_preset' using errcode = 'P0001';
  end if;
  insert into public.profile_details as d (user_id, avatar_path, avatar_preset)
  values (v_uid, p_path, p_preset)
  on conflict (user_id) do update set avatar_path = excluded.avatar_path, avatar_preset = excluded.avatar_preset, updated_at = now()
  returning d.* into v_row;
  return to_jsonb(v_row);
end;
$$;

-- ---------- Usernames ----------

-- Names only one account may hold, in any capitalization (1.11.1). Usernames are otherwise unique only as
-- typed, but "admin" unlocks the testing tools on the draft screen whatever its capitalization
-- (perfect-season.jsx compares it lowercased) - so once an account has it, "Admin" or "ADMIN" can't be
-- signed up with or renamed to. The first account to take the name keeps it, so a fresh database (the
-- tests', or a new project) can still create it.
create or replace function public.username_is_reserved(p_username text)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select lower(coalesce(p_username, '')) in ('admin')
     and exists (select 1 from profiles where lower(username) = lower(p_username));
$$;
-- Only the functions below ask it (they run as its owner).
revoke execute on function public.username_is_reserved(text) from public, anon, authenticated;

-- Whether a username can be signed up with, asked before signing up so the form can say why not:
-- ok | taken | blocked | invalid. Anyone may call it; the signup trigger checks again regardless. A
-- reserved name another account already holds, in any capitalization, is taken.
create or replace function public.check_username(p_username text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$' then 'invalid'
    when exists (select 1 from profiles where username = p_username) then 'taken'
    when username_is_reserved(p_username) then 'taken'
    when not text_is_clean(p_username) then 'blocked'
    else 'ok'
  end;
$$;

-- The signup trigger (first defined in schema.sql, whose trigger on auth.users calls this), now also
-- refusing a username outside the username rule or with a blocked word. Supabase Auth reports the refusal
-- to the browser as "Database error saving new user", and no account is created.
-- The rule is checked here, not only in the signup form: Supabase Auth stores whatever metadata a browser
-- sends, so without it a modified client could sign up as letters the word filter doesn't fold
-- (mathematical or circled letters), with invisible or direction-changing characters, as another
-- player's name with a zero-width space in it, or as an empty or overlong name.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_username text := new.raw_user_meta_data->>'username';
begin
  -- profile-rules.mjs's USERNAME_RE, the same rule as check_username's 'invalid'.
  if v_username is null or v_username !~ '^[A-Za-z0-9_]{3,16}$' then
    raise exception 'username_invalid' using errcode = 'P0001';
  end if;
  -- "Admin" once someone has "admin" (username_is_reserved above).
  if public.username_is_reserved(v_username) then
    raise exception 'username_reserved' using errcode = 'P0001';
  end if;
  -- The word filter, which also reads every run of three or more of one letter cut to two, so a blocked
  -- word hidden by tripling a doubled letter ("Asssshole") is refused here too.
  if not public.text_is_clean(v_username) then
    raise exception 'username_blocked' using errcode = 'P0001';
  end if;
  insert into public.profiles (id, username)
  values (new.id, v_username);
  return new;
end;
$$;

-- ---------- The minigame boards ----------
-- The browser still writes sou_runs (Over/Under) and builds (Build-a-player) itself: schema.sql's policies
-- only check that the row's user_id is the caller's. Scores there are taken on trust (CLAUDE.md), but what
-- the boards and profiles show as text must not be.

-- A row's username is the account's own, whatever the browser sent. Every name on those boards opens that
-- player's profile, so otherwise a modified client could post under another player's name, or as any text
-- at all (past the signup word filter), and a moderator's rename would last only until its next insert.
-- mod_act's rename updates these rows after profiles, so this reads the new name.
create or replace function public.use_account_username()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  new.username := coalesce((select p.username from public.profiles p where p.id = new.user_id), new.username);
  return new;
end;
$$;

-- A build's position shows as text on the Stats board and the player's profile, and the Stats board calls
-- toFixed on its overall. PostgREST sends a NaN or Infinity numeric as a string, so one such row (NaN also
-- sorts above every number, straight to the top of the board) crashed the Stats screen for everyone. Only
-- new rows are checked: nothing updates a build but a rename, which must still work on an old bad row.
create or replace function public.check_new_build()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  -- abs() of NaN or Infinity is never under a bound, so this also asks for a finite number.
  if new.pos is null or new.pos not in ('QB', 'RB', 'WR', 'TE') or not coalesce(abs(new.overall) < 1e12, false) then
    raise exception 'bad_build' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Trigger functions only: nothing calls them directly (a trigger runs without its caller holding execute).
revoke execute on function public.use_account_username(), public.check_new_build() from public, anon, authenticated;

drop trigger if exists sou_runs_account_username on public.sou_runs;
create trigger sou_runs_account_username before insert or update on public.sou_runs
  for each row execute function public.use_account_username();
drop trigger if exists builds_account_username on public.builds;
create trigger builds_account_username before insert or update on public.builds
  for each row execute function public.use_account_username();
drop trigger if exists builds_check_new on public.builds;
create trigger builds_check_new before insert on public.builds
  for each row execute function public.check_new_build();

-- ---------- Reading a profile ----------

-- For player_profile's case-insensitive lookup (gridspin.app/u/Name typed in any case).
create index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- Everything the profile screen shows for one player, in one read: { profile, details, stats }, or null
-- when there's no such player. An exact username match wins; otherwise a case-insensitive match counts
-- only when exactly one account has that name in any case. Security invoker over publicly readable
-- tables, so it shows nothing a direct select couldn't.
create or replace function public.player_profile(p_username text)
returns jsonb language sql stable security invoker set search_path = public as $$
  with
  exact as (select p.* from profiles p where p.username = p_username),
  loose as (select p.* from profiles p where lower(p.username) = lower(p_username)),
  target as (
    select * from exact
    union all
    select * from loose where not exists (select 1 from exact) and (select count(*) from loose) = 1
  )
  select jsonb_build_object(
    'profile', to_jsonb(t),
    'details', (select to_jsonb(d) from profile_details d where d.user_id = t.id),
    'stats', player_stats(t.id)
  )
  from target t;
$$;

grant execute on function public.save_profile(text, text), public.set_avatar(text, text),
  public.check_username(text), public.player_profile(text) to anon, authenticated;

-- ---------- Pictures: the avatars bucket ----------
-- Public, so a picture loads from its address with no signed URL. The size and type limits are the
-- bucket's own (profile-rules.mjs's AVATAR_MAX_BYTES and AVATAR_TYPES); the browser checks them first
-- only to give a friendlier message.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 262144, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  name = excluded.name, public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Whether the caller's avatars folder has room for one more file: at most 10. The app keeps one photo
-- there at a time, deleting the one it replaces, so 10 leaves room for leftovers from failed deletes while
-- a script can't fill the bucket. The insert policy below calls it, so the invoking player needs execute.
-- Security invoker: it counts what the caller's own select policy shows, which is all of their folder, and
-- doesn't depend on the function owner's access to storage.objects. Uploads by one player take their turn
-- (the lock), and the count is taken after the wait - a volatile function's query sees what committed
-- meanwhile - so a burst of simultaneous uploads can't all find room for one more.
create or replace function public.avatar_folder_has_room()
returns boolean language plpgsql volatile security invoker set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('avatar_folder:' || auth.uid()::text, 0));
  return (select count(*) from storage.objects o
           where o.bucket_id = 'avatars' and o.name like (auth.uid()::text || '/%')) < 10;
end;
$$;
revoke execute on function public.avatar_folder_has_room() from public, anon;
grant execute on function public.avatar_folder_has_room() to authenticated;

-- A signed-in player works only inside their own folder, "<their id>/...". A file they add, or rename, must
-- be named exactly as the app names uploads - "<their id>/<10-16 digits>.webp|jpg|png", one level and
-- nothing else (profile-rules.mjs's isOwnAvatarPath) - and adding one needs room in the folder. Adding or
-- replacing a file also requires uploads not to be paused - replacing counts, or the kill switch could be
-- sidestepped by overwriting an existing picture. Reading and deleting cover the whole folder, so anything
-- already there can still be cleared out. Supabase needs select as well as delete to delete an object.
-- Moderators get their own policies in migration-moderation.sql.
drop policy if exists "players read their own avatar files" on storage.objects;
create policy "players read their own avatar files" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "players upload avatar files to their own folder" on storage.objects;
create policy "players upload avatar files to their own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and name ~ '^[^/]+/[0-9]{10,16}\.(webp|jpg|png)$' and split_part(name, '/', 1) = auth.uid()::text
    and not coalesce((select f.enabled from public.site_flags f where f.key = 'uploads_paused'), false)
    and public.avatar_folder_has_room()
  );

drop policy if exists "players update their own avatar files" on storage.objects;
create policy "players update their own avatar files" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (
    bucket_id = 'avatars'
    and name ~ '^[^/]+/[0-9]{10,16}\.(webp|jpg|png)$' and split_part(name, '/', 1) = auth.uid()::text
    and not coalesce((select f.enabled from public.site_flags f where f.key = 'uploads_paused'), false)
  );

drop policy if exists "players delete their own avatar files" on storage.objects;
create policy "players delete their own avatar files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
