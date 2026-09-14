// A reroll should never land back on a team+years board already shown earlier this draft.
import { setupDom, makeStorage, mount, flush, click, findButtonByText, assert, runTest, makeMockAuth, clickMode } from "./helpers.mjs";

function boardOf(container) {
  const team = container.querySelector(".reel .team")?.textContent;
  const years = container.querySelector(".reel .years")?.textContent;
  return `${team}|${years}`;
}

async function draftFirstEligible(container) {
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

await runTest("no board repeats within a draft, across rerolls and normal advancement", async () => {
  const N = 15;
  for (let run = 0; run < N; run++) {
    setupDom();
    window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
    const { container } = await mount();
    await flush();
    await clickMode(container, "Unlimited");
    await flush();

    const seen = [];
    seen.push(boardOf(container));

    await click(findButtonByText(container, "Re-spin team"));
    await flush();
    seen.push(boardOf(container));

    await click(findButtonByText(container, "Re-spin era"));
    await flush();
    seen.push(boardOf(container));

    for (let pick = 0; pick < 6; pick++) {
      await draftFirstEligible(container);
      if (pick < 5) seen.push(boardOf(container));
    }

    const dupes = seen.filter((b, i) => seen.indexOf(b) !== i);
    assert(dupes.length === 0, `run ${run}: a board repeated within one draft: ${dupes.join(", ")} (full sequence: ${seen.join(" -> ")})`);
  }
});

console.log("test-reroll-pool.mjs done");
