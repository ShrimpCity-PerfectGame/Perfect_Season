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

**Search engines (v1.9.1, more pages in v1.14.0).** The app is one page, so most of this lives in `page.html` and `build.mjs`:
production's canonical address is `https://www.gridspin.app` (Vercel forwards the apex to www; people
still share gridspin.app), with a generated `robots.txt` and one-URL `sitemap.xml`, a search title
("Gridspin – Football Draft Game: Can You Go 20–0?"; home screens get the short name via
`apple-mobile-web-app-title`) and JSON-LD structured data. Staging builds add `noindex`, and
`vercel.json` sends `X-Robots-Tag: noindex` on every `*.vercel.app` host, so staging and the old
production addresses never compete with gridspin.app. Keep staging's robots.txt crawlable - a crawler
has to fetch a page to see its noindex. The bundle is minified. The owner holds Google Search Console
for the domain; `tests/test-build-seo.mjs` checks all of the above.

**Pages of their own (v1.14.0, a third in v1.17.0).** Two screens also answer at their own addresses, so a search
result can send someone straight to them: `/how-to-play` and `/leaderboard`. The third, `/privacy`, is words only -
no screen answers it, so `site-pages.mjs` marks it `standalone` and `build.mjs` leaves the bundle off that page
(asserted, like every other swap). React therefore never mounts to replace its text, and it reads with JavaScript
off, which is what a policy should do; the Modes footer links it like the others, and since `parseSitePath` doesn't
claim the address the click is the browser's to follow. **Google's consent screen requires it**: publishing an
External OAuth app needs a homepage and a privacy policy URL, which is what gates Google sign-in for anyone who
isn't a listed test user. The address to write to is `PRIVACY_CONTACT` in site-pages.mjs; keep the page true to
what the code actually does. `site-pages.mjs` holds both addresses and all their
copy - including the How to play steps the dialog renders as JSX - so the rules can never exist in two versions;
`build.mjs` writes `public/how-to-play.html` and `public/leaderboard.html` from the same shell as the app, swapping
in each page's title, description, canonical, link preview and structured data (every swap asserted, so renaming a
tag in `page.html` fails the build), dropping the shell's `<noscript>`, and putting the page's words inside
`<div id="root">`, where React replaces them on mount. `vercel.json` serves each at its address, both are in the
sitemap, and Modes ends with a `.sitefoot` footer whose real `<a href>` links let a crawler walk between them.
Landing on either address opens that screen and keeps the address (`parseSitePath`); `pathFor` gives every history
write the address its screen lives at, so the Leaderboard sits at `/leaderboard` and everything else tidies to
`/`. Live numbers are never written into the built HTML - a page built yesterday must not claim to be today's
standings. `tests/test-site-pages.mjs` covers the app's side. **Brand search:** an unrelated itch.io game holds the
name "Gridspin", so brand queries need off-site mentions (social profiles and community posts linking here) more
than markup - that part is the owner's to do.

**Installable, and playable without a signal (v1.15.0).** The site is a real app when someone wants it to be:
`static/site.webmanifest` (standalone, a maskable icon) plus a service worker, which is what a browser wants before
it offers "Install app" at all. `service-worker.js` and `sw-rules.mjs` are bundled by `build.mjs` into
`public/sw.js`, stamped with the release and a fingerprint of the bundle - the bundle's name never changes, so that
stamp is the only thing telling two builds apart. Every deploy therefore names its store differently and the new
worker throws away the one before it. Pages and `/page.js` are fetched from the network whenever there is one and
fall back to the store only when there isn't (a player must never run last week's bundle against this week's
submit-run); the icons, the manifest and the Google fonts are served from the store and refreshed behind the
player. **Nothing that isn't this site's own files is ever stored**: every account, leaderboard, wallet and
submit-run call goes to Supabase on another origin and is passed straight through (`planFor`) - a stored answer to
any of them would be a stale leaderboard, a balance already spent, or a season saved twice. `entry.jsx` registers
the worker after load, and never inside the Android app, which serves the same files from the phone already. The
offer to install is the game's own: Chrome's `beforeinstallprompt` is held back and shown as an "Install Gridspin"
pill beside the live counts (iOS has no such event - it installs by hand through Share > Add to Home Screen).
`tests/test-pwa.mjs` covers the rules, what the build writes and the offer; the offline half was checked in real
Chrome with the network cut. **Runbook:** to take the worker off the site, deploy a `public/sw.js` whose only line
is `self.registration.unregister()`. A bad deploy needs no such thing - pages and the bundle are network-first, so
the next load has the fix.

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

**Profiles (v1.11.0).** Every account has a public profile at `/u/<username>`: a picture (an uploaded
photo, one of 12 default avatars, or the initial), a bio checked by a blocked-word list, a favorite
team, 22 badges, personal stats, and a Report button feeding a moderators' Reports queue. Every username
on the Leaderboard and Stats screens opens its profile. **`PROFILES.md` is the reference** for all of it
(database functions and error codes, the player_stats shape, the storage modules, component props,
addresses and history) - read it before touching any of the files below. See "Profiles" under
Architecture for the rules that matter most.

**Guests (v1.17.0).** A visitor who finishes a season doesn't have to sign up for it to count: the site takes
an account for them (Supabase's anonymous sign-in), the database names it `Guest_XXXXX` and marks it
`profiles.guest`, and the season goes through `submit-run` like anyone else's - the verification path doesn't
change at all. Their name carries a **guest** chip on the boards and isn't a link, because a guest has no profile
screen, no shop, and **never the daily**: a guest account can be made again and again, so counting one would hand
anybody as many goes at the day's board as they liked - `submit-run` refuses a daily from a guest (`guest_daily`),
and the app doesn't offer it. They do earn coins, which wait for them. A guest stops being one from the Account
tab (`KeepSeasons`): an email and password go onto the same account, then `claim_username` trades the given name
for a real one and rewrites the name snapshots on the boards, the way a moderator's rename does - the one time
that function is allowed to change an existing name. Everything played, earned and counted stays. The known cost
is leaderboard pressure: one person can make guests freely, so **turn on a CAPTCHA for anonymous sign-ins** in
each Supabase project before this is busy, and remember anonymous users count toward Supabase's monthly actives.
`tests/test-guest-accounts.mjs` covers the game's side; the naming and the trade-up are held to the real SQL in
`tests/test-profile-data.mjs`.

**Duels (v1.19.0).** Two players draft against each other from the same boards and the better roster wins.
Players see **Duel**; everything internal stays `versus` / `vs-` / `/vs/`, the same split the Gridspin rename
made. **`VERSUS.md` is the reference** - read it before touching anything below. The short version, and the
parts that are unlike every other mode:

- **The server holds the draft.** Every other mode is drafted in the browser and checked afterwards, because one
  player's draft can be replayed from its seed. A 1v1 cannot: the second picker's legal choices depend on the
  first picker's pick, so no browser can hold the truth. The picks live in `matches` / `match_picks` (public
  select, **no client write policy at all**) and only the `match-pick` Edge Function's service role writes them.
- **`versus-logic.mjs` owns every rule**, and `supabase/functions/match-pick/index.ts` owns none of them: it says
  who is asking, calls `decideMove`, and writes down what comes back. Same reasoning as game-logic.mjs - a rule
  enforced on one side and not the other will drift. It also means the rules are tested with no Deno runtime and
  no mock that mirrors them.
- **Nothing is stored twice.** `replayMatch` derives the boards, both rosters, what is gone and whose turn it is
  from the match's own rows, so a reconnecting client, a lying client and the server all compute from one place.
  Add state to the rows, never to a screen.
- **Eight boards, sixteen picks**, and every board offers that team's players, its defense in each year of the
  era and its kicker - a defense can go fifth and a kicker first. A board that cannot serve *both* players is
  skipped before it is dealt (VERSUS.md 8): 33 of the 160 boards hold one quarterback or one tight end, so two
  players who both need one cannot both be served from it.
- **No probability anywhere.** The higher score wins, every time. `winProb` and `gameResult` are not called: an
  upset is the best part of a 17-game season and the worst possible end to one game between two people. The
  football final is drawn from the result and can never contradict it.
- **Defenses and kickers are a duel's alone.** `data/versus-pool.json` (859 of each, 1999-2025, built by
  `tools/data/build-versus-pool.mjs` from nflverse) is read by `versus.jsx` and the Edge Function and nothing
  else; `POS` and `SLOTS` are untouched, and no existing score or board moves.
- **Three powerups, all spent on your own turn**: two re-spins, a **steal** (any one player off the other
  roster - you spend your turn on it and they get that turn to replace him; a player can only change hands
  once) and a double dip. A fourth, Steal the
  pick, was cut after playtesting along with the ten-second window that existed to make it spendable - see
  VERSUS.md 7 for what went with them and what it cost. A board opens the moment it is dealt.
- **The football final is a table of real scorelines**, not a loser's total plus a margin drawn separately -
  that produced finals like 31-23, which is real but has happened 22 times in 7,307 games. game-logic.mjs's
  `LOSER_PTS` and `MARGINS` are untouched, because the season sim is seeded and its outcomes are stored.
- **Who leads board 1 is a coin flip on the match code**, not whoever opened the lobby. Leading the early
  boards is worth about 54% of decided matches, and with Steal the pick gone nothing in the game answers it -
  so the seeding is the whole of the fairness. Do not make it parity again.
- **Guests may not play** (VERSUS.md 5), for the reason they may not play the daily: a guest account costs
  nothing to make, so two tabs would farm the board. **Known gap:** two *real* accounts in two tabs still can.
  It costs an email each and moves nothing but the PvP board; the answer if it is abused is a rate limit on
  `create_match` plus ignoring matches between accounts that only ever play each other.
- **Runbook** (SQL editor): end a stuck match -
  `update matches set status = 'abandoned', ended_at = now() where code = 'ABC123';`. Take a farmed result back -
  delete the match row (its picks follow) and decrement `pvp_wins` / `pvp_losses` on the two profiles by hand.

**Signing in with Google (v1.16.0).** The Account panel offers "Continue with Google" beside the email form.
Google has no username to give, so such an account arrives with **no profile row at all** (`handle_new_user`
only allows that for a provider - an email signup still brings its name and passes every check), and the game
shows a dialog that can't be dismissed until it picks one, through `claim_username`. That function is the only
way a profile is made outside the signup trigger; it carries the same rules (the username pattern, the reserved
`admin`, the word filter, uniqueness) because a modified browser can call it directly, and it refuses once the
caller has a profile, so it can never be a rename. Until a name is claimed the account is on no board, owns
nothing and has no wallet - the welcome coins ride on the profile insert - and `submit-run` already refuses a
season for an account with no profile, so nothing can be recorded under a nameless one. `PROFILES.md` 3.1 has
the function and the codes; `tests/test-signin-google.mjs` drives the flow and `tests/test-profile-data.mjs`
holds the SQL and the mock to the same answers. **Apple is not done**: Sign in with Apple needs a $99/yr Apple
Developer membership. **The provider is configured per environment** in the Supabase dashboard (Authentication >
Providers > Google, with a Google Cloud OAuth client), so staging and production must each be set up - exactly
the kind of drift the note under Releasing warns about. In the Android app OAuth would leave the web view for a
browser and need a deep link back; that isn't wired, so the app keeps the email form.

**Coins and the shop (v1.12.0).** Finished seasons, badges and the two minigames pay coins into a wallet
that never goes below zero, spent in a cosmetic-only shop: frames, card themes, titles and avatar packs
(some unlocked only by a badge), plus a free three-badge showcase. There's no real money, and nothing
bought changes a draft or a score. **`SHOP.md` is the reference** (the wallet and shop database functions
and their codes, submit-run's duplicate guard and reward steps, the storage module, component props and
test hooks) - read it before touching coins, the shop or submit-run. See "Coins and the shop" under
Architecture for the rules that matter most.

The main React component and most screens live in `perfect-season.jsx` (~180 KB, ~4,000 lines —
large enough that targeted `offset`/`limit` reads or grep beat a full-file read). Since v1.11.0 the
profile feature's screens live in their own files - `profile.jsx`, `avatars.jsx`, `avatar-picker.jsx`
(with `avatar-image.mjs`) and `moderation.jsx` - sharing display helpers through `ui-common.jsx` and
rules through `profile-rules.mjs` and `badges.mjs`, so they never import the main component back. v1.12.0
added `shop.jsx` and `cosmetics.jsx` the same way, with the item catalog in `shop-catalog.mjs` and every
coin amount in `rewards.mjs`. New screens of any size should follow that pattern. Player and opponent data lives in
`data/players.json` (~225 KB); the pure scoring/simulation/roster-legality logic shared with the
`submit-run` Edge Function lives in `game-logic.mjs` — see that section under Architecture below
before touching either.

**The Android app (in progress, 2026-09-17).** The game also ships as an Android app: a Capacitor shell around the
same build, so there is one game, not two. `capacitor.config.json` names it (`app.gridspin`, "Gridspin",
`webDir: app/www`); `android/` is the generated project and is committed. **`npm run app:sync`** builds the web
bundle and copies it in - `tools/app/build-app.mjs` runs the same `build.mjs` with `APP_ENTRY=entry-app.jsx` and
one environment's settings, then writes `app/www` with `page.html` as `index.html`. `entry-app.jsx` is the app's
entry: it imports the site's `entry.jsx` and wires Capacitor to the two things a phone needs, which live as plain
functions in **`app-shell.mjs`** so the tests can drive them without a device (`tests/test-app-shell.mjs`):

- **The hardware Back button.** The game is asked first, through a cancelable `ps:back` event (`BACK_EVENT`): it
  closes whatever is open over the screen, then leaves any screen other than Modes for Modes, and says so by
  cancelling. A dialog says what closing it means with `useCloseOnBack` (ui-common.jsx keeps the register; the
  topmost closes, exactly as Escape does). What the game doesn't take, Back does the ordinary way - a screen that
  pushed an entry of its own (a profile, the shop) goes back to where it was opened from, and Back from Modes
  leaves the app. Without this every Back press left the app, from the first-run rules dialog included.
- **The share sheet.** An Android web view has no `navigator.share`, so the game would quietly copy to the
  clipboard. `nativeShare` is the Web Share API over Android's sheet, and it keeps the part the game reads:
  closing the sheet is an `AbortError`, which shows no status. Swallowing it told players a season had been
  shared that they had just decided not to send.

**None of it reaches the website**: the site's build uses `entry.jsx`, so its bundle carries no Capacitor, and
nothing there ever dispatches `ps:back`. `npm run app:icons` draws every launcher icon and splash
from `static/icon.svg` (`tools/app/icons.mjs`), so the app can't ship Capacitor's logo; re-run it after
`cap sync`. It also writes the two brand colours the Android project paints with (`res/values/ic_launcher_background.xml`,
from theme.mjs's palette): the lime behind the icon and the cream behind the launch screen. The launch screen is
`AppTheme.NoActionBarLaunch` in `res/values/styles.xml` - Android 12 and newer ignore the template's
`android:background` and draw their own, so it sets `windowSplashScreenBackground`, `windowSplashScreenAnimatedIcon`
and `windowSplashScreenIconBackgroundColor`, and takes the `Theme.SplashScreen.IconBackground` parent, which is what
makes the icon background apply at all. Left as the template had it, the app opened on the system's grey. The app's version comes from `package.json` through `android/app/build.gradle` (1.14.0 → versionName
1.14.0, versionCode 11400). `tools/app/env.local.json` holds each environment's Supabase URL and **anon** key and
is gitignored - both are public (they ship in every build of the site) but they're the owner's to hand out.
`node tools/app/build-app.mjs production` builds against the real database; the default is staging, which shows
the "Test site" banner, and that is what test builds should use.

**Checked in the emulator** (2026-09-17, a Pixel-shaped android-36 AVD - Google's AEHD driver is installed, so
the emulator does run here; see the owner's notes for the setup): the app launches against the staging database,
a guest plays a full draft and season, the result screen shares the spoiler-free card through Android's sheet,
the keyboard resizes the page rather than covering the field, and Back behaves as above. Drive it by element text
rather than by pixel - `adb shell uiautomator dump` exposes the whole web page as an accessibility tree (run adb
from Git Bash with `MSYS_NO_PATHCONV=1`, or `/sdcard/...` becomes a Windows path).

**The app draws under the system bars** (v1.15.0), so the page's own background reaches them and they take the
colour of the screen you're on - cream on Modes, navy on the play screen, black on the Leaderboard - instead of a
cream frame around a dark page. Three pieces: `tools/app/build-app.mjs` swaps in `viewport-fit=cover` (asserted, and
only for the app - the same tag on the website would push the page under an iPhone's notch for no gain); the
stylesheet names the insets once on the root (`--sa-top` and friends, from `env(safe-area-inset-*)`, 0 in every
browser that isn't drawing under anything) and every edge-anchored rule reads them - the page gutter, the draft's
sticky bar in both its sizes, the rules dialog, the report sheet, the Players bar, the shop's case; and
`followSystemBars` (app-shell.mjs) flips the bars' icons from the colour the root is painted, which Android names
backwards - "DARK" means a dark screen, so it draws light icons. Naming the insets also means a browser can be told
to pretend it has them, which is how the layout was measured without a device: set `--sa-top` on `.ps` and the app's
spacing appears on a desktop. **Capacitor only passes the insets through on WebView 140+**; on anything older it
keeps the web view inside the bars instead, which is exactly how this looked before, so nothing breaks - the
emulator ran it both ways (133 from the factory image, then 151 once Play updated it).

The emulator to use is the Play Store image (`gridspin-play`, `system-images;android-36;google_apis_playstore;x86_64`):
signing into Play there lets it update Android System WebView past 140, which is what makes the edge-to-edge half
visible. Give the AVD `hw.gpu.enabled=yes` and `hw.gpu.mode=host` and launch with `-gpu host` - the config
avdmanager writes has the GPU off, which makes the whole thing crawl. If its window opens off-screen (it did once),
move it with a Win32 `MoveWindow` on the `qemu-system-x86_64` process's main window.

**Not done yet**: no release signing key, nothing on Google Play (the owner has no Play Console account yet), and
the app has never run on a real phone. Coin packs are planned as in-app purchases once the app exists - see the
owner's plan, not this repo.

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
# then serve public/ as the web root (.claude/launch.json's "static" config) and open /page.html - its
# asset paths are root-relative (challenge links live at /c/CODE), so opening the file directly is blank

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
# zoom and overlapping controls. Harness query params: as=player|admin|guest|newbie, howto=1, and
# screen=profile&fixture=veteran|rookie|photo&owner=1 (plus status=, moderator=N, name=, and frame=,
# card=, title=, coins= to dress the card) for the profile screen on its own with
# tests/fixtures/profile-fixture.mjs data; screen=shop&coins=N (ShopScreen on the mock), screen=cosmetics
# [&team=KC|all] (every frame, card theme, title and pack) and screen=picker&owned=sideline,... (the picker).
node tools/ui-harness/build.mjs   # bundle the harness into build/ui-harness.js (never shipped)
node tools/ui-harness/audit.mjs --as player --width 375 --tab Leaderboard --out build/ui-audit
# For a change's final check, still click through the real staging site at desktop and mobile widths.
node tests/test-theme-contrast.mjs  # every text color in every theme scope is readable (WCAG AA) - see Design system
node tests/test-result-moments.mjs  # record-first result: per-season rank, upset/streak moments, black Leaderboard, Share
node tests/test-sou-leave.mjs       # Over/Under can't be replayed or left running: leaving/reloading mid-round is a miss
node tests/test-sim-engine-independence.mjs  # the season sim rolls identically in every JS engine; pins a 2,000-season checksum
node tests/test-build-seo.mjs      # runs build.mjs for production and staging: canonical, noindex, robots.txt, sitemap, structured data
node tests/test-share.mjs          # the spoiler-free share card, challenge links in and out, and the challenge card on Modes
node tests/test-site-pages.mjs     # /how-to-play and /leaderboard: the addresses, the footer links, and the rules matching site-pages.mjs
node tests/test-app-shell.mjs      # the Android app: Back closes a dialog, then leaves a screen, then the app; the share sheet's AbortError
node tests/test-pwa.mjs            # installable and offline: what the service worker stores and never stores, the build's stamp, the install offer

# Profiles (v1.11.0). The SQL ones run the real migrations in PGlite through tests/pg-fixture.mjs (a
# Supabase-like database: anon/authenticated roles, auth.uid(), a storage schema) and compare against the mock.
node tests/test-player-stats-sql.mjs   # player_stats SQL == tests/mock-profile-stats.mjs for every account
node tests/test-badges.mjs             # every badge below/at/above its threshold; topBadges order
node tests/test-profile-data.mjs       # profile_details/storage rules, save_profile/set_avatar/player_profile, storage-profile.js
node tests/test-word-filter.mjs        # the blocked-word filter in SQL and the mock agree; no real player name is blocked
node tests/test-moderation.mjs         # reports, limits, moderator actions and rename; mock == SQL; the report sheet and queue
node tests/test-profile-security.mjs   # attacks a modified browser could try, each asserted blocked
node tests/test-profile-screen.mjs     # ProfileScreen on its own: owner/visitor/guest, sections, editor
node tests/test-avatar-picker.mjs      # the picker's tabs, presets, errors (jsdom)
node tests/test-avatar-image.mjs       # crop/resize/encode and metadata stripping - needs the installed Chrome (CHROME_PATH overrides)
node tests/test-profile-links.mjs      # /u/name addresses, Back/Forward, every name link, signup's username check
node tests/test-signin-google.mjs      # signing in with Google: the name it has to pick first, what's refused, and the account it ends up with
node tests/test-guest-accounts.mjs     # guests: a finished season posts without an account, the daily and shop are refused, and keeping the seasons
node tests/test-a11y.mjs           # axe-core over every screen in the installed Chrome; and that a roster chip names its slot, which axe can't see

# 1v1 (v1.19.0). See VERSUS.md. versus-logic.mjs holds the rules, so most of these need no database and no browser.
node tests/test-versus-pool.mjs        # the defense/kicker data: one of each per team-season, on the players' scale, seasons pinned by hand
node tests/test-versus-boards.mjs      # the board's three pools, what fits where, a board that can't serve both players, whole matches played out
node tests/test-versus-rules.mjs       # every refusal decideMove makes, then a match to the end with all four powerups spent
node tests/test-versus-sql.mjs         # the migration in PGlite: nobody writes the tables, lobbies, invites, match_state's shape, the 1v1 board
node tests/test-versus-flow.mjs        # a whole match through the mock client: create, join, the clock, the records, the share card
node tests/test-versus-screen.mjs      # the screens in the real app: the tile, the lobby's link, a shared board, a re-spin, the board

# Coins and the shop (v1.12.0). The SQL ones run the real migrations in PGlite and compare against the mock too.
node tests/test-rewards.mjs            # every coin rule and line, the starting balance, badge rewards
node tests/test-wallet-sql.mjs         # wallet functions, the daily cap, duplicates, welcome trigger, backfill; SQL == mock
node tests/test-submit-coins.mjs       # the mock submit-run: coins, badges once, a draft counts once, the cap, failed saves
node tests/test-shop-sql.mjs           # shop_state/shop_buy/equip_item/set_showcase and paid avatar packs; SQL == mock
node tests/test-economy-security.mjs   # attacks on coins and purchases a modified browser could try; the economy's numbers
node tests/test-cosmetics.mjs          # every frame, card theme and title renders; text contrast on every theme and team
node tests/test-shop-screen.mjs        # ShopScreen on its own: buying, equipping, locked items, showcase, the wallet
node tests/test-shop-flow.mjs          # the whole app: a season's coins, the shop from the result, a frame in the header
node tests/run-all.mjs [filter...]     # every test file above in turn (not the difficulty benchmark)

# Rebuild the game data from source (only when adding a season or changing grading)
cd scripts && python3 build.py && python3 correct.py && python3 rate2.py \
  && python3 boards.py && python3 export.py   # writes data.json
```

`npm test` runs the accounts/daily/nav suite; `node tests/run-all.mjs` runs every test file one at a
time (they share build/test-component.mjs, so never in parallel). There is no single-test flag — each
`tests/*.mjs` file is a standalone script that exits non-zero on failure.

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
`perfect-season.jsx` or any screen file. `getClient`, the read-retry option and the profile row mapping
live in `storage-core.js`; a feature's own module (`storage-profile.js`, `storage-moderation.js`,
`storage-shop.js`) imports from there and `storage.js` re-exports it, so the app still imports everything from
`./storage.js`. Personal-key reads/writes still go through `sget`/`sset`/`sdel`/
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
UI but skips the optimistic stats update and surfaces the existing `saveError` panel. Since v1.12.0
submit-run also refuses a finished draft it has already counted - a Daily once per date and format as
before, a challenge code once per account through `finished_codes` - answering 409 with `reason:
"duplicate"`, which the result screen shows instead of `saveError`; then it pays the season's coins and any
badges (see "Coins and the shop" below). **Known,
accepted gap**: Unlimited/challenge-code mode's seed is still client-chosen (`mode.code`), so
grinding many codes offline for a lucky *legitimate* outcome remains possible — closing that needs
server-issued/committed seeds, a bigger lift (network round-trip at draft start, rate-limiting),
not attempted here. `sou_runs` (Stats O/U) and `builds` (Build-a-player) remain client-writable —
lower-stakes minigames, not roster-scoring, a candidate for a later pass — but since v1.11.0 triggers
(`migration-profiles.sql`) set their `username` from the account (every name on those boards opens a
profile, so it can't be spoofed) and refuse a build with a made-up position or a non-finite overall (one
NaN build used to crash the Stats screen for everyone). Since
v1.11.0 there's one more writer of `profiles`, and only of `username`: a moderator's rename (`mod_act`
in `migration-moderation.sql`), which rewrites the username snapshots in `runs`, `daily_runs`,
`sou_runs` and `builds` too. submit-run's `profileToRow` never writes `username`, so the two can't
overwrite each other.

**Profiles (v1.11.0) - the rules that matter most; `PROFILES.md` has everything else.**
- **Writes only through security-definer functions.** `profile_details` (bio, picture, default avatar,
  favorite team), `reports`, `moderators`, `blocked_words`, `site_flags` and `avatar_presets` have RLS on
  and no client write policy. Players change their own row only through `save_profile`/`set_avatar` (and since
  v1.12.0 `equip_item`/`set_showcase` for what the card wears, SHOP.md);
  reports and moderator actions only through `report_player`/`mod_act`. Those functions are the
  security boundary - a modified browser can call them directly - so every limit and the word filter
  live in SQL, and the browser's checks exist only for friendlier messages. `blocked_words` isn't
  readable by clients at all, and `text_is_clean` isn't callable by them.
- **The word filter** (`text_is_clean`) checks bios, new usernames (the signup trigger, plus
  `check_username` for a friendly message first) and moderator renames. Its matching rules are in
  PROFILES.md 3.4 and migration-profiles.sql. `tests/test-word-filter.mjs` requires every player name in
  `data/players.json` to pass - add a word only with `insert into blocked_words`, and run that test.
- **Pictures** are a public Storage bucket, `avatars`: each player writes only under their own
  `<user id>/` folder, with exactly the name `<user id>/<ms>.<ext>` and at most 10 files there (so a script
  can't fill the bucket); the bucket caps size (256 KB) and type (WebP/JPEG/PNG), and every upload gets a
  new name (`profile-rules.mjs`'s `avatarObjectPath`) so no cache shows an old picture. The browser crops
  to 256×256 and strips all metadata (`avatar-image.mjs` - Chrome writes a color profile even into a
  canvas export, so redrawing alone isn't enough).
- **Badges are computed, never stored** (`badges.mjs`, pure, no app imports - submit-run imports it too,
  and `badge_awards` records only which badges have been paid). Every condition only becomes true over time, except Loyal Fan, which
  follows the current favorite team. `CINDERELLA_MAX_SCORE` and `SCOUT_MIN_POINTS` were calibrated by
  simulating drafts; re-run that reasoning (see the comments) if grading or `SPREAD` changes.
- **`player_stats(user_id)`** lives in `migration-runs-log.sql` beside `site_stats`, mirrored by
  `tests/mock-profile-stats.mjs` and checked by `tests/test-player-stats-sql.mjs` - change both together,
  keep orders fully tiebroken, and remember a day's Daily ranks only count once the day is over
  everywhere (two UTC days later).
- **Addresses:** a profile is `/u/<username>` (`profilePath`/`parseProfilePath`), the Leaderboard is
  `/leaderboard` and the rules `/how-to-play` (v1.14.0, see "Pages of their own"), every other screen is
  `/`, and opening a profile pushes a history entry so Back returns to the screen it came from.
  `vercel.json` rewrites `/u/:name` to the page with `X-Robots-Tag: noindex`.
- **Runbook** (SQL editor): make someone a moderator -
  `insert into moderators (user_id) select id from profiles where username = 'NAME';`. Pause all new
  picture uploads - `update site_flags set enabled = true where key = 'uploads_paused';` (false resumes).
  Block a word - `insert into blocked_words (word, match) values ('word', 'word');` ('anywhere' only for
  strings that never occur inside ordinary words or names). Everything else a moderator needs (remove a
  picture, clear a bio, rename a player, dismiss) is in the app's Reports queue.

**Coins and the shop (v1.12.0) - the rules that matter most; `SHOP.md` has everything else.**
- **Coins only move inside the database.** `wallets`, `wallet_ledger`, `badge_awards`, `finished_codes` and
  `inventory` aren't readable or writable by clients at all. Seasons and badges are paid only by submit-run's
  service role (`credit_coins`, `award_badges`); a player reads through `wallet_state`/`shop_state`, claims
  minigame coins through `claim_minigame` and spends only through `shop_buy`. Every movement is a ledger row
  under a unique (user, kind, ref), so the same season, badge, day's minigame or purchase can't happen twice,
  and a wallet's balance can't go below zero (a check constraint, not app code).
- **The wallet lock.** Every function that moves coins or decides something on a balance calls `wallet_lock`
  first, before it touches the ledger, so simultaneous purchases and credits take turns and can't deadlock.
  The read-only `wallet_state` and `shop_state` don't lock: they're called as GET, which PostgREST runs
  read-only.
- **Amounts live in `rewards.mjs`** (`COIN_RULES`), which submit-run and the browser share. The three things the
  database pays by itself - 250 welcome coins (the `profiles_create_wallet` trigger), 15 per minigame, and the
  one-time starting balance at the bottom of `migration-wallet.sql` - are copies that `tests/test-wallet-sql.mjs`
  holds to it. Prices, rarities and what's on sale are `shop_items` rows; names and looks live in the browser
  (`shop-catalog.mjs`, `cosmetics.jsx`).
- **A finished draft counts once.** submit-run inserts `finished_codes (user, code)` before any other write: one
  finished season per account per challenge code, in any variant or format. If the profile update then fails it
  gives that row back (or a Daily's `daily_runs` row), so a retry counts. Grinding fresh codes for a lucky outcome
  is still the known gap above; only 20 Unlimited, Genius and GM seasons pay coins per UTC day.
- **Minigame coins count the player's own days.** The app sends `claim_minigame` the game's day in the player's
  calendar (Over/Under's date, or today for a build), which must be UTC yesterday, today or tomorrow; the ledger key
  is `<game>:<day>`. Keyed by the UTC date instead, two evenings' games either side of UTC midnight (8pm on the US
  east coast) shared a key and the second paid nothing.
- **Accepted gaps, priced by `tests/test-economy-security.mjs`** (which prints them): the minigames are
  browser-written, so `claim_minigame` pays 15 a game day per game to anyone with the row (an Over/Under row for the
  day, or a build from the last 24 hours) - 30 coins a day without playing (up to 90 at once, claiming the three days a
  time zone could call today), no more than an honest player over time - and their badges (Stat
  Nerd, Mad Scientist) pay nothing; the Genius flag is the client's word (Big Brain, the Genius ladder); and codes
  are the client's choice, so searching codes offline for 20-0 seasons tops out around 7,000 coins a day. Closed in
  v1.12.0: submit-run refuses a GM season over the cap, ignores GM/Genius flags on a Daily, and `replayDraft`
  refuses a trace that walks past a board it could pick from without re-spinning (cherry-picking the best six of
  eighteen boards - on a Daily, better than any draft the app allows).
- **Badge items** (Undefeated frame and title, Dynasty card, Daily Winner and Cinderella titles) belong to whoever
  has the badge in `badge_awards`, which submit-run fills as it pays - so an item unlocks with the first finished
  season after its badge is earned.
- **Card themes set the card's text scope.** `CardTheme` adds `cs-dark`, `cs-night` or `cs-light`, which
  perfect-season.jsx maps to theme.mjs's scopes; each theme's painted colors are data in `cosmetics.jsx`, so
  `tests/test-cosmetics.mjs` can hold its text to WCAG AA, for all 32 teams on Team colors.
- **Runbook** (SQL editor): change a price - `update shop_items set price = 1500 where id = 'frame-lime';`; take an
  item off sale (owners keep it) - `update shop_items set active = false where id = 'frame-lime';`; give an item
  (a pack included) to everyone - `update shop_items set rarity = 'free', price = null where id = 'pack-sideline';` -
  since a pack's avatars follow its shop item everywhere (`shop_state`, `set_avatar`, the picker). The seeds in
  `migration-shop.sql` only add missing rows, so these survive a re-run - edit the seed too for new databases.
- **Cosmetic artwork uses fixed colors**, like the avatar drawings: frame and card-theme paints are data in
  `cosmetics.jsx` (`COLORS`), not theme tokens, because an item looks the same wherever it's worn. Text on a card
  still takes its scope's tokens, and `tests/test-cosmetics.mjs` checks those against every paint behind text.

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
side effect in `finish()` (stats, leaderboard, daily storage) — a forced Unlimited ending does clear its saved draft, so it can't resurface or be charged as a DNF later — use this account to check
win/loss animations instead of fighting the RNG or hand-rolling a fixture. The panel is gated only in the
browser, by name, so it must never gain anything that writes real data. Since 1.11.1 the name is reserved:
once an account holds `admin`, no other capitalization can sign up with it or be renamed to it
(`username_is_reserved` in `migration-profiles.sql`). On production the owner holds `admin`, which is also
the site's moderator; on a fresh database (tests, staging) the first account to take it keeps it.

## Design system

The look is "playful sports app + premium streetwear": a cream foundation, ink type, electric lime
used sparingly, the Anton display face with Inter for body copy, tactile buttons with a hard offset
shadow, and navy "scoreboard" moments.

- **Tokens live in `theme.mjs`**, as data with three scopes (light, dark, night), and
  `perfect-season.jsx` turns them into CSS variables. Don't hardcode colors in the stylesheet; add a
  token to every scope (a test fails if the scopes' token sets differ).
- **Lime is a fill, never text on cream.** `--accent` is lime and only goes behind `--on-accent`
  text. For accent-colored words, links or underlines use `--accent-ink`: game blue on cream, lime
  only in the dark scope. Lime on cream is ~1.2:1. `tests/test-theme-contrast.mjs` enforces WCAG AA
  for every text token in both scopes.
- **Where the dark scope applies:** the whole play screen (the root gets `.dark` when
  `view === "play"`), plus components that are stadium-dark wherever they appear — `.reel`,
  `.sticky`, `.result-hero`, `.champion`, `.pg`, `.pre`, `.cel`, and the Unlimited tile. The
  Leaderboard is the exception: the root gets `.night` when `view === "board"`, a true-black third
  scope (its `.champion` takes night tokens too) with lime reserved for #1 and your own row. The
  profile's player card takes the scope of the card theme it wears, wherever it appears (cosmetics.jsx's
  `CardTheme`: `cs-dark` for the default Navy, `cs-night` or `cs-light` for others). Everything else is
  cream (the report sheet forces cream tokens even when it opens over a dark card). Every scope in `theme.mjs`
  must define the same tokens; the contrast test checks all.
- **Screens in their own files** (`profile.jsx`, `avatars.jsx`, `avatar-picker.jsx`, `moderation.jsx`,
  `cosmetics.jsx`, `shop.jsx`) export their stylesheet as a string (`PROFILE_CSS`, ...), which
  `perfect-season.jsx` appends after its own as `APP_CSS` (`COSMETICS_CSS` after `PROFILE_CSS`: its themes
  win by source order). Each styles only its own class prefix (`pf-`, `av-`, `ap-`, `md-`, `cs-`, `sh-`) and reuses the
  app's `.btn`, `.tile`, `.h`, `.note`, `.panel` etc. without restyling them, and puts its responsive,
  `pointer:coarse` and reduced-motion rules in its own string after its base rules.
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
  - `supabase/functions/submit-run`, or any module it bundles - `game-logic.mjs`, `data/players.json`, and since
    v1.12.0 `rewards.mjs`, `badges.mjs` and `profile-rules.mjs` (a badge or coin-rule change the browser shows but
    the function doesn't pay is the failure) → `npm run deploy:fn:staging`, then
    `npm run deploy:fn:prod` after promoting (needs `STAGING_PROJECT_REF` / `PROD_PROJECT_REF`).
  - `supabase/functions/match-pick`, or any module it bundles - **`versus-logic.mjs`**, `game-logic.mjs`,
    `data/versus-pool.json` and `data/players.json`. `versus-logic.mjs` is the one to watch, because it holds
    every rule 1v1 has and the browser imports it too: change it, push the client, and forget the function, and
    the two are running different rulebooks. That exact miss cost a staging session in v1.19.0 - the client
    offered a powerup the deployed function still refused as "not your turn". `node deploy-function.mjs <env>`
    deploys both functions by default for this reason; there is no good argument for deploying one.
  - A schema change → run its migration in that environment's SQL editor first.

  Order is always migration → Edge Function → client. Reversing it corrupts data; see the
  deploy-ordering note in `supabase/migration-scoring-formats.sql` for the specific mechanism.
  v1.11.0's migrations go in this order: re-run `migration-runs-log.sql` (adds `player_stats`), then
  `migration-profiles.sql`, then `migration-moderation.sql`. All three only add objects, so the live
  site keeps working between them. v1.12.0's: `migration-wallet.sql`, then `migration-shop.sql`, then
  re-run `migration-profiles.sql` (its `set_avatar` learns the paid packs), then deploy submit-run, then
  the client. The new submit-run needs `migration-wallet.sql` first - without `finished_codes` every
  Unlimited, Genius and GM season fails to save. v1.13.0's (four titles, two avatar packs): re-run
  `migration-shop.sql`, then the client; submit-run doesn't change. New shop items always ship that way - the seed
  adds missing rows - and a new pack's avatars need their drawings in `avatars.jsx` in the same release.
  v1.16.0's (signing in with Google): re-run `migration-profiles.sql` (it relaxes the signup trigger and adds
  `claim_username`), switch the Google provider on in that environment's Supabase project, then the client;
  submit-run doesn't change. v1.17.0's (guests) does: re-run `migration-profiles.sql` (the `guest` column,
  `new_guest_name`, and claim_username's trade-up), turn on anonymous sign-ins in that project, **then deploy
  submit-run** (it refuses a guest's daily), then the client.
  v1.19.0's (1v1): run `migration-versus.sql`, then **deploy the Edge Functions** (`node deploy-function.mjs <env>`
  now deploys both - submit-run and match-pick share game-logic.mjs and data/players.json, so deploying one of a
  pair is the drift this section warns about), then the client. The migration only adds objects, so the live site
  keeps working between the steps; nothing in it touches an existing table except two new `profiles` columns.
  **It has to be re-run on staging**, which already has the step-one version: the review pass added `finish_match`,
  a `match_picks_one_per_slot` constraint and a tighter select policy on `matches`, and the later columns and
  constraints are all written as `add column if not exists` / a guarded `do $$` block for exactly that reason.
  **Any match in flight has to be abandoned first** (`update matches set status = 'abandoned' where status =
  'drafting';`) - who leads which board is now seeded on the match code, so a match already under way would
  replay to a different board order than it was drafted from.
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
switching Unlimited/Genius/GM or scoring format, or entering a code abandons it as a DNF - charged to
the saved draft's own ladder, and for a no-pick draft only if this account dealt it (`chargeableDraft`;
a guest's board isn't charged to the account they create). Run it back after a daily and Play an unlimited
draft resume whatever is in the Unlimited slot (`resumeFree`); the Unlimited tile and Start my season
resume it in any variant when it is in the selected scoring format (`playUnlimited`) - switching the
format first still asks for a new draft - and taking a challenge link selects the link's format. `restoreDraft` stops any reel still
spinning first, or the other draft's interval would overwrite the restored board. Before
1.8.1 a no-pick draft didn't count, which made looking at the first board and leaving a free redo.

**Stat columns follow one shape at every position:** main-role yards, TDs, per-attempt average,
volume, secondary role, fumbles.

**Data provenance matters.** Player stats come from nflverse play-by-play (1999-2025), corrected
against Pro Football Reference season totals for 1999-2020 (~1,100 seasons fixed, including the
badly broken 2001-02 Jaguars). Opponents come from real team-seasons rated by point differential.
Don't hand-edit `data.json`; change the scripts and regenerate.

## Immediate Next Goals

1. **Housekeeping** — 2026 season data once it's played. The accessibility pass landed in v1.18.0: every screen
   is clean under axe-core (`tests/test-a11y.mjs` keeps it that way), the app has a `main` landmark and a skip
   link, every screen names itself with an `h1` (visually hidden where the design shows a logo instead), table
   headers say what their column is, the profile's wide table can be scrolled from a keyboard, all three dialogs
   keep Tab inside them (`keepFocusInside` in ui-common.jsx), and a roster chip names the slot its colour stands
   for - colour is never the only thing carrying meaning. Separate indexable pages shipped in v1.14.0, a third in
   v1.17.0; more of them (each scoring format's leaderboard, a Daily archive) is the obvious next step if search
   traffic matters.
2. **Half-PPR**, if wanted, is now a small change rather than a blocked one — see the scoring-format
   note in Architecture. It needs a third `FORMATS` entry, a benchmark column, a `BEST_FIELDS`
   entry, and two `profiles` columns; no data regeneration.

**Done:** **Profiles** (v1.11.0, `PROFILES.md`) and **Coins and the shop** (v1.12.0, `SHOP.md`). Before
those, the game became a real public product, not a local-only demo. Accounts/stats/leaderboard
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
