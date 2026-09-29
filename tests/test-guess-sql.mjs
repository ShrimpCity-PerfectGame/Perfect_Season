// Guess the Player's database half, in real Postgres through tests/pg-fixture.mjs: the table nobody writes from
// a client, the daily being once per account, both boards held to tests/mock-guess.mjs row for row, and a rename
// reaching this board too.
//
// That last one is why this file exists rather than trusting the migration: `guest` and `username` are snapshots
// on every board, and CLAUDE.md records that each of them had to be given that treatment separately, one at a
// time, because nothing makes a new board inherit it. This is the tenth.
import { assert, runTest } from "./helpers.mjs";
import { freshDb, addAccount, addGuestAccount, attachEmail, asUser, asAnon, uuid, sql } from "./pg-fixture.mjs";
import { makeGuess } from "./mock-guess.mjs";

const db = await freshDb();
const ALICE = uuid(1), BOB = uuid(2), CAROL = uuid(3), GUEST = uuid(4), MOD = uuid(5);
await addAccount(db, { id: ALICE, username: "alice" });
await addAccount(db, { id: BOB, username: "Bob" });   // upper case on purpose: the collate "C" tiebreak
await addAccount(db, { id: CAROL, username: "carol" });
await addAccount(db, { id: MOD, username: "mod" });
await addGuestAccount(db, GUEST);
await db.query("insert into moderators (user_id) values ($1)", [MOD]);

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
const differs = (s, m) => firstDiff(canon(s), canon(m));

const owner = async (statement, params) => (await db.query(statement, params)).rows;
async function attempt(who, statement, params) {
  const run = async () => {
    try {
      const r = await db.query(statement, params);
      return { rows: r.rows, affected: r.affectedRows ?? 0 };
    } catch (e) { return { error: String(e?.message || e) }; }
  };
  return who ? asUser(db, who, run) : asAnon(db, run);
}
async function call(who, fn, args) {
  const names = Object.keys(args);
  const res = await attempt(who, `select ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, names.map((n) => args[n]));
  return res.error ? { error: res.error } : { data: res.rows[0].r };
}

let clock = 0;
async function addRun({ user, day = null, solved, tries, now = false }) {
  clock++;
  const at = now ? new Date().toISOString() : new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
  await owner(
    `insert into guess_runs (user_id, username, day, seed, solved, tries, guesses, answer, outcome, created_at)
     values ($1, 'placeholder', $2, null, $3, $4, $5::jsonb, 'Someone|2015|QB', $6, $7)`,
    [user, day, solved, tries, JSON.stringify(["A|2015|QB"]), solved ? `Got it in ${tries}.` : "Missed. 8 guesses.", at]);
}
const clear = () => owner("delete from guess_runs");

await runTest("no client writes guess_runs, and everybody reads it", async () => {
  await clear();
  await addRun({ user: ALICE, solved: true, tries: 3 });
  for (const who of [null, ALICE, BOB, MOD]) {
    const r = await attempt(who, "select tries from guess_runs");
    assert(!r.error && r.rows.length === 1, `${who || "anon"} reads the board: ${JSON.stringify(r)}`);
  }
  const inserted = await attempt(ALICE,
    `insert into guess_runs (user_id, username, solved, tries, guesses, answer, outcome)
     values ($1, 'alice', true, 1, '[]'::jsonb, 'x', 'Got it first guess.')`, [ALICE]);
  assert(inserted.error, `a player cannot insert their own run: ${JSON.stringify(inserted)}`);
  const updated = await attempt(ALICE, "update guess_runs set tries = 1 where user_id = $1", [ALICE]);
  assert(updated.error || updated.affected === 0, `nor edit one: ${JSON.stringify(updated)}`);
  assert((await owner("select tries from guess_runs"))[0].tries === 3, "the row is untouched");
});

await runTest("tries has to be a real number of guesses", async () => {
  await clear();
  for (const bad of [0, 9, -1]) {
    let err = null;
    try { await addRun({ user: ALICE, solved: false, tries: bad }); } catch (e) { err = String(e?.message || e); }
    assert(err, `${bad} guesses is refused by the table itself: ${err}`);
  }
  await addRun({ user: ALICE, solved: true, tries: 1 });
  await addRun({ user: BOB, solved: false, tries: 8 });
  assert((await owner("select count(*)::int as n from guess_runs"))[0].n === 2, "one and eight are both fine");
});

await runTest("the name and the guest flag come from the account", async () => {
  await clear();
  await addRun({ user: ALICE, solved: true, tries: 2 });
  await addRun({ user: GUEST, solved: false, tries: 8 });
  const rows = await owner("select username, guest from guess_runs order by tries");
  assert(rows[0].username === "alice" && rows[0].guest === false, `alice's row: ${JSON.stringify(rows[0])}`);
  const guestName = (await owner("select username from profiles where id = $1", [GUEST]))[0].username;
  assert(rows[1].username === guestName && rows[1].guest === true, `a guest's row: ${JSON.stringify(rows[1])}`);
});

await runTest("the daily is once per account, and practice is unlimited", async () => {
  await clear();
  await addRun({ user: ALICE, day: "2026-01-02", solved: true, tries: 4 });
  let dupe = null;
  try { await addRun({ user: ALICE, day: "2026-01-02", solved: true, tries: 2 }); } catch (e) { dupe = String(e?.message || e); }
  assert(dupe && /unique|duplicate/i.test(dupe), `a second daily on the same date is refused: ${dupe}`);
  await addRun({ user: ALICE, day: "2026-01-03", solved: false, tries: 8 });
  await addRun({ user: BOB, day: "2026-01-02", solved: true, tries: 6 });
  for (let i = 0; i < 4; i++) await addRun({ user: ALICE, solved: true, tries: 5 });
  const c = (await owner("select count(*)::int as n, count(day)::int as d from guess_runs"))[0];
  assert(c.n === 7 && c.d === 3, `rows: ${JSON.stringify(c)}`);
});

await runTest("guess_top and guess_best answer exactly what the mock does", async () => {
  await clear();
  const mock = makeGuess({ profiles: new Map(), currentUserId: null });
  mock.clear();
  const guestName = (await owner("select username from profiles where id = $1", [GUEST]))[0].username;
  // Ties on purpose: two solved in four, one of them upper-case named; a miss; and an account that has played
  // dailies but never solved one, which is what `avg_tries nulls last` is for.
  const rows = [
    { user: ALICE, name: "alice", day: "2026-01-02", solved: true, tries: 4 },
    { user: BOB, name: "Bob", day: "2026-01-02", solved: true, tries: 4 },
    { user: CAROL, name: "carol", day: "2026-01-02", solved: true, tries: 2 },
    { user: GUEST, name: guestName, day: "2026-01-02", solved: false, tries: 8 },
    { user: ALICE, name: "alice", day: "2026-01-03", solved: true, tries: 6 },
    { user: BOB, name: "Bob", day: "2026-01-03", solved: false, tries: 8 },
    { user: CAROL, name: "carol", day: null, solved: true, tries: 1 },
  ];
  let n = 0;
  for (const r of rows) {
    await addRun({ user: r.user, day: r.day, solved: r.solved, tries: r.tries });
    n++;
    mock.add({
      id: n, user_id: r.user, username: r.name, guest: r.user === GUEST, day: r.day, seed: null,
      solved: r.solved, tries: r.tries, guesses: ["A|2015|QB"], answer: "Someone|2015|QB",
      outcome: r.solved ? `Got it in ${r.tries}.` : "Missed. 8 guesses.",
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, clock - (rows.length - n))).toISOString(),
    });
  }

  const top = (await call(null, "guess_top", { p_day: "2026-01-02", p_limit: 10 })).data;
  const topMock = mock.rpcs.guess_top({ p_day: "2026-01-02", p_limit: 10 });
  assert(!differs(top, topMock), `guess_top differs at ${differs(top, topMock)}`);
  assert(top.map((r) => r.username).join(",") === `carol,alice,Bob,${guestName}`,
    `solved first, then fewest guesses, then earliest: ${top.map((r) => r.username)}`);
  assert(top[top.length - 1].solved === false, "an unsolved game sorts last however few guesses it took");

  const best = (await call(null, "guess_best", { p_limit: 10 })).data;
  const bestMock = mock.rpcs.guess_best({ p_limit: 10 });
  assert(!differs(best, bestMock), `guess_best differs at ${differs(best, bestMock)}`);
  const alice = best.find((r) => r.username === "alice");
  assert(alice.dailies === 2 && alice.solved === 2, `alice played two and solved two: ${JSON.stringify(alice)}`);
  assert(Number(alice.avgTries) === 5, `averaging five: ${alice.avgTries}`);
  // The practice game must not count towards the all-time board - it is the daily's board.
  const carol = best.find((r) => r.username === "carol");
  assert(carol.dailies === 1 && carol.solved === 1, `carol's practice game is not counted: ${JSON.stringify(carol)}`);

  assert(JSON.stringify((await call(null, "guess_top", { p_day: "1999-01-01", p_limit: 10 })).data) === "[]",
    "a day nobody played is an empty board, not null");
  for (const [limit, expect] of [[0, 1], [null, 4], [500, 4], [-3, 1]]) {
    const r = (await call(null, "guess_top", { p_day: "2026-01-02", p_limit: limit })).data;
    assert(r.length === Math.min(expect, 4), `p_limit ${limit} gives ${r.length}`);
    assert(!differs(r, mock.rpcs.guess_top({ p_day: "2026-01-02", p_limit: limit })), `and the mock agrees at ${limit}`);
  }
});

await runTest("a moderator's rename and a guest's trade-up both reach this board", async () => {
  await clear();
  await addRun({ user: BOB, day: "2026-01-04", solved: true, tries: 5 });
  assert(!(await call(MOD, "mod_act", { p_user_id: BOB, p_action: "rename", p_new_name: "robert" })).error, "the rename works");
  assert((await owner("select username from guess_runs"))[0].username === "robert", "and the board follows it");

  await clear();
  await addRun({ user: GUEST, solved: false, tries: 8 });
  assert((await owner("select guest from guess_runs"))[0].guest === true, "it starts as a guest's row");
  await attachEmail(db, GUEST);
  assert((await call(GUEST, "claim_username", { p_username: "keeper" })).data === "ok", "the trade-up works");
  const after = (await owner("select username, guest from guess_runs"))[0];
  assert(after.username === "keeper" && after.guest === false, `and the row is theirs: ${JSON.stringify(after)}`);
});

await runTest("claim_minigame pays a Guess day, once", async () => {
  await clear();
  const today = new Date().toISOString().slice(0, 10);
  const none = await call(ALICE, "claim_minigame", { p_game: "guess", p_date: today });
  assert(/not_played/.test(none.error || ""), `nothing to claim before playing: ${JSON.stringify(none)}`);
  await addRun({ user: ALICE, day: today, solved: true, tries: 3, now: true });
  const first = await call(ALICE, "claim_minigame", { p_game: "guess", p_date: today });
  assert(!first.error && first.data.credited === 15, `15 coins: ${JSON.stringify(first)}`);
  const again = await call(ALICE, "claim_minigame", { p_game: "guess", p_date: today });
  assert(!again.error && again.data.credited === 0, `and not twice: ${JSON.stringify(again)}`);
  const refs = await owner("select ref from wallet_ledger where kind = 'minigame'");
  assert(refs.every((r) => r.ref.startsWith("guess:")), `its own ledger key: ${JSON.stringify(refs)}`);
});

await runTest("re-running the migration changes nothing", async () => {
  await clear();
  await addRun({ user: ALICE, day: "2026-01-09", solved: true, tries: 2 });
  await db.exec(sql("migration-guess.sql"));
  const rows = await owner("select tries from guess_runs");
  assert(rows.length === 1 && rows[0].tries === 2, `the row survives: ${JSON.stringify(rows)}`);
  const r = await attempt(ALICE, `insert into guess_runs (user_id, username, solved, tries, guesses, answer, outcome)
    values ($1, 'alice', true, 1, '[]'::jsonb, 'x', 'y')`, [ALICE]);
  assert(r.error, `still nobody's to write: ${JSON.stringify(r)}`);
});

console.log("test-guess-sql.mjs done");
