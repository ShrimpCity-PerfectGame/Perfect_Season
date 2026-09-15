// The test mock's side of supabase/migration-shop.sql (SHOP.md 3.2): shop_items seeded with the launch catalog,
// inventory, the paid packs' avatars in avatar_presets, and the functions shop_state, shop_buy, equip_item and
// set_showcase. tests/test-shop-sql.mjs runs the same calls through the real SQL and through this mock and
// requires the same results and the same rows afterwards.
//
// A database function refusing something throws new Error("<code>"), like the other mock modules. A signed-out
// caller gets not_signed_in here, where the real functions refuse the anon role outright (execute is revoked);
// storage-shop.js reads both as signed_out.
import { SHOP_ITEMS, SHOP_KINDS, AVATAR_PACKS, EQUIP_SLOTS, SHOWCASE_MAX, LAUNCH_PRICES, packItem } from "../shop-catalog.mjs";

const fail = (code) => {
  throw new Error(code);
};
const ID = /^[a-z0-9-]{1,40}$/;
// equip_item's slot -> the profile_details column it writes.
const SLOT_COLUMN = { frame: "frame", card: "card_theme", title: "title" };

// state:       tests/mock-supabase.mjs's shared state
// wallet:      tests/mock-wallet.mjs's makeWallet(state)
// profileData: tests/mock-profile-data.mjs's makeProfileData(state, ...)
export function makeShop(state, { wallet, profileData }) {
  // The seeds: sort 10, 20, 30... in catalog order within each kind.
  const items = new Map(); // id -> { id, kind, rarity, price, badge, active, sort }
  const nextSort = {};
  for (const item of SHOP_ITEMS) {
    nextSort[item.kind] = (nextSort[item.kind] || 0) + 10;
    items.set(item.id, { id: item.id, kind: item.kind, rarity: item.rarity, price: LAUNCH_PRICES[item.rarity] ?? null, badge: item.badge ?? null, active: true, sort: nextSort[item.kind] });
  }
  const inventory = new Map(); // "user_id|item_id" -> { user_id, item_id, acquired_at }
  for (const p of AVATAR_PACKS) {
    for (const preset of p.presets) profileData.tables.avatar_presets.set(preset.key, { key: preset.key, pack: p.pack, free: false });
  }

  const player = () => {
    const uid = state.currentUserId();
    if (!uid || !state.profiles.has(uid)) fail("not_signed_in");
    return uid;
  };
  // Free items are everyone's; a badge item is whoever's badge_awards has its badge; the rest need a purchase.
  const owns = (uid, item) => item.rarity === "free" || inventory.has(`${uid}|${item.id}`)
    || (item.badge != null && wallet.tables.badge_awards.has(`${uid}|${item.badge}`));
  const byShopOrder = (a, b) => SHOP_KINDS.indexOf(a.kind) - SHOP_KINDS.indexOf(b.kind) || a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const rpcs = {
    shop_state() {
      const uid = player();
      const worn = profileData.tables.profile_details.get(uid);
      return {
        balance: wallet.balanceOf(uid),
        items: [...items.values()].map((item) => ({ ...item, owned: owns(uid, item) })).filter((item) => item.active || item.owned)
          .sort(byShopOrder)
          .map(({ id, kind, rarity, price, badge, active, sort, owned }) => ({ id, kind, rarity, price, badge, active, sort, owned })),
        equipped: { frame: worn?.frame ?? null, card: worn?.card_theme ?? null, title: worn?.title ?? null, showcase: [...(worn?.showcase || [])] },
      };
    },
    shop_buy({ p_item = null } = {}) {
      const uid = player();
      // The SQL takes wallet_lock here, before reading anything else. The lock only matters between two sessions,
      // which this mock never has, and the empty wallet it may create is rolled back with any refusal - so the
      // mock reads the balance without making one, and a refusal leaves no wallet behind either way.
      const item = items.get(p_item);
      if (!item || !item.active) fail("unavailable");
      if (item.badge != null) fail("badge_only");
      if (owns(uid, item)) fail("owned");
      if (wallet.balanceOf(uid) < item.price) fail("not_enough");
      const key = `${uid}|${item.id}`;
      inventory.set(key, { user_id: uid, item_id: item.id, acquired_at: new Date().toISOString() });
      // A purchase the ledger already records, with no inventory row (rows edited by hand): the SQL refuses rather
      // than hand the item over free, and its rollback takes the inventory row back out.
      const charged = wallet.apply(uid, -(item.price ?? 0), "purchase", item.id);
      if (item.price == null || charged !== -item.price) {
        inventory.delete(key);
        fail("purchase_conflict");
      }
      return { ok: true, balance: wallet.balanceOf(uid), item: item.id };
    },
    equip_item({ p_slot = null, p_item = null } = {}) {
      const uid = player();
      if (!EQUIP_SLOTS.includes(p_slot)) fail("bad_slot");
      if (p_item != null) {
        const item = items.get(p_item);
        if (!item || item.kind !== p_slot) fail("bad_item");
        if (!owns(uid, item)) fail("not_owned");
      }
      return profileData.upsertDetails(uid, { [SLOT_COLUMN[p_slot]]: p_item ?? null });
    },
    set_showcase({ p_badges = null } = {}) {
      const uid = player();
      const ids = p_badges ?? [];
      if (!Array.isArray(ids) || ids.length > SHOWCASE_MAX || ids.some((id) => typeof id !== "string" || !ID.test(id))
        || new Set(ids).size !== ids.length) fail("bad_showcase");
      return profileData.upsertDetails(uid, { showcase: [...ids] });
    },
  };

  return {
    tables: { shop_items: items, inventory },
    rpcs,
    // set_avatar's check for a paid pack's avatar (state.ownsAvatarPack).
    ownsAvatarPack: (uid, pack) => inventory.has(`${uid}|${packItem(pack)}`),
  };
}
