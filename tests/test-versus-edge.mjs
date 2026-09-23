// The REAL supabase/functions/match-pick/index.ts, executed.
//
// Until now neither Edge Function was run by anything: their source was read as text and matched against
// strings, and the 2.0 sweeps found two of those assertions passing while what they claimed to guard was
// broken. versus-logic.mjs holds every rule and is tested directly, so what is left here is the part only this
// file does - who is asking, which write goes with which decision, what a failure answers, and in what order -
// which is exactly where 3.4's brick lived.
//
// tests/edge-match-pick.mjs bundles it and stubs only Deno and the query shapes it uses; everything decided
// below is the shipped code.
import { assert, runTest, makeMockAuth } from "./helpers.mjs";
import { loadMatchPick, storeFor } from "./edge-match-pick.mjs";
import * as V from "../versus-logic.mjs";
import { replayMatch, optionsOn, optionId, optionFits, openSlots } from "../versus-logic.mjs";

const { invoke } = await loadMatchPick();

// One match, two accounts, over tests/mock-versus.mjs's own store - so the function reads and writes the same
// rows the mock does, and neither is describing the other.
async function table() {
  const sb = makeMockAuth();
  await sb.auth.signUp({ email: "h@x.test", password: "password1", options: { data: { username: "hostly" } } });
  await sb.auth.signOut();
  await sb.auth.signUp({ email: "g@x.test", password: "password1", options: { data: { username: "guestly" } } });
  await sb.auth.signOut();
  const as = async (email) => (await sb.auth.signInWithPassword({ email, password: "password1" })).data.user.id;
  const host = await as("h@x.test");
  const code = (await sb.rpc("create_match", {})).data.code;
  const guest = await as("g@x.test");
  await sb.rpc("join_match", { p_code: code });
  const store = storeFor(sb._versus, sb._state || { profiles: sb._profiles });
  globalThis.__edge_store__ = store;
  const match = () => [...sb._versus._matches.values()].find((m) => m.code === code);
  return { sb, code, host, guest, store, match };
}

const replay = (m, picks) => replayMatch({
  code: m.code, respins: m.respins, dips: m.dips, steals: m.steals,
  picks: picks.map((r) => ({ pickNo: r.pick_no, kind: r.kind, playerId: r.player_id, team: r.team, season: r.season, slot: r.slot, auto: r.auto })),
});
const picksOf = (sb, m) => [...sb._versus.tables.match_picks.values()].filter((p) => p.match_id === m.id).sort((a, b) => a.pick_no - b.pick_no);

// One legal pick for whoever is on the clock, chosen the way the screen does.
function nextMove(state) {
  const side = state.turn.side;
  const open = openSlots(state.roster[side]);
  const o = optionsOn(state.boardKey).find((x) => !state.taken.has(optionId(x)) && open.some((s) => optionFits(x, s)));
  return {
    side,
    body: {
      boardIdx: state.boardIdx, kind: o.kind, slot: open.find((s) => optionFits(o, s)),
      playerId: o.kind === "player" ? o.id : undefined,
      team: o.kind === "player" ? undefined : o.team, season: o.season,
    },
  };
}

// Plays a match out through the real function. `stopAt` leaves it that many picks from the end.
async function playThrough({ sb, code, host, guest, match }, { stopAt = 0 } = {}) {
  for (let guard = 0; guard < 40; guard++) {
    const m = match();
    const state = replay(m, picksOf(sb, m));
    if (state.done || (stopAt && picksOf(sb, m).length >= V.MATCH_PICKS - stopAt)) return state;
    const { side, body } = nextMove(state);
    const res = await invoke({ code, ...body }, { userId: side === "host" ? host : guest });
    assert(res.status === 200, `pick ${state.pickNo} (${side}): ${res.status} ${JSON.stringify(res.body)}`);
  }
  throw new Error("a match that never finished");
}

await runTest("the real function plays a match out and grades it", async () => {
  const t = await table();
  await playThrough(t);
  const m = t.match();
  assert(m.status === "done" && m.result, `the match is finished: ${m.status}`);
  assert(m.result.host && m.result.guest, `with both scores: ${JSON.stringify(m.result).slice(0, 120)}`);
  const winner = m.result.winner;
  assert(winner === null || winner === "host" || winner === "guest", `and a decided winner: ${winner}`);
  assert(m.rev === V.MATCH_PICKS, `every write moved the revision: ${m.rev}`);
});

await runTest("a finish that fails is picked up by the next request, from either player", async () => {
  // 3.4's brick, in the file it lived in. The sixteenth pick is written, finish_match fails, the handler
  // answers 500 - and `status` is still `drafting` with all sixteen picks in. Nothing could post again
  // (decideMove refuses a match it replays as finished), so both screens sat on "Working out the result..."
  // and create_match handed both players back into the dead match for every duel they tried afterwards.
  const t = await table();
  await playThrough(t, { stopAt: 1 });
  const m = t.match();
  const state = replay(m, picksOf(t.sb, m));
  const { side, body } = nextMove(state);
  const onClock = side === "host" ? t.host : t.guest;
  const other = side === "host" ? t.guest : t.host;

  t.store.rpcFails.finish_match = true;
  const failed = await invoke({ code: t.code, ...body }, { userId: onClock });
  assert(failed.status === 500, `the last pick fails to finish: ${failed.status} ${JSON.stringify(failed.body)}`);
  assert(m.status === "drafting" && picksOf(t.sb, m).length === V.MATCH_PICKS, "the match is drafting with every pick in - the stuck state exactly");

  // Before: this is where it stopped. decideMove refuses everything from here.
  t.store.rpcFails.finish_match = false;
  const rescued = await invoke({ code: t.code }, { userId: other });
  assert(rescued.status === 200 && rescued.body?.result, `and the OTHER player's next request finishes it: ${rescued.status} ${JSON.stringify(rescued.body).slice(0, 140)}`);
  assert(m.status === "done" && m.result, `the match is done: ${m.status}`);

  // Twice is harmless: both screens notice the sixteenth pick at once, and finish_match says who got there first.
  const again = await invoke({ code: t.code }, { userId: onClock });
  assert(again.status === 409, `a finished match answers not_your_match, not a second result: ${again.status}`);
});

await runTest("a match that cannot be graded is ended by the function, not left drafting", async () => {
  // The last resort. A pick that was written but is not on the board the replay deals leaves a hole in the
  // roster no later move can fill, so matchResult answers null forever - which would turn the recovery above
  // into a loop. replayMatch reports what it could not apply (it used to drop it in silence) and the function
  // ends the match: no result, nothing recorded, and Duel works again.
  const t = await table();
  await playThrough(t);
  const m = t.match();
  const host = t.sb._profiles.get(m.host_id), guest = t.sb._profiles.get(m.guest_id);
  const before = [host.pvp_wins || 0, host.pvp_losses || 0, guest.pvp_wins || 0, guest.pvp_losses || 0];
  m.status = "drafting"; m.result = null; m.winner_id = null; m.ended_at = null;
  picksOf(t.sb, m).find((p) => p.kind === "player").player_id = 999999;

  const res = await invoke({ code: t.code }, { userId: t.host });
  assert(res.status === 409 && res.body?.reason === "unplayable", `it says what is wrong: ${res.status} ${JSON.stringify(res.body)}`);
  assert(m.status === "abandoned" && !m.result, `and ends the match: ${m.status}`);
  const after = [host.pvp_wins || 0, host.pvp_losses || 0, guest.pvp_wins || 0, guest.pvp_losses || 0];
  assert(JSON.stringify(before) === JSON.stringify(after), `with nothing recorded for either player: ${JSON.stringify([before, after])}`);
});

await runTest("a powerup landing under a request does not write a pick against a board that has moved", async () => {
  // Two requests for one match are ordinary: the player on the clock can move at the very moment their
  // opponent claims the expired clock. Both read the match; the second one's decision was taken against a
  // board the first has already re-spun away. Its pick row then named a player who is not on the board any
  // more, replayMatch dropped it, and the roster came out with a hole in it - which is the other way into the
  // brick above. record_pick's revision check is what closes it.
  const t = await table();
  const m = t.match();
  const state = replay(m, picksOf(t.sb, m));
  const { side, body } = nextMove(state);
  const onClock = side === "host" ? t.host : t.guest;

  // The move is decided against revision 0. A re-spin lands first, moving the board and the revision.
  const revBefore = m.rev || 0;
  const spun = await invoke({ code: t.code, respin: "team" }, { userId: onClock });
  assert(spun.status === 200, `the re-spin lands: ${spun.status} ${JSON.stringify(spun.body)}`);
  assert((m.rev || 0) === revBefore + 1, `and moves the revision: ${m.rev}`);

  // A body decided before it is refused by the rules, because the function re-reads the match every request:
  // that pick is simply not on the board any more.
  const old = await invoke({ code: t.code, ...body }, { userId: onClock });
  assert(old.status === 409 && old.body?.reason === "not_on_board",
    `a pick from the old board is refused: ${old.status} ${JSON.stringify(old.body)}`);
  assert(picksOf(t.sb, m).length === 0, "and no pick row was written");

  // The window the revision actually guards is narrower than that, and no sequence of requests can open it:
  // the powerup has to land AFTER this request read the match and BEFORE its write. So it is staged from
  // inside record_pick, which is where the two meet. What is under test is the wiring - that the function
  // passes the revision it read, and turns `stale` into the conflict a client knows how to retry.
  const now = replay(m, picksOf(t.sb, m));
  const fresh = nextMove(now);
  const real = t.store.rpcs.record_pick;
  t.store.rpcs.record_pick = (args) => { m.rev = (m.rev || 0) + 1; return real(args); };
  const raced = await invoke({ code: t.code, ...fresh.body }, { userId: fresh.side === "host" ? t.host : t.guest });
  t.store.rpcs.record_pick = real;
  assert(raced.status === 409 && raced.body?.reason === "conflict",
    `a pick whose match moved under it is a conflict, not a 500 and not a write: ${raced.status} ${JSON.stringify(raced.body)}`);
  assert(picksOf(t.sb, m).length === 0, "and still nothing was written");
  // The whole point: no dropped pick, so no hole in the roster, so nothing that cannot be graded later.
  assert(replay(m, picksOf(t.sb, m)).missing.length === 0, "the match is still replayable");

  // And the same move, with nothing moving under it, goes in.
  const ok = await invoke({ code: t.code, ...fresh.body }, { userId: fresh.side === "host" ? t.host : t.guest });
  assert(ok.status === 200, `the retry lands: ${ok.status} ${JSON.stringify(ok.body)}`);
  assert(picksOf(t.sb, m).length === 1, "one pick row");
});

await runTest("a powerup landing under a POWERUP is refused the same way", async () => {
  // The three powerup writes take the same guard as the pick, and for the same reason: a re-spin appended to a
  // list this request read before the other one changed it silently discards whatever the other one wrote.
  // Staged from inside the write, since that is the only place the two meet.
  const t = await table();
  const m = t.match();
  const state = replay(m, picksOf(t.sb, m));
  const side = state.turn.side;
  t.store.beforeWrite = (table) => { if (table === "matches") m.rev = (m.rev || 0) + 1; };
  const raced = await invoke({ code: t.code, respin: "team" }, { userId: side === "host" ? t.host : t.guest });
  t.store.beforeWrite = null;
  assert(raced.status === 409 && raced.body?.reason === "conflict",
    `a re-spin whose match moved under it is a conflict, not a silent overwrite: ${raced.status} ${JSON.stringify(raced.body)}`);
  assert(m.respins.length === 0, "and nothing was appended");

  const ok = await invoke({ code: t.code, respin: "team" }, { userId: side === "host" ? t.host : t.guest });
  assert(ok.status === 200 && m.respins.length === 1, `the retry lands: ${ok.status} ${JSON.stringify(ok.body)}`);
});

await runTest("every answer carries the CORS headers, the refusals included", async () => {
  // A headerless response reaches the browser as a network failure, so a refusal this function words carefully
  // arrives as "That didn't work." - which is what the handle() wrapper exists to prevent.
  const t = await table();
  const preflight = await invoke(null, { method: "OPTIONS" });
  assert(preflight.headers.get("access-control-allow-origin"), "the preflight is answered");
  for (const [label, res] of [
    ["signed out", await invoke({ code: t.code })],
    ["not a player in it", await invoke({ code: t.code }, { userId: "nobody" })],
    ["no code", await invoke({}, { userId: t.host })],
    ["no such match", await invoke({ code: "ZZZZZZ" }, { userId: t.host })],
    ["a GET", await invoke(null, { userId: t.host, method: "GET" })],
  ]) {
    assert(res.status >= 400, `${label} is refused: ${res.status}`);
    assert(res.headers.get("access-control-allow-origin"), `${label} still carries CORS`);
  }
});

await runTest("a read that fails is a failure, never an empty match", async () => {
  // A dropped select used to present an EMPTY match to decideMove, which says "board 0, pick 1" - and a
  // re-spin appended for pick 1 retroactively replaces board 0, orphaning every pick already made on it.
  const t = await table();
  await playThrough(t, { stopAt: 8 });
  const m = t.match();
  const had = picksOf(t.sb, m).length;
  assert(had > 0, "some picks are in");
  t.store.readFails.match_picks = true;
  const res = await invoke({ code: t.code, respin: "team" }, { userId: t.host });
  assert(res.status === 500, `a failed read of the picks is a 500: ${res.status} ${JSON.stringify(res.body)}`);
  assert(res.headers.get("access-control-allow-origin"), "with CORS, so the screen can read it");
  assert(m.respins.length === 0, "and nothing was written against an empty match");
  t.store.readFails.match_picks = false;
  t.store.readFails.matches = true;
  const unread = await invoke({ code: t.code }, { userId: t.host });
  assert(unread.status === 500, `a failed read of the match is a 500, not "no such match": ${unread.status} ${JSON.stringify(unread.body)}`);
});

console.log("test-versus-edge.mjs done");
