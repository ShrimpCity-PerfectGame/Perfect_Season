// Regression test for a real bug: finish() is called synchronously from draft()'s own click
// handler, right after setHistory() - React doesn't land that update in this render's closure
// until after the handler returns, so a naive `history` read inside finish() submits a trace one
// pick short of the real thing (replayDraft correctly rejects it as "wrong shape"). None of the
// other suites caught this because they either exercise submitRun directly (bypassing draft()'s
// real closure) or only assert on locally-computed display state (score/outcome), which finish()
// gets right from its own roster parameter regardless of this bug - only the SUBMITTED TRACE was
// wrong. This test is the one that actually clicks through a full draft in the real UI and checks
// the account's stored profile afterward, the way a real player's session would.
import { setupDom, makeStorage, mount, flush, click, type, findButtonByText, assert, runTest, waitForCrypto, makeMockAuth } from "./helpers.mjs";

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
const [emailInput, uInput, pInput, p2Input] = [...container.querySelector(".panel").querySelectorAll("input")];
await type(emailInput, "uiflow@example.com");
await type(uInput, "uiflow");
await type(pInput, "Password1");
await type(p2Input, "Password1");
await click([...container.querySelector(".panel").querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
await waitForCrypto();

const userId = [...auth._profiles.keys()][0];

// Mirrors test-reroll-pool.mjs's draftFirstEligible: click a card to select it, then its own
// "Draft to X" button (scoped to the card, since a slot might offer more than one fitting player).
async function draftFirstEligible() {
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

await runTest("completing a real draft by clicking through the UI actually persists via submit-run", async () => {
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(findButtonByText(container, "Start a draft"));
  await flush();

  for (let round = 0; round < 6; round++) await draftFirstEligible();

  // The result screen should render regardless (it's computed from the roster parameter, not
  // the buggy trace) - the real bug only showed up in what got submitted, not what got displayed.
  assert(container.textContent.includes("Team score"), "expected the result screen to render after the 6th pick");

  await flush(6); // let the async submitRun -> fetchProfile round trip settle
  const row = auth._profiles.get(userId);
  assert(row.runs === 1, "expected the real draft to be recorded as a finished run, got runs=" + row.runs);
  assert(row.best_score != null, "expected a best_score to be recorded, got: " + row.best_score);
  assert(!container.textContent.includes("couldn't be saved"), "expected no save-error banner for a legitimate draft, got: " + container.textContent.slice(0, 300));
});

await runTest("a Championship draft clicked through the real UI persists to the standard column only", async () => {
  const before = { ...auth._profiles.get(userId) };
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click([...container.querySelectorAll(".fmtbtn")].find((b) => b.textContent.includes("Championship")));
  await flush();
  await click(findButtonByText(container, "Start a draft"));
  await flush();

  for (let round = 0; round < 6; round++) await draftFirstEligible();
  assert(container.textContent.includes("Team score"), "expected the result screen to render after the 6th pick");

  await flush(6);
  const row = auth._profiles.get(userId);
  assert(row.runs === before.runs + 1, "expected the Championship draft to count as a finished run, got runs=" + row.runs);
  assert(row.best_score_std != null, "expected a standard-format best score to be recorded, got: " + row.best_score_std);
  assert(row.best_score === before.best_score, "a Championship run must not touch the Fantasy best score");
  assert(!container.textContent.includes("couldn't be saved"), "expected no save-error banner, got: " + container.textContent.slice(0, 300));
});

console.log("test-submit-run-integration.mjs done");
