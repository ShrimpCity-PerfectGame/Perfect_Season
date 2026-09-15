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
//
// The profile screen on its own, with tests/fixtures/profile-fixture.mjs data:
//   screen=profile&fixture=veteran (default) | rookie | photo
//   owner=1                                        your own profile (Edit profile, Log out); saves go to the mock
//   as=guest                                       a visitor who isn't signed in (default: a signed-in visitor)
//   status=loading | missing | error               the other states
//   moderator=N                                    an owner who is a moderator, with N open reports
//   name=Mississippi_Kid1                          a different username, e.g. to check a long one fits
import { useState } from "react";
import { createRoot } from "react-dom/client";
import PerfectSeason, { APP_CSS } from "../../perfect-season.jsx";
import { ProfileScreen } from "../../profile.jsx";
import { makeMockAuth } from "../../tests/mock-supabase.mjs";
import { veteranProfile, rookieProfile, photoProfile, VETERAN_ROW } from "../../tests/fixtures/profile-fixture.mjs";
import { FREE_AVATAR_PRESETS, TEAM_CODES } from "../../profile-rules.mjs";
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

// Profile details for most of the seeded players: bios (one right at the 160-character limit, one long
// unbroken word), default avatars, favorite teams, and uploaded photos. A photo is a data URL standing in
// for the stored file - the mock's getPublicUrl returns an object's publicUrl when it has one.
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#6FA8DC'/><stop offset='.62' stop-color='#CFE3F2'/><stop offset='.62' stop-color='#3E7D3A'/><stop offset='1' stop-color='#2C5E2A'/></linearGradient></defs><rect width='256' height='256' fill='url(#g)'/><circle cx='128' cy='104' r='42' fill='#8A5A3C'/><path d='M52 256c6-62 38-96 76-96s70 34 76 96z' fill='#B32F25'/><text x='128' y='236' font-family='Arial' font-weight='700' font-size='40' text-anchor='middle' fill='#fff'>12</text></svg>",
)}`;
const BIOS = [
  "Takes a running back in round one and regrets nothing.",
  "Daily grinder. 🏈🔥",
  "",
  "Tight ends win titles. That's the whole strategy, and it has worked exactly twice, which is twice more than the running back guys. Sticking with them forever. 🏈",
  "Supercalifragilisticexpialidociousfootballdrafterextraordinaireandthensome",
  "Chasing 20–0 since day one.",
];
NAMES.forEach((username, i) => {
  if (i % 4 === 3) return; // a few players have never saved anything
  const id = `seed-${i}`;
  const photo = i % 5 === 1;
  const path = photo ? `${id}/1757800000${String(i).padStart(3, "0")}.webp` : null;
  mock._profileDetails.set(id, {
    user_id: id, bio: BIOS[i % BIOS.length], avatar_path: path, avatar_preset: photo ? null : FREE_AVATAR_PRESETS[i % FREE_AVATAR_PRESETS.length].key,
    favorite_team: i % 6 === 2 ? null : TEAM_CODES[(i * 7) % TEAM_CODES.length], updated_at: new Date(clock).toISOString(),
  });
  if (photo) mock._storageObjects.set(`avatars/${path}`, { bucket: "avatars", path, contentType: "image/webp", size: 2048, owner: id, publicUrl: PHOTO });
});

async function signIn(username) {
  const { data } = await mock.auth.signUp({ email: `${username}@harness.test`, password: "harness-only", options: { data: { username } } });
  if (username === "admin") return; // a fresh account, so forced outcomes start from a clean profile
  Object.assign(mock._profiles.get(data.user.id), profileFor(data.user.id, username, 0), { daily_streak: 6, daily_best_streak: 6 });
  mock._profileDetails.set(data.user.id, { user_id: data.user.id, bio: BIOS[0], avatar_path: null, avatar_preset: "helmet", favorite_team: "KC", updated_at: new Date().toISOString() });
}

// ---------- screen=profile: the profile screen on its own ----------
// Uploads get a real address to show: the mock stores the object, and the harness hands the image back
// as a blob URL instead of the mock's placeholder address.
const baseStorageFrom = mock.storage.from.bind(mock.storage);
mock.storage.from = (bucket) => {
  const api = baseStorageFrom(bucket);
  return {
    ...api,
    async upload(path, body, opts) {
      const res = await api.upload(path, body, opts);
      const o = mock._storageObjects.get(`${bucket}/${path}`);
      if (!res.error && o && body instanceof Blob) o.publicUrl = URL.createObjectURL(body);
      return res;
    },
  };
};

function ProfilePreview({ userId, owner }) {
  const fixtures = { veteran: veteranProfile, rookie: rookieProfile, photo: photoProfile };
  const [profile, setProfile] = useState(() => {
    const p = (fixtures[params.get("fixture")] || veteranProfile)();
    // The fixture's streak is dated; move it to today so the card shows it whenever this is opened.
    return { ...p, username: params.get("name") || p.username, stats: { ...p.stats, dailyLast: today } };
  });
  const moderator = owner && params.get("moderator") != null ? { openReports: Number(params.get("moderator")) || 0 } : null;
  const hasScores = profile.stats.bestScore != null;
  return (
    <div className="ps">
      <style>{APP_CSS}</style>
      <div className="wrap">
        <ProfileScreen status={params.get("status") || "ok"} profile={profile} isOwner={owner} userId={userId}
          rank={hasScores ? { fantasy: 3, standard: 1 } : { fantasy: null, standard: null }} moderator={moderator}
          onRetry={() => console.log("retry")} onShare={async () => "copied"}
          onDetailsSaved={(details) => setProfile((p) => ({ ...p, details }))}
          onLogOut={() => console.log("log out")} onPlay={() => console.log("play")} onOpenReports={() => console.log("reports")} />
      </div>
    </div>
  );
}

(async () => {
  if (params.get("screen") === "profile") {
    const owner = params.get("owner") === "1";
    let userId = null;
    if (owner || who !== "guest") {
      // The fixture player is in the mock too, so a visitor's report has someone to report.
      mock._profiles.set(VETERAN_ROW.id, { ...VETERAN_ROW });
      const name = owner ? "harness_owner" : "harness_visitor";
      const { data } = await mock.auth.signUp({ email: `${name}@harness.test`, password: "harness-only", options: { data: { username: name } } });
      userId = data.user.id;
    }
    createRoot(document.getElementById("root")).render(<ProfilePreview userId={userId} owner={owner} />);
    return;
  }
  if (who === "player") await signIn("shrimpcity");
  else if (who === "admin") await signIn("admin");
  else if (who === "newbie") await mock.auth.signUp({ email: "newbie@harness.test", password: "harness-only", options: { data: { username: "newbie" } } });
  createRoot(document.getElementById("root")).render(<PerfectSeason />);
})();
