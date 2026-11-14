# Card battles: call the category (design, 2026-11-14)

Target release: v2.31.0, test site only. Supersedes the "category hidden until you play" rule of v2.28.0
(CARDS.md 4 and 5) and the Flex spots. Scoring constants, decks, hands, packs, copies and the three modes stay.

## Why

The owner played v2.30.0 and said, in order:

1. "You pick a card, it scrolls up to view the battle, which there is a bunch of numbers and by the time you
   read them it disappears and goes back to the bottom."
2. "It just seems like you are picking random cards and things are happening, there is no choice or
   consequences."
3. "It also just feels like a player list with a big number on the right, you just want to hit the one with the
   higher number and not take into account the others. I think the list should be horizontal and maybe not in
   numerical order."
4. "Maybe have the stats read vertically and above them say what the grading category is prior to the pick so
   it just doesn't feel random."
5. "Just 2 RB and 2 WR, no flex spots ... the flex feels overwhelming because there is a choice of a ton of
   players."

The code agrees. The hand is at the bottom of the page and the round is drawn at the top, so a play moves the
page twice; up to twelve numbers are on screen for about three seconds. And when a card is picked, both things
needed to decide are hidden - the category and their card. Measured (scratch simulation, 480 even battles):
playing the highest-rated card every time wins 48% and choosing as well as the screen allows wins 54%.
The choice is worth almost nothing, and it feels that way.

History matters here: v2.27.0 showed everything and the owner said there was no choice (read off the bigger
number); v2.28.1 hid everything and it is a guess. A choice needs something you know and something you give up.

## Goals

- Every pick is made KNOWING the category the round is graded on.
- Picking costs something visible: a category is used once a battle, and a card is spent when played.
- Winning a round has a consequence beyond the point: the winner calls the next category.
- A round's result stays on screen until the player moves on, in the place they were already looking.
- The hand reads as cards side by side with their stats, not as a ranked list with one number.

## Non-goals

- The CPU does not get a hand; its six are still set before the battle.
- No change to decks, hand size, packs, copies, coins, boards, or the scoring constants (unless a balance
  band cannot be met - see Balance).
- No draft arena, badges or profile spot.

## Anti-goals (it has failed if...)

- ...a pick is made without knowing the category.
- ...the hand shows one "projected points" number per card, or is sorted by rating or by the category in play.
  That is the big-number list again.
- ...anything on the result disappears on a timer, or the page scrolls on its own during a battle.

## Approaches considered

1. **You call the category** (chosen by the owner). The caller names the category; each is used once; the
   winner of a round calls the next. Their card stays a surprise.
2. **Power plays.** Rounds as they are plus three one-use moves (double, scout, substitute). Rejected: the
   ordinary pick stays a guess.
3. **Show the category first.** The game announces a random category, you pick. Rejected as the whole answer:
   with a known category and nothing to give up, it is the bigger number again. (Approach 1 contains it: it is
   exactly what a round looks like when THEY call.)

Ways to pass the call were simulated with the new lineup (no Flex; sixty random cards against a CPU team at
the hand's own level, 480 battles a row):

| | Careless (random card, random category) | "Pick for me" | Careful |
|---|---|---|---|
| Today: category hidden | wins 12% | 45% | 48% |
| Winner calls | 7% | 55% | 68% |
| Loser calls | 7% | 49% | 62% |

Winner-calls is what the owner was shown and chose, and it is the one where a round has a consequence. The
run-away risk is small: 6-0 sweeps are 2% of even battles, you win 65% of the rounds you call and they win
57% of theirs. On the ladder (sixty random cards) the three players win 4.3 / 7.5 / 8.2 battles a run, a
starter deck 0.4 / 1.7 / 2.4, the sixty best 12.7 / 12.7 / 13.4 - inside every run-length band the game is
held to today, so no constant has to move. (With Flex kept, alternate calls measured 75% and winner 79%.)

## The rules

**Spots.** A lineup is QB, RB, RB, WR, WR, TE. No Flex. The six come up in a random order (all six shuffled;
the old "last is always a Flex" goes with the Flex). The hand is still twelve - 2 QB, 4 RB, 4 WR, 2 TE - so a
round offers two to four cards, never more. `spotFits` keeps answering for `FLEX` so a battle in flight when
this ships can finish.

**The call.** You call round one. After that, whoever won the last round calls; a dead heat leaves the call
where it was. Who calls follows from the rounds played and nothing else (`callerOf(rounds)`).

- **Your call:** you choose a category not yet used and a card for the spot. Their card is hidden until yours
  is down (unchanged; in the gauntlet their six are in view, as now).
- **Their call:** they name the category before you pick - their card's best of the ones left - and you choose
  who answers it. `foeCall(foe, rounds)`: the category in which their card scores most points (`roundBase`
  plus an ability that fires on the category), ties to the first in `CATEGORIES`. No draws.
- Each category is used once a battle, so the sixth round's is whichever is left.

**Scoring** is unchanged: `playRound(foe, rounds, entry, cat, rand, ...)` already takes the category. Four
draws a round. Category-triggered abilities (Air it out, Punch it in, ...) become something a player aims.

**What a round result carries, new:** `call` ("me" | "foe") and `next` - `{ by, cat }` for the round to come,
`cat` set only when they will call, `null` after the sixth. The ladder hides their cards, so the browser
cannot work out their call itself; `next` is how it learns it, including after a reload, because the rounds
are stored as written and `card_battle_state` returns them.

**The door.** `roundProblem(hand, foe, rounds, entry, cat)` gains one refusal, `bad_cat`: on your call the
category must be one not yet used. On their call the function uses `foeCall` and ignores what was sent.

## The server

- `card-claim`: the three round actions (ladder, daily, gauntlet) read `cat` from the request, pass it through
  `roundProblem`, and play the round on the category the rules give. No stored category order is read.
- **No migration.** The SQL stores a round as it is handed one and checks nothing inside it. `card_runs.cats`
  and `card_gauntlets.cats` are still required to be six-long arrays by the functions that write them, so the
  Edge Function keeps passing one (`CATEGORY_IDS`); nothing reads it. Dropping the columns is a later tidy-up.
- Daily: `dailyRound(date, rounds, entry, cat)`. One roll per card per day, as now. `dailyCategories` goes.
- `tests/mock-cards.mjs` mirrors all of it.
- `bad_cat` gets a sentence in `BATTLE_SENTENCES` and a place in `storage-cards.js`'s list.
- Ships as Edge Functions, then client. Card rules changed, so the 2,000-battle checksum moves and the two
  must ship together.

## The screen

One panel at the TOP of the battle does everything, in place. Nothing scrolls by itself.

    YOU 2            Round 3 of 6            1 CPU
    [Production - you] [Touchdowns - them] [Big play] [Workload] [Efficiency] [Star power]

    YOUR CALL - Running back.  Pick the category, then the card.

    +-------------+ +-------------+ +-------------+
    | (art)       | | (art)       | | (art)       |     <- your backs, side by side,
    | P. Holmes   | | J. Lewis    | | T. Barber   |        in the order dealt
    | 2002 KC     | | 2003 BAL    | | 2005 NYG    |
    | Goal-line   | | Workhorse   | | Home-run    |
    | Production 91 | Production 99 | Production 96 |
    | Touchdowns 99 +6 | Touchdowns 77 | Touchdowns 60 |
    | Big play 70 | | Big play 84 | | Big play 88 +6 |
    | Workload 88 | | Workload 99 | | Workload 80 |
    | Efficiency 85 | Efficiency 80 | Efficiency 79 |
    | Star power 95 | Star power 97 | Star power 90 |
    +-------------+ +-------------+ +-------------+
    [ Play Priest Holmes on Touchdowns - 24 TD in 14 games ]

- **The category rack** is six chips under the scoreboard. A used one says who took it. On your call the
  others are buttons; on theirs, the one they called is lit and labelled "They called".
- **The hand for this spot** is a horizontal row of stat cards in the order the hand was dealt - not by
  rating, not by the category. Each lists its six category scores vertically; the category in play is lit on
  every card, used ones are struck through, and a row carries a "+6" where the card's ability fires on that
  category. The overall rating is small. No projected total.
- **One Play button** under the row, naming the card and the category and giving the real stat
  ("24 TD in 14 games"). Disabled until both are chosen. "Pick for me" stays as a small link: the
  highest-rated card and, on your call, its best category left.
- **The result takes the same panel**: the category, the two cards side by side, under each the real stat and
  ONE number (the round total), then "Round to you. You call the next one." A **Why?** button opens the
  breakdown that is on screen today (category score, rating, bonuses, luck). **Next round** moves on; after the
  sixth it reads "See the result". It stays until pressed. The speed and skip controls go.
- Everything is in the page the moment the round is played; motion is an entrance only, and is off under
  reduced motion. Colour is never the only signal (won/lost/used are words).
- **The field** (their six, your six as big cards) sits below the panel as the record of the battle, as built
  in v2.29.1, with the new spots. The log stays below it.
- On the ladder the header says how strong their cards are ("their cards rate about 66"), from
  `ladderTarget` - you are answering a card you cannot see, so its level should be known.

## Balance

`tests/test-card-balance.mjs` gets players that call: careless (random card, random category), dull
("Pick for me"), careful (best card-and-category on the screen). The scratch numbers are in Approaches.
Bands to hold: the existing run-length bands; careful beats careless by at least 2 wins a run and beats
"Pick for me" by at least 0.3; at even strength 6-0 sweeps stay under 15% and each side wins its own call
between 35% and 80% of the time. If a run-length band breaks, move `CPU_START` / `CPU_STEP`, not the scoring.

## Settled after the builder check (the author's calls, not the owner's)

A fresh reader found nothing blocking and three places it would have guessed. Decided:

- **Which player each balance band binds.** As today: the starter deck is held on the dull player
  ("Pick for me"); sixty random and the sixty best on the careful one, which replaces "sharp". "Careful beats
  careless by 2 wins a run" is held on sixty random only (a starter deck's whole run is about two wins). The
  luck band (an even match replayed) and the upset band stay, on the careful player. "Fields a different six"
  is printed and no longer held - it measured a choice the new rules do not have.
- **The gauntlet's difficulty.** Calling the category with their six in view makes a stage easier than
  CARDS.md 13 says. Re-measure every stage with the dull and the careful player and print the new table
  there. Keep `GAUNTLET_HEAD_START` unless a starter deck clears stage one more than nine times in ten, or the
  sixty best clear the last stage less than one time in four; then move the head start, not the teams.
- **Seeing the rest of the hand.** Spending a category costs the cards you have NOT reached yet, and the
  panel shows only this spot's. So under the Play button a collapsed "Your whole hand" opens the cards still
  to play as the same stat cards, view only, grouped by position. Closed by default - the owner's complaint
  about Flex was too many cards to choose from, and this is for looking, not choosing.
- **A ladder battle in flight when this ships** whose next round is their call has no stored `next` and a
  hidden card, so the browser cannot name the category. It says "They call this one - you'll see the category
  when you play" for that one round and sends no category; the function plays `foeCall` regardless.

## Left to the builder

- Exact markup, class names and motion; whether the stat card reuses `CardFace` small or draws its own head.
- **The gauntlet, decided:** its twelve teams are re-fielded under the new spots (two backs and two
  receivers instead of the best two of anybody). Measured: eleven still rise in the written order; Baltimore
  1999-2005 drops from 87.4 to 78.7 (its Flexes were its strength) and would sit below the two stages before
  it. So Baltimore moves from sixth to fourth - NYJ, JAX, TEN, BAL, SEA, HOU, ATL, NYG, LV, GB, DEN, KC - which
  rises again. This breaks the list's append-only rule ONCE, on purpose, while cards are on the test site
  only and the one account with progress is the owner's; nothing is paid twice, because progress is a count.
  The rule stands from here on.
- A battle in flight on the test site when this ships: it finishes under the new call rule with its old
  spots. A daily battle begun that day meets a re-fielded team mid-way. Test site only; accepted.
- Docs: CARDS.md 4, 5, 6, 11, 14; CLAUDE.md's cards paragraph and Releasing line; CHANGELOG.
