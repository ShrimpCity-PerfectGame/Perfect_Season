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
// BATTLES (v2.27.0: offense against offense, CARDS.md 11) answer the first six the same way too, then:
//   { action: "deck_save", cards: [{ id, finish } x 30] }
//     400 malformed | bad_deck | unknown_card | bad_finish | same_player   the deck, by the rules
//     409 not_owned         one of the thirty is not theirs
//     200 { ok, saved }
//   { action: "run_start" }
//     409 no_deck           the collection cannot fill a deck of thirty
//     200 { ok, run: { id, wins, hand, foe, last } }   the live run - the one already going, or a new one
//   { action: "run_round", run, step, round, card: { id, finish } }     ONE ROUND of the battle the run is on
//     400 malformed | unknown_card | bad_finish | bad_slot   the card, by the rules (bad_slot: it does not fit the round's spot)
//     409 not_in_hand | already_played | same_player
//     409 no_run            this account has no live run
//     409 stale             the run is not the one, or not at the step or the ROUND, the browser thinks - read again
//     409 not_owned         the card is not theirs any more
//     200 { ok, round, done: false, run: { id, wins, status, hand, foe, rounds } }
//     200 { ok, round, done: true, battle, run, coins: { credited, capped, balance } }   the sixth round ends it
//   { action: "run_end" }
//     200 { ok, ended, wins }
//   { action: "daily_deal" }
//     409 no_deck
//     200 { ok, date, daily: { hand, log, played, rounds, score, shown } }   today's hand, dealt once
//   { action: "daily_round", round, card }
//     409 no_hand (nothing dealt today)   409 duplicate (already played today)   409 stale   (the card's reasons)
//     200 { ok, date, round, done, daily }
// A BATTLE IS PLAYED A ROUND AT A TIME. Each round is for one spot of the lineup, in the order of the other
// side's six (random, with a Flex last); the browser sends ONE card from the hand and is told how the round
// went, category and all. The order the categories come up in is drawn when the hand is dealt and kept in
// card_runs.cats, which no browser can read - a round's category is revealed by playing it.
// The rules are card-logic.mjs's. THE HAND IS DEALT HERE, with the cryptographic generator, from the deck the
// account saved (or its best thirty), and stored before it is shown - so it cannot be dealt again by asking
// again. A ladder battle's luck and the order of its categories are drawn here, fresh; the daily battle's are
// the day's, so everybody meets the same thing. Which CPU team a run meets next follows from a seed made when
// the run began and kept in card_runs, a table no browser can read.
// A team's SHAPE and that it came out of the hand are checked here against the rules; who OWNS the cards is
// checked in SQL, in the same transaction that writes the battle down.
//
// cards_off is asked BEFORE the profile on purpose: with the switch off this function must not touch the
// database at all, so that deploying it to production ahead of the feature is inert.
//
// The starter deck pays no coins and touches no other table; a pack moves coins only inside buy_pack. Every reason above has to be in storage-cards.js's
// CARD_REFUSALS - tests/test-cards-edge.mjs reads this file and fails on one that is not.
import { createClient } from "npm:@supabase/supabase-js@2";
import { CARDS, initCardData, starterFill, deckProblem, bestDeck, dealHand, roundProblem, playRound, battleResult, shuffleCategories, ladderFoe, ladderEdge, dailyFoe, dailyRound, dailyScore, ownKey } from "../../../card-logic.mjs";
import { COIN_RULES, cardWinCoins, cardSellCoins } from "../../../rewards.mjs";
import { PACK_BY_ID, rollPack } from "../../../card-packs.mjs";
import catalog from "../../../data/cards.json" with { type: "json" };

initCardData(catalog);
const ACTIONS = ["starter", "open_pack", "sell_copies", "deck_save", "run_start", "run_round", "run_end", "daily_deal", "daily_round"];
// What a copy of a card sells for (rewards.mjs), from the catalog's rating. The database holds no catalog, so
// every grant this function makes carries the price, and grant_cards decides whether it applies: only when the
// account already holds that card in that finish (CARDS.md 12).
const sellFor = (c: { id: number; finish: string }) => cardSellCoins(CARDS.get(c.id)?.rating, c.finish);
const shownCard = (g: any) => (g.sold != null ? { id: g.card, finish: g.finish, sold: g.sold } : { id: g.card, finish: g.finish });
// The database says { card, finish }; the rules and the browser say { id, finish }.
const toSql = (list: any[]) => list.map((e) => ({ card: e.id, finish: e.finish }));
const fromSql = (list: any) => (Array.isArray(list) ? list.map((e: any) => ({ id: e.card, finish: e.finish })) : []);
const BATTLE_ACTIONS = ["deck_save", "run_start", "run_round", "run_end", "daily_deal", "daily_round"];

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
  if (body.action === "run_round" && (!Number.isInteger(body.run) || !Number.isInteger(body.step) || body.step < 0)) {
    return json({ error: "a run and the step it is on are both needed", reason: "malformed" }, 400);
  }
  if ((body.action === "run_round" || body.action === "daily_round") && (!Number.isInteger(body.round) || body.round < 0 || body.round > 5)) {
    return json({ error: "which round is being played is needed", reason: "malformed" }, 400);
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

  // THE STARTER CARDS FILL A DECK (v2.27.0): whatever the collection is short of thirty, by position - thirty
  // for a new account, the difference for one that opened the old eight-card deck. The refs name the deck spot
  // ("deck:QB:3"), so a spot is filled once however often this is asked, and grant_cards is one transaction.
  const { data: have, error: haveError } = await service.rpc("card_deck_read", { p_user: user.id });
  if (haveError || !have) {
    console.error("card-claim card_deck_read:", haveError);
    return json({ error: "failed", reason: "server" }, 500);
  }
  const fill = starterFill(fromSql(have.owned), secureRand);
  if (!fill.length) return json({ error: "already claimed", reason: "duplicate" }, 409);
  const { data, error } = await service.rpc("grant_cards", {
    p_user: user.id,
    p_kind: "starter",
    p_grants: fill.map((card: any) => ({ ref: card.ref, card: card.id, finish: card.finish, sell: sellFor(card) })),
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
// (bad_battle, bad_run, bad_daily, bad_lineup) is this function's fault rather than the player's: a 500.
const BATTLE_REFUSALS: Record<string, number> = { no_profile: 400, guest_not_allowed: 403, no_run: 409, stale: 409, not_owned: 409, no_hand: 409, duplicate: 409 };
function refusal(error: any) {
  const said = String(error?.message || "");
  return error?.code === "P0001" && Object.hasOwn(BATTLE_REFUSALS, said) ? said : null;
}
// A card the rules will not let be played, and the status it travels under: a card that is not a card is a bad
// request; one that is simply not available for this round is a conflict with where the battle stands.
const ROUND_STATUS: Record<string, number> = { not_in_hand: 409, already_played: 409, same_player: 409 };
// A CPU card keeps its spot with it: the order of the other side's spots is the order of the rounds.
const foeSql = (list: any[]) => list.map((e) => ({ card: e.id, finish: e.finish, spot: e.spot }));
const foeFrom = (list: any) => (Array.isArray(list) ? list.map((e: any) => ({ id: e.card, finish: e.finish, spot: e.spot })) : []);
const playedOf = (rounds: any[]) => rounds.map((r) => ({ id: r.mine.id, finish: r.mine.finish }));
// A finished battle as the browser is shown it, and as the row keeps it for a browser whose answer was lost.
const shownBattle = (result: any, foe: any, edge: number) => ({ team: playedOf(result.rounds), foe, edge, rounds: result.rounds, wins: result.wins, losses: result.losses, total: result.total, foeTotal: result.foeTotal, win: result.win });

async function battle(service: any, userId: string, body: any, json: (body: unknown, status?: number) => Response) {
  const failed = (what: string, error: unknown) => { console.error(`card-claim ${what}:`, error); return json({ error: "failed", reason: "server" }, 500); };
  const refused = (what: string, error: any) => {
    const reason = refusal(error);
    return reason ? json({ error: "refused", reason }, BATTLE_REFUSALS[reason]) : failed(what, error);
  };

  if (body.action === "run_end") {
    const { data, error } = await service.rpc("card_run_end", { p_user: userId });
    if (error || !data) return failed("card_run_end", error);
    return json({ ok: true, ended: data.ended === true, wins: data.wins ?? 0 });
  }

  if (body.action === "deck_save") {
    const problem = deckProblem(body.cards, null);
    if (problem) return json({ error: "that deck cannot be saved", reason: problem }, 400);
    const { data, error } = await service.rpc("card_deck_save", { p_user: userId, p_cards: toSql(body.cards) });
    if (error || !data) return refused("card_deck_save", error);
    return json({ ok: true, saved: true });
  }

  // THE DECK THIS ACCOUNT PLAYS WITH: the one it saved, if that is still a legal deck of cards it owns;
  // otherwise its best thirty; null when the collection cannot fill a deck at all.
  const { data: have, error: haveError } = await service.rpc("card_deck_read", { p_user: userId });
  if (haveError || !have) return failed("card_deck_read", haveError);
  const held = fromSql(have.owned);
  const ownedMap = new Map(held.map((e: any) => [ownKey(e.id, e.finish), 1]));
  const saved = have.deck ? fromSql(have.deck) : null;
  const deck = saved && deckProblem(saved, ownedMap) === null ? saved : bestDeck(held);
  const noDeck = () => json({ error: "the collection cannot fill a deck", reason: "no_deck" }, 409);

  if (body.action === "run_start") {
    if (!deck) return noDeck();
    const seed = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
    const { data, error } = await service.rpc("card_run_start", {
      p_user: userId, p_seed: seed, p_hand: toSql(dealHand(deck, secureRand)), p_foe: foeSql(ladderFoe(seed, 0)), p_cats: shuffleCategories(secureRand),
    });
    if (error || !data) return refused("card_run_start", error);
    return json({ ok: true, run: { id: data.id, wins: data.wins, hand: fromSql(data.hand), foe: foeFrom(data.foe), rounds: data.rounds ?? [], last: data.last ?? null } });
  }

  // The day is THIS function's clock, in UTC - the same day card_battle_state calls today.
  const date = new Date().toISOString().slice(0, 10);
  const shownDaily = (row: any) => ({ hand: fromSql(row.hand), log: row.log ?? [], played: row.played === true, rounds: row.rounds ?? null, score: row.score == null ? null : Number(row.score), shown: row.shown ?? null });

  if (body.action === "daily_deal") {
    // Dealt once: card_daily_deal keeps the first hand it is handed for a day and answers with that one ever
    // after. So a hand is dealt here even when the day's already is, and thrown away - simpler than asking
    // first, and it cannot re-deal. (Cards never leave a collection, so an account that had a deck has one.)
    if (!deck) return noDeck();
    const { data, error } = await service.rpc("card_daily_deal", { p_user: userId, p_date: date, p_hand: toSql(dealHand(deck, secureRand)) });
    if (error || !data) return refused("card_daily_deal", error);
    return json({ ok: true, date, daily: shownDaily(data) });
  }

  if (body.action === "daily_round") {
    const { data: row, error: rowError } = await service
      .from("card_dailies").select("hand, log, played_at").eq("user_id", userId).eq("date", date).maybeSingle();
    if (rowError) return failed("daily read", rowError);
    if (!row) return json({ error: "no hand has been dealt today", reason: "no_hand" }, 409);
    if (row.played_at) return json({ error: "today's battle is already played", reason: "duplicate" }, 409);
    const log = Array.isArray(row.log) ? row.log : [];
    if (log.length !== body.round) return json({ error: "the battle has moved on", reason: "stale" }, 409);
    const foe = dailyFoe(date);
    const problem = roundProblem(fromSql(row.hand), foe, log, body.card);
    if (problem) return json({ error: "that card cannot be played", reason: problem }, ROUND_STATUS[problem] || 400);
    const round = dailyRound(date, log, body.card);
    const rounds = [...log, round];
    if (rounds.length < 6) {
      const { data, error } = await service.rpc("card_daily_round", { p_user: userId, p_date: date, p_round: body.round, p_card: toSql([body.card]), p_rounds: rounds });
      if (error || !data) return refused("card_daily_round", error);
      return json({ ok: true, date, round, done: false, daily: { hand: fromSql(row.hand), log: rounds, played: false, rounds: null, score: null, shown: null } });
    }
    const result = battleResult(rounds);
    const { rounds: won, score } = dailyScore(result);
    const { data, error } = await service.rpc("card_daily_record", {
      p_user: userId, p_date: date, p_lineup: toSql(playedOf(rounds)), p_rounds: won, p_score: score, p_shown: shownBattle(result, foe, 0),
    });
    if (error || !data) return refused("card_daily_record", error);
    if (data.duplicate) return json({ error: "today's battle is already played", reason: "duplicate" }, 409);
    return json({ ok: true, date, round, done: true, daily: { hand: fromSql(row.hand), log: rounds, played: true, rounds: data.rounds, score: Number(data.score), shown: data.shown } });
  }

  // run_round. The run is read here for its hand, its CPU team, its rounds and the category this round is on,
  // and checked AGAIN under a lock by the function that writes - so two requests that both read "round three"
  // cannot both play it.
  const { data: run, error: runError } = await service
    .from("card_runs").select("id, wins, seed, hand, foe, cats, rounds").eq("user_id", userId).eq("status", "live").maybeSingle();
  if (runError) return failed("run read", runError);
  if (!run) return json({ error: "no run is going", reason: "no_run" }, 409);
  const before = Array.isArray(run.rounds) ? run.rounds : [];
  if (run.id !== body.run || run.wins !== body.step || before.length !== body.round) return json({ error: "the run has moved on", reason: "stale" }, 409);
  const hand = fromSql(run.hand), foe = foeFrom(run.foe);
  const problem = roundProblem(hand, foe, before, body.card);
  if (problem) return json({ error: "that card cannot be played", reason: problem }, ROUND_STATUS[problem] || 400);
  if (!Array.isArray(run.cats) || run.cats.length !== 6) return failed("run cats", "the run has no category order");

  const edge = ladderEdge(run.wins);
  const round = playRound(foe, before, body.card, run.cats[body.round], secureRand, edge);
  const rounds = [...before, round];
  if (rounds.length < 6) {
    const { data, error } = await service.rpc("card_run_round", { p_user: userId, p_run: run.id, p_step: run.wins, p_round: body.round, p_card: toSql([body.card]), p_rounds: rounds });
    if (error || !data) return refused("card_run_round", error);
    return json({ ok: true, round, done: false, run: { id: run.id, wins: run.wins, status: "live", hand, foe, rounds } });
  }

  // The sixth round ends the battle. The next battle's hand and category order are dealt NOW and stored with the
  // win, so they exist before the browser knows it won.
  const result = battleResult(rounds);
  const last = shownBattle(result, foe, edge);
  const { data, error } = await service.rpc("card_run_battle", {
    p_user: userId, p_run: run.id, p_step: run.wins, p_lineup: toSql(playedOf(rounds)), p_win: result.win,
    p_hand: result.win ? toSql(deck ? dealHand(deck, secureRand) : hand) : null,
    p_foe: result.win ? foeSql(ladderFoe(run.seed, run.wins + 1)) : null,
    p_cats: result.win ? shuffleCategories(secureRand) : null,
    p_last: last, p_coins: result.win ? cardWinCoins(run.wins + 1) : 0, p_cap: COIN_RULES.paidCardWinsPerDay,
  });
  if (error || !data) return refused("card_run_battle", error);
  return json({
    ok: true, round, done: true, battle: last,
    run: { id: run.id, wins: data.wins, status: data.status, hand: fromSql(data.hand), foe: foeFrom(data.foe), rounds: [] },
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
