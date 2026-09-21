// Every refusal the match-pick Edge Function makes (VERSUS.md 4), against the real rules rather than a mirror
// of them: `decideMove` in versus-logic.mjs is the function's whole brain, and index.ts only writes down what it
// returns. So what runs here is what runs on the server.
//
// Also the thing those refusals exist for: a match played out end to end, with every powerup spent, still
// finishing with two full legal rosters and a result neither client decided.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, runTest } from "./helpers.mjs";
import { initGameData, SLOTS } from "../game-logic.mjs";
import {
  initVersusData, decideMove, replayMatch, optionsOn, optionId, optionFits, openSlots,
  VERSUS_SLOTS, MATCH_PICKS, TURN_SECONDS, matchResult,
} from "../versus-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
const players = read("data/players.json");
initGameData(players.players, players.opponents);
initVersusData(read("data/versus-pool.json"));

// A match in memory, driven exactly as the Edge Function drives it: decide, then write down what came back.
function newMatch(code, format = "fantasy") {
  const m = { code, format, picks: [], respins: [], dips: [], swaps: [], deadline: Date.now() + TURN_SECONDS * 1000 };
  m.state = () => replayMatch(m);
  m.move = (side, move, now = Date.now()) => {
    const decided = decideMove({ ...m, side, move, now, deadline: m.deadline });
    if (!decided.ok) return decided;
    if (decided.action === "respin") m.respins.push({ pickNo: decided.pickNo, kind: decided.kind, by: side, key: decided.key });
    else if (decided.action === "dip") m.dips.push({ boardIdx: decided.boardIdx, by: side });
    else if (decided.action === "swap") m.swaps.push({ boardIdx: decided.boardIdx, by: side });
    else if (decided.action === "steal") {
      const row = m.picks.find((p) => p.pickNo === decided.pickNo);
      row.slot = decided.slot;
      row.stolenBy = side;
    } else {
      const o = decided.option;
      m.picks.push({
        pickNo: decided.pickNo, kind: o.kind, slot: decided.slot, auto: decided.auto, stolenBy: null,
        playerId: o.kind === "player" ? o.id : null, team: o.kind === "player" ? null : o.team, season: o.season,
      });
    }
    m.deadline = now + TURN_SECONDS * 1000;
    return decided;
  };
  // Take the first thing on the board that fits an open slot - deliberately not the best, so tests that want a
  // specific option can still find one left.
  m.takeSomething = (side) => {
    const st = m.state();
    const open = openSlots(st.roster[st.turn.side]);
    const o = optionsOn(st.boardKey).find((x) => !st.taken.has(optionId(x)) && open.some((s) => optionFits(x, s)));
    const slot = open.find((s) => optionFits(o, s));
    return m.move(side ?? st.turn.side, {
      boardIdx: st.boardIdx, kind: o.kind, slot,
      playerId: o.kind === "player" ? o.id : undefined, team: o.kind === "player" ? undefined : o.team, season: o.season,
    });
  };
  return m;
}
const otherSide = (s) => (s === "host" ? "guest" : "host");

await runTest("a pick is refused for each of the reasons in the contract, in order", async () => {
  const m = newMatch("RULES1");
  const st = m.state();
  const on = st.turn.side, off = otherSide(on);
  const board = optionsOn(st.boardKey);
  const qb = board.find((o) => o.kind === "player" && o.pos === "QB");
  const dst = board.find((o) => o.kind === "dst");
  const good = { boardIdx: st.boardIdx, kind: "player", playerId: qb.id, season: qb.season, slot: "QB" };

  assert(m.move(off, good).reason === "not_your_turn", "the player not on the clock can't pick");
  assert(m.move(on, { ...good, boardIdx: st.boardIdx + 1 }).reason === "wrong_board", "nor from another board");
  assert(m.move(on, { ...good, playerId: 999999 }).reason === "not_on_board", "nor someone who isn't on this one");
  assert(m.move(on, { ...good, season: qb.season + 50 }).reason === "not_on_board", "nor a season he didn't play here");
  assert(m.move(on, { ...good, slot: "RB" }).reason === "bad_slot", "a quarterback is not a running back");
  assert(m.move(on, { ...good, slot: "FLEX1" }).reason === "bad_slot", "and never a flex");
  assert(m.move(on, { kind: "dst", boardIdx: st.boardIdx, team: dst.team, season: dst.season, slot: "FLEX2" }).reason === "bad_slot",
    "a defense is not a flex either");
  assert(m.move(on, { kind: "dst", boardIdx: st.boardIdx, team: dst.team, season: dst.season, slot: "K" }).reason === "bad_slot",
    "nor a kicker");
  assert(m.picks.length === 0, "and none of that wrote anything down");

  assert(m.move(on, good).ok, "the legal pick goes through");
  assert(m.picks.length === 1 && m.picks[0].slot === "QB", "and is the only thing recorded");

  // Now the other player, on the same board, minus what was just taken.
  assert(m.move(off, good).reason === "already_taken", "the other player can't take the same man");
  assert(m.move(on, { ...good, slot: "RB" }).reason === "not_your_turn", "and the first player's turn is over");
  const st2 = m.state();
  assert(st2.turn.side === off && st2.boardKey === st.boardKey, "they are looking at the same board");
});

await runTest("a filled slot can't be filled twice", async () => {
  const m = newMatch("RULES2");
  m.takeSomething();
  m.takeSomething();
  const st = m.state();
  const filled = VERSUS_SLOTS.find((s) => st.roster[st.turn.side][s]);
  if (!filled) return; // the player on the clock hasn't picked yet on this seed
  const o = optionsOn(st.boardKey).find((x) => !st.taken.has(optionId(x)) && optionFits(x, filled));
  if (!o) return;
  assert(m.move(st.turn.side, {
    boardIdx: st.boardIdx, kind: o.kind, slot: filled,
    playerId: o.kind === "player" ? o.id : undefined, team: o.kind === "player" ? undefined : o.team, season: o.season,
  }).reason === "bad_slot", `${filled} is already filled`);
});

await runTest("the clock is the row's, not the client's", async () => {
  const m = newMatch("RULES3");
  const st = m.state();
  assert(m.move(st.turn.side, { claim: "clock" }).reason === "too_early", "a client that says time is up early is refused");
  assert(m.move(otherSide(st.turn.side), { claim: "clock" }).reason === "too_early", "from either of them");
  assert(m.picks.length === 0, "and nothing is taken for anyone");

  const late = m.deadline + 1;
  // Either player may call it: that is how a match survives an opponent who closed the tab.
  const done = m.move(otherSide(st.turn.side), { claim: "clock" }, late);
  assert(done.ok && done.auto, `the clock picks for the player on it: ${JSON.stringify(done.reason || "")}`);
  assert(m.picks[0].auto === true, "and the pick says it was the clock's");
  assert(m.picks[0].pickNo === 1, "in the turn it was owed");
});

await runTest("a powerup can't be spent twice, or out of turn", async () => {
  const m = newMatch("RULES4");
  const st = m.state();
  const on = st.turn.side, off = otherSide(on);
  assert(m.move(off, { respin: "team" }).reason === "not_your_turn", "not on your opponent's turn");
  assert(m.move(off, { dip: true }).reason === "not_your_turn", "for any of them");
  assert(m.move(off, { steal: true }).reason === "not_your_turn", "");
  assert(m.move(off, { stealPick: true }).reason === "not_your_turn", "");

  assert(m.move(on, { steal: true }).reason === "nothing_to_steal", "nothing to steal before they have picked");
  assert(m.move(on, { stealPick: true }).reason === "already_leading", "and no first pick to take when you have it");

  assert(m.move(on, { respin: "team" }).ok, "a team re-spin is spent");
  assert(m.move(on, { respin: "team" }).reason === "no_respins_left", "and there is only one");
  assert(m.move(on, { respin: "era" }).ok, "the era one is its own");
  assert(m.move(on, { respin: "era" }).reason === "no_respins_left", "also only one");
  assert(m.respins.length === 2, "two spent in all");

  assert(m.move(on, { dip: true }).ok, "a dip on top of that is allowed");
  assert(m.move(on, { dip: true }).reason === "no_dips_left", "but only one");
});

await runTest("a steal takes the pick just made, and only that one", async () => {
  const m = newMatch("RULES5");
  const first = m.takeSomething();
  assert(first.ok, "the leader picked");
  const st = m.state();
  const follow = st.turn.side;
  assert(m.move(otherSide(follow), { steal: true }).reason === "not_your_turn", "the leader can't steal his own pick back");

  const stolen = m.move(follow, { steal: true });
  assert(stolen.ok, `the follower takes it: ${JSON.stringify(stolen.reason || "")}`);
  const after = m.state();
  assert(after.roster[follow][stolen.slot], "it is on the thief's roster");
  assert(!VERSUS_SLOTS.some((s) => after.roster[otherSide(follow)][s]), "and off the other's entirely");
  assert(after.turn.side === otherSide(follow), "who is back on the clock");
  assert(after.boardKey === st.boardKey, "on the same board");
  assert(m.move(after.turn.side, { steal: true }).reason === "nothing_to_steal", "and can't steal the pick that was just stolen");
});

await runTest("a match plays to the end, powerups and all, and the server grades it", async () => {
  const m = newMatch("FULL1");
  let spentDip = false, spentSteal = false, spentSwap = false, spentRespin = false;
  for (let guard = 0; guard < 60 && !m.state().done; guard++) {
    const st = m.state();
    const side = st.turn.side;
    // Spend each powerup once, the first time it is legal, so one match exercises all four.
    if (!spentRespin && m.move(side, { respin: "team" }).ok) { spentRespin = true; continue; }
    if (!spentSwap && !st.turn.first && m.move(side, { stealPick: true }).ok) { spentSwap = true; continue; }
    if (!spentDip && m.move(side, { dip: true }).ok) { spentDip = true; continue; }
    if (!spentSteal && !st.turn.first && m.move(side, { steal: true }).ok) { spentSteal = true; continue; }
    assert(m.takeSomething().ok, `pick ${st.pickNo} went through`);
  }
  assert(spentRespin && spentSwap && spentDip && spentSteal,
    `all four were spent: ${JSON.stringify({ spentRespin, spentSwap, spentDip, spentSteal })}`);

  const end = m.state();
  assert(end.done, "the match finished");
  assert(m.picks.length === MATCH_PICKS, `sixteen picks, powerups and all, got ${m.picks.length}`);
  for (const side of ["host", "guest"]) {
    for (const slot of VERSUS_SLOTS) assert(end.roster[side][slot], `${side} filled ${slot}`);
    for (const slot of SLOTS) assert(optionFits(end.roster[side][slot], slot), `${side}'s ${slot} fits it`);
  }
  const ids = ["host", "guest"].flatMap((s) => VERSUS_SLOTS.map((sl) => optionId(end.roster[s][sl])));
  assert(new Set(ids).size === 16, "nothing was drafted twice");

  const result = matchResult({ code: "FULL1", format: "fantasy", host: end.roster.host, guest: end.roster.guest });
  assert(result && (result.winner === null || result.winner === (result.host.score > result.guest.score ? "host" : "guest")),
    `the higher score won: ${JSON.stringify(result)}`);
  assert(m.move("host", { claim: "clock" }, m.deadline + 1).reason === "already_finished",
    "and a finished match takes no more moves");
});

console.log("test-versus-rules.mjs done");
