// The cards' client half without mounting the app: the switch, the catalog load, and storage-cards.js against
// the mock. The screen has its own file (tests/test-cards-screen.mjs); this one holds the seams under it - above
// all that a read which FAILED is never answered as a collection which is EMPTY.
import { readFileSync } from "node:fs";
import { setupDom, makeStorage, makeMockAuth, loadModule, assert, runTest } from "./helpers.mjs";

setupDom();
window.storage = makeStorage();
const auth = makeMockAuth();
window.__ps_supabase__ = auth;

const { cardsOn } = await loadModule("cards-switch.mjs");
const { loadCardData, CARD_DATA_URL, _resetCardData } = await loadModule("card-data.mjs");
const { fetchMyCards, claimStarter, CARD_REFUSALS, fetchPacks, openPack, newOpenId } = await loadModule("storage-cards.js");

const catalog = JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8"));
async function signUp(email, username) {
  const { data, error } = await auth.auth.signUp({ email, password: "Password1", options: { data: { username } } });
  assert(!error && data?.user?.id, "signed up " + username + ": " + JSON.stringify(error));
  return data.user.id;
}

await runTest("the switch follows the build, and a test can decide", async () => {
  delete window.__ps_cards__;
  assert(cardsOn() === true, "the test build is on");
  window.__ps_cards__ = false; assert(cardsOn() === false, "forced off");
  window.__ps_cards__ = true; assert(cardsOn() === true, "forced on");
  window.__ps_cards__ = 0; assert(cardsOn() === false, "anything falsy is off");
  delete window.__ps_cards__;
});

await runTest("the catalog loads once, and a failed load is tried again", async () => {
  _resetCardData();
  let calls = 0;
  const down = async () => { calls++; throw new Error("offline"); };
  let threw = false;
  try { await loadCardData(down); } catch { threw = true; }
  assert(threw && calls === 1, "a load that fails rejects");
  const up = async (url, opts) => { calls++; assert(url === CARD_DATA_URL && opts.credentials === "omit", "asked for the catalog without credentials"); return { ok: true, json: async () => catalog }; };
  const info = await loadCardData(up);
  assert(calls === 2 && info.cards === 3124 && info.players === 1639, "the next call tries again and gets it: " + JSON.stringify(info));
  await loadCardData(up); await loadCardData(up);
  assert(calls === 2, "and after a success nobody fetches again");
  _resetCardData();
  let bad = false;
  try { await loadCardData(async () => ({ ok: false, status: 404 })); } catch { bad = true; }
  assert(bad, "a 404 is a failure, not an empty catalog");
  _resetCardData();
});

await runTest("reading a collection has three answers", async () => {
  await auth.auth.signOut();
  assert((await fetchMyCards()).status === "signed_out", "signed out");
  const uid = await signUp("ann@example.test", "ann");
  const empty = await fetchMyCards();
  assert(empty.status === "ok" && empty.cards.length === 0 && empty.starter === false, "a new account: ok and empty, no starter: " + JSON.stringify(empty));
  auth._cards.grantCards(uid, "daily", [{ ref: "2026-11-13", card: 12, finish: "gold" }]);
  const one = await fetchMyCards();
  assert(one.status === "ok" && JSON.stringify(one.cards) === JSON.stringify([{ id: 12, finish: "gold", count: 1 }]) && one.starter === false, "a daily card shows, and is not a starter deck: " + JSON.stringify(one));
  // The one that matters: a read that failed is NOT an empty collection.
  auth._cards.readFails = true;
  const failed = await fetchMyCards();
  assert(failed.status === "error" && failed.cards === undefined, "a failed read says so: " + JSON.stringify(failed));
  auth._cards.readFails = false;
});

await runTest("a collection bigger than one page of rows comes back whole", async () => {
  // PostgREST answers a select with at most 1,000 rows unless asked for a range, and the mock now does the
  // same. Found in review: one unpaged read would have truncated a large collection silently, with status ok.
  const uid = await signUp("big@example.test", "biggie");
  for (let from = 1; from <= 2400; from += 20) {
    auth._cards.grantCards(uid, "daily", Array.from({ length: 20 }, (_, i) => ({ ref: `d${from + i}`, card: from + i, finish: "base" })));
  }
  const all = await fetchMyCards();
  assert(all.status === "ok" && all.cards.length === 2400, "all 2,400 rows, not the first thousand: " + all.cards?.length);
  assert(new Set(all.cards.map((c) => c.id)).size === 2400, "and each once");
  await auth.auth.signOut();
  await auth.auth.signInWithPassword({ email: "ann@example.test", password: "Password1" });
});

await runTest("claiming a starter deck, and every way it is refused", async () => {
  const won = await claimStarter();
  assert(won.ok === true && won.cards.length === 8, "eight cards: " + JSON.stringify(won).slice(0, 120));
  const after = await fetchMyCards();
  assert(after.starter === true && after.cards.reduce((n, c) => n + c.count, 0) === 9, "the collection has them, beside the daily card");
  const again = await claimStarter();
  assert(again.ok === false && again.reason === "duplicate", "a second claim: " + JSON.stringify(again));

  auth._cards.enabled = false;
  await signUp("bob@example.test", "bob");
  const off = await claimStarter();
  assert(off.ok === false && off.reason === "cards_off", "the server's switch off: " + JSON.stringify(off));
  auth._cards.enabled = true;

  await auth.auth.signOut();
  const out = await claimStarter();
  assert(out.ok === false && out.reason === "signed_out", "signed out: " + JSON.stringify(out));
  await auth.auth.signInAnonymously();
  const guest = await claimStarter();
  assert(guest.ok === false && guest.reason === "guest_not_allowed", "a guest: " + JSON.stringify(guest));
  const guestCards = await fetchMyCards();
  assert(guestCards.status === "ok" && guestCards.cards.length === 0, "and the guest owns nothing");
});

await runTest("the pack shop: what is on sale, buying one, and asking again", async () => {
  await auth.auth.signOut();
  const shelf = await fetchPacks();
  assert(shelf.status === "ok" && shelf.packs.map((p) => p.id).join() === "pack-standard,pack-air-raid,pack-legends", "signed out, the shelf still reads, in shelf order: " + JSON.stringify(shelf).slice(0, 200));
  assert(JSON.stringify(shelf.packs[2]) === JSON.stringify({ id: "pack-legends", price: 1500, size: 1, active: true, stockTotal: 5000, stockLeft: 5000 }), "a limited pack carries its stock: " + JSON.stringify(shelf.packs[2]));
  assert(shelf.packs[0].stockLeft === null && shelf.packs[0].stockTotal === null, "and an unlimited one carries none");
  auth._cards.packsReadFail = true;
  assert((await fetchPacks()).status === "error", "a shelf that could not be read says so");
  auth._cards.packsReadFail = false;
  assert((await openPack("pack-standard", newOpenId())).reason === "signed_out", "signed out, nothing is sold");

  const uid = await signUp("pat@example.test", "pat"); // 250 welcome coins
  const id = newOpenId();
  assert(/^[A-Za-z0-9-]{8,36}$/.test(id) && id !== newOpenId(), "an open id is one the server accepts, and each is new: " + id);
  const got = await openPack("pack-standard", id);
  assert(got.ok === true && got.cards.length === 3 && got.balance === 100 && got.duplicate === false && got.stockLeft === null, "three cards for 150: " + JSON.stringify(got).slice(0, 200));
  assert((await fetchMyCards()).cards.reduce((n, c) => n + c.count, 0) === 3, "and they are in the collection");
  const poor = await openPack("pack-standard", newOpenId());
  assert(poor.ok === false && poor.reason === "not_enough", "100 coins does not buy another: " + JSON.stringify(poor));
  assert((await openPack("pack-nope", newOpenId())).reason === "unknown_pack", "a pack that does not exist");
  assert((await openPack("pack-standard", "x")).reason === "bad_open", "an id that is not one");

  // THE CASE THE OPEN ID EXISTS FOR: the purchase goes through and the answer never arrives.
  auth._wallet.apply(uid, 400, "season", "test");
  const lostId = newOpenId();
  auth._cards.openFails = true;
  const lost = await openPack("pack-standard", lostId);
  assert(lost.ok === false && lost.reason === "offline", "the answer was lost: " + JSON.stringify(lost));
  assert(auth._wallet.balanceOf(uid) === 350, "though the coins were taken");
  const found = await openPack("pack-standard", lostId);
  assert(found.ok === true && found.duplicate === true && found.cards.length === 3 && found.balance === 350, "asking again with the same id hands over that pack, and charges nothing: " + JSON.stringify(found).slice(0, 200));
  assert((await fetchMyCards()).cards.reduce((n, c) => n + c.count, 0) === 6, "two packs' cards in all, not three");

  auth._cards.packs.get("pack-standard").active = false;
  assert((await openPack("pack-standard", newOpenId())).reason === "unavailable", "off sale");
  auth._cards.packs.get("pack-standard").active = true;
  auth._cards.packs.get("pack-legends").stock_left = 0;
  auth._wallet.apply(uid, 5000, "season", "test2");
  assert((await openPack("pack-legends", newOpenId())).reason === "sold_out", "sold out");
  auth._cards.packs.get("pack-legends").stock_left = 5000;
  await auth.auth.signOut();
  await auth.auth.signInWithPassword({ email: "ann@example.test", password: "Password1" });
});

await runTest("a failure that names nothing is not called a refusal", async () => {
  const real = auth.functions.invoke;
  auth.functions.invoke = async () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send" } });
  assert((await claimStarter()).reason === "offline", "nothing came back");
  auth.functions.invoke = async () => ({ data: null, error: { context: { status: 502, json: async () => { throw new Error("not json"); } } } });
  assert((await claimStarter()).reason === "offline", "a body that cannot be read");
  auth.functions.invoke = async () => ({ data: null, error: { context: { status: 400, json: async () => ({ reason: "something_new" }) } } });
  assert((await claimStarter()).reason === "network", "a reason this client has never heard of");
  auth.functions.invoke = async () => ({ data: null, error: { context: { status: 500, json: async () => ({ error: "boom" }) } } });
  assert((await claimStarter()).reason === "server", "an answer with no reason in it");
  auth.functions.invoke = async () => ({ data: { ok: true }, error: null });
  assert((await claimStarter()).reason === "server", "a 200 that is not a deck");
  auth.functions.invoke = async () => { throw new Error("boom"); };
  assert((await claimStarter()).reason === "offline", "a throw");
  auth.functions.invoke = real;
  assert(CARD_REFUSALS.includes("cards_off") && !CARD_REFUSALS.includes("offline") && !CARD_REFUSALS.includes("network"), "offline and network are not the function's words");
});

await runTest("the service worker never serves a stale catalog", async () => {
  const { planFor } = await import("../sw-rules.mjs");
  const plan = planFor({ method: "GET", url: "https://gridspin.test/data/cards.json" }, "https://gridspin.test");
  assert(plan === "bundle", "the catalog is fetched network-first, like the bundle it has to agree with: " + plan);
});

console.log("test-cards-client.mjs done");
