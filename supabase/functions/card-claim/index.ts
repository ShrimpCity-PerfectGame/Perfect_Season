// card-claim: hands a player their starter deck, opens a pack they buy, and plays their battles. See CARDS.md.
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
// BATTLES (v2.25.0, CARDS.md 11) answer the first six the same way too, then:
//   { action: "run_start" }
//     200 { ok, run: { id, wins, defense, last } }   the live run - the one already going, or a new one
//   { action: "run_battle", run, step, lineup }
//     400 malformed | incomplete | unknown_card | bad_finish | bad_slot | same_player   the lineup, by the rules
//     409 no_run            this account has no live run
//     409 stale             the run is not the one, or not at the step, the browser thinks - it must read again
//     409 not_owned         one of the six is not theirs
//     200 { ok, battle, run: { id, wins, status, defense }, coins: { credited, capped, balance } }
//   { action: "run_end" }
//     200 { ok, ended, wins }
//   { action: "showdown", lineup }
//     400 (the lineup reasons)   409 not_owned   409 duplicate (already played today)
//     200 { ok, date, showdown: { defense, lineup, score } }
// The rules are card-logic.mjs's and the luck is drawn HERE, fresh, with the cryptographic generator - except
// the showdown's, which is seeded from the day so everybody's cards have the same game. Which defense a run
// meets next follows from a seed made when the run began and kept in card_runs, a table no browser can read.
// The lineup's SHAPE is checked here against the rules; who OWNS the cards is checked in SQL, in the same
// transaction that writes the battle down.
//
// cards_off is asked BEFORE the profile on purpose: with the switch off this function must not touch the
// database at all, so that deploying it to production ahead of the feature is inert.
//
// The starter deck pays no coins and touches no other table; a pack moves coins only inside buy_pack. Every reason above has to be in storage-cards.js's
// CARD_REFUSALS - tests/test-cards-edge.mjs reads this file and fails on one that is not.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CARDS, initCardData, initDefenses, starterDeck, defenseByKey, lineupProblem, scoreBattle, runDefense, showdownDefense, showdownScore } from "../../../card-logic.mjs";
import { SLOTS } from "../../../game-logic.mjs";
import { COIN_RULES, cardWinCoins, cardSellCoins } from "../../../rewards.mjs";
import { PACK_BY_ID, rollPack } from "../../../card-packs.mjs";
import catalog from "../../../data/cards.json" with { type: "json" };
import versusPool from "../../../data/versus-pool.json" with { type: "json" };
import cardDefense from "../../../data/card-defense.json" with { type: "json" };

initCardData(catalog);
initDefenses(versusPool, cardDefense);
const ACTIONS = ["starter", "open_pack", "sell_copies", "run_start", "run_battle", "run_end", "showdown"];
// What a copy of a card sells for (rewards.mjs), from the catalog's rating. The database holds no catalog, so
// every grant this function makes carries the price, and grant_cards decides whether it applies: only when the
// account already holds that card in that finish (CARDS.md 12).
const sellFor = (c: { id: number; finish: string }) => cardSellCoins(CARDS.get(c.id)?.rating, c.finish);
const shownCard = (g: any) => (g.sold != null ? { id: g.card, finish: g.finish, sold: g.sold } : { id: g.card, finish: g.finish });
const BATTLE_ACTIONS = ["run_start", "run_battle", "run_end", "showdown"];

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
  if (!ACTIONS.includes(body?.action)) return json({ error: "unknown action", reason: "malformed" }, 400);
  if (body.action === "run_battle" && (!Number.isInteger(body.run) || !Number.isInteger(body.step) || body.step < 0)) {
    return json({ error: "a run and the step it is on are both needed", reason: "malformed" }, 400);
  }
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
  if (body.action === "sell_copies") return sellCopies(service, user.id, json);
  if (BATTLE_ACTIONS.includes(body.action)) return battle(service, user.id, body, json);

  // The refs are fixed - starter:0 to starter:7 - and the cards are fresh each time. So a second claim deals a
  // different deck and grants none of it: the refs are what was claimed, and grant_cards is one transaction.
  const deck = starterDeck(secureRand);
  const { data, error } = await service.rpc("grant_cards", {
    p_user: user.id,
    p_kind: "starter",
    p_grants: deck.map((card, i) => ({ ref: `starter:${i}`, card: card.id, finish: card.finish, sell: sellFor(card) })),
  });
  if (error || !data) {
    console.error("card-claim grant:", error);
    return json({ error: "failed", reason: "server" }, 500);
  }
  if (data.duplicate) return json({ error: "already claimed", reason: "duplicate" }, 409);
  return json({ ok: true, cards: (data.granted || []).map(shownCard) });
}

// SELLING THE COPIES ALREADY STACKED ({ action: "sell_copies" }). Since v2.26.0 a copy is sold as it arrives;
// this is for the stacks from before that, and for any a hand-out makes. It reads the stacks, prices each from
// the catalog, and card_sell_copies sells whatever is past one under a lock. Asking twice sells nothing twice.
//   500 server   200 { ok, copies, coins, balance }
async function sellCopies(service: any, userId: string, json: (body: unknown, status?: number) => Response) {
  const { data: stacks, error: readError } = await service.rpc("card_copies", { p_user: userId });
  if (readError || !Array.isArray(stacks)) {
    console.error("card-claim card_copies:", readError);
    return json({ error: "failed", reason: "server" }, 500);
  }
  // A card this function's catalog does not know cannot be priced, so it is left stacked rather than sold for nothing.
  const sales = stacks.filter((s: any) => CARDS.has(s.card)).map((s: any) => ({ card: s.card, finish: s.finish, each: sellFor({ id: s.card, finish: s.finish }) }));
  const { data, error } = await service.rpc("card_sell_copies", { p_user: userId, p_sales: sales, p_ref: crypto.randomUUID() });
  if (error || !data) {
    console.error("card-claim card_sell_copies:", error);
    return json({ error: "failed", reason: "server" }, 500);
  }
  return json({ ok: true, copies: Number(data.copies) || 0, coins: Number(data.coins) || 0, balance: data.balance ?? null });
}
// What buy_pack may refuse a purchase for, and the status each travels under. Anything it raises that is not
// here (bad_grant, purchase_conflict) is this function's fault rather than the player's, and is a 500.
const PACK_REFUSALS: Record<string, number> = { unavailable: 409, sold_out: 409, price_changed: 409, not_enough: 409, bad_open: 400, no_profile: 400, guest_not_allowed: 403 };

// What the battle functions may refuse for, and the status each travels under. Anything else they raise
// (bad_battle, bad_run, bad_showdown, bad_lineup) is this function's fault rather than the player's: a 500.
const BATTLE_REFUSALS: Record<string, number> = { no_profile: 400, guest_not_allowed: 403, no_run: 409, stale: 409, not_owned: 409 };
function refusal(error: any) {
  const said = String(error?.message || "");
  return error?.code === "P0001" && Object.hasOwn(BATTLE_REFUSALS, said) ? said : null;
}
// A battle as the browser is shown it, and as the row keeps it for a browser whose answer was lost.
const shownBattle = (result: any, defense: any) => ({ defense: defense.key, cards: result.cards, offense: result.offense, target: result.target, win: result.win });
const sqlLineup = (lineup: any) => SLOTS.map((slot: string) => ({ card: lineup[slot].id, finish: lineup[slot].finish }));

async function battle(service: any, userId: string, body: any, json: (body: unknown, status?: number) => Response) {
  const failed = (what: string, error: unknown) => { console.error(`card-claim ${what}:`, error); return json({ error: "failed", reason: "server" }, 500); };

  if (body.action === "run_start") {
    const seed = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await service.rpc("card_run_start", { p_user: userId, p_seed: seed, p_defense: runDefense(seed, 0).key });
    if (error || !data) {
      const reason = refusal(error);
      return reason ? json({ error: "refused", reason }, BATTLE_REFUSALS[reason]) : failed("card_run_start", error);
    }
    return json({ ok: true, run: { id: data.id, wins: data.wins, defense: data.defense, last: data.last ?? null } });
  }

  if (body.action === "run_end") {
    const { data, error } = await service.rpc("card_run_end", { p_user: userId });
    if (error || !data) return failed("card_run_end", error);
    return json({ ok: true, ended: data.ended === true, wins: data.wins ?? 0 });
  }

  // Both of the others play a lineup. Its shape is the rules' to judge; ownership is SQL's, below.
  const problem = lineupProblem(body.lineup, null);
  if (problem) return json({ error: "that lineup cannot be played", reason: problem }, 400);

  if (body.action === "showdown") {
    // The day is THIS function's clock, in UTC - the same day card_battle_state calls today.
    const date = new Date().toISOString().slice(0, 10);
    const defense = showdownDefense(date);
    const result = showdownScore(date, body.lineup);
    const { data, error } = await service.rpc("card_showdown_record", {
      p_user: userId, p_date: date, p_defense: defense.key, p_lineup: sqlLineup(body.lineup),
      p_score: result.score, p_shown: shownBattle(result, defense),
    });
    if (error || !data) {
      const reason = refusal(error);
      return reason ? json({ error: "refused", reason }, BATTLE_REFUSALS[reason]) : failed("card_showdown_record", error);
    }
    if (data.duplicate) return json({ error: "today's showdown is already played", reason: "duplicate" }, 409);
    return json({ ok: true, date, showdown: { defense: data.defense, lineup: data.lineup, score: Number(data.score) } });
  }

  // run_battle. The run is read here for its defense and its seed, and checked AGAIN under a lock by
  // card_run_battle - so two requests that both read "three wins" cannot both play the fourth battle.
  const { data: run, error: runError } = await service
    .from("card_runs").select("id, wins, defense, seed").eq("user_id", userId).eq("status", "live").maybeSingle();
  if (runError) return failed("run read", runError);
  if (!run) return json({ error: "no run is going", reason: "no_run" }, 409);
  if (run.id !== body.run || run.wins !== body.step) return json({ error: "the run has moved on", reason: "stale" }, 409);
  const defense = defenseByKey(run.defense);
  if (!defense) return failed("run defense", `no defense ${run.defense}`);

  const result = scoreBattle(body.lineup, defense, secureRand, run.wins);
  const last = shownBattle(result, defense);
  const { data, error } = await service.rpc("card_run_battle", {
    p_user: userId, p_run: run.id, p_step: run.wins, p_lineup: sqlLineup(body.lineup),
    p_win: result.win, p_next: result.win ? runDefense(run.seed, run.wins + 1).key : null, p_last: last,
    p_coins: result.win ? cardWinCoins(run.wins + 1) : 0, p_cap: COIN_RULES.paidCardWinsPerDay,
  });
  if (error || !data) {
    const reason = refusal(error);
    return reason ? json({ error: "refused", reason }, BATTLE_REFUSALS[reason]) : failed("card_run_battle", error);
  }
  return json({
    ok: true,
    battle: last,
    run: { id: run.id, wins: data.wins, status: data.status, defense: data.defense },
    coins: { credited: data.credited ?? 0, capped: data.capped === true, balance: data.balance ?? null },
  });
}

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
    p_cards: pulled.map((c: any) => ({ card: c.id, finish: c.finish, sell: sellFor(c) })),
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
    cards: (data.cards || []).map(shownCard),
    balance: data.balance,
    stockLeft: data.stock_left ?? null,
    duplicate: data.duplicate === true,
  });
}
