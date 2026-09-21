// data/versus-pool.json, the defenses and kickers 1v1 drafts (VERSUS.md 6). Built by
// tools/data/build-versus-pool.mjs from nflverse; this is what holds the file to what the game needs from it.
//
// The guarantee that matters most is the last one: every board carries a defense and a kicker for every year of
// its era, which is what lets a player take a defense fifth or a kicker first and never reach a slot the
// remaining boards can't fill.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, runTest } from "./helpers.mjs";
import { initGameData, BOARDS, TEAMS, WINDOWS } from "../game-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
const raw = read("data/versus-pool.json");
const players = read("data/players.json");
initGameData(players.players, players.opponents);

// The file packs its rows as arrays with the column names given once, because it ships in the page every
// visitor loads. Expanded here the same way versus-logic.mjs expands it - and the shape of that packing is
// itself part of what this test holds, since a column added to one end and read at the other would be silent.
const expand = (rows, columns) => rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
const pool = {
  ...raw,
  defenses: expand(raw.defenses, raw.columns.defenses),
  kickers: expand(raw.kickers, raw.columns.kickers),
};

const FIRST = 1999, LAST = 2025;
const at = (rows) => new Map(rows.map((r) => [`${r.team}|${r.season}`, r]));
const defenses = at(pool.defenses), kickers = at(pool.kickers);

await runTest("the file is packed the way the game unpacks it", async () => {
  assert(Array.isArray(raw.columns?.defenses) && Array.isArray(raw.columns?.kickers), "it names its columns");
  assert(raw.defenses.every((r) => Array.isArray(r) && r.length === raw.columns.defenses.length),
    "and every defense row matches them");
  assert(raw.kickers.every((r) => Array.isArray(r) && r.length === raw.columns.kickers.length),
    "as does every kicker row");
  // What the packing is for: an object per row would cost about 80 KB more in the page every visitor loads.
  const size = JSON.stringify(raw).length;
  assert(size < 110_000, `the file stays small: ${(size / 1024).toFixed(0)} KB`);
});

await runTest("one defense and one kicker for every team-season the game knows", async () => {
  const want = [];
  for (let season = FIRST; season <= LAST; season++) for (const team of Object.keys(TEAMS)) want.push(`${team}|${season}`);
  // Four fewer than 32 x 27: the league had 31 teams until Houston joined in 2002.
  const missingD = want.filter((k) => !defenses.has(k));
  const missingK = want.filter((k) => !kickers.has(k));
  assert(missingD.length === 3 && missingD.every((k) => k.startsWith("HOU|")),
    `only the seasons Houston did not exist are missing a defense, got ${JSON.stringify(missingD)}`);
  assert(JSON.stringify(missingK) === JSON.stringify(missingD), `and the kickers match exactly, got ${JSON.stringify(missingK)}`);
  assert(pool.defenses.length === 861 && pool.kickers.length === 861, `861 of each, got ${pool.defenses.length} and ${pool.kickers.length}`);
  assert(defenses.size === pool.defenses.length && kickers.size === pool.kickers.length, "with no team-season listed twice");
});

await runTest("every row is one the game can draft and show", async () => {
  for (const [what, rows] of [["defense", pool.defenses], ["kicker", pool.kickers]]) {
    for (const r of rows) {
      const where = `${r.season} ${r.team}`;
      assert(TEAMS[r.team], `${what} ${where}: a team code the game knows`);
      assert(r.season >= FIRST && r.season <= LAST, `${what} ${where}: inside the seasons the game has`);
      // The same scale the players are on - anything outside it would rank nonsensically beside a quarterback.
      assert(Number.isFinite(r.rating) && r.rating >= 1 && r.rating <= 130, `${what} ${where}: rating ${r.rating} is on the scale`);
    }
  }
  for (const k of pool.kickers) {
    assert(k.name && typeof k.name === "string", `${k.season} ${k.team}: the kicker has a name`);
    assert(k.made <= k.att, `${k.season} ${k.team} ${k.name}: ${k.made} made of ${k.att} attempted`);
    assert(k.from50 <= k.made && (k.long === 0 || k.long >= 17), `${k.season} ${k.team} ${k.name}: long ${k.long}, ${k.from50} from 50+`);
  }
  for (const d of pool.defenses) {
    assert(d.pa > 5 && d.pa < 40, `${d.season} ${d.team}: ${d.pa} points allowed a game is a real number`);
    assert(d.ints >= 0 && d.sacks >= 0 && d.tds >= 0, `${d.season} ${d.team}: no negative counting stats`);
  }
});

await runTest("the ratings say what actually happened", async () => {
  const D = (team, season) => defenses.get(`${team}|${season}`).rating;
  const K = (team, season) => kickers.get(`${team}|${season}`);
  // Seasons anyone who watched them would rank this way. If a weight changes and one of these flips, the weight
  // is wrong, not the season.
  assert(D("BAL", 2006) > D("DET", 2006), "the 2006 Ravens over the 2006 Lions");
  assert(D("BAL", 2006) > 105, `the 2006 Ravens are an all-timer, got ${D("BAL", 2006)}`);
  assert(D("CHI", 2005) > D("CHI", 2004) && D("CHI", 2005) > 85, "the 2005 Bears were the year the defense arrived");
  assert(D("TB", 2002) > D("TB", 2001), "and 2002 was Tampa's");
  assert(Math.abs(D("DET", 2005) - 65) < 6, `the 2005 Lions were an ordinary defense, got ${D("DET", 2005)}`);
  assert(K("IND", 2003).made === K("IND", 2003).att, `Vanderjagt's 2003 was perfect, got ${K("IND", 2003).made}/${K("IND", 2003).att}`);
  assert(K("ARI", 2005).rating > 110, `Rackers' 2005 was the best kicking season here, got ${K("ARI", 2005).rating}`);
  // An era is judged against itself, not against history: both of these led their own year.
  assert(Math.abs(D("BAL", 2000) - D("SEA", 2013)) < 15,
    `the 2000 Ravens and the 2013 Seahawks are close, got ${D("BAL", 2000)} and ${D("SEA", 2013)}`);
});

await runTest("a thin season can't buy the accuracy rating", async () => {
  // The builder shrinks accuracy toward the league's rate, so a kicker who went 9-for-10 in relief is an average
  // kicker with a little evidence rather than the best in the league. This is the check that the shrink is on.
  const thin = pool.kickers.filter((k) => k.att <= 15);
  assert(thin.length > 10, `the data has thin seasons to judge, got ${thin.length}`);
  const bestThin = thin.reduce((a, b) => (a.rating > b.rating ? a : b));
  assert(bestThin.rating < 65, `no thin season rates above an average one, best was ${bestThin.name} ${bestThin.made}/${bestThin.att} at ${bestThin.rating}`);

  // A perfect season is worth more the more of it there is - the same rule from the other side. Compared in
  // bulk rather than one by one, because a rating is measured against its own season: a 17-for-17 in 2000 and a
  // 16-for-16 in 2020 are judged by different peers, and which of those two comes out ahead is not a property
  // this file should have to promise.
  const perfect = pool.kickers.filter((k) => k.att > 0 && k.made === k.att);
  const full = perfect.filter((k) => k.att >= 20), part = perfect.filter((k) => k.att < 20);
  assert(full.length && part.length, `the file has perfect seasons of both sizes, got ${full.length} and ${part.length}`);
  const lowestFull = full.reduce((a, b) => (a.rating < b.rating ? a : b));
  const highestPart = part.reduce((a, b) => (a.rating > b.rating ? a : b));
  assert(lowestFull.rating > highestPart.rating,
    `a full perfect season outranks a short one: ${lowestFull.made}/${lowestFull.att} at ${lowestFull.rating} vs ${highestPart.made}/${highestPart.att} at ${highestPart.rating}`);
  assert(Math.max(...full.map((k) => k.rating)) > bestThin.rating + 30, "and the biggest is in another class from the thinnest");
});

await runTest("every board carries a defense and a kicker for every year of its era", async () => {
  // VERSUS.md 1: a board offers that team's players, its defense in each year of the era and its kicker in each
  // year. That is what lets a defense be taken fifth and a kicker first.
  const keys = Object.keys(BOARDS);
  assert(keys.length === 160, `32 teams by 5 eras, got ${keys.length}`);
  const short = [];
  for (const key of keys) {
    const [team, w] = key.split("|");
    const [from, to] = WINDOWS[Number(w)];
    for (let season = from; season <= to; season++) {
      if (season < FIRST || season > LAST) continue;
      if (team === "HOU" && season < 2002) continue; // the Texans did not exist yet
      if (!defenses.has(`${team}|${season}`)) short.push(`${key} has no ${season} defense`);
      if (!kickers.has(`${team}|${season}`)) short.push(`${key} has no ${season} kicker`);
    }
  }
  assert(short.length === 0, `nothing missing, got:\n    ${short.slice(0, 8).join("\n    ")}`);
});

await runTest("a board can be one deep at a position, which is why section 8 exists", async () => {
  // A 1v1 board is drafted twice, so "it has a quarterback" is not enough - the second picker needs one too.
  // This test exists so nobody later assumes the data makes that impossible: it does not, and it is not rare.
  const thin = [];
  const shallowUnit = [];
  for (const [key, list] of Object.entries(BOARDS)) {
    const by = {};
    for (const p of list) by[p.pos] = (by[p.pos] || 0) + 1;
    for (const pos of ["QB", "RB", "WR", "TE"]) if ((by[pos] || 0) < 2) thin.push(`${key}: ${by[pos] || 0} ${pos}`);
    const [team, w] = key.split("|");
    const [from, to] = WINDOWS[Number(w)];
    let d = 0, k = 0;
    for (let season = Math.max(from, FIRST); season <= Math.min(to, LAST); season++) {
      if (defenses.has(`${team}|${season}`)) d++;
      if (kickers.has(`${team}|${season}`)) k++;
    }
    if (d < 2 || k < 2) shallowUnit.push(`${key}: ${d} defenses, ${k} kickers`);
  }
  assert(thin.length > 0, "boards one deep at a position are real - if this ever passes with zero, section 8 can be simplified");
  assert(thin.some((s) => /1 QB$/.test(s)), `including one-quarterback boards, got ${JSON.stringify(thin.slice(0, 3))}`);

  // The other half of the same question: a defense or a kicker is never the scarce thing, because every board
  // offers one per year of its era. Both players can always be served those, whatever else is contested.
  assert(shallowUnit.length === 0, `every board is at least two deep at defense and kicker, got:\n    ${shallowUnit.slice(0, 5).join("\n    ")}`);
});

console.log("test-versus-pool.mjs done");
