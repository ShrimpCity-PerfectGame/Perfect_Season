// DNF accounting. This mattered less when a DNF was only a counter; now it costs ladder points,
// so charging one twice or not at all is a real scoring bug.
//
// Two regressions are pinned here:
//   1. Resetting used to record the DNF twice - resetDraft charged one directly and then called
//      restart(), whose abandonCurrent() charged a second for the same draft.
//   2. Abandoning an Unlimited draft by starting something else used to be free. abandonCurrent()
//      decided from the LIVE mode, which by then was the Daily, while still wiping the saved
//      Unlimited draft unconditionally.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, waitForCrypto, makeMockAuth } from "./helpers.mjs";

async function signedInApp(username) {
  setupDom();
  window.storage = makeStorage();
  const auth = makeMockAuth();
  window.__ps_supabase__ = auth;
  const { container } = await mount();
  await flush();
  await click(findButtonByText(container, "Account"));
  await flush();
  await click(findButtonByText(container.querySelector(".panel"), "Create account"));
  await flush();
  const [email, u, p, p2] = [...container.querySelector(".panel").querySelectorAll("input")];
  await type(email, `${username}@example.com`);
  await type(u, username);
  await type(p, "Password1");
  await type(p2, "Password1");
  await click([...container.querySelector(".panel").querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await waitForCrypto();
  const userId = [...auth._profiles.keys()][0];
  return { container, auth, userId };
}

async function draftOne(container) {
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

const modeButton = (container, name) =>
  [...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === name)?.closest("button");

// The season reveal is animated; the post-result controls only exist once it finishes. Skip
// playoff rounds when offered, otherwise let the regular-season ticker catch up.
async function finishSeason(container) {
  for (let i = 0; i < 30 && !findButtonByText(container, "Run it back"); i++) {
    const skip = findButtonByText(container, "Skip to the end");
    if (skip) { await click(skip); continue; }
    await new Promise((r) => setTimeout(r, 120));
    await flush(1);
  }
  assert(findButtonByText(container, "Run it back"), "the season never finished revealing");
}

await runTest("resetting a draft records exactly one DNF, not two", async () => {
  const { container, auth, userId } = await signedInApp("dnfreset");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush();
  await draftOne(container);

  // Two taps: the first arms the confirm (which relabels the button), the second actually resets.
  await click(findButtonByText(container, "Reset draft"));
  await flush();
  const armed = findButtonByText(container, "Tap again");
  assert(armed, "expected the reset button to arm on the first tap");
  await click(armed);
  await flush(6);

  const row = auth._profiles.get(userId);
  assert(row.dnf === 1, `expected exactly one DNF for one reset, got ${row.dnf}`);
  assert(row.points_unlimited < 0, "the DNF should have cost points on the unlimited ladder, got " + row.points_unlimited);
});

await runTest("the mode bar's Unlimited pill resumes the draft in progress instead of wiping it", async () => {
  // It used to throw the saved draft away and charge a DNF for one tap, while the Home tile for the
  // same draft resumed it. Both now resume.
  const { container, auth, userId } = await signedInApp("dnfswitch");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush();
  await draftOne(container);
  assert(text(container).includes("Pick 2 of 6"), "expected one pick made in the Unlimited draft");
  const code = container.querySelector(".seedline code")?.textContent;

  // Go play the Daily, so the live mode is no longer the Unlimited draft...
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(findButtonByText(container, "Fantasy daily"));
  await flush(3);

  // ...then tap Unlimited in the mode bar.
  const unlimitedTab = [...container.querySelectorAll("button.mb")].find((b) => b.textContent === "Unlimited");
  assert(unlimitedTab, "expected an Unlimited button in the in-draft mode bar");
  await click(unlimitedTab);
  await flush(6);

  assert(container.querySelector(".seedline code")?.textContent === code, "expected the same Unlimited draft back, got code " + container.querySelector(".seedline code")?.textContent);
  assert(text(container).includes("Pick 2 of 6"), "expected the pick already made to still be there");
  const row = auth._profiles.get(userId);
  assert(row.dnf === 0, `resuming a draft must not charge a DNF, got ${row.dnf}`);
});

await runTest("finishing a draft is not a DNF", async () => {
  const { container, auth, userId } = await signedInApp("dnffinish");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush();
  for (let i = 0; i < 6; i++) await draftOne(container);
  await flush(6);

  const row = auth._profiles.get(userId);
  assert(row.dnf === 0, `a completed draft must not record a DNF, got ${row.dnf}`);
  assert(row.runs === 1, "the completed draft should be recorded as a run");

  // And starting the next draft from the result screen shouldn't retroactively charge one either -
  // finish() already cleared the saved draft, so there's nothing left to abandon.
  await finishSeason(container);
  await click(findButtonByText(container, "Run it back"));
  await flush(6);
  assert(auth._profiles.get(userId).dnf === 0, "starting a fresh draft after finishing one must not record a DNF");
});

const codeOf = (container) => container.querySelector(".seedline code")?.textContent;
const boardOf = (container) => `${container.querySelector(".reel .team")?.textContent} ${container.querySelector(".reel .years")?.textContent}`;
const respinTeam = (container) => [...container.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith("Re-spin team"));

// Regression 3: a draft with no picks yet didn't count as a draft. Looking at the first board, going
// back to Modes and tapping Unlimited again dealt a brand-new draft - a free redo of the first board,
// with the re-spin handed back too - and Reset or switching modes did the same without a DNF.
await runTest("leaving an Unlimited draft before the first pick and coming back resumes the same boards", async () => {
  const { container, auth, userId } = await signedInApp("dnfpeek");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush(3);
  const code = codeOf(container);
  assert(code, "expected an Unlimited draft with a code on screen");
  // Spend the team re-spin first: coming back must not hand it back.
  await click(respinTeam(container));
  await flush(3);
  const board = boardOf(container);
  assert(respinTeam(container).disabled, "expected the team re-spin to be used up");

  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush(3);
  assert(codeOf(container) === code, `expected the same draft back, got code ${codeOf(container)} instead of ${code}`);
  assert(boardOf(container) === board, `expected the same board back, got ${boardOf(container)} instead of ${board}`);
  assert(respinTeam(container).disabled, "a used re-spin must stay used after leaving and coming back");
  assert(auth._profiles.get(userId).dnf === 0, "resuming must not charge a DNF");

  // A reload is no different: the saved draft comes back.
  const storage = window.storage;
  setupDom();
  window.storage = storage;
  window.__ps_supabase__ = auth;
  const reloaded = await mount();
  await flush(3);
  await click(findButtonByText(reloaded.container, "Modes"));
  await flush();
  await click(modeButton(reloaded.container, "Unlimited"));
  await flush(3);
  assert(codeOf(reloaded.container) === code, `expected the same draft after a reload, got code ${codeOf(reloaded.container)} instead of ${code}`);
  assert(boardOf(reloaded.container) === board, "expected the same board after a reload");
  assert(respinTeam(reloaded.container).disabled, "a used re-spin must stay used after a reload");
  assert(auth._profiles.get(userId).dnf === 0, "resuming after a reload must not charge a DNF");
});

await runTest("resetting a draft before the first pick still counts as a DNF", async () => {
  const { container, auth, userId } = await signedInApp("dnfresetzero");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush(3);
  const code = codeOf(container);

  await click(findButtonByText(container, "Reset draft"));
  await flush();
  await click(findButtonByText(container, "Tap again"));
  await flush(6);
  assert(codeOf(container) && codeOf(container) !== code, "expected a fresh draft after the reset");
  assert(auth._profiles.get(userId).dnf === 1, `expected one DNF for resetting a dealt draft, got ${auth._profiles.get(userId).dnf}`);
});

await runTest("switching modes before the first pick counts the dealt draft as a DNF", async () => {
  // Otherwise Unlimited -> GM mode -> Unlimited would be the same free redo by a longer route.
  const { container, auth, userId } = await signedInApp("dnfswitchzero");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush(3);

  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "GM mode"));
  await flush(6);
  assert(text(container).includes("GM mode"), "expected a GM mode draft");
  assert(auth._profiles.get(userId).dnf === 1, `expected one DNF for abandoning the dealt Unlimited draft, got ${auth._profiles.get(userId).dnf}`);
});

await runTest("Play an unlimited draft after the daily resumes the Unlimited draft in progress", async () => {
  // It used to call restart(), which charged a DNF for the draft it threw away.
  const { container, auth, userId } = await signedInApp("dnfafterdaily");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush();
  await draftOne(container);
  const code = codeOf(container);

  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(findButtonByText(container, "Fantasy daily"));
  await flush(3);
  for (let i = 0; i < 6; i++) await draftOne(container);
  await flush(6);
  await finishSeason(container);
  await click(findButtonByText(container, "Run it back"));
  await flush(6);
  assert(codeOf(container) === code, `expected the Unlimited draft in progress back, got code ${codeOf(container)} instead of ${code}`);
  assert(text(container).includes("Pick 2 of 6"), "expected its pick to still be there");
  assert(auth._profiles.get(userId).dnf === 0, `expected no DNF, got ${auth._profiles.get(userId).dnf}`);
});

console.log("test-dnf.mjs done");
