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
// team", "Re-spin era", "Double dip" and "Steal"; each roster is a .vs-rosters .roster with a .slot per slot
// carrying data-slot and data-filled - and while a steal is armed, their filled slots are .vs-grab buttons.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMatch, joinMatch, fetchMatch, playMove, subscribeMatch, versusPath, sget, sset } from "./storage.js";
import {
  replayMatch, optionsOn, optionId, optionFits, openSlots, matchResult, pickId,
  VERSUS_SLOTS, MATCH_BOARDS, respinsLeft, dipsLeft, stealsLeft,
} from "./versus-logic.mjs";
import { TEAMS, WINDOWS } from "./game-logic.mjs";
import {
  SLOT_LABEL, teamVars, teamLabel, shortYr, POS_NAME, cityRange, statCells, useCloseOnBack, keepFocusInside, Confetti,
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
/* On the team card, top right, where the card already had room. Tabular so it doesn't jitter as it counts. */
/* On its own dark pill, not straight onto the card: the card carries the team's colours, so the clock was
   white on whatever those happened to be - 1.96:1 over the Jets' white stripe and 2.79:1 over the Rams' yellow,
   both under the 3:1 large text needs, and a text-shadow counts for nothing in WCAG. The pill makes it the same
   readable clock on all 32 teams. The number is what says time is short; .low only colours what it already says. */
.vs-pnr{display:flex;align-items:center;gap:10px;min-width:0}
.vs-reelclock{font-family:var(--display);font-size:30px;line-height:1;flex:none;
  color:#fff;font-variant-numeric:tabular-nums;background:rgba(6,10,22,.88);border-radius:10px;padding:2px 9px}
.vs-reelclock .vs-s{font-size:16px;opacity:.75;margin-left:1px}
.vs-reelclock.low{color:var(--loss)}
.vs-tick.low{color:var(--loss)}
.vs-tick{font-variant-numeric:tabular-nums}
.vs-link{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.vs-link code{font-size:15px;padding:8px 10px;border:2px solid var(--line);border-radius:10px;background:var(--surface);word-break:break-all}
.vs-wait{display:flex;gap:10px;align-items:center;font-weight:700}
.vs-dot{width:10px;height:10px;border-radius:50%;background:var(--muted);flex:none}
.vs-powers{margin-top:18px}
/* Both rosters above the board, each the draft's own strip - one row of eight rather than the six single
   player fills, so the pair costs about 130px at the top instead of pushing the board off the screen. */
.vs-rosters{display:grid;gap:10px;grid-template-columns:1fr;margin:2px 0 10px}
/* NOT uppercased, because this line carries a username. The app uppercases labels and leaves data alone - the
   leaderboard does exactly this, .lb th against .lb td - and a username is data: somebody chose ShrimpCity
   over shrimpcity, and text-transform throws that choice away. */
.vs-side-hd{font-size:12px;letter-spacing:.06em;font-weight:800;margin:0 0 8px;opacity:.85}
.vs-side-hd .vs-sub{font-family:var(--display);font-size:16px;letter-spacing:0;margin-left:6px}
.vs-rosters .roster{grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin-bottom:0}
.vs-rosters .slot{min-height:52px;padding:6px 8px}
.vs-rosters .slot .v{font-size:13px}
/* Their roster while a steal is armed: every filled slot is a button, so it has to look like one. The lime
   edge is the same "this is the thing to press" the draft uses on a selected card. */
.vs-picking .vs-side-hd{color:var(--accent-ink)}
.vs-grab{cursor:pointer;text-align:left;font:inherit;color:inherit;border-color:var(--accent);
  box-shadow:inset 0 3px 0 var(--pc,var(--muted)),0 0 0 2px color-mix(in srgb,var(--accent) 35%,transparent)}
.vs-grab .sub{color:var(--accent-ink);font-weight:800}
.vs-grabnote{margin:6px 0 0}
@media (hover:hover){.vs-grab:hover{background:var(--surface2)}}
/* position:relative so the confetti has something to fall inside, and overflow:hidden so it doesn't spill past
   the block - the same pair .cel uses, because this is the same celebration. */
.vs-final{display:grid;gap:6px;justify-items:center;text-align:center;padding:18px 0;position:relative;overflow:hidden}
.vs-score{font-family:var(--display);font-size:56px;line-height:1;font-variant-numeric:tabular-nums}
.vs-beat{margin:0;font-weight:800;letter-spacing:.04em;font-size:14px;opacity:.85}
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
/* A powerup, across the whole screen. pointer-events:none throughout, and that is not optional: one of these
   can land while you are on the clock, so it must never swallow a tap, a Lock in, or the board underneath it.
   It paints its own dark ground rather than trusting whatever is behind it. */
.vs-boom{position:fixed;inset:0;z-index:40;display:grid;place-items:center;pointer-events:none;
  background:radial-gradient(60% 45% at 50% 50%,rgba(6,10,22,.86),rgba(6,10,22,.5) 65%,rgba(6,10,22,0));
  animation:vs-boom-bg 2.4s ease-out forwards}
.vs-boom-in{display:grid;justify-items:center;gap:12px;padding:0 24px;text-align:center;
  animation:vs-boom-pop 2.4s cubic-bezier(.2,.9,.25,1) forwards}
.vs-boom-icon{font-size:clamp(56px,17vw,104px);line-height:1;filter:drop-shadow(0 6px 18px rgba(0,0,0,.6))}
/* The powerup's name at the size of the screen, and who did it underneath. Two lines rather than one sentence:
   the big one is what you read without reading, the small one is the detail you look at if you want it. */
.vs-boom-title{margin:0;font-family:var(--display);text-transform:uppercase;line-height:.92;
  font-size:clamp(40px,12vw,84px);color:var(--vs-tone,#fff);text-wrap:balance;max-width:12ch;
  text-shadow:0 4px 24px rgba(0,0,0,.55)}
/* Not uppercased either: this line names a player and a person, and both own their capitalisation. Only the
   headline above it is a label, and only that is transformed. */
.vs-boom-who{margin:0;font-weight:800;letter-spacing:.02em;line-height:1.3;
  font-size:clamp(15px,3.6vw,21px);color:#fff;text-wrap:balance;max-width:28ch;opacity:.95}
/* One tint each, so the three don't land as the same wash of dark. The tint is the headline's colour and the
   glow behind it; the words underneath stay white, because that line has to read at 14px. */
.vs-boom.tone-spin{--vs-tone:#8FB0FF}
.vs-boom.tone-dip{--vs-tone:#FFC46B}
.vs-boom.tone-steal{--vs-tone:#C9A6FF}
/* Lime, which is the game's own "this one is yours" colour everywhere else. */
.vs-boom.tone-turn{--vs-tone:var(--accent)}
/* Your turn is the same announcement at half the length and with a lighter wash behind it: it happens eight
   times a match rather than twice, and it lands on a board you are in the middle of reading. Same keyframes,
   so it is recognisably the same thing happening - only quicker. */
.vs-boom.is-brief{animation-duration:1.2s;
  background:radial-gradient(60% 45% at 50% 50%,rgba(6,10,22,.72),rgba(6,10,22,.34) 65%,rgba(6,10,22,0))}
.vs-boom.is-brief .vs-boom-in{animation-duration:1.2s}
.vs-boom.is-brief .vs-boom-icon{font-size:clamp(44px,13vw,80px)}
.vs-boom.is-brief .vs-boom-title{font-size:clamp(34px,10vw,68px)}
@keyframes vs-boom-bg{0%{opacity:0}10%{opacity:1}72%{opacity:1}100%{opacity:0}}
@keyframes vs-boom-pop{
  0%{opacity:0;transform:scale(.72)}
  9%{opacity:1;transform:scale(1.07)}
  17%{transform:scale(1)}
  72%{opacity:1;transform:scale(1)}
  100%{opacity:0;transform:scale(1.05)}
}
/* Who still holds what. Struck through rather than merely dimmed: a spent one has to read without colour. */
.vs-track{list-style:none;display:flex;gap:8px;margin:6px 0 0;padding:0}
.vs-tk{font-size:14px;line-height:1;opacity:.95}
.vs-tk.spent{opacity:.4;text-decoration:line-through}
.vs-note{font-size:13px;opacity:.85}
.vs-err{color:var(--loss);font-weight:700;font-size:13px}
/* No motion, but the announcement still happens - it appears, holds for its moment, and React takes it away.
   Both parts need it: .vs-boom carries the fade, .vs-boom-in the pop. */
@media (prefers-reduced-motion:reduce){.vs-boom,.vs-boom-in{animation:none}}
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
  .vs-reelclock{font-size:24px;padding:2px 7px}
  .vs-rosters{gap:6px}
  .vs-rosters .roster{gap:4px}
  .vs-rosters .slot{min-height:38px;padding:4px 6px}
  .vs-rosters .slot .sub{display:none}
  .vs-rosters .slot .v{font-size:12px;margin-top:1px}
  /* 12px is the floor tools/ui-harness/audit.mjs holds the whole app to; these were 10.5 and 10. */
  .vs-rosters .slot .k{font-size:12px}
  .vs-side-hd{margin-bottom:3px;font-size:12px}
  /* The other player's roster shows WHO, the same as yours. It was eight across with the names hidden, to buy
     vertical space - and that made the screen unreadable in the way that matters: you could not see what they
     had taken from you, or who was on their roster to steal. The names are the whole point of the strip. Same
     four-by-two shape as yours so the two read as a comparison, just tighter. */
  .vs-them .slot{min-height:34px;padding:3px 5px}
  /* Wraps rather than ellipsising, the same as your own strip: "Trevor La..." is not a player you can pick out
     of a roster, and knowing who they hold is the entire job of this block. */
  .vs-them .slot .v{font-size:12px;margin-top:0;line-height:1.15}
  .vs-them .slot .k{font-size:11px}
  .vs-them .slot[data-filled="1"]{border-style:solid}
  .vs-them .vs-track{margin-top:4px}
  .vs-powers .btn{padding:7px 9px}
}
/* After the width blocks above, not before them - which is where this sat, and at the same specificity, so
   .vs-them .slot's own 34px beat it on every phone and the floor only existed above 640px. The one
   place a steal is ever spent is a phone. CLAUDE.md's ordering rule, learned the same way: base rules, then
   responsive, then pointer:coarse.
   The only way to spend a steal is one of these buttons, and they are not .btn, so the app's own coarse block
   never reached them either. */
@media (pointer:coarse){
  .vs-rosters .vs-grab{min-height:44px;position:relative;z-index:1}
  .vs-them .vs-grab{min-height:44px}
  .vs-them .vs-grab .sub{display:block;font-size:11px}
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
    blurb: "Take any player off their roster.",
    detail: "On your turn, tap anyone on their roster and he is yours. You spend your pick doing it, and they get that pick instead - so they lose the player, not the turn. A player can only change hands once.",
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
    // Escape is useCloseOnBack's, above - one register, so only the dialog on top answers.
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div ref={dialog} className="modal" role="dialog" aria-modal="true" aria-labelledby="vs-howto-title" tabIndex={-1}
        onKeyDown={(e) => keepFocusInside(e, dialog.current)} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-x" aria-label="Close" onClick={onClose}>×</button>
        <h2 id="vs-howto-title">How duels work</h2>
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
// "powerups used" to keep in step with anything, only the respins and dips that already exist.
export function powerupsFor(match, side) {
  const respins = respinsLeft(match.respins || [], side);
  return {
    team: respins.team, era: respins.era,
    dip: dipsLeft(match.dips || [], side),
    steal: stealsLeft(match.steals || [], side),
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
// Each one carries three things, because the announcement and the announcement's words are different jobs:
//   title   the powerup, in one or two words, at the size of the screen - what you read without reading
//   detail  who did it and to whom, underneath
//   text    the whole thing as a sentence, for the live region: a screen reader wants "ShrimpCity stole Tiki
//           Barber", not a headline and a caption read as two unrelated fragments
// `tone` tints the overlay, so the three powerups don't all land as the same wash of dark.
// `side` is the VIEWER's, and it is what makes the turn announcement per-screen: a powerup is a fact about the
// match and both players see the same one, but "your pick" is true for exactly one of them.
export function latestEvent(match, state, nameOf, side = null) {
  if (!match || !state) return null;
  const out = [];
  // Your turn, announced the way a powerup is - it was the quietest change on the screen and the one that most
  // needs noticing, because a turn you have not noticed is a turn the clock is spending for you.
  //
  // Ordered just BEFORE any powerup spent on the same pick (`* 4 - 1` against their `* 4`), which is what keeps
  // the two from fighting: the turn arrives, then whatever is spent during it announces itself over the top.
  // The other order would have made your own re-spin silent, because the turn event would still be the newest
  // thing and useFlash never repeats a key.
  if (side && state.turn && !state.done) {
    if (state.turn.side === side) {
      out.push({ at: state.pickNo * 4 - 1, key: `turn:${state.pickNo}`, icon: "🎯", tone: "turn", brief: true,
        title: "Your pick", detail: `Board ${state.boardIdx + 1} of ${MATCH_BOARDS}`, text: "Your pick" });
    }
  }
  for (const r of match.respins || []) {
    const era = r.kind === "era";
    const pu = POWERUPS.find((x) => x.id === (era ? "era" : "team"));
    out.push({ at: r.pickNo * 4, key: `respin:${r.pickNo}:${r.kind}`, icon: pu.icon, tone: "spin",
      title: "Re-spin", detail: `${nameOf(r.by)} — a new ${era ? "era" : "team"}`,
      text: `${nameOf(r.by)} re-spun the ${era ? "era" : "team"}` });
  }
  for (const d of match.dips || []) {
    // The turn it was declared on when the record has one. Ordered by BOARD it was outranked by any re-spin
    // or steal on the same board, so the dip announcement simply never appeared in those orders.
    out.push({ at: (d.at != null ? d.at : d.boardIdx * 2 + 1) * 4 + 1, key: `dip:${d.boardIdx}:${d.by}`, icon: "⚡", tone: "dip",
      title: "Double dip", detail: `${nameOf(d.by)} takes two off this board`,
      text: `${nameOf(d.by)} doubled up — two off this board, and no pick on the next` });
  }
  for (const x of match.steals || []) {
    const taken = state.roster[x.by]?.[x.slot];
    const who = taken ? optionName(taken) : "a player";
    out.push({ at: x.at * 4 + 2, key: `steal:${x.at}`, icon: "😈", tone: "steal",
      title: "Stolen", detail: `${nameOf(x.by)} took ${who}`, text: `${nameOf(x.by)} stole ${who}` });
  }
  if (!out.length) return null;
  return out.sort((a, b) => a.at - b.at)[out.length - 1];
}

// Shows the newest event for a few seconds, then lets it go. Keyed on the event, so the same one never
// re-announces itself when the match is re-read - which it is, every two seconds.
// Held exactly as long as the overlay's animation runs. It was five seconds when this was a small line above
// the board, which is far too long for something covering the screen - and it has to be the same number as the
// CSS, or the overlay either vanishes mid-animation or sits there finished.
const FLASH_MS = 2400;
// Your turn comes round eight times a match and a powerup twice at most, so the turn gets a shorter one: the
// same language, half the time, over a board you are trying to read. Has to match the CSS, like FLASH_MS.
const TURN_FLASH_MS = 1200;
// EVERY key it has shown, not just the last one. Holding only the last was enough while powerups were the only
// events - the newest was always the newest powerup, so it stayed matched. Turn announcements interleave with
// them, and then the newest event oscillates: your turn, a re-spin during it, your turn again, and on a turn
// that is not yours it falls back to the last powerup, whose key no longer matches - so an announcement from
// two picks ago played again, on somebody else's turn, looking like it had arrived late. A match has at most
// sixteen turns and six powerups, so remembering all of them costs nothing.
export function useFlash(event) {
  const [shown, setShown] = useState(null);
  const seen = useRef(new Set());
  useEffect(() => {
    if (!event || seen.current.has(event.key)) return undefined;
    seen.current.add(event.key);
    setShown(event);
    const t = setTimeout(() => setShown(null), event.brief ? TURN_FLASH_MS : FLASH_MS);
    return () => clearTimeout(t);
  }, [event?.key]);
  return shown;
}

// Your roster, as the draft screen shows one: a strip of slots with who is in them.
//
// `onSteal(slot)` turns the filled slots into buttons, which is how a steal picks its target - the powerup
// takes any one player off the other roster, so the roster itself has to be the thing you tap. Passed only
// while a steal is actually being spent, so the strip is a display the rest of the time.
function RosterStrip({ roster, label, sub, them, onSteal, busy }) {
  return (
    <div className={`vs-side ${them ? "vs-them" : ""} ${onSteal ? "vs-picking" : ""}`}>
      <p className="vs-side-hd">{label}{sub ? <span className="vs-sub"> {sub}</span> : null}</p>
      <div className="roster" data-side={label}>
        {VERSUS_SLOTS.map((slot) => {
          const o = roster[slot];
          if (o && onSteal) {
            return (
              <button key={slot} type="button" disabled={busy}
                      className={`slot filled pos-${slot.startsWith("FLEX") ? "FLEX" : slot} vs-grab`}
                      data-slot={slot} data-filled="1" onClick={() => onSteal(slot)}>
                <span className="vh">{`Steal ${optionName(o)} from their ${POS_NAME[slot.startsWith("FLEX") ? "FLEX" : slot] || VS_SLOT_LABEL[slot]}`}</span>
                <div className="k" aria-hidden="true">{VS_SLOT_LABEL[slot]}</div>
                <div className="v" aria-hidden="true">{optionName(o)}</div>
                <div className="sub" aria-hidden="true">Take him</div>
              </button>
            );
          }
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
  // Which finished sections a player has asked to see again, exactly as the single-player draft keeps it.
  const [showDone, setShowDone] = useState({});
  return (
    <>
      <div className="reel" aria-live="polite" style={teamVars(team)}>
        <div className="stripe" style={{ background: TEAMS[team][2] }} />
        {/* The clock sits IN this row, not floated over the card. Absolutely positioned it had no idea what was
            underneath it, so the two overlapped and the line was clipped. A flex item cannot collide with its
            own siblings at any width.
            It used to share the row with "N left on the board", which is why that rule exists. The count is
            gone: it was the first thing to be squeezed at every width, and it truncated to "30 left on the b..."
            beside a long opponent name even on a full-size phone - and the board underneath already lists every
            option there is, so it was saying twice, badly, what the screen says once.
            role="timer" rather than a bare aria-label on a div, which isn't reliably exposed - and it carries
            aria-live="off", which is the point: the reel around it is a polite live region, so a per-second
            countdown inside it had a screen reader re-reading the whole board every second, for forty-five
            seconds a turn and sixteen turns a match. Read on demand, not announced. */}
        <div className="pickno">
          <span>{turnLabel}</span>
          <span className="vs-pnr">
            {seconds != null ? (
              <span className={`vs-reelclock ${seconds <= 10 ? "low" : ""}`}
                    role="timer" aria-live="off" aria-label={`${seconds} seconds left in this turn`}>
                {seconds}<span className="vs-s">s</span>
              </span>
            ) : null}
          </span>
        </div>
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
  const [sent, setSent] = useState(null);   // what the last invite actually did, or null
  // The option a player has tapped but not locked in, exactly as the single-player draft holds one.
  const [selected, setSelected] = useState(null);
  // Which pick the clock has already been claimed for, and how many times - so a refusal backs off instead of
  // asking again every 300ms. `claimAgain` is what re-arms the effect, since `match` is deliberately not a dep.
  const claim = useRef({ at: null, tries: 0 });
  const [claimAgain, setClaimAgain] = useState(0);
  // How many times this screen has asked the server to finish a match whose picks are all in - see the effect
  // below. Enough of them and the screen says so instead of spinning quietly forever.
  const [finishTries, setFinishTries] = useState(0);
  // Whether the Realtime socket has actually confirmed itself. False until it says SUBSCRIBED, and false again
  // the moment it errors or closes - which is what decides how hard the poll below has to work.
  const [live, setLive] = useState(false);
  // Armed by the Steal button: their roster becomes the thing you tap, because a steal now takes any one of
  // their players rather than whatever was picked last.
  const [stealing, setStealing] = useState(false);
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
    setLive(false); // until this socket says otherwise; a new match is a new subscription
    const sub = subscribeMatch(match.id, () => refresh(match.code), setLive);
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

  // All three powerup records, or the screen replays a different match from the one the server holds: a
  // missing `steals` had the victim of a steal told it was not their turn while the thief was told it still
  // was, so neither could move until the clock ran out.
  const state = useMemo(() => (match && match.status !== "open" ? replayMatch({
    code: match.code, picks: match.picks, respins: match.respins, dips: match.dips, steals: match.steals,
  }) : null), [match]);

  const side = match ? (match.hostId === userId ? "host" : match.guestId === userId ? "guest" : null) : null;
  const myTurn = !!state && !state.done && state.turn.side === side;
  const left = useCountdown(match?.status === "drafting" && !state?.done ? match.turnDeadline : null);
  // ...and a slow read behind it, because a draft that only moves when a socket delivers is a draft that
  // stops. Realtime can be off in a project, blocked by a network, or simply drop, and the first time anyone
  // notices is a player sitting on a finished turn waiting out a clock they cannot affect.
  //
  // The whole match, including your own turn. It skipped your turn at first, on the reasoning that your own
  // moves refresh the screen themselves - but the other player can act DURING your turn: they can steal the
  // pick you just made, which happens while you are on the clock. A client that stops reading whenever it
  // believes it is their turn would never learn it had stopped being. A lobby reads too, or a host whose
  // Realtime is not delivering never learns that anybody joined - which is the very first thing that has to work.
  //
  // How often depends on whether the socket is actually delivering. Confirmed, this is a backstop and two
  // seconds is plenty. Not confirmed, it is the ONLY thing moving the match on, and two seconds is exactly the
  // lag a player feels waiting for an opponent's pick to appear - so it drops to 700ms and the match keeps up.
  // Self-correcting on purpose: a Realtime that breaks in production costs responsiveness, never correctness.
  useEffect(() => {
    if (!match?.code || match.status === "done" || match.status === "abandoned") return undefined;
    const t = setInterval(() => refresh(match.code), live ? 2000 : 700);
    return () => clearInterval(t);
  }, [match?.code, match?.status, refresh, live]);

  // Every hook above every early return: what each player still holds, and the one-line announcement of
  // whatever just happened.
  const mine = state && side ? powerupsFor(match, side) : null;
  const theirs = state && side ? powerupsFor(match, side === "host" ? "guest" : "host") : null;
  const flash = useFlash(latestEvent(match, state, (s) => name(match, s), side));
  // Armed, and still your turn. The effect below clears `stealing` when the turn moves, but an effect runs
  // after the frame it is reacting to: for that one frame their roster still said "Take one of theirs" and
  // its slots were still buttons. Read through `myTurn` at render time there is no such frame.
  const arming = stealing && myTurn;
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
    // after the turn moved - pressing one only ever earned a refusal from the server. An armed steal goes too:
    // their roster must not stay tappable once it is not your turn.
    setSelected(null);
    setStealing(false);
  }, [atPick]);
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

  // Sixteen picks in and the row still says `drafting`: the server's grade, or the write recording it, did not
  // go through. Somebody has to ask again, and it is this screen - the poll only READS, so before this nothing
  // ever poked the server and both players sat on "Working out the result..." until one of them gave up. The
  // match is not lost: any request now finishes it, because match-pick tries to finish before it does anything
  // else. Either screen asking is enough and both asking is harmless - finish_match is idempotent and tells the
  // second caller the first one got there.
  //
  // Backed off the way the clock claim is, and counted, because a match that cannot be graded at all must not
  // become a loop: the server ends such a match itself, and the count is what lets the screen say so if it
  // somehow does not.
  useEffect(() => {
    if (!match?.code || match.status !== "drafting" || !state?.done || finishTries > 5) return undefined;
    const code = match.code;
    const t = setTimeout(async () => {
      // No move at all, deliberately: the request exists to be received. match-pick finishes a
      // match whose picks are all in before it looks at what was asked for.
      await playMove({ code });
      setFinishTries((n) => n + 1);
      await refresh(code);
    }, finishTries === 0 ? 400 : 2000);
    return () => clearTimeout(t);
  }, [match?.code, match?.status, state?.done, finishTries, refresh]);

  const send = async (move) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await playMove({ code: match.code, ...move });
    setBusy(false);
    if (!res.ok) setError(res.reason);
    await refresh(match.code);
  };

  // A steal names the pick that put the player on their roster, which is the one thing the screen has to work
  // out for itself: `state.roster` holds options, and the server thinks in pick numbers.
  const grab = async (slot) => {
    const them = side === "host" ? "guest" : "host";
    const option = state?.roster[them]?.[slot];
    const row = option && (match.picks || []).find((p) => pickId(p) === optionId(option));
    setStealing(false);
    if (!row) { setError("nothing_to_steal"); return; }
    await send({ steal: true, pickNo: row.pickNo });
  };

  if (!userId) {
    return (
      <section className="versus" data-view="signedout">
        <h2 className="h">Duel</h2>
        <p className="note">Sign in to duel someone. A duel goes on its own board, so it needs an account on both sides.</p>
        <button className="btn" onClick={onBack}>Back</button>
      </section>
    );
  }

  // The site's own address first, the way every other share path builds one. Read off `location.origin` this
  // was `https://localhost/vs/ABC123` inside the Android app, whose web view is served from localhost - and the
  // lobby link is the whole of matchmaking, so there was no other way to hand somebody a code from the app.
  // The share card two hundred lines down already did this correctly with the same `siteUrl`.
  const origin = siteUrl || (typeof location !== "undefined" ? location.origin : "");
  const linkFor = (c) => (origin ? `${origin}${versusPath(c)}` : versusPath(c));

  // One send, from either screen. onShare is the app's one share path and the one place that knows a closed
  // share sheet must say nothing at all. Rendered without it, the clipboard directly, so the button is never
  // dead. Says only what actually happened, and goes back to itself after a moment - the old Copy link latched
  // on for the rest of the session, and said "Copied" even when the clipboard had refused.
  const sendInvite = async (m) => {
    const text = versusInviteText(m, linkFor(m.code));
    const how = onShare ? await onShare(text) : (await copy(text)) ? "copied" : "manual";
    if (!how || how === "cancelled") return how;
    setSent(how);
    window.setTimeout(() => setSent(null), 2500);
    return how;
  };

  if (!match) {
    return (
      <section className="versus" data-view="lobby">
        {showRules ? <VersusHowTo onClose={closeRules} /> : null}
        <h2 className="h">Duel</h2>
        <p className="note">
          Open a lobby and invite somebody. You and whoever takes it draft from the same eight boards — six players,
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

  const link = linkFor(match.code);
  const hostName = match.hostName || "Host";
  const guestName = match.guestName || "…";

  if (match.status === "open") {
    return (
      <section className="versus" data-view="lobby" data-code={match.code}>
        {showRules ? <VersusHowTo onClose={closeRules} /> : null}
        <h2 className="h">Your lobby</h2>
        <div className="vs-link">
          <code>{link}</code>
          {/* The whole of matchmaking is getting this link to one person, so the button hands the phone's share
              sheet a written invitation rather than putting an address on the clipboard - a duel starts in a
              text, not in a paste. On a computer there is no sheet, so it copies the same message; the link is
              on screen above either way.
              Says what actually happened and goes back to itself. It used to latch on for the rest of the
              session, and said "Copied" even when the clipboard had refused. */}
          <button className="btn sm" onClick={() => sendInvite(match)}>{INVITE_SAID[sent] || "Invite a friend"}</button>
        </div>
        <p className="vs-wait"><span className="vs-dot" /> Waiting for an opponent…</p>
        <p className="vs-note">The first person to open the link is your opponent. Keep this page open.</p>
        {sent === "manual" ? <p className="vs-note">Couldn't share it — copy the link above instead.</p> : null}
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
  // A match somebody ended by hand (the runbook's `status = 'abandoned'`) fell through to the draft view: a
  // board with no clock, cards that looked pickable, and every click refused by the server. The poll correctly
  // stops on this status, which only made it look more frozen.
  if (match.status === "abandoned") {
    return (
      <section className="versus" data-view="abandoned" data-code={match.code}>
        <h2 className="h">Match ended</h2>
        <p className="vs-note">This match was ended before it finished, so there's no result. Nothing was recorded for either player.</p>
        <button className="btn" onClick={onBack}>Back</button>
      </section>
    );
  }

  if (state?.done && match.status !== "done") {
    return (
      <section className="versus" data-view="grading" data-code={match.code}>
        <h2 className="h">That's sixteen</h2>
        {/* Asked for, not waited on: the effect above tells the server to finish, which is what it took to stop
            this screen being where a duel went to die. After six tries something is wrong that asking again
            will not fix, so it says so and offers the way out rather than spinning quietly. */}
        <p className="vs-note">{finishTries > 5 ? "This one's taking longer than it should. Your picks are saved - come back in a moment." : "Working out the result…"}</p>
        {finishTries > 5 && <button className="btn" onClick={onBack}>Back</button>}
      </section>
    );
  }

  if (match.status === "done" && result) {
    const mine = side || "host";
    const theirs = mine === "host" ? "guest" : "host";
    const won = result.winner === mine;
    const tied = result.winner === null;
    // Winner first, always - the way a football score is written, and the way the FINALS table stores the real
    // ones it is drawn from. Shown your-side-first it came out reversed for whoever lost, so the commonest
    // scoreline in football turned into "20-23", which is a scoreline nobody writes.
    const hi = tied ? mine : result.winner;
    const lo = hi === "host" ? "guest" : "host";
    return (
      <section className="versus" data-view="done" data-code={match.code}>
        <h2 className="h">{tied ? "A tie" : won ? "You win" : "You lose"}</h2>
        <div className="vs-final">
          {won && <Confetti n={24} />}
          <div className="vs-score">{result[hi].points}–{result[lo].points}</div>
          {/* Who beat whom, in names rather than sides - the heading says how it went for you, this says what
              happened. Both, because the scoreline alone doesn't say which number was yours. */}
          <p className="vs-beat">
            {tied ? `${name(match, mine)} and ${name(match, theirs)} tied` : `${name(match, hi)} beat ${name(match, lo)}`}
          </p>
          {/* The roster scores are NOT repeated here. Each one is already the subtitle on its own roster strip
              below, which is where it belongs - attached to the eight picks that earned it. Said twice, and
              directly under the football final, it read as a second competing scoreline rather than as the
              working behind the first. One score on this screen; the numbers behind it sit with the rosters. */}
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
      <h2 className="vh">Duel — board {Math.min(state.boardIdx + 1, MATCH_BOARDS)} of {MATCH_BOARDS}</h2>
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
      {/* A powerup is the loudest thing that happens in a duel, so it takes the whole screen for a moment
          rather than a line above the board that is easy to miss entirely. Announced separately and once, in a
          live region, because the overlay itself is decoration - a screen reader should hear "ShrimpCity stole
          Tom Brady", not a description of an animation. */}
      <p className="vh" aria-live="polite">{flash ? flash.text : ""}</p>
      {flash ? (
        <div className={`vs-boom tone-${flash.tone} ${flash.brief ? "is-brief" : ""}`} key={flash.key} aria-hidden="true">
          <div className="vs-boom-in">
            <span className="vs-boom-icon">{flash.icon}</span>
            <p className="vs-boom-title">{flash.title}</p>
            <p className="vs-boom-who">{flash.detail}</p>
          </div>
        </div>
      ) : null}

      {/* Above the board, where the single-player draft keeps its roster strip: what you still have open is
          the thing you are reading the board against, so it has to be on screen while you choose - not eight
          sections further down. */}
      <div className="vs-rosters">
        <div>
          <RosterStrip roster={state.roster[side || "host"]} label="Your roster" />
          {mine ? <PowerupTrack left={mine} label="You" /> : null}
        </div>
        <div>
          {/* While a steal is being spent, their filled slots are the buttons - the powerup takes any one of
              their players, so the roster is what you aim it at. */}
          <RosterStrip them roster={state.roster[side === "host" ? "guest" : "host"]}
            label={arming ? "Take one of theirs" : `${name(match, side === "host" ? "guest" : "host")}'s roster`}
            onSteal={arming ? grab : null} busy={busy} />
          {theirs ? <PowerupTrack left={theirs} label={name(match, side === "host" ? "guest" : "host")} /> : null}
          {arming ? (
            <p className="vs-note vs-grabnote">
              Tap whoever you want. <button className="linkbtn" onClick={() => setStealing(false)}>Cancel</button>
            </p>
          ) : null}
        </div>
      </div>

      <div ref={sentinel} aria-hidden="true" />

      {state.boardKey ? (
        <Board
          key={state.boardKey}
          boardKey={state.boardKey} taken={state.taken} roster={state.roster[side || "host"]}
          myTurn={myTurn} busy={busy} selected={selected} setSelected={setSelected}
          turnLabel={myTurn ? "Your pick" : `${name(match, state.turn.side)} is picking`} seconds={left}
          controls={side ? (
            <div className="rerolls vs-powers">
              {POWERUPS.map((pu) => {
                const n = mine[pu.id];
                const wrongTurn = !myTurn;
                const illegal = (pu.id === "dip" && state.boardIdx >= MATCH_BOARDS - 1)
                  || (pu.id === "steal" && !VERSUS_SLOTS.some((sl) => state.roster[side === "host" ? "guest" : "host"][sl]));
                return (
                  <button key={pu.id} className="btn vs-pu" disabled={busy || n < 1 || illegal || wrongTurn}
                    title={`${pu.blurb} ${n} left.`}
                    aria-label={`${pu.label}. ${pu.blurb} ${n} left.`}
                    onClick={() => (pu.id === "steal"
                      ? setStealing((on) => !on)
                      : send(pu.id === "team" ? { respin: "team" } : pu.id === "era" ? { respin: "era" } : { [pu.id]: true }))}>
                    <span className="vs-pi" aria-hidden="true">{pu.icon}</span>
                    <span className="rs-long">{pu.label} <span className="left">({n})</span></span>
                    <span className="rs-short" aria-hidden="true">{pu.short} <b>{n}</b></span>
                  </button>
                );
              })}
              {/* Named here because every span inside is either aria-hidden or display:none on a phone, which
                  left the button with no accessible name at all below 480px - the same pattern the draft's
                  re-spin buttons already carry an aria-label for. */}
              <button className="btn linkish vs-pu-help" aria-label="How duels work" onClick={() => setShowRules(true)}>
                <span className="vs-pi" aria-hidden="true">?</span>
                <span className="rs-long">How duels work</span>
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
// The invite a host sends, so the lobby hands over a message rather than an address. A bare link in somebody's
// texts says neither who sent it nor what it is, and the first person to open this one becomes the opponent -
// so it has to read like an invitation and be worth opening. Same shape as every other card the game sends:
// what it is, one line of what happens, the link last.
//
// Nothing here has to be withheld, which is the one way it differs from a season card: the code IS the
// invitation, the boards are dealt from it for both players, and neither has seen them yet.
export function versusInviteText(match, link) {
  if (!link) return "";
  // `name()` would say "Host", which is nobody. A lobby is only reachable signed in, so the name is there -
  // but a share that reads "Host invited you" is worse than one that doesn't name anybody.
  const host = match?.hostName || "";
  return [
    host ? `${host} invited you to a duel on Gridspin 🏈` : "You're invited to a duel on Gridspin 🏈",
    "Same boards, one pick each. Better roster wins.",
    link,
  ].join("\n");
}

export function versusShareText(match, result, side, siteUrl) {
  if (!result) return "";
  const mine = side === "guest" ? "guest" : "host";
  const theirs = mine === "host" ? "guest" : "host";
  const them = name(match, theirs);
  const head = result.winner === null ? "Tied" : result.winner === mine ? `Beat ${them}` : `Lost to ${them}`;
  // Winner first, as on the screen and as a football score is written. Your-side-first turned the commonest
  // scoreline in the game into "20-23" every time you lost.
  const hi = result.winner === null ? mine : result.winner;
  const lo = hi === "host" ? "guest" : "host";
  const lines = [
    `Gridspin Duel ${result.winner === null ? "🤝" : result.winner === mine ? "🏆" : "💀"} ${head} ${result[hi].points}–${result[lo].points}`,
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
// What the invite button says once it has been pressed. Only ever what happened: a closed share sheet is
// not a send, and it keeps the button where it was.
const INVITE_SAID = { shared: "Invite sent", copied: "Copied", manual: "Couldn't share" };
const signed = (n) => `${n > 0 ? "+" : ""}${n}`;
// Resolves to whether it actually landed. writeText REJECTS on a denied permission rather than throwing, so the
// try/catch alone caught nothing and the button said "Copied" over a clipboard that had not changed - and left
// an unhandled rejection behind it.
async function copy(text) {
  try {
    await navigator.clipboard?.writeText(text);
    return true;
  } catch (e) {
    return false; // a browser that won't, or a permission refused; the link is on screen either way
  }
}

// A refusal in words. Every one of these is a reason from VERSUS.md 4 and 7 - the screen never invents one.
const ERRORS = {
  guest_not_allowed: "A duel needs an account on both sides — a guest can't play one.",
  not_found: "That match doesn't exist.",
  already_full: "That match already has two players.",
  // A duel that ended before you opened its link. Two answers rather than one, because "it already has two
  // players" is true of a draft in progress and simply misleading about a match that is over or was called
  // off - and a lobby the host closed without anybody taking it never started at all.
  match_abandoned: "That duel was called off.",
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
  would_strand: "You can't take him — it would leave this board with nothing for somebody to pick.",
  stolen_this_turn: "A steal has already been spent on this turn.",
  one_at_a_time: "One powerup a turn — you've already re-spun this board.",
  nothing_to_steal: "They don't have that player.",
  already_stolen: "That player has already changed hands once — he can't be taken again.",
  already_dipped: "Somebody has already doubled up on this board.",
  respin_too_late: "A re-spin goes before your first pick on a board.",
  conflict: "That pick just went — try again.",
  // The server's own answers. Without these a player was told "That didn't work" for a match that had ended,
  // a session that had expired, and for both of the 500s - which are the two worth telling apart, because one
  // of them means the match needs help rather than another try.
  not_your_match: "You're not in this match.",
  already_finished: "This match is over.",
  too_early: "The clock hasn't run out yet.",
  no_option: "Something has gone wrong with this board — the match may need to be abandoned.",
  "failed to save": "The server couldn't save that. Try again.",
  // The read that failed, not the match that is missing. Unmapped it rendered "That didn't work." - the
  // generic line the server's careful wording exists to replace, and the opposite of what it means: the match
  // is fine, only this request's read of it was not.
  "could not read the match": "Couldn't read the match just then. Try again.",
  unplayable: "This match can't be worked out, so it's been ended. Nothing was recorded for either player.",
  "failed to grade": "The server couldn't work out the result. The match may need to be abandoned.",
  // playMove reads `reason` before `error`, so this is the one the screen actually sees for that 500.
  grading: "The server couldn't work out the result. The match may need to be abandoned.",
  unauthorized: "Sign in to play.",
  signed_out: "Sign in to play.",
  network: "Couldn't reach the server. Try again.",
};
export const errorText = (reason) => ERRORS[reason] || "That didn't work.";
