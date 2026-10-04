# Handoff — 2026-09-30 (second session, after v2.18.2)

Working notes for the next session. Not a contract document; delete it once absorbed.
`CLAUDE.md` remains the authority on how this repo works — read it first, this only says where things
stand and what is still open.

Everything below marked **verified** was checked by running something during the session that wrote
this, not recalled.

---

## 1. Where things stand

**Production runs 2.21.1. Staging is AHEAD of it** - the film work (the three TikTok cuts, the Guess grid
fix, the Century pick order) is on `staging` and has never been promoted, because none of it is served to
the site: `build.mjs` copies only `static/` into `public/`, so nothing under `tools/film/` can reach a
visitor. That is why it carries no version and no changelog entry, which matches how the first film commit
(`f0b171d`) was handled. Promote it whenever; nothing waits on it.

**The home pill counts PLAYERS DRAFTED, not plays** (v2.21.1) - the owner's call, once the site started
being sent strangers. It ticks six at a time because that is what a season drafts, and a mini-game no
longer moves it at all. The guard is sharper than the one it replaced: a single finished season moves the
Stats Drafts tile by ONE and the pill by SIX, so a change collapsing the two counts cannot pass.

**There are NINE 9:16 films** as of v2.21.2 - the four below plus five built on a shared kit:
`tiktok-genius.html` (no stats, 20-0 on code `4CMJAAAA`), `tiktok-gm.html` (a $150M cap spent to the
dollar, `MEGAAAAA`), `tiktok-bears.html` (CHI|0, four QBs, 38 TD and 37 INT, code **`RUSH`**),
`tiktok-ou.html` (Brady, 28,677 across six boards, over/under 30,000) and `tiktok-duel.html` (a steal
on `DUEL2026`, replayed to sixteen picks with `missing: 0`). **Four of the five point at modes a
signed-out visitor can actually play** - season drafts and Over/Under - which the Guess and Century
films do not.

**`tools/film/kit.css` and `kit.js` are the shared half** (stage, safe area, crossfade, close card,
palette, brand mark, licence credit, driver). A film on the kit supplies only its scenes, its beats and
a `render(t)`. The three POSTED films deliberately do not use it - delivered work should not move when
film ten is edited. Three API shapes cost a correction each and are worth knowing: the duel clock needs
`move.claim === "clock"`, `replayMatch` wants the DATABASE row shape (`pickId` reads `p.playerId`), and
a steal row is keyed `by`, not `side` - with `side` the steal is accepted and then silently dropped.

**There are FOUR 9:16 films**, all 1080x1920, 15.000s, 900 frames, SILENT so a trending sound can go over
them. Three are current: `tools/film/tiktok-spin.html` (a joke - one QB on the Packers board, four on the
Browns board, every one a D), `tiktok-guess.html` (tension - a grid narrowing onto Lamar Jackson) and
`tiktok-century.html` (withhold-then-dump - seven stars drafted blind, revealed at 99 of 100). The fourth
is `tiktok-ad.html`, the original cut, which is still `overlap.mjs`'s DEFAULT `--film` and whose credit
sits outside `.stage` behind `body.render .credit{display:none}` - so unlike the other three its MP4
carries no attribution at all. A list that says "three" misses the one the tooling points at by default.
Every figure in all of them was replayed through the function the Edge Function itself runs.

**Only `DELI` is a code anyone can type.** It deals the Browns 2011-2015 board as a season draft, through
the Challenge code box on Modes, and it was brute-forced out of all 1.68M four-character codes for exactly
that reason. **`F0M2MVJJ` is NOT the same kind of thing and must not be put in a caption**: Century has no
code box at all - `century.jsx` contains no `<input>` - so typing it into the one box that exists starts a
different game entirely, a six-board season draft from that seed. Its only real door is
`/c/F0M2MVJJ?mode=century`, a query string, which is unusable as spoken or typed attribution. Treat it as
the seed that reproduces the film, not as a code to hand an audience.

**gridspin.app counts page views now** (v2.21.0), and `/privacy` changed in the same deployment to say so -
the old "no analytics" promise is gone, replaced by what is true: no cookie, a visitor identified by a hash
of the request discarded daily. `/privacy` and `/terms` carry no counter at all, and that is checked in the
BUILT html by tests/test-build-seo.mjs. Vercel > the project > Analytics is where the numbers are.

**The CAPTCHA is LIVE ON BOTH.** Proven end to end on each: a real person's
sign-in passes the challenge, and a tokenless request is refused on `/recover`, `/token` and `/signup` -
the last being the anonymous sign-in `postAsGuest` makes, which is the whole point of the exercise.

**Both environments are done.** Each has its own widget, its own key pair, and its own enforcement. What is
left: **nobody has played a signed-out season on production and watched it post as `Guest_XXXXX`** - the
exact flow this was built to protect, and the one whose failure is silent. And Turnstile's analytics are
worth a look in a few days: invisible mode refuses a doubted browser outright, so a steady refusal rate
means real people are being turned away and the fix is client work in `captcha.mjs`, not a dashboard.

**An agent can no longer sign in to either environment** - Turnstile answers `600010` to an automated
browser and invisible mode offers no checkbox. Signed-in flows have to go through `tools/ui-harness` (same
bundle, in-memory mock, no auth) or the owner. The jsdom suite is unaffected.

Two things the rollout found that the docs did not say. The widget mode must be **Invisible**: in Managed
mode a doubted visitor gets a checkbox, and `captcha.mjs` renders off-screen at `left:-9999px`, so it was
unreachable and the call hung for the full 8s. And the Supabase setting has MOVED - it is Authentication >
Attack Protection (`/project/<ref>/auth/protection`), while Supabase's own docs still name a path that 301s
to Sign In / Providers, where there is no toggle at all.

| | |
|---|---|
| `package.json` | `2.21.1` |
| Production - `www.gridspin.app` | **2.21.1** |
| Staging | **2.21.1** |
| `master` head | `706a440` |
| `v2.21.1` tag | `6445a36` - the release commit, NOT a staging head |
| `staging` head | ahead of master by the film commits; `git log master..staging` is the live answer |

## The release-readiness list

A four-lens audit (abuse/economy, operations, first-run experience, legal/store) asked whether the game is
ready to ship as a FINISHED product. It is not, and the reason is not the code: **in 18 days live there were
15 accounts and 181 runs**, and Guess the Player had been played three times ever. Everything that makes a
product "finished" - balance, retention, what confuses a stranger, what breaks under load - is unmeasured.
Treat it as a soft launch and get fifty strangers on it.

The audit proposed 11 ship blockers; refute-by-default verification cut it to 2, and I re-checked both
myself. The ordered shortlist, cheapest first:

1. ~~**Error boundary + crash reporting**~~ - **DONE, v2.19.0.** `error-boundary.jsx`, imports nothing but
   React. versus.jsx had recorded a real blank-page crash in production since the duel release.
2. ~~**Password reset**~~ - **DONE, v2.19.1 + v2.19.2.** There was no way back at all; `resetPasswordForEmail`
   appeared nowhere in the repo.
3. ~~**Terms of Service**~~ - **DONE, v2.19.3.** `/terms` was a live 404. Built like `/privacy`
   (`standalone`, no bundle, reads with JavaScript off). It is also what lets moderation BAN at all - there
   was no document to ban anyone under. Governed by Tennessee law; `TERMS_STATE` is gated so the suite fails
   if it is ever emptied. The privacy policy said under-13 and the terms say 16, so both now read one shared
   `TERMS_AGE` and a test fails if either disagrees.
4. ~~**Account deletion and the CAPTCHA**~~ - **BOTH DONE.** Deletion in v2.20.0 (`Close my account`;
   PROFILES.md 11 is the email runbook; it anonymises, and `migration-profiles.sql` says why in three
   measured reasons). The anti-robot check's CLIENT half in v2.20.1 - `captcha.mjs`, Cloudflare Turnstile.

   **The CAPTCHA is not switched on, and turning it on is four steps in one order** (CLAUDE.md's v2.20.1
   entry). Supabase's setting is per project and covers sign-in, sign-up, password reset and the anonymous
   sign-in together, so: ship the client (done, inert) -> make a Turnstile widget -> set `CAPTCHA_SITE_KEY`
   in Vercel and redeploy -> only then enable it in the Supabase dashboard with the SECRET key. Doing the
   last before the third breaks every sign-in in that environment at once. **This part needs the owner**: it
   is a Cloudflare account and two dashboard settings, per environment.

Also worth knowing from the audit, verified: the live privacy policy says "there is no real money anywhere
in Gridspin" (site-pages.mjs:79) and "no adverts, no analytics and no trackers" (:158). Both are true today.
The first goes false the instant the supporter webhook exists; the second is why v2.19.0's crash reporting
is a **Copy** button and not a vendor.
## 2. What shipped this session

Six releases, 2.18.2 through 2.18.7. CHANGELOG.md has each in full; the shape of them:

**2.18.2** - the outbox stopped discarding a played daily on the one transient failure it was built to
survive. `network` was being used for both "a reason this client cannot read" and "a body with no reason
at all"; only the first is a verdict.

**2.18.3** - Century's and Guess's board names became real names. `NameLink` moved to `cosmetics.jsx`
and `OpenProfile` to `ui-common.jsx`, because a screen file may not import the main component back.
Plus ~70 stale doc counts and CLAUDE.md's runbook.

**2.18.4** - Back from a profile opened off those new links returned to Modes, not the board.
`HISTORY_VIEWS` never named `minigames`, `century` or `guess`, so `screenOf` threw the state away and
the popstate handler's own branches for them had been unreachable since v2.9.0.

**2.18.5** - the guest chip: the Reports queue linked a guest's name to a profile that refuses one, and
the Duels board was the only name site passing no `guest` prop. The chip's ink is now held to AA.

**2.18.6** - **a stranded GM season could not be saved after the app told the player how to finish it.**
The screen says "Re-spin for a board you can use"; `replayDraft` refused that exact re-spin and
submit-run answered 400. No retry could ever succeed. Reproduced with code `D073PL`.

**2.18.7** - **Build-a-player had paid no coins for a large part of every day since v2.17.0**, plus a
Daily tile that could deal the day twice and three ways a drained run did not settle like a played one.

**2.18.8** - **one character walked 14 of the 27 blocked words past the word filter.** The fold table
paired Cyrillic capital T and not lowercase t. Six rows gained their missing case counterpart; Greek
nu and upsilon stay unpaired, because their two cases look like different Latin letters. The check
that exists to hold the SQL and the mock together had let them drift - it built every probe from the
mock's table - and now reads both files.

---

## 3. Open items

### 3.1 ShrimpCity's lost daily — CLOSED by the owner. Do not re-raise it.

**Verified against production, then decided.** Her 2026-09-30 row now exists, created 08:26 UTC — but it
is a **replay**, not the lost run. Its guesses are
`["Justin Jefferson|2020|WR", "Jordan Addison|2023|WR"]`, byte-identical to Tacos2026's: solved in 2 by
somebody who already knew the answer. The real run took 4. The outbox cannot have produced it — a drain
re-sends the original four guesses.

`guess_runs_daily_once` is unique on `(day, user_id)`, so the slot is taken: correcting it would be an
**UPDATE moving her from 2 tries to 4 — worse on the board**, not a recovery. **The owner's call on
2026-09-30 was to leave it as it stands.** Nothing was written to production, and nothing should be.

The underlying fault is fixed and shipped (v2.18.2, section 2). What is left is the second-order gap
below, which is a code question rather than a data one.

### 3.2 The replay itself is a gap, now documented but not closed

A daily whose save fails leaves no server row, so `duplicate` has nothing to catch, and the `GUESS_DONE`
gate is per-device. Because the answer is already on screen, the replay scores **better**. Written up in
GUESS.md §5 alongside the client-computable-answer gap. Closing it needs the server to know a daily is
in flight before it is finished — a round trip at the start of every daily, judged out of proportion.

### 3.3 The guest chip is done, and here is the map it produced

Closed in v2.18.5. Verified on production's Leaderboard (7 chips against 21 links, none nested) and on
staging's Century all-time board by playing a guest run end to end.

Worth keeping, because it took an audit to establish: **the chip is LIVE on 14 boards and DEFENSIVE on
8.** Live - the Leaderboard's best-ever card and Top 10 in Every mode / Unlimited / Genius / GM, those
three points ladders, Stats' best lineups, best GM score, biggest upsets, career wins, championships,
playoff runs, best win %, highest-OVR build, the Over/Under daily board, and Century's all-time board.
Defensive (cannot render today) - today's daily board, the Daily ladder and Top 10, longest daily
streak, Century's today board, both Guess boards, and the duel board. None of that should be deleted;
most of it is one product decision away from being live.

Two shapes to remember. `century_best` has no day filter, which is why a guest's **Unlimited** run
reaches it - the only mini-game board one can. And `guess_best` computes the flag with `bool_or` and
then throws the group away in its `having`, so dropping that clause (if a practice board is ever added,
GUESS.md 9) turns invisible guest rows visible as a side effect.

### 3.4 The guaranteed 20-0 — ACCEPTED by the owner. Do not re-raise it.

A team score of 142 beats every opponent outright: the strongest is rated 122, `SPREAD` is 20, so
`winProb(142, 122)` is exactly 1 and the season is not simulated. The arithmetic ceiling is
`(1.25·130 + 3·130 + 2·flexCap())/6.25` = **143.69**, above it, so a legal draft on a findable
challenge code is a *certain* perfect season in both formats. Verified end to end: `TL8G97` 143.51,
`EZPVIR` 143.39, `NKMX3M` 142.83 Championship / 142.26 Fantasy — all replay as legal, none reserved,
all "Perfect season. 20–0." About 7 codes in 200,000.

Closing it means lowering the Flex ceiling below **167.5**, which changes recorded scores for exactly
five player-seasons — LaDainian Tomlinson 2006, Christian McCaffrey 2019, Marshall Faulk 2000 — costing
a roster playing one ≤0.84 team-score points. Asked with those numbers on 2026-09-30, the owner chose
to leave it: it sits inside the "codes are the client's choice" gap CLAUDE.md already accepts and says
cannot be closed, and the prize is not worth changing five all-time grades for. **The guest daily DNF
that sat here was fixed in v2.18.6.**

### 3.5 `submit-run` and `match-pick` answer an unauthenticated POST with no `reason`

The two mini-game functions answer `{"error":"unauthorized","reason":"signed_out"}`; these two answer
`{"error":"unauthorized"}` with no reason at all. CLAUDE.md's rule is that a code the client does not
map reads as `network` - "check your connection", forever, for a rule rather than a fault - and a
missing reason is that hazard one step earlier. Nothing is broken today, because the app never routes a
signed-out player down those paths. Worth a pass.

### 3.6 `1.19.1` stays untagged, and `v2.12.0` sits on the wrong commit

`v1.16.0` was written this session. `1.19.1` is deliberately not tagged: its changelog heading reads
"unreleased" and it is the only one of the sixty-one version headings with no date, because it shipped
inside `2.0.0`. And `v2.12.0` points at a commit whose `package.json` reads `2.13.0` - `2.12.0` never
existed as a version, one commit wrote both headings. The tag is published, so it was left alone.
All three are footnoted at the top of CHANGELOG.md.

### 3.7 Smaller, all verified

- `PROFILES.md:404-408`'s `ui-common.jsx` export list was corrected to thirty, but these files drift by
  their nature - re-count rather than trust any list of exports in a document.
- **`tests/test-film.mjs` holds every value a film hand-copies** (v2.21.2): the palette against
  theme.mjs's dark scope, each inlined brand mark against `static/icon.svg` path by path, the credit
  against `DATA_CREDIT`, and `window.__seek`/`window.__duration` against what render.mjs needs. Text
  only - no Chrome, no ffmpeg - which is what lets it live in run-all.mjs. It finds films by reading
  the directory, never from a list, because a list is what went stale about the brand-mark census.
  Every assertion was mutation-tested. What it CANNOT see is layout: that is overlap.mjs, and
  ultimately a human looking at a frame - which is how all three Guess defects were actually found,
  after the measurements said the grid was fine.
- **`render.mjs` asks the film** (v2.21.2) for anything you leave off: `--seconds` from
  `window.__duration`, `--width`/`--height` from the `.stage` aspect-ratio read in a pre-flight load
  before render mode overrides it. Flags you DO pass are honoured unchanged. Before this, a 9:16 cut
  rendered with no flags came out 1920x1080 and 1800 frames, half of them copies of the frozen close
  card, and the banner said so in a line printed before any of it was known.
- `tools/film/overlap.mjs` measures `spin-an-era.html` now, but its FILLED list does not include that
  film's `.slot` and `.reel-item`, so a clean run there is weaker evidence than a clean run on the ad.
  Noted in its own header.
- The brand mark is **nine hand copies across eight files** - the v2.18.3 count of six-in-five predates
  `tiktok-spin.html`, `tiktok-guess.html` and `tiktok-century.html`, each of which inlines it again.
  CLAUDE.md's "Brand assets" paragraph still says six in five and is wrong by three. Every copy agrees
  with `static/icon.svg` character for character today, so nothing has drifted - the cost is entirely to
  whoever changes the artwork next and trusts the count instead of the grep. They agree today; `git ls-files -z | xargs -0 grep -l
  "M43.57 18.21"` lists them.

### 3.8 Marketing

The scored 15-second cut for Instagram/YouTube is still the open piece. The blocker is gone:
`tools/film/render.mjs` gained `--audio`, so a scored render is reproducible from the repo, and
`tools/film/score.mjs` synthesises the cue. The TikTok cut stays deliberately silent so a preloaded
TikTok track can go over it.

**ffmpeg is not on this machine's PATH** - only at the winget package path, version 9.0.2. `render.mjs`
finds it unaided, but a bare `ffmpeg ...` command pasted into a shell will not run as typed.

### 3.9 Nineteen findings from the second bug hunt, verified and NOT fixed

Found on 2026-09-30 by a five-finder sweep over the season path, duels, accounts and sessions, the
profile and shop, and the build/service-worker/app-shell layer. Every one was then attacked by a
separate agent told to refute it, and every one survived - which is the caveat, not the endorsement:
**across three verification passes this session, 38 of 38 findings were confirmed and none refuted.**
That is not a credible rate. Treat each of these as a strong lead with a written reproduction, and
re-verify before acting, the way the ones that WERE fixed were each re-verified by hand first.

**THREE of the four HIGH ones were fixed in v2.18.9 and v2.18.10** - the signed-out daily destroyed by
playing on, the daily draft inherited across a sign-out, and the second account locked out of the day.
What is left of that cluster is Over/Under's own done-record, which is the same shape and was not
touched. The note below is kept because it is the reasoning that decided how they were fixed.

The four HIGH ones shared a root worth naming: **per-device storage keys that should be per-account.**
`GUESS_DONE` and `CENTURY_DONE` were given a `userId` for exactly this reason (CLAUDE.md records the
leak), and `DAILY_KEY`, `FREE_PROGRESS`, `SOU_DONE_KEY` and `SOU_PROGRESS` never were - I confirmed
that directly, and that `logOut()` clears React state but no storage. The reason they were not fixed
here is that it is not a simple re-key: a signed-out visitor's draft and finished daily are MEANT to
survive into the account they then create, which is the whole of v1.17.0's guest flow. Re-keying by
account breaks that carry-over; clearing on sign-out does not, and is probably the shape - but it
wants deciding rather than patching, and any change needs a fallback for records already on players'
devices, the way `builds.day` got one.

- **[HIGH] A signed-out visitor's finished daily is silently thrown away by the next season they finish, and the day is burned**
  `perfect-season.jsx:3579`
  Signed out (no account at all), play today's daily to the end. finish() writes the day's record to the device and holds the trace in `pending` for the "Save this season" panel. Now tap "Run it back 🔁" — the button sitting directly under the record — which for a daily calls resumeFree() and deals an Unlimited draft. Finish that one. finish() runs `setPending(trace)` again, overwriting the daily's trace, and then postA
  *Fix:* Don't let a non-daily season evict a daily that is still owed. Either give the held daily its own slot (a second `pending` variable, or a Map keyed by `slotId(mode)`) so both are submitted when an account arrives, or refuse the overwrite when the held trace is

- **[HIGH] A daily draft in progress survives a sign-out, and the next account on the device resumes a stranger's picks**
  `perfect-season.jsx`
  Alice signs in, taps Fantasy daily and makes 3 picks, then logs out. Bob signs up on the same device, goes to Modes and taps Fantasy daily. He is dropped into "Pick 4 of 6" of Alice's daily draft with her three players already in his roster; if he plays it out, those six picks are handed in as Bob's daily run for the day, and Alice's daily is gone.
  *Fix:* Clear both daily slots in the SIGNED_OUT handler beside the free one (`clearDraftTracked("daily:fantasy", DAILY_PROGRESS(todayKey(), "fantasy"))` and the standard one), reset `wip` for them, and drop the on-screen draft when `mode.kind === "daily"` the same wa

- **[HIGH] The finished-daily record is keyed by device, so a second account on the device is locked out of that day's daily and shown the first account's lineup**
  `perfect-season.jsx`
  Alice finishes today's Fantasy daily. She logs out; Bob signs up on the same device. Bob's Modes screen shows the Fantasy daily as "See how it went", and tapping it shows "Today's Fantasy daily is done" with Alice's record, team score and full six-player roster. Bob has no board and no route to play the daily at all until the local date rolls over.
  *Fix:* Key it by account like the other two: `DAILY_KEY = (uid, d, f) => `ps-daily:${uid || "anon"}:${d}${fmtSuffix(f)}`` (and the same for DAILY_PROGRESS), re-read it in `readDay` when `userId` changes, and keep the old unsuffixed key readable for one release so a d

- **[HIGH] A daily finished while signed out is silently thrown away the moment the visitor plays anything else, and the device still records the day as spent**
  `perfect-season.jsx`
  A visitor who has never signed in taps Fantasy daily and plays it to the end. The season is held in `pending` and the result screen offers "Save this season". Instead of signing up they go back to Modes and play an Unlimited draft. `postAsGuest` takes a guest account for that second season - and the daily season is discarded: nothing in `daily_runs`, no `daily_last`, no streak. The player is now a guest, so the daily
  *Fix:* Do not let a second season overwrite a held one: keep `pending` as a short list, or refuse to replace a held DAILY trace. In `postAsGuest`, submit every held trace the new guest account is allowed to own, and - since a guest may not hold a daily - either do no

- **[MEDIUM] "Reset draft" silently drops GM/Genius and the scoring format the draft was being played in, and getting back costs a second DNF**
  `perfect-season.jsx:3740`
  In GM mode with one pick made, tap "Reset draft" twice. The new draft is a plain Unlimited draft: the 💼GM mode chip is gone and the salary-cap row disappears. Tap GM mode from Modes to get back where you were and openFree's sameVariant check fails against the plain draft it just made, so abandonCurrent charges a SECOND DNF — for a zero-pick draft the player never asked for. Genius is worse to look at: Reset from Geni
  *Fix:* Have resetDraft pass the draft's own variant, the way runItBack already does: `restart({ format: mode.format, gm: !!mode.gm, genius: !!mode.genius })`. Better, make restart read them itself rather than relying on every caller — `startDraft({ kind: "free", code

- **[FIXED in v2.18.12] One man can fill two slots of one duel roster; single player refuses this**
  *Reproduced and shipped.* 821 of 1,639 options are men on more than one board. `already_on_your_roster`.
  `versus-logic.mjs`
  Match code AAAHZU. Its eight boards include WAS|0 (board 0) and NYJ|1 (board 3), and Laveranues Coles (id 52) is on both — his best WAS 1999-2003 season (2003) and his best NYJ 2004-2008 season (2006). Driving decideMove exactly as supabase/functions/match-pick/index.ts does: the host locks Coles 2003 into WR at pick 1 and Coles 2006 into FLEX1 at pick 8. Both moves return ok:true, both rows are legal in match_picks 
  *Fix:* Key player identity for `taken`/`already_taken` on the man, not the man-and-season: keep `optionId` as the row identity the database needs, and add a separate person check in decideMove's pick branch and in `boardServes`/`boardCompletable`/`autoPick`'s availab

- **[FIXED in v2.18.12] A double dip declared on the turn a steal was just spent on silently voids the steal**
  *Reproduced on five match codes and shipped* as `stolen_this_turn` on the dip branch. The handoff's suggested fix said "plus the respin case" - **that part was wrong and was not done**: measured on seven codes, a victim re-spinning the board they were robbed on replays with the re-spin honoured, the steal standing and each counter spent once. Only a change to the turn ORDER breaks a steal. The flow test written for an earlier version of this same pair never checked that the man had changed hands, which is how it survived a release; it does now.
  `versus-logic.mjs`
  Match code QZAC4B, board 0 (guest leads). 1) guest picks Richie Anderson into RB at pick 1. 2) host, the follower, spends their one Steal on pick 1 — decideMove returns ok, matches.steals becomes [{at:2, by:'host', pickNo:1, slot:'RB'}], the replay moves Anderson to the host and hands pick 2 back to the guest (order becomes ['guest','guest']). 3) the guest, now on the clock at pick 2, presses Double dip — decideMove 
  *Fix:* Refuse a dip on a turn a powerup has already been spent on, in decideMove's dip branch, the way the steal branch already does: `if ((steals || []).some((x) => x.at === state.pickNo)) return refuse("one_at_a_time")` (plus the respin case), and disable the Doubl

- **[FIXED in v2.18.12] versus.jsx passes the powerup counts where a roster is expected, so two powerup rules are enforced on the server only**
  *Reproduced and shipped.* `openSlots({team:1,era:1,dip:1,steal:1})` returns all eight slots against `["QB"]` for a real roster.
  `versus.jsx`
  `mine` is `powerupsFor(match, side)` = { team, era, dip, steal } (line 760) and `theirs` is the same for the opponent (761). Both are handed to versus-logic as rosters. `openSlots({team:1,era:1,dip:1,steal:1})` returns all eight slots, whatever the real roster holds. So: a player with only QB still open arms Steal and taps the opponent's WR — the strip's canTake says `stealableSlots({option: <WR>, stealerRoster: mine
  *Fix:* Pass the rosters: `stealerRoster: state.roster[side]`, `dipperRoster: state.roster[side]`, `otherRoster: state.roster[theirSide]`. Renaming the powerup-count variables (e.g. `myPowerups`/`theirPowerups`) would stop the two being confusable.

- **[FIXED in v2.18.12] join_match lets a player take an invite while already drafting, orphaning the match they are in**
  *Reproduced and shipped* as `already_in_a_match`, driven against the real deployed function on staging. An untaken lobby of the caller's own is called off instead of refusing them, because nothing can ever end one - counting it would have refused that player every invite they were ever sent again.
  `supabase/migration-versus.sql`
  Driven through tests/mock-versus.mjs (which test-versus-sql.mjs holds to this file): alpha calls create_match (M1), beta joins it, M1 is 'drafting'. gamma calls create_match (M2) and sends alpha the link. alpha calls join_match(M2) — accepted: M2 goes to 'drafting' with alpha as its guest, and alpha is now a player in two live matches. M1 keeps its turn_deadline, so beta's screen claims every expired clock (versus.js
  *Fix:* Give join_match the same lookup create_match has: if the caller already has a match with status in ('open','drafting') other than this one, return an error code of its own (e.g. `already_in_a_match`) and map it in versus.jsx's ERRORS, VERSUS.md 3's list and st

- **[FIXED in v2.18.12] The host reopening their own live invite link is told it is their own link, not shown the match**
  *Reproduced and shipped.* The host gets the match in any state, word for word what `match_state` answers. `own_match` is gone from the function and from the screen's words.
  `supabase/migration-versus.sql`
  Same mock run: with M1 'drafting', alpha (the host) calls join_match(M1) and gets {"error":"own_match"}; beta (the guest) calls join_match(M1) on the same row and gets the match back. versus.jsx reads match_state first (line 692) and only falls through to joinMatch when that read comes back null, so the host hits this when their match_state read drops — the screen then renders the no-match lobby with 'That's your own
  *Fix:* Make the host branch match the guest's: return match_state(m.code) whenever m.host_id = v_uid, and keep `own_match` for the one case it was written for — a host opening their own still-open lobby is already handled, so the code may no longer be needed at all (

- **[FIXED in v2.18.11] KeepSeasons has no message for `already_named`, so one dropped reply wedges a completed guest trade-up on the guest screen for the rest of the session**
  *Shipped in v2.18.11.*
  `perfect-season.jsx`
  A guest fills in Keep your seasons. The email attaches, `claim_username` runs and the account is renamed and un-guested in the database - but the POST's reply is lost on the way back. `claimUsername` answers "failed", so the panel says "Something went wrong. Try again.". Every retry now answers `already_named`, which the panel's map does not cover, so it says the same thing again. The header still shows Guest_XXXXX, 
  *Fix:* Map `already_named` in KeepSeasons to the trade-up having already gone through, and act on it rather than just saying so: call `onKept(username)` (or re-read the profile) so the app picks up `guest: false` without a reload. The same treatment suits `not_signed

- **[MEDIUM] A daily Guess or Century run in progress crosses a sign-out: the next account opens today's daily mid-game with the previous player's guesses and fewer tries left**
  `guess.jsx`
  Alice plays three guesses of today's daily Guess the Player and logs out without finishing. Bob signs up on the same device and opens Guess the Player: his first ever daily opens straight into Alice's game - her three guessed players and their coloured comparison rows are on screen, and he has 2 of 5 guesses left. Century behaves the same way: a half-played daily leaves the next account on "Pick 3 of 7" of a run it n
  *Fix:* Key both WIP slots by account (`ps-guess-wip:<uid>` / `ps-century-wip:<uid>`), or - cheaper, and it also covers the guest who may not play the daily at all - stamp the snapshot with the account that started it and refuse to resume a DAILY snapshot whose owner 

- **[MEDIUM] Over/Under's finished-day record is keyed by device, so a second account on the device is shown the first account's score and cannot play that day**
  `perfect-season.jsx`
  Alice finishes today's Over/Under with 11. She logs out; Bob signs up on the same device and opens Over/Under from Mini games. He is shown "Your score: 11" - Alice's - and today's leaderboard, with no round to play and no way to play one until the local date rolls over.
  *Fix:* Key both Over/Under keys by account the way century.jsx and guess.jsx key theirs, and in `openSou` fall back to `fetchMySouRun` when the device has no record for THIS account. The `readDay` read of `SOU_DONE_KEY` (line 2567) needs the same account in its key a

- **[PARTLY FIXED in v2.19.5] Team colors costs 2,000 coins and does nothing for a player with no favorite team, with no hint anywhere**
  `shop.jsx`
  A new account (favorite_team is null by default) opens the shop, Card themes tab, and taps Team colors. The shop tile's thumbnail draws plain Navy, the display case draws plain Navy, and the "Preview" pill lights up saying something is being tried on. Buy → Confirm purchase → "Bought and equipped.", tile state becomes equipped, and the card is still byte-identical Navy. Driven in jsdom against the mock: the case's el
  *Fix:* Make the dependency visible in shop.jsx: when `!team` and item.id is frame-team or card-team, set `line` to something like "Pick a favorite team in Edit profile to see this" (it already renders as .sh-line on the tile and in the details row, so no new markup),
  *What v2.19.5 fixed:* the price. Both items are free, so nobody can waste 2,000 coins on one. *What is
  still open:* a player with no favourite team taps it and silently gets the default item back - the fix
  below (say so on the tile) is unchanged and still worth doing.
  *No refund, and do not re-raise it.* `Big_poppa1` bought `frame-team` for 2,000 coins before it became
  free and keeps the item either way. Asked on 2026-10-01, the owner said he is a close friend and would not
  care. Nothing was written to his wallet.

- **[MEDIUM] Android app: the Privacy link reloads the whole app and lands on Modes — the policy is unreachable**
  `perfect-season.jsx:4276-4280, site-pages.mjs:156, tools/app/build-app.mjs:62-66`
  In the Capacitor app, open Modes and tap "Privacy" in the .sitefoot footer. The privacy policy never appears: the web view does a full document navigation, Capacitor answers it with index.html, the whole app boots again and lands on Modes with the address rewritten back to "/". The player loses whatever screen state they were on, and there is no route in the app that can show the policy at all. A second consequence: 
  *Fix:* Give the app a route to the policy instead of a dead anchor. Cheapest: have openSitePage return true for "privacy" too and render the copy in-app (site-pages.mjs already exports PRIVACY_SECTIONS as data, the way HOWTO_STEPS is rendered as JSX). If it must stay

- **[LOW] The shop's Name colors tab tells the player the colour is not on their card while the card above it is wearing it**
  `shop.jsx`
  Open the shop, Name colors tab. The note reads "Name colors show on the leaderboards and the Stats boards, not on your card." Tap name-blue: the display case immediately renders the name inside a span.cs-name with data-name-look="name-blue" and --cs-name-1: #8FB8FF, and the "Preview" pill lights up. Buy it (750 coins) and the card keeps the colour. Verified in jsdom: before selecting, the case has no .cs-name; while 
  *Fix:* Rewrite the note at shop.jsx:673-676 to what the code does: name colours show on the boards and on your player card, and a nameplate takes the letters while the colour moves to the plate's outer ring. Update SHOP.md 7.1's NameInk bullet and CLAUDE.md's "Name c

- **[LOW] The #1 rank tile's crown emoji is read aloud as a word; every other emoji on the profile screen is hidden**
  `profile.jsx`
  Render ProfileScreen for a player ranked #1 in a format (rank={fantasy: 1}). The headline tile's text is "112.4Best Fantasy score, 👑 #1 sitewide" with no aria-hidden element anywhere inside it, so a screen reader announces "Best Fantasy score, crown, number 1 sitewide". Confirmed by walking .tiles .tile in jsdom: that tile is the only one on the screen containing an emoji, and it contains zero aria-hidden descendants
  *Fix:* Make rankNote return a node instead of a string — e.g. `(r) => r ? <>{", "}{r === 1 && <span aria-hidden="true">👑 </span>}{`#${num(r)} sitewide`}</> : null` — and build the tile label as `<>{`Best ${FORMAT_LABEL[f]} score`}{rankNote(rank?.[f])}</>` at profile.

- **[LOW] Android Back moves the screen to Modes without consuming the history entry, so a later Back re-opens the screen you left**
  `perfect-season.jsx:2794-2801`
  In the app, signed in: Modes → open the Shop → tap the Leaderboard tab → hardware Back → you land on Modes (correct) → hardware Back again → the Shop opens instead of the app exiting. It takes four presses to leave the app, with a stop in a screen the player already left twice. On the website the same route needs one Back (Leaderboard → Shop), so the app inserts a phantom Modes stop and then walks back into the Shop.
  *Fix:* When onAppBack decides a screen leaves for Modes, walk history rather than cancelling: if the entry below is one this app pushed, call history.back() (or go(-n) past the owned entries) instead of openTab("home") + preventDefault, so the stack and the screen st

- **[LOW] The service worker stores an opaque FAILURE for the Google Fonts stylesheet and serves it first on the next load**
  `service-worker.js:35-36`
  A proxy or regional filter answers https://fonts.googleapis.com/css2?family=Anton&... with a block page or a 403. Because <link rel="stylesheet"> is a no-cors request the response is opaque — status 0, ok false, type "opaque" — and worthStoring returns true for it, so store() writes that failure into Cache Storage under the stylesheet's URL. On the next page load fromStore returns the stored copy immediately, so the 
  *Fix:* Only store the font stylesheet when the response can be judged: either add crossorigin to the Google Fonts <link> in page.html so the response is a real CORS response and response.ok means something, or narrow the opaque arm to the gstatic font files (which ar

---

## 4. Assets produced — **`build/` is gitignored**

Unchanged from the previous handoff. `build/film/gridspin-tiktok-15s-silent.mp4`,
`build/film/gridspin-spin-an-era-1080p60.mp4`, `build/brand/avatar-lime-1024.png`,
`build/brand/avatar-navy-1024.png`. Re-render from `tools/`, which are committed — except the scored
film's audio mux, see 3.7.

Note for the brand mark: `tools/brand/avatar.mjs` hard-codes its own copy of the paths, so the mark is a
**three-way** hand copy (`static/icon.svg`, `GridspinMark`, `avatar.mjs`'s `MARK`). They agree today.
CLAUDE.md still says "change both together" and should say three.

---

## 5. Things learned this session

**A test that asserts a bug is still a decision, and it deserves reading before it is overruled.**
`network`'s absence from the retry lists looked like an oversight and had a test and a written rationale
behind it. The rationale was right; the bug was one layer up, in what got CALLED `network`. Flipping the
retry list would have "fixed" the symptom and broken the rule.

**A green suite is not a verified release, and this session has the proof.** v2.18.3 shipped 77/77 green,
staging-verified and browser-checked, and still carried a navigation bug. What found it was driving the
PROMOTED build on production. The bug was also years old and invisible until v2.18.3 gave it a way to be
reached - which is the general shape: a new feature does not only add its own risk, it makes existing
dead paths live.

**Dead code in a conditional chain is invisible.** `else if (s.view === "century") openTab("century")`
read as working code for three releases. It could never run, because `screenOf` rejected the state one
step earlier. Nothing flags a branch that is never taken; only exercising the path does.

**Check what a mock replaces.** `tests/mock-guess.mjs` stands in for the whole `functions.invoke` layer,
so `error.context.json()` and every mapping around it had never been executed by any test in either
direction. A module can look thoroughly covered and have its entire error-translation layer unrun.

**A test file holding its own copy of the constant it tests proves nothing.**
`tests/test-pending-daily.mjs` had a local `RETRY` array, so it could have passed while the real list
said something else. It imports it now. Worth grepping for others.

**Two test titles described behaviour nobody had checked.** Both mini-game board tests claimed a guest is
"chipped rather than linked" while those boards linked nobody and chipped nobody. A title is not an
assertion.

**A repro is worth more than a theory.** The Back bug looked impossible from reading the history effect -
the state was written correctly and the handler had a branch for it. Ten lines of jsdom found the real
cause in one run.

**Confirm a Supabase project by row counts, and use `--linked --project-ref`** - `--project-ref` alone is
refused. Production is `aqbajvwwvvbrklolbcen`, staging `ndelisxdxjmvcdezzecu`.

**Two shell traps that cost time.** `node tests/run-all.mjs | tail -40` reports `tail`'s exit code, so a
failing suite reads as a pass - run it unpiped. And `git merge -F -` does not read stdin the way
`git commit -F -` does; it errors after the checkout has already happened, leaving you on the other
branch.

**Comparing "comments only" needs whitespace normalised.** Stripping `//` comments leaves trailing spaces
where a trailing comment was, so a naive hash comparison reports a false change. Trim before hashing.

## 6. Standing rules worth re-reading before touching anything

From `CLAUDE.md`, and all of them earned:

- Nothing reaches production without staging first, a changelog entry, and a version. One-line fixes
  included.
- Deploy order is always **migration → Edge Function → client**.
- Confirm which Supabase project you are pointed at by **comparing row counts**, never by looking for
  one account.
- Never write to production data without explicit permission in that turn.
- Never edit the tree while the suite is running.
- `badges.mjs` must not import anything.
- Verify a new test by mutating the code and watching it go red.
