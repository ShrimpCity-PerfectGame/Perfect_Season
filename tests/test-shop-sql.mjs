// The shop's data layer (SHOP.md 3.2, 5.1, 6.2): supabase/migration-shop.sql's catalog and functions, and
// set_avatar's paid packs (migration-profiles.sql), in real Postgres (PGlite, set up like a Supabase project by
// tests/pg-fixture.mjs); the test mock that mirrors them (tests/mock-shop.mjs, with mock-wallet.mjs and
// mock-profile-data.mjs); and storage-shop.js. Checks:
//   - the seeds are shop-catalog.mjs's launch catalog, and the paid avatars its packs;
//   - clients read shop_items but can't write it, and can't read or write inventory or put an item on directly;
//   - every function's answers and refusals, in SHOP.md's order: buying at exactly the price, what a purchase
//     writes, free, owned, off-sale and badge items, the slots, the showcase;
//   - set_avatar's paid packs, with the shop and in a database without it;
//   - the wallet lock comes before a purchase reads ownership or the balance, and what backs it up;
//   - running the migrations again is harmless and keeps what was changed with SQL;
//   - the mock gives the SQL's answers for one list of calls and ends with the same rows;
//   - storage-shop.js turns every code the functions raise into its reason, and never throws.
//
// Coins are given explicitly (wallet_apply, as the owner) and balances are checked against the balance read before
// each action, so this passes whether or not new accounts start with welcome coins. PGlite is one connection, so
// two purchases can't really race here: the lock's place is shown by swapping in a wallet_lock that raises, and the
// constraints behind it are checked directly. That the second of two racing purchases then reads the first one's
// rows rests on reading the SQL (READ COMMITTED: each statement of a volatile function sees what committed before it).
import { assert, runTest } from "./helpers.mjs";
import { freshDb, addAccount, asUser, asAnon, failure, uuid, sql, PROFILE_MIGRATIONS } from "./pg-fixture.mjs";
import { makeProfileData } from "./mock-profile-data.mjs";
import { playerStats } from "./mock-profile-stats.mjs";
import { makeWallet } from "./mock-wallet.mjs";
import { makeShop } from "./mock-shop.mjs";
import {
  SHOP_ITEMS, SHOP_KINDS, EQUIP_SLOTS, DEFAULT_ITEM, RARITIES, SHOWCASE_MAX, AVATAR_PACKS, PACK_BY_ITEM, LAUNCH_PRICES, packItem,
} from "../shop-catalog.mjs";
import { FREE_AVATAR_PRESETS } from "../profile-rules.mjs";
import { BADGES, BADGE_BY_ID } from "../badges.mjs";

// Sorted keys, so JSON from Postgres and from the mock compare equal whatever order their keys come in.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = (v) => JSON.stringify(v)?.slice(0, 400);
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Shop order (SHOP.md 3.2): kind, then sort, then id in code-point order.
const shopOrder = (a, b) => SHOP_KINDS.indexOf(a.kind) - SHOP_KINDS.indexOf(b.kind) || a.sort - b.sort || byCode(a.id, b.id);
const ITEM_KEYS = ["active", "badge", "id", "kind", "owned", "price", "rarity", "sort"];
// A profile_details row's columns, as to_jsonb gives them.
const DETAILS_COLUMNS = ["avatar_path", "avatar_preset", "bio", "card_theme", "favorite_team", "frame", "showcase", "title", "updated_at", "user_id"];
const NOTHING_WORN = { frame: null, card: null, title: null, showcase: [] };
const SHOWCASE_ID = /^[a-z0-9-]{1,40}$/;
// The launch seeds as shop-catalog.mjs describes them: prices by rarity, sort 10, 20, 30... per kind in catalog order.
function catalogSeeds() {
  const next = {};
  return SHOP_ITEMS.map((i) => {
    next[i.kind] = (next[i.kind] || 0) + 10;
    return { id: i.id, kind: i.kind, rarity: i.rarity, price: LAUNCH_PRICES[i.rarity] ?? null, badge: i.badge, active: true, sort: next[i.kind] };
  }).sort(shopOrder);
}
const seedOf = (id) => catalogSeeds().find((i) => i.id === id);
const priceOf = (id) => seedOf(id).price;
// No test buys or wears this one, so the re-run test can delete it and watch the seed put it back.
const UNTOUCHED = "title-draft-guru";

const db = await freshDb();
const owner = async (statement, params) => (await db.query(statement, params)).rows;
// One statement as a player (their id) or signed out (null): { rows, affected } or { error }.
async function attempt(who, statement, params = []) {
  const run = async () => {
    try {
      const r = await db.query(statement, params);
      return { rows: r.rows, affected: r.affectedRows ?? 0 };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  };
  return who ? asUser(db, who, run) : asAnon(db, run);
}
// One database function call with named arguments: { data } or { error: "<message>" }.
async function call(who, fn, args = {}) {
  const names = Object.keys(args);
  const res = await attempt(who, `select ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, names.map((n) => args[n]));
  return res.error ? { error: res.error } : { data: res.rows[0].r };
}

let accounts = 0;
async function newPlayer(name) {
  const id = uuid(100 + ++accounts);
  await addAccount(db, { id, username: `${name}_${accounts}` });
  return id;
}
let topUps = 0;
const balanceOf = async (uid) => Number((await owner("select balance from wallets where user_id = $1", [uid]))[0]?.balance ?? 0);
// Coins for a test, moved the way a season pays them.
const give = (uid, coins) => owner("select wallet_apply($1, $2, 'season', $3)", [uid, coins, `TEST-${++topUps}`]);
// Exactly `target` coins, for the not_enough boundary. Targets here are above any welcome balance.
async function fundTo(uid, target) {
  const now = await balanceOf(uid);
  assert(now <= target, `the fixture needs a balance of at most ${target} to start from, got ${now}`);
  if (now < target) await give(uid, target - now);
  assert((await balanceOf(uid)) === target, `the balance should now be ${target}`);
}
// Everything of a player's a purchase could change.
async function holdings(uid) {
  const [w] = await owner("select balance, earned, spent from wallets where user_id = $1", [uid]);
  return {
    wallet: w ? { balance: Number(w.balance), earned: Number(w.earned), spent: Number(w.spent) } : null,
    ledger: (await owner("select amount, kind, ref from wallet_ledger where user_id = $1 order by id", [uid])).map((l) => ({ ...l, amount: Number(l.amount) })),
    inventory: (await owner(`select item_id from inventory where user_id = $1 order by item_id collate "C"`, [uid])).map((r) => r.item_id),
  };
}
const detailsOf = async (uid) => (await owner("select to_jsonb(d) as d from profile_details d where user_id = $1", [uid]))[0]?.d ?? null;
const itemOf = (shop, id) => shop.items.find((i) => i.id === id);
const stripTime = (d) => (d ? { ...d, updated_at: null } : d);

// The mock modules wired the way tests/mock-supabase.mjs wires them, around a state this test controls.
function mockWorld() {
  let current = null;
  const state = {
    profiles: new Map(), runs: new Map(), dailyRuns: new Map(), souRuns: new Map(), builds: new Map(),
    currentUserId: () => current, isModerator: () => false, ownsAvatarPack: () => false,
  };
  const profileData = makeProfileData(state, { playerStats });
  const wallet = makeWallet(state);
  const shop = makeShop(state, { wallet, profileData });
  state.ownsAvatarPack = shop.ownsAvatarPack;
  const rpcs = { ...profileData.rpcs, ...shop.rpcs };
  const mockCall = (who, fn, args = {}) => {
    current = who;
    try {
      return { data: rpcs[fn](args) };
    } catch (e) {
      // A refusal is its code; anything else is a bug in the mock and shouldn't read as an answer.
      if (!/^[a-z_]+$/.test(e?.message || "")) throw e;
      return { error: e.message };
    } finally {
      current = null;
    }
  };
  return { state, tables: { ...profileData.tables, ...wallet.tables, ...shop.tables }, call: mockCall };
}

// ---------- The catalog ----------

await runTest("the seeds are shop-catalog.mjs's launch catalog (ids, kinds, rarities, badges, prices, sort), the paid avatars are its packs, and the mock seeds the same", async () => {
  const rows = await owner("select id, kind, rarity, price, badge, active, sort from shop_items");
  const want = catalogSeeds();
  assert(same([...rows].sort(shopOrder), want), `shop_items should be the launch catalog:\n sql  ${show([...rows].sort(shopOrder))}\n want ${show(want)}`);
  assert(rows.length === SHOP_ITEMS.length && new Set(rows.map((r) => r.id)).size === rows.length, "one row per catalog item");

  // What the functions and the screens take for granted about the catalog.
  assert(same([...new Set(SHOP_ITEMS.map((i) => i.kind))].sort(), [...SHOP_KINDS].sort()), "every kind has items, and only those kinds");
  for (const i of SHOP_ITEMS) {
    assert(RARITIES.includes(i.rarity), `${i.id}'s rarity ${i.rarity} is a known one`);
    if (i.rarity === "badge") assert(BADGE_BY_ID[i.badge], `${i.id} unlocks with a real badges.mjs badge, not ${i.badge}`);
    else assert(i.badge === null, `${i.id} has no badge`);
    if (i.rarity !== "free" && i.rarity !== "badge") assert(Number.isInteger(LAUNCH_PRICES[i.rarity]) && LAUNCH_PRICES[i.rarity] > 0, `${i.rarity} has a launch price`);
  }
  for (const slot of EQUIP_SLOTS) {
    assert(SHOP_KINDS.includes(slot), `the ${slot} slot takes the kind of the same name`);
    if (DEFAULT_ITEM[slot]) assert(want.some((i) => i.id === DEFAULT_ITEM[slot] && i.kind === slot && i.rarity === "free"), `the default ${slot}, ${DEFAULT_ITEM[slot]}, is a free ${slot}`);
  }
  assert(BADGES.every((b) => SHOWCASE_ID.test(b.id)), "every badge id fits the showcase's id rule, so any earned badge can be shown");

  const presets = await owner(`select key, pack, free from avatar_presets where pack <> 'starter' order by key collate "C"`);
  const wantPresets = AVATAR_PACKS.flatMap((p) => p.presets.map((s) => ({ key: s.key, pack: p.pack, free: false }))).sort((a, b) => byCode(a.key, b.key));
  assert(same(presets, wantPresets), `the paid avatars should be AVATAR_PACKS':\n sql  ${show(presets)}\n want ${show(wantPresets)}`);
  // A pack avatar with a starter key would turn that free avatar into a paid one (the seed updates on conflict).
  const starter = new Set(FREE_AVATAR_PRESETS.map((p) => p.key));
  assert(wantPresets.every((p) => !starter.has(p.key)), "no pack avatar reuses a starter avatar's key");
  const free = await owner("select key from avatar_presets where free");
  assert(same(free.map((r) => r.key).sort(), [...starter].sort()), "the starter avatars are still exactly the free ones");
  for (const p of AVATAR_PACKS) {
    assert(p.item === packItem(p.pack) && PACK_BY_ITEM[p.item] === p, `${p.pack}'s item is ${packItem(p.pack)}`);
    assert(want.some((i) => i.id === p.item && i.kind === "avatar_pack"), `${p.item} is sold as an avatar pack`);
  }
  assert(want.filter((i) => i.kind === "avatar_pack").length === AVATAR_PACKS.length, "every avatar_pack item is one of the packs");

  const mock = mockWorld();
  assert(same([...mock.tables.shop_items.values()].sort(shopOrder), want), `the mock seeds the same shop_items, got ${show([...mock.tables.shop_items.values()])}`);
  const mockPresets = [...mock.tables.avatar_presets.values()].filter((p) => p.pack !== "starter").sort((a, b) => byCode(a.key, b.key));
  assert(same(mockPresets, presets), `the mock seeds the same paid avatars, got ${show(mockPresets)}`);
});

// ---------- Who can do what ----------

await runTest("clients read shop_items but can't write it, can't read or write inventory, and can't put an item on without the functions", async () => {
  const P = await newPlayer("rls");
  await give(P, 10000);
  assert(!(await call(P, "shop_buy", { p_item: "frame-gold" })).error, "the player buys a frame");
  assert(!(await call(P, "save_profile", { p_bio: "Mine", p_favorite_team: null })).error, "and has a details row");
  const before = { items: await owner("select * from shop_items order by id"), mine: await holdings(P), details: await detailsOf(P) };
  for (const who of [null, P]) {
    const label = who ? "a signed-in player" : "a signed-out visitor";
    const items = await attempt(who, "select id, kind, rarity, price, badge, active, sort from shop_items");
    assert(items.rows?.length === before.items.length, `${label} reads every shop item, got ${show(items)}`);
    for (const statement of [
      "insert into shop_items (id, kind, rarity, price) values ('forged', 'frame', 'common', 1)",
      "insert into shop_items (id, kind, rarity, price) values ('frame-flame', 'frame', 'common', 1) on conflict (id) do update set price = 1",
      "update shop_items set price = 1",
      "update shop_items set active = true, price = 1, rarity = 'free' where id = 'frame-flame'",
      "delete from shop_items",
    ]) {
      const r = await attempt(who, statement);
      assert(r.error ? /row-level security|permission denied/.test(r.error) : r.affected === 0, `${label}: "${statement}" should change nothing, got ${show(r)}`);
    }
    for (const [statement, params] of [
      ["select * from inventory", []],
      ["select count(*) from inventory where user_id = $1", [P]],
      ["insert into inventory (user_id, item_id) values ($1, 'frame-flame')", [P]],
      ["update inventory set item_id = 'frame-flame' where user_id = $1", [P]],
      ["delete from inventory where user_id = $1", [P]],
    ]) {
      const r = await attempt(who, statement, params);
      assert(/permission denied for table inventory/.test(r.error || ""), `${label}: "${statement}" is refused outright, got ${show(r)}`);
    }
    // What you wear changes only through equip_item and set_showcase, which check ownership and the showcase's shape.
    for (const [statement, params] of [
      ["insert into profile_details (user_id, frame) values ($1, 'frame-flame')", [P]],
      ["insert into profile_details (user_id, frame) values ($1, 'frame-flame') on conflict (user_id) do update set frame = excluded.frame", [P]],
      ["update profile_details set frame = 'frame-flame', card_theme = 'card-gold-foil', title = 'title-cinderella' where user_id = $1", [P]],
      ["update profile_details set showcase = '{undefeated,dynasty,cinderella}'", []],
    ]) {
      const r = await attempt(who, statement, params);
      assert(r.error ? /row-level security|permission denied/.test(r.error) : r.affected === 0, `${label}: "${statement}" should change nothing, got ${show(r)}`);
    }
  }
  assert(same(await owner("select * from shop_items order by id"), before.items), "shop_items is untouched");
  assert(same(await holdings(P), before.mine), "the player's wallet, ledger and inventory are untouched");
  assert(same(await detailsOf(P), before.details), "and nothing was put on");
});

await runTest("the four functions: security definer with pg_temp last, for signed-in players only, shop_state stable - and not_signed_in comes first", async () => {
  const rows = await owner(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, p.prosecdef as definer, p.provolatile as volatility,
      (select substr(c, 13) from unnest(p.proconfig) c where c like 'search_path=%') as search_path,
      (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as public_execute,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('shop_state', 'shop_buy', 'equip_item', 'set_showcase') order by 1`);
  // The argument names are the ones storage-shop.js sends.
  const volatility = { "equip_item(p_slot text, p_item text)": "v", "set_showcase(p_badges text[])": "v", "shop_buy(p_item text)": "v", "shop_state()": "s" };
  assert(same(rows.map((r) => r.sig), Object.keys(volatility)), `one of each, with these arguments: ${show(rows.map((r) => r.sig))}`);
  for (const r of rows) {
    assert(r.definer === true && r.search_path === "public, pg_temp", `${r.sig} is security definer with search_path public, pg_temp: ${show(r)}`);
    assert(r.volatility === volatility[r.sig], `${r.sig} volatility ${r.volatility}`);
    assert(r.public_execute === false && r.anon === false && r.authenticated === true, `${r.sig} is executable by authenticated only: ${show(r)}`);
  }
  const calls = [["shop_state", {}], ["shop_buy", { p_item: "frame-lime" }], ["equip_item", { p_slot: "frame", p_item: null }], ["set_showcase", { p_badges: [] }]];
  for (const [fn, args] of calls) {
    const anon = await call(null, fn, args);
    assert(/permission denied for function/.test(anon.error || ""), `${fn} signed out is refused before it runs, got ${show(anon)}`);
    const ghost = await call(uuid(99), fn, args);
    assert(ghost.error === "not_signed_in", `${fn} for a session with no account is not_signed_in, got ${show(ghost)}`);
  }
  // Before anything about the arguments.
  for (const [fn, args] of [["shop_buy", { p_item: "no-such-item" }], ["equip_item", { p_slot: "hat", p_item: "no-such-item" }], ["set_showcase", { p_badges: ["Bad Id", "Bad Id", null, "x", "y"] }]]) {
    const r = await call(uuid(99), fn, args);
    assert(r.error === "not_signed_in", `${fn}(${show(args)}) for a session with no account is still not_signed_in, got ${show(r)}`);
  }
  for (const table of ["profile_details", "wallets", "inventory"]) {
    assert((await owner(`select count(*)::int as n from ${table} where user_id = $1`, [uuid(99)]))[0].n === 0, `nothing in ${table} for the session with no account`);
  }
});

// ---------- shop_state ----------

await runTest("shop_state: your balance, every item on sale in shop order with what you own, and what you're wearing", async () => {
  const P = await newPlayer("state"), Q = await newPlayer("other");
  let s = (await call(P, "shop_state")).data;
  assert(same(Object.keys(s).sort(), ["balance", "equipped", "items"]), `top-level keys, got ${show(s)}`);
  assert(s.balance === (await balanceOf(P)), `the balance is the wallet's, got ${s.balance}`);
  const seeds = catalogSeeds();
  assert(same(s.items, seeds.map((i) => ({ ...i, owned: i.rarity === "free" }))), `a new player sees the catalog in shop order, owning only the free items, got ${show(s.items)}`);
  assert(s.items.every((i) => same(Object.keys(i).sort(), ITEM_KEYS)), "every item has exactly the documented keys");
  assert(same(s.equipped, NOTHING_WORN) && (await detailsOf(P)) === null, `nothing worn without a details row, got ${show(s.equipped)}`);

  const start = await balanceOf(P);
  await give(P, priceOf("frame-team"));
  assert(!(await call(P, "shop_buy", { p_item: "frame-team" })).error, "P buys frame-team");
  await owner("insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [P]);
  for (const [slot, item] of [["frame", "frame-team"], ["card", "card-navy"], ["title", "title-undefeated"]]) {
    assert(!(await call(P, "equip_item", { p_slot: slot, p_item: item })).error, `P wears ${item}`);
  }
  assert(!(await call(P, "set_showcase", { p_badges: ["undefeated", "ring-bearer"] })).error, "P picks a showcase");
  s = (await call(P, "shop_state")).data;
  assert(s.balance === start, `the balance is back where it started after spending what was given: ${s.balance} vs ${start}`);
  const owned = s.items.filter((i) => i.owned).map((i) => i.id);
  const wantOwned = seeds.filter((i) => i.rarity === "free" || ["frame-team", "frame-undefeated", "title-undefeated"].includes(i.id)).map((i) => i.id);
  assert(same(owned, wantOwned), `owned: the free items, the one bought and the undefeated badge's two, got ${show(owned)}`);
  assert(same(s.equipped, { frame: "frame-team", card: "card-navy", title: "title-undefeated", showcase: ["undefeated", "ring-bearer"] }), `equipped, got ${show(s.equipped)}`);
  const q = (await call(Q, "shop_state")).data;
  assert(same(q.items.filter((i) => i.owned).map((i) => i.id), seeds.filter((i) => i.rarity === "free").map((i) => i.id)) && same(q.equipped, NOTHING_WORN), `another player's purchases and badges aren't Q's, got ${show(q)}`);

  // Off sale: gone from the shop, except for the players who own it. A tie in sort falls back to the id.
  await owner("update shop_items set active = false where id = 'frame-team'");
  await owner("update shop_items set sort = $1 where id = 'frame-gold'", [seedOf("frame-lime").sort]);
  try {
    s = (await call(P, "shop_state")).data;
    const catalog = await owner("select id, kind, rarity, price, badge, active, sort from shop_items");
    const wantIds = catalog.filter((i) => i.active || wantOwned.includes(i.id)).sort(shopOrder).map((i) => i.id);
    assert(same(s.items.map((i) => i.id), wantIds), `P's list in shop order, the off-sale frame kept:\n sql  ${show(s.items.map((i) => i.id))}\n want ${show(wantIds)}`);
    assert(same(itemOf(s, "frame-team"), { ...seedOf("frame-team"), active: false, owned: true }), `the owner sees it off sale and owned, got ${show(itemOf(s, "frame-team"))}`);
    assert(s.items.findIndex((i) => i.id === "frame-gold") < s.items.findIndex((i) => i.id === "frame-lime"), "frame-gold and frame-lime share a sort, so the id decides");
    assert(!itemOf((await call(Q, "shop_state")).data, "frame-team"), "a player who doesn't own it no longer sees it");
  } finally {
    await owner("update shop_items set active = true where id = 'frame-team'");
    await owner("update shop_items set sort = $1 where id = 'frame-gold'", [seedOf("frame-gold").sort]);
  }
  // PGlite's database collates "C" anyway, so the id tiebreak's collation can't show a difference here, but a
  // project's default collation can sort "frame-a" after "framea". The definition has to say so itself.
  const src = (await owner("select prosrc from pg_proc where proname = 'shop_state'"))[0].prosrc;
  assert(/s\.sort, s\.id collate "C"/.test(src), "shop_state breaks ties on the id in code-point order");
});

// ---------- shop_buy ----------

await runTest("shop_buy at exactly the price buys it, writing the ledger row, the wallet and the inventory row; one coin short is not_enough", async () => {
  const item = "frame-flame", price = LAUNCH_PRICES.legendary;
  assert(priceOf(item) === price, "a legendary frame");
  const EXACT = await newPlayer("exact"), SHORT = await newPlayer("short");
  await fundTo(EXACT, price);
  await fundTo(SHORT, price - 1);

  const before = await holdings(EXACT);
  const r = await call(EXACT, "shop_buy", { p_item: item });
  assert(same(r.data, { ok: true, balance: 0, item }) && same(Object.keys(r.data).sort(), ["balance", "item", "ok"]), `bought with nothing left over, got ${show(r)}`);
  const after = await holdings(EXACT);
  assert(same(after.wallet, { balance: 0, earned: before.wallet.earned, spent: before.wallet.spent + price }), `the wallet: ${show(before.wallet)} -> ${show(after.wallet)}`);
  assert(same(after.ledger, [...before.ledger, { amount: -price, kind: "purchase", ref: item }]), `one purchase row, the price out, ref the item: ${show(after.ledger)}`);
  assert(same(after.inventory, [...before.inventory, item].sort(byCode)), `one inventory row: ${show(after.inventory)}`);
  const [row] = await owner("select acquired_at from inventory where user_id = $1 and item_id = $2", [EXACT, item]);
  assert(row?.acquired_at instanceof Date, "with the time it was bought");
  assert(itemOf((await call(EXACT, "shop_state")).data, item).owned === true, "and the shop shows it owned");

  const shortBefore = await holdings(SHORT);
  const refused = await call(SHORT, "shop_buy", { p_item: item });
  assert(refused.error === "not_enough", `one coin short is not_enough, got ${show(refused)}`);
  assert(same(await holdings(SHORT), shortBefore), "and writes nothing");
  await give(SHORT, 1);
  const r2 = await call(SHORT, "shop_buy", { p_item: item });
  assert(same(r2.data, { ok: true, balance: 0, item }), `with that coin it buys, got ${show(r2)}`);
  const holders = await owner("select user_id from inventory where item_id = $1 and user_id = any($2) order by user_id", [item, [EXACT, SHORT]]);
  assert(holders.length === 2, "each player holds their own copy");
  assert((await call(EXACT, "shop_buy", { p_item: item })).error === "owned", "and buying it again is owned");
});

await runTest("shop_buy refuses in SHOP.md's order - unavailable, badge_only, owned, not_enough - and a refusal writes nothing", async () => {
  const RICH = await newPlayer("rich"), BROKE = await newPlayer("broke");
  await give(RICH, 30000);
  for (const item of ["card-turf", "title-film-room"]) assert(!(await call(RICH, "shop_buy", { p_item: item })).error, `rich buys ${item}`);
  await owner("insert into badge_awards (user_id, badge) values ($1, 'dynasty')", [RICH]);
  // Badge items never get inventory rows, except by hand - and even then the order holds.
  await owner("insert into inventory (user_id, item_id) values ($1, 'title-daily-winner')", [RICH]);
  assert((await balanceOf(BROKE)) < LAUNCH_PRICES.common, "broke can't afford the cheapest item");
  const offSale = ["card-gold-foil", "card-turf", "title-cinderella"];
  await owner("update shop_items set active = false where id = any($1)", [offSale]);
  try {
    const cases = [
      [RICH, "no-such-item", "unavailable", "no such item"],
      [RICH, null, "unavailable", "no item at all"],
      [RICH, "", "unavailable", "an empty id"],
      [RICH, "FRAME-LIME", "unavailable", "an id in the wrong case"],
      [RICH, "card-gold-foil", "unavailable", "an item off sale"],
      [BROKE, "card-gold-foil", "unavailable", "off sale comes before not_enough"],
      [RICH, "title-cinderella", "unavailable", "off sale comes before badge_only"],
      [RICH, "card-turf", "unavailable", "off sale comes before owned"],
      [RICH, "frame-undefeated", "badge_only", "a badge item"],
      [RICH, "card-dynasty", "badge_only", "badge_only comes before owned (rich has the dynasty badge)"],
      [RICH, "title-daily-winner", "badge_only", "badge_only comes before owned (an inventory row added by hand)"],
      [BROKE, "title-daily-winner", "badge_only", "badge_only comes before not_enough"],
      [RICH, "frame-ink", "owned", "a free item"],
      [BROKE, "card-navy", "owned", "a free item, before not_enough"],
      [RICH, "title-film-room", "owned", "an item already bought"],
      [BROKE, "frame-lime", "not_enough", "not enough coins"],
      [BROKE, "pack-night-game", "not_enough", "not enough for a pack"],
    ];
    for (const [who, item, code, why] of cases) {
      const before = await holdings(who);
      const r = await call(who, "shop_buy", { p_item: item });
      assert(r.error === code, `${why}: shop_buy(${show(item)}) should be ${code}, got ${show(r)}`);
      assert(same(await holdings(who), before), `${why}: the refusal wrote nothing, ${show(await holdings(who))} vs ${show(before)}`);
    }
  } finally {
    await owner("update shop_items set active = true where id = any($1)", [offSale]);
  }
});

await runTest("an item taken off sale can't be bought, but stays listed for the players who own it, and they can still wear it", async () => {
  const KEEPER = await newPlayer("keeper"), LATE = await newPlayer("late");
  await give(KEEPER, 10000);
  await give(LATE, 10000);
  assert(!(await call(KEEPER, "shop_buy", { p_item: "card-ticket" })).error, "keeper buys card-ticket");
  await owner("update shop_items set active = false where id = 'card-ticket'");
  try {
    assert((await call(LATE, "shop_buy", { p_item: "card-ticket" })).error === "unavailable", "off sale is unavailable to buy");
    assert(same(itemOf((await call(KEEPER, "shop_state")).data, "card-ticket"), { ...seedOf("card-ticket"), active: false, owned: true }), "listed for its owner, off sale");
    assert(!itemOf((await call(LATE, "shop_state")).data, "card-ticket"), "and not for anyone else");
    const worn = await call(KEEPER, "equip_item", { p_slot: "card", p_item: "card-ticket" });
    assert(worn.data?.card_theme === "card-ticket", `its owner can still wear it, got ${show(worn)}`);
    assert((await call(KEEPER, "shop_state")).data.equipped.card === "card-ticket", "and is wearing it");
    assert((await call(LATE, "equip_item", { p_slot: "card", p_item: "card-ticket" })).error === "not_owned", "nobody else can");
  } finally {
    await owner("update shop_items set active = true where id = 'card-ticket'");
  }
});

await runTest("a badge item is never sold, and becomes yours - and wearable - once its badge is in badge_awards", async () => {
  const P = await newPlayer("champ"), Q = await newPlayer("fan");
  await give(P, 20000);
  const before = await holdings(P);
  assert((await call(P, "shop_buy", { p_item: "frame-undefeated" })).error === "badge_only", "not for sale");
  assert((await call(P, "equip_item", { p_slot: "frame", p_item: "frame-undefeated" })).error === "not_owned", "and not yours yet");
  assert(itemOf((await call(P, "shop_state")).data, "frame-undefeated").owned === false, "the shop agrees");
  // submit-run's award_badges records a badge as it pays for it; the owner stands in for it here.
  await owner("insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [P]);
  const s = (await call(P, "shop_state")).data;
  assert(same(s.items.filter((i) => i.rarity === "badge" && i.owned).map((i) => i.id), ["frame-undefeated", "title-undefeated"]), `the badge's two items are owned, got ${show(s.items.filter((i) => i.rarity === "badge"))}`);
  assert((await call(P, "shop_buy", { p_item: "title-undefeated" })).error === "badge_only", "owned, and still never sold");
  assert(same(await holdings(P), before), "no coins moved and no inventory row");
  assert((await call(P, "equip_item", { p_slot: "frame", p_item: "frame-undefeated" })).data?.frame === "frame-undefeated", "wears the frame");
  assert((await call(P, "equip_item", { p_slot: "title", p_item: "title-undefeated" })).data?.title === "title-undefeated", "and the title");
  assert((await call(P, "equip_item", { p_slot: "card", p_item: "card-dynasty" })).error === "not_owned", "another badge's item isn't P's");
  assert((await call(Q, "equip_item", { p_slot: "frame", p_item: "frame-undefeated" })).error === "not_owned", "and P's badge is nobody else's");
  assert((await owner("select count(*)::int as n from inventory i join shop_items s on s.id = i.item_id where s.badge is not null and i.user_id = any($1)", [[P, Q]]))[0].n === 0, "badge items never get inventory rows");
});

// ---------- equip_item and set_showcase ----------

await runTest("equip_item checks the slot, then the item's kind, then ownership; wears an item or takes it off; and changes only that slot", async () => {
  const P = await newPlayer("dresser");
  await give(P, 10000);
  for (const item of ["frame-lime", "card-night", "title-waiver-hawk"]) assert(!(await call(P, "shop_buy", { p_item: item })).error, `P buys ${item}`);
  assert(!(await call(P, "save_profile", { p_bio: "Dressed for the draft", p_favorite_team: "SEA" })).error, "P has a bio and a team");
  assert(!(await call(P, "set_avatar", { p_path: null, p_preset: "crown" })).error, "a picture");
  assert(!(await call(P, "set_showcase", { p_badges: ["ring-bearer"] })).error, "and a showcase");
  const refusals = [
    ["hat", "frame-lime", "bad_slot"], [null, "frame-lime", "bad_slot"], ["", null, "bad_slot"], ["Frame", "frame-lime", "bad_slot"],
    ["card_theme", "card-night", "bad_slot"], ["avatar_pack", "pack-sideline", "bad_slot"], ["frames", null, "bad_slot"],
    ["frame", "card-night", "bad_item"], ["card", "frame-lime", "bad_item"], ["title", "pack-sideline", "bad_item"],
    ["frame", "no-such-frame", "bad_item"], ["frame", "", "bad_item"], ["card", "CARD-NIGHT", "bad_item"],
    ["frame", "card-gold-foil", "bad_item"], // not owned either: the kind is checked first
    ["frame", "frame-gold", "not_owned"], ["card", "card-dynasty", "not_owned"], ["title", "title-cinderella", "not_owned"],
  ];
  const kept = await detailsOf(P);
  for (const [slot, item, code] of refusals) {
    const r = await call(P, "equip_item", { p_slot: slot, p_item: item });
    assert(r.error === code, `equip_item(${show(slot)}, ${show(item)}) should be ${code}, got ${show(r)}`);
  }
  assert(same(await detailsOf(P), kept), "a refusal changes nothing");

  const COLUMN = { frame: "frame", card: "card_theme", title: "title" };
  for (const [slot, item] of [["frame", "frame-lime"], ["card", "card-night"], ["title", "title-waiver-hawk"], ["frame", "frame-ink"], ["card", "card-navy"], ["title", null], ["frame", null]]) {
    const before = await detailsOf(P);
    const r = await call(P, "equip_item", { p_slot: slot, p_item: item });
    const after = await detailsOf(P);
    assert(same(r.data, after) && same(Object.keys(after).sort(), DETAILS_COLUMNS), `equip_item returns the saved row, got ${show(r)}`);
    assert(same(stripTime(after), { ...stripTime(before), [COLUMN[slot]]: item }), `equip_item(${slot}, ${show(item)}) changes only ${COLUMN[slot]}: ${show(before)} -> ${show(after)}`);
  }
  // A first save creates the row, with nothing else set.
  const FRESH = await newPlayer("fresh"), BLANK = await newPlayer("blank");
  let r = await call(FRESH, "equip_item", { p_slot: "card", p_item: "card-navy" });
  assert(same(stripTime(r.data), { user_id: FRESH, bio: "", avatar_path: null, avatar_preset: null, favorite_team: null, frame: null, card_theme: "card-navy", title: null, showcase: [], updated_at: null }), `a first equip creates the row, got ${show(r)}`);
  r = await call(BLANK, "equip_item", { p_slot: "title", p_item: null });
  assert(r.data?.user_id === BLANK && r.data.title === null && same(await detailsOf(BLANK), r.data), `taking off what isn't worn saves an empty row, got ${show(r)}`);
});

await runTest("set_showcase saves up to three badge ids in order, refuses anything else, and doesn't ask whether they're earned", async () => {
  const P = await newPlayer("shelf");
  assert(!(await call(P, "save_profile", { p_bio: "Trophy case", p_favorite_team: "GB" })).error, "P has a bio");
  const upToMax = BADGES.slice(0, SHOWCASE_MAX).map((b) => b.id);
  for (const [badges, want] of [
    [upToMax, upToMax],
    [["cinderella", "undefeated"], ["cinderella", "undefeated"]], // in the order given
    [["not-a-badge-yet"], ["not-a-badge-yet"]], // shaped like an id is enough
    [["x".repeat(40), "0", "-"], ["x".repeat(40), "0", "-"]],
    [[], []],
    [null, []],
  ]) {
    const before = await detailsOf(P);
    const r = await call(P, "set_showcase", { p_badges: badges });
    assert(same(r.data?.showcase, want) && same(r.data, await detailsOf(P)), `set_showcase(${show(badges)}) saves ${show(want)}, got ${show(r)}`);
    assert(same(stripTime(r.data), { ...stripTime(before), showcase: want }), "and changes only the showcase");
  }
  assert(!(await call(P, "set_showcase", { p_badges: ["dynasty"] })).error, "P shows one badge");
  const kept = await detailsOf(P);
  for (const badges of [
    [...upToMax, "cinderella"], ["undefeated", null], [null], ["undefeated", "undefeated"],
    ["Undefeated"], ["has space"], ["under_score"], ["dot.ted"], ["x".repeat(41)], [""], ["line\nbreak"], ["undefeated\n"],
    [`trophy${String.fromCodePoint(0x1F3C6)}`], [["undefeated"], ["dynasty"]],
  ]) {
    const r = await call(P, "set_showcase", { p_badges: badges });
    assert(r.error === "bad_showcase", `set_showcase(${show(badges)}) should be bad_showcase, got ${show(r)}`);
  }
  assert(same(await detailsOf(P), kept), "a refusal changes nothing");
  // A modified client can send an array numbered from somewhere other than 1: saved renumbered.
  const odd = await asUser(db, P, async () => (await db.query("select set_showcase('[2:3]={undefeated,dynasty}'::text[]) as r")).rows[0].r);
  assert(same(odd.showcase, ["undefeated", "dynasty"]), `an odd-numbered array is saved as a list, got ${show(odd)}`);
  assert((await owner("select array_lower(showcase, 1) as lo from profile_details where user_id = $1", [P]))[0].lo === 1, "numbered from 1");
  // SHOWCASE_MAX is the table's own limit too.
  const tooMany = Array.from({ length: SHOWCASE_MAX + 1 }, (_, i) => `b${i}`);
  assert(/profile_details_showcase_shape/.test(await failure(db, "update profile_details set showcase = $2 where user_id = $1", [P, tooMany])), "the table refuses more than SHOWCASE_MAX");
  assert((await failure(db, "update profile_details set showcase = $2 where user_id = $1", [P, tooMany.slice(0, SHOWCASE_MAX)])) === "", "and takes SHOWCASE_MAX");
  const NEW = await newPlayer("case");
  const r = await call(NEW, "set_showcase", { p_badges: ["first-down"] });
  assert(same(stripTime(r.data), { user_id: NEW, bio: "", avatar_path: null, avatar_preset: null, favorite_team: null, frame: null, card_theme: null, title: null, showcase: ["first-down"], updated_at: null }), `a first showcase creates the row, got ${show(r)}`);
});

// ---------- set_avatar and the packs ----------

await runTest("set_avatar refuses a pack's avatars until that pack is bought, then allows that pack's only", async () => {
  const P = await newPlayer("packer"), Q = await newPlayer("nopack");
  await give(P, 10000);
  const [bought, ...others] = AVATAR_PACKS;
  for (const pack of AVATAR_PACKS) {
    for (const { key } of pack.presets) {
      const r = await call(P, "set_avatar", { p_path: null, p_preset: key });
      assert(r.error === "bad_preset", `${key} needs ${pack.item}, got ${show(r)}`);
    }
  }
  assert((await detailsOf(P)) === null, "no refusal created a row");
  assert(!(await call(P, "shop_buy", { p_item: bought.item })).error, `P buys ${bought.item}`);
  for (const { key } of bought.presets) {
    const r = await call(P, "set_avatar", { p_path: null, p_preset: key });
    assert(r.data?.avatar_preset === key && r.data.avatar_path === null, `${key} is P's to pick now, got ${show(r)}`);
  }
  for (const { key } of others.flatMap((p) => p.presets)) assert((await call(P, "set_avatar", { p_path: null, p_preset: key })).error === "bad_preset", `${key} is in a pack P hasn't bought`);
  for (const { key } of bought.presets) assert((await call(Q, "set_avatar", { p_path: null, p_preset: key })).error === "bad_preset", `P's pack unlocks nothing for Q (${key})`);
  const freeKey = FREE_AVATAR_PRESETS[0].key;
  assert((await call(Q, "set_avatar", { p_path: null, p_preset: freeKey })).data?.avatar_preset === freeKey, "the free avatars still work");
  // It's the inventory row that counts: one added by hand unlocks a pack as well.
  const [other] = others;
  await owner("insert into inventory (user_id, item_id) values ($1, $2)", [Q, other.item]);
  assert((await call(Q, "set_avatar", { p_path: null, p_preset: other.presets[0].key })).data?.avatar_preset === other.presets[0].key, "an inventory row added by hand unlocks the pack");
  // A paid avatar whose pack isn't sold can't be owned.
  await owner("insert into avatar_presets (key, pack, free) values ('gold-helmet', 'gold', false) on conflict (key) do nothing");
  assert((await call(P, "set_avatar", { p_path: null, p_preset: "gold-helmet" })).error === "bad_preset", "a paid avatar in a pack that isn't sold");
});

await runTest("a pack given away in the shop (its item made free) unlocks its avatars for everyone - the database, the shop and the mock agree - and a re-run keeps it", async () => {
  const R = await newPlayer("freepack");
  const pack = AVATAR_PACKS[AVATAR_PACKS.length - 1];
  const [first, second] = pack.presets;
  assert((await call(R, "set_avatar", { p_path: null, p_preset: first.key })).error === "bad_preset", `${first.key} is locked before`);
  const [was] = await owner("select rarity, price from shop_items where id = $1", [pack.item]);
  await owner("update shop_items set rarity = 'free', price = null where id = $1", [pack.item]);
  try {
    assert((await call(R, "set_avatar", { p_path: null, p_preset: first.key })).data?.avatar_preset === first.key, "unlocked for a player who never bought the pack");
    assert(itemOf((await call(R, "shop_state")).data, pack.item)?.owned === true, "and shop_state (so the picker) calls the pack theirs");
    // The runbook's change is to shop_items, which a re-run leaves alone; the avatars' rows aren't touched at all.
    await db.exec(sql("migration-shop.sql"));
    await db.exec(sql("migration-profiles.sql"));
    assert((await call(R, "set_avatar", { p_path: null, p_preset: second.key })).data?.avatar_preset === second.key, "a re-run of both migrations keeps the pack given away");
    const world = mockWorld();
    world.state.profiles.set(R, { id: R, username: "freepack" });
    Object.assign(world.tables.shop_items.get(pack.item), { rarity: "free", price: null });
    assert(world.call(R, "set_avatar", { p_path: null, p_preset: first.key }).data?.avatar_preset === first.key, "the mock's set_avatar unlocks it the same way");
  } finally {
    await owner("update shop_items set rarity = $2, price = $3 where id = $1", [pack.item, was.rarity, was.price]);
  }
});

await runTest("with only v1.11.0's migrations, set_avatar refuses a paid avatar as bad_preset rather than failing - and learns the packs when the shop arrives", async () => {
  const old = await freshDb({ migrations: PROFILE_MIGRATIONS });
  try {
    const A = uuid(1);
    await addAccount(old, { id: A, username: "old_timer" });
    const [pack] = AVATAR_PACKS;
    const key = pack.presets[0].key;
    await old.query("insert into avatar_presets (key, pack, free) values ($1, $2, false)", [key, pack.pack]);
    assert((await old.query("select to_regclass('public.inventory') as t")).rows[0].t === null, "no inventory table in this database");
    const pick = (preset) => asUser(old, A, async () => {
      try {
        return { data: (await old.query("select set_avatar(p_path => null, p_preset => $1) as r", [preset])).rows[0].r };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    });
    for (let i = 1; i <= 2; i++) {
      const r = await pick(key);
      assert(r.error === "bad_preset", `a paid avatar without the shop is bad_preset (call ${i}), got ${show(r)}`);
    }
    assert((await pick("crown")).data?.avatar_preset === "crown", "a free avatar still works");
    // The shop's migrations run while this session's set_avatar is already compiled, with no re-run of
    // migration-profiles.sql: its inventory query is planned only now that the table exists.
    await old.exec(sql("migration-wallet.sql"));
    await old.exec(sql("migration-shop.sql"));
    assert((await pick(key)).error === "bad_preset", "still refused without the pack");
    await old.query("insert into inventory (user_id, item_id) values ($1, $2)", [A, pack.item]);
    assert((await pick(key)).data?.avatar_preset === key, "and allowed once the pack is owned");
  } finally {
    await old.close();
  }
});

// ---------- The lock, and what backs it up ----------

await runTest("shop_buy takes the wallet lock after checking who's asking and before it reads ownership or the balance", async () => {
  const HAS = await newPlayer("haslock"), LOW = await newPlayer("lowlock");
  await give(HAS, 1000);
  assert(!(await call(HAS, "shop_buy", { p_item: "frame-lime" })).error, "has buys frame-lime");
  assert((await balanceOf(LOW)) < LAUNCH_PRICES.legendary, "low can't afford a legendary");
  // A wallet_lock that raises shows whether a call reached it before answering.
  const original = (await owner("select pg_get_functiondef('public.wallet_lock(uuid)'::regprocedure) as d"))[0].d;
  await db.exec(`create or replace function public.wallet_lock(p_user uuid)
    returns bigint language plpgsql volatile security invoker set search_path = public, pg_temp as $$
    begin raise exception 'lock_taken' using errcode = 'P0001'; end; $$;`);
  try {
    for (const [who, item, answer] of [[HAS, "frame-lime", "owned"], [HAS, "frame-ink", "owned"], [LOW, "frame-flame", "not_enough"], [HAS, "card-night", "a purchase"]]) {
      const r = await call(who, "shop_buy", { p_item: item });
      assert(r.error === "lock_taken", `the lock comes before ${answer} (${item}), got ${show(r)}`);
    }
    assert((await call(uuid(99), "shop_buy", { p_item: "frame-lime" })).error === "not_signed_in", "who's asking is checked before the lock");
    assert(!(await call(HAS, "shop_state")).error, "shop_state decides nothing on the balance and takes no lock");
  } finally {
    await db.exec(original);
  }
  assert((await call(HAS, "shop_buy", { p_item: "frame-lime" })).error === "owned", "the real wallet_lock is back");
  const [grants] = await owner("select has_function_privilege('authenticated', 'public.wallet_lock(uuid)', 'execute') as a, has_function_privilege('anon', 'public.wallet_lock(uuid)', 'execute') as b");
  assert(grants.a === false && grants.b === false, "and still not callable by clients");
});

await runTest("behind the lock: a second copy, an overdraft or a repeated purchase row can't be written, and a purchase the ledger already records is refused, never given free", async () => {
  const P = await newPlayer("backstop");
  const item = "frame-team", price = priceOf(item);
  await give(P, 3000);
  assert(!(await call(P, "shop_buy", { p_item: item })).error, `P buys ${item}`);
  const before = await holdings(P);
  assert(/duplicate key|inventory_pkey/.test(await failure(db, "insert into inventory (user_id, item_id) values ($1, $2)", [P, item])), "a second copy breaks inventory's primary key");
  assert(/check constraint/.test(await failure(db, "select wallet_apply($1, $2, 'purchase', 'card-night')", [P, -(before.wallet.balance + 1)])), "an overdraft breaks wallets' balance check");
  assert((await owner("select wallet_apply($1, $2, 'purchase', $3) as r", [P, -price, item]))[0].r === 0, "the same purchase row is recorded once");
  assert(same(await holdings(P), before), `none of those changed anything: ${show(await holdings(P))}`);

  // Taken back by hand: the inventory row deleted, the ledger row left. Buying it again must not hand it over
  // without charging - the refusal takes the new inventory row back out with it.
  await owner("delete from inventory where user_id = $1 and item_id = $2", [P, item]);
  await give(P, price); // enough to pay for it again, so nothing but the ledger row stands in the way
  const taken = await holdings(P);
  const r = await call(P, "shop_buy", { p_item: item });
  assert(r.error === "purchase_conflict", `a purchase the ledger already records is purchase_conflict, got ${show(r)}`);
  assert(same(await holdings(P), taken), `refused whole: no inventory row, no coins and no ledger row moved: ${show(await holdings(P))}`);
  assert(itemOf((await call(P, "shop_state")).data, item).owned === false, "not owned");
  assert((await call(P, "equip_item", { p_slot: "frame", p_item: item })).error === "not_owned", "so not wearable");
  // Fixed by hand, it can be bought again at its price.
  await owner("delete from wallet_ledger where user_id = $1 and kind = 'purchase' and ref = $2", [P, item]);
  const have = await balanceOf(P);
  if (have < price) await give(P, price - have);
  const ready = await balanceOf(P);
  assert(same((await call(P, "shop_buy", { p_item: item })).data, { ok: true, balance: ready - price, item }), "bought again once the rows agree");
});

// ---------- Running the migrations again ----------

await runTest("running migration-shop.sql and migration-profiles.sql again is harmless: prices and sale changes made with SQL stay, and a missing item comes back", async () => {
  const P = await newPlayer("rerun");
  await give(P, 10000);
  for (const item of ["frame-lime", "pack-sideline"]) assert(!(await call(P, "shop_buy", { p_item: item })).error, `P buys ${item}`);
  assert(!(await call(P, "equip_item", { p_slot: "frame", p_item: "frame-lime" })).error, "P wears the frame");
  assert(!(await call(P, "set_showcase", { p_badges: ["undefeated"] })).error, "picks a showcase");
  assert(!(await call(P, "set_avatar", { p_path: null, p_preset: "headset" })).error, "and a pack avatar");
  // The runbook's SQL (migration-shop.sql's header).
  await owner("update shop_items set price = 1500 where id = 'frame-lime'");
  await owner("update shop_items set active = false where id = 'card-ticket'");
  await owner("delete from shop_items where id = $1", [UNTOUCHED]);
  try {
    const snapshot = async () => ({
      items: await owner(`select * from shop_items order by id collate "C"`),
      inventory: await owner(`select user_id, item_id, acquired_at from inventory order by user_id, item_id collate "C"`),
      details: await owner("select * from profile_details order by user_id"),
      presets: await owner(`select * from avatar_presets order by key collate "C"`),
      policies: await owner("select tablename, policyname, cmd, roles::text as roles, qual, with_check from pg_policies where tablename in ('shop_items', 'inventory', 'profile_details', 'avatar_presets') order by 1, 2"),
      constraints: await owner(`select conrelid::regclass::text as t, conname, pg_get_constraintdef(oid) as def from pg_constraint
                                 where conrelid in ('public.shop_items'::regclass, 'public.inventory'::regclass, 'public.profile_details'::regclass) order by 1, 2`),
      functions: await owner(`select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl
                                from pg_proc p where p.pronamespace = 'public'::regnamespace
                                 and p.proname in ('shop_state', 'shop_buy', 'equip_item', 'set_showcase', 'set_avatar') order by 1`),
      tables: await owner("select relname, relacl::text as acl, relrowsecurity from pg_class where oid in ('public.shop_items'::regclass, 'public.inventory'::regclass) order by 1"),
    });
    const before = await snapshot();
    await db.exec(sql("migration-shop.sql"));
    await db.exec(sql("migration-profiles.sql"));
    const after = await snapshot();
    assert(same(after.items.find((i) => i.id === UNTOUCHED), seedOf(UNTOUCHED)), `the missing item is seeded again at its launch values, got ${show(after.items.find((i) => i.id === UNTOUCHED))}`);
    assert(same(after.items.filter((i) => i.id !== UNTOUCHED), before.items), "every other item is exactly as it was");
    assert(after.items.find((i) => i.id === "frame-lime").price === 1500 && after.items.find((i) => i.id === "card-ticket").active === false, "the changed price and the item off sale stay");
    for (const k of ["inventory", "details", "presets", "policies", "constraints", "functions", "tables"]) {
      assert(same(after[k], before[k]), `${k} is unchanged:\n before ${show(before[k])}\n after  ${show(after[k])}`);
    }
    const s = (await call(P, "shop_state")).data;
    assert(itemOf(s, "frame-lime").price === 1500 && itemOf(s, "frame-lime").owned && s.equipped.frame === "frame-lime", `the shop still works, at the new price: ${show(itemOf(s, "frame-lime"))}`);
    assert((await call(P, "shop_buy", { p_item: "frame-lime" })).error === "owned", "buying still checks");
    assert((await call(P, "set_avatar", { p_path: null, p_preset: "cooler" })).data?.avatar_preset === "cooler", "and the pack's avatars are still P's");
  } finally {
    await owner("update shop_items set price = $1 where id = 'frame-lime'", [LAUNCH_PRICES.common]);
    await owner("update shop_items set active = true where id = 'card-ticket'");
    const seed = seedOf(UNTOUCHED);
    await owner("insert into shop_items (id, kind, rarity, price, badge, sort) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing", [seed.id, seed.kind, seed.rarity, seed.price, seed.badge, seed.sort]);
  }
});

// ---------- The mock against the SQL ----------

await runTest("the mock returns what the SQL returns for one list of calls, and ends with the same rows", async () => {
  const RICH = await newPlayer("par_rich"), POOR = await newPlayer("par_poor"), BADGE = await newPlayer("par_badge");
  const NEWBIE = await newPlayer("par_new"), CONFLICT = await newPlayer("par_conf");
  const NOBODY = uuid(999);
  // Set up through the SQL, then copied into the mock: bought items, badges, a details row, an exact balance, and a
  // purchase row edited in by hand.
  await give(RICH, 50000);
  assert(!(await call(RICH, "save_profile", { p_bio: "Hello there", p_favorite_team: "KC" })).error, "rich saves a bio");
  for (const item of ["frame-team", "card-ticket"]) assert(!(await call(RICH, "shop_buy", { p_item: item })).error, `rich buys ${item}`);
  await owner("insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [RICH]);
  await owner("insert into badge_awards (user_id, badge) values ($1, 'dynasty'), ($1, 'cinderella')", [BADGE]);
  await owner("insert into inventory (user_id, item_id) values ($1, 'title-daily-winner')", [BADGE]); // by hand: owned, still badge_only
  await fundTo(POOR, LAUNCH_PRICES.common);
  await give(CONFLICT, 5000);
  await owner("insert into wallet_ledger (user_id, amount, kind, ref) values ($1, $2, 'purchase', 'card-turf')", [CONFLICT, -priceOf("card-turf")]);
  // Catalog changes made with SQL: an item off sale, a new price, ties in sort, and ids where collations disagree.
  await owner("update shop_items set active = false where id = 'card-ticket'");
  // A free item off sale: everyone owns it, so everyone still sees it, and nobody can buy it.
  await owner("update shop_items set active = false where id = 'card-navy'");
  await owner("update shop_items set price = 900 where id = 'title-waiver-hawk'");
  await owner("update shop_items set sort = 20 where id = 'frame-gold'");
  await owner("insert into shop_items (id, kind, rarity, price, sort) values ('frame-a', 'frame', 'common', 100, 20), ('framea', 'frame', 'common', 100, 20)");
  await owner("insert into avatar_presets (key, pack, free) values ('gold-helmet', 'gold', false) on conflict (key) do nothing");
  // A price nulled by hand, past the table's own check: buying it must never come free.
  await owner("alter table shop_items drop constraint shop_items_price_fits_rarity");
  await owner("update shop_items set price = null where id = 'title-film-room'");
  try {
    const mock = mockWorld();
    const T = mock.tables;
    const iso = (d) => (d instanceof Date ? d.toISOString() : d);
    for (const { p } of await owner("select to_jsonb(p) as p from profiles p")) mock.state.profiles.set(p.id, p);
    T.shop_items.clear();
    for (const r of await owner("select id, kind, rarity, price, badge, active, sort from shop_items")) T.shop_items.set(r.id, { ...r });
    for (const r of await owner("select user_id, item_id, acquired_at from inventory")) T.inventory.set(`${r.user_id}|${r.item_id}`, { ...r, acquired_at: iso(r.acquired_at) });
    for (const r of await owner("select * from wallets")) T.wallets.set(r.user_id, { user_id: r.user_id, balance: Number(r.balance), earned: Number(r.earned), spent: Number(r.spent), updated_at: iso(r.updated_at) });
    for (const r of await owner("select * from wallet_ledger")) T.wallet_ledger.set(`${r.user_id}|${r.kind}|${r.ref}`, { id: Number(r.id), user_id: r.user_id, amount: Number(r.amount), kind: r.kind, ref: r.ref, created_at: iso(r.created_at) });
    for (const r of await owner("select * from badge_awards")) T.badge_awards.set(`${r.user_id}|${r.badge}`, { ...r, awarded_at: iso(r.awarded_at) });
    for (const { d } of await owner("select to_jsonb(d) as d from profile_details d")) T.profile_details.set(d.user_id, { ...d });
    T.avatar_presets.clear();
    for (const r of await owner("select key, pack, free from avatar_presets")) T.avatar_presets.set(r.key, { ...r });

    const calls = [
      [RICH, "shop_state", {}], [POOR, "shop_state", {}], [BADGE, "shop_state", {}], [NEWBIE, "shop_state", {}], [NOBODY, "shop_state", {}],
      [NOBODY, "shop_buy", { p_item: "frame-lime" }],
      [POOR, "shop_buy", { p_item: "no-such-item" }],
      [POOR, "shop_buy", { p_item: null }],
      [POOR, "shop_buy", { p_item: "" }],
      [POOR, "shop_buy", { p_item: "card-ticket" }],
      [RICH, "shop_buy", { p_item: "card-ticket" }],
      [POOR, "shop_buy", { p_item: "frame-undefeated" }],
      [RICH, "shop_buy", { p_item: "title-undefeated" }],
      [BADGE, "shop_buy", { p_item: "title-daily-winner" }],
      [POOR, "shop_buy", { p_item: "frame-ink" }],
      [POOR, "shop_buy", { p_item: "card-navy" }],
      [NEWBIE, "equip_item", { p_slot: "card", p_item: "card-navy" }],
      [RICH, "shop_buy", { p_item: "frame-team" }],
      [POOR, "shop_buy", { p_item: "frame-flame" }],
      [POOR, "shop_buy", { p_item: "frame-lime" }],
      [POOR, "shop_buy", { p_item: "frame-lime" }],
      [POOR, "shop_buy", { p_item: "card-night" }],
      [RICH, "shop_buy", { p_item: "title-waiver-hawk" }],
      [RICH, "shop_buy", { p_item: "pack-trophy-room" }],
      [CONFLICT, "shop_buy", { p_item: "card-turf" }],
      [CONFLICT, "shop_buy", { p_item: "card-night" }],
      [RICH, "shop_buy", { p_item: "title-film-room" }],
      [RICH, "shop_state", {}], [POOR, "shop_state", {}], [CONFLICT, "shop_state", {}],
      [NOBODY, "equip_item", { p_slot: "frame", p_item: "frame-ink" }],
      [RICH, "equip_item", { p_slot: "hat", p_item: "frame-team" }],
      [RICH, "equip_item", { p_slot: null, p_item: null }],
      [RICH, "equip_item", { p_slot: "avatar_pack", p_item: "pack-trophy-room" }],
      [RICH, "equip_item", { p_slot: "card", p_item: "frame-team" }],
      [RICH, "equip_item", { p_slot: "frame", p_item: "no-such-frame" }],
      [RICH, "equip_item", { p_slot: "frame", p_item: "card-gold-foil" }],
      [RICH, "equip_item", { p_slot: "frame", p_item: "frame-gold" }],
      [RICH, "equip_item", { p_slot: "frame", p_item: "frame-team" }],
      [RICH, "equip_item", { p_slot: "card", p_item: "card-ticket" }],
      [RICH, "equip_item", { p_slot: "title", p_item: "title-undefeated" }],
      [BADGE, "equip_item", { p_slot: "card", p_item: "card-dynasty" }],
      [BADGE, "equip_item", { p_slot: "title", p_item: "title-daily-winner" }],
      [NEWBIE, "equip_item", { p_slot: "title", p_item: null }],
      [NEWBIE, "equip_item", { p_slot: "frame", p_item: "frame-ink" }],
      [RICH, "equip_item", { p_slot: "title", p_item: null }],
      [CONFLICT, "equip_item", { p_slot: "card", p_item: "card-turf" }],
      [NOBODY, "set_showcase", { p_badges: ["undefeated"] }],
      [RICH, "set_showcase", { p_badges: ["undefeated", "dynasty", "daily-winner", "cinderella"] }],
      [RICH, "set_showcase", { p_badges: ["undefeated", null] }],
      [RICH, "set_showcase", { p_badges: ["undefeated", "undefeated"] }],
      [RICH, "set_showcase", { p_badges: ["Undefeated"] }],
      [RICH, "set_showcase", { p_badges: ["x".repeat(41)] }],
      [RICH, "set_showcase", { p_badges: [""] }],
      [RICH, "set_showcase", { p_badges: ["line\nbreak"] }],
      [RICH, "set_showcase", { p_badges: ["undefeated\n"] }],
      [RICH, "set_showcase", { p_badges: [["undefeated"], ["dynasty"]] }],
      [RICH, "set_showcase", { p_badges: ["cinderella", "undefeated", "not-earned-yet"] }],
      [RICH, "set_showcase", { p_badges: ["x".repeat(40)] }],
      [BADGE, "set_showcase", { p_badges: null }],
      [NEWBIE, "set_showcase", { p_badges: [] }],
      [RICH, "shop_state", {}], [BADGE, "shop_state", {}], [NEWBIE, "shop_state", {}],
      [RICH, "set_avatar", { p_path: null, p_preset: "medal" }],
      [RICH, "set_avatar", { p_path: null, p_preset: "headset" }],
      [POOR, "set_avatar", { p_path: null, p_preset: "medal" }],
      [POOR, "set_avatar", { p_path: null, p_preset: "crown" }],
      [POOR, "set_avatar", { p_path: null, p_preset: "gold-helmet" }],
      [NOBODY, "set_avatar", { p_path: null, p_preset: "medal" }],
    ];
    // updated_at is the clock at the moment of saving - the one thing the two can't share.
    const comparable = (res) => {
      const d = res.data;
      return res.error ? { error: res.error } : { data: d && typeof d === "object" && "updated_at" in d && "user_id" in d ? stripTime(d) : d };
    };
    const seen = new Set();
    const answers = [];
    for (const [i, [who, fn, args]] of calls.entries()) {
      const fromSql = comparable(await call(who, fn, args));
      const fromMock = comparable(mock.call(who, fn, args));
      assert(same(fromSql, fromMock), `step ${i + 1}, ${fn}(${show(args)}) as ${who}:\n sql  ${show(fromSql)}\n mock ${show(fromMock)}`);
      if (fromSql.error) seen.add(`${fn}:${fromSql.error}`);
      answers.push(fromSql);
    }
    // Agreeing isn't enough for the two purchases that must not go through: both sides refuse them.
    for (const [who, item] of [[CONFLICT, "card-turf"], [RICH, "title-film-room"]]) {
      const i = calls.findIndex(([w, fn, args]) => w === who && fn === "shop_buy" && args.p_item === item);
      assert(answers[i]?.error === "purchase_conflict", `buying ${item} is purchase_conflict, got ${show(answers[i])}`);
      assert(!T.inventory.has(`${who}|${item}`) && (await owner("select 1 from inventory where user_id = $1 and item_id = $2", [who, item])).length === 0, `and ${item} isn't handed over`);
    }
    const everyCode = ["shop_state:not_signed_in", "shop_buy:not_signed_in", "shop_buy:unavailable", "shop_buy:badge_only", "shop_buy:owned", "shop_buy:not_enough",
      "shop_buy:purchase_conflict", "equip_item:not_signed_in", "equip_item:bad_slot", "equip_item:bad_item", "equip_item:not_owned",
      "set_showcase:not_signed_in", "set_showcase:bad_showcase", "set_avatar:bad_preset", "set_avatar:not_signed_in"];
    assert(everyCode.every((c) => seen.has(c)), `the list reaches every refusal: missing ${show(everyCode.filter((c) => !seen.has(c)))}`);

    const sorted = (rows) => rows.map((r) => JSON.stringify(canon(r))).sort();
    const fromSql = {
      wallets: (await owner("select user_id, balance, earned, spent from wallets")).map((r) => ({ ...r, balance: Number(r.balance), earned: Number(r.earned), spent: Number(r.spent) })),
      ledger: (await owner("select user_id, amount, kind, ref from wallet_ledger")).map((r) => ({ ...r, amount: Number(r.amount) })),
      inventory: await owner("select user_id, item_id from inventory"),
      badge_awards: await owner("select user_id, badge from badge_awards"),
      profile_details: (await owner("select to_jsonb(d) as d from profile_details d")).map(({ d }) => stripTime(d)),
    };
    const fromMock = {
      wallets: [...T.wallets.values()].map(({ user_id, balance, earned, spent }) => ({ user_id, balance, earned, spent })),
      ledger: [...T.wallet_ledger.values()].map(({ user_id, amount, kind, ref }) => ({ user_id, amount, kind, ref })),
      inventory: [...T.inventory.values()].map(({ user_id, item_id }) => ({ user_id, item_id })),
      badge_awards: [...T.badge_awards.values()].map(({ user_id, badge }) => ({ user_id, badge })),
      profile_details: [...T.profile_details.values()].map(stripTime),
    };
    for (const table of Object.keys(fromSql)) {
      const a = sorted(fromSql[table]), b = sorted(fromMock[table]);
      assert(same(a, b), `${table} ends up different:\n sql  ${show(a.filter((x) => !b.includes(x)))}\n mock ${show(b.filter((x) => !a.includes(x)))}`);
    }
  } finally {
    await owner("update shop_items set active = true where id in ('card-ticket', 'card-navy')");
    await owner("update shop_items set price = $1 where id = 'title-waiver-hawk'", [priceOf("title-waiver-hawk")]);
    await owner("update shop_items set sort = $1 where id = 'frame-gold'", [seedOf("frame-gold").sort]);
    await owner("delete from shop_items where id in ('frame-a', 'framea')");
    await owner("update shop_items set price = $1 where id = 'title-film-room'", [priceOf("title-film-room")]);
    await db.exec(sql("migration-shop.sql")); // puts shop_items_price_fits_rarity back
    assert((await owner("select count(*)::int as n from pg_constraint where conname = 'shop_items_price_fits_rarity'"))[0].n === 1, "the price check is back");
  }
});

// ---------- storage-shop.js ----------

// supabase-js's rpc() in front of PostgREST, over the real functions: a raised code comes back as { message, code:
// "P0001" } with HTTP 400, and a role that may not execute the function as 42501 - HTTP 401 for a signed-out
// visitor (PostgREST says 403 to a signed-in one).
let session = null;
const rpcLog = [];
const sqlClient = {
  rpc: async (name, args = {}, opts = {}) => {
    rpcLog.push({ name, args, opts });
    const who = session;
    const names = Object.keys(args);
    const statement = `select ${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`;
    const run = async () => {
      try {
        return { data: (await db.query(statement, names.map((n) => args[n]))).rows[0].r, error: null, status: 200, statusText: "OK" };
      } catch (e) {
        const status = e.code === "42501" ? (who ? 403 : 401) : e.code === "P0001" ? 400 : 500;
        return { data: null, error: { message: String(e.message), code: e.code ?? "", details: null, hint: null }, status, statusText: "" };
      }
    };
    return who ? asUser(db, who, run) : asAnon(db, run);
  },
};
globalThis.window = globalThis.window || {};
window.__ps_supabase__ = sqlClient;
const S = await import("../storage-shop.js");

await runTest("storage-shop.js over the real functions: reads go as GET, writes as POST, and every answer comes back in the app's shape", async () => {
  const P = await newPlayer("client"), POOR = await newPlayer("clientpoor"), C = await newPlayer("clientconf");
  await give(P, 20000);
  session = P;
  rpcLog.length = 0;
  let shop = await S.fetchShop();
  assert(same(shop, (await call(P, "shop_state")).data), `fetchShop is shop_state in the same shape, got ${show(shop)}`);
  assert(rpcLog[0]?.name === "shop_state" && rpcLog[0].opts?.get === true, "read with GET, so supabase-js retries it");
  const start = shop.balance;
  let res = await S.buyItem("frame-lime");
  assert(same(res, { ok: true, balance: start - priceOf("frame-lime") }), `bought, got ${show(res)}`);
  assert(rpcLog.at(-1).name === "shop_buy" && same(rpcLog.at(-1).args, { p_item: "frame-lime" }) && !rpcLog.at(-1).opts?.get, "a purchase is one POST");
  for (const [id, reason] of [["frame-lime", "owned"], ["frame-ink", "owned"], ["no-such-item", "unavailable"], ["frame-undefeated", "badge_only"]]) {
    res = await S.buyItem(id);
    assert(same(res, { ok: false, reason }), `buyItem(${id}) is ${reason}, got ${show(res)}`);
  }
  let sent = rpcLog.length;
  for (const bad of ["", null, undefined, 42]) assert(same(await S.buyItem(bad), { ok: false, reason: "unavailable" }), `buyItem(${show(bad)}) is unavailable`);
  assert(rpcLog.length === sent, "a missing id is answered without a request");

  res = await S.equipItem("frame", "frame-lime");
  assert(res.ok && res.details.frame === "frame-lime" && res.details.cardTheme === null && res.details.title === null && same(res.details.showcase, []), `worn, in mapDetails' shape, got ${show(res)}`);
  assert(rpcLog.at(-1).name === "equip_item" && same(rpcLog.at(-1).args, { p_slot: "frame", p_item: "frame-lime" }) && !rpcLog.at(-1).opts?.get, "equipping is a POST");
  res = await S.equipItem("card", "card-navy");
  assert(res.ok && res.details.cardTheme === "card-navy" && res.details.frame === "frame-lime", `the card slot, got ${show(res)}`);
  res = await S.equipItem("frame", null);
  assert(res.ok && res.details.frame === null && res.details.cardTheme === "card-navy", `a null id takes the frame off, got ${show(res)}`);
  assert(same(rpcLog.at(-1).args, { p_slot: "frame", p_item: null }), "sent as p_item null");
  for (const [slot, id, reason] of [["hat", "frame-lime", "invalid"], ["card", "frame-lime", "invalid"], ["frame", "no-such-frame", "invalid"], ["frame", "frame-gold", "not_owned"]]) {
    res = await S.equipItem(slot, id);
    assert(same(res, { ok: false, reason }), `equipItem(${slot}, ${id}) is ${reason}, got ${show(res)}`);
  }
  res = await S.setShowcase(["undefeated", "dynasty"]);
  assert(res.ok && same(res.details.showcase, ["undefeated", "dynasty"]) && res.details.cardTheme === "card-navy", `showcase saved, got ${show(res)}`);
  assert(!rpcLog.at(-1).opts?.get, "saving the showcase is a POST");
  assert(same(await S.setShowcase(["dynasty", "dynasty"]), { ok: false, reason: "invalid" }), "a repeated badge is invalid");
  sent = rpcLog.length;
  assert(same(await S.setShowcase("undefeated"), { ok: false, reason: "invalid" }) && rpcLog.length === sent, "a list that isn't one is answered without a request");
  shop = await S.fetchShop();
  assert(same(shop.equipped, { frame: null, card: "card-navy", title: null, showcase: ["undefeated", "dynasty"] }) && shop.balance === start - priceOf("frame-lime"), `the shop reads it all back, got ${show(shop.equipped)}`);

  session = POOR;
  assert(same(await S.buyItem("frame-flame"), { ok: false, reason: "not_enough" }), "not_enough");
  // Rows edited by hand leave nothing the player can fix: read as a failure, never as bought.
  await give(C, 5000);
  await owner("insert into wallet_ledger (user_id, amount, kind, ref) values ($1, $2, 'purchase', 'card-turf')", [C, -priceOf("card-turf")]);
  session = C;
  assert(same(await S.buyItem("card-turf"), { ok: false, reason: "network" }), "purchase_conflict reads as network");
  for (const [label, s] of [["a session whose account is gone", uuid(99)], ["signed out", null]]) {
    session = s;
    assert((await S.fetchShop()) === null, `fetchShop ${label} is null`);
    for (const [fn, run] of [["buyItem", () => S.buyItem("frame-lime")], ["equipItem", () => S.equipItem("frame", null)], ["setShowcase", () => S.setShowcase([])]]) {
      const r = await run();
      assert(same(r, { ok: false, reason: "signed_out" }), `${fn} ${label} is signed_out, got ${show(r)}`);
    }
  }
  session = null;
});

await runTest("storage-shop.js maps every code the functions raise to its reason, a rejected session to signed_out, anything else to network, and never throws", async () => {
  // Every code in the functions' own definitions, so a new one can't arrive without a decision here.
  const raised = async (fn) => [...new Set([...(await owner("select prosrc from pg_proc where proname = $1", [fn]))[0].prosrc.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]))].sort();
  const REASONS = {
    shop_state: { not_signed_in: null }, // fetchShop is null for any failure
    shop_buy: { not_signed_in: "signed_out", unavailable: "unavailable", badge_only: "badge_only", owned: "owned", not_enough: "not_enough", purchase_conflict: "network" },
    equip_item: { not_signed_in: "signed_out", bad_slot: "invalid", bad_item: "invalid", not_owned: "not_owned" },
    set_showcase: { not_signed_in: "signed_out", bad_showcase: "invalid" },
  };
  for (const [fn, table] of Object.entries(REASONS)) {
    const codes = await raised(fn);
    assert(same(codes, Object.keys(table).sort()), `${fn} raises ${show(codes)} - each needs its reason decided here`);
  }
  // claim_minigame is migration-wallet.sql's; its codes as SHOP.md 3.1 lists them.
  REASONS.claim_minigame = { not_signed_in: "signed_out", bad_game: "invalid", bad_date: "invalid", not_played: "not_played" };
  const WRITES = {
    shop_buy: () => S.buyItem("frame-lime"),
    equip_item: () => S.equipItem("frame", "frame-lime"),
    set_showcase: () => S.setShowcase(["undefeated"]),
    claim_minigame: () => S.claimMinigameCoins("over_under"),
  };
  const answer = (reply) => {
    window.__ps_supabase__ = {
      rpc: (name, args, opts) => {
        rpcLog.push({ name, args, opts });
        return typeof reply === "function" ? reply() : Promise.resolve(reply);
      },
    };
  };
  try {
    for (const [fn, write] of Object.entries(WRITES)) {
      for (const [code, reason] of Object.entries({ ...REASONS[fn], some_new_code: "network" })) {
        answer({ data: null, error: { message: code, code: "P0001", details: null, hint: null }, status: 400, statusText: "Bad Request" });
        const res = await write();
        assert(same(res, { ok: false, reason }), `${fn}'s ${code} is ${reason}, got ${show(res)}`);
        assert(rpcLog.at(-1).name === fn && !rpcLog.at(-1).opts?.get, `${fn} is sent as a POST`);
      }
      for (const [error, status, reason] of [
        [{ message: "JWT expired", code: "PGRST301", details: null, hint: null }, 401, "signed_out"],
        [{ message: `permission denied for function ${fn}`, code: "42501", details: null, hint: null }, 401, "signed_out"],
        [{ message: "TypeError: fetch failed", code: "", details: "", hint: "" }, 0, "network"],
        [{ message: "An invalid response was received from the upstream server", code: "" }, 502, "network"],
      ]) {
        answer({ data: null, error, status });
        const res = await write();
        assert(same(res, { ok: false, reason }), `${fn}: ${error.message} (${status}) is ${reason}, got ${show(res)}`);
      }
      for (const broken of [() => Promise.reject(new Error("offline")), () => { throw new Error("sync failure"); }]) {
        answer(broken);
        const res = await write();
        assert(same(res, { ok: false, reason: "network" }), `${fn}: a request that throws is network, got ${show(res)}`);
      }
    }
    // The reads: null for any failure or answer that isn't an object, never a throw.
    for (const reply of [
      { data: null, error: { message: "not_signed_in", code: "P0001" }, status: 400 },
      { data: null, error: { message: "JWT expired", code: "PGRST301" }, status: 401 },
      { data: null, error: null, status: 200 },
      { data: "shop", error: null, status: 200 },
      () => Promise.reject(new Error("offline")),
      () => { throw new Error("sync failure"); },
    ]) {
      answer(reply);
      assert((await S.fetchShop()) === null, `fetchShop is null for ${show(typeof reply === "function" ? "a throw" : reply)}`);
      assert(rpcLog.at(-1).name === "shop_state" && rpcLog.at(-1).opts?.get === true, "shop_state goes as GET");
      assert((await S.fetchWallet()) === null, `fetchWallet is null for ${show(typeof reply === "function" ? "a throw" : reply)}`);
      assert(rpcLog.at(-1).name === "wallet_state" && rpcLog.at(-1).opts?.get === true, "wallet_state goes as GET");
    }
    // A loose answer still comes out in the app's shape.
    answer({ data: { balance: "1200", items: [null, { id: 7 }, { id: "frame-ink", kind: "frame", rarity: "free", price: null, sort: "10", owned: 1 }], equipped: { frame: "frame-lime", showcase: ["undefeated", 3] } }, error: null, status: 200 });
    const loose = await S.fetchShop();
    assert(same(loose, { balance: 1200, items: [{ id: "frame-ink", kind: "frame", rarity: "free", price: null, badge: null, active: true, sort: 10, owned: true }], equipped: { frame: "frame-lime", card: null, title: null, showcase: ["undefeated"] } }), `fetchShop tidies a loose answer, got ${show(loose)}`);
    answer({ data: { balance: 900, earned: 1650, spent: 750, recent: [{ amount: -750, kind: "purchase", ref: "frame-lime", created_at: "2026-09-14T12:00:00+00:00" }, null] }, error: null, status: 200 });
    const wallet = await S.fetchWallet();
    assert(same(wallet, { balance: 900, earned: 1650, spent: 750, recent: [{ amount: -750, kind: "purchase", ref: "frame-lime", createdAt: "2026-09-14T12:00:00+00:00" }] }), `fetchWallet's shape, got ${show(wallet)}`);
    answer({ data: { credited: 15, balance: 915 }, error: null, status: 200 });
    assert(same(await S.claimMinigameCoins("build"), { ok: true, credited: 15, balance: 915 }) && same(rpcLog.at(-1).args, { p_game: "build" }), "a claim's answer");
    answer({ data: { ok: true, balance: 250, item: "frame-lime" }, error: null, status: 200 });
    assert(same(await S.buyItem("frame-lime"), { ok: true, balance: 250 }), "buyItem answers { ok, balance }");
  } finally {
    window.__ps_supabase__ = sqlClient;
  }
});

await db.close();
console.log("test-shop-sql.mjs done");
