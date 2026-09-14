// Regression test for a real bug: finish() is called synchronously from draft()'s own click
// handler, right after setHistory() - React doesn't land that update in this render's closure
// until after the handler returns, so a naive `history` read inside finish() submits a trace one
// pick short of the real thing (replayDraft correctly rejects it as "wrong shape"). None of the
// other suites caught this because they either exercise submitRun directly (bypassing draft()'s
// real closure) or only assert on locally-computed display state (score/outcome), which finish()
// gets right from its own roster parameter regardless of this bug - only the SUBMITTED TRACE was
// wrong. This test is the one that actually clicks through a full draft in the real UI and checks
// the account's stored profile afterward, the way a real player's session would.
import { setupDom, makeStorage, mount, flush, click, type, findButtonByText, assert, runTest, waitForCrypto, makeMockAuth, clickMode } from "./helpers.mjs";

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
// "Lock in" button (scoped to the card, since a slot might offer more than one fitting player).
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
  await clickMode(container, "Unlimited");
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
  await clickMode(container, "Unlimited");
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

await runTest("a real draft through the UI earns points on the right ladder and into the bank", async () => {
  const before = { ...auth._profiles.get(userId) };
  await click(findButtonByText(container, "Modes"));
  await flush();
  // Back to Fantasy so this doesn't depend on which format the previous test left selected.
  await click([...container.querySelectorAll(".fmtbtn")].find((b) => b.textContent.includes("Fantasy")));
  await flush();
  await clickMode(container, "Unlimited");
  await flush();

  for (let round = 0; round < 6; round++) await draftFirstEligible();
  await flush(6);

  const row = auth._profiles.get(userId);
  const earned = row.points_unlimited - (before.points_unlimited || 0);
  assert(earned !== 0, "expected an Unlimited draft to move the unlimited ladder, it didn't move at all");
  assert(row.points_bank - (before.points_bank || 0) === earned, "the bank should move by the same amount the ladder did");
  assert(row.points_daily === (before.points_daily || 0), "an Unlimited draft must not touch the daily ladder");
  assert(row.points_gm === (before.points_gm || 0), "an Unlimited draft must not touch the GM ladder");

  // The result screen's stat strip shows the same points the server banked, with par beside the
  // team score.
  const cells = [...container.querySelectorAll(".result-hero .strip > div")];
  const ptsCell = cells.find((c) => c.querySelector(".l")?.textContent === "Points");
  assert(ptsCell, "expected a Points cell in the result screen's stat strip, got: " + cells.map((c) => c.textContent).join(" | "));
  const shownPoints = Number(ptsCell.querySelector(".n").textContent.replace(/[^\d-]/g, ""));
  const banked = row.points_bank - (before.points_bank || 0);
  assert(shownPoints === banked, `expected the result screen to show the ${banked} points the server banked, got ${shownPoints}`);
  assert(container.querySelector(".result-hero .strip")?.textContent.includes("par "), "expected the bot's par next to the team score");

  // Today's window is recorded so later drafts can displace this one.
  assert(row.points_day?.byMode?.unlimited?.length >= 1, "expected the draft to be recorded in today's points window");
});

console.log("test-submit-run-integration.mjs done");
