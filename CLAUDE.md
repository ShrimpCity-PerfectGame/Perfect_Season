# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Perfect Season

An NFL roster-drafting game modeled on 20-0.com. Each round spins a random **team + five-year
era**; you draft one player from that board to fill **QB, RB, WR, TE, and two Flex**. Every player
shows his best real season for that team in that era, with full stats but **no fantasy points**.
Once six are picked, the roster is graded and plays a 17-game season against real NFL team-seasons,
then the playoffs. Win all 20 and you've gone perfect.

Everything currently lives in one self-contained React file: `perfect-season.jsx` (~360 KB, ~2,300
lines, with all player and opponent data inlined as JSON on line 3 — avoid full-file reads, use
targeted `offset`/`limit` reads or grep instead).

## Build/Run Commands

```bash
# Type/compile check (fastest feedback loop)
npx esbuild perfect-season.jsx --bundle --format=esm --platform=node \
  --jsx=automatic --outfile=build/app.js --external:react --external:react-dom

# Build a runnable page for browser testing (entry.jsx mounts the app; storage.js's getClient()
# falls back to a real @supabase/supabase-js client built from SUPABASE_URL/SUPABASE_ANON_KEY,
# injected at build time - use build.mjs, NOT a raw esbuild CLI call, or those come back
# undefined and every auth/leaderboard call throws at page load)
SUPABASE_URL=... SUPABASE_ANON_KEY=... node build.mjs
# then open public/page.html, which loads public/page.js

# Headless DOM tests (jsdom + react-dom/client, drive the real UI via tests/helpers.mjs) - these
# never touch a real Supabase project; window.__ps_supabase__ is a mock (see makeMockAuth in
# tests/helpers.mjs), installed the same way window.storage is
node tests/test-accounts.mjs      # signup, login, stats persistence
node tests/test-daily.mjs         # seeded boards, daily lock, challenge codes
node tests/test-nav.mjs           # landing page, mode switching, draft resume
node tests/test-mode-switch.mjs   # switching Unlimited/Genius/GM mid-draft starts fresh, doesn't resume the wrong variant
node tests/test-wip-race.mjs      # end-of-draft storage race (see pendingClears below)
node tests/test-board-order.mjs   # board section reordering timing
node tests/test-reroll-pool.mjs   # reroll can't repeat an already-used team+era
node tests/test-flex-scoring.mjs  # Flex grades on raw production, not position
node tests/test-admin.mjs         # admin-account gating + force-board/player/outcome tools
node tests/test-difficulty.mjs [N]  # plays N drafts with a bot, reports avg wins / 20-0 rate

# Browser checks (Playwright, screenshots + motion checks)
python3 tests/shots.py

# Rebuild the game data from source (only when adding a season or changing grading)
cd scripts && python3 build.py && python3 correct.py && python3 rate2.py \
  && python3 boards.py && python3 export.py   # writes data.json
```

`npm test` runs the accounts/daily/nav suite; the other test files are run individually as shown
above. There is no single-test flag — each `tests/*.mjs` file is a standalone script that exits
non-zero on failure.

Note: as of this writing, `scripts/*.py` (the nflverse/Pro-Football-Reference data-correction
pipeline referenced above) and a standalone `data.json` do not exist in this checkout — the player
and opponent data is already inlined in `perfect-season.jsx`. Regenerating them would need the real
upstream source data; don't assume the pipeline is present without checking.

## Architecture

**Single component, module-scope helpers.** `perfect-season.jsx` default-exports one
`PerfectSeason()` component. Everything above it (constants, `BOARDS`/`OPPS` data, `simulateSeason`,
`bestAvailable`, `RosterRows`, `AuthPanel`, `AdminPanel`, etc.) is module scope — plain functions and
consts, not hooks — so they're usable from tests or other components without touching React state.

**Storage is split across two real backends, both behind `storage.js`.** Personal, per-device
data (draft-in-progress snapshots, the howto-seen flag) goes through `window.storage.{get,set,
delete,list}(key, shared)` — a localStorage-backed shim in `entry.jsx` for the browser, an
in-memory one in `tests/helpers.mjs`. Everything sitewide (accounts, stats, the leaderboard, daily
runs) goes through a Supabase client instead: `storage.js`'s `getClient()` returns
`window.__ps_supabase__` when a test/dev override is installed, otherwise a real
`@supabase/supabase-js` client built from `SUPABASE_URL`/`SUPABASE_ANON_KEY` (injected at build
time by `build.mjs` — see Build/Run Commands above). Auth, profile reads/writes, and leaderboard/
daily queries all go through named functions in `storage.js` (`authSignUp`, `fetchProfile`,
`fetchLeaderboardTop`, `upsertDailyRun`, etc.) — never call `getClient()` directly from
`perfect-season.jsx`. Personal-key reads/writes still go through `sget`/`sset`/`sdel`/
`clearDraft`, which swallow errors and return null — **assume this half of the API has no
read-after-write ordering guarantee** (Supabase's Postgres-backed half doesn't have this problem).
A read that starts after a write can still resolve first. The `pendingClears` ref-counter in the
main component (guards `refreshWip()` against a stale read landing while `clearDraft()` is still
in flight) is the pattern to follow for any future bug in this class — don't try to fix it with
`await` ordering, since the race is between two independent async calls that don't share a promise
chain.

**Row Level Security, not app code, is the write gate.** `supabase/schema.sql` defines `profiles`
and `daily_runs` with public SELECT and `auth.uid()`-gated writes; a `handle_new_user` trigger
creates a profile row atomically when `auth.users` gets a new row (reading the username from
`signUp()`'s `options.data.username`), so there's no separate client-side insert that could leave
an orphaned auth user. **Known limitation**: an authenticated client can still write any
`best_score`/`recent` payload for their own row — RLS proves who is writing, not that the number is
truthful. Real tamper-resistance needs server-side score recomputation from a signed roster+seed;
worth doing before tying money to leaderboard rank.

**Everything seeded runs through `mulberry32(hashStr(seed))`.** Board sequences
(`seededSequence`), reroll picks, and the season simulation (`simulateSeason`, wrapped by
`withSeed` which temporarily swaps global `Math.random`) all derive from `mode.seed` (`daily-<date>`
for the daily, a random `code` for Unlimited/challenge links) plus the exact roster drafted. Same
seed + same lineup always produces the same result — this is what makes challenge codes and daily
results reproducible/shareable, so don't add unseeded randomness to any of that path.

**Reroll pool exclusion.** A reroll must never repeat a team+era already anywhere in the draft's
planned sequence (`seq`, not just the shown prefix — a rerolled pick that duplicates a
not-yet-reached future entry in `seq` will resurface again later, since nothing removes the
original). `reroll()`'s `match()` closure excludes `new Set(seq)` for this reason; if you touch
reroll logic, keep that invariant.

**Grading splits by slot type.** Named slots (QB/RB/WR/TE) grade on `rating`, a position-and-era
-normalized value baked into the inlined data. Flex slots grade on raw production instead
(`flexRating`/`effectiveRating`, computed client-side by renormalizing `ppr` across the combined
RB/WR/TE pool per era window and rescaling onto `rating`'s existing numeric range) — a Flex pick
is deliberately *not* compared against its own position's peers. `effectiveRating(slot, player)` is
the one place that decides which grade applies; use it (not raw `.rating`) anywhere a slot's
contribution to team score is computed or displayed.

**Win probability is linear and hits hard 0%/100%.** `winProb(s, o)` in the season sim is a
clamped-linear function of the score gap (`SPREAD = 20`), not a sigmoid — a real lead eventually
guarantees the win outright rather than merely favoring it. If tuning difficulty, `SPREAD` is the
single knob (smaller = fewer upsets / more decisive); the regular-season schedule is drawn once
then reordered easy-to-hard via `windowedShuffle` (same win distribution, just better-timed losses),
and playoff opponents are sampled from a wide band per round (`CANDIDATE_POOL_SIZE`) rather than a
tiny 3-4 team pool, to avoid the same few dynasty teams dominating the championship slot.

**Admin testing tools.** Logging in with the username `admin` (case-insensitive, no special setup)
unlocks an `AdminPanel` on the active draft screen: jump to any team+era board instantly, force a
specific named player into any open slot, or force a scripted season ending (perfect/champ/lose-
each-playoff-round/missed-playoffs) via `forceSeason()`. Forced outcomes skip every persistence
side effect in `finish()` (stats, leaderboard, daily/draft storage) — use this account to check
win/loss animations instead of fighting the RNG or hand-rolling a fixture.

## Development Guidelines

**Verify in a running app, not by reading code.** Every feature so far was checked by driving the
real UI in jsdom or Playwright. Automated runs have caught bugs that looked fine on paper: a stale
draft snapshot resurfacing as "5 of 6 picked", a ball that teleported across the field, playoff
opponents that never got harder, a reroll that could re-queue a board already used elsewhere in the
sequence.

**Assume storage operations can fail.** `window.storage.delete` may not take effect. Clear saved
state by **overwriting it with an invalid snapshot first**, then deleting (`clearDraft`). Never let
a failed delete resurrect finished state — see the storage-ordering note in Architecture above.

**Rerun the difficulty bot after any grading or board change.** `node tests/test-difficulty.mjs
[N]` plays N drafts with a simple first-eligible-player bot and reports avg wins / perfect-season
rate. Its bot is deliberately dumb (not a "fantasy-savvy" drafter), so don't read its numbers as an
absolute target — but a big swing in them after a change to `rating`, `SPREAD`, `QB_WEIGHT` (still
1.25, the extra weight QB carries in team score), or the opponent pool signals an unintended
balance shift, not a tuned one.

**Protect the daily.** The daily is a single seeded draft per day: no resets, its own saved
progress slot (`ps-daily-wip:<date>`), and it resumes rather than restarts. Any new navigation path
must not give a player a second crack at it. Unlimited drafts may be reset, but a reset counts as a
**DNF** against their stats.

**Stat columns follow one shape at every position:** main-role yards, TDs, per-attempt average,
volume, secondary role, fumbles.

**Data provenance matters.** Player stats come from nflverse play-by-play (1999-2025), corrected
against Pro Football Reference season totals for 1999-2020 (~1,100 seasons fixed, including the
badly broken 2001-02 Jaguars). Opponents come from real team-seasons rated by point differential.
Don't hand-edit `data.json`; change the scripts and regenerate.

## Immediate Next Goals

1. **Scoring modes** — standard and half-PPR alongside the current full PPR. Blocked: this needs
   re-deriving player ratings, which normally runs through `scripts/*.py` (the nflverse/PFR
   pipeline), and that pipeline doesn't exist in this checkout — don't start this without the
   real upstream source data.
2. **Housekeeping** — custom domain (currently a free `*.vercel.app` subdomain; add the URL to
   the share text once one exists), 2026 season data once it's played, an accessibility pass
   (position colors currently carry meaning on their own).

**Done:** the game is a real public product now, not a local-only demo. Accounts/stats/leaderboard
run on Supabase (Postgres + Auth, RLS-gated — see Architecture above) instead of `window.storage`,
and it's deployed on Vercel (`vercel.json` + `build.mjs`). "Hard mode" (an earlier version of this
list) shipped as **Genius mode** — same draft, player cards hide every stat cell. Also shipped:
**GM mode** (salary cap, derived from `p.rating` so era doesn't affect price — see
`playerSalary()`), **Over/Under** (renamed from "Stats O/U" - a daily leaderboard, not
open-ended practice: one seeded
sequence of rounds shared by everyone that day — `souRoundFor(seed, n)`, seed `sou-<date>` — three
lives, a real-wall-clock 7-second timer per guess (`SOU_ROUND_SECONDS`) to discourage looking
answers up, score = correct guesses before your third miss, posted to the `sou_runs` table via
`upsertSouRun`/`fetchSouTop`), **Build-a-player** (standalone
— no roster, no 6-slot draft: pick a position, roll a team then their active player from last
season, take one letter-graded attribute from him at a time via `BAP_ATTRS`/`scaleStat` until the
build is complete, then roll any real historical team-season from `OPPS` and sim whether your
build would have helped them win it — see `rollBapRound`/`playBapSim`), a **Player index**
(browse the full pool by team and era — `PlayerIndex`, its own nav tab, entirely client-side over
`BOARDS`), a live **online-players + total-drafts pill** in the home hero (`subscribeSiteActivity`
— one Realtime channel, Presence for the online count and a broadcast for the drafts count so
every open tab ticks up the instant anyone finishes a season), and a **Stats** screen (its own nav
tab — sitewide totals plus leaderboards for best lineups ever, most-drafted players, position
records, career wins/championships/playoff appearances, longest daily streak, best win percentage,
best GM-mode score, and Build-a-player's sitewide "created players" tally/highest-OVR build — one
consolidated `fetchStatsProfiles` fetch plus the separate `builds` table, see `computeSiteStats`
and `logBuild`). See `AdminPanel`, `SOU_STAT`, `BAP_ATTRS`, and `GM_CAP`/`playerSalary()` in the
source.
