// Card battles: a run, the daily showdown, and the two boards. See CARDS.md 11.
//
// A screen in its own file, like cards.jsx, which mounts it: it styles only its own cb- prefix, reuses the app's
// .btn / .note / .panel / .lb, and never imports perfect-season.jsx or cards.jsx back.
//
// NOTHING HERE DECIDES A BATTLE. The browser picks six cards and sends them; the card-claim Edge Function rolls
// the luck, says who won and pays. What this file computes for itself is only what a player needs BEFORE
// playing - which cards fit a slot, what a defense's traits do to each, the score with the luck taken out - and
// all of it comes from card-logic.mjs, the module the function scores with.
//
// A FAILED PLAY IS NOT "NOT PLAYED". offline, network and server may each follow a battle that WAS played and
// whose answer was lost. So the screen never replays to find out: it reads card_battle_state, which says where
// the run really stands and carries its latest battle, and shows that. A battle cannot be played twice either
// way - the function checks the run's step under a lock.
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBattleState, fetchCardBoards, startRun, playBattle, endRun, playShowdown } from "./storage.js";
import { loadDefenseData } from "./card-data.mjs";
import { CARDS, COUNTERS, FINISH_BONUS, LUCK_SPREAD, traitLabel, archetypeLabel, defenseByKey, lineupProblem, lineupProjection, battleTarget, showdownDefense } from "./card-logic.mjs";
import { SLOTS, TEAMS, fits } from "./game-logic.mjs";
import { COIN_RULES, cardWinCoins } from "./rewards.mjs";
import { Coins, NameLink } from "./cosmetics.jsx";
import { CardFace } from "./card-face.jsx";

// A lineup's and a run's own refusals, as sentences. cards.jsx folds these into CARD_SENTENCES, so the test that
// holds that map to storage-cards.js's CARD_REFUSALS holds these too.
export const LINEUP_SENTENCES = {
  incomplete: "Pick a card for every slot first.",
  unknown_card: "One of those cards isn't one this version of the game knows. Reload the page and pick again.",
  bad_finish: "That lineup didn't go through. Reload the page and pick again.",
  bad_slot: "One of those cards can't play that slot. Pick again.",
  same_player: "The same player can't start twice, even in two different seasons.",
  not_owned: "One of those cards isn't in your collection any more. Pick again.",
  no_run: "That run is over. Start a new one.",
  stale: "That run has moved on since this page loaded. Here is where it stands now.",
};
// Everything else a battle can be refused for. Not one of these may say a battle was or was not played unless
// the function itself said so: the three at the bottom are the unknown ones, and the screen only shows them
// after card_battle_state has confirmed the run did not move.
export const BATTLE_SENTENCES = {
  ...LINEUP_SENTENCES,
  signed_out: "You've been signed out. Sign in again to play.",
  no_profile: "This account hasn't picked a name yet. Pick one and battles open up.",
  guest_not_allowed: "Battles are for accounts. Keep your seasons from the Account tab and they open up.",
  cards_off: "Cards aren't switched on here yet.",
  duplicate: "You've already played today's showdown.",
  malformed: "That didn't go through. Reload the page and try again.",
  server: "Something went wrong on our side. Try again in a moment.",
  offline: "Couldn't reach the server. Check your connection and try again.",
  network: "That didn't go through. Reload the page and try again.",
};
const UNKNOWN = ["server", "offline", "network"];
const UNCONFIRMED = "We couldn't confirm that one, and couldn't check either. Check your connection and try again - a battle is never played twice.";
const say = (reason) => BATTLE_SENTENCES[reason] || BATTLE_SENTENCES.network;

const SLOT_NAME = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FLEX1: "Flex", FLEX2: "Flex" };
const FINISH_NAME = { base: "Base", silver: "Silver", gold: "Gold", prism: "Prism" };
const fmt = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
// A signed number in words a screen reader says right: a real minus sign, never a hyphen.
const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${fmt(Math.abs(n))}`;
export function defenseName(d) {
  const team = TEAMS[d.team];
  return `${d.season} ${team ? `${team[1]} ${team[0]}` : d.team}`;
}
// What one trait does, read out of the same table the function scores from.
function traitEffect(trait) {
  const table = COUNTERS[trait] || {};
  const list = (keep) => Object.entries(table).filter(([, pts]) => keep(pts)).map(([arch, pts]) => `${archetypeLabel(arch)} ${signed(pts)}`).join(", ");
  const hurts = list((p) => p < 0), helps = list((p) => p > 0);
  return [hurts && `Hurts: ${hurts}.`, helps && `Helps: ${helps}.`].filter(Boolean).join(" ");
}
const traitMods = (card, defense) => defense.traits.map((t) => ({ key: t, label: traitLabel(t), pts: COUNTERS[t]?.[card.archetype] || 0 })).filter((m) => m.pts);
const power = (row) => row.card.rating + FINISH_BONUS[row.finish];

// The six highest-rated cards that make a legal lineup, slot by slot. Deliberately the DULL choice - reading the
// defense and beating this is the game - and a starting point rather than an answer.
export function bestSix(rows) {
  const sorted = [...rows].sort((a, b) => power(b) - power(a) || a.id - b.id);
  const lineup = {}; const men = new Set();
  for (const slot of SLOTS) {
    const row = sorted.find((r) => !men.has(r.card.pid) && fits(r.card.pos, slot));
    if (!row) return null;
    lineup[slot] = { id: row.id, finish: row.finish }; men.add(row.card.pid);
  }
  return lineup;
}
// A lineup with every entry the collection no longer holds taken out - after a reload, or a card that left.
function held(lineup, rows) {
  const have = new Set(rows.map((r) => `${r.id}:${r.finish}`));
  const out = {};
  for (const slot of SLOTS) if (lineup?.[slot] && have.has(`${lineup[slot].id}:${lineup[slot].finish}`)) out[slot] = lineup[slot];
  return out;
}
const isComplete = (lineup) => SLOTS.every((s) => lineup[s]) && lineupProblem(lineup, null) === null;

function Chip({ pts, label }) {
  return <span className={`cb-chip ${pts > 0 ? "cb-up" : "cb-down"}`}>{signed(pts)} {label}</span>;
}

export function DefensePanel({ defense, bar = null, kicker }) {
  return (
    <section className="cb-def" aria-labelledby="cb-def-h" data-defense={defense.key}>
      <p className="cb-kick">{kicker}</p>
      <h2 className="cb-def-h" id="cb-def-h">{defenseName(defense)} <span>defense</span></h2>
      <p className="cb-def-n">Rated <b>{Math.round(defense.rating)}</b>{bar != null && <> · Bar to beat <b data-bar>{bar}</b></>}</p>
      {defense.traits.length === 0
        ? <p className="cb-def-none">No traits. Nothing about this defense changes what your cards do.</p>
        : (
          <ul className="cb-traits">
            {defense.traits.map((t) => <li key={t}><b>{traitLabel(t)}</b> <span>{traitEffect(t)}</span></li>)}
          </ul>
        )}
    </section>
  );
}

// rows: the collection as cards.jsx holds it, [{ id, finish, count, card }]. lineup: { [slot]: { id, finish } }.
export function LineupBuilder({ rows, defense, step = 0, bar = true, lineup, onChange, disabled = false }) {
  const [open, setOpen] = useState(null);
  const complete = isComplete(lineup);
  const proj = complete ? lineupProjection(lineup, defense, step) : null;
  const best = bestSix(rows);
  const pick = (slot, row) => { onChange({ ...lineup, [slot]: { id: row.id, finish: row.finish } }); setOpen(null); };
  return (
    <section className="cb-lineup" aria-labelledby="cb-lu-h">
      <div className="cb-lu-top">
        <h3 className="cb-h3" id="cb-lu-h">Your lineup</h3>
        <button className="btn sm" data-best disabled={disabled || !best} onClick={() => { onChange(best); setOpen(null); }}>Best six by rating</button>
      </div>
      <ul className="cb-slots">
        {SLOTS.map((slot) => {
          const entry = lineup[slot];
          const card = entry ? CARDS.get(entry.id) : null;
          const others = new Set(SLOTS.filter((s) => s !== slot && lineup[s]).map((s) => CARDS.get(lineup[s].id)?.pid));
          const mods = card ? (proj ? proj.cards.find((c) => c.slot === slot).mods : traitMods(card, defense)) : [];
          const options = open === slot
            ? rows.filter((r) => fits(r.card.pos, slot) && !others.has(r.card.pid))
              .sort((a, b) => power(b) - power(a) || a.id - b.id)
            : [];
          return (
            <li key={slot} className="cb-slot-li" data-slot={slot}>
              <button className="cb-slot" data-card={entry?.id} disabled={disabled} aria-expanded={open === slot} onClick={() => setOpen(open === slot ? null : slot)}>
                <span className="cb-pos">{SLOT_NAME[slot]}</span>
                {card
                  ? <span className="cb-who"><b>{card.name}</b><span className="cb-sub">{card.season} {card.team} · {archetypeLabel(card.archetype)}{entry.finish !== "base" ? ` · ${FINISH_NAME[entry.finish]}` : ""}</span></span>
                  : <span className="cb-who cb-empty">Choose a card</span>}
                {card && <span className="cb-n">{Math.round(card.rating)}{FINISH_BONUS[entry.finish] ? <small>+{FINISH_BONUS[entry.finish]}</small> : null}</span>}
              </button>
              {mods.length > 0 && <p className="cb-mods">{mods.map((m) => <Chip key={m.key} pts={m.pts} label={m.label} />)}</p>}
              {open === slot && (
                <ul className="cb-opts">
                  {options.length === 0 && <li className="note">No card of yours fits here.</li>}
                  {options.map((r) => {
                    const hit = traitMods(r.card, defense).reduce((n, m) => n + m.pts, 0);
                    return (
                      <li key={`${r.id}:${r.finish}`}>
                        <button className="cb-opt" data-card={r.id} data-finish={r.finish} aria-pressed={entry?.id === r.id && entry?.finish === r.finish} onClick={() => pick(slot, r)}>
                          <span className="cb-who"><b>{r.card.name}</b><span className="cb-sub">{r.card.season} {r.card.team} · {r.card.pos} · {archetypeLabel(r.card.archetype)}{r.finish !== "base" ? ` · ${FINISH_NAME[r.finish]}` : ""}</span></span>
                          {hit !== 0 && <Chip pts={hit} label="vs this defense" />}
                          <span className="cb-n">{Math.round(r.card.rating)}{FINISH_BONUS[r.finish] ? <small>+{FINISH_BONUS[r.finish]}</small> : null}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {proj && (
        <p className="cb-proj" data-proj>Before luck: <b>{fmt(proj.offense)}</b>{bar && <> against a bar of <b>{proj.target}</b></>}. Luck moves each card up to {LUCK_SPREAD} either way.</p>
      )}
    </section>
  );
}

// One battle, as the function reported it: six games lighting up one after another, then the total.
// battle: { defense, cards: [{ slot, id, finish, base, roll, mods, total, line }], offense, target, win }.
export function BattleShown({ battle, bar = true }) {
  const top = Math.max(battle.offense, bar ? battle.target : 0, 1) * 1.08;
  const verdict = bar
    ? (battle.win ? `You won, ${fmt(battle.offense)} to a bar of ${battle.target}.` : `You were stopped: ${fmt(battle.offense)} against a bar of ${battle.target}.`)
    : `You scored ${fmt(battle.offense)}.`;
  return (
    <section className={`cb-clash${bar ? (battle.win ? " cb-won" : " cb-lost") : ""}`} aria-label="The battle" data-win={bar ? String(!!battle.win) : undefined}>
      <ol className="cb-six">
        {battle.cards.map((c, i) => {
          const card = CARDS.get(c.id);
          return (
            <li key={c.slot} className="cb-play" style={{ "--cb-i": i }} data-slot={c.slot}>
              {card ? <CardFace card={card} finish={c.finish} /> : <span className="cb-gone">A card this page doesn't know</span>}
              <span className="cb-line">{c.line}</span>
              <span className="cb-math">{fmt(c.base)} rating, {signed(c.roll)} luck</span>
              {/* Under a card there is room for the trait or the pairing, not for the sentence: "Ball hawks", not
                  "Ball hawks vs Gunslinger" - the card above already says who he is. */}
              {c.mods.length > 0 && <span className="cb-mods">{c.mods.map((m) => <Chip key={m.key} pts={m.pts} label={m.label.split(" vs ")[0]} />)}</span>}
              <b className="cb-total">{fmt(c.total)}</b>
            </li>
          );
        })}
      </ol>
      <div className="cb-score">
        <div className="cb-meter" aria-hidden="true">
          <span className="cb-fill" style={{ width: `${(Math.max(0, battle.offense) / top) * 100}%` }} />
          {bar && <span className="cb-mark" style={{ left: `${(battle.target / top) * 100}%` }} />}
        </div>
        <p className="cb-verdict" role="status" data-verdict>{verdict}</p>
      </div>
    </section>
  );
}

function Boards() {
  const [got, setGot] = useState(null); // null: loading. "error". Or { runs, showdown }
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
        {rows.map((r, i) => <tr key={r.username}><td>{i + 1}</td><td className="nm"><NameLink name={r.username} guest={false} /></td><td className="r">{value(r)}</td></tr>)}
      </tbody>
    </table>
  );
  return (
    <div className="cb-boards">
      <h2 className="cb-h2">Boards</h2>
      {got.runs.length === 0 ? <p className="note">Nobody has won a battle in a run yet.</p> : table("Longest runs", got.runs, "Wins", (r) => r.wins)}
      {got.showdown.length === 0 ? <p className="note">Nobody has played today's showdown yet.</p> : table("Today's showdown", got.showdown, "Score", (r) => fmt(r.score))}
    </div>
  );
}

// mode: "run" | "showdown" | "boards". rows: the collection, [{ id, finish, count, card }].
export function BattleArea({ mode, rows, onBalance }) {
  const [st, setSt] = useState(null); // null: loading. "error" | "signed_out". Or the battle state.
  const [runLineup, setRunLineup] = useState({});
  const [dayLineup, setDayLineup] = useState({});
  const [shown, setShown] = useState(null); // the battle just played: { battle, coins, wins, over }
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [asking, setAsking] = useState(false); // the showdown's second tap
  const live = useRef(true);
  const top = useRef(null);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const load = useCallback(async () => {
    setSt(null);
    try {
      const [, got] = await Promise.all([loadDefenseData(), fetchBattleState()]);
      if (!live.current) return;
      setSt(got.status === "ok" ? got : got.status);
    } catch {
      if (live.current) setSt("error");
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setNotice(""); setAsking(false); }, [mode]);
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
  if (!bestSix(rows)) {
    return (
      <div className="panel">
        <h2 className="cb-h2">You need six to play</h2>
        <p>A lineup is a quarterback, a back, a receiver, a tight end and two more. Open your starter deck from the Collection tab and you'll have one.</p>
      </div>
    );
  }

  // After a play whose answer never came, or one the function called stale: ask where things really stand.
  async function settle(reason, run) {
    const fresh = await fetchBattleState();
    if (!live.current) return;
    if (fresh.status !== "ok") { setNotice(UNCONFIRMED); return; }
    setSt(fresh);
    const moved = run && fresh.run && fresh.run.id === run.id && (fresh.run.wins !== run.wins || fresh.run.status !== "live");
    if (moved && fresh.run.last) {
      setShown({ battle: fresh.run.last, coins: null, wins: fresh.run.wins, over: fresh.run.status !== "live" });
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
  async function fight() {
    const run = st.run;
    const lineup = held(runLineup, rows);
    if (busy || !run || !isComplete(lineup)) return;
    setBusy(true); setNotice("");
    const res = await playBattle(run.id, run.wins, lineup);
    if (!live.current) return;
    if (res.ok) {
      setBusy(false);
      if (typeof res.coins?.balance === "number") onBalance?.(res.coins.balance);
      setSt((s) => ({ ...s, run: { ...res.run, last: res.battle }, best: Math.max(s.best, res.run.wins), paidToday: s.paidToday + (res.coins?.credited > 0 ? 1 : 0) }));
      setShown({ battle: res.battle, coins: res.coins, wins: res.run.wins, over: res.run.status !== "live" });
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
  async function showdown() {
    const lineup = held(dayLineup, rows);
    if (busy || !isComplete(lineup)) return;
    if (!asking) { setAsking(true); return; }
    setBusy(true); setNotice("");
    const res = await playShowdown(lineup);
    if (!live.current) return;
    setAsking(false);
    if (res.ok) { setBusy(false); setSt((s) => ({ ...s, showdown: res.showdown })); return; }
    if (UNKNOWN.includes(res.reason) || res.reason === "duplicate") {
      // Either it went through and the answer was lost, or it was already played somewhere else: the state says.
      const fresh = await fetchBattleState();
      if (!live.current) return;
      if (fresh.status === "ok") { setSt(fresh); setNotice(fresh.showdown ? "" : `${say(res.reason)} Today's showdown was not played.`); }
      else setNotice(UNCONFIRMED);
    } else setNotice(say(res.reason));
    setBusy(false);
  }

  const paidLeft = Math.max(0, COIN_RULES.paidCardWinsPerDay - st.paidToday);
  const alert = notice && <p className="note" role="alert" data-notice>{notice}</p>;

  if (mode === "showdown") {
    const defense = st.showdown ? defenseByKey(st.showdown.defense) : showdownDefense(st.today);
    const lineup = held(dayLineup, rows);
    return (
      <div className="cb-area" data-mode="showdown">
        {defense && <DefensePanel defense={defense} kicker="Today's showdown" />}
        {st.showdown ? (
          <>
            <p className="cb-lead" data-played>Your score today: <b>{fmt(st.showdown.score)}</b>. One go a day - the next showdown opens at midnight UTC.</p>
            {st.showdown.lineup?.cards && <BattleShown battle={st.showdown.lineup} bar={false} />}
          </>
        ) : (
          <>
            <p className="cb-lead">One defense a day, the same for everyone, and one go at it. Every card has the same game today whoever plays it, so the board is about the six you pick.</p>
            {defense && <LineupBuilder rows={rows} defense={defense} bar={false} lineup={lineup} onChange={(l) => { setDayLineup(l); setAsking(false); }} disabled={busy} />}
            <div className="cb-acts">
              <button className="btn solid xl" data-play disabled={busy || !isComplete(lineup)} onClick={showdown}>
                {busy ? "Playing…" : asking ? "Confirm: this is my one go" : "Play today's showdown"}
              </button>
              {asking && !busy && <button className="btn" onClick={() => setAsking(false)}>Cancel</button>}
            </div>
          </>
        )}
        {alert}
      </div>
    );
  }

  // ---- a run ----
  const run = st.run && st.run.status === "live" ? st.run : null;
  if (shown) {
    const paid = shown.coins?.credited > 0;
    return (
      <div className="cb-area" data-mode="run" data-phase="result">
        <h2 className="cb-h2 cb-result-h" tabIndex={-1} ref={top}>{shown.battle.win ? `Win ${shown.wins}` : "Stopped"}</h2>
        {alert}
        <BattleShown battle={shown.battle} />
        {shown.battle.win && shown.coins && (
          <p className="cb-lead" data-paid>{paid
            ? <>You earned <Coins amount={shown.coins.credited} size={16} />.</>
            : "That win counts for your run. It paid no coins - today's paid wins are used up."}</p>
        )}
        {shown.over && <p className="cb-lead" data-over>The run ends at <b>{shown.wins}</b> {shown.wins === 1 ? "win" : "wins"}. Your best is {st.best}.</p>}
        <div className="cb-acts">
          {shown.over
            ? <button className="btn solid xl" data-start disabled={busy} onClick={begin}>{busy ? "Starting…" : "Start a new run"}</button>
            : <button className="btn solid xl" data-next onClick={() => { setShown(null); setNotice(""); }}>Next defense</button>}
        </div>
      </div>
    );
  }
  if (!run) {
    return (
      <div className="cb-area" data-mode="run" data-phase="idle">
        <h2 className="cb-h2">Runs</h2>
        <p className="cb-lead">Defenses come one after another until one stops you. You see each defense before you pick your six, and the bar goes up with every win.</p>
        <p className="cb-lead">A win pays {cardWinCoins(1)} coins, and one more for every win the run already has, up to {cardWinCoins(99)}. The first {COIN_RULES.paidCardWinsPerDay} wins of a day pay; <b data-paid-left>{paidLeft}</b> left today.</p>
        <p className="cb-lead" data-best-run>Your best run: <b>{st.best}</b> {st.best === 1 ? "win" : "wins"}.</p>
        <div className="cb-acts"><button className="btn solid xl" data-start disabled={busy} onClick={begin}>{busy ? "Starting…" : "Start a run"}</button></div>
        {alert}
      </div>
    );
  }
  const defense = defenseByKey(run.defense);
  if (!defense) {
    return (
      <div className="panel" role="alert">
        <p><b>This page is out of date.</b> Your run is facing a defense it doesn't know. Reload and it will be there.</p>
      </div>
    );
  }
  const lineup = held(runLineup, rows);
  const bar = battleTarget(defense, run.wins);
  return (
    <div className="cb-area" data-mode="run" data-phase="pick">
      <DefensePanel defense={defense} bar={bar} kicker={`Battle ${run.wins + 1} of your run · ${run.wins} ${run.wins === 1 ? "win" : "wins"} so far`} />
      <LineupBuilder rows={rows} defense={defense} step={run.wins} lineup={lineup} onChange={setRunLineup} disabled={busy} />
      <div className="cb-acts">
        <button className="btn solid xl" data-play disabled={busy || !isComplete(lineup)} onClick={fight}>{busy ? "Playing…" : "Play this battle"}</button>
        <button className="linkbtn" data-quit disabled={busy} onClick={walkAway}>End the run here</button>
      </div>
      <p className="cb-foot">{paidLeft > 0 ? `A win here pays ${cardWinCoins(run.wins + 1)} coins. ${paidLeft} paid ${paidLeft === 1 ? "win" : "wins"} left today.` : "Today's paid wins are used up. Wins still count for your run."}</p>
      {alert}
    </div>
  );
}

export const CARD_BATTLE_CSS = `
.cb-area{display:grid;gap:16px}
.cb-h2{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(22px,5vw,28px);line-height:1.1;margin:0;color:var(--ink)}
.cb-h2:focus{outline:none}
.cb-h3{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.03em;font-size:18px;margin:0;color:var(--ink)}
.cb-lead,.cb-foot{margin:0;color:var(--ink);line-height:1.45}
.cb-foot{color:var(--muted);font-size:14px}
.cb-acts{display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px}
.cb-def{background:var(--ink);color:var(--bg);border-radius:14px;padding:16px 16px 14px;display:grid;gap:8px}
.cb-kick{margin:0;font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--surface2)}
.cb-def-h{font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(24px,6vw,34px);line-height:1.05;margin:0;color:var(--bg)}
.cb-def-h span{color:var(--accent)}
.cb-def-n,.cb-def-none{margin:0;color:var(--bg);font-size:15px}
.cb-def-n b{font-variant-numeric:tabular-nums}
.cb-traits{list-style:none;margin:4px 0 0;padding:0;display:grid;gap:8px}
.cb-traits li{border-top:1px solid rgba(255,255,255,.22);padding-top:8px;font-size:14px;line-height:1.4;color:var(--bg)}
.cb-traits b{display:inline-block;background:var(--accent);color:var(--on-accent);font-size:12px;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:999px;margin-right:6px}
.cb-lineup{display:grid;gap:10px}
.cb-lu-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cb-slots,.cb-opts{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.cb-slot,.cb-opt{width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px 10px;text-align:left;border:2px solid var(--btn-line);background:var(--surface);color:var(--ink);border-radius:12px;padding:10px 12px;position:relative}
.cb-opt{grid-template-columns:minmax(0,1fr) auto auto;border-color:var(--line2);border-radius:10px;padding:8px 10px}
.cb-opt[aria-pressed="true"]{border-color:var(--ink);background:var(--surface2)}
.cb-slot:focus-visible,.cb-opt:focus-visible{outline:3px solid var(--accent-ink);outline-offset:2px}
.cb-slot:disabled{opacity:.6}
.cb-pos{font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase;background:var(--ink);color:var(--bg);padding:4px 8px;border-radius:6px;min-width:44px;text-align:center}
.cb-who{display:grid;min-width:0}
.cb-who b{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-sub{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cb-empty{color:var(--muted);font-weight:600}
.cb-n{font-family:var(--display);font-size:22px;line-height:1;color:var(--ink);font-variant-numeric:tabular-nums}
.cb-n small{font-size:.5em;vertical-align:top;margin-left:1px}
.cb-mods{margin:6px 0 0;display:flex;flex-wrap:wrap;gap:6px}
.cb-chip{display:inline-block;font-weight:800;font-size:12px;line-height:1.2;padding:3px 8px;border-radius:999px;border:1.5px solid currentColor;background:var(--surface);white-space:nowrap}
.cb-chip.cb-up{color:var(--win)}
.cb-chip.cb-down{color:var(--loss)}
.cb-opts{margin-top:8px;padding-left:12px;border-left:3px solid var(--line2);max-height:340px;overflow:auto}
.cb-proj{margin:0;font-size:15px;color:var(--ink)}
.cb-proj b,.cb-total,.cb-verdict{font-variant-numeric:tabular-nums}
.cb-clash{display:grid;gap:16px}
.cb-six{list-style:none;margin:0;padding:8px 0 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:26px 10px;justify-items:center}
.cb-play{display:grid;justify-items:center;align-content:start;gap:6px;text-align:center;min-width:0;width:100%;animation:cb-in .5s both;animation-delay:calc(var(--cb-i) * .45s)}
.cb-play .cd-card{--cd-w:min(132px,calc((100vw - 64px) / 3))}
.cb-play .cb-mods{justify-content:center;margin:0}
.cb-play .cb-chip{white-space:normal;font-size:11px;padding:2px 7px}
.cb-line{font-weight:800;font-size:13.5px;color:var(--ink);margin-top:8px}
.cb-math{font-size:12.5px;color:var(--muted)}
.cb-total{font-family:var(--display);font-weight:400;font-size:26px;line-height:1;color:var(--ink)}
.cb-gone{font-size:13px;color:var(--muted)}
.cb-score{display:grid;gap:10px;border-top:2px solid var(--ink);padding-top:14px}
.cb-meter{position:relative;height:18px;border-radius:999px;background:var(--surface2);border:2px solid var(--ink);overflow:hidden}
.cb-fill{position:absolute;left:0;top:0;bottom:0;background:var(--blue);transform-origin:left;animation:cb-grow 2.9s cubic-bezier(.2,.7,.2,1) both}
.cb-won .cb-fill{background:var(--win)}
.cb-lost .cb-fill{background:var(--loss)}
.cb-mark{position:absolute;top:-2px;bottom:-2px;width:3px;background:var(--ink)}
.cb-verdict{margin:0;font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.01em;font-size:clamp(20px,5vw,28px);line-height:1.15;color:var(--ink);animation:cb-in .5s both;animation-delay:2.9s}
.cb-boards{display:grid;gap:14px}
.cb-board caption{text-align:left;font-family:var(--display);font-weight:400;text-transform:uppercase;letter-spacing:.03em;font-size:18px;padding-bottom:6px;color:var(--ink)}
/* Hidden until its turn, then it slides in at FULL strength. Never a fade: text at half opacity is text below
   AA for as long as the fade lasts, and the chips' red and green have no contrast to spare. */
@keyframes cb-in{from{visibility:hidden;transform:translateY(12px) scale(.96)}to{visibility:visible;transform:none}}
@keyframes cb-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media (max-width:400px){
  .cb-six{gap:24px 6px}
  .cb-math{font-size:11.5px}
}
@media (min-width:700px){
  .cb-six{grid-template-columns:repeat(6,minmax(0,1fr))}
  .cb-play .cd-card{--cd-w:min(132px,calc((100vw - 120px) / 6))}
}
@media (pointer:coarse){
  .cb-slot{min-height:56px}
  .cb-opt{min-height:48px}
}
@media (prefers-reduced-motion:reduce){
  .cb-play,.cb-fill,.cb-verdict{animation:none}
}
`;
