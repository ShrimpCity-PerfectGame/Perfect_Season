// Seeded boards, the daily lock, and challenge codes.
import { setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, makeMockAuth } from "./helpers.mjs";

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
  await click(findButtonByText(a.container, "Play today's daily"));
  await flush();

  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const b = await mount();
  await flush();
  await click(findButtonByText(b.container, "Play today's daily"));
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
  assert(home.includes("See today's result"), "expected the home screen to show a finished daily, got: " + home.slice(0, 400));
  assert(!home.includes("Play today's daily"), "expected the play prompt to be gone once the daily is done");

  await click(findButtonByText(container, "See today's result"));
  await flush();
  assert(text(container).includes("Made the divisional round"), "expected the daily recap instead of a fresh board");
  assert(!text(container).includes("Pick 1 of 6"), "a finished daily should not offer a fresh pick 1");
});

await runTest("a challenge code deals the same board to whoever enters it", async () => {
  setupDom();
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const host = await mount();
  await flush();
  await click(findButtonByText(host.container, "Start a draft"));
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

console.log("test-daily.mjs done");
