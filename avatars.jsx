// Player pictures: an uploaded photo, one of the default avatars, or the player's initial - in that
// order, falling back to the next when the one before is missing or fails to load. Contract:
// PROFILES.md. Classes are prefixed av-.
import { useState } from "react";
import { FREE_AVATAR_PRESETS } from "./profile-rules.mjs";
import { PALETTE } from "./theme.mjs";

// Every default avatar: [{ key, name, pack, free }], the same keys as the database's avatar_presets.
// The drawings themselves are in ART below, keyed the same way.
export const AVATAR_PRESETS = FREE_AVATAR_PRESETS.map((p) => ({ ...p, pack: "starter", free: true }));

const { ink: INK, cream: CREAM, lime: LIME, blue: BLUE, orange: ORANGE, violet: VIOLET } = PALETTE;

// The drawings, on the same 64x64 grid as the Gridspin mark (static/icon.svg): a colored disc with
// bold ink shapes. They have to read in the 24px header, so every shape is big and simple and the
// small details are only there for the 96px profile card. Nothing here may look like a real team's
// logo - no stars, horseshoes or bolts on a helmet. The disc fills the whole square; Avatar clips it
// round and draws the ring.
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
};

export const AVATAR_CSS = `
.av{position:relative;display:inline-grid;place-items:center;flex:none;vertical-align:middle;border-radius:50%;overflow:hidden;
  background:var(--accent);color:var(--on-accent);font-family:var(--display);font-weight:400;line-height:1;user-select:none}
.av>*{grid-area:1/1}
/* The ring goes on top, so it frames a photo too. It thickens with the size (see ringWidth). */
.av::after{content:"";position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 var(--av-ring,2px) var(--ink);pointer-events:none}
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
