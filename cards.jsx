// The card area: your starter deck, your collection, and the pack shop. See CARDS.md.
//
// A screen in its own file, like century.jsx and shop.jsx: it styles only its own cd- prefix (the card face's
// stylesheet rides along), reuses the app's .btn / .note / .panel, and never imports perfect-season.jsx back.
//
// ONE STATE ON SCREEN AT A TIME, and the list is the design:
//   loading      the catalog and the collection are being fetched
//   error        one of them could not be - "Couldn't load your cards." and Try again
//   account      signed out, or a guest: cards are for accounts
//   starter      an account that has not opened its starter deck
//   collection   the cards
// An account also gets two tabs, Collection and Packs. The pack shop (PackShop, below) has the same three-way
// honesty about its own read: loading, could-not-load, and the shelf.
// `error` is its own state on purpose. A read that failed is not an empty collection: collapsing the two would
// offer a player with fifty cards a starter deck they opened last week (storage-cards.js says the same).
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMyCards, claimStarter, CARD_REFUSALS, fetchPacks, openPack, newOpenId, fetchWallet } from "./storage.js";
import { loadCardData } from "./card-data.mjs";
import { CARDS, FINISHES } from "./card-logic.mjs";
import { TEAMS } from "./game-logic.mjs";
import { PACKS, packCards, packOdds } from "./card-packs.mjs";
import { Coins } from "./cosmetics.jsx";
import { packArt } from "./card-sprites.mjs";
import { CardFace, CARD_FACE_CSS } from "./card-face.jsx";
import { BattleArea, CARD_BATTLE_CSS, LINEUP_SENTENCES } from "./card-battle.jsx";

// Every reason claimStarter can answer with, as a sentence. A reason missing from here would reach the player
// as nothing at all, so tests/test-cards-screen.mjs holds this to CARD_REFUSALS plus the two the client adds.
export const CARD_SENTENCES = {
  signed_out: "You've been signed out. Sign in again and your starter deck is one tap away.",
  no_profile: "This account hasn't picked a name yet. Pick one and your starter deck is waiting.",
  guest_not_allowed: "Cards are for accounts. Keep your seasons from the Account tab and they open up.",
  cards_off: "Cards aren't switched on here yet.",
  duplicate: "You've already opened your starter deck.",
  malformed: "That didn't go through. Reload the page and try again.",
  server: "Something went wrong on our side and your deck wasn't opened. Try again in a moment.",
  offline: "Couldn't reach the server, so your deck wasn't opened. Check your connection and try again.",
  network: "That didn't go through. Reload the page and try again.",
  unknown_pack: "That pack isn't one this version of the game knows. Reload the page and look again.",
  bad_open: "That didn't go through. Reload the page and try again.",
  unavailable: "That pack isn't on sale right now. Nothing was charged.",
  sold_out: "That pack has sold out. Nothing was charged.",
  price_changed: "That pack's price has gone up since this page loaded. Nothing was charged.",
  not_enough: "You don't have enough coins for that pack. Nothing was charged.",
  // A lineup's and a run's refusals (card-battle.jsx, which says them on its own screens).
  ...LINEUP_SENTENCES,
};
export const CARD_SENTENCE_KEYS = [...CARD_REFUSALS, "offline", "network"];

// The same reasons, as the PACK SHOP says them. Most are CARD_SENTENCES' own; the ones below are about a deck
// there and a purchase here. Three of them - offline, network and server - mean the answer is UNKNOWN, not no:
// the pack may have been bought and its answer lost. The screen keeps that purchase's open id, so trying again
// asks about the SAME purchase, and the sentence may promise "never charged twice" because buy_pack keeps it.
const UNKNOWN_OUTCOME = "We couldn't confirm that purchase. Try again: if the pack was already bought you'll get those same cards, and you are never charged twice.";
export const PACK_SENTENCES = {
  ...CARD_SENTENCES,
  signed_out: "You've been signed out. Sign in again to open packs. Nothing was charged.",
  no_profile: "This account hasn't picked a name yet. Pick one and the pack shop opens. Nothing was charged.",
  guest_not_allowed: "Packs are for accounts. Keep your seasons from the Account tab and they open up.",
  duplicate: "That pack was already opened.",
  server: UNKNOWN_OUTCOME,
  offline: UNKNOWN_OUTCOME,
  network: UNKNOWN_OUTCOME,
};
const OUTCOME_UNKNOWN = ["server", "offline", "network"];
// The refusals buy_pack itself makes. They are certain EVEN ON A RETRY, because buy_pack looks for an earlier
// charge under the same open id before it refuses anything: reaching one of these means there was none.
const CERTAIN_NO = ["unavailable", "sold_out", "price_changed", "not_enough"];
// Every other refusal is made before the database is asked (signed out, the switch off...). On a first attempt
// that is a plain no. On a RETRY of a purchase whose outcome is unknown it settles nothing - the first attempt
// may have been charged - so the screen keeps the purchase's id and must not say "nothing was charged".
const STILL_UNKNOWN = "We still can't confirm that earlier purchase, so it is being kept to try again. ";

const FINISH_NAME = { base: "Base", silver: "Silver", gold: "Gold", prism: "Prism" };
// A chance as a player reads it: "12%", "1.4%", "0.046%". Two figures below one percent, so a rare card never
// rounds to a zero it is not.
export function chanceText(chance) {
  const pct = chance * 100;
  if (pct >= 10) return `${Math.round(pct)}%`;
  if (pct >= 1) return `${pct.toFixed(1)}%`;
  if (pct <= 0) return "0%";
  return `${Number(pct.toPrecision(2))}%`;
}
const BANDS = [[120, "Rated 120 or better"], [100, "Rated 100 to 119"], [80, "Rated 80 to 99"], [60, "Rated 60 to 79"], [-Infinity, "Rated under 60"]];
// What "Who is inside" prints for a pack: the chance of each finish, the chance of each rating band, and every
// card with its own chance, most likely LAST - the list opens on the cards people are hoping for.
function packContents(pack) {
  const odds = packOdds(pack);
  const bands = BANDS.map(([min, label], i) => {
    const max = i === 0 ? Infinity : BANDS[i - 1][0];
    const inBand = odds.filter((o) => { const r = CARDS.get(o.id).rating; return r >= min && r < max; });
    return { label, count: inBand.length, chance: inBand.reduce((s, o) => s + o.chance, 0) };
  }).filter((b) => b.count > 0);
  const cards = odds.map((o) => ({ ...o, card: CARDS.get(o.id) })).sort((a, b) => b.card.rating - a.card.rating || a.id - b.id);
  return { bands, cards, finishes: FINISHES.filter((f) => pack.finish[f] > 0).map((f) => ({ name: FINISH_NAME[f], chance: pack.finish[f] })) };
}
const SHOWN_FIRST = 12;

// The pack shop. `balance` is the wallet the app already holds (null while unknown); `onBalance` hands back a
// balance just learned; `onOpened` tells the card area its collection may have grown. `pendingRef` is the card
// area's: a Map of pack id -> { id, price }, the purchases sent and not yet answered for certain. It lives
// ABOVE this component because the first thing a player does after "we couldn't confirm that" is look at the
// Collection tab, which unmounts the shop - and an id that died with it would make Try again a second purchase.
// It is one entry PER PACK for the same reason: buying a different pack must not forget the first one's id.
export function PackShop({ balance, onBalance, onOpened, pendingRef }) {
  const [shelf, setShelf] = useState(null); // null: loading. "error". Or [{ id, price, ... }]
  const [inside, setInside] = useState(null); // the pack whose contents are open
  const [all, setAll] = useState(false); // every card listed, rather than the first few
  const [asking, setAsking] = useState(null); // the pack waiting on Confirm
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null); // { pack, text }
  const [pulled, setPulled] = useState(null); // { pack, cards, again }
  const own = useRef(new Map());
  const pending = (pendingRef || own).current;
  const pulledRef = useRef(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const loadShelf = useCallback(async () => {
    setShelf(null);
    const got = await fetchPacks();
    if (!live.current) return;
    setShelf(got.status === "ok" ? got.packs : "error");
  }, []);
  useEffect(() => { loadShelf(); }, [loadShelf]);
  // The wallet, asked for here. The app only reads it when a profile or the shop is opened, so a player coming
  // straight from Modes would otherwise see no balance and an Open button on a pack they cannot afford.
  const readWallet = useCallback(async () => {
    const w = await fetchWallet();
    if (w && typeof w.balance === "number") onBalance?.(w.balance);
  }, [onBalance]);
  useEffect(() => { readWallet(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pulled) pulledRef.current?.focus(); }, [pulled]);

  async function buy(pack, row) {
    if (busy) return;
    const retry = pending.has(pack.id);
    if (!retry) pending.set(pack.id, { id: newOpenId(), price: row.price });
    const mine = pending.get(pack.id);
    setBusy(true); setNotice(null); setAsking(pack.id);
    const res = await openPack(pack.id, mine.id, mine.price);
    // What the purchase changed is the card area's and the app's to know WHETHER OR NOT this shop is still on
    // screen - a player who taps Collection while a pack is opening has still bought it.
    if (res.ok) {
      pending.delete(pack.id);
      onBalance?.(res.balance);
      onOpened?.();
      if (!live.current) return;
      setBusy(false);
      setAsking(null);
      const cards = toCards(res.cards.map((c) => ({ ...c, count: 1 })));
      setPulled({ pack, cards, again: res.duplicate, missing: cards.length < res.cards.length });
      setShelf((s) => (Array.isArray(s) ? s.map((r) => (r.id === pack.id ? { ...r, stockLeft: res.stockLeft } : r)) : s));
      return;
    }
    const unknown = OUTCOME_UNKNOWN.includes(res.reason) || !PACK_SENTENCES[res.reason];
    const certain = CERTAIN_NO.includes(res.reason) || (!retry && !unknown);
    if (certain) pending.delete(pack.id);
    else { onOpened?.(); readWallet(); } // it may have gone through: let the collection and the wallet say
    if (!live.current) return;
    setBusy(false);
    if (certain) setAsking(null);
    setNotice({
      pack: pack.id,
      text: unknown ? UNKNOWN_OUTCOME : certain ? PACK_SENTENCES[res.reason] : STILL_UNKNOWN + PACK_SENTENCES[res.reason].replace(/\s*Nothing was charged\./, ""),
    });
    // The shelf is what was wrong about these three: read it again so the screen stops offering what it cannot sell.
    if (["price_changed", "sold_out", "unavailable"].includes(res.reason)) {
      const got = await fetchPacks();
      if (live.current && got.status === "ok") setShelf(got.packs);
    }
    if (res.reason === "not_enough") readWallet(); // the balance on screen was wrong about this
  }

  if (shelf === null) return <p className="note" role="status">Loading the pack shop…</p>;
  if (shelf === "error") {
    return (
      <div className="panel" role="alert">
        <p><b>Couldn't load the pack shop.</b> This is a connection problem — nothing has been bought.</p>
        <button className="btn" onClick={loadShelf}>Try again</button>
      </div>
    );
  }
  const rows = new Map(shelf.map((r) => [r.id, r]));
  const onSale = PACKS.filter((p) => rows.get(p.id)?.active);

  return (
    <div className="cd-shop">
      <h2 className="cd-h cd-shop-h">Pack shop</h2>
      {balance != null && <p className="cd-bal"><span>Your coins</span> <Coins amount={balance} size={18} /></p>}
      {pulled && (
        <section className="cd-fresh" aria-labelledby="cd-pulled-h">
          <h2 className="cd-h" id="cd-pulled-h" tabIndex={-1} ref={pulledRef}>You pulled</h2>
          {pulled.again && <p className="note">This pack was already bought — here are its cards again. You weren't charged twice.</p>}
          {pulled.missing && <p className="note">Some of these cards can't be shown because this page is out of date. They are yours — reload to see them.</p>}
          <div className="cd-grid">
            {pulled.cards.map((r) => <CardFace key={`p${r.id}:${r.finish}`} card={r.card} finish={r.finish} />)}
          </div>
        </section>
      )}
      {onSale.length === 0 && <p className="note">No packs are on sale right now.</p>}
      <ul className="cd-packs">
        {onSale.map((pack) => {
          const row = rows.get(pack.id);
          const soldOut = row.stockLeft != null && row.stockLeft <= 0;
          const short = balance != null && balance < row.price ? row.price - balance : 0;
          const waiting = pending.has(pack.id); // sent, and not answered for certain
          const isAsking = asking === pack.id || waiting;
          const open = inside === pack.id;
          const contents = open ? packContents(pack) : null;
          return (
            <li key={pack.id} className="cd-pack" data-pack={pack.id}>
              <img className="cd-pack-art" src={packArt(pack)} alt="" width="122" height="200" loading="lazy" />
              <div className="cd-pack-body">
                <h3 className="cd-pack-h">{pack.name}</h3>
                <p className="cd-pack-blurb">{pack.blurb}</p>
                <p className="cd-pack-price"><Coins amount={row.price} size={16} />
                  <span className="cd-pack-size"> · {pack.size} {pack.size === 1 ? "card" : "cards"}</span></p>
                {row.stockLeft != null && (
                  <p className="cd-pack-stock">{soldOut ? "Sold out" : `${row.stockLeft.toLocaleString("en-US")} of ${row.stockTotal.toLocaleString("en-US")} left`}</p>
                )}
                <div className="cd-pack-acts">
                  {/* ONE button through Open, Confirm and Try again, so the keyboard's focus stays on it as its
                      label changes. Two buttons swapped in and out dropped focus to the page at every step. */}
                  <button className="btn solid" data-buy disabled={busy || (!isAsking && (soldOut || short > 0))}
                    onClick={() => { if (isAsking) buy(pack, row); else { setAsking(pack.id); setNotice(null); } }}>
                    {!isAsking ? (soldOut ? "Sold out" : "Open")
                      : busy && asking === pack.id ? "Opening…"
                      : waiting ? "Try again"
                      : `Confirm: ${row.price.toLocaleString("en-US")} coins`}
                  </button>
                  {/* No Cancel on a purchase that may already have happened: it cannot be cancelled, only asked about. */}
                  {isAsking && !waiting && (
                    <button className="btn" disabled={busy} onClick={(e) => {
                      const main = e.currentTarget.parentElement.querySelector("[data-buy]");
                      setAsking(null); setNotice(null); main?.focus();
                    }}>Cancel</button>
                  )}
                  <button className="linkbtn" aria-expanded={open} aria-controls={open ? `cd-in-${pack.id}` : undefined}
                    onClick={() => { setInside(open ? null : pack.id); setAll(false); }}>Who is inside</button>
                </div>
                {short > 0 && !soldOut && <p className="note">You need {short.toLocaleString("en-US")} more coins.</p>}
                {/* A purchase still waiting says so even when the notice that first said it is gone - the shop
                    was left and come back to - or "Try again" would be a button with no reason beside it. */}
                {(notice?.pack === pack.id || waiting) && <p className="note" role="alert">{notice?.pack === pack.id ? notice.text : UNKNOWN_OUTCOME}</p>}
              </div>
              {open && (
                <div className="cd-inside" id={`cd-in-${pack.id}`} tabIndex={-1}>
                  <p className="cd-inside-lead">{contents.cards.length.toLocaleString("en-US")} cards can come out of this pack. Each card in it is drawn on its own,
                    and its finish is rolled separately. No two cards in one pack are the same.</p>
                  <div className="cd-odds">
                    <table>
                      <caption>Finish of each card</caption>
                      <thead><tr><th scope="col">Finish</th><th scope="col">Chance</th></tr></thead>
                      <tbody>{contents.finishes.map((f) => <tr key={f.name}><th scope="row">{f.name}</th><td>{chanceText(f.chance)}</td></tr>)}</tbody>
                    </table>
                    <table>
                      <caption>Rating of each card</caption>
                      <thead><tr><th scope="col">Cards</th><th scope="col">Chance</th></tr></thead>
                      <tbody>{contents.bands.map((b) => <tr key={b.label}><th scope="row">{b.label} <span className="cd-n">({b.count.toLocaleString("en-US")})</span></th><td>{chanceText(b.chance)}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <table className="cd-list">
                    <caption>Every card, best first — the chance that any one card in the pack is this one</caption>
                    <thead><tr><th scope="col">Card</th><th scope="col">Rating</th><th scope="col">Chance</th></tr></thead>
                    <tbody>
                      {(all ? contents.cards : contents.cards.slice(0, SHOWN_FIRST)).map((o) => (
                        <tr key={o.id}><th scope="row">{o.card.name} <span className="cd-n">{o.card.season} {o.card.team} {o.card.pos}</span></th><td>{Math.round(o.card.rating)}</td><td>{chanceText(o.chance)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {!all && contents.cards.length > SHOWN_FIRST && (
                    <button className="linkbtn" onClick={(e) => { const box = e.currentTarget.closest(".cd-inside"); setAll(true); box?.focus(); }}>Show all {contents.cards.length.toLocaleString("en-US")} cards</button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const POSITIONS = ["All", "QB", "RB", "WR", "TE"];
const FINISH_ORDER = { prism: 0, gold: 1, silver: 2, base: 3 };
// Owned rows as cards to draw: best first. A row whose card is not in the catalog this browser loaded is
// skipped rather than drawn as a blank - it means the catalog is older than the collection, and the rest of the
// collection is still worth showing.
function toCards(rows) {
  return rows.map((r) => ({ ...r, card: CARDS.get(r.id) })).filter((r) => r.card)
    .sort((a, b) => b.card.rating - a.card.rating || FINISH_ORDER[a.finish] - FINISH_ORDER[b.finish] || a.id - b.id);
}

const TABS = [["collection", "Collection"], ["packs", "Packs"], ["run", "Run"], ["showdown", "Showdown"], ["boards", "Boards"]];
// initialTab is the UI harness's, so the pack shop and the battle screens can be looked at and audited without a click.
export function CardsScreen({ userId, isGuest, onBack, onNeedsAccount, onHide, balance = null, onBalance, initialTab = "collection" }) {
  const [phase, setPhase] = useState("loading");
  const [tab, setTab] = useState(TABS.some(([id]) => id === initialTab) ? initialTab : "collection");
  const [owned, setOwned] = useState([]);
  const [fresh, setFresh] = useState(null); // the eight just dealt, shown once above the collection
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pos, setPos] = useState("All");
  const [fin, setFin] = useState("All");   // a finish, or "All"
  const [team, setTeam] = useState("All"); // a team code, or "All"
  const [stale, setStale] = useState(false); // an owned card this page's catalog does not know
  const pendingBuys = useRef(new Map()); // PackShop's unanswered purchases - held here so a tab switch keeps them

  // ONLY THE LATEST LOAD MAY SPEAK. Whether an account is a guest arrives a beat after its id does, so a load
  // can start as "not a guest", be superseded by one that knows better, and then finish - and without this it
  // came back and offered a guest a starter deck over the top of "cards are for accounts". Each load takes a
  // number and checks it is still the newest before it sets anything; unmounting retires them all.
  const latest = useRef(0);
  // `quiet` re-reads the collection WITHOUT passing through "loading" - for after a pack is opened, when the
  // shop is on screen and must stay there. A quiet read that fails changes nothing: what is shown is still true.
  const load = useCallback(async (quiet = false) => {
    const mine = ++latest.current;
    const current = () => latest.current === mine;
    if (!userId || isGuest) { setPhase("account"); return; }
    if (quiet === true) {
      try {
        const got = await fetchMyCards();
        if (!current() || got.status !== "ok") return;
        const cards = toCards(got.cards);
        setOwned(cards); setStale(cards.length < got.cards.length);
        setPhase(got.starter ? "collection" : "starter");
      } catch { /* what is on screen stays */ }
      return;
    }
    setPhase("loading");
    try {
      const [, got] = await Promise.all([loadCardData(), fetchMyCards()]);
      if (!current()) return;
      if (got.status === "signed_out") { setPhase("account"); return; }
      if (got.status !== "ok") { setPhase("error"); return; }
      const cards = toCards(got.cards);
      setOwned(cards);
      setStale(cards.length < got.cards.length);
      setPhase(got.starter ? "collection" : "starter");
    } catch {
      if (current()) setPhase("error");
    }
  }, [userId, isGuest]);
  useEffect(() => { load(); return () => { latest.current++; }; }, [load]);

  async function openStarter() {
    if (busy) return;
    setBusy(true); setNotice("");
    const res = await claimStarter();
    setBusy(false);
    if (res.ok) {
      setFresh(toCards(res.cards.map((c) => ({ ...c, count: 1 }))));
      await load();
      return;
    }
    // Already opened - from another tab, or a request that landed after all. The deck is there: show it.
    if (res.reason === "duplicate") { await load(); return; }
    setNotice(CARD_SENTENCES[res.reason] || CARD_SENTENCES.network);
  }

  // The three filters narrow together. The team list is the teams actually in the collection, so no choice
  // in it can come back empty by itself - and a team that has left the collection falls back to All.
  const teams = [...new Set(owned.map((r) => r.card.team))].sort();
  const teamOn = teams.includes(team) ? team : "All";
  const shown = owned.filter((r) => (pos === "All" || r.card.pos === pos) && (fin === "All" || r.finish === fin) && (teamOn === "All" || r.card.team === teamOn));
  const filtered = pos !== "All" || fin !== "All" || teamOn !== "All";
  const total = owned.reduce((n, r) => n + r.count, 0);

  return (
    <div className="cd-area">
      <div className="cd-top">
        <button className="btn sm" onClick={onBack}>All modes</button>
        {onHide && <button className="linkbtn" onClick={onHide}>Hide cards</button>}
      </div>

      {phase === "loading" && <p className="note" role="status">Loading your cards…</p>}
      {/* A card this page's catalog does not know is one a newer build added. Say so: silently leaving it out
          reads as a card that went missing, and with nothing else owned it would read as "No cards yet". */}
      {stale && (phase === "collection" || phase === "starter") && (
        <p className="note" role="status">Some of your cards can't be shown because this page is out of date. Reload to see them all.</p>
      )}

      {phase === "error" && (
        <div className="panel" role="alert">
          <p><b>Couldn't load your cards.</b> Nothing is lost — this is a connection problem, not an empty collection.</p>
          <button className="btn" onClick={() => load()}>Try again</button>
        </div>
      )}

      {(phase === "collection" || phase === "starter") && (
        <div className="cd-tabs" role="group" aria-label="Cards">
          {/* Coming back to the collection re-reads it, quietly: a pack opened a moment ago - or one whose answer
              was lost - is in it by now, and the read made at the time may have failed. */}
          {TABS.map(([id, name]) => (
            <button key={id} className="cd-chip" data-tab={id} aria-pressed={tab === id}
              onClick={() => { if (tab !== id) { setTab(id); if (id === "collection") load(true); } }}>{name}</button>
          ))}
        </div>
      )}
      {(phase === "collection" || phase === "starter") && tab === "packs" && (
        <PackShop balance={balance} onBalance={onBalance} onOpened={() => load(true)} pendingRef={pendingBuys} />
      )}

      {(phase === "collection" || phase === "starter") && (tab === "run" || tab === "showdown" || tab === "boards") && (
        <BattleArea mode={tab} rows={owned} onBalance={onBalance} />
      )}

      {phase === "account" && (
        <div className="panel">
          <h2 className="cd-h">Cards are for accounts</h2>
          <p>Collect real player seasons, one a day for finishing the daily draft. {isGuest
            ? "A guest account can be made again and again, so cards wait for a real one — keep your seasons from the Account tab and they open up."
            : "Sign in or make an account and your starter deck is waiting."}</p>
          <button className="btn solid" onClick={() => onNeedsAccount?.(isGuest ? "guest" : "signed_out")}>{isGuest ? "Keep my seasons" : "Sign in"}</button>
        </div>
      )}

      {phase === "starter" && tab === "collection" && (
        <div className="panel cd-starter">
          <h2 className="cd-h">Your starter deck</h2>
          <p>Eight cards to get you going: a quarterback, a back, a receiver, a tight end and four more. After that, finishing
            the daily draft earns you one card a day.</p>
          <button className="btn solid xl" onClick={openStarter} disabled={busy}>{busy ? "Opening…" : "Open your starter deck"}</button>
          {notice && <p className="note" role="alert">{notice}</p>}
        </div>
      )}

      {/* The collection also shows under the starter panel when there is anything in it: a player can earn a
          daily card before ever opening the deck, and a card they were just shown must not then be missing. */}
      {tab === "collection" && (phase === "collection" || (phase === "starter" && owned.length > 0)) && (
        <>
          {fresh && fresh.length > 0 && (
            <section className="cd-fresh" aria-labelledby="cd-fresh-h">
              <h2 className="cd-h" id="cd-fresh-h">Your starter deck</h2>
              <div className="cd-grid">
                {fresh.map((r) => <CardFace key={`f${r.id}:${r.finish}`} card={r.card} finish={r.finish} />)}
              </div>
            </section>
          )}
          <section aria-labelledby="cd-coll-h">
            <h2 className="cd-h" id="cd-coll-h">{total} {total === 1 ? "card" : "cards"}</h2>
            <div className="cd-filter" role="group" aria-label="Show a position">
              {POSITIONS.map((p) => (
                <button key={p} className="cd-chip" aria-pressed={pos === p} onClick={() => setPos(p)}>{p}</button>
              ))}
            </div>
            <div className="cd-filter" role="group" aria-label="Show a finish">
              {["All", ...FINISHES].map((f) => (
                <button key={f} className="cd-chip" data-finish-filter={f} aria-pressed={fin === f} onClick={() => setFin(f)}>{f === "All" ? "Any finish" : FINISH_NAME[f]}</button>
              ))}
            </div>
            {teams.length > 1 && (
              <label className="cd-team">
                <span>Team</span>
                <select value={teamOn} onChange={(e) => setTeam(e.target.value)} data-team-filter>
                  <option value="All">Every team</option>
                  {teams.map((t) => <option key={t} value={t}>{TEAMS[t] ? `${TEAMS[t][1]} ${TEAMS[t][0]}` : t}</option>)}
                </select>
              </label>
            )}
            {filtered && shown.length > 0 && <p className="note" data-shown>Showing {shown.reduce((n, r) => n + r.count, 0)} of {total}.</p>}
            {shown.length === 0
              ? <p className="note">{owned.length === 0 ? (stale ? "Reload the page to see your cards." : "No cards yet. Finish today's daily draft to earn one.") : (fin === "All" && teamOn === "All" ? `No ${pos} cards yet.` : "No cards match those filters.")}</p>
              : (
                <div className="cd-grid">
                  {shown.map((r) => <CardFace key={`${r.id}:${r.finish}`} card={r.card} finish={r.finish} count={r.count} />)}
                </div>
              )}
          </section>
        </>
      )}
    </div>
  );
}

// The card a finished daily draft earned, on the result screen. Deliberately small and deliberately late: it
// loads the catalog itself and draws NOTHING until it has, so it can never delay or cover the result it sits
// under. A card the catalog does not know (a stale cached file) is likewise nothing rather than a blank.
export function SeasonCard({ card, onOpenCards }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    loadCardData().then(() => { if (live) setReady(true); }, () => {});
    return () => { live = false; };
  }, []);
  const known = ready && card ? CARDS.get(card.id) : null;
  if (!known) return null;
  return (
    <section className="cd-earned" aria-labelledby="cd-earned-h">
      <h3 className="cd-earned-h" id="cd-earned-h">Today's card</h3>
      <CardFace card={known} finish={card.finish} />
      {onOpenCards && <button className="linkbtn" onClick={onOpenCards}>See your cards</button>}
    </section>
  );
}

export const CARDS_CSS = CARD_FACE_CSS + CARD_BATTLE_CSS + `
.cd-area{display:grid;gap:16px}
.cd-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cd-h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(22px,5vw,28px);line-height:1.1;margin:0 0 10px;color:var(--ink)}
.cd-area .panel p{margin:0 0 12px}
.cd-starter .note{margin-top:12px}
.cd-filter{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
.cd-team{display:flex;align-items:center;gap:10px;margin:0 0 16px;font-weight:700;color:var(--ink)}
.cd-team select{font:inherit;font-size:16px;font-weight:600;color:var(--ink);background:var(--surface);border:2px solid var(--btn-line);border-radius:10px;padding:8px 10px;min-height:44px;max-width:100%}
.cd-team select:focus-visible{outline:3px solid var(--accent-ink);outline-offset:2px}
.cd-chip{border:2px solid var(--btn-line);background:var(--surface);color:var(--ink);font-weight:700;font-size:14px;padding:6px 14px;border-radius:999px;position:relative}
.cd-chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.cd-chip:focus-visible{outline:3px solid var(--accent-ink);outline-offset:2px}
.cd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:26px 12px;justify-items:center;padding:8px 0 4px}
.cd-grid .cd-card{--cd-w:160px}
.cd-fresh{padding-bottom:8px;border-bottom:2px solid var(--line)}
.cd-earned{display:grid;justify-items:center;gap:10px;margin:18px 0 6px}
.cd-earned-h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.03em;font-size:18px;margin:0;color:var(--ink)}
.cd-earned .cd-card{--cd-w:150px}
.cd-tabs{display:flex;flex-wrap:wrap;gap:8px}
/* "You pulled" takes focus so a screen reader lands on what just happened; it is not a control, so no ring. */
.cd-h[tabindex="-1"]:focus,.cd-inside:focus{outline:none}
.cd-shop{display:grid;gap:18px}
.cd-shop-h{margin:0}
.cd-bal{margin:0;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:8px}
.cd-bal span{font-weight:600;color:var(--muted)}
.cd-packs{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.cd-pack{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 16px;align-items:start;border-top:2px solid var(--line);padding-top:16px}
.cd-pack-art{width:122px;height:auto;display:block}
.cd-pack-body{display:grid;gap:6px;min-width:0}
.cd-pack-h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:22px;line-height:1.1;margin:0;color:var(--ink)}
.cd-pack-blurb,.cd-pack-price,.cd-pack-stock{margin:0;color:var(--ink)}
.cd-pack-blurb{color:var(--muted);font-size:14px;line-height:1.4}
.cd-pack-price{font-weight:800;display:flex;align-items:center;flex-wrap:wrap}
.cd-pack-size{font-weight:600;color:var(--muted);white-space:pre}
.cd-pack-stock{font-size:13px;font-weight:700}
.cd-pack-acts{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;margin-top:4px}
.cd-pack .note{margin:0}
.cd-inside{grid-column:1 / -1;display:grid;gap:14px;padding:12px 0 4px;min-width:0}
.cd-inside-lead{margin:0;font-size:14px;line-height:1.45;color:var(--muted)}
.cd-odds{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px 24px}
.cd-inside table{border-collapse:collapse;width:100%;font-size:14px;color:var(--ink)}
.cd-inside caption{text-align:left;font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.04em;padding-bottom:6px;color:var(--ink)}
.cd-inside th,.cd-inside td{text-align:left;padding:5px 0;border-top:1px solid var(--line);font-weight:500;vertical-align:baseline}
.cd-inside thead th{font-size:12px;font-weight:700;color:var(--muted);border-top:0}
.cd-inside td{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:12px}
.cd-inside thead th:not(:first-child){text-align:right;padding-left:12px}
.cd-n{color:var(--muted);font-size:12px;white-space:nowrap}
@media (max-width:400px){
  .cd-pack-art{width:88px}
  .cd-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 8px}
  .cd-grid .cd-card{--cd-w:min(150px,calc((100vw - 48px) / 2))}
}
@media (pointer:coarse){
  .cd-chip{min-height:44px;padding:8px 16px;z-index:1}
}
`;
