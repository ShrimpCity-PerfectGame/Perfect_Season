# Changelog

Every release that reaches the live site is recorded here. Newest first.

Versions follow [semantic versioning](https://semver.org): the **minor** number goes up for new
features, the **patch** number for fixes. Each release is tagged in git (`v1.1.1`) and the version
in `package.json` is the source of truth for what is deployed.

Releases go to the staging site and are verified there before production — see "Releasing" in
CLAUDE.md.

## [Unreleased]

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

## [1.17.0] — unreleased

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

## [1.16.0] — unreleased

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
