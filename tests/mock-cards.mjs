// The cards' half of the Supabase mock: the two ownership tables and grant_cards, mirroring
// supabase/migration-cards.sql, and the card-claim Edge Function, mirroring supabase/functions/card-claim.
// tests/test-cards-sql.mjs runs one sequence of grants through the real SQL and through this and fails on any
// difference - every jsdom test in the suite runs on this, so a rule the database has and this does not is a
// rule no screen test ever meets.
// No Node-only import here: tests/mock-supabase.mjs is bundled into a browser page by tools/ui-harness. The
// card catalog is therefore whatever card-logic.mjs has been initialised with - tests/helpers.mjs does it for
// the jsdom suites, and in the harness the app's own loadCardData does.
import { starterDeck, CARDS } from "../card-logic.mjs";
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
  const api = {
    enabled: true,
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
          .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)).map((g) => ({ card: g.card_id, finish: g.finish }));
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
      api.grantCards(userId, "pack", cards.map((c, i) => ({ ref: `${open}:${i}`, card: c.card, finish: c.finish })));
      return { duplicate: false, cards: cards.map((c) => ({ card: c.card, finish: c.finish })), balance: wallet.balanceOf(userId), stock_left: pack.stock_left, price: pack.price };
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
      }
      const granted = [];
      for (const e of list) {
        if (grants.some((g) => g.user_id === userId && g.kind === kind && g.ref === e.ref)) continue;
        grants.push({ user_id: userId, kind, ref: e.ref, card_id: e.card, finish: e.finish });
        const row = owned.find((o) => o.user_id === userId && o.card_id === e.card && o.finish === e.finish);
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
      for (const list of [owned, grants]) for (let i = list.length - 1; i >= 0; i--) if (list[i].user_id === userId) list.splice(i, 1);
    },
    clear() { owned.length = 0; grants.length = 0; },

    // supabase/functions/card-claim, answer for answer and in its order.
    async claimStarter(body) {
      const uid = state.currentUserId();
      if (!uid) return cardHttpError("signed_out", 401);
      if (!body || (body.action !== "starter" && body.action !== "open_pack")) return cardHttpError("malformed", 400);
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
        try { bought = api.buyPack(uid, pack.id, body.open, pulled.map((c) => ({ card: c.id, finish: c.finish })), body.price); }
        catch (e) {
          const status = { unavailable: 409, sold_out: 409, price_changed: 409, not_enough: 409, bad_open: 400, no_profile: 400, guest_not_allowed: 403 }[e?.message];
          return status ? cardHttpError(e.message, status) : cardHttpError("server", 500);
        }
        if (api.openFails) { api.openFails = false; return { data: null, error: { name: "FunctionsFetchError", message: "Failed to send" } }; }
        return { data: { ok: true, cards: bought.cards.map((c) => ({ id: c.card, finish: c.finish })), balance: bought.balance, stockLeft: bought.stock_left ?? null, duplicate: bought.duplicate }, error: null };
      }
      const deck = starterDeck(Math.random);
      let res;
      try { res = api.grantCards(uid, "starter", deck.map((c, i) => ({ ref: `starter:${i}`, card: c.id, finish: c.finish }))); }
      catch { return cardHttpError("server", 500); }
      if (res.duplicate) return cardHttpError("duplicate", 409);
      return { data: { ok: true, cards: res.granted.map((g) => ({ id: g.card, finish: g.finish })) }, error: null };
    },
  };
  return api;
}
