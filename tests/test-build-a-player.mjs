// Build-a-player is standalone: no roster, no 6-slot draft. You choose the position, then roll
// a team + their active player from last season (with a brief animated reveal), take one
// attribute (graded F-A+ off his real stats) from him, repeat until every attribute is filled,
// then roll a random real team-season (any year) and watch an animated sim of whether swapping
// your build into their lineup would have helped them win it all.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
window.__ps_supabase__ = makeMockAuth();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));
await flush();
await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Build-a-player").closest("button"));
await flush();

// The team-then-player roll animation is a deliberately slow, decelerating reveal (~4s: a team
// spin, a hold, a player spin, a hold) rather than react-act's synchronous test helpers, so wait
// it out with real timers instead of flush().
async function waitForBuildStage() {
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 60));
    await flush(1);
    if (container.querySelector(".panel .frow button")) return;
  }
  throw new Error("attribute-pick buttons never appeared after the roll animation");
}

await runTest("choosing a position rolls a team and player, then lets you build without ever starting a draft", async () => {
  assert(container.querySelector("h2.h")?.textContent === "Build-a-player", "expected the position-choice screen first");
  const posBtn = [...container.querySelectorAll(".frow button")].find((b) => ["Quarterbacks", "Running backs", "Wide receivers", "Tight ends"].includes(b.textContent));
  assert(posBtn, "expected a position choice button");
  await click(posBtn);
  await flush();

  await waitForBuildStage();
  const heading = container.querySelector("h2.h")?.textContent;
  assert(/^Build-a-player - /.test(heading), "expected the build screen heading after the roll animation, got: " + heading);

  for (let i = 0; i < 9; i++) {
    const btn = container.querySelector(".panel .frow button");
    assert(btn, `round ${i}: expected an attribute-pick button, only got: ` + text(container).slice(0, 200));
    await click(btn);
    if (i < 8) await waitForBuildStage(); // the 9th pick goes straight to "done", no reroll/animation
    else await flush();
  }

  assert(container.querySelector("h2.h")?.textContent.startsWith("Build complete"), "expected the build-complete summary after 9 attributes, got: " + container.querySelector("h2.h")?.textContent);
  assert(!container.querySelector(".roster"), "Build-a-player must never open the normal 6-slot roster/draft");
  assert(!text(container).includes("Pick 1 of 6"), "Build-a-player must never start a normal draft");
  const rows = [...container.querySelectorAll(".panel .rc")];
  assert(rows.length === 9, "expected 9 graded attributes in the summary, got " + rows.length);
  assert(rows.every((r) => r.querySelector(".alt")?.textContent.includes("from ")), "expected each attribute to name the real player it came from");
});

await runTest("giving him his shot animates a standalone sim against a real historical team, no roster involved", async () => {
  await click(findButtonByText(container, "Give him his shot"));
  await flush();

  assert(container.querySelector("h2.h")?.textContent === "The verdict", "expected the result screen after simming");
  // Let the game-by-game reveal (90ms/tick) play out rather than skipping, to prove it's animated.
  for (let i = 0; i < 60 && !findButtonByText(container, "Build another"); i++) {
    await new Promise((r) => setTimeout(r, 60));
    await flush(1);
  }
  assert(findButtonByText(container, "Build another"), "expected the reveal to finish and show the final record");
  const t = text(container);
  assert(/\d+–\d+/.test(t), "expected a W-L record in the result, got: " + t.slice(0, 300));
  assert(!container.querySelector(".roster"), "the sim result must not involve the normal roster");
});

console.log("test-build-a-player.mjs done");
