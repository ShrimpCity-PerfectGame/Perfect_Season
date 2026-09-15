// Cosmetics: how shop items look where they're worn - a frame around a picture, a player card's theme, a title
// under a name - plus the coin. Contract: SHOP.md (7.1). Classes are prefixed cs-.
//
// Every color painted here is named once, as data (COLORS), and card themes publish what they paint behind
// text (cardPaint), so tests/test-cosmetics.mjs can hold each theme's text to WCAG AA without parsing CSS.
// The scope tokens (--ink, --muted, ...) still come from theme.mjs through the cs-dark, cs-night and cs-light
// classes, which perfect-season.jsx maps to its scopes.
import { Avatar } from "./avatars.jsx";
import { PALETTE, THEME, TEXT_TOKENS } from "./theme.mjs";
import { TEAMS } from "./game-logic.mjs";
import { teamVars } from "./ui-common.jsx";
import { SHOP_ITEM_BY_ID, DEFAULT_ITEM, PACK_BY_ITEM } from "./shop-catalog.mjs";

// Which theme.mjs scope each card theme's text uses. perfect-season.jsx maps the cs-dark, cs-night and cs-light
// classes to those scopes.
export const CARD_THEME_SCOPE = {
  "card-navy": "dark", "card-night": "night", "card-turf": "dark", "card-team": "dark",
  "card-ticket": "light", "card-gold-foil": "light", "card-dynasty": "night",
};

// ---------- Color math ----------
// The same WCAG math as tests/test-theme-contrast.mjs. Mixing is per channel in sRGB, which is what the browser
// paints for color-mix(in srgb, ...) and for a translucent layer over an opaque one.
const channels = (hex) => hex.replace("#", "").match(/../g).map((x) => parseInt(x, 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
export const mixHex = (top, under, share) => {
  const u = channels(under);
  return toHex(channels(top).map((v, i) => v * share + u[i] * (1 - share)));
};
export const luminance = (hex) => {
  const [r, g, b] = channels(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const { ink: INK, cream: CREAM, lime: LIME } = PALETTE;
// The fixed paints. Scope-independent on purpose: a card theme or frame looks the same wherever it's worn, and
// only its text follows the scope's tokens.
export const COLORS = {
  ink: INK,
  cream: CREAM,
  lime: LIME,
  // metal, from the badge tiers' bright gold (theme.mjs tierGoldFill) out to its highlight and its deep edge
  gold: THEME.light.tierGoldFill,
  goldLight: "#FFF0B8",
  goldMid: "#D9A62A",
  goldDeep: "#8C6508",
  goldEdge: "#5A4104",
  // flame
  flameRed: "#E8321E",
  flameOrange: "#FF7A1A",
  flameYellow: "#FFC933",
  flameTip: "#FFEFA6",
  // Turf: two mowing stripes, as bright a green as the dark scope's text allows
  turfLight: "#092B12",
  turfDark: "#06200D",
  // Ticket stub: warm paper and its stub strip
  paper: "#FAF3E3",
  stub: PALETTE.orange,
  // Gold foil: pale foil, its glint and its shade - the shade is as deep as every light-scope text color allows
  // (the game blue and the burnt orange need about 0.82 luminance behind them)
  foil: "#F9EDC8",
  foilGlint: "#FFFCF0",
  foilShade: "#F7EBC4",
  // Dynasty: warm black
  dynasty: "#0C0B08",
  // the floor the Team colors card's fill deepens toward
  teamFloor: "#08090C",
};

// How strong each translucent layer is, where it's strongest. cardPaint flattens these onto their fills.
const LAYER = {
  navyDots: 0.05, // the dot texture: --ink (cream on navy) at 5%, today's card
  nightDots: 0.06,
  foilLines: 0.5, // the glint's fine diagonal lines on the foil
  dynastyWreath: 0.1, // the gold laurel watermark
};

// The brightest fill the dark scope's text reads on (every text token at 4.6:1, a little over AA so rounding
// can't tip a team's fill under it).
const darkScopeCeiling = () => {
  const dimmest = Math.min(...TEXT_TOKENS.map((k) => luminance(THEME.dark[k])));
  return (dimmest + 0.05) / 4.6 - 0.05;
};
const TEAM_CEILING = darkScopeCeiling();

// The Team colors card: its fill is the darker of the team's two colors, deepened toward ink until the dark
// scope's text reads on it (as much of the color as that allows, at most 60%); the brighter color is the trim.
export function teamCardColors(code) {
  if (!TEAMS[code]) return null;
  const [, , c1, c2] = TEAMS[code];
  const [dark, bright] = luminance(c1) <= luminance(c2) ? [c1, c2] : [c2, c1];
  let fill = COLORS.teamFloor;
  for (let step = 30; step > 0; step--) {
    const m = mixHex(dark, COLORS.teamFloor, step / 50);
    if (luminance(m) <= TEAM_CEILING) { fill = m; break; }
  }
  return { fill, dark, bright };
}

// What a card theme paints behind its text: { scope, behindText: [colors] } - the fill, and every texture or
// sheen flattened onto the fill where it's strongest. Trim (stripes, hash marks, the tear line, the barcode,
// pinstripes) stays in the card's outer 10px, inside its padding, so it's never behind text. Navy's corner glow
// is listed on its own (`glow`): see tests/test-cosmetics.mjs.
export function cardPaint(theme, team = null) {
  const id = cardLook(theme, team);
  const scope = CARD_THEME_SCOPE[id];
  const t = THEME[scope];
  switch (id) {
    case "card-night": return { scope, behindText: [t.bg, mixHex(t.ink, t.bg, LAYER.nightDots)] };
    case "card-turf": return { scope, behindText: [COLORS.turfLight, COLORS.turfDark] };
    case "card-team": return { scope, behindText: [teamCardColors(team).fill] };
    case "card-ticket": return { scope, behindText: [COLORS.paper] };
    case "card-gold-foil": return { scope, behindText: [COLORS.foil, COLORS.foilGlint, COLORS.foilShade, mixHex(COLORS.foilGlint, COLORS.foilShade, LAYER.foilLines)] };
    case "card-dynasty": return { scope, behindText: [COLORS.dynasty, mixHex(COLORS.gold, COLORS.dynasty, LAYER.dynastyWreath)] };
    default: {
      // Navy, today's card: --bg, the dots, and the lime --glow in the top-left corner.
      const glow = String(t.glow).match(/rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
      const glowHex = toHex(glow.slice(1, 4).map(Number));
      return { scope: "dark", behindText: [t.bg, mixHex(t.ink, t.bg, LAYER.navyDots)], glow: mixHex(glowHex, t.bg, Number(glow[4])) };
    }
  }
}

// ---------- CSS ----------
const C = COLORS;
// A layer of one flat color, for background shorthand lists.
const flat = (color) => `linear-gradient(${color},${color})`;
const rgba = (hex, a) => `rgba(${channels(hex).join(",")},${a})`;
// The laurel watermark on Dynasty, as an image: a branch curving up each side from a tie at the bottom, leaves
// on both sides of each stem, in gold at LAYER.dynastyWreath (one group opacity, so overlapping leaves don't
// add up to a brighter gold than cardPaint tests).
const WREATH = (() => {
  const R = 40, cx = 60, cy = 58;
  const at = (deg, r) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)].map((v) => v.toFixed(1));
  // An ellipse's long axis points at 90deg + its rotation; a leaf lies along the stem, tipped out or in.
  const leaf = (deg, r, tilt) => {
    const [x, y] = at(deg, r);
    return `<ellipse cx='${x}' cy='${y}' rx='4.2' ry='10' transform='rotate(${deg + tilt} ${x} ${y})'/>`;
  };
  const [x0, y0] = at(98, R), [x1, y1] = at(248, R);
  const branch = [
    `<path d='M${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}' fill='none' stroke='${C.gold}' stroke-width='2.6' stroke-linecap='round'/>`,
    ...[118, 146, 174, 202, 230].map((d) => leaf(d, R + 6.5, -28)),
    ...[132, 160, 188, 216].map((d) => leaf(d, R - 6.5, 28)),
    leaf(252, R + 2, 0),
  ].join("");
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><g fill='${C.gold}' opacity='${LAYER.dynastyWreath}'>`
    + `<g>${branch}</g><g transform='translate(120 0) scale(-1 1)'>${branch}</g><circle cx='${cx}' cy='${cy + R + 1}' r='4'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
})();

export const COSMETICS_CSS = `
/* ===== cosmetics ===== */
/* Frames: a ring outside the picture - FramedAvatar sets its width as padding, and --cs-edge, the width of the ring's
   outer edge. --av-edge colors the picture's own ring, the frame's inner edge. Pseudo-element layers sit under the
   picture: the frame is its own stacking context. */
.cs-frame{position:relative;isolation:isolate;flex:none;display:inline-grid;place-items:center;vertical-align:middle;border-radius:50%}
.cs-frame::before,.cs-frame::after{content:none;position:absolute;inset:var(--cs-edge,0px);border-radius:50%;pointer-events:none;z-index:-1}
/* Ink: today's ring, in the scope's ink - cream on a dark card. */
.cs-frame-ink{background:var(--ink)}
.cs-frame-lime{--av-edge:${C.ink};background:${C.lime};box-shadow:inset 0 0 0 var(--cs-edge) ${C.ink}}
/* Team colors: the favorite team's two colors, split on the diagonal like the team swatch. */
.cs-frame-team{--av-edge:${C.ink};background:conic-gradient(from 225deg,var(--tc1) 0 50%,var(--tc2) 0 100%);box-shadow:inset 0 0 0 var(--cs-edge) ${C.ink}}
.cs-frame-gold{--av-edge:${C.goldEdge};background:conic-gradient(from 10deg,${C.goldMid},${C.goldLight} 9%,${C.gold} 18%,${C.goldDeep} 32%,${C.gold} 44%,${C.goldLight} 53%,${C.goldMid} 64%,${C.goldDeep} 78%,${C.gold} 90%,${C.goldMid});
  box-shadow:inset 0 0 0 var(--cs-edge) ${C.goldEdge}}
/* Flame: nine tongues of fire turning around the ring, under a white-hot inner glow that flickers. The glow's
   stops are shares of the layer's radius, where the picture's edge sits at about 86%. */
.cs-frame-flame{--av-edge:${C.ink};background:${C.ink}}
.cs-frame-flame::before{content:"";background:repeating-conic-gradient(${C.flameRed} 0 1.8%,${C.flameOrange} 4.2%,${C.flameYellow} 6.2% 7%,${C.flameOrange} 9%,${C.flameRed} 11.11%);
  animation:cs-spin 3.2s linear infinite}
.cs-frame-flame::after{content:"";background:radial-gradient(closest-side,${C.flameTip} 84%,${rgba(C.flameYellow, 0.9)} 89%,${rgba(C.flameOrange, 0.3)} 95%,transparent 100%);
  animation:cs-flicker 1.3s ease-in-out infinite alternate}
@keyframes cs-spin{to{transform:rotate(1turn)}}
@keyframes cs-flicker{0%{opacity:.45}35%{opacity:1}60%{opacity:.7}100%{opacity:.95}}
/* Undefeated: twenty lime segments, one for every game of a perfect season, on ink; the card-sized picture
   adds a 20-0 plate. */
.cs-frame-undefeated{--av-edge:${C.ink};background:${C.ink}}
.cs-frame-undefeated::before{content:"";background:repeating-conic-gradient(from -5deg,${C.lime} 0 11deg,${C.ink} 0 18deg)}
.cs-plate{position:absolute;left:50%;bottom:0;width:48%;height:auto;transform:translateX(-50%);pointer-events:none;z-index:1}

/* Card themes: the whole paint - fill, 2px border, hard shadow, texture. The caller's class is layout only
   (grid, gap, padding, radius). Trim stays in the outer 10px, so keep at least 12px of padding. --cs-s scales the
   shadow and trim, for the shop's half-size swatch. Every texture is a background layer on the card itself, so the
   caller's children need no position or z-index; the pseudo-elements stay empty, which also switches off any paint a
   caller's own class still puts there (the profile card's old navy glow was a ::before). */
.cs-card{--cs-s:1;position:relative;color:var(--ink);border:2px solid ${C.ink};box-shadow:calc(4px*var(--cs-s)) calc(4px*var(--cs-s)) 0 ${C.ink};background:var(--bg)}
.cs-card::before,.cs-card::after{content:none}
/* Navy: today's card - the navy scoreboard, a lime glow in the corner and a dot texture. */
.cs-card-navy{background:radial-gradient(ellipse 60% 90% at 0% 0%,var(--glow),transparent 62%),radial-gradient(color-mix(in srgb,var(--ink) 5%,transparent) 1px,transparent 1.4px) 0 0/6px 6px,var(--bg)}
/* Night: the Leaderboard's true black, a fine LED-board dot grid, and lime saved for one hairline on top. */
.cs-card-night{background:${flat(C.lime)} 0 0/100% calc(3px*var(--cs-s)) no-repeat,radial-gradient(color-mix(in srgb,var(--ink) 6%,transparent) .8px,transparent 1.2px) 0 0/4px 4px,var(--bg)}
/* Turf: mowing stripes with chalk hash marks along the top and bottom edges. */
.cs-card-turf{background:
  repeating-linear-gradient(90deg,${rgba(C.cream, 0.9)} 0 2px,transparent 2px 24px) 11px 0/100% calc(7px*var(--cs-s)) no-repeat,
  repeating-linear-gradient(90deg,${rgba(C.cream, 0.9)} 0 2px,transparent 2px 24px) 11px 100%/100% calc(7px*var(--cs-s)) no-repeat,
  repeating-linear-gradient(90deg,${C.turfLight} 0 40px,${C.turfDark} 40px 80px),${C.turfDark};
  box-shadow:calc(4px*var(--cs-s)) calc(4px*var(--cs-s)) 0 ${C.ink},inset 0 0 0 calc(2px*var(--cs-s)) ${rgba(C.cream, 0.28)}}
/* Team colors: a deep team fill with jersey-sleeve stripes top and bottom, and the shadow in the team's darker
   color. CardTheme sets --cs-team-fill, --cs-team-dark and --cs-team-bright (teamCardColors). */
.cs-card-team{--cs-stripes:var(--cs-team-bright) 0 calc(5px*var(--cs-s)),transparent 0 calc(7px*var(--cs-s)),var(--cs-team-dark) 0 calc(10px*var(--cs-s)),transparent 0;
  background:linear-gradient(to bottom,var(--cs-stripes)),linear-gradient(to top,var(--cs-stripes)),var(--cs-team-fill);
  box-shadow:calc(4px*var(--cs-s)) calc(4px*var(--cs-s)) 0 var(--cs-team-dark)}
/* Ticket stub: warm paper, an orange stub strip torn off along a perforated line, and a barcode up the right
   edge. All of it in the outer 10px. */
.cs-card-ticket{background:
  ${flat(C.stub)} 0 0/calc(6px*var(--cs-s)) 100% no-repeat,
  repeating-linear-gradient(to bottom,${rgba(C.ink, 0.55)} 0 calc(4px*var(--cs-s)),transparent 0 calc(8px*var(--cs-s))) calc(8px*var(--cs-s)) 0/calc(2px*var(--cs-s)) 100% no-repeat,
  repeating-linear-gradient(to bottom,${C.ink} 0 2px,transparent 0 3px,${C.ink} 0 4px,transparent 0 6px,${C.ink} 0 9px,transparent 0 10px,${C.ink} 0 11px,transparent 0 13px,${C.ink} 0 14px,transparent 0 16px)
    right calc(3px*var(--cs-s)) bottom calc(14px*var(--cs-s))/calc(7px*var(--cs-s)) min(96px,45%) no-repeat,
  ${C.paper}}
/* Gold foil: a pale foil sheen inside a beveled gold band. */
.cs-card-gold-foil{background:
  repeating-linear-gradient(115deg,${rgba(C.foilGlint, LAYER.foilLines)} 0 1px,transparent 1px 4px),
  linear-gradient(115deg,${C.foilShade} 0%,${C.foilGlint} 16%,${C.foil} 30%,${C.foilShade} 46%,${C.foilGlint} 60%,${C.foil} 76%,${C.foilGlint} 90%,${C.foilShade} 100%);
  box-shadow:calc(4px*var(--cs-s)) calc(4px*var(--cs-s)) 0 ${C.ink},inset 0 0 0 calc(2px*var(--cs-s)) ${C.goldDeep},inset 0 0 0 calc(4px*var(--cs-s)) ${C.gold},
    inset 0 0 0 calc(5px*var(--cs-s)) ${C.goldLight},inset 0 0 0 calc(7px*var(--cs-s)) ${C.goldMid},inset 0 0 0 calc(8px*var(--cs-s)) ${C.goldDeep}}
/* Dynasty: warm black with a gold double pinstripe, a laurel in the corner and a gold shadow. */
.cs-card-dynasty{background:${WREATH} right calc(12px*var(--cs-s)) bottom calc(10px*var(--cs-s))/calc(132px*var(--cs-s)) no-repeat,${C.dynasty};
  box-shadow:calc(4px*var(--cs-s)) calc(4px*var(--cs-s)) 0 ${C.gold},inset 0 0 0 calc(4px*var(--cs-s)) ${C.dynasty},inset 0 0 0 calc(6px*var(--cs-s)) ${C.gold},
    inset 0 0 0 calc(8px*var(--cs-s)) ${C.dynasty},inset 0 0 0 calc(9px*var(--cs-s)) ${C.goldDeep}}

/* A title under a name: small, letter-spaced, with a slanted double-stripe marker. */
.cs-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:800;line-height:1.2;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink)}
.cs-title::before{content:"";flex:none;width:10px;height:11px;transform:skewX(-18deg);
  background:linear-gradient(currentColor,currentColor) 0 0/3px 100% no-repeat,linear-gradient(currentColor,currentColor) 6px 0/3px 100% no-repeat}
/* On the metal themes the title is gold: the scope's gold text token (deep gold on foil, bright on black). */
.cs-card-gold-foil .cs-title,.cs-card-dynasty .cs-title{color:var(--tier-gold)}

.cs-coins{display:inline-flex;align-items:center;gap:6px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
.cs-coin{flex:none;display:block}
.cs-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* Shop thumbnails */
.cs-preview{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:56px}
.cs-swatch{--cs-s:.5;display:inline-grid;align-content:center;gap:5px;width:92px;height:58px;padding:0 13px;border-radius:10px}
.cs-swatch-name{display:block;width:70%;height:9px;border-radius:2px;background:var(--ink)}
.cs-swatch-line{display:block;width:48%;height:5px;border-radius:2px;background:var(--accent-ink)}
/* A tag rather than a pill, a little tighter than the card's title: in a narrow shop tile a long title can still
   wrap, and a two-line pill looked broken. */
.cs-chip{display:inline-flex;align-items:center;max-width:100%;padding:7px 11px 7px 9px;border-radius:10px;background:var(--surface);box-shadow:inset 0 0 0 2px var(--line2)}
.cs-chip .cs-title{letter-spacing:.08em}
.cs-pack{gap:0}
.cs-pack>*+*{margin-left:-6px}

@media (prefers-reduced-motion:reduce){
  .cs-frame-flame::before,.cs-frame-flame::after{animation:none}
}
`;

// ---------- Components ----------
// An id of the given kind from the catalog, or null.
const known = (id, kind) => (id && SHOP_ITEM_BY_ID[id]?.kind === kind ? id : null);
const teamOf = (team) => (team && TEAMS[team] ? team : null);

// How far a frame reaches past the picture on each side: SHOP.md's cap, max(3, size / 10), in whole pixels.
export const frameReach = (size) => Math.max(3, Math.floor(size / 10));
// Ink stays today's quiet ring: 4px around the card's 84px picture, 1px in the 24px header.
const inkReach = (size) => Math.max(1, Math.round(size / 21));

// The look a frame id is worn with: Team colors needs a team, and wears Ink without one.
export function frameLook(frame, team) {
  const id = known(frame, "frame") || DEFAULT_ITEM.frame;
  return id === "frame-team" && !teamOf(team) ? DEFAULT_ITEM.frame : id;
}
// The look a card theme id is painted with: Team colors needs a team, and paints Navy without one.
export function cardLook(theme, team) {
  const id = known(theme, "card") || DEFAULT_ITEM.card;
  return id === "card-team" && !teamOf(team) ? DEFAULT_ITEM.card : id;
}

// The Undefeated frame's plate: "20-0" drawn as strokes (no font to wait for), lime on ink.
function UndefeatedPlate() {
  return (
    <svg className="cs-plate" viewBox="0 0 40 16" aria-hidden="true" focusable="false">
      <rect x=".75" y=".75" width="38.5" height="14.5" rx="7.25" fill={C.ink} stroke={C.lime} strokeWidth="1.5" />
      <path d="M7.5 4.5H12.5V8H7.5V11.5H12.5M15 4.5H20V11.5H15ZM22.5 8H25.5M28 4.5H33V11.5H28Z" fill="none" stroke={C.lime} strokeWidth="1.9" strokeLinejoin="round" />
    </svg>
  );
}

// A picture in its frame. `size` is the picture's own size; the frame sits outside it, at most
// max(3, size / 10) px on each side.
export function FramedAvatar({ frame = null, team = null, size = 40, username = "", photoUrl = null, preset = null, decorative = false, className = "" }) {
  const id = known(frame, "frame") || DEFAULT_ITEM.frame;
  const code = teamOf(team);
  const look = frameLook(frame, team);
  const reach = look === "frame-ink" ? inkReach(size) : frameReach(size);
  const style = { padding: reach, "--cs-edge": `${Math.max(1, Math.round(reach / 4))}px`, ...(look === "frame-team" ? teamVars(code) : null) };
  return (
    <span className={`cs-frame cs-frame-${look.replace(/^frame-/, "")} ${className}`.trim()} style={style} data-frame={id} data-team={code || undefined}>
      <Avatar username={username} photoUrl={photoUrl} preset={preset} size={size} decorative={decorative} />
      {look === "frame-undefeated" && size >= 56 && <UndefeatedPlate />}
    </span>
  );
}

// A player card's paint and text scope. `className` carries the card's layout.
export function CardTheme({ theme = null, team = null, as: Tag = "div", className = "", children, style, ...rest }) {
  const id = known(theme, "card") || DEFAULT_ITEM.card;
  const code = teamOf(team);
  const look = cardLook(theme, team);
  const scope = CARD_THEME_SCOPE[look];
  let paint = null;
  if (look === "card-team") {
    const t = teamCardColors(code);
    paint = { ...teamVars(code), "--cs-team-fill": t.fill, "--cs-team-dark": t.dark, "--cs-team-bright": t.bright };
  }
  return (
    <Tag {...rest} style={paint ? { ...style, ...paint } : style} className={`cs-card cs-${scope} cs-card-${look.replace(/^card-/, "")} ${className}`.trim()}
      data-card={id} data-team={code || undefined}>
      {children}
    </Tag>
  );
}

// The title under a name, or nothing.
export function TitleLine({ title = null, className = "" }) {
  const id = known(title, "title");
  if (!id) return null;
  return <p className={`cs-title ${className}`.trim()} data-title={id}>{SHOP_ITEM_BY_ID[id].name}</p>;
}

// The coin: the Gridspin re-spin arrow on a lime disc. Decorative - Coins says the number in words.
export function Coin({ size = 16 }) {
  return (
    <svg className="cs-coin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10.5" fill={C.lime} stroke={C.ink} strokeWidth="2" />
      <path d="M15.6 8.4A5 5 0 1 1 8.4 8.4" fill="none" stroke={C.ink} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M10 5.6 7.3 6.1 8.9 8.5Z" fill={C.ink} />
    </svg>
  );
}

// An amount of coins: the coin and "1,240", read as "1,240 coins".
export function Coins({ amount = 0, size = 16, className = "" }) {
  return (
    <span className={`cs-coins ${className}`.trim()}>
      <Coin size={size} />
      <span>{Number(amount || 0).toLocaleString("en-US")}</span>
      <span className="cs-sr"> coins</span>
    </span>
  );
}

// The thumbnail a shop tile shows for an item. Decorative: the tile names the item. Only inline elements, so
// it can sit inside a button.
export function ItemPreview({ id, team = null, username = "", photoUrl = null, preset = null }) {
  const item = SHOP_ITEM_BY_ID[id];
  if (!item) return null;
  if (item.kind === "frame") {
    return (
      <span className="cs-preview" aria-hidden="true" data-preview={id}>
        <FramedAvatar frame={id} team={team} size={44} username={username} photoUrl={photoUrl} preset={preset} decorative />
      </span>
    );
  }
  if (item.kind === "card") {
    return (
      <span className="cs-preview" aria-hidden="true" data-preview={id}>
        <CardTheme as="span" theme={id} team={team} className="cs-swatch">
          <span className="cs-swatch-name" />
          <span className="cs-swatch-line" />
        </CardTheme>
      </span>
    );
  }
  if (item.kind === "title") {
    return (
      <span className="cs-preview" aria-hidden="true" data-preview={id}>
        <span className="cs-chip"><span className="cs-title">{item.name}</span></span>
      </span>
    );
  }
  const pack = PACK_BY_ITEM[id];
  return (
    <span className="cs-preview cs-pack" aria-hidden="true" data-preview={id}>
      {(pack?.presets || []).map((p) => <Avatar key={p.key} username={p.name} preset={p.key} size={34} decorative />)}
    </span>
  );
}
