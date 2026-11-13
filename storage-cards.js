// Cards: what the browser reads and asks for. See CARDS.md.
//
// The browser never writes a card. card_owned and card_grants have an own-rows-only select and no write policy
// (supabase/migration-cards.sql); the card-claim Edge Function and submit-run grant them. So this module is two
// reads and one request.
import { getClient } from "./storage-core.js";

// Every reason card-claim can answer with. tests/test-cards-edge.mjs reads the function's source and fails on
// one that is not here - a reason this list does not know is a rule that would read as "check your connection".
export const CARD_REFUSALS = ["signed_out", "no_profile", "guest_not_allowed", "cards_off", "duplicate", "malformed", "server"];

// A player's collection, and whether they have claimed their starter deck.
//   { status: "ok", cards: [{ id, finish, count }], starter: boolean }
//   { status: "signed_out" }
//   { status: "error" }
// THREE answers, and the third matters most: a read that failed is not an empty collection. Collapsing the two
// would show a player who owns fifty cards an invitation to open a starter deck they opened last week.
export async function fetchMyCards() {
  try {
    const client = getClient();
    const { data: sessionData } = await client.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) return { status: "signed_out" };
    const [owned, starter] = await Promise.all([
      client.from("card_owned").select("card_id, finish, count").eq("user_id", uid),
      client.from("card_grants").select("ref").eq("user_id", uid).eq("kind", "starter").limit(1),
    ]);
    if (owned.error || starter.error || !Array.isArray(owned.data) || !Array.isArray(starter.data)) return { status: "error" };
    return {
      status: "ok",
      cards: owned.data.map((r) => ({ id: r.card_id, finish: r.finish, count: r.count })),
      starter: starter.data.length > 0,
    };
  } catch {
    return { status: "error" };
  }
}

// Claim the starter deck: { ok: true, cards: [{ id, finish }] } or { ok: false, reason }.
// A reason is one of CARD_REFUSALS, or - when the function was never reached or its answer cannot be read -
// "offline" (nothing came back) or "network" (something did, and it names no reason this client knows).
export async function claimStarter() {
  const failed = (reason) => ({ ok: false, reason });
  try {
    const { data, error } = await getClient().functions.invoke("card-claim", { body: { action: "starter" } });
    if (error) {
      let body = null;
      try { body = await error.context?.json?.(); } catch { body = null; }
      if (!body) return failed("offline");
      if (CARD_REFUSALS.includes(body.reason)) return failed(body.reason);
      return failed(body.reason ? "network" : "server");
    }
    if (data?.ok === true && Array.isArray(data.cards)) return { ok: true, cards: data.cards };
    return failed("server");
  } catch {
    return failed("offline");
  }
}
