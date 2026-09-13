// End-to-end proof that a tampered submission is rejected and never lands in profiles - not just
// that replayDraft() itself rejects bad input (see test-replay-verification.mjs for that), but
// that the whole submit-run path (as exercised through storage.js's submitRun, same as finish()
// calls) refuses to write anything for a fabricated score/roster, and that a legitimate
// submission for the same account still succeeds afterward.
import { setupDom, makeStorage, mount, flush, click, type, findButtonByText, assert, runTest, waitForCrypto, makeMockAuth } from "./helpers.mjs";
import { submitRun } from "../storage.js";

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
await type(emailInput, "tamperguard@example.com");
await type(uInput, "tamperguard");
await type(pInput, "Password1");
await type(p2Input, "Password1");
await click([...container.querySelector(".panel").querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
await waitForCrypto();

const userId = [...auth._profiles.keys()][0];
assert(userId, "expected a profile to exist after signup");

await runTest("a fabricated score/roster is rejected and never reaches profiles", async () => {
  const before = { ...auth._profiles.get(userId) };
  const res = await submitRun({
    mode: { kind: "free", code: "FAKECODE" },
    history: [
      { key: "KC|3", id: 999999, season: 2020, slot: "QB" }, // a player id that exists nowhere
      { key: "KC|3", id: 999998, season: 2020, slot: "RB" },
      { key: "KC|3", id: 999997, season: 2020, slot: "WR" },
      { key: "KC|3", id: 999996, season: 2020, slot: "TE" },
      { key: "KC|3", id: 999995, season: 2020, slot: "FLEX1" },
      { key: "KC|3", id: 999994, season: 2020, slot: "FLEX2" },
    ],
    seq: ["KC|3"],
    gm: false,
  });
  assert(!res.ok, "expected the fabricated submission to be rejected, got: " + JSON.stringify(res));
  const after = auth._profiles.get(userId);
  assert(after.runs === before.runs && after.best_score === before.best_score, "a rejected submission must not change the stored profile at all");
});

await runTest("a legitimate submission for the same account still succeeds afterward", async () => {
  // Build a real, legal draft trace the same way the client would, using the actual board data.
  const gl = await import("../game-logic.mjs");
  const { readFileSync } = await import("node:fs");
  const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
  // game-logic.mjs in this process is a separate instance from the one storage.js's mock uses
  // internally, but both are initialized from the same data, so they agree on BOARDS/OPPS.
  gl.initGameData(data.players, data.opponents);

  const seed = "TAMPERGUARD-LEGIT";
  const seq = gl.seededSequence(seed);
  const roster = {}; const drafted = new Set(); const history = [];
  let seqIdx = gl.boardAt(seq, 0, roster);
  for (const slot of gl.SLOTS) {
    const key = seq[seqIdx];
    const open = gl.SLOTS.filter((s) => !roster[s]);
    const player = gl.BOARDS[key].find((p) => !drafted.has(p.id) && open.some((s) => gl.fits(p.pos, s)));
    const pickedSlot = open.find((s) => gl.fits(player.pos, s));
    history.push({ key, id: player.id, season: player.season, slot: pickedSlot });
    roster[pickedSlot] = player; drafted.add(player.id);
    if (history.length < gl.SLOTS.length) seqIdx = gl.boardAt(seq, seqIdx + 1, roster);
  }

  const res = await submitRun({ mode: { kind: "free", code: seed }, history, seq, gm: false });
  assert(res.ok, "expected a legitimately replayable draft to be accepted, got: " + JSON.stringify(res));
  const after = auth._profiles.get(userId);
  assert(after.runs === 1, "expected the legitimate run to actually be recorded, got runs=" + after.runs);
});

// Builds a real, legal draft trace the same way the client would - shared by the tests below.
async function buildLegitTrace(seed, extra = {}) {
  const gl = await import("../game-logic.mjs");
  const { readFileSync } = await import("node:fs");
  const data = JSON.parse(readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
  gl.initGameData(data.players, data.opponents);
  const seq = gl.seededSequence(seed);
  const roster = {}; const drafted = new Set(); const history = [];
  let seqIdx = gl.boardAt(seq, 0, roster);
  for (const slot of gl.SLOTS) {
    const key = seq[seqIdx];
    const open = gl.SLOTS.filter((s) => !roster[s]);
    const player = gl.BOARDS[key].find((p) => !drafted.has(p.id) && open.some((s) => gl.fits(p.pos, s)));
    const pickedSlot = open.find((s) => gl.fits(player.pos, s));
    history.push({ key, id: player.id, season: player.season, slot: pickedSlot });
    roster[pickedSlot] = player; drafted.add(player.id);
    if (history.length < gl.SLOTS.length) seqIdx = gl.boardAt(seq, seqIdx + 1, roster);
  }
  return { history, seq, roster, gl, ...extra };
}
const utcDateKeyOffset = (days) => {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

await runTest("a daily submission for the server's UTC yesterday/tomorrow is accepted (real player timezones), but an old backdated claim is rejected", async () => {
  for (const offset of [-1, 0, 1]) {
    const date = utcDateKeyOffset(offset);
    const { history, seq } = await buildLegitTrace(`daily-${date}`);
    const res = await submitRun({ mode: { kind: "daily", date }, history, seq, gm: false });
    assert(res.ok, `expected a daily submission for UTC offset ${offset} (${date}) to be accepted - a real player's local "today" can legitimately be the server's UTC yesterday or tomorrow, got: ` + JSON.stringify(res));
  }

  const oldDate = utcDateKeyOffset(-30);
  const { history, seq } = await buildLegitTrace(`daily-${oldDate}`);
  const res = await submitRun({ mode: { kind: "daily", date: oldDate }, history, seq, gm: false });
  assert(!res.ok, "expected a daily submission backdated a month is still rejected, got: " + JSON.stringify(res));
});

await runTest("a fabricated capUsed is ignored - the server recomputes it from the verified roster", async () => {
  const { history, seq, roster, gl } = await buildLegitTrace("GMCAPGUARD");
  const res = await submitRun({ mode: { kind: "free", code: "GMCAPGUARD", gm: true }, history, seq, gm: true, capUsed: 1 });
  assert(res.ok, "expected a legitimate GM-mode submission to be accepted, got: " + JSON.stringify(res));
  const trueCapUsed = gl.SLOTS.reduce((sum, s) => sum + gl.playerSalary(roster[s]), 0);
  assert(res.run.capUsed === trueCapUsed, `expected the server to ignore the fabricated capUsed:1 and report the true cost (${trueCapUsed}), got: ` + res.run.capUsed);
});

await runTest("an unrecognized scoring format is rejected outright", async () => {
  const { history, seq } = await buildLegitTrace("BOGUSFORMAT");
  for (const format of ["championship", "STANDARD", "ppr", 7, true]) {
    const res = await submitRun({ mode: { kind: "free", code: "BOGUSFORMAT" }, history, seq, gm: false, format });
    assert(!res.ok, `expected format ${JSON.stringify(format)} to be rejected, got: ` + JSON.stringify(res));
  }
  // ...but an absent format is fine, and means fantasy - this is what keeps a client from before
  // the feature shipped working during a deploy.
  const res = await submitRun({ mode: { kind: "free", code: "BOGUSFORMAT" }, history, seq, gm: false });
  assert(res.ok, "expected a submission with no format at all to be accepted as fantasy, got: " + JSON.stringify(res));
  assert(res.run.format === "fantasy", "expected an untagged submission to be stamped fantasy, got " + res.run.format);
});

await runTest("the server derives the daily seed from the format - a standard claim on a fantasy-seeded draft is rejected", async () => {
  const date = utcDateKeyOffset(0);
  // Drafted against the FANTASY daily's boards, then submitted claiming the standard format.
  // The server re-derives seed `daily-<date>-std`, whose boards are different, so the replay fails.
  const { history, seq } = await buildLegitTrace(`daily-${date}`);
  const res = await submitRun({ mode: { kind: "daily", date }, history, seq, gm: false, format: "standard" });
  assert(!res.ok, "expected a format/seed mismatch to be rejected, got: " + JSON.stringify(res));
  assert(res.error === "illegal roster", "expected the replay itself to reject it, got: " + JSON.stringify(res));
});

await runTest("both formats' dailies can be played the same day, and each stays one-per-day", async () => {
  const date = utcDateKeyOffset(0);
  // This account already played today's fantasy daily in an earlier test above; submit it again
  // to make that true regardless of test order, and to prove the fantasy lock still holds.
  const fan = await buildLegitTrace(`daily-${date}`);
  await submitRun({ mode: { kind: "daily", date }, history: fan.history, seq: fan.seq, gm: false, format: "fantasy" });
  const fanAgain = await submitRun({ mode: { kind: "daily", date }, history: fan.history, seq: fan.seq, gm: false, format: "fantasy" });
  assert(!fanAgain.ok, "expected the fantasy daily to stay locked to one per day, got: " + JSON.stringify(fanAgain));

  // The standard daily is a separate draft and must still be available the same day - a shared
  // (date, user_id) key would have rejected this.
  const std = await buildLegitTrace(`daily-${date}-std`);
  const b = await submitRun({ mode: { kind: "daily", date }, history: std.history, seq: std.seq, gm: false, format: "standard" });
  assert(b.ok, "expected the standard daily to be playable the same day as the fantasy one, got: " + JSON.stringify(b));

  // ...and it gets its own one-per-day lock.
  const again = await submitRun({ mode: { kind: "daily", date }, history: std.history, seq: std.seq, gm: false, format: "standard" });
  assert(!again.ok, "expected a second standard daily for the same date to be rejected, got: " + JSON.stringify(again));
});

await runTest("a standard-format run never lands in the fantasy best score", async () => {
  const before = { ...auth._profiles.get(userId) };
  const { history, seq } = await buildLegitTrace("STDONLY");
  const res = await submitRun({ mode: { kind: "free", code: "STDONLY" }, history, seq, gm: false, format: "standard" });
  assert(res.ok, "expected a legitimate standard run to be accepted, got: " + JSON.stringify(res));

  const after = auth._profiles.get(userId);
  assert(after.best_score === before.best_score, "a standard run must not touch best_score");
  assert(after.best_score_std === res.run.score, `expected best_score_std to hold the standard run's score, got ${after.best_score_std}`);
  // Career counters are deliberately shared across formats.
  assert(after.runs === before.runs + 1, "the run should still count toward career totals");
});

console.log("test-tamper-resistance.mjs done");
