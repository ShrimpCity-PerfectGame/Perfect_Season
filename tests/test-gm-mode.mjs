// GM mode: a player's salary is shown before selecting them, doesn't change based on which
// slot (named or Flex) they'd fill, and the "Draft to X" cost matches what was shown up front.
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, runTest } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));
await flush();
await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "GM mode").closest("button"));
await flush();

await runTest("every card shows a salary before being selected", async () => {
  const cards = container.querySelectorAll(".card");
  assert(cards.length > 0, "expected player cards on the board");
  const pills = container.querySelectorAll(".card .pill");
  assert(pills.length === cards.length, `expected every one of ${cards.length} cards to show a salary pill, got ${pills.length}`);
});

await runTest("a Flex-eligible player's salary is identical for its named slot and Flex", async () => {
  const card = [...container.querySelectorAll(".card")].find((c) => ["RB", "WR", "TE"].includes(c.querySelector(".pp")?.textContent) && !c.classList.contains("off"));
  const shown = card.querySelector(".pill").textContent;
  await click(card.querySelector("button.hit"));
  await flush();
  const slotButtons = [...card.querySelectorAll(".drafts button")].filter((b) => b.textContent.startsWith("Draft to"));
  assert(slotButtons.length >= 2, "expected at least a named-slot and a Flex button for this player");
  for (const b of slotButtons) {
    assert(b.textContent.includes(shown), `expected "${shown}" in every slot button, got: ${b.textContent}`);
  }
});

console.log("test-gm-mode.mjs done");
