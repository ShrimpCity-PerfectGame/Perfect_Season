// Stats O/U: every round must resolve to a real player without recursing forever (a random
// pick that only ever samples ids never placed on any board would retry indefinitely).
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, runTest } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));
await flush();
await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Stats O/U").closest("button"));
await flush();

await runTest("many rounds resolve without error and update the running score", async () => {
  for (let i = 0; i < 40; i++) {
    const panel = container.querySelector(".panel");
    assert(panel?.querySelector("h3")?.textContent, `round ${i}: expected a player name`);
    const guessBtn = findButtonByText(panel, "Over") || findButtonByText(panel, "Under");
    assert(guessBtn, `round ${i}: expected Over/Under buttons`);
    await click(guessBtn);
    await flush();
    assert(/Correct!|Wrong\./.test(panel.textContent), `round ${i}: expected a reveal after guessing`);
    const nextBtn = findButtonByText(container, "Next player");
    await click(nextBtn);
    await flush();
  }
  const record = container.querySelector(".note")?.textContent;
  assert(/Record: \d+–\d+/.test(record), "expected a running record, got: " + record);
});

console.log("test-stats-ou.mjs done");
