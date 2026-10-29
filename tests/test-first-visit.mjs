// A stranger's first visit (v2.23.0, from a player's feedback). The rules open on three steps rather than seven
// and a grading note, with the finer points folded under them; the dialog's own button starts the first draft;
// and that draft explains the finer points one at a time, at the moment each one matters - the re-spins on the
// first board, Flex when a player could go there, the scoring on the first result. Then it stops, for good. A
// device that was here before the tips existed, or an account with drafts behind it, never sees one. And Modes
// leads with the two drafts, with everything else grouped under them.
import { setupDom, makeStorage, mount, flush, click, text, findButtonByText, assert, runTest, makeMockAuth, clickMode, closeRules } from "./helpers.mjs";
import { HOWTO_STEPS, HOWTO_MORE } from "../site-pages.mjs";

let app = null;
async function close() {
  if (!app) return;
  const { act } = await import("react-dom/test-utils");
  await act(async () => { app.reactRoot.unmount(); });
  app = null;
}
async function open({ url = "http://localhost/", storage = makeStorage(), auth = makeMockAuth() } = {}) {
  await close();
  setupDom(url);
  window.storage = storage;
  window.__ps_supabase__ = auth;
  app = await mount();
  await flush(4);
  return app.container;
}
async function until(cond, what, rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
}
const rules = (c) => c.querySelector('[role="dialog"][aria-labelledby="howto-title"]');
const buttonsIn = (el) => [...(el?.querySelectorAll("button") || [])].map((b) => b.textContent.trim());
const tips = (c) => [...c.querySelectorAll(".coachtip")].map((t) => t.textContent);
const tipAbout = (c, words) => tips(c).find((t) => t.includes(words)) || null;
const stored = (storage, key) => storage.data[`personal:${key}`];
const cards = (c) => [...c.querySelectorAll(".card")].filter((card) => !card.classList.contains("off"));
const posOf = (card) => card.querySelector(".pp")?.textContent;
const lockIns = (card) => [...card.querySelectorAll(".drafts button.btn.solid")];
async function select(card) {
  await click(card.querySelector("button.hit"));
  await flush();
}
// Locks the selected card into the slot whose label is `label` ("Flex", "WR"...), or into its first offer.
async function lockIn(card, label = null) {
  const btn = lockIns(card).find((b) => !label || b.textContent.endsWith(`· ${label}`)) || lockIns(card)[0];
  await click(btn);
  await flush();
}
async function boardDealt(c) {
  await until(() => cards(c).length > 0, () => `a dealt board, got: ${text(c).slice(0, 160)}`);
}
// Plays out whatever is left of the draft on screen, then the season, to its result.
async function finishSeason(c) {
  for (let i = 0; i < 6 && !c.querySelector(".result-hero"); i++) {
    await boardDealt(c);
    const card = cards(c)[0];
    await select(card);
    await lockIn(card);
  }
  await flush(6);
  for (let i = 0; i < 8 && findButtonByText(c, "Skip to the end"); i++) {
    await click(findButtonByText(c, "Skip to the end"));
    await flush(4);
  }
  await until(() => c.querySelector(".result-hero .strip"), () => `the finished season, got: ${text(c).slice(0, 200)}`);
}

await runTest("a first visit opens on three steps, with the finer points folded and the first draft offered", async () => {
  const c = await open();
  await until(() => rules(c), "the first visit's rules");
  assert(rules(c).querySelectorAll("ol li").length === HOWTO_STEPS.length && HOWTO_STEPS.length === 3,
    `three steps, got ${rules(c).querySelectorAll("ol li").length}`);
  const fold = rules(c).querySelector("details.howmore");
  assert(fold && fold.open === false, "the finer points are folded on a first visit");
  assert(fold.querySelectorAll("li").length === HOWTO_MORE.length, "and all of them are one tap away");
  const offered = buttonsIn(rules(c));
  assert(offered.includes("Start my first draft 🏈") && offered.includes("Look around first"), `it offers the first draft, got ${offered}`);
  assert(!offered.includes("Got it, let's draft"), "rather than only closing");
  assert(document.activeElement?.textContent === "Start my first draft 🏈", `and that is where focus lands, got ${document.activeElement?.textContent}`);

  // Looking around first is a real choice: the rules close onto Modes, and nothing is dealt.
  await click(findButtonByText(rules(c), "Look around first"));
  await flush(2);
  assert(!rules(c) && !cards(c).length, "Look around first closes the rules and starts nothing");
  assert(stored(window.storage, "ps-howto-seen") === "true", "and the rules count as seen");
});

await runTest("Start my first draft deals a board, and the draft teaches as it goes", async () => {
  const storage = makeStorage();
  const c = await open({ storage });
  await until(() => rules(c), "the first visit's rules");
  await click(findButtonByText(rules(c), "Start my first draft 🏈"));
  await boardDealt(c);
  assert(!rules(c), "the rules are gone");
  assert(c.querySelector(".modebar .mb.on")?.textContent === "Unlimited", "it is an Unlimited draft");
  assert(stored(storage, "ps-howto-seen") === "true" && stored(storage, "ps-coach") === '"on"', "seen, and being coached");

  // The first board: the re-spins, while both are there to spend. Nothing about Flex until it matters.
  assert(tipAbout(c, "one team re-spin and one era re-spin"), `the re-spins are explained on the first board, got ${tips(c)}`);
  assert(!tipAbout(c, "Flex takes"), "Flex is not explained before anybody could go there");

  // A player who could go to his own spot or to Flex: that is the moment Flex is worth a sentence.
  let card = null;
  for (let tries = 0; tries < 6 && !card; tries++) {
    await boardDealt(c);
    card = cards(c).find((x) => ["RB", "WR", "TE"].includes(posOf(x)));
    if (!card) { const any = cards(c)[0]; await select(any); await lockIn(any); }
  }
  assert(card, "a back, receiver or tight end on one of the boards");
  await select(card);
  const offers = lockIns(card).map((b) => b.textContent);
  assert(offers.some((t) => t.endsWith("· Flex")) && offers.some((t) => !t.endsWith("· Flex")), `his own spot and Flex are both offered, got ${offers}`);
  assert(tipAbout(c, "Flex takes any RB, WR or TE"), `Flex is explained as he is placed, got ${tips(c)}`);
  assert(card.querySelector(".coachtip"), "under his own Lock in buttons");
  await lockIn(card, "Flex");
  assert(!tipAbout(c, "re-spin"), "the re-spin tip went with the first board");

  // Once somebody is in Flex the player has seen it work, and it is not explained again.
  const next = await (async () => {
    for (let tries = 0; tries < 5; tries++) {
      await boardDealt(c);
      const x = cards(c).find((y) => ["RB", "WR", "TE"].includes(posOf(y)));
      if (x) return x;
      const any = cards(c)[0]; await select(any); await lockIn(any);
    }
    return null;
  })();
  if (next) {
    await select(next);
    assert(!tipAbout(c, "Flex takes"), `Flex is explained once, got ${tips(c)}`);
    await lockIn(next);
  }

  // The first result: the scoring, now there is a graded season to read it against.
  await finishSeason(c);
  await until(() => tipAbout(c, "This season was scored in Fantasy"), () => `the scoring on the first result, got ${tips(c)}`);
  assert(stored(storage, "ps-coach") === '"done"', "the first result is the end of it, recorded as it appears");

  // And that is the end. The next draft is anybody's.
  await click(findButtonByText(c, "Run it back"));
  await boardDealt(c);
  assert(!tips(c).length, `no tips on the second draft, got ${tips(c)}`);
});

await runTest("a reload in the middle of the first draft keeps the coaching; one after the result does not", async () => {
  const storage = makeStorage();
  let c = await open({ storage });
  await until(() => rules(c), "the first visit's rules");
  await click(findButtonByText(rules(c), "Start my first draft 🏈"));
  await boardDealt(c);
  // A reload: the same device, a new page.
  c = await open({ storage });
  await clickMode(c, "Unlimited");
  await boardDealt(c);
  assert(tipAbout(c, "re-spin"), `still a first draft after a reload, got ${tips(c)}`);
  await finishSeason(c);
  c = await open({ storage });
  await clickMode(c, "Unlimited");
  await boardDealt(c);
  assert(!tips(c).length, `a reload after the first result is a veteran's, got ${tips(c)}`);
});

await runTest("a device that was here before never sees a tip", async () => {
  const storage = makeStorage();
  storage.data["personal:ps-howto-seen"] = "true"; // closed the rules in an earlier release
  const c = await open({ storage });
  assert(!rules(c), "no rules on a returning device");
  await clickMode(c, "Unlimited");
  await boardDealt(c);
  const card = cards(c).find((x) => ["RB", "WR", "TE"].includes(posOf(x))) || cards(c)[0];
  await select(card);
  assert(!tips(c).length, `nothing explained to somebody who has played, got ${tips(c)}`);
  assert(stored(storage, "ps-coach") === undefined, "and coaching was never switched on");
});

await runTest("an account with drafts behind it is never coached, even on a device it has never used", async () => {
  const auth = makeMockAuth();
  const { data } = await auth.auth.signUp({ email: "veteran@example.com", password: "Password1", options: { data: { username: "veteran" } } });
  Object.assign(auth._profiles.get(data.user.id), { runs: 12, wins: 120, losses: 84 });
  const storage = makeStorage();
  const c = await open({ storage, auth });
  await until(() => c.querySelector(".whoami"), "signed in");
  await until(() => rules(c), "the new device's rules");
  const offered = buttonsIn(rules(c));
  assert(!offered.includes("Start my first draft 🏈") && offered.includes("Got it, let's draft"),
    `no "first draft" for an account with twelve, got ${offered}`);
  await closeRules(c);
  await clickMode(c, "Unlimited");
  await boardDealt(c);
  assert(!tips(c).length, `and no tips, got ${tips(c)}`);
  assert(stored(storage, "ps-coach") === '"done"', "the device knows it, from then on");
});

await runTest("a first visit on a challenge link keeps the challenge, and offers no draft over it", async () => {
  const c = await open({ url: "http://localhost/c/K3F9QZ?beat=12-5" });
  await until(() => rules(c), "the first visit's rules");
  const offered = buttonsIn(rules(c));
  assert(!offered.includes("Start my first draft 🏈"), `the visitor came for those boards, got ${offered}`);
  await closeRules(c);
  assert(c.querySelector(".challenge") && findButtonByText(c.querySelector(".challenge"), "Draft these boards"),
    "and the challenge card is what is waiting for them");
});

await runTest("Modes leads with the two drafts, and groups the rest under them", async () => {
  const storage = makeStorage();
  storage.data["personal:ps-howto-seen"] = "true";
  const c = await open({ storage });
  const names = (el) => [...el.querySelectorAll(".mode .mn")].map((n) => n.textContent);
  const groups = [...c.querySelectorAll(".modes")];
  assert(groups.length === 2, `two groups of modes, got ${groups.length}`);
  assert(JSON.stringify(names(groups[0])) === JSON.stringify(["Daily challenge", "Unlimited"]), `the daily and Unlimited lead, alone: ${names(groups[0])}`);
  assert(groups[1].classList.contains("more"), "the second group is the secondary one");
  assert(JSON.stringify(names(groups[1])) === JSON.stringify(["Genius mode", "GM mode", "Duel", "Mini games", "Challenge a friend"]),
    `everything else is grouped: ${names(groups[1])}`);
  const headings = [...c.querySelectorAll("h2.h")].map((h) => h.textContent);
  assert(headings.indexOf("Drafts") >= 0 && headings.indexOf("More ways to play") === headings.indexOf("Drafts") + 1,
    `headed Drafts, then More ways to play: ${headings}`);
  // Grouped, not hidden: a returning player reaches every one of them in a tap, as before.
  await clickMode(c, "Genius mode");
  await boardDealt(c);
  assert(c.querySelector(".modechip.genius"), "Genius opens from the group");
});

await close();
console.log("test-first-visit.mjs done");
