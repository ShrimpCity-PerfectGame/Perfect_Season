// Cosmetics: how shop items look where they're worn - a frame around a picture, a player card's theme, a title
// under a name - plus the coin. Contract: SHOP.md (7.1). Classes are prefixed cs-.
//
// Every color painted here is named once, as data (COLORS), and card themes publish what they paint behind
// text (cardPaint), so tests/test-cosmetics.mjs can hold each theme's text to WCAG AA without parsing CSS.
// The scope tokens (--ink, --muted, ...) still come from theme.mjs through the cs-dark, cs-night and cs-light
// classes, which perfect-season.jsx maps to its scopes.
import { Avatar, SPACE } from "./avatars.jsx";
import { PALETTE, THEME, TEXT_TOKENS } from "./theme.mjs";
import { TEAMS } from "./game-logic.mjs";
import { useContext } from "react";
import { teamVars, BoardWear, OpenProfile } from "./ui-common.jsx";
import { SHOP_ITEM_BY_ID, DEFAULT_ITEM, PACK_BY_ITEM } from "./shop-catalog.mjs";

// Which theme.mjs scope each card theme's text uses. perfect-season.jsx maps the cs-dark, cs-night and cs-light
// classes to those scopes.
export const CARD_THEME_SCOPE = {
  "card-navy": "dark", "card-night": "night", "card-turf": "dark", "card-team": "dark",
  "card-ticket": "light", "card-gold-foil": "light", "card-dynasty": "night",
  "card-cosmos": "night",
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
  // Win celebrations. Named here like every other paint, because tests/test-cosmetics.mjs refuses a colour in
  // COSMETICS_CSS that is not in COLORS or PALETTE - the rule that keeps a cosmetic's palette reviewable
  // rather than scattered through a stylesheet.
  // Nameplates. ember is the loss red, deep enough to carry cream text; aurora is the violet Genius left
  // behind when it moved to crimson - the bright PALETTE.violet is 3.85:1 under cream and 4.46 under ink, so
  // neither way round passes, which is the same wall the 1v1 tile ran into.
  plateEmber: "#B32F25",
  plateInferno: "#8C1B10", // the deep end of Inferno's drift
  plateEmerald: "#0A6E60", // the bright end of Emerald's, which is the rb teal
  plateMidnight: "#1E2A5A", // Midnight's far end
  plateAurora: "#6D3FD6",
  celStage: "#0B1020", // the shop preview tile's little night sky
  celBeam: "#FFFFFF", // a spotlight beam, which is white light and nothing else
  // Supporter's cosmic line (v2.6.0 Aurora and Supernova, v2.7.0 Nebula, v2.8.0 Orbit and Cosmos). A supporter
  // can now dress entirely in it, which is the point: it reads as one thing across the frame, the card, the
  // plate, the name and the avatar rather than as five unrelated purchases.
  cosmosVoid: SPACE, // deep space, shared with the Stargazer avatars that are worn with it (avatars.jsx)
  cosmosHaze: "#241046", // the violet nebula washed across it
  orbitRing: "#2A1458",  // the Orbit frame's ring
  orbitEdge: "#150A2E",  // and the edge inside it
  // Name colours (the boards, NAME_LOOKS below). Each look is named twice: a deep value that clears AA on
  // cream and a bright one that clears it on true black. The pairs are the same colour as far as anyone
  // reading the board is concerned - Ember is Ember - and the two exist because the surface underneath is
  // the page, not a plate the look brought with it.
  nameBlueDeep: "#1B44C8",
  nameBlueBright: "#8FB8FF",
  nameEmberDeep: "#A3350B",
  nameEmberBright: "#FF9E63",
  nameToxicDeep: "#2F6B00",
  nameToxicMoss: "#0F5E2E",
  nameToxicMint: "#6FE8A0",
  nameMagentaDeep: "#A8126A",
  nameVioletDeep: "#6326CE",
  nameTealDeep: "#0D5F7C",
  namePink: "#FF84C8",
  nameLilac: "#C4A0FF",
  nameAqua: "#6FE4FF",
  nameFlameDeep: "#A63C00",
  nameFlameRedDeep: "#96110F",
  nameFlameBrown: "#7A2A00",
  nameFlameBlush: "#FF7373", // lifted from #FF6B6B, which was 4.30:1 on the champion block's lime glow
  nameFrostDeep: "#0E5B78",
  nameFrostInk: "#25489E",
  nameFrostIce: "#A8ECFF",
  nameFrostSky: "#7FD0FF",
  nameFrostMist: "#D6EBFF",
  namePrismRose: "#9C1055",
  namePrismViolet: "#7A2AB8",
  namePrismBlue: "#12558C",
  namePrismGreen: "#0F6238",
  namePrismPink: "#FF8FB8",
  namePrismLilac: "#C9A0FF",
  namePrismSky: "#7FC8FF",
  namePrismMint: "#8FEFA8",
  nameGoldDeep: "#6E4A00",
  nameGoldMid: "#875D05",
  nameGoldGlow: "#FFD84D",
  nameGoldPale: "#FFEFA3",
  nameNebulaViolet: "#5423B8",
  nameNebulaMagenta: "#96126E",
  nameNebulaLilac: "#C9A6FF",
  nameNebulaPink: "#FF9AD5",
  nameNebulaBlue: "#93C4FF",
};

// How strong each translucent layer is, where it's strongest. cardPaint flattens these onto their fills.
const LAYER = {
  navyDots: 0.05, // the dot texture: --ink (cream on navy) at 5%, today's card
  nightDots: 0.06,
  foilLines: 0.5, // the glint's fine diagonal lines on the foil
  dynastyWreath: 0.1, // the gold laurel watermark
  // Cosmos. Two numbers, both found by search rather than chosen: the binding constraint is a STAR INSIDE
  // THE NEBULA, which is the brightest thing a letter can land on, and it is what stops the card being
  // brighter still. Behind text you can have a vivid nebula or visible stars, not both - so the nebula takes
  // it (0.32 of the aurora violet, against 0.7 of a much darker violet before, which read as a purple
  // outline) and the stars behind text drop to a texture. The stars anyone actually SEES are in the trim,
  // where the card's padding keeps text out and they can be as bright as they like - the same place Turf
  // puts its hash marks and Ticket its barcode.
  cosmosStars: 0.02,
  cosmosNebula: 0.32,
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
    case "card-cosmos": {
      // Four surfaces, because the nebula covers part of the card and a star can fall anywhere: the void, a
      // star on it, the nebula, and a star inside the nebula - the brightest thing a letter can sit on, and
      // the one that decides how bright the whole card is allowed to be.
      // The starLINE along the top and bottom edges is not here on purpose: it lives in the trim, inside the
      // card's padding, where no letter reaches - the same reason Turf's hash marks and Ticket's barcode are
      // not declared either.
      const wash = mixHex(COLORS.plateAurora, COLORS.cosmosVoid, LAYER.cosmosNebula);
      return { scope, behindText: [COLORS.cosmosVoid, mixHex(COLORS.nameNebulaLilac, COLORS.cosmosVoid, LAYER.cosmosStars),
        wash, mixHex(COLORS.nameNebulaLilac, wash, LAYER.cosmosStars)] };
    }
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

// Titles past rare trade the double stripe for a mark of their own: a spark on the epic ones, a crown on the legendary
// ones. Keyed by id like every other look, so a price or rarity changed in the database never changes one.
// ---------- Nameplates ----------
// A banner behind the name on the player card. Each one is a fill and ITS OWN text colour, held together as a
// pair: the card underneath can be cs-dark, cs-night or cs-light, so a plate that took the card's token would
// read on some cards and vanish on others. tests/test-cosmetics.mjs holds every pair to AA, which is why the
// bright violet and the flame red are not here - neither clears 4.5 either way round.
// `trim` is a brighter partner used for the edge only, never behind text.
// `stops` is every colour the plate paints behind its name - one for a flat plate, two for a gradient - and
// the ink has to clear AA against ALL of them, because the gradient drifts and any stop can end up under a
// letter. `lively` drifts the gradient; it does nothing on a flat plate and stops under reduced motion.
//
// This is where "animated names with different colours" ended up, and the measurement is why: NOT ONE colour
// clears AA as text on all three card scopes - lime is 1.28:1 on cream, game blue is 3.19:1 on the dark card.
// Coloured text alone cannot work in an app with a cream, a navy and a black surface. So the colour travels
// with its own background, which is checkable and can be as vivid as we like.
export const NAMEPLATES = {
  "plate-ink": { stops: [COLORS.ink], ink: COLORS.cream, trim: COLORS.lime },
  "plate-lime": { stops: [COLORS.lime], ink: COLORS.ink, trim: COLORS.ink },
  "plate-turf": { stops: [COLORS.turfLight], ink: COLORS.cream, trim: COLORS.lime },
  "plate-blue": { stops: [PALETTE.blue], ink: COLORS.cream, trim: COLORS.cream },
  "plate-midnight": { stops: [COLORS.celStage, COLORS.plateMidnight], ink: COLORS.cream, trim: COLORS.lime, lively: true },
  "plate-gold": { stops: [COLORS.gold], ink: COLORS.ink, trim: COLORS.goldDeep },
  "plate-inferno": { stops: [COLORS.plateInferno, COLORS.plateEmber], ink: COLORS.cream, trim: COLORS.flameYellow, lively: true },
  "plate-ember": { stops: [COLORS.plateEmber], ink: COLORS.cream, trim: COLORS.flameYellow },
  "plate-emerald": { stops: [COLORS.turfDark, COLORS.plateEmerald], ink: COLORS.cream, trim: COLORS.lime, lively: true },
  "plate-dynasty": { stops: [COLORS.dynasty], ink: COLORS.gold, trim: COLORS.goldDeep },
  "plate-aurora": { stops: [COLORS.plateAurora, PALETTE.blue], ink: COLORS.cream, trim: COLORS.lime, lively: true },
};

// The background a plate paints: one colour, or the gradient its stops describe.
export const plateFill = (look) => (look.stops.length === 1 ? look.stops[0]
  : `linear-gradient(100deg,${look.stops.join(",")},${look.stops[0]})`);

// What a plate paints behind its name, in the shape cardPaint answers in, so the contrast test can read both
// the same way: { behindText: [fill], ink }.
export function platePaint(id) {
  const plate = NAMEPLATES[id];
  return plate ? { behindText: [...plate.stops], ink: plate.ink } : null;
}

// ---------- Name colours ----------
// Curated, animated colours for a name ON THE BOARDS - the other half of the answer the nameplates gave for
// the player card, and the part people actually ask for.
//
// A name on a board is text with the page behind it, so unlike a plate it cannot bring its own background,
// and the measurement that sent coloured names to plates in the first place still stands: no single colour
// clears AA on cream AND on true black. What makes this work is that a look does not have to BE one colour.
// Each one is named once per app scope, exactly as theme.mjs names every token three times, and the scope the
// app is already in picks: deep on cream (Stats), bright on black (the Leaderboard), bright on navy. Ember is
// Ember on all three; only its lightness moves, which is the one thing the surface forces.
//
// `stops` per scope: one colour for a flat look, several for a gradient that drifts. EVERY stop has to clear
// AA against every surface a board name can sit on in that scope - tests/test-cosmetics.mjs owns that list
// (NAME_SURFACES), and it includes the lime wash the leaderboard paints over your own row. Measuring the
// first stop is not enough: a drift slides any stop under any letter.
//
// `lively` drifts the gradient. Background-position only, like a plate, so nothing moves, nothing reflows,
// and the colours under the letters stay the colours that were measured. It stops under reduced motion.
//
// This is the boards only, and deliberately: the player card wears a nameplate instead, because a card is one
// of six themes over 32 team colours and a text colour clearing all of those does not exist.
export const NAME_LOOKS = {
  "name-blue": { light: [C.nameBlueDeep], dark: [C.nameBlueBright], night: [C.nameBlueBright] },
  "name-ember": { light: [C.nameEmberDeep], dark: [C.nameEmberBright], night: [C.nameEmberBright] },
  "name-toxic": {
    light: [C.nameToxicDeep, C.nameToxicMoss],
    dark: [C.lime, C.nameToxicMint], night: [C.lime, C.nameToxicMint], lively: true,
  },
  "name-vapor": {
    light: [C.nameMagentaDeep, C.nameVioletDeep, C.nameTealDeep],
    dark: [C.namePink, C.nameLilac, C.nameAqua], night: [C.namePink, C.nameLilac, C.nameAqua], lively: true,
  },
  "name-flame": {
    light: [C.nameFlameDeep, C.nameFlameRedDeep, C.nameFlameBrown],
    dark: [C.flameYellow, C.flameOrange, C.nameFlameBlush],
    night: [C.flameYellow, C.flameOrange, C.nameFlameBlush], lively: true,
  },
  "name-frost": {
    light: [C.nameFrostDeep, C.nameFrostInk],
    dark: [C.nameFrostIce, C.nameFrostSky, C.nameFrostMist],
    night: [C.nameFrostIce, C.nameFrostSky, C.nameFrostMist], lively: true,
  },
  "name-prism": {
    light: [C.namePrismRose, C.namePrismViolet, C.namePrismBlue, C.namePrismGreen],
    dark: [C.namePrismPink, C.namePrismLilac, C.namePrismSky, C.namePrismMint],
    night: [C.namePrismPink, C.namePrismLilac, C.namePrismSky, C.namePrismMint], lively: true,
  },
  "name-trophy": {
    light: [C.nameGoldDeep, C.nameGoldMid],
    dark: [C.nameGoldGlow, C.nameGoldPale], night: [C.nameGoldGlow, C.nameGoldPale], lively: true,
  },
  "name-nebula": {
    light: [C.nameNebulaViolet, C.nameNebulaMagenta, C.nameFrostInk],
    dark: [C.nameNebulaLilac, C.nameNebulaPink, C.nameNebulaBlue],
    night: [C.nameNebulaLilac, C.nameNebulaPink, C.nameNebulaBlue], lively: true,
  },
};

// The three scopes a look has to answer for - the app's own, from theme.mjs. A look missing one is a look
// that would fall back to nothing on a whole screen, so tests/test-cosmetics.mjs holds every look to all three.
export const NAME_SCOPES = ["light", "dark", "night"];

// The gradient a look paints across its letters. One stop is not a gradient at all; it is set as `color` and
// no background is involved, so a flat look needs nothing clipped to text.
export const nameFill = (stops) => (stops.length === 1 ? null
  : `linear-gradient(100deg,${stops.join(",")},${stops[0]})`);

// What a look paints as text in one scope, in the shape cardPaint and platePaint answer in - except that here
// the colours ARE the text, so they come back as `inks` rather than as something behind it.
export function namePaint(id, scope) {
  const look = NAME_LOOKS[id];
  return look && look[scope] ? { inks: [...look[scope]], lively: !!look.lively } : null;
}

export const TITLE_MARK = {
  "title-war-room": "spark", "title-sleeper-agent": "spark",
  "title-first-overall": "crown", "title-the-goat": "crown",
};
const titleClass = (id) => (TITLE_MARK[id] ? `cs-title cs-title-${TITLE_MARK[id]}` : "cs-title");
// A mark as a mask: only its shape counts, so it's drawn in black and painted in the title's own color, which keeps
// its contrast the text's.
const markMask = (d) => {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='${d}' fill='black'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center/contain no-repeat`;
};
const MARK = {
  spark: markMask("M6 0L7.6 4.4L12 6L7.6 7.6L6 12L4.4 7.6L0 6L4.4 4.4Z"),
  crown: markMask("M0.5 2.5L3.6 5.2L6 0.8L8.4 5.2L11.5 2.5L10.4 8.6H1.6ZM1.6 9.8H10.4V11.6H1.6Z"),
};

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
/* Orbit (supporter): a deep violet ring with one bright body going round it. The sweep is a conic gradient
   turned by the same cs-spin Flame uses - one keyframe, not a second one that does the same thing - and it is
   slow, because this sits beside a name at 24px in the header and a fast one there is a distraction. */
.cs-frame-orbit{--av-edge:${C.orbitEdge};background:conic-gradient(from 220deg,${C.orbitEdge},${C.orbitRing} 45%,${C.orbitEdge} 88%,${C.orbitEdge});
  box-shadow:inset 0 0 0 var(--cs-edge) ${C.orbitEdge}}
/* The ring is kept dark all the way round so the body going over it is the only bright thing on the frame.
   With the ring itself carrying a bright violet the sweep had nothing to stand out against, and at 24px the
   whole thing read as a plain purple circle. */
.cs-frame-orbit::before{content:"";background:conic-gradient(transparent 0 54%,${rgba(C.plateAurora, 0.85)} 66%,${C.nameNebulaLilac} 73%,${C.cream} 77%,${C.nameNebulaLilac} 81%,${rgba(C.plateAurora, 0.85)} 88%,transparent 96%);
  animation:cs-spin 7s linear infinite}
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
/* Cosmos (supporter): deep space, a violet nebula, and a line of stars along the top and bottom edges.
   The card is built in two halves, and which half a thing belongs to is decided by one question: can a letter
   land on it?
     behind text - the void, the nebula and a faint star texture, every one of them measured (cardPaint);
     the trim   - the starlines and the rings, in the outer band the card's padding keeps text out of, exactly
                  where Turf puts its mowing stripes' chalk and Dynasty its wreath. Nothing here is measured
                  because nothing here is ever behind a letter, and that is what lets it be bright.
   The first version put everything behind text and so had to be dark enough to read through: it came out a
   purple outline. Nothing animates - a card sits under a name and a bio, and a moving background is the one
   place in this app where motion would cost legibility rather than add anything. */
.cs-card-cosmos{background:
  /* the starlines, top and bottom, inside the trim */
  repeating-linear-gradient(90deg,${C.cream} 0 1.6px,transparent 1.6px 23px) calc(9px*var(--cs-s)) calc(5px*var(--cs-s))/100% 1.6px no-repeat,
  repeating-linear-gradient(90deg,${rgba(C.nameNebulaLilac, 0.85)} 0 1.4px,transparent 1.4px 17px) calc(16px*var(--cs-s)) calc(9px*var(--cs-s))/100% 1.4px no-repeat,
  repeating-linear-gradient(90deg,${C.cream} 0 1.6px,transparent 1.6px 29px) calc(13px*var(--cs-s)) calc(100% - 6px*var(--cs-s))/100% 1.6px no-repeat,
  /* the faint star texture behind text, and the nebula itself */
  radial-gradient(${rgba(C.nameNebulaLilac, LAYER.cosmosStars)} 1px,transparent 1.4px) 0 0/17px 17px,
  radial-gradient(135% 105% at 16% 4%,${rgba(C.plateAurora, LAYER.cosmosNebula)} 0%,${rgba(C.plateAurora, LAYER.cosmosNebula * 0.55)} 34%,transparent 66%),
  ${C.cosmosVoid};
  /* Four rings, the way Dynasty wears four of gold: this is the whole of what makes a card look paid for, and
     it costs nothing to contrast because a border is never behind a letter. */
  box-shadow:calc(4px*var(--cs-s)) calc(4px*var(--cs-s)) 0 ${C.ink},
    inset 0 0 0 calc(2px*var(--cs-s)) ${C.orbitEdge},
    inset 0 0 0 calc(4px*var(--cs-s)) ${C.nameNebulaLilac},
    inset 0 0 0 calc(6px*var(--cs-s)) ${C.plateAurora},
    inset 0 0 0 calc(9px*var(--cs-s)) ${C.cosmosVoid},
    inset 0 0 0 calc(10px*var(--cs-s)) ${rgba(C.nameNebulaLilac, 0.45)}}

/* A title under a name: small, letter-spaced, with a slanted double-stripe marker. */
.cs-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:800;line-height:1.2;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-ink)}
.cs-title::before{content:"";flex:none;width:10px;height:11px;transform:skewX(-18deg);
  background:linear-gradient(currentColor,currentColor) 0 0/3px 100% no-repeat,linear-gradient(currentColor,currentColor) 6px 0/3px 100% no-repeat}
/* On the metal themes the title is gold: the scope's gold text token (deep gold on foil, bright on black). */
.cs-card-gold-foil .cs-title,.cs-card-dynasty .cs-title{color:var(--tier-gold)}
/* The epic and legendary titles' marks (TITLE_MARK), in place of the stripes. */
.cs-title-spark::before,.cs-title-crown::before{width:12px;height:12px;transform:none;background:currentColor}
.cs-title-spark::before{-webkit-mask:${MARK.spark};mask:${MARK.spark}}
.cs-title-crown::before{-webkit-mask:${MARK.crown};mask:${MARK.crown}}

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

/* Under 360px the shop's two columns leave a thumbnail about 121px wide. A one-word title can't wrap, so
   "Undefeated" and "Cinderella" were cut off at both ends: a tighter tag there. */
/* ---------- Nameplates ----------
   A banner behind the name. The fill and the text colour arrive together as custom properties, because the
   pair is what was held to AA - splitting them would let a later change move one and not the other. */
/* nowrap, and a narrower gutter than looks right on its own: the cards size a name for a bare word, so a
   plate's padding is width taken away from it - "shrimpcity" broke to "shrimpc / ity" the first time this
   rendered. The name is one word and stays one word; a card that cannot fit it shrinks the type, which is
   what .pf-long and .sh-long already do. */
/* A BLOCK sized to its content, not an inline-block. Both cards put the name in a grid whose name is
   a line-height of .95 - a line box shorter than the plate - and an inline-block's padding does not grow it, so
   the name measured ZERO high and the plate drew straight over the title beneath it. A block takes its own
   height, and fit-content keeps the banner the width of the name rather than the width of the column.
   nowrap, and a narrower gutter than looks right on its own: the cards size a name for a bare word, so a
   plate's padding is width taken away from it - "shrimpcity" broke to "shrimpc / ity" the first time this
   rendered. The name is one word and stays one word; a card that cannot fit it shrinks the type, which is
   what .pf-long and .sh-long already do.
   The outer ring is what stops a plate vanishing into a card of nearly its own colour - Turf on the Turf card
   is #092B12 on #06200D - so every plate reads as a banner rather than an outline round a name. */
.cs-nameplate{display:block;width:fit-content;max-width:100%;min-width:0;border-radius:8px;padding:3px 9px 4px;
  background:var(--cs-nameplate);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  color:var(--cs-nameplate-ink);line-height:1.08;
  box-shadow:inset 0 0 0 1.5px var(--cs-nameplate-trim),0 0 0 2px ${rgba(C.ink, 0.35)}}
/* Wearing a plate AND a name colour: the plate sits inside the colour, as a frame around it. The letters stay
   the plate's own ink - they have to, see NamePlate - but the frame is never behind a letter, so it can carry
   the whole look, gradient and drift and all, rather than the one flat stop an outline could take.
   The plate's own outer ring is dropped here: this IS that ring now, and two would read as a mistake. */
.cs-plate-ring{display:block;width:fit-content;max-width:100%;padding:2.5px;border-radius:11px;
  background:var(--cs-name-fill,var(--cs-name-1))}
.cs-plate-ring>.cs-nameplate{box-shadow:inset 0 0 0 1.5px var(--cs-nameplate-trim)}
.cs-plate-ring.cs-lively{background-size:220% 100%;animation:cs-name-drift 7s ease-in-out infinite}
.cs-nameplate-preview{display:inline-flex;align-items:center;justify-content:center;width:64px;height:26px;
  border-radius:6px;font-family:var(--display);font-size:13px;letter-spacing:.02em}
/* The animated ones drift their gradient. Background-position only - nothing moves, nothing reflows, and the
   colours under the letters stay the colours the contrast test measured, because a drift only slides which
   stop is where. */
.cs-nameplate.cs-lively{background-size:220% 100%;animation:cs-plate-drift 7s ease-in-out infinite}
@keyframes cs-plate-drift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}

/* ---------- Name colours ----------
   The colours arrive as inline vars rather than as rules of their own. A look is three palettes and only the
   app knows which screen this is, so cosmetics.jsx has no business naming .night in here - and the stylesheet
   stays cs- classes only, which is a rule the tests keep.
   A flat look is nothing but a color. A gradient has to be clipped to the letters, which means the fill goes
   transparent - so they are separate classes, and a flat look never goes near text-fill-color, where a
   browser without the clip would leave nothing at all to read.
   text-decoration-color is set defensively, not for a bug seen: a decoration is painted by whatever element
   declares it, and the leaderboard's hover underline is declared on the .namelink button, which keeps its own
   colour. This only matters if a decoration is ever set on the name itself, where currentColor would be the
   transparent fill and the underline would vanish. */
.cs-name{color:var(--cs-name-1);text-decoration-color:var(--cs-name-1)}
.cs-name-grad{background-image:var(--cs-name-fill);-webkit-background-clip:text;background-clip:text;
  -webkit-text-fill-color:transparent}
.cs-name-grad.cs-lively{background-size:220% 100%;animation:cs-name-drift 7s ease-in-out infinite}
@keyframes cs-name-drift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
/* The shop shows a look on both surfaces at once: it is not one colour, and a preview of half of it would
   misdescribe the other half. The chips are the two ends - cream, and a black a shade deeper than the
   Leaderboard's own, so anything readable there is readable here. */
.cs-name-preview{display:inline-flex;gap:4px;align-items:center}
.cs-name-chip{display:inline-flex;align-items:center;justify-content:center;width:52px;height:24px;
  border-radius:5px;font-family:var(--display);font-size:12px;letter-spacing:.02em}
.cs-name-chip-light{background:${C.cream}}
.cs-name-chip-night{background:${C.teamFloor}}

/* ---------- Win celebrations ----------
   An overlay over the whole result screen, not a panel in it: the moment is the screen, and .cel (the lime
   block) is already the panel. Fixed, pointer-events:none and aria-hidden, so it never takes a tap or reads
   out - the result is announced by the text underneath, which was there before any of this.
   CSS only, no canvas: it has to run on a phone mid-animation on the same screen as the season ticking in,
   and a canvas would also be invisible to tests/test-cosmetics.mjs, which reads the DOM. */
.cs-cel{position:fixed;inset:0;z-index:35;pointer-events:none;overflow:hidden}
.cs-cel i{position:absolute;display:block;will-change:transform,opacity}
/* Confetti and Gold rain: pieces falling from above the fold, each one's lane and delay set inline so the
   pattern is a pure function of its index - no Math.random anywhere near a screen that also shows a seeded
   season. */
.cs-cel-fall i{top:-8%;width:9px;height:14px;border-radius:2px;animation:cs-fall 2.4s linear forwards}
.cs-cel-gold-rain i{width:13px;height:13px;border-radius:50%;box-shadow:inset 0 -2px 0 ${rgba(C.ink, 0.25)}}
@keyframes cs-fall{
  0%{opacity:0;transform:translateY(0) rotate(0deg)}
  8%{opacity:1}
  85%{opacity:1}
  100%{opacity:0;transform:translateY(112vh) rotate(620deg)}
}
/* Spotlight: two beams sweeping in from the top corners and settling. */
.cs-cel-spotlight i{top:-30%;width:34vw;height:150vh;transform-origin:50% 0;
  background:linear-gradient(to bottom,${rgba(C.celBeam, 0.34)},${rgba(C.celBeam, 0)} 72%);
  filter:blur(6px);animation:cs-sweep 2.4s ease-out forwards}
@keyframes cs-sweep{
  0%{opacity:0;transform:rotate(var(--from))}
  22%{opacity:1}
  80%{opacity:1;transform:rotate(var(--to))}
  100%{opacity:0;transform:rotate(var(--to))}
}
/* Fireworks: each burst is one ring scaling out and fading, with a second inside it. */
.cs-cel-fireworks i{width:16px;height:16px;border-radius:50%;animation:cs-burst 1.5s ease-out forwards}
@keyframes cs-burst{
  0%{opacity:0;transform:scale(.2)}
  12%{opacity:1}
  100%{opacity:0;transform:scale(11);box-shadow:0 0 0 2px currentColor inset}
}
/* Champion: rotating gold rays behind everything, the belt-glow of the set. */
.cs-cel-champion i{top:50%;left:50%;width:180vmax;height:180vmax;margin:-90vmax 0 0 -90vmax;border-radius:50%;
  background:conic-gradient(from 0deg,${rgba(C.gold, 0.3)} 0deg 8deg,transparent 8deg 30deg,
    ${rgba(C.gold, 0.22)} 30deg 38deg,transparent 38deg 60deg);
  animation:cs-rays 2.6s linear forwards}
@keyframes cs-rays{
  0%{opacity:0;transform:rotate(0deg)}
  15%{opacity:1}
  78%{opacity:1}
  100%{opacity:0;transform:rotate(120deg)}
}
/* Supernova, the supporter one: a bloom of light out of the middle, rings behind it. Its own shape rather
   than a brighter Champion - a supporter item is different, not better. */
.cs-cel-supernova i{top:50%;left:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
  background:radial-gradient(circle,${C.celBeam} 0%,${rgba(C.lime, 0.85)} 26%,${rgba(PALETTE.violet, 0.5)} 52%,transparent 72%);
  animation:cs-nova 2.4s ease-out forwards}
@keyframes cs-nova{
  0%{opacity:0;transform:scale(.2)}
  10%{opacity:1}
  70%{opacity:.7}
  100%{opacity:0;transform:scale(26)}
}

/* The shop's little preview tile: the same looks, held still and sized for a swatch. Every piece gets its
   dimensions again here, because the overlay's come from .cs-cel-fall and the rest, which the tile does not
   wear - without these, confetti's pieces have no width or height at all and the tile is simply empty. */
.cs-cel-preview{position:relative;width:64px;height:40px;border-radius:8px;overflow:hidden;background:${C.celStage}}
.cs-cel-preview i{position:absolute;display:block;animation:none}
.cs-cel-preview.cs-cel-confetti i{width:5px;height:8px;border-radius:1px}
.cs-cel-preview.cs-cel-gold-rain i{width:7px;height:7px;border-radius:50%}
.cs-cel-preview.cs-cel-spotlight i{top:-20%;width:16px;height:60px;transform-origin:50% 0;
  background:linear-gradient(to bottom,${rgba(C.celBeam, 0.5)},${rgba(C.celBeam, 0)} 78%);filter:blur(2px)}
.cs-cel-preview.cs-cel-fireworks i{width:14px;height:14px;border-radius:50%;background:none}
.cs-cel-preview.cs-cel-supernova i{top:50%;left:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
  background:radial-gradient(circle,${C.celBeam} 0%,${rgba(C.lime, 0.85)} 26%,${rgba(PALETTE.violet, 0.5)} 52%,transparent 72%)}
.cs-cel-preview.cs-cel-champion i{top:50%;left:50%;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;
  background:conic-gradient(from 0deg,${rgba(C.gold, 0.55)} 0deg 10deg,transparent 10deg 32deg,
    ${rgba(C.gold, 0.4)} 32deg 42deg,transparent 42deg 64deg)}
@media (max-width:359px){
  .cs-chip{padding:7px 8px 7px 7px}
  .cs-chip .cs-title{gap:6px;letter-spacing:.03em}
}
@media (prefers-reduced-motion:reduce){
  .cs-frame-flame::before,.cs-frame-flame::after{animation:none}
  /* A celebration is motion and nothing else, so under reduced motion it does not play at all rather than
     snapping to a final frame: the final frame of confetti is an empty screen. The result text says what
     happened either way, which is what somebody reading with motion off is there for.
     Hiding the parent alone would have been enough to stop it being seen - but every animated selector
     also says animation:none here, because that is the rule test-cosmetics.mjs actually enforces, and it
     enforces it per selector so a new animation cannot hide behind a parent that happens to be hidden.
     (This comment is inside a template literal. A backtick here ends the stylesheet.) */
  .cs-cel{display:none}
  .cs-cel-fall i,.cs-cel-spotlight i,.cs-cel-fireworks i,.cs-cel-champion i,.cs-cel-supernova i{animation:none}
  /* A drifting plate holds still and keeps its colours - unlike a celebration, there is something to look at. */
  .cs-nameplate.cs-lively{animation:none}
  /* A drifting name holds still and keeps its colours, for the same reason a plate does: there is something
     to read underneath, and it is somebody's name. */
  .cs-name-grad.cs-lively{animation:none}
  .cs-plate-ring.cs-lively{animation:none}
  /* Orbit stops with its body wherever it is - a ring with a bright arc in it, which is still the frame. */
  .cs-frame-orbit::before{animation:none}
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
  return <p className={`${titleClass(id)} ${className}`.trim()} data-title={id}>{SHOP_ITEM_BY_ID[id].name}</p>;
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
// The plate itself. Wraps whatever it is given - a name - so the caller keeps owning the element and its
// heading level; without a plate it renders nothing at all and the name is untouched.
// A name in the colour its account wears, for the boards. The scope is handed in rather than read from a
// class because a look is three palettes and only the app knows which screen this is - perfect-season.jsx
// computes exactly this scope for the root already. No look, or an id the catalog does not know: the name
// itself, unchanged, which is what every account without one gets.
export function NameInk({ look = null, scope = "light", children }) {
  const paint = namePaint(known(look, "namecolor"), scope);
  if (!paint) return children ?? null;
  const fill = nameFill(paint.inks);
  const cls = ["cs-name", fill ? "cs-name-grad" : "", fill && paint.lively ? "cs-lively" : ""].filter(Boolean).join(" ");
  return (
    <span className={cls} data-name-look={look}
          style={{ "--cs-name-1": paint.inks[0], ...(fill ? { "--cs-name-fill": fill } : {}) }}>
      {children}
    </span>
  );
}

// ONE NAME ON ONE BOARD, everywhere a board shows one. The guest chip, the supporter star, the name colour
// and the link to the profile are all decided here and nowhere else, because a board that renders its own
// name is a board that will eventually drop one of the four - which is not a hypothesis: eight boards
// silently dropped the guest chip before v2.0.0, turning throwaway accounts into clickable, reportable
// ones, and Century's and Guess's boards rendered bare text until v2.18.3 and so showed no chip, no star,
// no colour and no link at all.
//
// It lives in cosmetics.jsx rather than in ui-common.jsx, which is where a shared display helper would
// normally go, for one reason: it needs NameInk, NameInk is wired into this file's palettes, and
// cosmetics.jsx already imports ui-common.jsx - so putting it the other way round would make the two
// modules import each other. Here the arrow still points one way. The CSS it emits stays in
// perfect-season.jsx's own stylesheet with the rest of the board styles; this file's rule about only
// styling `cs-` is about what COSMETICS_CSS contains, and it still contains only that.
//
// The duel screen deliberately does NOT use this: DuelName paints a name and never links one, because a
// profile link would push a history entry and take a player off a match on a clock (VERSUS.md).
export function NameLink({ name, guest }) {
  const openProfile = useContext(OpenProfile);
  const wear = useContext(BoardWear);
  // A guest has no profile screen to open - no picture, no bio, nothing it could set - so its name is
  // shown as what it is instead of offering an empty page. A guest is never a supporter: the shop refuses
  // one, so there is no star to show either.
  if (guest) return <><span className="bname">{name}</span><span className="guestchip">guest</span></>;
  const look = wear?.looks?.get(name) || null;
  // The colour goes on the name and nothing else. The star and the guest chip stay outside it, in their own
  // tokens, or a drifting gradient would take the chip with it and the one thing it has to stay is legible.
  const inked = <span className="bname"><NameInk look={look} scope={wear?.scope || "light"}>{name}</NameInk></span>;
  if (!name || !openProfile) return name ? inked : null;
  const star = wear?.supporters?.has(name)
    ? <span className="supchip" role="img" aria-label="Supporter">{"★"}</span>
    : null;
  return <>
    <button type="button" className="namelink" onClick={() => openProfile(name)}>{inked}</button>
    {star}
  </>;
}

// The name on the player card: its plate if it wears one, otherwise its colour.
//
// Both, in one component, because only one of them can win and the rule is worth stating once. A PLATE WINS.
// A plate is a fill and its own ink held together - that pairing is what makes it readable on any card - so a
// name colour painted over one is a colour chosen for the card's scope sitting on a background that is not the
// card. Measured: of the 975 name-colour-on-plate pairs, 596 fall below AA. On the card itself there is no
// such problem at all - 1,073 pairs across every theme and all 32 team colours, none below AA - because a look
// carries one palette per scope and the card publishes which scope it is (CARD_THEME_SCOPE).
// That last part is why this is possible now and was not when nameplates were built: name colours did not have
// per-scope palettes then, and "no colour clears AA on all three card scopes" was true of a single colour.
export function NamePlate({ plate = null, look: nameLook = null, scope = "dark", children, className = "" }) {
  const look = NAMEPLATES[known(plate, "nameplate")];
  if (!look) return <NameInk look={nameLook} scope={scope}>{children}</NameInk>;
  // Wearing both: the plate keeps the letters, the name colour takes the plate's outer ring.
  // Not the letters, and the numbers are why. A plate is a fill and its own ink held together, and a name
  // colour is three palettes chosen for the app's three surfaces - so painting one onto a plate means asking
  // a colour picked for cream, navy or black to work on a plate's own fill. Measured every way round: even
  // letting each pair choose whichever of its three palettes suited that plate best, only 50 of the 99
  // combinations clear AA. The 49 that cannot are every mid-tone fill - blue, ember, inferno, emerald,
  // aurora - which is the one background neither a deep nor a bright palette can sit on.
  // The ring is never behind a letter, so it carries the colour at no cost to reading the name, and both
  // things you paid for are on the card at once.
  const ink = namePaint(known(nameLook, "namecolor"), scope);
  const banner = (
    <span className={`cs-nameplate ${look.lively ? "cs-lively" : ""} ${ink ? "" : className}`.trim()} data-plate={plate}
          style={{ "--cs-nameplate": plateFill(look), "--cs-nameplate-ink": look.ink, "--cs-nameplate-trim": look.trim }}>
      {children}
    </span>
  );
  if (!ink) return banner;
  const fill = nameFill(ink.inks);
  const ringClass = ["cs-plate-ring", fill && ink.lively ? "cs-lively" : "", className].filter(Boolean).join(" ");
  return (
    <span className={ringClass} data-name-look={nameLook}
          style={{ "--cs-name-1": ink.inks[0], ...(fill ? { "--cs-name-fill": fill } : {}) }}>
      {banner}
    </span>
  );
}

// ---------- Win celebrations ----------
// Fixed colours, like every other cosmetic here: an item looks the same wherever it is worn, and the result
// screen is the dark scope in every theme anyway.
// Built from the named paints rather than written out again: these reach the DOM as inline styles, so no test
// parses them, and a second spelling of the brand lime is exactly the sort of thing that drifts unnoticed.
export const CEL_COLORS = {
  confetti: [COLORS.lime, PALETTE.blue, PALETTE.orange, PALETTE.violet, COLORS.celBeam],
  gold: [COLORS.gold, COLORS.goldMid, COLORS.goldLight],
  firework: [COLORS.lime, PALETTE.orange, PALETTE.violet, PALETTE.blue, COLORS.gold, COLORS.celBeam],
};

// What each celebration puts on the screen. Everything is a pure function of the piece's index, so the same
// celebration draws the same picture every time - the one thing a seeded game should not have to wonder about.
//
// `preview` lays the same pieces out for the shop's 64x40 swatch instead of the viewport, from this one place
// so a celebration cannot look like one thing in the shop and another on the screen. The overlay's geometry is
// viewport geometry - pieces starting above the fold, beams 150vh tall, rays 180vmax across - and dropped into
// a swatch it shows an empty tile, which is what the first version of this did.
export function celebrationPieces(id, { preview = false } = {}) {
  if (id === "cel-confetti" || id === "cel-gold-rain") {
    const gold = id === "cel-gold-rain";
    const palette = gold ? CEL_COLORS.gold : CEL_COLORS.confetti;
    // Spread across the tile rather than queued above it, and fewer of them: eighteen in a swatch is a smear.
    if (preview) {
      return Array.from({ length: 8 }, (_, i) => ({
        key: i,
        style: {
          left: `${6 + ((i * 29) % 76)}%`,
          top: `${8 + ((i * 37) % 64)}%`,
          background: palette[i % palette.length],
          transform: `rotate(${(i * 47) % 90}deg)`,
        },
      }));
    }
    return Array.from({ length: 18 }, (_, i) => ({
      key: i,
      style: {
        left: `${((i * 53) % 97) + 1}%`,
        background: palette[i % palette.length],
        animationDelay: `${((i * 7) % 12) / 10}s`,
        animationDuration: `${2 + (((i * 3) % 7) / 10)}s`,
      },
    }));
  }
  if (id === "cel-spotlight") {
    if (preview) {
      return [
        { key: 0, style: { left: "6%", transform: "rotate(-20deg)" } },
        { key: 1, style: { right: "6%", transform: "rotate(20deg)" } },
      ];
    }
    return [
      { key: 0, style: { left: "-6vw", "--from": "-52deg", "--to": "-14deg" } },
      { key: 1, style: { right: "-6vw", "--from": "52deg", "--to": "14deg" } },
    ];
  }
  if (id === "cel-fireworks") {
    const colour = (i) => CEL_COLORS.firework[i % CEL_COLORS.firework.length];
    if (preview) {
      // Held mid-burst: a ring at its widest says "firework" where a dot says nothing.
      return [0, 1, 2].map((i) => ({
        key: i,
        style: {
          left: `${14 + i * 28}%`, top: `${20 + ((i * 23) % 40)}%`,
          boxShadow: `0 0 0 2px ${colour(i)} inset`, color: colour(i),
        },
      }));
    }
    return Array.from({ length: 7 }, (_, i) => ({
      key: i,
      style: {
        left: `${10 + ((i * 29) % 78)}%`,
        top: `${14 + ((i * 17) % 48)}%`,
        color: colour(i),
        boxShadow: `0 0 0 2px ${colour(i)} inset`,
        animationDelay: `${((i * 4) % 11) / 8}s`,
      },
    }));
  }
  if (id === "cel-champion") return [{ key: 0, style: {} }];
  if (id === "cel-supernova") {
    const n = preview ? 2 : 3;
    return Array.from({ length: n }, (_, i) => ({ key: i, style: { animationDelay: `${i * 0.22}s` } }));
  }
  return [];
}

// The overlay itself. The caller mounts it for the length of the moment and unmounts it - there is no timer in
// here, because the result screen already owns when the celebration starts.
export function WinCelebration({ celebration = null, className = "" }) {
  const id = known(celebration, "celebration") || DEFAULT_ITEM.celebration;
  const pieces = celebrationPieces(id);
  if (!pieces.length) return null;
  return (
    <div className={`cs-cel cs-cel-${id.replace(/^cel-/, "")} ${id === "cel-confetti" || id === "cel-gold-rain" ? "cs-cel-fall" : ""} ${className}`}
         aria-hidden="true" data-celebration={id}>
      {pieces.map((p) => <i key={p.key} style={p.style} />)}
    </div>
  );
}

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
  if (item.kind === "nameplate") {
    // Guarded like NamePlate and NameInk are, and unlike this used to be. shop.jsx's drawable() admits an item
    // on catalog membership alone, so a future release that adds a plate to shop-catalog.mjs and seeds the row
    // but forgets its NAMEPLATES entry - the exact split the catalog file warns about - would throw here on
    // render. There is no error boundary anywhere in the app, so that is the whole shop screen, for everyone.
    const look = NAMEPLATES[id];
    if (!look) return null;
    return (
      <span className="cs-preview" aria-hidden="true" data-preview={id}>
        <span className={`cs-nameplate cs-nameplate-preview ${look.lively ? "cs-lively" : ""}`.trim()} data-plate={id}
              style={{ "--cs-nameplate": plateFill(look), "--cs-nameplate-ink": look.ink, "--cs-nameplate-trim": look.trim }}>Name</span>
      </span>
    );
  }
  if (item.kind === "namecolor") {
    // Both ends of it. A name colour is a deep value on cream and a bright one on black, so a single swatch
    // would be a preview of one screen and a lie about the other.
    return (
      <span className="cs-preview" aria-hidden="true" data-preview={id}>
        <span className="cs-name-preview">
          {["light", "night"].map((scope) => (
            <span key={scope} className={`cs-name-chip cs-name-chip-${scope}`}>
              <NameInk look={id} scope={scope}>Name</NameInk>
            </span>
          ))}
        </span>
      </span>
    );
  }
  if (item.kind === "celebration") {
    // Held still: the shop lists every celebration at once, and five overlays playing behind each other is
    // not a preview of any of them. The Equip button is the way to see one for real.
    return (
      <span className="cs-preview" aria-hidden="true" data-preview={id}>
        <span className={`cs-cel-preview cs-cel-${id.replace(/^cel-/, "")}`}>
          {celebrationPieces(id, { preview: true }).map((pc) => <i key={pc.key} style={pc.style} />)}
        </span>
      </span>
    );
  }
  if (item.kind === "title") {
    return (
      <span className="cs-preview" aria-hidden="true" data-preview={id}>
        <span className="cs-chip"><span className={titleClass(item.id)}>{item.name}</span></span>
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
