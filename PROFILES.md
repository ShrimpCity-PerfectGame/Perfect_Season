# PROFILES.md — the v1.11.0 Profiles contract

This is the build contract for **Gridspin v1.11.0 Profiles**. Six agents build it in parallel, each
owning separate files (see [Who owns what](#who-owns-what)), and every piece is built against this
document. **If something here turns out to be wrong or impossible, stop and report it — don't improvise
a different contract.** After release this file stays as the reference for how profiles work (like
`SCORING.md` for scoring). CLAUDE.md's rules all still apply.

v1.12.0 (Wallet & Shop) built on this, and `SHOP.md` is its reference: `profile_details` grew `frame`,
`card_theme`, `title` and `showcase`, `set_avatar` accepts the paid packs' avatars, and the player card now
wears a card theme (SHOP.md 7.3) - where this file says "navy", read "Navy, the default card theme".

---

## 1. What ships

The owner approved all of this (2026-09-14):

- **Player card** on every profile: picture (uploaded photo, one of 12 free default avatars, or the
  player's initial), username, favorite team, the player's three best badges, bio, "Drafting since"
  month, daily streak. Your own card has **Edit profile**, **Share profile** and **Log out**; a
  signed-in visitor gets **Share profile** and **Report**; a guest gets **Share profile**.
- **Photo upload**: choose a photo, drag/zoom it into a circle, and the browser makes a 256×256 WebP
  (JPEG where WebP can't be encoded), at most 256 KB, with all metadata (including GPS) gone.
- **Bios**: one line of plain text, at most 160 characters, checked against a **blocked-word list** in
  the database. The same list checks **new usernames** at signup.
- **Favorite team**: any of the 32 teams, or none.
- **Personal stats**: headline tiles, badges, seasons by wins (chart), record by mode, best lineups,
  go-to players and most-drafted team, records, minigames, recent drafts.
- **Badges**: 22 of them, worked out from stats the site already keeps (retroactive, never lost).
- **Public profiles** at `gridspin.app/u/<username>`, viewable by anyone, **noindexed** for now. Every
  username on the Leaderboard and Stats screens (and the Over/Under and builds boards) opens that
  player's profile; Back returns where you were.
- **Report** (signed-in only): Picture, Bio, Username or Something else, with an optional note. Limits:
  one open report per reporter per player per reason, 10 reports per reporter per rolling 24 hours.
- **Moderation**: moderators (the owner, added by SQL) get a **Reports** queue on their own profile:
  reports grouped by player, with Remove picture, Clear bio, Rename player and Dismiss.
- **Upload kill switch**: one SQL line pauses all new uploads.

Not in v1.11.0: pictures beside names on the Leaderboard, badge earned dates, players changing their
own username, private profiles, profile link previews, coins, the shop.

---

## 2. How it fits together

```
perfect-season.jsx (E) ── routing /u/name, name links, header picture, wires the screens
   ├─ profile.jsx (C) ─────── ProfileScreen: card, sections, badge grid, editor
   │     ├─ avatars.jsx (D) ─ Avatar, the 12 default avatar drawings
   │     ├─ avatar-picker.jsx (D) + avatar-image.mjs (D) ─ upload/crop/encode, choose a default
   │     ├─ moderation.jsx (F) ─ ReportSheet
   │     └─ badges.mjs (A) ─ which badges are earned
   ├─ moderation.jsx (F) ──── ModerationQueue (the Reports screen)
   └─ storage.js ─ re-exports storage-profile.js (B) and storage-moderation.js (F)
                      └─ database functions: migration-profiles.sql (B), migration-moderation.sql (F),
                         player_stats in migration-runs-log.sql (A)
```

**Security model.** `profiles` stays written only by submit-run (and, new, a moderator rename — the
username column only). The new tables have **row-level security on and no client write policies at
all**: the client changes them only through `security definer` database functions, which check who is
asking and enforce every limit and the word filter. A modified browser can call those functions
directly, so every check that matters lives in SQL; the browser's own checks are only for friendly
messages. Pictures go in a public Storage bucket whose policies let a player write only inside their own
folder.

**Deploy order** (the lead does this): `migration-runs-log.sql` (re-run; adds `player_stats`) →
`migration-profiles.sql` → `migration-moderation.sql` → client. No Edge Function change.

---

## 3. Database

All new SQL is re-runnable (`create ... if not exists`, `create or replace`, `drop policy if exists` then
`create policy`, `on conflict do nothing` / `do update` for seeds). Every function sets its search path:
security-definer functions and trigger functions use `set search_path = public, pg_temp` (temporary
objects last, so a session can't shadow `moderators` or `blocked_words` with a temp table), read-only
security-invoker ones `public`. Functions that only read are `stable` so the client can call them as GET
(they get supabase-js's retry). Every `order by` is fully tiebroken.

A function refusing something raises its code as the whole message, e.g.
`raise exception 'bio_blocked' using errcode = 'P0001';` — PostgREST returns it as
`{ message: "bio_blocked", code: "P0001" }` and the storage modules map the message to a reason.

`revoke execute ... from public, anon, authenticated` (all three — Postgres grants `public` execute by
default) for any function clients must not call directly.

### 3.1 `migration-profiles.sql` (agent B)

**`profile_details`**

| column | type | rule |
|---|---|---|
| `user_id` | uuid, primary key | references `public.profiles(id) on delete cascade` |
| `bio` | text not null default `''` | `char_length(bio) <= 160`; no characters from profile-rules.mjs's disallowed set (the named constraint `profile_details_bio_characters`, which a re-run replaces) |
| `avatar_path` | text, null | null, or `<user_id>/<10–16 digits>.(webp\|jpg\|png)` — the row's own folder |
| `avatar_preset` | text, null | references `avatar_presets(key)` |
| `favorite_team` | text, null | null or one of the 32 TEAMS codes |
| `updated_at` | timestamptz not null default now() | |

RLS on; `select using (true)`; no insert/update/delete policy. A row exists only once the player has
saved something; no row reads as "nothing set".

**Guests (v1.17.0).** `profiles.guest` (boolean, default false) marks an account the site made for a visitor
who finished a season - Supabase's anonymous sign-in. The signup trigger gives it a profile immediately (the
season is already waiting for one) with a name from `new_guest_name()`: `Guest_` and five hex characters, a shape
`username_is_reserved` holds back from everyone else, so a guest's name reads as one wherever it's shown. A guest
plays and posts like anyone else except the daily, which `submit-run` refuses for it (`guest_daily`, 403), and it
has no profile screen or shop in the app. `claim_username` is the way out: it is allowed to replace a guest's
name (once - the flag clears), and it rewrites the account's name snapshots in `runs`, `daily_runs`, `sou_runs`
and `builds`, exactly as `mod_act`'s rename does.

**What a guest is refused, and where the refusal lives.** Every one of these is in SQL, because these functions
and policies are the boundary - a modified browser calls them directly, and the app's own version of the rule is
only manners. `save_profile`, `set_avatar`, `report_player` (v2.0.0), `shop_buy`, `equip_item` and `set_showcase`
(v2.0.0) raise **`guest_not_allowed`**; `submit-run` refuses a daily (`guest_daily`); `can_play_versus` refuses a
duel. **The `avatars` bucket refuses one too** (v2.0.0) - its insert and update policies call
`caller_is_guest()`, alongside the `uploads_paused` kill switch and for the same reason: gating only the
function left the gate cosmetic, because an anonymous sign-in could skip `set_avatar` and insert straight into
`storage.objects`, putting ten files in a **public** bucket - ten working unauthenticated addresses - on an
account that costs nothing to make again, stopped only by the per-folder cap. Reading and deleting stay open, so
anything already there can still be cleared out. What a guest is **not** refused is coins: `claim_minigame` and
submit-run's rewards pay one like anyone else, and what it earns waits for the name it claims.

`guest_not_allowed` has to be mapped in **every** client module that can receive it - `storage-profile.js`'s
`SAVE_REASONS` and `AVATAR_REASONS`, `storage-shop.js`'s `BUY_REASONS`, `EQUIP_REASONS` and `SHOWCASE_REASONS`,
`storage-moderation.js`'s `REPORT_REFUSALS` - or `rpcReason` falls through to `"network"` and the player is told
to check their connection, forever, for a rule rather than a fault. That is not a thing to remember: the code
tables are checked against the functions' own source by `tests/test-profile-data.mjs` and
`tests/test-shop-sql.mjs`, so a new code cannot arrive without a decision. The upload has no code to read at all
(RLS just refuses), so `storage-profile.js` asks `caller_is_guest()` - the same function the policy calls, not a
second opinion.

**An account with no profile row (v1.16.0).** Signing in with Google makes an `auth.users` row with no
username, and `handle_new_user` writes no `profiles` row for it. That state is deliberate and is what the
app watches for: a session whose `fetchProfile` comes back null is an account that hasn't picked a name.
Nothing reads such an account - it is on no board, owns nothing, has no wallet (the welcome coins ride on
the `profiles` insert), and `submit-run` already answers `no profile for this account`, so a modified
client can't record a season under it either. `claim_username` is what ends the state.

**`avatar_presets`** `(key text primary key, pack text not null, free boolean not null)`, seeded with
exactly the 12 keys in profile-rules.mjs's `FREE_AVATAR_PRESETS`, pack `'starter'`, free `true`. RLS on,
public select. (v1.12.0 adds paid packs.)

**`blocked_words`** `(word text primary key, match text not null default 'word')` — `word` lowercase
letters only; `match` is `'word'` (whole word) or `'anywhere'` (substring). RLS on, **no policies**:
nobody can read the list except the functions. Seed a basic list (see [3.4](#34-the-word-filter)).

**`site_flags`** `(key text primary key, enabled boolean not null default false)`, seeded with
`('uploads_paused', false)`. RLS on, public select (the picker may read it). The kill switch:
`update site_flags set enabled = true where key = 'uploads_paused';`

**Storage bucket** `avatars`: `public = true`, `file_size_limit = 262144`,
`allowed_mime_types = {image/webp,image/jpeg,image/png}` (insert … on conflict (id) do update). Policies
on `storage.objects`, all `to authenticated`, all requiring `bucket_id = 'avatars'` and
`(storage.foldername(name))[1] = auth.uid()::text`: select and delete (the whole folder); insert, which
also requires the exact name `<auth.uid()>/<10–16 digits>.(webp|jpg|png)`, uploads not paused, and room in
the folder (`avatar_folder_has_room()`: at most 10 files); and update, whose check also requires the exact
name (so a rename can't dodge it) and uploads not paused. (Supabase needs select as well as delete to
delete an object.)

**The minigame boards.** `sou_runs` and `builds` stay browser-written (schema.sql), but a before insert or
update trigger (`use_account_username`) replaces the row's `username` with the account's own, and a before
insert trigger on `builds` (`check_new_build`) refuses a position other than QB/RB/WR/TE or an overall that
isn't a finite number (`bad_build`). Old rows are left alone; after migrating, `update sou_runs set username
= username; update builds set username = username;` rewrites any spoofed names.

**Functions**

| function | returns | notes / raises |
|---|---|---|
| `text_is_clean(t text)` | boolean | security definer, stable. The word filter. Execute revoked from public, anon, authenticated. |
| `save_profile(p_bio text, p_favorite_team text)` | jsonb: the details row `{user_id, bio, avatar_path, avatar_preset, favorite_team, updated_at}` | security definer. Trims `p_bio`. Upserts the caller's row, leaving the picture alone. Raises `not_signed_in`, `bio_too_long`, `bio_invalid` (disallowed character), `bio_blocked`, `bad_team`. |
| `set_avatar(p_path text, p_preset text)` | jsonb: the details row | security definer. At most one non-null (`bad_request`). A path must be in the caller's own folder and match the pattern (`bad_path`); a preset must exist and be free (`bad_preset`). Sets both columns (so choosing one clears the other; both null clears the picture). Doesn't touch storage — the client deletes the old file. Raises `not_signed_in`. |
| `check_username(p_username text)` | text: `ok` \| `taken` \| `blocked` \| `invalid` | security definer, stable, callable by anon. `invalid` unless `^[A-Za-z0-9_]{3,16}$`; `taken` if a profile has exactly that username, or it's a reserved name another account holds in any capitalization; `blocked` if not clean. |
| `username_is_reserved(p_username text)` | boolean | 1.11.1. security invoker, execute revoked from clients. True for a reserved name (`admin`, which unlocks the testing tools whatever its capitalization) when some account already holds it in any capitalization - so the first account keeps it and "Admin" can't join it. Used by `check_username`, the signup trigger (`username_reserved`) and `mod_act`'s rename (`taken`). |
| `handle_new_user()` | trigger | `create or replace` of schema.sql's signup trigger, now raising `username_invalid` for a username outside `^[A-Za-z0-9_]{3,16}$` (a modified client can call Auth's signup directly), `username_reserved` for a reserved name another account holds in any capitalization, and `username_blocked` for one that isn't clean. **v1.16.0:** an account from a provider (`raw_app_meta_data->>'provider'` is not `email`) arrives with no username - Google has none to give - and gets **no profile row at all** until it claims one; an email and password signup still brings its name and still passes every check above. |
| `claim_username(p_username text)` | text: `ok` \| `invalid` \| `taken` \| `blocked` \| `already_named` \| `not_signed_in` | v1.16.0. security definer; execute revoked from anon. The name an account picks for itself, and the only way a profile row is created outside the signup trigger. Same three rules as that trigger (reserved reads as `taken`, as in `check_username`). Refuses once the caller has a profile, **unless it is a guest** (v1.17.0), which may trade the given name for a real one once: that clears `guest` and rewrites the account's name in `runs`, `daily_runs`, `sou_runs` and `builds`. Everyone else is refused, so this is never a rename - that stays `mod_act`'s job. A name taken between the check and the insert comes back as `taken`. |
| `new_guest_name()` | text | v1.17.0. security definer; execute revoked from clients. `Guest_` and five uppercase hex characters, retried until unused. Only the signup trigger calls it. |
| `avatar_folder_has_room()` | boolean | security invoker, volatile; execute for `authenticated` only, because the storage insert policy calls it as the uploading player. Counts the caller's own avatars files (through their read policy) under a per-player lock, so a burst of uploads can't all squeeze past the 10-file cap. |
| `player_profile(p_username text)` | jsonb or null | stable, security invoker. Exact username match first; otherwise a case-insensitive match only if exactly one account matches. Returns `{ "profile": <the profiles row, every column, to_jsonb>, "details": <details row as above, or null>, "stats": player_stats(id) }`. |

### 3.2 `player_stats(p_user_id uuid)` in `migration-runs-log.sql` (agent A)

`stable`, `security invoker`, reads `runs`, `daily_runs`, `sou_runs`, `builds` (all publicly readable).
Also add `create index if not exists` on `daily_runs (user_id)`, `sou_runs (user_id)`, `builds (user_id)`.
Returns exactly this shape (the empty version is profile-rules.mjs's `EMPTY_PLAYER_STATS`):

```json
{
  "since": "2026-09-01T12:00:00+00:00",
  "by_ladder": [{ "ladder": "daily", "seasons": 12, "dnf": 1, "wins": 150, "losses": 60, "champs": 3,
                  "perfect": 1, "playoffs": 8, "best_score": 98.2, "best_score_std": 90.1 }],
  "wins": [{ "w": 12, "n": 4 }],
  "best_points": 212,
  "go_to_players": [{ "name": "Randy Moss", "season": 2007, "team": "NE", "count": 6 }],
  "team_counts": [{ "team": "KC", "count": 31 }],
  "by_format": {
    "fantasy":  { "champs": 7, "biggest_upset": { "score": 71.4, "w": 15, "l": 5, "ladder": "gm", "created_at": "…" },
                  "best_gm": { "score": 96.1, "w": 18, "l": 2 } },
    "standard": { "champs": 0, "biggest_upset": null, "best_gm": null }
  },
  "dailies": { "played": 9, "best_score": 97.1, "best_w": 18, "best_l": 2, "best_rank": 1 },
  "over_under": { "played": 4, "best": 17 },
  "builds": { "count": 3, "best": { "pos": "WR", "overall": 131.2 } }
}
```

Definitions ("finished" = `not dnf`):

- `since`: earliest `runs.created_at` for the player (DNFs included); null with no runs.
- `by_ladder`: one entry per ladder that has any run (finished or DNF), always in the order daily,
  unlimited, genius, gm. `seasons` finished count, `dnf` DNF count, `wins`/`losses` sums over finished,
  `champs`/`perfect`/`playoffs` counts of true, `best_score` max score among finished fantasy runs (null if
  none), `best_score_std` the same for standard.
- `wins`: finished runs grouped by `w`, only groups that exist, ordered by `w` ascending.
- `best_points`: max `points` over finished runs; null if none.
- `go_to_players`: roster entries of finished runs counted by (name, season, team); top 5 by count desc,
  then name, season, team ascending.
- `team_counts`: roster entries of finished runs counted by team; every team, count desc then team asc.
- `by_format.<f>.champs`: finished runs in that format with `champ`. `biggest_upset`: the champ run with
  the lowest score (ties: earliest `created_at`), as `{score, w, l, ladder, created_at}`. `best_gm`: the
  finished `gm` run with the highest score (ties: earliest `created_at`), as `{score, w, l}`. Null when
  there's none. Both formats are always present.
- `dailies`: over the player's `daily_runs` rows, both formats. `played` count; `best_score`/`best_w`/
  `best_l` from the highest score (ties: earliest `created_at`); `best_rank` = the best (lowest) finish,
  where a row's finish is 1 + the number of rows with the same date and format and a strictly higher
  score — counting **only days that are over everywhere**, `date::date <= current_date - 2` (UTC). Null
  when there are no such days.
- `over_under`: `played` count of the player's `sou_runs` rows, `best` max score (null if none).
- `builds`: `count` of the player's `builds` rows; `best` the highest `overall` (ties: earliest
  `created_at`) as `{pos, overall}`, or null.

JSON numbers stay numbers (`numeric` → JSON number). Timestamps are whatever `to_jsonb` produces.

### 3.3 `migration-moderation.sql` (agent F)

**`moderators`** `(user_id uuid primary key references profiles(id) on delete cascade, added_at
timestamptz not null default now())`. RLS on, no policies. Adding one (runbook):
`insert into moderators (user_id) select id from profiles where username = 'NAME';`

**`reports`**

| column | type | rule |
|---|---|---|
| `id` | uuid primary key default gen_random_uuid() | |
| `reporter_id`, `target_id` | uuid not null → profiles(id) on delete cascade | |
| `reason` | text not null | picture \| bio \| username \| other |
| `note` | text not null default `''` | `char_length(note) <= 200` |
| `status` | text not null default `'open'` | open \| dismissed \| actioned |
| `created_at` | timestamptz not null default now() | |
| `resolved_by` | uuid → profiles(id) on delete set null | |
| `resolved_at` | timestamptz | |
| `action` | text | the mod_act action that resolved it |

Unique index on `(reporter_id, target_id, reason) where status = 'open'`. RLS on, no policies.

**Functions** (all security definer)

| function | returns | notes / raises |
|---|---|---|
| `is_moderator()` | boolean | stable. |
| `report_player(p_username text, p_reason text, p_note text)` | jsonb `{ "ok": true }` | Exact username. Raises `not_signed_in`, `no_such_player`, `self`, `bad_reason`, `note_too_long` (after trim), `limit` (10 by this reporter in the last 24 hours), `duplicate` (an open report with the same reporter, target and reason). |
| `mod_queue()` | jsonb array | stable. Raises `not_moderator`. One entry per player with open reports: `{ user_id, username, avatar_path, avatar_preset, bio, favorite_team, reports: [{ id, reason, note, reporter (username), created_at }] }`; players ordered by their oldest open report (then username), reports by created_at then id. |
| `mod_act(p_user_id uuid, p_action text, p_new_name text)` | jsonb `{ "ok": true, "removed_path": text or null }` | Raises `not_moderator`, `no_such_player`, `bad_action`. `remove_picture`: clears avatar_path and avatar_preset, returns the old path, resolves the player's open `picture` reports. `clear_bio`: bio `''`, resolves `bio` reports. `rename`: `p_new_name` must match the username rule (`invalid`), not be taken (`taken`) and be clean (`blocked`); updates `username` in profiles, runs, daily_runs, sou_runs and builds; resolves `username` reports. `dismiss`: resolves all the player's open reports as dismissed. Actions other than dismiss mark resolved reports `actioned`; all set resolved_by/resolved_at/action. |

Plus storage policies letting a moderator select and delete any `avatars` object.

### 3.4 The word filter

`text_is_clean(t)` is the only implementation that counts. The test mock mirrors it
(tests/mock-profile-data.mjs's `isClean`) and tests check both agree on a shared list of cases.

Matching (for matching only — the stored text is never changed). migration-profiles.sql's comments are the
detailed version:
1. Normalize with NFKC, then NFD (NFKC turns compatibility letters - full-width, styled - into plain ones;
   NFD then splits accented letters so the accents can go). Drop combining marks, zero-width, invisible and
   deprecated format characters (including U+061C, U+115F–U+1160, U+17B4–U+17B5, U+180B–U+180F,
   U+200B–U+200D, U+2060, U+206A–U+206F, U+3164, U+FEFF, U+FFA0, U+FFF9–U+FFFB, U+E0000–U+E0FFF).
   Lowercase and fold what NFD can't split (sharp s, ae, oe, Cyrillic and Greek look-alikes, U+0251→a,
   U+0261→g) through an explicit table, never `lower()`, so the result doesn't depend on the locale.
2. Read the text four ways: with the look-alikes `0→o 1→i 3→e 4→a 5→s 7→t @→a $→s !→i |→l` mapped and as
   typed (those characters also sit beside words as punctuation - "shit!"), each with runs of three or
   more of the same letter cut to one and cut to two (a tripled doubled letter hid a slur).
3. `'word'` entries match a whole token (split on anything that isn't a letter; a trailing `s`/`es`
   plural also matches). `'anywhere'` entries match inside the text with every non-letter removed (so
   spacing or dots between letters don't hide them).

Known gaps, accepted for a basic list: a `'word'` entry spaced out letter by letter, camel-case run-ons in
usernames, and digits outside the look-alike map. `tests/test-profile-security.mjs` prints them.

Keep the seeded list basic and clearly offensive: common profanity as `'word'`, slurs as `'anywhere'`.
Don't seed anything that's a common name, a football term, or a substring of ordinary words in
`'anywhere'` mode. **Must pass**: every player name in `data/players.json` (whole names and each part),
every TEAMS name and city, each of those with any one letter tripled, and ordinary words with unlucky
substrings (Scunthorpe, assassin, class, Cassel, Hancock, Cockrell, Titus, Dickson, Sussex, therapist,
grapes, shiitake, cocktail, analysis). **Must block**: each seeded word plain, capitalized, with look-alike
digits/symbols, with compatibility or look-alike letters, with invisible characters inside, with a doubled
letter tripled, and (`'anywhere'` words) with spaces or dots between letters; usernames split on `_` and
digits.

---

## 4. Browser data layer

The app imports everything from `./storage.js`, which re-exports these. **Nothing throws**; failures come
back as a status or a reason. Shared plumbing is in `storage-core.js` (`getClient`, `READ`,
`rowToProfile`, `rpcReason`).

### 4.1 `storage-profile.js` (agent B; phase 0 wrote working versions)

**v1.16.0** adds `claimUsername(name)`, which calls `claim_username` and returns the database's own code
(or `"failed"` if the call didn't get through). `storage.js` adds `authSignInWithGoogle(redirectTo)`, which
is `supabase.auth.signInWithOAuth({ provider: "google" })` - the page leaves for Google and comes back with
the session in the address, which supabase-js reads by itself.


```js
fetchPlayerProfile(username)
  → { status: "ok", profile } | { status: "missing" } | { status: "error" }
    // profile = { id, username, joined /* created_at */, details, stats /* rowToProfile */, extra /* mapPlayerStats */ }
fetchProfileDetails(userId)                  → details | null          // the header picture
saveProfile({ bio, favoriteTeam })           → { ok: true, details } | { ok: false, reason }
    // reason: "too_long" | "blocked" | "invalid" | "signed_out" | "network"
saveAvatarPhoto(userId, blob, previousPath)  → { ok: true, details } | { ok: false, reason }
    // reason: "type" | "too_large" | "paused" | "invalid" | "signed_out" | "network"
setAvatarPreset(key, previousPath)           → { ok: true, details } | { ok: false, reason }
removeAvatar(previousPath)                   → { ok: true, details } | { ok: false, reason }
checkUsername(name)                          → "ok" | "taken" | "blocked" | "invalid" | null
avatarUrl(path)                              → string | null
mapDetails(row)                              → details
    // details = { bio, avatarPath, avatarUrl, avatarPreset, favoriteTeam, updatedAt }
```

A new photo uploads to `profile-rules.mjs`'s `avatarObjectPath(userId, type)` with `upsert: false` and a
one-year cache, then `set_avatar` makes it current, then the previous photo is deleted (best effort, and
only a file in the player's own folder). If `set_avatar` fails the new file is deleted. A player can fill
their 10-file folder only through leftovers from failed deletes, so on a full folder the upload clears
those (never the current photo) and retries once. A refusal while uploads are on is "network";
"signed_out" only when the session is gone. RPC reads use `READ` (GET); writes are POST.

### 4.2 `storage-moderation.js` (agent F; phase 0 wrote working versions)

```js
reportPlayer(username, reason, note) → { ok: true } | { ok: false, reason }
    // reason: "limit" | "duplicate" | "self" | "signed_out" | "missing" | "invalid" | "network"
isModerator()                        → boolean                 // false when it can't be checked
fetchModQueue()                      → queue | null
    // [{ userId, username, avatarPath, avatarUrl, avatarPreset, bio, favoriteTeam,
    //    reports: [{ id, reason, note, reporter, createdAt }] }]
modAction(userId, action, newName)   → { ok: true } | { ok: false, reason }
    // action: "remove_picture" | "clear_bio" | "rename" | "dismiss"
    // reason: "not_moderator" | "taken" | "blocked" | "invalid" | "missing" | "network"
    // remove_picture also deletes the returned file (moderator storage policy)
```

---

## 5. Shared modules

- **`profile-rules.mjs`** (phase 0, lead): `BIO_MAX`, `USERNAME_RE`, `TEAM_CODES`, `REPORT_REASONS`,
  `REPORT_REASON_LABEL`, `REPORT_NOTE_MAX`, `REPORTS_PER_DAY`, `AVATAR_BUCKET`, `AVATAR_SIZE`,
  `AVATAR_MAX_BYTES`, `AVATAR_TYPES`, `avatarObjectPath`, `isOwnAvatarPath`, `FREE_AVATAR_PRESETS`,
  `hasDisallowedChars`, `cleanBio`, `bioLength` (code points, like `char_length`), `profilePath`,
  `parseProfilePath`, `EMPTY_PLAYER_STATS`, `emptyPlayerStats`, `mapPlayerStats`. Needs a change? Report it.
- **`badges.mjs`** (agent A; phase 0 wrote the catalog and rules): `BADGES` (`{ id, name, emoji, tier,
  how, coins }`), `BADGE_BY_ID`, `TIER_COINS`, `CINDERELLA_MAX_SCORE`, `SCOUT_MIN_POINTS`,
  `DAY_ONE_BEFORE`, `badgeProgress({ stats, extra, details, joined })` → `[{ id, earned, have, need }]` in
  catalog order, `topBadges(progress, n)`. Pure; no imports from the app (the Edge Function will import
  it in v1.12.0).
- **`ui-common.jsx`** (phase 0, lead): display helpers moved out of perfect-season.jsx — `SLOT_LABEL`,
  `FORMAT_LABEL`, `LADDER_LABEL`, `teamVars`, `gradeTier`, `grade`, `cityFor`, `teamLabel`, `shortYr`,
  `fmtDate`, `outcomeSentence`, `draftsOf`, `scoreOf`, `runOf`, `RosterRows`, `RosterChips`. Import these;
  don't copy them.

---

## 6. Components

Every screen file exports its stylesheet as a string (`PROFILE_CSS`, `AVATAR_CSS`, `PICKER_CSS`,
`MODERATION_CSS`); perfect-season.jsx appends them after its own (exported as `APP_CSS`). **Style only
your own prefixed classes** (`pf-`, `av-`, `ap-`, `md-`) and reuse the app's `.btn`, `.btn.solid`,
`.linkbtn`, `.panel`, `.tiles`/`.tile`, `.h`, `.note`, `.muted`, `.err`, `.frow`, `.chip` without
restyling them. Put your responsive and `pointer:coarse` and `prefers-reduced-motion` rules in your own
string, after your base rules. `.pf-card` is already in the dark scope.

### 6.1 `avatars.jsx` (agent D)

```jsx
<Avatar username photoUrl preset size={40} className="" decorative={false} />
AVATAR_PRESETS   // [{ key, name, pack, free }] - FREE_AVATAR_PRESETS plus drawings
```
Photo → default avatar → initial, falling back if the photo fails to load. The 12 drawings are inline
SVG in Gridspin's style (cream/ink/lime/blue/orange/violet, ink strokes, like the mark in
`static/icon.svg`) — **no NFL logos or anything resembling a real team's marks**. Readable at 24px
(header) and 96px. Not decorative: `role="img"` with an `aria-label`.

### 6.2 `avatar-picker.jsx` + `avatar-image.mjs` (agent D)

**`report_player` (v2.0.0):** its note is no longer merely trimmed - it is cleaned the way a bio is
(`cleanNote`, one line of plain text with the control, bidi and zero-width characters dropped), so
`note_too_long` counts the cleaned text. It also raises **`guest_not_allowed`**: a guest account costs
nothing to make, so six throwaways could put 24 open reports on somebody. `mod_act`'s rename clears `guest`
on `profiles` and `sou_runs` as well as rewriting the username.

**Accepted, and deliberate (v2.0.0):** the 25 MB limit is on the file's *bytes*, and nothing checks its
*pixels* before decoding it. A two-page PNG can declare 30,000 x 30,000 and decode to ~3.6 GB, which ends the
tab. It is left open because the only way to reach it is to choose such a file from your own file picker, the
only thing harmed is your own tab, nothing has been uploaded by then, and no server in this game ever decodes
an image. The full reasoning, and what a fix would cost, is at `MAX_INPUT_BYTES` in `avatar-image.mjs`.

```jsx
<AvatarPicker username current={{ photoUrl, preset }} busy error
  onPhoto={(blob) => Promise} onPreset={(key) => Promise} onRemove={() => Promise} onCancel={() => {}} />
```
Two tabs: **Upload photo** (file input `accept="image/*"`; drag to move and a zoom slider — the slider is
a real `<input type="range">` with a label, so the keyboard works; a round preview; **Use this photo**)
and **Choose an avatar** (a grid of the defaults, the current one marked). **Remove picture** when there
is one. `avatar-image.mjs`: `loadImage(file)` → `{ source, width, height }` (rejects `{ code:
"unsupported" }` for anything that won't decode, `{ code: "too_big" }` over 25 MB) and
`prepareAvatar(source, crop)` → `{ blob, type }` (crop `{ x, y, size }` in source pixels; 256×256; WebP
at a quality that fits 256 KB, else JPEG; EXIF orientation respected). Friendly errors, e.g. "That file
isn't a picture we can use. Try a JPEG or PNG." Respect reduced motion.

### 6.3 `profile.jsx` (agent C)

```jsx
<ProfileScreen status profile isOwner userId rank moderator
  onRetry onShare onDetailsSaved onLogOut onPlay onOpenReports />
```

| prop | meaning |
|---|---|
| `status` | `"loading"` \| `"ok"` \| `"missing"` \| `"error"` |
| `profile` | fetchPlayerProfile's profile (when ok) |
| `isOwner` | the signed-in player is viewing their own profile |
| `userId` | signed-in player's id, or null for a guest |
| `rank` | `{ fantasy, standard }` — 1-based sitewide rank of each best score, or null values |
| `moderator` | `{ openReports }` when a moderator views their own profile, else null |
| `onRetry()` | reload after an error |
| `onShare()` | `→ Promise<"shared" \| "copied" \| "failed" \| "cancelled">` ("cancelled": the share sheet was closed; no status shown) |
| `onDetailsSaved(details)` | after any bio/team/picture save succeeds |
| `onLogOut()`, `onPlay()`, `onOpenReports()` | owner actions |

**Test hooks (must keep):** root `<section class="profile" data-username="…" data-owner="true|false">`;
the owner view has a **Log out** button; an owner with no drafts sees "Play your first season to start
your record." and a **Go to the draft** button.

**Section order:** player card (`.pf-card`, the navy scoreboard treatment) → headline tiles → badges →
seasons by wins → by mode → best lineups (RosterRows, per format that has one) → go-to players → records →
minigames → recent drafts (DNFs included, like today's list) → owner's Log out. A section with nothing
to show is left out (except badges, which always shows progress). A visitor sees the same sections.
Points (bank and ladders) show under Records as ladder totals only; the "shop will spend" explainer
goes away. No explainer paragraphs — the owner has asked for less explanatory copy.

**Editor** (owner, from Edit profile): picture (AvatarPicker; `saveAvatarPhoto` / `setAvatarPreset` /
`removeAvatar` as its callbacks), bio (a 16px `<textarea>` or input with a live count of `bioLength`,
Save disabled over 160, the filter's refusal shown as "That bio has a word we don't allow."), favorite
team (32 teams plus "No favorite", showing team colors via `teamVars`). Each save calls
`onDetailsSaved(details)`.

**Visitor:** Report (signed in only) opens `<ReportSheet username onClose />` from moderation.jsx.

Badges grid: every badge — earned in color with its tier, locked dimmed with `have/need` progress for
counted ones. Tier colors need tokens in theme.mjs (all three scopes; the contrast test covers any used
as text).

### 6.4 `moderation.jsx` (agent F)

```jsx
<ReportSheet username onClose />       // reasons, optional note (200), Send, then "Thanks. A moderator will take a look."
<ModerationQueue onOpenProfile />      // loads fetchModQueue; per player: picture, bio, reports; actions with confirmation
```
Both self-contained (they call storage.js). Rename asks for the new name and shows `taken`/`blocked`/
`invalid` in words. Empty queue: "No open reports."

---

## 7. App integration — `perfect-season.jsx` (agent E)

**Views.** `view === "profile"` shows `ProfileScreen` for `profileOf` (a username) — or the AuthPanel
when a guest opens the Account tab. `view === "reports"` shows `ModerationQueue` (moderators only). The
Profile tab (signed in) opens your own profile; `isOwner` is `profile.id === userId`.

**Addresses and history.**
- `/u/<username>` (trailing slash allowed; `parseProfilePath`) opens that profile on load, for guests
  too. A profile's address is `profilePath(username)`; every other screen is `/`.
- Opening a profile from inside the app pushes a history entry (`{ ps: "profile", name }`) after
  recording the current screen in the current entry (`replaceState({ ps: "view", view, ... })`), so Back
  returns to that screen and Forward works. Leaving a profile for another tab pushes `/`. `popstate`
  restores from the entry's state, falling back to parsing the address.
- Challenge links (`/c/CODE`) keep working exactly as now.
- Scroll to top when the viewed profile changes (the existing view effect, keyed on `profileOf` too).

**Name links.** Every username shown for an account opens its profile: Top 10 and the best-ever card,
today's daily board, the points ladder, every Stats board (best lineups ever, biggest upsets, career
boards via RankRows, GM scores, created players), and the Over/Under board. Use one button component
(a React context carrying `openProfile` works for module-scope components like `PlayerName` and
`RankRows`): it looks like the name (no button chrome), underlines on hover inside `(hover:hover)`,
has a visible focus ring, and gets a `pointer:coarse` hit area per CLAUDE.md.

**Data.** Fetch `fetchPlayerProfile(profileOf)` whenever the profile view opens or `profileOf` changes
(status loading → ok/missing/error). Rank: `fetchOwnRank` for each best score, in parallel. Header
picture: `fetchProfileDetails(userId)` at session restore and login, updated from `onDetailsSaved`.
Moderator: `isModerator()` at session restore and login; for a moderator viewing their own profile,
`moderator = { openReports: queue.length }` from `fetchModQueue()`. Share: `navigator.share` on phones
(like the result screen's Share), else copy `${APP_SITE_URL}${profilePath(name)}` to the clipboard.

**Signup.** In AuthPanel's signup, after the existing username rule passes, `checkUsername(username)`:
`taken` → "That username is taken. Try another one."; `blocked` → "That username isn't allowed. Try
another one."; null (couldn't check) → go ahead. If signUp itself fails with "Database error saving new
user", say "That username isn't allowed. Try another one."

**Hosting.** `vercel.json`: rewrites `/u/:name` and `/u/:name/` → `/page.html`; `X-Robots-Tag: noindex`
for `/u/(.*)`. `tests/test-build-seo.mjs` checks both, like the `/c/` rules.

---

## 8. Tests and tooling

- **`node tests/run-all.mjs [filter...]`** runs every test file (not the difficulty benchmark) one at a
  time. Run it before handing back.
- **Mock.** `tests/mock-supabase.mjs` wires three modules: `mock-profile-stats.mjs` (A:
  `playerStats(state, userId)`), `mock-profile-data.mjs` (B: `makeProfileData(state, { playerStats })` →
  `{ tables, rpcs, storage, isClean, objects }`), `mock-moderation.mjs` (F: `makeModeration(state,
  profileData)` → `{ tables, rpcs, isModerator }`). `state` is `{ profiles, runs, dailyRuns, souRuns,
  builds, currentUserId(), isModerator(uid) }`. A mock database function refuses by
  `throw new Error("<code>")`. Direct client writes to the new tables return an RLS error. Escape
  hatches: `_profileDetails`, `_avatarPresets`, `_blockedWords`, `_siteFlags`, `_storageObjects`,
  `_reports`, `_moderators` (plus the existing ones). The mock's storage `getPublicUrl` returns an
  object's `publicUrl` if a test set one, else `https://storage.mock/<bucket>/<path>`; its storage also
  has `list()` and enforces the exact file name and the 10-file cap (`AVATAR_FOLDER_LIMIT`). Like the
  database, the mock's `signUp` refuses a username that breaks the rule or the filter, its `sou_runs` and
  `builds` inserts take the account's own username, and a bad build is refused with `bad_build`.
- **Real Postgres.** `tests/pg-fixture.mjs`: `freshDb()` (Supabase-like roles, auth, storage stubs,
  schema.sql and every migration), `addAccount`, `asUser(db, uid, fn)`, `asAnon(db, fn)`,
  `failure(db, sql, params)`, `uuid(n)`. Parity tests run the same fixture through SQL and the mock and
  compare JSON (see test-runs-sql.mjs's `canon`/`firstDiff` for the pattern).
- **Screens on their own.** `tests/helpers.mjs`: `loadModule("profile.jsx")` bundles any module like the
  app, `renderComponent(Component, props)` renders it (after `setupDom()`).
- **Fixtures.** `tests/fixtures/profile-fixture.mjs`: `veteranProfile()`, `rookieProfile()`,
  `photoProfile()`, plus the raw `VETERAN_ROW` and `VETERAN_STATS_JSON`.
- **Visual checks** use `tools/ui-harness` and puppeteer-core with the installed Chrome
  (`C:/Program Files/Google/Chrome/Application/chrome.exe`) — never the in-app browser pane, which is
  shared. `perfect-season.jsx` exports `APP_CSS` for previewing a screen outside the app. Check at 320,
  375, 430, 768 and 667×375.

---

## 9. Who owns what

Only the owner writes a file. If you need a change in a file you don't own, put it in your report.

| agent | owns |
|---|---|
| **A** Stats & badges | `supabase/migration-runs-log.sql`, `badges.mjs`, `tests/mock-profile-stats.mjs`, `tests/test-player-stats-sql.mjs`, `tests/test-badges.mjs` |
| **B** Profile data & word filter | `supabase/migration-profiles.sql`, `storage-profile.js`, `tests/mock-profile-data.mjs`, `tests/test-profile-data.mjs`, `tests/test-word-filter.mjs`, `supabase/schema.sql` (only a pointer comment at handle_new_user) |
| **C** Profile screen | `profile.jsx`, `theme.mjs`, `tools/ui-harness/harness.jsx`, `tests/test-profile-screen.mjs` |
| **D** Avatars | `avatars.jsx`, `avatar-picker.jsx`, `avatar-image.mjs`, `tests/test-avatar-image.mjs`, `tests/test-avatar-picker.mjs` |
| **E** Links & navigation | `perfect-season.jsx`, `vercel.json`, `tests/test-build-seo.mjs`, `tests/test-profile-links.mjs` |
| **F** Reports & moderation | `supabase/migration-moderation.sql`, `storage-moderation.js`, `moderation.jsx`, `tests/mock-moderation.mjs`, `tests/test-moderation.mjs` |
| **lead** | `PROFILES.md`, `profile-rules.mjs`, `ui-common.jsx`, `storage.js`, `storage-core.js`, `tests/mock-supabase.mjs`, `tests/helpers.mjs`, `tests/pg-fixture.mjs`, `tests/run-all.mjs`, `tests/fixtures/`, older test files, `CLAUDE.md`, `CHANGELOG.md`, `package.json` |

Agents: no pushes, deploys, migrations against a real project, or network calls to Supabase; don't add
or upgrade packages; commit on your own branch with a clear message.

---

## 10. After the build (lead)

Merge order A → B → F → D → C → E. Then: every test file passes; update older tests the new screens
change; harness audit at five sizes; security and mobile checks (agents G, H) and a code review;
CLAUDE.md (profiles section, the new files, the storage modules, the moderation runbook, the new
writer of `profiles.username`), CHANGELOG 1.11.0, version bump; staging migrations, staging click-through
with a real phone photo; owner's OK; production.
