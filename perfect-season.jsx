import { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";
import {
  sget, sset, sdel, clearDraft,
  fetchLeaderboardTop, fetchOwnRank, fetchSiteTotals, fetchDailyTop, fetchSouTop, upsertSouRun, fetchSiteStats, subscribeSiteActivity, fetchLadderTop,
  fetchSeasonRank, fetchUpsetRank,
  logBuild, fetchTopBuilds, fetchBuildCount,
  authSignUp, authSignIn, authSignOut, authGetSession, authOnChange, mapAuthError,
  fetchProfile, submitRun, submitDnf,
  fetchPlayerProfile, fetchProfileDetails, checkUsername, isModerator, fetchModQueue,
} from "./storage.js";
import gameData from "./data/players.json";
import { cssVars, PALETTE } from "./theme.mjs";
import {
  POS, WINDOWS, SLOTS, QB_WEIGHT, FLEX_POS, TEAMS, BOARDS, OPPS, PLAYOFF_OPPS, initGameData,
  hashStr, mulberry32, withSeed, fits, pick, boardHasOption, seededSequence, boardAt, rerollCandidate,
  flexRating, effectiveRating, winProb, shuffle, windowedShuffle, tagOpp, buildTimeline, simulateSeason,
  applyDnf, LOSER_PTS, MARGINS, GM_CAP, playerSalary, REROLL_BUDGET,
  passerRating, normFormat, BEST_FIELDS, FORMATS,
  botPar, draftPoints, modeKey, LADDERS, dailySeed,
} from "./game-logic.mjs";
import {
  SLOT_LABEL, FORMAT_LABEL, LADDER_LABEL, teamVars, gradeTier, grade, cityFor, teamLabel, shortYr,
  outcomeSentence, draftsOf, scoreOf, runOf, RosterRows, RosterChips,
} from "./ui-common.jsx";
import { PROFILE_CSS, ProfileScreen } from "./profile.jsx";
import { AVATAR_CSS, Avatar } from "./avatars.jsx";
import { PICKER_CSS } from "./avatar-picker.jsx";
import { MODERATION_CSS, ModerationQueue } from "./moderation.jsx";
import { COSMETICS_CSS } from "./cosmetics.jsx";
import { SHOP_CSS } from "./shop.jsx";
import { USERNAME_RE, profilePath, parseProfilePath } from "./profile-rules.mjs";
initGameData(gameData.players, gameData.opponents);

// Baked in by build.mjs's esbuild `define` (same mechanism as SUPABASE_URL - see storage.js).
const IS_STAGING = APP_ENV === "staging";

const POS_NAME = { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends" };
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

const TEAM_CODES = Object.keys(TEAMS);

function cityRange(code, w) {
  const [a, b] = WINDOWS[w];
  const c1 = cityFor(code, a), c2 = cityFor(code, b);
  return c1 === c2 ? c1 : `${c1} & ${c2}`;
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
      <div className="pg-top"><span>{game.label} round vs {game.opp} ({game.oppRec})</span><span>{done ? (game.win ? (game.label === "Championship" ? "Champions" : "You advance") : "Season over") : "Live"}</span></div>
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
// Every color here comes from theme.mjs tokens (see the rule at the top of that file: lime is a fill,
// `--accent-ink` is for accent-colored text). The default scope is cream; `.dark` swaps in the navy
// scoreboard tokens for the play screen and for components that are stadium-dark wherever they
// appear. Headings are uppercased in CSS, never in the JSX, so screen readers and tests see
// sentence case.
const GRAIN = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const CSS = `
.ps{${cssVars("light")};--display:'Anton',Impact,'Arial Narrow',sans-serif;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;font-synthesis:none;-webkit-font-smoothing:antialiased;
  color:var(--ink);background-color:var(--bg);background-image:${GRAIN};min-height:100vh;-webkit-tap-highlight-color:transparent;
  /* decorative hero glow bleeds past the viewport edge; clip (not hidden) so no scroll container is created */
  overflow-x:clip}
/* Tabular digits only where numbers line up. On the whole page they also widen Inter's hyphen, so
   prose read "re - spin" and names "Valdes - Scantling". */
.lb td,.tile .n,.strip .n,.rec,.sc,.rr,.cell .n,.g .w,.sb,.clock,.fin,.sou-score,.sou-timer,.rc .n,.gr,.rv .pts,.recap-sum b,.streak b,.ver,.slot .sub{font-variant-numeric:tabular-nums}
/* Stop the browser pinning the view to the bottom while a season's tiles tick in under it. */
html:has(.result-hero){overflow-anchor:none}
/* Scoreboard scope: the whole play screen, plus components that are always stadium-dark. */
.ps.dark,.dark,.reel,.sticky,.result-hero,.champion,.pg,.pre,.cel,.mode.m-unlimited,.challenge,.pf-card,.cs-dark{${cssVars("dark")};color:var(--ink)}
.ps.dark{background-color:var(--bg)}
/* Leaderboard scope: true black. After the dark list so its champion block takes night tokens. */
.ps.night,.night .champion,.cs-night{${cssVars("night")};color:var(--ink)}
.ps.night{background-color:var(--bg);background-image:none}
/* A card theme on a cream ground (cosmetics.jsx's CardTheme). Last, so it wins over .pf-card's dark tokens. */
.cs-light{${cssVars("light")};color:var(--ink)}
.ps *{box-sizing:border-box}
/* :where() keeps this at element specificity, so .fmtbtn's Anton, .linkbtn's accent color and .tab's
   muted color actually apply - as .ps button it outranked every one of them. */
:where(.ps) button{font-family:inherit;cursor:pointer;color:inherit}
.ps button:focus-visible{outline:3px solid var(--accent-ink);outline-offset:3px}
.slant{display:inline-block;transform:skewX(-8deg)}
.wrap{max-width:900px;margin:0 auto;padding:18px 16px 56px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}
.title{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:44px;line-height:.9;margin:0;color:var(--ink)}
.sub{margin:6px 0 0;color:var(--muted);font-size:15px;max-width:46ch}
.best{text-align:right;font-size:13px;color:var(--muted);white-space:nowrap}
.best b{display:block;font-family:var(--display);font-weight:400;font-size:28px;color:var(--ink)}
.muted{color:var(--muted)}
.note{font-size:13px;color:var(--muted);margin-top:8px}
h2.h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.01em;font-size:28px;line-height:1.1;color:var(--ink);margin:0 0 6px;text-wrap:balance}
h3.h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.01em;font-size:22px;line-height:1.1;color:var(--ink);margin:0 0 6px;text-wrap:balance}

/* ===== buttons: tactile, sticker-like ===== */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:2px solid var(--btn-line);background:var(--surface);color:var(--ink);
  border-radius:10px;padding:8px 14px;font-weight:700;font-size:14px;line-height:1.2;box-shadow:3px 3px 0 var(--hard);
  transition:transform .12s ease,box-shadow .12s ease,background-color .12s}
@media (hover:hover){.btn:hover:not(:disabled){transform:translate(-1px,-2px) rotate(-.6deg);box-shadow:5px 6px 0 var(--hard)}}
.btn:active:not(:disabled){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--hard)}
.btn:disabled{opacity:.45;cursor:default;box-shadow:none;transform:none}
.btn.solid{background:var(--accent);color:var(--on-accent);border-color:var(--on-accent);font-family:var(--display);font-weight:400;
  text-transform:uppercase;letter-spacing:.03em;font-size:16px}
.btn.xl{font-size:clamp(20px,4.6vw,26px);padding:14px 26px 13px;border-radius:14px;box-shadow:5px 5px 0 var(--hard)}
@media (hover:hover){.btn.xl:hover:not(:disabled){box-shadow:8px 9px 0 var(--hard)}}
.btn.sm{padding:5px 9px;font-size:13px;box-shadow:2px 2px 0 var(--hard)}
.btn.reset{margin-left:auto;color:var(--muted);border-color:var(--line2);box-shadow:none}
@media (hover:hover){.btn.reset:hover:not(:disabled){color:var(--ink);box-shadow:2px 2px 0 var(--hard)}}
.btn.reset.armed{color:var(--bg);background:var(--loss);border-color:var(--loss)}
.linkbtn{background:none;border:none;padding:0;color:var(--accent-ink);font-weight:700;font-size:14px;text-decoration:underline;
  text-decoration-thickness:2px;text-underline-offset:3px}
/* A username that opens that player's profile. It reads as the name itself wherever it sits - a leaderboard
   cell, a card, a ranked row - so it takes that spot's type, color and wrapping (overflow-wrap is inherited, so
   the narrow-screen rules on .lb td.nm and .rc.rank .tk still apply) and has no button look of its own. */
.namelink{background:none;border:none;padding:0;margin:0;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;text-align:inherit}
@media (hover:hover){.namelink:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}}
.pill{font-size:13px;font-weight:700;color:var(--ink);background:var(--surface);border:2px solid var(--line2);border-radius:999px;padding:4px 12px}
button.pill{font-family:inherit;transition:border-color .12s}
@media (hover:hover){button.pill:hover{border-color:var(--ink)}}
.badge{display:inline-block;background:var(--accent);color:var(--on-accent);font-weight:800;font-size:13px;border-radius:6px;padding:3px 8px;margin-top:10px;margin-right:6px}

/* ===== nav ===== */
.nav{display:flex;align-items:center;flex-wrap:wrap;gap:6px 4px;border-bottom:2px solid var(--ink);margin-bottom:18px;padding-bottom:8px}
.tab,.ver{white-space:nowrap}
.tab{background:none;border:none;border-radius:999px;padding:7px 13px;font-weight:700;font-size:14.5px;color:var(--muted);transition:background-color .12s,color .12s}
@media (hover:hover){.tab:hover{color:var(--ink)}}
.tab.on{background:var(--accent);color:var(--on-accent)}
.tab .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--orange);margin-left:6px;vertical-align:middle;box-shadow:0 0 0 2px var(--bg)}
.hdr-links{display:flex;gap:10px;justify-content:flex-end;margin-top:6px;align-items:center;min-width:0}
.nav .hdr-links{margin-left:auto;margin-top:0}
/* The header's own controls speak the pill vocabulary (like the live drafts pill), not bare links:
   How to play and Log in are chips, you are your picture (avatars.jsx) and name, the version is a quiet tag. */
.hdrchip{display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap}
.hdrchip.help{padding-left:4px}
.hdrchip.help::before{content:"?";display:grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--ink);color:var(--bg);font-family:var(--display);font-size:12px;line-height:1}
.hdrchip.login{border-color:var(--ink)}
.whoami{display:inline-flex;align-items:center;gap:7px;min-width:0;max-width:44vw;background:none;border:none;padding:0;font-weight:700;font-size:14px;color:var(--ink)}
.whoname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (hover:hover){.whoami:hover .whoname{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}}
.ver{flex:none;font-size:11.5px;font-weight:600;color:var(--muted);background:var(--surface2);border-radius:6px;padding:2px 7px;font-variant-numeric:tabular-nums}
.stagebar{margin:0 0 14px;padding:9px 14px;border-radius:12px;font-size:13.5px;color:var(--ink);border:2px solid var(--orange);
  background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--orange) 26%,transparent) 0 12px,color-mix(in srgb,var(--orange) 12%,transparent) 12px 24px)}

/* A friend's challenge link, waiting at the top of the Modes screen: a navy scoreboard card (dark tokens). */
.challenge{border-radius:18px;padding:18px 20px;margin:0 0 18px;display:grid;gap:10px;background:var(--bg);border:2px solid ${PALETTE.ink};box-shadow:4px 4px 0 ${PALETTE.ink}}
.challenge .k{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.challenge .big{font-family:var(--display);font-weight:400;font-size:clamp(34px,7vw,52px);line-height:.95;text-transform:uppercase;margin:0;color:var(--ink)}
.challenge .big em{font-style:normal;color:var(--accent-ink)}
.challenge p{margin:0;color:var(--muted);max-width:60ch}
.challenge .warn{color:var(--ink);font-weight:600}

/* ===== hero ===== */
.hero{position:relative;margin:6px 0 28px;padding:14px 0 6px;isolation:isolate}
.hero .yardnums{position:absolute;z-index:-1;top:-8px;right:0;display:flex;flex-direction:column;align-items:flex-end;font-family:var(--display);
  font-size:clamp(44px,9vw,84px);line-height:.88;color:var(--ink);opacity:.05;pointer-events:none;user-select:none}
.hero .blob{position:absolute;z-index:-1;width:min(64vw,520px);height:min(64vw,520px);right:-10%;top:-12%;border-radius:50%;
  background:radial-gradient(circle,color-mix(in srgb,var(--accent) 60%,transparent),transparent 68%);filter:blur(30px);opacity:.5;pointer-events:none}
.eyebrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.wordmark{font-family:var(--display);font-weight:400;font-size:24px;line-height:1;text-transform:uppercase;letter-spacing:.02em;margin:0;color:var(--ink)}
.kicker{font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);background:var(--surface);border:2px solid var(--ink);border-radius:999px;padding:4px 10px}
.headline{margin:0;font-family:var(--display);font-weight:400;text-transform:uppercase;line-height:.86;color:var(--ink)}
.headline .hl1{display:block;font-size:clamp(40px,9vw,78px)}
.headline .big20{display:inline-block;font-size:clamp(96px,23vw,236px);margin-top:.05em;white-space:nowrap}
.headline .num{display:inline-block;background:var(--accent);color:var(--on-accent);padding:.03em .1em 0;transform:skewX(-8deg);transform-origin:bottom left;box-shadow:.05em .05em 0 var(--ink);margin-right:.05em}
.herosub{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(20px,4.2vw,30px);line-height:1.05;margin:16px 0 6px;max-width:26ch}
.heroexplain{margin:0 0 18px;color:var(--muted);font-size:15.5px;line-height:1.5;max-width:58ch}
.herocta{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.herostats{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}

/* ===== home: format picker + mode tiles ===== */
.fmtpick{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.fmtlabel{font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-right:4px}
.fmtbtn{display:flex;flex-direction:column;align-items:flex-start;gap:1px;border:2px solid var(--btn-line);border-radius:12px;padding:6px 13px 5px;
  background:var(--surface);color:var(--ink);font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:17px;
  transition:transform .12s,box-shadow .12s}
@media (hover:hover){.fmtbtn:hover{transform:translateY(-1px)}}
.fmtbtn.on{background:var(--accent);color:var(--on-accent);border-color:var(--on-accent);box-shadow:3px 3px 0 var(--hard)}
.fmtsub{font-family:'Inter',system-ui,sans-serif;font-weight:700;font-size:11px;text-transform:none;letter-spacing:0;opacity:.75}
.fmtnote{flex-basis:100%;margin:2px 0 0;color:var(--muted);font-size:13.5px;max-width:66ch}
.modes{display:grid;gap:14px;margin-bottom:24px}
.mode{display:block;width:100%;text-align:left;border:2px solid var(--ink);border-radius:18px;padding:16px 18px;color:var(--ink);background:var(--surface);
  box-shadow:4px 4px 0 var(--hard);transition:transform .14s ease,box-shadow .14s ease}
@media (hover:hover){.mode:hover:not(.static){transform:translate(-1px,-3px) rotate(-.4deg);box-shadow:6px 8px 0 var(--hard)}}
.mode:active:not(.static){transform:translate(2px,2px);box-shadow:1px 1px 0 var(--hard)}
/* challenge-a-friend: plain content, no container */
.mode.static{cursor:default;background:transparent;box-shadow:none;border:2px dashed var(--line2)}
/* the daily: the one featured lime block */
.mode.daily{background:var(--accent);color:var(--on-accent);border:2px solid var(--on-accent);box-shadow:5px 5px 0 var(--ink)}
.mode.daily p{color:var(--on-accent);opacity:.8}
.mode.daily .icon{background:var(--surface)}
.mode.daily .pill{background:var(--on-accent);color:var(--accent)}
/* unlimited: the dark navy card */
.mode.m-unlimited{background:linear-gradient(135deg,var(--surface2),var(--bg));border-color:${PALETTE.ink};box-shadow:4px 4px 0 ${PALETTE.ink}}
@media (hover:hover){.mode.m-unlimited:hover:not(.static){box-shadow:6px 8px 0 ${PALETTE.ink}}}
.mode.m-unlimited .icon{background:var(--surface);border-color:var(--line2)}
.mode.m-unlimited .go{background:var(--accent);color:var(--on-accent)}
/* over/under: the orange special moment */
.mode.m-sou{background:var(--orange);color:${PALETTE.ink};border-color:${PALETTE.ink}}
.mode.m-sou p{color:${PALETTE.ink};opacity:.8}
.mode .mt{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.mode .mn{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:30px;line-height:1;letter-spacing:.01em}
.mode p{margin:6px 0 12px;color:var(--muted);font-size:14.5px;max-width:58ch}
.mode .icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:22px;line-height:1;flex:0 0 auto;
  background:var(--surface2);border:2px solid currentColor}
.mode.m-genius .icon{background:color-mix(in srgb,var(--violet) 20%,var(--surface))}
.mode.m-gm .icon{background:color-mix(in srgb,var(--blue) 16%,var(--surface))}
.mode.m-sou .icon{background:color-mix(in srgb,#fff 40%,var(--orange))}
.mode.m-bap .icon{background:color-mix(in srgb,var(--accent) 40%,var(--surface))}
.mode .go{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.03em;font-size:15px;color:var(--bg);background:var(--ink);
  border-radius:999px;padding:7px 14px 6px 16px;display:inline-flex;align-items:center;gap:6px}
.mode .go::after{content:'\\2192';font-family:'Inter',system-ui,sans-serif;font-weight:800}
.mode .pill{font-size:12px;font-weight:800;color:var(--on-accent);background:var(--accent);border:0;border-radius:999px;padding:3px 9px}
.dailycta{display:flex;gap:10px;flex-wrap:wrap}
.dailycta .btn{display:inline-flex;align-items:center}
.hometiles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 16px;margin-bottom:18px}
.hometiles .tile .n{font-size:32px}

/* ===== content: typography and spacing, minimal containers ===== */
.panel{background:var(--surface);border:2px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:16px}
.panel p{margin:0 0 10px;font-size:14px;color:var(--muted);max-width:60ch}
.panel h3{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:24px;color:var(--ink);margin:0 0 6px}
.notice{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:2px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:14px}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:14px 16px;margin-bottom:20px}
.tile{border-top:3px solid var(--ink);padding:10px 2px 0}
.tile .n{font-family:var(--display);font-weight:400;font-size:38px;line-height:1}
.tile .l{font-size:13px;color:var(--muted);margin-top:4px}
.frow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.inp{font:inherit;font-size:16px;padding:9px 11px;border:2px solid var(--line2);border-radius:10px;min-width:0;flex:1;max-width:260px;color:var(--ink);background:var(--surface)}
.inp:focus{outline:none;border-color:var(--accent-ink);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent-ink) 25%,transparent)}
.seg{display:inline-flex;border:2px solid var(--btn-line);border-radius:10px;overflow:hidden;margin:4px 0 12px}
.seg button{background:none;border:none;padding:7px 14px;font-weight:700;font-size:14px;color:var(--muted)}
.seg button.on{background:var(--accent);color:var(--on-accent)}
.fields{display:grid;gap:10px;max-width:320px}
.fields label{display:grid;gap:4px;font-size:13px;font-weight:700;color:var(--muted)}
.fields .inp{max-width:none}
.err{color:var(--loss)!important;font-weight:700;margin:10px 0 0!important}
.fine{font-size:12.5px!important;margin:10px 0 0!important}
.guest{font-size:14px;color:var(--muted);margin:0 0 12px}
.lb{width:100%;border-collapse:collapse;font-size:14.5px;margin-bottom:20px}
.lb th{text-align:left;font-weight:800;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:6px 8px;border-bottom:2px solid var(--ink)}
.lb td{padding:10px 8px;border-bottom:1px solid var(--line)}
.lb td.r,.lb th.r{text-align:right}
.lb tr.me td{background:color-mix(in srgb,var(--accent) 30%,transparent)}
.lb .rk{font-family:var(--display);font-weight:400;font-size:22px;width:36px}
.you{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--on-accent);background:var(--accent);
  border-radius:4px;padding:1px 5px;margin-left:6px;vertical-align:2px}
.lb .crown{position:absolute;left:2px;top:0;font-size:16px;transform:rotate(-14deg)}
/* Leaderboard in black: giant ranks, lime for #1 only, and your own row outlined. */
.night .champion{background:radial-gradient(ellipse 80% 100% at 0% 0%,var(--glow),transparent 60%),var(--surface);box-shadow:inset 0 0 0 1px var(--line2)}
.night .champion .pickno{font-size:12px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
.night .lb th{border-bottom-color:var(--line2)}
.night .lb td{border-bottom-color:var(--line);vertical-align:middle}
.night .lb .rk{position:relative;font-size:40px;line-height:1;width:64px;text-align:center;color:var(--muted);padding:6px 4px}
.night .lb tr.first .rk{color:var(--accent);font-size:48px}
.night .lb td.v{font-family:var(--display);font-weight:400;font-size:22px}
.night .lb tr.me td{background:none}
.night .lb tr.me{outline:2px solid var(--accent);outline-offset:-2px}
.recent{border-top:2px solid var(--ink);margin-bottom:18px}
.rr{display:grid;grid-template-columns:70px 64px 1fr auto;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:center}
.rr .rec2{font-family:var(--display);font-weight:400;font-size:22px}
.dayhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.streak{display:inline-flex;align-items:baseline;gap:6px;font-size:13px;color:var(--muted)}
.streak b{font-family:var(--display);font-weight:400;font-size:24px;color:var(--accent-ink)}
.locked{background:var(--surface);border:2px solid var(--line);border-radius:14px;padding:16px;margin-bottom:16px}
.locked h3{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:26px;margin:0 0 6px}
.modal-bg{position:fixed;inset:0;z-index:50;background:rgba(16,17,20,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow-y:auto}
.modal{background:var(--bg);color:var(--ink);border:2px solid var(--ink);border-radius:18px;max-width:520px;width:100%;padding:22px 22px 18px;box-shadow:8px 8px 0 var(--hard)}
.modal h2{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:40px;line-height:.95;margin:0 0 12px;color:var(--ink)}
.modal ol{margin:0 0 12px;padding-left:22px}
.modal li{margin-bottom:9px;font-size:15px;line-height:1.45}
.modal li b{color:var(--ink)}
.modal .small{font-size:13px;color:var(--muted);margin:0 0 14px;line-height:1.45}
.sharebox{width:100%;min-height:150px;font:13px/1.45 ui-monospace,Menlo,monospace;background:var(--surface2);color:var(--ink);border:2px solid var(--line2);border-radius:10px;padding:10px;margin-top:10px}
.flexnote{border-left:3px solid var(--accent-ink);padding-left:12px;margin-top:10px}

/* ===== positions and grades ===== */
.pos-QB{--pc:var(--qb)} .pos-RB{--pc:var(--rb)} .pos-WR{--pc:var(--wr)} .pos-TE{--pc:var(--te)} .pos-FLEX{--pc:var(--flex)}
.ga{color:var(--ga)!important} .gb{color:var(--gb)!important} .gc{color:var(--gc)!important} .gd{color:var(--gd)!important}

/* ===== play screen: roster, spin reel, player board ===== */
.brand{display:flex;align-items:center;gap:12px}
.roster{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px;margin-bottom:12px}
.slot{border:1.5px dashed var(--line2);border-radius:10px;padding:7px 9px;min-height:58px;background:transparent;text-align:left;color:var(--ink)}
.slot .k{font-weight:800;font-size:12px;color:var(--pc,var(--muted))}
.slot .v{font-weight:600;font-size:14px;line-height:1.15;margin-top:3px}
.slot .sub{font-size:11.5px;color:var(--muted);margin-top:2px;font-weight:500}
.slot.filled{background:var(--surface);border:1.5px solid var(--line);box-shadow:inset 0 3px 0 var(--pc,var(--muted))}
.slot.target{border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
.modebar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.mb{border:2px solid var(--line2);background:var(--surface);color:var(--muted);border-radius:999px;padding:6px 13px;font-weight:700;font-size:14px}
@media (hover:hover){.mb:hover{color:var(--ink)}}
.mb.on{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.seedline{font-size:13px;color:var(--muted);margin-left:auto;display:flex;align-items:center;gap:8px}
.seedline code{font-family:ui-monospace,Menlo,monospace;font-size:14px;letter-spacing:1px;color:var(--accent-ink);background:var(--surface2);border-radius:6px;padding:3px 8px}
/* The draft's variant and scoring format as chips - Genius and GM mode in the colors of their Modes
   tiles, so the draft you're in reads at a glance. */
.seedline{flex-wrap:wrap;justify-content:flex-end;row-gap:6px}
.modechip{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:800;line-height:1.2;white-space:nowrap;border-radius:999px;padding:3px 10px;border:1.5px solid var(--line2);color:var(--ink);background:var(--surface)}
.modechip.genius{color:var(--genius);border-color:color-mix(in srgb,var(--genius) 60%,transparent);background:color-mix(in srgb,var(--genius) 16%,transparent)}
.modechip.gm{color:var(--gm);border-color:color-mix(in srgb,var(--gm) 60%,transparent);background:color-mix(in srgb,var(--gm) 16%,transparent)}
.reel{position:relative;overflow:hidden;margin-bottom:10px;padding:18px 20px 16px 22px;border-radius:16px;
  background:linear-gradient(102deg,var(--tc1) 0%,color-mix(in srgb,var(--tc1) 62%,var(--bg)) 46%,color-mix(in srgb,var(--tc1) 18%,var(--bg)) 82%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 12px 30px rgba(0,0,0,.35)}
.reel::before,.result-hero::before,.champion::before{content:'';position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1.4px);background-size:6px 6px;pointer-events:none}
.reel>*{position:relative;z-index:1}
.reel::after{content:'';position:absolute;z-index:0;top:-10%;bottom:-10%;right:7%;width:18px;background:var(--tc2);transform:skewX(-18deg);opacity:.7;box-shadow:26px 0 0 color-mix(in srgb,var(--tc2) 35%,transparent)}
.stripe{position:absolute;left:0;top:0;bottom:0;width:8px}
.reel .stripe{display:none}
.reel .pickno{font-size:13px;color:rgba(255,255,255,.75);display:flex;justify-content:space-between}
.reel .team{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(48px,11vw,80px);line-height:.95;color:#fff;margin:6px 0 2px;
  text-shadow:0 2px 0 rgba(0,0,0,.35),0 6px 24px rgba(0,0,0,.4);transform:skewX(-7deg);transform-origin:left bottom;letter-spacing:.01em}
.reel .years{font-family:var(--display);font-weight:400;--dot:3.2px;font-size:32px}
.reel .city{font-size:14px;color:rgba(255,255,255,.78);margin-left:10px}
.reel.spin .team,.reel.spin .years{opacity:.8;filter:blur(.6px)}
.rerolls{display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap}
.sticky{position:fixed;top:0;left:0;right:0;z-index:30;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--line);
  background:linear-gradient(102deg,color-mix(in srgb,var(--tc1) 78%,var(--bg)) 0%,color-mix(in srgb,var(--bg) 95%,transparent) 58%);transform:translateY(-110%);transition:transform .18s ease-out}
.sticky.show{transform:none}
.sticky .in{position:relative;max-width:900px;margin:0 auto;padding:8px 16px 8px 24px;display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap}
.sticky .stripe{width:6px;background:var(--tc2)!important}
.sticky .tm{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:26px;line-height:1;color:#fff;transform:skewX(-7deg)}
.sticky .yr{font-family:var(--display);font-weight:400;font-size:19px;line-height:1}
.sticky .pk{font-size:12px;color:var(--muted)}
.sticky .sp{margin-left:auto;display:flex;gap:6px}
.chips{display:flex;gap:4px}
.chip{font-size:11px;font-weight:800;padding:3px 6px;border-radius:5px;border:1px dashed var(--line2);color:var(--muted)}
.chip.on{border:1px solid transparent;color:var(--pc,var(--accent-ink));background:color-mix(in srgb,var(--pc,var(--accent)) 16%,transparent)}
.brk{display:none}
.sec{margin:0 0 22px}
.sec .hd{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin:0 0 8px;flex-wrap:wrap}
.sec h3{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:24px;margin:0;color:var(--ink);display:flex;align-items:center;gap:9px}
.sec h3::before{content:'';width:10px;height:10px;border-radius:3px;background:var(--pc,var(--muted));box-shadow:0 0 10px color-mix(in srgb,var(--pc,var(--muted)) 60%,transparent)}
.sec .nt{font-size:13px;color:var(--muted)}
.sec.done h3{color:var(--muted)}
.card{border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:6px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--pc,var(--muted)) 12%,var(--surface)) 0%,var(--surface) 40%);box-shadow:inset 4px 0 0 var(--pc,var(--muted));
  transition:transform .12s ease,border-color .12s}
@media (hover:hover){.card:hover:not(.off){border-color:var(--line2);transform:translateX(2px)}}
.card.sel{border-color:var(--accent);box-shadow:inset 4px 0 0 var(--pc,var(--muted)),0 0 0 1.5px var(--accent),0 10px 26px rgba(0,0,0,.45)}
.card.off{opacity:.4}
.hit{all:unset;display:block;width:100%;cursor:pointer;color:var(--ink)}
.hit:disabled{cursor:default}
.ps .hit:focus-visible{outline:3px solid var(--accent-ink);outline-offset:4px;border-radius:4px}
.card .row{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}
.nm-row{display:flex;align-items:center;gap:8px}
.card .nm{font-weight:700;font-size:16px}
.card .meta{font-size:13px;color:var(--muted);margin-top:2px}
.pp{font-size:11px;font-weight:800;color:var(--pc);background:color-mix(in srgb,var(--pc) 16%,transparent);border-radius:5px;padding:1px 6px}
.tdot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--tc1);box-shadow:0 0 0 1.5px var(--tc2);margin-right:6px;vertical-align:middle}
.cells{display:flex;flex-wrap:wrap;gap:6px 0}
.cell{width:62px}
.cell .n{font-weight:700;font-size:16px;line-height:1.1}
.cell:first-child .n{color:var(--pc)}
.cell .l{font-size:11px;color:var(--muted)}
.drafts{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}

/* ===== LED numerals: the wrapper glows, the inner text is cut into bulbs ===== */
.led-wrap{filter:drop-shadow(0 0 6px var(--glow)) drop-shadow(0 0 18px var(--glow))}
.led{display:inline-block;color:var(--accent);-webkit-mask-image:radial-gradient(circle,#000 56%,transparent 62%);mask-image:radial-gradient(circle,#000 56%,transparent 62%);
  -webkit-mask-size:var(--dot,6px) var(--dot,6px);mask-size:var(--dot,6px) var(--dot,6px)}

/* ===== season result ===== */
.result-hero{position:relative;overflow:hidden;border-radius:16px;padding:22px 22px 18px;margin-bottom:18px;
  background:radial-gradient(ellipse 70% 90% at 15% 0%,var(--glow),transparent 60%),var(--surface);box-shadow:inset 0 0 0 1px var(--line),5px 5px 0 ${PALETTE.ink}}
.rec{font-family:var(--display);font-weight:400;font-size:clamp(96px,24vw,156px);line-height:.85;color:var(--accent);--dot:7px}
.outcome{font-size:19px;font-weight:700;margin-top:10px}
.rating{font-size:14px;color:var(--muted);margin-top:4px}
/* Record first (the main draft's result; Build-a-player keeps the plain .rec above). */
.result-hero:has(.recbox){text-align:center}
.recbox{--rs:clamp(112px,36vw,196px)}
.recbox .rec,.wl{display:grid;grid-template-columns:1fr calc(var(--rs)*.5) 1fr}
.recbox .rec{font-size:var(--rs);--dot:8px}
.recbox .rec .led:first-child,.wl span:first-child{justify-self:end}
.recbox .rec .led:nth-child(2){justify-self:center}
.recbox .rec .led:last-child,.wl span:last-child{justify-self:start}
.wl{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-top:6px}
.outrow{display:flex;justify-content:center;align-items:baseline;gap:8px;margin-top:12px}
.outrow .outcome{margin-top:0;text-wrap:balance}
.oe{font-size:20px;line-height:1}
.result-hero .cel{position:static;overflow:visible;padding:0;margin:0 0 12px;border-radius:0;background:none;box-shadow:none}
.stamp{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--on-accent);background:var(--accent);
  border-radius:6px;padding:4px 10px;transform:rotate(-3deg);animation:stamp .5s cubic-bezier(.2,1.5,.4,1) both}
@keyframes stamp{from{opacity:0;transform:scale(1.8) rotate(-10deg)}to{opacity:1;transform:rotate(-3deg)}}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;margin-top:16px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.strip>div{padding:10px 6px;min-width:0}
.strip>div+div{border-left:1px solid var(--line)}
.strip .n{font-family:var(--display);font-weight:400;font-size:28px;line-height:1.05}
.strip .n.up{color:var(--win)}
.strip .n.down{color:var(--loss)}
.strip .l{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:4px}
.strip .s{font-size:12px;color:var(--muted)}
.moments{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:14px}
.mo{font-size:13px;font-weight:700;color:var(--ink);border-radius:999px;padding:4px 11px;box-shadow:inset 0 0 0 1px var(--line2)}
.mo.crown{color:var(--on-accent);background:var(--accent);box-shadow:none}
.mo.upset{color:var(--orange);background:color-mix(in srgb,var(--orange) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--orange) 55%,transparent)}
.mo.streak{color:var(--gc);background:color-mix(in srgb,var(--gc) 12%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gc) 50%,transparent)}
.mo.streak.milestone{font-size:15px;padding:6px 14px;box-shadow:inset 0 0 0 2px var(--gc)}
.mo.best{color:var(--win);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--win) 45%,transparent)}
.alarm{margin-top:12px;text-align:left;font-size:14px;border-radius:12px;padding:10px 14px;
  background:linear-gradient(90deg,color-mix(in srgb,var(--orange) 22%,transparent),transparent);box-shadow:inset 3px 0 0 var(--orange)}
.alarm b{color:var(--orange)}
.log{display:grid;grid-template-columns:repeat(auto-fill,minmax(98px,1fr));gap:6px;margin:8px 0 22px}
.g{border-radius:9px;padding:6px 8px;font-size:12px;background:var(--surface);border:1.5px solid var(--line);border-left:3px solid transparent;animation:pop .25s ease-out both}
.g .w{font-weight:800;font-size:15px}
.g.win{background:linear-gradient(90deg,color-mix(in srgb,var(--ga) 16%,var(--surface)),var(--surface) 70%);border-left-color:var(--ga)}
.g.loss{background:linear-gradient(90deg,color-mix(in srgb,var(--gd) 16%,var(--surface)),var(--surface) 70%);border-left-color:var(--gd)}
.g.win .w{color:var(--ga)} .g.loss .w{color:var(--gd)}
.g.po{box-shadow:0 0 0 1px var(--accent) inset}
.g.up{border-color:var(--orange);box-shadow:0 0 0 1px var(--orange) inset}
.g.up .w::after{content:" 🚨"}
.g .o{color:var(--muted)}
@keyframes pop{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.reveal{border-top:1px solid var(--line)}
.rv{display:grid;grid-template-columns:44px 1fr auto auto;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line)}
.rv .s{font-weight:800;font-size:13px;color:var(--pc,var(--accent-ink))}
.rv .p{font-weight:700}
.rv .t{font-size:13px;color:var(--muted)}
.rv .pts{text-align:right;font-weight:700}
.rv .pts small{display:block;font-weight:400;font-size:12px;color:var(--muted)}
.gr{font-family:var(--display);font-weight:400;font-size:26px;min-width:38px;text-align:right}
.recap{border-top:1px solid var(--line);margin-bottom:8px}
.rc{display:grid;grid-template-columns:28px 1fr 1fr;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);font-size:14px;align-items:start}
.rc .n{font-family:var(--display);font-weight:400;font-size:22px;color:var(--muted)}
.rc .bd{font-size:12px;color:var(--muted);margin-bottom:2px}
.rc .tk{font-weight:700}
.rc .g2{font-family:var(--display);font-weight:400;margin-left:6px;color:var(--accent-ink)}
.rc .alt{color:var(--muted)}
.rc .alt b{color:var(--ink);font-weight:600}
.rc .ok{color:var(--win);font-weight:700}
.recap-sum{font-size:15px;margin:2px 0 10px}
.recap-sum b{font-family:var(--display);font-weight:400;font-size:24px;color:var(--accent-ink)}
.pre{border-radius:16px;padding:18px;margin-bottom:18px;background:radial-gradient(ellipse 60% 100% at 0% 0%,var(--glow),transparent 65%),var(--surface);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent)}
.pre h3{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:36px;margin:0;color:var(--accent)}
.pre p{margin:4px 0 14px;color:var(--muted);font-size:15px}
.champion{position:relative;overflow:hidden;border-radius:16px;padding:18px 20px 18px 24px;margin-bottom:20px;
  background:radial-gradient(ellipse 70% 100% at 0% 0%,var(--glow),transparent 60%),var(--surface);box-shadow:5px 5px 0 ${PALETTE.ink}}
.champion .sc{font-family:var(--display);font-weight:400;font-size:68px;line-height:.9;color:var(--accent);--dot:5px}
.champion .by{font-size:16px;font-weight:700;margin-top:6px}
.champion .ln{font-size:13px;color:var(--muted);margin-top:8px;line-height:1.5}
.champion .pickno{font-size:13px;color:var(--muted)}

/* ===== playoff game ===== */
.pg{position:relative;overflow:hidden;border-radius:16px;padding:14px 16px 16px;margin-bottom:18px;background:var(--surface);box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 12px 30px rgba(0,0,0,.35)}
.pg-top{display:flex;justify-content:space-between;font-size:13px;color:var(--muted);font-weight:700}
.sb{display:grid;grid-template-columns:1fr auto 1fr;align-items:end;gap:10px;margin:6px 0 12px}
.sb .tm{font-weight:700;font-size:14px;color:var(--muted)}
.sb .r{text-align:right}
.sb .pts{font-family:var(--display);font-weight:400;font-size:clamp(44px,12vw,64px);line-height:1;color:var(--ink);transition:color .3s;--dot:4px}
.sb .pts .led{color:var(--ink)}
.sb .lead .pts,.sb .lead .pts .led{color:var(--accent)}
.sb .lead .tm{color:var(--ink)}
.sb .pts.led-wrap{filter:drop-shadow(0 0 5px var(--glow))}
.clock{font-family:var(--display);font-weight:400;font-size:22px;text-align:center;min-width:84px;padding-bottom:6px}
.clock small{display:block;font-family:'Inter',system-ui,sans-serif;font-size:14px;font-weight:700;color:var(--muted)}
.field{position:relative;display:grid;grid-template-columns:9% 1fr 9%;height:60px;border-radius:8px;overflow:hidden}
.ez{display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:rgba(255,255,255,.6);background:#1A4A2E;writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:.5px;overflow:hidden;white-space:nowrap}
.ez.r{background:color-mix(in srgb,var(--accent) 26%,#10201A);color:var(--accent);transform:none}
.yards{position:relative;background:#1f5233;background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.22) 0 1px,transparent 1px 10%),repeating-linear-gradient(90deg,transparent 0 10%,rgba(0,0,0,.08) 10% 20%)}
.fifty{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family:var(--display);font-weight:400;font-size:18px;color:rgba(255,255,255,.28)}
.ball{position:absolute;top:50%;width:14px;height:9px;border-radius:50%;background:#e9e2d0;transform:translate(-50%,-50%);transition:left .32s cubic-bezier(.2,.7,.3,1);box-shadow:0 0 0 2px rgba(0,0,0,.25);animation:fadein .25s ease-out}
.ball.air{transition:left .5s cubic-bezier(.3,.1,.3,1)}
.ball.mine{background:var(--accent);box-shadow:0 0 10px var(--glow)}
@keyframes fadein{from{opacity:0}to{opacity:1}}
.trail{position:absolute;top:50%;height:4px;transform:translateY(-50%);background:rgba(233,226,208,.35);border-radius:2px;transition:left .32s cubic-bezier(.2,.7,.3,1),width .32s cubic-bezier(.2,.7,.3,1)}
.trail.mine{background:color-mix(in srgb,var(--accent) 50%,transparent)}
.flash{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--bg) 80%,transparent);font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(24px,6vw,36px);color:var(--ink);animation:pop .2s ease-out both;text-align:center;padding:0 10px}
.flash.mine{color:var(--accent)}
.pbp{margin-top:8px;min-height:2.6em}
.pbp .now{font-size:14px;font-weight:700;color:var(--ink)}
.spot{margin-top:2px;font-size:13px;color:var(--muted)}
.spot.rz{color:var(--accent)}
.plog{margin-top:8px;font-size:13px;color:var(--muted);min-height:3.9em;line-height:1.3}
.plog div:first-child{color:var(--ink)}
.pfinal{margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.fin{font-family:var(--display);font-weight:400;font-size:32px}
.fin.w{color:var(--win)} .fin.l{color:var(--loss)}

/* ===== celebration ===== */
.cel{position:relative;overflow:hidden;border-radius:16px;padding:16px 18px;margin-bottom:16px;text-align:center;
  background:radial-gradient(ellipse 80% 120% at 50% 0%,color-mix(in srgb,var(--accent) 30%,transparent),transparent 65%),var(--surface);box-shadow:inset 0 0 0 2px var(--accent)}
.cel .big{font-family:var(--display);font-weight:400;text-transform:uppercase;line-height:.92;font-size:clamp(36px,10vw,60px);color:var(--accent)}
.cel .sml{font-size:15px;color:var(--ink);margin-top:6px}
.cel.perfect .big{background:linear-gradient(100deg,#E4FF8A,#B8F500 35%,#F7F4EA 50%,#B8F500 65%,#8DBB00);-webkit-background-clip:text;background-clip:text;color:transparent;
  background-size:250% 100%;animation:sheen 2.6s linear infinite}
@keyframes sheen{from{background-position:160% 0}to{background-position:-60% 0}}
.confetti{position:absolute;inset:0;pointer-events:none}
.confetti i{position:absolute;top:-12%;width:7px;height:12px;border-radius:1px;opacity:0;animation:fall 2.6s ease-in forwards}
@keyframes fall{0%{opacity:0;transform:translateY(0) rotate(0)}10%{opacity:1}100%{opacity:0;transform:translateY(320px) rotate(520deg)}}

/* ===== over/under ===== */
.sou-hud{display:flex;align-items:center;gap:16px;margin-bottom:12px}
.sou-hearts{font-size:28px;line-height:1;letter-spacing:3px}
.sou-score{font-family:var(--display);font-weight:400;font-size:21px;color:var(--ink)}
.sou-timer{font-family:var(--display);font-weight:400;font-size:38px;color:var(--accent-ink);min-width:56px;text-align:center;transition:color .15s}
.sou-timer.danger{color:var(--loss);animation:sou-pulse .5s ease-in-out infinite}
@keyframes sou-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
.sou-hud{flex-wrap:wrap}
.sou-timer{margin-left:auto}
.sou-teams{max-width:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.panel p.sou-line{font-size:18px;margin:10px 0 12px;color:var(--ink);max-width:none}
/* Big, equal answer buttons: a mis-tap costs a life. */
.sou-slot{min-height:108px}
.sou-answers{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sou-answers .btn{min-height:56px;font-size:22px;touch-action:manipulation}
.panel p.sou-fb{min-height:48px;margin:0 0 10px;font-weight:700;color:var(--ink);max-width:none}
.panel p.sou-fb.ok{color:var(--win)}
.panel p.sou-fb.miss{color:var(--loss)}
@media (max-width:360px){.sou-hearts{font-size:22px;letter-spacing:1px}}
@media (max-height:500px) and (orientation:landscape){.sou-hud{margin-bottom:6px}.sou-timer{font-size:28px}.sou-hearts{font-size:22px}.sou-slot{min-height:auto}.sou-answers .btn{min-height:44px;font-size:18px}.panel p.sou-fb{min-height:0}}

/* ===== responsive ===== */
@media (max-width:640px){
  .modes{gap:12px}.mode{padding:14px}.mode .mn{font-size:26px}.mode .icon{width:38px;height:38px;font-size:19px;border-radius:10px}
  .btn.reset{margin-left:0}.rc{grid-template-columns:24px 1fr}.rc .alt{grid-column:2}
  .cells{display:grid;grid-template-columns:repeat(4,1fr);width:100%;gap:8px 6px}.cell{width:auto}
  .sticky .in{padding:6px 12px 7px 18px;gap:4px 8px}.sticky .tm{font-size:24px}.sticky .chip{padding:2px 4px;font-size:10.5px}
  .sticky .btn.sm{padding:4px 8px;font-size:11.5px}.sticky .pk{display:none}.sticky .sp{margin-left:auto}
  .roster{grid-template-columns:repeat(3,minmax(0,1fr))}.title{font-size:36px}
  .tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.tile .n{font-size:clamp(26px,9vw,38px)}.tiles .tile:last-child:nth-child(odd){grid-column:1/-1}
  .lb .hide{display:none}.rr{grid-template-columns:56px 56px 1fr}.rr .sc2{display:none}.brk{display:block;flex-basis:100%;height:0}
}
/* Below ~760px the tabs and the links no longer fit one row: links get their own row. */
@media (max-width:760px){
  .nav .hdr-links{margin-left:0;width:100%;justify-content:flex-start}
}
/* Phones: links on top, then the six tabs as an even 3x2 grid instead of a ragged wrap. */
@media (max-width:520px){
  .nav{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
  .nav .hdr-links{grid-column:1/-1;order:-1;justify-content:flex-end;margin-bottom:2px}
  .tab{padding:8px 4px;font-size:14px;text-align:center}
  .hometiles{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hometiles .tile:last-child:nth-child(odd){grid-column:1/-1}
}
/* ===== mobile pass (1.8.0): fixes from the phone-size audit ===== */
/* Draft: slots read top-down, and a long surname breaks rather than widening its column (the
   columns themselves are minmax(0,1fr) in the base .roster rule and its phone override). */
.slot{min-width:0;display:flex;flex-direction:column;justify-content:flex-start}
.slot .v{overflow-wrap:break-word;-webkit-hyphens:auto;hyphens:auto}
.rerolls .left{font-weight:600;opacity:.75}
.rs-short{display:none}
/* GM mode: the budget rides along in the sticky bar while you browse a long board */
.sticky .stcap{font-size:12px;font-weight:800;color:var(--ink);background:color-mix(in srgb,var(--ink) 14%,transparent);border-radius:999px;padding:2px 8px;white-space:nowrap}
.sticky .stcap.over{color:var(--loss)}
/* Leaderboard: record under the name, shown only on the narrowest phones (see the 360px rule) */
.lb .subrec{display:none}
/* The admin panel collapses (its heading is the summary) */
.adminpanel>summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between}
.adminpanel>summary::-webkit-details-marker{display:none}
.adminpanel>summary::after{content:'▸';font-size:16px;color:var(--muted);transition:transform .15s}
.adminpanel[open]>summary::after{transform:rotate(90deg)}
.adminpanel>summary h3{margin:0}
.adminpanel[open]>summary{margin-bottom:8px}
/* Salary reads as a tag, not a button */
.card .pill{border:0;background:color-mix(in srgb,var(--ink) 12%,transparent);font-size:12px;padding:2px 8px}
.result-hero .cel.bapcel{text-align:left}
.reel .years{margin-right:10px}
.reel .city{margin-left:0}
/* The whole draft card is the tap target, not just the area inside its padding. Only cards built
   around a .hit button - the Players index renders plain cards that keep their own padding. */
.card:has(>.hit){padding:0}
.card>.hit{padding:10px 12px;box-sizing:border-box}
.card>.drafts{padding:0 12px 12px;margin-top:0}
.drafts{scroll-margin:110px 0 16px}
.sec .nt,.card .meta{text-wrap:pretty}
.reel .city{display:inline-block}
.reel .pickno,.reel .city{text-shadow:0 1px 2px rgba(0,0,0,.55)}
.codechip{white-space:nowrap}
.gmleft{font-weight:700;color:var(--muted)}
/* Results */
.recbox{--rs:clamp(96px,min(30vw,34vh),196px)}
.recbox .rec,.wl{grid-template-columns:minmax(0,1fr) calc(var(--rs)*.5) minmax(0,1fr)}
.outrow{display:block;text-align:center;text-wrap:balance}
.outrow .outcome{display:inline}
.oe{display:inline-block;margin-right:8px;vertical-align:-1px}
.strip .n{white-space:nowrap;font-size:clamp(22px,7vw,28px)}
.strip .n .em{font-size:.6em;vertical-align:.3em;margin-right:2px}
.strip .s{text-wrap:balance}
.mo{border-radius:14px}
.resultactions{margin:0 0 18px}
.log{grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}
.g{position:relative}
.g.up .w::after{content:none}
.g.up::after{content:"🚨";position:absolute;top:5px;right:7px;font-size:13px;line-height:1}
.g.po.up{box-shadow:0 0 0 1px var(--accent) inset}
.pre h3{line-height:1}
.pg-top{gap:12px}
.pg-top span:last-child{white-space:nowrap}
.flash{line-height:1}
.ez{font-size:9px;letter-spacing:0}
/* Leaderboard */
.champion .pickno{text-wrap:balance;margin-bottom:4px}
.night .lb tr.me td{box-shadow:inset 0 2px 0 var(--accent),inset 0 -2px 0 var(--accent)}
.night .lb tr.me td:first-child{box-shadow:inset 2px 2px 0 var(--accent),inset 0 -2px 0 var(--accent)}
/* Stats rank boards: rank, name and value on one row */
.rc.rank{grid-template-columns:28px minmax(0,1fr) auto;align-items:center}
.rc.rank .alt{text-align:right}
.rc.rank .tk{overflow-wrap:anywhere}
/* Players: the chooser stays reachable on a long board */
.pickerbar{position:sticky;top:0;z-index:5;background:var(--bg);padding-block:8px;margin-bottom:6px;box-shadow:0 1px 0 var(--line)}
@media (max-width:720px) and (orientation:portrait){
  .cells{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));width:100%;gap:8px 6px}.cell{width:auto}
  .cell .l,.pp{font-size:12px}
}
@media (max-width:640px){
  .rc.rank{grid-template-columns:24px minmax(0,1fr) auto}.rc.rank .alt{grid-column:auto}
  .cell .l,.pp,.slot .sub{font-size:12px}
  .ps select.inp{flex:1 1 130px}
}
@media (max-width:480px){
  .sticky .sp,.sticky .brk{display:none}
  .drafts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  .drafts .btn.solid{grid-column:1/-1;min-width:0}
  .rerolls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
  .rerolls .note{grid-column:1/-1}
  .rerolls .btn.reset{margin-left:0}
  .rs-long{display:none}.rs-short{display:inline}
  .rs-short b{font-weight:800;margin-left:3px;padding:1px 7px;border-radius:999px;background:color-mix(in srgb,var(--ink) 14%,transparent)}
  .rerolls .btn{padding:8px 6px;font-size:13.5px}
  .slot .sub{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .reel .pickno{padding-right:44px}
  .reel{padding:12px 14px 12px 16px}.reel .team{font-size:40px}.reel .years{font-size:26px}.reel::after{right:3%}
  .fmtpick .fmtlabel{flex-basis:100%;margin:0}
  .fmtpick.ladderpick .fmtbtn{flex:1 1 calc(50% - 4px);align-items:center}
  .dayhead{flex-wrap:nowrap;align-items:flex-start}.dayhead .linkbtn{flex:none;margin-top:6px}
  .ps select.inp{flex:1 1 120px;max-width:none}
  .resultactions .btn{flex:1 1 auto}
}
@media (max-width:400px){
  .night .lb .rk{width:44px;font-size:32px;padding:6px 0}
  .night .lb tr.first .rk{font-size:38px}
  .lb th,.lb td{padding-left:5px;padding-right:5px}
  .lb .crown{left:-6px;top:-9px;font-size:14px}
}
/* Home */
.dailycta{display:grid;gap:10px}
.dailycta .btn{justify-content:space-between;flex-wrap:wrap;gap:6px 10px;text-align:left}
.dailycta .go{white-space:nowrap}
.modal-bg{overscroll-behavior:contain}
.modal{position:relative}
.modal h2{padding-right:52px}
.modal-x{position:absolute;top:10px;right:10px;width:44px;height:44px;border-radius:12px;border:2px solid var(--line2);background:var(--surface);
  color:var(--ink);font-size:22px;line-height:1;display:flex;align-items:center;justify-content:center}
.nowrap{white-space:nowrap}
@media (max-width:359px){.modal h2{font-size:34px}.dailycta .btn{flex-direction:column;align-items:flex-start}
  .seedline{flex-basis:100%;margin-left:0;flex-wrap:wrap;justify-content:flex-start}
  .hdr-links{gap:7px}.hdrchip.help{padding-right:9px}.whoami{gap:5px}.ver{padding:2px 5px}
  .slot .v{font-size:13px}
  .modebar{gap:4px}.mb{padding:5px 10px;font-size:13px}
  .reel{padding:10px 12px 10px 14px}.reel .team{font-size:36px}.reel .years{font-size:22px}
  .lb .lbrec{display:none}.lb .subrec{display:block;font-size:12px;font-weight:500;color:var(--muted);margin-top:1px}
  .lb td.nm{overflow-wrap:anywhere}}
/* Build-a-player */
.frow.bap-pos{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.frow.bap-pos .btn{min-height:52px}
/* One card-like choice per attribute: the name on the left, its grade as a big tier-colored chip on the right.
   Plain buttons rather than lime - lime stays reserved for the one main action on a screen. */
.frow.bap-attrs{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;max-width:760px}
.frow.bap-attrs .btn{min-height:52px;justify-content:space-between;gap:12px;padding:8px 8px 8px 14px;text-align:left;font-size:15px;box-shadow:2px 2px 0 var(--hard)}
.frow.bap-attrs .btn>span:first-child{min-width:0;overflow-wrap:anywhere}
.bapgrade{flex:none;font-weight:800;font-size:17px;line-height:1;min-width:46px;text-align:center;border-radius:8px;padding:8px 8px 7px;background:var(--surface2);color:var(--ink)}
.rc.bap{grid-template-columns:minmax(0,1fr) auto;align-items:baseline}
.rc.bap .bd{font-size:14px;color:var(--ink);margin:0}
.rc.bap .tk{margin-left:6px}
.rc.bap .alt{text-align:right}
.result-hero .cel.bapcel{margin:12px 0 0}
@media (max-width:640px){.rc.bap{grid-template-columns:1fr}.rc.bap .alt{grid-column:auto;text-align:left}}
.seg button:focus-visible{outline-offset:-3px}
/* Short landscape phones: the hero and the draft reel give the first screen back */
@media (max-height:500px) and (orientation:landscape){
  .hero{margin:0 0 16px;padding-top:0}.eyebrow{margin-bottom:6px}
  .headline .hl1{font-size:clamp(30px,9vh,78px)}.headline .big20{font-size:clamp(60px,22vh,236px)}
  .herosub{margin:8px 0 10px;font-size:20px;max-width:none}.heroexplain{display:none}
  .reel{padding:10px 14px}.reel .team{font-size:36px}.reel .years{font-size:22px}
  .sticky .chips{display:none}
}
/* Touch screens: 44px targets. Text links keep their look and get a larger invisible hit area. */
@media (pointer:coarse){
  .btn,.fmtbtn,.seg button,.tab,.inp{min-height:44px}
  /* Real controls sit above the invisible link hit areas below, so a tap near a button's edge
     never lands on a neighbouring link (e.g. "Skip to the end" under "Kick off"). */
  .btn,.fmtbtn,.tab{position:relative;z-index:1}
  .linkbtn,button.pill,.mb,.whoami,.namelink{position:relative}
  .mb::after{content:'';position:absolute;left:-3px;right:-3px;top:-6px;bottom:-6px}
  .whoami::after{content:'';position:absolute;left:-4px;right:-4px;top:-10px;bottom:-4px}
  /* Names sit in rows about 40px apart, so their hit areas stop short of the next row's. */
  .namelink::after{content:'';position:absolute;left:-6px;right:-6px;top:-10px;bottom:-10px;min-width:44px}
  /* The header chips sit just above the tab grid on phones: keep their hit areas off the tabs. */
  .nav button.pill::after{bottom:-4px}
  .nav .tab{min-height:40px}
  .linkbtn::after{content:'';position:absolute;left:-6px;right:-6px;top:-13px;bottom:-13px}
  button.pill::after{content:'';position:absolute;left:-4px;right:-4px;top:-8px;bottom:-8px}
}

/* ===== reduced motion ===== */
@media (prefers-reduced-motion:reduce){
  .confetti{display:none}
  .stamp{animation:none}
  .cel.perfect .big{animation:none;background:none;color:var(--accent)}
  .sou-timer.danger{animation:none}
  .g,.flash,.ball{animation:none}
  .ball,.trail,.sticky{transition:none}
  .btn,.mode,.fmtbtn,.card,.tab{transition:none}
  .btn:hover:not(:disabled),.btn:active:not(:disabled),.mode:hover:not(.static),.mode:active:not(.static),.fmtbtn:hover,.card:hover:not(.off){transform:none}
}
`;
// The whole stylesheet the app renders, for previewing one screen on its own (the UI harness).
// The screens in their own files bring their own rules, each scoped to its class prefix (pf-, av-, ap-,
// md-), after the base stylesheet so they can reuse its tokens and classes.
export const APP_CSS = CSS + PROFILE_CSS + AVATAR_CSS + PICKER_CSS + MODERATION_CSS + COSMETICS_CSS + SHOP_CSS;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Screens share one page, so the browser would otherwise open a new screen at the old screen's
// scroll offset. A no-op where nothing is scrolled (and in the test DOM, which has no layout).
const scrollToTop = () => { try { if (typeof window !== "undefined" && window.scrollY > 0) window.scrollTo(0, 0); } catch (e) { /* no layout */ } };

// ---------- Storage ----------
// Accounts and sessions are now handled by Supabase Auth (storage.js's authSignUp/authSignIn/
// authGetSession/authOnChange) - no client-side password hashing or session token needed.
// Personal (device):  ps-profile -> pre-login guest stats, folded into the real account on signup
const OLD_PROFILE = "ps-profile";

function blankStats(username) {
  return { username, runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0,
    bestScore: null, bestRun: null, bestRecord: null, recent: [], created: Date.now() };
}

const topPct = (rank, total) => {
  const p = (100 * rank) / total;
  return p < 1 ? `Top ${p.toFixed(1)}%` : `Top ${Math.max(1, Math.round(p))}%`;
};

// What the Stats screen renders before site_stats() answers, or if it fails - the same shape
// storage.js's fetchSiteStats returns, every board empty.
const EMPTY_SITE_STATS = {
  totals: { runs: 0, perfect: 0, players: 0 },
  byFormat: Object.fromEntries(FORMATS.map((f) => [f, { bestLineups: [], bestGm: [], biggestUpsets: [] }])),
  mostDrafted: [], mostWins: [], mostChamps: [], mostPlayoffs: [], longestStreaks: [], bestWinPct: [], avgWinPct: 0,
};
// Signup's refusals. The username rule itself is profile-rules.mjs's USERNAME_RE, the one the database uses.
const USERNAME_RULE = "Usernames are 3 to 16 characters: letters, numbers, and underscores.";
const NAME_NOT_ALLOWED = "That username isn't allowed. Try another one.";

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
  // Collapsed by default on phones, where the open panel pushed the whole draft off the first screen.
  const startOpen = typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 641px)").matches;
  return (
    <details className="panel adminpanel" open={startOpen}>
      <summary><h3>Admin tools</h3></summary>
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
    </details>
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
  // The chooser is sticky, so changing team deep in a long board would otherwise open the new
  // board at the same depth. Jump back to its top instead.
  const topRef = useRef(null);
  const backToTop = () => {
    const el = topRef.current;
    if (el?.getBoundingClientRect && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: "start" });
  };
  return (
    <>
      <h2 className="h" ref={topRef}>Players</h2>
      <p className="note" style={{ marginTop: 0 }}>
        Browse every player who's ever qualified for a board, by team and era.
      </p>
      <div className="frow pickerbar" style={{ flexWrap: "wrap", gap: 8 }}>
        <select className="inp" value={team} onChange={(e) => { setTeam(e.target.value); backToTop(); }} aria-label="Team">
          <option value="">Team</option>
          {TEAM_CODES.map((t) => <option key={t} value={t}>{TEAMS[t][0]}</option>)}
        </select>
        <select className="inp" value={w} onChange={(e) => { setW(e.target.value); backToTop(); }} aria-label="Era">
          <option value="">Era</option>
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

// ---------- Profile links and addresses (PROFILES.md 7) ----------
// Every username shown for an account opens that player's profile. The boards that show them are
// module-scope components (PlayerName, RankRows, ...) with no route to the app's navigation, so the
// app hands its openProfile down through this context instead of threading a prop through each board.
const OpenProfile = createContext(null);
function NameLink({ name }) {
  const openProfile = useContext(OpenProfile);
  if (!name || !openProfile) return name || null;
  return <button type="button" className="namelink" onClick={() => openProfile(name)}>{name}</button>;
}

// The screens history entries describe: a player's profile, at profilePath(name), or any other view, at "/".
// The address alone can only name a profile or Modes, so an entry without a screen of its own (a typed
// address, or one written before this) is read from its address.
const HISTORY_VIEWS = ["home", "play", "profile", "players", "board", "stats", "statsou", "buildplayer", "reports"];
function screenOf(state, pathname) {
  if (state?.ps === "profile" && typeof state.name === "string" && state.name) return state;
  if (state?.ps === "view" && HISTORY_VIEWS.includes(state.view)) return state;
  const name = parseProfilePath(pathname);
  return name ? { ps: "profile", name } : { ps: "view", view: "home" };
}
const sameScreen = (a, b) => a.ps === b.ps && (a.ps === "profile" ? a.name === b.name : a.view === b.view);
// A profile's sitewide rank in each format before it's known, or when the player has no score in it.
const NO_RANK = Object.fromEntries(FORMATS.map((f) => [f, null]));
// History writes are best effort. A page opened from a file (the UI harness) can't change its path, so the
// entry is then written at the address it already has, and Back and Forward still move between screens.
function writeHistory(method, state, url) {
  if (url != null) {
    try { window.history[method](state, "", url); return; } catch (e) { /* this page can't take that address */ }
  }
  try { window.history[method](state, ""); } catch (e) { /* no history API */ }
}

// A plain "#rank — username — value" leaderboard, shared by every zero-frills Stats leaderboard
// (wins, championships, playoffs, streak, win %, GM score) - the same .rc grid every other
// leaderboard-style row in this app uses, just without a bd/tk label pair in the middle column.
function RankRows({ rows, empty, value }) {
  if (rows.length === 0) return <p className="note" style={{ marginTop: 0 }}>{empty}</p>;
  return (
    <div className="recap">
      {rows.map((r, i) => (
        <div className="rc rank" key={r.id || i}>
          <div className="n">{i + 1}</div>
          <div className="tk"><NameLink name={r.username} /></div>
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
    if (mode === "signup" && !USERNAME_RE.test(username)) return setErr(USERNAME_RULE);
    if (pw.length < 6) return setErr("Passwords need at least 6 characters.");
    if (mode === "signup" && pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    try {
      if (mode === "signup") {
        // Asked before signing up so the form can say why a name won't do. The database checks the name
        // again at signup, so a check that couldn't run (null) just goes ahead.
        const check = await checkUsername(username);
        const refused = { taken: "That username is taken. Try another one.", blocked: NAME_NOT_ALLOWED, invalid: USERNAME_RULE }[check];
        if (refused) { setBusy(false); return setErr(refused); }
        const { data, error } = await authSignUp(emailTrim, pw, username);
        // A blocked name that got past the check is refused by the signup trigger, which Supabase Auth
        // only reports as a database error.
        if (error) { setBusy(false); return setErr(/Database error saving new user/i.test(error.message || "") ? NAME_NOT_ALLOWED : mapAuthError(error)); }
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

  // A real form, so a phone keyboard offers "Go" and password managers recognize the login.
  const onSubmit = (e) => { e.preventDefault(); if (!busy) submit(); };
  return (
    <div className="panel">
      {title && <h3>{title}</h3>}
      {blurb && <p>{blurb}</p>}
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setErr(""); }}>Log in</button>
        <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setErr(""); }}>Create account</button>
      </div>
      <form onSubmit={onSubmit} noValidate>
        <div className="fields">
          <label>Email<input className="inp" type="email" value={email} autoComplete="email" autoCapitalize="none" spellCheck={false} onChange={(e) => setEmail(e.target.value)} /></label>
          {mode === "signup" && <label>Username<input className="inp" value={u} maxLength={16} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setU(e.target.value)} /></label>}
          <label>Password<input className="inp" type="password" value={pw} autoComplete={mode === "signup" ? "new-password" : "current-password"} onChange={(e) => setPw(e.target.value)} /></label>
          {mode === "signup" && <label>Confirm password<input className="inp" type="password" value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} /></label>}
        </div>
        {err && <p className="err" role="alert">{err}</p>}
        <div className="frow" style={{ marginTop: 10 }}>
          <button type="submit" className="btn solid" disabled={busy}>{busy ? "Checking…" : mode === "login" ? "Log in" : "Create account"}</button>
        </div>
      </form>
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
// Whether a finished daily ended in a title, for choosing its button's tone. Saved results carry
// `champ` from the sim; ones saved before that field existed fall back to the outcome text.
const wonItAll = (rec) => rec?.champ ?? /^(Won the championship|Perfect season)/.test(rec?.outcome || "");
const pointsOf = (p, ladder) => (p?.points?.[ladder] ?? 0);

// ---------- Result moments (display only) ----------
// A game's pre-kickoff win chance, from the same opponent rating simulateSeason used for it (the
// regular-season rating, or the playoff one). Worked out when the result is shown, so the
// simulation, the seed and the saved outcome are all untouched.
const OPP_BY_KEY = new Map(OPPS.map((o) => [`${o.season}|${o.team}`, o]));
export const UPSET_CHANCE = 0.35; // a win this unlikely, or less, is an upset
export function gameWinChance(score, g) {
  const o = OPP_BY_KEY.get(`${parseInt(g.opp, 10)}|${g.oppTeam}`);
  const rating = o && (g.playoff ? o.po : o.reg);
  return rating == null ? null : winProb(score, rating);
}
export const isUpsetWin = (score, g) => g.win && (gameWinChance(score, g) ?? 1) <= UPSET_CHANCE;
export const STREAK_MILESTONES = [3, 7, 14, 30];
// Emoji go on at display time only - the outcome strings are stored in runs and daily_runs.
// 🏆 a title, 💀 four wins or fewer, 🧊 any other missed playoffs; a playoff exit gets none.
export const outcomeEmoji = (r) => (wonItAll(r) ? "🏆" : r.w <= 4 ? "💀" : r.outcome === "Missed the playoffs" ? "🧊" : null);

// The oversized record. Wins and losses sit in their own columns either side of the dash so the
// labels underneath line up whatever the digits - and the record's text is still exactly "16–4".
function RecordLine({ games }) {
  const w = games.filter((g) => g.win).length;
  return (
    <div className="recbox">
      <div className="rec led-wrap"><span className="led">{w}</span><span className="led">–</span><span className="led">{games.length - w}</span></div>
      <div className="wl" aria-hidden="true"><span>Wins</span><span /><span>Losses</span></div>
    </div>
  );
}

// Team score, points and this season's rank, in one strip under the record. The rank arrives a
// moment after the season ends (it needs the runs log): undefined while loading, null when it
// can't be worked out, which leaves the cell out rather than showing a wrong number.
export function SeasonStrip({ result, ladderName }) {
  const cells = [{ key: "score", n: result.score.toFixed(1), l: "Team score", s: result.par != null ? `par ${result.par.toFixed(1)}` : null }];
  if (result.par != null) {
    const p = result.points;
    // The 📈 is a small raised mark rather than a full-size glyph, so the number stays on one line.
    cells.push({ key: "pts", n: p > 0 ? <><span className="em" aria-hidden="true">📈</span>+{p.toLocaleString()}</> : p.toLocaleString(), tone: p > 0 ? "up" : p < 0 ? "down" : "", l: "Points", s: `${ladderName} ladder` });
  }
  if (result.rank !== null) {
    const r = result.rank;
    cells.push(r
      // A percentile only when it says something: over a real sample, and for the top half ("Top 100%" isn't a boast).
      ? { key: "rank", n: `#${r.rank.toLocaleString()}`, l: "This season", s: `of ${r.total.toLocaleString()}`, s2: r.total >= 20 && r.rank <= r.total / 2 ? topPct(r.rank, r.total) : null }
      : { key: "rank", n: "…", l: "This season", s: "Ranking" });
  }
  return (
    <div className="strip">
      {cells.map((c) => (
        <div key={c.key}>
          <div className={`n ${c.tone || ""}`}>{c.n}</div><div className="l">{c.l}</div>
          {c.s && <div className="s">{c.s}</div>}{c.s2 && <div className="s">{c.s2}</div>}
        </div>
      ))}
    </div>
  );
}

// The moments that actually happened this season - nothing renders for a season without any.
export function SeasonMoments({ result, formatLabel }) {
  const chips = [];
  if (result.newSiteBest) chips.push({ key: "crown", t: "👑 New sitewide best score" });
  if (result.upsetRank != null && result.upsetRank <= 10) {
    chips.push({ key: "upset", t: result.upsetRank === 1 ? `🚨 Biggest ${formatLabel} upset ever` : `🚨 #${result.upsetRank} biggest ${formatLabel} upset` });
  }
  if (result.streak && result.streak.days >= 2) {
    const { days, newBest } = result.streak;
    chips.push({ key: `streak${STREAK_MILESTONES.includes(days) ? " milestone" : ""}`, t: `🔥 ${days}-day streak${newBest ? " · new best" : ""}` });
  }
  if (result.newBestScore && !result.newSiteBest) chips.push({ key: "best", t: "📈 New personal best score" });
  // The least likely playoff win, if any playoff win was an upset.
  const upset = result.games
    .filter((g) => g.playoff && isUpsetWin(result.score, g))
    .map((g) => ({ g, p: gameWinChance(result.score, g) }))
    .sort((a, b) => a.p - b.p)[0];
  if (!chips.length && !upset) return null;
  return (
    <>
      {chips.length > 0 && <div className="moments">{chips.map((c) => <span key={c.key} className={`mo ${c.key}`}>{c.t}</span>)}</div>}
      {upset && (
        <div className="alarm">
          <b>🚨 Upset in the {upset.g.label === "Championship" ? "Championship" : `${upset.g.label} round`}.</b>{" "}
          You beat the {upset.g.opp} with a {Math.max(1, Math.round(upset.p * 100))}% chance to win.
        </div>
      )}
    </>
  );
}

// Leaderboard rows: #1 gets the crown, and your own row is called out wherever it appears.
const rankRowClass = (i, mine) => [i === 0 ? "first" : "", mine ? "me" : ""].filter(Boolean).join(" ");
function RankCell({ i }) {
  return <td className="rk">{i === 0 && <span className="crown" aria-hidden="true">👑</span>}{i + 1}</td>;
}
function PlayerName({ name, mine }) {
  return <><NameLink name={name} />{mine && <span className="you">You</span>}</>;
}
const HOWTO_KEY = "ps-howto-seen";
const SOU_DONE_KEY = (d) => `ps-sou:${d}`;
const SOU_PROGRESS = (d) => `ps-sou-wip:${d}`;
const findPlayer = (key, id, season) => (BOARDS[key] || []).find((p) => p.id === id && p.season === season);

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
    bg: [PALETTE.lime, PALETTE.blue, PALETTE.orange, PALETTE.violet, PALETTE.cream][i % 5],
    dur: `${2.2 + ((i * 7) % 9) / 10}s`,
  })), [n]);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => <i key={i} style={{ left: b.left, background: b.bg, animationDelay: b.delay, animationDuration: b.dur }} />)}
    </div>
  );
}

// ---------- Sharing ----------
// Daily 1 is the day Gridspin launched, and the number counts up a day at a time, like Wordle's.
export const GRIDSPIN_DAY_ONE = "2026-09-14";
export function dailyNumber(date) {
  const utc = (key) => { const [y, m, d] = key.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(date) - utc(GRIDSPIN_DAY_ONE)) / 86400000) + 1;
}

// An Unlimited season's link: its boards (the code), the variant and scoring they were drafted
// under, and the sharer's record to beat. The record is only ever a friendly headline on the friend's
// screen - nothing scores from it.
export function challengeLink(base, mode, w, l) {
  const q = new URLSearchParams({ beat: `${w}-${l}` });
  if (mode.gm) q.set("mode", "gm");
  else if (mode.genius) q.set("mode", "genius");
  if (normFormat(mode.format) === "standard") q.set("scoring", "championship");
  return `${base}/c/${mode.code}?${q}`;
}
export function parseChallengeLink(pathname, search) {
  const m = /^\/c\/([A-Za-z0-9]{4,8})\/?$/.exec(pathname || "");
  if (!m) return null;
  const q = new URLSearchParams(search || "");
  const beat = /^(\d{1,2})-(\d{1,2})$/.exec(q.get("beat") || "");
  const games = beat ? Number(beat[1]) + Number(beat[2]) : 0;
  return {
    code: m[1].toUpperCase(),
    // A real season is 17 games plus up to 4 playoff games; anything else was typed in by hand.
    beat: games >= 17 && games <= 21 ? { w: Number(beat[1]), l: Number(beat[2]) } : null,
    gm: q.get("mode") === "gm",
    genius: q.get("mode") === "genius",
    format: q.get("scoring") === "championship" ? "standard" : "fantasy",
  };
}

// The Wordle-style share: the record, a square per game, the playoffs and a link - never the players,
// so it can't spoil the daily's boards. 🟩 a win, 🟥 a loss, 🟨 an upset win (isUpsetWin, the rule
// behind the result screen's 🚨 tiles).
export function shareText(result, mode, place) {
  const squares = (games) => games.map((g) => (!g.win ? "🟥" : isUpsetWin(result.score, g) ? "🟨" : "🟩")).join("");
  const regular = result.games.filter((g) => !g.playoff);
  const playoffs = result.games.filter((g) => g.playoff);
  // Scores from the two formats don't rank against each other, so Championship is always named.
  const championship = normFormat(result.format ?? mode?.format) === "standard" ? " · Championship" : "";
  const n = mode?.kind === "daily" ? dailyNumber(mode.date) : null;
  const title = mode?.kind === "daily"
    ? `Gridspin Daily ${n >= 1 ? n : prettyDate(mode.date)}${championship}`
    : `Gridspin ${mode?.gm ? "GM mode" : mode?.genius ? "Genius mode" : "Unlimited"}${championship}`;
  const emoji = outcomeEmoji(result);
  const lines = [`${title}${emoji ? ` ${emoji} ` : " · "}${result.w}–${result.l}${result.w === 20 && result.l === 0 ? " PERFECT" : ""}`];
  // Rows of six, so the card keeps its shape in a chat bubble on a phone.
  for (let i = 0; i < regular.length; i += 6) lines.push(squares(regular.slice(i, i + 6)));
  lines.push(playoffs.length ? `Playoffs ${squares(playoffs)}` : "Missed the playoffs");
  lines.push(`Team score ${result.score.toFixed(1)}${place ? ` · #${place.rank.toLocaleString()} of ${place.total.toLocaleString()} seasons` : ""}`);
  // The link goes last, where chat apps turn it into a preview. Only a build with no SITE_URL (a bare
  // local build) has no address to give; see build.mjs.
  if (mode?.kind !== "daily") lines.push(APP_SITE_URL ? `Beat my boards: ${challengeLink(APP_SITE_URL, mode, result.w, result.l)}` : `Draft the same boards: code ${mode.code}`);
  else if (APP_SITE_URL) lines.push(APP_SITE_URL);
  return lines.join("\n");
}

// The Gridspin mark: the re-spin arrow around a football. static/icon.svg is the same drawing, and
// tools/brand/render.mjs makes the favicon, home-screen icons and link preview from that file -
// change the two together.
function GridspinMark({ size = 38 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="15" fill={PALETTE.lime} stroke={PALETTE.ink} strokeWidth="3" />
      <path d="M43.57 18.21A18 18 0 1 1 20.43 18.21" fill="none" stroke={PALETTE.ink} strokeWidth="6" strokeLinecap="round" />
      <path d="M25.9 12.6 16.2 13.9 22.4 22.2Z" fill={PALETTE.ink} />
      <ellipse cx="32" cy="33.5" rx="9.5" ry="6.2" transform="rotate(-35 32 33.5)" fill={PALETTE.ink} />
      <path d="M29 35.8 35 31.2" stroke={PALETTE.lime} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HowTo({ onClose }) {
  const btn = useRef(null);
  useEffect(() => {
    // preventScroll: focusing the button at the bottom otherwise opens the dialog scrolled past
    // steps 1-3 on a phone.
    btn.current && btn.current.focus({ preventScroll: true });
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="howto-title" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button>
        <h2 id="howto-title">How to play</h2>
        <ol>
          <li>Each round spins a <b>team and a five-year era</b>, like "Rams, 1999–2005." Draft one player from that board.</li>
          <li>Fill six spots: <b>QB, RB, WR, TE, and two Flex</b>. A Flex can be any RB, WR, or TE — and it's graded on raw production rather than against his own position, with no upper limit, so <b>your best player is often worth more in Flex</b> than in his natural spot.</li>
          <li>Every player shows <b>his best season</b> for that team in that era. The stats are real. The fantasy points are hidden.</li>
          <li>You get <b>one team re-spin and one era re-spin</b> per draft. Use them wisely.</li>
          <li>Play <b>unlimited</b> drafts any time, or take the <b>daily</b> — one draft a day, the same boards for everyone.</li>
          <li>Pick a <b>scoring format</b> before you draft. <b>Fantasy</b> is full PPR, where every catch is worth a point. <b>Championship</b> is standard scoring, where catches count for nothing and only yards and touchdowns do — so volume receivers drop and big-play threats rise. Each has its own leaderboard and its own daily.</li>
          <li>Your six are graded, then your team plays <b>17 games against real NFL teams</b> and, if you're good enough, the playoffs. Win them all for a <b>perfect <span className="nowrap">20–0</span> season</b>.</li>
        </ol>
        <p className="small">Grades compare each season to the top players at that position in the same era, with a bump for efficiency (QB rating, completion %, yards per carry). Flex is graded on raw production instead, with no positional comparison. Your QB counts a little more than the others.</p>
        <button ref={btn} className="btn solid" onClick={onClose}>Got it, let's draft</button>
      </div>
    </div>
  );
}

export default function PerfectSeason() {
  // A profile's address (/u/<name>) opens that profile, for guests too; every other address opens Modes.
  const [view, setView] = useState(() => (typeof window !== "undefined" && parseProfilePath(window.location.pathname) ? "profile" : "home"));
  // Whose profile the profile view shows. null there is your own profile from the Profile tab, or the
  // Account tab's login for a guest - see shownProfile below.
  const [profileOf, setProfileOf] = useState(() => (typeof window === "undefined" ? null : parseProfilePath(window.location.pathname)));
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
  const [myDetails, setMyDetails] = useState(null); // your own bio/team/picture (fetchProfileDetails), for the header picture
  const [isMod, setIsMod] = useState(false); // a moderator, as isModerator() answered at sign-in
  const [openReports, setOpenReports] = useState(null); // how many players the Reports queue holds, once loaded
  // The profile on screen: whose it is (`name`, so an answer for someone else is never shown), fetchPlayerProfile's
  // status and profile, and the rank of each of the player's best scores.
  const [profileData, setProfileData] = useState({ name: null, status: "loading", profile: null, rank: NO_RANK });
  const [scrollBack, setScrollBack] = useState(null); // { y } - where Back or Forward returns a screen to
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
  // A friend's boards from a challenge link (gridspin.app/c/CODE?beat=7-10), waiting on the Modes screen.
  const [challenge, setChallenge] = useState(() => (typeof window === "undefined" ? null : parseChallengeLink(window.location.pathname, window.location.search)));
  const [dailyBoard, setDailyBoard] = useState({ loading: false, rows: [], format: "fantasy" });
  // The points ladder currently being viewed, and its rows. Paired the same way lb/lbFormat are,
  // so the rows and the column that reads them can never describe different ladders.
  const [ladder, setLadder] = useState({ loading: false, rows: [], mode: "unlimited" });
  const [ladderMode, setLadderMode] = useState("unlimited");
  const [siteStats, setSiteStats] = useState({ loading: false, loaded: false, data: null, error: false, buildCount: 0, topBuilds: [] });
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
        if (prof) { setUserId(data.session.user.id); setUser(prof.username); setStats(prof); loadAccountExtras(data.session.user.id); }
      }
      setAuthReady(true);
    })();
    const { data: authSub } = authOnChange((event) => {
      if (event === "SIGNED_OUT") { setUserId(null); setUser(null); setStats(null); clearAccountExtras(); }
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
      // An Unlimited draft counts from its first dealt board, so it comes back even with no picks yet.
      if (ok && validDraft(saved) && (saved.history.length > 0 || saved.mode.kind === "free")) restoreDraft(saved);
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

  // A challenge link opens on the Modes screen with the friend's boards ready. The address goes back to
  // "/" straight away, so a reload or a bookmark doesn't keep offering the same challenge.
  useEffect(() => {
    if (!challenge) return;
    try { window.history.replaceState(null, "", "/"); } catch (e) { /* no history API */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Profiles: addresses, history and data (PROFILES.md 7) ----------
  // Whose profile is on screen: the one opened, else your own (the Profile tab). null on the profile view
  // means a guest on the Account tab, who gets the login instead.
  const shownProfile = view === "profile" ? profileOf || user || null : null;
  const screenKey = shownProfile ? `profile:${shownProfile}` : `view:${view}`;
  // The screen the current history entry describes, and how far down the page was when the player last
  // left a screen (a tab or a name), so Back can return to that spot.
  const historyScreen = useRef(null);
  const leftAt = useRef(0);

  // Opening a profile pushes an entry for it, after recording the screen being left in the current entry, so
  // Back returns there and Forward works. Leaving a profile for any other screen pushes "/". Moving between
  // other screens just keeps the current entry up to date. Done here rather than in each click handler, so
  // every route in or out counts: the tabs, the header, the names, and the profile's own buttons.
  useEffect(() => {
    const next = shownProfile ? { ps: "profile", name: shownProfile } : { ps: "view", view };
    const prev = historyScreen.current;
    historyScreen.current = next;
    if (!prev) {
      // The entry the page opened in: a profile's address loses any trailing slash, and an address under /u/
      // that isn't a username (Modes is showing) goes back to "/".
      const tidy = next.ps === "profile" ? profilePath(next.name) : window.location.pathname.startsWith("/u/") ? "/" : null;
      writeHistory("replaceState", next, tidy);
    } else if (sameScreen(prev, next)) {
      // Already written: Back or Forward landed here, or nothing that has an entry changed.
    } else if (next.ps === "profile" && prev.ps === "view" && prev.view === "profile") {
      // Signing in on the Account tab turns that screen into your profile: the same entry, at your address.
      writeHistory("replaceState", next, profilePath(next.name));
    } else if (next.ps === "profile") {
      if (prev.ps === "view") writeHistory("replaceState", { ...prev, scroll: leftAt.current });
      writeHistory("pushState", next, profilePath(next.name));
    } else if (prev.ps === "profile") {
      writeHistory("pushState", next, "/");
    } else {
      writeHistory("replaceState", next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKey]);

  // Back and Forward put back the screen the entry describes, opening it the way its tab or tile would -
  // Over/Under and Build-a-player through their own openers, since leaving them dropped the round or build.
  const onHistoryMove = useRef(null);
  onHistoryMove.current = (state) => {
    const s = screenOf(state, window.location.pathname);
    historyScreen.current = s;
    if (s.ps === "profile") { setProfileOf(s.name); setView("profile"); }
    else if (s.view === "statsou") openSou();
    else if (s.view === "buildplayer") openBuildPicker();
    else openTab(s.view === "reports" && !isMod ? "home" : s.view);
    if (s.scroll > 0) setScrollBack({ y: s.scroll });
  };
  useEffect(() => {
    const onPop = (e) => onHistoryMove.current(e.state);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A tab, or anything that opens a screen the way its tab does. "profile" is your own profile (or, for a
  // guest, the Account tab's login).
  function openTab(k) {
    leftAt.current = window.scrollY || 0;
    if (k === "profile") setProfileOf(null);
    setView(k);
    if (k === "home") refreshWip();
    if (k === "board") { loadLeaderboard(); loadDailyBoard(); loadLadder(); }
    if (k === "stats" && !siteStats.loaded) loadSiteStats();
  }
  function openProfile(name) {
    leftAt.current = window.scrollY || 0;
    setProfileOf(name);
    setView("profile");
  }

  // Fresh every time the profile view opens or shows someone else. `req` drops an answer that arrives after
  // the player has moved on; the ranks follow the profile, since they need its best scores.
  const profileReq = useRef(0);
  async function loadProfile(name) {
    const req = ++profileReq.current;
    setProfileData({ name, status: "loading", profile: null, rank: NO_RANK });
    const res = await fetchPlayerProfile(name);
    if (req !== profileReq.current) return;
    // Your own name not found: a moderator may have renamed you since you signed in. Your account is read
    // by id instead, and the profile opens again under the name it has now.
    if (res.status === "missing" && userId && name === user) {
      const fresh = await fetchProfile(userId).catch(() => null);
      if (req !== profileReq.current) return;
      if (fresh?.username && fresh.username !== user) {
        setStats(fresh);
        setUser(fresh.username);
        setProfileOf((p) => (p === name ? fresh.username : p));
        return;
      }
    }
    setProfileData({ name, status: res.status, profile: res.profile || null, rank: NO_RANK });
    if (res.status !== "ok") return;
    const ranks = await Promise.all(FORMATS.map(async (f) => {
      const score = scoreOf(res.profile.stats, f);
      if (score == null) return null;
      const above = await fetchOwnRank(score, f);
      return above == null ? null : above + 1;
    }));
    if (req !== profileReq.current) return;
    setProfileData((p) => ({ ...p, rank: Object.fromEntries(FORMATS.map((f, i) => [f, ranks[i]])) }));
  }
  useEffect(() => {
    if (shownProfile) loadProfile(shownProfile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownProfile]);

  const shownData = profileData.name === shownProfile ? profileData : null;
  const ownProfileShown = !!userId && !!shownData?.profile && shownData.profile.id === userId;
  // A moderator's own profile shows how many players the Reports queue holds, counted each time it opens.
  useEffect(() => {
    if (!isMod || !ownProfileShown) return;
    let live = true;
    fetchModQueue().then((queue) => { if (live && queue) setOpenReports(queue.length); });
    return () => { live = false; };
  }, [isMod, ownProfileShown, shownData?.profile]);

  // The share sheet where the device has one, otherwise the address copied.
  async function shareProfile(name) {
    const url = `${APP_SITE_URL || window.location.origin}${profilePath(name)}`;
    // The share sheet on phones only, like the result screen's Share: on a computer, copying the link is
    // what people expect.
    if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
      try { await navigator.share({ title: `${name} on Gridspin`, url }); return "shared"; }
      // Closing the share sheet is a choice, not a failure, and nothing was shared - no status to show.
      // Anything else falls back to copying.
      catch (e) { if (e?.name === "AbortError") return "cancelled"; }
    }
    try { await navigator.clipboard.writeText(url); return "copied"; } catch (e) { return "failed"; }
  }

  // After any bio, team or picture save on your own profile: the header picture and the card both show it.
  function onDetailsSaved(details) {
    detailsReq.current++;
    setMyDetails(details);
    setProfileData((p) => (p.profile && p.profile.id === userId ? { ...p, profile: { ...p.profile, details } } : p));
  }

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
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: "0px 0px 100000px 0px" });
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
      let myRank = -1;
      if (userId) {
        const mine = scoreOf(stats, boardFormat);
        // Rows are keyed by the account's id - comparing against the username never matched.
        const idx = top.findIndex((q) => q.id === userId);
        // A rank that couldn't be counted (null) is left out, like no score at all.
        myRank = idx >= 0 ? idx : mine != null ? (await fetchOwnRank(mine, boardFormat)) ?? -1 : -1;
      }
      // totals is null when it couldn't be loaded - keep whatever was showing rather than zeros.
      setLb((x) => ({ loading: false, top, totals: totals || x.totals, myRank, error: false, format: boardFormat }));
      // Never lower the live count. finish() calls this while its own submit-run is still in flight,
      // so these totals can predate the draft that just finished - and that draft's broadcast echo
      // has usually already bumped the count past them.
      if (totals) setLiveDrafts((n) => (n == null ? totals.runs : Math.max(n, totals.runs)));
    } catch (e) {
      setLb({ loading: false, top: [], totals: { runs: 0, perfect: 0, players: 0 }, myRank: -1, error: true, format: boardFormat });
    }
  }

  // Lazy - only fetched once the Stats tab is actually opened. Every account and run board on that
  // screen comes back computed from fetchSiteStats's one call; builds live in their own table
  // (Build-a-player results never touch a profile row), so they're their own small fetch.
  async function loadSiteStats() {
    setSiteStats((s) => ({ ...s, loading: true }));
    try {
      const [data, buildCount, topBuilds] = await Promise.all([fetchSiteStats(10), fetchBuildCount(), fetchTopBuilds(10)]);
      setSiteStats({ loading: false, loaded: true, data, error: !data, buildCount, topBuilds });
    } catch (e) {
      setSiteStats({ loading: false, loaded: true, data: null, error: true, buildCount: 0, topBuilds: [] });
    }
  }

  // profiles is no longer client-writable at all (see supabase/schema.sql) - a DNF applies
  // optimistically to local state for instant UI feedback (same shape the server will also
  // compute, via the same shared applyDnf), then confirms through submit-run in the background.
  // `m` is the mode being abandoned - needed so the points penalty lands on the right ladder.
  // Defaults to the live mode, but callers that read a saved draft off storage pass that draft's
  // own mode, since it may not be the one currently loaded.
  function recordDnf(picks, m = mode) {
    if (!user || !stats) return;
    const ladder = modeKey({ mode: m?.kind, gm: m?.gm, genius: m?.genius });
    setStats(applyDnf(stats, picks, ladder));
    submitDnf(picks, ladder).then((ok) => setSaveError(!ok));
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
      let fresh = null;
      if (res.ok) {
        fresh = await fetchProfile(uid);
        if (fresh) setStats(fresh);
      }
      setSaveError(!res.ok);
      // `fresh` is the server's profile after this run, so the result screen can show the streak
      // it actually extended rather than a locally guessed one.
      return { ...res, fresh };
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
    loadAccountExtras(uid);
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
    setUserId(null); setUser(null); setStats(null); setNotice(""); clearAccountExtras();
    // Logging out of your own profile leaves the Account tab's login, not a visitor's view of yourself.
    if (ownProfileShown) setProfileOf(null);
  }

  // The header picture and the moderator check, for whoever just signed in or came back signed in. Both
  // answers are dropped if the account has changed by the time they arrive; a picture saved meanwhile
  // (onDetailsSaved) also outranks a slower read of the old one.
  const accountReq = useRef(0);
  const detailsReq = useRef(0);
  function loadAccountExtras(uid) {
    const account = ++accountReq.current;
    const details = ++detailsReq.current;
    fetchProfileDetails(uid).then((d) => { if (account === accountReq.current && details === detailsReq.current) setMyDetails(d); });
    isModerator().then((m) => { if (account === accountReq.current) setIsMod(m); });
  }
  function clearAccountExtras() {
    accountReq.current++;
    setMyDetails(null); setIsMod(false); setOpenReports(null);
    setView((v) => (v === "reports" ? "home" : v));
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
        // null means no draft; 0 means a dealt draft with no picks yet, which still counts.
        if (!pendingClears.current[slot]) next[slot] = validDraft(saved) ? saved.history.length : null;
      }
      return next;
    });
  }

  function restoreDraft(saved) {
    // Stop a reel still spinning for the draft being left: its interval would end by setting that draft's
    // next board as this one's spin, and the snapshot effect would then save it under this draft.
    clearInterval(timer.current);
    setSpinning(false);
    const r = {};
    saved.history.forEach((h) => { r[h.slot] = findPlayer(h.key, h.id, h.season); });
    setRoster(r); setHistory(saved.history); setUsed(saved.used || []);
    setRerolls(saved.rerolls || { team: REROLL_BUDGET, years: REROLL_BUDGET });
    setMode(saved.mode); setSeq(saved.seq || []); setSeqIdx(saved.seqIdx || 0);
    setSpin(saved.spin); setDisplay(saved.spin); setResult(null); setSelected(null);
    setShown(0); setPo({ idx: 0, stage: "pre" }); setResumed(true);
    setWip((w) => ({ ...w, [slotId(saved.mode)]: saved.history.length }));
  }

  // A saved daily whose seed isn't the one the server will derive can never be submitted - the
  // server would replay different boards and reject it - so it's treated as no saved draft at all
  // rather than resumed into a guaranteed rejection. A draft with no picks yet still counts: its
  // boards are already dealt, so coming back must resume them and abandoning it is a DNF. (Treating
  // it as nothing let you look at the first board, leave, and come back to new boards for free.)
  const validDraft = (s) => s && s.spin && s.mode && Array.isArray(s.history)
    && BOARDS[`${s.spin.team}|${s.spin.w}`] && s.history.every((h) => findPlayer(h.key, h.id, h.season))
    && (s.mode.kind !== "daily" || s.mode.seed === dailySeed(s.mode.date, s.mode.format));
  // Whether abandoning a saved draft costs this account a DNF: one with picks, or one this account dealt.
  // A board a guest only looked at on this device isn't charged to whoever signs in afterwards.
  const chargeableDraft = (s) => s.history.length > 0 || s.mode.owner === (userId || null);

  // presetRoster (Build-a-player) pre-fills one slot before the sequence is walked, so boardAt
  // correctly treats that position as already spoken for from the very first board.
  function startDraft(m, presetRoster) {
    const fmt = normFormat(m.format);
    // The two formats' dailies are deliberately different drafts, so playing one doesn't spoil
    // the other's boards. Free-mode seeds are unchanged - boards there don't depend on format,
    // and an existing challenge code must keep dealing the same boards it always did.
    const seed = m.kind === "daily" ? dailySeed(m.date, fmt) : m.code;
    const list = seededSequence(seed);
    const initialRoster = presetRoster || {};
    // owner: the account (or guest, null) that dealt this draft - see chargeableDraft.
    setMode({ ...m, format: fmt, seed, owner: userId || null }); setSeq(list);
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
    // Instant, not smooth: the board is swapped out a moment later, and a smooth scroll still in
    // flight when the page shrinks leaves the next board opening deep down the list on phones.
    const el = draftTop.current;
    if (el && el.scrollIntoView && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
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
    // Computed locally so the result screen can show points immediately, exactly like the score
    // and the season animation. The server independently recomputes both from the verified boards
    // and its own numbers are what actually get stored - an honest client just sees the same ones.
    if (!forcedScenario && finishedHistory) {
      const par = botPar(finishedHistory.map((h) => h.key), { format: fmt, gm: !!mode.gm });
      sim.par = par ?? undefined;
      sim.points = draftPoints(score, par);
    }
    const runRoster = SLOTS.map((s) => ({ slot: s, name: r[s].name, team: r[s].team, season: r[s].season, ppr: r[s].ppr, rating: effectiveRating(s, r[s], fmt) }));
    // Both "best" comparisons are per format - the leaderboard on screen and this profile's best
    // are whichever format was just played, never the other one's numbers.
    const siteBest = scoreOf(lb.top[0], fmt) ?? 0;
    const myBest = scoreOf(stats, fmt);
    // Only claim a sitewide best when the loaded board is for the format just played - otherwise
    // this would be comparing against the other format's numbers.
    sim.newSiteBest = !forcedScenario && !!user && lb.top.length > 0 && normFormat(lb.format) === fmt && score > siteBest;
    sim.newBestScore = !forcedScenario && !!user && !!stats && (myBest == null || score > myBest);
    // Ties late answers (rank, upset, streak) to this exact season; see addSeasonContext.
    sim.runId = `${Date.now()}:${Math.random()}`;
    // A forced admin ending is never saved, so there is nothing to rank it against.
    if (forcedScenario) sim.rank = null;
    setNotice("");
    if (!forcedScenario) {
      siteActivity.current?.broadcastDraftFinished();
      if (mode.kind === "daily") {
        const rec = { date: mode.date, format: fmt, w: sim.w, l: sim.l, score, outcome: sim.outcome, champ: sim.champ, roster: runRoster };
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
        history: finishedHistory, seq, gm: !!mode.gm, genius: !!mode.genius, format: fmt,
      };
      const saving = user ? submitAndSync(userId, trace) : Promise.resolve(null);
      if (!user) setPending(trace);
      addSeasonContext(sim, fmt, saving, mode.kind === "daily" && user ? (stats?.dailyBestStreak || 0) : null);
      // Point the leaderboard at the format just played before refreshing it, so the rank shown
      // beside this result ranks it against its own format rather than the other one's numbers.
      showBoardFormat(fmt);
      loadLeaderboard(fmt);
      clearDraft(DRAFT_KEY);
      clearDraftTracked(slotId(mode), mode.kind === "daily" ? DAILY_PROGRESS(mode.date, fmt) : FREE_PROGRESS);
      setWip((w) => ({ ...w, [slotId(mode)]: null }));
    } else if (mode.kind === "free") {
      // A forced ending records nothing, but the Unlimited draft it ends is over: clear its saved copy, or
      // it would come back on the next Unlimited tap and be charged as a DNF when replaced.
      clearDraft(DRAFT_KEY);
      clearDraftTracked("free", FREE_PROGRESS);
      setWip((w) => ({ ...w, free: null }));
    }
    setShare({ state: "idle", text: "" });
    setResult(sim);
    setPo({ idx: 0, stage: "pre" });
    setShown(reducedMotion() ? sim.games.filter((g) => !g.playoff).length : 0);
  }

  // The result screen's "where does this season land" details, which need the runs log: this
  // season's rank in its format, its place on the Biggest upsets board, and for a daily the streak
  // it extended. Waits for the save first so the counts include this run; a guest's unsaved run is
  // ranked as if it had been saved. Matched to its season by runId, so a slow answer can never
  // land on a newer result.
  async function addSeasonContext(sim, fmt, saving, prevBestStreak) {
    const ctx = { rank: null };
    try {
      const res = await saving;
      const saved = !!res?.ok;
      const [place, atOrBelow] = await Promise.all([
        fetchSeasonRank(sim.score, fmt),
        sim.champ ? fetchUpsetRank(sim.score, fmt) : Promise.resolve(null),
      ]);
      if (place) {
        const rank = place.above + 1;
        ctx.rank = { rank, total: Math.max(place.total + (saved ? 0 : 1), rank) };
      }
      if (atOrBelow != null) ctx.upsetRank = atOrBelow + (saved ? 0 : 1);
      if (prevBestStreak != null && res?.fresh) {
        const days = res.fresh.dailyStreak || 0;
        ctx.streak = { days, newBest: days > prevBestStreak };
      }
    } catch (e) {
      // Leave the extras out; the season itself is already on screen.
    }
    setResult((r) => (r && r.runId === sim.runId ? { ...r, ...ctx } : r));
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
  // Charges a DNF for the saved Unlimited draft this is about to wipe, then wipes it.
  //
  // Reads the draft out of storage rather than trusting the live `mode`/`history`, because those
  // describe whatever is loaded right now, which often isn't the draft being destroyed: sitting in
  // a Daily and tapping Unlimited used to clear a half-finished Unlimited draft without charging
  // anything for it. Same reasoning as openFree, which already does it this way.
  //
  // It is also the single place a DNF is charged for an abandoned free draft - resetDraft used to
  // charge one itself and then call restart(), which charged a second one for the same draft.
  async function abandonCurrent() {
    const saved = await sget(FREE_PROGRESS, false);
    if (validDraft(saved) && saved.mode.kind === "free" && chargeableDraft(saved)) recordDnf(saved.history.length, saved.mode);
    clearDraftTracked("free", FREE_PROGRESS);
    setWip((w) => ({ ...w, free: null }));
  }

  // The draft screen's Unlimited pill: back to the free draft already in progress, whatever its
  // variant, or a fresh one if there isn't one. It used to call restart(), which threw a saved
  // draft away and charged a DNF for one tap.
  async function resumeFree() {
    const saved = await sget(FREE_PROGRESS, false);
    if (validDraft(saved) && saved.mode.kind === "free") { setView("play"); restoreDraft(saved); return; }
    openFree();
  }

  async function restart(extra) {
    await abandonCurrent();
    clearDraft(DRAFT_KEY);
    setView("play");
    startDraft({ kind: "free", code: newCode(), format, ...extra });
  }

  // After an Unlimited season its saved draft is already cleared, so this deals fresh boards under the same
  // variant and scoring just played. After a daily, the draft left in the Unlimited slot is resumed, whatever
  // its variant or scoring, rather than abandoned.
  function runItBack() {
    if (mode?.kind === "free") restart({ format: mode.format, gm: !!mode.gm, genius: !!mode.genius });
    else resumeFree();
  }

  // Unlimited from Modes: back to the draft in the Unlimited slot - a GM, Genius or challenge draft
  // included - when it's in the selected scoring format. (openFree alone treats another variant as
  // abandoned and charges a DNF.) Switching the scoring format first still asks for a new draft under
  // that format's rules.
  async function playUnlimited() {
    const fmt = normFormat(format);
    if (mode?.kind === "free" && !result && normFormat(mode.format) === fmt) { setView("play"); return; }
    const saved = await sget(FREE_PROGRESS, false);
    if (validDraft(saved) && saved.mode.kind === "free" && normFormat(saved.mode.format) === fmt) { setView("play"); restoreDraft(saved); return; }
    openFree();
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
    // Saved as if this round were already missed; answering overwrites it. So reloading the page
    // mid-round lands on the next round a life down, rather than re-dealing this one with a fresh clock.
    sset(SOU_PROGRESS(date), { roundIndex: roundIndex + 1, lives: lives - 1, score }, false);
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
    setSou(null);
    // A round abandoned on the last life (page closed or reloaded) leaves no lives to resume with.
    if (wip && wip.lives <= 0) { finishSouDay(date, wip.score); return; }
    setSouIntro(wip ? { date, ...wip } : { date, roundIndex: 0, lives: SOU_LIVES, score: 0 });
  }

  function beginSou() {
    const { date, roundIndex, lives, score } = souIntro;
    setSouIntro(null);
    startSouRound(date, roundIndex, lives, score);
  }

  // Leaving Over/Under by any route - its own buttons or the nav - stops the clock and drops the
  // round. Walking away while the clock is running counts as a miss, so leaving can't be used to
  // dodge a hard round or have it re-dealt with a fresh seven seconds.
  function leaveSouState() {
    clearInterval(souTimer.current);
    if (sou && !sou.guess) {
      const lives = sou.lives - 1;
      if (lives > 0) sset(SOU_PROGRESS(sou.date), { roundIndex: sou.roundIndex + 1, lives, score: sou.score }, false);
      else finishSouDay(sou.date, sou.score);
    }
    setSou(null);
    setSouIntro(null);
  }

  function leaveSou() {
    leaveSouState();
    setView("home");
  }

  // The day is over: record it locally and show the result straight away, then post the score to
  // the shared leaderboard. The screen used to wait on that network write and sat blank meanwhile.
  async function finishSouDay(date, score) {
    await sset(SOU_DONE_KEY(date), { score }, false);
    setSouBoard({ loading: true, rows: [] });
    setSouDone({ score });
    await sdel(SOU_PROGRESS(date), false);
    // Wait for the leaderboard write to land before re-fetching it, or the read can race ahead of
    // the write and show a board missing the score that was just saved.
    if (user && userId) await upsertSouRun(date, userId, { username: user, score });
    loadSouBoard(date);
  }

  // Once a round resolves (correct, wrong, or timeout), save progress; once lives run out,
  // finalize the day - write the personal "already played today" record, clear the resumable
  // wip snapshot, and (if logged in) put the score on the shared daily leaderboard. Guests can
  // still play, they just don't appear on the board.
  // Saves the NEXT round to deal. Saving the one just answered let a player leave, come back and
  // answer it again for another point.
  useEffect(() => {
    if (!sou || !sou.guess) return;
    if (sou.lives > 0) { sset(SOU_PROGRESS(sou.date), { roundIndex: sou.roundIndex + 1, lives: sou.lives, score: sou.score }, false); return; }
    finishSouDay(sou.date, sou.score);
  }, [sou?.guess, sou?.roundIndex]);

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
    // The draft on screen, picks or not: once a board is dealt, leaving and tapping back in is a resume.
    if (mode && mode.kind === "free" && sameVariant(mode) && !result) return;
    const saved = await sget(FREE_PROGRESS, false);
    if (validDraft(saved) && saved.mode.kind === "free") {
      if (sameVariant(saved.mode)) { restoreDraft(saved); return; }
      // Use the saved draft (not live state) so the DNF is recorded correctly - its picks and its own
      // ladder - even if it was started in an earlier session and never loaded back into memory.
      if (chargeableDraft(saved)) recordDnf(saved.history.length, saved.mode);
      clearDraftTracked("free", FREE_PROGRESS);
      setWip((w) => ({ ...w, free: null }));
    }
    clearDraft(DRAFT_KEY);
    startDraft({ kind: "free", code: newCode(), ...want });
  }

  async function startCode(raw) {
    const code = (raw || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    if (code.length < 4) return;
    // Awaited so the abandoned draft is read and charged before it's wiped.
    await abandonCurrent();
    clearDraft(DRAFT_KEY);
    setCodeInput("");
    setView("play");
    // Carries the current format, so entering a code while Championship is selected doesn't
    // silently drop you back into full-PPR scoring.
    startDraft({ kind: "free", code, format });
  }

  // Takes a challenge link's boards under the variant and scoring they were shared with. Like entering a
  // code, it abandons any Unlimited draft in progress (a DNF; the card warns first).
  async function acceptChallenge() {
    const c = challenge;
    // Not before the session loads: abandoning a draft while signed out would skip its DNF.
    if (!c || !authReady) return;
    setChallenge(null);
    await abandonCurrent();
    clearDraft(DRAFT_KEY);
    // The link's scoring becomes the selected format, as opening a daily does, so Modes shows what you're
    // playing and the Unlimited tile takes you back to it.
    setFormat(c.format);
    sset(FORMAT_KEY, c.format, false);
    setView("play");
    startDraft({ kind: "free", code: c.code, format: c.format, gm: c.gm, genius: c.genius });
  }

  async function loadLadder(m) {
    const mk = LADDERS.includes(m) ? m : ladderMode;
    setLadder((l) => ({ loading: true, rows: l.mode === mk ? l.rows : [], mode: mk }));
    try {
      setLadder({ loading: false, rows: await fetchLadderTop(mk, 10), mode: mk });
    } catch (e) { setLadder({ loading: false, rows: [], mode: mk }); }
  }

  async function loadDailyBoard(f) {
    const fmt = normFormat(f || boardFormatRef.current);
    // A refresh of the same board keeps its rows on screen until the new ones arrive, so the page
    // doesn't collapse under the reader. Switching format still clears them - they'd be the wrong board.
    setDailyBoard((d) => ({ loading: true, rows: d.format === fmt ? d.rows : [], format: fmt }));
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
    // restart() -> abandonCurrent() charges the DNF. Charging one here too double-counted it.
    restart();
  }

  function closeHowTo() { setHowTo(false); sset(HOWTO_KEY, true, false); }

  async function doShare() {
    // result.rank is this season's rank from the runs log ({rank,total}), or null/undefined when
    // there isn't one yet. (This read an undefined `place` after 1.7.0, so Share threw and did nothing.)
    const text = shareText(result, mode, result.rank || null);
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
  const site = siteStats.data || EMPTY_SITE_STATS;
  // The score-ranked half of the Stats screen, for whichever format is selected there.
  const fmtStats = site.byFormat[normFormat(boardFormat)];
  const myRank = lb.myRank;
  const regGames = result ? result.games.filter((g) => !g.playoff) : [];
  const poGames = result ? result.games.filter((g) => g.playoff) : [];
  const inPlayoffs = !!result && shown >= regGames.length && poGames.length > 0 && po.stage !== "done";
  const finished = !!result && shown >= result.games.length && !inPlayoffs;

  // Screen changes open at the top (see scrollToTop): a new view, a new draft, each
  // Build-a-player step, another player's profile. Not on first load, which is already at the top.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) { didMount.current = true; return; }
    scrollToTop();
  }, [view, mode?.seed, bap?.stage, bap?.seen?.length, shownProfile]);
  // ...except a screen Back or Forward returns to, which goes back to where it was scrolled. After the
  // effect above, so this one has the last word.
  useEffect(() => {
    if (!scrollBack) return;
    try { if (window.scrollY !== scrollBack.y) window.scrollTo(0, scrollBack.y); } catch (e) { /* no layout */ }
  }, [scrollBack]);

  // Leaving Over/Under or Build-a-player by ANY route - a tab, the header's Log in link, their own
  // buttons - stops their clocks and drops the round or build. (Only the tabs did this at first, so a
  // guest leaving through Log in came back to the rules stacked on top of a stale round.)
  const prevView = useRef(view);
  useEffect(() => {
    const was = prevView.current;
    prevView.current = view;
    if (was === "statsou" && view !== "statsou") leaveSouState();
    if (was === "buildplayer" && view !== "buildplayer") { clearTimeout(bapTimer.current); setBap(null); }
  }, [view]);

  // A new Over/Under round brings its answer buttons into view - on a short landscape phone they
  // otherwise start below the fold.
  useEffect(() => {
    if (!sou || sou.guess || typeof document === "undefined") return;
    document.querySelector(".sou-slot")?.scrollIntoView?.({ block: "nearest" });
  }, [sou?.roundIndex, sou?.date]);

  // Tapping a player low on the screen would leave his Lock in buttons below the fold.
  useEffect(() => {
    if (!selected || typeof document === "undefined") return;
    document.querySelector(".card.sel .drafts")?.scrollIntoView?.({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [selected]);

  // When the regular season ends in a playoff berth, make sure "Kick off" is on screen: on a short
  // phone it otherwise lands just under the fold.
  useEffect(() => {
    if (!inPlayoffs || po.stage !== "pre" || typeof document === "undefined") return;
    document.querySelector(".pre")?.scrollIntoView?.({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [inPlayoffs, po.stage]);

  // When the season ends, bring the record back into view if the season log pushed it off the top.
  const heroRef = useRef(null);
  useEffect(() => {
    const el = heroRef.current;
    if (finished && el?.getBoundingClientRect && el.getBoundingClientRect().top < 0) el.scrollIntoView?.({ block: "start" });
  }, [finished]);
  const regW = regGames.filter((g) => g.win).length;
  const inProgress = !!mode && !result && history.length > 0 && history.length < 6;
  const freePicks = (mode && mode.kind === "free" && !result ? history.length : wip.free) || 0;
  // A draft sits in the Unlimited slot, picks or not (wip.free is null when there's none).
  const freeInProgress = (mode?.kind === "free" && !result) || wip.free != null;
  // Per format, since both dailies can be part-finished at the same time.
  const dailyPicksFor = (f) => (dailyDone[f] ? 0
    : ((mode && mode.kind === "daily" && mode.date === todayKey() && normFormat(mode.format) === f && !result
      ? history.length : wip[`daily:${f}`]) || 0));
  // The finished record for the daily currently open, if that's what this is - and the format
  // whose daily is still available to offer next.
  const modeDailyDone = mode && mode.kind === "daily" ? dailyDone[normFormat(mode.format)] : null;
  const otherFormat = mode && normFormat(mode.format) === "standard" ? "fantasy" : "standard";
  function skipPlayoffs() { setShown(result.games.length); setPo({ idx: 0, stage: "done" }); }

  // The Profile tab is lit on your own profile and its Reports queue (or a guest's login), not on someone else's.
  const tabOn = (k) => (k === "profile"
    ? view === "reports" || (view === "profile" && (!profileOf || profileOf === user || ownProfileShown))
    : view === k);

  return (
    <OpenProfile.Provider value={openProfile}>
    <div className={`ps${view === "play" ? " dark" : view === "board" ? " night" : ""}`}>
      <style>{APP_CSS}</style>
      <div className="wrap">
        <nav className="nav" aria-label="Sections">
          {[["home", "Modes"], ["play", "Draft"], ["profile", user ? "Profile" : "Account"], ["players", "Players"], ["board", "Leaderboard"], ["stats", "Stats"]].map(([k, l]) => (
            <button key={k} className={`tab ${tabOn(k) ? "on" : ""}`} aria-current={tabOn(k) ? "page" : undefined} onClick={() => openTab(k)}>
              {l}{k === "play" && view !== "play" && mode && !result && !modeDailyDone && <span className="dot" aria-label="Draft in progress" />}
            </button>
          ))}
          <div className="hdr-links">
            <button className="pill hdrchip help" onClick={() => setHowTo(true)}>How to play</button>
            {!user && authReady && <button className="pill hdrchip login" onClick={() => openTab("profile")}>Log in</button>}
            {user && (
              <button className="whoami" aria-label={`Your profile, ${user}`} onClick={() => openTab("profile")}>
                {/* The button is labeled, so the picture beside the name is decorative. */}
                <Avatar username={user} photoUrl={myDetails?.avatarUrl ?? null} preset={myDetails?.avatarPreset ?? null} size={24} decorative />
                <span className="whoname">{user}</span>
              </button>
            )}
            <span className="ver" title={`Gridspin v${APP_VERSION}`}>v{APP_VERSION}</span>
          </div>
        </nav>

        {/* The worst way for a staging site to fail is quietly looking like the real one. */}
        {IS_STAGING && (
          <div className="stagebar">
            <b>Test site</b> — separate database, nothing here counts. v{APP_VERSION}.
          </div>
        )}

        {saveError && <div className="panel"><p style={{ margin: 0 }}>Your last season couldn't be saved. It will be included the next time a save goes through.</p></div>}
        {notice && <div className="panel"><p style={{ margin: 0 }}>{notice}</p></div>}
        {howTo && <HowTo onClose={closeHowTo} />}
        {resumed && view === "play" && !result && (
          <div className="notice"><span>Picked up your draft where you left off.</span></div>
        )}

        {/* ---------------- HOME ---------------- */}
        {view === "home" && (
          <>
            {challenge && (
              <section className="challenge" aria-labelledby="challenge-title">
                <span className="k">A friend's boards · code {challenge.code}</span>
                <h2 id="challenge-title" className="big">
                  {challenge.beat
                    ? <>They went <em>{challenge.beat.w}–{challenge.beat.l}</em>.<br />Can you beat it?</>
                    : <>Can you beat<br />their boards?</>}
                </h2>
                <p>
                  {[challenge.gm && "GM mode", challenge.genius && "Genius mode", `${FORMAT_LABEL[challenge.format]} scoring`].filter(Boolean).join(" · ")}.{" "}
                  The same code, so the boards come up in the order they did for them - re-spins aside. Your season is your own.
                </p>
                {freeInProgress && (
                  <p className="warn">You have an Unlimited draft in progress. Drafting these boards {user ? "counts it as a DNF" : "replaces it"}.</p>
                )}
                <div className="frow">
                  <button className="btn solid" disabled={!authReady} onClick={acceptChallenge}>Draft these boards</button>
                  <button className="btn" onClick={() => setChallenge(null)}>Not now</button>
                </div>
              </section>
            )}
            <header className="hero">
              {/* Decorative only: faint countdown yard numbers and a lime glow behind the headline. */}
              <div className="yardnums" aria-hidden="true">{[20, 19, 18, 17, 16].map((n) => <span key={n}>{n}</span>)}</div>
              <div className="blob" aria-hidden="true" />
              <div className="eyebrow">
                <GridspinMark size={38} />
                <h1 className="wordmark">Gridspin</h1>
                <span className="kicker">🏈 The ultimate season challenge</span>
              </div>
              <h2 className="headline">
                <span className="hl1">Can you go</span>
                <span className="big20"><span className="num">20–0</span>?</span>
              </h2>
              <p className="herosub">Spin an era. Draft the greats. Go 20–0.</p>
              <p className="heroexplain">Each round spins a random team and era. The stats are real, the fantasy points are hidden, and your six play a full season against real NFL teams. Win all 20 and you've gone perfect.</p>
              <div className="herocta">
                <button className="btn solid xl" onClick={playUnlimited}>Start my season 🏈</button>
              </div>
              <div className="herostats">
                {liveDrafts != null && (
                  <button className="pill" onClick={() => { setView("stats"); if (!siteStats.loaded) loadSiteStats(); }}>🔥 {liveDrafts.toLocaleString()} drafts</button>
                )}
                {online != null && <span className="pill">🟢 {online} online now</span>}
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
                  {stats?.dailyStreak && stats.dailyLast === todayKey() ? <span className="pill">🔥 {stats.dailyStreak}-day streak</span> : null}
                </div>
                <p>The same six boards for everyone, one draft a day, no resets. {prettyDate(todayKey())}. Each scoring format has its own daily.</p>
                <div className="dailycta">
                  {FORMATS.map((f) => {
                    const picks = dailyPicksFor(f);
                    return (
                      <button key={f} className="btn" onClick={() => startDaily(f)}>
                        {FORMAT_LABEL[f]} daily
                        <span className="go">
                          {dailyDone[f] ? (wonItAll(dailyDone[f]) ? "Relive it 🏆" : "See how it went") : picks > 0 ? `${picks} of 6` : "Let's go"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button className="mode m-unlimited" onClick={playUnlimited}>
                <div className="mt">
                  <span className="icon" aria-hidden="true">♾️</span>
                  <span className="mn">Unlimited</span>{freePicks > 0 && <span className="pill">{freePicks} of 6 picked</span>}
                </div>
                <p>Draft as many teams as you like. Random boards every time, resets allowed.</p>
                <span className="go">{freeInProgress ? "Back to your draft" : "Let's go"}</span>
              </button>

              <button className="mode m-genius" onClick={() => openFree({ genius: true })}>
                <div className="mt"><span className="icon" aria-hidden="true">🧠</span><span className="mn">Genius mode</span></div>
                <p>Same draft, no stats shown. Just name, team, and year - know your football. Shares your Unlimited progress slot.</p>
                <span className="go">Let's go</span>
              </button>

              <button className="mode m-gm" onClick={() => openFree({ gm: true })}>
                <div className="mt"><span className="icon" aria-hidden="true">💼</span><span className="mn">GM mode</span></div>
                <p>Draft against a ${GM_CAP}M salary cap. Elite seasons cost a lot more. Shares your Unlimited progress slot.</p>
                <span className="go">Let's go</span>
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
                  <input className="inp" value={codeInput} maxLength={8} placeholder="e.g. K3F9QZ" aria-label="Challenge code"
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && startCode(codeInput)} />
                  <button className="btn solid" disabled={codeInput.trim().length < 4} onClick={() => startCode(codeInput)}>Draft it</button>
                </div>
              </div>
            </div>

            <div className="hometiles">
              <div className="tile"><div className="n">{user && stats ? draftsOf(stats).toLocaleString() : "–"}</div><div className="l">Your drafts</div></div>
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
              <p className="note">Playing as a guest. <button className="linkbtn" onClick={() => openTab("profile")}>Log in or create an account</button> to save your drafts, keep a daily streak, and get on the leaderboard.</p>
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
              <button className="btn" onClick={playUnlimited}>Unlimited draft</button>
            </div>
          </div>
        )}

        {view === "play" && mode && (
          <>
            {mode && (
              <div className="modebar">
                <button className={`mb ${mode.kind === "free" ? "on" : ""}`} onClick={() => mode.kind !== "free" && resumeFree()}>Unlimited</button>
                <button className={`mb ${mode.kind === "daily" ? "on" : ""}`} onClick={() => mode.kind !== "daily" && startDaily()}>
                  Daily{stats?.dailyStreak && stats.dailyLast === todayKey() ? ` · ${stats.dailyStreak}🔥` : ""}
                </button>
                <button className="mb" onClick={() => { refreshWip(); setView("home"); }}>All modes</button>
                {/* What kind of draft this is, at a glance: the variant (Genius or GM) and the scoring format
                    as chips - both formats named, not just Championship - then the daily's date or the code. */}
                <span className="seedline">
                  {mode.genius && <span className="modechip genius"><span aria-hidden="true">🧠</span>Genius mode</span>}
                  {mode.gm && <span className="modechip gm"><span aria-hidden="true">💼</span>GM mode</span>}
                  <span className="modechip fmt">{FORMAT_LABEL[normFormat(mode.format)]}</span>
                  {mode.kind === "daily"
                    ? <span className="nowrap">{prettyDate(mode.date)} · same boards for everyone</span>
                    : <span className="codechip">Code <code>{mode.code}</code></span>}
                </span>
              </div>
            )}

            {isAdmin && mode && !result && (
              <AdminPanel openSlots={open} onForceBoard={adminForceBoard} onForcePlayer={adminForcePlayer} onForceOutcome={adminForceOutcome} />
            )}

            {modeDailyDone && !result && (
              <div className="locked">
                <h3>Today's {FORMAT_LABEL[normFormat(mode.format)]} daily is done</h3>
                <p className="note" style={{ marginTop: 0 }}>You went {modeDailyDone.w}–{modeDailyDone.l} with a team score of {modeDailyDone.score.toFixed(1)}. {outcomeSentence(modeDailyDone.outcome)}</p>
                <RosterRows roster={modeDailyDone.roster} />
                <div className="frow" style={{ marginTop: 12 }}>
                  {!dailyDone[otherFormat] && (
                    <button className="btn solid" onClick={() => startDaily(otherFormat)}>Play the {FORMAT_LABEL[otherFormat]} daily</button>
                  )}
                  {/* resumeFree, not restart: the draft in the Unlimited slot, whatever its variant, is resumed rather than charged as a DNF. */}
                  <button className="btn" onClick={() => resumeFree()}>Play an unlimited draft</button>
                  <button className="btn" onClick={() => { setView("board"); loadLeaderboard(); loadDailyBoard(); }}>Today's leaderboard</button>
                </div>
              </div>
            )}

            {!(modeDailyDone && !result) && (
            <>
            {mode.gm && !result && (
              <div className="frow" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Salary cap</span>
                <span style={{ fontWeight: 700, color: capRemaining < 0 ? "var(--loss)" : "var(--ink)" }}>${capUsed}M / ${GM_CAP}M <span className="gmleft">· ${Math.max(0, capRemaining)}M left</span></span>
              </div>
            )}
            {!result && (
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
            )}

            {!result && disp && (
              <>
                <div className={`sticky ${stuck ? "show" : ""}`} aria-hidden={!stuck} style={teamVars(disp.team)}>
                  <div className="in">
                    <div className="stripe" style={{ background: TEAMS[disp.team][2] }} />
                    <span className="tm">{TEAMS[disp.team][0]}</span>
                    <span className="yr">{WINDOWS[disp.w][0]}–{WINDOWS[disp.w][1]}</span>
                    {mode.gm && <span className={`stcap ${capRemaining < 0 ? "over" : ""}`}>${Math.max(0, capRemaining)}M left</span>}
                    <span className="pk">Pick {pickNo} of 6</span>
                    <span className="brk" />
                    <div className="chips">
                      {SLOTS.map((s) => <span key={s} className={`chip pos-${s.startsWith("FLEX") ? "FLEX" : s} ${roster[s] ? "on" : ""}`} title={roster[s] ? roster[s].name : `${SLOT_LABEL[s]} open`}>{s.startsWith("FLEX") ? "FX" : s}</span>)}
                    </div>
                    <div className="sp">
                      <button className="btn sm" tabIndex={stuck ? 0 : -1} disabled={spinning || rerolls.team < 1} onClick={() => reroll("team")}>Re-spin team ({rerolls.team})</button>
                      <button className="btn sm" tabIndex={stuck ? 0 : -1} disabled={spinning || rerolls.years < 1} onClick={() => reroll("years")}>Re-spin era ({rerolls.years})</button>
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
                  {/* Phones show the short "↻ Team 1" form so all three controls fit one row; the
                      aria-label keeps the full wording for screen readers either way. */}
                  <button className="btn" aria-label={`Re-spin team (${rerolls.team} left)`} disabled={spinning || rerolls.team < 1} onClick={() => reroll("team")}>
                    <span className="rs-long">Re-spin team <span className="left">({rerolls.team} left)</span></span>
                    <span className="rs-short" aria-hidden="true">↻ Team <b>{rerolls.team}</b></span>
                  </button>
                  <button className="btn" aria-label={`Re-spin era (${rerolls.years} left)`} disabled={spinning || rerolls.years < 1} onClick={() => reroll("years")}>
                    <span className="rs-long">Re-spin era <span className="left">({rerolls.years} left)</span></span>
                    <span className="rs-short" aria-hidden="true">↻ Era <b>{rerolls.years}</b></span>
                  </button>
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
                                {/* Both Flex slots are the same choice, so offer one Flex button (the
                                    first open Flex slot) instead of two identical ones. */}
                                {slotsFor.filter((s) => !s.startsWith("FLEX") || s === slotsFor.find((x) => x.startsWith("FLEX"))).map((s) => {
                                  const cost = mode.gm ? playerSalary(p, mode.format) : 0;
                                  const tooExpensive = mode.gm && cost > capRemaining;
                                  return (
                                    <button key={s} className="btn solid" disabled={tooExpensive} onClick={() => draft(p, s)}>
                                      🔒 Lock in · {SLOT_LABEL[s]}{mode.gm && ` - $${cost}M${tooExpensive ? " (over cap)" : ""}`}
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
                {/* Record first: it's the number people screenshot. Team score, points and this
                    season's rank share one strip under it, and the moments only appear when they
                    happened. */}
                <div className="result-hero" aria-live="polite" ref={heroRef} style={{ scrollMarginTop: 12 }}>
                  {finished && (result.perfect || result.champ) && (
                    <div className={`cel ${result.perfect ? "perfect" : ""}`}>
                      <Confetti n={result.perfect ? 34 : 22} />
                      <span className="stamp">🏆 {result.perfect ? "Perfect season" : "Champions"}</span>
                    </div>
                  )}
                  <RecordLine games={result.games.slice(0, shown)} />
                  <div className="outrow">
                    {finished && outcomeEmoji(result) && <span className="oe" aria-hidden="true">{outcomeEmoji(result)}</span>}
                    <div className="outcome">{finished ? result.outcome : inPlayoffs ? "Playoffs" : "Playing the season…"}</div>
                  </div>
                  {finished ? (
                    <>
                      <SeasonStrip result={result} ladderName={LADDER_LABEL[modeKey({ mode: mode.kind, gm: mode.gm, genius: mode.genius })]} />
                      <SeasonMoments result={result} formatLabel={FORMAT_LABEL[normFormat(result.format)]} />
                    </>
                  ) : (
                    <div className="rating">Team score {result.score.toFixed(1)}</div>
                  )}
                </div>

                {/* The next thing to do sits right under the result, not six screens down past the
                    grades and recap. */}
                {finished && (
                  <div className="frow resultactions">
                    <button className="btn solid" onClick={doShare}>{share.state === "copied" ? "Copied to clipboard" : share.state === "shared" ? "Shared" : "Share result"}</button>
                    <button className="btn" onClick={runItBack}>Run it back 🔁</button>
                    <button className="btn" onClick={() => { setView("board"); loadLeaderboard(); loadDailyBoard(); }}>See the leaderboard</button>
                  </div>
                )}
                {finished && share.state === "manual" && (
                  <>
                    <p className="note">Copying isn't allowed here, so select the text below and copy it.</p>
                    <textarea className="sharebox" readOnly value={share.text} onFocus={(e) => e.target.select()} />
                  </>
                )}

                {inPlayoffs && po.stage === "pre" && (
                  <div className="pre">
                    <h3>You're in the playoffs</h3>
                    <p>{regW}–{regGames.length - regW} in the regular season. {poGames[0].label === "Divisional" ? "That earns the top seed and a first-round bye." : "You're in as a wild card, so it's four wins to a title."}</p>
                    <div className="frow">
                      <button className="btn solid" onClick={() => setPo({ idx: 0, stage: "live" })}>Kick off the {poGames[0].label} round vs the {poGames[0].opp}</button>
                      <button className="linkbtn" onClick={skipPlayoffs}>Skip to the end ⏩</button>
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
                    <div key={i} className={`g ${g.win ? "win" : "loss"} ${g.playoff ? "po" : ""} ${isUpsetWin(result.score, g) ? "up" : ""}`}
                      title={isUpsetWin(result.score, g) ? `Upset: a ${Math.max(1, Math.round(gameWinChance(result.score, g) * 100))}% chance to win` : undefined}>
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
                    <p className="note">Grades compare each season to the top finishers at that position in the same era, with 17-game seasons scaled to 16. {normFormat(mode.format) === "standard" ? "Championship scoring counts yards and touchdowns only - receptions are worth nothing, so volume receivers rate lower and big-play producers rate higher than they do in Fantasy scoring." : "Fantasy scoring is full PPR, so every reception is worth a point."} QBs also gain or lose for passer rating and completion percentage, and RBs for yards per carry, against their era's average. Team score averages the six, with the QB counting 1.25 times.</p>
                    <p className="note flexnote"><b>Flex is graded differently, on purpose.</b> A named slot compares a player to others at his own position. Flex ignores position entirely and compares raw production across every RB, WR and TE of that era — so a tight end usually rates lower in Flex, and a high-volume back rates higher. Flex is also the only slot with no 130 ceiling: a named slot clips an all-time season at 130, Flex shows its full value. <b>That's why your best player often belongs in Flex rather than his own position.</b></p>
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
                              <p className="note recap-optimal">This assumes hindsight of all six boards you saw - it's what the ideal slot assignment would have scored, not a board you missed. If it's moved your best player into Flex, that's the reason: Flex has no 130 ceiling, so a monster season is worth more there than in his own position.</p>
                            </>
                          )}
                        </>
                      );
                    })()}
                    <div className="frow" style={{ marginTop: 16 }}>
                      <button className="btn" onClick={runItBack}>Run it back 🔁</button>
                    </div>
                    {mode.kind === "free" && (
                      <p className="note">Share result sends a link to this draft's code (<b>{mode.code}</b>), so friends get the same boards - re-spins aside - with your record to beat.</p>
                    )}
                  </>
                )}
              </>
            )}
            </>
            )}
          </>
        )}

        {/* ---------------- PROFILE / ACCOUNT ---------------- */}
        {view === "profile" && !shownProfile && authReady && (
          <AuthPanel onAuthed={onAuthed} title="Your account"
            blurb="Log in to track your seasons, best lineup, and championships, and to appear on the leaderboard." />
        )}

        {view === "profile" && shownProfile && (() => {
          const status = shownData ? shownData.status : "loading";
          const profile = shownData?.profile || null;
          return (
            // data-status says which state the screen is in, whatever its copy says (a test hook).
            <div className="profile-route" data-status={status}>
              <ProfileScreen status={status} profile={profile} isOwner={ownProfileShown} userId={userId}
                rank={shownData?.rank || NO_RANK}
                moderator={ownProfileShown && isMod && openReports != null ? { openReports } : null}
                onRetry={() => loadProfile(shownProfile)} onShare={() => shareProfile(profile?.username || shownProfile)}
                onDetailsSaved={onDetailsSaved} onLogOut={logOut} onPlay={() => openTab("play")} onOpenReports={() => openTab("reports")} />
            </div>
          );
        })()}

        {/* ---------------- REPORTS (moderators) ---------------- */}
        {view === "reports" && isMod && <ModerationQueue onOpenProfile={openProfile} />}

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

                {/* The best team ever leads the screen. Sitewide totals live on Stats and "draft a
                    friend's board" on Modes - this screen is rankings only. */}
                {siteBest ? (
                  <div className="champion">
                    <div className="pickno">👑 Best {FORMAT_LABEL[lbFormat]} team ever</div>
                    <div className="sc led-wrap"><span className="led">{scoreOf(siteBest, lbFormat).toFixed(1)}</span></div>
                    <div className="by"><NameLink name={siteBest.username} />{runOf(siteBest, lbFormat) ? `, went ${runOf(siteBest, lbFormat).w}–${runOf(siteBest, lbFormat).l}` : ""}</div>
                    {runOf(siteBest, lbFormat) && <RosterChips roster={runOf(siteBest, lbFormat).roster} />}
                  </div>
                ) : (
                  <div className="panel"><p style={{ margin: 0 }}>No scores yet. Finish a season while logged in to claim the top spot.</p></div>
                )}

                {lb.top.length > 0 && (
                  <>
                    <h2 className="h">Top 10{" "}— {FORMAT_LABEL[lbFormat]}</h2>
                    <table className="lb">
                      <thead><tr><th></th><th>Player</th><th className="r">Best score</th><th className="r lbrec">Best record</th><th className="r hide">Drafts</th><th className="r hide">Perfect</th></tr></thead>
                      <tbody>
                        {lb.top.map((q, i) => {
                          const mine = !!userId && q.id === userId;
                          return (
                            <tr key={q.id} className={rankRowClass(i, mine)}>
                              <RankCell i={i} />
                              <td className="nm"><PlayerName name={q.username} mine={mine} />{q.bestRecord && <span className="subrec">{q.bestRecord.w}–{q.bestRecord.l}</span>}</td>
                              <td className="r v">{scoreOf(q, lbFormat) != null ? scoreOf(q, lbFormat).toFixed(1) : "–"}</td>
                              <td className="r lbrec">{q.bestRecord ? `${q.bestRecord.w}–${q.bestRecord.l}` : "–"}</td>
                              <td className="r hide">{draftsOf(q)}{q.dnf ? <span className="muted"> ({q.dnf} DNF)</span> : null}</td>
                              <td className="r hide">{q.perfect}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
                {authReady && !user && <p className="note">You're not on the leaderboard yet. <button className="linkbtn" onClick={() => openTab("profile")}>Log in or create an account</button> and your seasons will count here.</p>}
                {user && myRank >= 10 && scoreOf(stats, lbFormat) != null && <p className="note">You're #{myRank + 1} with a best {FORMAT_LABEL[lbFormat]} score of {scoreOf(stats, lbFormat).toFixed(1)}.</p>}
                {user && stats && scoreOf(stats, lbFormat) == null && <p className="note">Finish a {FORMAT_LABEL[lbFormat]} season to get on this board.</p>}

                <div className="dayhead" style={{ marginTop: 24 }}>
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
                    <thead><tr><th></th><th>Player</th><th className="r">Team score</th><th className="r lbrec">Record</th></tr></thead>
                    <tbody>
                      {dailyBoard.rows.slice(0, 10).map((q, i) => {
                        const mine = !!user && q.username === user;
                        return (
                          <tr key={i} className={rankRowClass(i, mine)}>
                            <RankCell i={i} /><td className="nm"><PlayerName name={q.username} mine={mine} /><span className="subrec">{q.w}–{q.l}</span></td>
                            <td className="r v">{q.score.toFixed(1)}</td><td className="r lbrec">{q.w}–{q.l}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                {/* The points ladder. Unlike team score, this doesn't saturate - it ranks how well
                    you drafted the boards you were dealt, accumulated, so it stays contestable. */}
                <div className="dayhead" style={{ marginTop: 24 }}>
                  <h2 className="h">Points ladder{" "}— {LADDER_LABEL[ladder.mode]}</h2>
                  <button className="linkbtn" onClick={() => loadLadder()} disabled={ladder.loading}>{ladder.loading ? "Loading…" : "Refresh"}</button>
                </div>
                <div className="fmtpick ladderpick" role="group" aria-label="Points ladder mode">
                  <span className="fmtlabel">Mode</span>
                  {LADDERS.map((m) => (
                    <button key={m} className={`fmtbtn ${ladderMode === m ? "on" : ""}`} aria-pressed={ladderMode === m}
                      onClick={() => { setLadderMode(m); loadLadder(m); }}>{LADDER_LABEL[m]}</button>
                  ))}
                  <p className="fmtnote">
                    Every draft is scored against a bot that played your six boards. Beat it and you gain
                    points, draft badly and you lose them — so the top needs good drafts and a lot of them.
                    Both scoring formats earn onto the same ladder.
                  </p>
                </div>
                {ladder.rows.length === 0 ? (
                  <p className="note" style={{ marginTop: 0 }}>
                    {ladder.loading ? "Loading the ladder…" : `No one has earned points in ${LADDER_LABEL[ladder.mode]} yet.`}
                  </p>
                ) : (
                  <table className="lb">
                    <thead><tr><th></th><th>Player</th><th className="r">Points</th><th className="r hide">Drafts</th></tr></thead>
                    <tbody>
                      {ladder.rows.map((q, i) => {
                        const mine = !!userId && q.id === userId;
                        return (
                          <tr key={q.id} className={rankRowClass(i, mine)}>
                            <RankCell i={i} /><td className="nm"><PlayerName name={q.username} mine={mine} /></td>
                            <td className="r v">{Math.round(pointsOf(q, ladder.mode)).toLocaleString()}</td>
                            <td className="r hide">{draftsOf(q)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}

                <button className="btn" style={{ marginTop: 8 }} onClick={() => { loadLeaderboard(); loadDailyBoard(); loadLadder(); }} disabled={lb.loading}>{lb.loading ? "Refreshing…" : "Refresh"}</button>
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
                  <div className="tile"><div className="n">{site.totals.players}</div><div className="l">Accounts</div></div>
                  <div className="tile"><div className="n">{(liveDrafts ?? site.totals.runs).toLocaleString()}</div><div className="l">Drafts</div></div>
                  <div className="tile"><div className="n">{site.totals.perfect}</div><div className="l">Perfect seasons</div></div>
                  <div className="tile"><div className="n">{site.avgWinPct}%</div><div className="l">Average win rate</div></div>
                  <div className="tile"><div className="n">{siteStats.buildCount}</div><div className="l">Created players</div></div>
                </div>
                {siteStats.error && <p className="note">Stats couldn't be loaded. Try Refresh.</p>}
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
                            #{i + 1} <NameLink name={q.username} />{" "}
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
                      <div className="rc rank" key={i}>
                        <div className="n">{i + 1}</div>
                        <div><div className="bd">{p.season} {TEAMS[p.team] ? TEAMS[p.team][0] : p.team}</div><div className="tk">{p.name}</div></div>
                        <div className="alt">{p.count} draft{p.count === 1 ? "" : "s"}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* The lowest team scores that still won the title. Unlike a best-ever score this never
                    tops out: someone can always win it all with a weaker team. */}
                <h2 className="h" style={{ marginTop: 22 }}>🚨 Biggest {FORMAT_LABEL[boardFormat]} upsets</h2>
                <p className="note" style={{ marginTop: 0 }}>The lowest team scores that still won the championship. The lower the score, the bigger the upset.</p>
                {fmtStats.biggestUpsets.length === 0 ? (
                  <p className="note" style={{ marginTop: 0 }}>No title-winning {FORMAT_LABEL[boardFormat]} runs yet.</p>
                ) : (
                  <div className="recap">
                    {fmtStats.biggestUpsets.map((u, i) => (
                      <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
                        <div style={{ fontWeight: 700 }}>
                          #{i + 1} <NameLink name={u.username} />{" "}
                          <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                            — {Number(u.score).toFixed(1)}, {u.w}–{u.l}{u.perfect ? " 🏆 perfect season" : " 🏆"}{u.ladder !== "unlimited" ? ` · ${LADDER_LABEL[u.ladder] || u.ladder}` : ""}
                          </span>
                        </div>
                        {Array.isArray(u.roster) && u.roster.length > 0 && <RosterChips roster={u.roster} />}
                      </div>
                    ))}
                  </div>
                )}

                <h2 className="h" style={{ marginTop: 22 }}>Career records</h2>
                <p className="note" style={{ marginTop: 0 }}>Combined across both scoring formats - a season played is a season played, and both run the same simulation.</p>

                <h2 className="h" style={{ marginTop: 22 }}>Most career wins</h2>
                <RankRows rows={site.mostWins} empty="No finished drafts yet." value={(q) => `${q.wins.toLocaleString()}–${q.losses.toLocaleString()}`} />

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
            <div className="frow bap-pos">
              {POS.map((p) => (
                <button key={p} className="btn solid" onClick={() => pickBapPos(p)}>{POS_NAME[p]}</button>
              ))}
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={cancelBap}>Cancel</button>
          </>
        )}

        {view === "buildplayer" && bap && bap.stage === "rolling" && (
          <>
            <h2 className="h">Build-a-player - {POS_NAME[bap.pos]}</h2>
            <div className="panel" style={{ textAlign: "center" }}>
              <p className="note" style={{ marginTop: 0 }}>{bap.spinPhase === "team" ? "Rolling a team..." : "Rolling their player..."}</p>
              <h1 key={bap.displayTeam} className="title" style={{ margin: "10px 0", animation: "pop .15s ease-out" }}>{TEAMS[bap.displayTeam][0]}</h1>
              {/* The player line is always there (hidden while the team rolls) so Cancel doesn't jump. */}
              <h3 key={bap.displayPlayer || "pending"} style={{ margin: 0, animation: "pop .15s ease-out", visibility: bap.spinPhase === "player" ? "visible" : "hidden" }}>{bap.displayPlayer || " "}</h3>
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={cancelBap}>Cancel</button>
          </>
        )}

        {view === "buildplayer" && bap && bap.stage === "build" && (
          <>
            <h2 className="h">Build-a-player - {POS_NAME[bap.pos]}</h2>
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
                    <div className="frow bap-attrs">
                      {attrs.map(([k, label, , calc]) => (
                        <button key={k} className="btn" aria-label={`Take his ${label}, graded ${grade(calc(bap.player))}`} onClick={() => pickBapAttr(k)}>
                          <span>{label}</span><span className={`bapgrade ${gradeTier(calc(bap.player))}`}>{grade(calc(bap.player))}</span>
                        </button>
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
                    <div className="rc bap" key={k}><div className="bd">{label} <span className="tk">{grade(bap.filled[k].score)}</span></div><div className="alt">{bap.filled[k].fromName}</div></div>
                  )))}
                </div>
              </>
            )}
            <button className="btn" style={{ marginTop: 12 }} onClick={cancelBap}>Cancel</button>
          </>
        )}

        {view === "buildplayer" && bap && bap.stage === "done" && (
          <>
            <h2 className="h">Build complete - {POS_NAME[bap.pos]}</h2>
            <p className="note" style={{ marginTop: 0 }}>
              Assembled from {new Set(Object.values(bap.filled).map((f) => f.fromName)).size} different real players' last-season attributes. Overall: <b>{grade(bapOverallScore(bap.filled))}</b>
            </p>
            {/* The next step comes first; the attribute-by-attribute breakdown is below it. */}
            <button className="btn solid" style={{ marginBottom: 14 }} onClick={playBapSim}>Give him his shot at a ring</button>
            <div className="panel">
              {BAP_CATS.map((cat) => (
                <div key={cat} style={{ marginBottom: 10 }}>
                  <h3 style={{ marginTop: 0 }}>{cat}</h3>
                  <div className="recap">
                    {BAP_ATTRS[bap.pos].filter(([, , c]) => c === cat).map(([k, label]) => (
                      <div className="rc bap" key={k}>
                        <div className="bd">{label} <span className="tk">{grade(bap.filled[k].score)}</span></div>
                        <div className="alt">from {bap.filled[k].fromName} <span style={{ opacity: 0.7 }}>({TEAMS[bap.filled[k].fromTeam][0]})</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
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
              <div className="result-hero" aria-live="polite">
                <div className="rec led-wrap"><span className="led">
                  {bap.sim.games.slice(0, bap.shown).filter((g) => g.win).length}–{bap.sim.games.slice(0, bap.shown).filter((g) => !g.win).length}
                </span></div>
                <div className="outcome">{bapDone ? bap.sim.outcome : "Playing the season…"}</div>
                {/* Inside the card and under the record, so the record doesn't jump down when it appears. */}
                {bapDone && (bap.sim.perfect || bap.sim.champ) && (
                  <div className={`cel bapcel ${bap.sim.perfect ? "perfect" : ""}`}>
                    <Confetti n={bap.sim.perfect ? 34 : 22} />
                    <span className="stamp">🏆 {bap.sim.perfect ? "Perfect season" : "Champions"}</span>
                  </div>
                )}
              </div>
              {/* Right under the record, so it doesn't slide off the screen as the season log grows. */}
              {/* Skip, then Build another / Done, in the same spot under the card - so the season log
                  below doesn't jump when the reveal finishes. */}
              {!bapDone ? (
                <button className="btn" style={{ marginBottom: 14 }} onClick={() => setBap((b) => ({ ...b, shown: b.sim.games.length }))}>Skip to the end ⏩</button>
              ) : (
                <div className="frow" style={{ marginBottom: 14 }}>
                  <button className="btn solid" onClick={openBuildPicker}>Build another</button>
                  <button className="btn" onClick={cancelBap}>Done</button>
                </div>
              )}
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

        {view === "statsou" && sou && !souIntro && (
          <>
            <h2 className="h">Over/Under</h2>
            <div className="sou-hud">
              <span className="sou-hearts">{"❤️".repeat(Math.max(0, sou.lives))}{"🖤".repeat(Math.max(0, SOU_LIVES - sou.lives))}</span>
              <span className="sou-score">Score {sou.score}</span>
              {/* Stays mounted after a guess, just hidden, so the HUD doesn't shrink and shift everything up. */}
              <span className={`sou-timer ${sou.timeLeft <= 3 && !sou.guess ? "danger" : ""}`} style={sou.guess ? { visibility: "hidden" } : undefined}>{sou.timeLeft}</span>
            </div>
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>{sou.round.name}</h3>
              <p className="note sou-teams" style={{ marginTop: 0 }}>{POS_NAME[sou.round.pos].replace(/s$/, "")} · played for {sou.round.teams.join(", ")}</p>
              <p className="sou-line">Career {sou.round.statLabel}: <b>{sou.round.line.toLocaleString()}</b></p>
              {/* One fixed-height slot for the answers and then the reveal, so nothing moves between the
                  two. Next round sits below the reveal line, never where Over was, so a double tap
                  can't skip straight past the answer. */}
              <div className="sou-slot">
                {!sou.guess ? (
                  <div className="sou-answers">
                    <button className="btn solid" onClick={() => souGuess("over")}>Over</button>
                    <button className="btn solid" onClick={() => souGuess("under")}>Under</button>
                  </div>
                ) : (
                  <>
                    <p className={`sou-fb ${sou.correct ? "ok" : "miss"}`}>
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
            </div>
            <button className="btn" style={{ marginTop: 12 }} onClick={leaveSou}>Back to modes</button>
          </>
        )}

        {/* The moment between opening the screen (or the last answer) and its saved state arriving. */}
        {view === "statsou" && !sou && !souIntro && !souDone && (
          <p className="muted">Loading…</p>
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
                      <td className="rk">{i + 1}</td><td><NameLink name={q.username} /></td><td className="r">{q.score}</td>
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
    </OpenProfile.Provider>
  );
}
