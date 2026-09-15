// The shop screen (shop.jsx) on its own, in jsdom, against the mock's coins and shop functions: buying with
// enough and too few coins, the confirm step, equipping, taking a title off, badge items, avatar packs, the
// showcase, failures, loading and retry, and the wallet's lines. Then the profile card wearing what's equipped
// (profile.jsx): its cosmetics for the owner and a visitor, the owner's balance and Shop button, the showcase's
// order, and the avatar packs reaching the picture picker. SHOP.md 7.2 and 7.3 are the contract.
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import { setupDom, loadModule, renderComponent, click, flush, text, assert, runTest, makeMockAuth, root } from "./helpers.mjs";
import { veteranProfile } from "./fixtures/profile-fixture.mjs";
import { badgeProgress, topBadges } from "../badges.mjs";
import { KIND_LABEL, LAUNCH_PRICES } from "../shop-catalog.mjs";

setupDom();
window.__ps_supabase__ = makeMockAuth();
const { act } = await import("react");
const { ShopScreen, WalletPanel, SHOP_CSS, itemState } = await loadModule("shop.jsx");
const { ProfileScreen } = await loadModule("profile.jsx");

function spy(result) {
  const fn = (...args) => { fn.calls.push(args); return typeof result === "function" ? result(...args) : result; };
  fn.calls = [];
  return fn;
}
const noop = () => {};

let shown = null;
async function show(Component, props) {
  if (shown) await act(async () => shown.reactRoot.unmount());
  shown = await renderComponent(Component, props);
  await flush();
  return shown.container;
}
const buttons = (c) => [...c.querySelectorAll("button")].map((b) => b.textContent.trim());
const button = (c, label) => [...c.querySelectorAll("button")].find((b) => b.textContent.trim() === label) || null;
const shopRoot = (c) => c.querySelector("section.shop");
const balance = (c) => shopRoot(c)?.getAttribute("data-balance");
const tile = (c, id) => c.querySelector(`article.sh-item[data-item="${id}"]`);
const stateOf = (c, id) => tile(c, id)?.dataset.state;
const tab = (c, name) => [...c.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === name) || null;
// The card preview at the top of the shop (the item details carry a small copy of it too).
const preview = (c) => c.querySelector(".sh-case");
async function waitFor(cond, what) {
  for (let i = 0; i < 40; i++) {
    if (cond()) return;
    await flush(1);
  }
  throw new Error("timed out waiting for " + what);
}
// Selects an item by its tile's first button, as the contract's test hook describes.
async function select(c, id) {
  const t = tile(c, id);
  assert(t, `no tile for ${id}; tiles: ${[...c.querySelectorAll("article.sh-item")].map((a) => a.dataset.item)}`);
  await click(t.querySelector("button"));
}
async function openTab(c, name) {
  await click(tab(c, name));
  assert(tab(c, name).getAttribute("aria-selected") === "true", `${name} should be the selected tab`);
}
async function key(el, k) {
  await act(async () => { el.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
}

// A fresh mock database with one signed-in player, who starts with the welcome coins (250). `coins` more come
// in as a season's.
async function player(username, { coins = 0 } = {}) {
  const auth = makeMockAuth();
  window.__ps_supabase__ = auth;
  const { data } = await auth.auth.signUp({ email: `${username}@example.com`, password: "Password1", options: { data: { username } } });
  const uid = data.user.id;
  if (coins) auth._wallet.apply(uid, coins, "season", `TEST${coins}`);
  return { auth, uid };
}
async function openShop(username, uid, over = {}) {
  const props = { userId: uid, username, onBack: spy(), onDetailsSaved: spy(), onBalance: spy(), ...over };
  const c = await show(ShopScreen, props);
  await waitFor(() => balance(c) != null, "the shop to load");
  return { c, props };
}

await runTest("loads: balance hook, tabs, every item with a state, the wallet; Back calls onBack", async () => {
  const { uid } = await player("loader", { coins: 1000 });
  const { c, props } = await openShop("loader", uid);
  assert(balance(c) === "1250", "data-balance is the balance, got " + balance(c));
  assert(props.onBalance.calls.at(-1)?.[0] === 1250, "onBalance hears the loaded balance");
  const names = [...c.querySelectorAll('[role="tab"]')].map((b) => b.textContent.trim());
  assert(JSON.stringify(names) === JSON.stringify([...Object.values(KIND_LABEL), "Showcase"]), "tabs: " + names);
  assert(tab(c, "Frames").getAttribute("aria-selected") === "true", "Frames is open first");
  const frames = [...c.querySelectorAll("article.sh-item")].map((a) => `${a.dataset.item}:${a.dataset.state}`);
  assert(JSON.stringify(frames) === JSON.stringify(["frame-ink:equipped", "frame-lime:buy", "frame-team:short", "frame-gold:short", "frame-flame:short", "frame-undefeated:locked"]),
    "frames and their states: " + frames);
  assert(text(tile(c, "frame-team")).includes("750 more coins"), "a short item says how many more coins it needs");
  assert(preview(c)?.querySelector('[data-card="card-navy"]') && preview(c).querySelector('[data-frame="frame-ink"]'), "the preview wears the defaults");
  assert(preview(c).textContent.includes("loader"), "the preview carries your name");
  assert(c.querySelector(".sh-wallet")?.textContent.includes("+250 · Welcome coins"), "the wallet lists the welcome coins");
  await click(button(c, "Back"));
  assert(props.onBack.calls.length === 1, "Back calls onBack");
});

await runTest("loading, then an error with Try again that loads the shop", async () => {
  const { auth, uid } = await player("flaky");
  const realRpc = auth.rpc;
  let fail = true;
  let answer = null;
  auth.rpc = (name, args) => {
    if (name !== "shop_state") return realRpc(name, args);
    if (fail) return Promise.resolve({ data: null, error: { message: "Failed to fetch" } });
    return new Promise((resolve) => { answer = () => resolve(realRpc(name, args)); });
  };
  const c = await show(ShopScreen, { userId: uid, username: "flaky", onBack: noop, onDetailsSaved: noop, onBalance: noop });
  await waitFor(() => text(c).includes("The shop didn't load."), "the error message");
  assert(shopRoot(c) && !shopRoot(c).hasAttribute("data-balance"), "no data-balance without a shop");
  fail = false;
  await click(button(c, "Try again"));
  assert(text(c).includes("Loading the shop"), "Try again shows loading while it asks, got: " + text(c));
  assert(!shopRoot(c).hasAttribute("data-balance"), "no data-balance while loading");
  await act(async () => { answer(); });
  await waitFor(() => balance(c) === "250", "the retried shop");
  assert(tile(c, "frame-lime"), "the items show once it loads");
});

await runTest("buy with enough coins: select, Buy, Confirm purchase, then equipped, the balance and the callbacks", async () => {
  const { auth, uid } = await player("buyer", { coins: 1000 });
  const { c, props } = await openShop("buyer", uid);
  assert(!button(c, "Buy"), "no Buy until an item is selected");
  await select(c, "frame-lime");
  const pickButton = tile(c, "frame-lime").querySelector("button");
  assert(pickButton.getAttribute("aria-expanded") === "true", "the selected item's button says it's open");
  assert(preview(c).querySelector('[data-frame="frame-lime"]'), "the preview wears the selected frame");
  assert(preview(c).textContent.includes("Preview"), "the case says it's a preview");
  const buy = tile(c, "frame-lime").querySelector("button:not(.sh-pick)");
  assert(buy?.textContent.trim() === "Buy", "the selected item's article holds Buy, got: " + buttons(tile(c, "frame-lime")));
  await click(buy);
  assert(button(c, "Confirm purchase") && button(c, "Cancel") && !button(c, "Buy"), "Buy asks to confirm, got: " + buttons(c));
  assert(text(tile(c, "frame-lime")).includes("You'll have 500 left."), "the confirm step says what's left");
  assert(!auth._inventory.has(`${uid}|frame-lime`), "nothing is bought before confirming");
  await click(button(c, "Confirm purchase"));
  await waitFor(() => stateOf(c, "frame-lime") === "equipped", "the bought frame to be equipped");
  assert(balance(c) === "500", "the balance drops by the price, got " + balance(c));
  assert(stateOf(c, "frame-ink") === "owned", "the free frame is no longer worn");
  assert(text(tile(c, "frame-lime")).includes("Bought and equipped."), "it says so, got: " + text(tile(c, "frame-lime")));
  assert(props.onBalance.calls.at(-1)?.[0] === 500, "onBalance hears the new balance");
  const saved = props.onDetailsSaved.calls.at(-1)?.[0];
  assert(saved?.frame === "frame-lime", "onDetailsSaved gets the details wearing the frame, got " + JSON.stringify(saved));
  assert(auth._inventory.has(`${uid}|frame-lime`) && auth._profileDetails.get(uid)?.frame === "frame-lime", "bought and equipped in the database");
  assert(!preview(c).textContent.includes("Preview"), "wearing it, the preview is just your card");
  assert(c.querySelector(".sh-wallet").textContent.includes("−750 · Lime"), "the wallet lists the purchase, got: " + c.querySelector(".sh-wallet").textContent);
});

await runTest("Cancel backs out of a purchase; selecting again closes the item", async () => {
  const { auth, uid } = await player("canceller", { coins: 1000 });
  const { c } = await openShop("canceller", uid);
  await select(c, "frame-lime");
  await click(button(c, "Buy"));
  await click(button(c, "Cancel"));
  assert(button(c, "Buy") && !button(c, "Confirm purchase"), "Cancel goes back to Buy, got: " + buttons(c));
  assert(balance(c) === "1250" && !auth._inventory.has(`${uid}|frame-lime`), "nothing was bought");
  await select(c, "frame-lime");
  assert(!button(c, "Buy") && tile(c, "frame-lime").querySelector("button").getAttribute("aria-expanded") === "false", "pressing the item again closes it");
  assert(preview(c).querySelector('[data-frame="frame-ink"]'), "and the preview goes back to what's worn");
});

await runTest("too few coins: N more coins, and no Buy", async () => {
  const { uid } = await player("saver");
  const { c } = await openShop("saver", uid);
  assert(stateOf(c, "frame-lime") === "short", "750 with 250 is short, got " + stateOf(c, "frame-lime"));
  assert(text(tile(c, "frame-lime")).includes("500 more coins"), "says 500 more coins");
  await select(c, "frame-lime");
  assert(!button(c, "Buy"), "no Buy for an item you can't afford");
  assert(preview(c).querySelector('[data-frame="frame-lime"]'), "you can still see it on your card");
});

await runTest("equip an owned item, and take off a title", async () => {
  const { uid } = await player("dresser", { coins: 3000 });
  const { c, props } = await openShop("dresser", uid);
  await select(c, "frame-lime");
  await click(button(c, "Buy"));
  await click(button(c, "Confirm purchase"));
  await waitFor(() => stateOf(c, "frame-lime") === "equipped", "the lime frame");

  await select(c, "frame-ink");
  const equip = tile(c, "frame-ink").querySelector("button:not(.sh-pick)");
  assert(equip?.textContent.trim() === "Equip", "an owned item's article holds Equip, got: " + buttons(tile(c, "frame-ink")));
  await click(equip);
  await waitFor(() => stateOf(c, "frame-ink") === "equipped", "Ink to be worn again");
  assert(stateOf(c, "frame-lime") === "owned", "Lime is still owned, just not worn");
  assert(props.onDetailsSaved.calls.at(-1)?.[0].frame === "frame-ink", "onDetailsSaved hears the free frame is back on");

  await openTab(c, "Titles");
  await select(c, "title-film-room");
  await click(button(c, "Buy"));
  await click(button(c, "Confirm purchase"));
  await waitFor(() => stateOf(c, "title-film-room") === "equipped", "the bought title");
  assert(preview(c).querySelector('[data-title="title-film-room"]'), "the card shows the title");
  // Another title, not bought: the card wears it over what's equipped (the Ink frame stays).
  await select(c, "title-waiver-hawk");
  assert(preview(c).querySelector('[data-title="title-waiver-hawk"]') && !preview(c).querySelector('[data-title="title-film-room"]'), "the preview swaps in the selected title");
  await select(c, "title-film-room");
  const takeOff = tile(c, "title-film-room").querySelector("button:not(.sh-pick)");
  assert(takeOff?.textContent.trim() === "Take off", "the equipped title's article holds Take off, got: " + buttons(tile(c, "title-film-room")));
  await click(takeOff);
  await waitFor(() => stateOf(c, "title-film-room") === "owned", "the title to come off");
  assert(props.onDetailsSaved.calls.at(-1)?.[0].title === null, "onDetailsSaved hears the title is off");
  await select(c, "title-film-room"); // close it, so the preview shows only what's worn
  assert(!preview(c).querySelector("[data-title]"), "no title on the card");
  assert(balance(c) === "1750", "3,250 less 750 twice, got " + balance(c));
});

await runTest("badge items: locked until earned, then waiting for a season, then yours once awarded", async () => {
  const { auth, uid } = await player("chaser");
  let { c } = await openShop("chaser", uid);
  assert(stateOf(c, "frame-undefeated") === "locked", "a badge item you don't have is locked");
  assert(text(tile(c, "frame-undefeated")).includes("Earn the Undefeated badge"), "it names the badge, got: " + text(tile(c, "frame-undefeated")));
  assert(tile(c, "frame-undefeated").querySelector(".sh-lock")?.textContent === "🏆", "with the badge's emoji");
  await select(c, "frame-undefeated");
  assert(!button(c, "Buy") && !button(c, "Equip"), "nothing to buy or equip");

  // Earned (the profile's stats say so), but not paid out yet: that happens with the next finished season.
  auth._profiles.get(uid).perfect = 1;
  ({ c } = await openShop("chaser", uid));
  assert(stateOf(c, "frame-undefeated") === "locked", "still locked until it's awarded");
  assert(text(tile(c, "frame-undefeated")).includes("Unlocks after your next finished season"), "says when it unlocks, got: " + text(tile(c, "frame-undefeated")));

  auth._badgeAwards.set(`${uid}|undefeated`, { user_id: uid, badge: "undefeated", awarded_at: new Date().toISOString() });
  ({ c } = await openShop("chaser", uid));
  assert(stateOf(c, "frame-undefeated") === "owned", "an awarded badge's item is owned, got " + stateOf(c, "frame-undefeated"));
  await select(c, "frame-undefeated");
  await click(button(c, "Equip"));
  await waitFor(() => stateOf(c, "frame-undefeated") === "equipped", "the badge frame to be worn");
  assert(auth._profileDetails.get(uid)?.frame === "frame-undefeated", "equipped in the database");
  assert(balance(c) === "250", "badge items cost nothing");
});

await runTest("an avatar pack: bought, not equipped, and its avatars become choosable", async () => {
  const { auth, uid } = await player("collector", { coins: 1000 });
  const { c, props } = await openShop("collector", uid);
  await openTab(c, "Avatar packs");
  assert([...c.querySelectorAll("article.sh-item")].map((a) => a.dataset.item).join() === "pack-sideline,pack-trophy-room,pack-night-game", "the three packs");
  await select(c, "pack-sideline");
  assert(preview(c).querySelector('.sh-pack[aria-label="Headset, Water cooler, Pylon, Penalty flag"]'), "the case shows the pack's avatars");
  await click(button(c, "Buy"));
  await click(button(c, "Confirm purchase"));
  await waitFor(() => stateOf(c, "pack-sideline") === "owned", "the pack to be owned");
  assert(text(tile(c, "pack-sideline")).includes("Bought. Choose one in Edit profile."), "it points to Edit profile, got: " + text(tile(c, "pack-sideline")));
  assert(props.onDetailsSaved.calls.length === 0, "a pack isn't worn, so no details change");
  assert(balance(c) === "500", "1,250 less 750, got " + balance(c));
  assert(!button(c, "Equip"), "a pack has no Equip");
  const { data, error } = await auth.rpc("set_avatar", { p_preset: "headset" });
  assert(!error && data.avatar_preset === "headset", "the pack's avatar can be set now, got " + JSON.stringify(error));
});

await runTest("refusals in words: a network failure, and not enough coins after all", async () => {
  const { auth, uid } = await player("unlucky", { coins: 1000 });
  const realRpc = auth.rpc;
  auth.rpc = (name, args) => (name === "shop_buy" ? Promise.resolve({ data: null, error: { message: "TypeError: Failed to fetch" } }) : realRpc(name, args));
  const { c, props } = await openShop("unlucky", uid);
  await select(c, "frame-lime");
  await click(button(c, "Buy"));
  await click(button(c, "Confirm purchase"));
  await waitFor(() => text(c).includes("That didn't go through. Try again."), "the network message");
  const status = tile(c, "frame-lime").querySelector('[role="status"]');
  assert(status?.textContent === "That didn't go through. Try again.", "the message is in the item's live region");
  assert(balance(c) === "1250" && stateOf(c, "frame-lime") === "buy" && button(c, "Buy"), "nothing changed, and Buy is back");
  assert(props.onDetailsSaved.calls.length === 0, "no details change");

  // The server has fewer coins than this screen thinks (spent in another tab).
  auth.rpc = realRpc;
  auth._wallet.apply(uid, -1000, "purchase", "frame-gold-elsewhere");
  await click(button(c, "Buy"));
  await click(button(c, "Confirm purchase"));
  await waitFor(() => text(c).includes("You don't have enough coins for that."), "the not-enough message");
  await waitFor(() => balance(c) === "250", "the refreshed balance");
  assert(stateOf(c, "frame-lime") === "short", "the refresh shows it's out of reach now");
});

await runTest("an item bought elsewhere reloads the shop", async () => {
  const { auth, uid } = await player("twotabs", { coins: 1000 });
  const { c } = await openShop("twotabs", uid);
  await select(c, "frame-lime");
  await auth.rpc("shop_buy", { p_item: "frame-lime" });
  await click(button(c, "Buy"));
  await click(button(c, "Confirm purchase"));
  await waitFor(() => stateOf(c, "frame-lime") === "owned", "the reloaded state");
  assert(balance(c) === "500", "the reload shows the real balance, got " + balance(c));
});

await runTest("showcase: earned badges only, at most three, saved in order, and the card shows them", async () => {
  const { auth, uid } = await player("showoff");
  Object.assign(auth._profiles.get(uid), { runs: 100, champs: 10, perfect: 1 });
  const { c, props } = await openShop("showoff", uid);
  await openTab(c, "Showcase");
  const boxes = () => [...c.querySelectorAll('input[name="showcase"]')];
  const values = boxes().map((b) => b.value);
  assert(JSON.stringify(values) === JSON.stringify(["first-down", "starter", "veteran", "ring-bearer", "dynasty", "undefeated", "day-one"]), "one checkbox per earned badge: " + values);
  const box = (id) => c.querySelector(`input[name="showcase"][value="${id}"]`);
  const cardOrder = () => [...preview(c).querySelectorAll("[data-badge]")].map((b) => b.dataset.badge);
  const joined = auth._profiles.get(uid).created_at;
  const top = topBadges(badgeProgress({ stats: { runs: 100, champs: 10, perfect: 1 }, joined }), 3).map((b) => b.id);
  assert(JSON.stringify(cardOrder()) === JSON.stringify(top), "with nothing chosen the card shows the top three: " + cardOrder());
  assert(button(c, "Save showcase").disabled, "nothing to save yet");

  await click(box("day-one"));
  await click(box("starter"));
  await click(box("dynasty"));
  assert(boxes().filter((b) => !b.checked).every((b) => b.disabled), "at three, the rest are disabled");
  assert(JSON.stringify(cardOrder()) === JSON.stringify(["day-one", "starter", "dynasty"]), "the card shows them in the order chosen: " + cardOrder());
  await click(box("starter"));
  assert(boxes().every((b) => !b.disabled), "below three, every box is open again");
  await click(box("ring-bearer"));
  await click(button(c, "Save showcase"));
  await waitFor(() => text(c).includes("Showcase saved."), "the saved message");
  const want = ["day-one", "dynasty", "ring-bearer"];
  assert(JSON.stringify(props.onDetailsSaved.calls.at(-1)?.[0].showcase) === JSON.stringify(want), "onDetailsSaved gets the showcase in order");
  assert(JSON.stringify(auth._profileDetails.get(uid)?.showcase) === JSON.stringify(want), "saved through set_showcase");
  assert(JSON.stringify(cardOrder()) === JSON.stringify(want), "the card keeps it: " + cardOrder());
  assert(button(c, "Save showcase").disabled, "saved, so nothing left to save");
});

await runTest("keyboard: arrow keys move between tabs, and the selected item's button says it's open", async () => {
  const { uid } = await player("keys", { coins: 1000 });
  const { c } = await openShop("keys", uid);
  const frames = tab(c, "Frames");
  assert(frames.tabIndex === 0 && tab(c, "Titles").tabIndex === -1, "only the selected tab is in the tab order");
  const panel = c.querySelector('[role="tabpanel"]');
  assert(panel.getAttribute("aria-labelledby") === frames.id && frames.getAttribute("aria-controls") === panel.id, "the tab and its panel point at each other");
  frames.focus();
  await key(frames, "ArrowRight");
  assert(tab(c, "Card themes").getAttribute("aria-selected") === "true" && document.activeElement === tab(c, "Card themes"), "ArrowRight selects and focuses the next tab");
  assert(tile(c, "card-turf") && !tile(c, "frame-lime"), "and shows its items");
  await key(document.activeElement, "End");
  assert(document.activeElement === tab(c, "Showcase"), "End goes to the last tab");
  await key(document.activeElement, "ArrowRight");
  assert(document.activeElement === tab(c, "Frames"), "ArrowRight wraps around to the first");
  const pickButton = tile(c, "frame-gold").querySelector("button");
  assert(pickButton.getAttribute("aria-expanded") === "false", "an item starts closed");
  assert(document.getElementById(pickButton.getAttribute("aria-describedby"))?.textContent.includes("Epic"), "the item's button is described by its rarity and price");
  // Buy and Confirm purchase replace each other; the keyboard follows instead of dropping to the page.
  await select(c, "frame-lime");
  const detail = document.getElementById(tile(c, "frame-lime").querySelector("button").getAttribute("aria-controls"));
  assert(detail && tile(c, "frame-lime").contains(detail), "the open item's button controls its details, inside its article");
  await click(button(c, "Buy"));
  assert(document.activeElement === button(c, "Confirm purchase"), "Buy moves focus to Confirm purchase");
  await click(button(c, "Cancel"));
  assert(document.activeElement === button(c, "Buy"), "Cancel moves focus back to Buy");
});

await runTest("WalletPanel: balance, earned, spent and every kind of line", async () => {
  const at = "2026-09-14T18:00:00.000Z";
  const wallet = {
    balance: 3386, earned: 4136, spent: 750,
    recent: [
      { amount: 186, kind: "season", ref: "ABCD1234", createdAt: at },
      { amount: -750, kind: "purchase", ref: "frame-lime", createdAt: at },
      { amount: 40, kind: "daily", ref: "2026-09-14:fantasy", createdAt: at },
      { amount: 1000, kind: "badge", ref: "undefeated", createdAt: at },
      { amount: 15, kind: "minigame", ref: "over_under:2026-09-14", createdAt: at },
      { amount: 15, kind: "minigame", ref: "build:2026-09-14", createdAt: at },
      { amount: 250, kind: "welcome", ref: "welcome", createdAt: at },
      { amount: 2630, kind: "starting", ref: "career", createdAt: null },
    ],
  };
  const c = await show(WalletPanel, { wallet });
  const lines = [...c.querySelectorAll(".sh-ledger")].map((li) => li.textContent);
  const want = ["+186 · Season", "−750 · Lime", "+40 · Daily", "+1,000 · Undefeated badge", "+15 · Over/Under", "+15 · Build-a-player", "+250 · Welcome coins", "+2,630 · Starting balance"];
  want.forEach((w, i) => assert(lines[i]?.startsWith(w), `line ${i} should read "${w}", got "${lines[i]}"`));
  const sum = c.querySelector(".sh-sum").textContent;
  assert(sum.includes("3,386") && sum.includes("4,136") && sum.includes("750"), "the three figures, got: " + sum);
  const empty = await show(WalletPanel, { wallet: null });
  assert(empty.innerHTML === "", "no wallet, no panel");
});

await runTest("styles: only sh- classes, hover inside (hover:hover), and motion off under reduced motion", async () => {
  const selectors = SHOP_CSS.replace(/\/\*[\s\S]*?\*\//g, "").match(/[^{}]+(?=\{)/g).map((s) => s.trim()).filter((s) => !s.startsWith("@"));
  const stray = selectors.flatMap((s) => s.split(",")).map((s) => s.trim()).filter((s) => !/^\.sh-[a-z]/.test(s));
  assert(!stray.length, "every rule starts with an sh- class: " + stray);
  const outsideHover = SHOP_CSS.split("@media (hover:hover)")[0];
  assert(!/:hover/.test(outsideHover), "hover rules live inside (hover:hover)");
  const reduced = SHOP_CSS.split("@media (prefers-reduced-motion:reduce)")[1] || "";
  assert(/\.sh-tile[^{]*\{[^}]*transition:none/.test(reduced) && /transform:none/.test(reduced), "reduced motion turns off the tile's transition and lift");
  assert(itemState({ owned: false, badge: null, price: 750, kind: "frame" }, { balance: 750, equipped: {} }) === "buy", "exactly enough coins can buy");
});

// ---------- The profile card (profile.jsx) ----------
const worn = (over = {}) => {
  const p = veteranProfile();
  return { ...p, details: { ...p.details, frame: "frame-gold", cardTheme: "card-turf", title: "title-draft-guru", showcase: [], ...over } };
};
const profileProps = (over = {}) => ({
  status: "ok", profile: worn(), isOwner: false, userId: null, rank: { fantasy: null, standard: null }, moderator: null,
  onRetry: noop, onShare: async () => "copied", onDetailsSaved: noop, onLogOut: noop, onPlay: noop, onOpenReports: noop, ...over,
});
const cardBadgeIds = (c) => [...c.querySelectorAll(".pf-card .pf-tops [data-badge]")].map((li) => li.dataset.badge);

await runTest("the profile card wears its cosmetics for the owner and a visitor; only the owner gets the balance and Shop", async () => {
  window.__ps_supabase__ = makeMockAuth();
  const p = worn();
  const onOpenShop = spy();
  let c = await show(ProfileScreen, profileProps({ profile: p, isOwner: true, userId: p.id, wallet: { balance: 4210 }, onOpenShop }));
  const check = (who) => {
    const card = c.querySelector(".pf-card");
    assert(card?.dataset.card === "card-turf", `${who}: the card is a CardTheme wearing its theme, got ${card?.dataset.card}`);
    assert(card.querySelector('.pf-head [data-frame="frame-gold"]'), `${who}: the picture wears its frame`);
    const title = card.querySelector('[data-title="title-draft-guru"]');
    assert(title?.textContent === "Draft Guru" && title.previousElementSibling?.classList.contains("pf-name"), `${who}: the title sits right under the name`);
  };
  check("owner");
  const shop = button(c, "Shop");
  assert(shop, "the owner gets a Shop button, got: " + buttons(c));
  const coins = c.querySelector(".pf-card .pf-facts .pf-coins");
  assert(coins?.textContent.includes("4,210") && coins.textContent.includes("coins"), "the owner's balance is on the card, got: " + coins?.textContent);
  await click(shop);
  assert(onOpenShop.calls.length === 1, "Shop calls onOpenShop");

  c = await show(ProfileScreen, profileProps({ profile: p, userId: "someone-else", wallet: { balance: 4210 }, onOpenShop }));
  check("visitor");
  assert(!button(c, "Shop") && !c.querySelector(".pf-coins") && !text(c).includes("4,210"), "a visitor sees neither the balance nor Shop");

  c = await show(ProfileScreen, profileProps({ profile: p, isOwner: true, userId: p.id, wallet: null, onOpenShop: undefined }));
  assert(!button(c, "Shop") && !c.querySelector(".pf-coins"), "no wallet or shop handler, nothing about coins");

  c = await show(ProfileScreen, profileProps({ profile: veteranProfile() }));
  assert(c.querySelector(".pf-card")?.dataset.card === "card-navy" && c.querySelector('.pf-card [data-frame="frame-ink"]'), "nothing equipped is the Navy card and the Ink frame");
  assert(!c.querySelector(".pf-card [data-title]"), "and no title");
});

await runTest("the profile card shows the showcase's earned badges in order, else the top three", async () => {
  const p = veteranProfile();
  const progress = badgeProgress({ stats: p.stats, extra: p.extra, details: p.details, joined: p.joined });
  const top = topBadges(progress, 3).map((b) => b.id);
  let c = await show(ProfileScreen, profileProps({ profile: worn({ showcase: ["day-one", "ring-bearer", "undefeated"] }) }));
  assert(JSON.stringify(cardBadgeIds(c)) === JSON.stringify(["day-one", "ring-bearer", "undefeated"]), "the showcase's order: " + cardBadgeIds(c));
  assert(c.querySelector(".pf-tops").getAttribute("aria-label") === "Showcase", "a chosen showcase is named as one");
  // Veteran (100 seasons) isn't earned yet: skipped, the rest stay in order.
  c = await show(ProfileScreen, profileProps({ profile: worn({ showcase: ["veteran", "starter", "ring-bearer"] }) }));
  assert(JSON.stringify(cardBadgeIds(c)) === JSON.stringify(["starter", "ring-bearer"]), "unearned ids are skipped: " + cardBadgeIds(c));
  c = await show(ProfileScreen, profileProps({ profile: worn({ showcase: ["veteran", "hall-of-famer"] }) }));
  assert(JSON.stringify(cardBadgeIds(c)) === JSON.stringify(top), "none earned: the top three, got " + cardBadgeIds(c));
  assert(c.querySelector(".pf-tops").getAttribute("aria-label") === "Best badges", "and they're named as the best badges");
});

// avatar-picker.jsx is K's component, so, as in test-profile-screen.mjs, profile.jsx is bundled with a stand-in
// picker that hands its props to the test.
await runTest("Edit profile's picture picker gets the owned avatar packs, starter always", async () => {
  const outfile = path.join(root, "build", "test-shop-screen-picker.mjs");
  await esbuild.build({
    entryPoints: [path.join(root, "profile.jsx")], bundle: true, format: "esm", jsx: "automatic", platform: "browser", outfile,
    external: ["react", "react-dom", "react-dom/client"],
    define: { APP_VERSION: '"test"', APP_ENV: '"production"', APP_SITE_URL: '"https://gridspin.test"' },
    plugins: [{
      name: "picker-stand-in",
      setup(build) {
        build.onResolve({ filter: /avatar-picker\.jsx$/ }, () => ({ path: "picker", namespace: "stand-in" }));
        build.onLoad({ filter: /.*/, namespace: "stand-in" }, () => ({
          loader: "jsx",
          contents: "export const PICKER_CSS = ''; export function AvatarPicker(props) { globalThis.__picker = props; return <div className='ap-stand-in' />; }",
        }));
      },
    }],
  });
  const { ProfileScreen: Screen } = await import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
  const { auth, uid } = await player("packrat", { coins: 7000 });
  for (const item of ["pack-sideline", "pack-night-game"]) {
    const { error } = await auth.rpc("shop_buy", { p_item: item });
    assert(!error, `buying ${item}: ${JSON.stringify(error)}`);
  }
  assert(auth._wallet.balanceOf(uid) === 7250 - LAUNCH_PRICES.common - LAUNCH_PRICES.epic, "both packs bought");
  const base = veteranProfile({ id: uid, username: "packrat" });
  const c = await show(Screen, profileProps({ profile: base, isOwner: true, userId: uid }));
  await click(button(c, "Edit profile"));
  await flush();
  await click(button(c, "Change picture"));
  await waitFor(() => (globalThis.__picker?.ownedPacks || []).length === 3, "the owned packs to reach the picker");
  assert(JSON.stringify(globalThis.__picker.ownedPacks) === JSON.stringify(["starter", "sideline", "night-game"]), "starter plus the bought packs, got " + JSON.stringify(globalThis.__picker.ownedPacks));

  // A player who hasn't bought any: just the starter set, even when the shop can't be read.
  const { auth: other, uid: otherId } = await player("starteronly");
  const otherRpc = other.rpc;
  other.rpc = (name, args) => (name === "shop_state" ? Promise.resolve({ data: null, error: { message: "Failed to fetch" } }) : otherRpc(name, args));
  const c2 = await show(Screen, profileProps({ profile: veteranProfile({ id: otherId, username: "starteronly" }), isOwner: true, userId: otherId }));
  await click(button(c2, "Edit profile"));
  await flush();
  await click(button(c2, "Change picture"));
  assert(JSON.stringify(globalThis.__picker.ownedPacks) === JSON.stringify(["starter"]), "only starter, got " + JSON.stringify(globalThis.__picker.ownedPacks));
});

if (shown) await act(async () => shown.reactRoot.unmount());
console.log("test-shop-screen.mjs done");
