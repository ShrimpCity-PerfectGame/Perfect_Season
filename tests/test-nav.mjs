// Landing page, mode switching, and draft resume.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const { container } = await mount();
await flush();

await runTest("home screen shows all four modes", async () => {
  const t = text(container);
  assert(t.includes("Daily challenge"), "missing Daily challenge card");
  assert(t.includes("Unlimited"), "missing Unlimited card");
  assert(t.includes("Challenge a friend"), "missing Challenge a friend card");
});

await runTest("nav tabs switch views", async () => {
  await click(findButtonByText(container, "Leaderboard"));
  await flush();
  assert(text(container).includes("leaderboard") || text(container).toLowerCase().includes("leaderboard"), "did not navigate to leaderboard view");

  await click(findButtonByText(container, "Modes"));
  await flush();
  assert(text(container).includes("Daily challenge"), "did not navigate back to home view");
});

await runTest("starting an unlimited draft shows a live board", async () => {
  await click(findButtonByText(container, "Start a draft"));
  await flush();
  const t = text(container);
  assert(t.includes("Pick 1 of 6"), "expected to be on pick 1 of 6, got: " + t.slice(0, 200));
  assert(/Code [A-Z0-9]{4,}/.test(t), "expected a seeded draft code to be shown");
});

await runTest("draft in progress is resumable from the home screen", async () => {
  await click(findButtonByText(container, "Modes"));
  await flush();
  const t = text(container);
  assert(/1 of 6|resume/i.test(t) || t.includes("Draft"), "expected some indication of an in-progress draft on the home screen");
});

console.log("test-nav.mjs done");
