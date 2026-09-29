// A live concurrent-players count via Supabase Realtime Presence, and a live total-PLAYS count
// via Realtime broadcast - both on one channel (storage.js's subscribeSiteActivity).
// Since v2.16.0 the hero pill counts plays (drafts + every mini-game round) while the Stats screen's
// tile still counts drafts, so one broadcast carries which kind it was and the two must not move
// together. The wire event is still named draft_finished on purpose - see storage.js.
// tests/helpers.mjs's mock channel() fires one sync event once this tab tracks itself - enough
// to verify the UI actually reads the presence count, not a real multi-client simulation (that
// can only be verified live, in two real browser sessions). Same idea for broadcast: a test
// triggers the mock channel's own send() directly (via auth._channels) to simulate another tab
// finishing a draft, without needing a second mounted app.
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, runTest, makeMockAuth, broadcast } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;
const { container } = await mount();
await flush();

await runTest("the home screen shows a live online-players count once the presence channel syncs", async () => {
  assert(findButtonByText(container, "Modes")?.className.includes("on"), "expected to land on the home screen");
  const pill = [...container.querySelectorAll(".pill")].find((p) => p.textContent.includes("online now"));
  assert(pill, "expected an online-count pill on the Sitewide panel, got: " + container.textContent.slice(0, 500));
  assert(/\d+ online now/.test(pill.textContent), "expected a numeric count, got: " + pill.textContent);
});

const playsCount = () => {
  const pill = [...container.querySelectorAll(".pill")].find((p) => p.textContent.includes("plays"));
  return pill ? parseInt(pill.textContent.replace(/[^\d]/g, ""), 10) : null;
};

await runTest("the home screen shows a live plays count that ticks up on a broadcast from another tab", async () => {
  const pill = [...container.querySelectorAll(".pill")].find((p) => p.textContent.includes("plays"));
  assert(pill, "expected a plays-count pill on the home hero, got: " + container.textContent.slice(0, 500));
  // The label is the point of the change: the pill counts mini-games now, so it may not say "drafts".
  assert(!/drafts/.test(pill.textContent), "the hero pill counts mini-games too, so it must not say drafts: " + pill.textContent);
  const startCount = playsCount();
  assert(!Number.isNaN(startCount) && startCount != null, "expected a numeric count, got: " + pill.textContent);

  // No kind at all: what a tab still running the pre-2.16.0 bundle broadcasts. It has to keep counting,
  // or a deploy leaves the two halves of the site silently not counting each other.
  await broadcast(auth, "site-activity", "draft_finished", {});
  assert(playsCount() === startCount + 1, `an old tab's broadcast should tick plays by 1 (${startCount} -> ${startCount + 1}), got ${playsCount()}`);

  await broadcast(auth, "site-activity", "draft_finished", { kind: "minigame" });
  assert(playsCount() === startCount + 2, `a mini-game should tick plays by 1 (${startCount + 1} -> ${startCount + 2}), got ${playsCount()}`);
});

const draftsCount = () => playsCount();
async function reloadLeaderboard() {
  await click(findButtonByText(container, "Leaderboard"));
  await flush(6);
  await click(findButtonByText(container, "Modes"));
  await flush(4);
}

await runTest("a leaderboard refresh with older totals never lowers the live plays count", async () => {
  // The tab that finishes a draft refreshes the leaderboard while its submit-run is still saving, so
  // it can read a total from before that draft. The mock's totals don't include the broadcast above.
  const shown = draftsCount();
  await reloadLeaderboard();
  assert(draftsCount() === shown, `expected the plays count to stay at ${shown} after a stale refresh, got ${draftsCount()}`);
});

await runTest("a failed totals request leaves the plays count alone instead of showing 0", async () => {
  const shown = draftsCount();
  const realRpc = auth.rpc;
  auth.rpc = () => Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } });
  await click(findButtonByText(container, "Leaderboard"));
  await flush(6);
  await click(findButtonByText(container, "Modes"));
  await flush(4);
  auth.rpc = realRpc;
  assert(draftsCount() === shown, `expected the plays count to stay at ${shown} when totals fail to load, got ${draftsCount()}`);
});

await runTest("the Stats screen's Drafts tile counts drafts only, while the pill counts plays too", async () => {
  // The whole point of carrying `kind` on the broadcast: these two numbers sit on different screens
  // and must not move together. Without it the Drafts tile silently starts counting Guess the Player.
  const draftsTile = () => {
    const tile = [...container.querySelectorAll(".tile")].find((t) => t.querySelector(".l")?.textContent.trim() === "Drafts");
    return tile ? parseInt(tile.querySelector(".n").textContent.replace(/[^\d]/g, ""), 10) : null;
  };
  const openStats = async () => { await click(findButtonByText(container, "Stats")); await flush(6); };
  const backToModes = async () => { await click(findButtonByText(container, "Modes")); await flush(4); };

  await openStats();
  const startDrafts = draftsTile();
  assert(startDrafts != null, "expected a Drafts tile on the Stats screen, got: " + container.textContent.slice(0, 400));
  await backToModes();
  const startPlays = playsCount();

  // A mini-game moves plays and leaves drafts alone.
  await broadcast(auth, "site-activity", "draft_finished", { kind: "minigame" });
  assert(playsCount() === startPlays + 1, `a mini-game should tick plays, got ${playsCount()} from ${startPlays}`);
  await openStats();
  assert(draftsTile() === startDrafts, `a mini-game must NOT tick the Drafts tile (${startDrafts}), got ${draftsTile()}`);
  await backToModes();

  // A draft moves both - and so does a kind-less broadcast from a tab still on the old bundle, which
  // is the only thing that stops a deploy under-counting drafts for as long as those tabs stay open.
  for (const payload of [{ kind: "draft" }, {}]) {
    await backToModes();
    const p0 = playsCount();
    await openStats();
    const d0 = draftsTile();
    await backToModes();
    await broadcast(auth, "site-activity", "draft_finished", payload);
    assert(playsCount() === p0 + 1, `${JSON.stringify(payload)} should tick plays, got ${playsCount()} from ${p0}`);
    await openStats();
    assert(draftsTile() === d0 + 1, `${JSON.stringify(payload)} should tick the Drafts tile too (${d0} -> ${d0 + 1}), got ${draftsTile()}`);
    await backToModes();
  }
});

console.log("test-online-counter.mjs done");
