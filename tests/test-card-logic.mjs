// The card rules, with no browser and no database: card-logic.mjs is pure, so everything the cards promise can
// be checked by calling it. Archetypes, defense traits, what a legal lineup is, and how a battle scores.
// tests/test-card-balance.mjs is the other half - it PLAYS thousands of battles and holds the numbers.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SLOTS, mulberry32 } from "../game-logic.mjs";
import * as C from "../card-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.error(`FAIL  ${what}`); } };
const eq = (a, b, what) => ok(a === b, `${what} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);
// A later section's exports do not exist until its task lands; calling through this says which one is missing
// instead of dying on the first.
const need = (name) => { if (typeof C[name] === "undefined") { fails++; console.error(`FAIL  card-logic.mjs does not export ${name}`); return false; } return true; };

// ---------- 1. Cards and archetypes ----------
const info = C.initCardData(read("data/cards.json"));
eq(info.cards, 3124, "every card loads");
eq(info.players, 1639, "1,639 players");
const all = [...C.CARDS.values()];
const count = (id) => all.filter((c) => C.cardArchetypes(c).includes(id)).length;
// The counts the design was agreed on (spec 3.1), measured against the pool on 2026-11-12.
for (const [id, n] of [["gunslinger", 91], ["scrambler", 70], ["manager", 86], ["volume", 64], ["workhorse", 101],
  ["receiving", 148], ["goalline", 122], ["homerun", 123], ["deep", 194], ["possession", 121], ["redzone", 245],
  ["seam", 78], ["valve", 89]]) eq(count(id), n, `${id} count`);
eq(C.ARCHETYPES.map((a) => a.id).join(), "gunslinger,scrambler,volume,manager,workhorse,goalline,homerun,receiving,deep,redzone,possession,seam,valve", "the archetypes, in priority order");
const find = (name, season) => all.find((c) => c.name === name && c.season === season);
eq(C.cardArchetype(find("Tom Brady", 2007)), "gunslinger", "2007 Brady");
eq(C.cardArchetype(find("Adrian Peterson", 2012)), "workhorse", "2012 Peterson");
eq(C.cardArchetype(find("Devery Henderson", 2011)), "deep", "2011 Henderson");
eq(C.archetypeLabel("deep"), "Deep threat", "a label");
eq(C.archetypeLabel("role"), "Role player", "the role player's label");
ok(all.filter((c) => c.archetype === "role").length > 1500, "most cards are role players");
ok(all.every((c) => c.archetype === C.cardArchetype(c)), "the stored archetype is the computed one");
ok(all.every((c) => c.archetype === "role" || C.ARCHETYPES.find((a) => a.id === c.archetype).pos.includes(c.pos)), "an archetype only lands on its own position");
// A card with nothing in the denominators is a role player, never NaN and never a throw.
const empty = { ...all[0], g: 0, att: 0, cmp: 0, car: 0, rec: 0, py: 0, ry: 0, rcy: 0, ptd: 0, rtd: 0, rctd: 0, int: 0 };
for (const pos of ["QB", "RB", "WR", "TE"]) {
  eq(C.cardArchetype({ ...empty, pos }), "role", `an empty ${pos} is a role player`);
  eq(C.cardArchetypes({ ...empty, pos }).length, 0, `and qualifies for nothing`);
}

// ---------- 2. Defenses and their traits ----------
if (need("initDefenses")) {
  const pool = read("data/versus-pool.json");
  const allowed = read("data/card-defense.json");
  eq(C.initDefenses(pool, allowed), 859, "859 defenses");
  eq(C.TRAITS.map((t) => t.id).join(), "stingy,runstop,ballhawks,passrush,strip,scoring", "the traits");
  // Yards allowed (data/card-defense.json): the one thing the duel's defense file does not hold, and what the
  // Run stopper trait is read from. One row for every defense in the pool, no more and no fewer.
  eq(allowed.columns.join(), "season,team,games,rush,pass", "the yards-allowed columns");
  eq(allowed.defenses.length, 859, "a yards-allowed row for every defense");
  eq(new Set(allowed.defenses.map((r) => r[0] + "|" + r[1])).size, 859, "each of them once");
  ok(allowed.defenses.every((r) => C.defenseByKey(r[0] + "|" + r[1])), "and each one is a defense in the pool");
  // 22 early defenses are averaged over fifteen games: the source is missing one of theirs (mostly the two
  // broken Jaguars seasons' opponents). The builder refuses any defense missing more than one.
  ok(allowed.defenses.every((r) => r[2] >= 15 && r[2] <= 17), "fifteen to seventeen regular-season games each");
  ok(allowed.defenses.filter((r) => r[0] >= 2003 && r[0] !== 2022).every((r) => r[2] === (r[0] >= 2021 ? 17 : 16)), "and a full season for everybody from 2003 on (2022 lost one game for real)");
  ok(C.DEFENSES.every((d) => d.rush > 55 && d.rush < 190 && d.pass > 130 && d.pass < 330), "every defense has plausible yards allowed a game");
  ok(!/https?:/.test(JSON.stringify(allowed)), "no URL in the yards-allowed file");
  // Pinned by hand against the record book: the 2000 Ravens allowed 970 rushing yards in sixteen games, still
  // the fewest in a sixteen-game season.
  eq(C.defenseByKey("2000|BAL").rush, 60.6, "the 2000 Ravens allowed 60.6 rushing yards a game");
  ok(C.defenseByKey("2000|BAL").traits.includes("runstop"), "and are a Run stopper");
  eq(C.traitLabel("runstop"), "Run stopper", "the trait's label");
  eq([...C.DEFENSES].sort((a, b) => a.rush - b.rush)[0].key, "2000|BAL", "nobody in the pool allowed fewer");
  // Without the yards-allowed file the trait is simply absent - never guessed, never a crash.
  C.initDefenses(pool);
  ok(C.DEFENSES.every((d) => !d.traits.includes("runstop") && d.rush === undefined), "no yards-allowed file, no Run stopper");
  ok(C.DEFENSES.filter((d) => d.season === 2000 && d.traits.includes("stingy")).length === 5, "and the other traits are untouched");
  C.initDefenses(pool, allowed);
  // Best five of its OWN season, so a 2003 defense and a 2023 one are judged against their own football.
  for (const t of C.TRAITS) for (let y = 1999; y <= 2025; y++) {
    eq(C.DEFENSES.filter((d) => d.season === y && d.traits.includes(t.id)).length, 5, `${y} has five ${t.id}`);
  }
  ok(C.defenseByKey("2000|BAL").traits.includes("stingy"), "the 2000 Ravens are stingy");
  ok(C.defenseByKey("2002|TB").traits.includes("ballhawks"), "the 2002 Bucs are ball hawks");
  ok(C.defenseByKey("2022|PHI").traits.includes("passrush"), "the 2022 Eagles rush the passer");
  eq(C.defenseByKey("1066|XX"), undefined, "a defense that never was");
  ok(C.DEFENSES.every((d) => d.traits.every((t, i) => i === 0 || C.TRAITS.findIndex((x) => x.id === t) > C.TRAITS.findIndex((x) => x.id === d.traits[i - 1]))), "a defense lists its traits in TRAITS order");
  ok(C.DEFENSES.some((d) => d.traits.length === 0) && C.DEFENSES.some((d) => d.traits.length >= 3), "some defenses have no trait and some have several");
  // Ties at the cut: the answer must not depend on the order the file lists teams in.
  const before = C.DEFENSES.map((d) => `${d.key}:${d.traits.join(",")}`).sort();
  C.initDefenses({ ...pool, defenses: [...pool.defenses].reverse() }, { ...allowed, defenses: [...allowed.defenses].reverse() });
  eq(JSON.stringify(C.DEFENSES.map((d) => `${d.key}:${d.traits.join(",")}`).sort()), JSON.stringify(before), "traits survive a reordered file");
  eq(C.DEFENSES.map((d) => d.key).join(), [...C.DEFENSES.map((d) => d.key)].sort().join(), "and DEFENSES is always in key order");
  // And the pool does contain such ties, or the check above proves nothing.
  const tied = pool.defenses.some((a) => pool.defenses.some((b) => a !== b && a[0] === b[0] && a[4] === b[4]));
  ok(tied, "the pool really has two teams level on interceptions in one season");
  C.initDefenses(pool, allowed);
}

// ---------- 3. What a legal lineup is ----------
// The best card at each named slot, then the two best non-quarterbacks left whose player is not already in.
const byRating = [...all].sort((a, b) => b.rating - a.rating || a.id - b.id);
const good = {};
const usedPids = new Set();
for (const slot of SLOTS) {
  const c = byRating.find((x) => !usedPids.has(x.pid) && (slot.startsWith("FLEX") ? x.pos !== "QB" : x.pos === slot));
  good[slot] = { id: c.id, finish: "base" };
  usedPids.add(c.pid);
}
if (need("lineupProblem")) {
  const owning = (lineup) => new Map(Object.values(lineup).map((e) => [C.ownKey(e.id, e.finish), 1]));
  eq(C.FINISHES.join(), "base,silver,gold,prism", "the four finishes");
  eq(JSON.stringify(C.FINISH_BONUS), JSON.stringify({ base: 0, silver: 1, gold: 2, prism: 3 }), "what each is worth");
  eq(C.ownKey(412, "gold"), "412:gold", "an ownership key");
  eq(C.lineupProblem(good, null), null, "a legal lineup passes");
  eq(C.lineupProblem(good, owning(good)), null, "and passes when owned");
  eq(C.lineupProblem(good, new Map()), "not_owned", "an empty collection owns nothing");
  eq(C.lineupProblem(good, new Map([...owning(good)].map(([k]) => [k, 0]))), "not_owned", "a count of zero is not owning it");
  // Owning the Base copy is not owning the Gold one.
  eq(C.lineupProblem({ ...good, QB: { ...good.QB, finish: "gold" } }, owning(good)), "not_owned", "finish is part of what you own");
  const { QB: _qb, ...noQb } = good;
  eq(C.lineupProblem(noQb, null), "incomplete", "a missing slot");
  eq(C.lineupProblem({ ...good, QB: undefined }, null), "incomplete", "a slot set to nothing");
  eq(C.lineupProblem({ ...good, FLEX1: good.QB }, null), "bad_slot", "a quarterback cannot play Flex");
  eq(C.lineupProblem({ ...good, WR: good.TE, TE: good.WR }, null), "bad_slot", "a tight end is not a receiver");
  eq(C.lineupProblem({ ...good, FLEX2: { ...good.RB } }, null), "same_player", "one card, one slot");
  // Two different seasons of one man are still one man.
  const twice = all.find((c) => c.pos === "RB" && all.some((o) => o.pid === c.pid && o.id !== c.id && o.pos === "RB"));
  const other = all.find((o) => o.pid === twice.pid && o.id !== twice.id && o.pos === "RB");
  eq(C.lineupProblem({ ...good, RB: { id: twice.id, finish: "base" }, FLEX1: { id: other.id, finish: "base" } }, null), "same_player", "two seasons of one man");
  // Things only a modified client would send. None of them may throw.
  eq(C.lineupProblem({ ...good, RB: { id: 999999, finish: "base" } }, null), "unknown_card", "an id that is not a card");
  eq(C.lineupProblem({ ...good, RB: { id: "7", finish: "base" } }, null), "unknown_card", "an id that is a string");
  eq(C.lineupProblem({ ...good, RB: { ...good.RB, finish: "diamond" } }, null), "bad_finish", "a finish that does not exist");
  eq(C.lineupProblem({ ...good, RB: { ...good.RB, finish: "constructor" } }, null), "bad_finish", "a finish that is an object property");
  eq(C.lineupProblem({ ...good, RB: "x" }, null), "malformed", "an entry that is not an object");
  eq(C.lineupProblem({ ...good, K: good.RB }, null), "malformed", "a slot that does not exist");
  for (const junk of [null, undefined, "x", 7, [], true]) eq(C.lineupProblem(junk, null), "malformed", `junk input ${JSON.stringify(junk)}`);
}

// ---------- 4. Scoring a battle ----------
// Pinned once every other check here passed; it moves whenever a constant or a rule does, and it is what says
// the browser and the Edge Function roll the same battle. Re-pin it deliberately, never to make a run green.
const PINNED_CHECKSUM = 15070896;
if (need("scoreBattle")) {
  const mid = () => 0.5; // two draws of 0.5 are a roll of exactly zero
  const rav = C.defenseByKey("2000|BAL");
  const calm = C.DEFENSES.find((d) => d.traits.length === 0);
  const r0 = C.scoreBattle(good, calm, mid);
  eq(r0.cards.length, 6, "six plays");
  eq(r0.cards.map((c) => c.slot).join(), SLOTS.join(), "in slot order");
  ok(r0.cards.every((c) => c.roll === 0), "a 0.5 roll is no luck");
  ok(r0.cards.every((c) => c.base === C.CARDS.get(c.id).rating), "a Base card's base is its printed rating");
  eq(r0.target, C.battleTarget(calm), "the target is the defense's");
  eq(r0.win, r0.offense >= r0.target, "win is offense against target");
  eq(r0.offense, +r0.cards.reduce((s, c) => s + c.total, 0).toFixed(1), "offense is the six totals");
  ok(C.battleTarget(rav) > C.battleTarget(C.DEFENSES.reduce((a, b) => (a.rating < b.rating ? a : b))), "a better defense is a higher bar");
  // The bar RISES with every win in a run (the owner's call, 2026-11-13): the first battle is one almost anybody
  // can win, and each win raises the next, so every run ends at a real test whatever the collection.
  eq(C.battleTarget(calm), C.battleTarget(calm, 0), "no step is step zero");
  for (let i = 0; i < 30; i++) ok(C.battleTarget(calm, i + 1) > C.battleTarget(calm, i), `step ${i + 1} is a higher bar than step ${i}`);
  eq(C.battleTarget(calm, 3) - C.battleTarget(calm, 2), C.BAR_STEP, "by BAR_STEP a win");
  for (const junk of [-4, NaN, "x", null, undefined, Infinity]) eq(C.battleTarget(calm, junk), C.battleTarget(calm, 0), `a step of ${junk} is step zero`);
  eq(C.battleTarget(calm, 2.9), C.battleTarget(calm, 2), "a fractional step is the step below it");
  eq(C.scoreBattle(good, calm, mid, 4).target, C.battleTarget(calm, 4), "a battle is scored against its own step");
  eq(C.scoreBattle(good, calm, mid, 4).offense, r0.offense, "the step moves the bar, never the cards");
  ok(!C.scoreBattle(good, calm, mid, 30).win, "even the best six in the game lose eventually");
  for (const [finish, pts] of [["silver", 1], ["gold", 2], ["prism", 3]]) {
    eq(+(C.scoreBattle({ ...good, QB: { ...good.QB, finish } }, calm, mid).offense - r0.offense).toFixed(1), pts, `${finish} is worth exactly ${pts}`);
  }
  // A pair lifts both cards, and only with the partner there.
  const gun = byRating.find((c) => c.archetype === "gunslinger");
  const deep = byRating.find((c) => c.archetype === "deep" && c.pid !== gun.pid);
  const pairPts = C.PAIRS.find((p) => p[0] === "gunslinger" && p[1] === "deep")[2];
  const withGun = { ...good, QB: { id: gun.id, finish: "base" } };
  const paired = C.scoreBattle({ ...withGun, WR: { id: deep.id, finish: "base" } }, calm, mid);
  ok(paired.cards[0].mods.some((m) => m.pts === pairPts) && paired.cards[2].mods.some((m) => m.pts === pairPts), "gunslinger and deep threat lift each other");
  // Take every partner away and the gunslinger gets nothing for being one.
  const noPartner = { ...withGun };
  const taken = new Set(Object.values(noPartner).map((e) => C.CARDS.get(e.id).pid));
  for (const slot of SLOTS.slice(1)) {
    const c = byRating.find((x) => x.archetype === "role" && !taken.has(x.pid) && (slot.startsWith("FLEX") ? x.pos !== "QB" : x.pos === slot));
    noPartner[slot] = { id: c.id, finish: "base" }; taken.add(c.pid);
  }
  eq(C.lineupProblem(noPartner, null), null, "the no-partner lineup is legal");
  eq(C.scoreBattle(noPartner, calm, mid).cards[0].mods.length, 0, "no partner, no pair");
  // Two deep threats still lift the quarterback once.
  const deep2 = byRating.find((c) => c.archetype === "deep" && c.pid !== gun.pid && c.pid !== deep.pid);
  const two = C.scoreBattle({ ...withGun, WR: { id: deep.id, finish: "base" }, FLEX1: { id: deep2.id, finish: "base" } }, calm, mid);
  eq(two.cards[0].mods.filter((m) => m.key === "pair:gunslinger+deep").length, 1, "a pair fires once per card");
  // A counter fires against the trait, and only against it.
  const hawks = C.DEFENSES.find((d) => d.traits.join() === "ballhawks");
  const hit = C.COUNTERS.ballhawks.gunslinger;
  ok(hit < 0, "ball hawks are bad news for a gunslinger");
  ok(C.scoreBattle(withGun, hawks, mid).cards[0].mods.some((m) => m.pts === hit && m.key === "trait:ballhawks"), "ball hawks punish a gunslinger");
  // The owner's own example: a Run stopper is bad news for a pure runner and no trouble to a back who catches.
  const stopper = C.DEFENSES.find((d) => d.traits.join() === "runstop");
  const horse = byRating.find((c) => c.archetype === "workhorse"), catcher = byRating.find((c) => c.archetype === "receiving");
  const rbPlay = (card, d) => C.scoreBattle({ ...noPartner, RB: { id: card.id, finish: "base" } }, d, mid).cards[1];
  ok(C.COUNTERS.runstop.workhorse < 0 && C.COUNTERS.runstop.goalline < 0 && C.COUNTERS.runstop.homerun < 0, "a Run stopper hurts every kind of pure runner");
  eq(rbPlay(horse, stopper).total, +(horse.rating + C.COUNTERS.runstop.workhorse).toFixed(1), "a workhorse loses exactly the counter to a Run stopper");
  ok(rbPlay(catcher, stopper).total >= catcher.rating, "a receiving back loses nothing to one");
  eq(rbPlay(horse, calm).total, horse.rating, "and a workhorse loses nothing to a defense that is not one");
  ok(!C.scoreBattle(withGun, calm, mid).cards[0].mods.some((m) => m.key.startsWith("trait")), "a defense with no trait counters nothing");
  ok(r0.cards.every((c) => c.mods.every((m) => typeof m.label === "string" && m.label.length > 3 && Number.isFinite(m.pts))), "every modifier can be read out");
  ok(r0.cards.every((c) => /^\d[\d,]* yards, \d+ TD$/.test(c.line)), `a play reads as football (${r0.cards[0].line})`);
  // Twelve draws, always - the browser and the server have to walk the generator in step.
  for (const d of [calm, rav, hawks]) { let n = 0; C.scoreBattle(good, d, () => (n++, 0.5)); eq(n, 12, `exactly twelve draws against ${d.key}`); }
  // The edges of the generator.
  for (const edge of [0, 0.9999999999]) {
    const r = C.scoreBattle(good, rav, () => edge);
    ok(r.cards.every((c) => Number.isFinite(c.total) && Math.abs(c.roll) <= C.LUCK_SPREAD), `finite and inside the spread at rand=${edge}`);
    ok(Number.isFinite(r.offense), `a finite offense at rand=${edge}`);
  }
  // Luck moves a result both ways around the no-luck one.
  const spread = Array.from({ length: 400 }, (_, i) => C.scoreBattle(good, calm, mulberry32(i + 1)).offense);
  ok(Math.min(...spread) < r0.offense && Math.max(...spread) > r0.offense, "luck lands on both sides of the no-luck score");

  // The daily showdown: the day picks the defense, and one lineup scores the same for everybody.
  const day = "2026-11-13";
  eq(C.showdownSeed(day), "showdown-2026-11-13", "the day's seed");
  eq(C.showdownDefense(day).key, C.showdownDefense(day).key, "one defense a day");
  const s1 = C.showdownScore(day, good), s2 = C.showdownScore(day, good);
  eq(s1.score, s2.score, "one lineup, one score");
  eq(s1.score, s1.offense, "the score is the offense");
  eq(s1.target, C.battleTarget(C.showdownDefense(day)), "against the day's defense");
  // A CARD has one roll a day, whoever fields it, wherever, in whatever finish. Seeding the roll from the whole
  // lineup (as this first shipped) made the finish and the Flex order a luck re-roll: the same six cards scored
  // 781.8 or 807 by swapping the Flexes, and anywhere from 693 to 891 across finish combinations - so the best
  // play was grinding copies offline, and a Base could beat a Prism by dozens. Found in review, 2026-11-13.
  const rollOf = (res, id) => res.cards.find((c) => c.id === id).roll;
  const flipped = C.showdownScore(day, { ...good, FLEX1: good.FLEX2, FLEX2: good.FLEX1 });
  eq(flipped.score, s1.score, "swapping the two Flex cards changes nothing");
  for (const [finish, pts] of [["silver", 1], ["gold", 2], ["prism", 3]]) {
    const up = C.showdownScore(day, { ...good, QB: { ...good.QB, finish } });
    eq(+(up.score - s1.score).toFixed(1), pts, `in the showdown ${finish} is worth exactly ${pts}, never a re-roll`);
  }
  const otherRb = byRating.find((c) => c.pos === "RB" && !Object.values(good).some((e) => C.CARDS.get(e.id).pid === c.pid));
  const subbed = C.showdownScore(day, { ...good, RB: { id: otherRb.id, finish: "base" } });
  ok(SLOTS.filter((s) => s !== "RB").every((s) => rollOf(subbed, good[s].id) === rollOf(s1, good[s].id)), "changing one card leaves the other five rolls alone");
  ok(new Set(s1.cards.map((c) => c.roll)).size > 3, "the six cards do not all roll alike");
  ok(rollOf(C.showdownScore("2026-11-14", good), good.QB.id) !== rollOf(s1, good.QB.id) || rollOf(C.showdownScore("2026-11-15", good), good.QB.id) !== rollOf(s1, good.QB.id), "and a card's roll changes from day to day");
  { let n = 0; const r = C.showdownRand(day, good); for (let i = 0; i < 12; i++) { const v = r(); if (v >= 0 && v < 1) n++; } eq(n, 12, "the showdown hands scoreBattle its twelve draws"); }
  const days = Array.from({ length: 200 }, (_, i) => C.showdownDefense(`2027-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}x${i}`).key);
  ok(new Set(days).size > 150, `days draw different defenses (${new Set(days).size} of 200)`);

  // Engine independence: 2,000 seeded battles, one number.
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum = (sum + Math.round(C.scoreBattle(good, C.DEFENSES[i % C.DEFENSES.length], mulberry32(i)).offense * 10)) >>> 0;
  if (sum !== PINNED_CHECKSUM) console.log(`battle checksum is ${sum}`);
  eq(sum, PINNED_CHECKSUM, "2,000 battles roll the same everywhere");
}

console.log(fails ? `\n${fails} FAILED` : "card logic: all checks passed");
process.exit(fails ? 1 : 0);
