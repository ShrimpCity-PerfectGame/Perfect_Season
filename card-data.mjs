// The card catalog, FETCHED rather than carried in the bundle - 250 KB that only somebody who opens the card
// area needs, the same trade guess-pool.mjs makes for Guess the Player. build.mjs copies data/cards.json to
// /data/cards.json only where cards are switched on.
//
// One load per page, shared by everything that asks. A load that FAILS is not remembered: the next caller
// tries again, so a dropped request is a "Try again" button rather than a card area that is broken until the
// page is reloaded.
import { initCardData } from "./card-logic.mjs";

export const CARD_DATA_URL = "/data/cards.json";

let loading = null;
export function loadCardData(fetchImpl) {
  if (loading) return loading;
  const get = fetchImpl || ((url, opts) => fetch(url, opts));
  const attempt = (async () => {
    const res = await get(CARD_DATA_URL, { credentials: "omit" });
    if (!res || !res.ok) throw new Error(`card catalog: ${res ? res.status : "no response"}`);
    return initCardData(await res.json());
  })();
  loading = attempt;
  attempt.catch(() => { if (loading === attempt) loading = null; });
  return attempt;
}
// Test-only: forget the load, so one file can exercise a failure and then a success.
export function _resetCardData() { loading = null; }
