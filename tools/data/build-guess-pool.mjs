// Builds data/guess-pool.json: the players Guess the Player deals from, with the five things a guess is judged
// on - team, division, position, draft class and jersey number. That game only; nothing else reads this file.
//
//   node tools/data/build-guess-pool.mjs
//
// ---------------------------------------------------------------------------------------------------------
// WHO IS IN THE GAME (v2.14.0): THE MEN PLAYING RIGHT NOW, PLUS A FEW WHO WILL NEVER BE FORGOTTEN.
//
//   * quarterbacks, running backs, receivers and tight ends with MIN_SNAPS snaps in the season being played
//   * and the LEGENDS - the best retired players at those same positions, by career value
//
// About 170 of the first in September, growing every week as snaps accumulate, and 25 of the second.
//
// This is the third shape this pool has had, and the reasoning is worth keeping because each one failed
// differently:
//
//   v2.13.0  every drafted player with a five-season career - 4,637 of them. Wrong at both ends: 723 men lasted
//            five seasons without ever playing (Rodney Adams took TEN snaps in six), and a career takes five
//            years to measure, so the draft classes stopped at 2022 and no Jayden Daniels or Brock Bowers could
//            ever be the answer. Most days were closer to Rodney Adams than to Peyton Manning.
//   then     a Guessability Score - recency, prominence within position, longevity, accolades, starts, draft
//            capital - taking a share of each position group, about 770 players. Much better, and still asking
//            about the hundredth-best corner of the century.
//   now      the men on the field, and the handful nobody has forgotten. The observation behind it: a fan can
//            place the players he is watching this season far more readily than anyone else, whatever a
//            career-value model says, and the point of a daily is that most people can get it.
//
// WHAT IT COSTS, and it is not small: there is no defence in this game and no offensive line, and of the
// retired only the very top. It is a quiz about the season being played rather than about all of football, and
// that was chosen deliberately to make it winnable.
//
// IT GOES STALE. The active half is a photograph of a season in progress: rebuild it weekly while football is
// being played, and again when a season ends. `built` and `throughWeek` in the file say when it was taken.
// ---------------------------------------------------------------------------------------------------------
//
// Where it comes from, the same public nflverse project as the rest:
//   snap_counts_YYYY.csv  every player's snaps in every game - which is what "playing" means here
//   roster_YYYY.csv       jersey numbers, and the team an undrafted man came in with
//   players.csv           position, draft year and team, first and last season
//   draft_picks.csv       PFR's career value and accolades - what picks the legends, and orders everybody
//
// About 30 MB is fetched the first time, cached under build/nflverse/ - delete that folder to refetch.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEAMS } from "../../game-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLAYERS = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
const DRAFT = "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv";
const SNAPS = (y) => `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${y}.csv`;
const ROSTER = (y) => `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${y}.csv`;

// Snaps in the season being played. A hundred is about a game and a half of starting, which is low enough to
// take every starter and the backs and receivers in a rotation, and high enough to leave out a man who has been
// on the field twice.
const MIN_SNAPS = 100;
// The positions people watch. The line and the defence were in the pool until this release and are much of the
// reason it was hard: a lineman has no statistics a fan carries around, and nothing the game shows is about him
// rather than about his team.
const GROUPS_IN = ["QB", "RB", "WR", "TE"];
// And the retired, who are here because a football quiz with no Jerry Rice in it is a strange thing. Taken by
// career standing WITHIN each position, so the quarterbacks - whose career value runs highest by a long way -
// cannot take all of the places.
const LEGENDS = 25;
// Which season is "now". The current year until the new season's snaps appear, then that one.
const SEASON = Number(process.env.GP_SEASON || new Date().getUTCFullYear());

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

const cache = path.join(root, "build/nflverse");
async function csv(url, name) {
  mkdirSync(cache, { recursive: true });
  const file = path.join(cache, name);
  let text;
  if (existsSync(file)) text = readFileSync(file, "utf8");
  else {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`${res.status} for ${url}`);
    text = await res.text();
    writeFileSync(file, text);
  }
  const [head, ...lines] = text.trim().split("\n");
  const cols = cells(head.replace(/\r$/, ""));
  return lines.map((line) => {
    const values = cells(line.replace(/\r$/, ""));
    const row = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = values[i] === "NA" ? "" : values[i];
    return row;
  });
}
const num = (v) => Number(v) || 0;

// nflverse spells a few teams by the name they had at the time; the game speaks one code per franchise. Kept
// identical to the other two builders on purpose.
const TEAM_CODE = { OAK: "LV", SD: "LAC", STL: "LA", LAR: "LA", SL: "LA", WSH: "WAS", ARZ: "ARI", BLT: "BAL", CLV: "CLE", HST: "HOU" };
const code = (t) => TEAM_CODE[t] || t;

// The position a guess is COMPARED on, beside the exact one. With only the skill positions left the group is
// nearly the position - but a fullback still groups with the backs, and the side of the ball still has to exist
// for compareGuess to have something to call "close".
const GROUP = { QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE", HB: "RB" };
const SIDE = { QB: "offence", RB: "offence", WR: "offence", TE: "offence" };

// ---------- Who is playing ----------
console.log(`fetching the ${SEASON} season's snap counts...`);
let snapRows;
try { snapRows = await csv(SNAPS(SEASON), `snaps-${SEASON}.csv`); }
catch (e) {
  console.error(`\nREFUSING TO WRITE - no snap counts for ${SEASON}. If the season has not started, build the`);
  console.error(`previous one with GP_SEASON=${SEASON - 1}.`);
  process.exit(1);
}
const playing = new Map();   // pfr id -> snaps this season
let week = 0;
for (const r of snapRows) {
  if (r.game_type !== "REG" || !r.pfr_player_id) continue;
  week = Math.max(week, num(r.week));
  playing.set(r.pfr_player_id, (playing.get(r.pfr_player_id) || 0) + num(r.offense_snaps) + num(r.defense_snaps));
}
console.log(`  through week ${week}: ${playing.size} players have taken a snap`);

console.log("fetching the rosters...");
// Jersey numbers, which the player index leaves blank for hundreds of people - and the team an undrafted man
// came into the league with, which is the one thing the draft cannot tell us about him.
const worn = new Map();       // gsis id -> Map(number -> seasons seen)
const firstTeam = new Map();  // gsis id -> [season, team], earliest season seen
for (let year = 1999; year <= SEASON; year++) {
  let rows;
  try { rows = await csv(ROSTER(year), `roster-${year}.csv`); }
  catch (e) { continue; }
  for (const r of rows) {
    const id = r.gsis_id;
    if (!id) continue;
    const n = num(r.jersey_number);
    if (n) {
      const seen = worn.get(id) || new Map();
      seen.set(n, (seen.get(n) || 0) + 1);
      worn.set(id, seen);
    }
    const team = code(r.team);
    const at = firstTeam.get(id);
    if (team && TEAMS[team] && (!at || year < at[0])) firstTeam.set(id, [year, team]);
  }
}
const rosterNumber = new Map();
for (const [id, seen] of worn) {
  let best = 0; let most = -1;
  for (const [n, count] of [...seen].sort((a, b) => a[0] - b[0])) if (count > most) { most = count; best = n; }
  rosterNumber.set(id, best);
}
console.log(`  ${rosterNumber.size} players with a jersey number on a roster somewhere`);

console.log("fetching the player index and the draft history...");
const all = await csv(PLAYERS, "players.csv");
const drafted = new Map();
for (const r of await csv(DRAFT, "draft_picks.csv")) if (r.pfr_player_id) drafted.set(r.pfr_player_id, r);
console.log(`  ${all.length} players, ${drafted.size} of them with career value on record`);

// Everyone the game COULD hold: a skill position, a number, a team and a class. Who is actually taken is
// decided below.
const candidates = [];
const skipped = { position: 0, number: 0, team: 0 };
for (const p of all) {
  if (!p.display_name || !p.position) continue;
  const group = GROUP[p.position];
  if (!group) { skipped.position++; continue; }

  // The number, which is one of the five columns. NOT read straight off the player index and judged there:
  // that is how Ezekiel Elliott, a fourth overall pick with two rushing titles, was in no version of this game
  // - the index leaves jersey_number blank for hundreds of people and the rosters have it. nflverse also
  // writes 0 for "unknown", and 0 only became a legal number in 2023.
  const to = num(p.last_season);
  const number = num(p.jersey_number) || rosterNumber.get(p.gsis_id) || 0;
  if (number === 0 && to < 2023) { skipped.number++; continue; }

  // Drafted: the team that drafted him, which is the rule the game plays by - Brett Favre is an Atlanta Falcon
  // here. Undrafted: the team he came into the league with, which is the same idea and is what the rosters say;
  // his first season stands as his class. The rosters only go back to 1999, so an undrafted man who came in
  // before that has no team and is left out - Warren Moon among them.
  const undrafted = !p.draft_year;
  const team = undrafted ? (firstTeam.get(p.gsis_id) || [])[1] : code(p.draft_team);
  const draftClass = undrafted ? num(p.rookie_season) : num(p.draft_year);
  if (!team || !TEAMS[team] || !draftClass) { skipped.team++; continue; }

  const d = drafted.get(p.pfr_id) || {};
  candidates.push({
    name: p.display_name,
    pos: p.position,
    group,
    team,
    draft: draftClass,
    undrafted,
    number,
    from: num(p.rookie_season),
    to,
    snaps: playing.get(p.pfr_id) || 0,
    seasons: num(p.rookie_season) && to ? to - num(p.rookie_season) + 1 : 1,
    av: num(d.w_av),
    probowls: num(d.probowls),
    allpro: num(d.allpro),
    hof: d.hof === "TRUE" || d.hof === "1",
    pick: num(d.pick) || 9999,
  });
}

// ---------- The two halves ----------
const active = candidates.filter((p) => p.snaps >= MIN_SNAPS);
for (const p of active) p.active = true;
console.log(`  ${active.length} men playing a skill position with ${MIN_SNAPS}+ snaps this season`);

// The legends: retired, and the best of the retired by what their careers were worth. Ranked WITHIN a position,
// because a quarterback's career value runs half again as high as a receiver's and a straight list of the top
// 25 would be almost all quarterbacks. Retired means he has not taken a snap this season.
const retired = candidates.filter((p) => !p.active && p.to < SEASON);
const career = (p) => p.av + 10 * p.probowls + 25 * p.allpro + 60 * (p.hof ? 1 : 0);
const standing = new Map();
for (const g of GROUPS_IN) {
  const men = retired.filter((p) => p.group === g).sort((a, b) => career(a) - career(b));
  men.forEach((p, i) => standing.set(p, men.length > 1 ? i / (men.length - 1) : 1));
}
const legends = retired
  .sort((a, b) => (standing.get(b) - standing.get(a)) || career(b) - career(a) || (a.name < b.name ? -1 : 1))
  .slice(0, LEGENDS);
for (const p of legends) p.legend = true;
console.log(`  ${legends.length} legends: ${legends.slice(0, 6).map((p) => p.name).join(", ")}...`);

const pool = [...active, ...legends];

// ---------- How hard is each one ----------
// Not who is IN - that is decided above - but the order they come in, which the end screen prints as the day's
// difficulty and nothing else uses. Snaps first, because on a field of current players the man you see every
// Sunday is the one you can name; then what the league has said about him. A legend is not measured on snaps he
// is not taking, so his standing among the retired stands in for them.
const mostSnaps = Math.max(1, ...pool.map((p) => p.snaps));
const guessability = (p) => 0.45 * (p.legend ? 0.9 : p.snaps / mostSnaps)
  + 0.25 * Math.min(1, (p.probowls + 2 * p.allpro + (p.hof ? 4 : 0)) / 4)
  + 0.15 * Math.min(1, p.av / 60)
  + 0.10 * Math.min(1, p.seasons / 8)
  // A high pick is a name from draft night, which is most of what anybody knows about a rookie.
  + 0.05 * (p.pick <= 10 ? 1 : p.pick <= 32 ? 0.6 : p.pick <= 100 ? 0.3 : 0);

// ---------- Five greens has to identify a player ----------
// A row where team, position, draft class and number all match must BE the answer, or a player could go all
// green and not have won. Among a couple of hundred men it is unlikely - but it is checked, and a clash nobody
// has decided fails the build rather than being tie-broken quietly.
const KEEP = {};
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
  const keeper = choice && group.find((p) => p.name === choice[0]);
  if (!keeper) { undecided.push([shape, group]); continue; }
  for (const loser of group) if (loser !== keeper) dropped.push(loser);
}
if (undecided.length) {
  console.error(`\nREFUSING TO WRITE - ${undecided.length} clash(es) nobody has decided:`);
  for (const [shape, group] of undecided) {
    console.error(`  ${shape}`);
    for (const p of group) console.error(`      ${p.name} (${p.from}-${p.to}, ${p.snaps} snaps this season)`);
  }
  console.error("\nAdd each to KEEP in this file, naming the player to keep and why.");
  process.exit(1);
}
const drop = new Set(dropped);
const kept = pool.filter((p) => !drop.has(p));
pool.length = 0;
pool.push(...kept);

// ---------- What the game rests on ----------
const bad = [];
if (pool.length < 100) bad.push(`${pool.length} players is too few for a daily - has the season started?`);
for (const g of GROUPS_IN) {
  const n = pool.filter((p) => p.group === g).length;
  if (n < 15) bad.push(`only ${n} ${g} - every position has to be a real possibility`);
}
const teamsIn = new Set(pool.map((p) => p.team));
// Not every team need be represented - this is who is playing, and a team can field nobody the bar admits -
// but if a third of the league is missing, something is wrong with the fetch rather than with football.
if (teamsIn.size < 24) bad.push(`only ${teamsIn.size} teams are represented`);
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
// Positional rows behind a `columns` list, and team/position/group as indices into their own small tables.
// guess-logic.mjs's initGuessData expands them.
const TEAM_LIST = [...new Set(pool.map((p) => p.team))].sort();
const POS_LIST = [...new Set(pool.map((p) => p.pos))].sort();
const GROUP_LIST = [...new Set(pool.map((p) => p.group))].sort();
const COLUMNS = ["name", "team", "pos", "group", "draft", "number", "from", "to", "score", "und"];
pool.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.draft - b.draft));
const out = {
  built: new Date().toISOString().slice(0, 10),
  source: `nflverse-data: ${SEASON} snap counts, rosters, players.csv, draft_picks.csv`,
  season: SEASON,
  throughWeek: week,
  minSnaps: MIN_SNAPS,
  legends: legends.length,
  groupsIncluded: GROUPS_IN,
  teams: TEAM_LIST,
  positions: POS_LIST,
  groups: GROUP_LIST,
  sides: SIDE,
  columns: COLUMNS,
  players: pool.map((p) => [
    p.name, TEAM_LIST.indexOf(p.team), POS_LIST.indexOf(p.pos), GROUP_LIST.indexOf(p.group),
    p.draft, p.number, p.from, p.to,
    // 0-100: how guessable this man is thought to be. Only the end screen uses it, to print the day's
    // difficulty - the pool is not chosen by it.
    Math.round(guessability(p) * 10000) / 100,
    // Undrafted, so the end screen says "came in 2021" rather than "drafted 2021", which would be a lie.
    p.undrafted ? 1 : 0,
  ]),
};
mkdirSync(path.join(root, "data"), { recursive: true });
writeFileSync(path.join(root, "data/guess-pool.json"), `${JSON.stringify(out)}\n`);

const byGroup = {};
for (const p of pool) byGroup[p.group] = (byGroup[p.group] || 0) + 1;
const order = [...pool].sort((a, b) => guessability(a) - guessability(b));
console.log(`\nwrote data/guess-pool.json: ${pool.length} players, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
console.log(`  ${Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`
  + `   ${teamsIn.size} teams · ${pool.filter((p) => p.undrafted).length} undrafted · ${legends.length} retired`);
console.log(`  skipped: ${skipped.number} with no jersey number, ${skipped.team} with no team the game knows`);
console.log(`  easiest: ${order.slice(-5).reverse().map((p) => p.name).join(", ")}`);
console.log(`  hardest: ${order.slice(0, 5).map((p) => p.name).join(", ")}`);
console.log(`  the daily comes round in ${pool.length} days (${(pool.length / 30.4).toFixed(1)} months) - `
  + `REBUILD WEEKLY while the season is on, the active half grows with it`);
