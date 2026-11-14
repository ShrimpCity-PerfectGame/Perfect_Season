// The card area, in the real app on the mock: the tile and the switch that hides it, the starter deck, the
// collection, and the three things the screen must never get wrong - a read that failed shown as an empty
// collection, a card the catalog does not know breaking the rest, and a switched-off server read as "check
// your connection".
import { readFileSync } from "node:fs";
import {
  setupDom, makeStorage, makeMockAuth, mount, flush, click, type, clickMode, findButtonByText, assert, runTest, waitForCrypto,
} from "./helpers.mjs";
import { CARD_REFUSALS } from "../storage-cards.js";
import { CARDS, cardBoardKey } from "../card-logic.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;
window.__ps_cards__ = true;
// The app fetches the catalog; in a test that is a file read.
const catalog = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
const versusPoolFile = JSON.parse(readFileSync(new URL("../data/versus-pool.json", import.meta.url), "utf8"));
const cardDefense = JSON.parse(readFileSync(new URL("../data/card-defense.json", import.meta.url), "utf8"));
let fetchFails = false;
globalThis.fetch = window.fetch = async (url) => {
  if (String(url).endsWith("/data/cards.json")) { if (fetchFails) throw new Error("offline"); return { ok: true, status: 200, json: async () => catalog }; }
  if (String(url).endsWith("/data/card-defense.json")) return { ok: true, status: 200, json: async () => cardDefense };
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
  assert(container.querySelector("#cd-fresh-h")?.textContent === "Your starter deck", "the eight just dealt are shown under their own heading");
  assert(container.querySelectorAll(".cd-fresh [data-card]").length === 8, "all eight of them");
  assert(container.querySelector("#cd-coll-h")?.textContent === "8 cards", "and the collection says 8 cards: " + container.querySelector("#cd-coll-h")?.textContent);
  assert(auth._cards.owned(ann).reduce((n, o) => n + o.count, 0) === 8, "the account owns eight");
  await remount(); await openCards();
  assert(!button("Open your starter deck") && container.querySelector("#cd-coll-h")?.textContent === "8 cards", "coming back shows the collection, not the button");
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
  assert(container.querySelector("#cd-coll-h").textContent === "8 cards", "the count is the collection's, not the filter's");
  await click(chip("All")); await flush();
});

await runTest("the finish and team filters narrow the same grid", async () => {
  // One Gold card beside the eight Base ones, from a team the starter deck may not hold.
  const gold = [...CARDS.values()].find((c) => c.rating > 110 && !auth._cards.owned(ann).some((o) => CARDS.get(o.card_id).team === c.team));
  auth._cards.grantCards(ann, "gift", [{ ref: "filter-gold", card: gold.id, finish: "gold" }]);
  await openCards();
  const finishChip = (f) => container.querySelector(`[data-finish-filter="${f}"]`);
  assert(finishChip("All").getAttribute("aria-pressed") === "true" && cardsOnScreen().length === 9, "nine cards, any finish");
  await click(finishChip("gold")); await flush();
  assert(cardsOnScreen().length === 1 && cardsOnScreen()[0].dataset.finish === "gold" && /Showing 1 of 9\./.test(container.querySelector("[data-shown]").textContent), "Gold shows the one Gold card, and says how many of how many");
  await click(finishChip("prism")); await flush();
  assert(cardsOnScreen().length === 0 && /No cards match those filters/.test(container.textContent), "a finish nobody holds says so, not 'no cards yet'");
  await click(finishChip("All")); await flush();
  const select = container.querySelector("[data-team-filter]");
  assert(select && [...select.options].some((o) => o.value === gold.team) && select.options.length === new Set(auth._cards.owned(ann).map((o) => CARDS.get(o.card_id).team)).size + 1, "the team list is the teams in the collection, and Every team");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  setter.call(select, gold.team); select.dispatchEvent(new window.Event("change", { bubbles: true })); await flush();
  assert(cardsOnScreen().length >= 1 && cardsOnScreen().every((el) => CARDS.get(Number(el.dataset.card)).team === gold.team), "a team shows only that team's cards");
  setter.call(select, "All"); select.dispatchEvent(new window.Event("change", { bubbles: true })); await flush();
  assert(cardsOnScreen().length === 9, "and Every team brings them all back");
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
  assert(container.querySelector("#cd-coll-h")?.textContent === "8 cards", "Try again loads the collection");
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
  assert(cardsOnScreen().length === 8, "eight real cards are drawn");
  assert(container.querySelector("#cd-coll-h").textContent === "8 cards", "and counted - the unknown one is not");
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
  assert(!el.querySelector(".cd-count") && container.querySelector("#cd-coll-h").textContent === "8 cards", "and the collection shows one of it, eight cards in all");
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
  assert(container.querySelector("#cd-coll-h")?.textContent === "8 cards", "and once it is on, the same button works");
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
  assert(container.querySelector("#cd-coll-h")?.textContent === "9 cards", "opening the deck adds eight to it");
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

await runTest("opening a pack: confirm first, then the cards, the coins and the collection", async () => {
  await click(packBtn("pack-standard", "Open")); await flush();
  assert(auth._wallet.balanceOf(pat) === 1000 && auth._cards.owned(pat).length === 0, "Open alone buys nothing");
  assert(packBtn("pack-standard", "Confirm: 150 coins") && packBtn("pack-standard", "Cancel"), "it asks first, with the price in the button");
  await click(packBtn("pack-standard", "Cancel")); await flush();
  assert(packBtn("pack-standard", "Open") && auth._wallet.balanceOf(pat) === 1000, "and Cancel is a real way out");

  await click(packBtn("pack-standard", "Open")); await flush();
  await click(packBtn("pack-standard", "Confirm")); await settle(); await settle();
  assert(auth._wallet.balanceOf(pat) === 850, "150 coins left the wallet");
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
  assert(auth._wallet.balanceOf(pat) === 700, "the pack WAS bought - only the answer was lost");
  assert(/never charged twice/.test(packAlert("pack-standard")) && !/Nothing was charged/.test(packAlert("pack-standard")), "the screen says it does not know, and never claims nothing was charged: " + packAlert("pack-standard"));
  assert(packBtn("pack-standard", "Try again"), "and offers to try again");
  await click(packBtn("pack-standard", "Try again")); await settle(); await settle();
  assert(auth._wallet.balanceOf(pat) === 700, "trying again charged nothing more");
  assert(container.querySelectorAll(".cd-fresh [data-card]").length === 3 && container.querySelector(".cd-fresh").textContent.includes("weren't charged twice"), "and handed over that pack's cards, saying so");
  assert(auth._cards.owned(pat).reduce((n, o) => n + o.count, 0) === 6, "two packs' cards in all - not three");
});

await runTest("what the shop refuses, in words, and what it does next", async () => {
  // The price went up after the shelf was read: refused, said, and the new price shown.
  auth._cards.packs.get("pack-standard").price = 200;
  await click(packBtn("pack-standard", "Open")); await flush();
  await click(packBtn("pack-standard", "Confirm")); await settle(); await settle();
  assert(auth._wallet.balanceOf(pat) === 700, "nothing charged at a price nobody agreed to");
  assert(/price has gone up/.test(packAlert("pack-standard")), "it says why: " + packAlert("pack-standard"));
  assert(packEl("pack-standard").querySelector(".cd-pack-price").textContent.includes("200"), "and the shelf now shows the new price");
  auth._cards.packs.get("pack-standard").price = 150;

  // Sold out between looking and buying.
  auth._wallet.apply(pat, 5000, "season", "test2"); await remount(); await openShop();
  auth._cards.packs.get("pack-legends").stock_left = 0;
  await click(packBtn("pack-legends", "Open")); await flush();
  await click(packBtn("pack-legends", "Confirm")); await settle(); await settle();
  assert(/sold out/i.test(packAlert("pack-legends")) && auth._wallet.balanceOf(pat) === 5700, "sold out, in a sentence, with nothing charged: " + packAlert("pack-legends"));
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
  assert(auth._wallet.balanceOf(pat) === 5550 && packBtn("pack-standard", "Try again"), "bought, and the answer lost");
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
  assert(auth._wallet.balanceOf(pat) === 5300 && packBtn("pack-standard", "Try again"), "Air raid bought; Standard's purchase is still waiting");

  // A refusal made before the database is asked settles nothing about the earlier attempt.
  auth._cards.enabled = false;
  await click(packBtn("pack-standard", "Try again")); await settle(); await settle();
  assert(/still can't confirm/.test(packAlert("pack-standard")) && !/Nothing was charged/i.test(packAlert("pack-standard")), "it does not claim nothing was charged: " + packAlert("pack-standard"));
  assert(packBtn("pack-standard", "Try again"), "and keeps the purchase");
  auth._cards.enabled = true;

  await click(packBtn("pack-standard", "Try again")); await settle(); await settle();
  assert(auth._wallet.balanceOf(pat) === 5300, "resolving it charged nothing more");
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
  assert(auth._wallet.balanceOf(pat) === 5150, "the pack was bought");
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

// ---------- battles (v2.25.0): a run, the daily showdown, the boards ----------
// Run, Showdown and Boards sit under Battle, so reaching one is Battle first when it is not already open.
const tabBtn = (id) => container.querySelector(`.cd-area [data-tab="${id}"]`);
const area = () => container.querySelector(".cb-area");
const q = (sel) => container.querySelector(sel);
const HIGH = () => Array(12).fill(0.98), LOW = () => Array(12).fill(0.02);
async function openTabOf(id) {
  await openCards();
  assert(tabBtn("battle"), "an account sees a Battle tab");
  if (!tabBtn(id)) { await click(tabBtn("battle")); await settle(); }
  assert(tabBtn(id), `and a ${id} tab under it`);
  await click(tabBtn(id)); await settle(); await settle();
}
let bea;

await runTest("a run: see the defense, pick six, play, and go again", async () => {
  bea = await signUp("bea@cards.test", "bea");
  await openCards();
  await click(button("Open your starter deck")); await settle(); await settle();
  await openTabOf("run");
  assert(area()?.dataset.phase === "idle" && q("[data-start]") && q("[data-best]") === null, "it opens on the offer to start, not on a battle: " + container.querySelector(".cd-area")?.textContent.slice(0, 160));
  assert(q("[data-paid-left]").textContent === "15" && q("[data-best-run]").textContent === "0", "with the day's paid wins and the best so far");
  assert(container.querySelectorAll(".cd-tabs [data-tab]").length === 3 && tabBtn("battle").getAttribute("aria-pressed") === "true" && tabBtn("run").getAttribute("aria-pressed") === "true", "three tabs across the top, Battle pressed, and Run pressed under it");
  await click(q("[data-start]")); await settle();
  assert(area().dataset.phase === "pick" && q("[data-defense]") && /defense/i.test(q(".cb-def-h").textContent), "starting shows the defense first: " + area().textContent.slice(0, 120));
  const run = auth._cards.runs.find((r) => r.user_id === bea);
  assert(run && q("[data-defense]").dataset.defense === run.defense && !container.innerHTML.includes(run.seed), "it is the server's defense, and the seed is nowhere on the page");
  assert(q("[data-play]").disabled && !q("[data-proj]"), "nothing to play until six are picked");

  // By hand for one slot, then the rest: a slot opens a list of the cards that fit it.
  await click(q('[data-slot="QB"] .cb-slot')); await flush();
  const options = [...container.querySelectorAll('[data-slot="QB"] .cb-opt')];
  assert(options.length >= 1 && options.every((o) => CARDS.get(Number(o.dataset.card)).pos === "QB"), "the quarterback slot lists quarterbacks, and only those");
  await click(options[0]); await flush();
  assert(q('[data-slot="QB"] .cb-who b') && q("[data-play]").disabled, "one picked, five to go");
  await click(q("[data-best]")); await flush();
  assert(!q("[data-play]").disabled && /Before luck: [\d.,]+ against a bar of \d+/.test(q("[data-proj]").textContent), "six picked: the score before luck, against the bar: " + q("[data-proj]")?.textContent);
  assert(q("[data-bar]").textContent === q("[data-proj]").textContent.match(/bar of (\d+)/)[1], "the bar on the defense is the bar in the sum");

  auth._cards.nextRolls = HIGH();
  await click(q("[data-play]")); await settle(); await settle();
  assert(area().dataset.phase === "result" && q("[data-win]").dataset.win === "true", "a win: " + area().textContent.slice(0, 80));
  assert(/Win 1/.test(q(".cb-result-h").textContent) && /You won, [\d.,]+ to a bar of \d+\./.test(q("[data-verdict]").textContent), "said in words, not only in colour: " + q("[data-verdict]").textContent);
  assert(container.querySelectorAll(".cb-play").length === 6 && container.querySelectorAll(".cb-play [data-card]").length === 6, "six cards, each with its game");
  assert(/yards, \d+ TD/.test(q(".cb-line").textContent) && /luck/.test(q(".cb-math").textContent), "a football line and the luck that went with it");
  assert(q("[data-paid]") && auth._wallet.balanceOf(bea) === 253, "and the win paid its three coins: " + auth._wallet.balanceOf(bea));

  await click(q("[data-next]")); await settle();
  assert(area().dataset.phase === "pick" && /1 win so far/.test(q(".cb-kick").textContent) && !q("[data-play]").disabled, "the next defense, with the lineup still picked");
  assert(Number(q("[data-bar]").textContent) > 190, "and a higher bar");
  auth._cards.nextRolls = LOW();
  await click(q("[data-play]")); await settle(); await settle();
  assert(q("[data-win]").dataset.win === "false" && /Stopped/.test(q(".cb-result-h").textContent) && /The run ends at 1 win\./.test(q("[data-over]").textContent), "a loss ends the run at one: " + area().textContent.slice(0, 80));
  assert(!q("[data-paid]") && auth._wallet.balanceOf(bea) === 253, "and pays nothing");
  await click(q("[data-start]")); await settle();
  assert(area().dataset.phase === "pick" && /0 wins so far/.test(q(".cb-kick").textContent) && auth._cards.runs.filter((r) => r.user_id === bea).length === 2, "a new run starts from zero");
});

await runTest("a run survives leaving and coming back, and can be walked away from", async () => {
  await goHome(); await openTabOf("run");
  assert(area().dataset.phase === "pick" && /0 wins so far/.test(q(".cb-kick").textContent), "the same run is there on return, not a new one");
  assert(auth._cards.runs.filter((r) => r.user_id === bea && r.status === "live").length === 1, "still one live run");
  await click(q("[data-quit]")); await settle(); await settle();
  assert(area().dataset.phase === "idle" && q("[data-best-run]").textContent === "1" && q("[data-paid-left]").textContent === "14", "walking away ends it; the best and the day's paid wins are remembered: " + area().textContent.slice(-120));
});

await runTest("a battle whose answer is lost is shown as it was played, never played again", async () => {
  await click(q("[data-start]")); await settle();
  await click(q("[data-best]")); await flush();
  auth._cards.nextRolls = HIGH(); auth._cards.battleFails = true;
  await click(q("[data-play]")); await settle(); await settle(); await settle();
  const run = auth._cards.runs.filter((r) => r.user_id === bea).at(-1);
  assert(run.wins === 1, "the battle was played once on the server");
  assert(area().dataset.phase === "result" && q("[data-win]").dataset.win === "true" && /was played/.test(q("[data-notice]").textContent), "and the page shows that battle, saying why: " + q("[data-notice]")?.textContent);
  await click(q("[data-next]")); await settle();
  assert(/1 win so far/.test(q(".cb-kick").textContent) && run.wins === 1, "the run carries on from one win, not two");

  // The state cannot be read either: say so, and promise only what is true.
  auth._cards.nextRolls = HIGH(); auth._cards.battleFails = true; auth._cards.stateFails = true;
  await click(q("[data-play]")); await settle(); await settle(); await settle();
  assert(/couldn't confirm/i.test(q("[data-notice]").textContent) && /never played twice/.test(q("[data-notice]").textContent) && !/not played/.test(q("[data-notice]").textContent), "unknown is called unknown: " + q("[data-notice]").textContent);
  auth._cards.stateFails = false;
  // The page still thinks one win; the server has two. Playing again is refused as stale and the page catches up.
  await click(q("[data-play]")); await settle(); await settle(); await settle();
  assert(run.wins === 2 && area().dataset.phase === "result", "the stale play was not a third battle, and the page shows the second: wins " + run.wins);
});

await runTest("a read that failed is not 'no run going'", async () => {
  auth._cards.stateFails = true;
  await goHome(); await openTabOf("run");
  assert(/Couldn't load your battles/.test(container.textContent) && !q("[data-start]"), "it says it could not load, and offers no fresh run over a live one");
  auth._cards.stateFails = false;
  await click(button("Try again")); await settle(); await settle();
  assert(area()?.dataset.phase === "pick" && /2 wins so far/.test(q(".cb-kick").textContent), "and trying again finds the run");
  await click(q("[data-quit]")); await settle(); await settle();
});

await runTest("a lineup the server refuses is told why, and nothing is played", async () => {
  await click(q("[data-start]")); await settle();
  await click(q("[data-best]")); await flush();
  // The card leaves the collection between the pick and the play (another tab, in a later version a trade).
  const qbId = Number(q('[data-slot="QB"] .cb-slot').dataset.card); // the quarterback actually in the lineup - a deck can hold two
  const row = auth._cards.tables.card_owned.find((o) => o.user_id === bea && o.card_id === qbId);
  row.count = 0;
  await click(q("[data-play]")); await settle(); await settle();
  assert(/isn't in your collection/.test(q("[data-notice]")?.textContent || "") && area().dataset.phase === "pick", "not owned, in a sentence: " + q("[data-notice]")?.textContent);
  assert(auth._cards.runs.filter((r) => r.user_id === bea).at(-1).wins === 0, "and the run did not move");
  row.count = 1;
  await click(q("[data-quit]")); await settle(); await settle();
});

await runTest("the showdown: one defense, a second tap, one score", async () => {
  await click(tabBtn("showdown")); await settle(); await settle();
  assert(area().dataset.mode === "showdown" && /Today's showdown/.test(q(".cb-kick").textContent) && q("[data-play]").disabled, "today's defense, and nothing to play yet");
  assert(!q("[data-bar]"), "a showdown has no bar: it is a score");
  await click(q("[data-best]")); await flush();
  assert(/Before luck: [\d.,]+\./.test(q("[data-proj]").textContent) && !/bar/.test(q("[data-proj]").textContent), "the score before luck, with no bar in it");
  await click(q("[data-play]")); await flush();
  assert(/one go/i.test(q("[data-play]").textContent) && auth._cards.showdowns.length === 0, "the first tap only asks");
  await click(q("[data-play]")); await settle(); await settle();
  const mine = auth._cards.showdowns.find((s) => s.user_id === bea);
  assert(mine && /Your score today: [\d.,]+\./.test(q("[data-played]").textContent) && q("[data-played]").textContent.includes(mine.score.toLocaleString("en-US", { maximumFractionDigits: 1 })), "played once, and the score on the page is the recorded one: " + q("[data-played]")?.textContent);
  assert(!q("[data-play]") && container.querySelectorAll(".cb-play").length === 6 && /You scored/.test(q("[data-verdict]").textContent), "the six games are shown and there is no second go");
  await goHome(); await openTabOf("showdown");
  assert(q("[data-played]") && !q("[data-play]"), "and it is still played after leaving and coming back");
  assert(auth._wallet.balanceOf(bea) === 260, "a showdown pays no coins: still the 250 welcome and the three paid wins (3, 3 and 4)");
});

await runTest("the boards list the run and the showdown, by name", async () => {
  await click(tabBtn("boards")); await settle(); await settle();
  const tables = [...container.querySelectorAll(".cb-board")];
  assert(tables.length === 2 && /Longest runs/.test(tables[0].caption.textContent) && /Today's showdown/.test(tables[1].caption.textContent), "two boards");
  assert(/bea/.test(tables[0].textContent) && tables[0].querySelector("td.r").textContent === "2" && /bea/.test(tables[1].textContent), "with this account on both: " + tables[0].textContent);
  assert(tables[0].querySelector(".namelink, .bname"), "names are drawn the way every board draws them");
  auth._cards.stateFails = true;
  await click(tabBtn("run")); await settle(); await click(tabBtn("boards")); await settle(); await settle();
  assert(/Couldn't load the boards/.test(container.textContent) && !/Nobody has/.test(container.textContent), "a failed read is not an empty board");
  auth._cards.stateFails = false;
});

await runTest("no cards, no battle: the screen says what is needed", async () => {
  await signUp("cyrus@cards.test", "cyrus");
  await openTabOf("run");
  assert(/You need six to play/.test(container.textContent) && !q("[data-start]"), "an account with no deck is sent to open one");
});

await runTest("every battle refusal has a sentence, and none claims to know what it cannot", async () => {
  const { BATTLE_SENTENCES } = await (await import("./helpers.mjs")).loadModule("card-battle.jsx");
  for (const key of [...CARD_REFUSALS, "offline", "network"].filter((k) => !["unknown_pack", "bad_open", "unavailable", "sold_out", "price_changed", "not_enough"].includes(k))) {
    assert(typeof BATTLE_SENTENCES[key] === "string" && BATTLE_SENTENCES[key].length > 15, `"${key}" has a battle sentence`);
  }
  for (const key of ["offline", "network", "server"]) assert(!/not played|wasn't played|was played/i.test(BATTLE_SENTENCES[key]), `"${key}" does not say whether the battle happened`);
  for (const key of ["not_owned", "same_player", "bad_slot", "guest_not_allowed", "cards_off", "no_run"]) assert(!/connection/i.test(BATTLE_SENTENCES[key]), `"${key}" is a rule, not a fault in your connection`);
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
  assert(auth._cards.owned(dee).every((o) => o.count === 1) && auth._cards.owned(dee).length === 10, "and the collection holds one of everything: eight, and the two new ones");
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
