// A live concurrent-players count via Supabase Realtime Presence, and a live total-drafts count
// via Realtime broadcast - both on one channel (storage.js's subscribeSiteActivity).
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

await runTest("the home screen shows a live drafts count that ticks up on a broadcast from another tab", async () => {
  const draftsPill = () => [...container.querySelectorAll(".pill")].find((p) => p.textContent.includes("drafts"));
  const before = draftsPill();
  assert(before, "expected a drafts-count pill on the home hero, got: " + container.textContent.slice(0, 500));
  const startCount = parseInt(before.textContent.replace(/[^\d]/g, ""), 10);
  assert(!Number.isNaN(startCount), "expected a numeric count, got: " + before.textContent);

  await broadcast(auth, "site-activity", "draft_finished", {});

  const after = draftsPill();
  const afterCount = parseInt(after.textContent.replace(/[^\d]/g, ""), 10);
  assert(afterCount === startCount + 1, `expected the drafts count to tick up by 1 (${startCount} -> ${startCount + 1}), got ${afterCount}`);
});

const draftsCount = () => {
  const pill = [...container.querySelectorAll(".pill")].find((p) => p.textContent.includes("drafts"));
  return pill ? parseInt(pill.textContent.replace(/[^\d]/g, ""), 10) : null;
};
async function reloadLeaderboard() {
  await click(findButtonByText(container, "Leaderboard"));
  await flush(6);
  await click(findButtonByText(container, "Modes"));
  await flush(4);
}

await runTest("a leaderboard refresh with older totals never lowers the live drafts count", async () => {
  // The tab that finishes a draft refreshes the leaderboard while its submit-run is still saving, so
  // it can read a total from before that draft. The mock's totals don't include the broadcast above.
  const shown = draftsCount();
  await reloadLeaderboard();
  assert(draftsCount() === shown, `expected the drafts count to stay at ${shown} after a stale refresh, got ${draftsCount()}`);
});

await runTest("a failed totals request leaves the drafts count alone instead of showing 0", async () => {
  const shown = draftsCount();
  const realRpc = auth.rpc;
  auth.rpc = () => Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } });
  await click(findButtonByText(container, "Leaderboard"));
  await flush(6);
  await click(findButtonByText(container, "Modes"));
  await flush(4);
  auth.rpc = realRpc;
  assert(draftsCount() === shown, `expected the drafts count to stay at ${shown} when totals fail to load, got ${draftsCount()}`);
});

console.log("test-online-counter.mjs done");
