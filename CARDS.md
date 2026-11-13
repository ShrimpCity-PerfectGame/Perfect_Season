# CARDS.md - card collecting and card battles

**Status: in progress. Only the catalog and the rules exist** (plan 1 of 5, built 2026-11-13). There is no
table, no Edge Function, no screen and no switch yet, and nothing a player can see. `data/cards.json` is not
shipped to the site.

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
- `pid` is the player. Eight pairs of players share a name (two Adrian Petersons, two Steve Smiths); `pid`
  tells them apart, a name cannot. A new row inherits the `pid` of an existing card that the current build of
  `players.json` puts under the same name index, otherwise it gets a new one.

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
| ballhawks | Ball hawks | most interceptions |
| passrush | Pass rush | most sacks |
| strip | Strip artists | most fumbles (the pool's `fum` column) |
| scoring | Scoring defense | most defensive touchdowns |

**A defense has a trait when it is in the best five of its own season** for that stat, ties broken by team code.
Within a season, not across the pool: scoring and sack rates moved so far between 1999 and 2025 that a raw cut
would give every Stingy to the early 2000s. So every season has exactly five of each. 447 defenses have no
trait, 231 have one, 181 have two or more.

**Run stopper is not built, and it can be.** The owner wants a trait that hurts pure runners. The season file
`stats_team_reg_YYYY.csv` has no yards allowed. The weekly file `stats_team_week_YYYY.csv` has `team`,
`opponent_team`, `rushing_yards` and `passing_yards`, so a defense's yards allowed is the sum of what each
opponent gained against it. Checked 2026-11-13: the columns are present in the 1999 and 2024 files and the 2010
file exists. Adding it means extending `tools/data/build-versus-pool.mjs` with that fourth source and two
columns - and Duel reads the same file, so its tests have to stay green.

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
| ...more than the six highest ratings manage | +0.38 wins | at least 0.3 |
| ...reading the defense picks a different six | 82% of battles | at least 40% |
| ...luck changes how long a run lasts | 29% of runs | 25% to 75% |
| ...by this many wins on average | 0.33 | 0.2 to 1.0 |
| ...a card rated under 70 is in the chosen lineup | 22% of battles | at least 15% |
| The 60 best cards: wins in an average run | 11.5 | 9 to 16 |
| Runs that reach 40 wins | none | none |

What it does not tell you: whether this is fun. The bands are the builder's reading of the design, not the
owner's numbers, and nobody has played a battle. A player is also not the search bot - a real person will find
fewer of the good lineups than it does.

**The numbers the next plans need:** a new player wins about 1.6 battles a run; a player with sixty cards
about 9. Coin rewards per win and the daily cap on paid wins should be set from those.

## 7. The daily showdown

`showdownDefense(date)` picks one defense for the day from the seed `showdown-<date>`.
`showdownScore(date, lineup)` scores the lineup with a generator seeded from the day **and the lineup**, so the
same six cards score the same for everyone and the board rewards the lineup rather than the roll. A lineup one
finish different rolls differently. The score is the offense; there is no step and no win or loss.

**Accepted gap, and it cannot be closed here:** the bundle and the seed are public, so anybody willing to run
`card-logic.mjs` can find the day's best lineup for their collection offline. It is the gap every seeded daily
in this game has.

## 8. Not built

Everything outside the rules: owning cards, the starter deck, the daily card, the collection screen, packs and
their odds, the server side of battles and runs, the battle screen, sprites and recolouring, skin tones,
badges, the profile's best card, boards, the hide setting, the build switch. The spec's section 8 lists the
order. The owner still owes one final sprite sheet and a licence check on the tool that made the sprites.

## 9. Tests

```bash
node tests/test-card-catalog.mjs   # the catalog: every pool row is a card, and a rebuild never rewrites one
node tests/test-card-logic.mjs     # archetypes, traits, lineup refusals, scoring, the showdown, a pinned checksum
node tests/test-card-balance.mjs   # plays ~4,500 battles and PRINTS the balance table above (about 35 seconds)
```
