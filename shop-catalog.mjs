// The shop's catalog as the browser knows it: every item's id, kind and name, and the avatar packs.
// Contract: SHOP.md (6.2). Pure, so the screens, the Edge Function and the tests can all import it.
//
// Names and looks live here and in cosmetics.jsx; price, rarity and what's on sale live in the database's
// shop_items rows (supabase/migration-shop.sql), where the owner can change them with SQL. The shop shows
// the server's rarity and price - `rarity` here is only the launch value, for the harness and the seed
// check in tests/test-shop-sql.mjs, which fails if this file and the seeds disagree.

export const SHOP_KINDS = ["frame", "card", "title", "avatar_pack"];
export const KIND_LABEL = { frame: "Frames", card: "Card themes", title: "Titles", avatar_pack: "Avatar packs" };
// Each equip slot takes items of its own kind. Avatar packs aren't equipped: owning one unlocks its avatars
// in the picture picker.
export const EQUIP_SLOTS = ["frame", "card", "title"];
// What an empty slot shows. Null in profile_details means this.
export const DEFAULT_ITEM = { frame: "frame-ink", card: "card-navy", title: null };

export const RARITIES = ["free", "common", "rare", "epic", "legendary", "badge"];
export const RARITY_LABEL = { free: "Free", common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", badge: "Badge reward" };

// How many badges the showcase holds.
export const SHOWCASE_MAX = 3;

export const AVATAR_PACKS = [
  {
    pack: "sideline", item: "pack-sideline", name: "Sideline",
    presets: [
      { key: "headset", name: "Headset" }, { key: "cooler", name: "Water cooler" },
      { key: "pylon", name: "Pylon" }, { key: "penalty-flag", name: "Penalty flag" },
    ],
  },
  {
    pack: "trophy-room", item: "pack-trophy-room", name: "Trophy room",
    presets: [
      { key: "title-ring", name: "Title ring" }, { key: "medal", name: "Medal" },
      { key: "banner", name: "Banner" }, { key: "game-ball", name: "Game ball" },
    ],
  },
  {
    pack: "night-game", item: "pack-night-game", name: "Night game",
    presets: [
      { key: "floodlights", name: "Floodlights" }, { key: "scoreboard", name: "Scoreboard" },
      { key: "fireworks", name: "Fireworks" }, { key: "blimp", name: "Blimp" },
    ],
  },
];
export const packItem = (pack) => `pack-${pack}`;
export const PACK_BY_ITEM = Object.fromEntries(AVATAR_PACKS.map((p) => [p.item, p]));

// The launch catalog, in shop order within each kind (the seeds' sort is 10, 20, 30... in this order).
// `badge` is the badges.mjs id that unlocks a badge item.
export const SHOP_ITEMS = [
  { id: "frame-ink", kind: "frame", name: "Ink", rarity: "free" },
  { id: "frame-lime", kind: "frame", name: "Lime", rarity: "common" },
  { id: "frame-team", kind: "frame", name: "Team colors", rarity: "rare" },
  { id: "frame-gold", kind: "frame", name: "Gold", rarity: "epic" },
  { id: "frame-flame", kind: "frame", name: "Flame", rarity: "legendary" },
  { id: "frame-undefeated", kind: "frame", name: "Undefeated", rarity: "badge", badge: "undefeated" },

  { id: "card-navy", kind: "card", name: "Navy", rarity: "free" },
  { id: "card-night", kind: "card", name: "Night", rarity: "common" },
  { id: "card-turf", kind: "card", name: "Turf", rarity: "rare" },
  { id: "card-team", kind: "card", name: "Team colors", rarity: "rare" },
  { id: "card-ticket", kind: "card", name: "Ticket stub", rarity: "epic" },
  { id: "card-gold-foil", kind: "card", name: "Gold foil", rarity: "legendary" },
  { id: "card-dynasty", kind: "card", name: "Dynasty", rarity: "badge", badge: "dynasty" },

  { id: "title-film-room", kind: "title", name: "Film Room", rarity: "common" },
  { id: "title-waiver-hawk", kind: "title", name: "Waiver Hawk", rarity: "common" },
  { id: "title-draft-guru", kind: "title", name: "Draft Guru", rarity: "rare" },
  { id: "title-cap-wizard", kind: "title", name: "Cap Wizard", rarity: "rare" },
  { id: "title-undefeated", kind: "title", name: "Undefeated", rarity: "badge", badge: "undefeated" },
  { id: "title-daily-winner", kind: "title", name: "Daily Winner", rarity: "badge", badge: "daily-winner" },
  { id: "title-cinderella", kind: "title", name: "Cinderella", rarity: "badge", badge: "cinderella" },

  ...AVATAR_PACKS.map((p, i) => ({ id: p.item, kind: "avatar_pack", name: p.name, rarity: ["common", "rare", "epic"][i] })),
].map((item) => ({ badge: null, ...item }));
export const SHOP_ITEM_BY_ID = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));

// The prices migration-shop.sql seeds, by launch rarity. Only the seeds and the test mock use these; the shop
// shows whatever price the database has.
export const LAUNCH_PRICES = { common: 750, rare: 2000, epic: 6000, legendary: 15000 };
