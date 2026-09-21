// 1v1: the lobby, the draft both players watch, and the result. Contract: VERSUS.md 9. Classes are prefixed vs-.
//
// This screen renders what the server says and decides nothing (VERSUS.md 2). Every move goes to the match-pick
// Edge Function and comes back as a changed match; `replayMatch` turns the match's rows into the boards, the two
// rosters, what is gone and whose turn it is, so what this draws is the same state the server holds. A refusal
// is shown, never argued with - a button the rules would refuse is disabled before it can be pressed, and the
// server refuses it again anyway.
//
// Props:
//   userId, username   the signed-in player
//   code               a match code from the address (/vs/ABC123), or null to open the lobby screen
//   format             the scoring format the host opens a lobby in
//   onBack()           leave 1v1
//   onCode(code)       the match this screen is now showing, so the app can keep the address in step
// **It draws the single-player draft's own markup**, not a version of it: the same .reel, .sticky, .sec and
// .card classes, the same two-step pick ending in "Lock in", and the same dark scoreboard scope (the root takes
// .dark for this view, set in perfect-season.jsx beside the play screen's). That is deliberate - 1v1 is a draft,
// it should read as one, and anything that changes about the draft's look should change here for free rather
// than be copied across. What this file adds is only what 1v1 has and single player doesn't: two rosters, a
// clock, the powerups and the lobby.
//
// And never a grade on the board. The single-player draft shows stats and lets a player judge them; a grade
// would hand the pick over.
//
// Test hooks: the root is <section class="versus" data-view="lobby|draft|done" data-code=...>; every option on
// the board is a <div class="card" data-opt="player|<id>|<season>" | "dst|TEAM|<season>" | "k|TEAM|<season>">
// whose .hit selects it and whose .drafts holds the Lock in buttons; the powerups are buttons named "Re-spin
// team", "Re-spin era", "Double dip", "Steal" and "Steal the pick"; each roster is a .vs-rosters .roster with
// a .slot per slot, carrying data-slot and data-filled.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMatch, joinMatch, fetchMatch, playMove, subscribeMatch, versusPath } from "./storage.js";
import {
  replayMatch, optionsOn, optionId, optionFits, openSlots, matchResult,
  VERSUS_SLOTS, MATCH_BOARDS, respinsLeft, dipsLeft, stealsLeft, pickStealsLeft,
} from "./versus-logic.mjs";
import { TEAMS, WINDOWS } from "./game-logic.mjs";
import { SLOT_LABEL, teamVars, teamLabel, shortYr, POS_NAME, cityRange, statCells } from "./ui-common.jsx";

// The two slots 1v1 adds, beside the six every other mode already labels. A chip says which slot a pick filled
// in letters, never by colour alone - the accessibility floor tests/test-a11y.mjs keeps.
const VS_SLOT_LABEL = { ...SLOT_LABEL, DST: "DEF", K: "K" };

export const VERSUS_CSS = `
/* ===== 1v1 =====
   The draft screen deliberately owns very little: it draws the app's own .reel, .sticky, .sec, .card and
   .roster, so it inherits the single-player draft's whole look and moves with it. What is here is only what
   1v1 adds - two rosters side by side, the clock, and the lobby. */
.versus{display:grid;gap:18px}
.vs-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}
.vs-vs{display:flex;gap:10px;align-items:center;font-weight:800}
.vs-vs .vs-who{display:flex;flex-direction:column;line-height:1.1}
.vs-vs .vs-nm{font-size:16px}
.vs-vs .vs-tag{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.75}
.vs-vs .vs-x{font-family:var(--display);font-size:20px;opacity:.6}
.vs-clockbox{display:flex;gap:10px;align-items:baseline}
.vs-turn{font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:13px;margin:0}
.vs-turn.mine{color:var(--accent-ink)}
.vs-clock{font-variant-numeric:tabular-nums;font-weight:800;font-size:26px;font-family:var(--display);margin:0}
.vs-clock.low,.vs-tick.low{color:var(--loss)}
.vs-tick{font-variant-numeric:tabular-nums}
.vs-link{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vs-link code{font-size:15px;padding:8px 10px;border:2px solid var(--line);border-radius:10px;background:var(--surface);word-break:break-all}
.vs-wait{display:flex;gap:10px;align-items:center;font-weight:700}
.vs-dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none}
.vs-powers{margin-top:18px}
.vs-rosters{display:grid;gap:16px;grid-template-columns:1fr 1fr;margin-top:22px}
.vs-side-hd{font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;margin:0 0 8px;opacity:.85}
.vs-side-hd .vs-sub{font-family:var(--display);font-size:16px;letter-spacing:0;margin-left:6px}
/* The two rosters stack their slots rather than sitting in one wide row, so both fit side by side. */
.vs-rosters .roster{grid-template-columns:1fr 1fr;gap:6px}
.vs-final{display:grid;gap:6px;justify-items:center;text-align:center;padding:18px 0}
.vs-score{font-family:var(--display);font-size:56px;line-height:1;font-variant-numeric:tabular-nums}
.vs-lines{display:grid;gap:3px;font-size:13px;margin-top:8px;max-width:420px}
.vs-lines .vs-ln{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed var(--line);padding:4px 0}
.vs-note{font-size:13px;opacity:.85}
.vs-err{color:var(--loss);font-weight:700;font-size:13px}
@media (max-width:640px){
  .vs-rosters{grid-template-columns:1fr}
  .vs-score{font-size:42px}
  .vs-clock{font-size:22px}
}
`;


// Seconds left on the clock, never below zero. The deadline is the server's; this only counts it down.
function useCountdown(deadline) {
  const [left, setLeft] = useState(() => secondsTo(deadline));
  useEffect(() => {
    setLeft(secondsTo(deadline));
    if (!deadline) return undefined;
    const t = setInterval(() => setLeft(secondsTo(deadline)), 500);
    return () => clearInterval(t);
  }, [deadline]);
  return left;
}
const secondsTo = (deadline) => {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000));
};

// A defense's and a kicker's stat cells, in the same shape statCells gives a player: the numbers that justify
// the rating, never the rating. Showing a grade on the board would hand the pick over - the single-player draft
// shows stats and nothing else for exactly that reason.
const unitCells = (o) => (o.kind === "dst"
  ? [[o.pa, "Pts/game"], [o.ints, "INT"], [o.fum, "Fum rec"], [o.sacks, "Sacks"], [o.tds, "Def TD"]]
  : [[`${o.made}/${o.att}`, "FG"], [o.att ? `${Math.round((100 * o.made) / o.att)}%` : "–", "FG %"],
     [o.long, "Long"], [o.from50, "From 50+"], [o.xp, "XP"]]);
const cellsFor = (o) => (o.kind === "player" ? statCells(o) : unitCells(o));

// What a card calls an option. A defense is a team-season, a kicker and a player are people.
const optionName = (o) => (o.kind === "dst" ? `${TEAMS[o.team][0]} defense` : o.name);
const optionTag = (o) => (o.kind === "dst" ? "DEF" : o.kind === "k" ? "K" : o.pos);
const optionMeta = (o) => (o.kind === "player"
  ? `${o.season} ${teamLabel(o.team, o.season)}, ${o.g} games`
  : `${o.season} ${teamLabel(o.team, o.season)}`);

// The groups the board is laid out in: the four positions the single-player draft uses, then the two 1v1 adds.
const GROUPS = [
  ["QB", POS_NAME.QB, (o) => o.kind === "player" && o.pos === "QB"],
  ["RB", POS_NAME.RB, (o) => o.kind === "player" && o.pos === "RB"],
  ["WR", POS_NAME.WR, (o) => o.kind === "player" && o.pos === "WR"],
  ["TE", POS_NAME.TE, (o) => o.kind === "player" && o.pos === "TE"],
  ["DST", "Defenses", (o) => o.kind === "dst"],
  ["K", "Kickers", (o) => o.kind === "k"],
];

// Your roster, as the draft screen shows one: a strip of slots with who is in them.
function RosterStrip({ roster, label, sub }) {
  return (
    <div className="vs-side">
      <p className="vs-side-hd">{label}{sub ? <span className="vs-sub"> {sub}</span> : null}</p>
      <div className="roster" data-side={label}>
        {VERSUS_SLOTS.map((slot) => {
          const o = roster[slot];
          return (
            <div key={slot} className={`slot ${o ? "on" : ""}`} data-slot={slot} data-filled={o ? "1" : "0"}>
              <div className="k">{VS_SLOT_LABEL[slot]}</div>
              <div className="v">{o ? optionName(o) : <span style={{ color: "var(--muted)", fontWeight: 400 }}>Open</span>}</div>
              {o && <div className="sub">{shortYr(o.season)} {TEAMS[o.team][0]}{slot.startsWith("FLEX") ? `, ${o.pos}` : ""}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The board, drawn the way the single-player draft draws one - the same reel, the same cards, the same
// "Lock in" (VERSUS.md 9). The classes are the app's own, so this inherits the whole look rather than
// approximating it, and anything that changes there changes here.
function Board({ boardKey, taken, roster, myTurn, onPick, selected, setSelected, busy }) {
  const [team, w] = boardKey.split("|");
  const options = optionsOn(boardKey);
  const open = openSlots(roster);
  const left = options.filter((o) => !taken.has(optionId(o))).length;
  return (
    <>
      <div className="reel" aria-live="polite" style={teamVars(team)}>
        <div className="stripe" style={{ background: TEAMS[team][2] }} />
        <div className="pickno"><span>{myTurn ? "Your pick" : "Their pick"}</span><span>{left} left on the board</span></div>
        <div className="team">{TEAMS[team][0]}</div>
        <div>
          <span className="years led-wrap"><span className="led">{WINDOWS[Number(w)][0]}–{WINDOWS[Number(w)][1]}</span></span>
          {cityRange(team, Number(w)) && <span className="city">{cityRange(team, Number(w))}</span>}
        </div>
      </div>

      {GROUPS.map(([key, heading, belongs]) => {
        const list = options.filter(belongs);
        if (!list.length) return null;
        const anyOpen = open.some((sl) => list.some((o) => optionFits(o, sl)));
        return (
          <section className={`sec pos-${key === "DST" || key === "K" ? "FLEX" : key} ${anyOpen ? "" : "done"}`} key={key}>
            <div className="hd">
              <h3>{heading}</h3>
              {!anyOpen && <span className="nt">No open slot for these.</span>}
            </div>
            {list.map((o) => {
              const id = optionId(o);
              const gone = taken.has(id);
              const slotsFor = open.filter((sl) => optionFits(o, sl));
              const off = gone || !slotsFor.length || !myTurn;
              const isSel = selected === id;
              return (
                <div key={id} className={`card ${isSel ? "sel" : ""} ${off ? "off" : ""}`} data-opt={id}>
                  <button className="hit" disabled={off || busy} onClick={() => setSelected(isSel ? null : id)} aria-expanded={isSel}>
                    <div className="row">
                      <div>
                        <div className="nm-row"><span className="pp">{optionTag(o)}</span><span className="nm">{optionName(o)}</span></div>
                        <div className="meta">
                          <span className="tdot" style={teamVars(o.kind === "player" ? o.team : team)} />
                          {optionMeta(o)}{gone ? ", taken" : !slotsFor.length ? ", no open slot" : ""}
                        </div>
                      </div>
                      <div className="cells">
                        {cellsFor(o).map(([n, l]) => (<div className="cell" key={l}><div className="n">{n}</div><div className="l">{l}</div></div>))}
                      </div>
                    </div>
                  </button>
                  {isSel && (
                    <div className="drafts">
                      {/* Both Flex slots are the same choice, so one Flex button rather than two identical ones. */}
                      {slotsFor.filter((sl) => !sl.startsWith("FLEX") || sl === slotsFor.find((x) => x.startsWith("FLEX"))).map((sl) => (
                        <button key={sl} className="btn solid" disabled={busy} onClick={() => onPick(o, sl)}>
                          🔒 Lock in · {VS_SLOT_LABEL[sl]}
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
    </>
  );
}

export function VersusScreen({ userId, username, code: codeFromAddress, format = "fantasy", onBack, onCode, onShare, siteUrl }) {
  const [match, setMatch] = useState(null);
  const [code, setCode] = useState(codeFromAddress || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  // The option a player has tapped but not locked in, exactly as the single-player draft holds one.
  const [selected, setSelected] = useState(null);
  const joined = useRef(false);

  const refresh = useCallback(async (c) => {
    const m = await fetchMatch(c);
    if (m) setMatch(m);
    return m;
  }, []);

  // A code in the address is an invite - but only for somebody who isn't in that match yet. Read it first: a
  // player already on either side is reopening their own draft (a reload, a shared link they sent themselves,
  // Back into it), and join_match would tell them it's their own match rather than showing it to them.
  useEffect(() => {
    if (!codeFromAddress || joined.current || !userId) return;
    joined.current = true;
    (async () => {
      const mine = await fetchMatch(codeFromAddress);
      if (mine && (mine.hostId === userId || mine.guestId === userId)) {
        setMatch(mine);
        setCode(mine.code);
        onCode?.(mine.code);
        return;
      }
      const res = await joinMatch(codeFromAddress);
      if (!res.ok) { setError(res.reason); return; }
      setMatch(res.match);
      setCode(res.match.code);
      onCode?.(res.match.code);
    })();
  }, [codeFromAddress, userId, onCode]);

  // Both screens watch the match rather than polling it (VERSUS.md 2). A change means "read again", never a
  // delta applied by hand - the match is one shape, and match_state is where it comes from.
  useEffect(() => {
    if (!match?.id) return undefined;
    const sub = subscribeMatch(match.id, () => refresh(match.code));
    return () => sub.unsubscribe();
  }, [match?.id, match?.code, refresh]);


  const open = async () => {
    setBusy(true);
    setError(null);
    const res = await createMatch(format);
    setBusy(false);
    if (!res.ok) { setError(res.reason); return; }
    setMatch(res.match);
    setCode(res.match.code);
    onCode?.(res.match.code);
  };

  const state = useMemo(() => (match && match.status !== "open" ? replayMatch({
    code: match.code, picks: match.picks, respins: match.respins, dips: match.dips, swaps: match.swaps,
  }) : null), [match]);

  const side = match ? (match.hostId === userId ? "host" : match.guestId === userId ? "guest" : null) : null;
  const myTurn = !!state && !state.done && state.turn.side === side;
  const left = useCountdown(match?.status === "drafting" && !state?.done ? match.turnDeadline : null);
  // ...and a slow read behind it, because a draft that only moves when a socket delivers is a draft that
  // stops. Realtime can be off in a project, blocked by a network, or simply drop, and the first time anyone
  // notices is a player sitting on a finished turn waiting out a clock they cannot affect. Every two seconds
  // while it is not your move, and never while it is: your own moves refresh the screen themselves.
  useEffect(() => {
    if (!match?.code || match.status === "done" || myTurn) return undefined;
    const t = setInterval(() => refresh(match.code), 2000);
    return () => clearInterval(t);
  }, [match?.code, match?.status, myTurn, refresh]);

  // When the clock runs out somebody has to say so, and it may be either of them - that is what keeps a match
  // alive when the other player has closed the tab. Asked once, a beat after zero, so the two screens don't
  // race each other for it.
  useEffect(() => {
    if (left !== 0 || !match || match.status !== "drafting" || !side) return undefined;
    const t = setTimeout(() => { playMove({ code: match.code, claim: "clock" }).then(() => refresh(match.code)); }, myTurn ? 300 : 1500);
    return () => clearTimeout(t);
  }, [left, match, side, myTurn, refresh]);

  const send = async (move) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await playMove({ code: match.code, ...move });
    setBusy(false);
    if (!res.ok) setError(res.reason);
    await refresh(match.code);
  };

  if (!userId) {
    return (
      <section className="versus" data-view="signedout">
        <h2 className="h">1v1</h2>
        <p className="note">Sign in to play someone. A 1v1 result goes on its own board, so it needs an account on both sides.</p>
        <button className="btn" onClick={onBack}>Back</button>
      </section>
    );
  }

  if (!match) {
    return (
      <section className="versus" data-view="lobby">
        <h2 className="h">1v1</h2>
        <p className="note">
          Open a lobby and send the link. You and whoever takes it draft from the same eight boards — six players,
          a defense and a kicker each — and the better roster wins. No dice.
        </p>
        {error ? <p className="vs-err">{errorText(error)}</p> : null}
        <div className="vs-powers">
          <button className="btn primary" onClick={open} disabled={busy}>Open a lobby</button>
          <button className="btn" onClick={onBack}>Back</button>
        </div>
      </section>
    );
  }

  const link = typeof location !== "undefined" ? `${location.origin}${versusPath(match.code)}` : versusPath(match.code);
  const hostName = match.hostName || "Host";
  const guestName = match.guestName || "…";

  if (match.status === "open") {
    return (
      <section className="versus" data-view="lobby" data-code={match.code}>
        <h2 className="h">Your lobby</h2>
        <div className="vs-link">
          <code>{link}</code>
          <button className="btn sm" onClick={() => { copy(link); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
        <p className="vs-wait"><span className="vs-dot" /> Waiting for an opponent…</p>
        <p className="vs-note">The first person to open the link is your opponent. Keep this page open.</p>
        <button className="btn" onClick={onBack}>Back</button>
      </section>
    );
  }

  const result = match.result || (state?.done ? matchResult({ code: match.code, format: match.format, host: state.roster.host, guest: state.roster.guest }) : null);

  if (match.status === "done" && result) {
    const mine = side || "host";
    const theirs = mine === "host" ? "guest" : "host";
    const won = result.winner === mine;
    return (
      <section className="versus" data-view="done" data-code={match.code}>
        <h2 className="h">{result.winner === null ? "A tie" : won ? "You win" : "You lose"}</h2>
        <div className="vs-final">
          <div className="vs-score">{result[mine].points}–{result[theirs].points}</div>
          <p className="vs-note">
            {name(match, mine)} {result[mine].score} · {name(match, theirs)} {result[theirs].score}
          </p>
        </div>
        <div className="vs-lines">
          <div className="vs-ln"><span>Your offense</span><b>{result[mine].offense}</b></div>
          <div className="vs-ln"><span>Your kicker</span><b>{signed(result[mine].kicker)}</b></div>
          <div className="vs-ln"><span>Their defense</span><b>{signed(-result[mine].against)}</b></div>
        </div>
        <div className="vs-rosters">
          <RosterStrip roster={state.roster[mine]} label={name(match, mine)} sub={`${result[mine].score}`} />
          <RosterStrip roster={state.roster[theirs]} label={name(match, theirs)} sub={`${result[theirs].score}`} />
        </div>
        <div className="vs-powers">
          <button className="btn" onClick={() => onShare?.(versusShareText(match, result, mine, siteUrl))}>Share</button>
          <button className="btn" onClick={onBack}>Back</button>
        </div>
      </section>
    );
  }

  const boardTeam = state?.boardKey ? state.boardKey.split("|")[0] : "ARI";
  const powers = state ? {
    respin: respinsLeft(match.respins, side),
    dip: dipsLeft(match.dips, side),
    steal: stealsLeft(match.picks.map((p) => ({ stolenBy: p.stolenBy })), side),
    stealPick: pickStealsLeft(match.swaps, side),
  } : null;

  return (
    <section className="versus vs-draft" data-view="draft" data-code={match.code}>
      {/* The bar the single-player draft floats once you scroll past the reel, carrying what a 1v1 needs
          instead: who is on the clock, the seconds left, and both rosters as chips. */}
      <div className="sticky show" style={teamVars(boardTeam)}>
        <div className="in">
          <div className="stripe" style={{ background: TEAMS[boardTeam][2] }} />
          <span className="tm">{myTurn ? "Your pick" : `${name(match, state.turn.side)} is picking`}</span>
          {left != null ? <span className={`yr vs-tick ${left <= 10 ? "low" : ""}`}>{left}s</span> : null}
          <span className="pk">Board {Math.min(state.boardIdx + 1, MATCH_BOARDS)} of {MATCH_BOARDS}</span>
          <span className="brk" />
          <div className="chips">
            {VERSUS_SLOTS.map((sl) => (
              <span key={sl} className={`chip pos-${sl.startsWith("FLEX") ? "FLEX" : sl} ${state.roster[side || "host"][sl] ? "on" : ""}`}
                title={state.roster[side || "host"][sl] ? optionName(state.roster[side || "host"][sl]) : `${VS_SLOT_LABEL[sl]} open`}>
                {sl.startsWith("FLEX") ? "FX" : VS_SLOT_LABEL[sl]}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="vs-head">
        <div className="vs-vs">
          <span className="vs-who"><span className="vs-nm">{hostName}</span><span className="vs-tag">{side === "host" ? "You" : "Host"}</span></span>
          <span className="vs-x">vs</span>
          <span className="vs-who"><span className="vs-nm">{guestName}</span><span className="vs-tag">{side === "guest" ? "You" : "Opponent"}</span></span>
        </div>
        <div className="vs-clockbox">
          <p className={`vs-turn ${myTurn ? "mine" : ""}`}>{myTurn ? "Your pick" : `${name(match, state.turn.side)} is picking`}</p>
          {left != null ? <p className={`vs-clock ${left <= 10 ? "low" : ""}`} aria-label={`${left} seconds left`}>{left}s</p> : null}
        </div>
      </div>

      {error ? <p className="vs-err">{errorText(error)}</p> : null}

      {state.boardKey ? (
        <Board
          boardKey={state.boardKey} taken={state.taken} roster={state.roster[side || "host"]}
          myTurn={myTurn} busy={busy} selected={selected} setSelected={setSelected}
          onPick={(o, slot) => { setSelected(null); send({
            boardIdx: state.boardIdx, kind: o.kind, slot,
            playerId: o.kind === "player" ? o.id : undefined,
            team: o.kind === "player" ? undefined : o.team, season: o.season,
          }); }}
        />
      ) : null}

      {/* The powerups sit where the re-spins sit in the single-player draft, under the board, and are only
          offered on your own turn - the rules refuse them otherwise anyway. */}
      {myTurn && powers ? (
        <div className="rerolls vs-powers">
          <button className="btn" disabled={busy || powers.respin.team < 1} onClick={() => send({ respin: "team" })}>
            <span className="rs-long">Re-spin team <span className="left">({powers.respin.team} left)</span></span>
            <span className="rs-short" aria-hidden="true">↻ Team <b>{powers.respin.team}</b></span>
          </button>
          <button className="btn" disabled={busy || powers.respin.era < 1} onClick={() => send({ respin: "era" })}>
            <span className="rs-long">Re-spin era <span className="left">({powers.respin.era} left)</span></span>
            <span className="rs-short" aria-hidden="true">↻ Era <b>{powers.respin.era}</b></span>
          </button>
          <button className="btn" disabled={busy || powers.dip < 1 || state.boardIdx >= MATCH_BOARDS - 1}
            title="Take two off this board, and give up your pick on the next one" onClick={() => send({ dip: true })}>
            Double dip <span className="left">({powers.dip})</span>
          </button>
          <button className="btn" disabled={busy || powers.steal < 1 || state.turn.first}
            title="Take the pick they just made" onClick={() => send({ steal: true })}>
            Steal <span className="left">({powers.steal})</span>
          </button>
          <button className="btn" disabled={busy || powers.stealPick < 1 || state.turn.first}
            title="Pick first on this board instead" onClick={() => send({ stealPick: true })}>
            Steal the pick <span className="left">({powers.stealPick})</span>
          </button>
        </div>
      ) : null}

      <div className="vs-rosters">
        <RosterStrip roster={state.roster[side || "host"]} label="Your roster" />
        <RosterStrip roster={state.roster[side === "host" ? "guest" : "host"]} label={`${name(match, side === "host" ? "guest" : "host")}'s roster`} />
      </div>
    </section>
  );
}

// The share card for a match (VERSUS.md 10). Like the season card it names no players - a match that is still
// being drafted must not be spoiled by the loser posting the board - and like it the link goes last, where a
// chat app turns it into a preview. The link is an invitation, not a replay: /vs/<code> is that match, which is
// over, so it points at the game rather than at the draft.
export function versusShareText(match, result, side, siteUrl) {
  if (!result) return "";
  const mine = side === "guest" ? "guest" : "host";
  const theirs = mine === "host" ? "guest" : "host";
  const them = name(match, theirs);
  const head = result.winner === null ? "Tied" : result.winner === mine ? `Beat ${them}` : `Lost to ${them}`;
  const lines = [
    `Gridspin 1v1 ${result.winner === null ? "🤝" : result.winner === mine ? "🏆" : "💀"} ${head} ${result[mine].points}–${result[theirs].points}`,
    `${result[mine].score} to ${result[theirs].score} on the boards`,
  ];
  // The two things a 1v1 has that a season doesn't, and the only two worth a line.
  if (result[mine].kicker) lines.push(`My kicker ${signed(result[mine].kicker)}`);
  if (result[mine].against) lines.push(`Their defense ${signed(-result[mine].against)}`);
  if (siteUrl) lines.push(`Play me: ${siteUrl}`);
  return lines.join("\n");
}

const name = (match, side) => (side === "host" ? match.hostName || "Host" : side === "guest" ? match.guestName || "Opponent" : "");
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
function copy(text) {
  try { navigator.clipboard?.writeText(text); } catch (e) { /* a browser that won't; the link is on screen */ }
}

// A refusal in words. Every one of these is a reason from VERSUS.md 4 and 7 - the screen never invents one.
const ERRORS = {
  guest_not_allowed: "A 1v1 needs an account on both sides — a guest can't play one.",
  not_found: "That match doesn't exist.",
  already_full: "That match already has two players.",
  own_match: "That's your own link.",
  already_started: "That match has already started.",
  not_your_turn: "It's not your turn.",
  wrong_board: "That board has moved on.",
  not_on_board: "That isn't on this board.",
  already_taken: "Somebody already took that one.",
  bad_slot: "That doesn't fit a slot you have open.",
  no_respins_left: "No re-spins left.",
  no_dips_left: "You've used your double dip.",
  no_steals_left: "You've used your steal.",
  no_candidate: "There's no other board to spin to.",
  no_room: "You can't double here — you need two open slots and two picks on the board to fill them.",
  last_board: "There's no next pick to give up.",
  would_strand: "That would leave the other player with nothing to pick.",
  nothing_to_steal: "There's nothing to steal yet.",
  already_leading: "You already pick first on this board.",
  conflict: "That pick just went — try again.",
  signed_out: "Sign in to play.",
  network: "Couldn't reach the server. Try again.",
};
const errorText = (reason) => ERRORS[reason] || "That didn't work.";
