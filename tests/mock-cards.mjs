// The cards' half of the Supabase mock: the two ownership tables and grant_cards, mirroring
// supabase/migration-cards.sql, and the card-claim Edge Function, mirroring supabase/functions/card-claim.
// tests/test-cards-sql.mjs runs one sequence of grants through the real SQL and through this and fails on any
// difference - every jsdom test in the suite runs on this, so a rule the database has and this does not is a
// rule no screen test ever meets.
// No Node-only import here: tests/mock-supabase.mjs is bundled into a browser page by tools/ui-harness. The
// card catalog is therefore whatever card-logic.mjs has been initialised with - tests/helpers.mjs does it for
// the jsdom suites, and in the harness the app's own loadCardData does.
import { starterDeck, CARDS } from "../card-logic.mjs";

const FINISHES = ["base", "silver", "gold", "prism"];
const KINDS = ["starter", "daily"];

// The shape functions-js hands back for a non-2xx: the reason is in the response body, reached through context.
export function cardHttpError(reason, status, message = reason) {
  return { data: null, error: { name: "FunctionsHttpError", message, context: { status, json: async () => ({ error: message, reason }) } } };
}

// state: { profiles: Map<id, { guest }>, currentUserId: () => id | null }. `enabled` is the server's own switch
// (the CARDS_ENABLED secret); tests turn it off to stand in for an environment that never had it set.
export function makeCards(state) {
  const owned = [];  // { user_id, card_id, finish, count }
  const grants = []; // { user_id, kind, ref, card_id, finish }
  const api = {
    enabled: true,
    readFails: false, // makes a client select on either table answer with an error
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
      if (!body || body.action !== "starter") return cardHttpError("malformed", 400);
      if (!api.enabled) return cardHttpError("cards_off", 403);
      const profile = state.profiles.get(uid);
      if (!profile) return cardHttpError("no_profile", 400);
      if (profile.guest) return cardHttpError("guest_not_allowed", 403);
      if (!CARDS.size) { console.error("mock-cards: card-logic.mjs has no catalog - call initCardData first"); return cardHttpError("server", 500); }
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
