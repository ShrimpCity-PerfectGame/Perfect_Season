// Security and economy checks for Gridspin v1.12.0 Wallet & Shop (SHOP.md 2-4, 9): the attacks a modified browser can
// make on coins and the shop with the anon key or a signed-in token, each asserted to fail, and whether the coin
// economy adds up. The SQL runs in real Postgres (PGlite, set up like a Supabase project by tests/pg-fixture.mjs) as the
// anon, authenticated and service_role roles with auth.uid() set, the way PostgREST runs a request. The Edge Function's
// side runs through the test mock, whose invokeSubmitRun mirrors supabase/functions/submit-run/index.ts step for step,
// with real, legal draft traces.
//   1. What the migrations declare                    6. Earning in the database
//   2. The coin and shop tables, read and written      7. Accounts: renames, deletion, and what a profile shows
//   3. The service role's functions, from a client     8. submit-run: what a season pays, and what it trusts
//   4. search_path shadowing                           9. The browser
//   5. Spending                                        10. The economy
// tests/test-profile-security.mjs does the same for v1.11.0's profiles. PGlite is one connection, so two purchases
// can't truly race here: section 5 checks the lock's place and the constraints behind it. Gaps that can only close
// outside these files, or that CLAUDE.md accepts, are printed at the end with what they're worth, not asserted.
import { readFileSync } from "node:fs";
import { assert, runTest, makeMockAuth, setupDom, loadModule, renderComponent } from "./helpers.mjs";
import { freshDb, addAccount, asUser, asAnon, uuid, sql, PROFILE_MIGRATIONS } from "./pg-fixture.mjs";
import * as GL from "../game-logic.mjs";
import { COIN_RULES, coinsForRun, seasonReward } from "../rewards.mjs";
import { BADGES, BADGE_BY_ID } from "../badges.mjs";
import { SHOP_ITEMS, LAUNCH_PRICES, AVATAR_PACKS, SHOWCASE_MAX } from "../shop-catalog.mjs";

const ch = (...codes) => String.fromCodePoint(...codes);
// PGlite hands back a bigint past 2^53 as a BigInt, which JSON.stringify can't write.
const plain = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => plain(canon(a)) === plain(canon(b));
const show = (v) => String(plain(v)).slice(0, 300).replace(/[^\x20-\x7e]/g, (c) => `<U+${c.codePointAt(0).toString(16).toUpperCase()}>`);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const PG_TEMP_LAST = "public, pg_temp";
const SERVICE = "service_role";
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const utcDate = (ms) => iso(ms).slice(0, 10);
const utcMidnight = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const capOf = (roster, format = "fantasy") => GL.SLOTS.reduce((sum, s) => sum + GL.playerSalary(roster[s], format), 0);

// A legal draft of a seed's boards, the way the app deals them: on each board the first player who fits an open slot -
// or the best-rated one (`best`), or `choose(options best first, rng)`'s pick - and in GM mode only players the cap
// covers with $1M kept for every other open slot. Null when a GM draft runs out of affordable players.
function draftTrace(seed, { format = "fantasy", gm = false, best = false, choose = null, rng = null } = {}) {
  const seq = GL.seededSequence(seed);
  const roster = {}, drafted = new Set(), history = [];
  let spent = 0;
  let at = GL.boardAt(seq, 0, roster);
  while (history.length < GL.SLOTS.length) {
    if (at < 0) return null;
    const key = seq[at];
    const open = GL.SLOTS.filter((s) => !roster[s]);
    const options = [];
    for (const p of GL.BOARDS[key]) {
      if (drafted.has(p.id)) continue;
      const cost = gm ? GL.playerSalary(p, format) : 0;
      if (gm && spent + cost + open.length - 1 > GL.GM_CAP) continue;
      for (const s of open) if (GL.fits(p.pos, s)) options.push({ p, s, cost, r: GL.effectiveRating(s, p, format) });
    }
    if (!options.length) return null;
    if (best || choose) options.sort((a, b) => b.r - a.r || a.p.id - b.p.id || a.s.localeCompare(b.s));
    const c = choose ? choose(options, rng) : options[0];
    roster[c.s] = c.p;
    drafted.add(c.p.id);
    spent += c.cost;
    history.push({ key, id: c.p.id, season: c.p.season, slot: c.s });
    if (history.length < GL.SLOTS.length) at = GL.boardAt(seq, at + 1, roster);
  }
  return { seq, history, roster };
}
// The run submit-run records for a trace: score, the seeded season, par and points, exactly as index.ts works them out.
function settle(seed, trace, { format = "fantasy", gm = false, kind = "free" } = {}) {
  let tot = 0, wt = 0;
  for (const s of GL.SLOTS) {
    const k = s === "QB" ? GL.QB_WEIGHT : 1;
    tot += GL.effectiveRating(s, trace.roster[s], format) * k;
    wt += k;
  }
  const score = Math.round((tot / wt) * 10) / 10;
  const lineup = GL.SLOTS.map((s) => `${trace.roster[s].id}${trace.roster[s].season}`).join("|");
  const sim = GL.withSeed(`${seed}#${lineup}`, () => GL.simulateSeason(score));
  const par = GL.botPar(trace.history.map((h) => h.key), { format, gm });
  return { w: sim.w, l: sim.l, score, champ: sim.champ, perfect: sim.perfect, playoffs: sim.playoffs, mode: kind, code: kind === "free" ? seed : undefined, gm, format, par, points: GL.draftPoints(score, par) };
}

// ======================================================================================================================
// The database
// ======================================================================================================================

// v1.12.0's migrations exactly: this file's every-function and every-table checks are about the wallet and the shop, so
// a later release's migration gets checks of its own rather than an entry here.
const WALLET_SHOP_MIGRATIONS = [...PROFILE_MIGRATIONS, "migration-wallet.sql", "migration-shop.sql"];
const db = await freshDb({ migrations: WALLET_SHOP_MIGRATIONS });
const owner = async (statement, params) => (await db.query(statement, params)).rows;
// One statement as the service role (SERVICE), a signed-in player (their id) or a signed-out visitor (null):
// { rows, affected } or { error }.
async function attempt(who, statement, params = []) {
  const run = async () => {
    try {
      const r = await db.query(statement, params);
      return { rows: r.rows, affected: r.affectedRows ?? 0 };
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
// One database function call with named arguments: { data } or { error: "<message>" }.
async function call(who, fn, args = {}) {
  const names = Object.keys(args);
  const res = await attempt(who, `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, names.map((n) => args[n]));
  return res.error ? { error: res.error } : { data: res.rows[0].r };
}

let accounts = 0;
async function account(name, career = {}) {
  const id = uuid(7000 + ++accounts);
  await addAccount(db, { id, username: `${name}${accounts}`, ...career });
  return id;
}
const GHOST = uuid(99999); // a signed-in session whose account doesn't exist
let topUps = 0;
// Coins for a test, moved the way a season pays them.
const give = (uid, coins) => owner("select public.wallet_apply($1::uuid, $2::bigint, 'season', $3)", [uid, coins, `TOPUP-${++topUps}`]);
const balanceOf = async (uid) => Number((await owner("select balance from wallets where user_id = $1", [uid]))[0]?.balance ?? 0);
const detailsOf = async (uid) => (await owner("select to_jsonb(d) as d from profile_details d where user_id = $1", [uid]))[0]?.d ?? null;
const ledgerOf = async (uid) => (await owner("select amount, kind, ref from wallet_ledger where user_id = $1 order by id", [uid])).map((l) => ({ ...l, amount: Number(l.amount) }));
// Every row a coin or shop attack could change, and the ledger's id counter - left out where a statement the database
// refuses has already drawn an id (a sequence never gives one back, and that isn't a coin moving).
async function everything({ counter = true } = {}) {
  return plain({
    wallets: await owner("select * from wallets order by user_id"),
    ledger: await owner("select * from wallet_ledger order by id"),
    awards: await owner("select * from badge_awards order by user_id, badge"),
    codes: await owner(`select * from finished_codes order by user_id, code collate "C"`),
    inventory: await owner(`select * from inventory order by user_id, item_id collate "C"`),
    items: await owner(`select * from shop_items order by id collate "C"`),
    presets: await owner(`select * from avatar_presets order by key collate "C"`),
    details: await owner("select * from profile_details order by user_id"),
    counter: counter ? await owner("select last_value, is_called from public.wallet_ledger_id_seq") : null,
  });
}
// A write that must change nothing: refused outright, or run and matching no row.
const changedNothing = (r) => (r.error ? /permission denied|row-level security|cannot truncate a table referenced in a foreign key constraint/.test(r.error) : r.affected === 0);

// ---------- 1. What the migrations declare ----------

// The same database without v1.12.0, to tell what the wallet and shop migrations added.
const v111 = await freshDb({ migrations: PROFILE_MIGRATIONS });
const FUNCTION_ROWS = `select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig, p.prosecdef as definer, p.provolatile as volatility,
    (select substr(c, 13) from unnest(p.proconfig) c where c like 'search_path=%') as search_path,
    has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
    has_function_privilege('service_role', p.oid, 'execute') as service_role, md5(p.prosrc) as body
  from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`;
// [security definer, volatility, search_path, anon may execute, authenticated may execute, service_role may execute]
const NEW_FUNCTIONS = {
  // Internal: only the functions below call them, as their owner. The service role is trusted with everything.
  "wallet_lock(p_user uuid)": [false, "v", PG_TEMP_LAST, false, false, true],
  "wallet_apply(p_user uuid, p_amount bigint, p_kind text, p_ref text)": [false, "v", PG_TEMP_LAST, false, false, true],
  // The Edge Function's: the only way a season or a badge pays.
  "credit_coins(p_user uuid, p_amount bigint, p_kind text, p_ref text, p_daily_cap integer)": [true, "v", PG_TEMP_LAST, false, false, true],
  "award_badges(p_user uuid, p_badges jsonb)": [true, "v", PG_TEMP_LAST, false, false, true],
  // A signed-in player's own; the two reads are stable, so the browser sends them as GET.
  "claim_minigame(p_game text, p_date text)": [true, "v", PG_TEMP_LAST, false, true, true],
  "wallet_state()": [true, "s", PG_TEMP_LAST, false, true, true],
  "shop_state()": [true, "s", PG_TEMP_LAST, false, true, true],
  "shop_buy(p_item text)": [true, "v", PG_TEMP_LAST, false, true, true],
  "equip_item(p_slot text, p_item text)": [true, "v", PG_TEMP_LAST, false, true, true],
  "set_showcase(p_badges text[])": [true, "v", PG_TEMP_LAST, false, true, true],
  // The welcome coins' trigger on profiles.
  "create_wallet()": [true, "v", PG_TEMP_LAST, false, false, true],
};
// set_avatar learned the paid packs in migration-profiles.sql (SHOP.md 3.2); signed out, it answers not_signed_in.
const SET_AVATAR = ["set_avatar(p_path text, p_preset text)", [true, "v", PG_TEMP_LAST, true, true, true]];

const MALLORY = await account("mallory"); // the attacker
const ALICE = await account("alice"); // the victim

await runTest("1a. every function the wallet and shop migrations add has a deliberate entry here (definer or invoker, volatility, search_path, who may execute it), and they redefine nothing from before", async () => {
  const rows = await owner(FUNCTION_ROWS);
  const before = (await v111.query(FUNCTION_ROWS)).rows;
  const now = new Map(rows.map((r) => [r.sig, r]));
  const then = new Map(before.map((r) => [r.sig, r]));
  const added = rows.filter((r) => !then.has(r.sig)).map((r) => r.sig).sort();
  assert(same(added, Object.keys(NEW_FUNCTIONS).sort()), `functions the new migrations add: ${show(added)} - a new one needs a deliberate entry here`);
  assert(before.every((r) => now.has(r.sig)), "and they remove none");
  const attrs = (r) => [r.definer, r.volatility, r.search_path, r.anon, r.authenticated, r.service_role];
  for (const r of before) {
    const n = now.get(r.sig);
    assert(same([...attrs(n), n.body], [...attrs(r), r.body]), `${r.sig} is untouched by the wallet and shop migrations: ${show(attrs(r))} -> ${show(attrs(n))}`);
  }
  for (const [sig, want] of [...Object.entries(NEW_FUNCTIONS), SET_AVATAR]) assert(same(attrs(now.get(sig)), want), `${sig}: expected ${show(want)}, got ${show(attrs(now.get(sig)))}`);
  for (const r of rows.filter((x) => x.definer)) assert(r.search_path === PG_TEMP_LAST, `${r.sig} is security definer, so it must search pg_temp last`);
  assert(Object.entries(NEW_FUNCTIONS).every(([, w]) => w[3] === false), "no new function is callable signed out");

  const TRIGGERS = "select c.relname || '.' || t.tgname as name, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal order by 1";
  const oldTriggers = new Set((await v111.query(TRIGGERS)).rows.map((t) => t.name));
  const newTriggers = (await owner(TRIGGERS)).filter((t) => !oldTriggers.has(t.name));
  assert(newTriggers.length === 1 && newTriggers[0].name === "profiles.profiles_create_wallet"
    && /AFTER INSERT ON public\.profiles FOR EACH ROW EXECUTE FUNCTION (public\.)?create_wallet\(\)/.test(newTriggers[0].def), `the one new trigger is the welcome coins': ${show(newTriggers)}`);
  for (const who of [null, MALLORY]) {
    const r = await attempt(who, "select public.create_wallet()");
    assert(/permission denied for function create_wallet/.test(r.error || ""), `${who ? "a player" : "anon"} can't call the trigger function: ${show(r)}`);
  }
});

await runTest("1b. every table, column, sequence and view they add: the coin tables and inventory closed outright, shop_items public to read only, no coin column on a public table, and no client holds the ledger's id sequence", async () => {
  const MODES = "array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']";
  const TABLE_ROWS = `select c.relname as name, c.relkind as kind, c.relrowsecurity as rls,
      coalesce((select jsonb_agg(p.cmd || ' to ' || array_to_string(p.roles, ',') order by p.cmd, p.policyname) from pg_policies p
                 where p.schemaname = 'public' and p.tablename = c.relname), '[]'::jsonb) as policies,
      (select coalesce(jsonb_agg(m order by m), '[]'::jsonb) from unnest(${MODES}) m where has_table_privilege('anon', c.oid, m)) as anon,
      (select coalesce(jsonb_agg(m order by m), '[]'::jsonb) from unnest(${MODES}) m where has_table_privilege('authenticated', c.oid, m)) as authenticated
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') order by 1`;
  const rows = await owner(TABLE_ROWS);
  const oldNames = new Set((await v111.query(TABLE_ROWS)).rows.map((t) => t.name));
  const added = rows.filter((t) => !oldNames.has(t.name));
  const CLOSED = { kind: "r", rls: true, policies: [], anon: [], authenticated: [] };
  const want = { badge_awards: CLOSED, badge_rewards: CLOSED, finished_codes: CLOSED, inventory: CLOSED, wallet_ledger: CLOSED, wallets: CLOSED };
  assert(same(added.map((t) => t.name).sort(), [...Object.keys(want), "shop_items"].sort()), `tables the new migrations add: ${show(added.map((t) => t.name))}`);
  for (const t of added.filter((x) => want[x.name])) {
    assert(same({ kind: t.kind, rls: t.rls, policies: t.policies, anon: t.anon, authenticated: t.authenticated }, want[t.name]), `${t.name}: RLS on, no policies, no client privilege of any kind - got ${show(t)}`);
  }
  const items = added.find((t) => t.name === "shop_items");
  assert(items.rls && same(items.policies, ["SELECT to public"]) && items.anon.includes("SELECT") && items.authenticated.includes("SELECT"), `shop_items: RLS on and a select policy only: ${show(items)}`);

  const COLUMNS = "select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public' order by 1";
  const oldColumns = new Set((await v111.query(COLUMNS)).rows.map((r) => r.c));
  const newColumns = (await owner(COLUMNS)).map((r) => r.c).filter((c) => !oldColumns.has(c) && oldNames.has(c.split(".")[0]));
  assert(same(newColumns.sort(), ["profile_details.card_theme", "profile_details.frame", "profile_details.showcase", "profile_details.title"]),
    `the only columns added to existing tables are what a player wears, which the card shows everyone - nothing about coins lands on profiles: ${show(newColumns)}`);

  // The ledger's id sequence. Whoever holds it can set it to its last value, after which no ledger row can be written:
  // no welcome coins, so no signup, and no season's coins, claim or purchase, for anyone.
  const attempts = {};
  let signup = "";
  const newcomer = uuid(7999);
  try {
    for (const [label, who] of [["anon", null], ["a player", MALLORY]]) {
      attempts[`${label}'s setval`] = await attempt(who, "select setval('public.wallet_ledger_id_seq', 9223372036854775807)");
      attempts[`${label}'s nextval`] = await attempt(who, "select nextval('public.wallet_ledger_id_seq')");
      attempts[`${label}'s alter sequence`] = await attempt(who, "alter sequence public.wallet_ledger_id_seq restart with 9223372036854775807");
    }
    try {
      await db.query("insert into auth.users values ($1, $2)", [newcomer, { username: "seq_newcomer" }]);
    } catch (e) {
      signup = String(e?.message || e);
    }
  } finally {
    // Put the counter back whatever happened, so one broken sequence doesn't fail every test after this one.
    await owner("delete from auth.users where id = $1", [newcomer]);
    await owner("select setval('public.wallet_ledger_id_seq', (select coalesce(max(id), 1) from wallet_ledger))");
  }
  assert(signup === "", `after anon's and a player's tries at the ledger's id sequence, a signup must still get its welcome coins - it failed with ${show(signup)}`);
  for (const [label, r] of Object.entries(attempts)) {
    assert(/permission denied for sequence wallet_ledger_id_seq|must be owner of sequence wallet_ledger_id_seq/.test(r.error || ""), `${label} on the ledger's sequence is refused: ${show(r)}`);
  }
  const sequences = await owner(`select c.oid::regclass::text as name,
      has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'SELECT') or has_sequence_privilege('anon', c.oid, 'UPDATE') as anon,
      has_sequence_privilege('authenticated', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'SELECT') or has_sequence_privilege('authenticated', c.oid, 'UPDATE') as authenticated
    from pg_class c where c.relkind = 'S' and c.relnamespace = 'public'::regnamespace order by 1`);
  const ledgerSequence = (await owner("select pg_get_serial_sequence('public.wallet_ledger', 'id') as s"))[0].s;
  assert(sequences.some((s) => `public.${s.name}` === ledgerSequence || s.name === ledgerSequence), `the ledger's id sequence is ${ledgerSequence}: ${show(sequences)}`);
  assert(sequences.every((s) => !s.anon && !s.authenticated), `no client role holds a sequence in public, the ledger's included: ${show(sequences)}`);
});

await v111.close();

// ---------- 2. The coin and shop tables, read and written ----------

// Alice has a bit of everything: coins, a purchase worn, a badge, a finished code and a showcase.
await give(ALICE, 20000);
assert(!(await call(ALICE, "shop_buy", { p_item: "frame-gold" })).error, "alice buys a frame");
assert(!(await call(ALICE, "shop_buy", { p_item: "pack-sideline" })).error, "and a pack");
assert(!(await call(ALICE, "equip_item", { p_slot: "frame", p_item: "frame-gold" })).error, "alice wears the frame");
assert(!(await call(ALICE, "set_showcase", { p_badges: ["undefeated"] })).error, "and shows a badge");
await owner("insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [ALICE]);
await owner("insert into finished_codes (user_id, code) values ($1, 'ALICE1')", [ALICE]);
await give(MALLORY, 1000);

await runTest("2a. nobody writes the coin or shop tables directly - inserts, upserts, updates, deletes and truncates on wallets, the ledger, badge_awards, finished_codes, inventory, shop_items, avatar_presets and what a player wears - not even their own rows", async () => {
  const before = await everything();
  const writes = (me) => [
    ["insert into wallets (user_id, balance, earned) values ($1, 1000000, 1000000)", [me]],
    ["insert into wallets (user_id, balance, earned) values ($1, 1000000, 1000000) on conflict (user_id) do update set balance = excluded.balance, earned = excluded.earned", [me]],
    ["update wallets set balance = balance + 1000000, earned = earned + 1000000 where user_id = $1", [me]],
    ["update wallets set balance = 0, spent = earned where user_id = $1", [ALICE]],
    ["delete from wallets where user_id = $1", [ALICE]],
    ["insert into wallet_ledger (user_id, amount, kind, ref) values ($1, 10000, 'season', 'FORGED')", [me]],
    ["update wallet_ledger set amount = 1000000 where user_id = $1", [me]],
    ["delete from wallet_ledger where user_id = $1 and kind = 'purchase'", [me]],
    ["insert into badge_awards (user_id, badge) values ($1, 'undefeated'), ($1, 'dynasty'), ($1, 'daily-winner'), ($1, 'cinderella')", [me]],
    ["update badge_awards set user_id = $1 where user_id = $2", [me, ALICE]],
    ["delete from badge_awards where user_id = $1", [ALICE]],
    ["delete from finished_codes where user_id = $1", [me]],
    ["insert into finished_codes (user_id, code) values ($1, 'ALICE1')", [ALICE]],
    ["insert into inventory (user_id, item_id) values ($1, 'frame-flame'), ($1, 'card-gold-foil'), ($1, 'pack-night-game')", [me]],
    ["update inventory set user_id = $1 where user_id = $2", [me, ALICE]],
    ["delete from inventory where user_id = $1", [ALICE]],
    ["insert into shop_items (id, kind, rarity, price, badge) values ('forged-frame', 'frame', 'free', null, null)", []],
    ["insert into shop_items (id, kind, rarity, price) values ('frame-flame', 'frame', 'common', 1) on conflict (id) do update set price = 1, rarity = 'free'", []],
    ["update shop_items set price = 1", []],
    ["update shop_items set rarity = 'free', price = null, badge = null where id = 'frame-flame'", []],
    ["update shop_items set active = false where id = 'frame-lime'", []],
    ["delete from shop_items where id = 'pack-night-game'", []],
    ["update avatar_presets set free = true where pack <> 'starter'", []],
    ["insert into avatar_presets (key, pack, free) values ('forged-avatar', 'night-game', true)", []],
    ["insert into profile_details (user_id, frame, card_theme, title) values ($1, 'frame-flame', 'card-gold-foil', 'title-daily-winner')", [me]],
    ["insert into profile_details (user_id, frame) values ($1, 'frame-flame') on conflict (user_id) do update set frame = excluded.frame", [me]],
    ["update profile_details set frame = 'frame-flame', title = 'title-cinderella', showcase = '{undefeated,dynasty,daily-winner}' where user_id = $1", [me]],
    ["update profile_details set frame = null, showcase = '{}' where user_id = $1", [ALICE]],
    ["update profile_details set avatar_preset = 'headset' where user_id = $1", [me]],
    ...["wallets", "wallet_ledger", "badge_awards", "finished_codes", "inventory", "shop_items", "avatar_presets"].map((t) => [`truncate ${t}`, []]),
  ];
  let checked = 0;
  for (const who of [MALLORY, null]) {
    for (const [statement, params] of writes(who || MALLORY)) {
      const r = await attempt(who, statement, params);
      assert(changedNothing(r), `${who ? "mallory" : "anon"}: "${statement.slice(0, 110)}" must change nothing, got ${show(r)}`);
      checked++;
    }
  }
  assert(checked > 60, `a real spread of writes: ${checked}`);
  assert((await everything()) === before, "not a coin, row, price or counter changed");
});

await runTest("2b. no client reads the coin tables or inventory - directly, inside another query, through planner statistics - and the player's own functions answer only for the player asking", async () => {
  await owner("analyze public.wallets, public.wallet_ledger, public.badge_awards, public.finished_codes, public.inventory");
  const reads = [
    "select * from wallets", "select balance from wallets where user_id = $1", "select count(*) from wallet_ledger", "table badge_awards",
    "select code from finished_codes where user_id = $1", "select item_id from inventory where user_id = $1",
    "select p.username, (select w.balance from wallets w where w.user_id = p.id) from profiles p",
    "select exists (select 1 from inventory i join profiles p on p.id = i.user_id where p.username like 'alice%')",
    "select d.frame from profile_details d where exists (select 1 from badge_awards b where b.user_id = d.user_id)",
  ];
  for (const who of [null, MALLORY]) {
    const label = who ? "a player" : "anon";
    for (const statement of reads) {
      const params = statement.includes("$1") ? [ALICE] : [];
      const r = await attempt(who, statement, params);
      assert(/^permission denied for table (wallets|wallet_ledger|badge_awards|finished_codes|inventory)$/.test(r.error || ""), `${label}: "${statement}" should be permission denied, got ${show(r)}`);
    }
    const stats = await attempt(who, "select tablename, attname from pg_stats where tablename in ('wallets', 'wallet_ledger', 'badge_awards', 'finished_codes', 'inventory')");
    assert(!stats.error && stats.rows.length === 0, `${label} sees no statistics of the coin tables: ${show(stats)}`);
    const items = await attempt(who, "select count(*)::int as n from shop_items");
    assert(items.rows?.[0]?.n === SHOP_ITEMS.length, `${label} reads the catalog: ${show(items)}`);
    for (const statement of ["select public.wallet_state(p_user_id => $1)", "select public.shop_state(p_user => $1)", "select public.shop_buy(p_item => 'frame-lime', p_user => $1)", "select public.claim_minigame(p_game => 'build', p_user_id => $1)"]) {
      const r = await attempt(who, statement, [ALICE]);
      assert(/does not exist/.test(r.error || ""), `${label}: no argument names another player - "${statement}" is no function at all: ${show(r)}`);
    }
  }
  const mine = (await call(MALLORY, "wallet_state")).data;
  const mallorysRows = (await ledgerOf(MALLORY)).map((l) => `${l.amount}:${l.kind}:${l.ref}`).sort();
  assert(mine.balance === await balanceOf(MALLORY) && same(mine.recent.map((m) => `${m.amount}:${m.kind}:${m.ref}`).sort(), mallorysRows), `mallory's wallet_state is mallory's ledger and nobody else's: ${show(mine)}`);
  const shop = (await call(MALLORY, "shop_state")).data;
  assert(!shop.items.find((i) => i.id === "frame-gold").owned && !shop.items.find((i) => i.id === "frame-undefeated").owned && shop.equipped.frame === null && same(shop.equipped.showcase, []),
    `mallory's shop_state shows nothing of alice's: ${show(shop.equipped)}`);
});

// ---------- 3. The service role's functions, from a client ----------

await runTest("3. every signature of credit_coins, award_badges, wallet_apply, wallet_lock and create_wallet is refused to anon and to a player, however it's called", async () => {
  const internal = await owner(`select p.proname as name, oidvectortypes(p.proargtypes) as types from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('credit_coins', 'award_badges', 'wallet_apply', 'wallet_lock', 'create_wallet') order by 1, 2`);
  assert(same(internal.map((f) => f.name), ["award_badges", "create_wallet", "credit_coins", "wallet_apply", "wallet_lock"]), `one signature each: ${show(internal)}`);
  const before = await everything();
  const payload = { uuid: `'${MALLORY}'::uuid`, bigint: "10000::bigint", text: "'season'", integer: "null::integer", jsonb: `'[{"id": "hall-of-famer", "coins": 10000}]'::jsonb` };
  for (const who of [null, MALLORY]) {
    for (const { name, types } of internal) {
      const args = types ? types.split(", ").map((t) => payload[t] ?? `null::${t}`) : [];
      for (const statement of [`select public.${name}(${args.join(", ")})`, `select * from public.${name}(${args.join(", ")})`, `select ${name}(${args.map((a) => a.replace(/::\w+$/, "")).join(", ")})`]) {
        const r = await attempt(who, statement);
        // A trigger function in FROM is refused for its return type before its privileges are even checked.
        assert(/permission denied for function|unsupported return type trigger/.test(r.error || ""), `${who ? "a player" : "anon"}: ${statement} must be refused, got ${show(r)}`);
      }
    }
  }
  assert((await everything()) === before, "and nothing moved");
});

// ---------- 4. search_path shadowing ----------

await runTest("4. a player's temporary tables and functions, named like everything the coin and shop functions read, and put first on the search_path, change nothing those functions decide", async () => {
  const P = await account("shadow");
  const today = utcDate(Date.now());
  const balance = await balanceOf(P);
  assert(balance < LAUNCH_PRICES.common, `the player can't afford a Common: ${balance}`);
  const out = await asUser(db, P, async () => {
    const t = async (statement, params) => {
      try {
        return { rows: (await db.query(statement, params)).rows };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    };
    const setup = [
      "create temp table wallets (user_id uuid, balance bigint, earned bigint, spent bigint, updated_at timestamptz default now())",
      "create temp table wallet_ledger (id bigint, user_id uuid, amount bigint, kind text, ref text, created_at timestamptz default now())",
      "create temp table badge_awards (user_id uuid, badge text, awarded_at timestamptz default now())",
      "create temp table finished_codes (user_id uuid, code text, created_at timestamptz default now())",
      "create temp table inventory (user_id uuid, item_id text, acquired_at timestamptz default now())",
      "create temp table shop_items (id text, kind text, rarity text, price integer, badge text, active boolean, sort integer)",
      "create temp table avatar_presets (key text, pack text, free boolean)",
      "create temp table sou_runs (date text, user_id uuid, username text, score integer, created_at timestamptz default now())",
      "create temp table builds (id uuid default gen_random_uuid(), user_id uuid, username text, pos text, overall numeric, filled jsonb, created_at timestamptz default now())",
      "create temp table profiles (id uuid, username text, created_at timestamptz default now())",
      "create temp table profile_details (user_id uuid, bio text, avatar_path text, avatar_preset text, favorite_team text, frame text, card_theme text, title text, showcase text[], updated_at timestamptz)",
      "create function pg_temp.wallet_lock(p_user uuid) returns bigint language sql as 'select 1000000000::bigint'",
      "create function pg_temp.wallet_apply(p_user uuid, p_amount bigint, p_kind text, p_ref text) returns bigint language sql as 'select p_amount'",
    ];
    const fill = [
      ["insert into pg_temp.wallets values ($1, 1000000000, 1000000000, 0)", [P]],
      ["insert into pg_temp.wallet_ledger values (1, $1, 15, 'minigame', 'over_under:' || $2)", [P, today]],
      ["insert into pg_temp.badge_awards (user_id, badge) values ($1, 'undefeated'), ($1, 'dynasty')", [P]],
      ["insert into pg_temp.inventory (user_id, item_id) values ($1, 'frame-lime'), ($1, 'frame-flame'), ($1, 'pack-night-game')", [P]],
      ["insert into pg_temp.shop_items values ('frame-gold', 'frame', 'free', null, null, true, 0), ('card-gold-foil', 'card', 'common', 1, null, true, 0)", []],
      ["insert into pg_temp.avatar_presets values ('floodlights', 'starter', true)", []],
      ["insert into pg_temp.sou_runs (date, user_id, username, score) values ($1, $2, 'x', 30)", [today, P]],
      ["insert into pg_temp.builds (user_id, username, pos, overall, filled) values ($1, 'x', 'QB', 99, '{}')", [P]],
      ["insert into pg_temp.profiles (id, username) values ($1, 'ghost_in_temp')", [GHOST]],
      ["insert into pg_temp.profile_details (user_id, frame, title, showcase) values ($1, 'frame-flame', 'title-daily-winner', '{dynasty}')", [P]],
    ];
    const res = {};
    try {
      for (const s of setup) {
        const r = await t(s);
        if (r.error) throw new Error(`setting up the attack failed: ${s}: ${r.error}`);
      }
      for (const [s, p] of fill) {
        const r = await t(s, p);
        if (r.error) throw new Error(`filling the shadows failed: ${s}: ${r.error}`);
      }
      await t("set search_path = pg_temp, public");
      res.buyOwned = await t("select shop_buy('frame-lime') as v");
      res.buyFree = await t("select shop_buy('frame-gold') as v");
      res.buyCheap = await t("select shop_buy('card-gold-foil') as v");
      res.equipInventory = await t("select equip_item('frame', 'frame-flame') as v");
      res.equipBadge = await t("select equip_item('frame', 'frame-undefeated') as v");
      res.equipFree = await t("select equip_item('frame', 'frame-gold') as v");
      res.avatar = await t("select set_avatar(null, 'floodlights') as v");
      res.claim = await t("select claim_minigame('over_under') as v");
      res.claimBuild = await t("select claim_minigame('build') as v");
      res.wallet = await t("select wallet_state() as v");
      res.shop = await t("select shop_state() as v");
      res.helpers = await t("select wallet_lock($1) as v", [P]);
    } finally {
      await t("set search_path = public");
      for (const name of ["wallets", "wallet_ledger", "badge_awards", "finished_codes", "inventory", "shop_items", "avatar_presets", "sou_runs", "builds", "profiles", "profile_details"]) await t(`drop table if exists pg_temp.${name}`);
      await t("drop function if exists pg_temp.wallet_lock(uuid)");
      await t("drop function if exists pg_temp.wallet_apply(uuid, bigint, text, text)");
    }
    return res;
  });
  assert(out.buyOwned.error === "not_enough" && out.buyFree.error === "not_enough" && out.buyCheap.error === "not_enough",
    `a temporary wallet, inventory and catalog don't make an item owned, free or cheap: ${show([out.buyOwned, out.buyFree, out.buyCheap])}`);
  assert(out.equipInventory.error === "not_owned" && out.equipBadge.error === "not_owned" && out.equipFree.error === "not_owned",
    `nor wearable: ${show([out.equipInventory, out.equipBadge, out.equipFree])}`);
  assert(out.avatar.error === "bad_preset", `a temporary free avatar isn't a free avatar: ${show(out.avatar)}`);
  assert(out.claim.error === "not_played" && out.claimBuild.error === "not_played", `a temporary Over/Under run or build isn't a game played: ${show([out.claim, out.claimBuild])}`);
  assert(Number(out.wallet.rows[0].v.balance) === balance && out.wallet.rows[0].v.recent.every((m) => m.ref !== `over_under:${today}`), `wallet_state reads the real wallet: ${show(out.wallet)}`);
  const s = out.shop.rows[0].v;
  assert(s.balance === balance && ["frame-lime", "frame-flame", "frame-undefeated"].every((id) => s.items.find((i) => i.id === id)?.owned === false) && s.equipped.frame === null && s.items.find((i) => i.id === "frame-gold").price === LAUNCH_PRICES.epic,
    `shop_state reads the real catalog, inventory and badges: ${show(s.equipped)}`);
  assert(/permission denied for function wallet_lock/.test(out.helpers.error || ""), `a temporary function is never what an unqualified call reaches: ${show(out.helpers)}`);
  assert((await balanceOf(P)) === balance && (await detailsOf(P)) === null && (await ledgerOf(P)).length === 1, "and nothing real changed for the player");
  const ghost = await asUser(db, GHOST, async () => {
    try {
      await db.query("create temp table profiles (id uuid, username text)");
      await db.query("insert into pg_temp.profiles values ($1, 'ghost')", [GHOST]);
      await db.query("set search_path = pg_temp, public");
      const answers = [];
      for (const s of ["select shop_state()", "select wallet_state()", "select claim_minigame('build')", "select shop_buy('frame-lime')"]) {
        try {
          await db.query(s);
          answers.push("ran");
        } catch (e) {
          answers.push(e.message);
        }
      }
      return answers;
    } finally {
      await db.query("set search_path = public");
      await db.query("drop table if exists pg_temp.profiles");
    }
  });
  assert(ghost.every((a) => a === "not_signed_in"), `a temporary profiles row doesn't make a session with no account a player: ${show(ghost)}`);
});

// ---------- 5. Spending ----------

await runTest("5a. shop_buy refuses every id that isn't exactly an item on sale - SQL, wildcards, look-alikes, case and space variants, very long, null - and writes nothing", async () => {
  const P = await account("oddbuyer");
  await give(P, 100000);
  const before = await everything();
  const ids = [
    null, "", " ", "frame-lime ", " frame-lime", "FRAME-LIME", "Frame-Lime", "frame_lime", "frame-lime\n", "frame-lime\t", `frame${ch(0x2010)}lime`, `frame${ch(0x2011)}lime`,
    `ｆｒａｍｅ-lime`, `frame-l${ch(0x456)}me`, `frame-lime${ch(0x200B)}`, `${ch(0xFEFF)}frame-lime`, "frame-lime'; update wallets set balance = 1000000; --",
    "frame-lime' or '1'='1", "%", "frame-%", "_rame-lime", "*", "frame-lime,frame-gold", '{"id":"frame-lime"}', "['frame-lime']", "__proto__", "constructor",
    "x".repeat(41), "frame-lime".repeat(10000), ch(0x1F4B0), "pack-sidelinex", "../frame-lime", "frame-lime\\",
  ];
  for (const id of ids) {
    const r = await call(P, "shop_buy", { p_item: id });
    assert(r.error === "unavailable", `shop_buy(${show(id)}) should be unavailable, got ${show(r)}`);
  }
  const nul = await call(P, "shop_buy", { p_item: `frame-lime${ch(0)}` });
  assert(nul.error && !nul.data, `a NUL byte is refused without buying: ${show(nul)}`);
  assert((await everything()) === before, "no refusal wrote a row or moved a coin");
});

await runTest("5b. buying at exactly the price empties the wallet and one coin short buys nothing; the same item twice, a free item, a badge item (badge or not), an item off sale and an unknown id all refuse and write nothing", async () => {
  const P = await account("spender"), CHAMP = await account("champ");
  const price = LAUNCH_PRICES.rare;
  const fundTo = async (uid, target) => {
    const have = await balanceOf(uid);
    if (have < target) await give(uid, target - have);
  };
  await fundTo(P, price - 1);
  const short = await call(P, "shop_buy", { p_item: "card-turf" });
  assert(short.error === "not_enough", `one coin short: ${show(short)}`);
  await give(P, 1);
  const bought = await call(P, "shop_buy", { p_item: "card-turf" });
  assert(same(bought.data, { ok: true, balance: 0, item: "card-turf" }), `exactly the price buys it and leaves 0: ${show(bought)}`);
  await give(P, 50000);
  await owner("insert into badge_awards (user_id, badge) values ($1, 'dynasty'), ($1, 'undefeated')", [CHAMP]);
  await give(CHAMP, 50000);
  await owner("update shop_items set active = false where id = 'frame-team'");
  try {
    const cases = [
      [P, "card-turf", "owned"], [P, "card-navy", "owned"], [P, "frame-ink", "owned"],
      [P, "frame-undefeated", "badge_only"], [CHAMP, "card-dynasty", "badge_only"], [CHAMP, "title-undefeated", "badge_only"],
      [P, "frame-team", "unavailable"], [P, "no-such-item", "unavailable"],
    ];
    for (const [who, item, code] of cases) {
      const before = await everything();
      const r = await call(who, "shop_buy", { p_item: item });
      assert(r.error === code, `shop_buy(${item}) should be ${code}, got ${show(r)}`);
      assert((await everything()) === before, `and wrote nothing (${item})`);
    }
  } finally {
    await owner("update shop_items set active = true where id = 'frame-team'");
  }
  assert(same((await ledgerOf(P)).filter((l) => l.kind === "purchase"), [{ amount: -price, kind: "purchase", ref: "card-turf" }]), "one purchase row for P");
});

await runTest("5c. two purchases at once: the wallet row is locked before the item, ownership or balance is read and held to the transaction's end, and the tables refuse a second copy, a second charge and an overdraft", async () => {
  // In each function that decides on a balance or moves coins, the lock comes before any read of the coin tables. Only
  // the statements count, from `begin` on: a declaration like `v_item public.shop_items;` reads nothing.
  const bodyOf = async (sig) => {
    const src = (await owner("select prosrc from pg_proc where oid = $1::regprocedure", [sig]))[0].prosrc.replace(/--[^\n]*/g, "");
    return src.slice(src.search(/\bbegin\b/i));
  };
  const lockFirst = {
    "public.shop_buy(text)": ["public.shop_items", "public.inventory", "wallet_apply(", "public.wallets"],
    "public.credit_coins(uuid, bigint, text, text, integer)": ["public.wallet_ledger", "wallet_apply(", "public.wallets"],
    "public.award_badges(uuid, jsonb)": ["public.badge_awards", "wallet_apply(", "public.wallets"],
    "public.claim_minigame(text, text)": ["wallet_apply(", "public.wallets"],
    "public.wallet_apply(uuid, bigint, text, text)": ["public.wallet_ledger", "public.wallets"],
  };
  for (const [sig, later] of Object.entries(lockFirst)) {
    const body = await bodyOf(sig);
    const lock = body.indexOf("wallet_lock(");
    for (const word of later) assert(lock >= 0 && body.indexOf(word) > lock, `${sig}: wallet_lock comes before ${word}`);
  }
  assert(/for update/i.test(await bodyOf("public.wallet_lock(uuid)")), "wallet_lock takes the row with for update");

  const P = await account("racer");
  await give(P, LAUNCH_PRICES.common - (await balanceOf(P)) + LAUNCH_PRICES.common - 1); // enough for one Common, not two
  const balance = await balanceOf(P);
  assert(balance === 2 * LAUNCH_PRICES.common - 1, `balance ${balance}`);
  // Inside a purchase's transaction the wallet row stays locked until it ends, so a second session's purchase waits
  // for it before reading anything - and, under READ COMMITTED, then reads the first one's rows.
  const held = await asUser(db, P, async () => {
    await db.query("begin");
    try {
      await db.query("select public.shop_buy('title-film-room')");
      return (await db.query("select mode from pg_locks where locktype = 'relation' and relation = 'public.wallets'::regclass and pid = pg_backend_pid() order by mode")).rows.map((r) => r.mode);
    } finally {
      await db.query("rollback");
    }
  });
  assert(held.includes("RowShareLock"), `the purchase holds the wallet row until its transaction ends: ${show(held)}`);
  assert((await balanceOf(P)) === balance, "and the rolled-back purchase took nothing");
  // One after the other, the second sees the first: the same item twice, and two items the balance covers one of.
  assert(!(await call(P, "shop_buy", { p_item: "title-film-room" })).error, "the first purchase goes through");
  assert((await call(P, "shop_buy", { p_item: "title-film-room" })).error === "owned", "the same item again is owned");
  assert((await call(P, "shop_buy", { p_item: "title-waiver-hawk" })).error === "not_enough", "a second item the balance no longer covers is not_enough");
  // What stands behind the lock if anything ever got past it.
  const before = await everything({ counter: false });
  const fail = async (statement, params) => {
    try {
      await db.query(statement, params);
      return null;
    } catch (e) {
      return e;
    }
  };
  const copy = await fail("insert into inventory (user_id, item_id) values ($1, 'title-film-room')", [P]);
  assert(copy?.code === "23505", `a second copy breaks inventory's primary key: ${copy?.message}`);
  assert((await owner("select public.wallet_apply($1::uuid, $2::bigint, 'purchase', 'title-film-room') as n", [P, -LAUNCH_PRICES.common]))[0].n === 0, "a second charge for the same item is never recorded");
  const overdraft = await fail("select public.wallet_apply($1::uuid, $2::bigint, 'purchase', 'frame-flame')", [P, -LAUNCH_PRICES.legendary]);
  assert(/wallets_balance_check/.test(overdraft?.message || ""), `an overdraft breaks wallets' balance check and rolls back: ${overdraft?.message}`);
  assert((await everything({ counter: false })) === before, "none of them left anything behind");
});

await runTest("5d. equip_item wears only what you own in its own slot: unowned, wrong-slot, badge items without the badge, off sale and unowned, hostile slots and ids all refuse and change nothing - and what you own stays wearable off sale", async () => {
  const P = await account("dresser");
  await give(P, 10000);
  assert(!(await call(P, "shop_buy", { p_item: "frame-lime" })).error && !(await call(P, "shop_buy", { p_item: "pack-sideline" })).error, "P owns a frame and a pack");
  assert(!(await call(P, "equip_item", { p_slot: "frame", p_item: "frame-lime" })).error, "and wears the frame");
  await owner("update shop_items set active = false where id in ('frame-lime', 'frame-gold')");
  try {
    const kept = await detailsOf(P);
    const refusals = [
      ["frame", "frame-gold", "not_owned"], ["card", "card-gold-foil", "not_owned"], ["title", "title-cinderella", "not_owned"], ["frame", "frame-undefeated", "not_owned"],
      ["card", "card-dynasty", "not_owned"], ["title", "title-daily-winner", "not_owned"],
      ["frame", "card-night", "bad_item"], ["card", "frame-lime", "bad_item"], ["title", "pack-sideline", "bad_item"], ["frame", "pack-sideline", "bad_item"],
      ["frame", "frame-lime'; --", "bad_item"], ["frame", "FRAME-LIME", "bad_item"], ["frame", "", "bad_item"], ["frame", "x".repeat(100000), "bad_item"],
      ["avatar_pack", "pack-sideline", "bad_slot"], ["card_theme", "card-navy", "bad_slot"], ["FRAME", "frame-lime", "bad_slot"], [" frame", null, "bad_slot"],
      ["frame'; --", null, "bad_slot"], [null, null, "bad_slot"], ["showcase", null, "bad_slot"], ["avatar_preset", null, "bad_slot"],
    ];
    for (const [slot, item, code] of refusals) {
      const r = await call(P, "equip_item", { p_slot: slot, p_item: item });
      assert(r.error === code, `equip_item(${show(slot)}, ${show(item)}) should be ${code}, got ${show(r)}`);
    }
    assert(same(await detailsOf(P), kept), "no refusal changed what P wears");
    const offSale = await call(P, "equip_item", { p_slot: "frame", p_item: "frame-lime" });
    assert(offSale.data?.frame === "frame-lime", `an item P owns stays wearable after it goes off sale: ${show(offSale)}`);
  } finally {
    await owner("update shop_items set active = true where id in ('frame-lime', 'frame-gold')");
  }
});

await runTest("5e. set_showcase takes at most three distinct badge-shaped ids and nothing else: oversized, nested, null-holding, duplicated or hostile arrays all refuse and change nothing", async () => {
  const P = await account("shelf");
  assert(!(await call(P, "set_showcase", { p_badges: ["dynasty"] })).error, "P shows one badge");
  const kept = await detailsOf(P);
  const hostile = [
    ["a", "b", "c", "d"], BADGES.map((b) => b.id), Array.from({ length: 100000 }, (_, i) => `b${i}`), [["undefeated"]], [["undefeated", "dynasty"], ["cinderella", "scout"]],
    [null], ["undefeated", null], ["undefeated", "undefeated"], ["Undefeated"], ["undefeated "], [" undefeated"], [""], ["x".repeat(41)], ["under_score"],
    ["<img src=x onerror=alert(1)>"], ["undefeated'; update wallets set balance = 1000000; --"], [`undefeated${ch(0x200B)}`], [`und${ch(0x435)}feated`], [ch(0x1F3C6)],
    ["../dynasty"], ["dynasty\n"], ["%"],
  ];
  for (const badges of hostile) {
    const r = await call(P, "set_showcase", { p_badges: badges });
    assert(r.error === "bad_showcase", `set_showcase(${show(badges)}) should be bad_showcase, got ${show(r)}`);
  }
  const deep = await asUser(db, P, async () => {
    const answers = [];
    for (const literal of ["{{{a}}}", "[0:3]={a,b,c,d}", "{a,b,NULL}", "{a,b,b}"]) {
      try {
        await db.query(`select public.set_showcase($1::text[])`, [literal]);
        answers.push("saved");
      } catch (e) {
        answers.push(e.message);
      }
    }
    return answers;
  });
  assert(deep.every((a) => a === "bad_showcase"), `array literals a browser can't send through JSON are refused too: ${show(deep)}`);
  assert(same(await detailsOf(P), kept), "no refusal changed the showcase");
  const odd = await asUser(db, P, async () => (await db.query("select public.set_showcase('[5:7]={scout,dynasty,cinderella}'::text[]) as r")).rows[0].r);
  assert(same(odd.showcase, ["scout", "dynasty", "cinderella"]) && (await owner("select array_lower(showcase, 1) as lo from profile_details where user_id = $1", [P]))[0].lo === 1,
    `three ids numbered from somewhere else are saved in order, from 1: ${show(odd)}`);
  assert(SHOWCASE_MAX === 3, "the showcase holds three");
});

await runTest("5f. a pack's avatars need that pack bought: none without it, another pack's or another kind of item doesn't unlock them, and a pack taken off sale stays unlocked for its owners only", async () => {
  const P = await account("packer"), Q = await account("nopack");
  await give(P, 20000);
  await give(Q, 20000);
  const [first, second, third] = AVATAR_PACKS;
  for (const pack of AVATAR_PACKS) for (const { key } of pack.presets) assert((await call(P, "set_avatar", { p_path: null, p_preset: key })).error === "bad_preset", `${key} needs ${pack.item}`);
  // Items that aren't the pack: a title with a similar name, a frame, and the other packs.
  for (const item of ["title-film-room", "frame-lime", second.item]) assert(!(await call(P, "shop_buy", { p_item: item })).error, `P buys ${item}`);
  for (const { key } of [...first.presets, ...third.presets]) assert((await call(P, "set_avatar", { p_path: null, p_preset: key })).error === "bad_preset", `${key} stays locked`);
  for (const { key } of second.presets) assert((await call(P, "set_avatar", { p_path: null, p_preset: key })).data?.avatar_preset === key, `${key} is P's with ${second.item}`);
  for (const { key } of second.presets) assert((await call(Q, "set_avatar", { p_path: null, p_preset: key })).error === "bad_preset", "P's pack unlocks nothing for Q");
  await owner("update shop_items set active = false where id = $1", [second.item]);
  try {
    assert((await call(Q, "shop_buy", { p_item: second.item })).error === "unavailable", "off sale, Q can't buy the pack");
    assert((await call(Q, "set_avatar", { p_path: null, p_preset: second.presets[0].key })).error === "bad_preset", "or use its avatars");
    assert((await call(P, "set_avatar", { p_path: null, p_preset: second.presets[1].key })).data?.avatar_preset === second.presets[1].key, "P, who owns it, still can");
  } finally {
    await owner("update shop_items set active = true where id = $1", [second.item]);
  }
});

// ---------- 6. Earning in the database ----------

await runTest("6a. claim_minigame pays without a game played - the browser writes its own row, dated however it likes - but never more than 15 a game day, three days of each game at most at once, and never for another player's row", async () => {
  const P = await account("claimer"), Q = await account("bystander");
  const today = utcDate(Date.now());
  const claimsToday = async (uid) => (await owner("select coalesce(sum(amount), 0)::int as coins, count(*)::int as n from wallet_ledger where user_id = $1 and kind = 'minigame' and created_at >= $2", [uid, iso(utcMidnight())]))[0];
  assert((await call(P, "claim_minigame", { p_game: "over_under" })).error === "not_played", "no row, no claim");
  await owner("insert into sou_runs (date, user_id, username, score) values ($1, $2, 'x', 30)", [today, Q]);
  await owner("insert into builds (user_id, username, pos, overall, filled) values ($1, 'x', 'WR', 90, '{}')", [Q]);
  for (const game of ["over_under", "build"]) assert((await call(P, "claim_minigame", { p_game: game })).error === "not_played", `another player's ${game} row doesn't count`);
  const forged = await attempt(P, "insert into sou_runs (date, user_id, username, score) values ('2026-01-01', $1, 'x', 1)", [Q]);
  assert(/row-level security/.test(forged.error || ""), `nor can P write a row as Q: ${show(forged)}`);
  // The accepted gap (CLAUDE.md: the minigame tables are browser-written): rows with no game behind them, dated
  // generations ahead so they never age out of the 24-hour window.
  const spoofRun = await attempt(P, "insert into sou_runs (date, user_id, username, score, created_at) values ('2099-12-31', $1, 'x', 99, '2099-12-31T00:00:00Z')", [P]);
  const spoofBuild = await attempt(P, "insert into builds (user_id, username, pos, overall, filled, created_at) values ($1, 'x', 'QB', 1, '{}', '2099-12-31T00:00:00Z')", [P]);
  assert(!spoofRun.error && !spoofBuild.error, `the browser writes both rows itself: ${show([spoofRun, spoofBuild])}`);
  for (let i = 0; i < 6; i++) {
    for (const game of ["over_under", "build"]) {
      const r = await call(P, "claim_minigame", { p_game: game });
      assert(r.data?.credited === (i === 0 ? COIN_RULES.minigame : 0), `${game} claim ${i + 1}: ${show(r)}`);
    }
  }
  assert(same(await claimsToday(P), { coins: 2 * COIN_RULES.minigame, n: 2 }), `30 coins today, however often it's called: ${show(await claimsToday(P))}`);
  // The next UTC day the same rows pay again, once each: today's claims moved back a day stand in for the clock.
  await owner("update wallet_ledger set created_at = created_at - interval '1 day', ref = split_part(ref, ':', 1) || ':' || $2 where user_id = $1 and kind = 'minigame'", [P, utcDate(utcMidnight() - 1)]);
  for (let i = 0; i < 3; i++) {
    for (const game of ["over_under", "build"]) assert((await call(P, "claim_minigame", { p_game: game })).data?.credited === (i === 0 ? 15 : 0), `${game} on the next day, call ${i + 1}`);
  }
  assert(same(await claimsToday(P), { coins: 30, n: 2 }), "30 again the next day, and no more");
  assert(/permission denied for function claim_minigame/.test((await call(null, "claim_minigame", { p_game: "build" })).error || ""), "anon can't claim");

  // With the game's day, as the app sends it: each day some time zone could call today (UTC yesterday, today and
  // tomorrow) is its own key, so a row forged for each claims three days of a game at once - 90 coins for both
  // games - and after that, still one day of each a day. A day outside the window, or no day (the UTC date, the same
  // key as today's), pays nothing more.
  const R = await account("dayahead");
  const midnight = utcMidnight();
  const days = [utcDate(midnight - 1), utcDate(Date.now()), utcDate(midnight + 24 * 3600 * 1000)];
  for (const day of days) await attempt(R, "insert into sou_runs (date, user_id, username, score) values ($1, $2, 'x', 1)", [day, R]);
  await attempt(R, "insert into builds (user_id, username, pos, overall, filled) values ($1, 'x', 'QB', 1, '{}')", [R]);
  let burst = 0;
  for (const game of ["over_under", "build"]) {
    for (const day of [...days, null, utcDate(midnight - 24 * 3600 * 1000 - 1)]) {
      const r = await call(R, "claim_minigame", day ? { p_game: game, p_date: day } : { p_game: game });
      burst += r.data?.credited || 0;
    }
  }
  assert(burst === 6 * COIN_RULES.minigame, `at most three days of each game at once (${6 * COIN_RULES.minigame} coins), got ${burst}`);
});

await runTest("6b. the service functions' numbers at their edges - bigint and integer extremes, a number past what numeric rounds, 10,000-entry lists - are refused with their code, or pay exactly what they say", async () => {
  const P = await account("edges");
  const svc = (statement, params = [P]) => attempt(SERVICE, statement, params);
  const before = await everything();
  const refused = [
    ["select public.credit_coins($1::uuid, 9223372036854775807::bigint, 'season', 'EDGE', 20)", "bad_amount"],
    ["select public.credit_coins($1::uuid, '-9223372036854775808'::bigint, 'season', 'EDGE', 20)", "bad_amount"],
    ["select public.credit_coins($1::uuid, -1::bigint, 'daily', 'EDGE', null)", "bad_amount"],
    ["select public.credit_coins($1::uuid, 10001::bigint, 'daily', 'EDGE', null)", "bad_amount"],
    ["select public.credit_coins($1::uuid, 20::bigint, 'purchase', 'frame-lime', null)", "bad_kind"],
    ["select public.credit_coins($1::uuid, 20::bigint, 'season', repeat('x', 201), 20)", "bad_ref"],
    [`select public.award_badges($1::uuid, '[{"id": "first-down", "coins": 1e400}]'::jsonb)`, "bad_request"],
    [`select public.award_badges($1::uuid, '[{"id": "first-down", "coins": 9223372036854775808}]'::jsonb)`, "bad_request"],
    [`select public.award_badges($1::uuid, '[{"id": "first-down", "coins": -1e-400}]'::jsonb)`, "bad_request"],
    [`select public.award_badges($1::uuid, '[{"id": "first-down", "coins": 100.000000000000000000001}]'::jsonb)`, "bad_request"],
    [`select public.award_badges($1::uuid, '[{"id": "first-down", "coins": "100"}]'::jsonb)`, "bad_request"],
    [`select public.award_badges($1::uuid, (select jsonb_agg(jsonb_build_object('id', 'b-' || g, 'coins', 1)) from generate_series(1, 10000) g))`, "bad_request"],
    [`select public.award_badges($1::uuid, '[{"id": "first-down", "coins": 100}, {"id": "ring-bearer", "coins": 10001}]'::jsonb)`, "bad_request"],
  ];
  for (const [statement, code] of refused) {
    const r = await svc(statement);
    assert(r.error === code, `${statement.slice(0, 110)} should raise ${code}, got ${show(r)}`);
  }
  assert((await everything()) === before, "a refusal writes nothing, even partway down a list");
  const paid = [
    ["select public.credit_coins($1::uuid, 10000::bigint, 'daily', '2026-09-15:fantasy', null) as r", { credited: 10000, capped: false, duplicate: false }],
    ["select public.credit_coins($1::uuid, 0::bigint, 'season', 'ZERO', 20) as r", { credited: 0, capped: false, duplicate: false }],
    ["select public.credit_coins($1::uuid, 20::bigint, 'season', 'CAP-MIN', -2147483648) as r", { credited: 0, capped: true, duplicate: false }],
    ["select public.credit_coins($1::uuid, 20::bigint, 'season', 'CAP-MAX', 2147483647) as r", { credited: 20, capped: false, duplicate: false }],
    // -0 and 10000.000 are whole numbers and pass the shape check, and then neither of them is what is paid:
    // badge_rewards says first-down is 100 and starter is 100. Until v2.0.0 this line credited 10,000 coins,
    // because award_badges believed its caller. It is the service role's function and submit-run builds the
    // list from rewards.mjs, so nothing could reach it - but the wallet now decides what a badge is worth.
    [`select public.award_badges($1::uuid, '[{"id": "first-down", "coins": -0}, {"id": "starter", "coins": 10000.000}, {"id": "stat-nerd", "coins": 10000}]'::jsonb) as r`, { awarded: ["first-down", "starter", "stat-nerd"], credited: 200 }],
  ];
  for (const [statement, want] of paid) {
    const r = await svc(statement);
    const got = r.rows?.[0]?.r;
    assert(got && Object.entries(want).every(([k, v]) => same(got[k], v)), `${statement.slice(0, 100)}: expected ${show(want)}, got ${show(r)}`);
  }
  assert(same((await ledgerOf(P)).map((l) => l.ref), ["welcome", "2026-09-15:fantasy", "CAP-MAX", "first-down", "starter"]), `only the paying ones left ledger rows: ${show(await ledgerOf(P))}`);
  const [sum] = await owner("select (select balance from wallets where user_id = $1)::bigint as balance, (select sum(amount) from wallet_ledger where user_id = $1)::bigint as total", [P]);
  assert(Number(sum.balance) === Number(sum.total) && Number(sum.balance) === 250 + 10000 + 20 + 100 + 100, `the balance is the ledger's sum: ${show(sum)}`);
});

await runTest("6c. a badge pays once, however award_badges is repeated, reordered, duplicated inside a list or sent a new amount", async () => {
  const P = await account("medals");
  const award = (list) => attempt(SERVICE, "select public.award_badges($1::uuid, $2::jsonb) as r", [P, JSON.stringify(list)]).then((r) => r.rows?.[0]?.r ?? r);
  const b = (...pairs) => pairs.map(([id, coins]) => ({ id, coins }));
  const answers = [
    await award(b(["first-down", 100], ["ring-bearer", 100])),
    await award(b(["ring-bearer", 100], ["first-down", 100], ["undefeated", 1000])),
    await award(b(["undefeated", 1000], ["undefeated", 1000], ["first-down", 1000])),
    await award(b(["stat-nerd", 0])),
    await award(b(["stat-nerd", 500], ["ring-bearer", 10000])),
    await award([]),
  ];
  assert(same(answers.map((a) => a.credited), [200, 1000, 0, 0, 0, 0]), `credits: ${show(answers)}`);
  const badgeRows = (await ledgerOf(P)).filter((l) => l.kind === "badge");
  assert(same(badgeRows, [{ amount: 100, kind: "badge", ref: "first-down" }, { amount: 100, kind: "badge", ref: "ring-bearer" }, { amount: 1000, kind: "badge", ref: "undefeated" }]), `one payment a badge: ${show(badgeRows)}`);
  assert((await balanceOf(P)) === 250 + 1200, "1,200 coins of badges in all");
});

await runTest("6d. running migration-wallet.sql again pays nobody, however much careers have grown since", async () => {
  const unpaid = await owner("select id from profiles p where not exists (select 1 from wallet_ledger l where l.user_id = p.id and l.kind in ('starting', 'welcome'))");
  assert(unpaid.length === 0, `every account has its welcome coins or a starting balance: ${show(unpaid)}`);
  const P = await account("padded");
  await owner("update profiles set runs = runs + 5000, wins = wins + 90000, champs = champs + 900, perfect = perfect + 400, playoffs = playoffs + 4000 where id = $1", [P]);
  const before = await everything();
  await db.exec(sql("migration-wallet.sql"));
  assert((await everything()) === before, "not a coin or a row moved");
});

// ---------- 7. Accounts ----------

await runTest("7a. a moderator's rename leaves the wallet, ledger, badges, finished codes, inventory and everything worn with the account, and a newcomer taking the old name starts from nothing but welcome coins", async () => {
  const MOD = await account("modbot"), P = await account("renamee");
  await owner("insert into moderators (user_id) values ($1)", [MOD]);
  await give(P, 9000);
  assert(!(await call(P, "shop_buy", { p_item: "frame-lime" })).error && !(await call(P, "equip_item", { p_slot: "frame", p_item: "frame-lime" })).error, "P buys and wears a frame");
  await owner("insert into badge_awards (user_id, badge) values ($1, 'undefeated')", [P]);
  await owner("insert into finished_codes (user_id, code) values ($1, 'RENAME1')", [P]);
  const oldName = (await owner("select username from profiles where id = $1", [P]))[0].username;
  const rowsOf = async (uid) => plain({
    wallet: await owner("select balance, earned, spent from wallets where user_id = $1", [uid]), ledger: await ledgerOf(uid),
    awards: await owner("select badge from badge_awards where user_id = $1 order by badge", [uid]), codes: await owner("select code from finished_codes where user_id = $1 order by code", [uid]),
    inventory: await owner("select item_id from inventory where user_id = $1 order by item_id", [uid]), worn: await owner("select frame, card_theme, title, showcase from profile_details where user_id = $1", [uid]),
  });
  const before = await rowsOf(P);
  const r = await call(MOD, "mod_act", { p_user_id: P, p_action: "rename", p_new_name: "renamed_player" });
  assert(!r.error, `the rename goes through: ${show(r)}`);
  assert((await rowsOf(P)) === before, "every coin and item stays with the account");
  assert((await call(P, "shop_state")).data.equipped.frame === "frame-lime" && (await call(P, "wallet_state")).data.balance === await balanceOf(P), "and its own functions still answer it");
  const NEWCOMER = uuid(7998);
  await addAccount(db, { id: NEWCOMER, username: oldName });
  const s = (await call(NEWCOMER, "shop_state")).data;
  assert(s.balance === COIN_RULES.welcome && s.items.filter((i) => i.owned).every((i) => i.rarity === "free") && s.equipped.frame === null, `the old name brings nothing with it: ${show(s.equipped)}`);
  assert(same(await ledgerOf(NEWCOMER), [{ amount: 250, kind: "welcome", ref: "welcome" }]), "only welcome coins");
});

await runTest("7b. deleting an account deletes its coins, badges, codes, inventory and what it wore, touches nobody else's, and the same name signing up again starts over", async () => {
  const P = await account("leaver"), Q = await account("stayer");
  for (const uid of [P, Q]) {
    await give(uid, 9000);
    assert(!(await call(uid, "shop_buy", { p_item: "card-night" })).error && !(await call(uid, "equip_item", { p_slot: "card", p_item: "card-night" })).error, "each buys and wears a card");
    await owner("insert into badge_awards (user_id, badge) values ($1, 'dynasty')", [uid]);
    await owner("insert into finished_codes (user_id, code) values ($1, 'SHARED1')", [uid]);
  }
  const name = (await owner("select username from profiles where id = $1", [P]))[0].username;
  const countFor = async (uid) => (await owner(`select (select count(*) from wallets where user_id = $1) + (select count(*) from wallet_ledger where user_id = $1)
    + (select count(*) from badge_awards where user_id = $1) + (select count(*) from finished_codes where user_id = $1)
    + (select count(*) from inventory where user_id = $1) + (select count(*) from profile_details where user_id = $1) as n`, [uid]))[0].n;
  const qBefore = await countFor(Q);
  await owner("delete from auth.users where id = $1", [P]);
  assert(Number(await countFor(P)) === 0, "nothing of the deleted account is left");
  assert(Number(await countFor(Q)) === Number(qBefore), "and the other player's rows are all there");
  const AGAIN = uuid(7997);
  await addAccount(db, { id: AGAIN, username: name });
  assert(same(await ledgerOf(AGAIN), [{ amount: 250, kind: "welcome", ref: "welcome" }]) && (await call(AGAIN, "shop_state")).data.equipped.card === null, "signing up again starts at 250, wearing nothing");
});

await runTest("7c. a profile shows what a player wears, and nothing about their coins, purchases or badge awards - signed out or in", async () => {
  const P = await account("showoff"), V = await account("visitor");
  await give(P, 30000);
  for (const item of ["frame-gold", "title-draft-guru", "pack-night-game", "card-ticket"]) assert(!(await call(P, "shop_buy", { p_item: item })).error, `P buys ${item}`);
  assert(!(await call(P, "equip_item", { p_slot: "frame", p_item: "frame-gold" })).error && !(await call(P, "equip_item", { p_slot: "title", p_item: "title-draft-guru" })).error, "P wears two of them");
  await owner("insert into badge_awards (user_id, badge) values ($1, 'cinderella')", [P]);
  const name = (await owner("select username from profiles where id = $1", [P]))[0].username;
  const PRIVATE = /balance|earned|spent|ledger|inventory|wallet|awarded|acquired|finished|purchase/i;
  const keysOf = (v, out = []) => {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.push(k); keysOf(x, out); }
    return out;
  };
  for (const who of [null, V]) {
    const r = await call(who, "player_profile", { p_username: name });
    assert(!r.error && same(Object.keys(r.data).sort(), ["details", "profile", "stats"]), `the profile's shape: ${show(r)}`);
    assert(r.data.details.frame === "frame-gold" && r.data.details.title === "title-draft-guru", "it shows what P wears");
    const leaked = keysOf(r.data).filter((k) => PRIVATE.test(k));
    assert(leaked.length === 0, `no key about coins or purchases: ${show(leaked)}`);
    const text = plain(r.data);
    assert(!text.includes("pack-night-game") && !text.includes("card-ticket") && !text.includes("cinderella"), "an item bought but not worn, and a badge award, aren't in it");
  }
  const profileColumns = (await owner("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles'")).map((c) => c.column_name);
  assert(!profileColumns.some((c) => /coin|balance|wallet/.test(c)), `profiles, which everyone reads, has no coin column: ${show(profileColumns)}`);
});

await db.close();

// ======================================================================================================================
// submit-run, through the test mock
// ======================================================================================================================

globalThis.window = globalThis.window || {};
const auth = makeMockAuth();
window.__ps_supabase__ = auth;
const { submitRun, submitDnf } = await import("../storage.js");
const TODAY = utcDate(Date.now());
const JOINED_LATER = "2026-11-01T00:00:00.000Z"; // after Day One's window, so that badge only pays where a test wants it

let signups = 0;
async function signUp(username, profile = {}) {
  const email = `economy${++signups}@example.com`;
  const { data, error } = await auth.auth.signUp({ email, password: "Password1", options: { data: { username } } });
  assert(!error, `signing up ${username}: ${show(error)}`);
  Object.assign(auth._profiles.get(data.user.id), { created_at: JOINED_LATER, ...profile });
  return { id: data.user.id, email };
}
const signIn = (who) => auth.auth.signInWithPassword({ email: who.email, password: "Password1" });
const rowsOf = (map, uid) => [...map.values()].filter((r) => r.user_id === uid);
const mockLedger = (uid) => rowsOf(auth._ledger, uid).sort((a, b) => a.id - b.id).map(({ amount, kind, ref }) => ({ amount, kind, ref }));
// Everything a submission can write for a player.
const snapshotOf = (uid) => plain({
  profile: auth._profiles.get(uid), runs: rowsOf(auth._runs, uid), daily: rowsOf(auth._dailyRuns, uid), ledger: rowsOf(auth._ledger, uid),
  wallet: auth._wallets.get(uid) ?? null, awards: rowsOf(auth._badgeAwards, uid), codes: rowsOf(auth._finishedCodes, uid),
});
const free = (code, trace, { gm = false, genius = false, format, mode = {}, body = {} } = {}) =>
  submitRun({ mode: { kind: "free", code, ...mode }, history: trace.history, seq: trace.seq, gm, genius, format, ...body });
const daily = (date, format = "fantasy", { mode = {}, body = {} } = {}) => {
  const trace = draftTrace(GL.dailySeed(date, format));
  return submitRun({ mode: { kind: "daily", date, ...mode }, history: trace.history, seq: trace.seq, gm: false, format, ...body });
};
const badgeCoins = (ids) => ids.reduce((sum, id) => sum + BADGE_BY_ID[id].coins, 0);

// ---------- 8. submit-run ----------

await runTest("8a. through the client itself, the coin and shop tables refuse every read and write they must, and credit_coins, award_badges and the helpers aren't callable", async () => {
  const P = await signUp("restclient");
  const state = () => plain([auth._wallets, auth._ledger, auth._badgeAwards, auth._finishedCodes, auth._inventory, auth._shopItems, auth._profileDetails, auth._avatarPresets].map((m) => [...m.entries()]));
  const before = state();
  for (const table of ["wallets", "wallet_ledger", "badge_awards", "finished_codes", "inventory"]) {
    const all = await auth.from(table).select("*");
    const one = await auth.from(table).select("*").eq("user_id", P.id).single();
    assert(all.error?.code === "42501" && all.data == null && one.error?.code === "42501", `${table} can't be read: ${show([all, one])}`);
  }
  const forged = { user_id: P.id, balance: 1000000, earned: 1000000, amount: 10000, kind: "season", ref: "FORGED", badge: "undefeated", code: "FORGED", item_id: "frame-flame", id: "frame-flame", price: 1, rarity: "free", key: "floodlights", free: true, frame: "frame-flame" };
  for (const table of ["wallets", "wallet_ledger", "badge_awards", "finished_codes", "inventory", "shop_items", "avatar_presets", "profile_details"]) {
    for (const [what, write] of [
      ["insert", () => auth.from(table).insert(forged)], ["upsert", () => auth.from(table).upsert(forged)],
      ["update", () => auth.from(table).update(forged).eq("user_id", P.id)], ["delete", () => auth.from(table).delete().eq("user_id", P.id)],
    ]) {
      const r = await write();
      assert(r?.error?.code === "42501", `${what} ${table} is refused: ${show(r)}`);
    }
  }
  const catalog = await auth.from("shop_items").select("*");
  assert(!catalog.error && catalog.data.length === SHOP_ITEMS.length, "the catalog reads");
  for (const fn of ["credit_coins", "award_badges", "wallet_apply", "wallet_lock", "create_wallet"]) {
    const r = await auth.rpc(fn, { p_user: P.id, p_amount: 10000, p_kind: "season", p_ref: "FORGED", p_daily_cap: null, p_badges: [{ id: "hall-of-famer", coins: 10000 }] });
    assert(r.error && r.data == null, `${fn} isn't a function the client reaches: ${show(r)}`);
  }
  assert(state() === before, "nothing changed");
});

await runTest("8b. what a season pays is the server's alone: a submission stuffed with coins, amounts, points, par, streaks, badges and another player's id pays exactly what the same draft pays clean, and only its sender", async () => {
  const clean = await signUp("twinclean"), dirty = await signUp("twindirty");
  const code = "TWIN-CODE", trace = draftTrace(code);
  await signIn(clean);
  const a = await free(code, trace);
  const cleanWallet = plain(auth._wallets.get(clean.id));
  await signIn(dirty);
  const b = await free(code, trace, {
    mode: { date: TODAY, seed: "daily-2026-01-01", coins: 99999, streak: 999, format: "standard", gm: true, dailyCap: null },
    body: {
      coins: { earned: 99999, balance: 99999, lines: [{ key: "season", label: "x", coins: 99999 }] }, amount: 10000, credited: 10000, points: 999999, par: 0.0001,
      capUsed: 1, streak: 1000, dailyStreak: 1000, newBadges: ["hall-of-famer", "daily-winner"], badges: [{ id: "hall-of-famer", coins: 10000 }],
      p_amount: 10000, p_daily_cap: null, dailyCap: null, reward: { amount: 10000, kind: "daily" }, user_id: clean.id, userId: clean.id, p_user: clean.id,
    },
  });
  assert(a.ok && b.ok, `both count: ${show([a.ok, b.ok, b.error])}`);
  assert(same(b.coins, a.coins) && same(b.newBadges, a.newBadges), `the stuffed submission pays what the clean one does: ${show(b.coins)} vs ${show(a.coins)}`);
  const reward = seasonReward(b.run, {});
  assert(b.coins.earned === reward.amount + badgeCoins(b.newBadges) && b.run.format === "fantasy" && b.run.gm === false && reward.ref === code, `computed from the server's run: ${show(reward)}`);
  assert(same(mockLedger(dirty.id), mockLedger(clean.id)), "the two ledgers match row for row");
  assert(plain(auth._wallets.get(clean.id)) === cleanWallet, "and naming the other player paid them nothing");

  const dailyClean = await signUp("dayclean"), dailyDirty = await signUp("daydirty");
  await signIn(dailyClean);
  const c = await daily(TODAY);
  await signIn(dailyDirty);
  const d = await daily(TODAY, "fantasy", { mode: { streak: 500, code: "X" }, body: { streak: 500, dailyStreak: 500, coins: 99999 } });
  assert(c.ok && d.ok && same(d.coins, c.coins), `a Daily's streak line is the server's too: ${show(d.coins)} vs ${show(c.coins)}`);
});

await runTest("8c. a GM season must fit under the salary cap: an uncapped roster sent as GM is refused before anything is written (index.ts the same, ahead of its duplicate guard), and the same roster counts as what it is", async () => {
  const cheat = await signUp("capdodger");
  let code = null, trace = null;
  for (let i = 0; i < 50 && !trace; i++) {
    const t = draftTrace(`OVERCAP-${i}`, { best: true });
    if (t && capOf(t.roster) > GL.GM_CAP && capOf(t.roster, "standard") > GL.GM_CAP) ({ code, trace } = { code: `OVERCAP-${i}`, trace: t });
  }
  assert(trace, "a best-available roster over the cap in both formats");
  const before = snapshotOf(cheat.id);
  for (const format of ["fantasy", "standard"]) {
    const r = await free(code, trace, { gm: true, format, mode: { gm: true } });
    assert(!r.ok && r.error === "illegal roster" && r.reason === "over the salary cap", `an uncapped roster as GM (${format}, $${capOf(trace.roster, format)}M): ${show(r)}`);
  }
  assert(snapshotOf(cheat.id) === before, "nothing was written: no profile change, runs-log row, code or coins");
  // A Daily claiming GM isn't a GM season at all: submit-run ignores the flag on a Daily, so it counts as the plain
  // Daily it is - scored against the plain par and kept off the GM board - whatever the cap would have said.
  const asDaily = draftTrace(GL.dailySeed(TODAY, "fantasy"), { best: true });
  const dailyRes = await submitRun({ mode: { kind: "daily", date: TODAY }, history: asDaily.history, seq: asDaily.seq, gm: true });
  assert(dailyRes.ok && dailyRes.run.gm === false && dailyRes.run.capUsed === undefined,
    `a Daily claiming GM counts as a plain Daily: ${show(dailyRes.run ? { gm: dailyRes.run.gm, capUsed: dailyRes.run.capUsed } : dailyRes)}`);
  // What the refusal keeps off the books: the same roster's points against the capped bot's par, when it has one.
  const run = settle(code, trace);
  const cappedPar = GL.botPar(trace.history.map((h) => h.key), { format: "fantasy", gm: true });
  if (cappedPar) assert(GL.draftPoints(run.score, cappedPar) >= run.points, `claiming GM would score ${GL.draftPoints(run.score, cappedPar)} ladder points, not ${run.points}`);
  const plainRun = await free(code, trace);
  assert(plainRun.ok && plainRun.run.gm === false && plainRun.run.capUsed === undefined && plainRun.run.points === run.points, `sent as Unlimited it counts: ${show(plainRun.run?.points)}`);

  let capped = null, cappedCode = null;
  for (let i = 0; i < 50 && !capped; i++) {
    const t = draftTrace(`CAPPED-${i}`, { gm: true, best: true });
    if (t) ({ capped, cappedCode } = { capped: t, cappedCode: `CAPPED-${i}` });
  }
  const gmRun = await free(cappedCode, capped, { gm: true, mode: { gm: true } });
  assert(gmRun.ok && gmRun.run.gm === true && gmRun.run.capUsed === capOf(capped.roster) && gmRun.run.capUsed <= GL.GM_CAP, `a GM draft kept under the cap counts: ${show(gmRun.run?.capUsed)}`);

  // The app's own rule is the same line: a pick costing more than what's left can't be locked in, so a GM roster is at most the cap.
  const app = readFileSync(new URL("../perfect-season.jsx", import.meta.url), "utf8");
  assert(/const tooExpensive = mode\.gm && cost > capRemaining;/.test(app) && /const capRemaining = GM_CAP - capUsed;/.test(app), "perfect-season.jsx refuses a pick costing more than the cap has left");
  const index = readFileSync(new URL("../supabase/functions/submit-run/index.ts", import.meta.url), "utf8");
  const refusal = index.indexOf(`if (gm && finalCapUsed > GL.GM_CAP) return json({ error: "illegal roster", reason: "over the salary cap" }, 400);`);
  assert(refusal > 0 && refusal < index.indexOf('service.from("daily_runs").insert') && refusal < index.indexOf('service.from("finished_codes").insert'),
    "index.ts refuses a GM roster over the cap, before its duplicate guard writes anything");
});

// Two rules that ship in files nothing in this suite executes. The mocks mirror the Edge Function and PGlite
// runs the SQL, so both are checked - but the mirror is not the thing that ships, and PGlite's own collation
// is C, which is the one setting under which the collate clauses do nothing. Both were verified by deleting
// them: the whole suite stayed green. Read as text, the way the GM cap refusal above already is.
await runTest("the rules that only exist in the deployed files are in the deployed files", async () => {
  const index = readFileSync(new URL("../supabase/functions/submit-run/index.ts", import.meta.url), "utf8");
  // profiles is a read-modify-write, so every write carries the revision it read. Without this a finished
  // season is silently overwritten by the DNF that "Run it back" fires, while finished_codes keeps the code
  // and the ledger keeps the coins - the one failure CLAUDE.md calls unrecoverable.
  assert(/\.eq\("rev", *(row\.rev *\|\| *0|Number\(row\.rev\) *\|\| *0)\)/.test(index),
    "applyToProfile guards its update on the rev it read");
  assert(/rev: *\(?(row\.rev *\|\| *0)\)? *\+ *1/.test(index), "and bumps it, so the next writer sees the change");
  const cas = index.indexOf('.eq("rev"');
  assert(cas > index.indexOf("for (let attempt"), "inside the retry loop, not before it");

  // Every username tiebreak in the Stats SQL sorts collate "C", because tests/helpers.mjs's JS mirror compares
  // code points and a Supabase database is created en_US.UTF-8. PGlite is C, so the parity test cannot see a
  // missing one - best_win_pct and most_drafted were both left out of the original sweep and nothing noticed.
  const runs = readFileSync(new URL("../supabase/migration-runs-log.sql", import.meta.url), "utf8");
  const orders = runs.split("\n").filter((l) => /order by/.test(l) && /username|entry->>'name'|\bname\b/.test(l) && !/^\s*--/.test(l));
  const uncollated = orders.filter((l) => !/collate "C"/.test(l));
  assert(orders.length >= 8, `enough username orderings to be checking the right thing: ${orders.length}`);
  assert(uncollated.length === 0, `every one of them collates:\n  ${uncollated.join("\n  ")}`);
});

await runTest("8d. the same draft counts once: the same code in any variant or format is a duplicate, while a code's case and space variants are other seeds - other boards, needing their own legal draft, each counting once", async () => {
  const P = await signUp("codevariants");
  // A code whose first-pick draft fits the GM cap in both formats, so every variant below is a legal season.
  const base = ["K3F9QZ", "QB7XWR", "TE4SPN", "RB2GAP"].find((c) => capOf(draftTrace(c).roster) <= GL.GM_CAP && capOf(draftTrace(c).roster, "standard") <= GL.GM_CAP);
  assert(base, "a code whose first-pick draft fits under the cap");
  const first = await free(base, draftTrace(base));
  assert(first.ok, `the code counts: ${show(first.error)}`);
  const before = snapshotOf(P.id);
  for (const extra of [{}, { gm: true, mode: { gm: true } }, { genius: true }, { format: "standard" }, { format: "fantasy" }, { gm: true, genius: true, format: "standard" }]) {
    const again = await free(base, draftTrace(base), extra);
    assert(same(again, { ok: false, reason: "duplicate" }), `${base} again ${show(extra)}: ${show(again)}`);
  }
  assert(snapshotOf(P.id) === before, "no repeat wrote anything");
  const fullWidth = (c) => ch(0xFF21 + c.charCodeAt(0) - 65);
  const variants = [base.toLowerCase(), base[0] + base.slice(1).toLowerCase(), ` ${base}`, `${base} `, `${base}\t`, `${base.slice(0, 3)} ${base.slice(3)}`,
    `${base}${ch(0x200B)}`, fullWidth(base[0]) + base.slice(1), `${base}0`];
  const baseBoards = GL.seededSequence(base).join();
  for (const v of variants) {
    assert(GL.seededSequence(v).join() !== baseBoards, `${show(v)} deals other boards`);
    const borrowed = await free(v, draftTrace(base));
    assert(!borrowed.ok && borrowed.error === "illegal roster", `${base}'s draft sent as ${show(v)} doesn't replay: ${show(borrowed)}`);
  }
  assert(snapshotOf(P.id) === before, "a borrowed draft writes nothing");
  for (const v of variants) {
    const own = await free(v, draftTrace(v));
    assert(own.ok && own.coins?.lines[0]?.key === "season", `${show(v)} with its own draft counts and pays: ${show(own.error)}`);
    assert(same(await free(v, draftTrace(v)), { ok: false, reason: "duplicate" }), `and only once (${show(v)})`);
  }
  assert(rowsOf(auth._finishedCodes, P.id).length === variants.length + 1 && mockLedger(P.id).filter((l) => l.kind === "season").length === variants.length + 1, "one code row and one payment per seed");
});

await runTest("8e. a Daily counts once per date and format; the three dates a player's clock can be on each count once, and playing them early moves the streak two days ahead at most", async () => {
  const P = await signUp("dailyrunner");
  const [yesterday, tomorrow, twoAhead, twoBack] = [-1, 1, 2, -2].map((n) => utcDate(Date.now() + n * DAY));
  const streaks = [];
  for (const date of [yesterday, TODAY, tomorrow]) {
    for (const format of ["fantasy", "standard"]) {
      const r = await daily(date, format);
      assert(r.ok && r.coins?.lines[0]?.coins === COIN_RULES.dailySeason, `${date} ${format} counts and pays the Daily's 40: ${show(r.error)}`);
      streaks.push(r.coins.lines.find((l) => l.key === "streak")?.coins);
      const again = await daily(date, format);
      assert(same(again, { ok: false, reason: "duplicate" }), `${date} ${format} again: ${show(again)}`);
    }
  }
  assert(same(streaks, [5, 5, 10, 10, 15, 15]), `the streak climbs a day per date, both formats sharing it: ${show(streaks)}`);
  for (const date of [twoAhead, twoBack, "2026-02-30", `${TODAY} `, TODAY.replace(/-/g, "/")]) {
    const r = await daily(date);
    assert(!r.ok && r.error === "a daily submission must be for today", `a Daily dated ${show(date)} is refused: ${show(r)}`);
  }
  const dailyRows = mockLedger(P.id).filter((l) => l.kind === "daily");
  assert(dailyRows.length === 6 && new Set(dailyRows.map((l) => l.ref)).size === 6, `six Dailies paid, once each: ${show(dailyRows)}`);
  // Out of order, a streak starts over instead of stretching.
  const Q = await signUp("dailyjumper");
  const late = await daily(tomorrow);
  const early = await daily(TODAY);
  assert(late.coins.lines.find((l) => l.key === "streak").coins === 5 && early.coins.lines.find((l) => l.key === "streak").coins === 5, "tomorrow's then today's: each a one-day streak");
  void Q;
});

await runTest("8f. 20 Unlimited, Genius and GM seasons pay each UTC day - the 21st counts but pays nothing, the allowance comes back after UTC midnight, and Dailies neither count toward it nor use it up", async () => {
  const P = await signUp("capgrinder");
  for (const format of ["fantasy", "standard"]) assert((await daily(TODAY, format)).ok, `today's ${format} Daily first`);
  let paid = 0;
  for (let i = 1; i <= COIN_RULES.paidSeasonsPerDay + 2; i++) {
    const code = `GRINDER-${i}`;
    const variant = i % 3 === 0 ? { genius: true } : {};
    const r = await free(code, draftTrace(code), variant);
    assert(r.ok, `season ${i} counts: ${show(r.error)}`);
    if (!r.coins.capped) paid++;
    assert(r.coins.capped === (i > COIN_RULES.paidSeasonsPerDay), `season ${i} capped: ${r.coins.capped}`);
  }
  assert(paid === COIN_RULES.paidSeasonsPerDay && auth._profiles.get(P.id).runs === COIN_RULES.paidSeasonsPerDay + 2 + 2, "20 paid, and all 24 seasons are on the record");
  // UTC midnight passes: today's paid seasons become yesterday's.
  const lastNight = iso(utcMidnight() - 1);
  for (const row of rowsOf(auth._ledger, P.id)) if (row.kind === "season") row.created_at = lastNight;
  const next = await free("GRINDER-NEXT-DAY", draftTrace("GRINDER-NEXT-DAY"));
  assert(next.ok && next.coins.capped === false && next.coins.lines[0]?.key === "season", `the next day's first season pays: ${show(next.coins)}`);
  // A DNF pays nothing and takes no allowance.
  const ledgerBefore = plain(mockLedger(P.id));
  for (const ladder of ["unlimited", "gm", "daily"]) assert((await submitDnf(6, ladder)) === true, `a ${ladder} DNF is recorded`);
  assert(plain(mockLedger(P.id)) === ledgerBefore, "DNFs moved no coins");
});

// ---------- 9. The browser ----------

await runTest("9a. the shop's browser code has no HTML sinks or links built from data, its CSS images are constants, and storage-shop.js never sends a player id", async () => {
  const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const sinks = /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write\s*\(|\beval\s*\(|new\s+Function\s*\(|srcdoc/;
  for (const file of ["cosmetics.jsx", "shop.jsx", "storage-shop.js", "rewards.mjs", "shop-catalog.mjs"]) {
    const m = sinks.exec(source(file));
    assert(!m, `${file} uses ${m?.[0]}`);
  }
  for (const file of ["cosmetics.jsx", "shop.jsx"]) {
    const text = source(file);
    assert(!/\bhref\s*=/.test(text), `${file} builds a link`);
    assert(!/\bsrc\s*=\s*\{/.test(text), `${file} sets an image address`);
    const urls = text.match(/url\(/g) || [];
    if (file !== "cosmetics.jsx") {
      assert(urls.length === 0, `${file}'s CSS images: ${urls.length}`);
      continue;
    }
    // Two, both SVG markup the file builds itself: the Dynasty card's laurel wreath, and the titles' marks - and
    // markMask is only ever given a literal path, so nothing from a player reaches a stylesheet.
    const constant = text.match(/return `url\("data:image\/svg\+xml,\$\{encodeURIComponent\(svg\)\}"\)[^`]*`;/g) || [];
    const markArgs = [...text.matchAll(/\bmarkMask\(([^)]*)\)/g)].map((m) => m[1]);
    assert(urls.length === 2 && constant.length === 2, `${file}'s CSS images: ${urls.length}, ${constant.length} of them built from its own SVG markup`);
    assert(markArgs.length > 0 && markArgs.every((arg) => /^"[MLHVZ0-9. -]+"$/.test(arg)), `markMask is only given literal paths, got ${markArgs.join(" | ")}`);
  }
  const calls = [...source("storage-shop.js").matchAll(/\.rpc\("([a-z_]+)",\s*(\{[^}]*\})/g)].map(([, fn, args]) => [fn, [...args.matchAll(/([a-z_]+):/g)].map((x) => x[1])]);
  assert(same(calls.map(([fn]) => fn).sort(), ["claim_minigame", "equip_item", "set_showcase", "shop_buy", "shop_state", "wallet_state"]), `storage-shop.js's calls: ${show(calls)}`);
  assert(calls.every(([, keys]) => keys.every((k) => ["p_item", "p_slot", "p_badges", "p_game", "p_date"].includes(k))), `no call names a player: ${show(calls)}`);
});

await runTest("9b. the wallet panel shows a ledger's refs and kinds as text: a hostile challenge code, item or kind never becomes markup", async () => {
  setupDom();
  const { WalletPanel } = await loadModule("shop.jsx");
  const HOSTILE = `<img src=x onerror="alert(1)">`;
  const wallet = {
    balance: 1234, earned: 2000, spent: 766,
    recent: [
      { amount: 186, kind: "season", ref: HOSTILE, createdAt: new Date().toISOString() },
      { amount: -750, kind: "purchase", ref: "javascript:alert(1)", createdAt: null },
      { amount: 100, kind: "badge", ref: `<script>alert(1)</script>`, createdAt: null },
      { amount: 15, kind: "minigame", ref: `"><svg onload=alert(1)>:2026-09-15`, createdAt: null },
      { amount: 5, kind: `<iframe src="javascript:alert(1)">`, ref: "x", createdAt: null },
    ],
  };
  const { container } = await renderComponent(WalletPanel, { wallet });
  assert(!container.querySelector("script, img, iframe, svg[onload], a[href], object, embed"), `no element from the refs: ${container.innerHTML.slice(0, 300)}`);
  for (const el of container.querySelectorAll("*")) for (const { name } of el.attributes) assert(!/^on/i.test(name), `an ${name} attribute`);
  const text = container.textContent;
  assert(text.includes("Season") && !text.includes(HOSTILE) && text.includes("<script>alert(1)</script> badge") && text.includes(`<iframe src="javascript:alert(1)">`), `the refs that show, show as text: ${text.slice(0, 300)}`);
});

// ---------- 10. The economy ----------

// Drafters from badges.mjs's calibration: the strong one takes the best available player every pick, the middling one
// a random pick from the best four.
const STRONG = (options) => options[0];
const MIDDLING = (options, rng) => options[Math.floor(rng() * Math.min(4, options.length))];
const economy = {};

await runTest("10. the economy from real seasons graded as submit-run grades them: a casual day earns between a Common a week and a Common a day, every season pays at least its finishing coins, and no day pays a Legendary", async () => {
  const rng = GL.mulberry32(GL.hashStr("economy-sanity"));
  const seasonCoins = [];
  const play = (seed, choose, { format = "fantasy", gm = false, kind = "free", streak = 0 } = {}) => {
    for (let tries = 0; tries < 5; tries++) {
      const s = tries ? `${seed}~${tries}` : seed;
      const trace = draftTrace(s, { format, gm, choose, rng });
      if (!trace) continue;
      const run = settle(s, trace, { format, gm, kind });
      const coins = coinsForRun(run, { streak }).total;
      assert(coins >= (kind === "daily" ? COIN_RULES.dailySeason : COIN_RULES.season), `a finished ${kind} season pays its finishing coins: ${coins}`);
      seasonCoins.push(coinsForRun(run, {}).total);
      return coins;
    }
    return 0;
  };
  const DAYS = 25;
  const casual = [], heavy = [];
  for (let d = 0; d < DAYS; d++) {
    const date = utcDate(Date.UTC(2026, 10, 1) + d * DAY);
    // Casual: the Daily on a streak already paying its most, and three Unlimited seasons.
    let c = play(GL.dailySeed(date, "fantasy"), MIDDLING, { kind: "daily", streak: 10 + d });
    for (let i = 0; i < 3; i++) c += play(`CASUAL-${d}-${i}`, MIDDLING);
    casual.push(c);
    // Heavy: both Dailies, 20 paid Unlimited and GM seasons (anything past 20 pays nothing), both minigames.
    let h = play(GL.dailySeed(date, "fantasy"), STRONG, { kind: "daily", streak: 10 + d }) + play(GL.dailySeed(date, "standard"), STRONG, { kind: "daily", format: "standard", streak: 10 + d });
    for (let i = 0; i < COIN_RULES.paidSeasonsPerDay; i++) h += play(`HEAVY-${d}-${i}`, STRONG, { gm: i % 3 === 2 });
    heavy.push(h + 2 * COIN_RULES.minigame);
  }
  economy.casual = mean(casual);
  economy.heavy = mean(heavy);
  economy.maxSeason = Math.max(...seasonCoins);
  // The most a day can pay: 20 seasons and both Dailies at the most any season here paid, both at a full streak, both claims.
  economy.ceiling = COIN_RULES.paidSeasonsPerDay * economy.maxSeason + 2 * (economy.maxSeason + COIN_RULES.dailySeason - COIN_RULES.season + COIN_RULES.streakMax) + 2 * COIN_RULES.minigame;
  assert(economy.casual > LAUNCH_PRICES.common / 7 && economy.casual < LAUNCH_PRICES.common, `a casual day earns ${Math.round(economy.casual)}: between a Common a week and a Common a day`);
  assert(economy.heavy > economy.casual && economy.heavy < LAUNCH_PRICES.legendary / 2, `a heavy day earns ${Math.round(economy.heavy)}: more than a casual one, less than half a Legendary`);
  assert(economy.ceiling < LAUNCH_PRICES.legendary, `no day can pay a Legendary: the most is about ${economy.ceiling}`);
  const oneTimeBadges = BADGES.reduce((sum, b) => sum + b.coins, 0);
  const catalog = SHOP_ITEMS.reduce((sum, i) => sum + (LAUNCH_PRICES[i.rarity] || 0), 0);
  console.log(`    a casual day ~${Math.round(economy.casual)} coins (a Common in ${(LAUNCH_PRICES.common / economy.casual).toFixed(1)} days, a Legendary in ${Math.round(LAUNCH_PRICES.legendary / economy.casual)});`
    + ` a heavy day ~${Math.round(economy.heavy)} (a Legendary in ${(LAUNCH_PRICES.legendary / economy.heavy).toFixed(1)} days); the most a season paid ${economy.maxSeason};`
    + ` every badge once ${oneTimeBadges.toLocaleString("en-US")}; the whole catalog ${catalog.toLocaleString("en-US")}`);
});

// ---------- Known gaps ----------
// Printed, not asserted: each closes outside these files, or is a gap CLAUDE.md accepts. What each is worth is measured.
{
  const lines = [];
  // game-logic.mjs's replayDraft checks each pick against the boards in order, but lets a trace pass over a board it
  // could have picked from - which the app never does (it moves on only by picking, or by a re-spin, which puts the new
  // board straight after). So a modified client can take its six boards from the sequence's eighteen.
  let accepted = 0, traces = 0, gain = 0;
  for (let i = 0; i < 80; i++) {
    const seed = `PASSOVER-${i}`;
    const seq = GL.seededSequence(seed);
    const roster = {}, drafted = new Set(), history = [];
    let passed = 0;
    for (let si = 0; si < seq.length && history.length < GL.SLOTS.length; si++) {
      const open = GL.SLOTS.filter((s) => !roster[s]);
      if (!GL.boardHasOption(seq[si], drafted, open)) continue;
      const options = GL.BOARDS[seq[si]].filter((p) => !drafted.has(p.id)).flatMap((p) => open.filter((s) => GL.fits(p.pos, s)).map((s) => ({ p, s, r: GL.effectiveRating(s, p) })))
        .sort((a, b) => b.r - a.r);
      if (options[0].r < 110 && seq.length - si > open.length + 2) { passed++; continue; }
      roster[options[0].s] = options[0].p;
      drafted.add(options[0].p.id);
      history.push({ key: seq[si], id: options[0].p.id, season: options[0].p.season, slot: options[0].s });
    }
    const honest = draftTrace(seed, { best: true });
    if (history.length < GL.SLOTS.length || !passed || !honest) continue;
    traces++;
    if (GL.replayDraft(seed, history, seq).ok) accepted++;
    gain += settle(seed, { roster, history }).score - settle(seed, honest).score;
  }
  if (accepted) lines.push(`game-logic.mjs replayDraft accepts a trace that passes over boards it could pick from (${accepted} of ${traces} such traces); taking only boards with a 110+ player raised a best-available drafter's team score by ${(gain / traces).toFixed(1)} on average`);
  lines.push("the Genius flag is the client's word (it only hides stats on screen): a Genius title pays Big Brain's 300 coins and counts on the Genius ladder, unverifiable");
  lines.push(`Over/Under and Build-a-player rows are browser-written, so claim_minigame pays ${2 * COIN_RULES.minigame} coins a day without a game played (${6 * COIN_RULES.minigame} at once, claiming the three days a time zone could call today) - no more than an honest player's claims over time`);
  lines.push(`codes are the client's choice and a lineup's season is known before it's sent, so searching codes offline for 20-0 seasons pays at most about ${economy.ceiling ?? "?"} coins a day (a Legendary in ${economy.ceiling ? (LAUNCH_PRICES.legendary / economy.ceiling).toFixed(1) : "?"} days)`);
  console.log(`  known gaps still open (${lines.length}):`);
  for (const line of lines) console.log(`    - ${line}`);
}

console.log("test-economy-security.mjs done");
