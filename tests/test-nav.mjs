// Landing page, mode switching, and draft resume.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth, selectOption, clickMode } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
const { container } = await mount();
await flush();

await runTest("home screen shows all four modes", async () => {
  const t = text(container);
  assert(t.includes("Daily challenge"), "missing Daily challenge card");
  assert(t.includes("Unlimited"), "missing Unlimited card");
  assert(t.includes("Challenge a friend"), "missing Challenge a friend card");
});

await runTest("nav tabs switch views", async () => {
  await click(findButtonByText(container, "Leaderboard"));
  await flush();
  assert(text(container).includes("leaderboard") || text(container).toLowerCase().includes("leaderboard"), "did not navigate to leaderboard view");

  await click(findButtonByText(container, "Modes"));
  await flush();
  assert(text(container).includes("Daily challenge"), "did not navigate back to home view");
});

await runTest("starting an unlimited draft shows a live board", async () => {
  await clickMode(container, "Unlimited");
  await flush();
  const t = text(container);
  assert(t.includes("Pick 1 of 6"), "expected to be on pick 1 of 6, got: " + t.slice(0, 200));
  assert(/Code [A-Z0-9]{4,}/.test(t), "expected a seeded draft code to be shown");
});

await runTest("draft in progress is resumable from the home screen", async () => {
  await click(findButtonByText(container, "Modes"));
  await flush();
  const t = text(container);
  assert(/1 of 6|resume/i.test(t) || t.includes("Draft"), "expected some indication of an in-progress draft on the home screen");
});

await runTest("the Players tab browses the board by team and era, read-only", async () => {
  await click(findButtonByText(container, "Players"));
  await flush();
  assert(container.querySelector("h2.h")?.textContent === "Players", "expected the Players view");
  assert(text(container).includes("Pick a team and an era"), "expected the empty-state prompt before choosing a team/era");

  const [teamSelect, eraSelect] = container.querySelectorAll(".frow select.inp");
  assert(teamSelect && eraSelect, "expected team and era dropdowns");
  const teamValue = [...teamSelect.options].find((o) => o.value)?.value;
  await selectOption(teamSelect, teamValue);
  await selectOption(eraSelect, "4"); // 2021-2025, guaranteed to have last-season data
  await flush();

  const t = text(container);
  assert(!t.includes("Pick a team and an era"), "expected the prompt to go away once a team/era is chosen");
  assert(container.querySelector(".sec"), "expected position sections once a board is chosen");
  assert(!container.querySelector(".card button.hit"), "the player index must be read-only - no draftable cards");
});

await runTest("a dead board survives a reload, and a re-spin is the way out of it", async () => {
  // noBoardLeft is a fact about the draft, and it was not in the snapshot - so a reload cleared it and put the
  // player back on the same dead board with its Lock ins live. A reload is what the note itself suggested, and
  // every pick made from there was refused by the server. `reroll()` never cleared it either, so you could
  // spin to a perfectly good board and stay locked out of it.
  setupDom();
  const storage = makeStorage();
  window.storage = storage;
  window.__ps_supabase__ = makeMockAuth();
  let app = await mount();
  await flush();
  await clickMode(app.container, "Unlimited");
  await flush(4);
  assert(app.container.querySelector(".seedline"), "a draft is dealt");

  // Take the draft the app just saved and mark it dead, which is the state advance() leaves behind.
  const saved = JSON.parse(storage.data["personal:ps-draft"]);
  // The key has to BE there, not merely be falsy: the snapshot is what a reload restores from, and a field
  // it never writes is a field that can only ever come back false. Planting it below tests the read; this
  // line is the write.
  assert("noBoardLeft" in saved && saved.noBoardLeft === false, `a live draft saves the flag, and it is false: ${JSON.stringify(saved.noBoardLeft)}`);
  storage.data["personal:ps-draft"] = JSON.stringify({ ...saved, noBoardLeft: true });
  storage.data["personal:ps-free-wip"] = storage.data["personal:ps-draft"];

  // A reload: the flag has to come back with the draft.
  setupDom();
  window.storage = storage;
  window.__ps_supabase__ = makeMockAuth();
  app = await mount();
  await flush(4);
  await clickMode(app.container, "Unlimited");
  await flush(4);
  assert(/no board left that fits/i.test(text(app.container)),
    `the dead board survives a reload: ${text(app.container).slice(0, 300)}`);
  // And the note no longer contradicts the button five lines above it.
  assert(!/nothing you've drafted here counts against you/i.test(text(app.container)),
    "and does not claim the draft is free to abandon when Reset charges a DNF");

  // A re-spin is the escape: rerollCandidate only offers a board this roster can pick from.
  const spin = findButtonByText(app.container, "Re-spin team");
  assert(spin && !spin.disabled, "a re-spin is offered");
  await click(spin);
  await flush(6);
  assert(!/no board left that fits/i.test(text(app.container)),
    `and it clears the dead board: ${text(app.container).slice(0, 300)}`);
});

console.log("test-nav.mjs done");
