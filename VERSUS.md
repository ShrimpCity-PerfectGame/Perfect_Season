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
- Both screens then watch the **same six boards**, dealt from one seed, in order.
- Picks alternate, snaking by board: on board 1 the host picks first and the opponent picks second **from the
  same board, minus the player just taken**; on board 2 the opponent picks first; and so on. Six boards, twelve
  picks, six players each — the same QB/RB/WR/TE/Flex/Flex roster single player uses.
- Each pick has a **clock**. When it runs out the pick is made for you: the best available player that fits an
  open slot. A dropped connection loses you a pick, not the match.
- When both rosters are full, the server grades them and plays **one game**. The winner is recorded.
- A win goes on a **PvP record of its own** — `pvp_wins` / `pvp_losses` on the profile, and a leaderboard beside
  the others. Nothing about it touches career wins, championships, the points ladders or best-score boards: a
  head-to-head result and a 20–0 season are different things and are not mixed.

**Not in v1:** defenses and kickers (see 6), a spectator view, rematch-in-place, tournaments, chat.

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
| `code` | text unique not null | six characters, the shareable link's `/vs/<code>` |
| `host_id` | uuid not null → `auth.users(id)` on delete cascade | |
| `guest_id` | uuid null → `auth.users(id)` on delete cascade | null until someone joins |
| `format` | text not null default `'fantasy'` | `fantasy` \| `standard`, the host's choice at creation |
| `seed` | text not null | deals the six boards (`seededSequence`), exactly as a single-player draft's seed does |
| `status` | text not null | `open` \| `drafting` \| `done` \| `abandoned` |
| `turn_deadline` | timestamptz null | when the player on the clock loses the pick |
| `result` | jsonb null | `{ hostScore, guestScore, winner, margin, games }`, written once, by the server |
| `winner_id` | uuid null | set with `result`; null for a draw |
| `created_at` / `ended_at` | timestamptz | |

RLS on. **Select** is allowed to anyone (a match is public once it exists — its result appears on a board), and
there is **no client insert, update or delete policy at all**.

**`match_picks`** `(match_id, pick_no)` primary key, plus `user_id`, `board_idx`, `player_id`, `season`, `slot`,
`auto` (boolean — the clock made it), `created_at`. RLS on, public select, no client write policy.

**Functions** (security definer, `search_path = public, pg_temp`, execute granted to `authenticated` only):

| function | returns | does |
|---|---|---|
| `create_match(p_format text)` | jsonb: the match row | One open match per host at a time (a second call returns the existing one). Generates the code and the seed. Guests (`profiles.guest`) may not create one — see 5. |
| `join_match(p_code text)` | jsonb: the match row, or a code | `not_found`, `already_full`, `own_match`, `not_signed_in`, `guest_not_allowed`. Sets `guest_id`, `status = 'drafting'` and the first `turn_deadline`. |
| `match_state(p_code text)` | jsonb | The match plus its picks, for a client that has just opened the page or reconnected. Read-only (`stable`), called as GET. |

Everything that decides a pick lives in the Edge Function below, not here, because it needs the game's own rules.

## 4. The Edge Function (`supabase/functions/match-pick`)

Deno, service-role, imports `game-logic.mjs` — the same module the browser and `submit-run` share, so a board is
dealt and a roster is graded by one set of rules, never two.

`POST { code, boardIdx, playerId, season, slot }` from a signed-in player. It refuses, in this order:

1. the match isn't `drafting`, or the caller is neither player → `not_your_match`;
2. it isn't the caller's turn (turn = snake order over `match_picks.length`) → `not_your_turn`;
3. `boardIdx` isn't the current board → `wrong_board`;
4. the player isn't on that board (`boardAt(seed, idx)`) → `not_on_board`;
5. the player is already taken in this match, by either side → `already_taken`;
6. the slot is filled, or the player doesn't fit it (`fits`) → `bad_slot`.

Otherwise it writes the pick, sets the next `turn_deadline`, and — on the twelfth — **computes the result**:
both rosters graded with `effectiveRating` in the match's format, one game decided by `winProb` over the score
gap using the match seed, then `matches.result`, `winner_id`, `status = 'done'`, and `pvp_wins` / `pvp_losses` on
both profiles. The clients are told by Realtime; they render, they don't decide.

`POST { code, claim: "clock" }` is how a client says the clock has run out. The function checks
`turn_deadline` **itself** — a client that lies is refused — and, if it really has passed, makes the pick the
clock owes: the best available player by `effectiveRating` that fits an open slot, marked `auto`.

## 5. Who may play

Both players must be signed in. **Guests may not** (`profiles.guest`): a guest account can be made again and
again from one browser, so a guest 1v1 would be two tabs farming a leaderboard. This is the same reasoning that
keeps guests off the daily, and it is the only sound line until there is a cost to making an account.

**Known gap, to be written into CLAUDE.md:** two *real* accounts in two tabs can still farm PvP wins. It costs an
email address each, the boards are seeded so nothing about the result is free, and nothing but the PvP board is
affected — but it is a gap, and the answer if it is ever abused is a rate limit on `create_match` plus ignoring
matches between accounts that only ever play each other.

## 6. Defenses and kickers — not yet, and why

The dataset is `POS = ["QB", "RB", "WR", "TE"]`. There are no team defenses and no kickers in it, and the scripts
that build `data/players.json` from nflverse aren't in this checkout, so that data cannot be regenerated here.

When it is wanted, the cheap version needs **no new data at all**: every historical team-season already lives in
`OPPS`, rated by point differential, which is what a roster plays against all season. A seventh pick could be one
of those team-seasons as a defense, and its rating becomes a penalty against the opponent's score. That is a
design change to 1v1 only, and it can be added without touching the single-player game. A real defense/kicker
position that changes every mode is a data project first, and belongs in its own contract.

## 7. Screens (`versus.jsx`, prefix `vs-`)

- **The Modes tile** — "1v1" beside the others: create a lobby, or the link to the one you already have open.
- **The lobby** — your link with a copy button, and the state of the other side ("waiting for an opponent" /
  "they're here"). Realtime; no polling.
- **The draft** — the board both players are looking at, whose turn it is, the clock, both rosters filling up
  side by side, and the players already taken shown as taken. A pick you can't make is never offered.
- **The result** — both rosters graded, the score of each, the winner, and a share card.
- **`/vs/<code>`** — the invite address; `vercel.json` rewrites it to the page with `X-Robots-Tag: noindex`, as
  the challenge links already are.

## 8. Records

`profiles.pvp_wins` and `pvp_losses` (integers, default 0), written only by the Edge Function. The Leaderboard
screen gains a **1v1** board ranking by wins, and a profile shows the pair as a line of its own. The share text
gets a versus variant: the two scores, the result, and a link to play the winner.

## 9. Tests

- `tests/test-versus-sql.mjs` — the migration in PGlite: the tables' RLS (nobody writes them), `create_match`,
  `join_match` and their codes, and `match_state`'s shape. Mock parity, as the other SQL tests do.
- `tests/test-versus-rules.mjs` — the Edge Function's refusals, one per rule in 4, against the real
  `game-logic.mjs`: wrong turn, wrong board, a player already taken by the *other* player, a slot that doesn't
  fit, a clock claimed early, and the auto-pick the clock really owes.
- `tests/test-versus-flow.mjs` — the whole thing in jsdom on the mock: create, join, twelve picks alternating
  correctly, a timeout auto-picking, the result and the records.
- `tests/test-a11y.mjs` gains the new screens.

## 10. Order of work

1. The migration and its SQL tests.
2. The Edge Function and its rule tests.
3. The mock (so the jsdom tests can drive a match without a network).
4. The screens, then the flow test.
5. Records, the board, the share card.
6. Staging, then production, as a version.
