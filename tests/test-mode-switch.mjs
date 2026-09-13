// Genius and GM mode share the Unlimited progress slot (one free draft in flight at a time),
// but switching from one variant to another must start a fresh draft in the newly-tapped
// variant, not silently resume the old one under its old flags (a real bug: start Genius, back
// out mid-draft, tap GM mode, and the old Genius board came back instead of a GM draft).
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
window.__ps_supabase__ = makeMockAuth();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));
await flush();

function modeButton(name) {
  return [...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === name).closest("button");
}

async function draftFirstCard() {
  let card = null;
  for (let i = 0; i < 10 && !card; i++) {
    await flush(1);
    card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
  }
  if (!card) throw new Error("no draftable player found");
  await click(card.querySelector("button.hit"));
  await flush();
  await click(card.querySelector(".drafts button.btn.solid"));
  await flush();
}

await runTest("switching from a half-finished Genius draft to GM mode starts a fresh GM draft, not the old Genius one", async () => {
  await click(modeButton("Genius mode"));
  await flush();
  assert(text(container).includes("Genius mode"), "expected to be in Genius mode after starting it");
  await draftFirstCard();
  assert(text(container).includes("Pick 2 of 6"), "expected one pick made in the Genius draft");

  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton("GM mode"));
  await flush();

  const t = text(container);
  assert(t.includes("GM mode") && !t.includes("Genius mode"), "expected a real GM mode draft, not the old Genius one: " + t.slice(0, 200));
  assert(t.includes("Pick 1 of 6"), "expected a fresh draft (pick 1 of 6), not the resumed Genius progress, got: " + t.slice(0, 200));
  assert(container.querySelectorAll(".card .pill").length > 0, "expected GM mode's salary pills on the fresh board");
});

await runTest("switching scoring format mid-draft starts a fresh draft rather than resuming under the wrong rules", async () => {
  // The scoring format is part of the free-draft variant for the same reason genius/gm are:
  // resuming a full-PPR draft under standard scoring would grade it by rules it wasn't drafted
  // under, and the run would be submitted against the wrong leaderboard.
  await click(findButtonByText(container, "Modes"));
  await flush();
  const formatButton = (label) => [...container.querySelectorAll(".fmtbtn")].find((b) => b.textContent.includes(label));

  await click(formatButton("Fantasy"));
  await flush();
  await click(modeButton("Unlimited"));
  await flush();
  await draftFirstCard();
  assert(text(container).includes("Pick 2 of 6"), "expected one pick made in the Fantasy draft");

  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(formatButton("Championship"));
  await flush();
  await click(modeButton("Unlimited"));
  await flush();

  const t = text(container);
  assert(t.includes("Championship"), "expected the mode bar to show Championship scoring, got: " + t.slice(0, 300));
  assert(t.includes("Pick 1 of 6"), "expected a fresh draft, not the resumed Fantasy progress, got: " + t.slice(0, 300));
});

console.log("test-mode-switch.mjs done");
