# A first-party crash sink

**Status:** design approved in conversation 2026-10-05. Not planned, not built.
**Supersedes:** the one-line note in CLAUDE.md's crash-net section — *"A first-party sink (a bounded
`client_errors` table, insert-only) is the obvious next step and would need a line in the privacy policy."*

## 1. Intent

Gridspin's crash net (v2.19.0) catches an uncaught render error, shows a screen instead of a blank cream
page, and offers **Copy error details**. That button is the whole reporting path: a failure nobody copies
and pastes is a failure the owner never learns about.

**The intended outcome:** crashes hit by people the owner cannot talk to are recorded without anyone having
to do anything. Success is a row appearing for a stranger's crash that would otherwise have been silent.

**This was argued against and chosen anyway**, which is recorded here so a later reader does not re-open it.
Production has had 5 completed drafts in 48 hours, all from the owner's own account; with no players there
is nobody to catch, and the Copy button already covers the one person who crashes. The owner chose the
stranger-facing version with that stated. The counter-argument is not a reason to revisit the decision; it
*is* a reason the ceilings in §9 are accepted rather than engineered away.

**Decided in the same conversation, and load-bearing on everything below:**

| Question | Answer |
|---|---|
| Purpose | Catch crashes from strangers, not the owner's own testing |
| Consent | **Automatic, no prompt.** The people worth hearing from are the ones who close the tab |
| Payload | Crashes **plus the ring that led to them** — not every silent failure |
| Write path | A sixth Edge Function. Not a client-writable table |

Out of scope: silent failures that never blank the page (rejected promises, failed submits), an in-app
viewer, alerting, and any aggregation. `kind` exists so the first of those can be added later without a
migration; nothing else here is built for it.

## 2. Two findings this design exists around

Both were found by reading the code during design, not assumed.

**`crashReport` already carries a username.** It includes `Page: ${location.pathname}`, so a crash on
`/u/ShrimpCity` puts that name in the report. Today it lands on the player's own clipboard, where they can
see it and decline to paste. Storing reports automatically moves that same name into the database with
nobody looking. **Scrubbing the path is therefore not a nicety; it is the reason the write path is a
function** (§4).

**The crash net's central rule is unenforced.** `error-boundary.jsx` imports nothing but React — that is
what makes it work when the app it is reporting on did not. `tests/test-error-boundary.mjs` states the rule
in a comment (*"This file imports nothing - that is the point of it"*) and asserts nothing about it. This
design leans on that rule, so §8 adds the assertion. It is the same shape CLAUDE.md records walking into
three times: an assertion that touches no door passes while the door is shut.

## 3. The table

`client_errors`, in a new `supabase/migration-client-errors.sql`. **RLS on, public select absent, and no
client write policy at all** — the shape of `profiles`, `daily_runs`, `century_runs` and `guess_runs`, not
of `sou_runs`/`builds`. The function's service role is the only writer and the SQL editor the only reader.

| Column | Type | Holds |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `created_at` | timestamptz not null | insert time, `now()` |
| `version` | text not null | the release, e.g. `2.21.5`, from `APP_VERSION` |
| `kind` | text not null, check in (`'crash'`) | one value today; widening is a check change, not a migration of rows |
| `message` | text not null | the thrown error, **capped 500** |
| `stack` | text | first 6 frames, capped 2000 |
| `component` | text | React's component stack, 6 lines, capped 1000 |
| `before` | jsonb | the ring: up to 5 × `{kind, message, extra}`, each message capped 300 |
| `browser` | text | **reduced**, e.g. `Chrome 152 / Android` — never the raw user-agent |
| `screen` | text | **`profile`**, never `/u/ShrimpCity` |

**Three columns that do not exist, deliberately: no user id, no username, no IP.** The function sees the
caller's IP (it cannot not) and must never write it. That is a comment in the SQL and an assertion in §8,
because a column nobody adds is easier to keep absent than to remove later.

## 4. The flow

### 4.1 In the crash net

Fire-and-forget from the boundary, importing nothing:

```js
fetch(SUPABASE_URL + "/functions/v1/report-error", {
  method: "POST", keepalive: true,
  headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
  body: JSON.stringify({ version, message, stack, component, before, ua, path }),
}).catch(() => {});
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are esbuild **defines** — bare identifiers replaced at build time,
exactly as `APP_VERSION` already is inside this file. **No import is added, and the rule in §2 holds.**

Three details that are not cosmetic:

- **`keepalive: true`.** A crash is frequently followed by the tab closing. Without it the request dies with
  the page, and the reports lost are the ones from the most annoyed strangers — the exact population this
  feature exists for.
- **Guarded on the defines being non-empty**, using the `typeof X !== "undefined"` pattern already in the
  file. `tests/` and `tools/ui-harness` build with no Supabase environment, so the define is `""`; without
  the guard every jsdom test would POST at a broken URL on every caught error.
- **`.catch(() => {})` and nothing more.** The reporter must never throw inside the crash screen. The only
  thing worse than losing a report is the crash net crashing.

### 4.2 In the function

`supabase/functions/report-error/index.ts`, with `verify_jwt = false` in `supabase/config.toml` like the
other five — a crash can happen signed out, and a guest's crash matters as much as anyone's.
`deploy-function.mjs`'s `FUNCTIONS` list goes from five to six.

It does four things and nothing else:

1. **Scrub the path to a screen name.** `/u/<name>` → `profile`, `/c/<code>` → `challenge`,
   `/vs/<code>` → `duel`, `/leaderboard` → `leaderboard`, `/how-to-play` → `rules`, `/privacy` → `privacy`,
   `/terms` → `terms`, `/` → `home`, anything unrecognised → `other`. **An unrecognised path becomes
   `other`, never itself** — a default that passes the path through is the leak wearing a disguise.
2. **Reduce the user-agent** to browser plus major version plus platform. Unparseable → `unknown`.
3. **Cap every string** to the lengths in §3, and the `before` array to 5 entries.
4. **Insert with the service role.**

Why these live in the function rather than the client: **a crashed client cannot be trusted to scrub its own
report.** Putting the guard inside the thing it guards is the whole argument against the cheaper
client-writable table, and it is the reason this feature costs a sixth function.

## 5. Abuse

The endpoint is open by construction — `verify_jwt = false`, and the anon key ships in every bundle.

**The limit: the function refuses when `client_errors` already holds more than 200 rows in the last hour.**
Stateless, stores nothing new, and bounds the table's growth.

Its ceiling, stated rather than hidden: **a flood fills the hour's quota and real crashes are dropped.** The
upgrade is a per-IP limit keyed on a daily-salted hash — the pattern `/privacy` already describes for the
visit counter, so the policy language exists. It is not built, because the alternative to a crude limit here
is storing an identifier the rest of this design spends effort not storing.

## 6. Retention

The insert also deletes rows older than **90 days**. Opportunistic, so there is no cron to schedule and
nothing to forget. A table that only ever receives rows is a privacy promise with a slow leak in it.

## 7. Reading it, and what it costs on `/privacy`

**Reading:** a runbook query at `supabase/query-client-errors.sql`, the same call made for the play log on
2026-10-05 and for the same reason — running it needs a Supabase dashboard login, so it is visible to the
owner and nobody else, and it adds no surface to the app that could leak later. No in-app screen.

**The privacy page changes in three places, and the trap is already documented.** `/privacy`'s lede says
*"the one thing that counts visits sets no cookie"*. **"The one thing" becomes two things.** When the visit
counter landed in v2.21.0 exactly three places had to change — the section, the **lede**, and the **meta
description** — and the first test read only `page.sections`, so it passed while the top of the page
contradicted the middle. All three change here, and §8 reads all three.

The new paragraph states: a crash sends an automatic report; it carries the release, the error and where in
the code it happened, which screen you were on and which browser — never your name, your account or your
address; it is kept 90 days. And one line that is true and worth saying: **`/privacy` and `/terms` are
`standalone`, carry no bundle, and therefore cannot crash or report.** The page explaining what is collected
collects nothing, this included.

## 8. Checks

In the repo's own idioms. Every one of these fails if its rule breaks.

| # | Check | Where |
|---|---|---|
| 1 | **`error-boundary.jsx` imports nothing but React** — the §2 gap, finally asserted | `test-error-boundary.mjs` |
| 2 | The scrub, **through the real function** (`tests/edge-harness.mjs`): `/u/ShrimpCity` in, `screen: "profile"` stored, the name nowhere in the row | new `test-report-error-edge.mjs` |
| 3 | An **unrecognised** path becomes `other` and is not passed through | same |
| 4 | The leak list gains a **dynamic** case: seed a real username, assert it appears in no column. Today's list is literal strings (`@`, `userId`, `token`…), which is precisely why it never caught the pathname | `test-error-boundary.mjs` + the edge test |
| 5 | No `ip` / `user_id` / `username` column exists, and the function writes none | the edge test, over the migration's real columns |
| 6 | The migration in PGlite: RLS on, **an anon insert refused** | `test-client-errors-sql.mjs` via `pg-fixture.mjs` |
| 7 | The new migration is **named** by the migration list | `test-migrations.mjs` (it holds the list to every migration in the repo) |
| 8 | The reporter is inert with no `SUPABASE_URL` — no fetch in the test build | `test-error-boundary.mjs` |
| 9 | `/privacy` cannot claim one thing collects while two do — **section, lede and meta description all read** | `test-site-pages.mjs` |

The function is **executed**, not read as text. CLAUDE.md is explicit that the first real run of `match-pick`
found a `ReferenceError` no string assertion could have caught.

## 9. Known ceilings

Accepted, not solved. Each is here so nobody later mistakes it for an oversight.

- **A thrown message can carry anything.** If some future code throws `` `no profile for ${username}` ``, it
  lands in `message`. Capping at 500 limits the blast radius and does not close it. This is the strongest
  argument for keeping `kind` to `crash` only: widening to every silent failure widens this exposure too.
- **A flood costs signal** (§5).
- **A crash bad enough to kill the request loses its own report.** `keepalive` narrows the window; only a
  persisted retry queue would close it, and that is real machinery in the one file whose rule is that it
  stays small. Rejected during design as approach C.
- **It catches nobody until there are players.** See §1.

## 10. Release order

The repo's hard rule, and not optional here: **migration → Edge Function → client.**

A client ahead of the function POSTs at a 404 and silently drops every report, which is invisible and would
look exactly like "no crashes". The other order is harmless: a deployed function with no client sends it
nothing. Staging first, verified there, then promoted — `/privacy` is a live legal page, so this release
cannot skip the staging step.

Per environment: run `migration-client-errors.sql`, then `node deploy-function.mjs <env>` (which now deploys
six), then the client.
