// The shop's catalog as the browser knows it: every item's id, kind and name, and the avatar packs.
// Contract: SHOP.md (6.2). Pure, so the screens, the Edge Function and the tests can all import it.
//
// Names and looks live here and in cosmetics.jsx; price, rarity and what's on sale live in the database's
// shop_items rows (supabase/migration-shop.sql), where the owner can change them with SQL. The shop shows
// the server's rarity and price - `rarity` here is only the launch value, for the harness and the seed
// check in tests/test-shop-sql.mjs, which fails if this file and the seeds disagree.

export const SHOP_KINDS = ["frame", "card", "title", "nameplate", "namecolor", "celebration", "avatar_pack"];
export const KIND_LABEL = { frame: "Frames", card: "Card themes", title: "Titles", nameplate: "Nameplates", namecolor: "Name colors", celebration: "Win celebrations", avatar_pack: "Avatar packs" };
// Each equip slot takes items of its own kind. Avatar packs aren't equipped: owning one unlocks its avatars
// in the picture picker.
export const EQUIP_SLOTS = ["frame", "card", "title", "nameplate", "namecolor", "celebration"];
// What an empty slot shows. Null in profile_details means this.
// A null nameplate is no plate at all - the name as it has always looked - rather than a default one, so
// nobody is given a banner they did not choose. A null namecolor is the same: the name in the scope's own ink,
// which is what every account has always had and what every account without this keeps.
export const DEFAULT_ITEM = { frame: "frame-ink", card: "card-navy", title: null, nameplate: null, namecolor: null, celebration: "cel-confetti" };

// "badge" is earned by playing and "supporter" comes with the one-off unlock; neither is bought with coins.
// They are deliberately parallel rather than a ladder: a supporter item is DIFFERENT, not better, because the
// best thing in the game should still belong to somebody who has gone 20-0.
export const RARITIES = ["free", "common", "rare", "epic", "legendary", "badge", "supporter"];
export const RARITY_LABEL = { free: "Free", common: "Common", rare: "Rare", epic: "Epic", legendary: "Legendary", badge: "Badge reward", supporter: "Supporter" };

// How many badges the showcase holds.
export const SHOWCASE_MAX = 3;

// `rarity` is the pack's launch rarity, like SHOP_ITEMS' below.
export const AVATAR_PACKS = [
  {
    pack: "sideline", item: "pack-sideline", name: "Sideline", rarity: "common",
    presets: [
      { key: "headset", name: "Headset" }, { key: "cooler", name: "Water cooler" },
      { key: "pylon", name: "Pylon" }, { key: "penalty-flag", name: "Penalty flag" },
    ],
  },
  {
    pack: "trophy-room", item: "pack-trophy-room", name: "Trophy room", rarity: "rare",
    presets: [
      { key: "title-ring", name: "Title ring" }, { key: "medal", name: "Medal" },
      { key: "banner", name: "Banner" }, { key: "game-ball", name: "Game ball" },
    ],
  },
  {
    pack: "night-game", item: "pack-night-game", name: "Night game", rarity: "epic",
    presets: [
      { key: "floodlights", name: "Floodlights" }, { key: "scoreboard", name: "Scoreboard" },
      { key: "fireworks", name: "Fireworks" }, { key: "blimp", name: "Blimp" },
    ],
  },
  // v1.13.0
  {
    pack: "draft-day", item: "pack-draft-day", name: "Draft day", rarity: "legendary",
    presets: [
      { key: "podium", name: "Podium" }, { key: "draft-card", name: "Draft card" },
      { key: "the-call", name: "The call" }, { key: "draft-cap", name: "Draft cap" },
    ],
  },
  {
    pack: "hall-of-fame", item: "pack-hall-of-fame", name: "Hall of Fame", rarity: "legendary",
    presets: [
      { key: "gold-jacket", name: "Gold jacket" }, { key: "bust", name: "Bust" },
      { key: "laurels", name: "Laurels" }, { key: "the-hall", name: "The Hall" },
    ],
  },
  // v2.8.0. The supporter pack, and the only one that is not bought: it comes with the unlock, like Aurora and
  // Nebula. Football seen from a long way off, which is what lets it share the cosmic line the rest of the
  // supporter items are in without becoming a set of space stickers in a football game.
  {
    pack: "stargazer", item: "pack-stargazer", name: "Stargazer", rarity: "supporter",
    presets: [
      { key: "comet", name: "Comet" }, { key: "moonlight", name: "Moonlight" },
      { key: "constellation", name: "Constellation" }, { key: "satellite", name: "Satellite" },
    ],
  },
];
export const packItem = (pack) => `pack-${pack}`;
export const PACK_BY_ITEM = Object.fromEntries(AVATAR_PACKS.map((p) => [p.item, p]));

// The catalog, in shop order within each kind (the seeds' sort is 10, 20, 30... in this order).
// `badge` is the badges.mjs id that unlocks a badge item.
export const SHOP_ITEMS = [
  { id: "frame-ink", kind: "frame", name: "Ink", rarity: "free" },
  { id: "frame-lime", kind: "frame", name: "Lime", rarity: "common" },
  { id: "frame-team", kind: "frame", name: "Team colors", rarity: "rare" },
  { id: "frame-gold", kind: "frame", name: "Gold", rarity: "epic" },
  { id: "frame-flame", kind: "frame", name: "Flame", rarity: "legendary" },
  { id: "frame-undefeated", kind: "frame", name: "Undefeated", rarity: "badge", badge: "undefeated" },
  { id: "frame-orbit", kind: "frame", name: "Orbit", rarity: "supporter" },

  { id: "card-navy", kind: "card", name: "Navy", rarity: "free" },
  { id: "card-night", kind: "card", name: "Night", rarity: "common" },
  { id: "card-turf", kind: "card", name: "Turf", rarity: "rare" },
  { id: "card-team", kind: "card", name: "Team colors", rarity: "rare" },
  { id: "card-ticket", kind: "card", name: "Ticket stub", rarity: "epic" },
  { id: "card-gold-foil", kind: "card", name: "Gold foil", rarity: "legendary" },
  { id: "card-dynasty", kind: "card", name: "Dynasty", rarity: "badge", badge: "dynasty" },
  { id: "card-cosmos", kind: "card", name: "Cosmos", rarity: "supporter" },

  { id: "title-film-room", kind: "title", name: "Film Room", rarity: "common" },
  { id: "title-waiver-hawk", kind: "title", name: "Waiver Hawk", rarity: "common" },
  { id: "title-draft-guru", kind: "title", name: "Draft Guru", rarity: "rare" },
  { id: "title-cap-wizard", kind: "title", name: "Cap Wizard", rarity: "rare" },
  // v1.13.0, ahead of the badge titles (migration-shop.sql moves those back on a database seeded before)
  { id: "title-war-room", kind: "title", name: "War Room", rarity: "epic" },
  { id: "title-sleeper-agent", kind: "title", name: "Sleeper Agent", rarity: "epic" },
  { id: "title-first-overall", kind: "title", name: "First Overall", rarity: "legendary" },
  { id: "title-the-goat", kind: "title", name: "The GOAT", rarity: "legendary" },
  { id: "title-undefeated", kind: "title", name: "Undefeated", rarity: "badge", badge: "undefeated" },
  { id: "title-daily-winner", kind: "title", name: "Daily Winner", rarity: "badge", badge: "daily-winner" },
  { id: "title-cinderella", kind: "title", name: "Cinderella", rarity: "badge", badge: "cinderella" },
  { id: "title-supporter", kind: "title", name: "Supporter", rarity: "supporter" },


  // Win celebrations: an overlay that plays over the result screen when a season wins the title. Confetti is
  // free and the default, so every player has one - an empty celebration slot would be the only equip slot
  // that shows nothing, and the moment is the point of the mode.
  // Nameplates: a banner behind the name on the player card. Each carries its OWN text colour rather than
  // taking the card's, because the card underneath can be any of three scopes - see NAMEPLATES in cosmetics.jsx,
  // where the pair is held to AA.
  { id: "plate-ink", kind: "nameplate", name: "Ink", rarity: "free" },
  { id: "plate-lime", kind: "nameplate", name: "Lime", rarity: "common" },
  { id: "plate-turf", kind: "nameplate", name: "Turf", rarity: "rare" },
  { id: "plate-blue", kind: "nameplate", name: "Game blue", rarity: "rare" },
  { id: "plate-midnight", kind: "nameplate", name: "Midnight", rarity: "rare" },
  { id: "plate-gold", kind: "nameplate", name: "Gold", rarity: "epic" },
  { id: "plate-inferno", kind: "nameplate", name: "Inferno", rarity: "epic" },
  { id: "plate-ember", kind: "nameplate", name: "Ember", rarity: "legendary" },
  { id: "plate-emerald", kind: "nameplate", name: "Emerald", rarity: "legendary" },
  { id: "plate-dynasty", kind: "nameplate", name: "Dynasty", rarity: "badge", badge: "dynasty" },
  { id: "plate-aurora", kind: "nameplate", name: "Aurora", rarity: "supporter" },

  // Name colours: the name itself, on the boards. Nine looks, six of them drifting a gradient. Each is three
  // palettes rather than one colour (NAME_LOOKS in cosmetics.jsx) because the surface behind a name is the
  // page - cream on Stats, true black on the Leaderboard - and no one colour is readable on both.
  { id: "name-blue", kind: "namecolor", name: "Game blue", rarity: "common" },
  { id: "name-ember", kind: "namecolor", name: "Ember", rarity: "common" },
  { id: "name-toxic", kind: "namecolor", name: "Toxic", rarity: "rare" },
  { id: "name-vapor", kind: "namecolor", name: "Vaporwave", rarity: "rare" },
  { id: "name-flame", kind: "namecolor", name: "Flame", rarity: "epic" },
  { id: "name-frost", kind: "namecolor", name: "Frost", rarity: "epic" },
  { id: "name-prism", kind: "namecolor", name: "Prism", rarity: "legendary" },
  // The fourth item on the undefeated badge, and the loudest: a gold name on every board you appear on.
  { id: "name-trophy", kind: "namecolor", name: "Undefeated", rarity: "badge", badge: "undefeated" },
  { id: "name-nebula", kind: "namecolor", name: "Nebula", rarity: "supporter" },

  { id: "cel-confetti", kind: "celebration", name: "Confetti", rarity: "free" },
  { id: "cel-spotlight", kind: "celebration", name: "Spotlight", rarity: "common" },
  { id: "cel-fireworks", kind: "celebration", name: "Fireworks", rarity: "rare" },
  { id: "cel-gold-rain", kind: "celebration", name: "Gold rain", rarity: "epic" },
  // Earned, not bought, like the frame and title that share its badge: the best celebration in the game
  // belongs to somebody who has gone 20-0, which is 4.5% of finished seasons.
  { id: "cel-champion", kind: "celebration", name: "Champion", rarity: "badge", badge: "undefeated" },
  { id: "cel-supernova", kind: "celebration", name: "Supernova", rarity: "supporter" },
  ...AVATAR_PACKS.map((p) => ({ id: p.item, kind: "avatar_pack", name: p.name, rarity: p.rarity })),
].map((item) => ({ badge: null, ...item }));
export const SHOP_ITEM_BY_ID = Object.fromEntries(SHOP_ITEMS.map((item) => [item.id, item]));

// The prices migration-shop.sql seeds, by launch rarity. Only the seeds and the test mock use these; the shop
// shows whatever price the database has.
export const LAUNCH_PRICES = { common: 750, rare: 2000, epic: 6000, legendary: 15000 };
