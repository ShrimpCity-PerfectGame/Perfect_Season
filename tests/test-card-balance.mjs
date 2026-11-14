// Plays thousands of card battles and PRINTS what the rules do, then holds the game to a few promises.
// Offense against offense (CARDS.md 5): a deck of thirty, a hand of twelve, six cards in an order you choose,
// six rounds each on a category. This file is the only thing that knows whether the numbers in card-logic.mjs
// make a GAME: that a new player wins sometimes, that a great collection can still lose, and - the one that
// matters most - that what you do with the hand beats just fielding your six best.
//
//   node tests/test-card-balance.mjs [runs] [seed]
//
// THREE COLLECTIONS: a starter deck (thirty Base cards rated under 60), sixty random cards, and the sixty best.
// TWO PLAYERS: one fields the six highest ratings in rating order; one picks the six and the order that the
// numbers on screen say are best (it cannot see the category order or the luck - nobody can).
import { readFileSync } from "node:fs";
import * as C from "../card-logic.mjs";
import { mulberry32 } from "../game-logic.mjs";

const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
C.initCardData(read("data/cards.json"));
const RUNS = Number(process.argv[2]) || 400;
const SEED = Number(process.argv[3]) || 20261114;
const all = [...C.CARDS.values()].sort((a, b) => a.id - b.id);
let fails = 0;
const hold = (ok, what) => { console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`); if (!ok) fails++; };

// ---- collections ----
const entries = (cards) => cards.map((c) => ({ id: c.id, finish: "base" }));
function starter(rand) { return C.starterFill([], rand).map((g) => ({ id: g.id, finish: g.finish })); }
function randomSixty(rand) {
  // sixty different men, drawn until a deck can be made of them
  for (;;) {
    const men = new Set(), out = [];
    while (out.length < 60) { const c = all[Math.floor(rand() * all.length)]; if (!men.has(c.pid)) { men.add(c.pid); out.push(c); } }
    if (C.bestDeck(entries(out))) return entries(out);
  }
}
function bestSixty() {
  const men = new Set(), out = [];
  for (const c of [...all].sort((a, b) => b.rating - a.rating || a.id - b.id)) {
    const need = { QB: 10, RB: 20, WR: 20, TE: 10 }[c.pos];
    if (men.has(c.pid) || out.filter((x) => x.pos === c.pos).length >= need) continue;
    men.add(c.pid); out.push(c);
    if (out.length === 60) break;
  }
  return entries(out);
}

// ---- players ----
const dull = (hand) => C.bestTeam(hand);
// What a card is worth in an average round, before luck: its base averaged over the six categories.
const avgBase = (e) => C.CATEGORY_IDS.reduce((s, cat) => s + C.roundBase(e, cat), 0) / 6;
const chance = (diff) => 1 / (1 + Math.exp(-diff / 9)); // roughly how often a lead of `diff` holds up
// Every legal six out of the hand, scored by average base plus synergy; then the best of the 720 orders against
// the CPU's six, each of whose cards is known and whose order is known.
function sharp(hand, foe) {
  const by = (pos) => hand.filter((e) => C.CARDS.get(e.id).pos === pos);
  const [qbs, rbs, wrs, tes] = ["QB", "RB", "WR", "TE"].map(by);
  let bestSix = null, bestWorth = -Infinity;
  const others = [...rbs, ...wrs, ...tes];
  for (const qb of qbs) for (let a = 0; a < others.length; a++) for (let b = a + 1; b < others.length; b++) for (let c = b + 1; c < others.length; c++) for (let d = c + 1; d < others.length; d++) for (let e = d + 1; e < others.length; e++) {
    const team = [qb, others[a], others[b], others[c], others[d], others[e]];
    if (C.teamProblem(team, null)) continue;
    const syn = C.teamSynergies(team);
    const worth = team.reduce((s, x, i) => s + avgBase(x) + syn[i].reduce((n, m) => n + m.pts, 0), 0);
    if (worth > bestWorth) { bestWorth = worth; bestSix = team; }
  }
  if (!bestSix) return dull(hand);
  const syn = C.teamSynergies(bestSix);
  const mine = bestSix.map((e, i) => avgBase(e) + syn[i].reduce((n, m) => n + m.pts, 0));
  const fsyn = C.teamSynergies(foe);
  const theirs = foe.map((e, i) => avgBase(e) + fsyn[i].reduce((n, m) => n + m.pts, 0));
  let bestOrder = null, bestWins = -Infinity;
  const idx = [0, 1, 2, 3, 4, 5];
  const walk = (k) => {
    if (k === 6) {
      const wins = idx.reduce((s, card, spot) => s + chance(mine[card] - theirs[spot]), 0);
      if (wins > bestWins) { bestWins = wins; bestOrder = idx.slice(); }
      return;
    }
    for (let i = k; i < 6; i++) { [idx[k], idx[i]] = [idx[i], idx[k]]; walk(k + 1); [idx[k], idx[i]] = [idx[i], idx[k]]; }
  };
  walk(0);
  return bestOrder.map((i) => bestSix[i]);
}

// ---- a run up the ladder ----
function climb(deck, pick, rand, seed) {
  let wins = 0, sixes = 0, changed = 0, upsets = 0, battles = 0;
  for (; wins < 60; ) {
    const foe = C.ladderFoe(seed, wins);
    const hand = C.dealHand(deck, rand);
    const team = pick(hand, foe);
    const plain = dull(hand);
    battles++;
    if (team.map((e) => e.id).sort().join() !== plain.map((e) => e.id).sort().join()) changed++;
    const result = C.scoreBattle(team, foe, rand, null, C.ladderEdge(wins));
    // a round a lower-rated card took off a higher-rated one
    upsets += result.rounds.filter((r) => r.win === "me" && r.mine.rating < r.foe.rating).length;
    sixes += result.wins;
    if (!result.win) break;
    wins++;
  }
  return { wins, changed, battles, upsets, rounds: sixes };
}
function measure(name, makeDeck) {
  const out = {};
  for (const [who, pick] of [["dull", (hand) => dull(hand)], ["sharp", sharp]]) {
    const rand = mulberry32(SEED);
    let total = 0, zero = 0, long = 0, changed = 0, battles = 0, upsets = 0;
    const lengths = [];
    for (let i = 0; i < RUNS; i++) {
      const collection = makeDeck(mulberry32(SEED + 1000 + (i % 50)));
      const deck = C.bestDeck(collection);
      const r = climb(deck, pick, rand, `bal-${SEED}-${i}`);
      total += r.wins; lengths.push(r.wins); if (r.wins === 0) zero++; if (r.wins >= 40) long++;
      changed += r.changed; battles += r.battles; upsets += r.upsets;
    }
    out[who] = { avg: total / RUNS, zero: zero / RUNS, long, changed: changed / battles, upsets: upsets / battles, max: Math.max(...lengths) };
  }
  console.log(`\n${name}`);
  for (const who of ["dull", "sharp"]) {
    const m = out[who];
    console.log(`  ${who.padEnd(5)} wins a run ${m.avg.toFixed(2)}   no win at all ${(100 * m.zero).toFixed(0)}%   longest ${m.max}   upset rounds a battle ${m.upsets.toFixed(2)}${who === "sharp" ? `   picks a different six ${(100 * m.changed).toFixed(0)}%` : ""}`);
  }
  return out;
}

console.log(`card balance: ${RUNS} runs a collection, seed ${SEED}`);
const s = measure("A starter deck (thirty Base cards rated under 60)", starter);
const r = measure("Sixty random cards", randomSixty);
const b = measure("The sixty best cards in the game", () => bestSixty());

// ---- how much is luck ----
// The same two teams, played a thousand times: how often does the side that is better on paper lose?
{
  const rand = mulberry32(SEED + 7);
  let flips = 0, games = 0;
  for (let i = 0; i < 300; i++) {
    const deck = C.bestDeck(randomSixty(mulberry32(SEED + 2000 + i)));
    const hand = C.dealHand(deck, rand);
    // an even match: a CPU team built at the rating this hand's best six average
    const even = dull(hand).reduce((sum, e) => sum + C.CARDS.get(e.id).rating, 0) / 6;
    const foe = C.buildTeam(rand, even);
    const team = sharp(hand, foe);
    let w = 0;
    for (let k = 0; k < 20; k++) if (C.scoreBattle(team, foe, rand).win) w++;
    games += 20; flips += Math.min(w, 20 - w);
  }
  var luck = flips / games;
  console.log(`\nAn even match played twenty times: the less likely result comes up ${(100 * luck).toFixed(0)}% of the time.`);
}

console.log("\nWhat the game is held to:");
hold(s.dull.avg >= 0.8 && s.dull.avg <= 3, `a starter deck wins ${s.dull.avg.toFixed(2)} battles a run (0.8 to 3)`);
hold(s.dull.zero <= 0.4, `...and loses its very first battle ${(100 * s.dull.zero).toFixed(0)}% of the time (at most 40%)`);
hold(r.sharp.avg >= 4 && r.sharp.avg <= 9, `sixty random cards win ${r.sharp.avg.toFixed(2)} a run (4 to 9)`);
hold(b.sharp.avg >= 8 && b.sharp.avg <= 16, `the sixty best win ${b.sharp.avg.toFixed(2)} a run (8 to 16)`);
hold(b.sharp.long === 0 && b.dull.long === 0, "no run reaches forty wins");
hold(r.sharp.avg - r.dull.avg >= 0.3, `choosing and ordering the six is worth ${(r.sharp.avg - r.dull.avg).toFixed(2)} wins a run over the six best in rating order (at least 0.3)`);
hold(r.sharp.changed >= 0.25, `the sharp player fields a different six ${(100 * r.sharp.changed).toFixed(0)}% of the time (at least 25%)`);
hold(r.sharp.upsets >= 0.3, `a lower-rated card takes ${r.sharp.upsets.toFixed(2)} rounds a battle off a higher-rated one (at least 0.3)`);
hold(luck >= 0.08 && luck <= 0.35, `luck turns ${(100 * luck).toFixed(0)}% of rematches (8% to 35%)`);

console.log(fails ? `\n${fails} FAILED` : "\ncard balance: every promise held");
process.exit(fails ? 1 : 0);
