// A whole 1v1 match through the mock Supabase client, the way the app will run one: two signed-in accounts,
// a lobby, a link taken, sixteen picks alternating, powerups spent, and a result neither client decided.
//
// This is the layer test-versus-rules.mjs doesn't cover - not the rules themselves but everything around them:
// create_match and join_match, whose session is whose, the picks landing in the table, and the records moving
// once the last pick lands. The rules are the same `decideMove` both this mock and the real Edge Function call.
import { assert, runTest, makeMockAuth, setupDom, loadModule } from "./helpers.mjs";
import { playMove } from "../storage.js";
import {
  replayMatch, optionsOn, optionId, optionFits, openSlots, VERSUS_SLOTS, MATCH_PICKS, TURN_SECONDS, pickId,
} from "../versus-logic.mjs";

// Two accounts, and a way to be either of them.
async function twoPlayers() {
  const sb = makeMockAuth();
  await sb.auth.signUp({ email: "one@x.test", password: "password1", options: { data: { username: "alpha" } } });
  const alpha = sb.auth.getUser ? null : null;
  await sb.auth.signOut();
  await sb.auth.signUp({ email: "two@x.test", password: "password1", options: { data: { username: "beta" } } });
  await sb.auth.signOut();
  const as = async (email) => { await sb.auth.signInWithPassword({ email, password: "password1" }); };
  void alpha;
  return { sb, as, A: "one@x.test", B: "two@x.test" };
}

const call = async (sb, name, args) => (await sb.rpc(name, args)).data;
// A steal names the pick it takes, so a driver has to find one on the other roster - the same lookup the
// screen does when you tap somebody.
const theirPick = (state, picks, side) => {
  const them = side === "host" ? "guest" : "host";
  for (const sl of VERSUS_SLOTS) {
    const o = state.roster[them][sl];
    if (!o) continue;
    const row = picks.find((x) => pickId(x) === optionId(o));
    if (row) return row;
  }
  return null;
};
// A refusal arrives as supabase-js delivers one - an `error` with the body behind it - so this reads it the
// way storage-versus.js's playMove has to.
// A clock that moves on with each move, so a turn never runs out mid-test.
let clock = Date.now();
const tick = () => (clock += 5000);
const move = async (sb, body, now = tick()) => {
  const { data, error } = await sb.functions.invoke("match-pick", { body, now });
  if (error) return error.context ? await error.context.json() : { reason: "network" };
  return data;
};

// The real playMove, not this file's `move` helper - which reads error.context itself and so would pass even
// if storage-versus.js had stopped doing it. That is the bug this is here for: supabase-js reports every
// non-2xx as an `error` with the body behind it, and a playMove that doesn't read it turns every rule in
// VERSUS.md 4 and 7 into "couldn't reach the server". Each shape below is one the function really sends.
await runTest("a refusal reaches the player as its reason, not as the network being down", async () => {
  const { sb, as, A, B } = await twoPlayers();
  const had = globalThis.window;
  globalThis.window = { ...(had || {}), __ps_supabase__: sb };
  try {
    await as(A);
    const code = (await call(sb, "create_match", {})).code;

    // 404: a code nobody has.
    const missing = await playMove({ code: "NOPE12" });
    assert(!missing.ok && missing.reason === "not_found", `a match that doesn't exist: ${JSON.stringify(missing)}`);

    // 409: a match that isn't drafting - this lobby has nobody in it yet. `already_finished`, not
    // `not_your_match`: the host IS in it. The two facts shared one word until the side check moved above the
    // status check, so a player posting into a match that had just ended was told it was not theirs.
    const idle = await playMove({ code, claim: "clock" });
    assert(!idle.ok && idle.reason === "already_finished", `a match not under way: ${JSON.stringify(idle)}`);

    // 403: signed in, a real match under way, not in it.
    await as(B);
    await call(sb, "join_match", { p_code: code });
    await sb.auth.signOut();
    await sb.auth.signUp({ email: "three@x.test", password: "password1", options: { data: { username: "gamma" } } });
    const stranger = await playMove({ code, claim: "clock" });
    assert(!stranger.ok && stranger.reason === "not_your_match", `somebody else's match: ${JSON.stringify(stranger)}`);

    // 409 from decideMove itself: a rule, not a routing problem.
    const state = replayMatch(await asReplay(sb, code));
    await as(state.turn.side === "host" ? B : A); // whoever is NOT on the clock
    const early = await playMove({ code, respin: "team" });
    assert(!early.ok && early.reason === "not_your_turn", `a rule refusing it says which rule: ${JSON.stringify(early)}`);

    // 401: signed out entirely.
    await sb.auth.signOut();
    const out = await playMove({ code, claim: "clock" });
    assert(!out.ok && out.reason === "unauthorized", `no session at all: ${JSON.stringify(out)}`);
  } finally {
    if (had) globalThis.window = had; else delete globalThis.window;
  }
});

await runTest("a lobby, a link, and the first one through it is the opponent", async () => {
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const lobby = await call(sb, "create_match", { p_format: "fantasy" });
  assert(/^[A-HJ-NP-Z2-9]{6}$/.test(lobby.code), `a code you can read aloud, got ${lobby.code}`);
  assert(lobby.status === "open" && lobby.guestId === null && lobby.hostName === "alpha", `an open lobby: ${JSON.stringify(lobby)}`);
  assert((await call(sb, "create_match", {})).code === lobby.code, "asking twice gives back the same one");

  await as(B);
  const joined = await call(sb, "join_match", { p_code: lobby.code.toLowerCase() });
  assert(joined.status === "drafting" && joined.guestName === "beta", `joining starts the draft: ${JSON.stringify(joined)}`);
  assert(joined.turnDeadline, "with a clock on the first pick");

  // Anyone can read it, signed in or not - a match is public the moment it exists.
  await sb.auth.signOut();
  const seen = await call(sb, "match_state", { p_code: lobby.code });
  assert(seen.code === lobby.code && seen.picks.length === 0, "a stranger reads the same match back");
  assert(await call(sb, "match_state", { p_code: "NOSUCH" }) === null, "and nothing for a code nobody has");
});

await runTest("a guest may not play, on either side of the link", async () => {
  const { sb, as, A } = await twoPlayers();
  await as(A);
  const lobby = await call(sb, "create_match", {});
  await sb.auth.signOut();
  await sb.auth.signInAnonymously();
  assert((await call(sb, "create_match", {})).error === "guest_not_allowed", "a guest can't open a lobby");
  assert((await call(sb, "join_match", { p_code: lobby.code })).error === "guest_not_allowed", "nor take one");
});

// Plays the match out, taking the first legal option each turn, and lets a caller spend powerups along the way.
async function playOut(sb, as, A, B, code, spend = () => null) {
  const sides = { host: A, guest: B };
  for (let guard = 0; guard < 60; guard++) {
    const rows = await asReplay(sb, code);
    const state = replayMatch(rows);
    if (state.done) return state;
    const side = state.turn.side;
    await as(sides[side]);
    const powerup = spend(state, rows.picks);
    if (powerup) {
      // A powerup may say whose turn it belongs to; everything else is the current player's.
      const asSide = powerup.as === "other" ? (side === "host" ? "guest" : "host") : side;
      await as(sides[asSide]);
      const res = await move(sb, { code, ...powerup, as: undefined });
      await as(sides[side]);
      // A powerup the caller asked for has to land. Falling through to an ordinary pick instead turned a
      // refusal into a baffling failure much later - the flag said "spent" while the match said otherwise.
      assert(!res.error && !res.reason,
        `powerup ${JSON.stringify(powerup)} at pick ${state.pickNo} (${asSide}): ${JSON.stringify(res.reason || res.error)}`);
      continue;
    }
    const open = openSlots(state.roster[side]);
    const o = optionsOn(state.boardKey).find((x) => !state.taken.has(optionId(x)) && open.some((s) => optionFits(x, s)));
    const slot = open.find((s) => optionFits(o, s));
    const res = await move(sb, {
      code, boardIdx: state.boardIdx, kind: o.kind, slot,
      playerId: o.kind === "player" ? o.id : undefined,
      team: o.kind === "player" ? undefined : o.team, season: o.season,
    });
    assert(!res.error, `pick ${state.pickNo} (${side}): ${JSON.stringify(res)}`);
  }
  throw new Error("a match that never finished");
}
// The match as versus-logic sees it, rebuilt from what match_state returns - which is all a real client has.
async function asReplay(sb, code) {
  const m = await call(sb, "match_state", { p_code: code });
  return { code: m.code, picks: m.picks, respins: m.respins, dips: m.dips, steals: m.steals };
}

await runTest("sixteen picks, two full rosters, and a winner the server chose", async () => {
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const code = (await call(sb, "create_match", {})).code;
  await as(B);
  await call(sb, "join_match", { p_code: code });

  const end = await playOut(sb, as, A, B, code);
  assert(end.done, "the match finished");
  const m = await call(sb, "match_state", { p_code: code });
  assert(m.status === "done", `and is marked done, got ${m.status}`);
  assert(m.picks.length === MATCH_PICKS, `sixteen picks recorded, got ${m.picks.length}`);
  assert(m.turnDeadline === null, "with no clock left running");

  for (const side of ["host", "guest"]) {
    for (const slot of VERSUS_SLOTS) assert(end.roster[side][slot], `${side} filled ${slot}`);
  }
  // Every pick belongs to one of the two players, and each made eight.
  const mine = { [m.hostId]: 0, [m.guestId]: 0 };
  for (const p of m.picks) mine[p.userId]++;
  assert(mine[m.hostId] === 8 && mine[m.guestId] === 8, `eight each, got ${JSON.stringify(mine)}`);

  // The result: the higher score won, and the football final agrees with it.
  const r = m.result;
  assert(r && typeof r.host.score === "number", `a result was written: ${JSON.stringify(r)}`);
  assert(r.winner === (r.host.score > r.guest.score ? "host" : r.host.score < r.guest.score ? "guest" : null),
    `the higher score won: ${JSON.stringify({ host: r.host.score, guest: r.guest.score, winner: r.winner })}`);
  if (r.winner) {
    assert(r[r.winner].points > r[r.winner === "host" ? "guest" : "host"].points, "and won on the scoreboard too");
    assert(m.winnerId === (r.winner === "host" ? m.hostId : m.guestId), "the winner is recorded by id");
  }

  // And the records moved - PvP only, never career wins.
  const winner = sb._profiles.get(m.winnerId);
  const loser = sb._profiles.get(m.winnerId === m.hostId ? m.guestId : m.hostId);
  assert((winner.pvp_wins || 0) === 1 && (loser.pvp_losses || 0) === 1, `one win, one loss: ${winner.pvp_wins}/${loser.pvp_losses}`);
  assert(!winner.wins && !winner.champs, "and nothing of the single-player record was touched");

  // A finished match takes no more moves, from either of them.
  await as(A);
  assert((await move(sb, { code, claim: "clock" })).reason === "already_finished", "the match is closed, and says so rather than disowning the player");
});

await runTest("a finish that fails is picked up by the next request, from either player", async () => {
  // The brick: the sixteenth pick is written, grading (or the write recording it) fails, the handler answers
  // 500, and `matches.status` is still `drafting` with all sixteen picks in. Nothing could post again -
  // decideMove refuses a match it replays as finished - so both screens sat on "Working out the result..."
  // for good, and create_match handed both players straight back into the dead match for every duel they
  // tried afterwards. Recovery was the runbook, by hand, per match.
  //
  // Finishing is the first thing the handler tries now, on any request from either player, so any later
  // request finishes it. Here the failure is staged the way it really happened: the picks are all in and the
  // row is put back to `drafting` with no result, exactly the state a failed finish leaves behind.
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const code = (await call(sb, "create_match", {})).code;
  await as(B);
  await call(sb, "join_match", { p_code: code });
  const state = await playOut(sb, as, A, B, code);
  assert(state.done, "sixteen picks are in");
  const m = [...sb._versus._matches.values()].find((x) => x.code === code);
  assert(m.status === "done" && m.result, "and normally that finishes it");

  // Put it back to the state a failed grade leaves: drafting, no result, nothing recorded.
  const winner = sb._profiles.get(m.winner_id);
  const beforeWins = winner ? winner.pvp_wins : null;
  m.status = "drafting"; m.result = null; m.winner_id = null; m.ended_at = null;

  // The next request - and it is the player who did NOT make the last pick, because either will do.
  await as(A);
  const res = await move(sb, { code });
  assert(!res.error && !res.reason && res.result, `any later request finishes it: ${JSON.stringify(res).slice(0, 140)}`);
  assert(m.status === "done" && m.result, "the match is finished");
  // And exactly once: the records were already written before the row was rolled back by hand, and
  // finish_match's status check is what stops a second pass counting them again.
  if (winner) assert(winner.pvp_wins === beforeWins + 1, `one more win only, got ${winner.pvp_wins} from ${beforeWins}`);

  // Which is also what lets Duel work again: create_match stops handing the dead match back.
  const next = await call(sb, "create_match", {});
  assert(next.code !== code, `the next duel is a new one, got ${next.code}`);
});

await runTest("a match that cannot be graded ends, instead of bricking Duel", async () => {
  // The last resort. A pick that was written but is not on the board the replay deals leaves a hole in the
  // roster, so matchResult answers null and no amount of retrying will ever change that - which would turn
  // the recovery above into a loop. replayMatch reports what it could not apply (it used to drop it in
  // silence), and the match ends with no result and nothing recorded, rather than Duel bricking for both.
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const code = (await call(sb, "create_match", {})).code;
  await as(B);
  await call(sb, "join_match", { p_code: code });
  await playOut(sb, as, A, B, code);
  const m = [...sb._versus._matches.values()].find((x) => x.code === code);
  const before = { w: sb._profiles.get(m.host_id).pvp_wins, l: sb._profiles.get(m.host_id).pvp_losses };
  m.status = "drafting"; m.result = null; m.winner_id = null; m.ended_at = null;

  // Break one pick the way the race used to: a player who is not on that board at all.
  const row = [...sb._versus.tables.match_picks.values()].find((p) => p.match_id === m.id && p.kind === "player");
  row.player_id = 999999;
  const replay = sb._versus._replay(code);
  // One broken pick is more than one hole: what a player took is gone for both sides and decides which board
  // comes next, so later picks land on boards that are no longer the ones they were made from. Which is why
  // dropping even one of these in silence was never going to be recoverable.
  assert(replay.missing.length >= 1 && replay.missing[0].id === "player|999999|2025",
    `the replay says which picks it could not apply: ${JSON.stringify(replay.missing)}`);

  const res = await move(sb, { code });
  assert(res.reason === "unplayable" || res.error === "unplayable", `it says so rather than failing to grade: ${JSON.stringify(res)}`);
  assert(m.status === "abandoned" && !m.result, `and the match is ended: ${m.status}`);
  const after = { w: sb._profiles.get(m.host_id).pvp_wins, l: sb._profiles.get(m.host_id).pvp_losses };
  assert(after.w === before.w && after.l === before.l, `with nothing recorded for either player: ${JSON.stringify([before, after])}`);
  // The screen for an abandoned match already exists, and create_match hands nobody back into this one.
  await as(A);
  assert((await call(sb, "create_match", {})).code !== code, "Duel works again");
});

await runTest("a match survives an opponent who walks away", async () => {
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const code = (await call(sb, "create_match", {})).code;
  await as(B);
  await call(sb, "join_match", { p_code: code });

  const before = replayMatch(await asReplay(sb, code));
  const waiting = before.turn.side === "host" ? B : A; // the one NOT on the clock calls it
  await as(waiting);
  // Read the deadline rather than trusting the shared clock: these two assertions are about the deadline
  // itself, so they name the instants either side of it.
  const deadline = Date.parse((await call(sb, "match_state", { p_code: code })).turnDeadline);
  assert((await move(sb, { code, claim: "clock" }, deadline - 1000)).reason === "too_early", "not before the clock is up");
  const late = deadline + 1000;
  const done = await move(sb, { code, claim: "clock" }, late);
  assert(!done.error, `once it is, the waiting player can call it: ${JSON.stringify(done)}`);

  const m = await call(sb, "match_state", { p_code: code });
  assert(m.picks.length === 1 && m.picks[0].auto === true, "the clock made the pick, and says so");
  assert(m.picks[0].userId === (before.turn.side === "host" ? m.hostId : m.guestId), "for the player who was on it");
});

await runTest("a pick the clock made can be stolen like any other", async () => {
  // A pick is a pick, however it got made. Worth its own test because the clock's is the one nobody chose, so
  // it is the one most likely to be treated as different by accident somewhere along the way.
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const code = (await call(sb, "create_match", {})).code;
  await as(B);
  await call(sb, "join_match", { p_code: code });

  const before = replayMatch(await asReplay(sb, code));
  const onClock = before.turn.side;
  const waiting = onClock === "host" ? "guest" : "host";
  const deadline = Date.parse((await call(sb, "match_state", { p_code: code })).turnDeadline);

  // Let it run out. Either player may call it, so the one waiting does.
  await as(waiting === "host" ? A : B);
  assert(!(await move(sb, { code, claim: "clock" }, deadline + 1000)).error, "the clock made the pick");
  const m1 = await call(sb, "match_state", { p_code: code });
  assert(m1.picks.length === 1 && m1.picks[0].auto === true, `and it is marked as the clock's: ${JSON.stringify(m1.picks[0])}`);

  // Now steal it.
  // The player who was NOT on the clock steals what the clock took for the other one.
  const rows = await asReplay(sb, code);
  const mid = replayMatch(rows);
  const target = theirPick(mid, rows.picks, waiting);
  assert(target, "the clock's pick is on the other roster to take");
  await as(waiting === "host" ? A : B);
  const stolen = await move(sb, { code, steal: true, pickNo: target.pickNo }, deadline + 2000);
  assert(!stolen.error && !stolen.reason, `the clock's pick can be stolen: ${JSON.stringify(stolen)}`);
  const m2 = await call(sb, "match_state", { p_code: code });
  assert(m2.steals.length === 1 && m2.steals[0].by === waiting,
    `it changed hands, recorded on the match: ${JSON.stringify(m2.steals)}`);
  assert(m2.steals[0].pickNo === 1, "naming the pick it took");
  assert(m2.picks[0].auto === true && m2.picks[0].pickNo === 1, "and the pick row itself is untouched");
  assert(m2.picks[0].auto === true, "and still says the clock made it");
  const after = replayMatch(await asReplay(sb, code));
  assert(after.turn.side === onClock, "the robbed player is back on the clock");
});

await runTest("powerups spent through the client land in the match", async () => {
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const code = (await call(sb, "create_match", {})).code;
  await as(B);
  await call(sb, "join_match", { p_code: code });

  const spent = { respin: false, dip: false, steal: false };
  const end = await playOut(sb, as, A, B, code, (state, rows) => {
    if (!spent.respin) { spent.respin = true; return { respin: "team" }; }
    // The steal before the dip, and the dip waits for it: a dip gives the dipper two turns back to back, and on
    // the second of them the pick just made is their own, which is not a thing anyone may steal.
    if (!spent.steal) {
      const t = theirPick(state, rows.picks || rows, state.turn.side);
      if (t) { spent.steal = true; return { steal: true, pickNo: t.pickNo }; }
    }
    if (spent.steal && !spent.dip) { spent.dip = true; return { dip: true }; }
    return null;
  });

  const m = await call(sb, "match_state", { p_code: code });
  assert(m.respins.length === 1 && m.respins[0].kind === "team", `the re-spin is on the match: ${JSON.stringify(m.respins)}`);
  assert(m.dips.length === 1, `and the dip: ${JSON.stringify(m.dips)}`);
  assert(m.steals.length === 1, `and a player that changed hands: ${JSON.stringify(m.steals)}`);
  assert(m.picks.length === MATCH_PICKS, `still sixteen picks, got ${m.picks.length}`);
  for (const side of ["host", "guest"]) {
    for (const slot of VERSUS_SLOTS) assert(end.roster[side][slot], `${side} still filled ${slot}`);
  }
  assert(m.status === "done" && m.result, "and the match still finished with a result");
});

// The exact three moves that used to end a match at fourteen picks with no result, in the order two people
// would actually make them: somebody takes the board's first pick, the other player steals it, and the robbed
// player - back on the clock with a board they now have nothing on - doubles up on it.
//
// The steal wrote the victim's replacement turn at order[i + 1] without looking at what was there, and on a
// dipped board that index is the dip's extra turn. So the dip was swallowed: the victim picked once where they
// had paid for two AND still forfeited the next board, both rosters finished short, matchResult returned null,
// and the match could not be finished, graded or left. Seven of four hundred fuzzed matches broke this way.
await runTest("robbed, then doubling up on the same board, still finishes a match", async () => {
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const code = (await call(sb, "create_match", {})).code;
  await as(B);
  await call(sb, "join_match", { p_code: code });

  const seq = { stolen: false, dipped: false };
  const end = await playOut(sb, as, A, B, code, (state, rows) => {
    // The follower is on the clock the moment the board's first pick has landed.
    if (!seq.stolen) {
      const t = theirPick(state, rows.picks || rows, state.turn.side);
      if (t) { seq.stolen = true; return { steal: true, pickNo: t.pickNo }; }
    }
    // ...which sends the robbed player straight back to the same board. That is where they double up.
    if (seq.stolen && !seq.dipped) { seq.dipped = true; return { dip: true }; }
    return null;
  });
  assert(seq.stolen && seq.dipped, "both moves were actually made");

  const m = await call(sb, "match_state", { p_code: code });
  assert(m.picks.length === MATCH_PICKS, `sixteen picks, not fourteen: got ${m.picks.length}`);
  assert(m.steals.length === 1, `with a player that changed hands: ${JSON.stringify(m.steals)}`);
  assert(m.dips.length === 1, "and the dip on the match");
  for (const side of ["host", "guest"]) {
    for (const slot of VERSUS_SLOTS) assert(end.roster[side][slot], `${side} filled ${slot}`);
  }
  assert(m.status === "done" && m.result, `and a result the server wrote: ${JSON.stringify(m.status)}`);
  assert(m.result.winner === "host" || m.result.winner === "guest" || m.result.winner === null,
    `which says who won: ${JSON.stringify(m.result.winner)}`);
});

await runTest("the share card says who won and never names a player", async () => {
  // The card lives in the screen's own file, so it is bundled the way the app bundles it rather than
  // imported raw - node has no idea what a .jsx is.
  setupDom();
  const { versusShareText } = await loadModule("versus.jsx");
  const { sb, as, A, B } = await twoPlayers();
  await as(A);
  const code = (await call(sb, "create_match", {})).code;
  await as(B);
  await call(sb, "join_match", { p_code: code });
  const end = await playOut(sb, as, A, B, code);
  const m = await call(sb, "match_state", { p_code: code });
  const card = versusShareText(m, m.result, "host", "https://gridspin.test");

  const firstLine = (t) => t.split("\n")[0];
  assert(card.startsWith("Gridspin Duel"), `it says what it is: ${firstLine(card)}`);
  // Winner first, not host first. Written host-first this passed only because the host happens to win this
  // seeded match, and it contradicted the winner-first assertion further down.
  const hi = m.result.winner === null ? "host" : m.result.winner;
  const lo = hi === "host" ? "guest" : "host";
  assert(card.includes(`${m.result[hi].points}–${m.result[lo].points}`), `with the final on it, winner first: ${card}`);
  assert(card.includes("https://gridspin.test"), "and a link, last");
  // Never the players - the same rule the season card follows, for the same reason.
  const names = [...VERSUS_SLOTS.map((s) => end.roster.host[s]), ...VERSUS_SLOTS.map((s) => end.roster.guest[s])]
    .filter((o) => o.kind === "player").map((o) => o.name);
  const leaked = names.filter((n) => card.includes(n));
  assert(leaked.length === 0, `no player is named on it, found ${JSON.stringify(leaked)}`);
  // The opponent's own card is the same match from the other side: it says what happened to THEM, but the
  // scoreline belongs to the match, not to whoever is posting it. Winner first on both, the way a football
  // score is written - read your-side-first it turned 23-20, the commonest score there is, into "20-23".
  const theirs = versusShareText(m, m.result, "guest", "https://gridspin.test");
  const winner = m.result.winner;
  const loser = winner === "host" ? "guest" : "host";
  const line = `${m.result[winner].points}–${m.result[loser].points}`;
  assert(theirs !== card, `the two cards differ: ${firstLine(theirs)}`);
  assert(card.includes(line) && theirs.includes(line), `both carry the same scoreline, winner first (${line})`);
  // Each card says how it went for ITS OWN reader, and they must differ - a regex accepting any of the three
  // passed a card that said "Beat" on both sides.
  const mineWon = m.result.winner === "host";
  assert(firstLine(card).includes(mineWon ? "Beat" : "Lost to"), `the host card reads from the host side: ${firstLine(card)}`);
  assert(firstLine(theirs).includes(mineWon ? "Lost to" : "Beat"), `and the guest card from theirs: ${firstLine(theirs)}`);
});
// Two powerups on one turn, and the screen announces the one that happened last. A dip is stored against its
// BOARD, because that is what it changes, and the announcement was ordered by that - so a dip declared after a
// re-spin on the same board ranked behind it and never appeared, although the server had accepted both. What
// it is ranked by now is the turn it was declared on, which is what "last" means.
await runTest("a dip declared after a re-spin is the thing announced", async () => {
  setupDom();
  const { latestEvent } = await loadModule("versus.jsx");
  const nameOf = (side) => (side === "host" ? "alpha" : "beta");
  // Board 3, the follower's turn: they re-spin the team, then declare a double dip. One turn, both spent.
  const match = {
    respins: [{ pickNo: 8, kind: "team", by: "guest" }],
    dips: [{ boardIdx: 3, at: 8, by: "guest" }],
    steals: [],
  };
  const state = { roster: { host: {}, guest: {} } };
  assert(latestEvent(match, state, nameOf).title === "Double dip",
    `the dip is the newer of the two: ${latestEvent(match, state, nameOf).title}`);
  // The other order still reads the other way round, or this would be a constant rather than an ordering.
  const first = { ...match, respins: [{ pickNo: 9, kind: "team", by: "host" }] };
  assert(latestEvent(first, state, nameOf).title === "Re-spin", "and a later re-spin outranks the dip");
  // A dip written before it carried a turn - a match already in progress across the deploy - still announces.
  const old = { respins: [], dips: [{ boardIdx: 3, by: "guest" }], steals: [] };
  assert(latestEvent(old, state, nameOf).title === "Double dip", "a record with no turn on it still announces");
});

console.log("test-versus-flow.mjs done");
