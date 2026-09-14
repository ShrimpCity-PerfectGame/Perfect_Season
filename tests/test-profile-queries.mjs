// fetchSiteTotals and fetchOwnRank run on every home/leaderboard load. Both used to download every
// column of every profile (an unfiltered select("*")). This pins that totals are summed in the
// database (site_totals()) and rank is a server-side count, and that the numbers are unchanged.
import { makeMockAuth } from "./helpers.mjs";
import { fetchSiteTotals, fetchOwnRank } from "../storage.js";

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

// A failed request is "unknown", not zero - the home pill would otherwise read "0 drafts".
const realRpc = mock.rpc;
let calls = 0;
mock.rpc = (name, args) => { calls++; return Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } }); };
assert(await fetchSiteTotals() === null, "a failed site_totals request should come back null, not zeros");
assert(calls === 2, "a failed site_totals request should be retried once, got " + calls + " calls");
calls = 0;
mock.rpc = (name, args) => (++calls === 1 ? Promise.resolve({ data: null, error: { message: "stalled" } }) : realRpc(name, args));
const retried = await fetchSiteTotals();
assert(retried && retried.players === 3, "a request that fails once should succeed on the retry, got " + JSON.stringify(retried));
mock.rpc = realRpc;

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("test-profile-queries.mjs done");
