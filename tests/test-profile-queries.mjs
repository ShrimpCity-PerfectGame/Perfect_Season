// fetchSiteTotals and fetchOwnRank run on every home/leaderboard load. Both used to download every
// column of every profile (an unfiltered select("*")). This pins that totals are summed in the
// database (site_totals()) and rank is a server-side count, and that the numbers are unchanged.
import { makeMockAuth } from "./helpers.mjs";
import { fetchSiteTotals, fetchOwnRank, fetchSiteStats } from "../storage.js";

let failed = 0;
const assert = (cond, msg) => { if (!cond) { failed++; console.error("FAIL:", msg); } };

const mock = makeMockAuth();
const selects = [];
const realFrom = mock.from;
mock.from = (table) => {
  const t = realFrom(table);
  const realSelect = t.select;
  return { ...t, select: (cols, opts) => { selects.push({ table, cols, opts }); return realSelect(cols, opts); } };
};
globalThis.window = { __ps_supabase__: mock };

const rows = [
  { id: "a", username: "a", runs: 5, dnf: 1, perfect: 1, best_score: 110, best_score_std: 90 },
  { id: "b", username: "b", runs: 3, dnf: 0, perfect: 0, best_score: 95 },
  { id: "c", username: "c", runs: 0, dnf: 2, perfect: 0 },
];
for (const r of rows) await realFrom("profiles").insert(r);

selects.length = 0;
const totals = await fetchSiteTotals();
assert(totals.runs === 11 && totals.perfect === 1 && totals.players === 3, `site totals wrong: ${JSON.stringify(totals)}`);
assert(selects.length === 0, "fetchSiteTotals must not select from profiles at all - it calls site_totals(), got: " + JSON.stringify(selects));

selects.length = 0;
assert(await fetchOwnRank(100) === 1, "one fantasy score above 100");
assert(await fetchOwnRank(90) === 2, "two fantasy scores above 90");
assert(await fetchOwnRank(110) === 0, "a tie isn't strictly above");
assert(await fetchOwnRank(80, "standard") === 1, "standard ranks on its own column");
assert(selects.every((s) => s.opts?.head && s.opts?.count), "fetchOwnRank must count server-side, not download rows");

// Read-only RPCs must go out as GET: supabase-js only retries a dropped request when it's a GET/HEAD,
// and these two failing unretried (as POSTs) is what showed "0 drafts" on a flaky load.
const realRpc = mock.rpc;
const rpcCalls = [];
mock.rpc = (name, args, opts) => { rpcCalls.push({ name, opts }); return realRpc(name, args, opts); };
await fetchSiteTotals();
await fetchSiteStats();
mock.rpc = realRpc;
for (const name of ["site_totals", "site_stats"]) {
  const call = rpcCalls.find((c) => c.name === name);
  assert(call?.opts?.get === true, `${name} must be called with { get: true } so a dropped request is retried, got ${JSON.stringify(call?.opts)}`);
}

// A failed request is "unknown", not zero - the home pill would otherwise read "0 drafts".
mock.rpc = () => Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } });
assert(await fetchSiteTotals() === null, "a failed site_totals request should come back null, not zeros");
mock.rpc = realRpc;
// Same for a rank: a failed count read as 0 players above would show a profile as #1 sitewide.
const failingCount = { select: () => ({ gt: () => Promise.resolve({ count: null, error: { message: "TypeError: Failed to fetch" } }) }) };
mock.from = () => failingCount;
assert(await fetchOwnRank(100) === null, "a failed rank count should come back null, not 0");
mock.from = () => { throw new Error("offline"); };
assert(await fetchOwnRank(100) === null, "a rank count that throws should come back null too");

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("test-profile-queries.mjs done");
