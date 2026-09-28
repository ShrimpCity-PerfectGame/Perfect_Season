// Century (v2.9.0): seven slots, hidden stats, and 100 combined touchdowns from one real season.
//
// Every rule is in century-logic.mjs, shared with the submit-century Edge Function - this file draws it and
// nothing else. In particular the legality of a pick is asked ONCE, through `centuryBlock`, which both the
// disabled state and the click handler call. That is the lesson CLAUDE.md records about the main draft screen:
// the roster tile there was `disabled={!target}` and enforced no rule at all, so the salary cap had never actually
// been enforced in the UI for three releases. A rule belongs in one function both doors ask, never in a handler
// or a `disabled=`.
//
// The screen styles only its own `ce-` prefix and reuses the app's .btn, .tile, .h, .note and .panel, the way
// profile.jsx and shop.jsx do, and exports its stylesheet as a string for perfect-season.jsx to append.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { TEAMS } from "./game-logic.mjs";
import {
  CENTURY_SLOTS, CENTURY_GOAL, CENTURY_BOARDS, CENTURY_SEASON, centuryFits, centurySlotPos,
  centuryPlan, centuryRespinTeam, centuryScore, centuryHit, centuryTeamName, centuryReservedSeed,
} from "./century-logic.mjs";
import { teamVars, POS_NAME } from "./ui-common.jsx";
import { submitCentury, fetchCenturyTop, fetchCenturyBest, fetchMyCentury, sget, sset, clearDraft } from "./storage.js";

// What a slot is called on screen. The numbers exist so a roster can be keyed by slot (CENTURY_SLOTS' own
// comment); nobody wants to read "RB1".
export const CENTURY_SLOT_LABEL = {
  QB: "QB", RB1: "RB", RB2: "RB", WR1: "WR", WR2: "WR", TE: "TE", FLEX: "Flex",
};
const POS_ORDER = ["QB", "RB", "WR", "TE"];
// Where a run in progress lives, per device. One slot: a player has at most one Century going, since finishing is
// the only way out of the seven picks.
export const CENTURY_WIP = "ps-century-wip";
const utcDay = () => new Date().toISOString().slice(0, 10);
// A code the submission will accept, so nothing is dealt that cannot be handed in. Same shape the main game's
// challenge codes have; the alphabet skips nothing, because unlike a match code this is never read aloud.
//
// And never one that hashes to a daily's seed. The odds are about one in six million - 733 target hashes out of
// 2^32 - but the cost when it happens is seven picks made and then refused as `reserved_code`, with nothing
// recorded and nothing the player did wrong. Two lines here, checked against the same function the server uses.
const newCode = () => {
  for (let tries = 0; tries < 20; tries++) {
    let out = "";
    for (let i = 0; i < 8; i++) out += "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 36)];
    if (!centuryReservedSeed(out)) return out;
  }
  // Twenty collisions in a row is not a thing that happens; dealing a run that will be refused is better than
  // looping, and the refusal has a line of its own.
  return "AAAAAAAA";
};

// ---------- The one place a pick is judged ----------
// Returns null if the pick is legal, or a sentence saying why not. Both the board's disabled state and the click
// handler call it, so a third door added later gets the rules for free.
export function centuryBlock(player, slot, roster) {
  if (!player || !slot) return "Pick a player and a slot.";
  if (!CENTURY_SLOTS.includes(slot)) return "That isn't a slot.";
  if (roster[slot]) return `Your ${CENTURY_SLOT_LABEL[slot]} is already filled.`;
  if (!centuryFits(player.pos, slot)) {
    return slot === "FLEX"
      ? "The Flex takes a running back, receiver or tight end."
      : `${CENTURY_SLOT_LABEL[slot]} needs a ${centurySlotPos(slot)}.`;
  }
  if (Object.values(roster).some((p) => p && p.name === player.name)) return `${player.name} is already on your roster.`;
  return null;
}

// ---------- The screen ----------
export function CenturyScreen({
  userId, username, isGuest, onBack, onClaimCoins, onDailySaved,
}) {
  // stage: "menu" a variant to choose | "play" seven slots to fill | "done" the result
  const [stage, setStage] = useState("menu");
  const [run, setRun] = useState(null);       // { variant, day, seed, picks: [{slot, name, respun?}] }
  const [result, setResult] = useState(null); // what submit-century answered
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [coins, setCoins] = useState(0);
  const [chosen, setChosen] = useState(null); // the player tapped on the board, awaiting a slot
  const [board, setBoard] = useState({ day: [], best: [], loaded: false });
  const [dailyDone, setDailyDone] = useState(null);
  const [tab, setTab] = useState("day");
  const day = utcDay();
  // Nothing from a previous account may be shown: every ACCOUNT-scoped answer is checked against the request that
  // is current now, the way the main component's accountReq does it.
  //
  // Only the account-scoped ones. Sharing this counter with the resume read below meant the resume never landed:
  // the snapshot read started, the daily-already-played read bumped the counter, and the snapshot was then thrown
  // away as stale - so a run left half-finished came back as the menu, every time, for anyone signed in. A
  // device-local read is not about who is signed in and needs no such guard, only its own mount check.
  const acct = useRef(0);

  // ---------- Where a run in progress lives ----------
  // The daily resumes rather than restarts, which is the rule for every daily in the game. Unlimited resumes too,
  // because a tab reload in the middle of seven picks is not a decision to throw them away. The key carries the
  // seed, so the daily's slot and an Unlimited one can never overwrite each other.
  // Through sget/sset/clearDraft, the same door every other per-device value goes through, so a failed write is
  // a null rather than a throw. Clearing uses clearDraft, which OVERWRITES with a snapshot that cannot pass the
  // check below and only then deletes - because a delete that does not land must never bring a finished run back
  // as a resumable one (CLAUDE.md, "Assume storage operations can fail").
  const saveWip = useCallback(async (value) => {
    if (value) await sset(CENTURY_WIP, value, false);
    else await clearDraft(CENTURY_WIP);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await sget(CENTURY_WIP, false);
      if (!alive) return;
      // A daily snapshot from a day that has passed is not resumable: its seven teams were yesterday's.
      const usable = saved && typeof saved.seed === "string" && Array.isArray(saved.picks)
        && saved.picks.length < CENTURY_SLOTS.length
        && (saved.variant !== "daily" || saved.day === day);
      if (usable) { setRun(saved); setStage("play"); }
      else if (saved) saveWip(null);
    })();
    return () => { alive = false; };
  }, [day, saveWip]);

  // Has this account already played today's daily? Asked before anything is dealt, so the tile can say so rather
  // than the player finding out after seven picks.
  useEffect(() => {
    const mine = ++acct.current;
    if (!userId) { setDailyDone(null); return; }
    fetchMyCentury(day).then((r) => { if (mine === acct.current) setDailyDone(r); });
  }, [userId, day]);

  const loadBoards = useCallback(() => {
    const mine = acct.current;
    Promise.all([fetchCenturyTop(day, 10), fetchCenturyBest(10)]).then(([d, b]) => {
      if (mine !== acct.current) return;
      setBoard({ day: d || [], best: b || [], loaded: true });
    });
  }, [day]);
  useEffect(() => { if (stage !== "play") loadBoards(); }, [stage, loadBoards]);

  // ---------- Derived state, all of it from the seed ----------
  const roster = useMemo(() => {
    const r = {};
    if (!run) return r;
    // By index, not by searching for the move: two picks can be the same slot-and-name shape in a malformed
    // snapshot, and indexOf would then attribute both to the first board.
    for (let i = 0; i < run.picks.length; i++) {
      const m = run.picks[i];
      const p = (CENTURY_BOARDS[teamAt(run, i)] || []).find((q) => q.name === m.name);
      if (p) r[m.slot] = p;
    }
    return r;
  }, [run]);
  const step = run ? run.picks.length : 0;
  const respunAt = run ? run.picks.findIndex((m) => m.respun) : -1;
  const respinPending = run ? !!run.respinPending : false;
  const respinSpent = respunAt >= 0 || respinPending;
  const team = run ? teamAt(run, step) : null;
  const open = CENTURY_SLOTS.filter((s) => !roster[s]);

  // The team dealt at a given step: the plan, unless the re-spin was spent there. One function, so the board, the
  // roster above and the server's replay can never disagree about which team a pick came from.
  function teamAt(r, i) {
    if (!r) return null;
    const plan = centuryPlan(r.seed);
    const spent = r.picks.findIndex((m) => m.respun);
    const pendingHere = r.respinPending && i === r.picks.length;
    if (i === spent || pendingHere) return centuryRespinTeam(r.seed, i, plan);
    return plan[i];
  }

  // ---------- Starting and playing ----------
  function start(variant) {
    setError("");
    setResult(null);
    setCoins(0);
    setChosen(null);
    const next = variant === "daily"
      ? { variant: "daily", day, seed: `century-${day}`, picks: [] }
      : { variant: "unlimited", day: null, seed: newCode(), picks: [] };
    setRun(next);
    saveWip(next);
    setStage("play");
  }

  function take(player, slot) {
    if (!run || saving) return;
    const why = centuryBlock(player, slot, roster);
    if (why) { setError(why); return; }
    // Belt and braces, the way draft() re-checks itself: the player has to be on the board actually dealt.
    if (!(CENTURY_BOARDS[team] || []).some((p) => p.name === player.name)) {
      setError("That player isn't on this board.");
      return;
    }
    setError("");
    setChosen(null);
    const move = { slot, name: player.name };
    if (run.respinPending) move.respun = true;
    const next = { ...run, respinPending: false, picks: [...run.picks, move] };
    setRun(next);
    if (next.picks.length === CENTURY_SLOTS.length) finish(next);
    else saveWip(next);
  }

  function respin() {
    if (!run || respinSpent || saving) return;
    setError("");
    setChosen(null);
    const next = { ...run, respinPending: true };
    setRun(next);
    saveWip(next);
  }

  async function finish(finished) {
    setSaving(true);
    // The score is shown from the shared rules immediately, so an honest player waits for nothing - and then the
    // server's answer replaces it. Same shape as the main game's finish(): local for the moment, server for the
    // record.
    const local = {};
    for (let i = 0; i < finished.picks.length; i++) {
      const p = (CENTURY_BOARDS[teamAt(finished, i)] || []).find((q) => q.name === finished.picks[i].name);
      if (p) local[finished.picks[i].slot] = p;
    }
    const score = centuryScore(local);
    setResult({ local: true, score, hit: centuryHit(score), roster: rosterRows(local), goal: CENTURY_GOAL });
    setStage("done");
    saveWip(null);
    const mine = acct.current;
    const answer = await submitCentury({
      variant: finished.variant, seed: finished.seed, day: finished.day, picks: finished.picks,
    });
    if (mine !== acct.current) return;
    setSaving(false);
    if (answer.ok) {
      setResult({ ...answer, local: false });
      if (finished.variant === "daily") {
        setDailyDone({ score: answer.score, hit: answer.hit, ceiling: answer.ceiling, outcome: answer.outcome, roster: answer.roster });
        // The day the RUN was for, which is what the function answered with - not today. A run handed in as UTC
        // midnight passes belongs to the day whose teams it was played from.
        if (onDailySaved) onDailySaved({ day: answer.day, score: answer.score, hit: answer.hit });
      }
      if (onClaimCoins) onClaimCoins(finished.day || day, (credited) => setCoins(credited));
      loadBoards();
    } else {
      setError(refusalLine(answer.reason, finished.variant));
    }
  }

  const rosterRows = (r) => CENTURY_SLOTS.map((slot) => {
    const p = r[slot];
    return p ? { slot, name: p.name, team: p.team, pos: p.pos, td: p.td } : { slot, name: null, team: null, pos: null, td: 0 };
  });

  // ---------- Drawing ----------
  if (stage === "play" && run) {
    return (
      <div className="ce" data-view="play">
        <CenturyRoster roster={roster} goal={CENTURY_GOAL} />
        <div className="ce-spin" style={team ? teamVars(team) : undefined}>
          <p className="ce-step">Slot {Math.min(step + 1, CENTURY_SLOTS.length)} of {CENTURY_SLOTS.length}</p>
          <h2 className="ce-team">{team ? centuryTeamName(team) : ""}</h2>
          <p className="note">
            {respinPending ? "Re-spun. This is your team now." : "Fill one slot from this team. No stats until the end."}
          </p>
          <button className="btn" onClick={respin} disabled={respinSpent}>
            {respinSpent ? "Re-spin used" : "Re-spin this team ↻"}
          </button>
        </div>

        {error && <p className="note ce-err" role="status">{error}</p>}

        <div className="ce-board">
          {POS_ORDER.map((pos) => {
            const men = (CENTURY_BOARDS[team] || []).filter((p) => p.pos === pos);
            if (!men.length) return null;
            return (
              <section key={pos} className="ce-pos">
                <h3>{POS_NAME[pos]}</h3>
                <ul>
                  {men.map((p) => {
                    // Every slot this man could fill, asked through the one rule function.
                    const slots = CENTURY_SLOTS.filter((s) => !centuryBlock(p, s, roster));
                    const picked = chosen === p.name;
                    return (
                      <li key={p.name}>
                        <button
                          className={`ce-man${picked ? " on" : ""}`}
                          disabled={!slots.length}
                          aria-expanded={picked}
                          onClick={() => {
                            if (!slots.length) return;
                            // One legal slot is not a question worth asking.
                            if (slots.length === 1) take(p, slots[0]);
                            else setChosen(picked ? null : p.name);
                          }}
                        >
                          <span className="ce-name">{p.name}</span>
                          <span className="ce-pos-tag">{p.pos}</span>
                          {!slots.length && <span className="ce-no">No room</span>}
                        </button>
                        {picked && slots.length > 1 && (
                          <div className="ce-slots" role="group" aria-label={`Where does ${p.name} go?`}>
                            {slots.map((s) => (
                              <button key={s} className="btn solid ce-slot" onClick={() => take(p, s)}>
                                {CENTURY_SLOT_LABEL[s]}
                              </button>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
        <p className="note">{CENTURY_SEASON} regular season · {open.length} slot{open.length === 1 ? "" : "s"} to fill</p>
        <button className="btn" onClick={onBack}>Leave</button>
      </div>
    );
  }

  if (stage === "done" && result) {
    const short = Math.max(0, CENTURY_GOAL - result.score);
    return (
      <div className="ce" data-view="done">
        <div className={`ce-hero${result.hit ? " hit" : ""}`}>
          <p className="ce-eyebrow">{result.hit ? "Century" : "Short"}</p>
          <p className="ce-score">{result.score}</p>
          <p className="ce-of">of {result.goal || CENTURY_GOAL} touchdowns</p>
          {!result.hit && <p className="note">{short} short.</p>}
          {result.ceiling != null && (
            <p className="note ce-cap">Best possible from your teams: {result.ceiling}</p>
          )}
        </div>
        {coins > 0 && <p className="note ce-coins" role="status">+{coins} coins</p>}
        {saving && <p className="note" role="status">Saving…</p>}
        {error && <p className="note ce-err" role="status">{error}</p>}
        <table className="ce-card">
          <caption>Your seven, with what they actually scored</caption>
          <thead>
            <tr><th scope="col">Slot</th><th scope="col">Player</th><th scope="col">Team</th><th scope="col">TD</th></tr>
          </thead>
          <tbody>
            {(result.roster || []).map((r) => (
              <tr key={r.slot}>
                <th scope="row">{CENTURY_SLOT_LABEL[r.slot]}</th>
                <td>{r.name || "—"}</td>
                <td>{r.team ? TEAMS[r.team]?.[0] || r.team : "—"}</td>
                <td className="ce-td">{r.td}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ce-row">
          <button className="btn solid" onClick={() => start("unlimited")}>Play again 🔁</button>
          <button className="btn" onClick={() => { setStage("menu"); loadBoards(); }}>Boards</button>
          <button className="btn" onClick={onBack}>Done</button>
        </div>
      </div>
    );
  }

  // The menu, which is also where the boards live.
  return (
    <div className="ce" data-view="menu">
      <p className="note ce-intro">
        Seven slots — QB, two RB, two WR, TE and a Flex. Every spin gives you a team and you fill one slot from it,
        with no stats shown. Get to {CENTURY_GOAL} combined passing, rushing and receiving touchdowns from the{" "}
        {CENTURY_SEASON} season. One team re-spin.
      </p>
      <div className="ce-modes">
        <button className="ce-mode day" onClick={() => start("daily")} disabled={!userId || isGuest || !!dailyDone}>
          <span className="ce-mt">Daily</span>
          <span className="note">
            {isGuest ? "The daily needs an account — a guest can be made again and again."
              : !userId ? "Sign in to play the daily."
              : dailyDone ? `Played · ${dailyDone.score} of ${CENTURY_GOAL}`
              : "The same seven teams for everyone today. One go."}
          </span>
        </button>
        <button className="ce-mode free" onClick={() => start("unlimited")} disabled={!userId}>
          <span className="ce-mt">Unlimited</span>
          <span className="note">{userId ? "New teams every time, as often as you like." : "Sign in to play."}</span>
        </button>
      </div>
      {dailyDone && (
        <p className="note" role="status">
          Today: {dailyDone.outcome}{dailyDone.ceiling ? ` Best possible from those teams was ${dailyDone.ceiling}.` : ""}
        </p>
      )}

      <div className="ce-tabs" role="tablist" aria-label="Century boards">
        {[["day", "Today"], ["best", "All time"]].map(([id, label]) => (
          <button key={id} role="tab" id={`ce-tab-${id}`} aria-selected={tab === id} aria-controls={`ce-panel-${id}`}
            className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="ce-panel" id={`ce-panel-${tab}`} role="tabpanel" aria-labelledby={`ce-tab-${tab}`}>
        <CenturyBoard rows={tab === "day" ? board.day : board.best} loaded={board.loaded} username={username} allTime={tab === "best"} />
      </div>
      <button className="btn" onClick={onBack}>Back</button>
    </div>
  );
}

// The seven slots as they fill. Named so a screen reader reads the slot as well as seeing its colour - colour is
// never the only thing carrying meaning (v1.18.0's pass).
function CenturyRoster({ roster }) {
  return (
    <ul className="ce-strip" aria-label="Your roster">
      {CENTURY_SLOTS.map((s) => (
        <li key={s} className={`ce-chip${roster[s] ? " on" : ""}`} style={roster[s] ? teamVars(roster[s].team) : undefined}>
          <span className="ce-cs">{CENTURY_SLOT_LABEL[s]}</span>
          <span className="ce-cn">{roster[s] ? roster[s].name : "—"}</span>
        </li>
      ))}
    </ul>
  );
}

function CenturyBoard({ rows, loaded, username, allTime }) {
  if (!loaded) return <p className="note">Loading…</p>;
  if (!rows.length) return <p className="note">{allTime ? "Nobody has played yet." : "Nobody has played today yet."}</p>;
  return (
    <table className="ce-lb">
      <caption>{allTime ? "Best Century ever, one per player" : "Today's Century"}</caption>
      <thead>
        <tr>
          <th scope="col">#</th><th scope="col">Player</th><th scope="col">Score</th>
          {allTime && <th scope="col">Runs</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.id}-${i}`} className={username && r.username === username ? "me" : undefined}>
            <td>{i + 1}</td>
            <td>
              {r.username}
              {r.guest && <span className="pill">guest</span>}
              {r.hit && <span className="ce-hit" title={`Reached ${CENTURY_GOAL}`}>💯</span>}
            </td>
            <td>{r.score}</td>
            {allTime && <td>{r.runs}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Every refusal storage-century.js can hand back, worded. A reason with no line here would read as nothing at
// all, which is why the list is exhaustive rather than a default with a couple of special cases.
function refusalLine(reason, variant) {
  switch (reason) {
    case "duplicate": return "Today's Century was already recorded for this account, so this one didn't count.";
    case "guest_daily": return "The daily needs an account. This one wasn't recorded.";
    case "wrong_day": return "A new day started while you were playing, so this run belonged to yesterday's teams and wasn't recorded.";
    case "reserved_code": return "That code deals a daily's own teams, so it can't be played here.";
    case "bad_code": return "That isn't a code this mode can play.";
    case "network": return "Couldn't save this run — check your connection.";
    default:
      // A replay reason means the screen and the server disagreed about the rules, which is a bug rather than a
      // refusal a player can act on. Say so honestly instead of blaming their connection.
      return `This run couldn't be verified (${reason}). Nothing was recorded.${variant === "daily" ? " Your daily is still available." : ""}`;
  }
}

export const CENTURY_CSS = `
.ce { display: grid; gap: 14px; padding-bottom: 8px; }
.ce-intro { max-width: 60ch; }

.ce-modes { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
.ce-mode { display: grid; gap: 4px; text-align: left; padding: 14px; border-radius: 14px; border: 2px solid var(--line);
  background: var(--surface); color: var(--ink); cursor: pointer; }
.ce-mode .ce-mt { font-family: var(--display); font-size: 20px; letter-spacing: .01em; }
.ce-mode.day { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.ce-mode.day .note { color: var(--on-accent); opacity: .85; }
.ce-mode:disabled { opacity: .6; cursor: default; }

.ce-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; list-style: none; margin: 0; padding: 0; }
.ce-chip { display: grid; gap: 2px; padding: 6px 4px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--surface); min-width: 0; }
.ce-chip.on { border-color: var(--tc1); box-shadow: inset 0 3px 0 var(--tc1); }
.ce-cs { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.ce-cn { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* The spin panel and the result hero are stadium-dark wherever they appear, so both are named in
   perfect-season.jsx's dark-scope selector list and take --bg / --ink / --accent from there rather than
   hardcoding a navy. The team tints it through --tc-deep, which is that team's colour deepened until cream
   text clears AA on it (ui-common.jsx's teamVars). */
.ce-spin { display: grid; gap: 6px; justify-items: start; padding: 16px; border-radius: 16px;
  background: linear-gradient(135deg, var(--tc-deep, var(--surface2)), var(--bg)); }
.ce-spin .note { opacity: .8; }
.ce-step { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; opacity: .75; margin: 0; }
.ce-team { font-family: var(--display); font-size: 30px; line-height: 1; margin: 0; }

.ce-board { display: grid; gap: 12px; }
.ce-pos h3 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 4px; }
.ce-pos ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.ce-man { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 10px 12px;
  border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); cursor: pointer; }
.ce-man.on { border-color: var(--accent-ink); }
.ce-man:disabled { opacity: .45; cursor: default; }
.ce-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ce-pos-tag { font-size: 11px; color: var(--muted); }
.ce-no { font-size: 11px; color: var(--muted); }
.ce-slots { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 0 2px 12px; }
.ce-slot { padding: 6px 12px; }
.ce-err { color: var(--loss); }

.ce-hero { display: grid; gap: 2px; justify-items: center; padding: 22px 16px; border-radius: 16px;
  background: var(--bg); text-align: center; }
.ce-hero.hit { background: var(--accent); color: var(--on-accent); }
.ce-eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .8; margin: 0; }
.ce-score { font-family: var(--display); font-size: 68px; line-height: .9; margin: 0; font-variant-numeric: tabular-nums; }
.ce-of { font-size: 13px; opacity: .85; margin: 0; }
.ce-hero .note { color: inherit; opacity: .8; }
.ce-coins { color: var(--accent-ink); }

.ce-card, .ce-lb { width: 100%; border-collapse: collapse; font-size: 14px; }
.ce-card caption, .ce-lb caption { text-align: left; font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); padding-bottom: 6px; }
.ce-card th, .ce-card td, .ce-lb th, .ce-lb td { text-align: left; padding: 7px 8px; border-top: 1px solid var(--line); }
.ce-card th[scope="row"] { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.ce-td, .ce-lb td:nth-child(3) { font-variant-numeric: tabular-nums; text-align: right; }
.ce-lb tr.me { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.ce-hit { margin-left: 6px; }
.ce-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.ce-row { display: flex; gap: 8px; flex-wrap: wrap; }

@media (max-width: 520px) {
  .ce-modes { grid-template-columns: 1fr; }
  /* Seven chips do not fit a phone in one row - two rows of four and three, which keeps every slot visible
     without a horizontal scroll. Base rules are above this block, never below it (CLAUDE.md). */
  .ce-strip { grid-template-columns: repeat(4, 1fr); }
  .ce-score { font-size: 56px; }
  .ce-team { font-size: 24px; }
}
@media (pointer: coarse) {
  .ce-man, .ce-mode, .ce-slot { min-height: 44px; position: relative; z-index: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .ce-man, .ce-mode { transition: none; }
}
`;
