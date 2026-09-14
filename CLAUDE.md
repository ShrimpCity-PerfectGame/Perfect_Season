# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Gridspin (formerly Perfect Season)

An NFL roster-drafting game modeled on 20-0.com. Each round spins a random **team + five-year
era**; you draft one player from that board to fill **QB, RB, WR, TE, and two Flex**. Every player
shows his best real season for that team in that era, with full stats but **no fantasy points**.
Once six are picked, the roster is graded and plays a 17-game season against real NFL team-seasons,
then the playoffs. Win all 20 and you've gone perfect.

**The brand is Gridspin** (from v1.9.0; tagline "Spin an era. Draft the greats. Go 20–0."). It was
renamed because the Patriots' owners hold a "Perfect Season" trademark and another football game
already uses the name. Only what players see says Gridspin: everything internal keeps
`perfect-season` - the repo, package, file names, Supabase projects, the `.ps` root class and the
`ps-*` storage keys. Never rename those (renaming a storage key throws away every player's saved
drafts). Descriptive uses of the phrase stay ("a perfect 20–0 season"), and so do stored outcome
strings like "Perfect season. 20–0.".

**Brand assets:** the mark (the re-spin ↻ arrow around a football) is `static/icon.svg`, drawn again
as `GridspinMark` in `perfect-season.jsx`; change both together. `node tools/brand/render.mjs`
rebuilds every PNG in `static/` from the SVG (favicon, home-screen icons, the 1200x630 `og.png` link
preview). `build.mjs` copies `static/` to the site root and fills the page's link-preview tags and the
share text's link: `SITE_URL` if set, else `https://gridspin.app` for production and Vercel's
`VERCEL_PROJECT_PRODUCTION_URL` (its vercel.app address) for staging. Tests and the UI harness build with
`APP_SITE_URL` = `https://gridspin.test`.

**Search engines (v1.9.1).** The site is one page, so all of this lives in `page.html` and `build.mjs`:
production's canonical address is `https://www.gridspin.app` (Vercel forwards the apex to www; people
still share gridspin.app), with a generated `robots.txt` and one-URL `sitemap.xml`, a search title
("Gridspin – Football Draft Game: Can You Go 20–0?"; home screens get the short name via
`apple-mobile-web-app-title`) and JSON-LD structured data. Staging builds add `noindex`, and
`vercel.json` sends `X-Robots-Tag: noindex` on every `*.vercel.app` host, so staging and the old
production addresses never compete with gridspin.app. Keep staging's robots.txt crawlable - a crawler
has to fetch a page to see its noindex. The bundle is minified. The owner holds Google Search Console
for the domain; `tests/test-build-seo.mjs` checks all of the above.

**Sharing (v1.10.0).** `shareText` builds a Wordle-style card and must never name the players (that
would spoil the daily): a title (`Gridspin Daily N`, numbered from `GRIDSPIN_DAY_ONE` = launch day
2026-09-14, or the Unlimited variant), the record, the 17 regular-season games as squares in rows of
six (🟩 win, 🟥 loss, 🟨 an upset win by `isUpsetWin`), the playoff squares, team score and rank, and
a link last. Unlimited, Genius and GM shares link to `/c/CODE?beat=W-L[&mode=gm|genius][&scoring=
championship]` (`challengeLink`); `vercel.json` rewrites `/c/:code` to the page (noindexed), which is
why `build.mjs` makes every asset path root-relative. The app reads the link with
`parseChallengeLink`, resets the address to `/`, and shows a challenge card on Modes; taking it runs
like entering a code (it abandons an Unlimited draft in progress as a DNF, and the card warns
signed-in players first). The `beat` record is the sharer's own claim, shown only as a headline.

The React component, all its screens, and every piece of game-specific display/UI logic live in
one file: `perfect-season.jsx` (~175 KB, ~3,000 lines — still large enough that targeted
`offset`/`limit` reads or grep beat a full-file read). Player and opponent data lives in
`data/players.json` (~225 KB); the pure scoring/simulation/roster-legality logic shared with the
`submit-run` Edge Function lives in `game-logic.mjs` — see that section under Architecture below
before touching either.

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
# never touch a real Supabase project or a real Deno runtime; window.__ps_supabase__ is a mock
# (see makeMockAuth in tests/helpers.mjs), installed the same way window.storage is - its
# functions.invoke("submit-run") mirrors supabase/functions/submit-run/index.ts against the same
# in-memory profiles/daily_runs, using the real game-logic.mjs, so a finished draft in any test
# exercises the real server-side verification logic, not a bypassed shortcut
node tests/test-accounts.mjs      # signup, login, stats persistence
node tests/test-daily.mjs         # seeded boards, daily lock, challenge codes
node tests/test-nav.mjs           # landing page, mode switching, draft resume
node tests/test-mode-switch.mjs   # switching Unlimited/Genius/GM mid-draft starts fresh, doesn't resume the wrong variant
node tests/test-wip-race.mjs      # end-of-draft storage race (see pendingClears below)
node tests/test-board-order.mjs   # board section reordering timing
node tests/test-reroll-pool.mjs   # reroll can't repeat an already-used team+era
node tests/test-flex-scoring.mjs  # Flex grades on raw production, not position
node tests/test-admin.mjs         # admin-account gating + force-board/player/outcome tools
node tests/test-scoring-format.mjs # fantasy vs standard grading: the fantasy path is byte-identical, standard math is pinned
node tests/test-difficulty.mjs [N] [fantasy|standard] [gm]  # plays N drafts with a bot, reports avg wins / 20-0 rate
node tests/test-replay-verification.mjs  # game-logic.mjs's replayDraft: legit traces (incl. rerolls) accepted, tampered ones rejected
node tests/test-tamper-resistance.mjs    # end-to-end: a fabricated submission never reaches profiles; a legit one still works
node tests/test-profile-queries.mjs      # site totals/own rank never pull every profile column
node tests/test-runs-sql.mjs             # runs log + Stats SQL in real Postgres (PGlite): backfill, RLS, and SQL == helpers.mjs mock

# Visual checks: tools/ui-harness runs the real app on the tests' in-memory Supabase mock
# (tests/mock-supabase.mjs) with seeded stress data - no staging writes, no sign-in - and
# tools/ui-harness/audit.mjs drives it in the installed Chrome (puppeteer-core) at phone sizes,
# screenshots it, and measures overflow, clipped text, small tap targets, tiny text, iOS input
# zoom and overlapping controls. Harness query params: as=player|admin|guest|newbie, howto=1.
node tools/ui-harness/build.mjs   # bundle the harness into build/ui-harness.js (never shipped)
node tools/ui-harness/audit.mjs --as player --width 375 --tab Leaderboard --out build/ui-audit
# For a change's final check, still click through the real staging site at desktop and mobile widths.
node tests/test-theme-contrast.mjs  # every text color in every theme scope is readable (WCAG AA) - see Design system
node tests/test-result-moments.mjs  # record-first result: per-season rank, upset/streak moments, black Leaderboard, Share
node tests/test-sou-leave.mjs       # Over/Under can't be replayed or left running: leaving/reloading mid-round is a miss
node tests/test-sim-engine-independence.mjs  # the season sim rolls identically in every JS engine; pins a 2,000-season checksum
node tests/test-build-seo.mjs      # runs build.mjs for production and staging: canonical, noindex, robots.txt, sitemap, structured data
node tests/test-share.mjs          # the spoiler-free share card, challenge links in and out, and the challenge card on Modes

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
`fetchLeaderboardTop`, `submitRun`, etc.) — never call `getClient()` directly from
`perfect-season.jsx`. Personal-key reads/writes still go through `sget`/`sset`/`sdel`/
`clearDraft`, which swallow errors and return null — **assume this half of the API has no
read-after-write ordering guarantee** (Supabase's Postgres-backed half doesn't have this problem).
A read that starts after a write can still resolve first. The `pendingClears` ref-counter in the
main component (guards `refreshWip()` against a stale read landing while `clearDraft()` is still
in flight) is the pattern to follow for any future bug in this class — don't try to fix it with
`await` ordering, since the race is between two independent async calls that don't share a promise
chain.

**Row Level Security, not app code, is the write gate — but for `profiles`/`daily_runs`, no client
policy exists at all.** `supabase/schema.sql` defines `profiles` and `daily_runs` with public
SELECT and RLS enabled, but zero UPDATE/INSERT policy for either — a signed-in client cannot write
either table directly, full stop. The `submit-run` Edge Function (`supabase/functions/submit-run`)
is the only writer: it takes a draft trace (`{mode, history, seq}`), independently re-derives the
seed (never trusts a client-supplied one — Daily's is `daily-<today>` from the function's own
clock; free/challenge-code mode's is `mode.code`), replays it with `game-logic.mjs`'s
`replayDraft` to confirm the roster was actually legally drafted, recomputes the score/season
outcome itself, and only then writes via its own service-role client. `finish()` still renders the
win/loss animation instantly from a local call to the same shared `simulateSeason` (so an honest
client sees identical numbers with no added latency) and submits the trace in the background via
`storage.js`'s `submitRun`/`submitDnf`; a rejected or failed submission keeps the local celebration
UI but skips the optimistic stats update and surfaces the existing `saveError` panel. **Known,
accepted gap**: Unlimited/challenge-code mode's seed is still client-chosen (`mode.code`), so
grinding many codes offline for a lucky *legitimate* outcome remains possible — closing that needs
server-issued/committed seeds, a bigger lift (network round-trip at draft start, rate-limiting),
not attempted here. `sou_runs` (Stats O/U) and `builds` (Build-a-player) remain fully
client-writable — lower-stakes minigames, not roster-scoring, a candidate for a later pass.

**The runs log is the complete history; `profiles.recent` is not.** `recent` keeps only an
account's last 10 runs. Every finished draft and DNF is also appended to the `runs` table
(`supabase/migration-runs-log.sql`) by `submit-run`, after the profile write and through
`game-logic.mjs`'s `runLogRow` — a failed log insert is logged, never fails the season. Anything
per-run on the Stats screen (most-drafted, GM scores, biggest upsets) must read `runs`, not
`recent`. Stats aggregates run in the database: `site_stats()`
and `site_totals()`, called via `storage.js`'s `fetchSiteStats`/`fetchSiteTotals`. The jsdom mock
in `tests/helpers.mjs` reimplements both, and `tests/test-runs-sql.mjs` runs the real SQL in PGlite
and fails if the mock and the SQL return different JSON — **change both together**, and keep every
`order by` fully tiebroken (the test is how the missing team tiebreak in most-drafted was found).
The Stats functions are defined only in `migration-runs-log.sql`; change them by editing that file
and re-running all of it in each environment (its backfill is a no-op the second time). The log
starts partway through the site's life: the migration backfilled each account's `recent`
plus best runs, and nothing older exists.

**Reads retry themselves; writes don't.** supabase-js (postgrest-js's `fetchWithRetry`) retries a
GET/HEAD that drops on the network up to 3 times (1s/2s/4s), but never a POST — and `.rpc()` POSTs by
default. Call read-only RPCs with `{ get: true }` (they must be `stable`/`immutable` in SQL);
`tests/test-profile-queries.mjs` checks this for `site_totals`/`site_stats`. **The in-app Browser
pane is not a reliable network signal:** it intermittently stalls a request ~5s on page load and fails
it with a CORS error. That never reproduced in real Chrome (30 fresh loads) or Node, so confirm a
network failure outside the pane (e.g. puppeteer-core against the installed Chrome) before treating it
as a site bug.

**The scoring/simulation/roster-legality logic is one shared module, not two.** `game-logic.mjs`
(imported by both `perfect-season.jsx` and `supabase/functions/submit-run`) holds every pure,
framework-free function this depends on — `effectiveRating`/`flexRating`, `seededSequence`/`fits`/
`boardHasOption`/`boardAt`, `rerollCandidate` (reroll's pool selection), `replayDraft` (full
legality replay), `simulateSeason`/`gameResult`/`buildTimeline`, `applyRun`/`applyDnf`/
`nextStreak` — plus `BOARDS`/`OPPS`, built from `data/players.json` (the former inline `DATA`/
`OPP_DATA` literals, extracted verbatim) via `initGameData()`, which every consumer calls once at
startup. This is deliberate: the client and the server must compute byte-identical results from
the same seed+roster, and two independently-maintained copies of this logic would eventually
drift. If you touch scoring, grading, board sequencing, or reroll logic, change it here — never
duplicate it back into `perfect-season.jsx` or the Edge Function.

**Two scoring formats, one pipeline.** A draft is played in either `"fantasy"` (full PPR, the
original and the default) or `"standard"` (no point per reception — the UI calls it **Championship
mode**; the internal name avoids colliding with `run.champ`/`profiles.champs`, which mean *won the
title*). The format is a per-device preference that layers over Daily/Unlimited/Genius/GM rather
than a mode of its own, it rides on `mode.format`, and **absence always normalizes to fantasy**
(`normFormat`), so everything written before this existed reads back correctly with no backfill.
`SCORING.md` is authoritative for the math; the short version is that only Step 1 differs, standard
points are exactly `ppr - rec`, and each position/era is re-anchored so both formats share one
0–130 scale. Ratings for both are precomputed per player in `initGameData` (`rating`/`stdRating`),
so consumers do a field lookup instead of recomputing. Things worth knowing before touching this:

- **Fantasy ratings must keep coming from the stored `e[17]`, never recomputed** — the formula
  reproduces them only to ~0.03, which is irrelevant for standard (no stored value to match) but
  would shift every score already on the leaderboard.
- **`efficiencyAdj` must stay a recomputation**, not an inversion of the stored rating. Inverting
  looks equivalent but silently understates it by up to 12 points on the 40 seasons clamped at
  `RATING_CAP` — exactly the all-timers that decide a top score. `test-scoring-format.mjs` pins this.
- **Scores from the two formats never rank against each other.** They live in separate `profiles`
  columns (`best_score`/`best_score_std`, see `BEST_FIELDS`) and separate leaderboards; career
  counters (runs/wins/champs/streak) are deliberately merged, since both run the identical sim.
- **Each format has its own daily**, seeded `daily-<date>` and `daily-<date>-std` so playing one
  doesn't spoil the other's boards; `daily_runs`' primary key is `(date, format, user_id)`.
  Free-mode seeds are unchanged — an existing challenge code still deals the boards it always did.
- The format is part of the free-draft variant in `openFree`'s `sameVariant` guard, for the same
  reason genius/gm are: resuming a draft under the other format's rules would grade it wrongly.

**Everything seeded runs through `mulberry32(hashStr(seed))`.** Board sequences
(`seededSequence`), reroll picks, and the season simulation (`simulateSeason`, wrapped by
`withSeed` which temporarily swaps global `Math.random`) all derive from `mode.seed` (`daily-<date>`
for the daily, a random `code` for Unlimited/challenge links) plus the exact roster drafted. Same
seed + same lineup always produces the same result — this is what makes challenge codes and daily
results reproducible/shareable, so don't add unseeded randomness to any of that path.

**The number of random draws must not depend on the JavaScript engine either.** The client and the
server run different engines (the player's browser vs. Deno's V8), and they must consume the seeded
stream call for call. Never order anything in this path with `sort(() => Math.random() - 0.5)` or any
other inconsistent comparator: how many times an engine calls it is up to the engine. That exact
shuffle in `buildTimeline` broke in production. Chrome 152's V8 calls it fewer times than the server's,
so Chrome players saw different playoff results from the ones saved (v1.8.1). `smallTimSort`
reproduces the server's calls exactly. `tests/test-sim-engine-independence.mjs` pins a checksum of
2,000 seasons. If a change moves it, every challenge code plays out differently, and the client and
the Edge Function must ship together.

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

## Design system

The look is "playful sports app + premium streetwear": a cream foundation, ink type, electric lime
used sparingly, the Anton display face with Inter for body copy, tactile buttons with a hard offset
shadow, and navy "scoreboard" moments.

- **Tokens live in `theme.mjs`**, as data with two scopes, and `perfect-season.jsx` turns them into
  CSS variables. Don't hardcode colors in the stylesheet; add a token to both scopes (a test fails
  if the scopes' token sets differ).
- **Lime is a fill, never text on cream.** `--accent` is lime and only goes behind `--on-accent`
  text. For accent-colored words, links or underlines use `--accent-ink`: game blue on cream, lime
  only in the dark scope. Lime on cream is ~1.2:1. `tests/test-theme-contrast.mjs` enforces WCAG AA
  for every text token in both scopes.
- **Where the dark scope applies:** the whole play screen (the root gets `.dark` when
  `view === "play"`), plus components that are stadium-dark wherever they appear — `.reel`,
  `.sticky`, `.result-hero`, `.champion`, `.pg`, `.pre`, `.cel`, and the Unlimited tile. The
  Leaderboard is the exception: the root gets `.night` when `view === "board"`, a true-black third
  scope (its `.champion` takes night tokens too) with lime reserved for #1 and your own row. Everything
  else is cream. Every scope in `theme.mjs` must define the same tokens; the contrast test checks all.
- **Vary the treatment instead of making every block the same card:** one featured lime block (the
  daily), a navy card (Unlimited), orange for a special moment (Over/Under), and plain typography
  with a ruled top edge for stats (`.tile`).
- **Copy:** author labels in sentence case in the JSX and uppercase them with CSS, so screen readers
  and tests see normal text. Playful wording goes on big moments only ("Start my season 🏈",
  "🔒 Lock in", "Run it back 🔁"); everyday controls like Refresh, Log in, Cancel and Reset stay
  plain. Tests open modes with `clickMode(container, name)` rather than clicking tile copy, because
  that copy is meant to change.
- **Emoji vocabulary**, used deliberately rather than sprinkled: 🏆 championship/achievement ·
  🔥 streak · ⚡ high-impact · 😈 risky · 💀 disaster · 👑 #1 · 🚨 upset · 🏈 football · 📈 rising ·
  🧊 cold. Add emoji at display time only — outcome strings from `simulateSeason` are stored in runs
  and `daily_runs` and must not change. The result screen does this in separate elements
  (`outcomeEmoji` into the `.oe` span, CSS `::after` on upset tiles) so `.outcome` and `.rec` keep
  their exact text. An upset is a win with a 35% chance or less (`UPSET_CHANCE`), computed from the
  opponent's rating at display time by `gameWinChance` — never by changing the simulation.
- **Motion:** hover lift and press on buttons and tiles. Every new transform or animation goes in
  the `prefers-reduced-motion` block at the bottom of the stylesheet. Hover rules go inside
  `@media (hover:hover)` - on touch screens `:hover` sticks after a tap.
- **Mobile rules (from the 1.8.0 phone audit - keep them):**
  - The button reset is `:where(.ps) button`, element specificity. As `.ps button` it silently beat
    `.fmtbtn`, `.linkbtn` and `.tab` for three releases.
  - Touch targets live in `@media (pointer:coarse)`: real controls get `min-height:44px` and
    `position:relative;z-index:1`; text links, pills and mode pills keep their look and get an
    invisible `::after` hit area. The z-index is what stops a hit area stealing taps from a
    neighbouring control ("Skip to the end" under "Kick off", "How to play" over the tabs).
  - Inputs are 16px (iOS zooms anything smaller). Tabular digits are applied only to the numeric
    selectors listed at the top of the stylesheet - on the whole page they widen hyphens in names.
  - **Base rules must come before the responsive `@media` blocks that override them.** A base
    `.roster` rule added below the phone query forced six columns on phones.
  - Screens change on one page, so one effect scrolls to the top when `view`, `mode.seed` or the
    Build-a-player step changes; `html:has(.result-hero)` turns off scroll anchoring so a season
    ticking in doesn't drag the view down. Leaving Over/Under or Build-a-player by any route is
    cleaned up in a `view` effect, not in individual click handlers.
  - Check changes with `tools/ui-harness` at 320, 375, 430, 768 and 667x375 before shipping.

## Releasing

**Nothing reaches production without going through staging first, getting a changelog entry, and
shipping as a version.** This is a hard rule, not a preference — it applies to one-line fixes too.
It exists because the Championship-scoring launch went straight to production with a green test
suite and still broke the live Leaderboard for every existing account.

- **`master` is production. `staging` is the test site.** Work lands on `staging`, gets verified on
  the staging URL, and only then merges to `master`. Never push a feature branch straight to
  `master`.
- **Staging is fully isolated**: its own Supabase project (separate database, auth, and Edge
  Functions) and its own Vercel deployment, built with `APP_ENV=staging`, which makes the app show
  a "Test site" banner. Nothing done on staging can touch real accounts, scores, or leaderboards.
- **Most releases are just a merge.** The client redeploys itself from the branch. Only two things
  need a per-environment step, and only when they actually changed:
  - `supabase/functions/submit-run` or `game-logic.mjs` → `npm run deploy:fn:staging`, then
    `npm run deploy:fn:prod` after promoting (needs `STAGING_PROJECT_REF` / `PROD_PROJECT_REF`).
  - A schema change → run its migration in that environment's SQL editor first.

  Order is always migration → Edge Function → client. Reversing it corrupts data; see the
  deploy-ordering note in `supabase/migration-scoring-formats.sql` for the specific mechanism.
- **Supabase project settings are NOT in this repo**, so the two environments can drift in ways
  `schema.sql` won't catch. This has already bitten once: staging shipped with email confirmation
  on while production has it off, so signup worked in production and silently failed on staging
  with a generic "couldn't be created". If something works in one environment and not the other and
  the schema matches, compare the project config
  (`GET /v1/projects/<ref>/config/auth` via the Management API) before digging into app code.
- **Version + changelog**: bump `version` in `package.json` (minor for features, patch for fixes),
  add a `CHANGELOG.md` entry under that version, and tag the release (`git tag v1.2.0`). The
  version is baked into the bundle by `build.mjs` and shown in the app's header, so you can always
  tell which build a site is running.
- **Automated tests are necessary but not sufficient.** The full suite passed on the release that
  broke. Click through the actual changed screens on staging before promoting — this replaces
  clicking through production, it isn't extra work on top of it. After promoting, confirm the
  version in the header matches the release.
- **The live site is gridspin.app** (since v1.9.0, 2026-09-14). The domain was bought through Vercel
  (.gg was $130/yr), which runs its DNS and HTTPS (.app is HTTPS-only). In the production Vercel
  project, `gridspin.app` currently forwards to `www.gridspin.app`, which serves the site; that is
  cosmetic and the owner left it. The project's original addresses, `perfect-season-t9sk.vercel.app`
  and `perfect-season-beta.vercel.app`, still serve the same deployment and are deliberately not
  redirected (nobody used them) - don't add redirects unless asked. `build.mjs` bakes
  `https://gridspin.app` into production's link previews and share link, so none of that affects
  them. Staging stays `perfect-season-staging.vercel.app`; the domain never goes on it.

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
balance shift, not a tuned one. It takes a format and a GM flag (`… 250 standard gm`) — a grading
change means running each format, since they have separate benchmarks.

**Protect the daily.** The daily is a single seeded draft per day **per scoring format**: no resets,
its own saved progress slot (`ps-daily-wip:<date>`, suffixed `:std` for Championship), and it
resumes rather than restarts. Any new navigation path
must not give a player a second crack at it. Unlimited drafts may be reset, but a reset counts as a
**DNF** against their stats. **A draft counts from the moment its first board is dealt, picks or
not:** leaving and coming back (or reloading) resumes it with its re-spins as they were, and Reset,
switching Unlimited/Genius/GM or scoring format, or entering a code abandons it as a DNF. Before
1.8.1 a no-pick draft didn't count, which made looking at the first board and leaving a free redo.

**Stat columns follow one shape at every position:** main-role yards, TDs, per-attempt average,
volume, secondary role, fumbles.

**Data provenance matters.** Player stats come from nflverse play-by-play (1999-2025), corrected
against Pro Football Reference season totals for 1999-2020 (~1,100 seasons fixed, including the
badly broken 2001-02 Jaguars). Opponents come from real team-seasons rated by point differential.
Don't hand-edit `data.json`; change the scripts and regenerate.

## Immediate Next Goals

1. **Housekeeping** — custom domain (currently a free `*.vercel.app` subdomain; add the URL to
   the share text once one exists), 2026 season data once it's played, an accessibility pass
   (position colors currently carry meaning on their own).
2. **Half-PPR**, if wanted, is now a small change rather than a blocked one — see the scoring-format
   note in Architecture. It needs a third `FORMATS` entry, a benchmark column, a `BEST_FIELDS`
   entry, and two `profiles` columns; no data regeneration.

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
tab — sitewide totals plus leaderboards for best lineups ever, most-drafted players, biggest
upsets (lowest team score to win the title, per format — it replaced position records, which
maxed out and stopped changing), career wins/championships/playoff appearances, longest daily streak, best win percentage,
best GM-mode score, and Build-a-player's sitewide "created players" tally/highest-OVR build — one
`fetchSiteStats` call, computed in the database by `site_stats()` — see the runs-log note under
Architecture — plus the separate `builds` table and `logBuild`). See `AdminPanel`, `SOU_STAT`, `BAP_ATTRS`, and `GM_CAP`/`playerSalary()` in the
source.
