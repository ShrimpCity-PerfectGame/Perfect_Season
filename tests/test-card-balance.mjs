// The card battle's balance, MEASURED. card-logic.mjs's numbers (the luck spread, the defense's bar, every
// counter and pair) are tuned, not chosen, and this is what they are tuned to. It builds three collections,
// lets two bots pick lineups from them against random defenses, plays the battles, PRINTS what happened and
// holds each number to the band the design asks for (docs/superpowers/specs/2026-11-13-card-collection-design.md,
// section 2's anti-goals):
//
//   - a new player with a starter deck wins a battle or two a run, and not none
//   - a bigger collection goes further, and the best one in the game still meets a bar it cannot clear
//   - the six highest ratings are NOT the answer: a bot that reads the defense picks differently, and goes further
//   - luck decides "a bit" of it
//
// WHAT THIS DOES NOT DO: hold any single counter or pair to anything. Review deleted six of the seven pairs and
// zeroed every positive counter, and only one band moved, by less than seed noise. These are bands on the game
// as a whole - run length, and whether reading the defense pays - so a number in COUNTERS or PAIRS can be wrong
// on its own and this file will not say so. The starter bands measure the bar and nothing else: with eight
// cards there is almost never a second lineup to choose.
//
// A band failing after a change to card-logic.mjs is the change's cost, stated. If the bands cannot all hold
// together that is a design question for the owner - never loosen one to make a run green.
//
//   node tests/test-card-balance.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SLOTS, mulberry32 } from "../game-logic.mjs";
import * as C from "../card-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
C.initCardData(read("data/cards.json"));
C.initDefenses(read("data/versus-pool.json"), read("data/card-defense.json"));
const all = [...C.CARDS.values()].sort((a, b) => a.id - b.id);
const mid = () => 0.5;

let fails = 0;
const band = (value, lo, hi, what) => {
  const good = value >= lo && value <= hi;
  if (!good) fails++;
  console.log(`${good ? "  ok " : "FAIL "} ${what.padEnd(64)} ${value.toFixed(3)}   (wants ${lo} to ${hi})`);
};

const fitsSlot = (card, slot) => (slot.startsWith("FLEX") ? card.pos !== "QB" : card.pos === slot);
const entry = (card) => ({ id: card.id, finish: "base" });

// The highest-rated legal lineup, archetypes ignored: what "just play your best cards" means.
function byRating(collection) {
  const sorted = [...collection].sort((a, b) => b.rating - a.rating || a.id - b.id);
  const lineup = {}; const men = new Set();
  for (const slot of SLOTS) {
    const c = sorted.find((x) => !men.has(x.pid) && fitsSlot(x, slot));
    if (!c) return null;
    lineup[slot] = entry(c); men.add(c.pid);
  }
  return lineup;
}

// The lineup with the best no-luck score against THIS defense, searched over the strongest few candidates for
// each slot. A candidate's worth is its rating, what the defense does to it, and the most a pair could add - so
// a 58 that completes a pair is in the running beside an 80 that does not.
const maxPair = Object.fromEntries(C.ARCHETYPES.map((a) => [a.id, Math.max(0, ...C.PAIRS.filter((p) => p[0] === a.id || p[1] === a.id).map((p) => p[2]))]));
function byFit(collection, defense, flat, per = 4, flexPer = 5) {
  const worth = (c) => c.rating + defense.traits.reduce((s, t) => s + (C.COUNTERS[t]?.[c.archetype] || 0), 0) + (maxPair[c.archetype] || 0);
  const ranked = [...collection].sort((a, b) => worth(b) - worth(a) || a.id - b.id);
  const pick = (test, n) => ranked.filter(test).slice(0, n);
  const [qbs, rbs, wrs, tes] = ["QB", "RB", "WR", "TE"].map((p) => pick((c) => c.pos === p, per));
  const flexes = pick((c) => c.pos !== "QB", flexPer + 3);
  let best = flat, bestScore = flat ? C.scoreBattle(flat, defense, mid).offense : -Infinity;
  for (const q of qbs) for (const r of rbs) for (const w of wrs) for (const t of tes) {
    const men = new Set([q.pid, r.pid, w.pid, t.pid]);
    if (men.size < 4) continue;
    const pool = flexes.filter((f) => !men.has(f.pid)).slice(0, flexPer);
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
      if (pool[i].pid === pool[j].pid) continue;
      const lineup = { QB: entry(q), RB: entry(r), WR: entry(w), TE: entry(t), FLEX1: entry(pool[i]), FLEX2: entry(pool[j]) };
      const score = C.scoreBattle(lineup, defense, mid).offense;
      if (score > bestScore) { bestScore = score; best = lineup; }
    }
  }
  return best;
}

// ---------- The three collections ----------
const draw = (rand, from, n) => { const pool = [...from]; const out = []; while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]); return out; };
// the real starter deck, dealt by the rule the server deals it with
const starter = (seed) => C.starterDeck(mulberry32(seed)).map((e) => C.CARDS.get(e.id));
const middling = (seed) => draw(mulberry32(seed), all, 60);
const stacked = () => [...all].sort((a, b) => b.rating - a.rating || a.id - b.id).slice(0, 60);

// ---------- Play ----------
// A run: random defenses one after another, a fresh lineup for each, until a loss. The bar rises with every win
// (card-logic.mjs, BAR_STEP), so a run's LENGTH is the measure of a collection.
const MIDDLING = 50; // how many different sixty-card collections stand for "a middling collection"
const MAX_RUN = 40; // nothing should get near it; reaching it is itself a failure of the bar
function play(name, make, collections, runsEach, seedA = 1000, seedB = 77) {
  const t = { runs: 0, battles: 0, fitWins: 0, ratingWins: 0, differs: 0, luckMoved: 0, luckShift: 0, lowCard: 0, zero: 0, capped: 0, longest: 0 };
  for (let k = 0; k < collections; k++) {
    const collection = make(seedA + k);
    const flat = byRating(collection);
    const rand = mulberry32(seedB * (k + 1));
    for (let r = 0; r < runsEach; r++) {
      t.runs++;
      // the same defenses and the same luck for both bots, so the only difference is the lineup
      const draws = Array.from({ length: MAX_RUN }, () => ({ defense: C.DEFENSES[Math.floor(rand() * C.DEFENSES.length)], seed: Math.floor(rand() * 2 ** 31) }));
      const fits = []; // the fit bot's pick for each battle of this run, worked out once and shared with the no-luck replay
      const fitAt = (i) => fits[i] || (fits[i] = byFit(collection, draws[i].defense, flat));
      let step = 0;
      for (; step < MAX_RUN; step++) {
        const { defense, seed } = draws[step];
        const fit = fitAt(step);
        const rolled = C.scoreBattle(fit, defense, mulberry32(seed), step);
        t.battles++;
        if (SLOTS.map((x) => fit[x].id).sort().join() !== SLOTS.map((x) => flat[x].id).sort().join()) t.differs++;
        if (SLOTS.some((x) => C.CARDS.get(fit[x].id).rating < 70)) t.lowCard++;
        if (!rolled.win) break;
      }
      t.fitWins += step; if (step === 0) t.zero++; if (step === MAX_RUN) t.capped++; if (step > t.longest) t.longest = step;
// The same run with no luck at all: how far the collection goes on its merits. Luck is "a bit" when it
      // moves a run by a win, not when it decides where the run ends up.
      let calm = 0;
      while (calm < MAX_RUN && C.scoreBattle(fitAt(calm), draws[calm].defense, mid, calm).win) calm++;
      if (calm !== step) t.luckMoved++;
      t.luckShift += Math.abs(calm - step);
      let flatStep = 0;
      while (flatStep < MAX_RUN && C.scoreBattle(flat, draws[flatStep].defense, mulberry32(draws[flatStep].seed), flatStep).win) flatStep++;
      t.ratingWins += flatStep;
    }
  }
  console.log(`\n${name}: ${t.runs} runs, ${t.battles} battles, longest run ${t.longest}`);
  return { wins: t.fitWins / t.runs, flatWins: t.ratingWins / t.runs, winless: t.zero / t.runs, capped: t.capped / t.runs,
    differs: t.differs / t.battles, luckMoved: t.luckMoved / t.runs, luckShift: t.luckShift / t.runs, lowCard: t.lowCard / t.battles };
}

console.log(`constants: LUCK_SPREAD ${C.LUCK_SPREAD}; bar ${C.BAR_START} + ${C.BAR_STEP} a win + ${C.BAR_DEFENSE} x (defense rating - ${C.BAR_PIVOT})`);
// node tests/test-card-balance.mjs [seedA] [seedB] plays a different set of collections and defenses. The bands
// have to hold for the CONSTANTS, not for one lucky draw of sixty cards: review re-ran the first version of this
// file on three other seed sets and two of them failed a band, because twenty collections is too few to say
// what a "middling collection" does. Try another pair before believing a number that sits near its edge.
const SEED_A = Number(process.argv[2]) || 1000, SEED_B = Number(process.argv[3]) || 77;
const s = play("starter deck (8 cards rated under 60)", starter, 40, 25, SEED_A, SEED_B);
band(s.wins, 0.8, 2.5, "starter deck: wins in an average run");
band(s.winless, 0.02, 0.30, "starter deck: runs that end without a single win");
const m = play("middling collection (60 random cards)", middling, MIDDLING, 6, SEED_A, SEED_B);
band(m.wins, 5, 10, "middling collection: wins in an average run");
// The three bands below are FLOORS set under what was measured, not targets the numbers were tuned to hit. On
// three seed sets at 80 collections the gain was 0.338 every time, luck moved 29-31% of runs, and a sub-70 card
// was fielded in 16-24% of battles. Whether +0.34 wins a run is ENOUGH reward for reading the defense is a
// question for somebody playing it, and CARDS.md says so.
band(m.wins - m.flatWins, 0.25, 40, "...more than the six highest ratings manage, by this many wins");
band(m.differs, 0.40, 1, "...reading the defense picks a different six this often");
band(m.luckMoved, 0.20, 0.75, "...luck changes how long a run lasts this often");
band(m.luckShift, 0.2, 1.0, "...and by this many wins on average");
band(m.lowCard, 0.10, 1, "...a card rated under 70 is in the chosen lineup this often");
const k = play("stacked collection (the 60 highest ratings)", stacked, 1, 60, SEED_A, SEED_B);
band(k.wins, 9, 16, "stacked collection: wins in an average run");
band(k.capped + m.capped + s.capped, 0, 0, "no run ever reaches " + MAX_RUN + " wins - the bar always catches up");

console.log(fails ? `\n${fails} band(s) FAILED` : "\ncard balance: every band holds");
process.exit(fails ? 1 : 0);
