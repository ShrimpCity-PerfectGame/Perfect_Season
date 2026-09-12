import React from "react";
import { createRoot } from "react-dom/client";
import PerfectSeason from "./perfect-season.jsx";

// Mimics the artifact host's window.storage: a per-key store with a "shared" namespace
// (visible to every player, e.g. leaderboard/account rows) and a "personal" namespace
// (this device only, e.g. ps-session). Both are backed by localStorage so state survives
// reloads within the same browser, matching how the real host persists data.
function makeStorageShim() {
  const nsKey = (shared, key) => `${shared ? "shared" : "personal"}:${key}`;

  function readAll() {
    let raw;
    try { raw = localStorage.getItem("__ps_storage__"); } catch (e) { raw = null; }
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (e) { return {}; }
  }
  function writeAll(store) {
    try { localStorage.setItem("__ps_storage__", JSON.stringify(store)); } catch (e) { /* ignore */ }
  }

  return {
    async get(key, shared) {
      const store = readAll();
      const k = nsKey(shared, key);
      return Object.prototype.hasOwnProperty.call(store, k) ? { value: store[k] } : null;
    },
    async set(key, value, shared) {
      const store = readAll();
      store[nsKey(shared, key)] = value;
      writeAll(store);
      return true;
    },
    async delete(key, shared) {
      const store = readAll();
      delete store[nsKey(shared, key)];
      writeAll(store);
    },
    async list(prefix, shared) {
      const store = readAll();
      const nsPrefix = nsKey(shared, prefix);
      const keys = Object.keys(store)
        .filter((k) => k.startsWith(nsPrefix))
        .map((k) => k.slice(shared ? "shared:".length : "personal:".length));
      return { keys };
    },
  };
}

window.storage = makeStorageShim();

// Placeholder for window.__ps_supabase__ until Phase 5 wires the real @supabase/supabase-js
// client (needs a real project URL/anon key). Same shape as tests/helpers.mjs's makeMockAuth,
// but localStorage-backed so signup/login/leaderboard are actually verifiable in a browser
// across a reload, not just in jsdom. Delete this whole block once the real client lands.
function makeLocalMockSupabase() {
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let authUsers = read("__ps_mock_authUsers__", {});
  let profiles = read("__ps_mock_profiles__", {});
  let dailyRuns = read("__ps_mock_dailyRuns__", {});
  let session = read("__ps_mock_session__", null);
  const persist = () => {
    write("__ps_mock_authUsers__", authUsers);
    write("__ps_mock_profiles__", profiles);
    write("__ps_mock_dailyRuns__", dailyRuns);
    write("__ps_mock_session__", session);
  };
  const listeners = [];
  const notify = (event) => listeners.forEach((cb) => cb(event, session));

  function from(table) {
    const store = table === "profiles" ? profiles : dailyRuns;
    return {
      select() {
        const state = { filters: [], order: null, limit: null };
        const run = () => {
          let out = Object.values(store).filter((r) => state.filters.every((f) => f(r)));
          if (state.order) out = out.sort((a, b) => (state.order.asc ? a[state.order.col] - b[state.order.col] : b[state.order.col] - a[state.order.col]));
          if (state.limit != null) out = out.slice(0, state.limit);
          return out;
        };
        const builder = {
          eq(col, val) { state.filters.push((r) => r[col] === val); return builder; },
          not(col, _op, val) { state.filters.push((r) => r[col] !== val); return builder; },
          order(col, opts) { state.order = { col, asc: opts?.ascending !== false }; return builder; },
          limit(n) { state.limit = n; return builder; },
          single() {
            const rows = run();
            return Promise.resolve(rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: "no rows" } });
          },
          then(resolve, reject) { return Promise.resolve({ data: run(), error: null }).then(resolve, reject); },
        };
        return builder;
      },
      update(patch) {
        return {
          eq(col, val) {
            for (const row of Object.values(store)) if (row[col] === val) Object.assign(row, patch);
            persist();
            return Promise.resolve({ error: null });
          },
        };
      },
      insert(row) {
        if (table === "profiles") {
          if (Object.values(profiles).some((r) => r.username === row.username)) {
            return Promise.resolve({ error: { code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"' } });
          }
          profiles[row.id] = { runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [], daily_streak: 0, daily_best_streak: 0, ...row };
        } else {
          dailyRuns[`${row.date}:${row.user_id}`] = row;
        }
        persist();
        return Promise.resolve({ error: null });
      },
    };
  }

  return {
    from,
    auth: {
      async signUp({ email, password, options }) {
        if (authUsers[email]) return { data: null, error: { message: "User already registered" } };
        const username = options?.data?.username;
        if (Object.values(profiles).some((r) => r.username === username)) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_key"' } };
        }
        const id = `user-${Object.keys(authUsers).length + 1}`;
        authUsers[email] = { id, email, password };
        profiles[id] = { id, username, runs: 0, dnf: 0, wins: 0, losses: 0, champs: 0, perfect: 0, playoffs: 0, recent: [], daily_streak: 0, daily_best_streak: 0 };
        session = { user: { id, email } };
        persist();
        notify("SIGNED_IN");
        return { data: { user: { id, email } }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const u = authUsers[email];
        if (!u || u.password !== password) return { data: null, error: { message: "Invalid login credentials" } };
        session = { user: { id: u.id, email } };
        persist();
        notify("SIGNED_IN");
        return { data: { user: { id: u.id, email } }, error: null };
      },
      async signOut() {
        session = null;
        persist();
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
window.__ps_supabase__ = makeLocalMockSupabase();

const root = createRoot(document.getElementById("root"));
root.render(<PerfectSeason />);
