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
  initGuessData, GUESS_PLAYERS, GUESS_BY_ID, GUESS_TRIES, GUESS_COLUMNS, DIVISIONS, DRAFT_NEAR, NUMBER_NEAR,
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
ok(GUESS_PLAYERS.length > 2000, `enough players for a daily that never repeats: ${GUESS_PLAYERS.length}`);
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
ok(bySide.defence > 1000, `the pool is not another offence-only list: ${bySide.defence} defenders`);

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
// THE rule for a daily: it walks a permutation, so nobody comes round twice until everybody has been.
{
  const n = GUESS_PLAYERS.length;
  const seen = new Set();
  let repeats = 0;
  for (let d = 0; d < n; d++) {
    const a = guessAnswerFor(new Date(Date.UTC(2026, 8, 14) + d * 86400000).toISOString().slice(0, 10));
    if (seen.has(a.id)) repeats++;
    seen.add(a.id);
  }
  eq(repeats, 0, `no player is asked twice in ${n} days`);
  eq(seen.size, n, "and every player gets a turn");
  // And the day after the cycle is day one's answer again, not a gap.
  const wrapped = guessAnswerFor(new Date(Date.UTC(2026, 8, 14) + n * 86400000).toISOString().slice(0, 10));
  eq(wrapped.id, dayOne.id, "the cycle wraps rather than running out");
}
// Dates before launch resolve rather than throwing.
ok(guessAnswerFor("2020-01-01"), "a date before day one still has an answer");
// A practice code is seeded and spreads over the pool.
eq(guessAnswerForSeed("ABCD1234").id, guessAnswerForSeed("ABCD1234").id, "a code always gives the same player");
{
  const picks = new Set();
  for (let i = 0; i < 300; i++) picks.add(guessAnswerForSeed(`code-${i}`).id);
  ok(picks.size > 250, `codes spread over the pool (${picks.size} different in 300)`);
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
// The property the whole game rests on. If two players shared all five columns, a row could go green without
// being the answer - the screen would say you had won while the server said you had not. Checked across the
// WHOLE pool rather than sampled, because one collision is enough to break a day.
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
