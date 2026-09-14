// Shared jsdom bootstrap for driving the real PerfectSeason component headlessly.
// perfect-season.jsx is bundled fresh (react/react-dom left external so tests and the
// component share one React instance) rather than transpiled ad hoc, so esbuild catches
// the same syntax errors `npm run check` would.
import { JSDOM } from "jsdom";
import { webcrypto } from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import * as GL from "../game-logic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(__dirname, "..");

// This is a SEPARATE instance of game-logic.mjs from the one esbuild inlines into the bundled
// component below (bundling copies the module in, it doesn't share it) - deterministic given the
// same data/players.json in, so both independently reach identical BOARDS/OPPS, same as the real
// client bundle and the real submit-run Edge Function are two separate processes in production.
const gameData = JSON.parse(readFileSync(path.join(root, "data", "players.json"), "utf8"));
GL.initGameData(gameData.players, gameData.opponents);

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

  function from(table) {
    const store = table === "profiles" ? profiles : table === "sou_runs" ? souRuns : table === "builds" ? builds : dailyRuns;
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
        } else if (table === "builds") {
          const id = webcrypto.randomUUID();
          builds.set(id, { id, created_at: new Date().toISOString(), ...row });
        } else {
          // daily_runs is keyed per format (its real primary key is (date, format, user_id));
          // sou_runs has no format and stays (date, user_id).
          const key = table === "daily_runs"
            ? `${row.date}:${row.format || "fantasy"}:${row.user_id}`
            : `${row.date}:${row.user_id}`;
          store.set(key, row);
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

    const { mode, history, seq, gm, genius, format: rawFormat } = body || {};
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
      if (typeof mode.code !== "string" || !mode.code) return { data: { error: "missing challenge code" } };
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

    // Keyed by format too, mirroring the real (date, format, user_id) primary key - this mock has
    // no real constraint, so without it the standard daily would silently overwrite the fantasy one.
    if (mode.kind === "daily") {
      const dailyKey = `${mode.date}:${format}:${userId}`;
      if (dailyRuns.has(dailyKey)) return { data: { error: "today's daily is already recorded" } };
      dailyRuns.set(dailyKey, { date: mode.date, format, user_id: userId, username: existingRow.username, w: run.w, l: run.l, score, outcome: run.outcome });
    }

    const existing = mockRowToProfile(existingRow);
    let updated = GL.applyRun(existing, run, utcDateKeyMock(new Date()));
    if (mode.kind === "daily") {
      const streak = GL.nextStreak(existing, mode.date);
      updated = { ...updated, dailyLast: mode.date, dailyStreak: streak, dailyBestStreak: Math.max(streak, existing.dailyBestStreak || 0) };
    }
    Object.assign(existingRow, mockProfileToRow(updated));
    logRun(GL.runLogRow(userId, existingRow.username, run, mode.kind === "daily" ? mode.date : null));

    return { data: { ok: true, run } };
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
      const pos = {};
      for (const e of entries.filter((x) => x.format === f)) {
        const bucket = String(e.entry.slot).startsWith("FLEX") ? "FLEX" : e.entry.slot;
        const cur = pos[bucket];
        const r = e.entry.rating ?? -Infinity, cr = cur?.rating ?? -Infinity;
        if (!cur || r > cr || (r === cr && e.username < cur.username)) pos[bucket] = { ...e.entry, username: e.username };
      }
      by_format[f] = {
        best_lineups: all.filter((p) => p[col] != null).sort((a, b) => b[col] - a[col] || byName(a, b)).slice(0, 15)
          .map((p) => ({ ...card(p), best_score: p.best_score ?? null, best_run: p.best_run ?? null, best_score_std: p.best_score_std ?? null, best_run_std: p.best_run_std ?? null })),
        best_gm: logged.filter((r) => r.gm && r.format === f && r.score != null)
          .sort((a, b) => b.score - a.score || (a.created_at < b.created_at ? -1 : 1)).slice(0, limit)
          .map((r) => ({ username: r.username, score: r.score, w: r.w, l: r.l })),
        pos_records: pos,
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
  const rpcs = { site_totals: siteTotals, site_stats: siteStats };

  return {
    from,
    channel,
    functions: { invoke: (name, opts) => (name === "submit-run" ? invokeSubmitRun(opts?.body) : Promise.resolve({ error: { message: "unknown function" } })) },
    removeChannel() {},
    rpc: (name, args) => Promise.resolve(rpcs[name] ? { data: rpcs[name](args), error: null } : { data: null, error: { message: `unknown function ${name}` } }),
    _profiles: profiles, // test-only escape hatch for setup/assertions
    _runs: runs, // test-only escape hatch for setup/assertions
    _builds: builds, // test-only escape hatch for setup/assertions
    _dailyRuns: dailyRuns, // test-only escape hatch for setup/assertions
    _channels: channels, // test-only escape hatch, e.g. auth._channels.get("site-activity").send({event:"draft_finished", payload:{}})
    auth: {
      async signUp({ email, password, options }) {
        if (authUsers.has(email)) return { data: null, error: { message: "User already registered" } };
        const username = options?.data?.username;
        if ([...profiles.values()].some((r) => r.username === username)) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"' } };
        }
        const id = `user-${authUsers.size + 1}`;
        authUsers.set(email, { id, email, password });
        profiles.set(id, { id, username, runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [], daily_streak: 0, daily_best_streak: 0 });
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

export function setupDom(url = "http://localhost/") {
  // Tear down the previous jsdom before replacing it. Most suites call this once, but a bot that
  // plays hundreds of drafts in one process (test-difficulty.mjs) otherwise keeps every window
  // it ever built alive through these globals and exhausts the heap partway through a long run.
  if (global.window && typeof global.window.close === "function") global.window.close();
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url });
  const { window } = dom;
  global.window = window;
  global.document = window.document;
  Object.defineProperty(global, "navigator", { value: window.navigator, configurable: true });
  global.HTMLElement = window.HTMLElement;
  global.MouseEvent = window.MouseEvent;
  global.Node = window.Node;
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.cancelAnimationFrame = (id) => clearTimeout(id);
  window.crypto.subtle = webcrypto.subtle;
  Object.defineProperty(global, "localStorage", { value: window.localStorage, configurable: true });
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom's Document doesn't expose oninput, so React's isEventSupported('input') check comes
  // back false and it falls back to its legacy IE input-event polyfill, which calls the
  // long-gone attachEvent/detachEvent and throws. Stubbing the property short-circuits that.
  if (!("oninput" in window.document)) window.document.oninput = null;
  // Board spins run a real setInterval animation unless prefers-reduced-motion matches;
  // tests want the resolved board immediately, not 900ms of reel ticks.
  window.matchMedia = (query) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent() { return true; },
  });
  return dom;
}

// In-memory stand-in for the artifact host's window.storage: get/set/delete/list keyed by
// a "shared" namespace (leaderboard/account rows, visible to everyone) vs "personal" (this
// device only). Mirrors entry.jsx's shim but plain-object backed instead of localStorage,
// so each test's storage.data can be reset or preloaded directly.
// delayKeys: optional list of substrings - a delete() whose key matches always resolves after
// a real delay, and a set() whose key matches AND whose value looks like clearDraft's
// "cleared" marker also delays (ordinary progress-saving writes to the same key are left
// fast). This isolates "the clear operation is slow" from "every write to this key is slow" -
// a caller that fires a slow clear (finish()'s fire-and-forget clearDraft) and a concurrent
// fast read from elsewhere (refreshWip()) can then be made to interleave deterministically:
// the read lands before the slow clear does, reproducing a real remote-storage's lack of
// read-after-write ordering.
export function makeStorage(delayKeys = [], delayMs = 30) {
  const data = {};
  const nsKey = (shared, key) => `${shared ? "shared" : "personal"}:${key}`;
  const storage = {
    data,
    async get(key, shared) {
      const k = nsKey(shared, key);
      return Object.prototype.hasOwnProperty.call(data, k) ? { value: data[k] } : null;
    },
    async set(key, value, shared) {
      if (delayKeys.some((k) => key.includes(k)) && value.includes('"cleared":true')) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      data[nsKey(shared, key)] = value;
      return true;
    },
    async delete(key, shared) {
      if (delayKeys.some((k) => key.includes(k))) await new Promise((r) => setTimeout(r, delayMs));
      delete data[nsKey(shared, key)];
    },
    async list(prefix, shared) {
      const nsPrefix = nsKey(shared, prefix);
      const keys = Object.keys(data)
        .filter((k) => k.startsWith(nsPrefix))
        .map((k) => k.slice(shared ? "shared:".length : "personal:".length));
      return { keys };
    },
  };
  return storage;
}

// react-dom must never be imported (even transitively) before setupDom() has installed the
// jsdom globals: react-dom's ChangeEventPlugin decides at MODULE LOAD TIME whether the
// environment supports native input events, based on whatever `window`/`document` are at that
// instant. Importing it early latches that decision to "no" and permanently routes text input
// through react-dom's long-dead IE input-event polyfill (attachEvent/detachEvent), which throws.
let cachedAct = null;
async function getAct() {
  if (!cachedAct) cachedAct = (await import("react-dom/test-utils")).act;
  return cachedAct;
}

let cachedComponentPath = null;
export async function loadPerfectSeason() {
  if (!cachedComponentPath) {
    const outfile = path.join(root, "build", "test-component.mjs");
    await esbuild.build({
      entryPoints: [path.join(root, "perfect-season.jsx")],
      bundle: true,
      format: "esm",
      jsx: "automatic",
      platform: "browser",
      external: ["react", "react-dom", "react-dom/client"],
      // Mirrors build.mjs: these are bare identifiers textually replaced at build time, so they
      // have to be defined here too or the component throws a ReferenceError on render.
      define: {
        APP_VERSION: JSON.stringify("test"),
        APP_ENV: JSON.stringify("production"),
      },
      outfile,
    });
    cachedComponentPath = outfile;
  }
  const mod = await import(pathToFileURL(cachedComponentPath).href + `?t=${Date.now()}`);
  return mod.default;
}

// Mounts a fresh PerfectSeason instance. Call setupDom() first.
export async function mount() {
  const act = await getAct();
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const PerfectSeason = await loadPerfectSeason();
  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  await act(async () => {
    reactRoot.render(React.createElement(PerfectSeason));
  });
  return { container, reactRoot };
}

// Auth now runs through the mock Supabase client (no client-side PBKDF2 delay to wait out),
// but call sites still call this after a signup/login submit - kept as a thin flush() alias
// rather than touched at every call site.
export async function waitForCrypto() {
  await flush();
}

export async function flush(rounds = 3) {
  const act = await getAct();
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

export async function click(el) {
  const act = await getAct();
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

export async function type(el, value) {
  const act = await getAct();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

// Same idea as type(), but for <select> - HTMLSelectElement's value setter isn't inherited from
// HTMLInputElement, so type()'s setter lookup doesn't apply to it.
export async function selectOption(el, value) {
  const act = await getAct();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

export function text(container) {
  return container.textContent;
}

// Simulates a Realtime broadcast arriving from another tab - e.g.
// broadcast(auth, "site-activity", "draft_finished", {}). Wrapped in act() like every other
// helper here that triggers a React state update from outside a real DOM event.
export async function broadcast(auth, channelName, event, payload) {
  const act = await getAct();
  await act(async () => {
    auth._channels.get(channelName).send({ event, payload });
  });
}

// Opens a home-screen mode by its tile name ("Unlimited", "Genius mode", "GM mode", ...). Tests use
// this rather than clicking a tile's call-to-action text, because that copy is designed to change.
export async function clickMode(container, name) {
  const tile = [...container.querySelectorAll(".mode .mn")].find((e) => e.textContent === name)?.closest("button");
  if (!tile) throw new Error(`no "${name}" mode tile on screen`);
  await click(tile);
}

export function findButtonByText(container, needle) {
  const buttons = [...container.querySelectorAll("button")];
  return buttons.find((b) => b.textContent.includes(needle)) || null;
}

export function findAllButtonsByText(container, needle) {
  return [...container.querySelectorAll("button")].filter((b) => b.textContent.includes(needle));
}

export function assert(cond, msg) {
  if (!cond) throw new Error("Assertion failed: " + msg);
}

export async function runTest(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log("ok");
  } catch (e) {
    console.log("FAIL");
    console.error(e);
    process.exitCode = 1;
  }
}
