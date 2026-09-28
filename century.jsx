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
  CENTURY_SLOTS, CENTURY_GOAL, CENTURY_BOARDS, CENTURY_SEASON, CENTURY_TEAMS, CENTURY_FLEX,
  centuryFits, centurySlotPos, centuryPlan, centuryRespinTeam, centuryScore, centuryHit,
  centuryTeamName, centuryReservedSeed,
} from "./century-logic.mjs";
import { teamVars, POS_NAME, Confetti, reducedMotion, dailyNumber } from "./ui-common.jsx";
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

// ---------- Sharing ----------
// How many squares the bar is drawn with. Ten, so each one is ten touchdowns and the row reads as a percentage
// of the goal without anybody counting.
const SHARE_SQUARES = 10;
// sendShare answers in four words; only three of them are worth saying. A closed share sheet says NOTHING -
// closing it is a choice, not a failure, and nothing was sent.
export const SHARE_SAID = { shared: "", cancelled: "", copied: "Copied", manual: "Couldn't share - copy it by hand" };

// A Century link somebody can actually play: the seed IS the code, so a friend gets the same seven teams in the
// same order. It rides on /c/CODE, which vercel.json already serves, with mode=century telling the app to open
// Century rather than deal a season from it. `score` is the sharer's own claim and is only ever a headline -
// nothing scores from it, exactly as the season link's `beat` is.
//
// The DAILY never gets one. Its seed is `century-<date>`, and a link carrying that would hand over the day's
// seven teams - which is the whole reason centuryReservedSeed exists.
export function centuryChallengeLink(base, seed, score) {
  const q = new URLSearchParams({ mode: "century", score: String(score) });
  return `${base}/c/${seed}?${q}`;
}

// The Wordle-style card. It names no player and no team, for the reason shareText names none: the daily's seven
// teams are the same for everyone that day, so a card that hinted at them would spoil it. Everything here is
// derived from the score, which the card states in words anyway - the squares add nothing a reader could not
// already see, which is what makes them safe.
export function centuryShareText({ score, hit, ceiling, goal = CENTURY_GOAL, variant, day, seed, siteUrl }) {
  const filled = hit ? SHARE_SQUARES : Math.max(0, Math.min(SHARE_SQUARES, Math.floor((score / goal) * SHARE_SQUARES)));
  const bar = "\u{1F7E9}".repeat(filled) + "\u2B1C".repeat(SHARE_SQUARES - filled);
  const n = variant === "daily" && day ? dailyNumber(day) : null;
  const title = variant === "daily"
    ? `Gridspin Century ${n >= 1 ? n : day}`
    : "Gridspin Century";
  const lines = [`${title} \u00b7 ${hit ? "\u{1F4AF} " : ""}${score}/${goal}`, bar];
  if (ceiling) lines.push(`Best possible from my seven teams: ${ceiling}`);
  // The link goes last, where chat apps turn it into a preview. A bare local build has no address to give.
  if (variant !== "daily" && seed) {
    lines.push(siteUrl ? `Same seven teams: ${centuryChallengeLink(siteUrl, seed, score)}` : `Same seven teams: code ${seed}`);
  } else if (siteUrl) {
    lines.push(siteUrl);
  }
  return lines.join("\n");
}

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
  userId, username, isGuest, onBack, onClaimCoins, onDailySaved, onStage, onNeedsAccount,
  onShare, siteUrl, challenge, onChallengeTaken,
}) {
  // stage: "menu" a variant to choose | "play" seven slots to fill | "done" the result
  const [stage, setStage] = useState("menu");
  const [run, setRun] = useState(null);       // { variant, day, seed, picks: [{slot, name, respun?}] }
  const [result, setResult] = useState(null); // what submit-century answered
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [coins, setCoins] = useState(0);
  const [selected, setSelected] = useState(null); // the player tapped on the board, awaiting a slot
  const [showDone, setShowDone] = useState({});   // positions with no room left, expanded again by hand
  // The reel. A cosmetic cycle only - nothing seeded reads it, and the team it settles on was decided by
  // centuryPlan long before. `reducedMotion` is what makes it resolve instantly for anyone who asked for
  // less motion, and for the tests, which set that media query to match (tests/helpers.mjs).
  const [spinFace, setSpinFace] = useState(null);
  const spinTimer = useRef(null);
  const [board, setBoard] = useState({ day: [], best: [], loaded: false });
  const [dailyDone, setDailyDone] = useState(null);
  const [tab, setTab] = useState("day");
  const [shared, setShared] = useState(null); // what the share sheet did, in sendShare's own words
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

  // A link somebody sent: its code IS the seed, so the seven teams come up in the order they came up for
  // them. It replaces whatever was in progress, the way taking a season challenge abandons a draft - a run
  // here is seven picks, not a record. Cleared as it is taken so it cannot re-deal on the next render.
  useEffect(() => {
    if (!challenge || !challenge.seed || !userId) return;
    start("unlimited", challenge.seed);
    if (onChallengeTaken) onChallengeTaken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, userId]);

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
  // The play stage is stadium-dark, the way every other draft screen is - and that is decided on the ROOT,
  // not here: scoping only this container left dark-scope text on a cream page, with the section headings
  // near-invisible. The app owns the root class, so it has to be told which stage we are on.
  useEffect(() => {
    if (onStage) onStage(stage);
    return () => { if (onStage) onStage("menu"); };
  }, [stage, onStage]);

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
  const spinning = spinFace !== null;
  // While the reel runs, the reel shows a team that is not yours yet. Everything else - the board, the
  // heading, what a pick is judged against - reads `team`, so a click can never land on the face.
  const shownTeam = spinFace || team;

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

  // A new board spins in, the way the draft screen deals one. Nine faces at 70ms is about two thirds of a
  // second - long enough to read as a spin, short enough that nobody taps through it. The selection is
  // dropped with it: the player you had picked out belonged to the last team.
  useEffect(() => {
    if (stage !== "play" || !team) return undefined;
    setSelected(null);
    setShowDone({});
    if (reducedMotion()) { setSpinFace(null); return undefined; }
    let n = 0;
    const face = () => CENTURY_TEAMS[Math.floor(Math.random() * CENTURY_TEAMS.length)];
    setSpinFace(face());
    clearInterval(spinTimer.current);
    spinTimer.current = setInterval(() => {
      n += 1;
      if (n >= 9) { clearInterval(spinTimer.current); setSpinFace(null); return; }
      setSpinFace(face());
    }, 70);
    return () => clearInterval(spinTimer.current);
  }, [team, stage]);

  // ---------- Starting and playing ----------
  function start(variant, seed) {
    setError("");
    setResult(null);
    setCoins(0);
    setSelected(null);
    setShowDone({});
    const next = variant === "daily"
      ? { variant: "daily", day, seed: `century-${day}`, picks: [] }
      : { variant: "unlimited", day: null, seed: seed || newCode(), picks: [] };
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
    setSelected(null);
    const move = { slot, name: player.name };
    if (run.respinPending) move.respun = true;
    const next = { ...run, respinPending: false, picks: [...run.picks, move] };
    setRun(next);
    if (next.picks.length === CENTURY_SLOTS.length) finish(next);
    else saveWip(next);
  }

  // Today's daily, played and looked at again. It was a dead end: the tile said "Played" and was disabled,
  // while the Mini games tile promised "See today's result" - so the run you had just made was unreachable.
  // fetchMyCentury already brings the roster back, so there was nothing to fetch, only somewhere to show it.
  function showDailyResult() {
    if (!dailyDone) return;
    setError("");
    setCoins(0);
    setShared(null);
    setResult({ ...dailyDone, goal: CENTURY_GOAL, replay: true, day });
    setStage("done");
  }

  function respin() {
    if (!run || respinSpent || saving) return;
    setError("");
    setSelected(null);
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
    setShared(null);
    setResult({ local: true, score, hit: centuryHit(score), roster: rosterRows(local), goal: CENTURY_GOAL,
      day: finished.day, seed: finished.seed });
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
  // The play screen IS the draft screen, deliberately: the same .reel, .roster/.slot, .sec/.card and Lock in
  // controls the main modes use, with the stat cells left off exactly as Genius mode leaves them off. Century is
  // a draft, so it should not look like a different app - and reusing those classes means it inherits every
  // phone rule, touch target and dark-scope token they already carry rather than growing a second, worse copy.
  if (stage === "play" && run) {
    const board = CENTURY_BOARDS[team] || [];
    // A position's three states, the same three the draft screen has: 0 a named slot of its own is open, 1 those
    // are filled but the Flex can still take it, 2 nothing it fits is left. State 2 sinks to the bottom.
    const secState = (pos) => {
      if (CENTURY_SLOTS.some((s) => !roster[s] && s !== CENTURY_FLEX && centurySlotPos(s) === pos)) return 0;
      return !roster[CENTURY_FLEX] && pos !== "QB" ? 1 : 2;
    };
    const left = respinSpent ? 0 : 1;
    return (
      <div className="ce ce-play" data-view="play">
        <div className="modebar">
          <button className="mb on" aria-current="true">{run.variant === "daily" ? "Daily Century" : "Unlimited"}</button>
          <button className="mb" onClick={onBack}>All modes</button>
          <span className="seedline">
            <span className="modechip fmt">{CENTURY_SEASON}</span>
            {run.variant === "daily"
              ? <span className="nowrap">{run.day} - same teams for everyone</span>
              : <span className="codechip">Code <code>{run.seed}</code></span>}
          </span>
        </div>

        <div className="roster" aria-label="Your roster">
          {CENTURY_SLOTS.map((s) => {
            const p = roster[s];
            // The second door onto a pick, and it asks the SAME rule the Lock in button does. The draft screen's
            // equivalent tile enforced nothing at all for three releases (CLAUDE.md), which is why this is
            // centuryBlock and not a `disabled={!selected}`.
            const block = selected ? centuryBlock(selected, s, roster) : "nothing selected";
            const target = !!selected && !block;
            return (
              <button key={s} className={`slot pos-${s === CENTURY_FLEX ? "FLEX" : centurySlotPos(s)} ${p ? "filled" : ""} ${target ? "target" : ""}`}
                disabled={!target} onClick={() => target && take(selected, s)}
                aria-label={p ? `${CENTURY_SLOT_LABEL[s]}: ${p.name}`
                  : target ? `Lock ${selected.name} in at ${CENTURY_SLOT_LABEL[s]}`
                  : `${CENTURY_SLOT_LABEL[s]} open`}>
                <div className="k">{CENTURY_SLOT_LABEL[s]}</div>
                <div className="v">{p ? p.name : target ? "Lock in here" : <span style={{ color: "var(--muted)", fontWeight: 400 }}>Open</span>}</div>
                {p && <div className="sub">{TEAMS[p.team] ? TEAMS[p.team][0] : p.team}{s === CENTURY_FLEX ? `, ${p.pos}` : ""}</div>}
              </button>
            );
          })}
        </div>

        {/* The same reel the draft spins. aria-live, so the team that lands is announced rather than silently
            swapped - the whole screen changes under it. */}
        <div className={`reel ${spinning ? "spin" : ""}`} aria-live="polite" style={teamVars(shownTeam)}>
          <div className="stripe" style={{ background: TEAMS[shownTeam][2] }} />
          <div className="pickno">
            <span>Pick {Math.min(step + 1, CENTURY_SLOTS.length)} of {CENTURY_SLOTS.length}</span>
            <span>{spinning ? "Spinning" : `${board.length} players on the board`}</span>
          </div>
          <div className="team">{TEAMS[shownTeam][0]}</div>
          <div>
            <span className="years led-wrap"><span className="led">{CENTURY_SEASON}</span></span>
            <span className="city">{TEAMS[shownTeam][1]}</span>
          </div>
        </div>

        <div className="rerolls">
          <button className="btn" aria-label={`Re-spin team (${left} left)`} disabled={spinning || respinSpent} onClick={respin}>
            <span className="rs-long">Re-spin team <span className="left">({left} left)</span></span>
            <span className="rs-short" aria-hidden="true">↻ Team <b>{left}</b></span>
          </button>
          <span className="note" style={{ marginLeft: "auto", alignSelf: "center" }}>
            {run.variant === "daily" ? "One shot. No stats until the end." : "No stats until the end."}
          </span>
        </div>

        {error && <p className="note ce-err" role="status" style={{ marginTop: 0 }}>{error}</p>}

        {!spinning && (
          <h2 className="vh">{TEAMS[team][1]} {TEAMS[team][0]}, pick {step + 1} of {CENTURY_SLOTS.length}</h2>
        )}
        {!spinning && [...POS_ORDER].sort((a, b) => (secState(a) === 2 ? 1 : 0) - (secState(b) === 2 ? 1 : 0)).map((pos) => {
          const list = board.filter((p) => p.pos === pos);
          if (!list.length) return null;
          const st = secState(pos);
          const collapsed = st === 2 && !showDone[pos];
          return (
            <section className={`sec pos-${pos} ${st === 2 ? "done" : ""}`} key={pos}>
              <div className="hd">
                <h3>{POS_NAME[pos]}</h3>
                {st === 1 && <span className="nt">{pos} spots filled. These players can still go to Flex.</span>}
                {st === 2 && (
                  <button className="linkbtn" onClick={() => setShowDone({ ...showDone, [pos]: !showDone[pos] })}>
                    {collapsed ? `No room. Show ${list.length} player${list.length > 1 ? "s" : ""}` : "Hide"}
                  </button>
                )}
              </div>
              {!collapsed && list.map((p) => {
                const slotsFor = CENTURY_SLOTS.filter((s) => !centuryBlock(p, s, roster));
                const off = !slotsFor.length;
                const isSel = !!selected && selected.name === p.name;
                return (
                  <div key={p.id} className={`card ${isSel ? "sel" : ""} ${off ? "off" : ""}`}>
                    <button className="hit" disabled={off} onClick={() => setSelected(isSel ? null : p)} aria-expanded={isSel}>
                      <div className="row">
                        <div>
                          <div className="nm-row"><span className="pp">{p.pos}</span><span className="nm">{p.name}</span></div>
                          {/* Games played, and nothing else. Genius mode keeps this line too: it is what he
                              turned up for, not how well he did, and the touchdowns are the whole of the guess. */}
                          <div className="meta">
                            <span className="tdot" style={teamVars(p.team)} />
                            {CENTURY_SEASON} {TEAMS[p.team] ? TEAMS[p.team][0] : p.team}, {p.games} games{off ? ", no open slot" : ""}
                          </div>
                        </div>
                      </div>
                    </button>
                    {isSel && (
                      <div className="drafts">
                        {slotsFor.map((s) => (
                          <button key={s} className="btn solid" disabled={!!centuryBlock(p, s, roster)} onClick={() => take(p, s)}>
                            🔒 Lock in · {CENTURY_SLOT_LABEL[s]}
                          </button>
                        ))}
                        <button className="btn" onClick={() => setSelected(null)}>Cancel</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
        {!spinning && <button className="btn" onClick={onBack}>Leave</button>}
      </div>
    );
  }

  if (stage === "done" && result) {
    const short = Math.max(0, CENTURY_GOAL - result.score);
    // .result-hero, the same block a finished season lands on - which also buys the scroll-anchoring rule
    // html:has(.result-hero) already carries, so the number does not drag the view around as it ticks in.
    return (
      <div className="ce" data-view="done">
        <div className="result-hero ce-hero">
          <p className="ce-eyebrow">{result.replay ? "Today's Century" : result.hit ? "Century" : "Short"}</p>
          <p className="rec ce-score">{result.score}</p>
          <p className="outcome">of {result.goal || CENTURY_GOAL} touchdowns</p>
          <p className="rating">
            {result.hit ? "You got there." : `${short} short.`}
            {result.ceiling != null && ` Best possible from your seven teams: ${result.ceiling}.`}
          </p>
          {result.hit && <Confetti />}
        </div>
        {coins > 0 && <p className="note ce-coins" role="status">+{coins} coins</p>}
        {saving && <p className="note" role="status">Saving...</p>}
        {error && <p className="note ce-err" role="status">{error}</p>}
        <table className="ce-card">
          <caption>Your seven, with what they actually scored</caption>
          <thead>
            <tr><th scope="col">Slot</th><th scope="col">Player</th><th scope="col">Team</th><th scope="col">TD</th></tr>
          </thead>
          <tbody>
            {(result.roster || []).map((r) => (
              <tr key={r.slot} className={`pos-${r.slot === CENTURY_FLEX ? "FLEX" : centurySlotPos(r.slot)}`}>
                <th scope="row">{CENTURY_SLOT_LABEL[r.slot]}</th>
                <td>{r.name || "-"}</td>
                <td>{r.team ? (TEAMS[r.team] ? TEAMS[r.team][0] : r.team) : "-"}</td>
                <td className="ce-td">{r.td}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ce-row">
          {onShare && (
            <button className="btn" onClick={async () => {
              const how = await onShare(centuryShareText({
                score: result.score, hit: result.hit, ceiling: result.ceiling, goal: result.goal,
                variant: result.day ? "daily" : "unlimited", day: result.day, seed: result.seed, siteUrl,
              }));
              setShared(how);
            }}>Share</button>
          )}
          {shared && <span className="note ce-shared" role="status">{SHARE_SAID[shared] || ""}</span>}
          <button className="btn solid" onClick={() => start("unlimited")}>Run it back</button>
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
      {/* The same .mode tiles the Modes screen deals, so the two variants read as modes rather than as two
          buttons: the daily takes the featured lime block every daily in the game takes, and Unlimited the navy
          one its namesake has. */}
      <div className="modes">
        {/* Never a disabled button that says "Sign in to play". A control that tells you what to do and then
            refuses the tap reads as broken - the same note CLAUDE.md keeps about the Duel tile. It stays live
            and takes you to the Account tab instead. */}
        <button className="mode daily"
          onClick={() => (dailyDone ? showDailyResult()
            : !userId || isGuest ? onNeedsAccount && onNeedsAccount(isGuest ? "guest" : "signedout")
            : start("daily"))}>
          <div className="mt">
            <span className="icon" aria-hidden="true">📅</span>
            <span className="mn">Daily Century</span>
            {isGuest && <span className="pill">Account needed</span>}
            {dailyDone && <span className="pill">Done · {dailyDone.score}</span>}
          </div>
          <p>
            {isGuest ? "The daily needs an account - a guest can be made again and again, and the day's teams are one go for everyone."
              : !userId ? "The same seven teams for everyone today, one run, no resets. Sign in to play it."
              : dailyDone ? `You scored ${dailyDone.score} of ${CENTURY_GOAL}. ${dailyDone.ceiling ? `The best those seven teams could give was ${dailyDone.ceiling}.` : ""}`
              : "The same seven teams for everyone today. One run, no resets."}
          </p>
          <span className="go">
            {dailyDone ? "See how it went" : isGuest || !userId ? "Sign in to play" : "Let's go"}
          </span>
        </button>

        <button className="mode m-unlimited"
          onClick={() => (userId ? start("unlimited") : onNeedsAccount && onNeedsAccount("signedout"))}>
          <div className="mt">
            <span className="icon" aria-hidden="true">♾️</span>
            <span className="mn">Unlimited</span>
          </div>
          <p>Seven new teams every time, as often as you like. Your best run goes on the all-time board.</p>
          <span className="go">{userId ? "Let's go" : "Sign in to play"}</span>
        </button>
      </div>

      <h2 className="h">Boards</h2>
      <div className="ce-tabs" role="tablist" aria-label="Century boards">
        {[["day", "Today"], ["best", "All time"]].map(([id, label]) => (
          <button key={id} role="tab" id={`ce-tab-${id}`} aria-selected={tab === id} aria-controls={`ce-panel-${id}`}
            className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {/* BOTH panels exist, the inactive one hidden. Rendering only the open one left the other tab's
          aria-controls pointing at an id that was not in the document - a reference a screen reader follows
          and finds nothing at. tests/test-a11y.mjs now refuses a dangling ARIA reference on any screen. */}
      {[["day", board.day], ["best", board.best]].map(([id, rows]) => (
        <div key={id} className="ce-panel" id={`ce-panel-${id}`} role="tabpanel"
          aria-labelledby={`ce-tab-${id}`} hidden={tab !== id}>
          <CenturyBoard rows={rows} loaded={board.loaded} username={username} allTime={id === "best"} />
        </div>
      ))}
      <button className="btn" onClick={onBack}>Back</button>
    </div>
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

/* The play screen borrows the draft's own .reel, .roster/.slot, .sec/.card and .drafts, so there is almost
   nothing to style here. What is left is the two places seven slots do not fit a layout built for six. */

/* Seven slots, not six. This overrides only the column count, and only inside Century - the shared .roster is
   otherwise untouched, which is the rule for reusing an app class (CLAUDE.md, Design system). */
.ce-play .roster { grid-template-columns: repeat(7, minmax(0, 1fr)); }
/* Long surnames in a narrow tile break mid-word without this; the draft never hits it because six slots are
   wider than seven. Break at spaces only, and let a single long name sit slightly proud rather than split. */
.ce-play .slot .v { overflow-wrap: normal; word-break: normal; hyphens: none; }

/* .result-hero paints the block; these are the three lines inside it. .rec is the draft's giant record type,
   reused for the score, so a finished Century reads at the same size a finished season does. */
.ce-hero { text-align: center; }
/* Every line here is a <p>, and .rec is ~96px type - so the browser's default 1em margin is a 96px gap above
   AND below the number. Each one is set explicitly instead; without this the hero was 400px of empty space. */
.ce-eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; opacity: .8; margin: 0; }
.ce-hero .ce-score { font-variant-numeric: tabular-nums; margin: 2px 0 0; }
.ce-hero .outcome { font-size: 15px; font-weight: 600; opacity: .9; margin: 6px 0 0; }
.ce-hero .rating { margin: 6px 0 0; }
.ce-coins { color: var(--accent-ink); }
/* A refusal has to read as one. This was lost for a moment when the play screen's own styles were deleted in
   favour of the draft's, which left every error rendering as an ordinary grey note. */
.ce-err { color: var(--loss); }

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
  /* Seven slots do not fit a phone in one row - four then three, which keeps every one visible without a
     horizontal scroll. Base rules are above this block, never below it (CLAUDE.md). */
  .ce-play .roster { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
/* No pointer:coarse or reduced-motion block of its own any more - every control on these screens is one of
   the app's (.mode, .btn, .slot, .card, .linkbtn, .tab), and those already carry their touch targets and their
   motion rules. A copy here would be a second, quietly diverging set. */
`;
