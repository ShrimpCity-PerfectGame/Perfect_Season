# Card collecting and card battles - design

Date: 2026-11-13. Status: design agreed with the owner in conversation, not built.

Reference material sits beside this file in `2026-11-13-card-collection/`: the owner's two sprite
sheets, three mockup screenshots, the mockup page itself, and the throwaway script that cut and
recoloured the sprites. **The mockup and the script are spikes.** They show the look and prove the
technique; none of their code is to be kept as written.

This design replaces a handoff document ChatGPT wrote ("Gridspin Card Dynasty"). That document had
no access to the code. Where the two disagree, this one is right. The biggest differences: battles
are an auto-battler against a defense (not a statistical football simulation against a full CPU
team), the lineup is the draft's six slots, and packs and battles reuse the wallet, ledger and
Edge Function patterns the game already has instead of new ones.

Marked throughout: **(owner)** is something the owner said. **(call)** is a decision made while
writing this and not yet seen by the owner as a line item; the owner approved the summary it
belongs to. Anything not marked is a constraint from the existing code.

## 1. Why this exists

**(owner)** Someone comes in, plays the dailies, and maybe goes into the card part and collects.
Cards are a second reason to come back each day and a place for coins to go. The cards must have
something to do: you pick a lineup from your collection and it auto-battles a CPU defense, and
because cards have archetypes and synergies the answer is not always "play the six best cards".

## 2. Goals, non-goals, anti-goals

Goals
- A permanent collection of player-season cards that looks good enough to want.
- Two battle modes: a daily one scored for a board, and a repeatable one that is win or lose.
- Lineup choice that matters: a low-rated card can be the right pick against a given defense.
- **(owner)** Separate from the drafts. One door in, and a player who does not want it never sees it.
- **(owner)** Light touches elsewhere: a few badges, a best-card spot on the profile, a board stat or two.

Non-goals for the first version
- Trading, gifting, a marketplace, or trading duplicates in for anything.
- Player-versus-player card battles.
- Real-money purchase of cards or packs.
- Defensive cards the player owns. The defense is always the opponent.
- Anything in the Android shell beyond what the shared bundle gives it for free.

Anti-goals (it has failed if any of these is true, even if it works)
- A card, finish or battle result changes a draft, a season score, a duel, or any existing board.
- The best lineup is always the six highest ratings.
- A browser can decide what a pack contained, what a battle scored, or what it paid.
- The existing dailies get slower, gain a required step, or nag about cards.

## 3. What a card is

- **The catalog is the draft pool that already ships**: `data/players.json`, one row per player per
  team per five-year era, his best season in that era. 3,124 rows, 1,639 players. No new player
  data is needed. **(call)** A card's identity is that row (player, season, team).
- **(call) The catalog is frozen and append-only, with ids of its own.** The `id` in
  `data/players.json` is only a position in its name array, and that file will be rebuilt when the
  2026 season is added. Ownership is permanent, so it must not be keyed on that position. Generate
  a card catalog once with a stable id per card; a later rebuild may add cards but never changes,
  renumbers or removes one. If a rebuild moves a player's best season in an era, the old card
  stays as it was and the new season is a new card.
- A card shows: position, rating, team code, season, name, archetype, three stats for its
  position, and its finish. The catalog carries its own copy of each card's stats and rating,
  because a frozen card has to survive its row changing or leaving `data/players.json`.
- **Rating** is the card's strength. **(call)** Use the fantasy `rating` already on each row; the
  Championship scoring format does not apply to cards. **(call)** The printed rating is what plays
  in every slot, Flex included - the draft's separate `flexRating` is not used, so the number on
  the card face is always the number in the battle.
- **Archetype** is earned from the card's own real stats, computed by a pure function, never
  stored. See 3.1.
- **Finish** is rolled separately from the player **(owner, from the reference game)**: Base,
  Silver, Gold, Prism. Any player can come in any finish. **(owner)** A better finish has a small
  battle effect "just to flex". **(call)** +0 / +1 / +2 / +3 rating points in battle, shown on the
  card as "118 +2". A matchup is worth ten to twenty-five as tuned, so finish stays a tiebreaker.
- Owning: an account owns a count of each (card, finish). **(call)** Duplicates stack.

### 3.1 Archetypes

First-pass thresholds, measured against the real pool on 2026-11-12. Counts are cards that
qualify. They need tuning in the build; the shape is what is agreed.

| Pos | Archetype | Earned by | Cards |
|---|---|---|---|
| QB | Gunslinger | 25+ att/game and 7.7+ yards/attempt | 91 |
| QB | Scrambler | 22+ rush yards/game | 70 |
| QB | Game manager | 20+ att/game, INT rate at or under 2.1%, under 7.7 Y/A | 86 |
| QB | Volume passer | 36+ att/game | 64 |
| RB | Workhorse | 17+ carries/game and under 3 catches/game | 101 |
| RB | Receiving back | 3.2+ catches/game | 148 |
| RB | Goal-line back | 10+ rushing TD | 122 |
| RB | Home-run hitter | 100+ carries and 4.8+ yards/carry | 123 |
| WR | Deep threat | 30+ catches and 15.5+ yards/catch | 194 |
| WR | Possession | 5+ catches/game and under 13 yards/catch | 121 |
| WR, TE | Red-zone target | WR 9+ receiving TD, TE 7+ | 162 + 83 |
| TE | Seam stretcher | 25+ catches and 12.5+ yards/catch | 78 |
| TE | Safety valve | 3.5+ catches/game and under 11 yards/catch | 89 |

- About 60% of cards earn none at these thresholds and are a plain "Role player". That is
  acceptable; an archetype should feel earned. A card that qualifies for several shows one,
  **(call)** chosen by a fixed priority order the builder sets.
- Deep threat is the cheap archetype (91 of 194 are rated under 60). That is the property the
  whole mode leans on: a 58-rated Deep threat next to a Gunslinger should be a real pick.

### 3.2 Card art

**(owner)** The art is the owner's toy-style sprites: one house character with a big helmet and one
stock face, in a set of poses. No real faces, no team logos, no league marks, **no jersey number**
(tried, and the owner removed it). The owner's lawyer cleared showing skin tone; team colours are
already used throughout the game.

- One pose per archetype plus one for Role player. The two sheets supplied hold twenty poses.
- A sprite is recoloured in code: jersey to the team's first colour, helmet and pants to its
  second, skin to the card's skin tone. The spike proves this works on the supplied sheets,
  including erasing the painted numbers automatically.
- **No per-team image files.** One neutral set of poses must serve all 32 teams and every skin
  tone. How (canvas at runtime, CSS masks over separated layers, something else) is the builder's.
- The card frame, finishes and battle screen are in the mockup. Finishes animate with
  `background-position` only and stop under reduced motion, as cosmetics already do.

Owner tasks the build depends on, none done:
- **A final sprite sheet.** The two first supplied do not quite match each other, and helmet and
  pants are the same grey so they cannot be coloured apart. A final sheet should be one consistent
  set, ideally with helmet, pants, jersey and skin each in its own flat marker colour.
  **Received 2026-11-13: a full 50-pose set** (`sprite-sheet-full-50.jpg`), consistent in style and
  with blank jerseys - but as one 1024x683 JPEG, about 100x135 pixels a sprite, a third of the
  size a card needs. Wanted from the owner: the same poses at full size (ten to a sheet, as the
  first two were, PNG if the tool offers it), one player per cell.
- **Pack art.** Three example pack wrappers supplied 2026-11-13 (`pack-example-*.jpg`): a silver
  common, a blue-and-gold, and a purple-and-gold with a crown. They set the look for plan 3. Final
  pack art should carry no baked-in words (one says "Football Booster / Common Tier"); names and
  tiers are text the game draws, so they can change and be read aloud.
- ~~Confirm the licence of the tool that generated the sprites allows commercial use.~~ **Done:
  the owner confirmed it is cleared, 2026-11-13.**
- **Skin tone per player** does not exist in any data the game has. It is a manual record for up
  to 1,639 players. **(call)** A small palette of about five tones, keyed on the card catalog's
  stable player id. A card with none recorded uses one neutral default tone, so the feature can
  ship before the list is complete. **(owner)** Claude drafts the first pass during the build and
  the owner corrects it. The first pass must leave a player at the default whenever it is not
  sure, rather than guess: a wrong tone on a named real person is worse than a neutral one. The
  owner's review of the list is a launch gate for production.

## 4. Battles

**(owner)** Card-clash presentation, option B in the mockup: your six cards light up one at a time
against the defense, each one's bonus or penalty pops off it, and your total races the defense's
number.

- **Lineup (owner):** the draft's six slots - QB, RB, WR, TE, two Flex (RB/WR/TE). Only owned
  cards. **(call)** One card per player per lineup, so two seasons of the same man cannot both start.
- **The opponent is a real team defense** from `data/versus-pool.json` (859 team-seasons,
  1999-2025, already rated on the players' 0-130 scale). The player sees the defense and its
  traits before choosing a lineup.
- **Defense traits** come from the defense's own real numbers. Available today: Stingy (points
  allowed), Ball hawks (interceptions), Pass rush (sacks), Strip artists (fumbles), Scoring
  defense (defensive TDs). **(owner)** wanted a Run stopper that hurts pure runners, and it is
  built (2026-11-13): rushing yards allowed come from nflverse's weekly team file into a file of
  the cards' own, `data/card-defense.json`, so Duel's `versus-pool.json` is never touched. It hurts
  Workhorse, Goal-line and Home-run backs and slightly favours a Receiving back. Man/zone
  coverage is in no data and is out.
- **How a card scores.** Each card rolls a performance around its rating plus finish bonus
  **(owner: "a better graded card has a higher chance of more yards")**, shown as a football line
  ("142 yards, 2 TD"). Then modifiers land:
  - a defense trait counters certain archetypes (Run stopper against Workhorse, Ball hawks against
    Gunslinger) and some archetypes are good against certain traits;
  - pairings on your own side add (Gunslinger with a Deep threat) **(owner's own example)**.
  The six totals add up against a number derived from the defense's rating.
- **Luck (owner):** "a bit". **(call)** Enough that a close battle can go either way, not enough
  that the wrong lineup beats the right one often. In a run each battle's roll is fresh randomness
  made by the server at the moment it is played; only the daily showdown is seeded (4.1). The builder sets the spread and must print the
  measured numbers in a test, the way `tests/test-difficulty.mjs` and `tests/test-guess-logic.mjs` do.
- The full table of which trait hits which archetype, the pairing list, and every number are the
  builder's to draft and the owner's to react to on staging. The balance target is the anti-goal
  in section 2: measure how often the six highest ratings is the best available lineup and keep it
  well under always.

### 4.1 Daily showdown

- **(owner)** One defense a day, the same for everyone; the result is a score for a board.
- **(call)** One attempt per account per day. The day's randomness is shared: each card has one
  roll for the day, seeded from the day and the card and nothing else, so the same lineup scores
  the same for everyone, a better finish adds exactly its bonus, and the board rewards the lineup
  rather than the roll. (Seeding from the whole lineup was tried and made the finish and the Flex
  order a luck re-roll; review caught it.)
- It has its own board inside the card area. It never appears on the Leaderboard or Stats screens.
- Accepted gap, the same one every seeded daily here has: the bundle and the seed are public, so a
  determined player can compute the best lineup offline. Say so in the reference doc; do not try
  to close it.

### 4.2 Runs (the repeatable)

- **(owner)** Win or lose. Farmable "a bit". Defenses come in a random order, not weakest to
  strongest.
- **(call)** A run is a streak: random defenses one after another until a loss. Each win pays a
  few coins, a longer streak pays more per win, and a new run can start at any time.
- **(owner, 2026-11-13) The bar rises with every win in a run.** The first battle is one almost
  anybody wins; each win raises the bar for the next, so every run ends at a battle that is a
  real test for that collection. This replaced a bar fixed per defense, which the balance bot
  showed cannot work: a starter deck's best six add up to about 246, sixty random cards to about
  641 and the sixty best cards to 780, so one bar was either unreachable for a new player (0.4%
  wins) or a walkover for everyone else. The defense still shifts the bar a little by its rating,
  and matters mostly through its traits. As measured: a starter deck wins about 1.6 battles a
  run, sixty random cards about 8.7, the best collection about 11.5, and no run goes on forever.
- **(call)** Farming has a ceiling: a fixed number of paid wins per UTC day, in the spirit of
  `paidSeasonsPerDay`. Past it, runs still play and still count for the streak board.
- **(call)** The lineup is chosen fresh for each defense, after seeing it; that choice is the game.
- **(call)** Abandoning a run ends it at the streak it has. That is not a dodge worth closing: the
  run is over either way, and the next one starts from zero.
- The server holds the run. Which defense comes next must follow from state the server stored when
  the run began, so abandoning or reloading can never re-roll an opponent. A run left mid-way
  resumes; it does not restart.

## 5. Getting cards

- **Starter deck (owner):** given once, the first time an account opens the card area. **(call)**
  Eight Base cards from the lower-rated pool, guaranteed to fill a legal lineup.
- **Daily card (owner):** finishing the daily draft gives one card. **(call)** One per account per
  day whichever scoring format's daily was played, drawn at equal odds from the players on that
  day's boards, with a finish roll. Granted by `submit-run` when it records the Daily, since that
  is the only place a Daily is verified.
- **Packs (owner):** bought with the coins the game already has, one wallet. Modelled on the
  reference game the owner supplied: themed packs that list exactly who is inside and each
  player's odds, finish odds shown separately, and occasional limited packs with a stock count.
- **Limited packs (owner): the stock is shared by everyone.** One counter per limited pack; when
  it reaches zero the pack is gone for all players. Two buyers reaching for the last one must not
  both get it and must not both be charged: the stock check, the debit and the grant are one
  transaction. A sold-out pack stays visible, marked sold out.
- **(call)** How many cards a pack holds is a property of the pack (the mockup's 1 and 3 are
  examples). Standing packs can be bought without limit.
- **The odds a player reads are the odds the server rolls from** - one definition both use.
  **(call, revised when packs were planned)** That definition is a module, `card-packs.mjs`, which
  the browser and the Edge Function both import, not database rows: a pack's contents are up to
  3,124 weighted cards derived from the catalog, and a second copy of that in SQL is a second
  thing to drift. What stays in rows is what an owner changes without a release: a pack's price,
  whether it is on sale, and a limited pack's stock.
- **Prices (call):** set from what play really pays (`rewards.mjs`: about 40 plus wins for a
  Daily, 15 per mini game, a 250 welcome, existing balances up to 10,000), not from the ChatGPT
  document. Existing players can open packs on day one; pricing must mean a veteran's saved
  balance buys a good start, not the catalog. Prices, on-sale and stock are data rows that
  can change without a release, as `shop_items` prices can; contents and odds ship with the code.
- **Guests (call):** cannot collect, matching the shop. Coins they earn wait for them as now.

## 6. Where it lives

- **(owner)** One tile on Modes opens the card area; everything is behind it: Collection, Packs,
  Lineup, Daily showdown, Runs, the two boards. Leaving any of it returns to the card area.
- **(owner)** A setting hides it completely. **(call)** When hidden, the tile and the daily card
  reveal are gone but the daily card is still banked, so turning it back on loses nothing.
  **(call)** The setting is per device, a `ps-` storage key like the scoring-format preference, so
  it also works for someone who is signed out.
- **(call) The flag is a build-time switch**, on for staging and off for production until the
  owner says otherwise. While it is off on production nothing banks: `submit-run` grants no daily
  card, so there is no hidden backlog to explain on launch day. Migrations and functions may ship
  ahead of it as long as they are inert with the switch off.
- **(call) Art does not gate building.** Build and review on staging against the two supplied
  sheets. Production launch waits for the final sheet (3.2); the licence is cleared.
- The daily card reveal on a Daily's result screen is one small skippable moment. It must not
  delay or cover the result.
- **Profile (owner):** a best-card spot. **(call)** The owned card with the highest rating, finish
  as the tiebreak; no picker in the first version.
- **Badges (owner):** "maybe some". **(call)** Three to start: pull a Prism, win ten in a row in a
  run, finish first in a daily showdown. They are verified server-side, so they may pay coins.
- **Board stats (owner):** "a stat or two", in the card area: the daily showdown, and longest run.
- **Name:** the player-facing name is not chosen. "Card Dynasty" was ChatGPT's. **(call)**
  Internal names use `card` / `cd-`, the way Duel is `versus` internally.

## 7. Constraints from the existing game

These are how this codebase already does the same kinds of thing. Follow them unless there is a
reason written down.

- **Rules live in one pure module** imported by the browser, the Edge Function and the tests
  (`game-logic.mjs`, `versus-logic.mjs`, `century-logic.mjs`, `guess-logic.mjs`). Archetypes, lineup
  legality, battle scoring and pack-odds maths belong in one such module. It must not order
  anything with a random comparator; the browser and Deno have to consume the seeded stream call
  for call (`tests/test-sim-engine-independence.mjs` is why).
- **No client writes.** Ownership, pack openings, battle results and boards are tables with RLS on
  and no insert or update policy, written by a security-definer function or an Edge Function's
  service role, like `century_runs`, `wallets` and `inventory`.
- **Coins only move inside the database**, under `wallet_lock`, as a ledger row with a unique
  (user, kind, ref). A pack purchase debits, rolls and grants in one transaction; a failure leaves
  no debit and no cards. Amounts live in `rewards.mjs`.
- **Every refusal code a function returns must be mapped in the client module that receives it**,
  or it reads as "check your connection" forever. Existing tests hold the maps to the SQL source.
- **A failed read is not "you own nothing".** The collection screen needs three states: has cards,
  has none, could not ask.
- **Names on boards:** new board tables carry the username snapshot and the `guest` flag, take the
  `use_account_username` trigger, are rewritten by `mod_act`'s rename and `claim_username`, and
  render through `NameLink`.
- **Closing an account** anonymises rather than deletes (`delete_account`, PROFILES.md 11). Decide
  for each new table whether its rows are the person's (erase) or a board's (keep under the
  tombstone), and extend the function and `tests/test-delete-account.mjs`.
- **Migrations:** `tests/test-migrations.mjs` must name every migration and run the list from a
  bare schema. Anything a `language sql` function names must exist before that function is
  created; `player_stats` is the one that bites.
- **A new badge is three files** (`badges.mjs`, a re-run of `migration-wallet.sql` for
  `badge_rewards`, and a number in `player_stats`).
- **Screens in their own files**, own CSS prefix, stylesheet exported as a string, never importing
  `perfect-season.jsx` back. Colours for artwork are data, like `cosmetics.jsx`; text on a card
  takes a theme scope and is held to AA by a test.
- **Release order** is migration, then Edge Functions, then client, through staging. A new Edge
  Function goes in `deploy-function.mjs`'s list and `supabase/config.toml`.
- **`/privacy` and `/terms` are true statements about the code.** Both need a look in the same
  release: cards are a new thing the site stores per account, and the terms' line that coins have
  no cash value and are not transferable should say the same of cards.
- **Data provenance:** defenses and players are nflverse data under the credit already shown. No
  club imagery ships; a test asserts zero URLs in shipped data files.

## 8. Risks and open items

- **Paid loot boxes.** The owner plans to sell coin packs for real money later. Once coins can be
  bought, random packs bought with coins are paid loot boxes: app stores require published odds
  and some countries restrict them. Not a blocker now; a lawyer question before the two coexist.
- **The final sprite sheet** (section 3.2) is the owner's and gates the art for production. The
  sprite licence is cleared (owner, 2026-11-13).
- **Skin tone data** (section 3.2): Claude drafts, the owner corrects. Not started.
- **Run stopper** is built. 22 defenses from 1999-2002 are averaged over fifteen games because the
  source is missing one of theirs.
- **Balance is unproven.** Nothing here has been simulated. The first build task after the rules
  module should be a bot that plays thousands of battles and prints how often top-six-by-rating
  wins, how far a starter deck gets, and what a day of runs pays.
- **Size.** This is the largest feature since Duel. Suggested order, each part shippable to
  staging on its own: (1) the rules module and its balance test; (2) ownership, starter deck,
  collection screen, daily card; (3) packs; (4) runs, then the daily showdown; (5) badges, profile
  spot, boards, the hide setting. It should sit behind a flag until the owner has played it.

## 9. Left to the builder

Table and function names; whether battles are one Edge Function or two; SQL or Edge Function for
pack rolls; the recolouring technique; every number (thresholds, modifiers, luck spread, prices,
odds, caps, starter size); the archetype priority order; pose-to-archetype mapping; screen layout
beyond what the mockup shows; the reference doc's name (the pattern is `CARDS.md` beside
`CENTURY.md` and `GUESS.md`).
