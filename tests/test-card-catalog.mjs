// The card catalog (data/cards.json): one card for every row of the draft pool, and - the part that matters -
// FROZEN. Somebody owns these. A rebuild of data/players.json may add cards and may never renumber, rewrite or
// remove one, so the second half of this file rebuilds against a pool that has moved and holds the old rows to
// the byte. See CARDS.md and docs/superpowers/specs/2026-11-13-card-collection-design.md (3).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initGameData, BOARDS } from "../game-logic.mjs";
import { mergeCatalog } from "../tools/data/build-card-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(path.join(root, f), "utf8"));
initGameData(read("data/players.json").players, read("data/players.json").opponents);

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.error(`FAIL  ${what}`); } };
const eq = (a, b, what) => ok(a === b, `${what} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);

const cat = read("data/cards.json");
const at = Object.fromEntries(cat.columns.map((c, i) => [c, i]));
const rows = Object.values(BOARDS).flat();
const keyOf = (name, season, team) => `${name}|${season}|${team}`;
const byKey = new Map(cat.cards.map((c) => [keyOf(c[at.name], c[at.season], c[at.team]), c]));

// ---------- 1. What is in it ----------
eq(cat.columns.join(), "id,pid,name,pos,season,team,g,cmp,att,py,ptd,int,car,ry,rtd,rec,rcy,rctd,fl,rating", "the columns");
eq(cat.cards.length, rows.length, "one card per draft-pool row");
eq(cat.cards.length, 3124, "3,124 cards");
eq(new Set(cat.cards.map((c) => c[at.id])).size, cat.cards.length, "ids are unique");
ok(cat.cards.every((c, i) => c[at.id] === i + 1), "ids run 1..n in file order");
eq(new Set(cat.cards.map((c) => c[at.pid])).size, 1639, "1,639 players");
for (const r of rows) {
  const c = byKey.get(keyOf(r.name, r.season, r.team));
  ok(c && c[at.rating] === r.rating && c[at.py] === r.py && c[at.ry] === r.ry && c[at.rcy] === r.rcy && c[at.pos] === r.pos,
    `${r.name} ${r.season} ${r.team} is in the catalog with its stats`);
}
// Two different men can share a name; a pid is the man, not the name.
const petersons = new Set(cat.cards.filter((c) => c[at.name] === "Adrian Peterson").map((c) => c[at.pid]));
eq(petersons.size, 2, "the two Adrian Petersons are two players");
ok(!/https?:/.test(JSON.stringify(cat)), "no URL in the catalog");

// ---------- 2. A rebuild never rewrites what exists ----------
const gone = rows[0];
const moved = rows.filter((r) => !(r.name === gone.name && r.season === gone.season && r.team === gone.team)); // one row leaves
const changed = moved.map((r, i) => (i === 5 ? { ...r, rating: r.rating + 9, py: r.py + 100 } : r));            // one row's stats move
const src = rows[10];
const added = [...changed, { ...src, season: 2026, rating: 77 }];                                                // one new season
const again = mergeCatalog(cat, added);
eq(again.added, 1, "exactly the new season is added");
eq(again.cards.length, cat.cards.length + 1, "nothing is removed");
ok(cat.cards.every((c, i) => JSON.stringify(again.cards[i]) === JSON.stringify(c)), "every existing row is byte-identical");
eq(again.cards.at(-1)[at.id], cat.cards.length + 1, "the new card takes the next id");
eq(again.cards.at(-1)[at.pid], byKey.get(keyOf(src.name, src.season, src.team))[at.pid], "and its player's existing pid");

// A player nobody has seen gets a pid nobody has.
const stranger = mergeCatalog(cat, [...rows, { ...src, id: 999999, name: "Nobody Atall", season: 2026 }]);
eq(stranger.cards.at(-1)[at.pid], Math.max(...cat.cards.map((c) => c[at.pid])) + 1, "a new player takes the next pid");
// A new man who shares a name with an old one is not that old one.
const namesake = mergeCatalog(cat, [...rows, { ...src, id: 999998, name: "Adrian Peterson", season: 2026, team: "DAL" }]);
ok(!petersons.has(namesake.cards.at(-1)[at.pid]), "a third Adrian Peterson is a third player");

// Running it again with nothing new changes nothing.
const same = mergeCatalog(cat, rows);
eq(same.added, 0, "an unchanged pool adds nothing");
eq(JSON.stringify(same.cards), JSON.stringify(cat.cards), "and leaves the file as it was");

let threw = false;
try { mergeCatalog(cat, [...rows, rows[3]]); } catch { threw = true; }
ok(threw, "a duplicate key refuses to build");

console.log(fails ? `\n${fails} FAILED` : `card catalog: ${cat.cards.length} cards, ${new Set(cat.cards.map((c) => c[at.pid])).size} players - all checks passed`);
process.exit(fails ? 1 : 0);
