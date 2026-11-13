// The real supabase/functions/card-claim/index.ts, executed (tests/edge-harness.mjs bundles it and runs it over a
// store this file supplies). It hands out the starter deck, so what matters is the order it refuses in, that a
// second claim changes nothing, and that it never grants a thing while the server's switch is off.
//
// The store's grant_cards is tests/mock-cards.mjs's, which tests/test-cards-sql.mjs holds to the SQL - so the
// once-only rule this leans on is the database's, not a stand-in written for this file.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import { loadEdgeFunction } from "./edge-harness.mjs";
import { makeCards } from "./mock-cards.mjs";
import { makeWallet } from "./mock-wallet.mjs";
import { PACK_BY_ID, packCards } from "../card-packs.mjs";
import { initCardData, CARDS, STARTER_MAX_RATING, lineupProblem } from "../card-logic.mjs";
import { SLOTS } from "../game-logic.mjs";
import { CARD_REFUSALS } from "../storage-cards.js";

initCardData(JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8")));
const { invoke } = await loadEdgeFunction("card-claim");

const ME = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const NAMELESS = "33333333-3333-4333-8333-333333333333"; // signed in with Google, no profile yet

function store({ on = true } = {}) {
  const profiles = new Map([
    [ME, { id: ME, username: "someone", guest: false }],
    [GUEST, { id: GUEST, username: "Guest_ab12c", guest: true }],
  ]);
  const state = { profiles, currentUserId: () => null };
  const wallet = makeWallet(state);
  const cards = makeCards(state, { wallet });
  globalThis.__edge_env__ = on ? { CARDS_ENABLED: "1" } : {};
  const s = {
    users: { has: (id) => id === ME || id === GUEST || id === NAMELESS },
    readFails: {}, writeFails: {}, rpcFails: {}, throwOn: {}, beforeWrite: null, rpcCalls: [],
    profiles, cards, wallet,
    rowsOf: (table) => (table === "profiles" ? [...profiles.values()] : []),
    insert: (_table, row) => ({ row }),
    remove() {},
    rpcs: {
      grant_cards: (args) => cards.grantCards(args.p_user, args.p_kind, args.p_grants),
      // A raise comes back as an error object, the way PostgREST reports one.
      buy_pack: (args) => {
        try { return cards.buyPack(args.p_user, args.p_pack, args.p_open, args.p_cards, args.p_price); }
        catch (e) { return { __rpcError: { message: e.message, code: "P0001" } }; }
      },
    },
  };
  globalThis.__edge_store__ = s;
  return s;
}
const claim = (userId, body = { action: "starter" }) => invoke(body, { userId });
const granted = (s) => s.rpcCalls.filter((c) => (c.name || c[0]) === "grant_cards").length;

await runTest("who is asking, and what for", async () => {
  const s = store();
  const anon = await claim(null);
  assert(anon.status === 401 && anon.body.reason === "signed_out", "nobody signed in: " + JSON.stringify(anon));
  const odd = await claim(ME, { action: "everything" });
  assert(odd.status === 400 && odd.body.reason === "malformed", "an action that does not exist: " + JSON.stringify(odd));
  const none = await claim(ME, {});
  assert(none.status === 400 && none.body.reason === "malformed", "no action at all");
  assert(s.cards.owned(ME).length === 0, "and nothing was granted along the way");
});

await runTest("with the server's switch off it grants nothing and says why", async () => {
  const s = store({ on: false });
  const res = await claim(ME);
  assert(res.status === 403 && res.body.reason === "cards_off", "cards_off: " + JSON.stringify(res));
  assert(s.cards.owned(ME).length === 0 && s.cards.grants(ME).length === 0, "not a card, not a ledger row");
  // INERT means it does not reach the database at all - which is what makes deploying this to production ahead
  // of the feature safe. So a guest and an account with no profile are told cards_off too, not their own
  // reason: answering those would mean the profile had been read. And no rpc was made.
  assert((await claim(GUEST)).body.reason === "cards_off", "a guest is told cards_off, so the profile was never read");
  assert((await claim(NAMELESS)).body.reason === "cards_off", "so is an account with no profile");
  s.readFails.profiles = true;
  assert((await claim(ME)).body.reason === "cards_off", "and a database that cannot be read is never even asked");
  assert(granted(s) === 0 && s.rpcCalls.length === 0, "not one rpc was made");
});

await runTest("a starter deck: eight Base cards that make a lineup, once", async () => {
  const s = store();
  const res = await claim(ME);
  assert(res.status === 200 && res.body.ok === true, "claimed: " + JSON.stringify(res).slice(0, 200));
  const deck = res.body.cards;
  assert(deck.length === 8 && deck.every((c) => c.finish === "base"), "eight Base cards");
  const cards = deck.map((c) => CARDS.get(c.id));
  assert(cards.every((c) => c && c.rating < STARTER_MAX_RATING), "all real cards from the lower-rated pool");
  assert(new Set(cards.map((c) => c.pid)).size === 8, "eight different players");
  const lineup = {}; const men = new Set();
  for (const slot of SLOTS) {
    const c = [...cards].sort((a, b) => b.rating - a.rating).find((x) => !men.has(x.pid) && (slot.startsWith("FLEX") ? x.pos !== "QB" : x.pos === slot));
    lineup[slot] = { id: c.id, finish: "base" }; men.add(c.pid);
  }
  const owned = new Map(s.cards.owned(ME).map((o) => [`${o.card_id}:${o.finish}`, o.count]));
  assert(lineupProblem(lineup, owned) === null, "and the account can field a legal lineup from what it now owns");
  assert(s.cards.grants(ME).map((g) => g.ref).sort().join() === "starter:0,starter:1,starter:2,starter:3,starter:4,starter:5,starter:6,starter:7", "under the eight starter refs");

  const again = await claim(ME);
  assert(again.status === 409 && again.body.reason === "duplicate", "a second claim is a duplicate: " + JSON.stringify(again));
  assert(s.cards.owned(ME).reduce((n, o) => n + o.count, 0) === 8, "and the account still owns exactly eight");
});

await runTest("two different claims deal two different decks", async () => {
  const a = (await (store(), claim(ME))).body.cards.map((c) => c.id).sort().join();
  const b = (await (store(), claim(ME))).body.cards.map((c) => c.id).sort().join();
  assert(a !== b, "the choice is random, not a fixed deck everybody gets");
});

await runTest("who may not collect, and what a failure is called", async () => {
  let s = store();
  const guest = await claim(GUEST);
  assert(guest.status === 403 && guest.body.reason === "guest_not_allowed", "a guest: " + JSON.stringify(guest));
  const nameless = await claim(NAMELESS);
  assert(nameless.status === 400 && nameless.body.reason === "no_profile", "an account with no profile: " + JSON.stringify(nameless));
  assert(s.cards.owned(GUEST).length === 0, "the guest owns nothing");

  s = store(); s.rpcFails.grant_cards = true;
  const failed = await claim(ME);
  assert(failed.status === 500 && failed.body.reason === "server", "the grant failing is a server error: " + JSON.stringify(failed));
  s = store(); s.readFails.profiles = true;
  const unread = await claim(ME);
  assert(unread.status === 500 && unread.body.reason === "server", "the profile read failing is a server error, never 'no profile'");
  assert(s.cards.owned(ME).length === 0, "and nothing was granted on a read that failed");
});

const open = (userId, pack = "pack-standard", id = "open-0001", price = 5000) => invoke({ action: "open_pack", pack, open: id, price }, { userId });
const bought = (s) => s.rpcCalls.filter((c) => c.name === "buy_pack");

await runTest("opening a pack: three cards from that pack, paid for once", async () => {
  const s = store();
  s.wallet.apply(ME, 1000, "season", "seed");
  const res = await open(ME);
  assert(res.status === 200 && res.body.ok === true && res.body.duplicate === false, "opened: " + JSON.stringify(res).slice(0, 200));
  assert(res.body.cards.length === 3 && new Set(res.body.cards.map((c) => c.id)).size === 3, "three different cards");
  assert(res.body.cards.every((c) => CARDS.has(c.id) && ["base", "silver", "gold", "prism"].includes(c.finish)), "all real cards with a real finish");
  assert(res.body.balance === 850 && s.wallet.balanceOf(ME) === 850, "150 coins, by the row's price: " + res.body.balance);
  assert(res.body.stockLeft === null, "Standard is not limited");
  assert(s.cards.owned(ME).reduce((n, o) => n + o.count, 0) === 3, "and the account owns them");
  assert(JSON.stringify(Object.keys(bought(s)[0].args).sort()) === JSON.stringify(["p_cards", "p_open", "p_pack", "p_price", "p_user"]) && bought(s)[0].args.p_user === ME, "the buyer is the session's user, never the body's");

  // The same open id again: nothing more is charged, and the answer is the FIRST pack's cards.
  const again = await open(ME);
  assert(again.status === 200 && again.body.duplicate === true, "a repeat is answered, not refused: " + JSON.stringify(again).slice(0, 160));
  assert(JSON.stringify(again.body.cards) === JSON.stringify(res.body.cards), "with the same three cards");
  assert(s.wallet.balanceOf(ME) === 850 && s.cards.owned(ME).reduce((n, o) => n + o.count, 0) === 3, "and nothing moved");

  // A themed pack deals only its own cards; the limited one reports its stock.
  const air = await open(ME, "pack-air-raid", "open-0002");
  const pool = new Set(packCards(PACK_BY_ID["pack-air-raid"]).map((c) => c.id));
  assert(air.status === 200 && air.body.cards.every((c) => pool.has(c.id)), "Air raid deals Air raid cards");
  s.wallet.apply(ME, 5000, "season", "seed2");
  const leg = await open(ME, "pack-legends", "open-0003");
  assert(leg.status === 200 && leg.body.cards.length === 1 && leg.body.stockLeft === 4999, "Legends: one card, and one fewer left: " + JSON.stringify(leg.body).slice(0, 160));
  assert(["gold", "prism"].includes(leg.body.cards[0].finish) && CARDS.get(leg.body.cards[0].id).rating >= 100, "a Gold or Prism rated 100+");
});

await runTest("what opening a pack is refused for, with nothing taken", async () => {
  let s = store();
  s.wallet.apply(ME, 100, "season", "seed");
  const poor = await open(ME);
  assert(poor.status === 409 && poor.body.reason === "not_enough", "not enough coins: " + JSON.stringify(poor));
  assert(s.wallet.balanceOf(ME) === 100 && s.cards.owned(ME).length === 0, "nothing taken, nothing given");
  s.wallet.apply(ME, 9000, "season", "seed2");

  for (const [body, why] of [[{ action: "open_pack", pack: "pack-standard", price: 150 }, "no open id"], [{ action: "open_pack", open: "open-0001", price: 150 }, "no pack"], [{ action: "open_pack", pack: 7, open: "open-0001", price: 150 }, "a pack that is not text"], [{ action: "open_pack", pack: "pack-standard", open: "open-0001" }, "no price"], [{ action: "open_pack", pack: "pack-standard", open: "open-0001", price: "150" }, "a price that is not a number"], [{ action: "open_pack", pack: "pack-standard", open: "open-0001", price: 0 }, "a price of nothing"]]) {
    const r = await invoke(body, { userId: ME });
    assert(r.status === 400 && r.body.reason === "malformed", why + ": " + JSON.stringify(r));
  }
  for (const id of ["pack-nope", "constructor", "__proto__", "toString"]) {
    const r = await open(ME, id);
    assert(r.status === 400 && r.body.reason === "unknown_pack", `"${id}" is not a pack: ` + JSON.stringify(r));
  }
  for (const id of ["short", "x".repeat(37), "open 0001", "open%0001", "open_0001"]) {
    const r = await open(ME, "pack-standard", id);
    assert(r.status === 400 && r.body.reason === "bad_open", `"${id}" is not an open id: ` + JSON.stringify(r));
  }
  assert(bought(s).length === 1, "none of those reached the database (only the not-enough one did): " + bought(s).length);

  // The screen showed 150 and the row now says 200: refused, not charged 200.
  s.cards.packs.get("pack-standard").price = 200;
  const dearer = await open(ME, "pack-standard", "open-0005", 150);
  assert(dearer.status === 409 && dearer.body.reason === "price_changed", "a price that went up: " + JSON.stringify(dearer));
  assert(s.wallet.balanceOf(ME) === 9100 && s.cards.owned(ME).length === 0, "and nothing was charged");
  s.cards.packs.get("pack-standard").price = 150;

  s.cards.packs.get("pack-standard").active = false;
  const off = await open(ME);
  assert(off.status === 409 && off.body.reason === "unavailable", "off sale: " + JSON.stringify(off));
  s.cards.packs.get("pack-legends").stock_left = 0;
  const gone = await open(ME, "pack-legends", "open-0009");
  assert(gone.status === 409 && gone.body.reason === "sold_out", "sold out: " + JSON.stringify(gone));
  assert(s.wallet.balanceOf(ME) === 9100 && s.cards.owned(ME).length === 0, "and still nothing has moved");

  const guest = await open(GUEST);
  assert(guest.status === 403 && guest.body.reason === "guest_not_allowed", "a guest: " + JSON.stringify(guest));
  assert((await open(NAMELESS)).body.reason === "no_profile", "an account with no profile");
  assert((await open(null)).status === 401, "nobody signed in");

  s = store(); s.wallet.apply(ME, 1000, "season", "seed"); s.rpcFails.buy_pack = true;
  const failed = await open(ME);
  assert(failed.status === 500 && failed.body.reason === "server", "the database failing is a server error: " + JSON.stringify(failed));

  // WHAT IS NOT A REFUSAL. A failure that merely contains a refusal's word, or carries its word without the
  // database's own code, is not buy_pack speaking - and calling it one would tell the screen the purchase
  // certainly did not happen.
  for (const [error, why] of [[{ message: "upstream service unavailable", code: "XX000" }, "a gateway that says unavailable"], [{ message: "sold_out" }, "the word with no code"], [{ message: "new row violates not_enough", code: "23514" }, "another error naming one"], [{ message: "sold_out and more", code: "P0001" }, "the code with more than the word"]]) {
    s = store(); s.wallet.apply(ME, 1000, "season", "seed");
    s.rpcs.buy_pack = () => ({ __rpcError: error });
    const r = await open(ME);
    assert(r.status === 500 && r.body.reason === "server", why + " is a server error, not a refusal: " + JSON.stringify(r));
  }
  s = store(); s.wallet.apply(ME, 1000, "season", "seed");
  const huge = await open(ME, "pack-standard", "open-0001", 1e12);
  assert(huge.status === 400 && huge.body.reason === "malformed" && bought(s).length === 0, "a price no pack could have is not sent to the database");
  // The buyer is the session's user whatever the body claims.
  const lying = await invoke({ action: "open_pack", pack: "pack-standard", open: "open-0002", price: 150, user: GUEST, p_user: GUEST, userId: GUEST }, { userId: ME });
  assert(lying.status === 200 && bought(s)[0].args.p_user === ME && s.cards.owned(GUEST).length === 0 && s.cards.owned(ME).length === 3, "a body naming somebody else buys for the caller");

  s = store({ on: false });
  const dark = await open(ME);
  assert(dark.status === 403 && dark.body.reason === "cards_off" && s.rpcCalls.length === 0, "with the switch off, nothing is sold and nothing is asked");
});

await runTest("every reason the function can give is one the client knows", async () => {
  const src = readFileSync(new URL("../supabase/functions/card-claim/index.ts", import.meta.url), "utf8");
  const reasons = [...new Set([...src.matchAll(/reason:\s*"([a-z_]+)"/g)].map((m) => m[1]))];
  assert(reasons.length >= 6, "the function names its reasons: " + reasons);
  for (const r of reasons) assert(CARD_REFUSALS.includes(r), `storage-cards.js does not know the reason "${r}"`);
  // The pack refusals travel as KEYS of a table rather than as reason: "..." literals, so they are read separately.
  const table = src.match(/const PACK_REFUSALS[^=]*=\s*\{([^}]+)\}/);
  assert(table, "the function's table of pack refusals was found");
  const packReasons = [...table[1].matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]);
  assert(packReasons.length === 7, "seven of them: " + packReasons);
  for (const r of packReasons) assert(CARD_REFUSALS.includes(r), `storage-cards.js does not know the pack reason "${r}"`);
});

console.log("test-cards-edge.mjs done");
