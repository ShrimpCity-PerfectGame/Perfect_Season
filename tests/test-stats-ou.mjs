// Over/Under is a shared daily leaderboard: everyone gets the same seeded sequence of rounds
// each day, three lives, a 7-second clock per guess. A rules/confirm screen always comes first -
// the clock doesn't start until it's accepted. Verify: rounds resolve to real players without
// ever breaking (a random pick that only ever samples ids never placed on any board would retry
// indefinitely), the intro screen gates the timer, running out of lives locks the day and
// surfaces the leaderboard, and reopening afterward shows the same finished result rather than
// letting you replay.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
window.__ps_supabase__ = makeMockAuth();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));
await flush();
await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Over/Under").closest("button"));
await flush();

await runTest("the rules screen gates the timer, then guessing until lives run out locks today's game", async () => {
  assert(container.querySelector("h2.h")?.textContent === "Over/Under", "expected the Over/Under intro screen");
  assert(text(container).includes("Three lives"), "expected the rules to mention three lives, got: " + text(container).slice(0, 300));
  assert(!container.querySelector(".sou-timer"), "the clock must not be running before the rules are accepted");

  await click(findButtonByText(container, "I'm ready"));
  await flush();
  assert(container.querySelector(".sou-hearts"), "expected the lives/score/timer HUD once the round actually starts");

  for (let i = 0; i < 30 && !text(container).includes("is done"); i++) {
    const panel = container.querySelector(".panel");
    assert(panel?.querySelector("h3")?.textContent, `round ${i}: expected a player name`);
    const guessBtn = findButtonByText(panel, "Over");
    assert(guessBtn, `round ${i}: expected an Over button`);
    await click(guessBtn);
    await flush();
    assert(/Correct!|Wrong\.|Too slow\./.test(panel.textContent), `round ${i}: expected a reveal after guessing`);
    const nextBtn = findButtonByText(container, "Next round") || findButtonByText(container, "See today's result");
    assert(nextBtn, `round ${i}: expected a way to continue`);
    await click(nextBtn);
    await flush();
  }

  assert(text(container).includes("is done"), "expected the day to lock after 3 misses within 30 rounds (astronomically unlikely not to happen)");
  assert(container.querySelector("h2.h")?.textContent === "Over/Under", "expected to land on the finished Over/Under summary");
  assert(/Your score: \d+/.test(text(container)), "expected a final score, got: " + text(container).slice(0, 300));
  assert(text(container).includes("Today's leaderboard"), "expected today's leaderboard section");
});

await runTest("reopening after finishing shows the same result instead of a rules screen or a fresh game", async () => {
  await click(findButtonByText(container, "Back to modes"));
  await flush();
  assert(findButtonByText(container, "See today's result"), "expected the home card to reflect today's finished game");
  await click([...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === "Over/Under").closest("button"));
  await flush();
  assert(/Your score: \d+/.test(text(container)), "expected the same finished summary on reopen, not the rules screen or a fresh game");
});

console.log("test-stats-ou.mjs done");
