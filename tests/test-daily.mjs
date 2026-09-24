// Seeded boards, the daily lock, and challenge codes.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, makeMockAuth, clickMode } from "./helpers.mjs";
import * as GL from "../game-logic.mjs";

function boardOf(container) {
  const team = container.querySelector(".reel .team")?.textContent;
  const years = container.querySelector(".reel .years")?.textContent;
  return `${team} ${years}`;
}
function codeOf(container) {
  return container.querySelector(".seedline code")?.textContent;
}
function seedlineOf(container) {
  return container.querySelector(".seedline")?.textContent;
}
// Mirrors perfect-season.jsx's todayKey(): local calendar date, not UTC (toISOString would
// drift a day off around midnight local time relative to UTC).
function localTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

await runTest("today's daily deals the same board to two independent players", async () => {
  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const a = await mount();
  await flush();
  await click(findButtonByText(a.container, "Fantasy daily"));
  await flush();

  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const b = await mount();
  await flush();
  await click(findButtonByText(b.container, "Fantasy daily"));
  await flush();

  assert(seedlineOf(a.container) && seedlineOf(a.container).includes("same boards for everyone"), "expected the daily seedline, got: " + seedlineOf(a.container));
  assert(seedlineOf(a.container) === seedlineOf(b.container), "expected both players to see the same daily date line");
  assert(boardOf(a.container) === boardOf(b.container), `expected the same team/era board for both players, got "${boardOf(a.container)}" vs "${boardOf(b.container)}"`);
});

await runTest("a finished daily can't be replayed", async () => {
  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  // Seed a completed daily result directly, as if this player already finished today's run.
  const todayKey = localTodayKey();
  await window.storage.set(`ps-daily:${todayKey}`, JSON.stringify({
    date: todayKey, w: 12, l: 5, score: 88.4, outcome: "Made the divisional round",
    roster: [],
  }), false);
  const { container } = await mount();
  await flush();
  const home = text(container);
  assert(home.includes("See how it went"), "expected the home screen to show a finished daily, got: " + home.slice(0, 400));

  await click(findButtonByText(container, "Fantasy daily"));
  await flush();
  assert(text(container).includes("Made the divisional round"), "expected the daily recap instead of a fresh board");
  assert(!text(container).includes("Pick 1 of 6"), "a finished daily should not offer a fresh pick 1");
});

await runTest("each scoring format has its own daily, locked independently", async () => {
  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const todayKey = localTodayKey();
  // Only the Fantasy daily is finished.
  await window.storage.set(`ps-daily:${todayKey}`, JSON.stringify({
    date: todayKey, format: "fantasy", w: 12, l: 5, score: 88.4, outcome: "Made the divisional round", roster: [],
  }), false);
  const { container } = await mount();
  await flush();

  // The Championship daily must still be playable, and must deal a different board than the
  // Fantasy one - otherwise playing one would spoil the other.
  await click(findButtonByText(container, "Championship daily"));
  await flush();
  const champBoard = boardOf(container);
  assert(!text(container).includes("Made the divisional round"), "the Championship daily must not be locked by a finished Fantasy daily");
  assert(seedlineOf(container).includes("Championship"), "expected the Championship daily's mode bar, got: " + seedlineOf(container));

  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const other = await mount();
  await flush();
  await click(findButtonByText(other.container, "Fantasy daily"));
  await flush();
  assert(boardOf(other.container) !== champBoard,
    `expected the two formats' dailies to deal different boards, both dealt "${champBoard}"`);
});

await runTest("a challenge code deals the same board to whoever enters it", async () => {
  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const host = await mount();
  await flush();
  await clickMode(host.container, "Unlimited");
  await flush();
  const code = codeOf(host.container);
  const hostBoard = boardOf(host.container);
  assert(code, "expected a seeded code from the host's unlimited draft");

  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const guest = await mount();
  await flush();
  const codeInput = guest.container.querySelector('input[aria-label="Challenge code"]');
  await type(codeInput, code);
  await flush();
  await click(findButtonByText(guest.container, "Draft it"));
  await flush();

  assert(codeOf(guest.container) === code, "expected the guest's draft to carry the same code");
  assert(boardOf(guest.container) === hostBoard, `expected the same board for the same code, got "${boardOf(guest.container)}" vs "${hostBoard}"`);
});

await runTest("switching to the daily while an Unlimited reel is still spinning keeps the daily's own board", async () => {
  // restoreDraft used to leave the other draft's reel interval running: it finished by setting that
  // draft's next board as the daily's, which was then saved - and the daily failed server replay.
  setupDom();
  // Real reel animation this time (the test DOM normally reports reduced motion, which skips it).
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return true; } });
  const storage = makeStorage();
  window.storage = storage;
  window.__ps_supabase__ = makeMockAuth();
  const { container } = await mount();
  await flush();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // A new draft shows no reel or cards until its first spin frame, so wait for cards as well as the spin.
  const settle = async () => { for (let i = 0; i < 40 && (container.querySelector(".reel.spin") || !container.querySelector(".card")); i++) { await sleep(100); await flush(1); } await flush(2); };
  const pickFirst = async () => {
    const card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off"));
    await click(card.querySelector("button.hit"));
    await flush();
    await click(card.querySelector(".drafts button.btn.solid"));
    await flush();
  };
  const pill = (label) => [...container.querySelectorAll("button.mb")].find((b) => b.textContent.startsWith(label));

  await click(findButtonByText(container, "Fantasy daily"));
  await flush();
  await settle();
  await pickFirst();
  await settle();
  await click(pill("Unlimited"));
  await flush();
  await settle();
  await pickFirst();
  assert(container.querySelector(".reel.spin"), "test setup: the reel should still be spinning after the Unlimited pick");
  await click(pill("Daily"));
  await flush();
  await sleep(1300);
  await flush(3);

  const key = Object.keys(storage.data).find((k) => k.includes("ps-daily-wip"));
  const snap = JSON.parse(storage.data[key]);
  assert(snap.seq[snap.seqIdx] === `${snap.spin.team}|${snap.spin.w}`, `the daily's saved board must be its own, got ${snap.spin.team}|${snap.spin.w} for ${snap.seq[snap.seqIdx]}`);
});

await runTest("a code that is the daily's own seed is refused before any boards are dealt", async () => {
  // The daily's protection was entirely server-side, and the attack needed no server: finish() computes the
  // whole season in the browser, and a signed-out player never submits at all - so a code that hashes like
  // today's daily seed dealt today's daily, bit for bit, and nothing was ever consulted about it. submit-run
  // refusing to RECORD one is not the same as refusing to DEAL one.
  //
  // It cannot be closed completely: the bundle is public and the game is seeded, so anyone willing to run
  // game-logic.mjs offline can deal any board they like. What this closes is the in-app version - the one an
  // ordinary player would ever find - and that is the honest claim.
  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const { container } = await mount();
  await flush();

  // Found the way anyone would: hashStr is FNV-1a/32 and invertible.
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const PRIME = 16777619;
  let inv = 1;
  for (let i = 0; i < 6; i++) inv = Math.imul(inv, 2 - Math.imul(PRIME, inv));
  const step = (h, c) => Math.imul(h ^ c, PRIME) >>> 0;
  const unstep = (h, c) => ((Math.imul(h, inv) >>> 0) ^ c) >>> 0;
  const seed = GL.dailySeed(new Date().toISOString().slice(0, 10), "fantasy");
  const target = GL.hashStr(seed);
  const fwd = new Map();
  for (const a of A) for (const b of A) for (const c of A) for (const e of A) {
    let h = 2166136261 >>> 0;
    for (const ch of [a, b, c, e]) h = step(h, ch.charCodeAt(0));
    if (!fwd.has(h)) fwd.set(h, a + b + c + e);
  }
  let forged = null;
  outer:
  for (const a of A) for (const b of A) for (const c of A) for (const e of A) {
    let h = target;
    for (const ch of [e, c, b, a]) h = unstep(h, ch.charCodeAt(0));
    const pre = fwd.get(h);
    if (pre) { forged = pre + a + b + c + e; break outer; }
  }
  assert(forged && GL.hashStr(forged) === target, `a forged code exists: ${forged}`);
  assert(JSON.stringify(GL.seededSequence(forged)) === JSON.stringify(GL.seededSequence(seed)),
    "and it deals the daily's own boards - which is what it is for");

  const box = container.querySelector('input[aria-label="Challenge code"]');
  await type(box, forged);
  await flush();
  await click(findButtonByText(container, "Draft it"));
  await flush(3);
  assert(!container.querySelector(".seedline"), `no draft was dealt: ${container.querySelector(".seedline")?.textContent}`);
  assert(/reserved/i.test(text(container)), `and it says why: ${text(container).slice(0, 300)}`);

  // An ordinary code still works, or the guard would have refused the feature rather than the attack.
  await type(box, "K3F9QZ");
  await flush();
  await click(findButtonByText(container, "Draft it"));
  await flush(4);
  assert(container.querySelector(".seedline")?.textContent?.includes("K3F9QZ"), "an ordinary code still deals its boards");
});

console.log("test-daily.mjs done");
