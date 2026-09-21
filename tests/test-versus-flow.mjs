// A whole 1v1 match through the mock Supabase client, the way the app will run one: two signed-in accounts,
// a lobby, a link taken, sixteen picks alternating, powerups spent, and a result neither client decided.
//
// This is the layer test-versus-rules.mjs doesn't cover - not the rules themselves but everything around them:
// create_match and join_match, whose session is whose, the picks landing in the table, and the records moving
// once the last pick lands. The rules are the same `decideMove` both this mock and the real Edge Function call.
import { assert, runTest, makeMockAuth, setupDom, loadModule } from "./helpers.mjs";
import { playMove } from "../storage.js";
import {
  replayMatch, optionsOn, optionId, optionFits, openSlots, VERSUS_SLOTS, MATCH_PICKS, TURN_SECONDS, LOOK_SECONDS,
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
// A refusal arrives as supabase-js delivers one - an `error` with the body behind it - so this reads it the
// way storage-versus.js's playMove has to.
// A clock that always steps past a board's opening window (VERSUS.md 7), so these tests are about the flow
// rather than about waiting. The window has a test of its own in test-versus-rules.mjs.
let clock = Date.now();
const tick = () => (clock += (LOOK_SECONDS + 1) * 1000);
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

    // 409: a match that isn't drafting - this lobby has nobody in it yet.
    const idle = await playMove({ code, claim: "clock" });
    assert(!idle.ok && idle.reason === "not_your_match", `a match not under way: ${JSON.stringify(idle)}`);

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
    const state = replayMatch(await asReplay(sb, code));
    if (state.done) return state;
    const side = state.turn.side;
    await as(sides[side]);
    const powerup = spend(state);
    if (powerup) {
      // Steal the pick is spent by the player who is NOT on the clock, so a powerup can say whose turn it
      // belongs to. Everything else is the current player's.
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
  return { code: m.code, picks: m.picks, respins: m.respins, dips: m.dips, swaps: m.swaps };
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
  assert((await move(sb, { code, claim: "clock" })).reason === "not_your_match", "the match is closed");
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
  const stolen = await move(sb, { code, steal: true }, deadline + 2000);
  assert(!stolen.error && !stolen.reason, `the clock's pick can be stolen: ${JSON.stringify(stolen)}`);
  const m2 = await call(sb, "match_state", { p_code: code });
  assert(m2.picks[0].stolenBy === waiting, `it changed hands: ${JSON.stringify(m2.picks[0].stolenBy)}`);
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

  const spent = { respin: false, dip: false, steal: false, stealPick: false };
  const end = await playOut(sb, as, A, B, code, (state) => {
    if (!spent.respin) { spent.respin = true; return { respin: "team" }; }
    if (!spent.stealPick && state.turn.first) { spent.stealPick = true; return { stealPick: true, as: "other" }; }
    // The steal before the dip, and the dip waits for it: a dip gives the dipper two turns back to back, and on
    // the second of them the pick just made is their own, which is not a thing anyone may steal.
    if (!spent.steal && !state.turn.first) { spent.steal = true; return { steal: true }; }
    if (spent.steal && !spent.dip) { spent.dip = true; return { dip: true }; }
    return null;
  });

  const m = await call(sb, "match_state", { p_code: code });
  assert(m.respins.length === 1 && m.respins[0].kind === "team", `the re-spin is on the match: ${JSON.stringify(m.respins)}`);
  assert(m.dips.length === 1, `and the dip: ${JSON.stringify(m.dips)}`);
  assert(m.swaps.length === 1, `and the stolen first pick: ${JSON.stringify(m.swaps)}`);
  assert(m.picks.some((p) => p.stolenBy), "and a pick that changed hands");
  assert(m.picks.length === MATCH_PICKS, `still sixteen picks, got ${m.picks.length}`);
  for (const side of ["host", "guest"]) {
    for (const slot of VERSUS_SLOTS) assert(end.roster[side][slot], `${side} still filled ${slot}`);
  }
  assert(m.status === "done" && m.result, "and the match still finished with a result");
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
  assert(card.startsWith("Gridspin 1v1"), `it says what it is: ${firstLine(card)}`);
  assert(card.includes(`${m.result.host.points}–${m.result.guest.points}`), `with the final on it: ${card}`);
  assert(card.includes("https://gridspin.test"), "and a link, last");
  // Never the players - the same rule the season card follows, for the same reason.
  const names = [...VERSUS_SLOTS.map((s) => end.roster.host[s]), ...VERSUS_SLOTS.map((s) => end.roster.guest[s])]
    .filter((o) => o.kind === "player").map((o) => o.name);
  const leaked = names.filter((n) => card.includes(n));
  assert(leaked.length === 0, `no player is named on it, found ${JSON.stringify(leaked)}`);
  // The opponent's own card is the same match from the other side.
  const theirs = versusShareText(m, m.result, "guest", "https://gridspin.test");
  assert(theirs !== card && theirs.includes(`${m.result.guest.points}–${m.result.host.points}`),
    `and reads from their side: ${firstLine(theirs)}`);
});

console.log("test-versus-flow.mjs done");
