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

## 3. Defenses and traits

The opponent is always a real team defense from `data/versus-pool.json`, the file Duel ships (859 team-seasons,
1999-2025).

| id | Label | Stat |
|---|---|---|
| stingy | Stingy | fewest points allowed |
| runstop | Run stopper | fewest rushing yards allowed a game (`data/card-defense.json`) |
| ballhawks | Ball hawks | most interceptions |
| passrush | Pass rush | most sacks |
| strip | Strip artists | most fumbles (the pool's `fum` column) |
| scoring | Scoring defense | most defensive touchdowns |

**A defense has a trait when it is in the best five of its own season** for that stat, ties broken by team code.
Within a season, not across the pool: scoring and sack rates moved so far between 1999 and 2025 that a raw cut
would give every Stingy to the early 2000s. So every season has exactly five of each. 411 defenses have no
trait, 219 have one, 229 have two or more.

**Run stopper has a data file of its own.** Duel's `versus-pool.json` has no yards allowed, and the season file
it is built from has no such column. `tools/data/build-card-defense.mjs` writes `data/card-defense.json`
(season, team, games, rushing and passing yards allowed a game) from nflverse's weekly team file, where each
row is what one offence gained against a named opponent - so a defense's yards allowed is the sum of what its
opponents gained. Regular season only.

- **It is a separate file on purpose.** `versus-pool.json` is carried by both the browser and the `match-pick`
  Edge Function, which must agree on every number in it, and rebuilding it re-fetches its sources. Adding two
  columns there would risk moving a defense's rating under a live duel for a trait Duel never reads.
- `initDefenses(versusPool, yardsAllowed)` takes it as an optional second argument. Without it a defense has
  no `rush` and no Run stopper - absent, never guessed.
- **22 defenses from 1999 to 2002 are averaged over fifteen games**, because the source is missing one of
  theirs (mostly opponents of the two broken Jaguars seasons the pool already leaves out). The builder prints
  them and refuses any defense missing more than one game. 2022's Bills and Bengals have sixteen for real.
- Pinned by hand: the 2000 Ravens at 60.6 rushing yards a game (970 in sixteen), the fewest in the pool.
- Passing yards allowed is in the file and nothing reads it yet.
- Rebuild it when a season is added to `versus-pool.json`: `node tools/data/build-card-defense.mjs`. It
  refuses to write a file that does not cover that pool exactly.

## 4. Lineups

The draft's six slots: QB, RB, WR, TE, FLEX1, FLEX2 (Flex is anyone but a quarterback). A lineup is
`{ [slot]: { id, finish } }` - the card and the finish of the copy being played.

`lineupProblem(lineup, owned)` answers `null` or the first of these, in this order. It never throws.

| Reason | Meaning |
|---|---|
| `malformed` | not an object, a key that is not a slot, or an entry that is not an object |
| `incomplete` | a slot is missing |
| `unknown_card` | an id that is not in the catalog |
| `bad_finish` | not one of `base`, `silver`, `gold`, `prism` |
| `bad_slot` | the card's position does not fit the slot |
| `same_player` | two entries are the same man (by `pid`), even in different seasons |
| `not_owned` | `owned` (a Map of `"id:finish"` to count) has fewer than one |

Every one of these will need a sentence in whichever client module receives it.

## 5. How a battle scores

`scoreBattle(lineup, defense, rand, step = 0)`. For each card, in slot order:

- **base** = printed rating + finish bonus (Base 0, Silver 1, Gold 2, Prism 3). The printed rating plays in
  every slot; `flexRating` is not used.
- **roll** = `(rand() + rand() - 1) * LUCK_SPREAD`. Two draws a card, twelve a battle, always.
- **mods**: a counter when the defense has a trait that touches the card's archetype; a pair when the lineup
  also holds the partner archetype (once per card, however many partners).
- **total** = base + roll + mods. The six totals are the offense; `win` is offense >= the bar.

**The bar rises with every win in a run** (owner's decision, 2026-11-13):
`bar = BAR_START + BAR_STEP * step + BAR_DEFENSE * (defense rating - BAR_PIVOT)`, `step` being the run's wins so
far. It replaced a bar fixed per defense, which could not work: a starter deck's best six add up to about 246,
sixty random cards to 641 and the sixty best to 780, so one bar was a 0.4% win rate for a new player or a
walkover for everyone else.

Constants as tuned: `LUCK_SPREAD 26`, `BAR_START 190`, `BAR_STEP 55`, `BAR_DEFENSE 1.5`, `BAR_PIVOT 65`.

Counters (trait, then archetype and points):

| Trait | Hurts | Helps |
|---|---|---|
| Stingy | Goal-line back -20, Red-zone target -20 | |
| Run stopper | Workhorse -20, Goal-line back -15, Home-run hitter -15 | Receiving back +10 |
| Ball hawks | Gunslinger -25, Volume passer -20 | Game manager +15 |
| Pass rush | Volume passer -20, Gunslinger -15 | Scrambler +20, Safety valve +13, Receiving back +13 |
| Strip artists | Workhorse -20, Home-run hitter -15 | Possession +10 |
| Scoring defense | Volume passer -15 | Game manager +15, Workhorse +10 |

Pairs (points to each card): Gunslinger + Deep threat 16; Gunslinger + Seam stretcher 12; Game manager +
Possession 12; Game manager + Safety valve 10; Scrambler + Home-run hitter 12; Volume passer + Receiving back
12; Volume passer + Possession 10.

**These numbers are tuned, not chosen.** Change one and run `node tests/test-card-balance.mjs`.

## 6. Balance, as measured on 2026-11-13

Two bots pick lineups for each defense in a run: one takes the six highest ratings, one reads the defense and
searches for the best no-luck score.

| | Measured | Band |
|---|---|---|
| Starter deck (8 cards under 60): wins in an average run | 1.60 | 0.8 to 2.5 |
| Starter deck: runs with no win at all | 7% | 2% to 30% |
| 60 random cards: wins in an average run | 8.70 | 5 to 10 |
| ...more than the six highest ratings manage | +0.34 to +0.37 wins | at least 0.25 |
| ...reading the defense picks a different six | 68% to 80% of battles | at least 40% |
| ...luck changes how long a run lasts | 29% to 31% of runs | 20% to 75% |
| ...by this many wins on average | 0.34 to 0.38 | 0.2 to 1.0 |
| ...a card rated under 70 is in the chosen lineup | 16% to 24% of battles | at least 10% |
| The 60 best cards: wins in an average run | 11.5 | 9 to 16 |
| Runs that reach 40 wins | none | none |

Run stopper was added after these were first measured and moved them very little (the default seeds went from
+0.35 to +0.37 wins for reading the defense). Ranges are across three different sets of collections and defenses (`node tests/test-card-balance.mjs 9000 13`
plays another). The first version used twenty collections and two of three other seed sets failed a band; it
uses fifty now.

**What these bands do not hold.** Any single counter or pair: review deleted six of the seven pairs and zeroed
every positive counter and one band moved, by less than seed noise. And the open question the numbers cannot
answer: reading the defense is the better pick in most battles but is worth only about a third of a win per
run, because one win is 55 points of bar and a good matchup is 10 to 25. Whether that is enough is for
somebody playing it to say. The starter bands measure the bar alone - eight cards rarely offer a second lineup.

What it does not tell you: whether this is fun. The bands are the builder's reading of the design, not the
owner's numbers, and nobody has played a battle. A player is also not the search bot - a real person will find
fewer of the good lineups than it does.

**The numbers the next plans need:** a new player wins about 1.6 battles a run; a player with sixty cards
about 9. Coin rewards per win and the daily cap on paid wins should be set from those.

## 7. The daily showdown

`showdownDefense(date)` picks one defense for the day from the seed `showdown-<date>`.
`showdownScore(date, lineup)` gives **each card one roll for the day**, seeded from the day and the card's id and
nothing else. 2007 Brady has the same game today in every lineup, slot and finish. So the same six cards score
the same for everyone, a better finish adds exactly its bonus, and the board rewards the lineup rather than
the roll. The score is the offense; there is no step and no win or loss.

It was first seeded from the whole lineup, and review found what that did: swapping the two Flex cards or
fielding a different copy re-rolled all six, so the same cards scored anywhere from 693 to 891. Seed nothing in
the showdown from the slot, the finish or the other five cards.

`showdownDefense` picks by position in `DEFENSES`, so adding a season to the pool re-deals every date.
Whatever records a showdown must store the defense's key.

**Accepted gap, and it cannot be closed here:** the bundle and the seed are public, so anybody willing to run
`card-logic.mjs` can find the day's best lineup for their collection offline. It is the gap every seeded daily
in this game has.

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

Badges, the profile's best card, the real skin-tone list. Battles exist (section 11) and **nobody has played
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

## 11. Battles (v2.25.0, on the test site)

Two ways to play six cards against a defense, and two boards. The rules are sections 3 to 7; this is who runs
them and what is written down.

### 11.1 Who decides what

| | Decided by |
|---|---|
| Which six cards | the player, in the browser |
| Whether that lineup is legal | `lineupProblem` in `card-claim` (shape) and `card_lineup_owned` in SQL (ownership) |
| A run's defenses | `runDefense(seed, step)`; the seed is made by `card-claim` when the run starts and kept in `card_runs` |
| A run battle's luck | `card-claim`, fresh, with the cryptographic generator |
| The showdown's defense and luck | the UTC date (section 7) |
| Whether it counts, and what it pays | `card_run_battle` / `card_showdown_record`, one transaction each |

The browser computes only what a player needs before playing: which cards fit a slot, what a trait does to
each, and `lineupProjection` - the score with the luck at zero. Nothing it sends about a result is read.

### 11.2 The database

`card_runs (id, user_id, seed, wins, defense, status, last, started_at, ended_at)` and
`card_showdowns (date, user_id, defense, lineup, score)`. **RLS on, no policy of any kind, no grant to a
client role**: the seed says which defenses are still to come, and a lineup is a list of what somebody owns.

- One live run an account (a partial unique index). `defense` is the one to beat next while the run is
  live, and the one that ended it afterwards. `last` is the latest battle as the browser was shown it.
- **No name snapshot**, unlike every older board: `card_boards` joins `profiles` when it is read. A guest
  can never own a card, so there is no guest row to mark, and a rename cannot leave a name behind. So
  `mod_act`, `claim_username` and the `use_account_username` trigger know nothing of these tables.
- `delete_account` erases both tables' rows: they are the person's, like the cards.

Service role only: `card_run_start`, `card_run_battle`, `card_run_end`, `card_showdown_record`,
`card_lineup_owned`. Signed-in players, as GETs: `card_battle_state()` and `card_boards(limit)`.

- **`card_run_battle` checks the step under a lock.** The function reads the run, rolls, and hands back the
  run id and the wins it read; the row is locked and both are checked again. Two requests that overlap - a
  double tap, two tabs - cannot both count: the second raises `stale` having changed nothing.
- `card_battle_state` returns the account's **latest** run, live or over, with `last`. That is what lets a
  browser whose answer was lost learn that it lost, and be shown the battle.
- `today` in both readers is the server's UTC date. The browser never works out the showdown's day itself.

### 11.3 The function

`card-claim` gained four actions: `run_start`, `run_battle { run, step, lineup }`, `run_end`,
`showdown { lineup }`. New reasons: the seven from `lineupProblem`, `no_run`, `stale`. It bundles
`data/versus-pool.json` and `data/card-defense.json` now, with `card-logic.mjs` and `rewards.mjs` -
so **a change to any of those ships the function and the client together**.

### 11.4 Coins

`rewards.mjs`: a win pays `cardWin` (3) plus `cardWinStep` (1) for each win the run already had, up to
`cardWinStepMax` (9) of them - 3, 4, 5 ... 12. `paidCardWinsPerDay` (15) wins pay per UTC day; past it a
win still moves the run. Ledger kind `card_win`, ref `<run id>:<wins>`. A showdown pays nothing.

From the balance table: a starter deck wins about 1.6 battles a run, so about 7 coins a run; sixty cards about
9, so about 63. Fifteen paid wins is roughly 50 to 110 coins a day - under a Daily's 40-plus-wins, and a
Standard pack (150) every day or two for somebody who plays both. **These are the builder's numbers.**

### 11.5 The screens

`card-battle.jsx`, mounted by `cards.jsx` under three more tabs: Run, Showdown, Boards.

- A defense is shown, with what each trait does, **before** the lineup is picked.
- The clash is CSS only: six cards appear one after another and a meter runs to the total. Nothing fades -
  half-opacity text is below AA for as long as the fade lasts, and axe caught exactly that.
- **A failed play is not "not played".** `offline`, `network` and `server` may follow a battle that was
  played. The screen never replays to find out: it reads `card_battle_state` and shows what is there. Only
  when that confirms the run did not move does it say the battle was not played; when the state cannot be
  read either it says so, and promises only that a battle is never played twice.
- `/data/card-defense.json` is fetched like the catalog (build.mjs copies it where cards are on).

### 11.6 Runbook

- **End somebody's stuck run:** `select card_run_end('<user uuid>');`
- **See a run:** `select id, wins, status, defense, last from card_runs where user_id = '<uuid>' order by id desc;`
- **Take a showdown back:** `delete from card_showdowns where date = '<date>' and user_id = '<uuid>';`

### 11.7 Not built, and known gaps

- No badge, nothing on the profile (part 5). No history of battles: a run keeps only its latest.
- Two accounts are two collections, so nothing stops one person running two. It moves only these two boards.
- The showdown's gap is section 7's: the day's best lineup can be worked out offline.
- A run's seed never leaves the server, but each defense is known once it is shown - walking away from a bad
  draw costs the streak, which is the price the design set on it.

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
