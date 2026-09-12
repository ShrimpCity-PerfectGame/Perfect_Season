// Board section ordering: a position should only sink to the bottom once it's truly
// unfillable (no open slot fits it anymore), not just because its own named slot filled while
// a FLEX slot could still take it.
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Start a draft"));
await flush();

function sectionOrder() {
  return [...container.querySelectorAll(".sec")].map((s) => s.querySelector("h3")?.textContent);
}

// Draft the first card whose position matches `pos` into the slot literally named `slotLabel`
// ("Draft to <slotLabel>"), waiting for the board to render first.
async function draftPosToSlot(pos, slotLabel) {
  let card = null;
  for (let i = 0; i < 10 && !card; i++) {
    await flush(1);
    card = [...container.querySelectorAll(".card")].find(
      (c) => !c.classList.contains("off") && c.querySelector(".pp")?.textContent === pos
    );
  }
  if (!card) throw new Error(`no draftable ${pos} found`);
  await click(card.querySelector("button.hit"));
  await flush();
  const btn = [...card.querySelectorAll(".drafts button.btn.solid")].find((b) => b.textContent.includes(slotLabel));
  if (!btn) throw new Error(`no "Draft to ${slotLabel}" button for a ${pos}`);
  await click(btn);
  await flush();
}

await runTest("filling a named slot while FLEX is open keeps that section in place", async () => {
  const before = sectionOrder();
  assert(before[0] === "Quarterbacks", "expected QB section first before any picks, got: " + before.join(", "));
  await draftPosToSlot("RB", "RB");
  const after = sectionOrder();
  assert(after[0] === "Quarterbacks" && after[1] === "Running backs", "RB section moved after its own slot filled while FLEX was still open: " + after.join(", "));
});

await runTest("a truly unfillable position (QB, no FLEX-eligible) sinks immediately", async () => {
  await draftPosToSlot("QB", "QB");
  const order = [...container.querySelectorAll(".sec")].map((s) => ({
    label: s.querySelector("h3")?.textContent,
    done: s.classList.contains("done"),
  }));
  const qb = order.find((s) => s.label === "Quarterbacks");
  assert(qb.done, "QB should be marked done once its only slot is filled (QB can't go to FLEX)");
  assert(order[order.length - 1].label === "Quarterbacks", "QB section should have sunk to the bottom, got order: " + order.map((s) => s.label).join(", "));
});

console.log("test-board-order.mjs done");
