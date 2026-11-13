// card-claim: hands a player their starter deck, and opens a pack they buy. See CARDS.md.
//
// card_owned and card_grants have no client write policy at all (supabase/migration-cards.sql). This function's
// service role, calling grant_cards and buy_pack, is one of the two writers - submit-run is the other, for the
// daily card.
// Which eight cards a starter deck holds is decided HERE, with a cryptographic generator, from the rule in
// card-logic.mjs; the browser sends nothing but "starter" and is told what it got.
//
// The order it answers in matters more than usual, because each answer is a different sentence on screen:
//   401 signed_out          nobody is signed in
//   400 malformed           no JSON, or an action that is not one
//   403 cards_off           this environment has not switched cards on (the CARDS_ENABLED secret)
//   500 server              the profile could not be read - never mistaken for "no profile"
//   400 no_profile          signed in with Google and has not picked a name yet
//   403 guest_not_allowed   a guest account. Cards are for accounts, like the shop
//   500 server              the grant failed
//   409 duplicate           the deck was already claimed. grant_cards is what knows: the eight refs are taken
//   200 { ok, cards }       eight { id, finish }
//
// OPENING A PACK ({ action: "open_pack", pack, open, price }) answers the first six the same way, then:
//   400 unknown_pack        no pack by that id in card-packs.mjs
//   400 bad_open            the open id is not one (8-36 letters, digits and hyphens)
//   409 unavailable         the pack is off sale, or has no row
//   409 sold_out            a limited pack with none left
//   409 price_changed       the pack costs more now than `price`, which is what the buyer's screen showed
//   409 not_enough          the wallet does not hold the price
//   500 server              anything else buy_pack raised - logged, because it means this function has a bug
//   200 { ok, cards, balance, stockLeft, duplicate }
// WHICH cards come out is decided here, by card-packs.mjs's rollPack - the same module the browser printed the
// odds from - with the cryptographic generator. WHAT IT COSTS, whether there is one left and whether the wallet
// can pay are buy_pack's, in one transaction with the grant. The `open` id is the browser's, one per purchase:
// sending it again is answered with the cards from the first time and `duplicate: true`, and charges nothing, so
// a response that never arrived can simply be asked for again.
//
// cards_off is asked BEFORE the profile on purpose: with the switch off this function must not touch the
// database at all, so that deploying it to production ahead of the feature is inert.
//
// The starter deck pays no coins and touches no other table; a pack moves coins only inside buy_pack. Every reason above has to be in storage-cards.js's
// CARD_REFUSALS - tests/test-cards-edge.mjs reads this file and fails on one that is not.
import { createClient } from "npm:@supabase/supabase-js@2";
import { initCardData, starterDeck } from "../../../card-logic.mjs";
import { PACK_BY_ID, rollPack } from "../../../card-packs.mjs";
import catalog from "../../../data/cards.json" with { type: "json" };

initCardData(catalog);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Read per request, not once at load: a secret set after a deploy should not need a second deploy to be seen.
const cardsEnabled = () => Deno.env.get("CARDS_ENABLED") === "1";

// A [0, 1) draw from the platform's cryptographic generator. Never Math.random: which cards a player is dealt
// must not be something a patient person can predict.
const secureRand = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;

// Same reasoning as submit-run's: Edge Functions add no CORS headers of their own, the browser calls this
// cross-origin, and the request's own Origin is echoed because supabase-js's fetch is credentialed.
function corsHeaders(req: Request) {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    return await handle(req, json);
  } catch (e) {
    console.error("card-claim:", e);
    return json({ error: "failed", reason: "server" }, 500);
  }
});

async function handle(req: Request, json: (body: unknown, status?: number) => Response) {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "unauthorized", reason: "signed_out" }, 401);
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: authError } = await authClient.auth.getUser();
  if (authError || !user) return json({ error: "unauthorized", reason: "signed_out" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid JSON", reason: "malformed" }, 400); }
  if (body?.action !== "starter" && body?.action !== "open_pack") return json({ error: "unknown action", reason: "malformed" }, 400);
  if (body.action === "open_pack" && (typeof body.pack !== "string" || typeof body.open !== "string" || !Number.isInteger(body.price) || body.price < 1 || body.price > 1000000)) {
    return json({ error: "a pack, an open id and the price shown are all needed", reason: "malformed" }, 400);
  }

  if (!cardsEnabled()) return json({ error: "cards are not switched on here", reason: "cards_off" }, 403);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: profile, error: profileError } = await service
    .from("profiles").select("id, guest").eq("id", user.id).maybeSingle();
  if (profileError) {
    console.error("card-claim profile read:", profileError);
    return json({ error: "failed", reason: "server" }, 500);
  }
  if (!profile) return json({ error: "no profile for this account", reason: "no_profile" }, 400);
  if (profile.guest) return json({ error: "cards are for accounts", reason: "guest_not_allowed" }, 403);

  if (body.action === "open_pack") return openPack(service, user.id, body, json);

  // The refs are fixed - starter:0 to starter:7 - and the cards are fresh each time. So a second claim deals a
  // different deck and grants none of it: the refs are what was claimed, and grant_cards is one transaction.
  const deck = starterDeck(secureRand);
  const { data, error } = await service.rpc("grant_cards", {
    p_user: user.id,
    p_kind: "starter",
    p_grants: deck.map((card, i) => ({ ref: `starter:${i}`, card: card.id, finish: card.finish })),
  });
  if (error || !data) {
    console.error("card-claim grant:", error);
    return json({ error: "failed", reason: "server" }, 500);
  }
  if (data.duplicate) return json({ error: "already claimed", reason: "duplicate" }, 409);
  return json({ ok: true, cards: (data.granted || []).map((g: any) => ({ id: g.card, finish: g.finish })) });
}
// What buy_pack may refuse a purchase for, and the status each travels under. Anything it raises that is not
// here (bad_grant, purchase_conflict) is this function's fault rather than the player's, and is a 500.
const PACK_REFUSALS: Record<string, number> = { unavailable: 409, sold_out: 409, price_changed: 409, not_enough: 409, bad_open: 400, no_profile: 400, guest_not_allowed: 403 };

async function openPack(service: any, userId: string, body: any, json: (body: unknown, status?: number) => Response) {
  // hasOwn, not a plain lookup: "constructor" is a key every object answers to.
  const pack = Object.hasOwn(PACK_BY_ID, body.pack) ? (PACK_BY_ID as any)[body.pack] : null;
  if (!pack) return json({ error: "no such pack", reason: "unknown_pack" }, 400);
  if (!/^[A-Za-z0-9-]{8,36}$/.test(body.open)) return json({ error: "not an open id", reason: "bad_open" }, 400);

  const pulled = rollPack(pack, secureRand);
  const { data, error } = await service.rpc("buy_pack", {
    p_user: userId,
    p_pack: pack.id,
    p_open: body.open,
    p_cards: pulled.map((c: any) => ({ card: c.id, finish: c.finish })),
    p_price: body.price,
  });
  if (error || !data) {
    // EXACTLY buy_pack's own raise: its code, and a message that is nothing but the reason. A substring test
    // would call a gateway's "service unavailable" the refusal `unavailable` - and a refusal tells the screen the
    // purchase certainly did not happen, which is the one thing a failure in between cannot know.
    const said = String(error?.message || "");
    const reason = error?.code === "P0001" && Object.hasOwn(PACK_REFUSALS, said) ? said : null;
    if (reason) return json({ error: "refused", reason }, PACK_REFUSALS[reason]);
    console.error("card-claim buy_pack:", error);
    return json({ error: "failed", reason: "server" }, 500);
  }
  return json({
    ok: true,
    cards: (data.cards || []).map((c: any) => ({ id: c.card, finish: c.finish })),
    balance: data.balance,
    stockLeft: data.stock_left ?? null,
    duplicate: data.duplicate === true,
  });
}
