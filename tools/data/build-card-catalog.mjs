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
// `pid` is the PLAYER, which a lineup needs (one man, one slot) and a name cannot give: twelve names in the pool belong to more than one
// man - two Adrian Petersons, two Steve Smiths, three Mike Williamses. Within one build players.json's name index does
// tell them apart, so a new row inherits the pid of an existing card that this build puts under the same index.
// mergeCatalog's own comment has the whole rule, and what it refuses.
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
// builds them (`id` there is the name index). Returns { cards, added, left, byName }:
//   left    how many existing cards' rows are no longer in the pool (they stay in the catalog)
//   byName  [{ name, pid }] - players matched to an existing pid by NAME alone, for a human to check
//
// WHO A NEW ROW BELONGS TO, in order:
//   1. An existing card of his is still in the pool under the same name index: that card's pid.
//   2. No such card, but exactly one existing player has his name AND has no card left in the pool - an orphan.
//      That is a man whose every row moved (818 of the 1,639 players have exactly one card, so "his best season
//      moved" orphans him at a stroke). He keeps his pid, and the match is reported in `byName`.
//   3. Otherwise he is new. A namesake of a player who is STILL in the pool lands here, correctly: that player
//      has his own index, and this row is not under it.
// Two orphans with one name cannot be told apart, and one index carrying two players' cards means the pool has
// merged two men. Both THROW. A wrong pid is permanent - it decides who may share a lineup and whose skin tone a
// card wears - so the builder refuses rather than guesses.
//
// What this cannot see: a player whose NAME is respelled between builds looks like a stranger. `left` is how a
// human notices - a rebuild that only adds a season should report almost nothing leaving.
//
// allowOld: by default a new card must be from a season NEWER than anything in the catalog. A rebuild that adds
// a season does exactly that. A rebuild that re-keys old rows - a team code changing, a name respelled across
// the file - would otherwise append a duplicate of every card it touched, silently and for ever.
export function mergeCatalog(existing, rows, { allowOld = false } = {}) {
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
    if (!card) { fresh.push(r); continue; }
    const known = pidOfIndex.get(r.id);
    if (known != null && known !== card[at.pid]) {
      throw new Error(`name index ${r.id} (${r.name}) carries cards of two players, pid ${known} and pid ${card[at.pid]} - the pool has merged two men`);
    }
    pidOfIndex.set(r.id, card[at.pid]);
  }
  // A fixed order, so the ids a build hands out do not depend on how the pool happened to be listed.
  fresh.sort((a, b) => cmp(a.team, b.team) || a.season - b.season || cmp(a.name, b.name));

  const latest = old.reduce((m, c) => Math.max(m, c[at.season]), 0);
  const stale = old.length ? fresh.filter((r) => r.season <= latest) : [];
  if (stale.length && !allowOld) {
    throw new Error(`${stale.length} new card(s) are from ${latest} or earlier (first: ${keyOf(stale[0].name, stale[0].season, stale[0].team)}). `
      + "A rebuild that adds a season only adds newer cards; this looks like old rows being re-keyed, which would duplicate "
      + "them for ever. If it is really intended, run again with --allow-old.");
  }

  // Orphans: existing players with no card left in the pool, by name.
  const inPool = new Set();
  let left = 0;
  for (const [key, c] of have) { if (seen.has(key)) inPool.add(c[at.pid]); else left++; }
  const orphans = new Map();
  for (const c of old) {
    if (inPool.has(c[at.pid])) continue;
    (orphans.get(c[at.name]) || orphans.set(c[at.name], new Set()).get(c[at.name])).add(c[at.pid]);
  }

  let nextId = old.reduce((m, c) => Math.max(m, c[at.id]), 0) + 1;
  let nextPid = old.reduce((m, c) => Math.max(m, c[at.pid]), 0) + 1;
  const first = old.length === 0;
  const cards = old.slice();
  const byName = [];
  for (const r of fresh) {
    let pid = pidOfIndex.get(r.id);
    if (pid == null) {
      const same = orphans.get(r.name);
      if (same && same.size > 1) {
        throw new Error(`${r.name} (${r.season} ${r.team}) could be any of ${same.size} players who have left the pool (pids ${[...same].join(", ")}) - nothing here can tell which`);
      }
      if (same && same.size === 1) {
        pid = [...same][0];
        orphans.delete(r.name);
        byName.push({ name: r.name, pid });
      } else {
        // The very first build has no cards to inherit from, so the name index IS the player.
        pid = first ? r.id + 1 : nextPid++;
      }
      pidOfIndex.set(r.id, pid);
    }
    cards.push([nextId++, pid, ...STATS.map((c) => r[c])]);
  }
  return { cards, added: fresh.length, left, byName };
}

// Run as a script (not when the test imports mergeCatalog).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const pool = JSON.parse(readFileSync(path.join(root, "data/players.json"), "utf8"));
  initGameData(pool.players, pool.opponents);
  const file = path.join(root, "data/cards.json");
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  const { cards, added, left, byName } = mergeCatalog(existing, Object.values(BOARDS).flat(), { allowOld: process.argv.includes("--allow-old") });
  if (added || !existing) {
    const out = { built: new Date().toISOString().slice(0, 10), columns: CARD_COLUMNS, cards };
    writeFileSync(file, `${JSON.stringify(out)}\n`);
  }
  const players = new Set(cards.map((c) => c[1])).size;
  console.log(`added ${added}, total ${cards.length} cards, ${players} players${added ? "" : " - data/cards.json left untouched"}`);
  if (left) console.log(`${left} card(s) are no longer in data/players.json and stay in the catalog as they were`);
  for (const m of byName) console.log(`  matched by name alone, check it is the same man: ${m.name} -> pid ${m.pid}`);
}
