// Build-a-player: roll real players, take one stat category from each until the assigned
// position is fully assembled, then the custom player pre-fills that slot for a normal draft.
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, runTest } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));
await flush();
await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Build-a-player").closest("button"));
await flush();

let pos = null;

await runTest("rolling and picking stats fills every category then drops into a draft", async () => {
  const heading = container.querySelector("h2.h")?.textContent;
  assert(/^Build-a-player - /.test(heading), "expected the build screen heading, got: " + heading);
  pos = { Quarterbacks: "QB", "Running backs": "RB", "Wide receivers": "WR", "Tight ends": "TE" }[heading.replace("Build-a-player - ", "")];
  assert(pos, "expected a recognizable position in the heading: " + heading);

  for (let i = 0; i < 4; i++) {
    const btn = container.querySelector(".panel .frow button");
    assert(btn, `round ${i}: expected a stat-pick button`);
    await click(btn);
    await flush();
  }

  await flush(3);
  assert(container.querySelector(".pickno span")?.textContent === "Pick 2 of 6", "expected the draft to start at pick 2 (slot pre-filled), got: " + container.querySelector(".pickno span")?.textContent);
  const slot = container.querySelector(`.roster .slot.pos-${pos}`);
  assert(slot.classList.contains("filled") && slot.querySelector(".v").textContent.includes("custom"), "expected the assigned position's slot to already hold the custom player");
});

await runTest("the custom player carries through to the finished roster", async () => {
  for (let pick = 0; pick < 5; pick++) {
    let card = null;
    for (let i = 0; i < 10 && !card; i++) {
      await flush(1);
      card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
    }
    if (!card) throw new Error(`no draftable player found on pick ${pick + 1}`);
    await click(card.querySelector("button.hit"));
    await flush();
    await click(card.querySelector(".drafts button.btn.solid"));
    await flush();
  }
  for (let i = 0; i < 20 && !findButtonByText(container, "Draft a new team"); i++) {
    const skip = findButtonByText(container, "Skip to the result");
    if (skip) { await click(skip); continue; }
    await new Promise((r) => setTimeout(r, 150));
    await flush(1);
  }
  const rows = [...container.querySelectorAll(".reveal .rv")];
  assert(rows.some((r) => r.textContent.includes("Your custom")), "expected the custom player in the graded roster");
});

console.log("test-build-a-player.mjs done");
