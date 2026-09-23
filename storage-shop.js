// The browser's side of coins and the shop: the database functions in supabase/migration-wallet.sql and
// migration-shop.sql. Contract: SHOP.md (5.1). The app imports these from ./storage.js.
//
// Nothing here throws: a read that fails is null, a write that fails is { ok: false, reason }. Reads go out as
// GET (READ) so a dropped connection is retried; writes are POST and go out once. Coins are only ever moved by
// the database - these just ask it.
import { getClient, READ, callReason } from "./storage-core.js";
import { mapDetails } from "./storage-profile.js";

const failed = (reason) => ({ ok: false, reason });
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Your wallet and your 20 newest coin movements, newest first.
//   { balance, earned, spent, recent: [{ amount, kind, ref, createdAt }] } | null
export async function fetchWallet() {
  try {
    const { data, error } = await getClient().rpc("wallet_state", {}, READ);
    if (error || !data || typeof data !== "object") return null;
    return {
      balance: num(data.balance), earned: num(data.earned), spent: num(data.spent),
      recent: (Array.isArray(data.recent) ? data.recent : []).filter((e) => e && typeof e === "object").map((e) => ({
        amount: num(e.amount), kind: e.kind ?? null, ref: e.ref ?? null, createdAt: e.created_at ?? null,
      })),
    };
  } catch (e) {
    return null;
  }
}

// Everything on sale (and anything you own that isn't anymore), what you own and what you wear.
//   { balance, items: [{ id, kind, rarity, price, badge, active, sort, owned }], equipped: { frame, card, title, showcase } } | null
export async function fetchShop() {
  try {
    const { data, error } = await getClient().rpc("shop_state", {}, READ);
    if (error || !data || typeof data !== "object") return null;
    const worn = data.equipped && typeof data.equipped === "object" ? data.equipped : {};
    return {
      balance: num(data.balance),
      items: (Array.isArray(data.items) ? data.items : []).filter((i) => i && typeof i.id === "string").map((i) => ({
        id: i.id, kind: i.kind, rarity: i.rarity, price: i.price == null ? null : num(i.price), badge: i.badge ?? null,
        active: i.active !== false, sort: num(i.sort), owned: !!i.owned,
      })),
      equipped: {
        frame: worn.frame ?? null, card: worn.card ?? null, title: worn.title ?? null,
        showcase: Array.isArray(worn.showcase) ? worn.showcase.filter((id) => typeof id === "string") : [],
      },
    };
  } catch (e) {
    return null;
  }
}

// purchase_conflict means the ledger already records this purchase with no item to show for it - rows edited by
// hand, nothing the player did or can fix - so it's the same "didn't go through" as a failed request.
// guest_not_allowed: a guest has no profile screen to wear anything on, so the shop is refused in SQL rather
// than only hidden in the app (SHOP.md). Unmapped it reads as "network" - "check your connection" for a rule.
const BUY_REASONS = {
  not_enough: "not_enough", owned: "owned", unavailable: "unavailable", badge_only: "badge_only", not_signed_in: "signed_out",
  purchase_conflict: "network", guest_not_allowed: "guest",
};
// Buys one item with coins.
//   { ok: true, balance } | { ok: false, reason: "not_enough" | "owned" | "unavailable" | "badge_only" | "guest" | "signed_out" | "network" }
export async function buyItem(id) {
  if (typeof id !== "string" || !id) return failed("unavailable");
  try {
    const { data, error, status } = await getClient().rpc("shop_buy", { p_item: id });
    if (error) return failed(callReason(error, status, BUY_REASONS));
    return { ok: true, balance: num(data?.balance) };
  } catch (e) {
    return failed("network");
  }
}

const EQUIP_REASONS = { not_owned: "not_owned", bad_slot: "invalid", bad_item: "invalid", not_signed_in: "signed_out", guest_not_allowed: "guest" };
// Wears an item you own in its slot ("frame" | "card" | "title"), or clears the slot with a null id.
//   { ok: true, details } | { ok: false, reason: "not_owned" | "invalid" | "guest" | "signed_out" | "network" }
export async function equipItem(slot, id) {
  try {
    const { data, error, status } = await getClient().rpc("equip_item", { p_slot: slot, p_item: id ?? null });
    if (error) return failed(callReason(error, status, EQUIP_REASONS));
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    return failed("network");
  }
}

const SHOWCASE_REASONS = { bad_showcase: "invalid", not_signed_in: "signed_out", guest_not_allowed: "guest" };
// Chooses up to three badges for your card, in order.
//   { ok: true, details } | { ok: false, reason: "invalid" | "guest" | "signed_out" | "network" }
export async function setShowcase(badgeIds) {
  if (!Array.isArray(badgeIds)) return failed("invalid");
  try {
    const { data, error, status } = await getClient().rpc("set_showcase", { p_badges: badgeIds });
    if (error) return failed(callReason(error, status, SHOWCASE_REASONS));
    return { ok: true, details: mapDetails(data) };
  } catch (e) {
    return failed("network");
  }
}

const CLAIM_REASONS = { not_played: "not_played", bad_game: "invalid", bad_date: "invalid", not_signed_in: "signed_out" };
// A game day's coins for a minigame you've played: game "over_under" | "build", date the game's day in your own
// calendar ("2026-09-15" - Over/Under's date, or today for a build). credited is 0 when that day's are already claimed.
//   { ok: true, credited, balance } | { ok: false, reason: "not_played" | "invalid" | "signed_out" | "network" }
export async function claimMinigameCoins(game, date) {
  try {
    const { data, error, status } = await getClient().rpc("claim_minigame", { p_game: game, ...(date ? { p_date: date } : {}) });
    if (error) return failed(callReason(error, status, CLAIM_REASONS));
    return { ok: true, credited: num(data?.credited), balance: num(data?.balance) };
  } catch (e) {
    return failed("network");
  }
}
