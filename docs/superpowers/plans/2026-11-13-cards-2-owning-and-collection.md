# Cards, plan 2 of 5: owning cards and the collection screen - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in player on the test site can open a card area, claim a starter deck, earn one card a day from the daily draft, and see their collection drawn with the owner's sprites.

**Architecture:** Ownership lives in two tables no client can write; one security-definer SQL function grants cards exactly once per (user, kind, ref). A new Edge Function claims the starter deck and `submit-run` grants the daily card, both choosing cards with rules from `card-logic.mjs`. The browser reads its own rows, loads the catalog on demand, and draws each card from a pre-cut neutral sprite recoloured on a canvas. Everything sits behind one switch that is on for staging and off for production.

**Tech Stack:** Postgres (Supabase) + PGlite in tests, Deno Edge Functions run through `tests/edge-harness.mjs`, React 18, esbuild, puppeteer-core (dev-only, for cutting sprites).

**Spec:** `docs/superpowers/specs/2026-11-13-card-collection-design.md` (sections 3.2, 5, 6, 7). **Reference:** `CARDS.md` for what plan 1 built. Read both first.

**Not in this plan:** packs (3), battles and runs (4), badges, the profile's best card, boards (5), the real skin-tone list, the `/privacy` and `/terms` wording (they change in the release that turns cards on for production).

## Global Constraints

- **No client write policy** on `card_owned` or `card_grants`. Only `grant_cards` writes them, and only `service_role` may execute it.
- **Every refusal lives in SQL or the Edge Function**, and every reason string a client module can receive is in that module's refusal list; a test reads the function source and the SQL and fails on an unmapped one.
- **A failed read is not "you own nothing".** The collection has three states: has cards, has none, could not ask.
- **Guests cannot collect** (`guest_not_allowed`), matching the shop.
- **The switch.** Client: `cardsOn()` from `cards-switch.mjs`. Server: env `CARDS_ENABLED === "1"`. With either off, nothing is granted and nothing is shown. Default: on when `APP_ENV` is `staging`, off otherwise.
- **`data/cards.json` is copied to `public/data/` only when the switch is on.**
- `card-logic.mjs` stays pure: no `Math.random`, no DOM. Random choices take a `rand`.
- **A daily card never fails a season.** Its grant is wrapped like `logRun`: logged, swallowed.
- Screens in their own files with their own CSS prefix (`cd-`), exporting a CSS string; they never import `perfect-season.jsx`. Colours for card artwork are data; text takes theme tokens.
- Internal names say `card`; no player-facing name is chosen, so copy says "Cards".
- Release order is migration, server secret, Edge Functions, client. Work on a branch from `staging`; one commit per task.
- Version **2.23.0** with a `CHANGELOG.md` entry (Task 11): the test site gains a visible feature.

## Review Focus

1. **Two tabs claim the starter deck at the same moment** - the account ends with exactly eight cards and one tab is told it was already claimed. Pinned in Task 2.
2. **The daily card's grant fails or throws** - the season is still saved and paid, and the response carries `card: null`. Pinned in Task 5.
3. **The collection read fails** - the screen says it could not load, with Try again; it never shows the empty state or the starter button. Pinned in Task 9.
4. **An owned card id is not in the catalog the browser loaded** (a stale cached file) - that row is skipped and the rest render; nothing throws. Pinned in Task 9.
5. **The client switch is on but the server's is off** (the secret was not set) - the starter button answers with a sentence that says cards are not switched on, not "check your connection". Pinned in Tasks 4 and 9.
6. **A sprite fails to load or the canvas cannot be read** - the card still shows name, rating, archetype and stats on its team colours. Pinned in Task 8.

---

### Task 1: Starter deck and daily card rules

**Files:** Modify `card-logic.mjs`, `tests/test-card-logic.mjs`, `tests/test-card-balance.mjs`.

**Interfaces - Produces:**
- `STARTER_SIZE = 8`, `STARTER_MAX_RATING = 60`
- `starterDeck(rand) -> { id: number, finish: "base" }[]` - eight distinct players rated under 60, always containing a QB, an RB, a WR, a TE and at least two more non-quarterbacks, so `lineupProblem` can be satisfied from it.
- `DAILY_FINISH_ODDS = { base: 0.80, silver: 0.16, gold: 0.035, prism: 0.005 }`
- `rollFinish(rand, odds = DAILY_FINISH_ODDS) -> string` - one draw; walks `FINISHES` in order, cumulative.
- `cardBoardKey(card) -> string` - the draft board the card came from, `"<team>|<w>"`, `w` being the index of the `WINDOWS` entry (from `game-logic.mjs`) containing `card.season`.
- `dailyCard(boardKeys, rand) -> { id, finish } | null` - a card drawn uniformly from every card whose `cardBoardKey` is in `boardKeys`, then `rollFinish`. Candidates sorted by id before the draw. `null` when there are none. Exactly two draws when it returns a card.

- [ ] **Step 1: Failing tests** appended to `tests/test-card-logic.mjs`:
  - 500 seeded `starterDeck(mulberry32(i))`: length 8; all `base`; all ratings `< 60`; 8 distinct `pid`; a legal lineup can be built from it (reuse the file's slot-filling loop) and passes `lineupProblem`.
  - `rollFinish(() => 0)` is `"base"`; `rollFinish(() => 0.999999)` is `"prism"`; `rollFinish(() => 0.80)` is `"silver"`; over 20,000 seeded draws each share is within 0.01 of its odds (prism within 0.003).
  - `cardBoardKey` of 2007 Brady is `"NE|1"`; every card's key is a key of `BOARDS` (import `initGameData`, `BOARDS`).
  - `dailyCard(["NE|1"], rand)` returns a card whose `cardBoardKey` is `"NE|1"`; `dailyCard([], rand)` and `dailyCard(["XX|9"], rand)` are `null`; a counting `rand` is called exactly twice; the same seed gives the same card.
- [ ] **Step 2:** `node tests/test-card-logic.mjs` - expected: FAIL, `starterDeck` not exported.
- [ ] **Step 3: Implement.** `starterDeck` draws without replacement from the under-60 pool sorted by id: first one each of QB, RB, WR, TE, then two non-QB, then two of anything, skipping any `pid` already taken.
- [ ] **Step 4:** In `tests/test-card-balance.mjs` replace the local `starter` generator with `C.starterDeck(mulberry32(seed))` mapped to cards. Run it on the default seeds and on `9000 13`. Expected: every band holds. If the starter bands move outside 0.8-2.5 wins, tune `BAR_START` only, re-pin the checksum, and update CARDS.md's table.
- [ ] **Step 5:** Commit - `cards: the starter deck and the daily card, as rules`.

---

### Task 2: Ownership tables and `grant_cards`

**Files:** Create `supabase/migration-cards.sql`, `tests/test-cards-sql.mjs`. Modify `tests/test-migrations.mjs` (`ORDER`: after `migration-shop.sql`), `tests/pg-fixture.mjs` (`MIGRATIONS`), `supabase/migration-profiles.sql` (`delete_account`), `tests/test-delete-account.mjs`.

**Interfaces - Produces:**
```sql
public.card_owned  (user_id uuid references auth.users on delete cascade, card_id integer check (card_id > 0),
                    finish text check (finish in ('base','silver','gold','prism')), count integer check (count > 0),
                    first_at timestamptz default now(), primary key (user_id, card_id, finish))
public.card_grants (id bigint generated always as identity primary key, user_id uuid references auth.users on delete cascade,
                    kind text check (kind in ('starter','daily')), ref text check (char_length(ref) between 1 and 40),
                    card_id integer, finish text, created_at timestamptz default now(), unique (user_id, kind, ref))
public.grant_cards(p_user uuid, p_kind text, p_grants jsonb) returns jsonb   -- security definer, search_path public, pg_temp
```
- RLS on both; one policy each: `for select using (auth.uid() = user_id)`. No insert/update/delete policy. Sequence revoked from `anon, authenticated`.
- `grant_cards`: `p_grants` is `[{ "ref": text, "card": int, "finish": text }]`, at most 20. Raises `no_profile` if the user has no profile, `guest_not_allowed` if `profiles.guest`, `bad_grant` on a malformed entry (errcode `P0001`). For each entry: `insert into card_grants ... on conflict (user_id, kind, ref) do nothing`; only when a row was inserted, upsert `card_owned` (`count = count + 1`). Returns `{ "granted": [{ref, card, finish}...], "duplicate": <true when p_grants was non-empty and nothing was new> }`. `revoke all ... from public, anon, authenticated; grant execute ... to service_role`.
- `delete_account` gains, behind the file's existing `to_regclass` + `execute` idiom: delete the user's rows from `card_owned` and `card_grants`. Cards are the person's, not a board's.

- [ ] **Step 1: Failing test** `tests/test-cards-sql.mjs` (model on `tests/test-century-sql.mjs`; `freshDb`, `addAccount`, `addGuestAccount`, `asUser`, `asAnon`, `failure`):
  - as `authenticated`: insert, update and delete on both tables fail; `select` returns only the caller's rows; `anon` sees none; `grant_cards` is not executable by `anon` or `authenticated`.
  - as service role: granting `[{ref:"starter:0",card:5,finish:"base"},{ref:"starter:1",card:5,finish:"base"}]` gives `card_owned` one row with `count = 2` and returns two `granted`, `duplicate: false`.
  - **Review Focus 1:** the same call again returns `granted: []`, `duplicate: true`, and `count` is still 2. Two calls with eight different cards each under refs `starter:0..7` leave exactly eight `card_grants` rows.
  - guest account: `guest_not_allowed`. Unknown user: `no_profile`. `finish: "diamond"`, `card: 0`, a missing `ref`, and 21 entries: `bad_grant`, and nothing is written (one transaction).
  - `delete_account` for an owner removes their rows from both tables and leaves another account's.
- [ ] **Step 2:** `node tests/test-cards-sql.mjs` - expected: FAIL, relation `card_owned` does not exist.
- [ ] **Step 3:** Write the migration (header comment: why no write policy, why a ledger table, the re-run safety - `create table if not exists`, `drop policy if exists` before `create policy`, `create or replace function`). Add it to `ORDER` and `MIGRATIONS`. Extend `delete_account` and its test.
- [ ] **Step 4:** `node tests/test-cards-sql.mjs && node tests/test-migrations.mjs && node tests/test-delete-account.mjs` - expected: all pass.
- [ ] **Step 5:** Commit - `cards: ownership no browser can write, and a grant that happens once`.

---

### Task 3: The mock's cards, held to the SQL

**Files:** Create `tests/mock-cards.mjs`. Modify `tests/mock-supabase.mjs`, `tests/test-cards-sql.mjs`.

**Interfaces - Produces:** `makeCards(state) -> { tables: { card_owned, card_grants }, grantCards(userId, kind, grants), owned(userId), claimStarter(body), rpcs: {}, clear() }`, following `tests/mock-century.mjs`. `grantCards` mirrors `grant_cards` exactly, including its three raises. In `mock-supabase.mjs`: both tables join `extraTables` (client writes answer as RLS-denied); a client `select` on them returns only the current user's rows; `functions.invoke("card-claim")` routes to `cards.claimStarter`; expose `_cards`; the mock's delete-account mirror drops the user's card rows.

- [ ] **Step 1: Failing test** added to `tests/test-cards-sql.mjs`: run one sequence of grants (new, duplicate, mixed, guest, bad entry) through SQL and through `makeCards`, and `assert(!differs(sqlResult, mockResult))` for every return value and for the final `card_owned` rows, using the `differs`/`canon` helpers the century SQL test defines.
- [ ] **Step 2:** Run - expected: FAIL, cannot find `mock-cards.mjs`.
- [ ] **Step 3:** Implement. `claimStarter` is filled in by Task 4; leave it returning the `cards_off` error shape until then.
- [ ] **Step 4:** `node tests/test-cards-sql.mjs` - expected: pass.
- [ ] **Step 5:** Commit - `cards: the test mock grants cards the way the database does`.

---

### Task 4: The `card-claim` Edge Function (starter deck)

**Files:** Create `supabase/functions/card-claim/index.ts`, `tests/test-cards-edge.mjs`. Modify `deploy-function.mjs` (`FUNCTIONS`), `supabase/config.toml`, `tests/mock-cards.mjs`, and `tests/edge-harness.mjs` only if it cannot already set an env var per test (add an `env` option to `loadEdgeFunction` if so).

**Interfaces - Produces:** `POST card-claim { "action": "starter" }`.
- Structure, CORS, auth and the profile read copy `supabase/functions/submit-century/index.ts` (lines 63-108).
- Imports: `initCardData, starterDeck` from `../../../card-logic.mjs`; `../../../data/cards.json` with `{ type: "json" }`.
- Answers, in this order: 401 `signed_out`; 400 `malformed` (bad JSON or an unknown `action`); 403 `cards_off` when `Deno.env.get("CARDS_ENABLED") !== "1"`; 500 `server` (profile read failed); 400 `no_profile`; 403 `guest_not_allowed`; then `service.rpc("grant_cards", { p_user, p_kind: "starter", p_grants })` with refs `starter:0` to `starter:7`: rpc error -> 500 `server`; `duplicate: true` -> 409 `duplicate`; else 200 `{ ok: true, cards: [{ id, finish }] }` from `granted`.
- Randomness: a local `secureRand()` returning `crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32`. Never `Math.random`.

- [ ] **Step 1: Failing test** `tests/test-cards-edge.mjs` (model on `tests/test-century-edge.mjs`; the store's `rpcs.grant_cards` is `makeCards(...).grantCards` so the real rule runs):
  - no user -> 401 `signed_out`; body `{action:"nope"}` -> 400 `malformed`.
  - **Review Focus 5:** env unset -> 403 `cards_off`, and `rpcCalls` is empty.
  - env on, real account -> 200, eight cards, all `base`, eight distinct ids, `grant_cards` called once with `p_kind: "starter"`.
  - second call -> 409 `duplicate`, the account still owns exactly eight.
  - guest -> 403 `guest_not_allowed`; no profile -> 400 `no_profile`; `rpcFails.grant_cards` -> 500 `server`; `readFails.profiles` -> 500 `server`.
  - every `reason` string in `index.ts` (regex over the source) is in `CARD_REFUSALS` (Task 6 creates it; until then assert against a literal list in this test and switch to the import in Task 6).
- [ ] **Step 2:** `node tests/test-cards-edge.mjs` - expected: FAIL, function not found.
- [ ] **Step 3:** Implement the function; add it to `FUNCTIONS` and a `[functions.card-claim]` block (`enabled = true`, `verify_jwt = false`, `entrypoint`). Make `mock-cards.mjs`'s `claimStarter` mirror it line for line, switch read from `state.cardsEnabled` (default true in the mock).
- [ ] **Step 4:** `node tests/test-cards-edge.mjs` - expected: pass.
- [ ] **Step 5:** Commit - `cards: claiming a starter deck`.

---

### Task 5: The daily card, granted by `submit-run`

**Files:** Modify `supabase/functions/submit-run/index.ts`, `tests/test-submit-run-edge.mjs`, the mock's submit-run mirror in `tests/mock-supabase.mjs`.

**Interfaces - Produces:** the success response becomes `{ ok: true, run, coins, newBadges, card }`, `card` being `{ id, finish }` or `null`.
- Where: after the rewards block that ends near line 445, before the final `json(...)`.
- Condition: `mode.kind === "daily"` and `Deno.env.get("CARDS_ENABLED") === "1"`.
- `const pick = dailyCard(history.map((h) => h.key), secureRand)`; then `service.rpc("grant_cards", { p_user: user.id, p_kind: "daily", p_grants: [{ ref: mode.date, card: pick.id, finish: pick.finish }] })`. The ref is the date alone, so the two scoring formats' dailies share one card a day.
- `card` is the granted entry when `granted` has one; `null` when it was a duplicate, when `pick` is null, or on any error. The whole block is in its own `try/catch` that logs with `console.error` and continues.

- [ ] **Step 1: Failing tests** in `tests/test-submit-run-edge.mjs` (reuse its existing legitimate-daily fixture):
  - env on: a finished daily's response has `card` with an id whose `cardBoardKey` is one of the daily's board keys; `grant_cards` was called once with `p_kind: "daily"` and `ref` equal to the date.
  - a second daily that day in the other scoring format: `card` is `null` and the account owns one daily card.
  - **Review Focus 2:** `rpcFails.grant_cards` set, and separately `throwOn.grant_cards`: status 200, `ok: true`, `coins` present, `card: null`.
  - env off: `grant_cards` never called, `card: null`.
  - an Unlimited season: never called.
- [ ] **Step 2:** Run - expected: FAIL, `card` is undefined.
- [ ] **Step 3:** Implement; mirror it in the mock's submit-run (it calls `cards.grantCards`), reading `state.cardsEnabled`.
- [ ] **Step 4:** `node tests/test-submit-run-edge.mjs && node tests/test-submit-run-integration.mjs && node tests/test-daily-submit.mjs && node tests/test-tamper-resistance.mjs` - expected: all pass.
- [ ] **Step 5:** Commit - `cards: finishing the daily earns a card`.

---

### Task 6: The switch, the catalog on demand, and client storage

**Files:** Create `cards-switch.mjs`, `card-data.mjs`, `storage-cards.js`, `tests/test-cards-client.mjs`. Modify `build.mjs`, `storage.js`, `tests/helpers.mjs` (its esbuild `define`), `tools/ui-harness/build.mjs`, `tests/test-build-seo.mjs`.

**Interfaces - Produces:**
- `build.mjs` `define`: `CARDS_ON: JSON.stringify(process.env.CARDS_ON ?? (APP_ENV === "staging" ? "1" : ""))`. When that value is `"1"`, `cpSync("data/cards.json", "public/data/cards.json")`; otherwise the file must not exist in `public/`.
- `cards-switch.mjs`: `cardsOn() -> boolean` - `window.__ps_cards__` when it is not `undefined` (tests and the harness set it), else `CARDS_ON === "1"`. A comment says why the override is harmless in production: the server has its own switch.
- `card-data.mjs`: `CARD_DATA_URL = "/data/cards.json"`; `loadCardData(fetchImpl = fetch) -> Promise<{ cards, players }>` - fetches with `{ credentials: "omit" }`, calls `initCardData`, memoises success only (a failure is retried on the next call), modelled on `guess-pool.mjs`.
- `storage-cards.js`:
  - `CARD_REFUSALS = ["signed_out","no_profile","guest_not_allowed","cards_off","duplicate","malformed","server"]`
  - `fetchMyCards() -> { status: "ok", cards: [{ id, finish, count }], starter: boolean } | { status: "signed_out" } | { status: "error" }` - `auth.getSession()`, then both tables read in parallel; `starter` is whether a `card_grants` row of kind `starter` exists. Any read error is `error`, never an empty `ok`.
  - `claimStarter() -> { ok: true, cards } | { ok: false, reason }` - `functions.invoke("card-claim", { body: { action: "starter" } })`, failures classified exactly as `storage-century.js`'s `submitCentury` does (unreadable body -> `offline`, unknown reason -> `network`).
- `storage.js`: `export * from "./storage-cards.js";`

- [ ] **Step 1: Failing test** `tests/test-cards-client.mjs` (jsdom + `makeMockAuth`, no app mount):
  - `cardsOn()` follows `window.__ps_cards__` true/false.
  - `fetchMyCards` signed out -> `signed_out`; signed in with nothing -> `ok`, `[]`, `starter: false`; after a mock grant -> the rows; with the mock's read failing -> `error`.
  - `claimStarter` -> `ok` with eight; again -> `duplicate`; as a guest -> `guest_not_allowed`; with `_cards` switched off -> `cards_off`.
  - every reason in `supabase/functions/card-claim/index.ts` is in `CARD_REFUSALS`; switch Task 4's literal list to this import.
  - `loadCardData` with a fake fetch: resolves with 3,124 cards; a rejecting fetch rejects and the next call tries again.
  - in `tests/test-build-seo.mjs`: a production build has no `public/data/cards.json`; a staging build has it.
- [ ] **Step 2:** Run - expected: FAIL, modules not found.
- [ ] **Step 3:** Implement. Add `CARDS_ON` to the test and harness builds' `define` as `"1"`.
- [ ] **Step 4:** `node tests/test-cards-client.mjs && node tests/test-build-seo.mjs && node tests/test-pwa.mjs` - expected: pass (`/data/cards.json` is the site's own file; confirm `sw-rules.mjs` treats it like `guess-pool.json` and add a `test-pwa` line if it is not already covered by a path rule).
- [ ] **Step 5:** Commit - `cards: one switch, the catalog on demand, and reads that say when they failed`.

---

### Task 7: Cutting the sprites

**Files:** Create `tools/cards/build-sprites.mjs`, `tools/cards/poses.json`, `tools/cards/source/sheet-1.png`, `tools/cards/source/sheet-2.png` (moved from `docs/superpowers/specs/2026-11-13-card-collection/`), `static/cards/<pose>.png` (generated, committed), `tests/test-card-sprites.mjs`. Delete `docs/superpowers/specs/2026-11-13-card-collection/prototype-build-sprites.mjs` once its technique lives in the tool.

**Interfaces - Produces:** fourteen neutral sprites, 300 px tall PNG with transparency, painted number erased, still in the sheets' own blue jersey, grey helmet and pants, and tan skin. `tools/cards/poses.json` maps pose to source:

| Pose (= archetype id, plus `role`) | Sheet, cell (0-based, row-major) |
|---|---|
| gunslinger | 1, 1 | 
| scrambler | 2, 1 |
| volume | 2, 2 |
| manager | 1, 5 |
| workhorse | 1, 2 |
| goalline | 1, 8 |
| homerun | 1, 7 |
| receiving | 1, 0 |
| deep | 2, 4 |
| redzone | 1, 9 |
| possession | 1, 6 |
| seam | 1, 3 |
| valve | 2, 6 |
| role | 2, 0 |

(Sheet 1 is the one numbered 11-20, sheet 2 the one numbered 1-10. The owner may reassign any row; that is a data edit and a re-run.)

**The owner's full 50-pose set is NOT the source yet.** `docs/superpowers/specs/2026-11-13-card-collection/sprite-sheet-full-50.jpg` arrived on 2026-11-13 and is the set the owner wants, but that file is 1024x683 for fifty sprites - about 100x135 pixels each, as a JPEG - where a card draws its sprite 300 px tall. Build this task against the two earlier sheets (20 poses at roughly 300x400 each). When the owner supplies the same set at full size, re-pointing is a `poses.json` edit and a re-run: the tool must not assume numbered jerseys (the new set has none, so the number-erasing stage has to tolerate finding nothing) and must refuse a cell that holds two players (several of the fifty are two-man tackles and blocks, which cannot be one player's card).

The tool is the prototype's first two stages only - clear the paper and ground shadow by flood fill, split into connected pieces by grid cell, find and paint over the number - and **not** its recolouring, which moves to the browser (Task 8). It also writes `static/cards/sprites.json`: `{ pose: { w, h } }`.

- [ ] **Step 1: Failing test** `tests/test-card-sprites.mjs` (no browser: read PNG headers with `node:fs`, sizes from bytes 16-23): `poses.json` has exactly the fourteen keys `ARCHETYPES.map(a => a.id)` plus `role`; each `static/cards/<pose>.png` exists, is a PNG, is 300 px tall and under 200 KB; `sprites.json` agrees with the files; the fourteen sources are distinct.
- [ ] **Step 2:** Run - expected: FAIL, `poses.json` missing.
- [ ] **Step 3:** Write the tool (launch Chrome the way `tools/ui-harness/audit.mjs` does; `CHROME_PATH` overrides). Run `node tools/cards/build-sprites.mjs`. Look at every output image yourself before committing: a number not erased, a neighbour's stray hand, or a hole where paper was cleared inside an outline is a bug in the tool, not something to accept.
- [ ] **Step 4:** `node tests/test-card-sprites.mjs` - expected: pass.
- [ ] **Step 5:** Commit - `cards: fourteen neutral sprites, cut from the owner's sheets`.

---

### Task 8: Drawing a card

**Files:** Create `card-sprites.mjs`, `card-face.jsx`, `data/card-skin.json`, `tests/test-card-face.mjs`. Modify `tests/test-cosmetics.mjs` or `tests/test-theme-contrast.mjs` only if card text needs a new token (prefer existing tokens).

**Interfaces - Produces:**
- `data/card-skin.json`: `{ "default": "#b98862", "tones": { "t1": "#f0c9a4", "t2": "#d9a877", "t3": "#b98862", "t4": "#8d5a3b", "t5": "#5f3b26" }, "players": {} }`. `players` maps `pid` to a tone key and is empty in this plan.
- `card-sprites.mjs` (pure, no DOM at import):
  - `recolourPixels(data: Uint8ClampedArray, colours: { jersey, metal, skin }) -> Uint8ClampedArray` - the prototype's mapping: blue (hue 195-250, sat > 0.28) to `jersey`, low-saturation grey to `metal`, tan (hue 14-42, lightness 0.45-0.85) to `skin`, each keeping the pixel's own shading by scaling lightness against the region's median. Everything else untouched, alpha untouched.
  - `cardColours(card, skin) -> { jersey, metal, skin }` - `TEAMS[card.team][2]`, `[3]`, and the tone for `card.pid` or the default.
  - `spriteFor(card) -> "/cards/<archetype or role>.png"`
  - `paintSprite(img, colours) -> string | null` - draws to a canvas, recolours, returns a data URL; returns `null` if there is no canvas or `getImageData` throws. Memoised on pose + colours.
- `card-face.jsx`: `CardFace({ card, finish = "base", count = 1 })` and `CARD_FACE_CSS`. Markup follows the mockup (`docs/superpowers/specs/2026-11-13-card-collection/mockup.html`): position chip, rating (with `+N` for a finish), team code, season, sprite, name, archetype pill, three stats by position (QB: pass yards, TD, yards/attempt; RB: rush yards, TD, yards/carry; WR and TE: receiving yards, TD, yards/catch), finish label, and a `x3` count badge when `count > 1`. Root carries `data-card`, `data-finish` and an `aria-label` that reads the whole card in words. The sprite is an `<img alt="">` that starts on the neutral file and swaps to the recoloured data URL after load. Finish animation is `background-position` only and is inside a `prefers-reduced-motion` rule.

- [ ] **Step 1: Failing test** `tests/test-card-face.mjs`:
  - `recolourPixels` on a hand-built 4-pixel buffer (one jersey blue, one helmet grey, one skin tan, one white glove): the first three change hue to the targets, the white pixel and every alpha are unchanged, and a darker blue stays darker than a lighter blue after recolouring.
  - `cardColours` for a Vikings card is `TEAMS.MIN`'s two colours and the default tone; with `players: { [pid]: "t4" }` it is `tones.t4`.
  - `spriteFor` of 2007 Brady ends `/cards/gunslinger.png`; of a role player, `/cards/role.png`.
  - `renderComponent(CardFace, ...)`: the `aria-label` contains the name, season, team, position, rating and archetype label; a Gold card shows `+2`; `count: 3` shows `x3` and `count: 1` shows no badge; the three stat labels differ by position.
  - **Review Focus 6:** in jsdom (no canvas) the card renders with its text and the neutral `src`, and firing the image's `error` event throws nothing and leaves the text.
  - every colour in `CARD_FACE_CSS` used behind text clears WCAG AA against that text (reuse the contrast helper `tests/test-cosmetics.mjs` uses).
- [ ] **Step 2:** Run - expected: FAIL, modules not found.
- [ ] **Step 3:** Implement. Port the recolour arithmetic from the prototype script before deleting it in Task 7's commit if not already done.
- [ ] **Step 4:** `node tests/test-card-face.mjs` - expected: pass. Then add `screen=cardface` to `tools/ui-harness/harness.jsx` (a grid of one card per archetype across four finishes and several teams), build the harness, and **look at it in a real browser** at 375 px and desktop width: the recolouring only runs there.
- [ ] **Step 5:** Commit - `cards: a card, drawn`.

---

### Task 9: The card area and the collection

**Files:** Create `cards.jsx`, `tests/test-cards-screen.mjs`. Modify `perfect-season.jsx`, `tools/ui-harness/harness.jsx`, `tests/test-a11y.mjs`.

**Interfaces - Produces:**
- `cards.jsx`: `CardsScreen({ userId, isGuest, onBack, onNeedsAccount, onHide })` and `CARDS_CSS` (it appends `CARD_FACE_CSS`).
  States, exactly one on screen: **loading**; **could not load** ("Couldn't load your cards." + Try again); **signed out or guest** (one paragraph and a button calling `onNeedsAccount`); **no starter yet** (a paragraph and "Open your starter deck"); **collection**.
  Claiming: the button disables while in flight; success shows the eight cards under an `h2` "Your starter deck" then the collection; a refusal shows its sentence from a `CARD_SENTENCES` map keyed by every entry of `CARD_REFUSALS` plus `offline` and `network`, and `duplicate` simply reloads the collection.
  Collection: an `h2` with the count ("12 cards"), a position filter (All, QB, RB, WR, TE) as buttons with `aria-pressed`, and a grid of `CardFace` sorted by rating descending then id. Owned ids missing from `CARDS` are skipped.
  A "Hide cards" text button calls `onHide`.
- `perfect-season.jsx`: `CARDS_HIDDEN_KEY = "ps-cards-hidden"`; a `.mode.m-cards` tile on Modes after the Mini games tile, rendered only when `cardsOn() && !cardsHidden`; `view === "cards"` in `HISTORY_VIEWS` with an `h1.vh` "Cards"; `openCards` / `leaveCards` beside `openCentury`; the Back handler leaves it for Modes; `CARDS_CSS` appended to `APP_CSS`; a "Show cards" link in the Modes `.sitefoot` when `cardsOn() && cardsHidden`. The card area uses the cream scope.

- [ ] **Step 1: Failing test** `tests/test-cards-screen.mjs` (boot as `tests/test-century-screen.mjs` does; `window.__ps_cards__ = true`):
  - with `__ps_cards__ = false` there is no Cards tile; with it true there is, and `clickMode(container, "Cards")` opens the screen.
  - signed out: the account prompt; a guest: the same, and no starter button.
  - a new account: the starter button; pressing it shows eight `[data-card]` and the count "8 cards"; a second mount shows the collection and no button.
  - the position filter: pressing QB leaves only cards whose label says quarterback, `aria-pressed` moves.
  - **Review Focus 3:** with the mock's `card_owned` read failing, the screen shows "Couldn't load your cards." and Try again, and shows neither "0 cards" nor the starter button; Try again after the failure is cleared loads the collection.
  - **Review Focus 4:** an owned row with `card_id: 999999` beside two real ones renders two cards and the count says 2.
  - **Review Focus 5:** with the mock's server switch off, pressing the starter button shows the `cards_off` sentence and it does not contain "connection".
  - every key of `CARD_REFUSALS`, plus `offline` and `network`, has a non-empty entry in `CARD_SENTENCES`.
  - Hide cards: the tile is gone from Modes, "Show cards" is in the footer, pressing it brings the tile back, and the choice survives a remount.
  - Back from the card area returns to Modes.
- [ ] **Step 2:** Run - expected: FAIL, no Cards tile.
- [ ] **Step 3:** Implement. Put base CSS rules before responsive ones; touch targets inside `@media (pointer:coarse)`; hover inside `@media (hover:hover)`.
- [ ] **Step 4:** `node tests/test-cards-screen.mjs && node tests/test-nav.mjs && node tests/test-app-shell.mjs && node tests/test-site-pages.mjs` - expected: pass. Add the card area (starter state and collection state) to `tests/test-a11y.mjs` and run it. Add `screen=cards` to the UI harness and run `node tools/ui-harness/audit.mjs` on it at 320, 375, 430, 768 and 667x375.
- [ ] **Step 5:** Commit - `cards: the card area and your collection`.

---

### Task 10: The daily card on the result screen

**Files:** Modify `perfect-season.jsx`, `tests/test-cards-screen.mjs`.

**Interfaces - Consumes:** `res.card` from Task 5 through `showSaveAnswer` (it already merges `coins` and `newBadges` into `result`); `CardFace`, `loadCardData`.
**Produces:** `showSaveAnswer` also merges `card: res.card ?? null`. A `SeasonCard({ card, onOpenCards })` rendered directly after `SeasonCoins`, under the same `result.payer === userId` condition, only when `cardsOn() && !cardsHidden && result.card`. It shows "Today's card" as an `h3`, the `CardFace`, and a "See your cards" text button. It loads the catalog itself and renders nothing until it has, so it can never delay or cover the result.

- [ ] **Step 1: Failing tests** added to `tests/test-cards-screen.mjs`: finish a daily as a signed-in account (reuse the helper `tests/test-daily-submit.mjs` uses to play one) - the result shows "Today's card" with one `[data-card]` after the coins line, and the collection then holds it; with cards hidden the block is absent **and the account still owns the card**; an Unlimited season shows no block; a guest's result shows none.
- [ ] **Step 2:** Run - expected: FAIL, no "Today's card".
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `node tests/test-cards-screen.mjs && node tests/test-result-moments.mjs && node tests/test-shop-flow.mjs` - expected: pass.
- [ ] **Step 5:** Commit - `cards: the daily shows the card it earned`.

---

### Task 11: Docs, release notes, version

**Files:** Modify `CARDS.md`, `CLAUDE.md`, `CHANGELOG.md`, `package.json`, `DATA.md` (cards.json is now a shipped data file on staging), `tests/test-site-pages.mjs` (add `cards.json` to the zero-URL list).

- [ ] **Step 1:** `CARDS.md`: replace "Not built" with what now exists - the two tables and why no client writes them; `grant_cards` and its reasons; `card-claim` and its answers in order; the daily card and why its ref is the date alone; the switch on both sides; the sprite pipeline and the pose table; the skin file's shape and that `players` is empty; the three read states; the runbook lines (give a card: `select grant_cards('<uuid>', 'starter', '[...]')` is service-role only, so in the SQL editor insert into `card_grants` and `card_owned` by hand; turn cards off in an environment: unset the secret and redeploy the client with `CARDS_ON=`).
- [ ] **Step 2:** `CLAUDE.md`: update the Cards section; add the five new test files to the test list; add a Releasing entry for v2.23.0 - **run `migration-cards.sql` and re-run `migration-profiles.sql`; set the secret `CARDS_ENABLED=1` on the staging project only; `node deploy-function.mjs <env>` (seven functions now); then the client.** State what happens out of order: a client ahead of the function gets a 404 on the starter button; a function ahead of the migration answers 500 `server`; a missing secret answers `cards_off`. State that production needs no secret and no client flag, and that the migration and functions are inert there.
- [ ] **Step 3:** `CHANGELOG.md` entry and `package.json` version `2.23.0`.
- [ ] **Step 4:** `node tests/run-all.mjs` - expected: every file passes.
- [ ] **Step 5:** Commit - `2.23.0: cards on the test site - a starter deck, a daily card, a collection`.

After the last task: staging needs the migration run, the secret set and the functions deployed by someone with Supabase access before the client is pushed. That is a step outside the worktree: stop and ask the owner before doing any of it.
