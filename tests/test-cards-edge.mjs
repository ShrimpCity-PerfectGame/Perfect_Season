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
import { initCardData, CARDS, CATEGORY_IDS, STARTER_MAX_RATING, deckProblem, bestDeck, autoPick, spotFits, ladderFoe, dailyFoe, dailyBattle, dailyCategories, LUCK_SPREAD, LUCK_WIDE } from "../card-logic.mjs";
import { COIN_RULES, cardWinCoins, cardSellCoins } from "../rewards.mjs";
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
    rowsOf: (table) => (table === "profiles" ? [...profiles.values()] : table === "card_runs" ? cards.runs : table === "card_dailies" ? cards.dailies : []),
    insert: (_table, row) => ({ row }),
    remove() {},
    rpcs: {
      grant_cards: (args) => cards.grantCards(args.p_user, args.p_kind, args.p_grants),
      // A raise comes back as an error object, the way PostgREST reports one.
      // The battle functions, the same way: a raise is an error object carrying the reason.
      ...Object.fromEntries(Object.entries({
        card_run_start: (a) => cards.runStart(a.p_user, a.p_seed, a.p_hand, a.p_foe, a.p_cats),
        card_run_round: (a) => cards.runRound(a.p_user, a.p_run, a.p_step, a.p_round, a.p_card, a.p_rounds),
        card_daily_round: (a) => cards.dailyRound(a.p_user, a.p_date, a.p_round, a.p_card, a.p_rounds),
        card_deck_read: (a) => cards.deckRead(a.p_user),
        card_deck_save: (a) => cards.deckSave(a.p_user, a.p_cards),
        card_daily_deal: (a) => cards.dailyDeal(a.p_user, a.p_date, a.p_hand),
        card_daily_record: (a) => cards.dailyRecord(a.p_user, a.p_date, a.p_lineup, a.p_rounds, a.p_score, a.p_shown),
        card_run_battle: (a) => cards.runBattle(a.p_user, a.p_run, a.p_step, a.p_lineup, a.p_win, a.p_hand, a.p_foe, a.p_cats, a.p_last, a.p_coins, a.p_cap),
        card_run_end: (a) => cards.runEnd(a.p_user),
        card_copies: (a) => cards.copies(a.p_user),
        card_sell_copies: (a) => cards.sellCopies(a.p_user, a.p_sales, a.p_ref),
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
  assert(battleReasons.length === 7, "seven of them: " + battleReasons);
  for (const r of battleReasons) assert(CARD_REFUSALS.includes(r), `storage-cards.js does not know the battle reason "${r}"`);
  const logic = readFileSync(new URL("../card-logic.mjs", import.meta.url), "utf8");
  const body = logic.slice(logic.indexOf("export function deckProblem"), logic.indexOf("// ---------- Synergies")) + logic.slice(logic.indexOf("export function roundProblem"), logic.indexOf("// The cards in a hand that may be played next"));
  const lineupReasons = [...new Set([...body.matchAll(/return "([a-z_]+)"/g)].map((m) => m[1]))];
  assert(lineupReasons.length === 10, "the ten reasons deckProblem, teamProblem and roundProblem give between them: " + lineupReasons);
  for (const r of lineupReasons) assert(CARD_REFUSALS.includes(r), `storage-cards.js does not know the lineup reason "${r}"`);
});

// ---------- battles (v2.27.0: offense against offense) ----------
// The function holds the rules, deals the hands and draws the luck; the store's functions are
// tests/mock-cards.mjs's, which tests/test-cards-sql.mjs holds to the SQL. So what is tested here is the
// function's own part: who is asking, which six it will score, that the hand, the roll and the result are its
// own and never the browser's, and what it calls each refusal.
const handOf = (s, userId) => fromRows(s.cards.runs.find((r) => r.user_id === userId && r.status === "live").hand);
const fromRows = (list) => list.map((e) => ({ id: e.card, finish: e.finish }));
// The sixty best cards in the game, thirty of them a deck's worth - so a first battle is a win whatever the luck.
function stacked(s, userId) {
  const need = { QB: 10, RB: 20, WR: 20, TE: 10 }, men = new Set(), grants = [];
  for (const c of [...CARDS.values()].sort((a, b) => b.rating - a.rating || a.id - b.id)) {
    if (men.has(c.pid) || need[c.pos] <= 0) continue;
    need[c.pos]--; men.add(c.pid); grants.push({ ref: `g:${c.id}`, card: c.id, finish: "base" });
  }
  for (let i = 0; i < grants.length; i += 20) s.cards.grantCards(userId, "gift", grants.slice(i, i + 20));
}
const battleCalls = (s, name) => s.rpcCalls.filter((c) => c.name === name);
const post = (body, userId = ME) => invoke(body, { userId });

await runTest("the starter cards fill a deck: thirty for a new account, the difference for an old one", async () => {
  let s = store();
  const res = await claim(ME);
  assert(res.status === 200 && res.body.cards.length === 30 && res.body.cards.every((c) => c.finish === "base"), "thirty Base cards: " + JSON.stringify(res.body).slice(0, 120));
  const deck = res.body.cards.map((c) => ({ id: c.id, finish: c.finish }));
  assert(deckProblem(deck, null) === null && deck.every((c) => CARDS.get(c.id).rating < STARTER_MAX_RATING), "which are a legal deck, from the lower-rated pool");
  assert(new Set(s.cards.grants(ME).map((g) => g.ref)).size === 30 && s.cards.grants(ME).every((g) => /^deck:(QB|RB|WR|TE):\d$/.test(g.ref)), "each under the deck spot it fills");
  const again = await claim(ME);
  assert(again.status === 409 && again.body.reason === "duplicate" && s.cards.owned(ME).length === 30, "a second claim is a duplicate and adds nothing");
  // An account that opened the OLD eight-card starter.
  s = store();
  const old = ["QB", "RB", "WR", "TE", "RB", "WR", "WR", "QB"].map((pos, i) => [...CARDS.values()].filter((c) => c.pos === pos && c.rating < 60)[i * 5]);
  s.cards.grantCards(ME, "starter", old.map((c, i) => ({ ref: `starter:${i}`, card: c.id, finish: "base" })));
  const top = await claim(ME);
  assert(top.status === 200 && top.body.cards.length === 22, "it is topped up by twenty-two: " + top.body.cards?.length);
  assert(bestDeck(s.cards.owned(ME).map((o) => ({ id: o.card_id, finish: o.finish }))) !== null, "and can now fill a deck");
  assert(top.body.cards.every((c) => !old.some((o) => o.pid === CARDS.get(c.id).pid)), "with nobody it already had");
});

await runTest("a deck is saved if it is one, and theirs", async () => {
  const s = store();
  stacked(s, ME);
  const best = bestDeck(s.cards.owned(ME).map((o) => ({ id: o.card_id, finish: o.finish })));
  const others = s.cards.owned(ME).map((o) => ({ id: o.card_id, finish: o.finish })).filter((e) => !best.some((b) => b.id === e.id));
  const alt = best.map((e) => { const swap = others.find((o) => CARDS.get(o.id).pos === CARDS.get(e.id).pos); if (swap) others.splice(others.indexOf(swap), 1); return swap || e; });
  const saved = await post({ action: "deck_save", cards: alt });
  assert(saved.status === 200 && saved.body.saved === true && s.cards.decks.get(ME).length === 30, "saved: " + JSON.stringify(saved.body));
  assert(s.cards.decks.get(ME).map((c) => c.card).join() === alt.map((e) => e.id).join(), "as sent");
  for (const [reason, status, cards] of [
    ["malformed", 400, "my deck"], ["bad_deck", 400, alt.slice(1)], ["bad_deck", 400, [...alt.slice(0, 29), alt.find((e) => CARDS.get(e.id).pos === "QB")]],
    ["unknown_card", 400, [{ id: 99999999, finish: "base" }, ...alt.slice(1)]], ["bad_finish", 400, [{ id: alt[0].id, finish: "shiny" }, ...alt.slice(1)]],
    ["not_owned", 409, [{ id: alt[0].id, finish: "prism" }, ...alt.slice(1)]],
  ]) {
    const res = await post({ action: "deck_save", cards });
    assert(res.status === status && res.body.reason === reason, `${reason}: ${JSON.stringify(res.body)} (${res.status})`);
  }
  assert(s.cards.decks.get(ME).map((c) => c.card).join() === alt.map((e) => e.id).join(), "and none of those touched the saved deck");
  assert((await post({ action: "deck_save", cards: alt }, GUEST)).body.reason === "guest_not_allowed", "a guest has no deck");
});

// Play a whole ladder battle through the function with "Pick for me" each round; returns every answer.
async function playOut(s, userId = ME, pick = (hand, foe, rounds) => autoPick(hand, foe, rounds)) {
  const run = s.cards.runs.find((r) => r.user_id === userId && r.status === "live");
  const hand = fromRows(run.hand), foe = run.foe.map((e) => ({ id: e.card, finish: e.finish, spot: e.spot }));
  const step = run.wins, id = run.id, answers = [];
  let rounds = run.rounds.slice(); // carries on from wherever the battle stands
  for (let n = rounds.length; n < 6; n++) {
    const res = await post({ action: "run_round", run: id, step, round: n, card: pick(hand, foe, rounds) }, userId);
    answers.push(res);
    if (res.status !== 200) break;
    rounds = [...rounds, res.body.round];
  }
  return { answers, last: answers.at(-1), hand, foe, id, step };
}

await runTest("the ladder: a hand dealt by the function, a battle played a round at a time, paid from rewards.mjs", async () => {
  const s = store();
  stacked(s, ME);
  const started = await post({ action: "run_start" });
  assert(started.status === 200 && started.body.run.wins === 0 && started.body.run.rounds.length === 0, "a run: " + JSON.stringify(started.body).slice(0, 160));
  assert(!JSON.stringify(started.body).includes("seed") && !JSON.stringify(started.body).includes("cats"), "the seed and the category order are not in the answer");
  const run = started.body.run, row = s.cards.runs[0];
  assert(/^[0-9a-f]{32}$/.test(row.seed) && JSON.stringify(run.foe) === JSON.stringify(ladderFoe(row.seed, 0)), "the first CPU team follows from a seed the function made");
  assert(run.foe[5].spot === "FLEX" && run.foe.map((e) => e.spot).sort().join() === "FLEX,FLEX,QB,RB,TE,WR", "their six carry the six spots, a Flex last");
  assert(row.cats.slice().sort().join() === [...CATEGORY_IDS].sort().join(), "the order of the six categories is drawn and kept with the run");
  const owned = s.cards.owned(ME).map((o) => o.card_id);
  assert(run.hand.length === 12 && run.hand.every((e) => owned.includes(e.id)) && ["QB", "RB", "WR", "TE"].map((p) => run.hand.filter((e) => CARDS.get(e.id).pos === p).length).join() === "2,4,4,2", "the hand is twelve of their own cards, 2-4-4-2");
  const twice = await post({ action: "run_start" });
  assert(twice.body.run.id === run.id && JSON.stringify(twice.body.run.hand) === JSON.stringify(run.hand) && s.cards.runs.length === 1, "starting again is the same run with the SAME hand - it cannot be re-dealt by asking");

  // Round one. A body that brings its own category, roll, result or user is ignored.
  const cats = row.cats.slice();
  const first = autoPick(run.hand, run.foe, []);
  const r1 = await post({ action: "run_round", run: run.id, step: 0, round: 0, card: first, cat: "star", win: "foe", roll: 99, user: GUEST, p_user: GUEST });
  assert(r1.status === 200 && r1.body.done === false && r1.body.round.cat === cats[0] && r1.body.round.spot === run.foe[0].spot, "round one is played on the run's first category, for the first spot: " + JSON.stringify(r1.body.round).slice(0, 120));
  assert(r1.body.round.mine.id === first.id && r1.body.round.foe.id === run.foe[0].id && r1.body.run.rounds.length === 1 && row.rounds.length === 1, "your card against theirs, and the round is written down");
  const again = await post({ action: "run_round", run: run.id, step: 0, round: 0, card: first });
  assert(again.status === 409 && again.body.reason === "stale" && row.rounds.length === 1, "the same round again - a double tap - is stale: " + JSON.stringify(again.body));
  // The rest of the battle.
  const out = await playOut(s);
  const end = out.last.body;
  assert(out.answers.length === 5 && out.answers.every((a) => a.status === 200) && end.done === true, "five more rounds, the last of which ends it");
  const b = end.battle;
  assert(b.win === true && b.rounds.length === 6 && b.wins > b.losses && b.rounds.map((x) => x.cat).join() === cats.join(), "sixty of the best cards beat the bottom of the ladder, on the six categories in the order that was kept");
  assert(b.rounds.map((x) => x.spot).join() === run.foe.map((e) => e.spot).join() && b.team.length === 6, "one round a spot, and the six that were played");
  const call = battleCalls(s, "card_run_battle")[0].args;
  assert(call.p_user === ME && call.p_coins === cardWinCoins(1) && call.p_cap === COIN_RULES.paidCardWinsPerDay && call.p_win === true, "the caller, the first win's pay and the day's cap are the function's own");
  assert(JSON.stringify(end.run.foe) === JSON.stringify(ladderFoe(row.seed, 1)) && end.run.wins === 1 && end.run.status === "live" && end.run.rounds.length === 0, "the next team follows from the same seed, with no rounds played");
  assert(end.run.hand.length === 12 && JSON.stringify(end.run.hand) === JSON.stringify(handOf(s, ME)), "and the next hand is dealt and stored with the win");
  assert(end.coins.credited === cardWinCoins(1) && end.coins.balance === s.wallet.balanceOf(ME), "the win was paid: " + JSON.stringify(end.coins));
  assert(s.cards.runs[0].last.total === b.total && JSON.stringify(s.cards.runs[0].cats) !== undefined, "the battle is kept on the run, for a browser that never got this answer");
  assert((await post({ action: "run_round", run: run.id, step: 0, round: 5, card: first })).body.reason === "stale", "a round of the battle that is over is stale");
  assert((await post({ action: "run_round", run: run.id + 7, step: 1, round: 0, card: first })).body.reason === "stale", "so is a run id that is not the live one");
});

await runTest("the luck and the order of the categories are the function's, fresh each battle", async () => {
  const seen = new Set(), orders = new Set();
  for (let i = 0; i < 5; i++) {
    const s = store(); stacked(s, ME);
    await post({ action: "run_start" });
    const b = (await playOut(s)).last.body.battle;
    seen.add(b.rounds.map((x) => x.mine.roll).join());
    orders.add(b.rounds.map((x) => x.cat).join());
    assert(b.rounds.every((x) => Math.abs(x.mine.roll) <= LUCK_SPREAD * LUCK_WIDE && Math.abs(x.foe.roll) <= LUCK_SPREAD * LUCK_WIDE), "no roll beyond the spread");
  }
  assert(seen.size === 5 && orders.size >= 3, `five battles, five sets of rolls and ${orders.size} category orders`);
});

await runTest("a loss ends the run, and walking away ends it too", async () => {
  const s = store();
  await claim(ME); // the starter cards: thirty under 60
  await post({ action: "run_start" });
  let lost = null, first = s.cards.runs[0].id;
  for (let step = 0; step < 30 && !lost; step++) {
    const out = await playOut(s);
    assert(out.last.status === 200 && out.last.body.done === true, "each battle is played to its end: " + JSON.stringify(out.last.body).slice(0, 160));
    if (!out.last.body.battle.win) lost = out.last.body; else assert(out.last.body.run.wins === step + 1, "a win moves the step on");
  }
  assert(lost && lost.run.status === "over" && lost.coins.credited === 0, "a starter deck loses before thirty battles, and a loss pays nothing");
  const after = await post({ action: "run_round", run: first, step: lost.run.wins, round: 0, card: { id: 1, finish: "base" } });
  assert(after.status === 409 && after.body.reason === "no_run", "there is no run to play on: " + JSON.stringify(after.body));
  const run = (await post({ action: "run_start" })).body.run;
  assert(run.wins === 0 && run.id !== first, "the next run is a new one from zero");
  const end = await post({ action: "run_end" });
  assert(end.status === 200 && end.body.ended === true && s.cards.runs.every((r) => r.status === "over"), "walking away ends it");
  assert((await post({ action: "run_end" })).body.ended === false, "and walking away from nothing is not an error");
});

await runTest("the cards it will not play, and what each is called", async () => {
  const s = store();
  stacked(s, ME);
  const run = (await post({ action: "run_start" })).body.run;
  const spot = run.foe[0].spot;
  const good = autoPick(run.hand, run.foe, []);
  const play = (card, round = 0) => post({ action: "run_round", run: run.id, step: 0, round, card });
  const misfit = run.hand.find((e) => !spotFits(CARDS.get(e.id).pos, spot));
  const outside = s.cards.owned(ME).map((o) => ({ id: o.card_id, finish: o.finish })).find((e) => spotFits(CARDS.get(e.id).pos, spot) && !run.hand.some((h) => h.id === e.id));
  for (const [reason, status, card] of [
    ["malformed", 400, null], ["malformed", 400, "my best card"], ["unknown_card", 400, { id: 99999999, finish: "base" }], ["bad_finish", 400, { id: good.id, finish: "diamond" }],
    ["bad_slot", 400, misfit],                       // in the hand, and not for this spot
    ["not_in_hand", 409, outside],                   // theirs, and fits the spot - but not dealt for this battle
    ["not_in_hand", 409, { id: good.id, finish: "prism" }],
  ]) {
    const res = await play(card);
    assert(res.status === status && res.body.reason === reason, `${reason}: ${JSON.stringify(res.body)} (${res.status})`);
  }
  assert(s.cards.runs[0].rounds.length === 0 && s.cards.runs[0].status === "live", "and not one of them played a round");
  for (const body of [{ action: "run_round", round: 0, card: good }, { action: "run_round", run: "1", step: 0, round: 0, card: good }, { action: "run_round", run: run.id, step: -1, round: 0, card: good },
    { action: "run_round", run: run.id, step: 0, card: good }, { action: "run_round", run: run.id, step: 0, round: 6, card: good }]) {
    const res = await post(body);
    assert(res.status === 400 && res.body.reason === "malformed", "a round with no run, step or round: " + JSON.stringify(res.body));
  }
  assert((await play(good, 1)).body.reason === "stale", "round two before round one is stale");
  // In the hand when it was dealt, gone from the collection since: the database's refusal, not the rules'.
  const gone = s.cards.tables.card_owned.find((o) => o.user_id === ME && o.card_id === good.id);
  gone.count = 0;
  const lostCard = await play(good);
  assert(lostCard.status === 409 && lostCard.body.reason === "not_owned", "a card no longer owned: " + JSON.stringify(lostCard.body));
  gone.count = 1;
  assert((await play(good)).status === 200, "and with it back, the round is played");
  // Already down: the same card, and the same man, cannot play a second round.
  const next = s.cards.runs[0];
  const againSpot = run.foe[1].spot;
  const res2 = await play(good, 1);
  assert(res2.status === (spotFits(CARDS.get(good.id).pos, againSpot) ? 409 : 400) && ["already_played", "bad_slot"].includes(res2.body.reason) && next.rounds.length === 1, "the card just played cannot be played again: " + JSON.stringify(res2.body));
  assert((await post({ action: "run_round", run: run.id, step: 0, round: 1, card: good }, GUEST)).body.reason === "guest_not_allowed", "a guest is refused before any of it");
  s.rpcFails.card_run_round = true;
  const broke = await play(autoPick(run.hand, run.foe, next.rounds), 1);
  assert(broke.status === 500 && broke.body.reason === "server", "a database that fails is a server error, not a refusal");
  s.rpcFails.card_run_round = false; s.readFails.card_runs = true;
  assert((await play(good, 1)).body.reason === "server", "and so is a run that cannot be read - never 'no run'");
});

await runTest("an account that cannot fill a deck cannot start, and is told why", async () => {
  const s = store();
  s.cards.grantCards(ME, "gift", [...CARDS.values()].slice(0, 8).map((c, i) => ({ ref: `few:${i}`, card: c.id, finish: "base" })));
  for (const action of ["run_start", "daily_deal"]) {
    const res = await post({ action });
    assert(res.status === 409 && res.body.reason === "no_deck", `${action}: ${JSON.stringify(res.body)}`);
  }
  assert(s.cards.runs.length === 0 && s.cards.dailies.length === 0, "and nothing was started");
});

await runTest("the daily battle: a hand dealt once, the day's team, a round at a time, one go", async () => {
  const s = store();
  stacked(s, ME);
  const today = new Date().toISOString().slice(0, 10);
  const foe = dailyFoe(today);
  assert((await post({ action: "daily_round", round: 0, card: { id: 1, finish: "base" } })).body.reason === "no_hand", "nothing to play before the hand is dealt");
  const dealt = await post({ action: "daily_deal", date: "1999-01-01" });
  assert(dealt.status === 200 && dealt.body.date === today && dealt.body.daily.hand.length === 12 && dealt.body.daily.played === false && dealt.body.daily.log.length === 0, "dealt for the function's own day: " + JSON.stringify(dealt.body).slice(0, 120));
  const again = await post({ action: "daily_deal" });
  assert(JSON.stringify(again.body.daily.hand) === JSON.stringify(dealt.body.daily.hand) && s.cards.dailies.length === 1, "asking again is the same hand");
  const hand = dealt.body.daily.hand;
  let log = [], last = null;
  const picks = [];
  for (let n = 0; n < 6; n++) {
    const card = autoPick(hand, foe, log);
    picks.push(card);
    last = await post({ action: "daily_round", round: n, card, cat: "star", score: 9999 });
    assert(last.status === 200 && last.body.round.cat === dailyCategories(today)[n] && last.body.done === (n === 5), `round ${n + 1} is on the day's category: ` + JSON.stringify(last.body).slice(0, 100));
    if (n === 0) assert((await post({ action: "daily_round", round: 0, card })).body.reason === "stale", "the same round twice is stale");
    log = last.body.daily.log;
  }
  const want = dailyBattle(today, picks);
  assert(last.body.daily.played === true && last.body.daily.rounds === want.wins && last.body.daily.score === Math.round(want.total * 10) / 10, "the result is the seeded one for that day and those cards, whatever the body claims: " + JSON.stringify(last.body.daily).slice(0, 160));
  assert(JSON.stringify(last.body.daily.shown.foe) === JSON.stringify(foe) && last.body.daily.shown.rounds.length === 6, "against the day's team, with the six rounds to show");
  const twice = await post({ action: "daily_round", round: 0, card: picks[0] });
  assert(twice.status === 409 && twice.body.reason === "duplicate", "a round on a finished day is refused: " + JSON.stringify(twice.body));
  const s2 = store(); stacked(s2, ME);
  const d2 = (await post({ action: "daily_deal" })).body.daily;
  const outsider = s2.cards.owned(ME).map((o) => ({ id: o.card_id, finish: o.finish })).find((e) => spotFits(CARDS.get(e.id).pos, foe[0].spot) && !d2.hand.some((h) => h.id === e.id));
  const cheat = await post({ action: "daily_round", round: 0, card: outsider });
  assert(cheat.status === 409 && cheat.body.reason === "not_in_hand" && s2.cards.dailies[0].log.length === 0, "a card that was not dealt plays nothing");
  assert(s.wallet.balanceOf(ME) === 0, "and a daily battle pays no coins");
});

await runTest("with the switch off, no battle touches the database", async () => {
  const s = store({ on: false });
  for (const body of [{ action: "run_start" }, { action: "run_end" }, { action: "daily_deal" }, { action: "daily_round", round: 0, card: {} }, { action: "deck_save", cards: [] }, { action: "run_round", run: 1, step: 0, round: 0, card: {} }]) {
    const res = await post(body);
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
