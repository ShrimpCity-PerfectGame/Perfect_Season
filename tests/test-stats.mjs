// The Stats screen: one call (fetchSiteStats -> site_stats(), mirrored by the mock in helpers.mjs)
// feeds every board - career boards from profiles, most-drafted / GM scores / biggest upsets from
// the runs log. Seeds two profiles plus their runs, with numbers picked so every board has a clear,
// checkable #1. tests/test-runs-sql.mjs checks the mock against the real SQL.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";
import { runLogRow } from "../game-logic.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;

auth._profiles.set("alice-id", {
  id: "alice-id", username: "alice",
  best_score: 95.5, runs: 5, dnf: 0, wins: 15, losses: 3, champs: 2, perfect: 1, playoffs: 4, daily_best_streak: 5,
  best_run: {
    w: 15, l: 2,
    roster: [
      { slot: "QB", name: "Tom Brady", season: 2007, team: "NE", rating: 140 },
      { slot: "RB", name: "Priest Holmes", season: 2002, team: "KC", rating: 100 },
    ],
  },
  recent: [
    { dnf: false, gm: true, score: 88.3, w: 14, l: 3, roster: [
      { slot: "QB", name: "Tom Brady", season: 2007, team: "NE", rating: 120 },
      { slot: "RB", name: "Priest Holmes", season: 2002, team: "KC", rating: 95 },
    ] },
    { dnf: false, gm: false, score: 95.5, w: 15, l: 2, roster: [
      { slot: "QB", name: "Tom Brady", season: 2007, team: "NE", rating: 140 },
      { slot: "RB", name: "Priest Holmes", season: 2002, team: "KC", rating: 100 },
    ] },
  ],
});
auth._profiles.set("bob-id", {
  id: "bob-id", username: "bob",
  best_score: 80.1, runs: 4, dnf: 1, wins: 5, losses: 10, champs: 0, perfect: 0, playoffs: 1, daily_best_streak: 2,
  best_run: {
    w: 11, l: 6,
    roster: [
      { slot: "QB", name: "Drew Brees", season: 2011, team: "NO", rating: 130 },
      { slot: "RB", name: "Priest Holmes", season: 2002, team: "KC", rating: 90 },
    ],
  },
  recent: [
    { dnf: false, roster: [
      { slot: "QB", name: "Tom Brady", season: 2007, team: "NE", rating: 100 },
      { slot: "RB", name: "Priest Holmes", season: 2002, team: "KC", rating: 90 },
    ] },
    { dnf: true, picks: 2 }, // a DNF entry has no roster at all - must not break aggregation
  ],
});

// The runs log holds what the per-run boards read. Seeded the way submit-run writes it (runLogRow),
// one row per recent entry, each with its own timestamp.
let clock = Date.UTC(2026, 8, 1);
for (const [id, p] of auth._profiles) {
  for (const entry of p.recent) {
    const row = runLogRow(id, p.username, { ...entry, date: clock += 1000 });
    auth._runs.set(`${row.user_id}|${row.created_at}|${row.dnf}`, row);
  }
}

// Title-winning runs for the biggest-upset board, plus two that must never appear on the Fantasy one:
// a lower score that didn't win the title, and a Championship-format title. Rosters avoid the
// players above so the most-drafted counts are unchanged.
const upsetRoster = [{ slot: "QB", name: "Kyle Orton", season: 2009, team: "DEN", rating: 70 }];
for (const [id, username, entry] of [
  ["alice-id", "alice", { w: 13, l: 4, score: 71.2, champ: true, playoffs: true, format: "fantasy", roster: upsetRoster }],
  ["bob-id", "bob", { w: 12, l: 5, score: 64.8, champ: true, playoffs: true, format: "fantasy", mode: "daily", roster: upsetRoster }],
  ["alice-id", "alice", { w: 20, l: 0, score: 90.0, champ: true, perfect: true, playoffs: true, format: "fantasy", roster: upsetRoster }],
  ["bob-id", "bob", { w: 11, l: 6, score: 50.0, champ: false, playoffs: true, format: "fantasy", roster: upsetRoster }],
  ["alice-id", "alice", { w: 12, l: 5, score: 58.3, champ: true, playoffs: true, format: "standard", roster: upsetRoster }],
]) {
  const row = runLogRow(id, username, { ...entry, date: clock += 1000 }, entry.mode === "daily" ? "2026-09-01" : null);
  auth._runs.set(`${row.user_id}|${row.created_at}|${row.dnf}`, row);
}

// Build-a-player results live in their own table, unrelated to profiles - seed a couple directly
// the same way logBuild would insert them, to test the Stats screen's read side independent of
// running the actual slow multi-round build flow (see test-build-a-player.mjs for that).
auth._builds.set("build-1", { id: "build-1", username: "carol", pos: "QB", overall: 132.4, filled: {} });
auth._builds.set("build-2", { id: "build-2", username: "alice", pos: "RB", overall: 88.0, filled: {} });

const { container } = await mount();
await flush();
await click(findButtonByText(container, "Stats"));
await flush();

await runTest("the Stats screen shows sitewide totals once the one fetch resolves", async () => {
  const t = text(container);
  assert(t.includes("Sitewide"), "expected a Sitewide section on the Stats view");
  assert(t.includes("Accounts"), "expected an accounts tile, got: " + t.slice(0, 500));
});

await runTest("best lineups ever ranks by best score, most-drafted players aggregates across profiles", async () => {
  const t = text(container);
  // Score-ranked boards are per format; Fantasy is the default selection.
  assert(t.includes("Best Fantasy lineups ever"), "expected the best-lineups section");
  assert(t.includes("alice") && t.includes("95.5"), "expected alice's best score, got: " + t.slice(0, 800));
  assert(t.includes("Most-drafted players"), "expected the most-drafted section");
  assert(t.includes("Tom Brady") && t.includes("3 drafts"), "expected Tom Brady drafted 3 times (2 from alice's recent, 1 from bob's), got: " + t.slice(0, 1200));
});

const upsetSection = () => {
  const t = text(container);
  const start = t.indexOf("Biggest ");
  return start < 0 ? "" : t.slice(start, t.indexOf("Career records", start));
};

await runTest("biggest upsets rank title-winning runs from the lowest team score up", async () => {
  const s = upsetSection();
  assert(s.startsWith("🚨 Biggest Fantasy upsets") || s.includes("Biggest Fantasy upsets"), "expected a Biggest Fantasy upsets section, got: " + s.slice(0, 200));
  assert(!text(container).includes("position records"), "the old position-records section should be gone");
  const order = ["64.8", "71.2", "90.0"].map((score) => s.indexOf(score));
  assert(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], "expected 64.8, then 71.2, then 90.0, got: " + s.slice(0, 600));
  assert(!s.includes("50.0"), "a run that didn't win the title is not an upset, got: " + s.slice(0, 600));
  assert(!s.includes("58.3"), "a Championship-format title must not appear on the Fantasy board");
  assert(/64\.8, 12–5 🏆 · Daily/.test(s), "expected bob's daily title tagged Daily, got: " + s.slice(0, 600));
  assert(/90\.0, 20–0 🏆 perfect season/.test(s), "expected the 20–0 run marked as a perfect season, got: " + s.slice(0, 600));
  assert(s.includes("Kyle Orton"), "expected the upset lineup's roster chips");
});

await runTest("each scoring format has its own upset board", async () => {
  await click([...container.querySelectorAll(".fmtbtn")].find((b) => b.textContent.startsWith("Championship")));
  await flush();
  const s = upsetSection();
  assert(s.includes("Biggest Championship upsets") && s.includes("58.3"), "expected alice's Championship title on its own board, got: " + s.slice(0, 400));
  assert(!s.includes("64.8") && !s.includes("71.2"), "Fantasy titles must not appear on the Championship board, got: " + s.slice(0, 400));
  await click([...container.querySelectorAll(".fmtbtn")].find((b) => b.textContent.startsWith("Fantasy")));
  await flush();
});

await runTest("wins/championships/playoffs/streak leaderboards rank by their own stat", async () => {
  const t = text(container);
  assert(t.includes("Most career wins") && t.includes("15–3"), "expected alice's 15-3 record on the wins leaderboard, got: " + t.slice(0, 1500));
  assert(t.includes("Most championships"), "expected a championships section");
  const champsSection = t.slice(t.indexOf("Most championships"), t.indexOf("Most playoff appearances"));
  assert(!champsSection.includes("bob"), "bob has 0 championships and should be excluded, not just outranked, got: " + champsSection);
  assert(t.includes("Most playoff appearances"), "expected a playoff-appearances section");
  assert(t.includes("Longest daily streak"), "expected a daily-streak section");
});

await runTest("best win percentage requires a minimum sample and ranks by rate", async () => {
  const t = text(container);
  assert(t.includes("Best win percentage"), "expected a win-percentage section");
  assert(t.includes("83%"), "expected alice's 15/18 = 83% win rate, got: " + t.slice(0, 1500));
  assert(t.includes("33%"), "expected bob's 5/15 = 33% win rate");
});

await runTest("best GM-mode score is drawn only from runs tagged run.gm", async () => {
  const t = text(container);
  assert(t.includes("GM-mode score"), "expected a GM-mode section");
  assert(t.includes("88.3"), "expected alice's tagged GM run (score 88.3), got: " + t.slice(0, 1500));
});

await runTest("created players count and the highest-OVR leaderboard come from the separate builds table", async () => {
  const tile = [...container.querySelectorAll(".tile")].find((el) => el.textContent.includes("Created players"));
  assert(tile, "expected a created-players tile on the Sitewide panel");
  assert(tile.querySelector(".n")?.textContent === "2", "expected the tile to count both seeded builds, got: " + tile.textContent);

  const t = text(container);
  assert(t.includes("Highest-OVR created player"), "expected a highest-OVR leaderboard");
  const section = t.slice(t.indexOf("Highest-OVR created player"));
  const carolIdx = section.indexOf("carol");
  const aliceIdxInSection = section.indexOf("alice");
  assert(carolIdx >= 0 && carolIdx < aliceIdxInSection, "expected carol (overall 132.4) ranked above alice (88.0), got: " + section.slice(0, 300));
  assert(section.includes("QB") && section.includes("132.4"), "expected carol's build details, got: " + section.slice(0, 300));
});


// The builds board took the top ten and THEN dropped the rows it can't show, so a handful of bad
// legacy rows left it showing fewer than ten - and enough of them left it reading "No builds yet"
// over a full table. A NaN numeric sorts above every real number in Postgres, which is exactly what
// put them at the top; check_new_build only guards new rows, so the old ones are permanent.
await runTest("the builds board shows ten real builds, however many bad rows sit above them", async () => {
  const auth = makeMockAuth();
  window.__ps_supabase__ = auth;
  const { fetchTopBuilds } = await import("../storage.js");
  const id = () => `b${auth._builds.size + 1}`;
  // Four rows the screen can never show, above twelve it can.
  for (const bad of [NaN, NaN, NaN, 1e13]) {
    auth._builds.set(id(), { id: id(), user_id: "u1", username: "legacy", pos: "QB", overall: bad, filled: {}, created_at: new Date().toISOString() });
  }
  auth._builds.set(id(), { id: id(), user_id: "u1", username: "legacy", pos: "DEF", overall: 200, filled: {}, created_at: new Date().toISOString() });
  for (let i = 0; i < 12; i++) {
    const k = id();
    auth._builds.set(k, { id: k, user_id: "u2", username: "real", pos: "QB", overall: 100 + i, filled: {}, created_at: new Date().toISOString() });
  }

  const top = await fetchTopBuilds(10);
  assert(top.length === 10, `ten rows, not ${top.length}`);
  assert(top.every((b) => Number.isFinite(b.overall) && b.pos !== "DEF"), "all of them showable");
  assert(top[0].overall === 111, `the best real build leads: ${top[0].overall}`);
});

console.log("test-stats.mjs done");
