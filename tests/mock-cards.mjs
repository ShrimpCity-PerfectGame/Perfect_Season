// The cards' half of the Supabase mock: the two ownership tables and grant_cards, mirroring
// supabase/migration-cards.sql, and the card-claim Edge Function, mirroring supabase/functions/card-claim.
// tests/test-cards-sql.mjs runs one sequence of grants through the real SQL and through this and fails on any
// difference - every jsdom test in the suite runs on this, so a rule the database has and this does not is a
// rule no screen test ever meets.
// No Node-only import here: tests/mock-supabase.mjs is bundled into a browser page by tools/ui-harness. The
// card catalog is therefore whatever card-logic.mjs has been initialised with - tests/helpers.mjs does it for
// the jsdom suites, and in the harness the app's own loadCardData does.
import { starterDeck, CARDS, DEFENSES, defenseByKey, lineupProblem, scoreBattle, runDefense, showdownDefense, showdownScore } from "../card-logic.mjs";
import { SLOTS } from "../game-logic.mjs";
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
  const runs = [];      // { id, user_id, seed, wins, defense, status, last, started_at, ended_at }
  const showdowns = []; // { date, user_id, defense, lineup, score, created_at }
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
    // ---------- battles (v2.25.0): supabase/migration-cards.sql, raise for raise and in its order ----------
    runs, showdowns,
    today: utcDay,
    nextRolls: null,      // twelve [0,1) draws the next run battle uses instead of fresh ones - for a test that needs to know
    battleFails: false,   // the next battle or showdown HAPPENS and its answer is lost on the way back
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
    // public.card_lineup_owned
    lineupOwned(userId, list) {
      if (!Array.isArray(list) || list.length !== 6) throw new Error("bad_lineup");
      for (const e of list) {
        const good = e && typeof e === "object" && !Array.isArray(e) && typeof e.card === "number" && Number.isInteger(e.card) && e.card >= 1 && e.card <= 999999999 && FINISHES.includes(e.finish);
        if (!good) throw new Error("bad_lineup");
      }
      return list.every((e) => owned.some((o) => o.user_id === userId && o.card_id === e.card && o.finish === e.finish && o.count >= 1));
    },
    // public.card_run_start
    runStart(userId, seed, defense) {
      who(userId);
      if (typeof seed !== "string" || seed.length < 8 || seed.length > 64 || typeof defense !== "string" || defense.length < 3 || defense.length > 20) throw new Error("bad_run");
      let run = runs.find((r) => r.user_id === userId && r.status === "live");
      const fresh = !run;
      if (!run) { run = { id: nextRun++, user_id: userId, seed, wins: 0, defense, status: "live", last: null, started_at: stamp(), ended_at: null }; runs.push(run); }
      return { id: run.id, wins: run.wins, defense: run.defense, last: run.last, fresh };
    },
    // public.card_run_battle
    runBattle(userId, runId, step, lineup, win, next, last, coins, cap) {
      who(userId);
      const whole = (n) => typeof n === "number" && Number.isInteger(n);
      if (typeof win !== "boolean" || !whole(step) || !last || typeof last !== "object" || Array.isArray(last)
        || !whole(coins) || coins < 0 || coins > 100 || !whole(cap) || cap < 0
        || (win && (typeof next !== "string" || next.length < 3 || next.length > 20))) throw new Error("bad_battle");
      wallet.lock(userId);
      const run = runs.find((r) => r.id === runId && r.user_id === userId && r.status === "live");
      if (!run) throw new Error("no_run");
      if (run.wins !== step) throw new Error("stale");
      if (!api.lineupOwned(userId, lineup)) throw new Error("not_owned");
      let credited = 0, capped = false;
      if (win) {
        run.wins += 1; run.defense = next; run.last = last;
        if (coins > 0) {
          if (paidToday(userId) >= cap) capped = true;
          else credited = wallet.apply(userId, coins, "card_win", `${run.id}:${run.wins}`);
        }
      } else { run.status = "over"; run.ended_at = stamp(); run.last = last; }
      return { wins: run.wins, status: run.status, defense: run.defense, credited, capped, balance: wallet.balanceOf(userId) };
    },
    // public.card_run_end
    runEnd(userId) {
      const run = runs.find((r) => r.user_id === userId && r.status === "live");
      if (!run) return { ended: false, wins: 0 };
      run.status = "over"; run.ended_at = stamp();
      return { ended: true, wins: run.wins };
    },
    // public.card_showdown_record
    showdownRecord(userId, date, defense, lineup, score, shown) {
      who(userId);
      if (typeof date !== "string" || typeof defense !== "string" || defense.length < 3 || defense.length > 20
        || typeof score !== "number" || !Number.isFinite(score) || score < -9999 || score > 9999
        || !shown || typeof shown !== "object" || Array.isArray(shown)) throw new Error("bad_showdown");
      let row = showdowns.find((s) => s.date === date && s.user_id === userId);
      const duplicate = !!row;
      if (!row) {
        if (!api.lineupOwned(userId, lineup)) throw new Error("not_owned");
        row = { date, user_id: userId, defense, lineup: shown, score: Math.round(score * 10) / 10, created_at: stamp() };
        showdowns.push(row);
      }
      return { duplicate, date: row.date, defense: row.defense, lineup: row.lineup, score: row.score };
    },
    // public.card_battle_state, for whoever is signed in
    battleState() {
      const uid = state.currentUserId();
      const mine = uid ? runs.filter((r) => r.user_id === uid) : [];
      const run = mine.length ? mine.reduce((a, b) => (b.id > a.id ? b : a)) : null; // the latest, live or over
      const sd = uid ? showdowns.find((s) => s.user_id === uid && s.date === utcDay()) : null;
      return {
        today: utcDay(),
        run: run ? { id: run.id, wins: run.wins, status: run.status, defense: run.defense, last: run.last } : null,
        best: mine.reduce((m, r) => Math.max(m, r.wins), 0),
        paid_today: uid && wallet ? paidToday(uid) : 0,
        showdown: sd ? { defense: sd.defense, lineup: sd.lineup, score: sd.score } : null,
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
      const day = showdowns.filter((s) => s.date === utcDay()).map((s) => ({ s, p: state.profiles.get(s.user_id) })).filter((x) => x.p && !x.p.guest)
        .map(({ s, p }) => ({ username: p.username, score: s.score, at: s.created_at }))
        .sort((a, b) => b.score - a.score || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || byName(a, b)).slice(0, n)
        .map(({ username, score }) => ({ username, score }));
      return { today: utcDay(), runs: runBoard, showdown: day };
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
      if (!KINDS.includes(kind) || !Array.isArray(list) || list.length > 20) throw new Error("bad_grant");
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
      for (const list of [owned, grants, runs, showdowns]) for (let i = list.length - 1; i >= 0; i--) if (list[i].user_id === userId) list.splice(i, 1);
    },
    clear() { owned.length = 0; grants.length = 0; runs.length = 0; showdowns.length = 0; },

    // supabase/functions/card-claim, answer for answer and in its order.
    async claimStarter(body) {
      const uid = state.currentUserId();
      if (!uid) return cardHttpError("signed_out", 401);
      if (!body || !["starter", "open_pack", "sell_copies", "run_start", "run_battle", "run_end", "showdown"].includes(body.action)) return cardHttpError("malformed", 400);
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
      if (["run_start", "run_battle", "run_end", "showdown"].includes(body.action)) return api.battle(uid, body);
      if (body.action === "sell_copies") {
        let sold;
        try { sold = api.sellCopies(uid, api.copies(uid).filter((c) => CARDS.has(c.card)).map((c) => ({ card: c.card, finish: c.finish, each: sellFor({ id: c.card, finish: c.finish }) })), "mock-sweep-0001"); }
        catch { return cardHttpError("server", 500); }
        if (api.sweepFails) { api.sweepFails = false; return { data: null, error: { name: "FunctionsFetchError", message: "Failed to send" } }; }
        return { data: { ok: true, copies: sold.copies, coins: sold.coins, balance: sold.balance }, error: null };
      }
      const deck = starterDeck(Math.random);
      let res;
      try { res = api.grantCards(uid, "starter", deck.map((c, i) => ({ ref: `starter:${i}`, card: c.id, finish: c.finish, sell: sellFor(c) }))); }
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
  const BATTLE_REFUSALS = { no_profile: 400, guest_not_allowed: 403, no_run: 409, stale: 409, not_owned: 409 };
  const shown = (result, defense) => ({ defense: defense.key, cards: result.cards, offense: result.offense, target: result.target, win: result.win });
  const sqlList = (lineup) => SLOTS.map((slot) => ({ card: lineup[slot].id, finish: lineup[slot].finish }));
  const lost = () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send" } });
  api.battle = async (uid, body) => {
    if (!DEFENSES.length) { console.error("mock-cards: card-logic.mjs has no defenses - call initDefenses first"); return cardHttpError("server", 500); }
    const refuse = (e) => (BATTLE_REFUSALS[e?.message] ? cardHttpError(e.message, BATTLE_REFUSALS[e.message]) : cardHttpError("server", 500));
    if (body.action === "run_start") {
      const seed = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      try { const run = api.runStart(uid, seed, runDefense(seed, 0).key); return { data: { ok: true, run: { id: run.id, wins: run.wins, defense: run.defense, last: run.last } }, error: null }; }
      catch (e) { return refuse(e); }
    }
    if (body.action === "run_end") {
      const ended = api.runEnd(uid);
      return { data: { ok: true, ended: ended.ended, wins: ended.wins }, error: null };
    }
    const problem = lineupProblem(body.lineup, null);
    if (problem) return cardHttpError(problem, 400);
    if (body.action === "showdown") {
      const date = utcDay();
      const defense = showdownDefense(date);
      const result = showdownScore(date, body.lineup);
      let rec;
      try { rec = api.showdownRecord(uid, date, defense.key, sqlList(body.lineup), result.score, shown(result, defense)); }
      catch (e) { return refuse(e); }
      if (api.battleFails) { api.battleFails = false; return lost(); }
      if (rec.duplicate) return { data: null, error: { name: "FunctionsHttpError", message: "duplicate", context: { status: 409, json: async () => ({ error: "already played", reason: "duplicate" }) } } };
      return { data: { ok: true, date, showdown: { defense: rec.defense, lineup: rec.lineup, score: rec.score } }, error: null };
    }
    // run_battle
    const run = runs.find((r) => r.user_id === uid && r.status === "live");
    if (!run) return cardHttpError("no_run", 409);
    if (run.id !== body.run || run.wins !== body.step) return cardHttpError("stale", 409);
    const defense = defenseByKey(run.defense);
    if (!defense) return cardHttpError("server", 500);
    const rolls = api.nextRolls; api.nextRolls = null;
    let i = 0;
    const result = scoreBattle(body.lineup, defense, rolls ? () => rolls[i++] : Math.random, run.wins);
    const last = shown(result, defense);
    let rec;
    try { rec = api.runBattle(uid, run.id, body.step, sqlList(body.lineup), result.win, result.win ? runDefense(run.seed, run.wins + 1).key : null, last, result.win ? cardWinCoins(run.wins + 1) : 0, COIN_RULES.paidCardWinsPerDay); }
    catch (e) { return refuse(e); }
    if (api.battleFails) { api.battleFails = false; return lost(); }
    return { data: { ok: true, battle: last, run: { id: run.id, wins: rec.wins, status: rec.status, defense: rec.defense }, coins: { credited: rec.credited, capped: rec.capped, balance: rec.balance } }, error: null };
  };
  return api;
}
