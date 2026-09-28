// Century's database half, in real Postgres through tests/pg-fixture.mjs: the table nobody writes from a client,
// the daily being once per account, the two boards, and a rename reaching this board too.
//
// The last one is the point of writing this file rather than trusting the migration. `guest` and `username` are
// snapshots on every board, stamped by a trigger and rewritten by mod_act and claim_username - and CLAUDE.md
// records that eight boards each had to be given that treatment separately, one at a time, because nothing makes
// a new board inherit it. Century is the ninth, and the first whose table is created by a migration of its own.
//
// The board functions are also held to tests/mock-century.mjs row for row, the way test-runs-sql.mjs holds the
// Stats functions: an order that is not fully tiebroken is an order the SQL and the mock can disagree about, and
// the app reads one while every jsdom test reads the other.
import { assert, runTest } from "./helpers.mjs";
import { freshDb, addAccount, addGuestAccount, attachEmail, asUser, asAnon, uuid, sql } from "./pg-fixture.mjs";
import { makeCentury } from "./mock-century.mjs";
import { initGameData } from "../game-logic.mjs";
import { initCenturyData, CENTURY_SLOTS } from "../century-logic.mjs";
import { readFileSync } from "node:fs";

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
const players = read("data/players.json");
initGameData(players.players, players.opponents);
initCenturyData(read("data/season-2025.json"));

const db = await freshDb();
const ALICE = uuid(1), BOB = uuid(2), CAROL = uuid(3), GUEST = uuid(4), MOD = uuid(5);
await addAccount(db, { id: ALICE, username: "alice" });
await addAccount(db, { id: BOB, username: "Bob" });          // upper case on purpose: the collate "C" tiebreak
await addAccount(db, { id: CAROL, username: "carol" });
await addAccount(db, { id: MOD, username: "mod" });
await addGuestAccount(db, GUEST);
await db.query("insert into moderators (user_id) values ($1)", [MOD]);

// jsonb has no key order - Postgres normalises it and the mock's objects keep their insertion order - so the two
// are compared canonically, the same way tests/test-runs-sql.mjs compares the Stats functions. The ORDER OF ROWS
// is what these tests are about, and canon does not touch it.
function canon(v) {
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
  return `${path}: sql=${JSON.stringify(a)?.slice(0, 160)} mock=${JSON.stringify(b)?.slice(0, 160)}`;
}
const differs = (sqlValue, mockValue) => firstDiff(canon(sqlValue), canon(mockValue));

const owner = async (statement, params) => (await db.query(statement, params)).rows;
async function attempt(who, statement, params) {
  const run = async () => {
    try {
      const r = await db.query(statement, params);
      return { rows: r.rows, affected: r.affectedRows ?? 0 };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  };
  return who ? asUser(db, who, run) : asAnon(db, run);
}
async function call(who, fn, args) {
  const names = Object.keys(args);
  const res = await attempt(who, `select ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, names.map((n) => args[n]));
  return res.error ? { error: res.error } : { data: res.rows[0].r };
}

// The service role is the only writer, so every row a test needs goes in as the owner - which is what the Edge
// Function's service-role client is. `roster` is the shape submit-century builds.
const roster = (score) => CENTURY_SLOTS.map((slot, i) => ({ slot, name: `P${i}`, team: "KC", pos: "RB", td: i === 0 ? score : 0 }));
let clock = 0;
// `now: true` stamps the row with the real clock, for the cases that are about a time window (claim_minigame's
// 24 hours). Everything else gets a fixed, ordered timestamp, so a board's tiebreaks are deterministic.
async function addRun({ user, day = null, seed = "SEED0001", score, hit = score >= 100, ceiling = score + 10, now = false }) {
  clock++;
  const at = now ? new Date().toISOString() : new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
  await owner(
    `insert into century_runs (user_id, username, day, seed, score, hit, ceiling, roster, outcome, created_at)
     values ($1, 'placeholder', $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [user, day, seed, score, hit, ceiling, JSON.stringify(roster(score)), `${score} touchdowns.`, at]);
}
const clear = () => owner("delete from century_runs");

await runTest("no client writes century_runs, and everybody reads it", async () => {
  await clear();
  await addRun({ user: ALICE, score: 88 });
  // Readable by anyone, like every other board on the site.
  for (const who of [null, ALICE, BOB, MOD]) {
    const r = await attempt(who, "select score from century_runs");
    assert(!r.error && r.rows.length === 1, `${who || "anon"} reads the board: ${JSON.stringify(r)}`);
  }
  // And written by nobody. RLS is on with a select policy and no insert or update policy at all, so these match
  // no policy - which PostgREST reports as a refusal and PGlite as zero rows affected or an error.
  const inserted = await attempt(ALICE,
    `insert into century_runs (user_id, username, seed, score, hit, ceiling, roster, outcome)
     values ($1, 'alice', 'CHEAT001', 400, true, 400, '[]'::jsonb, 'Century. 400 touchdowns.')`, [ALICE]);
  assert(inserted.error, `a player cannot insert their own run: ${JSON.stringify(inserted)}`);
  const updated = await attempt(ALICE, "update century_runs set score = 400 where user_id = $1", [ALICE]);
  assert(updated.error || updated.affected === 0, `nor edit one: ${JSON.stringify(updated)}`);
  const deleted = await attempt(ALICE, "delete from century_runs where user_id = $1", [ALICE]);
  assert(deleted.error || deleted.affected === 0, `nor delete one: ${JSON.stringify(deleted)}`);
  assert((await owner("select score from century_runs"))[0].score === 88, "the row is untouched");
});

await runTest("the name and the guest flag come from the account, never from the row", async () => {
  await clear();
  // 'placeholder' is written; use_account_username replaces it, the same trigger sou_runs and builds carry.
  await addRun({ user: ALICE, score: 70 });
  await addRun({ user: GUEST, score: 60 });
  const rows = await owner("select user_id, username, guest from century_runs order by score desc");
  assert(rows[0].username === "alice" && rows[0].guest === false, `alice's row: ${JSON.stringify(rows[0])}`);
  const guestName = (await owner("select username from profiles where id = $1", [GUEST]))[0].username;
  assert(rows[1].username === guestName && rows[1].guest === true,
    `a guest's row carries the generated name and the flag: ${JSON.stringify(rows[1])}`);
  // An account with no profile at all (signed in with Google, no name yet) cannot be written to this board.
  const nameless = uuid(9);
  await db.query("insert into auth.users (id, raw_user_meta_data, raw_app_meta_data) values ($1, null, $2)",
    [nameless, { provider: "google", providers: ["google"] }]);
  const r = await attempt(null, `insert into century_runs (user_id, username, seed, score, hit, ceiling, roster, outcome)
    values ($1, 'x', 'SEED0002', 1, false, 1, '[]'::jsonb, 'x')`, [nameless]).catch((e) => ({ error: String(e) }));
  const asOwner = await (async () => {
    try {
      await db.query(`insert into century_runs (user_id, username, seed, score, hit, ceiling, roster, outcome)
        values ($1, 'x', 'SEED0002', 1, false, 1, '[]'::jsonb, 'x')`, [nameless]);
      return { error: null };
    } catch (e) { return { error: String(e?.message || e) }; }
  })();
  assert(/no_profile/.test(asOwner.error || ""), `the trigger refuses an account with no profile: ${asOwner.error}`);
  void r;
});

await runTest("the daily is once per account, and Unlimited is unlimited", async () => {
  await clear();
  await addRun({ user: ALICE, day: "2026-01-02", score: 70 });
  let dupe = null;
  try { await addRun({ user: ALICE, day: "2026-01-02", score: 120 }); } catch (e) { dupe = String(e?.message || e); }
  assert(dupe && /unique|duplicate/i.test(dupe), `a second daily on the same date is refused: ${dupe}`);
  // Another date, and another account on the same date, are both fine.
  await addRun({ user: ALICE, day: "2026-01-03", score: 75 });
  await addRun({ user: BOB, day: "2026-01-02", score: 90 });
  // And Unlimited runs have no day, so any number of them land.
  for (let i = 0; i < 4; i++) await addRun({ user: ALICE, score: 50 + i });
  const counts = await owner("select count(*)::int as n, count(day)::int as dailies from century_runs");
  assert(counts[0].n === 7 && counts[0].dailies === 3, `rows: ${JSON.stringify(counts[0])}`);
});

await runTest("century_top and century_best answer exactly what the mock does", async () => {
  await clear();
  const mock = makeCentury({ profiles: new Map(), currentUserId: null });
  // Both sides get the same rows, in the same order, with ties on purpose: two accounts on the same score, and
  // one of them with an upper-case name, which is the only thing a collate "C" tiebreak and a locale one
  // disagree about.
  const rows = [
    { user: ALICE, name: "alice", day: "2026-01-02", score: 90 },
    { user: BOB, name: "Bob", day: "2026-01-02", score: 90 },
    { user: CAROL, name: "carol", day: "2026-01-02", score: 104, hit: true },
    { user: ALICE, name: "alice", day: null, score: 112, hit: true },
    { user: ALICE, name: "alice", day: null, score: 60 },
    { user: BOB, name: "Bob", day: null, score: 90 },
    { user: GUEST, name: null, day: "2026-01-02", score: 77 },
  ];
  const guestName = (await owner("select username from profiles where id = $1", [GUEST]))[0].username;
  mock.clear();
  let n = 0;
  for (const r of rows) {
    await addRun({ user: r.user, day: r.day, score: r.score, hit: !!r.hit });
    n++;
    mock.add({
      id: n, user_id: r.user, username: r.name ?? guestName, guest: r.user === GUEST,
      day: r.day, seed: "SEED0001", score: r.score, hit: !!r.hit, ceiling: r.score + 10,
      roster: roster(r.score), outcome: `${r.score} touchdowns.`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, clock - (rows.length - n))).toISOString(),
    });
  }

  const top = (await call(null, "century_top", { p_day: "2026-01-02", p_limit: 10 })).data;
  const topMock = mock.centuryTop({ p_day: "2026-01-02", p_limit: 10 });
  assert(!differs(top, topMock), `century_top differs at ${differs(top, topMock)}`);
  assert(top.length === 4 && top[0].score === 104, `the day's board, best first: ${JSON.stringify(top.map((r) => r.score))}`);
  // The order stated outright, not just "the two agree": alice and Bob are level on 90, and `created_at` breaks
  // that before the name is ever looked at, so the earlier row wins whatever it is called.
  const guestOnBoard = (await owner("select username from profiles where id = $1", [GUEST]))[0].username;
  assert(top.map((r) => r.username).join(",") === `carol,alice,Bob,${guestOnBoard}`,
    `score, then created_at: ${top.map((r) => r.username)}`);
  assert(top.some((r) => r.guest === true), "a guest on the board carries the flag, for the chip");

  const best = (await call(null, "century_best", { p_limit: 10 })).data;
  const bestMock = mock.centuryBest({ p_limit: 10 });
  assert(!differs(best, bestMock), `century_best differs at ${differs(best, bestMock)}`);
  assert(best.length === 4, `one row per account: ${best.length}`);
  const alice = best.find((r) => r.username === "alice");
  assert(alice.score === 112 && alice.runs === 3 && alice.centuries === 1,
    `alice's best, her run count and her centuries: ${JSON.stringify(alice)}`);
  assert(alice.daily === false, "and it says that best was an Unlimited run");

  // A day nobody played, and the limit clamp - a board is never asked for one row or for a thousand.
  assert(JSON.stringify((await call(null, "century_top", { p_day: "1999-01-01", p_limit: 10 })).data) === "[]",
    "a day with no runs is an empty board, not null");
  for (const [limit, expect] of [[0, 1], [null, 4], [500, 4], [-3, 1]]) {
    const r = (await call(null, "century_top", { p_day: "2026-01-02", p_limit: limit })).data;
    assert(r.length === Math.min(expect, 4), `p_limit ${limit} gives ${r.length}, wanted ${Math.min(expect, 4)}`);
    const m = mock.centuryTop({ p_day: "2026-01-02", p_limit: limit });
    assert(!differs(r, m), `the mock agrees at p_limit ${limit}: ${differs(r, m)}`);
  }
});

await runTest("a tie the timestamp cannot break falls to the name, compared by byte", async () => {
  // The last tiebreak, which nothing above reaches because created_at always differs there. It matters because
  // `collate "C"` is a byte comparison and a locale collation is not: under "C" every upper-case letter sorts
  // before every lower-case one, so "Bob" comes before "alice" - and the mock has to compare the same way or the
  // app's board and every jsdom test's board disagree about two accounts level on the same score.
  await clear();
  const at = new Date(Date.UTC(2026, 2, 3, 4, 5, 6)).toISOString();
  for (const user of [CAROL, ALICE, BOB]) {
    await owner(
      `insert into century_runs (user_id, username, day, seed, score, hit, ceiling, roster, outcome, created_at)
       values ($1, 'placeholder', '2026-03-03', 'SEED0003', 90, false, 100, '[]'::jsonb, '90 touchdowns.', $2)`,
      [user, at]);
  }
  const top = (await call(null, "century_top", { p_day: "2026-03-03", p_limit: 10 })).data;
  assert(top.map((r) => r.username).join(",") === "Bob,alice,carol",
    `upper case first, under the C collation: ${top.map((r) => r.username)}`);
  const mock = makeCentury({ profiles: new Map(), currentUserId: null });
  // Added in the same order the rows went into Postgres, so only the name can break the tie.
  [[1, CAROL, "carol"], [2, ALICE, "alice"], [3, BOB, "Bob"]].forEach(([id, user, username]) => {
    mock.add({
      id, user_id: user, username, guest: false, day: "2026-03-03", seed: "SEED0003",
      score: 90, hit: false, ceiling: 100, roster: [], outcome: "90 touchdowns.", created_at: at,
    });
  });
  const m = mock.centuryTop({ p_day: "2026-03-03", p_limit: 10 });
  assert(!differs(top, m), `and the mock breaks it identically: ${differs(top, m)}`);
});

await runTest("a moderator's rename reaches this board too", async () => {
  await clear();
  await addRun({ user: BOB, day: "2026-01-04", score: 81 });
  assert((await owner("select username from century_runs"))[0].username === "Bob", "it starts as Bob");
  const r = await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: "robert" });
  assert(!r.error, `the rename works: ${JSON.stringify(r)}`);
  const after = (await owner("select username, guest from century_runs"))[0];
  assert(after.username === "robert", `and the board follows it: ${JSON.stringify(after)}`);
});

await runTest("a guest keeping their seasons takes this board's rows with them", async () => {
  await clear();
  await addRun({ user: GUEST, score: 66 });
  const before = (await owner("select username, guest from century_runs"))[0];
  assert(before.guest === true, `it starts as a guest's row: ${JSON.stringify(before)}`);
  await attachEmail(db, GUEST);
  const r = await call(GUEST, "claim_username", { p_username: "keeper" });
  assert(r.data === "ok", `the trade-up works: ${JSON.stringify(r)}`);
  const after = (await owner("select username, guest from century_runs"))[0];
  assert(after.username === "keeper" && after.guest === false,
    `and the row is theirs under the real name, with no chip: ${JSON.stringify(after)}`);
});

await runTest("claim_minigame pays a Century day, once", async () => {
  await clear();
  const today = new Date().toISOString().slice(0, 10);
  // Not played: no coins, and a reason rather than a silent zero.
  const none = await call(ALICE, "claim_minigame", { p_game: "century", p_date: today });
  assert(/not_played/.test(none.error || ""), `nothing to claim before playing: ${JSON.stringify(none)}`);
  await addRun({ user: ALICE, day: today, score: 84, now: true });
  const first = await call(ALICE, "claim_minigame", { p_game: "century", p_date: today });
  assert(!first.error && first.data.credited === 15, `15 coins: ${JSON.stringify(first)}`);
  const again = await call(ALICE, "claim_minigame", { p_game: "century", p_date: today });
  assert(!again.error && again.data.credited === 0, `and not twice: ${JSON.stringify(again)}`);
  // An Unlimited run counts as having played too - the mode is one game either way.
  await clear();
  await addRun({ user: BOB, score: 71, now: true });
  const unlimited = await call(BOB, "claim_minigame", { p_game: "century", p_date: today });
  assert(!unlimited.error && unlimited.data.credited === 15, `an Unlimited run pays as well: ${JSON.stringify(unlimited)}`);
  // And the ledger key is the game plus the day, so Century and Over/Under don't share one.
  const kinds = await owner("select ref from wallet_ledger where kind = 'minigame' order by ref");
  assert(kinds.every((k) => k.ref.startsWith("century:")), `the ledger keys are Century's own: ${JSON.stringify(kinds)}`);
});

await runTest("re-running the migration changes nothing", async () => {
  await clear();
  await addRun({ user: ALICE, day: "2026-01-05", score: 95 });
  await db.exec(sql("migration-century.sql"));
  const rows = await owner("select username, score from century_runs");
  assert(rows.length === 1 && rows[0].score === 95, `the row survives: ${JSON.stringify(rows)}`);
  // And the table is still not client-writable after a re-run - the policies are dropped every time.
  const r = await attempt(ALICE, `insert into century_runs (user_id, username, seed, score, hit, ceiling, roster, outcome)
    values ($1, 'alice', 'CHEAT002', 400, true, 400, '[]'::jsonb, 'x')`, [ALICE]);
  assert(r.error, `still nobody's to write: ${JSON.stringify(r)}`);
});

console.log("test-century-sql.mjs done");
