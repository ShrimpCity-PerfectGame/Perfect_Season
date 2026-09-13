// A live concurrent-players count via Supabase Realtime Presence (storage.js's
// subscribeOnlineCount). tests/helpers.mjs's mock channel() fires one sync event once this tab
// tracks itself - enough to verify the UI actually reads the presence count, not a real
// multi-client simulation (that can only be verified live, in two real browser sessions).
import { setupDom, makeStorage, mount, flush, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
window.__ps_supabase__ = makeMockAuth();
const { container } = await mount();
await flush();

await runTest("the home screen shows a live online-players count once the presence channel syncs", async () => {
  assert(findButtonByText(container, "Modes")?.className.includes("on"), "expected to land on the home screen");
  const pill = [...container.querySelectorAll(".pill")].find((p) => p.textContent.includes("online now"));
  assert(pill, "expected an online-count pill on the Sitewide panel, got: " + container.textContent.slice(0, 500));
  assert(/\d+ online now/.test(pill.textContent), "expected a numeric count, got: " + pill.textContent);
});

console.log("test-online-counter.mjs done");
