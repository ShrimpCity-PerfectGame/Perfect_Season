// Guess the Player (v2.13.0): five guesses at the day's player, five columns that go green, yellow or grey.
//
// Every rule is in guess-logic.mjs, shared with the submit-guess Edge Function - this file draws it. It styles
// only its own `gp-` prefix and reuses the app's .btn, .h, .note, .panel and .mode, the way the other screens
// do, and exports its stylesheet for perfect-season.jsx to append.
//
// Known and accepted, the same way it is accepted for every other seeded mode in this game: the answer is
// derivable from the date and the pool, and both are public. The cycle ships in the bundle; the pool does NOT -
// it is fetched from /data/guess-pool.json, which tests/test-build-seo.mjs holds page.js to NOT containing -
// and a file served from the site root is every bit as readable, so this is the same gap either way. Somebody
// willing to run guess-logic in a console can read today's player, and every later day's. What is closed is
// the in-app rehearsal - and the BOARD is honest either way, because submit-guess recomputes the answer and
// the result from the date alone. GUESS.md 5 prices both this and the replay gap beside it.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { TEAMS } from "./game-logic.mjs";
import {
  GUESS_PLAYERS, GUESS_TRIES, GUESS_COLUMNS, DIVISIONS,
  guessPlayer, compareGuess, guessAnswerFor, guessAnswerForSeed, guessOutcome, replayGuessGame,
  guessDifficulty, guessBand, guessDayNumber, GUESS_POOL_INFO,
} from "./guess-logic.mjs";
import { loadGuessPool } from "./guess-pool.mjs";
import { BADGE_BY_ID } from "./badges.mjs";
import { NameLink } from "./cosmetics.jsx";
import { teamVars, reducedMotion } from "./ui-common.jsx";
import { submitGuess, fetchGuessTop, fetchGuessBest, fetchMyGuess, sget, sset, clearDraft, GUESS_RETRY } from "./storage.js";
import { sendOnce } from "./pending-daily.mjs";

export const GUESS_WIP = "ps-guess-wip";
// A daily that has been PLAYED, kept on this device whether or not the save reached the server. The season
// draft has always done this (perfect-season.jsx's DAILY_KEY) and this screen did not: `dailyDone` came only
// from fetchMyGuess, so a refused save left the tile saying "Let's go" with the answer on the screen behind
// it - play, pull the network before the last guess, read the answer, come back and solve it in one. The row
// the server never wrote is exactly the row that cannot stop the replay, so the device has to remember.
// Keyed by ACCOUNT as well as day. Device-scoped, it leaked: play the daily, sign out, and the next
// account on the same device - a guest included, who may not play the daily at all - read the day as already
// spent. The server's row is per-account, so this has to be too.
export const GUESS_DONE = (userId, day) => `ps-guess-done:${userId || "anon"}:${day}`;
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
// The rule the pool was built by, in a sentence, taken from the file rather than written out here - the window
// has moved twice already and a hard-coded "this season" was wrong within the hour.
const poolRule = () => {
  const { sinceSeason, minSnaps, legends } = GUESS_POOL_INFO;
  const playing = sinceSeason && minSnaps
    ? `everyone with ${minSnaps} snaps or more since the ${sinceSeason} season kicked off`
    : "everyone playing now";
  return legends ? `${playing}, and ${legends} of the greats` : playing;
};
// The ink on a coloured cell. Both paints are light, so it is dark on both - see the note in GUESS_CSS.
const CELL_INK = "#1B1B1B";
const ARROW = { up: "↑", down: "↓" };

// ---------- The share card ----------
// The squares one row per guess, the way Wordle's do. What makes it safe to show is that a reader does not know
// what was GUESSED: a green in the team column says "the answer's team matched a guess of mine", which is a
// fact about a name they do not have. That is why the grid can be shown when the guesses themselves never can.
//
// What is deliberately NOT on the card: the player, the guesses, and the day's DIFFICULTY. The first two are
// the answer; the third is a real hint about it - everyone reading a daily's card is playing the same day, and
// "difficulty 8/100" tells them it is somebody obvious. The end screen shows it because the game is over there.
const SHARE_SQUARE = { hit: "\u{1F7E9}", near: "\u{1F7E8}", miss: "\u2B1B" };

export function guessShareLink(base, seed) {
  return `${base}/c/${seed}?${new URLSearchParams({ mode: "guess" })}`;
}

export function guessShareText({ solved, tries, tried = GUESS_TRIES, rows = [], day, seed, siteUrl }) {
  const n = day ? guessDayNumber(day) + 1 : 0;
  const title = day ? `Gridspin · Guess the Player ${n >= 1 ? n : day}` : "Gridspin · Guess the Player";
  const lines = [`${title} \u00b7 ${solved ? `${tries}/${tried}` : `X/${tried}`}`];
  for (const r of rows) lines.push(GUESS_COLUMNS.map((c) => SHARE_SQUARE[r.row[c].state] || SHARE_SQUARE.miss).join(""));
  // A practice code hands over the same player, which is the whole point of sending one. A DAILY never gets a
  // link to its game: everybody has it already, and a code that dealt it would be a way round the one-go rule.
  if (!day && seed) {
    lines.push(siteUrl ? `Same player: ${guessShareLink(siteUrl, seed)}` : `Same player: code ${seed}`);
  } else if (siteUrl) {
    lines.push(siteUrl);
  }
  return lines.join("\n");
}

// What the share sheet did, in sendShare's own words - the same four the other screens use.
export const SHARE_SAID = { shared: "", cancelled: "", copied: "Copied", manual: "Couldn't share - copy it by hand" };

// The short form a cell prints. Division is the only one that would not fit, so it loses its conference.
const cellText = (col, p) => {
  if (col === "team") return p.team;
  // "NFC N", not "N-North": the cell is about 45 pixels wide on a phone and the longer form wrapped onto two
  // lines, which made the row taller than the name beside it. The conference and one letter say the same thing.
  if (col === "division") return (p.division || "").replace(/^(AFC|NFC) (.)\w+$/, "$1 $2");
  if (col === "pos") return p.pos;
  if (col === "draft") return String(p.draft);
  return `#${p.number}`;
};
// What a screen reader hears, which is not abbreviated: it has the room, and "NFC North" is the thing itself.
const cellSaid = (col, p) => (col === "division" ? (p.division || "") : cellText(col, p));

export function GuessScreen({
  userId, username, isGuest, onBack, onClaimCoins, onDailySaved, onStage, onNeedsAccount,
  onShare, siteUrl, challenge, onChallengeTaken, onPlayed,
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
  // The badge this run earned, if it earned one. The function has always returned it so the screen could
  // say so, and neither screen read it: a first Century or a first Bullseye paid 1,000 or 300 coins while
  // the end screen said "+15 coins", which is the biggest payout either mode can produce going unmentioned.
  const [badge, setBadge] = useState(null);
  const [query, setQuery] = useState("");
  const [board, setBoard] = useState({ day: [], best: [], loaded: false });
  const [dailyDone, setDailyDone] = useState(null);
  const [tab, setTab] = useState("day");
  const [shared, setShared] = useState(null); // what the share sheet did, in sendShare's own words
  const [rosterOpen, setRosterOpen] = useState(false);
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
      const spent = saved && saved.variant === "daily" && saved.day === day && userId
        ? !!(await sget(GUESS_DONE(userId, day), false)) : false;
      if (!alive || started.current) return;
      const usable = saved && !spent && Array.isArray(saved.guesses) && saved.guesses.length < GUESS_TRIES
        && (saved.variant !== "daily" || saved.day === day);
      if (usable) { setRun(saved); setStage("play"); }
      else if (saved) saveWip(null);
    })();
    return () => { alive = false; };
  }, [day, saveWip, pool, userId]);

  // A link somebody sent: its code IS the seed, so the same player comes up. It replaces whatever was in
  // progress - a game here is five guesses, not a record - and is cleared as it is taken so it cannot re-deal
  // on the next render.
  useEffect(() => {
    if (!challenge || !challenge.seed || !userId || pool !== "ready") return;
    start("practice", challenge.seed);
    if (onChallengeTaken) onChallengeTaken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, userId, pool]);

  useEffect(() => {
    const mine = ++acct.current;
    if (!userId) { setDailyDone(null); return; }
    // The server first, then this device. Either one means the day is spent: a run the server never
    // recorded is still a run this player has seen the answer to.
    fetchMyGuess(day).then(
      async (r) => { if (mine === acct.current) setDailyDone(r || (await sget(GUESS_DONE(userId, day), false)) || null); },
      async () => { const local = await sget(GUESS_DONE(userId, day), false); if (mine === acct.current) setDailyDone(local || null); },
    );
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
    setBadge(null);
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
    // Written BEFORE the submission and never conditioned on it. The numbers are the client's own replay,
    // which is what the end screen is already showing; the server's answer replaces them below when it lands.
    if (finished.variant === "daily" && finished.day) {
      // `saved: false` is the whole of the outbox: while it is false this run is still owed to the board
      // and pending-daily.mjs will re-send it. `guesses` is what gets re-sent, so it is written ONCE,
      // here, and never merged or rebuilt - a drain must not be able to post a better game than was played.
      const rec = { day: finished.day, solved: !!local.ok && local.solved, tries: local.ok ? local.tries : finished.guesses.length,
                    outcome: guessOutcome(!!local.ok && local.solved, local.ok ? local.tries : finished.guesses.length),
                    guesses: finished.guesses, answer: answer?.id, saved: false };
      await sset(GUESS_DONE(userId, finished.day), rec, false);
      setDailyDone(rec);
    }
    const mine = acct.current;
    // Through the same lock the drain uses, so a drain firing while this is in the air cannot put a
    // second copy of the run on the wire.
    const sent = await sendOnce(finished.variant === "daily" && finished.day ? GUESS_DONE(userId, finished.day) : "guess:practice",
      () => submitGuess({ variant: finished.variant, seed: finished.seed, day: finished.day, guesses: finished.guesses }));
    if (mine !== acct.current) return;
    setSaving(false);
    if (sent.ok) {
      setResult({ ...sent, local: false, answer: sent.answer });
      if (finished.variant === "daily") {
        // Settle the stored record too. Until v2.18.0 this only set React state, so EVERY stored record
        // said the save had failed and a remount would have re-sent a run that was already on the board.
        const done = { day: finished.day, solved: sent.solved, tries: sent.tries, outcome: sent.outcome,
                       guesses: finished.guesses, answer: sent.answer?.id, saved: true };
        if (finished.day) await sset(GUESS_DONE(userId, finished.day), done, false);
        setDailyDone(done);
        if (onDailySaved) onDailySaved({ day: sent.day, solved: sent.solved, tries: sent.tries });
      }
      // The row is in guess_runs/century_runs now, and site_totals counts those into `plays` -
      // so the home screen's pill may tick. Only on ok: a refused save wrote no row.
      if (onPlayed) onPlayed();
      if (sent.badge?.awarded?.length) setBadge(sent.badge);
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
    setBadge(null);
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
            <p className="note">
              Nobody by that name is in the game. It holds quarterbacks, backs, receivers and tight ends —{" "}
              {poolRule()} — and the menu lists every one of them.
            </p>
          )}
        </div>

        <button className="btn" onClick={onBack}>Leave</button>
      </div>
    );
  }

  if (stage === "done" && result) {
    // The answer comes back from the server as plain columns; the pool is where the rest of him lives.
    const answerPlayer = result.answer ? guessPlayer(result.answer.id) : null;
    const difficulty = result.answer ? guessDifficulty(result.answer) : null;
    const band = result.answer ? guessBand(result.answer) : null;
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
              {TEAMS[result.answer.team] ? TEAMS[result.answer.team][0] : result.answer.team},{" "}
              {answerPlayer?.undrafted ? "undrafted in" : "drafted"} {result.answer.draft}, #{result.answer.number}
              {result.answer.from ? ` (${result.answer.from}–${result.answer.to})` : ""}.
            </p>
          )}
          {/* How hard the day was, printed only now the game is over - before it, it is a hint. The number is
              his place in the pool's own ranking, so 0 is the player everybody knows and 100 the deepest cut. */}
          {difficulty != null && (
            <p className="gp-difficulty">
              Difficulty <strong>{difficulty}</strong>/100
              {band ? <span className="gp-band"> · {band === "easy" ? "one most people get" : band === "medium" ? "a fair test" : "a deep cut"}</span> : null}
            </p>
          )}
        </div>
        {coins > 0 && <p className="note gp-coins" role="status">+{coins} coins</p>}
        {/* A badge this run earned. Named, because "+1,000 coins" with no reason is a mystery, and the
            badge is the bigger thing. `credited` is 0 when it was already paid, which is why the line
            only mentions coins when there are some. */}
        {badge?.awarded?.map((id) => BADGE_BY_ID[id]).filter(Boolean).map((b) => (
          <p key={b.id} className="note gp-coins" role="status">
            {b.emoji} {b.name} unlocked{badge.credited > 0 ? ` · +${badge.credited} coins` : ""}
          </p>
        ))}
        {saving && <p className="note" role="status">Saving…</p>}
        {error && <p className="note gp-err" role="status">{error}</p>}
        <GuessTable rows={shown} />
        <div className="gp-row">
          {onShare && (
            <button className="btn" onClick={async () => {
              const how = await onShare(guessShareText({
                solved: result.solved, tries: result.tries, tried: result.tried || GUESS_TRIES,
                rows: shown.map((r) => ({ row: r.row })), day: result.day, seed: result.seed || run?.seed, siteUrl,
              }));
              setShared(how);
            }}>Share</button>
          )}
          {shared && <span className="note gp-shared" role="status">{SHARE_SAID[shared] || ""}</span>}
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
        One player a day, {GUESS_TRIES} guesses. Every guess shows how close it was on five things — team,
        division, position, draft class and number. Green is exact, yellow is close, and the arrows say which
        way to go.
      </p>
      <GuessRoster open={rosterOpen} onToggle={() => setRosterOpen((v) => !v)} />
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
              : `The same player for everyone today. One go, ${GUESS_TRIES} guesses.`}
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
            {/* `gp-c-` is the CELL's own prefix, and it earned both halves of its name. Unprefixed, `hit`
                collided with the draft card's `.hit` (`all:unset;display:block`) and a winning row - five hits
                at once - drew its five cells stacked in one column; prefixed as `gp-hit` it collided with the
                search result buttons below. Nothing failed either time: jsdom has no layout and axe measures
                colour, so the first took opening the game on staging to see. */}
            {GUESS_COLUMNS.map((c) => (
              <td key={c} className={`gp-cell gp-c-${row[c].state}`} style={c === "team" ? teamVars(player.team) : undefined}>
                <span aria-hidden="true">{cellText(c, player)}{row[c].hint ? ARROW[row[c].hint] : ""}</span>
                <span className="vh">
                  {GUESS_HEADS[c]} {cellSaid(c, player)}: {SAID[row[c].state]}
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

// Everybody the game can ask about, by position. NAMES ONLY - no team, no class, no number.
//
// This exists because the pool has a boundary nobody can see. "Everyone playing this season" is a category a
// fan can reason about; "and twenty-five of the greats" is not, so the only way to find out whether Jerry Rice
// was in it was to type his name and see. That is not difficulty, it is a guessing game about the guessing
// game - and with the pool down to a couple of hundred it can simply be shown.
//
// The five columns stay off it deliberately. A table of every player WITH his team, class and number would not
// be a list, it would be the answer key: you could filter it by the colours and read off the man. The names
// bound the search; the clues still have to be earned.
function GuessRoster({ open, onToggle }) {
  const byGroup = useMemo(() => {
    const out = new Map();
    for (const p of [...GUESS_PLAYERS].sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!out.has(p.group)) out.set(p.group, []);
      out.get(p.group).push(p);
    }
    return [...out].sort((a, b) => ROSTER_ORDER.indexOf(a[0]) - ROSTER_ORDER.indexOf(b[0]));
  }, []);
  return (
    <section className="gp-roster">
      <button className="linkbtn" aria-expanded={open} aria-controls="gp-roster-list" onClick={onToggle}>
        {open ? "Hide who's in the game" : `Who's in the game? (${GUESS_PLAYERS.length})`}
      </button>
      <div id="gp-roster-list" hidden={!open}>
        <p className="note">
          Every player the game can ask about — {poolRule()}. Teams, draft classes and numbers are not listed:
          those are the game.
        </p>
        {byGroup.map(([group, men]) => (
          <div key={group} className="gp-rgroup">
            <h3 className="h">{ROSTER_LABEL[group] || group} <span className="gp-rcount">{men.length}</span></h3>
            <p className="gp-rnames">{men.map((p) => p.name).join(" · ")}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
const ROSTER_ORDER = ["QB", "RB", "WR", "TE"];
const ROSTER_LABEL = { QB: "Quarterbacks", RB: "Running backs", WR: "Receivers", TE: "Tight ends" };

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
            <td><NameLink name={r.username} guest={r.guest} /></td>
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
    case "signed_out": return "You were signed out while playing, so this game wasn't recorded. Sign in and the next one will be.";
    case "no_profile": return "This account hasn't picked a username yet, so there was nowhere to record the game.";
    // Distinct from "network" on purpose. Telling somebody to check a connection that was working
    // is worse than saying nothing, and it sent us looking in the wrong place for a whole evening.
    case "server": return "This game didn't save — that one is on us, not your connection.";
    case "network": return "Couldn't save this game — check your connection.";
    // The reason the outbox exists, and it had no line of its own until v2.18.6 - it fell to the default
    // below, which leaks the internal code and then says two things that are both false: nothing was
    // recorded (the game is on this device, `saved: false`, which is exactly what the drain re-sends) and
    // the daily is still available (since v2.17.0 the device record is written BEFORE the POST, so the
    // day is spent either way - that is what stops a dropped save being replayed with the answer known).
    case "offline": return "Couldn't reach the server, so this game is saved on this device and will be sent as soon as you're back online.";
    // The screen's own lock, when a drain already has this game in the air. Nothing is wrong and nothing is lost.
    case "in_flight": return "This game is already on its way.";
    default:
      return `This game couldn't be verified (${reason}). Nothing was recorded.`;
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
/* The NAME COLUMN takes what the five cells do not, and that is the whole of this. A fixed table layout with
   no widths gives six equal columns, so the name got a sixth of a phone - about 55px - and every row read
   "Tyler C...", "Davant...", "Penei ...". The player is the one thing on the row you actually have to read.
   Five cells at 13.6% leaves 32% for the name: 120px at 375px wide, which is most names on one line. */
.gp-grid th:first-child { width: 32%; }
.gp-grid th:not(:first-child) { width: 13.6%; }
.gp-who { text-align: left; font-weight: 600; padding: 0 6px 0 0; min-width: 0; vertical-align: middle; }
/* A long one WRAPS rather than being cut off. An ellipsis hides the half of the name that identifies him -
   "Davant..." could be Davante Adams or Davante Davis - where a second line costs a few pixels of height. */
.gp-name { display: block; font-size: 13px; line-height: 1.15; overflow-wrap: anywhere; }
.gp-cell { text-align: center; border-radius: 7px; padding: 8px 2px; font-weight: 700; font-variant-numeric: tabular-nums;
  background: var(--surface2); color: var(--ink); border: 1px solid var(--line); }
/* Green, yellow, grey - and never ONLY those: every cell carries a visually-hidden sentence saying exact,
   close or no, because colour may not be the only thing that means something (CLAUDE.md, v1.18.0's pass).
   Both paints take the SAME dark ink, and it has to be dark: --win is the game's light green and white on it is
   1.8:1, which is what tests/test-a11y.mjs's entry for this grid caught on its first run. The ink is a fixed
   colour rather than a token for the reason the cosmetics paints are - it belongs to the paint under it, not to
   the scope, and the grid is drawn on the dark scope wherever it appears. */
.gp-cell.gp-c-hit { background: var(--win); color: ${CELL_INK}; border-color: var(--win); }
.gp-cell.gp-c-near { background: var(--orange); color: ${CELL_INK}; border-color: var(--orange); }
.gp-cell.gp-c-miss { opacity: .75; }

.gp-search { position: relative; display: grid; gap: 6px; }
.gp-hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.gp-hit { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%;
  text-align: left; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); color: var(--ink); cursor: pointer; }
.gp-hn { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gp-hm { font-size: 12px; color: var(--muted); white-space: nowrap; }
.gp-err { color: var(--loss); }
.gp-shared { align-self: center; }
.gp-coins { color: var(--accent-ink); }

/* Who's in the game. Names run as one wrapped line per position rather than a list of rows: it is a reference
   to scan, not a table to read, and 200 rows would bury the rest of the menu. */
.gp-roster { display: grid; gap: 8px; }
.gp-rgroup { margin-top: 10px; }
.gp-rgroup .h { display: flex; align-items: baseline; gap: 8px; margin: 0 0 4px; }
.gp-rcount { font-size: 11px; color: var(--muted); font-weight: 700; }
.gp-rnames { margin: 0; font-size: 13px; line-height: 1.5; color: var(--ink); text-wrap: pretty; }

.gp-hero { text-align: center; }
.gp-eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .8; margin: 0; }
.gp-hero .gp-score { font-variant-numeric: tabular-nums; margin: 2px 0 0; }
.gp-hero .outcome { font-size: 15px; font-weight: 600; opacity: .9; margin: 6px 0 0; }
.gp-hero .rating { margin: 8px 0 0; text-wrap: pretty; }
.gp-difficulty { margin: 10px 0 0; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; opacity: .75; }
.gp-difficulty strong { font-variant-numeric: tabular-nums; }
.gp-band { opacity: .8; text-transform: none; letter-spacing: 0; }

.gp-lb { width: 100%; border-collapse: collapse; font-size: 14px; }
.gp-lb caption { text-align: left; font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); padding-bottom: 6px; }
.gp-lb th, .gp-lb td { text-align: left; padding: 7px 8px; border-top: 1px solid var(--line); }
.gp-lb tr.me { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.gp-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
/* Centred, because everything above it is: the hero, the answer line and the difficulty all sit on
   the centre line, and the grid fills the width. Left as flex-start this row hung off the left -
   and once Share is there (it is absent in the harness, present in a real browser) four buttons
   wrap and Done sits alone against the left edge with two thirds of the row empty beside it. */
.gp-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }

@media (max-width: 520px) {
  /* Every pixel the cells give back goes to the name. The cells hold at most "N-North" and "2018 down-arrow",
     which fit at 11px; the name is the thing being read, so it keeps 12. */
  .gp-grid { font-size: 11px; border-spacing: 2px; }
  .gp-grid th[scope="col"] { font-size: 9px; letter-spacing: .04em; }
  .gp-cell { padding: 7px 0; }
  .gp-name { font-size: 12px; }
  .gp-grid th:first-child { width: 31%; }
  .gp-grid th:not(:first-child) { width: 13.8%; }
}

/* The smallest phone this game supports (CLAUDE.md's 320px). A cell is 38 pixels there, and "2021" with an
   arrow after it does not fit at 11px - it was the class column, every time, on exactly one screen size. */
@media (max-width: 360px) {
  .gp-grid { font-size: 10px; }
  .gp-name { font-size: 11px; }
}
`;
