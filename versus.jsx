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
import { createMatch, joinMatch, fetchMatch, playMove, subscribeMatch, versusPath, sget, sset } from "./storage.js";
import {
  replayMatch, optionsOn, optionId, optionFits, openSlots, matchResult,
  VERSUS_SLOTS, MATCH_BOARDS, TURN_SECONDS, LOOK_SECONDS, lookWindow, respinsLeft, dipsLeft, stealsLeft, pickStealsLeft,
} from "./versus-logic.mjs";
import { TEAMS, WINDOWS } from "./game-logic.mjs";
import {
  SLOT_LABEL, teamVars, teamLabel, shortYr, POS_NAME, cityRange, statCells, useCloseOnBack, keepFocusInside,
} from "./ui-common.jsx";

// The two slots 1v1 adds, beside the six every other mode already labels. A chip says which slot a pick filled
// in letters, never by colour alone - the accessibility floor tests/test-a11y.mjs keeps.
const VS_SLOT_LABEL = { ...SLOT_LABEL, DST: "DEF", K: "K" };
// Per device, like the game's own rules flag. ps- prefixed, as every storage key in this app is.
const VERSUS_HOWTO_KEY = "ps-vs-howto-seen";

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
/* On the team card, top right, where the card already had room. Tabular so it doesn't jitter as it counts. */
/* On its own dark pill, not straight onto the card: the card carries the team's colours, so the clock was
   white on whatever those happened to be - 1.96:1 over the Jets' white stripe and 2.79:1 over the Rams' yellow,
   both under the 3:1 large text needs, and a text-shadow counts for nothing in WCAG. The pill makes it the same
   readable clock on all 32 teams. The number is what says time is short; .low only colours what it already says. */
.vs-reelclock{position:absolute;top:12px;right:16px;font-family:var(--display);font-size:34px;line-height:1;
  color:#fff;font-variant-numeric:tabular-nums;background:rgba(6,10,22,.88);border-radius:10px;padding:2px 9px}
.vs-reelclock .vs-s{font-size:18px;opacity:.75;margin-left:1px}
.vs-reelclock.low{color:var(--loss)}
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
/* Both rosters above the board, each the draft's own strip - one row of eight rather than the six single
   player fills, so the pair costs about 130px at the top instead of pushing the board off the screen. */
.vs-rosters{display:grid;gap:10px;grid-template-columns:1fr;margin:2px 0 10px}
.vs-side-hd{font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;margin:0 0 8px;opacity:.85}
.vs-side-hd .vs-sub{font-family:var(--display);font-size:16px;letter-spacing:0;margin-left:6px}
.vs-rosters .roster{grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin-bottom:0}
.vs-rosters .slot{min-height:52px;padding:6px 8px}
.vs-rosters .slot .v{font-size:13px}
.vs-final{display:grid;gap:6px;justify-items:center;text-align:center;padding:18px 0}
.vs-score{font-family:var(--display);font-size:56px;line-height:1;font-variant-numeric:tabular-nums}
.vs-lines{display:grid;gap:3px;font-size:13px;margin-top:8px;max-width:420px}
.vs-lines .vs-ln{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dashed var(--line);padding:4px 0}
/* The powerups, under the reel: an icon, the name, and how many are left. The icon carries the row on a phone,
   where the label shortens - so it has to be a glyph that reads small, not a picture. */
.vs-pu{display:inline-flex;align-items:center;gap:7px}
.vs-pi{font-size:15px;line-height:1;flex:none}
.vs-pu-help{opacity:.85}
.vs-hh{font-family:var(--display);font-size:20px;margin:18px 0 8px}
.vs-plist{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.vs-plist li{display:flex;gap:10px;align-items:flex-start;border-bottom:1px solid var(--line);padding-bottom:9px}
.vs-plist .vs-pi{font-size:18px;margin-top:2px;width:22px;text-align:center}
.vs-pd{font-size:13px;opacity:.8;margin-top:3px}
/* What just happened. A fixed row, so the board does not jump when a line appears and goes. */
.vs-flashrow{min-height:30px}
.vs-flash{margin:0;padding:6px 10px;border-radius:10px;background:var(--surface2);border:1.5px solid var(--line2);
  font-weight:700;font-size:13.5px;display:inline-flex;gap:8px;align-items:center;animation:vs-in .28s ease-out}
/* After .vs-flash, not before it: same specificity, and .vs-flash sets the border SHORTHAND, which resets
   border-color. Declared first, the opening window's lime edge never drew at all and its banner was
   indistinguishable from an ordinary event line. (CLAUDE.md: base rules before the rules that override them.) */
.vs-open{border-color:var(--accent);font-variant-numeric:tabular-nums}
@keyframes vs-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
/* Who still holds what. Struck through rather than merely dimmed: a spent one has to read without colour. */
.vs-track{list-style:none;display:flex;gap:8px;margin:6px 0 0;padding:0}
.vs-tk{font-size:14px;line-height:1;opacity:.95}
.vs-tk.spent{opacity:.4;text-decoration:line-through}
.vs-note{font-size:13px;opacity:.85}
.vs-err{color:var(--loss);font-weight:700;font-size:13px}
@media (prefers-reduced-motion:reduce){.vs-flash{animation:none}}
@media (max-width:900px){.vs-rosters .roster{grid-template-columns:repeat(4,minmax(0,1fr))}}
/* On a phone the pair has to stay out of the board's way, so the strips lose the season line and shrink to
   two rows of four. The season is still one tap away on the card, and the sticky bar carries your slots as
   chips anyway. */
/* On a phone everything above the board competes with the board, and the board was losing: measured at 375px
   the first player card sat 977px down an 812px screen, so a player could not see a single player without
   scrolling. What follows is the diet.

   The other player's roster shrinks to a glance - which slots they have filled. WHO they took is already on the
   board, struck through, and their names were the tallest thing on the screen. Yours stays legible, because
   yours is what you read the board against. */
@media (max-width:640px){
  .versus{gap:10px}
  .vs-score{font-size:42px}
  .vs-clock{font-size:22px}
  .vs-reelclock{font-size:28px;top:10px;right:12px}
  .vs-rosters{gap:6px}
  .vs-rosters .roster{gap:4px}
  .vs-rosters .slot{min-height:38px;padding:4px 6px}
  .vs-rosters .slot .sub{display:none}
  .vs-rosters .slot .v{font-size:12px;margin-top:1px}
  /* 12px is the floor tools/ui-harness/audit.mjs holds the whole app to; these were 10.5 and 10. */
  .vs-rosters .slot .k{font-size:12px}
  .vs-side-hd{margin-bottom:3px;font-size:11px}
  .vs-them .roster{grid-template-columns:repeat(8,minmax(0,1fr));gap:3px}
  .vs-them .slot{min-height:30px;padding:3px 1px;text-align:center}
  .vs-them .slot .v{display:none}
  .vs-them .slot .k{font-size:12px}
  /* Filled has to read without colour, because on this strip the name is gone: the solid edge and the
     position bar .slot.filled already draws are the shape saying so, and the background only tints it. */
  .vs-them .slot[data-filled="1"]{border-style:solid;background:var(--surface2)}
  .vs-them .vs-track{margin-top:4px}
  .vs-powers .btn{padding:7px 9px}
  .vs-flashrow:empty{display:none;min-height:0}
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
// The bar appears once the reel has scrolled away, exactly as it does in the single-player draft - pinned at
// rest it would sit over the nav, which is the one thing a player needs to leave the screen with.
function useStuck() {
  const sentinel = useRef(null);
  const [stuck, setStuck] = useState(false);
  const [live, setLive] = useState(false); // whether the sentinel is on screen yet to observe
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") { setStuck(false); return undefined; }
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: "0px 0px 100000px 0px" });
    io.observe(el);
    return () => { io.disconnect(); setStuck(false); };
  }, [live]);
  // The sentinel only exists once the draft is on screen, so the observer is armed when it appears rather than
  // on every render - an effect with no deps would tear the observer down and rebuild it each time.
  const attach = useCallback((el) => { sentinel.current = el; setLive(!!el); }, []);
  return [stuck, attach];
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

// The powerups, in one place, because the buttons and the rules screen have to say the same thing about them -
// a control whose label and whose explanation drift apart is worse than no explanation at all. The icon is a
// glyph rather than a picture: it has to read at 12px on a phone, beside four others, under a clock.
export const POWERUPS = [
  {
    id: "team", icon: "↻", label: "Re-spin team", short: "Team",
    blurb: "Another team, same era.",
    detail: "If you pick first on the board, the new one is dealt to your opponent as well - so a board that is wrong for you can easily be right for them. If you pick second it is yours alone, and you walk away from a board they have already picked over.",
  },
  {
    id: "era", icon: "↻", label: "Re-spin era", short: "Era",
    blurb: "Same team, another era.",
    detail: "Works exactly like the team re-spin, and has its own use: one for the roster you are chasing, one for the era you want it from.",
  },
  {
    id: "dip", icon: "⚡", label: "Double dip", short: "Double",
    blurb: "Two off this board - and you give up your next pick.",
    detail: "Two picks here, none on the next board, so you still finish with eight. The cost is real: they get the next board to themselves, and this one is two options poorer when they pick from it.",
  },
  {
    id: "steal", icon: "😈", label: "Steal", short: "Steal",
    blurb: "Take the pick they just made.",
    detail: "Only when you pick second, and only the pick just made. It becomes yours, and they go straight back to this board and pick again - so they lose the player, not the turn.",
  },
  {
    id: "stealPick", icon: "🔀", label: "Steal the pick", short: "First",
    blurb: "Pick first on a board you would have picked second on.",
    detail: "Spend it before either of you has taken anything. The order on that board flips, and the snake carries on as normal from the next board.",
  },
];

// The groups the board is laid out in: the four positions the single-player draft uses, then the two 1v1 adds.
const GROUPS = [
  ["QB", POS_NAME.QB, (o) => o.kind === "player" && o.pos === "QB"],
  ["RB", POS_NAME.RB, (o) => o.kind === "player" && o.pos === "RB"],
  ["WR", POS_NAME.WR, (o) => o.kind === "player" && o.pos === "WR"],
  ["TE", POS_NAME.TE, (o) => o.kind === "player" && o.pos === "TE"],
  ["DST", "Defenses", (o) => o.kind === "dst"],
  ["K", "Kickers", (o) => o.kind === "k"],
];

// 1v1's own rules, which are not the game's rules. Someone arriving on an invite has very likely never seen
// this mode, and the single-player How to play answers none of the questions they actually have - whose turn,
// what the clock does, what the five buttons are. Its own dialog, with its own seen-flag, so it appears once.
export function VersusHowTo({ onClose }) {
  const btn = useRef(null);
  const dialog = useRef(null);
  useCloseOnBack(onClose);
  useEffect(() => {
    btn.current && btn.current.focus({ preventScroll: true });
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="vs-howto-title" tabIndex={-1}
        onKeyDown={(e) => keepFocusInside(e, dialog.current)} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button>
        <h2 id="vs-howto-title">How 1v1 works</h2>
        <ol>
          <li>You and your opponent watch the <b>same eight boards</b>, one team and era at a time.</li>
          <li>You take turns, and the order <b>snakes</b>: whoever picks first on one board picks second on the next.</li>
          <li>The second picker takes from <b>the same board, minus what was just taken</b>.</li>
          <li>A roster is <b>QB, RB, WR, TE and two Flex</b>, the same six single player uses, plus a <b>defense</b> and a <b>kicker</b>. Every board offers all of them, so take a defense fifth if you want one.</li>
          <li>Every pick has a <b>clock</b>. Run it out and the best available option is taken for you - a dropped connection costs a pick, not the match.</li>
          <li>When both rosters are full, <b>the better one wins</b>. No dice: their defense comes off your score, your kicker adds to it, and the higher number takes it every time.</li>
        </ol>
        <h3 className="vs-hh">Your powerups</h3>
        <ul className="vs-plist">
          {POWERUPS.map((p) => (
            <li key={p.id}>
              <span className="vs-pi" aria-hidden="true">{p.icon}</span>
              <div>
                <b>{p.label}</b> — {p.blurb}
                <div className="vs-pd">{p.detail}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="note">One of each, per match, spent on your own turn. A powerup the rules would refuse is greyed out.</p>
        <button ref={btn} className="btn primary" onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}

// What each player still holds. Derived from the match's own rows, like everything else here - there is no
// "powerups used" to keep in step with anything, only the respins, dips and swaps that already exist.
export function powerupsFor(match, side) {
  const respins = respinsLeft(match.respins || [], side);
  return {
    team: respins.team, era: respins.era,
    dip: dipsLeft(match.dips || [], side),
    steal: stealsLeft(match.picks || [], side),
    stealPick: pickStealsLeft(match.swaps || [], side),
  };
}

// The icon row under a roster: lit for one still held, struck through for one spent. Readable without colour -
// a spent powerup is struck through and marked in its label, not merely dimmed.
function PowerupTrack({ left, label }) {
  return (
    <ul className="vs-track" aria-label={`${label}: powerups`}>
      {POWERUPS.map((pu) => {
        const spent = left[pu.id] < 1;
        return (
          <li key={pu.id} className={`vs-tk ${spent ? "spent" : ""}`} title={`${pu.label} — ${spent ? "used" : "still has it"}`}>
            <span aria-hidden="true">{pu.icon}</span>
            <span className="vh">{pu.label}: {spent ? "used" : "unused"}</span>
          </li>
        );
      })}
    </ul>
  );
}

// What just happened, in one line. Derived from the rows rather than remembered as it goes: a client that
// reconnects mid-match sees the same last event as one that never left, and there is no running log to keep in
// step with the match. Keyed so the screen can tell a new event from a re-render of the same one.
export function latestEvent(match, state, nameOf) {
  if (!match || !state) return null;
  const out = [];
  for (const r of match.respins || []) {
    const pu = POWERUPS.find((x) => x.id === (r.kind === "era" ? "era" : "team"));
    out.push({ at: r.pickNo * 4, key: `respin:${r.pickNo}:${r.kind}`, icon: pu.icon,
      text: `${nameOf(r.by)} re-spun the ${r.kind === "era" ? "era" : "team"}` });
  }
  for (const d of match.dips || []) {
    out.push({ at: (d.boardIdx * 2 + 1) * 4 + 1, key: `dip:${d.boardIdx}:${d.by}`, icon: "⚡",
      text: `${nameOf(d.by)} doubled up — two off this board, and no pick on the next` });
  }
  for (const w of match.swaps || []) {
    out.push({ at: (w.boardIdx * 2 + 1) * 4 - 1, key: `swap:${w.boardIdx}:${w.by}`, icon: "🔀",
      text: `${nameOf(w.by)} took the first pick on this board` });
  }
  for (const p of match.picks || []) {
    if (!p.stolenBy) continue;
    const taken = state.roster[p.stolenBy]?.[p.slot];
    out.push({ at: p.pickNo * 4 + 2, key: `steal:${p.pickNo}`, icon: "😈",
      text: `${nameOf(p.stolenBy)} stole ${taken ? optionName(taken) : "the pick"}` });
  }
  if (!out.length) return null;
  return out.sort((a, b) => a.at - b.at)[out.length - 1];
}

// Shows the newest event for a few seconds, then lets it go. Keyed on the event, so the same one never
// re-announces itself when the match is re-read - which it is, every two seconds.
function useFlash(event) {
  const [shown, setShown] = useState(null);
  const seen = useRef(null);
  useEffect(() => {
    if (!event || event.key === seen.current) return undefined;
    seen.current = event.key;
    setShown(event);
    const t = setTimeout(() => setShown(null), 5000);
    return () => clearTimeout(t);
  }, [event?.key]);
  return shown;
}

// Your roster, as the draft screen shows one: a strip of slots with who is in them.
function RosterStrip({ roster, label, sub, them }) {
  return (
    <div className={`vs-side ${them ? "vs-them" : ""}`}>
      <p className="vs-side-hd">{label}{sub ? <span className="vs-sub"> {sub}</span> : null}</p>
      <div className="roster" data-side={label}>
        {VERSUS_SLOTS.map((slot) => {
          const o = roster[slot];
          // `filled` is the app's own class for a slot with somebody in it - the inset position-coloured bar -
          // and `pos-*` is what sets the --pc that bar is drawn in. This was written as `on`, a class no
          // stylesheet in the app has ever had, so every filled slot kept the dashed empty-slot border and none
          // of the position colour.
          return (
            <div key={slot} className={`slot pos-${slot.startsWith("FLEX") ? "FLEX" : slot} ${o ? "filled" : ""}`}
                 data-slot={slot} data-filled={o ? "1" : "0"}>
              {/* One line of words for assistive tech at every width, and the painted version hidden from it.
                  The opponent's strip drops .v on a phone, which took the only text saying whether a slot was
                  filled out of the tree with it - leaving a 1.23:1 background and a 1.91:1 border as the entire
                  signal, which is colour carrying meaning on its own (CLAUDE.md, Design system). */}
              <span className="vh">
                {o ? `${POS_NAME[slot.startsWith("FLEX") ? "FLEX" : slot] || VS_SLOT_LABEL[slot]}: ${optionName(o)}`
                   : `${POS_NAME[slot.startsWith("FLEX") ? "FLEX" : slot] || VS_SLOT_LABEL[slot]}, open`}
              </span>
              <div className="k" aria-hidden="true">{VS_SLOT_LABEL[slot]}</div>
              <div className="v" aria-hidden="true">{o ? optionName(o) : <span style={{ color: "var(--muted)", fontWeight: 400 }}>Open</span>}</div>
              {o && <div className="sub" aria-hidden="true">{shortYr(o.season)} {TEAMS[o.team][0]}{slot.startsWith("FLEX") ? `, ${o.pos}` : ""}</div>}
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
// What the single-player draft's secState says about a position, asked of a group of options instead, so the
// two 1v1 adds answer it too:
//   0  its slot is open   1  its own slot is filled but these can still go to a Flex   2  done
const groupState = (list, open) => {
  if (!list.length) return 2;
  if (list.some((o) => open.some((s) => optionFits(o, s) && !s.startsWith("FLEX")))) return 0;
  if (list.some((o) => open.some((s) => optionFits(o, s)))) return 1;
  return 2;
};

function Board({ boardKey, taken, roster, myTurn, onPick, selected, setSelected, busy, controls, turnLabel, seconds }) {
  const [team, w] = boardKey.split("|");
  const options = optionsOn(boardKey);
  const open = openSlots(roster);
  const left = options.filter((o) => !taken.has(optionId(o))).length;
  // Which finished sections a player has asked to see again, exactly as the single-player draft keeps it.
  const [showDone, setShowDone] = useState({});
  return (
    <>
      <div className="reel" aria-live="polite" style={teamVars(team)}>
        <div className="stripe" style={{ background: TEAMS[team][2] }} />
        <div className="pickno"><span>{turnLabel}</span><span>{left} left on the board</span></div>
        {/* The clock lives on the team card rather than in a bar of its own: it was the only thing in that bar
            not already said by the roster headings and the line beside it. */}
        {/* role="timer" rather than a bare aria-label on a div, which isn't reliably exposed - and it carries
            aria-live="off", which is the point: the reel around it is a polite live region, so a per-second
            countdown inside it had a screen reader re-reading the whole board every second, for forty-five
            seconds a turn and sixteen turns a match. Read on demand, not announced. */}
        {seconds != null ? (
          <div className={`vs-reelclock ${seconds <= 10 ? "low" : ""}`}
               role="timer" aria-live="off" aria-label={`${seconds} seconds left in this turn`}>
            {seconds}<span className="vs-s">s</span>
          </div>
        ) : null}
        <div className="team">{TEAMS[team][0]}</div>
        <div>
          <span className="years led-wrap"><span className="led">{WINDOWS[Number(w)][0]}–{WINDOWS[Number(w)][1]}</span></span>
          {cityRange(team, Number(w)) && <span className="city">{cityRange(team, Number(w))}</span>}
        </div>
      </div>

      {/* Under the team and the era, where the re-spins live in the single-player draft - which is also where
          you are looking when you decide you do not want this board. */}
      {controls}

      {/* A finished section folds away and sinks to the bottom, the way the single-player draft does it: a
          position whose slot is filled is no longer something you are choosing from, and leaving it open in
          place pushes what you still need off the screen. One that is filled but can still go to a Flex stays
          where it is, because it is still a choice. */}
      {GROUPS
        .map(([key, heading, belongs]) => ({ key, heading, list: options.filter(belongs) }))
        .filter((g) => g.list.length)
        .map((g) => ({ ...g, st: groupState(g.list, open) }))
        .sort((a, b) => (a.st === 2 ? 1 : 0) - (b.st === 2 ? 1 : 0))
        .map(({ key, heading, list, st }) => {
        const collapsed = st === 2 && !showDone[key];
        return (
          <section className={`sec pos-${key === "DST" || key === "K" ? "FLEX" : key} ${st === 2 ? "done" : ""}`} key={key}>
            <div className="hd">
              <h3>{heading}</h3>
              {st === 1 && <span className="nt">{VS_SLOT_LABEL[key] || key} spot filled. These can still go to Flex.</span>}
              {st === 2 && (
                <button className="linkbtn" onClick={() => setShowDone({ ...showDone, [key]: !showDone[key] })}>
                  {collapsed ? `Spot filled. Show ${list.length} option${list.length > 1 ? "s" : ""}` : "Hide"}
                </button>
              )}
            </div>
            {!collapsed && list.map((o) => {
              const id = optionId(o);
              const gone = taken.has(id);
              const slotsFor = open.filter((sl) => optionFits(o, sl));
              // What the single-player draft greys out, and all it greys out: an option already taken, or one
              // that fits no slot you have left. Waiting for the other player is NOT one of them. Dimming the
              // whole board for their whole turn put cream on navy at 3.43:1 and the stat labels at 2.28:1 -
              // both under AA - for about half of a sixteen-pick match, with nothing saying why.
              const dim = gone || !slotsFor.length;
              // Reading the board while you wait is the whole point of waiting; picking off it is not.
              const off = dim || !myTurn;
              const isSel = selected === id;
              return (
                <div key={id} className={`card ${isSel ? "sel" : ""} ${dim ? "off" : ""}`} data-opt={id}>
                  <button className="hit" disabled={dim || busy} onClick={() => setSelected(isSel ? null : id)} aria-expanded={isSel}>
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
                        <button key={sl} className="btn solid" disabled={off || busy} onClick={() => onPick(o, sl)}>
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
  // Which pick the clock has already been claimed for, and how many times - so a refusal backs off instead of
  // asking again every 300ms. `claimAgain` is what re-arms the effect, since `match` is deliberately not a dep.
  const claim = useRef({ at: null, tries: 0 });
  const [claimAgain, setClaimAgain] = useState(0);
  // Every hook here runs on every render of this screen, lobby or draft - one that only ran on the draft would
  // be React error #310 the moment a lobby turned into one.
  const [stuck, sentinel] = useStuck();
  // 1v1's own rules, shown once per device and from the button under the board thereafter. Its own flag, not
  // the game's: somebody who has played a hundred seasons has still never seen a snake draft with a clock.
  const [showRules, setShowRules] = useState(false);
  useEffect(() => {
    let live = true;
    (async () => { if (live && !(await sget(VERSUS_HOWTO_KEY, false))) setShowRules(true); })();
    return () => { live = false; };
  }, []);
  const closeRules = useCallback(() => { setShowRules(false); sset(VERSUS_HOWTO_KEY, "1", false); }, []);
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
  // notices is a player sitting on a finished turn waiting out a clock they cannot affect.
  //
  // Every two seconds for the whole match, including your own turn. It skipped your turn at first, on the
  // reasoning that your own moves refresh the screen themselves - but the other player can act DURING your
  // turn: Steal the pick is spent while you are on the clock, and takes the board's first pick off you. A
  // client that stops reading whenever it believes it is their turn would never learn it had stopped being.
  // A lobby reads too, or a host whose Realtime is not delivering never learns that anybody joined - which is
  // the very first thing that has to work.
  useEffect(() => {
    if (!match?.code || match.status === "done" || match.status === "abandoned") return undefined;
    const t = setInterval(() => refresh(match.code), 2000);
    return () => clearInterval(t);
  }, [match?.code, match?.status, refresh]);

  // Every hook above every early return: what each player still holds, whether this board's order has already
  // been flipped, and the one-line announcement of whatever just happened.
  const mine = state && side ? powerupsFor(match, side) : null;
  const theirs = state && side ? powerupsFor(match, side === "host" ? "guest" : "host") : null;
  const alreadySwapped = !!state && (match.swaps || []).some((w) => w.boardIdx === state.boardIdx);
  const flash = useFlash(latestEvent(match, state, (s) => name(match, s)));
  // A refusal belongs to the moment it happened. It was only ever cleared by the next move, so one left over
  // from another board and another turn sat on screen reading as nonsense - "that would leave the other player
  // with nothing to pick" over a board with thirty options on it. Any pick landing clears it.
  const atPick = state ? `${state.boardIdx}:${state.pickNo}:${state.turn?.side || ""}` : "";
  const lastAt = useRef(atPick);
  useEffect(() => {
    if (lastAt.current === atPick) return;
    lastAt.current = atPick;
    setError(null);
    // The open card goes with it. Left alone, a card expanded on your turn kept its Lock in buttons on screen
    // after the turn moved - pressing one only ever earned a refusal from the server.
    setSelected(null);
  }, [atPick]);
  // The board's opening window (VERSUS.md 7): the seconds in which the first pick can't land yet, so the other
  // player has a real chance to take it. Null whenever nobody could use one.
  const look = state && match?.status === "drafting"
    ? lookWindow({ state, swaps: match.swaps || [], picks: match.picks || [], deadline: match.turnDeadline ? Date.parse(match.turnDeadline) : 0 })
    : null;
  const lookLeft = useCountdown(look ? new Date(look.until).toISOString() : null);
  const opening = !!look && lookLeft > 0;

  // When the clock runs out somebody has to say so, and it may be either of them - that is what keeps a match
  // alive when the other player has closed the tab. Asked once, a beat after zero, so the two screens don't
  // race each other for it.
  // Keyed on the pick it is claiming and on primitives, never on `match`: refresh builds a new object every two
  // seconds, so with `match` in the deps this tore down and re-armed on every poll, and its own .then's refresh
  // re-armed it again. A device whose clock runs fast reaches zero before the row's deadline does, gets
  // `too_early`, and used to ask again 300ms later for the rest of the turn - the answer to which is to wait
  // longer, not to ask harder. Each refusal now buys one more attempt, three seconds apart.
  useEffect(() => {
    if (left !== 0 || !match?.code || match.status !== "drafting" || !side) return undefined;
    const at = state?.pickNo ?? null;
    if (at == null) return undefined;
    if (claim.current.at !== at) claim.current = { at, tries: 0 };
    const wait = claim.current.tries === 0 ? (myTurn ? 300 : 1500) : 3000;
    const code = match.code;
    const t = setTimeout(async () => {
      claim.current = { at, tries: claim.current.tries + 1 };
      const res = await playMove({ code, claim: "clock" });
      await refresh(code);
      // A claim that landed - or that lost the race to the other screen - moves the pick on, and the effect
      // resets itself on the new pickNo. Only "not yet" leaves everything where it was, so only that asks again.
      if (res && !res.ok && res.reason === "too_early") setClaimAgain((n) => n + 1);
    }, wait);
    return () => clearTimeout(t);
  }, [left, match?.code, match?.status, side, myTurn, refresh, state?.pickNo, claimAgain]);

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
        {showRules ? <VersusHowTo onClose={closeRules} /> : null}
        <h2 className="h">1v1</h2>
        <p className="note">
          Open a lobby and send the link. You and whoever takes it draft from the same eight boards — six players,
          a defense and a kicker each — and the better roster wins. No dice.
        </p>
        {error ? <p className="vs-err" role="alert">{errorText(error)}</p> : null}
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
        {showRules ? <VersusHowTo onClose={closeRules} /> : null}
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

  // The rows can say the draft is over a moment before the match row does. The Edge Function writes the
  // sixteenth pick, then reads back, grades, and sets the status in separate calls - and match_picks is in the
  // Realtime publication, so the other player's screen is told about that insert while the rest is still in
  // flight. Rendering the board here read a turn that no longer exists; with no error boundary anywhere, that
  // took the whole app down, and it landed on whoever didn't make the last pick. The poll is still running, so
  // this is a beat, not a state anyone sits in.
  if (state?.done && match.status !== "done") {
    return (
      <section className="versus" data-view="grading" data-code={match.code}>
        <h2 className="h">That's sixteen</h2>
        <p className="vs-note">Working out the result…</p>
      </section>
    );
  }

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
          {result[mine].against || result[theirs].against ? (
            <p className="vs-note">
              {result[theirs].against ? `Your defense took ${result[theirs].against} off them.` : ""}
              {result[mine].against ? ` Theirs took ${result[mine].against} off you.` : ""}
            </p>
          ) : null}
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

  return (
    <section className="versus vs-draft" data-view="draft" data-code={match.code}>
      {/* The lobby, the result and the signed-out view all name themselves; the screen a whole match is played
          on went straight from the page's h1 to the board's position headings, which is a heading-order
          failure and left both rosters unreachable by heading navigation. Visually hidden: the board says
          what this is far better than a title would. */}
      <h2 className="vh">1v1 draft — board {Math.min(state.boardIdx + 1, MATCH_BOARDS)} of {MATCH_BOARDS}</h2>
      {showRules ? <VersusHowTo onClose={closeRules} /> : null}
      {/* The bar the single-player draft floats once you scroll past the reel, carrying what a 1v1 needs
          instead: who is on the clock, the seconds left, and both rosters as chips. */}
      <div className={`sticky ${stuck ? "show" : ""}`} aria-hidden={!stuck} style={teamVars(boardTeam)}>
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

      {error ? <p className="vs-err" role="alert">{errorText(error)}</p> : null}

      {/* What just happened, for a few seconds. Derived from the match's rows, so a client that reconnects
          mid-board sees the same thing as one that never left. */}
      <div className="vs-flashrow" aria-live="polite">
        {/* Seen and announced separately, because this row is a polite live region and the seen version ticks
            every second - which had a screen reader re-reading the sentence ten times over. The spoken one says
            the same thing once, without a number in it. */}
        {opening ? (
          <p className="vs-flash vs-open">
            <span aria-hidden="true">🔀</span>
            <span aria-hidden="true">
              {myTurn
                ? ` The board opens in ${lookLeft}s — ${name(match, look.follower)} can take the first pick.`
                : ` ${lookLeft}s to take the first pick on this board.`}
            </span>
            <span className="vh">
              {myTurn
                ? `The board waits a few seconds before it opens — ${name(match, look.follower)} can take the first pick.`
                : "You have a few seconds to take the first pick on this board."}
            </span>
          </p>
        ) : flash ? (
          <p className="vs-flash" key={flash.key}><span aria-hidden="true">{flash.icon}</span> {flash.text}</p>
        ) : null}
      </div>

      {/* Above the board, where the single-player draft keeps its roster strip: what you still have open is
          the thing you are reading the board against, so it has to be on screen while you choose - not eight
          sections further down. */}
      <div className="vs-rosters">
        <div>
          <RosterStrip roster={state.roster[side || "host"]} label="Your roster" />
          {mine ? <PowerupTrack left={mine} label="You" /> : null}
        </div>
        <div>
          <RosterStrip them roster={state.roster[side === "host" ? "guest" : "host"]} label={`${name(match, side === "host" ? "guest" : "host")}'s roster`} />
          {theirs ? <PowerupTrack left={theirs} label={name(match, side === "host" ? "guest" : "host")} /> : null}
        </div>
      </div>

      <div ref={sentinel} aria-hidden="true" />

      {state.boardKey ? (
        <Board
          boardKey={state.boardKey} taken={state.taken} roster={state.roster[side || "host"]}
          myTurn={myTurn && !opening} busy={busy} selected={selected} setSelected={setSelected}
          turnLabel={myTurn ? "Your pick" : `${name(match, state.turn.side)} is picking`} seconds={left}
          controls={side ? (
            <div className="rerolls vs-powers">
              {POWERUPS.map((pu) => {
                const n = mine[pu.id];
                // Steal the pick is the one spent off your own turn (VERSUS.md 7), so the bar shows for both
                // players - which also means each can see what the other still holds.
                const offTurn = pu.id === "stealPick";
                const wrongTurn = offTurn ? (myTurn || !state.turn.first || alreadySwapped) : (!myTurn || opening);
                const illegal = (pu.id === "dip" && state.boardIdx >= MATCH_BOARDS - 1)
                  || (pu.id === "steal" && state.turn.first);
                return (
                  <button key={pu.id} className="btn vs-pu" disabled={busy || n < 1 || illegal || wrongTurn}
                    title={`${pu.blurb} ${n} left.`}
                    aria-label={`${pu.label}. ${pu.blurb} ${n} left.`}
                    onClick={() => send(pu.id === "team" ? { respin: "team" } : pu.id === "era" ? { respin: "era" } : { [pu.id]: true })}>
                    <span className="vs-pi" aria-hidden="true">{pu.icon}</span>
                    <span className="rs-long">{pu.label} <span className="left">({n})</span></span>
                    <span className="rs-short" aria-hidden="true">{pu.short} <b>{n}</b></span>
                  </button>
                );
              })}
              {/* Named here because every span inside is either aria-hidden or display:none on a phone, which
                  left the button with no accessible name at all below 480px - the same pattern the draft's
                  re-spin buttons already carry an aria-label for. */}
              <button className="btn linkish vs-pu-help" aria-label="How 1v1 works" onClick={() => setShowRules(true)}>
                <span className="vs-pi" aria-hidden="true">?</span>
                <span className="rs-long">How 1v1 works</span>
                <span className="rs-short" aria-hidden="true">Rules</span>
              </button>
            </div>
          ) : null}
          onPick={(o, slot) => { setSelected(null); send({
            boardIdx: state.boardIdx, kind: o.kind, slot,
            playerId: o.kind === "player" ? o.id : undefined,
            team: o.kind === "player" ? undefined : o.team, season: o.season,
          }); }}
        />
      ) : null}

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
  // No kicker line. sideScore returns { roster, against, score } and matchResult adds `points` - there has never
  // been a `kicker` field, so the line this used to hold could not fire, and the card silently promised one of
  // the only two numbers worth having. The kicker is inside `roster` now: it is one of the seven picks averaged,
  // not a separate term the way it was when this was written.
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
  board_opening: "The board has just opened — give the other player a moment.",
  nothing_to_steal: "There's nothing to steal yet.",
  already_leading: "You already pick first on this board.",
  already_swapped: "The order on this board has already been swapped.",
  conflict: "That pick just went — try again.",
  signed_out: "Sign in to play.",
  network: "Couldn't reach the server. Try again.",
};
const errorText = (reason) => ERRORS[reason] || "That didn't work.";
