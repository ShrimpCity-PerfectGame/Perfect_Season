// Is the card area switched on in this build, and for whom? One reader for the whole client. See CARDS.md.
//
// CARDS_ON is baked in by build.mjs and has THREE settings:
//   "1"        on for everybody
//   "testers"  on only for an account the database lists in card_testers (v2.32.0) - production's setting
//              while cards are unfinished, because since 2026-11-25 there is no test site to play them on
//   ""         off: no tile, and the build ships no catalog
//
// In "testers" the client cannot know by itself: perfect-season.jsx asks once an account is signed in
// (storage-cards.js's fetchCardTester) and hands the answer to cardsOn(tester). Until that answer arrives, and
// whenever the read fails, there is no tile - which is the safe way round, and costs a tester a reload.
//
// window.__ps_cards__ overrides the build, the way window.__ps_supabase__ overrides the client: true, false or
// "testers", so the tests and the UI harness reach all three from one bundle. That override exists in
// production too and is harmless there - it can only make this BROWSER draw the card area. The server has a
// switch of its own (the CARDS_ENABLED secret, read by card-claim and submit-run, with the same three settings),
// so a forced-on browser that is not on the list gets a tile and then "Cards aren't switched on here yet."
// Nothing is granted and nothing is stored.
//
// The two switches are independent, and GRANTING follows the server's alone: an environment with the secret set
// to "1" and a client built without CARDS_ON banks a daily card for every finished daily and shows none of it.
// That is the order a launch turns them on in (server, then client), not a state to leave an environment in.
/* global CARDS_ON */
export function cardsMode() {
  if (typeof window !== "undefined" && window.__ps_cards__ !== undefined) {
    return window.__ps_cards__ === "testers" ? "testers" : window.__ps_cards__ ? "on" : "off";
  }
  const built = typeof CARDS_ON !== "undefined" ? CARDS_ON : "";
  return built === "1" ? "on" : built === "testers" ? "testers" : "off";
}

// `tester`: whether this account is known to be on the list. Only read in "testers".
export function cardsOn(tester = false) {
  const mode = cardsMode();
  return mode === "on" || (mode === "testers" && tester === true);
}
