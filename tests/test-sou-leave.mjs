// Over/Under can't be gamed by leaving and coming back: an answered round is never dealt again,
// and walking away while the clock runs costs that round's life. Both used to be exploitable - the
// saved progress pointed at the round just answered (answer it again for another point), and
// leaving through the nav left the round, and its timer, running in the background.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth, clickMode,
} from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
window.__ps_supabase__ = makeMockAuth();
const { container } = await mount();
await flush();
await click(findButtonByText(container, "Got it, let's draft"));

const progress = () => {
  const key = Object.keys(window.storage.data).find((k) => k.startsWith("personal:ps-sou-wip:"));
  return key ? JSON.parse(window.storage.data[key]) : null;
};
const openSou = async () => {
  await clickMode(container, "Over/Under");
  await flush(4);
};

// Progress right after answering round 0 - the baseline the later checks count from.
let afterAnswer = null;

await runTest("an answered round is never dealt again after leaving", async () => {
  await openSou();
  await click(findButtonByText(container, "I'm ready - start the clock"));
  await flush();
  // Dealing a round saves it as ALREADY MISSED, and that is a different writer from the one that records
  // an answer - so it needs the owner stamp of its own. Checked here because a mutation that dropped the
  // stamp from this path alone passed every other test in the file: the later checks all read what the
  // ANSWER path wrote, which still had it.
  assert("owner" in (progress() || {}), `a dealt round records who is playing: ${JSON.stringify(progress())}`);
  const panel = container.querySelector(".panel");
  await click(findButtonByText(panel, "Over"));
  await flush(3);
  assert(/Correct!|Wrong\./.test(panel.textContent), "expected a reveal after guessing");
  afterAnswer = progress();
  assert(afterAnswer?.roundIndex === 1, "expected progress to point at the next round (1), got " + JSON.stringify(afterAnswer));

  await click(findButtonByText(container, "Back to modes"));
  await flush();
  await openSou();
  assert(findButtonByText(container, "Resume - start the clock"), "expected a resume prompt");
  const scoreBefore = afterAnswer.score;
  await click(findButtonByText(container, "Resume - start the clock"));
  await flush();
  assert(text(container).includes(`Score ${scoreBefore}`), `expected the score carried over (${scoreBefore}), got: ` + container.querySelector(".sou-hud")?.textContent);
});

await runTest("a round in progress is already saved as missed, so a reload can't re-deal it", async () => {
  // Round 1 is on screen (resumed above). Saved progress already points past it, a life down, so
  // closing or reloading the page mid-round is no better than letting the clock run out.
  const now = progress();
  assert(container.querySelector(".sou-timer"), "expected a round in progress");
  assert(now.roundIndex === afterAnswer.roundIndex + 1 && now.lives === afterAnswer.lives - 1,
    `expected round ${afterAnswer.roundIndex} to be saved as missed while it plays, got ${JSON.stringify(afterAnswer)} -> ${JSON.stringify(now)}`);
});

await runTest("leaving through the nav mid-round costs that round and stops the clock", async () => {
  const before = afterAnswer;
  await click(findButtonByText(container, "Modes"));
  await flush(3);
  const after = progress();
  assert(after && after.roundIndex === before.roundIndex + 1, `expected the abandoned round to be skipped, got ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
  assert(after.lives === before.lives - 1, `expected the abandoned round to cost a life, got lives ${before.lives} -> ${after.lives}`);

  // Nothing keeps ticking on another screen: the saved state stays put after the round's 7 seconds.
  await new Promise((r) => setTimeout(r, 400));
  await flush(2);
  assert(JSON.stringify(progress()) === JSON.stringify(after), "the Over/Under round must not keep running after leaving");
  assert(!container.querySelector(".sou-timer"), "no Over/Under round should be on screen after leaving");

  await openSou();
  assert(findButtonByText(container, "Resume - start the clock"), "coming back offers to resume at the next round, not the abandoned one");
});

await runTest("leaving by any route - even the header's Log in link - cleans up the round", async () => {
  await click(findButtonByText(container, "Resume - start the clock"));
  await flush();
  assert(container.querySelector(".sou-timer"), "expected a round in progress");
  const logIn = [...container.querySelectorAll(".hdr-links button")].find((b) => b.textContent === "Log in");
  assert(logIn, "expected the guest header's Log in link");
  await click(logIn);
  await flush(3);
  await click(findButtonByText(container, "Modes"));
  await flush();
  await openSou();
  const headings = [...container.querySelectorAll("h1.h, h2.h")].filter((h) => h.textContent === "Over/Under").length;
  assert(headings === 1, "expected just the resume screen, not the rules stacked on a stale round, got " + headings + " Over/Under headings");
  assert(!container.querySelector(".sou-answers"), "no stale round's answer buttons should be on screen");
});

await runTest("a round in progress belonging to another account is never resumed", async () => {
  // The slot is keyed by DATE alone - `ps-sou-wip:<date>`, no account in it - so before v2.21.3 the next
  // person on a shared browser inherited the last one's game. Alice uses a life and scores 5, closes the
  // tab; Bob signs up, opens Over/Under, and starts at her round with her lives and her score, which then
  // posts as HIS day. The DONE half of that leak was closed in v2.18.11 by asking sou_runs first - openSou
  // explicitly discards the device record when the server says this account has not played - but the round
  // in progress beside it was read unconditionally, so clearing `souDone` only sent Bob one line further
  // down to inherit her game instead.
  const key = Object.keys(window.storage.data).find((k) => k.startsWith("personal:ps-sou-wip:"));
  assert(key, "a round in progress is on the device to work with");

  // The STAMP: whatever the screen wrote has to say who wrote it, or the check below compares against
  // nothing and every snapshot reads as a stranger's. Signed out here, so the owner is null - which is a
  // value, not an absence, and is exactly what distinguishes it from a pre-v2.21.3 snapshot.
  const written = JSON.parse(window.storage.data[key]);
  assert("owner" in written, `the saved round records who is playing: ${JSON.stringify(written)}`);
  assert(written.owner === null, `signed out, that is null: ${written.owner}`);

  // Somebody else's round must not be offered back.
  window.storage.data[key] = JSON.stringify({ ...written, owner: "00000000-0000-4000-8000-00000000dead" });
  await click(findButtonByText(container, "Modes"));
  await flush();
  await openSou();
  assert(!findButtonByText(container, "Resume - start the clock"),
    "another account's round is not offered for resuming");
  assert(findButtonByText(container, "I'm ready - start the clock"),
    "and a fresh day is offered instead");

  // ...and so must one written before the stamp existed, which carries no owner at all.
  window.storage.data[key] = JSON.stringify({ roundIndex: 4, lives: 1, score: 3 });
  await click(findButtonByText(container, "Modes"));
  await flush();
  await openSou();
  assert(!findButtonByText(container, "Resume - start the clock"),
    "a legacy round with no owner is not resumed either");
});

console.log("test-sou-leave.mjs done");
