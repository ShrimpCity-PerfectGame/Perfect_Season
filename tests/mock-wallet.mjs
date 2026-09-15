// The test mock's side of supabase/migration-wallet.sql (SHOP.md 3.1): wallets, wallet_ledger, badge_awards and
// finished_codes; the functions credit_coins and award_badges (the Edge Function's, reachable here only through
// `server`, the way only the service role can call them), claim_minigame and wallet_state; and the signup
// trigger's welcome coins (`welcome`). tests/test-wallet-sql.mjs runs the same calls through the real SQL and
// through this mock and requires the same results.
//
// A database function refusing something throws new Error("<code>"), like the other mock modules;
// tests/mock-supabase.mjs's rpc() turns that into the error a real PostgREST call returns.
import { COIN_RULES } from "../rewards.mjs";

const fail = (code) => {
  throw new Error(code);
};
const DAY_MS = 24 * 60 * 60 * 1000;
const utcDate = (d) => d.toISOString().slice(0, 10);
const ID = /^[a-z0-9-]{1,40}$/;
// A JSON number that's a whole number from 0 to max. 100.0 is one (JSON.parse reads it as 100), as in the SQL.
const whole = (n, max) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
// char_length counts characters (code points), where a JavaScript string's length counts UTF-16 units.
const chars = (s) => [...s].length;
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const time = (iso) => Date.parse(iso);

// state: tests/mock-supabase.mjs's shared state ({ profiles, souRuns, builds, currentUserId, ... })
export function makeWallet(state) {
  const wallets = new Map(); // user_id -> { user_id, balance, earned, spent, updated_at }
  const ledger = new Map(); // "user_id|kind|ref" -> { id, user_id, amount, kind, ref, created_at }
  const badgeAwards = new Map(); // "user_id|badge" -> { user_id, badge, awarded_at }
  const finishedCodes = new Map(); // "user_id|code" -> { user_id, code, created_at }
  let nextId = 1;
  const now = () => new Date().toISOString();

  // wallet_lock: once anything acts on a balance or moves coins, there's a row.
  function lock(uid) {
    if (!wallets.has(uid)) wallets.set(uid, { user_id: uid, balance: 0, earned: 0, spent: 0, updated_at: now() });
    return wallets.get(uid).balance;
  }
  const balanceOf = (uid) => wallets.get(uid)?.balance ?? 0;
  // wallet_apply: records (user, kind, ref) once and moves the wallet; 0 for a repeat or a zero amount.
  function apply(uid, amount, kind, ref) {
    if (!amount) return 0;
    lock(uid);
    const key = `${uid}|${kind}|${ref}`;
    if (ledger.has(key)) return 0;
    const w = wallets.get(uid);
    // wallets' check constraint. A function reaching this forgot to check the balance: a bug, not a refusal.
    if (w.balance + amount < 0) throw new TypeError(`wallets check violated: ${uid} would go to ${w.balance + amount}`);
    ledger.set(key, { id: nextId++, user_id: uid, amount, kind, ref, created_at: now() });
    w.balance += amount;
    if (amount > 0) w.earned += amount;
    else w.spent -= amount;
    w.updated_at = now();
    return amount;
  }
  const hasAccount = (uid) => !!uid && state.profiles.has(uid);
  const player = () => {
    const uid = state.currentUserId();
    if (!hasAccount(uid)) fail("not_signed_in");
    return uid;
  };

  // Only the Edge Function (service role) can call these. Checks in the SQL's order.
  const server = {
    credit_coins({ p_user = null, p_amount = null, p_kind = null, p_ref = null, p_daily_cap = null } = {}) {
      if (!hasAccount(p_user)) fail("no_such_player");
      if (!["season", "daily"].includes(p_kind)) fail("bad_kind");
      if (!whole(p_amount, 10000)) fail("bad_amount");
      if (typeof p_ref !== "string" || chars(p_ref) < 1 || chars(p_ref) > 200) fail("bad_ref");
      lock(p_user);
      if (p_daily_cap != null) {
        const midnight = time(`${utcDate(new Date())}T00:00:00.000Z`);
        const paidToday = [...ledger.values()].filter((e) => e.user_id === p_user && e.kind === p_kind && time(e.created_at) >= midnight).length;
        if (paidToday >= p_daily_cap) return { credited: 0, balance: balanceOf(p_user), capped: true, duplicate: false };
      }
      const credited = apply(p_user, p_amount, p_kind, p_ref);
      return { credited, balance: balanceOf(p_user), capped: false, duplicate: p_amount > 0 && credited === 0 };
    },
    award_badges({ p_user = null, p_badges = null } = {}) {
      if (!hasAccount(p_user)) fail("no_such_player");
      if (!Array.isArray(p_badges) || p_badges.length > 50
        || p_badges.some((b) => !isObject(b) || typeof b.id !== "string" || !ID.test(b.id) || !whole(b.coins, 10000))) fail("bad_request");
      lock(p_user);
      const awarded = [];
      let credited = 0;
      for (const { id, coins } of p_badges) {
        const key = `${p_user}|${id}`;
        if (badgeAwards.has(key)) continue;
        badgeAwards.set(key, { user_id: p_user, badge: id, awarded_at: now() });
        awarded.push(id);
        credited += apply(p_user, coins, "badge", id);
      }
      return { awarded, credited, balance: balanceOf(p_user) };
    },
  };

  const rpcs = {
    // p_date is the game's day in the player's calendar, one of UTC yesterday, today or tomorrow; null means the UTC
    // date, with any row of that game from the last 24 hours as the evidence (migration-wallet.sql).
    claim_minigame({ p_game = null, p_date = null } = {}) {
      const uid = player();
      if (!["over_under", "build"].includes(p_game)) fail("bad_game");
      const today = Date.parse(`${utcDate(new Date())}T00:00:00.000Z`);
      const plausible = [-1, 0, 1].map((d) => utcDate(new Date(today + d * DAY_MS)));
      if (p_date != null && !plausible.includes(p_date)) fail("bad_date");
      const day = p_date ?? utcDate(new Date());
      const since = Date.now() - DAY_MS;
      const played = p_game === "over_under" && p_date != null
        ? [...state.souRuns.values()].some((r) => r.user_id === uid && r.date === p_date)
        : [...(p_game === "over_under" ? state.souRuns.values() : state.builds.values())].some((r) => r.user_id === uid && time(r.created_at) > since);
      if (!played) fail("not_played");
      lock(uid);
      const credited = apply(uid, COIN_RULES.minigame, "minigame", `${p_game}:${day}`);
      return { credited, balance: balanceOf(uid) };
    },
    // Reads only: no lock, so a player without a wallet reads zeros and still has none afterwards.
    wallet_state() {
      const uid = player();
      const w = wallets.get(uid);
      const recent = [...ledger.values()].filter((e) => e.user_id === uid)
        .sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id)
        .slice(0, 20)
        .map(({ amount, kind, ref, created_at }) => ({ amount, kind, ref, created_at }));
      return { balance: w?.balance ?? 0, earned: w?.earned ?? 0, spent: w?.spent ?? 0, recent };
    },
  };

  return {
    tables: { wallets, wallet_ledger: ledger, badge_awards: badgeAwards, finished_codes: finishedCodes },
    rpcs,
    server,
    // create_wallet, the trigger on a new profiles row.
    welcome: (uid) => apply(uid, COIN_RULES.welcome, "welcome", "welcome"),
    balanceOf,
    lock,
    apply,
  };
}
