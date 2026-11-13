// The card area: your starter deck and your collection. See CARDS.md.
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
// `error` is its own state on purpose. A read that failed is not an empty collection: collapsing the two would
// offer a player with fifty cards a starter deck they opened last week (storage-cards.js says the same).
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMyCards, claimStarter, CARD_REFUSALS } from "./storage.js";
import { loadCardData } from "./card-data.mjs";
import { CARDS } from "./card-logic.mjs";
import { CardFace, CARD_FACE_CSS } from "./card-face.jsx";

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
  price_changed: "That pack's price has gone up since this page loaded. Nothing was charged - the new price is showing now.",
  not_enough: "You don't have enough coins for that pack. Nothing was charged.",
};
export const CARD_SENTENCE_KEYS = [...CARD_REFUSALS, "offline", "network"];

const POSITIONS = ["All", "QB", "RB", "WR", "TE"];
const FINISH_ORDER = { prism: 0, gold: 1, silver: 2, base: 3 };
// Owned rows as cards to draw: best first. A row whose card is not in the catalog this browser loaded is
// skipped rather than drawn as a blank - it means the catalog is older than the collection, and the rest of the
// collection is still worth showing.
function toCards(rows) {
  return rows.map((r) => ({ ...r, card: CARDS.get(r.id) })).filter((r) => r.card)
    .sort((a, b) => b.card.rating - a.card.rating || FINISH_ORDER[a.finish] - FINISH_ORDER[b.finish] || a.id - b.id);
}

export function CardsScreen({ userId, isGuest, onBack, onNeedsAccount, onHide }) {
  const [phase, setPhase] = useState("loading");
  const [owned, setOwned] = useState([]);
  const [fresh, setFresh] = useState(null); // the eight just dealt, shown once above the collection
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pos, setPos] = useState("All");
  const [stale, setStale] = useState(false); // an owned card this page's catalog does not know

  // ONLY THE LATEST LOAD MAY SPEAK. Whether an account is a guest arrives a beat after its id does, so a load
  // can start as "not a guest", be superseded by one that knows better, and then finish - and without this it
  // came back and offered a guest a starter deck over the top of "cards are for accounts". Each load takes a
  // number and checks it is still the newest before it sets anything; unmounting retires them all.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    const current = () => latest.current === mine;
    if (!userId || isGuest) { setPhase("account"); return; }
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

  const shown = pos === "All" ? owned : owned.filter((r) => r.card.pos === pos);
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
          <button className="btn" onClick={load}>Try again</button>
        </div>
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

      {phase === "starter" && (
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
      {(phase === "collection" || (phase === "starter" && owned.length > 0)) && (
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
            {shown.length === 0
              ? <p className="note">{owned.length === 0 ? (stale ? "Reload the page to see your cards." : "No cards yet. Finish today's daily draft to earn one.") : `No ${pos} cards yet.`}</p>
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

export const CARDS_CSS = CARD_FACE_CSS + `
.cd-area{display:grid;gap:16px}
.cd-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cd-h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(22px,5vw,28px);line-height:1.1;margin:0 0 10px;color:var(--ink)}
.cd-area .panel p{margin:0 0 12px}
.cd-starter .note{margin-top:12px}
.cd-filter{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px}
.cd-chip{border:2px solid var(--btn-line);background:var(--surface);color:var(--ink);font-weight:700;font-size:14px;padding:6px 14px;border-radius:999px;position:relative}
.cd-chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.cd-chip:focus-visible{outline:3px solid var(--accent-ink);outline-offset:2px}
.cd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:26px 12px;justify-items:center;padding:8px 0 4px}
.cd-grid .cd-card{--cd-w:160px}
.cd-fresh{padding-bottom:8px;border-bottom:2px solid var(--line)}
.cd-earned{display:grid;justify-items:center;gap:10px;margin:18px 0 6px}
.cd-earned-h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.03em;font-size:18px;margin:0;color:var(--ink)}
.cd-earned .cd-card{--cd-w:150px}
@media (max-width:400px){
  .cd-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 8px}
  .cd-grid .cd-card{--cd-w:min(150px,calc((100vw - 48px) / 2))}
}
@media (pointer:coarse){
  .cd-chip{min-height:44px;padding:8px 16px;z-index:1}
}
`;
