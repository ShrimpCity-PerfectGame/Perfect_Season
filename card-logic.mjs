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

import { WINDOWS, BOARDS, hashStr, mulberry32 } from "./game-logic.mjs";

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
// THE NUMBER BEHIND A CATEGORY, in words: what the season really was, for the screen to print beside the score.
// A category score is a RANK (0-99, at his position, in his era); this is the thing that was ranked. Display
// only - nothing is scored from it. The per-touch ones are printed as they were, without the shrinkage the
// ranking uses, because "13.2 yards a catch" is the number a fan knows.
const one = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function categoryStat(card, cat) {
  const c = card;
  if (!c) return "";
  const qb = c.pos === "QB", rb = c.pos === "RB";
  const yards = qb ? c.py + c.ry : c.ry + c.rcy;
  const tds = qb ? c.ptd + c.rtd : c.rtd + c.rctd;
  const touches = qb ? c.att + c.car : c.car + c.rec;
  const g = c.g > 0 ? c.g : 1;
  const per = (a, b) => (b > 0 ? a / b : 0);
  if (cat === "production") return `${yards.toLocaleString("en-US")} total yards`;
  if (cat === "scoring") return `${tds} TD in ${c.g} ${c.g === 1 ? "game" : "games"}`;
  if (cat === "bigplay") return qb ? `${one(per(c.py, c.cmp))} yards a completion` : rb ? `${one(per(c.ry, c.car))} yards a carry` : `${one(per(c.rcy, c.rec))} yards a catch`;
  if (cat === "workload") return `${one(touches / g)} ${qb ? "throws and runs" : "touches"} a game`;
  if (cat === "efficiency") return qb ? `${one(per(c.py, c.att))} yards a throw, ${c.ptd} TD, ${c.int} INT` : `${one(per(yards, touches))} yards a touch, ${tds} TD, ${c.fl} lost`;
  if (cat === "star") return `Rated ${Math.round(c.rating)} overall`;
  return "";
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
// What a finish adds to EVERY round the card plays, whole (the owner's numbers, v2.28.1: "5 10 15"). The card
// face prints it beside the rating and the battle names it as a bonus.
export const FINISH_BONUS = { base: 0, silver: 5, gold: 10, prism: 15 };
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
  if (POSITIONS.some((p) => count[p] !== LINEUP_SHAPE[p])) return "bad_slot";
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
  for (const spot of SPOTS) if (!take((c) => spotFits(c.pos, spot))) return null;
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
// THE DRAWS ARE COUNTED. Four a round (two a card, yours first): twenty-four a battle, always, whatever the
// cards are and whatever fires - and none to order the categories, which are CALLED now (v2.31.0, below). The
// browser and the Edge Function run different JavaScript engines and have to walk the generator in step
// (game-logic.mjs's smallTimSort has the history).
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
// A FINISH IS NOT IN HERE (v2.28.1). It used to be added to the rating, so only RATING_SHARE of it reached a
// round - Silver was worth 0.4 of a point. The owner asked what the "+1" on a card does in a battle; now it does
// what it says: playRound adds FINISH_BONUS whole, as a bonus of its own that the screen names.
export const roundBase = (entry, cat) => round1(RATING_SHARE * CARDS.get(entry.id).rating + (1 - RATING_SHARE) * CAT_SCALE * CARDS.get(entry.id).cats[cat]);
const FINISH_LABEL = { silver: "Silver finish", gold: "Gold finish", prism: "Prism finish" };

// ONE ROUND AT A TIME, ONE SPOT A ROUND (v2.28.0). The owner's question about the first version was the right
// one: if you set all six and their order before anything is known, where is the choice? So a battle is PLAYED
// a round at a time. Each round is for one spot of the lineup, in an order that is random for the battle.
// Everything a round needs about the battle so far - the score, whether your last card won, whether your
// quarterback has played, who is already down, WHO CALLS - follows from the rounds played.
//
// NO FLEX (v2.31.0, the owner's call after playing it): a Flex round offered every back, receiver and tight end
// left in the hand, "a ton of players". A lineup is a quarterback, two backs, two receivers and a tight end, so
// a round offers two to four cards and never more. spotFits still answers for "FLEX": a battle begun before
// this shipped has two, and has to be able to finish.
export const SPOTS = ["QB", "RB", "RB", "WR", "WR", "TE"];
const SPOT_NAMES = new Set([...SPOTS, "FLEX"]); // every spot a stored team may carry, old or new
const LINEUP_SHAPE = SPOTS.reduce((n, s) => ({ ...n, [s]: (n[s] || 0) + 1 }), { QB: 0, RB: 0, WR: 0, TE: 0 });
export const spotFits = (pos, spot) => (spot === "FLEX" ? pos !== "QB" : pos === spot);
const SPOT_LABEL = { QB: "Quarterback", RB: "Running back", WR: "Receiver", TE: "Tight end", FLEX: "Flex" };
export const spotLabel = (spot) => SPOT_LABEL[spot] || spot;

// THE CALL (v2.31.0). The owner played three versions and each failed the same test from a different side:
// with everything on show a round was "read off the bigger number", and with the category hidden until the
// card was down it was a guess - measured, choosing as well as the screen allowed beat always playing the
// highest rating by three battles in a hundred. A choice needs something you know and something you give up.
// So a round's category is CALLED before the card is picked:
//
//   - you call round one; after that WHOEVER WON THE LAST ROUND calls; a dead heat leaves the call where it was
//   - on your call you name a category not yet used, and then a card
//   - on theirs they name their card's best category of the ones left, and you choose who answers it
//   - each category is used once a battle, so the sixth round's is whichever is left
//
// Their card is still hidden until yours is down. Who calls follows from the rounds played and nothing else.
export const leftCategories = (rounds) => CATEGORY_IDS.filter((c) => !rounds.some((r) => r && r.cat === c));
export function callerOf(rounds) {
  let by = "me";
  for (const r of rounds) if (r && (r.win === "me" || r.win === "foe")) by = r.win;
  return by;
}
// What a card is worth in a category before luck and before the battle: its base, plus an ability that fires on
// the CATEGORY and on nothing else. An ability that waits on the battle so far (Momentum, Clutch, Go route) is
// not counted - nobody can call it into being. This is what the CPU calls on and what "Pick for me" calls on.
const CALM = { wins: 0, losses: 0, prevWon: null, qbPlayed: false, foeRating: 0, rating: 0 };
export function categoryWorth(entry, cat) {
  const ability = abilityOf(CARDS.get(entry.id));
  return round1(roundBase(entry, cat) + (ability && ability.pts && ability.when({ ...CALM, cat }) === true ? ability.pts : 0));
}
const bestOf = (entry, left) => { let best = null, top = -Infinity; for (const c of left) { const w = categoryWorth(entry, c); if (w > top) { top = w; best = c; } } return best; };
// The category of the ones left that a card is worth most in. Ties go to the catalog's order. NO DRAWS.
export const bestCategory = (entry, rounds) => bestOf(entry, leftCategories(rounds));
// THEIR call for the round to come: their card's best. null when that card cannot be read (the ladder hides
// it from the browser - see `next` on a round) or the battle is full.
export function foeCall(foe, rounds) {
  const e = Array.isArray(foe) && rounds.length < TEAM_SIZE ? foe[rounds.length] : null;
  return isEntry(e) && CARDS.has(e.id) ? bestOf(e, leftCategories(rounds)) : null;
}
// The call for the round to come: { by, cat }. `cat` is set when it is already decided - on their call, or
// when one category is left - and null when it is yours to choose. null once six rounds are played.
export function nextCall(foe, rounds) {
  if (rounds.length >= TEAM_SIZE) return null;
  const by = callerOf(rounds), left = leftCategories(rounds);
  return { by, cat: by === "foe" ? foeCall(foe, rounds) : left.length === 1 ? left[0] : null };
}

// null when `entry` may be played next, otherwise why not. NEVER THROWS. The card has to be in the hand, fit the
// round's spot, and be a man not already played. This is the CARD's half of the door - what the screen and the
// bots ask to know what a hand may play; roundProblem below is the whole door, and the one the server uses.
// `foe` is the other side's six, each carrying the `spot` it plays; round n is for foe[n].spot.
export function cardProblem(hand, foe, rounds, entry) {
  if (!Array.isArray(hand) || !Array.isArray(foe) || !Array.isArray(rounds) || rounds.length >= TEAM_SIZE || !isEntry(foe[rounds.length]) || !SPOT_NAMES.has(foe[rounds.length].spot)) return "malformed";
  if (!isEntry(entry)) return "malformed";
  if (!CARDS.has(entry.id)) return "unknown_card";
  if (!FINISHES.includes(entry.finish)) return "bad_finish";
  if (!hand.some((e) => isEntry(e) && e.id === entry.id && e.finish === entry.finish)) return "not_in_hand";
  if (!spotFits(CARDS.get(entry.id).pos, foe[rounds.length].spot)) return "bad_slot";
  if (rounds.some((r) => r.mine.id === entry.id && r.mine.finish === entry.finish)) return "already_played";
  if (rounds.some((r) => CARDS.get(r.mine.id)?.pid === CARDS.get(entry.id).pid)) return "same_player";
  return null;
}
// THE DOOR a modified browser knocks on: the card, and then the category. On YOUR call `cat` has to be one not
// yet used ("bad_cat" - missing, made up or spent). On THEIR call it is not looked at: the round is played on
// foeCall whatever was sent, so there is nothing a client can gain by sending one. NEVER THROWS.
export function roundProblem(hand, foe, rounds, entry, cat) {
  const card = cardProblem(hand, foe, rounds, entry);
  if (card) return card;
  if (callerOf(rounds) === "me" && !leftCategories(rounds).includes(cat)) return "bad_cat";
  return null;
}

// The cards in a hand that may be played next, best first.
export function playable(hand, foe, rounds) {
  return hand.filter((e) => cardProblem(hand, foe, rounds, e) === null).sort(byPower);
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

// Play the next round: `entry` against the card the other side has in this spot. EXACTLY FOUR DRAWS, yours
// first. Trusts its input - roundProblem is the door.
// `cat` is the category YOU called. On their call it is ignored and the round is played on foeCall - decided
// here rather than by each caller, so the function, the mock and the bots cannot disagree about it.
// `foeEdge` is points added to their card - the ladder's, once its teams cannot be made of better cards than
// the game holds (see ladderEdge).
// The result says who called (`call`) and carries the call for the round to come (`next`, null after the
// sixth): the ladder hides their cards from the browser, which therefore cannot work their call out, and a
// round is stored as it is written - so this is also how a reloaded page learns it.
export function playRound(foe, rounds, entry, cat, rand, foeEdge = 0, edgeLabel = null) {
  const i = rounds.length;
  const call = callerOf(rounds);
  if (call === "foe") cat = foeCall(foe, rounds) || cat;
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
    if (FINISH_BONUS[me.entry.finish] > 0) mods.push({ key: "finish", label: FINISH_LABEL[me.entry.finish], pts: FINISH_BONUS[me.entry.finish] });
    if (me.prevArchetype === "manager") mods.push({ key: "next", label: "Field general", pts: ABILITY_NEXT });
    if (s === 1 && (foeEdge > 0 || (foeEdge < 0 && edgeLabel))) mods.push({ key: "edge", label: edgeLabel || "Top of the ladder", pts: foeEdge });
    if (fires && ability.pts) mods.push({ key: "ability", label: ability.name, pts: ability.pts });
    const base = roundBase(me.entry, cat);
    const total = round1(base + rolls[s] + mods.reduce((n, m) => n + m.pts, 0));
    return {
      id: me.card.id, finish: me.entry.finish, rating: me.card.rating, score: me.card.cats[cat], base, roll: rolls[s], mods, total,
      ability: ability ? { name: ability.name, on: fires || !!ability.next || (!!ability.cancels && !!abilityOf(other.card)), cancelled: cancelled && !!ability && !ability.cancels } : null,
      line: playLine(me.card, base, total),
    };
  });
  const win = shown[0].total > shown[1].total ? "me" : shown[0].total < shown[1].total ? "foe" : "tie";
  const round = { cat, spot: foe[i].spot, call, mine: shown[0], foe: shown[1], win, score: [sides[0].wins + (win === "me" ? 1 : 0), sides[1].wins + (win === "foe" ? 1 : 0)] };
  round.next = nextCall(foe, [...rounds, round]);
  return round;
}

// Where a battle stands after the rounds played: more rounds wins; level on rounds, the higher total; dead
// level, you. Meaningful as a RESULT only once all six are in.
export function battleResult(rounds) {
  const wins = rounds.filter((r) => r.win === "me").length, losses = rounds.filter((r) => r.win === "foe").length;
  const total = round1(rounds.reduce((n, r) => n + r.mine.total, 0)), foeTotal = round1(rounds.reduce((n, r) => n + r.foe.total, 0));
  return { rounds, wins, losses, total, foeTotal, win: wins !== losses ? wins > losses : total >= foeTotal };
}

// The category a card is played on when it is yours to call: the one handed in with it (`entry.cat`) if that
// is still left, otherwise the card's best. For the bots, the tests and "Pick for me" - a player's own call
// goes through roundProblem.
const calledCat = (entry, rounds) => (leftCategories(rounds).includes(entry.cat) ? entry.cat : bestCategory(entry, rounds));

// A whole battle in one go: `mine` is your six in the order of the other side's spots (mine[n] plays round n),
// each optionally carrying the `cat` to call if the call is yours. What the bots and the pinned checksum use.
// TWENTY-FOUR DRAWS: four a round.
export function scoreBattle(mine, foe, rand, foeEdge = 0) {
  const rounds = [];
  for (let i = 0; i < TEAM_SIZE; i++) rounds.push(playRound(foe, rounds, mine[i], calledCat(mine[i], rounds), rand, foeEdge));
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

// THEIR CARD IS A SURPRISE (v2.28.1, the owner's call after playing it): you are shown the SPOT a round is for
// and not the card across from you until yours is down. So what a browser is handed of the other side is the
// cards already played and, for the rest, the spot alone. Server and mock both send a team through this.
export const maskFoe = (foe, played) => foe.map((e, i) => (i < played ? e : { spot: e.spot }));

// ---------- The other side ----------
// The CPU plays the same kind of cards you collect. A CPU team is built round a target rating: one card of each
// spot, each the nearest to the target the catalog holds (within CPU_BAND, widening only if a position has
// nobody there), six different men. Each card carries the SPOT it plays, and the order they play in is the
// order of a battle's rounds: all six shuffled. ELEVEN DRAWS, always - six cards and five to order them.
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
  // All six in a random order (until v2.31.0 the last was always a Flex; there is none now).
  for (let i = team.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [team[i], team[j]] = [team[j], team[i]]; }
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

// THE DAILY BATTLE. One CPU team a day, the same for everyone, calling the same way for everyone, and ONE ROLL
// PER CARD PER DAY: a card has the same luck today in every lineup that fields it, in any spot. So the board
// rewards the six you pick, where you play them and what you call, not the roll. (The first design
// seeded luck from the whole lineup, and review found swapping two cards re-rolled all six.) Your hand is dealt
// by the server, once, and stored - a hand that followed from the deck could be re-dealt by editing the deck.
//
// Accepted gap, the one every seeded daily in this game has: the bundle and the seed are public, so anybody
// willing to run this file can find the day's best lineup for their hand offline.
export const DAILY_TARGET = 86;
export const dailySeed = (date) => `card-daily-${date}`;
export const dailyFoe = (date) => buildTeam(mulberry32(hashStr(`${dailySeed(date)}|foe`)), DAILY_TARGET);
// One round of the day's battle: `entry` against the day's team, on the category called (`cat` is yours; on
// their call playRound uses theirs), with your card's own two draws for the day and then the CPU card's own two.
export function dailyRound(date, rounds, entry, cat) {
  const foe = dailyFoe(date);
  const draws = [];
  for (const [tag, e] of [["you", entry], ["cpu", foe[rounds.length]]]) {
    const own = mulberry32(hashStr(`${dailySeed(date)}|${tag}|card${e.id}`));
    draws.push(own(), own());
  }
  let i = 0;
  return playRound(foe, rounds, entry, cat, () => draws[i++]);
}
// The whole of it, your six in the order of the day's spots, each optionally carrying the `cat` to call.
export function dailyBattle(date, mine) {
  const rounds = [];
  for (const entry of mine) rounds.push(dailyRound(date, rounds, entry, calledCat(entry, rounds)));
  return battleResult(rounds);
}
// What a daily battle is ranked by: rounds won first, then your six-round total.
export const dailyScore = (result) => ({ rounds: result.wins, score: result.total });

// THE HISTORICAL GAUNTLET (v2.29.0). Twelve real offenses, weakest first: each is one franchise in one of the
// game's five-year eras, fielding the best card it has for each spot - the same boards the draft spins, so
// "KC 1999-2005" is Green, Holmes, Gonzalez and company. Beat one to open the next; a stage may be tried as
// often as it takes, with a new hand each time, and pays once.
//
// THE LIST IS WRITTEN OUT, NOT COMPUTED. Progress is kept as a number of stages cleared, so the list may only
// ever be ADDED TO AT THE END: a list worked out from the catalog would reorder itself the day a season is
// added, and stage five would quietly become another team. It was chosen by ranking all 160 team-eras by the
// average rating of their best six and taking twelve spread evenly from the bottom to the top, no franchise
// twice. tests/test-card-logic.mjs holds every one to fielding a full six and the strengths to rising.
//
// REORDERED ONCE, in v2.31.0, and never again: with no Flex a team fields two backs and two receivers instead
// of its best two of anybody, and Baltimore 1999-2005 fell from 87.4 to 78.7 - below the two stages before it.
// It moved from sixth to fourth so the stages still rise. Cards were on the test site only and the one account
// with progress was the owner's; nothing is paid twice, because progress is a count. The rule stands from here.
export const GAUNTLET = [
  ["NYJ", 3], ["JAX", 3], ["TEN", 2], ["BAL", 0], ["SEA", 2], ["HOU", 3],
  ["ATL", 1], ["NYG", 0], ["LV", 4], ["GB", 3], ["DEN", 2], ["KC", 0],
];
const stageOf = (stage) => (Number.isInteger(stage) && stage >= 0 && stage < GAUNTLET.length ? GAUNTLET[stage] : null);
export const gauntletName = (stage) => { const g = stageOf(stage); return g ? `${g[0]} ${WINDOWS[g[1]][0]}\u2013${WINDOWS[g[1]][1]}` : ""; };
// The six a stage fields: the best card that franchise has in that era for each spot (rating, then id), six
// different men, Base finish. The six spots in an order that follows from the stage alone.
const gauntletTeams = new Map();
export function gauntletFoe(stage) {
  const g = stageOf(stage);
  if (!g) return null;
  if (gauntletTeams.has(stage)) return gauntletTeams.get(stage).map((e) => ({ ...e }));
  const pool = [...CARDS.values()].filter((c) => c.team === g[0] && eraOf(c.season) === g[1]).sort((a, b) => b.rating - a.rating || a.id - b.id);
  const men = new Set(), team = [];
  for (const spot of SPOTS) {
    const card = pool.find((c) => !men.has(c.pid) && spotFits(c.pos, spot));
    if (!card) return null;
    men.add(card.pid); team.push({ id: card.id, finish: "base", spot });
  }
  const rand = mulberry32(hashStr(`gauntlet|${g[0]}|${g[1]}`));
  for (let i = team.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [team[i], team[j]] = [team[j], team[i]]; }
  gauntletTeams.set(stage, team);
  return team.map((e) => ({ ...e }));
}
// THE HEAD START. The weakest real offense in the game is still better than a starter deck, so the early
// stages give points back: every card of theirs plays this many points SHORT, shown on the card as a modifier.
// It shrinks a stage at a time and is gone by GAUNTLET_EVEN, after which a team is exactly as good as it was.
export const GAUNTLET_HEAD_START = -32, GAUNTLET_EVEN = 8;
export const gauntletEdge = (stage) => (stageOf(stage) && stage < GAUNTLET_EVEN ? Math.round(GAUNTLET_HEAD_START * (1 - stage / GAUNTLET_EVEN)) : 0);
export const GAUNTLET_EDGE_LABEL = "Head start";
// One round of a gauntlet battle: playRound with the stage's team and its head start. `cat` is your call.
export const gauntletRound = (stage, rounds, entry, cat, rand) => playRound(gauntletFoe(stage), rounds, entry, cat, rand, gauntletEdge(stage), GAUNTLET_EDGE_LABEL);

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
// THE CARD IS ONE OF THE SIX YOU DRAFTED (v2.28.1 - the owner drafted Melvin Gordon and was handed Marvin Mims,
// "this followed the team but not the player"). `picks` is the draft's history: [{ key, id, season }], a board
// and the row taken off it. Each is matched to its card by board, name and season. Only when NONE of the six
// has a card - the pool was rebuilt and a row left it - does it fall back to anybody on those boards, so a
// finished daily always earns something. A bare board key (a string) is accepted and means just that fallback.
export function dailyCard(picks, rand) {
  const list = Array.isArray(picks) ? picks : [];
  const keys = new Set(list.map((p) => (typeof p === "string" ? p : p?.key)).filter((k) => typeof k === "string"));
  const onBoards = [...CARDS.values()].filter((c) => keys.has(cardBoardKey(c))).sort((a, b) => a.id - b.id);
  const drafted = new Set();
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const row = (BOARDS[p.key] || []).find((x) => x.id === p.id && x.season === p.season);
    if (row) drafted.add(`${p.key}|${row.name}|${row.season}`);
  }
  const mine = onBoards.filter((c) => drafted.has(`${cardBoardKey(c)}|${c.name}|${c.season}`));
  const able = mine.length ? mine : onBoards;
  if (!able.length) return null;
  const card = able[Math.floor(rand() * able.length)];
  return { id: card.id, finish: rollFinish(rand) };
}
