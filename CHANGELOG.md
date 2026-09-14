# Changelog

Every release that reaches the live site is recorded here. Newest first.

Versions follow [semantic versioning](https://semver.org): the **minor** number goes up for new
features, the **patch** number for fixes. Each release is tagged in git (`v1.1.1`) and the version
in `package.json` is the source of truth for what is deployed.

Releases go to the staging site and are verified there before production — see "Releasing" in
CLAUDE.md.

## [Unreleased]

Nothing yet.

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
