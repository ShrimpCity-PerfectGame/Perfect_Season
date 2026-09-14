// Display helpers shared by the main app (perfect-season.jsx) and the screens that live in their own
// files (profile.jsx, moderation.jsx, ...). Moved here out of perfect-season.jsx so those files don't
// have to import the main component module back - everything below is a plain function, constant or
// stateless component, with no app state.
import { TEAMS, BEST_FIELDS, normFormat } from "./game-logic.mjs";

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
      {roster.map((p, i) => (
        <span key={i} className={`chip on pos-${(p.slot || "").startsWith("FLEX") ? "FLEX" : p.slot || ""}`}>
          {p.name} · {shortYr(p.season)}
        </span>
      ))}
    </div>
  );
}
