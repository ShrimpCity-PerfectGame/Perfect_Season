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

# Build a runnable page for browser testing (entry.jsx mounts the app + a window.storage shim)
npx esbuild entry.jsx --bundle --format=iife --jsx=automatic \
  --outfile=build/page.js --define:process.env.NODE_ENV='"production"'
# then open page.html, which loads build/page.js

# Headless DOM tests (jsdom + react-dom/client, drive the real UI via tests/helpers.mjs)
node tests/test-accounts.mjs      # signup, login, stats persistence
node tests/test-daily.mjs         # seeded boards, daily lock, challenge codes
node tests/test-nav.mjs           # landing page, mode switching, draft resume
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

**Storage is a remote KV store, not local state.** `window.storage.{get,set,delete,list}(key,
shared)` is the only persistence primitive (an artifact-host API in this environment; `entry.jsx`
provides a localStorage-backed shim for standalone/browser use, `tests/helpers.mjs` provides an
in-memory one for tests). `shared=true` keys are sitewide (accounts `acct:`, stats `stats:`,
daily-leaderboard `daily:<date>:`); `shared=false` keys are per-device (session, draft-in-progress
snapshots). All reads/writes go through `sget`/`sset`/`sdel`/`clearDraft`, which swallow errors and
return null — **assume this API has no read-after-write ordering guarantee.** A read that starts
after a write can still resolve first. The `pendingClears` ref-counter in the main component (guards
`refreshWip()` against a stale read landing while `clearDraft()` is still in flight) is the pattern
to follow for any future bug in this class — don't try to fix it with `await` ordering, since the
race is between two independent async calls that don't share a promise chain.

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

1. **Stand up a server.** This is the blocker for going public. Right now accounts, stats, and the
   leaderboard live in `window.storage`, which means the game only runs inside its host and the
   leaderboard can be tampered with. Plan: a small backend (Supabase or Firebase) with real auth, a
   `runs` table, and server-side leaderboard queries; replace the `sget`/`sset` helpers with API
   calls. Game logic carries over unchanged.
2. **Player index** — browse the full pool by team and era, see which boards are loaded.
3. **Hall of fame** — highest-scoring lineups ever drafted, most-drafted players.
4. **Hard mode** — stats hidden; draft on name and year alone.
5. **Scoring modes** — standard and half-PPR alongside the current full PPR.
6. **Housekeeping** — final name and domain (add the URL to the share text), 2026 season data once
   it's played, an accessibility pass (position colors currently carry meaning on their own).

Also requested but not yet started: four new game modes (GM mode with a salary cap, Genius mode
with names only, a Stats Over/Under guessing mode, Build-a-player), a concurrent-online-players
counter, and a front-page graphic of aggregate drafts/players — all depend on goal 1 (a real
backend) to be more than a local-only demo.
