// Century - the rules, all of them. Imported by century.jsx, by the submit-century Edge Function, and by the
// tests, for the reason game-logic.mjs and versus-logic.mjs exist: the browser shows you a score the instant you
// finish and the server decides whether it counts, and a rule enforced on one side and not the other will drift.
// Nothing here touches React, Supabase or the DOM.
//
// The mode. Seven slots - QB, two RB, two WR, TE and a Flex - and a goal of 100 combined passing, rushing and
// receiving touchdowns from ONE real season (2025). Each spin deals a random team; you fill exactly one slot from
// that team and the team is spent. Stats are hidden while you pick, which is the whole game: you are betting on
// what you remember about the season, not reading a number off a card. One team re-spin.
//
// Why 100. Measured against the real 2025 data, over 20,000 games played by a bot that always takes the leading
// scorer for a slot it still needs - which is what perfect knowledge of the season looks like, since the stats
// being hidden is the only thing between a player and that bot: median 80, ninetieth centile 95, and 100 reached
// in 5.1% of games. The absolute ceiling - the seven best teams in the league, assigned perfectly - is 133, and
// the best DRAW in 20,000 was worth 127, so nothing is asking for a run that cannot exist. So 100
// is a real target for somebody who knows the season and out of reach for somebody guessing, which is what a
// knowledge game's goal should be. Changing MIN_GAMES in tools/data/build-season-pool.mjs, the slots, or the Flex
// rule moves all of those numbers; re-run tests/test-century-logic.mjs, which prints them.
import { hashStr, mulberry32, TEAMS } from "./game-logic.mjs";

export const CENTURY_GOAL = 100;
// Seven slots, and the duplicated ones are numbered because a roster is keyed by slot: two entries both called
// "RB" would be one entry. The numbers are not a depth chart - RB1 and RB2 grade identically.
export const CENTURY_SLOTS = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "FLEX"];
// Flex takes anyone who isn't a quarterback, the same rule the main game's FLEX_POS states.
export const CENTURY_FLEX = "FLEX";

export let CENTURY_SEASON = 0;
export let CENTURY_TEAMS = [];   // the 32 codes, sorted, and the spin pool
export let CENTURY_BOARDS = {};  // team -> that team's players, already ordered for display
export let CENTURY_MIN_GAMES = 0;

// The position a slot wants, or null for the Flex, which wants a range instead. "RB1" -> "RB".
export const centurySlotPos = (slot) => (slot === CENTURY_FLEX ? null : slot.replace(/\d+$/, ""));
export const centuryFits = (pos, slot) => (slot === CENTURY_FLEX ? pos !== "QB" : pos === centurySlotPos(slot));

// Expands data/season-2025.json. The file stores positional rows behind a `columns` list to keep the bundle
// small (see the note at the bottom of tools/data/build-season-pool.mjs), so the shape is read from the file
// rather than assumed - a column added there arrives here without an edit.
export function initCenturyData(pool) {
  const cols = pool.columns;
  const at = {};
  for (let i = 0; i < cols.length; i++) at[cols[i]] = i;
  CENTURY_SEASON = pool.season;
  CENTURY_MIN_GAMES = pool.minGames;
  CENTURY_BOARDS = {};
  for (const row of pool.players) {
    const team = row[at.team];
    const p = {
      id: `${team}|${row[at.name]}`,
      team,
      name: row[at.name],
      pos: row[at.pos],
      td: row[at.td],
      games: row[at.games],
    };
    (CENTURY_BOARDS[team] || (CENTURY_BOARDS[team] = [])).push(p);
  }
  CENTURY_TEAMS = Object.keys(CENTURY_BOARDS).sort();
  return { season: CENTURY_SEASON, teams: CENTURY_TEAMS.length, players: pool.players.length };
}

export const centuryPlayer = (team, name) => (CENTURY_BOARDS[team] || []).find((p) => p.name === name) || null;
export const centuryTeamName = (t) => (TEAMS[t] ? `${TEAMS[t][1]} ${TEAMS[t][0]}` : t);

// ---------- The spins ----------
// Seven teams, no repeats, drawn from the seed alone - so a daily deals every player the same seven, a challenge
// code replays, and the server can recompute the whole sequence from the seed instead of trusting the client with
// it. Same shuffle as seededSequence, and for the same reason: never order this with a random comparator, because
// how many times an engine calls one is up to the engine (see the engine-independence note in CLAUDE.md).
export function centuryPlan(seed) {
  const rng = mulberry32(hashStr(seed));
  const all = [...CENTURY_TEAMS];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, CENTURY_SLOTS.length);
}

// The team a re-spin at `step` deals. It excludes the WHOLE plan, not the part already seen - the same rule the
// main game's reroll pool has, and for the same reason: a re-spin onto a team still to come would deal that team
// twice, since nothing removes the original. It depends on `step`, so the spare is not knowable before it is
// spent.
export function centuryRespinTeam(seed, step, plan) {
  const taken = new Set(plan);
  const pool = CENTURY_TEAMS.filter((t) => !taken.has(t));
  if (!pool.length) return null;
  const rng = mulberry32(hashStr(`${seed}|respin|${step}`));
  return pool[Math.floor(rng() * pool.length)];
}

// The seven teams a game was actually played from: the plan, with the re-spun step replaced. One place to work it
// out, so the screen, the ceiling and the replay can never disagree about which teams were on the table.
export function centuryTeamsDealt(seed, respunAt = -1) {
  const plan = centuryPlan(seed);
  if (respunAt < 0 || respunAt >= plan.length) return plan;
  const dealt = [...plan];
  dealt[respunAt] = centuryRespinTeam(seed, respunAt, plan);
  return dealt;
}

// ---------- Scoring ----------
export const centuryScore = (roster) => CENTURY_SLOTS.reduce((n, s) => n + (roster[s] ? roster[s].td : 0), 0);
export const centuryHit = (score) => score >= CENTURY_GOAL;

// What the seven teams dealt were worth at best - the honest "you could have had" number for the end screen, and
// the only fair way to read a score, since a draw of seven weak teams cannot reach 100 however well it is played.
// Exact, not greedy: it is an assignment of seven teams to seven slots, and greedy gets it wrong (spending the
// best team's quarterback on the Flex can cost more than it gains). 5,040 permutations of seven, each seven
// lookups, so exactness is affordable.
export function centuryCeiling(seed, respunAt = -1) {
  const dealt = centuryTeamsDealt(seed, respunAt).filter(Boolean);
  const best = dealt.map((team) => CENTURY_SLOTS.map((slot) => {
    let top = 0;
    for (const p of CENTURY_BOARDS[team] || []) if (centuryFits(p.pos, slot) && p.td > top) top = p.td;
    return top;
  }));
  let most = 0;
  const used = new Array(CENTURY_SLOTS.length).fill(false);
  const walk = (i, sum) => {
    if (i === dealt.length) { if (sum > most) most = sum; return; }
    for (let s = 0; s < CENTURY_SLOTS.length; s++) {
      if (used[s]) continue;
      used[s] = true;
      walk(i + 1, sum + best[i][s]);
      used[s] = false;
    }
  };
  walk(0, 0);
  return most;
}

// ---------- Legality, and the replay the server runs ----------
// `picks` is the whole game: one entry per slot filled, in the order they were filled, each naming the slot and
// the player, and at most one of them carrying `respun: true` to mean "I spent the re-spin before this pick". The
// board for step i follows from the seed and that flag, so nothing about which teams were dealt is taken from the
// client - it is recomputed here.
//
// Returns { ok: true, score, hit, roster, teams, respunAt } or { ok: false, reason }.
export function replayCentury({ seed, picks } = {}) {
  if (typeof seed !== "string" || !seed) return { ok: false, reason: "bad_seed" };
  if (!Array.isArray(picks)) return { ok: false, reason: "bad_picks" };
  if (picks.length !== CENTURY_SLOTS.length) return { ok: false, reason: "wrong_length" };
  // One re-spin a game, counted before anything is looked up. Checked here rather than as the loop meets the
  // second one because the loop would report whatever the second re-spin's board made illegal - a player not on
  // it, usually - and the honest refusal is the rule that was broken, not the symptom.
  if (picks.filter((m) => m && m.respun).length > 1) return { ok: false, reason: "two_respins" };
  const plan = centuryPlan(seed);
  const roster = {};
  const teams = [];
  const names = new Set();
  let respunAt = -1;
  for (let i = 0; i < picks.length; i++) {
    const move = picks[i];
    if (!move || typeof move !== "object") return { ok: false, reason: "bad_pick" };
    if (move.respun) respunAt = i;
    const team = move.respun ? centuryRespinTeam(seed, i, plan) : plan[i];
    if (!team) return { ok: false, reason: "no_team" };
    if (!CENTURY_SLOTS.includes(move.slot)) return { ok: false, reason: "bad_slot" };
    if (roster[move.slot]) return { ok: false, reason: "slot_taken" };
    const p = centuryPlayer(team, move.name);
    if (!p) return { ok: false, reason: "not_on_board" };
    if (!centuryFits(p.pos, move.slot)) return { ok: false, reason: "wrong_position" };
    // A player traded mid-season is on both his teams' boards, so the same person really can be offered twice.
    // He cannot fill two slots.
    if (names.has(p.name)) return { ok: false, reason: "already_drafted" };
    names.add(p.name);
    roster[move.slot] = p;
    teams.push(team);
  }
  const score = centuryScore(roster);
  return { ok: true, score, hit: centuryHit(score), roster, teams, respunAt };
}

// Which slots a team can still fill, for the screen and for the "can this strand me" test below.
export function centuryOpenFor(team, roster) {
  const board = CENTURY_BOARDS[team] || [];
  return CENTURY_SLOTS.filter((s) => !roster[s] && board.some((p) => centuryFits(p.pos, s)
    && !Object.values(roster).some((q) => q.name === p.name)));
}

// A game must always be finishable. It is - every team in the pool fields all four positions, which
// tools/data/build-season-pool.mjs refuses to write a file without, so any team can fill any empty slot. This
// says so out loud rather than leaving it as a property of the data, and tests/test-century-logic.mjs plays every
// seed through it.
export const centuryCanStrand = (team, roster) => centuryOpenFor(team, roster).length === 0;

// The line stored with a run and printed on the end screen. Stored, so like the season sim's outcome strings it
// must not change once runs carry it - add emoji at display time (CLAUDE.md, Design system).
export function centuryOutcome(score) {
  if (score >= CENTURY_GOAL) return `Century. ${score} touchdowns.`;
  if (score >= CENTURY_GOAL - 10) return `So close. ${score} touchdowns.`;
  if (score >= CENTURY_GOAL - 30) return `${score} touchdowns.`;
  return `Short. ${score} touchdowns.`;
}

// The daily's seed, and the one thing that must never be reachable as an Unlimited code - the same protection the
// main daily has (isReservedCode in game-logic.mjs): the prize is the BOARDS, so a code that hashes to a daily's
// seed deals that daily's seven teams bit for bit.
export const centuryDailySeed = (date) => `century-${date}`;
export const CENTURY_SEED_WINDOW_DAYS = 366;
export function centuryReservedSeed(seed) {
  if (typeof seed !== "string") return false;
  const target = hashStr(seed);
  const day = 86400000;
  const now = Date.now();
  for (let d = -CENTURY_SEED_WINDOW_DAYS; d <= CENTURY_SEED_WINDOW_DAYS; d++) {
    const date = new Date(now + d * day).toISOString().slice(0, 10);
    if (hashStr(centuryDailySeed(date)) === target) return true;
  }
  return false;
}
