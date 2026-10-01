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
import { initGameData, SLOTS, BOARDS, seededSequence } from "../game-logic.mjs";
import {
  initVersusData, decideMove, replayMatch, optionsOn, optionId, optionFits, openSlots,
  VERSUS_SLOTS, MATCH_PICKS, TURN_SECONDS, matchResult, pickId, optionValue,
  respinBoard, boardServes, dipsLeft, autoPick,
} from "../versus-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
const players = read("data/players.json");
initGameData(players.players, players.opponents);
initVersusData(read("data/versus-pool.json"));

// A match in memory, driven exactly as the Edge Function drives it: decide, then write down what came back.
function newMatch(code, format = "fantasy") {
  const m = { code, format, picks: [], respins: [], dips: [], steals: [], deadline: Date.now() + TURN_SECONDS * 1000 };
  m.state = () => replayMatch(m);
  // A board opens the moment it is dealt, so a move needs no more than a clock that has not run out.
  m.past = () => m.deadline - TURN_SECONDS * 1000 + 1000;
  m.move = (side, move, now = m.past()) => {
    const decided = decideMove({ ...m, side, move, now, deadline: m.deadline });
    if (!decided.ok) return decided;
    if (decided.action === "respin") m.respins.push({ pickNo: decided.pickNo, kind: decided.kind, by: side, key: decided.key });
    else if (decided.action === "dip") m.dips.push({ boardIdx: decided.boardIdx, at: decided.at, by: side });
    // Appended to the match, as the Edge Function does it: match_picks is append-only.
    else if (decided.action === "steal") m.steals.push({ at: decided.at, by: side, pickNo: decided.pickNo, slot: decided.slot });
    else {
      const o = decided.option;
      m.picks.push({
        pickNo: decided.pickNo, kind: o.kind, slot: decided.slot, auto: decided.auto,
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
// Fills slots in the order given, taking the best option for the first of them the board can serve. The two
// reproductions below need a particular draft, not any draft: what strands somebody is the board having been
// picked over in a particular way, so takeSomething's "first thing that fits" cannot reach them.
const takeInOrder = (m, want) => {
  const st = m.state();
  const open = openSlots(st.roster[st.turn.side]);
  const legal = [];
  for (const o of optionsOn(st.boardKey)) {
    if (st.taken.has(optionId(o))) continue;
    for (const slot of open) if (optionFits(o, slot)) legal.push({ o, slot });
  }
  legal.sort((x, y) => (want.indexOf(x.slot) - want.indexOf(y.slot))
    || (optionValue(y.o, y.slot, m.format) - optionValue(x.o, x.slot, m.format)));
  const best = legal[0];
  return m.move(st.turn.side, {
    boardIdx: st.boardIdx, kind: best.o.kind, slot: best.slot,
    playerId: best.o.kind === "player" ? best.o.id : undefined,
    team: best.o.kind === "player" ? undefined : best.o.team, season: best.o.season,
  });
};
// A steal names the pick it takes, so a test has to say which - the same lookup the screen does.
const pickOn = (m, side, slot) => {
  const o = m.state().roster[side][slot];
  return o && m.picks.find((p) => pickId(p) === optionId(o));
};
const anyOf = (m, side) => VERSUS_SLOTS.map((sl) => pickOn(m, side, sl)).find(Boolean);

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
  assert(m.move(off, { steal: true, pickNo: 1 }).reason === "not_your_turn", "nor a steal");

  assert(m.move(on, { steal: true, pickNo: 1 }).reason === "nothing_to_steal", "nothing to steal before they have picked");

  assert(m.move(on, { respin: "team" }).ok, "a team re-spin is spent");
  assert(m.move(on, { respin: "team" }).reason === "no_respins_left", "and there is only one");
  assert(m.move(on, { respin: "era" }).ok, "the era one is its own");
  assert(m.move(on, { respin: "era" }).reason === "no_respins_left", "also only one");
  assert(m.respins.length === 2, "two spent in all");

  assert(m.move(on, { dip: true }).ok, "a dip is spent");
  assert(m.move(on, { dip: true }).reason === "no_dips_left", "but only one");
});

// Three powerups that used to be accepted, written, counted, and then never read - the counter went down and
// the board did not move. Refused costs nothing and keeps them for a turn that works.
await runTest("a powerup that would do nothing is refused, not spent", async () => {
  const m = newMatch("RULES4C");
  const on = m.state().turn.side;

  // A re-spin belongs before your FIRST pick on a board. A dip gives the dipper two turns back to back, and
  // replayMatch only ever looks a spin up on the first of them.
  assert(m.move(on, { dip: true }).ok, "the leader doubles up");
  assert(m.takeSomething().ok, "and takes the first of their two");
  const second = m.state();
  assert(second.turn.side === on && !second.turn.ownFirst, `still their board, second turn: ${JSON.stringify(second.turn)}`);
  assert(m.move(on, { respin: "team" }).reason === "respin_too_late", "a re-spin on that second turn is refused");
  assert(m.move(on, { respin: "era" }).reason === "respin_too_late", "either of them");
  assert(m.respins.length === 0, "and neither was spent");

  // One dip a board, whoever asks. replayMatch applies only the first entry it finds for a board, so a second
  // was written, counted against that player's one dip, and then ignored entirely - no extra pick, no forfeit.
  assert(m.takeSomething().ok, "the dipper takes the second of their two");
  const off = m.state().turn.side;
  assert(off !== on, `now the other player, on the same board: ${JSON.stringify(m.state().turn)}`);
  assert(m.move(off, { dip: true }).reason === "already_dipped", "who cannot dip a board that is already dipped");
  assert(m.dips.length === 1, "one dip written, not two");

  // The board AFTER a dip belongs to one player alone, because the dipper forfeited it.
  assert(m.takeSomething().ok, "the other player finishes the dipped board");
  const solo = m.state();
  assert(solo.turn.left.length === 1, `the forfeited board has one turn left on it: ${JSON.stringify(solo.turn)}`);
});

// A steal takes ANY one player off the other roster, not only the pick just made. Under the old rule ten of the
// sixteen picks in a match could never be stolen at all: the snake gives each player two turns in a row across
// a board boundary, so the second of that pair is followed by their OWN turn, and there is never a moment when
// it is the other player's turn and that pick is the last one made.
await runTest("a steal takes any one of their players, from any board", async () => {
  const m = newMatch("RULES5");
  assert(m.takeSomething().ok, "the leader picked");
  const st = m.state();
  const follow = st.turn.side, lead = otherSide(follow);

  assert(m.move(lead, { steal: true, pickNo: 1 }).reason === "not_your_turn", "not on the other player's turn");
  assert(m.move(follow, { steal: true, pickNo: 99 }).reason === "nothing_to_steal", "not a pick that does not exist");

  // Play on, so there is something to steal that ISN'T the pick just made - the case the old rule could not
  // reach. Four picks in, across two boards.
  assert(m.takeSomething().ok, "the follower picked");
  assert(m.takeSomething().ok, "and on into board 1");
  assert(m.takeSomething().ok, "both of them");
  const mid = m.state();
  const thief = mid.turn.side, victim = otherSide(thief);
  assert(mid.boardIdx >= 1, `two boards in, got board ${mid.boardIdx}`);

  // Their FIRST pick, from board 0 - the oldest thing they own, and never stealable before this.
  const oldest = m.picks.filter((p) => {
    const o = VERSUS_SLOTS.map((sl) => mid.roster[victim][sl]).find((x) => x && optionId(x) === pickId(p));
    return !!o;
  })[0];
  assert(oldest && oldest.pickNo <= 2, `their oldest pick is from board 0, got ${oldest?.pickNo}`);
  assert(m.move(thief, { steal: true, pickNo: oldest.pickNo }).ok, "and it can be taken");

  const after = m.state();
  const took = (after.steals || m.steals)[0];
  assert(VERSUS_SLOTS.some((sl) => after.roster[thief][sl] && optionId(after.roster[thief][sl]) === pickId(oldest)),
    "he is on the thief's roster now");
  assert(!VERSUS_SLOTS.some((sl) => after.roster[victim][sl] && optionId(after.roster[victim][sl]) === pickId(oldest)),
    "and off the other's");
  // The thief spent their turn on it, so the turn is the robbed player's - to replace what was taken, off the
  // board in front of them both.
  assert(after.turn.side === victim, `the robbed player is on the clock: ${after.turn.side}`);
  assert(after.boardIdx === mid.boardIdx, "on the same board the steal was spent on");
  assert(took.at === mid.pickNo, `the steal is recorded against the turn it cost: ${took.at} vs ${mid.pickNo}`);

  // Retaliating on the spot is refused for the turn, not for the player: a steal does not advance the pick
  // number, so the victim is on the clock at the same turn and both records would carry the same `at` -
  // replayMatch keys them by it, so the second overwrote the first and both powerups bought nothing at all.
  assert(m.move(victim, { steal: true, pickNo: oldest.pickNo }).reason === "stolen_this_turn",
    "the robbed player cannot steal back on the same turn");

  // Nor a double dip, which is the one that destroyed a powerup outright rather than wasting two. A dip
  // splices an extra turn in after the dipper's first, moving every later index on the board along one, and
  // replayMatch applies a steal only while the thief is still the side sitting at the turn it was keyed on.
  // So the dip dropped the steal without a word: the man went back to the victim - who has just been handed
  // this very turn, with the Double dip button live in front of them - while the row stayed in the match,
  // counting against the thief's one steal. Reproduced on five match codes before the guard was written.
  assert(dipsLeft(m.dips, victim) === 1, "the robbed player still has their double dip");
  assert(m.move(victim, { dip: true }).reason === "stolen_this_turn",
    "and cannot spend it on the turn the steal was spent on");
  assert(m.takeSomething(victim).ok, "they take something else instead");

  // And never the same player twice, on any later turn - otherwise the steal is a tug of war and two powerups
  // buy nobody anything. The owner asked for that rule the first time it came up.
  let asked = null;
  for (let guard = 0; guard < 6 && !m.state().done; guard++) {
    const now = m.state();
    if (now.turn.side === victim) { asked = m.move(victim, { steal: true, pickNo: oldest.pickNo }); break; }
    assert(m.takeSomething().ok, "playing on to the victim's next turn");
  }
  assert(asked && asked.reason === "already_stolen",
    `a turn later, he has already changed hands: ${asked && asked.reason}`);
});

// One man, one duel roster - through BOTH doors onto it. 2.18.12 added the rule and guarded only the door the
// player chooses; the clock is the other one, and it is not an edge case in a mode with a 45-second turn that
// either player may claim. `optionId` is `player|id|season`, the row identity match_picks needs, so a man
// whose best season for one team and best season for another both land on a match's boards was two different
// options to everything that keys on it - `taken`, `already_taken` and `autoPick`'s own availability.
//
// T00034 is searched for rather than magic: BUF|0 is its board 0 and DET|0 its board 1, and Shawn Bryson
// (id 153) is on both - 2000 for Buffalo, 2003 for Detroit - fitting RB and both Flex slots on each, so the
// second attempt has a slot open and the person rule is the only thing that can refuse it.
await runTest("the same man cannot fill two slots of one roster, by hand or by the clock", async () => {
  const m = newMatch("T00034");
  const mine = m.state().turn.side;
  assert(m.state().boardKey === "BUF|0", `board 0 is Buffalo: ${m.state().boardKey}`);
  assert(m.move(mine, { boardIdx: 0, kind: "player", playerId: 153, season: 2000, slot: "RB" }).ok,
    "his 2000 Buffalo season goes in at RB");

  for (let guard = 0; guard < 6; guard++) {
    const now = m.state();
    if (now.boardIdx === 1 && now.turn.side === mine) break;
    assert(m.takeSomething().ok, "playing on to their next turn, on the board he is also on");
  }
  const st = m.state();
  assert(st.boardIdx === 1 && st.boardKey === "DET|0" && st.turn.side === mine,
    `they are on the clock on Detroit: ${JSON.stringify([st.boardIdx, st.boardKey, st.turn.side])}`);
  assert(VERSUS_SLOTS.some((sl) => st.roster[mine][sl] && st.roster[mine][sl].id === 153), "and still hold him");
  assert(openSlots(st.roster[mine]).includes("FLEX1"), "with a Flex open, so only the person rule can refuse");

  // The door the player chooses.
  const byHand = m.move(mine, { boardIdx: 1, kind: "player", playerId: 153, season: 2003, slot: "FLEX1" });
  assert(byHand.reason === "already_on_your_roster",
    `a second season of the same man is refused: ${JSON.stringify(byHand.reason)}`);

  // ...and the door they do not. autoPick keys availability on optionId like everything else, so it took him
  // happily: 2 of 400 matches played out entirely by clock claims ended with one man in two slots before this.
  const auto = autoPick(st.boardKey, st.taken, st.roster[mine], "fantasy");
  assert(auto, "the clock always has something to take - returning null is what bricks a match for good");
  assert(!(auto.option.kind === "player" && auto.option.id === 153),
    `and it is not the man they already hold: ${auto.option.name} ${auto.option.season}`);
  assert(m.move(mine, { claim: "clock" }, m.deadline + 2000).ok, "the expired clock still resolves the turn");
  const after = m.state();
  const held = VERSUS_SLOTS.map((sl) => after.roster[mine][sl]).filter((o) => o && o.kind === "player");
  assert(new Set(held.map((o) => o.id)).size === held.length,
    `no man twice after the clock took one: ${JSON.stringify(held.map((o) => o.name))}`);

  // He is on YOUR roster, not gone from the world: the other player may still take him off that board. Keying
  // the rule on `taken` instead of on the roster would have quietly removed him from the match for both.
  assert(optionsOn("DET|0").some((o) => o.kind === "player" && o.id === 153),
    "he is still on the board for the other player");
});

// The clock half again, on the seed where it actually bit. The test above proves the rule is asked on an
// expired turn; this proves it CHANGES what that turn takes, which the Detroit board could not - the man
// they held was not the best thing on it, so both versions of autoPick walked past him anyway.
//
// CK0466, played entirely by clock claims: at pick 6, on board 2 (LV|4), the guest already holds Davante
// Adams and the old autoPick's highest-value fitting option IS Davante Adams, 2022, at WR. It takes him. The
// duplicate is specifically the player's own best man, because autoPick maximises value and a man good
// enough to be on two of a match's boards is good enough to win both. Measured across 400 all-clock matches,
// 0.5% of them ended with one man in two slots.
await runTest("the clock takes somebody else rather than the man already on your roster", async () => {
  const m = newMatch("CK0466");
  let hitPickSix = false;
  for (let guard = 0; guard < 40; guard++) {
    const st = m.state();
    if (st.done) break;
    const mine = st.roster[st.turn.side];
    const held = new Set(VERSUS_SLOTS.map((sl) => mine[sl]).filter((o) => o && o.kind === "player").map((o) => o.id));
    if (st.pickNo === 6) {
      hitPickSix = true;
      assert(st.boardKey === "LV|4" && st.turn.side === "guest",
        `pick 6 is the guest on Las Vegas: ${JSON.stringify([st.boardKey, st.turn.side])}`);
      assert(held.has(799), "and they are already holding Davante Adams from an earlier board");
      assert(optionsOn(st.boardKey).some((o) => o.kind === "player" && o.id === 799 && o.season === 2022),
        "whose 2022 season is sitting right there on this one");
    }
    const auto = autoPick(st.boardKey, st.taken, mine, "fantasy");
    assert(auto, `the clock always has something to take at pick ${st.pickNo}`);
    assert(!(auto.option.kind === "player" && held.has(auto.option.id)),
      `pick ${st.pickNo}: the clock took a man they already hold - ${auto.option.name}`);
    assert(m.move(st.turn.side, { claim: "clock" }, m.deadline + 2000).ok, `the clock resolves pick ${st.pickNo}`);
  }
  assert(hitPickSix, "the match reached pick 6, which is the one that used to duplicate");

  const end = m.state();
  assert(end.done, "a match played entirely by the clock still finishes");
  for (const side of ["host", "guest"]) {
    const men = VERSUS_SLOTS.map((sl) => end.roster[side][sl]).filter((o) => o && o.kind === "player");
    assert(new Set(men.map((o) => o.id)).size === men.length,
      `${side} has no man twice: ${JSON.stringify(men.map((o) => `${o.name} ${o.season}`))}`);
  }
  assert(matchResult(end.roster, "fantasy"), "and it grades, which a roster with an empty slot would not");
});

// The steal rewrites the order a board was cleared for, and for one release nothing re-asked whether the board
// could still serve it. Both of these bricked the match for good: legalPicks empty, autoPick null, so the clock
// answered 500 for ever, no result was ever computed, neither player got a record, and the only way out was the
// runbook's `update matches set status = 'abandoned'`. Roughly one duel in two hundred once both players were
// holding their powerups for the endgame, which is how they will really be spent.
//
// Both codes are the ones the two shapes were found on. They are pinned deliberately: the seeded board sequence
// is what makes them reproducible, and a fuzzer that happened to find them once would not find them again.
await runTest("a steal that would leave the board with nothing to pick is refused", async () => {
  // One: the last turn of the whole match, no other powerup involved. PIT|2 is one of only two boards in the
  // game holding a single tight end. The host reaches it with TE as their last open slot, so turn 15 is
  // forced; the guest, on the clock at turn 16 with a flex open, takes that tight end - the most attractive
  // use of the powerup there is, since it converts your last pick into their best player. The host's TE slot
  // reopens, the man is taken, and there is nothing else on the board that fits it.
  const a = newMatch("QZAC4B");
  const want = {
    host: ["QB", "RB", "WR", "FLEX1", "FLEX2", "DST", "K", "TE"],
    guest: ["QB", "RB", "WR", "TE", "FLEX2", "DST", "K", "FLEX1"],
  };
  for (let guard = 0; guard < 20; guard++) {
    const st = a.state();
    if (st.done || st.pickNo === MATCH_PICKS) break;
    assert(takeInOrder(a, want[st.turn.side]).ok, `pick ${st.pickNo} went through`);
  }
  const last = a.state();
  assert(last.pickNo === MATCH_PICKS && last.turn.side === "guest", `turn 16, guest: ${last.pickNo} ${last.turn?.side}`);
  assert(openSlots(last.roster.host).length === 0, "the host's roster is full");
  const heath = a.picks.find((p) => p.pickNo === 15);
  assert(a.move("guest", { steal: true, pickNo: 15 }).reason === "would_strand",
    "the last pick of the match cannot be stolen out from under a board that cannot replace it");
  // And the match still finishes, because a refusal costs nothing: the guest keeps their steal and picks.
  assert(takeInOrder(a, want.guest).ok, "the guest picks instead");
  const endA = a.state();
  assert(endA.done, "sixteen picks");
  assert(matchResult({ code: a.code, format: a.format, host: endA.roster.host, guest: endA.roster.guest }),
    "and a result");
  void heath;

  // Two: a dip and a steal on one board, which is the common one. The board was cleared to serve the dipper
  // twice and the other player once, IN THAT ORDER; the steal moves the dipper down the order, so the other
  // player picks first and takes what the dipper needed.
  const b = newMatch("JVBP26", "standard");
  const order = {
    host: ["TE", "FLEX1", "WR", "FLEX2", "DST", "RB", "QB", "K"],
    guest: ["FLEX1", "RB", "WR", "DST", "FLEX2", "QB", "TE", "K"],
  };
  for (let guard = 0; guard < 20; guard++) {
    const st = b.state();
    if (st.done || st.boardIdx >= 6) break;
    assert(takeInOrder(b, order[st.turn.side]).ok, `pick ${st.pickNo} went through`);
  }
  const board6 = b.state();
  assert(board6.boardIdx === 6, `on board 6: ${board6.boardIdx}`);
  const dipper = board6.turn.side;
  assert(b.move(dipper, { dip: true }).ok, "they take two off this board and give up the next");
  const theirs = anyOf(b, otherSide(dipper));
  const asked = b.move(dipper, { steal: true, pickNo: theirs.pickNo });
  assert(!asked.ok, `and cannot also steal on the same turn: ${asked.reason}`);
  // Playing on from there finishes, which is the whole point - the dip stands and the steal is still theirs.
  for (let guard = 0; guard < 20 && !b.state().done; guard++) {
    assert(takeInOrder(b, order[b.state().turn.side]).ok, "playing the dipped board out");
  }
  assert(b.state().done, "sixteen picks");
  const endB = b.state();
  assert(matchResult({ code: b.code, format: b.format, host: endB.roster.host, guest: endB.roster.guest }),
    "and a result");
});

await runTest("a match plays to the end, powerups and all, and the server grades it", async () => {
  const m = newMatch("FULL1");
  let spentDip = false, spentSteal = false, spentRespin = false;
  for (let guard = 0; guard < 60 && !m.state().done; guard++) {
    const st = m.state();
    const side = st.turn.side;
    // Spend each powerup once, the first time it is legal, so one match exercises all four.
    if (!spentRespin && m.move(side, { respin: "team" }).ok) { spentRespin = true; continue; }
    if (!spentDip && m.move(side, { dip: true }).ok) { spentDip = true; continue; }
    if (!spentSteal) { const t = anyOf(m, otherSide(side)); if (t && m.move(side, { steal: true, pickNo: t.pickNo }).ok) { spentSteal = true; continue; } }
    assert(m.takeSomething().ok, `pick ${st.pickNo} went through`);
  }
  assert(spentRespin && spentDip && spentSteal,
    `all three were spent: ${JSON.stringify({ spentRespin, spentDip, spentSteal })}`);

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

await runTest("a re-spin finds a board when all you still need is a defense or a kicker", async () => {
  // Found by playing a real duel: re-spinning with only the defense left said "There's no other board to spin
  // to" - about boards every single one of which carries a defense. respinBoard leans on game-logic's
  // rerollCandidate, whose board test knew only about PLAYERS: fits(pos, "DST") is false for every player
  // alive, so 0 of 160 boards qualified. The same call also passed a set of versus optionIds where that
  // function expected raw player ids, so nothing ever counted as taken either and a re-spin could land on a
  // board that had already been stripped.
  const empty = () => Object.fromEntries(VERSUS_SLOTS.map((s) => [s, null]));
  const filler = { kind: "player", id: -1, season: 2020, pos: "QB", rating: 80 };

  for (const only of ["DST", "K"]) {
    const roster = empty();
    for (const s of VERSUS_SLOTS) if (s !== only) roster[s] = filler;
    const open = openSlots(roster);
    assert(open.length === 1 && open[0] === only, `the roster needs only ${only}: ${JSON.stringify(open)}`);
    // Every board can serve it - that is the premise the refusal contradicted.
    const serving = Object.keys(BOARDS).filter((k) => boardServes(k, new Set(), open, null)).length;
    assert(serving === Object.keys(BOARDS).length, `every board carries a ${only}: ${serving} of ${Object.keys(BOARDS).length}`);
    for (const kind of ["team", "era"]) {
      const got = respinBoard({ code: "ABC123", kind, pickNo: 15, key: "KC|3", seq: seededSequence("ABC123"),
        used: new Set(), taken: new Set(), roster, otherRoster: empty() });
      assert(got, `a ${kind} re-spin finds a board when only ${only} is open`);
      assert(boardServes(got, new Set(), open, null), `and it is one that can serve them: ${got}`);
    }
  }

  // ...and `taken` is honoured, which it was not: a board with nothing left on it is not a candidate.
  const roster = empty();
  roster.QB = filler;
  const open = openSlots(roster);
  const key = "KC|3";
  const stripped = new Set(optionsOn(key).map(optionId));
  assert(!boardServes(key, stripped, open, null), "a board whose every option is taken serves nobody");
  let landedOnStripped = 0;
  for (let i = 0; i < 40; i++) {
    const got = respinBoard({ code: `STRIP${i}`, kind: "era", pickNo: 3, key, seq: seededSequence(`STRIP${i}`),
      used: new Set(), taken: stripped, roster, otherRoster: empty() });
    if (got === key) landedOnStripped++;
    if (got) assert(boardServes(got, stripped, open, null), `a re-spin never lands on a board with nothing left: ${got}`);
  }
  assert(landedOnStripped === 0, `and never on the stripped board itself: ${landedOnStripped} times`);
});

console.log("test-versus-rules.mjs done");
