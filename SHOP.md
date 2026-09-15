# SHOP.md — the v1.12.0 Wallet & Shop contract

This is the build contract for **Gridspin v1.12.0 Wallet & Shop**. Five agents build it in parallel (I–M), each
owning separate files (see [Who owns what](#10-who-owns-what)), and two check it afterwards (N, O). Every piece is
built against this document. **If something here turns out to be wrong or impossible, stop and report it — don't
improvise a different contract.** After release this file stays as the reference for coins and the shop, like
`PROFILES.md` for profiles. CLAUDE.md's rules and PROFILES.md's conventions all still apply: row-level security with
no client write policies, database functions that raise their code as the message, read-only functions called as
GET, one owner per file, prefixed class names.

---

## 1. What ships

The owner approved all of this (2026-09-14, plan v2):

- **Coins**, in a wallet that only goes up by playing and only goes down by spending, and never below zero. Earned
  from finished seasons ([4.1](#41-rewardsmjs)), badges (bronze 100, silver 300, gold 1,000, special 500; Stat Nerd
  and Mad Scientist pay nothing, since the browser writes those games' scores), and Over/Under and Build-a-player
  (15 each, once a day). A DNF pays nothing and costs nothing. Unlimited, Genius and GM pay for the first 20
  finished seasons each day (UTC); the Daily always pays.
- **Starting balance.** Every account from before v1.12.0 gets its career so far, paid once: 20 per season, 2 per
  win, 10 per playoff trip, 50 per title, 150 per perfect season, never less than a new account's 250 and at most
  10,000. New accounts start with 250. Badges a player has already earned pay out with their next finished season.
- **The shop**: cosmetics only, no real money. Prices by rarity: Common 750, Rare 2,000, Epic 6,000, Legendary
  15,000 — rows in the database, changed with one line of SQL. Frames, card themes, titles and avatar packs; some
  items are unlocked only by a badge. A free **showcase** picks which three badges sit on your card.
- **Where it shows.** Your equipped frame, card theme and title on your profile card, for everyone who views it;
  your frame on your header picture; your balance and a **Shop** button on your own card; the coins a season earned
  and any new badges on the result screen, with a Shop button; "+15 coins" on the Over/Under and Build-a-player end
  screens. No new nav tab.
- **A draft counts once.** The server refuses a second finished season on the same challenge code from the same
  account. Today the same finished Unlimited draft counts every time it's sent.

Not in v1.12.0: pictures or frames beside names on the boards, gifting, rotating stock or sales, refunds, real
money, coins for guests, a coin leaderboard, badge earned dates.

---

## 2. How it fits together

```
perfect-season.jsx (M) ── the Shop view, coins on the result screen, minigame claims, framed header picture
   ├─ shop.jsx (L) ────────── ShopScreen, WalletPanel
   ├─ profile.jsx (L) ─────── the card wears its cosmetics; balance and Shop button for the owner
   │     └─ cosmetics.jsx (K) ─ FramedAvatar, CardTheme, TitleLine, Coins, ItemPreview
   │           └─ avatars.jsx, avatar-picker.jsx (K) ─ the three avatar packs
   └─ storage.js ─ re-exports storage-shop.js (J)
                      └─ database functions: migration-wallet.sql (I), migration-shop.sql (J)
supabase/functions/submit-run (I) ── pays seasons and badges through rewards.mjs (I) + badges.mjs
shop-catalog.mjs (lead) ── item ids, names, kinds and the avatar packs, shared by all of the above
```

**Security model.** Nothing new is client-writable, and the wallet tables aren't even client-readable: a player
reads their own wallet and shop through functions. Coins come in only three ways:
1. the submit-run Edge Function, with its service-role key, calling `credit_coins` and `award_badges`, which no
   client can call;
2. `claim_minigame`, which pays a fixed 15 at most once a day per game, and only once the player has a row in that
   game's table;
3. the migration's one-time starting balance and the signup trigger's welcome coins.

Coins go out only through `shop_buy`. A modified browser can call every client-callable function directly, so
every rule that matters lives in SQL; the browser's own checks are only for friendly messages.

**Deploy order** (the lead does this): `migration-wallet.sql` → `migration-shop.sql` → re-run
`migration-profiles.sql` (`set_avatar` learns the paid packs) → deploy submit-run → client. The new submit-run
works with the old client (it only adds fields to its answer), but it needs the migrations first.

---

## 3. Database

All new SQL is re-runnable and follows PROFILES.md 3's rules: `set search_path = public, pg_temp` on every
function, `stable` for reads, every `order by` fully tiebroken, a refusal raised as its code
(`raise exception 'not_enough' using errcode = 'P0001'`), and `revoke execute ... from public, anon, authenticated`
for anything clients must not call.

Ledger `kind`s and their `ref`s:

| kind | amount | ref |
|---|---|---|
| `starting` | + the starting balance | `career` |
| `welcome` | + 250 | `welcome` |
| `season` | + an Unlimited, Genius or GM season's coins | the challenge code |
| `daily` | + a Daily's coins | `<date>:<format>`, e.g. `2026-09-14:fantasy` |
| `badge` | + the badge's coins | the badge id |
| `minigame` | + 15 | `<game>:<UTC date>`, e.g. `over_under:2026-09-14` |
| `purchase` | − the price | the item id |

### 3.1 `migration-wallet.sql`

**Phase 0 wrote** the tables and two internal helpers:

| table | columns |
|---|---|
| `wallets` | `user_id` pk → profiles (cascade), `balance`, `earned`, `spent` (bigint, ≥ 0, and `balance = earned - spent`), `updated_at` |
| `wallet_ledger` | `id` identity pk, `user_id` → profiles (cascade), `amount` bigint ≠ 0, `kind` (above), `ref` text 1–200, `created_at`; **unique (user_id, kind, ref)** |
| `badge_awards` | `user_id` → profiles (cascade), `badge` `^[a-z0-9-]{1,40}$`, `awarded_at`; pk (user_id, badge). The badges whose coins have been paid. |
| `finished_codes` | `user_id` → profiles (cascade), `code` text 1–32, `created_at`; pk (user_id, code). The free-mode codes an account has finished a season on. |

All four: RLS on, no policies, every privilege revoked from `anon` and `authenticated` — and the ledger's id sequence
too (Supabase's default privileges hand clients every new sequence, and one set to its maximum would stop every
ledger write).

- `wallet_lock(p_user uuid) → bigint` — creates an empty wallet if there's none, locks the row until the transaction
  ends, returns the balance. **Every function that moves coins or decides something on a balance takes this lock
  first**, so two purchases (or a purchase and a credit) at the same moment wait for each other, and every path locks
  the wallet before touching the ledger (no deadlocks). The read-only `wallet_state` and `shop_state` don't lock (a
  stable function can't, and nothing is decided on the balance they show).
- `wallet_apply(p_user uuid, p_amount bigint, p_kind text, p_ref text) → bigint` — locks the wallet, records
  `(user, kind, ref)` in the ledger and moves the wallet by `p_amount`. Returns `p_amount`, or 0 when that
  `(user, kind, ref)` is already recorded or the amount is 0. A debit the balance can't cover breaks `wallets`' check
  and rolls the whole transaction back, so callers check the balance first and raise their own code.

Both are security invoker, and clients can't execute them.

**Agent I writes the rest:**

| function | returns | notes / raises |
|---|---|---|
| `credit_coins(p_user uuid, p_amount bigint, p_kind text, p_ref text, p_daily_cap integer default null)` | jsonb `{ "credited", "balance", "capped", "duplicate" }` | security definer; **service role only** (revoked from public, anon, authenticated). Raises `no_such_player`, `bad_kind` (only `season` and `daily`), `bad_amount` (null, negative or over 10,000), `bad_ref` (null, empty or over 200 characters). Takes the wallet lock; then, when `p_daily_cap` isn't null and the player already has that many rows of `p_kind` since UTC midnight, credits nothing (`capped: true`); otherwise `wallet_apply` (`duplicate: true` when it returned 0 for an amount above 0). |
| `award_badges(p_user uuid, p_badges jsonb)` | jsonb `{ "awarded": [ids], "credited", "balance" }` | security definer; **service role only**. `p_badges` is `[{ "id": text, "coins": integer }]`, at most 50, ids `^[a-z0-9-]{1,40}$`, coins 0–10,000, else `bad_request`; `no_such_player`. Takes the wallet lock, then for each entry in order inserts `badge_awards` (on conflict do nothing); a newly inserted one goes into `awarded` and, with coins above 0, `wallet_apply(p_user, coins, 'badge', id)`. |
| `claim_minigame(p_game text)` | jsonb `{ "credited", "balance" }` | security definer; `authenticated` only. Raises `not_signed_in`, `bad_game` (not `over_under` or `build`), `not_played` (no `sou_runs` row — for over_under — or `builds` row — for build — with the caller's `user_id` created in the last 24 hours). Takes the wallet lock, then `wallet_apply(uid, 15, 'minigame', '<game>:<UTC date>')`; `credited` 0 means today's is already claimed. |
| `wallet_state()` | jsonb `{ "balance", "earned", "spent", "recent": [{ "amount", "kind", "ref", "created_at" }] }` | stable, security definer; `authenticated` only. Raises `not_signed_in`. `recent`: the 20 newest ledger rows, `created_at desc, id desc`. No wallet yet: zeros and `[]`. |
| `create_wallet()` | trigger | After insert on `profiles` (trigger `profiles_create_wallet`): `wallet_apply(new.id, 250, 'welcome', 'welcome')`. |

At the bottom of the file, after the trigger exists, the **starting balance**: for every profile with no `starting`
or `welcome` ledger row, `wallet_apply(id, least(10000, greatest(250, 20*runs + 2*wins + 10*playoffs + 50*champs +
150*perfect)), 'starting', 'career')`, nulls counting as 0. A no-op the second time.

The database's own numbers (250, 15, 10,000, the starting formula, the 24-hour window) are `COIN_RULES`'s;
`tests/test-wallet-sql.mjs` checks the SQL against `rewards.mjs`.

### 3.2 `migration-shop.sql`

**Phase 0 wrote** the tables and seeds:

**`shop_items`**

| column | type | rule |
|---|---|---|
| `id` | text pk | `^[a-z0-9-]{1,40}$` |
| `kind` | text not null | `frame` \| `card` \| `title` \| `avatar_pack` |
| `rarity` | text not null | `free` \| `common` \| `rare` \| `epic` \| `legendary` \| `badge` |
| `price` | integer | null for free and badge items, otherwise 1–1,000,000 (named check `shop_items_price_fits_rarity`) |
| `badge` | text | the badges.mjs id that unlocks a badge item; null otherwise |
| `active` | boolean not null default true | false takes it off sale; owners keep it and can still equip it |
| `sort` | integer not null default 0 | order within its kind |

Seeded with the launch catalog ([6.2](#62-shop-catalogmjs-phase-0-lead)), `on conflict (id) do nothing`: a re-run
adds new items and leaves existing rows alone, so a price changed with SQL stays changed. RLS on, public select.
Runbook: `update shop_items set price = 1500 where id = 'frame-lime';` and
`update shop_items set active = false where id = 'frame-lime';` (edit the seed too, for new databases). To give a
pack's avatars to everyone, free the avatars rather than the shop item (`set_avatar` checks inventory for paid
avatars): `update avatar_presets set free = true where pack = 'sideline';`.

**`inventory`** `(user_id → profiles cascade, item_id → shop_items(id), acquired_at timestamptz default now(),
primary key (user_id, item_id))`. RLS on, no policies, privileges revoked from anon and authenticated. Only bought
items get rows: free items belong to everyone, and a badge item belongs to whoever has its badge in `badge_awards`.

**`avatar_presets`** gains the 12 pack avatars (`pack` = the pack name, `free` false).

**`profile_details`** gains `frame`, `card_theme` and `title` (text → `shop_items(id)`, null = the default: the Ink
frame, the Navy card, no title) and `showcase text[] not null default '{}'` (named check
`profile_details_showcase_shape`: at most 3).

**Agent J writes the functions:**

| function | returns | notes / raises |
|---|---|---|
| `shop_state()` | jsonb `{ "balance", "items": [{ "id", "kind", "rarity", "price", "badge", "active", "sort", "owned" }], "equipped": { "frame", "card", "title", "showcase" } }` | stable, security definer; `authenticated` only. Raises `not_signed_in`. Items: every active item plus any inactive one the player owns, ordered by kind (frame, card, title, avatar_pack), then `sort`, then `id`. `owned`: free, or an inventory row, or a badge item whose badge is in `badge_awards`. `equipped`: the caller's profile_details columns (nulls and `[]` without a row). |
| `shop_buy(p_item text)` | jsonb `{ "ok": true, "balance", "item" }` | security definer; `authenticated` only. Raises, checked in this order: `not_signed_in`; `unavailable` (no such item, or not active); `badge_only`; `owned` (free, or already owned); `not_enough`. Takes the wallet lock **before** reading the item, ownership or the balance, then inserts the inventory row and `wallet_apply(uid, -price, 'purchase', id)`, all in one transaction. If `wallet_apply` doesn't charge the full price (the ledger already records that purchase but the inventory row is gone — only possible after rows were edited by hand) it raises `purchase_conflict` and rolls back, rather than hand the item over free. |
| `equip_item(p_slot text, p_item text)` | jsonb: the details row (`to_jsonb`, like `save_profile`) | security definer; `authenticated` only. Raises `not_signed_in`; `bad_slot` (not `frame`, `card` or `title`); `bad_item` (no such item, or its kind isn't the slot's — each slot takes its own kind); `not_owned`. Null `p_item` clears the slot. Upserts the caller's row and changes only that column (`card` → `card_theme`) plus `updated_at`. |
| `set_showcase(p_badges text[])` | jsonb: the details row | security definer; `authenticated` only. Raises `not_signed_in`; `bad_showcase` (more than 3, a null, a duplicate, a multi-dimensional array, or an id not matching `^[a-z0-9-]{1,40}$`). Null saves `{}`; the ids are saved in order, numbered from 1. It doesn't check the badges are earned: the card shows only the earned ones, because badges are worked out in the browser and one earned since the player's last season isn't in `badge_awards` yet. |

**`set_avatar` in `migration-profiles.sql` (agent J):** a preset that isn't free is allowed when the caller owns
its pack's item (an `inventory` row for `'pack-' || pack`); otherwise `bad_preset`, as now. It must still work in a
database without `migration-shop.sql` (several tests run migration-profiles.sql without it): check
`to_regclass('public.inventory') is null` first and refuse, and keep the inventory query in its own statement that
only runs when the table exists (plpgsql plans a statement the first time it runs it). `tests/mock-profile-data.mjs`'s
`set_avatar` mirrors it through `state.ownsAvatarPack(uid, pack)` (phase 0 wired that hook).

---

## 4. Coins

### 4.1 `rewards.mjs`

Phase 0 wrote it; agent I owns it. Pure: it imports only `badges.mjs` and `game-logic.mjs`'s `normFormat`. The
browser and submit-run both run it, and coin amounts live here and nowhere else in JavaScript.

```js
COIN_RULES = {
  season: 20, dailySeason: 40, win: 2, playoffs: 10, title: 50, perfect: 150,
  pointsPer: 10,                   // 1 coin per 10 ladder points the draft earned, when above 0
  streakPerDay: 5, streakMax: 50,  // a Daily only: 5 per day of the streak it makes, up to 50
  minigame: 15,                    // Over/Under and Build-a-player, once each per UTC day (SQL)
  paidSeasonsPerDay: 20,           // Unlimited/Genius/GM seasons paid per UTC day; Dailies don't count
  welcome: 250,                    // a new account (SQL)
  startingCap: 10000,              // the one-time starting balance's cap (SQL)
}
coinsForRun(run, { streak })         → { total, lines: [{ key, label, coins }] }
seasonReward(run, { date, streak })  → { kind: "daily" | "season", ref, amount, lines, dailyCap }
startingBalance(stats)               → number
badgeRewards(progress)               → [{ id, coins }]     // every earned badge, catalog order, coins may be 0
coinsSummary(season, awards)         → { earned, balance, capped, lines }
```

- `coinsForRun` lines, in this order, each only when it pays: `season` ("Finished a season" 20, or "Finished the
  Daily" 40 when `run.mode` is daily), `wins` ("12 wins", 2 each), `playoffs` ("Made the playoffs"), `title` ("Won
  the title"), `perfect` ("Went 20–0"), `points` ("145 ladder points", `floor(points / 10)`), `streak` (a Daily only:
  "6-day streak", `min(50, 5 × streak)`).
- `seasonReward`: a Daily is kind `daily`, ref `` `${date}:${normFormat(run.format)}` ``, `dailyCap` null; anything
  else is kind `season`, ref `run.code`, `dailyCap` `paidSeasonsPerDay`.
- `startingBalance(stats)` (the app's stats shape) is the SQL backfill's formula.
- `coinsSummary(season, awards)`: `season` is `credit_coins`'s answer plus `lines`, `awards` is `award_badges`'s.
  `earned` is both credits; `balance` the later balance; `capped` the season's; `lines` the season's lines when it
  paid anything, then `{ key: "badge:<id>", label: "<Name> badge", coins }` for each awarded badge that pays.

### 4.2 submit-run (agent I)

`supabase/functions/submit-run/index.ts` imports `../../../rewards.mjs`, `../../../badges.mjs` and
`../../../profile-rules.mjs` the same way it imports `game-logic.mjs`. A DNF is unchanged (no coins). A finished
season, after the existing verification:

1. A free-mode `mode.code` over 32 characters is refused like a missing one (400). A Daily ignores the `gm` and
   `genius` flags (the app offers neither on it). A GM season whose verified roster is over `GM_CAP` is an illegal
   roster (400) — the app never lets a pick past the cap, but whether a draft was GM is the client's word. And
   `replayDraft` (game-logic.mjs) refuses a trace that walks past a board it could have picked from without
   re-spinning it, which would otherwise draft the best six of a sequence's eighteen boards.
2. **The duplicate guard.** Daily: the existing `daily_runs` insert; its 409 answer gains `reason: "duplicate"`.
   Free: insert `finished_codes (user_id, code)` first. A unique violation (23505) answers 409
   `{ "error": "this draft is already recorded", "reason": "duplicate" }`; any other error answers 500
   `failed to save`. Nothing else is written before this succeeds.
3. The profile update, as now. If it fails, give back what step 2 took — the `finished_codes` row, or the Daily's
   `daily_runs` row (best effort) — so a retry can count, and answer 500. Any other failure of step 2's insert (not a
   unique violation) also answers 500, never "already recorded".
4. `logRun`, as now.
5. **Rewards**, in one try/catch: a failure is logged and the answer carries `coins: null, newBadges: []` — never an
   error, since the season already counted.
   1. `seasonReward(run, { date: mode.date, streak: updated.dailyStreak })` → `credit_coins`.
   2. `player_stats(user)` and the player's `profile_details.favorite_team` → `badgeProgress({ stats: updated,
      extra: mapPlayerStats(stats), details: { favoriteTeam }, joined: existingRow.created_at })` → `award_badges(user,
      badgeRewards(progress))`.
   3. Answer:

```json
{ "ok": true, "run": { "…": "as now" },
  "coins": { "earned": 186, "balance": 4210, "capped": false,
             "lines": [{ "key": "season", "label": "Finished a season", "coins": 20 },
                       { "key": "badge:ring-bearer", "label": "Ring Bearer badge", "coins": 100 }] },
  "newBadges": ["ring-bearer"] }
```

There's no Deno here: `tests/mock-supabase.mjs`'s `invokeSubmitRun` mirrors every step against the mock, and
index.ts must at least pass `npx esbuild supabase/functions/submit-run/index.ts --log-level=error
--outfile=build/submit-run-check.js` (a syntax and type-strip check; nothing is bundled).

---

## 5. Browser data layer

### 5.1 `storage-shop.js` (phase 0 wrote working versions; agent J owns it)

The app imports these from `./storage.js`. **Nothing throws.** Reads use `READ` (GET); writes POST. `details` is
`mapDetails`'s shape.

```js
fetchWallet()            → { balance, earned, spent, recent: [{ amount, kind, ref, createdAt }] } | null
fetchShop()              → { balance, items: [{ id, kind, rarity, price, badge, active, sort, owned }],
                             equipped: { frame, card, title, showcase } } | null
buyItem(id)              → { ok: true, balance } | { ok: false, reason }
    // reason: "not_enough" | "owned" | "unavailable" | "badge_only" | "signed_out" | "network"
    // (purchase_conflict arrives as "network": nothing the player can do clears it)
equipItem(slot, id)      → { ok: true, details } | { ok: false, reason }        // id null clears the slot
    // reason: "not_owned" | "invalid" | "signed_out" | "network"
setShowcase(badgeIds)    → { ok: true, details } | { ok: false, reason: "invalid" | "signed_out" | "network" }
claimMinigameCoins(game) → { ok: true, credited, balance } | { ok: false, reason }  // game: "over_under" | "build"
    // reason: "not_played" | "invalid" | "signed_out" | "network"
```

### 5.2 Lead-owned changes (phase 0 did these)

- `storage-profile.js`'s `mapDetails` adds `frame`, `cardTheme`, `title` (null when unset) and `showcase` (an
  array, `[]` when unset).
- `storage.js`'s `submitRun(trace)` returns the function's answer on success; on a refusal it returns
  `{ ok: false, reason: "duplicate" }` when the answer carried that reason, otherwise `{ ok: false }`.
- `storage-core.js` exports `callReason(error, status, table)` (moved from storage-profile.js): a rejected session is
  `signed_out`, a function's own code goes through `table`, anything else is `network`.

---

## 6. Shared modules

### 6.1 `rewards.mjs` — see [4.1](#41-rewardsmjs).

### 6.2 `shop-catalog.mjs` (phase 0, lead)

```js
SHOP_KINDS    = ["frame", "card", "title", "avatar_pack"]
KIND_LABEL    = { frame: "Frames", card: "Card themes", title: "Titles", avatar_pack: "Avatar packs" }
EQUIP_SLOTS   = ["frame", "card", "title"]        // each slot takes items of its own kind
DEFAULT_ITEM  = { frame: "frame-ink", card: "card-navy", title: null }
RARITIES, RARITY_LABEL                           // free, common, rare, epic, legendary, badge ("Badge reward")
SHOWCASE_MAX  = 3
SHOP_ITEMS    = [{ id, kind, name, rarity, badge }]   // the launch catalog; the shop shows the server's rarity and price
SHOP_ITEM_BY_ID
AVATAR_PACKS  = [{ pack, item, name, presets: [{ key, name }] }]
PACK_BY_ITEM, packItem(pack) → "pack-<pack>"
```

Names and looks live in the browser (cosmetics.jsx draws each id); price, rarity and what's on sale live in
`shop_items`. `tests/test-shop-sql.mjs` checks the seeds and this file agree.

| id | kind | name | launch rarity | price | badge |
|---|---|---|---|---:|---|
| `frame-ink` | frame | Ink | free | – | |
| `frame-lime` | frame | Lime | common | 750 | |
| `frame-team` | frame | Team colors | rare | 2,000 | |
| `frame-gold` | frame | Gold | epic | 6,000 | |
| `frame-flame` | frame | Flame (animated) | legendary | 15,000 | |
| `frame-undefeated` | frame | Undefeated | badge | – | undefeated |
| `card-navy` | card | Navy | free | – | |
| `card-night` | card | Night | common | 750 | |
| `card-turf` | card | Turf | rare | 2,000 | |
| `card-team` | card | Team colors | rare | 2,000 | |
| `card-ticket` | card | Ticket stub | epic | 6,000 | |
| `card-gold-foil` | card | Gold foil | legendary | 15,000 | |
| `card-dynasty` | card | Dynasty | badge | – | dynasty |
| `title-film-room` | title | Film Room | common | 750 | |
| `title-waiver-hawk` | title | Waiver Hawk | common | 750 | |
| `title-draft-guru` | title | Draft Guru | rare | 2,000 | |
| `title-cap-wizard` | title | Cap Wizard | rare | 2,000 | |
| `title-undefeated` | title | Undefeated | badge | – | undefeated |
| `title-daily-winner` | title | Daily Winner | badge | – | daily-winner |
| `title-cinderella` | title | Cinderella | badge | – | cinderella |
| `pack-sideline` | avatar_pack | Sideline | common | 750 | |
| `pack-trophy-room` | avatar_pack | Trophy room | rare | 2,000 | |
| `pack-night-game` | avatar_pack | Night game | epic | 6,000 | |

Seed `sort` is 10, 20, 30… in this order within each kind. The packs' avatars: **Sideline** — `headset` Headset,
`cooler` Water cooler, `pylon` Pylon, `penalty-flag` Penalty flag; **Trophy room** — `title-ring` Title ring,
`medal` Medal, `banner` Banner, `game-ball` Game ball; **Night game** — `floodlights` Floodlights, `scoreboard`
Scoreboard, `fireworks` Fireworks, `blimp` Blimp.

### 6.3 `badges.mjs` — unchanged. submit-run imports it; `BADGE_BY_ID[id].coins` is what a badge pays.

---

## 7. Components

Every screen file exports its stylesheet string (`COSMETICS_CSS`, `SHOP_CSS`); perfect-season.jsx appends them to
`APP_CSS` (phase 0 did). **Style only your own prefixed classes** — `cs-` (cosmetics), `sh-` (shop), plus the
existing owners' `pf-`, `av-`, `ap-` — and reuse the app's `.btn`, `.btn.solid`, `.linkbtn`, `.panel`, `.tiles`/
`.tile`, `.h`, `.note`, `.muted`, `.err`, `.frow`, `.chip` as they are. Follow CLAUDE.md's design system: lime only
as a fill, sentence-case labels uppercased by CSS, 44px touch targets under `(pointer:coarse)`, 16px inputs, base
rules before media queries, hover inside `(hover:hover)`, every animation stopped under reduced motion.

### 7.1 `cosmetics.jsx`, `avatars.jsx`, `avatar-picker.jsx` (agent K; phase 0 wrote stubs of cosmetics.jsx)

```jsx
<FramedAvatar frame team size username photoUrl preset decorative className />
<CardTheme theme team as="div" className {...rest}>{children}</CardTheme>
<TitleLine title className />
<Coin size />                        // decorative
<Coins amount size className />     // coin + "1,240"; its accessible text reads "1,240 coins"
<ItemPreview id team username photoUrl preset />   // the thumbnail a shop tile shows; decorative
COSMETICS_CSS
CARD_THEME_SCOPE                    // { [card id]: "dark" | "night" | "light" }
```

- **FramedAvatar**: `<Avatar>` at `size`, inside the frame's ring, which adds at most `max(3, size / 10)` px on each
  side. Root carries `data-frame="<id>"` (the default's id when null or unknown). Null or unknown = Ink (today's
  `.pf-ring` look). Team colors uses the favorite team's two colors (`teamVars`) and falls back to Ink with no team.
  Flame animates and holds still under reduced motion. Every frame must read at 24px (the header).
- **CardTheme**: renders `as` with the theme's paint (background, border, hard shadow, texture) and a scope class
  `cs-dark`, `cs-night` or `cs-light`, which perfect-season.jsx maps to theme.mjs's scopes (phase 0 did). The caller's
  `className` carries layout only (the profile card's `pf-card`: grid, gap, padding, radius). Root carries
  `data-card="<id>"`. Null or unknown = Navy, today's look. **Text must stay readable on every theme** (WCAG AA for
  every text token of the theme's scope against every color painted behind text, all 32 teams for Team colors).
- **TitleLine**: the title's name from `SHOP_ITEM_BY_ID`, as `<p class="cs-title" data-title="<id>">`; nothing for
  null or an unknown id.
- **avatars.jsx**: `AVATAR_PRESETS` adds the 12 pack avatars (`pack`, `free: false`, names from `AVATAR_PACKS`),
  drawn to the starter set's rules — no team marks, readable at 24px.
- **avatar-picker.jsx**: a new prop `ownedPacks` (pack names; `starter` is always owned). Choose an avatar groups
  by pack, Starter first; a pack not owned shows its avatars dimmed and unselectable, with "In the shop" by the pack
  name. Everything else stays as it is.
- **theme.mjs**: any new token goes in all three scopes. `tests/test-cosmetics.mjs` checks every frame, card theme,
  title and pack renders, the contrast rule above, and reduced motion.
- **Harness** (`tools/ui-harness/harness.jsx`): `screen=cosmetics[&team=KC]` shows every frame, card theme, title and
  pack on a sample card; `screen=shop&coins=N` shows ShopScreen on the mock with N coins and a few owned items.

### 7.2 `shop.jsx` (agent L; phase 0 wrote a working stub)

```jsx
<ShopScreen userId username onBack onDetailsSaved onBalance />
<WalletPanel wallet />
SHOP_CSS
```

| prop | meaning |
|---|---|
| `userId`, `username` | the signed-in player |
| `onBack()` | leave the shop |
| `onDetailsSaved(details)` | after an equip or showcase save (mapDetails shape) |
| `onBalance(balance)` | whenever the balance loads or changes |

Self-contained: it loads `fetchShop()`, `fetchWallet()` and `fetchPlayerProfile(username)` (for the card preview and
your badges) itself.

**Layout:** a preview of your own player card (CardTheme + FramedAvatar + name + TitleLine, wearing the selected
item over what's equipped) → your balance → tabs Frames, Card themes, Titles, Avatar packs, Showcase → the items →
WalletPanel.

**Item states:** `equipped`, `owned`, `buy` (affordable), `short` (shows "750 more coins"), `locked` (a badge item
not owned: "Earn the Undefeated badge", or "Unlocks after your next finished season" when `badgeProgress` says the
badge is earned).

**Flow:** tap an item → your card preview wears it and its actions show. **Buy** → "Confirm purchase" / "Cancel" →
on success a frame, card theme or title is equipped straight away ("Bought and equipped."), and an avatar pack says
"Bought. Choose one in Edit profile." **Equip** for an owned item; **Take off** for the equipped title (a frame or
card theme goes back by equipping the free one). Refusals in words: not_enough "You don't have enough coins for
that."; network "That didn't go through. Try again."; owned or unavailable reloads the shop.

**Showcase tab:** every earned badge as a checkbox (at most 3; the rest disable at 3), **Save showcase**. With
nothing chosen, the card shows its top three (`topBadges`).

**WalletPanel:** the balance, earned and spent, and recent coins — "+186 · Season", "−750 · Lime", with labels from
kind and ref: Starting balance, Welcome coins, Daily, Season, "<Name> badge", Over/Under, Build-a-player, the item's
name.

**Test hooks (must keep):** root `<section class="shop" data-balance="<n>">` (`data-balance` absent until loaded);
tabs are buttons named by `KIND_LABEL` plus "Showcase"; each item is `<article class="sh-item" data-item="<id>"
data-state="…">` whose first button selects it, and the selected item's article holds its actions, buttons named
"Buy", "Confirm purchase", "Equip", "Take off";
showcase checkboxes `input[name="showcase"][value="<badge id>"]` and a "Save showcase" button.

### 7.3 `profile.jsx` (agent L)

New props: `wallet` (`{ balance }` or null — the owner's) and `onOpenShop()`.

- The card is a `CardTheme` (`details.cardTheme`, the favorite team) with the layout class `pf-card`; the picture a
  `FramedAvatar` (`details.frame`); a `TitleLine` (`details.title`) under the name; the badges are the showcase's
  earned ones in the chosen order, or `topBadges(progress, 3)` when none of the showcase is earned.
- The navy paint now on `.pf-card` moves into CardTheme's Navy; `.pf-card` keeps only layout.
- The owner's card shows the balance (`Coins`) and a **Shop** button. Phase 0 wired these stubs in, so every test
  hook already exists.
- The editor's AvatarPicker gets `ownedPacks` from `fetchShop()` (the owned `avatar_pack` items' packs).

---

## 8. App integration — `perfect-season.jsx` (agent M)

- **The Shop view.** `view === "shop"` shows ShopScreen, for a signed-in player only (signing out leaves it, and a
  history entry for it reached while signed out opens Modes). It opens from the profile card's Shop button and the
  result screen's coins line. It isn't an address (the page stays at `/`), but like a profile it pushes a history
  entry of its own (`HISTORY_VIEWS` gains `shop`), so Back — the browser's or the shop's own, which calls
  `history.back()` — returns to the screen it was opened from.
- **Result screen**, signed in, once the save answers: the coins it earned (`coins.earned` as "+186 coins", with the
  season's lines on one compact row and the new badges' coins folded into one "Badges" line) and a Shop button; any new badges by emoji and name; when `capped`, "Unlimited, Genius and GM pay coins for 20
  seasons a day. The Daily always pays."; on `reason: "duplicate"`, "This draft was already recorded, so it didn't
  count again." in place of the save-error panel. `coins: null` shows nothing about coins.
- **Wallet.** `fetchWallet()` when your own profile opens and after a season saves or a claim pays → ProfileScreen's
  `wallet`; ShopScreen's `onBalance` keeps it current.
- **Header picture**: `FramedAvatar` with `myDetails.frame` and the favorite team. `myDetails` also updates from
  ShopScreen's `onDetailsSaved`.
- **Minigames**, signed in: once Over/Under's run is saved (await `upsertSouRun`), `claimMinigameCoins("over_under")`;
  once a build is logged (await `logBuild`), `claimMinigameCoins("build")`. Show "+15 coins" on that end screen when
  `credited` is above 0.
- **Styles**: phase 0 appended `COSMETICS_CSS + SHOP_CSS` to `APP_CSS` and added `.cs-dark` to the dark scope list,
  `.cs-night` to the night list and a `.cs-light` light scope after both.

---

## 9. Tests and tooling

- **`node tests/run-all.mjs [filter...]`** runs every test file. Run it before handing back.
- **Mocks.** `tests/mock-supabase.mjs` wires two more modules, both **working simplified versions from phase 0**
  that their owners make match the SQL exactly, with PGlite parity tests:
  - `tests/mock-wallet.mjs` (I): `makeWallet(state)` → `{ tables, rpcs, server, welcome, balanceOf }`. Tables
    `wallets`, `wallet_ledger`, `badge_awards`, `finished_codes`; rpcs `claim_minigame`, `wallet_state`; `server`
    holds `credit_coins` and `award_badges`, which `invokeSubmitRun` calls and `rpc()` can't reach (like the
    service role). `welcome(uid)` is the signup trigger.
  - `tests/mock-shop.mjs` (J): `makeShop(state, { wallet, profileData })` → `{ tables, rpcs, ownsAvatarPack }`.
    Tables `shop_items`, `inventory`; rpcs `shop_state`, `shop_buy`, `equip_item`, `set_showcase`.
  - A client's direct read of `wallets`, `wallet_ledger`, `badge_awards`, `finished_codes` or `inventory` is refused
    (privileges revoked); a direct write to any new table gets the RLS error. `state` gains
    `ownsAvatarPack(uid, pack)`. Escape hatches: `_wallets`, `_ledger`, `_badgeAwards`, `_finishedCodes`,
    `_shopItems`, `_inventory`, `_wallet` (the wallet module itself: `server`, `apply`, `balanceOf`, for setting
    up a test), and `_failWrites` (a Set of table names — `profiles`, `finished_codes`, `daily_runs` — whose writes
    inside the mock submit-run fail like a database error, to reach its 500 branches).
- **Real Postgres.** `tests/pg-fixture.mjs`'s `MIGRATIONS` now ends with `migration-wallet.sql`,
  `migration-shop.sql`. `tests/test-profile-security.mjs` stays pinned to v1.11.0's three migrations (its
  every-function check is about those); N's `tests/test-economy-security.mjs` does the same checks for the new ones.
  PGlite is one connection, so "two purchases at once" is tested as the lock plus the constraints, and N reviews the
  locking by reading it.
- **Per agent:**
  - I: `test-rewards.mjs` (rules, lines, startingBalance, badgeRewards, coinsSummary); `test-wallet-sql.mjs` (every
    function's results and refusals, the cap, duplicates, trigger, backfill, SQL numbers = `COIN_RULES`, parity with
    mock-wallet); `test-submit-coins.mjs` (the mock submit-run: coins, badges paid once, a repeated code refused with
    nothing written, the cap, a DNF pays nothing, a failed reward still counts the season).
  - J: `test-shop-sql.mjs` (catalog = shop-catalog.mjs, buy/equip/showcase results and refusals, badge items,
    set_avatar with packs, parity with mock-shop).
  - K: `test-cosmetics.mjs`; keeps `test-avatar-picker.mjs` passing.
  - L: `test-shop-screen.mjs` (enough and too few coins, confirm, equip, take off, both locked states, showcase, a
    failed purchase, the profile card's cosmetics and Shop button); keeps `test-profile-screen.mjs` passing.
  - M: `test-shop-flow.mjs` (finish a draft → coins on the result → Shop → buy a frame → it's on the profile and in
    the header; the duplicate message; minigame +15).
- **Visual checks** use `tools/ui-harness` and puppeteer-core with the installed Chrome
  (`C:/Program Files/Google/Chrome/Application/chrome.exe`) — never the in-app browser pane, which is shared. Sizes:
  320, 375, 430, 768 and 667×375.

---

## 10. Who owns what

Only the owner writes a file. If you need a change in a file you don't own, put it in your report.

| agent | owns |
|---|---|
| **I** Wallet & rewards | `supabase/migration-wallet.sql`, `rewards.mjs`, `supabase/functions/submit-run/index.ts`, `tests/mock-supabase.mjs`, `tests/mock-wallet.mjs`, `tests/test-rewards.mjs`, `tests/test-wallet-sql.mjs`, `tests/test-submit-coins.mjs` |
| **J** Shop data | `supabase/migration-shop.sql`, `supabase/migration-profiles.sql` (`set_avatar` only), `storage-shop.js`, `tests/mock-shop.mjs`, `tests/mock-profile-data.mjs` (`set_avatar` only), `tests/test-shop-sql.mjs` |
| **K** Cosmetics | `cosmetics.jsx`, `avatars.jsx`, `avatar-picker.jsx`, `theme.mjs`, `tools/ui-harness/harness.jsx`, `tests/test-cosmetics.mjs`, `tests/test-avatar-picker.mjs` |
| **L** Shop & profile screens | `shop.jsx`, `profile.jsx`, `tests/test-shop-screen.mjs`, `tests/test-profile-screen.mjs` |
| **M** App | `perfect-season.jsx`, `tests/test-shop-flow.mjs`, `tests/test-profile-links.mjs` |
| **lead** | `SHOP.md`, `shop-catalog.mjs`, `storage.js`, `storage-core.js`, `storage-profile.js`, `tests/helpers.mjs`, `tests/pg-fixture.mjs`, `tests/run-all.mjs`, `tests/fixtures/`, `CLAUDE.md`, `CHANGELOG.md`, `package.json`, `vercel.json` |

**Older test files** (the ones not listed): if your change breaks one, fix only what your change needs and say so in
your report; the lead settles any overlap at merge.

Every agent: start with `git merge --ff-only shop` (your worktree may start from an older commit), and link
node_modules with `New-Item -ItemType Junction -Path node_modules -Target "C:\Users\Willi\The Perfect Season\node_modules"`.
No pushes, deploys, migrations against a real project, or network calls to Supabase; don't add or upgrade packages;
commit on your own branch with a clear message.

---

## 11. After the build (lead)

Merge order I → J → K → L → M. Then: every test file passes; N (economy and security) and O (mobile) checks and a
code review; CLAUDE.md (a coins and shop section, the new files, the runbook for prices and taking items off sale,
the new submit-run steps), CHANGELOG 1.12.0, version bump; staging: the migrations in order, deploy submit-run, then
the site; a staging click-through (starting balance, a draft's coins, a badge reward, buy and equip, the same draft
sent twice); the owner's OK; production in the same order.
