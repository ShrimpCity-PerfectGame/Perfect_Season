# Changelog

Every release that reaches the live site is recorded here. Newest first.

Versions follow [semantic versioning](https://semver.org): the **minor** number goes up for new
features, the **patch** number for fixes. Each release is tagged in git (`v1.1.1`) and the version
in `package.json` is the source of truth for what is deployed.

Releases go to the staging site and are verified there before production — see "Releasing" in
CLAUDE.md.

## [Unreleased]
## [2.14.0] — 2026-09-28

Guess the Player asks about the season you are watching. The pool goes from 4,637 players to **193** — everyone
playing a skill position right now, plus the 25 greats — and the game from eight guesses to **five**.

**Deploy order: re-run `migration-guess.sql`, then the Edge Functions, then the client.** The migration drops
and re-adds the `tries` bound (8 → 5) and **fails on a row recorded under the old rules**; delete those first if
a database has any (`delete from public.guess_runs where tries > 5;` — only staging ever did). `submit-guess`
bundles `data/guess-pool.json` and `guess-logic.mjs`, and both changed. `GUESS.md` 1 is the reference.

### Changed

- **The pool is the men on the field.** Quarterbacks, running backs, receivers and tight ends with **100+ snaps
  in the season being played** — about 170 in September and growing every week — plus the **25** best retired
  players at those positions, ranked *within* position so quarterbacks cannot take every place: Brady, Rice,
  Peyton Manning, Barry Sanders, Emmitt Smith, Moss, Gronkowski, Tony Gonzalez.
  - **What it costs, and it is not small:** no defence, no offensive line, and of the retired only the very top.
    It is a quiz about this season rather than about all of football, chosen deliberately to make it winnable.
  - **It goes stale.** Rebuild `data/guess-pool.json` weekly while football is on. The client and the Edge
    Function both carry a copy, so they ship together — every time.
  - This is the pool's third shape. v2.13.0 kept every drafted player with a five-season career (4,637), which
    asked about men who never played while refusing to ask about anyone who arrived after 2022. A Guessability
    Score over six weighted terms then took a share of each position group (773) — better, and still asking
    about the hundredth-best corner of the century. CHANGELOG entries for both remain below; GUESS.md 1 has the
    full reasoning and what each version cost.
- **Five guesses, not eight.** Eight at a field of 193 falls to elimination most days. The two knobs move
  together, and the honest measure is printed by the tests: a bot guessing blind now wins **2.75%** of games,
  against 0.20% at eight guesses and 4,637 players.
- **The daily's weighting is gone**, deliberately. Every player takes one turn, so nobody comes round until
  everybody has been asked — 193 days now, longer every week. Giving the best-known quarter three turns was
  right for 731 players (a 1,353-day cycle still left 451 days between a man's turns) and wrong for 193, where
  it brings him back inside four months.

### Added

- **The end screen says how hard the day was** — "Difficulty 29/100", plus whether it was one most people get, a
  fair test or a deep cut. Shown only once the game is over; before that it would narrow the answer.
- Undrafted players are in on their own terms: the team they came into the league with (from the rosters) and
  their first season as their class. No hand-written list — every man in this pool is one the rosters have.

### Fixed

- **Ezekiel Elliott was not in the game at all**, and neither were thousands of others. The player index leaves
  `jersey_number` blank for a great many people, and the eligibility line threw the row away *before* anything
  could look the number up. The builder now falls back to the season rosters and keeps the number each man
  appeared under most.
- **Every player's name was cut off on a phone** — "Tyler C...", "Davant...", "Penei ...". The grid is a fixed
  table layout with no column widths, so all six columns took a sixth of the screen and the name, the one thing
  on the row you have to read, got 55 pixels. The five state columns now take 13.6% each and the name takes what
  is left; a long one wraps to a second line rather than being cut, because an ellipsis hides the half that
  identifies him. The division reads "NFC N" rather than "N-North" for the same reason — it was wrapping the
  cells onto two lines — while a screen reader still hears "NFC North". Checked at 320, 375 and 390 pixels in a
  real browser, which is now a test.
- **88 players wore a jersey number they never wore.** nflverse writes `0` for a number it does not have, and 0
  only became a legal NFL number in 2023 — so Aqib Talib was in the game as `#0` rather than 21, Blair Walsh as
  `#0` rather than 3. A `#0` on a career that ended before 2023 is now read as the missing value it is.
- **A winning row drew its five cells stacked in one column.** The cell's state class was called `hit`, which is
  also the draft card's clickable area (`all:unset; display:block`), so a row where every cell turns green at
  once stopped being a row. The states are now prefixed `gp-c-`. Nothing could have caught it — jsdom has no
  layout and axe measures colour, which was right — so it took opening the game on staging; the check that
  guards it now is geometric, in a real browser, on that one row.
- **The grid's green cells were white text on the game's light green**, about 1.8:1. Both coloured states now
  take the same dark ink. Found by the new accessibility entry on its first run, before the game shipped.

## [2.13.0] — 2026-09-28

**Guess the Player** — a daily Wordle-shaped game. One real player a day, eight guesses, and five columns that
say how close each guess was.

**Deploy order: `migration-century.sql`, then `migration-guess.sql` (new), then `migration-runs-log.sql`,
`migration-profiles.sql`, `migration-moderation.sql` and `migration-wallet.sql`, then the Edge Functions, then
the client.** Guess goes before three files that name its table and all of their bodies are plpgsql, so the
wrong order fails nothing until a guest trades up. `tests/test-migrations.mjs` holds the order.

`GUESS.md` is the reference for all of it.

### Added

- **Guess the Player**, behind the Mini games tile. Guess a player; every guess draws a row comparing **team,
  division, position, draft class and jersey number** with the answer. Green is exact, grey is no, and yellow
  means something different in each column — the same conference, the same side of the ball, a draft class
  within two years, a number within five. Draft class and number also carry an **arrow**, because knowing the
  answer is later than 2015 is worth far more than knowing it is not 2015.
  - **Daily** (one game, the same player for everyone, an account needed) and **Practice** (a code, as often as
    you like, off the daily board).
  - The name is not one of the five columns — it is the guess.
- **`data/guess-pool.json`** (4,637 players, 195 KB), built by `tools/data/build-guess-pool.mjs` from nflverse's
  player index. It is a **third** data file because this game asks about the whole roster, not the four
  positions a fantasy score uses: DB 885 · OL 829 · DL 748 · LB 650 · WR 495 · RB 402 · TE 295 · QB 232 ·
  SPEC 101. Careers of five seasons or more, 1999 on, drafted players only — which costs Warren Moon, Antonio
  Gates, James Harrison, London Fletcher and Jon Kitna, and is the price of having a draft-class column at all.
- **`guess_runs`** and two boards (`guess_top`, `guess_best`) in `supabase/migration-guess.sql`. RLS on, public
  select, **no client write policy at all** — the second board in the game nobody can write, for the reason
  `century_runs` is the first: a game here leaves a list of player ids, which a server can replay.
- **`submit-guess`**, the only writer. It takes the guesses, not the result: the answer follows from the date, so
  it recomputes it, checks every guess against the pool and derives whether the game was solved and in how many
  itself. The daily's date is the function's own clock. The answer goes back **only once the row is written**.
- **The pool is fetched when the game opens, not shipped in the bundle** (`guess-pool.mjs`, served from
  `/data/guess-pool.json`). 195 KB — 61 KB compressed, a sixth of the bundle — for one mini-game is exactly what
  `tests/test-build-seo.mjs`'s ceiling is there to catch, and that comment names lazy loading as the honest fix
  rather than a higher ceiling. The service worker treats the file like the bundle, network first, because a
  stale pool is a different daily answer from the one `submit-guess` checks against. The screen has a loading
  state and a real retry; with no pool there is no game to show.
- **Three accessibility entries** for it in `tests/test-a11y.mjs` — the menu, the grid part-played and the end
  screen — and a `?screen=guess[&guesses=N][&finish=1]` preview in the UI harness to reach them.

### Fixed

- **The grid's green cells were white text on the game's light green, about 1.8:1.** Both coloured states now
  take the same dark ink. Found by the new accessibility entry on its first run, before the game shipped.
- **A winning row drew its five cells stacked in one column.** The cell's state class was called `hit`, which is
  also the draft card's clickable area (`all:unset; display:block`), so a row where every cell turns green at
  once stopped being a row. The states are now prefixed `gp-c-`. Nothing could have caught it — jsdom has no
  layout and axe measures colour, which was right — so it took opening the game on staging; the check that
  guards it now is geometric, in a real browser, on that one row.

### Notes

- **The 17 hand-picked clashes.** Two different players can share all five compared columns — same team, draft
  class, position and number — and a game whose answer is one of those can go all green without being solved.
  The builder keeps one of each pair **by hand, with a reason**, and fails the build on a clash it has not been
  told about. The rule that was there first (keep the longer career) got three backwards, Maxx Crosby among
  them: equal eight-season careers fell through to alphabetical.
- **Not built**: no share card (the colours alone would give away the division and the side of the ball), nothing
  on the profile, no badge, no streak. GUESS.md 9 says so rather than leaving them half-done.
- Accepted gap, the same one every seeded mode has: the answer is derivable from the date and the pool, both of
  which ship in the bundle. What is closed is the in-app rehearsal, and the board is honest either way.

## [2.12.0] — 2026-09-28

A badge for Century, and the migration reordering it forced. **Shipped together with 2.13.0** — it was finished
and green but had not reached staging when Guess the Player landed, so the two travel as one deploy and the
migration list below is carried by 2.13.0's.

**Deploy order: run `migration-century.sql` FIRST, then `migration-runs-log.sql`, `migration-profiles.sql`,
`migration-moderation.sql` and `migration-wallet.sql`, then the Edge Functions, then the client.** Century moves
to the FRONT of the runbook — see below.

### Added

- **Century** 💯, gold, 1,000 coins — **reach 100 in the daily Century**. The daily, not any Century: Unlimited
  is unlimited, and at roughly one run in twenty played perfectly a hundred is an evening of retries there,
  while the daily gives one go at one set of seven teams. That is what makes it worth gold, and
  `tests/test-badges.mjs` asserts a big Unlimited run does **not** earn it.
  - Unlike the other two minigame badges (Stat Nerd, Mad Scientist, which pay nothing because those games are
    browser-written), this one **pays** — a Century run is verified, so there is no version of it a browser can
    simply assert.
  - **`submit-century` awards it itself**, rather than leaving it to submit-run's next finished season. Somebody
    who plays Century and nothing else may never finish one. The function witnessed the run, so it records it;
    `award_badges` is idempotent per (user, badge) and `badge_rewards` decides the amount, so it can neither pay
    twice nor pay the wrong number. A failed award never fails the run.
- `player_stats()` gains a **`century`** block — `played`, `best`, `daily_best`, `centuries`. `daily_best` is
  separate on purpose: it is the only number that can tell the daily's hundred from a ground-out one.

### Changed

- **`migration-century.sql` now runs FIRST, before `migration-runs-log.sql`.** `player_stats` reads
  `century_runs` and is `language sql`, whose body is validated the moment it is created — so runs-log fails
  outright without the table. Century's own trigger moves to `migration-profiles.sql`, beside the identical ones
  on `sou_runs` and `builds`, which is what lets it depend on nothing and come first.

  Worth keeping: everything else that reads `century_runs` (`claim_minigame`, `claim_username`, `mod_act`) is
  plpgsql and so is **not** validated at creation — those orderings fail nothing until somebody calls them.
  `language sql` is the one that fails loudly, and it is the reason this moved at all.
  `tests/test-migrations.mjs` runs the whole list on a bare database and holds the order.
- `badges.mjs` keeps its own `CENTURY_BADGE_SCORE` rather than importing `CENTURY_GOAL`: that file is pure by
  rule, so it loads on its own anywhere, and `tests/test-badges.mjs` already enforces that. A test holds the two
  numbers equal instead — the same arrangement the SQL copies of `rewards.mjs` live under.

## [2.11.1] — 2026-09-28

One bug, found by opening a shared link on staging rather than by running the tests.

### Fixed

- **Taking a Century link dealt the run you already had, not the one you were sent.** The screen reads its
  saved snapshot asynchronously on mount; taking a link starts a run synchronously. So the read began before
  the link was taken and landed after it, restoring a stale snapshot over the seven teams the player had just
  been handed. The tell was that the SAVED snapshot was right and the SCREEN was wrong — which is why nothing
  caught it: a test that checks storage sees the correct answer.

  This is the race CLAUDE.md names under "Assume storage operations can fail": two independent async calls that
  share no promise chain, where only a ref carried across the gap can settle it, the way `pendingClears` does
  for the draft. The resume now stands down if a run has been started while it was in flight.

  `tests/test-century-screen.mjs` 15 reproduces it — a stale snapshot left in place **on purpose** and a
  deliberately slow read, so the resume is guaranteed to land late. The test that missed it (14) called
  `dropWip()` first, so no snapshot existed and the race never ran.

## [2.11.0] — 2026-09-28

Century can be shared, and the seven teams you were dealt can be handed to somebody else. Plus the polish pass
that went with it. Client only — no migration, no Edge Function change.

### Added

- **A share card for Century**, in the house style and under the house rule: it names **no player and no team**.
  That rule matters more here than anywhere — the daily's seven teams are the same for everyone that day, so a
  card hinting at one would spoil it for every reader. Everything on the card is derived from the score, which
  the card states in words anyway, so the squares add nothing a reader could not already see.

  ```
  Gridspin Century 15 · 83/100
  🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜
  Best possible from my seven teams: 102
  https://gridspin.app
  ```

  `tests/test-share.mjs` holds the card against the **real pool** — not one of the 435 players and not one of
  the 32 teams may appear in it.
- **An Unlimited card carries a playable link.** Century's seed *is* a code, so `/c/<seed>?mode=century&score=N`
  deals a friend the same seven teams in the same order, and the Modes challenge card offers it as "Play these
  teams". It reuses the `/c/:code` route `vercel.json` already serves, so there is no new address.
  - Taking one **costs no season draft**: no DNF, no format change, because none of that is involved. The card
    says so by not warning about it.
  - **The daily never gets a link.** Its seed is `century-<date>`, and a link carrying that hands over the day's
    seven teams — the whole reason `centuryReservedSeed` exists. The daily card gets the site link and nothing
    else, and a test asserts the seed appears nowhere in it.
- **`tests/test-a11y.mjs` refuses a dangling ARIA reference on every screen** — `aria-controls`,
  `aria-labelledby`, `aria-describedby` and `aria-activedescendant` must all name an id that exists. axe does not
  reliably report these and the failure is silent by nature. Century's board tabs were the only one in the app.

### Fixed

- **Today's Century was unreachable once you had played it.** The Mini games tile said "See today's result" and
  the screen answered with a disabled tile saying "Played" — so the run you had just finished could not be
  looked at again. The tile is live now and reopens that run from the stored roster; looking records nothing.
- **"Sign in to play" was written on a button that refused the tap.** Both Century tiles were disabled for a
  signed-out visitor, and the daily for a guest — a control that tells you what to do and then does nothing
  reads as broken, which is the note CLAUDE.md already keeps about the Duel tile. They stay live and take you to
  the Account tab with a sentence saying why.
- **A dangling `aria-controls` on Century's board tabs.** Only the open panel was rendered, so the closed tab
  pointed at an id that was not in the document. Both render now, the closed one `hidden`.
- A challenge link with an empty `score=` claimed "They got 0" — `Number("")` is 0, which is finite and in
  range. It wants digits now.

### Notes

- `GRIDSPIN_DAY_ONE` and `dailyNumber` move to `ui-common.jsx` so a screen file can number its own daily without
  importing the main component back; `perfect-season.jsx` re-exports both, where everything has always looked.
- Two contrast items an earlier sweep had deferred were examined and **left as they are**, with the reasoning
  written at both rules so they are not re-raised: `.fifty` (2.11:1) is the "50" painted on turf inside an
  `aria-hidden` field graphic — incidental text in a picture, which WCAG 1.4.3 exempts, and raising it makes it
  compete with the ball; `.vs-tk.spent` (3.55:1) is an aria-hidden icon with a visually-hidden text label and a
  line-through, so it answers to the 3:1 non-text rule rather than 4.5:1.
- Century was swept at 320, 375, 430, 768 and 667×375: no overflow, no clipped text, no tap target under 44px.

## [2.10.0] — 2026-09-28

Modes has a shape. Client only — no migration, no Edge Function change.

### Changed

- **Modes is drafts, and a Mini games screen behind one tile.** It had grown to nine tiles and read as a list
  rather than a shape. The drafts are the game and stay on the front screen under a **Drafts** heading — the
  daily, Unlimited, Genius, GM, Duel and the challenge-code box. **Over/Under, Build-a-player and Century** move
  to a Mini games screen of its own, opened from one tile, the way the Shop and Duel already open.
  - The tile carries an **"N done today"** pill, because the one real cost of moving them off the front screen
    was losing at a glance whether the day's Over/Under and Century were still to play.
  - Duel stays with the drafts: it *is* a draft, two people off the same eight boards.
  - Leaving any of the three now returns to Mini games rather than to Modes, since that is the only place they
    can be opened from.
- **Mini games joins the tile colour system** rather than sitting plain cream next to six coloured tiles
  (`--mode: var(--win)`, the one colour token nothing else had claimed). Tint, never paint, like the rest.
- `tests/helpers.mjs`'s **`clickMode` learned the route**: a tile that is not on Modes is looked for behind Mini
  games. Every existing caller kept working, and a test that means "open Over/Under" still says that rather than
  knowing where it now lives. The four files that clicked tile copy directly were converted to use it, which
  CLAUDE.md already asked for.

### Added

- `tests/test-a11y.mjs` audits the Mini games screen, and reaches the three modes behind it by the same route a
  player takes.

## [2.9.1] — 2026-09-28

Century, made to look like the rest of the game. Client only — no migration, no Edge Function change.

### Changed

- **The Century screens are now the draft's own.** A run had been built out of its own markup, and next to
  Unlimited or Genius it read as a different app bolted on. It now uses the app's `.reel` (the board spins in,
  with the team colour, the pick counter and the player count), the `.roster`/`.slot` tiles with their position
  colours, the `.sec`/`.card` board with position pills and a **Lock in** row, and the `.result-hero` with the
  same giant record type a finished season lands on. The menu deals the same `.mode` tiles the Modes screen
  does: the featured lime block for the daily, the navy one for Unlimited.
  The stat cells are just left off, which is exactly what Genius mode does to the same markup — so "a draft with
  the numbers hidden" already had a shape here and Century takes it instead of inventing a second one.
- **A run in progress is stadium-dark**, on the ROOT the way every other draft is, and so is its result. The
  first attempt scoped only the container, which put dark-scope text on a cream page and left the position
  headings nearly invisible.
- **A second door onto a pick.** The roster tile is now clickable to place the player you have selected, as the
  draft screen's is — and it asks `centuryBlock`, the same function the Lock in button asks.
  `tests/test-century-screen.mjs` holds both doors to it, because the draft's equivalent tile enforced no rule
  at all for three releases.
- Century adds no touch-target or reduced-motion rules of its own any more: every control on these screens is
  one of the app's, and those already carry them. A copy would be a second, quietly diverging set.

### Fixed

- The result screen was about 400px of empty space: `.rec` is ~96px type and every line in the hero is a `<p>`,
  so the browser's default 1em margin was a 96px gap above and below the number.
- `reducedMotion` had been a private copy in `perfect-season.jsx`; it moves to `ui-common.jsx` so the reel and
  the draft's spin read the same check — the one `tests/helpers.mjs` forces on so boards resolve instantly.

### Added

- `tests/test-a11y.mjs` now audits the Century **result** screen as well as the menu and the board; the harness
  gained `?screen=century&finish=1` to reach it, since nothing else opens it without playing seven picks.

## [2.9.0] — 2026-09-28

**Century** — a new mode, with a daily and an Unlimited. Seven slots, hidden stats, and 100 combined
touchdowns from one real season. `CENTURY.md` is the reference.

**Deploy order: run `migration-century.sql`, then re-run `migration-wallet.sql`, `migration-profiles.sql` and
`migration-moderation.sql`, then deploy the Edge Functions (`node deploy-function.mjs <env>` — there are three
now), then the client.** Century's migration has to go before the other three: it creates a trigger using
`use_account_username` (profiles), while `claim_minigame` (wallet) reads its table and both `mod_act`
(moderation) and `claim_username` (profiles) rewrite its name snapshots. Those bodies are plpgsql and are not
validated when created, so the wrong order fails nothing until a guest trades up.
`tests/test-migrations.mjs` runs the whole list on a bare database and holds the order.

### Added

- **Century.** You get a QB, two RB, two WR, a TE and a Flex. Every spin deals a random team and you fill one
  slot from it — **with no stats shown** — until all seven are full. One team re-spin. The goal is 100
  combined passing, rushing and receiving touchdowns from the 2025 regular season, and the end screen shows
  what you got, whether you reached it, and what the seven teams you were dealt were worth at best.
  - **Daily**: the same seven teams for everyone that day, one go, its own board. Not for guests, for the
    reason the season's daily is not: a guest account costs nothing to make.
  - **Unlimited**: new teams every time, as often as you like, and it counts on the all-time board.
  - It pays the standard 15 minigame coins a game day, like Over/Under and Build-a-player. It is in no ladder,
    earns no badges and cannot move a season leaderboard, a best score or a streak.
- **`data/season-2025.json`**, built by `tools/data/build-season-pool.mjs` from public nflverse data. Century
  needs every player's actual 2025, which `data/players.json` does not hold — that file keeps a player's BEST
  season per five-year era, so filtering it to 2025 answers "whose best 2021–25 year happened to be 2025" and
  returns 129 of 634 players, no Mahomes, and 18 of 31 teams with a quarterback. The new file has 435 players
  across all 32 teams, every one fielding a QB, RB, WR and TE, and the builder refuses to write one that does
  not.
- **`century_runs`, and the first new board that no client can write.** Over/Under and Build-a-player are
  browser-written because a guess leaves no trace a server could replay; a Century run leaves exactly that —
  seven (slot, player) pairs and at most one re-spin — so the new `submit-century` Edge Function recomputes
  the seven teams from the seed, checks every pick against the board it was really dealt from, and adds up the
  touchdowns from its own copy of the data. Nothing the client says about its score, its teams or its roster is
  used. The daily's seed is the function's own clock, so that variant cannot be ground for a lucky board.
- **A code that hashes to a daily's seed is refused**, the protection the main daily already has. The prize is
  the seven TEAMS, not the row, and `hashStr` is FNV-1a/32 and invertible — `tests/test-century-edge.mjs`
  finds an ordinary-looking eight-character code that deals a given day's board in about a second, by meeting
  in the middle, and then asserts it is turned away.

### Notes

- **The balance is measured, not guessed, and the test prints it.** Over 20,000 games played by a bot that
  always takes the leading scorer for a slot it still needs — which, with the stats hidden, is what perfect
  knowledge of the season looks like — the median is 80, the ninetieth centile 95, and 100 is reached 5.1% of
  the time. The absolute ceiling is 133. `tests/test-century-logic.mjs` fails if the goal stops being reachable
  or stops being hard.
- **Not built, deliberately:** no share card (it would have to be spoiler-free about the seven teams, which has
  not been designed), and nothing on the profile (`player_stats` does not count Century runs). Both are in
  CENTURY.md §9 rather than half-done.

## [2.8.3] — 2026-09-28

The rest of the sweep's confirmed findings. Client and one SQL function; no Edge Function change.
**Re-run `migration-runs-log.sql`** before the client - it clamps `site_stats`' limit and changes nothing else.

### Fixed

- **A failed read told you your account had saved nothing.** `fetchProfileDetails` answered `null` both for
  "this read failed" and "there is no details row", so one dropped request - a 500, a 502, a 429, the errors
  postgrest-js does not retry - left the header with no frame and no picture for the whole session, and the win
  celebration the player bought, or earned with the undefeated badge, silently did not play when they went
  20-0. Nothing on screen said a read had failed and only a reload fixed it. It throws now, the caller gives it
  one more go, and failing that keeps what is on screen rather than claiming they wear nothing. The same
  distinction `fetchProfile` was given in v2.0.0, for the same reason.
- **Over/Under announced something that had not happened.** A dropped insert and a real duplicate were both
  `false`, and the screen turned that into "Today's Over/Under was already recorded on another device" - to a
  player on their only device, with no row anywhere. Because the coins are claimed only on a save, the day's 15
  went unclaimed, and the device's own done-flag was written regardless, so there was no second try.
  `upsertSouRun` answers "saved", "already" or "failed" now; `23505` is the only error that means recorded.
- **The Stats screen printed "0 / Created players" when only that one query failed.** `fetchBuildCount`
  returned `0` for a failed read, against the rule `fetchSiteTotals` states two functions above it: "a failed
  request must not show up as '0 drafts'". It returns null and the tile shows a dash.
- **Four duel powerup refusals were not on the buttons**, against the promise the file's own header makes and
  `VersusHowTo` repeats to the player: `already_dipped`, `no_room`, `respin_too_late` and `one_at_a_time`. The
  commonest is ordinary play - your opponent doubles up on a board, and your own Double dip stays lit and
  answers "somebody has already doubled up on this board". Same shape as the GM cap being enforced on one of
  the two doors into `draft()`.
- **The steal's target buttons enforced no rule at all.** Every filled slot on the opponent's strip was
  tappable, so the refusal arrived after the tap: "that doesn't fit a slot you have open" for a player who
  could never have worked, and "a player can only change hands once" for the first thing a robbed player tries.
  The strip now asks `stealableSlots`, which is what `decideMove` asks.
- **`site_stats` was the one RPC with an unclamped limit**, while granted to `anon` over the public REST API -
  nine subqueries using `p_limit` raw, where `null` means no limit at all in SQL. Clamped to 50, like
  `ladder_best`, `versus_top` and `board_looks` already are. The mock is clamped identically: a JS default
  fires only on `undefined`, so `p_limit: null` used to mean zero rows there and everything in SQL.
- `ItemPreview` indexed `NAMEPLATES` without a guard, unlike `NamePlate` and `NameInk` beside it. A plate added
  to the catalog and seeded but missing its drawing - the exact split the catalog file warns about - would have
  thrown on render, and with no error boundary anywhere that is the whole shop screen for everyone.
- `profile.jsx`'s `EMPTY_DETAILS` was missing the three newest fields, the same omission the shop had.
- **Every title played two celebrations at once.** The equipped win celebration and the `.cel` panel's own
  confetti were gated on the same condition, so a championship fired both - and since the default celebration
  **is** Confetti, a player who had equipped nothing got confetti twice. The panel keeps its 🏆 stamp and the
  celebration is the one you chose. Build-a-player's verdict keeps its own: different screen, no overlay.

## [2.8.2] — 2026-09-27

Client only. No migration, no Edge Function change.

### Added

- **A name colour now shows on the player card**, which it did not before. The reason it could not was real and
  is now out of date: "no colour clears AA on cream, navy and black" was true of a single colour, and a look has
  carried one palette per scope since 2.7.0 - and the card publishes its scope. Measured across every theme and
  all 32 team colours: **1,073 colour-on-card pairs, none below AA.**
- **A nameplate and a name colour work together.** The plate sits inside the colour, as a frame around it, and
  because a frame is never behind a letter it carries the whole look - the full gradient, drifting if the look
  drifts. The letters stay the plate's own ink, and that part is not a preference: painting the colour onto the
  letters fails even when each pair is allowed to pick whichever of its three palettes suits that plate best -
  **only 50 of 99 combinations clear AA**, and the 49 that fail are every mid-tone fill.
- `plate=` and `namecolor=` in the UI harness, so any combination of the two can be looked at.

### Changed

- **Cosmos was a purple outline, and the reason was a mistake in how it was built.** Everything was behind text,
  where everything has to clear AA, so the whole card had to be dark enough to read through. The other themes do
  not do this: Turf's chalk, Ticket's barcode and Dynasty's wreath all live in the trim, the outer band the
  card's padding keeps text out of. Rebuilt on that split - a brighter nebula behind text, real starlines in the
  trim, and a four-ring edge. The binding constraint turned out to be a star landing inside the nebula, which is
  why the stars behind text are a texture and the visible ones are in the trim.

### Fixed

- **Self-tinted chips ate their own contrast.** A chip tinted with its own colour at 16% put its text below AA:
  the draft board's quarterback pill measured 3.71:1, Genius 4.30:1. All now 6%, the one value every position
  and both mode chips clear on every scope.
- Every label under the 12px floor `tools/ui-harness/audit.mjs` holds the app to - the position pill, the stat
  labels, the result strip, the duel's opponent strip - raised to it.
- The Reports queue's name button underlined in `--line2` at **1.39:1**, its only affordance. Now 6.67:1.
- Three reduced-motion gaps closed per selector rather than by hiding a parent: `.ball.air` (which a media query
  could never reach, being less specific than the rule meant to stop it), `.confetti i`, and the admin panel's
  marker.
- **The shop dropped three slots on every save.** `showDetails` rebuilt what you were wearing from the saved row
  and named only frame, card and title - so the nameplate, name colour and celebration came back undefined, and
  the item you had just equipped showed as merely Owned with an Equip button under it.
- `name-flame`'s blush was 4.30:1 on the Leaderboard champion block's lime glow - a token painted over a token,
  which no surface list had. The glow is in `NAME_SURFACES` now.
- The UI harness rendered a blank page and a TypeError for `screen=shop&name=` with a name the seed already
  holds or the username rule refuses. It says which, in the mock's own words.

## [2.8.1] — 2026-09-27

**Order: `migration-shop.sql`, then `migration-profiles.sql`, then BOTH Edge Functions, then the client** -
in each environment. Shop adds three items and four avatar presets and teaches `supporters_sync` to take a
supporter pack's avatar off on a refund. Profiles replaces `set_avatar` (it learns the supporter pack) and
`claim_username` (which now refuses to clear `guest` for a session with no credential attached - run it before
the client, or the browser's trade-up form is offering something the database still allows anyone to do).
The functions change because `versus-logic.mjs` and `game-logic.mjs` did, and because both functions changed on
their own account: `submit-run` gives the duplicate guard back on a thrown error, `match-pick` abandons a match
it cannot grade. `versus-logic.mjs` is the one to watch - the browser imports the same module, so deploying the
client without the functions leaves the two running different rulebooks.

### Added

- **A supporter can now dress entirely in supporter items.** Three new ones complete the set: **Orbit**, a dark
  violet frame with one bright body going round it; **Cosmos**, a deep-space card theme with a violet nebula in
  one corner and a field of stars; and **Stargazer**, an avatar pack of four - Comet, Moonlight, Constellation
  and Satellite. With the title, the Aurora nameplate, the Nebula name colour and the Supernova celebration
  already there, supporter now fills **every slot**, in one cosmic line, so it reads as one thing rather than as
  seven unrelated purchases. Football seen from a long way off, which is what keeps a cosmic pack from looking
  like it wandered in from another game.
  Cosmos' two numbers were chosen by measurement rather than eye: one star layer at 6% and the nebula at 70%.
  Two star layers would overlap and put a brighter value behind a letter than `cardPaint` declares, and a star
  inside the nebula is the brightest thing a letter can land on - at the first values I tried, eleven of night's
  text tokens fell below AA on it. Orbit's ring is kept dark all the way round so the body crossing it is the
  only bright thing; with the ring carrying its own bright violet the whole frame read as a plain purple circle
  at 24px.

### Fixed

A ten-agent sweep of the whole codebase, each on one area, hunting for defects rather than reviewing style.
Everything below was reproduced before it was changed, and every fix was checked by breaking it again.

- **Any anonymous session could promote itself to a full account with one RPC.** `claim_username`'s guest
  trade-up cleared `profiles.guest` without checking the session had stopped being anonymous - and every guest
  refusal in the database reads that one column, so clearing it opened the daily, the shop, duels, reports, the
  public avatars bucket and a profile page. The email-and-password step lives in the browser, which is manners,
  not the boundary; `mod_act`'s rename was given a guest gate for a smaller version of this and this function
  never had one. Cost per account was one anonymous sign-in and one POST, repeatable. The trade-up now requires
  a credential actually attached to the `auth.users` row, tested permissively (email, a pending email change,
  phone, or no longer anonymous) because with email confirmation on - which staging has - gating on
  `is_anonymous` alone would refuse the real trade-up.
- **Two ways to brick a duel permanently**, both in `respinBoard`, which recomputed state the replay already
  knew. It read "leader or follower" from pick-number arithmetic, which stops being true once a dip adds a turn
  or a steal rewrites one, so the serve-both rule was skipped for a board's real leader (2.6% of re-spins in
  that shape) - and it assumed the asker takes one pick off the board, when a player who has declared a double
  dip takes two (0.36% of dip-then-re-spin lines). Both dealt boards that could not serve the turns they owed:
  `autoPick` returns null, the clock answers 500 forever, `replayMatch` never reports done, so `match-pick`
  never reaches `finish()` and never abandons it - both screens on "Working out the result..." and
  `create_match` handing both players back into the dead match for every later duel. The second was
  deliberately exploitable: dip, re-spin onto a thin board, take both, deny your opponent the win. It now asks
  what the board still owes each player. Measured over 1,500 matches: 32 and 55 bricks respectively, both zero.
- **A match that could not be graded, but had no dropped picks, was retried forever.** `match-pick` abandoned
  on `missing` and 500'd on anything else `matchResult` refused - and it is pure over the rosters the replay
  just derived, so it answers the same way on every later request. It abandons now, like its sibling.
- **A thrown error in `submit-run` stranded the duplicate guard**, so that season could never be recorded: the
  player is told "already recorded" forever, and a Daily left a row on the public board carrying w/l/score for
  a season `profiles` never counted. Only the failed-write path gave the guard back. Reachable without an
  attacker - `applyRun` throws outright on a profile whose `recent` is not an array, and an isolate killed
  mid-request does the same with no catch at all.
- **Both re-spins spent on one turn, era first, threw the team one away.** The replay applied a fixed
  team-then-era order rather than the order they were spent, so the player was answered with a board, both
  counters went to zero, that board was burned out of the pool, and the board never changed. The order is
  recorded now; rows written before it keep the old behaviour, so a match in flight replays identically.
- **`decideMove` accepted any slot beginning with `FLEX`** - `FLEXX`, `FLEX99`. The database's CHECK refused
  the insert, so the player got "failed to save" instead of a refusal, and a row that ever did land would put a
  player in a slot `openSlots` cannot see: the turn spent, the slot still open, the match ungradeable.
- **`/leaderboard` still drew boards claiming nobody had ever played.** 2.7.1 moved the name colours and stars
  onto the view and left the three board loads in `openTab`, so that address, Back/Forward, and both "See the
  leaderboard" buttons showed a Points ladder saying "No one has earned points in Unlimited yet" and a Duel
  board saying "Nobody has duelled yet" - stated as fact, because `loading` starts false. Every board load is
  keyed on the view now.
- **The board header failed WCAG AA on 11 of 32 teams.** `.reel` and the duel's sticky bar paint the team's
  colour and write over it in white and cream; on Pittsburgh's gold "Pick 1 of 6" measured 1.52:1, on the
  screen the game is played on. `tests/test-theme-contrast.mjs` never saw it because the surface is data, not a
  token. `--tc-deep` deepens a team's colour only until cream carries the text - 11 changed, 21 untouched -
  and a new test holds every team on every stop of the gradient.
- **A name colour on the duel screen was painted over the team's colour**, where Flame on Pittsburgh measured
  1.00:1 - the same luminance, an invisible name. It sits on a solid pill now, the same answer the clock in
  that row already had.
- **Every supporter item's shop tile rendered as a hole**, since v2.6.0. `.sh-r-supporter` was never added, and
  `var(--rar)` on an undefined property is invalid at computed-value time - which drops the whole declaration,
  so the tile lost its preview background and the detail row lost its hard shadow as well as the rarity edge.
  A test now holds every rarity to having one.
- **After a season, the Leaderboard showed the rank of your old best score beside the new one.** `finish()`
  fires the refresh through a closure holding the pre-season `stats`; `boardFormatRef` exists for exactly this
  class and `stats` never got one.
- **Two of four daily doors were not gated on `authReady`**, and the worst set the view first - tapping "Play
  today's daily" from the Leaderboard stranded the player on an empty Draft screen with no explanation. The
  rule lives in `startDaily` now, so a fifth door gets it for free. A finished daily is also no longer re-dealt.
- **A daily finished for an earlier date than the last one recorded destroyed the streak.** The date is the
  player's own calendar date and submit-run accepts UTC yesterday/today/tomorrow, so one account on two devices
  an ocean apart could legitimately do it. `dailyLast` no longer moves backwards either.
- **The mock had no `supporters_sync`**, so a refund left items equipped and `profiles.supporter` was never set
  at all - `storage-core.js`'s mapping read false in every test, and the ad decision to be built on it would
  have tested as working. The mock carries the trigger now, and its table dispatch no longer falls open to
  `daily_runs` for a table it does not know.
- Smaller, all measured: a nameplate ran 28px off the card at 320px for a wide 16-character name; a name link's
  tap target was 36.8px tall against the repo's own 44px rule, on the main route into a profile; roster chips
  tinted their own background with their own colour at 16% and three positions fell below AA; the avatar
  picker's `overflow:hidden` clipped its focus ring entirely; the supporter star was 11px under a 12px floor;
  `applyRun` could write `NaN` into six counters where `applyDnf` could not.

- **`set_avatar` would have refused a supporter pack's avatars.** Its pack check knew free, bought and badge
  packs and had no supporter arm, while `shop_state` has counted a supporter-rarity item as owned since 2.6.0 -
  so the picker would have offered the avatars and the save would have come back `bad_preset`. The comment
  above that check says exactly this ("anything narrower here would offer avatars this then refuses"); it was
  written about the badge arm and the supporter arm was never added. Found by writing the first supporter pack,
  and the mock had been right all along - it asks the shop's own `owns()`, which is why the two disagreed.
  The arm reads the entitlement into a variable through `EXECUTE`, because plpgsql plans a statement whole and
  naming `public.supporters` inside that condition would fail to plan on a database that has not had
  `migration-shop.sql` re-run - the same reasoning the inventory check beside it already used.
- **A refund left a supporter pack's avatar on the card.** `supporters_sync` took off every equipped supporter
  item but not the picture, which is not an equip slot and is just as visible. It clears now, back to the
  player's initial.

## [2.7.1] — 2026-09-27

Client only. No migration, no Edge Function change.

### Fixed

- **Landing straight on `/leaderboard` drew a board with no stars and no name colours.** They were loaded when
  a tab was *clicked*, and a tab click is only one way onto that screen: the `/leaderboard` address itself, and
  Back or Forward to it, open it without going through `openTab` at all. The board came up bare and stayed bare
  until the player happened to leave and come back. That address is the one the site hands to search engines, so
  an arrival that way is the likeliest first thing anybody sees. It now loads from the **view**, which covers
  every route onto the screen. Over/Under's board shows names too and had never loaded them by any route.
  The supporter star had the same gap in 2.6.0 and was never shipped with it; this is the first release where
  either is right. Found by opening the real staging site at that address rather than by clicking through it -
  the tab click, which is what every test did, was the one path that worked.

## [2.7.0] — 2026-09-27

**Needs `migration-shop.sql` re-run in each environment BEFORE the client.** It adds the `namecolor` kind and
its `profile_details` column, nine items, and `board_looks()`. Same file as 2.5.0's and 2.6.0's, so one re-run
carries all three. No Edge Function change.

### Added

- **Name colours: the name itself, coloured and drifting, on the boards.** Nine looks, six of them animated -
  Vaporwave, Flame, Frost, Prism, Toxic, Nebula, plus flat Game blue and Ember, and Undefeated for the badge.
  They render on the Leaderboard and the Stats boards through the one `NameLink` every name already goes
  through; on the **duel screen**, where both players' names are painted wherever the screen says them - on the
  clock banner, over each roster, and in "X beat Y" at the end; and on **your own name in the header**, on every
  screen, which is what puts one on the play screen, where it is the only name there is.
  **The contrast wall that sent coloured names to nameplates in 2.6.0 is still there, and this is what gets round
  it.** No single colour clears WCAG AA on cream and on true black - lime is 1.28:1 on cream, game blue 3.19:1 on
  the dark card - so a look is not a colour: each one is named **once per app scope**, the way theme.mjs names
  every token three times, and the app hands in the scope it is drawing. Deep on cream, bright on black, the same
  look either way. Every stop of every palette is held to AA against every surface a board name can sit on,
  including the 30% lime wash the Leaderboard paints over your own row, because a drifting gradient puts any stop
  under any letter. The drift is `background-position` only - nothing moves, nothing reflows - and it stops under
  reduced motion.
  The colour goes on the name and nothing else: the supporter star and the guest chip stay outside it in their
  own tokens, so the one thing that has to stay legible does. **The player card keeps its nameplate instead** -
  six card themes over 32 team colours has no readable text colour - so the two split the game rather than
  compete, and the shop's tab says so rather than leaving an equip looking like it did nothing.
  Every price tracks the nameplates: 750 common, 2,000 rare, 6,000 epic, 15,000 legendary. Undefeated is the
  fourth item on that badge and is never sold; Nebula comes with Supporter.
- **`board_looks(p_limit, p_names)`**: one read for both things a board decorates a name with. The supporter flag lives on
  `profiles` and the name colour in `profile_details`, so something had to join them - and a board that asked
  twice would show one decoration before the other. It is the only function in `migration-shop.sql` a signed-out
  caller may run, because a visitor reads the Leaderboard too, and it reads nothing that isn't already public.
  It replaces 2.6.0's unshipped supporters read.
  `p_names` asks about exactly those accounts and ignores the limit - the duel's two players, who may be
  anywhere in the alphabet and so may sit outside the boards' first few hundred wearers. Without it a duel
  between two players who had both bought a colour could show neither.

### Fixed

- **A nameplate drew over the title on the player card.** `.cs-plate` was already taken - the avatar artwork has
  used it since v1.11.0 - so the plate inherited `position:absolute`, the name measured zero pixels high and the
  banner landed on top of the title beneath it. Renamed to `.cs-nameplate`; the artwork had the name first.
  A plate is also a block sized to its content now, with an outer ring, so it can't vanish into a card of nearly
  its own colour (Turf is `#092B12` on a `#06200D` card). Not shipped in 2.6.0 - the whole shop revamp goes out
  together.

## [2.6.0] — 2026-09-27

**Needs `migration-shop.sql` re-run in each environment BEFORE the client.** It adds the `supporters` table
and its trigger, `profiles.supporter`, the `supporter` rarity, the `nameplate` and `celebration` kinds and
their columns, and eighteen items. No Edge Function change.

### Added

- **Supporter: a one-off unlock, not a subscription.** The only thing in the game that costs real money. It
  unlocks the `supporter`-rarity items and, once there are ads, turns them off - a promise that has to keep
  being kept for anyone who bought before the ads existed, which is why the entitlement never expires.
  The entitlement is a row in `supporters`: RLS on and **no policy at all**, like `wallets` - written by the
  service role (a payment webhook) or by hand in the SQL editor, because an entitlement a browser can write is
  a shop with no door. It carries `source` (`stripe` | `play` | `apple` | `grant`) and `reference`, designed
  for the stores now while it costs one column: an account gains this once, but a store build has to use that
  store's billing, and a refund has to be able to find the row.
  A trigger keeps `profiles.supporter` in step, which is what the app reads - the ad decision happens before
  anything renders, not after a shop call. **Deleting the row is the refund**: the flag clears and anything
  supporter-rarity being worn comes off, because a card renders the equipped column and asks nobody about
  ownership. Nothing is deleted, so buying again restores it.
  **Supporter items are different, not better.** The best thing in the game stays a badge item, earned by going
  20-0. Coins can never buy a supporter item: `shop_buy` refuses `supporter_only` before it looks at the
  balance, so nobody reads "not enough coins" for something no balance reaches, and the shop shows them locked
  with "Comes with the one-off Supporter unlock" rather than a price it would refuse.
  Two items to start: the **Supporter** title and the **Supernova** celebration.
  No payment yet - grant it by hand:
  `insert into supporters (user_id, source, note) select id, 'grant', 'why' from profiles where username = 'NAME';`

- **A star beside a supporter's name**, on every board. It arrives through `NameLink` — the one component
  every name in the game renders through — rather than as a column on each board's rows, which is both smaller
  and more correct: `guest` is snapshotted because it is a fact about the account when the row was written,
  while supporter changes the day somebody buys, so a snapshot would be stale on every row already in
  `daily_runs`, `sou_runs` and `builds` (whose foreign key points at `auth.users`, not `profiles`, so the flag
  cannot be embedded either). The star is `--accent-ink`, the one accent token that is AA in all three scopes,
  and carries a label so it is not meaning held in a colour.

- **Nameplates**, including animated ones — a banner behind the name on the player card. Eleven, one for
  every way to unlock a thing: coins up the rarity ladder, the Dynasty badge, and the Supporter unlock. Four of
  them (Midnight, Inferno, Emerald, Aurora) drift a gradient.
  This is where *"animated names with different colours"* ended up, and the measurement is why: **not one
  colour clears AA as text on all three card scopes** — lime is 1.28:1 on cream, game blue 3.19:1 on the dark
  card. Coloured text alone cannot work in an app with a cream, a navy and a black surface, so the colour
  travels with its own background, where it can be as vivid as it likes because the pair is checkable. Every
  stop of a gradient is checked, not just the first: a drift can put any stop under any letter. The drift is
  `background-position` only, so nothing moves and nothing reflows, and it stops under `prefers-reduced-motion`.

- **Win celebrations.** A fifth kind of shop item: an overlay that plays over the whole result screen when a
  season wins the title - Confetti (free, and the default), Spotlight, Fireworks, Gold rain, and **Champion,
  unlocked by the Undefeated badge rather than sold**, because the best celebration in the game should belong
  to somebody who has gone 20-0. Priced off the existing rarity ladder (750 / 2,000 / 6,000), not invented.
  CSS only, no canvas: it runs on a phone while the season is still ticking in. Fixed, `aria-hidden` and
  `pointer-events:none`, so it never takes a tap or reads out over the result the screen already announces,
  and it does not play at all under `prefers-reduced-motion` - the final frame of confetti is an empty screen,
  so there is nothing to snap to. Every piece's position is a pure function of its index, so a celebration
  draws the same picture every time. The little confetti inside the `.cel` panel is a different thing and stays.

## [2.4.1] — 2026-09-26

Client only: no migration, no Edge Function change.

### Fixed

- **The sitewide "drafts that went 20-0" bar fills again.** Its fill was painted `var(--lamp)`, a custom
  property defined in no scope of `theme.mjs` and referenced in exactly that one line, so it resolved to
  transparent and the bar has been empty since it shipped - the width was always right, there was simply
  nothing to paint. It is `var(--accent)` now, lime being a fill and never text, which is the one thing that
  token is for on cream.
  Nothing in the suite could see it: `tests/test-theme-contrast.mjs` holds the three scopes to the same token
  SET, which catches a token missing from one scope and not a name missing from all three equally; the bar is
  not text, so no contrast rule applies; and the element renders with the correct geometry either way. That
  test now also checks that **every `var(--x)` the app paints with is a theme token or is set somewhere** -
  all 63 across the nine screen files, `--lamp` being the only one that was not. It strips block comments
  first, because a comment explaining a bad name is that name to a regex, which is how it first ran red
  against the note left where the bug had been.

## [2.4.0] — 2026-09-26

**Needs `migration-runs-log.sql` re-run in each environment BEFORE the client.** It adds `ladder_best` and
changes nothing else, so it is safe on any shape and its backfill is a no-op as always - but the client calls
that function the moment somebody taps a mode, so a client ahead of the migration shows an empty board for
every mode. No Edge Function change.

### Added

- **The Leaderboard's Top 10 has a mode of its own.** Daily, Unlimited, Genius and GM each get their own
  score board, beside the "Every mode" one that was there before - so "who has the best GM roster" is finally
  a question the Leaderboard can answer, the way the points ladder below it has had a mode since it existed.
  A single mode cannot come from `profiles`, which keeps one best score per FORMAT (`best_score` /
  `best_score_std`) and nothing per ladder, so it reads the runs log through a new `ladder_best(ladder,
  format, limit)`. Adding four more columns to `profiles` was the other way and would have meant submit-run
  writing them, a backfill, and a second place for a best score to disagree with itself.
  **One row per account** - their best draft in that mode - because the board answers "who is best at this
  mode"; a list where one player holds four of the ten places is what `best_gm` on the Stats screen already
  is. Mirrored in `tests/mock-supabase.mjs` and held to the real SQL by `tests/test-runs-sql.mjs`, which
  gained two accounts tied on the same score so the tiebreaks are actually exercised - without them the
  fixture's scores never collided inside a top ten and dropping a tiebreak passed.

## [2.3.0] — 2026-09-25

Client only: no migration, no Edge Function change.

### Changed

- **Every mode on the Modes screen has a colour of its own.** It read as random because it was: Genius shared
  violet with Duel, Build-a-player shared lime with the daily, and Genius, GM and Build-a-player were three
  identical cream cards told apart only by a small tinted icon. Each cream tile now owns one colour applied the
  same three ways - a wash across the card, the icon chip, and the border - so the set reads as one system
  rather than four unrelated treatments. Genius is crimson, GM blue, Build-a-player teal; the daily keeps its
  lime feature block, Unlimited its neutral dark card, Duel its violet and Over/Under its orange.
  Tint, never paint: a saturated field fails AA under the ink (violet is 4.46:1), so the colour identifies the
  tile and the surface keeps carrying the text. No new tokens - every colour already existed in all three
  scopes, so dark and night follow for free. The `genius` token moved with its tile, because the mode bar chip
  on the draft screen mirrors it; its dark value is `#FF7EA0` rather than the obvious crimson, which is the
  same value as `qb` and sits below AA on the Navy card's glow corner.

### Removed

- **"N left on the board" is gone from the duel's board header.** It was the first thing squeezed at every
  width and truncated to "30 left on the b..." beside a long opponent name even on a full-size phone - and the
  board underneath already lists every option there is, so it said twice, badly, what the screen says once.
  The 360px font-shrink that existed to fight the truncation goes with it.

## [2.2.1] — 2026-09-25

**Needs `migration-versus.sql` re-run in each environment before the client** (`join_match` only; it replaces
the function and adds nothing, so re-running is safe on any shape and the live site keeps working between the
two steps). No Edge Function change.

### Fixed

- **A duel link now says which way you are too late.** Opening one that has already been taken said "that match
  already has two players" whatever had happened to it since — true while it is being drafted, misleading once
  it is over, and simply wrong for a lobby the host closed before anybody took it, which reached "that match has
  already started" about a match that never started. `join_match` answers from the state instead:
  `already_finished` for a duel that is over, `match_abandoned` for one called off, `already_full` only while it
  is actually being drafted. Either player reopening their own match still gets it back in any state — the link
  is how they reach the result.


## [2.2.0] — 2026-09-24

### Added

- **A duel invite is a message now, not an address.** The lobby's "Copy link" is **Invite a friend**: it hands
  the phone's share sheet a written invitation — who is asking, one line of what a duel is, and the link last —
  so it can go straight into a text. Matchmaking is entirely getting one link to one person, and whoever opens
  it first *is* the opponent, so a bare URL in somebody's messages was asking a lot of it. On a computer there
  is no share sheet, so the same message is copied instead; the link stays on screen either way. The button
  says only what actually happened, and a closed share sheet is not a send.

### Fixed

- **Sharing from a duel no longer writes over the season result screen's status.** Everything that knows how a
  device shares now lives in one `sendShare`, and `shareOut` is the season result's own wrapper around it.
  Sharing a duel result used to leave "Shared" on the Share result button of a season nobody had shared — and
  with the clipboard blocked, the duel's text sat in that screen's copy-it-by-hand box. The duel screen reports
  its own status instead.


- **An Android app**, wrapping the same game (Capacitor). Nothing about the website changes, and the app isn't on
  Google Play yet — see "The Android app" in CLAUDE.md.
- In the app, **Back works the way Android expects**: it closes the rules or a report sheet, then returns to Modes
  from any other screen, and only leaves the app from Modes itself. It used to leave the app from anywhere,
  including the rules a first-time player is looking at.
- In the app, **closing the share sheet no longer says a season was shared** — the button only changes once the
  share actually goes out.
- The app's **launch screen is Gridspin's**, the mark on its lime coin over the app's cream, instead of the phone's
  default grey.
- The app **draws under the phone's status and gesture bars**, so they take the colour of whatever screen you're on
  — cream on Modes, navy while drafting, black on the Leaderboard — instead of framing a dark page in cream. The
  clock and battery icons flip to suit. Nothing on the website changes.

## [2.1.1] — 2026-09-24

### Fixed

- **An announcement no longer plays twice.** A re-spin or a steal could appear again a couple of picks later,
  on the other player's turn, looking like it had arrived late. Introduced by the turn announcement in 2.1.0.

## [2.1.0] — 2026-09-24

### Added

- **Your turn says so.** When a duel comes round to you it announces itself across the screen, the way a
  powerup does — in the game's own lime, and briefly, since it happens eight times a match over a board you're
  reading. The player waiting sees nothing; a powerup spent during your turn still speaks over it.

## [2.0.1] — 2026-09-24

### Fixed

- **Re-spinning when all you need is a defense works.** It said there was no board to spin to, about boards
  every one of which has a defense on it. The same bug meant a re-spin could also land on a board that had
  already been picked clean.

### Changed

- **A defense matters twice as much.** One board carries one defense, so there's no choosing between them the
  way there is with twenty players — which left the pick barely able to move a match. It now decides about one
  duel in seven rather than one in twelve.

## [2.0.0] — 2026-09-24

Gridspin's public release. No new modes — this is the pass that makes the game safe to point strangers at.
(The version is a milestone, not a semver bump: by this repo's own convention a fixes-only release would be
a minor one. 2.0.0 is the number the site is being advertised under.)

### Fixed

- **A patchy connection can no longer lock you out of your own account.** One failed read of your profile used
  to be indistinguishable from "this account is brand new", which could sign you out without saying so and post
  your next season under a fresh guest, or trap you behind the "pick a name" box that has no way out — and that
  box came back every time you switched back to the tab. It says what happened and lets you try again.
- **Keeping your seasons takes effect even if the page can't refresh itself afterwards.** You were being told
  the daily, the shop and duels were still off-limits under your brand-new name.
- **A message about one thing stops following you around the whole site.**
- **Tapping Duel or the Shop as a guest tells you why** instead of doing nothing at all.
- **Escape closes the thing you opened last**, not everything that happens to be open.
- **Guests look like guests everywhere.** Their names carried the guest chip on the Leaderboard but not on
  any of the eight Stats boards, Over/Under or the builds board, where they read as ordinary accounts you
  could click through to and report. And a guest who typed their own profile address got the full owner
  screen the Account tab refuses — bio, picture, shop and all — which made throwaway accounts that could
  post a public bio and upload pictures. A guest's address doesn't answer for anyone else either now — their
  name was never a link, but typing it worked.
- **Nobody else can have a name that looks like a guest's.** `Guest_ZZZZZ` was anybody's, and rendered with
  no chip.
- **The daily waits until the game knows who you are.** On a slow connection a returning guest could start
  it before their session loaded, draft all six, and have it refused at the end — with the day marked used.
- **A GM draft you had on the go when this update landed is dealt again, rather than refused at the end.**
  GM now knows about the salary cap when it deals a board and when you re-spin one, so a GM draft started
  before this release and finished after it could have been turned down as an illegal roster. Nothing is
  charged for it, and a daily is simply dealt again. Every other mode carries on exactly where you left it.
- **GM mode can't re-spin you into a board you can't afford anybody on either.** The dealer learned about
  the cap and the re-spin button didn't, so the one control you reach for to escape a dead board could hand
  you another one.
- **An account that hasn't picked a name yet can't use the site as picture hosting either.** The same hole as
  the guest one, one step further along — an account part-way through signing in with Google has no name at
  all, and nothing stopped it uploading.
- **A duel that has ended says so**, instead of telling a player they aren't in a match they're in.
- **A season that can't be saved says so.** A malformed submission used to come back looking exactly like the
  connection being down, so the advice was to retry something that was never going to work.
- **The daily can't be rehearsed through the app.** A challenge code can no longer be one that deals a daily's
  own boards — today's or any other day's.
- **A draft with no board left to play stays that way through a reload**, instead of putting you back on the
  dead board with picks that the server then refused. A re-spin now gets you out of it, and the message no
  longer says the draft is free to abandon when resetting counts as a DNF.
- **Leaderboards stop shuffling.** Rows tied on the same number could swap places between refreshes, so the
  one at the bottom of the top ten came and went. Over/Under was worst.
- **A guest account can't be renamed into a stranded one.** Renaming a throwaway account gave it a real
  username on a session with no email or password behind it — no way in, no way to claim it, and no way back.
  Reports against those accounts can still be cleared; only the rename is off.
- **The 1v1 board is in the same order as every other board.** Names on it sorted by a different rule from
  the Leaderboard and Stats, so the same tie came out in two different orders on two screens.
- **A duel that can't work out its result no longer takes Duel down with it.** If the last pick landed but the
  result didn't, both players sat on "Working out the result…" — and worse, tapping Duel afterwards put them
  straight back into that dead match, every time, for good. It sorts itself out now: whoever opens the match
  finishes it. A match that genuinely can't be graded ends instead, with no result and nothing recorded for
  either player.
- **Two things happening at once in a duel can't lose one of them.** Moving at the same moment your opponent's
  clock ran out could quietly drop the pick that lost the race, which is what made a duel ungradeable in the
  first place. Whichever one lands second is now told to try again, and does.
- **A duel that can't work out its result no longer takes Duel down with it.** If the last pick landed but the
  result didn't, both players sat on "Working out the result…" — and worse, tapping Duel afterwards put them
  straight back into that dead match, every time, for good. It sorts itself out now: whoever opens the match
  finishes it. A match that genuinely can't be graded ends instead, with no result and nothing recorded for
  either player.
- **Two things happening at once in a duel can't lose one of them.** Moving at the same moment your opponent's
  clock ran out could quietly drop the pick that lost the race, which is what made a duel ungradeable in the
  first place. Whichever one lands second is now told to try again, and does.
- **A throwaway account can't use the site as picture hosting.** Guests were told no when they tried to set a
  picture or a bio, but nothing stopped one uploading the files themselves â€” ten per account, in a public
  place, each with a working public address, on an account anyone can make again in a second. The upload is
  refused now, and so are buying, wearing and showcasing anything, which a guest has nowhere to wear anyway.
  Coins still add up while you play as a guest and are waiting when you keep your seasons.
- **"Check your connection" no longer means "you can't do that".** Several refusals that are rules rather than
  faults were reaching the screen as connection errors, so the only advice was to retry something that was
  never going to work.
- **The salary cap is actually enforced while you draft.** Locking a player in from his card checked it;
  tapping the roster slot next to him did not, and that had never checked anything. So in GM you could put
  a $42M player into a $19M gap, watch the total go red, play the whole season out — and have it turned
  down at the end as an illegal roster, while the screen said it would be saved next time. Both routes
  now refuse the pick and say which reason it is.
- **A season can't be worth six times what it should be.** When the bot you're scored against couldn't
  field a roster under the cap, the game fell back to measuring you against one that simply bought the
  cheapest man available — which isn't a benchmark, and paid up to 717 ladder points for a season worth 97.
  The replacement worked out what the boards could really field, but by spending down the cap the same
  greedy way — so on a third of those drafts it ran out of money too and handed the cheapest-man number
  straight back. It searches the boards properly now. Worst case found was 804 points for a season worth
  about 118, which also bought a badge on a below-average draft.
- **A patchy connection can't cost you an account any more.** Three more places read your profile without
  allowing for the read failing: signing up could tell you it went wrong when it hadn't, a saved season
  could be reported as lost with its coins hidden, and a season played on a slow connection could quietly
  sign you out of a real account and post itself under a throwaway.
- **Logging out takes the draft with it properly.** It was cleared from storage but left on screen, so the
  next person on that device was handed it anyway — and charged for abandoning it.
- **Two quick taps on a mode tile cost one abandoned draft, not two.**
- **Guests look like guests on the Over/Under and builds boards even if they played before this release.**
  Those rows kept an ordinary name that led to a player who doesn't exist.
- **A guest who taps Report is told why, instead of being told their connection failed.**
- **"Today's daily" says it's waiting instead of ignoring you** while your account loads.
- **Two boards ordered tied names differently from every other board.**
- **Nothing is under 12px any more** — the roster chips on the boards and the "You" marker were the last two.
- **A duel doesn't end because one request dropped.** A single failed read told both players their match
  didn't exist, over a live board with the clock still running — and if the clock's own update failed, the
  next player started their turn on the last one's time, which an opponent could then run out on their
  behalf.
- **A draft that can't be continued says so.** If no board is left that fits what you still need, the game
  used to leave the board on screen with its buttons live — and the season you then finished was refused
  at the end, with nothing you could do about it. It closes the board and tells you now, and nothing is
  charged for it.
- **A season's coins can't vanish because a badge failed.** They were paid and then not shown, so there
  was no way to tell.
- **Keeping your seasons works even if you reload halfway through.** Setting the email and choosing the
  name are two steps; reloading between them used to lock you out of keeping that account for good.
- **A message about one season stops following you around the site**, the way other messages already do.
- **Your own profile is yours whatever case you type it in.**
- **The Stats boards stop showing your old guest name** once you've kept your seasons.
- **Yesterday's daily doesn't greet you in the morning.** A tab left open overnight kept offering the day
  before — its result, its "already played", and a tile that did nothing when tapped.
- **Two players on the same score stop swapping places** between page loads.
- **Guests can't be reported**, and a moderator renaming one no longer turns a throwaway account into a
  real one while removing the only way its owner could have kept it.
- **Duels grade the best players properly again.** A limit meant for the 17-game season had reached duel
  scoring, where it made the two best Flex seasons in the game worth exactly the same — in the one mode
  where the better roster is supposed to win outright.
- **Guests can't put a bio or a picture on the site.** Guest accounts have no profile page for anyone to
  see or report, so pictures posted from one couldn't be moderated at all.
- **A report reaches a moderator saying what was typed.** The note was the one box on the site that took
  anything at all, including the invisible characters that hide a word and the one that turns the rest of a
  sentence backwards — in a message whose whole job is to be read by somebody deciding what to do about
  another player.
- **A badge is worth what the game says it is worth.** The part of the database that pays them was taking
  the amount from whoever asked instead of from its own list. Nothing could ask but the game itself, and
  every badge has always paid the right amount — but the wallet decides now.
- **Signing in with Google no longer leaves its one-time code in the browser's offline store**, and that
  store keeps one copy of the page rather than one for every challenge link, profile and duel you open.
- **Every page has one address.** The `.html` versions now send you to the real one.
- **Search engines are told when each page actually changed**, instead of all of them claiming to have
  changed today because the site was rebuilt.
- **The site can't be loaded inside a frame on someone else's page**, and browsers are now told not to
  guess at file types and not to pass on more of the address than they need to.
- **Over/Under reads its rounds out and keeps your place.** After every guess the verdict went unannounced
  and the keyboard lost its place entirely — which, against a seven-second clock where running out counts
  as a miss, made it close to unplayable without a mouse.
- **Every screen says what it is.** Over/Under and Build-a-player never named themselves, and the draft
  board and a playoff result screen put their headings in the wrong order.
- **Nothing on the site is smaller than 12px any more** — the slot chips in the draft's floating bar, the
  duel scoreline, the version tag, the tag on the home page and the scoring labels were all under it.
- **The duel board stops cutting off "24 left on the board"** on the narrowest phones.
- **Over/Under knows you've played, whichever device you played on.** The "already played today" note
  lived only in the browser you played in, so opening it on your phone after your laptop dealt you a whole
  second set — which was then quietly thrown away, because the day was already recorded. It checks the day
  before dealing anything now.
- **The highest-OVR board shows ten builds again.** A few malformed rows from before the game checked them
  were sorting above everything and taking up slots, so the board showed fewer than ten — or nothing at all.
- **The daily can't be rehearsed on a challenge code.** A code that deals the day's boards played out that
  day's exact season — so you could try it against as many rosters as you liked and then play the real one
  knowing the answer. Blocking codes that merely *looked* like the daily wasn't enough; the game now
  recognises the draft itself, however the code is spelled.
- **GM mode can't deal you a board you can't afford anybody on.** It used to, and the only way out was
  abandoning the draft — which counts against you, for a player who'd made a legal pick every round. A
  greedy spender hit it in nearly a quarter of drafts. You also can't spend so much that the slots you have
  left become unfillable: the game now holds back the minimum for them, which is the same reserve the bot
  it scores you against has always kept.
- **Every season is scored against a real par.** The bot you're measured against was supposed to take the
  *second* best player each round, but whenever both Flex slots were open the second best was literally the
  same man as the best — so on 27% of its picks it had no handicap at all. Par was too high and **every
  season scored about 17% fewer points and coins than intended**. Totals already banked stay where they
  are; seasons from here on earn what they were always meant to. A related one: 2% of finished GM seasons
  scored nothing at all, because the bot spent itself out of a roster and the game read that as "no par".
- **"Best possible order" no longer names the same player twice** and promises a total no roster could reach.
- **Reloading the moment after a pick no longer loses it.** For about a second while the next board spun up,
  the saved draft was still the one from before your last pick.
- **A draft in progress leaves with the account that dealt it.** Log out with one on the go and the next
  person to sign in on that device inherited it, and was charged the abandoned draft when they moved on.

## [1.19.1] — unreleased

### Fixed

- **Tapping "Run it back" could destroy the season you had just finished.** Two things went wrong at once on
  that one tap. The server applies a season by reading your whole record, working out the new one and writing
  it back, and the abandoned-draft request that "Run it back" fires is much quicker — so it read first and
  wrote last, and the finished season was simply gone, while the code it was played on stayed used up. The
  retry then said "already recorded". A personal best could not be recovered. Every write now carries the
  version of the record it was based on, so the second one is applied on top of the first instead of over it.
- **Yesterday's unfinished daily is no longer waiting for you this morning.** A daily you left half-played
  came back the next day, on the Draft tab, with nothing saying whose boards they were — and finishing it
  counted for the day before, so a streak got credit for a day that was never played. Leave one unfinished now
  and today's daily is simply today's.
- **Championship could hand out a guaranteed 20–0.** Championship re-scores every player, and that lifted
  what a Flex pick can be worth well past what Fantasy allows — far enough that a team score of 142 beats
  every opponent in the game outright, so the season isn't really played. Three of the first 16,550 challenge
  codes we checked could be drafted into one. Championship's Flex is now held to Fantasy's own ceiling.
  Nobody's score changes: the best Championship team so far is 120.7.
- **Playing one season before signing in could lock you out of your own account.** Open the site on a new
  phone, play an Unlimited season without signing in first, and the game takes a guest account for you — which
  hid every sign-in and sign-out control at once, because as far as the app was concerned you were signed in.
  The only thing left, "Keep my seasons", then refused your own email and your own username. Keep your seasons
  now offers "Log in to it instead", and says so outright when the email you typed already has an account.
- **And the same tap charged you an abandoned draft for the season you had just won** — a DNF and fifty ladder
  points — and could hand the finished draft back as "Pick 6 of 6". Four paths read the saved draft without
  waiting for the clear that finishing it had already started.

## [1.19.0] — 2026-09-21

### Added

- **Duel.** Send someone a link and draft against them. You both watch the same eight boards, pick in turn, and
  the better roster wins — no dice, no upsets, just the sixteen picks. It goes on a board of its own, beside the
  others on the Leaderboard; it never touches your season record. Whoever picks first on the opening board is
  decided by the match code, not by who sent the invite.
- **A defense and a kicker.** Every board in a duel offers that team's players, its defense in each year of the
  era, and its kicker — so you can take the 2006 Ravens defense fifth or a kicker first, whenever you want them.
  Real seasons, rated against their own year: 859 defenses and 859 kickers from 1999 to 2025. Their defense comes
  off your score, your kicker adds to it, and each is worth exactly what one roster slot is worth.
- **Powerups, one set each, all spent on your own turn.** Two re-spins — and when you pick first, the board you
  spin to is dealt to your opponent as well, so it is a real decision. A **steal**: tap it, then tap anyone on
  their roster and he is yours, while they get your pick to replace him. And a **double dip**, two off one
  board in exchange for giving up your next pick, which leaves them the board after to themselves. A player can
  only change hands once, so nobody spends their steal taking back what was taken from them.
- **A powerup takes the whole screen.** Spend one and both players see it: the icon, the powerup in letters
  the size of the screen — RE-SPIN, DOUBLE DIP, STOLEN — and who did what underneath. It used to be a line of
  small text above the board that was easy to miss entirely.
- **A result screen that says one thing.** The football score, big, winner first the way a score is
  written — then "Rival beat ShrimpCity" under it, and each roster with its own number above it. Confetti if
  you won.
- **A clock on every pick**, and either player can call it — so an opponent who closes the tab costs you the wait,
  not the match. A pick the clock makes is the best thing still on the board for the slots you have open.

### Changed

- **Cut before launch: a fourth powerup and the pause that came with it.** "Steal the pick" let whoever picked
  second on a board reverse the order and lead it instead — and for it to be spendable at all, a board's first
  pick had to wait ten seconds. Two playtests said the same thing: between them they cost more in confusion
  than they were worth, and a board that refuses every pick for ten seconds reads as broken. A board opens the
  moment it is dealt now.

### Fixed

Everything below was found by a review pass over the whole feature before it shipped, so none of it ever reached
a player — but it is written down because the shapes are worth remembering.

- **Four ways a match could end with no result**, all of which left it unfinishable, ungradeable and impossible
  to leave: a steal spent on a board somebody had also double dipped, which swallowed the dip and ended the
  match at fourteen picks; stealing your own pick; both players stealing on the same turn, which cancelled
  out and spent both powerups for nothing; and a steal that left the board with nothing for somebody to pick.
  Seven of four hundred fuzzed matches broke the first way; none do now.
- **A steal can't take the last man on the board who fits a slot you are about to reopen.** A steal converts a
  turn — you spend yours taking somebody, and the player you robbed picks in your place — and that rewrites the
  order the board was cleared for. Nothing re-asked whether it could still serve everyone, so about one duel in
  two hundred died on it once both players were holding powerups for the endgame: no result, no record for
  either of them, and nothing to do but abandon the match. The check is back, and it is adversarial — a board
  that *could* serve everyone in some order is not enough, because the players choose the order.
- **One powerup a turn.** A double dip or a re-spin spent on the same turn as a steal was thrown away silently,
  with the counter still ticking down: the board sprang back to what it was and the powerup was simply gone.
  Both are refused now, and both stay yours.
- **A steal the other player could not see.** The screen never received the record of it, so the two of you
  disagreed about whose turn it was and neither could move until the clock ran out.
- **Who leads the first board is a coin flip on the match code**, not whoever created the lobby. Leading a board
  is worth more the earlier it comes, so whoever led boards 0, 2, 4 and 6 won 53–54% of matches — and that was
  always the host, so anyone who habitually sent the invite rather than clicking one won more, permanently.
- **The duel board no longer greys out while you wait** for the other player to pick, which had put the player
  names at 3.43:1 for about half of every match. Its rules button has a name on a phone, its clock is readable
  on all 32 teams, and a screen reader no longer re-reads the whole board once a second.
- **An open lobby can't be found by anyone but its host.** Its code is the whole invite, and `matches` was
  readable, so open lobbies could be listed and walked into ahead of the friend they were sent for.
- **Tapping Duel during a match takes you back to it** instead of opening a second lobby while the first one
  auto-picks your roster for you. On Android, Back leaves a duel rather than cycling between it and Modes forever.
  Signing in with Google from an invite keeps the invite.
- **Powerups that would do nothing are refused rather than spent** — a re-spin after your first pick on a board,
  a second double dip on one board.
- **The final score is a real one.** It used to draw a losing total and a margin separately, which paired them
  into scorelines like 31–23 — possible, but something that has happened 22 times in 7,307 NFL games. Every
  final now comes from a table of the commonest real scorelines at that margin.
- **Two Jaguars seasons left out of the defense and kicker data.** nflverse only has eight weeks of 2001 and
  2002 for them, while points allowed is the full year, so both rated as defenses that gave up a season's points
  on half a season's sacks — and the 2002 board offered a three-game fill-in as the team's kicker. 859 of each
  now, rather than 861 with two wrong.

## [1.18.0] — 2026-09-21

### Changed

- **The game reads properly with a screen reader and a keyboard.** Every screen now names itself, the tab bar and
  the screen are separate landmarks with a "skip to the game" link before them, leaderboard columns say what they
  are, the season-by-season table on a profile can be scrolled without a mouse, and dialogs keep the keyboard
  inside them until they're closed.
- **Position colours no longer carry meaning on their own.** A roster chip on a best-lineup card now says the slot
  it filled — QB, RB, WR, TE or Flex — instead of leaving it to the colour.

## [1.17.0] — 2026-09-20

### Added

- **Finish a season without an account and it still counts.** Your score goes on the leaderboard straight away
  under a name like `Guest_4F2A1`, with a **guest** chip beside it. No sign-up, no email, nothing to fill in.
- **Keep your seasons whenever you like.** On the Account tab, add an email and pick a proper name: it's the same
  account, so every season, coin and streak you earned as a guest comes with you, and your name on the boards
  changes to the one you picked.

- **A privacy page**, at gridspin.app/privacy and linked from the footer: what the game keeps, what other players
  can see, where it lives, and how to have an account and its data deleted.

### Notes

- A guest can't play the daily — it's one draft a day per account, and a guest account can be made again and
  again — and has no profile or shop. Coins still pile up for when you keep them.

## [1.16.0] — 2026-09-20

### Added

- **Sign in with Google.** "Continue with Google" sits beside the email form on the Account tab. Google has no
  username to give, so the first time you use it the game asks you to pick one — that's the name on the
  leaderboard and your profile — and the account isn't created until you do. After that it's one tap to sign in.
- Signing in with Google on an address that already has an account signs you into that account.

### Notes

- Sign in with Apple isn't here: it needs a paid Apple Developer membership. The Android app still uses the email
  form, since OAuth there needs a deep link back into the app.

## [1.15.0] — 2026-09-18

### Added

- **Gridspin installs like an app.** On Android, Chrome now offers to add it to your home screen, where it opens
  full screen with its own icon — no store, nothing to download. The offer appears as an "Install Gridspin" button
  beside the live counts, and only when your browser actually makes one; on an iPhone it's Share → Add to Home
  Screen, as it always was.
- **A draft keeps working without a signal.** The game, its artwork and every player's stats are kept on your
  device after the first visit, so a draft still deals boards on the underground. Only the parts that need other
  people — the leaderboard, your account, saving a season — wait for the network to come back.

### Changed

- Pages and the game's code are still fetched fresh whenever there's a connection, so an update reaches you on the
  next load rather than the next week.

## [1.14.0] — 2026-09-17

### Added

- **How to play and the Leaderboard have their own addresses**, gridspin.app/how-to-play and
  gridspin.app/leaderboard, so a search result or a shared link can open either one directly. Each carries its
  own text, so it reads even before the game loads.
- **A footer on the Modes screen** with links to both.

### Changed

- The Leaderboard keeps `/leaderboard` in the address bar while you're on it, the way a profile keeps its own
  address. A reload comes back to it.

## [1.13.0] — 2026-09-15

### Added

- **More to save for in the shop.** Four new titles: War Room and Sleeper Agent (Epic, 6,000 coins each), and First
  Overall and The GOAT (Legendary, 15,000 each). Epic titles wear a spark and Legendary titles a crown, where other
  titles have a double stripe.
- **Two Legendary avatar packs, 15,000 coins each.** Draft day: a podium, a draft card, the call and a draft cap.
  Hall of Fame: a gold jacket, a bust, laurels and the Hall itself.

### Changed

- In the shop, the badge-reward titles now come after every title you can buy.

## [1.12.0] — 2026-09-15

### Added

- **Coins.** Every finished season pays: 20 for the season (40 for the Daily), 2 a win, 10 for making the
  playoffs, 50 for the title, 150 more for going 20–0, 1 for every 10 ladder points, and up to 50 for a
  Daily streak. New badges pay 100, 300 or 1,000 (Day One pays 500), and Over/Under and Build-a-player pay
  15 each once a day. Coins only go down when you spend them: a bad draft or a DNF costs nothing.
  Unlimited, Genius and GM pay for your first 20 seasons each day; the Daily always pays.
- **A starting balance.** Everyone who played before coins existed starts with their career so far: 20 a
  season, 2 a win, 10 a playoff trip, 50 a title and 150 a perfect season, at least 250 and at most 10,000.
  New accounts start with 250. Badges you've already earned pay out with your next finished season.
- **The shop.** Spend coins on a frame for your picture, a theme for your player card, a title under your
  name, or one of three packs of new avatars. Some items come only with a badge. Everything is cosmetic:
  nothing in the shop changes a draft or a score, and there's no real money.
- **Showcase.** Choose which three badges sit on your card.
- **The result screen shows what a season paid**, with any new badges and a way to the shop. Your balance
  and a Shop button are on your profile card, and your header picture wears your frame.

### Changed

- **A finished draft counts once.** Sending the same finished draft again, or finishing a second season on
  a challenge code you've already finished, no longer counts, and the result screen says so (without
  claiming a new best score for it).

### Fixed

- **A Daily whose save failed can be saved again.** The retry used to be told the Daily was already recorded.
- **The server refuses more drafts the app couldn't have made:** a GM roster over the salary cap, a Daily
  claiming to be GM or Genius, and a draft that skipped past boards it could have picked from.
- **"New sitewide best score" is checked against an up-to-date leaderboard.** The leaderboard reloaded while
  a season was still saving, so it could miss that season: the Modes screen kept showing the old best, and
  the next season could claim a sitewide best it hadn't set. It now reloads once the save answers.

## [1.11.1] — 2026-09-15

### Fixed

- **The admin name is reserved.** The testing tools on the draft screen open for "admin" in any
  capitalization, but usernames were only unique exactly as typed, so "Admin" or "ADMIN" could still be
  signed up. Once an account holds the name, no other capitalization can sign up with it or be renamed to it.

## [1.11.0] — 2026-09-15

### Added

- **Profiles for everyone.** Tap a name on the Leaderboard, on Stats or on the Over/Under board to open
  that player's profile. Every profile has its own link (gridspin.app/u/name), Back takes you to where you
  were, and guests can look too.
- **Your picture.** Upload a photo and drag and zoom it into the circle, or pick one of 12 default
  avatars. Photos are resized in your browser, and hidden details - including a phone photo's location -
  are removed before anything is uploaded. Your picture shows in the header.
- **A bio and a favorite team** on your player card.
- **22 badges**, from First Down to Every Single Day. They count what you've already done, so the ones
  you've earned are already on your profile. Your three best sit on your card.
- **Personal stats:** seasons by wins, your record in each mode, best lineups, the players and team you
  draft most, your biggest upset, best GM score, Over/Under and Build-a-player bests, and recent drafts.
- **Report.** Signed-in players can report a profile's picture, bio or username. Moderators get a
  Reports queue to remove a picture, clear a bio, rename a player or dismiss a report.
- **Share profile** sends a link to your profile (the share sheet on phones, a copied link on a computer).

### Changed

- **Bios and new usernames are checked against a blocked-word list**, and usernames must be 3 to 16
  letters, numbers and underscores however an account is created.
- The profile no longer shows the points bank; ladder points are still there.

### Fixed

- **Over/Under and Build-a-player scores always show the player's own name**, and a malformed
  Build-a-player result can no longer break the Stats screen.

## [1.10.1] — 2026-09-14

Fixes from a full review of the 1.8.1–1.10.0 releases.

### Fixed

- **A daily could be lost by switching drafts mid-spin.** Tapping Daily while an Unlimited board was
  still spinning let that spin finish on the daily, saving the wrong board; the finished daily was then
  rejected and couldn't be replayed.
- **DNFs landed on the wrong points ladder** when a draft was abandoned while another mode was open
  (for example, a GM draft's penalty went to the Daily ladder).
- **Unlimited drafts were thrown away instead of resumed.** Run it back and Play an unlimited draft after
  a daily, and the Unlimited tile or Start my season for a GM, Genius or challenge draft, replaced the
  draft with a DNF. They now take you back to it.
- **A dealt draft with no picks disappeared after a reload** while still counting against you. It now
  comes back, and Modes shows it.
- **A board looked at as a guest counted as a DNF** for the account created right after.
- **Run it back after a GM or Genius season** now deals the same mode and scoring again.
- **The challenge card:** its DNF warning now stays current and warns guests too, and Draft these boards
  waits until your account has loaded. It no longer promises the exact same boards - a sharer's
  re-spins don't carry over.
- Admin test endings no longer lead to a DNF; challenge links with a trailing slash open.

### Changed

- **Re-spin years is now Re-spin era** ("↻ Era" on phones).

## [1.10.0] — 2026-09-14

### Added

- **A Wordle-style share card.** Share result now sends your record, a square for every game
  (🟩 a win, 🟥 a loss, 🟨 an upset win), the playoffs, your team score and a link, and never your
  players, so it can't spoil the daily for friends. Dailies are numbered from Gridspin's launch:
  today is Daily 1.
- **Challenge links.** Sharing an Unlimited, Genius or GM mode season sends a link to your exact
  boards. A friend who opens it sees "They went 17–3. Can you beat it?" and drafts the same six
  boards under the same rules with one tap, instead of typing in a code.

### Changed

- **The draft screen shows what you're playing:** Genius mode and GM mode get colored chips, and the
  scoring format is always named (Fantasy as well as Championship).

## [1.9.1] — 2026-09-14

### Added

- **Gridspin can be found in search.** Search engines now get a clear title and description, the
  one address to list (www.gridspin.app), a sitemap, and a description of Gridspin as a free game
  played in the browser. The test site and the old vercel.app addresses ask search engines to skip
  them, so they can't crowd out the real site.

### Changed

- **The site loads faster on phones:** the app download is about half the size.

## [1.9.0] — 2026-09-14

The game is now **Gridspin**, at its own address: **[gridspin.app](https://gridspin.app)**. Accounts,
stats and leaderboards are all still there; sign in once on the new address.

### Changed

- **New name and mark.** Perfect Season is now Gridspin: "Spin an era. Draft the greats. Go 20–0."
  The mark is the re-spin arrow around a football, in the site's lime. It was renamed because the
  Patriots' owners hold a "Perfect Season" trademark and another football game already uses the name.
- Accounts, stats, points, streaks, leaderboards and the game itself are unchanged.

### Added

- **A tab icon and a home-screen icon** for phones.
- **Link previews:** pasting the site's link into iMessage, Discord or X shows a Gridspin card
  instead of a bare address.
- **Shared results end with the site's link,** so friends can tap straight in.

## [1.8.1] — 2026-09-14

### Fixed

- **The season on screen could differ from the one saved.** In current Chrome, a season that reached
  the playoffs could show a different result from the one recorded on your profile and the
  leaderboards: one daily showed a 19–1 championship loss and was saved as a perfect 20–0. Each
  playoff game's play-by-play is shuffled using the browser's own sort, and Chrome 152 sorts short
  lists with fewer steps than the server does. Each step draws a random number, so after the first
  playoff game the browser and the server were rolling different numbers. That affected about one
  season in eight, and more than a third of seasons with two or more playoff games. The shuffle now
  draws exactly the way the server always has, in every browser. What was saved was always the
  server's result, so no saved season or challenge code changes. On a device that showed a
  mismatch, today's daily card can still show the on-screen record until tomorrow.
- **Leaving an Unlimited draft before your first pick dealt new boards without a DNF.** Going back
  to Modes and tapping Unlimited again, reloading, resetting, or switching between Unlimited, Genius
  and GM mode all threw the dealt boards away for free, and handed back a used re-spin. A draft now
  counts from the moment its first board is dealt: coming back picks it up where you left it, and
  resetting or switching modes counts as a DNF, the same as after a pick.
- **Play an unlimited draft and Run it back, after a daily, threw away an Unlimited draft you had in
  progress** and counted a DNF. They now take you back to it.
- A perfect season's summary on the profile and the daily card read "Perfect season. 20–0..".

### Changed

- **Build-a-player's attribute buttons were redesigned:** each attribute is a card with its grade
  in a large colored chip, three to a row on wide screens and one per row on phones.
- **The header matches the rest of the site:** How to play and Log in are chips, your name has a
  lime initial and opens your profile, and the version is a small tag.
- **Phones:** the draft screen is more compact, so the first player card starts higher; the
  re-spin buttons shorten to "↻ Team 1"; GM mode shows the cap you have left in the sticky team
  bar; on the smallest phones the Leaderboard puts each record under the name so long usernames
  fit; and the admin panel starts collapsed.
- The Leaderboard's "20–0s" column is now "Perfect".
- The Stats screen no longer explains how runs are counted.

## [1.8.0] — 2026-09-14

A full pass over every screen on phones: small and large phones, tablets and landscape. Five
review agents checked each screen against a checklist, the issues were fixed, and the same agents
re-checked the fixes.

### Fixed

- **Share result did nothing** since 1.7.0: the button hit an error and never shared or copied.
- **The draft screen's Unlimited button wiped your draft in progress and counted a DNF.** It now
  takes you back to that draft, the same as the Unlimited tile on the home screen.
- **Over/Under could be replayed for points and kept running in the background.** Leaving and coming
  back re-dealt the round you had just answered, and leaving through the top menu kept the clock
  running. Walking away mid-round (or reloading) now counts as a miss, and an answered round is
  never dealt again.
- **The page opened in the wrong place on phones:** screens kept the previous screen's scroll
  position, the next draft board could open deep in the list, the season result slid off the top
  while games ticked in, and How to play opened scrolled to the bottom.
- **Things ran off the screen or overlapped:** the top menu between 481 and 760px wide (landscape
  phones, split-screen tablets), the leaderboard tables at 320px, the roster with long surnames,
  a 20–0 record, points and ranks on the result screen, the season game tiles, the Players
  menus, and several headings.
- **iPhones zoomed in on every text field**, and many buttons and links were too small to tap
  reliably. Buttons are now at least 44px tall on touch screens, and links have larger tap areas.
- **Styles lost since 1.4.0:** the scoring toggle's display font, link colors and muted tabs were
  being overridden by a CSS rule and now show as designed.
- The live playoff scoreboard's score and the "Your roster, graded" rows were misaligned by a
  leftover rule; refreshing a leaderboard no longer collapses the page while it reloads.

### Changed

- **Share, Run it back and See the leaderboard sit right under the result** instead of below the
  grades and recap.
- On phones the top menu is an even three-by-two grid.
- A player who can play Flex gets one "Lock in · Flex" button instead of two identical ones.
- Over/Under's Over and Under buttons are large and equal, and stay in the same place between
  answering and moving on. Build-a-player's attribute and position buttons are a grid.
- The Stats boards show rank, name and value on one row on phones.

### Correction to 1.5.1

- 1.5.1 said the intermittent failed requests came only from the in-app browser used for testing.
  Checking this release on staging in real Chrome caught one as well: rare, but real. The automatic
  retry added in 1.5.1 recovered it and the page loaded normally, which is the protection that
  matters; the underlying cause on the Supabase side is still unknown.

### Deploy notes

App only. No database migration or Edge Function change.

## [1.7.0] — 2026-09-14

A new look, part two: the Leaderboard and the season result get their own personality.

### Changed

- **The Leaderboard is black.** The best team ever leads the screen with a 👑, every table has big
  rank numbers with #1 in lime, and your own row is outlined and tagged "You".
- **Results are built around the record.** The win–loss record fills the top of the screen with
  Wins and Losses labels, a title run gets a 🏆 Champions stamp, and team score, points and rank sit
  in one strip underneath.
- **Your rank now means this season.** The result screen ranks this season against every logged
  season in its format ("#212 of 1,874 · Top 11%"). It used to show your best-ever rank and count
  players instead of seasons, so a 0–17 season could read "#1 · Best ever".
- "Draft a friend's board" is only on the Modes screen now; the Leaderboard is rankings only.

### Added

- **🚨 Upsets.** Any win where you had a 35% chance or less gets a 🚨 on its game, the biggest playoff
  upset gets a callout, and a title that lands on the Biggest upsets board says where it ranks.
- **🔥 Daily streaks on the result screen**, with a bigger moment at 3, 7, 14 and 30 days and "new
  best" when you pass your longest streak.
- Outcome emoji: 🏆 for a title, 🧊 for missing the playoffs, 💀 for four wins or fewer.

### Fixed

- **Your own row was never highlighted** on the Top 10 or the points ladder: it compared account IDs
  against usernames, which never match. Only the daily table got it right.
- The Leaderboard's Refresh button could switch the board back to Fantasy scoring.

### Deploy notes

App only. No database migration or Edge Function change.

## [1.6.0] — 2026-09-14

### Added

- **🚨 Biggest upsets.** A new Stats board for each scoring format listing the lowest team scores
  that still won the championship: the lower the score, the bigger the upset. Each entry shows the
  record, the lineup, and whether it was a daily, Genius or GM run or a perfect season. Unlike a
  best-ever score, it never tops out, because someone can always win it all with a weaker team.

### Removed

- **Position records.** The best-ever player at each position stopped changing once the top rated
  seasons had been drafted. Biggest upsets takes its place.

### Deploy notes

Re-run `supabase/migration-runs-log.sql` (it now defines the upsets board), then ship the client. No
Edge Function change. Between the two steps an older client shows its position-records section
empty.

## [1.5.1] — 2026-09-14

### Fixed

- **Site totals and the Stats screen could fail to load on a dropped connection.** The Supabase
  library automatically retries a read that drops, but only for GET requests, and these two were
  being sent as POST, so a single dropped request left them empty (the home screen showed
  "0 drafts"). Both now go out as GET and get the same automatic retry as every other read.

### About the "intermittent failed requests"

- The failures investigated since 1.4.1 (a request stalling for about 5 seconds, then failing with
  a CORS error) turned out to come from the in-app browser used for testing, not from the site or
  Supabase. They reproduced on about one page load in five there, but not once in 30 fresh page
  loads in real Chrome (120 requests) or in 240 requests sent from Node over fresh connections. The
  1.4.1 and 1.5.0 changes aimed at them are still improvements, just not fixes for that symptom.

## [1.5.0] — 2026-09-13

### Added

- **Every run is now kept.** A new runs log records every finished draft and every abandoned one,
  permanently. Before this, each account only kept its last 10 runs.

### Changed

- **Stats cover everyone.** Every Stats board is now worked out from every account and every
  logged run, instead of the 300 most recently active accounts. Most-drafted players, GM-mode
  scores and position records include everything since the log started, plus each account's last
  10 runs from before then.
- Sitewide totals are added up by the database instead of in the browser.

### Fixed

- **Your own draft now counts in the live drafts number.** The tab you finished a season in was
  the only open tab that didn't tick up: it never heard its own "draft finished" announcement, and
  the leaderboard refresh that follows a finished draft read the total from before that draft saved.

### Deploy notes

Order matters: run `supabase/migration-runs-log.sql` in the SQL editor, then deploy the
`submit-run` Edge Function, then ship the client. A client without the migration shows zeroed
totals and an empty Stats screen.

## [1.4.3] — 2026-09-13

### Changed

- **A finished daily that didn't end in a title now says *See how it went*** instead of *See the
  damage 💀*. The button opens that day's result, and the old wording didn't read that way.

## [1.4.2] — 2026-09-13

### Changed

- **Sitewide totals moved to Stats.** The Leaderboard's "All time" tiles (players, drafts, perfect
  seasons) repeated the Stats screen's Sitewide tiles, so the Leaderboard now shows rankings only.

## [1.4.1] — 2026-09-13

### Changed

- **Site totals and your leaderboard rank download far less.** Both used to pull every column of
  every account just to add up a few numbers. Site totals now fetch only the three columns they sum,
  and your rank is counted by the database instead of in the browser. This was aimed at the site
  totals request that intermittently fails to load, but that failure still happens occasionally, so
  it is not fixed yet.

## [1.4.0] — 2026-09-13

A new look, part one. No gameplay changes.

### Changed

- **Redesigned visual system.** A cream foundation with ink type, electric lime as the accent, and
  game blue, orange and violet in small doses. New typefaces: Anton for headlines and scores, Inter
  for everything else. Subtle grain texture.
- **The draft is now a scoreboard.** The whole play screen, the season result, playoff games and the
  leaderboard's sitewide-best block use a navy stadium treatment with lime LED numbers.
- **New home hero:** "Can you go 20–0?" with a giant lime 20–0 and a single *Start my season 🏈*
  button.
- **Mode tiles each have their own treatment** instead of looking identical: the daily is a lime
  featured block, Unlimited a navy card, Over/Under orange, and the challenge-a-friend box is just
  content with no container.
- **Buttons feel physical:** solid borders, a hard offset shadow, and a small lift when you hover.
  Hover motion is turned off for anyone with reduced motion enabled.
- **Some buttons got personality:** *Let's go*, *🔒 Lock in*, *Run it back 🔁*, *Skip to the end ⏩*,
  and a finished daily reads *Relive it 🏆* or *See the damage 💀* depending on how it went.
  Everyday controls kept their plain labels.
- The browser tab now says "Perfect Season" instead of "Perfect Season (dev)".

### Accessibility

- Every text color in both the cream and navy themes meets WCAG AA contrast, and an automated test
  now checks it. Position and grade colors were darkened for the cream background, where the old
  bright versions were hard to read.
- Keyboard focus shows a clear outline on every button.

## [1.3.2] — 2026-09-13

### Fixed

- **Championship dailies never saved.** Since Championship scoring launched in 1.1.0, every
  Championship daily was rejected by the server: the game dealt its boards from one seed
  (`daily-<date>:std`) while the server checked the draft against a different one
  (`daily-<date>-std`), so the roster looked illegal. The result screen still played out, but
  nothing reached your profile, streak, points or the daily leaderboard. Fantasy dailies were
  unaffected. Both sides now get the seed from a single shared function, so they can't disagree
  again.
- A Championship daily already in progress under the old seed now starts fresh instead of resuming
  into a draft the server would reject.

### Known effect

- Championship dailies finished before this fix are not recoverable — the server never received
  them — and today's stays locked on that device. From tomorrow they save normally.

## [1.3.1] — 2026-09-13

No scoring changes — this release explains a rule that was already in effect.

### Fixed

- **Flex's grading was never explained**, so it looked like a bug. Flex compares raw production
  across every RB, WR and TE of an era rather than grading a player against his own position, and
  it's the only slot with no 130 ceiling. So an all-time season is worth more in Flex than in its
  natural spot — Christian McCaffrey's 2019 is capped at 130 as a running back but rates 168 in
  Flex — and the draft recap's "best possible order" would move your best player there with no
  reason given. That's now stated in the note under your graded roster, in the "best possible
  order" note, and in How to play.

### Changed

- `SCORING.md` documents uncapped Flex as a deliberate rule, and why it's safe: the named slots are
  still capped, so a team score can't realistically climb to the level that would beat every
  opponent automatically.

## [1.3.0] — 2026-09-13

### Added

- **A points ladder.** Every finished draft is now scored against a bot that played your same six
  boards. Beat it and you gain points; draft badly and you lose them. Because points accumulate and
  bad drafts subtract, climbing takes good drafts *and* a lot of them — one lucky perfect draft
  can't park someone at the top forever, and grinding sloppy drafts costs ground.
- **Four separate ladders** — Daily, Unlimited, Genius and GM — each ranked on its own. Both
  scoring formats earn onto the same ladder, since each is measured against par for that format.
- **A points bank**: every point you've ever earned, across all modes, shown on your profile. It's
  the currency a future shop will spend, and it's deliberately a separate number from the ladders —
  spending it will never cost you ladder position.
- The result screen now shows the points earned and the bot's par beside your team score.

### Changed

- In Unlimited, Genius and GM, only your **best five drafts a day** count toward the ladder.
  Everything still banks. Without this an uncapped ladder would rank free time above skill.
- Abandoning a draft costs a modest number of points, on the ladder it was abandoned in.

### Why a bot and not a perfect roster

Scoring against the theoretically best possible roster sounds right but doesn't work: simply taking
the best available player every round already reaches 96.5% of it, so everyone competent bunches
into 96–100% and 100% is a wall. A handicapped bot leaves room above par — strong play averages
114% of it — so the top of the ladder has somewhere to go. It also makes GM mode fair, where the
best roster is usually over the salary cap and therefore not something you're allowed to build.

### Fixed

- Resetting a draft recorded the DNF **twice**.
- Abandoning an Unlimited draft by starting another mode silently discarded it without recording a
  DNF at all.
- Two buttons ("Draft a new team", "Play an unlimited draft") passed the click event itself into
  the new draft's settings, which corrupted the saved-progress snapshot so that draft couldn't be
  resumed.

### Database

- Adds the per-mode points columns, the bank, and a rolling daily window to `profiles`. Existing
  rows start at zero. See `supabase/migration-points-ladder.sql`.

## [1.2.0] — 2026-09-13

No gameplay changes — this release is the process around releases.

### Added

- **A staging site**, a full clone of the game on its own Supabase project (separate database,
  accounts, and Edge Functions). Changes go there and are checked before production. Staging builds
  announce themselves with a "Test site" banner, because the worst way a test site fails is quietly
  looking like the real one.
- **This changelog**, covering everything back to the first public release.
- **Versioning.** The version lives in `package.json`, is baked into the bundle at build time, and
  is shown in the app header — so you can always tell which release a site is running. Releases are
  tagged in git.
- `npm run deploy:fn:staging` / `deploy:fn:prod` to deploy the Edge Function to one environment.

### Changed

- `CLAUDE.md` documents the release process as a hard rule: staging first, changelog entry,
  versioned launch — including for one-line fixes, since the release that broke the live
  Leaderboard had a fully passing test suite.

### Fixed

- How to play still described only PPR scoring, so a new player had no way to learn what
  Championship mode was before picking it. It now explains both formats. (Caught on staging.)

## [1.1.1] — 2026-09-13

### Fixed

- The Leaderboard crashed when switched to Championship. Switching format flipped the toggle
  before the refetch finished, so the loaded Fantasy rows were briefly read with the Championship
  accessor — and any account without a Championship score yet has nothing there, which threw and
  took the page down. Every existing account was in that state, so it broke immediately. Board
  data is now paired with the format it was fetched for, so the two can't disagree.

## [1.1.0] — 2026-09-13

### Added

- **Championship scoring**, a second way to grade a draft, chosen per draft alongside the existing
  modes. Standard (non-PPR) scoring: no point per reception, so yards and touchdowns decide a
  player's grade rather than catch volume — closer to what wins football games than to what wins a
  fantasy league. Fantasy (full PPR) remains the default and is unchanged.
- A separate daily for each scoring format, each with its own boards and its own one-per-day lock.
- Separate leaderboards, position records, and best-lineup boards per format. Career totals
  (drafts, wins, championships, daily streak) stay combined, since both formats play the identical
  season simulation.
- `SCORING.md` now documents both formats in full, including the Championship benchmark tables.

### Changed

- Scores from the two formats never rank against each other — they are stored in separate columns
  and never compared. Every score recorded before this release is a Fantasy score; nothing was
  converted or recalculated.

### Fixed

- Corrected two stale claims in `SCORING.md`, found while verifying the formula against all 3,124
  player-seasons: the 130 rating cap is applied when a rating is computed rather than at
  team-score time, and the benchmark table is rounded, with its 2021–2025 row expressed in
  16-game units.

### Database

- Added `profiles.best_score_std` and `profiles.best_run_std`; widened the `daily_runs` primary key
  to `(date, format, user_id)`. Existing rows default to the Fantasy format — nothing was
  backfilled or moved. See `supabase/migration-scoring-formats.sql`.

## [1.0.0] — 2026-09-12

First public release: the game as it ran before versioning began.

### Added

- **The draft** — six rounds, each spinning a random team and five-year era; fill QB, RB, WR, TE
  and two Flex from real player-seasons, then play a 17-game season and the playoffs against real
  NFL team-seasons. Win all 20 and you've gone perfect.
- **Daily challenge** — one seeded draft a day, the same boards for everyone, no resets.
- **Unlimited** drafts with shareable challenge codes, plus **Genius mode** (no stats shown) and
  **GM mode** (a $150M salary cap).
- **Over/Under** — a seeded daily stat-guessing game with three lives and a per-guess timer.
- **Build-a-player** — assemble a player one attribute at a time, then see whether he'd have won a
  real team the title.
- **Player index** — browse the full pool by team and era.
- **Accounts, stats, and leaderboards** on Supabase, with a Stats screen covering sitewide totals,
  best lineups, most-drafted players, position records, career records, and daily streaks.
- A live online-players and total-drafts counter.

### Security

- Scores are verified server-side. The client no longer writes its own score: it submits the draft
  trace, and an Edge Function independently replays it, confirms the roster was legally drafted,
  and recomputes the score and season outcome before saving. `profiles` and `daily_runs` are not
  client-writable at all.
- Known and accepted: Unlimited/challenge-code seeds are still client-chosen, so grinding codes
  for a lucky *legitimate* result remains possible. Closing that needs server-issued seeds.
