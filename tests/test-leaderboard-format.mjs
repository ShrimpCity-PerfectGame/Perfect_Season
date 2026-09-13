// Regression test for a real crash: switching the Leaderboard to Championship broke the page.
//
// The board's rows and the accessor that reads them have to describe the SAME format. Switching
// format flips the toggle state synchronously while the refetch is still in flight, so for a
// moment the already-loaded Fantasy rows were being read with the Championship accessor - and a
// profile that has never posted a Championship score has null there, so `.toFixed(1)` threw and
// took the whole page down. Every existing account is in exactly that state the day this ships,
// which is why this was hit immediately.
//
// The fix pairs the rows with the format they were fetched for (lb.format / dailyBoard.format) and
// renders from that, never from the live toggle.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;

// Two accounts with Fantasy scores and no Championship score at all - the state every existing
// profile is in before anyone plays the new format.
auth._profiles.set("alice-id", {
  id: "alice-id", username: "alice",
  best_score: 95.5, best_score_std: null,
  runs: 5, dnf: 0, wins: 15, losses: 3, champs: 2, perfect: 1, playoffs: 4, daily_best_streak: 5,
  best_run: { w: 15, l: 2, roster: [{ slot: "QB", name: "Tom Brady", season: 2007, team: "NE", rating: 140 }] },
  best_record: { w: 15, l: 2 },
  recent: [],
});
auth._profiles.set("bob-id", {
  id: "bob-id", username: "bob",
  best_score: 80.1, best_score_std: null,
  runs: 4, dnf: 1, wins: 5, losses: 10, champs: 0, perfect: 0, playoffs: 1, daily_best_streak: 2,
  best_run: { w: 11, l: 6, roster: [{ slot: "QB", name: "Drew Brees", season: 2011, team: "NO", rating: 130 }] },
  best_record: { w: 11, l: 6 },
  recent: [],
});

const { container } = await mount();
await flush();

const formatButton = (label) => [...container.querySelectorAll(".fmtbtn")].find((b) => b.textContent.includes(label));

await runTest("the Leaderboard survives switching to a format nobody has posted a score in yet", async () => {
  await click(findButtonByText(container, "Leaderboard"));
  await flush(4);
  assert(text(container).includes("alice"), "expected the Fantasy leaderboard to list alice, got: " + text(container).slice(0, 400));

  const champ = formatButton("Championship");
  assert(champ, "expected a Championship option on the Leaderboard's scoring toggle");
  await click(champ);
  await flush(4);

  // The page must still be alive. A thrown render unmounts the tree, so a live nav is the check.
  const t = text(container);
  assert(findButtonByText(container, "Leaderboard"), "the page crashed - the nav is gone after switching format");
  assert(t.includes("Scoring"), "expected the scoring toggle to still be rendered after switching");
  // And it must not be showing the Fantasy numbers under a Championship heading.
  assert(!t.includes("95.5"), "expected alice's Fantasy score to be gone from the Championship board, got: " + t.slice(0, 600));
});

await runTest("switching back to Fantasy restores that board", async () => {
  await click(formatButton("Fantasy"));
  await flush(4);
  const t = text(container);
  assert(t.includes("alice") && t.includes("95.5"), "expected the Fantasy board to come back, got: " + t.slice(0, 600));
});

await runTest("a Championship score appears on its own board and never on the Fantasy one", async () => {
  auth._profiles.get("bob-id").best_score_std = 70.2;
  auth._profiles.get("bob-id").best_run_std = { w: 9, l: 8, format: "standard", roster: [{ slot: "QB", name: "Jay Cutler", season: 2014, team: "CHI", rating: 78.5 }] };

  await click(formatButton("Championship"));
  await flush(4);
  let t = text(container);
  assert(t.includes("bob") && t.includes("70.2"), "expected bob's Championship score on the Championship board, got: " + t.slice(0, 600));
  assert(!t.includes("95.5"), "alice's Fantasy score must not appear on the Championship board");

  await click(formatButton("Fantasy"));
  await flush(4);
  t = text(container);
  assert(t.includes("95.5"), "expected the Fantasy board to still rank alice first");
  assert(!t.includes("70.2"), "bob's Championship score must not appear on the Fantasy board");
});

console.log("test-leaderboard-format.mjs done");
