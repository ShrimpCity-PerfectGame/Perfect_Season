// fetchSiteTotals and fetchOwnRank run on every home/leaderboard load. Both used to download every
// column of every profile (an unfiltered select("*")). This pins that totals are summed in the
// database (site_totals()) and rank is a server-side count, and that the numbers are unchanged.
import { makeMockAuth } from "./helpers.mjs";
import { readFileSync } from "node:fs";
import { fetchSiteTotals, fetchOwnRank, fetchSiteStats, fetchTopBuilds, fetchLadderBest } from "../storage.js";

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
// The per-mode score board is read-only too, and it is fetched every time somebody taps a mode.
await fetchLadderBest("gm", "fantasy", 10);
mock.rpc = realRpc;
for (const name of ["site_totals", "site_stats", "ladder_best"]) {
  const call = rpcCalls.find((c) => c.name === name);
  assert(call?.opts?.get === true, `${name} must be called with { get: true } so a dropped request is retried, got ${JSON.stringify(call?.opts)}`);
}

// A failed request is "unknown", not zero - the home pill would otherwise read "0 drafts".
mock.rpc = () => Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } });
assert(await fetchSiteTotals() === null, "a failed site_totals request should come back null, not zeros");
mock.rpc = realRpc;
// Old browser-written builds can hold a NaN overall (sent as the string "NaN") or a made-up position; a
// string overall crashed the whole Stats screen. Only finite numbers at real positions come back.
const realBuilds = mock._builds;
realBuilds.set("b1", { id: "b1", username: "a", pos: "WR", overall: 120.5, filled: {} });
realBuilds.set("b2", { id: "b2", username: "b", pos: "QB", overall: "NaN", filled: {} });
realBuilds.set("b3", { id: "b3", username: "c", pos: "<b>K</b>", overall: 99, filled: {} });
realBuilds.set("b4", { id: "b4", username: "a", pos: "TE", overall: "101.25", filled: {} });
const topBuilds = await fetchTopBuilds(10);
assert(topBuilds.length === 2 && topBuilds.every((b) => typeof b.overall === "number" && Number.isFinite(b.overall)), `only finite builds at real positions, as numbers: ${JSON.stringify(topBuilds)}`);
realBuilds.clear();

// Same for a rank: a failed count read as 0 players above would show a profile as #1 sitewide.
const failingCount = { select: () => ({ gt: () => Promise.resolve({ count: null, error: { message: "TypeError: Failed to fetch" } }) }) };
mock.from = () => failingCount;
assert(await fetchOwnRank(100) === null, "a failed rank count should come back null, not 0");
mock.from = () => { throw new Error("offline"); };
assert(await fetchOwnRank(100) === null, "a rank count that throws should come back null too");

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log("test-profile-queries.mjs done");

// Two rows on the same number come back in whatever order the database felt like, so the one that drops off
// the bottom of the top ten changes on every refresh. Every ordering in the Stats SQL was given a tiebreak for
// this; the five in storage.js were a separate sweep and it reached one of them. Worst is Over/Under - small
// integer scores over one shared round sequence, so ties at the rank-10 cut are the ordinary case rather than
// a coincidence, and rows genuinely appear and disappear between refreshes.
{
  const src = readFileSync(new URL("../storage.js", import.meta.url), "utf8");
  for (const fn of ["fetchLeaderboardTop", "fetchLadderTop", "fetchDailyTop", "fetchSouTop", "fetchTopBuilds"]) {
    const at = src.indexOf(`export async function ${fn}(`);
    assert(at > 0, `${fn} is where it was`);
    const next = src.indexOf("export async function", at + 1);
    const fnBody = src.slice(at, next < 0 ? src.length : next);
    // The column can be a variable (bestCol's, the ladder's), so this counts orderings rather than names -
    // and requires the LAST one to be the literal username tiebreak.
    const orders = [...fnBody.matchAll(/\.order\(([^,)]+)/g)].map((m) => m[1].trim().replace(/^"|"$/g, ""));
    assert(orders.length >= 2 && orders[orders.length - 1] === "username",
      `${fn} is tiebroken on username, or its rows swap places between refreshes: ${JSON.stringify(orders)}`);
  }
}
