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
let fetchFails = false;
globalThis.fetch = window.fetch = async (url) => {
  if (String(url).endsWith("/data/cards.json")) { if (fetchFails) throw new Error("offline"); return { ok: true, status: 200, json: async () => catalog }; }
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

await runTest("copies stack and say how many", async () => {
  const first = auth._cards.owned(ann)[0];
  auth._cards.grantCards(ann, "daily", [{ ref: "2026-11-01", card: first.card_id, finish: first.finish }]);
  await remount(); await openCards();
  const el = container.querySelector(`[data-card="${first.card_id}"]`);
  assert(el.querySelector(".cd-count")?.textContent === "x2" && el.getAttribute("aria-label").includes("2 copies"), "two copies show x2 and say so");
  assert(container.querySelector("#cd-coll-h").textContent === "9 cards", "and count as two");
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
const shopTab = () => [...container.querySelectorAll(".cd-tabs .cd-chip")].find((b) => b.textContent === "Packs");
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
  assert(packBtn("pack-legends", "Open").disabled && packEl("pack-legends").textContent.includes("You need 500 more coins"), "a pack the wallet cannot reach says how far short it is");
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
  await click([...container.querySelectorAll(".cd-tabs .cd-chip")].find((b) => b.textContent === "Collection")); await settle();
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

void cardBoardKey;
console.log("test-cards-screen.mjs done");
