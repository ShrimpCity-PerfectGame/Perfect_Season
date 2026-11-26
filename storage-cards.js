// Cards: what the browser reads and asks for. See CARDS.md.
//
// The browser never writes a card. card_owned and card_grants have an own-rows-only select and no write policy
// (supabase/migration-cards.sql); the card-claim Edge Function and submit-run grant them. So this module is
// reads and requests: the collection, the starter deck, and since v2.24.0 the pack shop.
import { getClient, READ } from "./storage-core.js";

// Every reason card-claim can answer with. tests/test-cards-edge.mjs reads the function's source and fails on
// one that is not here - a reason this list does not know is a rule that would read as "check your connection".
const BATTLE_ACTIONS = ["deck_save", "run_start", "run_round", "run_end", "daily_deal", "daily_round", "sell_copies", "gauntlet_start", "gauntlet_round", "gauntlet_quit"];
const CARD_PAGE = 1000; // PostgREST's default ceiling on one select
export const CARD_REFUSALS = ["signed_out", "no_profile", "guest_not_allowed", "cards_off", "duplicate", "malformed", "server",
  "unknown_pack", "bad_open", "unavailable", "sold_out", "price_changed", "not_enough",
  // battles (v2.27.0): a deck's and a team's own reasons out of card-logic.mjs, a run's, and the daily battle's
  "incomplete", "unknown_card", "bad_finish", "bad_slot", "same_player", "not_owned", "no_run", "stale",
  "bad_deck", "no_deck", "not_in_hand", "no_hand", "already_played",
  // the call (v2.31.0): on your call, a category that is missing, made up or already used
  "bad_cat",
  // the gauntlet (v2.29.0)
  "locked", "no_battle"];

// Is the signed-in account on the testers' list (card_testers, v2.32.0)? Asked only where the build is set to
// "testers" (cards-switch.mjs). TWO answers on purpose, and a failed read is "no": this decides whether a tile
// is DRAWN and nothing else - what is granted is the server's decision, made from the same table with the
// service role - so the cost of a wrong "no" is a tester reloading, and a wrong "yes" would cost nothing either.
export async function fetchCardTester() {
  try {
    const client = getClient();
    const { data: sessionData } = await client.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) return false;
    const { data, error } = await client.from("card_testers").select("user_id").eq("user_id", uid).maybeSingle();
    return !error && !!data;
  } catch {
    return false;
  }
}

// A player's collection, and whether they have claimed their starter deck.
//   { status: "ok", cards: [{ id, finish, count }], starter: boolean }
//   { status: "signed_out" }
//   { status: "error" }
// THREE answers, and the third matters most: a read that failed is not an empty collection. Collapsing the two
// would show a player who owns fifty cards an invitation to open a starter deck they opened last week.
export async function fetchMyCards() {
  try {
    const client = getClient();
    const { data: sessionData } = await client.auth.getSession();
    const uid = sessionData?.session?.user?.id;
    if (!uid) return { status: "signed_out" };
    // PAGED. PostgREST answers a select with at most 1,000 rows however many match, and a collection can hold
    // up to 3,124 cards in four finishes - so one unpaged read would silently truncate a large collection and
    // still call itself ok. Ordered, so the pages are pages of one list; the starter question rides with the first.
    const page = (from) => client.from("card_owned").select("card_id, finish, count").eq("user_id", uid)
      .order("card_id").order("finish").range(from, from + CARD_PAGE - 1);
    const [first, starter] = await Promise.all([
      page(0),
      client.from("card_grants").select("ref").eq("user_id", uid).eq("kind", "starter").limit(1),
    ]);
    if (first.error || starter.error || !Array.isArray(first.data) || !Array.isArray(starter.data)) return { status: "error" };
    const rows = first.data.slice();
    for (let from = CARD_PAGE, last = first.data; last.length === CARD_PAGE && from < CARD_PAGE * 20; from += CARD_PAGE) {
      const next = await page(from);
      // A page that fails makes the whole read a failure. Half a collection is not a collection.
      if (next.error || !Array.isArray(next.data)) return { status: "error" };
      rows.push(...next.data);
      last = next.data;
    }
    return {
      status: "ok",
      cards: rows.map((r) => ({ id: r.card_id, finish: r.finish, count: r.count })),
      starter: starter.data.length > 0,
    };
  } catch {
    return { status: "error" };
  }
}

// Claim the starter deck: { ok: true, cards: [{ id, finish }] } or { ok: false, reason }.
// A reason is one of CARD_REFUSALS, or - when the function was never reached or its answer cannot be read -
// "offline" (nothing came back) or "network" (something did, and it names no reason this client knows).
export async function claimStarter() {
  const res = await callClaim({ action: "starter" });
  return res.ok ? { ok: true, cards: res.data.cards } : res;
}

// One request to card-claim, and the three kinds of failure told apart: { ok: true, data } or { ok: false, reason }.
async function callClaim(body) {
  const failed = (reason) => ({ ok: false, reason });
  try {
    const { data, error } = await getClient().functions.invoke("card-claim", { body });
    if (error) {
      let said = null;
      try { said = await error.context?.json?.(); } catch { said = null; }
      if (!said) return failed("offline");
      if (CARD_REFUSALS.includes(said.reason)) return failed(said.reason);
      return failed(said.reason ? "network" : "server");
    }
    if (data?.ok === true && (Array.isArray(data.cards) || BATTLE_ACTIONS.includes(body?.action))) return { ok: true, data };
    return failed("server");
  } catch {
    return failed("offline");
  }
}

// ---------- battles (v2.27.0: offense against offense, CARDS.md 11) ----------
// The database says { card, finish }; the rules and the screens say { id, finish }.
const fromSql = (list) => (Array.isArray(list) ? list.map((e) => ({ id: e.card, finish: e.finish })) : []);
// A CPU card keeps the spot it plays: the order of the other side's spots is the order of a battle's rounds.
// A card not yet played arrives as its spot alone (v2.28.1): their card is a surprise until yours is down.
const foeFrom = (list) => (Array.isArray(list) ? list.map((e) => (e.card == null ? { spot: e.spot } : { id: e.card, finish: e.finish, spot: e.spot })) : []);
const dailyOf = (d) => (d ? { hand: Array.isArray(d.hand) && d.hand[0] && "card" in d.hand[0] ? fromSql(d.hand) : d.hand || [], log: Array.isArray(d.log) ? d.log : [], played: d.played === true, rounds: d.rounds ?? null, score: d.score == null ? null : Number(d.score), shown: d.shown ?? null } : null);

// What the battle screens open on:
//   { status: "ok", today, deck: [{ id, finish }] | null,
//     run: { id, wins, status, hand, foe, rounds, last } | null, best, paidToday,
//     daily: { hand, log, played, rounds, score, shown } | null }
// run.rounds and daily.log are the rounds of the battle IN PROGRESS, played so far.
//   { status: "signed_out" } | { status: "error" }
// `run` is the account's LATEST run, live or over. Three answers, for the reason fetchMyCards has three: a read
// that failed is not "no run going" - saying so would offer to start a run over the top of one already live.
export async function fetchBattleState() {
  try {
    const client = getClient();
    const { data: sessionData } = await client.auth.getSession();
    if (!sessionData?.session?.user?.id) return { status: "signed_out" };
    const { data, error } = await client.rpc("card_battle_state", {}, READ);
    if (error || !data || typeof data !== "object" || typeof data.today !== "string") return { status: "error" };
    return {
      status: "ok", today: data.today, deck: data.deck ? fromSql(data.deck) : null,
      run: data.run ? { ...data.run, hand: fromSql(data.run.hand), foe: foeFrom(data.run.foe), rounds: Array.isArray(data.run.rounds) ? data.run.rounds : [] } : null,
      best: Number(data.best) || 0, paidToday: Number(data.paid_today) || 0, daily: dailyOf(data.daily),
      // The gauntlet: stages cleared, the attempt in progress (stage null when there is none), the last one finished.
      gauntlet: data.gauntlet
        ? { cleared: Number(data.gauntlet.cleared) || 0, stage: data.gauntlet.stage ?? null, hand: fromSql(data.gauntlet.hand), rounds: Array.isArray(data.gauntlet.rounds) ? data.gauntlet.rounds : [], last: data.gauntlet.last ?? null, lastStage: data.gauntlet.last_stage ?? null }
        : { cleared: 0, stage: null, hand: [], rounds: [], last: null, lastStage: null },
    };
  } catch {
    return { status: "error" };
  }
}

// The card area's two boards: { status: "ok", today, runs: [{ username, wins }], daily: [{ username, rounds, score }] }
// or { status: "error" }.
export async function fetchCardBoards(limit = 25) {
  try {
    const { data, error } = await getClient().rpc("card_boards", { p_limit: limit }, READ);
    if (error || !data || !Array.isArray(data.runs) || !Array.isArray(data.daily)) return { status: "error" };
    return { status: "ok", today: data.today, runs: data.runs, daily: data.daily.map((r) => ({ ...r, score: Number(r.score) })), gauntlet: Array.isArray(data.gauntlet) ? data.gauntlet : [] };
  } catch {
    return { status: "error" };
  }
}

// The things a player DOES in a battle. Each answers { ok: true, ...what the function said } or
// { ok: false, reason }. "offline", "network" and "server" mean the outcome is UNKNOWN: the battle may have
// been played and its answer lost. Nothing is ever replayed to find out - the screen reads fetchBattleState,
// which says where things really stand and carries the latest battle.
const battleCall = async (body) => { const res = await callClaim(body); return res.ok ? { ...res.data, ok: true } : res; };
export const saveDeck = (cards) => battleCall({ action: "deck_save", cards });
export const startRun = () => battleCall({ action: "run_start" });
// `cat` is the category you call. It counts only when the call is yours; send it anyway - the function ignores
// it on theirs, and a missing one on yours is refused (bad_cat).
export const playRound = (run, step, round, card, cat) => battleCall({ action: "run_round", run, step, round, card, cat });
export const endRun = () => battleCall({ action: "run_end" });
export const dealDaily = () => battleCall({ action: "daily_deal" });
export const playDailyRound = (round, card, cat) => battleCall({ action: "daily_round", round, card, cat });
export const startGauntlet = (stage) => battleCall({ action: "gauntlet_start", stage });
export const playGauntletRound = (stage, round, card, cat) => battleCall({ action: "gauntlet_round", stage, round, card, cat });
export const quitGauntlet = () => battleCall({ action: "gauntlet_quit" });

// Sell every copy past the first: { ok: true, copies, coins, balance } or { ok: false, reason }. Safe to ask
// again after an answer that never came - a copy already sold is not there to sell twice.
export const sellCopies = () => battleCall({ action: "sell_copies" });

// What the pack shop is selling: { status: "ok", packs: [{ id, price, size, active, stockTotal, stockLeft }] }
// in shelf order, or { status: "error" }. Prices are public, so this works signed out. What is IN a pack is not
// here - that is card-packs.mjs, which the screen already holds.
export async function fetchPacks() {
  try {
    const { data, error } = await getClient().from("card_packs")
      .select("id, price, size, active, stock_total, stock_left, sort").order("sort").order("id");
    if (error || !Array.isArray(data)) return { status: "error" };
    return {
      status: "ok",
      packs: data.map((r) => ({ id: r.id, price: r.price, size: r.size, active: r.active === true, stockTotal: r.stock_total ?? null, stockLeft: r.stock_left ?? null })),
    };
  } catch {
    return { status: "error" };
  }
}

// An id for ONE purchase. The screen makes it when the player confirms and keeps it until the purchase is
// answered, so asking again after a dropped response re-sends the same id - and buy_pack answers a repeat with
// the cards from the first time and charges nothing. A fresh id per attempt would turn a retry into a second pack.
export function newOpenId() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* fall through */ }
  let out = "";
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

// Buy and open a pack: { ok: true, cards: [{ id, finish }], balance, stockLeft, duplicate } or { ok: false, reason }.
// "offline" and "network" mean the answer is UNKNOWN, not no: the purchase may have gone through. Ask again with
// the same openId to find out.
// `price` is the price the screen SHOWED; a pack that has become dearer since is refused, never charged.
export async function openPack(packId, openId, price) {
  const res = await callClaim({ action: "open_pack", pack: packId, open: openId, price });
  if (!res.ok) return res;
  const d = res.data;
  if (typeof d.balance !== "number") return { ok: false, reason: "server" };
  return { ok: true, cards: d.cards, balance: d.balance, stockLeft: d.stockLeft ?? null, duplicate: d.duplicate === true, badge: d.badge ?? null };
}
