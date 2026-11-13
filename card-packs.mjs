// Card packs: what is in each one, and the odds. See CARDS.md.
//
// THIS IS THE ONE DEFINITION. The browser imports it to print a pack's contents and odds before anybody buys;
// the card-claim Edge Function imports it to roll the pack. So what a player reads is what is rolled, by
// construction - there is no second table to drift. That is also why a pack's CONTENTS are code and not
// database rows: a pack is up to 3,124 weighted cards derived from the catalog, and a copy of that in SQL would
// be a second thing to keep true. What an owner changes without a release lives in the card_packs table
// (supabase/migration-cards.sql): the price, whether it is on sale, and a limited pack's stock.
//
// So THE CLIENT AND THE FUNCTIONS SHIP TOGETHER whenever this file changes, the same rule guess-pool.json and
// versus-logic.mjs carry: a browser on last week's copy would be showing odds the server no longer rolls.
//
// Pure, like card-logic.mjs: no Math.random, no DOM. A roll takes a `rand` and makes exactly two draws a card -
// one for which card, one for its finish.
import { CARDS, rollFinish } from "./card-logic.mjs";

// Better cards are rarer. A weight, not a chance: a card's chance of being a given pull is its weight over the
// total weight of everything in the pack, so the same card is likelier in a small themed pack than in Standard.
export function cardWeight(card) {
  const r = card.rating;
  return r >= 120 ? 0.6 : r >= 100 ? 1.5 : r >= 80 ? 3 : r >= 60 ? 6 : 10;
}

const AIR_RAID = ["gunslinger", "volume", "deep", "seam", "possession"];
// `size` is how many cards a pack holds, and card_packs carries a copy of it that buy_pack enforces - so a
// function with a bug cannot hand over twenty. tests/test-cards-sql.mjs holds the two to each other.
export const PACKS = [
  {
    id: "pack-standard", name: "Standard pack", size: 3, limited: false,
    blurb: "Three cards from anywhere in the game.",
    finish: { base: 0.70, silver: 0.22, gold: 0.07, prism: 0.01 },
    has: () => true,
  },
  {
    id: "pack-air-raid", name: "Air raid pack", size: 3, limited: false,
    blurb: "Passers and the men they throw to: Gunslingers, Volume passers, Deep threats, Seam stretchers and Possession receivers.",
    finish: { base: 0.70, silver: 0.22, gold: 0.07, prism: 0.01 },
    has: (card) => AIR_RAID.includes(card.archetype),
  },
  {
    id: "pack-legends", name: "Legends pack", size: 1, limited: true,
    blurb: "One card rated 100 or better, always Gold or Prism. Limited stock.",
    finish: { base: 0, silver: 0, gold: 0.85, prism: 0.15 },
    has: (card) => card.rating >= 100,
  },
].map((p) => ({ ...p, art: `/cards/packs/${p.id}.webp` }));
export const PACK_BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));

// The cards a pack can hold, in id order. Needs initCardData to have run. Worked out once per catalog.
let cachedFor = null;
const cache = new Map();
export function packCards(pack) {
  if (cachedFor !== CARDS) { cache.clear(); cachedFor = CARDS; }
  if (!cache.has(pack.id)) cache.set(pack.id, [...CARDS.values()].filter((c) => pack.has(c)).sort((a, b) => a.id - b.id));
  return cache.get(pack.id);
}

// Every card's chance of being any one pull: [{ id, chance }], most likely first. This is what the screen
// prints. (Within one pack the cards are different, so a later pull's odds shift by a hair once an earlier
// card is out; with hundreds of cards in every pack that is far below the two figures printed.)
export function packOdds(pack) {
  const cards = packCards(pack);
  const total = cards.reduce((s, c) => s + cardWeight(c), 0);
  return cards.map((c) => ({ id: c.id, chance: cardWeight(c) / total }))
    .sort((a, b) => b.chance - a.chance || a.id - b.id);
}

// Roll a pack: `size` DIFFERENT cards drawn by weight, each with its own finish. [{ id, finish }].
export function rollPack(pack, rand) {
  const left = packCards(pack).slice();
  const weights = left.map(cardWeight);
  let total = weights.reduce((s, w) => s + w, 0);
  const out = [];
  for (let n = 0; n < pack.size; n++) {
    let x = rand() * total, i = 0;
    while (i < left.length - 1 && x >= weights[i]) { x -= weights[i]; i++; }
    const card = left[i];
    total -= weights[i];
    left.splice(i, 1); weights.splice(i, 1);
    out.push({ id: card.id, finish: rollFinish(rand, pack.finish) });
  }
  return out;
}
