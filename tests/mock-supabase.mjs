// The in-memory Supabase client the tests run against, in its own module so a browser page can use
// it too (the UI audit harness in tools/ui-harness). Nothing here may import Node-only modules;
// tests/helpers.mjs re-exports makeMockAuth for the test suites.
import * as GL from "../game-logic.mjs";
import { playerStats } from "./mock-profile-stats.mjs";
import { makeProfileData } from "./mock-profile-data.mjs";
import { makeModeration } from "./mock-moderation.mjs";
import { makeWallet } from "./mock-wallet.mjs";
import { makeShop } from "./mock-shop.mjs";
import { seasonReward, badgeRewards, coinsSummary } from "../rewards.mjs";
import { badgeProgress } from "../badges.mjs";
import { mapPlayerStats } from "../profile-rules.mjs";

// In-memory mock of the Supabase client surface storage.js actually calls: auth (signUp,
// signInWithPassword, signOut, getSession, onAuthStateChange) and .from("profiles"/"daily_runs")
// with the specific chains storage.js uses (.select().eq().single(), .select().not().order()
// .limit(), .update().eq(), .insert()). Not a general Postgres emulator - just enough surface
// for these exact call shapes. Install as window.__ps_supabase__ so storage.js's getClient()
// picks it up instead of a real network client.
export function makeMockAuth() {
  const authUsers = new Map(); // email -> {id, email, password}
  const profiles = new Map(); // id -> row (snake_case, matches the real schema)
  const dailyRuns = new Map(); // "date:userId" -> row
  const souRuns = new Map(); // "date:userId" -> row
  const builds = new Map(); // id -> row - no natural key (unlike daily/sou), so a generated uuid like the real table
  const runs = new Map(); // "user_id|created_at|dnf" -> row, mirroring runs' unique key (see migration-runs-log.sql)
  let session = null;
  const listeners = [];
  const notify = (event) => listeners.forEach((cb) => cb(event, session));

  // The v1.11.0 profile modules (PROFILES.md) each own their tables and database functions, in their
  // own files, sharing these tables and the signed-in user.
  const state = { profiles, runs, dailyRuns, souRuns, builds, currentUserId: () => session?.user?.id ?? null, isModerator: () => false, ownsAvatarPack: () => false };
  const profileData = makeProfileData(state, { playerStats });
  const moderation = makeModeration(state, profileData);
  state.isModerator = moderation.isModerator;
  // v1.12.0's coins and shop (SHOP.md), the same way.
  const wallet = makeWallet(state);
  const shop = makeShop(state, { wallet, profileData });
  state.ownsAvatarPack = shop.ownsAvatarPack;
  const extraTables = { ...profileData.tables, ...moderation.tables, ...wallet.tables, ...shop.tables };
  // These have no client write policy at all - the app changes them only through database functions -
  // so a direct write gets the error RLS would give.
  const rlsDenied = () => Promise.resolve({ error: { code: "42501", message: "new row violates row-level security policy" } });
  // Reads, the same way: reports and moderators have RLS on and no select policy, so a client sees no rows;
  // blocked_words and the coin tables have their table grants revoked too, so a client's read is refused outright.
  const HIDDEN_ROWS = new Set(["reports", "moderators"]);
  const REFUSED_READS = new Set(["blocked_words", "wallets", "wallet_ledger", "badge_awards", "finished_codes", "inventory"]);
  function refusedRead(table) {
    const result = { data: null, error: { code: "42501", message: `permission denied for table ${table}` } };
    const query = {
      eq: () => query, not: () => query, gt: () => query, lte: () => query, order: () => query, limit: () => query,
      single: () => Promise.resolve(result),
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return query;
  }

  function from(table) {
    const store = table === "profiles" ? profiles : table === "sou_runs" ? souRuns : table === "builds" ? builds : table === "runs" ? runs : extraTables[table] || dailyRuns;
    if (extraTables[table]) {
      const base = fromStore(HIDDEN_ROWS.has(table) ? new Map() : store);
      const select = REFUSED_READS.has(table) ? () => refusedRead(table) : base.select;
      return { ...base, select, insert: rlsDenied, upsert: rlsDenied, update: () => ({ eq: rlsDenied }), delete: () => ({ eq: rlsDenied }) };
    }
    return fromStore(store);
  }

  function fromStore(store) {
    const table = store === profiles ? "profiles" : store === souRuns ? "sou_runs" : store === builds ? "builds" : store === runs ? "runs" : store === dailyRuns ? "daily_runs" : "other";
    return {
      select(_cols, opts) {
        const state = { filters: [], order: null, limit: null };
        const run = () => {
          let out = [...store.values()].filter((r) => state.filters.every((f) => f(r)));
          if (state.order) out = out.sort((a, b) => (state.order.asc ? a[state.order.col] - b[state.order.col] : b[state.order.col] - a[state.order.col]));
          if (state.limit != null) out = out.slice(0, state.limit);
          return out;
        };
        const builder = {
          eq(col, val) { state.filters.push((r) => r[col] === val); return builder; },
          // Real Postgres has no "undefined" - an unset column reads as NULL, so `is null`/
          // `is not null` must treat a column that was simply never set the same as one
          // explicitly set to null (e.g. a fresh signup's row has no best_score key at all).
          not(col, _op, val) { state.filters.push((r) => (r[col] ?? null) !== val); return builder; },
          // An unset column is 0 for the numeric points ladders, matching their `not null default 0`.
          gt(col, val) { state.filters.push((r) => (r[col] ?? 0) > val); return builder; },
          // NULL never satisfies a comparison in Postgres, so an unset column is excluded here.
          lte(col, val) { state.filters.push((r) => r[col] != null && r[col] <= val); return builder; },
          order(col, opts) { state.order = { col, asc: opts?.ascending !== false }; return builder; },
          limit(n) { state.limit = n; return builder; },
          single() {
            const rows = run();
            return Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } });
          },
          // `{ count: "exact", head: true }` (fetchBuildCount, fetchOwnRank) returns just the count
          // of rows matching the filters, which may be chained on before it's awaited.
          then(resolve, reject) {
            const result = opts?.count ? { count: run().length, error: null } : { data: run(), error: null };
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      },
      update(patch) {
        return {
          eq(col, val) {
            for (const row of store.values()) if (row[col] === val) Object.assign(row, patch);
            return Promise.resolve({ error: null });
          },
        };
      },
      insert(row) {
        if (table === "profiles") {
          if ([...profiles.values()].some((r) => r.username === row.username)) {
            return Promise.resolve({ error: { code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"' } });
          }
          profiles.set(row.id, { runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [], daily_streak: 0, daily_best_streak: 0, ...row });
          wallet.welcome(row.id); // migration-wallet.sql's create_wallet trigger
        } else if (table === "builds") {
          // migration-profiles.sql's builds triggers: a real position and a finite overall, or bad_build; and
          // the account's own username, whatever the browser sent.
          const overall = Number(row.overall);
          if (!["QB", "RB", "WR", "TE"].includes(row.pos) || !(Math.abs(overall) < 1e12)) {
            return Promise.resolve({ error: { code: "P0001", message: "bad_build" } });
          }
          const id = globalThis.crypto.randomUUID();
          builds.set(id, { id, created_at: new Date().toISOString(), ...row, username: profiles.get(row.user_id)?.username ?? row.username });
        } else {
          // daily_runs is keyed per format (its real primary key is (date, format, user_id));
          // sou_runs has no format and stays (date, user_id).
          const key = table === "daily_runs"
            ? `${row.date}:${row.format || "fantasy"}:${row.user_id}`
            : `${row.date}:${row.user_id}`;
          // Both tables default created_at to now(), which player_stats' tiebreaks read. sou_runs takes the
          // account's own username, as its trigger does.
          const username = table === "sou_runs" ? profiles.get(row.user_id)?.username ?? row.username : row.username;
          store.set(key, { created_at: new Date().toISOString(), ...row, ...(username !== undefined ? { username } : {}) });
        }
        return Promise.resolve({ error: null });
      },
    };
  }

  // Minimal Realtime fake for subscribeSiteActivity - presence enough to verify the UI reads *a*
  // count once tracked (not a real multi-client simulation, see storage.js's own comment), plus
  // broadcast: send() fires this same channel's own registered handlers (this mock models one
  // shared channel instance, so send() both matches "the tab that finished also gets notified"
  // and lets a test simulate another tab's broadcast by calling send() directly via _channels).
  const channels = new Map(); // name -> channel, test-only escape hatch (mirrors _profiles)
  function channel(name) {
    const presenceListeners = [];
    const broadcastListeners = {};
    const presence = {};
    const chan = {
      on(type, opts, cb) {
        if (type === "broadcast") (broadcastListeners[opts?.event] ||= []).push(cb);
        else presenceListeners.push(cb);
        return chan;
      },
      subscribe(cb) { if (cb) cb("SUBSCRIBED"); return chan; },
      async track(meta) {
        presence["mock-self"] = [meta || {}];
        presenceListeners.forEach((cb) => cb());
      },
      presenceState() { return presence; },
      send({ event, payload }) {
        (broadcastListeners[event] || []).forEach((cb) => cb({ event, payload }));
        return Promise.resolve("ok");
      },
    };
    channels.set(name, chan);
    return chan;
  }

  // Mirrors supabase/functions/submit-run/index.ts against this same mock's in-memory
  // profiles/dailyRuns - so every test that finishes a real draft or records a DNF exercises the
  // actual server-side verification logic (game-logic.mjs's replayDraft/simulateSeason/applyRun/
  // applyDnf/nextStreak), not a bypassed shortcut. Auth is `session.user.id` (this mock's stand-in
  // for the real function's JWT verification) instead of a forwarded Authorization header.
  // Mirrors submit-run/index.ts's isPlausibleDailyDate - a tolerant window (UTC yesterday/today/
  // tomorrow), not an exact match with the mock's own clock, since a real player's local calendar
  // date can legitimately differ from the server's UTC one for hours around midnight.
  function utcDateKeyMock(d) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  function isPlausibleDailyDateMock(date) {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    return [-1, 0, 1].some((offset) => utcDateKeyMock(new Date(now + offset * DAY)) === date);
  }
  function mockRowToProfile(row) {
    return {
      runs: row?.runs || 0, dnf: row?.dnf || 0, wins: row?.wins || 0, losses: row?.losses || 0,
      champs: row?.champs || 0, perfect: row?.perfect || 0, playoffs: row?.playoffs || 0,
      bestScore: row?.best_score ?? null, bestRun: row?.best_run ?? null, bestRecord: row?.best_record ?? null,
      bestScoreStd: row?.best_score_std ?? null, bestRunStd: row?.best_run_std ?? null,
      points: {
        daily: row?.points_daily || 0, unlimited: row?.points_unlimited || 0,
        genius: row?.points_genius || 0, gm: row?.points_gm || 0,
      },
      pointsBank: row?.points_bank || 0, pointsDay: row?.points_day ?? null,
      recent: row?.recent || [], dailyStreak: row?.daily_streak || 0, dailyLast: row?.daily_last ?? null,
      dailyBestStreak: row?.daily_best_streak || 0,
    };
  }
  function mockProfileToRow(s) {
    return {
      runs: s.runs, dnf: s.dnf, wins: s.wins, losses: s.losses,
      champs: s.champs, perfect: s.perfect, playoffs: s.playoffs,
      best_score: s.bestScore, best_run: s.bestRun, best_record: s.bestRecord, recent: s.recent || [],
      best_score_std: s.bestScoreStd, best_run_std: s.bestRunStd,
      points_daily: s.points?.daily || 0, points_unlimited: s.points?.unlimited || 0,
      points_genius: s.points?.genius || 0, points_gm: s.points?.gm || 0,
      points_bank: s.pointsBank || 0, points_day: s.pointsDay ?? null,
      daily_streak: s.dailyStreak, daily_last: s.dailyLast, daily_best_streak: s.dailyBestStreak,
    };
  }
  // A refusal the real function answers with an HTTP error status: supabase-js hands back a FunctionsHttpError
  // whose context is the Response, and storage.js's submitRun reads the reason from its body.
  const refused = (status, body) => ({
    data: null,
    error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status, json: async () => body } },
  });
  // Test-only: the tables whose writes inside submit-run fail the way a database error would (not a unique
  // violation), to reach index.ts's failure branches - e.g. auth._failWrites.add("profiles").
  const failWrites = new Set();
  const writeError = (table) => (failWrites.has(table) ? { code: "08006", message: `could not write ${table}` } : null);
  const UNIQUE_VIOLATION = "23505";
  const uniqueViolation = (constraint) => ({ code: UNIQUE_VIOLATION, message: `duplicate key value violates unique constraint "${constraint}"` });
  // A database function called the way supabase-js calls one: { data, error }, never a throw. The mock's
  // functions throw their refusal codes, as the other mock modules do.
  const callFunction = (fn, args) => {
    try {
      return { data: fn(args), error: null };
    } catch (e) {
      return { data: null, error: { code: "P0001", message: String(e?.message || e) } };
    }
  };
  async function invokeSubmitRun(body) {
    if (!session?.user) return { error: { message: "unauthorized" } };
    const userId = session.user.id;

    if (body?.dnf) {
      const row = profiles.get(userId);
      if (!row) return { error: { message: "no profile for this account" } };
      const updatedDnf = GL.applyDnf(mockRowToProfile(row), Number(body.picks) || 0, body.mode);
      Object.assign(row, mockProfileToRow(updatedDnf));
      logRun(GL.runLogRow(userId, row.username, updatedDnf.recent[0]));
      return { data: { ok: true } };
    }

    const { mode, history, seq, gm: rawGm, genius: rawGenius, format: rawFormat } = body || {};
    // A Daily is never GM or Genius, so those flags are ignored there - mirroring index.ts.
    const gm = mode?.kind === "daily" ? false : !!rawGm;
    const genius = mode?.kind === "daily" ? false : !!rawGenius;
    if (!mode || !Array.isArray(history) || !Array.isArray(seq)) return { data: { error: "malformed submission" } };

    // Top-level only, allow-listed, missing means fantasy - mirrors index.ts exactly.
    if (rawFormat != null && !GL.FORMATS.includes(rawFormat)) return { data: { error: "unknown scoring format" } };
    const format = GL.normFormat(rawFormat);

    let seed;
    if (mode.kind === "daily") {
      if (typeof mode.date !== "string" || !isPlausibleDailyDateMock(mode.date)) {
        return { data: { error: "a daily submission must be for today" } };
      }
      seed = GL.dailySeed(mode.date, format);
    } else if (mode.kind === "free") {
      // Over 32 characters is refused like a missing code, as index.ts does: finished_codes can't hold it.
      if (typeof mode.code !== "string" || !mode.code || mode.code.length > 32) return { data: { error: "missing challenge code" } };
      seed = mode.code;
    } else {
      return { data: { error: "unknown mode" } };
    }

    const replay = GL.replayDraft(seed, history, seq);
    if (!replay.ok) return { data: { error: "illegal roster", reason: replay.reason } };
    const roster = replay.roster;

    let tot = 0, wt = 0;
    for (const s of GL.SLOTS) { const k = s === "QB" ? GL.QB_WEIGHT : 1; tot += GL.effectiveRating(s, roster[s], format) * k; wt += k; }
    const score = Math.round((tot / wt) * 10) / 10;
    const lineup = GL.SLOTS.map((s) => `${roster[s].id}${roster[s].season}`).join("|");
    const sim = GL.withSeed(`${seed}#${lineup}`, () => GL.simulateSeason(score));

    // Recomputed from the verified roster, mirroring submit-run/index.ts - never trusted from
    // the client, since capUsed feeds a competitive Stats-screen leaderboard.
    const finalCapUsed = gm ? GL.SLOTS.reduce((sum, s) => sum + GL.playerSalary(roster[s], format), 0) : undefined;
    // A GM season over the cap is an illegal roster, refused before anything is written - mirroring index.ts.
    if (gm && finalCapUsed > GL.GM_CAP) return { data: { error: "illegal roster", reason: "over the salary cap" } };
    // Recomputed from the verified boards, mirroring index.ts - par and points are never taken
    // from the client.
    const par = GL.botPar(history.map((h) => h.key), { format, gm: !!gm });
    const points = GL.draftPoints(score, par);
    const run = {
      w: sim.w, l: sim.l, score, outcome: sim.outcome, champ: sim.champ, perfect: sim.perfect, playoffs: sim.playoffs,
      date: Date.now(),
      roster: GL.SLOTS.map((s) => ({ slot: s, name: roster[s].name, team: roster[s].team, season: roster[s].season, ppr: roster[s].ppr, rating: GL.effectiveRating(s, roster[s], format) })),
      mode: mode.kind, code: mode.kind === "free" ? mode.code : undefined,
      gm: !!gm, genius: !!genius, capUsed: finalCapUsed, format,
      par: par ?? undefined, points,
    };

    const existingRow = profiles.get(userId);
    if (!existingRow) return { data: { error: "no profile for this account" } };

    // The duplicate guard, before anything is written (SHOP.md 4.2). A Daily is keyed by format too, mirroring the
    // real (date, format, user_id) primary key - this mock has no real constraint, so without it the standard daily
    // would silently overwrite the fantasy one. A challenge code goes through finished_codes' (user_id, code) key.
    // Only a unique violation is "already recorded"; any other failure is a failed save.
    const codeKey = `${userId}|${mode.code}`;
    if (mode.kind === "daily") {
      const dailyKey = `${mode.date}:${format}:${userId}`;
      const dailyInsertError = writeError("daily_runs") || (dailyRuns.has(dailyKey) ? uniqueViolation("daily_runs_pkey") : null);
      if (dailyInsertError?.code === UNIQUE_VIOLATION) return refused(409, { error: "today's daily is already recorded", reason: "duplicate" });
      if (dailyInsertError) return refused(500, { error: "failed to save" });
      dailyRuns.set(dailyKey, { date: mode.date, format, user_id: userId, username: existingRow.username, w: run.w, l: run.l, score, outcome: run.outcome, created_at: new Date().toISOString() });
    } else {
      const codeInsertError = writeError("finished_codes") || (wallet.tables.finished_codes.has(codeKey) ? uniqueViolation("finished_codes_pkey") : null);
      if (codeInsertError?.code === UNIQUE_VIOLATION) return refused(409, { error: "this draft is already recorded", reason: "duplicate" });
      if (codeInsertError) return refused(500, { error: "failed to save" });
      wallet.tables.finished_codes.set(codeKey, { user_id: userId, code: mode.code, created_at: new Date().toISOString() });
    }

    const existing = mockRowToProfile(existingRow);
    let updated = GL.applyRun(existing, run, utcDateKeyMock(new Date()));
    if (mode.kind === "daily") {
      const streak = GL.nextStreak(existing, mode.date);
      updated = { ...updated, dailyLast: mode.date, dailyStreak: streak, dailyBestStreak: Math.max(streak, existing.dailyBestStreak || 0) };
    }

    if (writeError("profiles")) {
      // The season didn't count, so what the duplicate guard took - the code, or this Daily's daily_runs row - is
      // given back and a retry can count it.
      if (mode.kind === "daily") dailyRuns.delete(`${mode.date}:${format}:${userId}`);
      else wallet.tables.finished_codes.delete(codeKey);
      return refused(500, { error: "failed to save" });
    }
    Object.assign(existingRow, mockProfileToRow(updated));
    logRun(GL.runLogRow(userId, existingRow.username, run, mode.kind === "daily" ? mode.date : null));

    // The season's coins, then the coins for any badge the player now has. The season already counted, so any
    // failure answers coins: null. Each call's error is thrown to reach the catch, as index.ts does with
    // supabase-js's { data, error }.
    let coins = null;
    let newBadges = [];
    try {
      const reward = seasonReward(run, { date: mode.date, streak: updated.dailyStreak });
      const credit = callFunction(wallet.server.credit_coins, { p_user: userId, p_amount: reward.amount, p_kind: reward.kind, p_ref: reward.ref, p_daily_cap: reward.dailyCap });
      if (credit.error) throw new Error(`credit_coins: ${credit.error.message}`);

      // player_stats reads the runs log, which logRun above has just added this season to.
      const stats = callFunction(rpcs.player_stats, { p_user_id: userId });
      if (stats.error) throw new Error(`player_stats: ${stats.error.message}`);
      const favoriteTeam = profileData.tables.profile_details.get(userId)?.favorite_team ?? null;
      const progress = badgeProgress({ stats: updated, extra: mapPlayerStats(stats.data), details: { favoriteTeam }, joined: existingRow.created_at });
      const awards = callFunction(wallet.server.award_badges, { p_user: userId, p_badges: badgeRewards(progress) });
      if (awards.error) throw new Error(`award_badges: ${awards.error.message}`);

      coins = coinsSummary({ ...credit.data, lines: reward.lines }, awards.data);
      newBadges = Array.isArray(awards.data?.awarded) ? awards.data.awarded : [];
    } catch (e) {
      coins = null;
      newBadges = [];
    }
    return { data: { ok: true, run, coins, newBadges } };
  }

  // Mirrors index.ts's logRun: after the profile write, and a duplicate of the unique key is a no-op.
  function logRun(row) {
    const key = `${row.user_id}|${row.created_at}|${row.dnf}`;
    if (!runs.has(key)) runs.set(key, { backfilled: false, ...row });
  }

  // Mirrors migration-runs-log.sql's site_totals()/site_stats() over this mock's profiles and runs.
  // tests/test-runs-sql.mjs runs the real SQL in PGlite against the same fixture and requires the
  // two to return identical JSON, so this can't quietly drift from what the database does.
  const byName = (a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0);
  const card = (p) => Object.fromEntries(
    ["id", "username", "runs", "dnf", "wins", "losses", "champs", "perfect", "playoffs", "daily_best_streak"].map((k) => [k, p[k] ?? null]));
  function siteTotals() {
    const rows = [...profiles.values()];
    return {
      players: rows.length,
      runs: rows.reduce((t, r) => t + (r.runs || 0) + (r.dnf || 0), 0),
      perfect: rows.reduce((t, r) => t + (r.perfect || 0), 0),
    };
  }
  function siteStats({ p_limit: limit = 10 } = {}) {
    const all = [...profiles.values()];
    const played = all.filter((p) => (p.runs || 0) + (p.dnf || 0) > 0);
    const logged = [...runs.values()].filter((r) => !r.dnf);
    const entries = logged.flatMap((r) => (Array.isArray(r.roster) ? r.roster : []).map((entry) => ({ username: r.username, format: r.format, entry })));
    const top = (rows, val, keep = () => true) => rows.filter(keep).sort((a, b) => val(b) - val(a) || byName(a, b)).slice(0, limit);

    const by_format = {};
    for (const f of ["fantasy", "standard"]) {
      const col = f === "standard" ? "best_score_std" : "best_score";
      by_format[f] = {
        best_lineups: all.filter((p) => p[col] != null).sort((a, b) => b[col] - a[col] || byName(a, b)).slice(0, 15)
          .map((p) => ({ ...card(p), best_score: p.best_score ?? null, best_run: p.best_run ?? null, best_score_std: p.best_score_std ?? null, best_run_std: p.best_run_std ?? null })),
        best_gm: logged.filter((r) => r.gm && r.format === f && r.score != null)
          .sort((a, b) => b.score - a.score || (a.created_at < b.created_at ? -1 : 1)).slice(0, limit)
          .map((r) => ({ username: r.username, score: r.score, w: r.w, l: r.l })),
        biggest_upsets: logged.filter((r) => r.champ && r.format === f && r.score != null)
          .sort((a, b) => a.score - b.score || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)).slice(0, limit)
          .map((r) => ({ username: r.username, score: r.score, w: r.w, l: r.l, perfect: !!r.perfect, ladder: r.ladder, roster: r.roster ?? null })),
      };
    }

    const counts = new Map();
    for (const { entry } of entries) {
      const key = JSON.stringify([entry.name, Number(entry.season), entry.team]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const most_drafted = [...counts.entries()]
      .map(([key, count]) => { const [name, season, team] = JSON.parse(key); return { name, season, team, count }; })
      .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.season - b.season
        || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0)).slice(0, 15);

    const wins = played.reduce((t, p) => t + p.wins, 0), games = played.reduce((t, p) => t + p.wins + p.losses, 0);
    return {
      totals: siteTotals(),
      by_format,
      most_drafted,
      most_wins: top(played, (p) => p.wins).map(card),
      most_champs: top(played, (p) => p.champs, (p) => p.champs > 0).map(card),
      most_playoffs: top(played, (p) => p.playoffs, (p) => p.playoffs > 0).map(card),
      longest_streaks: top(all, (p) => p.daily_best_streak || 0, (p) => (p.daily_best_streak || 0) > 0).map(card),
      best_win_pct: played.filter((p) => p.wins + p.losses >= 3).map((p) => ({ p, pct: p.wins / (p.wins + p.losses) }))
        .sort((a, b) => b.pct - a.pct || byName(a.p, b.p)).slice(0, limit).map(({ p, pct }) => ({ ...card(p), pct })),
      avg_win_pct: games > 0 ? Math.round((100 * wins) / games) : 0,
    };
  }
  const rpcs = {
    site_totals: siteTotals, site_stats: siteStats,
    player_stats: ({ p_user_id } = {}) => playerStats(state, p_user_id),
    ...profileData.rpcs, ...moderation.rpcs, ...wallet.rpcs, ...shop.rpcs,
  };

  return {
    from,
    channel,
    functions: { invoke: (name, opts) => (name === "submit-run" ? invokeSubmitRun(opts?.body) : Promise.resolve({ error: { message: "unknown function" } })) },
    removeChannel() {},
    rpc: (name, args) => {
      if (!rpcs[name]) return Promise.resolve({ data: null, error: { message: `unknown function ${name}` } });
      try {
        return Promise.resolve({ data: rpcs[name](args), error: null });
      } catch (e) {
        // A database function refusing something raises its own code (PROFILES.md) - returned the way
        // PostgREST returns it. Anything else is a bug in the mock, so it isn't swallowed.
        if (/^[a-z_]+$/.test(e?.message || "")) return Promise.resolve({ data: null, error: { message: e.message, code: "P0001" } });
        return Promise.reject(e);
      }
    },
    storage: profileData.storage,
    _profileDetails: profileData.tables.profile_details, // test-only escape hatches for the profile modules
    _avatarPresets: profileData.tables.avatar_presets,
    _blockedWords: profileData.tables.blocked_words,
    _siteFlags: profileData.tables.site_flags,
    _storageObjects: profileData.objects,
    _reports: moderation.tables.reports,
    _moderators: moderation.tables.moderators,
    _wallets: wallet.tables.wallets, // test-only escape hatches for coins and the shop
    _ledger: wallet.tables.wallet_ledger,
    _badgeAwards: wallet.tables.badge_awards,
    _finishedCodes: wallet.tables.finished_codes,
    _shopItems: shop.tables.shop_items,
    _inventory: shop.tables.inventory,
    _wallet: wallet, // its server functions (credit_coins, award_badges) and helpers, for setting up a test
    _failWrites: failWrites, // test-only: tables whose writes inside submit-run fail (see invokeSubmitRun)
    _profiles: profiles, // test-only escape hatch for setup/assertions
    _runs: runs, // test-only escape hatch for setup/assertions
    _builds: builds, // test-only escape hatch for setup/assertions
    _dailyRuns: dailyRuns, // test-only escape hatch for setup/assertions
    _souRuns: souRuns, // test-only escape hatch for setup/assertions
    _channels: channels, // test-only escape hatch, e.g. auth._channels.get("site-activity").send({event:"draft_finished", payload:{}})
    auth: {
      async signUp({ email, password, options }) {
        if (authUsers.has(email)) return { data: null, error: { message: "User already registered" } };
        const username = options?.data?.username;
        // The signup trigger (migration-profiles.sql's handle_new_user) refuses a username outside the
        // username rule - check_username's "invalid" is the same rule - a reserved name another account holds
        // in any capitalization, or one with a blocked word, before the profile row is written, which reaches
        // the client as Supabase Auth's generic database error.
        if (profileData.rpcs.check_username({ p_username: username }) === "invalid" || profileData.isReservedUsername(username) || !profileData.isClean(username)) {
          return { data: null, error: { status: 500, message: "Database error saving new user" } };
        }
        if ([...profiles.values()].some((r) => r.username === username)) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"' } };
        }
        const id = `user-${authUsers.size + 1}`;
        authUsers.set(email, { id, email, password });
        profiles.set(id, { id, username, runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [], daily_streak: 0, daily_best_streak: 0, created_at: new Date().toISOString() });
        wallet.welcome(id); // migration-wallet.sql's create_wallet trigger
        session = { user: { id, email } };
        notify("SIGNED_IN");
        return { data: { user: { id, email } }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const u = authUsers.get(email);
        if (!u || u.password !== password) return { data: null, error: { message: "Invalid login credentials" } };
        session = { user: { id: u.id, email } };
        notify("SIGNED_IN");
        return { data: { user: { id: u.id, email } }, error: null };
      },
      async signOut() {
        session = null;
        notify("SIGNED_OUT");
        return { error: null };
      },
      async getSession() {
        return { data: { session } };
      },
      onAuthStateChange(cb) {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } } } };
      },
    },
  };
}
