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

`tools/cards/build-sprites.mjs` cuts the owner's sheets into `static/cards/<pose>.png`: paper cleared,
painted number erased, still in the sheets' own blue, grey and tan. `tools/cards/poses.json` maps each
archetype (and `role`) to a sheet cell. **Look at `build/card-sprites-check.png` after running it**; no test
can see a half-erased number.

`card-sprites.mjs` recolours a sprite in the browser on a canvas: jersey to the team's first colour, helmet
and pants to its second (they are the same grey on the sheets, so they cannot differ), skin to the player's
tone. `data/card-skin.json` maps a `pid` to one of five tones; **its player list is empty, so every card
wears the default.** No canvas, or a sprite that will not load, leaves the neutral drawing or none - the card
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
- **A new kind of grant** (packs are next) is two edits in `migration-cards.sql`: the named constraint
  `card_grants_kind_check`, which the file drops and re-adds, and the list inside `grant_cards`.
- **See what someone owns:** `select card_id, finish, count from card_owned where user_id = '<uuid>';`

## 8b. Not built

Packs and their odds, the server side of battles and runs, the battle screen, badges, the profile's best card,
boards, the real skin-tone list. `/privacy` and `/terms` do not mention cards yet; they change in the release
that switches cards on for production. The owner's full 50-pose sprite set arrived at about 100x135 pixels a
sprite and is wanted at full size; the sprites in use are cut from the first two sheets. The licence on the
tool that made the sprites is cleared (owner, 2026-11-13).

## 9. Tests

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
node tests/test-cards-screen.mjs   # the tile, the starter deck, the collection, hiding it, the daily card on the result
```
