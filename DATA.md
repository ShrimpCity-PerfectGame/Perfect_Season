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

## When to re-read this

Before taking money. A free game using public statistics with a disclaimer and no logos is a different
conversation from a paid one — and two shop items, `frame-team` and `card-team`, are built from the club
colour palettes. Today they cost coins, and coins cannot be bought; the day coin packs ship, that stops
being true and those two become goods bought with real money in club colours. See SHOP.md.
