// Plays thousands of card battles and PRINTS what the rules do, then holds the game to a few promises.
// Offense against offense (CARDS.md 5): a deck of thirty, a hand of twelve, six rounds - one for each spot of the
// lineup - played one card at a time, each on a category somebody CALLED before the card went down (v2.31.0).
// This file is the only thing that knows whether the numbers in card-logic.mjs make a GAME: that a new player
// wins sometimes, that a great collection can still lose, and - the one that matters most - that what you do
// with the hand beats not thinking about it.
//
//   node tests/test-card-balance.mjs [runs] [seed]
//
// THREE COLLECTIONS: a starter deck (thirty Base cards rated under 60), sixty random cards, and the sixty best.
// THREE PLAYERS, none of whom can see the card across from them or the luck (nobody can):
//   careless  any card that fits, and on its call any category left - somebody tapping without reading
//   dull      "Pick for me": the highest-rated card, and on its call that card's best category
//   careful   reads the screen: on its call the card-and-category pair worth the most, on theirs the card worth
//             the most in what they called
//
// WHY THREE. Until v2.31.0 the category was hidden until the card was down, and the second player here ("sharp")
// beat the dull one by 0.36 battles a run - the owner played it and said the picks felt random, and the number
// agreed. The careless player is new and is the point: a game in which tapping at random does about as well as
// reading is not asking anything of the player.
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
const pct = (n) => `${(100 * n).toFixed(0)}%`;

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
// A player is asked for the next round's { card, cat }. `call` is card-logic's nextCall: { by, cat } - the
// category is given on their call (and in round six), and null when it is the player's own to name.
const fitting = (hand, foe, rounds) => C.playable(hand, foe, rounds).filter((e) => C.leavesAWay(hand, foe, rounds, e));
// What a card is sure of this round whatever is called: who of yours is already down, and its finish.
const sure = (e, rounds) => C.playedSynergies(e, rounds.map((r) => r.mine)).reduce((n, m) => n + m.pts, 0) + (C.FINISH_BONUS[e.finish] || 0);
const careless = (rand) => (hand, foe, rounds, call) => {
  const opts = fitting(hand, foe, rounds), left = C.leftCategories(rounds);
  return { card: opts[Math.floor(rand() * opts.length)], cat: call.cat || left[Math.floor(rand() * left.length)] };
};
const dull = (hand, foe, rounds, call) => { const card = C.autoPick(hand, foe, rounds); return { card, cat: call.cat || C.bestCategory(card, rounds) }; };
const careful = (hand, foe, rounds, call) => {
  let best = null, top = -Infinity;
  for (const e of fitting(hand, foe, rounds)) for (const c of call.cat ? [call.cat] : C.leftCategories(rounds)) {
    const worth = C.categoryWorth(e, c) + sure(e, rounds);
    if (worth > top) { top = worth; best = { card: e, cat: c }; }
  }
  return best;
};
// THE GAUNTLET SHOWS THEIR SIX, so there a careful player calls where its card beats THEIRS by the most - and
// answers their call with the card that comes closest.
const seeing = (hand, foe, rounds, call) => {
  const them = foe[rounds.length];
  let best = null, top = -Infinity;
  for (const e of fitting(hand, foe, rounds)) for (const c of call.cat ? [call.cat] : C.leftCategories(rounds)) {
    const lead = C.categoryWorth(e, c) + sure(e, rounds) - C.categoryWorth(them, c);
    if (lead > top) { top = lead; best = { card: e, cat: c }; }
  }
  return best;
};
function playBattle(hand, foe, pick, rand, edge, edgeLabel = null) {
  const rounds = [];
  for (let i = 0; i < 6; i++) {
    const call = C.nextCall(foe, rounds);
    const p = pick(hand, foe, rounds, call);
    rounds.push(C.playRound(foe, rounds, p.card, call.cat || p.cat, rand, edge, edgeLabel));
  }
  return C.battleResult(rounds);
}

// ---- a run up the ladder ----
function climb(deck, pick, rand, seed) {
  let wins = 0, changed = 0, upsets = 0, battles = 0;
  for (; wins < 60; ) {
    const foe = C.ladderFoe(seed, wins);
    const hand = C.dealHand(deck, rand);
    const result = playBattle(hand, foe, pick, rand, C.ladderEdge(wins));
    const plain = C.autoLineup(hand, foe);
    battles++;
    if (result.rounds.map((r) => r.mine.id).sort().join() !== plain.map((e) => e.id).sort().join()) changed++;
    // a round a lower-rated card took off a higher-rated one
    upsets += result.rounds.filter((r) => r.win === "me" && r.mine.rating < r.foe.rating).length;
    if (!result.win) break;
    wins++;
  }
  return { wins, changed, battles, upsets };
}
const PLAYERS = [["careless", () => careless(mulberry32(SEED + 5))], ["dull", () => dull], ["careful", () => careful]];
function measure(name, makeDeck) {
  const out = {};
  for (const [who, make] of PLAYERS) {
    const rand = mulberry32(SEED), pick = make();
    let total = 0, zero = 0, long = 0, changed = 0, battles = 0, upsets = 0;
    const lengths = [];
    for (let i = 0; i < RUNS; i++) {
      const deck = C.bestDeck(makeDeck(mulberry32(SEED + 1000 + (i % 50))));
      const r = climb(deck, pick, rand, `bal-${SEED}-${i}`);
      total += r.wins; lengths.push(r.wins); if (r.wins === 0) zero++; if (r.wins >= 40) long++;
      changed += r.changed; battles += r.battles; upsets += r.upsets;
    }
    out[who] = { avg: total / RUNS, zero: zero / RUNS, long, changed: changed / battles, upsets: upsets / battles, max: Math.max(...lengths) };
  }
  console.log(`\n${name}`);
  for (const [who] of PLAYERS) {
    const m = out[who];
    console.log(`  ${who.padEnd(8)} wins a run ${m.avg.toFixed(2)}   no win at all ${pct(m.zero)}   longest ${m.max}   upset rounds a battle ${m.upsets.toFixed(2)}   a different six from Pick for me ${pct(m.changed)}`);
  }
  return out;
}

console.log(`card balance: ${RUNS} runs a collection, seed ${SEED}`);
const s = measure("A starter deck (thirty Base cards rated under 60)", starter);
const r = measure("Sixty random cards", randomSixty);
const b = measure("The sixty best cards in the game", () => bestSixty());

// ---- an even match ----
// Sixty random cards against a CPU team built at the level of the hand's own best six. What the call is worth,
// whether winning it runs away with a battle, and how much is luck.
const even = {};
{
  for (const [who, make] of PLAYERS) {
    const rand = mulberry32(SEED + 7), pick = make();
    let wins = 0, n = 0, sweeps = 0, mine = 0, mineWon = 0, theirs = 0, theirsWon = 0;
    for (let i = 0; i < 300; i++) {
      const deck = C.bestDeck(randomSixty(mulberry32(SEED + 2000 + i)));
      for (let k = 0; k < 4; k++) {
        const hand = C.dealHand(deck, rand);
        const level = C.bestTeam(hand).reduce((sum, e) => sum + C.CARDS.get(e.id).rating, 0) / 6;
        const res = playBattle(hand, C.buildTeam(rand, level), pick, rand, 0);
        n++; if (res.win) wins++; if (res.wins === 6 || res.losses === 6) sweeps++;
        for (const x of res.rounds) { if (x.call === "me") { mine++; if (x.win === "me") mineWon++; } else { theirs++; if (x.win === "foe") theirsWon++; } }
      }
    }
    even[who] = { win: wins / n, sweeps: sweeps / n, mine: mineWon / mine, theirs: theirsWon / theirs };
  }
  console.log("\nAn even match (a CPU team at the level of the hand's best six), 1,200 battles a player:");
  for (const [who] of PLAYERS) console.log(`  ${who.padEnd(8)} wins the battle ${pct(even[who].win)}   6-0 either way ${pct(even[who].sweeps)}   wins a round it called ${pct(even[who].mine)}   they win a round they called ${pct(even[who].theirs)}`);
}
// The same two teams played twenty times: how often does the less likely result come up?
let luck;
{
  const rand = mulberry32(SEED + 7);
  let flips = 0, games = 0;
  for (let i = 0; i < 300; i++) {
    const deck = C.bestDeck(randomSixty(mulberry32(SEED + 2000 + i)));
    const hand = C.dealHand(deck, rand);
    const level = C.bestTeam(hand).reduce((sum, e) => sum + C.CARDS.get(e.id).rating, 0) / 6;
    const foe = C.buildTeam(rand, level);
    let w = 0;
    for (let k = 0; k < 20; k++) if (playBattle(hand, foe, careful, rand, 0).win) w++;
    games += 20; flips += Math.min(w, 20 - w);
  }
  luck = flips / games;
  console.log(`\nOne hand against one team twenty times: the less likely result comes up ${pct(luck)} of the time.`);
}

// ---- the gauntlet, a stage at a time ----
// Their six are in view there, so the careful player is the one who can see them. A stage may be tried as often
// as it takes, so what matters is the chance of ONE try. Printed for CARDS.md 13; two ends of it are held.
const gauntlet = [];
{
  console.log("\nThe gauntlet: the chance one try clears a stage");
  console.log("  stage              head start   starter/dull   starter/careful   sixty random/careful   sixty best/careful");
  const tries = Math.max(100, Math.round(RUNS / 2));
  for (let stage = 0; stage < C.GAUNTLET.length; stage++) {
    const foe = C.gauntletFoe(stage), edge = C.gauntletEdge(stage);
    const rate = (makeDeck, pick, salt) => {
      const rand = mulberry32(SEED + 31 * stage + salt);
      let w = 0;
      for (let i = 0; i < tries; i++) {
        const hand = C.dealHand(C.bestDeck(makeDeck(mulberry32(SEED + 4000 + (i % 50)))), rand);
        if (playBattle(hand, foe, pick, rand, edge, C.GAUNTLET_EDGE_LABEL).win) w++;
      }
      return w / tries;
    };
    const row = { starterDull: rate(starter, dull, 1), starter: rate(starter, seeing, 2), random: rate(randomSixty, seeing, 3), best: rate(() => bestSixty(), seeing, 4) };
    gauntlet.push(row);
    console.log(`  ${String(stage + 1).padStart(2)} ${C.gauntletName(stage).padEnd(15)} ${String(edge).padStart(6)}       ${pct(row.starterDull).padStart(5)}          ${pct(row.starter).padStart(5)}               ${pct(row.random).padStart(5)}                 ${pct(row.best).padStart(5)}`);
  }
}

console.log("\nWhat the game is held to:");
hold(s.dull.avg >= 0.8 && s.dull.avg <= 3, `a starter deck wins ${s.dull.avg.toFixed(2)} battles a run on Pick for me (0.8 to 3)`);
hold(s.dull.zero <= 0.4, `...and loses its very first battle ${pct(s.dull.zero)} of the time (at most 40%)`);
hold(r.careful.avg >= 4 && r.careful.avg <= 9, `sixty random cards win ${r.careful.avg.toFixed(2)} a run (4 to 9)`);
hold(b.careful.avg >= 8 && b.careful.avg <= 16, `the sixty best win ${b.careful.avg.toFixed(2)} a run (8 to 16)`);
hold(b.careful.long === 0 && b.dull.long === 0, "no run reaches forty wins");
hold(r.careful.avg - r.careless.avg >= 2, `reading the screen is worth ${(r.careful.avg - r.careless.avg).toFixed(2)} wins a run over tapping at random (at least 2)`);
hold(r.careful.avg - r.dull.avg >= 0.3, `...and ${(r.careful.avg - r.dull.avg).toFixed(2)} over Pick for me (at least 0.3)`);
hold(even.careful.win - even.careless.win >= 0.4, `at even strength reading it wins ${pct(even.careful.win)} of battles and tapping at random ${pct(even.careless.win)} (at least 40 points apart)`);
hold(r.careful.upsets >= 0.3, `a lower-rated card takes ${r.careful.upsets.toFixed(2)} rounds a battle off a higher-rated one (at least 0.3)`);
hold(luck >= 0.08 && luck <= 0.35, `luck turns ${pct(luck)} of rematches (8% to 35%)`);
// WINNING A ROUND EARNS THE CALL, and the call must not run away with the battle.
hold(even.careful.sweeps < 0.15, `at even strength ${pct(even.careful.sweeps)} of battles are 6-0 either way (under 15%)`);
hold(even.careful.mine >= 0.35 && even.careful.mine <= 0.8, `you win ${pct(even.careful.mine)} of the rounds you call (35% to 80%)`);
hold(even.careful.theirs >= 0.35 && even.careful.theirs <= 0.8, `and they win ${pct(even.careful.theirs)} of the rounds they call (35% to 80%)`);
// The gauntlet's two ends: a stage is never a formality, and the last is never out of reach.
hold(gauntlet[0].starter <= 0.9, `a starter deck clears the first gauntlet stage ${pct(gauntlet[0].starter)} of tries (at most 90%)`);
hold(gauntlet.at(-1).best >= 0.25, `the sixty best clear the last ${pct(gauntlet.at(-1).best)} of tries (at least 25%)`);

console.log(fails ? `\n${fails} FAILED` : "\ncard balance: every promise held");
process.exit(fails ? 1 : 0);
