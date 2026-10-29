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
// For a wait measured in real time - the app gives a failed profile read a second go 600ms later.
async function untilMs(cond, what, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
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
const tab = (c, label) => [...c.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));
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
  // Above his Lock in buttons, not under them: selecting a card scrolls the buttons to the foot of a phone's screen,
  // and a tip under them was below the edge at the one moment it was for. Above, it is also read first.
  const tip = card.querySelector(".coachtip"), choice = card.querySelector(".drafts");
  assert(tip && choice && tip.compareDocumentPosition(choice) & Node.DOCUMENT_POSITION_FOLLOWING,
    "on his own card, before his Lock in buttons");
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
  assert(!/only yards and touchdowns|yards and touchdowns only/i.test(tipAbout(c, "This season was scored in Fantasy")),
    "and what it says of Championship is true: turnovers count there too");
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

await runTest("a first visit to /how-to-play gets the rules it came for, with nothing swapped under its focus", async () => {
  // The dialog is on screen from the first render there, before anything knows the visit is a first one. Offering
  // the first draft once that was learned swapped its button for two others - and the one with focus went, leaving
  // a keyboard or screen-reader visitor on <body>, outside the modal, where Enter did nothing.
  const c = await open({ url: "http://localhost/how-to-play" });
  await until(() => rules(c), "the rules at their own address");
  const seen = new Set();
  for (let i = 0; i < 8; i++) { seen.add(buttonsIn(rules(c)).join("|")); await flush(1); }
  assert(seen.size === 1 && [...seen][0] === "×|Got it, let's draft", `one set of buttons, the reader's own, got ${[...seen].join(" then ")}`);
  assert(rules(c).querySelector("details.howmore")?.open === true, "the finer points are open: this visitor came to read them");
  assert(rules(c).contains(document.activeElement) && document.activeElement.tagName === "BUTTON",
    `focus is on a button in the dialog, got ${document.activeElement?.tagName} "${document.activeElement?.textContent}"`);
});

await runTest("an account's first-visit rules wait for its profile, so a veteran is never offered a first draft", async () => {
  // A device that never closed the rules, signed in to an account with twelve drafts. The device's own storage
  // answers before the profile does; opened then, the rules offered "Start my first draft" and took it back
  // under the player's focus when the profile landed.
  const auth = makeMockAuth();
  const { data } = await auth.auth.signUp({ email: "latecomer@example.com", password: "Password1", options: { data: { username: "latecomer" } } });
  Object.assign(auth._profiles.get(data.user.id), { runs: 12, wins: 120, losses: 84 });
  let release = null;
  const held = new Promise((r) => { release = r; });
  const getSession = auth.auth.getSession.bind(auth.auth);
  auth.auth.getSession = async () => { await held; return getSession(); };
  const c = await open({ auth });
  const seen = new Set();
  const look = () => { if (rules(c)) seen.add(buttonsIn(rules(c)).join("|")); };
  for (let i = 0; i < 8; i++) { look(); await flush(1); }
  assert(!rules(c), "no rules while it is not yet known whose device this is");
  release();
  await until(() => { look(); return rules(c); }, "the rules, once the account is known");
  for (let i = 0; i < 6; i++) { look(); await flush(1); }
  assert(![...seen].some((b) => b.includes("Start my first draft")), `never offered, not for a moment: ${[...seen].join(" then ")}`);
  assert(rules(c).contains(document.activeElement), `and focus is in the dialog, got ${document.activeElement?.tagName}`);
});

await runTest("a profile that answers late changes the offer without taking the focused button away", async () => {
  // The one way left for the offer to change under an open dialog: the account's profile does not load, the
  // rules open knowing nothing about it, and a later read (auth-js re-announces SIGNED_IN when the tab comes
  // back to the front) finds twelve drafts. The main button is the same element either way, so focus stays put.
  const auth = makeMockAuth();
  const { data } = await auth.auth.signUp({ email: "unread@example.com", password: "Password1", options: { data: { username: "unread" } } });
  Object.assign(auth._profiles.get(data.user.id), { runs: 12, wins: 120, losses: 84 });
  let announce = null;
  const subscribe = auth.auth.onAuthStateChange.bind(auth.auth);
  auth.auth.onAuthStateChange = (cb) => { announce = cb; return subscribe(cb); };
  auth._failReads("profiles", 8);
  const c = await open({ auth });
  await untilMs(() => /account didn't load/i.test(text(c)), "the notice that the account didn't load");
  await until(() => rules(c), "the first visit's rules");
  assert(buttonsIn(rules(c)).includes("Start my first draft 🏈"), `with nothing known about the account, the offer stands: ${buttonsIn(rules(c))}`);
  const focused = document.activeElement;
  assert(focused?.textContent === "Start my first draft 🏈", `focus on the offer, got ${focused?.textContent}`);

  auth._failReads("profiles", 0);
  const { act } = await import("react-dom/test-utils");
  const { data: now } = await auth.auth.getSession();
  await act(async () => { announce("SIGNED_IN", now.session); });
  await untilMs(() => c.querySelector(".whoami"), "the account, read at last");
  await until(() => !buttonsIn(rules(c)).includes("Start my first draft 🏈"), () => `the offer withdrawn, got ${buttonsIn(rules(c))}`);
  assert(document.activeElement === focused && focused.isConnected, `the same button keeps focus, got ${document.activeElement?.tagName} "${document.activeElement?.textContent}"`);
  assert(focused.textContent === "Got it, let's draft", `now saying what it does, got ${focused.textContent}`);
});

await runTest("a signed-in newcomer who resets the first draft is still coached through the next one", async () => {
  // Reset charges a DNF, which moves an account's stats at once - and read as "an account with drafts behind
  // it", that switched the tips off for good on the very draft they were for. A signed-out newcomer kept them.
  const auth = makeMockAuth();
  await auth.auth.signUp({ email: "fresh@example.com", password: "Password1", options: { data: { username: "freshface" } } });
  const storage = makeStorage();
  const c = await open({ storage, auth });
  await until(() => rules(c), "the first visit's rules");
  assert(buttonsIn(rules(c)).includes("Start my first draft 🏈"), "an account with no drafts is offered its first");
  await click(findButtonByText(rules(c), "Start my first draft 🏈"));
  await boardDealt(c);
  assert(tipAbout(c, "re-spin"), `coached on the first board, got ${tips(c)}`);
  await click(findButtonByText(c, "Reset draft"));
  await flush(2);
  await click(findButtonByText(c, "Tap again: counts as a DNF"));
  await flush(4);
  await boardDealt(c);
  await until(() => auth._profiles.get([...auth._profiles.keys()].find((k) => auth._profiles.get(k).username === "freshface"))?.dnf === 1,
    "the reset counted as a DNF");
  await flush(4);
  assert(tipAbout(c, "re-spin"), `the next first board is still coached, got ${tips(c)}`);
  assert(stored(storage, "ps-coach") === '"on"', `and the device is still coaching, got ${stored(storage, "ps-coach")}`);
});

await runTest("first-visit rules a duel closed come back on the next screen, and rules asked for later are the whole rules", async () => {
  // A stranger arrives on a duel invite: the rules are held, since the duel has its own. They look at the
  // Leaderboard (the rules open there), then go Back to the duel, which closes them. Their first-visit state used
  // to stay behind, so the header's How to play later opened them folded, offering a first draft.
  const storage = makeStorage();
  const c = await open({ url: "http://localhost/vs/ABC123", storage });
  await flush(4);
  assert(!rules(c), "no game rules over a duel");
  await click(tab(c, "Leaderboard"));
  await until(() => rules(c), "the held rules, on the next screen");
  window.history.back();
  await until(() => window.location.pathname === "/vs/ABC123" && !rules(c), () => `the duel, rules closed: ${window.location.pathname} ${!!rules(c)}`);
  assert(stored(storage, "ps-howto-seen") === undefined, "the player never closed them");
  await click(tab(c, "Modes"));
  await until(() => rules(c), "the first visit's rules again, held until the duel was left");
  assert(buttonsIn(rules(c)).includes("Start my first draft 🏈"), `still a first visit's, got ${buttonsIn(rules(c))}`);
  await click(findButtonByText(rules(c), "Look around first"));
  await flush(2);
  await click(findButtonByText(c, "How to play"));
  await until(() => rules(c), "the rules, asked for");
  assert(rules(c).querySelector("details.howmore")?.open === true, "asked for, they open whole");
  assert(JSON.stringify(buttonsIn(rules(c))) === JSON.stringify(["×", "Got it, let's draft"]), `and offer nothing but closing, got ${buttonsIn(rules(c))}`);
});

await runTest("Championship is described the way it is scored, turnovers and all", async () => {
  // The data first. Championship takes the reception point away and nothing else, so an interception or a lost
  // fumble costs two points in it exactly as it does in Fantasy: across the board's heaviest turnover seasons,
  // Championship points sit far below what yards and touchdowns alone would give. Every sentence that said
  // Championship counted "only yards and touchdowns" was therefore wrong, the new scoring tip among them.
  const { initGameData, BOARDS } = await import("../game-logic.mjs");
  const fs = await import("node:fs");
  const data = JSON.parse(fs.readFileSync(new URL("../data/players.json", import.meta.url), "utf8"));
  initGameData(data.players, data.opponents);
  const heavy = Object.values(BOARDS).flat().filter((p) => p.int + p.fl >= 15);
  const yardsAndTds = (p) => p.py * 0.04 + p.ptd * 4 + (p.ry + p.rcy) * 0.1 + (p.rtd + p.rctd) * 6;
  const below = heavy.reduce((a, p) => a + yardsAndTds(p) - p.stdPoints, 0) / heavy.length;
  assert(heavy.length > 50 && below > 25,
    `turnovers cost points in Championship: ${heavy.length} seasons, ${below.toFixed(1)} points below yards and touchdowns alone`);

  const says = (t, where) => {
    assert(t && /turnovers/.test(t), `${where} names turnovers: ${t}`);
    assert(!/only yards and touchdowns|yards and touchdowns only/i.test(t), `${where} doesn't say yards and touchdowns are all that counts: ${t}`);
  };
  const flat = (step) => step.map((part) => (typeof part === "string" ? part : part.text)).join("");
  says(flat(HOWTO_MORE.find((step) => flat(step).includes("scoring format")) || []), "the rules");

  // Then every place the app says it, as a Championship newcomer meets them: under the format picker, then the
  // first result's tip and the note under the graded roster.
  const c = await open();
  await until(() => rules(c), "the first visit's rules");
  await click(findButtonByText(rules(c), "Look around first"));
  await flush(2);
  await click([...c.querySelectorAll(".fmtbtn")].find((b) => b.textContent.startsWith("Championship")));
  await flush(2);
  says(c.querySelector(".fmtnote")?.textContent, "the note under the format picker");
  await clickMode(c, "Unlimited");
  await boardDealt(c);
  await finishSeason(c);
  await until(() => tipAbout(c, "This season was scored in Championship"), () => `the scoring tip, got ${tips(c)}`);
  says(tipAbout(c, "This season was scored in Championship"), "the first result's tip");
  says([...c.querySelectorAll("p.note")].find((p) => p.textContent.startsWith("Grades compare"))?.textContent, "the note under the result");
});

await close();
console.log("test-first-visit.mjs done");
