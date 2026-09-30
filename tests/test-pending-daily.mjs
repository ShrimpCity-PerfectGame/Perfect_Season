// pending-daily.mjs: the re-send for a daily that was played but never recorded.
//
// This is the module that decides whether a run the device is still holding gets another go at the
// board. Two things make it dangerous and are what most of this file is about: it must never let a
// held run become a BETTER run than the one that was played, and it must never hold one for ever.
//
//   node tests/test-pending-daily.mjs
import { assert, runTest } from "./helpers.mjs";
import { drainOne, sendOnce, _resetPending } from "../pending-daily.mjs";
import { GUESS_RETRY } from "../storage-guess.js";

const DAY = "2026-09-30";
// The real list, not a copy of it. Held as a local copy until v2.18.2, which meant this file could go on
// passing while the list the app actually drains with said something else - and what a reason is called
// is the whole of what this module does. tests/test-submit-reasons.mjs covers the other half of the seam:
// which failure gets which name in the first place.
const RETRY = GUESS_RETRY;

// A store that behaves the way window.storage does: everything swallowed, nothing guaranteed.
function harness({ rec, answers }) {
  const state = { rec: rec ? { ...rec } : null, sent: [], keeps: [], dropped: false };
  let i = 0;
  return {
    state,
    run: () => drainOne({
      key: "k", rec: state.rec, day: DAY, retry: RETRY,
      submit: async (r) => { state.sent.push(JSON.parse(JSON.stringify(r))); return answers[Math.min(i++, answers.length - 1)]; },
      keep: async (next) => { state.rec = next; state.keeps.push(next); },
      drop: async () => { state.rec = null; state.dropped = true; },
    }),
  };
}

const owed = { day: DAY, solved: true, tries: 4, guesses: ["a", "b", "c", "d"], saved: false };

await runTest("a run that is owed is re-sent, and stops being owed once it lands", async () => {
  _resetPending();
  const h = harness({ rec: owed, answers: [{ ok: true, solved: true, tries: 4 }] });
  assert(await h.run() === "sent", "it reports sending");
  assert(h.state.sent.length === 1, `one request: ${h.state.sent.length}`);
  assert(h.state.rec.saved === true, "and the record settles");
  // Settled means a second drain does nothing at all - this is what stops a successful run being
  // re-posted on every focus for the rest of the day.
  const again = harness({ rec: h.state.rec, answers: [{ ok: true }] });
  assert(await again.run() === "skipped", "a settled record is not sent again");
  assert(again.state.sent.length === 0, "and makes no request");
});

await runTest("the payload is the record, verbatim - a drain cannot improve on the game that was played", async () => {
  _resetPending();
  const h = harness({ rec: owed, answers: [{ ok: true }] });
  await h.run();
  assert(JSON.stringify(h.state.sent[0].guesses) === JSON.stringify(owed.guesses),
    `the guesses go as they were stored: ${JSON.stringify(h.state.sent[0].guesses)}`);
  assert(h.state.sent[0].day === DAY, "under the day they were played on");
});

await runTest("a transport failure is held; the server's verdict is not", async () => {
  for (const reason of RETRY) {
    _resetPending();
    const h = harness({ rec: owed, answers: [{ ok: false, reason }] });
    assert(await h.run() === "held", `${reason} is retried`);
    assert(h.state.rec.saved === false, `${reason} leaves the run owed`);
  }
  // Everything else is an answer about the run itself, and re-sending cannot change it. Holding one of
  // these for ever would be a record that never settles and a request on every single focus.
  for (const reason of ["wrong_day", "guest_daily", "bad_code", "repeat_guess", "short_loss", "network", undefined]) {
    _resetPending();
    const h = harness({ rec: owed, answers: [{ ok: false, reason }] });
    assert(await h.run() === "retired", `${reason} is not retried`);
    assert(h.state.rec.saved === true && h.state.rec.unrecorded === true,
      `${reason} settles the record as unrecorded: ${JSON.stringify(h.state.rec)}`);
  }
});

await runTest("`network` is NOT retried, because it means a reason this client does not know", async () => {
  // storage-guess.js answers "network" when a reason came back that is not on GUESS_REFUSALS - which can
  // only be a newer function's rule. Retrying it would re-send a verdict on every focus until midnight
  // and could never change the answer.
  //
  // It used to answer "network" for two more things: a body carrying no reason at all, and a 200 that was
  // not `{ ok: true }`. Neither is a verdict - the function names a reason on every answer it gives - and
  // retiring a played daily on one of them is how a solved run was lost on production on 2026-09-30.
  // Since v2.18.2 those are "server" and are held. The rule did not change; what reaches it did.
  _resetPending();
  const h = harness({ rec: owed, answers: [{ ok: false, reason: "network" }, { ok: true }] });
  assert(await h.run() === "retired", "an unknown answer retires");
  assert(h.state.sent.length === 1, "and is asked exactly once");
});

await runTest("a duplicate means the row is already in, so nothing is owed", async () => {
  _resetPending();
  const h = harness({ rec: owed, answers: [{ ok: false, reason: "duplicate" }] });
  assert(await h.run() === "sent", "duplicate settles the record");
  assert(h.state.rec.saved === true && !h.state.rec.unrecorded, "as recorded, not as lost");
});

await runTest("a held run is bound to its own day, and is dropped once that day has passed", async () => {
  _resetPending();
  const stale = { ...owed, day: "2026-09-29" };
  const h = harness({ rec: stale, answers: [{ ok: true }] });
  assert(await h.run() === "retired", "yesterday's run is not sent today");
  assert(h.state.sent.length === 0, "nothing is posted");
  assert(h.state.dropped === true, "and the record is forgotten rather than kept for ever");
  // A record with no day at all cannot be filed against anything.
  _resetPending();
  const noDay = harness({ rec: { ...owed, day: null }, answers: [{ ok: true }] });
  assert(await noDay.run() === "retired" && noDay.state.sent.length === 0, "a dayless record is dropped unsent");
});

await runTest("two drains cannot put the same run on the wire twice", async () => {
  _resetPending();
  let inFlight = 0, most = 0;
  const rec = { ...owed };
  const one = () => drainOne({
    key: "same", rec, day: DAY, retry: RETRY,
    submit: async () => {
      inFlight++; most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { ok: true };
    },
    keep: async () => {}, drop: async () => {},
  });
  const [a, b] = await Promise.all([one(), one()]);
  assert(most === 1, `only one request is ever in the air: ${most}`);
  assert([a, b].filter((x) => x === "sent").length === 1, `one sends, the other stands down: ${a}/${b}`);
  assert([a, b].includes("skipped"), "and says so");
});

await runTest("the lock is released, so a later drain is not wedged by an earlier one", async () => {
  _resetPending();
  const h = harness({ rec: owed, answers: [{ ok: false, reason: "offline" }] });
  assert(await h.run() === "held", "the first is held");
  const again = harness({ rec: h.state.rec, answers: [{ ok: true }] });
  assert(await again.run() === "sent", "and the next one gets through");
});

await runTest("a drain that throws is a drain that did not happen, not an answer", async () => {
  _resetPending();
  let kept = null;
  const r = await drainOne({
    key: "boom", rec: { ...owed }, day: DAY, retry: RETRY,
    submit: async () => { throw new Error("network went away mid-request"); },
    keep: async (n) => { kept = n; }, drop: async () => {},
  });
  assert(r === "held", `a thrown submit holds: ${r}`);
  assert(kept === null, "and settles nothing");
});

await runTest("sendOnce shares the lock, so finish() and a drain cannot both post", async () => {
  _resetPending();
  let calls = 0;
  const slow = () => sendOnce("shared", async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return { ok: true };
  });
  const [a, b] = await Promise.all([slow(), slow()]);
  assert(calls === 1, `one call: ${calls}`);
  assert([a, b].some((x) => x && x.reason === "in_flight"), "the loser is told why rather than silently dropped");
});

console.log("test-pending-daily.mjs done");
