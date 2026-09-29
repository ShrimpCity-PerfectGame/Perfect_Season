// Builds data/guess-pool.json: the players Guess the Player deals from, with the five things a guess is judged
// on - team, division, position, draft class and jersey number. That game only; nothing else reads this file.
//
//   node tools/data/build-guess-pool.mjs
//
// Why a file of its own. data/players.json is the DRAFT's pool: offensive skill positions only (QB, RB, WR, TE),
// because those are the only ones a fantasy roster scores. A guessing game needs the other 70% of a squad -
// corners, guards, edge rushers - or every answer is one of four positions and the position column stops
// meaning anything. data/season-2025.json is one season of the same four. So this is a third source.
//
// ---------------------------------------------------------------------------------------------------------
// WHO IS IN THE GAME (v2.14.0). One list: everybody here can be typed as a guess AND asked as the answer.
//
// The first version took every drafted player with a five-season career - 4,637 of them - and it was wrong at
// both ends. Five seasons is not fame: 723 men lasted that long without ever playing, and Rodney Adams took TEN
// snaps across six seasons and three teams. And a career takes five years to measure, so the pool's draft
// classes stopped at 2022: no Jayden Daniels, no Brock Bowers, no C.J. Stroud, no Puka Nacua, no Travis Hunter.
// The game was asking about men nobody could place while refusing to ask about the ones everybody has watched.
//
// So the question is no longer "did he last" but "would a fan know him", and that is a RANKING, not a filter:
//
//   1. A FLOOR. 32 games, or 16 starts, or one season of real playing time, or a single Pro Bowl. Below that a
//      man is not eligible at any weighting, which is most of the 7,000 gone before any scoring happens.
//   2. A GUESSABILITY SCORE, four parts weighted to sum to one: recency, prominence within his own position,
//      longevity and accolades. See WEIGHT below for what each is for.
//   3. A SHARE OF EACH POSITION GROUP, so the game stays a football team rather than a list of quarterbacks.
//
// The result is about 700 players, which is also how long the daily takes to come round again: two years.
// ---------------------------------------------------------------------------------------------------------
//
// Where it comes from, the same public nflverse project as the rest:
//   players.csv          one row per player ever: name, position, jersey number, draft year/round/pick/team
//   draft_picks.csv      PFR's draft history: career AV, Pro Bowls, All-Pros, the Hall of Fame
//   snap_counts_YYYY.csv every player's snaps in every game, 2012 on - which is what "started" means here
//
// About 45 MB is fetched, cached under build/nflverse/ so a re-run is quick - delete that folder to refetch.
// What lands in the repo is a few hundred small rows. Re-run it when a season ends.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEAMS } from "../../game-logic.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLAYERS = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";
const DRAFT = "https://github.com/nflverse/nflverse-data/releases/download/draft_picks/draft_picks.csv";
const SNAPS = (y) => `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${y}.csv`;

// The game only goes back as far as the rest of Gridspin does.
const FIRST_SEASON = 1999;
// ---------------------------------------------------------------------------------------------------------
// THE GUESSABILITY SCORE. Four parts, each scaled 0-1 so the weights mean what they say, and they sum to 1.
//
//   Score = 0.30 R + 0.35 Q + 0.10 L + 0.15 A + 0.05 S + 0.05 D
//
// R, recency, is the biggest term on purpose: this is a daily played today, and the players people have just
// watched are the ones they can place. It decays smoothly rather than in steps - a cliff at "started in the
// last three seasons" would treat a 2023 starter and a 2022 starter as different kinds of person.
// P, prominence, is measured WITHIN a position, so a top-decile guard scores like a top-decile receiver. L
// keeps familiar veterans who were never stars. A lets the legends outrun the decay: Peyton Manning's quality
// and accolades carry him past a current backup, which is the whole test of whether the weights are right.
const WEIGHT = { recency: 0.30, prominence: 0.35, longevity: 0.10, accolades: 0.15, starter: 0.05, draft: 0.05 };
// S, the starter term, is the guard against a long career that hardly played: four seasons as a primary starter
// is about 64 starts, which is full marks. Games carry the rest, so a return man or a rotational end is not
// counted as nobody.
//
// D, draft capital, is the small one that earns its place: it is the only thing here that knows a player before
// he has done anything. A first overall pick is a name on draft night, and without it a rookie season cannot
// outscore a decade of somebody forgettable - which is how Ashton Jeanty and Cam Ward, the sixth pick and the
// first, sat outside a pool meant to feel current.
const STARTER_SEASONS_FULL = 4;
const STARTER_GAMES_FULL = 64;
// exp(-DECAY * seasons since he last played): 2026 = 1.00, 2024 = 0.92, 2020 = 0.79, 2015 = 0.64, 2005 = 0.43,
// 2000 = 0.35. Gentler than it first looked: at 0.055 the pool came out 691 of 731 from the 2020s, with Ray
// Lewis and Troy Aikman outside it, which is not a football quiz - it is this season's depth chart.
const DECAY = 0.04;
// Eight seasons is a long career; everything at or past it is the same "familiar veteran".
const LONG_CAREER = 8;
// By this many seasons a player is judged on what he did, and before it partly on where he was drafted.
const SETTLED_SEASONS = 4;
// Pro Bowls plus twice the All-Pros; ten of those is a career nobody needs reminding of, and the Hall of Fame is
// full marks by itself. (PFR's draft table carries no MVP or OPOY column, so those ride in as All-Pros.)
const FULL_ACCOLADES = 10;
//
// THE FLOOR, applied before any of that. A man who played eight special-teams snaps for Jacksonville in 2007
// should never be a daily answer, and no amount of weighting should have to decide it: he is not eligible at
// all. Any ONE of these is enough, so a one-year star and a ten-year backup both clear it honestly.
const FLOOR = { games: 32, starts: 16, snapSeason: 500, accolade: 1 };
//
// And what is kept: a share of each position group, not a share of everybody. Ranked together, quarterbacks are
// crowded out by sheer numbers - a flat tenth of the field gave 34 quarterbacks and 141 defensive backs, which
// is the right shape for a ROSTER and the wrong shape for a QUIZ. There are 32 starting quarterbacks at a time
// and every one is a household name; the hundredth-best corner of the century is not.
const SHARE = { QB: 0.30, RB: 0.18, WR: 0.18, TE: 0.18, OL: 0.105, DL: 0.12, LB: 0.135, DB: 0.12, SPEC: 0.22 };
// ...but never fewer than this from a group, or a small one (kickers and punters) stops being a real answer.
const MIN_PER_GROUP = 15;
// ---------------------------------------------------------------------------------------------------------

// What "started" means, for the floor above. Snap counts begin in 2012, so this can only speak about the modern
// game - which is all it is asked to do, since the rest is covered by games and starts.
const SNAP_ERA = 2012;
const STARTER_SNAPS = 500;
// Kickers, punters and long snappers play no offence and no defence at all, so the same threshold would say no
// specialist has ever started. Their snaps are special-teams snaps.
const SPECIALIST_ST_SNAPS = 100;

// ---------------------------------------------------------------------------------------------------------
// THE ONE-LINE SWITCH. `team` is the team that DRAFTED a player, which is unambiguous and needs no roster
// history - and which means an undrafted player has no team and cannot be in the game at all. That costs
// Warren Moon, Antonio Gates, James Harrison, London Fletcher, Jon Kitna and Justin Tucker, among others. It is
// a deliberate choice, not an oversight.
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

// The position a guess is COMPARED on, beside the exact one. nflverse spells the same job several ways
// (DB/CB/S/SAF/FS, LB/OLB/ILB/MLB, DE/DT/NT, OT/G/C/OL), which would make an exact-match column mostly grey
// and useless - so the group is what turns yellow and the exact position is what turns green. It is also what
// the pool is balanced across, above.
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

// ---------- What each man did ----------
console.log("fetching snap counts...");
const NOW = new Date().getUTCFullYear();
const play = new Map();   // pfr id -> season -> { snaps, st }
for (let year = SNAP_ERA; year <= NOW; year++) {
  let rows;
  try { rows = await csv(SNAPS(year), `snaps-${year}.csv`); }
  catch (e) { console.log(`  ${year}: not published yet`); continue; }
  for (const r of rows) {
    // The regular season only. A player who is placeable played in it; nobody is remembered for a preseason.
    if (r.game_type !== "REG" || !r.pfr_player_id) continue;
    const per = play.get(r.pfr_player_id) || new Map();
    const season = per.get(num(r.season)) || { snaps: 0, st: 0 };
    season.snaps += num(r.offense_snaps) + num(r.defense_snaps);
    season.st += num(r.st_snaps);
    per.set(num(r.season), season);
    play.set(r.pfr_player_id, per);
  }
  process.stdout.write(`${year} `);
}
console.log(`\n  ${play.size} players with snaps recorded since ${SNAP_ERA}`);

console.log("fetching the draft history...");
const drafted = new Map();
for (const r of await csv(DRAFT, "draft_picks.csv")) if (r.pfr_player_id) drafted.set(r.pfr_player_id, r);
console.log(`  ${drafted.size} drafted players with career value on record`);

console.log("fetching the player index...");
const all = await csv(PLAYERS, "players.csv");
console.log(`  ${all.length} players in nflverse's index`);

// ---------------------------------------------------------------------------------------------------------
// THE FAME BONUS, and it is the only hand-written thing in the score. Statistics cannot see a Heisman, a
// playoff moment or a rookie everybody already argues about, and a first season leaves almost nothing to
// measure - so a man can be among the best known in the league and score like a rotational guard.
//
// Points on the same 0-100 scale as the score, so 5 is about the width of a band. USE IT SPARINGLY, and write
// the reason: every entry here is a claim that the data is wrong about somebody, and the list should shrink on
// its own as careers accumulate (all three below are first-year players whose numbers will speak next season).
const FAME = {
  "Travis Hunter": [4, "a Heisman winner playing both ways - the one thing no column here can see"],
  "Cam Ward": [2, "first overall and starting from week one; he misses the quarterback cut by a fifth of a point"],
};
// ---------------------------------------------------------------------------------------------------------

const FAMOUS = new Set(Object.keys(FAME));
const eligible = [];
let noNumber = 0;
let belowFloor = 0;
let all_eligible_rows = 0;
for (const p of all) {
  const to = num(p.last_season);
  if (to < FIRST_SEASON) continue;
  if (!p.display_name || !p.position || !p.jersey_number) continue;
  const group = GROUP[p.position];
  if (!group) continue; // a spelling this file has never seen: reported below rather than mis-grouped
  const team = code(p.draft_team);
  if (!p.draft_year || !team) { if (!INCLUDE_UNDRAFTED) continue; }
  if (!TEAMS[team]) continue;
  const number = num(p.jersey_number);
  // nflverse writes 0 for a number it does not have, and 0 only became a legal NFL number in 2023 - so for
  // anyone who finished before then it means "unknown", not "zero". 88 of them were in the shipped pool wearing
  // a #0 they never wore: Aqib Talib (21), Blair Walsh (3), Bashaud Breeland (26). The number is one of the
  // five columns, so a player without one cannot be in the game at all.
  if (number === 0 && to < 2023) { noNumber++; continue; }

  const d = drafted.get(p.pfr_id) || {};
  const per = play.get(p.pfr_id) || new Map();
  const startedIn = [...per.entries()]
    .filter(([, s]) => (group === "SPEC" ? s.st >= SPECIALIST_ST_SNAPS : s.snaps >= STARTER_SNAPS))
    .map(([season]) => season);
  const from = num(p.rookie_season);
  all_eligible_rows++;
  // The floor. Any one of these is a real career; none of them is is a man who dressed twice.
  const accolades = num(d.probowls) + num(d.allpro) + (d.hof === "TRUE" || d.hof === "1" ? 1 : 0);
  // A name somebody has written into FAME below is eligible by saying so: the floor exists to throw out men
  // nobody could place, and that table is the statement that this one can be.
  const clears = num(d.games) >= FLOOR.games || num(d.seasons_started) >= FLOOR.starts
    || startedIn.length > 0 || accolades >= FLOOR.accolade || FAMOUS.has(p.display_name);
  if (!clears) { belowFloor++; continue; }
  eligible.push({
    name: p.display_name,
    pos: p.position,
    group,
    team,
    draft: num(p.draft_year),
    number,
    from,
    to,
    seasons: from && to ? to - from + 1 : 0,
    av: num(d.w_av),
    probowls: num(d.probowls),
    allpro: num(d.allpro),
    hof: d.hof === "TRUE" || d.hof === "1",
    round: num(d.round) || num(p.draft_round) || 99,
    pick: num(d.pick) || num(p.draft_pick) || 9999,
    startedIn,
    games: num(d.games),
    starts: num(d.seasons_started),
    carAv: num(d.car_av),
  });
}
console.log(`  ${noNumber} dropped for having no jersey number on record`);
console.log(`  ${belowFloor} below the floor (under ${FLOOR.games} games, ${FLOOR.starts} starts, a real season or an accolade)`);
console.log(`  ${eligible.length} drafted players to choose from`);

// ---------- The guessability score ----------
const years = (p) => Math.max(1, Math.min(p.seasons, NOW - p.from + 1));

// R - how recently he played. The whole curve is in one line; DECAY is what tunes it.
const recency = (p) => Math.exp(-DECAY * Math.max(0, NOW - p.to));

// D - where he was taken. First overall is 1, the end of the first round is about a half, and it fades to
// nothing through the second. Deliberately small: it is a head start, not a career.
const draftCapital = (p) => (p.round === 1 ? Math.max(0.4, 1 - (p.pick - 1) / 64)
  : p.round === 2 ? 0.15 : 0);

// P - how good he was FOR HIS POSITION, as a percentile among the eligible men who played it. Two halves: what
// he was at his best, and what he was over a career. PFR's weighted AV already leans on a player's best seasons
// and its plain career AV does not, so the pair of them is the closest this data comes to "peak and volume"
// without a per-season value for every lineman in the league.
//
// A percentile rather than the raw number because the numbers do not mean the same thing across positions: a
// good guard's career AV and a good receiver's are different sizes, and comparing them directly is how a pool
// becomes quarterbacks and receivers.
const percentiles = new Map();
for (const group of [...new Set(eligible.map((p) => p.group))]) {
  const men = eligible.filter((p) => p.group === group);
  for (const [key, of] of [["peak", (p) => p.av / years(p)], ["career", (p) => p.carAv]]) {
    const sorted = men.map(of).sort((a, b) => a - b);
    for (const p of men) {
      const v = of(p);
      // The share of his position he is at least as good as. Ties take the bottom of their run, so a room full
      // of zeroes does not hand everybody a high percentile.
      let lo = 0;
      while (lo < sorted.length && sorted[lo] < v) lo++;
      const cur = percentiles.get(p) || {};
      cur[key] = sorted.length > 1 ? lo / (sorted.length - 1) : 0;
      percentiles.set(p, cur);
    }
  }
}
const prominence = (p) => {
  const q = percentiles.get(p) || {};
  const measured = 0.6 * (q.peak || 0) + 0.4 * (q.career || 0);
  // A career you cannot measure yet. Every other term here is career-shaped - percentiles, longevity, Pro Bowls,
  // starts - so a first-year player is a dozen points short of any cut by construction, however famous he is.
  // That is not a judgement about him, it is arithmetic about how little he has played, and it was keeping the
  // first pick in the draft out of a pool meant to feel current.
  //
  // So before he has a record, his prominence IS where he was taken - which is exactly what a fan knows about
  // him - and the measured value takes over as the seasons arrive. By his fourth it is all that is left. This
  // cuts both ways, which is why it is honest: a second-year seventh-rounder is pulled DOWN by the same blend.
  const known = Math.min(1, p.seasons / SETTLED_SEASONS);
  return known * measured + (1 - known) * draftCapital(p);
};

// L - a career long enough to be familiar even without a highlight.
const longevity = (p) => Math.min(1, p.seasons / LONG_CAREER);

// A - what the league said about him at the time. The Hall of Fame is full marks on its own.
const accolade = (p) => (p.hof ? 1 : Math.min(1, (p.probowls + 2 * p.allpro) / FULL_ACCOLADES));

// S - did he actually play? The guard against a long career spent inactive: a man can be in the league eight
// years and never start, and longevity alone would reward him for it.
const starter = (p) => 0.7 * Math.min(1, p.starts / STARTER_SEASONS_FULL)
  + 0.3 * Math.min(1, p.games / STARTER_GAMES_FULL);

const score = (p) => WEIGHT.recency * recency(p)
  + WEIGHT.prominence * prominence(p)
  + WEIGHT.longevity * longevity(p)
  + WEIGHT.accolades * accolade(p)
  + WEIGHT.starter * starter(p)
  + WEIGHT.draft * draftCapital(p)
  + (FAME[p.name] ? FAME[p.name][0] / 100 : 0);

const pool = [];
const report = [];
for (const group of [...new Set(eligible.map((p) => p.group))].sort()) {
  const ranked = eligible.filter((p) => p.group === group)
    .sort((a, b) => score(b) - score(a) || (a.name < b.name ? -1 : 1));
  const take = Math.max(MIN_PER_GROUP, Math.round(ranked.length * (SHARE[group] ?? 0.1)));
  pool.push(...ranked.slice(0, take));
  report.push({ group, of: ranked.length, take, last: ranked.slice(Math.max(0, take - 3), take), next: ranked.slice(take, take + 3) });
  if (process.env.GP_WHY) {
    for (const nm of process.env.GP_WHY.split(",")) {
      const at = ranked.findIndex((p) => p.name === nm);
      if (at >= 0) console.log(`  WHY ${nm}: ${group} rank ${at + 1} of ${ranked.length}, needs top ${take}; `
        + `score ${(score(ranked[at]) * 100).toFixed(1)} vs cut ${(score(ranked[take - 1]) * 100).toFixed(1)}`);
    }
  }
}

// ---------- Five greens has to identify a player ----------
// The whole game rests on this: a row where team, position, draft class and number all match must BE the
// answer, or a player could go all green and not have won. Ranking the pool down to a few hundred makes it
// rare rather than impossible - two men a team drafted the same year, at the same position, wearing the same
// number, both good enough to be here.
//
// One of each pair stays, and WHICH ONE IS CHOSEN BY HAND. The obvious rule - keep the higher score - is the
// rule that got Maxx Crosby dropped for Clelin Ferrell when it was career length. A clash NOT in this table
// fails the build: a rebuild after a new season can create one, and that is a decision somebody should make,
// not a tie-break applied quietly.
const KEEP = {
  "LV|DE|2019|98": ["Maxx Crosby", "repeat All-Pro; Ferrell was the fourth pick and is remembered for less"],
  "SEA|CB|2022|2": ["Riq Woolen", "All-Rookie with six interceptions; Bryant moved to safety and off the board"],
  "DAL|OLB|2005|94": ["DeMarcus Ware", "Hall of Fame"],
  "NE|CB|2022|25": ["Marcus Jones", "All-Rookie, and the punt return that beat the Jets"],
};

const byShape = new Map();
for (const p of pool) {
  const k = `${p.team}|${p.pos}|${p.draft}|${p.number}`;
  if (!byShape.has(k)) byShape.set(k, []);
  byShape.get(k).push(p);
}
const dropped = [];
const undecided = [];
const used = new Set();
for (const [shape, group] of byShape) {
  if (group.length < 2) continue;
  const choice = KEEP[shape];
  const keeper = choice && group.find((p) => p.name === choice[0]);
  if (!keeper) { undecided.push([shape, group]); continue; }
  used.add(shape);
  for (const loser of group) if (loser !== keeper) dropped.push(loser);
}
if (undecided.length) {
  console.error(`\nREFUSING TO WRITE - ${undecided.length} clash(es) nobody has decided:`);
  for (const [shape, group] of undecided) {
    console.error(`  ${shape}`);
    for (const p of group) {
      console.error(`      ${p.name} (${p.from}-${p.to}, ${p.probowls} Pro Bowls, AV ${p.av}, score ${score(p).toFixed(0)})`);
    }
  }
  console.error("\nAdd each to KEEP in this file, naming the player to keep and why.");
  process.exit(1);
}
const unknownFame = Object.keys(FAME).filter((n) => !eligible.some((p) => p.name === n));
if (unknownFame.length) console.log(`  note: ${unknownFame.length} FAME entr${unknownFame.length === 1 ? "y names somebody" : "ies name people"} not in the data: ${unknownFame.join(", ")}`);
const stale = Object.keys(KEEP).filter((k) => !used.has(k));
if (stale.length) console.log(`  note: ${stale.length} KEEP entr${stale.length === 1 ? "y is" : "ies are"} no longer a clash: ${stale.join(", ")}`);
const drop = new Set(dropped);
const deduped = pool.filter((p) => !drop.has(p));
pool.length = 0;
pool.push(...deduped);
if (dropped.length) console.log(`  ${dropped.length} dropped by hand, one from each clash`);

// ---------- What the game rests on ----------
const bad = [];
const unknownPos = new Set(all.filter((p) => num(p.last_season) >= FIRST_SEASON
  && p.position && !GROUP[p.position]).map((p) => p.position));
if (unknownPos.size) bad.push(`positions with no group: ${[...unknownPos].join(", ")}`);
if (pool.length < 400) bad.push(`${pool.length} players is too few for a daily worth playing`);
for (const g of ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "SPEC"]) {
  const n = pool.filter((p) => p.group === g).length;
  if (n < MIN_PER_GROUP) bad.push(`only ${n} ${g} - the position column needs every group to be a real possibility`);
}
// Every team has to be drawable, or the team column is a lie on the days nobody from that team can come up.
const teamsIn = new Set(pool.map((p) => p.team));
for (const t of Object.keys(TEAMS)) if (!teamsIn.has(t)) bad.push(`no player was drafted by ${t}`);
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
// Positional rows behind a `columns` list, and team/position/group as indices into their own small tables.
// guess-logic.mjs's initGuessData expands them.
const TEAM_LIST = [...new Set(pool.map((p) => p.team))].sort();
const POS_LIST = [...new Set(pool.map((p) => p.pos))].sort();
const GROUP_LIST = [...new Set(pool.map((p) => p.group))].sort();
const COLUMNS = ["name", "team", "pos", "group", "draft", "number", "from", "to", "score"];
pool.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.draft - b.draft));
const out = {
  built: new Date().toISOString().slice(0, 10),
  source: "nflverse-data players.csv + draft_picks.csv + snap_counts",
  firstSeason: FIRST_SEASON,
  poolShare: SHARE,
  weights: WEIGHT,
  decay: DECAY,
  floor: FLOOR,
  includesUndrafted: INCLUDE_UNDRAFTED,
  teams: TEAM_LIST,
  positions: POS_LIST,
  groups: GROUP_LIST,
  sides: SIDE,
  columns: COLUMNS,
  players: pool.map((p) => [
    p.name, TEAM_LIST.indexOf(p.team), POS_LIST.indexOf(p.pos), GROUP_LIST.indexOf(p.group),
    p.draft, p.number, p.from, p.to,
    // 0-100, two decimals: how guessable this man is thought to be. The daily leans on it (guess-logic.mjs
    // deals the better-known more often) and the end screen prints its inverse as the day's difficulty.
    Math.round(score(p) * 10000) / 100,
  ]),
};
mkdirSync(path.join(root, "data"), { recursive: true });
writeFileSync(path.join(root, "data/guess-pool.json"), `${JSON.stringify(out)}\n`);

console.log(`\nwrote data/guess-pool.json: ${pool.length} players, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
for (const r of report) {
  console.log(`  ${r.group.padEnd(5)}${String(r.take).padStart(4)} of ${String(r.of).padStart(4)}   `
    + `last in: ${r.last.map((p) => p.name).join(", ")}`);
  console.log(`  ${" ".repeat(5)}${" ".repeat(12)}just out: ${r.next.map((p) => p.name).join(", ")}`);
}
const recent = pool.filter((p) => p.to >= NOW - 2).length;
const decades = {};
for (const p of pool) decades[`${Math.floor(p.to / 10) * 10}s`] = (decades[`${Math.floor(p.to / 10) * 10}s`] || 0) + 1;
console.log(`  ${recent} of them played in the last three seasons (what the recency term buys)`);
console.log(`  last played: ${Object.entries(decades).sort().map(([d, c]) => `${d} ${c}`).join(" · ")}`);
console.log(`  draft classes ${Math.min(...pool.map((p) => p.draft))}-${Math.max(...pool.map((p) => p.draft))}, `
  + `${teamsIn.size} teams, ${pool.length} days before the daily repeats (${(pool.length / 365).toFixed(1)} years)`);
