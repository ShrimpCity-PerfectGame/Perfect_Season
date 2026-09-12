# Perfect Season

An NFL roster-drafting game modeled on 20-0.com. Each round spins a random **team + five-year
era**; you draft one player from that board to fill **QB, RB, WR, TE, and two Flex**. Every player
shows his best real season for that team in that era, with full stats but **no fantasy points**.
Once six are picked, the roster is graded and plays a 17-game season against real NFL team-seasons,
then the playoffs. Win all 20 and you've gone perfect.

Everything currently lives in one self-contained React file: `perfect-season.jsx` (~350 KB, ~2,000
lines, with all player and opponent data inlined as JSON).

## Build/Run Commands

```bash
# Type/compile check (fastest feedback loop)
npx esbuild perfect-season.jsx --bundle --format=esm --platform=node \
  --jsx=automatic --outfile=build/app.js --external:react --external:react-dom

# Build a runnable page for browser testing (entry.jsx mounts the app + a window.storage shim)
npx esbuild entry.jsx --bundle --format=iife --jsx=automatic \
  --outfile=build/page.js --define:process.env.NODE_ENV='"production"'
# then open page.html, which loads build/page.js

# Headless DOM tests (jsdom + react-dom/client, drive the real UI)
node tests/test-accounts.mjs      # signup, login, stats persistence
node tests/test-daily.mjs         # seeded boards, daily lock, challenge codes
node tests/test-nav.mjs           # landing page, mode switching, draft resume
node tests/test-difficulty.mjs    # plays N drafts with a bot, reports avg wins / 20-0 rate

# Browser checks (Playwright, screenshots + motion checks)
python3 tests/shots.py

# Rebuild the game data from source (only when adding a season or changing grading)
cd scripts && python3 build.py && python3 correct.py && python3 rate2.py \
  && python3 boards.py && python3 export.py   # writes data.json
```

## Development Guidelines

**Verify in a running app, not by reading code.** Every feature so far was checked by driving the
real UI in jsdom or Playwright. Automated runs have caught bugs that looked fine on paper: a stale
draft snapshot resurfacing as "5 of 6 picked", a ball that teleported across the field, playoff
opponents that never got harder.

**Assume storage operations can fail.** `window.storage.delete` may not take effect. Clear saved
state by **overwriting it with an invalid snapshot first**, then deleting. Never let a failed
delete resurrect finished state. All reads go through `sget`/`sset`/`clearDraft` helpers that
swallow errors and return null.

**Keep the difficulty honest.** Tunables sit at the top of the file: `UPSET = 8`,
`QB_WEIGHT = 1.25`, and opponent strength derived from real point differential. After any change
to grading or boards, rerun the difficulty bot. Current target: a fantasy-savvy drafter averages
**~15 wins** with a **2-4% perfect-season rate**. Much above that and the game is too easy.

**Protect the daily.** The daily is a single seeded draft per day: no resets, its own saved
progress slot (`ps-daily-wip:<date>`), and it resumes rather than restarts. Any new navigation path
must not give a player a second crack at it. Unlimited drafts may be reset, but a reset counts as a
**DNF** against their stats.

**Seeded anything must stay reproducible.** Boards, re-spin alternates, and season luck all come
from `mulberry32(hashStr(seed))`. The season sim temporarily swaps `Math.random` (see `withSeed`).
Same seed plus same lineup must always produce the same result, or challenge codes break.

**Stat columns follow one shape at every position:** main-role yards, TDs, per-attempt average,
volume, secondary role, fumbles.

**Data provenance matters.** Player stats come from nflverse play-by-play (1999-2025), corrected
against Pro Football Reference season totals for 1999-2020 (~1,100 seasons fixed, including the
badly broken 2001-02 Jaguars). Opponents come from real team-seasons rated by point differential.
Don't hand-edit `data.json`; change the scripts and regenerate.

## Immediate Next Goals

1. **Stand up a server.** This is the blocker for going public. Right now accounts, stats, and the
   leaderboard live in the artifact's `window.storage`, which means the game only runs inside
   Claude and the leaderboard can be tampered with. Plan: a small backend (Supabase or Firebase)
   with real auth, a `runs` table, and server-side leaderboard queries; replace the `sget`/`sset`
   helpers with API calls. Game logic carries over unchanged.
2. **Player index** — browse the full pool by team and era, see which boards are loaded.
3. **Hall of fame** — highest-scoring lineups ever drafted, most-drafted players.
4. **Hard mode** — stats hidden; draft on name and year alone.
5. **Scoring modes** — standard and half-PPR alongside the current full PPR.
6. **Housekeeping** — final name and domain (add the URL to the share text), 2026 season data once
   it's played, an accessibility pass (position colors currently carry meaning on their own).
