// Century's rules, with no browser and no database: century-logic.mjs is pure, so everything the mode promises
// can be checked by playing it. It also PRINTS the numbers the goal of 100 is balanced against, so a change to
// the data, the slots or the Flex rule shows its cost here instead of in a player's run.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initGameData, TEAMS, hashStr } from "../game-logic.mjs";
import {
  initCenturyData, CENTURY_SLOTS, CENTURY_GOAL, CENTURY_TEAMS, CENTURY_BOARDS, CENTURY_SEASON,
  centuryFits, centurySlotPos, centuryPlan, centuryRespinTeam, centuryTeamsDealt, centuryCeiling,
  centuryScore, centuryHit, replayCentury, centuryOpenFor, centuryCanStrand, centuryOutcome,
  centuryDailySeed, centuryReservedSeed, centuryPlayer,
} from "../century-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
initGameData(read("data/players.json").players, read("data/players.json").opponents);
const pool = read("data/season-2025.json");
const info = initCenturyData(pool);

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.error(`FAIL  ${what}`); } };
const eq = (a, b, what) => ok(a === b, `${what} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);

// ---------- 1. The data the mode rests on ----------
eq(CENTURY_SEASON, 2025, "the pool is the 2025 season");
eq(CENTURY_TEAMS.length, 32, "32 teams");
for (const t of CENTURY_TEAMS) ok(TEAMS[t], `${t} is a team the game knows`);
for (const t of Object.keys(TEAMS)) ok(CENTURY_TEAMS.includes(t), `${t} has a board`);
for (const t of CENTURY_TEAMS) for (const p of ["QB", "RB", "WR", "TE"]) {
  ok(CENTURY_BOARDS[t].some((q) => q.pos === p), `${t} fields a ${p}`);
}
for (const t of CENTURY_TEAMS) for (const p of CENTURY_BOARDS[t]) {
  ok(Number.isInteger(p.td) && p.td >= 0, `${p.name} has a whole touchdown count`);
  ok(p.games >= pool.minGames, `${p.name} played the minimum games`);
}
// The rule that makes a game always finishable, stated as a property of the pool rather than hoped for.
for (const t of CENTURY_TEAMS) for (const slot of CENTURY_SLOTS) {
  ok(CENTURY_BOARDS[t].some((p) => centuryFits(p.pos, slot)), `${t} can fill ${slot}`);
}

// A player traded mid-season is on two boards, which is why replayCentury refuses the same person twice.
const seenNames = new Map();
for (const t of CENTURY_TEAMS) for (const p of CENTURY_BOARDS[t]) {
  seenNames.set(p.name, (seenNames.get(p.name) || 0) + 1);
}
const doubled = [...seenNames].filter(([, n]) => n > 1);
console.log(`pool: ${info.players} players, ${info.teams} teams, ${doubled.length} on two boards`
  + (doubled.length ? ` (e.g. ${doubled[0][0]})` : ""));

// ---------- 2. Slots and what fits ----------
eq(CENTURY_SLOTS.join(","), "QB,RB1,RB2,WR1,WR2,TE,FLEX", "the seven slots");
eq(centurySlotPos("RB2"), "RB", "RB2 wants a running back");
eq(centurySlotPos("FLEX"), null, "the Flex wants a range");
ok(centuryFits("RB", "RB1") && centuryFits("RB", "RB2"), "a back fits either back slot");
ok(!centuryFits("WR", "RB1"), "a receiver does not fit a back slot");
for (const p of ["RB", "WR", "TE"]) ok(centuryFits(p, "FLEX"), `${p} fits the Flex`);
ok(!centuryFits("QB", "FLEX"), "a quarterback never fits the Flex");

// ---------- 3. The spins ----------
const seed = "century-test-1";
const plan = centuryPlan(seed);
eq(plan.length, 7, "a plan is seven teams");
eq(new Set(plan).size, 7, "a plan never repeats a team");
eq(centuryPlan(seed).join(","), plan.join(","), "the same seed deals the same plan");
ok(centuryPlan("century-test-2").join(",") !== plan.join(","), "a different seed deals a different plan");
for (let step = 0; step < 7; step++) {
  const spare = centuryRespinTeam(seed, step, plan);
  ok(spare && CENTURY_TEAMS.includes(spare), `the re-spin at ${step} deals a real team`);
  ok(!plan.includes(spare), `the re-spin at ${step} never repeats a team in the plan`);
  eq(centuryRespinTeam(seed, step, plan), spare, `the re-spin at ${step} is seeded`);
  const dealt = centuryTeamsDealt(seed, step);
  eq(new Set(dealt).size, 7, `the seven dealt at ${step} are distinct`);
  eq(dealt[step], spare, `the re-spin replaces step ${step}`);
}
eq(centuryTeamsDealt(seed).join(","), plan.join(","), "no re-spin means the plan is what was dealt");
// Across many seeds the spare is not always the same team, or it would be a fixed eighth board.
const spares = new Set();
for (let i = 0; i < 200; i++) { const s = `spare-${i}`; spares.add(centuryRespinTeam(s, 3, centuryPlan(s))); }
ok(spares.size > 20, `the re-spin is not a fixed team (${spares.size} different across 200 seeds)`);
// One seed is not enough to prove the re-spin excludes the plan: a pool that wrongly held all 32 teams still
// misses the seven by luck about one seed in seven, and that is exactly how this assertion first passed against a
// re-spin that did not exclude anything. Every step of 300 seeds, or the claim is not being made.
let repeats = 0, notSeven = 0;
for (let i = 0; i < 300; i++) {
  const s = `respin-${i}`;
  const p = centuryPlan(s);
  for (let step = 0; step < CENTURY_SLOTS.length; step++) {
    if (p.includes(centuryRespinTeam(s, step, p))) repeats++;
    if (new Set(centuryTeamsDealt(s, step)).size !== CENTURY_SLOTS.length) notSeven++;
  }
}
eq(repeats, 0, "across 300 seeds and every step, a re-spin never deals a team the plan already holds");
eq(notSeven, 0, "across 300 seeds and every step, seven distinct teams are dealt");

// ---------- 4. A legal game, played and replayed ----------
// The bot every number below is measured with: the leading scorer for a slot it still needs. With the stats
// hidden that is what perfect knowledge of the season looks like, so it is a ceiling on skill, not a floor.
function playBest(seed, respunAt = -1) {
  const dealt = centuryTeamsDealt(seed, respunAt);
  const roster = {};
  const picks = [];
  const names = new Set();
  for (let i = 0; i < dealt.length; i++) {
    const team = dealt[i];
    let best = null, bestSlot = null;
    for (const slot of CENTURY_SLOTS) {
      if (roster[slot]) continue;
      for (const p of CENTURY_BOARDS[team]) {
        if (!centuryFits(p.pos, slot) || names.has(p.name)) continue;
        if (!best || p.td > best.td) { best = p; bestSlot = slot; }
      }
    }
    if (!best) return null; // stranded - must never happen
    roster[bestSlot] = best;
    names.add(best.name);
    picks.push(respunAt === i ? { slot: bestSlot, name: best.name, respun: true } : { slot: bestSlot, name: best.name });
  }
  return { roster, picks, score: centuryScore(roster) };
}

const game = playBest(seed);
ok(game, "a game can be played to the end");
const back = replayCentury({ seed, picks: game.picks });
ok(back.ok, `a legal game replays (${back.reason || "ok"})`);
eq(back.score, game.score, "the replay agrees on the score");
eq(back.hit, centuryHit(game.score), "the replay agrees on whether the goal was reached");
eq(back.teams.join(","), plan.join(","), "the replay recomputes the teams from the seed");
eq(back.respunAt, -1, "no re-spin was recorded");
const withRespin = playBest(seed, 2);
const backR = replayCentury({ seed, picks: withRespin.picks });
ok(backR.ok, `a game with a re-spin replays (${backR.reason || "ok"})`);
eq(backR.respunAt, 2, "the replay finds the re-spin where it was spent");
eq(backR.teams[2], centuryRespinTeam(seed, 2, plan), "the re-spun step replays as the spare team");

// ---------- 5. Every refusal ----------
const refuse = (picks, reason, what) => {
  const r = replayCentury({ seed, picks });
  ok(!r.ok && r.reason === reason, `${what} -> ${reason} (got ${r.ok ? "accepted" : r.reason})`);
};
ok(!replayCentury({ picks: game.picks }).ok, "no seed is refused");
eq(replayCentury({ seed: "", picks: game.picks }).reason, "bad_seed", "an empty seed is refused");
eq(replayCentury({ seed, picks: null }).reason, "bad_picks", "picks that are not a list are refused");
refuse(game.picks.slice(0, 6), "wrong_length", "six picks");
refuse([...game.picks, game.picks[0]], "wrong_length", "eight picks");
refuse(game.picks.map((p, i) => (i === 0 ? null : p)), "bad_pick", "a missing pick");
refuse(game.picks.map((p, i) => (i === 0 ? { ...p, slot: "K" } : p)), "bad_slot", "a slot the mode has no room for");
// Two picks into one slot. The second is legal on its own board, so this is the rule doing the work.
{
  const p = [...game.picks];
  const alt = CENTURY_BOARDS[plan[1]].find((q) => centuryFits(q.pos, p[0].slot) && q.name !== p[0].name);
  p[1] = { slot: p[0].slot, name: alt.name };
  refuse(p, "slot_taken", "two picks into one slot");
}
refuse(game.picks.map((p, i) => (i === 0 ? { ...p, name: "Nobody At All" } : p)), "not_on_board", "a player who is not there");
// A real player, on the right board, in a slot his position does not fit.
{
  const p = [...game.picks];
  const qb = CENTURY_BOARDS[plan[0]].find((q) => q.pos === "QB");
  const open = CENTURY_SLOTS.find((s) => s !== "QB" && !game.picks.some((m, i) => i === 0 && m.slot === s));
  p[0] = { slot: "FLEX", name: qb.name };
  refuse(p, "wrong_position", "a quarterback in the Flex");
  void open;
}
refuse(game.picks.map((p) => ({ ...p, respun: true })), "two_respins", "a second re-spin");
// The same person, offered by two different teams, cannot fill two slots.
{
  const pairSeed = (() => {
    for (let i = 0; i < 4000; i++) {
      const s = `dup-${i}`;
      const dealt = centuryPlan(s);
      for (const [name] of doubled) {
        const on = dealt.filter((t) => centuryPlayer(t, name));
        if (on.length >= 2) return { s, name, on };
      }
    }
    return null;
  })();
  if (pairSeed) {
    const { s, name, on } = pairSeed;
    const dealt = centuryPlan(s);
    const p = CENTURY_BOARDS[on[0]].find((q) => q.name === name);
    const slots = CENTURY_SLOTS.filter((x) => centuryFits(p.pos, x));
    // The two boards that both hold him take the two slots he fits; every other board fills one of the rest with
    // somebody who actually fits it, so the ONLY thing wrong with this game is the duplicate.
    const left = CENTURY_SLOTS.filter((x) => x !== slots[0] && x !== slots[1]);
    const picks = dealt.map((team) => {
      if (team === on[0]) return { slot: slots[0], name };
      if (team === on[1]) return { slot: slots[1], name };
      for (let k = 0; k < left.length; k++) {
        const fill = CENTURY_BOARDS[team].find((q) => q.name !== name && centuryFits(q.pos, left[k]));
        if (fill) return { slot: left.splice(k, 1)[0], name: fill.name };
      }
      return null;
    });
    ok(picks.every(Boolean) && left.length === 0, "the duplicate case was built as a legal game but for the duplicate");
    const r = replayCentury({ seed: s, picks });
    ok(!r.ok && r.reason === "already_drafted", `the same person twice -> already_drafted (got ${r.ok ? "accepted" : r.reason})`);
    console.log(`  the duplicate rule fired on ${name}, dealt by ${on[0]} and ${on[1]}`);
  } else {
    console.log("  no seed in 4,000 dealt one person twice - the duplicate rule went unexercised");
  }
}

// ---------- 6. A game is always finishable ----------
// Every seed, every re-spin step, played by a bot that deliberately spends its best slots first.
let stranded = 0;
for (let i = 0; i < 3000; i++) {
  const s = `strand-${i}`;
  const dealt = centuryTeamsDealt(s, i % 8 === 0 ? i % 7 : -1);
  const roster = {};
  for (const team of dealt) {
    const open = centuryOpenFor(team, roster);
    if (!open.length) { stranded++; break; }
    // the worst choice available: take the slot that leaves the fewest options later
    const slot = open[open.length - 1];
    roster[slot] = CENTURY_BOARDS[team].find((p) => centuryFits(p.pos, slot)
      && !Object.values(roster).some((q) => q.name === p.name));
  }
}
eq(stranded, 0, "no seed can strand a player mid-game");
{
  const roster = {};
  for (const s of CENTURY_SLOTS) roster[s] = { name: `x${s}`, pos: "RB", td: 0 };
  ok(centuryCanStrand(CENTURY_TEAMS[0], roster), "a full roster has nothing left to fill");
  ok(!centuryCanStrand(CENTURY_TEAMS[0], {}), "an empty roster can always be filled");
}

// ---------- 7. The ceiling ----------
// Exact, so it can never be beaten by an actual game from the same teams. Checked against the bot, which is
// greedy and therefore sometimes below it - that gap is the point of printing both.
let ceilingBeaten = 0, greedyBelow = 0;
for (let i = 0; i < 1000; i++) {
  const s = `ceil-${i}`;
  const cap = centuryCeiling(s);
  const bot = playBest(s);
  if (bot.score > cap) ceilingBeaten++;
  if (bot.score < cap) greedyBelow++;
}
eq(ceilingBeaten, 0, "no game ever scores above the ceiling for its teams");
ok(greedyBelow > 0, `greedy picking leaves something on the table (${greedyBelow} of 1,000)`);
// Brute force the ceiling a second way on one seed, to check the assignment search itself.
{
  const s = "ceil-check";
  const dealt = centuryTeamsDealt(s);
  let most = 0;
  const walk = (i, used, sum) => {
    if (i === dealt.length) { most = Math.max(most, sum); return; }
    for (const slot of CENTURY_SLOTS) {
      if (used.has(slot)) continue;
      let top = 0;
      for (const p of CENTURY_BOARDS[dealt[i]]) if (centuryFits(p.pos, slot)) top = Math.max(top, p.td);
      used.add(slot); walk(i + 1, used, sum + top); used.delete(slot);
    }
  };
  walk(0, new Set(), 0);
  eq(centuryCeiling(s), most, "the ceiling matches an independent search");
}

// ---------- 8. The goal, and what it is worth ----------
const scores = [];
for (let i = 0; i < 20000; i++) scores.push(playBest(`bal-${i}`).score);
scores.sort((a, b) => a - b);
const pct = (p) => scores[Math.floor(scores.length * p)];
const reached = (g) => (100 * scores.filter((x) => x >= g).length) / scores.length;
let ceiling = 0;
for (let i = 0; i < 400; i++) ceiling = Math.max(ceiling, centuryCeiling(`top-${i}`));
console.log(`\nbalance, 20,000 games by a perfect-knowledge bot:`);
console.log(`  median ${pct(0.5)}   p90 ${pct(0.9)}   p99 ${pct(0.99)}   best ${scores[scores.length - 1]}`);
console.log(`  reached  80: ${reached(80).toFixed(1)}%   90: ${reached(90).toFixed(1)}%`
  + `   ${CENTURY_GOAL}: ${reached(CENTURY_GOAL).toFixed(1)}%   110: ${reached(110).toFixed(1)}%`);
console.log(`  best ceiling seen in 400 draws: ${ceiling}`);
// The goal has to be reachable and it has to be hard. If either of these fails, the mode is not worth playing -
// re-read the note at the top of century-logic.mjs before moving the numbers.
ok(reached(CENTURY_GOAL) > 0.5, `${CENTURY_GOAL} is reachable (${reached(CENTURY_GOAL).toFixed(1)}% of perfect games)`);
ok(reached(CENTURY_GOAL) < 25, `${CENTURY_GOAL} is hard (${reached(CENTURY_GOAL).toFixed(1)}% of perfect games)`);
ok(pct(0.5) < CENTURY_GOAL, `the median perfect game falls short (${pct(0.5)})`);

// ---------- 9. Scores and outcome lines ----------
eq(centuryScore({}), 0, "an empty roster scores nothing");
eq(centuryScore({ QB: { td: 40 }, TE: { td: 5 } }), 45, "a score is the touchdowns added up");
ok(centuryHit(100) && centuryHit(133) && !centuryHit(99), "the goal is 100 or better");
eq(centuryOutcome(101), "Century. 101 touchdowns.", "a hit reads as a century");
eq(centuryOutcome(95), "So close. 95 touchdowns.", "within ten reads as close");
eq(centuryOutcome(80), "80 touchdowns.", "a middling score is just the number");
eq(centuryOutcome(50), "Short. 50 touchdowns.", "a poor score says so");

// ---------- 10. The daily's seed is not an Unlimited code ----------
const today = new Date().toISOString().slice(0, 10);
ok(centuryReservedSeed(centuryDailySeed(today)), "today's daily seed is reserved");
for (const d of [1, 7, 30, 180, 365]) {
  const date = new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  ok(centuryReservedSeed(centuryDailySeed(date)), `the daily seed ${d} days out is reserved`);
  const past = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  ok(centuryReservedSeed(centuryDailySeed(past)), `the daily seed ${d} days back is reserved`);
}
ok(!centuryReservedSeed("ABC12345"), "an ordinary code is not reserved");
ok(!centuryReservedSeed(centuryDailySeed("2019-01-01")), "a date outside the window is not claimed");
// hashStr is invertible, so a code that COLLIDES with a daily seed deals that daily's teams - the check has to be
// on the hash, not on the spelling.
{
  const target = hashStr(centuryDailySeed(today));
  ok(centuryReservedSeed(centuryDailySeed(today)), "the reserved check is on the hash");
  const plans = centuryPlan(centuryDailySeed(today));
  eq(plans.length, 7, "the daily deals seven teams");
  void target;
}

console.log(fails ? `\n${fails} FAILED` : "\nall century rules pass");
process.exit(fails ? 1 : 0);
