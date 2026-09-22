// Shared, framework-free game logic: everything that decides a draft's roster legality and its
// season-simulation outcome. Used identically by the client bundle (perfect-season.jsx imports
// this directly, bundled by esbuild same as any other module) and the Supabase Edge Function
// that re-verifies a submitted run server-side (supabase/functions/submit-run) - one copy, so the
// two can never drift apart. No React, no DOM, no Supabase - just data in, data out.
//
// Call initGameData(players, opponents) once at startup (both environments do this, each loading
// data/players.json in whatever way its runtime supports) before using anything else here.

export const POS = ["QB", "RB", "WR", "TE"];
export const WINDOWS = [[1999, 2005], [2006, 2010], [2011, 2015], [2016, 2020], [2021, 2025]];
export const SLOTS = ["QB", "RB", "WR", "TE", "FLEX1", "FLEX2"];
export const QB_WEIGHT = 1.25;
export const FLEX_POS = ["RB", "WR", "TE"];
// One team re-spin and one era re-spin per draft. Shared so the client's initial rerolls budget
// and replayDraft's enforcement of it can never independently drift out of sync.
export const REROLL_BUDGET = 1;

// ---------- Scoring formats ----------
// Two ways to grade the same draft. "fantasy" is full PPR (the original, and what every score
// stored before this existed was computed under); "standard" drops the point per reception, so
// yards and touchdowns decide a player's grade instead of catch volume - closer to what actually
// wins football games, which is what the season sim is modeling. The UI calls "standard"
// *Championship mode*; the internal name stays "standard" because champ/champs/championships
// already mean "won the title" everywhere else in this codebase (run.champ, profiles.champs, the
// Championship playoff round).
//
// Absence always normalizes to "fantasy", which is what lets every run, profile and draft
// snapshot written before this feature existed read back correctly with no backfill.
export const FORMATS = ["fantasy", "standard"];
export const normFormat = (f) => (f === "standard" ? "standard" : "fantasy");

// The seed for a day's daily draft. One definition, called by the client that deals the boards and
// by submit-run that replays them - the two must agree exactly or the server replays different
// boards and rejects every submission. They did once disagree (the client built "daily-<date>:std"
// while the server built "daily-<date>-std"), which silently discarded every Championship daily.
export const dailySeed = (date, format) => `daily-${date}${normFormat(format) === "standard" ? "-std" : ""}`;

// A rating is capped here before it reaches team-score math. Note the stored `rating` in
// data/players.json already has this applied (nothing in the file exceeds 130), so this only
// bites when computing a rating here.
export const RATING_CAP = 130;

// Points equal to a rating of exactly 100 under standard scoring, per position and era window -
// "a solid starter of that era", the same thing the full-PPR benchmarks mean. Derived by scaling
// each position/era's PPR benchmark by the standard-to-PPR points ratio of that cell's
// benchmark-caliber players, so both formats land on one comparable 0-130 scale. Like the PPR
// benchmarks, era 4 folds the 17/16 season-length factor into the number rather than scaling
// points separately. See SCORING.md.
const STD_BENCH = {
  QB: [269.7, 278.9, 334.6, 335.1, 363.4],
  RB: [274.4, 249.0, 235.5, 241.3, 257.4],
  WR: [195.0, 188.9, 202.8, 181.2, 193.1],
  TE: [108.3, 131.4, 144.8, 140.8, 121.4],
};
// Era averages (mean, standard deviation) for the efficiency adjustment below. SCORING.md Step 4.
const ERA_PASSER = [[80.2, 11.4], [83.1, 12.3], [87.3, 11.7], [91.6, 11.8], [91.3, 10.0]];
const ERA_COMP = [[59.2, 4.4], [60.8, 4.5], [61.5, 4.2], [64.1, 4.0], [64.8, 3.6]];
const ERA_YPC = [[4.07, 0.61], [4.23, 0.64], [4.20, 0.61], [4.29, 0.63], [4.35, 0.62]];

export const TEAMS = {
  ARI: ["Cardinals", "Arizona", "#97233F", "#FFB612"], ATL: ["Falcons", "Atlanta", "#A71930", "#1B1B1B"],
  BAL: ["Ravens", "Baltimore", "#241773", "#9E7C0C"], BUF: ["Bills", "Buffalo", "#00338D", "#C60C30"],
  CAR: ["Panthers", "Carolina", "#0085CA", "#101820"], CHI: ["Bears", "Chicago", "#0B162A", "#C83803"],
  CIN: ["Bengals", "Cincinnati", "#FB4F14", "#1B1B1B"], CLE: ["Browns", "Cleveland", "#311D00", "#FF3C00"],
  DAL: ["Cowboys", "Dallas", "#003594", "#869397"], DEN: ["Broncos", "Denver", "#FB4F14", "#002244"],
  DET: ["Lions", "Detroit", "#0076B6", "#B0B7BC"], GB: ["Packers", "Green Bay", "#203731", "#FFB612"],
  HOU: ["Texans", "Houston", "#03202F", "#A71930"], IND: ["Colts", "Indianapolis", "#002C5F", "#A2AAAD"],
  JAX: ["Jaguars", "Jacksonville", "#006778", "#D7A22A"], KC: ["Chiefs", "Kansas City", "#E31837", "#FFB81C"],
  LA: ["Rams", "Los Angeles", "#003594", "#FFD100"], LAC: ["Chargers", "Los Angeles", "#0080C6", "#FFC20E"],
  LV: ["Raiders", "Las Vegas", "#1B1B1B", "#A5ACAF"], MIA: ["Dolphins", "Miami", "#008E97", "#FC4C02"],
  MIN: ["Vikings", "Minnesota", "#4F2683", "#FFC62F"], NE: ["Patriots", "New England", "#002244", "#C60C30"],
  NO: ["Saints", "New Orleans", "#A08A58", "#101820"], NYG: ["Giants", "New York", "#0B2265", "#A71930"],
  NYJ: ["Jets", "New York", "#125740", "#FFFFFF"], PHI: ["Eagles", "Philadelphia", "#004C54", "#A5ACAF"],
  PIT: ["Steelers", "Pittsburgh", "#FFB612", "#101820"], SEA: ["Seahawks", "Seattle", "#002244", "#69BE28"],
  SF: ["49ers", "San Francisco", "#AA0000", "#B3995D"], TB: ["Buccaneers", "Tampa Bay", "#D50A0A", "#34302B"],
  TEN: ["Titans", "Tennessee", "#0C2340", "#4B92DB"], WAS: ["Washington", "", "#5A1414", "#FFB612"],
};

// The standard NFL passer-rating formula. Lives here rather than in perfect-season.jsx because
// the efficiency adjustment below needs it and that adjustment runs server-side too; the player
// card's "QB rating" stat cell imports it back from here.
export function passerRating(p) {
  if (!p.att) return 0;
  const c = (x) => Math.max(0, Math.min(2.375, x));
  const a = c((p.cmp / p.att - 0.3) * 5), b = c((p.py / p.att - 3) * 0.25);
  const t = c((p.ptd / p.att) * 20), d = c(2.375 - (p.int / p.att) * 25);
  return ((a + b + t + d) / 6) * 100;
}

// How much a QB's passer rating / completion %, or an RB's yards per carry, moves his grade off
// pure production, measured against his own era's average. The min(1, ...) term means a
// low-volume player only earns part of the swing, so a backup with 80 efficient carries can't
// inflate his grade. SCORING.md Step 4.
//
// This is deliberately IDENTICAL in both scoring formats: the formats differ in what counts as
// production (Step 1), not in how efficiency is credited on top of it.
//
// It is also deliberately recomputed here rather than recovered from the stored `rating` by
// subtracting its production term. The two look equivalent - they agree to ~0.03 for over 98% of
// players - but inverting a value that was CAPPED at RATING_CAP before storage understates the
// adjustment by up to 12 rating points on exactly the all-time seasons that decide a top
// leaderboard score (LaDainian Tomlinson 2003: 130 recomputed vs 117.4 inverted). Don't
// "simplify" this back into an inversion.
export function efficiencyAdj(p) {
  if (p.pos === "QB" && p.att > 0) {
    const [pm, ps] = ERA_PASSER[p.w], [cm, cs] = ERA_COMP[p.w];
    const z = (2 * ((passerRating(p) - pm) / ps) + ((100 * p.cmp) / p.att - cm) / cs) / 3;
    return 5 * z * Math.min(1, p.att / 300);
  }
  if (p.pos === "RB" && p.car > 0) {
    const [ym, ys] = ERA_YPC[p.w];
    return 4 * ((p.ry / p.car - ym) / ys) * Math.min(1, p.car / 200);
  }
  return 0;
}

// A player's grade under standard (non-PPR) scoring. Standard points are exactly `ppr - rec`:
// full PPR and standard differ ONLY by the one point per reception, every other term is the same.
// That identity matters - recomputing points from the visible box-score columns is not viable,
// because two-point conversions and return TDs are baked into the stored `ppr` without having
// columns of their own (~656 of 3,124 rows would come out short).
export function standardRating(p) {
  const production = (100 * (p.ppr - p.rec)) / STD_BENCH[p.pos][p.w];
  return Math.min(RATING_CAP, production + efficiencyAdj(p));
}

// ---------- Data load ----------
// Populated by initGameData(); exported as `let` bindings so every importer sees the live values
// once initialized (standard ES module live-binding - works the same in an esbuild bundle and in
// Deno). Mirrors what used to be inline module-scope computation in perfect-season.jsx.
export let BOARDS = {};
export let OPPS = [];
export let PLAYOFF_OPPS = [];
let flexStatsByEra = [];
let flexStatsByEraStd = [];
// The highest Flex rating the FANTASY scale gives any player who can actually stand in a Flex slot.
// Championship is held to it - see flexRating.
let flexCeiling = Infinity;
export const flexCap = () => flexCeiling;

export function initGameData(players, opponents) {
  const boards = {};
  for (const [key, arr] of Object.entries(players.b)) {
    const [team, w] = key.split("|");
    boards[key] = arr.map((e) => {
      const p = {
        id: e[0], name: players.n[e[0]], pos: POS[e[1]], season: e[2], g: e[3],
        cmp: e[4], att: e[5], py: e[6], ptd: e[7], int: e[8],
        car: e[9], ry: e[10], rtd: e[11], rec: e[12], rcy: e[13], rctd: e[14],
        fl: e[15], ppr: e[16], rating: e[17], team, w: Number(w),
      };
      // Standard-format equivalents of ppr/rating, derived once here so every consumer (grading,
      // salary, the Edge Function, the test mock) is a field lookup over identical values rather
      // than an independent recomputation that could drift.
      p.stdPoints = p.ppr - p.rec;
      p.stdRating = standardRating(p);
      return p;
    }).sort((x, y) => {
      const lx = x.name.split(" ").slice(1).join(" ") || x.name;
      const ly = y.name.split(" ").slice(1).join(" ") || y.name;
      return lx.localeCompare(ly);
    });
  }
  BOARDS = boards;
  OPPS = opponents.map(([season, team, rec, reg, po]) => ({ season, team, rec, reg, po }));
  PLAYOFF_OPPS = OPPS.filter((o) => o.po != null);

  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
  const std = (xs, m) => Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length) || 1;
  // One pass builds both formats' pool stats from the same players, so they can't fall out of
  // sync. `ratingStd` here is a standard DEVIATION - unrelated to the "standard" scoring format,
  // whose fields are named stdPoints/stdRating.
  const poolStats = (pool, points, rating) => {
    const pprMean = mean(pool.map(points));
    const ratingMean = mean(pool.map(rating));
    return {
      pprMean, pprStd: std(pool.map(points), pprMean),
      ratingMean, ratingStd: std(pool.map(rating), ratingMean),
    };
  };
  flexStatsByEra = [];
  flexStatsByEraStd = [];
  WINDOWS.forEach((_, w) => {
    const pool = [];
    for (const key of Object.keys(BOARDS)) {
      if (Number(key.split("|")[1]) !== w) continue;
      for (const p of BOARDS[key]) if (FLEX_POS.includes(p.pos)) pool.push(p);
    }
    flexStatsByEra[w] = poolStats(pool, (p) => p.ppr, (p) => p.rating);
    flexStatsByEraStd[w] = poolStats(pool, (p) => p.stdPoints, (p) => p.stdRating);
  });
  // Measured, not written down, so it follows the data: add a season and it moves with it.
  flexCeiling = -Infinity;
  for (const key of Object.keys(BOARDS)) {
    for (const p of BOARDS[key]) {
      if (!FLEX_POS.includes(p.pos)) continue;
      const r = flexRating(p, "fantasy");
      if (r > flexCeiling) flexCeiling = r;
    }
  }
}

// ---------- Seeded randomness ----------
// A daily or a challenge code gives everyone the same draft.
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Runs fn with Math.random replaced by a seeded generator. The sim is synchronous, so nothing
// else can draw from it in the meantime.
export function withSeed(seed, fn) {
  const real = Math.random;
  Math.random = mulberry32(hashStr(seed));
  try { return fn(); } finally { Math.random = real; }
}

// ---------- Roster legality ----------
export const fits = (pos, slot) => (slot.startsWith("FLEX") ? pos !== "QB" : slot === pos);
export const pick = (a) => a[Math.floor(Math.random() * a.length)];

// Whether a board can be picked from at all: somebody on it who isn't drafted and fits a slot still open.
//
// `cap` is GM mode's, and it is the whole of the answer there: a board nobody AFFORDABLE is on is exactly
// as unusable as one nobody eligible is on, and the sequence already knows how to walk past the second
// kind. It did not know about the first, so GM dealt boards where every Lock in button was disabled and
// the only way out was abandoning the draft - 17.7% of drafts by a player taking the best affordable man
// each round, and a re-spin was no escape either: 6.9% of them landed on another board just as dead.
//
// Passing it is optional and omitting it gives the original answer exactly, so nothing outside GM moves.
// The server applies the same test in replayDraft, from the roster it has rebuilt, or it would reject a
// draft for skipping a board the app was right to skip.
export function boardHasOption(key, drafted, open, cap = null) {
  const b = BOARDS[key];
  if (!b) return false;
  return b.some((p) => !drafted.has(p.id)
    && open.some((s) => fits(p.pos, s))
    && (!cap || playerSalary(p, cap.format) <= cap.left));
}

// The draft sequence for a seed: six boards plus alternates for re-spins, with no repeated team
// and no era more than twice.
export function seededSequence(seed) {
  const rng = mulberry32(hashStr(seed));
  const all = Object.keys(BOARDS);
  for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
  const out = [], teams = new Set(), eras = {};
  for (const key of all) {
    const [t, w] = key.split("|");
    if (teams.has(t) || (eras[w] || 0) >= 2) continue;
    out.push(key); teams.add(t); eras[w] = (eras[w] || 0) + 1;
    if (out.length >= 18) break;
  }
  return out;
}

export function boardAt(list, from, r, cap = null) {
  const d = new Set(Object.values(r).map((p) => p.id));
  const o = SLOTS.filter((s) => !r[s]);
  for (let i = from; i < list.length; i++) if (boardHasOption(list[i], d, o, cap)) return i;
  return -1;
}
// What is left of the cap for a roster part-drafted, or null outside GM - the shape boardAt and
// boardHasOption want. One place to work it out, so the client and the replay cannot drift.
export function capLeftFor(roster, { gm, format } = {}) {
  if (!gm) return null;
  let spent = 0;
  for (const s of SLOTS) if (roster[s]) spent += playerSalary(roster[s], format);
  return { format, left: GM_CAP - spent };
}

// Mirrors reroll()'s pool selection exactly (same RNG derivation, same match() filter) - shared
// so the client's live reroll and the server's replay/legality check can never drift apart.
// Returns the picked board key, or null if no candidate exists (same as a no-op reroll).
// `sequenceRules` is single player's, and only single player's: seededSequence builds its drafts to "no
// team twice, no era more than twice", and a re-spin has to keep that or the rules mean nothing - 11.9% of
// completed drafts used to hold the same team twice, 27.3% one era more than twice. 1v1 shares this
// function and does NOT share those rules: it deals eight boards, and versus-logic.mjs decides for itself
// what a board has to be able to do (VERSUS.md 8). So it is off unless asked for.
export function rerollCandidate({ seed, kind, seqIdx, spinTeam, spinW, shown, drafted, open, sequenceRules = false }) {
  // What the planned sequence already holds, by team and by era. seededSequence builds every draft to
  // "no team twice, no era more than twice" - and a re-spin used to ignore both, checking only that the
  // exact team|era pair was unseen. So a team re-spin could hand you a team already queued later under
  // another era: 11.9% of completed drafts drafted from the same team twice, and 27.3% had one era more
  // than twice. The point of those rules is that six boards feel like six different boards.
  // Which teams the planned sequence already holds. seededSequence allows each team once across the
  // whole plan, so this leaves plenty to spin to - unlike its other rule, "no era more than twice",
  // which the plan fills completely (five eras, twice each, is exactly the ten boards it returns). An
  // era re-spin measured against THAT has nothing to offer and would simply stop working, so the era
  // count is left alone: seeing one era twice among six boards is ordinary, and a third is a great deal
  // less jarring than drafting Cleveland twice - which is what this rule is really for, and what
  // 11.9% of completed drafts used to do.
  const teams = new Set();
  for (const key of shown) teams.add(key.split("|")[0]);
  const match = (key) => {
    const [t, w] = key.split("|");
    if (shown.has(key) || !boardHasOption(key, drafted, open)) return false;
    if (kind !== "team") return t === spinTeam;          // same team, another era: never a repeat
    return Number(w) === spinW && (!sequenceRules || !teams.has(t));
  };
  const rng = mulberry32(hashStr(`${seed}-reroll-${kind}-${seqIdx}`));
  const pool = Object.keys(BOARDS).filter(match);
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}

// Server-side roster legality: replays a submitted draft trace against the seed's own deterministic
// sequence and confirms it's something the client could actually have produced - never trusts a
// client-computed roster/score directly. `seq` is the final board sequence the client ended up with
// (seededSequence(seed)'s base entries, plus 0-2 reroll insertions spliced in - see reroll() in
// perfect-season.jsx); `history` is the ordered list of picks, each `{key, id, season, slot}`.
//
// A reroll-inserted board is never one of seededSequence's own entries (reroll's own match()
// excludes anything in `shown`, which starts as the full base sequence - see rerollCandidate), so
// diffing `seq` against `base` position-by-position unambiguously identifies where insertions
// happened, with no risk of a coincidental collision. Walking both together left to right also
// naturally reconstructs the roster/drafted state at each point, since picks and reroll insertions
// occur in the same real-time order they appear in `seq`.
export function replayDraft(seed, history, seq, { gm = false, format } = {}) {
  const fail = (reason) => ({ ok: false, reason });
  if (!Array.isArray(history) || !Array.isArray(seq) || history.length !== SLOTS.length) return fail("wrong shape");

  const base = seededSequence(seed);
  const roster = {};
  const drafted = new Set();
  const shown = new Set(base); // reroll() always treats every base entry as already "shown", even ones not yet reached
  let basePtr = 0;
  const rerollsUsed = { team: 0, years: 0 };
  let histPtr = 0;
  let prevKey = null;
  // Whether the previous entry was a board on screen - one with a legal pick - that wasn't picked from: the only kind
  // of board a re-spin replaces.
  let prevOnScreen = false;

  for (let si = 0; si < seq.length; si++) {
    if (SLOTS.every((s) => roster[s])) break; // roster already complete - nothing left to validate
    const key = seq[si];
    const open = SLOTS.filter((s) => !roster[s]);

    if (key === base[basePtr]) {
      basePtr++;
    } else {
      if (prevKey == null) return fail("a reroll can't happen before any board was shown");
      // Tied to a board the draft already picked from (or one it skipped for having no pick), a re-spin would add a
      // board to pick from rather than replace the one on screen.
      if (!prevOnScreen) return fail("a reroll must replace a board that was on screen and not picked from");
      const [prevTeam, prevW] = prevKey.split("|");
      const [team, w] = key.split("|");
      let kind;
      if (Number(w) === Number(prevW) && team !== prevTeam) kind = "team";
      else if (team === prevTeam && Number(w) !== Number(prevW)) kind = "years";
      else return fail("reroll insertion doesn't share a team or era with the board it replaced");
      if (rerollsUsed[kind] >= REROLL_BUDGET) return fail(`more than ${REROLL_BUDGET} ${kind} reroll(s) used`);
      const expected = rerollCandidate({ seed, kind, seqIdx: si - 1, spinTeam: prevTeam, spinW: Number(prevW), shown, drafted, open, sequenceRules: true });
      if (expected !== key) return fail("reroll result doesn't match what this seed would produce");
      rerollsUsed[kind]++;
      shown.add(key);
    }

    // The client would have skipped this board too - nobody on it fits a slot still open, or in GM
    // nobody on it is still affordable.
    if (!boardHasOption(key, drafted, open, capLeftFor(roster, { gm, format }))) { prevKey = key; prevOnScreen = false; continue; }

    if (histPtr < history.length && history[histPtr].key === key) {
      const h = history[histPtr];
      const player = (BOARDS[key] || []).find((p) => p.id === h.id && p.season === h.season);
      if (!player) return fail("picked player not found on this board");
      if (!fits(player.pos, h.slot)) return fail("player doesn't fit the claimed slot");
      if (roster[h.slot]) return fail("slot already filled");
      if (drafted.has(player.id)) return fail("player drafted twice");
      roster[h.slot] = player;
      drafted.add(player.id);
      histPtr++;
      prevOnScreen = false;
    } else if (si + 1 >= seq.length || seq[si + 1] === base[basePtr]) {
      // The app leaves a board it could pick from only by picking or by re-spinning it, which puts the new board
      // straight after this one. Walking past it to the next base board instead would let a trace draft the best six
      // of the sequence's eighteen boards (on a Daily, better than any draft the app allows).
      return fail("a board with a legal pick was passed over");
    } else {
      prevOnScreen = true;
    }
    prevKey = key;
  }

  if (histPtr !== history.length) return fail("not every submitted pick was consumed");
  if (!SLOTS.every((s) => roster[s])) return fail("roster incomplete");
  return { ok: true, roster };
}

// ---------- Grading ----------
// Flex slots score on raw production alone, not position-relative grading: `rating` grades
// RB/WR/TE against their OWN position's peers, so a modest-for-a-WR season can outrank a
// dominant-for-a-TE season even though the TE outproduced everyone at his own spot - fine for the
// named slots, wrong for a slot that's explicitly position-agnostic. Renormalize ppr across the
// combined RB/WR/TE pool per era window, then rescale onto the numeric range `rating` already
// occupies for that same pool, so team-score math doesn't need to change - only which player
// comes out on top for a Flex spot.
// Deliberately NOT capped at RATING_CAP, unlike the named-slot ratings baked into the data. This
// is the one place an all-time season can show its full value: a named slot clips McCaffrey 2019 to
// 130, while Flex rates him 168. Flex is therefore where your best player usually belongs, and the
// draft recap and the grading note both say so - it was only confusing while it went unexplained.
//
// The cap's other job is keeping team scores inside the range where the season simulation still has
// any uncertainty: winProb is decided outright at a 20-point gap and the strongest opponent is
// rated 120, so a team score of 140 would beat everything in the game automatically. Uncapped Flex
// can't realistically get there - named slots are still hard-capped, so it would take TWO
// 168-caliber Flex players plus three capped named picks on the same six boards. Across 400
// best-available drafts the highest team score seen was 129.2. If that ever stops being true (new
// season data, a re-rating), this is the first thing to re-check.
export function flexRating(p, format) {
  const std = normFormat(format) === "standard";
  const s = (std ? flexStatsByEraStd : flexStatsByEra)[p.w];
  const points = std ? p.stdPoints : p.ppr;
  const raw = s.ratingMean + ((points - s.pprMean) / s.pprStd) * s.ratingStd;
  // Championship may not out-reach Fantasy. The paragraph above names the condition this whole cap
  // exists for - "if that ever stops being true, this is the first thing to re-check" - and for
  // Championship it had: re-anchoring production onto the shared scale lifted the top Flex rating from
  // 172.8 to 197.9 (LaDainian Tomlinson 2006, the same player either way). Two of those and three
  // capped named picks cleared 140, which beats every opponent in the game at winProb exactly 1 - so
  // the season was not simulated at all, and 3 of 16,550 real challenge codes handed out a guaranteed
  // 20-0 that replayDraft correctly accepts, because it is a legal draft.
  //
  // Fantasy's own ceiling is the cap because Fantasy's is the one that was measured safe (129.2 over
  // 400 best-available drafts, 139.6 over 6,000 seeds). Fantasy is unchanged by construction: nothing
  // there can exceed its own maximum. Nobody on the live Championship board was near it - the top
  // score there is 120.7 - so no posted score moves.
  return std ? Math.min(flexCeiling, raw) : raw;
}
// The rating a player should count as in team-score math for the slot they're in: their normal
// positional grade for a named slot, or their stats-only flexRating for a Flex spot. Omitting
// `format` gives the original full-PPR grading exactly.
export function effectiveRating(slot, p, format) {
  if (slot.startsWith("FLEX")) return flexRating(p, format);
  return normFormat(format) === "standard" ? p.stdRating : p.rating;
}

// ---------- GM mode (salary cap) ----------
// No real salary data exists, so this derives a price from the player's own positional rating -
// a player costs what he costs regardless of which slot (named or Flex) ends up using him, same
// as a real contract doesn't change based on where he lines up on a given play. Curved rather
// than linear so elite seasons cost more per rating point than average ones, but capped low
// enough that even the best single season in the game (rating ~120) tops out around a quarter of
// GM_CAP - one all-timer shouldn't eat half your budget by itself. Shared so submit-run can
// recompute capUsed itself from the verified roster instead of trusting the client's report.
// Prices follow whichever format is being played, so the cap stays meaningful in both - pricing
// standard-format rosters off full-PPR ratings would make big-play receivers better AND cheaper.
export const GM_CAP = 150; // in $M, for a 6-man "roster"
// The floor playerSalary can return, so "what every slot still to fill costs at the very least" is one
// number both the bot and the draft screen hold back. They must agree: par is measured against a bot
// keeping this reserve, so a player allowed to spend past it is scored against a standard they were
// not held to - and, worse, can spend themselves out of a roster they are then charged a DNF for.
export const MIN_SALARY = 1;
export function playerSalary(p, format) {
  const r = Math.max(0, (normFormat(format) === "standard" ? p.stdRating : p.rating) - 35);
  return Math.max(1, Math.round(0.0055 * r * r));
}

// ---------- Points ladder ----------
// Every score-based leaderboard in this game ranks peak output against a dataset that doesn't
// change, so they all saturate: there is a hard maximum team score, and position records are
// already permanently frozen. Points rank something that can't saturate - how well you drafted the
// boards you were actually dealt - and accumulate, so topping a board needs skill AND volume.
//
// Par is a BOT that played the same six boards, not the theoretically best roster. Measuring
// against the true optimum compresses everyone good into 96-100% of it (mechanically taking the
// best available player already scores 96.5%), and 100% is a ceiling you can't pass. A handicapped
// bot leaves room above par, works under GM's salary cap (where the true optimum is often
// unaffordable, i.e. not a legal target), and can't accidentally count a player twice.
//
// BOT_PICK_RANK is the handicap and the main balance knob. Measured over 250 drafts: at rank 2, a
// player taking the best pick every round averages 114% of par and clears it 98% of the time, a
// third-best drafter averages 90%, and random play 60%. At rank 1 the bot is unbeatable - nobody
// clears it, ever - so it stops being an opponent and becomes a ceiling again.
export const BOT_PICK_RANK = 2;
// PAR_FLOOR sits below 1.0 on purpose: pinned at par, a competent player would earn exactly
// nothing and the ladder would never move. Points are zero at PAR_FLOOR and rise from there.
export const PAR_FLOOR = 0.85;
export const POINT_SCALE = 500;
export const MIN_POINTS = -300; // one catastrophic draft shouldn't erase a week
export const DNF_POINTS = -50;
// Only this many drafts a day count toward a ladder in the uncapped modes. Everything still banks.
// Without it, an accumulating ladder in a mode you can play forever ranks free time above skill.
export const DAILY_COUNTED_DRAFTS = 5;

// Which ladder a run belongs to. Daily wins over the variant flags because it's the stricter
// constraint (one a day); GM over Genius because the salary cap changes the draft more than hidden
// stats do.
export function modeKey(run) {
  if (run?.mode === "daily") return "daily";
  if (run?.gm) return "gm";
  if (run?.genius) return "genius";
  return "unlimited";
}
export const LADDERS = ["daily", "unlimited", "genius", "gm"];

// The bot's team score on a given set of boards. Deterministic: the same boards always produce the
// same par, so the server recomputes it rather than trusting anything the client says about it.
//
// Plays the boards the PLAYER actually drafted from (history[].key), not the seed's own sequence -
// a reroll changes which boards you faced, and par has to move with it or rerolling into an easy
// board would be free points.
//
// Returns null when the boards can't field a legal roster at all; callers treat that as "no points
// for this draft" rather than an error.
export function botPar(boardKeys, { format, gm } = {}) {
  if (!Array.isArray(boardKeys) || boardKeys.length !== SLOTS.length) return null;
  // Two passes under a salary cap. The first is the real bot; if IT paints itself into a corner - the
  // pick is greedy, so it can spend itself out of a legal roster on boards a human completed - the
  // second walks the same boards taking the cheapest man who fits, which is what somebody short of cap
  // actually does and all but always finishes. Only if even that can't field a roster is there no par.
  // The alternative was `null`, and draftPoints turns null into ZERO points for a season that was
  // played properly: 2.2% of finished GM seasons scored nothing at all.
  return botWalk(boardKeys, { format, gm, cheapest: false })
    ?? (gm ? botWalk(boardKeys, { format, gm, cheapest: true }) : null);
}

function botWalk(boardKeys, { format, gm, cheapest } = {}) {
  const roster = {};
  const drafted = new Set();
  let spent = 0;

  for (const key of boardKeys) {
    const open = SLOTS.filter((s) => !roster[s]);
    const board = BOARDS[key] || [];
    const remaining = (open.length - 1) * MIN_SALARY; // every other slot still needs at least the minimum
    const all = [];        // everything legal, cap aside
    const affordable = [];  // ...and still leaving the minimum for every slot after this one
    for (const p of board) {
      if (drafted.has(p.id)) continue;
      const cost = gm ? playerSalary(p, format) : 0;
      for (const s of open) {
        if (!fits(p.pos, s)) continue;
        const c = { p, s, cost, r: effectiveRating(s, p, format) };
        if (gm && spent + cost > GM_CAP) continue;          // cannot be bought at all
        all.push(c);
        if (!gm || spent + cost + remaining <= GM_CAP) affordable.push(c);
      }
    }
    // Short of cap, a human takes the cheapest man who fits rather than giving up, and so does the
    // bot. It used to give up: `remaining` reserves $1M a slot AND the pick is greedy, so on 2-5% of
    // finished GM seasons the bot spent itself out of a legal roster on boards a human had completed,
    // botPar came back null, and draftPoints turned that into zero points for a season that was
    // played properly.
    const pool = affordable.length ? affordable : all;
    if (!pool.length) return null;
    if (cheapest) {
      // The spend-least walk: cheapest first, and the best slot for him among equals.
      const cheap = pool.slice().sort((a, b) => a.cost - b.cost || b.r - a.r || a.p.id - b.p.id || a.s.localeCompare(b.s))[0];
      roster[cheap.s] = cheap.p;
      drafted.add(cheap.p.id);
      spent += cheap.cost;
      continue;
    }
    // One candidate per PLAYER, at the best slot open to him. This was one per (player, slot) pair -
    // and flexRating does not depend on WHICH flex, so whenever both Flex slots were open the same man
    // held ranks 1 and 2 and "the second best" was literally the best again. The handicap no-opped on
    // 27% of the bot's picks, which made par too high and every points total and coin payout about 17%
    // low. BOT_PICK_RANK's 250-draft calibration was measured against that, so fixing it moves the
    // ladder: totals already banked stay, and seasons from here on earn what they were meant to.
    const bestSlot = new Map();
    for (const c of pool) {
      const held = bestSlot.get(c.p.id);
      if (!held || c.r > held.r || (c.r === held.r && c.s.localeCompare(held.s) < 0)) bestSlot.set(c.p.id, c);
    }
    // Sorted by rating, then player id, then slot - the id/slot tiebreaks are what make this
    // reproducible rather than dependent on board array order.
    const cands = [...bestSlot.values()].sort((a, b) => b.r - a.r || a.p.id - b.p.id || a.s.localeCompare(b.s));
    const choice = cands[Math.min(BOT_PICK_RANK - 1, cands.length - 1)];
    roster[choice.s] = choice.p;
    drafted.add(choice.p.id);
    spent += choice.cost;
  }

  if (!SLOTS.every((s) => roster[s])) return null;
  let tot = 0, wt = 0;
  for (const s of SLOTS) { const k = s === "QB" ? QB_WEIGHT : 1; tot += effectiveRating(s, roster[s], format) * k; wt += k; }
  return tot / wt;
}

// Points for one finished draft, from how the player's team score compared to the bot's.
export function draftPoints(playerScore, par) {
  if (!par || par <= 0 || !Number.isFinite(playerScore)) return 0;
  return Math.max(MIN_POINTS, Math.round(POINT_SCALE * (playerScore / par - PAR_FLOOR)));
}

// Ladder bookkeeping for the uncapped modes: a rolling record of today's earnings per mode, from
// which only the best DAILY_COUNTED_DRAFTS count. Returns the updated record plus how much the
// ladder total should move - a delta, because a later draft can displace an earlier one from the
// counted set, and the ladder column holds a running total rather than being recomputed.
//
// `day` is the player's own calendar date, the same string the daily uses.
export function applyDayPoints(prev, mode, points, day) {
  // `prev && ...`, not `prev?.date === day`: with no prior record and no day, that comparison is
  // undefined === undefined, which would carry a non-existent record forward.
  const fresh = prev && prev.date === day ? prev : { date: day, byMode: {} };
  const before = (fresh.byMode?.[mode] || []).slice();
  const after = [...before, points];
  const counted = (xs) => [...xs].sort((a, b) => b - a).slice(0, DAILY_COUNTED_DRAFTS).reduce((t, x) => t + x, 0);
  return {
    day: { date: day, byMode: { ...(fresh.byMode || {}), [mode]: after } },
    delta: counted(after) - counted(before),
  };
}

// ---------- Season simulation ----------
export const LOSER_PTS = [0, 3, 6, 7, 9, 10, 10, 13, 13, 14, 16, 17, 17, 20, 20, 21, 23, 24, 27];
export const MARGINS = [1, 2, 3, 3, 3, 4, 5, 6, 7, 7, 7, 8, 10, 10, 11, 13, 14, 14, 17, 21];
// Win probability scales linearly with the score gap and is fully deterministic (0% or 100%) once
// the gap passes SPREAD - a real lead should basically never be upset. Smaller SPREAD = fewer
// upsets, more linear/decisive.
const SPREAD = 20;
export const winProb = (s, o) => Math.max(0, Math.min(1, 0.5 + (s - o) / (2 * SPREAD)));

export function gameResult(s, o) {
  const win = Math.random() < winProb(s, o);
  const lo = pick(LOSER_PTS);
  let m = pick(MARGINS);
  if (win && s - o > 15 && Math.random() < 0.5) m = pick([14, 17, 21, 24, 28]);
  if (lo === 0 && m < 3) m = 3; // no 1-0 or 2-0 finals
  return win ? { win, us: lo + m, them: lo } : { win, us: lo, them: lo + m };
}

export const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
// Shuffles only within fixed-size windows, so the array keeps its overall order (weakest to
// strongest) while still varying week to week within each window - a schedule ramp, not a hard
// ladder.
export const windowedShuffle = (a, windowSize) => {
  const b = [...a];
  for (let start = 0; start < b.length; start += windowSize) {
    const end = Math.min(start + windowSize, b.length);
    for (let i = end - 1; i > start; i--) {
      const j = start + Math.floor(Math.random() * (i - start + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
  }
  return b;
};
export function tagOpp(g, o) {
  g.opp = `${o.season} ${TEAMS[o.team][0]}`;
  g.oppShort = TEAMS[o.team][0];
  g.oppRec = o.rec;
  g.oppTeam = o.team;
  return g;
}

// Break a final score into scoring plays: TD 7, FG 3, TD + two-point try 8, TD with missed PAT 6,
// safety 2. Safeties only show up when nothing else can make the number (2, 4, 5). Purely
// cosmetic (feeds the playoff play-by-play animation) but draws from the same seeded Math.random
// stream mid-simulation - dropping it server-side would desync every subsequent playoff round's
// win/loss roll from what the client already showed, so it must run here even though its output
// (the play list) isn't itself persisted.
function scoringPlays(n) {
  const reach = (k) => k === 0 || k === 3 || k >= 6;
  const out = [];
  while (n > 0) {
    const c = [[7, 5], [3, 3], [8, 0.4], [6, 0.4]].filter(([v]) => v <= n && reach(n - v));
    if (!c.length) { out.push(2); n -= 2; continue; }
    let r = Math.random() * c.reduce((a, [, w]) => a + w, 0);
    for (const [v, w] of c) { if ((r -= w) <= 0) { out.push(v); n -= v; break; } }
  }
  return out;
}
// V8's TimSort for arrays of under 64 items, written out so the season sim can't depend on the
// JavaScript engine running it. buildTimeline shuffles the plays with a random comparator, which
// isn't a real ordering: how many times an engine calls it is up to the engine, and every call draws
// from the seeded stream. Newer V8 (Chrome 152's) skips a comparison that the older V8 in the
// server's Deno runtime makes, so a Chrome player's stream drifted after the first playoff game and
// the season on screen could differ from the one saved (19–1 shown, 20–0 stored). This makes the
// server's exact calls in every browser - one natural run, then binary insertion - so every season
// already saved still replays the same. V8 splits 64 or more items into several runs; a game never
// gets near that (at most 41 scoring plays, each worth 2 points or more).
export function smallTimSort(a, compare) {
  const n = a.length;
  if (n < 2) return a;
  // The leading run: strictly descending (reversed in place) or never descending.
  let run = 2;
  const descending = compare(a[1], a[0]) < 0;
  for (let i = 2; i < n; i++) {
    const order = compare(a[i], a[i - 1]);
    if (descending ? order >= 0 : order < 0) break;
    run++;
  }
  if (descending) {
    for (let lo = 0, hi = run - 1; lo < hi; lo++, hi--) [a[lo], a[hi]] = [a[hi], a[lo]];
  }
  // Binary insertion for the rest; an equal item goes after its equals, so the sort is stable.
  for (let start = run; start < n; start++) {
    const pivot = a[start];
    let left = 0, right = start;
    while (left < right) {
      const mid = left + ((right - left) >> 1);
      if (compare(pivot, a[mid]) < 0) right = mid;
      else left = mid + 1;
    }
    for (let p = start; p > left; p--) a[p] = a[p - 1];
    a[left] = pivot;
  }
  return a;
}

export function buildTimeline(us, them, win) {
  const plays = smallTimSort([
    ...scoringPlays(us).map((v) => ({ team: "us", v })),
    ...scoringPlays(them).map((v) => ({ team: "them", v })),
  ], () => Math.random() - 0.5);
  const close = Math.abs(us - them) <= 8;
  if (close && plays.length) {
    // close game: the winner gets the last score (a real drive, not a safety), late in the fourth
    const w = win ? "us" : "them";
    let li = -1;
    plays.forEach((p, i) => { if (p.team === w && p.v !== 2) li = i; });
    if (li >= 0) { const [p] = plays.splice(li, 1); plays.push(p); }
  }
  // spread scores out with at least ~2.5 game minutes between them
  const n = plays.length, GAP = 2.5;
  const lastFixed = close && n ? 57.2 + Math.random() * 2.4 : null;
  const end = lastFixed ? lastFixed - GAP : 58.5;
  const m = lastFixed ? n - 1 : n;
  const room = Math.max(0, end - 1.5 - (m - 1) * GAP);
  const base = Array.from({ length: m }, () => Math.random() * room).sort((a, b) => a - b);
  base.forEach((b, i) => { plays[i].time = Math.round((1.5 + b + i * GAP) * 60) / 60; });
  if (lastFixed) plays[n - 1].time = Math.round(lastFixed * 60) / 60;
  return plays;
}

export function simulateSeason(score) {
  const games = [];
  // Same random 17-team draw as before, just reordered so difficulty trends easy-to-hard across
  // the season instead of pure random placement - a strong team's rare loss should come late
  // against a real threat, not out of nowhere in week 2.
  const drawn = shuffle(OPPS).slice(0, 17);
  const schedule = windowedShuffle([...drawn].sort((a, b) => a.reg - b.reg), 5);
  const usedOpp = new Set(schedule);
  let w = 0, l = 0;
  schedule.forEach((o, i) => {
    const g = tagOpp(gameResult(score, o.reg), o);
    g.label = `Wk ${i + 1}`;
    g.home = Math.random() < 0.5;
    games.push(g);
    g.win ? w++ : l++;
  });
  let outcome;
  if (w < 10) {
    outcome = "Missed the playoffs";
  } else {
    const rounds = w >= 13 ? ["Divisional", "Conference", "Championship"] : ["Wild Card", "Divisional", "Conference", "Championship"];
    // Playoff opponents get tougher each round. Draw a wide field before banding by round (rather
    // than sorting a tiny 3-4 team sample) so the same handful of extreme dynasty teams don't end
    // up as the championship opponent every time.
    const CANDIDATE_POOL_SIZE = 12;
    const remaining = shuffle(PLAYOFF_OPPS.filter((o) => !usedOpp.has(o)));
    const sample = remaining.slice(0, Math.min(CANDIDATE_POOL_SIZE, remaining.length)).sort((x, y) => x.po - y.po);
    const field = rounds.map((_, i) => {
      const lo = Math.floor((i / rounds.length) * sample.length);
      const hi = Math.floor(((i + 1) / rounds.length) * sample.length);
      const band = sample.slice(lo, Math.max(hi, lo + 1));
      return band[Math.floor(Math.random() * band.length)];
    });
    outcome = null;
    for (let i = 0; i < rounds.length; i++) {
      const g = tagOpp(gameResult(score, field[i].po), field[i]);
      g.label = rounds[i];
      g.playoff = true;
      g.plays = buildTimeline(g.us, g.them, g.win);
      games.push(g);
      if (g.win) w++;
      else { l++; outcome = `Lost to the ${g.opp} in the ${rounds[i].toLowerCase()} round`; break; }
    }
    if (!outcome) outcome = w === 20 ? "Perfect season. 20–0." : `Won the championship after a ${w - rounds.length}–${l} regular season`;
  }
  const playoffs = games.some((g) => g.playoff);
  const champ = playoffs && games[games.length - 1].label === "Championship" && games[games.length - 1].win;
  return { games, w, l, outcome, playoffs, champ, perfect: w === 20 && l === 0 };
}

// streak = consecutive calendar days with a finished daily. Shared with the server (submit-run
// applies this same bookkeeping when persisting a daily run) and the client (the profile view
// uses it read-only, to know whether a locally-cached streak has gone stale).
export function nextStreak(stats, date) {
  const prev = stats.dailyLast;
  if (prev === date) return stats.dailyStreak || 1;
  const y = new Date(date + "T00:00:00"); y.setDate(y.getDate() - 1);
  const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  return prev === yk ? (stats.dailyStreak || 0) + 1 : 1;
}

// ---------- Profile merge ----------
// A reset draft is a DNF: it counts as a draft but has no record or score. No roster to replay
// here, so submit-run applies this directly (a fabricated DNF count only makes an account's own
// stats look worse, not a leaderboard-integrity issue) - but it's still the server, not the
// client, that owns the profiles row from here on, so it goes through the same shared function.
// `mode` tags which ladder the penalty lands on - without it a DNF couldn't be attributed, since
// an abandoned draft has no run to read a mode off.
export function applyDnf(prev, picks, mode = "unlimited") {
  const ladder = LADDERS.includes(mode) ? mode : "unlimited";
  const s = {
    ...prev,
    dnf: (prev.dnf || 0) + 1,
    recent: [{ dnf: true, picks, mode: ladder, points: DNF_POINTS, date: Date.now() }, ...(prev.recent || [])].slice(0, 10),
    updated: Date.now(),
  };
  // A DNF hits the ladder directly rather than going through the best-of-the-day window: it isn't
  // a performance, so it shouldn't be something a good draft later in the day can displace.
  s.points = { ...(prev.points || {}), [ladder]: (prev.points?.[ladder] || 0) + DNF_POINTS };
  s.pointsBank = (prev.pointsBank || 0) + DNF_POINTS;
  return s;
}
const betterRecord = (a, b) => !b || a.w > b.w || (a.w === b.w && a.l < b.l);
// Which profile fields hold each format's best score. Scores from the two formats aren't
// comparable, so they rank separately; everything else about a run is. Adding a third format is
// one entry here plus its two columns.
export const BEST_FIELDS = {
  fantasy: { score: "bestScore", run: "bestRun" },
  standard: { score: "bestScoreStd", run: "bestRunStd" },
};
// `day` is the calendar date this run is being counted against, supplied by the caller. The server
// passes its own UTC date rather than anything from the client, so the best-of-the-day window can't
// be widened by claiming a different date.
export function applyRun(prev, run, day) {
  const s = {
    ...prev,
    runs: prev.runs + 1, wins: prev.wins + run.w, losses: prev.losses + run.l,
    champs: prev.champs + (run.champ ? 1 : 0), perfect: prev.perfect + (run.perfect ? 1 : 0),
    playoffs: prev.playoffs + (run.playoffs ? 1 : 0),
    recent: [run, ...(prev.recent || [])].slice(0, 10), updated: Date.now(),
  };

  const ladder = modeKey(run);
  const points = Number(run.points) || 0;
  // The bank is every point ever earned, uncapped - it's the shop currency, and rate-limiting what
  // you can spend isn't the point. Only the competitive ladders use the best-of-the-day window.
  s.pointsBank = (prev.pointsBank || 0) + points;
  if (ladder === "daily") {
    // Already one a day by construction, so no window needed.
    s.points = { ...(prev.points || {}), daily: (prev.points?.daily || 0) + points };
  } else {
    const { day: nextDay, delta } = applyDayPoints(prev.pointsDay, ladder, points, day);
    s.pointsDay = nextDay;
    s.points = { ...(prev.points || {}), [ladder]: (prev.points?.[ladder] || 0) + delta };
  }
  // Career counters above stay merged across formats - they count seasons played, not points
  // scored, and both formats run the identical simulation. Only the score-ranked bests split.
  const f = BEST_FIELDS[normFormat(run.format)];
  if (prev[f.score] == null || run.score > prev[f.score]) { s[f.score] = run.score; s[f.run] = run; }
  if (betterRecord(run, prev.bestRecord)) s.bestRecord = { w: run.w, l: run.l };
  return s;
}

// ---------- Runs log ----------
// The `runs` table row for one entry of profiles.recent - a finished run or a DNF, in exactly the
// shape applyRun/applyDnf put there. submit-run and the test mock both write through this, and
// supabase/migration-runs-log.sql's backfill maps old recent entries the same way, so a run logged
// live and the same run recovered by the backfill are the same row (and collide on the unique
// (user_id, created_at, dnf) key instead of duplicating).
export function runLogRow(userId, username, entry, dailyDate = null) {
  const dnf = !!entry.dnf;
  const base = {
    user_id: userId, username,
    created_at: new Date(entry.date || Date.now()).toISOString(),
    gm: !!entry.gm, genius: !!entry.genius, dnf,
  };
  if (dnf) {
    return { ...base, ladder: LADDERS.includes(entry.mode) ? entry.mode : "unlimited", format: null, picks: Number(entry.picks) || 0 };
  }
  return {
    ...base,
    ladder: modeKey(entry), daily_date: entry.mode === "daily" ? dailyDate : null, format: normFormat(entry.format),
    w: entry.w, l: entry.l, score: entry.score, champ: !!entry.champ, perfect: !!entry.perfect, playoffs: !!entry.playoffs,
    outcome: entry.outcome ?? null, par: entry.par ?? null, points: entry.points ?? null, cap_used: entry.capUsed ?? null,
    code: entry.code ?? null, roster: entry.roster ?? null,
  };
}
