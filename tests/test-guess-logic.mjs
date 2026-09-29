// Guess the Player's rules, with no browser and no database: guess-logic.mjs is pure, so everything the game
// promises can be checked by playing it.
//
// The one that matters most is at the bottom: a row of five greens has to MEAN the guess is the answer. That is
// a property of the pool, not of the comparison - if two players shared a team, division, position, draft class
// and number, a solved row would be a lie and the game would be unwinnable on those days.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initGameData, TEAMS } from "../game-logic.mjs";
import {
  initGuessData, GUESS_PLAYERS, GUESS_BY_ID, GUESS_BANDS, guessBand, guessDifficulty, guessCycleLength, GUESS_TRIES, GUESS_COLUMNS, DIVISIONS, DRAFT_NEAR, NUMBER_NEAR,
  conferenceOf, guessId, guessPlayer, compareGuess, isGuessSolved, guessAnswerFor, guessAnswerForSeed,
  guessDayNumber, guessDailySeed, replayGuessGame, guessOutcome, GUESS_DAY_ONE,
} from "../guess-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
const players = read("data/players.json");
initGameData(players.players, players.opponents);
const pool = read("data/guess-pool.json");
const info = initGuessData(pool);

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.error(`FAIL  ${what}`); } };
const eq = (a, b, what) => ok(a === b, `${what} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);
const find = (name) => GUESS_PLAYERS.find((p) => p.name === name);

// ---------- 1. The pool ----------
console.log(`pool: ${info.players} players, ${info.teams} teams, ${info.positions} positions`);
ok(GUESS_PLAYERS.length > 400, `enough players for a daily that does not come round quickly: ${GUESS_PLAYERS.length}`);
for (const p of GUESS_PLAYERS) {
  ok(TEAMS[p.team], `${p.name}'s team is one the game knows: ${p.team}`);
  ok(DIVISIONS[p.team], `${p.team} has a division`);
  ok(p.number >= 0 && p.number <= 99, `${p.name} wears a real number: ${p.number}`);
  ok(p.draft >= 1936 && p.draft <= 2100, `${p.name} has a real draft class: ${p.draft}`);
  ok(p.side, `${p.name} (${p.group}) is on a side of the ball`);
}
eq(new Set(GUESS_PLAYERS.map((p) => p.id)).size, GUESS_PLAYERS.length, "every id is unique");
eq(Object.keys(GUESS_BY_ID).length, GUESS_PLAYERS.length, "and every one is reachable by id");
// The id's shape is what makes it stable across a rebuild - not the row's position in the file.
const sample = GUESS_PLAYERS[0];
eq(guessId(sample), `${sample.name}|${sample.draft}|${sample.pos}`, "an id is name, draft class and position");
// Every division has teams, and every team exactly one division.
eq(new Set(Object.values(DIVISIONS)).size, 8, "eight divisions");
eq(Object.keys(DIVISIONS).length, 32, "thirty-two teams placed");
for (const t of Object.keys(TEAMS)) ok(DIVISIONS[t], `${t} is in a division`);
// Both sides of the ball are really represented - the reason this pool exists at all.
const bySide = {};
for (const p of GUESS_PLAYERS) bySide[p.side] = (bySide[p.side] || 0) + 1;
console.log(`  sides: ${Object.entries(bySide).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
ok(bySide.defence > GUESS_PLAYERS.length * 0.3, `the pool is not another offence-only list: ${bySide.defence} defenders`);

// ---------- 2. Comparing ----------
const P = (over) => ({ name: "X", team: "KC", division: DIVISIONS.KC, pos: "CB", group: "DB", side: "defence", draft: 2015, number: 24, ...over });
const answer = P();
const of = (over) => compareGuess(P(over), answer);

eq(of({}).team.state, "hit", "the same team is green");
eq(of({ team: "DEN", division: DIVISIONS.DEN }).team.state, "miss", "a different team is grey, even in the division");
// The division column: same division green, same conference yellow, otherwise grey.
eq(of({ team: "DEN", division: "AFC West" }).division.state, "hit", "the same division is green");
eq(of({ team: "BUF", division: "AFC East" }).division.state, "near", "the same conference is yellow");
eq(of({ team: "DAL", division: "NFC East" }).division.state, "miss", "the other conference is grey");

eq(of({}).pos.state, "hit", "the same position is green");
eq(of({ pos: "S", group: "DB", side: "defence" }).pos.state, "near", "another defender is yellow");
eq(of({ pos: "DE", group: "DL", side: "defence" }).pos.state, "near", "any defender, not just the same group");
eq(of({ pos: "WR", group: "WR", side: "offence" }).pos.state, "miss", "an offensive player is grey");
eq(of({ pos: "K", group: "SPEC", side: "special" }).pos.state, "miss", "a specialist is grey");

eq(of({ draft: 2015 }).draft.state, "hit", "the same draft class is green");
eq(of({ draft: 2015 - DRAFT_NEAR }).draft.state, "near", `${DRAFT_NEAR} years early is yellow`);
eq(of({ draft: 2015 + DRAFT_NEAR }).draft.state, "near", `${DRAFT_NEAR} years late is yellow`);
eq(of({ draft: 2015 - DRAFT_NEAR - 1 }).draft.state, "miss", "a year further is grey");
eq(of({ draft: 2013 }).draft.hint, "up", "an earlier guess points up");
eq(of({ draft: 2017 }).draft.hint, "down", "a later guess points down");
eq(of({ draft: 2015 }).draft.hint, undefined, "the right year has no arrow");

eq(of({ number: 24 }).number.state, "hit", "the same number is green");
eq(of({ number: 24 - NUMBER_NEAR }).number.state, "near", `${NUMBER_NEAR} below is yellow`);
eq(of({ number: 24 + NUMBER_NEAR }).number.state, "near", `${NUMBER_NEAR} above is yellow`);
eq(of({ number: 24 + NUMBER_NEAR + 1 }).number.state, "miss", "one further is grey");
eq(of({ number: 1 }).number.hint, "up", "a lower number points up");
eq(of({ number: 99 }).number.hint, "down", "a higher number points down");

ok(isGuessSolved(of({})), "the answer itself is solved");
for (const col of GUESS_COLUMNS) {
  const wrong = { team: { team: "DEN", division: "AFC West" }, division: { team: "DAL", division: "NFC East" },
    pos: { pos: "WR", group: "WR", side: "offence" }, draft: { draft: 1999 }, number: { number: 70 } }[col];
  ok(!isGuessSolved(of(wrong)), `a wrong ${col} is not solved`);
}
ok(!compareGuess(null, answer) && !compareGuess(P(), null), "nothing compares to nothing");

// ---------- 3. The daily ----------
const dayOne = guessAnswerFor(GUESS_DAY_ONE);
ok(dayOne, "day one has an answer");
eq(guessDayNumber(GUESS_DAY_ONE), 0, "day one is day zero");
eq(guessDayNumber("2026-09-15"), 1, "the next day is one");
eq(guessAnswerFor(GUESS_DAY_ONE).id, dayOne.id, "the same date always gives the same player");
eq(guessDailySeed("2026-09-28"), "guess-2026-09-28", "the daily's seed names its date");
// THE rules for a daily (v2.14.0): it walks a weighted cycle. Everybody is in it, the best-known several times,
// and NOBODY comes round twice inside a year - which is the rule the weighting could have broken and the reason
// the cycle spaces a player's turns instead of shuffling three passes together.
{
  const cycle = guessCycleLength();
  const seen = new Map();
  const lastSeen = new Map();
  let closest = Infinity;
  const bands = {};
  for (let d = 0; d < cycle; d++) {
    const a = guessAnswerFor(new Date(Date.UTC(2026, 8, 14) + d * 86400000).toISOString().slice(0, 10));
    seen.set(a.id, (seen.get(a.id) || 0) + 1);
    bands[guessBand(a)] = (bands[guessBand(a)] || 0) + 1;
    if (lastSeen.has(a.id)) closest = Math.min(closest, d - lastSeen.get(a.id));
    lastSeen.set(a.id, d);
  }
  console.log(`  a ${cycle}-day cycle: ${Object.entries(bands).map(([b, n]) => `${b} ${n}`).join(" · ")}`);
  eq(seen.size, GUESS_PLAYERS.length, "every player in the pool gets asked");
  ok(cycle > GUESS_PLAYERS.length, `the cycle is longer than the pool, because the best known repeat: ${cycle}`);
  ok(closest > 300, `nobody is asked twice inside a year: closest ${closest} days apart`);
  // The weighting itself: an easy player comes up oftener than a deep cut, which is the whole point of bands.
  const easy = GUESS_PLAYERS.filter((p) => guessBand(p) === "easy");
  const hard = GUESS_PLAYERS.filter((p) => guessBand(p) === "hard");
  const turnsFor = (list) => list.reduce((n, p) => n + (seen.get(p.id) || 0), 0) / list.length;
  ok(turnsFor(easy) > turnsFor(hard) * 2, `the best known are asked about oftener: ${turnsFor(easy).toFixed(1)} turns each against ${turnsFor(hard).toFixed(1)}`);
  eq(GUESS_BANDS.reduce((n, b) => n + b.share, 0), 1, "the bands cover the whole pool");
  // And the day after the cycle is day one's answer again, not a gap.
  const wrapped = guessAnswerFor(new Date(Date.UTC(2026, 8, 14) + cycle * 86400000).toISOString().slice(0, 10));
  eq(wrapped.id, dayOne.id, "the cycle wraps rather than running out");
}

// How hard the day was, which the end screen prints once the game is over. A place in the ranking rather than
// the raw score: the scores sit in a narrow band and "61 out of 100" would tell nobody anything.
{
  const order = [...GUESS_PLAYERS].sort((a, b) => b.score - a.score);
  eq(guessDifficulty(order[0]), 0, `the best-known player is difficulty 0: ${order[0].name}`);
  eq(guessDifficulty(order[order.length - 1]), 100, `and the deepest cut is 100: ${order[order.length - 1].name}`);
  eq(guessDifficulty({ id: "nobody" }), null, "somebody who is not in the pool has no difficulty");
  const mid = guessDifficulty(order[Math.floor(order.length / 2)]);
  ok(mid > 40 && mid < 60, `the middle of the pool is the middle of the scale: ${mid}`);
  ok(GUESS_PLAYERS.every((p) => typeof p.score === "number" && p.score > 0),
    "every player carries the score the pool was chosen by");
}
// Dates before launch resolve rather than throwing.
ok(guessAnswerFor("2020-01-01"), "a date before day one still has an answer");
// A practice code is seeded and spreads over the pool.
eq(guessAnswerForSeed("ABCD1234").id, guessAnswerForSeed("ABCD1234").id, "a code always gives the same player");
{
  const picks = new Set();
  for (let i = 0; i < 300; i++) picks.add(guessAnswerForSeed(`code-${i}`).id);
  // 300 codes over a pool of a few hundred collide by birthday alone; what matters is that they spread.
  ok(picks.size > 200, `codes spread over the pool (${picks.size} different in 300)`);
}

// ---------- 4. Replaying a game ----------
const brady = find("Tom Brady");
const mahomes = find("Patrick Mahomes");
ok(brady && mahomes, "the pool holds the players these cases name");
const dayFor = (id) => {
  for (let d = 0; d < GUESS_PLAYERS.length; d++) {
    const date = new Date(Date.UTC(2026, 8, 14) + d * 86400000).toISOString().slice(0, 10);
    if (guessAnswerFor(date).id === id) return date;
  }
  return null;
};
const bradyDay = dayFor(brady.id);
ok(bradyDay, "every player has a day of their own");
{
  const r = replayGuessGame({ date: bradyDay, guesses: [mahomes.id, brady.id] });
  ok(r.ok, `a legal game replays (${r.reason || "ok"})`);
  eq(r.solved, true, "and it was solved");
  eq(r.tries, 2, "in two");
  eq(r.answer.id, brady.id, "against the day's own answer");
  eq(r.rows.length, 2, "with a row per guess");
  ok(!isGuessSolved(r.rows[0].row) && isGuessSolved(r.rows[1].row), "the last row is the winning one");
}
{
  const misses = GUESS_PLAYERS.filter((p) => p.id !== brady.id).slice(0, GUESS_TRIES).map((p) => p.id);
  const r = replayGuessGame({ date: bradyDay, guesses: misses });
  ok(r.ok, `a game that runs out replays (${r.reason || "ok"})`);
  eq(r.solved, false, "and was not solved");
  eq(r.tries, GUESS_TRIES, `after all ${GUESS_TRIES}`);
}

// Every refusal.
const refuse = (game, reason, what) => {
  const r = replayGuessGame(game);
  ok(!r.ok && r.reason === reason, `${what} -> ${reason} (got ${r.ok ? "accepted" : r.reason})`);
};
refuse({ date: bradyDay }, "bad_guesses", "no guesses at all");
refuse({ date: bradyDay, guesses: [] }, "no_guesses", "an empty game");
refuse({ date: bradyDay, guesses: new Array(GUESS_TRIES + 1).fill(0).map((_, i) => GUESS_PLAYERS[i].id) }, "too_many", `${GUESS_TRIES + 1} guesses`);
refuse({ date: bradyDay, guesses: [mahomes.id, mahomes.id] }, "repeat_guess", "the same player twice");
refuse({ date: bradyDay, guesses: ["Nobody At All|2015|QB"] }, "unknown_player", "a player who does not exist");
refuse({ date: bradyDay, guesses: [7] }, "bad_guess", "a guess that is not an id");
refuse({ date: bradyDay, guesses: [brady.id, mahomes.id] }, "guessed_past_the_end", "guessing on after solving it");
refuse({ guesses: [brady.id] }, "no_answer", "no date and no seed");

// ---------- 5. Five greens has to mean it ----------
// The property the whole game rests on. If a row could go all green without being the answer, the screen would
// say you had won while the server said you had not.
//
// Checked across the WHOLE pool rather than sampled, because one collision is enough to break a day. Ranking the
// pool down to a few hundred makes a clash rare, and the builder still refuses to write one nobody has decided
// by hand.
{
  const key = (p) => `${p.team}|${p.pos}|${p.draft}|${p.number}`;
  const byKey = new Map();
  for (const p of GUESS_PLAYERS) {
    const k = key(p);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(p);
  }
  const clashes = [...byKey.values()].filter((v) => v.length > 1);
  if (clashes.length) {
    console.error(`FAIL  five greens does not identify a player: ${clashes.length} clash(es)`);
    for (const c of clashes.slice(0, 5)) console.error(`        ${c.map((p) => `${p.name} (${p.pos} #${p.number} ${p.draft} ${p.team})`).join("  ==  ")}`);
    fails++;
  } else {
    console.log("  five greens identifies exactly one player, across the whole pool");
  }
}

// ---------- 5b. Who is in the game ----------
// The pool is a RANKING now, not a filter (v2.14.0): the best known at each position, two and a half times over
// for anyone starting in the last three seasons. These are the properties that ranking has to keep, and the
// first two are the two halves of the complaint that caused it - the daily was asking about men nobody could
// place while refusing to ask about the players everybody has just watched.
{
  ok(GUESS_PLAYERS.length > 400 && GUESS_PLAYERS.length < 1200,
    `the pool is a few hundred well-known players, not thousands: ${GUESS_PLAYERS.length}`);
  // The recent ones. Every one of these was refused by the five-season rule this replaced.
  for (const name of ["Jayden Daniels", "Brock Bowers", "C.J. Stroud", "Puka Nacua", "Caleb Williams",
    "Bijan Robinson", "Ashton Jeanty", "Cam Ward", "Marvin Harrison Jr."]) {
    ok(find(name), `${name} is in the game`);
  }
  // And the ones no ranking may lose, or it is ranking the wrong thing.
  for (const name of ["Tom Brady", "Peyton Manning", "Ray Lewis", "Randy Moss", "Adrian Peterson", "Aaron Donald",
    "Troy Aikman", "Eli Manning", "Charles Tillman", "Jordy Nelson", "Travis Kelce"]) {
    ok(find(name), `${name} is in the game`);
  }
  // Every position group is a real possibility, or the position column stops meaning anything - and a share of
  // each group is exactly how the pool is chosen, so this is the rule rather than a coincidence.
  for (const g of ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "SPEC"]) {
    const n = GUESS_PLAYERS.filter((p) => p.group === g).length;
    ok(n >= 15, `${g} is a real possibility: ${n}`);
  }
  // Every team can come up, or the team column is a lie on the days nobody from that team can be the answer.
  eq(new Set(GUESS_PLAYERS.map((p) => p.team)).size, 32, "all 32 teams can be the answer's");
  // The recency bias, measured rather than asserted: about half the game is people playing now and the rest is
  // its history. Both halves are the point.
  const recent = GUESS_PLAYERS.filter((p) => p.to >= 2024).length;
  ok(recent > GUESS_PLAYERS.length * 0.35 && recent < GUESS_PLAYERS.length * 0.8,
    `recent players are a bias, not the whole game: ${recent} of ${GUESS_PLAYERS.length}`);
  console.log(`  ${recent} of ${GUESS_PLAYERS.length} played in the last three seasons`);
  // Nobody wears a number the game does not know. nflverse writes 0 for "unknown", and 0 was not a legal number
  // before 2023 - 88 players in the first pool wore a #0 they never wore, Aqib Talib among them.
  const fake = GUESS_PLAYERS.filter((p) => p.number === 0 && p.to < 2023);
  eq(fake.length, 0, `no player carries a jersey number that is really a missing value: ${fake.map((p) => p.name).join(", ")}`);
}

// ---------- 6. How hard is it? ----------
// A bot that guesses at random, to show the game is not solvable by luck and not impossible either. It is a
// floor, not a target: a real player uses the colours, which is the entire game.
{
  let rng = 1;
  const rand = () => { rng = (rng * 1664525 + 1013904223) % 4294967296; return rng / 4294967296; };
  let solved = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const a = GUESS_PLAYERS[Math.floor(rand() * GUESS_PLAYERS.length)];
    const tried = new Set();
    for (let t = 0; t < GUESS_TRIES; t++) {
      let g; do { g = GUESS_PLAYERS[Math.floor(rand() * GUESS_PLAYERS.length)]; } while (tried.has(g.id));
      tried.add(g.id);
      if (g.id === a.id) { solved++; break; }
    }
  }
  console.log(`  a bot guessing blind solves ${((100 * solved) / N).toFixed(2)}% of games in ${GUESS_TRIES}`);
  ok(solved / N < 0.02, "blind guessing is not a strategy");
}

eq(guessOutcome(true, 1), "Got it first guess.", "a first-guess win reads as one");
eq(guessOutcome(true, 4), "Got it in 4.", "and so does a fourth");
eq(guessOutcome(false, GUESS_TRIES), `Missed. ${GUESS_TRIES} guesses.`, "a loss says so");

console.log(fails ? `\n${fails} FAILED` : "\nall guess rules pass");
process.exit(fails ? 1 : 0);
