// The crash sink's function, EXECUTED - the repo's rule, and CLAUDE.md says why: the first real run of
// match-pick found a ReferenceError no string assertion could have caught.
//
// What this holds, and why each one is here rather than being obvious:
//   - The path is scrubbed to a screen name. error-boundary.jsx sends location.pathname, and /u/<name> IS a
//     username; this function is the only place it is removed. A near-miss path that fell through to itself
//     would be that same leak wearing a disguise, which is why the near-miss cases outnumber the happy ones.
//   - The caps apply BEFORE the insert, including on a string whose cap lands inside an emoji. A lone
//     surrogate is invalid UTF-8 and Postgres refuses the whole row - one bad report becoming zero.
//   - A malformed body is a 400, never a 500 and never a partial row.
//
//   node tests/test-report-error-edge.mjs
import { loadEdgeFunction } from "./edge-harness.mjs";
import { assert, runTest } from "./helpers.mjs";

const { invoke } = await loadEdgeFunction("report-error");

// The store the stub writes through. `removed` records the retention delete's range so a test can see it
// happened at all - a delete nobody observes is a delete that may not be running.
function store() {
  const rows = { client_errors: [] };
  return {
    users: new Map(),
    rowsOf: (t) => rows[t] || [],
    insert: (t, row) => { (rows[t] ||= []).push(row); return { data: [row], error: null }; },
    remove: (t, filters, ranges) => {
      (rows.__removed ||= []).push({ t, filters, ranges });
      // Actually apply it. A no-op remove cannot show that a full table heals itself, which is the
      // whole question the dead-end tests below ask.
      for (const [col, op, val] of ranges || []) {
        rows[t] = (rows[t] || []).filter((r) => (op === "lt" ? !(r[col] < val) : !(r[col] >= val)));
      }
    },
    rpcs: {},
    _rows: rows,
    _removed: () => rows.__removed || [],
  };
}

const ok = { version: "2.21.5", message: "boom", stack: "at x", component: "at App", before: [], ua: "", path: "/" };

// One report in, one row out - the shape every other test here reads.
async function send(body, opts) {
  const s = store();
  globalThis.__edge_store__ = s;
  const res = await invoke(body, opts);
  return { s, res, row: s._rows.client_errors[0] };
}

await runTest("a profile path is stored as a screen name, and the username is nowhere", async () => {
  const { res, row } = await send({ ...ok, path: "/u/ShrimpCity" });
  assert(res.status === 200, `accepted: ${res.status} ${JSON.stringify(res.body)}`);
  assert(row.screen === "profile", `screen is a name, not a path: ${row.screen}`);
  assert(!JSON.stringify(row).includes("ShrimpCity"), `the name is nowhere in the row: ${JSON.stringify(row)}`);
});

await runTest("a path that only resembles a known route becomes other", async () => {
  // Every one of these would have leaked a name, a code, or a shape of the address under a scrub that
  // passed anything it did not recognise straight through.
  for (const path of ["/u", "/u/", "/uu/ShrimpCity", "//u/ShrimpCity", "/u/ShrimpCity/extra", "/nope",
                      "/U/ShrimpCity", "/u/ShrimpCity?tab=badges", "/leaderboard/extra", ""]) {
    const { row } = await send({ ...ok, path });
    assert(row.screen === "other", `${JSON.stringify(path)} -> other, got ${row.screen}`);
    assert(!JSON.stringify(row).includes("ShrimpCity"), `and never the name: ${JSON.stringify(path)}`);
  }
});

await runTest("every known route maps to its own name", async () => {
  for (const [path, screen] of [["/", "home"], ["/c/ABC123", "challenge"], ["/vs/ABC123", "duel"],
                                ["/leaderboard", "leaderboard"], ["/how-to-play", "rules"]]) {
    const { row } = await send({ ...ok, path });
    assert(row.screen === screen, `${path} -> ${screen}, got ${row.screen}`);
  }
});

await runTest("a challenge code is not kept either", async () => {
  // It is not personal, but it is a fingerprint, and the spec drops exact paths rather than reasoning case
  // by case about which ones are safe.
  const { row } = await send({ ...ok, path: "/c/DJK5ZK" });
  assert(row.screen === "challenge" && !JSON.stringify(row).includes("DJK5ZK"), `no code: ${JSON.stringify(row)}`);
});

await runTest("the user-agent is reduced, never stored raw", async () => {
  const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36";
  const { row } = await send({ ...ok, ua });
  assert(!row.browser.includes("AppleWebKit"), `reduced, not raw: ${row.browser}`);
  assert(/Chrome/.test(row.browser) && /Android/.test(row.browser), `but still useful: ${row.browser}`);
  assert(row.browser.length <= 80, `and bounded: ${row.browser.length}`);
});

await runTest("an unreadable user-agent is unknown rather than absent", async () => {
  for (const ua of ["", "   ", "a pile of nonsense", undefined]) {
    const { row } = await send({ ...ok, ua });
    assert(typeof row.browser === "string" && row.browser.length > 0, `always a string: ${JSON.stringify(row.browser)}`);
  }
});

await runTest("a megabyte message is capped before the insert", async () => {
  const { row } = await send({ ...ok, message: "x".repeat(1_000_000), stack: "y".repeat(50_000), component: "z".repeat(50_000) });
  assert(row.message.length <= 500, `message capped: ${row.message.length}`);
  assert(row.stack.length <= 2000, `stack capped: ${row.stack.length}`);
  assert(row.component.length <= 1000, `component capped: ${row.component.length}`);
});

await runTest("capping never leaves half an emoji behind", async () => {
  // A lone surrogate is invalid UTF-8; Postgres refuses the whole row, so a naive slice turns one bad crash
  // report into zero crash reports.
  const { row } = await send({ ...ok, message: "a".repeat(499) + "\u{1F4A5}" + "b".repeat(100) });
  // isWellFormed() is the exact question: does this string contain an UNPAIRED surrogate. A regex over
  // \uD800-\uDFFF cannot ask it - a complete pair is two chars in that range, so an intact emoji trips it.
  assert(row.message.isWellFormed(), `no lone surrogate survived: ${JSON.stringify(row.message.slice(-4))}`);
  assert(row.message.endsWith("\u{1F4A5}"), `and the emoji is whole: ${JSON.stringify(row.message.slice(-4))}`);
  assert([...row.message].length <= 500, `and still within the cap: ${[...row.message].length} code points`);
});

await runTest("the ring is capped in both directions", async () => {
  const before = Array.from({ length: 50 }, (_, i) => ({ kind: "err", message: "m".repeat(5000), extra: `${i}` }));
  const { row } = await send({ ...ok, before });
  assert(row.before.length === 5, `five entries: ${row.before.length}`);
  for (const e of row.before) assert(e.message.length <= 300, `each message bounded: ${e.message.length}`);
});

await runTest("a malformed body is a 400, and writes nothing", async () => {
  for (const body of [{}, { version: "x" }, { message: "y" }, { ...ok, before: "not an array" },
                      { ...ok, path: 7 }, { ...ok, message: "" }, { ...ok, version: "" }]) {
    const { s, res } = await send(body);
    assert(res.status === 400, `400 for ${JSON.stringify(body).slice(0, 60)}: got ${res.status}`);
    assert(s._rows.client_errors.length === 0, `and nothing written for ${JSON.stringify(body).slice(0, 40)}`);
  }
});

await runTest("a GET is refused and a preflight is answered", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const get = await invoke(null, { method: "GET" });
  assert(get.status === 405, `GET is 405: ${get.status}`);
  const pre = await invoke(null, { method: "OPTIONS" });
  assert(pre.status === 200 && pre.headers.get("Access-Control-Allow-Origin"),
    `the preflight carries CORS: ${pre.status}`);
});

await runTest("no row carries an address, an account or a name", async () => {
  const { s } = await send({ ...ok, path: "/u/ShrimpCity" }, { headers: { "x-forwarded-for": "203.0.113.9" } });
  const row = JSON.stringify(s._rows.client_errors[0]);
  for (const leak of ["203.0.113.9", "ShrimpCity", "user_id", "username", "\"ip\""]) {
    assert(!row.includes(leak), `the row carries no ${leak}: ${row}`);
  }
});

await runTest("the hour's cap drops a report rather than failing it", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  // 200 already this hour. The 201st is answered ok - the browser is not told its crash was rejected,
  // because there is nothing it could do about that and nothing it should retry.
  const now = Date.now();
  for (let i = 0; i < 200; i++) s._rows.client_errors.push({ created_at: new Date(now - 1000).toISOString() });
  const res = await invoke(ok);
  assert(res.status === 200 && res.body?.dropped === true, `dropped, not failed: ${res.status} ${JSON.stringify(res.body)}`);
  assert(s._rows.client_errors.length === 200, `and nothing was added: ${s._rows.client_errors.length}`);
});

await runTest("rows outside the hour do not count toward the cap", async () => {
  const s = store();
  globalThis.__edge_store__ = s;
  const old = new Date(Date.now() - 2 * 3600_000).toISOString();
  for (let i = 0; i < 500; i++) s._rows.client_errors.push({ created_at: old });
  const res = await invoke(ok);
  assert(res.status === 200 && !res.body?.dropped, `an old flood does not block today: ${JSON.stringify(res.body)}`);
  assert(s._rows.client_errors.length === 501, "the report was written");
});

await runTest("the insert also prunes anything older than 90 days", async () => {
  const { s } = await send(ok);
  const del = s._removed().find((d) => d.t === "client_errors");
  assert(del, "a delete was issued");
  const [[col, op, val]] = del.ranges;
  assert(col === "created_at" && op === "lt", `on created_at, less-than: ${col} ${op}`);
  const days = (Date.now() - Date.parse(val)) / 86400_000;
  assert(days > 89 && days < 91, `about 90 days ago: ${days.toFixed(1)}`);
});

await runTest("a total-rows ceiling stops the table eating the project's disk", async () => {
  // The hourly cap bounds how FAST this grows and says nothing about how BIG it gets. 200/hr across the
  // 90-day window is 432,000 rows, and a row can reach ~23 KB because the caps count code points while the
  // column checks count characters. A full Supabase project goes read-only, which stops the whole game -
  // so the crash sink would have been able to take the site down. Found in the final review.
  const s = store();
  globalThis.__edge_store__ = s;
  const old = new Date(Date.now() - 30 * 86400_000).toISOString();
  for (let i = 0; i < 10_000; i++) s._rows.client_errors.push({ created_at: old });
  const res = await invoke(ok);
  assert(res.status === 200 && res.body?.dropped === true,
    `dropped once the table is full, not failed: ${res.status} ${JSON.stringify(res.body)}`);
  assert(s._rows.client_errors.length === 10_000, `and nothing was added: ${s._rows.client_errors.length}`);
});

await runTest("the total ceiling counts rows of every age, not just this hour", async () => {
  // The whole point of the second ceiling is that it sees what the hourly one cannot: these rows are a
  // month old, so the rate limit is nowhere near tripped.
  const s = store();
  globalThis.__edge_store__ = s;
  const old = new Date(Date.now() - 30 * 86400_000).toISOString();
  for (let i = 0; i < 9_999; i++) s._rows.client_errors.push({ created_at: old });
  const under = await invoke(ok);
  assert(under.status === 200 && !under.body?.dropped, `9,999 is under the ceiling: ${JSON.stringify(under.body)}`);
  assert(s._rows.client_errors.length === 10_000, "the report was written");
  const over = await invoke(ok);
  assert(over.body?.dropped === true, `and the next one is over it: ${JSON.stringify(over.body)}`);
});

await runTest("a hostile user-agent cannot make the function chew on it", async () => {
  // browserOf runs regexes over the body, and the Safari pattern backtracks over a long string of
  // near-matches. The cap goes on before the regexes, not after.
  const s = store();
  globalThis.__edge_store__ = s;
  const started = Date.now();
  const res = await invoke({ ...ok, ua: "Version/1 ".repeat(20_000) });
  assert(res.status === 200, `still answered: ${res.status}`);
  assert(Date.now() - started < 2000, `and promptly: ${Date.now() - started}ms`);
  assert(s._rows.client_errors[0].browser.length <= 80, "with a bounded browser string");
});

await runTest("a full table still prunes, so the sink cannot switch itself off for good", async () => {
  // THE DEAD END, found in re-review. With the prune after the insert, the first request to find the table
  // at MAX_ROWS returned above it - so nothing could ever delete again, crash reporting was off permanently,
  // and rows outlived the 90 days /privacy promises. The prune runs before both counts now, which means a
  // table that is already full heals itself on the very next request.
  const s = store();
  globalThis.__edge_store__ = s;
  const ancient = new Date(Date.now() - 200 * 86400_000).toISOString();
  for (let i = 0; i < 10_000; i++) s._rows.client_errors.push({ created_at: ancient });

  const first = await invoke(ok);
  assert(first.status === 200, `answered: ${first.status}`);
  // Every one of those rows is older than 90 days, so the prune should have taken the lot - and because it
  // runs first, this request is not dropped at all.
  assert(s._rows.client_errors.length === 1,
    `the old rows were pruned and the report written: ${s._rows.client_errors.length}`);
  assert(!first.body?.dropped, `and it was not dropped: ${JSON.stringify(first.body)}`);
});

await runTest("a full table of RECENT rows drops, but is still pruned when they age out", async () => {
  // The other half: rows inside the window are not pruned, so the ceiling does its job and the report is
  // dropped. The point is that the drop is temporary rather than terminal.
  const s = store();
  globalThis.__edge_store__ = s;
  const recent = new Date(Date.now() - 86400_000).toISOString();
  for (let i = 0; i < 10_000; i++) s._rows.client_errors.push({ created_at: recent });

  const dropped = await invoke(ok);
  assert(dropped.body?.dropped === true, `full of recent rows, so dropped: ${JSON.stringify(dropped.body)}`);
  assert(s._rows.client_errors.length === 10_000, "and nothing added");

  // Age them past the window; the next request prunes them and lands.
  for (const r of s._rows.client_errors) r.created_at = new Date(Date.now() - 200 * 86400_000).toISOString();
  const after = await invoke(ok);
  assert(!after.body?.dropped && s._rows.client_errors.length === 1,
    `once they age out the sink recovers by itself: ${s._rows.client_errors.length}`);
});

console.log("test-report-error-edge.mjs done");
