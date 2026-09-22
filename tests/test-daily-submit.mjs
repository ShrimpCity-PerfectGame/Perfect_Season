// Plays a full daily through the real UI, signed in, in each scoring format, and checks it actually
// reaches the server - a run on the profile and a row in daily_runs.
//
// Regression: the Championship daily never saved. The client derived its seed as
// `daily-<date>:std` (it reused the storage-key suffix) while submit-run derives `daily-<date>-std`,
// so the server replayed the draft against different boards and rejected every one as an illegal
// roster. Nothing caught it because the other daily tests either build the trace with the server's
// seed directly or stop before submitting - this one goes from the home screen to the database.
import { setupDom, makeStorage, mount, flush, click, type, findButtonByText, assert, runTest, waitForCrypto, makeMockAuth } from "./helpers.mjs";

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
  return { container, auth, userId: [...auth._profiles.keys()][0] };
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

for (const [label, format] of [["Fantasy", "fantasy"], ["Championship", "standard"]]) {
  await runTest(`a ${label} daily played through the UI is saved to the profile and the daily leaderboard`, async () => {
    const { container, auth, userId } = await signedInApp(`daily${format}`);
    await click(findButtonByText(container, "Modes"));
    await flush();
    await click(findButtonByText(container, `${label} daily`));
    await flush(3);
    for (let i = 0; i < 6; i++) await draftOne(container);
    await flush(8);

    assert(!container.textContent.includes("couldn't be saved"), `the ${label} daily was rejected by the server (save-error banner shown)`);
    const row = auth._profiles.get(userId);
    assert(row.runs === 1, `expected the ${label} daily to count as a run on the profile, got runs=${row.runs}`);
    assert(row.daily_last, `expected the ${label} daily to set the daily streak date, got ${row.daily_last}`);
    const daily = [...auth._dailyRuns.values()].filter((r) => r.user_id === userId);
    assert(daily.length === 1 && daily[0].format === format, `expected one ${format} row in daily_runs, got ${JSON.stringify(daily)}`);
  });
}

await runTest("a daily saved under the old mismatched seed starts fresh instead of resuming into a rejection", async () => {
  // Anyone mid-way through a Championship daily when the seed fix shipped has progress saved against
  // "daily-<date>:std" boards. The server will never accept those, so resuming them would just
  // reproduce the original bug - they have to be treated as no saved draft.
  const { container } = await signedInApp("dailystale");
  const storage = window.storage;
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(findButtonByText(container, "Championship daily"));
  await flush(3);
  await draftOne(container);
  assert(container.textContent.includes("Pick 2 of 6"), "expected one pick made before simulating the stale save");

  // Rewrite every saved snapshot the way the old client would have written it.
  for (const key of (await storage.list("ps-", false)).keys) {
    const raw = await storage.get(key, false);
    const snap = raw && JSON.parse(raw.value);
    if (snap?.mode?.kind === "daily") {
      snap.mode.seed = snap.mode.seed.replace(/-std$/, ":std");
      await storage.set(key, JSON.stringify(snap), false);
    }
  }

  setupDom();
  window.storage = storage;
  window.__ps_supabase__ = makeMockAuth();
  const again = await mount();
  await flush(3);
  await click(findButtonByText(again.container, "Championship daily"));
  await flush(3);
  assert(again.container.textContent.includes("Pick 1 of 6"),
    "a daily saved under the old seed should start fresh, got: " + again.container.textContent.slice(0, 200));
});


// The seed matching its own date only says a saved daily is self-consistent, not that it is today's.
// `ps-draft` holds whatever was last on screen, so an unfinished daily came back the next morning -
// with the Draft tab's dot advertising it and nothing saying whose boards they were. Finishing it
// counted for YESTERDAY, because the server accepts a date within a day of its own (it has to, for
// time zones), so the streak was credited for a day that was never played.
await runTest("yesterday's unfinished daily is not offered today, and does not spend today's daily", async () => {
  const { container } = await signedInApp("dailystale2");
  const storage = window.storage;
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(findButtonByText(container, "Fantasy daily"));
  await flush(3);
  await draftOne(container);
  assert(container.textContent.includes("Pick 2 of 6"), "a pick made before the day rolls over");

  // Age every saved daily by one day, keeping each one internally consistent - seed and date both
  // moved, which is exactly the shape the old check accepted.
  const yesterday = (d) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
  for (const key of (await storage.list("ps-", false)).keys) {
    const raw = await storage.get(key, false);
    const snap = raw && JSON.parse(raw.value);
    if (snap?.mode?.kind !== "daily") continue;
    const was = snap.mode.date;
    snap.mode.date = yesterday(was);
    snap.mode.seed = snap.mode.seed.split(was).join(snap.mode.date);
    const moved = key.includes(was) ? key.split(was).join(snap.mode.date) : key;
    await storage.set(moved, JSON.stringify(snap), false);
    // The day's own slot goes with it, or today still has the pick that was made yesterday.
    if (moved !== key) await storage.delete(key, false);
  }

  setupDom();
  window.storage = storage;
  window.__ps_supabase__ = makeMockAuth();
  const again = await mount();
  await flush(3);
  // Nothing from yesterday on the Draft tab...
  await click(findButtonByText(again.container, "Draft"));
  await flush(2);
  assert(!/Pick [2-6] of 6/.test(again.container.textContent),
    `yesterday's daily is not resumed, got: ${(again.container.textContent.match(/Pick \d of 6/g) || ["nothing"]).join(", ")}`);
  // ...and today's is still there to play, from its first board.
  await click(findButtonByText(again.container, "Modes"));
  await flush(2);
  await click(findButtonByText(again.container, "Fantasy daily"));
  await flush(3);
  assert(again.container.textContent.includes("Pick 1 of 6"),
    `today's daily starts fresh, got: ${(again.container.textContent.match(/Pick \d of 6|See how it went|Let's go/g) || ["nothing"]).join(", ")}`);
});

console.log("test-daily-submit.mjs done");
