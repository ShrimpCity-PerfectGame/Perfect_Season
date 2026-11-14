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
import { initCardData, initDefenses, CARDS, STARTER_MAX_RATING, lineupProblem, defenseByKey, runDefense, battleTarget, showdownScore, showdownDefense, LUCK_SPREAD } from "../card-logic.mjs";
import { COIN_RULES, cardWinCoins, cardSellCoins } from "../rewards.mjs";
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
    rowsOf: (table) => (table === "profiles" ? [...profiles.values()] : table === "card_runs" ? cards.runs : []),
    insert: (_table, row) => ({ row }),
    remove() {},
    rpcs: {
      grant_cards: (args) => cards.grantCards(args.p_user, args.p_kind, args.p_grants),
      // A raise comes back as an error object, the way PostgREST reports one.
      // The battle functions, the same way: a raise is an error object carrying the reason.
      ...Object.fromEntries(Object.entries({
        card_run_start: (a) => cards.runStart(a.p_user, a.p_seed, a.p_defense),
        card_run_battle: (a) => cards.runBattle(a.p_user, a.p_run, a.p_step, a.p_lineup, a.p_win, a.p_next, a.p_last, a.p_coins, a.p_cap),
        card_run_end: (a) => cards.runEnd(a.p_user),
        card_copies: (a) => cards.copies(a.p_user),
        card_sell_copies: (a) => cards.sellCopies(a.p_user, a.p_sales, a.p_ref),
        card_showdown_record: (a) => cards.showdownRecord(a.p_user, a.p_date, a.p_defense, a.p_lineup, a.p_score, a.p_shown),
      }).map(([name, fn]) => [name, (args) => { try { return fn(args); } catch (e) { return { __rpcError: { message: e.message, code: "P0001" } }; } }])),
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
  // The battle refusals are a table of their own, and a lineup's reasons come out of card-logic.mjs.
  const battleTable = src.match(/const BATTLE_REFUSALS[^=]*=\s*\{([^}]+)\}/);
  assert(battleTable, "the function's table of battle refusals was found");
  const battleReasons = [...battleTable[1].matchAll(/([a-z_]+)\s*:/g)].map((m) => m[1]);
  assert(battleReasons.length === 5, "five of them: " + battleReasons);
  for (const r of battleReasons) assert(CARD_REFUSALS.includes(r), `storage-cards.js does not know the battle reason "${r}"`);
  const logic = readFileSync(new URL("../card-logic.mjs", import.meta.url), "utf8");
  const body = logic.slice(logic.indexOf("export function lineupProblem"), logic.indexOf("// ---------- Battles"));
  const lineupReasons = [...new Set([...body.matchAll(/return "([a-z_]+)"/g)].map((m) => m[1]))];
  assert(lineupReasons.length === 7, "lineupProblem's seven reasons: " + lineupReasons);
  for (const r of lineupReasons) assert(CARD_REFUSALS.includes(r), `storage-cards.js does not know the lineup reason "${r}"`);
});

// ---------- battles (v2.25.0) ----------
// The function holds the rules and draws the luck; the store's functions are tests/mock-cards.mjs's, which
// tests/test-cards-sql.mjs holds to the SQL. So what is tested here is the function's own part: who is asking,
// which lineup it will score, that the roll is its own and never the browser's, and what it calls each refusal.
initDefenses(JSON.parse(readFileSync(new URL("../data/versus-pool.json", import.meta.url), "utf8")), JSON.parse(readFileSync(new URL("../data/card-defense.json", import.meta.url), "utf8")));
// Six owned cards that make a lineup: the best the account holds at each slot.
function lineupFrom(s, userId) {
  const cards = s.cards.owned(userId).map((o) => ({ ...CARDS.get(o.card_id), finish: o.finish })).sort((a, b) => b.rating - a.rating || a.id - b.id);
  const lineup = {}; const men = new Set();
  for (const slot of SLOTS) {
    const c = cards.find((x) => !men.has(x.pid) && (slot.startsWith("FLEX") ? x.pos !== "QB" : x.pos === slot));
    lineup[slot] = { id: c.id, finish: c.finish }; men.add(c.pid);
  }
  return lineup;
}
// An account holding the 60 best cards in the game, so a first battle is a win whatever the luck does.
function stacked(s, userId) {
  const best = [...CARDS.values()].sort((a, b) => b.rating - a.rating || a.id - b.id);
  const men = new Set(); const grants = [];
  for (const c of best) { if (men.has(c.pid)) continue; men.add(c.pid); grants.push({ ref: `g:${c.id}`, card: c.id, finish: "base" }); if (grants.length === 60) break; }
  for (let i = 0; i < grants.length; i += 20) s.cards.grantCards(userId, "gift", grants.slice(i, i + 20));
}
const battleCalls = (s, name) => s.rpcCalls.filter((c) => c.name === name);

await runTest("a run: started once, fought on the server's roll, paid from rewards.mjs", async () => {
  const s = store();
  stacked(s, ME);
  const started = await invoke({ action: "run_start" }, { userId: ME });
  assert(started.status === 200 && started.body.run.wins === 0 && defenseByKey(started.body.run.defense), "a run with a real defense: " + JSON.stringify(started.body));
  assert(!JSON.stringify(started.body).includes("seed"), "and the seed is not in the answer");
  const seed = s.cards.runs[0].seed;
  assert(/^[0-9a-f]{32}$/.test(seed) && runDefense(seed, 0).key === started.body.run.defense, "the first defense follows from a seed the function made");
  const twice = await invoke({ action: "run_start" }, { userId: ME });
  assert(twice.body.run.id === started.body.run.id && s.cards.runs.length === 1, "starting again is the same run");

  const lineup = lineupFrom(s, ME);
  const run = started.body.run;
  // A body that brings its own result, roll, coins or user is ignored: none of those is the browser's to say.
  const res = await invoke({ action: "run_battle", run: run.id, step: 0, lineup, win: false, offense: 1, roll: 0, coins: 9999, user: GUEST, p_user: GUEST }, { userId: ME });
  assert(res.status === 200 && res.body.ok === true, "fought: " + JSON.stringify(res.body).slice(0, 200));
  const b = res.body.battle;
  assert(b.win === true && b.cards.length === 6 && b.defense === run.defense && b.target === battleTarget(defenseByKey(run.defense), 0), "sixty of the best cards win a first battle, against the stated bar");
  assert(Math.abs(b.cards.reduce((n, c) => n + c.total, 0) - b.offense) < 0.11, "the six totals are the offense");
  const call = battleCalls(s, "card_run_battle")[0].args;
  assert(call.p_user === ME && call.p_coins === cardWinCoins(1) && call.p_cap === COIN_RULES.paidCardWinsPerDay && call.p_win === true, "the caller, the first win's pay and the day's cap are the function's own: " + JSON.stringify({ ...call, p_last: 0, p_lineup: 0 }));
  assert(res.body.run.wins === 1 && res.body.run.status === "live" && res.body.run.defense === runDefense(seed, 1).key, "the next defense follows from the same seed");
  assert(res.body.coins.credited === cardWinCoins(1) && res.body.coins.balance === s.wallet.balanceOf(ME), "and the win was paid: " + JSON.stringify(res.body.coins));
  assert(s.cards.runs[0].last.offense === b.offense, "the battle is kept on the run, for a browser that never got this answer");

  // The same request again: the run has moved, so it is stale and nothing is played.
  const again = await invoke({ action: "run_battle", run: run.id, step: 0, lineup }, { userId: ME });
  assert(again.status === 409 && again.body.reason === "stale" && s.cards.runs[0].wins === 1 && battleCalls(s, "card_run_battle").length === 1, "a repeat of a played step is stale: " + JSON.stringify(again.body));
  const wrongRun = await invoke({ action: "run_battle", run: run.id + 7, step: 1, lineup }, { userId: ME });
  assert(wrongRun.status === 409 && wrongRun.body.reason === "stale", "so is a run id that is not the live one");
});

await runTest("the luck is the function's, drawn fresh each battle", async () => {
  const offenses = new Set();
  for (let i = 0; i < 4; i++) {
    const s = store(); stacked(s, ME);
    const run = (await invoke({ action: "run_start" }, { userId: ME })).body.run;
    // Same six cards every time; the defense differs by run, so compare the rolls themselves.
    const res = await invoke({ action: "run_battle", run: run.id, step: 0, lineup: lineupFrom(s, ME) }, { userId: ME });
    offenses.add(res.body.battle.cards.map((c) => c.roll).join());
    assert(res.body.battle.cards.every((c) => Math.abs(c.roll) <= LUCK_SPREAD), "no roll beyond the spread");
  }
  assert(offenses.size === 4, "four battles, four different sets of rolls");
});

await runTest("a loss ends the run, and walking away ends it too", async () => {
  const s = store();
  await claim(ME); // a starter deck: eight cards under 60
  const lineup = lineupFrom(s, ME);
  let run = (await invoke({ action: "run_start" }, { userId: ME })).body.run;
  let lost = null;
  for (let step = 0; step < 30 && !lost; step++) {
    const res = await invoke({ action: "run_battle", run: run.id, step, lineup }, { userId: ME });
    assert(res.status === 200, "each battle is answered: " + JSON.stringify(res.body).slice(0, 160));
    if (!res.body.battle.win) lost = res.body; else assert(res.body.run.wins === step + 1, "a win moves the step on");
  }
  assert(lost && lost.run.status === "over" && lost.coins.credited === 0, "a starter deck loses before thirty battles, and a loss pays nothing");
  const after = await invoke({ action: "run_battle", run: run.id, step: lost.run.wins, lineup }, { userId: ME });
  assert(after.status === 409 && after.body.reason === "no_run", "there is no run to play on: " + JSON.stringify(after.body));
  run = (await invoke({ action: "run_start" }, { userId: ME })).body.run;
  assert(run.wins === 0 && run.id !== lost.run.id, "the next run is a new one from zero");
  const end = await invoke({ action: "run_end" }, { userId: ME });
  assert(end.status === 200 && end.body.ended === true && s.cards.runs.every((r) => r.status === "over"), "walking away ends it");
  const none = await invoke({ action: "run_end" }, { userId: ME });
  assert(none.status === 200 && none.body.ended === false, "and walking away from nothing is not an error");
});

await runTest("the lineups it will not play, and what each is called", async () => {
  const s = store();
  await claim(ME);
  stacked(s, GUEST === ME ? ME : ME);
  const good = lineupFrom(s, ME);
  const run = (await invoke({ action: "run_start" }, { userId: ME })).body.run;
  const fightWith = (lineup, extra = {}) => invoke({ action: "run_battle", run: run.id, step: 0, lineup, ...extra }, { userId: ME });
  const stranger = [...CARDS.values()].find((c) => c.pos === "QB" && !s.cards.owned(ME).some((o) => o.card_id === c.id));
  const qb = CARDS.get(good.QB.id);
  const sameMan = [...CARDS.values()].find((c) => c.pid === CARDS.get(good.FLEX1.id).pid && c.id !== good.FLEX1.id);
  for (const [reason, status, lineup] of [
    ["malformed", 400, null],
    ["malformed", 400, "six of my best"],
    ["malformed", 400, { ...good, K: good.QB }],
    ["incomplete", 400, { ...good, TE: undefined }],
    ["unknown_card", 400, { ...good, QB: { id: 99999999, finish: "base" } }],
    ["bad_finish", 400, { ...good, QB: { id: good.QB.id, finish: "diamond" } }],
    ["bad_slot", 400, { ...good, FLEX1: { id: qb.id, finish: good.QB.finish } }],
    ...(sameMan ? [["same_player", 400, { ...good, FLEX2: { id: sameMan.id, finish: "base" } }]] : []),
    ["not_owned", 409, { ...good, QB: { id: stranger.id, finish: "base" } }],
    ["not_owned", 409, { ...good, QB: { id: good.QB.id, finish: "prism" } }],
  ]) {
    const res = await fightWith(lineup);
    assert(res.status === status && res.body.reason === reason, `${reason}: ${JSON.stringify(res.body)} (${res.status})`);
  }
  assert(s.cards.runs[0].wins === 0 && s.cards.runs[0].status === "live" && s.cards.runs[0].last === null, "and not one of them touched the run");
  for (const body of [{ action: "run_battle", lineup: good }, { action: "run_battle", run: "1", step: 0, lineup: good }, { action: "run_battle", run: run.id, step: -1, lineup: good }]) {
    const res = await invoke(body, { userId: ME });
    assert(res.status === 400 && res.body.reason === "malformed", "a battle with no run or step: " + JSON.stringify(res.body));
  }
  const noRun = await invoke({ action: "run_battle", run: 1, step: 0, lineup: good }, { userId: GUEST });
  assert(noRun.status === 403 && noRun.body.reason === "guest_not_allowed", "a guest is refused before any of it");
  s.rpcFails.card_run_battle = true;
  const broke = await fightWith(good);
  assert(broke.status === 500 && broke.body.reason === "server", "a database that fails is a server error, not a refusal");
  s.rpcFails.card_run_battle = false; s.readFails.card_runs = true;
  assert((await fightWith(good)).body.reason === "server", "and so is a run that cannot be read - never 'no run'");
});

await runTest("the showdown: the day's defense, one score, once", async () => {
  const s = store();
  stacked(s, ME);
  const lineup = lineupFrom(s, ME);
  const today = new Date().toISOString().slice(0, 10);
  const res = await invoke({ action: "showdown", lineup, date: "1999-01-01", score: 9999 }, { userId: ME });
  assert(res.status === 200 && res.body.date === today, "played for the function's own day, whatever the body says: " + JSON.stringify(res.body).slice(0, 160));
  const want = showdownScore(today, lineup);
  assert(res.body.showdown.score === Math.round(want.score * 10) / 10 && res.body.showdown.defense === showdownDefense(today).key, "the score is the seeded one for that day and that lineup");
  assert(res.body.showdown.lineup.cards.length === 6, "with the six games to show");
  const again = await invoke({ action: "showdown", lineup }, { userId: ME });
  assert(again.status === 409 && again.body.reason === "duplicate" && s.cards.showdowns.length === 1, "a second go is refused: " + JSON.stringify(again.body));
  const stranger = [...CARDS.values()].find((c) => c.pos === "QB" && !s.cards.owned(ME).some((o) => o.card_id === c.id));
  const s2 = store(); stacked(s2, ME);
  const cheat = await invoke({ action: "showdown", lineup: { ...lineupFrom(s2, ME), QB: { id: stranger.id, finish: "prism" } } }, { userId: ME });
  assert(cheat.status === 409 && cheat.body.reason === "not_owned" && s2.cards.showdowns.length === 0, "a card that is not theirs scores nothing");
  assert(s2.wallet.balanceOf(ME) === 0 && s.wallet.balanceOf(ME) === 0, "and a showdown pays no coins");
});

await runTest("with the switch off, no battle touches the database", async () => {
  const s = store({ on: false });
  for (const body of [{ action: "run_start" }, { action: "run_end" }, { action: "showdown", lineup: {} }, { action: "run_battle", run: 1, step: 0, lineup: {} }]) {
    const res = await invoke(body, { userId: ME });
    assert(res.status === 403 && res.body.reason === "cards_off", body.action + " is cards_off: " + JSON.stringify(res.body));
  }
  assert(s.rpcCalls.length === 0 && s.cards.runs.length === 0, "not one call was made");
});

// ---------- copies (v2.26.0) ----------
await runTest("a copy from a pack is sold at the catalog's price, which the function - not the browser - sets", async () => {
  const s = store();
  s.wallet.apply(ME, 1000, "season", "seed");
  const pack = PACK_BY_ID["pack-standard"];
  const inPack = packCards(pack).map((c) => c.id ?? c);
  // Hold a Base copy of every card the pack can give, so most of what is rolled (70% of pulls are Base) is a copy.
  for (let i = 0; i < inPack.length; i += 20) s.cards.grantCards(ME, "gift", inPack.slice(i, i + 20).map((id) => ({ ref: `h:${id}`, card: id, finish: "base" })));
  const res = await invoke({ action: "open_pack", pack: "pack-standard", open: "open-copies-1", price: 150, sell: 99999, cards: [{ id: 1, finish: "prism", sell: 99999 }] }, { userId: ME });
  assert(res.status === 200 && res.body.cards.length === 3, "opened: " + JSON.stringify(res.body).slice(0, 200));
  const call = s.rpcCalls.find((c) => c.name === "buy_pack").args;
  for (const c of call.p_cards) assert(c.sell === cardSellCoins(CARDS.get(c.card).rating, c.finish), `every card carries rewards.mjs's price for a copy of it: ${JSON.stringify(c)}`);
  let back = 0;
  for (const c of res.body.cards) {
    if (c.sold != null) { assert(c.sold === cardSellCoins(CARDS.get(c.id).rating, c.finish), "a sold copy went for that price"); back += c.sold; }
    else assert(c.finish !== "base", "a kept card is one that was not held - here, anything but a Base");
  }
  assert(res.body.balance === 1000 - 150 + back && s.wallet.balanceOf(ME) === res.body.balance, "and the balance is the price out and the copies in: " + res.body.balance);
  assert(s.cards.owned(ME).every((o) => o.count === 1), "nothing stacked");
});

await runTest("the stacks from before are sold on request, priced from the catalog, once", async () => {
  const s = store();
  const card = [...CARDS.values()].find((c) => c.rating >= 80 && c.rating < 100);
  s.cards.grantCards(ME, "gift", [1, 2, 3].map((n) => ({ ref: `old:${n}`, card: card.id, finish: "silver" })));
  s.cards.grantCards(ME, "gift", [{ ref: "odd:1", card: 99999999, finish: "base" }, { ref: "odd:2", card: 99999999, finish: "base" }]); // a card no catalog knows
  const each = cardSellCoins(card.rating, "silver");
  const res = await invoke({ action: "sell_copies", coins: 99999, sales: [{ card: card.id, finish: "silver", each: 20000 }] }, { userId: ME });
  assert(res.status === 200 && res.body.copies === 2 && res.body.coins === 2 * each && each === 100, "two copies at the catalog's price, whatever the body claims: " + JSON.stringify(res.body));
  assert(s.wallet.balanceOf(ME) === res.body.balance && s.cards.owned(ME).find((o) => o.card_id === card.id).count === 1, "the wallet has them and one card is kept");
  assert(s.cards.owned(ME).find((o) => o.card_id === 99999999).count === 2, "a card that cannot be priced is left alone rather than sold for nothing");
  const again = await invoke({ action: "sell_copies" }, { userId: ME });
  assert(again.status === 200 && again.body.copies === 0 && again.body.coins === 0, "and asking again sells nothing");
  assert((await invoke({ action: "sell_copies" }, { userId: GUEST })).body.reason === "guest_not_allowed", "a guest is refused before any of it");
  s.rpcFails.card_copies = true;
  assert((await invoke({ action: "sell_copies" }, { userId: ME })).body.reason === "server", "a database that fails is a server error");
  const off = store({ on: false });
  assert((await invoke({ action: "sell_copies" }, { userId: ME })).body.reason === "cards_off" && off.rpcCalls.length === 0, "and with the switch off nothing is asked");
});

console.log("test-cards-edge.mjs done");
