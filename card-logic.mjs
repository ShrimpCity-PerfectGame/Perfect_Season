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
