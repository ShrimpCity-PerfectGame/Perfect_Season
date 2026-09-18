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

// No window.__ps_supabase__ override here - storage.js's getClient() falls back to a real
// @supabase/supabase-js client built from SUPABASE_URL/SUPABASE_ANON_KEY, injected at build
// time by build.mjs's esbuild `define`. Running this bundle without going through build.mjs
// (e.g. the old ad hoc `npx esbuild entry.jsx ...` from CLAUDE.md) leaves those identifiers
// undefined and auth calls will fail - use `node build.mjs` instead.

const root = createRoot(document.getElementById("root"));
root.render(<PerfectSeason />);

// The site is installable - a home-screen icon that opens the game full screen - and keeps working without a
// signal, both of which come from the service worker (service-worker.js, built into /sw.js by build.mjs).
// Registered after the page has loaded, so it never competes with the first paint, and never inside the
// Android app, which is already serving these files from the phone. A browser without service workers (or a
// page opened from a file, like the UI harness) simply doesn't get the offer.
if ("serviceWorker" in navigator && !window.Capacitor) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => { /* private mode, or a browser that says no */ });
  });
}
