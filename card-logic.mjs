// Cards - the rules, all of them. Imported by the browser, by the Edge Function that will score a battle, and
// by the tests, for the reason game-logic.mjs, versus-logic.mjs and century-logic.mjs exist: the browser shows a
// result the instant a battle ends and the server decides whether it counts, and a rule enforced on one side and
// not the other will drift. Nothing here touches React, Supabase or the DOM, and nothing here calls Math.random:
// every random draw comes from a `rand` the caller hands in, so a battle is a pure function of its inputs.
//
// What a card is. One row of the draft pool - a player's best season for one team in one five-year era - frozen
// into data/cards.json with an id of its own (tools/data/build-card-catalog.mjs says why it is frozen). A card's
// strength is its printed fantasy `rating` in every slot, Flex included: the number on the card face is always
// the number that plays, which is why flexRating/effectiveRating are not used here.
//
// The reference is CARDS.md; the design is docs/superpowers/specs/2026-11-13-card-collection-design.md.

import { SLOTS, fits, hashStr, mulberry32 } from "./game-logic.mjs";

// ---------- Cards ----------
export let CARDS = new Map(); // id -> card

// An archetype is EARNED from the card's own season, never stored and never assigned by hand. The order of this
// list is the priority order: a card that qualifies for several shows the first. Thresholds are the design's
// (spec 3.1) and tests/test-card-logic.mjs pins how many cards each one catches, so moving a number here shows
// its cost there. `per` guards every ratio: a card with no games, attempts, carries or catches qualifies for
// nothing, rather than comparing NaN.
const per = (n, d) => (d > 0 ? n / d : NaN);
export const ARCHETYPES = [
  { id: "gunslinger", label: "Gunslinger", pos: ["QB"], test: (c) => per(c.att, c.g) >= 25 && per(c.py, c.att) >= 7.7 },
  { id: "scrambler", label: "Scrambler", pos: ["QB"], test: (c) => per(c.ry, c.g) >= 22 },
  { id: "volume", label: "Volume passer", pos: ["QB"], test: (c) => per(c.att, c.g) >= 36 },
  { id: "manager", label: "Game manager", pos: ["QB"], test: (c) => per(c.att, c.g) >= 20 && per(c.int, c.att) <= 0.021 && per(c.py, c.att) < 7.7 },
  { id: "workhorse", label: "Workhorse", pos: ["RB"], test: (c) => per(c.car, c.g) >= 17 && per(c.rec, c.g) < 3 },
  { id: "goalline", label: "Goal-line back", pos: ["RB"], test: (c) => c.g > 0 && c.rtd >= 10 },
  { id: "homerun", label: "Home-run hitter", pos: ["RB"], test: (c) => c.car >= 100 && per(c.ry, c.car) >= 4.8 },
  { id: "receiving", label: "Receiving back", pos: ["RB"], test: (c) => per(c.rec, c.g) >= 3.2 },
  { id: "deep", label: "Deep threat", pos: ["WR"], test: (c) => c.rec >= 30 && per(c.rcy, c.rec) >= 15.5 },
  { id: "redzone", label: "Red-zone target", pos: ["WR", "TE"], test: (c) => c.g > 0 && c.rctd >= (c.pos === "TE" ? 7 : 9) },
  { id: "possession", label: "Possession", pos: ["WR"], test: (c) => per(c.rec, c.g) >= 5 && per(c.rcy, c.rec) < 13 },
  { id: "seam", label: "Seam stretcher", pos: ["TE"], test: (c) => c.rec >= 25 && per(c.rcy, c.rec) >= 12.5 },
  { id: "valve", label: "Safety valve", pos: ["TE"], test: (c) => per(c.rec, c.g) >= 3.5 && per(c.rcy, c.rec) < 11 },
];
export const ROLE_PLAYER = "role";
const ARCHETYPE_LABEL = Object.fromEntries(ARCHETYPES.map((a) => [a.id, a.label]));
export const archetypeLabel = (id) => ARCHETYPE_LABEL[id] || "Role player";

// Every archetype a card qualifies for, in priority order.
export function cardArchetypes(card) {
  const out = [];
  for (const a of ARCHETYPES) if (a.pos.includes(card.pos) && a.test(card) === true) out.push(a.id);
  return out;
}
// The one it shows.
export const cardArchetype = (card) => cardArchetypes(card)[0] || ROLE_PLAYER;

// Expands data/cards.json. The file stores positional rows behind a `columns` list, so the shape is read from
// the file rather than assumed.
export function initCardData(catalog) {
  const cols = catalog.columns;
  CARDS = new Map();
  const players = new Set();
  for (const row of catalog.cards) {
    const card = {};
    for (let i = 0; i < cols.length; i++) card[cols[i]] = row[i];
    card.archetype = cardArchetype(card);
    CARDS.set(card.id, card);
    players.add(card.pid);
  }
  return { cards: CARDS.size, players: players.size };
}

// ---------- Defenses ----------
// The opponent is always a real team defense from data/versus-pool.json, the file Duel already ships. A trait is
// earned from the defense's own numbers, the way an archetype is earned from a card's.
//
// BEST FIVE OF ITS OWN SEASON, not best across the pool. Scoring, passing and sack rates moved a long way
// between 1999 and 2025, so a raw cut would hand every Stingy to the early 2000s and every Pass rush to the
// 2020s. Ranked within a season, a 2003 defense and a 2023 one are each judged against their own football, and
// every season fields exactly five of each trait.
//
// Ties at the cut are broken by team code. That is arbitrary and it is deliberate: two teams level on
// interceptions is ordinary, and an answer that depended on the order the file listed them in would differ
// between a build of the file and the next.
export const TRAITS = [
  { id: "stingy", label: "Stingy", stat: "pa", best: "low" },
  { id: "ballhawks", label: "Ball hawks", stat: "ints", best: "high" },
  { id: "passrush", label: "Pass rush", stat: "sacks", best: "high" },
  { id: "strip", label: "Strip artists", stat: "fum", best: "high" },
  { id: "scoring", label: "Scoring defense", stat: "tds", best: "high" },
];
export const TRAITS_PER_SEASON = 5;
const TRAIT_LABEL = Object.fromEntries(TRAITS.map((t) => [t.id, t.label]));
export const traitLabel = (id) => TRAIT_LABEL[id] || id;

export let DEFENSES = []; // sorted by key, so an index into it means the same thing on every engine
let defenseIndex = new Map();
export const defenseByKey = (key) => defenseIndex.get(key);

export function initDefenses(versusPool) {
  const cols = versusPool.columns.defenses;
  const list = versusPool.defenses.map((row) => {
    const d = {};
    for (let i = 0; i < cols.length; i++) d[cols[i]] = row[i];
    d.key = `${d.season}|${d.team}`;
    d.traits = [];
    return d;
  });
  const seasons = new Map();
  for (const d of list) (seasons.get(d.season) || seasons.set(d.season, []).get(d.season)).push(d);
  for (const t of TRAITS) {
    const sign = t.best === "low" ? 1 : -1;
    for (const teams of seasons.values()) {
      const ranked = [...teams].sort((a, b) => sign * (a[t.stat] - b[t.stat]) || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0));
      for (const d of ranked.slice(0, TRAITS_PER_SEASON)) d.traits.push(t.id);
    }
  }
  list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  DEFENSES = list;
  defenseIndex = new Map(list.map((d) => [d.key, d]));
  return DEFENSES.length;
}

// ---------- Lineups ----------
// The draft's own six slots, so nobody learns a second shape: QB, RB, WR, TE and two Flex (anyone but a
// quarterback). A lineup is { [slot]: { id, finish } } - a card AND the finish of the copy being played, since
// a Gold copy and a Base copy of one card are owned separately and score differently.
export const FINISHES = ["base", "silver", "gold", "prism"];
// What a finish adds to the card's rating in a battle. Small on purpose: a matchup is worth ten to twenty-five, so
// a finish is a flex and a tiebreaker and never a substitute for the right lineup.
export const FINISH_BONUS = { base: 0, silver: 1, gold: 2, prism: 3 };
export const ownKey = (id, finish) => `${id}:${finish}`;

// null when the lineup may be played, otherwise the reason it may not. The first reason found wins, in the
// order below, and every one of them is a string the caller can map to a sentence.
//
// `owned` is a Map of ownKey -> count, or null to skip the ownership question (the tests and a bot building a
// lineup out of a known collection have no use for it).
//
// THIS MUST NEVER THROW. It is the door a modified browser knocks on, so every shape it could be handed -
// null, a string, an array, an id that is a word, a finish named "constructor" - has to come back as a reason.
// scoreBattle below trusts its input completely and is only ever called with a lineup this has passed.
export function lineupProblem(lineup, owned) {
  if (lineup === null || typeof lineup !== "object" || Array.isArray(lineup)) return "malformed";
  for (const key of Object.keys(lineup)) if (!SLOTS.includes(key)) return "malformed";
  for (const slot of SLOTS) if (lineup[slot] == null) return "incomplete";
  for (const slot of SLOTS) if (typeof lineup[slot] !== "object" || Array.isArray(lineup[slot])) return "malformed";
  for (const slot of SLOTS) if (!CARDS.has(lineup[slot].id)) return "unknown_card";
  for (const slot of SLOTS) if (!FINISHES.includes(lineup[slot].finish)) return "bad_finish";
  for (const slot of SLOTS) if (!fits(CARDS.get(lineup[slot].id).pos, slot)) return "bad_slot";
  // One MAN, one slot - by pid, so two seasons of the same player cannot both start.
  const men = new Set();
  for (const slot of SLOTS) {
    const pid = CARDS.get(lineup[slot].id).pid;
    if (men.has(pid)) return "same_player";
    men.add(pid);
  }
  if (owned) {
    for (const slot of SLOTS) if (!(owned.get(ownKey(lineup[slot].id, lineup[slot].finish)) >= 1)) return "not_owned";
  }
  return null;
}

// ---------- Battles ----------
// Six cards against one defense. Each card plays its own game: its rating (plus its finish), a roll of luck, and
// whatever the matchup does to it. The six totals add up against a bar the defense sets.
//
// THE NUMBERS BELOW ARE TUNED, NOT CHOSEN. tests/test-card-balance.mjs plays thousands of battles and holds them
// to the design's promises - a starter deck wins sometimes, a stacked one can still lose, and the six highest
// ratings are not the answer. Change a number here and that file says what it cost. The KEYS are the design:
// which trait hurts which archetype, and who plays better beside whom.
//
// Luck is a triangular roll: two draws added, so most games land near the card's rating and a few land far from
// it, never beyond +-LUCK_SPREAD. EXACTLY TWO DRAWS A CARD, TWELVE A BATTLE, ALWAYS, whatever the cards are.
// The browser and the Edge Function run different JavaScript engines and have to walk the generator in step;
// a draw that happened only for some cards would put them out of step for every card after it. Same reason
// nothing here is ordered with a random comparator (game-logic.mjs's smallTimSort has the history).
export const LUCK_SPREAD = 26;

// THE BAR RISES WITH EVERY WIN IN A RUN. It is the owner's call (2026-11-13) and it replaced a bar that was
// fixed per defense, because the balance bot measured why that could not work: a starter deck's best six add up
// to about 246, sixty random cards to about 641, and the sixty best cards in the game to 780. No single bar is
// both clearable by the first and a test for the last - set for one, it was a 0.4% win rate for starters or a
// walkover for everybody else. So the first battle of a run (step 0) is one almost anybody wins, each win
// raises the next bar by BAR_STEP, and every run ends at a battle that is a real test for THAT collection.
//
// The defense still matters: BAR_DEFENSE points for each point its rating sits above or below BAR_PIVOT, which
// is the median defense in the pool. Small beside BAR_STEP on purpose - a great defense is a harder draw, not a
// wall - because what a defense mostly does to you is its TRAITS.
//
// The daily showdown has no step. It is a score, not a win or a loss; it reports the step-0 bar for reference.
export const BAR_START = 190;
export const BAR_STEP = 55;
export const BAR_DEFENSE = 1.5;
export const BAR_PIVOT = 65;

// trait -> archetype -> points. Negative is the defense taking something away; positive is an archetype that
// is the ANSWER to that defense, which is what makes a lower-rated card the right pick.
export const COUNTERS = {
  stingy: { goalline: -20, redzone: -20 },
  ballhawks: { gunslinger: -25, volume: -20, manager: 15 },
  passrush: { volume: -20, gunslinger: -15, scrambler: 20, valve: 13, receiving: 13 },
  strip: { workhorse: -20, homerun: -15, possession: 10 },
  scoring: { volume: -15, manager: 15, workhorse: 10 },
};
// [archetype, archetype, points to EACH]. A pair fires once for a card however many partners it has: two deep
// threats do not make a gunslinger twice as good, they each get their own lift from him.
export const PAIRS = [
  ["gunslinger", "deep", 16], ["gunslinger", "seam", 12], ["manager", "possession", 12], ["manager", "valve", 10],
  ["scrambler", "homerun", 12], ["volume", "receiving", 12], ["volume", "possession", 10],
];

const round1 = (n) => Math.round(n * 10) / 10;
// `step` is how many battles this run has already won. Anything that is not a whole number of wins - a
// negative, a fraction, a word, nothing at all - is read as the nearest honest thing rather than refused: this
// is arithmetic, and the Edge Function is what decides which step a run is really on.
export function battleTarget(defense, step = 0) {
  const wins = Number.isFinite(step) && step > 0 ? Math.floor(step) : 0;
  return Math.round(BAR_START + BAR_STEP * wins + BAR_DEFENSE * (defense.rating - BAR_PIVOT));
}

// "142 yards, 2 TD": the card's real per-game line, scaled by how its game went. Display only, no draw.
function playLine(card, base, total) {
  const k = base > 0 ? Math.max(0, total) / base : 0;
  const g = card.g > 0 ? card.g : 1;
  const yards = card.pos === "QB" ? card.py : card.pos === "RB" ? card.ry : card.rcy;
  const tds = card.pos === "QB" ? card.ptd + card.rtd : card.rtd + card.rctd;
  return `${Math.round((yards / g) * k).toLocaleString("en-US")} yards, ${Math.round((tds / g) * k)} TD`;
}

// Only ever called with a lineup lineupProblem has passed and a defense out of DEFENSES - it trusts both.
// rand is a () => [0, 1) generator; every draw this function makes comes from it.
// step is the run's wins so far (see battleTarget); it moves the bar and never the cards.
export function scoreBattle(lineup, defense, rand, step = 0) {
  const cards = SLOTS.map((slot) => ({ slot, entry: lineup[slot], card: CARDS.get(lineup[slot].id) }));
  const fielded = new Set(cards.map((c) => c.card.archetype));
  const plays = cards.map(({ slot, entry, card }) => {
    const base = card.rating + FINISH_BONUS[entry.finish];
    const roll = round1((rand() + rand() - 1) * LUCK_SPREAD);
    const mods = [];
    for (const trait of defense.traits) {
      const pts = COUNTERS[trait]?.[card.archetype];
      if (pts) mods.push({ key: `trait:${trait}`, label: `${traitLabel(trait)} vs ${archetypeLabel(card.archetype)}`, pts });
    }
    for (const [a, b, pts] of PAIRS) {
      const partner = card.archetype === a ? b : card.archetype === b ? a : null;
      if (partner && fielded.has(partner)) mods.push({ key: `pair:${a}+${b}`, label: `${archetypeLabel(a)} + ${archetypeLabel(b)}`, pts });
    }
    const total = round1(base + roll + mods.reduce((s, m) => s + m.pts, 0));
    return { slot, id: card.id, finish: entry.finish, base, roll, mods, total, line: playLine(card, base, total) };
  });
  const offense = round1(plays.reduce((s, p) => s + p.total, 0));
  const target = battleTarget(defense, step);
  return { cards: plays, offense, target, win: offense >= target };
}

// ---------- The daily showdown ----------
// One defense a day, the same for everyone, and ONE ROLL PER LINEUP: the generator is seeded from the day and
// the lineup, so two people fielding the same six cards get the same score and the board rewards the lineup
// rather than the roll. A different lineup - even one finish different - rolls differently.
//
// Accepted gap, the one every seeded daily in this game has: the bundle and the seed are public, so anybody
// willing to run this file can find the day's best lineup offline. CARDS.md says so; it is not closeable here.
export const showdownSeed = (date) => `showdown-${date}`;
export const showdownDefense = (date) => DEFENSES[Math.floor(mulberry32(hashStr(showdownSeed(date)))() * DEFENSES.length)];
export const showdownRand = (date, lineup) =>
  mulberry32(hashStr(`${showdownSeed(date)}|${SLOTS.map((s) => `${lineup[s].id}:${lineup[s].finish}`).join(",")}`));
export function showdownScore(date, lineup) {
  const result = scoreBattle(lineup, showdownDefense(date), showdownRand(date, lineup));
  return { ...result, score: result.offense };
}
