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
// Test hooks: the root is <section class="versus" data-view="lobby|draft|done" data-code=...>; the draft's
// board is <div class="vs-board" data-board=...> with each option a <button class="vs-opt" data-opt=...
// data-slot=...>; the powerups are buttons named "Re-spin team", "Re-spin era", "Double dip", "Steal" and
// "Steal the pick"; each roster is <ol class="vs-roster" data-side="host|guest"> with an <li data-slot=...>.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMatch, joinMatch, fetchMatch, playMove, subscribeMatch, versusPath } from "./storage.js";
import {
  replayMatch, optionsOn, optionId, optionFits, openSlots, matchResult,
  VERSUS_SLOTS, MATCH_BOARDS, respinsLeft, dipsLeft, stealsLeft, pickStealsLeft,
} from "./versus-logic.mjs";
import { TEAMS, WINDOWS } from "./game-logic.mjs";
import { SLOT_LABEL, teamVars, teamLabel, grade, gradeTier } from "./ui-common.jsx";

// The two slots 1v1 adds, beside the six every other mode already labels. A chip says which slot a pick filled
// in letters, never by colour alone - the accessibility floor tests/test-a11y.mjs keeps.
const VS_SLOT_LABEL = { ...SLOT_LABEL, DST: "DEF", K: "K" };

export const VERSUS_CSS = `
/* ===== 1v1 ===== */
.versus{display:grid;gap:18px}
.vs-head{display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between}
.vs-vs{display:flex;gap:10px;align-items:center;font-weight:800}
.vs-vs .vs-who{display:flex;flex-direction:column;line-height:1.1}
.vs-vs .vs-nm{font-size:16px}
.vs-vs .vs-tag{font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.vs-vs .vs-x{font-family:var(--display);font-size:20px;opacity:.5}
.vs-turn{font-weight:800;text-transform:uppercase;letter-spacing:.06em;font-size:13px}
.vs-turn.mine{color:var(--accent-ink)}
.vs-clock{font-variant-numeric:tabular-nums;font-weight:800;font-size:22px;font-family:var(--display)}
.vs-clock.low{color:var(--bad)}
.vs-link{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vs-link code{font-size:15px;padding:8px 10px;border:2px solid var(--line);border-radius:10px;background:var(--card);word-break:break-all}
.vs-wait{display:flex;gap:10px;align-items:center;font-weight:700}
.vs-dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none}
.vs-dot.on{background:var(--accent)}
.vs-powers{display:flex;flex-wrap:wrap;gap:8px}
.vs-powers .btn{font-size:13px;padding:8px 10px}
.vs-boardhd{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;border-top:3px solid var(--ink);padding-top:10px}
.vs-boardhd h3{font-family:var(--display);font-size:24px;margin:0}
.vs-boardhd .vs-era{font-weight:700;opacity:.7}
.vs-group{margin-top:14px}
.vs-group h4{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 8px;opacity:.75}
.vs-opts{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.vs-opt{display:block;width:100%;text-align:left;border:2px solid var(--line);border-radius:12px;background:var(--card);padding:10px 12px;cursor:pointer}
.vs-opt:disabled{opacity:.45;cursor:default}
.vs-opt .vs-on{display:flex;gap:8px;align-items:center;font-weight:800}
.vs-opt .vs-om{font-size:12px;opacity:.75;margin-top:2px}
.vs-opt .vs-grade{margin-left:auto;font-family:var(--display);font-size:16px}
.vs-opt[data-taken="1"]{text-decoration:line-through}
.vs-rosters{display:grid;gap:14px;grid-template-columns:1fr 1fr}
.vs-roster{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.vs-roster li{display:flex;gap:8px;align-items:baseline;border-bottom:1px solid var(--line);padding:5px 0;font-size:14px}
.vs-roster .vs-sl{font-size:11px;font-weight:800;letter-spacing:.06em;min-width:34px;opacity:.7}
.vs-roster .vs-empty{opacity:.45}
.vs-side-hd{font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;margin:0 0 6px}
.vs-final{display:grid;gap:6px;justify-items:center;text-align:center;padding:18px 0}
.vs-score{font-family:var(--display);font-size:52px;line-height:1;font-variant-numeric:tabular-nums}
.vs-lines{display:grid;gap:3px;font-size:13px;margin-top:8px}
.vs-lines .vs-ln{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed var(--line);padding:3px 0}
.vs-note{font-size:13px;opacity:.8}
.vs-err{color:var(--bad);font-weight:700;font-size:13px}
@media (max-width:560px){
  .vs-rosters{grid-template-columns:1fr}
  .vs-opts{grid-template-columns:1fr}
  .vs-score{font-size:40px}
}
@media (prefers-reduced-motion:reduce){.vs-dot{transition:none}}
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

const statLine = (o) => {
  if (o.kind === "dst") return `${o.pa} allowed a game · ${o.ints} int · ${o.sacks} sacks · ${o.fum} fum`;
  if (o.kind === "k") return `${o.made}/${o.att} · long ${o.long} · ${o.from50} from 50+`;
  return `${o.season} ${teamLabel(o.team, o.season)} · ${o.g} games`;
};
const optionName = (o) => (o.kind === "dst" ? `${o.season} ${TEAMS[o.team][0]} defense` : o.kind === "k" ? o.name : o.name);

export function RosterList({ roster, side, label, format }) {
  return (
    <div>
      <p className="vs-side-hd">{label}</p>
      <ol className="vs-roster" data-side={side}>
        {VERSUS_SLOTS.map((slot) => {
          const o = roster[slot];
          return (
            <li key={slot} data-slot={slot} data-filled={o ? "1" : "0"}>
              <b className="vs-sl">{VS_SLOT_LABEL[slot]}</b>
              {o ? (
                <>
                  <span>{optionName(o)}</span>
                  <span className="vs-grade" style={{ marginLeft: "auto" }}>{grade(o.rating)}</span>
                </>
              ) : <span className="vs-empty">—</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// The board both players are looking at. A pick that can't be made is never offered: an option already taken, or
// one that fits no slot this player still has open, is disabled rather than hidden - seeing what went is half of
// knowing what the other player is doing.
function Board({ boardKey, taken, roster, myTurn, format, onPick }) {
  const [team, w] = boardKey.split("|");
  const options = optionsOn(boardKey);
  const open = openSlots(roster);
  const groups = [
    ["Players", options.filter((o) => o.kind === "player")],
    ["Defense", options.filter((o) => o.kind === "dst")],
    ["Kicker", options.filter((o) => o.kind === "k")],
  ];
  return (
    <div className="vs-board" data-board={boardKey}>
      <div className="vs-boardhd" style={teamVars(team)}>
        <h3>{TEAMS[team][1]} {TEAMS[team][0]}</h3>
        <span className="vs-era">{WINDOWS[Number(w)][0]}–{WINDOWS[Number(w)][1]}</span>
      </div>
      {groups.map(([label, list]) => (list.length === 0 ? null : (
        <section className="vs-group" key={label}>
          <h4>{label}</h4>
          <div className="vs-opts">
            {list.map((o) => {
              const id = optionId(o);
              const gone = taken.has(id);
              const slot = open.find((s) => optionFits(o, s));
              const can = myTurn && !gone && !!slot;
              return (
                <button
                  key={id} type="button" className="vs-opt" data-opt={id} data-slot={slot || ""}
                  data-taken={gone ? "1" : "0"} disabled={!can}
                  onClick={() => onPick(o, slot)}
                >
                  <span className="vs-on">
                    <span className="tdot" style={teamVars(o.kind === "player" ? o.team : team)} />
                    {optionName(o)}
                    <span className={`vs-grade ${gradeTier(o.rating)}`}>{grade(o.rating)}</span>
                  </span>
                  <span className="vs-om">{gone ? "Taken" : statLine(o)}</span>
                </button>
              );
            })}
          </div>
        </section>
      )))}
    </div>
  );
}

export function VersusScreen({ userId, username, code: codeFromAddress, format = "fantasy", onBack, onCode, onShare, siteUrl }) {
  const [match, setMatch] = useState(null);
  const [code, setCode] = useState(codeFromAddress || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
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
          <RosterList roster={state.roster[mine]} side={mine} label={name(match, mine)} format={match.format} />
          <RosterList roster={state.roster[theirs]} side={theirs} label={name(match, theirs)} format={match.format} />
        </div>
        <div className="vs-powers">
          <button className="btn" onClick={() => onShare?.(versusShareText(match, result, mine, siteUrl))}>Share</button>
          <button className="btn" onClick={onBack}>Back</button>
        </div>
      </section>
    );
  }

  const powers = state ? {
    respin: respinsLeft(match.respins, side),
    dip: dipsLeft(match.dips, side),
    steal: stealsLeft(match.picks.map((p) => ({ stolenBy: p.stolenBy })), side),
    stealPick: pickStealsLeft(match.swaps, side),
  } : null;

  return (
    <section className="versus" data-view="draft" data-code={match.code}>
      <div className="vs-head">
        <div className="vs-vs">
          <span className="vs-who"><span className="vs-nm">{hostName}</span><span className="vs-tag">{side === "host" ? "You" : "Host"}</span></span>
          <span className="vs-x">vs</span>
          <span className="vs-who"><span className="vs-nm">{guestName}</span><span className="vs-tag">{side === "guest" ? "You" : "Opponent"}</span></span>
        </div>
        <div>
          <p className={`vs-turn ${myTurn ? "mine" : ""}`}>{myTurn ? "Your pick" : `${name(match, state?.turn?.side)} is picking`}</p>
          {left != null ? <p className={`vs-clock ${left <= 10 ? "low" : ""}`} aria-label={`${left} seconds left`}>{left}s</p> : null}
        </div>
      </div>

      <p className="vs-note">Board {Math.min(state.boardIdx + 1, MATCH_BOARDS)} of {MATCH_BOARDS}</p>
      {error ? <p className="vs-err">{errorText(error)}</p> : null}

      {myTurn && powers ? (
        <div className="vs-powers">
          <button className="btn sm" disabled={busy || powers.respin.team < 1} onClick={() => send({ respin: "team" })}>Re-spin team ({powers.respin.team})</button>
          <button className="btn sm" disabled={busy || powers.respin.era < 1} onClick={() => send({ respin: "era" })}>Re-spin era ({powers.respin.era})</button>
          <button className="btn sm" disabled={busy || powers.dip < 1 || state.boardIdx >= MATCH_BOARDS - 1} onClick={() => send({ dip: true })}>Double dip ({powers.dip})</button>
          <button className="btn sm" disabled={busy || powers.steal < 1 || state.turn.first} onClick={() => send({ steal: true })}>Steal ({powers.steal})</button>
          <button className="btn sm" disabled={busy || powers.stealPick < 1 || state.turn.first} onClick={() => send({ stealPick: true })}>Steal the pick ({powers.stealPick})</button>
        </div>
      ) : null}

      {state.boardKey ? (
        <Board
          boardKey={state.boardKey} taken={state.taken} roster={state.roster[side || "host"]}
          myTurn={myTurn && !busy} format={match.format}
          onPick={(o, slot) => send({
            boardIdx: state.boardIdx, kind: o.kind, slot,
            playerId: o.kind === "player" ? o.id : undefined,
            team: o.kind === "player" ? undefined : o.team, season: o.season,
          })}
        />
      ) : null}

      <div className="vs-rosters">
        <RosterList roster={state.roster.host} side="host" label={hostName} format={match.format} />
        <RosterList roster={state.roster.guest} side="guest" label={guestName} format={match.format} />
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
