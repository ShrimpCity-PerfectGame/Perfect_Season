// versus-logic.mjs: the rules a 1v1 draft would break quietly if they were wrong (VERSUS.md 7 and 8), plus the
// result (VERSUS.md 6). No database and no network - this is the arithmetic both the browser and the Edge
// Function run, tested once, here.
//
// The centre of it is the case the owner asked about: both players still need a quarterback and the board has
// one. That is not hypothetical - 33 of the 160 boards are one deep at a position.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, runTest } from "./helpers.mjs";
import { initGameData, BOARDS, SLOTS, WINDOWS, QB_WEIGHT, effectiveRating } from "../game-logic.mjs";
import {
  initVersusData, VERSUS_SLOTS, MATCH_BOARDS, MATCH_PICKS, SLOT_WORTH, AVERAGE_RATING,
  optionsOn, unitsOn, optionId, optionFits, optionValue, turnAt, firstPickerOn,
  boardServesBoth, replayMatch, autoPick, openSlots, matchResult, footballFinal, offenseScore,
  respinBoard, respinsLeft, MATCH_RESPINS, firstPickerOn as leadOn,
  stealableSlots, stealsLeft, MATCH_STEALS, optionValue as worth,
} from "../versus-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
const players = read("data/players.json");
initGameData(players.players, players.opponents);
initVersusData(read("data/versus-pool.json"));

const countPos = (key, pos) => (BOARDS[key] || []).filter((p) => p.pos === pos).length;
const ONE_QB = Object.keys(BOARDS).find((k) => countPos(k, "QB") === 1);

await runTest("the snake: sixteen picks, eight each, the lead alternating by board", async () => {
  const mine = { host: 0, guest: 0 };
  const leads = [];
  for (let pickNo = 1; pickNo <= MATCH_PICKS; pickNo++) {
    const t = turnAt(pickNo);
    mine[t.side]++;
    if (t.first) leads.push(t.side);
    assert(t.boardIdx === Math.floor((pickNo - 1) / 2), `pick ${pickNo} is on board ${t.boardIdx}`);
    assert(t.side === (t.first ? firstPickerOn(t.boardIdx) : firstPickerOn(t.boardIdx) === "host" ? "guest" : "host"),
      `pick ${pickNo}: ${t.side} ${t.first ? "leads" : "follows"} board ${t.boardIdx}`);
  }
  assert(mine.host === 8 && mine.guest === 8, `eight picks each, got ${JSON.stringify(mine)}`);
  assert(JSON.stringify(leads) === JSON.stringify(["host", "guest", "host", "guest", "host", "guest", "host", "guest"]),
    `the lead alternates every board, got ${leads.join(",")}`);
});

await runTest("a board offers players, a defense per year and a kicker per year", async () => {
  for (const key of ["BAL|1", "IND|0", "SEA|2"]) {
    const [, w] = key.split("|");
    const [from, to] = WINDOWS[Number(w)];
    const { defenses, kickers } = unitsOn(key);
    assert(defenses.length === to - from + 1, `${key}: one defense per year of ${from}-${to}, got ${defenses.length}`);
    assert(kickers.length === to - from + 1, `${key}: one kicker per year, got ${kickers.length}`);
    assert(defenses.every((d, i) => d.season === from + i), `${key}: in order, got ${defenses.map((d) => d.season).join(",")}`);
    const all = optionsOn(key);
    assert(all.length === BOARDS[key].length + defenses.length + kickers.length, `${key}: everything is on the one board`);
    assert(new Set(all.map(optionId)).size === all.length, `${key}: nothing is on it twice`);
  }
  // A team's defense and its kicker from the same year are two different things, and must never share an id.
  const { defenses, kickers } = unitsOn("BAL|1");
  assert(optionId(defenses[0]) !== optionId(kickers[0]), "a defense is not its own kicker");
});

await runTest("what fits where: a defense is not a flex", async () => {
  const board = optionsOn("BAL|1");
  const dst = board.find((o) => o.kind === "dst");
  const kick = board.find((o) => o.kind === "k");
  const qb = board.find((o) => o.kind === "player" && o.pos === "QB");
  const wr = board.find((o) => o.kind === "player" && o.pos === "WR");

  assert(optionFits(dst, "DST") && !optionFits(dst, "FLEX1") && !optionFits(dst, "K") && !optionFits(dst, "QB"), "a defense only goes in DST");
  assert(optionFits(kick, "K") && !optionFits(kick, "FLEX2") && !optionFits(kick, "DST"), "a kicker only goes in K");
  assert(optionFits(qb, "QB") && !optionFits(qb, "DST") && !optionFits(qb, "K") && !optionFits(qb, "FLEX1"), "a quarterback can't be a defense, or a flex");
  assert(optionFits(wr, "WR") && optionFits(wr, "FLEX1") && !optionFits(wr, "DST"), "a receiver flexes, but isn't a defense");
});

await runTest("a defense and a kicker are each worth exactly one roster slot", async () => {
  // VERSUS.md 6: SLOT_WORTH is 1/6.25, which is what one ordinary slot is worth in the six-player weighted mean.
  // The check that matters is that it is not a tuned number: a defense rated X above average and a running back
  // rated X above average move a final score by the same amount.
  const board = optionsOn("BAL|1");
  const dst = board.find((o) => o.kind === "dst");
  const asDefense = optionValue(dst, "DST", "fantasy");
  assert(Math.abs(asDefense - (dst.rating - AVERAGE_RATING) * SLOT_WORTH) < 1e-9, "a defense is worth what it is above average");
  const rb = board.find((o) => o.kind === "player" && o.pos === "RB");
  const asBack = optionValue(rb, "RB", "fantasy");
  const sameEdge = { ...dst, rating: rb.rating };
  assert(Math.abs(optionValue(sameEdge, "DST", "fantasy") - asBack) < 1e-9,
    `equal ratings are equal points: back ${asBack.toFixed(3)} vs defense ${optionValue(sameEdge, "DST", "fantasy").toFixed(3)}`);
  // A quarterback carries the roster's extra weight, so the same distance from average counts for QB_WEIGHT
  // times as much - in both directions. (A bad quarterback hurts more than a bad defense, which is the point.)
  const qb = board.find((o) => o.kind === "player" && o.pos === "QB");
  const qbRating = effectiveRating("QB", qb, "fantasy");
  const asDefenseWouldBe = optionValue({ ...dst, rating: qbRating }, "DST", "fantasy");
  assert(Math.abs(optionValue(qb, "QB", "fantasy") / asDefenseWouldBe - QB_WEIGHT) < 1e-9,
    `a quarterback counts ${QB_WEIGHT}x, got ${(optionValue(qb, "QB", "fantasy") / asDefenseWouldBe).toFixed(4)}`);
});

await runTest("a one-quarterback board can't serve two players who both need one", async () => {
  assert(ONE_QB, "the data has a board with a single quarterback");
  const bothNeedQb = boardServesBoth(ONE_QB, new Set(), ["QB"], ["QB"]);
  assert(!bothNeedQb, `${ONE_QB} holds one quarterback, so it cannot serve two who need one`);

  // One of them needing him is fine - the other has the whole rest of the board.
  assert(boardServesBoth(ONE_QB, new Set(), ["QB"], ["RB"]), "and it serves them when only one needs the quarterback");
  assert(boardServesBoth(ONE_QB, new Set(), ["RB"], ["QB"]), "in either order");

  // The exact-one clause, from both sides. With a single option left on the whole board:
  const oneLeft = new Set(optionsOn(ONE_QB).map(optionId));
  const keepDst = unitsOn(ONE_QB).defenses[0];
  oneLeft.delete(optionId(keepDst));
  assert(boardServesBoth(ONE_QB, oneLeft, ["QB"], ["DST"]) === false, "a leader with nothing left is not served either");
  assert(boardServesBoth(ONE_QB, oneLeft, ["DST"], ["DST"]) === false, "and one defense cannot serve two who need one");
  // ...but one option IS enough for the follower when the leader could never have taken it: he wants a kicker,
  // the only thing left is a defense, and nobody is stranded.
  const dstOnly = new Set(optionsOn(ONE_QB).map(optionId));
  const keptDst = unitsOn(ONE_QB).defenses[1], keptKicker = unitsOn(ONE_QB).kickers[0];
  dstOnly.delete(optionId(keptDst));
  dstOnly.delete(optionId(keptKicker));
  assert(boardServesBoth(ONE_QB, dstOnly, ["K"], ["DST"]), "one option serves the follower when the leader wants something else");
});

// Plays a whole match. `choose` picks for a side; the point is to drive orderings a real player might use,
// including the ones that look like they should strand somebody.
function playMatch(code, choose, format = "fantasy", respins = []) {
  const picks = [];
  for (let pickNo = 1; pickNo <= MATCH_PICKS; pickNo++) {
    const state = replayMatch({ code, picks, respins });
    assert(!state.done, `pick ${pickNo}: the match is still going`);
    const key = state.boardKey;
    assert(key, `pick ${pickNo}: a board was dealt`);
    const me = state.roster[state.turn.side];
    const open = openSlots(me);
    const available = optionsOn(key).filter((o) => !state.taken.has(optionId(o)) && open.some((s) => optionFits(o, s)));
    assert(available.length > 0, `pick ${pickNo} (${state.turn.side}, board ${key}): something is available for ${open.join("/")}`);
    const { option, slot } = choose(available, open, state, format);
    picks.push({
      pickNo, kind: option.kind, slot,
      playerId: option.kind === "player" ? option.id : null,
      team: option.kind === "player" ? null : option.team,
      season: option.season,
    });
  }
  return { picks, respins, state: replayMatch({ code, picks, respins }) };
}

const bestValue = (available, open, _state, format) => {
  let best = null;
  for (const o of available) for (const s of open) {
    if (!optionFits(o, s)) continue;
    const v = optionValue(o, s, format);
    if (!best || v > best.value) best = { option: o, slot: s, value: v };
  }
  return best;
};
// The awkward one: take the defense and the kicker first and leave the named slots to the end, which is exactly
// the ordering the owner asked to be allowed and exactly the one that could strand a player.
const unitsFirst = (available, open, state, format) => {
  const order = ["DST", "K", "FLEX1", "FLEX2", "QB", "RB", "WR", "TE"];
  for (const slot of order) {
    if (!open.includes(slot)) continue;
    const fit = available.filter((o) => optionFits(o, slot));
    if (!fit.length) continue;
    return { option: fit.reduce((a, b) => (optionValue(a, slot, format) > optionValue(b, slot, format) ? a : b)), slot };
  }
  return bestValue(available, open, state, format);
};

await runTest("a match always ends with two full legal rosters, whatever order they are filled in", async () => {
  for (let i = 0; i < 25; i++) {
    const code = `MATCH${i}`;
    for (const [label, choose] of [["value first", bestValue], ["defense and kicker first", unitsFirst]]) {
      const { state } = playMatch(code, choose);
      assert(state.done, `${code} ${label}: the match finished`);
      assert(state.boards.length === MATCH_BOARDS, `${code} ${label}: ${state.boards.length} boards`);
      assert(new Set(state.boards).size === MATCH_BOARDS, `${code} ${label}: no board was dealt twice`);
      for (const side of ["host", "guest"]) {
        const r = state.roster[side];
        for (const slot of VERSUS_SLOTS) assert(r[slot], `${code} ${label}: ${side} filled ${slot}`);
        assert(r.DST.kind === "dst" && r.K.kind === "k", `${code} ${label}: ${side}'s defense and kicker are the real thing`);
        for (const slot of SLOTS) assert(optionFits(r[slot], slot), `${code} ${label}: ${side}'s ${slot} fits it`);
      }
      // Nothing was drafted by both, which is the rule the whole mode rests on.
      const ids = [...VERSUS_SLOTS.map((s) => optionId(state.roster.host[s])), ...VERSUS_SLOTS.map((s) => optionId(state.roster.guest[s]))];
      assert(new Set(ids).size === ids.length, `${code} ${label}: nothing was taken twice`);
    }
  }
});

await runTest("both players draft the same board, and the follower picks from what is left", async () => {
  const { picks, state } = playMatch("SHARED1", bestValue);
  for (let boardIdx = 0; boardIdx < MATCH_BOARDS; boardIdx++) {
    const [a, b] = [picks[boardIdx * 2], picks[boardIdx * 2 + 1]];
    const { key, followKey } = state.boards[boardIdx];
    assert(key === followKey, `board ${boardIdx}: nobody re-spun, so both drafted the same board`);
    const ids = new Set(optionsOn(key).map(optionId));
    for (const p of [a, b]) {
      const id = p.kind === "player" ? `player|${p.playerId}|${p.season}` : `${p.kind}|${p.team}|${p.season}`;
      assert(ids.has(id), `board ${boardIdx} (${key}): both picks came off it, ${id} did not`);
    }
  }
});

await runTest("the clock always has something to take", async () => {
  for (let i = 0; i < 10; i++) {
    const code = `CLOCK${i}`;
    const picks = [];
    for (let pickNo = 1; pickNo <= MATCH_PICKS; pickNo++) {
      const state = replayMatch({ code, picks });
      const key = state.boardKey;
      const taken = autoPick(key, state.taken, state.roster[state.turn.side], "fantasy");
      assert(taken, `${code} pick ${pickNo}: the clock found an option`);
      assert(optionFits(taken.option, taken.slot), `${code} pick ${pickNo}: and it fits the slot it chose`);
      picks.push({
        pickNo, kind: taken.option.kind, slot: taken.slot,
        playerId: taken.option.kind === "player" ? taken.option.id : null,
        team: taken.option.kind === "player" ? null : taken.option.team,
        season: taken.option.season,
      });
    }
    const end = replayMatch({ code, picks });
    assert(end.done && VERSUS_SLOTS.every((s) => end.roster.host[s] && end.roster.guest[s]),
      `${code}: a match of nothing but timeouts still ends with two full rosters`);
  }
});

await runTest("a leader's re-spin is a board they hand over too; a follower's is their own", async () => {
  const code = "RESPIN1";
  // The leader re-spins before anyone has picked, so the follower drafts the new board with them.
  const opening = replayMatch({ code, picks: [] });
  const dealt = opening.boardKey;
  const lead = leadOn(0), follow = lead === "host" ? "guest" : "host";
  const swap = respinBoard({
    code, kind: "team", pickNo: 1, key: dealt, seq: opening.seq, used: opening.used,
    taken: opening.taken, roster: opening.roster[lead], otherRoster: opening.roster[follow],
  });
  assert(swap && swap !== dealt, `a re-spin found another board, got ${swap} against ${dealt}`);
  assert(swap.split("|")[1] === dealt.split("|")[1], "a team re-spin keeps the era");

  const shared = [{ pickNo: 1, kind: "team", by: lead, key: swap }];
  const after = replayMatch({ code, picks: [], respins: shared });
  assert(after.boardKey === swap, "the leader now picks from the board they spun");
  const lead1 = autoPick(swap, after.taken, after.roster[lead], "fantasy");
  const picks = [{
    pickNo: 1, kind: lead1.option.kind, slot: lead1.slot,
    playerId: lead1.option.kind === "player" ? lead1.option.id : null,
    team: lead1.option.kind === "player" ? null : lead1.option.team, season: lead1.option.season,
  }];
  const follower = replayMatch({ code, picks, respins: shared });
  assert(follower.boardKey === swap, "and so does the follower - the board was handed to them as well");
  assert(follower.boards[0].key === swap && follower.boards[0].followKey === swap, "one board, both players");

  // Now the follower re-spins too. The leader has already taken something off that board, so this one is theirs.
  const mine = respinBoard({
    code, kind: "era", pickNo: 2, key: swap, seq: follower.seq, used: follower.used,
    taken: follower.taken, roster: follower.roster[follow], otherRoster: follower.roster[lead],
  });
  assert(mine && mine !== swap, `the follower found a board of their own, got ${mine}`);
  assert(mine.split("|")[0] === swap.split("|")[0], "an era re-spin keeps the team");
  const both = [...shared, { pickNo: 2, kind: "era", by: follow, key: mine }];
  const split = replayMatch({ code, picks, respins: both });
  assert(split.boardKey === mine, "the follower drafts the board they spun");
  assert(split.boards[0].key === swap && split.boards[0].followKey === mine,
    `and only theirs changed: ${JSON.stringify(split.boards[0])}`);
  assert(split.roster[lead][picks[0].slot], "the leader keeps the pick they already made");

  // A re-spin never deals a board the match is going to reach anyway (CLAUDE.md's reroll-pool invariant).
  assert(!opening.seq.slice(1).includes(swap) || opening.used.has(swap), "the new board isn't one still waiting in the sequence");
  assert(swap !== mine, "the two players' re-spins on one board can't land on the same one");

  const left = respinsLeft(both, lead);
  assert(left.team === MATCH_RESPINS.team - 1 && left.era === MATCH_RESPINS.era, `the leader spent one team re-spin, got ${JSON.stringify(left)}`);
  assert(JSON.stringify(respinsLeft(both, follow)) === JSON.stringify({ team: MATCH_RESPINS.team, era: MATCH_RESPINS.era - 1 }),
    "and the follower one era re-spin");
});

await runTest("a steal takes the pick just made, and sends the leader back to the board", async () => {
  const code = "STEAL1";
  const lead = leadOn(0), follow = lead === "host" ? "guest" : "host";
  const opening = replayMatch({ code, picks: [] });
  const key = opening.boardKey;

  // The leader takes the best thing on the board.
  const leadTook = autoPick(key, opening.taken, opening.roster[lead], "fantasy");
  const row = (pickNo, taken, slot, stolenBy = null) => ({
    pickNo, slot, stolenBy, kind: taken.kind,
    playerId: taken.kind === "player" ? taken.id : null,
    team: taken.kind === "player" ? null : taken.team, season: taken.season,
  });
  const honest = [row(1, leadTook.option, leadTook.slot)];
  const afterLead = replayMatch({ code, picks: honest });
  assert(afterLead.roster[lead][leadTook.slot], "the leader has his pick");
  assert(afterLead.turn.side === follow, "and it is the follower's turn");

  // The follower steals it instead of picking.
  const slots = stealableSlots({
    key, taken: afterLead.taken, option: leadTook.option,
    stealerRoster: afterLead.roster[follow], leaderRoster: afterLead.roster[lead], leaderSlot: leadTook.slot,
  });
  assert(slots && slots.length, `the follower can take it, into ${JSON.stringify(slots)}`);
  const theft = [row(1, leadTook.option, slots[0], follow)];
  const stolen = replayMatch({ code, picks: theft });

  assert(stolen.roster[follow][slots[0]], "the stolen pick is on the follower's roster");
  assert(!VERSUS_SLOTS.some((sl) => stolen.roster[lead][sl]), "and off the leader's entirely");
  assert(optionId(stolen.roster[follow][slots[0]]) === optionId(leadTook.option), "it is the same player, not a copy");
  assert(stolen.turn.side === lead, "the leader is back on the clock");
  assert(stolen.boardKey === key, "on the same board he just picked from");
  assert(stolen.pickNo === 2, "using the board's second pick, so the count is still sixteen");
  assert(stolen.taken.has(optionId(leadTook.option)), "and the player is still gone for everyone");

  // The leader takes again; the board moves on normally.
  const again = autoPick(key, stolen.taken, stolen.roster[lead], "fantasy");
  assert(optionId(again.option) !== optionId(leadTook.option), "he can't take back what was taken");
  const done = replayMatch({ code, picks: [...theft, row(2, again.option, again.slot)] });
  assert(done.roster[lead][again.slot] && done.boardIdx === 1, "the board is finished and the match moves on");
  assert(done.turn.side === leadOn(1), "with the next board's leader on the clock");

  assert(stealsLeft(theft, follow) === MATCH_STEALS - 1 && stealsLeft(theft, lead) === MATCH_STEALS,
    "one steal spent, and only by the one who spent it");
});

await runTest("a steal that would leave the leader nothing is refused", async () => {
  // The case the serve-both rule does NOT cover: it guarantees the follower an option after the leader picks,
  // not the leader an option after being robbed. A board one deep at the only position he needs is exactly that.
  const key = ONE_QB;
  const qb = optionsOn(key).find((o) => o.kind === "player" && o.pos === "QB");
  // Everything gone but the quarterback, whom the leader has just taken.
  const taken = new Set(optionsOn(key).map(optionId));
  const leaderRoster = Object.fromEntries(VERSUS_SLOTS.map((sl) => [sl, sl === "QB" ? qb : { kind: "player" }]));
  const stealer = Object.fromEntries(VERSUS_SLOTS.map((sl) => [sl, sl === "QB" ? null : { kind: "player" }]));
  assert(stealableSlots({ key, taken, option: qb, stealerRoster: stealer, leaderRoster, leaderSlot: "QB" }) === null,
    "it would send the leader back to a board with nothing on it for him, so it is refused");

  // With something left he can use, the same steal is fine.
  const spare = optionsOn(key).find((o) => o.kind === "player" && o.pos === "RB");
  const roomy = new Set(taken); roomy.delete(optionId(spare));
  const openLeader = { ...leaderRoster, FLEX1: null };
  assert(stealableSlots({ key, taken: roomy, option: qb, stealerRoster: stealer, leaderRoster: openLeader, leaderSlot: "QB" }),
    "with a running back still on the board for his flex, the steal goes through");

  // And it is refused outright when the stealer has nowhere to put him.
  const noRoom = Object.fromEntries(VERSUS_SLOTS.map((sl) => [sl, { kind: "player" }]));
  assert(stealableSlots({ key, taken: roomy, option: qb, stealerRoster: noRoom, leaderRoster: openLeader, leaderSlot: "QB" }) === null,
    "a full roster can't steal anything");
});

await runTest("the result is the raw numbers, and the same every time", async () => {
  const { state } = playMatch("RESULT1", bestValue);
  const a = matchResult({ code: "RESULT1", format: "fantasy", host: state.roster.host, guest: state.roster.guest });
  const b = matchResult({ code: "RESULT1", format: "fantasy", host: state.roster.host, guest: state.roster.guest });
  assert(JSON.stringify(a) === JSON.stringify(b), "the same two rosters always give the same result");
  assert(a.winner === (a.host.score > a.guest.score ? "host" : a.host.score < a.guest.score ? "guest" : null),
    `the higher score won: ${JSON.stringify({ h: a.host.score, g: a.guest.score, winner: a.winner })}`);
  assert(Math.abs(a.host.score - (a.host.offense + a.host.kicker - a.host.against)) < 0.11,
    `the parts add up to the score: ${JSON.stringify(a.host)}`);

  // Their defense is subtracted from your score - the thing the owner asked for.
  const stronger = { ...state.roster.guest, DST: { ...state.roster.guest.DST, rating: 120 } };
  const weaker = { ...state.roster.guest, DST: { ...state.roster.guest.DST, rating: 40 } };
  const vsStrong = matchResult({ code: "RESULT1", format: "fantasy", host: state.roster.host, guest: stronger });
  const vsWeak = matchResult({ code: "RESULT1", format: "fantasy", host: state.roster.host, guest: weaker });
  assert(vsStrong.host.score < vsWeak.host.score, "a better defense lowers the other roster's score");
  assert(Math.abs((vsWeak.host.score - vsStrong.host.score) - 80 * SLOT_WORTH) < 0.15,
    `by exactly what it is worth: ${(vsWeak.host.score - vsStrong.host.score).toFixed(2)} for 80 rating points`);
  assert(vsStrong.host.offense === vsWeak.host.offense, "and never touches the offense itself");
});

await runTest("the football final dresses the margin and never contradicts it", async () => {
  let last = -1;
  for (const gap of [0.2, 1, 2, 4, 6, 9, 12, 16, 20, 30]) {
    const f = footballFinal(gap, "SCORE1");
    assert(f.winner > f.loser, `a ${gap}-point win is a win on the scoreboard too: ${f.winner}-${f.loser}`);
    assert(f.winner - f.loser >= last, `a bigger gap is never a smaller margin: ${gap} gave ${f.winner - f.loser}, after ${last}`);
    last = f.winner - f.loser;
    assert(!(f.loser === 0 && f.winner < 3), `no 1-0 finals, got ${f.winner}-${f.loser}`);
  }
  assert(footballFinal(0, "SCORE1").winner === footballFinal(0, "SCORE1").loser, "a tie shows as a tie");
  // Seeded by the match, so a reload and the other player's screen read the same final.
  assert(JSON.stringify(footballFinal(7, "ABC123")) === JSON.stringify(footballFinal(7, "ABC123")), "stable for a match");
  const codes = new Set(["A1", "B2", "C3", "D4", "E5", "F6"].map((c) => footballFinal(7, c).loser));
  assert(codes.size > 1, "and different matches don't all end 20-13");
});

await runTest("an offense means the same thing it means everywhere else in the game", async () => {
  const { state } = playMatch("OFFENSE1", bestValue);
  const six = Object.fromEntries(SLOTS.map((s) => [s, state.roster.host[s]]));
  // The same weighted mean single player grades a team score with, written out here from game-logic's own
  // pieces - so if either side of it ever moves, this fails rather than 1v1 quietly meaning something else.
  let total = 0, weight = 0;
  for (const slot of SLOTS) {
    const w = slot === "QB" ? QB_WEIGHT : 1;
    total += effectiveRating(slot, six[slot], "fantasy") * w;
    weight += w;
  }
  const mine = offenseScore(six, "fantasy");
  assert(Math.abs(mine - total / weight) < 1e-9, `an offense is that mean exactly, got ${mine} against ${total / weight}`);
  assert(mine > 40 && mine < 131, `and sits on the players' scale, got ${mine.toFixed(1)}`);
  assert(offenseScore({ ...six, QB: null }, "fantasy") === null, "an unfinished roster has no score at all");
  // The defense and the kicker are NOT in it: an offense is six players, here as everywhere.
  assert(offenseScore(state.roster.host, "fantasy") === mine, "the defense and kicker don't touch the offense");
});

console.log("test-versus-boards.mjs done");
