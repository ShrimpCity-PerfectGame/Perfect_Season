# Perfect Season — exact scoring

Every player-season gets a **rating** where **100 = a solid starter of that era**. The six ratings
combine into a **team score**, which drives the season simulation. Nothing here uses raw fantasy
points directly; everything is relative to the era.

There are **two scoring formats**, chosen per draft. They differ only in Step 1; Steps 2–7 are
identical.

| | Fantasy (full PPR) | Championship (standard) |
|---|---|---|
| Points per reception | 1 | 0 |
| Internal name | `fantasy` | `standard` |
| Benchmarks | Step 3 | [Championship benchmarks](#championship-benchmarks) |

Championship exists because a reception is a weak proxy for winning football: under full PPR a
112-catch/987-yard season outranks a 72-catch/1,202-yard one, which is right for a fantasy league
and wrong for "would this roster go 20-0." Fantasy remains the default, and every score recorded
before Championship existed is a Fantasy score. The two never rank against each other — they have
separate leaderboards and separate `best_score`/`best_score_std` columns.

---

## Step 1 — Fantasy points (full PPR)

| Event | Points |
|---|---|
| Passing yard | 0.04 (1 per 25) |
| Passing TD | 4 |
| Interception thrown | −2 |
| Rushing/receiving yard | 0.1 (1 per 10) |
| Rushing/receiving TD | 6 |
| Reception | 1 |
| Fumble lost | −2 |

## Step 2 — Scale 17-game seasons down

```
adj = pprPoints × (16/17)   if season ≥ 2021
adj = pprPoints             otherwise
```

## Step 3 — Production score (the base)

Each position and era has a **benchmark**: the average points scored by that position's *Nth-best
finisher* in each season of the era. N is 3 for QB, 4 for RB, 5 for WR, 3 for TE — roughly the
best starter on a 12-team fantasy roster.

```
production = 100 × adj / benchmark[position][era]
```

**Benchmark table** (points equal to a rating of exactly 100):

| Era | QB | RB | WR | TE |
|---|---|---|---|---|
| 1999–2005 | 270 | 322 | 287 | 176 |
| 2006–2010 | 279 | 297 | 278 | 210 |
| 2011–2015 | 335 | 284 | 300 | 226 |
| 2016–2020 | 335 | 304 | 282 | 213 |
| 2021–2025 | 342 | 290 | 276 | 197 |

This is why a 1999 QB isn't punished against a 2020 one: each is measured against his own era.

> **Two caveats about this table.** The figures are rounded for readability — the values that
> actually reproduce the stored ratings carry decimals (e.g. WR 1999–2005 is 286.71, not 287). And
> the 2021–2025 row is expressed in **16-game** units: the implementation folds Step 2's 17/16
> factor into that era's benchmark instead of scaling the points (WR 2021–2025 is 293.67 in code,
> which is 276 × 17/16). Both forms give the same answer; only the arithmetic is arranged
> differently.

## Step 4 — Efficiency adjustment (QB and RB only)

WRs and TEs get no adjustment; their rating equals their production score.

**QB** — passer rating (standard NFL formula) and completion %, compared to the era average:

```
z  = ( 2 × (passerRating − eraMean) / eraSD  +  (comp% − eraMean) / eraSD ) / 3
rating = production + 5 × z × min(1, attempts / 300)
```

**RB** — yards per carry, compared to the era average:

```
z  = (yardsPerCarry − eraMean) / eraSD
rating = production + 4 × z × min(1, carries / 200)
```

The `min(1, …)` term means a low-volume player only gets part of the adjustment, so a backup with
80 efficient carries can't inflate his grade. Maximum swing is about ±10 points for a QB and ±8
for an RB.

**Era norms** (mean, standard deviation):

| Era | Passer rating (200+ att) | Completion % (200+ att) | Yards/carry (100+ car) |
|---|---|---|---|
| 1999–2005 | 80.2, 11.4 | 59.2, 4.4 | 4.07, 0.61 |
| 2006–2010 | 83.1, 12.3 | 60.8, 4.5 | 4.23, 0.64 |
| 2011–2015 | 87.3, 11.7 | 61.5, 4.2 | 4.20, 0.61 |
| 2016–2020 | 91.6, 11.8 | 64.1, 4.0 | 4.29, 0.63 |
| 2021–2025 | 91.3, 10.0 | 64.8, 3.6 | 4.35, 0.62 |

## Step 5 — Prime season

For each player on each team+era board, the game shows the **single season with the highest
rating** for that team within that window. Traded players are split per team, so a player can
appear on two boards with different seasons.

## Step 6 — Team score

```
teamScore = (1.25 × QB + RB + WR + TE + Flex1 + Flex2) / 6.25
```

Ratings are **capped at 130**, so one monster season can't carry five bad picks. The cap is applied
when the rating is computed, not at team-score time — nothing in `data/players.json` exceeds 130,
and 40 seasons sit exactly at it. (A Flex rating is the one exception: it's a pool z-score rescale
and is left uncapped in both formats.) The team score is what the leaderboard ranks and what the
season simulation uses.

## Step 7 — Letter grades (display only)

| Rating | Grade | | Rating | Grade |
|---|---|---|---|---|
| 120+ | A+ | | 72+ | B− |
| 105+ | A | | 64+ | C+ |
| 95+ | A− | | 56+ | C |
| 88+ | B+ | | 48+ | C− |
| 80+ | B | | 40+ | D, below that F |

---

## Worked examples

**Peyton Manning, 2013 Broncos** — 5,477 yards, 55 TD, 10 INT, 659 attempts, 68.3% completions,
115.1 passer rating.
```
PPR 410.0 → adj 410.0 (pre-2021)
production = 100 × 410.0 / 335 = 122.5
z = (2 × (115.1 − 87.3)/11.7 + (68.3 − 61.5)/4.2) / 3 = 2.12
rating = 122.5 + 5 × 2.12 × min(1, 659/300) = 133.1   → A+
```

**Adrian Peterson, 2012 Vikings** — 2,097 yards, 12 TD, 348 carries, 6.03 yards per carry.
```
production = 100 × 347.4 / 284 = 122.4
z = (6.03 − 4.20) / 0.61 = 3.00
rating = 122.4 + 4 × 3.00 × min(1, 348/200) = 134.4   → A+
```

**Torry Holt, 2003 Rams** — 117 catches, 1,696 yards, 12 TD.
```
production = 100 × 359.1 / 287 = 125.2
rating = 125.2 (no efficiency adjustment for WRs)   → A+
```

---

## How team score maps to results

Opponent strength sits on the same 0–130 scale, drawn from the real point differential of actual
NFL team-seasons. Win probability is `1 / (1 + e^-((you − them) / 8))`.

| Team score | Avg wins | Makes playoffs | Chance of 20–0 |
|---|---|---|---|
| 90 | 10.7 | 72% | ~0% |
| 100 | 13.6 | 98% | ~0% |
| 110 | 16.1 | 100% | 2% |
| 115 | 17.2 | 100% | 8% |
| 120 | 18.1 | 100% | 21% |

A drafter who knows football averages about 15 wins and goes perfect in roughly 2–4% of drafts.

---

## Championship scoring (standard)

Identical to everything above except **Step 1: a reception is worth 0 instead of 1.** Steps 2, 4,
5, 6 and 7 are unchanged — including the QB/RB efficiency adjustment, which keeps the same formula
and the same era norms. Championship changes what counts as production, not how efficiency is
credited on top of it.

Standard points are computed as **`pprPoints − receptions`**, which is exact: the two formats
differ by nothing else. This matters because the stored `ppr` also includes two-point conversions
and return touchdowns, which have no columns of their own — recomputing points from the visible
box score would come up short for about 650 of the 3,124 player-seasons, while subtracting
receptions never does.

<a name="championship-benchmarks"></a>
**Championship benchmark table** (standard points equal to a rating of exactly 100). Derived by
scaling each position/era's PPR benchmark by the standard-to-PPR points ratio of that cell's
benchmark-caliber players, so "100" means the same calibre of player in both formats and the two
sit on one comparable 0–130 scale. As above, the 2021–2025 row folds in the 17/16 factor.

| Era | QB | RB | WR | TE |
|---|---|---|---|---|
| 1999–2005 | 269.7 | 274.4 | 195.0 | 108.3 |
| 2006–2010 | 278.9 | 249.0 | 188.9 | 131.4 |
| 2011–2015 | 334.6 | 235.5 | 202.8 | 144.8 |
| 2016–2020 | 335.1 | 241.3 | 181.2 | 140.8 |
| 2021–2025 | 363.4 | 257.4 | 193.1 | 121.4 |

Because each position and era is re-anchored to its own 100, the overall distribution barely
moves (mean 55.6 → 54.7, standard deviation 27.4 → 28.3), so difficulty is comparable. What
changes is the order *within* a position. QBs are essentially unaffected — they don't catch passes.

**Worked example — the case this format was built for.** Jarvis Landry 2017 Miami (112 catches,
987 yards, 9 TD) vs DeVante Parker 2019 Miami (72 catches, 1,202 yards, 9 TD):

```
Fantasy:      Landry 260.0 pts → 92.4      Parker 246.2 pts → 87.5     (Landry ahead)
Championship: Landry 148.0 pts → 81.7      Parker 174.2 pts → 96.2     (Parker ahead)
```

**Known limitation.** `data/players.json` stores one season per player per team per era — already
reduced to that player's best *full-PPR* season (Step 5). Championship can re-rate that season but
can't re-pick it, so a player whose efficient year lost out to his high-volume year for the same
team in the same five-year window shows the volume year in both formats. Fixing it needs the full
player-season universe, i.e. the `scripts/*.py` pipeline, which isn't in this checkout.

## Where to change it

- Benchmarks, era norms, and prime-season selection for **Fantasy**: `scripts/rate2.py` and
  `scripts/boards.py`, then regenerate `data.json` with `scripts/export.py`. (These scripts are not
  in this checkout — see CLAUDE.md.)
- **Championship** benchmarks (`STD_BENCH`), the era-norm tables, `passerRating`, `efficiencyAdj`,
  `standardRating`, the 130 cap (`RATING_CAP`), and `playerSalary`: `game-logic.mjs`. Championship
  ratings are computed at load time from the stored `ppr`/`rec`, so changing them needs no data
  regeneration.
- `QB_WEIGHT` (1.25) and grade cutoffs: `game-logic.mjs` and the top of `perfect-season.jsx`.
- `SPREAD` and opponent strength: the season-simulation section of `game-logic.mjs`.

Rerun the difficulty bot after any change here — grading and difficulty are tied together. It takes
a format: `node tests/test-difficulty.mjs 250 standard`.
