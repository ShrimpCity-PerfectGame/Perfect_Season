// Closing an account, in real Postgres through tests/pg-fixture.mjs. Until v2.20.0 there was no way to do it
// at all, while /privacy and /terms both promised one.
//
// It ANONYMISES rather than deletes, and the reason is measured. Every foreign key from a player cascades -
// 22 of them, not one RESTRICT - so `delete from auth.users` empties all 21 public tables in one statement,
// and takes three things with it that nobody asked for: the OTHER player's half of every duel, the sitewide
// totals, and - proved below - a gold badge paid to a stranger, because the daily rank that decides it is
// computed live from who else played that day. Anonymising leaves every row where it is, so nothing moves.
//
// What this file holds is the contract: the person is gone, the games are not, and nobody else is touched.
import { assert, runTest } from "./helpers.mjs";
import { freshDb, addAccount, asUser, asAnon, uuid } from "./pg-fixture.mjs";

const db = await freshDb();
const GOING = uuid(1), STAYING = uuid(2), STRANGER = uuid(3);
await addAccount(db, { id: GOING, username: "leaver" });
await addAccount(db, { id: STAYING, username: "stayer" });
await addAccount(db, { id: STRANGER, username: "stranger" });

const owner = async (q, p) => (await db.query(q, p)).rows;
const call = async (who, q, p) => {
  const run = async () => (await db.query(q, p)).rows;
  return who ? asUser(db, who, run) : asAnon(db, run);
};
const one = async (q, p) => (await owner(q, p))[0];
const countOf = async (table, col = "user_id", id = GOING) =>
  Number((await one(`select count(*)::int as n from ${table} where ${col} = $1`, [id])).n);

// A full life: a season, a daily, every mini-game, a duel against STAYING, a bio, a picture, coins, an item,
// a badge and a report. Everything an account can accumulate, so the test says something about all of it.
await owner("insert into profile_details (user_id, bio, avatar_path, favorite_team) values ($1, 'my bio', $2, 'KC')",
  [GOING, `${GOING}/1700000000000.webp`]);
await owner("insert into runs (user_id, username, ladder, format, score, w, l, outcome) values ($1, 'leaver', 'unlimited', 'fantasy', 400, 15, 2, 'Lost the final.')", [GOING]);
await owner("insert into daily_runs (date, format, user_id, username, w, l, score, outcome) values (current_date - 2, 'fantasy', $1, 'leaver', 17, 0, 420, 'Perfect season. 20-0.')", [GOING]);
await owner("insert into sou_runs (date, user_id, username, score) values (current_date - 1, $1, 'leaver', 9)", [GOING]);
await owner("insert into builds (user_id, username, pos, overall, filled) values ($1, 'leaver', 'QB', 88, '[]'::jsonb)", [GOING]);
await owner("insert into century_runs (user_id, username, seed, score, hit, ceiling, roster, outcome, day) values ($1, 'leaver', 'c1', 96, false, 110, '[]'::jsonb, '96 touchdowns.', current_date)", [GOING]);
await owner("insert into guess_runs (user_id, username, solved, tries, guesses, answer, outcome, day) values ($1, 'leaver', true, 3, '[]'::jsonb, 'someone', 'Got it in 3.', current_date)", [GOING]);
// The profile trigger already made a wallet with the welcome coins; wallet_apply keeps it and the ledger in
// step, which a hand-written insert cannot (wallets_balance_adds_up).
await owner("select wallet_apply($1, 900, 'season', 'r1')", [GOING]);
await owner("insert into inventory (user_id, item_id) values ($1, 'frame-lime')", [GOING]);
await owner("insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [GOING]);
await owner("insert into finished_codes (user_id, code) values ($1, 'ABC123')", [GOING]);
await owner("insert into reports (reporter_id, target_id, reason) values ($1, $2, 'username')", [GOING, STRANGER]);
await owner("insert into matches (code, host_id, guest_id, format, status) values ('DUEL01', $1, $2, 'fantasy', 'done')", [GOING, STAYING]);
await owner("insert into match_picks (match_id, user_id, pick_no, board_idx, slot, kind, player_id, season) select id, $1, 1, 0, 'QB', 'player', 101, 2011 from matches where code = 'DUEL01'", [GOING]);
await owner("insert into match_picks (match_id, user_id, pick_no, board_idx, slot, kind, player_id, season) select id, $1, 2, 0, 'RB', 'player', 102, 2012 from matches where code = 'DUEL01'", [STAYING]);
await owner("update profiles set pvp_wins = 1 where id = $1", [STAYING]);
await owner("update profiles set pvp_losses = 1 where id = $1", [GOING]);

await runTest("nobody can close somebody else's account", async () => {
  const asStranger = await call(STRANGER, "select delete_account($1) as r", [GOING]);
  assert(asStranger[0].r.error === "not_yours", `a stranger is refused: ${JSON.stringify(asStranger[0].r)}`);
  // Signed out, it is not refused - it cannot be REACHED. anon has no execute grant at all, which is a
  // stronger guarantee than an error inside the function and the shape every destructive function here uses.
  let reached = true;
  try { await call(null, "select delete_account($1) as r", [GOING]); } catch (e) { reached = !/permission denied/i.test(String(e && e.message)); }
  assert(!reached, "signed out, the function cannot even be called");
  assert((await one("select username from profiles where id = $1", [GOING])).username === "leaver",
    "neither of them changed anything");
});

await runTest("closing it erases the person and keeps the games", async () => {
  const before = {};
  for (const t of ["runs", "daily_runs", "sou_runs", "builds", "century_runs", "guess_runs"]) before[t] = await countOf(t);
  assert(Object.values(before).every((n) => n === 1), `one of each to start: ${JSON.stringify(before)}`);

  const r = (await call(GOING, "select delete_account() as r", []))[0].r;
  assert(r.ok, `it closes: ${JSON.stringify(r)}`);
  assert(/^Deleted_[0-9a-f]{8}$/.test(r.name), `renamed to a tombstone: ${r.name}`);
  // The picture is the one thing SQL cannot reach, so the path comes back for the caller to delete. Returning
  // it AFTER deleting profile_details would be useless - the row is the only record of whose file it was.
  assert(r.avatar_path === `${GOING}/1700000000000.webp`, `and hands back the picture to delete: ${r.avatar_path}`);

  // The person.
  assert((await one("select username from profiles where id = $1", [GOING])).username === r.name, "the name is gone");
  for (const t of ["profile_details", "wallets", "wallet_ledger", "inventory", "badge_awards", "finished_codes"]) {
    assert((await countOf(t)) === 0, `${t} is empty`);
  }
  assert((await countOf("reports", "reporter_id")) === 0, "reports they filed are gone");

  // The games: still there, still theirs by uuid, and now under the tombstone on every board that shows a name.
  for (const t of ["runs", "daily_runs", "sou_runs", "builds", "century_runs", "guess_runs"]) {
    assert((await countOf(t)) === 1, `${t} still holds the season they played`);
    const row = await one(`select username from ${t} where user_id = $1`, [GOING]);
    assert(row.username === r.name, `${t}'s name snapshot is the tombstone, not "leaver": ${row.username}`);
  }
  // ...and nothing anywhere still says who they were.
  for (const t of ["profiles", "runs", "daily_runs", "sou_runs", "builds", "century_runs", "guess_runs"]) {
    const left = await one(`select count(*)::int as n from ${t} where username = 'leaver'`);
    assert(left.n === 0, `no row in ${t} still reads "leaver"`);
  }
});

await runTest("the other player keeps their duel, their picks and their record", async () => {
  // This is the whole reason it anonymises. A real delete cascades matches.host_id AND guest_id, so the
  // opponent loses the match, its picks and its link - while keeping the win on their profile, because the
  // pvp counters are plain columns no foreign key moves.
  assert(Number((await one("select count(*)::int as n from matches where code = 'DUEL01'")).n) === 1,
    "the duel is still there");
  const picks = await one("select count(*)::int as n from match_picks p join matches m on m.id = p.match_id where m.code = 'DUEL01'");
  assert(Number(picks.n) === 2, `both players' picks survive: ${picks.n}`);
  const stayer = await one("select username, pvp_wins from profiles where id = $1", [STAYING]);
  assert(stayer.username === "stayer" && Number(stayer.pvp_wins) === 1,
    `and the opponent is untouched: ${JSON.stringify(stayer)}`);
  // The closed account still answers for its side of it, under the tombstone, so the match reads whole.
  const names = await owner("select p.username from match_picks mp join profiles p on p.id = mp.user_id join matches m on m.id = mp.match_id where m.code = 'DUEL01' order by mp.pick_no");
  assert(names.length === 2 && /^Deleted_/.test(names[0].username) && names[1].username === "stayer",
    `both sides have a name: ${JSON.stringify(names.map((n) => n.username))}`);
});

await runTest("nobody can take a closed account's name, or look like one", async () => {
  // The same rule guests have, and for the same reason: those seasons are still on the boards, so a player
  // who could call themselves Deleted_something would be claiming a stranger's record.
  const taken = await one("select check_username($1) as r", ["Deleted_1234abcd"]);
  assert(taken.r === "taken", `the exact shape is refused: ${taken.r}`);
  const other = await one("select check_username($1) as r", ["deleted_player"]);
  assert(other.r === "taken", `and any Deleted_-shaped name, not just the generated one: ${other.r}`);
  // ...while an ordinary name that merely contains the word is fine. The rule is about the shape.
  const fine = await one("select check_username($1) as r", ["undeleted"]);
  assert(fine.r === "ok", `a name that only contains the word is still allowed: ${fine.r}`);
});

await runTest("closing an account twice is not an error, and not a second erasure", async () => {
  // A request that arrives twice - the player taps again, or writes in after using the button - must not
  // fail and must not do anything new.
  const again = (await call(GOING, "select delete_account() as r", []))[0].r;
  assert(again.ok, `the second call answers ok: ${JSON.stringify(again)}`);
  assert(again.avatar_path === null, "with no picture to delete the second time");
  assert(Number((await one("select count(*)::int as n from runs where user_id = $1", [GOING])).n) === 1,
    "and the games are still exactly where they were");
});

console.log("test-delete-account.mjs done");
