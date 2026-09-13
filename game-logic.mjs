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

// ---------- Data load ----------
// Populated by initGameData(); exported as `let` bindings so every importer sees the live values
// once initialized (standard ES module live-binding - works the same in an esbuild bundle and in
// Deno). Mirrors what used to be inline module-scope computation in perfect-season.jsx.
export let BOARDS = {};
export let OPPS = [];
export let PLAYOFF_OPPS = [];
let flexStatsByEra = [];

export function initGameData(players, opponents) {
  const boards = {};
  for (const [key, arr] of Object.entries(players.b)) {
    const [team, w] = key.split("|");
    boards[key] = arr.map((e) => ({
      id: e[0], name: players.n[e[0]], pos: POS[e[1]], season: e[2], g: e[3],
      cmp: e[4], att: e[5], py: e[6], ptd: e[7], int: e[8],
      car: e[9], ry: e[10], rtd: e[11], rec: e[12], rcy: e[13], rctd: e[14],
      fl: e[15], ppr: e[16], rating: e[17], team, w: Number(w),
    })).sort((x, y) => {
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
  flexStatsByEra = WINDOWS.map((_, w) => {
    const pool = [];
    for (const key of Object.keys(BOARDS)) {
      if (Number(key.split("|")[1]) !== w) continue;
      for (const p of BOARDS[key]) if (FLEX_POS.includes(p.pos)) pool.push(p);
    }
    const pprMean = mean(pool.map((p) => p.ppr));
    const ratingMean = mean(pool.map((p) => p.rating));
    return {
      pprMean, pprStd: std(pool.map((p) => p.ppr), pprMean),
      ratingMean, ratingStd: std(pool.map((p) => p.rating), ratingMean),
    };
  });
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

export function boardHasOption(key, drafted, open) {
  const b = BOARDS[key];
  return !!b && b.some((p) => !drafted.has(p.id) && open.some((s) => fits(p.pos, s)));
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

export function boardAt(list, from, r) {
  const d = new Set(Object.values(r).map((p) => p.id));
  const o = SLOTS.filter((s) => !r[s]);
  for (let i = from; i < list.length; i++) if (boardHasOption(list[i], d, o)) return i;
  return -1;
}

// Mirrors reroll()'s pool selection exactly (same RNG derivation, same match() filter) - shared
// so the client's live reroll and the server's replay/legality check can never drift apart.
// Returns the picked board key, or null if no candidate exists (same as a no-op reroll).
export function rerollCandidate({ seed, kind, seqIdx, spinTeam, spinW, shown, drafted, open }) {
  const match = (key) => {
    const [t, w] = key.split("|");
    return !shown.has(key) && (kind === "team" ? Number(w) === spinW : t === spinTeam) && boardHasOption(key, drafted, open);
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
export function replayDraft(seed, history, seq) {
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

  for (let si = 0; si < seq.length; si++) {
    if (SLOTS.every((s) => roster[s])) break; // roster already complete - nothing left to validate
    const key = seq[si];
    const open = SLOTS.filter((s) => !roster[s]);

    if (key === base[basePtr]) {
      basePtr++;
    } else {
      if (prevKey == null) return fail("a reroll can't happen before any board was shown");
      const [prevTeam, prevW] = prevKey.split("|");
      const [team, w] = key.split("|");
      let kind;
      if (Number(w) === Number(prevW) && team !== prevTeam) kind = "team";
      else if (team === prevTeam && Number(w) !== Number(prevW)) kind = "years";
      else return fail("reroll insertion doesn't share a team or era with the board it replaced");
      if (rerollsUsed[kind] >= 1) return fail(`more than one ${kind} reroll used`);
      const expected = rerollCandidate({ seed, kind, seqIdx: si - 1, spinTeam: prevTeam, spinW: Number(prevW), shown, drafted, open });
      if (expected !== key) return fail("reroll result doesn't match what this seed would produce");
      rerollsUsed[kind]++;
      shown.add(key);
    }

    if (!boardHasOption(key, drafted, open)) { prevKey = key; continue; } // client would have skipped this board too

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
export function flexRating(p) {
  const s = flexStatsByEra[p.w];
  return s.ratingMean + ((p.ppr - s.pprMean) / s.pprStd) * s.ratingStd;
}
// The rating a player should count as in team-score math for the slot they're in: their normal
// positional grade for a named slot, or their stats-only flexRating for a Flex spot.
export function effectiveRating(slot, p) {
  return slot.startsWith("FLEX") ? flexRating(p) : p.rating;
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
export function buildTimeline(us, them, win) {
  const plays = [
    ...scoringPlays(us).map((v) => ({ team: "us", v })),
    ...scoringPlays(them).map((v) => ({ team: "them", v })),
  ].sort(() => Math.random() - 0.5);
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
export function applyDnf(prev, picks) {
  return { ...prev, dnf: (prev.dnf || 0) + 1, recent: [{ dnf: true, picks, date: Date.now() }, ...(prev.recent || [])].slice(0, 10), updated: Date.now() };
}
const betterRecord = (a, b) => !b || a.w > b.w || (a.w === b.w && a.l < b.l);
export function applyRun(prev, run) {
  const s = {
    ...prev,
    runs: prev.runs + 1, wins: prev.wins + run.w, losses: prev.losses + run.l,
    champs: prev.champs + (run.champ ? 1 : 0), perfect: prev.perfect + (run.perfect ? 1 : 0),
    playoffs: prev.playoffs + (run.playoffs ? 1 : 0),
    recent: [run, ...(prev.recent || [])].slice(0, 10), updated: Date.now(),
  };
  if (prev.bestScore == null || run.score > prev.bestScore) { s.bestScore = run.score; s.bestRun = run; }
  if (betterRecord(run, prev.bestRecord)) s.bestRecord = { w: run.w, l: run.l };
  return s;
}
