// The cards' database half, in real Postgres through tests/pg-fixture.mjs: two tables no browser can write, and
// the one function that grants a card - exactly once per (player, kind, ref), which is what stops two tabs
// claiming a starter deck twice and a retried daily paying a second card.
//
// grant_cards is also held to tests/mock-cards.mjs answer for answer. Every jsdom test in the suite runs on that
// mock, so a rule the SQL has and the mock does not is a rule no screen test ever meets.
import { assert, runTest } from "./helpers.mjs";
import { freshDb, addAccount, addGuestAccount, asUser, asAnon, uuid } from "./pg-fixture.mjs";
import { makeCards } from "./mock-cards.mjs";

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
    ["twenty-one grants at once", Array.from({ length: 21 }, (_, i) => ({ ref: `z${i}`, card: 1, finish: "base" }))],
    ["a good grant beside a bad one", [{ ref: "ok1", card: 1, finish: "base" }, { ref: "bad", card: 1, finish: "nope" }]],
  ]) {
    assert((await grant(ALICE, "starter", grants)).error === "bad_grant", `bad_grant for ${why}`);
  }
  assert((await grant(ALICE, "pack", [{ ref: "a", card: 1, finish: "base" }])).error === "bad_grant", "a kind that does not exist");
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

console.log("test-cards-sql.mjs done");
