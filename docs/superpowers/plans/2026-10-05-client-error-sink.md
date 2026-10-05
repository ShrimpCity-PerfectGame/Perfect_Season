# Client Error Sink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record crashes from players the owner cannot talk to, automatically, without any report ever carrying a name.

**Architecture:** A new `client_errors` table with RLS on and **no client write policy at all**; a sixth Edge Function `report-error` whose service role is the only writer and which scrubs the path to a screen name and the user-agent to a browser name before inserting; and a fire-and-forget `keepalive` POST from `error-boundary.jsx` that adds no import. The scrub lives in the function because a crashed client cannot be trusted to scrub its own report.

**Tech Stack:** Postgres (Supabase), Deno Edge Function, React 18 class component, esbuild `define` constants, PGlite for migration tests, `tests/edge-harness.mjs` for executing the function in Node.

**Spec:** `docs/superpowers/specs/2026-10-05-client-error-sink-design.md` — read it first; this plan argues from it.

## Global Constraints

- **`error-boundary.jsx` imports nothing but React.** Not storage.js, not theme.mjs, not a helper. `SUPABASE_URL` / `SUPABASE_ANON_KEY` are esbuild `define`s — bare identifiers, used with the `typeof X !== "undefined"` guard already in that file for `APP_VERSION`.
- **No `user_id`, `username` or `ip` column exists on `client_errors`**, and the function writes none.
- **An unrecognised path becomes `other`, never itself.**
- Caps: `message` 500, `stack` 2000, `component` 1000, each `before` entry 300, `before` array 5 entries.
- Retention 90 days. Rate limit 200 rows/hour, global.
- `kind` is `'crash'` only, enforced by a CHECK.
- Release order: **migration → Edge Function → client.** Staging first; `/privacy` is a live legal page.
- Tests are standalone `node tests/<file>.mjs` scripts that exit non-zero on failure. They run one at a time (`node tests/run-all.mjs`), never in parallel.
- Commit messages: lower-case prefix (`feat:`/`fix:`/`docs:`), and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Review Focus

Five input classes the spec implies but which no task's happy path exercises. Each one's test is added to the task that owns the code.

1. **A megabyte `message`.** A thrown error can carry an enormous string; the cap must apply before the insert, not after. (Task 2)
2. **A malformed body** — no JSON, `before` not an array, `path` a number, fields missing. The function must answer a 400, never a 500 and never a partial row. (Task 2)
3. **A path that resembles a known route but is not one** — `/u`, `/u/`, `/uu/x`, `//u/name`. Each must become `other`, because a near-miss that falls through to "pass it along" is the leak the whole design exists to close. (Task 2)
4. **A surrogate pair split by the cap.** Capping by JS string length can cut an emoji in half and produce a lone surrogate, which Postgres rejects as invalid UTF-8 — turning one bad crash report into zero crash reports. (Task 2)
5. **A build with no `SUPABASE_URL`.** Every jsdom test and the UI harness build with no Supabase environment; without the guard the reporter POSTs at `"/functions/v1/report-error"` on every caught error in every test. (Task 3)

---

### Task 1: The table

**Files:**
- Create: `supabase/migration-client-errors.sql`
- Create: `tests/test-client-errors-sql.mjs`
- Modify: `tests/pg-fixture.mjs:21` (the `MIGRATIONS` list)

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.client_errors` with columns `id bigint`, `created_at timestamptz`, `version text`, `kind text`, `message text`, `stack text`, `component text`, `before jsonb`, `browser text`, `screen text`. Task 2's function inserts exactly these names.

- [ ] **Step 1: Write the failing test**

Create `tests/test-client-errors-sql.mjs`:

```js
// The crash sink's table, in real Postgres. The rule it exists to hold: nobody but the service role writes
// it, and three columns are absent on purpose - no user_id, no username, no ip. A column nobody adds is
// easier to keep absent than to remove once it has rows in it.
import { freshDb, MIGRATIONS } from "./pg-fixture.mjs";
import { assert, runTest } from "./helpers.mjs";

const db = await freshDb({ migrations: MIGRATIONS });

await runTest("the table exists with the columns the function writes, and no others", async () => {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'client_errors' order by column_name`);
  const got = rows.map((r) => r.column_name).sort();
  const want = ["before", "browser", "component", "created_at", "id", "kind", "message", "screen", "stack", "version"].sort();
  assert(JSON.stringify(got) === JSON.stringify(want), `columns: ${JSON.stringify(got)}`);
});

await runTest("no column can hold a person", async () => {
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'client_errors'`);
  for (const r of rows) {
    assert(!/user|name|ip|email|account|session/i.test(r.column_name),
      `${r.column_name} is the sort of column this table must not have`);
  }
});

await runTest("RLS is on and there is no write policy at all", async () => {
  const { rows: [t] } = await db.query(
    `select relrowsecurity from pg_class where oid = 'public.client_errors'::regclass`);
  assert(t.relrowsecurity === true, "row level security is enabled");
  const { rows: pol } = await db.query(
    `select polname, polcmd from pg_policy where polrelid = 'public.client_errors'::regclass`);
  assert(pol.length === 0, `no policy of any kind, got: ${JSON.stringify(pol)}`);
});

await runTest("an anon insert is refused", async () => {
  await db.exec("set local role anon");
  let refused = false;
  try {
    await db.query(`insert into public.client_errors (version, kind, message) values ('t', 'crash', 'x')`);
  } catch (e) { refused = true; }
  await db.exec("reset role");
  assert(refused, "anon cannot write the table");
});

await runTest("kind is crash and nothing else", async () => {
  let refused = false;
  try {
    await db.query(`insert into public.client_errors (version, kind, message) values ('t', 'silent', 'x')`);
  } catch (e) { refused = true; }
  assert(refused, "the check constraint holds kind to 'crash'");
});

await db.close();
console.log("test-client-errors-sql.mjs done");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-client-errors-sql.mjs`
Expected: FAIL — `relation "public.client_errors" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migration-client-errors.sql`:

```sql
-- The crash sink (docs/superpowers/specs/2026-10-05-client-error-sink-design.md). One row per uncaught render
-- error, written only by the report-error Edge Function's service role.
--
-- ORDER: anywhere. It references nothing and nothing references it - deliberately, so it can be run on either
-- environment without a window where something else is half-migrated.
--
-- WHY NO CLIENT WRITE POLICY, and no select policy either: this table is the one place a player's browser sends
-- something that nobody asked them about. The function scrubs the path to a screen name before anything lands
-- here, and a client that could write directly would be a client scrubbing its own report - which is the guard
-- living inside the thing it guards. Read it from the SQL editor (supabase/query-client-errors.sql).
--
-- THREE COLUMNS ARE ABSENT ON PURPOSE: no user_id, no username, no ip. The function sees the caller's address
-- (it cannot not) and must never write it. A column nobody adds is easier to keep absent than to remove once
-- it has rows in it.
create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  -- The release, from APP_VERSION. The stack is minified, so this is what makes it readable.
  version     text not null check (char_length(version) between 1 and 40),
  -- One value today. Widening this is a check change rather than a reshaping of rows - but see §9 of the
  -- spec first: every new kind widens what an arbitrary thrown string can carry into this table.
  kind        text not null check (kind in ('crash')),
  message     text not null check (char_length(message) <= 500),
  stack       text check (char_length(stack) <= 2000),
  component   text check (char_length(component) <= 1000),
  -- The ring that led up to the crash: up to 5 x {kind, message, extra}. A crash is usually the SECOND
  -- failure, and the first one is the one that explains it.
  before      jsonb,
  -- Reduced, e.g. 'Chrome 152 / Android'. Never the raw user-agent string.
  browser     text check (char_length(browser) <= 80),
  -- A screen name, e.g. 'profile'. NEVER a path: /u/<name> carries a username.
  screen      text check (char_length(screen) <= 40)
);

-- Reading one account's crashes is not a thing anyone does; reading the last day's is. Partial on nothing,
-- because the table is small by construction (90-day retention, 200 rows an hour).
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;
-- No policy is created, for either reading or writing. RLS with no policy denies everything to anon and
-- authenticated, which is the whole point; the service role bypasses RLS.
revoke all on table public.client_errors from anon, authenticated;
```

- [ ] **Step 4: Add it to the migration list**

Modify `tests/pg-fixture.mjs:21` — append to `MIGRATIONS`:

```js
export const MIGRATIONS = ["migration-century.sql", "migration-guess.sql", "migration-runs-log.sql", "migration-profiles.sql", "migration-moderation.sql", "migration-wallet.sql", "migration-shop.sql", "migration-versus.sql", "migration-client-errors.sql"];
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `node tests/test-client-errors-sql.mjs && node tests/test-migrations.mjs`
Expected: both PASS. `test-migrations.mjs` holds the list to every migration file in the repo, so it fails if step 4 is skipped — that is the check working, not a problem to route around.

- [ ] **Step 6: Mutate to prove the tests bite**

Temporarily change `kind in ('crash')` to `kind in ('crash', 'silent')` in the migration and re-run `node tests/test-client-errors-sql.mjs`. Expected: FAIL on "the check constraint holds kind to 'crash'". Revert.

Then temporarily add `user_id uuid` to the table and re-run. Expected: FAIL on both the column-list test and the no-person test. Revert.

- [ ] **Step 7: Commit**

```bash
git add supabase/migration-client-errors.sql tests/test-client-errors-sql.mjs tests/pg-fixture.mjs
git commit -m "feat: the crash sink's table, which no client may write

RLS on and no policy at all - not for writing and not for reading. Three
columns are absent on purpose: no user_id, no username, no ip. The function's
service role is the only writer and the SQL editor the only reader.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The function

**Files:**
- Create: `supabase/functions/report-error/index.ts`
- Create: `tests/test-report-error-edge.mjs`
- Modify: `supabase/config.toml` (add a `[functions.report-error]` block)
- Modify: `deploy-function.mjs:17` (the `FUNCTIONS` list)

**Interfaces:**
- Consumes: `public.client_errors` from Task 1.
- Produces: `POST /functions/v1/report-error` taking `{version, message, stack, component, before, ua, path}` and answering `{ok: true}` 200, or `{error}` 400. Task 3's client sends exactly those field names.

- [ ] **Step 1: Write the failing test**

Create `tests/test-report-error-edge.mjs`:

```js
// The crash sink's function, EXECUTED - the repo's rule, and the reason for it is in CLAUDE.md: the first real
// run of match-pick found a ReferenceError no string assertion could have caught.
//
// What this holds, and why each one is here rather than being obvious:
//   - the path is scrubbed to a screen name. /u/<name> carries a username, and this is the only place it is
//     removed. A near-miss path that fell through to itself would be that same leak wearing a disguise.
//   - the caps apply BEFORE the insert, including on a string with an emoji at the boundary.
//   - a malformed body is a 400, never a 500 and never a partial row.
import { loadEdgeFunction } from "./edge-harness.mjs";
import { assert, runTest } from "./helpers.mjs";

const { invoke } = await loadEdgeFunction("report-error");

function store() {
  const rows = { client_errors: [] };
  return {
    users: new Map(),
    rowsOf: (t) => rows[t] || [],
    insert: (t, row) => { (rows[t] ||= []).push(row); return { data: [row], error: null }; },
    remove: () => {},
    rpcs: {},
    _rows: rows,
  };
}

const ok = { version: "2.21.5", message: "boom", stack: "at x", component: "at App", before: [], ua: "", path: "/" };

await runTest("a profile path is stored as a screen name, and the username is nowhere", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const res = await invoke({ ...ok, path: "/u/ShrimpCity" });
  assert(res.status === 200, `accepted: ${res.status} ${JSON.stringify(res.body)}`);
  const row = s._rows.client_errors[0];
  assert(row.screen === "profile", `screen is a name, not a path: ${row.screen}`);
  assert(!JSON.stringify(row).includes("ShrimpCity"), `the name is nowhere in the row: ${JSON.stringify(row)}`);
});

await runTest("a path that only resembles a known route becomes other", async () => {
  for (const path of ["/u", "/u/", "/uu/x", "//u/ShrimpCity", "/u/ShrimpCity/extra", "/nope"]) {
    const s = store();
    globalThis.__edge_store__ = s;
    await invoke({ ...ok, path });
    const row = s._rows.client_errors[0];
    assert(row.screen === "other", `${path} -> other, got ${row.screen}`);
    assert(!JSON.stringify(row).includes("ShrimpCity"), `and never the name: ${path}`);
  }
});

await runTest("every known route maps to its own name", async () => {
  for (const [path, screen] of [["/", "home"], ["/c/ABC123", "challenge"], ["/vs/ABC123", "duel"],
                                ["/leaderboard", "leaderboard"], ["/how-to-play", "rules"]]) {
    const s = store();
    globalThis.__edge_store__ = s;
    await invoke({ ...ok, path });
    assert(s._rows.client_errors[0].screen === screen, `${path} -> ${screen}, got ${s._rows.client_errors[0].screen}`);
  }
});

await runTest("the user-agent is reduced, never stored raw", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36";
  await invoke({ ...ok, ua });
  const row = s._rows.client_errors[0];
  assert(!row.browser.includes("AppleWebKit"), `reduced, not raw: ${row.browser}`);
  assert(/Chrome/.test(row.browser) && /Android/.test(row.browser), `but still useful: ${row.browser}`);
});

await runTest("a megabyte message is capped before the insert", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  await invoke({ ...ok, message: "x".repeat(1_000_000), stack: "y".repeat(50_000) });
  const row = s._rows.client_errors[0];
  assert(row.message.length <= 500, `message capped: ${row.message.length}`);
  assert(row.stack.length <= 2000, `stack capped: ${row.stack.length}`);
});

await runTest("capping never leaves half an emoji behind", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  // A lone surrogate is invalid UTF-8 and Postgres refuses the whole row - so a naive slice turns one bad
  // crash report into zero crash reports.
  await invoke({ ...ok, message: "a".repeat(499) + "\u{1F4A5}" + "b".repeat(100) });
  const row = s._rows.client_errors[0];
  assert(!/[\uD800-\uDFFF]/.test(row.message), `no lone surrogate survived the cap: ${JSON.stringify(row.message.slice(-4))}`);
});

await runTest("the ring is capped in both directions", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const before = Array.from({ length: 50 }, (_, i) => ({ kind: "err", message: "m".repeat(5000), extra: `${i}` }));
  await invoke({ ...ok, before });
  const row = s._rows.client_errors[0];
  assert(row.before.length === 5, `five entries: ${row.before.length}`);
  for (const e of row.before) assert(JSON.stringify(e).length <= 400, `each entry bounded: ${JSON.stringify(e).length}`);
});

await runTest("a malformed body is a 400, and writes nothing", async () => {
  for (const body of [{}, { version: "x" }, { ...ok, before: "not an array" }, { ...ok, path: 7 }, { ...ok, message: "" }]) {
    const s = store();
    globalThis.__edge_store__ = s;
    const res = await invoke(body);
    assert(res.status === 400, `400 for ${JSON.stringify(body).slice(0, 60)}: got ${res.status}`);
    assert(s._rows.client_errors.length === 0, "and nothing was written");
  }
});

await runTest("no row carries an address, an account or a name", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  await invoke({ ...ok, path: "/u/ShrimpCity" }, { headers: { "x-forwarded-for": "203.0.113.9" } });
  const row = JSON.stringify(s._rows.client_errors[0]);
  for (const leak of ["203.0.113.9", "ShrimpCity", "user_id", "username", "ip"]) {
    assert(!row.includes(leak), `the row carries no ${leak}: ${row}`);
  }
});

console.log("test-report-error-edge.mjs done");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tests/test-report-error-edge.mjs`
Expected: FAIL — the esbuild bundle step cannot find `supabase/functions/report-error/index.ts`.

- [ ] **Step 3: Write the function**

Create `supabase/functions/report-error/index.ts`:

```ts
// The crash sink's only writer (docs/superpowers/specs/2026-10-05-client-error-sink-design.md).
//
// It exists to do one thing the client cannot be trusted with: SCRUB. error-boundary.jsx's report carries
// location.pathname, and /u/<name> is a username - so a report stored straight from the browser would put a
// name in the database with nobody looking. The crashed client is the last code that should be asked to
// remove it, which is why this function exists rather than an insert policy on the table.
//
// It is deliberately not authenticated (verify_jwt = false, like the other five): a crash can happen signed
// out, and a guest's crash matters as much as anyone's. That makes it an open endpoint, bounded by the rate
// limit below rather than by who is asking.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX = { message: 500, stack: 2000, component: 1000, entry: 300, before: 5, version: 40, browser: 80 };
const RATE_PER_HOUR = 200;
const KEEP_DAYS = 90;

function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

// Cap by CODE POINT, not by UTF-16 unit. Slicing at a fixed length can cut an emoji in half and leave a lone
// surrogate, which is invalid UTF-8 - Postgres refuses the whole row, turning one bad crash report into zero.
function cap(v: unknown, n: number): string | null {
  if (typeof v !== "string" || !v) return null;
  const points = Array.from(v);
  return points.length <= n ? v : points.slice(0, n).join("");
}

// A near-miss must become `other`, never itself. A default that passes the path through is the leak this
// function exists to close, wearing a disguise - so this matches exact shapes and nothing else.
function screenOf(path: unknown): string {
  if (typeof path !== "string") return "other";
  if (path === "/") return "home";
  if (path === "/leaderboard") return "leaderboard";
  if (path === "/how-to-play") return "rules";
  if (/^\/u\/[^/]+$/.test(path)) return "profile";
  if (/^\/c\/[^/]+$/.test(path)) return "challenge";
  if (/^\/vs\/[^/]+$/.test(path)) return "duel";
  return "other";
}

// Browser plus major version plus platform, and nothing else. The raw string is a fingerprint; this is what
// you would actually act on ("it only happens on Android Chrome").
function browserOf(ua: unknown): string {
  if (typeof ua !== "string" || !ua) return "unknown";
  const name = /Edg\/(\d+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)![1]}`
    : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)![1]}`
    : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)![1]}`
    : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+).*Safari/.exec(ua)![1]}`
    : "unknown";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "unknown";
  return cap(`${name} / ${os}`, MAX.browser)!;
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON" }, 400); }

  const version = cap(body?.version, MAX.version);
  const message = cap(body?.message, MAX.message);
  // The two fields without which a row says nothing. Everything else is allowed to be absent.
  if (!version || !message) return json({ error: "malformed report" }, 400);
  if (body?.before != null && !Array.isArray(body.before)) return json({ error: "malformed report" }, 400);
  if (body?.path != null && typeof body.path !== "string") return json({ error: "malformed report" }, 400);

  const before = Array.isArray(body.before)
    ? body.before.slice(0, MAX.before).map((e: any) => ({
        kind: cap(e?.kind, 40), message: cap(e?.message, MAX.entry), extra: cap(e?.extra, 120),
      }))
    : null;

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // A GLOBAL cap rather than a per-IP one. Per-IP means storing an address hash, which is the one thing the
  // rest of this design spends effort not storing. Its ceiling, and it is real: a flood fills the hour and
  // genuine crashes are dropped. The upgrade is a daily-salted IP hash - the pattern /privacy already
  // describes for the visit counter, so the policy language exists.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await service.from("client_errors").select("id", { count: "exact", head: true }).gte("created_at", since);
  if ((count ?? 0) >= RATE_PER_HOUR) return json({ ok: true, dropped: true });

  const { error } = await service.from("client_errors").insert({
    version, kind: "crash", message,
    stack: cap(body?.stack, MAX.stack),
    component: cap(body?.component, MAX.component),
    before,
    browser: browserOf(body?.ua),
    screen: screenOf(body?.path),
  });
  if (error) return json({ error: "failed to record" }, 500);

  // Opportunistic retention: no cron to schedule and nothing to forget. A table that only ever receives rows
  // is a privacy promise with a slow leak in it.
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000).toISOString();
  await service.from("client_errors").delete().lt("created_at", cutoff);

  return json({ ok: true });
});
```

- [ ] **Step 4: Register the function in both places**

Modify `supabase/config.toml` — append:

```toml
[functions.report-error]
enabled = true
# Not authenticated on purpose: a crash can happen signed out, and a guest's crash matters as much as anyone's.
verify_jwt = false
```

Modify `deploy-function.mjs:17`:

```js
const FUNCTIONS = ["submit-run", "match-pick", "submit-century", "submit-guess", "delete-account", "report-error"];
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/test-report-error-edge.mjs`
Expected: PASS, every case.

- [ ] **Step 6: Mutate to prove the tests bite**

Change `screenOf`'s final `return "other"` to `return path as string` and re-run. Expected: FAIL on "a path that only resembles a known route becomes other" — the test that stands between a username and the database.

Change `cap` to `v.slice(0, n)` and re-run. Expected: FAIL on "capping never leaves half an emoji behind". Revert both.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/report-error/index.ts supabase/config.toml deploy-function.mjs tests/test-report-error-edge.mjs
git commit -m "feat: report-error, the crash sink's only writer

It exists to scrub. error-boundary.jsx's report carries location.pathname and
/u/<name> is a username, so a report stored straight from the browser would put
a name in the database with nobody looking - and the crashed client is the last
code that should be asked to remove it.

A near-miss path becomes 'other', never itself: a default that passes the path
through is that same leak wearing a disguise. Caps are by code point, because
slicing UTF-16 can leave a lone surrogate and Postgres then refuses the whole
row - one bad report becoming zero.

Rate limiting is a global 200/hour rather than per-IP, because per-IP means
storing an address hash. Its ceiling is in the comment.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The client, and the rule that was never asserted

**Files:**
- Modify: `error-boundary.jsx` (`componentDidCatch`, plus one new function)
- Modify: `tests/test-error-boundary.mjs`

**Interfaces:**
- Consumes: `POST /functions/v1/report-error` from Task 2.
- Produces: nothing other tasks read.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test-error-boundary.mjs`, before the final `console.log`:

```js
// THE RULE THIS WHOLE FILE RESTS ON, finally asserted. It was stated in a comment above and checked by
// nothing - the exact shape CLAUDE.md records walking into three times. The reporter added in v2.21.6 sends
// a crash over the network WITHOUT importing anything, so if this ever slips the crash net gains a
// dependency on the app it is reporting on.
await runTest("error-boundary.jsx imports nothing but React", async () => {
  const src = fs.readFileSync(new URL("../error-boundary.jsx", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert(imports.length === 1 && imports[0] === "react",
    `the crash net may import react and nothing else, found: ${JSON.stringify(imports)}`);
  assert(!/\brequire\(|await import\(/.test(src), "and no dynamic import either");
});

await runTest("the reporter is inert when the build has no Supabase", async () => {
  // Every jsdom test and tools/ui-harness build with no Supabase environment, so the define is "". Without
  // the guard, every caught error in every test POSTs at a relative URL.
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...a) => { calls.push(a); return Promise.resolve({ ok: true }); };
  try {
    mod.recordError("render", new Error("no backend here"), "");
    mod.sendReport(new Error("no backend here"), { componentStack: "at App" });
  } finally { globalThis.fetch = realFetch; }
  assert(calls.length === 0, `nothing was sent: ${JSON.stringify(calls).slice(0, 200)}`);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/test-error-boundary.mjs`
Expected: FAIL — `mod.sendReport is not a function`. The import test should PASS already; that is correct and expected, because it is pinning behaviour that is true today and must stay true.

- [ ] **Step 3: Add the reporter**

In `error-boundary.jsx`, after `recordError` and before `installGlobalErrorHandlers`:

```js
// The crash sink (docs/superpowers/specs/2026-10-05-client-error-sink-design.md). Fire-and-forget: a crash
// report is worth less than anything else on this screen, so it may never delay, throw or retry.
//
// IT IMPORTS NOTHING. SUPABASE_URL and SUPABASE_ANON_KEY are esbuild defines - bare identifiers replaced at
// build time, exactly as APP_VERSION is above. That is what lets the crash net send a report over the
// network while still depending on nothing but React.
const SINK = typeof SUPABASE_URL !== "undefined" ? SUPABASE_URL : "";
const SINK_KEY = typeof SUPABASE_ANON_KEY !== "undefined" ? SUPABASE_ANON_KEY : "";

export function sendReport(err, info) {
  // The tests and tools/ui-harness build with no Supabase environment. Without this the suite POSTs at a
  // relative URL on every caught error.
  if (!SINK || !SINK_KEY) return;
  const { message, stack } = describeError(err);
  try {
    fetch(SINK + "/functions/v1/report-error", {
      method: "POST",
      // A crash is frequently followed by the tab closing. Without keepalive the request dies with the page,
      // and the reports lost are the ones from the most annoyed strangers - who are the whole point.
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: SINK_KEY },
      body: JSON.stringify({
        version: VERSION,
        message,
        stack: stack.split("\n").slice(0, 6).join("\n"),
        component: info && info.componentStack ? info.componentStack.split("\n").slice(0, 6).join("\n") : "",
        before: recent.slice(-5).map((r) => ({ kind: r.kind, message: r.message, extra: r.extra })),
        ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
        path: typeof location !== "undefined" ? location.pathname : "",
      }),
    }).catch(() => {});
  } catch (e) {
    // The one thing worse than losing a report is the crash net crashing.
  }
}
```

Then in `componentDidCatch`, after the existing `recordError` call:

```js
    recordError("render", err, "");
    sendReport(err, info);
```

- [ ] **Step 4: Run to verify they pass**

Run: `node tests/test-error-boundary.mjs`
Expected: PASS, both new tests and all existing ones.

- [ ] **Step 5: Verify the whole suite still passes**

Run: `node tests/run-all.mjs`
Expected: all files pass. This step exists because `sendReport` is called on every caught render error in every jsdom test — if the guard in step 3 is wrong, this is where it shows.

- [ ] **Step 6: Mutate to prove the tests bite**

Add `import { PALETTE } from "./theme.mjs";` to the top of `error-boundary.jsx` and re-run `node tests/test-error-boundary.mjs`. Expected: FAIL on "imports nothing but React". Revert.

Change `if (!SINK || !SINK_KEY) return;` to `if (false) return;` and re-run. Expected: FAIL on "the reporter is inert". Revert.

- [ ] **Step 7: Commit**

```bash
git add error-boundary.jsx tests/test-error-boundary.mjs
git commit -m "feat: the crash net reports, and its central rule is finally asserted

A fire-and-forget keepalive POST from componentDidCatch. keepalive matters: a
crash is frequently followed by the tab closing, and the reports lost without
it are the ones from the most annoyed strangers.

It imports nothing - SUPABASE_URL and SUPABASE_ANON_KEY are esbuild defines,
the same mechanism APP_VERSION already uses here. That rule is what makes the
crash net work when the app it reports on did not, and until now it was stated
in a comment and checked by nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The promise it costs

**Files:**
- Modify: `site-pages.mjs` (`PRIVACY_SECTIONS`, the privacy page's `intro[0]`, and its `description`)
- Modify: `tests/test-site-pages.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Add to `tests/test-site-pages.mjs`:

```js
// v2.21.0 is the precedent and the warning. When the visit counter landed, exactly three places had to
// change - the section, the LEDE and the meta description - and the first test read only page.sections, so
// it passed while the top of the page said the opposite of the middle. All three are read here.
await runTest("the privacy page accounts for the crash sink in all three places", async () => {
  const page = SITE_PAGES.find((p) => p.id === "privacy");
  const whole = [page.description, ...page.intro, ...page.sections.flatMap((s) => [s.heading, ...s.body])].join("\n");
  assert(/crash/i.test(page.sections.flatMap((s) => s.body).join("\n")), "a section describes it");
  assert(/crash/i.test(page.intro.join("\n")), "the lede does not pretend it is the only thing collected");
  assert(/crash/i.test(page.description), "and neither does the meta description");
  // The claim that stopped being true the moment a second thing collected.
  assert(!/the one thing that counts visits/i.test(whole),
    "nothing still calls the counter 'the one thing'");
  // The promise that must survive: a report carries no name.
  assert(/never your name|not your name|no name/i.test(whole), "it says a report carries no name");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/test-site-pages.mjs`
Expected: FAIL on "a section describes it".

- [ ] **Step 3: Change all three places**

In `site-pages.mjs`, add to `PRIVACY_SECTIONS` (in the section that covers what is collected):

```js
    "If the game crashes, your browser sends a report so the crash can be found and fixed. It carries the version of the game, the error and where in the code it happened, which screen you were on and which browser you are using - never your name, your account, your email or your address. The screen is a name like 'profile', not the address you were at, so a report from a profile page cannot say whose. Reports are deleted after 90 days.",
```

Change the privacy page's `intro[0]` (the lede), replacing *"the one thing that counts visits sets no cookie and cannot follow you off the site"*:

```js
      "Gridspin is a free football game. It keeps as little about you as it can: an email address if you want an account, the name you pick, and the seasons you play. There are no adverts and no trackers, nothing is sold or handed to anyone else, and the two things it does record - a visit counter and a crash report - set no cookie, carry no name, and cannot follow you off the site.",
```

Change its `description`:

```js
    description: "What Gridspin records, what other players can see, where it is kept, and how to have an account and its data deleted. A visit counter and crash reports, both nameless. No adverts, no trackers, nothing sold.",
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/test-site-pages.mjs && node tests/test-build-seo.mjs`
Expected: both PASS. `test-build-seo.mjs` builds the real pages, so it catches a `description` that broke a meta tag.

- [ ] **Step 5: Mutate to prove the test bites**

Revert only the lede change and re-run `node tests/test-site-pages.mjs`. Expected: FAIL on "the lede does not pretend it is the only thing collected" — which is precisely the v2.21.0 bug reproduced. Restore.

- [ ] **Step 6: Commit**

```bash
git add site-pages.mjs tests/test-site-pages.mjs
git commit -m "docs: /privacy says the crash sink exists, in all three places

The lede said 'the one thing that counts visits'. It is two things now. When
the visit counter landed in v2.21.0 exactly three places had to change - the
section, the lede and the meta description - and the first test read only
page.sections, so it passed while the top of the page contradicted the middle.
This test reads all three.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The runbook, the release, and the docs

**Files:**
- Create: `supabase/query-client-errors.sql`
- Modify: `CHANGELOG.md`, `package.json`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: a released version.

- [ ] **Step 1: Write the runbook query**

Create `supabase/query-client-errors.sql`:

```sql
-- The crash log. Paste into the Supabase SQL editor (Dashboard > SQL Editor) for whichever project you want
-- to look at - staging ndelisxdxjmvcdezzecu, production aqbajvwwvvbrklolbcen.
--
-- THIS IS A RUNBOOK QUERY, NOT A FEATURE, for the same reason query-play-log.sql is one: running it needs a
-- dashboard login, so it is visible to the owner and nobody else, and it adds no surface to the app that
-- could leak later. Unlike that one, these rows are NOT public - client_errors has RLS on with no policy at
-- all, so nothing but the service role can read them.
--
-- The stack is minified. `version` is what makes it readable: check out that tag and the frame numbers line
-- up with the bundle the player was running.
select to_char(created_at at time zone 'UTC', 'MM-DD HH24:MI') as at,
       version, screen, browser, message,
       jsonb_array_length(coalesce(before, '[]'::jsonb)) as led_up_to
  from public.client_errors
 order by created_at desc
 limit 100;

-- Which release, which screen - the shape worth looking at before any single row.
--     select version, screen, count(*) from public.client_errors group by 1, 2 order by 3 desc;
--
-- One crash in full, the ring included. The ring is usually where the answer is: a crash is normally the
-- SECOND failure.
--     select * from public.client_errors where id = 123;
```

- [ ] **Step 2: Bump the version and write the changelog**

`package.json`: `2.21.5` → `2.22.0` (a feature, so minor).

Add to `CHANGELOG.md` under a new `## [2.22.0] - <today>` heading, `### Added`, covering: what it is; that it is automatic and why (the people worth hearing from close the tab); the pathname finding from the spec's §2; that the scrub lives in the function because a crashed client cannot scrub itself; the `/privacy` change; and the ceilings from §9.

- [ ] **Step 3: Add the release steps to CLAUDE.md**

In the Releasing section, above `v2.21.0's`:

```
  v2.22.0's (the crash sink): run **`migration-client-errors.sql`**, then **deploy the Edge Functions**
  (`node deploy-function.mjs <env>` now deploys SIX), then the client. The order is not optional: a client
  ahead of the function POSTs at a 404 and silently drops every report, which is invisible and looks exactly
  like "no crashes". The other direction is harmless - a deployed function with no client sends it nothing.
```

Also update the crash net's paragraph, which currently ends *"A first-party sink ... is the obvious next step"* — it is no longer next, it is built.

- [ ] **Step 4: Run the whole suite**

Run: `node tests/run-all.mjs`
Expected: every file passes, including the three new ones.

- [ ] **Step 5: Commit and tag**

```bash
git add -A
git commit -m "2.22.0: crashes players never report now report themselves

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git tag v2.22.0
```

- [ ] **Step 6: Deploy to staging, in order, and verify there**

```bash
# 1. the migration, in the staging SQL editor: supabase/migration-client-errors.sql
# 2. then the functions
npm run deploy:fn:staging
# 3. then push, which redeploys the staging client
git push origin staging
```

Then on the staging site, open the browser console and run `throw new Error("sink check")` inside a render — or use the admin account's forced-crash path if one exists — and confirm a row appears via `supabase/query-client-errors.sql` with `screen` set and no name anywhere in it.

**Do not promote to `master` until that row has been seen on staging.** `/privacy` is a live legal page and this release changes it.

---

## Self-Review

**Spec coverage.** §1 intent → Task 5's changelog. §2 findings → Task 2 (scrub) and Task 3 (import assertion). §3 table → Task 1. §4.1 client → Task 3. §4.2 function → Task 2. §5 abuse → Task 2, step 3. §6 retention → Task 2, step 3. §7 reading → Task 5 step 1; §7 privacy → Task 4. §8 checks 1–9 → checks 1, 8 in Task 3; 2, 3, 4, 5 in Task 2; 6, 7 in Task 1; 9 in Task 4. §9 ceilings → comments in Task 2's function and the changelog. §10 order → Task 5 step 6. **No gaps.**

**Placeholders.** None: every code step carries the code, every test step the assertions, every run step the command and the expected result.

**Type consistency.** The client sends `{version, message, stack, component, before, ua, path}` (Task 3) and the function reads exactly those names (Task 2). The function writes `{version, kind, message, stack, component, before, browser, screen}` and the table has exactly those columns plus `id`/`created_at` (Task 1). `sendReport(err, info)` is exported in Task 3 and called by name in Task 3's test.

**Review Focus coverage.** (1) megabyte message → Task 2 "a megabyte message is capped". (2) malformed body → Task 2 "a malformed body is a 400". (3) near-miss path → Task 2 "a path that only resembles a known route". (4) split surrogate → Task 2 "capping never leaves half an emoji behind". (5) no Supabase in the build → Task 3 "the reporter is inert". All five have a test in the task that owns the code.
