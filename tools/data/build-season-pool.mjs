// Builds data/season-2025.json: one row per player per team for a single season, carrying the only number the
// Century mode scores on - combined passing + rushing + receiving touchdowns. Century only; nothing else in the
// game reads this file, and it is NOT interchangeable with data/players.json.
//
//   node tools/data/build-season-pool.mjs          2025
//   node tools/data/build-season-pool.mjs 2024     an earlier season, for checking
//
// Why a file of its own. data/players.json holds ONE row per player per team per five-year era - his BEST season
// in that era - which is exactly right for a draft that spins an era and wrong for a mode that names a single
// year. Filtering it to `season === 2025` answers a different question ("whose best 2021-25 season happened to
// be 2025") and returns 129 of 634 players, no Mahomes, and 18 teams with a quarterback. Century needs every
// player's actual 2025, so it gets its own source and its own file.
//
// Where it comes from, the same public nflverse release the 1v1 pool uses:
//   stats_player_week_YYYY.csv.gz   every player's every week; REG rows only, POST is not part of the goal
//
// About 1.2 MB is fetched; what lands in the repo is ~450 small rows. Re-run it when a season ends.
import { writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEAMS, POS } from "../../game-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SEASON = Number(process.argv[2] || 2025);
const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";
const PLAYER = (y) => `${RELEASE}/stats_player/stats_player_week_${y}.csv.gz`;

// A board is a knowledge test, not a haystack: without a floor a team deals up to 26 names of which 16 never
// scored, and picking blind from that is a coin toss rather than a read on the season. Six games is a third of
// one, and it costs the pool nothing that matters - measured, NOT ONE team-position loses its leading scorer to
// this filter, so every ceiling the mode is balanced against survives it. Raising it further only deletes duds.
const MIN_GAMES = 6;

// nflverse spells a few teams by the name they had at the time; the game speaks one code per franchise, the way
// data/players.json does (game-logic.mjs's TEAMS). Kept identical to build-versus-pool.mjs on purpose.
const TEAM_CODE = { OAK: "LV", SD: "LAC", STL: "LA", LAR: "LA", SL: "LA" };
const code = (t) => TEAM_CODE[t] || t;

// One line of CSV, quotes respected. It matters more than it looks: a player row carries a headshot URL like
// "https://.../f_auto,q_auto/league/..." with a comma inside the quotes, so splitting on every comma shifts every
// column after it. Splitting naively here returned THREE regular-season rows out of 19,000 and read the whole
// league as having no quarterbacks - the same failure build-versus-pool.mjs's comment warns about.
function cells(line) {
  const out = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') value += c;
      else if (line[i + 1] === '"') { value += '"'; i++; } // "" inside a quoted field is one quote
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
  const body = Buffer.from(await res.arrayBuffer());
  const text = (url.endsWith(".gz") ? gunzipSync(body) : body).toString("utf8");
  const [head, ...lines] = text.trim().split("\n");
  const cols = cells(head.replace(/\r$/, ""));
  return lines.map((line) => {
    const values = cells(line.replace(/\r$/, ""));
    const row = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = values[i];
    return row;
  });
}
const num = (v) => (v === undefined || v === "" || v === "NA" ? 0 : Number(v) || 0);

console.log(`fetching ${SEASON} weekly stats...`);
const weeks = await csv(PLAYER(SEASON));

// A player traded mid-season keeps a row per team, each with the touchdowns he scored FOR that team, which is
// what a board has to offer: you spun this team, so you get this team's half of his year.
const byPlayerTeam = new Map();
let reg = 0;
for (const w of weeks) {
  if (w.season_type !== "REG") continue;
  reg++;
  const pos = w.position;
  if (!POS.includes(pos)) continue;
  const team = code(w.team);
  const name = w.player_display_name;
  if (!team || !name) continue;
  const key = `${team}|${name}`;
  const row = byPlayerTeam.get(key) || { team, name, td: 0, games: 0, byPos: {} };
  // The goal is combined passing + rushing + receiving, so a quarterback who runs one in counts both.
  row.td += num(w.passing_tds) + num(w.rushing_tds) + num(w.receiving_tds);
  row.games++;
  // A position can move week to week in the source (a wideout listed at RB for a gadget game). The one he
  // played most is the one the board deals him at; a tie goes to the earlier position in POS, so the answer
  // never depends on what order the weeks arrived in.
  row.byPos[pos] = (row.byPos[pos] || 0) + 1;
  byPlayerTeam.set(key, row);
}
console.log(`  ${weeks.length} rows, ${reg} regular season`);

const all = [...byPlayerTeam.values()].map((r) => {
  const pos = Object.entries(r.byPos)
    .sort((a, b) => b[1] - a[1] || POS.indexOf(a[0]) - POS.indexOf(b[0]))[0][0];
  return { team: r.team, name: r.name, pos, td: r.td, games: r.games };
});
const pool = all.filter((r) => r.games >= MIN_GAMES);
console.log(`  ${all.length} player-team seasons, ${pool.length} with ${MIN_GAMES}+ games`);

// ---------- Every assertion the mode's balance rests on ----------
// These are not paranoia. The first version of this analysis ran against the wrong file and reported 18 of 31
// teams with a quarterback; the owner knew that was wrong from watching football. A build that cannot deal a
// legal board must fail here, loudly, rather than ship a mode that strands a player mid-run.
const teams = [...new Set(pool.map((r) => r.team))].sort();
const bad = [];
if (teams.length !== 32) bad.push(`${teams.length} teams, expected 32`);
for (const t of teams) if (!TEAMS[t]) bad.push(`unknown team code ${t}`);
for (const t of Object.keys(TEAMS)) if (!teams.includes(t)) bad.push(`no players for ${t}`);
for (const t of teams) for (const p of POS) {
  if (!pool.some((r) => r.team === t && r.pos === p)) bad.push(`${t} has no ${p}`);
}
const seen = new Set();
for (const r of pool) {
  const k = `${r.team}|${r.name}`;
  if (seen.has(k)) bad.push(`two rows for ${k}`);
  seen.add(k);
  if (!Number.isInteger(r.td) || r.td < 0) bad.push(`${k} has td ${r.td}`);
}
if (bad.length) {
  console.error(`\nREFUSING TO WRITE - ${bad.length} problem(s):`);
  for (const b of bad.slice(0, 20)) console.error(`  ${b}`);
  process.exit(1);
}

// ---------- Write ----------
// Positional rows behind a `columns` list, the same shape as data/versus-pool.json and for the same reason: this
// file is bundled into the page every visitor loads, and repeating four key names 450 times costs bytes for
// nothing. century-logic.mjs's initCenturyData expands them.
const POS_ORDER = (p) => POS.indexOf(p);
const COLUMNS = ["team", "name", "pos", "td", "games"];
pool.sort((a, b) => (a.team !== b.team ? (a.team < b.team ? -1 : 1)
  : POS_ORDER(a.pos) !== POS_ORDER(b.pos) ? POS_ORDER(a.pos) - POS_ORDER(b.pos)
  : b.td !== a.td ? b.td - a.td : a.name < b.name ? -1 : 1));
const out = {
  built: new Date().toISOString().slice(0, 10),
  season: SEASON,
  minGames: MIN_GAMES,
  source: `nflverse-data stats_player_week_${SEASON}`,
  columns: COLUMNS,
  players: pool.map((r) => COLUMNS.map((c) => r[c])),
};
mkdirSync(path.join(root, "data"), { recursive: true });
const file = path.join(root, `data/season-${SEASON}.json`);
writeFileSync(file, `${JSON.stringify(out)}\n`);

const total = pool.reduce((n, r) => n + r.td, 0);
const sizes = teams.map((t) => pool.filter((r) => r.team === t).length);
console.log(`\nwrote data/season-${SEASON}.json: ${pool.length} players, ${teams.length} teams, `
  + `boards ${Math.min(...sizes)}-${Math.max(...sizes)}, ${total} touchdowns, `
  + `${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
for (const p of POS) {
  const top = pool.filter((r) => r.pos === p).sort((a, b) => b.td - a.td)[0];
  console.log(`  best ${p}: ${top.name} (${top.team}) ${top.td}`);
}
