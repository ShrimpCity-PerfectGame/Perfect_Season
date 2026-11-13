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
C.initDefenses(read("data/versus-pool.json"));
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
function byFit(collection, defense, per = 4, flexPer = 5) {
  const worth = (c) => c.rating + defense.traits.reduce((s, t) => s + (C.COUNTERS[t]?.[c.archetype] || 0), 0) + (maxPair[c.archetype] || 0);
  const ranked = [...collection].sort((a, b) => worth(b) - worth(a) || a.id - b.id);
  const pick = (test, n) => ranked.filter(test).slice(0, n);
  const [qbs, rbs, wrs, tes] = ["QB", "RB", "WR", "TE"].map((p) => pick((c) => c.pos === p, per));
  const flexes = pick((c) => c.pos !== "QB", flexPer + 3);
  let best = null, bestScore = -Infinity;
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
const lowRated = all.filter((c) => c.rating < 60);
function starter(seed) {            // the spec's starter deck: eight Base cards from the lower-rated pool, playable
  const rand = mulberry32(seed);
  for (;;) { const deck = draw(rand, lowRated, 8); if (byRating(deck)) return deck; }
}
const middling = (seed) => draw(mulberry32(seed), all, 60);
const stacked = () => [...all].sort((a, b) => b.rating - a.rating || a.id - b.id).slice(0, 60);

// ---------- Play ----------
// A run: random defenses one after another, a fresh lineup for each, until a loss. The bar rises with every win
// (card-logic.mjs, BAR_STEP), so a run's LENGTH is the measure of a collection.
const MAX_RUN = 40; // nothing should get near it; reaching it is itself a failure of the bar
function play(name, make, collections, runsEach) {
  const t = { runs: 0, battles: 0, fitWins: 0, ratingWins: 0, differs: 0, luckMoved: 0, luckShift: 0, lowCard: 0, zero: 0, capped: 0, longest: 0 };
  for (let k = 0; k < collections; k++) {
    const collection = make(1000 + k);
    const flat = byRating(collection);
    const rand = mulberry32(77 * (k + 1));
    for (let r = 0; r < runsEach; r++) {
      t.runs++;
      // the same defenses and the same luck for both bots, so the only difference is the lineup
      const draws = Array.from({ length: MAX_RUN }, () => ({ defense: C.DEFENSES[Math.floor(rand() * C.DEFENSES.length)], seed: Math.floor(rand() * 2 ** 31) }));
      let step = 0;
      for (; step < MAX_RUN; step++) {
        const { defense, seed } = draws[step];
        const fit = byFit(collection, defense);
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
      while (calm < MAX_RUN && C.scoreBattle(byFit(collection, draws[calm].defense), draws[calm].defense, mid, calm).win) calm++;
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
const s = play("starter deck (8 cards rated under 60)", starter, 40, 25);
band(s.wins, 0.8, 2.5, "starter deck: wins in an average run");
band(s.winless, 0.02, 0.30, "starter deck: runs that end without a single win");
const m = play("middling collection (60 random cards)", middling, 20, 6);
band(m.wins, 5, 10, "middling collection: wins in an average run");
band(m.wins - m.flatWins, 0.3, 40, "...more than the six highest ratings manage, by this many wins");
band(m.differs, 0.40, 1, "...reading the defense picks a different six this often");
band(m.luckMoved, 0.25, 0.75, "...luck changes how long a run lasts this often");
band(m.luckShift, 0.2, 1.0, "...and by this many wins on average");
band(m.lowCard, 0.15, 1, "...a card rated under 70 is in the chosen lineup this often");
const k = play("stacked collection (the 60 highest ratings)", stacked, 1, 60);
band(k.wins, 9, 16, "stacked collection: wins in an average run");
band(k.capped + m.capped + s.capped, 0, 0, "no run ever reaches " + MAX_RUN + " wins - the bar always catches up");

console.log(fails ? `\n${fails} band(s) FAILED` : "\ncard balance: every band holds");
process.exit(fails ? 1 : 0);
