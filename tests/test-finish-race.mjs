// Finishing a season and immediately doing the next thing must not charge you for the season you
// just finished, or hand it back as a draft in progress.
//
// `finish()` fires `clearDraftTracked("free", FREE_PROGRESS)` and does not wait for it - the storage
// shim has no read-after-write ordering guarantee (CLAUDE.md), so a read that starts afterwards can
// still resolve first and return the snapshot of the draft that has just ended. `pendingClears`
// exists for exactly this and has guarded `refreshWip` since the "5 of 6 picked" bug; the four other
// readers of that slot - `abandonCurrent`, `resumeFree`, `playUnlimited` and `openFree` - trusted
// their read, and all four are reached by the same tap.
//
// test-wip-race.mjs covers the original door (Modes -> the home screen's in-progress count). This
// covers the ones that write to the player's record.
import {
  setupDom, makeStorage, mount, flush, click, type, findButtonByText, assert, runTest, makeMockAuth,
} from "./helpers.mjs";

const CLEAR_DELAY = 300;
const modeButton = (c, name) => [...c.querySelectorAll(".mode .mn")].find((e) => e.textContent === name)?.closest("button");

async function signUp(container, username) {
  await click(findButtonByText(container, "Account"));
  await flush();
  const panel = () => container.querySelector(".panel");
  await click(findButtonByText(panel(), "Create account"));
  await flush();
  const [email, u, p, p2] = [...panel().querySelectorAll("input")];
  await type(email, `${username}@example.com`);
  await type(u, username);
  await type(p, "Password1");
  await type(p2, "Password1");
  await click([...panel().querySelectorAll("button")]
    .find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await flush();
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

// The season reveal is animated and "Run it back" only appears at the end of it.
async function watchTheSeason(container) {
  for (let i = 0; i < 40 && !findButtonByText(container, "Run it back"); i++) {
    const skip = findButtonByText(container, "Skip to the end");
    if (skip) { await click(skip); continue; }
    await new Promise((r) => setTimeout(r, 60));
    await flush(1);
  }
}

async function aFinishedSeason(username) {
  setupDom();
  window.storage = makeStorage(["ps-free-wip"], CLEAR_DELAY);
  const auth = makeMockAuth();
  window.__ps_supabase__ = auth;
  const { container } = await mount();
  await flush();
  await signUp(container, username);
  const userId = [...auth._profiles.keys()][0];
  await click(findButtonByText(container, "Modes"));
  await flush();
  await click(modeButton(container, "Unlimited"));
  await flush();
  for (let i = 0; i < 6; i++) await draftOne(container);
  await flush(4);
  assert(auth._profiles.get(userId).runs === 1, "the season counted as a run");
  await watchTheSeason(container);
  return { container, auth, userId };
}

await runTest("Run it back charges no DNF for the season you just won", async () => {
  const { container, auth, userId } = await aFinishedSeason("raceuser");
  const before = { ...auth._profiles.get(userId) };

  // Deliberately without waiting the clear out: a real player taps this within a second.
  const again = findButtonByText(container, "Run it back");
  assert(again, "the result screen offers Run it back");
  await click(again);
  await flush(8);
  await new Promise((r) => setTimeout(r, CLEAR_DELAY + 200)); // let the clear land and any DNF settle
  await flush(4);

  const after = auth._profiles.get(userId);
  assert(after.dnf === before.dnf, `no DNF for a finished season: dnf ${before.dnf} -> ${after.dnf}`);
  assert(after.points_unlimited === before.points_unlimited,
    `and no ladder penalty: ${before.points_unlimited} -> ${after.points_unlimited}`);
});

await runTest("the Unlimited tile deals a new draft rather than the finished one", async () => {
  const { container } = await aFinishedSeason("tileuser");
  const finished = (text) => (text.match(/Code (\w+)/) || [])[1];
  const doneCode = finished(container.textContent);

  await click(findButtonByText(container, "Modes"));
  await flush(2);
  await click(modeButton(container, "Unlimited"));
  await flush(4);

  const now = container.textContent;
  const picked = (now.match(/Pick (\d) of 6/) || [])[1];
  assert(picked === "1", `a fresh draft, not the finished one resumed: on pick ${picked}`);
  if (doneCode) assert(finished(now) !== doneCode, `and a new code, not ${doneCode}`);
});

// The snapshot has to be the truth while the reel is running, not only once it stops. `spin` lags the
// animation on purpose - it is what the board list renders from, so moving it early gives the reveal
// away - but `history` and `seqIdx` have already moved on, so for the ~910ms of the reel the effect
// refused to save at all rather than save something inconsistent. A reload inside that window came
// back to the previous board with the pick missing; on the Daily, a free re-pick of your last man.
//
// jsdom has no matchMedia, so reducedMotion() is falsy and animateTo skips the reel entirely - which
// is why this was never reproducible in a test. Giving it one that says motion is fine is the whole
// trick.
await runTest("a pick is saved while the reel is still spinning", async () => {
  setupDom();
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.storage = makeStorage();
  window.__ps_supabase__ = makeMockAuth();
  const { container } = await mount();
  await flush(4);
  await click(modeButton(container, "Unlimited"));
  await flush(4);
  for (let i = 0; i < 60 && !container.querySelector(".card .hit"); i++) await flush(2);

  container.querySelector(".card .hit").click();
  await flush(2);
  const lock = [...container.querySelectorAll("button")].find((b) => /Lock in/i.test(b.textContent));
  assert(lock, "a Lock in button to press");
  lock.click();
  await flush(2);                                   // the reel is running now

  const mid = JSON.parse((await window.storage.get("ps-free-wip", false)).value);
  assert(mid.history.length === 1, `the pick is already saved: ${mid.history.length} picks`);

  await new Promise((r) => setTimeout(r, 1300));    // let the reel finish
  await flush(4);
  const after = JSON.parse((await window.storage.get("ps-free-wip", false)).value);
  assert(after.history.length === mid.history.length, "and the count does not change when it stops");
  assert(`${after.spin.team}|${after.spin.w}` === `${mid.spin.team}|${mid.spin.w}`,
    `nor the board: ${mid.spin.team}|${mid.spin.w} -> ${after.spin.team}|${after.spin.w}`);
});

console.log("test-finish-race.mjs done");
