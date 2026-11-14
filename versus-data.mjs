// Fetches data/versus-pool.json - Duel's defenses and kickers - instead of shipping it in the bundle every
// visitor loads. The same trade guess-pool.mjs and card-data.mjs make, and the one tests/test-build-seo.mjs
// named as the next reclaim from v2.14.0 on: 67 KB that only the duel screen (and since v2.25.0 a card battle)
// reads. It was finally made in v2.25.0, when the battle screens put the bundle over its ceiling.
//
// The page asks for it as soon as it has loaded, so by the time anybody opens a duel it is almost always
// there; the duel screen waits on it, and says so in words if it could not be fetched.
//
// The service worker treats it like the bundle - network first, the store only as a fallback (sw-rules.mjs's
// DATA) - for the reason the guess pool is: match-pick replays a match against ITS copy of this file, so a
// browser holding a stale one would offer a defense the function then refuses.
import { initVersusData } from "./versus-logic.mjs";

export const VERSUS_POOL_URL = "/data/versus-pool.json";

let pool = null;
let pending = null;

// The pool once it is loaded, or null. card-data.mjs builds the cards' defenses out of the same rows.
export const versusPool = () => pool;

// Hand the pool over directly: the UI harness and anything else that imports the file itself.
export function primeVersusData(data) {
  initVersusData(data);
  pool = data;
  return pool;
}

// Resolves with the pool once versus-logic.mjs has it; throws if it could not be fetched. Memoised, so every
// caller shares one request; a FAILED attempt is forgotten, so a retry is a real retry.
export function loadVersusData(fetchImpl) {
  if (pool) return Promise.resolve(pool);
  if (pending) return pending;
  const get = fetchImpl || (typeof fetch === "function" ? (url, opts) => fetch(url, opts) : null);
  const attempt = (async () => {
    if (!get) throw new Error("no fetch");
    const res = await get(VERSUS_POOL_URL, { credentials: "omit" });
    if (!res || !res.ok) throw new Error(`versus pool: ${res ? res.status : "no response"}`);
    const data = await res.json();
    if (!data?.defenses?.length || !data?.kickers?.length || !data?.columns) throw new Error("versus pool: not a pool");
    return primeVersusData(data);
  })();
  pending = attempt;
  attempt.then(() => { pending = null; }, () => { if (pending === attempt) pending = null; });
  return attempt;
}
// Test-only: forget the pool, so one file can exercise a failure and then a success.
export function _resetVersusData() { pool = null; pending = null; }
