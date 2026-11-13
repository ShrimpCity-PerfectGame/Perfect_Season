// The real supabase/functions/card-claim/index.ts, executed (tests/edge-harness.mjs bundles it and runs it over a
// store this file supplies). It hands out the starter deck, so what matters is the order it refuses in, that a
// second claim changes nothing, and that it never grants a thing while the server's switch is off.
//
// The store's grant_cards is tests/mock-cards.mjs's, which tests/test-cards-sql.mjs holds to the SQL - so the
// once-only rule this leans on is the database's, not a stand-in written for this file.
import { readFileSync } from "node:fs";
import { assert, runTest } from "./helpers.mjs";
import { loadEdgeFunction } from "./edge-harness.mjs";
import { makeCards } from "./mock-cards.mjs";
import { initCardData, CARDS, STARTER_MAX_RATING, lineupProblem } from "../card-logic.mjs";
import { SLOTS } from "../game-logic.mjs";
import { CARD_REFUSALS } from "../storage-cards.js";

initCardData(JSON.parse(readFileSync(new URL("../data/cards.json", import.meta.url), "utf8")));
const { invoke } = await loadEdgeFunction("card-claim");

const ME = "11111111-1111-4111-8111-111111111111";
const GUEST = "22222222-2222-4222-8222-222222222222";
const NAMELESS = "33333333-3333-4333-8333-333333333333"; // signed in with Google, no profile yet

function store({ on = true } = {}) {
  const profiles = new Map([
    [ME, { id: ME, username: "someone", guest: false }],
    [GUEST, { id: GUEST, username: "Guest_ab12c", guest: true }],
  ]);
  const cards = makeCards({ profiles, currentUserId: () => null });
  globalThis.__edge_env__ = on ? { CARDS_ENABLED: "1" } : {};
  const s = {
    users: { has: (id) => id === ME || id === GUEST || id === NAMELESS },
    readFails: {}, writeFails: {}, rpcFails: {}, throwOn: {}, beforeWrite: null, rpcCalls: [],
    profiles, cards,
    rowsOf: (table) => (table === "profiles" ? [...profiles.values()] : []),
    insert: (_table, row) => ({ row }),
    remove() {},
    rpcs: { grant_cards: (args) => cards.grantCards(args.p_user, args.p_kind, args.p_grants) },
  };
  globalThis.__edge_store__ = s;
  return s;
}
const claim = (userId, body = { action: "starter" }) => invoke(body, { userId });
const granted = (s) => s.rpcCalls.filter((c) => (c.name || c[0]) === "grant_cards").length;

await runTest("who is asking, and what for", async () => {
  const s = store();
  const anon = await claim(null);
  assert(anon.status === 401 && anon.body.reason === "signed_out", "nobody signed in: " + JSON.stringify(anon));
  const odd = await claim(ME, { action: "everything" });
  assert(odd.status === 400 && odd.body.reason === "malformed", "an action that does not exist: " + JSON.stringify(odd));
  const none = await claim(ME, {});
  assert(none.status === 400 && none.body.reason === "malformed", "no action at all");
  assert(s.cards.owned(ME).length === 0, "and nothing was granted along the way");
});

await runTest("with the server's switch off it grants nothing and says why", async () => {
  const s = store({ on: false });
  const res = await claim(ME);
  assert(res.status === 403 && res.body.reason === "cards_off", "cards_off: " + JSON.stringify(res));
  assert(s.cards.owned(ME).length === 0 && s.cards.grants(ME).length === 0, "not a card, not a ledger row");
});

await runTest("a starter deck: eight Base cards that make a lineup, once", async () => {
  const s = store();
  const res = await claim(ME);
  assert(res.status === 200 && res.body.ok === true, "claimed: " + JSON.stringify(res).slice(0, 200));
  const deck = res.body.cards;
  assert(deck.length === 8 && deck.every((c) => c.finish === "base"), "eight Base cards");
  const cards = deck.map((c) => CARDS.get(c.id));
  assert(cards.every((c) => c && c.rating < STARTER_MAX_RATING), "all real cards from the lower-rated pool");
  assert(new Set(cards.map((c) => c.pid)).size === 8, "eight different players");
  const lineup = {}; const men = new Set();
  for (const slot of SLOTS) {
    const c = [...cards].sort((a, b) => b.rating - a.rating).find((x) => !men.has(x.pid) && (slot.startsWith("FLEX") ? x.pos !== "QB" : x.pos === slot));
    lineup[slot] = { id: c.id, finish: "base" }; men.add(c.pid);
  }
  const owned = new Map(s.cards.owned(ME).map((o) => [`${o.card_id}:${o.finish}`, o.count]));
  assert(lineupProblem(lineup, owned) === null, "and the account can field a legal lineup from what it now owns");
  assert(s.cards.grants(ME).map((g) => g.ref).sort().join() === "starter:0,starter:1,starter:2,starter:3,starter:4,starter:5,starter:6,starter:7", "under the eight starter refs");

  const again = await claim(ME);
  assert(again.status === 409 && again.body.reason === "duplicate", "a second claim is a duplicate: " + JSON.stringify(again));
  assert(s.cards.owned(ME).reduce((n, o) => n + o.count, 0) === 8, "and the account still owns exactly eight");
});

await runTest("two different claims deal two different decks", async () => {
  const a = (await (store(), claim(ME))).body.cards.map((c) => c.id).sort().join();
  const b = (await (store(), claim(ME))).body.cards.map((c) => c.id).sort().join();
  assert(a !== b, "the choice is random, not a fixed deck everybody gets");
});

await runTest("who may not collect, and what a failure is called", async () => {
  let s = store();
  const guest = await claim(GUEST);
  assert(guest.status === 403 && guest.body.reason === "guest_not_allowed", "a guest: " + JSON.stringify(guest));
  const nameless = await claim(NAMELESS);
  assert(nameless.status === 400 && nameless.body.reason === "no_profile", "an account with no profile: " + JSON.stringify(nameless));
  assert(s.cards.owned(GUEST).length === 0, "the guest owns nothing");

  s = store(); s.rpcFails.grant_cards = true;
  const failed = await claim(ME);
  assert(failed.status === 500 && failed.body.reason === "server", "the grant failing is a server error: " + JSON.stringify(failed));
  s = store(); s.readFails.profiles = true;
  const unread = await claim(ME);
  assert(unread.status === 500 && unread.body.reason === "server", "the profile read failing is a server error, never 'no profile'");
  assert(s.cards.owned(ME).length === 0, "and nothing was granted on a read that failed");
});

await runTest("every reason the function can give is one the client knows", async () => {
  const src = readFileSync(new URL("../supabase/functions/card-claim/index.ts", import.meta.url), "utf8");
  const reasons = [...new Set([...src.matchAll(/reason:\s*"([a-z_]+)"/g)].map((m) => m[1]))];
  assert(reasons.length >= 6, "the function names its reasons: " + reasons);
  for (const r of reasons) assert(CARD_REFUSALS.includes(r), `storage-cards.js does not know the reason "${r}"`);
});

console.log("test-cards-edge.mjs done");
