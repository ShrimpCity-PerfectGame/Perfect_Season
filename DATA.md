# Where Gridspin's data comes from, and what each source asks for

Every number in the game describes football that was really played, and all of it is fetched from public
sources by the builders in `tools/data/`. This file records what those sources are, what their licences
require, and the two places the picture is not clean. **It is not legal advice**; it is the record, so the
next session does not have to work it out again and so an attribution requirement is not discovered too late
to satisfy.

Written 2026-10-01, when the repo recorded none of this.

## The sources

| What | Where from | Licence | Used for |
|---|---|---|---|
| `players.csv`, `draft_picks.csv`, `roster_<year>.csv`, `snap_counts_<year>.csv` | [nflverse/nflverse-data](https://github.com/nflverse/nflverse-data) | **CC BY 4.0** (`LICENSE.md`) | `data/guess-pool.json` — Guess the Player's pool |
| `stats_team_reg_<year>.csv`, `stats_player_week_<year>.csv` | nflverse-data | **CC BY 4.0** | `data/versus-pool.json` — duel defenses and kickers |
| nflverse-data season files | nflverse-data | **CC BY 4.0** | `data/season-2025.json` — Century's one-year pool |
| `games.csv` | [nflverse/nfldata](https://github.com/nflverse/nfldata) | **none stated** — see below | duel opponents: every game with both scores |
| Play-by-play 1999–2025, corrected against Pro Football Reference season totals | nflverse play-by-play; PFR | mixed — see below | `data/players.json`, the main player pool |

Checked on 2026-10-01 with the GitHub API: `repos/nflverse/nflverse-data/license` returns
`CC-BY-4.0` / `LICENSE.md`; `repos/nflverse/nfldata/license` returns **404**.

## What CC BY 4.0 actually asks for, and where we do it

Attribution, a link to the material, a link to the licence, and an indication that changes were made. We
changed a great deal — nothing nflverse publishes is a 0–130 rating, a five-year era board or a salary — so
saying so is not optional.

It lives in **one constant**, `DATA_CREDIT` in `site-pages.mjs`, rendered in two places from that one
definition so they cannot drift:

- the app's Modes footer (`.sitefoot`), as JSX;
- every standalone page — `/how-to-play`, `/leaderboard`, `/privacy`, `/terms` — as HTML in
  `sitePageBody`, which also means it is there with JavaScript off.

`tests/test-site-pages.mjs` holds both to the constant and checks the two links are real.

## The two that are not clean

**1. `nfldata` states no licence at all.** The repository has no `LICENSE` file, so strictly there is no
grant — the default is reserved rights, whatever the practical intent of publishing it. It is the nflverse
organisation's own repo and it is published for community use, but that is a norm, not a term. What we take
from it is small and factual: final scores of games, used to pick duel opponents.

*If this ever needs settling:* the scores are also derivable from the CC BY 4.0 team-stats files already
fetched in the same builder, so the dependency is removable rather than load-bearing. That is the cheap fix
if anyone ever asks, and it is worth knowing before they do.

**2. Pro Football Reference.** `data/players.json` was corrected against PFR season totals for 1999–2020
(~1,100 seasons, per CLAUDE.md) by `scripts/*.py`, which is **no longer in this checkout**. Sports Reference's
terms are their own and are not a Creative Commons licence. What was taken was corrections to factual season
totals rather than any of their presentation, and facts are not theirs to own — but it is a different
footing from the nflverse data and should be described accurately rather than folded in with it.

*If the pipeline is ever rebuilt,* prefer correcting against another CC-licensed source, or record exactly
what was used so this paragraph can be replaced with something definite.

## The thing we deliberately do not use

**No logos, no helmets, no club imagery of any kind.** `static/` contains only Gridspin's own mark. nflverse
player rows carry a headshot URL on the NFL's image CDN, and the builders deliberately do not keep it —
`data/players.json`, `versus-pool.json`, `season-2025.json` and `guess-pool.json` contain **zero** `http`
references, which `tests/test-site-pages.mjs` checks. Team names and the club colour palettes are used as
text and paint to say whose statistic a row is; `/terms` carries the non-affiliation statement.

That is the single highest-value thing on this page: it is what keeps the question about *facts* rather than
about *marks*. Do not add a logo without asking someone qualified first.

## The NFL question: reviewed and approved, 2026-10-01

**The owner's lawyer approved it, and the approval covers the paid features as well as the game as it
stands** — real team names, real player names, public statistics, the club colour palettes, no logos, the
non-affiliation statement on `/terms`, and money alongside all of it (the supporter unlock and the planned
coin packs). Recorded here on the owner's say-so so that nobody re-opens it: **this is settled, do not
re-raise it.**

What that does NOT do is make the rest of this file optional. The CC BY 4.0 attribution is a licence term,
not a risk assessment, and the two unclean spots above are unchanged.

### What still has to happen before the first payment

Nothing legal — but two live pages currently say in plain words that there is no money in the game, and
both become false the moment a sale goes through. They have to change **in the same release**, not after:

- **`/privacy`** (site-pages.mjs): "Coins are a game score - there is no real money anywhere in Gridspin
  and nothing to buy with real money", and "Nothing in Gridspin costs money".
- **`/terms`**: "Nothing in Gridspin costs real money today. If that ever changes, these terms will say so
  before it does, and anything with a price will show it before you buy." That sentence is a promise about
  sequencing, so the copy change has to land first or at the same time.

Bump `PRIVACY_UPDATED` and `TERMS_UPDATED` with them. SHOP.md has the rest of what wiring money needs (the
`supporters` webhook does not exist yet).

## About the club-colour cosmetics

**`frame-team` and `card-team` are free as of v2.19.5**, and that stays the right shape even though the
legal question is settled. They paint a card in *your own favourite team's* two colours — they name no
club, and with no favourite team set they fall back to the default item entirely. Charging coins for them
was never a sale for money, since coins cannot be bought; making them free means it never can be, and it
also stopped players wasting 2,000 coins on an item that does nothing until a team is picked.

An earlier version of this page overstated that, calling the two "goods bought with real money in club
colours". They were not, and now they cannot become it.
