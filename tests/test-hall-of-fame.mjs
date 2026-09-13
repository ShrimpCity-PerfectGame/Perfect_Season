// Hall of fame: "best lineups ever" reuses fetchLeaderboardTop with a bigger limit (no new
// backend), "most-drafted players" aggregates client-side from a bounded sample of everyone's
// recent runs (fetchRecentRosters). Lazy - only fetched once the section is actually opened.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;

// Seed two finished profiles directly into the mock, as if two real players had already drafted -
// Alice's best-ever roster shares one player (Tom Brady, 2007) with Bob's most recent run, so the
// most-drafted aggregation has something real to count across profiles, not just within one.
auth._profiles.set("alice-id", {
  id: "alice-id", username: "alice", best_score: 95.5,
  best_run: { w: 15, l: 2, roster: [{ name: "Tom Brady", season: 2007, team: "NE" }, { name: "Randy Moss", season: 2007, team: "NE" }] },
  recent: [{ dnf: false, roster: [{ name: "Tom Brady", season: 2007, team: "NE" }, { name: "Randy Moss", season: 2007, team: "NE" }] }],
});
auth._profiles.set("bob-id", {
  id: "bob-id", username: "bob", best_score: 80.1,
  best_run: { w: 11, l: 6, roster: [{ name: "Priest Holmes", season: 2002, team: "KC" }] },
  recent: [
    { dnf: false, roster: [{ name: "Tom Brady", season: 2007, team: "NE" }, { name: "Priest Holmes", season: 2002, team: "KC" }] },
    { dnf: true, picks: 2 }, // a DNF entry has no roster at all - must not break aggregation
  ],
});

const { container } = await mount();
await flush();
await click(findButtonByText(container, "Leaderboard"));
await flush();

await runTest("Hall of fame is collapsed behind a button until opened", async () => {
  assert(text(container).includes("Hall of fame"), "expected a Hall of fame heading on the Leaderboard view");
  assert(!text(container).includes("Best lineups ever"), "the section should be collapsed before it's opened");
  assert(findButtonByText(container, "Show hall of fame"), "expected a button to open it");
});

await runTest("opening it shows the best lineups ever and the most-drafted players", async () => {
  await click(findButtonByText(container, "Show hall of fame"));
  await flush();

  const t = text(container);
  assert(t.includes("Best lineups ever"), "expected the best-lineups section");
  assert(t.includes("alice") && t.includes("95.5"), "expected alice's best score in the hall of fame, got: " + t.slice(0, 500));
  assert(t.includes("Tom Brady") && t.includes("2007"), "expected alice's roster listed with the lineup");

  assert(t.includes("Most-drafted players"), "expected the most-drafted section");
  assert(t.includes("2 drafts"), "expected Tom Brady (drafted by both alice and bob) to show a count of 2, got: " + t.slice(0, 800));
});

console.log("test-hall-of-fame.mjs done");
