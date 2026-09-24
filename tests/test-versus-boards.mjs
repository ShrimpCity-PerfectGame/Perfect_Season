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
  DST_WEIGHT, DST_WORTH, SLOT_WEIGHT_TOTAL, sideScore,
  optionsOn, unitsOn, optionId, optionFits, optionValue, turnAt, firstPickerOn,
  boardServesBoth, replayMatch, autoPick, openSlots, matchResult, footballFinal, rosterScore, SCORED_SLOTS,
  respinBoard, respinsLeft, MATCH_RESPINS, firstPickerOn as leadOn,
  stealableSlots, stealsLeft, MATCH_STEALS, canDoubleDip, dipsLeft, MATCH_DIPS, MATCH_BOARDS as BOARDS_N,
} from "../versus-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
const players = read("data/players.json");
initGameData(players.players, players.opponents);
initVersusData(read("data/versus-pool.json"));

const countPos = (key, pos) => (BOARDS[key] || []).filter((p) => p.pos === pos).length;
const ONE_QB = Object.keys(BOARDS).find((k) => countPos(k, "QB") === 1);

await runTest("the snake: sixteen picks, eight each, the lead alternating by board", async () => {
  for (const code of [undefined, "SNAKE1", "SNAKE2", "ZZZZ99", "AB12CD"]) {
    const mine = { host: 0, guest: 0 };
    const leads = [];
    for (let pickNo = 1; pickNo <= MATCH_PICKS; pickNo++) {
      const t = turnAt(pickNo, code);
      mine[t.side]++;
      if (t.first) leads.push(t.side);
      assert(t.boardIdx === Math.floor((pickNo - 1) / 2), `pick ${pickNo} is on board ${t.boardIdx}`);
      assert(t.side === (t.first ? firstPickerOn(t.boardIdx, code) : firstPickerOn(t.boardIdx, code) === "host" ? "guest" : "host"),
        `pick ${pickNo}: ${t.side} ${t.first ? "leads" : "follows"} board ${t.boardIdx}`);
    }
    assert(mine.host === 8 && mine.guest === 8, `eight picks each on ${code}, got ${JSON.stringify(mine)}`);
    const alternates = leads.every((s, i) => i === 0 || s !== leads[i - 1]);
    assert(alternates && leads.length === 8, `the lead alternates every board on ${code}, got ${leads.join(",")}`);
  }
});

// Whoever leads board 0 leads 2, 4 and 6 as well, and leading is worth more the earlier it comes - measured,
// 1.97 points of final score on board 0 against 0.57 on board 7. That is a real edge, and it used to belong to
// the host every single time, because create_match makes the caller the host: anyone who always sent the invite
// rather than clicking one won 53-54% of matches for nothing. It is a coin flip on the code now, so no player
// can choose the good seat.
await runTest("who leads board 0 is a coin flip on the code, not the seat", async () => {
  const lead = (code) => firstPickerOn(0, code);
  assert(lead("SEATAA") === lead("SEATAA"), "the same code always deals the same seat");

  let host = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) if (lead(`SEAT${i}`) === "host") host++;
  const pct = (100 * host) / N;
  assert(pct > 46 && pct < 54, `both sides lead board 0 about half the time, got ${pct.toFixed(1)}% host`);

  // And the whole match follows from it: the board-0 leader leads every even board, the other every odd one.
  for (const code of ["SEATX1", "SEATX2", "SEATX3"]) {
    const first = lead(code);
    const other = first === "host" ? "guest" : "host";
    for (let b = 0; b < MATCH_BOARDS; b++) {
      assert(firstPickerOn(b, code) === (b % 2 === 0 ? first : other), `board ${b} of ${code}`);
    }
  }
});

await runTest("a board offers players, a defense per year and a kicker per year", async () => {
  for (const key of ["BAL|1", "IND|0", "SEA|2"]) {
    const [, w] = key.split("|");
    const [from, to] = WINDOWS[Number(w)];
    const { defenses, kickers } = unitsOn(key);
    assert(defenses.length === to - from + 1, `${key}: one defense per year of ${from}-${to}, got ${defenses.length}`);
    assert(defenses.every((d, i) => d.season === from + i), `${key}: in order, got ${defenses.map((d) => d.season).join(",")}`);
    // A kicker appears once, in his best season of the era - the rule the player boards follow. A defense is
    // not a person and keeps a row per year, because two years of one team are two different defenses.
    assert(kickers.length >= 1 && kickers.length <= to - from + 1, `${key}: at least one kicker, at most one a year, got ${kickers.length}`);
    assert(new Set(kickers.map((k) => k.name)).size === kickers.length, `${key}: no kicker is offered twice, got ${kickers.map((k) => `${k.season} ${k.name}`).join(", ")}`);
    for (const k of kickers) {
      const allHis = [];
      for (let s = from; s <= to; s++) {
        const row = optionsOn(key).find((o) => o.kind === "k" && o.season === s && o.name === k.name);
        if (row) allHis.push(row);
      }
      assert(allHis.every((o) => o.rating <= k.rating), `${key}: ${k.name} is offered in his best year of the era`);
    }
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
  // VERSUS.md 6: SLOT_WORTH is one ordinary slot's share of the weighted mean, which is 1/(QB_WEIGHT + 6) =
  // 1/7.25 now the kicker is one of the seven scored picks. It read 1/6.25 here, from before that.
  //
  // Pinned to the number, not to its own formula. Checking optionValue against (rating - AVERAGE) * SLOT_WORTH
  // passes for ANY value of SLOT_WORTH, so it could never have caught the constant drifting - which is how the
  // figures in VERSUS.md stayed a version behind. The cross-kind assertions below are the real ones.
  assert(Math.abs(SLOT_WORTH - 1 / 7.25) < 1e-9, `SLOT_WORTH is 1/7.25, got 1/${(1 / SLOT_WORTH).toFixed(4)}`);
  const board = optionsOn("BAL|1");
  const dst = board.find((o) => o.kind === "dst");
  const kick = board.find((o) => o.kind === "k");
  // A kicker is one ordinary slot, and is scored inside your own roster.
  assert(Math.abs(optionValue(kick, "K", "fantasy") - (kick.rating - AVERAGE_RATING) / 7.25) < 1e-9,
    "a kicker is worth what it is above average, at one slot's weight");
  // A defense is DST_WEIGHT of them, because a board carries exactly one of them and the pick has no choice
  // in it - see the constant. This used to assert one slot, which is the thing that was changed.
  const asDefense = optionValue(dst, "DST", "fantasy");
  assert(Math.abs(asDefense - (dst.rating - AVERAGE_RATING) * DST_WEIGHT / 7.25) < 1e-9,
    `a defense is worth what it is above average, at DST_WEIGHT: ${asDefense.toFixed(3)}`);
  const rb = board.find((o) => o.kind === "player" && o.pos === "RB");
  const asBack = optionValue(rb, "RB", "fantasy");
  const sameEdge = { ...kick, rating: rb.rating };
  assert(Math.abs(optionValue(sameEdge, "K", "fantasy") - asBack) < 1e-9,
    `equal ratings are equal points for a kicker: back ${asBack.toFixed(3)} vs kicker ${optionValue(sameEdge, "K", "fantasy").toFixed(3)}`);
  // A quarterback carries the roster's extra weight, so the same distance from average counts for QB_WEIGHT
  // times as much - in both directions. (A bad quarterback hurts more than a bad defense, which is the point.)
  const qb = board.find((o) => o.kind === "player" && o.pos === "QB");
  const qbRating = effectiveRating("QB", qb, "fantasy");
  // Against a KICKER, which is the one ordinary slot among the two added kinds - the defense carries
  // DST_WEIGHT now, so it is no longer the yardstick for "one slot".
  const asKickerWouldBe = optionValue({ ...kick, rating: qbRating }, "K", "fantasy");
  assert(Math.abs(optionValue(qb, "QB", "fantasy") / asKickerWouldBe - QB_WEIGHT) < 1e-9,
    `a quarterback counts ${QB_WEIGHT}x, got ${(optionValue(qb, "QB", "fantasy") / asKickerWouldBe).toFixed(4)}`);
  // ...and the defense counts DST_WEIGHT, measured the same way.
  const asDefenseWouldBe = optionValue({ ...dst, rating: qbRating }, "DST", "fantasy");
  assert(Math.abs(asDefenseWouldBe / asKickerWouldBe - DST_WEIGHT) < 1e-9,
    `a defense counts ${DST_WEIGHT}x one slot, got ${(asDefenseWouldBe / asKickerWouldBe).toFixed(4)}`);
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

await runTest("a steal moves a player between rosters and costs the thief their turn", async () => {
  const code = "STEAL1";
  const lead = leadOn(0), follow = lead === "host" ? "guest" : "host";
  const opening = replayMatch({ code, picks: [] });
  const key = opening.boardKey;

  // The leader takes the best thing on the board.
  const leadTook = autoPick(key, opening.taken, opening.roster[lead], "fantasy");
  const row = (pickNo, taken, slot) => ({
    pickNo, slot, kind: taken.kind,
    playerId: taken.kind === "player" ? taken.id : null,
    team: taken.kind === "player" ? null : taken.team, season: taken.season,
  });
  const honest = [row(1, leadTook.option, leadTook.slot)];
  const afterLead = replayMatch({ code, picks: honest });
  assert(afterLead.roster[lead][leadTook.slot], "the leader has his pick");
  assert(afterLead.turn.side === follow, "and it is the follower's turn");

  // The follower steals it instead of picking. A steal is a record on the match now, not an edit to the pick:
  // `at` is the turn it cost, which is the turn the follower was about to use.
  const can = stealableSlots({ option: leadTook.option, stealerRoster: afterLead.roster[follow] });
  assert(can.slots && can.slots.length, `the follower can take it, into ${JSON.stringify(can)}`);
  const theft = { at: 2, by: follow, pickNo: 1, slot: can.slots[0] };
  const stolen = replayMatch({ code, picks: honest, steals: [theft] });

  assert(stolen.roster[follow][can.slots[0]], "the stolen pick is on the follower's roster");
  assert(!VERSUS_SLOTS.some((sl) => stolen.roster[lead][sl]), "and off the leader's entirely");
  assert(optionId(stolen.roster[follow][can.slots[0]]) === optionId(leadTook.option), "it is the same player, not a copy");
  assert(stolen.turn.side === lead, "the leader is back on the clock");
  assert(stolen.boardKey === key, "on the same board he just picked from");
  assert(stolen.pickNo === 2, "using the board's second pick, so the count is still sixteen");
  assert(stolen.taken.has(optionId(leadTook.option)), "and the player is still gone for everyone");

  // The leader takes again; the board moves on normally.
  const again = autoPick(key, stolen.taken, stolen.roster[lead], "fantasy");
  assert(optionId(again.option) !== optionId(leadTook.option), "he can't take back what was taken");
  const done = replayMatch({ code, picks: [...honest, row(2, again.option, again.slot, lead)], steals: [theft] });
  assert(done.roster[lead][again.slot] && done.boardIdx === 1, "the board is finished and the match moves on");
  assert(done.turn.side === leadOn(1), "with the next board's leader on the clock");

  assert(stealsLeft([theft], follow) === MATCH_STEALS - 1 && stealsLeft([theft], lead) === MATCH_STEALS,
    "one steal spent, and only by the one who spent it");
});

await runTest("a full roster cannot steal anybody", async () => {
  // The only way a steal is refused on the target now. The old rule also had `would_strand`, because it sent the
  // victim back to the SAME board and that board might hold nothing they could use; a steal takes any player
  // now and the victim picks from the board in front of them with one MORE slot open than before, so there is
  // no board left to strand anybody on.
  const qb = optionsOn(ONE_QB).find((o) => o.kind === "player" && o.pos === "QB");
  const full = Object.fromEntries(VERSUS_SLOTS.map((sl) => [sl, { kind: "player" }]));
  assert(stealableSlots({ option: qb, stealerRoster: full }).reason === "bad_slot",
    "nowhere to put him, and it says so");
  const room = { ...full, QB: null };
  assert(stealableSlots({ option: qb, stealerRoster: room }).slots?.includes("QB"), "with the slot open, he fits it");
});

// Plays a whole match with powerups in it, and returns the state at the end. `events` is called before each
// pick and may return a dip to declare, so a test can drive one without hand-writing sixteen rows.
function playWithDips(code, dipAt, format = "fantasy") {
  const picks = [], dips = [];
  for (let n = 0; n < 40; n++) {
    const state = replayMatch({ code, picks, dips });
    if (state.done) return { picks, dips, state };
    const { side, boardIdx } = state.turn;
    if (dipAt && dipAt.boardIdx === boardIdx && dipAt.by === side && !dips.length) {
      const other = side === "host" ? "guest" : "host";
      const picksAfter = state.boards[boardIdx].order.slice(state.boards[boardIdx].order.indexOf(side) + 1).some((x) => x !== side);
      if (canDoubleDip({
        key: state.boardKey, taken: state.taken, boardIdx,
        dipperRoster: state.roster[side], otherRoster: state.roster[other], picksAfter,
      })) {
        dips.push({ boardIdx, by: side });
        continue; // replay again, now with the extra turn in the order
      }
    }
    const got = autoPick(state.boardKey, state.taken, state.roster[side], format);
    assert(got, `pick ${state.pickNo} (${side}, board ${boardIdx}): something was available`);
    picks.push({
      pickNo: state.pickNo, kind: got.option.kind, slot: got.slot,
      playerId: got.option.kind === "player" ? got.option.id : null,
      team: got.option.kind === "player" ? null : got.option.team, season: got.option.season,
    });
  }
  throw new Error("a match that never finished");
}

await runTest("a double dip takes two off one board and gives up the next", async () => {
  for (const by of ["host", "guest"]) {
    for (const boardIdx of [0, 3]) {
      const code = `DIP${by}${boardIdx}`;
      const { picks, dips, state } = playWithDips(code, { boardIdx, by });
      assert(dips.length === 1, `${code}: the dip was allowed`);
      const other = by === "host" ? "guest" : "host";

      // Two picks on the board, none on the next - so still eight each, and still sixteen in all.
      const mine = (b) => state.boards[b].order.filter((x) => x === by).length;
      assert(mine(boardIdx) === 2, `${code}: two of theirs on board ${boardIdx}, got ${mine(boardIdx)}`);
      assert(mine(boardIdx + 1) === 0, `${code}: none on the next, got ${mine(boardIdx + 1)}`);
      assert(state.boards[boardIdx + 1].order.length === 1 && state.boards[boardIdx + 1].order[0] === other,
        `${code}: the other player has that board to themselves`);
      assert(picks.length === 16, `${code}: sixteen picks all the same, got ${picks.length}`);

      // And the rosters still come out full and legal, which is the whole reason this shape works.
      for (const side of ["host", "guest"]) {
        for (const slot of VERSUS_SLOTS) assert(state.roster[side][slot], `${code}: ${side} filled ${slot}`);
      }
      const ids = ["host", "guest"].flatMap((side) => VERSUS_SLOTS.map((sl) => optionId(state.roster[side][sl])));
      assert(new Set(ids).size === 16, `${code}: nothing was drafted twice`);
      assert(dipsLeft(dips, by) === MATCH_DIPS - 1 && dipsLeft(dips, other) === MATCH_DIPS, `${code}: one dip spent, by one player`);
    }
  }
});

await runTest("a double dip is refused when it would cost the other player their pick, or can't be paid for", async () => {
  const opening = replayMatch({ code: "DIPNO", picks: [], dips: [] });
  const key = opening.boardKey;
  const lead = leadOn(0), follow = lead === "host" ? "guest" : "host";
  const full = Object.fromEntries(VERSUS_SLOTS.map((sl) => [sl, { kind: "player" }]));
  const oneOpen = { ...full, QB: null };
  const bare = (slots) => Object.fromEntries(VERSUS_SLOTS.map((sl) => [sl, slots.includes(sl) ? null : { kind: "player" }]));

  assert(canDoubleDip({ key, taken: opening.taken, boardIdx: 0, dipperRoster: opening.roster[lead], otherRoster: opening.roster[follow], picksAfter: true }),
    "an empty roster on a full board can dip");
  assert(!canDoubleDip({ key, taken: opening.taken, boardIdx: BOARDS_N - 1, dipperRoster: opening.roster[lead], otherRoster: opening.roster[follow], picksAfter: true }),
    "but never on the last board - there is no next pick to give up");
  assert(!canDoubleDip({ key, taken: opening.taken, boardIdx: 0, dipperRoster: oneOpen, otherRoster: opening.roster[follow], picksAfter: true }),
    "nor with one slot open - two picks need two slots");

  // Two quarterbacks are two options and one slot: a board can hold two things you could take and still not
  // hold two you can USE.
  const qbOnly = new Set(optionsOn(ONE_QB).map(optionId));
  const twoQbBoard = Object.keys(BOARDS).find((k) => (BOARDS[k] || []).filter((p) => p.pos === "QB").length >= 2);
  const onlyQbsLeft = new Set(optionsOn(twoQbBoard).filter((o) => !(o.kind === "player" && o.pos === "QB")).map(optionId));
  assert(!canDoubleDip({ key: twoQbBoard, taken: onlyQbsLeft, boardIdx: 0, dipperRoster: bare(["QB", "RB"]), otherRoster: full, picksAfter: false }),
    "two quarterbacks fill one slot between them, so that is not a dip");
  assert(qbOnly.size > 0, "(the one-QB board is still the one-QB board)");

  // The stranding case: the other player still has to be able to pick after two are gone.
  const tight = new Set(optionsOn(ONE_QB).map(optionId));
  const { defenses, kickers } = unitsOn(ONE_QB);
  for (const keep of [defenses[0], defenses[1], kickers[0]]) tight.delete(optionId(keep));
  assert(!canDoubleDip({ key: ONE_QB, taken: tight, boardIdx: 0, dipperRoster: bare(["DST", "K"]), otherRoster: bare(["DST"]), picksAfter: true }),
    "taking the last two things they could use is refused");
  assert(canDoubleDip({ key: ONE_QB, taken: tight, boardIdx: 0, dipperRoster: bare(["DST", "K"]), otherRoster: bare(["DST"]), picksAfter: false }),
    "...but the same dip is fine when nobody picks after them");
});

await runTest("the result is the raw numbers, and the same every time", async () => {
  const { state } = playMatch("RESULT1", bestValue);
  const a = matchResult({ code: "RESULT1", format: "fantasy", host: state.roster.host, guest: state.roster.guest });
  const b = matchResult({ code: "RESULT1", format: "fantasy", host: state.roster.host, guest: state.roster.guest });
  assert(JSON.stringify(a) === JSON.stringify(b), "the same two rosters always give the same result");
  assert(a.winner === (a.host.score > a.guest.score ? "host" : a.host.score < a.guest.score ? "guest" : null),
    `the higher score won: ${JSON.stringify({ h: a.host.score, g: a.guest.score, winner: a.winner })}`);
  assert(Math.abs(a.host.score - (a.host.roster - a.host.against)) < 0.11,
    `the two parts add up to the score: ${JSON.stringify(a.host)}`);

  // Their defense is subtracted from your score - the thing the owner asked for.
  const stronger = { ...state.roster.guest, DST: { ...state.roster.guest.DST, rating: 120 } };
  const weaker = { ...state.roster.guest, DST: { ...state.roster.guest.DST, rating: 40 } };
  const vsStrong = matchResult({ code: "RESULT1", format: "fantasy", host: state.roster.host, guest: stronger });
  const vsWeak = matchResult({ code: "RESULT1", format: "fantasy", host: state.roster.host, guest: weaker });
  assert(vsStrong.host.score < vsWeak.host.score, "a better defense lowers the other roster's score");
  assert(Math.abs((vsWeak.host.score - vsStrong.host.score) - 80 * DST_WORTH) < 0.15,
    `by exactly what it is worth: ${(vsWeak.host.score - vsStrong.host.score).toFixed(2)} for 80 rating points at DST_WEIGHT ${DST_WEIGHT}`);
  assert(vsStrong.host.roster === vsWeak.host.roster, "and never touches your own seven picks");
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

await runTest("a roster's score is its seven picks, and the kicker is one of them", async () => {
  const { state } = playMatch("OFFENSE1", bestValue);
  const roster = state.roster.host;
  // The same weighted mean single player grades with, plus the kicker as one more ordinary slot - written out
  // here from game-logic's own pieces, so if either side moves this fails rather than quietly meaning
  // something else.
  let total = 0, weight = 0;
  for (const slot of SCORED_SLOTS) {
    const w = slot === "QB" ? QB_WEIGHT : 1;
    total += (slot === "K" ? roster[slot].rating : effectiveRating(slot, roster[slot], "fantasy")) * w;
    weight += w;
  }
  const mine = rosterScore(roster, "fantasy");
  assert(weight === QB_WEIGHT + 6, `seven slots carry the weight, got ${weight}`);
  assert(Math.abs(mine - total / weight) < 1e-9, `the score is that mean exactly, got ${mine} against ${total / weight}`);
  assert(mine > 40 && mine < 131, `and sits on the players' scale, got ${mine.toFixed(1)}`);
  assert(rosterScore({ ...roster, QB: null }, "fantasy") === null, "an unfinished roster has no score at all");

  // The kicker is IN it, which is the point: a weak kicker lowers the score the way a weak tight end does,
  // rather than showing up as a line of negative points for having drafted one at all.
  const weak = { ...roster, K: { ...roster.K, rating: 30 } };
  const strong = { ...roster, K: { ...roster.K, rating: 110 } };
  assert(rosterScore(weak, "fantasy") < mine && rosterScore(strong, "fantasy") > mine, "the kicker moves it both ways");
  assert(rosterScore(weak, "fantasy") > 0, "and a bad one never makes a score negative");
  // The defense is not in it - it is the one pick that acts on the other roster.
  assert(rosterScore({ ...roster, DST: { ...roster.DST, rating: 1 } }, "fantasy") === mine, "the defense doesn't touch your own score");
});

await runTest("a defense is worth more than one ordinary slot, and the two places that say so agree", async () => {
  // Found by playing a real duel: a finished match showed the two defenses worth -0.1 and -0.9, which is
  // nothing against a median margin near 4.7. The cause is structural rather than arithmetic - a board carries
  // exactly ONE defense, so the pick has no choice in it, while a player slot picks the best of about twenty.
  // Measured over the pool: the best player on a board sits 62 rating points above the player median, the best
  // defense only 14 above the defense median. DST_WEIGHT is the correction, and the numbers behind the value
  // chosen are on the constant.
  assert(DST_WEIGHT > 1, `a defense carries more than one slot's weight: ${DST_WEIGHT}`);
  assert(Math.abs(DST_WORTH - DST_WEIGHT / SLOT_WEIGHT_TOTAL) < 1e-12, "DST_WORTH is the weight over the total");

  // The two places a defense is valued have to agree, or the clock's auto-pick ranks it by a number the match
  // is not scored by - which is the bug capFlex has on its sibling and the reason to check it here.
  const dst = optionsOn("KC|3").find((o) => o.kind === "dst");
  assert(dst, "a board has a defense");
  const ranked = optionValue(dst, "DST", "fantasy");
  // Real options, because rosterScore reads a player's own fields to rate a flex.
  const pool = optionsOn("KC|3");
  const pick = (slot) => pool.find((o) => optionFits(o, slot));
  const mine = Object.fromEntries(VERSUS_SLOTS.map((s) => [s, pick(s)]));
  assert(VERSUS_SLOTS.every((s) => mine[s]), "a full roster off one board, for the arithmetic");
  const theirs = { ...mine, DST: dst };
  const scored = sideScore(mine, theirs, "fantasy").against;
  assert(Math.abs(ranked - scored) < 0.06, `what a defense is worth when ranked (${ranked.toFixed(3)}) is what it takes off a score (${scored.toFixed(3)})`);

  // A kicker is still one ordinary slot - it is scored inside your own roster, not against theirs.
  const k = optionsOn("KC|3").find((o) => o.kind === "k");
  const kv = optionValue(k, "K", "fantasy");
  assert(Math.abs(kv - (k.rating - AVERAGE_RATING) * SLOT_WORTH) < 1e-9, "a kicker is worth one slot, unchanged");
});

console.log("test-versus-boards.mjs done");
