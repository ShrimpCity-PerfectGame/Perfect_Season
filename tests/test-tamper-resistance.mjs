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

console.log("test-tamper-resistance.mjs done");
