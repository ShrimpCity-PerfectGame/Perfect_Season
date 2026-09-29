// Guess the Player (v2.13.0): eight guesses at the day's player, five columns that go green, yellow or grey.
//
// Every rule is in guess-logic.mjs, shared with the submit-guess Edge Function - this file draws it. It styles
// only its own `gp-` prefix and reuses the app's .btn, .h, .note, .panel and .mode, the way the other screens
// do, and exports its stylesheet for perfect-season.jsx to append.
//
// Known and accepted, the same way it is accepted for every other seeded mode in this game: the answer is
// derivable from the date and the pool, both of which ship in the bundle. Somebody willing to run guess-logic
// in a console can read today's player. What is closed is the in-app rehearsal - and the BOARD is honest
// either way, because submit-guess recomputes the answer and the result from the date alone.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { TEAMS } from "./game-logic.mjs";
import {
  GUESS_PLAYERS, GUESS_TRIES, GUESS_COLUMNS, DIVISIONS,
  guessPlayer, compareGuess, guessAnswerFor, guessAnswerForSeed, guessOutcome, replayGuessGame,
} from "./guess-logic.mjs";
import { loadGuessPool } from "./guess-pool.mjs";
import { teamVars, reducedMotion } from "./ui-common.jsx";
import { submitGuess, fetchGuessTop, fetchGuessBest, fetchMyGuess, sget, sset, clearDraft } from "./storage.js";

export const GUESS_WIP = "ps-guess-wip";
const utcDay = () => new Date().toISOString().slice(0, 10);
const newCode = () => {
  let out = "";
  for (let i = 0; i < 8; i++) out += "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 36)];
  return out;
};

// What each column is called, and what its colours mean - shown in the rules and read out by the row's own
// label, because a colour on its own carries meaning and that is the one thing a screen may not do.
export const GUESS_HEADS = { team: "Team", division: "Division", pos: "Pos", draft: "Class", number: "No." };
const SAID = { hit: "exact", near: "close", miss: "no" };
// The ink on a coloured cell. Both paints are light, so it is dark on both - see the note in GUESS_CSS.
const CELL_INK = "#1B1B1B";
const ARROW = { up: "↑", down: "↓" };

// The short form a cell prints. Division is the only one that would not fit, so it loses its conference.
const cellText = (col, p) => {
  if (col === "team") return p.team;
  if (col === "division") return (p.division || "").replace("AFC ", "A-").replace("NFC ", "N-");
  if (col === "pos") return p.pos;
  if (col === "draft") return String(p.draft);
  return `#${p.number}`;
};

export function GuessScreen({
  userId, username, isGuest, onBack, onClaimCoins, onDailySaved, onStage, onNeedsAccount,
}) {
  // The pool is fetched when this screen opens rather than shipped in the bundle (guess-pool.mjs says why), so
  // everything here waits on it: the menu's tiles, the search box and the resume below all need the players.
  const [pool, setPool] = useState(() => (GUESS_PLAYERS.length ? "ready" : "loading"));
  const [stage, setStage] = useState("menu");     // menu | play | done
  const [run, setRun] = useState(null);           // { variant, day, seed, guesses: [id] }
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [coins, setCoins] = useState(0);
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState({ day: [], best: [], loaded: false });
  const [dailyDone, setDailyDone] = useState(null);
  const [tab, setTab] = useState("day");
  const day = utcDay();
  const acct = useRef(0);
  const started = useRef(false);

  useEffect(() => {
    if (pool === "ready") return undefined;
    let alive = true;
    loadGuessPool().then(
      () => { if (alive) setPool("ready"); },
      () => { if (alive) setPool("failed"); },
    );
    return () => { alive = false; };
  }, [pool]);

  const saveWip = useCallback(async (value) => {
    if (value) await sset(GUESS_WIP, value, false);
    else await clearDraft(GUESS_WIP);
  }, []);

  // Resume. The same shape Century's has, including the ref that stops a slow read landing on top of a game
  // that has since been started - see CENTURY.md for what that cost the first time.
  useEffect(() => {
    if (pool !== "ready") return undefined;
    let alive = true;
    (async () => {
      const saved = await sget(GUESS_WIP, false);
      if (!alive || started.current) return;
      const usable = saved && Array.isArray(saved.guesses) && saved.guesses.length < GUESS_TRIES
        && (saved.variant !== "daily" || saved.day === day);
      if (usable) { setRun(saved); setStage("play"); }
      else if (saved) saveWip(null);
    })();
    return () => { alive = false; };
  }, [day, saveWip, pool]);

  useEffect(() => {
    const mine = ++acct.current;
    if (!userId) { setDailyDone(null); return; }
    fetchMyGuess(day).then((r) => { if (mine === acct.current) setDailyDone(r); });
  }, [userId, day]);

  const loadBoards = useCallback(() => {
    const mine = acct.current;
    Promise.all([fetchGuessTop(day, 10), fetchGuessBest(10)]).then(([d, b]) => {
      if (mine !== acct.current) return;
      setBoard({ day: d || [], best: b || [], loaded: true });
    });
  }, [day]);
  useEffect(() => { if (stage !== "play") loadBoards(); }, [stage, loadBoards]);
  useEffect(() => {
    if (onStage) onStage(stage);
    return () => { if (onStage) onStage("menu"); };
  }, [stage, onStage]);

  const answer = useMemo(() => {
    if (!run) return null;
    return run.variant === "daily" ? guessAnswerFor(run.day) : guessAnswerForSeed(run.seed);
  }, [run]);
  const rows = useMemo(() => {
    if (!run || !answer) return [];
    return run.guesses.map((id) => {
      const p = guessPlayer(id);
      return p ? { player: p, row: compareGuess(p, answer) } : null;
    }).filter(Boolean);
  }, [run, answer]);
  const solvedAlready = !!answer && run?.guesses.includes(answer.id);
  const left = run ? GUESS_TRIES - run.guesses.length : GUESS_TRIES;

  // What the search box offers: names that match, minus anyone already guessed, most obvious first. Capped, so
  // a two-letter query does not paint four thousand rows.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !run) return [];
    const taken = new Set(run.guesses);
    const out = [];
    for (const p of GUESS_PLAYERS) {
      if (taken.has(p.id)) continue;
      const name = p.name.toLowerCase();
      if (!name.includes(q)) continue;
      out.push({ p, rank: name.startsWith(q) ? 0 : 1 });
      if (out.length > 300) break;
    }
    return out.sort((a, b) => a.rank - b.rank || (a.p.name < b.p.name ? -1 : 1)).slice(0, 8).map((x) => x.p);
  }, [query, run]);

  function start(variant, seed) {
    started.current = true;
    setError("");
    setResult(null);
    setCoins(0);
    setQuery("");
    const next = variant === "daily"
      ? { variant: "daily", day, seed: null, guesses: [] }
      : { variant: "practice", day: null, seed: seed || newCode(), guesses: [] };
    setRun(next);
    saveWip(next);
    setStage("play");
  }

  function guess(p) {
    if (!run || saving || !p) return;
    if (run.guesses.includes(p.id)) { setError(`${p.name} has already been guessed.`); return; }
    if (run.guesses.length >= GUESS_TRIES) return;
    setError("");
    setQuery("");
    const next = { ...run, guesses: [...run.guesses, p.id] };
    setRun(next);
    const done = p.id === answer?.id || next.guesses.length >= GUESS_TRIES;
    if (done) finish(next);
    else saveWip(next);
  }

  async function finish(finished) {
    setSaving(true);
    // The instant result is computed by the function the SERVER replays with, not by a comparison written here:
    // the end screen shows this one until the save answers, and a refused save never replaces it at all (a tab
    // left open on a daily finished elsewhere). A second copy of "was it solved" would eventually disagree with
    // the one that counts, which is the whole reason guess-logic.mjs exists.
    const local = replayGuessGame(finished.variant === "daily"
      ? { date: finished.day, guesses: finished.guesses }
      : { seed: finished.seed, guesses: finished.guesses });
    setResult({
      local: true, solved: !!local.ok && local.solved, tries: local.ok ? local.tries : finished.guesses.length,
      tried: GUESS_TRIES, answer, day: finished.day,
    });
    setStage("done");
    saveWip(null);
    const mine = acct.current;
    const sent = await submitGuess({
      variant: finished.variant, seed: finished.seed, day: finished.day, guesses: finished.guesses,
    });
    if (mine !== acct.current) return;
    setSaving(false);
    if (sent.ok) {
      setResult({ ...sent, local: false, answer: sent.answer });
      if (finished.variant === "daily") {
        setDailyDone({ solved: sent.solved, tries: sent.tries, outcome: sent.outcome, guesses: finished.guesses, answer: sent.answer?.id });
        if (onDailySaved) onDailySaved({ day: sent.day, solved: sent.solved, tries: sent.tries });
      }
      if (onClaimCoins) onClaimCoins(finished.day || day, (credited) => setCoins(credited));
      loadBoards();
    } else {
      setError(refusalLine(sent.reason, finished.variant));
    }
  }

  function showDailyResult() {
    if (!dailyDone) return;
    setError("");
    setCoins(0);
    setResult({
      solved: dailyDone.solved, tries: dailyDone.tries, tried: GUESS_TRIES, replay: true, day,
      answer: guessPlayer(dailyDone.answer) || null,
      shownGuesses: dailyDone.guesses,
    });
    setStage("done");
  }

  // ---------- Drawing ----------
  if (stage === "play" && run) {
    return (
      <div className="gp" data-view="play">
        <div className="modebar">
          <button className="mb on" aria-current="true">{run.variant === "daily" ? "Daily" : "Practice"}</button>
          <button className="mb" onClick={onBack}>All modes</button>
          <span className="seedline">
            {run.variant === "daily"
              ? <span className="nowrap">{run.day} · the same player for everyone</span>
              : <span className="codechip">Code <code>{run.seed}</code></span>}
          </span>
        </div>

        <p className="note gp-left" role="status">
          {left} guess{left === 1 ? "" : "es"} left
        </p>

        <GuessTable rows={rows} />

        {error && <p className="note gp-err" role="status">{error}</p>}

        <div className="gp-search">
          <label className="vh" htmlFor="gp-q">Guess a player</label>
          <input id="gp-q" className="inp" value={query} autoComplete="off" placeholder="Type a player's name"
            onChange={(e) => { setQuery(e.target.value); setError(""); }} />
          {matches.length > 0 && (
            <ul className="gp-hits" aria-label="Matching players">
              {matches.map((p) => (
                <li key={p.id}>
                  {/* The position and draft class are on the button because the pool holds two Adrian Petersons
                      and two Alex Smiths - a name alone does not say which player you mean. */}
                  <button className="gp-hit" onClick={() => guess(p)}>
                    <span className="gp-hn">{p.name}</span>
                    <span className="gp-hm">{p.pos} · {p.draft}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim().length >= 2 && matches.length === 0 && (
            <p className="note">Nobody by that name is in the game. It holds players with five seasons or more.</p>
          )}
        </div>

        <button className="btn" onClick={onBack}>Leave</button>
      </div>
    );
  }

  if (stage === "done" && result) {
    const shown = result.shownGuesses
      ? result.shownGuesses.map((id) => {
        const p = guessPlayer(id);
        return p && result.answer ? { player: p, row: compareGuess(p, result.answer) } : null;
      }).filter(Boolean)
      : rows;
    return (
      <div className="gp" data-view="done">
        <div className={`result-hero gp-hero${result.solved ? " solved" : ""}`}>
          <p className="gp-eyebrow">{result.replay ? "Today's game" : result.solved ? "Got it" : "Missed"}</p>
          <p className="rec gp-score">{result.solved ? result.tries : "—"}</p>
          <p className="outcome">{result.solved ? `guess${result.tries === 1 ? "" : "es"}` : `not in ${result.tried || GUESS_TRIES}`}</p>
          {result.answer && (
            <p className="rating">
              It was <strong>{result.answer.name}</strong> — {result.answer.pos},{" "}
              {TEAMS[result.answer.team] ? TEAMS[result.answer.team][0] : result.answer.team}, drafted{" "}
              {result.answer.draft}, #{result.answer.number}
              {result.answer.from ? ` (${result.answer.from}–${result.answer.to})` : ""}.
            </p>
          )}
        </div>
        {coins > 0 && <p className="note gp-coins" role="status">+{coins} coins</p>}
        {saving && <p className="note" role="status">Saving…</p>}
        {error && <p className="note gp-err" role="status">{error}</p>}
        <GuessTable rows={shown} />
        <div className="gp-row">
          <button className="btn solid" onClick={() => start("practice")}>Another one 🔁</button>
          <button className="btn" onClick={() => { setStage("menu"); loadBoards(); }}>Boards</button>
          <button className="btn" onClick={onBack}>Done</button>
        </div>
      </div>
    );
  }

  if (pool !== "ready") {
    return (
      <div className="gp" data-view={pool === "failed" ? "failed" : "loading"}>
        {pool === "failed" ? (
          <>
            <p className="note gp-err" role="status">
              Couldn't load the players. That is the one thing this game can't be played without — check your
              connection and try again.
            </p>
            <button className="btn solid" onClick={() => setPool("loading")}>Try again</button>
          </>
        ) : (
          <p className="note" role="status">Loading the players…</p>
        )}
        <button className="btn" onClick={onBack}>Back</button>
      </div>
    );
  }

  return (
    <div className="gp" data-view="menu">
      <p className="note gp-intro">
        One player a day, eight guesses. Every guess shows how close it was on five things — team, division,
        position, draft class and number. Green is exact, yellow is close, and the arrows say which way to go.
      </p>
      <div className="modes">
        <button className="mode daily"
          onClick={() => (dailyDone ? showDailyResult()
            : !userId || isGuest ? onNeedsAccount && onNeedsAccount(isGuest ? "guest" : "signedout")
            : start("daily"))}>
          <div className="mt">
            <span className="icon" aria-hidden="true">🔎</span>
            <span className="mn">Daily</span>
            {isGuest && <span className="pill">Account needed</span>}
            {dailyDone && <span className="pill">{dailyDone.solved ? `Got it in ${dailyDone.tries}` : "Missed"}</span>}
          </div>
          <p>
            {isGuest ? "The daily needs an account - a guest can be made again and again, and the day's player is one go for everyone."
              : !userId ? "The same player for everyone today, one go. Sign in to play it."
              : dailyDone ? dailyDone.outcome
              : "The same player for everyone today. One go, eight guesses."}
          </p>
          <span className="go">{dailyDone ? "See how it went" : isGuest || !userId ? "Sign in to play" : "Let's go"}</span>
        </button>

        <button className="mode m-unlimited" onClick={() => (userId ? start("practice") : onNeedsAccount && onNeedsAccount("signedout"))}>
          <div className="mt"><span className="icon" aria-hidden="true">♾️</span><span className="mn">Practice</span></div>
          <p>A different player every time, as often as you like. Practice games stay off the daily board.</p>
          <span className="go">{userId ? "Let's go" : "Sign in to play"}</span>
        </button>
      </div>

      <h2 className="h">Boards</h2>
      <div className="gp-tabs" role="tablist" aria-label="Guess the Player boards">
        {[["day", "Today"], ["best", "All time"]].map(([id, label]) => (
          <button key={id} role="tab" id={`gp-tab-${id}`} aria-selected={tab === id} aria-controls={`gp-panel-${id}`}
            className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {/* Both panels exist, the closed one hidden, so neither tab's aria-controls points at nothing. */}
      {[["day", board.day], ["best", board.best]].map(([id, list]) => (
        <div key={id} className="gp-panel" id={`gp-panel-${id}`} role="tabpanel"
          aria-labelledby={`gp-tab-${id}`} hidden={tab !== id}>
          <GuessBoard rows={list} loaded={board.loaded} username={username} allTime={id === "best"} />
        </div>
      ))}
      <button className="btn" onClick={onBack}>Back</button>
    </div>
  );
}

// The guesses so far. A real table, because that is what it is - and every cell says its state in words for a
// screen reader, since the colour is the whole of the signal for everyone else.
function GuessTable({ rows }) {
  if (!rows.length) return null;
  return (
    <table className="gp-grid">
      <caption className="vh">Your guesses, and how close each was</caption>
      <thead>
        <tr>
          <th scope="col">Player</th>
          {GUESS_COLUMNS.map((c) => <th key={c} scope="col">{GUESS_HEADS[c]}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ player, row }) => (
          <tr key={player.id}>
            <th scope="row" className="gp-who">
              <span className="gp-name">{player.name}</span>
            </th>
            {GUESS_COLUMNS.map((c) => (
              <td key={c} className={`gp-cell ${row[c].state}`} style={c === "team" ? teamVars(player.team) : undefined}>
                <span aria-hidden="true">{cellText(c, player)}{row[c].hint ? ARROW[row[c].hint] : ""}</span>
                <span className="vh">
                  {GUESS_HEADS[c]} {cellText(c, player)}: {SAID[row[c].state]}
                  {row[c].hint ? `, ${row[c].hint === "up" ? "higher" : "lower"}` : ""}
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GuessBoard({ rows, loaded, username, allTime }) {
  if (!loaded) return <p className="note">Loading…</p>;
  if (!rows.length) return <p className="note">{allTime ? "Nobody has played yet." : "Nobody has played today yet."}</p>;
  return (
    <table className="gp-lb">
      <caption>{allTime ? "Most dailies solved" : "Today's game"}</caption>
      <thead>
        <tr>
          <th scope="col">#</th><th scope="col">Player</th>
          {allTime ? <><th scope="col">Solved</th><th scope="col">Average</th></> : <th scope="col">Guesses</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.id}-${i}`} className={username && r.username === username ? "me" : undefined}>
            <td>{i + 1}</td>
            <td>{r.username}{r.guest && <span className="pill">guest</span>}</td>
            {allTime
              ? <><td>{r.solved} of {r.dailies}</td><td>{r.avgTries == null ? "—" : r.avgTries.toFixed(2)}</td></>
              : <td>{r.solved ? r.tries : "—"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function refusalLine(reason, variant) {
  switch (reason) {
    case "duplicate": return "Today's game was already recorded for this account, so this one didn't count.";
    case "guest_daily": return "The daily needs an account. This one wasn't recorded.";
    case "wrong_day": return "A new day started while you were playing, so this game belonged to yesterday's player and wasn't recorded.";
    case "bad_code": return "That isn't a code this game can play.";
    case "network": return "Couldn't save this game — check your connection.";
    default:
      return `This game couldn't be verified (${reason}). Nothing was recorded.${variant === "daily" ? " Your daily is still available." : ""}`;
  }
}

export const GUESS_CSS = `
.gp { display: grid; gap: 14px; padding-bottom: 8px; }
.gp-intro { max-width: 62ch; }
.gp-left { font-weight: 700; margin: 0; }

/* The grid of guesses. Five narrow columns and one that takes what is left, so a name never squeezes the
   colours - they are the thing being read. */
.gp-grid { width: 100%; border-collapse: separate; border-spacing: 3px; font-size: 13px; table-layout: fixed; }
.gp-grid th[scope="col"] { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);
  font-weight: 700; padding: 0 2px 2px; text-align: center; }
.gp-grid th[scope="col"]:first-child { text-align: left; }
.gp-grid col, .gp-grid th:first-child { width: auto; }
.gp-who { text-align: left; font-weight: 600; padding: 0 4px 0 0; min-width: 0; }
.gp-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.gp-cell { text-align: center; border-radius: 7px; padding: 8px 2px; font-weight: 700; font-variant-numeric: tabular-nums;
  background: var(--surface2); color: var(--ink); border: 1px solid var(--line); }
/* Green, yellow, grey - and never ONLY those: every cell carries a visually-hidden sentence saying exact,
   close or no, because colour may not be the only thing that means something (CLAUDE.md, v1.18.0's pass).
   Both paints take the SAME dark ink, and it has to be dark: --win is the game's light green and white on it is
   1.8:1, which is what tests/test-a11y.mjs's entry for this grid caught on its first run. The ink is a fixed
   colour rather than a token for the reason the cosmetics paints are - it belongs to the paint under it, not to
   the scope, and the grid is drawn on the dark scope wherever it appears. */
.gp-cell.hit { background: var(--win); color: ${CELL_INK}; border-color: var(--win); }
.gp-cell.near { background: var(--orange); color: ${CELL_INK}; border-color: var(--orange); }
.gp-cell.miss { opacity: .75; }

.gp-search { position: relative; display: grid; gap: 6px; }
.gp-hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.gp-hit { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%;
  text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--ink); cursor: pointer; }
.gp-hn { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-hm { font-size: 12px; color: var(--muted); white-space: nowrap; }
.gp-err { color: var(--loss); }
.gp-coins { color: var(--accent-ink); }

.gp-hero { text-align: center; }
.gp-eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .8; margin: 0; }
.gp-hero .gp-score { font-variant-numeric: tabular-nums; margin: 2px 0 0; }
.gp-hero .outcome { font-size: 15px; font-weight: 600; opacity: .9; margin: 6px 0 0; }
.gp-hero .rating { margin: 8px 0 0; text-wrap: pretty; }

.gp-lb { width: 100%; border-collapse: collapse; font-size: 14px; }
.gp-lb caption { text-align: left; font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); padding-bottom: 6px; }
.gp-lb th, .gp-lb td { text-align: left; padding: 7px 8px; border-top: 1px solid var(--line); }
.gp-lb tr.me { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.gp-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.gp-row { display: flex; gap: 8px; flex-wrap: wrap; }

@media (max-width: 520px) {
  .gp-grid { font-size: 12px; border-spacing: 2px; }
  .gp-cell { padding: 7px 1px; }
  .gp-name { font-size: 12px; }
}
`;
