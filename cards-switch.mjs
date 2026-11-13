// Is the card area switched on in this build? One reader for the whole client. See CARDS.md.
//
// CARDS_ON is baked in by build.mjs: "1" on the test site, "" on production until the owner says otherwise.
//
// window.__ps_cards__ overrides it, the way window.__ps_supabase__ overrides the client: the tests and the UI
// harness decide per case, so both the on and the off screens are tested from one bundle. That override exists
// in production too and is harmless there - it can only make this BROWSER draw the card area. The server has a
// switch of its own (the CARDS_ENABLED secret, read by card-claim and submit-run), so on an environment that
// has not turned cards on a forced-on browser gets a tile and then "Couldn't load your cards" - the catalog is
// not shipped there, so there is nothing to draw. Nothing is granted and nothing is stored.
//
// The two switches are independent, and GRANTING follows the server's alone: an environment with the secret set
// and a client built without CARDS_ON banks a daily card for every finished daily and shows none of it. That is
// the order a launch turns them on in (server, then client), not a state to leave an environment in.
/* global CARDS_ON */
export function cardsOn() {
  if (typeof window !== "undefined" && window.__ps_cards__ !== undefined) return !!window.__ps_cards__;
  return typeof CARDS_ON !== "undefined" && CARDS_ON === "1";
}
