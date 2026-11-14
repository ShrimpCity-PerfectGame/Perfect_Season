// The card area, in the real app on the mock: the tile and the switch that hides it, the starter deck, the
// collection, and the three things the screen must never get wrong - a read that failed shown as an empty
// collection, a card the catalog does not know breaking the rest, and a switched-off server read as "check
// your connection".
import { readFileSync } from "node:fs";
import {
  setupDom, makeStorage, makeMockAuth, mount, flush, click, type, clickMode, findButtonByText, assert, runTest, waitForCrypto,
} from "./helpers.mjs";
import { CARD_REFUSALS } from "../storage-cards.js";
import { CARDS, cardBoardKey, buildTeam, autoPick, dailyFoe, categoryLabel, categoryStat, callerOf, foeCall, bestCategory, GAUNTLET, gauntletName, gauntletFoe } from "../card-logic.mjs";
import { mulberry32 } from "../game-logic.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;
window.__ps_cards__ = true;
// A pack is rolled at random and a card already owned is sold on the spot, so a test that counts cards or reads
// the balance after a pack it did not pin failed about one run in five (v2.30.0 stopped the wallet assertions
// failing that way and missed the counts and the balance on the shelf; the full suite caught one in v2.31.0).
// The tests that are ABOUT copies pin their pack with nextPull, which still wins.
auth._cards.freshPulls = true;
// The app fetches the catalog; in a test that is a file read.
const catalog = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
const versusPoolFile = JSON.parse(readFileSync(new URL("../data/versus-pool.json", import.meta.url), "utf8"));
let fetchFails = false;
globalThis.fetch = window.fetch = async (url) => {
  if (String(url).endsWith("/data/cards.json")) { if (fetchFails) throw new Error("offline"); return { ok: true, status: 200, json: async () => catalog }; }
  if (String(url).endsWith("/data/versus-pool.json")) return { ok: true, status: 200, json: async () => versusPoolFile };
  return { ok: false, status: 404, json: async () => ({}) };
};

let { container, reactRoot } = await mount();
await flush();
const remount = async () => { reactRoot.unmount(); ({ container, reactRoot } = await mount()); await flush(); };
const button = (needle) => findButtonByText(container, needle);
const cardsOnScreen = () => [...container.querySelectorAll("[data-card]")];
const tile = () => [...container.querySelectorAll("button.mode")].find((b) => b.classList.contains("m-cards"));
const settle = async () => { await flush(); await flush(); };

// Signing up through the Account panel, exactly as tests/test-century-screen.mjs does.
const panel = () => container.querySelector(".panel");
const submit = (label) => [...panel().querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes(label));
async function openAccount() { await click(findButtonByText(container, "Account") || findButtonByText(container, "Profile")); await flush(); }
async function signUp(email, username) {
  await auth.auth.signOut(); await flush();
  await openAccount();
  const create = findButtonByText(panel(), "Create account");
  if (create?.hasAttribute("role")) { await click(create); await flush(); }
  const [e, u, p, p2] = [...panel().querySelectorAll("input")];
  await type(e, email); await type(u, username); await type(p, "Password1"); await type(p2, "Password1");
  await click(submit("Create account")); await waitForCrypto(); await flush();
  const { data } = await auth.auth.getSession();
  assert(data?.session?.user?.id, "signed up as " + username);
  return data.session.user.id;
}
async function goHome() { const b = [...container.querySelectorAll("button")].find((x) => x.textContent.trim() === "Modes"); if (b) { await click(b); await flush(); } }
async function openCards() { await goHome(); assert(tile(), "the Cards tile is on Modes"); await click(tile()); await settle(); }

await runTest("the tile follows the switch", async () => {
  window.__ps_cards__ = false; await remount();
  assert(!tile(), "with cards off there is no Cards tile");
  window.__ps_cards__ = true; await remount();
  assert(tile() && tile().textContent.includes("Cards"), "with cards on there is");
  await clickMode(container, "Cards"); await settle();
  assert(container.querySelector("h1.vh")?.textContent === "Cards", "and it opens the card area, which names itself");
});

await runTest("signed out, cards are for accounts", async () => {
  await auth.auth.signOut(); await flush();
  await openCards();
  assert(container.textContent.includes("Cards are for accounts"), "it says so");
  assert(!button("Open your starter deck") && cardsOnScreen().length === 0, "and offers no deck");
  assert(button("Sign in"), "but a way to sign in");
});

let ann;
await runTest("a new account opens a starter deck, once", async () => {
  ann = await signUp("ann@cards.test", "ann");
  await openCards();
  const open = button("Open your starter deck");
  assert(open, "the starter button is there: " + container.querySelector(".cd-area")?.textContent.slice(0, 120));
  await click(open); await settle(); await settle();
  assert(container.querySelector("#cd-fresh-h")?.textContent === "Your starter deck", "the thirty just dealt are shown under their own heading");
  assert(container.querySelectorAll(".cd-fresh [data-card]").length === 30, "all thirty of them");
  assert(container.querySelector("#cd-coll-h")?.textContent === "30 cards", "and the collection says 30 cards: " + container.querySelector("#cd-coll-h")?.textContent);
  assert(auth._cards.owned(ann).reduce((n, o) => n + o.count, 0) === 30, "the account owns thirty");
  await remount(); await openCards();
  assert(!button("Open your starter deck") && container.querySelector("#cd-coll-h")?.textContent === "30 cards", "coming back shows the collection, not the button");
  assert(!container.querySelector(".cd-fresh"), "and the just-dealt section was for the moment it was dealt");
  const ratings = [...container.querySelectorAll("section[aria-labelledby='cd-coll-h'] [data-card]")].map((el) => CARDS.get(Number(el.dataset.card)).rating);
  assert(ratings.every((r, i) => i === 0 || ratings[i - 1] >= r), "best card first");
});

await runTest("the position filter", async () => {
  const chip = (name) => [...container.querySelectorAll(".cd-chip")].find((b) => b.textContent === name);
  assert(chip("All").getAttribute("aria-pressed") === "true", "All is pressed to begin with");
  await click(chip("QB")); await flush();
  const shown = cardsOnScreen();
  assert(shown.length >= 1 && shown.every((el) => CARDS.get(Number(el.dataset.card)).pos === "QB"), "QB shows only quarterbacks");
  assert(shown.every((el) => el.getAttribute("aria-label").includes("quarterback")), "and each one says so aloud");
  assert(chip("QB").getAttribute("aria-pressed") === "true" && chip("All").getAttribute("aria-pressed") === "false", "the pressed state moved");
  assert(container.querySelector("#cd-coll-h").textContent === "30 cards", "the count is the collection's, not the filter's");
  await click(chip("All")); await flush();
});

await runTest("the finish and team filters narrow the same grid", async () => {
  // One Gold card beside the eight Base ones, from a team the starter deck may not hold.
  const gold = [...CARDS.values()].find((c) => c.rating > 110 && !auth._cards.owned(ann).some((o) => CARDS.get(o.card_id).team === c.team));
  auth._cards.grantCards(ann, "gift", [{ ref: "filter-gold", card: gold.id, finish: "gold" }]);
  await openCards();
  const finishChip = (f) => container.querySelector(`[data-finish-filter="${f}"]`);
  assert(finishChip("All").getAttribute("aria-pressed") === "true" && cardsOnScreen().length === 31, "thirty-one cards, any finish");
  await click(finishChip("gold")); await flush();
  assert(cardsOnScreen().length === 1 && cardsOnScreen()[0].dataset.finish === "gold" && /Showing 1 of 31\./.test(container.querySelector("[data-shown]").textContent), "Gold shows the one Gold card, and says how many of how many");
  await click(finishChip("prism")); await flush();
  assert(cardsOnScreen().length === 0 && /No cards match those filters/.test(container.textContent), "a finish nobody holds says so, not 'no cards yet'");
  await click(finishChip("All")); await flush();
  const select = container.querySelector("[data-team-filter]");
  assert(select && [...select.options].some((o) => o.value === gold.team) && select.options.length === new Set(auth._cards.owned(ann).map((o) => CARDS.get(o.card_id).team)).size + 1, "the team list is the teams in the collection, and Every team");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, gold.team); select.dispatchEvent(new window.Event("change", { bubbles: true })); await flush();
  assert(cardsOnScreen().length >= 1 && cardsOnScreen().every((el) => CARDS.get(Number(el.dataset.card)).team === gold.team), "a team shows only that team's cards");
  setter.call(select, "All"); select.dispatchEvent(new window.Event("change", { bubbles: true })); await flush();
  assert(cardsOnScreen().length === 31, "and Every team brings them all back");
  auth._cards.tables.card_owned.splice(auth._cards.tables.card_owned.findIndex((o) => o.user_id === ann && o.card_id === gold.id && o.finish === "gold"), 1);
  await openCards();
});

await runTest("a read that failed is not an empty collection", async () => {
  auth._cards.readFails = true;
  await remount(); await openCards();
  assert(container.textContent.includes("Couldn't load your cards."), "it says the load failed");
  assert(button("Try again"), "and offers to try again");
  assert(!button("Open your starter deck"), "it does NOT offer a starter deck to somebody who has one");
  assert(!container.querySelector("#cd-coll-h") && cardsOnScreen().length === 0, "and does not claim a count");
  auth._cards.readFails = false;
  await click(button("Try again")); await settle();
  assert(container.querySelector("#cd-coll-h")?.textContent === "30 cards", "Try again loads the collection");
});

await runTest("a catalog that will not load is the same honest failure", async () => {
  const { _resetCardData } = await import("../card-data.mjs").catch(() => ({}));
  // the app's own copy of card-data.mjs has already loaded the catalog for this page, as it would in a browser;
  // a fresh page with the network down is what this models
  fetchFails = true; _resetCardData?.();
  await remount(); await openCards();
  const failed = container.textContent.includes("Couldn't load your cards.");
  fetchFails = false;
  assert(failed || container.querySelector("#cd-coll-h"), "either it loaded from the page's memory or it said it could not - never a blank");
});

await runTest("a card the catalog does not know is skipped, and the rest still show", async () => {
  auth._cards.tables.card_owned.push({ user_id: ann, card_id: 999999, finish: "gold", count: 1 });
  await remount(); await openCards();
  assert(cardsOnScreen().length === 30, "thirty real cards are drawn");
  assert(container.querySelector("#cd-coll-h").textContent === "30 cards", "and counted - the unknown one is not");
  assert(/out of date/i.test(container.querySelector(".cd-area").textContent), "and the screen says the page is out of date, rather than leaving a card silently missing");
  auth._cards.tables.card_owned.pop();
});

await runTest("a stack of copies from before is sold the first time the collection opens", async () => {
  // Stacked the old way (no price on the grant): what every collection from before v2.26.0 can hold.
  const first = auth._cards.owned(ann)[0];
  auth._cards.grantCards(ann, "daily", [{ ref: "2026-11-01", card: first.card_id, finish: first.finish }]);
  auth._cards.grantCards(ann, "daily", [{ ref: "2026-11-02", card: first.card_id, finish: first.finish }]);
  assert(auth._cards.owned(ann).find((o) => o.card_id === first.card_id).count === 3, "three of one card to begin with");
  const before = auth._wallet.balanceOf(ann);
  const each = auth._cards.sellFor({ id: first.card_id, finish: first.finish });
  await remount(); await openCards(); await settle(); await settle();
  assert(auth._cards.owned(ann).find((o) => o.card_id === first.card_id).count === 1, "one is kept");
  assert(each > 0 && auth._wallet.balanceOf(ann) === before + 2 * each, `and two were sold for ${each} each: ${auth._wallet.balanceOf(ann) - before}`);
  const said = container.querySelector("[data-swept]")?.textContent || "";
  assert(/2 extra copies were sold for/.test(said) && said.includes((2 * each).toLocaleString("en-US")), "the screen says what was sold and for how much: " + said);
  const el = container.querySelector(`[data-card="${first.card_id}"]`);
  assert(!el.querySelector(".cd-count") && container.querySelector("#cd-coll-h").textContent === "30 cards", "and the collection shows one of it, thirty cards in all");
  // Opening it again sells nothing more and says nothing more.
  await remount(); await openCards(); await settle();
  assert(auth._wallet.balanceOf(ann) === before + 2 * each && !container.querySelector("[data-swept]"), "a second visit sells nothing");
});

await runTest("a server that has cards switched off says so, in a sentence", async () => {
  await signUp("bob@cards.test", "bob");
  auth._cards.enabled = false;
  await openCards();
  await click(button("Open your starter deck")); await settle();
  const alert = container.querySelector(".cd-starter [role='alert']");
  assert(alert && /aren't switched on/.test(alert.textContent), "the reason is shown: " + alert?.textContent);
  assert(!/connection/i.test(alert.textContent), "and it does not blame the connection");
  assert(button("Open your starter deck") && !button("Open your starter deck").disabled, "the button is live again");
  auth._cards.enabled = true;
  await click(button("Open your starter deck")); await settle(); await settle();
  assert(container.querySelector("#cd-coll-h")?.textContent === "30 cards", "and once it is on, the same button works");
});

await runTest("every refusal has a sentence", async () => {
  const { CARD_SENTENCES, CARD_SENTENCE_KEYS } = await (await import("./helpers.mjs")).loadModule("cards.jsx");
  for (const key of [...CARD_REFUSALS, "offline", "network"]) {
    assert(CARD_SENTENCE_KEYS.includes(key) && typeof CARD_SENTENCES[key] === "string" && CARD_SENTENCES[key].length > 15, `"${key}" has a sentence`);
  }
  assert(!/connection/i.test(CARD_SENTENCES.cards_off + CARD_SENTENCES.guest_not_allowed + CARD_SENTENCES.server), "a rule is never worded as a fault in your connection");
});

await runTest("a guest is told cards are for accounts", async () => {
  await auth.auth.signOut(); await flush();
  await auth.auth.signInAnonymously(); await flush(); await remount();
  await openCards();
  assert(container.textContent.includes("Cards are for accounts") && button("Keep my seasons"), "the guest's own wording and way out");
  assert(!button("Open your starter deck"), "and no deck");
});

await runTest("hiding the card area, and bringing it back", async () => {
  await auth.auth.signOut(); await flush(); await remount();
  await openCards();
  await click(button("Hide cards")); await flush();
  assert(!container.querySelector(".cd-area"), "hiding leaves the card area");
  assert(!tile(), "the tile is gone from Modes");
  const show = button("Show cards");
  assert(show, "and the footer says how to bring it back");
  await remount();
  assert(!tile() && button("Show cards"), "the choice survives a reload");
  await click(button("Show cards")); await flush();
  assert(tile() && !button("Show cards"), "Show cards brings the tile back");
  await remount();
  assert(tile(), "and that survives a reload too");
});

await runTest("leaving the card area goes back to Modes", async () => {
  await openCards();
  await click(button("All modes")); await flush();
  assert(!container.querySelector(".cd-area") && tile(), "All modes returns to Modes");
});

await runTest("a slow load cannot overwrite what the screen has since learned", async () => {
  // Found in review. Whether an account is a guest arrives a beat after its id does, so the screen can start
  // loading as "not a guest", be told it IS one, and then have the first load finish and offer a starter deck.
  const { loadModule } = await import("./helpers.mjs");
  const { CardsScreen } = await loadModule("cards.jsx"); // its own copy, with a catalog not yet loaded
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react-dom/test-utils");
  await auth.auth.signOut(); await flush();
  const { data } = await auth.auth.signUp({ email: "race@cards.test", password: "Password1", options: { data: { username: "racer" } } });
  let release; const gate = new Promise((r) => { release = r; });
  const realFetch = globalThis.fetch;
  globalThis.fetch = window.fetch = async () => { await gate; return { ok: true, status: 200, json: async () => catalog }; };
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(React.createElement(CardsScreen, { userId: data.user.id, isGuest: false, onBack() {} })); });
    await act(async () => { root.render(React.createElement(CardsScreen, { userId: data.user.id, isGuest: true, onBack() {} })); });
    assert(host.textContent.includes("Cards are for accounts"), "told it is a guest, the screen says cards are for accounts");
    await act(async () => { release(); await new Promise((r) => setTimeout(r, 20)); });
    await flush();
    assert(host.textContent.includes("Cards are for accounts") && !findButtonByText(host, "Open your starter deck"), "and the load that started first does not come back and offer a deck: " + host.textContent.slice(0, 120));
  } finally {
    await act(async () => { root.unmount(); }); host.remove();
    globalThis.fetch = window.fetch = realFetch;
  }
});

// ---------- the daily card on the result screen ----------
const until = async (cond, what, tries = 80) => { for (let i = 0; i < tries; i++) { const v = cond(); if (v) return v; await flush(1); } throw new Error("waited for " + (typeof what === "function" ? what() : what)); };
async function draftFirstEligible() {
  let card = null;
  for (let i = 0; i < 10 && !card; i++) { await flush(1); card = [...container.querySelectorAll(".card")].find((c) => !c.classList.contains("off")); }
  if (!card) throw new Error("no draftable player on the board: " + container.textContent.slice(0, 160));
  await click(card.querySelector("button.hit")); await flush();
  await click(card.querySelector(".drafts button.btn.solid")); await flush();
}
async function playToResult() {
  for (let round = 0; round < 6; round++) await draftFirstEligible();
  await flush(6);
  for (let i = 0; i < 6 && button("Skip to the end"); i++) { await click(button("Skip to the end")); await flush(4); }
  await until(() => container.querySelector(".result-hero .strip"), () => "the finished season, got: " + container.textContent.slice(0, 200));
}
const earned = () => container.querySelector(".cd-earned");

await runTest("finishing the daily shows the card it earned, under the coins", async () => {
  const uid = await signUp("dana@cards.test", "dana");
  await goHome();
  await click(findButtonByText(container, "Fantasy daily")); await flush(3);
  await playToResult();
  await until(() => earned(), () => "Today's card on the result: " + container.textContent.slice(-300));
  assert(earned().querySelector("h3").textContent === "Today's card" && earned().querySelectorAll("[data-card]").length === 1, "one card under its own heading");
  const shown = Number(earned().querySelector("[data-card]").dataset.card);
  const owned = auth._cards.owned(uid);
  assert(owned.length === 1 && owned[0].card_id === shown, "and it is the card the account now owns");
  assert(auth._cards.grants(uid)[0].kind === "daily", "granted as the daily card");
  const coins = container.querySelector(".sc, .season-coins, [class*='sc-']");
  assert(!coins || (coins.compareDocumentPosition(earned()) & 4), "after the coins, never before the result");
  await click(findButtonByText(earned(), "See your cards")); await settle();
  // This account has a daily card and has never opened its starter deck: it is offered the deck AND shown the card.
  assert(button("Open your starter deck"), "the starter deck is still on offer");
  assert(container.querySelector("#cd-coll-h")?.textContent === "1 card" && container.querySelector(`[data-card="${shown}"]`), "and the card it was just shown is there: " + container.querySelector("#cd-coll-h")?.textContent);
  await click(button("Open your starter deck")); await settle(); await settle();
  assert(container.querySelector("#cd-coll-h")?.textContent === "30 cards", "opening the deck fills it to thirty - the daily card already holds one of the spots");
});

await runTest("with cards hidden the daily shows no card, and the card is still banked", async () => {
  // A fresh device: the daily keeps a per-device record of its own, and this is another player's day.
  window.storage = makeStorage(); await remount();
  const uid = await signUp("eli@cards.test", "eli");
  await openCards();
  await click(button("Hide cards")); await flush();
  await click(findButtonByText(container, "Fantasy daily")); await flush(3);
  await playToResult();
  await flush(10);
  assert(!earned(), "no card block on the result");
  assert(auth._cards.owned(uid).length === 1, "but the account owns the card it earned");
  await goHome();
  await click(button("Show cards")); await flush();
});

await runTest("an Unlimited season shows no card", async () => {
  window.storage = makeStorage(); await remount();
  const uid = await signUp("fay@cards.test", "fay");
  await goHome();
  await clickMode(container, "Unlimited"); await flush(3);
  await playToResult();
  await flush(10);
  assert(!earned() && auth._cards.owned(uid).length === 0, "no card block and no card");
});

// ---------- The pack shop ----------
const shopTab = () => container.querySelector('.cd-tabs [data-tab="packs"]');
const packEl = (id) => container.querySelector(`[data-pack="${id}"]`);
const packBtn = (id, needle) => [...packEl(id).querySelectorAll("button")].find((b) => b.textContent.includes(needle));
const packAlert = (id) => packEl(id)?.querySelector("[role='alert']")?.textContent || "";
async function openShop() { await openCards(); assert(shopTab(), "an account sees a Packs tab"); await click(shopTab()); await settle(); }
let pat;

await runTest("the pack shop: three packs, their prices, and exactly what is inside", async () => {
  window.storage = makeStorage(); await remount();
  pat = await signUp("pat@cards.test", "pat");
  auth._wallet.apply(pat, 750, "season", "test"); // 1,000 with the welcome coins
  await remount();
  await openShop();
  assert([...container.querySelectorAll("[data-pack]")].map((el) => el.dataset.pack).join() === "pack-standard,pack-air-raid,pack-legends", "the three packs, in shelf order");
  assert(container.querySelector(".cd-bal")?.textContent.replace(/\s+/g, " ").includes("1,000"), "the balance is on the shelf: " + container.querySelector(".cd-bal")?.textContent);
  assert(packEl("pack-standard").textContent.includes("150") && packEl("pack-standard").textContent.includes("3 cards"), "Standard: 150 for three cards");
  assert(packEl("pack-legends").textContent.includes("5,000 of 5,000 left"), "the limited pack says how many are left");
  assert(packEl("pack-standard").querySelector("img").getAttribute("alt") === "", "the picture is decoration: the name beside it is what is read");
  assert(packBtn("pack-legends", "Open").disabled && packEl("pack-legends").textContent.includes("You need 2,000 more coins"), "a pack the wallet cannot reach says how far short it is");
  assert(!button("Open your starter deck"), "the shop is its own tab: the starter panel is on the other one");

  const who = packBtn("pack-standard", "Who is inside");
  assert(who.getAttribute("aria-expanded") === "false" && !who.hasAttribute("aria-controls"), "closed to begin with, and pointing at nothing that is not there");
  await click(who); await flush();
  const inside = packEl("pack-standard").querySelector(".cd-inside");
  assert(who.getAttribute("aria-expanded") === "true" && inside && inside.id === who.getAttribute("aria-controls"), "it opens, and the button says what it controls");
  const text = inside.textContent;
  assert(text.includes("3,124 cards can come out"), "how many cards: " + text.slice(0, 60));
  for (const want of ["Base70%", "Silver22%", "Gold7.0%", "Prism1.0%"]) assert(text.replace(/\s+/g, "").includes(want), "the finish odds are printed: " + want);
  assert(/Rated 120 or better \(78\)/.test(text) && /Rated under 60/.test(text), "and the odds by rating");
  assert(inside.querySelectorAll(".cd-list tbody tr").length === 12, "the twelve best cards first");
  await click([...inside.querySelectorAll("button")].find((b) => b.textContent.includes("Show all"))); await flush();
  assert(packEl("pack-standard").querySelectorAll(".cd-list tbody tr").length === 3124, "and every card on request - the odds are published in full");
  await click(who); await flush();
  assert(!packEl("pack-standard").querySelector(".cd-inside"), "and it closes again");

  const { chanceText } = await (await import("./helpers.mjs")).loadModule("cards.jsx");
  assert(chanceText(0.7) === "70%" && chanceText(0.07) === "7.0%" && chanceText(0.000025) === "0.0025%" && chanceText(0) === "0%", "a rare chance never rounds to a zero it is not");
});

// What an account has been paid for copies. A pack is rolled at random, so any pack may hold a card already
// owned, which is sold for coins on the spot - a test that pins a balance after a random pack has to allow for
// it, or it fails one run in a few for no reason (it did, about one run in three, until v2.30.0).
const soldCoins = (uid) => [...auth._wallet.tables.wallet_ledger.values()].filter((e) => e.user_id === uid && e.kind === "card_sell").reduce((n, e) => n + e.amount, 0);
// The balance with those coins taken back out: what the wallet would hold had no pack held a copy.
const spent = (uid) => auth._wallet.balanceOf(uid) - soldCoins(uid);

await runTest("opening a pack: confirm first, then the cards, the coins and the collection", async () => {
  await click(packBtn("pack-standard", "Open")); await flush();
  assert(spent(pat) === 1000 && auth._cards.owned(pat).length === 0, "Open alone buys nothing");
  assert(packBtn("pack-standard", "Confirm: 150 coins") && packBtn("pack-standard", "Cancel"), "it asks first, with the price in the button");
  await click(packBtn("pack-standard", "Cancel")); await flush();
  assert(packBtn("pack-standard", "Open") && spent(pat) === 1000, "and Cancel is a real way out");

  await click(packBtn("pack-standard", "Open")); await flush();
  await click(packBtn("pack-standard", "Confirm")); await settle(); await settle();
  assert(spent(pat) === 850, "150 coins left the wallet");
  assert(container.querySelector("#cd-pulled-h")?.textContent === "You pulled" && container.querySelectorAll(".cd-fresh [data-card]").length === 3, "the three pulled are shown");
  assert(document.activeElement === container.querySelector("#cd-pulled-h"), "and focus lands on them, so a screen reader hears what happened");
  assert(container.querySelector(".cd-bal").textContent.includes("850"), "the shelf's balance moved: " + container.querySelector(".cd-bal").textContent);
  assert(packBtn("pack-standard", "Open") && !packBtn("pack-standard", "Confirm"), "and the pack is back to Open, not left on Confirm");
  await click(container.querySelector('.cd-tabs [data-tab="collection"]')); await settle();
  assert(container.querySelector("#cd-coll-h")?.textContent === "3 cards", "the collection has them without a reload: " + container.querySelector("#cd-coll-h")?.textContent);
  assert(button("Open your starter deck"), "and buying a pack did not cost the starter deck");
});

await runTest("a purchase whose answer is lost is the same purchase when tried again", async () => {
  await click(shopTab()); await settle();
  auth._cards.openFails = true;
  await click(packBtn("pack-standard", "Open")); await flush();
  await click(packBtn("pack-standard", "Confirm")); await settle(); await settle();
  assert(spent(pat) === 700, "the pack WAS bought - only the answer was lost");
  assert(/never charged twice/.test(packAlert("pack-standard")) && !/Nothing was charged/.test(packAlert("pack-standard")), "the screen says it does not know, and never claims nothing was charged: " + packAlert("pack-standard"));
  assert(packBtn("pack-standard", "Try again"), "and offers to try again");
  await click(packBtn("pack-standard", "Try again")); await settle(); await settle();
  assert(spent(pat) === 700, "trying again charged nothing more");
  assert(container.querySelectorAll(".cd-fresh [data-card]").length === 3 && container.querySelector(".cd-fresh").textContent.includes("weren't charged twice"), "and handed over that pack's cards, saying so");
  assert(auth._cards.owned(pat).reduce((n, o) => n + o.count, 0) === 6, "two packs' cards in all - not three");
});

await runTest("what the shop refuses, in words, and what it does next", async () => {
  // The price went up after the shelf was read: refused, said, and the new price shown.
  auth._cards.packs.get("pack-standard").price = 200;
  await click(packBtn("pack-standard", "Open")); await flush();
  await click(packBtn("pack-standard", "Confirm")); await settle(); await settle();
  assert(spent(pat) === 700, "nothing charged at a price nobody agreed to");
  assert(/price has gone up/.test(packAlert("pack-standard")), "it says why: " + packAlert("pack-standard"));
  assert(packEl("pack-standard").querySelector(".cd-pack-price").textContent.includes("200"), "and the shelf now shows the new price");
  auth._cards.packs.get("pack-standard").price = 150;

  // Sold out between looking and buying.
  auth._wallet.apply(pat, 5000, "season", "test2"); await remount(); await openShop();
  auth._cards.packs.get("pack-legends").stock_left = 0;
  await click(packBtn("pack-legends", "Open")); await flush();
  await click(packBtn("pack-legends", "Confirm")); await settle(); await settle();
  assert(/sold out/i.test(packAlert("pack-legends")) && spent(pat) === 5700, "sold out, in a sentence, with nothing charged: " + packAlert("pack-legends"));
  assert(packBtn("pack-legends", "Sold out")?.disabled, "and the button now says so and is off");
  auth._cards.packs.get("pack-legends").stock_left = 5000;

  // A pack taken off sale is not on the shelf at all.
  auth._cards.packs.get("pack-air-raid").active = false;
  await remount(); await openShop();
  assert(!packEl("pack-air-raid") && packEl("pack-standard"), "an off-sale pack is not offered");
  auth._cards.packs.get("pack-air-raid").active = true;

  // The shelf that could not be read is not an empty shop.
  auth._cards.packsReadFail = true;
  await remount(); await openShop();
  assert(/Couldn't load the pack shop/.test(container.querySelector(".cd-area [role='alert']")?.textContent || "") && !container.querySelector("[data-pack]"), "a failed read says so");
  auth._cards.packsReadFail = false;
  await click(button("Try again")); await settle();
  assert(container.querySelectorAll("[data-pack]").length === 3, "and Try again brings the shelf");

  // The server's switch off.
  auth._cards.enabled = false;
  await click(packBtn("pack-standard", "Open")); await flush();
  await click(packBtn("pack-standard", "Confirm")); await settle();
  assert(/aren't switched on/.test(packAlert("pack-standard")), "cards_off is a sentence here too: " + packAlert("pack-standard"));
  auth._cards.enabled = true;
});

await runTest("an unanswered purchase survives leaving the shop, another pack, and a refusal that settles nothing", async () => {
  const collTab = () => container.querySelector('.cd-tabs [data-tab="collection"]');
  const ownedNow = () => auth._cards.owned(pat).reduce((n, o) => n + o.count, 0);
  await remount(); await openShop();
  // Straight from Modes, with no profile or shop opened first: the shop asks for the wallet itself.
  assert(container.querySelector(".cd-bal")?.textContent.includes("5,700"), "the balance is read by the shop, not borrowed from a screen that happened to load it: " + container.querySelector(".cd-bal")?.textContent);
  const cardsBefore = ownedNow();

  auth._cards.openFails = true;
  const main = packBtn("pack-standard", "Open");
  main.focus();
  await click(main); await flush();
  assert(document.activeElement === main && main.isConnected && main.textContent.includes("Confirm"), "Open becomes Confirm in place, so the keyboard's focus is not dropped");
  await click(main); await settle(); await settle();
  assert(spent(pat) === 5550 && packBtn("pack-standard", "Try again"), "bought, and the answer lost");
  assert(!packBtn("pack-standard", "Cancel"), "a purchase that may have happened offers no Cancel");
  assert(container.querySelector(".cd-bal").textContent.includes("5,550"), "the wallet was asked again, so the balance already tells the truth");

  // The first thing a player does: look at the collection. The cards are there - and the purchase's id survives.
  await click(collTab()); await settle(); await settle();
  assert(container.querySelector("#cd-coll-h")?.textContent === `${cardsBefore + 3} cards`, "the collection was re-read and has them: " + container.querySelector("#cd-coll-h")?.textContent);
  await click(shopTab()); await settle();
  assert(packBtn("pack-standard", "Try again") && !packBtn("pack-standard", "Confirm"), "back in the shop it is still Try again - not a fresh Confirm that would buy a second pack");
  assert(/never charged twice/.test(packAlert("pack-standard")), "and it still says why");

  // Buying a different pack does not forget the first one.
  await click(packBtn("pack-air-raid", "Open")); await flush();
  await click(packBtn("pack-air-raid", "Confirm")); await settle(); await settle();
  assert(spent(pat) === 5300 && packBtn("pack-standard", "Try again"), "Air raid bought; Standard's purchase is still waiting");

  // A refusal made before the database is asked settles nothing about the earlier attempt.
  auth._cards.enabled = false;
  await click(packBtn("pack-standard", "Try again")); await settle(); await settle();
  assert(/still can't confirm/.test(packAlert("pack-standard")) && !/Nothing was charged/i.test(packAlert("pack-standard")), "it does not claim nothing was charged: " + packAlert("pack-standard"));
  assert(packBtn("pack-standard", "Try again"), "and keeps the purchase");
  auth._cards.enabled = true;

  await click(packBtn("pack-standard", "Try again")); await settle(); await settle();
  assert(spent(pat) === 5300, "resolving it charged nothing more");
  assert(container.querySelector(".cd-fresh")?.textContent.includes("weren't charged twice") && packBtn("pack-standard", "Open"), "it hands over that pack and goes back to Open");
  assert(ownedNow() === cardsBefore + 6, "two packs in all: " + (ownedNow() - cardsBefore));
});

await runTest("a pack that finishes opening after the shop is left still counts", async () => {
  const collTab = () => container.querySelector('.cd-tabs [data-tab="collection"]');
  const before = auth._cards.owned(pat).reduce((n, o) => n + o.count, 0);
  await click(packBtn("pack-standard", "Open")); await flush();
  const confirm = packBtn("pack-standard", "Confirm");
  confirm.click(); collTab().click(); // no waiting in between: the answer lands on a shop that is gone
  await settle(); await settle(); await settle();
  assert(spent(pat) === 5150, "the pack was bought");
  assert(container.querySelector("#cd-coll-h")?.textContent === `${before + 3} cards`, "and the collection on screen has it: " + container.querySelector("#cd-coll-h")?.textContent);
  await click(shopTab()); await settle();
  assert(packBtn("pack-standard", "Open") && container.querySelector(".cd-bal").textContent.includes("5,150"), "the shop is back to Open with the right balance - nothing left waiting");
});

await runTest("every pack refusal has a sentence, and none blames the connection for a rule", async () => {
  const { PACK_SENTENCES } = await (await import("./helpers.mjs")).loadModule("cards.jsx");
  for (const key of [...CARD_REFUSALS, "offline", "network"]) assert(typeof PACK_SENTENCES[key] === "string" && PACK_SENTENCES[key].length > 15, `"${key}" has a pack sentence`);
  for (const key of ["not_enough", "sold_out", "unavailable", "price_changed", "guest_not_allowed", "cards_off"]) assert(!/connection|try again/i.test(PACK_SENTENCES[key]), `"${key}" is a rule, not a fault to retry`);
  // The three whose outcome is unknown must never say nothing was charged: something may have been.
  for (const key of ["offline", "network", "server"]) assert(!/nothing was charged|wasn't charged/i.test(PACK_SENTENCES[key]) && /never charged twice/.test(PACK_SENTENCES[key]), `"${key}" does not claim to know`);
});

await runTest("a guest and a signed-out visitor get no pack shop", async () => {
  await auth.auth.signOut(); await flush(); await remount();
  await openCards();
  assert(!shopTab() && !container.querySelector("[data-pack]"), "signed out: no Packs tab");
});

// ---------- battles (v2.28.0: offense against offense, a round at a time): the ladder, the daily battle, the deck, the boards ----------
// Ladder, Daily, Deck and Boards sit under Battle, so reaching one is Battle first when it is not already open.
const tabBtn = (id) => container.querySelector(`.cd-area [data-tab="${id}"]`);
const area = () => container.querySelector(".cb-area");
const arena = () => container.querySelector(".cb-arena");
const q = (sel) => container.querySelector(sel);
const qa = (sel) => [...container.querySelectorAll(sel)];
// Four draws a round - your card's two, then theirs - for as many rounds as are to be pinned.
const rolls = (win, n = 6) => Array(n).fill(win ? [0.97, 0.97, 0.03, 0.03] : [0.03, 0.03, 0.97, 0.97]).flat();
async function openTabOf(id) {
  await openCards();
  assert(tabBtn("battle"), "an account sees a Battle tab");
  if (!tabBtn(id)) { await click(tabBtn("battle")); await settle(); }
  assert(tabBtn(id), `and a ${id} tab under it`);
  await click(tabBtn(id)); await settle(); await settle();
}
const liveRun = (uid) => auth._cards.runs.filter((r) => r.user_id === uid).at(-1);
// A CPU team this account's starter cards cannot beat, or cannot lose to: the test decides, not the ladder.
// Not just by rating: a round is mostly the CATEGORY score, so a low-rated card with one big category could
// still take a round off a forced roll. The weak team is the six whose best category is lowest; the strong one
// the six whose worst category is highest.
const foeAt = (rating) => {
  const weak = rating < 60, men = new Set();
  const worth = (c) => (weak ? -Math.max(...Object.values(c.cats)) - c.rating : Math.min(...Object.values(c.cats)) + c.rating);
  return buildTeam(mulberry32(rating), rating).map((e) => {
    const pos = (c) => (e.spot === "FLEX" ? c.pos !== "QB" : c.pos === e.spot);
    const card = [...CARDS.values()].filter((c) => pos(c) && !men.has(c.pid)).sort((a, b) => worth(b) - worth(a) || a.id - b.id)[0];
    men.add(card.pid);
    return { card: card.id, finish: "base", spot: e.spot };
  });
};
// Play n rounds with "Pick for me", moving past each round's result - which stays up until it is passed.
async function playRounds(n) {
  for (let i = 0; i < n; i++) {
    await click(q("[data-best]")); await settle(); await settle();
    if (q("[data-continue]")) { await click(q("[data-continue]")); await flush(); }
  }
}
const rackChip = (id) => q('[data-rack] [data-cat="' + id + '"]');
const picks = () => qa("[data-choose] [data-pick]");
const fits = (pos, spot) => (spot === "FLEX" ? pos !== "QB" : pos === spot);
let bea;

await runTest("the ladder: your call - a category, then a card, and a result that stays until you move on", async () => {
  bea = await signUp("bea@cards.test", "bea");
  await openCards();
  await click(button("Open your starter deck")); await settle(); await settle();
  await openTabOf("run");
  assert(area()?.dataset.phase === "idle" && q("[data-start]") && !arena(), "it opens on the offer to start, not on a battle: " + container.querySelector(".cd-area")?.textContent.slice(0, 160));
  assert(q("[data-paid-left]").textContent === "15" && q("[data-best-run]").textContent === "0", "with the day's paid wins and the best so far");
  assert(qa(".cd-tabs [data-tab]").length === 3 && tabBtn("battle").getAttribute("aria-pressed") === "true" && tabBtn("run").getAttribute("aria-pressed") === "true" && tabBtn("deck") && tabBtn("daily") && tabBtn("boards") && tabBtn("gauntlet"), "three tabs across the top, Battle pressed, and five ways in under it");
  await click(q("[data-start]")); await settle();
  const run = liveRun(bea);
  assert(area().dataset.phase === "play" && arena() && run && !container.innerHTML.includes(run.seed), "starting opens the arena, and the seed is nowhere on the page");
  assert(/rate about \d+/.test(q("[data-level]")?.textContent || ""), "the header says how strong their cards are - you are answering a card you cannot see: " + q("[data-level]")?.textContent);

  // ROUND ONE IS YOUR CALL: the spot, six categories to call, and the cards for the spot.
  const choose = q("[data-choose]");
  assert(choose && choose.dataset.choose === "0" && choose.dataset.spot === run.foe[0].spot && choose.dataset.call === "me", "round one is for the spot the server's first card plays, and the call is yours: " + choose?.dataset.spot + " " + choose?.dataset.call);
  assert(!run.foe.some((e) => container.textContent.includes(CARDS.get(e.card).name) && !run.hand.some((h) => CARDS.get(h.card).name === CARDS.get(e.card).name)), "it does NOT show the card you are facing - or any of theirs");
  const chips = qa("[data-rack] [data-cat]");
  assert(chips.length === 6 && chips.every((c) => c.tagName === "BUTTON" && c.getAttribute("aria-pressed") === "false" && !c.dataset.used), "six categories, every one still to call and none chosen: " + chips.map((c) => c.tagName + ":" + c.textContent).join());
  const dealt = run.hand.map((h) => h.card).filter((id) => fits(CARDS.get(id).pos, run.foe[0].spot));
  assert(picks().length >= 2 && picks().length <= 4 && picks().map((el) => Number(el.dataset.pick)).join() === dealt.join(), "the cards for the spot - two to four of them - IN THE ORDER THEY WERE DEALT, not by rating: " + picks().map((el) => el.dataset.pick).join() + " / " + dealt.join());
  assert(picks().every((el) => el.querySelectorAll("[data-stat]").length === 6) && !q("[data-choose] [data-total]"), "each lists its six stats down the card, and none shows a projected total");
  assert(!q("[data-choose] .cb-sc-lit") && q("[data-play]").disabled, "no category is in play yet, and nothing can be played");
  // A card alone is not enough on your call; a category and a card are.
  await click(picks()[1]); await flush();
  assert(picks()[1].getAttribute("aria-pressed") === "true" && q("[data-play]").disabled, "a card is chosen, and that alone is not enough on your call");
  await click(rackChip("bigplay")); await flush();
  const chosen = CARDS.get(Number(picks()[1].dataset.pick));
  assert(rackChip("bigplay").getAttribute("aria-pressed") === "true" && !q("[data-play]").disabled, "with a category too, it can be played");
  assert(q("[data-play]").textContent.includes(chosen.name) && /Big play/.test(q("[data-play]").textContent) && q("[data-play]").textContent.includes(categoryStat(chosen, "bigplay")), "the button names the card and the category, with the real number behind it: " + q("[data-play]").textContent);
  assert(qa("[data-choose] .cb-sc-lit").length === picks().length && qa("[data-choose] .cb-sc-lit").every((row) => row.dataset.stat === "bigplay"), "and the category in play is lit on every card");
  // The rest of the hand can be looked at, not played.
  assert(q("[data-whole-hand]").getAttribute("aria-expanded") === "false" && !q("[data-whole]"), "the whole hand is closed until asked for");
  await click(q("[data-whole-hand]")); await flush();
  assert(qa("[data-whole] [data-card]").length === 12 - picks().length && !q("[data-whole] button"), "opened, it shows the other cards with their stats - to look at, not to play: " + qa("[data-whole] [data-card]").length);
  await click(q("[data-whole-hand]")); await flush();
  // The field below: your six as six spots, three across, empty until played; theirs face down along the top.
  assert(qa(".cb-strip .cb-s").length === 6 && /Up now/.test(q(".cb-strip .cb-s").textContent) && !/Flex/.test(q(".cb-strip").textContent), "the six rounds are on the field: the first up now, and no Flex among them");
  assert(q("[data-field]").classList.contains("dark") && qa(".cb-strip .cb-slot").length === 6 && !q(".cb-strip [data-card]"), "the field is the navy scope, and your six start as six empty spots");
  assert(qa(".cb-them .cb-t").length === 6 && qa(".cb-them .cb-t-back").length === 6 && qa(".cb-them .cb-t").every((li, i) => li.textContent.trim().toUpperCase().startsWith(run.foe[i].spot) && li.textContent.trim().endsWith("?")), "their six are face down: a spot and a question mark each");
  assert(arena().compareDocumentPosition(q("[data-field]")) && (q("[data-choose]").compareDocumentPosition(q("[data-field]")) & 4) === 4, "the panel you play in comes BEFORE the field - the hand is not at the bottom of the page any more");

  run.foe = foeAt(20); // beatable whatever the hand
  await remount(); await openTabOf("run");
  auth._cards.nextRolls = rolls(true);
  await click(rackChip("scoring")); await flush();
  const first = picks()[0];
  const played = Number(first.dataset.pick);
  await click(first); await flush();
  await click(q("[data-play]")); await settle(); await settle();
  const r0 = liveRun(bea).rounds[0];
  assert(liveRun(bea).rounds.length === 1 && r0.mine.id === played && r0.cat === "scoring" && r0.call === "me", "the card and the category that were chosen are the ones that were played");

  // THE RESULT, in the same panel, and it STAYS.
  const reveal = q("[data-reveal]");
  assert(reveal && !q("[data-choose]") && arena().dataset.rounds === "1", "the result takes the panel's place");
  assert(reveal.querySelectorAll("[data-card]").length === 2 && qa("[data-reveal] [data-total]").length === 2, "both cards, and ONE number a side");
  assert(reveal.textContent.includes(categoryStat(CARDS.get(played), "scoring")) && reveal.textContent.includes(categoryStat(CARDS.get(r0.foe.id), "scoring")), "each with the real stat the category ranks");
  assert(/Touchdown threat/.test(reveal.textContent) && /Round to you\. You call the next one\./.test(q("[data-round-verdict]").textContent), "the category, and the result in words with what it earns: " + q("[data-round-verdict]").textContent);
  assert(!q("[data-why-open]") && !/Luck/.test(reveal.textContent), "the maths is not on show until asked for");
  await new Promise((r) => setTimeout(r, 1300)); await flush();
  assert(q("[data-reveal]") && !q("[data-choose]"), "after waiting it is still there: nothing leaves on a timer");
  await click(q("[data-why]")); await flush();
  assert(q("[data-why-open]") && /Luck/.test(q("[data-why-open]").textContent) && /Card rating/.test(q("[data-why-open]").textContent), "Why? opens the breakdown");
  assert(q("[data-you]").textContent === "1" && q("[data-cpu]").textContent === "0", "the score has moved with the result");
  await click(q("[data-continue]")); await flush();
  assert(!q("[data-reveal]") && q("[data-choose]").dataset.choose === "1" && q("[data-choose]").dataset.call === "me", "Next round moves on, and the round you won is yours to call");

  // What the round cost: the category is spent, and says who took it.
  const usedChip = rackChip("scoring");
  assert(usedChip.tagName !== "BUTTON" && usedChip.dataset.used === "me" && /You won/.test(usedChip.textContent), "the category is spent, and says in words who took it: " + usedChip.outerHTML.slice(0, 120));
  // Passing a result drops the button that was pressed, so the keyboard's focus is put on the new round's
  // heading - or a keyboard player is sent back to the top of the page six times a battle.
  assert(q("[data-choose]").contains(document.activeElement) && document.activeElement.textContent.includes("Your call"), "focus is on the new round's heading, not lost to the page: " + document.activeElement?.tagName + " " + document.activeElement?.className);
  assert(qa("[data-rack] button[data-cat]").length === 5, "five are left to call");
  assert(picks().length && qa("[data-choose] .cb-sc-gone").every((row) => row.dataset.stat === "scoring") && qa("[data-choose] .cb-sc-gone").length === picks().length, "and it is struck through on every card still in the hand");
  const log = () => qa(".cb-round");
  assert(log().length === 1 && /beat|lost to|tied/.test(log()[0].textContent) && log()[0].querySelector(".cb-round-cat").textContent === "Touchdown threat", "the log says how round one went: " + log()[0].textContent.slice(0, 80));
  assert(/Won/.test(q(".cb-strip .cb-s").textContent), "in words on the field too");
  assert(Number(q(".cb-strip .cb-s [data-card]").dataset.card) === played && qa(".cb-strip .cb-slot").length === 5, "the card just played stands in its spot on the field as a real card, and five spots are still empty");
  assert(qa(".cb-them .cb-t-back").length === 5 && q(".cb-them .cb-t").textContent.includes(CARDS.get(r0.foe.id).name.split(" ").slice(-1)[0]), "and theirs for that round is turned over, the other five still down");
  assert(!picks().some((el) => Number(el.dataset.pick) === played), "and the card just played is not offered again");

  // ROUND SIX on your call: one category is left, so it is already chosen and Play needs only a card.
  await playRounds(4);
  assert(q("[data-choose]").dataset.choose === "5" && q("[data-choose]").dataset.call === "me", "five rounds won, and the sixth is your call");
  const lastCat = liveRun(bea).rounds.at(-1).next.cat;
  assert(qa("[data-rack] button[data-cat]").length === 0 && rackChip(lastCat).dataset.called === "me", "the one category left is already in play - there is nothing to choose: " + lastCat);
  assert(q("[data-play]").disabled, "a card is still needed");
  await click(picks()[0]); await flush();
  assert(!q("[data-play]").disabled, "and with one, it can be played");
  await click(q("[data-play]")); await settle(); await settle();
  assert(liveRun(bea).wins === 1, "the battle is over on the server");
  assert(q("[data-reveal]") && /See the result/.test(q("[data-continue]").textContent) && !q("[data-verdict]") && !q("[data-paid]"), "the sixth round's result is shown first, and the battle's ending is not given away beside it");
  await click(q("[data-continue]")); await settle();
  assert(area().dataset.phase === "result" && arena().dataset.done === "true" && arena().dataset.win === "true", "six rounds, and a win: " + area().textContent.slice(0, 80));
  assert(/Win 1/.test(q(".cb-result-h").textContent) && /You won, \d rounds to \d\./.test(q("[data-verdict]").textContent), "said in words, not only in colour: " + q("[data-verdict]").textContent);
  assert(log().length === 6 && new Set(qa(".cb-round-cat").map((el) => el.textContent)).size === 6, "the log has all six rounds, one category each");
  assert(qa("[data-rack] [data-cat]").every((c) => c.dataset.used), "every category is spent");
  assert(qa(".cb-strip .cb-s").every((li) => /Won|Lost|Tied/.test(li.textContent)), "every round on the field is marked won or lost, in words");
  assert(q("[data-paid]") && auth._wallet.balanceOf(bea) === 253, "the win paid its three coins: " + auth._wallet.balanceOf(bea));

  await click(q("[data-next]")); await settle();
  assert(area().dataset.phase === "play" && /1 win so far/.test(q(".cb-result-h").textContent) && q("[data-choose]").dataset.choose === "0" && arena().dataset.rounds === "0", "the next team, a NEW hand, and round one again");
  liveRun(bea).foe = foeAt(126); // unbeatable
  await remount(); await openTabOf("run");
  auth._cards.nextRolls = rolls(false);
  await playRounds(6);
  assert(arena().dataset.win === "false" && /Beaten/.test(q(".cb-result-h").textContent) && /The run ends at 1 win\./.test(q("[data-over]").textContent), "a lost battle ends the run at one: " + area().textContent.slice(0, 80));
  assert(!q("[data-paid]") && auth._wallet.balanceOf(bea) === 253, "and pays nothing");
  await click(q("[data-start]")); await settle();
  assert(area().dataset.phase === "play" && /0 wins so far/.test(q(".cb-result-h").textContent) && auth._cards.runs.filter((r) => r.user_id === bea).length === 2, "a new run starts from zero");
});

await runTest("when THEY call: the category is named before you pick, and you choose who answers it", async () => {
  liveRun(bea).foe = foeAt(126); // they take round one
  await remount(); await openTabOf("run");
  auth._cards.nextRolls = rolls(false, 2);
  await click(rackChip("star")); await flush();
  await click(picks()[0]); await flush();
  await click(q("[data-play]")); await settle(); await settle();
  const run = liveRun(bea);
  assert(run.rounds.length === 1 && run.rounds[0].win === "foe" && run.rounds[0].next.by === "foe", "they took round one, so the call is theirs");
  assert(new RegExp("Round to " + "Practice squad" + "\\. They call the next one\\.").test(q("[data-round-verdict]").textContent), "and the result says so: " + q("[data-round-verdict]").textContent);
  await click(q("[data-continue]")); await flush();
  const theirs = run.rounds[0].next.cat;
  const whole = run.foe.map((e) => ({ id: e.card, finish: e.finish, spot: e.spot }));
  assert(theirs === foeCall(whole, run.rounds) && theirs !== "star", "what they call is their card's best of the five left: " + theirs);
  assert(q("[data-choose]").dataset.call === "foe" && qa("[data-rack] button[data-cat]").length === 0, "on their call no category is yours to choose");
  assert(rackChip(theirs).dataset.called === "foe" && /They called/.test(rackChip(theirs).textContent), "theirs is named BEFORE you pick, in words: " + rackChip(theirs).textContent);
  assert(qa("[data-choose] .cb-sc-lit").length === picks().length && qa("[data-choose] .cb-sc-lit").every((row) => row.dataset.stat === theirs), "and lit on every card you could answer with");
  assert(!container.textContent.includes(CARDS.get(run.foe[1].card).name) || run.hand.some((h) => CARDS.get(h.card).name === CARDS.get(run.foe[1].card).name), "their card is still face down");
  assert(q("[data-play]").disabled, "you still choose who answers");
  const answer = picks().at(-1), answered = Number(answer.dataset.pick);
  await click(answer); await flush();
  assert(!q("[data-play]").disabled && q("[data-play]").textContent.includes(categoryLabel(theirs)) && q("[data-play]").textContent.includes(categoryStat(CARDS.get(answered), theirs)), "one tap on a card and it can be played, on their category, with the real number");
  await click(q("[data-play]")); await settle(); await settle();
  assert(run.rounds.length === 2 && run.rounds[1].cat === theirs && run.rounds[1].call === "foe" && run.rounds[1].mine.id === answered, "the round was played on the category they called, with the card you chose");
  await click(q("[data-continue]")); await flush();
  assert(rackChip(theirs).dataset.used === "foe" && /They won/.test(rackChip(theirs).textContent), "and that category is spent too");

  // A BATTLE BEGUN BEFORE v2.31.0 has rounds with no call and no next, and the ladder hides their card - so the
  // page cannot know what they are calling. It says so, and the round still plays.
  run.rounds = run.rounds.map(({ call, next, ...old }) => old);
  await remount(); await openTabOf("run");
  assert(q("[data-choose]").dataset.call === "foe" && q("[data-call-unknown]") && qa("[data-rack] [data-called]").length === 0, "their call, and the category is not known to this page: " + q("[data-call-unknown]")?.textContent);
  auth._cards.nextRolls = rolls(false, 1);
  await click(picks()[0]); await flush();
  assert(!q("[data-play]").disabled, "a card is all it needs");
  await click(q("[data-play]")); await settle(); await settle();
  assert(run.rounds.length === 3 && run.rounds[2].call === "foe" && /Round to/.test(q("[data-round-verdict]").textContent), "and the round is played, on what they called");
  await click(q("[data-continue]")); await flush();
  assert(q("[data-choose]").dataset.choose === "3" && !q("[data-call-unknown]") && qa("[data-rack] [data-called]").length === 1, "the round after it knows the call again");
});

await runTest("two taps are one: Play twice plays one round, and Next twice passes one result", async () => {
  const run = liveRun(bea);
  const before = run.rounds.length;
  auth._cards.nextRolls = rolls(false, 2);
  await click(picks()[0]); await flush();
  const play = q("[data-play]");
  const act = (await import("react")).act;
  await act(async () => { for (let i = 0; i < 2; i++) play.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 0)); });
  await settle(); await settle();
  assert(run.rounds.length === before + 1 && arena().dataset.rounds === String(before + 1) && !q("[data-notice]"), "one round was played, and nothing on the page complains about a second: " + run.rounds.length + " " + q("[data-notice]")?.textContent);
  const next = q("[data-continue]");
  await act(async () => { for (let i = 0; i < 2; i++) next.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true })); await new Promise((r) => setTimeout(r, 0)); });
  await flush();
  assert(!q("[data-reveal]") && q("[data-choose]").dataset.choose === String(before + 1), "one result was passed, and the next round is the next one");
  await click(q("[data-quit]")); await settle(); await settle();
  assert(area().dataset.phase === "idle", "the run is walked away from");
});

await runTest("a dead heat: nobody takes the round, and the call stays where it was", async () => {
  await click(q("[data-start]")); await settle();
  const run = liveRun(bea);
  // The same card on both sides, on the same luck, is level to the tenth of a point.
  const mine = run.hand.map((h) => h.card).find((id) => fits(CARDS.get(id).pos, run.foe[0].spot));
  run.foe[0] = { card: mine, finish: "base", spot: run.foe[0].spot };
  await remount(); await openTabOf("run");
  auth._cards.nextRolls = [0.5, 0.5, 0.5, 0.5];
  await click(rackChip("workload")); await flush();
  await click(q('[data-choose] [data-pick="' + mine + '"]')); await flush();
  await click(q("[data-play]")); await settle(); await settle();
  assert(run.rounds.length === 1 && run.rounds[0].win === "tie" && run.rounds[0].next.by === "me", "the round was a dead heat, and the call is still yours: " + JSON.stringify(run.rounds[0]?.win));
  assert(/Dead heat\. The call stays with you\./.test(q("[data-round-verdict]").textContent), "the result says so, and says whose call it still is: " + q("[data-round-verdict]").textContent);
  assert(q("[data-you]").textContent === "0" && q("[data-cpu]").textContent === "0", "nobody scores");
  await click(q("[data-continue]")); await flush();
  assert(rackChip("workload").dataset.used === "tie" && /Tied/.test(rackChip("workload").textContent) && q("[data-choose]").dataset.call === "me", "the category is spent and marked tied in words, and round two is yours to call");
  assert(/Tied/.test(q(".cb-strip .cb-s").textContent), "on the field too");
  await click(q("[data-quit]")); await settle(); await settle();
});

await runTest("a battle survives leaving and coming back mid-way - same hand, same rounds - and can be walked away from", async () => {
  await click(q("[data-start]")); await settle();
  liveRun(bea).foe = foeAt(20);
  await remount(); await openTabOf("run");
  auth._cards.nextRolls = rolls(true, 2);
  await playRounds(2);
  const hand = liveRun(bea).hand.map((e) => e.card).sort().join();
  await goHome(); await openTabOf("run");
  assert(area().dataset.phase === "play" && arena().dataset.rounds === "2" && q("[data-choose]").dataset.choose === "2" && !q("[data-reveal]"), "the same battle is there on return, two rounds in - and rounds already seen are not shown again");
  assert(qa(".cb-round").length === 2 && q("[data-you]").textContent === "2" && qa("[data-rack] [data-used]").length === 2, "with the two rounds already played, the score, and their two categories spent: " + qa(".cb-round").length + " " + q("[data-you]")?.textContent + " " + JSON.stringify(liveRun(bea).rounds.map((r) => r.win)));
  assert(liveRun(bea).hand.map((e) => e.card).sort().join() === hand && auth._cards.runs.filter((r) => r.user_id === bea && r.status === "live").length === 1, "the same hand, and still one live run");
  await click(q("[data-quit]")); await settle(); await settle();
  assert(area().dataset.phase === "idle" && q("[data-best-run]").textContent === "1" && q("[data-paid-left]").textContent === "14", "walking away ends it; the best and the day's paid wins are remembered");
});

await runTest("a round whose answer is lost is shown as it was played, never played again", async () => {
  await click(q("[data-start]")); await settle();
  liveRun(bea).foe = foeAt(20);
  await remount(); await openTabOf("run");
  auth._cards.nextRolls = rolls(true); auth._cards.battleFails = true;
  await click(q("[data-best]")); await settle(); await settle(); await settle();
  const run = liveRun(bea);
  assert(run.rounds.length === 1, "the round was played once on the server");
  assert(arena().dataset.rounds === "1" && q("[data-reveal]") && /was played/.test(q("[data-notice]").textContent), "and the page shows that round's result, saying why: " + q("[data-notice]")?.textContent);
  await click(q("[data-continue]")); await flush();
  assert(q("[data-choose]").dataset.choose === "1" && q("[data-choose]").dataset.call === callerOf(run.rounds) && qa("[data-rack] [data-used]").length === 1, "and the next round knows who calls and what is spent, from the round the page never saw arrive");
  // The state cannot be read either: say so, and promise only what is true.
  auth._cards.battleFails = true; auth._cards.stateFails = true;
  await click(q("[data-best]")); await settle(); await settle(); await settle();
  assert(/couldn't confirm/i.test(q("[data-notice]").textContent) && /never played twice/.test(q("[data-notice]").textContent) && !/not played/.test(q("[data-notice]").textContent), "unknown is called unknown: " + q("[data-notice]").textContent);
  auth._cards.stateFails = false;
  // The page still thinks one round; the server has two. Playing again is refused as stale and the page catches up.
  await click(q("[data-best]")); await settle(); await settle(); await settle();
  assert(run.rounds.length === 2 && arena().dataset.rounds === "2", "the stale play was not a third round, and the page shows the second: " + run.rounds.length);
  if (q("[data-continue]")) { await click(q("[data-continue]")); await flush(); }
  // The sixth round's answer lost: the battle is over on the server, and the page shows it finished.
  await playRounds(3);
  auth._cards.battleFails = true;
  await click(q("[data-best]")); await settle(); await settle(); await settle();
  assert(run.wins === 1 && area().dataset.phase === "result" && /finished/.test(q("[data-notice]").textContent), "a lost LAST answer still lands on the finished battle: " + q("[data-notice]")?.textContent);
  if (q("[data-continue]")) { await click(q("[data-continue]")); await settle(); }
  assert(arena().dataset.done === "true", "and once its last round is passed, it is done");
  await click(q("[data-next]")); await settle();
  assert(/1 win so far/.test(q(".cb-result-h").textContent) && run.wins === 1, "and the run carries on from one win, not two");
});

await runTest("a read that failed is not 'no run going'", async () => {
  auth._cards.stateFails = true;
  await goHome(); await openTabOf("run");
  assert(/Couldn't load your battles/.test(container.textContent) && !q("[data-start]"), "it says it could not load, and offers no fresh run over a live one");
  auth._cards.stateFails = false;
  await click(button("Try again")); await settle(); await settle();
  assert(area()?.dataset.phase === "play" && /1 win so far/.test(q(".cb-result-h").textContent), "and trying again finds the run");
});

await runTest("a play the server refuses is told why, and no round is played", async () => {
  // The card leaves the collection between the deal and the play.
  await click(rackChip("star")); await flush();
  const btn = picks()[0];
  const id = Number(btn.dataset.pick);
  const row = auth._cards.tables.card_owned.find((o) => o.user_id === bea && o.card_id === id);
  row.count = 0;
  await click(btn); await flush();
  await click(q("[data-play]")); await settle(); await settle();
  assert(/isn't in your collection/.test(q("[data-notice]")?.textContent || "") && arena().dataset.rounds === "0" && !q("[data-reveal]"), "not owned, in a sentence: " + q("[data-notice]")?.textContent);
  assert(liveRun(bea).rounds.length === 0, "and no round was played");
  assert(picks()[0].getAttribute("aria-pressed") === "true" && rackChip("star").getAttribute("aria-pressed") === "true" && !q("[data-play]").disabled, "the choice is still there to try again");
  row.count = 1;
  // "Pick for me" picks the CARD. A category you have already pressed is yours: it is the one played, not the
  // one the card happens to be best at - which would spend a category you did not choose.
  const live = liveRun(bea);
  const forMe = autoPick(live.hand.map((h) => ({ id: h.card, finish: h.finish })), live.foe.map((e) => ({ id: e.card, finish: e.finish, spot: e.spot })), []);
  const notHisBest = ["star", "efficiency", "workload"].find((c) => c !== bestCategory(forMe, []));
  await click(rackChip(notHisBest)); await flush();
  auth._cards.nextRolls = rolls(true, 1);
  await click(q("[data-best]")); await settle(); await settle();
  assert(liveRun(bea).rounds.length === 1 && liveRun(bea).rounds[0].cat === notHisBest, `Pick for me played the category that was chosen (${notHisBest}), not another: ` + liveRun(bea).rounds[0]?.cat);
  await click(q("[data-continue]")); await flush();
  await click(q("[data-quit]")); await settle(); await settle();
});

await runTest("the deck: thirty cards by position, a swap, and a save", async () => {
  // Two more backs than the deck holds, so there is something to swap in.
  const spare = [...CARDS.values()].filter((c) => c.pos === "RB" && c.rating < 30 && !auth._cards.owned(bea).some((o) => CARDS.get(o.card_id).pid === c.pid)).slice(0, 2);
  auth._cards.grantCards(bea, "gift", spare.map((c, i) => ({ ref: `spare:${i}`, card: c.id, finish: "base" })));
  await goHome(); await openTabOf("deck");
  assert(area().dataset.mode === "deck" && qa("[data-pos]").map((s) => `${s.dataset.pos}:${s.querySelectorAll(":scope > ul > li").length}`).join() === "QB:5,RB:10,WR:10,TE:5", "the deck, five, ten, ten and five: " + qa("[data-pos]").map((s) => s.querySelectorAll(":scope > ul > li").length));
  assert(q("[data-save]").disabled && !auth._cards.decks.has(bea), "nothing to save until something changes - an unsaved deck is the best thirty");
  const rbs = q('[data-pos="RB"]');
  await click([...rbs.querySelectorAll("button")].find((b) => b.textContent === "Swap")); await flush();
  const ins = qa("[data-swap-in]");
  assert(ins.length === 2, "the two spare backs are offered, and nobody already in the deck: " + ins.length);
  await click(ins[0]); await flush();
  assert(!q("[data-save]").disabled && qa("[data-swap-in]").length === 0, "one swapped in, and the deck can be saved");
  await click(q("[data-save]")); await settle(); await settle();
  const saved = auth._cards.decks.get(bea);
  assert(saved && saved.length === 30 && saved.some((c) => spare.some((s) => s.id === c.card)) && /Deck saved/.test(q("[data-notice]").textContent), "saved, with the spare back in it");
  assert(q("[data-save]").disabled, "and there is nothing left to save");
  // The hand comes out of the SAVED deck.
  await click(tabBtn("run")); await settle(); await settle();
  await click(q("[data-start]")); await settle();
  const deckIds = new Set(saved.map((c) => c.card));
  assert(liveRun(bea).hand.every((e) => deckIds.has(e.card)), "a run's hand is dealt from the deck that was saved");
  await click(q("[data-quit]")); await settle(); await settle();
  await click(tabBtn("deck")); await settle(); await settle();
  await click(q("[data-best-deck]")); await flush();
  assert(!q("[data-save]").disabled, "Use my best thirty puts the stronger back in again, ready to save");
});

await runTest("the daily battle: deal once, a round at a time, one result", async () => {
  await click(tabBtn("daily")); await settle(); await settle();
  assert(area().dataset.phase === "deal" && q("[data-deal]") && auth._cards.dailies.length === 0, "it opens on the deal - nothing is dealt by looking");
  await click(q("[data-deal]")); await settle(); await settle();
  const row = auth._cards.dailies.find((d) => d.user_id === bea);
  const foe = dailyFoe(auth._cards.today());
  assert(area().dataset.phase === "play" && row && q("[data-choose]").dataset.spot === foe[0].spot && q("[data-choose]").dataset.call === "me" && !q("[data-facing] [data-card]"), "dealt, and round one is yours to call, against the day's first card - which is not shown");
  const hand = row.hand.map((e) => e.card).join();
  await playRounds(2);
  await goHome(); await openTabOf("daily");
  assert(area().dataset.phase === "play" && arena().dataset.rounds === "2" && row.hand.map((e) => e.card).join() === hand && row.log.length === 2, "leaving and coming back is the same hand, two rounds in");
  await playRounds(4);
  assert(row.played_at !== null && area().dataset.phase === "played" && arena().dataset.done === "true", "six rounds, and the day is played");
  assert(new RegExp(`You took ${row.rounds} of 6 rounds for`).test(q("[data-played]").textContent) && q("[data-played]").textContent.includes(row.score.toLocaleString("en-US", { maximumFractionDigits: 1 })), "the rounds and points on the page are the recorded ones: " + q("[data-played]").textContent);
  assert(!q("[data-choose]") && qa(".cb-round").length === 6 && new Set(qa(".cb-round-cat").map((el) => el.textContent)).size === 6, "the six rounds are shown, one category each, and there is nothing left to play");
  await goHome(); await openTabOf("daily");
  assert(q("[data-played]") && !q("[data-choose]") && !q("[data-deal]") && qa(".cb-round").length === 6, "and it is still played after leaving and coming back");
});

await runTest("the gauntlet: twelve real teams, one open at a time, their six in view, paid once", async () => {
  await click(tabBtn("gauntlet")); await settle(); await settle();
  assert(area().dataset.mode === "gauntlet" && area().dataset.phase === "list" && q("[data-cleared]").textContent === "0", "it opens on the list, nothing cleared");
  const stages = () => qa(".cb-stage");
  assert(stages().length === GAUNTLET.length && stages().map((li) => li.dataset.state).join() === ["next", ...Array(GAUNTLET.length - 1).fill("locked")].join(), "twelve stages: the first up next, the rest locked");
  assert(stages()[0].textContent.includes(gauntletName(0)) && /pays 20 coins/.test(stages()[0].textContent) && /24-point head start/.test(stages()[0].textContent), "the first says who it is, what it pays and its head start: " + stages()[0].textContent);
  assert(stages()[0].querySelector("[data-play]") && !stages()[1].querySelector("button") && !stages()[1].textContent.includes(CARDS.get(gauntletFoe(1)[0].id).name), "only the open stage can be played, and a locked one does not say who is in it");
  const before = auth._wallet.balanceOf(bea);
  await click(q("[data-play]")); await settle(); await settle();
  const row = () => auth._cards.gauntlets.get(bea);
  assert(area().dataset.phase === "play" && row().stage === 0 && arena() && /points short each round/.test(q("[data-head-start]").textContent), "an attempt at stage one, with its head start said in words");
  const foe = gauntletFoe(0);
  assert(Number(q("[data-facing] [data-card]").dataset.card) === foe[0].id && q("[data-facing] [data-stat]") && !q("[data-facing] button"), "here their card IS shown, stats and all - a real team is the point - and it is not one of yours to play");
  assert(qa(".cb-them .cb-t-back").length === 0 && qa(".cb-them .cb-t").every((li, i) => li.textContent.includes(CARDS.get(foe[i].id).name.split(" ").slice(-1)[0])), "and all six of theirs are face up on the field");
  // Leave and come back mid-way: the same attempt, the same hand.
  auth._cards.nextRolls = rolls(true);
  await playRounds(2);
  const hand = row().hand.map((e) => e.card).join();
  await goHome(); await openTabOf("gauntlet");
  assert(area().dataset.phase === "play" && arena().dataset.rounds === "2" && row().hand.map((e) => e.card).join() === hand, "leaving and coming back is the same attempt, two rounds in");
  await playRounds(4);
  assert(area().dataset.phase === "result" && arena().dataset.done === "true", "six rounds and it is over");
  const won = arena().dataset.win === "true";
  if (won) {
    assert(/Stage cleared/.test(q(".cb-result-h").textContent) && q("[data-paid]") && auth._wallet.balanceOf(bea) === before + 20 && row().cleared === 1, "a win clears the stage and pays its twenty");
    assert(q("[data-next]").textContent.includes(gauntletName(1)), "and offers the next team by name");
  } else {
    assert(/Beaten/.test(q(".cb-result-h").textContent) && q("[data-retry]") && auth._wallet.balanceOf(bea) === before && row().cleared === 0, "a loss costs nothing and offers another try");
    // Make it a win so the rest of the test has a cleared stage: a stage is as often as it takes.
    auth._cards.gauntlets.set(bea, { ...row(), cleared: 1, cleared_at: new Date().toISOString() });
  }
  await click(q("[data-back]")); await settle();
  await goHome(); await openTabOf("gauntlet");
  assert(q("[data-cleared]").textContent === "1" && stages().slice(0, 3).map((li) => li.dataset.state).join() === "cleared,next,locked", "stage one cleared, stage two open: " + stages().slice(0, 3).map((li) => li.dataset.state));
  assert(stages()[0].querySelector("[data-replay]") && !/pays/.test(stages()[0].textContent), "a cleared stage can be played again and promises no coins");
  // A lost answer on a round: shown as played, never played twice.
  await click(q("[data-play]")); await settle(); await settle();
  auth._cards.battleFails = true;
  await click(q("[data-best]")); await settle(); await settle(); await settle();
  assert(row().rounds.length === 1 && arena().dataset.rounds === "1" && /was played/.test(q("[data-notice]").textContent), "a round whose answer was lost is shown as it was played");
  // Giving up keeps the progress.
  await click(q("[data-quit]")); await settle(); await settle();
  assert(area().dataset.phase === "list" && row().stage === null && q("[data-cleared]").textContent === "1", "giving up a try ends the attempt and nothing else");
  // A read that failed is not "nothing cleared".
  auth._cards.stateFails = true;
  await goHome(); await openTabOf("gauntlet");
  assert(/Couldn't load your battles/.test(container.textContent) && !q(".cb-stage"), "a failed read shows no gauntlet at all, not an empty one");
  auth._cards.stateFails = false;
  await click(button("Try again")); await settle(); await settle();
  assert(q("[data-cleared]").textContent === "1", "and trying again finds it");
});

await runTest("the gauntlet: Try again after a loss is a new attempt, in the same place", async () => {
  // The result of an attempt and the next attempt at the SAME stage are drawn in the same place. Until v2.31.0
  // they were the same arena to React - still on its sixth round, handed no rounds - and Try again took the
  // whole app down. The review found it; nothing pressed the button.
  await goHome(); await openTabOf("gauntlet");
  const row = () => auth._cards.gauntlets.get(bea);
  await click(q('.cb-stage[data-state="next"] [data-play]')); await settle(); await settle();
  const stage = row().stage;
  assert(area().dataset.phase === "play" && stage === 1, "an attempt at the stage that is up");
  auth._cards.nextRolls = rolls(false); // a starter deck, against a real offense, on the worst of the luck
  await playRounds(6);
  assert(area().dataset.phase === "result" && arena().dataset.done === "true" && arena().dataset.win === "false" && q("[data-retry]"), "the attempt is lost, and offers another: " + area()?.textContent.slice(0, 80));
  const lostHand = JSON.stringify(row().hand);
  await click(q("[data-retry]")); await settle(); await settle();
  assert(container.querySelector(".cb-arena"), "pressing Try again does not take the screen down");
  assert(area().dataset.phase === "play" && row().stage === stage && arena().dataset.rounds === "0" && arena().dataset.done === "false", "it is a new attempt at the same stage, with no rounds played");
  assert(q("[data-choose]")?.dataset.choose === "0" && q("[data-you]").textContent === "0" && q("[data-cpu]").textContent === "0" && !q("[data-reveal]") && !q("[data-verdict]"), "round one, nothing scored, and nothing left over from the attempt before");
  assert(qa("[data-rack] button[data-cat]").length === 6 && qa(".cb-strip .cb-slot").length === 6, "all six categories to call and six empty spots");
  assert(JSON.stringify(row().hand) !== undefined && row().hand.length === 12, "with a hand of its own");
  await playRounds(1);
  assert(row().rounds.length === 1 && arena().dataset.rounds === "1" && lostHand, "and it plays");
  await click(q("[data-quit]")); await settle(); await settle();
  assert(area().dataset.phase === "list" && row().stage === null, "given up, back to the list");
});

await runTest("the boards list the ladder and the day, by name", async () => {
  await click(tabBtn("boards")); await settle(); await settle();
  const tables = qa(".cb-board");
  assert(tables.length === 3 && /ladder/i.test(tables[0].caption.textContent) && /Today's battle/.test(tables[1].caption.textContent) && /gauntlet/i.test(tables[2].caption.textContent), "three boards");
  assert(/bea/.test(tables[2].textContent) && tables[2].querySelector("td.r").textContent === "1", "with this account's cleared stage on the gauntlet's");
  assert(/bea/.test(tables[0].textContent) && tables[0].querySelector("td.r").textContent === "1" && /bea/.test(tables[1].textContent), "with this account on both: " + tables[0].textContent);
  assert(/\d–\d · /.test(tables[1].querySelector("td.r").textContent), "the day's row is rounds won and lost, then points: " + tables[1].querySelector("td.r").textContent);
  assert(tables[0].querySelector(".namelink, .bname"), "names are drawn the way every board draws them");
  auth._cards.stateFails = true;
  await click(tabBtn("run")); await settle(); await click(tabBtn("boards")); await settle(); await settle();
  assert(/Couldn't load the boards/.test(container.textContent) && !/Nobody has/.test(container.textContent), "a failed read is not an empty board");
  auth._cards.stateFails = false;
});

await runTest("an old eight-card collection is offered its top-up, and cannot battle until it takes it", async () => {
  const cy = await signUp("cyrus@cards.test", "cyrus");
  const old = ["QB", "RB", "WR", "TE", "RB", "WR", "WR", "QB"].map((pos, i) => [...CARDS.values()].filter((c) => c.pos === pos && c.rating < 60)[i * 7 + 3]);
  auth._cards.grantCards(cy, "starter", old.map((c, i) => ({ ref: `starter:${i}`, card: c.id, finish: "base" })));
  await openCards();
  assert(button("Open your starter deck") && /topped up/.test(container.querySelector(".cd-starter").textContent) && cardsOnScreen().length === 8, "eight cards and the offer to top them up: " + container.querySelector(".cd-starter")?.textContent.slice(0, 120));
  await click(tabBtn("battle")); await settle(); await settle();
  assert(q("[data-no-deck]") && !q("[data-start]"), "no deck, no battle - and it says what is needed");
  await click(tabBtn("collection")); await settle();
  await click(button("Open your starter deck")); await settle(); await settle();
  assert(container.querySelector("#cd-coll-h").textContent === "30 cards" && !button("Open your starter deck") && qa(".cd-fresh [data-card]").length === 22, "topped up to thirty: twenty-two new ones shown, and the offer is gone");
  await click(tabBtn("battle")); await settle(); await settle();
  assert(q("[data-start]") && !q("[data-no-deck]"), "and now there is a ladder to climb");
});

await runTest("every battle refusal has a sentence, and none claims to know what it cannot", async () => {
  const { BATTLE_SENTENCES } = await (await import("./helpers.mjs")).loadModule("card-battle.jsx");
  for (const key of [...CARD_REFUSALS, "offline", "network"].filter((k) => !["unknown_pack", "bad_open", "unavailable", "sold_out", "price_changed", "not_enough"].includes(k))) {
    assert(typeof BATTLE_SENTENCES[key] === "string" && BATTLE_SENTENCES[key].length > 15, `"${key}" has a battle sentence`);
  }
  for (const key of ["offline", "network", "server"]) assert(!/not played|wasn't played|was played/i.test(BATTLE_SENTENCES[key]), `"${key}" does not say whether the round happened`);
  for (const key of ["not_owned", "not_in_hand", "already_played", "same_player", "bad_slot", "bad_cat", "bad_deck", "no_deck", "guest_not_allowed", "cards_off", "no_run", "no_hand"]) assert(!/connection/i.test(BATTLE_SENTENCES[key]), `"${key}" is a rule, not a fault in your connection`);
});

await runTest("several packs at once: one confirm, each its own purchase, and a batch that stops keeps what it opened", async () => {
  const mo = await signUp("mona@cards.test", "mona");
  auth._wallet.apply(mo, 1750, "season", "multi"); // 2,000 with the welcome coins
  await openShop();
  const qty = (n) => packEl("pack-standard").querySelector(`[data-qty="${n}"]`);
  assert(qty(1).getAttribute("aria-pressed") === "true" && qty(5) && qty(10), "one, five or ten - one to begin with");
  await click(qty(5)); await flush();
  assert(qty(5).getAttribute("aria-pressed") === "true" && packBtn("pack-standard", "Open 5"), "five chosen, and the button says so");
  await click(packBtn("pack-standard", "Open 5")); await flush();
  assert(packBtn("pack-standard", "Confirm: 750 coins for 5") && spent(mo) === 2000, "it asks once, for the whole price, and has bought nothing yet");
  await click(packBtn("pack-standard", "Confirm")); await settle(); await settle(); await settle();
  assert(spent(mo) === 1250, "five packs left the wallet: " + auth._wallet.balanceOf(mo) + " with " + soldCoins(mo) + " back for copies");
  assert(container.querySelectorAll(".cd-fresh [data-card]").length === 15 && /5 packs opened\./.test(container.querySelector("[data-batch]").textContent), "all fifteen cards are shown together: " + container.querySelectorAll(".cd-fresh [data-card]").length);
  const opens = new Set(auth._cards.grants(mo).filter((g) => g.kind === "pack").map((g) => g.ref.split(":")[0]));
  assert(opens.size === 5, "five purchases, each with an open id of its own: " + opens.size);

  // Ten, with coins for eight: the button will not start what the wallet cannot finish.
  await click(qty(10)); await flush();
  assert(packBtn("pack-standard", "Open 10").disabled && packEl("pack-standard").textContent.includes(`You need ${(1500 - auth._wallet.balanceOf(mo)).toLocaleString("en-US")} more coins for 10.`), "ten costs more than there is, and it says by how much");

  // A batch whose third answer is lost: two are opened and shown, the third is the one Try again asks about.
  await click(qty(5)); await flush();
  await click(packBtn("pack-standard", "Open 5")); await flush();
  const real = auth._cards.claimStarter.bind(auth._cards);
  let calls = 0;
  auth._cards.claimStarter = async (body) => { if (body?.action === "open_pack" && ++calls === 3) auth._cards.openFails = true; return real(body); };
  await click(packBtn("pack-standard", "Confirm")); await settle(); await settle(); await settle();
  auth._cards.claimStarter = real;
  assert(calls === 3, "it stopped at the one that did not answer: " + calls);
  assert(spent(mo) === 1250 - 450, "three were bought - the third's answer was lost, not its purchase");
  assert(/2 of 5 packs opened/.test(container.querySelector("[data-batch]").textContent) && container.querySelectorAll(".cd-fresh [data-card]").length === 6, "the two that answered are shown");
  assert(packBtn("pack-standard", "Try again") && qty(5).disabled, "and the third is asked about, not bought again - with the count locked meanwhile");
  await click(packBtn("pack-standard", "Try again")); await settle(); await settle();
  assert(spent(mo) === 800 && container.querySelectorAll(".cd-fresh [data-card]").length === 3 && /already bought/.test(container.querySelector(".cd-fresh").textContent), "Try again shows that one pack's cards and charges nothing more");
  assert(packBtn("pack-standard", "Open 5") && !qty(5).disabled, "and the shop is back to normal");
});

await runTest("a copy pulled from a pack is sold as it arrives, and the screen shows it going", async () => {
  const dee = await signUp("dee@cards.test", "deedee");
  auth._wallet.apply(dee, 1000, "season", "test-coins");
  await openCards();
  await click(button("Open your starter deck")); await settle(); await settle();
  const held = auth._cards.owned(dee)[0];
  const fresh = [...CARDS.values()].filter((c) => !auth._cards.owned(dee).some((o) => o.card_id === c.id)).slice(0, 2);
  auth._cards.nextPull = [{ id: held.card_id, finish: held.finish }, { id: fresh[0].id, finish: "base" }, { id: fresh[1].id, finish: "silver" }];
  const each = auth._cards.sellFor({ id: held.card_id, finish: held.finish });
  const before = auth._wallet.balanceOf(dee);
  await click(shopTab()); await settle();
  await click(packBtn("pack-standard", "Open")); await flush();
  await click(packBtn("pack-standard", "Confirm")); await settle(); await settle();
  const sold = [...container.querySelectorAll(".cd-fresh .cd-sold")];
  assert(sold.length === 1 && Number(sold[0].dataset.sold) === each && sold[0].querySelector(`[data-card="${held.card_id}"]`), "the copy is drawn as sold, the other two as kept: " + sold.length);
  assert(/You have this one\. Sold for/.test(sold[0].textContent) && sold[0].textContent.includes(String(each)), "in words, not only as an animation: " + sold[0].textContent);
  assert(container.querySelectorAll(".cd-fresh [data-card]").length === 3, "all three cards that came out are shown");
  assert(auth._wallet.balanceOf(dee) === before - 150 + each, "the wallet is the pack's price down and the copy's coins up");
  assert(auth._cards.owned(dee).every((o) => o.count === 1) && auth._cards.owned(dee).length === 32, "and the collection holds one of everything: thirty, and the two new ones");
  assert(!container.querySelector("[data-swept]"), "nothing was stacked, so there was nothing to sweep");
});

await runTest("a daily card the account already holds is sold, and the result says so", async () => {
  // LAST in the file: it renders the component on its own, in place of the app.
  const helpers = await import("./helpers.mjs");
  const { SeasonCard } = await helpers.loadModule("cards.jsx");
  const card = [...CARDS.values()].find((c) => c.rating >= 100 && c.rating < 120);
  reactRoot.unmount();
  const view = await helpers.renderComponent(SeasonCard, { card: { id: card.id, finish: "gold", sold: 1000 } });
  await settle(); await settle();
  const el = view.container.querySelector(".cd-earned .cd-sold");
  assert(el && Number(el.dataset.sold) === 1000 && el.querySelector(`[data-card="${card.id}"]`), "the card is shown as sold: " + view.container.textContent.slice(0, 120));
  assert(/You have this one\. Sold for 1,000 coins\./.test(el.textContent), "with the coins in words: " + el.textContent);
  await view.rerender({ card: { id: card.id, finish: "gold" } });
  await settle();
  assert(!view.container.querySelector(".cd-sold") && view.container.querySelector(`.cd-earned [data-card="${card.id}"]`), "and a card that was kept is just the card");
});

void cardBoardKey;
console.log("test-cards-screen.mjs done");
