// player_stats() (supabase/migration-runs-log.sql) against real Postgres (PGlite, through
// tests/pg-fixture.mjs) and the test mock (tests/mock-profile-stats.mjs), on one varied fixture: many
// accounts and one with no history, DNFs, both scoring formats, every ladder, ties wherever an order has
// to break them, dailies dated from tomorrow back to weeks ago, Over/Under runs and builds. Checks:
//   - SQL and mock return identical JSON for every account, so every jsdom test that reads a profile
//     through the mock is testing what the database does, and
//   - the definitions on their own (PROFILES.md 3.2): a tie for first is a first, a day that isn't over
//     everywhere never counts toward best_rank whatever the session's time zone, go-to players stop at
//     five, and a guest can call it.
import { assert, runTest, makeMockAuth } from "./helpers.mjs";
import { freshDb, addAccount, uuid, asAnon, sql } from "./pg-fixture.mjs";
import { runLogRow, mulberry32, hashStr, LADDERS } from "../game-logic.mjs";
import { emptyPlayerStats, mapPlayerStats } from "../profile-rules.mjs";

// Numbers compared to 9 decimals (as test-runs-sql.mjs does), keys in a fixed order.
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
  return `${path}: sql=${JSON.stringify(a)?.slice(0, 300)} mock=${JSON.stringify(b)?.slice(0, 300)}`;
}
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

const DAY_MS = 24 * 60 * 60 * 1000;
// The days-over rule reads the clock, in the database and the mock alike. Starting within a couple of
// minutes of UTC midnight could put the fixture's "today" and the query's on different days.
const toMidnight = DAY_MS - (Date.now() % DAY_MS);
if (toMidnight < 120_000) await new Promise((r) => setTimeout(r, toMidnight + 2000));
const todayMs = Date.now() - (Date.now() % DAY_MS);
const day = (offset) => new Date(todayMs + offset * DAY_MS).toISOString().slice(0, 10);
// A moment on a given day, for created_at.
const at = (offset, minutes) => new Date(todayMs + offset * DAY_MS + minutes * 60_000).toISOString();

// Roster entries to draw from. Same name in two seasons, and same name and season on two teams, so all
// three go-to tiebreaks get used; apostrophes and capitals where collations disagree.
const P = {
  moss07: { name: "Randy Moss", season: 2007, team: "NE" },
  moss03: { name: "Randy Moss", season: 2003, team: "MIN" },
  wrightNE: { name: "Tim Wright", season: 2014, team: "NE" },
  wrightTB: { name: "Tim Wright", season: 2014, team: "TB" },
  kelce: { name: "Travis Kelce", season: 2022, team: "KC" },
  adams: { name: "Davante Adams", season: 2020, team: "GB" },
  kupp: { name: "Cooper Kupp", season: 2021, team: "LA" },
  chase: { name: "Ja'Marr Chase", season: 2021, team: "CIN" },
  swift: { name: "D'Andre Swift", season: 2020, team: "DET" },
  moore: { name: "DJ Moore", season: 2019, team: "CAR" },
  holmes: { name: "Priest Holmes", season: 2002, team: "KC" },
  manning04: { name: "Peyton Manning", season: 2004, team: "IND" },
  manning13: { name: "Peyton Manning", season: 2013, team: "DEN" },
  ladainian: { name: "LaDainian Tomlinson", season: 2006, team: "LAC" },
  harrison: { name: "Marvin Harrison", season: 2002, team: "IND" },
  cmc: { name: "Christian McCaffrey", season: 2019, team: "CAR" },
  gonzalez: { name: "Tony Gonzalez", season: 2004, team: "KC" },
  achane: { name: "De'Von Achane", season: 2023, team: "MIA" },
};
const POOL = Object.values(P);
const SLOTS = ["QB", "RB", "WR", "TE", "FLEX1", "FLEX2"];
const roster = (players) => players.map((p, i) => ({ slot: SLOTS[i], ...p, ppr: 250 + i, rating: 90 + i }));

// ---------- The fixture, as rows for both the database and the mock ----------
const accounts = []; // { id, username, recent? }
const runs = [], dailyRuns = [], souRuns = [], builds = [];
let nextAccount = 1;
function account(username, extra = {}) {
  const a = { id: uuid(nextAccount++), username, ...extra };
  accounts.push(a);
  return a;
}
// A finished run or DNF through runLogRow, the shape submit-run logs, then any column overrides (a
// score or record left null, as only an old backfilled row can have).
function run(a, entry, overrides = {}) {
  const row = { ...runLogRow(a.id, a.username, entry, entry.mode === "daily" ? entry.dailyDate || null : null), ...overrides };
  runs.push(row);
  return row;
}
const daily = (a, date, format, score, w, l, createdAt) => dailyRuns.push({ date, format, user_id: a.id, username: a.username, w, l, score, outcome: "Missed the playoffs", created_at: createdAt });
let buildIds = 1;
const build = (a, pos, overall, createdAt, id = uuid(900000 + buildIds++)) => builds.push({ id, user_id: a.id, username: a.username, pos, overall, filled: { pass: "A" }, created_at: createdAt });
const entryTime = (iso) => Date.parse(iso);

// Accounts whose results are checked by hand below.
const ghost = account("ghost"); // never played anything
const dnfOnly = account("quitter");
run(dnfOnly, { dnf: true, picks: 2, mode: "unlimited", date: entryTime(at(-8, 10)) });
run(dnfOnly, { dnf: true, picks: 0, mode: "gm", date: entryTime(at(-8, 5)) });
run(dnfOnly, { dnf: true, picks: 5, mode: "unlimited", date: entryTime(at(-3, 1)) });

// Go-to players: seven entries drafted twice, so the top five is decided by name, then season, then
// team, and two of them (Tim Wright on TB, Travis Kelce) miss out on a tie.
const collector = account("collector");
const collectorRuns = [
  { w: 12, l: 6, score: 88.1, champ: false, playoffs: true, date: entryTime(at(-5, 100)), format: "fantasy", points: 40, roster: roster([P.moss07, P.moss03, P.wrightNE, P.wrightTB, P.kelce, P.adams]) },
  { w: 9, l: 8, score: 79.4, date: entryTime(at(-5, 200)), format: "standard", gm: true, points: -20, roster: roster([P.moss07, P.moss03, P.wrightNE, P.wrightTB, P.kupp, P.adams]) },
  { w: 14, l: 5, score: 94.9, champ: false, playoffs: true, date: entryTime(at(-4, 300)), mode: "daily", dailyDate: day(-4), format: "fantasy", points: 120, roster: roster([P.chase, P.swift, P.kelce, P.kupp, P.holmes, P.manning04]) },
];
collectorRuns.forEach((e) => run(collector, e));
run(collector, { w: 11, l: 7, score: 85, date: entryTime(at(-4, 400)), format: "fantasy" }, { roster: null }); // backfilled, no roster
run(collector, { dnf: true, picks: 4, mode: "genius", date: entryTime(at(-4, 500)) });
// Its recent list holds the same runs, so re-running the migration's backfill must find them logged.
collector.recent = [...collectorRuns].reverse();

// Biggest upset and best GM score, with ties broken by the earlier run, and scoreless runs ignored.
const upsets = account("underdog");
run(upsets, { w: 13, l: 6, score: 71.4, champ: true, playoffs: true, date: entryTime(at(-6, 30)), format: "fantasy", gm: true, points: 10 });
run(upsets, { w: 15, l: 5, score: 71.4, champ: true, playoffs: true, date: entryTime(at(-7, 30)), format: "fantasy", genius: true, points: 12 });
run(upsets, { w: 16, l: 4, score: 80.0, champ: true, playoffs: true, date: entryTime(at(-9, 30)), format: "fantasy", points: 5 });
run(upsets, { w: 16, l: 4, score: 1, champ: true, playoffs: true, date: entryTime(at(-10, 30)), format: "fantasy" }, { score: null });
run(upsets, { w: 17, l: 3, score: 82.0, champ: true, playoffs: true, date: entryTime(at(-6, 90)), format: "standard", points: 7 });
run(upsets, { w: 18, l: 2, score: 96.1, champ: false, playoffs: true, date: entryTime(at(-2, 30)), format: "fantasy", gm: true, points: 150 });
run(upsets, { w: 17, l: 2, score: 96.1, champ: false, playoffs: true, date: entryTime(at(-3, 30)), format: "fantasy", gm: true, points: 149 });
run(upsets, { w: 19, l: 1, score: 1, champ: false, playoffs: true, date: entryTime(at(-11, 30)), format: "fantasy", gm: true }, { score: null });
run(upsets, { w: 5, l: 12, score: 60.2, date: entryTime(at(-12, 30)), format: "standard", points: -80 }, { w: null });
// A title with no score logged is still a title, but it can't be anyone's biggest upset.
const oldTimer = account("oldtimer");
run(oldTimer, { w: 16, l: 4, score: 1, champ: true, playoffs: true, date: entryTime(at(-40, 0)), format: "standard" }, { score: null });

// Daily finishes. Every bulk score below is 77.5 or less, so these boards keep their order.
const tieA = account("tieA");
const tieB = account("tieB");
const third = account("bronzed");
const recentWinner = account("latebloomer");
const onlyRecent = account("rookie");
daily(tieA, day(-2), "fantasy", 90.5, 15, 5, at(-2, 60));
daily(tieB, day(-2), "fantasy", 90.5, 16, 4, at(-2, 70));
daily(third, day(-2), "fantasy", 88.0, 14, 6, at(-2, 80));
daily(recentWinner, day(-2), "fantasy", 80.0, 12, 8, at(-2, 90)); // 4th
daily(tieA, day(-1), "fantasy", 50.0, 6, 11, at(-1, 60));
daily(third, day(-3), "fantasy", 86.0, 13, 7, at(-3, 60));
daily(tieB, day(-3), "fantasy", 86.0, 13, 7, at(-3, 61));
daily(recentWinner, day(-3), "fantasy", 85.0, 13, 7, at(-3, 62)); // 3rd, its best finished day
daily(recentWinner, day(-1), "fantasy", 99.9, 19, 1, at(-1, 30)); // first, but yesterday
daily(recentWinner, day(0), "standard", 95.0, 18, 2, at(0, 1)); // first, but today
daily(recentWinner, day(1), "fantasy", 99.0, 18, 2, at(0, 2)); // first, but tomorrow's (a player far east of UTC)
daily(onlyRecent, day(0), "fantasy", 60.0, 9, 8, at(0, 3));
daily(onlyRecent, day(-1), "standard", 61.0, 9, 8, at(-1, 3));

// The best daily's tiebreaks: equal scores go to the earliest created_at, then the earliest date, then
// fantasy before standard.
const dailyTie = account("coinflip");
daily(dailyTie, day(-6), "fantasy", 77.5, 15, 5, at(-9, 0));
daily(dailyTie, day(-9), "standard", 77.5, 14, 6, at(-9, 0));
daily(dailyTie, day(-9), "fantasy", 77.5, 13, 7, at(-9, 0));
const dailyEarly = account("earlybird");
daily(dailyEarly, day(-6), "fantasy", 77.5, 16, 4, at(-6, 10));
daily(dailyEarly, day(-30), "standard", 77.5, 12, 8, at(-30, 10));

// The best build's tiebreaks: highest overall, then earliest, then id (the RB, not the later build with
// the lowest id).
const tinkerer = account("tinkerer");
build(tinkerer, "WR", 120.5, at(-6, 0), uuid(800002));
build(tinkerer, "RB", 120.5, at(-6, 0), uuid(800001));
build(tinkerer, "QB", 120.5, at(-5, 0), uuid(800003));
build(tinkerer, "TE", 99.0, at(-8, 0), uuid(800004));
build(tinkerer, "QB", 120.5, at(-4, 0), uuid(800000));

// Everyone else: deterministic noise with plenty of ties.
const rng = mulberry32(hashStr("player-stats-fixture"));
const int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const chance = (p) => rng() < p;
const sample = (items, n) => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = int(0, i); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};
const DAILY_DATES = [1, 0, -1, -2, -3, -4, -6, -9, -30];
for (let n = 1; n <= 48; n++) {
  const a = account(`bulk${String(n).padStart(2, "0")}`);
  let clock = Date.UTC(2026, 6, 1) + n * 3_600_000;
  const runCount = n % 7 === 0 ? 0 : int(1, 30);
  for (let k = 0; k < runCount; k++) {
    clock += int(1, 5_000_000);
    const ladder = LADDERS[int(0, 3)];
    if (chance(0.12)) {
      run(a, { dnf: true, picks: int(0, 5), mode: ladder, date: clock });
      continue;
    }
    const w = int(0, 20), champ = w >= 13 && chance(0.4);
    const players = sample(POOL, 6);
    run(a, {
      w, l: champ && w === 20 ? 0 : int(0, 8), score: 70 + 2.5 * int(0, 16), champ, perfect: champ && w === 20, playoffs: champ || w >= 10,
      date: clock, format: chance(0.35) ? "standard" : "fantasy", mode: ladder === "daily" ? "daily" : "free", dailyDate: day(-int(2, 20)),
      gm: ladder === "gm", genius: ladder === "genius",
      points: chance(0.1) ? undefined : int(-300, 300), roster: chance(0.08) ? undefined : roster(players),
    });
  }
  for (const offset of DAILY_DATES) {
    for (const format of ["fantasy", "standard"]) {
      if (chance(0.45)) daily(a, day(offset), format, 40 + 2.5 * int(0, 15), int(0, 20), int(0, 17), at(offset, int(0, 1439)));
    }
    if (offset <= 0 && chance(0.3)) souRuns.push({ date: day(offset), user_id: a.id, username: a.username, score: int(0, 25), created_at: at(offset, int(0, 1439)) });
  }
  if (n % 3 === 0) for (let b = int(1, 12); b > 0; b--) build(a, ["QB", "RB", "WR", "TE"][int(0, 3)], 60 + 2.5 * int(0, 30), at(-int(0, 40), int(0, 1439)));
}

// ---------- Load it into Postgres and the mock ----------
async function insertRows(db, table, rows) {
  if (!rows.length) return;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => r[k] !== undefined)))];
  await db.query(`insert into ${table} (${cols.join(", ")}) select ${cols.join(", ")} from jsonb_populate_recordset(null::${table}, $1::jsonb)`, [JSON.stringify(rows)]);
}

const db = await freshDb();
// Supabase databases run in UTC; PGlite takes the machine's time zone, which changes how to_jsonb writes
// a timestamp.
await db.exec("set timezone = 'UTC'");
for (const a of accounts) await addAccount(db, { id: a.id, username: a.username, ...(a.recent ? { recent: a.recent } : {}) });
await insertRows(db, "runs", runs);
await insertRows(db, "daily_runs", dailyRuns);
await insertRows(db, "sou_runs", souRuns);
await insertRows(db, "builds", builds);

const mock = makeMockAuth();
for (const r of runs) mock._runs.set(`${r.user_id}|${r.created_at}|${r.dnf}`, { backfilled: false, ...r });
for (const r of dailyRuns) mock._dailyRuns.set(`${r.date}:${r.format}:${r.user_id}`, r);
for (const r of souRuns) mock._souRuns.set(`${r.date}:${r.user_id}`, r);
for (const r of builds) mock._builds.set(r.id, r);

// A build a browser logged before 1.11.0 checked them: a numeric NaN, which sorts above every number. It
// counts as a build but can never be the best. Loaded past the insert check, as rows from before it were.
const legacyBuild = { id: uuid(800009), user_id: tinkerer.id, username: tinkerer.username, pos: "QB", overall: "NaN", filled: {}, created_at: at(-3, 0) };
await db.exec("set session_replication_role = replica");
await insertRows(db, "builds", [legacyBuild]);
await db.exec("set session_replication_role = default");
mock._builds.set(legacyBuild.id, legacyBuild);

const sqlStats = async (id) => (await db.query("select player_stats($1) as s", [id])).rows[0].s;
const mockStats = async (id) => (await mock.rpc("player_stats", { p_user_id: id })).data;
const ids = [...accounts.map((a) => a.id), uuid(999999)]; // plus an id with no account at all
const bySql = new Map();
for (const id of ids) bySql.set(id, await sqlStats(id));
const of = (a) => bySql.get(a.id);

await runTest("player_stats: SQL and the mock return identical JSON for every account", async () => {
  for (const id of ids) {
    const diff = firstDiff(canon(bySql.get(id)), canon(await mockStats(id)));
    const name = accounts.find((a) => a.id === id)?.username || "no account";
    assert(!diff, `${name}: SQL and mock disagree at ${diff}`);
    mapPlayerStats(bySql.get(id)); // and the app can read it
  }
  // The fixture really does exercise what it's meant to.
  const all = [...bySql.values()];
  assert(all.filter((s) => s.by_ladder.length === 4).length >= 10, "expected many accounts on all four ladders");
  assert(all.some((s) => s.by_format.standard.biggest_upset) && all.some((s) => s.by_format.fantasy.best_gm), "expected upsets and GM bests in the fixture");
  assert(all.some((s) => s.dailies.best_rank === 1) && all.some((s) => s.dailies.best_rank > 1), "expected both winners and also-rans among finished dailies");
  assert(all.some((s) => s.over_under.played > 1) && all.some((s) => s.builds.count > 1), "expected Over/Under runs and builds");
});

await runTest("player_stats: an account with no history, or no account, is the empty shape", async () => {
  assert(same(of(ghost), emptyPlayerStats()), `ghost: ${JSON.stringify(of(ghost))}`);
  assert(same(bySql.get(uuid(999999)), emptyPlayerStats()), "an unknown id should read as empty");
});

await runTest("player_stats: ladders, DNFs, wins and points follow the definitions", async () => {
  const q = of(dnfOnly);
  assert(same(q.by_ladder, [
    { ladder: "unlimited", seasons: 0, dnf: 2, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, best_score: null, best_score_std: null },
    { ladder: "gm", seasons: 0, dnf: 1, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, best_score: null, best_score_std: null },
  ]), `DNF-only ladders: ${JSON.stringify(q.by_ladder)}`);
  assert(q.since === at(-8, 5).replace(".000Z", "+00:00"), `since counts DNFs: ${q.since}`);
  assert(q.wins.length === 0 && q.best_points === null && q.team_counts.length === 0, "DNFs have no record, points or roster");

  const c = of(collector);
  assert(same(c.by_ladder.map((l) => l.ladder), ["daily", "unlimited", "genius", "gm"]), `ladder order: ${c.by_ladder.map((l) => l.ladder)}`);
  const unlimited = c.by_ladder.find((l) => l.ladder === "unlimited");
  assert(unlimited.seasons === 2 && unlimited.wins === 23 && unlimited.best_score === 88.1 && unlimited.best_score_std === null,
    `collector's unlimited ladder: ${JSON.stringify(unlimited)}`);
  assert(same(c.by_ladder.find((l) => l.ladder === "gm"), { ladder: "gm", seasons: 1, dnf: 0, wins: 9, losses: 8, champs: 0, perfect: 0, playoffs: 0, best_score: null, best_score_std: 79.4 }),
    "a standard GM run is a standard best");
  assert(same(c.wins, [{ w: 9, n: 1 }, { w: 11, n: 1 }, { w: 12, n: 1 }, { w: 14, n: 1 }]), `wins: ${JSON.stringify(c.wins)}`);
  assert(c.best_points === 120, `best points: ${c.best_points}`);

  const u = of(upsets);
  assert(u.best_points === 150, `best points: ${u.best_points}`);
  assert(u.wins.every((g) => g.w != null) && u.wins.reduce((t, g) => t + g.n, 0) === 8, "a run with no record isn't in the wins chart");
});

await runTest("player_stats: go-to players stop at five, and ties go by name, season, then team", async () => {
  const c = of(collector);
  assert(same(c.go_to_players, [
    { name: "Cooper Kupp", season: 2021, team: "LA", count: 2 },
    { name: "Davante Adams", season: 2020, team: "GB", count: 2 },
    { name: "Randy Moss", season: 2003, team: "MIN", count: 2 },
    { name: "Randy Moss", season: 2007, team: "NE", count: 2 },
    { name: "Tim Wright", season: 2014, team: "NE", count: 2 },
  ]), `go-to players: ${JSON.stringify(c.go_to_players)}`);
  assert(same(c.team_counts, [
    { team: "NE", count: 4 }, { team: "KC", count: 3 }, { team: "GB", count: 2 }, { team: "LA", count: 2 },
    { team: "MIN", count: 2 }, { team: "TB", count: 2 }, { team: "CIN", count: 1 }, { team: "DET", count: 1 }, { team: "IND", count: 1 },
  ]), `team counts: ${JSON.stringify(c.team_counts)}`);
  const all = [...bySql.values()];
  assert(all.every((s) => s.go_to_players.length <= 5), "never more than five go-to players");
  assert(all.filter((s) => s.go_to_players.length === 5).length > 20, "the cap has to bite: most bulk accounts drafted more than five different players");
});

await runTest("player_stats: biggest upset and best GM score break ties by the earlier run", async () => {
  const u = of(upsets);
  assert(same(u.by_format.fantasy, {
    champs: 4,
    biggest_upset: { score: 71.4, w: 15, l: 5, ladder: "genius", created_at: at(-7, 30).replace(".000Z", "+00:00") },
    best_gm: { score: 96.1, w: 17, l: 2 },
  }), `fantasy: ${JSON.stringify(u.by_format.fantasy)}`);
  assert(same(u.by_format.standard, { champs: 1, biggest_upset: { score: 82, w: 17, l: 3, ladder: "unlimited", created_at: at(-6, 90).replace(".000Z", "+00:00") }, best_gm: null }),
    `standard: ${JSON.stringify(u.by_format.standard)}`);
  assert(same(of(oldTimer).by_format.standard, { champs: 1, biggest_upset: null, best_gm: null }), `a scoreless title: ${JSON.stringify(of(oldTimer).by_format.standard)}`);
});

await runTest("player_stats: a tie for first is a first, and only days that are over everywhere count", async () => {
  assert(of(tieA).dailies.best_rank === 1 && of(tieB).dailies.best_rank === 1, `tied winners: ${of(tieA).dailies.best_rank}, ${of(tieB).dailies.best_rank}`);
  assert(of(third).dailies.best_rank === 1, "tied for first on an older day");
  const r = of(recentWinner).dailies;
  assert(same(r, { played: 5, best_score: 99.9, best_w: 19, best_l: 1, best_rank: 3 }),
    `first tomorrow, today and yesterday doesn't count yet; third two days ago does: ${JSON.stringify(r)}`);
  assert(same(of(onlyRecent).dailies, { played: 2, best_score: 61, best_w: 9, best_l: 8, best_rank: null }), `no finished days: ${JSON.stringify(of(onlyRecent).dailies)}`);
  assert(same(of(dailyTie).dailies, { played: 3, best_score: 77.5, best_w: 13, best_l: 7, best_rank: of(dailyTie).dailies.best_rank }), `best daily tiebreak: ${JSON.stringify(of(dailyTie).dailies)}`);
  assert(of(dailyEarly).dailies.best_w === 12, `earliest created_at wins a tie: ${JSON.stringify(of(dailyEarly).dailies)}`);

  // Worked out in UTC whatever time zone the session is in. At any hour, one of these two zones is on a
  // different calendar date from UTC, so a query using the session's current_date would move a rank.
  for (const zone of ["Etc/GMT-14", "Etc/GMT+12"]) {
    await db.exec(`set timezone = '${zone}'`);
    for (const a of accounts) {
      const s = await sqlStats(a.id);
      assert(same(s.dailies, of(a).dailies), `${a.username} in ${zone}: ${JSON.stringify(s.dailies)} vs UTC ${JSON.stringify(of(a).dailies)}`);
      assert(s.since === null ? of(a).since === null : Date.parse(s.since) === Date.parse(of(a).since), `${a.username} in ${zone}: since moved`);
    }
  }
  await db.exec("set timezone = 'UTC'");
});

await runTest("player_stats: builds and Over/Under", async () => {
  assert(same(of(tinkerer).builds, { count: 6, best: { pos: "RB", overall: 120.5 } }), `builds (a NaN build counts but isn't best): ${JSON.stringify(of(tinkerer).builds)}`);
  const bulk = accounts.find((a) => souRuns.filter((r) => r.user_id === a.id).length > 1);
  const mine = souRuns.filter((r) => r.user_id === bulk.id);
  assert(same(of(bulk).over_under, { played: mine.length, best: Math.max(...mine.map((r) => r.score)) }), `over/under: ${JSON.stringify(of(bulk).over_under)}`);
});

await runTest("player_stats: a guest can call it, and it's a stable security-invoker function", async () => {
  for (const a of [collector, tieA, upsets, tinkerer]) {
    const s = await asAnon(db, () => sqlStats(a.id));
    assert(same(s, of(a)), `anon sees ${a.username}'s stats differently`);
  }
  const fn = (await db.query("select provolatile, prosecdef from pg_proc where proname = 'player_stats'")).rows;
  assert(fn.length === 1 && fn[0].provolatile === "s" && fn[0].prosecdef === false, `player_stats should be stable and security invoker: ${JSON.stringify(fn)}`);
  const indexed = (await db.query("select tablename from pg_indexes where schemaname = 'public' and indexdef like '%(user_id)'")).rows.map((r) => r.tablename).sort();
  assert(["builds", "daily_runs", "sou_runs"].every((t) => indexed.includes(t)), `expected user_id indexes, found ${indexed}`);
});

await runTest("migration-runs-log.sql re-runs harmlessly on a database with data", async () => {
  const count = async () => Number((await db.query("select count(*) as c from runs")).rows[0].c);
  const before = await count();
  await db.exec(sql("migration-runs-log.sql"));
  await db.exec(sql("migration-runs-log.sql"));
  await db.exec("set timezone = 'UTC'");
  assert((await count()) === before, `the backfill duplicated runs: ${before} before, ${await count()} after`);
  for (const id of ids) {
    assert(same(await sqlStats(id), bySql.get(id)), `player_stats changed after re-running the migration (${id})`);
  }
});

console.log("test-player-stats-sql.mjs done");
