// Flex slots must grade on raw production alone: whichever Flex pick has more PPR points
// should never grade lower than the other Flex pick, regardless of position (a TE and a WR
// in Flex are on equal footing - no positional curve should be able to flip that order).
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, runTest, makeMockAuth, clickMode } from "./helpers.mjs";

async function draftOneSeason() {
  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const { container } = await mount();
  await flush();
  await clickMode(container, "Unlimited");
  await flush();

  for (let pick = 0; pick < 6; pick++) {
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
  for (let i = 0; i < 20 && !findButtonByText(container, "Run it back"); i++) {
    const skip = findButtonByText(container, "Skip to the end");
    if (skip) { await click(skip); continue; }
    await new Promise((r) => setTimeout(r, 150));
    await flush(1);
  }

  const rows = [...container.querySelectorAll(".reveal")][0]?.querySelectorAll(".rv") || [];
  const flexRows = [...rows].filter((r) => r.className.includes("pos-FLEX"));
  return flexRows.map((r) => ({
    ppr: Number(r.querySelector(".pts")?.textContent.replace(/[^\d.]/g, "")),
    grade: r.querySelector(".gr")?.textContent,
  }));
}

const GRADE_ORDER = ["F", "D", "C−", "C", "C+", "B−", "B", "B+", "A−", "A", "A+"];

await runTest("the higher-PPR Flex pick never grades lower than the other Flex pick", async () => {
  for (let run = 0; run < 20; run++) {
    const [flex1, flex2] = await draftOneSeason();
    if (!flex1 || !flex2) continue;
    const [higher, lower] = flex1.ppr >= flex2.ppr ? [flex1, flex2] : [flex2, flex1];
    assert(
      GRADE_ORDER.indexOf(higher.grade) >= GRADE_ORDER.indexOf(lower.grade),
      `run ${run}: lower-PPR Flex pick (${lower.ppr} pts, ${lower.grade}) outgraded the higher-PPR one (${higher.ppr} pts, ${higher.grade})`
    );
  }
});

console.log("test-flex-scoring.mjs done");
