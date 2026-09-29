// Builds data/guess-pool.json: the players Guess the Player deals from, with the five things a guess is judged
// on - team, division, position, draft class and jersey number. That game only; nothing else reads this file.
//
//   node tools/data/build-guess-pool.mjs
//
// Why a file of its own, again. data/players.json is the DRAFT's pool: offensive skill positions only (QB, RB,
// WR, TE), because those are the only ones a fantasy roster scores. A guessing game needs the other 70% of a
// squad - corners, guards, edge rushers - or every answer is one of four positions and the position column
// stops meaning anything. data/season-2025.json is one season of the same four. So this is a third source.
//
// Where it comes from, the same public nflverse project as the rest:
//   players.csv   one row per player ever: name, position, jersey number, draft year/round/pick/team
//
// About 7 MB is fetched; what lands in the repo is a few thousand small rows. Re-run it when a season ends.
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEAMS } from "../../game-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLAYERS = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";

// A career this long or more. The answer has to be somebody a fan can place: five seasons is half a decade in
// the league, which is the difference between a player and a name on a practice squad. Measured, it leaves
// 6,489 players before the draft rule below and 4,637 after - still 885 defensive backs and 829 linemen, which
// is the whole point of not reusing the draft's pool.
const MIN_SEASONS = 5;
// The game only goes back as far as the rest of Gridspin does.
const FIRST_SEASON = 1999;

// ---------------------------------------------------------------------------------------------------------
// THE ONE-LINE SWITCH. `team` is the team that DRAFTED a player, which is unambiguous and needs no roster
// history - and which means an undrafted player has no team and cannot be in the game at all. That costs 1,835
// players of the 6,489, and only 188 of those are kickers and punters: the rest include Warren Moon, Antonio
// Gates, James Harrison, London Fletcher and Jon Kitna. It is a deliberate choice, not an oversight.
//
// To put them back: set this true, and give an undrafted player the team they played most seasons for (which
// needs roster_YYYY.csv for every season, about 27 MB) and a draft class of "Undrafted".
const INCLUDE_UNDRAFTED = false;
// ---------------------------------------------------------------------------------------------------------

// One line of CSV, quotes respected - the same parser the other two builders use, and for the same reason: a
// player row carries text with commas inside quotes, and splitting on every comma shifts every column after it.
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
  const text = await res.text();
  const [head, ...lines] = text.trim().split("\n");
  const cols = cells(head.replace(/\r$/, ""));
  return lines.map((line) => {
    const values = cells(line.replace(/\r$/, ""));
    const row = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = values[i] === "NA" ? "" : values[i];
    return row;
  });
}

// nflverse spells a few teams by the name they had at the time; the game speaks one code per franchise. Kept
// identical to the other two builders on purpose.
const TEAM_CODE = { OAK: "LV", SD: "LAC", STL: "LA", LAR: "LA", SL: "LA", WSH: "WAS", ARZ: "ARI", BLT: "BAL", CLV: "CLE", HST: "HOU" };
const code = (t) => TEAM_CODE[t] || t;

// The position a guess is COMPARED on, beside the exact one. nflverse spells the same job several ways
// (DB/CB/S/SAF/FS, LB/OLB/ILB/MLB, DE/DT/NT, OT/G/C/OL), which would make an exact-match column mostly grey
// and useless - so the group is what turns yellow and the exact position is what turns green.
const GROUP = {
  QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE",
  OT: "OL", G: "OL", C: "OL", OL: "OL",
  DE: "DL", DT: "DL", NT: "DL", DL: "DL",
  LB: "LB", OLB: "LB", ILB: "LB", MLB: "LB",
  CB: "DB", S: "DB", SAF: "DB", FS: "DB", SS: "DB", DB: "DB",
  K: "SPEC", P: "SPEC", LS: "SPEC",
};
// And the side of the ball, which is the widest "close" the position column can be.
const SIDE = { QB: "offence", RB: "offence", WR: "offence", TE: "offence", OL: "offence",
  DL: "defence", LB: "defence", DB: "defence", SPEC: "special" };

console.log("fetching the player index...");
const all = await csv(PLAYERS);
console.log(`  ${all.length} players in nflverse's index`);

const seasons = (p) => {
  const a = Number(p.rookie_season), b = Number(p.last_season);
  return a && b ? b - a + 1 : 0;
};

const pool = [];
for (const p of all) {
  if (Number(p.last_season) < FIRST_SEASON) continue;
  if (seasons(p) < MIN_SEASONS) continue;
  if (!p.display_name || !p.position || !p.jersey_number) continue;
  const group = GROUP[p.position];
  if (!group) continue; // a spelling this file has never seen: skipped loudly below rather than mis-grouped
  const team = code(p.draft_team);
  if (!p.draft_year || !team) { if (!INCLUDE_UNDRAFTED) continue; }
  if (!TEAMS[team]) continue;
  pool.push({
    name: p.display_name,
    pos: p.position,
    group,
    team,
    draft: Number(p.draft_year),
    number: Number(p.jersey_number),
    from: Number(p.rookie_season),
    to: Number(p.last_season),
  });
}

// ---------- Five greens has to identify a player ----------
// The whole game rests on this: a row where team, position, draft class and number all match must BE the
// answer, or a player could go all green and not have won. It is not free - 17 groups share all four, because
// a team drafts two players in the same year who end up at the same position wearing the same number.
//
// One of each group stays, and WHICH ONE IS CHOSEN BY HAND. The obvious rule - keep the longer career - gets it
// wrong often enough to matter: Maxx Crosby and Clelin Ferrell both played eight seasons, so it fell through to
// alphabetical and dropped Crosby. So each is a judgement about who a football fan would rather be asked to
// name, written down with its reason.
//
// A clash NOT in this table fails the build. That is deliberate: a rebuild after a new season can create one,
// and the answer is a decision somebody should make, not a tie-break to be applied quietly.
const KEEP = {
  "DEN|G|2010|69": ["Zane Beadles", "a Pro Bowl guard; Olsen was a sixth-rounder who started rarely"],
  "SEA|CB|2022|2": ["Riq Woolen", "All-Rookie with six interceptions; the career-length rule got this one backwards"],
  "JAX|DB|1999|31": ["Fernando Bryant", "a first-round corner who started a decade; Craft was a fifth-round nickel"],
  "DAL|OLB|2005|94": ["DeMarcus Ware", "Hall of Fame"],
  "BUF|DB|2009|31": ["Jairus Byrd", "three Pro Bowls and an All-Pro season"],
  "ARI|G|2013|70": ["Jonathan Cooper", "the seventh pick in the draft - remembered, if not fondly"],
  "LV|DE|2019|98": ["Maxx Crosby", "repeat All-Pro; Ferrell was the fourth pick and is remembered for less"],
  "LA|WR|2003|81": ["Kevin Curtis", "a thousand-yard season in Philadelphia"],
  "KC|WR|1994|87": ["Lake Dawson", "the closest call here - two mid-nineties third-rounders, four picks apart; Dawson caught more"],
  "PHI|OT|2008|77": ["King Dunlap", "a starting left tackle for years in San Diego"],
  "DEN|DB|2005|24": ["Domonique Foxworth", "seven seasons, and later the head of the players' union"],
  "TEN|RB|2006|25": ["LenDale White", "half of Smash and Dash, fifteen touchdowns in 2008"],
  "SEA|TE|2002|86": ["Jerramy Stevens", "a first-round tight end who started a Super Bowl"],
  "NE|CB|2022|25": ["Marcus Jones", "All-Rookie, and the punt return that beat the Jets"],
  "NYJ|G|1999|77": ["Randy Thomas", "eleven seasons, most of them starting in Washington"],
  "SEA|TE|2020|84": ["Colby Parkinson", "still starting; Sullivan was a seventh-round rotation piece"],
  "NE|RB|2000|36": ["Patrick Pass", "eight seasons and three rings; Redmond is remembered for one drive"],
};

const byShape = new Map();
for (const p of pool) {
  const k = `${p.team}|${p.pos}|${p.draft}|${p.number}`;
  if (!byShape.has(k)) byShape.set(k, []);
  byShape.get(k).push(p);
}
const dropped = [];
const undecided = [];
for (const [shape, group] of byShape) {
  if (group.length < 2) continue;
  const choice = KEEP[shape];
  if (!choice) { undecided.push([shape, group]); continue; }
  const keeper = group.find((p) => p.name === choice[0]);
  if (!keeper) { undecided.push([shape, group]); continue; }
  for (const loser of group) if (loser !== keeper) dropped.push(loser);
}
if (undecided.length) {
  console.error(`\nREFUSING TO WRITE - ${undecided.length} clash(es) nobody has decided:`);
  for (const [shape, group] of undecided) {
    console.error(`  ${shape}`);
    for (const p of group) console.error(`      ${p.name} (${p.from}-${p.to})`);
  }
  console.error("\nAdd each to KEEP in this file, naming the player to keep and why.");
  process.exit(1);
}
const stale = Object.keys(KEEP).filter((k) => !byShape.has(k) || byShape.get(k).length < 2);
if (stale.length) console.log(`  note: ${stale.length} KEEP entr${stale.length === 1 ? "y is" : "ies are"} no longer a clash: ${stale.join(", ")}`);
const drop = new Set(dropped);
const deduped = pool.filter((p) => !drop.has(p));
pool.length = 0;
pool.push(...deduped);
console.log(`  ${dropped.length} dropped by hand, one from each clash`);

// ---------- What the game rests on ----------
const bad = [];
const unknownPos = new Set(all.filter((p) => Number(p.last_season) >= FIRST_SEASON && seasons(p) >= MIN_SEASONS
  && p.position && !GROUP[p.position]).map((p) => p.position));
if (unknownPos.size) bad.push(`positions with no group: ${[...unknownPos].join(", ")}`);
if (pool.length < 2000) bad.push(`${pool.length} players is too few for a daily that must not repeat`);
for (const g of ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB"]) {
  const n = pool.filter((p) => p.group === g).length;
  if (n < 50) bad.push(`only ${n} ${g} - the position column needs every group to be a real possibility`);
}
const shapes = new Set();
for (const p of pool) {
  const shape = `${p.team}|${p.pos}|${p.draft}|${p.number}`;
  if (shapes.has(shape)) bad.push(`two players share all five columns: ${shape}`);
  shapes.add(shape);
}
const seen = new Set();
for (const p of pool) {
  const k = `${p.name}|${p.team}|${p.draft}`;
  if (seen.has(k)) bad.push(`two rows for ${k}`);
  seen.add(k);
  if (!Number.isInteger(p.number) || p.number < 0 || p.number > 99) bad.push(`${p.name} wears #${p.number}`);
  if (!Number.isInteger(p.draft) || p.draft < 1936 || p.draft > 2100) bad.push(`${p.name} drafted ${p.draft}`);
}
if (bad.length) {
  console.error(`\nREFUSING TO WRITE - ${bad.length} problem(s):`);
  for (const b of bad.slice(0, 20)) console.error(`  ${b}`);
  process.exit(1);
}

// ---------- Write ----------
// Positional rows behind a `columns` list, and team/position/group as indices into their own small tables: this
// file is bundled into the page every visitor loads, and repeating "Philadelphia Eagles" a hundred times costs
// bytes for nothing. guess-logic.mjs's initGuessData expands them.
const TEAM_LIST = [...new Set(pool.map((p) => p.team))].sort();
const POS_LIST = [...new Set(pool.map((p) => p.pos))].sort();
const GROUP_LIST = [...new Set(pool.map((p) => p.group))].sort();
const COLUMNS = ["name", "team", "pos", "group", "draft", "number", "from", "to"];
pool.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.draft - b.draft));
const out = {
  built: new Date().toISOString().slice(0, 10),
  source: "nflverse-data players.csv",
  minSeasons: MIN_SEASONS,
  firstSeason: FIRST_SEASON,
  includesUndrafted: INCLUDE_UNDRAFTED,
  teams: TEAM_LIST,
  positions: POS_LIST,
  groups: GROUP_LIST,
  sides: SIDE,
  columns: COLUMNS,
  players: pool.map((p) => [
    p.name, TEAM_LIST.indexOf(p.team), POS_LIST.indexOf(p.pos), GROUP_LIST.indexOf(p.group),
    p.draft, p.number, p.from, p.to,
  ]),
};
mkdirSync(path.join(root, "data"), { recursive: true });
const file = path.join(root, "data/guess-pool.json");
writeFileSync(file, `${JSON.stringify(out)}\n`);

const byGroup = {};
for (const p of pool) byGroup[p.group] = (byGroup[p.group] || 0) + 1;
console.log(`\nwrote data/guess-pool.json: ${pool.length} players, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
console.log(`  ${Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
console.log(`  draft classes ${Math.min(...pool.map((p) => p.draft))}-${Math.max(...pool.map((p) => p.draft))}, `
  + `numbers ${Math.min(...pool.map((p) => p.number))}-${Math.max(...pool.map((p) => p.number))}`);
