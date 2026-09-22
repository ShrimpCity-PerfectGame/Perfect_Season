// Coins in the database (SHOP.md 3.1): supabase/migration-wallet.sql in real Postgres (PGlite, set up like a
// Supabase project by tests/pg-fixture.mjs), and the test mock that mirrors it (tests/mock-wallet.mjs). Checks:
//   - what the migration declares: definer or invoker, stable or volatile, search_path and who may execute each
//     function (anon, authenticated, service_role), the trigger, and coin tables no client can read or write;
//   - credit_coins: its answers, every refusal in order, duplicates, and the per-day cap counted in UTC days;
//   - award_badges: its answers, every refusal, and each badge paid once;
//   - claim_minigame's 24-hour window and once a UTC day; wallet_state's shape and order, and that it works in
//     the read-only transaction PostgREST runs a GET in;
//   - the lock and the constraints behind it. PGlite is one connection, so two calls can't truly race here: this
//     checks that each function takes the row lock before it reads the ledger, and that the tables themselves
//     refuse a double payment or a negative balance;
//   - the welcome trigger, the one-time starting balances (on a v1.11.0 database), and re-running the file;
//   - the SQL's own numbers are rewards.mjs's COIN_RULES, and every balance is the sum of its ledger;
//   - the mock gives the same answers as the SQL for one shared list of calls, and ends with the same rows.
import { assert, runTest } from "./helpers.mjs";
import { freshDb, addAccount, asUser, asAnon, failure, uuid, sql, PROFILE_MIGRATIONS } from "./pg-fixture.mjs";
import { makeWallet } from "./mock-wallet.mjs";
import { COIN_RULES, startingBalance } from "../rewards.mjs";
import { BADGES } from "../badges.mjs";
import { mulberry32, hashStr } from "../game-logic.mjs";

// Sorted keys, so JSON from Postgres and from the mock compare equal regardless of key order.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = (v) => String(JSON.stringify(v)).slice(0, 400);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const iso = (ms) => new Date(ms).toISOString();
const utcDate = (ms) => iso(ms).slice(0, 10);
const utcMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const PG_TEMP_LAST = "public, pg_temp";
const TABLES = ["wallets", "wallet_ledger", "badge_awards", "finished_codes"];
const SERVICE = "service_role";

const db = await freshDb();
const owner = async (statement, params) => (await db.query(statement, params)).rows;

// One statement as the service role (SERVICE), a signed-in player (their id) or a signed-out visitor (null):
// { rows, data } or { error: "<message>" }.
async function attempt(who, statement, params = []) {
  const run = async () => {
    try {
      const r = await db.query(statement, params);
      return { rows: r.rows, data: r.rows[0] ? Object.values(r.rows[0])[0] : null, affected: r.affectedRows ?? 0 };
    } catch (e) {
      return { error: String(e?.message || e) };
    }
  };
  if (who === SERVICE) {
    await db.exec("set role service_role");
    try {
      return await run();
    } finally {
      await db.exec("reset role");
    }
  }
  return who ? asUser(db, who, run) : asAnon(db, run);
}
// A function call with the contract's arguments, the way the Edge Function and the browser send them.
const STATEMENT = {
  credit_coins: (a) => ("p_daily_cap" in a
    ? ["select credit_coins($1::uuid, $2::bigint, $3::text, $4::text, $5::integer) as r", [a.p_user, a.p_amount, a.p_kind, a.p_ref, a.p_daily_cap]]
    : ["select credit_coins($1::uuid, $2::bigint, $3::text, $4::text) as r", [a.p_user, a.p_amount, a.p_kind, a.p_ref]]),
  award_badges: (a) => ["select award_badges($1::uuid, $2::jsonb) as r", [a.p_user, a.p_badges == null ? null : JSON.stringify(a.p_badges)]],
  claim_minigame: (a) => ("p_date" in a
    ? ["select claim_minigame($1::text, $2::text) as r", [a.p_game, a.p_date]]
    : ["select claim_minigame($1::text) as r", [a.p_game]]),
  wallet_state: () => ["select wallet_state() as r", []],
};
async function call(who, fn, args = {}) {
  const [statement, params] = STATEMENT[fn](args);
  const res = await attempt(who, statement, params.map((p) => (p === undefined ? null : p)));
  return res.error ? { error: res.error } : { data: res.data };
}
const credit = (p_user, p_amount, p_kind, p_ref, p_daily_cap) => call(SERVICE, "credit_coins", p_daily_cap === undefined ? { p_user, p_amount, p_kind, p_ref } : { p_user, p_amount, p_kind, p_ref, p_daily_cap });
const award = (p_user, p_badges) => call(SERVICE, "award_badges", { p_user, p_badges });
const badges = (...pairs) => pairs.map(([id, coins]) => ({ id, coins }));

const walletOf = async (uid) => (await owner("select balance, earned, spent from wallets where user_id = $1", [uid]))[0] ?? null;
const ledgerOf = async (uid) => owner("select amount, kind, ref from wallet_ledger where user_id = $1 order by id", [uid]);
const awardsOf = async (uid) => (await owner("select badge from badge_awards where user_id = $1 order by badge", [uid])).map((r) => r.badge);
const totals = async () => (await owner(`select (select count(*)::int from wallets) as wallets, (select count(*)::int from wallet_ledger) as ledger,
  (select count(*)::int from badge_awards) as badges, (select count(*)::int from finished_codes) as codes,
  (select coalesce(sum(balance), 0)::bigint from wallets) as coins`))[0];
// A ledger row put there the way the functions put one (wallet_apply), then dated. Keeps balance = sum of the ledger.
async function seedLedger(uid, amount, kind, ref, createdAt = null) {
  await owner("select wallet_apply($1::uuid, $2::bigint, $3::text, $4::text)", [uid, amount, kind, ref]);
  if (createdAt) await owner("update wallet_ledger set created_at = $4 where user_id = $1 and kind = $2 and ref = $3", [uid, kind, ref, createdAt]);
}
let souDay = 0;
const seedSouRun = (uid, createdAt) => owner("insert into sou_runs (date, user_id, username, score, created_at) values ($1, $2, 'x', 9, $3)", [`d-${++souDay}`, uid, createdAt]);
const seedBuild = (uid, createdAt) => owner("insert into builds (user_id, username, pos, overall, filled, created_at) values ($1, 'x', 'WR', 91.5, '{}', $2)", [uid, createdAt]);
// Runs fn with the session in another time zone, then back to UTC (Supabase's).
async function inZone(zone, fn) {
  await db.exec(`set timezone = '${zone}'`);
  try {
    return await fn();
  } finally {
    await db.exec("set timezone = 'UTC'");
  }
}

let nextAccount = 1;
async function account(username, career = {}) {
  const id = uuid(nextAccount++);
  await addAccount(db, { id, username, ...career });
  return id;
}
const GHOST = uuid(99999); // a signed-in session whose account doesn't exist

// ---------- What the migration declares ----------

await runTest("each function is security definer or invoker, stable or volatile, searches pg_temp last, and has exactly its callers", async () => {
  const rows = await owner(`select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, p.prosecdef as definer, p.provolatile as volatility,
      (select substr(c, 13) from unnest(p.proconfig) c where c like 'search_path=%') as search_path,
      has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
      has_function_privilege('service_role', p.oid, 'execute') as service_role
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('wallet_lock', 'wallet_apply', 'credit_coins', 'award_badges', 'claim_minigame', 'wallet_state', 'create_wallet') order by 1`);
  const actual = Object.fromEntries(rows.map((r) => [r.sig, [r.definer, r.volatility, r.search_path, r.anon, r.authenticated, r.service_role]]));
  // [security definer, volatility, search_path, anon, authenticated, service_role]
  const want = {
    "wallet_lock(p_user uuid)": [false, "v", PG_TEMP_LAST, false, false, true],
    "wallet_apply(p_user uuid, p_amount bigint, p_kind text, p_ref text)": [false, "v", PG_TEMP_LAST, false, false, true],
    "credit_coins(p_user uuid, p_amount bigint, p_kind text, p_ref text, p_daily_cap integer)": [true, "v", PG_TEMP_LAST, false, false, true],
    "award_badges(p_user uuid, p_badges jsonb)": [true, "v", PG_TEMP_LAST, false, false, true],
    "claim_minigame(p_game text, p_date text)": [true, "v", PG_TEMP_LAST, false, true, true],
    // Stable, so the browser reads it as GET.
    "wallet_state()": [true, "s", PG_TEMP_LAST, false, true, true],
    "create_wallet()": [true, "v", PG_TEMP_LAST, false, false, true],
  };
  assert(same(Object.keys(actual).sort(), Object.keys(want).sort()), `each function defined once: ${show(Object.keys(actual))}`);
  for (const [sig, w] of Object.entries(want)) assert(same(actual[sig], w), `${sig}: expected ${show(w)}, got ${show(actual[sig])}`);

  const triggers = await owner("select pg_get_triggerdef(oid) as def from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_create_wallet'");
  assert(triggers.length === 1 && /AFTER INSERT ON public\.profiles FOR EACH ROW EXECUTE FUNCTION (public\.)?create_wallet\(\)/.test(triggers[0].def), `the welcome trigger: ${show(triggers)}`);

  for (const table of TABLES) {
    const [t] = await owner(`select c.relrowsecurity as rls, (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
        (select bool_or(has_table_privilege(r, c.oid, m)) from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) m) as client
      from pg_class c where c.oid = $1::regclass`, [`public.${table}`]);
    assert(t.rls === true && t.policies === 0 && t.client === false, `${table}: RLS on, no policies, no client privileges - got ${show(t)}`);
  }
});

await runTest("no client can read or write the coin tables, or call credit_coins, award_badges or the helpers", async () => {
  const ALICE = await account("alice");
  const before = { totals: await totals(), alice: await walletOf(ALICE) };
  for (const who of [null, ALICE]) {
    const label = who ? "a signed-in player" : "a signed-out visitor";
    for (const table of TABLES) {
      const read = await attempt(who, `select * from ${table}`);
      assert(read.error === `permission denied for table ${table}`, `${label} can't read ${table}: ${show(read)}`);
    }
    const self = who || ALICE;
    const writes = [
      ["insert into wallets (user_id, balance, earned) values ($1, 1000000, 1000000)", [uuid(88888)]],
      ["update wallets set balance = balance + 1000000, earned = earned + 1000000 where user_id = $1", [self]],
      ["delete from wallets where user_id = $1", [self]],
      ["insert into wallet_ledger (user_id, amount, kind, ref) values ($1, 1000000, 'season', 'forged')", [self]],
      ["update wallet_ledger set amount = 1000000 where user_id = $1", [self]],
      ["delete from wallet_ledger where user_id = $1", [self]],
      ["insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [self]],
      ["delete from badge_awards where user_id = $1", [self]],
      ["insert into finished_codes (user_id, code) values ($1, 'FORGED')", [self]],
      ["delete from finished_codes where user_id = $1", [self]],
    ];
    for (const [statement, params] of writes) {
      const res = await attempt(who, statement, params);
      assert(/^permission denied for table /.test(res.error || ""), `${label}: "${statement}" must be refused, got ${show(res)}`);
    }
    const calls = [
      ["select credit_coins($1::uuid, 10000::bigint, 'season', 'forged')", "credit_coins"],
      ["select credit_coins($1::uuid, 10000::bigint, 'daily', 'forged', null)", "credit_coins"],
      [`select award_badges($1::uuid, '[{"id": "undefeated", "coins": 1000}]'::jsonb)`, "award_badges"],
      ["select wallet_apply($1::uuid, 10000::bigint, 'season', 'forged')", "wallet_apply"],
      ["select wallet_lock($1::uuid)", "wallet_lock"],
    ];
    for (const [statement, fn] of calls) {
      const res = await attempt(who, statement, [self]);
      assert(res.error === `permission denied for function ${fn}`, `${label} can't call ${fn}: ${show(res)}`);
    }
    // A trigger function can't be called directly by anyone.
    assert((await attempt(who, "select create_wallet()")).error, `${label} can't call create_wallet`);
  }
  // The player's own two need a signed-in player.
  for (const fn of ["claim_minigame", "wallet_state"]) {
    const res = await attempt(null, fn === "wallet_state" ? "select wallet_state()" : "select claim_minigame('over_under')");
    assert(res.error === `permission denied for function ${fn}`, `a signed-out visitor can't call ${fn}: ${show(res)}`);
  }
  assert(same(await totals(), before.totals) && same(await walletOf(ALICE), before.alice), "none of it changed a coin or a row");
});

await runTest("the service role calls credit_coins and award_badges; claim_minigame and wallet_state answer only a signed-in player", async () => {
  const BOB = await account("bob");
  let r = await credit(BOB, 20, "season", "SVC1", 20);
  assert(same(r.data, { credited: 20, balance: 270, capped: false, duplicate: false }), `the service role pays a season: ${show(r)}`);
  r = await award(BOB, badges(["first-down", 100]));
  assert(same(r.data, { awarded: ["first-down"], credited: 100, balance: 370 }), `the service role pays a badge: ${show(r)}`);
  for (const fn of ["claim_minigame", "wallet_state"]) {
    r = await call(SERVICE, fn, { p_game: "over_under" });
    assert(r.error === "not_signed_in", `${fn} as the service role, with no player: ${show(r)}`);
  }
  r = await call(GHOST, "wallet_state");
  assert(r.error === "not_signed_in", `a session with no account: ${show(r)}`);
});

// ---------- credit_coins ----------

await runTest("credit_coins refuses, in order, no_such_player, bad_kind, bad_amount and bad_ref, and writes nothing", async () => {
  const CAROL = await account("carol");
  const before = await totals();
  const refusals = [
    [[null, 20, "season", "R1", 20], "no_such_player"],
    [[GHOST, 20, "season", "R1", 20], "no_such_player"],
    [[GHOST, -5, "bogus", "", null], "no_such_player"], // checked first
    [[CAROL, 20, null, "R1", 20], "bad_kind"],
    ...["starting", "welcome", "badge", "minigame", "purchase", "Season", " season", ""].map((kind) => [[CAROL, 20, kind, "R1", 20], "bad_kind"]),
    [[CAROL, -1, "gift", "", 20], "bad_kind"], // before the amount and the ref
    [[CAROL, null, "season", "R1", 20], "bad_amount"],
    [[CAROL, -1, "season", "R1", 20], "bad_amount"],
    [[CAROL, 10001, "season", "R1", 20], "bad_amount"],
    [[CAROL, 9e15, "daily", "R1", null], "bad_amount"],
    [[CAROL, -20, "season", "", 20], "bad_amount"], // before the ref
    [[CAROL, 20, "season", null, 20], "bad_ref"],
    [[CAROL, 20, "season", "", 20], "bad_ref"],
    [[CAROL, 20, "season", "x".repeat(201), 20], "bad_ref"],
    [[CAROL, 20, "daily", "😀".repeat(201), null], "bad_ref"],
  ];
  for (const [args, code] of refusals) {
    const r = await credit(...args);
    assert(r.error === code, `credit_coins(${show(args).slice(0, 80)}) should raise ${code}, got ${show(r)}`);
  }
  assert(same(await totals(), before), `a refused credit writes nothing: ${show(await totals())} vs ${show(before)}`);
  // The edges that are fine: 0 and 10,000 coins, a ref of 200 characters (emoji count as one each).
  assert((await credit(CAROL, 10000, "season", "x".repeat(200), 20)).data?.credited === 10000, "10,000 coins under a 200-character ref");
  assert((await credit(CAROL, 1, "daily", "😀".repeat(200), null)).data?.credited === 1, "200 emoji are 200 characters");
  const zero = await credit(CAROL, 0, "season", "ZERO", 20);
  assert(same(zero.data, { credited: 0, balance: 10251, capped: false, duplicate: false }), `0 coins credits nothing and isn't a duplicate: ${show(zero)}`);
  assert(!(await ledgerOf(CAROL)).some((l) => l.ref === "ZERO"), "and records nothing");
});

await runTest("credit_coins pays a (kind, ref) once: a repeat answers duplicate, and the ref is per kind and per player", async () => {
  const DAN = await account("dan"), ERIN = await account("erin");
  let r = await credit(DAN, 88, "season", "K3F9QZ", COIN_RULES.paidSeasonsPerDay);
  assert(same(r.data, { credited: 88, balance: 338, capped: false, duplicate: false }), `a season pays: ${show(r)}`);
  r = await credit(DAN, 88, "season", "K3F9QZ", COIN_RULES.paidSeasonsPerDay);
  assert(same(r.data, { credited: 0, balance: 338, capped: false, duplicate: true }), `the same code again is a duplicate: ${show(r)}`);
  r = await credit(DAN, 5000, "season", "K3F9QZ");
  assert(same(r.data, { credited: 0, balance: 338, capped: false, duplicate: true }), `a different amount doesn't make it new: ${show(r)}`);
  r = await credit(DAN, 64, "daily", "K3F9QZ", null);
  assert(same(r.data, { credited: 64, balance: 402, capped: false, duplicate: false }), `the same ref under another kind is its own: ${show(r)}`);
  r = await credit(ERIN, 88, "season", "K3F9QZ", COIN_RULES.paidSeasonsPerDay);
  assert(same(r.data, { credited: 88, balance: 338, capped: false, duplicate: false }), `another player's same code pays them: ${show(r)}`);
  const daily = "2026-09-14:standard";
  assert((await credit(DAN, 57, "daily", daily)).data?.credited === 57 && (await credit(DAN, 57, "daily", daily)).data?.duplicate === true, "a Daily pays once per date and format");
  assert(same(await ledgerOf(DAN), [
    { amount: 250, kind: "welcome", ref: "welcome" }, { amount: 88, kind: "season", ref: "K3F9QZ" },
    { amount: 64, kind: "daily", ref: "K3F9QZ" }, { amount: 57, kind: "daily", ref: daily },
  ]), `dan's ledger: ${show(await ledgerOf(DAN))}`);
  assert(same(await walletOf(DAN), { balance: 459, earned: 459, spent: 0 }), `dan's wallet: ${show(await walletOf(DAN))}`);
  // A player whose wallet is gone gets a new one from the credit.
  await owner("delete from wallet_ledger where user_id = $1", [ERIN]);
  await owner("delete from wallets where user_id = $1", [ERIN]);
  r = await credit(ERIN, 20, "season", "FRESH", 20);
  assert(same(r.data, { credited: 20, balance: 20, capped: false, duplicate: false }) && same(await walletOf(ERIN), { balance: 20, earned: 20, spent: 0 }), `a wallet made by the credit: ${show(r)}`);
});

await runTest("the daily cap counts this kind's rows since UTC midnight: the 21st season of the day pays nothing, a Daily always pays", async () => {
  const CAP = await account("capper");
  const midnight = utcMidnight();
  // Three seasons from yesterday, the last a millisecond before midnight - none of them count.
  await seedLedger(CAP, 30, "season", "Y-1", iso(midnight - 5 * HOUR));
  await seedLedger(CAP, 30, "season", "Y-2", iso(midnight - MINUTE));
  await seedLedger(CAP, 30, "season", "Y-3", iso(midnight - 1));
  // Nineteen today, the first exactly at midnight - which counts.
  await seedLedger(CAP, 30, "season", "T-0", iso(midnight));
  for (let i = 1; i <= 18; i++) await seedLedger(CAP, 30, "season", `T-${i}`);
  // Other kinds don't count toward a season's cap.
  for (const [kind, ref] of [["daily", "2026-09-14:fantasy"], ["badge", "first-down"], ["minigame", `build:${utcDate(Date.now())}`]]) await seedLedger(CAP, 30, kind, ref);
  const balance = (await walletOf(CAP)).balance;

  let r = await credit(CAP, 25, "season", "T-19", COIN_RULES.paidSeasonsPerDay);
  assert(same(r.data, { credited: 25, balance: balance + 25, capped: false, duplicate: false }), `the 20th season today pays: ${show(r)}`);
  r = await credit(CAP, 25, "season", "T-20", COIN_RULES.paidSeasonsPerDay);
  assert(same(r.data, { credited: 0, balance: balance + 25, capped: true, duplicate: false }), `the 21st doesn't: ${show(r)}`);
  assert(!(await ledgerOf(CAP)).some((l) => l.ref === "T-20"), "a capped season records nothing, so it can't pay later either");
  r = await credit(CAP, 25, "season", "T-19", COIN_RULES.paidSeasonsPerDay);
  assert(same(r.data, { credited: 0, balance: balance + 25, capped: true, duplicate: false }), `the cap is checked before duplicates: ${show(r)}`);
  r = await credit(CAP, 40, "daily", "2026-09-15:standard", null);
  assert(same(r.data, { credited: 40, balance: balance + 65, capped: false, duplicate: false }), `a Daily still pays: ${show(r)}`);
  r = await credit(CAP, 25, "season", "T-21");
  assert(r.data?.credited === 25 && r.data.capped === false, `no cap given is no cap: ${show(r)}`);
  // The cap is whatever submit-run sends.
  assert((await credit(CAP, 25, "season", "T-22", 22)).data?.credited === 25, "21 today is under a cap of 22");
  assert((await credit(CAP, 25, "season", "T-23", 22)).data?.capped === true, "22 today reaches it");
  assert((await credit(CAP, 25, "season", "T-24", 0)).data?.capped === true, "a cap of 0 pays nothing");
  const FRESH = await account("uncapped");
  assert((await credit(FRESH, 20, "season", "F-1", 1)).data?.credited === 20 && (await credit(FRESH, 20, "season", "F-2", 1)).data?.capped === true, "a cap of 1");
});

await runTest("the cap's day and the minigame's date are UTC days, whatever the session's time zone", async () => {
  const midnight = utcMidnight();
  const today = utcDate(Date.now());
  // Between them, these two zones put the local date on either side of the UTC date at every hour of the day.
  for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/New_York", "Asia/Kolkata"]) {
    const uid = await account(`tz_${zone.split("/")[1].slice(0, 8).toLowerCase()}`);
    await seedLedger(uid, 10, "season", "Y-1", iso(midnight - 9 * HOUR));
    await seedLedger(uid, 10, "season", "Y-2", iso(midnight - 1));
    await seedLedger(uid, 10, "season", "T-0", iso(midnight));
    await seedLedger(uid, 10, "season", "T-1");
    await seedSouRun(uid, iso(Date.now() - MINUTE));
    await inZone(zone, async () => {
      const a = await credit(uid, 5, "season", "TZ-A", 3);
      assert(a.data?.credited === 5, `${zone}: two seasons today are under a cap of 3, got ${show(a)}`);
      const b = await credit(uid, 5, "season", "TZ-B", 3);
      assert(b.data?.capped === true, `${zone}: three reach it, got ${show(b)}`);
      const c = await call(uid, "claim_minigame", { p_game: "over_under" });
      assert(c.data?.credited === COIN_RULES.minigame, `${zone}: the claim pays, got ${show(c)}`);
    });
    const refs = (await ledgerOf(uid)).filter((l) => l.kind === "minigame").map((l) => l.ref);
    assert(same(refs, [`over_under:${today}`]), `${zone}: the claim is dated by UTC, got ${show(refs)}`);
  }
});

// ---------- award_badges ----------

await runTest("award_badges pays each badge once, in the order sent, and records the ones that pay nothing", async () => {
  const FAY = await account("fay");
  let r = await award(FAY, badges(["first-down", 100], ["stat-nerd", 0], ["ring-bearer", 100]));
  assert(same(r.data, { awarded: ["first-down", "stat-nerd", "ring-bearer"], credited: 200, balance: 450 }), `first award: ${show(r)}`);
  assert(same(await awardsOf(FAY), ["first-down", "ring-bearer", "stat-nerd"]), "all three recorded, the unpaid one too");
  assert(same((await ledgerOf(FAY)).filter((l) => l.kind === "badge"), [{ amount: 100, kind: "badge", ref: "first-down" }, { amount: 100, kind: "badge", ref: "ring-bearer" }]), "only the paying ones are in the ledger");
  r = await award(FAY, badges(["first-down", 100], ["stat-nerd", 0], ["ring-bearer", 100], ["undefeated", 1000]));
  assert(same(r.data, { awarded: ["undefeated"], credited: 1000, balance: 1450 }), `next season, one new badge: ${show(r)}`);
  r = await award(FAY, badges(["first-down", 100], ["stat-nerd", 0], ["ring-bearer", 100], ["undefeated", 1000]));
  assert(same(r.data, { awarded: [], credited: 0, balance: 1450 }), `nothing new pays nothing: ${show(r)}`);
  r = await award(FAY, []);
  assert(same(r.data, { awarded: [], credited: 0, balance: 1450 }), `an empty list: ${show(r)}`);
  // The order is the list's, not the alphabet's - day-one would come first. And an id badge_rewards has no
  // price for is passed over whole: the last two leave no award, no ledger row and no coins.
  r = await award(FAY, badges(["dynasty", 300], ["dynasty", 300], ["hot-streak", 100], ["day-one", 500], ["zz-last", 5], ["aa-first", 5]));
  assert(same(r.data, { awarded: ["dynasty", "hot-streak", "day-one"], credited: 900, balance: 2350 }), `a repeated id counts once, and the order is the list's: ${show(r)}`);
  assert(!(await awardsOf(FAY)).some((b) => b === "zz-last" || b === "aa-first"),
    "a badge with no price isn't recorded either, so it still pays the day the database learns about it");
  // Already recorded, so nothing more - and 100 was never what stat-nerd pays in any case. The caller's
  // number is checked for shape and then thrown away; badge_rewards is what decides.
  r = await award(FAY, badges(["stat-nerd", 100]));
  assert(same(r.data, { awarded: [], credited: 0, balance: 2350 }), `a badge recorded at 0 coins doesn't pay later: ${show(r)}`);
  // A badge pays once even if its badge_awards row is deleted: the ledger still holds its payment.
  await owner("delete from badge_awards where user_id = $1 and badge = 'undefeated'", [FAY]);
  r = await award(FAY, badges(["undefeated", 1000]));
  assert(same(r.data, { awarded: ["undefeated"], credited: 0, balance: 2350 }), `re-awarded, not re-paid: ${show(r)}`);
  // A whole number written with a fraction or an exponent is still a whole number.
  r = await attempt(SERVICE, `select award_badges($1::uuid, '[{"id": "veteran", "coins": 300.0}, {"id": "starter", "coins": 1e2}]'::jsonb)`, [FAY]);
  assert(same(r.data, { awarded: ["veteran", "starter"], credited: 400, balance: 2750 }), `300.0 and 1e2: ${show(r)}`);
  // Fifty is the most one call takes - and fifty ids this database has never heard of buy exactly nothing.
  // Before badge_rewards these paid 49 coins between them, because the caller said they were worth that.
  const GUS = await account("gus");
  r = await award(GUS, Array.from({ length: 50 }, (_, i) => ({ id: `b-${i}`, coins: i % 3 })));
  assert(same(r.data, { awarded: [], credited: 0, balance: 250 }), `fifty badges nobody has priced: ${show(r)}`);
  assert(same(await awardsOf(GUS), []), "none of them recorded either");
  assert((await ledgerOf(GUS)).filter((l) => l.kind === "badge").length === 0, "and nothing in the ledger");
  // A real badge in amongst them is still paid, and still paid the catalog's price rather than the caller's.
  r = await award(GUS, [{ id: "b-0", coins: 9 }, { id: "veteran", coins: 10000 }, { id: "b-1", coins: 9 }]);
  assert(same(r.data, { awarded: ["veteran"], credited: 300, balance: 550 }), `veteran is worth 300, whatever the caller says: ${show(r)}`);
  // The badges that pay nothing are still recorded, which is what makes their shop items yours.
  const GEM = await account("gem");
  r = await award(GEM, badges(["stat-nerd", 500], ["mad-scientist", 500]));
  assert(same(r.data, { awarded: ["stat-nerd", "mad-scientist"], credited: 0, balance: 250 }), `both recorded, neither paid: ${show(r)}`);
  assert(same(await awardsOf(GEM), ["mad-scientist", "stat-nerd"]), "both are on the account");
});

await runTest("award_badges refuses a malformed list outright (bad_request) and an unknown player (no_such_player), writing nothing", async () => {
  const HAL = await account("hal");
  const before = await totals();
  const refusals = [
    [GHOST, [], "no_such_player"],
    [null, badges(["first-down", 100]), "no_such_player"],
    [GHOST, null, "no_such_player"], // checked first
    [HAL, null, "bad_request"],
    [HAL, {}, "bad_request"],
    [HAL, { id: "first-down", coins: 100 }, "bad_request"],
    [HAL, "first-down", "bad_request"],
    [HAL, 7, "bad_request"],
    [HAL, Array.from({ length: 51 }, (_, i) => ({ id: `b-${i}`, coins: 1 })), "bad_request"],
    [HAL, [null], "bad_request"],
    [HAL, ["first-down"], "bad_request"],
    [HAL, [[{ id: "first-down", coins: 100 }]], "bad_request"],
    [HAL, [{ id: "first-down" }], "bad_request"],
    [HAL, [{ coins: 100 }], "bad_request"],
    [HAL, [{ id: "first-down", coins: "100" }], "bad_request"],
    [HAL, [{ id: "first-down", coins: null }], "bad_request"],
    [HAL, [{ id: "first-down", coins: true }], "bad_request"],
    [HAL, [{ id: "first-down", coins: 1.5 }], "bad_request"],
    [HAL, [{ id: "first-down", coins: -1 }], "bad_request"],
    [HAL, [{ id: "first-down", coins: 10001 }], "bad_request"],
    [HAL, [{ id: 5, coins: 1 }], "bad_request"],
    [HAL, [{ id: "", coins: 1 }], "bad_request"],
    [HAL, [{ id: "a".repeat(41), coins: 1 }], "bad_request"],
    [HAL, [{ id: "First-Down", coins: 1 }], "bad_request"],
    [HAL, [{ id: "first_down", coins: 1 }], "bad_request"],
    [HAL, [{ id: "first down", coins: 1 }], "bad_request"],
    [HAL, [{ id: "first-down\n", coins: 1 }], "bad_request"],
    // One bad entry refuses the whole list, the good ones before it included.
    [HAL, [{ id: "first-down", coins: 100 }, { id: "ring-bearer", coins: 100 }, { id: "Bad", coins: 1 }], "bad_request"],
  ];
  for (const [uid, list, code] of refusals) {
    const r = await award(uid, list);
    assert(r.error === code, `award_badges(${uid === HAL ? "hal" : uid}, ${show(list).slice(0, 80)}) should raise ${code}, got ${show(r)}`);
  }
  for (const literal of ["null", `[{"id": "first-down", "coins": 100.5}]`, `[{"id": "first-down", "coins": 1e-3}]`]) {
    const r = await attempt(SERVICE, `select award_badges($1::uuid, '${literal}'::jsonb)`, [HAL]);
    assert(r.error === "bad_request", `${literal} should be bad_request, got ${show(r)}`);
  }
  assert(same(await totals(), before), "a refused award writes nothing");
  // 51 is refused above; 50 is taken. None of them is a real badge, so the answer is an empty list rather
  // than an error - the length limit is about the payload, not about what is in it.
  const fifty = await award(HAL, Array.from({ length: 50 }, (_, i) => ({ id: `b-${i}`, coins: 0 })));
  assert(!fifty.error && same(fifty.data?.awarded, []), `exactly 50 is fine: ${show(fifty)}`);
});

// ---------- claim_minigame ----------

await runTest("claim_minigame pays 15 once a UTC day, only for a game played in the last 24 hours", async () => {
  const IVY = await account("ivy"), JON = await account("jon");
  const refusals = [
    [GHOST, "over_under", "not_signed_in"],
    [GHOST, "nope", "not_signed_in"], // checked first
    [IVY, null, "bad_game"],
    ...["nope", "Over_Under", "overunder", " build", "builds", "sou", ""].map((game) => [IVY, game, "bad_game"]),
    [IVY, "over_under", "not_played"],
    [IVY, "build", "not_played"],
  ];
  const before = await totals();
  for (const [uid, game, code] of refusals) {
    const r = await call(uid, "claim_minigame", { p_game: game });
    assert(r.error === code, `claim_minigame(${show(game)}) as ${uid === GHOST ? "a session with no account" : "ivy"} should raise ${code}, got ${show(r)}`);
  }
  assert(same(await totals(), before), "a refused claim writes nothing, not even a wallet");

  const now = Date.now();
  await seedSouRun(IVY, iso(now - 24 * HOUR - MINUTE)); // just too long ago
  await seedSouRun(JON, iso(now - MINUTE)); // someone else's
  await seedBuild(IVY, iso(now - MINUTE)); // a build, not an Over/Under run
  let r = await call(IVY, "claim_minigame", { p_game: "over_under" });
  assert(r.error === "not_played", `a run from over 24 hours ago, another player's run and a build don't count for Over/Under: ${show(r)}`);
  r = await call(IVY, "claim_minigame", { p_game: "build" });
  assert(same(r.data, { credited: COIN_RULES.minigame, balance: 250 + COIN_RULES.minigame }), `a build from a minute ago pays: ${show(r)}`);
  r = await call(IVY, "claim_minigame", { p_game: "build" });
  assert(same(r.data, { credited: 0, balance: 265 }), `once a day: ${show(r)}`);
  await seedSouRun(IVY, iso(now - 24 * HOUR + MINUTE)); // just inside the window
  r = await call(IVY, "claim_minigame", { p_game: "over_under" });
  assert(same(r.data, { credited: 15, balance: 280 }), `a run from 23 hours 59 minutes ago pays: ${show(r)}`);
  r = await call(IVY, "claim_minigame", { p_game: "over_under" });
  assert(same(r.data, { credited: 0, balance: 280 }), `again today pays nothing: ${show(r)}`);
  const today = utcDate(Date.now());
  assert(same((await ledgerOf(IVY)).filter((l) => l.kind === "minigame"), [{ amount: 15, kind: "minigame", ref: `build:${today}` }, { amount: 15, kind: "minigame", ref: `over_under:${today}` }]),
    `ivy's claims: ${show(await ledgerOf(IVY))}`);
  // Yesterday's claim doesn't use up today's.
  await seedLedger(JON, 15, "minigame", `over_under:${utcDate(utcMidnight() - 1)}`, iso(utcMidnight() - HOUR));
  r = await call(JON, "claim_minigame", { p_game: "over_under" });
  assert(same(r.data, { credited: 15, balance: 280 }), `yesterday's claim doesn't block today's: ${show(r)}`);
});

await runTest("claim_minigame with the game's own day: once a game day, for an Over/Under run on that date or a build from the last 24 hours, and only for a day some time zone could call today", async () => {
  const MAY = await account("may"), NIA = await account("nia");
  const midnight = utcMidnight();
  const today = utcDate(Date.now()), yesterday = utcDate(midnight - 1), tomorrow = utcDate(midnight + 24 * HOUR);
  for (const day of [utcDate(midnight - 24 * HOUR - 1), utcDate(midnight + 48 * HOUR), "2026-9-15", "", "today", `${today} `]) {
    const r = await call(MAY, "claim_minigame", { p_game: "over_under", p_date: day });
    assert(r.error === "bad_date", `${show(day)} isn't a day some time zone could call today: ${show(r)}`);
  }
  const souRunOn = (uid, date) => owner("insert into sou_runs (date, user_id, username, score) values ($1, $2, 'x', 9)", [date, uid]);
  assert((await call(MAY, "claim_minigame", { p_game: "over_under", p_date: today })).error === "not_played", "no run on that date");
  await souRunOn(NIA, today);
  assert((await call(MAY, "claim_minigame", { p_game: "over_under", p_date: today })).error === "not_played", "another player's run doesn't count");
  // Two evenings' games either side of UTC midnight have different days in the player's calendar, so both pay.
  await souRunOn(MAY, yesterday);
  await souRunOn(MAY, today);
  let r = await call(MAY, "claim_minigame", { p_game: "over_under", p_date: yesterday });
  assert(r.data?.credited === COIN_RULES.minigame, `yesterday's game pays: ${show(r)}`);
  r = await call(MAY, "claim_minigame", { p_game: "over_under", p_date: today });
  assert(r.data?.credited === COIN_RULES.minigame, `and today's game too, whatever the UTC date: ${show(r)}`);
  r = await call(MAY, "claim_minigame", { p_game: "over_under", p_date: today });
  assert(r.data?.credited === 0, `once a game day: ${show(r)}`);
  assert((await call(MAY, "claim_minigame", { p_game: "build", p_date: tomorrow })).error === "not_played", "no build yet");
  await seedBuild(MAY, iso(Date.now() - MINUTE));
  r = await call(MAY, "claim_minigame", { p_game: "build", p_date: tomorrow });
  assert(r.data?.credited === COIN_RULES.minigame, `a build pays under the day it was made: ${show(r)}`);
  const refs = (await ledgerOf(MAY)).filter((l) => l.kind === "minigame").map((l) => l.ref).sort();
  assert(same(refs, [`build:${tomorrow}`, `over_under:${today}`, `over_under:${yesterday}`].sort()), `keyed by the game's day: ${show(refs)}`);
});

// ---------- wallet_state ----------

await runTest("wallet_state: balance, earned, spent and the 20 newest movements, newest first, ties newest id first", async () => {
  const KIM = await account("kim"), LEO = await account("leo");
  let r = await call(KIM, "wallet_state");
  assert(same(Object.keys(r.data || {}).sort(), ["balance", "earned", "recent", "spent"]), `the contract's keys: ${show(r)}`);
  assert(r.data.balance === 250 && r.data.earned === 250 && r.data.spent === 0 && r.data.recent.length === 1, `a new account: ${show(r)}`);
  assert(same(Object.keys(r.data.recent[0]).sort(), ["amount", "created_at", "kind", "ref"]) && same({ ...r.data.recent[0], created_at: null }, { amount: 250, kind: "welcome", ref: "welcome", created_at: null }),
    `a movement's keys: ${show(r.data.recent[0])}`);
  assert(!Number.isNaN(Date.parse(r.data.recent[0].created_at)), "created_at is a timestamp");

  const midnight = utcMidnight();
  for (let i = 1; i <= 22; i++) await seedLedger(KIM, i, "season", `S-${i}`, iso(midnight - 3 * HOUR - i * MINUTE));
  // Three at the very same moment, and a purchase.
  for (const ref of ["tie-a", "tie-b", "tie-c"]) await seedLedger(KIM, 7, "badge", ref, iso(midnight - 2 * HOUR));
  await seedLedger(KIM, -300, "purchase", "frame-lime", iso(midnight - HOUR));
  await seedLedger(LEO, 999, "season", "LEO-ONLY", iso(midnight - HOUR));

  r = await call(KIM, "wallet_state");
  const direct = await owner(`select amount, kind, ref, to_jsonb(created_at) as created_at from wallet_ledger where user_id = $1
                               order by created_at desc, id desc limit 20`, [KIM]);
  assert(r.data.recent.length === 20 && same(r.data.recent, direct), `the 20 newest, newest first: ${show(r.data.recent)}`);
  assert(same(r.data.recent.slice(0, 5).map((m) => m.ref), ["welcome", "frame-lime", "tie-c", "tie-b", "tie-a"]), `order, with the tie in reverse insert order: ${show(r.data.recent.map((m) => m.ref))}`);
  assert(r.data.recent[1].amount === -300, "a purchase is a negative amount");
  const sums = (await owner(`select sum(amount)::bigint as balance, (sum(amount) filter (where amount > 0))::bigint as earned,
                              coalesce(-sum(amount) filter (where amount < 0), 0)::bigint as spent from wallet_ledger where user_id = $1`, [KIM]))[0];
  assert(r.data.balance === sums.balance && r.data.earned === sums.earned && r.data.spent === 300 && sums.spent === 300, `totals are the ledger's: ${show(r.data)} vs ${show(sums)}`);
  assert(!r.data.recent.some((m) => m.ref === "LEO-ONLY"), "only your own movements");

  // No wallet yet: zeros, and reading doesn't make one.
  await owner("delete from wallet_ledger where user_id = $1", [LEO]);
  await owner("delete from wallets where user_id = $1", [LEO]);
  r = await call(LEO, "wallet_state");
  assert(same(r.data, { balance: 0, earned: 0, spent: 0, recent: [] }), `no wallet: ${show(r)}`);
  assert((await walletOf(LEO)) === null, "wallet_state creates no wallet");
});

await runTest("wallet_state works in a read-only transaction, as PostgREST runs a GET - which is why it takes no lock", async () => {
  const MIA = await account("mia");
  await db.exec("begin read only");
  let r;
  try {
    r = await call(MIA, "wallet_state");
  } finally {
    await db.exec("rollback");
  }
  assert(r.data?.balance === 250, `wallet_state in a read-only transaction: ${show(r)}`);
  await db.exec("begin read only");
  let err;
  try {
    err = await failure(db, "select wallet_lock($1::uuid)", [MIA]);
  } finally {
    await db.exec("rollback");
  }
  assert(/read-only transaction/.test(err), `the lock itself can't run there: ${show(err)}`);
});

// ---------- The lock and the constraints ----------

await runTest("credit_coins, award_badges and claim_minigame lock the wallet row before reading the ledger; wallet_state locks nothing", async () => {
  const NED = await account("ned");
  await seedSouRun(NED, iso(Date.now() - MINUTE));
  // The table-level lock a `select ... for update` leaves behind is RowShareLock; plain reads take AccessShareLock.
  async function locksDuring(run) {
    await db.exec("begin");
    try {
      await run();
      return (await owner("select mode from pg_locks where locktype = 'relation' and relation = 'public.wallets'::regclass and pid = pg_backend_pid() order by mode")).map((r) => r.mode);
    } finally {
      await db.exec("rollback");
    }
  }
  const expectOk = (r) => assert(r && !r.error, `the call should succeed: ${show(r)}`);
  const runs = {
    credit_coins: () => credit(NED, 20, "season", "LOCK-1", 20).then(expectOk),
    "credit_coins (capped)": () => credit(NED, 20, "season", "LOCK-2", 0).then(expectOk),
    award_badges: () => award(NED, badges(["first-down", 100])).then(expectOk),
    "award_badges (nothing new)": () => award(NED, []).then(expectOk),
    claim_minigame: () => call(NED, "claim_minigame", { p_game: "over_under" }).then(expectOk),
  };
  for (const [label, run] of Object.entries(runs)) {
    const modes = await locksDuring(run);
    assert(modes.includes("RowShareLock"), `${label} locks the wallet row: ${show(modes)}`);
  }
  const reading = await locksDuring(() => call(NED, "wallet_state").then(expectOk));
  assert(same(reading, ["AccessShareLock"]), `wallet_state only reads: ${show(reading)}`);

  // And in each function the lock comes before the first read of the ledger or badge_awards, so the cap's count and
  // the checks behind it happen with the row held.
  const source = async (sig) => (await owner("select prosrc from pg_proc where oid = $1::regprocedure", [sig]))[0].prosrc.replace(/--[^\n]*/g, "");
  const order = [
    ["public.credit_coins(uuid, bigint, text, text, integer)", ["wallet_ledger", "wallet_apply("]],
    ["public.award_badges(uuid, jsonb)", ["badge_awards", "wallet_apply("]],
    ["public.claim_minigame(text, text)", ["wallet_apply("]],
  ];
  for (const [sig, later] of order) {
    const body = await source(sig);
    const lock = body.indexOf("wallet_lock(");
    for (const word of later) assert(lock >= 0 && lock < body.indexOf(word), `${sig}: wallet_lock comes before ${word}`);
  }
  assert(!(await source("public.wallet_state()")).includes("wallet_lock("), "wallet_state doesn't lock");
});

await runTest("the tables refuse a double payment, a balance that doesn't add up, a negative balance and bad rows", async () => {
  const OLA = await account("ola"), PAT = await account("pat");
  const refused = [
    ["insert into wallet_ledger (user_id, amount, kind, ref) values ($1, 250, 'welcome', 'welcome')", /unique constraint "wallet_ledger_user_id_kind_ref_key"/],
    ["insert into wallet_ledger (user_id, amount, kind, ref) values ($1, 0, 'season', 'Z')", /wallet_ledger_amount_check/],
    ["insert into wallet_ledger (user_id, amount, kind, ref) values ($1, 5, 'gift', 'Z')", /wallet_ledger_kind_check/],
    ["insert into wallet_ledger (user_id, amount, kind, ref) values ($1, 5, 'season', '')", /wallet_ledger_ref_check/],
    [`insert into wallet_ledger (user_id, amount, kind, ref) values ($1, 5, 'season', '${"x".repeat(201)}')`, /wallet_ledger_ref_check/],
    ["update wallets set balance = balance + 100 where user_id = $1", /wallets_balance_adds_up/],
    ["update wallets set spent = earned + 1, balance = -1 where user_id = $1", /wallets_balance_check/],
    ["insert into badge_awards (user_id, badge) values ($1, 'Undefeated')", /badge_awards_badge_check/],
    ["insert into finished_codes (user_id, code) values ($1, '')", /finished_codes_code_check/],
    [`insert into finished_codes (user_id, code) values ($1, '${"X".repeat(33)}')`, /finished_codes_code_check/],
  ];
  for (const [statement, pattern] of refused) {
    const err = await failure(db, statement, [OLA]);
    assert(pattern.test(err), `"${statement.slice(0, 90)}" should be refused (${pattern}), got ${show(err)}`);
  }
  // A debit the balance can't cover rolls the whole call back: no ledger row, no change.
  const err = await failure(db, "select wallet_apply($1::uuid, -1000000::bigint, 'purchase', 'frame-gold')", [OLA]);
  assert(/wallets_balance_check/.test(err), `an overdraft breaks the balance check: ${show(err)}`);
  assert(same(await ledgerOf(OLA), [{ amount: 250, kind: "welcome", ref: "welcome" }]) && same(await walletOf(OLA), { balance: 250, earned: 250, spent: 0 }), "and leaves nothing behind");
  // A spend that fits works, through the same helper the shop uses.
  assert((await owner("select wallet_apply($1::uuid, -250::bigint, 'purchase', 'frame-lime') as n", [OLA]))[0].n === -250, "spending the whole balance is fine");
  assert(same(await walletOf(OLA), { balance: 0, earned: 250, spent: 250 }), `a spent wallet: ${show(await walletOf(OLA))}`);

  // finished_codes: one row per player and code - the unique violation submit-run answers "already recorded" for.
  await owner("insert into finished_codes (user_id, code) values ($1, 'K3F9QZ'), ($2, 'K3F9QZ')", [OLA, PAT]);
  await owner("insert into finished_codes (user_id, code) values ($1, $2)", [OLA, "😀".repeat(32)]);
  let dup = null;
  try {
    await db.query("insert into finished_codes (user_id, code) values ($1, 'K3F9QZ')", [OLA]);
  } catch (e) {
    dup = e;
  }
  assert(dup?.code === "23505" && dup.constraint === "finished_codes_pkey", `a repeated code is a unique violation: ${show({ code: dup?.code, constraint: dup?.constraint })}`);
  await owner("insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [OLA]);
  assert(/badge_awards_pkey/.test(await failure(db, "insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [OLA])), "a badge is recorded once per player");

  // Deleting an account deletes its coins.
  await owner("delete from auth.users where id = $1", [OLA]);
  const left = (await owner(`select (select count(*)::int from wallets where user_id = $1) + (select count(*)::int from wallet_ledger where user_id = $1)
                              + (select count(*)::int from badge_awards where user_id = $1) + (select count(*)::int from finished_codes where user_id = $1) as n`, [OLA]))[0].n;
  assert(left === 0, `nothing of a deleted account is left, got ${left} rows`);
  assert((await owner("select count(*)::int as n from finished_codes where user_id = $1", [PAT]))[0].n === 1, "another player's code is untouched");
});

// ---------- New accounts ----------

// The one thing badge_rewards cannot check for itself. Its rows are a copy of badges.mjs - the same kind of
// copy as the welcome coins and the minigame's 15, and there for the same reason: the number has to exist in
// SQL, because the database is what pays it, while the browser prints its own line from the catalog in the
// repo. If the two drift, a player is shown one figure and credited another, and nothing else in this suite
// would notice, because both sides of every mock-vs-SQL comparison read the same list.
await runTest("badge_rewards is badges.mjs, badge for badge and coin for coin", async () => {
  const rows = await owner("select badge, coins from badge_rewards order by badge");
  const want = BADGES.map((b) => ({ badge: b.id, coins: b.coins })).sort((a, b) => (a.badge < b.badge ? -1 : 1));
  assert(rows.length === BADGES.length, `every badge is priced: ${rows.length} rows for ${BADGES.length} badges`);
  assert(same(rows, want), `badge_rewards differs from badges.mjs: sql ${show(rows)} vs repo ${show(want)}`);
});

await runTest("a new account starts with its welcome coins, exactly once", async () => {
  const QUIN = await account("quin");
  assert(same(await ledgerOf(QUIN), [{ amount: COIN_RULES.welcome, kind: "welcome", ref: "welcome" }]), `the welcome row: ${show(await ledgerOf(QUIN))}`);
  assert(same(await walletOf(QUIN), { balance: COIN_RULES.welcome, earned: COIN_RULES.welcome, spent: 0 }), `the wallet: ${show(await walletOf(QUIN))}`);
  // submit-run updating the profile after a season pays nothing more.
  await owner("update profiles set runs = runs + 1, wins = wins + 12, champs = champs + 1 where id = $1", [QUIN]);
  assert((await ledgerOf(QUIN)).length === 1, "a profile update isn't a new account");
  assert((await owner("select wallet_apply($1::uuid, 250::bigint, 'welcome', 'welcome') as n", [QUIN]))[0].n === 0, "and a second welcome can't be recorded");
  // A refused signup creates no profile, so no wallet either.
  const refusedId = uuid(77777);
  assert((await failure(db, "insert into auth.users values ($1, $2)", [refusedId, { username: "has space" }])) === "username_invalid", "the signup is refused");
  assert((await walletOf(refusedId)) === null && (await ledgerOf(refusedId)).length === 0, "and leaves no coins behind");
});

// ---------- The mock against the SQL ----------

await runTest("the mock gives the same answers as the SQL for one shared list of calls, and ends with the same rows", async () => {
  const names = ["ann", "ben", "cat", "dan", "eve", "fay_p", "gil"];
  const P = {};
  let current = null;
  const state = { profiles: new Map(), souRuns: new Map(), builds: new Map(), currentUserId: () => current };
  const mock = makeWallet(state);
  for (const name of names) {
    P[name] = await account(`parity_${name}`);
    state.profiles.set(P[name], { id: P[name], username: `parity_${name}` });
    mock.welcome(P[name]); // the signup trigger
  }
  const ids = new Set(Object.values(P));

  // Setup applied to both sides the same way.
  let mockDay = 0;
  const setup = {
    souRun: async (uid, ago) => {
      const created = iso(Date.now() - ago);
      await seedSouRun(uid, created);
      state.souRuns.set(`m-${++mockDay}:${uid}`, { user_id: uid, score: 9, created_at: created });
    },
    // An Over/Under run on a real date, for a claim that names the game's day.
    souRunOn: async (uid, date) => {
      await owner("insert into sou_runs (date, user_id, username, score) values ($1, $2, 'x', 9)", [date, uid]);
      state.souRuns.set(`${date}:${uid}`, { date, user_id: uid, score: 9, created_at: new Date().toISOString() });
    },
    build: async (uid, ago) => {
      const created = iso(Date.now() - ago);
      await seedBuild(uid, created);
      state.builds.set(`build-${++mockDay}`, { user_id: uid, pos: "WR", overall: 91.5, created_at: created });
    },
    ledger: async (uid, amount, kind, ref, createdAt = null) => {
      await seedLedger(uid, amount, kind, ref, createdAt);
      mock.apply(uid, amount, kind, ref);
      if (createdAt) mock.tables.wallet_ledger.get(`${uid}|${kind}|${ref}`).created_at = createdAt;
    },
    dropWallet: async (uid) => {
      await owner("delete from wallet_ledger where user_id = $1", [uid]);
      await owner("delete from wallets where user_id = $1", [uid]);
      for (const [key, row] of mock.tables.wallet_ledger) if (row.user_id === uid) mock.tables.wallet_ledger.delete(key);
      mock.tables.wallets.delete(uid);
    },
  };
  const midnight = utcMidnight();
  const today = utcDate(Date.now());
  const yesterday = utcDate(midnight - 1);
  const tomorrow = utcDate(midnight + 24 * HOUR);
  const dayBeforeYesterday = utcDate(midnight - 24 * HOUR - 1);

  const STEPS = [
    // credit_coins: every refusal, in order
    ["server", "credit_coins", { p_user: GHOST, p_amount: 20, p_kind: "season", p_ref: "A1", p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: null, p_amount: 20, p_kind: "season", p_ref: "A1", p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: GHOST, p_amount: -5, p_kind: "bogus", p_ref: "" }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 20, p_kind: "purchase", p_ref: "A1" }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 20, p_kind: null, p_ref: "A1", p_daily_cap: null }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: -1, p_kind: "welcome", p_ref: "" }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: -1, p_kind: "season", p_ref: "" }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: null, p_kind: "season", p_ref: "A1" }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 10001, p_kind: "daily", p_ref: "A1" }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 20, p_kind: "season", p_ref: "" }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 20, p_kind: "season", p_ref: null }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 20, p_kind: "season", p_ref: "x".repeat(201) }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 20, p_kind: "season", p_ref: "😀".repeat(201) }],
    // credit_coins: answers
    ["server", "credit_coins", { p_user: "@ann", p_amount: 20, p_kind: "season", p_ref: "😀".repeat(200), p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 20, p_kind: "season", p_ref: "x".repeat(200), p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 88, p_kind: "season", p_ref: "K3F9QZ", p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 88, p_kind: "season", p_ref: "K3F9QZ", p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 0, p_kind: "season", p_ref: "ZERO", p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 10000, p_kind: "daily", p_ref: `${today}:fantasy` }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 57, p_kind: "daily", p_ref: `${today}:fantasy`, p_daily_cap: null }],
    ["server", "credit_coins", { p_user: "@ann", p_amount: 64, p_kind: "daily", p_ref: "K3F9QZ", p_daily_cap: null }],
    ["server", "credit_coins", { p_user: "@ben", p_amount: 88, p_kind: "season", p_ref: "K3F9QZ", p_daily_cap: 20 }],
    // the cap: cat has 19 seasons today (one exactly at midnight) and 3 from just before it
    ["setup", async () => {
      for (const [ref, at] of [["Y-1", midnight - 5 * HOUR], ["Y-2", midnight - MINUTE], ["Y-3", midnight - 1], ["T-0", midnight]]) await setup.ledger(P.cat, 30, "season", ref, iso(at));
      for (let i = 1; i <= 18; i++) await setup.ledger(P.cat, 30, "season", `T-${i}`);
      await setup.ledger(P.cat, 30, "badge", "first-down");
    }],
    ["server", "credit_coins", { p_user: "@cat", p_amount: 25, p_kind: "season", p_ref: "C-19", p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: "@cat", p_amount: 25, p_kind: "season", p_ref: "C-20", p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: "@cat", p_amount: 25, p_kind: "season", p_ref: "C-19", p_daily_cap: 20 }],
    ["server", "credit_coins", { p_user: "@cat", p_amount: 25, p_kind: "season", p_ref: "C-20", p_daily_cap: 21 }],
    ["server", "credit_coins", { p_user: "@cat", p_amount: 25, p_kind: "season", p_ref: "C-21", p_daily_cap: 21 }],
    ["server", "credit_coins", { p_user: "@cat", p_amount: 40, p_kind: "daily", p_ref: `${today}:standard`, p_daily_cap: null }],
    ["server", "credit_coins", { p_user: "@cat", p_amount: 25, p_kind: "season", p_ref: "C-22" }],
    ["server", "credit_coins", { p_user: "@cat", p_amount: 25, p_kind: "season", p_ref: "C-23", p_daily_cap: 0 }],
    // a player with no wallet gets one, capped or not
    ["setup", () => setup.dropWallet(P.dan)],
    ["server", "credit_coins", { p_user: "@dan", p_amount: 5, p_kind: "season", p_ref: "D-1", p_daily_cap: 0 }],
    ["server", "credit_coins", { p_user: "@dan", p_amount: 5, p_kind: "season", p_ref: "D-1", p_daily_cap: 1 }],
    ["server", "credit_coins", { p_user: "@dan", p_amount: 5, p_kind: "season", p_ref: "D-2", p_daily_cap: 1 }],
    // award_badges: refusals
    ["server", "award_badges", { p_user: GHOST, p_badges: [] }],
    ["server", "award_badges", { p_user: GHOST, p_badges: null }],
    ["server", "award_badges", { p_user: "@eve", p_badges: null }],
    ["server", "award_badges", { p_user: "@eve", p_badges: {} }],
    ["server", "award_badges", { p_user: "@eve", p_badges: "first-down" }],
    ["server", "award_badges", { p_user: "@eve", p_badges: 7 }],
    ["server", "award_badges", { p_user: "@eve", p_badges: Array.from({ length: 51 }, (_, i) => ({ id: `b-${i}`, coins: 1 })) }],
    ["server", "award_badges", { p_user: "@eve", p_badges: [{ id: "first-down", coins: 100 }, { id: "Ring-Bearer", coins: 100 }] }],
    ...[{ id: "first-down" }, { id: "first-down", coins: "100" }, { id: "first-down", coins: 1.5 }, { id: "first-down", coins: -1 },
      { id: "first-down", coins: 10001 }, { id: "first-down", coins: null }, { id: "first-down", coins: true }, { id: 5, coins: 1 },
      { id: "", coins: 1 }, { id: "a".repeat(41), coins: 1 }, { id: "first_down", coins: 1 }, { id: "first-down\n", coins: 1 }, null, "first-down", []]
      .map((entry) => ["server", "award_badges", { p_user: "@eve", p_badges: [entry] }]),
    // award_badges: answers
    ["server", "award_badges", { p_user: "@eve", p_badges: badges(["first-down", 100], ["stat-nerd", 0], ["ring-bearer", 100]) }],
    ["server", "award_badges", { p_user: "@eve", p_badges: badges(["first-down", 100], ["stat-nerd", 0], ["ring-bearer", 100], ["undefeated", 1000]) }],
    ["server", "award_badges", { p_user: "@eve", p_badges: badges(["first-down", 100], ["stat-nerd", 0], ["ring-bearer", 100], ["undefeated", 1000]) }],
    ["server", "award_badges", { p_user: "@eve", p_badges: [] }],
    ["server", "award_badges", { p_user: "@eve", p_badges: badges(["dynasty", 300], ["dynasty", 300], ["zz-last", 5], ["aa-first", 5]) }],
    ["server", "award_badges", { p_user: "@eve", p_badges: badges(["stat-nerd", 100]) }],
    ["server", "award_badges", { p_user: "@eve", p_badges: badges(["big-brain", 10000]) }],
    ["server", "award_badges", { p_user: "@ben", p_badges: Array.from({ length: 50 }, (_, i) => ({ id: `b-${i}`, coins: i % 3 })) }],
    // Real ones, at prices the caller has made up, mixed in with ids that have none.
    ["server", "award_badges", { p_user: "@ben", p_badges: badges(["veteran", 1], ["zz-last", 5], ["day-one", 9999], ["mad-scientist", 700], ["hall-of-famer", 0]) }],
    // claim_minigame
    ["ghost", "claim_minigame", { p_game: "over_under" }],
    ["ghost", "claim_minigame", { p_game: "nope" }],
    ["ghost", "wallet_state", {}],
    ["fay_p", "claim_minigame", { p_game: null }],
    ["fay_p", "claim_minigame", { p_game: "Over_Under" }],
    ["fay_p", "claim_minigame", { p_game: "builds" }],
    ["fay_p", "claim_minigame", { p_game: "over_under" }],
    ["fay_p", "claim_minigame", { p_game: "build" }],
    ["setup", async () => {
      await setup.souRun(P.fay_p, 24 * HOUR + MINUTE);
      await setup.souRun(P.gil, MINUTE);
      await setup.build(P.fay_p, MINUTE);
    }],
    ["fay_p", "claim_minigame", { p_game: "over_under" }],
    ["fay_p", "claim_minigame", { p_game: "build" }],
    ["fay_p", "claim_minigame", { p_game: "build" }],
    ["setup", () => setup.souRun(P.fay_p, 24 * HOUR - MINUTE)],
    ["fay_p", "claim_minigame", { p_game: "over_under" }],
    ["fay_p", "claim_minigame", { p_game: "over_under" }],
    ["setup", () => setup.ledger(P.gil, 15, "minigame", `over_under:${yesterday}`, iso(midnight - HOUR))],
    ["gil", "claim_minigame", { p_game: "over_under" }],
    ["gil", "claim_minigame", { p_game: "build" }],
    // claim_minigame with the game's day
    ["fay_p", "claim_minigame", { p_game: "over_under", p_date: dayBeforeYesterday }],
    ["fay_p", "claim_minigame", { p_game: "over_under", p_date: "2026-9-15" }],
    ["ghost", "claim_minigame", { p_game: "over_under", p_date: today }],
    ["fay_p", "claim_minigame", { p_game: "nope", p_date: "not a date" }],
    ["fay_p", "claim_minigame", { p_game: "over_under", p_date: tomorrow }],
    ["setup", () => setup.souRunOn(P.fay_p, tomorrow)],
    ["fay_p", "claim_minigame", { p_game: "over_under", p_date: tomorrow }],
    ["fay_p", "claim_minigame", { p_game: "over_under", p_date: tomorrow }],
    ["fay_p", "claim_minigame", { p_game: "build", p_date: yesterday }],
    ["fay_p", "claim_minigame", { p_game: "build", p_date: yesterday }],
    ["gil", "claim_minigame", { p_game: "build", p_date: today }],
    // wallet_state
    ["fay_p", "wallet_state", {}],
    ["setup", async () => {
      for (let i = 1; i <= 22; i++) await setup.ledger(P.gil, i, "season", `G-${i}`, iso(midnight - (i % 4) * HOUR - i * MINUTE));
      for (const ref of ["tie-a", "tie-b", "tie-c"]) await setup.ledger(P.gil, 7, "badge", ref, iso(midnight - 30 * MINUTE));
      await setup.ledger(P.gil, -260, "purchase", "frame-lime", iso(midnight - 29 * MINUTE));
    }],
    ["gil", "wallet_state", {}],
    ["setup", () => setup.dropWallet(P.dan)],
    ...["dan", "eve", "cat", "ann", "ben"].map((name) => [name, "wallet_state", {}]),
  ];

  const resolve = (args) => Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" && v.startsWith("@") ? P[v.slice(1)] : v]));
  const actor = (who) => (who === "server" ? SERVICE : who === "ghost" ? GHOST : P[who]);
  function mockCall(who, fn, args) {
    current = who === "server" ? null : actor(who);
    try {
      return { data: (who === "server" ? mock.server : mock.rpcs)[fn](args) };
    } catch (e) {
      return { error: e.message };
    } finally {
      current = null;
    }
  }
  // Clocks differ between the two, so a time becomes "<time>" once it's known to parse; the order it sorted in stays.
  const comparable = (v, key) => {
    if (key === "created_at") return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? "<time>" : `unparseable ${v}`;
    if (Array.isArray(v)) return v.map((x) => comparable(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, comparable(v[k], k)]));
    return v;
  };
  let steps = 0;
  for (const [i, [who, fn, args]] of STEPS.entries()) {
    if (who === "setup") {
      await fn();
      continue;
    }
    const resolved = resolve(args);
    const fromSql = comparable(await call(actor(who), fn, resolved));
    const fromMock = comparable(mockCall(who, fn, resolved));
    assert(same(fromSql, fromMock), `step ${i + 1} (${who}: ${fn} ${show(args).slice(0, 90)}): sql ${show(fromSql)} vs mock ${show(fromMock)}`);
    steps++;
  }
  assert(steps >= 80, `the whole list ran: ${steps} calls`);

  // And the same rows afterwards.
  const mine = (rows) => rows.filter((r) => ids.has(r.user_id));
  const sorted = (rows) => rows.map((r) => JSON.stringify(canon(r))).sort();
  const sqlWallets = mine(await owner("select user_id, balance, earned, spent from wallets"));
  const mockWallets = mine([...mock.tables.wallets.values()].map(({ user_id, balance, earned, spent }) => ({ user_id, balance, earned, spent })));
  assert(same(sorted(sqlWallets), sorted(mockWallets)), `wallets differ: ${show(sorted(sqlWallets))} vs ${show(sorted(mockWallets))}`);
  assert(!sqlWallets.some((w) => w.user_id === P.dan), "reading dan's empty wallet made none, on either side");
  // Per player, newest first, exactly as wallet_state orders them.
  for (const uid of ids) {
    const sqlLedger = await owner("select amount, kind, ref from wallet_ledger where user_id = $1 order by created_at desc, id desc", [uid]);
    const mockLedger = [...mock.tables.wallet_ledger.values()].filter((e) => e.user_id === uid)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id).map(({ amount, kind, ref }) => ({ amount, kind, ref }));
    assert(same(sqlLedger, mockLedger), `ledgers differ for ${uid}: ${show(sqlLedger)} vs ${show(mockLedger)}`);
  }
  const sqlAwards = mine(await owner("select user_id, badge from badge_awards"));
  const mockAwards = mine([...mock.tables.badge_awards.values()].map(({ user_id, badge }) => ({ user_id, badge })));
  // Ten: eve's six and ben's four. It used to be sixty, fifty of which were ids made up by the test - those
  // are skipped now, on both sides, which is the point.
  assert(same(sorted(sqlAwards), sorted(mockAwards)) && sqlAwards.length === 10, `badge awards differ: ${sqlAwards.length} vs ${mockAwards.length}`);
});

// ---------- Across everything above ----------

await runTest("every balance is the sum of its ledger, earned its credits and spent its debits", async () => {
  const rows = await owner(`select w.user_id, w.balance, w.earned, w.spent,
      coalesce(sum(l.amount), 0)::bigint as total,
      coalesce(sum(l.amount) filter (where l.amount > 0), 0)::bigint as credits,
      coalesce(-sum(l.amount) filter (where l.amount < 0), 0)::bigint as debits
    from wallets w left join wallet_ledger l on l.user_id = w.user_id group by w.user_id, w.balance, w.earned, w.spent`);
  assert(rows.length >= 20, `enough wallets to mean something: ${rows.length}`);
  for (const r of rows) {
    assert(r.balance === r.total && r.earned === r.credits && r.spent === r.debits, `wallet ${r.user_id}: ${show(r)}`);
  }
  const orphans = (await owner("select count(*)::int as n from wallet_ledger l where not exists (select 1 from wallets w where w.user_id = l.user_id)"))[0].n;
  assert(orphans === 0, `every ledger row has a wallet: ${orphans} without`);
});

await runTest("running the migration again pays only an account with neither welcome coins nor a starting balance, once, and changes nothing else", async () => {
  const snapshot = async () => ({
    wallets: await owner("select * from wallets order by user_id"),
    ledger: await owner("select * from wallet_ledger order by id"),
    awards: await owner("select * from badge_awards order by user_id, badge"),
    codes: await owner("select * from finished_codes order by user_id, code"),
    functions: await owner(`select p.proname, p.prosecdef, p.provolatile, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon,
        has_function_privilege('authenticated', p.oid, 'execute') as authed, has_function_privilege('service_role', p.oid, 'execute') as service
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('wallet_lock', 'wallet_apply', 'credit_coins', 'award_badges', 'claim_minigame', 'wallet_state', 'create_wallet') order by 1`),
    triggers: await owner("select tgname, pg_get_triggerdef(oid) as def from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal order by tgname"),
  });
  // Only a ledger deleted by hand leaves an account with neither - the tests above did that to three accounts; nothing
  // in the app deletes a ledger row. Those are exactly who the starting balances pay.
  const unpaid = await owner(`select p.id, p.runs, p.wins, p.playoffs, p.champs, p.perfect from profiles p
    where not exists (select 1 from wallet_ledger l where l.user_id = p.id and l.kind in ('starting', 'welcome')) order by p.id`);
  assert(unpaid.length === 3, `three accounts had their ledgers deleted above: ${show(unpaid)}`);
  const unpaidIds = new Set(unpaid.map((p) => p.id));
  const before = await snapshot();

  await db.exec(sql("migration-wallet.sql"));
  const once = await snapshot();
  assert(same(once.ledger.slice(0, before.ledger.length), before.ledger), "every ledger row is untouched");
  const added = once.ledger.slice(before.ledger.length).map(({ user_id, amount, kind, ref }) => ({ user_id, amount, kind, ref }));
  assert(same(added, unpaid.map((p) => ({ user_id: p.id, amount: startingBalance(p), kind: "starting", ref: "career" }))), `one starting balance each for those three: ${show(added)}`);
  const others = (wallets) => wallets.filter((w) => !unpaidIds.has(w.user_id));
  assert(same(others(once.wallets), others(before.wallets)), "every other wallet is untouched");
  for (const key of ["awards", "codes", "functions", "triggers"]) assert(same(once[key], before[key]), `${key} changed: ${show(once[key]).slice(0, 200)}`);

  await db.exec(sql("migration-wallet.sql"));
  const twice = await snapshot();
  for (const key of Object.keys(once)) assert(same(twice[key], once[key]), `a third run changed ${key}: ${show(twice[key]).slice(0, 200)}`);

  // badge_rewards is the one seed in these files that OVERWRITES rather than only adding missing rows: a badge's
  // price is not a runbook setting, because the browser prints the amount from badges.mjs and only the repo can
  // change both. So re-running the migration is how a changed price reaches a database that has the old one.
  await owner("update badge_rewards set coins = 7 where badge = $1", [BADGES[0].id]);
  await db.exec(sql("migration-wallet.sql"));
  const priced = await owner("select coins from badge_rewards where badge = $1", [BADGES[0].id]);
  assert(priced[0].coins === BADGES[0].coins, `re-running the migration puts a hand-edited price back: ${show(priced)}`);

  const RAE = await account("rae");
  assert(same(await ledgerOf(RAE), [{ amount: 250, kind: "welcome", ref: "welcome" }]), "a new account still gets its welcome, once");
  assert((await credit(RAE, 20, "season", "AFTER", 20)).data?.credited === 20, "seasons still pay");
});

await db.close();

// ---------- The starting balances, on a database from before coins ----------

await runTest("the starting balance: every existing account's career, at least 250 and at most 10,000, paid once", async () => {
  const old = await freshDb({ migrations: PROFILE_MIGRATIONS });
  // The counters are not null in schema.sql; allowing it here checks that a missing one counts as nothing anyway.
  await old.exec("alter table profiles alter column runs drop not null, alter column wins drop not null, alter column playoffs drop not null, alter column champs drop not null, alter column perfect drop not null");
  const FIELDS = ["runs", "wins", "playoffs", "champs", "perfect"];
  const careers = [
    { runs: 30, wins: 350, playoffs: 12, champs: 4, perfect: 1 }, // 1,770
    { runs: 0, wins: 0, playoffs: 0, champs: 0, perfect: 0 }, // a player who never finished: 250
    {}, // defaults
    { runs: 12, wins: 1 }, // 242, raised to 250
    { runs: 12, wins: 5 }, // exactly 250
    { runs: 12, wins: 6 }, // 252
    { runs: 499, wins: 1 }, // 9,982
    { runs: 500 }, // exactly 10,000
    { runs: 500, wins: 1 }, // 10,002, capped
    { runs: 2000, wins: 30000, playoffs: 1500, champs: 600, perfect: 90 }, // far over
    { runs: null, wins: 300, playoffs: null, champs: 4, perfect: null }, // nulls count as 0: 800
    { runs: -40, wins: 300 }, // a negative counter counts as 0: 600
    { runs: 2147483647, wins: 2147483647 }, // no overflow on the way to the cap
  ];
  // And a spread of ordinary careers, the same every run.
  const random = mulberry32(hashStr("starting-balances"));
  const rand = (n) => Math.floor(random() * (n + 1));
  for (let i = 0; i < 40; i++) {
    const runs = rand(i % 4 === 0 ? 700 : 120);
    const playoffs = rand(runs), champs = rand(playoffs), perfect = rand(Math.min(champs, 5));
    careers.push({ runs, wins: rand(runs * 21), playoffs, champs, perfect });
  }
  const ids = [];
  for (const [i, career] of careers.entries()) {
    const id = uuid(500 + i);
    ids.push(id);
    await addAccount(old, { id, username: `career_${i}`, ...career });
  }
  const stored = async (id) => (await old.query(`select ${FIELDS.join(", ")} from profiles where id = $1`, [id])).rows[0];

  await old.exec(sql("migration-wallet.sql"));
  const ledger = async () => (await old.query("select user_id, amount, kind, ref from wallet_ledger order by user_id, id")).rows;
  const first = await ledger();
  for (const [i, id] of ids.entries()) {
    const want = startingBalance(await stored(id));
    const rows = first.filter((r) => r.user_id === id);
    assert(same(rows, [{ user_id: id, amount: want, kind: "starting", ref: "career" }]), `career ${i} ${show(careers[i])}: expected one starting row of ${want}, got ${show(rows)}`);
    const [w] = (await old.query("select balance, earned, spent from wallets where user_id = $1", [id])).rows;
    assert(same(w, { balance: want, earned: want, spent: 0 }), `career ${i}'s wallet: ${show(w)}`);
  }
  const spot = (i) => first.find((r) => r.user_id === ids[i]).amount;
  assert(spot(0) === 1770 && spot(1) === COIN_RULES.welcome && spot(3) === 250 && spot(4) === 250 && spot(5) === 252, "the hand-worked careers");
  assert(spot(6) === 9982 && spot(7) === COIN_RULES.startingCap && spot(8) === 10000 && spot(9) === 10000 && spot(12) === 10000, "the cap");
  assert(spot(10) === 800 && spot(11) === 600, "nulls and negatives count as nothing");
  assert(!first.some((r) => r.kind === "welcome"), "accounts from before coins get a starting balance, not welcome coins");

  // A second run pays nobody - including accounts whose careers have grown since.
  await old.query("update profiles set runs = runs + 100 where id = $1", [ids[0]]);
  await old.exec(sql("migration-wallet.sql"));
  assert(same(await ledger(), first), "the second run changes nothing");

  // An account made after the migration has its welcome coins, and a later run skips it too.
  const late = uuid(999);
  await addAccount(old, { id: late, username: "late_joiner", runs: 300, wins: 4000 });
  await old.exec(sql("migration-wallet.sql"));
  const lateRows = (await ledger()).filter((r) => r.user_id === late);
  assert(same(lateRows, [{ user_id: late, amount: 250, kind: "welcome", ref: "welcome" }]), `a new account: welcome coins only, got ${show(lateRows)}`);
  await old.close();
});

console.log("test-wallet-sql.mjs done");
