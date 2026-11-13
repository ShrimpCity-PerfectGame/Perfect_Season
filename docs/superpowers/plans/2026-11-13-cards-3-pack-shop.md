# Cards, plan 3 of 5: the pack shop - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in player on the test site can spend coins on a card pack, see exactly who is inside it and at what odds before buying, and watch the cards they pulled land in their collection.

**Architecture:** A pack's contents and odds live in one pure module, `card-packs.mjs`, imported by the browser (to show them) and by the `card-claim` Edge Function (to roll them), so the odds on screen are the odds rolled. Price, on-sale and stock are rows in a new `card_packs` table. Opening a pack is one SQL function, `buy_pack`, which locks the wallet, takes stock, debits and grants in a single transaction; the Edge Function chooses the cards with a cryptographic generator and hands them to it.

**Tech Stack:** as plan 2 - Postgres + PGlite tests, Deno Edge Functions through `tests/edge-harness.mjs`, React 18, esbuild.

**Spec:** `docs/superpowers/specs/2026-11-13-card-collection-design.md` (section 5). **Reference:** `CARDS.md` section 8 for what plans 1 and 2 built, and `SHOP.md` for how the wallet moves coins. Read all three first.

**Not in this plan:** battles (4), badges, profile and boards (5), trading duplicates in, real-money anything.

## Global Constraints

- **Coins only move inside the database**, under `wallet_lock`, as a ledger row with a unique (user, kind, ref). A pack is ledger kind `pack`, ref the open id.
- **A purchase is all or nothing.** The stock check, the debit and every card grant are one transaction: a failure leaves no debit, no stock taken and no cards.
- **The price is read from the row inside `buy_pack`**, never taken from a caller.
- **The odds a player reads are the odds the server rolls from**: both come from `card-packs.mjs`. A test compares what the screen prints with `packOdds`.
- **Retrying a purchase never charges twice.** The browser makes one open id per tap and reuses it on a retry; `buy_pack` answers a repeated id with the cards it granted the first time.
- Guests cannot buy (`guest_not_allowed`). With `CARDS_ENABLED` unset the function touches no database.
- No browser writes `card_packs`, `card_owned` or `card_grants`. Every refusal reason the client can receive is in `CARD_REFUSALS`, held to the function source and the SQL by a test.
- `card-packs.mjs` is pure: no `Math.random`, no DOM. Exactly two draws per card pulled.
- Pack names are text the game draws; pack art carries no words that matter (one owner image has "Football Booster / Common tier" baked in and is used as a placeholder, noted in CARDS.md).
- The client and the functions ship together: `card-packs.mjs` is bundled into both.
- Version **2.24.0**, a `CHANGELOG.md` entry, on the test site only. Branch from `staging`; one commit per task.

## Review Focus

1. **Two tabs buy the last one of a limited pack at the same moment** - one gets it, the other is told it sold out, and neither is charged without cards. Pinned in Task 2.
2. **The purchase request is retried** (a dropped response, a double tap) - one debit, one set of cards, and the retry shows those same cards. Pinned in Tasks 2 and 3.
3. **Not enough coins, discovered at the server** (the balance on screen was stale) - nothing is taken and the screen says so in words and shows the real balance. Pinned in Tasks 2 and 5.
4. **A price or stock row changes while the pack screen is open** - the purchase goes through at the row's price or is refused; it is never charged at the stale price shown. Pinned in Task 2 (SQL reads the price) and Task 5 (the screen shows what was charged).
5. **The pack rows fail to load** - the screen says it could not load the shop, with Try again; it never shows packs as free, sold out or absent. Pinned in Task 5.
6. **A pack id the module knows and the table does not (or the reverse)** - the pack is not offered, and a request for it is refused as `unavailable`, never granted. Pinned in Tasks 3 and 5.

---

### Task 1: What is in a pack

**Files:** Create `card-packs.mjs`, `tests/test-card-packs.mjs`.

**Interfaces - Produces:**
- `PACKS: Pack[]`, `PACK_BY_ID`. `Pack = { id, name, blurb, size, finish: { base, silver, gold, prism }, limited: boolean, has(card) -> boolean, art }`.
- `packCards(pack) -> Card[]` - the cards the pack can hold, sorted by id (needs `initCardData` to have run).
- `cardWeight(card) -> number` - rarer the better the card: rating under 60 -> 10; 60 to 79 -> 6; 80 to 99 -> 3; 100 to 119 -> 1.5; 120 and up -> 0.6.
- `packOdds(pack) -> { id, chance }[]` - each card's chance of being a given pull, summing to 1, sorted by chance descending then id.
- `rollPack(pack, rand) -> { id, finish }[]` - `size` different cards, drawn by weight without replacement, each with a finish from `rollFinish(rand, pack.finish)`. Exactly `2 * size` draws.

The three packs (prices are rows, Task 2):

| id | Name | Size | Holds | Finish odds (base / silver / gold / prism) | Limited |
|---|---|---|---|---|---|
| `pack-standard` | Standard pack | 3 | every card | 0.70 / 0.22 / 0.07 / 0.01 | no |
| `pack-air-raid` | Air raid pack | 3 | archetypes gunslinger, volume, deep, seam, possession | 0.70 / 0.22 / 0.07 / 0.01 | no |
| `pack-legends` | Legends pack | 1 | rating 100 and up | 0 / 0 / 0.85 / 0.15 | yes |

- [ ] **Step 1: Failing test** `tests/test-card-packs.mjs`:
  - three packs with exactly those ids; each `finish` sums to 1; each pack holds at least `size * 5` cards; Legends holds only cards rated 100 or more; Air raid only the five archetypes.
  - `packOdds`: chances sum to 1 (within 1e-9), all positive, sorted; in the Standard pack a card rated 125 is less likely than one rated 45, in the ratio of their weights.
  - `rollPack`: over 2,000 seeded rolls of each pack - always `size` cards, never the same card twice in one pack, every card in `packCards`, a counting `rand` called exactly `2 * size` times; the same seed gives the same pack.
  - measured against the stated odds: over 60,000 seeded Standard pulls, the share of pulls that are rated 100 or more is within 15% (relative) of the sum of those cards' `packOdds`, and each finish's share is within 0.01 of its odds (prism within 0.003). Legends never rolls base or silver.
- [ ] **Step 2:** run - expected FAIL, module not found.
- [ ] **Step 3: Implement.** Weighted draw without replacement: cumulative weights over the remaining cards, one draw to pick, one for the finish.
- [ ] **Step 4:** run - expected pass.
- [ ] **Step 5:** Commit - `cards: what is in a pack, and its odds`.

---

### Task 2: `card_packs` and `buy_pack`

**Files:** Modify `supabase/migration-cards.sql`, `tests/test-cards-sql.mjs`, `tests/mock-cards.mjs`.

**Interfaces - Produces:**
```sql
public.card_packs (id text primary key, price integer not null check (price > 0), size integer not null check (size between 1 and 10),
                   active boolean not null default true, stock_total integer check (stock_total > 0), stock_left integer check (stock_left >= 0),
                   sort integer not null default 0)
public.buy_pack(p_user uuid, p_pack text, p_open text, p_cards jsonb) returns jsonb   -- security definer, service_role only
```
- `card_packs`: RLS on, one policy `for select using (true)` (prices and stock are public, like the shop's), no write policy. Seeded with `on conflict (id) do nothing` so a price changed by hand survives a re-run: `pack-standard` 150 coins, size 3; `pack-air-raid` 250, size 3; `pack-legends` 1500, size 1, `stock_total` and `stock_left` 5000.
- `wallet_ledger`'s kind check gains `'pack'`. It is an inline check in `migration-wallet.sql`, so this file drops `wallet_ledger_kind_check` if it exists and re-adds it with the full list (`starting, welcome, season, daily, badge, minigame, purchase, pack`); verify the constraint's real name on PGlite first and say so in a comment. `card_grants_kind_check` gains `'pack'` the same way, and so does the list inside `grant_cards`.
- `buy_pack`, in this order: `no_profile`; `guest_not_allowed`; `bad_open` (`p_open` not 8 to 40 characters of `[A-Za-z0-9-]`); **`v_balance := wallet_lock(p_user)`**; if a ledger row `(p_user, 'pack', p_open)` already exists, return `{ duplicate: true, cards: <the card_grants rows whose ref starts with p_open || ':', as [{card, finish}]>, balance, stock_left }` without touching anything; `unavailable` (no row, or not active); `bad_grant` (`p_cards` is not a list of exactly the pack's `size` valid entries `{card, finish}`); `sold_out` (`stock_left = 0`); `not_enough` (`v_balance < price`); then `update card_packs set stock_left = stock_left - 1 where id = p_pack and stock_left is not null`; `wallet_apply(p_user, -price, 'pack', p_open)` which must return `-price` or raise `purchase_conflict`; `grant_cards(p_user, 'pack', [{ ref: p_open || ':' || i, card, finish }...])`; return `{ duplicate: false, cards, balance, stock_left, price }`.
- `tests/mock-cards.mjs` gains `packs` (the table), `buyPack(userId, packId, open, cards)` mirroring it exactly, and needs the wallet: `makeCards(state, { wallet })` where `wallet` exposes `balanceOf(userId)` and an `apply(userId, amount, kind, ref)` matching `wallet_apply` (use the existing mock wallet's own functions; read `tests/mock-wallet.mjs` for their names).

- [ ] **Step 1: Failing tests** in `tests/test-cards-sql.mjs`:
  - clients cannot insert, update or delete `card_packs`; anyone can read it; `buy_pack` is not executable by `anon` or `authenticated`.
  - a purchase with enough coins: balance down by exactly the row's price, `card_owned` up by `size`, one ledger row of kind `pack`, the return's `cards` equal to what was sent.
  - **Review Focus 2:** the same `p_open` again with different cards: `duplicate: true`, the ORIGINAL cards returned, balance and ownership unchanged.
  - **Review Focus 3:** balance one coin short: `not_enough`, and balance, stock, ledger and ownership all unchanged.
  - **Review Focus 4:** `update card_packs set price = 999` then buy: charged 999.
  - **Review Focus 1:** set `stock_left = 1`; two purchases with different open ids: one succeeds, the other raises `sold_out` and is not charged; `stock_left` is 0, never negative. (Run serially - PGlite is one connection - and say in a comment that the row update's lock is what serialises real transactions.)
  - inactive pack and unknown pack: `unavailable`. Guest: `guest_not_allowed`. Two cards for a size-3 pack, a bad finish, a card id of zero: `bad_grant`, nothing written. `p_open` of `"x"` or with a space: `bad_open`.
  - the seed: three rows with the stated prices and sizes, and each row's `size` equals `PACK_BY_ID[id].size` (import `card-packs.mjs`).
  - re-running the migration after `update card_packs set price = 175 where id = 'pack-standard'` leaves 175.
  - one mixed sequence through SQL and through the mock's `buyPack`: every return and the final balance, stock and ownership are identical.
- [ ] **Step 2:** run - expected FAIL, `card_packs` does not exist.
- [ ] **Step 3:** Implement the SQL and the mock. Run `node tests/test-migrations.mjs` too (the file is re-run three times there).
- [ ] **Step 4:** `node tests/test-cards-sql.mjs && node tests/test-migrations.mjs && node tests/test-wallet-sql.mjs && node tests/test-economy-security.mjs` - expected: all pass.
- [ ] **Step 5:** Commit - `cards: buying a pack is one transaction`.

---

### Task 3: Opening a pack through `card-claim`

**Files:** Modify `supabase/functions/card-claim/index.ts`, `tests/test-cards-edge.mjs`, `tests/mock-cards.mjs`, `storage-cards.js`.

**Interfaces - Produces:** `POST card-claim { "action": "open_pack", "pack": "<id>", "open": "<open id>" }`.
- After the existing checks (signed_out, malformed, cards_off, profile, guest): `unknown_pack` (400) when `PACK_BY_ID[pack]` is missing; `malformed` when `open` is not a string. Then `rollPack(pack, secureRand)` and `service.rpc("buy_pack", { p_user, p_pack, p_open, p_cards })`.
- An rpc error whose message is one of `unavailable`, `sold_out`, `not_enough`, `bad_open`, `guest_not_allowed`, `no_profile` is answered with that reason (409 for `sold_out` and `not_enough`, 400 otherwise); anything else is 500 `server`.
- Success: 200 `{ ok: true, cards: [{ id, finish }], balance, stockLeft, price, duplicate }`.
- `CARD_REFUSALS` gains `unknown_pack`, `unavailable`, `sold_out`, `not_enough`, `bad_open`.
- `storage-cards.js`: `fetchPacks() -> { status: "ok", packs: [{ id, price, size, active, stockTotal, stockLeft }] } | { status: "error" }` (a plain select, ordered by `sort`); `openPack(packId, openId) -> { ok: true, cards, balance, stockLeft, price, duplicate } | { ok: false, reason }`, classified exactly as `claimStarter` is; `newOpenId() -> string` (`crypto.randomUUID()`).

- [ ] **Step 1: Failing tests** in `tests/test-cards-edge.mjs` (the store's `rpcs.buy_pack` is the mock's `buyPack` over a mock wallet with a known balance):
  - a Standard pack: 200, three cards all in `packCards(standard)`, balance down by 150, `buy_pack` called once.
  - **Review Focus 2:** the same `open` again: 200, `duplicate: true`, the same three cards, balance unchanged.
  - **Review Focus 6:** `pack: "pack-nope"` -> 400 `unknown_pack`, no rpc; a pack the module knows with its row deleted -> 400 `unavailable`, nothing charged.
  - balance 100 -> 409 `not_enough`; stock 0 on Legends -> 409 `sold_out`; guest -> 403 `guest_not_allowed`; switch off -> 403 `cards_off` and no rpc, for this action too.
  - `rpcFails.buy_pack` -> 500 `server`.
  - every `reason` in the function source and every `raise exception '<word>'` inside `buy_pack` in the SQL file is in `CARD_REFUSALS` (`purchase_conflict` and `bad_grant` may map to `server`: assert they are either listed or deliberately excluded by name in the test).
  - in `tests/test-cards-client.mjs`: `fetchPacks` returns the three rows; with the mock's packs read failing it returns `error`; `openPack` round-trips and a retry with the same id returns the same cards.
- [ ] **Step 2:** run - expected FAIL, unknown action answers `malformed`.
- [ ] **Step 3:** Implement the function arm, the mock's `openPack` mirror routed from `functions.invoke("card-claim")`, the client functions, and a `card_packs` read in the mock's `from` (public, no user filter, honouring a `packsReadFail` switch).
- [ ] **Step 4:** `node tests/test-cards-edge.mjs && node tests/test-cards-client.mjs` - expected pass.
- [ ] **Step 5:** Commit - `cards: opening a pack`.

---

### Task 4: Pack art

**Files:** Create `static/cards/packs/pack-standard.png`, `pack-air-raid.png`, `pack-legends.png`, `tools/cards/build-pack-art.mjs`. Modify `tests/test-card-sprites.mjs`.

The owner's three examples are in `docs/superpowers/specs/2026-11-13-card-collection/` (`pack-example-common.jpg` -> standard, `pack-example-lightning.jpg` -> air raid, `pack-example-crown.jpg` -> legends). Move them to `tools/cards/source/`. The tool clears the cream paper by flood fill from the edges (the technique in `build-sprites.mjs`), trims, and writes each 480 px tall as PNG with transparency.

- [ ] **Step 1: Failing test** added to `tests/test-card-sprites.mjs`: for each id in `PACKS` there is `static/cards/packs/<id>.png`, a PNG with an alpha channel, 480 px tall, under 350 KB.
- [ ] **Step 2:** run - expected FAIL, files missing.
- [ ] **Step 3:** Write and run the tool. **Look at all three outputs** on a dark and a light ground before committing: JPEG edges leave a pale fringe, so if the fringe shows, widen the flood's tolerance or erode one pixel, and say what was done in the tool's header.
- [ ] **Step 4:** run - expected pass.
- [ ] **Step 5:** Commit - `cards: three pack wrappers, cut from the owner's art`.

---

### Task 5: The Packs screen

**Files:** Modify `cards.jsx`, `perfect-season.jsx` (pass `balance` and `onBalance`), `tests/test-cards-screen.mjs`, `tools/ui-harness/harness.jsx`, `tests/test-a11y.mjs`.

**Interfaces - Produces:**
- `CardsScreen` gains props `balance: number | null` and `onBalance(balance)`. The app passes `wallet?.balance ?? null` and its existing `onShopBalance`.
- Two tabs at the top of the card area, buttons with `aria-pressed`: **Collection** and **Packs**. Packs is available in the `starter` and `collection` phases.
- **Packs tab.** States: loading; could not load ("Couldn't load the pack shop." + Try again); the list. Your balance is shown as "N coins" (or nothing when `balance` is null).
- **A pack tile** (`.cd-pack`, `data-pack="<id>"`) shows: art, name (an `h3`), blurb, "N cards", the finish odds as four labelled percentages, the price, and for a limited pack "X of Y left" or "Sold out". Only packs present in BOTH `PACKS` and the fetched rows, and `active`, are shown.
- **Who is inside:** a `<details>` per tile, summary "Who is inside (N players)". Its body lists the ten most likely cards as "2011 Devery Henderson - 1.2%" from `packOdds`, then a "Show all N" button that renders the rest. Percentages use two significant figures below 1% and one decimal above.
- **Buying:** the tile's button reads "Open - 150 coins". Pressing it changes it to "Confirm - 150 coins" with a Cancel beside it; Confirm calls `openPack(id, openId)` with an id made once per confirmation and reused if the request is retried from the error state. Disabled, with the reason as text beside it, when `balance` is known and under the price ("Not enough coins") or the pack is sold out.
- **After opening:** a section "You pulled" (an `h2`, focused when it appears, `tabIndex={-1}`) showing the cards with `CardFace`, the line "150 coins spent - N left", and "Open another" / "See your collection". `onBalance(res.balance)` is called, the collection is reloaded, and the pack rows are refetched (stock moved).
- **Refusals:** `CARD_SENTENCES` gains `unknown_pack`, `unavailable` ("That pack isn't on sale any more."), `sold_out` ("Sold out - somebody got the last one."), `not_enough` ("Not enough coins. You have N."), `bad_open`. After `not_enough` the screen calls `onBalance` with a freshly fetched balance (`fetchWallet`) so the number it then shows is the real one.

- [ ] **Step 1: Failing tests** in `tests/test-cards-screen.mjs` (give the test account coins through the mock wallet):
  - the Packs tab lists three tiles in `sort` order with the rows' prices; the finish odds printed on the Standard tile are its four `finish` values as percentages.
  - Who is inside on Air raid: the summary's count equals `packCards(air raid).length`; the first listed card and its percentage equal `packOdds(pack)[0]` formatted as specified; Show all renders every card.
  - buying Standard: Open then Confirm; "You pulled" has three `[data-card]`, all in the Standard pool; the spent line names 150 and the new balance; `onBalance` reached the app (the header's coin count changed); the Collection tab's count went up by three.
  - Cancel after Open charges nothing and restores the button.
  - **Review Focus 3:** set the mock balance below the price after the screen has loaded; Confirm shows the `not_enough` sentence with the real balance, no cards, and the button then reads disabled with "Not enough coins".
  - **Review Focus 4:** change the row's price in the mock after load; Confirm succeeds and the spent line shows the row's price, not the one the tile showed.
  - **Review Focus 5:** with the pack rows read failing, "Couldn't load the pack shop." and Try again, no tiles; Try again after clearing it shows them.
  - **Review Focus 6:** delete a pack's row: its tile is absent. Add a row with an id the module does not know: no tile and no crash.
  - Legends with `stock_left` 0: "Sold out", button disabled; with 3 of 5000: "3 of 5,000 left".
  - a guest and a signed-out visitor see no Packs tab.
  - every key of `CARD_REFUSALS` still has a sentence.
- [ ] **Step 2:** run - expected FAIL, no Packs tab.
- [ ] **Step 3:** Implement. Reveal animation: a staggered fade only, inside a `prefers-reduced-motion` guard. Base CSS before responsive; touch targets in `@media (pointer:coarse)`.
- [ ] **Step 4:** `node tests/test-cards-screen.mjs && node tests/test-shop-flow.mjs && node tests/test-shop-screen.mjs` - expected pass. Add `screen=cards&tab=packs&coins=N` to the harness and both the pack list and the pulled state to `tests/test-a11y.mjs`; run it. Look at the pack list in a real browser at 320, 375 and desktop width.
- [ ] **Step 5:** Commit - `cards: the pack shop`.

---

### Task 6: The economy, stated

**Files:** Modify `tests/test-economy-security.mjs`, `tests/test-card-balance.mjs` (no band changes), `CARDS.md`.

- [ ] **Step 1:** Add a printed section to `tests/test-economy-security.mjs`, in the file's existing style: packs a day an honest player can open from one day's coins (a Daily at 40 plus wins and streak, four mini games at 15, twenty paid seasons); how many Standard packs the 10,000-coin starting-balance cap buys; the expected number of packs to pull any card rated 120 or more from Standard and from Legends (from `packOdds`); how many days to exhaust the Legends stock if one player bought nothing else. Assert only what must hold: a pack's price is positive, no pack can be opened for free, and the 10,000 cap buys fewer than 100 Standard packs.
- [ ] **Step 2:** run and read the numbers. If a day's honest play opens more than four Standard packs, or the cap buys more than seventy, raise the Standard price in the seed and in the test, and say why in CARDS.md. Do not tune silently.
- [ ] **Step 3:** Commit - `cards: what packs cost, measured`.

---

### Task 7: Docs, release notes, version

**Files:** `CARDS.md`, `CLAUDE.md`, `CHANGELOG.md`, `package.json`.

- [ ] **Step 1:** `CARDS.md` - a section on packs: the module and why contents are not rows; the three packs; `card_packs` and what an owner may change (price, `active`, stock); `buy_pack`'s order of checks and its reasons; the open id and why a retry is safe; the pack-art placeholders (one has words baked in); the runbook - change a price, take a pack off sale, restock a limited pack (`update card_packs set stock_left = stock_total where id = ...`), and adding a pack (a module entry, a seed row whose `size` matches, art, and a release of client and functions together).
- [ ] **Step 2:** `CLAUDE.md` - update the Cards section and test list; Releasing entry for v2.24.0: **re-run `migration-cards.sql`, deploy the Edge Functions, then the client; the client and functions must ship together** because both carry `card-packs.mjs`. Out of order: a client ahead of the function gets `malformed` on Open (say so); a function ahead of the migration answers `server`.
- [ ] **Step 3:** `CHANGELOG.md` and `package.json` `2.24.0`.
- [ ] **Step 4:** `node tests/run-all.mjs` - expected: every file passes.
- [ ] **Step 5:** Commit - `2.24.0: the pack shop, on the test site`.

After the last task, the test site needs the migration re-run and the functions deployed before the client is pushed. Stop and ask the owner before doing any of it.
