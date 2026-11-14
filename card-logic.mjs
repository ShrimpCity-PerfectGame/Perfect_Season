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

import { WINDOWS, hashStr, mulberry32 } from "./game-logic.mjs";

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

// ---------- Categories ----------
// A round is never "the better card wins". Each of a battle's six rounds is fought on a CATEGORY, and a card's
// score in a category is how its real season ranked AT ITS OWN POSITION IN ITS OWN ERA, 0 to 99. So a
// quarterback and a running back can meet in a round and compare fairly (each against his own kind), a 2003
// season and a 2023 one are each judged against their own football, and a lower-rated card wins the rounds its
// season was built for. (Owner's redesign, 2026-11-14: "a fast collectible strategy game powered by historical
// NFL seasons" - not fantasy scoring, not a simulation, not a card flip.)
//
// Every category is something the catalog really holds. There is no Clutch and no Deep ball here because there
// is no such column: a score that is not the player's own numbers would be a number made up about a real man.
//
// The per-touch ones are SHRUNK toward an ordinary season (a few phantom touches at a league-ordinary rate), or
// a man with three catches for ninety yards would be the best big-play threat in the game.
export const CATEGORIES = [
  { id: "production", label: "Production", blurb: "Total yards" },
  { id: "scoring", label: "Touchdown threat", blurb: "Touchdowns a game" },
  { id: "bigplay", label: "Big play", blurb: "Yards per completion, carry or catch" },
  { id: "workload", label: "Workload", blurb: "Attempts and touches a game" },
  { id: "efficiency", label: "Efficiency", blurb: "Yards and scores per attempt or touch, less turnovers" },
  { id: "star", label: "Star power", blurb: "Overall rating" },
];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
export const categoryLabel = (id) => CATEGORY_LABEL[id] || id;

// The season's raw number in each category. Never shown - only its rank is.
function rawCategories(c) {
  const g = Math.max(c.g || 0, 8); // a per-game rate over a handful of games is not a rate
  const qb = c.pos === "QB", rb = c.pos === "RB";
  const yards = qb ? c.py + c.ry : c.ry + c.rcy;
  const tds = qb ? c.ptd + c.rtd : c.rtd + c.rctd;
  const touches = qb ? c.att + c.car : c.car + c.rec;
  const bigplay = qb ? (c.py + 11.5 * 60) / (c.cmp + 60) : rb ? (c.ry + 4.2 * 80) / (c.car + 80) : (c.rcy + (c.pos === "TE" ? 10.5 : 12.5) * 40) / (c.rec + 40);
  const efficiency = qb ? (c.py + 20 * c.ptd - 45 * c.int + 6.2 * 120) / (c.att + 120)
    : rb ? (yards + 20 * tds - 40 * c.fl + 4.6 * 80) / (touches + 80)
      : (c.rcy + 20 * c.rctd - 40 * c.fl + 9.5 * 40) / (c.rec + 40);
  return { production: yards, scoring: tds / g, bigplay, workload: touches / g, efficiency, star: c.rating };
}
const eraOf = (season) => Math.max(0, WINDOWS.findIndex(([from, to]) => season >= from && season <= to));

// Expands data/cards.json. The file stores positional rows behind a `columns` list, so the shape is read from
// the file rather than assumed. Each card also gets its archetype and its six category scores.
export function initCardData(catalog) {
  const cols = catalog.columns;
  CARDS = new Map();
  const players = new Set();
  const groups = new Map(); // "<pos>|<era>" -> cards
  for (const row of catalog.cards) {
    const card = {};
    for (let i = 0; i < cols.length; i++) card[cols[i]] = row[i];
    card.archetype = cardArchetype(card);
    card.raw = rawCategories(card);
    CARDS.set(card.id, card);
    players.add(card.pid);
    const key = `${card.pos}|${eraOf(card.season)}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(card);
  }
  // 0-99 by rank within the group. Ties share the middle of the ranks they span, so the order the file lists
  // two equal seasons in can never decide anything.
  for (const group of groups.values()) {
    for (const cat of CATEGORY_IDS) {
      const sorted = group.map((c) => c.raw[cat]).sort((a, b) => a - b);
      const n = sorted.length;
      for (const card of group) {
        const v = card.raw[cat];
        let below = 0, same = 0;
        for (const x of sorted) { if (x < v) below++; else if (x === v) same++; }
        (card.cats || (card.cats = {}))[cat] = n > 1 ? Math.round((99 * (below + (same - 1) / 2)) / (n - 1)) : 50;
      }
    }
  }
  for (const card of CARDS.values()) delete card.raw;
  return { cards: CARDS.size, players: players.size };
}

// ---------- Decks, hands and teams ----------
// A DECK is thirty cards you own: 5 quarterbacks, 10 backs, 10 receivers, 5 tight ends, thirty different men.
// Each battle you are DEALT a hand of twelve from it - 2, 4, 4 and 2 - and field a TEAM of six from the hand:
// one quarterback, at least one back, one receiver and one tight end, six different men. The ORDER of the six
// is the order they play in, and it is yours to choose. So a deck is never a guaranteed lineup, and what you do
// with the hand is the game. A team is a list of { id, finish }, in playing order.
export const FINISHES = ["base", "silver", "gold", "prism"];
// What a finish adds to the card's rating in a round. Small on purpose: a finish is a flex and a tiebreaker.
export const FINISH_BONUS = { base: 0, silver: 1, gold: 2, prism: 3 };
export const ownKey = (id, finish) => `${id}:${finish}`;
export const POSITIONS = ["QB", "RB", "WR", "TE"];
export const DECK_SHAPE = { QB: 5, RB: 10, WR: 10, TE: 5 };
export const HAND_SHAPE = { QB: 2, RB: 4, WR: 4, TE: 2 };
export const DECK_SIZE = 30, HAND_SIZE = 12, TEAM_SIZE = 6;

const isEntry = (e) => e !== null && typeof e === "object" && !Array.isArray(e);
const power = (e) => CARDS.get(e.id).rating + FINISH_BONUS[e.finish];
const byPower = (a, b) => power(b) - power(a) || a.id - b.id || FINISHES.indexOf(a.finish) - FINISHES.indexOf(b.finish);

// null when the list may be saved as a deck, otherwise the first reason it may not. NEVER THROWS: it is a door a
// modified browser knocks on. `owned` is a Map of ownKey -> count, or null to skip the ownership question.
export function deckProblem(list, owned) {
  if (!Array.isArray(list)) return "malformed";
  if (list.length !== DECK_SIZE) return "bad_deck";
  for (const e of list) if (!isEntry(e)) return "malformed";
  for (const e of list) if (!CARDS.has(e.id)) return "unknown_card";
  for (const e of list) if (!FINISHES.includes(e.finish)) return "bad_finish";
  const count = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const e of list) count[CARDS.get(e.id).pos]++;
  for (const pos of POSITIONS) if (count[pos] !== DECK_SHAPE[pos]) return "bad_deck";
  const men = new Set();
  for (const e of list) { const pid = CARDS.get(e.id).pid; if (men.has(pid)) return "same_player"; men.add(pid); }
  if (owned) for (const e of list) if (!(owned.get(ownKey(e.id, e.finish)) >= 1)) return "not_owned";
  return null;
}

// The strongest legal deck out of a collection ([{ id, finish }]), or null when the collection cannot fill one.
// It is what plays for an account that never saved a deck, so nobody has to build one before a first battle.
export function bestDeck(entries) {
  const sorted = (Array.isArray(entries) ? entries : []).filter((e) => isEntry(e) && CARDS.has(e.id) && FINISHES.includes(e.finish)).sort(byPower);
  const men = new Set(), need = { ...DECK_SHAPE }, deck = [];
  for (const e of sorted) {
    const c = CARDS.get(e.id);
    if (need[c.pos] > 0 && !men.has(c.pid)) { need[c.pos]--; men.add(c.pid); deck.push({ id: e.id, finish: e.finish }); }
  }
  return deck.length === DECK_SIZE ? deck : null;
}

// Twelve of the thirty: HAND_SHAPE of each position, without replacement. EXACTLY TWELVE DRAWS, always.
// The pool is put in a fixed order first, so the same draws deal the same hand whatever order the deck was saved in.
export function dealHand(deck, rand) {
  const hand = [];
  for (const pos of POSITIONS) {
    const pool = deck.filter((e) => CARDS.get(e.id).pos === pos).sort((a, b) => a.id - b.id || FINISHES.indexOf(a.finish) - FINISHES.indexOf(b.finish));
    for (let k = 0; k < HAND_SHAPE[pos]; k++) {
      const [e] = pool.splice(Math.floor(rand() * pool.length), 1);
      hand.push({ id: e.id, finish: e.finish });
    }
  }
  return hand;
}

// null when the six may be played, otherwise the first reason they may not. NEVER THROWS.
// `hand` is the dealt hand ([{ id, finish }]), or null to skip that question (a bot, the CPU, the tests).
export function teamProblem(team, hand) {
  if (!Array.isArray(team)) return "malformed";
  for (const e of team) if (e == null) return "incomplete";
  if (team.length !== TEAM_SIZE) return team.length < TEAM_SIZE ? "incomplete" : "malformed";
  for (const e of team) if (!isEntry(e)) return "malformed";
  for (const e of team) if (!CARDS.has(e.id)) return "unknown_card";
  for (const e of team) if (!FINISHES.includes(e.finish)) return "bad_finish";
  const count = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const e of team) count[CARDS.get(e.id).pos]++;
  if (count.QB !== 1 || count.RB < 1 || count.WR < 1 || count.TE < 1) return "bad_slot";
  const men = new Set();
  for (const e of team) { const pid = CARDS.get(e.id).pid; if (men.has(pid)) return "same_player"; men.add(pid); }
  if (hand) {
    const dealt = new Set((Array.isArray(hand) ? hand : []).filter(isEntry).map((e) => ownKey(e.id, e.finish)));
    for (const e of team) if (!dealt.has(ownKey(e.id, e.finish))) return "not_in_hand";
  }
  return null;
}

// The six highest-rated cards in a hand (or any list) that make a legal team, best first; null if none can.
// The DULL choice on purpose: reading the categories, the abilities and the other side - and ordering for them -
// is the game. It is the screen's "pick for me", the CPU's lineup, and the bot every balance number is measured against.
export function bestTeam(entries) {
  const sorted = (Array.isArray(entries) ? entries : []).filter((e) => isEntry(e) && CARDS.has(e.id) && FINISHES.includes(e.finish)).sort(byPower);
  const men = new Set(), team = [];
  const take = (ok) => {
    const e = sorted.find((x) => !men.has(CARDS.get(x.id).pid) && ok(CARDS.get(x.id)));
    if (!e) return false;
    men.add(CARDS.get(e.id).pid); team.push({ id: e.id, finish: e.finish });
    return true;
  };
  for (const pos of POSITIONS) if (!take((c) => c.pos === pos)) return null;
  for (let i = 0; i < 2; i++) if (!take((c) => c.pos !== "QB")) return null;
  return team.sort(byPower);
}

// ---------- Synergies ----------
// What a side's cards do for each other: cards from the same franchise, from the same season, real teammates
// (both at once), and the archetype pairs. Small beside a category score on purpose - they tilt a close round,
// they do not decide a lopsided one.
export const TEAM_BONUS = 2, TEAM_BONUS_MAX = 6;       // per lineup-mate from the same team
export const SEASON_BONUS = 1, SEASON_BONUS_MAX = 3;   // per lineup-mate from the same season
export const TEAMMATE_BONUS = 2;                       // once, for sharing BOTH with somebody
// [archetype, archetype, points to EACH]. A pair fires once for a card however many partners it has.
export const PAIRS = [
  ["gunslinger", "deep", 6], ["gunslinger", "seam", 5], ["manager", "possession", 5], ["manager", "valve", 4],
  ["scrambler", "homerun", 5], ["volume", "receiving", 5], ["volume", "possession", 4],
];
// What the cards a side has ALREADY PLAYED this battle do for the one it plays now: [{ key, label, pts }].
// Synergy builds as the battle goes (v2.28.0) - a battle is played a round at a time, so there is no lineup to
// add up beforehand, and "who have I already put down?" is a thing a player can act on with the next card.
// `earlier` is the entries ({ id }) that side has played so far, in order.
export function playedSynergies(entry, earlier) {
  const card = CARDS.get(entry.id);
  const cards = earlier.map((e) => CARDS.get(e.id));
  const mods = [];
  const mates = cards.filter((c) => c.team === card.team).length;
  const years = cards.filter((c) => c.season === card.season).length;
  if (mates) mods.push({ key: "team", label: `${card.team} teammates`, pts: Math.min(TEAM_BONUS_MAX, TEAM_BONUS * mates) });
  if (years) mods.push({ key: "season", label: `Class of ${card.season}`, pts: Math.min(SEASON_BONUS_MAX, SEASON_BONUS * years) });
  if (cards.some((c) => c.team === card.team && c.season === card.season)) mods.push({ key: "mates", label: "Real teammates", pts: TEAMMATE_BONUS });
  const fielded = new Set(cards.map((c) => c.archetype));
  for (const [a, b, pts] of PAIRS) {
    const partner = card.archetype === a ? b : card.archetype === b ? a : null;
    if (partner && fielded.has(partner)) mods.push({ key: `pair:${a}+${b}`, label: `${archetypeLabel(a)} + ${archetypeLabel(b)}`, pts });
  }
  return mods;
}

// ---------- Abilities ----------
// One small rule an archetype. `when` says, for the round being played, whether it fires; a card whose ability
// does not fire is still SHOWN it ("Clutch: not this round"), because seeing why a bonus did not land is how a
// player learns to order the six. A Role player has none.
//   round: { cat, wins, losses, prevWon, qbPlayed, prevArchetype, foeRating, rating }
//     wins/losses  the battle so far, from this card's side
//     prevWon      whether this side's previous card won its round (null in round one)
//     qbPlayed     whether this side's quarterback has already played
// Two are not a bonus of their own and are handled in scoreBattle: the Game manager lifts the NEXT card his side
// plays, and the Safety valve cancels the ability of the card across from him.
export const ABILITY_NEXT = 4; // what a Game manager hands the next card
export const ABILITIES = {
  gunslinger: { name: "Air it out", text: "+6 in a Big play round, and his luck swings wider.", pts: 6, when: (r) => r.cat === "bigplay" },
  scrambler: { name: "Escape artist", text: "+6 against a higher-rated card.", pts: 6, when: (r) => r.foeRating > r.rating },
  volume: { name: "Pile it on", text: "+5 in a Workload or Production round.", pts: 5, when: (r) => r.cat === "workload" || r.cat === "production" },
  manager: { name: "Field general", text: `The next card you play gets +${ABILITY_NEXT}.`, pts: 0, when: () => false, next: true },
  workhorse: { name: "Momentum", text: "+5 if your last card won its round.", pts: 5, when: (r) => r.prevWon === true },
  goalline: { name: "Punch it in", text: "+6 in a Touchdown threat round.", pts: 6, when: (r) => r.cat === "scoring" },
  homerun: { name: "Home run", text: "+6 in a Big play round.", pts: 6, when: (r) => r.cat === "bigplay" },
  receiving: { name: "Outlet", text: "+5 once your quarterback has played.", pts: 5, when: (r) => r.qbPlayed },
  deep: { name: "Go route", text: "+6 once your quarterback has played.", pts: 6, when: (r) => r.qbPlayed },
  redzone: { name: "Red zone", text: "+6 in a Touchdown threat round.", pts: 6, when: (r) => r.cat === "scoring" },
  possession: { name: "Chain mover", text: "+5 in a Workload or Efficiency round.", pts: 5, when: (r) => r.cat === "workload" || r.cat === "efficiency" },
  seam: { name: "Clutch", text: "+7 when you are behind in the battle.", pts: 7, when: (r) => r.losses > r.wins },
  valve: { name: "Security blanket", text: "Cancels the ability of the card across from him.", pts: 0, when: () => false, cancels: true },
};
export const abilityOf = (card) => ABILITIES[card.archetype] || null;

// ---------- A battle ----------
// Six rounds, your six against theirs, in the order each side set. Each round is one CATEGORY - all six come up
// exactly once, in an order nobody knows until it is played - and each card's round is:
//
//   RATING_SHARE of its rating (and finish) + the rest from its category score, + synergies, + its ability
//   if it fires, + luck
//
// The higher total takes the round; win more rounds than the other side to win the battle, and a 3-3 split goes
// to the higher six-round total (then to you - the home side takes a dead heat). So the overall rating is part
// of every round and never the whole of one: the card whose season was BUILT for the category beats a better
// card that was not, which is the point.
//
// THE NUMBERS ARE TUNED, NOT CHOSEN - tests/test-card-balance.mjs plays thousands of battles and prints what
// they do. The KEYS are the design: which archetype does what, and who plays better beside whom.
//
// THE DRAWS ARE COUNTED. Five to order the categories, then four a round (two a card, yours first): twenty-nine
// a battle, always, whatever the cards are and whatever fires. The browser and the Edge Function run different
// JavaScript engines and have to walk the generator in step (game-logic.mjs's smallTimSort has the history).
export const CAT_SCALE = 1.3;     // a category score (0-99) put on the rating's scale (about 20-130)
export const RATING_SHARE = 0.4;  // how much of a round is the card's overall rating; the rest is the category
export const LUCK_SPREAD = 14;    // a card's luck is a triangular roll within this, either way
export const LUCK_WIDE = 1.5;     // ...times this for a Gunslinger
const round1 = (n) => Math.round(n * 10) / 10;

// "142 yards, 2 TD": the card's real per-game line, scaled by how its round went. Display only, no draw.
function playLine(card, base, total) {
  const k = base > 0 ? Math.max(0, total) / base : 0;
  const g = card.g > 0 ? card.g : 1;
  const yards = card.pos === "QB" ? card.py : card.pos === "RB" ? card.ry : card.rcy;
  const tds = card.pos === "QB" ? card.ptd + card.rtd : card.rtd + card.rctd;
  return `${Math.round((yards / g) * k).toLocaleString("en-US")} yards, ${Math.round((tds / g) * k)} TD`;
}

// A card's round before luck: what the screen shows a player who is deciding where to play him.
export const roundBase = (entry, cat) => round1(RATING_SHARE * (CARDS.get(entry.id).rating + FINISH_BONUS[entry.finish]) + (1 - RATING_SHARE) * CAT_SCALE * CARDS.get(entry.id).cats[cat]);

// ONE ROUND AT A TIME, ONE SPOT A ROUND (v2.28.0). The owner's question about the first version was the right
// one: if you set all six and their order before anything is known, where is the choice? So a battle is PLAYED
// a round at a time. Each round is for one spot of the lineup - QB, RB, WR, TE and two Flex - in an order that
// is random for the battle except that THE LAST IS ALWAYS A FLEX (the owner's rule). You see the spot, the card
// you are facing and which categories are still to come; you commit a card from your HAND that fits; only then
// is the category revealed. Everything a round needs about the battle so far - the score, whether your last
// card won, whether your quarterback has played, who is already down - follows from the rounds played.
export const SPOTS = ["QB", "RB", "WR", "TE", "FLEX", "FLEX"];
export const spotFits = (pos, spot) => (spot === "FLEX" ? pos !== "QB" : pos === spot);
const SPOT_LABEL = { QB: "Quarterback", RB: "Running back", WR: "Receiver", TE: "Tight end", FLEX: "Flex" };
export const spotLabel = (spot) => SPOT_LABEL[spot] || spot;

// null when `entry` may be played next, otherwise why not. NEVER THROWS - it is the door a modified browser
// knocks on. The card has to be in the hand, fit the round's spot, and be a man not already played.
// `foe` is the other side's six, each carrying the `spot` it plays; round n is for foe[n].spot.
export function roundProblem(hand, foe, rounds, entry) {
  if (!Array.isArray(hand) || !Array.isArray(foe) || !Array.isArray(rounds) || rounds.length >= TEAM_SIZE || !isEntry(foe[rounds.length])) return "malformed";
  if (!isEntry(entry)) return "malformed";
  if (!CARDS.has(entry.id)) return "unknown_card";
  if (!FINISHES.includes(entry.finish)) return "bad_finish";
  if (!hand.some((e) => isEntry(e) && e.id === entry.id && e.finish === entry.finish)) return "not_in_hand";
  if (!spotFits(CARDS.get(entry.id).pos, foe[rounds.length].spot)) return "bad_slot";
  if (rounds.some((r) => r.mine.id === entry.id && r.mine.finish === entry.finish)) return "already_played";
  if (rounds.some((r) => CARDS.get(r.mine.id)?.pid === CARDS.get(entry.id).pid)) return "same_player";
  return null;
}

// The cards in a hand that may be played next, best first.
export function playable(hand, foe, rounds) {
  return hand.filter((e) => roundProblem(hand, foe, rounds, e) === null).sort(byPower);
}

// The highest-rated card that may be played next WITHOUT leaving a later spot nobody can fill - a Flex round
// must not eat the only tight end left when the tight end's round is still to come. The DULL choice on purpose:
// it is the screen's "Pick for me" and the bot every balance number is measured against.
export function autoPick(hand, foe, rounds) {
  const e = playable(hand, foe, rounds).find((x) => leavesAWay(hand, foe, rounds, x));
  return e ? { id: e.id, finish: e.finish } : null;
}
// Would playing `entry` now still leave a card for every spot to come? A hand dealt from a deck always can
// finish a battle; this is what stops a careless pick (or a bot) spending the card a later spot needs.
export function leavesAWay(hand, foe, rounds, entry) {
  const later = foe.slice(rounds.length + 1).map((e) => e.spot);
  const used = new Set(rounds.map((r) => CARDS.get(r.mine.id).pid));
  const left = hand.filter((h) => !(h.id === entry.id && h.finish === entry.finish) && !used.has(CARDS.get(h.id).pid) && CARDS.get(h.id).pid !== CARDS.get(entry.id).pid);
  const have = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const h of left) have[CARDS.get(h.id).pos]++;
  const need = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const spot of later) if (spot !== "FLEX") need[spot]++;
  const flex = later.filter((s) => s === "FLEX").length;
  const spare = ["RB", "WR", "TE"].reduce((n, p) => n + Math.max(0, have[p] - need[p]), 0);
  return POSITIONS.every((p) => have[p] >= need[p]) && spare >= flex;
}

// Play the next round: `entry` against the card the other side has in this spot, on `cat`. EXACTLY FOUR DRAWS,
// yours first. Trusts its input - roundProblem is the door.
// `foeEdge` is points added to their card - the ladder's, once its teams cannot be made of better cards than
// the game holds (see ladderEdge).
export function playRound(foe, rounds, entry, cat, rand, foeEdge = 0) {
  const i = rounds.length;
  const last = rounds[i - 1] || null;
  const side = (mine) => {
    const e = mine ? entry : foe[i], who = mine ? "mine" : "foe", won = mine ? "me" : "foe";
    return {
      entry: e, card: CARDS.get(e.id), syn: playedSynergies(e, rounds.map((r) => r[who])), wins: rounds.filter((r) => r.win === won).length,
      prevWon: last ? last.win === won : null, qbPlayed: rounds.some((r) => CARDS.get(r[who].id).pos === "QB"), prevArchetype: last ? CARDS.get(last[who].id).archetype : null,
    };
  };
  const sides = [side(true), side(false)];
  const rolls = sides.map((s) => round1((rand() + rand() - 1) * LUCK_SPREAD * (s.card.archetype === "gunslinger" ? LUCK_WIDE : 1)));
  const shown = sides.map((me, s) => {
    const other = sides[1 - s];
    const ability = abilityOf(me.card);
    const cancelled = !!abilityOf(other.card)?.cancels;
    const ctx = { cat, wins: me.wins, losses: other.wins, prevWon: me.prevWon, qbPlayed: me.qbPlayed, foeRating: other.card.rating, rating: me.card.rating };
    const fires = !!ability && !cancelled && ability.when(ctx) === true;
    const mods = me.syn.slice();
    if (me.prevArchetype === "manager") mods.push({ key: "next", label: "Field general", pts: ABILITY_NEXT });
    if (s === 1 && foeEdge > 0) mods.push({ key: "edge", label: "Top of the ladder", pts: foeEdge });
    if (fires && ability.pts) mods.push({ key: "ability", label: ability.name, pts: ability.pts });
    const base = roundBase(me.entry, cat);
    const total = round1(base + rolls[s] + mods.reduce((n, m) => n + m.pts, 0));
    return {
      id: me.card.id, finish: me.entry.finish, rating: me.card.rating + FINISH_BONUS[me.entry.finish], score: me.card.cats[cat], base, roll: rolls[s], mods, total,
      ability: ability ? { name: ability.name, on: fires || !!ability.next || (!!ability.cancels && !!abilityOf(other.card)), cancelled: cancelled && !!ability && !ability.cancels } : null,
      line: playLine(me.card, base, total),
    };
  });
  const win = shown[0].total > shown[1].total ? "me" : shown[0].total < shown[1].total ? "foe" : "tie";
  return { cat, spot: foe[i].spot, mine: shown[0], foe: shown[1], win, score: [sides[0].wins + (win === "me" ? 1 : 0), sides[1].wins + (win === "foe" ? 1 : 0)] };
}

// Where a battle stands after the rounds played: more rounds wins; level on rounds, the higher total; dead
// level, you. Meaningful as a RESULT only once all six are in.
export function battleResult(rounds) {
  const wins = rounds.filter((r) => r.win === "me").length, losses = rounds.filter((r) => r.win === "foe").length;
  const total = round1(rounds.reduce((n, r) => n + r.mine.total, 0)), foeTotal = round1(rounds.reduce((n, r) => n + r.foe.total, 0));
  return { rounds, wins, losses, total, foeTotal, win: wins !== losses ? wins > losses : total >= foeTotal };
}

// The six categories in a random order. FIVE DRAWS.
export function shuffleCategories(rand) {
  const order = CATEGORY_IDS.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
}

// A whole battle in one go: `mine` is your six in the order of the other side's spots (mine[n] plays round n).
// What the bots and the pinned checksum use. Twenty-nine draws - five for the categories (made and thrown away
// when `cats` hands the order in, so the count never depends on who called), then four a round.
export function scoreBattle(mine, foe, rand, cats = null, foeEdge = 0) {
  const order = shuffleCategories(rand);
  const play = Array.isArray(cats) && cats.length === TEAM_SIZE ? cats : order;
  const rounds = [];
  for (let i = 0; i < TEAM_SIZE; i++) rounds.push(playRound(foe, rounds, mine[i], play[i], rand, foeEdge));
  return battleResult(rounds);
}
// Six cards out of a hand for the six rounds against `foe`, by autoPick each round: the dull lineup.
export function autoLineup(hand, foe) {
  const picks = [], rounds = [];
  for (let i = 0; i < TEAM_SIZE; i++) {
    const e = autoPick(hand, foe, rounds);
    if (!e) return null;
    picks.push(e); rounds.push({ mine: e });
  }
  return picks;
}

// ---------- The other side ----------
// The CPU plays the same kind of cards you collect. A CPU team is built round a target rating: one card of each
// position and two more, each the nearest to the target the catalog holds (within CPU_BAND, widening only if a
// position has nobody there), six different men. Each card carries the SPOT it plays, and the order they play
// in is the order of a battle's rounds: random, except that the last is always a Flex. TEN DRAWS, always.
export const CPU_BAND = 9;
export function buildTeam(rand, target) {
  const all = [...CARDS.values()].sort((a, b) => a.id - b.id);
  const men = new Set(), team = [];
  for (const spot of SPOTS) {
    const x = rand();
    let pool = [];
    for (let band = CPU_BAND; !pool.length; band += CPU_BAND) {
      pool = all.filter((c) => !men.has(c.pid) && spotFits(c.pos, spot) && Math.abs(c.rating - target) <= band);
    }
    const card = pool[Math.floor(x * pool.length)];
    men.add(card.pid); team.push({ id: card.id, finish: "base", spot });
  }
  // The first five in a random order; the sixth - the second Flex - stays last.
  for (let i = team.length - 2; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [team[i], team[j]] = [team[j], team[i]]; }
  return team;
}

// THE LADDER. A run is CPU teams one after another until a loss, and every win makes the next one stronger.
// WHICH team stands at each step follows from a seed the server made when the run began and from nothing else,
// so leaving, reloading or walking away can never re-roll an opponent. Your HAND for a step is dealt by the
// server when the step begins and stored with the run, for the same reason.
export const CPU_START = 38;   // the first team's target rating
export const CPU_STEP = 7;     // ...and what each win adds
export const CPU_MAX = 124;
const stepOf = (step) => (Number.isFinite(step) && step > 0 ? Math.floor(step) : 0);
export const ladderTarget = (step) => Math.min(CPU_MAX, CPU_START + CPU_STEP * stepOf(step));
// Past the best cards the game holds the ladder cannot field a stronger team, so it fields the strongest one
// and plays it harder: every card of theirs gets this many points a round. Without it the best collections
// never met a team that could stop them, and a run went on until the player got bored.
export const CPU_EDGE = 0.6;   // of each point the target would have risen past CPU_MAX
export const ladderEdge = (step) => round1(CPU_EDGE * Math.max(0, CPU_START + CPU_STEP * stepOf(step) - CPU_MAX));
export const ladderFoe = (seed, step) => buildTeam(mulberry32(hashStr(`ladder-${seed}|${Number.isFinite(step) && step > 0 ? Math.floor(step) : 0}`)), ladderTarget(step));
const TIERS = ["Practice squad", "Rookies", "Backups", "Starters", "Veterans", "Pro Bowlers", "All-Pros", "Legends", "Hall of Famers", "The GOATs"];
export const ladderName = (step) => TIERS[Math.min(TIERS.length - 1, Math.max(0, Math.floor((Number.isFinite(step) ? step : 0) / 2)))];

// THE DAILY BATTLE. One CPU team a day, the same for everyone, the six categories in the same order for
// everyone, and ONE ROLL PER CARD PER DAY: a card has the same luck today in every lineup that fields it, in any
// spot. So the board rewards the six you pick and the order you put them in, not the roll. (The first design
// seeded luck from the whole lineup, and review found swapping two cards re-rolled all six.) Your hand is dealt
// by the server, once, and stored - a hand that followed from the deck could be re-dealt by editing the deck.
//
// Accepted gap, the one every seeded daily in this game has: the bundle and the seed are public, so anybody
// willing to run this file can find the day's best lineup for their hand offline.
export const DAILY_TARGET = 86;
export const dailySeed = (date) => `card-daily-${date}`;
export const dailyFoe = (date) => buildTeam(mulberry32(hashStr(`${dailySeed(date)}|foe`)), DAILY_TARGET);
export const dailyCategories = (date) => shuffleCategories(mulberry32(hashStr(`${dailySeed(date)}|cats`)));
// One round of the day's battle: `entry` against the day's team, on the day's category for that round, with
// your card's own two draws for the day and then the CPU card's own two.
export function dailyRound(date, rounds, entry) {
  const foe = dailyFoe(date);
  const draws = [];
  for (const [tag, e] of [["you", entry], ["cpu", foe[rounds.length]]]) {
    const own = mulberry32(hashStr(`${dailySeed(date)}|${tag}|card${e.id}`));
    draws.push(own(), own());
  }
  let i = 0;
  return playRound(foe, rounds, entry, dailyCategories(date)[rounds.length], () => draws[i++]);
}
// The whole of it, your six in the order of the day's spots.
export function dailyBattle(date, mine) {
  const rounds = [];
  for (const entry of mine) rounds.push(dailyRound(date, rounds, entry));
  return battleResult(rounds);
}
// What a daily battle is ranked by: rounds won first, then your six-round total.
export const dailyScore = (result) => ({ rounds: result.wins, score: result.total });

// ---------- Getting cards ----------
// The rules for which cards a player is handed. The CHOOSING happens on the server - the card-claim Edge
// Function for a starter deck, submit-run for the daily card - with a cryptographic `rand`; these functions
// only say what a legal choice is, so the tests can deal ten thousand of them with a seeded one.

// THE STARTER CARDS FILL A DECK (v2.27.0). A battle needs a deck of thirty, so the starter is no longer eight
// cards: it is however many Base cards from the lower-rated pool it takes to bring a collection up to
// DECK_SHAPE - thirty for a new account, and the difference for one that opened the old eight-card deck.
// `entries` is what the account holds now ([{ id, finish }]). Each card granted is a man the account does not
// have, and its ref is "deck:<POS>:<n>", n counting that position's deck spots from zero - so the same spot can
// never be filled twice, however often this is asked. One draw a card granted.
export const STARTER_MAX_RATING = 60;
export function starterFill(entries, rand) {
  const held = (Array.isArray(entries) ? entries : []).filter((e) => isEntry(e) && CARDS.has(e.id));
  const men = new Set(held.map((e) => CARDS.get(e.id).pid));
  const pool = [...CARDS.values()].filter((c) => c.rating < STARTER_MAX_RATING).sort((x, y) => x.id - y.id);
  const out = [];
  for (const pos of POSITIONS) {
    const have = new Set(held.filter((e) => CARDS.get(e.id).pos === pos).map((e) => CARDS.get(e.id).pid)).size;
    for (let n = have; n < DECK_SHAPE[pos]; n++) {
      const able = pool.filter((c) => c.pos === pos && !men.has(c.pid));
      const card = able[Math.floor(rand() * able.length)];
      men.add(card.pid);
      out.push({ ref: `deck:${pos}:${n}`, id: card.id, finish: "base" });
    }
  }
  return out;
}

// The finish is rolled separately from the player, so any card can come in any finish. One draw.
// These are the daily card's odds; a pack will bring its own (they are data, not rules).
export const DAILY_FINISH_ODDS = { base: 0.80, silver: 0.16, gold: 0.035, prism: 0.005 };
export function rollFinish(rand, odds = DAILY_FINISH_ODDS) {
  const x = rand();
  let edge = 0;
  for (const finish of FINISHES) {
    edge += odds[finish] || 0;
    if (x < edge) return finish;
  }
  return FINISHES[FINISHES.length - 1]; // a roll at the very top, or odds that rounding left a hair short of one
}

// The draft board a card came off: "<team>|<era index>", the same key game-logic.mjs's BOARDS uses.
export function cardBoardKey(card) {
  const w = WINDOWS.findIndex(([from, to]) => card.season >= from && card.season <= to);
  return `${card.team}|${w}`;
}

// The card a finished daily draft earns: any card off any of the boards that day dealt, at equal odds, then a
// finish. Exactly two draws when it returns a card. null when the boards hold no card - which a real daily's
// never do, and which the caller treats as "no card today" rather than as an error.
export function dailyCard(boardKeys, rand) {
  const keys = new Set(Array.isArray(boardKeys) ? boardKeys : []);
  const able = [...CARDS.values()].filter((c) => keys.has(cardBoardKey(c))).sort((a, b) => a.id - b.id);
  if (!able.length) return null;
  const card = able[Math.floor(rand() * able.length)];
  return { id: card.id, finish: rollFinish(rand) };
}
