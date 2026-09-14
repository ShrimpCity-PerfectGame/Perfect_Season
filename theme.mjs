// The design tokens, as data. perfect-season.jsx turns these into CSS custom properties, and
// tests/test-theme-contrast.mjs reads the same object to prove every text color stays readable -
// so the palette can't quietly regress into something illegible.
//
// Three scopes:
//   light - the cream default for home, profile, stats, auth.
//   dark  - the navy "scoreboard" treatment for the draft/play screen, the season result and the
//           other always-dark components, applied by the `.dark` class.
//   night - true black for the Leaderboard, the one screen that is all about ranking. A step darker
//           than the navy, with lime saved for whoever is on top. Applied by the `.night` class.
//
// THE ONE RULE: `accent` (electric lime) is a FILL. It sits behind `onAccent` text and is never used
// as a text or line color on cream - lime on cream is ~1.2:1, effectively invisible. Anything that
// needs an accent-colored word or underline uses `accentInk`, which is game blue in the light scope
// and lime only in the dark scope, where lime text reads well.

export const PALETTE = {
  ink: "#101114",
  cream: "#F7F4EA",
  lime: "#B8F500",
  blue: "#3155FF",
  orange: "#FF7043",
  violet: "#8B5CF6",
  gray: "#E8E7E1",
};

export const THEME = {
  light: {
    bg: PALETTE.cream,
    surface: "#FFFDF7",
    surface2: "#EFECE2",
    line: PALETTE.gray,
    line2: "#D4D1C6",
    ink: PALETTE.ink,
    muted: "#5E5B52",
    accent: PALETTE.lime,
    onAccent: PALETTE.ink,
    accentInk: PALETTE.blue,
    blue: PALETTE.blue,
    orange: PALETTE.orange,
    violet: PALETTE.violet,
    // Darker than their dark-scope counterparts: the bright set fails contrast as text on cream.
    win: "#1B6E37",
    loss: "#B32F25",
    qb: "#C2255C",
    rb: "#0A6E60",
    wr: "#2350D8",
    te: "#B4470F",
    flex: "#6D3FD6",
    ga: "#1B6E37",
    gb: "#0A6E60",
    gc: "#735800",
    gd: "#B32F25",
    glow: "rgba(16,17,20,.06)",
    shadow: "0 1px 0 rgba(16,17,20,.06), 0 6px 18px rgba(16,17,20,.08)",
    bevel: "inset 0 1px 0 rgba(255,255,255,.9)",
    // Tactile "sticker" look: solid ink borders and a hard offset shadow instead of a soft blur.
    btnLine: PALETTE.ink,
    hard: PALETTE.ink,
  },
  dark: {
    bg: "#0B1020",
    surface: "#131A2E",
    surface2: "#1B2440",
    line: "#26304D",
    line2: "#36416A",
    ink: PALETTE.cream,
    muted: "#A9B0C3",
    accent: PALETTE.lime,
    onAccent: PALETTE.ink,
    accentInk: PALETTE.lime,
    blue: PALETTE.blue,
    orange: PALETTE.orange,
    violet: PALETTE.violet,
    win: "#6FD49B",
    loss: "#F07B6B",
    qb: "#F2557A",
    rb: "#2FD3B5",
    wr: "#5AA9FF",
    te: "#F5A04A",
    flex: "#B18CFF",
    ga: "#4ADE80",
    gb: "#2FD3B5",
    gc: "#F7B32B",
    gd: "#F07B6B",
    glow: "rgba(184,245,0,.18)",
    shadow: "0 1px 0 rgba(0,0,0,.4), 0 8px 22px rgba(0,0,0,.45)",
    bevel: "inset 0 1px 0 rgba(255,255,255,.08), inset 0 -1px 0 rgba(0,0,0,.45)",
    btnLine: "#36416A",
    hard: "rgba(0,0,0,.55)",
  },
  night: {
    bg: "#0A0A0C",
    surface: "#15171C",
    surface2: "#1E2027",
    line: "#24262D",
    line2: "#363943",
    ink: PALETTE.cream,
    muted: "#A3A59C",
    accent: PALETTE.lime,
    onAccent: PALETTE.ink,
    accentInk: PALETTE.lime,
    blue: PALETTE.blue,
    orange: PALETTE.orange,
    violet: PALETTE.violet,
    win: "#6FD49B",
    loss: "#F07B6B",
    qb: "#F2557A",
    rb: "#2FD3B5",
    wr: "#5AA9FF",
    te: "#F5A04A",
    flex: "#B18CFF",
    ga: "#4ADE80",
    gb: "#2FD3B5",
    gc: "#F7B32B",
    gd: "#F07B6B",
    glow: "rgba(184,245,0,.16)",
    shadow: "0 1px 0 rgba(0,0,0,.5), 0 8px 22px rgba(0,0,0,.55)",
    bevel: "inset 0 1px 0 rgba(255,255,255,.07), inset 0 -1px 0 rgba(0,0,0,.5)",
    btnLine: "#3A3D46",
    hard: "rgba(0,0,0,.6)",
  },
};

// Tokens used as text colors, and the backgrounds text sits on - what the contrast test checks.
export const TEXT_TOKENS = ["ink", "muted", "accentInk", "win", "loss", "qb", "rb", "wr", "te", "flex", "ga", "gb", "gc", "gd"];
export const SURFACE_TOKENS = ["bg", "surface", "surface2"];

const kebab = (k) => k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

// "--bg:#F7F4EA;--surface:#FFFDF7;..." for one scope.
export function cssVars(scope) {
  return Object.entries(THEME[scope]).map(([k, v]) => `--${kebab(k)}:${v}`).join(";");
}
