// Builds data/card-defense.json: rushing and passing yards ALLOWED per game for every team defense, season by
// season. The card battles' Run stopper trait is read from it (card-logic.mjs, CARDS.md 3).
//
//   node tools/data/build-card-defense.mjs            1999 to the last season in data/versus-pool.json
//
// Why a file of its own, and not two more columns on data/versus-pool.json. That file is Duel's: versus.jsx and
// the match-pick Edge Function both carry a copy and have to agree on every number in it, and rebuilding it
// re-fetches its sources - a revised stat upstream would move a defense's rating under a live game for the sake
// of a trait Duel never reads. So this builder only ADDS a file. It reads versus-pool.json for the list of
// defenses to cover and writes nothing there.
//
// Where it comes from: nflverse-data's stats_team_week_YYYY.csv, the same project every other number in the game
// is from (DATA.md). That file is one row per team per game with what the team's OFFENCE gained and who it
// played, so the yards a defense allowed are the sum of what each opponent gained against it. The season file
// (stats_team_reg) has no yards-allowed column at all, which is why the duel builder could not supply this.
// Regular season only - a playoff run would give a good team extra, harder games.
//
// It refuses to write a file that does not cover the pool: every defense in it exactly once. It also refuses a
// defense with more than one game missing upstream, and says which defenses had one.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";
const WEEK = (y) => `${RELEASE}/stats_team/stats_team_week_${y}.csv`;
// nflverse spells a few teams by the name they had at the time; the game speaks one code per franchise.
const TEAM_CODE = { OAK: "LV", SD: "LAC", STL: "LA", LAR: "LA", SL: "LA" };
const code = (t) => TEAM_CODE[t] || t;

// One line of CSV, quotes respected (the same reader as build-versus-pool.mjs, for the same reason).
function cells(line) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') value += c;
      else if (line[i + 1] === '"') { value += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(value); value = ""; }
    else value += c;
  }
  out.push(value);
  return out;
}
async function csv(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const [head, ...lines] = (await res.text()).trim().split("\n");
  const cols = cells(head.replace(/\r$/, ""));
  return lines.map((line) => {
    const values = cells(line.replace(/\r$/, ""));
    const row = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = values[i];
    return row;
  });
}
const num = (v) => (v === undefined || v === "" || v === "NA" ? 0 : Number(v) || 0);

const pool = JSON.parse(readFileSync(path.join(root, "data/versus-pool.json"), "utf8"));
const want = new Set(pool.defenses.map((d) => `${d[0]}|${d[1]}`));
const seasons = [...new Set(pool.defenses.map((d) => d[0]))].sort((a, b) => a - b);

const rows = [];
const short = [];
const dropped = [];
let blank = 0;
for (const season of seasons) {
  const games = (await csv(WEEK(season))).filter((g) => g.season_type === "REG");
  const allowed = new Map(); // defense -> { games, rush, pass }
  for (const g of games) {
    // A handful of rows upstream have no team or no opponent (one in 1999). A game nobody played is not a game.
    if (!g.team || !g.opponent_team) { blank++; continue; }
    const defense = code(g.opponent_team);
    const a = allowed.get(defense) || allowed.set(defense, { games: 0, rush: 0, pass: 0 }).get(defense);
    a.games++;
    a.rush += num(g.rushing_yards);
    a.pass += num(g.passing_yards);
  }
  const full = Math.max(...[...allowed.values()].map((a) => a.games));
  for (const [team, a] of allowed) {
    // Only the defenses Duel's pool holds. It leaves two out on purpose (the 2001-02 Jaguars, whose source
    // seasons were broken), and a defense nobody can face needs no trait.
    if (!want.has(`${season}|${team}`)) { dropped.push(`${season} ${team}`); continue; }
    if (a.games < full) short.push(`${season} ${team} ${a.games}/${full}`);
    rows.push([season, team, a.games, Math.round((a.rush / a.games) * 10) / 10, Math.round((a.pass / a.games) * 10) / 10]);
  }
  process.stdout.write(`${season} `);
}
console.log();

const got = new Set(rows.map((r) => `${r[0]}|${r[1]}`));
const missing = [...want].filter((k) => !got.has(k));
if (missing.length || got.size !== rows.length) {
  throw new Error(`does not cover the pool exactly - missing ${missing.slice(0, 8).join(", ") || "none"}, ${rows.length - got.size} duplicated`);
}
// A defense with a game missing upstream is averaged over the games that ARE there. One game in sixteen moves a
// per-game figure very little, but more than that and the number is not worth a trait - so refuse.
const thin = short.filter((s) => { const [have, of] = s.split(" ")[2].split("/").map(Number); return of - have > 1; });
if (thin.length) throw new Error(`more than one game missing for: ${thin.join(", ")}`);
rows.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
const out = {
  built: new Date().toISOString().slice(0, 10),
  source: "nflverse-data stats_team_week (regular season, summed by opponent)",
  columns: ["season", "team", "games", "rush", "pass"],
  defenses: rows,
};
writeFileSync(path.join(root, "data/card-defense.json"), `${JSON.stringify(out)}\n`);
const best = [...rows].sort((a, b) => a[3] - b[3]).slice(0, 3).map((r) => `${r[0]} ${r[1]} ${r[3]}`).join(", ");
if (blank) console.log(`skipped ${blank} row(s) with no team or opponent`);
if (dropped.length) console.log(`not in the duel pool, left out: ${dropped.join(", ")}`);
if (short.length) console.log(`one game missing upstream, averaged over the rest: ${short.join(", ")}`);
console.log(`wrote data/card-defense.json: ${rows.length} defenses, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB. Fewest rushing yards a game: ${best}`);
