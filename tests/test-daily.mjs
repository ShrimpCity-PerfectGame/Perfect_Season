// Seeded boards, the daily lock, and challenge codes.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, makeMockAuth, clickMode } from "./helpers.mjs";

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

console.log("test-daily.mjs done");
