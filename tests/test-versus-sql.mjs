// 1v1's database half (VERSUS.md 3), in real Postgres through tests/pg-fixture.mjs: the two tables nobody can
// write from a client, opening a lobby, taking an invite, and reading a match back. Everything that decides a
// *pick* lives in the Edge Function instead, because it needs game-logic.mjs - tests/test-versus-rules.mjs has
// those.
import { assert, runTest } from "./helpers.mjs";
import { freshDb, addAccount, addGuestAccount, asUser, asAnon, uuid, sql } from "./pg-fixture.mjs";

const db = await freshDb();
const HOST = uuid(1), GUEST = uuid(2), OTHER = uuid(3), ANON_GUEST = uuid(4);
await addAccount(db, { id: HOST, username: "host" });
await addAccount(db, { id: GUEST, username: "opponent" });
await addAccount(db, { id: OTHER, username: "third" });
await addGuestAccount(db, ANON_GUEST);

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
const guestNameOf = async (id) => (await owner("select username from profiles where id = $1", [id]))[0]?.username;

await runTest("a client can read matches and picks, and write neither", async () => {
  const match = (await call(HOST, "create_match", { p_format: "fantasy" })).data;
  assert(match?.code, `a lobby, got ${JSON.stringify(match)}`);

  for (const who of [null, GUEST]) {
    const read = await attempt(who, "select code from matches");
    assert(!read.error && read.rows.length > 0, `${who ? "a player" : "anyone"} can read matches: ${JSON.stringify(read)}`);
    const picks = await attempt(who, "select * from match_picks");
    assert(!picks.error, `and the picks: ${JSON.stringify(picks)}`);

    for (const [what, statement, params] of [
      ["insert a match", "insert into matches (code, host_id) values ('ZZZZZZ', $1)", [GUEST]],
      ["change one", "update matches set status = 'done' where code = $1", [match.code]],
      ["delete one", "delete from matches where code = $1", [match.code]],
      ["insert a pick", "insert into match_picks (match_id, pick_no, user_id, board_idx, kind, player_id, season, slot) values ($1, 1, $2, 0, 'player', 5, 2007, 'QB')", [match.id, GUEST]],
    ]) {
      const res = await attempt(who, statement, params);
      const blocked = !!res.error || res.affected === 0;
      assert(blocked, `nobody may ${what}: ${JSON.stringify(res)}`);
    }
  }
});

await runTest("opening a lobby: signed in, not a guest, and only one at a time", async () => {
  assert((await call(null, "create_match", { p_format: "fantasy" })).error, "signed out, it can't even be called");
  assert((await call(ANON_GUEST, "create_match", { p_format: "fantasy" })).data?.error === "guest_not_allowed",
    `a guest is refused - it costs nothing to make another one, got ${JSON.stringify(await guestNameOf(ANON_GUEST))}`);

  const first = (await call(OTHER, "create_match", { p_format: "standard" })).data;
  assert(/^[A-HJ-NP-Z2-9]{6}$/.test(first.code), `a code you can read aloud, got ${first.code}`);
  assert(first.format === "standard" && first.status === "open" && first.guestId === null, `an open lobby, got ${JSON.stringify(first)}`);
  assert(first.hostName === "third", "it knows whose it is");
  const again = (await call(OTHER, "create_match", { p_format: "fantasy" })).data;
  assert(again.code === first.code, `asking twice gives back the same lobby, got ${again.code} then ${first.code}`);
  assert((await owner("select count(*)::int as n from matches where host_id = $1", [OTHER]))[0].n === 1, "and leaves one row, not two");
});

await runTest("taking an invite: the first one through the link is the opponent", async () => {
  const code = (await call(HOST, "create_match", {})).data.code;
  assert((await call(GUEST, "join_match", { p_code: "NOPE12" })).data?.error === "not_found", "a code nobody has");
  assert((await call(ANON_GUEST, "join_match", { p_code: code })).data?.error === "guest_not_allowed", "a guest can't take one either");
  assert((await call(HOST, "join_match", { p_code: code })).data?.code === code, "the host opening their own link gets their lobby back");

  const joined = (await call(GUEST, "join_match", { p_code: code.toLowerCase() })).data;
  assert(joined.guestId === GUEST && joined.status === "drafting", `joining starts the draft, got ${JSON.stringify(joined)}`);
  assert(joined.guestName === "opponent", "and says who joined");
  assert(joined.turnDeadline, "with a clock running on the first pick");
  assert(typeof joined.picks === "object" && joined.picks.length === 0, "and no picks yet");

  assert((await call(GUEST, "join_match", { p_code: code })).data?.code === code, "the opponent reopening the link gets the match back");
  assert((await call(OTHER, "join_match", { p_code: code })).data?.error === "already_full", "a third person is told it's full");
  assert((await call(HOST, "join_match", { p_code: code })).data?.error === "own_match", "and the host can't join their own started match");
});

await runTest("anything taken in a match is gone, for both sides", async () => {
  const code = (await call(HOST, "create_match", {})).data.code;
  await call(GUEST, "join_match", { p_code: code });
  const id = (await owner("select id from matches where code = $1", [code]))[0].id;
  const pick = (no, who, board, { player = null, team = null, kind = "player", season = 2007, slot }) => owner(
    "insert into match_picks (match_id, pick_no, user_id, board_idx, kind, player_id, team, season, slot) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [id, no, who, board, kind, player, team, season, slot]);
  const refusal = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };

  await pick(1, HOST, 0, { player: 42, slot: "QB" });
  assert(/duplicate|unique/i.test(await refusal(() => pick(2, GUEST, 0, { player: 42, slot: "QB" })) || ""),
    "the other player can't take the same player");
  await pick(2, GUEST, 0, { player: 43, slot: "QB" }); // someone else from the same board is fine

  // A defense and a kicker are drafted off the same board as the players (VERSUS.md 6), and the same rule holds.
  await pick(3, GUEST, 1, { kind: "dst", team: "BAL", season: 2006, slot: "DST" });
  assert(/duplicate|unique/i.test(await refusal(() => pick(4, HOST, 1, { kind: "dst", team: "BAL", season: 2006, slot: "DST" })) || ""),
    "nor the same defense");
  // ...but a team's kicker is not its defense, even in the same year, and neither is another year's defense.
  await pick(4, HOST, 1, { kind: "k", team: "BAL", season: 2006, slot: "K" });
  await pick(5, HOST, 2, { kind: "dst", team: "BAL", season: 2007, slot: "DST" });

  // The identity has to match the kind, so a defense can never be read as player 0 or a player as some team's.
  assert(await refusal(() => pick(6, GUEST, 2, { kind: "dst", player: 9, slot: "DST" })), "a defense with a player id is refused");
  assert(await refusal(() => pick(6, GUEST, 2, { kind: "player", team: "BAL", slot: "RB" })), "and a player with a team");
  assert((await owner("select count(*)::int as n from match_picks where match_id = $1", [id]))[0].n === 5, "the five good picks are recorded");
});

await runTest("match_state reads the whole thing back, for a reload or a stranger", async () => {
  const code = (await call(HOST, "create_match", {})).data.code;
  await call(GUEST, "join_match", { p_code: code });
  const id = (await owner("select id from matches where code = $1", [code]))[0].id;
  await owner("insert into match_picks (match_id, pick_no, user_id, board_idx, kind, player_id, season, slot) values ($1, 1, $2, 0, 'player', 7, 2011, 'RB')", [id, HOST]);
  await owner("insert into match_picks (match_id, pick_no, user_id, board_idx, kind, team, season, slot) values ($1, 2, $2, 0, 'dst', 'CHI', 2006, 'DST')", [id, GUEST]);

  for (const who of [null, HOST, OTHER]) {
    const state = (await call(who, "match_state", { p_code: code })).data;
    assert(state?.code === code && state.picks.length === 2, `${who || "anyone"} can read it: ${JSON.stringify(state).slice(0, 120)}`);
    assert(state.picks[0].slot === "RB" && state.picks[0].playerId === 7 && state.picks[0].kind === "player", "with the picks in it");
    assert(state.picks[1].kind === "dst" && state.picks[1].team === "CHI" && state.picks[1].playerId === null,
      `and a defense reads back as one: ${JSON.stringify(state.picks[1])}`);
    assert(state.picks[0].stolenBy === null && state.picks[1].stolenBy === null, "nothing was stolen here");
    // A reconnecting client rebuilds the boards from these two (VERSUS.md 7), so they can never be missing.
    assert(Array.isArray(state.respins) && state.respins.length === 0, `re-spins come back as a list: ${JSON.stringify(state.respins)}`);
  }
  assert((await call(HOST, "match_state", { p_code: "nosuch" })).data === null, "and nothing for a code nobody has");

  // A stolen pick reads back as a SIDE, not an id: it is what a client rebuilds the match from, and
  // versus-logic.mjs's replayMatch thinks in host/guest. Read back as an id it silently filled nobody's roster.
  await owner("update match_picks set user_id = $1, stolen_by = $1 where match_id = $2 and pick_no = 1", [GUEST, id]);
  const stolen = (await call(null, "match_state", { p_code: code })).data;
  assert(stolen.picks[0].stolenBy === "guest", `the thief is a side, got ${JSON.stringify(stolen.picks[0].stolenBy)}`);
  await owner("update match_picks set stolen_by = $1 where match_id = $2 and pick_no = 1", [HOST, id]);
  assert((await call(null, "match_state", { p_code: code })).data.picks[0].stolenBy === "host", "and the host reads back as the host");
});

await runTest("every function this migration adds is definer, searches pg_temp last, and is granted deliberately", async () => {
  // The same guard tests/test-profile-security.mjs keeps over its own migrations: a new function here needs a
  // line here, saying who may call it. [security definer, search_path, anon may execute, authenticated may]
  const expected = {
    "can_play_versus(p_user uuid)": [true, "public, pg_temp", false, false],
    "create_match(p_format text)": [true, "public, pg_temp", false, true],
    "join_match(p_code text)": [true, "public, pg_temp", false, true],
    "match_state(p_code text)": [true, "public, pg_temp", true, true],
    "new_match_code()": [true, "public, pg_temp", false, false],
    "record_versus(p_winner uuid, p_loser uuid)": [true, "public, pg_temp", false, false],
    "versus_top(p_limit integer)": [true, "public, pg_temp", true, true],
  };
  const rows = await owner(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
      p.prosecdef as definer,
      (select substr(c, 13) from unnest(p.proconfig) c where c like 'search_path=%') as search_path,
      has_function_privilege('anon', p.oid, 'execute') as anon,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated
    from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('can_play_versus', 'create_match', 'join_match', 'match_state', 'new_match_code', 'record_versus', 'versus_top') order by 1`);
  const actual = Object.fromEntries(rows.map((r) => [r.sig, [r.definer, r.search_path, r.anon, r.authenticated]]));
  assert(JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort()),
    `a new function needs a deliberate entry here, got ${JSON.stringify(Object.keys(actual))}`);
  for (const [sig, want] of Object.entries(expected)) {
    assert(JSON.stringify(actual[sig]) === JSON.stringify(want), `${sig}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual[sig])}`);
  }
});

await runTest("the 1v1 board ranks by wins, fully tiebroken, and only counts people who played", async () => {
  await owner("update profiles set pvp_wins = 0, pvp_losses = 0");
  await owner("update profiles set pvp_wins = 3, pvp_losses = 1 where username = 'host'");
  await owner("update profiles set pvp_wins = 3, pvp_losses = 4 where username = 'opponent'");
  await owner("update profiles set pvp_wins = 0, pvp_losses = 2 where username = 'third'");

  const board = (await call(null, "versus_top", { p_limit: 10 })).data;
  assert(board.length === 3, `only the three who played one: ${JSON.stringify(board.map((r) => r.username))}`);
  assert(board[0].username === "host" && board[1].username === "opponent",
    `three wins and one loss beats three and four: ${JSON.stringify(board.map((r) => [r.username, r.wins, r.losses]))}`);
  assert(board[2].username === "third" && board[2].wins === 0, "and someone who has only lost is still on it");
  assert(board[0].pct === 75 && board[2].pct === 0, `with a win rate: ${JSON.stringify(board.map((r) => r.pct))}`);

  // record_versus moves the pair together, and is the only thing that may.
  const before = (await owner("select pvp_wins, pvp_losses from profiles where username = 'host'"))[0];
  await owner("select record_versus($1, $2)", [HOST, GUEST]);
  const after = (await owner("select pvp_wins from profiles where username = 'host'"))[0];
  const loser = (await owner("select pvp_losses from profiles where username = 'opponent'"))[0];
  assert(after.pvp_wins === before.pvp_wins + 1 && loser.pvp_losses === 5, `one win, one loss: ${after.pvp_wins}/${loser.pvp_losses}`);
  const direct = await attempt(HOST, "update profiles set pvp_wins = 99 where id = $1", [HOST]);
  assert(!!direct.error || direct.affected === 0, `and a client can't write its own record: ${JSON.stringify(direct)}`);
});

await runTest("running the migration again changes nothing", async () => {
  const before = (await owner("select count(*)::int as n from matches"))[0].n;
  await db.exec(sql("migration-versus.sql"));
  const after = (await owner("select count(*)::int as n from matches"))[0].n;
  assert(before === after, `matches survive a re-run: ${before} then ${after}`);
  const cols = await owner("select column_name from information_schema.columns where table_name = 'profiles' and column_name in ('pvp_wins','pvp_losses')");
  assert(cols.length === 2, "and the records are still there");
});

console.log("test-versus-sql.mjs done");
