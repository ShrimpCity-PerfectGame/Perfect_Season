// Builds data/versus-pool.json: every team's defense and every team's kicker, season by season, rated on the
// same 0-130 scale the players use so they can be drafted and graded beside a quarterback. 1v1 only (VERSUS.md 6);
// nothing in single player reads this file.
//
//   node tools/data/build-versus-pool.mjs            1999 to last season
//   node tools/data/build-versus-pool.mjs 2015 2025  a narrower run, for checking
//
// Where it comes from, all public nflverse data, the same project the player seasons came from:
//   games.csv             nflverse/nfldata   every game with both scores - the only source of points allowed
//   stats_team_reg_YYYY   nflverse-data      a season's team totals, including the defensive side
//   stats_player_week_YY  nflverse-data      every player's week, for the kicker each team actually used
//
// About 35 MB is fetched and thrown away; what lands in the repo is roughly 1,700 small rows. Re-run it when a
// season ends, the same way the player data is rebuilt - and read the rating notes below before changing any
// weight, because a defense is drafted against a quarterback and the two have to mean the same thing.
import { writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIRST = Number(process.argv[2] || 1999);
const LAST = Number(process.argv[3] || 2025);
const GAMES = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";
const RELEASE = "https://github.com/nflverse/nflverse-data/releases/download";
const TEAM = (y) => `${RELEASE}/stats_team/stats_team_reg_${y}.csv`;
// The weekly file, not the season one, and gzipped because it is 8 MB a year uncompressed. Why weekly: see
// rateKickers - the season file credits a traded kicker's whole year to the team he ended it on.
const PLAYER = (y) => `${RELEASE}/stats_player/stats_player_week_${y}.csv.gz`;

// nflverse spells a few teams by the name they had at the time; the game speaks one code per franchise, the way
// data/players.json does (game-logic.mjs's TEAMS).
const TEAM_CODE = { OAK: "LV", SD: "LAC", STL: "LA", LAR: "LA", SL: "LA" };
const code = (t) => TEAM_CODE[t] || t;

// One line of CSV, quotes respected. It matters more than it looks: a player row carries a headshot URL like
// "https://.../f_auto,q_auto/league/..." with a comma inside the quotes, so splitting on every comma shifts every
// column after it - which quietly read a kicker's team as "REG" and collapsed a whole season into one row.
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

// ---------- Points allowed, the one number a defense is really judged by ----------
async function pointsAllowed() {
  const games = await csv(GAMES);
  const table = new Map(); // "season|TEAM" -> { games, allowed, scored }
  const add = (season, team, allowed, scored) => {
    const key = `${season}|${code(team)}`;
    const row = table.get(key) || { games: 0, allowed: 0, scored: 0 };
    row.games++;
    row.allowed += allowed;
    row.scored += scored;
    table.set(key, row);
  };
  for (const g of games) {
    const season = num(g.season);
    if (g.game_type !== "REG" || season < FIRST || season > LAST) continue;
    if (g.home_score === "" || g.home_score === undefined) continue; // a season still being played
    add(season, g.home_team, num(g.away_score), num(g.home_score));
    add(season, g.away_team, num(g.home_score), num(g.away_score));
  }
  return table;
}

// ---------- The ratings ----------
// Both scales are built the same way, and the reason is worth keeping: a 2005 defense and a 2021 defense played
// different games. Scoring, passing and sack rates all moved, so a raw "17 points a game" means something
// different in each era. Every measure below is therefore turned into how far a team stood from its own season's
// average (a z-score across that year's teams), and only then mapped onto the players' 0-130 scale. A defense
// drafted from a 2005 board is being compared to 2005, exactly as a quarterback on that board is.
const RATING_MID = 65; // where an average season lands, matching the middle of the players' range
const RATING_PER_SD = 18; // one standard deviation, so a great season lands near 100 and a rare one above 120
const scale = (z) => Math.max(1, Math.min(130, RATING_MID + z * RATING_PER_SD));

function zScores(rows, value) {
  const values = rows.map(value);
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1)) || 1;
  return rows.map((row, i) => (values[i] - mean) / sd);
}

// A defense's parts, and why each is here:
//   points allowed per game  what the job is, and the only part that cannot be padded (negative: fewer is better)
//   takeaways                the swing plays a defense actually creates, interceptions and recovered fumbles
//   sacks                    pressure, the thing that shows up every week rather than in bursts
//   touchdowns and safeties  points the defense scores itself, rare and worth noticing
// The weights lean on points allowed because that is the outcome; the rest are how it was done.
const DEFENSE_WEIGHTS = { allowed: 0.5, takeaways: 0.22, sacks: 0.18, scores: 0.1 };

// The team-seasons nflverse only half has. Its team file says how many games each row covers, and for a few it
// is not the season: JAX 2001 and 2002 are eight weeks of sixteen. Points allowed comes from games.csv and IS
// the full year, so such a row contradicts itself - a whole season's points against beside half a season's
// sacks and takeaways. 2002 JAX came out at 17 sacks, the league minimum that year, and 51.6, 27th of 32;
// whole, it rates about 66 and mid-pack. That is 1.5-2.0 points of match score against a median margin of 4.8.
//
// It is the same upstream damage CLAUDE.md's provenance note says the player pipeline corrects against Pro
// Football Reference, and there is no correction source here - so an incomplete team-season is left out rather
// than shipped as a whole one. The kickers go with it: the weekly file has the same hole, which is why JAX 2002
// offered a three-game fill-in who went 3 for 5. One game short is tolerated, since six rows are and their
// stats are attributed correctly.
function incompleteIn(season, teamRows, allowedTable) {
  const skip = new Set();
  for (const t of teamRows) {
    const team = code(t.team);
    const pa = allowedTable.get(`${season}|${team}`);
    if (!team || !pa) continue;
    const covered = num(t.games);
    if (covered && covered < pa.games - 1) {
      skip.add(team);
      console.log(`  ${season}: dropped ${team} - nflverse covers ${covered} of ${pa.games} games`);
    }
  }
  return skip;
}

function rateDefenses(season, teamRows, allowedTable, skip = new Set()) {
  const rows = teamRows
    .map((t) => ({ team: code(t.team), pa: allowedTable.get(`${season}|${code(t.team)}`), row: t }))
    .filter((r) => {
      // A team that played no games that season is not a team. nflverse carries a blank-coded row in 1999 holding
      // a few plays it could not attribute, and left in it rated as a defense that allowed nothing all year -
      // and, worse, dragged every real team's z-score toward it.
      if (!r.team || !r.pa) {
        console.log(`  ${season}: dropped a row with no games (team ${JSON.stringify(r.team)})`);
        return false;
      }
      return !skip.has(r.team);
    })
    .map(({ team, pa, row: t }) => ({
      season, team, games: pa.games,
      allowedPerGame: pa.allowed / pa.games,
      takeaways: num(t.def_interceptions) + num(t.fumble_recovery_opp),
      sacks: num(t.def_sacks),
      // Touchdowns and safeties only, as the note above says and VERSUS.md 6 says: points the defense put on
      // the board itself. Blocked kicks were in here too, which score nothing and belong to the field-goal and
      // punt block units - about 40% of this component's size, and a straight contradiction of both.
      scores: num(t.def_tds) + num(t.def_safeties),
      ints: num(t.def_interceptions),
      fumbles: num(t.fumble_recovery_opp),
      tds: num(t.def_tds),
      pointsAllowed: pa.allowed,
    }));
  // Fewer points allowed is better, so that z-score is inverted; everything else is more-is-better.
  const parts = {
    allowed: zScores(rows, (r) => -r.allowedPerGame),
    takeaways: zScores(rows, (r) => r.takeaways),
    sacks: zScores(rows, (r) => r.sacks),
    scores: zScores(rows, (r) => r.scores),
  };
  return rows.map((r, i) => ({
    ...r,
    rating: Math.round(scale(Object.entries(DEFENSE_WEIGHTS).reduce((sum, [key, w]) => sum + w * parts[key][i], 0)) * 10) / 10,
  }));
}

// A kicker's parts: how often he made them, how far he made them from, and how much he was asked to do. Distance
// carries the most weight because a 50-yarder is a different job from a 25-yarder, and volume is there so a
// perfect 12-for-12 season does not outrank a 33-for-38 one.
const KICK_WEIGHTS = { accuracy: 0.4, distance: 0.38, volume: 0.22 };
// Phantom attempts at the league's rate, mixed into every kicker's percentage. Without them a fill-in who went
// 3 for 3 in December is the most accurate kicker of the year; with them he is the league's average kicker with
// a little evidence, which is all three kicks are worth.
const ACCURACY_SHRINK = 10;

function rateKickers(season, weekRows, skip = new Set()) {
  // Counted week by week, because a kicker belongs to the team he kicked for. The season file holds only the team
  // he *ended* on and credits it with the whole year: Riley Patterson's 2023 was fourteen games in Detroit and
  // three in Cleveland, filed entirely under Cleveland, which left Detroit with a four-kick fill-in.
  const tally = new Map(); // "<player>|TEAM" -> his season with that team
  for (const w of weekRows) {
    if (w.position !== "K" || (w.season_type && w.season_type !== "REG")) continue;
    const team = code(w.team);
    // Same hole as the defenses: half a season of weeks makes a fill-in look like the team's kicker.
    if (!team || team === "NA" || skip.has(team)) continue;
    const key = `${w.player_id || w.player_name}|${team}`;
    const t = tally.get(key) || {
      team, name: w.player_display_name || w.player_name,
      att: 0, made: 0, from40: 0, from50: 0, long: 0, xpMade: 0, xpAtt: 0, weeks: 0,
    };
    t.att += num(w.fg_att);
    t.made += num(w.fg_made);
    t.from40 += num(w.fg_made_40_49);
    t.from50 += num(w.fg_made_50_59) + num(w.fg_made_60_);
    t.long = Math.max(t.long, num(w.fg_long));
    t.xpMade += num(w.pat_made);
    t.xpAtt += num(w.pat_att);
    t.weeks++;
    tally.set(key, t);
  }
  // One per team: whoever kicked most for them, which is the one a fan remembers. No minimum - every team-season
  // has to offer a kicker on its board, and a year split between two fill-ins should rate like a year split
  // between two fill-ins rather than vanish.
  const best = new Map();
  for (const t of tally.values()) {
    const held = best.get(t.team);
    if (!held || t.att > held.att || (t.att === held.att && t.xpMade > held.xpMade)) best.set(t.team, t);
  }
  const rows = [...best.values()];
  const totalAtt = rows.reduce((a, r) => a + r.att, 0);
  const leagueRate = totalAtt ? rows.reduce((a, r) => a + r.made, 0) / totalAtt : 0.8;
  for (const r of rows) {
    r.season = season;
    r.pct = (r.made + ACCURACY_SHRINK * leagueRate) / (r.att + ACCURACY_SHRINK);
    // Long field goals are the difference between kickers; a 50+ counts double a 40-49.
    r.distance = r.from50 * 2 + r.from40;
  }
  const parts = {
    accuracy: zScores(rows, (r) => r.pct),
    distance: zScores(rows, (r) => r.distance),
    volume: zScores(rows, (r) => r.made),
  };
  return rows.map((r, i) => ({
    ...r,
    rating: Math.round(scale(Object.entries(KICK_WEIGHTS).reduce((sum, [key, w]) => sum + w * parts[key][i], 0)) * 10) / 10,
  }));
}

// ---------- Run ----------
const allowed = await pointsAllowed();
console.log(`points allowed: ${allowed.size} team-seasons from games.csv`);

const defenses = [];
const kickers = [];
for (let season = FIRST; season <= LAST; season++) {
  let teamRows;
  try {
    teamRows = await csv(TEAM(season));
  } catch (e) {
    console.log(`${season}: no team stats yet (${e.message.slice(0, 40)}) - stopping here`);
    break;
  }
  const regular = teamRows.filter((t) => t.season_type === "REG" || !t.season_type);
  // A season that hasn't been played yet is not a season. The only guard used to be the 404 on the team file,
  // and nflverse publishes that file from week one - stats_team_reg_2026.csv already exists with two games in
  // it - so re-running this would have quietly emitted 32 fully-rated 2026 defenses and kickers off a fortnight.
  const slate = Math.max(0, ...regular.map((t) => allowed.get(`${season}|${code(t.team)}`)?.games || 0));
  if (slate < 16) {
    console.log(`${season}: only ${slate} games played - not a finished season, stopping here`);
    break;
  }
  // Worked out once and applied to both sides, so a team nflverse only half has is missing its defense AND its
  // kicker rather than one of the two - tests/test-versus-pool.mjs holds the two lists to each other.
  const skip = incompleteIn(season, regular, allowed);
  const rated = rateDefenses(season, regular, allowed, skip);
  defenses.push(...rated);
  let weekRows = [];
  try {
    weekRows = await csv(PLAYER(season));
  } catch (e) {
    console.log(`${season}: no player weeks (${e.message.slice(0, 40)})`);
  }
  const kicks = rateKickers(season, weekRows, skip);
  kickers.push(...kicks);
  const top = [...rated].sort((a, b) => b.rating - a.rating)[0];
  const boot = [...kicks].sort((a, b) => b.rating - a.rating)[0];
  console.log(`${season}: ${rated.length} defenses (best ${top?.team} ${top?.rating}), ${kicks.length} kickers (best ${boot?.name} ${boot?.rating})`);
}

// The file the game reads. Rows are arrays rather than objects, with the column names given once at the top:
// this file is bundled into the page every visitor loads, including the ones who never play 1v1, and repeating
// eight key names 1,722 times costs about 80 KB of that for nothing. versus-logic.mjs's initVersusData expands
// them by `columns`, so the shape stays self-describing rather than positional-by-convention.
//
// Sorted by team then season, so a diff between two runs is readable.
const byTeamSeason = (a, b) => (a.team === b.team ? a.season - b.season : a.team < b.team ? -1 : 1);
const DEFENSE_COLUMNS = ["season", "team", "rating", "pa", "ints", "fum", "sacks", "tds"];
const KICKER_COLUMNS = ["season", "team", "name", "rating", "made", "att", "long", "from50", "xp"];
const row = (columns, o) => columns.map((c) => o[c]);
const out = {
  built: new Date().toISOString().slice(0, 10),
  source: "nflverse: nfldata/games.csv, nflverse-data stats_team_reg, stats_player_week",
  columns: { defenses: DEFENSE_COLUMNS, kickers: KICKER_COLUMNS },
  defenses: defenses.sort(byTeamSeason).map((d) => row(DEFENSE_COLUMNS, {
    season: d.season, team: d.team, rating: d.rating,
    pa: Math.round((d.pointsAllowed / d.games) * 10) / 10, ints: d.ints, fum: d.fumbles, sacks: Math.round(d.sacks), tds: d.tds,
  })),
  kickers: kickers.sort(byTeamSeason).map((k) => row(KICKER_COLUMNS, {
    season: k.season, team: k.team, name: k.name, rating: k.rating,
    made: k.made, att: k.att, long: k.long, from50: k.from50, xp: k.xpMade,
  })),
};
mkdirSync(path.join(root, "data"), { recursive: true });
const file = path.join(root, "data/versus-pool.json");
writeFileSync(file, `${JSON.stringify(out)}\n`);
console.log(`\nwrote data/versus-pool.json: ${out.defenses.length} defenses, ${out.kickers.length} kickers, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`);
