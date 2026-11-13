// Builds data/cards.json: the card catalog. One card for every row of the draft pool (data/players.json - a
// player's best season for one team in one five-year era), carrying its own copy of that row's stats.
//
//   node tools/data/build-card-catalog.mjs
//
// THE CATALOG IS FROZEN, AND THIS FILE IS WHAT KEEPS IT THAT WAY. A card is something a player owns, so unlike
// every other file in data/ this one is never regenerated from scratch: the builder reads the catalog that is
// already there and only APPENDS to it. Three things follow, and tests/test-card-catalog.mjs holds all three:
//
//   - A card that exists keeps its id, its pid and every stat it was created with. If data/players.json is
//     rebuilt and a correction moves a man's yardage, his card does not move with it.
//   - A card whose row has LEFT the pool (a new season displaced it as his best in that era) stays. The new
//     season arrives as a new card beside it.
//   - Nothing is ever renumbered. A new card takes max(id) + 1.
//
// Why the catalog cannot simply point at players.json: that file's player `id` is a position in its own name
// array, good for one build and nothing more. Ownership keyed on it would silently hand every collection to
// different players the first time a season was added.
//
// `pid` is the PLAYER, which a lineup needs (one man, one slot) and a name cannot give: there are two Adrian
// Petersons, two Steve Smiths and six more pairs in the pool. Within one build players.json's name index does
// tell them apart, so a new row inherits the pid of an existing card that this build puts under the same index.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initGameData, BOARDS } from "../../game-logic.mjs";

export const CARD_COLUMNS = ["id", "pid", "name", "pos", "season", "team", "g", "cmp", "att", "py", "ptd", "int",
  "car", "ry", "rtd", "rec", "rcy", "rctd", "fl", "rating"];
const STATS = CARD_COLUMNS.slice(2); // everything copied straight off a pool row
const keyOf = (name, season, team) => `${name}|${season}|${team}`;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// existing: a catalog ({ columns, cards }) or null. rows: the pool's rows as game-logic.mjs's initGameData
// builds them (`id` there is the name index). Returns the merged cards and how many were added.
export function mergeCatalog(existing, rows) {
  const old = existing?.cards || [];
  if (old.length && existing.columns.join() !== CARD_COLUMNS.join()) {
    throw new Error("data/cards.json has different columns - a frozen catalog cannot change shape in place");
  }
  const at = Object.fromEntries(CARD_COLUMNS.map((c, i) => [c, i]));
  const have = new Map(old.map((c) => [keyOf(c[at.name], c[at.season], c[at.team]), c]));

  const seen = new Set();
  const fresh = [];
  const pidOfIndex = new Map(); // this build's name index -> the pid cards under it already carry
  for (const r of rows) {
    const key = keyOf(r.name, r.season, r.team);
    if (seen.has(key)) throw new Error(`two pool rows share the card key ${key}`);
    seen.add(key);
    const card = have.get(key);
    if (card) pidOfIndex.set(r.id, card[at.pid]);
    else fresh.push(r);
  }
  // A fixed order, so the ids a build hands out do not depend on how the pool happened to be listed.
  fresh.sort((a, b) => cmp(a.team, b.team) || a.season - b.season || cmp(a.name, b.name));

  let nextId = old.reduce((m, c) => Math.max(m, c[at.id]), 0) + 1;
  let nextPid = old.reduce((m, c) => Math.max(m, c[at.pid]), 0) + 1;
  const first = old.length === 0;
  const cards = old.slice();
  for (const r of fresh) {
    let pid = pidOfIndex.get(r.id);
    if (pid == null) {
      // The very first build has no cards to inherit from, so the name index IS the player.
      pid = first ? r.id + 1 : nextPid++;
      pidOfIndex.set(r.id, pid);
    }
    cards.push([nextId++, pid, ...STATS.map((c) => r[c])]);
  }
  return { cards, added: fresh.length };
}

// Run as a script (not when the test imports mergeCatalog).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const pool = JSON.parse(readFileSync(path.join(root, "data/players.json"), "utf8"));
  initGameData(pool.players, pool.opponents);
  const file = path.join(root, "data/cards.json");
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const { cards, added } = mergeCatalog(existing, Object.values(BOARDS).flat());
  if (added || !existing) {
    const out = { built: new Date().toISOString().slice(0, 10), columns: CARD_COLUMNS, cards };
    writeFileSync(file, `${JSON.stringify(out)}\n`);
  }
  const players = new Set(cards.map((c) => c[1])).size;
  console.log(`added ${added}, total ${cards.length} cards, ${players} players${added ? "" : " - data/cards.json left untouched"}`);
}
