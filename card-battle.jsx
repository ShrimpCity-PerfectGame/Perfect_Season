// Card battles: the ladder, the daily battle, the deck and the two boards. See CARDS.md 11.
//
// OFFENSE AGAINST OFFENSE (v2.27.0, the owner's redesign): a deck of thirty, a hand of twelve dealt from it,
// against a CPU's six - the same kind of cards you collect. PLAYED A ROUND AT A TIME (v2.28.0): each round is
// for one spot of the lineup, you play a card from your hand that fits it, and only then is the category
// revealed.
//
// A screen in its own file, like cards.jsx, which mounts it: it styles only its own cb- prefix, reuses the app's
// .btn / .note / .panel / .lb, and never imports perfect-season.jsx or cards.jsx back.
//
// NOTHING HERE DECIDES A BATTLE. The browser sends one card a round; the card-claim Edge Function deals the
// hand, rolls the luck, holds the order of the categories, says who won and pays. What this file works
// out for itself is only what a player needs BEFORE playing - what fits, what a lineup's synergies are - and all
// of it comes from card-logic.mjs, the module the function scores with.
//
// A FAILED PLAY IS NOT "NOT PLAYED". offline, network and server may each follow a battle that WAS played and
// whose answer was lost. So the screen never replays to find out: it reads card_battle_state, which says where
// things really stand and carries the latest battle, and shows that. A battle cannot be played twice either way.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBattleState, fetchCardBoards, startRun, playRound, endRun, saveDeck, dealDaily, playDailyRound, startGauntlet, playGauntletRound, quitGauntlet } from "./storage.js";
import {
  CARDS, CATEGORIES, FINISH_BONUS, DECK_SHAPE, HAND_SHAPE, POSITIONS, archetypeLabel, categoryLabel, spotLabel, abilityOf,
  deckProblem, bestDeck, playable, autoPick, playedSynergies, battleResult, ladderName, dailyFoe, maskFoe, categoryStat,
  RATING_SHARE, GAUNTLET, GAUNTLET_EVEN, gauntletName, gauntletFoe, gauntletEdge,
} from "./card-logic.mjs";
import { COIN_RULES, cardWinCoins, gauntletCoins } from "./rewards.mjs";
import { Coins, NameLink } from "./cosmetics.jsx";
import { CardFace } from "./card-face.jsx";

// A deck's, a team's and a run's own refusals, as sentences. cards.jsx folds these into CARD_SENTENCES, so the
// test that holds that map to storage-cards.js's CARD_REFUSALS holds these too.
export const LINEUP_SENTENCES = {
  incomplete: "Pick six cards first.",
  already_played: "You've already played that card in this battle. Pick another.",
  unknown_card: "One of those cards isn't one this version of the game knows. Reload the page and pick again.",
  bad_finish: "That didn't go through. Reload the page and pick again.",
  bad_slot: "That card can't play this spot. Pick one that fits it.",
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
// One battle, PLAYED A ROUND AT A TIME (v2.28.0). Each round is for one spot of the lineup, in the order of the
// other side's six - random for the battle, with a Flex last. The player sees the spot, the card across from it
// and which categories are still to come; plays one card from the hand that fits; and only then is the category
// revealed and the round played out.
//   hand    [{ id, finish }] the twelve dealt
//   foe     [{ id, finish, spot }] the other side's six, in playing order
//   rounds  the rounds played so far, as the function reported them:
//           { cat, spot, mine, foe, win, score: [you, them] }, mine / foe:
//           { id, finish, rating, score, base, roll, mods, total, ability: { name, on, cancelled } | null, line }
//   onPlay(entry)  play a card for the next round; the parent sends it and hands back longer `rounds`
//
// The owner's layout (2026-11-14): a centre arena with your active card on the left, theirs on the right and a
// big VS between, the stat comparison under them and the round's winner called; your six below with the active
// one lit; and the battle's information - round, score, speed, a log, what is in play.
//
// A round's outcome is the server's and is already known when it draws: the playback only decides WHEN it is
// shown. A round that was already played when this mounted (a battle resumed, a daily opened again) is not
// played back - only the ones that arrive while it is on screen. It plays in a browser that says it does not
// mind motion and is simply shown everywhere else (reduced motion; no matchMedia - jsdom, so every test sees
// each round the moment it is played). Nothing in it fades: text at half opacity is below AA for as long as a
// fade lasts, so a beaten card is greyed with a filter instead.
function plays() {
  try { return typeof window !== "undefined" && typeof window.matchMedia === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}
// A round has four beats: the two cards land and the category is called (0), the numbers come up (1), they
// clash (2), the winner is called (3).
const BEATS = [900, 1300, 700, 1300];
const SPEEDS = [[1, "Normal"], [2, "Fast"]];

function Side({ who, card, shot, cat, beat, won, lost }) {
  const c = CARDS.get(card.id);
  const state = beat >= 3 ? (won ? " cb-win" : lost ? " cb-lose" : "") : beat === 2 ? " cb-charge" : "";
  return (
    <div className={`cb-side cb-side-${who}${state}${card.finish === "prism" || card.finish === "gold" ? " cb-rare" : ""}`}>
      {c ? <CardFace card={c} finish={card.finish} /> : <span className="cb-row-gone">A card this page doesn't know</span>}
      {beat >= 1 && (
        <p className="cb-real" data-real>{c ? categoryStat(c, cat) : ""}</p>
      )}
      {beat >= 1 && (
        <dl className="cb-stats2">
          <div><dt>{categoryLabel(cat)} score</dt><dd>{shot.score}<small> of 99</small></dd></div>
          <div><dt>Card rating</dt><dd>{Math.round(shot.rating)}</dd></div>
          <div><dt>Points from both</dt><dd>{fmt(shot.base)}</dd></div>
          {shot.mods.length > 0 && <div><dt>Bonuses</dt><dd>{signed(shot.mods.reduce((n, m) => n + m.pts, 0))}</dd></div>}
          <div><dt>Luck</dt><dd>{signed(shot.roll)}</dd></div>
          <div className="cb-tot"><dt>Round total</dt><dd>{fmt(shot.total)}</dd></div>
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

export function Arena({ hand, foe, rounds, edge = 0, foeName = "CPU", busy = false, onPlay, onDone }) {
  const total = foe.length;
  // How many rounds have finished playing back. Rounds already there at mount are simply shown.
  const [seen, setSeen] = useState(rounds.length);
  const [beat, setBeat] = useState(0);
  const [speed, setSpeed] = useState(1);
  const animating = seen < rounds.length;
  useEffect(() => {
    if (!animating) return undefined;
    if (!plays()) { setSeen(rounds.length); setBeat(0); return undefined; }
    const timer = setTimeout(() => { if (beat < 3) setBeat(beat + 1); else { setBeat(0); setSeen(seen + 1); } }, BEATS[beat] / speed);
    return () => clearTimeout(timer);
  }, [animating, beat, seen, speed, rounds.length]);
  const over = rounds.length >= total && !animating;
  useEffect(() => { if (over) onDone?.(); }, [over]); // eslint-disable-line react-hooks/exhaustive-deps

  const settled = animating && beat >= 3 ? seen + 1 : seen; // rounds whose result is on the board
  const score = settled > 0 ? rounds[settled - 1].score : [0, 0];
  const result = over ? battleResult(rounds) : null;
  const name = (side) => CARDS.get(side.id)?.name || "A card";
  const next = rounds.length; // the round to be chosen for, when nothing is animating
  const options = !animating && next < total ? playable(hand, foe, rounds) : [];
  const earlier = rounds.map((r) => r.mine);
  const left = CATEGORIES.filter((c) => !rounds.slice(0, settled).some((r) => r.cat === c.id));
  const usedMen = new Set(rounds.map((r) => CARDS.get(r.mine.id)?.pid));
  const inHand = hand.filter((e) => !usedMen.has(CARDS.get(e.id)?.pid));
  const r = animating ? rounds[seen] : null;
  return (
    <section className={`cb-arena${result ? (result.win ? " cb-won" : " cb-lost") : ""}`} aria-label="The battle" data-done={String(over)} data-rounds={rounds.length} data-win={result ? String(result.win) : undefined}>
      <div className="cb-sb">
        <div className="cb-sb-you"><span>You</span><b data-you>{score[0]}</b></div>
        <div className="cb-sb-mid">
          <span data-round>{over ? "Final" : `Round ${Math.min(total, (animating ? seen : next) + 1)} of ${total}`}</span>
          {animating && (
            <span className="cb-speed" role="group" aria-label="Speed">
              {SPEEDS.map(([s, label]) => <button key={s} className="cb-spd" aria-pressed={speed === s} onClick={() => setSpeed(s)}>{label}</button>)}
              <button className="cb-spd" data-skip onClick={() => { setSeen(rounds.length); setBeat(0); }}>Skip</button>
            </span>
          )}
        </div>
        <div className="cb-sb-cpu"><span>{foeName}</span><b data-cpu>{score[1]}</b></div>
      </div>

      {animating && (
        <div className="cb-ring" key={seen} data-beat={beat}>
          <p className="cb-cat"><span>Round {seen + 1} · {spotLabel(r.spot)}</span><b>{categoryLabel(r.cat)}</b></p>
          <div className="cb-duel">
            <Side who="you" card={r.mine} shot={r.mine} cat={r.cat} beat={beat} won={r.win === "me"} lost={r.win === "foe"} />
            <div className="cb-vsbig" aria-hidden="true"><span>VS</span>{beat === 2 && <i className="cb-burst" />}</div>
            <Side who="cpu" card={r.foe} shot={r.foe} cat={r.cat} beat={beat} won={r.win === "foe"} lost={r.win === "me"} />
          </div>
          {beat >= 1 && <p className="cb-rule cb-ring-rule">This round is {categoryLabel(r.cat)}: {CATEGORIES.find((c) => c.id === r.cat)?.blurb.toLowerCase()}, ranked at each player's position in his era. Points are {Math.round((1 - RATING_SHARE) * 100)}% that score and {Math.round(RATING_SHARE * 100)}% card rating, plus bonuses and luck. Higher total takes the round.</p>}
          {beat >= 3 && <p className="cb-call" aria-hidden="true">{r.win === "me" ? "Round to you" : r.win === "foe" ? `Round to ${foeName}` : "Dead heat"}<small>{fmt(r.mine.total)} to {fmt(r.foe.total)}</small></p>}
        </div>
      )}

      {!animating && next < total && (
        <div className="cb-choose" data-choose={next} data-spot={foe[next].spot}>
          <p className="cb-cat"><span>Round {next + 1} of {total}</span><b>{spotLabel(foe[next].spot)}</b></p>
          {foe[next].id != null ? (
            <div className="cb-facing" data-facing>
              <h3 className="cb-h3">You're facing</h3>
              <CardRow entry={foe[next]} mods={playedSynergies(foe[next], rounds.map((x) => x.foe))} />
            </div>
          ) : (
            <p className="cb-facing cb-hidden" data-facing-hidden><b>{foeName}</b> has a {spotLabel(foe[next].spot).toLowerCase()} waiting. You'll see who when you play yours.</p>
          )}
          <p className="cb-left" data-left><b>Still to come:</b> {left.map((c) => c.label).join(", ")}. You'll see which one after you play.</p>
          <div className="cb-lu-top">
            <h3 className="cb-h3">Play a {spotLabel(foe[next].spot).toLowerCase()}</h3>
            <button className="btn sm" data-best disabled={busy || !options.length} onClick={() => { const e = autoPick(hand, foe, rounds); if (e) onPlay(e); }}>Pick for me</button>
          </div>
          <ul className="cb-list">
            {options.length === 0 && <li className="note">You have nobody left for this spot.</li>}
            {options.map((e) => (
              <li key={keyOf(e)}>
                <CardRow entry={e} mods={playedSynergies(e, earlier)}>
                  <button className="btn solid sm cb-row-act" data-play-card={e.id} data-finish={e.finish} disabled={busy} onClick={() => onPlay(e)}>{busy ? "…" : "Play"}</button>
                </CardRow>
              </li>
            ))}
          </ul>
          {next + 1 < total && (
            <p className="cb-coming"><b>Then:</b> {foe.slice(next + 1).map((e) => (e.id != null ? `${spotLabel(e.spot)} vs ${CARDS.get(e.id)?.name}` : spotLabel(e.spot))).join(", ")}.</p>
          )}
        </div>
      )}

      {result && (
        <div className="cb-finale">
          <p className="cb-stamp" aria-hidden="true">{result.win ? "\u{1F3C8} Win" : "\u{1F480} Beaten"}</p>
          <p className="cb-verdict" role="status" data-verdict>{result.win ? `You won, ${result.wins} rounds to ${result.losses}.` : `You lost, ${result.wins} rounds to ${result.losses}.`}</p>
          <p className="cb-margin">{result.wins === result.losses ? `Level on rounds, so it went to total points: ${fmt(result.total)} to ${fmt(result.foeTotal)}.` : `Total points ${fmt(result.total)} to ${fmt(result.foeTotal)}.`}{edge > 0 ? ` Their cards played ${fmt(edge)} points up - the top of the ladder.` : edge < 0 ? ` Their cards played ${fmt(-edge)} points short - your head start.` : ""}</p>
        </div>
      )}

      <ol className="cb-strip" aria-label="The six rounds">
        {foe.map((f, i) => {
          const played = rounds[i];
          const c = played ? CARDS.get(played.mine.id) : null;
          const res = i < settled ? rounds[i].win : null;
          const now = !over && i === (animating ? seen : next);
          const state = res === "me" ? "cb-s-won" : res === "foe" ? "cb-s-lost" : res === "tie" ? "cb-s-tie" : now ? "cb-s-now" : "cb-s-wait";
          return (
            <li key={i} className={`cb-s ${state}${played ? ` cb-f-${played.mine.finish}` : ""}`}>
              <span className="cb-s-pos">{f.spot === "FLEX" ? "Flex" : f.spot}</span>
              <span className="cb-s-nm">{c ? c.name.split(" ").slice(-1)[0] : "—"}</span>
              <span className="cb-s-res">{res === "me" ? "Won" : res === "foe" ? "Lost" : res === "tie" ? "Tied" : now ? "Up now" : `${i + 1}`}</span>
            </li>
          );
        })}
      </ol>
      {inHand.length > 0 && !over && (
        <p className="cb-bench"><b>Still in your hand:</b> {inHand.map((e) => CARDS.get(e.id)?.name).filter(Boolean).join(", ")}</p>
      )}

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
                  {categoryStat(CARDS.get(x.mine.id), x.cat)} against {categoryStat(CARDS.get(x.foe.id), x.cat)}. {categoryLabel(x.cat)} score {x.mine.score} to {x.foe.score}, luck {signed(x.mine.roll)} to {signed(x.foe.roll)}.
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
export function BattleArea({ mode, rows, onBalance }) {
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
  async function playCard(entry) {
    const run = st.run;
    if (busy || !run) return;
    const round = run.rounds.length;
    setBusy(true); setNotice("");
    const res = await playRound(run.id, run.wins, round, entry);
    if (!live.current) return;
    if (res.ok) {
      setBusy(false);
      if (!res.done) { setSt((s) => ({ ...s, run: { ...s.run, rounds: res.run.rounds } })); return; }
      if (typeof res.coins?.balance === "number") onBalance?.(res.coins.balance);
      // The sixth round: the battle is over. Keep it on screen; the state already holds the next hand.
      setShown({ id: run.id, step: run.wins, hand: run.hand, battle: res.battle, coins: res.coins, wins: res.run.wins, over: res.run.status !== "live" });
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
  async function playDay(entry) {
    const day = st.daily;
    if (busy || !day) return;
    setBusy(true); setNotice("");
    const res = await playDailyRound(day.log.length, entry);
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
  async function playG(entry) {
    const g = st.gauntlet;
    if (busy || g.stage == null) return;
    const stage = g.stage, round = g.rounds.length;
    setBusy(true); setNotice("");
    const res = await playGauntletRound(stage, round, entry);
    if (!live.current) return;
    if (res.ok) {
      setBusy(false);
      if (!res.done) { setSt((s) => ({ ...s, gauntlet: { ...s.gauntlet, rounds: res.gauntlet.rounds } })); return; }
      if (typeof res.coins?.balance === "number") onBalance?.(res.coins.balance);
      setShownG({ stage, hand: g.hand, battle: res.battle, coins: res.coins, first: res.first, cleared: res.gauntlet.cleared });
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
    if (shownG) {
      const seen = seenBattle === shownG.battle;
      const won = shownG.battle.win;
      const next = shownG.cleared < total ? shownG.cleared : null; // the stage now up, if there is one
      return (
        <div className="cb-area" data-mode="gauntlet" data-phase="result">
          <h2 className="cb-h2 cb-result-h" tabIndex={-1} ref={top}>{!seen ? `Stage ${shownG.stage + 1}: ${gauntletName(shownG.stage)}` : won ? "Stage cleared" : "Beaten"}</h2>
          {alert}
          <Arena key={`g:${shownG.stage}`} hand={shownG.hand} foe={shownG.battle.foe} rounds={shownG.battle.rounds} edge={shownG.battle.edge} foeName={gauntletName(shownG.stage)}
            onDone={() => { setSeenBattle(shownG.battle); top.current?.focus(); }} />
          {seen && won && shownG.first === true && <p className="cb-lead" data-paid>You beat {gauntletName(shownG.stage)}.{shownG.coins?.credited > 0 && <> You earned <Coins amount={shownG.coins.credited} size={16} />.</>}</p>}
          {seen && won && shownG.first === false && <p className="cb-lead" data-again>You beat {gauntletName(shownG.stage)} again. A stage pays the first time only.</p>}
          {seen && won && shownG.cleared >= total && <p className="cb-lead" data-all>That's all {total}. You've run the gauntlet.</p>}
          {seen && !won && <p className="cb-lead" data-over>{gauntletName(shownG.stage)} held. Try it again whenever you like - you get a new hand each time.</p>}
          {seen && (
            <div className="cb-acts">
              {won && next !== null && next > shownG.stage && <button className="btn solid xl" data-next disabled={busy} onClick={() => beginG(next)}>{busy ? "Dealing…" : `Next: ${gauntletName(next)}`}</button>}
              {!won && <button className="btn solid xl" data-retry disabled={busy} onClick={() => beginG(shownG.stage)}>{busy ? "Dealing…" : "Try again"}</button>}
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
          <Arena key={`g:${g.stage}`} hand={g.hand} foe={foe} rounds={g.rounds} edge={gauntletEdge(g.stage)} foeName={gauntletName(g.stage)} busy={busy} onPlay={playG} />
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
          <li>A battle is the same six rounds as the ladder - but here you can see who you're facing.</li>
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
            <p className="cb-lead">One CPU team a day, the same for everyone, and one go at it. Every card has the same luck today whoever plays it, so the board is about which cards you play, and where.</p>
            <p className="cb-lead">Your hand is dealt once. Set your deck first if you want to - it can't be re-dealt.</p>
            <div className="cb-acts"><button className="btn solid xl" data-deal disabled={busy} onClick={deal}>{busy ? "Dealing…" : "Deal today's hand"}</button></div>
          </>
        )}
        {day && day.played && <p className="cb-lead" data-played>You took <b>{day.rounds}</b> of 6 rounds for <b>{fmt(day.score)}</b> points. One go a day - the next opens at midnight UTC.</p>}
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
          onDone={() => { setSeenBattle(shown.battle); top.current?.focus(); }} />
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
          <li>You're dealt twelve cards from your deck: 2 quarterbacks, 4 backs, 4 receivers, 2 tight ends.</li>
          <li>Six rounds, one for each spot - quarterback, back, receiver, tight end and two flex - in a random order, a flex last.</li>
          <li>Each round you play a card for the spot without seeing theirs. Then both cards and the category are revealed: each of the six comes up once.</li>
          <li>Win more rounds than they do. One lost battle ends the run.</li>
          <li>A win pays {cardWinCoins(1)} coins, plus one for every win the run already has, up to {cardWinCoins(99)}. The first {COIN_RULES.paidCardWinsPerDay} wins of a day pay.</li>
        </ul>
      </div>
    );
  }
  return (
    <div className="cb-area" data-mode="run" data-phase="play">
      <h2 className="cb-h2 cb-result-h">Battle {run.wins + 1} <span className="cb-count">{run.wins} {run.wins === 1 ? "win" : "wins"} so far</span></h2>
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
.cb-choose{display:grid;gap:12px}
.cb-facing{display:grid;gap:8px;background:var(--ink);border-radius:14px;padding:12px}
.cb-facing.cb-hidden{display:block;margin:0;color:var(--bg);font-size:15px;line-height:1.4}
.cb-facing.cb-hidden b{color:var(--accent)}
.cb-real{margin:0;font-weight:800;font-size:15px;line-height:1.25;text-align:center;color:var(--ink);animation:cb-pop .35s cubic-bezier(.2,1.4,.4,1) both}
.cb-ring-rule{text-align:center;font-size:12.5px}
.cb-stats2 small{font-weight:600;color:var(--muted);font-size:.8em}
.cb-call small{display:block;font-family:Inter,system-ui,sans-serif;font-weight:800;font-size:13px;letter-spacing:.04em;margin-top:4px}
.cb-facing .cb-h3{color:var(--accent)}
.cb-left,.cb-coming{margin:0;font-size:14px;line-height:1.45;color:var(--muted)}
.cb-left b,.cb-coming b{color:var(--ink)}
.cb-result-h .cb-count{vertical-align:middle}
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
.cb-vsbig{position:relative;align-self:start;margin-top:clamp(64px,22vw,96px);font-family:var(--display);font-size:clamp(26px,8vw,40px);line-height:1;color:var(--ink);animation:cb-vs .5s .25s cubic-bezier(.2,1.6,.4,1) both}
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
  .cb-cat,.cb-side .cd-card,.cb-vsbig,.cb-burst,.cb-stats2,.cb-real,.cb-trig,.cb-call,.cb-stamp{animation:none}
  .cb-side .cd-card{transition:none}
}
`;
