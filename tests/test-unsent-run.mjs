// A season must survive the page going away while it is still being saved.
//
// finish() renders the result from a LOCAL simulateSeason and does not await the submission - that is
// deliberate, so an honest client sees its numbers with no added latency. The cost is a window in which
// the season exists only in React state and in flight. For a signed-out player that window is the whole
// chain: a Turnstile token (up to eight seconds), signInAnonymously, a profile read, and only then
// submit-run, which replays the draft and simulates seventeen games before it writes anything. Reload
// inside it and every part of that dies with the page - no row, no account, and no message, because the
// code that would have shown one is gone too.
//
// Reported from production on 2026-10-06: a visitor played three seasons in front of the owner and none
// of them were recorded. `pending` is React state and nothing else, so there was never anything to
// recover from.
//
// THE MODEL MATTERS. Unmounting in jsdom does not kill a pending promise the way a reload kills a page,
// so the sign-in is held on a promise that NEVER resolves - that is what "the request died with the
// page" actually looks like. Releasing it would measure a tab that stayed open.
//
// localStorage survives a reload and React state does not, so every test here carries the SAME storage
// and the SAME mock (the server) across the remount, and only the component is thrown away.
import {
  setupDom, makeStorage, mount, flush, click, text, findButtonByText, clickMode, assert, runTest, makeMockAuth,
} from "./helpers.mjs";

let app = null;
let auth = null;
let storage = null;

const tab = (c, label) => [...c.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));
const signedInAs = (c) => c.querySelector(".whoami .whoname")?.textContent || null;
const theGuest = () => [...auth._profiles.values()].find((p) => p.guest) || null;
const runRows = () => [...auth._runs.values()];

async function close() {
  if (!app) return;
  const { act } = await import("react-dom/test-utils");
  await act(async () => { app.reactRoot.unmount(); });
  app = null;
}

// A fresh page. `keep` reuses the storage and the mock, which is what a RELOAD is: the device's own
// storage and the server are both still there, and only the running app is new.
async function open({ keep = false } = {}) {
  await close();
  setupDom("http://localhost/");
  if (!keep) {
    storage = makeStorage();
    storage.data["personal:ps-howto-seen"] = "true";
    auth = makeMockAuth();
  }
  window.storage = storage;
  window.__ps_supabase__ = auth;
  app = await mount();
  await flush(4);
  return app.container;
}

async function until(cond, what, rounds = 60) {
  for (let i = 0; i < rounds; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
}

async function draftFirstEligible(container) {
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

async function playUnlimited(container) {
  await click(tab(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush(3);
  for (let round = 0; round < 6; round++) await draftFirstEligible(container);
  await flush(6);
  for (let i = 0; i < 8 && findButtonByText(container, "Skip to the end"); i++) {
    await click(findButtonByText(container, "Skip to the end"));
    await flush(4);
  }
  await until(() => container.querySelector(".result-hero .strip"),
    () => `the finished season, got: ${text(container).slice(0, 200)}`);
}

// --- the reported bug ---------------------------------------------------------------------------------

await runTest("a signed-out season survives a reload taken while it is still being saved", async () => {
  const c = await open();
  // The sign-in never answers: the page is about to go away underneath it.
  auth._holdAnonSignIn(new Promise(() => {}));

  await playUnlimited(c);
  assert(!theGuest(), "the save is still in flight, so nothing is recorded yet");
  assert(runRows().length === 0, `and no run row yet, got ${runRows().length}`);

  // The reload. Everything in flight dies with the page; storage and the server survive.
  await close();

  const c2 = await open({ keep: true });
  await until(() => runRows().length === 1,
    () => `the season to be recovered and saved on the next load, got ${runRows().length} run rows`);

  const row = runRows()[0];
  assert(!row.dnf, "it is recovered as the finished season it was, not as an abandoned draft");
  assert(Array.isArray(row.roster) && row.roster.length === 6,
    `with its whole roster, got ${JSON.stringify(row.roster?.length)}`);
  const guest = theGuest();
  assert(guest, "and the guest account it needed was taken on the way");
  assert(guest.runs === 1, `the season counted once, got ${guest.runs}`);
  assert(signedInAs(c2) === guest.username,
    `and the app says who they are now, got ${signedInAs(c2)}`);
});

await runTest("a recovered season is counted ONCE, even if the first attempt also lands", async () => {
  const c = await open();
  // This time the sign-in answers after the page has gone - the first attempt completes late, against a
  // component nobody is rendering. The recovery must not then post the same season a second time.
  let release = null;
  auth._holdAnonSignIn(new Promise((r) => { release = r; }));

  await playUnlimited(c);
  await close();
  release();
  await flush(4);

  const c2 = await open({ keep: true });
  await until(() => runRows().length >= 1, () => `the season to land, got ${runRows().length}`);
  await flush(8);

  assert(runRows().length === 1, `exactly one run row, got ${runRows().length}`);
  const guests = [...auth._profiles.values()].filter((p) => p.guest);
  assert(guests.length === 1, `and exactly one guest account, got ${guests.length}`);
  assert(guests[0].runs === 1, `counted once, got ${guests[0].runs}`);
  await close();
});

// The held copy has to be RELEASED, not just written. Left behind after a save the server has already
// answered for, the next load finds it and posts the season again - and for a season played signed out
// that second attempt takes a SECOND guest account, which `finished_codes` cannot catch because its
// duplicate guard is per account. One season, two guests, counted twice. A mutation run put this test
// here: removing the release broke nothing any other test could see.
await runTest("a season that saved normally holds nothing, and a later reload posts nothing again", async () => {
  const c = await open();
  await playUnlimited(c);
  await until(() => runRows().length === 1, () => `the season to save normally, got ${runRows().length}`);

  const key = Object.keys(storage.data).find((k) => k.includes("unsent"));
  assert(!key, `nothing is still held once the server has answered, got ${key}`);

  const c2 = await open({ keep: true });
  await flush(10);
  assert(runRows().length === 1, `still exactly one run row after a reload, got ${runRows().length}`);
  const guests = [...auth._profiles.values()].filter((p) => p.guest);
  assert(guests.length === 1, `and still exactly one guest account, got ${guests.length}`);
  await close();
});

// --- the rule that keeps this from becoming an outbox -------------------------------------------------
//
// CLAUDE.md: there is no outbox for a season, because "a season is a trace, a seed and a client that has
// to agree with the deployed function". A held trace is therefore stamped with the release that built it
// and thrown away if the bundle has moved - a resumed trace is only ever replayed by the function it was
// drafted against. That is the whole of the difference between this and a retry queue.

await runTest("a held season from a different release is discarded rather than replayed", async () => {
  const c = await open();
  auth._holdAnonSignIn(new Promise(() => {}));
  await playUnlimited(c);
  await close();

  const key = Object.keys(storage.data).find((k) => k.includes("unsent"));
  assert(key, `the season was held somewhere, got keys: ${Object.keys(storage.data).join(", ")}`);
  const held = JSON.parse(storage.data[key]);
  assert(held.v, `and stamped with the release that built it, got ${JSON.stringify(Object.keys(held))}`);
  held.v = "0.0.0-not-this-build";
  storage.data[key] = JSON.stringify(held);

  const c2 = await open({ keep: true });
  await flush(10);
  assert(runRows().length === 0, `a trace from another release is not replayed, got ${runRows().length} rows`);
  assert(!storage.data[key], "and it is dropped rather than retried for ever");
  assert(!theGuest(), "no guest account is taken for a season that will never be sent");
  await close();
});

if (process.exitCode) console.log("\nunsent-run checks FAILED");
else console.log("unsent-run checks passed");
