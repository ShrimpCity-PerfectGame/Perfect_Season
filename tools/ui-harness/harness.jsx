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
//   team=SF | none                                 a different favorite team, or none
//
// Coins and the shop (SHOP.md):
//   screen=cosmetics[&team=KC]                     every frame (24, 40 and 84px, on cream, navy and black), card
//                                                  theme (a sample player card), title and avatar pack; team=all
//                                                  adds the Team colors frame and card for all 32 teams
//   screen=shop&coins=N[&team=KC]                  ShopScreen on the mock, signed in with N coins (default 4,210), a
//                                                  few items owned, a badge item owned through its badge, and a
//                                                  badge earned but not yet paid (its item says it unlocks next season)
//   screen=picker[&owned=sideline,night-game][&current=trophy]   the avatar picker on its own, on Choose an avatar,
//                                                  owning the listed packs (default: sideline)
import { useState } from "react";
import { createRoot } from "react-dom/client";
import PerfectSeason, { APP_CSS } from "../../perfect-season.jsx";
import { ProfileScreen } from "../../profile.jsx";
import { ShopScreen } from "../../shop.jsx";
import { AvatarPicker } from "../../avatar-picker.jsx";
import { FramedAvatar, CardTheme, TitleLine, Coins, Coin, ItemPreview, cardLook } from "../../cosmetics.jsx";
import { Avatar } from "../../avatars.jsx";
import { SHOP_ITEMS, AVATAR_PACKS, packItem } from "../../shop-catalog.mjs";
import { makeMockAuth } from "../../tests/mock-supabase.mjs";
import { veteranProfile, rookieProfile, photoProfile, VETERAN_ROW } from "../../tests/fixtures/profile-fixture.mjs";
import { FREE_AVATAR_PRESETS, TEAM_CODES } from "../../profile-rules.mjs";
import { BOARDS, SLOTS, TEAMS, fits, runLogRow } from "../../game-logic.mjs";

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
    // What the card wears (SHOP.md 7.3): frame=, card= and title= take shop item ids, e.g. card=card-ticket.
    const worn = Object.fromEntries([["frame", "frame"], ["cardTheme", "card"], ["title", "title"]]
      .map(([key, param]) => [key, params.get(param)]).filter(([, id]) => id));
    // team=SF (or team=none) swaps the fixture's favorite team, e.g. to see a long team name beside a long username.
    if (params.has("team")) worn.favoriteTeam = TEAMS[params.get("team")] ? params.get("team") : null;
    // The fixture's streak is dated; move it to today so the card shows it whenever this is opened.
    return { ...p, username: params.get("name") || p.username, stats: { ...p.stats, dailyLast: today }, details: { ...(p.details || {}), ...worn } };
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
          onLogOut={() => console.log("log out")} onPlay={() => console.log("play")} onOpenReports={() => console.log("reports")}
          wallet={owner ? { balance: Math.max(0, Number(params.get("coins") ?? 4210) || 0) } : null} onOpenShop={owner ? () => console.log("shop") : undefined} />
      </div>
    </div>
  );
}

// ---------- screen=cosmetics: every frame, card theme, title and pack ----------
// The sample cards use profile.jsx's card classes, the way the profile wears a card theme (SHOP.md 7.3). CardTheme's
// paint has to win over whatever .pf-card still paints, so nothing here takes that paint off; the samples only
// drop .pf-card's position:relative on its children, to show a theme's texture stays under the content without it.
const HARNESS_CSS = `
.hx-sec{margin:0 0 30px}
.hx-sec>.h{margin-bottom:12px}
.hx-sub{margin:-6px 0 12px;font-size:14px;color:var(--muted)}
.hx-frames{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px 14px}
.hx-frame{display:grid;gap:8px;justify-items:start}
.hx-name{margin:0;font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ink)}
.hx-strip{display:grid;gap:10px;padding:14px;margin:0 0 14px;border-radius:14px}
.hx-card.pf-card>*{position:static}
.hx-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr));gap:22px 20px}
.hx-line{margin:0;font-size:14px;color:var(--muted)}
.hx-titles{display:flex;flex-wrap:wrap;gap:12px}
.hx-packs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:16px}
.hx-pack{display:grid;gap:10px;padding:12px 14px;border-radius:14px;background:var(--surface);box-shadow:inset 0 0 0 2px var(--line)}
.hx-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.hx-teams{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,250px),1fr));gap:14px}
.hx-mini{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:14px}
.hx-mini .hx-name{font-size:12px}
`;

const FRAMES = SHOP_ITEMS.filter((i) => i.kind === "frame");
const CARDS = SHOP_ITEMS.filter((i) => i.kind === "card");
const TITLES = SHOP_ITEMS.filter((i) => i.kind === "title");
const CARD_TITLE = { "card-navy": null, "card-night": "title-film-room", "card-turf": "title-waiver-hawk", "card-team": "title-draft-guru",
  "card-ticket": "title-cap-wizard", "card-gold-foil": "title-daily-winner", "card-dynasty": "title-undefeated" };

function SampleCard({ theme, team, name = "shrimpcity", preset = "trophy", frame = null }) {
  const title = CARD_TITLE[theme];
  return (
    <CardTheme theme={theme} team={team} className="pf-card hx-card">
      <div className={`pf-head${name.length > 11 ? " pf-long" : ""}`}>
        <FramedAvatar className="pf-ring" frame={frame} team={team} username={name} preset={preset} size={84} decorative />
        <div className="pf-id">
          <h2 className="pf-name">{name}</h2>
          <TitleLine title={title} />
          {team && <p className="pf-team"><span className="pf-swatch" style={{ "--tc1": TEAMS[team][2], "--tc2": TEAMS[team][3] }} />{[TEAMS[team][1], TEAMS[team][0]].filter(Boolean).join(" ")}</p>}
        </div>
      </div>
      <p className="pf-bio">{SHOP_ITEMS.find((i) => i.id === theme).name} card theme. Takes a running back in round one and regrets nothing.</p>
      <p className="hx-line">A muted line, the way the card's labels read.</p>
      <dl className="pf-facts">
        <div><dt>Drafting since</dt><dd>Sep 2026</dd></div>
        <div><dt>Daily streak</dt><dd><span aria-hidden="true">🔥 </span>6</dd></div>
      </dl>
      <div className="pf-actions">
        <button className="btn">Edit profile</button>
        <button className="btn solid">Share profile</button>
        <Coins amount={4210} />
      </div>
    </CardTheme>
  );
}

function CosmeticsPreview() {
  const teamParam = params.get("team");
  const all = teamParam === "all";
  const team = !all && TEAMS[teamParam] ? teamParam : all ? "KC" : null;
  const strips = [["cream", ""], ["navy", "cs-dark"], ["black", "cs-night"]];
  return (
    <div className="ps">
      <style>{APP_CSS + HARNESS_CSS}</style>
      <div className="wrap">
        <div className="hx-sec">
          <h1 className="title">Cosmetics</h1>
          <p className="sub">{team ? `Favorite team: ${TEAMS[team][0]}.` : "No favorite team, so Team colors falls back to Ink and Navy."}</p>
        </div>

        <section className="hx-sec" aria-label="Frames">
          <h2 className="h">Frames</h2>
          {strips.map(([label, scope]) => (
            <div key={label} className={`hx-strip ${scope}`} style={{ background: "var(--bg)" }}>
              <p className="hx-sub" style={{ margin: 0 }}>On {label}</p>
              <div className="hx-frames">
                {FRAMES.map((f) => (
                  <div className="hx-frame" key={f.id}>
                    <p className="hx-name">{f.name}</p>
                    <div className="hx-row">
                      {[24, 40, 84].map((size) => (
                        <FramedAvatar key={size} frame={f.id} team={team} size={size} username="shrimpcity" preset={size === 40 ? "helmet" : "trophy"} decorative />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="hx-strip" style={{ background: "var(--bg)" }}>
            <p className="hx-sub" style={{ margin: 0 }}>In the header, beside a name, with a photo and with an initial</p>
            <div className="hx-row">
              {FRAMES.map((f) => (
                <span key={f.id} className="whoami"><FramedAvatar frame={f.id} team={team} size={24} username="shrimpcity" preset="helmet" decorative /><span className="whoname">shrimpcity</span></span>
              ))}
              {FRAMES.map((f) => <FramedAvatar key={`p-${f.id}`} frame={f.id} team={team} size={40} username="zed" photoUrl={PHOTO} decorative />)}
              {FRAMES.map((f) => <FramedAvatar key={`i-${f.id}`} frame={f.id} team={team} size={40} username="zed" decorative />)}
            </div>
          </div>
        </section>

        <section className="hx-sec" aria-label="Card themes">
          <h2 className="h">Card themes</h2>
          <div className="hx-cards">
            {CARDS.map((c, i) => <SampleCard key={c.id} theme={c.id} team={team} frame={FRAMES[i % FRAMES.length].id} />)}
            <SampleCard theme="card-gold-foil" team={team} name="Mississippi_Kid1" preset={null} frame="frame-gold" />
          </div>
        </section>

        <section className="hx-sec" aria-label="Titles">
          <h2 className="h">Titles</h2>
          {strips.map(([label, scope]) => (
            <div key={label} className={`hx-strip ${scope}`} style={{ background: "var(--bg)" }}>
              <div className="hx-titles">{TITLES.map((t) => <TitleLine key={t.id} title={t.id} />)}</div>
            </div>
          ))}
        </section>

        <section className="hx-sec" aria-label="Avatar packs">
          <h2 className="h">Avatar packs</h2>
          <div className="hx-packs">
            {AVATAR_PACKS.map((p) => (
              <div className="hx-pack" key={p.pack}>
                <p className="hx-name">{p.name}</p>
                {[96, 56, 24].map((size) => (
                  <div className="hx-row" key={size}>
                    {p.presets.map((a) => <Avatar key={a.key} username={a.name} preset={a.key} size={size} />)}
                  </div>
                ))}
                <div className="hx-row cs-dark" style={{ background: "var(--bg)", padding: 8, borderRadius: 10 }}>
                  {p.presets.map((a) => <Avatar key={a.key} username={a.name} preset={a.key} size={40} />)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="hx-sec" aria-label="Shop thumbnails">
          <h2 className="h">Shop thumbnails and coins</h2>
          <div className="hx-row">
            {SHOP_ITEMS.map((i) => <ItemPreview key={i.id} id={i.id} team={team} username="shrimpcity" preset="trophy" />)}
          </div>
          <div className="hx-row" style={{ marginTop: 14 }}>
            {[14, 16, 20, 28].map((size) => <Coins key={size} amount={1240} size={size} />)}
            <span className="hx-strip cs-dark" style={{ background: "var(--bg)", margin: 0 }}><Coins amount={15000} size={18} /></span>
            <Coin size={64} />
          </div>
        </section>

        {all && (
          <section className="hx-sec" aria-label="Every team">
            <h2 className="h">Team colors, every team</h2>
            <div className="hx-teams">
              {Object.keys(TEAMS).map((code) => (
                <CardTheme key={code} theme="card-team" team={code} className="hx-mini">
                  <FramedAvatar frame="frame-team" team={code} size={40} username={code} preset="helmet" decorative />
                  <div>
                    <p className="hx-name">{TEAMS[code][0]}</p>
                    <TitleLine title="title-cap-wizard" />
                    <p className="hx-line">{cardLook("card-team", code)} · muted text</p>
                  </div>
                </CardTheme>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ---------- screen=shop: ShopScreen on the mock ----------
function ShopPreview({ userId, username }) {
  const [balance, setBalance] = useState(null);
  return (
    <div className="ps">
      <style>{APP_CSS}</style>
      <div className="wrap">
        <ShopScreen userId={userId} username={username} onBack={() => console.log("back")}
          onDetailsSaved={(details) => console.log("details saved", details)} onBalance={setBalance} />
        {balance != null && <p className="note" data-harness-balance={balance}>onBalance: {balance}</p>}
      </div>
    </div>
  );
}

async function setUpShop() {
  const username = params.get("name") || "shrimpcity";
  const { data } = await mock.auth.signUp({ email: `${username}@harness.test`, password: "harness-only", options: { data: { username } } });
  const uid = data.user.id;
  // A veteran's career, so badges are earned: Undefeated is paid (its frame and title are owned), and Dynasty is
  // earned but not paid yet, so its card theme says it unlocks after the next finished season.
  Object.assign(mock._profiles.get(uid), profileFor(uid, username, 0), { champs: 12, perfect: 2, daily_streak: 6, daily_best_streak: 9 });
  const team = TEAMS[params.get("team")] ? params.get("team") : "KC";
  mock._profileDetails.set(uid, { user_id: uid, bio: BIOS[0], avatar_path: null, avatar_preset: "helmet", favorite_team: team,
    frame: "frame-lime", card_theme: "card-turf", title: "title-film-room", showcase: [], updated_at: new Date().toISOString() });
  const w = mock._wallet;
  w.apply(uid, 5000, "season", "HARNESS-SETUP"); // enough for the purchases below; the balance is set exactly at the end
  w.apply(uid, 186, "season", "HARNESS1");
  w.apply(uid, 94, "daily", `${today}:fantasy`);
  mock._badgeAwards.set(`${uid}|undefeated`, { user_id: uid, badge: "undefeated", awarded_at: new Date().toISOString() });
  w.apply(uid, 1000, "badge", "undefeated");
  w.apply(uid, 15, "minigame", `over_under:${today}`);
  for (const item of ["frame-lime", "card-turf", "title-film-room", packItem("sideline")]) {
    const price = mock._shopItems.get(item).price;
    mock._inventory.set(`${uid}|${item}`, { user_id: uid, item_id: item, acquired_at: new Date().toISOString() });
    w.apply(uid, -price, "purchase", item);
  }
  // Then exactly the balance asked for.
  const want = Math.max(0, Math.floor(Number(params.get("coins") ?? 4210)) || 0);
  const diff = want - w.balanceOf(uid);
  if (diff > 0) w.apply(uid, diff, "season", "HARNESS");
  if (diff < 0) w.apply(uid, diff, "purchase", "HARNESS");
  return { uid, username };
}

// ---------- screen=picker: the avatar picker with some packs owned ----------
function PickerPreview() {
  const owned = (params.get("owned") ?? "sideline").split(",").filter(Boolean);
  const [preset, setPreset] = useState(params.get("current") || "trophy");
  return (
    <div className="ps">
      <style>{APP_CSS}</style>
      <div className="wrap">
        <div className="panel pf-editor">
          <div className="pf-field">
            <span className="pf-label">Picture</span>
            <AvatarPicker username="shrimpcity" current={{ photoUrl: null, preset }} busy={false} error="" ownedPacks={owned}
              onPhoto={async () => {}} onPreset={async (key) => setPreset(key)} onRemove={async () => setPreset(null)} onCancel={() => console.log("cancel")} />
          </div>
        </div>
      </div>
    </div>
  );
}

(async () => {
  if (params.get("screen") === "picker") {
    createRoot(document.getElementById("root")).render(<PickerPreview />);
    return;
  }
  if (params.get("screen") === "cosmetics") {
    createRoot(document.getElementById("root")).render(<CosmeticsPreview />);
    return;
  }
  if (params.get("screen") === "shop") {
    const { uid, username } = await setUpShop();
    createRoot(document.getElementById("root")).render(<ShopPreview userId={uid} username={username} />);
    return;
  }
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
