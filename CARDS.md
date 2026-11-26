# CARDS.md - card collecting and card battles

**Status: in progress, and on the test site only** (v2.31.0, four parts of five). A player there can open a
starter deck, earn a card a day from the daily draft, buy packs with coins, and battle: a ladder of CPU teams,
a daily battle and a gauntlet of twelve real offenses. Badges and the profile spot are not built. **The draft
arena - once a fourth mode - was dropped by the owner on 2026-11-14: do not build it or offer it.** Production
has cards switched off: no tile, no catalog file, and the functions grant nothing. Sections
1 to 7 are the rules; section 8 is owning cards; 9 packs; 11 to 15 battles and how the screens load.

The design is `docs/superpowers/specs/2026-11-13-card-collection-design.md`, and for the battle as it is
played since v2.31.0 - the category called, no Flex, one panel -
`docs/superpowers/specs/2026-11-14-card-battle-calls-design.md`; read them for the why. This file is
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

## 4. Decks, hands and spots

- A **deck** is thirty cards you own: 5 QB, 10 RB, 10 WR, 5 TE, thirty different men. `deckProblem`.
  An account that never saved one plays `bestDeck` of what it owns.
- A **hand** is twelve of the thirty - 2, 4, 4, 2 - dealt by the server for each battle (`dealHand`, twelve
  draws). So a deck is never a guaranteed lineup.
- A battle is six **spots**, one a round: `SPOTS` is QB, RB, RB, WR, WR, TE, in a random order. **There is no
  Flex** (v2.31.0, the owner's call: a Flex round offered every back, receiver and tight end left - "a ton of
  players"). So a round offers two to four cards and never more. The order is the other team's - each of its
  six cards carries the `spot` it plays, and yours answers in the same spot. `spotFits` still answers for
  `FLEX`, so a battle begun before v2.31.0 can finish.
- **You play one card a round**, out of the hand, **knowing the category and not the card across from you**
  (their card has been hidden since v2.28.1: the owner said seeing it first gave the surprise away).
  `maskFoe(foe, played)` is what every ladder answer and `card_battle_state` send: the cards already met,
  and for the rest the spot alone. (The daily battle's team follows from the date and the gauntlet's is a real
  offense named on the screen, so those are hidden by the screen or not at all.)
- A hand always has a way through: each position covers its own spots. `leavesAWay` and `playable` are what
  the bots ask; `cardProblem` is what the screen asks, card by card.
- `autoPick` is the highest rating that may be played, and `bestCategory` is the category that card is worth
  most in. Together they are the DULL choice on purpose - the screen's "Pick for me" and a bot the balance
  numbers are measured against.

### 4.1 The call (v2.31.0)

**A round's category is CALLED before the card is picked.**

- **You call round one. After that, whoever won the last round calls.** A dead heat leaves the call where it
  was. Who calls follows from the rounds played and nothing else: `callerOf(rounds)`.
- **On your call** you name a category not yet used, then a card for the spot.
- **On their call** they name the category first - their card's best of the ones left, `foeCall(foe, rounds)`:
  the most `categoryWorth` (`roundBase` plus an ability that fires on the category), ties to `CATEGORIES`
  order, no draws - and you choose who answers it.
- **Each category is used once a battle**, so the sixth round's is whichever is left.
- `roundProblem(hand, foe, rounds, entry, cat)` is the door: `cardProblem`'s reasons (`malformed`,
  `unknown_card`, `bad_finish`, `not_in_hand`, `bad_slot`, `already_played`, `same_player`), then
  `bad_cat` when the call is yours and `cat` is missing, made up or spent. On their call `cat` is not looked
  at. It never throws.
- **A round carries the call for the next one**: `next: { by, cat }` (`nextCall`), `cat` set when it is
  theirs or when one category is left, `null` after the sixth. The ladder hides their cards, so the browser
  cannot work their call out; this is how it learns it, including after a reload, because a round is stored
  as written. It is also why v2.31.0 needed no migration.

**Why.** Three versions failed one test from different sides. v2.27.0 set the six and their order with every
score on show - the owner: given two tight ends and told which scores more, there is no choice. v2.28.0 hid
the category until the card was down, and v2.28.1 hid their card too - the owner: "it just seems like you are
picking random cards and things are happening, there is no choice or consequences". The balance test agreed:
choosing as well as the screen allowed beat always playing the highest rating by three battles in a hundred.
A choice needs something you know and something you give up. Now the category is known, a category spent on
one card is gone for the rest, a card played is gone too, and a round won is the next call.

**What the reveal prints** (v2.28.1): `categoryStat(card, cat)` is the real number a category ranks, in words
("11 TD in 17 games"). Display only; the score is still the rank.

## 5. How a round scores

`playRound(foe, rounds, entry, cat, rand, foeEdge = 0)` plays one; `scoreBattle` is the same thing six times.
`cat` is the category YOU called; on their call playRound ignores it and plays `foeCall`, so the function,
the mock and the bots cannot disagree about whose category it is. A card's round:

    RATING_SHARE x rating  +  the rest from its category score  +  finish  +  synergies  +  ability  +  luck

The higher total takes the round. Win more rounds; a 3-3 split goes to the higher six-round total, and a dead
heat to you (`battleResult`). So the overall rating is part of every round and never the whole of one.

- **Draws are counted:** four a round (two a card, yours first), twenty-four a battle, and none to order the
  categories. The browser and the Edge Function must walk the generator in step.
- **Synergies build as you play** (`playedSynergies(entry, earlier)`): a card is lifted by the cards of yours
  already down - +2 for each from the same team (to 6), +1 for each from the same season (to 3), +2 once for
  a real teammate, and the archetype pairs. So an early card sets up a later one, and the last card can be
  worth the most.
- **Abilities**, one an archetype (`ABILITIES`). Some fire on the category (Gunslinger and Home-run hitter in
  Big play, Goal-line back and Red-zone target in Touchdown threat) - **which a player now AIMS**, by calling
  it - some on the battle so far (Workhorse after a win, Seam stretcher when behind, Deep threat and Receiving
  back once the quarterback has played), the Scrambler against a higher-rated card. A Game manager lifts the
  NEXT card his side plays. A Safety valve cancels the ability across from him.
- **A finish** adds `FINISH_BONUS` to every round, whole: Silver 5, Gold 10, Prism 15 (v2.28.1; it was 1, 2, 3
  folded into the rating, so 40% of it counted). It is a `finish` mod on the round, not part of `roundBase`.
- **Luck** is a triangular roll within `LUCK_SPREAD` (14), half as wide again for a Gunslinger.
- Constants as tuned: `RATING_SHARE 0.4`, `CAT_SCALE 1.3`, `LUCK_SPREAD 14`, `CPU_START 38`, `CPU_STEP 7`,
  `CPU_MAX 124`, `CPU_EDGE 0.6`, `DAILY_TARGET 86`. v2.31.0 moved none of them.

**These numbers are tuned, not chosen.** Change one and run `node tests/test-card-balance.mjs`. A change
also moves the 2,000-battle checksum in `tests/test-card-logic.mjs`, and then the client and the functions
must ship together.

## 6. Balance, as measured on 2026-11-14 (the category called)

Three collections climb the ladder, played by three players. None can see the card across from them or the
luck. **Careless** plays any card that fits and, on its call, any category left. **Dull** is "Pick for me": the
highest-rated card and that card's best category. **Careful** reads the screen: on its call the
card-and-category pair worth the most, on theirs the card worth the most in what they called.

| | Careless | Dull | Careful | Band (who it binds) |
|---|---|---|---|---|
| Starter deck: wins a run | 0.43 | 1.75 | 2.41 | 0.8 to 3 (dull) |
| ...loses its very first battle | 62% | 16% | 5% | at most 40% (dull) |
| Sixty random cards: wins a run | 4.37 | 7.42 | 8.15 | 4 to 9 (careful) |
| The sixty best cards: wins a run | 12.62 | 12.78 | 13.48 | 8 to 16 (careful) |
| An even match: wins the battle | 8% | 62% | 73% | careful 40 points over careless |
| ...wins a round it called | 33% | 63% | 67% | 35% to 80% (careful) |
| ...they win a round they called | 73% | 57% | 53% | 35% to 80% (careful) |
| ...6-0 either way | 13% | 3% | 5% | under 15% (careful) |

Also held: no run reaches forty wins; careful beats careless by at least 2 wins a run and dull by at least 0.3
(sixty random cards: 3.78 and 0.73); a lower-rated card takes at least 0.3 rounds a battle off a higher-rated
one (0.67); one hand against one team twenty times gives the less likely result 8% to 35% of the time (15%).

**Before v2.31.0**, with the category hidden until the card was down, the same even match measured 12% / 45% /
48%: reading the screen was worth three battles in a hundred over "Pick for me". That is the number behind the
owner's "it feels random".

**Does winning the call run away with a battle?** No: sweeps are rare, and the side answering a call wins the
round nearly half the time. Loser-calls and alternate-calls were simulated too (62% and 75% for the careful
player, sweeps 0% and 2%); winner-calls was kept because it is the one where a round has a consequence.

**What these do not hold:** any single ability, pair or bonus; and whether it is fun. The bands are the
builder's reading of the design. The careful player is one greedy read of the screen, not a person: a planner
that saved categories for later cards did no better in a scratch run, which says more about that planner than
about the game.

## 7. The other side

- `buildTeam(rand, target)`: one card for each of the six spots, each within `CPU_BAND` of the target
  rating (widening only if a position has nobody there), six different men. Each entry carries its `spot`,
  and all six are shuffled. Eleven draws.
- **The ladder:** `ladderFoe(seed, step)` at `ladderTarget(step)` - 38, then 7 more a win, to 124. Past the
  best cards the game holds it cannot field a stronger team, so `ladderEdge(step)` adds points to every card
  of theirs instead; without it the best collections never met anything that could stop them.
- **The daily battle:** `dailyFoe(date)` and `dailyRound(date, rounds, entry, cat)` - one team, calling the
  same way for everyone, and **one roll per card per day**, so the board rewards the six, where they were
  spent and what was called, and not the roll.
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
- **The collection draws twenty-four cards at a time** (`COLLECTION_PAGE`, v2.31.1), best first, with "Show 24
  more" and "Showing 24 of 634." under them. A filter, or leaving the tab and coming back, starts at one page
  again - by resetting the window in the same event, so the old, longer list is never drawn once more on the
  way. The owner's collection reached 600 on the test site and the screen drew them all.
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

**What a card costs to draw, measured (v2.31.1).** A profile of a 634-card collection in Chrome: painting ONE
card's figure took about 70ms on a desktop, two thirds of it writing the painted canvas out as an image - and
a grid's cards were all painted in one stretch, which is the page freezing. Three things changed, in
`card-sprites.mjs`:

- **`PAINT_HEIGHT` (360).** A figure is 118/172 of its card, the widest card is 172px, and the densest phones
  have three pixels to one: 354 rows is the most anybody sees. Painting all 640 was three times the pixels.
- **A PNG, not a WebP.** At that size Chrome writes a WebP in 30ms and a PNG in 4. The PNG is six times the
  bytes (180 KB), so `PAINT_CACHE_MAX` fell from 96 to 64 to hold about the same memory. Safari wrote a PNG
  whatever it was asked for.
- **`paintSoon`: one paint a frame.** A card asks and is called back; a request for something already painted
  costs no frame, and a card that has left before its turn is skipped. `useCardSprite` (card-face.jsx) is the
  only caller - `paintSprite` is still the function that paints.

Twenty-four more cards, in a Chrome slowed four times: 9.6 seconds before, 0.9 after. Scrolling 24 cards is
about 35 frames a second there; scrolling all 634 is about 2 to 5, whatever a card costs to paint - which is
why the window stays.

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

**Being sent is not being unanswered (v2.31.1).** A purchase is in the card area's `pending` map from the
moment it is sent - that is what lets Try again ask about the same one. Until v2.31.1 the shelf read that map
alone, so every pack on its way was drawn as one whose answer was lost: "We couldn't confirm that purchase"
under it, the count fallen back to one, for as long as it took to open. The owner saw it on every purchase
while every purchase went through. `inFlight` (this pack, busy) is now told apart from `waiting` (in the map
and NOT in flight), and the "you need N more coins" and "only N left" lines are held back during a batch,
whose wallet falls a pack at a time. `tests/test-cards-screen.mjs` holds a purchase's answer and reads the
screen while it is on its way, which nothing did before.

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

## 11. Battles: who runs them, and what is written down (v2.28.0, on the test site)

The rules are sections 3 to 7. Two of the three modes are here - the **ladder** and the **daily battle**; the
historical gauntlet is section 13. (There were to be four: the draft arena was dropped, 2026-11-14.)

### 11.1 Who decides what

| | Decided by |
|---|---|
| The deck | the player (`deck_save`); `bestDeck` if none is saved |
| The hand of twelve | `card-claim`, with the cryptographic generator, **stored before it is shown** |
| The card for each round | the player, in the browser, one at a time |
| Whether that card may be played now | `roundProblem` in `card-claim`, against the stored hand and rounds |
| Whether the cards are theirs | `card_lineup_owned` in SQL, in the transaction that writes |
| A ladder team | `ladderFoe(seed, step)`; the seed is `card-claim`'s and kept in `card_runs` |
| A round's category | whoever calls it: the player on their call (`roundProblem` refuses `bad_cat`), `foeCall` on theirs - decided inside `playRound` |
| A ladder round's luck | `card-claim`, fresh, as the round is played |
| The daily's team and luck | the UTC date |
| Whether a round counts | `card_run_round` / `card_daily_round`, which take the round's number |
| Whether the battle counts, and what it pays | `card_run_battle` / `card_daily_record`, one transaction each |

Nothing the browser sends about a result is read.

### 11.2 The database

`card_decks (user_id, cards)`, `card_runs (id, user_id, seed, wins, hand, foe, cats, rounds, status, last, ...)`,
`card_dailies (date, user_id, hand, log, rounds, score, shown, dealt_at, played_at)`. On `card_runs`,
`rounds` is the list of rounds played in the battle in progress; on `card_dailies` that list is `log`,
because `rounds` there was already the number of rounds won. **RLS on, no policy of any
kind, no grant to a client role.**

- **A hand is stored, never derived.** A hand that followed from the deck could be re-dealt by editing the
  deck. `card_run_start` keeps the first hand it is handed for a live run, `card_run_battle` stores the next
  one with the win, and `card_daily_deal` keeps the first hand of the day whatever it is handed after.
- **`cats` is not read any more** (v2.31.0). The category is called, not drawn. `card_run_start`,
  `card_run_battle` and `card_gauntlet_start` still require a six-long array, so `card-claim` still hands one
  in (`CATEGORY_IDS`); dropping the columns is a later tidy-up. `card_battle_state` returns the rounds
  played, and each carries `next` - who calls the round to come and, when it is theirs, what - which is
  everything a browser coming back needs.
- **A round is written by its number.** `card_run_round` and `card_daily_round` take the index of the round
  being played and raise `stale` unless it is the next one, under the row's lock - so a double tap, two
  tabs or a retry cannot play a round twice or re-roll one. The fifth round is the last a round function
  writes; the sixth goes down with the result, in `card_run_battle` / `card_daily_record`.
- A run from v2.27.0 has no `cats`; the migration ends any that is live. Test site only.
- One live run an account (a partial unique index). `last` is the latest battle as it was shown.
- **No name snapshot**: `card_boards` joins `profiles` when read, so `mod_act`, `claim_username` and the
  `use_account_username` trigger know nothing of these tables. A guest can never own a card.
- `delete_account` erases all three.
- **The first version's tables are cleared once.** v2.25.0 (test site only) had `card_runs.defense` and a
  `card_showdowns` table; the migration recognises that shape by the `defense` column and drops it. It can
  be re-run on any shape and never drops a run of the new kind (a test holds both).

Service role only: `card_deck_read`, `card_deck_save`, `card_run_start`, `card_run_round`, `card_run_battle`,
`card_run_end`, `card_daily_deal`, `card_daily_round`, `card_daily_record`, `card_lineup_owned`,
`card_list_check`. Signed-in players, as GETs:
`card_battle_state()` and `card_boards(limit)`.

- **`card_run_battle` checks the step under a lock**, so a double tap or two tabs cannot both count: the
  second raises `stale` having changed nothing.
- `card_battle_state` returns the account's **latest** run, live or over, with `last` - what lets a browser
  whose answer was lost learn that it lost and be shown the battle.

### 11.3 The function

`card-claim` actions: `deck_save { cards }`, `run_start`, `run_round { run, step, round, card, cat }`, `run_end`,
`daily_deal`, `daily_round { round, card, cat }`. `cat` is the category you call: required on your call
(`bad_cat`, a 400, otherwise), ignored on theirs. It bundles `card-logic.mjs`, `rewards.mjs` and `data/cards.json`, so **a
change to any of those ships the function and the client together**.

### 11.4 Coins

A ladder win pays `cardWin` (3) plus `cardWinStep` (1) for each win the run already had, to 12;
`paidCardWinsPerDay` (15) wins pay per UTC day. Ledger kind `card_win`. The daily battle pays nothing.

### 11.5 The screens

`card-battle.jsx`, mounted by `cards.jsx` under Battle: Ladder, Daily, Deck, Boards.

- `CardRow` is a card as a row: its six category scores are always on show, because they are the game. A
  strong one is a lime FILL with its own ink, never lime text.
- `Arena` is the whole battle, and since v2.31.0 **one panel does everything, in place**:
  - the **rack** of six categories under the scoreboard - buttons while the call is yours, the one they
    called lit and named when it is theirs, a spent one struck through and saying who took it;
  - the **hand for the spot** as stat cards side by side (`StatCard`), **in the order dealt**, each listing
    its six scores down the card with the category in play lit, spent ones struck through, and a "+6" on a
    row where the card's ability fires. No projected total, and nothing sorted by rating;
  - **one Play button** naming the card, the category and the real stat; "Pick for me"; and the rest of the
    hand to look at, closed until asked for;
  - the **result in the same panel**: both cards, the real stat and ONE total a side, who takes the round and
    who calls next, "Why?" for the breakdown, and **Next round**. It stays until pressed. Nothing runs on a
    timer and nothing scrolls the page; motion is an entrance only.
  Below it, the field (section 14) and the log. `StatCard` is artwork in `CARD_PAINT`'s colours, held to AA
  by `CARD_TEXT_PAIRS`.
- **Why it changed.** The owner on v2.30.0: "you pick a card, it scrolls up to view the battle ... by the time
  you read them it disappears and goes back to the bottom", and "a player list with a big number on the right,
  you just want to hit the one with the higher number". The hand was at the bottom of the page and the round
  played at the top, on a timer.
- **Two taps are one.** `Arena` drops a second Play before the page has drawn `busy`; a result is passed by
  setting how many have been seen, so a second Next changes nothing.
- **One arena a battle - and in the gauntlet, one an ATTEMPT.** An arena remembers how many results have been
  passed. A lost try and the next try at the same stage are drawn in the same place, and keyed by the stage
  alone they were one arena, on its sixth round with no rounds: Try again crashed the screen (v2.29.0 to
  v2.30.0). The gauntlet's arenas are keyed by the hand the attempt was dealt, and an arena handed fewer rounds
  than it has seen starts again whatever its key. `tests/test-cards-screen.mjs` presses Try again.
- **"Pick for me" picks the card.** A category already pressed is the player's and is the one played.
- **A failed play is not "not played".** The screen never replays after a lost answer: it reads
  `card_battle_state`, which carries the rounds played, and shows what is there. A play the page sends from
  behind is refused as `stale` and the page catches up the same way.

### 11.6 Runbook

- **End somebody's stuck run:** `select card_run_end('<user uuid>');`
- **See a run:** `select id, wins, status, hand, foe, cats, rounds, last from card_runs where user_id = '<uuid>' order by id desc;`
- **Give a day's battle back:** `delete from card_dailies where date = '<date>' and user_id = '<uuid>';`
- **Re-field a live run's battle** (after a release that changes `SPOTS` or how a team is built). A ladder
  battle is stored with its team, so one dealt before the release keeps the old one - v2.31.0 left a run on
  the test site with two Flex spots. Find them: `select id, wins, jsonb_array_length(rounds) from card_runs
  where status = 'live';`. For one with NO round played, work the team out with the release's own code -
  `ladderFoe(seed, wins)`, as `[{ card, finish, spot }]` - and write it:
  `update card_runs set foe = '<json>'::jsonb where id = <id> and status = 'live' and wins = <wins> and
  jsonb_array_length(rounds) = 0;`. The hand stays - twelve cards fit any lineup of these positions. One with
  rounds already played is better ended (`select card_run_end('<user uuid>');`) than re-fielded mid-battle.

### 11.7 Not built, and known gaps

- No badge, nothing on the profile. The gauntlet is section 13.
- **Dropped, not owed:** the **draft arena**, once the fourth of the owner's four modes. The owner scrapped it
  on 2026-11-14, after the battle itself was rebuilt (section 4.1). The ladder, the daily battle and the
  gauntlet are the modes.
- A battle is now six requests rather than one. Each is small, and a lost one is recovered from the state.
- Two accounts are two collections; nothing stops one person climbing twice.

## 15. Loaded on demand (v2.30.0)

The card screens are not in `page.js`. `build.mjs` builds `cards.jsx` and everything only it reads into
`public/cards.js`, and the page fetches that the first time `LazyCardsScreen` or `LazySeasonCard`
(`cards-lazy.jsx`) is drawn. Three answers: loading, loaded, could not load - with a Try again that fetches again.

- **What is in it:** `cards.jsx`, `card-battle.jsx`, `card-face.jsx`, `card-logic.mjs`, `card-packs.mjs`,
  `card-sprites.mjs`, `card-data.mjs`, `data/card-skin.json`, and their stylesheet - which is no longer part
  of `APP_CSS`; the lazy components draw it beside the screen, after the app's own.
- **What it borrows:** React, `storage.js`, `game-logic.mjs`, `rewards.mjs` and `cosmetics.jsx`, at run time,
  from the table the page publishes (`cards-shared.mjs`, `globalThis.__ps_shared__`). One React, one Supabase
  client, one `BOARDS`. **A card file that imports anything else fails the build** until it is added to that
  table - otherwise it would be bundled in as a second copy with state of its own.
- **`perfect-season.jsx` must not import a card file statically**, or esbuild puts all of it back in the page.
  `tests/test-build-seo.mjs` holds that (no `cb-field` or `cd-card` in page.js) and holds cards.js to having
  no React of its own.
- **The address carries a fingerprint** (`/cards.js?v=<8 hex of its contents>`), so the page and the screens are
  always one build, and the service worker's build id - a hash of page.js - moves when either does. The worker
  fetches it network-first, like the bundle (`CARDS_BUNDLE` in sw-rules.mjs). It is not in the offline shell:
  every card screen needs the server anyway.
- **In the tests and the UI harness** esbuild inlines the import, so they exercise the real screens through the
  same lazy components. What they cannot exercise is the fetch itself: nothing-at-load, fetched-on-open and
  blocked-then-Try-again were checked in real Chrome against a real build (2026-11-14), not by a test.
- The Android app gets it for free: `tools/app/build-app.mjs` copies `public/`, and the address is root-relative.

## 14. The field (v2.29.1)

`Arena`'s lineup display. `.cb-field` carries the `dark` class, so its tokens are the navy scope's wherever
the screen is drawn; the floodlight and yard lines are white over `--surface2`, so it has no colour of its own.
`ol.cb-strip` is your six (`li.cb-s[data-slot]`): a `.cb-slot` outline until the round is played, then a real
`CardFace`, with the result in words under it - never colour alone. `ol.cb-them` is their six
(`li.cb-t`): `.cb-t-back` and a "?" until the round is played, unless the answer carried the card (the
gauntlet). It shows nothing the server did not send, so it is not a second place the hidden card could leak.
Order on the screen since v2.31.0: scoreboard, the rack of categories, the panel (the choice, or a round's
result), the battle's ending, then the field and the log. The field is the record; the panel comes first so
the thing you act on is never under the thing you look at. The spots are QB, RB, RB, WR, WR, TE.

## 13. The gauntlet (v2.29.0, on the test site)

Twelve real offenses, weakest first. `GAUNTLET` in card-logic.mjs is the list: `[team, era index]`.

- **A stage's team** is `gauntletFoe(stage)`: that franchise's best card (rating, then id) for each of the six
  spots in that era - a quarterback, two backs, two receivers, a tight end - six different men, Base. The spots
  are shuffled on the stage's own seed. It is the same team every time.
- **The list is written out, not computed, and may only be added to at the end.** Progress is a count of stages
  cleared, so a list worked out from the catalog would reorder itself the day a season is added and stage five
  would become another team. It was chosen by ranking all 160 team-eras by the average rating of their best
  six and taking twelve spread from bottom (65) to top (110), no franchise twice.
  **It was reordered once, in v2.31.0, and that is the last time:** with no Flex a team fields two backs and
  two receivers instead of its best two of anybody, and Baltimore 1999-2005 fell from 87.4 to 78.7, below the
  two stages before it. It moved from sixth to fourth so the stages still rise. Cards were on the test site
  only and the one account with progress was the owner's; nothing is paid twice, because progress is a count.
- **The head start** (`gauntletEdge`): the weakest real offense is far better than a starter deck, so the
  early stages' cards play points short - `GAUNTLET_HEAD_START` (-24 since v2.31.0; it was -32) at stage one,
  shrinking evenly to nothing at `GAUNTLET_EVEN` (stage nine). It rides playRound's `foeEdge` with the label
  "Head start" and shows on their card as a modifier. The chance ONE try clears a stage (2026-11-14; the
  careful player here can see their six, as the screen shows them):

  | Stage (head start) | Starter, Pick for me | Starter, careful | Sixty random, careful | Sixty best, careful |
  |---|---|---|---|---|
  | 1 NYJ 2016-2020 (-24) | 48% | 81% | 100% | 100% |
  | 2 JAX 2016-2020 (-21) | 27% | 67% | 100% | 100% |
  | 3 TEN 2011-2015 (-18) | 32% | 70% | 100% | 100% |
  | 4 BAL 1999-2005 (-15) | 8% | 20% | 100% | 100% |
  | 5 SEA 2011-2015 (-12) | 0% | 4% | 94% | 100% |
  | 6 HOU 2016-2020 (-9) | 1% | 1% | 94% | 100% |
  | 7 ATL 2006-2010 (-6) | 0% | 1% | 93% | 100% |
  | 8 NYG 1999-2005 (-3) | 0% | 0% | 63% | 100% |
  | 9 LV 2021-2025 (0) | 0% | 0% | 44% | 100% |
  | 10 GB 2016-2020 (0) | 0% | 0% | 57% | 100% |
  | 11 DEN 2011-2015 (0) | 0% | 0% | 12% | 100% |
  | 12 KC 1999-2005 (0) | 0% | 0% | 1% | 65% |

  Calling the category with their six in view made a stage much easier than it was: at -32 a starter deck
  cleared stage one 96% of tries when it read the screen. `tests/test-card-balance.mjs` prints this table and
  holds its two ends - a starter deck clears stage one at most nine tries in ten, and the sixty best clear the
  last at least one in four. If either breaks, move the head start, not the teams.
- **Their six are in view.** Everywhere else the card across from you is hidden until yours is down; here the
  team is named on the screen and the stage list, so hiding it would be theatre. The card you face each round
  is in the tray beside yours, stats and all - so here a call is made knowing both cards.
- **The database:** `card_gauntlets`, one row an account - `cleared`, and the attempt in progress (`stage`,
  `hand`, `cats`, `rounds`), plus `last` / `last_stage` for a browser whose final answer was lost. RLS on,
  no policy, no client grant. Service role only: `card_gauntlet_start` (raises `locked` past the next stage;
  an attempt already going is returned whatever stage was asked for), `card_gauntlet_round`,
  `card_gauntlet_finish`, `card_gauntlet_quit`. A round is written by its number, exactly as on the ladder.
- **Coins:** `gauntletCoins(stage)` = 20 + 10 a stage, 900 for all twelve, ever. Ledger kind `card_gauntlet`,
  ref the stage number - so a stage pays once whatever else happens. A cleared stage can be replayed for nothing.
- **Accepted:** giving up an attempt and starting again deals a new hand, so a hand can be fished for. Losing
  is free and retries are unlimited, so that buys nothing a patient player did not already have.
- **Runbook:** see somebody's progress - `select cleared, stage, last_stage from card_gauntlets where user_id = '<uuid>';`.
  Put a stage back - `update card_gauntlets set cleared = <n> where user_id = '<uuid>';` (the coins already paid stay paid).
- **Not built:** a badge for running the gauntlet. (The draft arena, once a fourth mode, was dropped on 2026-11-14.)

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

## 17. The how-to, sharing, badges and the profile (v2.34.0)

- **How cards work** is `CARDS_HOWTO` in cards.jsx: five lines, shown once a device (`ps-cards-howto`) in
  every phase but loading and error, and behind a "How cards work" link after that.
- **A battle's share card** is `battleShareText` in card-battle.jsx: a square a round and a count, and the
  site's address. It names no card on either side - yours are your collection, and theirs would spoil the
  day's team. `onShare` and `siteUrl` are handed down from the page, as Century's are; with no `onShare`
  there is no button.
- **`card_profile(user)`** (migration-cards.sql) is four counts for anybody who asks:
  `{ cards, best_run, gauntlet, dailies }`. It is not a block in `player_stats` because that function is
  `language sql` in migration-runs-log.sql and the card tables do not exist when it is created.
  `fetchPlayerProfile` makes it a second, optional read: a failure leaves `extra.cards` null, "not known".
- **The three card badges** read `extra.cards` on a profile, and **pay since v2.35.0** (100 / 300 / 1,000,
  their tiers). submit-run works badges out from `player_stats`, which has no cards, so **`card-claim` pays
  them** (`payCardBadges`): after a pack is opened and after a ladder battle or a gauntlet stage ends it
  reads `card_profile`, asks badges.mjs's `cardBadgesEarned` and calls `award_badges`. The answer's
  `badge` is null unless something was newly awarded, and it carries the badge's NAME, because a card file
  may not import badges.mjs; `BadgeLine` in card-face.jsx prints it. A failed award never fails the pack or
  the battle - the next one asks again. A hundredth card that arrives as the daily card (submit-run's grant)
  is paid on the next pack or battle, not at once.

## 16. Testers (v2.32.0)

The test site's database was deleted on 2026-11-25 and not replaced, so the real site is where cards are
played while they are unfinished - by the accounts in `card_testers` and nobody else.

- **Both switches have three settings**: `1` (everybody), `testers`, and anything else (off). The build's is
  `CARDS_ON`, read by `cards-switch.mjs` (`cardsMode()`, `cardsOn(tester)`); the server's is the
  `CARDS_ENABLED` secret, read per request by `card-claim` and `submit-run`. An unknown word is off.
- **`card_testers`** (migration-cards.sql): RLS on, an own-row select for a signed-in account, no write
  policy. The SQL editor is the only writer. `delete_account` takes a closed account off it.
- **The server decides what is granted.** `card-claim` reads the list with the service role before the
  profile and before any card function; somebody not on it gets `cards_off`, the same answer an environment
  with cards off gives. A list that cannot be read is `server`, never "on the list". `submit-run` asks inside
  the daily card's own try, so a failed read costs the card and never the season.
- **The browser decides only whether to draw the tile**: `fetchCardTester()` reads the account's own row once
  it is signed in. A failed read is "no" - no tile until a reload - because nothing rests on it.
- **What a non-tester can still reach**: `/data/cards.json` and `/cards.js` are public files on a testers
  build, and `card_battle_state()` / `card_boards()` answer anybody signed in (with nothing in them). None of
  that grants or stores anything.
- **Runbook**: add a tester -
  `insert into card_testers (user_id, note) select id, 'why' from profiles where lower(username) = 'NAME';`
  Remove one - delete the row; their cards stay, unseen. **Launched to everybody in v2.33.0 (2026-11-26)**; the list is read by nothing while the secret is `1`.
  To launch - the secret to `1`, then a
  build with `CARDS_ON=1`, after the gates in CLAUDE.md.
