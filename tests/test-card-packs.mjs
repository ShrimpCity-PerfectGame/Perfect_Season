// What is in a pack, and the odds of it. card-packs.mjs is the ONE definition: the browser prints a pack's odds
// from it and the card-claim Edge Function rolls a pack with it, so what a player reads before buying is what
// is rolled after. This file holds the definition to its own stated odds by rolling a lot of packs.
import { readFileSync } from "node:fs";
import { mulberry32 } from "../game-logic.mjs";
import { initCardData, CARDS, FINISHES } from "../card-logic.mjs";
import { PACKS, PACK_BY_ID, packCards, packOdds, rollPack, cardWeight } from "../card-packs.mjs";

initCardData(JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8")));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.error(`FAIL  ${what}`); } };
const eq = (a, b, what) => ok(a === b, `${what} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);

// ---------- 1. The packs ----------
eq(PACKS.map((p) => p.id).join(), "pack-standard,pack-air-raid,pack-legends", "the three packs");
for (const p of PACKS) {
  eq(PACK_BY_ID[p.id], p, `${p.id} is findable by id`);
  ok(typeof p.name === "string" && p.name.length > 3 && typeof p.blurb === "string" && p.blurb.length > 10, `${p.id} has a name and a line about it`);
  ok(Number.isInteger(p.size) && p.size >= 1 && p.size <= 10, `${p.id} holds a sensible number of cards`);
  eq(+FINISHES.reduce((s, f) => s + (p.finish[f] || 0), 0).toFixed(9), 1, `${p.id}'s finish odds add up to one`);
  ok(packCards(p).length >= p.size * 5, `${p.id} holds plenty of cards to pull from (${packCards(p).length})`);
  ok(packCards(p).every((c, i, a) => i === 0 || a[i - 1].id < c.id), `${p.id}'s cards come in id order`);
  ok(typeof p.art === "string" && p.art.endsWith(`${p.id}.webp`), `${p.id} names its art`);
}
eq(packCards(PACK_BY_ID["pack-standard"]).length, CARDS.size, "the Standard pack holds every card");
ok(packCards(PACK_BY_ID["pack-legends"]).every((c) => c.rating >= 100), "Legends holds only cards rated 100 or more");
ok(packCards(PACK_BY_ID["pack-air-raid"]).every((c) => ["gunslinger", "volume", "deep", "seam", "possession"].includes(c.archetype)), "Air raid holds only its five archetypes");
eq(PACK_BY_ID["pack-legends"].limited, true, "Legends is the limited one");
eq(PACK_BY_ID["pack-nope"], undefined, "a pack that does not exist");

// ---------- 2. The odds ----------
for (const [rating, w] of [[12, 10], [59.9, 10], [60, 6], [79.9, 6], [80, 3], [99.9, 3], [100, 1.5], [119.9, 1.5], [120, 0.6], [130, 0.6]]) eq(cardWeight({ rating }), w, `a card rated ${rating} weighs ${w}`);
for (const p of PACKS) {
  const odds = packOdds(p);
  eq(odds.length, packCards(p).length, `${p.id}: a chance for every card`);
  eq(+odds.reduce((s, o) => s + o.chance, 0).toFixed(9), 1, `${p.id}: the chances add up to one`);
  ok(odds.every((o) => o.chance > 0), `${p.id}: every card can be pulled`);
  ok(odds.every((o, i) => i === 0 || odds[i - 1].chance > o.chance || (odds[i - 1].chance === o.chance && odds[i - 1].id < o.id)), `${p.id}: listed most likely first, then by id`);
}
const std = PACK_BY_ID["pack-standard"], stdOdds = new Map(packOdds(std).map((o) => [o.id, o.chance]));
const star = [...CARDS.values()].find((c) => c.rating >= 120), scrub = [...CARDS.values()].find((c) => c.rating < 60);
eq(+(stdOdds.get(scrub.id) / stdOdds.get(star.id)).toFixed(6), +(10 / 0.6).toFixed(6), "a card rated under 60 is 10/0.6 times as likely as one rated 120+");

// ---------- 3. Rolling a pack ----------
for (const p of PACKS) {
  const pool = new Set(packCards(p).map((c) => c.id));
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    let draws = 0; const r = mulberry32(i + 1);
    const pulled = rollPack(p, () => (draws++, r()));
    if (pulled.length !== p.size || new Set(pulled.map((c) => c.id)).size !== p.size || pulled.some((c) => !pool.has(c.id) || !FINISHES.includes(c.finish)) || draws !== 2 * p.size) bad++;
  }
  eq(bad, 0, `${p.id}: 2,000 rolls - always ${p.size} different cards from its own pool, in exactly ${2 * p.size} draws`);
  eq(JSON.stringify(rollPack(p, mulberry32(77))), JSON.stringify(rollPack(p, mulberry32(77))), `${p.id}: the same generator rolls the same pack`);
}
for (const edge of [0, 0.9999999999]) ok(rollPack(std, () => edge).length === std.size, `a roll at rand=${edge} still pulls ${std.size} cards`);

// ---------- 4. What is rolled is what is stated ----------
const N = 20000, rand = mulberry32(20261113);
const fin = { base: 0, silver: 0, gold: 0, prism: 0 }; let high = 0, pulls = 0;
for (let i = 0; i < N; i++) for (const c of rollPack(std, rand)) { pulls++; fin[c.finish]++; if (CARDS.get(c.id).rating >= 100) high++; }
const statedHigh = packOdds(std).filter((o) => CARDS.get(o.id).rating >= 100).reduce((s, o) => s + o.chance, 0);
ok(Math.abs(high / pulls - statedHigh) / statedHigh < 0.15, `Standard: ${(100 * high / pulls).toFixed(2)}% of pulls were rated 100+, against a stated ${(100 * statedHigh).toFixed(2)}%`);
for (const f of FINISHES) ok(Math.abs(fin[f] / pulls - std.finish[f]) <= (f === "prism" ? 0.003 : 0.01), `Standard: ${f} came up ${(100 * fin[f] / pulls).toFixed(2)}% against a stated ${(100 * std.finish[f]).toFixed(1)}%`);
const leg = PACK_BY_ID["pack-legends"]; let cheap = 0;
for (let i = 0; i < 5000; i++) for (const c of rollPack(leg, rand)) if (c.finish === "base" || c.finish === "silver") cheap++;
eq(cheap, 0, "Legends never rolls Base or Silver");

// ---------- 5. The art ----------
// One picture a pack, cut from the owner's by tools/cards/build-pack-art.mjs. Held to shape, not content: look at them.
for (const p of PACKS) {
  let buf = null;
  try { buf = readFileSync(new URL(`../static${p.art}`, import.meta.url)); } catch { buf = null; }
  ok(buf && buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP", `${p.id}: its picture exists and is a WebP`);
  ok(buf && buf.length < 120000, `${p.id}: and is small enough to send to a phone (${buf?.length} bytes)`);
}

console.log(`  Standard: ${packCards(std).length} cards; a given pull is rated 100+ ${(100 * statedHigh).toFixed(2)}% of the time, 120+ ${(100 * packOdds(std).filter((o) => CARDS.get(o.id).rating >= 120).reduce((s, o) => s + o.chance, 0)).toFixed(2)}%`);
console.log(fails ? `\n${fails} FAILED` : "card packs: all checks passed");
process.exit(fails ? 1 : 0);
