# VERSUS.md — the 1v1 contract

The build contract for **Gridspin 1v1**: two players draft against each other from the same boards, then their
rosters play one game and one of them wins. Written before the build, like `PROFILES.md` and `SHOP.md`, and kept
afterwards as the reference for anything that touches a match. CLAUDE.md's rules still apply — row-level security
with no client write policies, the database or an Edge Function decides anything that matters, one owner per file,
prefixed class names, and nothing reaches production without going through staging as a version.

## 1. What it is

- A player creates a **lobby** and gets a link: `gridspin.app/vs/ABC123`. Anyone who opens it and is signed in
  joins as the opponent. The link is the whole matchmaking system — there is no queue, because there aren't
  enough players for one to be anything but a wait.
- Both screens then watch the **same eight boards**, dealt from one seed, in order.
- Picks alternate, snaking by board: on board 1 the host picks first and the opponent picks second **from the
  same board, minus what was just taken**; on board 2 the opponent picks first; and so on. Eight boards,
  sixteen picks, eight to a side.
- A roster is the six single player already uses — **QB, RB, WR, TE, Flex, Flex** — plus a **defense** and a
  **kicker** (section 6).
- **Every board offers all eight**: that team's players in that era, that team's defense in each year of the era,
  and its kicker in each year. Any board can fill any open slot, so a defense can go fifth and a kicker first -
  the order is the player's to choose. A board that cannot serve *both* players is skipped before it is dealt
  (section 8), so no draft order can strand either of them.
- Each player carries the same **powerups** (section 7): two re-spins, a **steal**, a **double dip** and a
  **steal the pick**. A leader's re-spin deals a board to *both* of them; a follower's is a board of their own.
  A steal takes the pick the other player just made and sends them back to the board for another. A double dip
  takes two off one board and gives up the next, which the other player then has to themselves.
- Each pick has a **clock**. When it runs out the pick is made for you: the most valuable available option that
  fits an open slot. A dropped connection loses you a pick, not the match.
- When both rosters are full the server grades them, and **the higher score wins — always**. There is no
  probability anywhere in a match: sixteen picks are the whole argument, and the better roster takes it every
  time. The final is still shown as a **football score**, but the scoreboard only dresses the margin; it can
  never contradict it. An exact tie is a tie, which football allows.
- A win goes on a **PvP record of its own** — `pvp_wins` / `pvp_losses` on the profile, and a leaderboard beside
  the others. Nothing about it touches career wins, championships, the points ladders or best-score boards: a
  head-to-head result and a 20–0 season are different things and are not mixed.

**Not in v1:** a spectator view, rematch-in-place, tournaments, chat.

## 2. Why the architecture changes

Every other mode is drafted in the browser and checked afterwards: `submit-run` re-derives the seed, replays the
trace with `game-logic.mjs`'s `replayDraft`, and recomputes the score. That works because one player's draft is a
closed thing that can be replayed from its seed.

A 1v1 draft cannot be, because **the second picker's legal choices depend on the first picker's pick**. Two
browsers cannot each hold the truth. So a match is the first thing in Gridspin with **live server-held state**:

- the picks live in the database, written only through an Edge Function with the service role;
- each client watches the match over **Supabase Realtime** (already used for the online-players pill) and renders
  what it is told;
- nothing a client says about whose turn it is, what is still available, or who won is trusted.

## 3. Database (`supabase/migration-versus.sql`)

**`matches`**

| column | type | rule |
|---|---|---|
| `id` | uuid primary key | |
| `code` | text unique not null | six characters, the shareable link's `/vs/<code>`, **and** the seed the eight boards are dealt from — one string is the whole match's identity |
| `host_id` | uuid not null → `auth.users(id)` on delete cascade | |
| `guest_id` | uuid null → `auth.users(id)` on delete cascade | null until someone joins |
| `format` | text not null default `'fantasy'` | `fantasy` \| `standard`, the host's choice at creation |
| `status` | text not null | `open` \| `drafting` \| `done` \| `abandoned` |
| `turn_deadline` | timestamptz null | when the player on the clock loses the pick |
| `respins` | jsonb not null default `[]` | every re-spin spent, `{ pickNo, kind, by, key }` (section 7) — enough for a reconnecting client to rebuild the same boards |
| `dips` | jsonb not null default `[]` | every double dip spent, `{ boardIdx, by }` (section 7) — which board was drafted three times, and which one after it only once |
| `result` | jsonb null | both sides' scores and the three parts each was built from (section 6), written once, by the server |
| `winner_id` | uuid null | set with `result`; null for a draw |
| `created_at` / `ended_at` | timestamptz | |

RLS on. **Select** is allowed to anyone (a match is public once it exists — its result appears on a board), and
there is **no client insert, update or delete policy at all**.

**`match_picks`** `(match_id, pick_no)` primary key, plus:

| column | rule |
|---|---|
| `pick_no` | 1–16. The number alone says whose turn it was (section 1's snake order). |
| `user_id` | who made it |
| `board_idx` | 0–7 |
| `kind` | `player` \| `dst` \| `k` — which pool the pick came from, so the three can't be confused for each other |
| `player_id` | the player's id in `data/players.json`; **null** for a defense or a kicker |
| `team` | the defense's or kicker's team code; **null** for a player |
| `season` | the season drafted, for all three kinds |
| `slot` | `QB` \| `RB` \| `WR` \| `TE` \| `FLEX1` \| `FLEX2` \| `DST` \| `K` |
| `auto` | the clock made this one, not the player |
| `stolen_by` | who stole this pick (section 7); `user_id` and `slot` are then theirs. Normally null |

RLS on, public select, no client write policy. Two unique constraints carry the rule that makes a 1v1 draft a 1v1
draft — **what one player takes is gone for the other**: `(match_id, kind, player_id, season)` for players and
`(match_id, kind, team, season)` for defenses and kickers. Each ignores the other's rows, because a null never
conflicts in a unique index, and `kind` is in the second one so a team's defense and its kicker from the same
year aren't mistaken for each other.

**Functions** (security definer, `search_path = public, pg_temp`, execute granted to `authenticated` only):

| function | returns | does |
|---|---|---|
| `create_match(p_format text)` | jsonb: the match row | One open match per host at a time (a second call returns the existing one). Generates the code. Guests (`profiles.guest`) may not create one — see 5. |
| `join_match(p_code text)` | jsonb: the match row, or a code | `not_found`, `already_full`, `own_match`, `not_signed_in`, `guest_not_allowed`. Sets `guest_id`, `status = 'drafting'` and the first `turn_deadline`. |
| `match_state(p_code text)` | jsonb | The match plus its picks, for a client that has just opened the page or reconnected. Read-only (`stable`), called as GET. |

Everything that decides a pick lives in the Edge Function below, not here, because it needs the game's own rules.

## 4. The Edge Function (`supabase/functions/match-pick`)

Deno, service-role, and **it decides nothing**. It says who is asking, hands the match's rows to
`versus-logic.mjs`'s `decideMove`, and writes down whatever comes back. Every rule lives in that module, the
same one the browser draws the board with, for the reason `game-logic.mjs` exists: a rule enforced on one side
and not the other is a rule that will drift, and this one would drift into "the pick I made didn't happen". It
also means the rules are tested without a Deno runtime or a mock that mirrors them — `tests/test-versus-rules.mjs`
drives the real thing.

`decideMove` reads nothing but the rows. Whose turn it is, what is on the board, what is gone and what a roster
is worth are all derived by `replayMatch`, so a client that reconnects, a client that lies and the server all
compute from the same place. It returns either `{ ok: false, reason, status }` or an action to write.

`POST { code, boardIdx, kind, playerId | team, season, slot }` is a pick. It refuses, in this order:

1. the match isn't `drafting`, or the caller is neither player → `not_your_match`;
2. it isn't the caller's turn → `not_your_turn`;
3. `boardIdx` isn't the current board → `wrong_board`;
4. the option isn't on that board → `not_on_board`;
5. it is already taken in this match, by either side → `already_taken`;
6. the slot is filled, or the option doesn't fit it (`DST` and `K` take only their own kind, and neither fits a
   Flex) → `bad_slot`.

`POST { code, claim: "clock" }` is how a client says the clock has run out, and is the one move **either**
player may make — that is how a match survives an opponent who has closed the tab. The deadline on the row
decides, never the client (`too_early`), and the pick the clock owes is the available option worth the most to
that roster by section 6's own arithmetic, over every open slot, marked `auto`. Worth the most, not
highest-rated: a 112 defense and a 112 quarterback are not the same number of points.

`POST { code, respin }`, `{ code, steal: true, slot }`, `{ code, dip: true }` and `{ code, stealPick: true }`
are the powerups, with the rules and refusals in section 7. All of them restart the clock — spending one is a
turn's worth of thinking too.

On the last pick the function **computes the result** (section 6) and writes `matches.result`, `winner_id`,
`status = 'done'` and, through `record_versus`, `pvp_wins` / `pvp_losses` on both profiles — together or not at
all, because a win that didn't record the loss would be a board nobody could explain. Which pick is the last one
is asked of `replayMatch`, never counted to sixteen here: a double dip and a steal both move where the end is.
The clients are told by Realtime; they render, they don't decide.

**Deploying:** `node deploy-function.mjs <env>` now deploys both functions, because `submit-run` and
`match-pick` share `game-logic.mjs` and `data/players.json` — deploying one of a pair is exactly the drift the
release notes warn about. Pass a name to deploy just one.

## 5. Who may play

Both players must be signed in. **Guests may not** (`profiles.guest`): a guest account can be made again and
again from one browser, so a guest 1v1 would be two tabs farming a leaderboard. This is the same reasoning that
keeps guests off the daily, and it is the only sound line until there is a cost to making an account.

**Known gap, to be written into CLAUDE.md:** two *real* accounts in two tabs can still farm PvP wins. It costs an
email address each, the boards are seeded so nothing about the result is free, and nothing but the PvP board is
affected — but it is a gap, and the answer if it is ever abused is a rate limit on `create_match` plus ignoring
matches between accounts that only ever play each other.

## 6. Defenses, kickers, and how a match is decided

1v1 drafts a **real defense and a real kicker**, not a stand-in. An earlier draft of this document proposed the
cheap version — draft one of the `OPPS` team-seasons as your defense and let its point differential be the
rating — and it was the wrong answer: a team-season's point differential is mostly a statement about its
*offense*. The 2007 Patriots are not a great defense.

**The data.** `tools/data/build-versus-pool.mjs` writes `data/versus-pool.json` from public nflverse data, the
same project the player seasons came from: `nfldata/games.csv` for points allowed, `stats_team_reg_YYYY` for the
defensive totals, and `stats_player_week_YYYY` for the kickers. One defense and one kicker for **every one of the
861 team-seasons from 1999 to 2025** — the same span as the players, so no board can come up empty. Re-run it when
a season ends, the way the player data is rebuilt. Two traps it already walks around, both documented in the
script: the CSVs quote fields containing commas, and the season-level player file credits a traded kicker's whole
year to the team he ended it on (Riley Patterson's 2023 was fourteen games in Detroit and three in Cleveland), so
kickers are counted week by week instead.

**The ratings** are on the players' own 0–130 scale, and are measured **against their own season**, not against
history — a z-score across that year's 32 teams, mapped onto the scale (65 is average, 18 points to a standard
deviation). That is the whole reason the number can sit beside a quarterback's: a defense drafted off a 2005 board
is being compared to 2005, exactly as the quarterback beside it is. A defense is points allowed per game (half the
weight — it is the job, and the one number that cannot be padded), takeaways, sacks, and the points it scored
itself. A kicker is accuracy, distance and volume, with accuracy shrunk toward the league's rate so a fill-in who
went 3-for-3 in December isn't the best kicker of the year. The 2006 Ravens come out at 112.2, the 2005 Lions at
64.0, Vanderjagt's perfect 2003 at 100.2.

**On the board.** A board is a team and an era, as everywhere else. Its defenses and kickers are **that team's, in
each year of the era** — a 2006–2010 board offers five of each, a 1999–2005 board seven (`WINDOWS` in
game-logic.mjs). Every one of the 160 boards already carries a QB, RB, WR and TE, so with a defense and a kicker
on every board too, **any board can fill any open slot**: that is what lets a player take a defense fifth or a
kicker first without the draft ever reaching a slot it can't fill.

**The result**, in `versus-logic.mjs`, shared by the browser and the Edge Function:

```
offense = the weighted mean of your six players (QB ×1.25), exactly as single player computes it
yours   = offense + (your kicker − 65) × SLOT_WORTH − (their defense − 65) × SLOT_WORTH
higher score wins, every time; an exact tie is a tie
```

`SLOT_WORTH = 0.16`, which is `1 / 6.25` — **precisely what one ordinary roster slot is worth** in the weighted
mean above, because that is exactly what a defense or a kicker is: one of your eight picks. Nothing is tuned by
feel. It puts the best defense in the data at about 7.5 points off the opponent and the worst at about 5.6 back,
against a measured median margin of 4.8 points between two rosters drafted off the same boards (p90 13.8) — so
both picks can decide a close match, which they should, while the six players still decide most of them.

A defense is subtracted from **the other roster**, which is what a defense does. In a head-to-head the difference
is the same either way, but the numbers a player reads afterwards should say what happened: *their defense took
6.1 off you*.

**The scoreboard.** A match still ends on a football score — 27–17, not 104.3–99.8 — because that is what winning
a game looks like. But it is drawn from the result, never the other way round: the winner is whoever scored
higher, full stop, and the margin is a **monotone** map from the points gap onto the game's own `MARGINS` table,
so a bigger gap is always a bigger scoreline. The losing side's points are the only part left to chance, seeded
from the match code so both screens and a reload all read the same final, and they cannot move the margin or the
winner. **The upset rate in 1v1 is zero by construction** — `winProb` and `gameResult` are not called at all, and
their randomness is exactly what 1v1 must not have: in single player a 17-game season is a story and an upset is
the best part of it, but a head-to-head is one game between two people who each made eight decisions, and losing
it to a dice roll would make those decisions pointless. An exact tie is shown as a tied score, which football has.

**Single player is untouched.** Nothing outside 1v1 reads `data/versus-pool.json`, `POS` stays
`["QB", "RB", "WR", "TE"]`, `SLOTS` stays six, and no existing score, board or leaderboard moves. A
defense/kicker position in the main game would be a different project with its own contract.

## 7. Powerups

### Re-spins

Single player gives a draft **two** re-spins (`REROLL_BUDGET`, one of each kind): *team* keeps the era and deals
another team, *era* keeps the team and deals another era. `rerollCandidate` in `game-logic.mjs` picks the
replacement, and the important part for 1v1 is that it is **already deterministic** — the board it returns comes
from `mulberry32(hashStr(seed + "-reroll-" + kind + "-" + seqIdx))`, so two screens given the same match compute
the same replacement, and the server can check a re-spin without trusting either of them. Nothing in
`game-logic.mjs` has to change for 1v1 to use it; 1v1 passes its own arguments and keeps its own budget.

**Both players get both re-spins, spent on their own turn, before their own pick.** What the re-spin does depends
on which of them spends it, and the difference is the whole character of it:

| who | when | what they get |
|---|---|---|
| the **leader** | before anyone has picked off the board | a board for **both of them** — the follower drafts it too |
| the **follower** | after the leader has already taken something | a board of **their own**, which they pick from alone |

So a leader's re-spin is a decision with a cost: spinning away from a board that is wrong for your open slots
deals one that might be right for the other player's, and you have handed it to them. A follower's is private,
which is a fair trade for picking second — they walk away from a board that has just been picked over rather
than take its leftovers. Neither can see the other's pick before spending it, because a re-spin always comes
before its own pick.

The rules, all enforced by the Edge Function (`POST { code, respin: "team" | "era" }`):

1. it is your turn, and your pick hasn't landed → otherwise `not_your_turn`;
2. you have that kind left → `no_respins_left`;
3. `rerollCandidate` returns a board → otherwise the spin is refused, exactly as a no-op re-spin is in single
   player, and **costs nothing**;
4. if you are the leader, that board must also serve both (section 8) — `rerollCandidate` can only ask about one
   roster, so this is checked separately, and a candidate that fails is refused and costs nothing too.

`shown` must be **the whole match sequence**, not just the boards already reached — all eight plus anything
already spun in. That is CLAUDE.md's reroll-pool invariant, and it exists because a replacement drawn from a
board still waiting later in the sequence would simply turn up again, with nothing to remove the original. The
candidate is salted by the **pick number** rather than the board, so two re-spins on one board can never land on
the same replacement.

Re-spins live in `matches.respins` (jsonb, default `[]`): `{ pickNo, kind, by, key }` per entry, appended by the
function and returned by `match_state`. Keyed by the pick rather than the board because that is exactly what a
re-spin changes the board for — an odd `pickNo` is a leader's and moves both, an even one is a follower's and
moves only theirs. `replayMatch` rebuilds every board from them, so each of the eight is really a pair:
`{ key, followKey }`, the same board twice unless the follower walked away. `MATCH_RESPINS = { team: 1, era: 1 }`
lives in `versus-logic.mjs` — 1v1's own number, so single player's `REROLL_BUDGET` is never touched.

### Steal

Take the pick the other player has just made. Spent by the **follower**, in place of their own pick: the leader
takes someone off the board, you take him instead of drafting, and the leader goes straight back to the same
board and picks again. One per match, each.

That shape is chosen over the alternatives because it keeps the draft's arithmetic exactly as it was — the board
still yields one pick each, sixteen picks over eight boards — and because the victim chooses their own
replacement rather than being handed one. It also means a steal is only available on the four boards where you
pick second, and only for the pick just made: there is nothing to steal before the leader has picked, and a
roster raided three boards later would be a different game.

Two things refuse a steal, both costing nothing:

1. the player fits nothing you still have open — you have to have somewhere to put him;
2. **it would strand the leader.** A steal empties their slot and sends them back to the board, and the board
   may have nothing left they can use. Section 8's rule does not cover this: it guarantees the *follower* an
   option after the leader picks, not the leader an option after being robbed. A one-quarterback board dealt to
   a leader who needs only a quarterback is exactly that case, so `stealableSlots` checks it directly.

In the database a steal **updates the pick's row** rather than writing a second one: `user_id` and `slot` become
the thief's and `stolen_by` records who did it. That is what keeps the two unique constraints in section 3
honest — the option is still drafted exactly once, by exactly one player. `replayMatch` reads `stolen_by` and
knows the board's second pick belongs to the leader, re-picking, rather than to the follower.

### Double dip

Take **two** off one board, and give up your pick on the next one. One per match, each.

The arithmetic is what makes it work and is worth stating plainly: two picks on this board and none on the next
is still two picks across two boards, so both rosters still come out at exactly eight. Nothing else in the mode
has to bend for it. (The forfeit is your own next pick, not theirs — a dip that cost the *other* player a pick
would leave them with seven players and an empty slot, and every other rule here depends on both rosters filling.)

It is a real trade rather than a free extra. You take two off a board you like; the other player gets the next
board **to themselves**, uncontested, picking whatever they want off it with nobody to take it first. And the
board you doubled on is two options poorer when they pick from it.

Declared on your turn, after seeing the board — that is the whole point of it — and refused, costing nothing,
when:

1. it is the **last board**: there is no next pick to forfeit, so there is nothing to pay with;
2. you have **one slot open**: two picks need two slots to go into;
3. the board can't **fill two** of your slots. Two quarterbacks are two options and one slot, so this is a check
   on slots, not on how much is left;
4. it would **strand the other player** — only when someone still picks after you. `boardServes(..., 2)`, the
   same rule as section 8 with the first player taking two instead of one. A dip by the player picking second is
   free of that check: nobody is left to be stranded.

### Steal the pick

Spent by the player who would pick *second* on a board, before the board's first pick lands: the order on that
board is swapped and you pick first. Nothing else changes — the board is still dealt to both, still has to serve
both, and the snake resumes as normal on the next one. One per match, each. It is the simplest of the three
powerups, because it moves nothing but who goes first.

Not built yet: it needs a draft screen to be spent from, and unlike Steal it changes no state that isn't already
derivable, so it waits for the screens.

## 8. A board has to serve both players

Single player asks one question of a board: can it fill any slot I still have open? `boardAt` walks the sequence
until it finds one that can, and skips the rest. 1v1 has to ask a harder one, because **a board is drafted
twice**: the first picker takes an option and the second picker has to still have one.

This is not a corner case. Of the 160 boards, **33 carry only one quarterback or only one tight end** — the
Colts' 1999–2005 board has exactly one quarterback, and everyone knows which. If both players come to that board
still needing a QB, the first takes Manning and the second has nothing to do.

So a board is dealt only when it can serve both, and the server checks that before it deals it:

```
the player picking first has at least one option that fits a slot they still have open, AND
  the player picking second has two or more,
  or has exactly one and it is not an option the first picker could take
```

Two is enough because the first picker removes exactly one. The second clause is there so a board isn't skipped
for no reason: if the only thing left for the second picker is a kicker and the first picker has their kicker
already, nobody is stranded.

A board that fails is **skipped**, exactly as `boardAt` skips one in single player — the sequence has eighteen
entries for eight boards, so there is always somewhere to go, and if they were ever exhausted the server widens
to the rest of the boards in the same seeded order. Both clients compute the skip from the same public picks, so
neither has to be told. The skip is free and belongs to nobody: it costs no re-spin.

What this deliberately does *not* do is constrain the first picker. Taking the last quarterback on a board when
you know the other player needs one is a good move, not an exploit, and the draft is supposed to reward seeing
it coming. The rule only guarantees that the second picker always has *something* — never that it is what they
wanted.

The same check protects the clock's auto-pick, which therefore always has an option to take, and the last-resort
case is stated for completeness: if a player on the clock somehow faces a board with nothing they can use, the
server re-spins that board itself, charged to no one.

## 9. Screens (`versus.jsx`, prefix `vs-`)

- **The Modes tile** — "1v1" beside the others: create a lobby, or the link to the one you already have open.
- **The lobby** — your link with a copy button, and the state of the other side ("waiting for an opponent" /
  "they're here"). Realtime; no polling.
- **The draft** — the board both players are looking at, whose turn it is, the clock, both rosters filling up
  side by side, and everything already taken shown as taken. A pick you can't make is never offered. Players,
  defenses and kickers sit on the one board, each group with the stats that justify its rating: points allowed,
  takeaways, sacks for a defense; made/attempted, long, 50-yarders for a kicker.
- **The result** — both rosters, each side's offense, what their kicker added and what their defense took off the
  other, the two final scores, the winner, and a share card.
- **`/vs/<code>`** — the invite address; `vercel.json` rewrites it to the page with `X-Robots-Tag: noindex`, as
  the challenge links already are.

## 10. Records

`profiles.pvp_wins` and `pvp_losses` (integers, default 0), written only by the Edge Function. The Leaderboard
screen gains a **1v1** board ranking by wins, and a profile shows the pair as a line of its own. The share text
gets a versus variant: the two scores, the result, and a link to play the winner.

## 11. Tests

- `tests/test-versus-pool.mjs` — the data file: a defense and a kicker for every team-season 1999–2025, every
  team code one `TEAMS` knows, every rating finite and inside the scale, and a handful of seasons pinned by hand
  (the 2006 Ravens above the 2006 Lions, Vanderjagt's 2003 above a replacement kicker's). It also pins the fact
  section 8 exists for: that boards with a single quarterback are real, and that every board carries at least
  two defenses and two kickers.
- `tests/test-versus-sql.mjs` — the migration in PGlite: the tables' RLS (nobody writes them), `create_match`,
  `join_match` and their codes, and `match_state`'s shape. Mock parity, as the other SQL tests do.
- `tests/test-versus-rules.mjs` — every refusal in 4 and 7, driving `decideMove` itself rather than a mirror of
  it: wrong turn, wrong board, an option already taken by the *other* player, a slot that doesn't fit, a defense
  into a Flex, a clock claimed early by either player and then honoured, a powerup spent twice, a steal with
  nothing to steal. Then a whole match played to the end with all four powerups spent, finishing at sixteen
  picks with two full legal rosters and a result the server computed.
- `tests/test-versus-boards.mjs` — section 8, which is where a 1v1 draft would go wrong quietly: the one-QB
  board is skipped when both players still need a quarterback and dealt when only one does; the second picker
  always has a legal option, over every ordering of every slot; and a match played out sixteen picks deep from
  many seeds always ends with two full, legal rosters. Re-spins too: a leader's moves the board for both, a
  follower's moves only their own, neither lands on a board still waiting in the sequence, and two on one board
  can't land on each other. The steal: it lands on the thief's roster, leaves the leader's empty, puts him back
  on the same board for the board's second pick, and is refused when it would leave him nothing there. And the
  double dip, played out over whole matches from both sides of the snake: two picks on the board, none on the
  next, the other player alone on it, sixteen picks and two full rosters all the same.
- `tests/test-versus-flow.mjs` — the whole thing in jsdom on the mock: create, join, sixteen picks alternating
  correctly, a defense taken fifth and a kicker first, a timeout auto-picking, the result and the records.
- `tests/test-a11y.mjs` gains the new screens.

## 12. Order of work

1. The migration and its SQL tests. ✅
2. The defense and kicker data, and its test. ✅ (`data/versus-pool.json`, 861 of each)
3. `versus-logic.mjs`: the board's three pools, what fits where, the auto-pick's arithmetic, the powerups, the
   result, and `decideMove` — shared by the browser and the function. ✅
4. The Edge Function and its rule tests. ✅ (all four powerups included)
5. The mock, so the jsdom tests can drive a match without a network.
6. The screens, then the flow test.
7. Records, the board, the share card.
8. Staging, then production, as a version.
