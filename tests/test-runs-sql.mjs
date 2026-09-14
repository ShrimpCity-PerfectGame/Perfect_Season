// The runs log and the Stats functions, against real Postgres (PGlite, in-process - no Supabase
// project or Docker needed). Runs supabase/schema.sql + migration-runs-log.sql exactly as the SQL
// editor would, then checks:
//   - the backfill recovers recent + best runs, maps them the same way submit-run's runLogRow does,
//     never duplicates (re-running the migration, or a live row for the same run), and
//   - site_stats()/site_totals() and the mock in tests/helpers.mjs return identical results for the
//     same data - so every jsdom test that reads Stats through the mock is testing what the database
//     actually does - on a fixture past both old limits (300 accounts, 10 runs per account).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { assert, runTest, makeMockAuth } from "./helpers.mjs";
import { runLogRow } from "../game-logic.mjs";

const sql = (p) => readFileSync(new URL(`../supabase/${p}`, import.meta.url), "utf8");
const MIGRATION = sql("migration-runs-log.sql");

// Supabase provides the auth schema; this is just enough of it for schema.sql's foreign keys,
// signup trigger and RLS policies to install.
async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  `);
  await db.exec(sql("schema.sql"));
  return db;
}
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Creates the account through the real signup trigger, then sets its stats columns.
async function addProfile(db, row) {
  await db.query("insert into auth.users values ($1, $2)", [row.id, { username: row.username }]);
  const cols = Object.keys(row).filter((k) => k !== "id" && k !== "username");
  const jsonCols = new Set(["best_run", "best_run_std", "best_record", "recent", "points_day"]);
  const sets = cols.map((c, i) => `${c} = $${i + 2}${jsonCols.has(c) ? "::jsonb" : ""}`).join(", ");
  await db.query(`update profiles set ${sets} where id = $1`, [row.id, ...cols.map((c) => (jsonCols.has(c) ? JSON.stringify(row[c]) : row[c]))]);
}
async function addRun(db, row) {
  const cols = Object.keys(row).filter((k) => row[k] !== undefined);
  const vals = cols.map((c) => (c === "roster" && row[c] != null ? JSON.stringify(row[c]) : row[c]));
  await db.query(`insert into runs (${cols.join(", ")}) values (${cols.map((c, i) => `$${i + 1}${c === "roster" ? "::jsonb" : ""}`).join(", ")})
                  on conflict (user_id, created_at, dnf) do nothing`, vals);
}

// Numbers compared to 9 decimals: Postgres numeric division and JS floats differ past that.
function canon(v) {
  if (typeof v === "number") return Math.round(v * 1e9) / 1e9;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
function firstDiff(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
  }
  return `${path}: sql=${JSON.stringify(a)?.slice(0, 200)} mock=${JSON.stringify(b)?.slice(0, 200)}`;
}

const player = (slot, name, season, team, rating) => ({ slot, name, season, team, ppr: rating * 3, rating });

await runTest("the backfill recovers recent and best runs, maps them like runLogRow, and never duplicates", async () => {
  const db = await freshDb();
  const id = uuid(1);
  const t0 = Date.UTC(2026, 7, 1);
  const gmRun = { w: 14, l: 3, score: 88.3, gm: true, champ: true, playoffs: true, perfect: false, outcome: "Won", format: "fantasy", date: t0 + 1000, roster: [player("QB", "Tom Brady", 2007, "NE", 120)] };
  const dailyStd = { w: 12, l: 6, score: 80, mode: "daily", format: "standard", par: 70, points: 45, date: t0 + 2000, roster: [player("RB", "Priest Holmes", 2002, "KC", 100)] };
  const untagged = { w: 9, l: 8, score: 70.1, date: t0 + 3000, roster: [player("WR", "Randy Moss", 2007, "NE", 110)] }; // from before format/gm tags
  const dnf = { dnf: true, picks: 2, mode: "genius", date: t0 + 4000 };
  const oldBest = { w: 15, l: 2, score: 95.5, date: t0 - 50000, roster: [player("QB", "Peyton Manning", 2004, "IND", 140)] }; // older than recent
  await addProfile(db, {
    id, username: "alice", runs: 4, dnf: 1, wins: 50, losses: 19,
    recent: [dnf, untagged, dailyStd, gmRun],
    best_score: 95.5, best_run: oldBest,
    best_score_std: 80, best_run_std: dailyStd, // also in recent: must not duplicate
  });

  // A run submit-run already logged live, before the migration's backfill sees it in recent.
  await db.exec(MIGRATION.split("-- ---------- Backfill ----------")[0]);
  await addRun(db, runLogRow(id, "alice", gmRun));

  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // re-runnable

  const rows = (await db.query("select * from runs order by created_at")).rows;
  assert(rows.length === 5, `expected 5 runs (4 recent + 1 older best), got ${rows.length}`);

  // Every backfilled row matches what runLogRow would have written for the same entry.
  const expected = [oldBest, gmRun, dailyStd, untagged, dnf].map((e) => runLogRow(id, "alice", e));
  const cols = ["ladder", "format", "gm", "genius", "dnf", "picks", "w", "l", "score", "champ", "par", "points", "roster"];
  rows.forEach((r, i) => {
    for (const c of cols) {
      const got = r[c] instanceof Object && !(r[c] instanceof Date) ? r[c] : r[c] == null ? null : typeof expected[i][c] === "number" ? Number(r[c]) : r[c];
      const want = expected[i][c] ?? null;
      const norm = (v) => (typeof want === "boolean" ? !!v : v);
      assert(JSON.stringify(canon(norm(got))) === JSON.stringify(canon(want)), `row ${i} column ${c}: backfill wrote ${JSON.stringify(got)}, runLogRow writes ${JSON.stringify(want)}`);
    }
    assert(r.created_at.toISOString() === expected[i].created_at, `row ${i}: timestamp ${r.created_at.toISOString()} vs ${expected[i].created_at}`);
  });
  assert(rows[1].backfilled === false && rows.filter((r) => r.backfilled).length === 4, "the live row keeps backfilled=false; the other four are marked backfilled");
  assert(rows[3].format === "fantasy" && rows[3].ladder === "unlimited", "an untagged old run reads as fantasy / unlimited");
  assert(rows[4].dnf && rows[4].format === null && rows[4].ladder === "genius", "a DNF keeps its ladder and has no format");
});

await runTest("site_stats and site_totals match the mock exactly, past 300 accounts and 10 runs per account", async () => {
  const db = await freshDb();
  await db.exec(MIGRATION);
  const mock = makeMockAuth();

  const names = ["Tom Brady", "Priest Holmes", "Randy Moss", "Tony Gonzalez", "Marshall Faulk", "Terrell Owens", "Drew Brees", "Travis Kelce"];
  const slots = ["QB", "RB", "WR", "TE", "FLEX1", "FLEX2"];
  let clock = Date.UTC(2026, 8, 1);
  const N = 320;
  for (let n = 1; n <= N; n++) {
    const id = uuid(n);
    const username = `player${String(n).padStart(3, "0")}`;
    // Deterministic but varied, with deliberate ties so the tiebreaks get exercised.
    const wins = (n * 37) % 90, losses = (n * 11) % 40;
    const profile = {
      id, username, runs: (n % 7) + (n === 5 ? 12 : 0), dnf: n % 3 === 0 ? 1 : 0, wins, losses,
      champs: n % 9 === 0 ? (n % 4) + 1 : 0, perfect: n % 50 === 0 ? 1 : 0, playoffs: n % 5, daily_streak: 0,
      daily_best_streak: n % 6,
      best_score: n % 4 === 0 ? null : 60 + ((n * 13) % 40) + (n % 10) / 10,
      best_run: n % 4 === 0 ? null : { w: 12, l: 5, score: 60 + ((n * 13) % 40) + (n % 10) / 10, roster: [player("QB", names[n % 8], 2000 + (n % 20), "NE", 100)] },
      best_score_std: n % 3 === 0 ? 50 + ((n * 7) % 45) : null,
      best_run_std: n % 3 === 0 ? { w: 10, l: 7, score: 50 + ((n * 7) % 45), format: "standard", roster: [] } : null,
      recent: [],
    };
    await addProfile(db, profile);
    mock._profiles.set(id, { ...profile });

    // Account 5 has 14 runs - more than the 10 profiles.recent ever kept.
    const runCount = n === 5 ? 14 : n % 3;
    for (let k = 0; k < runCount; k++) {
      const gm = (n + k) % 4 === 0, format = (n + k) % 5 === 0 ? "standard" : "fantasy";
      const entry = {
        w: 10 + ((n + k) % 8), l: 7 - ((n + k) % 8 > 7 ? 0 : (n + k) % 7), score: 55 + ((n * 3 + k * 17) % 45),
        gm, format, mode: k % 6 === 0 ? "daily" : "free", champ: (n + k) % 11 === 0, playoffs: (n + k) % 2 === 0,
        date: (clock += 1000),
        roster: slots.map((slot, i) => player(slot, names[(n + k + i) % 8], 2000 + ((n + i) % 20), i % 2 ? "KC" : "NE", 80 + ((n * 7 + k + i * 13) % 60))),
      };
      const row = runLogRow(id, username, entry, entry.mode === "daily" ? "2026-09-01" : null);
      await addRun(db, row);
      mock._runs.set(`${row.user_id}|${row.created_at}|${row.dnf}`, { backfilled: false, ...row });
    }
    if (n % 10 === 0) {
      const row = runLogRow(id, username, { dnf: true, picks: 3, mode: "gm", date: (clock += 1000) });
      await addRun(db, row);
      mock._runs.set(`${row.user_id}|${row.created_at}|${row.dnf}`, { backfilled: false, ...row });
    }
  }

  const sqlStats = (await db.query("select site_stats(10) as s")).rows[0].s;
  const mockStats = (await mock.rpc("site_stats", { p_limit: 10 })).data;
  const diff = firstDiff(canon(sqlStats), canon(mockStats));
  assert(!diff, "site_stats: SQL and mock disagree at " + diff);

  const sqlTotals = (await db.query("select site_totals() as t")).rows[0].t;
  const mockTotals = (await mock.rpc("site_totals")).data;
  assert(JSON.stringify(canon(sqlTotals)) === JSON.stringify(canon(mockTotals)), `site_totals: SQL ${JSON.stringify(sqlTotals)} vs mock ${JSON.stringify(mockTotals)}`);

  // And the numbers really cover everything, not a sample.
  assert(sqlTotals.players === N, `expected all ${N} accounts counted, got ${sqlTotals.players}`);
  // Most-drafted's #1 is the true maximum over every logged pick, counted independently here.
  const trueTop = Number((await db.query(`
    select max(c) as c from (select count(*) as c from runs r, jsonb_array_elements(r.roster) e
                              where not r.dnf group by e->>'name', e->>'season', e->>'team') x`)).rows[0].c);
  assert(trueTop > 0 && sqlStats.most_drafted[0].count === trueTop, `most-drafted #1 should be drafted ${trueTop} times, got ${sqlStats.most_drafted[0]?.count}`);
  const acct5 = Number((await db.query("select count(*) as c from runs where user_id = $1", [uuid(5)])).rows[0].c);
  assert(acct5 === 14, `account 5's 14 runs should all be logged, got ${acct5}`);
  assert(sqlStats.best_win_pct.every((r) => r.wins + r.losses >= 3), "win % board honours the 3-game minimum");
  for (const f of ["fantasy", "standard"]) {
    const upsets = sqlStats.by_format[f].biggest_upsets;
    const lowestTitle = Number((await db.query("select min(score) as s from runs where champ and not dnf and format = $1", [f])).rows[0].s);
    assert(upsets.length > 0 && Number(upsets[0].score) === lowestTitle, `${f}: biggest upset should be the lowest title-winning score (${lowestTitle}), got ${upsets[0]?.score}`);
    assert(upsets.every((u, i) => i === 0 || Number(u.score) >= Number(upsets[i - 1].score)), `${f}: upsets must be ordered lowest score first`);
  }
  assert(sqlStats.by_format.fantasy.best_lineups.length === 15 && sqlStats.most_wins.length === 10, "boards are capped at their limits");
});

await runTest("runs is readable by anyone and writable by no client role", async () => {
  const db = await freshDb();
  await db.exec(MIGRATION);
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on public.runs to anon, authenticated;
    grant execute on function public.site_stats(integer), public.site_totals() to anon, authenticated;
    grant select on public.profiles to anon, authenticated;
  `);
  await db.query("insert into auth.users values ($1, $2)", [uuid(1), { username: "alice" }]);
  await addRun(db, runLogRow(uuid(1), "alice", { w: 10, l: 7, score: 70, date: Date.UTC(2026, 8, 2), roster: [] }));

  // Table grants like Supabase's defaults; RLS is what must stop the write.
  await db.exec("set role authenticated");
  const read = await db.query("select count(*) as c from runs");
  assert(Number(read.rows[0].c) === 1, "a client role should be able to read runs");
  const stats = await db.query("select site_stats() as s");
  assert(stats.rows[0].s.totals.players === 1, "a client role should be able to call site_stats()");
  let blocked = false;
  try { await db.query("insert into runs (user_id, username, ladder) values ($1, 'alice', 'unlimited')", [uuid(1)]); } catch { blocked = true; }
  assert(blocked, "a client role must not be able to insert into runs");
  const upd = await db.query("update runs set score = 999 returning id");
  assert(upd.rows.length === 0, "a client role must not be able to update runs");
  await db.exec("reset role");
});

await runTest("the mock's submit-run logs a DNF as its own row", async () => {
  const mock = makeMockAuth();
  await mock.auth.signUp({ email: "dnf@example.com", password: "Password1", options: { data: { username: "dnfer" } } });
  const res = await mock.functions.invoke("submit-run", { body: { dnf: true, picks: 4, mode: "gm" } });
  assert(res.data?.ok, "expected the DNF to be accepted");
  const rows = [...mock._runs.values()];
  assert(rows.length === 1 && rows[0].dnf && rows[0].picks === 4 && rows[0].ladder === "gm", "expected one DNF row on the GM ladder, got " + JSON.stringify(rows));
});

console.log("test-runs-sql.mjs done");
