// Display helpers shared by the main app (perfect-season.jsx) and the screens that live in their own
// files (profile.jsx, moderation.jsx, ...). Moved here out of perfect-season.jsx so those files don't
// have to import the main component module back - everything below is a plain function, constant or
// stateless component, with no app state, apart from the register of open dialogs at the bottom.
import { useEffect, useMemo, useRef } from "react";
import { TEAMS, BEST_FIELDS, normFormat, WINDOWS, passerRating } from "./game-logic.mjs";
import { PALETTE } from "./theme.mjs";

export const SLOT_LABEL = { QB: "QB", RB: "RB", WR: "WR", TE: "TE", FLEX1: "Flex", FLEX2: "Flex" };
export const FORMAT_LABEL = { fantasy: "Fantasy", standard: "Championship" };
export const LADDER_LABEL = { daily: "Daily", unlimited: "Unlimited", genius: "Genius", gm: "GM" };

// A team's two colors as CSS variables, for anything drawn in team colors.
export const teamVars = (code) => ({ "--tc1": TEAMS[code][2], "--tc2": TEAMS[code][3] });
export const gradeTier = (r) => (r >= 95 ? "ga" : r >= 80 ? "gb" : r >= 56 ? "gc" : "gd");
export function grade(r) {
  const t = [[120, "A+"], [105, "A"], [95, "A−"], [88, "B+"], [80, "B"], [72, "B−"], [64, "C+"], [56, "C"], [48, "C−"], [40, "D"]];
  for (const [v, g] of t) if (r >= v) return g;
  return "F";
}

export function cityFor(code, year) {
  if (code === "LA") return year <= 2015 ? "St. Louis" : "Los Angeles";
  if (code === "LAC") return year <= 2016 ? "San Diego" : "Los Angeles";
  if (code === "LV") return year <= 2019 ? "Oakland" : "Las Vegas";
  return TEAMS[code][1];
}
export function teamLabel(code, year) {
  const c = cityFor(code, year);
  return c ? `${c} ${TEAMS[code][0]}` : TEAMS[code][0];
}

export const shortYr = (y) => `'${String(y).slice(2)}`;
export const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
// An outcome as the end of a sentence. Stored outcomes can't change, and the perfect one already ends
// in a period and repeats the record the sentence has just given.
export const outcomeSentence = (o) => (!o ? "" : o === "Perfect season. 20–0." ? "Perfect season." : `${o}.`);

export const draftsOf = (s) => (s.runs || 0) + (s.dnf || 0);
// Scores from the two formats live in different profile fields and never rank against each other.
export const scoreOf = (p, format) => (p ? p[BEST_FIELDS[normFormat(format)].score] ?? null : null);
export const runOf = (p, format) => (p ? p[BEST_FIELDS[normFormat(format)].run] ?? null : null);

// A player's stat columns, and the two headings the draft board is built from. These live here rather than in
// perfect-season.jsx because 1v1 draws the same board (VERSUS.md 9) and a screen never imports the main
// component back - a second copy of these would be a second answer to "what does a card show".
//
// Every player at a position shows the same stat columns, in the same order: main-role yards, TDs, per-attempt
// average, then volume, then the secondary role, then fumbles.
export const POS_NAME = { QB: "Quarterbacks", RB: "Running backs", WR: "Wide receivers", TE: "Tight ends" };

export function cityRange(code, w) {
  const [a, b] = WINDOWS[w];
  const c1 = cityFor(code, a), c2 = cityFor(code, b);
  return c1 === c2 ? c1 : `${c1} & ${c2}`;
}

export function statCells(p) {
  const n = (v) => v.toLocaleString();
  const ypc = p.car ? (p.ry / p.car).toFixed(1) : "–";
  const ypr = p.rec ? (p.rcy / p.rec).toFixed(1) : "–";
  if (p.pos === "QB") return [
    [n(p.py), "Pass yds"], [p.ptd, "Pass TD"], [p.int, "INT"],
    [p.att ? ((100 * p.cmp) / p.att).toFixed(1) + "%" : "–", "Comp %"], [p.att ? passerRating(p).toFixed(1) : "–", "QB rating"],
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"],
  ];
  if (p.pos === "TE") return [
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [ypr, "Yds/rec"], [p.rec, "Rec"], [p.fl, "Fum lost"],
  ];
  if (p.pos === "WR") return [
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [ypr, "Yds/rec"], [p.rec, "Rec"],
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"], [p.fl, "Fum lost"],
  ];
  return [
    [n(p.ry), "Rush yds"], [p.rtd, "Rush TD"], [ypc, "Yds/carry"], [p.rec, "Rec"],
    [n(p.rcy), "Rec yds"], [p.rctd, "Rec TD"], [p.fl, "Fum lost"],
  ];
}

export function RosterRows({ roster }) {
  return (
    <div className="reveal">
      {roster.map((p) => (
        <div className={`rv pos-${p.slot.startsWith("FLEX") ? "FLEX" : p.slot}`} key={p.slot}>
          <div className="s">{SLOT_LABEL[p.slot]}</div>
          <div><div className="p">{p.name}</div><div className="t">{p.season} {teamLabel(p.team, p.season)}</div></div>
          <div className="pts">{p.ppr.toFixed(1)}<small>PPR pts</small></div>
          <div className={`gr ${gradeTier(p.rating)}`}>{grade(p.rating)}</div>
        </div>
      ))}
    </div>
  );
}

// A drafted-roster summary as small position-colored chips (reusing the same chip/pos-${slot}
// coloring the in-draft sticky bar uses) instead of one long comma-joined line of names - used
// anywhere a saved roster gets shown back compactly (the sitewide/hall-of-fame best-lineup cards).
export function RosterChips({ roster }) {
  return (
    <div className="chips" style={{ flexWrap: "wrap", marginTop: 6 }}>
      {roster.map((p, i) => {
        const slot = (p.slot || "").startsWith("FLEX") ? "FLEX" : p.slot || "";
        return (
          // The slot is written, not only coloured: the colours alone say nothing to a player who can't tell
          // them apart, and which slot a name filled is the whole point of the chip.
          <span key={i} className={`chip on pos-${slot}`}>
            <b className="chip-slot">{SLOT_LABEL[p.slot] || slot}</b> {p.name} · {shortYr(p.season)}
          </span>
        );
      })}
    </div>
  );
}

// Tab stays inside a dialog while one is open: at the last control it comes back to the first, and at the
// first with Shift it goes to the last. Without it Tab walks out into the page behind, which a screen reader
// then reads as though the dialog weren't there at all. Pass the dialog's own element.
export function keepFocusInside(e, container) {
  if (e.key !== "Tab" || !container) return;
  const focusable = [...container.querySelectorAll(
    "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
  )];
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first) return;
  const active = container.ownerDocument?.activeElement;
  if (e.shiftKey && (active === first || active === container)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

// ---------- Closing what is open over a screen ----------
// Anything that opens over a screen says here what closing it means, for as long as it is open. Escape and
// Android's Back both close the one on TOP, and only once nothing is open does Back leave the screen
// (perfect-season.jsx's Back handler). Dialogs mount in the order they open, so the last registered is the
// one on top.
//
// Escape lives here too, rather than in each dialog. Three of them used to add their own window listener,
// which meant every one of them fired on every press: a first-run device landing on a profile has the rules
// up, and tapping Report put the sheet over them - then one Escape closed both, the sheet the player meant
// and the rules underneath they had not read yet. Back already got this right; only Escape didn't, because
// it never read this register.
const openDialogs = [];
export function useCloseOnBack(onClose) {
  // The latest onClose: registered once, but never left holding a stale close.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = { close };
    openDialogs.push(dialog);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // Only the topmost answers, whichever dialog's listener this happens to be.
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      e.stopPropagation();
      close.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      const i = openDialogs.indexOf(dialog);
      if (i >= 0) openDialogs.splice(i, 1);
    };
  }, []);
}
// Closes the dialog on top of the screen, if there is one. True when one closed.
export function closeTopDialog() {
  const top = openDialogs[openDialogs.length - 1];
  if (!top) return false;
  top.close.current?.();
  return true;
}

// The celebration confetti, shared by the season result, Build-a-player and a won duel. Lives here rather than
// in perfect-season.jsx because versus.jsx needs it too and cannot import the main component back. Purely
// decorative, so aria-hidden; the whole thing is display:none under prefers-reduced-motion. It needs a
// position:relative parent to fall inside - .cel and .vs-final both provide one.
export function Confetti({ n = 26 }) {
  const bits = useMemo(() => Array.from({ length: n }, (_, i) => ({
    left: `${(i * 97) % 100}%`, delay: `${(i % 9) * 0.12}s`,
    bg: [PALETTE.lime, PALETTE.blue, PALETTE.orange, PALETTE.violet, PALETTE.cream][i % 5],
    dur: `${2.2 + ((i * 7) % 9) / 10}s`,
  })), [n]);
  return (
    <div className="confetti" aria-hidden="true">
      {bits.map((b, i) => <i key={i} style={{ left: b.left, background: b.bg, animationDelay: b.delay, animationDuration: b.dur }} />)}
    </div>
  );
}
