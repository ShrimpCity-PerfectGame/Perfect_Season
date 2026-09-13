import { useState, useEffect, useMemo, useRef } from "react";
import {
  sget, sset, sdel, clearDraft,
  fetchLeaderboardTop, fetchOwnRank, fetchSiteTotals, fetchDailyTop, fetchSouTop, upsertSouRun, fetchStatsProfiles, subscribeSiteActivity,
  logBuild, fetchTopBuilds, fetchBuildCount,
  authSignUp, authSignIn, authSignOut, authGetSession, authOnChange, mapAuthError,
  fetchProfile, submitRun, submitDnf,
} from "./storage.js";
import gameData from "./data/players.json";
import {
  POS, WINDOWS, SLOTS, QB_WEIGHT, FLEX_POS, TEAMS, BOARDS, OPPS, PLAYOFF_OPPS, initGameData,
  hashStr, mulberry32, withSeed, fits, pick, boardHasOption, seededSequence, boardAt, rerollCandidate,
  flexRating, effectiveRating, winProb, shuffle, windowedShuffle, tagOpp, buildTimeline, simulateSeason,
  applyDnf, LOSER_PTS, MARGINS, nextStreak, GM_CAP, playerSalary, REROLL_BUDGET,
  passerRating, normFormat, BEST_FIELDS, FORMATS,
} from "./game-logic.mjs";
initGameData(gameData.players, gameData.opponents);

const POS_NAME = { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends" };
const SLOT_LABEL = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FLEX1: "Flex", FLEX2: "Flex" };
// Stats O/U: the one headline counting stat each position gets quizzed on.
const SOU_STAT = {
  QB: ["py", "passing yards"],
  RB: ["ry", "rushing yards"],
  WR: ["rcy", "receiving yards"],
  TE: ["rcy", "receiving yards"],
};
// Build-a-player: roll a real player at the assigned position, take exactly one of these raw
// stats from him, repeat until every category is filled, then the assembled player fills that
// position's slot for a normal draft. Only raw counting stats (not derived ones like yds/carry
// or QB rating) are pickable, since those can't be assembled piecemeal.
// Build-a-player attributes: each is [key, label, category, calc(player) -> a number on the
// same rough scale as `rating` (see grade() below)]. No real scouting data (arm strength,
// blocking grades, etc.) exists in this dataset, so every formula is a deliberate proxy built
// only from the counting stats each player actually has - a flavorful approximation, not a
// scientific one. Kept separate per position since the same real box score means something
// different for a passer than a receiver.
const clamp = (x, lo = 0, hi = 140) => Math.max(lo, Math.min(hi, x));
// Maps a raw stat value onto the same numeric scale grade() reads (40=D floor, 120=A+ anchor,
// clamped 0-140) given a rough [replacement-level, elite] range for that specific metric - so
// every attribute lands on a comparable scale by construction, no matter how different the
// underlying stat's natural units/range are (a completion% and a raw yardage total would
// otherwise produce wildly mismatched numbers). lo > hi is fine and just inverts the slope,
// for metrics where less is better (fumbles, interceptions).
const scaleStat = (v, lo, hi) => clamp(40 + ((v - lo) / (hi - lo)) * 80);
const BAP_ATTRS = {
  QB: [
    ["build", "Build", "Physical", (p) => scaleStat(p.g, 6, 17)],
    ["arm", "Arm Strength", "Physical", (p) => scaleStat(p.att ? p.py / p.att : 0, 6, 8.3)],
    ["legs", "Legs", "Physical", (p) => scaleStat(p.ry + p.rtd * 40, 0, 650)],
    ["leadership", "Leadership", "Mental", (p) => scaleStat(p.ptd - p.int, -5, 28)],
    ["vision", "Vision", "Mental", (p) => scaleStat(p.py / p.g, 150, 290)],
    ["processing", "Processing", "Mental", (p) => scaleStat(p.att ? 1 - p.int / p.att : 0.97, 0.955, 0.99)],
    ["accuracy", "Accuracy", "Skill", (p) => scaleStat(p.att ? p.cmp / p.att : 0, 0.58, 0.72)],
    ["playmaking", "Playmaking", "Skill", (p) => scaleStat((p.ptd + p.rtd) / p.g, 0.9, 2.3)],
    ["pocket", "Pocket Presence", "Skill", (p) => scaleStat(passerRating(p), 75, 125)],
  ],
  RB: [
    ["build", "Build", "Physical", (p) => scaleStat(p.car / p.g, 8, 20)],
    ["speed", "Speed", "Physical", (p) => scaleStat(p.car ? p.ry / p.car : 0, 3.6, 5.4)],
    ["power", "Power", "Physical", (p) => scaleStat(p.rtd, 1, 14)],
    ["vision", "Vision", "Mental", (p) => scaleStat(p.ry / p.g, 35, 95)],
    ["patience", "Patience", "Mental", (p) => scaleStat((p.car ? p.ry / p.car : 0) - p.fl * 0.3, 3.3, 5.3)],
    ["discipline", "Discipline", "Mental", (p) => scaleStat(p.fl, 4, 0)],
    ["elusiveness", "Elusiveness", "Skill", (p) => scaleStat((p.ry + p.rcy) / Math.max(1, p.car + p.rec), 3.7, 6.2)],
    ["receiving", "Receiving", "Skill", (p) => scaleStat(p.rec, 15, 70)],
    ["playmaking", "Playmaking", "Skill", (p) => scaleStat(p.rtd + p.rctd, 2, 18)],
  ],
  WR: [
    ["build", "Build", "Physical", (p) => scaleStat(p.g, 8, 17)],
    ["speed", "Speed", "Physical", (p) => scaleStat(p.rec ? p.rcy / p.rec : 0, 9.5, 16)],
    ["hands", "Hands", "Physical", (p) => scaleStat(p.rec / p.g, 2, 7)],
    ["routeiq", "Route IQ", "Mental", (p) => scaleStat(p.rcy / p.g, 30, 95)],
    ["awareness", "Field Awareness", "Mental", (p) => scaleStat(p.rctd / Math.max(1, p.rec), 0.03, 0.15)],
    ["discipline", "Discipline", "Mental", (p) => scaleStat(p.fl, 3, 0)],
    ["routerun", "Route Running", "Skill", (p) => scaleStat(p.rec, 25, 105)],
    ["separation", "Separation", "Skill", (p) => scaleStat(p.rcy, 450, 1400)],
    ["playmaking", "Playmaking", "Skill", (p) => scaleStat(p.rctd + p.rtd, 1, 14)],
  ],
  TE: [
    ["build", "Build", "Physical", (p) => scaleStat(p.g, 8, 17)],
    // No blocking data exists in this dataset - games played (staying on the field) is the
    // closest available proxy, a deliberately weak one.
    ["blocking", "Blocking", "Physical", (p) => scaleStat(p.g, 8, 17)],
    ["hands", "Hands", "Physical", (p) => scaleStat(p.rec / p.g, 1.5, 5.5)],
    ["routeiq", "Route IQ", "Mental", (p) => scaleStat(p.rcy / p.g, 20, 70)],
    ["awareness", "Field Awareness", "Mental", (p) => scaleStat(p.rctd / Math.max(1, p.rec), 0.05, 0.22)],
    ["discipline", "Discipline", "Mental", (p) => scaleStat(p.fl, 3, 0)],
    ["routerun", "Route Running", "Skill", (p) => scaleStat(p.rec, 20, 90)],
    ["redzone", "Red Zone Threat", "Skill", (p) => scaleStat(p.rctd, 1, 10)],
    ["playmaking", "Playmaking", "Skill", (p) => scaleStat(p.rctd + p.rtd, 1, 11)],
  ],
};
const BAP_CATS = ["Physical", "Mental", "Skill"];

const teamVars = (code) => ({ "--tc1": TEAMS[code][2], "--tc2": TEAMS[code][3] });
const gradeTier = (r) => (r >= 95 ? "ga" : r >= 80 ? "gb" : r >= 56 ? "gc" : "gd");
const TEAM_CODES = Object.keys(TEAMS);

function cityFor(code, year) {
  if (code === "LA") return year <= 2015 ? "St. Louis" : "Los Angeles";
  if (code === "LAC") return year <= 2016 ? "San Diego" : "Los Angeles";
  if (code === "LV") return year <= 2019 ? "Oakland" : "Las Vegas";
  return TEAMS[code][1];
}
function cityRange(code, w) {
  const [a, b] = WINDOWS[w];
  const c1 = cityFor(code, a), c2 = cityFor(code, b);
  return c1 === c2 ? c1 : `${c1} & ${c2}`;
}
function teamLabel(code, year) {
  const c = cityFor(code, year);
  return c ? `${c} ${TEAMS[code][0]}` : TEAMS[code][0];
}

// Every player id that actually appears on a board, for Stats O/U's random pick - the id->name
// lookup in data/players.json may include ids that never qualified for any board, so sampling
// from it directly risks never landing on a usable one.
const SOU_PLAYER_IDS = [...new Set(Object.values(BOARDS).flat().map((p) => p.id))];
const SOU_LIVES = 3;
const SOU_ROUND_SECONDS = 7;
// Stats O/U is a daily leaderboard, not open-ended practice: everyone gets the same seeded
// sequence of rounds that day (seed "sou-<date>"), one round per index, deterministic - same
// pattern as the roster daily's seededSequence. "Career" here means the sum of a player's
// appearances across every board he qualified for (at most one season per team per era window) -
// a real but partial slice of his career, not his true full stat line.
function souRoundFor(seed, n) {
  const rng = mulberry32(hashStr(`${seed}-${n}`));
  const id = SOU_PLAYER_IDS[Math.floor(rng() * SOU_PLAYER_IDS.length)];
  const appearances = [];
  for (const key of Object.keys(BOARDS)) {
    for (const p of BOARDS[key]) if (p.id === id) appearances.push(p);
  }
  const [statKey, statLabel] = SOU_STAT[appearances[0].pos];
  const trueValue = appearances.reduce((sum, p) => sum + (p[statKey] || 0), 0);
  let line = Math.round((trueValue * (0.8 + rng() * 0.4)) / 25) * 25;
  if (line === trueValue) line += 25;
  const teams = [...new Set(appearances.map((p) => TEAMS[p.team][0]))];
  return { name: appearances[0].name, pos: appearances[0].pos, teams, statLabel, trueValue, line };
}

// Build-a-player rolls only from last season, not any era - the most recent real year the data
// covers. Boards only keep a player's single best season within each 5-year window, so this is
// necessarily a partial slice of the real league that year (a player whose best 2021-2025 season
// was actually 2022 won't show up here even though he also played last season) - the same
// "partial, not the whole picture" caveat Stats O/U already makes about its own "career" numbers.
const LAST_SEASON = Math.max(...Object.values(BOARDS).flat().map((p) => p.season));
const bapPoolCache = {};
function bapPool(pos) {
  if (!bapPoolCache[pos]) {
    bapPoolCache[pos] = Object.values(BOARDS).flat().filter((p) => p.pos === pos && p.season === LAST_SEASON);
  }
  return bapPoolCache[pos];
}
// Every distinct player who's ever appeared at this position for this team, any era - cosmetic
// only (the roll animation's flicker, so a "Texans QB" spin has more than one real name to
// cycle through even when last season alone only has a single qualifying entry for them). The
// actual result is still decided by bapPool/rollBapPair, which stay last-season-only.
function teamPosPlayers(team, pos) {
  const seen = new Set();
  const out = [];
  for (let w = 0; w < WINDOWS.length; w++) {
    for (const p of BOARDS[`${team}|${w}`] || []) {
      if (p.pos === pos && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    }
  }
  return out;
}

// ---------- GM mode (salary cap) ----------
const newCode = () => Math.floor(Math.random() * 36 ** 6).toString(36).toUpperCase().padStart(6, "0");
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const prettyDate = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric" });
};

// Every player at a position shows the same stat columns, in the same order.
// Same shape at every position: main-role yards, TDs, per-attempt average, then volume,
// then the secondary role, then fumbles.
function statCells(p) {
  const n = (v) => v.toLocaleString();
  const ypc = p.car ? (p.ry / p.car).toFixed(1) : "–";
  const ypr = p.rec ? (p.rcy / p.rec).toFixed(1) : "–";
  if (p.pos === "QB") return [
    [n(p.py), "Pass yds"], [p.ptd, "Pass TD"], [p.int, "INT"],
    [p.att ? ((100 * p.cmp) / p.att).toFixed(1) + "%" : "–", "Comp %"], [p.att ? passerRating(p).toFixed(1) : "–", "QB rating"],
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"],
  ];
  if (p.pos === "TE") return [
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [ypr, "Yds/rec"], [p.rec, "Rec"], [p.fl, "Fum lost"],
  ];
  if (p.pos === "WR") return [
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [ypr, "Yds/rec"], [p.rec, "Rec"],
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"], [p.fl, "Fum lost"],
  ];
  return [
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"], [ypc, "Yds/carry"], [p.rec, "Rec"],
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [p.fl, "Fum lost"],
  ];
}

function grade(r) {
  const t = [[120, "A+"], [105, "A"], [95, "A−"], [88, "B+"], [80, "B"], [72, "B−"], [64, "C+"], [56, "C"], [48, "C−"], [40, "D"]];
  for (const [v, g] of t) if (r >= v) return g;
  return "F";
}
const bapOverallScore = (filled) => {
  const scores = Object.values(filled).map((f) => f.score);
  return scores.reduce((a, b) => a + b, 0) / scores.length;
};


// ---------- Admin testing tools ----------
// Same scoring shape as gameResult, but the win/loss is dictated rather than rolled - lets the
// admin panel jump straight to a specific season outcome to check its ending animation/banner.
function forcedGameResult(win) {
  const lo = pick(LOSER_PTS);
  let m = pick(MARGINS);
  if (lo === 0 && m < 3) m = 3;
  return win ? { win, us: lo + m, them: lo } : { win, us: lo, them: lo + m };
}
const FORCED_SCENARIOS = {
  perfect: { regWins: 17, rounds: ["Divisional", "Conference", "Championship"], loseRound: null },
  champ: { regWins: 15, rounds: ["Wild Card", "Divisional", "Conference", "Championship"], loseRound: null },
  lostWildCard: { regWins: 10, rounds: ["Wild Card", "Divisional", "Conference", "Championship"], loseRound: 0 },
  lostDivisional: { regWins: 13, rounds: ["Divisional", "Conference", "Championship"], loseRound: 0 },
  lostConference: { regWins: 13, rounds: ["Divisional", "Conference", "Championship"], loseRound: 1 },
  lostChampionship: { regWins: 13, rounds: ["Divisional", "Conference", "Championship"], loseRound: 2 },
  missedPlayoffs: { regWins: 7, rounds: [], loseRound: null },
};
function forceSeason(scenarioKey) {
  const cfg = FORCED_SCENARIOS[scenarioKey];
  const games = [];
  const regOpps = shuffle(OPPS).slice(0, 17);
  let w = 0, l = 0;
  regOpps.forEach((o, i) => {
    const win = i < cfg.regWins;
    const g = tagOpp(forcedGameResult(win), o);
    g.label = `Wk ${i + 1}`;
    g.home = Math.random() < 0.5;
    games.push(g);
    win ? w++ : l++;
  });
  let outcome;
  if (!cfg.rounds.length) {
    outcome = "Missed the playoffs";
  } else {
    const poOpps = shuffle(PLAYOFF_OPPS).slice(0, cfg.rounds.length);
    outcome = null;
    for (let i = 0; i < cfg.rounds.length; i++) {
      const win = cfg.loseRound === null || i < cfg.loseRound;
      const g = tagOpp(forcedGameResult(win), poOpps[i]);
      g.label = cfg.rounds[i];
      g.playoff = true;
      g.plays = buildTimeline(g.us, g.them, g.win);
      games.push(g);
      if (win) w++;
      else { l++; outcome = `Lost to the ${g.opp} in the ${cfg.rounds[i].toLowerCase()} round`; break; }
    }
    if (!outcome) outcome = w === 20 ? "Perfect season. 20–0." : `Won the championship after a ${w - cfg.rounds.length}–${l} regular season`;
  }
  const playoffs = games.some((g) => g.playoff);
  const champ = playoffs && games[games.length - 1].label === "Championship" && games[games.length - 1].win;
  return { games, w, l, outcome, playoffs, champ, perfect: w === 20 && l === 0 };
}
// Case-insensitive substring search for the admin "force a player" tool, across every board.
function adminSearchPlayers(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const results = [];
  for (const key of Object.keys(BOARDS)) {
    for (const p of BOARDS[key]) {
      if (p.name.toLowerCase().includes(q)) {
        results.push(p);
        if (results.length >= 8) return results;
      }
    }
  }
  return results;
}

// ---------- Playoff game script ----------
// A game is a list of drives. Positions are yards from the possessing team's own goal line (0-100).
// Scoring drives end exactly at their scoring play's time; everything else is filled with punts.
const rnd = (a, b) => a + Math.random() * (b - a);
const other = (team) => (team === "us" ? "them" : "us");
function buildDrives(plays) {
  const drives = [];
  let t = 0, poss = Math.random() < 0.5 ? "us" : "them", start = 25;
  const filler = (until) => {
    while (until - t > 3.5) {
      const len = Math.min(until - t - 1.5, rnd(4, 7.5));
      const end = Math.round(Math.min(68, start + rnd(6, 38)));
      const landing = end + rnd(36, 48); // punt lands here, in the punting team's yards
      drives.push({ team: poss, t0: t, t1: t + len, y0: start, y1: end, landing });
      t += len;
      start = landing >= 98 ? 20 : Math.max(5, Math.round(100 - landing));
      poss = other(poss);
    }
  };
  for (const p of plays) {
    filler(p.time - 2);
    const team = p.v === 2 ? other(p.team) : p.team; // a safety happens to the team with the ball
    if (poss !== team && p.time - t >= 2.6 && Math.random() < 0.6) {
      // wrong team has the ball and there's time: they go three-and-out and punt
      const end = Math.round(Math.min(45, start + rnd(-3, 8)));
      const landing = end + rnd(38, 46);
      drives.push({ team: poss, t0: t, t1: t + 1.4, y0: start, y1: end, landing });
      t += 1.4;
      start = landing >= 98 ? 20 : Math.max(5, Math.round(100 - landing));
      poss = team;
    }
    if (poss !== team) {
      // still the wrong team: a quick turnover hands it over (often a short field)
      const len = Math.max(0.4, Math.min(1.2, (p.time - t) / 3));
      const y1 = Math.round(Math.min(70, start + rnd(0, 14)));
      drives.push({ team: poss, t0: t, t1: t + len, y0: start, y1, turnover: Math.random() < 0.55 ? "Interception" : "Fumble" });
      t += len;
      start = Math.round(Math.max(15, Math.min(70, 100 - y1 - rnd(0, 12))));
      poss = team;
    }
    if (p.v === 2) start = Math.round(rnd(3, 9));
    const y1 = p.v === 3 ? Math.round(Math.min(85, Math.max(rnd(62, 80), start + rnd(4, 12)))) : p.v === 2 ? 0 : 100; // field goal drives always gain ground
    drives.push({ team, t0: t, t1: p.time, y0: start, y1, play: p });
    t = p.time; start = 25;
    poss = other(p.team); // the team that was scored on receives (after a safety, the scoring team does)
  }
  filler(60);
  if (t < 60) drives.push({ team: poss, t0: t, t1: 60, y0: start, y1: Math.min(70, start + 12) });
  return drives;
}

const lastName = (n) => n.split(" ").slice(1).join(" ") || n;
function weighted(list) {
  let r = Math.random() * list.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of list) if ((r -= w) <= 0) return v;
  return list[0][0];
}
function playText(team, gain, td, cast, opp) {
  const pass = gain < 0 ? Math.random() < 0.6 : gain >= 20 ? Math.random() < 0.8 : Math.random() < 0.55;
  const yds = Math.abs(gain);
  if (team === "them") {
    if (td) return `${opp} ${yds}-yd TD ${pass ? "pass" : "run"}`;
    if (gain < 0) return pass ? `${opp} QB sacked, loss of ${yds}` : `${opp} run stopped for a loss of ${yds}`;
    if (gain === 0) return `${opp} pass incomplete`;
    return `${opp} ${yds}-yd ${pass ? "pass" : "run"}`;
  }
  const qb = cast.qb, runner = weighted(cast.runners), target = weighted(cast.targets);
  if (td) return pass ? `${qb} ${yds}-yd TD pass to ${target}` : `${runner} ${yds}-yd TD run`;
  if (gain < 0) return pass ? `${qb} sacked, loss of ${yds}` : `${runner} stopped for a loss of ${yds}`;
  if (gain === 0) return `${qb} incomplete to ${target}`;
  return pass ? `${qb} ${yds}-yd pass to ${target}` : `${runner} ${yds}-yd run`;
}
function castFrom(roster) {
  const all = Object.entries(roster || {});
  const qb = roster && roster.QB ? lastName(roster.QB.name) : "Your QB";
  const runners = all.filter(([, p]) => p.pos === "RB").map(([s, p]) => [lastName(p.name), s === "RB" ? 3 : 1]);
  const targets = all.filter(([, p]) => p.pos !== "QB").map(([, p]) => [lastName(p.name), p.pos === "WR" ? 3 : p.pos === "TE" ? 2 : 1]);
  return { qb, runners: runners.length ? runners : [["Your RB", 1]], targets: targets.length ? targets : [["your receiver", 1]] };
}
const PLAY_NAME = { 7: "touchdown", 3: "field goal", 8: "touchdown + 2-pt conversion", 6: "touchdown, PAT missed", 2: "safety" };
const QUARTER_BREAKS = [[15, "End of the 1st quarter"], [30, "Halftime"], [45, "End of the 3rd quarter"]];

// Turn drives into a paced list of events. Each event is one moment on screen:
// a big play, a punt, a score, a touchback, or a quarter break. dur is real milliseconds.
function buildScript(game, roster) {
  const cast = castFrom(roster);
  const opp = game.oppShort || game.opp;
  const teamName = (tm) => (tm === "us" ? "Your team" : opp);
  const ballAt = (tm, own) => `${teamName(tm)} ball at ${own < 50 ? (tm === "us" ? "your own " : "their own ") + own : own === 50 ? "midfield" : tm === "us" ? `the ${opp} ${100 - own}` : `your ${100 - own}`}`;
  const drives = buildDrives(game.plays || []);
  const ev = [{ t: 0, team: drives[0] ? drives[0].team : "us", own: 25, from: 25, kind: "reset", text: "Kickoff. Touchback", dur: 700 }];
  let us = 0, them = 0;
  drives.forEach((d, di) => {
    const kind = d.play ? (d.play.v === 3 ? "fg" : d.play.v === 2 ? "safety" : "td") : d.turnover ? "tov" : di === drives.length - 1 ? "end" : "punt";
    const long = d.y1 - d.y0 > 55;
    const n = kind === "td" ? (long ? 3 : 2) + (Math.random() < 0.3 ? 1 : 0) : kind === "fg" ? 2 : 1;
    const yEnd = d.y1;
    const w = Array.from({ length: n }, () => 0.35 + Math.random());
    const tot = w.reduce((a, b) => a + b, 0);
    let cum = 0, at = d.y0;
    const slots = kind === "td" || kind === "safety" ? n : n + 1;
    for (let i = 0; i < n; i++) {
      cum += w[i];
      let yard = i === n - 1 ? yEnd : Math.round(d.y0 + ((yEnd - d.y0) * cum) / tot);
      if (kind === "punt" && Math.random() < 0.15 && i === 0) yard = Math.max(1, at - Math.round(rnd(2, 7))); // occasional loss
      const t = d.t0 + ((d.t1 - d.t0) * (i + 1)) / slots;
      const close = t >= 54 && Math.abs(us - them) <= 8;
      const td = kind === "td" && i === n - 1;
      const text = kind === "safety" ? `${d.team === "us" ? cast.qb : opp + " QB"} tackled in the end zone` : playText(d.team, yard - at, td, cast, opp);
      ev.push({ t, team: d.team, own: yard, from: d.y0, kind: "play", text, dur: close ? 850 : kind === "td" || kind === "fg" ? 470 : 330 });
      at = yard;
    }
    if (d.play) {
      const p = d.play;
      if (p.team === "us") us += p.v; else them += p.v;
      const fgText = `${100 - at + 17}-yd field goal is good`;
      ev.push({ t: d.t1, team: d.team, own: at, from: d.y0, kind: "score", play: p, dur: 1250,
        text: p.v === 3 ? `${teamName(p.team)}: ${fgText}` : p.v === 2 ? `Safety. 2 points for ${teamName(p.team).toLowerCase() === "your team" ? "your team" : opp}` : `${teamName(p.team)} ${PLAY_NAME[p.v]}`,
        flash: p.team === "us" ? `${PLAY_NAME[p.v][0].toUpperCase()}${PLAY_NAME[p.v].slice(1)}!` : `${opp} ${PLAY_NAME[p.v]}` });
      const next = drives[di + 1];
      if (next) ev.push({ t: d.t1, team: next.team, own: next.y0, from: next.y0, kind: "reset", text: `Kickoff. ${ballAt(next.team, next.y0)}`, dur: 380 });
    } else if (kind === "punt") {
      const next = drives[di + 1];
      if (next) ev.push({ t: d.t1, team: next.team, own: next.y0, from: next.y0, kind: "punt",
        text: `${teamName(d.team)} punts.${d.landing >= 98 ? " Touchback." : ""} ${ballAt(next.team, next.y0)}`, dur: 520 });
    } else if (kind === "tov") {
      const next = drives[di + 1];
      if (next) ev.push({ t: d.t1, team: next.team, own: next.y0, from: next.y0, kind: "turnover", dur: 1100,
        text: `${d.turnover}! ${ballAt(next.team, next.y0)}`,
        flash: next.team === "us" ? `${d.turnover}!` : `${opp} ${d.turnover.toLowerCase()}`, mine: next.team === "us" });
    }
  });
  // quarter breaks go in front of the first event past each break
  const out = [];
  let bi = 0;
  for (const e of ev) {
    while (bi < QUARTER_BREAKS.length && e.t > QUARTER_BREAKS[bi][0]) {
      const prev = out[out.length - 1];
      out.push({ ...prev, t: QUARTER_BREAKS[bi][0], kind: "break", flash: QUARTER_BREAKS[bi][1], text: prev.text, dur: 750, mine: false });
      bi++;
    }
    out.push(e);
  }
  // keep every game around 25-30 seconds: squeeze the in-between plays first, then the banners
  const TARGET = 24000;
  const isBanner = (x) => x.kind === "score" || x.kind === "turnover" || x.kind === "break";
  const bannerMs = out.filter(isBanner).reduce((a, x) => a + x.dur, 0);
  const moveMs = out.filter((x) => !isBanner(x)).reduce((a, x) => a + x.dur, 0);
  if (bannerMs + moveMs > TARGET) {
    const f = Math.max(0.5, (TARGET - bannerMs) / moveMs);
    out.forEach((x) => { if (!isBanner(x)) x.dur = Math.round(x.dur * f); });
    const left = TARGET - out.filter((x) => !isBanner(x)).reduce((a, x) => a + x.dur, 0);
    if (bannerMs > left) out.forEach((x) => { if (isBanner(x)) x.dur = Math.max(850, Math.round((x.dur * left) / bannerMs)); });
  }
  // never rush a moment: the ball needs time to land before the next one
  const MIN = { play: 370, punt: 680, reset: 420 };
  out.forEach((x) => { if (MIN[x.kind]) x.dur = Math.max(MIN[x.kind], x.dur); });
  return out;
}

function clockLabel(t) {
  if (t >= 60) return ["Final", ""];
  const q = Math.min(4, Math.floor(t / 15) + 1);
  const rem = Math.max(0, 15 - (t - (q - 1) * 15));
  let m = Math.floor(rem), s = Math.round((rem - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return [`Q${q}`, `${m}:${String(s).padStart(2, "0")}`];
}

function PlayoffGame({ game, roster, instant, onFinal, footer }) {
  const script = useMemo(() => buildScript(game, roster), [game]);
  const [i, setI] = useState(instant ? script.length : 0);
  const reported = useRef(false);
  const done = i >= script.length;
  const e = done ? script[script.length - 1] : script[i];

  useEffect(() => {
    if (done && !reported.current) { reported.current = true; onFinal(); }
  }, [done]);
  useEffect(() => {
    if (done) return;
    const id = setTimeout(() => setI((x) => x + 1), script[i].dur);
    return () => clearTimeout(id);
  }, [i, done]);

  const shownEvents = done ? script : script.slice(0, i + 1);
  const scores = shownEvents.filter((x) => x.kind === "score");
  const us = done ? game.us : scores.filter((x) => x.play.team === "us").reduce((a, x) => a + x.play.v, 0);
  const them = done ? game.them : scores.filter((x) => x.play.team === "them").reduce((a, x) => a + x.play.v, 0);
  const t = done ? 60 : e.t;
  const [q, clk] = clockLabel(t);
  const toScreen = (team, own) => (team === "us" ? own : 100 - own);
  const ball = toScreen(e.team, e.own);
  const from = toScreen(e.team, e.from);
  const segment = shownEvents.filter((x) => x.kind === "reset" || x.kind === "turnover").length; // new ball after kickoffs and turnovers, no sliding
  const flash = !done && (e.kind === "score" || e.kind === "break" || e.kind === "turnover") ? e.flash : null;
  const flashMine = e.kind === "score" ? e.play.team === "us" : !!e.mine;
  const own = e.own;
  const yd = (v) => Math.max(1, Math.round(v));
  const spot = own < 49.5 ? `own ${yd(own)}` : own <= 50.5 ? "midfield" : e.team === "us" ? `${game.oppShort || game.opp} ${yd(100 - own)}` : `your ${yd(100 - own)}`;
  const redZone = own >= 80 && own < 100;
  const log = scores.slice(-3).reverse();
  const showTrail = !done && e.kind === "play";

  return (
    <div className="pg" aria-live="polite">
      <div className="pg-top"><span>{game.label} round vs {game.opp} ({game.oppRec})</span><span>{done ? (game.win ? "You advance" : "Season over") : "Live"}</span></div>
      <div className="sb">
        <div className={`side ${us > them ? "lead" : ""}`}><div className="tm">Your team</div><div className="pts led-wrap"><span className="led">{us}</span></div></div>
        <div className="clock">{q}<small>{clk}</small></div>
        <div className={`side r ${them > us ? "lead" : ""}`}><div className="tm">{game.oppShort || game.opp}</div><div className="pts led-wrap"><span className="led">{them}</span></div></div>
      </div>
      <div className="field" aria-hidden="true">
        <div className="ez l" style={game.oppTeam ? { background: TEAMS[game.oppTeam][2], color: "rgba(255,255,255,.8)" } : undefined}>{game.oppShort || game.opp}</div>
        <div className="yards"><span className="fifty">50</span>
          {showTrail && <span className={`trail ${e.team === "us" ? "mine" : ""}`} style={{ left: `${Math.min(from, ball)}%`, width: `${Math.abs(ball - from)}%` }} />}
          {!done && <span key={segment} className={`ball ${e.team === "us" ? "mine" : ""} ${e.kind === "punt" ? "air" : ""}`} style={{ left: `${Math.max(0, Math.min(100, ball))}%` }} />}
        </div>
        <div className="ez r">You</div>
        {flash && <div className={`flash ${flashMine ? "mine" : ""}`}>{flash}</div>}
      </div>
      {!done && (
        <div className="pbp">
          <div className="now">{e.text}</div>
          {e.kind === "play" && <div className={`spot ${redZone ? "rz" : ""}`}>{e.team === "us" ? "Your ball" : `${game.oppShort || game.opp} ball`}, {spot}{redZone ? ". Red zone" : ""}</div>}
        </div>
      )}
      <div className="plog">
        {log.length === 0 ? <span>No score yet.</span> : log.map((x, k) => {
          const [pq, pc] = clockLabel(x.t);
          return <div key={k}>{pq} {pc} {x.text}</div>;
        })}
      </div>
      {!done && <button className="linkbtn" style={{ marginTop: 8 }} onClick={() => setI(script.length)}>Skip to the final score</button>}
      {done && <div className="pfinal"><div className={`fin ${game.win ? "w" : "l"}`}>{game.win ? "Win" : "Loss"}, {game.us}–{game.them}</div>{footer}</div>}
    </div>
  );
}

// ---------- Styles ----------
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;700;800;900&family=Barlow:wght@400;500;600;700&display=swap');
.ps{--display:'Big Shoulders Display','Barlow Condensed','Arial Narrow',Impact,sans-serif;--bg:#14211B;--surface:#1B2B23;--surface2:#22362C;--line:#2C4337;--line2:#3A5546;--ink:#E9F0EB;--muted:#93A89B;--lamp:#F5B324;--board:#0E1713;--win:#6FD49B;--loss:#F07B6B;--lampsoft:rgba(245,179,36,.13);
  font-family:'Barlow',system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;font-variant-numeric:tabular-nums;}
.ps *{box-sizing:border-box}
.ps button{font-family:inherit;cursor:pointer}
.ps button:focus-visible{outline:3px solid var(--lamp);outline-offset:2px}
.wrap{max-width:880px;margin:0 auto;padding:20px 16px 48px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}
.title{font-family:var(--display);font-weight:900;font-size:44px;line-height:.9;letter-spacing:-.5px;margin:0;color:var(--ink)}
.sub{margin:6px 0 0;color:var(--muted);font-size:15px;max-width:46ch}
.best{text-align:right;font-size:13px;color:var(--muted);white-space:nowrap}
.best b{display:block;font-family:var(--display);font-weight:800;font-size:26px;color:var(--ink)}
.roster{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:12px}
.slot{border:1.5px dashed var(--line2);border-radius:8px;padding:7px 9px;min-height:58px;background:transparent;text-align:left;color:var(--ink)}
.slot .k{font-weight:700;font-size:12px;color:var(--muted)}
.slot .v{font-weight:600;font-size:14px;line-height:1.15;margin-top:3px}
.slot.filled{border:1.5px solid transparent;background:var(--surface)}
.slot.filled .k{color:var(--lamp)}
.slot.target{border:2px solid var(--lamp);background:var(--lampsoft)}
.reel{position:relative;background:var(--board);color:var(--ink);border-radius:12px;padding:18px 20px 16px 26px;overflow:hidden;margin-bottom:10px}
.reel::before,.result-hero::before,.champion::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1.4px);background-size:6px 6px;pointer-events:none}
.stripe{position:absolute;left:0;top:0;bottom:0;width:8px;box-shadow:inset -1px 0 0 rgba(255,255,255,.12)}
.reel .pickno{font-size:13px;color:var(--muted);display:flex;justify-content:space-between}
.reel .team{font-family:var(--display);font-weight:900;font-size:clamp(46px,11vw,76px);line-height:.95;color:var(--lamp);text-shadow:0 0 18px rgba(245,179,36,.35);margin:6px 0 2px}
.reel .years{font-family:var(--display);font-weight:700;font-size:28px}
.reel .city{font-size:14px;color:var(--muted);margin-left:10px}
.reel.spin .team,.reel.spin .years{opacity:.75;filter:blur(.4px)}
.rerolls{display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap}
.btn{border:1px solid #4A515F;background:linear-gradient(180deg,#333845,#242832);color:var(--ink);border-radius:9px;padding:9px 14px;font-weight:600;font-size:14px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.14),inset 0 -2px 0 rgba(0,0,0,.45),0 2px 4px rgba(0,0,0,.4);transition:transform .06s,box-shadow .06s,filter .12s}
.btn:hover:not(:disabled){filter:brightness(1.14)}
.btn:active:not(:disabled){transform:translateY(2px);box-shadow:inset 0 2px 5px rgba(0,0,0,.55),0 0 0 rgba(0,0,0,0)}
.btn:disabled{opacity:.42;cursor:default;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.btn.solid{border-color:#C98A0E;color:#241704}
.btn.sm{padding:5px 9px;font-size:13px}
.sec{margin:0 0 20px}
.sec .hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 8px;flex-wrap:wrap}
.sec h3{font-family:var(--display);font-weight:800;font-size:22px;margin:0;color:var(--ink)}
.sec .nt{font-size:13px;color:var(--muted)}
.sec.done h3{color:var(--muted)}
.card{background:var(--surface);border:1.5px solid transparent;border-radius:10px;padding:10px 12px;margin-bottom:6px}
.card:hover:not(.off){background:var(--surface2)}
.hit{all:unset;display:block;width:100%;cursor:pointer;color:var(--ink)}
.hit:disabled{cursor:default}
.ps .hit:focus-visible{outline:3px solid var(--lamp);outline-offset:4px;border-radius:4px}
.card.sel{border-color:var(--lamp);background:var(--surface2)}
.card.off{opacity:.4}
.card .row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.card .nm{font-weight:700;font-size:16px}
.card .meta{font-size:13px;color:var(--muted);margin-top:2px}
.cells{display:flex;flex-wrap:wrap;gap:6px 0}
.cell{width:62px}
.cell .n{font-weight:700;font-size:16px;line-height:1.1}
.cell .l{font-size:11px;color:var(--muted)}
.drafts{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
.note{font-size:13px;color:var(--muted);margin-top:8px}
.result-hero{background:var(--board);border-radius:12px;padding:22px 22px 18px;margin-bottom:18px;position:relative;overflow:hidden}
.rec{font-family:var(--display);font-weight:900;font-size:clamp(84px,22vw,140px);line-height:.85;color:var(--lamp);text-shadow:0 0 24px rgba(245,179,36,.35)}
.outcome{font-size:18px;font-weight:600;margin-top:10px}
.rating{font-size:14px;color:var(--muted);margin-top:4px}
.log{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:6px;margin:8px 0 22px}
.g{border-radius:8px;padding:6px 8px;font-size:12px;background:var(--surface);border:1.5px solid transparent;animation:pop .25s ease-out both}
.g .w{font-weight:700;font-size:15px}
.g.win .w{color:var(--win)} .g.loss .w{color:var(--loss)}
.g.po{border-color:var(--line2)}
.g .o{color:var(--muted)}
@keyframes pop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.reveal{border-top:1px solid var(--line)}
.rv{display:grid;grid-template-columns:44px 1fr auto auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}
.rv .s{font-weight:700;font-size:13px;color:var(--lamp)}
.rv .p{font-weight:700}
.rv .t{font-size:13px;color:var(--muted)}
.rv .pts{text-align:right;font-weight:700}
.rv .pts small{display:block;font-weight:400;font-size:11px;color:var(--muted)}
.gr{font-family:var(--display);font-weight:800;font-size:24px;min-width:38px;text-align:right}
h2.h{font-family:var(--display);font-weight:800;font-size:24px;color:var(--ink);margin:0 0 4px}
.nav{display:flex;gap:4px;border-bottom:1.5px solid var(--line);margin-bottom:16px}
.tab{border-radius:8px 8px 0 0}
.tab.on{background:linear-gradient(180deg,rgba(247,179,43,.12),transparent)}
.tab{background:none;border:none;border-bottom:3px solid transparent;margin-bottom:-1.5px;padding:8px 12px;font-weight:600;font-size:15px;color:var(--muted)}
.tab.on{color:var(--ink);border-bottom-color:var(--lamp)}
.tab .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--lamp);margin-left:6px;vertical-align:middle}
.panel{background:var(--surface);border-radius:10px;padding:14px;margin-bottom:16px}
.panel p{margin:0 0 10px;font-size:14px;color:var(--muted);max-width:60ch}
.panel h3{font-family:var(--display);font-weight:800;font-size:22px;color:var(--ink);margin:0 0 4px}
.inp{font:inherit;font-size:15px;padding:8px 10px;border:1.5px solid var(--line2);border-radius:8px;min-width:0;flex:1;max-width:260px;color:var(--ink);background:var(--board)}
.inp:focus{outline:none;border-color:var(--lamp)}
.frow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:18px}
.tile{background:var(--surface);border-radius:10px;padding:12px}
.tile .n{font-family:var(--display);font-weight:800;font-size:32px;line-height:1}
.tile .l{font-size:13px;color:var(--muted);margin-top:4px}
.who{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.who .nm{font-family:var(--display);font-weight:900;font-size:36px;line-height:1}
.linkbtn{background:none;border:none;padding:0;color:var(--lamp);font-weight:600;font-size:14px;text-decoration:underline;text-underline-offset:3px}
.lb{width:100%;border-collapse:collapse;font-size:14px;margin-bottom:18px}
.lb th{text-align:left;font-weight:600;font-size:12px;color:var(--muted);padding:6px 8px;border-bottom:1.5px solid var(--line)}
.lb td{padding:9px 8px;border-bottom:1px solid var(--line)}
.lb td.r,.lb th.r{text-align:right}
.lb tr.me td{background:var(--lampsoft)}
.lb .rk{font-family:var(--display);font-weight:800;font-size:18px;width:32px}
.champion{background:var(--board);border-radius:12px;padding:18px 20px 18px 26px;margin-bottom:18px;position:relative;overflow:hidden}
.champion .sc{font-family:var(--display);font-weight:900;font-size:64px;line-height:.9;color:var(--lamp);text-shadow:0 0 18px rgba(245,179,36,.35)}
.champion .by{font-size:16px;font-weight:600;margin-top:6px}
.champion .ln{font-size:13px;color:var(--muted);margin-top:8px;line-height:1.5}
.champion .pickno{font-size:13px;color:var(--muted)}
.badge{display:inline-block;background:var(--lamp);color:#15201A;font-weight:700;font-size:13px;border-radius:4px;padding:3px 8px;margin-top:10px;margin-right:6px}
.recent{border-top:1px solid var(--line);margin-bottom:18px}
.rr{display:grid;grid-template-columns:70px 64px 1fr auto;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:center}
.rr .rec2{font-family:var(--display);font-weight:800;font-size:20px}
.muted{color:var(--muted)}
.seg{display:inline-flex;border:1.5px solid var(--line2);border-radius:8px;overflow:hidden;margin:4px 0 12px}
.seg button{background:none;border:none;padding:7px 14px;font-weight:600;font-size:14px;color:var(--muted)}
.seg button.on{background:var(--lamp);color:#15201A}
.fields{display:grid;gap:10px;max-width:320px}
.fields label{display:grid;gap:4px;font-size:13px;font-weight:600;color:var(--muted)}
.fields .inp{max-width:none}
.err{color:var(--loss)!important;font-weight:600;margin:10px 0 0!important}
.fine{font-size:12.5px!important;margin:10px 0 0!important}
.guest{font-size:14px;color:var(--muted);margin:0 0 12px}
.sticky{position:fixed;top:0;left:0;right:0;z-index:30;background:rgba(14,23,19,.95);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--line);transform:translateY(-110%);transition:transform .18s ease-out}
.sticky.show{transform:none}
.sticky .in{position:relative;max-width:880px;margin:0 auto;padding:8px 16px 8px 24px;display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap}
.sticky .stripe{width:6px}
.sticky .tm{font-family:var(--display);font-weight:900;font-size:26px;line-height:1;color:var(--lamp)}
.sticky .yr{font-family:var(--display);font-weight:700;font-size:19px;line-height:1}
.sticky .pk{font-size:12px;color:var(--muted)}
.chips{display:flex;gap:4px}
.chip{font-size:11px;font-weight:700;padding:3px 6px;border-radius:4px;border:1px dashed var(--line2);color:var(--muted)}
.chip.on{border:1px solid transparent;background:var(--surface2);color:var(--lamp)}
.sticky .sp{margin-left:auto;display:flex;gap:6px}
.brk{display:none}
.pg{background:var(--board);border-radius:12px;padding:14px 16px 16px;margin-bottom:18px;position:relative;overflow:hidden}
.pg-top{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);font-weight:600}
.sb{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:10px;margin:6px 0 12px}
.sb .tm{font-weight:700;font-size:14px;color:var(--muted)}
.sb .r{text-align:right}
.sb .pts{font-family:var(--display);font-weight:900;font-size:clamp(44px,12vw,64px);line-height:1;color:var(--ink);transition:color .3s}
.sb .lead .pts{color:var(--lamp)}
.sb .lead .tm{color:var(--ink)}
.clock{font-family:var(--display);font-weight:800;font-size:22px;text-align:center;min-width:84px;padding-bottom:6px}
.clock small{display:block;font-family:'Barlow',sans-serif;font-size:14px;font-weight:600;color:var(--muted)}
.field{position:relative;display:grid;grid-template-columns:9% 1fr 9%;height:60px;border-radius:8px;overflow:hidden}
.ez{display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:rgba(255,255,255,.55);background:#1A4A2E;writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:.5px;overflow:hidden;white-space:nowrap}
.ez.r{background:#3d3413;color:rgba(245,179,36,.8);transform:none}
.yards{position:relative;background:#1f5233;background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.22) 0 1px,transparent 1px 10%),repeating-linear-gradient(90deg,transparent 0 10%,rgba(0,0,0,.08) 10% 20%)}
.fifty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:var(--display);font-weight:800;font-size:18px;color:rgba(255,255,255,.25)}
.ball{position:absolute;top:50%;width:14px;height:9px;border-radius:50%;background:#e9e2d0;transform:translate(-50%,-50%);transition:left .32s cubic-bezier(.2,.7,.3,1);box-shadow:0 0 0 2px rgba(0,0,0,.25);animation:fadein .25s ease-out}
.ball.air{transition:left .5s cubic-bezier(.3,.1,.3,1)}
@keyframes fadein{from{opacity:0}to{opacity:1}}
.trail{position:absolute;top:50%;height:4px;transform:translateY(-50%);background:rgba(233,226,208,.35);border-radius:2px;transition:left .32s cubic-bezier(.2,.7,.3,1),width .32s cubic-bezier(.2,.7,.3,1)}
.trail.mine{background:rgba(245,179,36,.45)}
.ball.mine{background:var(--lamp);box-shadow:0 0 10px rgba(245,179,36,.7)}
.flash{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(14,23,19,.78);font-family:var(--display);font-weight:900;font-size:clamp(22px,6vw,34px);color:var(--ink);animation:pop .2s ease-out both;text-align:center;padding:0 10px}
.flash.mine{color:var(--lamp);text-shadow:0 0 16px rgba(245,179,36,.5)}
.pbp{margin-top:8px;min-height:2.6em}
.pbp .now{font-size:14px;font-weight:600;color:var(--ink)}
.spot{margin-top:2px;font-size:13px;color:var(--muted)}
.spot.rz{color:var(--lamp)}
.plog{margin-top:8px;font-size:13px;color:var(--muted);min-height:3.9em;line-height:1.3}
.plog div:first-child{color:var(--ink)}
.pfinal{margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.fin{font-family:var(--display);font-weight:900;font-size:30px}
.fin.w{color:var(--win)} .fin.l{color:var(--loss)}
.pre{background:var(--board);border-radius:12px;padding:18px;margin-bottom:18px}
.pre h3{font-family:var(--display);font-weight:900;font-size:34px;margin:0;color:var(--lamp)}
.pre p{margin:4px 0 14px;color:var(--muted);font-size:15px}
.place{margin-top:10px;font-size:15px;color:var(--ink);display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.place b{font-family:var(--display);font-weight:900;font-size:26px;color:var(--lamp)}
.place .pct{font-size:13px;font-weight:700;color:#15201A;background:var(--lamp);border-radius:4px;padding:2px 7px}
.recap{border-top:1px solid var(--line);margin-bottom:8px}
.rc{display:grid;grid-template-columns:28px 1fr 1fr;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:start}
.rc .n{font-family:var(--display);font-weight:800;font-size:20px;color:var(--muted)}
.rc .bd{font-size:12px;color:var(--muted);margin-bottom:2px}
.rc .tk{font-weight:700}
.rc .g2{font-family:var(--display);font-weight:800;margin-left:6px;color:var(--lamp)}
.rc .alt{color:var(--muted)}
.rc .alt b{color:var(--ink);font-weight:600}
.rc .ok{color:var(--win);font-weight:600}
.recap-sum{font-size:15px;margin:2px 0 10px}
.recap-sum b{font-family:var(--display);font-weight:900;font-size:22px;color:var(--lamp)}
.sharebox{width:100%;min-height:150px;font:13px/1.45 ui-monospace,Menlo,monospace;background:var(--board);color:var(--ink);border:1.5px solid var(--line2);border-radius:8px;padding:10px;margin-top:10px}
.notice{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:14px}
.modal-bg{position:fixed;inset:0;z-index:50;background:rgba(5,10,8,.72);display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow-y:auto}
.modal{background:var(--surface);border-radius:14px;max-width:520px;width:100%;padding:20px 20px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.modal h2{font-family:var(--display);font-weight:900;font-size:34px;margin:0 0 10px;color:var(--lamp)}
.modal ol{margin:0 0 12px;padding-left:22px}
.modal li{margin-bottom:9px;font-size:15px;line-height:1.4}
.modal li b{color:var(--ink)}
.modal .small{font-size:13px;color:var(--muted);margin:0 0 14px;line-height:1.45}
.hdr-links{display:flex;gap:14px;justify-content:flex-end;margin-top:6px}
.btn.reset{margin-left:auto;color:var(--muted);border-color:#3A404C;background:linear-gradient(180deg,#2B2F3A,#1F232B)}
.btn.reset:hover:not(:disabled){color:var(--ink)}
.btn.reset.armed{color:#FFD9D2;border-color:#B4483A;background:linear-gradient(180deg,#B4483A,#8E3225)}

/* ===== Visual layer: stadium night, team colors, LED scoreboard ===== */
.ps{--bg:#15171C;--surface:#1E2128;--surface2:#272B34;--line:#31353F;--line2:#434955;--ink:#ECEEF2;--muted:#99A0AE;--lamp:#F7B32B;--board:#0D0F13;
  --qb:#F2557A;--rb:#2FD3B5;--wr:#5AA9FF;--te:#F5A04A;--flex:#B18CFF;--ga:#4ADE80;--gb:#2FD3B5;--gc:#F7B32B;--gd:#F07B6B;
  --bevel:inset 0 1px 0 rgba(255,255,255,.10), inset 0 -1px 0 rgba(0,0,0,.5);
  background:
    radial-gradient(ellipse 90% 40% at 50% -10%, rgba(255,235,190,.09), transparent 70%),
    linear-gradient(180deg, #1A1D23 0%, #121419 100%);}
.pos-QB{--pc:var(--qb)} .pos-RB{--pc:var(--rb)} .pos-WR{--pc:var(--wr)} .pos-TE{--pc:var(--te)} .pos-FLEX{--pc:var(--flex)}
.ga{color:var(--ga)!important} .gb{color:var(--gb)!important} .gc{color:var(--gc)!important} .gd{color:var(--gd)!important}

/* header */
.brand{display:flex;align-items:center;gap:12px}
.brand svg{flex:none;filter:drop-shadow(0 3px 10px rgba(247,179,43,.35))}
.title{letter-spacing:0}

/* LED dot-matrix numerals: the wrapper glows, the inner text is cut into bulbs */
.led-wrap{filter:drop-shadow(0 0 6px rgba(247,179,43,.55)) drop-shadow(0 0 18px rgba(247,179,43,.25))}
.led{display:inline-block;color:var(--lamp);-webkit-mask-image:radial-gradient(circle,#000 56%,transparent 62%);mask-image:radial-gradient(circle,#000 56%,transparent 62%);
  -webkit-mask-size:var(--dot,6px) var(--dot,6px);mask-size:var(--dot,6px) var(--dot,6px)}
.rec{text-shadow:none;--dot:7px}
.sb .pts{--dot:4px}
.sb .pts .led{color:#F4EFE3}
.sb .lead .pts .led{color:var(--lamp)}
.sb .pts.led-wrap{filter:drop-shadow(0 0 5px rgba(247,179,43,.35))}
.reel .years{--dot:3.2px;font-size:32px}
.champion .sc{text-shadow:none;--dot:5px}

/* the spin: a broadcast-style team banner in that team's colors */
.reel{background:linear-gradient(102deg,var(--tc1) 0%,color-mix(in srgb,var(--tc1) 62%,#12151B) 46%,color-mix(in srgb,var(--tc1) 18%,#12151B) 82%);padding-left:22px;border-radius:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 12px 30px rgba(0,0,0,.35)}
.reel>*{position:relative;z-index:1}
.reel::after{content:'';position:absolute;z-index:0;top:-10%;bottom:-10%;right:7%;width:18px;background:var(--tc2);transform:skewX(-18deg);opacity:.7;box-shadow:26px 0 0 color-mix(in srgb,var(--tc2) 35%,transparent)}
.reel .stripe{display:none}
.reel .pickno{color:rgba(255,255,255,.72)}
.reel .team{color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.35),0 6px 24px rgba(0,0,0,.4);transform:skewX(-7deg);transform-origin:left bottom;letter-spacing:.5px}
.reel .city{color:rgba(255,255,255,.75)}
.reel.spin .team{opacity:.8;filter:blur(.6px)}
.sticky{background:linear-gradient(102deg,color-mix(in srgb,var(--tc1) 78%,#12151B) 0%,rgba(18,21,27,.95) 58%)}
.sticky .tm{color:#fff;transform:skewX(-7deg)}
.sticky .stripe{background:var(--tc2)!important}

/* roster: position-colored spots */
.slot{border-radius:10px}
.slot .k{color:var(--pc)}
.slot.filled{background:linear-gradient(180deg,var(--surface2),var(--surface));border:1px solid #363B46;box-shadow:inset 0 3px 0 var(--pc),var(--bevel),0 2px 4px rgba(0,0,0,.35)}
.slot.filled .k{color:var(--pc)}
.slot .sub{font-size:11.5px;color:var(--muted);margin-top:2px;font-weight:500}
.chip.on{color:var(--pc);background:color-mix(in srgb,var(--pc) 16%,transparent)}

/* player cards: position edge + pill, trading-card feel */
.sec h3{display:flex;align-items:center;gap:9px}
.sec h3::before{content:'';width:10px;height:10px;border-radius:3px;background:var(--pc);box-shadow:0 0 10px color-mix(in srgb,var(--pc) 60%,transparent)}
.card{border-radius:9px;background:linear-gradient(90deg,color-mix(in srgb,var(--pc) 10%,var(--surface)) 0%,var(--surface) 38%);box-shadow:inset 4px 0 0 var(--pc),var(--bevel),0 1px 3px rgba(0,0,0,.35)}
.card:hover:not(.off){background:linear-gradient(90deg,color-mix(in srgb,var(--pc) 14%,var(--surface2)) 0%,var(--surface2) 45%)}
.card.sel{border-color:var(--lamp);box-shadow:inset 4px 0 0 var(--pc),0 0 0 1.5px var(--lamp),var(--bevel),0 8px 24px rgba(0,0,0,.45)}
.nm-row{display:flex;align-items:center;gap:8px}
.pp{font-size:11px;font-weight:700;color:var(--pc);background:color-mix(in srgb,var(--pc) 16%,transparent);border-radius:4px;padding:1px 6px}
.tdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--tc1);box-shadow:0 0 0 1.5px var(--tc2);margin-right:6px;vertical-align:middle}
.cell:first-child .n{color:var(--pc)}

/* results */
.result-hero{background:radial-gradient(ellipse 70% 90% at 15% 0%,rgba(247,179,43,.10),transparent 60%),var(--board);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 0 1px rgba(255,255,255,.05),0 14px 34px rgba(0,0,0,.5)}
.g{border-left:3px solid transparent}
.g.win{background:linear-gradient(90deg,rgba(74,222,128,.13),var(--surface) 70%);border-left-color:var(--ga)}
.g.loss{background:linear-gradient(90deg,rgba(240,123,107,.14),var(--surface) 70%);border-left-color:var(--gd)}
.g.win .w{color:var(--ga)} .g.loss .w{color:var(--gd)}
.g.po{box-shadow:0 0 0 1px var(--lamp) inset}
.rv .s{color:var(--pc)}
.pre{background:radial-gradient(ellipse 60% 100% at 0% 0%,rgba(247,179,43,.16),transparent 65%),var(--board);border:1px solid rgba(247,179,43,.35)}
.pg{box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 12px 30px rgba(0,0,0,.35)}
.btn.solid{background:linear-gradient(180deg,#FFD166 0%,#F7B32B 48%,#E09A12 100%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -2px 0 rgba(140,90,0,.55),0 3px 10px rgba(247,179,43,.28)}
.btn.solid:active:not(:disabled){box-shadow:inset 0 2px 6px rgba(120,76,0,.5)}
.tile{background:linear-gradient(160deg,var(--surface2),var(--surface));box-shadow:var(--bevel)}
.panel{box-shadow:var(--bevel),0 2px 6px rgba(0,0,0,.3)}
.g{box-shadow:var(--bevel)}
.seg{box-shadow:var(--bevel)}
.seg button.on{box-shadow:inset 0 1px 0 rgba(255,255,255,.5),inset 0 -2px 0 rgba(140,90,0,.5);background:linear-gradient(180deg,#FFD166,#E09A12)}
.inp{box-shadow:inset 0 2px 4px rgba(0,0,0,.45)}
.tab.on{border-bottom-color:var(--lamp)}

/* ===== modes, daily, celebration ===== */
.modebar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.mb{border:1px solid #3A404C;background:linear-gradient(180deg,#2B2F3A,#1F232B);color:var(--muted);border-radius:8px;padding:7px 13px;font-weight:600;font-size:14px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.10),inset 0 -2px 0 rgba(0,0,0,.4)}
.mb.on{color:#241704;border-color:#C98A0E;background:linear-gradient(180deg,#FFD166,#E09A12);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),inset 0 -2px 0 rgba(140,90,0,.5)}
.mb:active{transform:translateY(1px)}
.seedline{font-size:13px;color:var(--muted);margin-left:auto;display:flex;align-items:center;gap:8px}
.seedline code{font-family:ui-monospace,Menlo,monospace;font-size:14px;letter-spacing:1px;color:var(--lamp);background:var(--board);border-radius:5px;padding:3px 8px;box-shadow:inset 0 1px 3px rgba(0,0,0,.5)}
.streak{display:inline-flex;align-items:baseline;gap:6px;font-size:13px;color:var(--muted)}
.streak b{font-family:var(--display);font-weight:900;font-size:22px;color:var(--lamp)}
.dayhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.locked{background:linear-gradient(160deg,var(--surface2),var(--surface));border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:var(--bevel)}
.locked h3{font-family:var(--display);font-weight:800;font-size:24px;margin:0 0 6px}
.cel{position:relative;overflow:hidden;border-radius:12px;padding:16px 18px;margin-bottom:16px;text-align:center;
  background:radial-gradient(ellipse 80% 120% at 50% 0%,rgba(247,179,43,.35),transparent 65%),linear-gradient(180deg,#2A2110,#14161B);
  box-shadow:inset 0 0 0 1.5px rgba(247,179,43,.55),0 10px 34px rgba(0,0,0,.5)}
.cel .big{font-family:var(--display);font-weight:900;line-height:.92;font-size:clamp(34px,10vw,56px);color:var(--lamp);text-shadow:0 0 22px rgba(247,179,43,.55)}
.cel .sml{font-size:15px;color:var(--ink);margin-top:6px}
.cel.perfect .big{background:linear-gradient(100deg,#FFE9A8,#F7B32B 35%,#FFF3CF 50%,#F7B32B 65%,#E09A12);-webkit-background-clip:text;background-clip:text;color:transparent;
  background-size:250% 100%;animation:sheen 2.6s linear infinite;text-shadow:none}
@keyframes sheen{from{background-position:160% 0}to{background-position:-60% 0}}
.confetti{position:absolute;inset:0;pointer-events:none}
.confetti i{position:absolute;top:-12%;width:7px;height:12px;border-radius:1px;opacity:0;animation:fall 2.6s ease-in forwards}
@keyframes fall{0%{opacity:0;transform:translateY(0) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translateY(320px) rotate(520deg)}}
@media (prefers-reduced-motion:reduce){.confetti{display:none}.cel.perfect .big{animation:none;background:none;color:var(--lamp)}}

/* landing page */
.hero{margin:6px 0 22px}
.hero .brand{margin-bottom:8px}
.hero .sub{max-width:60ch;font-size:16px;line-height:1.5}
.fmtpick{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:12px 14px;
  border:1px solid #363B46;border-radius:12px;background:linear-gradient(160deg,var(--surface2),var(--surface))}
.fmtlabel{font-weight:800;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-right:2px}
.fmtbtn{display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:1px solid #3C4250;border-radius:10px;
  padding:7px 13px;background:var(--surface);color:var(--muted);font-weight:800;font-size:14px;cursor:pointer;transition:filter .12s}
.fmtbtn:hover{filter:brightness(1.15)}
.fmtbtn.on{background:var(--lamp);color:#241704;border-color:transparent}
.fmtsub{font-weight:700;font-size:11px;opacity:.75;letter-spacing:.02em}
.fmtnote{flex-basis:100%;margin:2px 0 0;color:var(--muted);font-size:13.5px;max-width:66ch}
.dailycta{display:flex;gap:8px;flex-wrap:wrap}
.dailycta .btn{display:inline-flex;align-items:center}
.modes{display:grid;gap:10px;margin-bottom:18px}
.mode{display:block;width:100%;text-align:left;border:1px solid #363B46;border-radius:12px;padding:16px 18px;color:var(--ink);
  background:linear-gradient(160deg,var(--surface2),var(--surface));box-shadow:var(--bevel),0 3px 10px rgba(0,0,0,.35);transition:transform .08s,filter .12s}
.mode:hover:not(.static){filter:brightness(1.12)}
.mode:active:not(.static){transform:translateY(2px)}
.mode.static{cursor:default}
.mode.daily{background:radial-gradient(ellipse 70% 130% at 0% 0%,rgba(247,179,43,.22),transparent 60%),linear-gradient(160deg,var(--surface2),var(--surface));border-color:rgba(247,179,43,.5)}
.mode .mt{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.mode .mn{font-family:var(--display);font-weight:800;font-size:27px;line-height:1}
.mode p{margin:6px 0 10px;color:var(--muted);font-size:14.5px;max-width:58ch}
.mode .icon{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  font-size:21px;line-height:1;flex:0 0 auto;background:var(--lampsoft);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.mode .go{font-weight:800;font-size:13.5px;color:#241704;background:var(--lamp);border-radius:999px;padding:7px 14px 7px 16px;
  display:inline-flex;align-items:center;gap:6px;box-shadow:0 2px 10px rgba(245,179,36,.25);transition:transform .08s,filter .12s}
.mode .go::after{content:'\\2192';font-weight:900}
.mode:hover:not(.static) .go{filter:brightness(1.08)}
.mode:active:not(.static) .go{transform:translateY(1px)}
.mode.m-unlimited .icon{background:rgba(90,169,255,.18);color:#5AA9FF}
.mode.m-unlimited .go{background:#5AA9FF;color:#0A1526;box-shadow:0 2px 10px rgba(90,169,255,.25)}
.mode.m-genius .icon{background:rgba(177,140,255,.18);color:#B18CFF}
.mode.m-genius .go{background:#B18CFF;color:#1A1030;box-shadow:0 2px 10px rgba(177,140,255,.25)}
.mode.m-gm .icon{background:rgba(74,222,128,.18);color:#4ADE80}
.mode.m-gm .go{background:#4ADE80;color:#08210F;box-shadow:0 2px 10px rgba(74,222,128,.25)}
.mode.m-sou .icon{background:rgba(242,85,122,.18);color:#F2557A}
.mode.m-sou .go{background:#F2557A;color:#2B0710;box-shadow:0 2px 10px rgba(242,85,122,.25)}
.mode.m-bap .icon{background:rgba(47,211,198,.18);color:#2FD3C6}
.mode.m-bap .go{background:#2FD3C6;color:#04211E;box-shadow:0 2px 10px rgba(47,211,198,.25)}
.mode.static .icon{background:rgba(147,168,155,.14);color:var(--muted)}
.mode .pill{font-size:12px;font-weight:700;color:#241704;background:var(--lamp);border-radius:20px;padding:2px 9px}
.pill{font-size:13px;font-weight:600;color:var(--ink);background:var(--surface2);border:1px solid var(--line2);border-radius:20px;padding:4px 12px}
button.pill{font-family:inherit}
.sou-hud{display:flex;align-items:center;gap:16px;margin-bottom:12px}
.sou-hearts{font-size:28px;line-height:1;letter-spacing:3px}
.sou-score{font-family:var(--display);font-weight:800;font-size:19px;color:var(--ink)}
.sou-timer{font-family:var(--display);font-weight:900;font-size:36px;color:var(--lamp);min-width:56px;text-align:center;
  text-shadow:0 0 14px rgba(245,179,36,.4);transition:color .15s}
.sou-timer.danger{color:var(--loss);text-shadow:0 0 14px rgba(240,123,107,.5);animation:sou-pulse .5s ease-in-out infinite}
@keyframes sou-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
@media (prefers-reduced-motion:reduce){.sou-timer.danger{animation:none}}
.hometiles{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px}
.hometiles .n{font-size:26px}
.whoami{font-weight:600;font-size:14px;color:var(--ink)}
.nav .hdr-links{margin-left:auto;margin-top:0;align-items:center;padding-bottom:6px}
.nav{align-items:center}
@media (max-width:640px){.modes{gap:8px}.mode{padding:14px}.mode .mn{font-size:24px}.mode .icon{width:36px;height:36px;font-size:18px;border-radius:10px}}
@media (max-width:480px){
  .nav{flex-wrap:wrap;row-gap:6px}
  .nav .hdr-links{margin-left:0;width:100%;justify-content:flex-start;padding-bottom:0}
  .nav .hdr-links button,.nav .hdr-links .whoami{white-space:nowrap}
  .tab{padding:8px 9px;font-size:14px}
}
@media (max-width:640px){.btn.reset{margin-left:0}.rc{grid-template-columns:24px 1fr}.rc .alt{grid-column:2}.cells{display:grid;grid-template-columns:repeat(4,1fr);width:100%;gap:8px 6px}.cell{width:auto}.sticky .in{padding:6px 12px 7px 18px;gap:4px 8px}.sticky .tm{font-size:24px}.chip{padding:2px 4px;font-size:10.5px}.sticky .btn.sm{padding:4px 8px;font-size:11.5px}.sticky .pk{display:none}.roster{grid-template-columns:repeat(3,1fr)}.title{font-size:36px}.tiles{grid-template-columns:repeat(2,1fr)}.lb .hide{display:none}.rr{grid-template-columns:56px 56px 1fr}.rr .sc2{display:none}.sticky .sp{margin-left:auto}.brk{display:block;flex-basis:100%;height:0}}
@media (prefers-reduced-motion:reduce){.g,.flash,.ball{animation:none}.ball,.trail{transition:none}.sticky{transition:none}}
`;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Storage ----------
// Accounts and sessions are now handled by Supabase Auth (storage.js's authSignUp/authSignIn/
// authGetSession/authOnChange) - no client-side password hashing or session token needed.
// Personal (device):  ps-profile -> pre-login guest stats, folded into the real account on signup
const OLD_PROFILE = "ps-profile";

function blankStats(username) {
  return { username, runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0,
    bestScore: null, bestRun: null, bestRecord: null, recent: [], created: Date.now() };
}
const draftsOf = (s) => (s.runs || 0) + (s.dnf || 0);

const topPct = (rank, total) => {
  const p = (100 * rank) / total;
  return p < 1 ? `Top ${p.toFixed(1)}%` : `Top ${Math.max(1, Math.round(p))}%`;
};

// Every leaderboard on the Stats screen is a different sort/aggregation over one fetched batch of
// profiles (see storage.js's fetchStatsProfiles) - kept as one pure function so the component
// itself just useMemo's the result instead of a wall of inline .sort()/.filter() calls.
// Score-ranked boards are computed for BOTH formats in this one pass (it's a single walk over an
// already-fetched array, so there's no cost to it) and the screen picks which to show. Career
// counters below stay merged - they measure seasons played, not points scored.
function computeSiteStats(profiles) {
  const byFormat = {};
  for (const f of FORMATS) {
    const scored = profiles.filter((q) => scoreOf(q, f) != null);
    byFormat[f] = {
      bestLineups: [...scored].sort((a, b) => scoreOf(b, f) - scoreOf(a, f)).slice(0, 15),
      // Best-ever player at each slot. Each format's best_run column is format-pure by
      // construction, so no tagging is needed and no run lands in the wrong bucket - which also
      // avoids comparing a full-PPR rating against a standard one.
      posRecords: (() => {
        const rec = {};
        for (const q of profiles) {
          const best = runOf(q, f);
          if (!best) continue;
          for (const p of best.roster) {
            const bucket = p.slot.startsWith("FLEX") ? "FLEX" : p.slot;
            if (!rec[bucket] || p.rating > rec[bucket].rating) rec[bucket] = { ...p, username: q.username };
          }
        }
        return rec;
      })(),
      // GM-mode runs are tagged via run.gm (see finish()); runs from before either tag existed
      // are simply excluded rather than assumed, since recent only holds a bounded window.
      bestGm: profiles.flatMap((q) => (q.recent || [])
        .filter((run) => run.gm && normFormat(run.format) === f)
        .map((run) => ({ ...run, username: q.username })))
        .sort((a, b) => b.score - a.score).slice(0, 10),
    };
  }

  const draftCounts = new Map();
  for (const q of profiles) for (const run of q.recent || []) {
    if (run.dnf || !run.roster) continue;
    for (const p of run.roster) {
      const key = `${p.name}|${p.season}|${p.team}`;
      draftCounts.set(key, (draftCounts.get(key) || 0) + 1);
    }
  }
  const mostDrafted = [...draftCounts.entries()]
    .map(([key, count]) => { const [name, season, team] = key.split("|"); return { name, season, team, count }; })
    .sort((a, b) => b.count - a.count).slice(0, 15);

  const withDrafts = profiles.filter((q) => draftsOf(q) > 0);
  const mostWins = [...withDrafts].sort((a, b) => b.wins - a.wins).slice(0, 10);
  const mostChamps = withDrafts.filter((q) => q.champs > 0).sort((a, b) => b.champs - a.champs).slice(0, 10);
  const mostPlayoffs = withDrafts.filter((q) => q.playoffs > 0).sort((a, b) => b.playoffs - a.playoffs).slice(0, 10);
  const longestStreaks = profiles.filter((q) => q.dailyBestStreak > 0).sort((a, b) => b.dailyBestStreak - a.dailyBestStreak).slice(0, 10);
  // A minimum sample so a 1-0 account can't top a percentage-based leaderboard.
  const bestWinPct = withDrafts.filter((q) => q.wins + q.losses >= 3)
    .map((q) => ({ ...q, pct: q.wins / (q.wins + q.losses) }))
    .sort((a, b) => b.pct - a.pct).slice(0, 10);

  const totalWins = withDrafts.reduce((t, q) => t + q.wins, 0);
  const totalLosses = withDrafts.reduce((t, q) => t + q.losses, 0);
  const avgWinPct = totalWins + totalLosses > 0 ? Math.round((100 * totalWins) / (totalWins + totalLosses)) : 0;

  return { byFormat, mostDrafted, mostWins, mostChamps, mostPlayoffs, longestStreaks, bestWinPct, avgWinPct };
}
const POS_RECORD_SLOTS = [["QB", "QB"], ["RB", "RB"], ["WR", "WR"], ["TE", "TE"], ["FLEX", "Flex"]];
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const USER_RE = /^[a-zA-Z0-9_]{3,16}$/;

const OUTCOME_BUTTONS = [
  ["perfect", "Force 20–0 (perfect)"],
  ["champ", "Force championship win"],
  ["lostWildCard", "Force loss: Wild Card"],
  ["lostDivisional", "Force loss: Divisional"],
  ["lostConference", "Force loss: Conference"],
  ["lostChampionship", "Force loss: Championship"],
  ["missedPlayoffs", "Force missed playoffs"],
];

// Admin-only testing panel: jump straight to any board, force a specific player into a slot,
// or force a scripted season ending, all without touching real stats or storage.
function AdminPanel({ openSlots, onForceBoard, onForcePlayer, onForceOutcome }) {
  const [team, setTeam] = useState(TEAM_CODES[0]);
  const [w, setW] = useState(0);
  const [query, setQuery] = useState("");
  const matches = adminSearchPlayers(query);
  return (
    <div className="panel">
      <h3>Admin tools</h3>
      <div className="frow" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select className="inp" value={team} onChange={(e) => setTeam(e.target.value)}>
          {TEAM_CODES.map((t) => <option key={t} value={t}>{TEAMS[t][0]}</option>)}
        </select>
        <select className="inp" value={w} onChange={(e) => setW(Number(e.target.value))}>
          {WINDOWS.map((win, i) => <option key={i} value={i}>{win[0]}–{win[1]}</option>)}
        </select>
        <button className="btn sm" onClick={() => onForceBoard(team, w)}>Jump to board</button>
      </div>
      <div className="frow" style={{ marginTop: 8 }}>
        <input className="inp" placeholder="Force a player by name" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {matches.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {matches.map((p) => (
            <div key={`${p.id}-${p.season}-${p.team}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "4px 0" }}>
              <span style={{ fontSize: 13 }}>{p.name} - {p.season} {TEAMS[p.team][0]} ({p.pos})</span>
              {openSlots.filter((s) => fits(p.pos, s)).map((s) => (
                <button key={s} className="btn sm" onClick={() => onForcePlayer(p, s)}>{SLOT_LABEL[s]}</button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="frow" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
        {OUTCOME_BUTTONS.map(([key, label]) => (
          <button key={key} className="btn sm" onClick={() => onForceOutcome(key)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

// Read-only companion to the draft board: browse every player who's ever qualified for a board,
// by team and era - no drafting, just the same card/section markup the live board uses (minus
// the "hit"/"drafts" interactive bits) so it looks and feels like the same data.
function PlayerIndex() {
  const [team, setTeam] = useState("");
  const [w, setW] = useState("");
  const key = team && w !== "" ? `${team}|${w}` : null;
  const board = key ? BOARDS[key] || [] : [];
  return (
    <>
      <h2 className="h">Players</h2>
      <p className="note" style={{ marginTop: 0 }}>
        Browse every player who's ever qualified for a board, by team and era.
      </p>
      <div className="frow" style={{ flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        <select className="inp" value={team} onChange={(e) => setTeam(e.target.value)}>
          <option value="">Choose a team</option>
          {TEAM_CODES.map((t) => <option key={t} value={t}>{TEAMS[t][0]}</option>)}
        </select>
        <select className="inp" value={w} onChange={(e) => setW(e.target.value)}>
          <option value="">Choose an era</option>
          {WINDOWS.map((win, i) => <option key={i} value={i}>{win[0]}–{win[1]}</option>)}
        </select>
      </div>
      {!key ? (
        <p className="note">Pick a team and an era to see who's on the board.</p>
      ) : board.length === 0 ? (
        <p className="note">No players qualified for {TEAMS[team][0]}, {WINDOWS[w][0]}–{WINDOWS[w][1]}.</p>
      ) : (
        POS.map((pos) => {
          const list = board.filter((p) => p.pos === pos);
          if (!list.length) return null;
          return (
            <section className={`sec pos-${pos}`} key={pos}>
              <div className="hd"><h3>{POS_NAME[pos]}</h3></div>
              {list.map((p) => (
                <div className="card" key={`${p.id}-${p.season}`}>
                  <div className="row">
                    <div>
                      <div className="nm-row"><span className="pp">{p.pos}</span><span className="nm">{p.name}</span></div>
                      <div className="meta"><span className="tdot" style={teamVars(p.team)} />{p.season} {teamLabel(p.team, p.season)}, {p.g} games</div>
                    </div>
                    <div className="cells">
                      {statCells(p).map(([n, l]) => (<div className="cell" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>))}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          );
        })
      )}
    </>
  );
}

function RosterRows({ roster }) {
  return (
    <div className="reveal">
      {roster.map((p) => (
        <div className={`rv pos-${p.slot.startsWith("FLEX") ? "FLEX" : p.slot}`} key={p.slot}>
          <div className="s">{SLOT_LABEL[p.slot]}</div>
          <div><div className="p">{p.name}</div><div className="t">{p.season} {teamLabel(p.team, p.season)}</div></div>
          <div className="pts">{p.ppr.toFixed(1)}<small>PPR pts</small></div>
          <div className={`gr ${gradeTier(p.rating)}`}>{grade(p.rating)}</div>
        </div>
      ))}
    </div>
  );
}

// A drafted-roster summary as small position-colored chips (reusing the same chip/pos-${slot}
// coloring the in-draft sticky bar uses) instead of one long comma-joined line of names - used
// anywhere a saved roster gets shown back compactly (the sitewide/hall-of-fame best-lineup cards).
function RosterChips({ roster }) {
  return (
    <div className="chips" style={{ flexWrap: "wrap", marginTop: 6 }}>
      {roster.map((p, i) => (
        <span key={i} className={`chip on pos-${(p.slot || "").startsWith("FLEX") ? "FLEX" : p.slot || ""}`}>
          {p.name} · {shortYr(p.season)}
        </span>
      ))}
    </div>
  );
}

// A plain "#rank — username — value" leaderboard, shared by every zero-frills Stats leaderboard
// (wins, championships, playoffs, streak, win %, GM score) - the same .rc grid every other
// leaderboard-style row in this app uses, just without a bd/tk label pair in the middle column.
function RankRows({ rows, empty, value }) {
  if (rows.length === 0) return <p className="note" style={{ marginTop: 0 }}>{empty}</p>;
  return (
    <div className="recap">
      {rows.map((r, i) => (
        <div className="rc" key={r.id || i}>
          <div className="n">{i + 1}</div>
          <div className="tk">{r.username}</div>
          <div className="alt">{value(r)}</div>
        </div>
      ))}
    </div>
  );
}

function AuthPanel({ onAuthed, title, blurb }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [u, setU] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr("");
    const emailTrim = email.trim();
    const username = u.trim();
    if (!emailTrim || !emailTrim.includes("@")) return setErr("Enter a valid email address.");
    if (mode === "signup" && !USER_RE.test(username)) return setErr("Usernames are 3 to 16 characters: letters, numbers, and underscores.");
    if (pw.length < 6) return setErr("Passwords need at least 6 characters.");
    if (mode === "signup" && pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await authSignUp(emailTrim, pw, username);
        if (error) { setBusy(false); return setErr(mapAuthError(error)); }
        await onAuthed(data.user.id, username, true);
      } else {
        const { data, error } = await authSignIn(emailTrim, pw);
        if (error) { setBusy(false); return setErr("Incorrect email or password."); }
        const prof = await fetchProfile(data.user.id);
        await onAuthed(data.user.id, prof?.username || "", false);
      }
    } catch (e) {
      setErr("Something went wrong. Try again.");
    }
    setBusy(false);
  }

  const onKey = (e) => e.key === "Enter" && !busy && submit();
  return (
    <div className="panel">
      {title && <h3>{title}</h3>}
      {blurb && <p>{blurb}</p>}
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(""); }}>Log in</button>
        <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setErr(""); }}>Create account</button>
      </div>
      <div className="fields">
        <label>Email<input className="inp" type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} /></label>
        {mode === "signup" && <label>Username<input className="inp" value={u} maxLength={16} autoComplete="username" onChange={(e) => setU(e.target.value)} onKeyDown={onKey} /></label>}
        <label>Password<input className="inp" type="password" value={pw} autoComplete={mode === "signup" ? "new-password" : "current-password"} onChange={(e) => setPw(e.target.value)} onKeyDown={onKey} /></label>
        {mode === "signup" && <label>Confirm password<input className="inp" type="password" value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} onKeyDown={onKey} /></label>}
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      <div className="frow" style={{ marginTop: 10 }}>
        <button className="btn solid" disabled={busy} onClick={submit}>{busy ? "Checking…" : mode === "login" ? "Log in" : "Create account"}</button>
      </div>
      {mode === "signup" && <p className="fine">Your username, best score, and best lineup appear on the leaderboard. Your email is never shown publicly.</p>}
    </div>
  );
}

const DRAFT_KEY = "ps-draft";
// Both formats' dailies are live on the same calendar day, so their saved state is keyed per
// format. Fantasy keeps the original unsuffixed keys, so a daily already in progress when this
// shipped resumes normally.
const fmtSuffix = (f) => (normFormat(f) === "standard" ? ":std" : "");
const DAILY_KEY = (d, f) => `ps-daily:${d}${fmtSuffix(f)}`;
const DAILY_PROGRESS = (d, f) => `ps-daily-wip:${d}${fmtSuffix(f)}`;
const FREE_PROGRESS = "ps-free-wip";
const FORMAT_KEY = "ps-format";
// Which saved-progress slot a mode occupies. Free-mode variants (genius/gm/format) all share one
// slot the way they always have; the two dailies genuinely coexist, so they don't.
const slotId = (m) => (m.kind === "daily" ? `daily:${normFormat(m.format)}` : "free");
// Scores from the two formats live in different profile fields and never rank against each other.
const scoreOf = (p, format) => (p ? p[BEST_FIELDS[normFormat(format)].score] ?? null : null);
const runOf = (p, format) => (p ? p[BEST_FIELDS[normFormat(format)].run] ?? null : null);
const FORMAT_LABEL = { fantasy: "Fantasy", standard: "Championship" };
const HOWTO_KEY = "ps-howto-seen";
const SOU_DONE_KEY = (d) => `ps-sou:${d}`;
const SOU_PROGRESS = (d) => `ps-sou-wip:${d}`;
const findPlayer = (key, id, season) => (BOARDS[key] || []).find((p) => p.id === id && p.season === season);
const shortYr = (y) => `'${String(y).slice(2)}`;

function bestAvailable(key, draftedIds, openSlots, format) {
  const rate = (p) => (normFormat(format) === "standard" ? p.stdRating : p.rating);
  const c = (BOARDS[key] || []).filter((p) => !draftedIds.includes(p.id) && openSlots.some((s) => fits(p.pos, s)));
  return c.reduce((a, p) => (!a || rate(p) > rate(a) ? p : a), null);
}

function permute(arr) {
  if (arr.length <= 1) return [arr];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of permute(rest)) out.push([arr[i], ...p]);
  }
  return out;
}

// Retrospective best possible roster: given the 6 boards actually seen this draft (fixed,
// not choosable), find the board-to-slot assignment that maximizes team score. Unlike
// bestAvailable (which is greedy and pick-order-dependent - "best player on this board given
// whatever slots happened to still be open at that exact moment"), this considers all 720
// board/slot pairings so a QB taken early only because it was the lone option doesn't hide a
// much better QB seen later on a board whose player ended up elsewhere.
function bestOrderFor(history, format) {
  const boardKeys = history.map((h) => h.key);
  let best = null;
  for (const order of permute(SLOTS)) {
    let total = 0, ok = true;
    const assignment = {};
    for (let i = 0; i < boardKeys.length; i++) {
      const slot = order[i], key = boardKeys[i];
      const top = (BOARDS[key] || []).filter((p) => fits(p.pos, slot))
        .reduce((a, p) => (!a || effectiveRating(slot, p, format) > effectiveRating(slot, a, format) ? p : a), null);
      if (!top) { ok = false; break; }
      total += effectiveRating(slot, top, format) * (slot === "QB" ? QB_WEIGHT : 1);
      assignment[slot] = { key, player: top };
    }
    if (ok && (!best || total > best.totalRating)) best = { slotAssignment: assignment, totalRating: total };
  }
  return best;
}

function Confetti({ n = 26 }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, i) => ({
    left: `${(i * 97) % 100}%`, delay: `${(i % 9) * 0.12}s`,
    bg: ["#F7B32B", "#5AA9FF", "#4ADE80", "#F2557A", "#B18CFF"][i % 5],
    dur: `${2.2 + ((i * 7) % 9) / 10}s`,
  })), [n]);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => <i key={i} style={{ left: b.left, background: b.bg, animationDelay: b.delay, animationDuration: b.dur }} />)}
    </div>
  );
}

function shareText(result, roster, place, mode) {
  const reg = result.games.filter((g) => !g.playoff).map((g) => (g.win ? "🟩" : "🟥")).join("");
  const po = result.games.filter((g) => g.playoff).map((g) => (g.win ? "🟩" : "🟥")).join("");
  // The format is named whenever it isn't the default, so a shared score can't be mistaken for a
  // full-PPR one - the two don't rank against each other.
  const fmt = normFormat(mode?.format) === "standard" ? " · Championship" : "";
  const lines = [
    mode && mode.kind === "daily" ? `Perfect Season 🏈 Daily ${mode.date}${fmt} · ${result.w}–${result.l}` : `Perfect Season 🏈${fmt} ${result.w}–${result.l}`,
    result.outcome,
    `Team score ${result.score.toFixed(1)}${place ? ` · #${place.rank.toLocaleString()} of ${place.total.toLocaleString()}` : ""}`,
    reg,
  ];
  if (po) lines.push(`Playoffs ${po}`);
  lines.push(SLOTS.map((s) => `${s.startsWith("FLEX") ? "FX" : s} ${lastName(roster[s].name)} ${shortYr(roster[s].season)}`).join(", "));
  if (mode && mode.kind !== "daily") lines.push(`Draft the same boards: code ${mode.code}`);
  return lines.join("\n");
}

function HowTo({ onClose }) {
  const btn = useRef(null);
  useEffect(() => {
    btn.current && btn.current.focus();
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="howto-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="howto-title">How to play</h2>
        <ol>
          <li>Each round spins a <b>team and a five-year era</b>, like "Rams, 1999–2005." Draft one player from that board.</li>
          <li>Fill six spots: <b>QB, RB, WR, TE, and two Flex</b>. A Flex can be any RB, WR, or TE.</li>
          <li>Every player shows <b>his best season</b> for that team in that era. The stats are real. The fantasy points are hidden.</li>
          <li>You get <b>one team re-spin and one era re-spin</b> per draft. Use them wisely.</li>
          <li>Play <b>unlimited</b> drafts any time, or take the <b>daily</b> — one draft a day, the same boards for everyone.</li>
          <li>Your six are graded, then your team plays <b>17 games against real NFL teams</b> and, if you're good enough, the playoffs. Win them all for a <b>perfect 20–0 season</b>.</li>
        </ol>
        <p className="small">Grades are based on PPR fantasy points compared to the top players at that position in the same era, with a bump for efficiency (QB rating, completion %, yards per carry). Flex is graded on raw production instead, with no positional comparison. Your QB counts a little more than the others.</p>
        <button ref={btn} className="btn solid" onClick={onClose}>Got it, let's draft</button>
      </div>
    </div>
  );
}

export default function PerfectSeason() {
  const [view, setView] = useState("home");
  const [roster, setRoster] = useState({});
  const [spin, setSpin] = useState(null);
  const [display, setDisplay] = useState(null);
  const [spinning, setSpinning] = useState(false);
  const [used, setUsed] = useState([]);
  const [rerolls, setRerolls] = useState({ team: REROLL_BUDGET, years: REROLL_BUDGET });
  const [selected, setSelected] = useState(null);
  const [result, setResult] = useState(null);
  const [shown, setShown] = useState(0);
  const [po, setPo] = useState({ idx: 0, stage: "pre" });
  const [user, setUser] = useState(null);
  const [userId, setUserId] = useState(null); // Supabase auth user id - the real key for profile reads/writes
  const [stats, setStats] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState(false);
  // `format` records which scoring format `top`/`myRank` were actually fetched for. The board is
  // always rendered from THAT, never from the live boardFormat state - switching format flips the
  // state immediately while the refetch is still in flight, and rendering one format's rows under
  // the other's accessors reads a null score (a profile with no run in that format yet).
  const [lb, setLb] = useState({ loading: true, top: [], totals: { runs: 0, perfect: 0, players: 0 }, myRank: -1, format: "fantasy" });
  const timer = useRef(null);
  const recentSpins = useRef([]);
  const bapTimer = useRef(null);
  const souTimer = useRef(null);
  const [history, setHistory] = useState([]); // one entry per pick, for the recap and for resuming
  const [draftReady, setDraftReady] = useState(false);
  const [resumed, setResumed] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const [share, setShare] = useState({ state: "idle", text: "" });
  const [confirmReset, setConfirmReset] = useState(false);
  const [mode, setMode] = useState(null);           // { kind: "free"|"daily", code, date, seed, gm, genius, format }
  const [seq, setSeq] = useState([]);               // seeded board order for this draft
  const [seqIdx, setSeqIdx] = useState(0);
  // Which scoring format new drafts use. A per-device preference rather than a mode, so it
  // layers over Daily/Unlimited/Genius/GM instead of doubling the number of mode tiles.
  const [format, setFormat] = useState("fantasy");
  // Which format the Leaderboard/Stats screens are showing. Separate from `format` above: which
  // board you're reading is independent of which format your next draft will use.
  const [boardFormat, setBoardFormat] = useState("fantasy");
  // loadLeaderboard() is called from effects and handlers that captured an older render, and it
  // reads the board format at call time - a ref, so it can't pick up a stale value the way
  // reading the state variable through a closure would.
  const boardFormatRef = useRef("fantasy");
  function showBoardFormat(f) { boardFormatRef.current = f; setBoardFormat(f); }
  const [dailyDone, setDailyDone] = useState({});   // today's finished daily per format, if any
  const [codeInput, setCodeInput] = useState("");
  const [dailyBoard, setDailyBoard] = useState({ loading: false, rows: [], format: "fantasy" });
  const [siteStats, setSiteStats] = useState({ loading: false, loaded: false, profiles: [], buildCount: 0, topBuilds: [] });
  const [online, setOnline] = useState(null); // concurrent-players count, null until the Realtime channel first syncs
  const [liveDrafts, setLiveDrafts] = useState(null); // total drafts, live-ticked via broadcast on top of the initial fetchSiteTotals() count
  const siteActivity = useRef(null); // { unsubscribe, broadcastDraftFinished } from subscribeSiteActivity - finish() reaches it to announce a completed draft
  // Over/Under's daily game state while playing:
  // { date, roundIndex, lives, score, round, guess, correct, deadline, timeLeft }
  const [sou, setSou] = useState(null);
  const [souIntro, setSouIntro] = useState(null); // rules screen pending a confirm - { date, roundIndex, lives, score }, the timer doesn't start until this is accepted
  const [souDone, setSouDone] = useState(null); // today's finished record, if any: { score }
  const [souBoard, setSouBoard] = useState({ loading: false, rows: [] });
  // Standalone from the normal draft - see openBuildPicker/pickBapAttr/playBapSim below.
  // stage "build": { stage, pos, filled: {attr: {score, fromName, fromTeam, fromSeason}}, remaining: [attr], seen: [playerId], team, player }
  // "seen" is every player id already rolled this build, so the same real player never comes up twice.
  // stage "done":  { stage, pos, filled }
  // stage "result": { stage, pos, filled, opp, sim }
  const [bap, setBap] = useState(null);
  const [wip, setWip] = useState({});               // unfinished drafts, by mode
  // Counts in-flight clearDraft() calls per mode. clearDraft is fire-and-forget (overwrite,
  // then delete - see clearDraft below), so a refreshWip() read can land before it's done and
  // return the stale pre-clear snapshot; while a clear is pending for a mode, refreshWip()
  // leaves that mode's wip alone instead of trusting the read.
  const pendingClears = useRef({});
  function clearDraftTracked(slot, key) {
    pendingClears.current[slot] = (pendingClears.current[slot] || 0) + 1;
    clearDraft(key).finally(() => { pendingClears.current[slot]--; });
  }
  const sentinel = useRef(null);
  const draftTop = useRef(null);
  const [stuck, setStuck] = useState(false);
  const [showDone, setShowDone] = useState({});

  const drafted = useMemo(() => new Set(Object.values(roster).map((p) => p.id)), [roster]);
  const open = SLOTS.filter((s) => !roster[s]);
  const capUsed = SLOTS.reduce((sum, s) => sum + (roster[s] ? playerSalary(roster[s], mode?.format) : 0), 0);
  const capRemaining = GM_CAP - capUsed;

  useEffect(() => {
    (async () => {
      const { data } = await authGetSession();
      if (data?.session?.user) {
        const prof = await fetchProfile(data.session.user.id);
        if (prof) { setUserId(data.session.user.id); setUser(prof.username); setStats(prof); }
      }
      setAuthReady(true);
    })();
    const { data: authSub } = authOnChange((event) => {
      if (event === "SIGNED_OUT") { setUserId(null); setUser(null); setStats(null); }
    });
    loadLeaderboard();
    (async () => {
      const today = todayKey();
      const [fanDone, stdDone, savedFormat] = await Promise.all([
        sget(DAILY_KEY(today, "fantasy"), false), sget(DAILY_KEY(today, "standard"), false), sget(FORMAT_KEY, false),
      ]);
      setDailyDone({ fantasy: fanDone, standard: stdDone });
      if (savedFormat) setFormat(normFormat(savedFormat));
      setSouDone(await sget(SOU_DONE_KEY(todayKey()), false));
      const saved = await sget(DRAFT_KEY, false);
      const ok = saved && saved.spin && BOARDS[`${saved.spin.team}|${saved.spin.w}`] && Array.isArray(saved.history)
        && saved.history.every((h) => findPlayer(h.key, h.id, h.season));
      if (ok && saved.history.length > 0 && saved.mode) restoreDraft(saved);
      refreshWip();
      setDraftReady(true);
      if (!(await sget(HOWTO_KEY, false))) setHowTo(true);
    })();
    siteActivity.current = subscribeSiteActivity({
      onOnlineCount: setOnline,
      onDraftFinished: () => setLiveDrafts((n) => (n == null ? n : n + 1)),
    });
    return () => { clearInterval(timer.current); authSub?.subscription?.unsubscribe(); siteActivity.current?.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft in progress on this device so a reload doesn't lose it
  useEffect(() => {
    if (!draftReady || result || !spin || spinning || !mode) return;
    const snap = { history, spin, used, rerolls, mode, seq, seqIdx };
    sset(DRAFT_KEY, snap, false);
    sset(mode.kind === "daily" ? DAILY_PROGRESS(mode.date, mode.format) : FREE_PROGRESS, snap, false);
    setWip((w) => ({ ...w, [slotId(mode)]: history.length }));
  }, [draftReady, history, spin, used, rerolls, mode, seq, seqIdx, result, spinning]);

  // Show the compact team bar once the big scoreboard scrolls out of view
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") { setStuck(false); return; }
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => { io.disconnect(); setStuck(false); };
  }, [view, !!result, !!spin]);

  // top/totals/myRank replace the old "fetch every stats row, derive everything client-side"
  // approach - each is now its own targeted query (see storage.js), so this scales past a
  // handful of players instead of loading the entire table on every leaderboard view.
  async function loadLeaderboard(fmt) {
    const boardFormat = normFormat(fmt || boardFormatRef.current);
    setLb((x) => ({ ...x, loading: true, error: false }));
    try {
      const [top, totals] = await Promise.all([fetchLeaderboardTop(10, boardFormat), fetchSiteTotals()]);
      const myKey = user ? user.toLowerCase() : null;
      let myRank = -1;
      if (myKey) {
        const mine = scoreOf(stats, boardFormat);
        const idx = top.findIndex((q) => q.id === myKey);
        myRank = idx >= 0 ? idx : mine != null ? await fetchOwnRank(mine, boardFormat) : -1;
      }
      setLb({ loading: false, top, totals, myRank, error: false, format: boardFormat });
      setLiveDrafts(totals.runs);
    } catch (e) {
      setLb({ loading: false, top: [], totals: { runs: 0, perfect: 0, players: 0 }, myRank: -1, error: true, format: boardFormat });
    }
  }

  // Lazy - only fetched once the Stats tab is actually opened. Every profile-based leaderboard on
  // that screen (see the Stats view below) is a different client-side sort/aggregation over
  // fetchStatsProfiles's one fetch; builds live in their own table (Build-a-player results never
  // touch a profile row), so the created-players count/leaderboard are their own small fetch.
  async function loadSiteStats() {
    setSiteStats((s) => ({ ...s, loading: true }));
    try {
      const [profiles, buildCount, topBuilds] = await Promise.all([fetchStatsProfiles(300), fetchBuildCount(), fetchTopBuilds(10)]);
      setSiteStats({ loading: false, loaded: true, profiles, buildCount, topBuilds });
    } catch (e) {
      setSiteStats({ loading: false, loaded: true, profiles: [], buildCount: 0, topBuilds: [] });
    }
  }

  // profiles is no longer client-writable at all (see supabase/schema.sql) - a DNF applies
  // optimistically to local state for instant UI feedback (same shape the server will also
  // compute, via the same shared applyDnf), then confirms through submit-run in the background.
  function recordDnf(picks) {
    if (!user || !stats) return;
    setStats(applyDnf(stats, picks));
    submitDnf(picks).then((ok) => setSaveError(!ok));
  }

  // Submits a draft trace to submit-run and, once the server has independently replayed and
  // recomputed it, re-fetches the account's real profile so stats/leaderboard reflect what
  // actually landed - never the client's own (untrusted) computation. `uid` is taken as a
  // parameter rather than closing over the `userId` state, since callers right after a fresh
  // login (onAuthed) run before that state has committed.
  async function submitAndSync(uid, trace) {
    // Never let a raw exception (e.g. the network dropping mid-fetchProfile, right after a
    // successful submitRun) escape uncaught - callers like onAuthed already cleared `pending`
    // by this point, so an unhandled rejection here would lose track of whether the run was
    // actually saved with no way for the caller to react.
    try {
      const res = await submitRun(trace);
      if (res.ok) {
        const fresh = await fetchProfile(uid);
        if (fresh) setStats(fresh);
      }
      setSaveError(!res.ok);
      return res;
    } catch (e) {
      setSaveError(true);
      return { ok: false };
    }
  }

  async function onAuthed(uid, username, isNew) {
    let s = (await fetchProfile(uid)) || blankStats(username);
    const notes = [];
    if (isNew) {
      // Bring over seasons played on this device before accounts existed - display-only now:
      // profiles isn't client-writable at all (see supabase/schema.sql), and this legacy,
      // pre-Supabase local-stats path predates every current account, so it's not worth a
      // dedicated server endpoint just to persist a migration nothing realistically still
      // triggers. (If a pending run below also applies, its server-confirmed fetch will
      // supersede this local-only merge - an acceptable, extremely narrow gap.)
      const old = await sget(OLD_PROFILE, false);
      if (old && old.runs > 0) {
        s = { ...s, runs: s.runs + old.runs, wins: s.wins + (old.wins || 0), losses: s.losses + (old.losses || 0),
          champs: s.champs + (old.champs || 0), perfect: s.perfect + (old.perfect || 0), playoffs: s.playoffs + (old.playoffs || 0),
          bestScore: old.bestScore ?? s.bestScore, bestRun: old.bestRun || s.bestRun,
          bestRecord: old.bestRecord || s.bestRecord, recent: (old.recent || []).slice(0, 10) };
        await sdel(OLD_PROFILE, false);
        notes.push(`${old.runs} earlier season${old.runs > 1 ? "s were" : " was"} added to your account.`);
      }
    }
    setUserId(uid);
    setUser(username);
    // Not closing over the `userId` state here - it hasn't committed yet in this same
    // synchronous pass (setUserId above is async). Use the fresh `uid` directly throughout.
    setStats(s);
    if (pending) {
      const trace = pending;
      setPending(null);
      const res = await submitAndSync(uid, trace);
      if (res.ok) notes.push("Your last season was saved.");
    }
    setNotice(notes.join(" "));
  }

  async function logOut() {
    await authSignOut();
    setUserId(null); setUser(null); setStats(null); setNotice("");
  }

  // pin holds one axis fixed at target's value during the animation - used by reroll() so
  // re-spinning the team doesn't also visibly cycle the years reel, and vice versa. null
  // (a fresh board reveal) spins both.
  function animateTo(target, pin = null) {
    clearInterval(timer.current);
    setSelected(null);
    if (reducedMotion()) { setSpin(target); setDisplay(target); return; }
    setSpinning(true);
    let n = 0;
    timer.current = setInterval(() => {
      n++;
      setDisplay({
        team: pin === "team" ? target.team : pick(TEAM_CODES),
        w: pin === "years" ? target.w : Math.floor(Math.random() * WINDOWS.length),
      });
      if (n >= 14) { clearInterval(timer.current); setSpin(target); setDisplay(target); setSpinning(false); }
    }, 65);
  }

  // An unlimited draft and both formats' dailies can all sit half-finished at once; each keeps
  // its own slot.
  async function refreshWip() {
    const today = todayKey();
    const [f, dFan, dStd] = await Promise.all([
      sget(FREE_PROGRESS, false),
      sget(DAILY_PROGRESS(today, "fantasy"), false),
      sget(DAILY_PROGRESS(today, "standard"), false),
    ]);
    const found = { free: f, "daily:fantasy": dFan, "daily:standard": dStd };
    setWip((w) => {
      const next = { ...w };
      for (const [slot, saved] of Object.entries(found)) {
        if (!pendingClears.current[slot]) next[slot] = validDraft(saved) ? saved.history.length : 0;
      }
      return next;
    });
  }

  function restoreDraft(saved) {
    const r = {};
    saved.history.forEach((h) => { r[h.slot] = findPlayer(h.key, h.id, h.season); });
    setRoster(r); setHistory(saved.history); setUsed(saved.used || []);
    setRerolls(saved.rerolls || { team: REROLL_BUDGET, years: REROLL_BUDGET });
    setMode(saved.mode); setSeq(saved.seq || []); setSeqIdx(saved.seqIdx || 0);
    setSpin(saved.spin); setDisplay(saved.spin); setResult(null); setSelected(null);
    setShown(0); setPo({ idx: 0, stage: "pre" }); setResumed(true);
    setWip((w) => ({ ...w, [slotId(saved.mode)]: saved.history.length }));
  }

  const validDraft = (s) => s && s.spin && s.mode && Array.isArray(s.history) && s.history.length > 0
    && BOARDS[`${s.spin.team}|${s.spin.w}`] && s.history.every((h) => findPlayer(h.key, h.id, h.season));

  // presetRoster (Build-a-player) pre-fills one slot before the sequence is walked, so boardAt
  // correctly treats that position as already spoken for from the very first board.
  function startDraft(m, presetRoster) {
    const fmt = normFormat(m.format);
    // The two formats' dailies are deliberately different drafts, so playing one doesn't spoil
    // the other's boards. Free-mode seeds are unchanged - boards there don't depend on format,
    // and an existing challenge code must keep dealing the same boards it always did.
    const seed = m.kind === "daily" ? `daily-${m.date}${fmtSuffix(fmt)}` : m.code;
    const list = seededSequence(seed);
    const initialRoster = presetRoster || {};
    setMode({ ...m, format: fmt, seed }); setSeq(list);
    setRoster(initialRoster); setHistory([]); setUsed([]); setSelected(null); setResult(null);
    setShown(0); setPo({ idx: 0, stage: "pre" }); setRerolls({ team: REROLL_BUDGET, years: REROLL_BUDGET });
    setPending(null); setNotice(""); setResumed(false); setConfirmReset(false);
    setShare({ state: "idle", text: "" });
    const i = boardAt(list, 0, initialRoster);
    setSeqIdx(i);
    const [t, w] = list[i].split("|");
    animateTo({ team: t, w: Number(w) });
  }

  function advance(r, from) {
    const i = boardAt(seq, from, r);
    if (i < 0) return false;
    setSeqIdx(i);
    const [t, w] = seq[i].split("|");
    animateTo({ team: t, w: Number(w) });
    return true;
  }

  // A re-spin keeps one half of the board fixed and pulls the next matching alternate.
  function reroll(kind) {
    if (!spin || spinning || rerolls[kind] < 1) return;
    const d = new Set(Object.values(roster).map((p) => p.id));
    const o = SLOTS.filter((s) => !roster[s]);
    // Every board already shown OR still queued later in this draft's planned sequence is off
    // the table for a reroll - once a team+years pair is anywhere in the plan, it's used up.
    // (This also rules out reusing an entry from seq's own remaining tail: doing so would
    // insert a second copy without removing the original, so that board would resurface again
    // later when sequential advancement reaches its old spot.) rerollCandidate (game-logic.mjs)
    // mirrors this selection exactly, so a server-side replay can reproduce the same pick.
    const shown = new Set(seq);
    const next = rerollCandidate({ seed: mode.seed, kind, seqIdx, spinTeam: spin.team, spinW: spin.w, shown, drafted: d, open: o });
    if (!next) return;
    const n = [...seq]; n.splice(seqIdx + 1, 0, next);
    setSeq(n); setSeqIdx(seqIdx + 1); setUsed([...used, next]);
    const [t, w] = next.split("|");
    animateTo({ team: t, w: Number(w) }, kind === "team" ? "years" : "team");
    setRerolls({ ...rerolls, [kind]: rerolls[kind] - 1 });
  }

  // keyOverride lets the admin panel force-draft a player from a board other than the one
  // currently spinning, without waiting on setSpin() to commit first.
  function draft(player, slot, keyOverride) {
    const key = keyOverride || `${spin.team}|${spin.w}`;
    const best = bestAvailable(key, [...drafted], open, mode.format);
    // Computed locally (not read back from state) because finish() below needs the complete,
    // up-to-the-final-pick history synchronously - setHistory's update wouldn't land in this
    // render's closure until after this function returns, so finish() would otherwise submit a
    // trace one pick short (replayDraft correctly rejects it as "wrong shape").
    const newHistory = [...history, { key, id: player.id, season: player.season, slot, bestId: best ? best.id : player.id, bestSeason: best ? best.season : player.season }];
    setHistory(newHistory);
    setResumed(false);
    const next = { ...roster, [slot]: player };
    setRoster(next);
    setSelected(null);
    const el = draftTop.current;
    if (el && el.scrollIntoView && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    if (SLOTS.every((s) => next[s])) finish(next, undefined, newHistory);
    else advance(next, seqIdx + 1);
  }

  // forcedScenario (admin-only) skips the real simulation for a scripted ending, and skips
  // every persistence side effect below so testing an animation never touches real stats,
  // the leaderboard, or daily/draft progress. `finishedHistory` is required whenever
  // forcedScenario is falsy (draft()'s one real call site always passes it) - it must be the
  // complete, up-to-the-final-pick history computed locally by the caller, never read back from
  // the `history` state directly here, which is still one render behind on this exact tick.
  function finish(r, forcedScenario, finishedHistory) {
    const fmt = normFormat(mode.format);
    let tot = 0, wt = 0;
    for (const s of SLOTS) { const k = s === "QB" ? QB_WEIGHT : 1; tot += effectiveRating(s, r[s], fmt) * k; wt += k; }
    const score = Math.round((tot / wt) * 10) / 10;
    const lineup = SLOTS.map((s) => `${r[s].id}${r[s].season}`).join("|");
    const sim = forcedScenario ? forceSeason(forcedScenario) : withSeed(`${mode.seed}#${lineup}`, () => simulateSeason(score));
    sim.score = score;
    sim.format = fmt;
    const runRoster = SLOTS.map((s) => ({ slot: s, name: r[s].name, team: r[s].team, season: r[s].season, ppr: r[s].ppr, rating: effectiveRating(s, r[s], fmt) }));
    // Both "best" comparisons are per format - the leaderboard on screen and this profile's best
    // are whichever format was just played, never the other one's numbers.
    const siteBest = scoreOf(lb.top[0], fmt) ?? 0;
    const myBest = scoreOf(stats, fmt);
    // Only claim a sitewide best when the loaded board is for the format just played - otherwise
    // this would be comparing against the other format's numbers.
    sim.newSiteBest = !forcedScenario && !!user && lb.top.length > 0 && normFormat(lb.format) === fmt && score > siteBest;
    sim.newBestScore = !forcedScenario && !!user && !!stats && (myBest == null || score > myBest);
    setNotice("");
    if (!forcedScenario) {
      siteActivity.current?.broadcastDraftFinished();
      if (mode.kind === "daily") {
        const rec = { date: mode.date, format: fmt, w: sim.w, l: sim.l, score, outcome: sim.outcome, roster: runRoster };
        setDailyDone((d) => ({ ...d, [fmt]: rec }));
        sset(DAILY_KEY(mode.date, fmt), rec, false);
      }
      // The client never persists its own computed score/outcome/capUsed directly - submit-run (a
      // Supabase Edge Function) independently replays this exact draft trace and recomputes
      // everything server-side, including capUsed from the verified roster (see game-logic.mjs's
      // replayDraft/simulateSeason/playerSalary). The animation above already rendered from that
      // same shared logic + seed, so an honest client sees identical numbers either way - only a
      // tampered submission is ever rejected.
      // `format` goes top-level only, never inside `mode` - it selects both the daily seed and
      // the scoring formula server-side, and two places it could come from would just be an
      // ambiguity to probe.
      const trace = {
        mode: { kind: mode.kind, seed: mode.seed, code: mode.code, date: mode.date, gm: mode.gm },
        history: finishedHistory, seq, gm: !!mode.gm, format: fmt,
      };
      if (user) submitAndSync(userId, trace);
      else setPending(trace);
      // Point the leaderboard at the format just played before refreshing it, so the rank shown
      // beside this result ranks it against its own format rather than the other one's numbers.
      showBoardFormat(fmt);
      loadLeaderboard(fmt);
      clearDraft(DRAFT_KEY);
      clearDraftTracked(slotId(mode), mode.kind === "daily" ? DAILY_PROGRESS(mode.date, fmt) : FREE_PROGRESS);
      setWip((w) => ({ ...w, [slotId(mode)]: 0 }));
    }
    setShare({ state: "idle", text: "" });
    setResult(sim);
    setPo({ idx: 0, stage: "pre" });
    setShown(reducedMotion() ? sim.games.filter((g) => !g.playoff).length : 0);
  }

  // ---------- Admin testing tools ----------
  const isAdmin = user && user.toLowerCase() === "admin";

  function adminForceBoard(team, w) {
    if (!mode) return;
    const key = `${team}|${w}`;
    if (!BOARDS[key] || !BOARDS[key].length) return;
    const n = [...seq]; n.splice(seqIdx + 1, 0, key);
    setSeq(n); setSeqIdx(seqIdx + 1);
    clearInterval(timer.current);
    setSpinning(false);
    setSelected(null);
    setSpin({ team, w }); setDisplay({ team, w });
  }

  function adminForcePlayer(player, slot) {
    adminForceBoard(player.team, player.w);
    draft(player, slot, `${player.team}|${player.w}`);
  }

  // Fills any still-open slots with the first eligible player found (admin doesn't need a
  // "real" roster to check an ending animation), then jumps straight to the scripted result.
  function adminForceOutcome(scenarioKey) {
    const next = { ...roster };
    const ids = new Set(Object.values(next).map((p) => p.id));
    for (const s of SLOTS) {
      if (next[s]) continue;
      for (const key of Object.keys(BOARDS)) {
        const cand = BOARDS[key].find((p) => !ids.has(p.id) && fits(p.pos, s));
        if (cand) { next[s] = cand; ids.add(cand.id); break; }
      }
    }
    setRoster(next);
    finish(next, scenarioKey);
  }

  useEffect(() => {
    // regular season ticks by quickly; playoff games are played one at a time
    if (!result || shown >= result.games.filter((g) => !g.playoff).length) return;
    const t = setTimeout(() => setShown((s) => s + 1), 90);
    return () => clearTimeout(t);
  }, [result, shown]);

  // Build-a-player's own game-by-game reveal - simpler than the main draft's (no interactive
  // per-round playoff suspense, just a steady tick through every game including playoffs), since
  // this is a standalone what-if, not a real tracked run.
  useEffect(() => {
    if (!bap || bap.stage !== "result" || bap.shown >= bap.sim.games.length) return;
    const t = setTimeout(() => setBap((b) => (b && b.stage === "result" ? { ...b, shown: b.shown + 1 } : b)), 90);
    return () => clearTimeout(t);
  }, [bap]);

  // Ending an unlimited draft early is a DNF; the draft itself is cleared.
  function abandonCurrent() {
    if (mode && mode.kind === "free" && !result && history.length > 0) recordDnf(history.length);
    clearDraftTracked("free", FREE_PROGRESS);
    setWip((w) => ({ ...w, free: 0 }));
  }

  function restart(extra) {
    abandonCurrent();
    clearDraft(DRAFT_KEY);
    setView("play");
    startDraft({ kind: "free", code: newCode(), format, ...extra });
  }

  // Stats O/U: "career" here means the sum of a player's appearances across every board he
  // qualified for (at most one season per team per era window) - a real but partial slice of
  // his career, not his true full stat line, since only qualifying seasons make the boards.
  async function loadSouBoard(date) {
    setSouBoard({ loading: true, rows: [] });
    try {
      const rows = await fetchSouTop(date, 10);
      setSouBoard({ loading: false, rows });
    } catch (e) { setSouBoard({ loading: false, rows: [] }); }
  }

  // Deals round `roundIndex` of today's seeded sequence and starts its 7-second clock ticking -
  // a real wall-clock deadline (Date.now() + 7s), not just a countdown of ticks, so pausing the
  // tab or dev-tools can't stretch the window (resolveSou double-checks the deadline too).
  function startSouRound(date, roundIndex, lives, score) {
    clearInterval(souTimer.current);
    const round = souRoundFor(`sou-${date}`, roundIndex);
    const deadline = Date.now() + SOU_ROUND_SECONDS * 1000;
    setSou({ date, roundIndex, lives, score, round, guess: null, correct: undefined, deadline, timeLeft: SOU_ROUND_SECONDS });
    souTimer.current = setInterval(() => {
      setSou((s) => {
        if (!s || s.guess) return s;
        const left = Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000));
        if (left > 0) return s.timeLeft === left ? s : { ...s, timeLeft: left };
        clearInterval(souTimer.current);
        return { ...s, guess: "timeout", correct: false, timeLeft: 0, lives: s.lives - 1 };
      });
    }, 200);
  }

  // A guess only counts if it lands before the deadline - a click already in flight when time
  // expires is treated as a timeout, not a lucky last-second answer.
  function souGuess(dir) {
    if (!sou || sou.guess) return;
    if (Date.now() > sou.deadline) return; // the timer's own tick will resolve this as a timeout
    clearInterval(souTimer.current);
    const correct = dir === "over" ? sou.round.trueValue > sou.round.line : sou.round.trueValue < sou.round.line;
    setSou({ ...sou, guess: dir, correct, lives: correct ? sou.lives : sou.lives - 1, score: correct ? sou.score + 1 : sou.score });
  }

  // The clock shouldn't start the instant you land on the screen - openSou always stops at a
  // rules/confirm screen first (souIntro); beginSou is what actually deals round one (or
  // resumes) and starts the timer.
  async function openSou() {
    setView("statsou");
    if (souDone) { loadSouBoard(todayKey()); return; }
    const date = todayKey();
    const wip = await sget(SOU_PROGRESS(date), false);
    setSouIntro(wip ? { date, ...wip } : { date, roundIndex: 0, lives: SOU_LIVES, score: 0 });
  }

  function beginSou() {
    const { date, roundIndex, lives, score } = souIntro;
    setSouIntro(null);
    startSouRound(date, roundIndex, lives, score);
  }

  function leaveSou() {
    clearInterval(souTimer.current);
    setSouIntro(null);
    setView("home");
  }

  // Once a round resolves (correct, wrong, or timeout), save progress; once lives run out,
  // finalize the day - write the personal "already played today" record, clear the resumable
  // wip snapshot, and (if logged in) put the score on the shared daily leaderboard. Guests can
  // still play, they just don't appear on the board.
  useEffect(() => {
    if (!sou || !sou.guess) return;
    if (sou.lives > 0) { sset(SOU_PROGRESS(sou.date), { roundIndex: sou.roundIndex, lives: sou.lives, score: sou.score }, false); return; }
    (async () => {
      await sset(SOU_DONE_KEY(sou.date), { score: sou.score }, false);
      await sdel(SOU_PROGRESS(sou.date), false);
      // Wait for the leaderboard write to actually land before re-fetching it, or the read can
      // race ahead of the write and show a board that's missing the score that was just saved.
      if (user && userId) await upsertSouRun(sou.date, userId, { username: user, score: sou.score });
      setSouDone({ score: sou.score });
      loadSouBoard(sou.date);
    })();
  }, [sou]);

  // Build-a-player: you pick the position, then roll real players at that position one at a
  // time so you can take a single attribute from each until every attribute is filled.
  // One roll gives both "which team" and "which active player" at once (a real player only
  // belongs to one team last season), rather than rolling a team first and hoping it has
  // someone at this position in the pool - see bapPool's LAST_SEASON note above.
  // Excludes every player already rolled earlier in this same build, so a 9-attribute build
  // never draws the same real player twice - falls back to allowing a repeat only if a
  // position's whole last-season pool has somehow already been exhausted.
  function rollBapPair(pos, seenIds = []) {
    const pool = bapPool(pos);
    if (!pool.length) return null;
    const fresh = pool.filter((p) => !seenIds.includes(p.id));
    const candidates = fresh.length ? fresh : pool;
    const player = candidates[Math.floor(Math.random() * candidates.length)];
    return { team: player.team, player };
  }

  function openBuildPicker() {
    setView("buildplayer");
    setBap({ stage: "pickpos" });
  }

  // Clears any in-flight roll animation timer before leaving, so a pending tick can't land
  // after Cancel and resurrect a build the user just backed out of.
  function cancelBap() {
    clearTimeout(bapTimer.current);
    setBap(null);
    setView("home");
  }

  // Team spins first, then the player who plays that position for them - same "reel settles"
  // feel as the main draft's team+era spin, but on its own timer ref so it can never collide
  // with an in-progress normal draft's animation.
  // Ticks get slower on approach (a real wheel decelerating, not a flat-speed flicker) so
  // landing on the team, then the player, each reads as a distinct beat instead of a blur -
  // recursive setTimeout rather than setInterval, since each tick's delay is different.
  const BAP_TEAM_DELAYS = [60, 70, 85, 100, 120, 145, 175, 210, 250, 300];
  const BAP_TEAM_HOLD = 650;
  const BAP_PLAYER_DELAYS = [60, 75, 95, 120, 150, 185, 225, 270];
  const BAP_PLAYER_HOLD = 550;
  function rollBapRound(pos, filled, remaining, seen) {
    const final = rollBapPair(pos, seen);
    clearTimeout(bapTimer.current);
    if (!final || reducedMotion()) { setBap({ stage: "build", pos, filled, remaining, seen: [...seen, final.player.id], ...final }); return; }
    // The player-phase flicker only cycles through candidates who actually play THIS position
    // for the team just rolled - showing some other team's QB while "Texans" sits above it
    // would read as a mistake, not a spin. Draw from every era that team has had at this
    // position (teamPosPlayers), not just last season - almost every team's had more than one
    // real name here across the years, so the flicker has more than a single name to bounce
    // between even though the actual pick is still last-season-only.
    const playerPool = teamPosPlayers(final.team, pos);
    setBap({ stage: "rolling", pos, filled, remaining, seen, spinPhase: "team", displayTeam: TEAM_CODES[Math.floor(Math.random() * TEAM_CODES.length)] });

    const stepPlayer = (i) => {
      if (i >= BAP_PLAYER_DELAYS.length) {
        setBap((b) => ({ ...b, spinPhase: "player", displayPlayer: final.player.name }));
        bapTimer.current = setTimeout(() => setBap({ stage: "build", pos, filled, remaining, seen: [...seen, final.player.id], ...final }), BAP_PLAYER_HOLD);
        return;
      }
      bapTimer.current = setTimeout(() => {
        setBap((b) => ({ ...b, spinPhase: "player", displayPlayer: playerPool[Math.floor(Math.random() * playerPool.length)].name }));
        stepPlayer(i + 1);
      }, BAP_PLAYER_DELAYS[i]);
    };
    const stepTeam = (i) => {
      if (i >= BAP_TEAM_DELAYS.length) {
        setBap((b) => ({ ...b, displayTeam: final.team }));
        bapTimer.current = setTimeout(() => stepPlayer(0), BAP_TEAM_HOLD);
        return;
      }
      bapTimer.current = setTimeout(() => {
        setBap((b) => ({ ...b, displayTeam: TEAM_CODES[Math.floor(Math.random() * TEAM_CODES.length)] }));
        stepTeam(i + 1);
      }, BAP_TEAM_DELAYS[i]);
    };
    stepTeam(0);
  }

  function pickBapPos(pos) {
    rollBapRound(pos, {}, BAP_ATTRS[pos].map(([k]) => k), []);
  }

  function pickBapAttr(key) {
    const def = BAP_ATTRS[bap.pos].find(([k]) => k === key);
    const filled = { ...bap.filled, [key]: { score: def[3](bap.player), fromName: bap.player.name, fromTeam: bap.team, fromSeason: bap.player.season } };
    const remaining = bap.remaining.filter((k) => k !== key);
    if (!remaining.length) {
      setBap({ stage: "done", pos: bap.pos, filled });
      // Sitewide-only tally for the Stats screen's "created players" count and highest-OVR
      // leaderboard - doesn't touch this account's own stats/leaderboard position (see
      // playBapSim's comment below for Build-a-player's stat-free promise), and only for
      // logged-in users, matching the existing daily/sou_runs convention.
      if (user && userId) logBuild(userId, { username: user, pos: bap.pos, overall: bapOverallScore(filled), filled });
      return;
    }
    rollBapRound(bap.pos, filled, remaining, bap.seen);
  }

  // Build-a-player stands apart from every other mode: no roster, no draft, and this result
  // never touches stats or the leaderboard - it's a standalone "what if" answer, not a real run.
  // Roll any real team-season (any year - the same OPPS pool the normal sim draws opponents
  // from, not last-season-only like the build itself) and see if swapping your build in at his
  // position would have helped them win it all.
  function playBapSim() {
    const customScore = bapOverallScore(bap.filled);
    const opp = OPPS[Math.floor(Math.random() * OPPS.length)];
    // The same fractional share of team score this position carries in a real 6-man roster
    // (QB is weighted higher - see QB_WEIGHT) - swapping in one player should only nudge an
    // otherwise-unmodeled real team's rating, not replace it outright.
    const totalWeight = SLOTS.reduce((t, s) => t + (s === "QB" ? QB_WEIGHT : 1), 0);
    const share = (bap.pos === "QB" ? QB_WEIGHT : 1) / totalWeight;
    const BASELINE = 80; // scaleStat's own midpoint (a roughly average real starter) - see BAP_ATTRS above
    // opp.rec is a display-only figure (shown next to an opponent's name in the UI, see
    // tagOpp/oppRec) - NOT a team-strength rating. opp.reg is the actual same-scale-as-score
    // rating gameResult()/simulateSeason() use for every other opponent in the game; using rec
    // here instead was a real bug (a near-guaranteed 0-17, regardless of the build - rec's
    // numeric range isn't remotely the same scale winProb()/SPREAD expect).
    const adjustedScore = opp.reg + (customScore - BASELINE) * share;
    const sim = simulateSeason(adjustedScore);
    setBap({ stage: "result", pos: bap.pos, filled: bap.filled, opp, sim, shown: reducedMotion() ? sim.games.length : 0 });
  }

  // Today's daily always picks up where it left off: you get one run at it, not one per visit.
  // Each format has its own daily (different seed, different boards), so every check here is
  // per-format - without that, opening one while the other is in progress would no-op or resume
  // the wrong draft.
  async function startDaily(f) {
    const fmt = normFormat(f ?? format);
    setFormat(fmt);
    sset(FORMAT_KEY, fmt, false);
    setView("play");
    const d = todayKey();
    const done = dailyDone[fmt];
    if (mode && mode.kind === "daily" && mode.date === d && normFormat(mode.format) === fmt && !done) return;
    const saved = await sget(DAILY_PROGRESS(d, fmt), false);
    if (!done && validDraft(saved) && saved.mode.date === d && normFormat(saved.mode.format) === fmt) { restoreDraft(saved); return; }
    startDraft({ kind: "daily", date: d, code: `DAILY-${d}`, format: fmt });
  }

  // Unlimited: pick up the half-finished one if there is one, otherwise deal a fresh board.
  // Genius/GM mode are the same free-draft slot with a flag that changes how it's played - but
  // tapping a variant that doesn't match what's actually saved there (e.g. a Genius draft is
  // half-finished and you tap GM mode) must not silently resume it under the wrong flags. Treat
  // that as abandoning the old variant (a DNF, same as any other abandoned unlimited draft) and
  // dealing a fresh board in the variant actually requested.
  async function openFree(extra) {
    setView("play");
    // The scoring format is part of the variant: resuming a full-PPR draft under standard scoring
    // (or the reverse) would grade it by rules it wasn't drafted under.
    const want = { ...extra, format: normFormat(extra?.format ?? format) };
    const sameVariant = (m) => !!m?.genius === !!want.genius && !!m?.gm === !!want.gm
      && normFormat(m?.format) === want.format;
    if (mode && mode.kind === "free" && sameVariant(mode) && !result && history.length > 0) return;
    const saved = await sget(FREE_PROGRESS, false);
    if (validDraft(saved) && saved.mode.kind === "free") {
      if (sameVariant(saved.mode)) { restoreDraft(saved); return; }
      // Use the saved history length (not live state) so the DNF is recorded correctly even if
      // this draft was started in an earlier session and never loaded back into memory.
      recordDnf(saved.history.length);
      clearDraftTracked("free", FREE_PROGRESS);
      setWip((w) => ({ ...w, free: 0 }));
    }
    clearDraft(DRAFT_KEY);
    startDraft({ kind: "free", code: newCode(), ...want });
  }

  function startCode(raw) {
    const code = (raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (code.length < 4) return;
    abandonCurrent();
    clearDraft(DRAFT_KEY);
    setCodeInput("");
    setView("play");
    // Carries the current format, so entering a code while Championship is selected doesn't
    // silently drop you back into full-PPR scoring.
    startDraft({ kind: "free", code, format });
  }

  async function loadDailyBoard(f) {
    const fmt = normFormat(f || boardFormatRef.current);
    setDailyBoard({ loading: true, rows: [], format: fmt });
    try {
      const rows = await fetchDailyTop(todayKey(), 10, fmt);
      setDailyBoard({ loading: false, rows, format: fmt });
    } catch (e) { setDailyBoard({ loading: false, rows: [], format: fmt }); }
  }

  // Two taps to reset, so a stray tap can't wipe out a draft
  function resetDraft() {
    if (mode && mode.kind === "daily") return;
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3500);
      return;
    }
    setConfirmReset(false);
    recordDnf(history.length);
    restart();
  }

  function closeHowTo() { setHowTo(false); sset(HOWTO_KEY, true, false); }

  async function doShare() {
    const text = shareText(result, roster, place, mode);
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ text });
        setShare({ state: "shared", text }); return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try {
      await navigator.clipboard.writeText(text);
      setShare({ state: "copied", text });
      setTimeout(() => setShare((s) => (s.state === "copied" ? { ...s, state: "idle" } : s)), 2500);
    } catch (e) {
      setShare({ state: "manual", text }); // clipboard blocked: show the text to copy by hand
    }
  }

  // ---------- Derived ----------
  const board = spin ? BOARDS[`${spin.team}|${spin.w}`] : [];
  const pickNo = SLOTS.length - open.length + 1;
  const disp = display || spin;
  const selSlots = selected ? open.filter((s) => fits(selected.pos, s)) : [];
  // 0 = its own slot is open, 1 = own slot filled but Flex still open, 2 = nowhere left to put them
  const secState = (pos) => (!roster[pos] ? 0 : open.some((s) => fits(pos, s)) ? 1 : 2);

  // Always paired: the rows and the accessor that reads them must describe the same format.
  const lbFormat = normFormat(lb.format);
  const siteBest = lb.top[0];
  const totals = lb.totals;
  const perfectPct = totals.runs > 0 ? Math.round((100 * totals.perfect) / totals.runs) : 0;
  const site = useMemo(() => computeSiteStats(siteStats.profiles), [siteStats.profiles]);
  // The score-ranked half of the Stats screen, for whichever format is selected there.
  const fmtStats = site.byFormat[normFormat(boardFormat)];
  const myKey = user ? user.toLowerCase() : null;
  const myRank = lb.myRank;
  const regGames = result ? result.games.filter((g) => !g.playoff) : [];
  const poGames = result ? result.games.filter((g) => g.playoff) : [];
  const inPlayoffs = !!result && shown >= regGames.length && poGames.length > 0 && po.stage !== "done";
  const finished = !!result && shown >= result.games.length && !inPlayoffs;
  const regW = regGames.filter((g) => g.win).length;
  const inProgress = !!mode && !result && history.length > 0 && history.length < 6;
  const freePicks = (mode && mode.kind === "free" && !result ? history.length : wip.free) || 0;
  // Per format, since both dailies can be part-finished at the same time.
  const dailyPicksFor = (f) => (dailyDone[f] ? 0
    : ((mode && mode.kind === "daily" && mode.date === todayKey() && normFormat(mode.format) === f && !result
      ? history.length : wip[`daily:${f}`]) || 0));
  // The finished record for the daily currently open, if that's what this is - and the format
  // whose daily is still available to offer next.
  const modeDailyDone = mode && mode.kind === "daily" ? dailyDone[normFormat(mode.format)] : null;
  const otherFormat = mode && normFormat(mode.format) === "standard" ? "fantasy" : "standard";
  // Ranks this run against everyone's BEST-ever score (via myRank, already refreshed by the
  // loadLeaderboard() call in finish()) rather than against every run ever played - a real
  // per-run leaderboard would need a full runs log table this schema doesn't have. For a new
  // personal best this is exactly right; for a non-best run it shows the existing best's rank.
  // Only rank a result against a leaderboard loaded for its OWN format - the two score different
  // things, so a cross-format rank would be meaningless rather than merely imprecise.
  const place = finished && !lb.error && myRank >= 0 && normFormat(result?.format) === lbFormat
    ? { rank: myRank + 1, total: totals.players } : null;
  function skipPlayoffs() { setShown(result.games.length); setPo({ idx: 0, stage: "done" }); }

  return (
    <div className="ps">
      <style>{CSS}</style>
      <div className="wrap">
        <nav className="nav" aria-label="Sections">
          {[["home", "Modes"], ["play", "Draft"], ["profile", user ? "Profile" : "Account"], ["players", "Players"], ["board", "Leaderboard"], ["stats", "Stats"]].map(([k, l]) => (
            <button key={k} className={`tab ${view === k ? "on" : ""}`} aria-current={view === k ? "page" : undefined}
              onClick={() => { setView(k); if (k === "home") refreshWip(); if (k === "board") { loadLeaderboard(); loadDailyBoard(); } if (k === "stats" && !siteStats.loaded) loadSiteStats(); }}>
              {l}{k === "play" && view !== "play" && mode && open.length < 6 && !result && <span className="dot" aria-label="Draft in progress" />}
            </button>
          ))}
          <div className="hdr-links">
            <button className="linkbtn" onClick={() => setHowTo(true)}>How to play</button>
            {!user && authReady && <button className="linkbtn" onClick={() => setView("profile")}>Log in</button>}
            {user && <span className="whoami">{user}</span>}
          </div>
        </nav>

        {saveError && <div className="panel"><p style={{ margin: 0 }}>Your last season couldn't be saved. It will be included the next time a save goes through.</p></div>}
        {notice && <div className="panel"><p style={{ margin: 0 }}>{notice}</p></div>}
        {howTo && <HowTo onClose={closeHowTo} />}
        {resumed && view === "play" && !result && (
          <div className="notice"><span>Picked up your draft where you left off.</span></div>
        )}

        {/* ---------------- HOME ---------------- */}
        {view === "home" && (
          <>
            <header className="hero">
              <div className="brand">
                <svg width="52" height="52" viewBox="0 0 48 48" aria-hidden="true">
                  <ellipse cx="24" cy="24" rx="21" ry="13" transform="rotate(-35 24 24)" fill="#F7B32B" />
                  <ellipse cx="24" cy="24" rx="21" ry="13" transform="rotate(-35 24 24)" fill="none" stroke="#14161B" strokeOpacity=".35" strokeWidth="1.5" />
                  <g transform="rotate(-35 24 24)" stroke="#14161B" strokeWidth="2.2" strokeLinecap="round">
                    <line x1="15" y1="24" x2="33" y2="24" />
                    <line x1="18" y1="21" x2="18" y2="27" /><line x1="22" y1="21" x2="22" y2="27" /><line x1="26" y1="21" x2="26" y2="27" /><line x1="30" y1="21" x2="30" y2="27" />
                  </g>
                </svg>
                <h1 className="title">Perfect Season</h1>
              </div>
              <p className="sub">Draft six players from random teams and eras. The stats are real, the fantasy points are hidden, and your lineup plays a full season against real NFL teams. Win all 20 and you've gone perfect.</p>
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {online != null && <span className="pill">🟢 {online} online now</span>}
                {liveDrafts != null && (
                  <button className="pill" style={{ border: "none", cursor: "pointer" }}
                    onClick={() => { setView("stats"); if (!siteStats.loaded) loadSiteStats(); }}>🏈 {liveDrafts.toLocaleString()} drafts</button>
                )}
              </div>
            </header>

            {/* Scoring format is a preference that layers over every mode below, not a mode of
                its own - otherwise each tile would need a Fantasy and a Championship twin. */}
            <div className="fmtpick" role="group" aria-label="Scoring format">
              <span className="fmtlabel">Scoring</span>
              {FORMATS.map((f) => (
                <button key={f} className={`fmtbtn ${format === f ? "on" : ""}`} aria-pressed={format === f}
                  onClick={() => { setFormat(f); sset(FORMAT_KEY, f, false); }}>
                  {FORMAT_LABEL[f]}<span className="fmtsub">{f === "fantasy" ? "Full PPR" : "Standard"}</span>
                </button>
              ))}
              <p className="fmtnote">
                {format === "standard"
                  ? "Championship scoring counts yards and touchdowns only - a catch is worth nothing on its own, so high-volume possession receivers grade lower and big-play producers grade higher. Closer to what wins games than to what wins a fantasy league."
                  : "Fantasy scoring is full PPR: every reception is worth a point, so target volume counts as much as yardage."}
              </p>
            </div>

            <div className="modes">
              {/* The only tile with two CTAs: both formats' dailies are live at once, each its
                  own draft with its own boards, so one button can't express both states. */}
              <div className="mode daily static">
                <div className="mt">
                  <span className="icon" aria-hidden="true">📅</span>
                  <span className="mn">Daily challenge</span>
                  {stats?.dailyStreak && stats.dailyLast === todayKey() ? <span className="pill">{stats.dailyStreak} day streak</span> : null}
                </div>
                <p>The same six boards for everyone, one draft a day, no resets. {prettyDate(todayKey())}. Each scoring format has its own daily.</p>
                <div className="dailycta">
                  {FORMATS.map((f) => {
                    const picks = dailyPicksFor(f);
                    return (
                      <button key={f} className="btn" onClick={() => startDaily(f)}>
                        {FORMAT_LABEL[f]} daily
                        <span className="go" style={{ marginLeft: 8 }}>
                          {dailyDone[f] ? "See result" : picks > 0 ? `${picks} of 6` : "Play"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button className="mode m-unlimited" onClick={() => openFree()}>
                <div className="mt">
                  <span className="icon" aria-hidden="true">♾️</span>
                  <span className="mn">Unlimited</span>{freePicks > 0 && <span className="pill">{freePicks} of 6 picked</span>}
                </div>
                <p>Draft as many teams as you like. Random boards every time, resets allowed.</p>
                <span className="go">{freePicks > 0 ? "Back to your draft" : "Start a draft"}</span>
              </button>

              <button className="mode m-genius" onClick={() => openFree({ genius: true })}>
                <div className="mt"><span className="icon" aria-hidden="true">🧠</span><span className="mn">Genius mode</span></div>
                <p>Same draft, no stats shown. Just name, team, and year - know your football. Shares your Unlimited progress slot.</p>
                <span className="go">Start a draft</span>
              </button>

              <button className="mode m-gm" onClick={() => openFree({ gm: true })}>
                <div className="mt"><span className="icon" aria-hidden="true">💼</span><span className="mn">GM mode</span></div>
                <p>Draft against a ${GM_CAP}M salary cap. Elite seasons cost a lot more. Shares your Unlimited progress slot.</p>
                <span className="go">Start a draft</span>
              </button>

              <button className="mode m-sou" onClick={openSou}>
                <div className="mt">
                  <span className="icon" aria-hidden="true">📊</span>
                  <span className="mn">Over/Under</span>{souDone && <span className="pill">Done · {souDone.score}</span>}
                </div>
                <p>One shared daily set, {SOU_ROUND_SECONDS}s a guess, three lives - how many can you get right today?</p>
                <span className="go">{souDone ? "See today's result" : "Play"}</span>
              </button>

              <button className="mode m-bap" onClick={openBuildPicker}>
                <div className="mt"><span className="icon" aria-hidden="true">🧩</span><span className="mn">Build-a-player</span></div>
                <p>Roll a team, roll their active player, and take one attribute from each until your build is complete - then see if he'd have won a real team the chip.</p>
                <span className="go">Play</span>
              </button>

              <div className="mode static">
                <div className="mt"><span className="icon" aria-hidden="true">🔗</span><span className="mn">Challenge a friend</span></div>
                <p>Enter a code to draft the exact same boards someone else had.</p>
                <div className="frow">
                  <input className="inp" value={codeInput} maxLength={8} placeholder="Code, e.g. K3F9QZ" aria-label="Challenge code"
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && startCode(codeInput)} />
                  <button className="btn solid" disabled={codeInput.trim().length < 4} onClick={() => startCode(codeInput)}>Draft it</button>
                </div>
              </div>
            </div>

            <div className="hometiles">
              <div className="tile"><div className="n">{user && stats ? draftsOf(stats) : "–"}</div><div className="l">Your drafts</div></div>
              <div className="tile"><div className="n">{user && stats?.bestRecord ? `${stats.bestRecord.w}–${stats.bestRecord.l}` : "–"}</div><div className="l">Your best record</div></div>
              <div className="tile"><div className="n">{scoreOf(siteBest, lbFormat) != null ? scoreOf(siteBest, lbFormat).toFixed(1) : "–"}</div><div className="l">Best {FORMAT_LABEL[lbFormat]} score sitewide</div></div>
            </div>

            {!lb.loading && totals.players > 0 && (
              <div className="panel" style={{ marginTop: 14 }}>
                <h3 style={{ marginTop: 0 }}>Sitewide</h3>
                <div className="hometiles">
                  <div className="tile"><div className="n">{totals.runs.toLocaleString()}</div><div className="l">Drafts played</div></div>
                  <div className="tile"><div className="n">{totals.players.toLocaleString()}</div><div className="l">Players</div></div>
                  <div className="tile"><div className="n">{totals.perfect.toLocaleString()}</div><div className="l">Perfect seasons</div></div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--muted)", marginBottom: 4 }}>
                    <span>Drafts that went 20–0</span><span>{perfectPct}%</span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.max(perfectPct, totals.perfect > 0 ? 2 : 0)}%`, background: "var(--lamp)", borderRadius: 4 }} />
                  </div>
                </div>
              </div>
            )}
            {!user && authReady && (
              <p className="note">Playing as a guest. <button className="linkbtn" onClick={() => setView("profile")}>Log in or create an account</button> to save your drafts, keep a daily streak, and get on the leaderboard.</p>
            )}
          </>
        )}

        {/* ---------------- PLAY ---------------- */}
        {view === "play" && !mode && (
          <div className="locked">
            <h3>No draft going right now</h3>
            <p className="note" style={{ marginTop: 0 }}>Pick a mode to start one.</p>
            <div className="frow" style={{ marginTop: 10 }}>
              <button className="btn solid" onClick={startDaily}>Play today's daily</button>
              <button className="btn" onClick={() => openFree()}>Unlimited draft</button>
            </div>
          </div>
        )}

        {view === "play" && mode && (
          <>
            {mode && (
              <div className="modebar">
                <button className={`mb ${mode.kind === "free" ? "on" : ""}`} onClick={() => mode.kind !== "free" && restart()}>Unlimited</button>
                <button className={`mb ${mode.kind === "daily" ? "on" : ""}`} onClick={() => mode.kind !== "daily" && startDaily()}>
                  Daily{stats?.dailyStreak && stats.dailyLast === todayKey() ? ` · ${stats.dailyStreak}🔥` : ""}
                </button>
                <button className="mb" onClick={() => { refreshWip(); setView("home"); }}>All modes</button>
                {mode.kind === "daily" ? (
                  <span className="seedline">{FORMAT_LABEL[normFormat(mode.format)]} · {prettyDate(mode.date)} · same boards for everyone</span>
                ) : (
                  <span className="seedline">{normFormat(mode.format) === "standard" && "Championship · "}{mode.genius && "Genius mode · "}{mode.gm && "GM mode · "}Code <code>{mode.code}</code></span>
                )}
              </div>
            )}

            {isAdmin && mode && !result && (
              <AdminPanel openSlots={open} onForceBoard={adminForceBoard} onForcePlayer={adminForcePlayer} onForceOutcome={adminForceOutcome} />
            )}

            {modeDailyDone && !result && (
              <div className="locked">
                <h3>Today's {FORMAT_LABEL[normFormat(mode.format)]} daily is done</h3>
                <p className="note" style={{ marginTop: 0 }}>You went {modeDailyDone.w}–{modeDailyDone.l} with a team score of {modeDailyDone.score.toFixed(1)}. {modeDailyDone.outcome}.</p>
                <RosterRows roster={modeDailyDone.roster} />
                <div className="frow" style={{ marginTop: 12 }}>
                  {!dailyDone[otherFormat] && (
                    <button className="btn solid" onClick={() => startDaily(otherFormat)}>Play the {FORMAT_LABEL[otherFormat]} daily</button>
                  )}
                  <button className="btn" onClick={restart}>Play an unlimited draft</button>
                  <button className="btn" onClick={() => { setView("board"); loadLeaderboard(); loadDailyBoard(); }}>Today's leaderboard</button>
                </div>
              </div>
            )}

            {!(modeDailyDone && !result) && (
            <>
            {mode.gm && !result && (
              <div className="frow" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Salary cap</span>
                <span style={{ fontWeight: 700, color: capRemaining < 0 ? "var(--loss)" : "var(--ink)" }}>${capUsed}M / ${GM_CAP}M</span>
              </div>
            )}
            <div className="roster" aria-label="Your roster" ref={draftTop} style={{ scrollMarginTop: 12 }}>
              {SLOTS.map((s) => {
                const p = roster[s];
                const target = selSlots.includes(s);
                return (
                  <button key={s} className={`slot pos-${s.startsWith("FLEX") ? "FLEX" : s} ${p ? "filled" : ""} ${target ? "target" : ""}`}
                    disabled={!target} onClick={() => target && draft(selected, s)}
                    aria-label={p ? `${SLOT_LABEL[s]}: ${p.name}` : target ? `Draft ${selected.name} to ${SLOT_LABEL[s]}` : `${SLOT_LABEL[s]} open`}>
                    <div className="k">{SLOT_LABEL[s]}</div>
                    <div className="v">{p ? p.name : target ? "Draft here" : <span style={{ color: "var(--muted)", fontWeight: 400 }}>Open</span>}</div>
                    {p && <div className="sub">{shortYr(p.season)} {TEAMS[p.team][0]}{s.startsWith("FLEX") ? `, ${p.pos}` : ""}</div>}
                  </button>
                );
              })}
            </div>

            {!result && disp && (
              <>
                <div className={`sticky ${stuck ? "show" : ""}`} aria-hidden={!stuck} style={teamVars(disp.team)}>
                  <div className="in">
                    <div className="stripe" style={{ background: TEAMS[disp.team][2] }} />
                    <span className="tm">{TEAMS[disp.team][0]}</span>
                    <span className="yr">{WINDOWS[disp.w][0]}–{WINDOWS[disp.w][1]}</span>
                    <span className="pk">Pick {pickNo} of 6</span>
                    <span className="brk" />
                    <div className="chips">
                      {SLOTS.map((s) => <span key={s} className={`chip pos-${s.startsWith("FLEX") ? "FLEX" : s} ${roster[s] ? "on" : ""}`} title={roster[s] ? roster[s].name : `${SLOT_LABEL[s]} open`}>{s.startsWith("FLEX") ? "FX" : s}</span>)}
                    </div>
                    <div className="sp">
                      <button className="btn sm" tabIndex={stuck ? 0 : -1} disabled={spinning || rerolls.team < 1} onClick={() => reroll("team")}>Re-spin team ({rerolls.team})</button>
                      <button className="btn sm" tabIndex={stuck ? 0 : -1} disabled={spinning || rerolls.years < 1} onClick={() => reroll("years")}>Re-spin years ({rerolls.years})</button>
                    </div>
                  </div>
                </div>
                <div className={`reel ${spinning ? "spin" : ""}`} aria-live="polite" style={teamVars(disp.team)}>
                  <div className="stripe" style={{ background: TEAMS[disp.team][2] }} />
                  <div className="pickno"><span>Pick {pickNo} of 6</span><span>{spinning ? "Spinning" : `${board.length} players on the board`}</span></div>
                  <div className="team">{TEAMS[disp.team][0]}</div>
                  <div><span className="years led-wrap"><span className="led">{WINDOWS[disp.w][0]}–{WINDOWS[disp.w][1]}</span></span>{cityRange(disp.team, disp.w) && <span className="city">{cityRange(disp.team, disp.w)}</span>}</div>
                </div>
                <div className="rerolls">
                  <button className="btn" disabled={spinning || rerolls.team < 1} onClick={() => reroll("team")}>Re-spin team ({rerolls.team} left)</button>
                  <button className="btn" disabled={spinning || rerolls.years < 1} onClick={() => reroll("years")}>Re-spin years ({rerolls.years} left)</button>
                  {mode.kind === "daily" ? (
                    <span className="note" style={{ marginLeft: "auto", alignSelf: "center" }}>One shot. No resets on the daily.</span>
                  ) : (
                    <button className={`btn reset ${confirmReset ? "armed" : ""}`} disabled={spinning} onClick={resetDraft}>
                      {confirmReset ? (user ? "Tap again: counts as a DNF" : "Tap again to reset") : "Reset draft"}
                    </button>
                  )}
                </div>
                <div ref={sentinel} aria-hidden="true" />

                {/* Only a truly-done position (state 2) sinks to the bottom - a filled named
                    slot that's still flex-eligible (state 1) stays put next to open ones. */}
                {!spinning && [...POS].sort((a, b) => (secState(a) === 2 ? 1 : 0) - (secState(b) === 2 ? 1 : 0)).map((pos) => {
                  const list = board.filter((p) => p.pos === pos);
                  if (!list.length) return null;
                  const st = secState(pos);
                  const collapsed = st === 2 && !showDone[pos];
                  return (
                    <section className={`sec pos-${pos} ${st === 2 ? "done" : ""}`} key={pos}>
                      <div className="hd">
                        <h3>{POS_NAME[pos]}</h3>
                        {st === 1 && <span className="nt">{pos} spot filled. These players can still go to Flex.</span>}
                        {st === 2 && (
                          <button className="linkbtn" onClick={() => setShowDone({ ...showDone, [pos]: !showDone[pos] })}>
                            {collapsed ? `Spot filled. Show ${list.length} player${list.length > 1 ? "s" : ""}` : "Hide"}
                          </button>
                        )}
                      </div>
                      {!collapsed && list.map((p) => {
                        const slotsFor = open.filter((s) => fits(p.pos, s));
                        const off = drafted.has(p.id) || !slotsFor.length;
                        const isSel = selected && selected.id === p.id && selected.season === p.season;
                        return (
                          <div key={`${p.id}-${p.season}`} className={`card ${isSel ? "sel" : ""} ${off ? "off" : ""}`}>
                            <button className="hit" disabled={off} onClick={() => setSelected(isSel ? null : p)} aria-expanded={isSel}>
                              <div className="row">
                                <div>
                                  <div className="nm-row">
                                    <span className="pp">{p.pos}</span><span className="nm">{p.name}</span>
                                    {mode.gm && (
                                      <span className="pill" style={{ marginLeft: 8, color: playerSalary(p, mode.format) > capRemaining ? "var(--loss)" : undefined }}>
                                        ${playerSalary(p, mode.format)}M
                                      </span>
                                    )}
                                  </div>
                                  <div className="meta"><span className="tdot" style={teamVars(p.team)} />{p.season} {teamLabel(p.team, p.season)}, {p.g} games{drafted.has(p.id) ? ", already on your roster" : !slotsFor.length ? ", no open slot" : ""}</div>
                                </div>
                                {!mode.genius && (
                                  <div className="cells">
                                    {statCells(p).map(([n, l]) => (<div className="cell" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>))}
                                  </div>
                                )}
                              </div>
                            </button>
                            {isSel && (
                              <div className="drafts">
                                {slotsFor.map((s) => {
                                  const cost = mode.gm ? playerSalary(p, mode.format) : 0;
                                  const tooExpensive = mode.gm && cost > capRemaining;
                                  return (
                                    <button key={s} className="btn solid" disabled={tooExpensive} onClick={() => draft(p, s)}>
                                      Draft to {SLOT_LABEL[s]}{mode.gm && ` - $${cost}M${tooExpensive ? " (over cap)" : ""}`}
                                    </button>
                                  );
                                })}
                                <button className="btn" onClick={() => setSelected(null)}>Cancel</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </section>
                  );
                })}
              </>
            )}

            {result && (
              <>
                {finished && (result.perfect || result.champ) && (
                  <div className={`cel ${result.perfect ? "perfect" : ""}`}>
                    <Confetti n={result.perfect ? 34 : 22} />
                    <div className="big">{result.perfect ? "20–0" : "Champions"}</div>
                    <div className="sml">{result.perfect ? "A perfect season. Nobody touched you." : `You won it all at ${result.w}–${result.l}.`}</div>
                  </div>
                )}
                <div className="result-hero" aria-live="polite">
                  <div className="rec led-wrap"><span className="led">
                    {result.games.slice(0, shown).filter((g) => g.win).length}–{result.games.slice(0, shown).filter((g) => !g.win).length}
                  </span></div>
                  <div className="outcome">{finished ? result.outcome : inPlayoffs ? "Playoffs" : "Playing the season…"}</div>
                  <div className="rating">Team score {result.score.toFixed(1)}</div>
                  {finished && (
                    <div className="place">
                      {lb.loading && !place ? "Ranking your season…" : place && (
                        <>
                          <b>#{place.rank.toLocaleString()}</b> of {place.total.toLocaleString()} season{place.total === 1 ? "" : "s"} played sitewide
                          <span className="pct">{place.rank === 1 ? "Best ever" : topPct(place.rank, place.total)}</span>
                        </>
                      )}
                    </div>
                  )}
                  {finished && (
                    <div>
                      {result.newSiteBest && <span className="badge">New sitewide best score</span>}
                      {result.newBestScore && !result.newSiteBest && <span className="badge">New personal best score</span>}
                    </div>
                  )}
                </div>

                {inPlayoffs && po.stage === "pre" && (
                  <div className="pre">
                    <h3>You're in the playoffs</h3>
                    <p>{regW}–{regGames.length - regW} in the regular season. {poGames[0].label === "Divisional" ? "That earns the top seed and a first-round bye." : "You're in as a wild card, so it's four wins to a title."}</p>
                    <div className="frow">
                      <button className="btn solid" onClick={() => setPo({ idx: 0, stage: "live" })}>Kick off the {poGames[0].label} round vs the {poGames[0].opp}</button>
                      <button className="linkbtn" onClick={skipPlayoffs}>Skip to the result</button>
                    </div>
                  </div>
                )}
                {inPlayoffs && po.stage === "live" && (
                  <PlayoffGame key={po.idx} game={poGames[po.idx]} roster={roster} instant={reducedMotion()}
                    onFinal={() => setShown((s) => s + 1)}
                    footer={po.idx < poGames.length - 1
                      ? <button className="btn solid" onClick={() => setPo({ idx: po.idx + 1, stage: "live" })}>Play the {poGames[po.idx + 1].label} round</button>
                      : <button className="btn solid" onClick={() => setPo({ idx: po.idx, stage: "done" })}>See your season</button>} />
                )}

                {finished && !user && pending && (
                  <AuthPanel onAuthed={onAuthed} title="Save this season"
                    blurb="Log in or create an account to keep this season in your stats and put your score on the leaderboard." />
                )}

                <h2 className="h">Season</h2>
                <div className="log">
                  {result.games.slice(0, shown).map((g, i) => (
                    <div key={i} className={`g ${g.win ? "win" : "loss"} ${g.playoff ? "po" : ""}`}>
                      <div className="o">{g.label}</div>
                      <div className="w">{g.win ? "W" : "L"} {g.us}–{g.them}</div>
                      <div className="o">{g.playoff || g.home ? "vs" : "at"} {g.opp}</div>
                    </div>
                  ))}
                </div>

                {finished && (
                  <>
                    <h2 className="h">Your roster, graded</h2>
                    <RosterRows roster={SLOTS.map((s) => ({ slot: s, ...roster[s], rating: effectiveRating(s, roster[s], mode.format) }))} />
                    <p className="note">Grades compare each season to the top finishers at that position in the same era, with 17-game seasons scaled to 16. {normFormat(mode.format) === "standard" ? "Championship scoring counts yards and touchdowns only - receptions are worth nothing, so volume receivers rate lower and big-play producers rate higher than they do in Fantasy scoring." : "Fantasy scoring is full PPR, so every reception is worth a point."} QBs also gain or lose for passer rating and completion percentage, and RBs for yards per carry, against their era's average. Flex is graded on production alone, not position - no positional bump either way. Team score averages the six, with the QB counting 1.25 times.</p>
                    {history.length === 6 && (() => {
                      // Board players carry both formats' grades; show the one actually in play.
                      const rate = (p) => (normFormat(mode.format) === "standard" ? p.stdRating : p.rating);
                      const rows = history.map((h, i) => {
                        const took = findPlayer(h.key, h.id, h.season);
                        const best = findPlayer(h.key, h.bestId, h.bestSeason) || took;
                        const [tm, w] = h.key.split("|");
                        return { i, took, best, gotIt: rate(took) >= rate(best) - 0.05, board: `${TEAMS[tm][0]} ${WINDOWS[w][0]}–${WINDOWS[w][1]}` };
                      });
                      const hits = rows.filter((r) => r.gotIt).length;
                      const optimal = bestOrderFor(history, mode.format);
                      const totalWeight = SLOTS.reduce((t, s) => t + (s === "QB" ? QB_WEIGHT : 1), 0);
                      return (
                        <>
                          <h2 className="h" style={{ marginTop: 22 }}>Draft recap</h2>
                          <p className="recap-sum">You took the best available player on <b>{hits} of 6</b> boards.</p>
                          <div className="recap">
                            {rows.map((r) => (
                              <div className="rc" key={r.i}>
                                <div className="n">{r.i + 1}</div>
                                <div><div className="bd">{r.board}</div><div className="tk">{r.took.name} {shortYr(r.took.season)}<span className={`g2 ${gradeTier(rate(r.took))}`}>{grade(rate(r.took))}</span></div></div>
                                <div className="alt">{r.gotIt ? <span className="ok">Best on the board</span>
                                  : <>Best available: <b>{r.best.name} {shortYr(r.best.season)}</b> <span className={`g2 ${gradeTier(rate(r.best))}`}>{grade(rate(r.best))}</span></>}</div>
                              </div>
                            ))}
                          </div>
                          <p className="note">"Best available" means the highest-graded player you could still fit into an open spot on that board.</p>

                          {optimal && (
                            <>
                              <h3 className="h" style={{ marginTop: 18 }}>Best possible order</h3>
                              <p className="recap-sum">The best team score you could have built from these same six boards, slotted differently: <b>{(optimal.totalRating / totalWeight).toFixed(1)}</b> vs. your {result.score.toFixed(1)}.</p>
                              <RosterRows roster={SLOTS.map((s) => {
                                const a = optimal.slotAssignment[s];
                                const [tm, w] = a.key.split("|");
                                return { slot: s, ...a.player, rating: effectiveRating(s, a.player, mode.format), board: `${TEAMS[tm][0]} ${WINDOWS[w][0]}–${WINDOWS[w][1]}` };
                              })} />
                              <p className="note recap-optimal">This assumes hindsight of all six boards you saw - it's what the ideal slot assignment would have scored, not a board you missed.</p>
                            </>
                          )}
                        </>
                      );
                    })()}
                    <div className="frow" style={{ marginTop: 16 }}>
                      <button className="btn solid" onClick={doShare}>{share.state === "copied" ? "Copied to clipboard" : share.state === "shared" ? "Shared" : "Share result"}</button>
                      <button className="btn" onClick={restart}>Draft a new team</button>
                      <button className="btn" onClick={() => { setView("board"); loadLeaderboard(); loadDailyBoard(); }}>See the leaderboard</button>
                    </div>
                    {mode.kind === "free" && (
                      <p className="note">Send a friend the code <b>{mode.code}</b> and they'll draft the exact same six boards.</p>
                    )}
                    {share.state === "manual" && (
                      <>
                        <p className="note">Copying isn't allowed here, so select the text below and copy it.</p>
                        <textarea className="sharebox" readOnly value={share.text} onFocus={(e) => e.target.select()} />
                      </>
                    )}
                  </>
                )}
              </>
            )}
            </>
            )}
          </>
        )}

        {/* ---------------- ACCOUNT / PROFILE ---------------- */}
        {view === "profile" && authReady && !user && (
          <AuthPanel onAuthed={onAuthed} title="Your account"
            blurb="Log in to track your seasons, best lineup, and championships, and to appear on the leaderboard." />
        )}

        {view === "profile" && user && stats && (
          <>
            <div className="who">
              <span className="nm">{user}</span>
              <button className="linkbtn" onClick={logOut}>Log out</button>
            </div>

            {draftsOf(stats) === 0 ? (
              <div className="panel"><p style={{ margin: 0 }}>Play your first season to start your record.</p>
                <div style={{ marginTop: 10 }}><button className="btn solid" onClick={() => setView("play")}>Go to the draft</button></div></div>
            ) : (
              <>
                <div className="tiles">
                  <div className="tile"><div className="n">{draftsOf(stats)}</div><div className="l">Drafts{stats.dnf ? `, ${stats.dnf} DNF` : ""}</div></div>
                  <div className="tile"><div className="n">{stats.champs}</div><div className="l">Championships</div></div>
                  <div className="tile"><div className="n">{stats.perfect}</div><div className="l">Perfect seasons</div></div>
                  <div className="tile"><div className="n">{Math.round((100 * stats.playoffs) / draftsOf(stats))}%</div><div className="l">Made the playoffs</div></div>
                  <div className="tile"><div className="n">{stats.runs ? `${(stats.wins / stats.runs).toFixed(1)}–${(stats.losses / stats.runs).toFixed(1)}` : "–"}</div><div className="l">Average record, finished seasons</div></div>
                  {/* One tile per format rather than a toggle - on your own page both are worth
                      seeing at a glance, and they never rank against each other anyway. */}
                  {FORMATS.map((f) => (
                    <div className="tile" key={f}>
                      <div className="n">{scoreOf(stats, f) != null ? scoreOf(stats, f).toFixed(1) : "–"}</div>
                      <div className="l">Best {FORMAT_LABEL[f]} score{lbFormat === f && myRank >= 0 ? `, #${myRank + 1} sitewide` : ""}</div>
                    </div>
                  ))}
                  <div className="tile"><div className="n">{stats.dailyStreak && (stats.dailyLast === todayKey() || nextStreak(stats, todayKey()) > 1) ? stats.dailyStreak : 0}</div>
                    <div className="l">Daily streak{stats.dailyBestStreak ? `, best ${stats.dailyBestStreak}` : ""}</div></div>
                </div>

                {FORMATS.filter((f) => runOf(stats, f)).map((f) => {
                  const best = runOf(stats, f);
                  return (
                    <div key={f}>
                      <h2 className="h">Best {FORMAT_LABEL[f]} lineup</h2>
                      <p className="note" style={{ marginTop: 0 }}>{best.w}–{best.l}, team score {best.score.toFixed(1)}, {fmtDate(best.date)}. {best.outcome}.</p>
                      <RosterRows roster={best.roster} />
                    </div>
                  );
                })}

                {stats.recent?.length > 0 && (
                  <>
                    <h2 className="h" style={{ marginTop: 20 }}>Recent drafts</h2>
                    <div className="recent">
                      {stats.recent.map((r, i) => r.dnf ? (
                        <div className="rr dnf" key={i}>
                          <span className="muted">{fmtDate(r.date)}</span>
                          <span className="rec2">DNF</span>
                          <span className="muted">Reset {r.picks ? `after ${r.picks} pick${r.picks > 1 ? "s" : ""}` : "before the first pick"}</span>
                          <span className="sc2 muted">–</span>
                        </div>
                      ) : (
                        <div className="rr" key={i}>
                          <span className="muted">{fmtDate(r.date)}</span>
                          <span className="rec2">{r.w}–{r.l}</span>
                          <span>{r.mode === "daily" ? "Daily: " : ""}{r.outcome}</span>
                          <span className="sc2 muted">{r.score.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ---------------- LEADERBOARD ---------------- */}
        {view === "board" && (
          <>
            {lb.loading && lb.top.length === 0 ? (
              <p className="muted">Loading the leaderboard…</p>
            ) : lb.error ? (
              <div className="panel"><p>The leaderboard didn't load.</p><button className="btn" onClick={loadLeaderboard}>Try again</button></div>
            ) : (
              <>
                {/* Every board on this screen is per format - the two score different things, so
                    ranking them together would be meaningless. */}
                <div className="fmtpick" role="group" aria-label="Leaderboard scoring format">
                  <span className="fmtlabel">Scoring</span>
                  {FORMATS.map((f) => (
                    <button key={f} className={`fmtbtn ${boardFormat === f ? "on" : ""}`} aria-pressed={boardFormat === f}
                      onClick={() => { showBoardFormat(f); loadLeaderboard(f); loadDailyBoard(f); }}>
                      {FORMAT_LABEL[f]}<span className="fmtsub">{f === "fantasy" ? "Full PPR" : "Standard"}</span>
                    </button>
                  ))}
                </div>

                <div className="dayhead">
                  <h2 className="h">Today's {FORMAT_LABEL[normFormat(dailyBoard.format)]} daily</h2>
                  <button className="linkbtn" onClick={() => loadDailyBoard()} disabled={dailyBoard.loading}>{dailyBoard.loading ? "Loading…" : "Refresh"}</button>
                </div>
                {dailyBoard.rows.length === 0 ? (
                  <p className="note" style={{ marginTop: 0 }}>
                    {dailyBoard.loading ? "Loading today's scores…" : "No finished dailies yet today."}{" "}
                    {!dailyDone[boardFormat] && <button className="linkbtn" onClick={() => { setView("play"); startDaily(boardFormat); }}>Play today's {FORMAT_LABEL[boardFormat]} daily</button>}
                  </p>
                ) : (
                  <table className="lb">
                    <thead><tr><th></th><th>Player</th><th className="r">Team score</th><th className="r">Record</th></tr></thead>
                    <tbody>
                      {dailyBoard.rows.slice(0, 10).map((q, i) => (
                        <tr key={i} className={user && q.username === user ? "me" : ""}>
                          <td className="rk">{i + 1}</td><td>{q.username}</td>
                          <td className="r">{q.score.toFixed(1)}</td><td className="r">{q.w}–{q.l}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <h2 className="h">Draft a friend's board</h2>
                <p className="note" style={{ marginTop: 0 }}>Enter a challenge code to get the exact same six boards they had.</p>
                <div className="frow" style={{ marginBottom: 18 }}>
                  <input className="inp" value={codeInput} maxLength={8} placeholder="Code, e.g. K3F9QZ" aria-label="Challenge code"
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && (setView("play"), startCode(codeInput))} />
                  <button className="btn solid" disabled={codeInput.trim().length < 4} onClick={() => { setView("play"); startCode(codeInput); }}>Draft this board</button>
                </div>

                <h2 className="h">All time</h2>
                <div className="tiles">
                  <div className="tile"><div className="n">{totals.players}</div><div className="l">Players</div></div>
                  <div className="tile"><div className="n">{totals.runs.toLocaleString()}</div><div className="l">Drafts</div></div>
                  <div className="tile"><div className="n">{totals.perfect}</div><div className="l">Perfect seasons</div></div>
                </div>

                {siteBest ? (
                  <div className="champion">
                    <div className="stripe" style={{ background: "var(--lamp)" }} />
                    <div className="pickno">Sitewide best {FORMAT_LABEL[lbFormat]} team score</div>
                    <div className="sc led-wrap"><span className="led">{scoreOf(siteBest, lbFormat).toFixed(1)}</span></div>
                    <div className="by">{siteBest.username}{runOf(siteBest, lbFormat) ? `, went ${runOf(siteBest, lbFormat).w}–${runOf(siteBest, lbFormat).l}` : ""}</div>
                    {runOf(siteBest, lbFormat) && <RosterChips roster={runOf(siteBest, lbFormat).roster} />}
                  </div>
                ) : (
                  <div className="panel"><p style={{ margin: 0 }}>No scores yet. Finish a season while logged in to claim the top spot.</p></div>
                )}

                {lb.top.length > 0 && (
                  <>
                    <h2 className="h">Top 10 — {FORMAT_LABEL[lbFormat]}</h2>
                    <table className="lb">
                      <thead><tr><th></th><th>Player</th><th className="r">Best score</th><th className="r">Best record</th><th className="r hide">Drafts</th><th className="r hide">20–0s</th></tr></thead>
                      <tbody>
                        {lb.top.map((q, i) => (
                          <tr key={q.id} className={q.id === myKey ? "me" : ""}>
                            <td className="rk">{i + 1}</td>
                            <td>{q.username}</td>
                            <td className="r">{scoreOf(q, lbFormat) != null ? scoreOf(q, lbFormat).toFixed(1) : "–"}</td>
                            <td className="r">{q.bestRecord ? `${q.bestRecord.w}–${q.bestRecord.l}` : "–"}</td>
                            <td className="r hide">{draftsOf(q)}{q.dnf ? <span className="muted"> ({q.dnf} DNF)</span> : null}</td>
                            <td className="r hide">{q.perfect}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {authReady && !user && <p className="note">You're not on the leaderboard yet. <button className="linkbtn" onClick={() => setView("profile")}>Log in or create an account</button> and your seasons will count here.</p>}
                {user && myRank >= 10 && scoreOf(stats, lbFormat) != null && <p className="note">You're #{myRank + 1} with a best {FORMAT_LABEL[lbFormat]} score of {scoreOf(stats, lbFormat).toFixed(1)}.</p>}
                <button className="btn" onClick={loadLeaderboard} disabled={lb.loading}>{lb.loading ? "Refreshing…" : "Refresh"}</button>
              </>
            )}
          </>
        )}

        {/* ---------------- STATS ---------------- */}
        {view === "stats" && (
          <>
            {!siteStats.loaded ? (
              <p className="muted">Loading stats…</p>
            ) : (
              <>
                <h2 className="h">Sitewide</h2>
                <div className="tiles">
                  <div className="tile"><div className="n">{totals.players}</div><div className="l">Accounts</div></div>
                  <div className="tile"><div className="n">{(liveDrafts ?? totals.runs).toLocaleString()}</div><div className="l">Drafts</div></div>
                  <div className="tile"><div className="n">{totals.perfect}</div><div className="l">Perfect seasons</div></div>
                  <div className="tile"><div className="n">{site.avgWinPct}%</div><div className="l">Average win rate</div></div>
                  <div className="tile"><div className="n">{siteStats.buildCount}</div><div className="l">Created players</div></div>
                </div>
                <p className="note">Leaderboards below draw from the 300 most recently active accounts, not everyone who's ever played.</p>
                <button className="btn" onClick={loadSiteStats} disabled={siteStats.loading}>{siteStats.loading ? "Refreshing…" : "Refresh"}</button>

                {/* Only the score-ranked boards split by format; the career records further down
                    are shared, since both formats play the identical season simulation. */}
                <div className="fmtpick" style={{ marginTop: 18 }} role="group" aria-label="Stats scoring format">
                  <span className="fmtlabel">Scoring</span>
                  {FORMATS.map((f) => (
                    <button key={f} className={`fmtbtn ${boardFormat === f ? "on" : ""}`} aria-pressed={boardFormat === f}
                      onClick={() => showBoardFormat(f)}>
                      {FORMAT_LABEL[f]}<span className="fmtsub">{f === "fantasy" ? "Full PPR" : "Standard"}</span>
                    </button>
                  ))}
                </div>

                <h2 className="h" style={{ marginTop: 22 }}>Best {FORMAT_LABEL[boardFormat]} lineups ever</h2>
                {fmtStats.bestLineups.length === 0 ? (
                  <p className="note" style={{ marginTop: 0 }}>No {FORMAT_LABEL[boardFormat]} scores yet.</p>
                ) : (
                  <div className="recap">
                    {fmtStats.bestLineups.map((q, i) => {
                      const best = runOf(q, boardFormat);
                      return (
                        <div key={q.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                          <div style={{ fontWeight: 700 }}>
                            #{i + 1} {q.username}{" "}
                            <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                              — {scoreOf(q, boardFormat).toFixed(1)}{best ? `, ${best.w}–${best.l}` : ""}
                            </span>
                          </div>
                          {best && <RosterChips roster={best.roster} />}
                        </div>
                      );
                    })}
                  </div>
                )}

                <h2 className="h" style={{ marginTop: 22 }}>Most-drafted players</h2>
                <p className="note" style={{ marginTop: 0 }}>Counted across both scoring formats - this is a popularity tally, not a score.</p>
                {site.mostDrafted.length === 0 ? (
                  <p className="note" style={{ marginTop: 0 }}>No runs yet.</p>
                ) : (
                  <div className="recap">
                    {site.mostDrafted.map((p, i) => (
                      <div className="rc" key={i}>
                        <div className="n">{i + 1}</div>
                        <div><div className="bd">{p.season} {TEAMS[p.team] ? TEAMS[p.team][0] : p.team}</div><div className="tk">{p.name}</div></div>
                        <div className="alt">{p.count} draft{p.count === 1 ? "" : "s"}</div>
                      </div>
                    ))}
                  </div>
                )}

                <h2 className="h" style={{ marginTop: 22 }}>{FORMAT_LABEL[boardFormat]} position records</h2>
                <div className="recap">
                  {POS_RECORD_SLOTS.map(([bucket, label]) => {
                    const p = fmtStats.posRecords[bucket];
                    return (
                      <div className="rc" key={bucket}>
                        <div className="n">{label}</div>
                        {p ? (
                          <>
                            <div><div className="bd">{p.season} {TEAMS[p.team] ? TEAMS[p.team][0] : p.team}</div><div className="tk">{p.name}</div></div>
                            <div className="alt">{p.username}</div>
                          </>
                        ) : (
                          <div className="alt">No record yet.</div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <h2 className="h" style={{ marginTop: 22 }}>Career records</h2>
                <p className="note" style={{ marginTop: 0 }}>Combined across both scoring formats - a season played is a season played, and both run the same simulation.</p>

                <h2 className="h" style={{ marginTop: 22 }}>Most career wins</h2>
                <RankRows rows={site.mostWins} empty="No finished drafts yet." value={(q) => `${q.wins}–${q.losses}`} />

                <h2 className="h" style={{ marginTop: 22 }}>Most championships</h2>
                <RankRows rows={site.mostChamps} empty="No championships yet." value={(q) => q.champs} />

                <h2 className="h" style={{ marginTop: 22 }}>Most playoff appearances</h2>
                <RankRows rows={site.mostPlayoffs} empty="No playoff runs yet." value={(q) => q.playoffs} />

                <h2 className="h" style={{ marginTop: 22 }}>Longest daily streak</h2>
                <RankRows rows={site.longestStreaks} empty="No daily streaks yet." value={(q) => `${q.dailyBestStreak} day${q.dailyBestStreak === 1 ? "" : "s"}`} />

                <h2 className="h" style={{ marginTop: 22 }}>Best win percentage</h2>
                <p className="note" style={{ marginTop: 0 }}>Minimum 3 finished drafts.</p>
                <RankRows rows={site.bestWinPct} empty="Not enough finished drafts yet." value={(q) => `${Math.round(q.pct * 100)}%`} />

                <h2 className="h" style={{ marginTop: 22 }}>Best {FORMAT_LABEL[boardFormat]} GM-mode score</h2>
                <RankRows rows={fmtStats.bestGm} empty="No GM-mode runs yet." value={(q) => q.score.toFixed(1)} />

                <h2 className="h" style={{ marginTop: 22 }}>Highest-OVR created player</h2>
                <p className="note" style={{ marginTop: 0 }}>Build-a-player results, sitewide - doesn't touch anyone's own stats or leaderboard rank.</p>
                <RankRows rows={siteStats.topBuilds} empty="No builds yet." value={(b) => `${b.pos} · ${grade(b.overall)} (${b.overall.toFixed(1)})`} />
              </>
            )}
          </>
        )}

        {/* ---------------- PLAYER INDEX ---------------- */}
        {view === "players" && <PlayerIndex />}

        {/* ---------------- BUILD-A-PLAYER ---------------- */}
        {view === "buildplayer" && bap && bap.stage === "pickpos" && (
          <>
            <h2 className="h">Build-a-player</h2>
            <p className="note" style={{ marginTop: 0 }}>
              Choose a position. You'll roll a team, then their active player from last season, and take one attribute from him at a time until your build is complete.
            </p>
            <div className="frow" style={{ flexWrap: "wrap" }}>
              {POS.map((p) => (
                <button key={p} className="btn solid" onClick={() => pickBapPos(p)}>{POS_NAME[p]}</button>
              ))}
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={cancelBap}>Cancel</button>
          </>
        )}

        {view === "buildplayer" && bap && bap.stage === "rolling" && (
          <>
            <h2 className="h">Build-a-player - {POS_NAME[bap.pos]}</h2>
            <div className="panel" style={{ textAlign: "center" }}>
              <p className="note" style={{ marginTop: 0 }}>{bap.spinPhase === "team" ? "Rolling a team..." : "Rolling their player..."}</p>
              <h1 key={bap.displayTeam} className="title" style={{ margin: "10px 0", animation: "pop .15s ease-out" }}>{TEAMS[bap.displayTeam][0]}</h1>
              {bap.spinPhase === "player" && <h3 key={bap.displayPlayer} style={{ margin: 0, animation: "pop .15s ease-out" }}>{bap.displayPlayer}</h3>}
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={cancelBap}>Cancel</button>
          </>
        )}

        {view === "buildplayer" && bap && bap.stage === "build" && (
          <>
            <h2 className="h">Build-a-player - {POS_NAME[bap.pos]}</h2>
            <p className="note" style={{ marginTop: 0 }}>
              Take one of his attributes for your build. {bap.remaining.length} attribute{bap.remaining.length === 1 ? "" : "s"} left.
            </p>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>{bap.player.name} - {teamLabel(bap.team, bap.player.season)}</h3>
              <p className="note" style={{ marginTop: 0 }}>{bap.player.season}, {bap.player.g} games</p>
              <div className="cells">
                {statCells(bap.player).map(([n, l]) => (<div className="cell" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>))}
              </div>
              {BAP_CATS.map((cat) => {
                const attrs = BAP_ATTRS[bap.pos].filter(([k, , c]) => c === cat && bap.remaining.includes(k));
                if (!attrs.length) return null;
                return (
                  <div key={cat} style={{ marginTop: 10 }}>
                    <p className="note" style={{ margin: "0 0 4px" }}>{cat}</p>
                    <div className="frow" style={{ flexWrap: "wrap" }}>
                      {attrs.map(([k, label, , calc]) => (
                        <button key={k} className="btn solid" onClick={() => pickBapAttr(k)}>Take his {label} ({grade(calc(bap.player))})</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {Object.keys(bap.filled).length > 0 && (
              <>
                <h3 className="h" style={{ marginTop: 18 }}>Locked in so far</h3>
                <div className="recap">
                  {BAP_CATS.flatMap((cat) => BAP_ATTRS[bap.pos].filter(([k, , c]) => c === cat && bap.filled[k]).map(([k, label]) => (
                    <div className="rc" key={k}><div className="n"> </div><div><div className="bd">{label}</div><div className="tk">{grade(bap.filled[k].score)}</div></div><div className="alt">{bap.filled[k].fromName}</div></div>
                  )))}
                </div>
              </>
            )}
            <button className="btn" style={{ marginTop: 12 }} onClick={cancelBap}>Cancel</button>
          </>
        )}

        {view === "buildplayer" && bap && bap.stage === "done" && (
          <>
            <h2 className="h">Build complete - {POS_NAME[bap.pos]}</h2>
            <p className="note" style={{ marginTop: 0 }}>
              Assembled from {new Set(Object.values(bap.filled).map((f) => f.fromName)).size} different real players' last-season attributes. Overall: <b>{grade(bapOverallScore(bap.filled))}</b>
            </p>
            <div className="panel">
              {BAP_CATS.map((cat) => (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <h3 style={{ marginTop: 0 }}>{cat}</h3>
                  <div className="recap">
                    {BAP_ATTRS[bap.pos].filter(([, , c]) => c === cat).map(([k, label]) => (
                      <div className="rc" key={k}>
                        <div className="n"> </div>
                        <div><div className="bd">{label}</div><div className="tk">{grade(bap.filled[k].score)}</div></div>
                        <div className="alt">from {bap.filled[k].fromName} <span style={{ opacity: 0.7 }}>({TEAMS[bap.filled[k].fromTeam][0]})</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <button className="btn solid" onClick={playBapSim}>Give him his shot at a ring</button>
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={cancelBap}>Cancel</button>
          </>
        )}

        {view === "buildplayer" && bap && bap.stage === "result" && (() => {
          const bapDone = bap.shown >= bap.sim.games.length;
          return (
            <>
              <h2 className="h">The verdict</h2>
              <p className="note" style={{ marginTop: 0 }}>
                Your {POS_NAME[bap.pos].replace(/s$/, "").toLowerCase()} took over for the {bap.opp.season} {TEAMS[bap.opp.team][0]}.
              </p>
              {bapDone && (bap.sim.perfect || bap.sim.champ) && (
                <div className={`cel ${bap.sim.perfect ? "perfect" : ""}`}>
                  <Confetti n={bap.sim.perfect ? 34 : 22} />
                  <div className="big">{bap.sim.perfect ? "20–0" : "Champions"}</div>
                  <div className="sml">{bap.sim.perfect ? "A perfect season. Nobody touched you." : `You won it all at ${bap.sim.w}–${bap.sim.l}.`}</div>
                </div>
              )}
              <div className="result-hero" aria-live="polite">
                <div className="rec led-wrap"><span className="led">
                  {bap.sim.games.slice(0, bap.shown).filter((g) => g.win).length}–{bap.sim.games.slice(0, bap.shown).filter((g) => !g.win).length}
                </span></div>
                <div className="outcome">{bapDone ? bap.sim.outcome : "Playing the season…"}</div>
              </div>
              <h2 className="h">Season</h2>
              <div className="log">
                {bap.sim.games.slice(0, bap.shown).map((g, i) => (
                  <div key={i} className={`g ${g.win ? "win" : "loss"} ${g.playoff ? "po" : ""}`}>
                    <div className="o">{g.label}</div>
                    <div className="w">{g.win ? "W" : "L"} {g.us}–{g.them}</div>
                    <div className="o">{g.playoff || g.home ? "vs" : "at"} {g.opp}</div>
                  </div>
                ))}
              </div>
              {!bapDone ? (
                <button className="btn" style={{ marginTop: 12 }} onClick={() => setBap((b) => ({ ...b, shown: b.sim.games.length }))}>Skip to the result</button>
              ) : (
                <div className="frow" style={{ marginTop: 12 }}>
                  <button className="btn solid" onClick={openBuildPicker}>Build another</button>
                  <button className="btn" onClick={cancelBap}>Done</button>
                </div>
              )}
            </>
          );
        })()}

        {/* ---------------- OVER/UNDER ---------------- */}
        {view === "statsou" && souIntro && (
          <>
            <h2 className="h">Over/Under</h2>
            <div className="panel">
              <p style={{ marginTop: 0 }}>
                The same rounds for everyone today, {prettyDate(souIntro.date)}. You'll see a real player's career stat line and guess over or under a number.
              </p>
              <p><b>Three lives</b> - miss three and the day is over.</p>
              <p><b>{SOU_ROUND_SECONDS} seconds per guess</b> - the clock starts the moment a player appears, so no looking anything up. Running out of time counts as a miss.</p>
              <p className="note" style={{ marginBottom: 0 }}>"Career" here means seasons that made our boards (best season per team per era) - a real slice of a career, not the whole thing.</p>
            </div>
            <div className="frow" style={{ marginTop: 12 }}>
              <button className="btn solid" onClick={beginSou}>{souIntro.roundIndex > 0 ? "Resume - start the clock" : "I'm ready - start the clock"}</button>
              <button className="btn" onClick={leaveSou}>Cancel</button>
            </div>
          </>
        )}

        {view === "statsou" && sou && (
          <>
            <h2 className="h">Over/Under</h2>
            <div className="sou-hud">
              <span className="sou-hearts">{"❤️".repeat(Math.max(0, sou.lives))}{"🖤".repeat(Math.max(0, SOU_LIVES - sou.lives))}</span>
              <span className="sou-score">Score {sou.score}</span>
              {!sou.guess && <span className={`sou-timer ${sou.timeLeft <= 3 ? "danger" : ""}`}>{sou.timeLeft}</span>}
            </div>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>{sou.round.name}</h3>
              <p className="note" style={{ marginTop: 0 }}>{POS_NAME[sou.round.pos]} · played for {sou.round.teams.join(", ")}</p>
              <p style={{ fontSize: 18, margin: "10px 0" }}>Career {sou.round.statLabel}: <b>{sou.round.line.toLocaleString()}</b></p>
              {!sou.guess ? (
                <div className="frow">
                  <button className="btn solid" onClick={() => souGuess("over")}>Over</button>
                  <button className="btn solid" onClick={() => souGuess("under")}>Under</button>
                </div>
              ) : (
                <>
                  <p className={sou.correct ? "ok" : "err"} style={{ margin: "0 0 10px" }}>
                    {sou.guess === "timeout" ? "Too slow." : sou.correct ? "Correct!" : "Wrong."} Actual: {sou.round.trueValue.toLocaleString()} {sou.round.statLabel}.
                  </p>
                  {sou.lives > 0 ? (
                    <button className="btn solid" onClick={() => startSouRound(sou.date, sou.roundIndex + 1, sou.lives, sou.score)}>Next round</button>
                  ) : (
                    <button className="btn solid" onClick={() => setSou(null)}>See today's result</button>
                  )}
                </>
              )}
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={leaveSou}>Back to modes</button>
          </>
        )}

        {view === "statsou" && !sou && !souIntro && souDone && (
          <>
            <h2 className="h">Over/Under</h2>
            <p className="note" style={{ marginTop: 0 }}>Today's Over/Under, {prettyDate(todayKey())}, is done. Come back tomorrow for a new set.</p>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Your score: {souDone.score}</h3>
              {!user && <p className="note">Log in to put your score on tomorrow's leaderboard.</p>}
            </div>
            <h2 className="h">Today's leaderboard</h2>
            {souBoard.rows.length === 0 ? (
              <p className="note" style={{ marginTop: 0 }}>{souBoard.loading ? "Loading today's scores…" : "No finished rounds yet today."}</p>
            ) : (
              <table className="lb">
                <thead><tr><th></th><th>Player</th><th className="r">Score</th></tr></thead>
                <tbody>
                  {souBoard.rows.map((q, i) => (
                    <tr key={i} className={user && q.username === user ? "me" : ""}>
                      <td className="rk">{i + 1}</td><td>{q.username}</td><td className="r">{q.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className="btn" style={{ marginTop: 12 }} onClick={leaveSou}>Back to modes</button>
          </>
        )}
      </div>
    </div>
  );
}
