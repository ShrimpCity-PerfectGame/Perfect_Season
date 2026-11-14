// The cards' half of the Supabase mock: the two ownership tables and grant_cards, mirroring
// supabase/migration-cards.sql, and the card-claim Edge Function, mirroring supabase/functions/card-claim.
// tests/test-cards-sql.mjs runs one sequence of grants through the real SQL and through this and fails on any
// difference - every jsdom test in the suite runs on this, so a rule the database has and this does not is a
// rule no screen test ever meets.
// No Node-only import here: tests/mock-supabase.mjs is bundled into a browser page by tools/ui-harness. The
// card catalog is therefore whatever card-logic.mjs has been initialised with - tests/helpers.mjs does it for
// the jsdom suites, and in the harness the app's own loadCardData does.
import { CARDS, starterFill, deckProblem, bestDeck, dealHand, teamProblem, scoreBattle, ladderFoe, ladderEdge, dailyFoe, dailyBattle, dailyScore, ownKey } from "../card-logic.mjs";
import { COIN_RULES, cardWinCoins, cardSellCoins } from "../rewards.mjs";
import { PACK_BY_ID, rollPack } from "../card-packs.mjs";

const FINISHES = ["base", "silver", "gold", "prism"];
const KINDS = ["starter", "daily", "gift", "pack"];
// The card_packs seed, as supabase/migration-cards.sql writes it. tests/test-cards-sql.mjs holds the two level.
const PACK_SEED = [
  { id: "pack-standard", price: 150, size: 3, active: true, stock_total: null, stock_left: null, sort: 10 },
  { id: "pack-air-raid", price: 250, size: 3, active: true, stock_total: null, stock_left: null, sort: 20 },
  { id: "pack-legends", price: 3000, size: 1, active: true, stock_total: 5000, stock_left: 5000, sort: 30 },
];

// The shape functions-js hands back for a non-2xx: the reason is in the response body, reached through context.
export function cardHttpError(reason, status, message = reason) {
  return { data: null, error: { name: "FunctionsHttpError", message, context: { status, json: async () => ({ error: message, reason }) } } };
}

// state: { profiles: Map<id, { guest }>, currentUserId: () => id | null }. `enabled` is the server's own switch
// (the CARDS_ENABLED secret); tests turn it off to stand in for an environment that never had it set.
// wallet: tests/mock-wallet.mjs's makeWallet(state), for the pack shop - buy_pack moves coins through it the way
// the SQL moves them through wallet_lock and wallet_apply. Without one, buying a pack is a server error.
export function makeCards(state, { wallet = null } = {}) {
  const owned = [];  // { user_id, card_id, finish, count }
  const grants = []; // { user_id, kind, ref, card_id, finish }
  const packs = new Map(PACK_SEED.map((p) => [p.id, { ...p }]));
  const runs = [];    // { id, user_id, seed, wins, hand, foe, status, last, started_at, ended_at }
  const dailies = []; // { date, user_id, hand, rounds, score, shown, dealt_at, played_at }
  const decks = new Map(); // user_id -> [{ card, finish }]
  let nextRun = 1, tick = 0;
  const stamp = () => new Date(Date.now() + tick++).toISOString(); // strictly increasing, like now() across statements
  const utcDay = () => new Date().toISOString().slice(0, 10);
  const paidToday = (userId) => {
    const midnight = Date.parse(`${utcDay()}T00:00:00.000Z`);
    return [...wallet.tables.wallet_ledger.values()].filter((e) => e.user_id === userId && e.kind === "card_win" && Date.parse(e.created_at) >= midnight).length;
  };
  const who = (userId) => {
    const profile = state.profiles.get(userId);
    if (!profile) throw new Error("no_profile");
    if (profile.guest) throw new Error("guest_not_allowed");
    return profile;
  };
  const byName = (a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0);
  const api = {
    enabled: true,
    // ---------- battles (v2.27.0): supabase/migration-cards.sql, raise for raise and in its order ----------
    runs, dailies, decks,
    today: utcDay,
    nextRolls: null,      // the 29 [0,1) draws the next ladder battle uses instead of fresh ones - for a test that needs to know
    nextHand: null,       // (deck) => hand: how the next hand is dealt, instead of at random
    battleFails: false,   // the next battle HAPPENS and its answer is lost on the way back
    stateFails: false,    // card_battle_state and card_boards answer with an error
    // public.card_copies
    copies(userId) {
      return owned.filter((o) => o.user_id === userId && o.count > 1)
        .sort((a, b) => b.count - a.count || a.card_id - b.card_id || (a.finish < b.finish ? -1 : a.finish > b.finish ? 1 : 0))
        .slice(0, 500).map((o) => ({ card: o.card_id, finish: o.finish, count: o.count }));
    },
    // public.card_sell_copies
    sellCopies(userId, sales, ref) {
      who(userId);
      if (typeof ref !== "string" || !/^[A-Za-z0-9-]{8,36}$/.test(ref) || !Array.isArray(sales) || sales.length > 500) throw new Error("bad_sale");
      for (const e of sales) {
        const good = e && typeof e === "object" && !Array.isArray(e) && typeof e.card === "number" && Number.isInteger(e.card) && e.card >= 1 && e.card <= 999999999
          && FINISHES.includes(e.finish) && typeof e.each === "number" && Number.isInteger(e.each) && e.each >= 0 && e.each <= 20000;
        if (!good) throw new Error("bad_sale");
      }
      wallet.lock(userId);
      let copies = 0, coins = 0;
      for (const e of sales) {
        const row = owned.find((o) => o.user_id === userId && o.card_id === e.card && o.finish === e.finish && o.count > 1);
        if (!row) continue;
        copies += row.count - 1; coins += (row.count - 1) * e.each; row.count = 1;
      }
      if (coins > 0) wallet.apply(userId, coins, "card_sell", `copies:${ref}`);
      return { copies, coins, balance: wallet.balanceOf(userId) };
    },
    // public.card_list_check
    listCheck(list, size, reason) {
      if (!Array.isArray(list) || list.length !== size) throw new Error(reason);
      for (const e of list) {
        const good = e && typeof e === "object" && !Array.isArray(e) && typeof e.card === "number" && Number.isInteger(e.card) && e.card >= 1 && e.card <= 999999999 && FINISHES.includes(e.finish);
        if (!good) throw new Error(reason);
      }
    },
    // public.card_lineup_owned
    lineupOwned(userId, list, size = 6) {
      api.listCheck(list, size, "bad_lineup");
      return list.every((e) => owned.some((o) => o.user_id === userId && o.card_id === e.card && o.finish === e.finish && o.count >= 1));
    },
    // public.card_deck_read
    deckRead(userId) {
      return {
        owned: owned.filter((o) => o.user_id === userId && o.count >= 1).map((o) => ({ card: o.card_id, finish: o.finish }))
          .sort((a, b) => a.card - b.card || (a.finish < b.finish ? -1 : a.finish > b.finish ? 1 : 0)),
        deck: decks.get(userId) ?? null,
      };
    },
    // public.card_deck_save
    deckSave(userId, cards) {
      who(userId);
      if (!api.lineupOwned(userId, cards, 30)) throw new Error("not_owned");
      decks.set(userId, cards.map((c) => ({ card: c.card, finish: c.finish })));
      return { saved: true };
    },
    // public.card_run_start
    runStart(userId, seed, hand, foe) {
      who(userId);
      if (typeof seed !== "string" || seed.length < 8 || seed.length > 64) throw new Error("bad_run");
      api.listCheck(hand, 12, "bad_run"); api.listCheck(foe, 6, "bad_run");
      let run = runs.find((r) => r.user_id === userId && r.status === "live");
      const fresh = !run;
      if (!run) { run = { id: nextRun++, user_id: userId, seed, wins: 0, hand, foe, status: "live", last: null, started_at: stamp(), ended_at: null }; runs.push(run); }
      return { id: run.id, wins: run.wins, hand: run.hand, foe: run.foe, last: run.last, fresh };
    },
    // public.card_run_battle
    runBattle(userId, runId, step, lineup, win, hand, foe, last, coins, cap) {
      who(userId);
      const whole = (n) => typeof n === "number" && Number.isInteger(n);
      if (typeof win !== "boolean" || !whole(step) || !last || typeof last !== "object" || Array.isArray(last)
        || !whole(coins) || coins < 0 || coins > 100 || !whole(cap) || cap < 0) throw new Error("bad_battle");
      if (win) { api.listCheck(hand, 12, "bad_battle"); api.listCheck(foe, 6, "bad_battle"); }
      wallet.lock(userId);
      const run = runs.find((r) => r.id === runId && r.user_id === userId && r.status === "live");
      if (!run) throw new Error("no_run");
      if (run.wins !== step) throw new Error("stale");
      if (!api.lineupOwned(userId, lineup, 6)) throw new Error("not_owned");
      let credited = 0, capped = false;
      if (win) {
        run.wins += 1; run.hand = hand; run.foe = foe; run.last = last;
        if (coins > 0) {
          if (paidToday(userId) >= cap) capped = true;
          else credited = wallet.apply(userId, coins, "card_win", `${run.id}:${run.wins}`);
        }
      } else { run.status = "over"; run.ended_at = stamp(); run.last = last; }
      return { wins: run.wins, status: run.status, hand: run.hand, foe: run.foe, credited, capped, balance: wallet.balanceOf(userId) };
    },
    // public.card_run_end
    runEnd(userId) {
      const run = runs.find((r) => r.user_id === userId && r.status === "live");
      if (!run) return { ended: false, wins: 0 };
      run.status = "over"; run.ended_at = stamp();
      return { ended: true, wins: run.wins };
    },
    // public.card_daily_deal
    dailyDeal(userId, date, hand) {
      who(userId);
      if (typeof date !== "string") throw new Error("bad_daily");
      api.listCheck(hand, 12, "bad_daily");
      let row = dailies.find((d) => d.date === date && d.user_id === userId);
      if (!row) { row = { date, user_id: userId, hand, rounds: null, score: null, shown: null, dealt_at: stamp(), played_at: null }; dailies.push(row); }
      return { hand: row.hand, played: row.played_at !== null, rounds: row.rounds, score: row.score, shown: row.shown };
    },
    // public.card_daily_record
    dailyRecord(userId, date, lineup, rounds, score, shown) {
      who(userId);
      if (typeof date !== "string" || typeof rounds !== "number" || !Number.isInteger(rounds) || rounds < 0 || rounds > 6
        || typeof score !== "number" || !Number.isFinite(score) || score < -9999 || score > 9999
        || !shown || typeof shown !== "object" || Array.isArray(shown)) throw new Error("bad_daily");
      const row = dailies.find((d) => d.date === date && d.user_id === userId);
      if (!row) throw new Error("no_hand");
      if (row.played_at !== null) return { duplicate: true, rounds: row.rounds, score: row.score, shown: row.shown };
      if (!api.lineupOwned(userId, lineup, 6)) throw new Error("not_owned");
      row.rounds = rounds; row.score = Math.round(score * 10) / 10; row.shown = shown; row.played_at = stamp();
      return { duplicate: false, rounds: row.rounds, score: row.score, shown: row.shown };
    },
    // public.card_battle_state, for whoever is signed in
    battleState() {
      const uid = state.currentUserId();
      const mine = uid ? runs.filter((r) => r.user_id === uid) : [];
      const run = mine.length ? mine.reduce((a, b) => (b.id > a.id ? b : a)) : null; // the latest, live or over
      const day = uid ? dailies.find((d) => d.user_id === uid && d.date === utcDay()) : null;
      return {
        today: utcDay(),
        deck: uid ? decks.get(uid) ?? null : null,
        run: run ? { id: run.id, wins: run.wins, status: run.status, hand: run.hand, foe: run.foe, last: run.last } : null,
        best: mine.reduce((m, r) => Math.max(m, r.wins), 0),
        paid_today: uid && wallet ? paidToday(uid) : 0,
        daily: day ? { hand: day.hand, played: day.played_at !== null, rounds: day.rounds, score: day.score, shown: day.shown } : null,
      };
    },
    // public.card_boards
    boards(limit = 25) {
      const n = Math.max(1, Math.min(limit ?? 25, 100));
      const best = new Map();
      for (const r of runs) {
        const p = state.profiles.get(r.user_id);
        if (!p || p.guest) continue;
        best.set(p.username, Math.max(best.get(p.username) ?? 0, r.wins));
      }
      const runBoard = [...best].map(([username, wins]) => ({ username, wins })).filter((r) => r.wins > 0)
        .sort((a, b) => b.wins - a.wins || byName(a, b)).slice(0, n);
      const day = dailies.filter((d) => d.date === utcDay() && d.played_at !== null).map((d) => ({ d, p: state.profiles.get(d.user_id) })).filter((x) => x.p && !x.p.guest)
        .map(({ d, p }) => ({ username: p.username, rounds: d.rounds, score: d.score, at: d.played_at }))
        .sort((a, b) => b.rounds - a.rounds || b.score - a.score || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || byName(a, b)).slice(0, n)
        .map(({ username, rounds, score }) => ({ username, rounds, score }));
      return { today: utcDay(), runs: runBoard, daily: day };
    },
    packs,
    packsReadFail: false, // makes a client select on card_packs answer with an error

    // public.buy_pack, raise for raise and in its order.
    buyPack(userId, packId, open, cards, shownPrice = null) {
      const profile = state.profiles.get(userId);
      if (!profile) throw new Error("no_profile");
      if (profile.guest) throw new Error("guest_not_allowed");
      if (typeof open !== "string" || !/^[A-Za-z0-9-]{8,36}$/.test(open)) throw new Error("bad_open");
      wallet.lock(userId);
      const balance = wallet.balanceOf(userId);
      if (wallet.tables.wallet_ledger.has(`${userId}|pack|${open}`)) {
        const before = grants.filter((g) => g.user_id === userId && g.kind === "pack" && g.ref.startsWith(`${open}:`))
          .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).map((g) => {
            const sale = wallet.tables.wallet_ledger.get(`${userId}|card_sell|pack:${g.ref}`);
            return sale ? { card: g.card_id, finish: g.finish, sold: sale.amount } : { card: g.card_id, finish: g.finish };
          });
        return { duplicate: true, cards: before, balance, stock_left: packs.get(packId)?.stock_left ?? null, price: null };
      }
      const pack = packs.get(packId);
      if (!pack || !pack.active) throw new Error("unavailable");
      if (!Array.isArray(cards) || cards.length !== pack.size) throw new Error("bad_grant");
      for (const e of cards) {
        const good = e && typeof e === "object" && !Array.isArray(e) && typeof e.card === "number" && Number.isInteger(e.card) && e.card >= 1 && e.card <= 999999999 && FINISHES.includes(e.finish);
        if (!good) throw new Error("bad_grant");
      }
      if (pack.stock_left != null && pack.stock_left <= 0) throw new Error("sold_out");
      if (shownPrice != null && pack.price > shownPrice) throw new Error("price_changed");
      if (balance < pack.price) throw new Error("not_enough");
      // The SQL is one transaction, so a grant that comes up short undoes the stock and the debit. Here that is
      // checked BEFORE either moves: the same outcome, with nothing to roll back.
      if (cards.some((_, i) => grants.some((g) => g.user_id === userId && g.kind === "pack" && g.ref === `${open}:${i}`))) throw new Error("purchase_conflict");
      if (pack.stock_left != null) pack.stock_left -= 1;
      if (wallet.apply(userId, -pack.price, "pack", open) !== -pack.price) throw new Error("purchase_conflict");
      const got = api.grantCards(userId, "pack", cards.map((c, i) => ({ ref: `${open}:${i}`, card: c.card, finish: c.finish, ...(c.sell != null ? { sell: c.sell } : {}) })));
      const out = got.granted.map((g) => (g.sold != null ? { card: g.card, finish: g.finish, sold: g.sold } : { card: g.card, finish: g.finish }));
      return { duplicate: false, cards: out, balance: wallet.balanceOf(userId), stock_left: pack.stock_left, price: pack.price };
    },
    readFails: false, // makes a client select on either table answer with an error
    openFails: false, // the next pack purchase goes through and its answer is lost on the way back
    nextPull: null,   // [{ id, finish }] the next opened pack holds, instead of a roll - for a test that needs to know
    // What anyone's select on card_packs returns: every row, in the order asked for by the caller.
    packRows() {
      if (api.packsReadFail) return { data: null, error: { message: "mock: the read failed", code: "XX000" } };
      return { data: [...packs.values()].map((p) => ({ ...p })), error: null };
    },
    tables: { card_owned: owned, card_grants: grants },

    // public.grant_cards. Throws an Error whose message is the reason, the way the mock's rpc layer expects.
    grantCards(userId, kind, list) {
      const profile = state.profiles.get(userId);
      if (!profile) throw new Error("no_profile");
      if (profile.guest) throw new Error("guest_not_allowed");
      if (!KINDS.includes(kind) || !Array.isArray(list) || list.length > 40) throw new Error("bad_grant");
      for (const e of list) {
        const okRef = e && typeof e === "object" && !Array.isArray(e) && typeof e.ref === "string" && e.ref.length >= 1 && e.ref.length <= 40;
        const okCard = okRef && typeof e.card === "number" && Number.isInteger(e.card) && e.card >= 1 && e.card <= 999999999;
        if (!okCard || !FINISHES.includes(e.finish)) throw new Error("bad_grant");
        // "sell": left out or null, or a whole number of coins no card is worth more than
        if (e.sell != null && !(typeof e.sell === "number" && Number.isInteger(e.sell) && e.sell >= 0 && e.sell <= 20000)) throw new Error("bad_grant");
      }
      if (wallet && list.some((e) => e.sell != null)) wallet.lock(userId);
      const granted = [];
      for (const e of list) {
        if (grants.some((g) => g.user_id === userId && g.kind === kind && g.ref === e.ref)) continue;
        grants.push({ user_id: userId, kind, ref: e.ref, card_id: e.card, finish: e.finish });
        const row = owned.find((o) => o.user_id === userId && o.card_id === e.card && o.finish === e.finish);
        // A copy of a card already held, with a price on it, is sold rather than stacked (CARDS.md 12).
        if (e.sell != null && row && row.count >= 1) {
          if (e.sell > 0) wallet.apply(userId, e.sell, "card_sell", `${kind}:${e.ref}`);
          granted.push({ ref: e.ref, card: e.card, finish: e.finish, sold: e.sell });
          continue;
        }
        if (row) row.count++;
        else owned.push({ user_id: userId, card_id: e.card, finish: e.finish, count: 1 });
        granted.push({ ref: e.ref, card: e.card, finish: e.finish });
      }
      return { granted, duplicate: list.length > 0 && granted.length === 0 };
    },

    owned: (userId) => owned.filter((o) => o.user_id === userId),
    grants: (userId) => grants.filter((g) => g.user_id === userId),
    // What a signed-in client's own-rows-only select returns.
    select(table, userId) {
      if (api.readFails) return { data: null, error: { message: "mock: the read failed", code: "XX000" } };
      return { data: (table === "card_owned" ? owned : grants).filter((r) => userId && r.user_id === userId).map((r) => ({ ...r })), error: null };
    },
    // delete_account's cards arm.
    forget(userId) {
      for (const list of [owned, grants, runs, dailies]) for (let i = list.length - 1; i >= 0; i--) if (list[i].user_id === userId) list.splice(i, 1);
      decks.delete(userId);
    },
    clear() { owned.length = 0; grants.length = 0; runs.length = 0; dailies.length = 0; decks.clear(); },

    // supabase/functions/card-claim, answer for answer and in its order.
    async claimStarter(body) {
      const uid = state.currentUserId();
      if (!uid) return cardHttpError("signed_out", 401);
      if (!body || !["starter", "open_pack", "sell_copies", "deck_save", "run_start", "run_battle", "run_end", "daily_deal", "daily_play"].includes(body.action)) return cardHttpError("malformed", 400);
      if (body.action === "run_battle" && (!Number.isInteger(body.run) || !Number.isInteger(body.step) || body.step < 0)) return cardHttpError("malformed", 400);
      if (body.action === "open_pack" && (typeof body.pack !== "string" || typeof body.open !== "string" || !Number.isInteger(body.price) || body.price < 1 || body.price > 1000000)) return cardHttpError("malformed", 400);
      if (!api.enabled) return cardHttpError("cards_off", 403);
      const profile = state.profiles.get(uid);
      if (!profile) return cardHttpError("no_profile", 400);
      if (profile.guest) return cardHttpError("guest_not_allowed", 403);
      if (!CARDS.size) { console.error("mock-cards: card-logic.mjs has no catalog - call initCardData first"); return cardHttpError("server", 500); }
      if (body.action === "open_pack") {
        const pack = Object.hasOwn(PACK_BY_ID, body.pack) ? PACK_BY_ID[body.pack] : null;
        if (!pack) return cardHttpError("unknown_pack", 400);
        if (!/^[A-Za-z0-9-]{8,36}$/.test(body.open)) return cardHttpError("bad_open", 400);
        // openFails: the purchase HAPPENS and the answer is lost - the case the open id exists for.
        const pulled = api.nextPull || rollPack(pack, Math.random);
        api.nextPull = null;
        let bought;
        try { bought = api.buyPack(uid, pack.id, body.open, pulled.map((c) => ({ card: c.id, finish: c.finish, sell: sellFor(c) })), body.price); }
        catch (e) {
          const status = { unavailable: 409, sold_out: 409, price_changed: 409, not_enough: 409, bad_open: 400, no_profile: 400, guest_not_allowed: 403 }[e?.message];
          return status ? cardHttpError(e.message, status) : cardHttpError("server", 500);
        }
        if (api.openFails) { api.openFails = false; return { data: null, error: { name: "FunctionsFetchError", message: "Failed to send" } }; }
        return { data: { ok: true, cards: bought.cards.map((c) => (c.sold != null ? { id: c.card, finish: c.finish, sold: c.sold } : { id: c.card, finish: c.finish })), balance: bought.balance, stockLeft: bought.stock_left ?? null, duplicate: bought.duplicate }, error: null };
      }
      if (["deck_save", "run_start", "run_battle", "run_end", "daily_deal", "daily_play"].includes(body.action)) return api.battle(uid, body);
      if (body.action === "sell_copies") {
        let sold;
        try { sold = api.sellCopies(uid, api.copies(uid).filter((c) => CARDS.has(c.card)).map((c) => ({ card: c.card, finish: c.finish, each: sellFor({ id: c.card, finish: c.finish }) })), "mock-sweep-0001"); }
        catch { return cardHttpError("server", 500); }
        if (api.sweepFails) { api.sweepFails = false; return { data: null, error: { name: "FunctionsFetchError", message: "Failed to send" } }; }
        return { data: { ok: true, copies: sold.copies, coins: sold.coins, balance: sold.balance }, error: null };
      }
      // The starter cards fill a deck: whatever the collection is short of thirty, by position.
      const fill = starterFill(api.deckRead(uid).owned.map((o) => ({ id: o.card, finish: o.finish })), Math.random);
      if (!fill.length) return cardHttpError("duplicate", 409);
      let res;
      try { res = api.grantCards(uid, "starter", fill.map((c) => ({ ref: c.ref, card: c.id, finish: c.finish, sell: sellFor(c) }))); }
      catch { return cardHttpError("server", 500); }
      if (res.duplicate) return cardHttpError("duplicate", 409);
      return { data: { ok: true, cards: res.granted.map((g) => (g.sold != null ? { id: g.card, finish: g.finish, sold: g.sold } : { id: g.card, finish: g.finish })) }, error: null };
    },
  };
  // What a copy of a card sells for: rewards.mjs's, from the catalog's rating - as card-claim works it out.
  const sellFor = (c) => cardSellCoins(CARDS.get(c.id)?.rating, c.finish);
  api.sellFor = sellFor;
  api.sweepFails = false; // the next sweep HAPPENS and its answer is lost
  // supabase/functions/card-claim's battle half, answer for answer and in its order.
  const BATTLE_REFUSALS = { no_profile: 400, guest_not_allowed: 403, no_run: 409, stale: 409, not_owned: 409, no_hand: 409 };
  const toSql = (list) => list.map((e) => ({ card: e.id, finish: e.finish }));
  const fromSql = (list) => (Array.isArray(list) ? list.map((e) => ({ id: e.card, finish: e.finish })) : []);
  const lost = () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send" } });
  const said = (reason, status) => cardHttpError(reason, status);
  // The deck an account plays with: the one it saved if that is still a legal deck of cards it owns, otherwise
  // its best thirty; null when it cannot fill a deck at all.
  api.deckOf = (uid) => {
    const got = api.deckRead(uid);
    const have = fromSql(got.owned);
    const map = new Map(have.map((e) => [ownKey(e.id, e.finish), 1]));
    const saved = got.deck ? fromSql(got.deck) : null;
    return saved && deckProblem(saved, map) === null ? saved : bestDeck(have);
  };
  const deal = (deck) => { const how = api.nextHand; api.nextHand = null; return how ? how(deck) : dealHand(deck, Math.random); };
  const shownBattle = (result, team, foe, edge) => ({ team, foe, edge, rounds: result.rounds, wins: result.wins, losses: result.losses, total: result.total, foeTotal: result.foeTotal, win: result.win });
  api.battle = async (uid, body) => {
    const refuse = (e) => (BATTLE_REFUSALS[e?.message] ? said(e.message, BATTLE_REFUSALS[e.message]) : said("server", 500));
    if (body.action === "run_end") {
      const ended = api.runEnd(uid);
      return { data: { ok: true, ended: ended.ended, wins: ended.wins }, error: null };
    }
    if (body.action === "deck_save") {
      const problem = deckProblem(body.cards, null);
      if (problem) return said(problem, 400);
      try { api.deckSave(uid, toSql(body.cards)); } catch (e) { return refuse(e); }
      return { data: { ok: true, saved: true }, error: null };
    }
    const deck = api.deckOf(uid);
    if (body.action === "run_start") {
      if (!deck) return said("no_deck", 409);
      const seed = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      try {
        const run = api.runStart(uid, seed, toSql(deal(deck)), toSql(ladderFoe(seed, 0)));
        return { data: { ok: true, run: { id: run.id, wins: run.wins, hand: fromSql(run.hand), foe: fromSql(run.foe), last: run.last } }, error: null };
      } catch (e) { return refuse(e); }
    }
    if (body.action === "daily_deal") {
      const date = utcDay();
      const before = dailies.find((d) => d.date === date && d.user_id === uid);
      if (!before && !deck) return said("no_deck", 409);
      try {
        const row = api.dailyDeal(uid, date, before ? before.hand : toSql(deal(deck)));
        return { data: { ok: true, date, daily: { hand: fromSql(row.hand), played: row.played, rounds: row.rounds, score: row.score, shown: row.shown } }, error: null };
      } catch (e) { return refuse(e); }
    }
    if (body.action === "daily_play") {
      const date = utcDay();
      const row = dailies.find((d) => d.date === date && d.user_id === uid);
      if (!row) return said("no_hand", 409);
      const problem = teamProblem(body.team, fromSql(row.hand));
      if (problem) return said(problem, problem === "not_in_hand" ? 409 : 400);
      const result = dailyBattle(date, body.team);
      const { rounds, score } = dailyScore(result);
      let rec;
      try { rec = api.dailyRecord(uid, date, toSql(body.team), rounds, score, shownBattle(result, body.team, dailyFoe(date), 0)); }
      catch (e) { return refuse(e); }
      if (api.battleFails) { api.battleFails = false; return lost(); }
      if (rec.duplicate) return said("duplicate", 409);
      return { data: { ok: true, date, daily: { hand: fromSql(row.hand), played: true, rounds: rec.rounds, score: rec.score, shown: rec.shown } }, error: null };
    }
    // run_battle
    const run = runs.find((r) => r.user_id === uid && r.status === "live");
    if (!run) return said("no_run", 409);
    if (run.id !== body.run || run.wins !== body.step) return said("stale", 409);
    const hand = fromSql(run.hand), foe = fromSql(run.foe);
    const problem = teamProblem(body.team, hand);
    if (problem) return said(problem, problem === "not_in_hand" ? 409 : 400);
    const rolls = api.nextRolls; api.nextRolls = null;
    let i = 0;
    const edge = ladderEdge(run.wins);
    const result = scoreBattle(body.team, foe, rolls ? () => rolls[i++] : Math.random, null, edge);
    const last = shownBattle(result, body.team, foe, edge);
    let rec;
    try {
      rec = api.runBattle(uid, run.id, body.step, toSql(body.team), result.win,
        result.win ? toSql(deal(deck || hand)) : null, result.win ? toSql(ladderFoe(run.seed, run.wins + 1)) : null,
        last, result.win ? cardWinCoins(run.wins + 1) : 0, COIN_RULES.paidCardWinsPerDay);
    } catch (e) { return refuse(e); }
    if (api.battleFails) { api.battleFails = false; return lost(); }
    return { data: { ok: true, battle: last, run: { id: run.id, wins: rec.wins, status: rec.status, hand: fromSql(rec.hand), foe: fromSql(rec.foe) }, coins: { credited: rec.credited, capped: rec.capped, balance: rec.balance } }, error: null };
  };
  return api;
}
