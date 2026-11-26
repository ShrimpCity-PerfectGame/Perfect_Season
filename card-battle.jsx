// Card battles: the ladder, the daily battle, the deck and the two boards. See CARDS.md 11.
//
// OFFENSE AGAINST OFFENSE (v2.27.0, the owner's redesign): a deck of thirty, a hand of twelve dealt from it,
// against a CPU's six - the same kind of cards you collect. PLAYED A ROUND AT A TIME (v2.28.0): each round is
// for one spot of the lineup, and you play a card from your hand that fits it. THE CATEGORY IS CALLED BEFORE
// THE CARD IS PICKED (v2.31.0): by you in round one, then by whoever won the last round.
//
// A screen in its own file, like cards.jsx, which mounts it: it styles only its own cb- prefix, reuses the app's
// .btn / .note / .panel / .lb, and never imports perfect-season.jsx or cards.jsx back.
//
// NOTHING HERE DECIDES A BATTLE. The browser sends one card a round and the category it calls; the card-claim
// Edge Function deals the hand, checks the call, rolls the luck, says who won and pays. What this file works
// out for itself is only what a player needs BEFORE playing - what fits, what a lineup's synergies are - and all
// of it comes from card-logic.mjs, the module the function scores with.
//
// A FAILED PLAY IS NOT "NOT PLAYED". offline, network and server may each follow a battle that WAS played and
// whose answer was lost. So the screen never replays to find out: it reads card_battle_state, which says where
// things really stand and carries the latest battle, and shows that. A battle cannot be played twice either way.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBattleState, fetchCardBoards, startRun, playRound, endRun, saveDeck, dealDaily, playDailyRound, startGauntlet, playGauntletRound, quitGauntlet } from "./storage.js";
import {
  CARDS, CATEGORIES, CATEGORY_IDS, FINISH_BONUS, DECK_SHAPE, HAND_SHAPE, POSITIONS, archetypeLabel, categoryLabel, spotLabel, abilityOf,
  deckProblem, bestDeck, cardProblem, autoPick, playedSynergies, battleResult, ladderName, ladderTarget, ladderEdge, dailyFoe, maskFoe, categoryStat,
  callerOf, leftCategories, foeCall, bestCategory, categoryWorth, roundBase, ABILITY_NEXT,
  RATING_SHARE, GAUNTLET, GAUNTLET_EVEN, gauntletName, gauntletFoe, gauntletEdge,
} from "./card-logic.mjs";
import { COIN_RULES, cardWinCoins, gauntletCoins } from "./rewards.mjs";
import { Coins, NameLink } from "./cosmetics.jsx";
import { CardFace, useCardSprite, CARD_PAINT as P, BadgeLine } from "./card-face.jsx";

// A deck's, a team's and a run's own refusals, as sentences. cards.jsx folds these into CARD_SENTENCES, so the
// test that holds that map to storage-cards.js's CARD_REFUSALS holds these too.
export const LINEUP_SENTENCES = {
  incomplete: "Pick six cards first.",
  already_played: "You've already played that card in this battle. Pick another.",
  unknown_card: "One of those cards isn't one this version of the game knows. Reload the page and pick again.",
  bad_finish: "That didn't go through. Reload the page and pick again.",
  bad_slot: "That card can't play this spot. Pick one that fits it.",
  bad_cat: "That category has already been used in this battle. Pick one that is still open.",
  same_player: "The same player can't play twice in a battle, even in two different seasons.",
  not_owned: "One of those cards isn't in your collection any more. Pick again.",
  not_in_hand: "One of those cards wasn't dealt to you for this battle. Pick from your hand.",
  bad_deck: "A deck is 5 quarterbacks, 10 backs, 10 receivers and 5 tight ends.",
  no_deck: "You need a full deck first: 5 quarterbacks, 10 backs, 10 receivers and 5 tight ends.",
  no_hand: "Today's hand hasn't been dealt yet. Deal it first.",
  no_run: "That run is over. Start a new one.",
  stale: "That run has moved on since this page loaded. Here is where it stands now.",
  locked: "That stage isn't open yet. Beat the one before it first.",
  no_battle: "That battle is over. Start it again from the gauntlet.",
};
// Everything else a battle can be refused for. Not one of these may say a battle was or was not played unless
// the function itself said so: the three at the bottom are the unknown ones, and the screen only adds "it was
// not played" after card_battle_state has confirmed nothing moved.
export const BATTLE_SENTENCES = {
  ...LINEUP_SENTENCES,
  signed_out: "You've been signed out. Sign in again to play.",
  no_profile: "This account hasn't picked a name yet. Pick one and battles open up.",
  guest_not_allowed: "Battles are for accounts. Keep your seasons from the Account tab and they open up.",
  cards_off: "Cards aren't switched on here yet.",
  duplicate: "You've already played today's battle.",
  malformed: "That didn't go through. Reload the page and try again.",
  server: "Something went wrong on our side. Try again in a moment.",
  offline: "Couldn't reach the server. Check your connection and try again.",
  network: "That didn't go through. Reload the page and try again.",
};
const UNKNOWN = ["server", "offline", "network"];
const UNCONFIRMED = "We couldn't confirm that one, and couldn't check either. Check your connection and try again - a battle is never played twice.";
const say = (reason) => BATTLE_SENTENCES[reason] || BATTLE_SENTENCES.network;

const FINISH_NAME = { base: "Base", silver: "Silver", gold: "Gold", prism: "Prism" };
const POS_PLURAL = { QB: "Quarterbacks", RB: "Running backs", WR: "Receivers", TE: "Tight ends" };
const CAT_SHORT = { production: "Yds", scoring: "TD", bigplay: "Big", workload: "Work", efficiency: "Eff", star: "Star" };
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
// A signed number a screen reader says right: a real minus sign, never a hyphen.
const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;
const keyOf = (e) => `${e.id}:${e.finish}`;
const same = (a, b) => a.id === b.id && a.finish === b.finish;
const entryOf = (row) => ({ id: row.id, finish: row.finish });

function Chip({ pts, label }) {
  return <span className={`cb-chip ${pts > 0 ? "cb-up" : "cb-down"}`}>{signed(pts)} {label}</span>;
}

// One card as a row: who he is, his rating, his six category scores and what his archetype does. The category
// scores are the game - they are what a round is fought on - so they are always on show, never behind a tap.
export function CardRow({ entry, mods = null, children, dim = false }) {
  const card = CARDS.get(entry.id);
  if (!card) return <div className="cb-row cb-row-gone">A card this page doesn't know</div>;
  const ability = abilityOf(card);
  const bonus = FINISH_BONUS[entry.finish];
  return (
    <div className={`cb-row${dim ? " cb-row-dim" : ""}`} data-card={card.id} data-finish={entry.finish}>
      <span className="cb-pos">{card.pos}</span>
      <span className="cb-who">
        <b>{card.name}</b>
        <span className="cb-sub">{card.season} {card.team} · {archetypeLabel(card.archetype)}{entry.finish !== "base" ? ` · ${FINISH_NAME[entry.finish]}` : ""}</span>
      </span>
      <span className="cb-n">{Math.round(card.rating)}{bonus ? <small>+{bonus}</small> : null}</span>
      <dl className="cb-cats">
        {CATEGORIES.map((c) => (
          <div key={c.id} className={card.cats[c.id] >= 80 ? "cb-cat-hi" : card.cats[c.id] < 35 ? "cb-cat-lo" : undefined}>
            <dt><span className="vh">{c.label}</span><span aria-hidden="true">{CAT_SHORT[c.id]}</span></dt><dd>{card.cats[c.id]}</dd>
          </div>
        ))}
      </dl>
      {ability && <span className="cb-abil"><b>{ability.name}:</b> {ability.text}</span>}
      {mods && mods.length > 0 && <span className="cb-mods">{mods.map((m) => <Chip key={m.key} pts={m.pts} label={m.label} />)}</span>}
      {children}
    </div>
  );
}

// ---------- the deck ----------
// rows: the collection as cards.jsx holds it, [{ id, finish, count, card }]. saved: the deck on the server, or null.
export function DeckBuilder({ rows, saved, onSaved }) {
  const owned = rows.map(entryOf);
  const best = bestDeck(owned);
  const ownedMap = new Map(owned.map((e) => [keyOf(e), 1]));
  const valid = saved && deckProblem(saved, ownedMap) === null ? saved : null;
  const [deck, setDeck] = useState(valid || best || []);
  const [swap, setSwap] = useState(null); // the deck card being replaced
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  if (!best) return null;
  const current = valid || best;
  const changed = deck.map(keyOf).sort().join() !== current.map(keyOf).sort().join();
  const inDeck = new Set(deck.map(keyOf));
  const men = new Set(deck.map((e) => CARDS.get(e.id).pid));
  async function save(list) {
    if (busy) return;
    setBusy(true); setNotice("");
    const res = await saveDeck(list);
    if (!live.current) return;
    setBusy(false);
    if (res.ok) { onSaved?.(list); setNotice("Deck saved."); return; }
    setNotice(UNKNOWN.includes(res.reason) ? `${say(res.reason)} Your deck may not have been saved.` : say(res.reason));
  }
  return (
    <div className="cb-area" data-mode="deck">
      <h2 className="cb-h2">Your deck</h2>
      <p className="cb-lead">Thirty cards: {POSITIONS.map((p) => `${DECK_SHAPE[p]} ${POS_PLURAL[p].toLowerCase()}`).join(", ")}. Each battle deals you {POSITIONS.map((p) => `${HAND_SHAPE[p]} ${p}`).join(", ")} from it, so depth matters as much as stars.</p>
      <div className="cb-acts">
        <button className="btn solid" data-save disabled={busy || !changed} onClick={() => save(deck)}>{busy ? "Saving…" : "Save deck"}</button>
        <button className="btn" data-best-deck disabled={busy} onClick={() => { setDeck(best); setSwap(null); }}>Use my best thirty</button>
      </div>
      {notice && <p className="note" role="status" data-notice>{notice}</p>}
      {POSITIONS.map((pos) => {
        const mine = deck.filter((e) => CARDS.get(e.id).pos === pos).sort((a, b) => CARDS.get(b.id).rating - CARDS.get(a.id).rating || a.id - b.id);
        return (
          <section key={pos} className="cb-deck-pos" aria-label={POS_PLURAL[pos]} data-pos={pos}>
            <h3 className="cb-h3">{POS_PLURAL[pos]} <span className="cb-count">{mine.length} of {DECK_SHAPE[pos]}</span></h3>
            <ul className="cb-list">
              {mine.map((e) => {
                const open = swap && same(swap, e);
                const options = open ? owned.filter((o) => CARDS.get(o.id).pos === pos && !inDeck.has(keyOf(o)) && (!men.has(CARDS.get(o.id).pid) || CARDS.get(o.id).pid === CARDS.get(e.id).pid))
                  .sort((a, b) => CARDS.get(b.id).rating - CARDS.get(a.id).rating || a.id - b.id) : [];
                return (
                  <li key={keyOf(e)}>
                    <CardRow entry={e}>
                      <button className="btn sm cb-row-act" aria-expanded={!!open} onClick={() => setSwap(open ? null : e)}>Swap</button>
                    </CardRow>
                    {open && (
                      <ul className="cb-opts">
                        {options.length === 0 && <li className="note">You have no other {POS_PLURAL[pos].toLowerCase()} to swap in.</li>}
                        {options.map((o) => (
                          <li key={keyOf(o)}>
                            <CardRow entry={o}>
                              <button className="btn sm cb-row-act" data-swap-in onClick={() => { setDeck(deck.map((d) => (same(d, e) ? o : d))); setSwap(null); }}>Put in</button>
                            </CardRow>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ---------- the arena ----------
// One battle, PLAYED A ROUND AT A TIME, ON A CATEGORY SOMEBODY CALLED (v2.31.0; the rules are card-logic.mjs's,
// under "THE CALL"). You call round one, then whoever won the last round. Each category is used once.
//   hand    [{ id, finish }] the twelve dealt
//   foe     [{ id, finish, spot }] the other side's six, in playing order - a card not yet met is { spot } alone
//           on the ladder and in the daily battle (hidden), and whole in the gauntlet
//   rounds  the rounds played so far, as the function reported them:
//           { cat, spot, call, mine, foe, win, score: [you, them], next: { by, cat } | null }, mine / foe:
//           { id, finish, rating, score, base, roll, mods, total, ability: { name, on, cancelled } | null, line }
//   onPlay(entry, cat)  play a card for the next round, on the category you call (ignored on their call); the
//                       parent sends it and hands back longer `rounds`
//
// THE OWNER PLAYED v2.30.0 AND SAID WHAT WAS WRONG WITH IT, and this screen is the answer to each line:
//   "you pick a card, it scrolls up to view the battle ... by the time you read them it disappears and goes
//    back to the bottom"  - ONE PANEL does everything, in place: you choose in it, and the result takes its
//    place and STAYS until you move on. Nothing here runs on a timer and nothing scrolls. The panel comes
//    BEFORE the field, so the thing you act on is never under the thing you look at.
//   "a player list with a big number on the right, you just want to hit the one with the higher number" - the
//    hand is cards SIDE BY SIDE, in the order dealt, each with its six stats listed down it. No total is
//    projected and nothing is sorted by rating or by the category in play.
//   "say what the grading category is prior to the pick" - the rack of six categories sits over the hand, and
//    the one in play is lit on every card before anything is played.
//
// A round already played when this mounted (a battle resumed, a daily opened again) is not shown again as a
// result - only the ones that arrive while it is on screen.
const ROW_LABEL = { scoring: "Touchdowns" }; // on a card a hundred pixels wide; the rack says it in full

// One card as a column of its six stats. ARTWORK, like CardFace: its paints are CARD_PAINT's and not theme
// tokens, so it reads the same on the cream page and in the dark scope, and tests/test-card-face.mjs holds its
// text to AA through CARD_TEXT_PAIRS.
//   cat    the category in play, lit on the card (null: none yet)
//   gone   the categories already used this battle, struck through
//   extra  points this card is sure of this round whatever the category: teammates already down, its finish
//   onPick makes it a button; without it the card is only to be looked at (their card, the rest of your hand)
function StatCard({ entry, cat = null, gone = [], extra = 0, pressed = false, onPick = null, disabled = false }) {
  const card = CARDS.get(entry.id);
  if (!card) return <span className="cb-sc cb-sc-none">A card this page doesn't know</span>;
  return <StatCardBody entry={entry} card={card} cat={cat} gone={gone} extra={extra} pressed={pressed} onPick={onPick} disabled={disabled} />;
}
function StatCardBody({ entry, card, cat, gone, extra, pressed, onPick, disabled }) {
  const { src, colours } = useCardSprite(card);
  const bonus = FINISH_BONUS[entry.finish] || 0;
  const said = CATEGORIES.map((c) => `${c.label} ${card.cats[c.id]}${gone.includes(c.id) ? " (used)" : ""}`).join(", ");
  const label = `${card.name}, ${card.season} ${card.team} ${card.pos}, rated ${Math.round(card.rating)}${bonus ? ` plus ${bonus}` : ""}, ${archetypeLabel(card.archetype)}. ${cat ? `In play: ${categoryLabel(cat)} ${card.cats[cat]}. ` : ""}${said}.`;
  const inner = (
    <span className="cb-sc-in">
      <span className="cb-sc-art" aria-hidden="true">
        <span className="cb-sc-pos">{card.pos}</span>
        <span className="cb-sc-ovr">{Math.round(card.rating)}{bonus > 0 && <small>+{bonus}</small>}</span>
        <img className="cb-sc-fig" alt="" src={src} onError={(e) => { e.currentTarget.hidden = true; }} />
      </span>
      <span className="cb-sc-nm">{card.name}</span>
      <span className="cb-sc-sub">{card.season} {card.team} · {archetypeLabel(card.archetype)}</span>
      <span className="cb-sc-stats">
        {CATEGORIES.map((c) => {
          const used = gone.includes(c.id);
          const plus = used ? 0 : Math.round(categoryWorth(entry, c.id) - roundBase(entry, c.id));
          return (
            <span key={c.id} data-stat={c.id} className={used ? "cb-sc-gone" : c.id === cat ? "cb-sc-lit" : undefined}>
              <span className="cb-sc-k">{ROW_LABEL[c.id] || c.label}</span>
              <span className="cb-sc-v">{card.cats[c.id]}{plus > 0 && <i>+{plus}</i>}</span>
            </span>
          );
        })}
      </span>
      {extra > 0 && <span className="cb-sc-extra">Bonuses <b>+{fmt(extra)}</b></span>}
    </span>
  );
  const shared = { className: `cb-sc cb-f-${entry.finish}${pressed ? " cb-sc-on" : ""}`, "data-card": card.id, "data-finish": entry.finish, style: { "--cd-a": colours.jersey, "--cd-b": colours.metal } };
  return onPick
    ? <button type="button" {...shared} data-pick={card.id} aria-pressed={String(!!pressed)} aria-label={label} disabled={disabled} onClick={onPick}>{inner}</button>
    : <span {...shared} role="img" aria-label={label}>{inner}</span>;
}

// One side of a round's result: the card, the real number the category ranks, and ONE total.
function Shown({ who, shot, cat, won, lost }) {
  const c = CARDS.get(shot.id);
  return (
    <div className={`cb-side cb-side-${who}${won ? " cb-win" : lost ? " cb-lose" : ""}`}>
      {c ? <CardFace card={c} finish={shot.finish} /> : <span className="cb-row-gone">A card this page doesn't know</span>}
      <p className="cb-real" data-real>{c ? categoryStat(c, cat) : ""}</p>
      <p className="cb-total" data-total><span className="vh">{who === "you" ? "Your total: " : "Their total: "}</span>{fmt(shot.total)}</p>
    </div>
  );
}
// The breakdown behind a total, for whoever asks "Why?".
function Maths({ who, shot, cat }) {
  return (
    <div className="cb-maths">
      <p className="cb-maths-h">{who}</p>
      <dl className="cb-stats2">
        <div><dt>{categoryLabel(cat)} score</dt><dd>{shot.score}<small> of 99</small></dd></div>
        <div><dt>Card rating</dt><dd>{Math.round(shot.rating)}</dd></div>
        <div><dt>Points from both</dt><dd>{fmt(shot.base)}</dd></div>
        {shot.mods.map((m) => <div key={m.key}><dt>{m.label}</dt><dd>{signed(m.pts)}</dd></div>)}
        <div><dt>Luck</dt><dd>{signed(shot.roll)}</dd></div>
        <div className="cb-tot"><dt>Round total</dt><dd>{fmt(shot.total)}</dd></div>
      </dl>
      {shot.ability && !shot.mods.some((m) => m.key === "ability") && (
        <p className="cb-idle">{shot.ability.name}: {shot.ability.cancelled ? "cancelled" : shot.ability.on ? "in play" : "not this round"}</p>
      )}
    </div>
  );
}

export function Arena({ hand, foe, rounds, edge = 0, foeName = "CPU", busy = false, onPlay, onDone }) {
  const total = foe.length;
  // How many rounds' results the player has moved past. Rounds already there at mount are simply shown.
  const [seenTo, setSeen] = useState(rounds.length);
  // FEWER ROUNDS THAN WERE SEEN is a new battle in the same arena (a second try at a gauntlet stage was one,
  // until its key said so). Nothing of it has been seen; without this the screen reads a round that is not there.
  if (seenTo > rounds.length) setSeen(rounds.length);
  const seen = Math.min(seenTo, rounds.length);
  const [cat, setCat] = useState(null);     // the category chosen, on your call
  const [pick, setPick] = useState(null);   // the card chosen, as a key
  const [why, setWhy] = useState(false);
  const [open, setOpen] = useState(false);  // the rest of the hand
  const sent = useRef(false);
  const go = useRef(null);
  const callh = useRef(null);
  const passed = useRef(false); // a result was just passed with the button, which has gone
  const revealing = seen < rounds.length;
  const over = rounds.length >= total && !revealing;
  useEffect(() => { if (over) onDone?.(); }, [over]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new round to choose for: the last choice is spent with the card.
  useEffect(() => { setCat(null); setPick(null); setWhy(false); setOpen(false); }, [rounds.length]);
  // A result on screen: the way on is the button, wherever the keyboard was. Never by scrolling the page.
  useEffect(() => {
    if (revealing) go.current?.focus({ preventScroll: true });
    // ...and when it is passed, on to the next round's heading - the button that was pressed is gone, and focus
    // left on the page would send a keyboard back to the top six times a battle.
    else if (passed.current) { passed.current = false; callh.current?.focus({ preventScroll: true }); }
  }, [revealing, seen]);

  const settled = revealing ? seen + 1 : seen; // rounds whose result is on the board
  const score = settled > 0 ? rounds[settled - 1].score : [0, 0];
  const result = over ? battleResult(rounds) : null;
  const name = (side) => CARDS.get(side.id)?.name || "A card";
  const next = rounds.length; // the round to be chosen for
  const choosing = !revealing && next < total;
  const by = callerOf(rounds);
  const left = leftCategories(rounds);
  const gone = CATEGORY_IDS.filter((c) => !left.includes(c));
  // THEIR CALL, when this page can know it: from their card if it is in view (the gauntlet), otherwise from what
  // the round before said was coming. A battle begun before v2.31.0 has neither - then it is not known, and the
  // screen says so rather than guessing.
  const told = next > 0 ? rounds[next - 1].next : null;
  const theirs = choosing && by === "foe" ? (foe[next].id != null ? foeCall(foe, rounds) : told && told.by === "foe" ? told.cat : null) : null;
  const forced = choosing && by === "me" && left.length === 1 ? left[0] : null; // round six: the one left
  const inPlay = !choosing ? null : by === "foe" ? theirs : forced || cat;
  // IN THE ORDER DEALT. playable() sorts best first for the bots; the screen must not.
  const options = choosing ? hand.filter((e) => cardProblem(hand, foe, rounds, e) === null) : [];
  const picked = options.find((e) => keyOf(e) === pick) || null;
  const ready = !!picked && (by === "foe" || !!inPlay);
  const earlier = rounds.map((r) => r.mine);
  const usedMen = new Set(earlier.map((e) => CARDS.get(e.id)?.pid));
  const rest = choosing ? hand.filter((e) => !usedMen.has(CARDS.get(e.id)?.pid) && !options.some((o) => same(o, e))) : [];
  const lastMine = next > 0 ? CARDS.get(rounds[next - 1].mine.id) : null;
  // What a card is sure of this round whatever is called: who of yours is already down, its finish, a Game
  // manager before it.
  const sure = (e) => {
    const mods = playedSynergies(e, earlier).slice();
    if (FINISH_BONUS[e.finish] > 0) mods.push({ key: "finish", label: `${FINISH_NAME[e.finish]} finish`, pts: FINISH_BONUS[e.finish] });
    if (lastMine?.archetype === "manager") mods.push({ key: "next", label: "Field general", pts: ABILITY_NEXT });
    return mods;
  };
  const points = (mods) => mods.reduce((n, m) => n + m.pts, 0);
  // ONE play a tap. Two taps before the page has drawn `busy` are still two calls to this - the second is dropped
  // here, or it would be refused as stale and read to the player as a round whose answer went missing.
  const play = (entry, called) => {
    if (busy || sent.current || !entry) return;
    sent.current = true;
    Promise.resolve(onPlay?.(entry, called || undefined)).finally(() => { sent.current = false; });
  };
  const r = revealing ? rounds[seen] : null;
  const nextBy = r && seen + 1 < total ? callerOf(rounds.slice(0, seen + 1)) : null;
  const pickedCard = picked ? CARDS.get(picked.id) : null;
  const pickedAbility = pickedCard ? abilityOf(pickedCard) : null;
  const pickedMods = picked ? sure(picked) : [];
  return (
    <section className={`cb-arena${result ? (result.win ? " cb-won" : " cb-lost") : ""}`} aria-label="The battle" data-done={String(over)} data-rounds={rounds.length} data-win={result ? String(result.win) : undefined}>
      <div className="cb-sb">
        <div className="cb-sb-you"><span>You</span><b data-you>{score[0]}</b></div>
        <div className="cb-sb-mid"><span data-round>{over ? "Final" : `Round ${Math.min(total, (revealing ? seen : next) + 1)} of ${total}`}</span></div>
        <div className="cb-sb-cpu"><span>{foeName}</span><b data-cpu>{score[1]}</b></div>
      </div>

      {/* The six categories. One is used a round and never again: a spent one says who took it. On your call the
          rest are buttons; on theirs, the one they called is lit before you pick. */}
      <ul className="cb-rack" data-rack aria-label="Categories">
        {CATEGORIES.map((c) => {
          const spent = rounds.slice(0, settled).find((x) => x.cat === c.id);
          if (spent) {
            return (
              <li key={c.id}><span className="cb-k cb-k-used" data-cat={c.id} data-used={spent.win}>
                <s>{c.label}</s><i>{spent.win === "me" ? "You won" : spent.win === "foe" ? "They won" : "Tied"}</i>
              </span></li>
            );
          }
          if (choosing && by === "me" && !forced) {
            return <li key={c.id}><button type="button" className="cb-k" data-cat={c.id} aria-pressed={String(cat === c.id)} disabled={busy} onClick={() => setCat(c.id)}>{c.label}</button></li>;
          }
          const lit = choosing && inPlay === c.id;
          return (
            <li key={c.id}><span className={`cb-k${lit ? " cb-k-on" : ""}`} data-cat={c.id} data-called={lit ? by : undefined}>
              {c.label}{lit && <i>{by === "foe" ? "They called" : "The last one"}</i>}
            </span></li>
          );
        })}
      </ul>

      {choosing && (
        <div className="cb-panel cb-choose" data-choose={next} data-spot={foe[next].spot} data-call={by}>
          <p className="cb-callh" tabIndex={-1} ref={callh}><b>{by === "me" ? "Your call" : "Their call"}</b><span>Round {next + 1} of {total} · {spotLabel(foe[next].spot)}</span></p>
          {by === "me" && !inPlay && <p className="cb-hint" data-hint>Pick a category above, then a card.</p>}
          {by === "me" && inPlay && !forced && <p className="cb-hint" data-hint><b>{categoryLabel(inPlay)}</b> it is. Pick who plays it.</p>}
          {forced && <p className="cb-hint" data-hint><b>{categoryLabel(forced)}</b> is the last one left. Pick who plays it.</p>}
          {by === "foe" && theirs && <p className="cb-hint" data-hint>They won the last round and called <b>{categoryLabel(theirs)}</b>. Pick who answers it.</p>}
          {by === "foe" && !theirs && <p className="cb-hint" data-hint data-call-unknown>They call this one. You'll see the category when you play.</p>}
          {/* tabIndex: a region that scrolls has to be reachable from a keyboard even when nothing in it is - the
              cards are not buttons while a play is in flight, and the rest of the hand never is. */}
          <ul className="cb-tray" tabIndex={0} aria-label={`Your cards for this ${spotLabel(foe[next].spot).toLowerCase()} spot`}>
            {foe[next].id != null && (
              <li className="cb-tray-them" data-facing>
                <span className="cb-tray-cap">You're facing</span>
                <StatCard entry={foe[next]} cat={inPlay} gone={gone} extra={points(playedSynergies(foe[next], rounds.map((x) => x.foe)))} />
              </li>
            )}
            {options.length === 0 && <li className="note">You have nobody left for this spot.</li>}
            {options.map((e) => (
              <li key={keyOf(e)}>
                <StatCard entry={e} cat={inPlay} gone={gone} extra={points(sure(e))} pressed={pick === keyOf(e)} disabled={busy} onPick={() => setPick(keyOf(e))} />
              </li>
            ))}
          </ul>
          {picked && (pickedAbility || pickedMods.length > 0) && (
            <p className="cb-sel" data-selected>
              {pickedAbility && <span><b>{pickedAbility.name}:</b> {pickedAbility.text}</span>}
              {pickedMods.length > 0 && <span className="cb-mods">{pickedMods.map((m) => <Chip key={m.key} pts={m.pts} label={m.label} />)}</span>}
            </p>
          )}
          <button type="button" className="btn solid xl cb-play" data-play disabled={busy || !ready} onClick={() => play(picked, inPlay)}>
            {busy ? "Playing…"
              : !picked ? (by === "me" && !inPlay ? "Pick a category and a card" : "Pick a card")
              : !ready ? "Now pick a category"
              : inPlay ? <>Play {pickedCard.name}<small>{categoryLabel(inPlay)} · {categoryStat(pickedCard, inPlay)}</small></>
              : <>Play {pickedCard.name}</>}
          </button>
          <div className="cb-under">
            <button type="button" className="linkbtn" data-best disabled={busy || !options.length} onClick={() => { const e = autoPick(hand, foe, rounds); if (e) play(e, by === "me" ? forced || cat || bestCategory(e, rounds) : null); }}>Pick for me</button>
            {rest.length > 0 && <button type="button" className="linkbtn" data-whole-hand aria-expanded={String(open)} onClick={() => setOpen(!open)}>{open ? "Hide the rest of your hand" : `See the rest of your hand (${rest.length})`}</button>}
          </div>
          {/* Calling a category spends it for the cards you have NOT reached yet, so they can be looked at. */}
          {open && rest.length > 0 && (
            <ul className="cb-tray cb-whole" tabIndex={0} data-whole aria-label="The rest of your hand">
              {rest.map((e) => <li key={keyOf(e)}><StatCard entry={e} cat={inPlay} gone={gone} extra={points(sure(e))} /></li>)}
            </ul>
          )}
        </div>
      )}

      {revealing && (
        <div className="cb-panel cb-reveal" data-reveal={seen}>
          <p className="cb-callh"><b>{categoryLabel(r.cat)}</b><span>Round {seen + 1} of {total} · {spotLabel(r.spot)}{r.call ? ` · ${r.call === "foe" ? "their call" : "your call"}` : ""}</span></p>
          <div className="cb-duel">
            <Shown who="you" shot={r.mine} cat={r.cat} won={r.win === "me"} lost={r.win === "foe"} />
            <div className="cb-vsbig" aria-hidden="true">VS</div>
            <Shown who="cpu" shot={r.foe} cat={r.cat} won={r.win === "foe"} lost={r.win === "me"} />
          </div>
          <p className="cb-said" role="status" data-round-verdict>
            {r.win === "me" ? "Round to you." : r.win === "foe" ? `Round to ${foeName}.` : "Dead heat."}
            {nextBy && (r.win === "tie" ? ` The call stays with ${nextBy === "me" ? "you" : "them"}.` : nextBy === "me" ? " You call the next one." : " They call the next one.")}
          </p>
          {why && (
            <div className="cb-why" data-why-open>
              <div className="cb-why-cols">
                <Maths who="You" shot={r.mine} cat={r.cat} />
                <Maths who={foeName} shot={r.foe} cat={r.cat} />
              </div>
              <p className="cb-rule">A round is {Math.round((1 - RATING_SHARE) * 100)}% the {categoryLabel(r.cat)} score - {CATEGORIES.find((c) => c.id === r.cat)?.blurb.toLowerCase()}, ranked at each player's position in his era - and {Math.round(RATING_SHARE * 100)}% the card's rating, plus bonuses and luck. The higher total takes it.</p>
            </div>
          )}
          <div className="cb-rev-acts">
            <button type="button" className="btn" data-why aria-expanded={String(why)} onClick={() => setWhy(!why)}>{why ? "Hide the maths" : "Why?"}</button>
            <button type="button" className="btn solid xl" data-continue ref={go} onClick={() => { passed.current = true; setSeen(seen + 1); }}>{seen + 1 >= total ? "See the result" : "Next round"}</button>
          </div>
        </div>
      )}

      {result && (
        <div className="cb-finale">
          <p className="cb-stamp" aria-hidden="true">{result.win ? "\u{1F3C8} Win" : "\u{1F480} Beaten"}</p>
          <p className="cb-verdict" role="status" data-verdict>{result.win ? `You won, ${result.wins} rounds to ${result.losses}.` : `You lost, ${result.wins} rounds to ${result.losses}.`}</p>
          <p className="cb-margin">{result.wins === result.losses ? `Level on rounds, so it went to total points: ${fmt(result.total)} to ${fmt(result.foeTotal)}.` : `Total points ${fmt(result.total)} to ${fmt(result.foeTotal)}.`}{edge > 0 ? ` Their cards played ${fmt(edge)} points up - the top of the ladder.` : edge < 0 ? ` Their cards played ${fmt(-edge)} points short - your head start.` : ""}</p>
        </div>
      )}

      {/* The field: the record of the battle. Their six along the far sideline, yours as six big cards, three
          across. A spot is an empty outline until its round is played; then the card you played stands in it,
          marked won or lost in words. It comes AFTER the panel on purpose. */}
      <div className="cb-field dark" data-field>
        <p className="cb-field-h">{foeName}'s six</p>
        <ol className="cb-them" aria-label={`${foeName}'s six`}>
          {foe.map((f, i) => {
            const shown = rounds[i] ? rounds[i].foe : f.id != null ? f : null;
            const c = shown ? CARDS.get(shown.id) : null;
            const res = i < settled ? rounds[i].win : null;
            return (
              <li key={i} className={`cb-t${c ? "" : " cb-t-back"}${res === "me" ? " cb-t-beat" : res === "foe" ? " cb-t-won" : ""}`} data-them={i}>
                <span className="cb-t-pos">{f.spot === "FLEX" ? "Flex" : f.spot}</span>
                <span className="cb-t-nm">{c ? c.name.split(" ").slice(-1)[0] : "?"}</span>
              </li>
            );
          })}
        </ol>
        <p className="cb-field-h">Your six</p>
        <ol className="cb-strip" aria-label="Your six">
          {foe.map((f, i) => {
            const played = rounds[i];
            const c = played ? CARDS.get(played.mine.id) : null;
            const res = i < settled ? rounds[i].win : null;
            const now = !over && i === (revealing ? seen : next);
            const state = res === "me" ? "cb-s-won" : res === "foe" ? "cb-s-lost" : res === "tie" ? "cb-s-tie" : now ? "cb-s-now" : "cb-s-wait";
            return (
              <li key={i} className={`cb-s ${state}`} data-slot={i}>
                {c ? <CardFace card={c} finish={played.mine.finish} /> : (
                  <span className="cb-slot"><b>{f.spot === "FLEX" ? "Flex" : f.spot}</b><i>{played ? "—" : `Round ${i + 1}`}</i></span>
                )}
                <span className="cb-s-res">{c && <span className="cb-s-pos">{f.spot === "FLEX" ? "Flex" : f.spot} · </span>}{res === "me" ? "Won" : res === "foe" ? "Lost" : res === "tie" ? "Tied" : now ? "Up now" : played ? "Played" : "To come"}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {settled > 0 && (
        <div className="cb-log">
          <h3 className="cb-h3">Battle log</h3>
          <ol className="cb-rounds">
            {rounds.slice(0, settled).map((x, i) => (
              <li key={i} className={`cb-round cb-round-${x.win}`} data-round-win={x.win}>
                <span className="cb-round-cat">{categoryLabel(x.cat)}</span>
                <span className="cb-round-line">
                  <b>{name(x.mine)}</b> {fmt(x.mine.total)} {x.win === "me" ? "beat" : x.win === "foe" ? "lost to" : "tied"} <b>{name(x.foe)}</b> {fmt(x.foe.total)}
                </span>
                <span className="cb-round-why">
                  {x.call === "foe" ? "Their call. " : x.call === "me" ? "Your call. " : ""}{categoryStat(CARDS.get(x.mine.id), x.cat)} against {categoryStat(CARDS.get(x.foe.id), x.cat)}. {categoryLabel(x.cat)} score {x.mine.score} to {x.foe.score}, luck {signed(x.mine.roll)} to {signed(x.foe.roll)}.
                  {x.mine.mods.length > 0 && <> You: {x.mine.mods.map((m) => `${signed(m.pts)} ${m.label}`).join(", ")}.</>}
                  {x.foe.mods.length > 0 && <> Them: {x.foe.mods.map((m) => `${signed(m.pts)} ${m.label}`).join(", ")}.</>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

function Boards() {
  const [got, setGot] = useState(null); // null: loading. "error". Or { runs, daily }
  const load = useCallback(async () => {
    setGot(null);
    const res = await fetchCardBoards(25);
    setGot(res.status === "ok" ? res : "error");
  }, []);
  useEffect(() => { load(); }, [load]);
  if (got === null) return <p className="note" role="status">Loading the boards…</p>;
  if (got === "error") {
    return (
      <div className="panel" role="alert">
        <p><b>Couldn't load the boards.</b> This is a connection problem, not an empty board.</p>
        <button className="btn" onClick={load}>Try again</button>
      </div>
    );
  }
  const table = (caption, rows, head, value) => (
    <table className="lb cb-board">
      <caption>{caption}</caption>
      <thead><tr><th scope="col"><span className="vh">Rank</span>#</th><th scope="col">Player</th><th scope="col" className="r">{head}</th></tr></thead>
      <tbody>
        {rows.map((x, i) => <tr key={x.username}><td>{i + 1}</td><td className="nm"><NameLink name={x.username} guest={false} /></td><td className="r">{value(x)}</td></tr>)}
      </tbody>
    </table>
  );
  return (
    <div className="cb-boards">
      <h2 className="cb-h2">Boards</h2>
      {got.runs.length === 0 ? <p className="note">Nobody has won a battle on the ladder yet.</p> : table("The ladder: longest runs", got.runs, "Wins", (x) => x.wins)}
      {got.daily.length === 0 ? <p className="note">Nobody has played today's battle yet.</p> : table("Today's battle", got.daily, "Rounds · points", (x) => `${x.rounds}–${6 - x.rounds} · ${fmt(x.score)}`)}
      {got.gauntlet.length === 0 ? <p className="note">Nobody has cleared a stage of the gauntlet yet.</p> : table("The gauntlet: stages cleared", got.gauntlet, `Of ${GAUNTLET.length}`, (x) => x.cleared)}
    </div>
  );
}

// mode: "run" (the ladder) | "gauntlet" | "daily" | "deck" | "boards". rows: the collection, [{ id, finish, count, card }].
// A battle's share card (v2.34.0): squares, like the season's. It names no card on either side - yours are
// your collection, which nobody else may see, and theirs would spoil the day's team for anybody yet to play
// the daily. A square is a round: green won, red lost. The gauntlet names its stage, which is on the list for
// everybody anyway. `rounds` is a battle's own (each has `win: "me" | "foe"`).
export const BATTLE_SHARE_SAID = { shared: "", cancelled: "", copied: "Copied", manual: "Couldn't share - copy it by hand" };
export function battleShareText({ kind, rounds, wins, stage, cleared, day, score, siteUrl }) {
  const squares = (rounds || []).map((r) => (r.win === "me" ? "🟩" : "🟥")).join("");
  const won = (rounds || []).filter((r) => r.win === "me").length;
  const lines = [];
  if (kind === "daily") {
    lines.push(`Gridspin Cards · Daily battle ${day}`, `${squares} ${won} of 6`, `${fmt(score)} points`);
  } else if (kind === "gauntlet") {
    lines.push(`Gridspin Cards · Gauntlet stage ${stage + 1}: ${gauntletName(stage)}`, `${squares} ${cleared ? "cleared" : "held"}`);
  } else {
    lines.push("Gridspin Cards · Ladder", `${squares} ${wins} ${wins === 1 ? "win" : "wins"} in a row`);
  }
  if (siteUrl) lines.push(siteUrl);
  return lines.join("\n");
}
function ShareBattle({ onShare, text }) {
  const [how, setHow] = useState("");
  if (!onShare) return null;
  return (
    <>
      <button className="btn" data-share onClick={async () => setHow(await onShare(text()))}>Share</button>
      {how && BATTLE_SHARE_SAID[how] && <span className="note" role="status" data-shared={how}>{BATTLE_SHARE_SAID[how]}</span>}
      {how === "manual" && <textarea className="cb-share-text" readOnly rows={4} aria-label="Your result, to copy" value={text()} onFocus={(e) => e.target.select()} />}
    </>
  );
}

export function BattleArea({ mode, rows, onBalance, onShare, siteUrl }) {
  const [st, setSt] = useState(null); // null: loading. "error" | "signed_out". Or the battle state.
  // The ladder battle that just ENDED: { id, step, hand, battle, coins, wins, over }. Kept so the arena stays on
  // screen through its sixth round - the server has already dealt the next hand by then.
  const [shown, setShown] = useState(null);
  // WHICH battle has finished playing out - the battle itself, not a flag. A flag reset in an effect on `shown`
  // is reset AFTER the child's own effect has reported it done (children's effects run first), and stuck at false.
  const [seenBattle, setSeenBattle] = useState(null);
  // The gauntlet attempt that just ENDED: { stage, hand, battle, coins, first, cleared }.
  const [shownG, setShownG] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const live = useRef(true);
  const top = useRef(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const load = useCallback(async () => {
    setSt(null);
    try {
      const got = await fetchBattleState();
      if (!live.current) return;
      setSt(got.status === "ok" ? got : got.status);
    } catch {
      if (live.current) setSt("error");
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setNotice(""); setShownG(null); }, [mode]);

  if (mode === "boards") return <Boards />;
  if (st === null) return <p className="note" role="status">Loading…</p>;
  if (st === "error" || st === "signed_out") {
    return (
      <div className="panel" role="alert">
        <p><b>Couldn't load your battles.</b> {st === "signed_out" ? "You've been signed out - sign in again." : "This is a connection problem. Nothing is lost, and a run in progress is still there."}</p>
        <button className="btn" onClick={load}>Try again</button>
      </div>
    );
  }
  if (!bestDeck(rows.map(entryOf))) {
    return (
      <div className="panel" data-no-deck>
        <h2 className="cb-h2">You need a full deck to play</h2>
        <p>A deck is 5 quarterbacks, 10 backs, 10 receivers and 5 tight ends. Your starter cards fill one - get them from the Collection tab.</p>
      </div>
    );
  }
  if (mode === "deck") return <DeckBuilder rows={rows} saved={st.deck} onSaved={(deck) => setSt((s) => ({ ...s, deck }))} />;

  // After a play whose answer never came, or one the function called stale: ask where things really stand. The
  // state carries the rounds played so far, so a round that DID go through simply appears.
  async function settle(reason, run, round) {
    const fresh = await fetchBattleState();
    if (!live.current) return;
    if (fresh.status !== "ok") { setNotice(UNCONFIRMED); return; }
    setSt(fresh);
    const same = run && fresh.run && fresh.run.id === run.id;
    if (same && fresh.run.status === "live" && fresh.run.wins === run.wins) {
      setNotice(fresh.run.rounds.length > round
        ? "That round was played - its answer just didn't reach this page. Here is how it went."
        : UNKNOWN.includes(reason) ? `${say(reason)} That round was not played.` : say(reason));
      return;
    }
    if (same && fresh.run.last) {
      // The battle ended while this page was not looking: show it finished.
      setShown({ id: run.id, step: run.wins, hand: run.hand, battle: fresh.run.last, coins: null, wins: fresh.run.wins, over: fresh.run.status !== "live" });
      setNotice("That battle was finished - its answer just didn't reach this page. Here is how it went.");
      return;
    }
    setNotice(say(reason));
  }

  async function begin() {
    if (busy) return;
    setBusy(true); setNotice("");
    const res = await startRun();
    if (!live.current) return;
    setBusy(false);
    if (res.ok) { setShown(null); setSt((s) => ({ ...s, run: { ...res.run, status: "live" } })); return; }
    if (!UNKNOWN.includes(res.reason)) { setNotice(say(res.reason)); return; }
    // The run may have started and its answer been lost: the state says, and a live run simply opens.
    const fresh = await fetchBattleState();
    if (!live.current) return;
    if (fresh.status !== "ok") { setNotice(UNCONFIRMED); return; }
    setSt(fresh);
    if (fresh.run?.status !== "live") setNotice(say(res.reason));
  }
  async function playCard(entry, cat) {
    const run = st.run;
    if (busy || !run) return;
    const round = run.rounds.length;
    setBusy(true); setNotice("");
    const res = await playRound(run.id, run.wins, round, entry, cat);
    if (!live.current) return;
    if (res.ok) {
      setBusy(false);
      if (!res.done) { setSt((s) => ({ ...s, run: { ...s.run, rounds: res.run.rounds } })); return; }
      if (typeof res.coins?.balance === "number") onBalance?.(res.coins.balance);
      // The sixth round: the battle is over. Keep it on screen; the state already holds the next hand.
      if (typeof res.badge?.balance === "number") onBalance?.(res.badge.balance);
      setShown({ id: run.id, step: run.wins, hand: run.hand, battle: res.battle, coins: res.coins, badge: res.badge, wins: res.run.wins, over: res.run.status !== "live" });
      setSt((s) => ({ ...s, run: { ...res.run, last: res.battle }, best: Math.max(s.best, res.run.wins), paidToday: s.paidToday + (res.coins?.credited > 0 ? 1 : 0) }));
      return;
    }
    if (UNKNOWN.includes(res.reason) || res.reason === "stale" || res.reason === "no_run") await settle(res.reason, run, round);
    else setNotice(say(res.reason));
    if (live.current) setBusy(false);
  }
  async function walkAway() {
    if (busy) return;
    setBusy(true); setNotice("");
    await endRun();
    if (!live.current) return;
    setBusy(false); setShown(null);
    await load();
  }
  async function deal() {
    if (busy) return;
    setBusy(true); setNotice("");
    const res = await dealDaily();
    if (!live.current) return;
    setBusy(false);
    if (res.ok) { setSt((s) => ({ ...s, daily: res.daily })); return; }
    // Dealing twice deals once, so there is nothing to confirm here - only to say it did not come back.
    setNotice(say(res.reason));
  }
  async function playDay(entry, cat) {
    const day = st.daily;
    if (busy || !day) return;
    setBusy(true); setNotice("");
    const res = await playDailyRound(day.log.length, entry, cat);
    if (!live.current) return;
    if (res.ok) { setBusy(false); setSt((s) => ({ ...s, daily: res.daily })); return; }
    if (UNKNOWN.includes(res.reason) || res.reason === "stale" || res.reason === "duplicate") {
      // Either it went through and the answer was lost, or it was played somewhere else: the state says.
      const fresh = await fetchBattleState();
      if (!live.current) return;
      if (fresh.status === "ok") {
        setSt(fresh);
        const moved = (fresh.daily?.log.length || 0) > day.log.length || fresh.daily?.played;
        setNotice(moved ? "That round was played - its answer just didn't reach this page. Here is how it went."
          : UNKNOWN.includes(res.reason) ? `${say(res.reason)} That round was not played.` : say(res.reason));
      } else setNotice(UNCONFIRMED);
    } else setNotice(say(res.reason));
    setBusy(false);
  }

  // ---- the gauntlet's three moves ----
  async function beginG(stage) {
    if (busy) return;
    setBusy(true); setNotice("");
    const res = await startGauntlet(stage);
    if (!live.current) return;
    setBusy(false);
    if (res.ok) { setShownG(null); setSt((s) => ({ ...s, gauntlet: { ...s.gauntlet, ...res.gauntlet } })); return; }
    if (!UNKNOWN.includes(res.reason)) { setNotice(say(res.reason)); if (res.reason === "locked") load(); return; }
    // It may have started and its answer been lost: the state says, and an attempt in progress simply opens.
    const fresh = await fetchBattleState();
    if (!live.current) return;
    if (fresh.status !== "ok") { setNotice(UNCONFIRMED); return; }
    setSt(fresh);
    if (fresh.gauntlet.stage == null) setNotice(say(res.reason));
  }
  async function playG(entry, cat) {
    const g = st.gauntlet;
    if (busy || g.stage == null) return;
    const stage = g.stage, round = g.rounds.length;
    setBusy(true); setNotice("");
    const res = await playGauntletRound(stage, round, entry, cat);
    if (!live.current) return;
    if (res.ok) {
      setBusy(false);
      if (!res.done) { setSt((s) => ({ ...s, gauntlet: { ...s.gauntlet, rounds: res.gauntlet.rounds } })); return; }
      if (typeof res.coins?.balance === "number") onBalance?.(res.coins.balance);
      if (typeof res.badge?.balance === "number") onBalance?.(res.badge.balance);
      setShownG({ stage, hand: g.hand, battle: res.battle, coins: res.coins, badge: res.badge, first: res.first, cleared: res.gauntlet.cleared });
      setSt((s) => ({ ...s, gauntlet: { cleared: res.gauntlet.cleared, stage: null, hand: [], rounds: [], last: res.battle, lastStage: stage } }));
      return;
    }
    if (UNKNOWN.includes(res.reason) || res.reason === "stale" || res.reason === "no_battle") {
      // Either it went through and the answer was lost, or it was played somewhere else: the state says.
      const fresh = await fetchBattleState();
      if (!live.current) return;
      if (fresh.status !== "ok") setNotice(UNCONFIRMED);
      else {
        setSt(fresh);
        const now = fresh.gauntlet;
        if (now.stage === stage) {
          setNotice(now.rounds.length > round ? "That round was played - its answer just didn't reach this page. Here is how it went."
            : UNKNOWN.includes(res.reason) ? `${say(res.reason)} That round was not played.` : say(res.reason));
        } else if (now.stage == null && now.last && now.lastStage === stage && round === 5) {
          setShownG({ stage, hand: g.hand, battle: now.last, coins: null, first: null, cleared: now.cleared });
          setNotice("That battle was finished - its answer just didn't reach this page. Here is how it went.");
        } else setNotice(say(res.reason));
      }
    } else setNotice(say(res.reason));
    setBusy(false);
  }
  async function giveUp() {
    if (busy) return;
    setBusy(true); setNotice("");
    await quitGauntlet();
    if (!live.current) return;
    setBusy(false); setShownG(null);
    await load();
  }

  const paidLeft = Math.max(0, COIN_RULES.paidCardWinsPerDay - st.paidToday);
  const alert = notice && <p className="note" role="alert" data-notice>{notice}</p>;

  if (mode === "gauntlet") {
    const g = st.gauntlet;
    const total = GAUNTLET.length;
    const headStart = (stage) => { const e = gauntletEdge(stage); return e < 0 ? `Their cards play ${-e} points short each round - a head start.` : ""; };
    // ONE ARENA AN ATTEMPT. A try's result and the next try at the same stage are drawn in the same place; keyed
    // by the stage alone they were one arena to React, still on its sixth round and handed none, and "Try
    // again" took the screen down. The hand is dealt fresh for every attempt, so it names one.
    const attempt = (stage, hand) => `g:${stage}:${(hand || []).map(keyOf).join(".")}`;
    if (shownG) {
      const seen = seenBattle === shownG.battle;
      const won = shownG.battle.win;
      const next = shownG.cleared < total ? shownG.cleared : null; // the stage now up, if there is one
      return (
        <div className="cb-area" data-mode="gauntlet" data-phase="result">
          <h2 className="cb-h2 cb-result-h" tabIndex={-1} ref={top}>{!seen ? `Stage ${shownG.stage + 1}: ${gauntletName(shownG.stage)}` : won ? "Stage cleared" : "Beaten"}</h2>
          {alert}
          <Arena key={attempt(shownG.stage, shownG.hand)} hand={shownG.hand} foe={shownG.battle.foe} rounds={shownG.battle.rounds} edge={shownG.battle.edge} foeName={gauntletName(shownG.stage)}
            onDone={() => { setSeenBattle(shownG.battle); top.current?.focus({ preventScroll: true }); }} />
          {seen && won && shownG.first === true && <p className="cb-lead" data-paid>You beat {gauntletName(shownG.stage)}.{shownG.coins?.credited > 0 && <> You earned <Coins amount={shownG.coins.credited} size={16} />.</>}</p>}
          {seen && <BadgeLine badge={shownG.badge} />}
          {seen && won && shownG.first === false && <p className="cb-lead" data-again>You beat {gauntletName(shownG.stage)} again. A stage pays the first time only.</p>}
          {seen && won && shownG.cleared >= total && <p className="cb-lead" data-all>That's all {total}. You've run the gauntlet.</p>}
          {seen && !won && <p className="cb-lead" data-over>{gauntletName(shownG.stage)} held. Try it again whenever you like - you get a new hand each time.</p>}
          {seen && (
            <div className="cb-acts">
              {won && next !== null && next > shownG.stage && <button className="btn solid xl" data-next disabled={busy} onClick={() => beginG(next)}>{busy ? "Dealing…" : `Next: ${gauntletName(next)}`}</button>}
              {!won && <button className="btn solid xl" data-retry disabled={busy} onClick={() => beginG(shownG.stage)}>{busy ? "Dealing…" : "Try again"}</button>}
              {won && <ShareBattle key={attempt(shownG.stage, shownG.hand)} onShare={onShare} text={() => battleShareText({ kind: "gauntlet", rounds: shownG.battle.rounds, stage: shownG.stage, cleared: true, siteUrl })} />}
              <button className="linkbtn" data-back onClick={() => { setShownG(null); setNotice(""); }}>Back to the gauntlet</button>
            </div>
          )}
        </div>
      );
    }
    if (g.stage != null) {
      const foe = gauntletFoe(g.stage);
      if (!foe) return <div className="panel" role="alert"><p><b>This page is out of date.</b> Reload it to carry on with the gauntlet.</p></div>;
      return (
        <div className="cb-area" data-mode="gauntlet" data-phase="play" data-stage={g.stage}>
          <h2 className="cb-h2 cb-result-h">Stage {g.stage + 1} <span className="cb-count">{gauntletName(g.stage)}</span></h2>
          {headStart(g.stage) && <p className="cb-foot" data-head-start>{headStart(g.stage)}</p>}
          {alert}
          {/* A real offense, named on the screen: who you face is the point here, so their six are in view. */}
          <Arena key={attempt(g.stage, g.hand)} hand={g.hand} foe={foe} rounds={g.rounds} edge={gauntletEdge(g.stage)} foeName={gauntletName(g.stage)} busy={busy} onPlay={playG} />
          <div className="cb-acts">
            <button className="linkbtn" data-quit disabled={busy} onClick={giveUp}>Give up this try</button>
          </div>
          <p className="cb-foot">{g.stage === g.cleared ? `Beating them pays ${gauntletCoins(g.stage)} coins, once.` : "You've cleared this stage already, so it pays nothing."} Losing costs nothing.</p>
        </div>
      );
    }
    return (
      <div className="cb-area" data-mode="gauntlet" data-phase="list">
        <h2 className="cb-h2">The gauntlet</h2>
        <p className="cb-lead">{total} real offenses, weakest first. Each is one team's best player at every spot from a five-year stretch. Beat one to open the next.</p>
        <dl className="cb-stats">
          <div><dt>Cleared</dt><dd data-cleared>{g.cleared}</dd></div>
          <div><dt>Stages</dt><dd>{total}</dd></div>
        </dl>
        {alert}
        <ol className="cb-stages">
          {GAUNTLET.map((_, stage) => {
            const foe = gauntletFoe(stage) || [];
            const stars = foe.map((e) => CARDS.get(e.id)).filter(Boolean).sort((a, b) => b.rating - a.rating || a.id - b.id);
            const state = stage < g.cleared ? "cleared" : stage === g.cleared ? "next" : "locked";
            return (
              <li key={stage} className={`cb-stage cb-stage-${state}`} data-stage={stage} data-state={state}>
                <span className="cb-stage-n" aria-hidden="true">{stage + 1}</span>
                <div className="cb-stage-body">
                  <h3 className="cb-stage-h"><span className="vh">Stage {stage + 1}: </span>{gauntletName(stage)}</h3>
                  <p className="cb-stage-who">{state === "locked" ? "Beat the stage before it to see who's here." : stars.slice(0, 3).map((c) => c.name).join(", ")}</p>
                  <p className="cb-stage-meta">
                    <b>{state === "cleared" ? "Cleared" : state === "next" ? "Up next" : "Locked"}</b>
                    {state !== "cleared" && <> · pays {gauntletCoins(stage)} coins</>}
                    {state === "next" && headStart(stage) && <> · {-gauntletEdge(stage)}-point head start</>}
                  </p>
                </div>
                {state === "next" && <button className="btn solid cb-stage-act" data-play disabled={busy} onClick={() => beginG(stage)}>{busy ? "…" : "Play"}</button>}
                {state === "cleared" && <button className="btn sm cb-stage-act" data-replay disabled={busy} onClick={() => beginG(stage)}>Again</button>}
              </li>
            );
          })}
        </ol>
        {g.cleared >= total && <p className="cb-lead" data-all>You've run the gauntlet. Every stage can be played again.</p>}
        <h3 className="cb-h3">How it works</h3>
        <ul className="cb-how">
          <li>A battle is the same six rounds as the ladder - but here you can see who you're facing, stats and all.</li>
          <li>The early stages give you a head start: their cards play a few points short. It shrinks as you go and is gone by stage {GAUNTLET_EVEN + 1}.</li>
          <li>Lose and nothing happens. Try again with a new hand as often as you like.</li>
          <li>Each stage pays once, the first time you beat it.</li>
        </ul>
      </div>
    );
  }

  if (mode === "daily") {
    const day = st.daily;
    const foe = day?.played && day.shown?.foe ? day.shown.foe : dailyFoe(st.today);
    return (
      <div className="cb-area" data-mode="daily" data-phase={!day ? "deal" : day.played ? "played" : "play"}>
        <h2 className="cb-h2">Today's battle</h2>
        {!day && (
          <>
            <p className="cb-lead">One CPU team a day, the same for everyone, and one go at it. Every card has the same luck today whoever plays it, so the board is about which cards you play, where, and what you call.</p>
            <p className="cb-lead">Your hand is dealt once. Set your deck first if you want to - it can't be re-dealt.</p>
            <div className="cb-acts"><button className="btn solid xl" data-deal disabled={busy} onClick={deal}>{busy ? "Dealing…" : "Deal today's hand"}</button></div>
          </>
        )}
        {day && day.played && <p className="cb-lead" data-played>You took <b>{day.rounds}</b> of 6 rounds for <b>{fmt(day.score)}</b> points. One go a day - the next opens at midnight UTC.</p>}
        {day && day.played && day.shown?.rounds && (
          <div className="cb-acts"><ShareBattle onShare={onShare} text={() => battleShareText({ kind: "daily", rounds: day.shown.rounds, day: st.today, score: day.score, siteUrl })} /></div>
        )}
        {alert}
        {/* The day's team is the same for everyone and follows from the date, but it is still not SHOWN before it is played. */}
        {day && <Arena key={st.today} hand={day.hand} foe={day.played ? foe : maskFoe(foe, day.log.length)} rounds={day.played && day.shown?.rounds ? day.shown.rounds : day.log} foeName="CPU" busy={busy} onPlay={playDay} />}
      </div>
    );
  }

  // ---- the ladder ----
  const run = st.run && st.run.status === "live" ? st.run : null;
  if (shown) {
    const seen = seenBattle === shown.battle;
    const paid = shown.coins?.credited > 0;
    return (
      <div className="cb-area" data-mode="run" data-phase="result">
        <h2 className="cb-h2 cb-result-h" tabIndex={-1} ref={top}>{!seen ? `Battle ${shown.step + 1}` : shown.battle.win ? `Win ${shown.wins}` : "Beaten"}</h2>
        {alert}
        {/* The same key the battle had while it was being played, so this is the SAME arena carrying on into its
            sixth round rather than a new one that would show it already finished. */}
        <Arena key={`${shown.id}:${shown.step}`} hand={shown.hand} foe={shown.battle.foe} rounds={shown.battle.rounds} edge={shown.battle.edge} foeName={ladderName(shown.step)}
          onDone={() => { setSeenBattle(shown.battle); top.current?.focus({ preventScroll: true }); }} />
        {seen && shown.battle.win && shown.coins && (
          <p className="cb-lead" data-paid>{paid
            ? <>You earned <Coins amount={shown.coins.credited} size={16} />.</>
            : "That win counts for your run. It paid no coins - today's paid wins are used up."}</p>
        )}
        {seen && <BadgeLine badge={shown.badge} />}
        {seen && shown.over && <p className="cb-lead" data-over>The run ends at <b>{shown.wins}</b> {shown.wins === 1 ? "win" : "wins"}. Your best is {st.best}.</p>}
        {seen && (
          <div className="cb-acts">
            {shown.over
              ? <button className="btn solid xl" data-start disabled={busy} onClick={begin}>{busy ? "Starting…" : "Start a new run"}</button>
              : <button className="btn solid xl" data-next onClick={() => { setShown(null); setNotice(""); }}>Next team</button>}
            {shown.wins > 0 && <ShareBattle key={`${shown.id}:${shown.step}`} onShare={onShare} text={() => battleShareText({ kind: "run", rounds: shown.battle.rounds, wins: shown.wins, siteUrl })} />}
          </div>
        )}
      </div>
    );
  }
  if (!run) {
    return (
      <div className="cb-area" data-mode="run" data-phase="idle">
        <h2 className="cb-h2">The ladder</h2>
        <p className="cb-lead">Beat one CPU team after another. Each is stronger than the last. How high can your deck climb?</p>
        <dl className="cb-stats">
          <div><dt>Best run</dt><dd data-best-run>{st.best}</dd></div>
          <div><dt>Paid wins left today</dt><dd data-paid-left>{paidLeft}</dd></div>
        </dl>
        <div className="cb-acts"><button className="btn solid xl" data-start disabled={busy} onClick={begin}>{busy ? "Starting…" : "Start a run"}</button></div>
        {alert}
        <h3 className="cb-h3">How a battle works</h3>
        <ul className="cb-how">
          <li>You're dealt twelve cards from your deck: 2 quarterbacks, 4 backs, 4 receivers, 2 tight ends.</li>
          <li>Six rounds, one for each spot - a quarterback, two backs, two receivers and a tight end - in a random order.</li>
          <li>Every round is fought on one category, and each of the six is used once. You call the first: pick the category, then the card.</li>
          <li>Whoever wins a round calls the next. When they call, you see the category before you choose who answers it.</li>
          <li>Their card stays face down until yours is played.</li>
          <li>Win more rounds than they do. One lost battle ends the run.</li>
          <li>A win pays {cardWinCoins(1)} coins, plus one for every win the run already has, up to {cardWinCoins(99)}. The first {COIN_RULES.paidCardWinsPerDay} wins of a day pay.</li>
        </ul>
      </div>
    );
  }
  return (
    <div className="cb-area" data-mode="run" data-phase="play">
      <h2 className="cb-h2 cb-result-h">Battle {run.wins + 1} <span className="cb-count">{run.wins} {run.wins === 1 ? "win" : "wins"} so far</span></h2>
      {/* You answer cards you cannot see, so how strong they are is said: the rung's target rating. */}
      <p className="cb-foot" data-level>{ladderName(run.wins)}: their cards rate about {ladderTarget(run.wins)}{ladderEdge(run.wins) > 0 ? ", and play " + fmt(ladderEdge(run.wins)) + " points up" : ""}.</p>
      {alert}
      <Arena key={`${run.id}:${run.wins}`} hand={run.hand} foe={run.foe} rounds={run.rounds} edge={0} foeName={ladderName(run.wins)} busy={busy} onPlay={playCard} />
      <div className="cb-acts">
        <button className="linkbtn" data-quit disabled={busy} onClick={walkAway}>End the run here</button>
      </div>
      <p className="cb-foot">{paidLeft > 0 ? `Winning this battle pays ${cardWinCoins(run.wins + 1)} coins. ${paidLeft} paid ${paidLeft === 1 ? "win" : "wins"} left today.` : "Today's paid wins are used up. Wins still count for your run."}</p>
    </div>
  );
}

export const CARD_BATTLE_CSS = `
.cb-area,.cb-pick{display:grid;gap:16px}
.cb-h2{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(22px,5vw,28px);line-height:1.1;margin:0;color:var(--ink)}
.cb-h2:focus{outline:none}
.cb-h3{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.03em;font-size:18px;margin:0;color:var(--ink)}
.cb-count{font-family:Inter,system-ui,sans-serif;font-size:13px;font-weight:700;letter-spacing:0;text-transform:none;color:var(--muted);margin-left:6px}
.cb-lead,.cb-foot,.cb-rule{margin:0;color:var(--ink);line-height:1.45}
.cb-foot,.cb-rule{color:var(--muted);font-size:14px}
.cb-acts{display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px}
.cb-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}
.cb-stats div{border-top:3px solid var(--ink);padding-top:8px;display:flex;flex-direction:column-reverse;gap:2px}
.cb-stats dt{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.cb-stats dd{margin:0;font-family:var(--display);font-size:44px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-share-text{flex:1 1 100%;width:100%;font:inherit;font-size:16px;padding:8px;border:2px solid var(--ink);border-radius:8px;background:var(--panel);color:var(--ink)}
.cb-how{margin:0;padding-left:20px;display:grid;gap:6px;color:var(--ink);line-height:1.45;font-size:15px}
.cb-list,.cb-opts{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.cb-numbered{counter-reset:cb}
.cb-numbered>li{counter-increment:cb;position:relative;padding-left:26px}
.cb-numbered>li::before{content:counter(cb);position:absolute;left:0;top:12px;font-family:var(--display);font-size:20px;line-height:1;color:var(--muted)}
.cb-opts{margin:8px 0 4px;padding-left:12px;border-left:3px solid var(--line2)}
/* One card as a row: pos, who, rating; then his six category scores, his ability, his synergies. */
.cb-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:6px 10px;border:2px solid var(--btn-line);background:var(--surface);color:var(--ink);border-radius:12px;padding:10px 12px}
.cb-row-dim{background:var(--surface2);border-color:var(--line2)}
.cb-row-gone{font-size:13px;color:var(--muted)}
.cb-pos{font-weight:800;font-size:12px;letter-spacing:.08em;background:var(--ink);color:var(--bg);padding:4px 8px;border-radius:6px;min-width:38px;text-align:center}
.cb-who{display:grid;min-width:0}
.cb-who b{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-sub{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-n{font-family:var(--display);font-size:22px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-n small{font-size:.5em;vertical-align:top;margin-left:1px}
.cb-cats{grid-column:1 / -1;margin:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:4px}
.cb-cats div{display:grid;justify-items:center;gap:1px;border-radius:6px;padding:3px 2px;background:var(--surface2)}
.cb-cats dt{font-size:10.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.cb-cats dd{margin:0;font-weight:800;font-size:14px;color:var(--ink);font-variant-numeric:tabular-nums}
/* A strong category is a FILL with its own ink, never a coloured number: lime on cream is unreadable as text. */
.cb-cats .cb-cat-hi{background:var(--accent)}
.cb-cats .cb-cat-hi dt,.cb-cats .cb-cat-hi dd{color:var(--on-accent)}
.cb-abil{grid-column:1 / -1;font-size:12.5px;line-height:1.35;color:var(--muted)}
.cb-abil b{color:var(--ink)}
.cb-mods{grid-column:1 / -1;margin:0;display:flex;flex-wrap:wrap;gap:6px}
.cb-chip{display:inline-block;font-weight:800;font-size:12px;line-height:1.2;padding:3px 8px;border-radius:999px;border:1.5px solid currentColor;background:var(--surface);white-space:nowrap}
.cb-chip.cb-up{color:var(--win)}
.cb-chip.cb-down{color:var(--loss)}
/* A row's one button sits at the end of its first line, beside the rating - a line of its own cost a hand of
   twelve six hundred pixels. */
.cb-row-act{grid-column:4;grid-row:1}
.cb-row-acts{grid-column:1 / -1;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.cb-vs{font-size:12.5px;font-weight:700;color:var(--muted);margin-right:auto}
.cb-row .btn.sm{position:relative}
.cb-row .btn[aria-pressed="true"]{background:var(--ink);color:var(--bg)}
/* The other side, in the app's navy scoreboard treatment. Its rows are cream cards on the dark panel. */
.cb-foe{background:var(--ink);color:var(--bg);border-radius:14px;padding:16px 14px 14px;display:grid;gap:8px}
.cb-kick{margin:0;font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--surface2)}
.cb-foe-h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(26px,7vw,36px);line-height:1.05;margin:0;color:var(--accent)}
.cb-foe-note{margin:0;font-size:14px;color:var(--bg)}
.cb-foe .cb-numbered>li::before{color:var(--surface2)}
.cb-lineup,.cb-hand,.cb-deck-pos{display:grid;gap:10px}
.cb-lu-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cb-play-bar{position:sticky;bottom:calc(8px + var(--sa-bottom,0px));z-index:2;background:var(--bg);border:2px solid var(--ink);border-radius:14px;padding:10px 12px;box-shadow:4px 4px 0 var(--hard)}
/* ---- the arena ---- */
.cb-result-h .cb-count{vertical-align:middle}
.cb-arena{display:grid;gap:12px;min-width:0}
.cb-sb{position:sticky;top:calc(8px + var(--sa-top,0px));z-index:3;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px;background:var(--ink);color:var(--bg);border-radius:14px;padding:6px 14px;box-shadow:4px 4px 0 var(--hard)}
.cb-sb span{display:block;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--surface2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-sb b{display:block;font-family:var(--display);font-weight:400;font-size:clamp(28px,8vw,40px);line-height:1;font-variant-numeric:tabular-nums}
.cb-sb-you b{color:var(--accent)}
.cb-sb-cpu{text-align:right}
.cb-sb-cpu b{color:var(--bg)}
.cb-sb-mid>span{font-size:12px;color:var(--bg)}
/* The six categories. A chip is a button only while it is yours to call; a spent one says who took it. */
.cb-rack{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.cb-rack li{display:grid;min-width:0}
.cb-k{display:grid;align-content:center;justify-items:center;gap:1px;min-height:44px;min-width:0;padding:5px 4px;border:2px solid var(--btn-line);border-radius:10px;background:var(--surface);color:var(--ink);font-weight:800;font-size:13px;line-height:1.15;text-align:center;position:relative}
.cb-k i{font-style:normal;font-weight:700;font-size:10.5px;letter-spacing:.02em}
.cb-k s{text-decoration-thickness:2px}
button.cb-k{cursor:pointer;box-shadow:2px 2px 0 var(--hard);transition:transform .12s}
button.cb-k[aria-pressed="true"],.cb-k-on{background:var(--accent);color:var(--on-accent);border-color:var(--ink);box-shadow:3px 3px 0 var(--hard)}
button.cb-k:focus-visible,button.cb-sc:focus-visible{outline:4px solid var(--accent-ink);outline-offset:2px}
.cb-tray:focus-visible{outline:3px solid var(--accent-ink);outline-offset:-3px;border-radius:10px}
.cb-k-used{background:var(--surface2);border-color:var(--line2);font-weight:700}
/* The one panel: you choose in it, and the round's result takes its place and stays. */
.cb-panel{display:grid;gap:10px;border:2px solid var(--ink);border-radius:14px;background:var(--surface);color:var(--ink);padding:12px;box-shadow:4px 4px 0 var(--hard);min-width:0}
.cb-callh{margin:0;display:grid;gap:3px}
.cb-callh:focus{outline:none}
.cb-callh b{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(24px,7vw,32px);line-height:1;color:var(--accent-ink)}
.cb-callh span{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.cb-hint{margin:0;font-size:14px;line-height:1.4;color:var(--ink)}
/* The hand for this spot: cards side by side. It scrolls sideways inside the panel; the page never does. */
.cb-tray{list-style:none;margin:0 -12px;padding:10px 12px;display:flex;align-items:flex-end;gap:8px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.cb-tray>li{flex:none;display:grid;gap:4px;scroll-snap-align:start}
.cb-tray-them{padding-right:8px;border-right:2px dashed var(--line2)}
.cb-tray-cap{font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.cb-whole{border-top:2px dashed var(--line2)}
/* One card as a column of stats. Artwork, in CardFace's own paints - it looks the same in every scope. */
.cb-sc{--sc-w:clamp(118px,33vw,140px);--sc-edge:${P.baseEdge};display:block;width:var(--sc-w);padding:3px;border:0;border-radius:11px;background:var(--sc-edge);font-family:Inter,system-ui,sans-serif;text-align:left;color:${P.ink};box-shadow:0 4px 0 rgba(0,0,0,.3);position:relative}
.cb-sc-none{font-size:12px;padding:8px}
button.cb-sc{cursor:pointer;transition:transform .12s}
button.cb-sc:disabled{cursor:default}
.cb-sc-on{outline:4px solid var(--accent-ink);outline-offset:2px;transform:translateY(-3px)}
.cb-f-silver{--sc-edge:linear-gradient(135deg,#e9eef3,#9aa7b4 35%,#f7fafc 50%,#8b98a6 70%,#dde4ea)}
.cb-f-gold{--sc-edge:linear-gradient(135deg,#f9e7a0,#c9952b 35%,#fff4c4 50%,#bd8c26 70%,#f2d675)}
.cb-f-prism{--sc-edge:linear-gradient(135deg,#ff5fa2,#ffd166,#c6f432,#4cc9f0,#b388ff,#ff5fa2)}
.cb-sc-in{display:block;border-radius:8px;overflow:hidden;background:${P.paper};color:${P.ink}}
.cb-sc-art{display:block;position:relative;height:calc(var(--sc-w) * .44);background:linear-gradient(160deg,${P.artHi},${P.artLo});overflow:hidden}
.cb-sc-art::before{content:"";position:absolute;inset:0;background:linear-gradient(112deg,transparent 0 46%,var(--cd-a) 46% 58%,var(--cd-b) 58% 64%,transparent 64%);opacity:.85}
.cb-sc-pos{position:absolute;left:5px;top:5px;font-weight:800;font-size:10px;letter-spacing:.08em;background:${P.ink};color:${P.cream};padding:2px 5px;border-radius:4px;line-height:1.2}
.cb-sc-ovr{position:absolute;left:5px;bottom:4px;font-weight:800;font-size:11px;background:${P.paper};color:${P.ink};padding:1px 5px;border-radius:4px;line-height:1.25;font-variant-numeric:tabular-nums}
.cb-sc-ovr small{font-size:.85em;margin-left:2px}
.cb-sc-fig{position:absolute;right:0;bottom:-18%;height:128%;width:auto;max-width:none;filter:drop-shadow(1px 2px 0 rgba(0,0,0,.22))}
.cb-sc-nm{display:block;font-weight:800;font-size:12.5px;line-height:1.15;padding:5px 6px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-sc-sub{display:block;font-size:10.5px;line-height:1.2;color:${P.muted};padding:1px 6px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-sc-stats{display:block;border-top:2px solid ${P.ink}}
.cb-sc-stats>span{display:flex;justify-content:space-between;align-items:center;gap:3px;padding:2px 6px;font-size:11.5px;line-height:1.3;border-bottom:1px solid ${P.line}}
.cb-sc-stats>span:last-child{border-bottom:0}
.cb-sc-k{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-sc-v{font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.cb-sc-v i{font-style:normal;font-weight:800;font-size:9px;background:${P.ink};color:${P.lime};border-radius:4px;padding:0 2px;margin-left:2px}
/* The category in play is a FILL with ink on it, and a spent one is struck through - never colour alone. */
.cb-sc-stats>.cb-sc-lit{background:${P.lime};font-weight:800}
.cb-sc-lit .cb-sc-v{font-size:14px}
.cb-sc-stats>.cb-sc-gone{color:${P.muted}}
.cb-sc-gone .cb-sc-k,.cb-sc-gone .cb-sc-v{text-decoration:line-through}
.cb-sc-extra{display:flex;justify-content:space-between;padding:3px 6px;font-size:11px;font-weight:700;border-top:2px solid ${P.ink};background:${P.artLo}}
.cb-sel{margin:0;font-size:13px;line-height:1.4;color:var(--ink);display:grid;gap:6px}
.cb-play{width:100%;display:grid;justify-items:center;gap:2px;white-space:normal;height:auto;line-height:1.2;padding-top:12px;padding-bottom:12px}
.cb-play small{font-family:Inter,system-ui,sans-serif;font-size:12.5px;font-weight:700;letter-spacing:0;text-transform:none}
.cb-under{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 16px}
/* The result: two cards, the real number, ONE total a side. It is all there at once - motion is an entrance. */
.cb-duel{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:start;gap:6px}
.cb-side{display:grid;justify-items:center;gap:4px;min-width:0}
.cb-side .cd-card{--cd-w:min(136px,calc((100vw - 110px) / 2));transition:filter .3s}
.cb-side-you .cd-card{animation:cb-slam-l .45s cubic-bezier(.2,1.2,.4,1) both}
.cb-side-cpu .cd-card{animation:cb-slam-r .45s cubic-bezier(.2,1.2,.4,1) both}
.cb-side.cb-win .cd-card{box-shadow:0 0 0 4px var(--accent),0 0 0 7px var(--ink)}
.cb-side.cb-lose .cd-card{filter:grayscale(1) brightness(.8)}
.cb-vsbig{align-self:center;font-family:var(--display);font-size:clamp(22px,7vw,34px);line-height:1;color:var(--muted)}
.cb-real{margin:6px 0 0;font-weight:800;font-size:13.5px;line-height:1.25;text-align:center;color:var(--ink)}
.cb-total{margin:0;font-family:var(--display);font-size:clamp(36px,11vw,48px);line-height:1;color:var(--ink);font-variant-numeric:tabular-nums;animation:cb-pop .35s .3s cubic-bezier(.2,1.4,.4,1) both}
.cb-said{margin:0;font-weight:800;font-size:16px;line-height:1.3;text-align:center;color:var(--ink)}
.cb-rev-acts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;align-items:stretch}
.cb-why{display:grid;gap:8px;border-top:2px solid var(--line2);padding-top:10px}
.cb-why-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cb-maths{display:grid;gap:4px;align-content:start;min-width:0}
.cb-maths-h{margin:0;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-stats2{margin:0;width:100%;display:grid;gap:2px}
.cb-stats2 div{display:flex;justify-content:space-between;gap:6px;border-bottom:1px solid var(--line2);padding:2px 2px;font-size:13px}
.cb-stats2 dt{color:var(--muted);font-weight:600}
.cb-stats2 dd{margin:0;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-stats2 small{font-weight:600;color:var(--muted);font-size:.8em}
.cb-stats2 .cb-tot{border-bottom:0;padding-top:4px}
.cb-stats2 .cb-tot dt{color:var(--ink);font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.06em;align-self:center}
.cb-stats2 .cb-tot dd{font-family:var(--display);font-weight:400;font-size:24px;line-height:1}
.cb-idle{margin:0;font-size:11.5px;font-weight:600;color:var(--muted)}
.cb-finale{display:grid;gap:6px;justify-items:start}
.cb-stamp{margin:0;font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(40px,13vw,64px);line-height:1;padding:8px 16px 6px;border-radius:14px;border:3px solid var(--ink);box-shadow:5px 5px 0 var(--hard);transform:rotate(-3deg);animation:cb-stamp .45s cubic-bezier(.2,1.5,.4,1) both}
.cb-won .cb-stamp{background:var(--accent);color:var(--on-accent)}
.cb-lost .cb-stamp{background:var(--ink);color:var(--bg)}
.cb-verdict{margin:8px 0 0;font-weight:800;font-size:17px;line-height:1.3;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-margin{margin:0;color:var(--muted);font-size:15px;line-height:1.4}
/* The field: a night pitch. It carries the dark class, so every token inside it is the navy scoreboard
   scope's wherever the screen around it is drawn - the same way .result-hero and .reel are always dark. It has
   no colour of its own: the floodlights and yard lines are white laid over that scope's navy. */
.cb-field{display:grid;gap:8px;border-radius:16px;padding:14px 10px 14px;color:var(--ink);overflow:hidden;
  background:repeating-linear-gradient(180deg,transparent 0 54px,rgba(255,255,255,.08) 54px 56px),radial-gradient(ellipse 130% 75% at 50% -10%,rgba(255,255,255,.18),transparent 70%),var(--surface2)}
.cb-field-h{margin:0;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink);text-align:center}
/* Their six: a row of small face-down cards along the far side, turned over as each is played. */
.cb-them{list-style:none;margin:0 0 6px;padding:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
.cb-t{display:grid;justify-items:center;align-content:center;gap:2px;min-width:0;min-height:52px;border:1.5px solid var(--ink);border-radius:8px;padding:5px 2px;background:var(--bg);color:var(--ink);text-align:center}
.cb-t-back{border-style:dashed;background:repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 6px,transparent 6px 12px),var(--bg)}
.cb-t-pos{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.cb-t-nm{font-size:11.5px;font-weight:800;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-t-back .cb-t-nm{font-family:var(--display);font-weight:400;font-size:18px;line-height:1}
.cb-t-beat .cb-t-nm{text-decoration:line-through}
.cb-t-won{background:var(--ink);color:var(--bg)}
/* Your six: real cards, three across and two down. */
.cb-strip{--cb-w:min(172px,calc((100vw - 96px) / 3));list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));justify-items:center;gap:12px 6px}
.cb-s{display:grid;justify-items:center;gap:6px;min-width:0;text-align:center}
.cb-s .cd-card{--cd-w:var(--cb-w);margin-bottom:calc(var(--cd-u) * 6);animation:cb-pop .35s cubic-bezier(.2,1.4,.4,1) both;transition:filter .3s}
.cb-slot{display:grid;align-content:center;justify-items:center;gap:4px;width:var(--cb-w);height:calc(var(--cb-w) * 252 / 172);margin-bottom:calc(var(--cb-w) * 6 / 172);border:2px dashed var(--ink);border-radius:calc(var(--cb-w) * 12 / 172);background:rgba(0,0,0,.22);color:var(--ink)}
.cb-slot b{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(22px,7vw,30px);line-height:1}
.cb-slot i{font-style:normal;font-size:11px;font-weight:700;letter-spacing:.04em}
.cb-s-res{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--ink);border-radius:999px;padding:2px 8px;line-height:1.3}
.cb-s-pos{font-weight:800}
.cb-s-now .cb-slot{border-style:solid;border-color:var(--accent);background:rgba(0,0,0,.3);box-shadow:0 0 0 3px var(--accent)}
.cb-s-now .cb-s-res,.cb-s-won .cb-s-res{background:var(--accent);color:var(--on-accent)}
.cb-s-won .cd-card{box-shadow:0 0 0 3px var(--accent),0 calc(var(--cd-u) * 6) 0 rgba(0,0,0,.35)}
.cb-s-lost .cd-card{filter:grayscale(1) brightness(.75)}
.cb-log{display:grid;gap:8px;border-top:2px solid var(--ink);padding-top:12px}
.cb-rounds{list-style:none;margin:0;padding:0;display:grid;gap:8px;counter-reset:cbr}
.cb-round{counter-increment:cbr;display:grid;gap:2px;border-left:5px solid var(--line2);padding:2px 0 2px 10px}
.cb-round-me{border-left-color:var(--win)}
.cb-round-foe{border-left-color:var(--loss)}
.cb-round-cat{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.cb-round-cat::before{content:"Round " counter(cbr) " · "}
.cb-round-line{font-size:14.5px;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-round-why{font-size:12.5px;line-height:1.4;color:var(--muted)}
.cb-stages{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.cb-stage{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px 12px;border:2px solid var(--btn-line);background:var(--surface);color:var(--ink);border-radius:12px;padding:10px 12px}
.cb-stage-locked{background:var(--surface2);border-color:var(--line2)}
.cb-stage-next{box-shadow:4px 4px 0 var(--ink)}
.cb-stage-n{font-family:var(--display);font-size:28px;line-height:1;color:var(--muted);min-width:28px;text-align:center}
.cb-stage-cleared .cb-stage-n{color:var(--ink)}
.cb-stage-body{display:grid;gap:2px;min-width:0}
.cb-stage-h{margin:0;font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:20px;line-height:1.1;color:var(--ink)}
.cb-stage-who,.cb-stage-meta{margin:0;font-size:13px;line-height:1.35;color:var(--muted)}
.cb-stage-who{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-stage-meta b{color:var(--ink)}
.cb-boards{display:grid;gap:14px}
.cb-board caption{text-align:left;font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.03em;font-size:18px;padding-bottom:6px;color:var(--ink)}
@keyframes cb-pop{from{transform:translateY(-8px) scale(.8)}to{transform:none}}
@keyframes cb-stamp{from{transform:rotate(8deg) scale(2.2)}to{transform:rotate(-3deg) scale(1)}}
@keyframes cb-slam-l{from{transform:translateX(-120%) rotate(-12deg)}to{transform:none}}
@keyframes cb-slam-r{from{transform:translateX(120%) rotate(12deg)}to{transform:none}}
@media (hover:hover){
  button.cb-k:hover:not(:disabled),button.cb-sc:hover:not(:disabled){transform:translateY(-2px)}
}
@media (max-width:360px){
  .cb-cats dt{font-size:9.5px}
  .cb-t-nm{font-size:10.5px}
  .cb-k{font-size:12px}
}
@media (pointer:coarse){
  .cb-row .btn.sm{min-height:44px;min-width:44px}
}
@media (prefers-reduced-motion:reduce){
  .cb-side .cd-card,.cb-s .cd-card,.cb-total,.cb-stamp{animation:none}
  .cb-side .cd-card,.cb-s .cd-card,button.cb-k,button.cb-sc{transition:none}
  .cb-sc-on,button.cb-k:hover,button.cb-sc:hover{transform:none}
}
`;
