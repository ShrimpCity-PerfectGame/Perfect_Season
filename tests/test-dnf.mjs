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
  for (let i = 0; i < 30 && !findButtonByText(container, "Draft a new team"); i++) {
    const skip = findButtonByText(container, "Skip to the result");
    if (skip) { await click(skip); continue; }
    await new Promise((r) => setTimeout(r, 120));
    await flush(1);
  }
  assert(findButtonByText(container, "Draft a new team"), "the season never finished revealing");
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

await runTest("abandoning an Unlimited draft for another mode still costs a DNF", async () => {
  const { container, auth, userId } = await signedInApp("dnfswitch");
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush();
  await draftOne(container);
  assert(text(container).includes("Pick 2 of 6"), "expected one pick made in the Unlimited draft");

  // Go play the Daily, so the live mode is no longer the Unlimited draft...
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(findButtonByText(container, "Fantasy daily"));
  await flush(3);

  // ...then tap Unlimited in the mode bar, which wipes the saved Unlimited draft.
  const unlimitedTab = [...container.querySelectorAll("button.mb")].find((b) => b.textContent === "Unlimited");
  assert(unlimitedTab, "expected an Unlimited button in the in-draft mode bar");
  await click(unlimitedTab);
  await flush(6);

  const row = auth._profiles.get(userId);
  assert(row.dnf === 1, `expected the abandoned Unlimited draft to be charged, got ${row.dnf} DNFs`);
  assert(row.points_unlimited < 0, "the abandoned draft should have cost unlimited-ladder points");
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
  await click(findButtonByText(container, "Draft a new team"));
  await flush(6);
  assert(auth._profiles.get(userId).dnf === 0, "starting a fresh draft after finishing one must not record a DNF");
});

console.log("test-dnf.mjs done");
