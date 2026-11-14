// Card battles: the ladder, the daily battle, the deck and the two boards. See CARDS.md 11.
//
// OFFENSE AGAINST OFFENSE (v2.27.0, the owner's redesign): a deck of thirty, a hand of twelve dealt from it, six
// of the hand fielded in an order you choose, against a CPU's six - the same kind of cards you collect. Six
// rounds, each on a category nobody knows until it is played.
//
// A screen in its own file, like cards.jsx, which mounts it: it styles only its own cb- prefix, reuses the app's
// .btn / .note / .panel / .lb, and never imports perfect-season.jsx or cards.jsx back.
//
// NOTHING HERE DECIDES A BATTLE. The browser picks six cards and their order and sends them; the card-claim Edge
// Function deals the hand, rolls the luck, orders the categories, says who won and pays. What this file works
// out for itself is only what a player needs BEFORE playing - what fits, what a lineup's synergies are - and all
// of it comes from card-logic.mjs, the module the function scores with.
//
// A FAILED PLAY IS NOT "NOT PLAYED". offline, network and server may each follow a battle that WAS played and
// whose answer was lost. So the screen never replays to find out: it reads card_battle_state, which says where
// things really stand and carries the latest battle, and shows that. A battle cannot be played twice either way.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBattleState, fetchCardBoards, startRun, playBattle, endRun, saveDeck, dealDaily, playDaily } from "./storage.js";
import {
  CARDS, CATEGORIES, FINISH_BONUS, DECK_SHAPE, HAND_SHAPE, POSITIONS, TEAM_SIZE, archetypeLabel, categoryLabel, abilityOf,
  deckProblem, bestDeck, teamProblem, bestTeam, teamSynergies, ladderName, dailyFoe,
} from "./card-logic.mjs";
import { COIN_RULES, cardWinCoins } from "./rewards.mjs";
import { Coins, NameLink } from "./cosmetics.jsx";
import { CardFace } from "./card-face.jsx";

// A deck's, a team's and a run's own refusals, as sentences. cards.jsx folds these into CARD_SENTENCES, so the
// test that holds that map to storage-cards.js's CARD_REFUSALS holds these too.
export const LINEUP_SENTENCES = {
  incomplete: "Pick six cards first.",
  unknown_card: "One of those cards isn't one this version of the game knows. Reload the page and pick again.",
  bad_finish: "That didn't go through. Reload the page and pick again.",
  bad_slot: "A team is one quarterback, and at least one back, one receiver and one tight end.",
  same_player: "The same player can't be in there twice, even in two different seasons.",
  not_owned: "One of those cards isn't in your collection any more. Pick again.",
  not_in_hand: "One of those cards wasn't dealt to you for this battle. Pick from your hand.",
  bad_deck: "A deck is 5 quarterbacks, 10 backs, 10 receivers and 5 tight ends.",
  no_deck: "You need a full deck first: 5 quarterbacks, 10 backs, 10 receivers and 5 tight ends.",
  no_hand: "Today's hand hasn't been dealt yet. Deal it first.",
  no_run: "That run is over. Start a new one.",
  stale: "That run has moved on since this page loaded. Here is where it stands now.",
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

// ---------- picking six, and their order ----------
// hand and foe are [{ id, finish }]; the foe's order is the order they play in. onPlay(team) plays.
export function TeamPicker({ hand, foe, foeName, kicker, onPlay, busy, playLabel = "Play this battle", confirm = null, children }) {
  const [team, setTeam] = useState([]);
  const [asking, setAsking] = useState(false);
  const held = team.filter((e) => hand.some((h) => same(h, e)));
  const problem = held.length < TEAM_SIZE ? "incomplete" : teamProblem(held, hand);
  const synergies = held.length ? teamSynergies(held) : [];
  const foeSyn = teamSynergies(foe);
  const count = { QB: 0, RB: 0, WR: 0, TE: 0 };
  for (const e of held) count[CARDS.get(e.id).pos]++;
  const toggle = (e) => { setAsking(false); setTeam(held.some((t) => same(t, e)) ? held.filter((t) => !same(t, e)) : held.length < TEAM_SIZE ? [...held, e] : held); };
  const move = (i, by) => { const j = i + by; if (j < 0 || j >= held.length) return; const next = held.slice(); [next[i], next[j]] = [next[j], next[i]]; setTeam(next); setAsking(false); };
  const hint = held.length < TEAM_SIZE
    ? `Pick ${TEAM_SIZE - held.length} more. You need one quarterback and at least one back, one receiver and one tight end.`
    : problem ? LINEUP_SENTENCES[problem] : "";
  return (
    <div className="cb-pick">
      <section className="cb-foe" aria-labelledby="cb-foe-h">
        <p className="cb-kick">{kicker}</p>
        <h2 className="cb-foe-h" id="cb-foe-h">{foeName}</h2>
        <p className="cb-foe-note">Their six, in the order they play. Your first card meets their first.</p>
        <ol className="cb-list cb-numbered">
          {foe.map((e, i) => <li key={keyOf(e)} data-foe={i}><CardRow entry={e} mods={foeSyn[i]} /></li>)}
        </ol>
      </section>

      <section className="cb-lineup" aria-labelledby="cb-lu-h">
        <div className="cb-lu-top">
          <h3 className="cb-h3" id="cb-lu-h">Your six, in playing order</h3>
          <button className="btn sm" data-best disabled={busy} onClick={() => { setTeam(bestTeam(hand) || []); setAsking(false); }}>Pick for me</button>
        </div>
        <p className="cb-rule">Six rounds, each on a different category: {CATEGORIES.map((c) => c.label).join(", ")}. Each comes up once, in an order nobody knows.</p>
        {held.length === 0
          ? <p className="note">Tap cards in your hand to add them.</p>
          : (
            <ol className="cb-list cb-numbered" data-team>
              {held.map((e, i) => (
                <li key={keyOf(e)} data-spot={i}>
                  <CardRow entry={e} mods={synergies[i]}>
                    <span className="cb-row-acts">
                      <span className="cb-vs">vs {CARDS.get(foe[i].id)?.name}</span>
                      <button className="btn sm" aria-label={`Move ${CARDS.get(e.id).name} earlier`} data-up disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button className="btn sm" aria-label={`Move ${CARDS.get(e.id).name} later`} data-down disabled={busy || i === held.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button className="btn sm" aria-label={`Take ${CARDS.get(e.id).name} out`} data-out disabled={busy} onClick={() => toggle(e)}>✕</button>
                    </span>
                  </CardRow>
                </li>
              ))}
            </ol>
          )}
        {hint && <p className="note" data-hint>{hint}</p>}
      </section>

      <section className="cb-hand" aria-labelledby="cb-hand-h">
        <h3 className="cb-h3" id="cb-hand-h">Your hand <span className="cb-count">{hand.length} dealt</span></h3>
        <ul className="cb-list">
          {hand.map((e) => {
            const picked = held.some((t) => same(t, e));
            const full = !picked && held.length >= TEAM_SIZE;
            const twoQb = !picked && CARDS.get(e.id).pos === "QB" && count.QB >= 1;
            return (
              <li key={keyOf(e)}>
                <CardRow entry={e} dim={picked}>
                  <button className="btn sm cb-row-act" data-hand={e.id} data-finish={e.finish} aria-pressed={picked} disabled={busy || full || twoQb} onClick={() => toggle(e)}>{picked ? "In" : "Add"}</button>
                </CardRow>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="cb-acts cb-play-bar">
        <button className="btn solid xl" data-play disabled={busy || !!problem}
          onClick={() => { if (confirm && !asking) { setAsking(true); return; } onPlay(held); }}>
          {busy ? "Playing…" : confirm && asking ? confirm : playLabel}
        </button>
        {confirm && asking && !busy && <button className="btn" onClick={() => setAsking(false)}>Cancel</button>}
        {children}
      </div>
    </div>
  );
}

// ---------- the arena ----------
// One battle, PLAYED OUT round by round. battle is what the function reported:
//   { team, foe, edge, rounds: [{ cat, mine, foe, win, score: [you, them] }], wins, losses, total, foeTotal, win }
//   mine / foe: { id, finish, rating, score, base, roll, mods, total, ability: { name, on, cancelled } | null, line }
//
// The owner's layout (2026-11-14): a centre arena with your active card on the left, theirs on the right and a
// big VS between, the stat comparison under them and the round's winner called; your six below with the active
// one lit; and the battle's information - round, score, speed, a log, what is in play.
//
// The outcome is the server's and is already known when this draws: the playback only decides WHEN it is shown.
// So the parent hides the heading, the coins and the next button until onDone. It plays in a browser that says
// it does not mind motion and is simply finished everywhere else - reduced motion, no matchMedia (jsdom, so
// every test sees the finished battle), or `instant` for a battle opened again later. Nothing in it fades: text
// at half opacity is below AA for as long as a fade lasts, so a beaten card is greyed with a filter instead.
function plays() {
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}
// A round has four beats: the two cards land and the category is called (0), the numbers come up (1), they
// clash (2), the winner is called (3).
const BEATS = [900, 1300, 700, 1300];
const SPEEDS = [[1, "Normal"], [2, "Fast"]];

function Side({ who, card, shot, beat, won, lost }) {
  const c = CARDS.get(card.id);
  const state = beat >= 3 ? (won ? " cb-win" : lost ? " cb-lose" : "") : beat === 2 ? " cb-charge" : "";
  return (
    <div className={`cb-side cb-side-${who}${state}${card.finish === "prism" || card.finish === "gold" ? " cb-rare" : ""}`}>
      {c ? <CardFace card={c} finish={card.finish} /> : <span className="cb-row-gone">A card this page doesn't know</span>}
      {beat >= 1 && (
        <dl className="cb-stats2">
          <div><dt>Category</dt><dd>{shot.score}</dd></div>
          <div><dt>Base</dt><dd>{fmt(shot.base)}</dd></div>
          <div><dt>Luck</dt><dd>{signed(shot.roll)}</dd></div>
          <div className="cb-tot"><dt>Total</dt><dd>{fmt(shot.total)}</dd></div>
        </dl>
      )}
      {beat >= 1 && (
        <p className="cb-trig">
          {shot.mods.map((m) => <Chip key={m.key} pts={m.pts} label={m.label} />)}
          {shot.ability && !shot.mods.some((m) => m.key === "ability") && (
            <span className="cb-idle">{shot.ability.name}: {shot.ability.cancelled ? "cancelled" : shot.ability.on ? "in play" : "not this round"}</span>
          )}
        </p>
      )}
    </div>
  );
}

export function Arena({ battle, bench = [], foeName = "CPU", instant = false, onDone }) {
  const n = battle.rounds.length;
  const [at, setAt] = useState(() => (instant || !plays() ? { round: n, beat: 0 } : { round: 0, beat: 0 }));
  const [speed, setSpeed] = useState(1);
  const done = at.round >= n;
  useEffect(() => {
    if (done) { onDone?.(); return undefined; }
    const timer = setTimeout(() => setAt((a) => (a.beat < 3 ? { round: a.round, beat: a.beat + 1 } : { round: a.round + 1, beat: 0 })), BEATS[at.beat] / speed);
    return () => clearTimeout(timer);
  }, [at, done, speed]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownRound = Math.min(at.round, n - 1);
  const r = battle.rounds[shownRound];
  const settled = done ? n : at.beat >= 3 ? at.round + 1 : at.round; // rounds whose result is on the board
  const score = settled > 0 ? battle.rounds[settled - 1].score : [0, 0];
  const verdict = battle.win
    ? `You won, ${battle.wins} rounds to ${battle.losses}.`
    : `You lost, ${battle.wins} rounds to ${battle.losses}.`;
  const tied = battle.wins === battle.losses;
  const name = (side) => CARDS.get(side.id)?.name || "A card";
  return (
    <section className={`cb-arena${done ? (battle.win ? " cb-won" : " cb-lost") : ""}`} aria-label="The battle" data-done={String(done)} data-win={String(!!battle.win)}>
      <div className="cb-sb">
        <div className="cb-sb-you"><span>You</span><b data-you>{score[0]}</b></div>
        <div className="cb-sb-mid">
          <span data-round>{done ? "Final" : `Round ${at.round + 1} of ${n}`}</span>
          {!done && (
            <span className="cb-speed" role="group" aria-label="Speed">
              {SPEEDS.map(([s, label]) => <button key={s} className="cb-spd" aria-pressed={speed === s} onClick={() => setSpeed(s)}>{label}</button>)}
              <button className="cb-spd" data-skip onClick={() => setAt({ round: n, beat: 0 })}>Skip</button>
            </span>
          )}
        </div>
        <div className="cb-sb-cpu"><span>{foeName}</span><b data-cpu>{score[1]}</b></div>
      </div>

      {!done && (
        <div className="cb-ring" key={at.round} data-beat={at.beat}>
          <p className="cb-cat"><span>Round {at.round + 1}</span><b>{categoryLabel(r.cat)}</b></p>
          <div className="cb-duel">
            <Side who="you" card={battle.team[at.round]} shot={r.mine} beat={at.beat} won={r.win === "me"} lost={r.win === "foe"} />
            <div className="cb-vsbig" aria-hidden="true"><span>VS</span>{at.beat === 2 && <i className="cb-burst" />}</div>
            <Side who="cpu" card={battle.foe[at.round]} shot={r.foe} beat={at.beat} won={r.win === "foe"} lost={r.win === "me"} />
          </div>
          {at.beat >= 3 && <p className="cb-call" aria-hidden="true">{r.win === "me" ? "Round to you" : r.win === "foe" ? `Round to ${foeName}` : "Dead heat"}</p>}
        </div>
      )}

      {done && (
        <div className="cb-finale">
          <p className="cb-stamp" aria-hidden="true">{battle.win ? "\u{1F3C8} Win" : "\u{1F480} Beaten"}</p>
          <p className="cb-verdict" role="status" data-verdict>{verdict}</p>
          <p className="cb-margin">{tied ? `Level on rounds, so it went to total points: ${fmt(battle.total)} to ${fmt(battle.foeTotal)}.` : `Total points ${fmt(battle.total)} to ${fmt(battle.foeTotal)}.`}{battle.edge > 0 ? ` Their cards played ${fmt(battle.edge)} points up - the top of the ladder.` : ""}</p>
        </div>
      )}

      <ol className="cb-strip" aria-label="Your six">
        {battle.team.map((e, i) => {
          const c = CARDS.get(e.id);
          const res = i < settled ? battle.rounds[i].win : null;
          const state = res === "me" ? "cb-s-won" : res === "foe" ? "cb-s-lost" : res === "tie" ? "cb-s-tie" : !done && i === at.round ? "cb-s-now" : "cb-s-wait";
          return (
            <li key={keyOf(e)} className={`cb-s ${state} cb-f-${e.finish}`}>
              <span className="cb-s-pos">{c?.pos}</span>
              <span className="cb-s-nm">{c ? c.name.split(" ").slice(-1)[0] : "?"}</span>
              <span className="cb-s-res">{res === "me" ? "Won" : res === "foe" ? "Lost" : res === "tie" ? "Tied" : !done && i === at.round ? "Up now" : `${i + 1}`}</span>
            </li>
          );
        })}
      </ol>
      {bench.length > 0 && (
        <p className="cb-bench"><b>Bench:</b> {bench.map((e) => CARDS.get(e.id)?.name).filter(Boolean).join(", ")}</p>
      )}

      {settled > 0 && (
        <div className="cb-log">
          <h3 className="cb-h3">Battle log</h3>
          <ol className="cb-rounds">
            {battle.rounds.slice(0, settled).map((x, i) => (
              <li key={i} className={`cb-round cb-round-${x.win}`} data-round-win={x.win}>
                <span className="cb-round-cat">{categoryLabel(x.cat)}</span>
                <span className="cb-round-line">
                  <b>{name(x.mine)}</b> {fmt(x.mine.total)} {x.win === "me" ? "beat" : x.win === "foe" ? "lost to" : "tied"} <b>{name(x.foe)}</b> {fmt(x.foe.total)}
                </span>
                <span className="cb-round-why">
                  {x.mine.line}. Category {x.mine.score} to {x.foe.score}, luck {signed(x.mine.roll)} to {signed(x.foe.roll)}.
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
    </div>
  );
}

// mode: "run" (the ladder) | "daily" | "deck" | "boards". rows: the collection, [{ id, finish, count, card }].
export function BattleArea({ mode, rows, onBalance }) {
  const [st, setSt] = useState(null); // null: loading. "error" | "signed_out". Or the battle state.
  const [shown, setShown] = useState(null); // the ladder battle just played: { battle, coins, wins, over, bench }
  // WHICH battle has finished playing out - the battle itself, not a flag. A flag reset in an effect on `shown`
  // is reset AFTER the child's own effect has reported it done (children's effects run first), and stuck at false.
  const [seenBattle, setSeenBattle] = useState(null);
  const [freshDay, setFreshDay] = useState(false); // today's battle was played just now, on this screen
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
  useEffect(() => { setNotice(""); }, [mode]);
  useEffect(() => { if (shown) top.current?.focus(); }, [shown]);

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

  // After a play whose answer never came, or one the function called stale: ask where things really stand.
  async function settle(reason, run) {
    const fresh = await fetchBattleState();
    if (!live.current) return;
    if (fresh.status !== "ok") { setNotice(UNCONFIRMED); return; }
    setSt(fresh);
    const moved = run && fresh.run && fresh.run.id === run.id && (fresh.run.wins !== run.wins || fresh.run.status !== "live");
    if (moved && fresh.run.last) {
      setShown({ battle: fresh.run.last, coins: null, wins: fresh.run.wins, over: fresh.run.status !== "live", bench: [] });
      setNotice("That battle was played - its answer just didn't reach this page. Here is how it went.");
      return;
    }
    setNotice(UNKNOWN.includes(reason) ? `${say(reason)} That battle was not played.` : say(reason));
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
  async function fight(team) {
    const run = st.run;
    if (busy || !run) return;
    setBusy(true); setNotice("");
    const res = await playBattle(run.id, run.wins, team);
    if (!live.current) return;
    if (res.ok) {
      setBusy(false);
      if (typeof res.coins?.balance === "number") onBalance?.(res.coins.balance);
      const bench = run.hand.filter((h) => !team.some((t) => same(t, h)));
      setSt((s) => ({ ...s, run: { ...res.run, last: res.battle }, best: Math.max(s.best, res.run.wins), paidToday: s.paidToday + (res.coins?.credited > 0 ? 1 : 0) }));
      setShown({ battle: res.battle, coins: res.coins, wins: res.run.wins, over: res.run.status !== "live", bench });
      return;
    }
    if (UNKNOWN.includes(res.reason) || res.reason === "stale" || res.reason === "no_run") await settle(res.reason, run);
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
  async function playDay(team) {
    if (busy) return;
    setBusy(true); setNotice("");
    const res = await playDaily(team);
    if (!live.current) return;
    if (res.ok) { setBusy(false); setFreshDay(true); setSt((s) => ({ ...s, daily: res.daily })); return; }
    if (UNKNOWN.includes(res.reason) || res.reason === "duplicate") {
      // Either it went through and the answer was lost, or it was already played somewhere else: the state says.
      const fresh = await fetchBattleState();
      if (!live.current) return;
      if (fresh.status === "ok") { setSt(fresh); setNotice(fresh.daily?.played ? "" : `${say(res.reason)} Today's battle was not played.`); }
      else setNotice(UNCONFIRMED);
    } else setNotice(say(res.reason));
    setBusy(false);
  }

  const paidLeft = Math.max(0, COIN_RULES.paidCardWinsPerDay - st.paidToday);
  const alert = notice && <p className="note" role="alert" data-notice>{notice}</p>;

  if (mode === "daily") {
    const day = st.daily;
    const foe = dailyFoe(st.today);
    return (
      <div className="cb-area" data-mode="daily" data-phase={!day ? "deal" : day.played ? "played" : "pick"}>
        {!day && (
          <>
            <h2 className="cb-h2">Today's battle</h2>
            <p className="cb-lead">One CPU team a day, the same for everyone, and one go at it. Every card has the same luck today whoever plays it, so the board is about the six you pick and the order you put them in.</p>
            <p className="cb-lead">Your hand is dealt once. Set your deck first if you want to - it can't be re-dealt.</p>
            <div className="cb-acts"><button className="btn solid xl" data-deal disabled={busy} onClick={deal}>{busy ? "Dealing…" : "Deal today's hand"}</button></div>
          </>
        )}
        {day && !day.played && (
          <TeamPicker hand={day.hand} foe={foe} foeName="Today's team" kicker="Today's battle · one go" busy={busy} onPlay={playDay}
            playLabel="Play today's battle" confirm="Confirm: this is my one go" />
        )}
        {day && day.played && (
          <>
            <h2 className="cb-h2">Today's battle</h2>
            <p className="cb-lead" data-played>You took <b>{day.rounds}</b> of 6 rounds for <b>{fmt(day.score)}</b> points. One go a day - the next opens at midnight UTC.</p>
            {day.shown?.rounds && <Arena battle={day.shown} foeName="CPU" instant={!freshDay} bench={day.hand.filter((h) => !day.shown.team.some((t) => same(t, h)))} />}
          </>
        )}
        {alert}
      </div>
    );
  }

  // ---- the ladder ----
  const run = st.run && st.run.status === "live" ? st.run : null;
  if (shown) {
    const seen = seenBattle === shown.battle;
    const paid = shown.coins?.credited > 0;
    const number = shown.battle.win ? shown.wins : shown.wins + 1;
    return (
      <div className="cb-area" data-mode="run" data-phase="result">
        <h2 className="cb-h2 cb-result-h" tabIndex={-1} ref={top}>{!seen ? `Battle ${number}` : shown.battle.win ? `Win ${shown.wins}` : "Beaten"}</h2>
        {alert}
        <Arena key={`${shown.wins}:${shown.battle.total}`} battle={shown.battle} bench={shown.bench} foeName={ladderName(number - 1)} onDone={() => setSeenBattle(shown.battle)} />
        {seen && shown.battle.win && shown.coins && (
          <p className="cb-lead" data-paid>{paid
            ? <>You earned <Coins amount={shown.coins.credited} size={16} />.</>
            : "That win counts for your run. It paid no coins - today's paid wins are used up."}</p>
        )}
        {seen && shown.over && <p className="cb-lead" data-over>The run ends at <b>{shown.wins}</b> {shown.wins === 1 ? "win" : "wins"}. Your best is {st.best}.</p>}
        {seen && (
          <div className="cb-acts">
            {shown.over
              ? <button className="btn solid xl" data-start disabled={busy} onClick={begin}>{busy ? "Starting…" : "Start a new run"}</button>
              : <button className="btn solid xl" data-next onClick={() => { setShown(null); setNotice(""); }}>Next team</button>}
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
          <li>You're dealt twelve cards from your deck. Pick six, and the order they play in.</li>
          <li>You see the other team's six, and their order, before you choose.</li>
          <li>Six rounds, each on a different category. Win more rounds than they do.</li>
          <li>One loss ends the run. A win pays {cardWinCoins(1)} coins, plus one for every win the run already has, up to {cardWinCoins(99)}. The first {COIN_RULES.paidCardWinsPerDay} wins of a day pay.</li>
        </ul>
      </div>
    );
  }
  return (
    <div className="cb-area" data-mode="run" data-phase="pick">
      <TeamPicker key={`${run.id}:${run.wins}`} hand={run.hand} foe={run.foe} foeName={ladderName(run.wins)}
        kicker={`Battle ${run.wins + 1} of your run · ${run.wins} ${run.wins === 1 ? "win" : "wins"} so far`} busy={busy} onPlay={fight}>
        <button className="linkbtn" data-quit disabled={busy} onClick={walkAway}>End the run here</button>
      </TeamPicker>
      <p className="cb-foot">{paidLeft > 0 ? `A win here pays ${cardWinCoins(run.wins + 1)} coins. ${paidLeft} paid ${paidLeft === 1 ? "win" : "wins"} left today.` : "Today's paid wins are used up. Wins still count for your run."}</p>
      {alert}
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
.cb-arena{display:grid;gap:14px}
.cb-sb{position:sticky;top:calc(8px + var(--sa-top,0px));z-index:3;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;background:var(--ink);color:var(--bg);border-radius:14px;padding:10px 14px;box-shadow:4px 4px 0 var(--hard)}
.cb-sb span{display:block;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--surface2)}
.cb-sb b{display:block;font-family:var(--display);font-weight:400;font-size:clamp(40px,12vw,56px);line-height:1;font-variant-numeric:tabular-nums}
.cb-sb-you b{color:var(--accent)}
.cb-sb-cpu{text-align:right}
.cb-sb-cpu b{color:var(--bg)}
.cb-sb-mid{display:grid;justify-items:center;gap:6px}
.cb-sb-mid>span:first-child{font-size:12px;color:var(--bg)}
.cb-speed{display:flex;gap:4px}
.cb-spd{border:1.5px solid var(--surface2);background:transparent;color:var(--bg);font-weight:800;font-size:11px;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:4px 8px;position:relative}
.cb-spd[aria-pressed="true"]{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
.cb-spd:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.cb-ring{display:grid;gap:10px}
.cb-cat{margin:0;display:grid;justify-items:center;gap:2px;animation:cb-drop .45s cubic-bezier(.2,1.4,.4,1) both}
.cb-cat span{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.cb-cat b{font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(28px,8vw,40px);line-height:1;color:var(--ink)}
.cb-duel{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:start;gap:6px}
.cb-side{display:grid;justify-items:center;gap:8px;min-width:0}
.cb-side .cd-card{--cd-w:min(150px,calc((100vw - 96px) / 2));transition:transform .3s cubic-bezier(.2,1.3,.4,1),filter .3s}
.cb-side-you .cd-card{animation:cb-slam-l .5s cubic-bezier(.2,1.2,.4,1) both}
.cb-side-cpu .cd-card{animation:cb-slam-r .5s cubic-bezier(.2,1.2,.4,1) both}
/* The clash: both cards lunge at the middle. Then the winner stands tall and the loser is knocked back and greyed. */
.cb-side-you.cb-charge .cd-card{transform:translateX(14px) rotate(4deg) scale(1.04)}
.cb-side-cpu.cb-charge .cd-card{transform:translateX(-14px) rotate(-4deg) scale(1.04)}
.cb-side.cb-win .cd-card{transform:scale(1.06);box-shadow:0 0 0 4px var(--accent),0 0 0 7px var(--ink)}
.cb-side.cb-lose .cd-card{filter:grayscale(1) brightness(.8);animation:cb-shake .45s both}
.cb-rare .cd-card{box-shadow:0 0 0 3px var(--violet)}
.cb-vsbig{position:relative;align-self:center;margin-top:60px;font-family:var(--display);font-size:clamp(26px,8vw,40px);line-height:1;color:var(--ink);animation:cb-vs .5s .25s cubic-bezier(.2,1.6,.4,1) both}
.cb-burst{position:absolute;left:50%;top:50%;width:90px;height:90px;margin:-45px 0 0 -45px;border-radius:50%;background:radial-gradient(circle,var(--accent) 0 35%,transparent 36%),conic-gradient(from 0deg,var(--orange) 0 10%,transparent 10% 20%,var(--orange) 20% 30%,transparent 30% 40%,var(--orange) 40% 50%,transparent 50% 60%,var(--orange) 60% 70%,transparent 70% 80%,var(--orange) 80% 90%,transparent 90%);z-index:-1;animation:cb-boom .6s both}
.cb-stats2{margin:0;width:100%;display:grid;gap:2px;animation:cb-pop .35s cubic-bezier(.2,1.4,.4,1) both}
.cb-stats2 div{display:flex;justify-content:space-between;gap:6px;border-bottom:1px solid var(--line2);padding:2px 2px;font-size:13px}
.cb-stats2 dt{color:var(--muted);font-weight:600}
.cb-stats2 dd{margin:0;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-stats2 .cb-tot{border-bottom:0;padding-top:4px}
.cb-stats2 .cb-tot dt{color:var(--ink);font-weight:800;text-transform:uppercase;font-size:11px;letter-spacing:.06em;align-self:center}
.cb-stats2 .cb-tot dd{font-family:var(--display);font-weight:400;font-size:28px;line-height:1}
.cb-trig{margin:0;display:flex;flex-wrap:wrap;justify-content:center;gap:5px;animation:cb-pop .35s .15s cubic-bezier(.2,1.4,.4,1) both}
.cb-trig .cb-chip{white-space:normal;text-align:center;font-size:11px;padding:2px 7px}
.cb-idle{font-size:11.5px;font-weight:600;color:var(--muted);text-align:center}
.cb-call{margin:0;justify-self:center;font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(22px,6vw,30px);line-height:1;background:var(--ink);color:var(--bg);padding:8px 16px 6px;border-radius:12px;transform:rotate(-2deg);animation:cb-stamp .4s cubic-bezier(.2,1.5,.4,1) both}
.cb-finale{display:grid;gap:6px;justify-items:start}
.cb-stamp{margin:0;font-family:var(--display);font-weight:400;text-transform:uppercase;font-size:clamp(40px,13vw,64px);line-height:1;padding:8px 16px 6px;border-radius:14px;border:3px solid var(--ink);box-shadow:5px 5px 0 var(--hard);transform:rotate(-3deg);animation:cb-stamp .45s cubic-bezier(.2,1.5,.4,1) both}
.cb-won .cb-stamp{background:var(--accent);color:var(--on-accent)}
.cb-lost .cb-stamp{background:var(--ink);color:var(--bg)}
.cb-verdict{margin:8px 0 0;font-weight:800;font-size:17px;line-height:1.3;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-margin{margin:0;color:var(--muted);font-size:15px;line-height:1.4}
/* Your six, as a strip: the active one lit, a won round filled, a lost one struck. */
.cb-strip{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
.cb-s{display:grid;justify-items:center;gap:2px;border:2px solid var(--line2);border-radius:10px;padding:6px 2px;background:var(--surface);min-width:0;text-align:center}
.cb-s-pos{font-size:10px;font-weight:800;letter-spacing:.06em;color:var(--muted)}
.cb-s-nm{font-size:11.5px;font-weight:800;color:var(--ink);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cb-s-res{font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.cb-s-now{border-color:var(--ink);box-shadow:3px 3px 0 var(--hard);transform:translateY(-3px)}
.cb-s-now .cb-s-res{color:var(--ink)}
.cb-s-won{background:var(--accent);border-color:var(--on-accent)}
.cb-s-won .cb-s-pos,.cb-s-won .cb-s-nm,.cb-s-won .cb-s-res{color:var(--on-accent)}
.cb-s-lost{background:var(--surface2)}
.cb-s-lost .cb-s-nm{text-decoration:line-through}
.cb-s.cb-f-gold{border-bottom-color:#c9952b;border-bottom-width:4px}
.cb-s.cb-f-silver{border-bottom-color:#8b98a6;border-bottom-width:4px}
.cb-s.cb-f-prism{border-bottom-color:var(--violet);border-bottom-width:4px}
.cb-bench{margin:0;font-size:13px;line-height:1.4;color:var(--muted)}
.cb-bench b{color:var(--ink)}
.cb-log{display:grid;gap:8px;border-top:2px solid var(--ink);padding-top:12px}
.cb-rounds{list-style:none;margin:0;padding:0;display:grid;gap:8px;counter-reset:cbr}
.cb-round{counter-increment:cbr;display:grid;gap:2px;border-left:5px solid var(--line2);padding:2px 0 2px 10px}
.cb-round-me{border-left-color:var(--win)}
.cb-round-foe{border-left-color:var(--loss)}
.cb-round-cat{font-size:11px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}
.cb-round-cat::before{content:"Round " counter(cbr) " · "}
.cb-round-line{font-size:14.5px;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-round-why{font-size:12.5px;line-height:1.4;color:var(--muted)}
.cb-boards{display:grid;gap:14px}
.cb-board caption{text-align:left;font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.03em;font-size:18px;padding-bottom:6px;color:var(--ink)}
@keyframes cb-pop{from{transform:translateY(-8px) scale(.8)}to{transform:none}}
@keyframes cb-drop{from{transform:translateY(-24px) scale(1.3)}to{transform:none}}
@keyframes cb-stamp{from{transform:rotate(8deg) scale(2.2)}to{transform:rotate(-3deg) scale(1)}}
@keyframes cb-slam-l{from{transform:translateX(-120%) rotate(-12deg)}to{transform:none}}
@keyframes cb-slam-r{from{transform:translateX(120%) rotate(12deg)}to{transform:none}}
@keyframes cb-vs{from{transform:scale(0) rotate(-30deg)}to{transform:none}}
@keyframes cb-boom{from{transform:scale(.2) rotate(0)}to{transform:scale(1.5) rotate(40deg);visibility:hidden}}
@keyframes cb-shake{0%,100%{transform:translateX(0) scale(.94)}20%{transform:translateX(-7px) rotate(-3deg) scale(.94)}40%{transform:translateX(6px) rotate(3deg) scale(.94)}60%{transform:translateX(-4px) scale(.94)}80%{transform:translateX(3px) scale(.94)}}
@media (max-width:360px){
  .cb-cats dt{font-size:9.5px}
  .cb-s-nm{font-size:10.5px}
}
@media (pointer:coarse){
  .cb-row .btn.sm{min-height:44px;min-width:44px}
  .cb-spd{min-height:32px}
  .cb-spd::after{content:"";position:absolute;inset:-8px -2px}
}
@media (prefers-reduced-motion:reduce){
  .cb-cat,.cb-side .cd-card,.cb-vsbig,.cb-burst,.cb-stats2,.cb-trig,.cb-call,.cb-stamp{animation:none}
  .cb-side .cd-card{transition:none}
}
`;
