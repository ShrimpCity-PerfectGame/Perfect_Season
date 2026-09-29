# Guess the Player — the reference

A daily game shipped in v2.13.0. The site picks one real player a day and you have **eight guesses**. Every
guess is a player, and the row it draws compares five things with the answer: **team, division, position, draft
class and jersey number**. Green is exact, yellow is close, grey is no. Daily and Practice.

The name is not one of the five columns — it is the guess.

`CLAUDE.md` has the release rules and the architecture this sits inside. This file is the contract: what the
pool is, where each rule lives, what the database holds, and what a submission can be refused for.

---

## 1. Why the data is its own file, again

`data/players.json` holds the fantasy positions and nothing else — QB, RB, WR, TE and the kickers and defenses a
duel needs. This game asks about **the whole roster**: the owner's words were "this will need additional
information as it needs defensive as well as offensive players", and a game that only ever asked about
quarterbacks and receivers would be a quarter of the sport.

`data/guess-pool.json` (195 KB, 4,637 players) is built by `tools/data/build-guess-pool.mjs` from nflverse's
`players.csv`, which carries the four things this game needs and the draft data does not: **jersey number,
draft year, position and the seasons played**. It is stored as positional rows behind a `columns` list, with
team, position and group as indices into their own tables, because a 4,637-row file of named objects is three
times the size for no gain — `initGuessData` expands it once, the way `initGameData` and `initCenturyData` do,
except that this one runs when the game is opened rather than at startup (below).

The knobs at the top of the builder, each with the cost of turning it:

| Knob | Value | What it decides |
| --- | --- | --- |
| `MIN_SEASONS` | 5 | How long a career has to be. Below 5 the pool fills with names nobody could place. |
| `FIRST_SEASON` | 1999 | Where nflverse's coverage starts, the same floor the draft data has. |
| `INCLUDE_UNDRAFTED` | `false` | **A one-line switch.** Draft class is a column, and an undrafted player has none. |

Turning `INCLUDE_UNDRAFTED` on would cost the game its draft-class column, or force an "undrafted" value that is
either always grey or always green and says nothing either way. What it costs to leave off is worth knowing and
is written into the builder: **Warren Moon, Antonio Gates, James Harrison, London Fletcher and Jon Kitna** are
not in the pool. That is the trade, and it is deliberate.

What the pool holds, by position group: DB 885 · OL 829 · DL 748 · LB 650 · WR 495 · RB 402 · TE 295 · QB 232 ·
SPEC 101.

### It is not in the bundle

195 KB (61 KB compressed) is about a sixth of the whole bundle, for one mini-game, so the game **fetches** it when
its screen opens — `guess-pool.mjs`, one memoised load, and `build.mjs` copies the file to
`public/data/guess-pool.json`. `tests/test-build-seo.mjs` holds the bundle under 1.2 MB and says in as many words
that this is the honest fix for a big data file; raising that ceiling is how `data/versus-pool.json` got in, and
doing it twice is how a 400 KB-compressed bundle happens. The test now checks both halves: the pool **is** served
from the site root, and it is **not** in `page.js` as well.

The service worker treats it exactly like the bundle — network first, the store only as a fallback
(`sw-rules.mjs`'s `DATA`). Same reasoning as the bundle's own rule: the daily's answer is a walk through a
permutation of this file and `submit-guess` walks its own copy, so a browser holding last release's pool would
play one player and hand in another.

The screen therefore has three states, and the loading one is not cosmetic: with no pool every id resolves to
null, the search box offers nobody and a resumed game draws an empty grid — a screen that looks like a bug rather
than a wait. A failed fetch says what is missing and offers a real retry (a failed load is forgotten, not
remembered as the answer). `tests/test-guess-screen.mjs` test 0 drives all of it through a stubbed fetch, which is
also what loads the pool for every test after it.

**The tests and the UI harness import the file directly** and initialise it before anything mounts — the harness
is opened over `file://` and has nothing to fetch from. Note that the app under test is bundled, so it holds its
own copy of `guess-logic.mjs`: a test file initialising its own copy does **not** initialise the app's, which is
why test 0 does both. The Android app serves `app/www` from its own root, so the same address works there;
`tools/app/build-app.mjs` copies it along with everything else, but that half has not been checked on a device.

### The 17 hand-picked clashes

A player's id is `name|draft class|position` (`guessId`), because name alone is not unique — there are two
Adrian Petersons and two Alex Smiths. That makes every player distinct. What it does **not** fix is two
different players who happen to share all **five compared columns**: same team, same draft class, same position,
same number. A game whose answer is one of those can go all green without being solved, which is the worst thing
this game could do.

The builder therefore keeps one of each clashing pair and **fails the build on a clash it has not been told
about**. The choice is made by hand, in a `KEEP` table with a reason per pair, because the rule that was there
first — keep the longer career — got three of them backwards: Maxx Crosby and Clelin Ferrell both played eight
seasons, so it fell through to alphabetical and dropped **Crosby**. Same for **Riq Woolen** and **Jonathan
Cooper**. An automatic rule cannot know which player is remembered; a person can.

There are 17 pairs. Adding a season to the pool will probably add more, and the build will say so rather than
quietly resolving them.

---

## 2. Where the rules live

**`guess-logic.mjs`** — every rule, imported by the screen, by `supabase/functions/submit-guess/index.ts` and by
the tests. Same reasoning as `game-logic.mjs`, `versus-logic.mjs` and `century-logic.mjs`: the browser colours a
row the instant a guess is made and the server decides whether the run counts, and a rule enforced on one side
and not the other will drift.

- `GUESS_TRIES = 8`, `GUESS_COLUMNS` (the five, in the order the row draws them), `DRAFT_NEAR = 2`,
  `NUMBER_NEAR = 5`.
- `DIVISIONS` — 32 teams to 8 divisions, written out. It is the one thing here that is not in the data:
  nflverse says which team, and there is no rule to derive a division from.
- `compareGuess(guess, answer)` — the five cells. Each is `hit`, `near` or `miss`; draft class and number also
  carry an **arrow**, because knowing the answer is later than 2015 is worth far more than knowing it is not
  2015. A cell never says *how* near: "within two" is the whole of the hint, or the arrow plus a distance would
  hand the answer over on the second guess.
- `guessAnswerFor(date)` / `guessAnswerForSeed(seed)` — see §3.
- `replayGuessGame({ date | seed, guesses })` — the whole game from the ids guessed, in order. Returns
  `{ ok, solved, tries, rows, answer }` or `{ ok: false, reason }`. **Solved is decided by identity** — the last
  guess being the answer — and never by counting green cells.
- `guessOutcome(solved, tries)` — the line stored with a run. Stored, so like the season sim's outcome strings
  it must not change once runs carry it.

What "close" means is different per column, and that is most of the game:

| Column | Green | Yellow |
| --- | --- | --- |
| Team | the same team | — (the team is exact or it is nothing) |
| Division | the same division | the same **conference** |
| Position | the same position (both CB) | the same **side of the ball** |
| Draft class | the same year | within **two** years, with an arrow |
| Number | the same number | within **five**, with an arrow |

Team and division are separate columns rather than one because a guess can be in the right division and the
wrong team, and that is worth knowing.

---

## 3. Which player, on which day

The daily **walks a fixed permutation** of the whole pool rather than picking at random. A random pick repeats
somebody inside a year about as often as not, and the one thing a daily must never do is ask the same question
twice in a fortnight. Walking a shuffle gives every player exactly one turn before any repeat — **4,637 days**,
which is twelve and a half years.

- `GUESS_DAY_ONE = "2026-09-14"`, the same launch day the share cards number from.
- The shuffle is `mulberry32(hashStr("gridspin-guess-order"))` and a plain Fisher–Yates loop. **Never a random
  comparator**: how many times an engine calls one is up to the engine, and the client and the server must agree
  call for call (CLAUDE.md's engine-independence note).
- Dates before day one walk backwards through the same permutation rather than failing, so nothing has to
  special-case them.
- Practice is `guessAnswerForSeed(code)`, seeded like an Unlimited Century, so a code can be shared and replayed.

**Accepted gap, and it is the same one every seeded mode in this game has**: the answer follows from the date
and the pool, both of which ship in the bundle, so somebody willing to run `guess-logic.mjs` in a console can
read today's player. What is closed is the in-app rehearsal — the one an ordinary player would ever find — and
the **board is honest either way**, because `submit-guess` recomputes the answer from the date and the result
from the guesses.

---

## 4. The database

`supabase/migration-guess.sql` creates `guess_runs`, and it is the second board in the game nobody can write:
RLS on, **public select, no insert or update policy at all**. Over/Under and Build-a-player are
browser-written because a guess there leaves no trace a server could replay; a game here leaves exactly that —
a list of player ids — so the `submit-guess` Edge Function's service role is the only writer, as it is for
`century_runs`.

- Columns: `id`, `user_id`, `username`, `guest`, `day` (null for practice), `seed` (null for the daily),
  `solved`, `tries` (checked 1–8), `guesses` (the ids, in order), `answer`, `outcome`, `created_at`.
- `username` and `guest` are stamped by the `use_account_username` trigger in `migration-profiles.sql`, like
  every other board — so a name on this board cannot be spoofed and a guest keeps its chip.
- A **partial unique index** on `(day, user_id) where day is not null`: one daily per account, and any number of
  practice games.
- The sequence is revoked from `anon` and `authenticated` (`tests/test-economy-security.mjs` checks every
  sequence, which is how `century_runs_id_seq` was caught).
- `guess_top(p_day, p_limit)` — one day's board: solved first, then fewest guesses, then earliest, then the name
  by byte (`collate "C"`).
- `guess_best(p_limit)` — all time, one row per account: dailies played, dailies solved, average guesses when
  solved (`nulls last`, so an account that has played and never solved sorts below one that has) and its best.
  An account with no daily is not on it at all.

Both are mirrored in `tests/mock-guess.mjs` and held to the real SQL row for row by `tests/test-guess-sql.mjs`.
`min()` over no rows is **NULL** in Postgres, not 0 — an account that has never solved one has no best, and
getting that wrong in the mock is what the row-for-row comparison caught.

---

## 5. The Edge Function

`supabase/functions/submit-guess/index.ts`. It takes **the guesses, not the result**: `{ variant, day?, seed?,
guesses: [id] }`. The answer follows from the date alone, so it is recomputed there, every guess is checked
against the pool, and whether the game was solved and in how many is derived from scratch. Nothing the client
says about its result is used.

What it deliberately does not do, exactly as `submit-century` does not:

- **touch `profiles`.** This board is its own; a game here cannot move a season leaderboard or a streak.
- **pay the run's coins.** The client claims those with `claim_minigame('guess', day)` once the function answers
  ok, so every coin in the game still moves in one place (SHOP.md).

The daily's date is **the function's own clock** and is never taken from the client, which is what makes the
daily the one variant that cannot be ground for an easier answer. A `day` that disagrees is refused rather than
silently re-filed.

The answer goes back in the response **only once the row is written** — that is the one moment it is safe to
send, because there is no way left to ask for it and keep playing.

### Refusals

| Reason | Status | When |
| --- | --- | --- |
| `unauthorized` | 401 | no token, or a token for nobody |
| `guest_daily` | 403 | a guest asking for the daily |
| `wrong_day` | 400 | a `day` that is not the function's today |
| `bad_code` | 400 | a practice seed outside `^[A-Z0-9]{4,16}$` |
| `duplicate` | 409 | today's daily is already recorded for this account |
| `malformed` | 400 | no guesses at all |
| `no_guesses` `too_many` `bad_guess` `repeat_guess` `unknown_player` `guessed_past_the_end` `bad_guesses` `no_answer` | 400 | `replayGuessGame` refusing the game |

Every one of those is mapped in `storage-guess.js`'s `GUESS_REFUSALS` and has a line in `guess.jsx`'s
`refusalLine`. A code that reaches the app unmapped is read as `"network"` and shown as "check your connection"
— forever, for a rule rather than a fault. `tests/test-guess-screen.mjs` holds the map to the function's own
source and to `guess-logic.mjs`'s, so a new reason cannot arrive unmapped.

A practice seed is held to the shape the code box accepts rather than to any string the column would take: a
seed nobody could type is a seed nobody can be challenged with.

---

## 6. The screen

`guess.jsx` — `GuessScreen`, `GuessTable`, `GuessBoard`, and `GUESS_CSS`, appended after `CENTURY_CSS` by
`perfect-season.jsx`. It styles only its own `gp-` prefix and reuses the app's `.btn`, `.h`, `.note`, `.panel`
and `.mode`. It is reached from **Mini games**, not Modes (v2.10.0).

- **The grid is a real table**, because that is what it is: a row per guess, a column per thing compared, the
  player's name as the row header.
- **Every cell carries a visually-hidden sentence** — "Team KC: exact", "Class 2014: close, higher". The colour
  is the whole of the signal for everyone else, and colour may never be the only thing that means something
  (CLAUDE.md, v1.18.0's accessibility pass). The printed short form is `aria-hidden`, so a reader gets the
  sentence rather than both.
- **Both paints take a dark ink** (`CELL_INK`), and it has to be dark: `--win` is the game's light green and
  white on it is 1.8:1. `tests/test-a11y.mjs`'s entry for this grid caught that on its first run.
- **The search box offers eight names at most**, needs two letters, drops anyone already guessed, and shows
  `{pos} · {draft}` beside each name — the pool holds two Adrian Petersons, and a name alone does not say which
  player you mean.
- **The instant result is computed by `replayGuessGame`**, the function the server replays with, not by a
  comparison written in the screen. It is what the end screen shows until the save answers, and a **refused**
  save never replaces it at all — a tab left open on a daily finished elsewhere. A second copy of "was it
  solved" would eventually disagree with the one that counts.
- **A game in progress is saved per device** (`ps-guess-wip`), through `sget`/`sset`/`clearDraft`. A `started`
  ref guards the resume race — a slow read landing on top of a game that has since been started, which is what
  a Century share link cost on staging (CENTURY.md). A saved daily from another day is thrown away rather than
  resumed.
- **The daily's "played today" hint is keyed in UTC** (`GUESS_DONE_KEY(utcDayKey())`), because UTC is the day the
  run is filed under. Keying it locally is a real bug that shipped in Century and only surfaces on a session
  either side of UTC midnight.
- **A guest is shown the daily as a live control that explains itself**, not as a disabled button: it takes them
  to the Account tab, which is where the answer is.
- The root goes into the **dark scope** while a game is in progress, like every other board.

---

## 7. Tests

| File | What only it can hold |
| --- | --- |
| `tests/test-guess-logic.mjs` | every rule and refusal; that five greens identify exactly one player **across the whole pool**; that a bot guessing blind solves 0.20% of games in 8; ids unique; the permutation repeats nobody in 4,637 days |
| `tests/test-guess-edge.mjs` | the real `submit-guess`, executed through `tests/edge-harness.mjs`: who is asking, the daily's own clock, the 409, `guest_daily`, every replay refusal, and that the result written is the **function's** whatever the client claims |
| `tests/test-guess-sql.mjs` | the migration in PGlite: nobody writes the table, the daily's unique index, both boards == the mock, a rename, the coin claim |
| `tests/test-guess-screen.mjs` | the buttons: the tile, both variants, guesses typed, the colours **in words**, the end screen, resume, the boards, the guest, the refusal map |
| `tests/test-a11y.mjs` | three entries — the menu, the grid part-played, and the end screen |

Both new test files were checked by mutation: eight deliberate breaks of the Edge Function and eight of the
screen, each one confirmed to turn a named test red. Two mutations were **not** caught and both were correct not
to be — the function's `.map` of non-strings to `null` (the logic refuses them identically) and, before the
screen was changed, its hand-written `solved`, which is the drift that got removed rather than tested around.

---

## 8. Runbook

**Deploy order**: `migration-guess.sql` goes **after `migration-century.sql` and before
`migration-runs-log.sql`**, then profiles, moderation and wallet, then the Edge Functions, then the client. It
must come before three files that name its table: the `use_account_username` trigger in profiles, `mod_act`'s
rename and both of `claim_username`'s blocks in profiles, and `claim_minigame`'s `guess` arm in wallet. All of
those bodies are plpgsql, so the wrong order **fails nothing until a guest trades up** — which is the worst
shape a runbook can be in, and why `tests/test-migrations.mjs` holds the order.

In the SQL editor:

```sql
-- take a game back (a wrong answer shipped, a farmed run)
delete from guess_runs where day = '2026-09-28' and username = 'NAME';

-- what today's board looks like
select * from guess_top('2026-09-28', 20);

-- skip a day's player (only before the day arrives, and only by changing the pool - there is no override)
```

There is deliberately **no** override for the day's player: the answer is a pure function of the date and the
pool, and a table of exceptions would be a second source of truth for the one thing both the browser and the
server have to agree on. A player who has to go gets removed from the pool, which moves every later day by one.

Rebuild the pool with `node tools/data/build-guess-pool.mjs` (it needs nflverse's `players.csv`). It refuses to
write a file with an unlisted clash, and `tests/test-guess-logic.mjs` re-checks every property of the file it
writes.

---

## 9. Not built

- **No share card.** Wordle's grid of coloured squares is the obvious one and it is a real piece of work to do
  without spoiling the answer — the colours alone give away the division and the side of the ball. Left out
  rather than done badly.
- **Nothing on the profile.** `player_stats` does not count guess games, and no badge is awarded. Century's
  badge took a release of its own; this can have the same.
- **No streak.** The all-time board counts dailies solved and the average, which is the honest measure; a streak
  would need a day-by-day walk and a rule for the days nobody played.
