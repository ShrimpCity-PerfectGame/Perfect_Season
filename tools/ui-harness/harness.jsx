// UI harness: the real app running on the in-memory Supabase mock from the test suite, seeded with
// realistic data plus deliberate edge cases (16-character usernames, six-figure point totals, full
// leaderboards), so every screen can be checked in a real browser without touching staging or
// production and without signing in to anything.
//
//   node tools/ui-harness/build.mjs          then open tools/ui-harness/harness.html
//
// Query parameters:
//   as=player (default) | admin | guest | newbie   who is signed in ("admin" unlocks AdminPanel)
//   howto=1                                        show the How to play overlay on load
import { createRoot } from "react-dom/client";
import PerfectSeason from "../../perfect-season.jsx";
import { makeMockAuth } from "../../tests/mock-supabase.mjs";
import { BOARDS, SLOTS, fits, runLogRow } from "../../game-logic.mjs";

const params = new URLSearchParams(location.search);
const who = params.get("as") || "player";

// Same shape as entry.jsx's storage shim, kept in memory so every load starts clean.
function memoryStorage() {
  const data = {};
  const k = (shared, key) => `${shared ? "shared" : "personal"}:${key}`;
  return {
    async get(key, shared) { return Object.prototype.hasOwnProperty.call(data, k(shared, key)) ? { value: data[k(shared, key)] } : null; },
    async set(key, value, shared) { data[k(shared, key)] = value; return true; },
    async delete(key, shared) { delete data[k(shared, key)]; },
    async list(prefix, shared) {
      const p = k(shared, prefix);
      return { keys: Object.keys(data).filter((x) => x.startsWith(p)).map((x) => x.slice(shared ? 7 : 9)) };
    },
  };
}

// Deterministic pseudo-random numbers, so every load (and every agent) sees the same data.
let seed = 20260914;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rand() * a.length)];
const allPlayers = Object.values(BOARDS).flat();
function roster(format = "fantasy") {
  const used = new Set();
  return SLOTS.map((slot) => {
    let p;
    do { p = pick(allPlayers); } while (used.has(p.id) || !fits(p.pos, slot));
    used.add(p.id);
    const rating = format === "standard" ? p.stdRating : p.rating;
    return { slot, name: p.name, team: p.team, season: p.season, ppr: p.ppr, rating: Math.round(rating * 10) / 10 };
  });
}
const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = dateKey(new Date());

const mock = makeMockAuth();
window.__ps_supabase__ = mock;
window.storage = memoryStorage();
if (params.get("howto") !== "1") window.storage.set("ps-howto-seen", "true", false);

// 24 other players, including the longest username allowed and very large numbers.
const NAMES = ["abcdefghijklmnop", "bigplayben", "flexgod", "gronkspike", "dailydan", "Mississippi_Kid1", "sb_or_bust", "tdmachine",
  "joe", "PuntReturnKing", "hailmary_hank", "wildcardwendy", "redzone", "nopuntintended", "TwoMinuteDrill", "fourthand1",
  "blitzburgh", "pick6pete", "the_audible", "QBsneak_", "fairly_average", "zebra_stripes", "overtimeOllie", "xyz"];
let clock = Date.now() - 40 * 86400000;
const profileFor = (id, username, i) => {
  const runs = Math.round(5 + rand() * (i === 0 ? 12345 : 400));
  const wins = Math.round(runs * (6 + rand() * 9));
  const losses = runs * 17 - wins + Math.round(runs * rand() * 2);
  const bestRun = { w: 20 - Math.min(5, i % 6), l: Math.min(5, i % 6), score: 118 - i * 2.7, format: "fantasy", roster: roster() };
  const stdRun = { w: 16 - (i % 4), l: 1 + (i % 4), score: 104 - i * 2.1, format: "standard", roster: roster("standard") };
  const recent = Array.from({ length: 10 }, (_, n) => ({
    w: 6 + ((i + n) % 11), l: 11 - ((i + n) % 11), score: 60 + ((i * 7 + n * 13) % 45), format: n % 3 ? "fantasy" : "standard",
    mode: n % 4 ? "free" : "daily", gm: n % 5 === 0, genius: n % 7 === 0, champ: (i + n) % 6 === 0, playoffs: (i + n) % 2 === 0,
    outcome: (i + n) % 6 === 0 ? "Won the championship after a 12–5 regular season" : "Missed the playoffs",
    points: Math.round(-120 + rand() * 260), par: 80, date: (clock += 3600000), roster: roster(),
  }));
  return {
    id, username, runs, dnf: Math.round(rand() * 30), wins, losses, champs: Math.round(runs * rand() * 0.2), perfect: i % 5 === 0 ? i + 1 : 0,
    playoffs: Math.round(runs * 0.45), best_score: bestRun.score, best_run: bestRun, best_score_std: stdRun.score, best_run_std: stdRun,
    best_record: { w: bestRun.w, l: bestRun.l },
    points_daily: Math.round(9000 - i * 350 + rand() * 200), points_unlimited: i === 0 ? 1234567 : Math.round(80000 - i * 3100),
    points_genius: Math.round(20000 - i * 700), points_gm: Math.round(30000 - i * 1100), points_bank: i === 0 ? 2345678 : Math.round(150000 - i * 5000),
    recent, daily_streak: i % 9, daily_last: today, daily_best_streak: 31 - i,
  };
};
NAMES.forEach((username, i) => {
  const id = `seed-${i}`;
  const p = profileFor(id, username, i + 1);
  mock._profiles.set(id, p);
  for (const run of p.recent) {
    const row = runLogRow(id, username, run, run.mode === "daily" ? today : null);
    mock._runs.set(`${row.user_id}|${row.created_at}|${row.dnf}`, row);
  }
  for (const format of ["fantasy", "standard"]) {
    // Plausible playoff records (16–2 down to 10–8), so nothing on screen reads as a data bug.
    mock._dailyRuns.set(`${today}:${format}:${id}`, { date: today, format, user_id: id, username, w: 16 - (i % 7), l: 2 + (i % 7), score: 101 - i * 1.9, outcome: "Lost to the 2007 Patriots in the divisional round" });
  }
  mock._souRuns.set(`${today}:${id}`, { date: today, user_id: id, username, score: 30 - i });
  mock._builds.set(`build-${i}`, { id: `build-${i}`, username, pos: pick(["QB", "RB", "WR", "TE"]), overall: 140 - i * 3.3, filled: {} });
});

async function signIn(username) {
  const { data } = await mock.auth.signUp({ email: `${username}@harness.test`, password: "harness-only", options: { data: { username } } });
  if (username === "admin") return; // a fresh account, so forced outcomes start from a clean profile
  Object.assign(mock._profiles.get(data.user.id), profileFor(data.user.id, username, 0), { daily_streak: 6, daily_best_streak: 6 });
}

(async () => {
  if (who === "player") await signIn("shrimpcity");
  else if (who === "admin") await signIn("admin");
  else if (who === "newbie") await mock.auth.signUp({ email: "newbie@harness.test", password: "harness-only", options: { data: { username: "newbie" } } });
  createRoot(document.getElementById("root")).render(<PerfectSeason />);
})();
