# Century — the reference

A mode of its own, shipped in v2.9.0. Seven slots, hidden stats, and a goal of **100** combined passing,
rushing and receiving touchdowns from **one real season** (2025). Every spin deals a random team; you fill one
slot from it and that team is spent. One team re-spin. Daily and Unlimited.

`CLAUDE.md` has the release rules and the architecture this sits inside. This file is the contract: what the
data is, where each rule lives, what the database holds, and what a submission can be refused for.

---

## 1. Why the data is its own file

`data/players.json` holds **one row per player per team per five-year era — his best season in that era**.
That is right for a draft that spins an era and wrong for a mode that names a single year.

Filtering it to `season === 2025` answers a different question: *whose best 2021–25 season happened to be
2025*. It returns 129 of 634 players, no Mahomes (his best in that window was 2022), and 18 of 31 teams with a
quarterback. Every number derived that way is measuring a biased subset. **This is a real mistake that was
made and shipped into an analysis** before the owner pointed out that there are 32 teams and every one of them
had a quarterback.

So Century has its own source and its own file:

| | |
|---|---|
| Built by | `tools/data/build-season-pool.mjs` (public nflverse `stats_player_week_2025.csv.gz`) |
| Written to | `data/season-2025.json` — 435 rows, 14 KB, positional rows behind a `columns` list |
| Read by | `century-logic.mjs`'s `initCenturyData`, and nothing else |
| Contents | one row per player per team: `team, name, pos, td, games` |

`td` is passing + rushing + receiving touchdowns, **regular season only**. A player traded mid-season keeps a
row per team, each holding what he scored *for that team* — which is what a board has to offer.

**Parse the CSV with the quote-aware `cells()`.** A player row carries a headshot URL with commas inside its
quotes. A naive `split(",")` returned three regular-season rows out of 19,000 and read the league as having no
quarterbacks. `build-versus-pool.mjs` carries the same warning, from the same failure.

**`MIN_GAMES = 6`.** Without a floor a team deals up to 26 names of which 16 never scored, and picking blind
from that is a coin toss rather than a read on the season. Six games is a third of one, and it costs the pool
nothing that matters: **not one team-position loses its leading scorer to it**. It leaves 12–16 names a board,
about a quarter of them without a touchdown — real risk, no haystack.

**The builder refuses to write a file that cannot deal a legal board.** 32 teams, every one present in
`game-logic.mjs`'s `TEAMS`, every one fielding a QB, RB, WR and TE, no duplicate player-team row, every `td` a
whole non-negative number. A build that fails any of those exits non-zero rather than shipping a mode that can
strand a player mid-run.

---

## 2. Where the rules live

**`century-logic.mjs`, and only there.** It is imported by `century.jsx`, by
`supabase/functions/submit-century/index.ts` and by the tests — the same arrangement `game-logic.mjs` and
`versus-logic.mjs` have, for the same reason: the browser shows a score the instant the seventh slot is filled
and the server decides whether it counts, and a rule enforced on one side and not the other will drift.

| | |
|---|---|
| `CENTURY_SLOTS` | `QB, RB1, RB2, WR1, WR2, TE, FLEX`. The numbers exist so a roster can be keyed by slot; they are not a depth chart and grade identically. |
| `centuryFits(pos, slot)` | Flex takes anyone who is not a quarterback; every other slot wants its own position. |
| `centuryPlan(seed)` | Seven teams, no repeats, from the seed alone — same seeded shuffle as `seededSequence`. |
| `centuryRespinTeam(seed, step, plan)` | The re-spin's team. Excludes the **whole plan**, not the part already seen. |
| `centuryTeamsDealt(seed, respunAt)` | The seven teams a game was actually played from. One place, so the screen, the ceiling and the replay agree. |
| `centuryCeiling(seed, respunAt)` | What those seven teams were worth at best. **Exact**, not greedy. |
| `replayCentury({ seed, picks })` | The whole legality check, and what the server scores from. |
| `centuryOutcome(score)` | The stored line. It is stored, so like the season sim's outcome strings it must not change. |

**The re-spin excludes the whole plan** for the reason `rerollCandidate` does: a re-spin onto a team still to
come would deal that team twice, since nothing removes the original. It also depends on `step`, so the spare is
not knowable before it is spent.

**The ceiling is exact.** It is an assignment of seven teams to seven slots, and greedy gets it wrong —
spending the best team's quarterback on the Flex can cost more than it gains. 5,040 permutations of seven, each
seven lookups, so exactness is affordable. It is the only fair way to read a score: a draw of seven weak teams
cannot reach 100 however well it is played, and the end screen says so.

**A game is always finishable.** Every team fields all four positions, which the builder refuses to write a
file without, so any team can fill any empty slot. `centuryCanStrand` says it out loud and
`tests/test-century-logic.mjs` plays 3,000 seeds through a deliberately bad bot to prove it — 0 stranded.

---

## 3. Why 100

Measured against the real data, over 20,000 games played by a bot that always takes the leading scorer for a
slot it still needs. With the stats hidden, that bot **is** what perfect knowledge of the season looks like, so
these are a ceiling on skill, not a floor:

| | |
|---|---|
| Median | **80** |
| p90 / p99 | 95 / 108 |
| Reached 100 | **5.1%** |
| Absolute ceiling (best seven teams, assigned perfectly) | 133 |
| Best ceiling in 20,000 draws | 127 |
| A spin that can fill nothing | 0.00% |

So 100 is a real target for somebody who knows the season and out of reach for somebody guessing, which is what
a knowledge game's goal should be. `tests/test-century-logic.mjs` **prints these every run** and fails if the
goal stops being reachable (>0.5%) or stops being hard (<25%). Changing `MIN_GAMES`, the slots or the Flex rule
moves all of them.

---

## 4. The database

`supabase/migration-century.sql` — one table and two boards.

**`century_runs` has no client write policy at all.** RLS on, public select, and the `submit-century` Edge
Function's service role is the only writer, exactly as `profiles`, `daily_runs` and `matches` are. This is
unlike `sou_runs` and `builds` beside it, and the difference is the point: Over/Under is browser-written
because a guess leaves no trace a server could replay, while a Century run leaves exactly that — seven
`(slot, player)` pairs and at most one re-spin — so the score can be derived from scratch server-side. A board
anybody can POST a number onto is not a board.

- `day` is `'YYYY-MM-DD'` text (matching `sou_runs` and `daily_runs`), NULL for Unlimited. A **partial unique
  index** on `(day, user_id) where day is not null` is what makes the daily once per account.
- `username` and `guest` are stamped by `use_account_username`, the trigger `sou_runs` and `builds` carry, so
  the name comes from the account and a guest's arrives with its chip rather than as a link.
- `ceiling` is stored, because recomputing it later would need the season pool of the day it was played.
- The id sequence is revoked from `anon` and `authenticated`, like `wallet_ledger`'s.

**`century_top(p_day, p_limit)`** is one day's board; **`century_best(p_limit)`** is every account's best run,
daily or Unlimited, one row per account. Both invoker, both stable, both read as GET, both fully tiebroken
(score, then `created_at`, then `username collate "C"`). `tests/mock-century.mjs` mirrors them and
`tests/test-century-sql.mjs` holds the two to the same JSON — an order that is not fully tiebroken is an order
they can disagree about.

**Migration order.** `migration-century.sql` goes **after `migration-profiles.sql`** (it creates a trigger
using `use_account_username`) and **before `migration-moderation.sql` and `migration-wallet.sql`** (`mod_act`
rewrites this board's name snapshots, and `claim_minigame` reads this table). Those bodies are plpgsql and so
are not validated when they are created, which is exactly why this is a runbook order rather than an error
anybody would see: get it wrong and nothing fails until a guest trades up.
`tests/test-migrations.mjs` runs the whole list on a bare database and enforces it.

**A rename reaches this board**, in both places a name is ever rewritten: `mod_act` (moderation) and
`claim_username`'s two arms (profiles). A new board has to be added to each by hand — nothing makes it
inherit that, which is why `tests/test-century-sql.mjs` drives a real rename and a real guest trade-up.

---

## 5. The Edge Function

`supabase/functions/submit-century/index.ts`. It takes the trace, never the score.

- **The daily's seed is the function's own clock** (`century-<utc today>`), never taken from the client. The
  client's `day` is only *checked*, so a tab left open past UTC midnight is told rather than recorded against a
  board it never saw.
- **An Unlimited seed must look like a challenge code** (`^[A-Z0-9]{4,16}$`), and must not be reserved. A code
  that *hashes* to a daily's seed deals that daily's seven teams bit for bit — `hashStr` is FNV-1a/32 and
  invertible, and `tests/test-century-edge.mjs` **finds such a collision in about a second** by meeting in the
  middle, so the check is on the hash and not on the spelling. Same protection the main daily has.
- **A guest may not play the daily** (`guest_daily`), for the reason they may not play the season's: a guest
  account costs nothing to make. They may play Unlimited and they do earn coins.
- **It never touches `profiles`.** Century keeps its own board, so a run cannot move a season leaderboard, a
  best score, a streak or a badge. That is also why it is a function of its own rather than an arm of
  `submit-run`: nothing about the season path changes to add a mode.
- **It pays no coins.** The client claims them with `claim_minigame('century', day)` once the run saves,
  exactly as Over/Under and Build-a-player do, so every coin in the game still moves in one place.

### Refusals

Every one of these is mapped in `storage-century.js`'s `CENTURY_REFUSALS` and worded in `century.jsx`'s
`refusalLine`. **A code that reaches the app unmapped is read as `"network"`** and shown as "check your
connection" — forever, for a rule rather than a fault. `tests/test-century-screen.mjs` holds the map to the
function's own source and to `century-logic.mjs`'s, so a new one cannot arrive unmapped.

| Reason | Means |
|---|---|
| `duplicate` | today's daily is already recorded for this account (409) |
| `guest_daily` | a guest asked for the daily (403) |
| `wrong_day` | a tab left open past UTC midnight |
| `reserved_code` | a code that deals a daily's own seven teams |
| `bad_code` | not a code the box would accept |
| `malformed` | no picks at all |
| `bad_seed` `bad_picks` `wrong_length` `bad_pick` `two_respins` `bad_slot` `slot_taken` `not_on_board` `wrong_position` `already_drafted` `no_team` | `replayCentury`'s own. A player should never see one — the screen enforces the same rules from the same module. If one appears, the two have drifted. |

`already_drafted` is not theoretical: four players are on two boards in 2025, so the same person really can be
offered twice.

---

## 6. The screen

**Where it is reached from (v2.10.0):** Modes → **Mini games** → Century, not Modes directly. Leaving Century
returns to Mini games. `tests/helpers.mjs`'s `clickMode` walks that route on its own, so a test still just asks
for "Century".

`century.jsx`. **It is the draft screen**, deliberately, and that is the single most important thing about it:
a run uses the app's own `.reel`, `.roster`/`.slot`, `.sec`/`.card` and `.drafts` "Lock in" controls, the menu
deals the same `.mode` tiles the Modes screen does, and the result lands on `.result-hero` with the record type
(`.rec`) the season's own result uses. The stat cells are simply left off - which is exactly what Genius mode
does to the same markup, so "a draft with the numbers hidden" already had a shape in this game and Century
takes it rather than inventing a second one.

Two things follow from that and are worth stating, because both were got wrong first:

- **The root takes the dark scope while a run is in progress**, not the container. Scoping only `.ce-play` gave
  dark-scope text on a cream page and left the position headings nearly invisible. `CenturyScreen` reports its
  stage up through `onStage`, and `perfect-season.jsx` puts `view === "century" && centuryStage !== "menu"` into
  the same expression that darkens the play and duel views. The result screen is dark too, because a season's is.
- **Reusing a class means inheriting its rules, which is the point.** Century adds no `pointer: coarse` or
  reduced-motion block of its own: every control on these screens is one of the app's, and those already carry
  their touch targets and their motion rules. A copy would be a second, quietly diverging set. The only override
  is the roster's column count, because seven slots do not fit a grid built for six.

It draws the rules and holds none of them, with one exception that matters:

**`centuryBlock(player, slot, roster)` is the only place a pick is judged**, and both the board's `disabled`
state and its click handler call it. CLAUDE.md records what getting this wrong costs: the GM salary cap was
enforced on one of the draft screen's two doors and not the other, for three releases, so a player could put a
$42M player into a $19M gap and then be refused by the server under a screen promising it would save.
`tests/test-century-screen.mjs` walks a real board and asserts that every enabled row has somewhere to go and
every disabled one has nowhere — if the disabled state came from anything else, one of those counts is wrong.

Other things worth knowing:

- **The reel is cosmetic and nothing seeded reads it.** It cycles nine team faces at 70ms; the team it settles
  on was decided by `centuryPlan` long before. `reducedMotion()` (ui-common.jsx, shared with the main component)
  skips it entirely - which is also what makes the tests instant, since `tests/helpers.mjs` makes that media
  query match. While it runs the board is not rendered at all, exactly as the draft withholds one.
- **A run in progress is per device, not per account** (`ps-century-wip`, through `sget`/`sset`/`clearDraft`).
  It resumes, which is the rule for every daily in the game. Clearing it overwrites with an unusable snapshot
  before deleting, because a delete that does not land must never bring a finished run back as a resumable one.
  A daily snapshot from a day that has passed is dropped — its seven teams were yesterday's.
- **A started run beats a resume that is still in flight** (v2.11.1). The snapshot read is async and starting a
  run is not, so a read begun before a link was taken landed after it and restored the old run over the shared
  one - with the saved snapshot correct and only the screen wrong, which is why storage-checking tests missed
  it. A `started` ref carried across the await settles it, the way `pendingClears` does for the draft.
- **Two request counters, not one.** Account-scoped reads (the daily already played, the boards, the
  submission) are guarded against a previous account's answer landing. The device-local snapshot read is
  **not**, and sharing one counter is a bug that was made here: the snapshot read started, the
  daily-already-played read bumped the counter, and the resume was thrown away as stale — so a half-finished
  run came back as the menu for anyone signed in. `tests/test-century-screen.mjs` 5 is that test.
- **A played daily is still openable** (v2.10.1). The tile reopens that run from the roster `fetchMyCentury`
  already returns, and looking at it records nothing. It used to be disabled while the Mini games tile promised
  "See today's result", which is the kind of gap only a click finds.
- **No disabled control says "Sign in to play"** (v2.10.1). Signed out, or a guest on the daily, the tile stays
  live and calls `onNeedsAccount`, which the app answers with a notice and the Account tab.
- **Both board tab panels are rendered**, the closed one `hidden` (v2.10.1). Rendering only the open one left
  the closed tab's `aria-controls` pointing at nothing; `tests/test-a11y.mjs` now refuses that on any screen.
- **The Modes tile's "Done · N" is a per-device hint**, kept the way Over/Under's is. The record is
  `century_runs`, which the screen asks directly (`fetchMyCentury`) before offering the daily; the two can
  disagree across devices and the screen's answer decides.
- The spin panel and the result hero are **stadium-dark wherever they appear**, so both are named in
  perfect-season.jsx's dark-scope selector list and take `--bg` / `--ink` / `--accent` from there. Nothing in
  `CENTURY_CSS` hardcodes a colour; the team tints the panel through `--tc-deep`.

---

## 7. Tests

| | |
|---|---|
| `tests/test-century-logic.mjs` | every rule, every refusal, 3,000 seeds for stranding, the ceiling against an independent search, and the balance numbers (printed) |
| `tests/test-century-edge.mjs` | the real `index.ts`, executed: who is asking, the daily's clock, the duplicate, the guest, a found hash collision, and that the score written is the function's whatever the client claims |
| `tests/test-century-sql.mjs` | the migration in PGlite: nobody writes the table, the daily's unique index, both boards against the mock, a rename, a guest trade-up, and the coin claim |
| `tests/test-century-screen.mjs` | the buttons: the tile, both variants, seven picks clicked through, the re-spin, resume, the boards, the guest, the two doors, and the refusal map |
| `tests/test-a11y.mjs` | the menu and the board, both under axe-core |
| `tests/test-migrations.mjs` | the migration's place in the runbook order |

The UI harness serves it at `?screen=century[&picks=N][&finish=1]` - a run part-played, written into the same
per-device slot the screen resumes from, so it exercises the resume path on the way in. `finish=1` locks the
seventh slot in on load, which is the only way anything automated reaches the result screen without playing seven
picks by hand; `tests/test-a11y.mjs` audits all three.

---

## 8. The badge

**Century** 💯, gold, 1,000 coins: reach 100 in the **daily**. Not any Century — Unlimited is unlimited, and a
hundred there is an evening of retries at roughly one run in twenty, while the daily gives one go at one set of
seven teams. `player_stats()`'s `century.daily_best` is the only number that tells the two apart, which is why
it is carried separately from `best`.

It is the first minigame badge that **pays**. Stat Nerd and Mad Scientist pay nothing because Over/Under and
Build-a-player are browser-written; a Century run is verified, so there is no version of this a browser can
assert. And `submit-century` awards it itself rather than leaving it to submit-run's next finished season,
because somebody who plays Century and nothing else may never finish one. A failed award never fails the run.

`badges.mjs` holds its own `CENTURY_BADGE_SCORE` rather than importing `CENTURY_GOAL` — that file is pure by
rule and `tests/test-badges.mjs` enforces it — and a test holds the two numbers equal.

## 9. Runbook

Deploy order: **`migration-century.sql` FIRST → `migration-runs-log.sql` → `migration-profiles.sql` →
`migration-moderation.sql` → `migration-wallet.sql` → the Edge Functions (`node deploy-function.mjs <env>`,
which now deploys three) → the client.**

Century goes first because `player_stats` reads `century_runs` and is `language sql`, whose body is validated
when it is created. Its own trigger lives in `migration-profiles.sql` so that this file depends on nothing.

```sql
-- Take a run back (a farmed result, a bad row)
delete from century_runs where id = 123;

-- What today's board looks like
select username, score, hit, ceiling from century_runs where day = to_char(now() at time zone 'utc', 'YYYY-MM-DD') order by score desc;

-- Let somebody play today's daily again (support, not a routine action)
delete from century_runs where day = '2026-09-28' and user_id = (select id from profiles where username = 'NAME');
```

Rebuild the pool when a season ends: `node tools/data/build-season-pool.mjs 2025`. It refuses to write a file
that cannot deal a legal board, so a failed build is a loud one.

---

## 10. Sharing

`centuryShareText` and `centuryChallengeLink` in `century.jsx`, tested in `tests/test-share.mjs`.

The card names **no player and no team**. That rule is stricter here than for a season: the daily's seven teams
are the same for everyone that day, so a hint at one spoils it for every reader. Everything on the card comes
from the score, which the card states in words anyway — the ten squares (one per tenth of the goal) add nothing
a reader could not already see, which is what makes them safe. The test holds this against the real pool: not
one of the 435 players and not one of the 32 teams may appear.

An **Unlimited** card carries a playable link, because Century's seed *is* a code:
`/c/<seed>?mode=century&score=N`, on the `/c/:code` route `vercel.json` already serves. `parseChallengeLink`
returns `century: true` and the Modes card offers "Play these teams"; taking it costs no season draft, since
none is involved. `score` is a headline only, the way a season link's `beat` is, and is dropped unless it is
plain digits within range.

The **daily never gets a link**. Its seed is `century-<date>` and a link holding that hands over the day's seven
teams — the whole reason `centuryReservedSeed` exists. A test asserts the seed appears nowhere in its card.

## 11. Not built
- **No Century numbers on the profile.** `player_stats` counts the runs now (the badge reads them), but the
  profile screen shows none of them. Deliberate: a best score has a ceiling, and the repo already learned that
  lesson when position records were dropped from Stats for maxing out and never changing again. The badge is
  the right shape for an achievement with a top — a stat is not.
- **Century is in no ladder** and pays the standard 15 minigame coins a day beyond the badge.
