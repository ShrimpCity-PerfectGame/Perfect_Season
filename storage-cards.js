// Cards: what the browser reads and asks for. See CARDS.md.
//
// The browser never writes a card. card_owned and card_grants have an own-rows-only select and no write policy
// (supabase/migration-cards.sql); the card-claim Edge Function and submit-run grant them. So this module is
// reads and requests: the collection, the starter deck, and since v2.24.0 the pack shop.
import { getClient } from "./storage-core.js";

// Every reason card-claim can answer with. tests/test-cards-edge.mjs reads the function's source and fails on
// one that is not here - a reason this list does not know is a rule that would read as "check your connection".
const CARD_PAGE = 1000; // PostgREST's default ceiling on one select
export const CARD_REFUSALS = ["signed_out", "no_profile", "guest_not_allowed", "cards_off", "duplicate", "malformed", "server",
  "unknown_pack", "bad_open", "unavailable", "sold_out", "not_enough"];

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
    // PAGED. PostgREST answers a select with at most 1,000 rows however many match, and a collection can hold
    // up to 3,124 cards in four finishes - so one unpaged read would silently truncate a large collection and
    // still call itself ok. Ordered, so the pages are pages of one list; the starter question rides with the first.
    const page = (from) => client.from("card_owned").select("card_id, finish, count").eq("user_id", uid)
      .order("card_id").order("finish").range(from, from + CARD_PAGE - 1);
    const [first, starter] = await Promise.all([
      page(0),
      client.from("card_grants").select("ref").eq("user_id", uid).eq("kind", "starter").limit(1),
    ]);
    if (first.error || starter.error || !Array.isArray(first.data) || !Array.isArray(starter.data)) return { status: "error" };
    const rows = first.data.slice();
    for (let from = CARD_PAGE, last = first.data; last.length === CARD_PAGE && from < CARD_PAGE * 20; from += CARD_PAGE) {
      const next = await page(from);
      // A page that fails makes the whole read a failure. Half a collection is not a collection.
      if (next.error || !Array.isArray(next.data)) return { status: "error" };
      rows.push(...next.data);
      last = next.data;
    }
    return {
      status: "ok",
      cards: rows.map((r) => ({ id: r.card_id, finish: r.finish, count: r.count })),
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
  const res = await callClaim({ action: "starter" });
  return res.ok ? { ok: true, cards: res.data.cards } : res;
}

// One request to card-claim, and the three kinds of failure told apart: { ok: true, data } or { ok: false, reason }.
async function callClaim(body) {
  const failed = (reason) => ({ ok: false, reason });
  try {
    const { data, error } = await getClient().functions.invoke("card-claim", { body });
    if (error) {
      let said = null;
      try { said = await error.context?.json?.(); } catch { said = null; }
      if (!said) return failed("offline");
      if (CARD_REFUSALS.includes(said.reason)) return failed(said.reason);
      return failed(said.reason ? "network" : "server");
    }
    if (data?.ok === true && Array.isArray(data.cards)) return { ok: true, data };
    return failed("server");
  } catch {
    return failed("offline");
  }
}

// What the pack shop is selling: { status: "ok", packs: [{ id, price, size, active, stockTotal, stockLeft }] }
// in shelf order, or { status: "error" }. Prices are public, so this works signed out. What is IN a pack is not
// here - that is card-packs.mjs, which the screen already holds.
export async function fetchPacks() {
  try {
    const { data, error } = await getClient().from("card_packs")
      .select("id, price, size, active, stock_total, stock_left, sort").order("sort").order("id");
    if (error || !Array.isArray(data)) return { status: "error" };
    return {
      status: "ok",
      packs: data.map((r) => ({ id: r.id, price: r.price, size: r.size, active: r.active === true, stockTotal: r.stock_total ?? null, stockLeft: r.stock_left ?? null })),
    };
  } catch {
    return { status: "error" };
  }
}

// An id for ONE purchase. The screen makes it when the player confirms and keeps it until the purchase is
// answered, so asking again after a dropped response re-sends the same id - and buy_pack answers a repeat with
// the cards from the first time and charges nothing. A fresh id per attempt would turn a retry into a second pack.
export function newOpenId() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* fall through */ }
  let out = "";
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

// Buy and open a pack: { ok: true, cards: [{ id, finish }], balance, stockLeft, duplicate } or { ok: false, reason }.
// "offline" and "network" mean the answer is UNKNOWN, not no: the purchase may have gone through. Ask again with
// the same openId to find out.
export async function openPack(packId, openId) {
  const res = await callClaim({ action: "open_pack", pack: packId, open: openId });
  if (!res.ok) return res;
  const d = res.data;
  if (typeof d.balance !== "number") return { ok: false, reason: "server" };
  return { ok: true, cards: d.cards, balance: d.balance, stockLeft: d.stockLeft ?? null, duplicate: d.duplicate === true };
}
