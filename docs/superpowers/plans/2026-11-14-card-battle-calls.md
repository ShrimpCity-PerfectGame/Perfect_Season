# Card Battles: Call the Category - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card battle round is played on a category somebody CALLED before the pick, on a lineup with no Flex, in a panel that never moves the page and keeps the result up until the player moves on.

**Architecture:** Every rule lands in `card-logic.mjs`, which the browser, `card-claim` and the mock all import; who calls follows from the rounds played, and each stored round carries the call for the next one so a reload needs nothing new from the database. The screen's `Arena` is rewritten around one panel with three states (choose, reveal, over). No migration.

**Tech Stack:** React 18 (no new dependency), Deno Edge Function `card-claim`, the jsdom tests in `tests/`, `tools/ui-harness` with puppeteer-core for phone sizes.

**Spec:** `docs/superpowers/specs/2026-11-14-card-battle-calls-design.md`

## Global Constraints

- Test site only. Release v2.31.0. Order: Edge Functions, then client. No migration.
- Lineup is `QB, RB, RB, WR, WR, TE`; `spotFits` still answers for `FLEX`.
- You call round one; the winner of a round calls the next; a dead heat leaves the call where it was.
- Each category once a battle. Their call is `foeCall`: most points for their card, ties to `CATEGORIES` order, no draws.
- `playRound` makes exactly four draws; `buildTeam` eleven; `scoreBattle` twenty-four.
- The hand is shown in the order dealt. No projected total on a card. Nothing on the result leaves on a timer. Nothing scrolls by itself.
- Colour is never the only signal; every new text colour holds AA in the scope it sits in.
- Card files import only what `cards-shared.mjs` publishes (or another card file).
- No backticks inside the CSS template string. Files are CRLF - edit with the scratchpad `edit-lib.cjs`.

## Review Focus

1. A double tap on Play, or Next pressed twice: one round is played and one reveal is passed.
2. A play whose answer is lost: the state read afterwards shows the round and the right call for the next.
3. Round six on your call: the one category left is already chosen; Play needs only a card.
4. A battle begun before this release (Flex spots, no `next` on its rounds): it finishes; their call reads "you'll see the category when you play".
5. A 320px phone: the row of cards scrolls sideways, the page does not, and the Play button's long label wraps.
6. A dead heat: the call stays with whoever had it, in the rules, the server and the screen alike.

---

### Task 1: The rules (`card-logic.mjs`)

**Files:** Modify `card-logic.mjs`; Test `tests/test-card-logic.mjs`.

**Produces:**
- `SPOTS = ["QB","RB","RB","WR","WR","TE"]`
- `leftCategories(rounds) -> string[]` (ids not yet used, `CATEGORY_IDS` order)
- `callerOf(rounds) -> "me" | "foe"`
- `categoryWorth(entry, cat) -> number` (`roundBase` + an ability that fires on the category alone)
- `foeCall(foe, rounds) -> string | null` (null when their next card is hidden or the battle is full)
- `bestCategory(entry, rounds) -> string`
- `nextCall(foe, rounds) -> { by, cat } | null` (`cat` set on their call, or when one category is left)
- `cardProblem(hand, foe, rounds, entry)` - what `roundProblem` was
- `roundProblem(hand, foe, rounds, entry, cat)` - `cardProblem`, then `"bad_cat"` on your call when `cat` is not left
- `playRound(foe, rounds, entry, cat, rand, foeEdge, edgeLabel)` - resolves the category itself; result gains `call` and `next`
- `scoreBattle(mine, foe, rand, foeEdge = 0)` - `mine[n]` may carry `cat`; without one, `bestCategory`
- `dailyRound(date, rounds, entry, cat)`, `dailyBattle(date, mine)`
- `GAUNTLET` with Baltimore fourth: NYJ, JAX, TEN, BAL, SEA, HOU, ATL, NYG, LV, GB, DEN, KC
- Removed: `shuffleCategories`, `dailyCategories`. `bestTeam` / `teamProblem` follow `SPOTS`.

- [ ] Tests first, in `tests/test-card-logic.mjs`: the caller over a scripted run of wins, losses and a tie (Review Focus 6); `foeCall` is their card's best of what is left and never a used one; `roundProblem` answers `bad_cat` for a used category, a made-up one and none at all on your call, and ignores `cat` on theirs; `playRound` on their call plays `foeCall` whatever was passed; a round carries `call` and `next`, `next` is null after the sixth and names the one category left before it (Review Focus 3); a round whose rounds lack `next` still resolves (Review Focus 4); `buildTeam` and `gauntletFoe` field one QB, two RB, two WR, one TE; the gauntlet's strengths rise; draw counts 4 / 11 / 24.
- [ ] Run: `node tests/test-card-logic.mjs` - fails on the new names.
- [ ] Implement. Re-pin the 2,000-battle checksum last.
- [ ] Run again - passes. Commit.

### Task 2: The server, the mock and the client calls

**Files:** Modify `supabase/functions/card-claim/index.ts`, `tests/mock-cards.mjs`, `storage-cards.js`; Test `tests/test-cards-edge.mjs`, `tests/test-cards-sql.mjs`.

**Consumes:** Task 1's `roundProblem`, `playRound`, `dailyRound`, `gauntletRound`, `CATEGORY_IDS`.
**Produces:** `playRound(run, step, round, card, cat)`, `playDailyRound(round, card, cat)`, `playGauntletRound(stage, round, card, cat)` in `storage-cards.js`; `"bad_cat"` in its reasons list.

- [ ] Tests first, in `tests/test-cards-edge.mjs`: each of the three round actions refuses `bad_cat` on your call and writes nothing; plays their call whatever `cat` is sent; answers a round with `call` and `next`; a whole ladder battle played by calls ends and pays as before; a start still stores a six-long `cats`.
- [ ] Function and mock: read `cat` (a string or null) from the body, hand it to `roundProblem` and the round; pass `CATEGORY_IDS` wherever a category order was shuffled; drop the "has no category order" guards. `bad_cat` is a 400.
- [ ] Run `node tests/test-cards-edge.mjs`, `node tests/test-cards-sql.mjs`, `node tests/test-cards-daily-edge.mjs`. Commit.

### Task 3: The screen (`card-battle.jsx`)

**Files:** Modify `card-battle.jsx`, `tools/ui-harness/harness.jsx` if it drives a battle; Test `tests/test-cards-screen.mjs`, `tests/test-a11y.mjs`.

**Consumes:** `callerOf`, `nextCall`, `leftCategories`, `cardProblem`, `bestCategory`, `categoryWorth`, the storage calls of Task 2.
**Produces (test hooks):** `[data-rack]` holding `[data-cat]` chips (`aria-pressed`, `data-used="me|foe|tie"`); `[data-choose]` with `data-choose` (round), `data-spot`, `data-call="me|foe"`; `[data-pick]` stat cards (`data-finish`, `aria-pressed`); `[data-play]`; `[data-best]`; `[data-whole-hand]`; `[data-reveal]` with `[data-why]` and `[data-next]`. `Arena`'s `onPlay(entry, cat)`.

- [ ] Tests first, in `tests/test-cards-screen.mjs`: round one is your call with six live chips and Play disabled until a category and a card are chosen; the cards are in the hand's own order and carry six stat rows and no total; playing shows the reveal with both cards, the real stat and one total a side, and it is still there after waiting; Next brings the next round with that category used and marked with who took it; when they call, their category is pressed, the others are not buttons, and one tap on a card enables Play; a second click on Play or Next changes nothing (Review Focus 1); a lost answer shows the round on return (Review Focus 2); round six needs only a card (Review Focus 3); a run stored without `next` plays on (Review Focus 4); the whole hand opens, view only.
- [ ] Rewrite `Arena`: scoreboard, rack, the panel (choose / reveal), the field, the log. State: rounds acknowledged, chosen category, chosen card, why-open. Delete the beats, the speed and skip controls and `plays()`.
- [ ] CSS: the tray scrolls sideways inside the panel and nothing else does (Review Focus 5); entrance motion only, listed in the reduced-motion block; touch targets 44px.
- [ ] Run `node tests/test-cards-screen.mjs` (five times - it has failed by chance before), `node tests/test-a11y.mjs`. Commit.

### Task 4: Balance

**Files:** Modify `tests/test-card-balance.mjs`.

- [ ] Three players - careless, dull, careful - that call. Bands as the spec's "Settled after the builder check". Print the gauntlet stage by stage for the dull and careful player.
- [ ] Run `node tests/test-card-balance.mjs`. Move `CPU_START` / `CPU_STEP` or the head start only if a band or the spec's gauntlet limits break; then re-pin Task 1's checksum. Commit.

### Task 5: Look at it

- [ ] `node tools/ui-harness/build.mjs`, then drive a ladder battle, a gauntlet stage and the daily in Chrome at 320, 375, 430, 768 and 667x375: no sideways page scroll, nothing clipped, the reveal stays, the page does not move on Play or Next. Screenshot a round of each state for the owner.

### Task 6: Ship to the test site

- [ ] `CARDS.md` 4, 5, 6, 7, 11, 13, 14; `CLAUDE.md` cards paragraph and Releasing line; `CHANGELOG.md`; `package.json` 2.31.0.
- [ ] `node tests/run-all.mjs` in the background - all files pass.
- [ ] `node deploy-function.mjs staging`, then push `staging`; confirm the version in the live bundle.
