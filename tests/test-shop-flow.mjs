// Coins and the shop through the whole app on the mock (SHOP.md 8). A new account starts with 250 coins; a
// finished season shows what it paid and any new badges, with a way to the shop; buying a frame there puts it on
// the header picture and the profile card; Back returns to wherever the shop was opened from. A draft that had
// already counted says so instead of a save error, the daily cap says why a season paid nothing, Over/Under and
// Build-a-player pay 15 once a day, and a guest never sees any of it. The shop is driven only through its
// contract's test hooks (SHOP.md 7.2), so these checks hold for the real screen as well as phase 0's stub.
import {
  setupDom, makeStorage, mount, flush, click, type, text, findButtonByText, assert, runTest, waitForCrypto,
  makeMockAuth, clickMode,
} from "./helpers.mjs";
import { COIN_RULES } from "../rewards.mjs";

let app = null;
async function close() {
  if (!app) return;
  // Imported here, not at the top: react-dom must load after setupDom() (see tests/helpers.mjs).
  const { act } = await import("react-dom/test-utils");
  await act(async () => { app.reactRoot.unmount(); });
  app = null;
}
// A fresh page at `url`, with How to play already seen. The previous page is unmounted first, so its listeners
// don't hear the shared mock's sign-ins.
async function open(url, auth, storage = makeStorage()) {
  await close();
  setupDom(url);
  storage.data["personal:ps-howto-seen"] = "true";
  window.storage = storage;
  window.__ps_supabase__ = auth;
  app = await mount();
  await flush(4);
  return app.container;
}

// `what` names the wait in the failure; a function is asked at the time, so it can say what was on screen.
async function until(cond, what, rounds = 60) {
  for (let i = 0; i < rounds; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error(`timed out waiting for ${typeof what === "function" ? what() : what}`);
}

// Back or Forward, as a browser does it: jsdom moves to the entry on a timer and fires popstate. `move` is what
// starts it - history.go, or a click on something that goes back.
async function traverse(move, label) {
  let popped = false;
  const onPop = () => { popped = true; };
  window.addEventListener("popstate", onPop);
  await move();
  for (let i = 0; i < 20 && !popped; i++) await flush(1);
  window.removeEventListener("popstate", onPop);
  assert(popped, `expected a popstate event after ${label}`);
  await flush(4);
}
const back = () => traverse(() => window.history.go(-1), "history.go(-1)");
const forward = () => traverse(() => window.history.go(1), "history.go(1)");

const tab = (container, label) => [...container.querySelectorAll("nav .tab")].find((b) => b.textContent.startsWith(label));
// A control by its accessible name: its aria-label, or else its text.
const named = (root, name) => [...(root?.querySelectorAll("button") || [])].find((b) => (b.getAttribute("aria-label") || b.textContent).trim() === name) || null;
const shopOf = (container) => container.querySelector("section.shop");
const profileOf = (container) => container.querySelector("section.profile");
const coinsOf = (container) => container.querySelector(".result-hero .seasoncoins");
// The page's words, without the stylesheet's (whose class names say "coins" too).
const shown = (container) => container.querySelector(".wrap")?.textContent || "";
const num = (n) => Number(n).toLocaleString("en-US");
const utcToday = () => new Date().toISOString().slice(0, 10);
// Today in the player's own calendar - how the minigames count their days (a claim's key is <game>:<that day>).
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
// What a screen reader says for an element: its aria-label, or its text leaving out anything aria-hidden. Coins
// (cosmetics.jsx) promises "1,240 coins" as its accessible text, however it draws the coin.
function spoken(el) {
  if (!el) return "";
  if (el.nodeType === 3) return el.textContent;
  if (el.nodeType !== 1 || el.getAttribute("aria-hidden") === "true") return "";
  if (el.hasAttribute("aria-label")) return el.getAttribute("aria-label");
  return [...el.childNodes].map(spoken).join("");
}

// Signs up through the AuthPanel in `panel` (the Account tab's, or the one under a guest's result).
async function signUp(panel, email, username) {
  await click(findButtonByText(panel, "Create account"));
  await flush();
  const [e, u, p, p2] = [...panel.querySelectorAll("input")];
  await type(e, email);
  await type(u, username);
  await type(p, "Password1");
  await type(p2, "Password1");
  await click([...panel.querySelectorAll("button")].find((b) => !b.hasAttribute("role") && b.textContent.includes("Create account")));
  await waitForCrypto();
  await flush(4);
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
// Drafts the six picks of whatever draft is on screen and plays the season out, returning the draft's code. The code is
// random unless it was entered, so some seasons make the playoffs: those are skipped to the end.
async function playSeason(container) {
  for (let round = 0; round < 6; round++) await draftFirstEligible(container);
  const code = container.querySelector(".seedline code")?.textContent;
  await flush(6);
  for (let i = 0; i < 6 && findButtonByText(container, "Skip to the end"); i++) {
    await click(findButtonByText(container, "Skip to the end"));
    await flush(4);
  }
  await until(() => container.querySelector(".result-hero .strip"), () => `the finished season, got: ${text(container).slice(0, 200)}`);
  return code;
}
async function playUnlimited(container) {
  await click(tab(container, "Modes"));
  await flush();
  await clickMode(container, "Unlimited");
  await flush(3);
  return playSeason(container);
}

// Over/Under to the end of the day: guess Over until the third miss.
async function playOverUnder(container) {
  await click(tab(container, "Modes"));
  await flush();
  await clickMode(container, "Over/Under");
  await flush(3);
  await click(findButtonByText(container, "I'm ready"));
  await flush();
  for (let i = 0; i < 40 && !text(container).includes("is done"); i++) {
    const panel = container.querySelector(".panel");
    await click(findButtonByText(panel, "Over"));
    await flush();
    await click(findButtonByText(container, "Next round") || findButtonByText(container, "See today's result"));
    await flush(2);
  }
  await until(() => /Your score: \d+/.test(text(container)), "today's Over/Under result");
}

// Build-a-player to "Build complete". setupDom() reports reduced motion, so each roll lands straight away.
async function buildPlayer(container) {
  const posBtn = [...container.querySelectorAll(".frow button")].find((b) => ["Quarterbacks", "Running backs", "Wide receivers", "Tight ends"].includes(b.textContent));
  await click(posBtn);
  for (let i = 0; i < 9; i++) {
    await until(() => container.querySelector(".panel .frow button"), "an attribute to take");
    await click(container.querySelector(".panel .frow button"));
    await flush();
  }
  await until(() => container.querySelector("h2.h")?.textContent.startsWith("Build complete"), "the finished build");
}

// The ledger rows a step added, for the account.
const ledgerKeys = (auth) => new Set(auth._ledger.keys());
const addedRows = (auth, before, uid) => [...auth._ledger.entries()].filter(([k, r]) => !before.has(k) && r.user_id === uid).map(([, r]) => r);

// ---------------------------------------------------------------------------------------------------------------
// A guest.
// ---------------------------------------------------------------------------------------------------------------
const guestAuth = makeMockAuth();
let container = await open("http://localhost/", guestAuth);

await runTest("a guest never sees coins or the shop: a season, Over/Under and Build-a-player", async () => {
  await playUnlimited(container);
  await flush(4);
  assert(!coinsOf(container) && !/\bcoins?\b/i.test(shown(container)), `a guest's result says nothing about coins, got: ${shown(container).slice(0, 300)}`);
  assert(!named(container, "Shop"), "a guest has no Shop button");
  assert(container.querySelector(".whoami") === null, "no header picture for a guest");

  await playOverUnder(container);
  await flush(4);
  assert(!container.querySelector(".gamecoins") && !/\bcoins?\b/i.test(shown(container)), `a guest's Over/Under result has no coins, got: ${shown(container).slice(0, 300)}`);

  await click(tab(container, "Modes"));
  await flush();
  await clickMode(container, "Build-a-player");
  await flush();
  await buildPlayer(container);
  await flush(4);
  assert(!container.querySelector(".gamecoins") && !/\bcoins?\b/i.test(shown(container)), "a guest's build has no coins");
  assert(guestAuth._ledger.size === 0, `nothing was paid to anyone, got ${guestAuth._ledger.size} ledger rows`);

  // Not even by history: an entry for the shop (say, left from before signing out) opens Modes, and says so.
  window.history.pushState({ ps: "view", view: "shop" }, "", "/");
  window.history.pushState({ ps: "view", view: "players" }, "", "/");
  await back();
  assert(!shopOf(container) && text(container).includes("Daily challenge"), `a shop entry opens Modes for a guest, got: ${text(container).slice(0, 200)}`);
  assert(window.history.state?.view === "home", `the entry now says Modes, got ${JSON.stringify(window.history.state)}`);
});

await runTest("saving a guest's season by signing up shows what it paid", async () => {
  await playUnlimited(container);
  const panel = [...container.querySelectorAll(".panel")].find((p) => p.textContent.includes("Save this season"));
  assert(panel, "expected the Save this season panel under a guest's result");
  await signUp(panel, "saver@example.com", "saver");
  await until(() => coinsOf(container)?.dataset.earned, () => `the saved season's coins, got: ${container.querySelector(".result-hero")?.textContent}`);
  const uid = [...guestAuth._profiles.values()].find((p) => p.username === "saver").id;
  const seasonRow = [...guestAuth._ledger.values()].find((r) => r.user_id === uid && r.kind === "season");
  assert(seasonRow, "the saved season was paid");
  assert(text(container).includes("Your last season was saved."), "the notice still says the season was saved");
  assert(coinsOf(container).querySelector('[data-badge="first-down"]'), "a first season earns First Down, shown by name");
});

// ---------------------------------------------------------------------------------------------------------------
// A player: coins on the result, the shop, and what's worn.
// ---------------------------------------------------------------------------------------------------------------
const auth = makeMockAuth();
container = await open("http://localhost/", auth);
let uid = null;
let firstCode = null;

await runTest("a new account starts with 250 coins, shown on its own card", async () => {
  await click(tab(container, "Account"));
  await flush();
  await signUp(container.querySelector(".panel"), "shopper@example.com", "shopper");
  await until(() => profileOf(container)?.dataset.username === "shopper", "your own profile after signing up");
  uid = [...auth._profiles.values()].find((p) => p.username === "shopper").id;
  assert(auth._wallet.balanceOf(uid) === 250, `expected 250 welcome coins, got ${auth._wallet.balanceOf(uid)}`);
  await until(() => spoken(profileOf(container)).includes("250 coins"), () => `the balance on your card, got: ${spoken(profileOf(container)).slice(0, 300)}`);
  assert(container.querySelector(".whoami [data-frame]")?.dataset.frame === "frame-ink", `the header picture wears the default frame, got: ${container.querySelector(".whoami")?.innerHTML}`);
});

await runTest("a finished season shows the coins it earned, its lines and its new badges", async () => {
  const before = ledgerKeys(auth);
  firstCode = await playUnlimited(container);
  await until(() => coinsOf(container)?.dataset.earned, () => `the season's coins, got: ${container.querySelector(".result-hero")?.textContent}`);
  const added = addedRows(auth, before, uid);
  const paid = added.reduce((sum, r) => sum + r.amount, 0);
  const coins = coinsOf(container);
  assert(Number(coins.dataset.earned) === paid, `expected the ${paid} coins the ledger took in, got ${coins.dataset.earned}`);
  assert(spoken(coins.querySelector(".sc-earned")) === `+${num(paid)} coins`, `expected "+${num(paid)} coins", got "${spoken(coins.querySelector(".sc-earned"))}"`);
  assert(added.some((r) => r.kind === "season" && r.ref === firstCode && r.amount >= 20), `the season paid under its code ${firstCode}`);

  const lines = coins.querySelector(".sc-lines")?.textContent || "";
  assert(lines.includes("Finished a season +20"), `expected the season's line, got: ${lines}`);
  const wins = Number(container.querySelector(".result-hero .rec").textContent.split("–")[0]);
  if (wins > 0) assert(lines.includes(`${wins} ${wins === 1 ? "win" : "wins"} +${wins * 2}`), `expected the wins line for ${wins} wins, got: ${lines}`);
  const badgeCoins = added.filter((r) => r.kind === "badge").reduce((sum, r) => sum + r.amount, 0);
  assert(lines.includes(`Badges +${num(badgeCoins)}`), `the badges' coins fold into one line (+${badgeCoins}), got: ${lines}`);

  const chips = [...coins.querySelectorAll("[data-badge]")].map((c) => c.dataset.badge);
  const awarded = [...auth._badgeAwards.values()].filter((b) => b.user_id === uid).map((b) => b.badge);
  assert(chips.includes("first-down") && chips.length === awarded.length && awarded.every((b) => chips.includes(b)), `expected every newly awarded badge by name (${awarded}), got ${chips}`);
  assert(coins.querySelector('[data-badge="first-down"]').textContent.includes("First Down"), "a badge shows its name");
  assert(!coins.querySelector(".sc-note"), "no cap note on a season that paid");
  assert(!text(container).includes("couldn't be saved"), "no save error");
});

await runTest("the Shop opens from the result; a bought frame is worn in the header; Back returns to the result", async () => {
  auth._wallet.apply(uid, 1000, "season", "TEST"); // enough for a 750 frame whatever the season paid
  const balance = auth._wallet.balanceOf(uid);
  const resultY = container.querySelector(".result-hero .rec").textContent;
  await click(named(coinsOf(container), "Shop"));
  await until(() => shopOf(container)?.dataset.balance, "the shop to load");
  assert(Number(shopOf(container).dataset.balance) === balance, `the shop shows your ${balance} coins, got ${shopOf(container).dataset.balance}`);
  assert(!container.querySelector(".result-hero") && window.location.pathname === "/", "the shop replaces the result, at /");
  assert(tab(container, "Profile").classList.contains("on"), "the shop sits under the Profile tab");

  await click(named(shopOf(container), "Frames"));
  const tile = () => shopOf(container).querySelector('.sh-item[data-item="frame-lime"]');
  await until(tile, "the Lime frame's tile");
  assert(tile().dataset.state === "buy", `expected Lime to be buyable, got ${tile().dataset.state}`);
  await click(tile().querySelector("button"));
  await until(() => named(shopOf(container), "Buy"), "Buy after selecting the frame");
  await click(named(shopOf(container), "Buy"));
  await until(() => named(shopOf(container), "Confirm purchase"), "Confirm purchase");
  await click(named(shopOf(container), "Confirm purchase"));
  await until(() => container.querySelector(".whoami [data-frame]")?.dataset.frame === "frame-lime",
    () => `the header picture in the Lime frame, got: ${container.querySelector(".whoami [data-frame]")?.dataset.frame}`);
  assert(auth._inventory.has(`${uid}|frame-lime`), "the frame is in the inventory");
  assert(auth._wallet.balanceOf(uid) === balance - 750, `750 coins were spent, got ${auth._wallet.balanceOf(uid)}`);
  await until(() => Number(shopOf(container)?.dataset.balance) === balance - 750, "the shop's balance after buying");
  await until(() => tile()?.dataset.state === "equipped", () => `Lime equipped, got ${tile()?.dataset.state}`);

  await back();
  assert(!shopOf(container) && container.querySelector(".result-hero .rec")?.textContent === resultY, `Back returns to the result, got: ${text(container).slice(0, 200)}`);
  assert(coinsOf(container)?.dataset.earned, "the result still shows its coins");
  assert(tab(container, "Draft").classList.contains("on") && window.location.pathname === "/", "on the Draft tab, at /");

  await forward();
  await until(() => shopOf(container)?.dataset.balance, "Forward to the shop");
  await until(() => shopOf(container).querySelector('.sh-item[data-item="frame-lime"]')?.dataset.state === "equipped", "the shop again, Lime still equipped");
  await back();
  assert(!shopOf(container) && container.querySelector(".result-hero .rec")?.textContent === resultY, `Back again returns to the result, got: ${text(container).slice(0, 200)}`);
});

await runTest("the frame is on your profile card too, with your balance; the card's Shop and Back", async () => {
  await click(container.querySelector(".whoami"));
  await until(() => profileOf(container)?.dataset.username === "shopper", "your profile");
  await until(() => profileOf(container).querySelector("[data-frame]")?.dataset.frame === "frame-lime",
    () => `the card's picture in the Lime frame, got: ${profileOf(container).querySelector("[data-frame]")?.dataset.frame}`);
  const balance = auth._wallet.balanceOf(uid);
  await until(() => spoken(profileOf(container)).includes(`${num(balance)} coins`), () => `your ${balance} coins on the card, got: ${spoken(profileOf(container)).slice(0, 300)}`);

  await click(named(profileOf(container), "Shop"));
  await until(() => shopOf(container)?.dataset.balance, "the shop from the card");
  assert(window.location.pathname === "/", "the shop is at /");
  await back();
  await until(() => profileOf(container)?.dataset.username === "shopper", "Back to your profile");
  assert(window.location.pathname === "/u/shopper", `back at your address, got ${window.location.pathname}`);

  // A visitor's view of your card shows the frame, but never your coins or a Shop button.
  auth._profiles.set("rival-id", { id: "rival-id", username: "rival", runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [] });
  await click(tab(container, "Modes"));
  await flush();
  window.history.pushState(null, "", "/u/rival");
  await back();
  await forward();
  await until(() => profileOf(container)?.dataset.username === "rival", "rival's profile");
  const card = profileOf(container).querySelector("[data-card]");
  assert(card && !named(card, "Shop") && !spoken(card).includes("coins"), `someone else's card has no Shop button or balance, got: ${spoken(card)}`);
});

await runTest("finishing the same code again says it was already recorded, not a save error", async () => {
  const runs = auth._profiles.get(uid).runs;
  const before = ledgerKeys(auth);
  await click(tab(container, "Modes"));
  await flush();
  await type(container.querySelector('input[aria-label="Challenge code"]'), firstCode);
  await click(findButtonByText(container, "Draft it"));
  await flush(3);
  assert(container.querySelector(".seedline code")?.textContent === firstCode, `expected the draft on code ${firstCode}`);
  await playSeason(container);
  await until(() => container.querySelector(".result-hero .sc-dup"), () => `the already-recorded note, got: ${container.querySelector(".result-hero")?.textContent}`);
  assert(container.querySelector(".result-hero .sc-dup").textContent === "This draft was already recorded, so it didn't count again.", "the note's words");
  await flush(4);
  assert(!text(container).includes("couldn't be saved"), `a duplicate isn't a save error, got: ${text(container).slice(0, 300)}`);
  assert(!coinsOf(container), "nothing about coins for a season that didn't count");
  assert(auth._profiles.get(uid).runs === runs, "the season didn't count again");
  assert(addedRows(auth, before, uid).length === 0, "and paid nothing");
  // Already in the runs log, so it's ranked among the logged seasons, not as one more.
  const logged = [...auth._runs.values()].filter((r) => !r.dnf && r.format === "fantasy").length;
  await until(() => /of \d/.test(container.querySelector(".result-hero .strip")?.textContent || ""), "this season's rank");
  const strip = container.querySelector(".result-hero .strip").textContent;
  assert(strip.includes(`of ${num(logged)}`), `ranked among the ${logged} logged seasons, not ${logged + 1}: ${strip}`);
});

await runTest("past the day's paid seasons, the result says why the season paid nothing", async () => {
  const paidToday = () => [...auth._ledger.values()].filter((r) => r.user_id === uid && r.kind === "season" && r.created_at.slice(0, 10) === utcToday()).length;
  for (let i = 0; paidToday() < 20; i++) auth._wallet.apply(uid, 1, "season", `CAP${i}`);
  const before = ledgerKeys(auth);
  const code = await playUnlimited(container);
  await until(() => coinsOf(container)?.querySelector(".sc-note"), () => `the cap note, got: ${container.querySelector(".result-hero")?.textContent}`);
  assert(coinsOf(container).querySelector(".sc-note").textContent === `Unlimited, Genius and GM pay coins for ${COIN_RULES.paidSeasonsPerDay} seasons a day. The Daily always pays.`, "the cap note's words");
  const added = addedRows(auth, before, uid);
  assert(!added.some((r) => r.kind === "season"), `a capped season pays nothing (code ${code}), got ${JSON.stringify(added)}`);
  assert(Number(coinsOf(container).dataset.earned) === added.reduce((sum, r) => sum + r.amount, 0), "earned is only what its badges paid");
  assert(!(coinsOf(container).querySelector(".sc-lines")?.textContent || "").includes("Finished a season"), "no season lines when the season didn't pay");
  assert(auth._profiles.get(uid).runs >= 2, "the season itself still counted");
});

await runTest("Over/Under pays +15 coins once a day, on its end screen", async () => {
  await playOverUnder(container);
  const rows = () => [...auth._ledger.values()].filter((r) => r.user_id === uid && r.kind === "minigame" && r.ref === `over_under:${localToday()}`);
  await until(() => container.querySelector(".gamecoins"), () => `+15 coins on the Over/Under result, got: ${text(container).slice(0, 300)}`);
  assert(spoken(container.querySelector(".gamecoins")) === "+15 coins", `expected "+15 coins", got "${spoken(container.querySelector(".gamecoins"))}"`);
  assert(rows().length === 1 && rows()[0].amount === 15, "one 15-coin claim in the ledger");

  // The same account on another device, the same day: the day plays, and pays nothing more.
  container = await open("http://localhost/", auth);
  await until(() => container.querySelector(".whoami"), "signed in on the other device");
  await playOverUnder(container);
  await flush(8);
  assert(!container.querySelector(".gamecoins"), "a second Over/Under the same day shows no coins");
  assert(rows().length === 1, "and claims nothing more");
});

await runTest("Build-a-player pays +15 coins once a day, on the build and its verdict", async () => {
  await click(tab(container, "Modes"));
  await flush();
  await clickMode(container, "Build-a-player");
  await flush();
  await buildPlayer(container);
  await until(() => container.querySelector(".gamecoins"), () => `+15 coins on the finished build, got: ${text(container).slice(0, 300)}`);
  assert(spoken(container.querySelector(".gamecoins")) === "+15 coins", "the build's coins");
  await click(findButtonByText(container, "Give him his shot"));
  await until(() => findButtonByText(container, "Build another"), "the verdict");
  assert(spoken(container.querySelector(".gamecoins")) === "+15 coins", "the verdict keeps showing the build's coins");
  const rows = () => [...auth._ledger.values()].filter((r) => r.user_id === uid && r.kind === "minigame" && r.ref === `build:${localToday()}`);
  assert(rows().length === 1, "one build claim in the ledger");

  await click(findButtonByText(container, "Build another"));
  await flush();
  await buildPlayer(container);
  await flush(8);
  assert(!container.querySelector(".gamecoins"), "a second build the same day shows no coins");
  assert(rows().length === 1 && auth._builds.size === 2, "both builds logged, one claim");
});

await runTest("signing out while in the shop leaves it, and its entry opens Modes afterwards", async () => {
  await click(container.querySelector(".whoami"));
  await until(() => profileOf(container)?.dataset.username === "shopper", "your profile");
  await click(named(profileOf(container), "Shop"));
  await until(() => shopOf(container)?.dataset.balance, "the shop");
  const { act } = await import("react-dom/test-utils");
  await act(async () => { await auth.auth.signOut(); }); // e.g. from another tab
  await flush(4);
  assert(!shopOf(container) && text(container).includes("Daily challenge"), `signing out leaves the shop for Modes, got: ${text(container).slice(0, 200)}`);
  assert(!container.querySelector(".whoami"), "signed out");
  await back();
  assert(!shopOf(container) && text(container).includes("Daily challenge"), `Back to the shop's entry opens Modes when signed out, got: ${text(container).slice(0, 200)}`);
});

await runTest("opening your own profile's address straight away shows your balance once the session is back", async () => {
  await close();
  await auth.auth.signInWithPassword({ email: "shopper@example.com", password: "Password1" });
  container = await open("http://localhost/u/shopper", auth);
  await until(() => profileOf(container)?.dataset.owner === "true", () => `your own profile at its address, got: ${text(container).slice(0, 200)}`);
  const balance = auth._wallet.balanceOf(uid);
  await until(() => spoken(profileOf(container)).includes(`${num(balance)} coins`), () => `your ${balance} coins on the card, got: ${spoken(profileOf(container)).slice(0, 300)}`);
});

await runTest("the next account to sign in on the device doesn't see the last account's season coins", async () => {
  await click(tab(container, "Modes"));
  await flush();
  await playUnlimited(container);
  await until(() => coinsOf(container)?.dataset.earned != null, "this season's coins");
  await click(container.querySelector(".whoami"));
  await until(() => profileOf(container)?.dataset.username === "shopper", "your profile");
  await click(named(profileOf(container), "Log out"));
  await flush(4);
  await click(tab(container, "Account"));
  await flush();
  await signUp(container.querySelector(".panel"), "nextup@example.com", "nextup");
  await until(() => container.querySelector(".whoami"), "the next account signed in");
  await click(tab(container, "Draft"));
  await flush(3);
  assert(container.querySelector(".result-hero .strip"), `the last season's result is still on the Draft tab, got: ${text(container).slice(0, 200)}`);
  assert(!coinsOf(container) && !container.querySelector(".result-hero .sc-dup"), `but not what it paid shopper, got: ${container.querySelector(".result-hero")?.textContent}`);
});

await close();
console.log("test-shop-flow.mjs done");
