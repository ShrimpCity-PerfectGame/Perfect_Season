// Fetches data/guess-pool.json when the game is opened, instead of shipping it in the bundle every visitor
// loads.
//
// Why this file exists at all: page.js sits within a few KB of the 1.2 MB ceiling tests/test-build-seo.mjs holds
// it to, and that ceiling says in as many words that the honest fix for a data file is to load it when its
// screen opens rather than at startup - raising it is how data/versus-pool.json got in, and doing that twice is
// how a 400 KB bundle happens. The pool was 195 KB when this was written and is 36 KB since the v2.14.0 ranking;
// the bundle still has no room for it, so this stays.
//
// The rules and the DATA are separate concerns: guess-logic.mjs is imported normally, because it is small and the
// screen needs its constants before anything is loaded. Only the pool waits.
//
// It is served from the site root (build.mjs copies it to public/data/), and the service worker treats it the way
// it treats the bundle - network first, the store only as a fallback (sw-rules.mjs). That is the same reasoning:
// the daily's answer is a walk through a permutation of THIS file, and submit-guess walks its own copy, so a
// browser holding a stale pool would play one player and hand in another.
import { initGuessData, GUESS_PLAYERS } from "./guess-logic.mjs";

export const GUESS_POOL_URL = "/data/guess-pool.json";

let pending = null;

// Resolves once the pool is in guess-logic.mjs, and throws if it could not be fetched. Memoised, so opening the
// game twice fetches once; a FAILED attempt is forgotten, so a retry is a real retry.
export function loadGuessPool(fetchImpl) {
  // Already there: the tests and the UI harness import the file directly and init it before anything mounts, and
  // after the first successful load in the browser this is the answer every time.
  if (GUESS_PLAYERS.length) return Promise.resolve(GUESS_PLAYERS.length);
  if (pending) return pending;
  const get = fetchImpl || (typeof fetch === "function" ? fetch : null);
  pending = (async () => {
    if (!get) throw new Error("no fetch");
    const res = await get(GUESS_POOL_URL, { credentials: "omit" });
    if (!res.ok) throw new Error(`guess pool: ${res.status}`);
    const pool = await res.json();
    if (!pool?.players?.length || !pool?.columns?.length) throw new Error("guess pool: not a pool");
    initGuessData(pool);
    return GUESS_PLAYERS.length;
  })();
  pending.catch(() => { pending = null; });
  return pending;
}

