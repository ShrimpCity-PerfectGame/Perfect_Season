# Guess the Player — the reference

A daily game shipped in v2.13.0. The site picks one real player a day and you have **five guesses**. Every
guess is a player, and the row it draws compares five things with the answer: **team, division, position, draft
class and jersey number**. Green is exact, yellow is close, grey is no. Daily and Practice.

The name is not one of the five columns — it is the guess.

`CLAUDE.md` has the release rules and the architecture this sits inside. This file is the contract: what the
pool is, where each rule lives, what the database holds, and what a submission can be refused for.

---

## 1. Who is in the game

**The men playing now, at the positions people watch, plus the twenty-five nobody has forgotten.**

- **Playing:** quarterbacks, running backs, receivers and tight ends with **100+ snaps since the start of the
  2025 season** — two seasons added together (`MIN_SNAPS`, `SINCE_SEASON`). 456 of them.
- **Legends:** the **25** best retired players at those same positions, by career value ranked *within* each
  position so quarterbacks cannot take all the places. Brady, Rice, Peyton Manning, Barry Sanders, Emmitt Smith,
  Moss, Gronkowski, Tony Gonzalez.

481 players as this was written. Every one of them is both typable as a guess and askable as the answer.

**The window is two seasons and not one**, which matters more than it sounds. Counting only the season being
played made the pool three weeks of football in September — 168 men — and left out anyone hurt early: **Puka
Nacua** had 727 snaps in 2025 and 43 in 2026, and was not in the game. It also meant the pool was wrong within a
week of any build. Two seasons is steady from the first Sunday of a season to the last, and still only men a fan
has watched recently. The cost is at the other end: Ezekiel Elliott last played in 2024, so he is out.

### Why it is this, after twice being something else

The shape has changed three times, and the reasoning is worth keeping because each version failed differently.

| | What it was | Why it went |
| --- | --- | --- |
| v2.13.0 | every drafted player with a 5-season career — **4,637** | Wrong at both ends. 723 men lasted five seasons without ever playing (Rodney Adams took **ten snaps** in six); and a career takes five years to measure, so the draft classes stopped at 2022 and no Jayden Daniels or Brock Bowers could ever be the answer. Most days were closer to Rodney Adams than to Peyton Manning. |
| then | a Guessability Score — recency, prominence within position, longevity, accolades, starts, draft capital — taking a share of each position group, **731** | Much better, and still asking about the hundredth-best corner of the century. |
| now | the men on the field, and the greats — **481** | A fan can place the players he has been watching far more readily than anyone else, whatever a career-value model says. The point of a daily is that most people can get it. |

**What it costs, and it is not small:** there is no defence in this game and no offensive line, and of the
retired only the very top. It is a quiz about the season being played rather than about all of football. That
was chosen deliberately, to make it winnable.

**It ages.** The playing half is two seasons wide, so it does not go stale in a week the way a one-season window
did — but a rookie who arrives mid-season is not in it until it is rebuilt. **Rebuild when a season ends**, and
during one if you want the newest players in; `built`, `sinceSeason` and `throughWeek` in the file say what it
holds. `GUESS_POOL_INFO` carries all of that into the app, so the screen states the rule from the data rather
than from prose that has already been wrong twice.

### The columns a player needs

Five things are compared, so every man in the pool must have all five. Two of them are not simply lying around:

- **The jersey number.** The player index leaves `jersey_number` blank for thousands of people, so the builder
  falls back to the **season rosters** and keeps the number each man appeared under most. Reading it off the
  index and judging it there is how **Ezekiel Elliott** — a fourth overall pick with two rushing titles — was in
  no version of this game: the row was thrown away for a blank number before anything could look one up.
  nflverse also writes `0` for "unknown", and 0 only became a legal number in 2023, so a `#0` on an older career
  is a missing value rather than a number — that is how 88 players in v2.13.0 wore a number they never wore,
  Aqib Talib (21) and Blair Walsh (3) among them.
- **The team and the class.** A drafted player gets the team that **drafted** him — the rule the game plays by,
  which is why Brett Favre is an Atlanta Falcon here. An undrafted player has neither, so he gets the team he
  **came into the league with** (the earliest roster that has him) and his first season as his class. The
  rosters only go back to 1999, so an undrafted man who came in before that cannot be in the game at all.

### Difficulty, and what it is not

Every player carries a 0–100 `score`, and **it does not decide who is in the pool** — the snap count does that.
It orders them, so the end screen can say how hard the day was: snaps first (on a field of current players, the
man you see every Sunday is the one you can name), then accolades, career value, seasons and draft position. A
legend is not measured on snaps he is not taking, so his standing among the retired stands in for them.

### Clashes

Five greens must identify one man: a row where team, position, draft class and number all match has to **be**
the answer, or somebody could go all green without winning. Among a couple of hundred players there are none —
the check stays, and a clash nobody has decided **fails the build** rather than being tie-broken quietly.

### It is not in the bundle

The game **fetches** `data/guess-pool.json` when its screen opens (`guess-pool.mjs`, served from
`/data/guess-pool.json` by `build.mjs`). At 24 KB that is no longer about weight — it is that `page.js` is about
1.21 MB against the 1,300,000-byte ceiling `tests/test-build-seo.mjs` holds it to, and that ceiling was 1.2 MB
until this game's own SCREEN took the bundle past it in v2.14.0 and it had to be raised. The test checks both
halves: the pool **is** served from the site root, and it is **not** in `page.js` as well.

The service worker treats it exactly like the bundle — network first, the store only as a fallback
(`sw-rules.mjs`'s `DATA`). The daily's answer is a walk through a cycle built from this file and `submit-guess`
walks its own copy, so a browser holding last release's pool would play one player and hand in another. **That
matters more now than it ever did**: the pool changes every week of the season, so client and function must
ship together.

The screen has three states, and the loading one is not cosmetic: with no pool every id resolves to null, the
search box offers nobody and a resumed game draws an empty grid. A failed fetch says what is missing and offers
a real retry. `tests/test-guess-screen.mjs` test 0 drives all of it through a stubbed fetch, which is also what
loads the pool for every test after it. The tests and the UI harness import the file directly and initialise it
before anything mounts — and the app under test is bundled, so it holds its *own* copy of `guess-logic.mjs`: a
test file initialising its copy does not initialise the app's, which is why test 0 does both.

## 2. Where the rules live

**`guess-logic.mjs`** — every rule, imported by the screen, by `supabase/functions/submit-guess/index.ts` and by
the tests. Same reasoning as `game-logic.mjs`, `versus-logic.mjs` and `century-logic.mjs`: the browser colours a
row the instant a guess is made and the server decides whether the run counts, and a rule enforced on one side
and not the other will drift.

- `GUESS_TRIES = 5`, `GUESS_COLUMNS` (the five, in the order the row draws them), `DRAFT_NEAR = 2`,
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

The daily **walks a fixed cycle**, one turn each. A random pick repeats somebody inside a year about as often as
not, and the one thing a daily must never do is ask the same question twice in a fortnight; walking a
permutation gives every player exactly one turn before anybody comes round again — **481 days**, about sixteen
months, at the size the pool is now.

- `GUESS_DAY_ONE = "2026-09-14"`, the same launch day the share cards number from.
- The order is seeded by `mulberry32(hashStr("gridspin-guess-order"))`, and it is a **placement rather than a
  shuffle**: each player takes one draw from that stream, which fixes the slot he starts at, and a slot already
  taken walks forward to the next free one. That shape is left over from the weighting — a man asked three times
  a cycle had his turns spread an equal share of it apart on purpose — and at one turn each the forward walk is
  the only thing that moves anybody off his draw. **Never a random comparator**, in either shape: how many times
  an engine calls one is up to the engine, and the client and the server must agree call for call (CLAUDE.md's
  engine-independence note).
- Dates before day one walk backwards through the same cycle rather than failing.
- Practice is `guessAnswerForSeed(code)`, seeded like an Unlimited Century, so a code can be shared and replayed.

**The weighting is gone, and that is a deliberate reversal.** `GUESS_BANDS` still names how hard a player is
(easy, medium, hard) but every band now takes **one** turn. Over 731 players, giving the best-known quarter three
turns was worth it: a 1,353-day cycle still left 451 days between one man's turns. It came off at the one-season
pool — the 168 men of a September, plus the legends — where the same weighting brought a player back inside four
months, and a daily that repeats a question inside a season is worse than one that asks a hard question. At the
481 the two-season window restored it would be nearer ten months than four, which is better and still well short
of the 481 days one turn each buys. The pool is already only current players and legends, which is what the
weighting was for.

**How hard was it?** `guessDifficulty(player)` is his place in the pool's ranking, 0 (everybody knows him) to 100
(the hardest in the pool), and `guessBand` is his band. The end screen prints both once the game is over — never
before, where it would narrow the answer.

**Five guesses, not eight** (`GUESS_TRIES`). The two knobs move together: eight guesses at a field this size is
not a game, because most days it falls to elimination. Measured, a bot guessing blind now solves **1.05%** of
games, against 0.20% at eight guesses and 4,637 players — the honest measure of how much easier this is.

## 4. The database

`supabase/migration-guess.sql` creates `guess_runs`, and it is the second board in the game nobody can write:
RLS on, **public select, no insert or update policy at all**. Over/Under and Build-a-player are
browser-written because a guess there leaves no trace a server could replay; a game here leaves exactly that —
a list of player ids — so the `submit-guess` Edge Function's service role is the only writer, as it is for
`century_runs`.

- Columns: `id`, `user_id`, `username`, `guest`, `day` (null for practice), `seed` (null for the daily),
  `solved`, `tries` (checked 1–5), `guesses` (the ids, in order), `answer`, `outcome`, `created_at`.
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

**Accepted gap: the day's answer is computable by anybody who wants it, and that timing is an ordering, not a
secret.** `guessAnswerFor(date)` is pure, the cycle and its shuffle seed ship in `page.js`, and the pool the
cycle walks is served to the whole internet at `/data/guess-pool.json` — fetching it rather than bundling it
(§1) is a difference in weight and none at all in reach. The screen computes the day's player into a memo the
moment a run exists, because it has to colour the rows against something. So a console and thirty seconds are
the whole of it. What that buys is real: the top of `guess_top` every day, an average of 1.00 on `guess_best`,
and **Bullseye's 300 coins** the first time a looked-up daily is solved in two. What it costs is **a real
account**, since `guest_daily` refuses the free kind. What it cannot reach is anything outside this board —
`submit-guess` never touches `profiles`, so no season leaderboard, no ladder, no streak and no best score moves,
which is what that rule is worth. And what is closed is closed deliberately: the **in-app** rehearsal, the way
`isReservedCode` closes the season daily's. No practice code deals the day's player, the who's-in-the-game list
is names only (§6a), and the share card carries no player and no difficulty (§6b), so nothing an ordinary player
would ever stumble into hands the answer over. There is no reserved-code check here, unlike the season's daily
and Century's, because there would be nothing for one to refuse: the daily is a position in a cycle walked from
the date, while a practice seed hashes `guess|<seed>` and picks uniformly from the pool, so no code reproduces a
given day. One code in 481 lands on today's player by coincidence, which is not a way of asking for him.

**Accepted gap, and it has already happened: a daily whose save never lands is playable again, with the answer
already known.** The one-go rule is the partial unique index on `(day, user_id)` and the `duplicate` it raises,
and both need a row to work from — a POST that is simply lost leaves nothing to catch. The other half of the
gate is the per-account record the screen writes to the device before it submits (§6), and a device is a device:
another browser, another phone or cleared site data has never heard of it. On its own that would be no more than
a second attempt. With the gap above it is a **better** one, because the answer was on the end screen of the
first. On 2026-09-30 a player's daily was lost exactly this way, and the row that reached the board was solved
in two, carrying the same two guesses another account had already posted, where the game they had actually
played took four. That one was an honest recovery of a run the site had thrown away; the mechanism is the one
somebody would use on purpose. Two things narrow it and neither closes it. Since v2.18.0 the device record is an
outbox (`pending-daily.mjs`), so a dropped POST usually re-sends itself and there is nothing left to recover —
but it re-sends only on the reasons in `GUESS_RETRY`, and every other answer is read as the server's verdict on
the run and retired unsent (bar `duplicate`, which is the verdict that the row is already in and settles the
record as saved rather than as lost). Since v2.17.0 that same record spends the day whatever the server
answered — but only on the device that wrote it. Closing the rest needs the server to know a daily is in
flight before it is finished, which is a round trip at the start of every daily, and that was judged out of
proportion to one mini-game — the same call CHANGELOG v2.18.0 records for the re-send.

### Refusals

The first nine rows are the **function's**, and each one names itself in the body it answers with. The last two
are the **client's own**, invented by `storage-guess.js`'s `submitGuess` for a failure the function never got to
have an opinion about — and they sit on opposite sides of the same list. `offline` is **in** `GUESS_REFUSALS`,
so a request that never arrived is carried as a reason of its own and can never be read as a rule; `network` is
what a reason **absent** from that list becomes, which is exactly why it cannot be in it.

| Reason | Status | When |
| --- | --- | --- |
| `signed_out` | 401 | no token, or a token for nobody |
| `no_profile` | 400 | signed in, but the account has never claimed a name — the reason `use_account_username` raises without one |
| `guest_daily` | 403 | a guest asking for the daily |
| `wrong_day` | 400 | a `day` that is not the function's today |
| `bad_code` | 400 | a practice seed outside `^[A-Z0-9]{4,16}$` |
| `duplicate` | 409 | today's daily is already recorded for this account |
| `malformed` | 400 | a body that would not parse, or no guesses at all |
| `server` | 500 | the profile read or the insert failed. It is logged first and says "that one is on us, not your connection", because telling somebody to check a connection that was working sent us looking in the wrong place for an evening. Since v2.18.2 the client answers it for the **platform** as well — see below — and it is in `GUESS_RETRY`, so the outbox re-sends |
| `no_guesses` `too_many` `bad_guess` `repeat_guess` `unknown_player` `guessed_past_the_end` `short_loss` `bad_guesses` `no_answer` | 400 | `replayGuessGame` refusing the game |
| `offline` | — | the client's own: nothing reached the function at all — `invoke()` threw, which is DNS, TLS, CORS or a dead radio — or what came back had no readable body. It is in `GUESS_RETRY`, so the outbox **re-sends** the held run |
| `network` | — | the client's own too, and the opposite: the function answered and named a reason **this build has never heard of**, which is a newer function's verdict on the game. Re-sending cannot change a verdict, so it is deliberately **not** in `GUESS_RETRY` and the outbox **retires** the run |

**Which reason a failed POST becomes is decided by the body**, and v2.18.2 is where that stopped being one
bucket. A body naming a reason this client knows is that reason. A body that cannot be read, or that is not
there at all, is `offline` — nothing arrived, or nothing came back. A body naming a reason this client does not
know is `network`. A body naming **no** reason is `server`, because every answer `submit-guess` gives a POST
names one, so a body without one came from the platform in between — the Functions relay, a gateway, a worker
that failed to boot — which is transient and worth another go; a 200 that is not `{ ok: true }` is the same
thing and is read the same way. Until v2.18.2 the last two landed on `network` together, so the outbox threw a
played daily away on exactly the failure it was written to survive.

Every reason the function can answer with is mapped in `storage-guess.js`'s `GUESS_REFUSALS`. A code that
reaches the app unmapped is read as `"network"` and shown as "check your connection" — forever, for a rule
rather than a fault. `tests/test-guess-screen.mjs` 11 holds the map to the function's own source and to
`guess-logic.mjs`'s, so a new reason cannot arrive unmapped.

**A line of its own is a different thing, and only eight reasons have one.** `guess.jsx`'s `refusalLine` words
`duplicate`, `guest_daily`, `wrong_day`, `bad_code`, `signed_out`, `no_profile`, `server` and `network`;
`malformed`, `offline` and all nine of `replayGuessGame`'s fall to its **default**, which names the reason
rather than blaming the connection. That is the right shape for them — a player should never cause one, and if
one ever appears the reason is the whole of what wants reporting. Test 11 holds exactly that split: a sentence
of its own for the four a player can actually cause, and a default for everything else. **The default's daily
clause is the one line of refusal copy still out of date**: it ends "Your daily is still available", which has
not been true since v2.17.0, when the device record began spending the day whatever the save answered (§6).

A practice seed is held to the shape the code box accepts rather than to any string the column would take: a
seed nobody could type is a seed nobody can be challenged with.

---

## 6. The screen

`guess.jsx` — `GuessScreen`, `GuessTable`, `GuessBoard`, and `GUESS_CSS`, appended after `CENTURY_CSS` by
`perfect-season.jsx`. It styles only its own `gp-` prefix and reuses the app's `.btn`, `.h`, `.note`, `.panel`
and `.mode`. It is reached from **Mini games**, not Modes (v2.10.0).

- **The grid is a real table**, because that is what it is: a row per guess, a column per thing compared, the
  player's name as the row header. **The name column takes what the five cells do not** (they are 13.6% each):
  a fixed table layout with no widths gives six equal columns, which left the name 55 pixels on a phone and
  every row reading "Tyler C...". A long name **wraps** rather than being cut, because an ellipsis hides the
  half that identifies him. `tests/test-a11y.mjs` measures it at 320, 375 and 390 pixels in a real browser -
  nothing else can see a clipped box.
- **Every cell carries a visually-hidden sentence** — "Team KC: exact", "Class 2014: close, higher". The colour
  is the whole of the signal for everyone else, and colour may never be the only thing that means something
  (CLAUDE.md, v1.18.0's accessibility pass). The printed short form is `aria-hidden`, so a reader gets the
  sentence rather than both.
- **Both paints take a dark ink** (`CELL_INK`), and it has to be dark: `--win` is the game's light green and
  white on it is 1.8:1. `tests/test-a11y.mjs`'s entry for this grid caught that on its first run.
- **The search box offers eight names at most**, needs two letters, drops anyone already guessed, and shows
  `{pos} · {draft}` beside each name, because a name alone need not say which player you mean. The 4,637-player
  pool had 49 names belonging to two men, two Adrian Petersons among them; the 481 has none, and the line stays
  anyway — the build guarantees only that no two men share all five **columns** (§1), never that no two share a
  name, and the pool is rebuilt every season.
- **The instant result is computed by `replayGuessGame`**, the function the server replays with, not by a
  comparison written in the screen. It is what the end screen shows until the save answers, and a **refused**
  save never replaces it at all — a tab left open on a daily finished elsewhere. A second copy of "was it
  solved" would eventually disagree with the one that counts.
- **A game in progress is saved per device** (`ps-guess-wip`), through `sget`/`sset`/`clearDraft`. A `started`
  ref guards the resume race — a slow read landing on top of a game that has since been started, which is what
  a Century share link cost on staging (CENTURY.md). A saved daily from another day is thrown away rather than
  resumed.
- **A finished daily is recorded on the device before it is submitted**, and whatever the submission answers
  (`GUESS_DONE(userId, day)`, `ps-guess-done:<account>:<day>`). That is what stops a refused save being turned
  into a fresh attempt with the answer still on the screen behind it. It is keyed by ACCOUNT as well as by day
  because device-scoped it leaked: play the daily, sign out, and the next person to sign in here — a guest
  included, who may not play it at all — read the day as already spent. Since v2.18.0 it carries `saved`, and
  while that is false the run is still owed to the board; `pending-daily.mjs` re-sends it verbatim, never
  rebuilt and never merged, so a re-send can only ever post the game that was played. The re-send runs from the
  app rather than from this screen, because the end screen's Done button leaves for Mini games and a drain that
  only ran here would never run again. What none of it covers is a second device — §5.
- **The daily's "played today" hint is keyed in UTC** (`GUESS_DONE_KEY(utcDayKey())`), because UTC is the day the
  run is filed under. Keying it locally is a real bug that shipped in Century and only surfaces on a session
  either side of UTC midnight.
- **A guest is shown the daily as a live control that explains itself**, not as a disabled button: it takes them
  to the Account tab, which is where the answer is.
- The root goes into the **dark scope** while a game is in progress, like every other board.

---

## 6a. Who's in the game

The menu carries a **list of every player the game can ask about**, closed by default, names only, grouped by
position with a count each.

It exists because the pool had a boundary nobody could see. "Everyone who has played since last season" is a
category a fan can reason about; "and twenty-five of the greats" is not — so the only way to find out whether Jerry Rice was in
it was to type his name and see. That is not difficulty, it is a guessing game *about* the guessing game, and
with the pool down to a couple of hundred it can simply be shown.

**Names only, and that is the whole design.** A list with teams, draft classes and numbers on it would not be a
list, it would be the answer key: you could filter it by the colours already on your grid and read the man off.
The names bound the search; the five clues still have to be earned. `tests/test-guess-screen.mjs` 12b checks
both halves — every player appears, and the day's answer's team, class and number do not.

## 6b. Sharing

A Wordle-style card, one row of five squares per guess (green exact, yellow close, black no), the result as
`3/5` or `X/5`, and a link. The Share button sits on the end screen and hands the text to `sendShare`, the same
helper the season and Century use — the phone's share sheet where there is one, the clipboard where there isn't.

```
Gridspin · Guess the Player 16 · 3/5
⬛⬛🟨⬛⬛
⬛⬛🟩⬛⬛
🟩🟩🟩🟩🟩
https://gridspin.app
```

**Why the squares are safe when the guesses never are.** A reader does not know what was *guessed*, so a green
in the team column says only "the answer's team matched a guess of mine" — a fact about a name they do not have.
That is the whole argument, and it is why this could be built after GUESS.md said it could not: the earlier note
assumed the colours gave away the division and the side of the ball, which they only would if the guesses were
on the card too.

**What is deliberately not on it:** the player, the guesses, and the day's **difficulty**. The first two are the
answer. The third is a real hint — everyone reading a daily's card is playing that same day, and "difficulty
8/100" tells them it is somebody obvious. The end screen shows it because the game is over there.

`tests/test-guess-screen.mjs` 13 checks the spoiler rule by name against the game just played, and then checks
that **every line on the card is one of the four it is allowed to be** — looking for known spoilers only catches
the ones somebody thought of, and a stray line is how one would actually arrive.

**The link.** A practice card carries `/c/CODE?mode=guess`, which is the season's challenge route with a mode of
its own (`parseChallengeLink`), so no new address and no `vercel.json` change were needed. Taking it opens the
game on that seed, the way a Century link opens its seven teams, and costs no draft. **A daily's card carries no
code at all**: everybody already has that day's player, and a link that dealt it would be a way round the
one-go rule.

## 6c. The badge

**Bullseye** 🎯, silver, 300 coins — *name the daily player in two guesses*.

The first guess is blind: there is nothing on the board to reason from. So this is one informative opening plus
a deduction that lands, which is rare without being pure luck. Five guesses are allowed; two is the badge.

- **The daily only.** Practice is unlimited, so two guesses there is something anybody has by tea time. The
  number the rule reads is `player_stats`' `guess.daily_best` — the fewest guesses a *solved daily* took.
- **`submit-guess` awards it itself**, the way `submit-century` does and for the same reason: submit-run pays
  every other badge from `player_stats`, but only on the player's next finished **season**, which somebody who
  plays this and nothing else may never have. The function witnessed the game, so it records it. `award_badges`
  is idempotent per (user, badge) and `badge_rewards` decides the amount, so it can neither pay twice nor pay
  the wrong number, and a failed award never fails the game.
- **It pays**, unlike Stat Nerd and Mad Scientist, because a guess run is *verified*: the function recomputes
  the answer from the date and the result from the guesses, so there is no version of this a browser can assert.

**`min()` over no rows is NULL, and that is the whole of the empty case.** An account that has never solved a
daily has no best — not a zero, which would read as "solved it in none" and hand the badge to everyone who had
never played. `badges.mjs`'s `value()` answers NaN for null, and `NaN <= 2` is false.

**A new badge is three files, not one** (CLAUDE.md, SHOP.md): the `badges.mjs` entry, a re-run of
`migration-wallet.sql` so `badge_rewards` knows the amount, and — because badges are computed from stats — a
number in `player_stats` for the rule to read. That is why this release also adds a `guess` block to
`migration-runs-log.sql`, mirrored in `tests/mock-profile-stats.mjs` and held to the SQL row for row.

It is also why **`migration-guess.sql` must run before `migration-runs-log.sql`**: `player_stats` is
`language sql`, so its body is validated the moment it is created and a missing `guess_runs` fails the whole
migration outright. The runbook already had that order; now something depends on it.

## 7. Tests

| File | What only it can hold |
| --- | --- |
| `tests/test-guess-logic.mjs` | every rule and refusal; that five greens identify exactly one player **across the whole pool**; that the pool is skill positions only and mostly men playing now; that the legends are in and are not treated as obscure; that the cycle asks everybody before anybody twice; the difficulty scale; and how often a blind bot wins |
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

Rebuild the pool with `node tools/data/build-guess-pool.mjs`. It fetches about 30 MB from nflverse - the player
index, PFR's draft history, every season of rosters back to 1999 (jersey numbers, and the team an undrafted man
came in with) and snap counts for the two seasons the window covers - and caches it under `build/nflverse/`,
so a second run is quick; delete that folder to refetch. It refuses to write a file with an unlisted clash, and
`tests/test-guess-logic.mjs` re-checks every property of the file it writes.

**Re-run it when a season ends.** The pool is a ranking of the present as much as the past.

`GP_WHY` went with the score-ranked pool it belonged to. It named men and printed where each stood inside his
position group and how far he was from the cut, which was the question worth asking when a share of every group
was kept - it is how you told "the score is wrong about him" from "he is the fifty-third best quarterback of the
century". Membership is a snap count now, so the question answers itself: 100 snaps since the 2025 season, or
not. What the run prints instead is everything still worth knowing about a build - how many men cleared the bar,
the legends it took, how many rows were dropped for having no jersey number or no team the game knows, the five
easiest and the five hardest, and how many days the cycle comes round in. `GP_SEASON` pins the season it treats
as the current one, for a rebuild run out of season.

---

## 9. Not built

- **Nothing on the profile SCREEN.** `player_stats` has carried a `guess` block since v2.15.0 and Bullseye is
  awarded by `submit-guess` itself, but no screen prints either. Century's
  badge took a release of its own; this can have the same.
- **No streak.** The all-time board counts dailies solved and the average, which is the honest measure; a streak
  would need a day-by-day walk and a rule for the days nobody played.
- **The difficulty is shown but not used.** It could pick the day's *intended* difficulty (an easy Monday, an
  expert Sunday), order the search box's suggestions, or seed a future multiplayer match - all of which the
  score now makes possible, and none of which is built.
