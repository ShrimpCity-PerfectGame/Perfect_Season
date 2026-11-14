// The cards' database half, in real Postgres through tests/pg-fixture.mjs: two tables no browser can write, and
// the one function that grants a card - exactly once per (player, kind, ref), which is what stops two tabs
// claiming a starter deck twice and a retried daily paying a second card.
//
// grant_cards is also held to tests/mock-cards.mjs answer for answer. Every jsdom test in the suite runs on that
// mock, so a rule the SQL has and the mock does not is a rule no screen test ever meets.
import { assert, runTest } from "./helpers.mjs";
import { freshDb, addAccount, addGuestAccount, asUser, asAnon, uuid } from "./pg-fixture.mjs";
import { makeCards } from "./mock-cards.mjs";
import { makeWallet } from "./mock-wallet.mjs";
import { PACK_BY_ID, PACKS } from "../card-packs.mjs";

const db = await freshDb();
const ALICE = uuid(1), BOB = uuid(2), GUEST = uuid(3), NOBODY = uuid(99), GOING = uuid(5);
await addAccount(db, { id: ALICE, username: "alice" });
await addAccount(db, { id: BOB, username: "bob" });
await addAccount(db, { id: GOING, username: "leaver" });
await addGuestAccount(db, GUEST);

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}
const differs = (a, b) => (JSON.stringify(canon(a)) === JSON.stringify(canon(b)) ? null : `sql=${JSON.stringify(canon(a)).slice(0, 200)} mock=${JSON.stringify(canon(b)).slice(0, 200)}`);

const owner = async (statement, params) => (await db.query(statement, params)).rows;
async function attempt(who, statement, params) {
  const run = async () => {
    try { const r = await db.query(statement, params); return { rows: r.rows, affected: r.affectedRows ?? 0 }; }
    catch (e) { return { error: String(e?.message || e) }; }
  };
  return who ? asUser(db, who, run) : asAnon(db, run);
}
// The service role is the only caller grant_cards has, so the tests call it as the owner - which is what the
// Edge Functions' service-role client is. A raise comes back as { error: "<reason>" }.
async function grant(user, kind, grants) {
  try { return { data: (await owner("select grant_cards($1, $2, $3::jsonb) as r", [user, kind, JSON.stringify(grants)]))[0].r }; }
  catch (e) { return { error: String(e?.message || e).replace(/^.*?([a-z_]+)$/s, "$1") }; }
}
const ownedBy = (user) => owner("select card_id, finish, count from card_owned where user_id = $1 order by card_id, finish", [user]);
const grantsOf = (user) => owner("select kind, ref, card_id, finish from card_grants where user_id = $1 order by kind, ref", [user]);

await runTest("nobody writes the card tables from a browser", async () => {
  await grant(BOB, "starter", [{ ref: "starter:0", card: 7, finish: "base" }]);
  for (const who of [ALICE, null]) {
    const name = who ? "a signed-in player" : "a visitor";
    for (const [what, statement, params] of [
      ["insert into card_owned", "insert into card_owned (user_id, card_id, finish, count) values ($1, 1, 'prism', 99)", [ALICE]],
      ["insert into card_grants", "insert into card_grants (user_id, kind, ref, card_id, finish) values ($1, 'daily', '2026-11-13', 1, 'prism')", [ALICE]],
      ["update card_owned", "update card_owned set count = 99", []],
      ["delete from card_owned", "delete from card_owned", []],
      ["delete from card_grants", "delete from card_grants", []],
    ]) {
      const r = await attempt(who, statement, params);
      assert(r.error || r.affected === 0, `${name} cannot ${what}: ${JSON.stringify(r).slice(0, 120)}`);
    }
    const g = await attempt(who, "select grant_cards($1, 'starter', $2::jsonb)", [ALICE, JSON.stringify([{ ref: "starter:0", card: 1, finish: "prism" }])]);
    assert(/permission denied/i.test(g.error || ""), `${name} cannot call grant_cards: ${JSON.stringify(g).slice(0, 120)}`);
  }
  assert((await ownedBy(ALICE)).length === 0, "and Alice owns nothing after all that");
  assert((await ownedBy(BOB))[0].count === 1, "and Bob's card was not touched");
});

await runTest("a player reads their own cards and nobody else's", async () => {
  const mine = await attempt(BOB, "select card_id from card_owned");
  const theirs = await attempt(ALICE, "select card_id from card_owned");
  const anon = await attempt(null, "select card_id from card_owned");
  assert(mine.rows.length === 1 && theirs.rows.length === 0 && anon.rows.length === 0, "card_owned is own-rows-only");
  const g1 = await attempt(BOB, "select ref from card_grants"), g2 = await attempt(ALICE, "select ref from card_grants"), g3 = await attempt(null, "select ref from card_grants");
  assert(g1.rows.length === 1 && g2.rows.length === 0 && g3.rows.length === 0, "and so is card_grants");
});

await runTest("a grant happens once per (player, kind, ref), and copies stack", async () => {
  const first = await grant(ALICE, "starter", [{ ref: "starter:0", card: 5, finish: "base" }, { ref: "starter:1", card: 5, finish: "base" }, { ref: "starter:2", card: 9, finish: "gold" }]);
  assert(first.data.granted.length === 3 && first.data.duplicate === false, "three new grants: " + JSON.stringify(first));
  const have = await ownedBy(ALICE);
  assert(JSON.stringify(have) === JSON.stringify([{ card_id: 5, finish: "base", count: 2 }, { card_id: 9, finish: "gold", count: 1 }]), "two copies of one card stack: " + JSON.stringify(have));
  // The same refs again - a retry, or a second tab. Different cards on purpose: the REF is what was claimed.
  const again = await grant(ALICE, "starter", [{ ref: "starter:0", card: 77, finish: "prism" }, { ref: "starter:1", card: 78, finish: "prism" }, { ref: "starter:2", card: 79, finish: "prism" }]);
  assert(again.data.granted.length === 0 && again.data.duplicate === true, "nothing is new the second time: " + JSON.stringify(again));
  assert(JSON.stringify(await ownedBy(ALICE)) === JSON.stringify(have), "and the collection did not move");
  // Partly new: only the new ref lands.
  const mixed = await grant(ALICE, "starter", [{ ref: "starter:2", card: 80, finish: "base" }, { ref: "starter:3", card: 81, finish: "silver" }]);
  assert(mixed.data.granted.length === 1 && mixed.data.granted[0].ref === "starter:3" && mixed.data.duplicate === false, "a mixed grant gives only what was new: " + JSON.stringify(mixed));
  // The same ref under another kind is another grant; an empty list is not a duplicate of anything.
  const daily = await grant(ALICE, "daily", [{ ref: "starter:0", card: 5, finish: "base" }]);
  assert(daily.data.granted.length === 1, "kind is part of the key");
  const none = await grant(ALICE, "daily", []);
  assert(none.data.granted.length === 0 && none.data.duplicate === false, "an empty grant is empty, not a duplicate");
  assert((await ownedBy(ALICE)).find((r) => r.card_id === 5).count === 3, "and the third copy stacked");
});

await runTest("two tabs claiming a starter deck leave exactly eight cards", async () => {
  const deck = (base) => Array.from({ length: 8 }, (_, i) => ({ ref: `starter:${i}`, card: base + i, finish: "base" }));
  const [a, b] = await Promise.all([grant(BOB, "starter", deck(100)), grant(BOB, "starter", deck(200))]);
  const landed = (a.data?.granted.length || 0) + (b.data?.granted.length || 0);
  // Bob already holds starter:0 from the first test, so seven are left to claim between the two tabs.
  assert(landed === 7, `seven new grants between them, got ${landed}`);
  assert((await grantsOf(BOB)).filter((g) => g.kind === "starter").length === 8, "eight starter grants, not sixteen");
  assert((await ownedBy(BOB)).reduce((n, r) => n + r.count, 0) === 8, "and eight cards owned");
});

await runTest("who and what grant_cards refuses, with nothing written", async () => {
  const before = JSON.stringify(await ownedBy(ALICE));
  assert((await grant(GUEST, "starter", [{ ref: "starter:0", card: 1, finish: "base" }])).error === "guest_not_allowed", "a guest cannot collect");
  assert((await grant(NOBODY, "starter", [{ ref: "starter:0", card: 1, finish: "base" }])).error === "no_profile", "an account with no profile cannot");
  for (const [why, grants] of [
    ["a finish that does not exist", [{ ref: "a", card: 1, finish: "diamond" }]],
    ["a card id of zero", [{ ref: "a", card: 0, finish: "base" }]],
    ["a card id that is a word", [{ ref: "a", card: "seven", finish: "base" }]],
    ["no ref", [{ card: 1, finish: "base" }]],
    ["an empty ref", [{ ref: "", card: 1, finish: "base" }]],
    ["a ref too long to be one", [{ ref: "x".repeat(41), card: 1, finish: "base" }]],
    ["forty-one grants at once", Array.from({ length: 41 }, (_, i) => ({ ref: `z${i}`, card: 1, finish: "base" }))],
    ["a good grant beside a bad one", [{ ref: "ok1", card: 1, finish: "base" }, { ref: "bad", card: 1, finish: "nope" }]],
  ]) {
    assert((await grant(ALICE, "starter", grants)).error === "bad_grant", `bad_grant for ${why}`);
  }
  assert((await grant(ALICE, "trade", [{ ref: "a", card: 1, finish: "base" }])).error === "bad_grant", "a kind that does not exist");
  // A gift is its own kind (the runbook's "give a player a card"), so a hand-out never has to pose as a daily
  // card and take that day's ref. Found in review: the only kinds were starter and daily.
  const gift = await grant(BOB, "gift", [{ ref: "gift-1", card: 412, finish: "gold" }]);
  assert(gift.data?.granted.length === 1, "a gift is granted: " + JSON.stringify(gift));
  // The kind check is NAMED, and the migration drops and re-adds it: `create table if not exists` leaves an
  // existing table's checks alone, so an unnamed one could never learn a new kind (packs are next).
  const named = await owner("select conname from pg_constraint where conrelid = 'public.card_grants'::regclass and conname = 'card_grants_kind_check'");
  assert(named.length === 1, "card_grants' kind check has a name the migration can replace");
  assert((await grant(ALICE, "starter", { ref: "a" })).error === "bad_grant", "grants that are not a list");
  assert(JSON.stringify(await ownedBy(ALICE)) === before, "and not one of those wrote a row - the good grant beside the bad one included");
  assert((await ownedBy(GUEST)).length === 0, "the guest owns nothing");
});

await runTest("closing an account erases its cards and nobody else's", async () => {
  await grant(GOING, "starter", [{ ref: "starter:0", card: 3, finish: "base" }]);
  await grant(GOING, "daily", [{ ref: "2026-11-13", card: 4, finish: "silver" }]);
  const bobBefore = JSON.stringify(await ownedBy(BOB));
  const res = (await owner("select delete_account($1) as r", [GOING]))[0].r;
  assert(res.ok === true, "the account closed: " + JSON.stringify(res));
  assert((await ownedBy(GOING)).length === 0 && (await grantsOf(GOING)).length === 0, "its cards and its grants are gone - they were the person's, not a board's");
  assert(JSON.stringify(await ownedBy(BOB)) === bobBefore, "and Bob's are where they were");
});

await runTest("the mock grants cards the way the database does", async () => {
  const fresh = await freshDb();
  const A = uuid(11), G = uuid(12), X = uuid(98);
  await addAccount(fresh, { id: A, username: "ann" });
  await addGuestAccount(fresh, G);
  const profiles = new Map([[A, { id: A, username: "ann", guest: false }], [G, { id: G, username: "Guest_1", guest: true }]]);
  const mock = makeCards({ profiles, currentUserId: () => A });
  const viaSql = async (user, kind, grants) => {
    try { return { data: (await fresh.query("select grant_cards($1, $2, $3::jsonb) as r", [user, kind, JSON.stringify(grants)])).rows[0].r }; }
    catch (e) { return { error: String(e?.message || e).replace(/^.*?([a-z_]+)$/s, "$1") }; }
  };
  const viaMock = (user, kind, grants) => { try { return { data: mock.grantCards(user, kind, grants) }; } catch (e) { return { error: e.message }; } };
  const steps = [
    [A, "starter", [{ ref: "starter:0", card: 5, finish: "base" }, { ref: "starter:1", card: 5, finish: "base" }]],
    [A, "starter", [{ ref: "starter:0", card: 6, finish: "gold" }]],
    [A, "starter", [{ ref: "starter:1", card: 8, finish: "base" }, { ref: "starter:2", card: 9, finish: "prism" }]],
    [A, "daily", [{ ref: "2026-11-13", card: 5, finish: "base" }]],
    [A, "daily", []],
    [G, "starter", [{ ref: "starter:0", card: 5, finish: "base" }]],
    [X, "starter", [{ ref: "starter:0", card: 5, finish: "base" }]],
    [A, "starter", [{ ref: "ok", card: 1, finish: "base" }, { ref: "bad", card: 1, finish: "nope" }]],
    [A, "pack", [{ ref: "a", card: 1, finish: "base" }]],
    [A, "gift", [{ ref: "gift-1", card: 3, finish: "silver" }]],
    [A, "starter", [{ ref: "a", card: 0, finish: "base" }]],
    [A, "starter", { ref: "a" }],
  ];
  for (const [user, kind, grants] of steps) {
    const s = await viaSql(user, kind, grants), m = viaMock(user, kind, grants);
    const d = differs(s, m);
    assert(!d, `grant_cards(${kind}, ${JSON.stringify(grants).slice(0, 60)}): ${d}`);
  }
  const sqlOwned = (await fresh.query("select card_id, finish, count from card_owned where user_id = $1 order by card_id, finish", [A])).rows;
  const mockOwned = mock.owned(A).map((r) => ({ card_id: r.card_id, finish: r.finish, count: r.count })).sort((p, q) => p.card_id - q.card_id || (p.finish < q.finish ? -1 : 1));
  assert(!differs(sqlOwned, mockOwned), "and the two end up owning the same cards: " + differs(sqlOwned, mockOwned));
});

// ---------- packs: one transaction for the stock, the coins and the cards ----------
const RICH = uuid(21), POOR = uuid(22), PGUEST = uuid(23);
await addAccount(db, { id: RICH, username: "rich" });
await addAccount(db, { id: POOR, username: "poor" });
await addGuestAccount(db, PGUEST);
await owner("select wallet_apply($1, 9750, 'season', 'seed')", [RICH]); // 250 welcome + 9,750 = 10,000
const balanceOf = async (u) => Number((await owner("select balance from wallets where user_id = $1", [u]))[0]?.balance ?? 0);
const stockOf = async (id) => (await owner("select stock_left from card_packs where id = $1", [id]))[0]?.stock_left;
const packLedger = async (u) => (await owner("select amount, ref from wallet_ledger where user_id = $1 and kind = 'pack' order by id", [u])).map((r) => ({ amount: Number(r.amount), ref: r.ref }));
const three = (base) => [{ card: base, finish: "base" }, { card: base + 1, finish: "silver" }, { card: base + 2, finish: "base" }];
async function buy(user, pack, open, cards) {
  try { return { data: (await owner("select buy_pack($1, $2, $3, $4::jsonb) as r", [user, pack, open, JSON.stringify(cards)]))[0].r }; }
  catch (e) { return { error: String(e?.message || e).replace(/^.*?([a-z_]+)$/s, "$1") }; }
}

await runTest("the pack table: anyone reads it, nobody writes it, and it agrees with card-packs.mjs", async () => {
  const rows = await owner("select id, price, size, active, stock_total, stock_left from card_packs order by sort");
  assert(rows.map((r) => r.id).join() === PACKS.map((p) => p.id).join(), "the seed is the module's three packs, in order: " + rows.map((r) => r.id));
  for (const r of rows) assert(r.size === PACK_BY_ID[r.id].size, `${r.id}'s size is the module's (${r.size} vs ${PACK_BY_ID[r.id].size})`);
  assert(rows[0].price === 150 && rows[1].price === 250 && rows[2].price === 3000, "the stated prices: " + rows.map((r) => r.price));
  assert(rows[2].stock_total === 5000 && rows[2].stock_left === 5000 && rows[0].stock_left === null, "only Legends has stock");
  for (const who of [ALICE, null]) {
    const read = await attempt(who, "select id from card_packs");
    assert(read.rows?.length === 3, (who ? "a player" : "a visitor") + " can read the packs");
    for (const statement of ["update card_packs set price = 1", "delete from card_packs", "insert into card_packs (id, price, size) values ('pack-free', 1, 3)"]) {
      const r = await attempt(who, statement);
      assert(r.error || r.affected === 0, (who ? "a player" : "a visitor") + " cannot: " + statement);
    }
    const b = await attempt(who, "select buy_pack($1, 'pack-standard', 'aaaaaaaa-0000', '[]'::jsonb)", [ALICE]);
    assert(/permission denied/i.test(b.error || ""), (who ? "a player" : "a visitor") + " cannot call buy_pack");
  }
  assert((await owner("select price from card_packs where id = 'pack-standard'"))[0].price === 150, "and nothing moved");
});

await runTest("buying a pack: the coins, the cards and the ledger move together", async () => {
  const before = await balanceOf(RICH);
  const res = await buy(RICH, "pack-standard", "open-0001", three(10));
  assert(res.data?.duplicate === false && res.data.price === 150 && res.data.balance === before - 150, "charged the row's price: " + JSON.stringify(res));
  assert(JSON.stringify(res.data.cards) === JSON.stringify(three(10)), "and handed back the cards it was given");
  assert((await balanceOf(RICH)) === before - 150, "the wallet is down 150");
  assert((await ownedBy(RICH)).reduce((n, r) => n + r.count, 0) === 3, "three cards owned");
  assert(JSON.stringify(await packLedger(RICH)) === JSON.stringify([{ amount: -150, ref: "open-0001" }]), "one ledger row, under the open id");
  assert((await grantsOf(RICH)).filter((g) => g.kind === "pack").map((g) => g.ref).join() === "open-0001:0,open-0001:1,open-0001:2", "granted under the open id");
});

await runTest("the same purchase again charges nothing and hands back the same cards", async () => {
  const before = await balanceOf(RICH);
  const again = await buy(RICH, "pack-standard", "open-0001", three(500));
  assert(again.data?.duplicate === true, "it is a duplicate: " + JSON.stringify(again));
  assert(JSON.stringify(again.data.cards) === JSON.stringify(three(10)), "with the ORIGINAL cards, not the new ones: " + JSON.stringify(again.data.cards));
  assert((await balanceOf(RICH)) === before && again.data.balance === before, "no second charge");
  assert((await ownedBy(RICH)).reduce((n, r) => n + r.count, 0) === 3 && (await packLedger(RICH)).length === 1, "and nothing else moved");
});

await runTest("the price is the row's, at the moment of purchase", async () => {
  await owner("update card_packs set price = 999 where id = 'pack-air-raid'");
  const before = await balanceOf(RICH);
  const res = await buy(RICH, "pack-air-raid", "open-0002", three(40));
  assert(res.data?.price === 999 && (await balanceOf(RICH)) === before - 999, "charged 999, whatever a screen showed: " + JSON.stringify(res));
  await owner("update card_packs set price = 250 where id = 'pack-air-raid'");
});

await runTest("not enough coins takes nothing", async () => {
  const b = await balanceOf(POOR), s = await stockOf("pack-legends");
  assert(b === 250, "poor has the welcome coins");
  const res = await buy(POOR, "pack-legends", "open-0003", [{ card: 7, finish: "gold" }]);
  assert(res.error === "not_enough", "refused: " + JSON.stringify(res));
  assert((await balanceOf(POOR)) === b && (await stockOf("pack-legends")) === s && (await ownedBy(POOR)).length === 0 && (await packLedger(POOR)).length === 0, "no coins, no stock, no cards, no ledger row");
  await owner("update card_packs set price = 251 where id = 'pack-standard'");
  assert((await buy(POOR, "pack-standard", "open-0004", three(60))).error === "not_enough", "one coin short is short");
  await owner("update card_packs set price = 150 where id = 'pack-standard'");
});

await runTest("the last one of a limited pack goes to one buyer", async () => {
  // PGlite is one connection, so these two run one after the other. In real Postgres they can overlap, and
  // what makes them take turns is `select ... for update` on the pack's row at the top of buy_pack: the second
  // waits for the first to commit and then reads stock_left = 0.
  await owner("update card_packs set stock_left = 1 where id = 'pack-legends'");
  const [a, b] = await Promise.all([buy(RICH, "pack-legends", "open-0005", [{ card: 7, finish: "gold" }]), buy(RICH, "pack-legends", "open-0006", [{ card: 8, finish: "prism" }])]);
  const won = [a, b].filter((r) => r.data), lost = [a, b].filter((r) => r.error);
  assert(won.length === 1 && lost.length === 1 && lost[0].error === "sold_out", "one buys it, the other is told it sold out: " + JSON.stringify([a, b]));
  assert((await stockOf("pack-legends")) === 0, "stock is zero, not below it");
  assert((await packLedger(RICH)).filter((l) => l.amount === -3000).length === 1, "and exactly one of them was charged");
  assert((await buy(RICH, "pack-legends", "open-0007", [{ card: 9, finish: "gold" }])).error === "sold_out", "and it stays sold out");
  await owner("update card_packs set stock_left = 5000 where id = 'pack-legends'");
});

await runTest("a pack that got dearer since the buyer looked is refused, and a cheaper one is just cheaper", async () => {
  const fresh = await freshDb();
  const q = (sql, params) => fresh.query(sql, params).then((r) => r.rows);
  const U = uuid(77);
  await addAccount(fresh, { id: U, username: "pricey" });
  await q("select wallet_apply($1, 1000, 'season', 'seed')", [U]);
  const buy = async (open, shown) => {
    try { return { data: (await q("select buy_pack($1, 'pack-standard', $2, $3::jsonb, $4) as r", [U, open, JSON.stringify([{ card: 1, finish: "base" }, { card: 2, finish: "base" }, { card: 3, finish: "base" }]), shown]))[0].r }; }
    catch (e) { return { error: String(e?.message || e).replace(/^.*?([a-z_]+)$/s, "$1") }; }
  };
  const bal = async () => Number((await q("select balance from wallets where user_id = $1", [U]))[0].balance);
  const start = await bal();
  await q("update card_packs set price = 200 where id = 'pack-standard'");
  const dearer = await buy("open-price-1", 150);
  assert(dearer.error === "price_changed", "shown 150, now 200: " + JSON.stringify(dearer));
  assert(await bal() === start && (await q("select count(*)::int as n from card_owned where user_id = $1", [U]))[0].n === 0, "nothing charged, nothing given");
  await q("update card_packs set price = 100 where id = 'pack-standard'");
  const cheaper = await buy("open-price-2", 150);
  assert(cheaper.data?.price === 100 && await bal() === start - 100, "shown 150, now 100: charged 100: " + JSON.stringify(cheaper));
  const unasked = await buy("open-price-3", null);
  assert(unasked.data?.price === 100, "and with no shown price the row's is simply charged");
});

await runTest("who and what buy_pack refuses, with nothing taken", async () => {
  const before = JSON.stringify([await balanceOf(RICH), await ownedBy(RICH), await packLedger(RICH), await stockOf("pack-legends")]);
  assert((await buy(PGUEST, "pack-standard", "open-0010", three(1))).error === "guest_not_allowed", "a guest");
  assert((await buy(NOBODY, "pack-standard", "open-0011", three(1))).error === "no_profile", "no profile");
  assert((await buy(RICH, "pack-nope", "open-0012", three(1))).error === "unavailable", "a pack with no row");
  await owner("update card_packs set active = false where id = 'pack-air-raid'");
  assert((await buy(RICH, "pack-air-raid", "open-0013", three(1))).error === "unavailable", "a pack taken off sale");
  await owner("update card_packs set active = true where id = 'pack-air-raid'");
  for (const [why, open] of [["too short", "x"], ["a space", "open 0014"], ["too long", "o".repeat(37)], ["a wildcard", "open-%%%%"], ["nothing", null]]) {
    assert((await buy(RICH, "pack-standard", open, three(1))).error === "bad_open", "an open id that is " + why);
  }
  for (const [why, cards] of [["two cards for a pack of three", three(1).slice(0, 2)], ["four", [...three(1), { card: 4, finish: "base" }]], ["a bad finish", [{ card: 1, finish: "nope" }, ...three(1).slice(1)]],
    ["a card id of zero", [{ card: 0, finish: "base" }, ...three(1).slice(1)]], ["not a list", { card: 1 }]]) {
    assert((await buy(RICH, "pack-standard", "open-0015", cards)).error === "bad_grant", "bad_grant for " + why);
  }
  assert(JSON.stringify([await balanceOf(RICH), await ownedBy(RICH), await packLedger(RICH), await stockOf("pack-legends")]) === before, "and none of it moved a coin, a card or the stock");
});

await runTest("re-running the migration keeps a price changed by hand", async () => {
  const { sql } = await import("./pg-fixture.mjs");
  await owner("update card_packs set price = 175 where id = 'pack-standard'");
  await db.exec(sql("migration-cards.sql"));
  assert((await owner("select price from card_packs where id = 'pack-standard'"))[0].price === 175, "the seed adds missing rows and overwrites none");
  await owner("update card_packs set price = 150 where id = 'pack-standard'");
});

await runTest("the mock buys a pack the way the database does", async () => {
  const fresh = await freshDb();
  const A = uuid(31), G = uuid(32);
  await addAccount(fresh, { id: A, username: "ann" });
  await addGuestAccount(fresh, G);
  await fresh.query("select wallet_apply($1, 1000, 'season', 'seed')", [A]);
  const profiles = new Map([[A, { id: A, username: "ann", guest: false }], [G, { id: G, username: "Guest_1", guest: true }]]);
  const state = { profiles, currentUserId: () => A };
  const wallet = makeWallet(state);
  wallet.welcome(A); wallet.apply(A, 1000, "season", "seed");
  const mock = makeCards(state, { wallet });
  const viaSql = async (...args) => {
    try { return { data: (await fresh.query("select buy_pack($1, $2, $3, $4::jsonb, $5) as r", [args[0], args[1], args[2], JSON.stringify(args[3]), args[4] ?? null])).rows[0].r }; }
    catch (e) { return { error: String(e?.message || e).replace(/^.*?([a-z_]+)$/s, "$1") }; }
  };
  const viaMock = (...args) => { try { return { data: mock.buyPack(...args) }; } catch (e) { return { error: e.message }; } };
  const one = [{ card: 7, finish: "gold" }];
  const steps = [
    [A, "pack-standard", "open-1001", three(10)], [A, "pack-standard", "open-1001", three(99)], [A, "pack-air-raid", "open-1002", three(20)],
    [A, "pack-legends", "open-1003", one], [A, "pack-standard", "open-1004", three(30)], [A, "pack-standard", "open-1005", three(40)],
    [A, "pack-standard", "open-1006", three(50)], [A, "pack-standard", "open-1007", three(60)], [A, "pack-air-raid", "open-1008", three(70)],
    [G, "pack-standard", "open-1009", three(1)], [A, "pack-nope", "open-1010", three(1)], [A, "pack-standard", "x", three(1)],
    [A, "pack-standard", "open-1011", three(1).slice(1)], [A, "pack-standard", "open-1003", three(1)],
    // The price the buyer was shown: dearer is refused, the same and cheaper are bought.
    [A, "pack-standard", "open-1012", three(80), 100], [A, "pack-standard", "open-1013", three(80), 150], [A, "pack-standard", "open-1014", three(90), 9999],
    // TWO refusals true at once, so the ORDER is held and not just each reason: a bad id on a pack that does not
    // exist; too few cards for a price that is too low; a price too low for a wallet that is too thin.
    [A, "pack-nope", "x", three(1)], [A, "pack-standard", "open-1015", three(1).slice(1), 1], [A, "pack-legends", "open-1016", one, 1],
    [G, "pack-nope", "x", three(1)],
  ];
  for (const step of steps) {
    const s = await viaSql(...step), m = viaMock(...step);
    const d = differs(s, m);
    assert(!d, `buy_pack(${step[1]}, ${step[2]}): ${d}`);
  }
  const sqlBal = Number((await fresh.query("select balance from wallets where user_id = $1", [A])).rows[0].balance);
  assert(sqlBal === wallet.balanceOf(A), `the two wallets end level (${sqlBal} vs ${wallet.balanceOf(A)})`);
  const sqlStock = (await fresh.query("select stock_left from card_packs where id = 'pack-legends'")).rows[0].stock_left;
  assert(sqlStock === mock.packs.get("pack-legends").stock_left, "and so does the Legends stock");
});

await runTest("a grant that would come up short stops the purchase, with the coins and the stock put back", async () => {
  const fresh = await freshDb();
  const U = uuid(81);
  await addAccount(fresh, { id: U, username: "shorted" });
  const q = (statement, params) => fresh.query(statement, params).then((r) => r.rows);
  await q("select wallet_apply($1, 9000, 'season', 'seed')", [U]);
  // Rows nothing honest leaves behind: a pack ref with no ledger row beside it.
  await q("select grant_cards($1, 'pack', $2::jsonb)", [U, JSON.stringify([{ ref: "open-short:0", card: 5, finish: "base" }])]);
  const before = Number((await q("select balance from wallets where user_id = $1", [U]))[0].balance);
  let err = "";
  try { await q("select buy_pack($1, 'pack-legends', 'open-short', $2::jsonb)", [U, JSON.stringify([{ card: 9, finish: "gold" }])]); } catch (e) { err = String(e.message); }
  assert(/purchase_conflict/.test(err), "refused as a conflict rather than charged for nothing: " + err);
  assert(Number((await q("select balance from wallets where user_id = $1", [U]))[0].balance) === before, "the coins are where they were");
  assert((await q("select stock_left from card_packs where id = 'pack-legends'"))[0].stock_left === 5000, "and so is the stock");
  assert((await q("select count(*)::int as n from wallet_ledger where user_id = $1 and kind = 'pack'", [U]))[0].n === 0, "and no ledger row was left");
  // The mock refuses the same thing, with the same nothing moved.
  const profiles = new Map([[U, { id: U, username: "shorted", guest: false }]]);
  const state = { profiles, currentUserId: () => U };
  const wallet = makeWallet(state); wallet.apply(U, 9000, "season", "seed");
  const mock = makeCards(state, { wallet });
  mock.grantCards(U, "pack", [{ ref: "open-short:0", card: 5, finish: "base" }]);
  let merr = "";
  try { mock.buyPack(U, "pack-legends", "open-short", [{ card: 9, finish: "gold" }]); } catch (e) { merr = e.message; }
  assert(merr === "purchase_conflict" && wallet.balanceOf(U) === 9000 && mock.packs.get("pack-legends").stock_left === 5000, "the mock agrees: " + merr);
});

await runTest("the ledger's list of kinds is replaced whatever the old check was called", async () => {
  const { sql } = await import("./pg-fixture.mjs");
  const fresh = await freshDb();
  const checks = async () => (await fresh.query("select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.wallet_ledger'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'")).rows;
  await fresh.exec("alter table public.wallet_ledger rename constraint wallet_ledger_kind_check to some_other_name");
  await fresh.exec(sql("migration-cards.sql"));
  const after = await checks();
  assert(after.length === 1 && after[0].conname === "wallet_ledger_kind_check" && after[0].def.includes("'pack'"), "one check on kind, the new one: " + JSON.stringify(after));
  const others = (await fresh.query("select count(*)::int as n from pg_constraint where conrelid = 'public.wallet_ledger'::regclass and contype = 'c'")).rows[0].n;
  assert(others === 3, "and the table's other two checks (amount, ref) were left alone: " + others);
  const U = uuid(82);
  await addAccount(fresh, { id: U, username: "renamed" });
  await fresh.query("select wallet_apply($1, 500, 'season', 'seed')", [U]);
  const r = (await fresh.query("select buy_pack($1, 'pack-standard', 'open-renamed', $2::jsonb) as r", [U, JSON.stringify([{ card: 1, finish: "base" }, { card: 2, finish: "base" }, { card: 3, finish: "base" }])])).rows[0].r;
  assert(r.duplicate === false && r.cards.length === 3, "and a pack can be bought on that database");
});

// ---------- battles (v2.27.0): decks, the ladder and the daily battle ----------
// One sequence through the real SQL and through tests/mock-cards.mjs, compared answer for answer. The Edge
// Function decides what a battle came to and deals the hands; these functions decide whether it may be written
// down, once, and that the cards are the account's.
const RUNNER = uuid(31), RIVAL = uuid(32), RGUEST = uuid(33), QUITTER = "11111111-0000-4000-8000-000000000034"; // its own first eight hex: a closed account's tombstone is named from them
await addAccount(db, { id: RUNNER, username: "runner" });
await addAccount(db, { id: RIVAL, username: "rival" });
await addAccount(db, { id: QUITTER, username: "quitter" });
await addGuestAccount(db, RGUEST);
const cardsFrom = (from, n) => Array.from({ length: n }, (_, i) => ({ card: from + i, finish: "base" }));
const THIRTY = cardsFrom(1, 30), HAND = cardsFrom(1, 12), SIX = cardsFrom(1, 6), FOE = cardsFrom(500, 6);
const giveThirty = (tag) => [THIRTY.slice(0, 20), THIRTY.slice(20)].map((part, k) => part.map((c, i) => ({ ref: `${tag}:${k}:${i}`, card: c.card, finish: c.finish })));
const battleMock = (() => {
  const profiles = new Map([[RUNNER, { id: RUNNER, username: "runner", guest: false }], [RIVAL, { id: RIVAL, username: "rival", guest: false }],
    [QUITTER, { id: QUITTER, username: "quitter", guest: false }], [RGUEST, { id: RGUEST, username: "Guest_x", guest: true }]]);
  const state = { profiles, me: null, currentUserId: () => state.me };
  const wallet = makeWallet(state);
  for (const u of [RUNNER, RIVAL, QUITTER]) wallet.welcome(u);
  return { state, wallet, cards: makeCards(state, { wallet }) };
})();
async function giveDeck(u) {
  for (const part of giveThirty("deck")) { await owner("select grant_cards($1, 'gift', $2::jsonb)", [u, JSON.stringify(part)]); battleMock.cards.grantCards(u, "gift", part); }
}
// Call one of the service-role functions in SQL and its twin in the mock; a raise is { error: reason } in both.
async function both(fn, sqlArgs, casts, mockCall) {
  let a, b;
  try { a = { data: (await owner(`select ${fn}(${casts.map((c, i) => `$${i + 1}${c}`).join(", ")}) as r`, sqlArgs))[0].r }; }
  catch (e) { a = { error: String(e?.message || e).replace(/^.*?([a-z_]+)$/s, "$1") }; }
  try { b = { data: mockCall() }; } catch (e) { b = { error: e.message }; }
  for (const k of ["balance", "score"]) if (a.data && typeof a.data === "object" && a.data[k] != null) a.data[k] = Number(a.data[k]);
  const d = differs(a, b);
  assert(!d, `${fn}: the SQL and the mock disagree - ${d}`);
  return a;
}
const J = (v) => JSON.stringify(v);
const CATS = ["production", "scoring", "bigplay", "workload", "efficiency", "star"];
const start = (u, seed = "seed-0001", hand = HAND, foe = FOE, cats = CATS) => both("card_run_start", [u, seed, J(hand), J(foe), cats === null ? null : J(cats)], ["::uuid", "::text", "::jsonb", "::jsonb", "::jsonb"], () => battleMock.cards.runStart(u, seed, hand, foe, cats));
// One round that is not the last: round n of the battle the run is on, with n + 1 rounds in the list after it.
const roundsTo = (n) => Array.from({ length: n }, (_, i) => ({ n: i }));
const round = (u, run, step, n, { card = [SIX[n]], rounds = roundsTo(n + 1) } = {}) =>
  both("card_run_round", [u, run, step, n, J(card), J(rounds)], ["::uuid", "::bigint", "::integer", "::integer", "::jsonb", "::jsonb"],
    () => battleMock.cards.runRound(u, run, step, n, card, rounds));
// The first five rounds of a battle, so its sixth - card_run_battle - can be written.
async function fill(u, run, step) { for (let n = 0; n < 5; n++) assert(!(await round(u, run, step, n)).error, `round ${n} of run ${run} step ${step} is written`); }
const fight = (u, run, step, win, { lineup = SIX, hand = cardsFrom(13, 12), foe = cardsFrom(600, 6), cats = CATS, last = { win }, coins = 3, cap = 15 } = {}) =>
  both("card_run_battle", [u, run, step, J(lineup), win, win ? J(hand) : null, win ? J(foe) : null, win ? J(cats) : null, J(last), coins, cap],
    ["::uuid", "::bigint", "::integer", "::jsonb", "::boolean", "::jsonb", "::jsonb", "::jsonb", "::jsonb", "::integer", "::integer"],
    () => battleMock.cards.runBattle(u, run, step, lineup, win, win ? hand : null, win ? foe : null, win ? cats : null, last, coins, cap));
const stateOf = async (u) => {
  const a = (await asUser(db, u, () => db.query("select card_battle_state() as r"))).rows[0].r;
  battleMock.state.me = u;
  const b = battleMock.cards.battleState();
  a.paid_today = Number(a.paid_today); if (a.daily && a.daily.score != null) a.daily.score = Number(a.daily.score);
  delete a.today; delete b.today; // the day itself is the clock's, and the two clocks are the same machine's
  assert(!differs(a, b), "card_battle_state: the SQL and the mock disagree - " + differs(a, b));
  return a;
};

await runTest("nobody reads or writes a deck, a run or a daily battle from a browser", async () => {
  await giveDeck(RUNNER);
  await start(RUNNER);
  for (const who of [RIVAL, RUNNER, null]) {
    const name = who ? "a signed-in player" : "a visitor";
    for (const [what, statement] of [
      ["read card_runs", "select seed from card_runs"],
      ["read card_decks", "select cards from card_decks"],
      ["read card_dailies", "select hand from card_dailies"],
      ["insert a run", `insert into card_runs (user_id, seed, hand, foe, wins) values ('${RIVAL}', 'seed-9999', '[]', '[]', 99)`],
      ["update a run", "update card_runs set wins = 99"],
      ["delete a run", "delete from card_runs"],
      ["insert a deck", `insert into card_decks (user_id, cards) values ('${RIVAL}', '[]')`],
      ["insert a daily", `insert into card_dailies (date, user_id, hand, rounds, score) values (current_date, '${RIVAL}', '[]', 6, 9999)`],
    ]) {
      const r = await attempt(who, statement);
      assert(/permission denied/i.test(r.error || ""), `${name} cannot ${what}: ${J(r).slice(0, 120)}`);
    }
    for (const call of ["card_run_start($1, 'seed-0002', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)", "card_run_end($1)", "card_lineup_owned($1, '[]'::jsonb, 6)", "card_deck_read($1)", "card_deck_save($1, '[]'::jsonb)",
      "card_run_round($1, 1, 0, 0, '[]'::jsonb, '[]'::jsonb)", "card_daily_round($1, current_date, 0, '[]'::jsonb, '[]'::jsonb)",
      "card_run_battle($1, 1, 0, '[]'::jsonb, true, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 100, 999)", "card_daily_deal($1, current_date, '[]'::jsonb)", "card_daily_record($1, current_date, '[]'::jsonb, 6, 9999, '{}'::jsonb)"]) {
      const r = await attempt(who, `select ${call}`, [RIVAL]);
      assert(/permission denied/i.test(r.error || ""), `${name} cannot call ${call.split("(")[0]}: ${J(r).slice(0, 120)}`);
    }
  }
  const anonState = await attempt(null, "select card_battle_state()"), anonBoards = await attempt(null, "select card_boards(10)");
  assert(/permission denied/i.test(anonState.error || "") && /permission denied/i.test(anonBoards.error || ""), "a visitor cannot call the two readers either");
  const seen = (await attempt(RIVAL, "select card_battle_state() as r")).rows[0].r;
  assert(seen.run === null && seen.deck === null && !J(seen).includes("seed"), "and a signed-in player's state is their own, with no seed in it: " + J(seen));
  const own = (await attempt(RUNNER, "select card_battle_state() as r")).rows[0].r;
  assert(own.run && Array.isArray(own.run.rounds) && !("cats" in own.run) && !J(own).includes("bigplay"), "the owner's state has the rounds played and NOT the order the categories will come in: " + J(own.run).slice(0, 160));
});

await runTest("a deck: saved only if every card of it is theirs", async () => {
  const save = (u, cards) => both("card_deck_save", [u, J(cards)], ["::uuid", "::jsonb"], () => battleMock.cards.deckSave(u, cards));
  const read = async (u) => { const a = (await owner("select card_deck_read($1) as r", [u]))[0].r; assert(!differs(a, battleMock.cards.deckRead(u)), "card_deck_read: the SQL and the mock disagree - " + differs(a, battleMock.cards.deckRead(u))); return a; };
  assert((await read(RUNNER)).owned.length === 30 && (await read(RUNNER)).deck === null, "thirty owned and no deck saved yet");
  const reversed = [...THIRTY].reverse();
  assert((await save(RUNNER, reversed)).data.saved === true, "saved");
  assert(J((await read(RUNNER)).deck) === J(reversed) && J((await stateOf(RUNNER)).deck) === J(reversed), "it is read back as saved, by the function and by the player's own state");
  assert((await save(RUNNER, THIRTY)).data.saved === true && J((await read(RUNNER)).deck) === J(THIRTY), "saving again replaces it");
  assert((await save(RUNNER, [{ card: 9999, finish: "base" }, ...THIRTY.slice(1)])).error === "not_owned", "a card that is not theirs");
  assert((await save(RUNNER, [{ card: 1, finish: "prism" }, ...THIRTY.slice(1)])).error === "not_owned", "or a finish of it they do not hold");
  assert((await save(RUNNER, THIRTY.slice(1))).error === "bad_lineup" && (await save(RUNNER, "thirty")).error === "bad_lineup", "twenty-nine cards, or no list at all");
  assert((await save(RIVAL, THIRTY)).error === "not_owned" && (await save(RGUEST, THIRTY)).error === "guest_not_allowed" && (await save(NOBODY, THIRTY)).error === "no_profile", "somebody with no cards, a guest, nobody");
  assert(J((await read(RUNNER)).deck) === J(THIRTY), "and none of that touched the deck");
});

await runTest("a run: one at a time, its hand stored, each battle counted once, each win paid once", async () => {
  const again = await start(RUNNER, "seed-other", cardsFrom(13, 12), cardsFrom(700, 6));
  assert(again.data.id === 1 && again.data.fresh === false && J(again.data.hand) === J(HAND) && J(again.data.foe) === J(FOE), "starting twice is the same run with the same hand - the second deal is ignored: " + J(again).slice(0, 160));
  const before = await stateOf(RUNNER);
  assert(before.run.wins === 0 && before.best === 0 && before.paid_today === 0 && J(before.run.hand) === J(HAND), "it opens at no wins, with the hand it was dealt");

  // A BATTLE IS SIX ROUNDS, written one at a time; the sixth is card_run_battle.
  assert((await fight(RUNNER, 1, 0, true)).error === "stale", "a battle cannot be ended before its first five rounds are down");
  assert((await round(RUNNER, 1, 0, 1)).error === "stale", "round two cannot be written before round one");
  assert((await round(RUNNER, 1, 0, 0, { card: [{ card: 999, finish: "prism" }] })).error === "not_owned", "a round with a card they do not own");
  assert((await round(RUNNER, 1, 0, 0, { rounds: roundsTo(3) })).error === "bad_battle" && (await round(RUNNER, 1, 0, 5)).error === "bad_battle", "the list has to be one longer than before, and the sixth round is not written here");
  assert((await round(RIVAL, 1, 0, 0)).error === "no_run" && (await round(RGUEST, 1, 0, 0)).error === "guest_not_allowed", "somebody else's run, and a guest");
  assert((await round(RUNNER, 1, 0, 0)).data.rounds.length === 1, "round one");
  assert((await round(RUNNER, 1, 0, 0)).error === "stale", "and the same round again - a double tap - is stale, not a second round");
  assert((await stateOf(RUNNER)).run.rounds.length === 1, "the player's state shows one round played");
  for (let n = 1; n < 5; n++) await round(RUNNER, 1, 0, n);
  const w1 = await fight(RUNNER, 1, 0, true, { coins: 3 });
  assert((await stateOf(RUNNER)).run.rounds.length === 0, "a win starts the next battle with no rounds played");
  assert(w1.data.wins === 1 && w1.data.status === "live" && w1.data.credited === 3 && w1.data.balance === 253, "a win moves the run on and pays: " + J(w1).slice(0, 200));
  assert(J(w1.data.hand) === J(cardsFrom(13, 12)) && J(w1.data.foe) === J(cardsFrom(600, 6)), "and the next hand and the next team are stored with it");
  // The same request again - a double tap, a retry, a second tab that read "no wins yet".
  assert((await fight(RUNNER, 1, 0, true, { coins: 3 })).error === "stale", "the same step twice is refused as stale");
  assert(await balanceOf(RUNNER) === 253 && (await stateOf(RUNNER)).run.wins === 1, "and nothing moved");
  await fill(RUNNER, 1, 1);
  assert((await fight(RUNNER, 99, 1, true)).error === "no_run", "a run that is not theirs, or not there");
  assert((await fight(RIVAL, 1, 1, true)).error === "no_run", "somebody else cannot play this run");
  assert((await fight(RUNNER, 1, 1, true, { lineup: [{ card: 999, finish: "prism" }, ...SIX.slice(1)] })).error === "not_owned", "a six with a card they do not own");
  assert((await fight(RUNNER, 1, 1, true, { lineup: SIX.slice(1) })).error === "bad_lineup", "five cards is not a six");
  assert((await fight(RUNNER, 1, 1, true, { coins: 500 })).error === "bad_battle", "a win cannot pay more than a win pays");
  assert((await fight(RUNNER, 1, 1, true, { hand: HAND.slice(1) })).error === "bad_battle", "a win has to bring the next hand, whole");
  assert((await fight(RUNNER, 1, 1, true, { cats: CATS.slice(1) })).error === "bad_battle", "and the next battle's six categories");
  assert((await fight(RGUEST, 1, 1, true)).error === "guest_not_allowed" && (await fight(NOBODY, 1, 1, true)).error === "no_profile", "guests and the nameless are refused first");
  assert((await stateOf(RUNNER)).run.wins === 1 && await balanceOf(RUNNER) === 253, "and after all of that the run is where it was");

  const w2 = await fight(RUNNER, 1, 1, true, { coins: 4, last: { win: true, total: 512.5 } });
  assert(w2.data.wins === 2 && w2.data.credited === 4, "the second win");
  assert((await stateOf(RUNNER)).run.last.total === 512.5, "the latest battle is kept on the run for a browser that missed the answer");
  await fill(RUNNER, 1, 2);
  const loss = await fight(RUNNER, 1, 2, false, { last: { win: false, total: 301 } });
  assert(loss.data.status === "over" && loss.data.wins === 2 && loss.data.credited === 0, "a loss ends it at the wins it has: " + J(loss).slice(0, 160));
  assert((await fight(RUNNER, 1, 2, true)).error === "no_run", "and a finished run cannot be played on");
  const after = await stateOf(RUNNER);
  assert(after.run.status === "over" && after.run.wins === 2 && after.run.last.total === 301 && after.best === 2 && after.paid_today === 2, "the run reads as over, with the battle that ended it; a best of two, two paid wins today: " + J(after).slice(0, 200));
  const next = await start(RUNNER, "seed-0003");
  assert(next.data.id === 2 && next.data.fresh === true && next.data.wins === 0, "the next run starts from zero");
  assert((await start(RIVAL, "x")).error === "bad_run" && (await start(RIVAL, "seed-0009", HAND.slice(1))).error === "bad_run" && (await start(RIVAL, "seed-0009", HAND, FOE, CATS.slice(1))).error === "bad_run", "a seed that is not one, a hand that is not twelve, five categories");
});

await runTest("only so many wins pay in a day, and the rest still count", async () => {
  // A cap of 3: two are already paid today from the run above.
  await fill(RUNNER, 2, 0);
  const third = await fight(RUNNER, 2, 0, true, { coins: 3, cap: 3 });
  assert(third.data.credited === 3 && third.data.capped === false, "the third paid win");
  await fill(RUNNER, 2, 1);
  const fourth = await fight(RUNNER, 2, 1, true, { coins: 4, cap: 3 });
  assert(fourth.data.credited === 0 && fourth.data.capped === true && fourth.data.wins === 2, "the fourth wins and pays nothing: " + J(fourth).slice(0, 160));
  assert((await stateOf(RUNNER)).paid_today === 3, "three paid, not four");
  const ended = await both("card_run_end", [RUNNER], ["::uuid"], () => battleMock.cards.runEnd(RUNNER));
  assert(ended.data.ended === true && ended.data.wins === 2, "walking away ends it at two");
  const nothing = await both("card_run_end", [RUNNER], ["::uuid"], () => battleMock.cards.runEnd(RUNNER));
  assert(nothing.data.ended === false, "and there is nothing to walk away from twice");
});

await runTest("the daily battle: a hand dealt once, a battle played once", async () => {
  const day = (await owner("select (now() at time zone 'utc')::date::text as d"))[0].d;
  assert(day === battleMock.cards.today(), "the two clocks agree on the day");
  const deal = (u, hand) => both("card_daily_deal", [u, day, J(hand)], ["::uuid", "::date", "::jsonb"], () => battleMock.cards.dailyDeal(u, day, hand));
  const record = (u, rounds, score, { lineup = SIX, shown = { total: score } } = {}) =>
    both("card_daily_record", [u, day, J(lineup), rounds, score, J(shown)], ["::uuid", "::date", "::jsonb", "::integer", "::numeric", "::jsonb"],
      () => battleMock.cards.dailyRecord(u, day, lineup, rounds, score, shown));
  const dround = (u, n, { card = [SIX[n]], rounds = roundsTo(n + 1) } = {}) =>
    both("card_daily_round", [u, day, n, J(card), J(rounds)], ["::uuid", "::date", "::integer", "::jsonb", "::jsonb"], () => battleMock.cards.dailyRound(u, day, n, card, rounds));
  const dfill = async (u) => { for (let n = 0; n < 5; n++) assert(!(await dround(u, n)).error, `the day's round ${n} is written`); };
  assert((await record(RUNNER, 4, 400)).error === "no_hand" && (await dround(RUNNER, 0)).error === "no_hand", "nothing can be played before a hand is dealt");
  const first = await deal(RUNNER, HAND);
  assert(first.data.played === false && J(first.data.hand) === J(HAND), "dealt");
  const again = await deal(RUNNER, cardsFrom(13, 12));
  assert(J(again.data.hand) === J(HAND), "asking again answers with the FIRST hand - a second deal cannot replace it");
  assert((await stateOf(RUNNER)).daily.played === false, "and the player's state shows it dealt and unplayed");
  assert((await record(RUNNER, 4, 400)).error === "stale", "the day cannot be finished before its first five rounds");
  assert((await dround(RUNNER, 2)).error === "stale" && (await dround(RUNNER, 0, { card: [{ card: 999, finish: "base" }] })).error === "not_owned", "rounds go in order, with cards they own");
  await dround(RUNNER, 0);
  assert((await dround(RUNNER, 0)).error === "stale" && (await stateOf(RUNNER)).daily.log.length === 1, "the same round twice is one round");
  for (let n = 1; n < 5; n++) await dround(RUNNER, n);
  assert((await record(RUNNER, 4, 400, { lineup: [{ card: 999, finish: "base" }, ...SIX.slice(1)] })).error === "not_owned", "a six with a card they do not own");
  const played = await record(RUNNER, 4, 512.34);
  assert(played.data.duplicate === false && played.data.rounds === 4 && played.data.score === 512.3, "recorded, the score to one decimal: " + J(played));
  const second = await record(RUNNER, 6, 9000, { shown: { total: 9000 } });
  assert(second.data.duplicate === true && second.data.rounds === 4 && second.data.shown.total === 512.34, "a second go answers with the first: " + J(second));
  assert((await deal(RUNNER, cardsFrom(13, 12))).data.played === true, "and dealing after it is played still answers with the day as it stands");
  assert((await record(RGUEST, 3, 400)).error === "guest_not_allowed" && (await record(RUNNER, 7, 400)).error === "bad_daily" && (await record(RUNNER, 3, 99999)).error === "bad_daily", "who and what it refuses");
  assert((await dround(RUNNER, 0)).error === "duplicate", "and no round can be played on a day that is finished");
  await giveDeck(RIVAL); await deal(RIVAL, HAND); await dfill(RIVAL); await record(RIVAL, 4, 512.3);
  await giveDeck(QUITTER); await deal(QUITTER, HAND); await dfill(QUITTER); await record(QUITTER, 5, 100);
  const mine = await stateOf(RUNNER);
  assert(mine.daily.played === true && mine.daily.rounds === 4 && mine.daily.score === 512.3, "each player's state holds their own day");
});

await runTest("the two boards, in SQL and in the mock", async () => {
  await start(QUITTER, "seed-0004");
  await fill(QUITTER, 3, 0); await fight(QUITTER, 3, 0, true); await fill(QUITTER, 3, 1); await fight(QUITTER, 3, 1, true); // level with runner's best, and still live
  await start(RIVAL, "seed-0005"); // a run with no win is on no board
  for (const limit of [25, 1]) {
    const a = (await asUser(db, RUNNER, () => db.query("select card_boards($1) as r", [limit]))).rows[0].r;
    const b = battleMock.cards.boards(limit);
    for (const row of a.daily) row.score = Number(row.score);
    delete a.today; delete b.today;
    assert(!differs(a, b), `card_boards(${limit}): the SQL and the mock disagree - ${differs(a, b)}`);
    if (limit === 25) {
      assert(!differs(a.runs, [{ username: "quitter", wins: 2 }, { username: "runner", wins: 2 }]), "the ladder: longest runs, ties by name, a live run counted, nobody on it with none: " + J(a.runs));
      assert(!differs(a.daily, [{ username: "quitter", rounds: 5, score: 100 }, { username: "runner", rounds: 4, score: 512.3 }, { username: "rival", rounds: 4, score: 512.3 }]),
        "the day: rounds won first, then points, then whoever got there first: " + J(a.daily));
    }
  }
});

await runTest("closing an account takes its deck and its battles with it", async () => {
  await owner("select card_deck_save($1, $2::jsonb)", [QUITTER, J(THIRTY)]);
  await owner("select delete_account($1)", [QUITTER]);
  for (const table of ["card_runs", "card_decks", "card_dailies"]) assert((await owner(`select count(*)::int as n from ${table} where user_id = $1`, [QUITTER]))[0].n === 0, `its ${table} rows are gone`);
  const board = (await asUser(db, RUNNER, () => db.query("select card_boards(25) as r"))).rows[0].r;
  assert(!differs(board.runs, [{ username: "runner", wins: 2 }]) && board.daily.every((r) => r.username !== "quitter"), "and neither board lists it: " + J(board));
});

await runTest("a database with the first version's tables is cleared of them, once, and a new run survives a re-run", async () => {
  const { sql } = await import("./pg-fixture.mjs");
  const old = await freshDb();
  // Put the v2.25.0 shape back: a card_runs with a `defense`, and a card_showdowns.
  await old.exec("drop table public.card_runs; create table public.card_runs (id bigint generated always as identity primary key, user_id uuid not null references public.profiles(id) on delete cascade, seed text not null, wins integer not null default 0, defense text not null, status text not null default 'live', last jsonb, started_at timestamptz not null default now(), ended_at timestamptz); create table public.card_showdowns (date date not null, user_id uuid not null, defense text not null, lineup jsonb not null, score numeric(7,1) not null, primary key (date, user_id));");
  await old.exec(sql("migration-cards.sql"));
  const cols = (await old.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'card_runs'")).rows.map((r) => r.column_name);
  assert(cols.includes("hand") && cols.includes("foe") && !cols.includes("defense"), "card_runs is the new shape: " + cols);
  assert((await old.query("select to_regclass('public.card_showdowns') as t")).rows[0].t === null, "and card_showdowns is gone");
  const U = uuid(91);
  await addAccount(old, { id: U, username: "keeper" });
  await old.query("select card_run_start($1, 'seed-keep', $2::jsonb, $3::jsonb, $4::jsonb)", [U, J(HAND), J(FOE), J(CATS)]);
  await old.exec(sql("migration-cards.sql"));
  assert((await old.query("select count(*)::int as n from card_runs where status = 'live'")).rows[0].n === 1, "re-running the migration does not drop, or end, a run of the new kind");
  // A run dealt before v2.28.0 has no category order and cannot be played on: the migration ends it.
  await old.query("update card_runs set cats = null");
  await old.exec(sql("migration-cards.sql"));
  assert((await old.query("select status from card_runs")).rows[0].status === "over", "a run with no category order is ended rather than stranded");
});

// ---------- copies (v2.26.0): one of a card in a finish; the next is sold ----------
const SELLER = uuid(41), SGUEST = uuid(43);
await addAccount(db, { id: SELLER, username: "seller" });
await addGuestAccount(db, SGUEST);
const sellMock = (() => {
  const profiles = new Map([[SELLER, { id: SELLER, username: "seller", guest: false }], [SGUEST, { id: SGUEST, username: "Guest_y", guest: true }]]);
  const state = { profiles, currentUserId: () => SELLER };
  const wallet = makeWallet(state); wallet.welcome(SELLER);
  return { wallet, cards: makeCards(state, { wallet }) };
})();
const sellLedger = async (u) => (await owner("select amount, ref from wallet_ledger where user_id = $1 and kind = 'card_sell' order by id", [u])).map((r) => ({ amount: Number(r.amount), ref: r.ref }));
async function grantBoth(kind, list) {
  const a = await grant(SELLER, kind, list);
  let b; try { b = { data: sellMock.cards.grantCards(SELLER, kind, list) }; } catch (e) { b = { error: e.message }; }
  assert(!differs(a, b), `grant_cards(${kind}): the SQL and the mock disagree - ${differs(a, b)}`);
  return a;
}

await runTest("a copy of a card already held is sold for its price, not stacked", async () => {
  const first = await grantBoth("daily", [{ ref: "2026-11-01", card: 50, finish: "gold", sell: 250 }]);
  assert(first.data.granted.length === 1 && first.data.granted[0].sold === undefined, "the first one is kept, price or no price: " + J(first));
  assert(await balanceOf(SELLER) === 250 && (await sellLedger(SELLER)).length === 0, "and nothing was paid");
  const second = await grantBoth("daily", [{ ref: "2026-11-02", card: 50, finish: "gold", sell: 250 }]);
  assert(second.data.granted[0].sold === 250 && second.data.duplicate === false, "the second is sold: " + J(second));
  assert(await balanceOf(SELLER) === 500 && sellMock.wallet.balanceOf(SELLER) === 500, "for its 250 coins");
  assert(J(await sellLedger(SELLER)) === J([{ amount: 250, ref: "daily:2026-11-02" }]), "under the grant's own kind and ref: " + J(await sellLedger(SELLER)));
  assert((await ownedBy(SELLER)).find((r) => r.card_id === 50).count === 1, "and the count did not move");
  assert((await grantsOf(SELLER)).filter((g) => g.kind === "daily").length === 2, "though both grants are on the ledger - the day's card was still given");
  // The same grant again is a duplicate and pays nothing a second time.
  const again = await grantBoth("daily", [{ ref: "2026-11-02", card: 50, finish: "gold", sell: 250 }]);
  assert(again.data.duplicate === true && await balanceOf(SELLER) === 500, "a repeat of the grant sells nothing twice");
  // Another FINISH of the same card is another card.
  const silver = await grantBoth("daily", [{ ref: "2026-11-03", card: 50, finish: "silver", sell: 100 }]);
  assert(silver.data.granted[0].sold === undefined && await balanceOf(SELLER) === 500, "the same card in another finish is kept");
  // With no price on it a copy stacks, as a hand-out from the SQL editor does.
  const gift = await grantBoth("gift", [{ ref: "g-1", card: 50, finish: "gold" }]);
  assert(gift.data.granted[0].sold === undefined && (await ownedBy(SELLER)).find((r) => r.card_id === 50 && r.finish === "gold").count === 2, "an unpriced copy stacks");
  // Two of one card in ONE grant: the first is kept and the second sold.
  const pair = await grantBoth("gift", [{ ref: "g-2", card: 60, finish: "base", sell: 10 }, { ref: "g-3", card: 60, finish: "base", sell: 10 }]);
  assert(pair.data.granted[0].sold === undefined && pair.data.granted[1].sold === 10, "within one grant, too: " + J(pair));
  // A price of nothing sells for nothing and still does not stack.
  const zero = await grantBoth("gift", [{ ref: "g-4", card: 60, finish: "base", sell: 0 }]);
  assert(zero.data.granted[0].sold === 0 && (await ownedBy(SELLER)).find((r) => r.card_id === 60).count === 1, "a copy worth nothing is still not kept");
  for (const [why, sell] of [["a price that is not a number", "lots"], ["a negative price", -5], ["a fraction", 2.5], ["a price no card is worth", 20001]]) {
    const bad = await grantBoth("gift", [{ ref: "g-bad", card: 61, finish: "base", sell }]);
    assert(bad.error === "bad_grant", `${why} is refused: ${J(bad)}`);
  }
  assert((await ownedBy(SELLER)).every((r) => r.card_id !== 61), "and a refused grant wrote nothing");
});

await runTest("a pack that holds a copy: the copy's coins come back with the cards, once", async () => {
  await owner("select wallet_apply($1, 1000, 'season', 'seed-sell')", [SELLER]); sellMock.wallet.apply(SELLER, 1000, "season", "seed-sell");
  const cards = [{ card: 50, finish: "gold", sell: 250 }, { card: 70, finish: "base", sell: 10 }, { card: 71, finish: "base", sell: 10 }];
  const before = await balanceOf(SELLER);
  const a = await buy(SELLER, "pack-standard", "open-copy-1", cards);
  const b = sellMock.cards.buyPack(SELLER, "pack-standard", "open-copy-1", cards);
  a.data.balance = Number(a.data.balance);
  assert(!differs(a.data, b), "buy_pack: the SQL and the mock disagree - " + differs(a.data, b));
  assert(J(a.data.cards.map((c) => c.sold ?? null)) === J([250, null, null]), "the copy is marked sold and the other two are not: " + J(a.data.cards));
  assert(a.data.balance === before - 150 + 250, "the price went out and the copy's coins came in: " + a.data.balance);
  const again = await buy(SELLER, "pack-standard", "open-copy-1", [{ card: 1, finish: "base" }, { card: 2, finish: "base" }, { card: 3, finish: "base" }]);
  const againMock = sellMock.cards.buyPack(SELLER, "pack-standard", "open-copy-1", []);
  again.data.balance = Number(again.data.balance);
  for (const c of again.data.cards) if (c.sold != null) c.sold = Number(c.sold);
  assert(!differs(again.data, againMock) && again.data.duplicate === true && again.data.cards[0].sold === 250 && again.data.balance === a.data.balance, "asked again, the answer is the same cards with the same copy sold, and nothing more moves: " + J(again.data));
});

await runTest("the stacks from before are sold in one go, and only once", async () => {
  // seller holds two gold 50s (one stacked by the unpriced gift above). Stack another card three deep.
  await grantBoth("gift", [{ ref: "s-1", card: 80, finish: "base" }, { ref: "s-2", card: 80, finish: "base" }, { ref: "s-3", card: 80, finish: "base" }]);
  const stacks = (await owner("select card_copies($1) as r", [SELLER]))[0].r;
  assert(!differs(stacks, sellMock.cards.copies(SELLER)) && J(stacks.map((s) => [s.card, s.count])) === J([[80, 3], [50, 2]]), "card_copies lists the stacks, deepest first: " + J(stacks));
  const sales = [{ card: 80, finish: "base", each: 10 }, { card: 50, finish: "gold", each: 250 }, { card: 9999, finish: "base", each: 500 }];
  const before = await balanceOf(SELLER);
  const sold = await both("card_sell_copies", [SELLER, J(sales), "sweep-0001"], ["::uuid", "::jsonb", "::text"], () => sellMock.cards.sellCopies(SELLER, sales, "sweep-0001"));
  sold.data.copies = Number(sold.data.copies); sold.data.coins = Number(sold.data.coins);
  assert(sold.data.copies === 3 && sold.data.coins === 270 && sold.data.balance === before + 270, "three copies, two tens and a 250: " + J(sold));
  assert((await ownedBy(SELLER)).every((r) => r.count === 1), "and nothing is stacked any more");
  assert((await sellLedger(SELLER)).some((l) => l.ref === "copies:sweep-0001" && l.amount === 270), "as one ledger row");
  const again = await both("card_sell_copies", [SELLER, J(sales), "sweep-0002"], ["::uuid", "::jsonb", "::text"], () => sellMock.cards.sellCopies(SELLER, sales, "sweep-0002"));
  assert(Number(again.data.copies) === 0 && Number(again.data.coins) === 0 && again.data.balance === before + 270, "asked again, there is nothing left to sell");
  for (const [why, args] of [["a price that is too high", [[{ card: 80, finish: "base", each: 20001 }], "sweep-0003"]], ["a ref that is not one", [sales, "x"]], ["a finish that does not exist", [[{ card: 80, finish: "shiny", each: 1 }], "sweep-0003"]]]) {
    const bad = await both("card_sell_copies", [SELLER, J(args[0]), args[1]], ["::uuid", "::jsonb", "::text"], () => sellMock.cards.sellCopies(SELLER, args[0], args[1]));
    assert(bad.error === "bad_sale", `${why}: ${J(bad)}`);
  }
  for (const who of [SELLER, null]) for (const call of ["card_copies($1)", "card_sell_copies($1, '[]'::jsonb, 'sweep-9999')"]) {
    const r = await attempt(who, `select ${call}`, [SELLER]);
    assert(/permission denied/i.test(r.error || ""), `${who ? "a signed-in player" : "a visitor"} cannot call ${call.split("(")[0]}`);
  }
});

console.log("test-cards-sql.mjs done");
