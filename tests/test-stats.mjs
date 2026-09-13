// The Stats screen: one fetch (fetchStatsProfiles, mirrored here by seeding auth._profiles
// directly) feeds every leaderboard via computeSiteStats - best lineups and most-drafted players
// (moved here from the old Leaderboard-view Hall of Fame), plus wins/championships/playoffs/
// streak/win%/position records (zero new tracking) and best GM-mode score (tagged via run.gm,
// see finish()). Seeds two profiles whose numbers are picked so every leaderboard has a clear,
// checkable #1.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

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
  assert(t.includes("Best lineups ever"), "expected the best-lineups section");
  assert(t.includes("alice") && t.includes("95.5"), "expected alice's best score, got: " + t.slice(0, 800));
  assert(t.includes("Most-drafted players"), "expected the most-drafted section");
  assert(t.includes("Tom Brady") && t.includes("3 drafts"), "expected Tom Brady drafted 3 times (2 from alice's recent, 1 from bob's), got: " + t.slice(0, 1200));
});

await runTest("position records show the highest-rated player ever at each slot", async () => {
  const t = text(container);
  assert(t.includes("Position records"), "expected a position-records section");
  assert(t.includes("Tom Brady"), "expected Tom Brady (rating 140) to hold the QB record over Drew Brees (130)");
  assert(t.includes("Priest Holmes"), "expected Priest Holmes to hold the RB record");
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
  assert(t.includes("Best GM-mode score"), "expected a GM-mode section");
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

console.log("test-stats.mjs done");
