# CARDS.md - card collecting and card battles

**Status: in progress, and on the test site only** (v2.23.0, plans 1 and 2 of 5). A player there can open a
starter deck, earn a card a day from the daily draft, and see a collection. **Nothing plays a battle yet**, and
there are no packs. Production has cards switched off: no tile, no catalog file, and the functions grant
nothing. Sections 1 to 7 are the rules; section 8 is owning cards.

The design is `docs/superpowers/specs/2026-11-13-card-collection-design.md`; read it for the why. This file is
what the code does.

## 1. What a card is, and why the catalog is frozen

A card is one row of the draft pool - a player's best season for one team in one five-year era - copied into
`data/cards.json` with an id of its own. 3,124 cards, 1,639 players.

**The catalog is append-only.** Somebody owns these, so `tools/data/build-card-catalog.mjs` never regenerates
the file: it reads what is there and only adds.

- A card keeps its `id`, its `pid` and every stat it was created with. A corrected `data/players.json` does
  not move a card.
- A card whose row has left the pool stays. The new best season arrives as a new card beside it.
- New cards take `max(id) + 1`, in a fixed order (team, season, name).
- `pid` is the player. Twelve names in the pool belong to more than one man (two Adrian Petersons, two Steve
  Smiths, three Mike Williamses); `pid` tells them apart, a name cannot.

**Who a new row belongs to**, in order: (1) an existing card of his is still in the pool under the same name
index - that card's `pid`; (2) otherwise, exactly one existing player has his name and has no card left in the
pool - he keeps that `pid`, and the builder prints the match for a human to check (818 players have exactly one
card, so a best season moving orphans a man at a stroke); (3) otherwise he is new.

**The builder refuses, rather than guesses, when:** two pool rows share a key; one name index carries two
players' cards; a new row could be either of two orphaned namesakes; or a new card is from a season no newer
than the catalog's latest. That last one is what stops a team code changing, or a name being respelled across
the file, from appending a duplicate of every card it touched - `--allow-old` overrides it when it is really
meant. It also prints how many cards have left the pool: a rebuild that only adds a season should report
almost none. **A respelled name is the one thing it cannot see** - that player looks like a stranger.

Why not point at `players.json`: its player `id` is a position in its own name array, good for one build. Keying
ownership on it would hand every collection to different players the first time a season was added.

**To add the 2026 season:** rebuild `players.json` as usual, then `node tools/data/build-card-catalog.mjs`. It
prints `added N`. `tests/test-card-catalog.mjs` simulates exactly this and holds the old rows to the byte.

## 2. Archetypes

Earned from the card's own season by `cardArchetype` in `card-logic.mjs`. Never stored, never assigned by hand.
A card that qualifies for several shows the first in this order. Counts are cards that qualify, pinned by
`tests/test-card-logic.mjs`.

| id | Label | Pos | Rule | Cards |
|---|---|---|---|---|
| gunslinger | Gunslinger | QB | 25+ att/game and 7.7+ yards/attempt | 91 |
| scrambler | Scrambler | QB | 22+ rush yards/game | 70 |
| volume | Volume passer | QB | 36+ att/game | 64 |
| manager | Game manager | QB | 20+ att/game, INT rate <= 2.1%, under 7.7 Y/A | 86 |
| workhorse | Workhorse | RB | 17+ carries/game, under 3 catches/game | 101 |
| goalline | Goal-line back | RB | 10+ rushing TD | 122 |
| homerun | Home-run hitter | RB | 100+ carries and 4.8+ yards/carry | 123 |
| receiving | Receiving back | RB | 3.2+ catches/game | 148 |
| deep | Deep threat | WR | 30+ catches and 15.5+ yards/catch | 194 |
| redzone | Red-zone target | WR, TE | 9+ receiving TD (WR), 7+ (TE) | 245 |
| possession | Possession | WR | 5+ catches/game, under 13 yards/catch | 121 |
| seam | Seam stretcher | TE | 25+ catches and 12.5+ yards/catch | 78 |
| valve | Safety valve | TE | 3.5+ catches/game, under 11 yards/catch | 89 |

Everything else is `role`, "Role player": about 1,900 of the 3,124. A card with no games, attempts, carries or
catches qualifies for nothing rather than comparing `NaN`.

## 3. Categories

**A battle is offense against offense** (v2.27.0, the owner's redesign of 2026-11-14): your six cards against
a CPU's six, the same kind of cards you collect. The owner's line for it is "a fast collectible strategy game
powered by historical NFL seasons" - not fantasy scoring, not a football simulation, not a card flip. There
are no defenses any more; `data/card-defense.json` and its builder are left in the repo and read by nothing.

A round is never "the better card wins". Each of a battle's six rounds is fought on a **category**, and a
card's score in a category is how its real season ranked **at its own position, in its own era**, 0 to 99.

| Category | What it measures |
|---|---|
| Production | total yards |
| Touchdown threat | touchdowns a game |
| Big play | yards per completion (QB), per carry (RB), per catch (WR, TE) |
| Workload | attempts and touches a game |
| Efficiency | yards and scores per attempt or touch, less turnovers |
| Star power | the overall rating itself |

- Ranked **within position and era** (`WINDOWS`), so a quarterback and a back can meet in a round and
  compare fairly, and a 2003 season is judged against 2003 football.
- Per-touch categories are **shrunk** toward an ordinary season (phantom touches at a league-ordinary rate),
  or a man with eight catches for 203 yards is the best big-play threat in the game. He was, in the first cut.
- **Every category is something the catalog really holds.** There is no Clutch and no Deep ball because
  there is no such column, and a score that is not the player's own numbers is a number made up about a real
  man.
- Computed in `initCardData` and kept on the card as `cats`. They follow from `data/cards.json`, which is
  frozen, so they do not move unless the formulas in `rawCategories` do.

## 4. Decks, hands and teams

- A **deck** is thirty cards you own: 5 QB, 10 RB, 10 WR, 5 TE, thirty different men. `deckProblem`.
  An account that never saved one plays `bestDeck` of what it owns.
- A **hand** is twelve of the thirty - 2, 4, 4, 2 - dealt by the server for each battle (`dealHand`, twelve
  draws). So a deck is never a guaranteed lineup.
- A **team** is six of the hand: exactly one quarterback, at least one back, one receiver and one tight end,
  six different men. **The order of the six is the order they play in, and it is the player's.**
  `teamProblem` answers `null` or one of `malformed`, `incomplete`, `unknown_card`, `bad_finish`, `bad_slot`,
  `same_player`, `not_in_hand`. It never throws.
- `bestTeam` is the six highest ratings that make a team, best first. It is the DULL choice on purpose - the
  screen's "Pick for me", the CPU's lineup, and the bot every balance number is measured against.

## 5. How a battle scores

`scoreBattle(mine, foe, rand, cats = null, foeEdge = 0)`. Six rounds, your first card against their first.
The six categories come up **exactly once each, in an order nobody knows** until it is played. A card's round:

    RATING_SHARE x (rating + finish)  +  the rest from its category score  +  synergies  +  ability  +  luck

The higher total takes the round. Win more rounds; a 3-3 split goes to the higher six-round total, and a dead
heat to you. So the overall rating is part of every round and never the whole of one.

- **Draws are counted:** five to order the categories, then four a round (two a card, yours first) -
  twenty-nine a battle, always. The browser and the Edge Function must walk the generator in step.
- **Synergies** (`teamSynergies`, worked out once for the lineup): +2 per lineup-mate from the same team (to
  6), +1 per mate from the same season (to 3), +2 once for a real teammate (both), and the archetype pairs.
- **Abilities**, one an archetype (`ABILITIES`). Some fire on the category (Gunslinger and Home-run hitter in
  Big play, Goal-line back and Red-zone target in Touchdown threat), some on the battle so far (Workhorse
  after a win, Seam stretcher when behind, Deep threat and Receiving back once the quarterback has played),
  the Scrambler against a higher-rated card. A Game manager lifts the NEXT card his side plays. A Safety
  valve cancels the ability across from him. A card whose ability did not fire is still shown it, as "not
  this round" - that is how a player learns to order the six.
- **Luck** is a triangular roll within `LUCK_SPREAD` (14), half as wide again for a Gunslinger.
- Constants as tuned: `RATING_SHARE 0.4`, `CAT_SCALE 1.3`, `LUCK_SPREAD 14`, `CPU_START 38`, `CPU_STEP 7`,
  `CPU_MAX 124`, `CPU_EDGE 0.6`, `DAILY_TARGET 86`.

**These numbers are tuned, not chosen.** Change one and run `node tests/test-card-balance.mjs`. A change
also moves the 2,000-battle checksum in `tests/test-card-logic.mjs`, and then the client and the functions
must ship together.

## 6. Balance, as measured on 2026-11-14

Three collections climb the ladder. One player fields the six highest ratings in rating order; one picks the
six and the order the numbers on screen say are best (it cannot see the category order or the luck).

| | Measured | Band |
|---|---|---|
| Starter deck (thirty Base cards under 60): wins a run | 1.45 | 0.8 to 3 |
| ...loses its very first battle | 17% | at most 40% |
| Sixty random cards: wins a run | 7.7 | 4 to 9 |
| The sixty best cards: wins a run | 13.6 | 8 to 16 |
| Runs that reach forty wins | none | none |
| Choosing and ordering beats the six best in rating order by | 0.49 wins a run | at least 0.3 |
| The sharp player fields a different six | 62% of battles | at least 25% |
| A lower-rated card takes a round off a higher-rated one | 0.37 a battle | at least 0.3 |
| An even match replayed: the less likely result | 29% | 8% to 35% |

**What these do not hold:** any single ability, pair or bonus; and whether it is fun. The bands are the
builder's reading of the design. Luck at 29% of even rematches is at the high end of "a bit" - `LUCK_SPREAD`
is the knob. The sharp bot is a search, not a person.

## 7. The other side

- `buildTeam(rand, target)`: one card of each position and two more, each within `CPU_BAND` of the target
  rating (widening only if a position has nobody there), six different men, in a random order. Eleven draws.
- **The ladder:** `ladderFoe(seed, step)` at `ladderTarget(step)` - 38, then 7 more a win, to 124. Past the
  best cards the game holds it cannot field a stronger team, so `ladderEdge(step)` adds points to every card
  of theirs instead; without it the best collections never met anything that could stop them.
- **The daily battle:** `dailyFoe(date)`, `dailyCategories(date)` and `dailyRand` - one team, one category
  order, and **one roll per card per day**, so the board rewards the six and their order and not the roll.
  Ranked by rounds won, then the six-round total (`dailyScore`).
- **Accepted gap**, the one every seeded daily here has: the bundle and the seed are public, so the day's
  best lineup for a hand can be worked out offline.

## 8. Owning cards (v2.23.0)

### 8.1 The database

`supabase/migration-cards.sql`. Two tables, RLS on, **one select policy each (your own rows) and no write
policy at all**:

- `card_owned (user_id, card_id, finish, count, first_at)` - what a player holds. Copies stack in `count`.
- `card_grants (user_id, kind, ref, card_id, finish)` - the ledger, unique on `(user_id, kind, ref)`. Kinds:
  `starter`, `daily`, `gift`.

`card_id` is an id out of `data/cards.json`. There is no cards table and no foreign key: the Edge Functions
choose the card, so they are what guarantee it is real.

`grant_cards(p_user, p_kind, p_grants)` is the only writer, security definer, **service role only**.
`p_grants` is a list of `{ ref, card, finish }`, at most twenty. Each is inserted into the ledger
`on conflict do nothing` and only a row that really went in adds a card. It returns
`{ granted: [...], duplicate }`, `duplicate` being true when something was asked for and none of it was new.
It raises `no_profile`, `guest_not_allowed` or `bad_grant`, and checks everything before writing anything.

The ref is what makes a grant happen once: a starter deck is `starter:0` to `starter:7`, a daily card is
the date. `delete_account` erases both tables' rows for the account (cards are the person's, not a board's),
through `to_regclass` + `EXECUTE` because migration-profiles.sql is re-run before this file exists.

### 8.2 The switch

Two switches. **Showing** needs the client's; **granting** follows the server's alone.

| Where | What | On when |
|---|---|---|
| Client | `cardsOn()` in `cards-switch.mjs`, from `CARDS_ON` baked in by build.mjs | `APP_ENV=staging`, or `CARDS_ON=1` |
| Server | the secret `CARDS_ENABLED=1`, read per request by `card-claim` and `submit-run` | set on that Supabase project |

With the client's off there is no tile and `data/cards.json` is not copied to the site. With the server's off
`card-claim` answers `cards_off` before touching the database and `submit-run` chooses no card.

- **Server on, client off banks cards nobody can see**: every finished daily is granted its card. That is the
  order a launch turns them on in, not a state to leave an environment in.
- `window.__ps_cards__` overrides the client switch (tests and the harness use it). Forced on in a build
  without the catalog, the card area says "Couldn't load your cards"; nothing is granted.
- **What a production build still carries with cards off:** the fourteen sprites under `/cards/` (about
  1.4 MB, copied with the rest of `static/`, fetched by nobody) and the card code inside the bundle. Only the
  catalog and the tile are withheld.

### 8.3 Getting cards

- **Starter deck** - `POST card-claim { action: "starter" }`. Eight Base cards rated under 60, eight different
  players, always a QB, RB, WR, TE and two more non-quarterbacks (`starterDeck` in card-logic.mjs), chosen with
  `crypto.getRandomValues`. Answers in this order: 401 `signed_out`, 400 `malformed`, 403 `cards_off`,
  500 `server` (profile read), 400 `no_profile`, 403 `guest_not_allowed`, 500 `server` (grant),
  409 `duplicate`, 200 `{ ok, cards }`.
- **Daily card** - `submit-run`, after a finished Daily is saved and paid. One card drawn at equal odds from
  every card off the boards that day dealt (`dailyCard`), with a finish roll (Base 80%, Silver 16%, Gold 3.5%,
  Prism 0.5%). The ref is the **date alone**, so the two scoring formats' dailies share one card a day. It is
  in its own try/catch, raced against a 2.5 second timer, and answers `card: null` on any failure: **it can
  never cost a season.** A grant that fails loses that day's card - there is no retry.
- Guests cannot collect. `grant_cards` refuses one, and a guest's daily is refused long before the card.

### 8.4 The browser

- `storage-cards.js`: `fetchMyCards()` answers `ok` / `signed_out` / `error` - three answers, because a
  read that failed is not an empty collection. It reads in pages of 1,000 (PostgREST's ceiling on one select). `claimStarter()` answers a reason from `CARD_REFUSALS`, or
  `offline` / `network` when the function could not be read.
- `card-data.mjs`: the catalog is fetched from `/data/cards.json` when the card area opens. A failed load is
  not remembered. The service worker fetches it network-first (`DATA` in sw-rules.mjs).
- `cards.jsx`: one state on screen - loading, error, account, starter, collection. A card earned before the
  starter deck is opened shows beside the starter offer. `SeasonCard` is the daily card on the result screen.
- `ps-cards-hidden` hides the tile and the daily card's reveal on that device. Cards are still banked.

### 8.5 Drawing a card

`tools/cards/build-sprites.mjs` cuts the owner's sheets into `static/cards/<pose>.webp`, 640 pixels tall (an enlargement of the sheets, smoothed
and re-sharpened so a phone does not show stairs in the outline - v2.24.3; and with the shaded patches of white
gloves and shoes listed in `poses.json` whitened, or the browser paints them as helmet - v2.24.4): paper cleared,
painted number erased, still in the sheets' own blue, grey and tan. `tools/cards/poses.json` maps each
archetype (and `role`) to a sheet cell. **Look at `build/card-sprites-check.png` after running it**; no test
can see a half-erased number.

`card-sprites.mjs` recolours a sprite in the browser on a canvas: jersey to the team's first colour, helmet
and pants to its second (they are the same grey on the sheets, so they cannot differ), skin to the player's
tone. `data/card-skin.json` maps a `pid` to one of five tones. **Its player list is a first pass the owner
has not corrected yet** (1,555 of 1,639 players; the other 84 wear the default because nobody was sure). 967
were measured from the headshot on the player's public Sleeper profile - no photo is kept or shipped, only the
tone - and the other 588, mostly retired before about 2009, are the drafter's memory alone and are marked
with a ? on the review page. It is written by `node tools/cards/build-card-skin.mjs` from lists of names inside that file - move a
name between lists there and re-run; `--review` also writes `build/card-skin-review.html`, everyone grouped
by tone. A photo's lighting can move a measurement by a step, and t3 is the default's own colour. The owner's review of it is a launch gate for production. No canvas, or a sprite that will not load, leaves the neutral drawing or none - the card
still shows its name, rating and stats.

`card-face.jsx`'s colours are data (`CARD_PAINT`), not theme tokens, because a card looks the same on every
surface. `CARD_TEXT_PAIRS` lists every text colour and what it sits on; the test holds each to AA.

### 8.6 Runbook

- **Switch cards on in an environment:** run `migration-cards.sql`, re-run `migration-profiles.sql`, set the
  secret (`npx supabase secrets set CARDS_ENABLED=1 --project-ref <ref>`), deploy the functions, then deploy
  a client built with `CARDS_ON=1` (staging has it by default).
- **Switch them off:** unset the secret. Grants stop at once; redeploy the client with `CARDS_ON=` to remove
  the tile. Nothing is deleted.
- **Give a player a card** (SQL editor, which runs as the owner):
  `select grant_cards('<user uuid>', 'gift', '[{"ref":"gift-1","card":412,"finish":"gold"}]'::jsonb);`
  `gift` is a kind of its own, so a hand-out never takes a day's daily card. A ref already used for that
  player and kind grants nothing.
- **A new kind of grant** is two edits in `migration-cards.sql`: the named constraint
  `card_grants_kind_check`, which the file drops and re-adds, and the list inside `grant_cards`. (`pack` was
  added that way in v2.24.0.)
- **See what someone owns:** `select card_id, finish, count from card_owned where user_id = '<uuid>';`

## 8b. Not built

Badges, the profile's best card, the real skin-tone list, selling a card you hold only one of. Battles exist (section 11) and **nobody has played
one against a person's judgement yet**: every number in them is the builder's. No pack-opening animation: the cards simply appear. The Standard pack's picture has
words painted into it that are not this game's ("FOOTBALL BOOSTER", "COMMON TIER") and a wordless one is owed
before production. `/privacy` and `/terms` do not mention cards yet; they change in the release
that switches cards on for production. The owner's full 50-pose sprite set arrived at about 100x135 pixels a
sprite and is wanted at full size; the sprites in use are cut from the first two sheets. The licence on the
tool that made the sprites is cleared (owner, 2026-11-13).

## 9. Packs (v2.24.0, on the test site)

A pack is bought with coins - the same wallet as the shop - and holds cards rolled when it is opened.

### 9.1 What is in a pack is code; what it costs is a row

`card-packs.mjs` is the ONE definition of a pack's contents and odds. The browser imports it to print "Who is
inside" before anybody buys; `card-claim` imports it to roll the pack. What a player reads is therefore what
is rolled, by construction. That is also why contents are not database rows: a pack is up to 3,124 weighted
cards derived from the catalog, and a copy in SQL would be a second thing to keep true. **So the client and
the functions ship together whenever that file changes**, the rule `versus-logic.mjs` and the guess pool carry.

| Pack | Cards | Holds | Finish odds | Seed price |
|---|---|---|---|---|
| Standard | 3 | every card (3,124) | Base 70, Silver 22, Gold 7, Prism 1 | 150 |
| Air raid | 3 | Gunslingers, Volume passers, Deep threats, Seam stretchers, Possession receivers (471) | the same | 250 |
| Legends | 1 | cards rated 100+ (252) | Gold 85, Prism 15 | 3,000, and 5,000 exist in all |

Better cards are rarer by `cardWeight`: 10 under a rating of 60, then 6, 3, 1.5, and 0.6 at 120 and up. A
weight, not a chance - a card's chance is its weight over the pack's total, so the same card is likelier in a
small themed pack. No two cards in one pack are the same. A roll makes exactly two draws a card.

`card_packs` (public select, no write policy) holds what an owner changes without a release: `price`,
`active`, and `stock_total`/`stock_left` for a limited pack. `size` is the one thing held in both places, on
purpose - `buy_pack` refuses a purchase that is not exactly that many cards, so a function with a bug cannot
hand over twenty. The seed only adds missing rows, so a price changed by hand survives a re-run.

### 9.2 Buying one

`card-claim`, action `open_pack`, body `{ pack, open, price }`. The function rolls the cards with the
cryptographic generator and hands them to **`buy_pack(user, pack, open, cards, price)`** (service role only),
which does the stock, the coins and the grant in ONE transaction:

1. `no_profile`, `guest_not_allowed`, `bad_open` (the open id is 8-36 letters, digits and hyphens)
2. `wallet_lock`
3. **the open id has been charged before** - answer with the cards granted the first time, `duplicate: true`,
   and change nothing
4. the pack's row, `for update` - `unavailable` if there is none or it is off sale
5. `bad_grant` unless the cards are exactly `size` well-formed entries
6. `sold_out`
7. `price_changed` if the row's price is HIGHER than `price`, which is what the buyer's screen showed. A
   cheaper pack is simply charged cheaper
8. `not_enough`
9. take one from stock, debit the wallet under the ledger key (user, `pack`, open id), grant the cards under
   refs `<open id>:0`, `:1`, ... - a raise anywhere rolls all of it back, and a grant that comes up short
   (`grant_cards` skips a ref it has seen) is itself a raise, `purchase_conflict`

**The open id is what makes a retry safe**, and it is the whole answer to "the coins went and the cards did
not". The screen makes one id per purchase (`newOpenId`) and keeps it until that purchase is answered for
certain. `offline`, `network` and `server` mean the outcome is UNKNOWN - the pack may have been bought and
the answer lost - so the screen keeps the id, says it does not know, and its button becomes **Try again**,
which asks about the same purchase. `PACK_SENTENCES` may promise "never charged twice" because step 3 keeps
it; `tests/test-cards-screen.mjs` fails if one of those three sentences ever claims nothing was charged.
The ids are held by the card area, one per pack, so switching to the Collection tab (the first thing anyone
does) or buying a different pack keeps them; leaving the card area altogether forgets them, and a pack that
was bought is then simply in the collection.

**Which refusals are certain.** `unavailable`, `sold_out`, `price_changed` and `not_enough` are buy_pack's
own, made AFTER it has looked for an earlier charge under the same id - so they are a certain no even on a
retry. Everything refused before the database is asked (`signed_out`, `cards_off`...) is a plain no on a
first attempt and settles nothing on a retry: the screen keeps the purchase and says "we still can't confirm"
rather than "nothing was charged". And the function reports a refusal only for buy_pack's exact raise (code
`P0001`, a message that is nothing but the reason): a gateway's "service unavailable" is a 500, never the
refusal `unavailable`.

Three things found in review, each of which was a second charge or a lost purchase waiting to happen: the id
lived in the shop component and died on a tab switch; one slot was shared by every pack; and an answer that
landed after the shop was left was dropped before the wallet or the collection heard of it.

Every reason is in `CARD_REFUSALS` and has a sentence in both `CARD_SENTENCES` and `PACK_SENTENCES`. The
pack refusals travel as the keys of `PACK_REFUSALS` in the function rather than as `reason: "..."` literals,
so `tests/test-cards-edge.mjs` reads that table separately.

### 9.3 The screen

An account gets two tabs on the card area, Collection and Packs (`PackShop` in `cards.jsx`). The shelf has
its own three answers - loading, could-not-load, the packs - for the reason the collection does. **Who is
inside** prints the finish odds, the odds by rating band, and every card with its own chance: twelve to begin
with and all of them on request, so the odds are published in full. Open asks to Confirm with the price in
the button - Open, Confirm and Try again are ONE button whose label changes, so keyboard focus is never
dropped. After a purchase the cards appear under "You pulled", which takes focus so a screen reader lands
on what happened. The shop reads the wallet itself on opening: the app only loads it for a profile or the
cosmetic shop, so a player arriving from Modes had no balance on screen. A price that went up, a sell-out or a pack taken off sale re-reads the shelf, so the screen
stops offering what it cannot sell.

### 9.4 What they cost, measured

`tests/test-economy-security.mjs` (test 11) reads the seed's prices and prints, from the same earning rates
the shop is held to: a casual day opens about 2.2 Standard packs and a heavy day about 14; the 10,000 starting
cap opens 66; a card rated 100+ costs about 3,970 coins through Standard, 2,370 through Air raid and 3,000
through Legends. **Legends was first written at 1,500 and that was wrong**: the one pack certain to hold a
100+ card was also the cheapest route to one, by 40%. The test now holds that it is never cheaper than the
cheapest other route. Coins farmed through the economy's known gaps buy cards as well as cosmetics now; cards
change nothing in a draft, a score or a board, and the battles in part four must be priced against that.

**Before any coin is sold for money**, a pack with random contents bought with a purchasable currency is the
thing loot-box rules are written about, and that question goes to the owner's lawyer first.

### 9.5 Runbook

- **Change a price:** `update card_packs set price = 200 where id = 'pack-standard';` - and edit the seed in
  `migration-cards.sql` and `PACK_SEED` in `tests/mock-cards.mjs` so new databases and the tests agree.
- **Take a pack off sale:** `update card_packs set active = false where id = 'pack-air-raid';`
- **Restock the limited pack:** `update card_packs set stock_left = stock_total where id = 'pack-legends';`
- **A new pack** is an entry in `card-packs.mjs`, a seed row here, a picture
  (`tools/cards/source/` then `node tools/cards/build-pack-art.mjs`), and both halves shipped together.
- **What did somebody buy:** `select ref, amount, created_at from wallet_ledger where user_id = '<uuid>' and
  kind = 'pack';` then `select ref, card_id, finish from card_grants where user_id = '<uuid>' and kind =
  'pack' and ref like '<open id>:%';`

## 11. Battles: who runs them, and what is written down (v2.27.0, on the test site)

The rules are sections 3 to 7. Stage one of the owner's four modes is here - the **ladder** and the **daily
battle**; the historical gauntlet and the draft arena are not built.

### 11.1 Who decides what

| | Decided by |
|---|---|
| The deck | the player (`deck_save`); `bestDeck` if none is saved |
| The hand of twelve | `card-claim`, with the cryptographic generator, **stored before it is shown** |
| Which six, and their order | the player, in the browser |
| Whether that six is legal, and came out of the hand | `teamProblem` in `card-claim` |
| Whether the cards are theirs | `card_lineup_owned` in SQL, in the transaction that writes |
| A ladder team | `ladderFoe(seed, step)`; the seed is `card-claim`'s and kept in `card_runs` |
| A ladder battle's luck and category order | `card-claim`, fresh |
| The daily's team, categories and luck | the UTC date |
| Whether it counts, and what it pays | `card_run_battle` / `card_daily_record`, one transaction each |

Nothing the browser sends about a result is read.

### 11.2 The database

`card_decks (user_id, cards)`, `card_runs (id, user_id, seed, wins, hand, foe, status, last, ...)`,
`card_dailies (date, user_id, hand, rounds, score, shown, dealt_at, played_at)`. **RLS on, no policy of any
kind, no grant to a client role.**

- **A hand is stored, never derived.** A hand that followed from the deck could be re-dealt by editing the
  deck. `card_run_start` keeps the first hand it is handed for a live run, `card_run_battle` stores the next
  one with the win, and `card_daily_deal` keeps the first hand of the day whatever it is handed after.
- One live run an account (a partial unique index). `last` is the latest battle as it was shown.
- **No name snapshot**: `card_boards` joins `profiles` when read, so `mod_act`, `claim_username` and the
  `use_account_username` trigger know nothing of these tables. A guest can never own a card.
- `delete_account` erases all three.
- **The first version's tables are cleared once.** v2.25.0 (test site only) had `card_runs.defense` and a
  `card_showdowns` table; the migration recognises that shape by the `defense` column and drops it. It can
  be re-run on any shape and never drops a run of the new kind (a test holds both).

Service role only: `card_deck_read`, `card_deck_save`, `card_run_start`, `card_run_battle`, `card_run_end`,
`card_daily_deal`, `card_daily_record`, `card_lineup_owned`, `card_list_check`. Signed-in players, as GETs:
`card_battle_state()` and `card_boards(limit)`.

- **`card_run_battle` checks the step under a lock**, so a double tap or two tabs cannot both count: the
  second raises `stale` having changed nothing.
- `card_battle_state` returns the account's **latest** run, live or over, with `last` - what lets a browser
  whose answer was lost learn that it lost and be shown the battle.

### 11.3 The function

`card-claim` actions: `deck_save { cards }`, `run_start`, `run_battle { run, step, team }`, `run_end`,
`daily_deal`, `daily_play { team }`. It bundles `card-logic.mjs`, `rewards.mjs` and `data/cards.json`, so **a
change to any of those ships the function and the client together**.

### 11.4 Coins

A ladder win pays `cardWin` (3) plus `cardWinStep` (1) for each win the run already had, to 12;
`paidCardWinsPerDay` (15) wins pay per UTC day. Ledger kind `card_win`. The daily battle pays nothing.

### 11.5 The screens

`card-battle.jsx`, mounted by `cards.jsx` under Battle: Ladder, Daily, Deck, Boards.

- `CardRow` is a card as a row: its six category scores are always on show, because they are the game. A
  strong one is a lime FILL with its own ink, never lime text.
- `TeamPicker`: their six in order, your six in order with up/down, your hand of twelve.
- `Arena` is the owner's layout: your active card left, theirs right, a big VS, the stat comparison, the
  round's winner called; your six as a strip with the active one lit; the score, the round, a speed control
  and a battle log. Four beats a round. **It plays where `matchMedia` says motion is fine and is simply
  finished everywhere else** (reduced motion; jsdom, so every test sees the finished battle; a daily opened
  again later). The parent hides the heading, the coins and the next button until `onDone`. Nothing fades.
- **A failed play is not "not played".** The screen never replays after a lost answer: it reads
  `card_battle_state` and shows what is there.

### 11.6 Runbook

- **End somebody's stuck run:** `select card_run_end('<user uuid>');`
- **See a run:** `select id, wins, status, hand, foe, last from card_runs where user_id = '<uuid>' order by id desc;`
- **Give a day's battle back:** `delete from card_dailies where date = '<date>' and user_id = '<uuid>';`

### 11.7 Not built, and known gaps

- The **historical gauntlet** and the **draft arena** (the owner chose all four modes; these are stages two
  and three). No badge, nothing on the profile.
- **Open design question from the owner (2026-11-14):** whether choosing between two cards feels like a
  choice. Today the six and their order are set before any category is known. The sharper version is to play
  a round at a time - commit a card, then see the category - which needs the server to hold a battle in
  progress.
- The team picker is long on a phone: twenty-four card rows.
- Two accounts are two collections; nothing stops one person climbing twice.

## 12. Copies (v2.26.0, on the test site)

**A player holds one of a card in a finish. The next one is sold.** Owner's decision, 2026-11-14.

- **What a card is worth** is `rewards.mjs`: `cardValue(rating, finish)` is the rating band (under 60: 20,
  60-79: 40, 80-99: 100, 100-119: 400, 120 and up: 1,500) times the finish (Base 1, Silver 2, Gold 5,
  Prism 20). `cardSellCoins` is half of that. A Base role player sells for 10; a Prism 120+ for 15,000.
- **The database holds no catalog**, so it cannot price a card. Every grant an Edge Function makes carries
  `sell`, the coins a copy would fetch, and `grant_cards` decides whether it applies: only when the account
  already holds that card in that finish. Then the grant still happens once - its `card_grants` row is
  written, so a day's card is still "given" - but the count does not move and the coins are credited under
  `(user, 'card_sell', '<kind>:<ref>')`. The entry comes back with `sold`.
- **An entry with no `sell` stacks**, as before. That is what a hand-out from the SQL editor does (8.6).
- **Stacks from before** (and any a hand-out makes): `card-claim { action: "sell_copies" }` reads
  `card_copies`, prices each from the catalog, and `card_sell_copies` sells whatever is past one under a
  row lock, as one ledger row. `cards.jsx` asks once per visit when it sees a count above one. A card the
  function's catalog does not know is left stacked rather than sold for nothing.
- **A pack is never a way to make coins.** The worst case is a full collection, where every pull is a copy;
  `tests/test-economy-security.mjs` measures it and holds each pack under 80%. As measured: Standard 57%,
  Air raid 54%, Legends 69% of the price back.
- The same card in another finish is another card and is kept.
- On screen a sold card is `PulledCard`: the card tips and greys, a coin badge lands on it, and the sale is
  written underneath. The sentence is the fact; the animation is decoration, and nothing in it fades.

**Not built:** selling a card you hold one of, trading, or seeing a card's value before you pull it.

## 10. Tests

```bash
node tests/test-card-catalog.mjs   # the catalog: every pool row is a card, and a rebuild never rewrites one
node tests/test-card-logic.mjs     # archetypes, traits, lineup refusals, scoring, the showdown, a pinned checksum
node tests/test-card-balance.mjs   # plays ~6,000 battles and PRINTS the balance table above (about 70 seconds)
node tests/test-cards-sql.mjs      # the migration in PGlite: nobody writes the tables, a grant happens once, SQL == mock
node tests/test-cards-edge.mjs     # the real card-claim, executed: its order of refusals, eight cards, once
node tests/test-cards-daily-edge.mjs # the real submit-run: a daily earns one card, and a failed grant never costs the season
node tests/test-cards-client.mjs   # the switch, the catalog load, and a collection read with three answers
node tests/test-card-sprites.mjs   # fourteen PNGs of the size a card draws
node tests/test-card-face.mjs      # the recolouring maths, the spoken label, contrast, a card with no sprite
node tests/test-cards-screen.mjs   # the tile, the starter deck, the collection, the pack shop, the daily card on the result
node tests/test-card-packs.mjs     # what is in a pack: the odds add up, and 20,000 rolls match what is stated
# Battles ride in the same files: test-cards-sql (runs, the showdown, the boards, SQL == mock), test-cards-edge
# (the function plays them), test-cards-screen (the buttons), test-card-logic (runDefense, the projection).
```
