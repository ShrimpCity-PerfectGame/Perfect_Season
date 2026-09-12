// Regression test for the end-of-draft "5 of 6" glitch: finishing a draft fires a
// fire-and-forget clearDraft() write, and navigating home immediately afterward triggers
// refreshWip(), which used to blindly trust whatever it read - including a stale pre-clear
// snapshot if its read raced ahead of the (slow, real-world) clear. Simulate that by making
// the storage shim's writes to the free-draft-progress key artificially slow.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest } from "./helpers.mjs";

const WRITE_DELAY_MS = 300;
setupDom();
window.storage = makeStorage(["ps-free-wip"], WRITE_DELAY_MS);
const { container } = await mount();
await flush();

await click(findButtonByText(container, "Start a draft"));
await flush();

for (let pick = 0; pick < 5; pick++) {
  let card = null;
  for (let i = 0; i < 10 && !card; i++) {
    await flush(1);
    card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
  }
  if (!card) throw new Error(`no draftable player found on pick ${pick + 1}`);
  await click(card.querySelector("button.hit"));
  await flush();
  const draftBtn = card.querySelector(".drafts button.btn.solid");
  await click(draftBtn);
  await flush();
}

// Final (6th) pick: finish() fires a slow (300ms) clearDraft() write and immediately
// navigate home - deliberately not waiting it out - so refreshWip()'s fast read races ahead
// of the slow write, exactly like the real bug report.
let card = null;
for (let i = 0; i < 10 && !card; i++) {
  await flush(1);
  card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
}
if (!card) throw new Error("no draftable player found on the final pick");
await click(card.querySelector("button.hit"));
const draftBtn = card.querySelector(".drafts button.btn.solid");
await click(draftBtn);

await runTest("home screen shows a fresh draft, not stale progress, right after finishing", async () => {
  await click(findButtonByText(container, "Modes"));
  await flush(1);
  const home = text(container);
  assert(!/\d+ of 6 picked/.test(home), "home screen shows stale in-progress picks after a finished draft: " + (home.match(/\d+ of 6 picked/) || [])[0]);
});

console.log("test-wip-race.mjs done");
