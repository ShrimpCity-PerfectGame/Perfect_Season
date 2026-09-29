// Guess the Player - the rules, all of them. Imported by the screen, by the submit-guess Edge Function and by
// the tests, for the reason game-logic.mjs, versus-logic.mjs and century-logic.mjs exist: the browser colours a
// row the instant a guess is made and the server decides whether the run counts, and a rule enforced on one
// side and not the other will drift. Nothing here touches React, Supabase or the DOM.
//
// The game. A player is picked for the day and you have five guesses. Every guess is a real player, and the row
// it draws compares five things against the answer: TEAM, DIVISION, POSITION, DRAFT CLASS and JERSEY NUMBER.
// The name is not one of the five - it is the guess itself.
//
// Green is exact. Yellow is close, and what "close" means is different for each column, which is most of the
// game: the same division but not the same team, the same side of the ball but not the same position, a draft
// class within two years, a number within five. Draft class and number also carry an arrow, because knowing the
// answer is LATER than 2015 is worth far more than knowing it is not 2015.
import { hashStr, mulberry32, TEAMS } from "./game-logic.mjs";

// Five, not the eight it shipped with. The pool went from 4,637 players to the couple of hundred taking snaps
// this season plus the twenty-five nobody has forgotten, and eight guesses at a field that small is not a game -
// most days it would be solved by elimination. The two knobs move together: a smaller field wants fewer tries.
export const GUESS_TRIES = 5;
// The five columns a guess is judged on, in the order the row draws them.
export const GUESS_COLUMNS = ["team", "division", "pos", "draft", "number"];
// A draft class this many years either side is close; a number this far either side is close. Both were picked
// to be worth something without giving the answer away: two years is one draft either side of the right one,
// and five numbers is about the width of a position group's usual range.
export const DRAFT_NEAR = 2;
export const NUMBER_NEAR = 5;

// Eight divisions, and the one thing in this file that is not in the data: nflverse says which team, not which
// division. Written out rather than derived because there is no rule to derive it from.
export const DIVISIONS = {
  BUF: "AFC East", MIA: "AFC East", NE: "AFC East", NYJ: "AFC East",
  BAL: "AFC North", CIN: "AFC North", CLE: "AFC North", PIT: "AFC North",
  HOU: "AFC South", IND: "AFC South", JAX: "AFC South", TEN: "AFC South",
  DEN: "AFC West", KC: "AFC West", LV: "AFC West", LAC: "AFC West",
  DAL: "NFC East", NYG: "NFC East", PHI: "NFC East", WAS: "NFC East",
  CHI: "NFC North", DET: "NFC North", GB: "NFC North", MIN: "NFC North",
  ATL: "NFC South", CAR: "NFC South", NO: "NFC South", TB: "NFC South",
  ARI: "NFC West", LA: "NFC West", SF: "NFC West", SEA: "NFC West",
};
export const conferenceOf = (team) => (DIVISIONS[team] || "").split(" ")[0];

// One list, and it is short on purpose (v2.14.0): about 700 players, the best known at each position, ranked by
// what they did and doubled-and-a-half for anyone starting now. Everyone here can be typed as a guess AND asked
// as the answer - the two are the same set, because a game that asks about somebody you cannot name is unfair
// and a game that refuses a name you can is broken. tools/data/build-guess-pool.mjs holds the ranking.
export let GUESS_PLAYERS = [];        // every player, in the file's order
export let GUESS_BY_ID = {};          // id -> player
export let GUESS_SIDES = {};          // position group -> which side of the ball
let dailyOrder = null;                // the permutation the daily walks, built once

// A player's id has to be stable across a rebuild of the pool and unique within it. Name alone is not: there
// are two Adrian Petersons and two Alex Smiths in the league's history. Name plus draft class plus position is
// unique across the pool - checked by tests/test-guess-logic.mjs against the real file, not assumed.
export const guessId = (p) => `${p.name}|${p.draft}|${p.pos}`;

// Expands data/guess-pool.json. Positional rows behind a `columns` list, with team, position and group as
// indices into their own tables - see the note at the bottom of tools/data/build-guess-pool.mjs.
export function initGuessData(pool) {
  const at = {};
  for (let i = 0; i < pool.columns.length; i++) at[pool.columns[i]] = i;
  GUESS_SIDES = pool.sides || {};
  GUESS_PLAYERS = pool.players.map((row) => {
    const p = {
      name: row[at.name],
      team: pool.teams[row[at.team]],
      pos: pool.positions[row[at.pos]],
      group: pool.groups[row[at.group]],
      draft: row[at.draft],
      number: row[at.number],
      from: row[at.from],
      to: row[at.to],
      // 0-100, how guessable tools/data/build-guess-pool.mjs thinks he is. It decides how often he comes up and
      // what the end screen calls the day's difficulty. A file built before v2.14.0 has no such column, and 0
      // for everybody is a flat pool - which is what it was.
      score: at.score === undefined ? 0 : row[at.score],
      // He was never drafted; the team is the one he came into the league with and the class is his first
      // season. The end screen has to word it differently, and nothing else changes.
      undrafted: at.und !== undefined && row[at.und] === 1,
    };
    p.division = DIVISIONS[p.team] || null;
    p.side = GUESS_SIDES[p.group] || null;
    p.id = guessId(p);
    return p;
  });
  GUESS_BY_ID = {};
  for (const p of GUESS_PLAYERS) GUESS_BY_ID[p.id] = p;
  dailyOrder = null;
  return { players: GUESS_PLAYERS.length, teams: pool.teams.length, positions: pool.positions.length };
}

export const guessPlayer = (id) => GUESS_BY_ID[id] || null;

// ---------- Comparing a guess with the answer ----------
// Each column answers "hit" (green), "near" (yellow) or "miss" (grey), and the two numeric ones also say which
// way to go. A cell never says HOW near - "within two" is the whole of the hint, or the arrow plus a distance
// would hand over the answer on the second guess.
const cell = (state, hint) => (hint ? { state, hint } : { state });

export function compareGuess(guess, answer) {
  if (!guess || !answer) return null;
  const arrow = (a, b) => (a === b ? null : a > b ? "up" : "down"); // where the ANSWER is, from the guess
  return {
    // The team is exact or it is nothing. Division is what carries "warm", which is why they are separate
    // columns rather than one: a guess can be in the right division and the wrong team, and that is worth
    // knowing.
    team: cell(guess.team === answer.team ? "hit" : "miss"),
    division: cell(guess.division === answer.division ? "hit"
      : conferenceOf(guess.team) && conferenceOf(guess.team) === conferenceOf(answer.team) ? "near" : "miss"),
    // Green is the exact position (both CB). Yellow is the same side of the ball - an offensive guess against an
    // offensive answer - which is what makes the first guess of a game worth something even when it is wrong.
    // The row shows the position itself too, so a player reads "LB" against "DB" and learns more than the colour.
    pos: cell(guess.pos === answer.pos ? "hit" : guess.side && guess.side === answer.side ? "near" : "miss"),
    draft: cell(guess.draft === answer.draft ? "hit"
      : Math.abs(guess.draft - answer.draft) <= DRAFT_NEAR ? "near" : "miss", arrow(answer.draft, guess.draft)),
    number: cell(guess.number === answer.number ? "hit"
      : Math.abs(guess.number - answer.number) <= NUMBER_NEAR ? "near" : "miss", arrow(answer.number, guess.number)),
  };
}

export const isGuessSolved = (row) => !!row && GUESS_COLUMNS.every((c) => row[c].state === "hit");
// Every column green means the guess IS the answer - but only because the five together identify a player, and
// that is a property of the data rather than of this function. tests/test-guess-logic.mjs checks it holds for
// every player in the pool, because a pool where two players share all five would make a solved row a lie.

// ---------- Which player, on which day ----------
// The daily walks a fixed cycle rather than picking at random: a random pick repeats somebody within a year
// about as often as not, and the one thing a daily must never do is ask the same question twice in a fortnight.
//
// Every player takes one turn (see GUESS_BANDS), so the cycle is the pool and nobody comes round again until
// everybody has been asked - about six months at the size the pool is now, and longer every week of the season
// as more men pass the snap bar.
export const GUESS_DAY_ONE = "2026-09-14";
const SHUFFLE_SEED = "gridspin-guess-order";

export function guessDayNumber(date) {
  const utc = (key) => { const [y, m, d] = String(key).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(date) - utc(GUESS_DAY_ONE)) / 86400000);
}

// How often each band comes round. The best-known third of the pool is asked three times a cycle, the middle
// twice, the rest once - so most days are a player you know and the deep cuts stay occasional rather than
// disappearing. The alternative, one turn each, makes every day equally likely to be the 700th-best guard.
// The bands name how hard a player is thought to be, and `turns` is how often he comes round.
//
// Every band takes ONE turn now, which is to say the daily is a plain permutation again. Weighting was worth it
// over 731 players: three turns for the best-known quarter gave a 1,353-day cycle and still left 451 days
// between one man's turns. Over a couple of hundred it is not - the same weighting brings a player back inside
// four months, and a daily that repeats a question inside a season is worse than one that asks a hard question.
// The pool is already only current players and legends, which is what the weighting was for.
export const GUESS_BANDS = [
  { name: "easy", share: 0.25, turns: 1 },
  { name: "medium", share: 0.35, turns: 1 },
  { name: "hard", share: 0.40, turns: 1 },
];

// The pool, best-known first. Ties break on id so two builds of the same data give the same order.
function ranked() {
  return [...GUESS_PLAYERS].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}

// Which band a player is in, by his place in that ranking.
export function guessBand(player) {
  const order = ranked();
  const at = order.findIndex((p) => p.id === player?.id);
  if (at < 0) return null;
  let seen = 0;
  for (const band of GUESS_BANDS) {
    seen += Math.round(order.length * band.share);
    if (at < seen) return band.name;
  }
  return GUESS_BANDS[GUESS_BANDS.length - 1].name;
}

// How hard the day was, 0 (everybody knows him) to 100 (the deepest cut in the pool), as a position in the
// ranking rather than the raw score - the scores themselves sit in a narrow band and "61 out of 100" would mean
// nothing to anybody. Shown only when the game is over; before that it would be a hint.
export function guessDifficulty(player) {
  const order = ranked();
  const at = order.findIndex((p) => p.id === player?.id);
  if (at < 0 || order.length < 2) return null;
  return Math.round((100 * at) / (order.length - 1));
}

// The cycle the daily walks. Each player takes his band's number of turns, and his turns are SPREAD - placed a
// cycle-length apart and nudged off a hash of his own id - so somebody asked three times in 1,300 days is asked
// about every 450, never twice in a week. A shuffle of three concatenated passes would have been simpler and
// would have allowed exactly that, which is the one thing a daily may not do.
function orderOnce() {
  if (dailyOrder) return dailyOrder;
  const order = ranked();
  if (!order.length) { dailyOrder = []; return dailyOrder; }
  const turnsFor = new Map();
  let seen = 0;
  for (const band of GUESS_BANDS) {
    const upto = Math.min(order.length, seen + Math.round(order.length * band.share));
    for (let i = seen; i < upto; i++) turnsFor.set(order[i].id, band.turns);
    seen = upto;
  }
  for (const p of order) if (!turnsFor.has(p.id)) turnsFor.set(p.id, 1);

  const length = [...turnsFor.values()].reduce((n, t) => n + t, 0);
  const slots = new Array(length).fill(null);
  // Never a random comparator and never Math.random: the client and the server must agree call for call
  // (CLAUDE.md's engine-independence note), so every position here comes from the seeded stream in one order.
  const rng = mulberry32(hashStr(SHUFFLE_SEED));
  const start = new Map(order.map((p) => [p.id, rng()]));
  // The most-asked first, because they are the ones whose spacing matters and the ones hardest to place late.
  const byTurns = [...turnsFor.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [id, turns] of byTurns) {
    const gap = length / turns;
    for (let k = 0; k < turns; k++) {
      let at = Math.floor(start.get(id) * gap + k * gap) % length;
      // Taken: walk forward to the next free slot. The walk is why the spacing is "about" rather than "exactly".
      let steps = 0;
      while (slots[at] !== null && steps < length) { at = (at + 1) % length; steps++; }
      slots[at] = id;
    }
  }
  dailyOrder = slots.filter(Boolean);
  return dailyOrder;
}

// How many days before the cycle comes round. Longer than the pool, because the best-known take several turns.
export const guessCycleLength = () => orderOnce().length;

// The answer for a date. Dates before day one walk backwards through the same cycle rather than failing, so
// nothing has to special-case them.
export function guessAnswerFor(date) {
  const order = orderOnce();
  if (!order.length) return null;
  const n = guessDayNumber(date);
  return GUESS_BY_ID[order[((n % order.length) + order.length) % order.length]] || null;
}

// A practice round, seeded by a code the way an Unlimited Century is, so one can be shared and replayed.
export function guessAnswerForSeed(seed) {
  if (!GUESS_PLAYERS.length) return null;
  const rng = mulberry32(hashStr(`guess|${seed}`));
  return GUESS_PLAYERS[Math.floor(rng() * GUESS_PLAYERS.length)] || null;
}

export const guessDailySeed = (date) => `guess-${date}`;

// ---------- The replay the server runs ----------
// `guesses` is the whole game: the ids guessed, in order. Everything else - which rows were green, whether it
// was solved, how many tries it took - follows from that and the answer, so none of it is taken from the client.
//
// Returns { ok: true, solved, tries, rows, answer } or { ok: false, reason }.
export function replayGuessGame({ date, seed, guesses } = {}) {
  const answer = date ? guessAnswerFor(date) : seed ? guessAnswerForSeed(seed) : null;
  if (!answer) return { ok: false, reason: "no_answer" };
  if (!Array.isArray(guesses)) return { ok: false, reason: "bad_guesses" };
  if (!guesses.length) return { ok: false, reason: "no_guesses" };
  if (guesses.length > GUESS_TRIES) return { ok: false, reason: "too_many" };
  const rows = [];
  const seen = new Set();
  for (let i = 0; i < guesses.length; i++) {
    const id = guesses[i];
    if (typeof id !== "string") return { ok: false, reason: "bad_guess" };
    // The same player twice is a wasted try in the browser, so it is never a real game - and allowing it here
    // would let a trace pad itself out to look like a harder win than it was.
    if (seen.has(id)) return { ok: false, reason: "repeat_guess" };
    seen.add(id);
    const p = guessPlayer(id);
    if (!p) return { ok: false, reason: "unknown_player" };
    const row = compareGuess(p, answer);
    rows.push({ id, row });
    // Solved is decided by WHO was guessed, never by the colours. They agree today - the pool is built so that
    // no two players share all five columns, and tests/test-guess-logic.mjs checks that across the whole of it -
    // but identity is the truth and the row is a drawing of it. If a future rebuild ever let a clash through,
    // this is what keeps the server right and turns the bug into a confusing row rather than a stolen win.
    if (id === answer.id && i !== guesses.length - 1) return { ok: false, reason: "guessed_past_the_end" };
  }
  const solved = rows[rows.length - 1].id === answer.id;
  return { ok: true, solved, tries: rows.length, rows, answer };
}

// The line stored with a run and printed on the end screen. Stored, so like the season sim's outcome strings it
// must not change once runs carry it.
export function guessOutcome(solved, tries) {
  if (!solved) return `Missed. ${GUESS_TRIES} guesses.`;
  if (tries === 1) return "Got it first guess.";
  return `Got it in ${tries}.`;
}
