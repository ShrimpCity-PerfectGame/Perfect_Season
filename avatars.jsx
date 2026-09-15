// Player pictures: an uploaded photo, one of the default avatars, or the player's initial - in that
// order, falling back to the next when the one before is missing or fails to load. Contract:
// PROFILES.md, and SHOP.md (7.1) for the avatar packs. Classes are prefixed av-.
import { useState } from "react";
import { FREE_AVATAR_PRESETS } from "./profile-rules.mjs";
import { AVATAR_PACKS } from "./shop-catalog.mjs";
import { PALETTE, THEME } from "./theme.mjs";

// Every default avatar: [{ key, name, pack, free }], the same keys as the database's avatar_presets - the
// free starter set, then each shop pack's four (free: false; owning the pack's item unlocks them). The
// drawings themselves are in ART below, keyed the same way.
export const AVATAR_PRESETS = [
  ...FREE_AVATAR_PRESETS.map((p) => ({ ...p, pack: "starter", free: true })),
  ...AVATAR_PACKS.flatMap((pack) => pack.presets.map((p) => ({ ...p, pack: pack.pack, free: false }))),
];

const { ink: INK, cream: CREAM, lime: LIME, blue: BLUE, orange: ORANGE, violet: VIOLET } = PALETTE;
// The medal gold every scope shares (only ever a fill), and the navy scoreboard sky for the Night game pack.
const GOLD = THEME.light.tierGoldFill;
const NIGHT = THEME.dark.bg;

// Straight rays from a center, as one path: a firework burst.
const burst = (cx, cy, count, from, to, turn = 0) => Array.from({ length: count }, (_, i) => {
  const a = (i / count + turn) * 2 * Math.PI;
  const at = (r) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
  return `M${at(from)}L${at(to)}`;
}).join("");

// The drawings, on the same 64x64 grid as the Gridspin mark (static/icon.svg): a colored disc with
// bold ink shapes. They have to read in the 24px header, so every shape is big and simple and the
// small details are only there for the 96px profile card. Nothing here may look like a real team's
// logo - no stars, horseshoes or bolts on a helmet - or any company's (no words on the blimp). The disc
// fills the whole square; Avatar clips it round and draws the ring. The Night game pack is drawn on the
// navy sky, so its shapes are cream and lime rather than ink.
const ART = {
  football: {
    bg: ORANGE,
    art: (
      <g transform="rotate(-35 32 32)">
        <path d="M9 32C16 15 48 15 55 32C48 49 16 49 9 32Z" fill={INK} />
        <path d="M23 32H41" stroke={CREAM} strokeWidth="3" strokeLinecap="round" />
        <path d="M26 28V36M30.7 28V36M35.3 28V36M40 28V36" stroke={CREAM} strokeWidth="2.6" strokeLinecap="round" />
      </g>
    ),
  },
  helmet: {
    bg: BLUE,
    art: (
      <g>
        <path d="M9 40C6 22 19 9 34 9C48 9 56 19 55 30H45C42.5 30 41 31.5 41 34V38L45 44C36 50 17 50 9 40Z" fill={CREAM} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M14 25C17 16 26 12.5 35 12.5C41 12.5 46 14.5 49 18" fill="none" stroke={LIME} strokeWidth="5" strokeLinecap="round" />
        <circle cx="25" cy="31" r="4.2" fill={INK} />
        <path d="M41 35.5H56.5C58 39 57.5 42 55 44.5H45" fill="none" stroke={INK} strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    ),
  },
  trophy: {
    bg: LIME,
    art: (
      <g fill={INK}>
        <path d="M19 13H45V25C45 35 39 41 32 41C25 41 19 35 19 25Z" />
        <path d="M20 17H13C12 27 16 31 21 32M44 17H51C52 27 48 31 43 32" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="28.5" y="39" width="7" height="8" />
        <rect x="20" y="46" width="24" height="7" rx="2" />
        <rect x="24" y="17" width="4" height="12" rx="2" fill={CREAM} />
      </g>
    ),
  },
  whistle: {
    bg: VIOLET,
    art: (
      <g>
        <path d="M25 19H53C55.2 19 57 20.8 57 23V29C57 31.2 55.2 33 53 33H40A15 15 0 1 1 25 19Z" fill={INK} />
        <path d="M35 19H44V25H35Z" fill={VIOLET} />
        <circle cx="25" cy="34" r="5.5" fill={CREAM} />
      </g>
    ),
  },
  "foam-finger": {
    bg: LIME,
    art: (
      <g transform="rotate(-10 32 34)" stroke={INK} strokeWidth="3.5" strokeLinejoin="round">
        <path d="M28 30V12C28 9.2 30 7 32.5 7S37 9.2 37 12V27H42C45.3 27 48 29.7 48 33V44C48 49 44 52 39 52H26C21 52 17 49 17 44V36C17 33 19.5 30.5 22.5 30.5Z" fill={VIOLET} />
        <path d="M37 33H48M17 40H23" fill="none" strokeLinecap="round" />
        <path d="M22 52H43V58H22Z" fill={INK} />
        <path d="M28.5 38L32 36V47" fill="none" stroke={CREAM} strokeWidth="3.2" strokeLinecap="round" />
      </g>
    ),
  },
  goalposts: {
    bg: CREAM,
    art: (
      <g>
        <path d="M17 9V38H47V9M32 38V58" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
        <g transform="rotate(-30 32 22)">
          <path d="M23 22C26 16 38 16 41 22C38 28 26 28 23 22Z" fill={ORANGE} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M29 22H35" stroke={INK} strokeWidth="2" strokeLinecap="round" />
        </g>
      </g>
    ),
  },
  clipboard: {
    bg: BLUE,
    art: (
      <g>
        <rect x="15" y="12" width="34" height="44" rx="5" fill={INK} />
        <rect x="19.5" y="19" width="25" height="32.5" rx="2" fill={CREAM} />
        <rect x="24" y="8" width="16" height="9" rx="3" fill={LIME} stroke={INK} strokeWidth="3" />
        <path d="M24 26L29 31M29 26L24 31" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="38" cy="43" r="3.4" fill="none" stroke={INK} strokeWidth="2.6" />
        <path d="M28 35C29 41 31 44 34 44" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
      </g>
    ),
  },
  stopwatch: {
    bg: ORANGE,
    art: (
      <g>
        <rect x="27" y="7" width="10" height="6" rx="2" fill={INK} />
        <rect x="30" y="12" width="4" height="6" fill={INK} />
        <path d="M44 17L48 13" stroke={INK} strokeWidth="4" strokeLinecap="round" />
        <circle cx="32" cy="36" r="18" fill={CREAM} stroke={INK} strokeWidth="4" />
        <path d="M32 36V22A14 14 0 0 1 44.1 43Z" fill={BLUE} />
        <path d="M32 36L44 43" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="32" cy="36" r="3" fill={INK} />
      </g>
    ),
  },
  megaphone: {
    bg: VIOLET,
    art: (
      <g>
        <path d="M19 27L41 15V47L19 36Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <rect x="11" y="26" width="9" height="11" rx="2.5" fill={INK} />
        <path d="M25 37L27 47H32L31 39" fill={INK} />
        <path d="M34 19V43" stroke={LIME} strokeWidth="3.5" />
        <ellipse cx="42" cy="31" rx="4.5" ry="16" fill={CREAM} stroke={INK} strokeWidth="3" />
        <path d="M50 25C52.5 28.5 52.5 33.5 50 37M55 20C60 26.5 60 35.5 55 42" fill="none" stroke={CREAM} strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
  },
  jersey: {
    bg: ORANGE,
    art: (
      <g>
        <path d="M23 9L13 13L6 28L15 32L19 26V55H45V26L49 32L58 28L51 13L41 9C39 14 36 16 32 16C28 16 25 14 23 9Z" fill={CREAM} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M9.5 21L17.5 24.5M54.5 21L46.5 24.5" stroke={BLUE} strokeWidth="3.5" />
        <path d="M22.3 31.8H28.7V38H22.3V44.2H28.7" fill="none" stroke={INK} strokeWidth="3.6" strokeLinecap="square" />
        <rect x="35.3" y="31.8" width="6.4" height="12.4" fill="none" stroke={INK} strokeWidth="3.6" />
      </g>
    ),
  },
  lightning: {
    bg: CREAM,
    art: (
      <g>
        <path d="M37 6H47L38 26H48L25 58L30 35H19Z" fill={INK} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M13 18L18 21M11 28H16M51 44L46 41M53 36H48" stroke={ORANGE} strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
  },
  crown: {
    bg: LIME,
    art: (
      <g>
        <path d="M13 44L10 19L22 30L32 13L42 30L54 19L51 44Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <rect x="13" y="44" width="38" height="8" rx="2" fill={INK} />
        <circle cx="10" cy="19" r="3.5" fill={INK} />
        <circle cx="32" cy="13" r="3.5" fill={INK} />
        <circle cx="54" cy="19" r="3.5" fill={INK} />
        <circle cx="22" cy="48" r="2" fill={CREAM} />
        <circle cx="32" cy="48" r="2" fill={CREAM} />
        <circle cx="42" cy="48" r="2" fill={CREAM} />
        <path d="M32 26L36 33L32 40L28 33Z" fill={LIME} />
      </g>
    ),
  },

  // ---- Sideline pack ----
  headset: {
    bg: LIME,
    art: (
      <g>
        <path d="M15 34V30C15 18.5 22.6 10 32 10S49 18.5 49 30V34" fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round" />
        <rect x="8" y="26" width="14" height="22" rx="6" fill={INK} />
        <rect x="42" y="26" width="14" height="22" rx="6" fill={INK} />
        <circle cx="15" cy="37" r="3.2" fill={CREAM} />
        <circle cx="49" cy="37" r="3.2" fill={CREAM} />
        <path d="M15 47C15 53.5 19.5 56.5 27 56.5" fill="none" stroke={INK} strokeWidth="3.5" strokeLinecap="round" />
        <rect x="26" y="52" width="12" height="9" rx="4.5" fill={CREAM} stroke={INK} strokeWidth="3" />
      </g>
    ),
  },
  // The round sideline jug: a lid, a cream band, and the tap at the bottom.
  cooler: {
    bg: VIOLET,
    art: (
      <g stroke={INK} strokeWidth="3.5" strokeLinejoin="round">
        <path d="M14 26H10V33H14M50 26H54V33H50" fill="none" strokeLinecap="round" />
        <path d="M14 19H50V47C50 52.5 46 56 40 56H24C18 56 14 52.5 14 47Z" fill={ORANGE} />
        <path d="M14 29H50V37H14Z" fill={CREAM} />
        <path d="M12 12.5C12 10.6 13.6 9 15.5 9H48.5C50.4 9 52 10.6 52 12.5V19H12Z" fill={CREAM} />
        <path d="M28 44H36V49H33V53.5H31V49H28Z" fill={INK} strokeWidth="2.4" />
      </g>
    ),
  },
  // The end-zone pylon, standing on the goal line - not a traffic cone.
  pylon: {
    bg: LIME,
    art: (
      <g>
        <path d="M-2 51L66 43" stroke={CREAM} strokeWidth="7" />
        <g stroke={INK} strokeWidth="3.2" strokeLinejoin="round">
          <path d="M20 16H36V52H20Z" fill={ORANGE} />
          <path d="M36 16L45 11V47L36 52Z" fill={ORANGE} />
          <path d="M36 16L45 11V47L36 52Z" fill={INK} fillOpacity=".28" stroke="none" />
          <path d="M20 16L29 11H45L36 16Z" fill={CREAM} />
        </g>
      </g>
    ),
  },
  // A yellow flag in flight, its weighted knot trailing.
  "penalty-flag": {
    bg: BLUE,
    art: (
      <g>
        <path d="M8 31L15 29.5M6.5 40L14.5 38.5M9 49L16 46.5" stroke={CREAM} strokeWidth="3.2" strokeLinecap="round" />
        <g transform="rotate(-10 34 32)" stroke={INK} strokeWidth="3.5" strokeLinejoin="round">
          <path d="M25 17C32 12.5 40 20.5 51 15.5L54 45C44 50 36 42 28 47.5Z" fill={GOLD} />
          <path d="M28.5 19.5L18.5 12" fill="none" strokeWidth="3" strokeLinecap="round" />
          <circle cx="17" cy="12" r="6.2" fill={GOLD} />
        </g>
      </g>
    ),
  },

  // ---- Trophy room pack ----
  "title-ring": {
    bg: VIOLET,
    art: (
      <g stroke={INK} strokeLinejoin="round">
        <path d="M21 40C19 51 24 57 32 57S45 51 43 40" fill="none" strokeWidth="6.5" />
        <path d="M22 10H42L52 20V33L42 43H22L12 33V20Z" fill={GOLD} strokeWidth="3.5" />
        <path d="M32 16L41.5 26.5L32 37L22.5 26.5Z" fill={BLUE} strokeWidth="3" />
        <path d="M17.5 21.5V31.5M46.5 21.5V31.5" stroke={CREAM} strokeWidth="2.6" strokeLinecap="round" />
      </g>
    ),
  },
  medal: {
    bg: BLUE,
    art: (
      <g stroke={INK} strokeWidth="3.2" strokeLinejoin="round">
        <path d="M15 4H28L36.5 28H23.5Z" fill={ORANGE} />
        <path d="M49 4H36L27.5 28H40.5Z" fill={CREAM} />
        <circle cx="32" cy="40" r="15.5" fill={GOLD} strokeWidth="3.5" />
        <circle cx="32" cy="40" r="9.2" fill="none" strokeWidth="2.6" />
        <path d="M29.2 36.8L32.8 34.6V45.5" fill="none" strokeWidth="3" strokeLinecap="round" />
      </g>
    ),
  },
  banner: {
    bg: CREAM,
    art: (
      <g>
        <path d="M17 13H47V54L32 45L17 54Z" fill={ORANGE} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M17 44.5L32 36L47 44.5" fill="none" stroke={CREAM} strokeWidth="3.5" />
        <rect x="11" y="8.5" width="42" height="6.5" rx="3.25" fill={INK} />
        <path d="M25 18.5H39V22C39 26.8 36 29.5 32 29.5S25 26.8 25 22Z" fill={INK} />
        <rect x="30" y="29" width="4" height="3" fill={INK} />
        <rect x="26.5" y="31.5" width="11" height="3.5" rx="1" fill={INK} />
      </g>
    ),
  },
  "game-ball": {
    bg: LIME,
    art: (
      <g>
        <path d="M21 57H43L40 50H24Z" fill={INK} />
        <rect x="28" y="44" width="8" height="7" fill={INK} />
        <g transform="rotate(-16 32 29)">
          <path d="M7 29C14.5 12 49.5 12 57 29C49.5 46 14.5 46 7 29Z" fill={INK} />
          <path d="M17.5 21.5C20 26 20 32 17.5 36.5M46.5 21.5C44 26 44 32 46.5 36.5" fill="none" stroke={CREAM} strokeWidth="3.2" />
          <path d="M25 29H39" stroke={CREAM} strokeWidth="2.8" strokeLinecap="round" />
          <path d="M28 25.5V32.5M32 25.5V32.5M36 25.5V32.5" stroke={CREAM} strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </g>
    ),
  },

  // ---- Night game pack ----
  floodlights: {
    bg: NIGHT,
    art: (
      <g>
        <path d="M11 37H53L66 66H-2Z" fill={CREAM} fillOpacity=".14" />
        <path d="M32 3V8M20.5 6L23.5 10M43.5 6L40.5 10M3 26H8M56 26H61" stroke={LIME} strokeWidth="3" strokeLinecap="round" />
        <rect x="29.5" y="36" width="5" height="29" fill={CREAM} />
        <rect x="11" y="13" width="42" height="26" rx="4" fill={CREAM} />
        <g fill={LIME} stroke={INK} strokeWidth="2.4">
          <circle cx="20" cy="20" r="4.6" /><circle cx="32" cy="20" r="4.6" /><circle cx="44" cy="20" r="4.6" />
          <circle cx="20" cy="32" r="4.6" /><circle cx="32" cy="32" r="4.6" /><circle cx="44" cy="32" r="4.6" />
        </g>
      </g>
    ),
  },
  scoreboard: {
    bg: NIGHT,
    art: (
      <g>
        <rect x="17" y="44" width="5.5" height="15" fill={CREAM} />
        <rect x="41.5" y="44" width="5.5" height="15" fill={CREAM} />
        <rect x="8" y="13" width="48" height="33" rx="4" fill={CREAM} />
        <rect x="12.5" y="17.5" width="39" height="24" rx="2" fill={INK} />
        <path d="M17 23.5H25V29.5H17V35.5H25" fill="none" stroke={ORANGE} strokeWidth="3.4" strokeLinecap="square" />
        <rect x="39" y="23.5" width="8" height="12" fill="none" stroke={ORANGE} strokeWidth="3.4" />
        <circle cx="32" cy="26.5" r="1.9" fill={LIME} />
        <circle cx="32" cy="32.5" r="1.9" fill={LIME} />
      </g>
    ),
  },
  fireworks: {
    bg: NIGHT,
    art: (
      <g strokeLinecap="round">
        <path d={burst(27, 26, 8, 7.5, 19.5, 1 / 16)} stroke={LIME} strokeWidth="4" />
        <path d={burst(45, 43, 8, 4.5, 11)} stroke={ORANGE} strokeWidth="3.4" />
        <circle cx="27" cy="26" r="3.4" fill={CREAM} />
        <circle cx="45" cy="43" r="2.6" fill={CREAM} />
        <circle cx="49" cy="17" r="2.4" fill={CREAM} />
        <circle cx="15" cy="48" r="2.2" fill={CREAM} />
      </g>
    ),
  },
  blimp: {
    bg: NIGHT,
    art: (
      <g>
        <path d="M46 21L55 11.5H59.5L57 26Z" fill={CREAM} />
        <path d="M46 37L55 46.5H59.5L57 32Z" fill={CREAM} />
        <rect x="23.5" y="38" width="13" height="10" rx="3" fill={CREAM} />
        <path d="M27 44H33" stroke={NIGHT} strokeWidth="2.2" strokeLinecap="round" />
        <ellipse cx="30" cy="29" rx="24" ry="12.5" fill={CREAM} />
        <path d="M7.3 25H52.7A24 12.5 0 0 1 52.7 33H7.3A24 12.5 0 0 1 7.3 25Z" fill={BLUE} />
        <path d="M13 29H21M26 29H34" stroke={LIME} strokeWidth="2.6" strokeLinecap="round" />
      </g>
    ),
  },
};

export const AVATAR_CSS = `
.av{position:relative;display:inline-grid;place-items:center;flex:none;vertical-align:middle;border-radius:50%;overflow:hidden;
  background:var(--accent);color:var(--on-accent);font-family:var(--display);font-weight:400;line-height:1;user-select:none}
.av>*{grid-area:1/1}
/* The ring goes on top, so it frames a photo too. It thickens with the size (see ringWidth). A frame around
   the picture (cosmetics.jsx's FramedAvatar) may set --av-edge, so the ring is its inner edge in every scope. */
.av::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 var(--av-ring,2px) var(--av-edge,var(--ink));pointer-events:none}
.av-art,.av-photo{display:block;width:100%;height:100%}
.av-photo{object-fit:cover}
`;

// 2px at the small sizes, 3px at 72, 4px at 96: a 2px ring looks thin around the big card picture.
const ringWidth = (size) => Math.max(2, Math.round(size / 24));

// size is in CSS pixels. decorative hides it from screen readers when a name sits right beside it.
export function Avatar({ username = "", photoUrl = null, preset = null, size = 40, className = "", decorative = false }) {
  // The address that failed (a new address gets a fresh try) and the one that finished loading.
  const [failed, setFailed] = useState(null);
  const [loaded, setLoaded] = useState(null);
  const name = username || "";
  const showPhoto = !!photoUrl && failed !== photoUrl;
  // A key this build has no drawing for (a pack added later) falls back to the initial.
  const drawing = preset && Object.prototype.hasOwnProperty.call(ART, preset) ? ART[preset] : null;
  const label = decorative ? undefined : `${name}'s picture`;
  const style = { width: size, height: size, fontSize: Math.round(size * 0.5), "--av-ring": `${ringWidth(size)}px` };
  // Until the photo has loaded, whatever it falls back to shows underneath, so a slow photo never
  // leaves an empty disc.
  const fallback = !showPhoto || loaded !== photoUrl;
  return (
    <span className={`av ${className}`.trim()} style={style} role={decorative ? undefined : "img"} aria-label={label}
      aria-hidden={decorative ? "true" : undefined} data-preset={!showPhoto && preset ? preset : undefined}>
      {fallback && (drawing
        ? <svg className="av-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" fill={drawing.bg} />{drawing.art}</svg>
        : <span aria-hidden="true">{(name.charAt(0) || "?").toUpperCase()}</span>)}
      {showPhoto && (
        <img className="av-photo" src={photoUrl} alt="" draggable="false" decoding="async"
          onLoad={() => setLoaded(photoUrl)} onError={() => setFailed(photoUrl)} />
      )}
    </span>
  );
}
