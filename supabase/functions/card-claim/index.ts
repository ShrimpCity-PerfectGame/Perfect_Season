// card-claim: hands a player their starter deck. See CARDS.md.
//
// card_owned and card_grants have no client write policy at all (supabase/migration-cards.sql). This function's
// service role, calling grant_cards, is one of the two writers - submit-run is the other, for the daily card.
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
// cards_off is asked BEFORE the profile on purpose: with the switch off this function must not touch the
// database at all, so that deploying it to production ahead of the feature is inert.
//
// It pays no coins and touches no other table. Every reason above has to be in storage-cards.js's
// CARD_REFUSALS - tests/test-cards-edge.mjs reads this file and fails on one that is not.
import { createClient } from "npm:@supabase/supabase-js@2";
import { initCardData, starterDeck } from "../../../card-logic.mjs";
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
  if (body?.action !== "starter") return json({ error: "unknown action", reason: "malformed" }, 400);

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
