// The REAL supabase/functions/submit-run/index.ts, executed.
//
// Until 2.0 neither Edge Function was run by anything: this one's behaviour was held entirely by assertions
// that read its source as text, and §3.6 of the release sweep priced what that is worth. The compare-and-set
// that stops a finished season being overwritten by the DNF "Run it back" fires was guarded by an assertion
// that only required `ok: true` to sit behind an `if` *mentioning* the name the update's rows are bound to.
// So `if (written)` passed — and PostgREST answers a zero-row update with `data: []`, which is truthy, so a
// lost update would have answered `ok: true`. `if (written.length >= 0)` passed. Cutting the retry loop to a
// single attempt passed. Rewriting `for` as `while` — which changes nothing — failed.
//
// This drives it instead. tests/edge-harness.mjs bundles the function and stubs only Deno and the query shapes
// it uses; every decision below is the shipped code, including game-logic.mjs's applyRun/applyDnf.
import { assert, runTest } from "./helpers.mjs";
import { loadEdgeFunction } from "./edge-harness.mjs";
import * as GL from "../game-logic.mjs";

const { invoke } = await loadEdgeFunction("submit-run");

const ME = "11111111-1111-4111-8111-111111111111";

// Only what the DNF path touches: it is the shortest way into applyToProfile, and it is also the request that
// caused the bug in the first place - "Run it back" fires a DNF as its own request, with no replay, no sim and
// no botPar to slow it down, so it reads first and writes last.
function store({ rev = 0 } = {}) {
  const profiles = new Map([[ME, {
    id: ME, username: "someone", rev,
    runs: 4, dnf: 1, wins: 30, losses: 38, champs: 0, perfect: 0, playoffs: 1,
    best_score: 91.2, best_run: null, best_record: null, best_score_std: null, best_run_std: null,
    points_daily: 0, points_unlimited: 120, points_genius: 0, points_gm: 0,
    points_bank: 120, points_day: null, recent: [],
    daily_streak: 0, daily_last: null, daily_best_streak: 0,
  }]]);
  const runs = [];
  return {
    users: { has: (id) => profiles.has(id) },
    readFails: {}, writeFails: {}, rpcFails: {}, beforeWrite: null, rpcCalls: [],
    profiles, runs,
    rowsOf: (table) => (table === "profiles" ? [...profiles.values()] : table === "runs" ? runs : []),
    insert(table, row) { if (table === "runs") runs.push(row); return { row }; },
    remove() {},
    rpcs: {},
  };
}
const me = (s) => s.profiles.get(ME);

await runTest("a DNF goes through the real function and lands on the profile", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const before = { dnf: me(s).dnf, rev: me(s).rev };
  const res = await invoke({ dnf: true, picks: 3, mode: "unlimited" }, { userId: ME });
  assert(res.status === 200 && res.body?.ok, `it saves: ${res.status} ${JSON.stringify(res.body)}`);
  assert(me(s).dnf === before.dnf + 1, `one more DNF: ${me(s).dnf}`);
  assert(me(s).rev === before.rev + 1, `and the revision moved: ${me(s).rev}`);
  assert(s.runs.length === 1 && s.runs[0].dnf === true, `and it is in the runs log: ${JSON.stringify(s.runs)}`);
});

await runTest("a write that matched no row is retried, never reported as saved", async () => {
  // THE bug §3.6 is about, driven rather than read. Something else writes the profile between this request's
  // read and its write - which is not exotic: finish() does not await the submission, so the result screen is
  // live while a season is still in flight and "Run it back" fires its DNF straight into that window. The
  // update then matches nothing. Answering ok there is what lost a season while finished_codes kept the code
  // and the ledger kept the coins, so the retry said "already recorded" and a personal best was unrecoverable.
  const s = store();
  globalThis.__edge_store__ = s;
  let raced = 0;
  s.beforeWrite = (table, mode) => {
    // Once only: somebody else's write lands, taking the revision with it. The retry must then see it.
    if (table !== "profiles" || mode !== "update" || raced++) return;
    Object.assign(me(s), { rev: me(s).rev + 1, wins: me(s).wins + 7 });
  };
  const res = await invoke({ dnf: true, picks: 2, mode: "unlimited" }, { userId: ME });
  s.beforeWrite = null;
  assert(res.status === 200 && res.body?.ok, `the request still succeeds - by retrying: ${res.status} ${JSON.stringify(res.body)}`);
  assert(me(s).dnf === 2, `the DNF counted exactly once: ${me(s).dnf}`);
  // And on top of the other write, not instead of it. This is the whole point of re-reading rather than
  // re-sending: the seven wins that landed in the window are still there.
  assert(me(s).wins === 37, `the other write survived: ${me(s).wins}`);
  assert(me(s).rev === 2, `two writes, two revisions: ${me(s).rev}`);
});

await runTest("a write that can never land is a failure, not a success", async () => {
  // The same window, forever - which is what a genuinely contended row looks like. It must run out of
  // attempts and say so; answering ok would be the lost update with extra steps.
  const s = store();
  globalThis.__edge_store__ = s;
  s.beforeWrite = (table, mode) => {
    if (table === "profiles" && mode === "update") me(s).rev += 1;
  };
  const res = await invoke({ dnf: true, picks: 1, mode: "unlimited" }, { userId: ME });
  s.beforeWrite = null;
  assert(res.status === 500, `it fails rather than claiming to have saved: ${res.status} ${JSON.stringify(res.body)}`);
  assert(me(s).dnf === 1, `and nothing was applied: ${me(s).dnf}`);
  assert(s.runs.length === 0, "nor logged");
});

await runTest("it tries more than once, and gives up rather than spinning", async () => {
  // Both halves matter. One attempt is not a retry loop - the sweep's `attempt < 1` passed the old assertion -
  // and no limit is a request that never returns.
  const s = store();
  globalThis.__edge_store__ = s;
  let writes = 0;
  s.beforeWrite = (table, mode) => {
    if (table !== "profiles" || mode !== "update") return;
    writes += 1;
    if (writes < 3) me(s).rev += 1; // the first two attempts lose the race, the third lands
  };
  const res = await invoke({ dnf: true, picks: 1, mode: "unlimited" }, { userId: ME });
  assert(res.status === 200 && res.body?.ok, `it keeps trying: ${res.status} after ${writes} attempts`);
  assert(writes === 3, `three attempts, not one: ${writes}`);

  const s2 = store();
  globalThis.__edge_store__ = s2;
  let tries = 0;
  s2.beforeWrite = (table, mode) => { if (table === "profiles" && mode === "update") { tries += 1; s2.profiles.get(ME).rev += 1; } };
  await invoke({ dnf: true, picks: 1, mode: "unlimited" }, { userId: ME });
  assert(tries > 1 && tries <= 10, `and stops: ${tries} attempts before giving up`);
});

await runTest("an account with no profile is told so, and a failed read is not that", async () => {
  // The distinction the client half of this release is built on, on the server side of it: "the read failed"
  // and "this account has no profile" are different answers, and only one of them is the player's problem.
  const s = store();
  globalThis.__edge_store__ = s;
  s.profiles.delete(ME);
  s.users = { has: () => true };
  const none = await invoke({ dnf: true, picks: 1, mode: "unlimited" }, { userId: ME });
  assert(none.status === 400 && /no profile/.test(JSON.stringify(none.body)), `no profile: ${none.status} ${JSON.stringify(none.body)}`);

  const s2 = store();
  globalThis.__edge_store__ = s2;
  s2.readFails.profiles = true;
  const dropped = await invoke({ dnf: true, picks: 1, mode: "unlimited" }, { userId: ME });
  // Known gap, priced rather than asserted away: index.ts discards the read's error, so a dropped read still
  // reads as "no profile for this account". 2.0-STATUS.md §4 carries it. This test says what it does today, so
  // that whoever closes it sees this line go red and updates it deliberately.
  assert(dropped.status === 400, `a dropped read currently answers ${dropped.status} ${JSON.stringify(dropped.body)} - see 2.0-STATUS.md §4`);
  assert(s2.profiles.get(ME).dnf === 1, "and either way nothing was written");
});

await runTest("every answer carries the CORS headers, the refusals included", async () => {
  // A headerless response reaches the browser as a network failure, so a refusal worded carefully arrives as
  // "couldn't reach the server" - which is what the wrapper exists to prevent.
  const s = store();
  globalThis.__edge_store__ = s;
  const preflight = await invoke(null, { method: "OPTIONS" });
  assert(preflight.headers.get("access-control-allow-origin"), "the preflight is answered");
  for (const [label, res] of [
    ["signed out", await invoke({ dnf: true })],
    ["a GET", await invoke(null, { userId: ME, method: "GET" })],
    ["a malformed submission", await invoke({ mode: null }, { userId: ME })],
    ["an unknown format", await invoke({ mode: { kind: "free", code: "ABCDEF" }, history: [], seq: [], format: "halfppr" }, { userId: ME })],
  ]) {
    assert(res.status >= 400, `${label} is refused: ${res.status}`);
    assert(res.headers.get("access-control-allow-origin"), `${label} still carries CORS`);
  }
});

console.log("test-submit-run-edge.mjs done");
